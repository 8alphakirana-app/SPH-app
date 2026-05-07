const express = require('express');
const router  = express.Router();
const db      = require('../database');

const LEVEL_ROLES  = { 1: 'gm', 2: 'manager_keuangan', 3: 'direktur_ops', 4: 'direktur_utama' };
const ROLE_LEVELS  = { gm: 1, manager_keuangan: 2, direktur_ops: 3, direktur_utama: 4 };
const LEVEL_LABELS = { 1: 'GM', 2: 'Manager Keuangan', 3: 'Direktur Operasional', 4: 'Direktur Utama' };

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Belum login' });
  next();
}

function calcKK(kk) {
  const nkt = parseFloat(kk.nilai_kontrak_total) || 0;
  const np  = parseFloat(kk.nilai_pembyr)         || 0;
  const bdo = parseFloat(kk.b_distribusi_ongkir)  || 0;

  const dppKontrak     = nkt / 1.11;
  const ppnKontrak     = dppKontrak * 0.11;
  const pphKontrak     = dppKontrak * 0.015;
  const penerimaanUang = nkt - (ppnKontrak + pphKontrak);

  const dppBeli = np / 1.11;
  const ppnBeli = dppBeli * 0.11;
  const pphBeli = dppBeli * 0.015;

  const surplusDefisit = penerimaanUang - (dppBeli + ppnBeli + pphBeli + bdo);
  const laba           = dppKontrak - dppBeli - bdo;
  const netMargin      = dppKontrak > 0 ? (laba / dppKontrak) * 100 : 0;

  return { dppKontrak, ppnKontrak, pphKontrak, penerimaanUang, dppBeli, ppnBeli, pphBeli, surplusDefisit, laba, netMargin };
}

// ── POST /api/kk ─────────────────────────────────────────────────────────────
router.post('/', requireLogin, (req, res) => {
  const {
    nama_pekerjaan, nomor_surat, perihal, satker, prinsipal, nama_barang,
    pelanggan, nilai_kontrak_total, nilai_pembyr, b_distribusi_ongkir,
    term_payment_supplier, term_payment_pelanggan, sumber_anggaran, notes
  } = req.body;

  if (!nama_pekerjaan || !pelanggan) {
    return res.status(400).json({ error: 'Nama pekerjaan dan pelanggan wajib diisi' });
  }

  const subResult = db.prepare(`
    INSERT INTO submissions
      (client_title, client_name, client_address, client_city, items,
       ppn_included, ongkir_included, notes, lampiran, created_by,
       submission_type, kk_approval_level, status)
    VALUES ('', ?, '', 'di Tempat', '[]', 0, 0, ?, '', ?, 'kk', 1, 'pending')
  `).run(pelanggan, notes || '', req.session.user.id);

  const submissionId = subResult.lastInsertRowid;

  db.prepare(`
    INSERT INTO kertas_kerja
      (submission_id, nama_pekerjaan, nomor_surat, perihal, satker, prinsipal,
       nama_barang, pelanggan, nilai_kontrak_total, nilai_pembyr,
       b_distribusi_ongkir, term_payment_supplier, term_payment_pelanggan, sumber_anggaran)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    submissionId, nama_pekerjaan, nomor_surat || '', perihal || '',
    satker || '', prinsipal || '', nama_barang || '', pelanggan,
    parseFloat(nilai_kontrak_total) || 0, parseFloat(nilai_pembyr) || 0,
    parseFloat(b_distribusi_ongkir) || 0,
    term_payment_supplier || '', term_payment_pelanggan || '', sumber_anggaran || ''
  );

  for (let level = 1; level <= 4; level++) {
    db.prepare("INSERT INTO kk_approvals (submission_id, level, status) VALUES (?, ?, 'pending')").run(submissionId, level);
  }

  res.json({ success: true, id: submissionId });
});

// ── GET /api/kk ──────────────────────────────────────────────────────────────
router.get('/', requireLogin, (req, res) => {
  const user = req.session.user;
  let rows;

  const base = `
    SELECT s.id, s.status, s.kk_approval_level, s.created_at, s.created_by, s.reject_reason,
           kk.nama_pekerjaan, kk.pelanggan, kk.nilai_kontrak_total, kk.nilai_pembyr, kk.b_distribusi_ongkir,
           kk.nomor_surat, kk.perihal, kk.satker, kk.prinsipal, kk.nama_barang,
           kk.term_payment_supplier, kk.term_payment_pelanggan, kk.sumber_anggaran,
           u.full_name as creator_name
    FROM submissions s
    JOIN kertas_kerja kk ON kk.submission_id = s.id
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.submission_type = 'kk'
  `;

  if (user.role === 'admin' || user.role === 'direktur_utama') {
    rows = db.prepare(base + ' ORDER BY s.created_at DESC').all();
  } else if (ROLE_LEVELS[user.role]) {
    const myLevel = ROLE_LEVELS[user.role];
    rows = db.prepare(base + `
      AND (s.kk_approval_level = ? OR s.status != 'pending'
           OR EXISTS (SELECT 1 FROM kk_approvals a WHERE a.submission_id=s.id AND a.level=? AND a.approver_user_id=?))
      ORDER BY s.created_at DESC
    `).all(myLevel, myLevel, user.id);
  } else {
    rows = db.prepare(base + ' AND s.created_by = ? ORDER BY s.created_at DESC').all(user.id);
  }

  res.json(rows.map(r => ({ ...r, calc: calcKK(r) })));
});

// ── GET /api/kk/:id ───────────────────────────────────────────────────────────
router.get('/:id', requireLogin, (req, res) => {
  const user = req.session.user;
  const row  = db.prepare(`
    SELECT s.*, kk.*, u.full_name as creator_name
    FROM submissions s
    JOIN kertas_kerja kk ON kk.submission_id = s.id
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.id = ? AND s.submission_type = 'kk'
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'KK tidak ditemukan' });
  if (user.role === 'staff' && row.created_by !== user.id) return res.status(403).json({ error: 'Akses ditolak' });

  const approvals = db.prepare(`
    SELECT a.*, u.full_name as approver_name
    FROM kk_approvals a LEFT JOIN users u ON a.approver_user_id = u.id
    WHERE a.submission_id = ? ORDER BY a.level ASC
  `).all(req.params.id);

  res.json({ ...row, items: [], calc: calcKK(row), approvals });
});

