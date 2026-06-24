const express = require('express');
const router = express.Router();
const db = require('../database');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
router.use(requireLogin);

function canSeeAllAreas(role) {
  return ['admin', 'kantor_pusat', 'gm', 'gm2', 'manager_keuangan', 'direktur_ops', 'direktur_utama'].includes(role);
}
function canSeeAll(role) {
  return canSeeAllAreas(role) || role === 'area_manager';
}
function canReview(role) {
  return ['admin', 'gm', 'gm2'].includes(role);
}
function getUserArea(userId) {
  return (db.prepare('SELECT area_kerja FROM users WHERE id=?').get(userId)?.area_kerja || '').trim();
}

function getWithChildren(id) {
  const row = db.prepare(`
    SELECT lb.*, u.full_name, u.area_kerja, u.role AS user_role
    FROM laporan_bulanan lb JOIN users u ON lb.user_id = u.id WHERE lb.id = ?
  `).get(id);
  if (!row) return null;
  row.support  = db.prepare('SELECT id, keterangan FROM laporan_support WHERE laporan_id = ? ORDER BY id').all(id);
  row.projects = db.prepare('SELECT id, pelanggan, principal, produk, nilai, probability FROM laporan_project WHERE laporan_id = ? ORDER BY id').all(id);
  row.tanggapan = db.prepare(`
    SELECT lt.id, lt.tanggapan, lt.updated_at, u.full_name AS reviewer_name, u.role AS reviewer_role
    FROM laporan_tanggapan lt JOIN users u ON lt.reviewer_id = u.id
    WHERE lt.laporan_id = ? ORDER BY lt.updated_at DESC
  `).all(id);
  row.support.forEach(s => {
    s.tanggapan = db.prepare(`
      SELECT lst.tanggapan, lst.updated_at, u.full_name AS reviewer_name, u.role AS reviewer_role
      FROM laporan_support_tanggapan lst JOIN users u ON lst.reviewer_id = u.id
      WHERE lst.support_id = ? ORDER BY lst.updated_at DESC
    `).all(s.id);
  });
  return row;
}

// Attach full details (projects + support w/ tanggapan + general tanggapan) to row array
function attachDetails(rows) {
  if (!rows.length) return;
  const ids = rows.map(r => r.id);
  const ph  = ids.map(() => '?').join(',');

  const projects = db.prepare(
    `SELECT laporan_id, pelanggan, principal, produk, nilai, probability FROM laporan_project WHERE laporan_id IN (${ph}) ORDER BY laporan_id, id`
  ).all(...ids);

  const supports = db.prepare(
    `SELECT id, laporan_id, keterangan FROM laporan_support WHERE laporan_id IN (${ph}) ORDER BY laporan_id, id`
  ).all(...ids);

  const tanggapan = db.prepare(`
    SELECT lt.laporan_id, lt.id, lt.tanggapan, lt.updated_at, u.full_name AS reviewer_name, u.role AS reviewer_role
    FROM laporan_tanggapan lt JOIN users u ON lt.reviewer_id = u.id
    WHERE lt.laporan_id IN (${ph}) ORDER BY lt.laporan_id, lt.updated_at DESC
  `).all(...ids);

  const suppTanggapan = supports.length ? (() => {
    const sids = supports.map(s => s.id);
    const sph  = sids.map(() => '?').join(',');
    return db.prepare(`
      SELECT lst.support_id, lst.tanggapan, lst.updated_at, u.full_name AS reviewer_name, u.role AS reviewer_role
      FROM laporan_support_tanggapan lst JOIN users u ON lst.reviewer_id = u.id
      WHERE lst.support_id IN (${sph}) ORDER BY lst.support_id, lst.updated_at DESC
    `).all(...sids);
  })() : [];

  const projByLap = {}, suppByLap = {}, tanggByLap = {}, suppTanggById = {};
  projects.forEach(p      => { (projByLap[p.laporan_id]  = projByLap[p.laporan_id]  || []).push(p); });
  supports.forEach(s      => { (suppByLap[s.laporan_id]  = suppByLap[s.laporan_id]  || []).push(s); });
  tanggapan.forEach(t     => { (tanggByLap[t.laporan_id] = tanggByLap[t.laporan_id] || []).push(t); });
  suppTanggapan.forEach(t => { (suppTanggById[t.support_id] = suppTanggById[t.support_id] || []).push(t); });
  supports.forEach(s => { s.tanggapan = suppTanggById[s.id] || []; });

  rows.forEach(r => {
    r.projects  = projByLap[r.id]  || [];
    r.support   = suppByLap[r.id]  || [];
    r.tanggapan = tanggByLap[r.id] || [];
  });
}

