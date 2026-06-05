const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// ── Middleware ────────────────────────────────────────────────────────────────
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.use(requireLogin);

// ── Approval level definitions ────────────────────────────────────────────────
// SPPD: sppd_approval_level=0 waiting AM, 1=AM done waiting GM1+GM2, 2=all approved
const SPPD_APPROVER_ROLES = ['area_manager', 'gm', 'gm2'];

// Laporan/Pencairan: 6-level same as KK
const LAPORAN_LEVEL_ROLES   = { 1:'area_manager', 2:'manager_keuangan', 3:'gm', 4:'gm2', 5:'direktur_ops', 6:'direktur_utama' };
const PENCAIRAN_LEVEL_ROLES = { 1:'area_manager', 2:'manager_keuangan', 3:'gm', 4:'gm2', 5:'direktur_ops', 6:'direktur_utama' };
const LP_MAX = 6;

function canSeeAll(role) {
  return ['admin', 'kantor_pusat', 'gm', 'gm2', 'manager_keuangan', 'direktur_ops', 'direktur_utama'].includes(role);
}

// ── Helper: check/advance parallel GM stage for laporan/pencairan ─────────────
function checkGmParallel(table, idCol, id) {
  // Returns nextLevel after GM stage: 5 if both gm(3) and gm2(4) approved, else 3
  const gm1 = db.prepare(`SELECT status FROM ${table} WHERE ${idCol}=? AND level=3`).get(id);
  const gm2 = db.prepare(`SELECT status FROM ${table} WHERE ${idCol}=? AND level=4`).get(id);
  return (gm1?.status === 'approved' && gm2?.status === 'approved') ? 5 : 3;
}

function generateNomorSppd(area) {
  const now = new Date();
  const year = now.getFullYear();
  const romanMonth = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][now.getMonth()];
  const areaStr = (area || 'Pusat').trim();
  const count = db.prepare(`SELECT COUNT(*) as cnt FROM sppd WHERE nomor LIKE ? AND nomor NOT LIKE 'DRAFT-%'`).get(`%/SPPD/%/${year}`).cnt;
  return `${String(count + 1).padStart(3, '0')}/SPPD/${areaStr}/${romanMonth}/${year}`;
}

// ── TTD upload setup ──────────────────────────────────────────────────────────
const ttdUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ────────────────────────────────────────────────────────────────────────────
// Routes with static paths MUST come before /:id to avoid Express conflicts
// ────────────────────────────────────────────────────────────────────────────

// ── Profile ───────────────────────────────────────────────────────────────────
router.get('/profile', (req, res) => {
  const user = db.prepare('SELECT id, username, full_name, role, area_kerja, jabatan_detail FROM users WHERE id = ?')
    .get(req.session.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.put('/profile', (req, res) => {
  const { full_name, jabatan_detail, area_kerja } = req.body;
  db.prepare('UPDATE users SET full_name=?, jabatan_detail=?, area_kerja=? WHERE id=?')
    .run(full_name || '', jabatan_detail || '', area_kerja || '', req.session.user.id);
  req.session.user = { ...req.session.user, full_name: full_name || req.session.user.full_name };
  res.json({ success: true });
});

// ── Upload own TTD ────────────────────────────────────────────────────────────
router.post('/upload/my-ttd', ttdUpload.single('ttd'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filename = `ttd_u${req.session.user.id}.png`;
    const outputPath = path.join(uploadsDir, filename);
    await sharp(req.file.buffer)
      .resize(300, 150, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(outputPath);
    res.json({ success: true, filename, url: `/uploads/${filename}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload gagal' });
  }
});

// ── SPPD Dashboard Stats ──────────────────────────────────────────────────────
router.get('/dashboard-stats', (req, res) => {
  const { role, id } = req.session.user;
  const month = req.query.month || null;

  const summaryBase = `
    SELECT
      COUNT(s.id) as total,
      SUM(CASE WHEN s.status IN ('draft','pending','approved') THEN 1 ELSE 0 END) as aktif,
      SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) as selesai,
      SUM(CASE WHEN s.status = 'rejected' THEN 1 ELSE 0 END) as ditolak,
      COUNT(DISTINCT l.id) as jumlah_laporan,
      COALESCE(SUM(b.total), 0) as total_biaya_usulan,
      COALESCE(SUM(CASE WHEN p.status = 'sudah_cair' THEN p.jumlah_dicairkan ELSE 0 END), 0) as total_biaya_dicairkan
    FROM sppd s
    LEFT JOIN sppd_biaya b ON b.sppd_id = s.id
    LEFT JOIN sppd_pencairan p ON p.sppd_id = s.id
    LEFT JOIN sppd_laporan l ON l.sppd_id = s.id`;

  let summary;
  if (canSeeAll(role)) {
    summary = month
      ? db.prepare(summaryBase + ` WHERE strftime('%Y-%m', s.created_at) = ?`).get(month)
      : db.prepare(summaryBase).get();
  } else if (role === 'area_manager') {
    const area = (req.session.user.area_kerja || db.prepare('SELECT area_kerja FROM users WHERE id=?').get(req.session.user.id)?.area_kerja || '').trim().toLowerCase();
    summary = month
      ? db.prepare(summaryBase + ` JOIN users u ON u.id = s.created_by WHERE LOWER(TRIM(u.area_kerja)) = ? AND strftime('%Y-%m', s.created_at) = ?`).get(area, month)
      : db.prepare(summaryBase + ` JOIN users u ON u.id = s.created_by WHERE LOWER(TRIM(u.area_kerja)) = ?`).get(area);
  } else {
    summary = month
      ? db.prepare(summaryBase + ` WHERE s.created_by = ? AND strftime('%Y-%m', s.created_at) = ?`).get(id, month)
      : db.prepare(summaryBase + ` WHERE s.created_by = ?`).get(id);
  }

  let per_user = [];
  if (canSeeAll(role) || role === 'area_manager') {
    const area = (req.session.user.area_kerja || db.prepare('SELECT area_kerja FROM users WHERE id=?').get(req.session.user.id)?.area_kerja || '').trim().toLowerCase();
    const areaFilter = role === 'area_manager' ? ` WHERE LOWER(TRIM(u.area_kerja)) = '${area.replace(/'/g, "''")}'` : '';
    const perUserBase = `
      SELECT u.id, u.full_name, u.username, u.area_kerja,
        COUNT(s.id) as total,
        SUM(CASE WHEN s.status IN ('draft','pending','approved') THEN 1 ELSE 0 END) as aktif,
        SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) as selesai,
        COALESCE(SUM(b.total), 0) as total_biaya_usulan,
        COALESCE(SUM(CASE WHEN p.status = 'sudah_cair' THEN p.jumlah_dicairkan ELSE 0 END), 0) as total_biaya_dicairkan
      FROM users u${areaFilter}`;
    const perUserJoinMonth = month ? ` AND strftime('%Y-%m', s.created_at) = '${month.replace(/'/g, '')}'` : '';
    per_user = db.prepare(perUserBase + `
      LEFT JOIN sppd s ON s.created_by = u.id${perUserJoinMonth}
      LEFT JOIN sppd_biaya b ON b.sppd_id = s.id
      LEFT JOIN sppd_pencairan p ON p.sppd_id = s.id
      GROUP BY u.id HAVING total > 0 ORDER BY total DESC, u.full_name ASC`).all();
  }

  const available_months = db.prepare(
    `SELECT DISTINCT strftime('%Y-%m', created_at) as month FROM sppd ORDER BY month DESC`
  ).all().map(r => r.month);

  res.json({ summary, per_user, available_months });
});

// ── List all laporan (for laporan approvers) ──────────────────────────────────
router.get('/laporan', (req, res) => {
  const { role } = req.session.user;
  if (!canSeeAll(role) && role !== 'admin' && role !== 'area_manager')
    return res.status(403).json({ error: 'Forbidden' });
  let query = `
    SELECT l.*, s.nomor, s.nama_pegawai, s.tujuan, s.tanggal_berangkat, s.tanggal_kembali,
           u.full_name AS creator_name
    FROM sppd_laporan l
    JOIN sppd s ON l.sppd_id = s.id
    JOIN users u ON s.created_by = u.id
  `;
  let rows;
  if (role === 'area_manager') {
    query += ` WHERE LOWER(TRIM(u.area_kerja)) = LOWER(TRIM(?))`;
    const area = req.session.user.area_kerja || db.prepare('SELECT area_kerja FROM users WHERE id=?').get(req.session.user.id)?.area_kerja || '';
    rows = db.prepare(query + ` ORDER BY l.created_at DESC`).all(area);
  } else {
    rows = db.prepare(query + ` ORDER BY l.created_at DESC`).all();
  }
  res.json(rows);
});

// ── List all pencairan (for all KK-type approvers) ───────────────────────────
router.get('/pencairan', (req, res) => {
  const { role } = req.session.user;
  if (!canSeeAll(role) && role !== 'admin' && role !== 'area_manager')
    return res.status(403).json({ error: 'Forbidden' });
  let query = `
    SELECT p.*, s.nomor, s.nama_pegawai, s.tujuan, s.uang_muka,
           u.full_name AS creator_name, uu.full_name AS updated_by_name
    FROM sppd_pencairan p
    JOIN sppd s ON p.sppd_id = s.id
    JOIN users u ON s.created_by = u.id
    LEFT JOIN users uu ON p.updated_by = uu.id
  `;
  let rows;
  if (role === 'area_manager') {
    query += ` WHERE LOWER(TRIM(u.area_kerja)) = LOWER(TRIM(?))`;
    const area = req.session.user.area_kerja || db.prepare('SELECT area_kerja FROM users WHERE id=?').get(req.session.user.id)?.area_kerja || '';
    rows = db.prepare(query + ` ORDER BY p.created_at DESC`).all(area);
  } else {
    rows = db.prepare(query + ` ORDER BY p.created_at DESC`).all();
  }
  res.json(rows);
});

// ── List SPPD ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { role, id } = req.session.user;
  let rows;
  if (canSeeAll(role)) {
    rows = db.prepare(`
      SELECT s.*, u.full_name AS creator_name,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 2 AND sa.status = 'approved') as gm1_approved,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 3 AND sa.status = 'approved') as gm2_approved
      FROM sppd s JOIN users u ON s.created_by = u.id
      ORDER BY s.created_at DESC
    `).all();
  } else if (role === 'area_manager') {
    rows = db.prepare(`
      SELECT s.*, u.full_name AS creator_name,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 2 AND sa.status = 'approved') as gm1_approved,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 3 AND sa.status = 'approved') as gm2_approved
      FROM sppd s JOIN users u ON s.created_by = u.id
      WHERE LOWER(TRIM(u.area_kerja)) = LOWER(TRIM(?)) OR s.created_by = ?
      ORDER BY s.created_at DESC
    `).all(req.session.user.area_kerja || db.prepare('SELECT area_kerja FROM users WHERE id=?').get(id)?.area_kerja || '', id);
  } else {
    rows = db.prepare(`
      SELECT s.*, u.full_name AS creator_name,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 2 AND sa.status = 'approved') as gm1_approved,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 3 AND sa.status = 'approved') as gm2_approved
      FROM sppd s JOIN users u ON s.created_by = u.id
      WHERE s.created_by = ?
      ORDER BY s.created_at DESC
    `).all(id);
  }
  res.json(rows);
});