// ── PUT /api/kk/:id  (edit KK yg masih pending level 1) ──────────────────────
router.put('/:id', requireLogin, (req, res) => {
  const user = req.session.user;
  const sub  = db.prepare("SELECT * FROM submissions WHERE id=? AND submission_type='kk'").get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'KK tidak ditemukan' });
  if (sub.status !== 'pending') return res.status(400).json({ error: 'Hanya KK pending yang dapat diedit' });
  if (user.role !== 'admin' && sub.created_by !== user.id) return res.status(403).json({ error: 'Akses ditolak' });

  const {
    nama_pekerjaan, nomor_surat, perihal, satker, prinsipal, nama_barang,
    pelanggan, nilai_kontrak_total, nilai_pembyr, b_distribusi_ongkir,
    term_payment_supplier, term_payment_pelanggan, sumber_anggaran, notes
  } = req.body;

  if (!nama_pekerjaan || !pelanggan) return res.status(400).json({ error: 'Nama pekerjaan dan pelanggan wajib diisi' });

  db.prepare('UPDATE submissions SET client_name=?, notes=? WHERE id=?').run(pelanggan, notes || '', req.params.id);
  db.prepare(`
    UPDATE kertas_kerja SET
      nama_pekerjaan=?, nomor_surat=?, perihal=?, satker=?, prinsipal=?, nama_barang=?,
      pelanggan=?, nilai_kontrak_total=?, nilai_pembyr=?, b_distribusi_ongkir=?,
      term_payment_supplier=?, term_payment_pelanggan=?, sumber_anggaran=?
    WHERE submission_id=?
  `).run(
    nama_pekerjaan, nomor_surat || '', perihal || '', satker || '', prinsipal || '', nama_barang || '',
    pelanggan, parseFloat(nilai_kontrak_total)||0, parseFloat(nilai_pembyr)||0, parseFloat(b_distribusi_ongkir)||0,
    term_payment_supplier||'', term_payment_pelanggan||'', sumber_anggaran||'', req.params.id
  );

  res.json({ success: true });
});