// ── Static routes (before /:id) ───────────────────────────────────────────────

router.get('/mine', (req, res) => {
  const { periode } = req.query;
  const userId = req.session.user.id;
  if (!periode) return res.json(null);
  const row = db.prepare('SELECT * FROM laporan_bulanan WHERE user_id = ? AND periode = ?').get(userId, periode);
  if (!row) return res.json(null);
  row.support  = db.prepare('SELECT id, keterangan FROM laporan_support WHERE laporan_id = ? ORDER BY id').all(row.id);
  row.projects = db.prepare('SELECT id, pelanggan, principal, produk, nilai, probability FROM laporan_project WHERE laporan_id = ? ORDER BY id').all(row.id);
  res.json(row);
});

router.get('/mine/list', (req, res) => {
  const userId = req.session.user.id;
  const rows = db.prepare(`
    SELECT lb.id, lb.periode, lb.alasan, lb.rencana_bulan_depan, lb.prognosa_bulan_depan, lb.updated_at,
      COUNT(DISTINCT lp.id) AS jumlah_project,
      COALESCE(SUM(lp.nilai), 0) AS total_nilai,
      COUNT(DISTINCT lt.id) AS jumlah_tanggapan
    FROM laporan_bulanan lb
    LEFT JOIN laporan_project lp ON lp.laporan_id = lb.id
    LEFT JOIN laporan_tanggapan lt ON lt.laporan_id = lb.id
    WHERE lb.user_id = ?
    GROUP BY lb.id ORDER BY lb.periode DESC
  `).all(userId);

  // Attach tanggapan detail for each laporan
  rows.forEach(r => {
    r.tanggapan = db.prepare(`
      SELECT lt.tanggapan, lt.updated_at, u.full_name AS reviewer_name, u.role AS reviewer_role
      FROM laporan_tanggapan lt JOIN users u ON lt.reviewer_id = u.id
      WHERE lt.laporan_id = ? ORDER BY lt.updated_at DESC
    `).all(r.id);

    // Support with tanggapan
    const supports = db.prepare('SELECT id, keterangan FROM laporan_support WHERE laporan_id = ? ORDER BY id').all(r.id);
    supports.forEach(s => {
      s.tanggapan = db.prepare(`
        SELECT lst.tanggapan, lst.updated_at, u.full_name AS reviewer_name
        FROM laporan_support_tanggapan lst JOIN users u ON lst.reviewer_id = u.id
        WHERE lst.support_id = ? ORDER BY lst.updated_at DESC
      `).all(s.id);
    });
    r.support_with_tanggapan = supports.filter(s => s.tanggapan.length > 0 || s.keterangan);
  });

  res.json(rows);
});

router.get('/filters', (req, res) => {
  const user = req.session.user;
  if (canSeeAllAreas(user.role)) {
    const areas = db.prepare(
      "SELECT DISTINCT area_kerja FROM users WHERE area_kerja IS NOT NULL AND area_kerja != '' ORDER BY area_kerja"
    ).all().map(r => r.area_kerja);
    const users = db.prepare('SELECT id, full_name, area_kerja FROM users ORDER BY full_name').all();
    res.json({ areas, users });
  } else if (user.role === 'area_manager') {
    const myArea = getUserArea(user.id);
    const users = db.prepare(
      "SELECT id, full_name, area_kerja FROM users WHERE LOWER(TRIM(area_kerja)) = LOWER(TRIM(?)) AND role IN ('supervisor','marketing','area_manager') ORDER BY full_name"
    ).all(myArea);
    res.json({ areas: [], users });
  } else {
    res.json({ areas: [], users: [{ id: user.id, full_name: user.full_name, area_kerja: user.area_kerja || '' }] });
  }
});