// ── Create SPPD ───────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { id: userId } = req.session.user;
  const creatorUser = db.prepare('SELECT full_name, role, jabatan_detail, area_kerja FROM users WHERE id = ?').get(userId);
  const nama_pegawai = creatorUser.full_name;
  const jabatan = creatorUser.jabatan_detail || creatorUser.role;
  const area_kerja = creatorUser.area_kerja || '';

  const {
    tujuan, keperluan,
    tanggal_berangkat, tanggal_kembali, transport, uang_muka,
    itinerary, biaya
  } = req.body;

  const nomor = `DRAFT-${Date.now()}`;
  const result = db.prepare(`
    INSERT INTO sppd (nomor, created_by, nama_pegawai, jabatan, area_kerja, tujuan, keperluan,
      tanggal_berangkat, tanggal_kembali, transport, uang_muka)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nomor, userId, nama_pegawai || '', jabatan || '', area_kerja || '', tujuan || '',
    keperluan || '', tanggal_berangkat || '', tanggal_kembali || '', transport || '',
    Number(uang_muka) || 0);

  const sppdId = result.lastInsertRowid;

  if (Array.isArray(itinerary) && itinerary.length) {
    const ins = db.prepare(`
      INSERT INTO sppd_itinerary (sppd_id, tanggal, lokasi, pelanggan, aktivitas, sasaran_nilai_project, produk, keterangan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    itinerary.forEach(r => ins.run(sppdId, r.tanggal || '', r.lokasi || '', r.pelanggan || '',
      r.aktivitas || '', Number(r.sasaran_nilai_project) || 0, r.produk || '', r.keterangan || ''));
  }

  if (biaya && typeof biaya === 'object') {
    const total = (Number(biaya.akomodasi) || 0) + (Number(biaya.konsumsi) || 0) +
      (Number(biaya.transportasi) || 0) + (Number(biaya.entertain) || 0) +
      (Number(biaya.uang_saku) || 0) + (Number(biaya.biaya_lain) || 0);
    db.prepare(`INSERT INTO sppd_biaya (sppd_id, akomodasi, konsumsi, transportasi, entertain, uang_saku, biaya_lain, biaya_lain_ket, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sppdId, Number(biaya.akomodasi) || 0, Number(biaya.konsumsi) || 0,
        Number(biaya.transportasi) || 0, Number(biaya.entertain) || 0,
        Number(biaya.uang_saku) || 0, Number(biaya.biaya_lain) || 0,
        biaya.biaya_lain_ket || '', total);
  }

  res.json({ success: true, id: sppdId, nomor });
});

// ── PDF helpers ───────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtRp(v) {
  return new Intl.NumberFormat('id-ID').format(v || 0);
}

function toBase64(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function getTTDBase64(userId) {
  const candidates = [
    path.join(__dirname, '..', 'public', 'img',     `ttd_u${userId}.png`),
    path.join(__dirname, '..', 'public', 'uploads', `ttd_u${userId}.png`),
  ];
  for (const p of candidates) { const b = toBase64(p); if (b) return b; }
  return null;
}

function getTanggalIndo(dateStr) {
  const bulan = ['Januari','Februari','Maret','April','Mei','Juni',
                 'Juli','Agustus','September','Oktober','November','Desember'];
  const d = dateStr ? new Date(dateStr) : new Date();
  return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

function hitungHari(tgl1, tgl2) {
  if (!tgl1 || !tgl2) return '-';
  const d = Math.round((new Date(tgl2) - new Date(tgl1)) / 86400000) + 1;
  return `${d} hari`;
}

function generateSPPDHtml(sppd, itinerary, approvals, settings) {
  const companyName    = settings.company_name    || 'PT. Lapan Alpha Kirana';
  const companyAddress = settings.company_address || 'Jakarta';
  const kkKota         = settings.kk_kota         || 'Jakarta';
  const signerName     = settings.signer_name     || '';
  const signerTitle    = settings.signer_title    || 'General Manager';

  // Find the highest approved level and its approver
  const sortedApprovals = [...approvals].sort((a, b) => b.level - a.level);
  const topApproval = sortedApprovals.find(a => a.status === 'approved') || null;
  const topTTD      = topApproval ? getTTDBase64(topApproval.approver_user_id) : null;
  const creatorTTD  = getTTDBase64(sppd.created_by);

  const itinRows = itinerary.map((r, i) => `
    <tr style="background:${i%2===0?'#fff':'#f5f8fc'}">
      <td style="text-align:center">${esc(r.tanggal)}</td>
      <td>${esc(r.lokasi||r.dari||'')}</td>
      <td>${esc(r.pelanggan||r.ke||'')}</td>
      <td>${esc(r.aktivitas||r.transport||'')}</td>
      <td style="text-align:right">${r.sasaran_nilai_project ? `Rp ${fmtRp(r.sasaran_nilai_project)}` : ''}</td>
      <td>${esc(r.produk||'')}</td>
      <td>${esc(r.keterangan||'')}</td>
    </tr>`).join('');

  const approvalRows = approvals.map(a => {
    const icon = a.status === 'approved' ? '✅' : a.status === 'rejected' ? '❌' : '⏳';
    const LEVEL_LABEL = { 1:'Area Manager', 2:'GM', 3:'GM 2' };
    return `<tr>
      <td style="text-align:center">${LEVEL_LABEL[a.level]||a.level}</td>
      <td>${esc(a.full_name||'-')}</td>
      <td style="text-align:center">${icon} ${a.status}</td>
      <td>${esc(a.note||'-')}</td>
      <td style="text-align:center">${esc(a.acted_at||'-')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:#aaa">-</td></tr>';

  const tanggalCetak = getTanggalIndo(sppd.created_at);
  const lamaPerjln   = hitungHari(sppd.tanggal_berangkat, sppd.tanggal_kembali);

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #111; background: #fff; }
  h2.doc-title { text-align: center; font-size: 13pt; text-transform: uppercase; letter-spacing: 1px;
                 font-weight: bold; margin-bottom: 2px; }
  p.doc-subtitle { text-align: center; font-size: 9pt; margin-bottom: 18px; }
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  .data-table td { padding: 4px 6px; vertical-align: top; font-size: 10pt; }
  .data-table td.lbl { width: 175px; font-weight: 600; }
  .data-table td.sep { width: 14px; }
  .data-table td.val { border-bottom: 1px dotted #bbb; }
  .section-title { font-weight: bold; font-size: 10pt; text-transform: uppercase;
                   border-bottom: 1.5px solid #1F4E79; margin-bottom: 8px; padding-bottom: 3px; color: #1F4E79; }
  .itin-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 9pt; }
  .itin-table th { background: #1F4E79; color: #fff; padding: 5px 6px; text-align: center;
                   border: 1px solid #1F4E79; font-size: 8.5pt; }
  .itin-table td { border: 1px solid #ccc; padding: 4px 6px; vertical-align: middle; }
  .appr-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 9pt; }
  .appr-table th { background: #4a7fa5; color: #fff; padding: 4px 6px; text-align: center;
                   border: 1px solid #4a7fa5; font-size: 8.5pt; }
  .appr-table td { border: 1px solid #ccc; padding: 4px 6px; vertical-align: middle; }
  .sig-row { display: flex; justify-content: space-between; margin-top: 12px; }
  .sig-box { width: 45%; text-align: center; }
  .sig-box p.sig-title { font-size: 9.5pt; margin-bottom: 4px; }
  .sig-box .ttd-img { height: 28mm; display: flex; align-items: center; justify-content: center; margin: 4px 0; }
  .sig-box .ttd-img img { max-height: 28mm; max-width: 55mm; object-fit: contain; }
  .sig-box .sig-name { font-weight: bold; border-top: 1px solid #333; padding-top: 3px; font-size: 10pt; }
  .sig-box .sig-role { font-size: 8.5pt; color: #555; }
</style>
</head>
<body>

<h2 class="doc-title">Surat Perintah Perjalanan Dinas</h2>
<p class="doc-subtitle">Nomor: <strong>${esc(sppd.nomor)}</strong></p>

<p class="section-title">Data Perjalanan</p>
<table class="data-table">
  <tr><td class="lbl">Nama Pegawai</td><td class="sep">:</td><td class="val">${esc(sppd.nama_pegawai)}</td></tr>
  <tr><td class="lbl">Jabatan</td><td class="sep">:</td><td class="val">${esc(sppd.jabatan||'-')}</td></tr>
  <tr><td class="lbl">Area Kerja / Berangkat dari</td><td class="sep">:</td><td class="val">${esc(sppd.area_kerja||'-')}</td></tr>
  <tr><td class="lbl">Tujuan</td><td class="sep">:</td><td class="val">${esc(sppd.tujuan)}</td></tr>
  <tr><td class="lbl">Keperluan</td><td class="sep">:</td><td class="val">${esc(sppd.keperluan)}</td></tr>
  <tr><td class="lbl">Tanggal Berangkat</td><td class="sep">:</td><td class="val">${esc(sppd.tanggal_berangkat)}</td></tr>
  <tr><td class="lbl">Tanggal Kembali</td><td class="sep">:</td><td class="val">${esc(sppd.tanggal_kembali)}</td></tr>
  <tr><td class="lbl">Lama Perjalanan</td><td class="sep">:</td><td class="val">${lamaPerjln}</td></tr>
  <tr><td class="lbl">Kendaraan / Transportasi</td><td class="sep">:</td><td class="val">${esc(sppd.transport||'-')}</td></tr>
  <tr><td class="lbl">Uang Muka</td><td class="sep">:</td><td class="val">Rp ${fmtRp(sppd.uang_muka)}</td></tr>
</table>

${itinerary.length ? `
<p class="section-title">Rencana Itinerary</p>
<table class="itin-table">
  <thead><tr><th>Tanggal</th><th>Lokasi</th><th>Pelanggan/Instansi</th><th>Aktivitas</th><th>Sasaran Nilai</th><th>Produk</th><th>Keterangan</th></tr></thead>
  <tbody>${itinRows}</tbody>
</table>` : ''}

<p class="section-title">Riwayat Persetujuan</p>
<table class="appr-table">
  <thead><tr><th>Level</th><th>Approver</th><th>Status</th><th>Catatan</th><th>Waktu</th></tr></thead>
  <tbody>${approvalRows}</tbody>
</table>

<div class="sig-row">
  <div class="sig-box">
    <p class="sig-title">Yang Memerintahkan,</p>
    <div class="ttd-img">
      ${topTTD ? `<img src="${topTTD}" alt="TTD">` : '<span style="color:#ccc;font-size:9pt">[tanda tangan]</span>'}
    </div>
    <div class="sig-name">${esc(topApproval ? topApproval.full_name : signerName)}</div>
    <div class="sig-role">${esc(topApproval ? ({ 1:'Area Manager', 2:'General Manager', 3:'GM 2' }[topApproval.level]||'') : signerTitle)}</div>
  </div>
  <div class="sig-box">
    <p class="sig-title">${esc(kkKota)}, ${tanggalCetak}</p>
    <p class="sig-title" style="margin-top:2px">Yang Melaksanakan,</p>
    <div class="ttd-img">
      ${creatorTTD ? `<img src="${creatorTTD}" alt="TTD">` : '<span style="color:#ccc;font-size:9pt">[tanda tangan]</span>'}
    </div>
    <div class="sig-name">${esc(sppd.creator_name||sppd.nama_pegawai)}</div>
    <div class="sig-role">${esc(sppd.jabatan||'Pegawai')}</div>
  </div>
</div>

</body>
</html>`;
}

// ── Download SPPD as PDF ──────────────────────────────────────────────────────
router.get('/:id/download/pdf', async (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare(`
    SELECT s.*, u.full_name AS creator_name,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 2 AND sa.status = 'approved') as gm1_approved,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 3 AND sa.status = 'approved') as gm2_approved
    FROM sppd s JOIN users u ON s.created_by = u.id WHERE s.id = ?
  `).get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by);
  const isSameArea = user.role === 'area_manager' && (creator?.area_kerja || '').trim().toLowerCase() === (user.area_kerja || '').trim().toLowerCase();
  if (!canSeeAll(user.role) && sppd.created_by !== user.id && !isSameArea) return res.status(403).json({ error: 'Forbidden' });
  if (!['approved', 'completed'].includes(sppd.status))
    return res.status(400).json({ error: 'SPPD belum disetujui' });

  try {
    const settings = {};
    db.prepare('SELECT key, value FROM settings').all().forEach(s => { settings[s.key] = s.value; });
    const itinerary = db.prepare('SELECT * FROM sppd_itinerary WHERE sppd_id = ? ORDER BY id').all(sppd.id);
    const approvals = db.prepare(`
      SELECT sa.*, u.full_name, u.role, u.id AS approver_user_id
      FROM sppd_approvals sa JOIN users u ON sa.approver_user_id = u.id
      WHERE sa.sppd_id = ? ORDER BY sa.level
    `).all(sppd.id);

    const html = generateSPPDHtml(sppd, itinerary, approvals, settings);
    const { generateHeaderHTML, generateFooterHTML } = require('../htmlGenerator');

    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const headerHtml = generateHeaderHTML(settings);
    const footerHtml = generateFooterHTML(settings);
    const hasFooter  = !!(settings.company_headoffice || settings.company_warehouse);

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: hasFooter ? footerHtml : '<span></span>',
      margin: { top: '38mm', bottom: hasFooter ? '28mm' : '15mm', left: '20mm', right: '20mm' },
    });
    await browser.close();

    const filename = `SPPD_${sppd.nomor.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating SPPD PDF:', err);
    res.status(500).json({ error: 'Gagal membuat PDF: ' + err.message });
  }
});

// ── Laporan PDF HTML generator ────────────────────────────────────────────────
function generateLaporanHtml(sppd, laporan, kunjungan, biaya, approvals, settings) {
  const companyName = settings.company_name || 'PT. Lapan Alpha Kirana';
  const kkKota      = settings.kk_kota      || 'Jakarta';

  // Highest approved laporan approver
  const sortedAppr  = [...approvals].sort((a, b) => b.level - a.level);
  const topAppr     = sortedAppr.find(a => a.status === 'approved') || null;
  const topTTD      = topAppr ? getTTDBase64(topAppr.approver_user_id) : null;
  const creatorTTD  = getTTDBase64(sppd.created_by);

  const LAPORAN_LABEL = { 1:'Area Manager', 2:'Manager Keuangan', 3:'GM 1', 4:'GM 2', 5:'Direktur Operasional', 6:'Direktur Utama' };

  const kunjRows = kunjungan.map((k, i) => `
    <tr style="background:${i%2===0?'#fff':'#f5f8fc'}">
      <td style="text-align:center">${i+1}</td>
      <td>${esc(k.tanggal)}</td>
      <td>${esc(k.nama_instansi)}</td>
      <td>${esc(k.nama_kontak)}</td>
      <td>${esc(k.hasil)}</td>
    </tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:8px">Tidak ada data kunjungan</td></tr>`;

  const biayaRows = biaya.map((b, i) => `
    <tr style="background:${i%2===0?'#fff':'#f5f8fc'}">
      <td style="text-align:center;vertical-align:top">${i+1}</td>
      <td style="vertical-align:top">${esc(b.keterangan)}</td>
      <td style="text-align:right;vertical-align:top">Rp ${fmtRp(b.jumlah)}</td>
      <td style="text-align:center;vertical-align:top">
        ${b.bukti ? `<img src="${b.bukti}" style="max-width:120px;max-height:90px;object-fit:contain;border:1px solid #ddd;border-radius:4px">` : '<span style="color:#ccc;font-size:9pt">-</span>'}
      </td>
    </tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:#aaa;padding:8px">Tidak ada data biaya</td></tr>`;

  const totalBiaya = biaya.reduce((s, b) => s + (b.jumlah || 0), 0);

  const apprRows = approvals.map(a => {
    const icon = a.status === 'approved' ? '✅' : a.status === 'rejected' ? '❌' : '⏳';
    return `<tr>
      <td style="text-align:center">${LAPORAN_LABEL[a.level]||a.level}</td>
      <td>${esc(a.full_name||'-')}</td>
      <td style="text-align:center">${icon} ${a.status}</td>
      <td>${esc(a.note||'-')}</td>
      <td style="text-align:center">${esc(a.acted_at||'-')}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="text-align:center;color:#aaa">-</td></tr>`;

  const tanggalLaporan = getTanggalIndo(laporan.tanggal_laporan || laporan.created_at);

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #111; background: #fff; }
  h2.doc-title { text-align: center; font-size: 13pt; text-transform: uppercase;
                 font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
  p.doc-subtitle { text-align: center; font-size: 9pt; margin-bottom: 18px; }
  .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  .meta-table td { padding: 3px 6px; vertical-align: top; font-size: 10pt; }
  .meta-table td.lbl { width: 175px; font-weight: 600; }
  .meta-table td.sep { width: 14px; }
  .meta-table td.val { border-bottom: 1px dotted #ccc; }
  .section-title { font-weight: bold; font-size: 10pt; text-transform: uppercase;
                   border-bottom: 1.5px solid #1F4E79; margin: 18px 0 8px; padding-bottom: 3px; color: #1F4E79; }
  .isi-box { background: #f8fafc; border: 1px solid #dde; border-radius: 4px;
             padding: 10px 12px; white-space: pre-wrap; font-size: 10pt;
             line-height: 1.6; margin-bottom: 4px; }
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; font-size: 9pt; }
  .data-table th { background: #1F4E79; color: #fff; padding: 5px 6px; text-align: center;
                   border: 1px solid #1F4E79; font-size: 8.5pt; }
  .data-table td { border: 1px solid #ccc; padding: 4px 6px; vertical-align: middle; }
  .data-table tfoot td { font-weight: bold; background: #eef3fa; border: 1px solid #ccc; padding: 5px 6px; }
  .appr-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 9pt; }
  .appr-table th { background: #4a7fa5; color: #fff; padding: 4px 6px; text-align: center;
                   border: 1px solid #4a7fa5; font-size: 8.5pt; }
  .appr-table td { border: 1px solid #ccc; padding: 4px 6px; vertical-align: middle; }
  .sig-row { display: flex; justify-content: space-between; margin-top: 8px; }
  .sig-box { width: 45%; text-align: center; }
  .sig-box p.sig-title { font-size: 9.5pt; margin-bottom: 4px; }
  .sig-box .ttd-img { height: 28mm; display: flex; align-items: center; justify-content: center; margin: 4px 0; }
  .sig-box .ttd-img img { max-height: 28mm; max-width: 55mm; object-fit: contain; }
  .sig-box .sig-name { font-weight: bold; border-top: 1px solid #333; padding-top: 3px; font-size: 10pt; }
  .sig-box .sig-role  { font-size: 8.5pt; color: #555; }
</style>
</head>
<body>

<h2 class="doc-title">Laporan Perjalanan Dinas</h2>
<p class="doc-subtitle">Berdasarkan SPPD Nomor: <strong>${esc(sppd.nomor)}</strong></p>

<p class="section-title" style="margin-top:0">Data Pegawai &amp; Perjalanan</p>
<table class="meta-table">
  <tr><td class="lbl">Nama Pegawai</td><td class="sep">:</td><td class="val">${esc(sppd.nama_pegawai)}</td></tr>
  <tr><td class="lbl">Jabatan</td><td class="sep">:</td><td class="val">${esc(sppd.jabatan||'-')}</td></tr>
  <tr><td class="lbl">Area Kerja</td><td class="sep">:</td><td class="val">${esc(sppd.area_kerja||'-')}</td></tr>
  <tr><td class="lbl">Tujuan</td><td class="sep">:</td><td class="val">${esc(sppd.tujuan)}</td></tr>
  <tr><td class="lbl">Tanggal Berangkat</td><td class="sep">:</td><td class="val">${esc(sppd.tanggal_berangkat)}</td></tr>
  <tr><td class="lbl">Tanggal Kembali</td><td class="sep">:</td><td class="val">${esc(sppd.tanggal_kembali)}</td></tr>
  <tr><td class="lbl">Tanggal Laporan</td><td class="sep">:</td><td class="val">${tanggalLaporan}</td></tr>
</table>

<p class="section-title">Uraian Kegiatan</p>
<div class="isi-box">${esc(laporan.isi_laporan||'-')}</div>

<p class="section-title">Daftar Kunjungan</p>
<table class="data-table">
  <thead><tr><th width="36">No</th><th width="90">Tanggal</th><th>Nama Instansi</th><th>Nama Kontak</th><th>Hasil Kunjungan</th></tr></thead>
  <tbody>${kunjRows}</tbody>
</table>

<p class="section-title">Rincian Biaya</p>
<table class="data-table">
  <thead><tr><th width="36">No</th><th>Keterangan</th><th width="140">Jumlah (Rp)</th><th width="130">Bukti</th></tr></thead>
  <tbody>${biayaRows}</tbody>
  <tfoot><tr><td colspan="2" style="text-align:right">Total Biaya</td><td style="text-align:right">Rp ${fmtRp(totalBiaya)}</td><td></td></tr></tfoot>
</table>

<p class="section-title">Riwayat Persetujuan Laporan</p>
<table class="appr-table" style="margin-bottom:18px">
  <thead><tr><th>Level</th><th>Approver</th><th>Status</th><th>Catatan</th><th>Waktu</th></tr></thead>
  <tbody>${apprRows}</tbody>
</table>

<div class="sig-row">
  <div class="sig-box">
    <p class="sig-title">Mengetahui,</p>
    <div class="ttd-img">
      ${topTTD ? `<img src="${topTTD}" alt="TTD">` : '<span style="color:#ccc;font-size:9pt">[tanda tangan]</span>'}
    </div>
    <div class="sig-name">${esc(topAppr ? topAppr.full_name : '')}</div>
    <div class="sig-role">${esc(topAppr ? (LAPORAN_LABEL[topAppr.level]||'') : '')}</div>
  </div>
  <div class="sig-box">
    <p class="sig-title">${esc(kkKota)}, ${tanggalLaporan}</p>
    <p class="sig-title" style="margin-top:2px">Yang Melaporkan,</p>
    <div class="ttd-img">
      ${creatorTTD ? `<img src="${creatorTTD}" alt="TTD">` : '<span style="color:#ccc;font-size:9pt">[tanda tangan]</span>'}
    </div>
    <div class="sig-name">${esc(sppd.creator_name||sppd.nama_pegawai)}</div>
    <div class="sig-role">${esc(sppd.jabatan||'Pegawai')}</div>
  </div>
</div>

</body>
</html>`;
}

// ── Download Laporan as PDF ───────────────────────────────────────────────────
router.get('/:id/laporan/download/pdf', async (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare(`
    SELECT s.*, u.full_name AS creator_name,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 2 AND sa.status = 'approved') as gm1_approved,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 3 AND sa.status = 'approved') as gm2_approved
    FROM sppd s JOIN users u ON s.created_by = u.id WHERE s.id = ?
  `).get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by);
  const isSameArea = user.role === 'area_manager' && (creator?.area_kerja || '').trim().toLowerCase() === (user.area_kerja || '').trim().toLowerCase();
  if (!canSeeAll(user.role) && sppd.created_by !== user.id && !isSameArea) return res.status(403).json({ error: 'Forbidden' });

  const laporan = db.prepare('SELECT * FROM sppd_laporan WHERE sppd_id = ?').get(req.params.id);
  if (!laporan) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  if (laporan.status !== 'approved')
    return res.status(400).json({ error: 'Laporan belum disetujui' });

  try {
    const settings = {};
    db.prepare('SELECT key, value FROM settings').all().forEach(s => { settings[s.key] = s.value; });
    const kunjungan = db.prepare('SELECT * FROM sppd_laporan_kunjungan WHERE laporan_id = ? ORDER BY id').all(laporan.id);
    const biaya     = db.prepare('SELECT * FROM sppd_laporan_biaya WHERE laporan_id = ? ORDER BY id').all(laporan.id);
    const approvals = db.prepare(`
      SELECT la.*, u.full_name, u.id AS approver_user_id
      FROM sppd_laporan_approvals la JOIN users u ON la.approver_user_id = u.id
      WHERE la.laporan_id = ? ORDER BY la.level
    `).all(laporan.id);

    const html = generateLaporanHtml(sppd, laporan, kunjungan, biaya, approvals, settings);
    const { generateHeaderHTML, generateFooterHTML } = require('../htmlGenerator');

    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const headerHtml = generateHeaderHTML(settings);
    const footerHtml = generateFooterHTML(settings);
    const hasFooter  = !!(settings.company_headoffice || settings.company_warehouse);

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: hasFooter ? footerHtml : '<span></span>',
      margin: { top: '38mm', bottom: hasFooter ? '28mm' : '15mm', left: '20mm', right: '20mm' },
    });
    await browser.close();

    const filename = `Laporan_${sppd.nomor.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating Laporan PDF:', err);
    res.status(500).json({ error: 'Gagal membuat PDF: ' + err.message });
  }
});

// ── Get SPPD detail ───────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare(`
    SELECT s.*, u.full_name AS creator_name,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 2 AND sa.status = 'approved') as gm1_approved,
       (SELECT COUNT(*) FROM sppd_approvals sa WHERE sa.sppd_id = s.id AND sa.level = 3 AND sa.status = 'approved') as gm2_approved
    FROM sppd s JOIN users u ON s.created_by = u.id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by);
  const isSameArea = user.role === 'area_manager' && (creator?.area_kerja || '').trim().toLowerCase() === (user.area_kerja || '').trim().toLowerCase();
  if (!canSeeAll(user.role) && sppd.created_by !== user.id && !isSameArea) return res.status(403).json({ error: 'Forbidden' });

  const itinerary = db.prepare('SELECT * FROM sppd_itinerary WHERE sppd_id = ? ORDER BY id').all(req.params.id);
  const approvals = db.prepare(`
    SELECT sa.*, u.full_name AS approver_name
    FROM sppd_approvals sa LEFT JOIN users u ON sa.approver_user_id = u.id
    WHERE sa.sppd_id = ? ORDER BY sa.level
  `).all(req.params.id);
  const biaya = db.prepare('SELECT * FROM sppd_biaya WHERE sppd_id = ?').get(req.params.id) || null;

  res.json({ ...sppd, itinerary, approvals, biaya });
});

// ── Update SPPD ───────────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (sppd.created_by !== user.id && user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  if (sppd.status !== 'pending' || sppd.sppd_approval_level > 0)
    return res.status(400).json({ error: 'Tidak bisa diedit setelah proses approval dimulai' });

  const creatorUser = db.prepare('SELECT full_name, role, jabatan_detail, area_kerja FROM users WHERE id = ?').get(sppd.created_by);
  const nama_pegawai = creatorUser.full_name;
  const jabatan = creatorUser.jabatan_detail || creatorUser.role;
  const area_kerja = creatorUser.area_kerja || '';

  const {
    tujuan, keperluan,
    tanggal_berangkat, tanggal_kembali, transport, uang_muka, itinerary, biaya
  } = req.body;

  db.prepare(`
    UPDATE sppd SET nama_pegawai=?, jabatan=?, area_kerja=?, tujuan=?, keperluan=?,
      tanggal_berangkat=?, tanggal_kembali=?, transport=?, uang_muka=?
    WHERE id=?
  `).run(nama_pegawai || '', jabatan || '', area_kerja || '', tujuan || '', keperluan || '',
    tanggal_berangkat || '', tanggal_kembali || '', transport || '', Number(uang_muka) || 0,
    req.params.id);

  if (Array.isArray(itinerary)) {
    db.prepare('DELETE FROM sppd_itinerary WHERE sppd_id = ?').run(req.params.id);
    const ins = db.prepare(`
      INSERT INTO sppd_itinerary (sppd_id, tanggal, lokasi, pelanggan, aktivitas, sasaran_nilai_project, produk, keterangan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    itinerary.forEach(r => ins.run(req.params.id, r.tanggal || '', r.lokasi || '', r.pelanggan || '',
      r.aktivitas || '', Number(r.sasaran_nilai_project) || 0, r.produk || '', r.keterangan || ''));
  }

  if (biaya && typeof biaya === 'object') {
    const total = (Number(biaya.akomodasi) || 0) + (Number(biaya.konsumsi) || 0) +
      (Number(biaya.transportasi) || 0) + (Number(biaya.entertain) || 0) +
      (Number(biaya.uang_saku) || 0) + (Number(biaya.biaya_lain) || 0);
    db.prepare(`INSERT OR REPLACE INTO sppd_biaya (sppd_id, akomodasi, konsumsi, transportasi, entertain, uang_saku, biaya_lain, biaya_lain_ket, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.params.id, Number(biaya.akomodasi) || 0, Number(biaya.konsumsi) || 0,
        Number(biaya.transportasi) || 0, Number(biaya.entertain) || 0,
        Number(biaya.uang_saku) || 0, Number(biaya.biaya_lain) || 0,
        biaya.biaya_lain_ket || '', total);
  }

  res.json({ success: true });
});

// ── Delete SPPD ───────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (sppd.created_by !== user.id && user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  if (sppd.status !== 'pending' || sppd.sppd_approval_level > 0)
    return res.status(400).json({ error: 'Tidak bisa dihapus setelah proses approval dimulai' });

  db.prepare('DELETE FROM sppd_itinerary WHERE sppd_id = ?').run(req.params.id);
  db.prepare('DELETE FROM sppd_approvals WHERE sppd_id = ?').run(req.params.id);
  db.prepare('DELETE FROM sppd WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Approve SPPD ──────────────────────────────────────────────────────────────
// Flow: sppd_approval_level=0 (waiting AM) → 1 (GM stage, both GM1&GM2 parallel) → 2 (approved)
router.post('/:id/approve', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (sppd.status !== 'pending') return res.status(400).json({ error: 'SPPD sudah diproses' });

  const { note } = req.body;
  const lvl = sppd.sppd_approval_level;

  const ins = (level, status) =>
    db.prepare("INSERT INTO sppd_approvals (sppd_id,level,approver_user_id,status,note,acted_at) VALUES (?,?,?,'approved',?,datetime('now','localtime'))")
      .run(sppd.id, level, user.id, note || '');

  const finalize = () => {
    const creatorArea = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by)?.area_kerja || sppd.area_kerja || '';
    const nomor = generateNomorSppd(creatorArea);
    db.prepare("UPDATE sppd SET status='approved', sppd_approval_level=2, nomor=? WHERE id=?").run(nomor, sppd.id);
  };

  if (user.role === 'area_manager') {
    if (lvl !== 0) return res.status(403).json({ error: 'Bukan giliran Area Manager' });
    const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by);
    if ((creator?.area_kerja || '').trim().toLowerCase() !== (user.area_kerja || '').trim().toLowerCase())
      return res.status(403).json({ error: 'Area Anda tidak sesuai dengan area pembuat SPPD' });
    ins(1); db.prepare('UPDATE sppd SET sppd_approval_level=1 WHERE id=?').run(sppd.id);

  } else if (user.role === 'gm') {
    if (lvl !== 1) return res.status(403).json({ error: 'Bukan giliran GM' });
    if (db.prepare("SELECT id FROM sppd_approvals WHERE sppd_id=? AND level=2").get(sppd.id))
      return res.status(400).json({ error: 'Anda sudah menyetujui SPPD ini' });
    ins(2);
    if (db.prepare("SELECT id FROM sppd_approvals WHERE sppd_id=? AND level=3 AND status='approved'").get(sppd.id)) finalize();

  } else if (user.role === 'gm2') {
    if (lvl !== 1) return res.status(403).json({ error: 'Bukan giliran GM 2' });
    if (db.prepare("SELECT id FROM sppd_approvals WHERE sppd_id=? AND level=3").get(sppd.id))
      return res.status(400).json({ error: 'Anda sudah menyetujui SPPD ini' });
    ins(3);
    if (db.prepare("SELECT id FROM sppd_approvals WHERE sppd_id=? AND level=2 AND status='approved'").get(sppd.id)) finalize();

  } else if (user.role === 'admin') {
    if (lvl === 0) {
      ins(1); db.prepare('UPDATE sppd SET sppd_approval_level=1 WHERE id=?').run(sppd.id);
    } else if (lvl === 1) {
      if (!db.prepare("SELECT id FROM sppd_approvals WHERE sppd_id=? AND level=2").get(sppd.id)) ins(2);
      if (!db.prepare("SELECT id FROM sppd_approvals WHERE sppd_id=? AND level=3").get(sppd.id)) ins(3);
      finalize();
    } else return res.status(400).json({ error: 'SPPD sudah selesai' });
  } else {
    return res.status(403).json({ error: 'Tidak berwenang' });
  }

  res.json({ success: true });
});

// ── Reject SPPD ───────────────────────────────────────────────────────────────
router.post('/:id/reject', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (sppd.status !== 'pending') return res.status(400).json({ error: 'SPPD sudah diproses' });

  const { note } = req.body;
  const lvl = sppd.sppd_approval_level;
  let approvalLevel;

  if (user.role === 'area_manager') {
    if (lvl !== 0) return res.status(403).json({ error: 'Tidak berwenang' });
    const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by);
    if ((creator?.area_kerja || '').trim().toLowerCase() !== (user.area_kerja || '').trim().toLowerCase())
      return res.status(403).json({ error: 'Area tidak sesuai' });
    approvalLevel = 1;
  } else if (user.role === 'gm') {
    if (lvl !== 1) return res.status(403).json({ error: 'Tidak berwenang' });
    approvalLevel = 2;
  } else if (user.role === 'gm2') {
    if (lvl !== 1) return res.status(403).json({ error: 'Tidak berwenang' });
    approvalLevel = 3;
  } else if (user.role === 'admin') {
    approvalLevel = lvl === 0 ? 1 : 2;
  } else {
    return res.status(403).json({ error: 'Tidak berwenang' });
  }

  db.prepare("INSERT INTO sppd_approvals (sppd_id,level,approver_user_id,status,note,acted_at) VALUES (?,?,?,'rejected',?,datetime('now','localtime'))")
    .run(sppd.id, approvalLevel, user.id, note || '');
  db.prepare("UPDATE sppd SET status='rejected', reject_reason=? WHERE id=?").run(note || '', sppd.id);

  res.json({ success: true });
});

// ── Get Laporan ───────────────────────────────────────────────────────────────
router.get('/:id/laporan', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by);
  const isSameArea = user.role === 'area_manager' && (creator?.area_kerja || '').trim().toLowerCase() === (user.area_kerja || '').trim().toLowerCase();
  if (!canSeeAll(user.role) && sppd.created_by !== user.id && !isSameArea) return res.status(403).json({ error: 'Forbidden' });

  const laporan = db.prepare('SELECT * FROM sppd_laporan WHERE sppd_id = ?').get(req.params.id);
  if (!laporan) return res.json(null);

  const kunjungan = db.prepare('SELECT * FROM sppd_laporan_kunjungan WHERE laporan_id = ? ORDER BY id').all(laporan.id);
  const biaya = db.prepare('SELECT * FROM sppd_laporan_biaya WHERE laporan_id = ? ORDER BY id').all(laporan.id);
  const approvals = db.prepare(`
    SELECT la.*, u.full_name AS approver_name
    FROM sppd_laporan_approvals la LEFT JOIN users u ON la.approver_user_id = u.id
    WHERE la.laporan_id = ? ORDER BY la.level
  `).all(laporan.id);

  res.json({ ...laporan, kunjungan, biaya, approvals });
});

// ── Submit Laporan ────────────────────────────────────────────────────────────
router.post('/:id/laporan', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (sppd.created_by !== user.id && user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  if (sppd.status !== 'approved') return res.status(400).json({ error: 'SPPD belum disetujui' });
  if (db.prepare('SELECT id FROM sppd_laporan WHERE sppd_id = ?').get(req.params.id))
    return res.status(400).json({ error: 'Laporan sudah ada' });

  const { tanggal_laporan, isi_laporan, catatan_umum, kunjungan, biaya } = req.body;
  const totalBiaya = Array.isArray(biaya) ? biaya.reduce((s, b) => s + (Number(b.jumlah) || 0), 0) : 0;

  const result = db.prepare(`
    INSERT INTO sppd_laporan (sppd_id, tanggal_laporan, isi_laporan, catatan_umum, total_biaya, laporan_approval_level)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(req.params.id, tanggal_laporan || '', isi_laporan || '', catatan_umum || '', totalBiaya);
  const laporanId = result.lastInsertRowid;

  if (Array.isArray(kunjungan) && kunjungan.length) {
    const ins = db.prepare('INSERT INTO sppd_laporan_kunjungan (laporan_id, tanggal, nama_instansi, nama_kontak, nama_pelanggan, laporan_kunjungan, hasil) VALUES (?, ?, ?, ?, ?, ?, ?)');
    kunjungan.forEach(k => ins.run(laporanId, k.tanggal || '', k.nama_instansi || '', k.nama_kontak || '', k.nama_pelanggan || '', k.laporan_kunjungan || '', k.hasil || ''));
  }

  if (Array.isArray(biaya) && biaya.length) {
    const ins = db.prepare('INSERT INTO sppd_laporan_biaya (laporan_id, keterangan, jumlah, bukti) VALUES (?, ?, ?, ?)');
    biaya.forEach(b => ins.run(laporanId, b.keterangan || '', Number(b.jumlah) || 0, b.bukti || null));
  }

  res.json({ success: true, id: laporanId });
});

// ── Update Laporan ────────────────────────────────────────────────────────────
router.put('/:id/laporan', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (sppd.created_by !== user.id && user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  const laporan = db.prepare('SELECT * FROM sppd_laporan WHERE sppd_id = ?').get(req.params.id);
  if (!laporan) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  if (laporan.status !== 'pending' || laporan.laporan_approval_level > 0)
    return res.status(400).json({ error: 'Tidak bisa diedit setelah proses approval dimulai' });

  const { tanggal_laporan, isi_laporan, catatan_umum, kunjungan, biaya } = req.body;
  const totalBiaya = Array.isArray(biaya) ? biaya.reduce((s, b) => s + (Number(b.jumlah) || 0), 0) : laporan.total_biaya;

  db.prepare('UPDATE sppd_laporan SET tanggal_laporan=?, isi_laporan=?, catatan_umum=?, total_biaya=? WHERE id=?')
    .run(tanggal_laporan || '', isi_laporan || '', catatan_umum || '', totalBiaya, laporan.id);

  if (Array.isArray(kunjungan)) {
    db.prepare('DELETE FROM sppd_laporan_kunjungan WHERE laporan_id = ?').run(laporan.id);
    const ins = db.prepare('INSERT INTO sppd_laporan_kunjungan (laporan_id, tanggal, nama_instansi, nama_kontak, nama_pelanggan, laporan_kunjungan, hasil) VALUES (?, ?, ?, ?, ?, ?, ?)');
    kunjungan.forEach(k => ins.run(laporan.id, k.tanggal || '', k.nama_instansi || '', k.nama_kontak || '', k.nama_pelanggan || '', k.laporan_kunjungan || '', k.hasil || ''));
  }

  if (Array.isArray(biaya)) {
    db.prepare('DELETE FROM sppd_laporan_biaya WHERE laporan_id = ?').run(laporan.id);
    const ins = db.prepare('INSERT INTO sppd_laporan_biaya (laporan_id, keterangan, jumlah, bukti) VALUES (?, ?, ?, ?)');
    biaya.forEach(b => ins.run(laporan.id, b.keterangan || '', Number(b.jumlah) || 0, b.bukti || null));
  }

  res.json({ success: true });
});

// ── Approve Laporan (6-level, same as KK) ────────────────────────────────────
// laporan_approval_level: 1=waiting AM, 2=waiting MK, 3=GM stage, 5=waiting DO, 6=waiting DU
router.post('/:id/laporan/approve', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });

  const laporan = db.prepare('SELECT * FROM sppd_laporan WHERE sppd_id = ?').get(req.params.id);
  if (!laporan) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  if (laporan.status !== 'pending') return res.status(400).json({ error: 'Laporan sudah diproses' });

  const { note } = req.body;
  const currLvl = laporan.laporan_approval_level;

  const ins = (level) =>
    db.prepare("INSERT INTO sppd_laporan_approvals (laporan_id,level,approver_user_id,status,note,acted_at) VALUES (?,?,?,'approved',?,datetime('now','localtime'))")
      .run(laporan.id, level, user.id, note || '');

  const advance = (nextLvl) => {
    if (nextLvl > LP_MAX) {
      // Final approval
      db.prepare("UPDATE sppd_laporan SET status='approved', laporan_approval_level=7 WHERE id=?").run(laporan.id);
      db.prepare("UPDATE sppd SET status='completed' WHERE id=?").run(sppd.id);
      const existing = db.prepare('SELECT id FROM sppd_pencairan WHERE sppd_id=?').get(sppd.id);
      if (!existing) {
        db.prepare("INSERT INTO sppd_pencairan (sppd_id,jumlah_usulan,jumlah_realisasi,status,pencairan_approval_level) VALUES (?,?,?,'belum_cair',1)")
          .run(sppd.id, sppd.uang_muka || 0, laporan.total_biaya || 0);
      }
    } else {
      db.prepare('UPDATE sppd_laporan SET laporan_approval_level=? WHERE id=?').run(nextLvl, laporan.id);
    }
  };

  if (user.role === 'area_manager') {
    if (currLvl !== 1) return res.status(403).json({ error: 'Bukan giliran Area Manager' });
    const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by);
    if ((creator?.area_kerja || '').trim().toLowerCase() !== (user.area_kerja || '').trim().toLowerCase())
      return res.status(403).json({ error: 'Area tidak sesuai' });
    ins(1); advance(2);

  } else if (user.role === 'manager_keuangan') {
    if (currLvl !== 2) return res.status(403).json({ error: 'Bukan giliran Manager Keuangan' });
    ins(2); advance(3);

  } else if (user.role === 'gm') {
    if (currLvl !== 3) return res.status(403).json({ error: 'Bukan giliran GM' });
    if (db.prepare("SELECT id FROM sppd_laporan_approvals WHERE laporan_id=? AND level=3").get(laporan.id))
      return res.status(400).json({ error: 'Anda sudah menyetujui laporan ini' });
    ins(3); advance(checkGmParallel('sppd_laporan_approvals', 'laporan_id', laporan.id));

  } else if (user.role === 'gm2') {
    if (currLvl !== 3) return res.status(403).json({ error: 'Bukan giliran GM 2' });
    if (db.prepare("SELECT id FROM sppd_laporan_approvals WHERE laporan_id=? AND level=4").get(laporan.id))
      return res.status(400).json({ error: 'Anda sudah menyetujui laporan ini' });
    ins(4); advance(checkGmParallel('sppd_laporan_approvals', 'laporan_id', laporan.id));

  } else if (user.role === 'direktur_ops') {
    if (currLvl !== 5) return res.status(403).json({ error: 'Bukan giliran Direktur Operasional' });
    ins(5); advance(6);

  } else if (user.role === 'direktur_utama') {
    if (currLvl !== 6) return res.status(403).json({ error: 'Bukan giliran Direktur Utama' });
    ins(6); advance(7);

  } else if (user.role === 'admin') {
    if (currLvl === 3) {
      // Parallel GM: approve whichever is pending
      if (!db.prepare("SELECT id FROM sppd_laporan_approvals WHERE laporan_id=? AND level=3").get(laporan.id)) ins(3);
      if (!db.prepare("SELECT id FROM sppd_laporan_approvals WHERE laporan_id=? AND level=4").get(laporan.id)) ins(4);
      advance(5);
    } else {
      const levelMap = { 1:1, 2:2, 5:5, 6:6 };
      const approvalLevel = levelMap[currLvl] || currLvl;
      ins(approvalLevel);
      advance(currLvl === 6 ? 7 : currLvl + 1);
    }
  } else {
    return res.status(403).json({ error: 'Tidak berwenang' });
  }

  res.json({ success: true });
});

// ── Reject Laporan (6-level, same as KK) ─────────────────────────────────────
router.post('/:id/laporan/reject', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });

  const laporan = db.prepare('SELECT * FROM sppd_laporan WHERE sppd_id = ?').get(req.params.id);
  if (!laporan) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  if (laporan.status !== 'pending') return res.status(400).json({ error: 'Laporan sudah diproses' });

  const { note } = req.body;
  const currLvl = laporan.laporan_approval_level;
  let rejLevel;

  if (user.role === 'area_manager') {
    if (currLvl !== 1) return res.status(403).json({ error: 'Tidak berwenang' });
    const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by);
    if ((creator?.area_kerja || '').trim().toLowerCase() !== (user.area_kerja || '').trim().toLowerCase())
      return res.status(403).json({ error: 'Area tidak sesuai' });
    rejLevel = 1;
  } else if (user.role === 'manager_keuangan') {
    if (currLvl !== 2) return res.status(403).json({ error: 'Tidak berwenang' });
    rejLevel = 2;
  } else if (user.role === 'gm') {
    if (currLvl !== 3) return res.status(403).json({ error: 'Tidak berwenang' });
    rejLevel = 3;
  } else if (user.role === 'gm2') {
    if (currLvl !== 3) return res.status(403).json({ error: 'Tidak berwenang' });
    rejLevel = 4;
  } else if (user.role === 'direktur_ops') {
    if (currLvl !== 5) return res.status(403).json({ error: 'Tidak berwenang' });
    rejLevel = 5;
  } else if (user.role === 'direktur_utama') {
    if (currLvl !== 6) return res.status(403).json({ error: 'Tidak berwenang' });
    rejLevel = 6;
  } else if (user.role === 'admin') {
    const lvlMap = { 1:1, 2:2, 3:3, 5:5, 6:6 };
    rejLevel = lvlMap[currLvl] || currLvl;
  } else {
    return res.status(403).json({ error: 'Tidak berwenang' });
  }

  db.prepare("INSERT INTO sppd_laporan_approvals (laporan_id,level,approver_user_id,status,note,acted_at) VALUES (?,?,?,'rejected',?,datetime('now','localtime'))")
    .run(laporan.id, rejLevel, user.id, note || '');
  db.prepare("UPDATE sppd_laporan SET status='rejected' WHERE id=?").run(laporan.id);

  res.json({ success: true });
});

// ── Approve Pencairan (6-level, same as KK) ───────────────────────────────────
// pencairan_approval_level: 1=AM, 2=MK, 3=GM stage, 5=DO, 6=DU → 7=done (sudah_cair)
router.post('/:id/pencairan/approve', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });

  const pencairan = db.prepare('SELECT * FROM sppd_pencairan WHERE sppd_id = ?').get(req.params.id);
  if (!pencairan) return res.status(404).json({ error: 'Pencairan tidak ditemukan' });
  if (pencairan.status === 'sudah_cair') return res.status(400).json({ error: 'Pencairan sudah selesai' });

  const { note } = req.body;
  const currLvl = pencairan.pencairan_approval_level;

  const ins = (level) =>
    db.prepare("INSERT INTO sppd_pencairan_approvals (pencairan_id,level,approver_user_id,status,note,acted_at) VALUES (?,?,?,'approved',?,datetime('now','localtime'))")
      .run(pencairan.id, level, user.id, note || '');

  const advance = (nextLvl) => {
    if (nextLvl > LP_MAX) {
      db.prepare("UPDATE sppd_pencairan SET status='sudah_cair', pencairan_approval_level=7, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?")
        .run(user.id, pencairan.id);
    } else {
      db.prepare('UPDATE sppd_pencairan SET pencairan_approval_level=? WHERE id=?').run(nextLvl, pencairan.id);
    }
  };

  if (user.role === 'area_manager') {
    if (currLvl !== 1) return res.status(403).json({ error: 'Bukan giliran Area Manager' });
    const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by);
    if ((creator?.area_kerja || '').trim().toLowerCase() !== (user.area_kerja || '').trim().toLowerCase())
      return res.status(403).json({ error: 'Area tidak sesuai' });
    ins(1); advance(2);
  } else if (user.role === 'manager_keuangan') {
    if (currLvl !== 2) return res.status(403).json({ error: 'Bukan giliran Manager Keuangan' });
    ins(2); advance(3);
  } else if (user.role === 'gm') {
    if (currLvl !== 3) return res.status(403).json({ error: 'Bukan giliran GM' });
    if (db.prepare("SELECT id FROM sppd_pencairan_approvals WHERE pencairan_id=? AND level=3").get(pencairan.id))
      return res.status(400).json({ error: 'Anda sudah menyetujui pencairan ini' });
    ins(3); advance(checkGmParallel('sppd_pencairan_approvals', 'pencairan_id', pencairan.id));
  } else if (user.role === 'gm2') {
    if (currLvl !== 3) return res.status(403).json({ error: 'Bukan giliran GM 2' });
    if (db.prepare("SELECT id FROM sppd_pencairan_approvals WHERE pencairan_id=? AND level=4").get(pencairan.id))
      return res.status(400).json({ error: 'Anda sudah menyetujui pencairan ini' });
    ins(4); advance(checkGmParallel('sppd_pencairan_approvals', 'pencairan_id', pencairan.id));
  } else if (user.role === 'direktur_ops') {
    if (currLvl !== 5) return res.status(403).json({ error: 'Bukan giliran Direktur Operasional' });
    ins(5); advance(6);
  } else if (user.role === 'direktur_utama') {
    if (currLvl !== 6) return res.status(403).json({ error: 'Bukan giliran Direktur Utama' });
    ins(6); advance(7);
  } else if (user.role === 'admin') {
    if (currLvl === 3) {
      if (!db.prepare("SELECT id FROM sppd_pencairan_approvals WHERE pencairan_id=? AND level=3").get(pencairan.id)) ins(3);
      if (!db.prepare("SELECT id FROM sppd_pencairan_approvals WHERE pencairan_id=? AND level=4").get(pencairan.id)) ins(4);
      advance(5);
    } else {
      const levelMap = { 1:1, 2:2, 5:5, 6:6 };
      ins(levelMap[currLvl] || currLvl);
      advance(currLvl === 6 ? 7 : currLvl + 1);
    }
  } else {
    return res.status(403).json({ error: 'Tidak berwenang' });
  }

  res.json({ success: true });
});

// ── Reject Pencairan (6-level) ────────────────────────────────────────────────
router.post('/:id/pencairan/reject', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });

  const pencairan = db.prepare('SELECT * FROM sppd_pencairan WHERE sppd_id = ?').get(req.params.id);
  if (!pencairan) return res.status(404).json({ error: 'Pencairan tidak ditemukan' });
  if (pencairan.status === 'sudah_cair') return res.status(400).json({ error: 'Pencairan sudah selesai' });

  const { note } = req.body;
  const currLvl = pencairan.pencairan_approval_level;
  let rejLevel;

  if (user.role === 'area_manager') {
    if (currLvl !== 1) return res.status(403).json({ error: 'Tidak berwenang' });
    const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by);
    if ((creator?.area_kerja || '').trim().toLowerCase() !== (user.area_kerja || '').trim().toLowerCase())
      return res.status(403).json({ error: 'Area tidak sesuai' });
    rejLevel = 1;
  } else if (user.role === 'manager_keuangan') {
    if (currLvl !== 2) return res.status(403).json({ error: 'Tidak berwenang' });
    rejLevel = 2;
  } else if (user.role === 'gm') {
    if (currLvl !== 3) return res.status(403).json({ error: 'Tidak berwenang' });
    rejLevel = 3;
  } else if (user.role === 'gm2') {
    if (currLvl !== 3) return res.status(403).json({ error: 'Tidak berwenang' });
    rejLevel = 4;
  } else if (user.role === 'direktur_ops') {
    if (currLvl !== 5) return res.status(403).json({ error: 'Tidak berwenang' });
    rejLevel = 5;
  } else if (user.role === 'direktur_utama') {
    if (currLvl !== 6) return res.status(403).json({ error: 'Tidak berwenang' });
    rejLevel = 6;
  } else if (user.role === 'admin') {
    const lvlMap = { 1:1, 2:2, 3:3, 5:5, 6:6 };
    rejLevel = lvlMap[currLvl] || currLvl;
  } else {
    return res.status(403).json({ error: 'Tidak berwenang' });
  }

  db.prepare("INSERT INTO sppd_pencairan_approvals (pencairan_id,level,approver_user_id,status,note,acted_at) VALUES (?,?,?,'rejected',?,datetime('now','localtime'))")
    .run(pencairan.id, rejLevel, user.id, note || '');
  db.prepare("UPDATE sppd_pencairan SET status='ditolak', updated_by=?, updated_at=datetime('now','localtime') WHERE id=?")
    .run(user.id, pencairan.id);

  res.json({ success: true });
});

// ── Get Pencairan ─────────────────────────────────────────────────────────────
router.get('/:id/pencairan', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sppd.created_by);
  const isSameArea = user.role === 'area_manager' && (creator?.area_kerja || '').trim().toLowerCase() === (user.area_kerja || '').trim().toLowerCase();
  if (!canSeeAll(user.role) && sppd.created_by !== user.id && !isSameArea) return res.status(403).json({ error: 'Forbidden' });

  const pencairan = db.prepare(`
    SELECT p.*, u.full_name AS updated_by_name
    FROM sppd_pencairan p LEFT JOIN users u ON p.updated_by = u.id
    WHERE p.sppd_id = ?
  `).get(req.params.id);
  if (!pencairan) return res.json(null);
  const approvals = db.prepare(`
    SELECT pa.*, u.full_name AS approver_name
    FROM sppd_pencairan_approvals pa LEFT JOIN users u ON pa.approver_user_id = u.id
    WHERE pa.pencairan_id = ? ORDER BY pa.level
  `).all(pencairan.id);
  res.json({ ...pencairan, approvals });
});

// ── Update Pencairan status (manager_keuangan) ────────────────────────────────
router.put('/:id/pencairan', (req, res) => {
  const user = req.session.user;
  if (user.role !== 'manager_keuangan' && user.role !== 'admin')
    return res.status(403).json({ error: 'Hanya manager_keuangan yang bisa memproses pencairan' });

  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });

  const pencairan = db.prepare('SELECT * FROM sppd_pencairan WHERE sppd_id = ?').get(req.params.id);
  if (!pencairan) return res.status(404).json({ error: 'Pencairan tidak ditemukan' });

  const { status, jumlah_dicairkan, catatan } = req.body;
  const validStatus = ['belum_cair', 'dalam_proses', 'sudah_cair'];
  if (!validStatus.includes(status)) return res.status(400).json({ error: 'Status tidak valid' });

  db.prepare(`UPDATE sppd_pencairan SET status=?, jumlah_dicairkan=?, catatan=?, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(status, Number(jumlah_dicairkan) || pencairan.jumlah_dicairkan, catatan !== undefined ? catatan : pencairan.catatan, user.id, pencairan.id);

  res.json({ success: true });
});

module.exports = router;