// ── DELETE /api/kk/:id ────────────────────────────────────────────────────────
router.delete('/:id', requireLogin, (req, res) => {
  const user = req.session.user;
  const sub  = db.prepare("SELECT * FROM submissions WHERE id=? AND submission_type='kk'").get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'KK tidak ditemukan' });
  if (sub.status !== 'pending') return res.status(400).json({ error: 'Hanya KK pending yang dapat dihapus' });
  if (user.role !== 'admin' && sub.created_by !== user.id) return res.status(403).json({ error: 'Akses ditolak' });

  db.prepare('DELETE FROM kk_approvals WHERE submission_id=?').run(req.params.id);
  db.prepare('DELETE FROM kertas_kerja WHERE submission_id=?').run(req.params.id);
  db.prepare('DELETE FROM submissions WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── POST /api/kk/:id/approve ──────────────────────────────────────────────────
router.post('/:id/approve', requireLogin, (req, res) => {
  const user = req.session.user;
  const { note } = req.body;
  const sub = db.prepare("SELECT * FROM submissions WHERE id=? AND submission_type='kk'").get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'KK tidak ditemukan' });
  if (sub.status !== 'pending') return res.status(400).json({ error: 'KK sudah diproses' });

  const currentLevel = sub.kk_approval_level;
  if (LEVEL_ROLES[currentLevel] !== user.role) {
    return res.status(403).json({ error: `Anda tidak berwenang approve level ${currentLevel} (${LEVEL_LABELS[currentLevel]})` });
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE kk_approvals SET status='approved', approver_user_id=?, note=?, acted_at=? WHERE submission_id=? AND level=?")
    .run(user.id, note || '', now, req.params.id, currentLevel);

  if (currentLevel < 4) {
    db.prepare('UPDATE submissions SET kk_approval_level=? WHERE id=?').run(currentLevel + 1, req.params.id);
  } else {
    db.prepare("UPDATE submissions SET status='approved', kk_approval_level=5, approved_by=?, approved_at=? WHERE id=?")
      .run(user.id, now, req.params.id);
  }

  res.json({ success: true, nextLevel: currentLevel < 4 ? currentLevel + 1 : null });
});

// ── POST /api/kk/:id/reject ───────────────────────────────────────────────────
router.post('/:id/reject', requireLogin, (req, res) => {
  const user = req.session.user;
  const { note } = req.body;
  const sub = db.prepare("SELECT * FROM submissions WHERE id=? AND submission_type='kk'").get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'KK tidak ditemukan' });
  if (sub.status !== 'pending') return res.status(400).json({ error: 'KK sudah diproses' });

  const currentLevel = sub.kk_approval_level;
  if (LEVEL_ROLES[currentLevel] !== user.role) {
    return res.status(403).json({ error: `Anda tidak berwenang reject level ${currentLevel}` });
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE kk_approvals SET status='rejected', approver_user_id=?, note=?, acted_at=? WHERE submission_id=? AND level=?")
    .run(user.id, note || '', now, req.params.id, currentLevel);
  db.prepare("UPDATE submissions SET status='rejected', reject_reason=? WHERE id=?").run(note || 'Ditolak', req.params.id);

  res.json({ success: true });
});