router.get('/dashboard', (req, res) => {
  const user = req.session.user;
  const { periode, area_kerja, user_id } = req.query;

  let sql = `
    SELECT lb.id, lb.user_id, lb.periode, lb.alasan, lb.aktivitas_bulan_ini,
      lb.rencana_bulan_depan, lb.prognosa_bulan_depan, lb.updated_at,
      u.full_name, u.area_kerja, u.role AS user_role,
      COUNT(DISTINCT lp.id) AS jumlah_project,
      COALESCE(SUM(lp.nilai), 0) AS total_nilai
    FROM laporan_bulanan lb
    JOIN users u ON lb.user_id = u.id
    LEFT JOIN laporan_project lp ON lp.laporan_id = lb.id
    WHERE 1=1
  `;
  const params = [];

  if (canSeeAllAreas(user.role)) {
    if (user_id)    { sql += ' AND lb.user_id = ?';                              params.push(parseInt(user_id)); }
    if (area_kerja) { sql += ' AND LOWER(TRIM(u.area_kerja)) = LOWER(TRIM(?))'; params.push(area_kerja); }
  } else if (user.role === 'area_manager') {
    const myArea = getUserArea(user.id).toLowerCase();
    sql += ` AND (lb.user_id = ? OR (LOWER(TRIM(u.area_kerja)) = ? AND u.role IN ('supervisor','marketing')))`;
    params.push(user.id, myArea);
    if (user_id) { sql += ' AND lb.user_id = ?'; params.push(parseInt(user_id)); }
  } else {
    sql += ' AND lb.user_id = ?';
    params.push(user.id);
  }

  if (periode) { sql += ' AND lb.periode = ?'; params.push(periode); }
  sql += ' GROUP BY lb.id ORDER BY lb.periode DESC, u.full_name ASC';

  try {
    const rows = db.prepare(sql).all(...params);
    attachDetails(rows);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/laporan/support-item/:sid/tanggapan  (static prefix, before /:id)
router.post('/support-item/:sid/tanggapan', (req, res) => {
  const user = req.session.user;
  if (!canReview(user.role)) return res.status(403).json({ error: 'Hanya GM1, GM2, dan Admin' });
  const sid = parseInt(req.params.sid);
  if (!sid) return res.status(400).json({ error: 'ID tidak valid' });
  const support = db.prepare('SELECT id FROM laporan_support WHERE id = ?').get(sid);
  if (!support) return res.status(404).json({ error: 'Support item tidak ditemukan' });
  const { tanggapan } = req.body;
  db.prepare(`
    INSERT INTO laporan_support_tanggapan (support_id, reviewer_id, tanggapan)
    VALUES (?, ?, ?)
    ON CONFLICT(support_id, reviewer_id)
    DO UPDATE SET tanggapan=excluded.tanggapan, updated_at=datetime('now','localtime')
  `).run(sid, user.id, tanggapan || '');
  res.json({ success: true, reviewer_name: user.full_name });
});

// POST /api/laporan
router.post('/', (req, res) => {
  const userId = req.session.user.id;
  const { periode, alasan, aktivitas_bulan_ini, rencana_bulan_depan, prognosa_bulan_depan, support, projects } = req.body;

  if (!periode || !/^\d{4}-\d{2}$/.test(periode)) {
    return res.status(400).json({ error: 'Periode tidak valid (format: YYYY-MM)' });
  }

  const upsert = db.transaction(() => {
    let laporan = db.prepare('SELECT id FROM laporan_bulanan WHERE user_id = ? AND periode = ?').get(userId, periode);
    if (laporan) {
      db.prepare(`
        UPDATE laporan_bulanan
        SET alasan=?, aktivitas_bulan_ini=?, rencana_bulan_depan=?,
            prognosa_bulan_depan=?, updated_at=datetime('now','localtime')
        WHERE id=?
      `).run(alasan || '', aktivitas_bulan_ini || '', rencana_bulan_depan || '',
             parseFloat(prognosa_bulan_depan) || 0, laporan.id);
    } else {
      const r = db.prepare(`
        INSERT INTO laporan_bulanan (user_id, periode, alasan, aktivitas_bulan_ini, rencana_bulan_depan, prognosa_bulan_depan)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, periode, alasan || '', aktivitas_bulan_ini || '', rencana_bulan_depan || '',
             parseFloat(prognosa_bulan_depan) || 0);
      laporan = { id: r.lastInsertRowid };
    }

    db.prepare('DELETE FROM laporan_support WHERE laporan_id = ?').run(laporan.id);
    db.prepare('DELETE FROM laporan_project WHERE laporan_id = ?').run(laporan.id);

    const insSupport = db.prepare('INSERT INTO laporan_support (laporan_id, keterangan) VALUES (?, ?)');
    (Array.isArray(support) ? support : []).filter(s => String(s).trim()).forEach(s => insSupport.run(laporan.id, String(s).trim()));

    const insProject = db.prepare(
      'INSERT INTO laporan_project (laporan_id, pelanggan, principal, produk, nilai, probability) VALUES (?, ?, ?, ?, ?, ?)'
    );
    (Array.isArray(projects) ? projects : []).forEach(p => {
      insProject.run(laporan.id, p.pelanggan || '', p.principal || '', p.produk || '',
        parseFloat(p.nilai) || 0, Math.min(100, Math.max(0, parseFloat(p.probability) || 0)));
    });

    return laporan.id;
  });

  try {
    const id = upsert();
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Dynamic routes ────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const user = req.session.user;
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const laporan = getWithChildren(id);
  if (!laporan) return res.status(404).json({ error: 'Tidak ditemukan' });
  if (canSeeAllAreas(user.role)) return res.json(laporan);
  if (user.role === 'area_manager') {
    const myArea = getUserArea(user.id).toLowerCase();
    if (laporan.user_id === user.id || (laporan.area_kerja || '').toLowerCase().trim() === myArea) return res.json(laporan);
    return res.status(403).json({ error: 'Akses ditolak' });
  }
  if (laporan.user_id !== user.id) return res.status(403).json({ error: 'Akses ditolak' });
  res.json(laporan);
});

// POST /api/laporan/:id/tanggapan
router.post('/:id/tanggapan', (req, res) => {
  const user = req.session.user;
  if (!canReview(user.role)) return res.status(403).json({ error: 'Hanya GM1, GM2, dan Admin' });
  const lapId = parseInt(req.params.id);
  if (!lapId) return res.status(400).json({ error: 'ID tidak valid' });
  const laporan = db.prepare('SELECT id FROM laporan_bulanan WHERE id = ?').get(lapId);
  if (!laporan) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  const { tanggapan } = req.body;
  db.prepare(`
    INSERT INTO laporan_tanggapan (laporan_id, reviewer_id, tanggapan)
    VALUES (?, ?, ?)
    ON CONFLICT(laporan_id, reviewer_id)
    DO UPDATE SET tanggapan=excluded.tanggapan, updated_at=datetime('now','localtime')
  `).run(lapId, user.id, tanggapan || '');
  res.json({ success: true, reviewer_name: user.full_name });
});

router.delete('/:id', (req, res) => {
  const user = req.session.user;
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const laporan = db.prepare('SELECT id, user_id FROM laporan_bulanan WHERE id = ?').get(id);
  if (!laporan) return res.status(404).json({ error: 'Tidak ditemukan' });
  if (laporan.user_id !== user.id && user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
  db.prepare('DELETE FROM laporan_bulanan WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
