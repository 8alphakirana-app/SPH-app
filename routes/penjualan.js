const express = require('express');
const router  = express.Router();
const db      = require('../database');
const multer  = require('multer');
const ExcelJS = require('exceljs');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!['admin', 'manager_keuangan'].includes(req.session.user.role)) return res.status(403).json({ error: 'Akses hanya untuk admin / manager keuangan' });
  next();
}

const PUSAT_ROLES = ['admin', 'kantor_pusat', 'gm', 'gm2', 'manager_keuangan', 'direktur_ops', 'direktur_utama'];
const TIDAK_DIPETAKAN = '(Belum Dipetakan)';

function myArea(userId) {
  return (db.prepare('SELECT area_kerja FROM users WHERE id=?').get(userId) || {}).area_kerja || '';
}

// ── Helper: baca header row jadi map nama-kolom -> nomor kolom ──────────────
function readHeaderMap(worksheet) {
  const map = {};
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const name = String(cell.value || '').trim();
    if (name) map[name] = colNumber;
  });
  return map;
}

function cellValue(row, colIdx) {
  if (!colIdx) return null;
  const v = row.getCell(colIdx).value;
  if (v && typeof v === 'object' && 'result' in v) return v.result; // formula cell
  return v;
}

// periode = null bila value kosong/tidak valid (dipakai untuk Invoice Date kosong = belum difaktur)
function toPeriode(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function toDateStr(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ── Helper: map nama salesperson (dari users.full_name) -> area_kerja ──────
function buildSalesAreaMap() {
  const users = db.prepare('SELECT full_name, area_kerja FROM users').all();
  const map = {};
  users.forEach(u => {
    const key = (u.full_name || '').trim().toLowerCase();
    if (key) map[key] = (u.area_kerja || '').trim();
  });
  return map;
}

// ── Helper: map nama salesperson -> area_kerja hasil pemetaan manual (admin) ─
function buildSalespersonMappingMap() {
  const rows = db.prepare('SELECT salesperson, area_kerja FROM salesperson_mapping').all();
  const map = {};
  rows.forEach(r => {
    const key = (r.salesperson || '').trim().toLowerCase();
    if (key) map[key] = (r.area_kerja || '').trim();
  });
  return map;
}

// ── Helper: tentukan area_kerja final untuk 1 salesperson ───────────────────
// Prioritas: 1) salesperson_mapping (manual), 2) users.full_name, 3) '(Belum Dipetakan)'
function resolveArea(salesperson, mappingMap, salesAreaMap, tidakTerpetakan) {
  const key = salesperson.toLowerCase();
  let area = mappingMap[key];
  if (area) return area;

  area = salesAreaMap[key];
  if (area === undefined) {
    if (salesperson) tidakTerpetakan.add(salesperson);
    return TIDAK_DIPETAKAN;
  }
  return area || TIDAK_DIPETAKAN;
}

// ── Helper: rekalkulasi sales_target untuk sekumpulan pasangan (area, periode) ─
// Dipakai bersama oleh upload & pemetaan manual agar konsisten. Hanya menghitung
// dari order yang sudah difaktur (periode NOT NULL); target & pendapatan_lain
// tidak pernah disentuh.
const aggUntukTargetStmt = db.prepare(`
  SELECT SUM(total) as penjualan,
         SUM(total) as difaktur,
         SUM(laba_kotor) as laba_kotor
  FROM penjualan_order WHERE area_kerja=? AND periode=? AND difaktur=1
`);
const upsertTargetStmt = db.prepare(`
  INSERT INTO sales_target (area_kerja, periode, penjualan, difaktur, laba_kotor, updated_at)
  VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
  ON CONFLICT(area_kerja, periode)
  DO UPDATE SET penjualan=excluded.penjualan, difaktur=excluded.difaktur, laba_kotor=excluded.laba_kotor, updated_at=excluded.updated_at
`);
function recalcSalesTarget(areaPeriodePairs) {
  areaPeriodePairs.forEach(function (pair) {
    const agg = aggUntukTargetStmt.get(pair.area, pair.periode);
    upsertTargetStmt.run(pair.area, pair.periode, agg.penjualan || 0, agg.difaktur || 0, agg.laba_kotor || 0);
  });
}

// ── Helper: kumpulkan pasangan (area, periode) yang sedang dipakai 1 salesperson ─
function pairsUntukSalesperson(salesperson, out) {
  db.prepare('SELECT DISTINCT area_kerja, periode FROM penjualan_order WHERE salesperson=? AND periode IS NOT NULL')
    .all(salesperson)
    .forEach(r => out.set(r.area_kerja + '::' + r.periode, { area: r.area_kerja, periode: r.periode }));
}

// ── POST /api/penjualan/upload ──────────────────────────────────────────────
router.post('/upload', requireLogin, requireAdmin, upload.fields([
  { name: 'file_order', maxCount: 1 },
  { name: 'file_report', maxCount: 1 },
]), async (req, res) => {
  const fileOrder  = req.files?.file_order?.[0];
  const fileReport = req.files?.file_report?.[0];
  if (!fileOrder) return res.status(400).json({ error: 'File Sales Order wajib diupload' });

  try {
    // ── Parse File A: Sales Order ─────────────────────────────────────────
    const wbA = new ExcelJS.Workbook();
    await wbA.xlsx.load(fileOrder.buffer);
    const wsA = wbA.worksheets[0];
    const colA = readHeaderMap(wsA);
    const wajibA = ['Order Reference', 'Order Date', 'Customer', 'Salesperson', 'Total', 'Invoice Status', 'Invoice Date'];
    const missingA = wajibA.filter(c => !colA[c]);
    if (missingA.length) return res.status(400).json({ error: `Kolom wajib tidak ditemukan di File Sales Order: ${missingA.join(', ')}` });

    // ── Parse File B (opsional): Sales Analysis Report ────────────────────
    // Join pakai 'Order Reference' + 'Customer' (bukan Order Reference saja),
    // karena pada data sumber 'Order Reference' TIDAK selalu unik antar order
    // yang berbeda — join hanya by reference akan mencampur Gross Margin dua order.
    const gmByOrder = {};
    if (fileReport) {
      const wbB = new ExcelJS.Workbook();
      await wbB.xlsx.load(fileReport.buffer);
      const wsB = wbB.worksheets[0];
      const colB = readHeaderMap(wsB);
      const wajibB = ['Order Reference', 'Customer', 'Gross Margin'];
      const missingB = wajibB.filter(c => !colB[c]);
      if (missingB.length) return res.status(400).json({ error: `Kolom wajib tidak ditemukan di File Sales Report: ${missingB.join(', ')}` });

      for (let i = 2; i <= wsB.rowCount; i++) {
        const row = wsB.getRow(i);
        const ref = String(cellValue(row, colB['Order Reference']) || '').trim();
        if (!ref) continue;
        const customer = String(cellValue(row, colB['Customer']) || '').trim().toLowerCase();
        const gm = Number(cellValue(row, colB['Gross Margin'])) || 0;
        const key = ref + '||' + customer;
        gmByOrder[key] = (gmByOrder[key] || 0) + gm;
      }
    }

    // ── Gabungkan & mapping area kerja ─────────────────────────────────────
    const salesAreaMap = buildSalesAreaMap();
    const mappingMap = buildSalespersonMappingMap();
    const tidakTerpetakan = new Set();
    const orders = [];

    for (let i = 2; i <= wsA.rowCount; i++) {
      const row = wsA.getRow(i);
      const ref = String(cellValue(row, colA['Order Reference']) || '').trim();
      if (!ref) continue;

      const orderDateRaw   = cellValue(row, colA['Order Date']);
      const invoiceDateRaw = cellValue(row, colA['Invoice Date']);
      const customer       = String(cellValue(row, colA['Customer']) || '').trim();
      const salesperson    = String(cellValue(row, colA['Salesperson']) || '').trim();
      const total          = Number(cellValue(row, colA['Total'])) || 0;
      const invoiceStatus  = String(cellValue(row, colA['Invoice Status']) || '').trim();
      const difaktur       = invoiceDateRaw ? 1 : 0; // periode by Invoice Date; kosong = belum difaktur

      const area = resolveArea(salesperson, mappingMap, salesAreaMap, tidakTerpetakan);

      const gmKey = ref + '||' + customer.toLowerCase();
      orders.push({
        order_reference: ref,
        order_date: toDateStr(orderDateRaw),
        invoice_date: toDateStr(invoiceDateRaw),
        periode: difaktur ? toPeriode(invoiceDateRaw) : null,
        customer,
        salesperson,
        area_kerja: area,
        total,
        invoice_status: invoiceStatus,
        laba_kotor: gmByOrder[gmKey] || 0,
        difaktur,
      });
    }

    if (!orders.length) return res.status(400).json({ error: 'Tidak ada baris data yang valid di File Sales Order' });

    // ── Simpan ke penjualan_order & rekalkulasi sales_target (transaksi) ───
    // Idempotensi re-upload: setiap order (kunci Order Reference + Customer,
    // karena Order Reference sendiri tidak selalu unik) dihapus dulu sebelum
    // diinsert ulang, sehingga hanya order yang ada di file ini yang tersentuh
    // — periode/area lain yang tidak ada di file ini tidak berubah.
    const findExisting = db.prepare('SELECT area_kerja, periode FROM penjualan_order WHERE order_reference=? AND customer=?');
    const deleteByKey  = db.prepare('DELETE FROM penjualan_order WHERE order_reference=? AND customer=?');
    const insertOrder = db.prepare(`
      INSERT INTO penjualan_order (order_reference, order_date, invoice_date, periode, customer, salesperson, area_kerja, total, invoice_status, laba_kotor, difaktur, uploaded_by, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `);

    const periodeTerpengaruh = new Set();
    const areaPeriodePairs = new Map(); // key unik -> {area, periode}
    let jumlahDifaktur = 0, jumlahBelumDifaktur = 0;

    const txn = db.transaction(() => {
      orders.forEach(o => {
        // Tangkap area+periode lama SEBELUM dihapus, supaya jika order ini pindah
        // periode (mis. baru difaktur) atau area, bucket lama ikut direkalkulasi.
        findExisting.all(o.order_reference, o.customer).forEach(old => {
          if (old.periode) areaPeriodePairs.set(old.area_kerja + '::' + old.periode, { area: old.area_kerja, periode: old.periode });
        });
        deleteByKey.run(o.order_reference, o.customer);
        insertOrder.run(o.order_reference, o.order_date, o.invoice_date, o.periode, o.customer, o.salesperson, o.area_kerja, o.total, o.invoice_status, o.laba_kotor, o.difaktur, req.session.user.id);

        if (o.difaktur) { jumlahDifaktur++; } else { jumlahBelumDifaktur++; }
        if (o.periode) {
          periodeTerpengaruh.add(o.periode);
          areaPeriodePairs.set(o.area_kerja + '::' + o.periode, { area: o.area_kerja, periode: o.periode });
        }
      });

      recalcSalesTarget(areaPeriodePairs);
    });
    txn();

    res.json({
      success: true,
      orders_diproses: orders.length,
      difaktur: jumlahDifaktur,
      belum_difaktur: jumlahBelumDifaktur,
      periode_terpengaruh: Array.from(periodeTerpengaruh).sort(),
      salesperson_tidak_terpetakan: Array.from(tidakTerpetakan).sort(),
    });
  } catch (e) {
    console.error('Upload penjualan error:', e);
    res.status(500).json({ error: 'Gagal memproses file: ' + e.message });
  }
});

// ── GET /api/penjualan?periode=YYYY-MM ──────────────────────────────────────
router.get('/', requireLogin, (req, res) => {
  const { periode } = req.query;
  if (!periode) return res.status(400).json({ error: 'Parameter periode diperlukan' });

  const user = req.session.user;
  let rows;
  if (PUSAT_ROLES.includes(user.role)) {
    rows = db.prepare('SELECT * FROM penjualan_order WHERE periode=? ORDER BY area_kerja, order_reference').all(periode);
  } else {
    rows = db.prepare('SELECT * FROM penjualan_order WHERE periode=? AND area_kerja=? ORDER BY order_reference').all(periode, myArea(user.id));
  }
  res.json(rows);
});

// ── GET /api/penjualan/summary?periode=YYYY-MM ──────────────────────────────
router.get('/summary', requireLogin, (req, res) => {
  const { periode } = req.query;
  if (!periode) return res.status(400).json({ error: 'Parameter periode diperlukan' });

  const user = req.session.user;
  let rows;
  if (PUSAT_ROLES.includes(user.role)) {
    rows = db.prepare('SELECT area_kerja, penjualan as total_penjualan, difaktur, laba_kotor, target FROM sales_target WHERE periode=? ORDER BY area_kerja').all(periode);
  } else {
    rows = db.prepare('SELECT area_kerja, penjualan as total_penjualan, difaktur, laba_kotor, target FROM sales_target WHERE periode=? AND area_kerja=?').all(periode, myArea(user.id));
  }
  res.json(rows);
});

// ── GET /api/penjualan/outstanding — order yang belum difaktur, per area ────
router.get('/outstanding', requireLogin, (req, res) => {
  const user = req.session.user;
  let rows;
  if (PUSAT_ROLES.includes(user.role)) {
    rows = db.prepare(`
      SELECT area_kerja, COUNT(*) as jumlah_order, SUM(total) as total
      FROM penjualan_order WHERE periode IS NULL GROUP BY area_kerja ORDER BY area_kerja
    `).all();
  } else {
    rows = db.prepare(`
      SELECT area_kerja, COUNT(*) as jumlah_order, SUM(total) as total
      FROM penjualan_order WHERE periode IS NULL AND area_kerja=? GROUP BY area_kerja
    `).all(myArea(user.id));
  }
  const total = rows.reduce((s, r) => s + (r.total || 0), 0);
  const jumlah_order = rows.reduce((s, r) => s + (r.jumlah_order || 0), 0);
  res.json({ rows, total, jumlah_order });
});

// ── GET /api/penjualan/unmapped — salesperson yang area-nya '(Belum Dipetakan)' ─
router.get('/unmapped', requireLogin, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT salesperson, COUNT(*) as jumlah_order, SUM(total) as total
    FROM penjualan_order WHERE area_kerja=? GROUP BY salesperson ORDER BY salesperson
  `).all(TIDAK_DIPETAKAN);
  res.json(rows);
});

// ── GET /api/penjualan/mapping — daftar pemetaan manual + daftar user ───────
router.get('/mapping', requireLogin, requireAdmin, (req, res) => {
  const mapping = db.prepare('SELECT * FROM salesperson_mapping ORDER BY salesperson').all();
  const users = db.prepare('SELECT id, full_name, area_kerja FROM users ORDER BY full_name').all();
  res.json({ mapping, users });
});

// ── POST /api/penjualan/mapping — simpan pemetaan 1 salesperson ────────────
router.post('/mapping', requireLogin, requireAdmin, (req, res) => {
  const salesperson = String(req.body.salesperson || '').trim();
  const { user_id } = req.body;
  const areaKerjaInput = String(req.body.area_kerja || '').trim();
  if (!salesperson) return res.status(400).json({ error: 'Salesperson wajib diisi' });
  if (!user_id && !areaKerjaInput) return res.status(400).json({ error: 'Pilih salah satu: Akun atau Area Kerja' });

  let areaFinal = areaKerjaInput;
  if (user_id) {
    const u = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(user_id);
    if (!u) return res.status(400).json({ error: 'Akun tidak ditemukan' });
    areaFinal = (u.area_kerja || '').trim();
    if (!areaFinal) return res.status(400).json({ error: 'Akun tersebut belum memiliki area kerja' });
  }

  try {
    const txn = db.transaction(() => {
      db.prepare(`
        INSERT INTO salesperson_mapping (salesperson, user_id, area_kerja, updated_by, updated_at)
        VALUES (?, ?, ?, ?, datetime('now','localtime'))
        ON CONFLICT(salesperson) DO UPDATE SET user_id=excluded.user_id, area_kerja=excluded.area_kerja, updated_by=excluded.updated_by, updated_at=excluded.updated_at
      `).run(salesperson, user_id || null, areaFinal, req.session.user.id);

      // Kumpulkan periode terdampak SEBELUM & SESUDAH re-tag (area lama & baru)
      const pairs = new Map();
      pairsUntukSalesperson(salesperson, pairs);
      db.prepare('UPDATE penjualan_order SET area_kerja=? WHERE salesperson=?').run(areaFinal, salesperson);
      pairsUntukSalesperson(salesperson, pairs);

      recalcSalesTarget(pairs);
    });
    txn();
    res.json({ success: true, area_kerja: areaFinal });
  } catch (e) {
    res.status(500).json({ error: 'Gagal menyimpan pemetaan: ' + e.message });
  }
});

// ── DELETE /api/penjualan/mapping/:salesperson — hapus pemetaan manual ─────
router.delete('/mapping/:salesperson', requireLogin, requireAdmin, (req, res) => {
  const salesperson = String(req.params.salesperson || '').trim();
  if (!salesperson) return res.status(400).json({ error: 'Salesperson tidak valid' });

  try {
    const txn = db.transaction(() => {
      db.prepare('DELETE FROM salesperson_mapping WHERE salesperson=?').run(salesperson);

      const pairs = new Map();
      pairsUntukSalesperson(salesperson, pairs);

      // Re-resolve area tanpa pemetaan manual: fallback ke users.full_name atau '(Belum Dipetakan)'
      const salesAreaMap = buildSalesAreaMap();
      const key = salesperson.toLowerCase();
      const area = salesAreaMap[key] || TIDAK_DIPETAKAN;
      db.prepare('UPDATE penjualan_order SET area_kerja=? WHERE salesperson=?').run(area, salesperson);
      pairsUntukSalesperson(salesperson, pairs);

      recalcSalesTarget(pairs);
    });
    txn();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Gagal menghapus pemetaan: ' + e.message });
  }
});

module.exports = router;