// ── GET /api/kk/:id/export-excel ─────────────────────────────────────────────
router.get('/:id/export-excel', requireLogin, async (req, res) => {
  const row = db.prepare(`
    SELECT s.*, kk.*, u.full_name as creator_name
    FROM submissions s
    JOIN kertas_kerja kk ON kk.submission_id = s.id
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.id = ? AND s.submission_type = 'kk'
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'KK tidak ditemukan' });

  const user = req.session.user;
  if (user.role === 'staff' && row.created_by !== user.id) return res.status(403).json({ error: 'Akses ditolak' });

  const approvals = db.prepare(`
    SELECT a.*, u.full_name as approver_name
    FROM kk_approvals a LEFT JOIN users u ON a.approver_user_id = u.id
    WHERE a.submission_id = ? ORDER BY a.level ASC
  `).all(req.params.id);

  const settings = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(s => { settings[s.key] = s.value; });

  try {
    const buffer = await generateExcel(row, calcKK(row), approvals, settings);
    const safeName = (row.nama_pekerjaan || 'KK').replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="KK_${safeName}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Excel error:', err);
    res.status(500).json({ error: 'Gagal generate Excel: ' + err.message });
  }
});

// ── Excel generator ───────────────────────────────────────────────────────────
async function generateExcel(row, calc, approvals, settings) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Kertas Kerja');

  const COLS = 15; // A..O
  const lastCol = 'O';

  ws.columns = [
    { width: 4  }, // A No
    { width: 28 }, // B Pelanggan
    { width: 18 }, // C Total Kontrak
    { width: 18 }, // D DPP
    { width: 15 }, // E PPN 11%
    { width: 15 }, // F PPh 1.5%
    { width: 18 }, // G Penerimaan Uang
    { width: 18 }, // H DPP Beli
    { width: 15 }, // I PPN 11% Beli
    { width: 18 }, // J Nilai Pembyr
    { width: 15 }, // K PPh 1.5% Beli
    { width: 18 }, // L B.Dist & Ongkir
    { width: 18 }, // M Surplus/Defisit
    { width: 15 }, // N Laba
    { width: 13 }, // O Net Margin %
  ];

  const orangeFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
  const darkBlue   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  const midBlue    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const centerMid = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const rightMid  = { horizontal: 'right',  vertical: 'middle' };

  // ── Row 1: Title ─────────────────────────────────────────────────────────
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell('A1');
  t.value = 'KERTAS KERJA';
  t.font  = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  t.fill  = darkBlue;
  t.alignment = centerMid;
  ws.getRow(1).height = 32;

  // ── Row 2: sub-title (company name) ─────────────────────────────────────
  ws.mergeCells(`A2:${lastCol}2`);
  const t2 = ws.getCell('A2');
  t2.value     = settings.company_name || 'PT. Lapan Alpha Kirana';
  t2.font      = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  t2.fill      = midBlue;
  t2.alignment = centerMid;
  ws.getRow(2).height = 20;

  // ── Row 3: empty ─────────────────────────────────────────────────────────
  ws.addRow([]);

  // ── Rows 4-9: Info block ─────────────────────────────────────────────────
  const infoData = [
    ['Nama Pekerjaan', row.nama_pekerjaan],
    ['Nomor Surat',    row.nomor_surat],
    ['Perihal',        row.perihal],
    ['Satker',         row.satker],
    ['Prinsipal',      row.prinsipal],
    ['Nama Barang',    row.nama_barang],
  ];

  let r = 4;
  for (const [label, value] of infoData) {
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).value = ':';
    ws.mergeCells(`C${r}:${lastCol}${r}`);
    const vc = ws.getCell(`C${r}`);
    vc.value = value || '';
    vc.fill  = orangeFill;
    r++;
  }

  // ── Row 10: empty ────────────────────────────────────────────────────────
  ws.addRow([]);

  // ── Rows 11-12: Table header ─────────────────────────────────────────────
  const h1 = ws.getRow(11);
  const header1 = [
    ['A11:A12', 'No'],
    ['B11:B12', 'Pelanggan'],
    ['C11:F11', 'Nilai Kontrak'],
    ['G11:G12', 'Penerimaan\nUang'],
    ['H11:K11', 'Pembelian'],
    ['L11:L12', 'B.Distribusi\n& Ongkir'],
    ['M11:M12', 'Surplus /\nDefisit'],
    ['N11:N12', 'Laba'],
    ['O11:O12', 'Net\nMargin %'],
  ];
  header1.forEach(([range, val]) => {
    ws.mergeCells(range);
    const startCell = range.split(':')[0];
    const c = ws.getCell(startCell);
    c.value     = val;
    c.font      = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    c.fill      = darkBlue;
    c.alignment = centerMid;
    c.border    = border;
  });
  ws.getRow(11).height = 30;

  const h2 = ws.getRow(12);
  [
    ['C', 'Total'],
    ['D', 'DPP'],
    ['E', 'PPN 11%'],
    ['F', 'PPh 1,5%'],
    ['H', 'DPP'],
    ['I', 'PPN 11%'],
    ['J', 'Nilai\nPembyr'],
    ['K', 'PPh 1,5%'],
  ].forEach(([col, val]) => {
    const c = ws.getCell(`${col}12`);
    c.value     = val;
    c.font      = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    c.fill      = midBlue;
    c.alignment = centerMid;
    c.border    = border;
  });
  ws.getRow(12).height = 28;

  // ── Row 13: Data ─────────────────────────────────────────────────────────
  const dr = ws.getRow(13);
  const numFmt = '#,##0';
  const vals = [
    [1,  1,            null],
    [2,  row.pelanggan, null],
    [3,  row.nilai_kontrak_total, numFmt],
    [4,  Math.round(calc.dppKontrak),     numFmt],
    [5,  Math.round(calc.ppnKontrak),     numFmt],
    [6,  Math.round(calc.pphKontrak),     numFmt],
    [7,  Math.round(calc.penerimaanUang), numFmt],
    [8,  Math.round(calc.dppBeli),        numFmt],
    [9,  Math.round(calc.ppnBeli),        numFmt],
    [10, row.nilai_pembyr,                numFmt],
    [11, Math.round(calc.pphBeli),        numFmt],
    [12, row.b_distribusi_ongkir,         numFmt],
    [13, Math.round(calc.surplusDefisit), numFmt],
    [14, Math.round(calc.laba),           numFmt],
    [15, parseFloat(calc.netMargin.toFixed(2)), '0.00"%"'],
  ];
  vals.forEach(([col, val, fmt]) => {
    const c = dr.getCell(col);
    c.value  = val;
    c.border = border;
    c.alignment = col <= 2 ? (col === 1 ? centerMid : { vertical: 'middle' }) : rightMid;
    if (fmt) c.numFmt = fmt;
  });
  dr.height = 20;

  // ── Row 14: empty ────────────────────────────────────────────────────────
  ws.addRow([]);

  // ── Rows 15-17: Footer info ───────────────────────────────────────────────
  const footerData = [
    ['Term of Payment Supplier',  row.term_payment_supplier],
    ['Term of Payment Pelanggan', row.term_payment_pelanggan],
    ['Sumber Anggaran',           row.sumber_anggaran],
  ];
  let fr = 15;
  for (const [label, value] of footerData) {
    ws.getCell(`A${fr}`).value = label;
    ws.getCell(`A${fr}`).font = { bold: true };
    ws.mergeCells(`A${fr}:B${fr}`);
    ws.getCell(`C${fr}`).value = ':';
    ws.mergeCells(`D${fr}:${lastCol}${fr}`);
    ws.getCell(`D${fr}`).value = value || '';
    fr++;
  }

  // ── Rows 18-19: empty ─────────────────────────────────────────────────────
  ws.addRow([]); // 18
  ws.addRow([]); // 19

  // ── Rows 20-25: Signature block ───────────────────────────────────────────
  const approvalLevel4 = approvals.find(a => a.level === 4 && a.status === 'approved');
  const dateStr = approvalLevel4
    ? new Date(approvalLevel4.acted_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  const city = settings.company_city || 'Jakarta';

  // 5 signature blocks across 15 columns (3 cols each)
  const sigCols    = ['A', 'D', 'G', 'J', 'M'];
  const sigEndCols = ['C', 'F', 'I', 'L', 'O'];
  const sigTitles  = ['Yang Mengajukan', 'Mengetahui', 'Mengetahui', 'Mengetahui', 'Menyetujui'];
  const sigRoles   = ['Area Manager', 'GM', 'Manager Keuangan', 'Dir. Operasional', 'Direktur Utama'];
  const sigNames   = [
    row.creator_name || '-',
    approvals.find(a => a.level === 1)?.approver_name || '( _____________ )',
    approvals.find(a => a.level === 2)?.approver_name || '( _____________ )',
    approvals.find(a => a.level === 3)?.approver_name || '( _____________ )',
    approvals.find(a => a.level === 4)?.approver_name || '( _____________ )',
  ];

  for (let i = 0; i < 5; i++) {
    const sc = sigCols[i]; const ec = sigEndCols[i];

    ws.mergeCells(`${sc}20:${ec}20`);
    ws.getCell(`${sc}20`).value     = i === 0 ? `${city}, ${dateStr}` : ' ';
    ws.getCell(`${sc}20`).alignment = centerMid;

    ws.mergeCells(`${sc}21:${ec}21`);
    ws.getCell(`${sc}21`).value     = sigTitles[i];
    ws.getCell(`${sc}21`).font      = { bold: true };
    ws.getCell(`${sc}21`).alignment = centerMid;

    // Space rows 22-23
    ws.mergeCells(`${sc}22:${ec}23`);
    ws.getRow(22).height = 36;

    ws.mergeCells(`${sc}24:${ec}24`);
    ws.getCell(`${sc}24`).value     = sigNames[i];
    ws.getCell(`${sc}24`).font      = { bold: true };
    ws.getCell(`${sc}24`).alignment = centerMid;

    ws.mergeCells(`${sc}25:${ec}25`);
    ws.getCell(`${sc}25`).value     = sigRoles[i];
    ws.getCell(`${sc}25`).alignment = centerMid;
    ws.getCell(`${sc}25`).font      = { italic: true, size: 9 };
  }

  return wb.xlsx.writeBuffer();
}

module.exports = router;
