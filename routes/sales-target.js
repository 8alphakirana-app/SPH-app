const express = require('express');
const router  = express.Router();
const db      = require('../database');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!['admin', 'manager_keuangan'].includes(req.session.user.role)) return res.status(403).json({ error: 'Akses hanya untuk admin / manager keuangan' });
  next();
}

const PUSAT_ROLES = ['admin','kantor_pusat','gm','gm2','manager_keuangan','direktur_ops','direktur_utama'];

// GET /api/sales-target?periode=YYYY-MM
router.get('/', requireLogin, (req, res) => {
  const user = req.session.user;
  const { periode } = req.query;
  if (!periode) return res.status(400).json({ error: 'Parameter periode diperlukan' });

  let areas;
  if (PUSAT_ROLES.includes(user.role)) {
    areas = db.prepare(
      "SELECT DISTINCT area_kerja FROM users WHERE area_kerja IS NOT NULL AND area_kerja != '' ORDER BY area_kerja"
    ).all().map(r => r.area_kerja);
  } else if (user.role === 'area_manager') {
    const myArea = (db.prepare('SELECT area_kerja FROM users WHERE id = ?').get(user.id) || {}).area_kerja || '';
    areas = myArea ? [myArea] : [];
  } else {
    const myArea = (db.prepare('SELECT area_kerja FROM users WHERE id = ?').get(user.id) || {}).area_kerja || '';
    areas = myArea ? [myArea] : [];
  }

  const existing = db.prepare('SELECT * FROM sales_target WHERE periode = ?').all(periode);
  const byArea   = Object.fromEntries(existing.map(r => [r.area_kerja, r]));

  const rows = areas.map(area => byArea[area] || { id: null, area_kerja: area, periode, target: 0, penjualan: 0 });
  res.json(rows);
});

// GET /api/sales-target/monthly?months=12  — agregasi per bulan untuk chart
router.get('/monthly', requireLogin, (req, res) => {
  const user   = req.session.user;
  const months = Math.min(parseInt(req.query.months) || 12, 24);

  let areaFilter = null;
  if (!PUSAT_ROLES.includes(user.role)) {
    const u = db.prepare('SELECT area_kerja FROM users WHERE id = ?').get(user.id);
    areaFilter = u?.area_kerja || null;
  }

  // Generate last N months
  const list = [];
  const now  = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    list.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }

  const rows = areaFilter
    ? db.prepare('SELECT periode, SUM(target) AS target, SUM(penjualan) AS penjualan FROM sales_target WHERE area_kerja=? GROUP BY periode').all(areaFilter)
    : db.prepare('SELECT periode, SUM(target) AS target, SUM(penjualan) AS penjualan FROM sales_target GROUP BY periode').all();

  const byPeriode = Object.fromEntries(rows.map(r => [r.periode, r]));
  const result = list.map(p => ({
    periode:   p,
    target:    byPeriode[p]?.target    || 0,
    penjualan: byPeriode[p]?.penjualan || 0
  }));

  // Hanya kembalikan bulan yang ada data (untuk menghindari spam bulan kosong)
  const firstData = result.findIndex(r => r.target > 0 || r.penjualan > 0);
  res.json(firstData >= 0 ? result.slice(firstData) : result.slice(-6));
});

// GET /api/sales-target/by-area?year=YYYY — data per area per bulan (untuk accordion admin)
router.get('/by-area', requireLogin, (req, res) => {
  const user = req.session.user;
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const months = [];
  for (let m = 1; m <= 12; m++) {
    months.push(`${year}-${String(m).padStart(2, '0')}`);
  }

  let areas;
  if (PUSAT_ROLES.includes(user.role)) {
    areas = db.prepare(`
      SELECT DISTINCT area_kerja FROM (
        SELECT area_kerja FROM users WHERE area_kerja IS NOT NULL AND area_kerja != ''
        UNION
        SELECT area_kerja FROM sales_target WHERE area_kerja IS NOT NULL AND area_kerja != ''
      ) ORDER BY area_kerja
    `).all().map(r => r.area_kerja);
  } else {
    const u = db.prepare('SELECT area_kerja FROM users WHERE id = ?').get(user.id);
    areas = u?.area_kerja ? [u.area_kerja] : [];
  }

  if (!areas.length) return res.json({ months, areas: [] });

  const placeholdersA = areas.map(() => '?').join(',');
  const placeholdersM = months.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM sales_target WHERE area_kerja IN (${placeholdersA}) AND periode IN (${placeholdersM})`
  ).all(...areas, ...months);

  const lookup = {};
  rows.forEach(r => {
    if (!lookup[r.area_kerja]) lookup[r.area_kerja] = {};
    lookup[r.area_kerja][r.periode] = r;
  });

  const result = areas.map(area => {
    const monthData = months.map(p => ({
      periode:   p,
      target:    lookup[area]?.[p]?.target    || 0,
      penjualan: lookup[area]?.[p]?.penjualan || 0,
    }));
    const totT = monthData.reduce((s, d) => s + d.target,    0);
    const totP = monthData.reduce((s, d) => s + d.penjualan, 0);
    return { area_kerja: area, months: monthData, total_target: totT, total_penjualan: totP };
  });

  res.json({ months, areas: result });
});

// POST /api/sales-target/bulk-multi — simpan banyak area+periode sekaligus
router.post('/bulk-multi', requireAdmin, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Data tidak valid' });

  const upsert = db.prepare(`
    INSERT INTO sales_target (area_kerja, periode, target, penjualan, updated_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(area_kerja, periode)
    DO UPDATE SET target=excluded.target, penjualan=excluded.penjualan, updated_at=excluded.updated_at
  `);

  const txn = db.transaction(() => {
    items.forEach(item => {
      if (item.area_kerja && item.periode && /^\d{4}-\d{2}$/.test(item.periode)) {
        upsert.run(item.area_kerja, item.periode, parseFloat(item.target) || 0, parseFloat(item.penjualan) || 0);
      }
    });
  });

  try {
    txn();
    res.json({ success: true, saved: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sales-target — upsert satu baris (area + periode)
router.post('/', requireAdmin, (req, res) => {
  const { area_kerja, periode, target, penjualan } = req.body;
  if (!area_kerja || !periode) return res.status(400).json({ error: 'area_kerja dan periode wajib diisi' });
  if (!/^\d{4}-\d{2}$/.test(periode)) return res.status(400).json({ error: 'Format periode: YYYY-MM' });

  db.prepare(`
    INSERT INTO sales_target (area_kerja, periode, target, penjualan, updated_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(area_kerja, periode)
    DO UPDATE SET target=excluded.target, penjualan=excluded.penjualan, updated_at=excluded.updated_at
  `).run(area_kerja, periode, parseFloat(target) || 0, parseFloat(penjualan) || 0);

  res.json({ success: true });
});

// POST /api/sales-target/bulk — simpan semua sekaligus
router.post('/bulk', requireAdmin, (req, res) => {
  const { periode, rows } = req.body;
  if (!periode || !Array.isArray(rows)) return res.status(400).json({ error: 'Data tidak valid' });

  const upsert = db.prepare(`
    INSERT INTO sales_target (area_kerja, periode, target, penjualan, updated_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(area_kerja, periode)
    DO UPDATE SET target=excluded.target, penjualan=excluded.penjualan, updated_at=excluded.updated_at
  `);

  const txn = db.transaction(() => {
    rows.forEach(r => {
      if (r.area_kerja) upsert.run(r.area_kerja, periode, parseFloat(r.target) || 0, parseFloat(r.penjualan) || 0);
    });
  });

  try { txn(); res.json({ success: true, saved: rows.length }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
