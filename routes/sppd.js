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
const SPPD_LEVEL_ROLES  = { 1: 'area_manager', 2: 'gm', 3: 'gm2' };
const LAPORAN_LEVEL_ROLES = { 1: 'supervisor', 2: 'area_manager', 3: 'gm', 4: 'gm2' };

function canSeeAll(role) {
  return ['admin', 'kantor_pusat', 'area_manager', 'gm', 'gm2', 'manager_keuangan'].includes(role);
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

// ── List SPPD ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { role, id } = req.session.user;
  let rows;
  if (canSeeAll(role)) {
    rows = db.prepare(`
      SELECT s.*, u.full_name AS creator_name
      FROM sppd s JOIN users u ON s.created_by = u.id
      ORDER BY s.created_at DESC
    `).all();
  } else {
    rows = db.prepare(`
      SELECT s.*, u.full_name AS creator_name
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
  const {
    nama_pegawai, jabatan, area_kerja, tujuan, keperluan,
    tanggal_berangkat, tanggal_kembali, transport, uang_muka, itinerary
  } = req.body;

  const nomor = `SPPD-${Date.now()}`;
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
      INSERT INTO sppd_itinerary (sppd_id, tanggal, dari, ke, transport, keterangan)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    itinerary.forEach(r => ins.run(sppdId, r.tanggal || '', r.dari || '', r.ke || '', r.transport || '', r.keterangan || ''));
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
      <td>${esc(r.dari)}</td>
      <td>${esc(r.ke)}</td>
      <td>${esc(r.transport)}</td>
      <td>${esc(r.keterangan)}</td>
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
  <thead><tr><th>Tanggal</th><th>Dari</th><th>Ke</th><th>Transportasi</th><th>Keterangan</th></tr></thead>
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
    SELECT s.*, u.full_name AS creator_name
    FROM sppd s JOIN users u ON s.created_by = u.id WHERE s.id = ?
  `).get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (!canSeeAll(user.role) && sppd.created_by !== user.id) return res.status(403).json({ error: 'Forbidden' });
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
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
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

// ── Get SPPD detail ───────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare(`
    SELECT s.*, u.full_name AS creator_name
    FROM sppd s JOIN users u ON s.created_by = u.id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (!canSeeAll(user.role) && sppd.created_by !== user.id) return res.status(403).json({ error: 'Forbidden' });

  const itinerary = db.prepare('SELECT * FROM sppd_itinerary WHERE sppd_id = ? ORDER BY id').all(req.params.id);
  const approvals = db.prepare(`
    SELECT sa.*, u.full_name AS approver_name
    FROM sppd_approvals sa LEFT JOIN users u ON sa.approver_user_id = u.id
    WHERE sa.sppd_id = ? ORDER BY sa.level
  `).all(req.params.id);

  res.json({ ...sppd, itinerary, approvals });
});

// ── Update SPPD ───────────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (sppd.created_by !== user.id && user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  if (sppd.status !== 'pending' || sppd.sppd_approval_level > 0)
    return res.status(400).json({ error: 'Tidak bisa diedit setelah proses approval dimulai' });

  const {
    nama_pegawai, jabatan, area_kerja, tujuan, keperluan,
    tanggal_berangkat, tanggal_kembali, transport, uang_muka, itinerary
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
      INSERT INTO sppd_itinerary (sppd_id, tanggal, dari, ke, transport, keterangan)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    itinerary.forEach(r => ins.run(req.params.id, r.tanggal || '', r.dari || '', r.ke || '', r.transport || '', r.keterangan || ''));
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
router.post('/:id/approve', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (sppd.status !== 'pending') return res.status(400).json({ error: 'SPPD sudah diproses' });

  const nextLevel = sppd.sppd_approval_level + 1;
  const expectedRole = SPPD_LEVEL_ROLES[nextLevel];
  if (!expectedRole) return res.status(400).json({ error: 'Level approval tidak valid' });
  if (user.role !== expectedRole && user.role !== 'admin')
    return res.status(403).json({ error: `Hanya ${expectedRole} yang bisa menyetujui di level ini` });

  const { note } = req.body;
  db.prepare(`
    INSERT INTO sppd_approvals (sppd_id, level, approver_user_id, status, note, acted_at)
    VALUES (?, ?, ?, 'approved', ?, datetime('now','localtime'))
  `).run(sppd.id, nextLevel, user.id, note || '');

  if (nextLevel >= 3) {
    db.prepare("UPDATE sppd SET status='approved', sppd_approval_level=? WHERE id=?").run(nextLevel, sppd.id);
  } else {
    db.prepare('UPDATE sppd SET sppd_approval_level=? WHERE id=?').run(nextLevel, sppd.id);
  }

  res.json({ success: true });
});

// ── Reject SPPD ───────────────────────────────────────────────────────────────
router.post('/:id/reject', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (sppd.status !== 'pending') return res.status(400).json({ error: 'SPPD sudah diproses' });

  const nextLevel = sppd.sppd_approval_level + 1;
  const expectedRole = SPPD_LEVEL_ROLES[nextLevel];
  if (!expectedRole) return res.status(400).json({ error: 'Level approval tidak valid' });
  if (user.role !== expectedRole && user.role !== 'admin')
    return res.status(403).json({ error: `Hanya ${expectedRole} yang bisa menolak di level ini` });

  const { note } = req.body;
  db.prepare(`
    INSERT INTO sppd_approvals (sppd_id, level, approver_user_id, status, note, acted_at)
    VALUES (?, ?, ?, 'rejected', ?, datetime('now','localtime'))
  `).run(sppd.id, nextLevel, user.id, note || '');

  db.prepare("UPDATE sppd SET status='rejected', sppd_approval_level=?, reject_reason=? WHERE id=?")
    .run(nextLevel, note || '', sppd.id);

  res.json({ success: true });
});

// ── Get Laporan ───────────────────────────────────────────────────────────────
router.get('/:id/laporan', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (!canSeeAll(user.role) && sppd.created_by !== user.id) return res.status(403).json({ error: 'Forbidden' });

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

  const { tanggal_laporan, isi_laporan, kunjungan, biaya } = req.body;
  const totalBiaya = Array.isArray(biaya) ? biaya.reduce((s, b) => s + (Number(b.jumlah) || 0), 0) : 0;

  const result = db.prepare(`
    INSERT INTO sppd_laporan (sppd_id, tanggal_laporan, isi_laporan, total_biaya)
    VALUES (?, ?, ?, ?)
  `).run(req.params.id, tanggal_laporan || '', isi_laporan || '', totalBiaya);
  const laporanId = result.lastInsertRowid;

  if (Array.isArray(kunjungan) && kunjungan.length) {
    const ins = db.prepare('INSERT INTO sppd_laporan_kunjungan (laporan_id, tanggal, nama_instansi, nama_kontak, hasil) VALUES (?, ?, ?, ?, ?)');
    kunjungan.forEach(k => ins.run(laporanId, k.tanggal || '', k.nama_instansi || '', k.nama_kontak || '', k.hasil || ''));
  }

  if (Array.isArray(biaya) && biaya.length) {
    const ins = db.prepare('INSERT INTO sppd_laporan_biaya (laporan_id, keterangan, jumlah) VALUES (?, ?, ?)');
    biaya.forEach(b => ins.run(laporanId, b.keterangan || '', Number(b.jumlah) || 0));
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

  const { tanggal_laporan, isi_laporan, kunjungan, biaya } = req.body;
  const totalBiaya = Array.isArray(biaya) ? biaya.reduce((s, b) => s + (Number(b.jumlah) || 0), 0) : laporan.total_biaya;

  db.prepare('UPDATE sppd_laporan SET tanggal_laporan=?, isi_laporan=?, total_biaya=? WHERE id=?')
    .run(tanggal_laporan || '', isi_laporan || '', totalBiaya, laporan.id);

  if (Array.isArray(kunjungan)) {
    db.prepare('DELETE FROM sppd_laporan_kunjungan WHERE laporan_id = ?').run(laporan.id);
    const ins = db.prepare('INSERT INTO sppd_laporan_kunjungan (laporan_id, tanggal, nama_instansi, nama_kontak, hasil) VALUES (?, ?, ?, ?, ?)');
    kunjungan.forEach(k => ins.run(laporan.id, k.tanggal || '', k.nama_instansi || '', k.nama_kontak || '', k.hasil || ''));
  }

  if (Array.isArray(biaya)) {
    db.prepare('DELETE FROM sppd_laporan_biaya WHERE laporan_id = ?').run(laporan.id);
    const ins = db.prepare('INSERT INTO sppd_laporan_biaya (laporan_id, keterangan, jumlah) VALUES (?, ?, ?)');
    biaya.forEach(b => ins.run(laporan.id, b.keterangan || '', Number(b.jumlah) || 0));
  }

  res.json({ success: true });
});

// ── Approve Laporan ───────────────────────────────────────────────────────────
router.post('/:id/laporan/approve', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });

  const laporan = db.prepare('SELECT * FROM sppd_laporan WHERE sppd_id = ?').get(req.params.id);
  if (!laporan) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  if (laporan.status !== 'pending') return res.status(400).json({ error: 'Laporan sudah diproses' });

  const nextLevel = laporan.laporan_approval_level + 1;
  const expectedRole = LAPORAN_LEVEL_ROLES[nextLevel];
  if (!expectedRole) return res.status(400).json({ error: 'Level approval tidak valid' });
  if (user.role !== expectedRole && user.role !== 'admin')
    return res.status(403).json({ error: `Hanya ${expectedRole} yang bisa menyetujui di level ini` });

  const { note } = req.body;
  db.prepare(`
    INSERT INTO sppd_laporan_approvals (laporan_id, level, approver_user_id, status, note, acted_at)
    VALUES (?, ?, ?, 'approved', ?, datetime('now','localtime'))
  `).run(laporan.id, nextLevel, user.id, note || '');

  if (nextLevel >= 4) {
    db.prepare("UPDATE sppd_laporan SET status='approved', laporan_approval_level=? WHERE id=?").run(nextLevel, laporan.id);
    db.prepare("UPDATE sppd SET status='completed' WHERE id=?").run(sppd.id);
  } else {
    db.prepare('UPDATE sppd_laporan SET laporan_approval_level=? WHERE id=?').run(nextLevel, laporan.id);
  }

  res.json({ success: true });
});

// ── Reject Laporan ────────────────────────────────────────────────────────────
router.post('/:id/laporan/reject', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });

  const laporan = db.prepare('SELECT * FROM sppd_laporan WHERE sppd_id = ?').get(req.params.id);
  if (!laporan) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  if (laporan.status !== 'pending') return res.status(400).json({ error: 'Laporan sudah diproses' });

  const nextLevel = laporan.laporan_approval_level + 1;
  const expectedRole = LAPORAN_LEVEL_ROLES[nextLevel];
  if (!expectedRole) return res.status(400).json({ error: 'Level approval tidak valid' });
  if (user.role !== expectedRole && user.role !== 'admin')
    return res.status(403).json({ error: `Hanya ${expectedRole} yang bisa menolak di level ini` });

  const { note } = req.body;
  db.prepare(`
    INSERT INTO sppd_laporan_approvals (laporan_id, level, approver_user_id, status, note, acted_at)
    VALUES (?, ?, ?, 'rejected', ?, datetime('now','localtime'))
  `).run(laporan.id, nextLevel, user.id, note || '');

  db.prepare("UPDATE sppd_laporan SET status='rejected', laporan_approval_level=? WHERE id=?")
    .run(nextLevel, laporan.id);

  res.json({ success: true });
});

// ── Get Pencairan ─────────────────────────────────────────────────────────────
router.get('/:id/pencairan', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (!canSeeAll(user.role) && sppd.created_by !== user.id) return res.status(403).json({ error: 'Forbidden' });

  const pencairan = db.prepare(`
    SELECT p.*, u.full_name AS approver_name
    FROM sppd_pencairan p LEFT JOIN users u ON p.approved_by = u.id
    WHERE p.sppd_id = ?
  `).get(req.params.id);
  res.json(pencairan || null);
});

// ── Submit Pencairan ──────────────────────────────────────────────────────────
router.post('/:id/pencairan', (req, res) => {
  const user = req.session.user;
  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });
  if (sppd.created_by !== user.id && user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  if (!['approved', 'completed'].includes(sppd.status)) return res.status(400).json({ error: 'SPPD belum disetujui' });
  if (db.prepare('SELECT id FROM sppd_pencairan WHERE sppd_id = ?').get(req.params.id))
    return res.status(400).json({ error: 'Pencairan sudah diajukan' });

  const { jumlah_diajukan, catatan } = req.body;
  db.prepare('INSERT INTO sppd_pencairan (sppd_id, jumlah_diajukan, catatan) VALUES (?, ?, ?)')
    .run(req.params.id, Number(jumlah_diajukan) || 0, catatan || '');
  res.json({ success: true });
});

// ── Approve / Reject Pencairan (manager_keuangan) ─────────────────────────────
router.post('/:id/pencairan/approve', (req, res) => {
  const user = req.session.user;
  if (user.role !== 'manager_keuangan' && user.role !== 'admin')
    return res.status(403).json({ error: 'Hanya manager_keuangan yang bisa memproses pencairan' });

  const sppd = db.prepare('SELECT * FROM sppd WHERE id = ?').get(req.params.id);
  if (!sppd) return res.status(404).json({ error: 'SPPD tidak ditemukan' });

  const pencairan = db.prepare('SELECT * FROM sppd_pencairan WHERE sppd_id = ?').get(req.params.id);
  if (!pencairan) return res.status(404).json({ error: 'Pencairan tidak ditemukan' });
  if (pencairan.status !== 'pending') return res.status(400).json({ error: 'Pencairan sudah diproses' });

  const { jumlah_disetujui, catatan, action } = req.body;

  if (action === 'reject') {
    db.prepare(`UPDATE sppd_pencairan SET status='rejected', catatan=?, approved_by=?, approved_at=datetime('now','localtime') WHERE id=?`)
      .run(catatan || '', user.id, pencairan.id);
  } else {
    db.prepare(`UPDATE sppd_pencairan SET status='approved', jumlah_disetujui=?, catatan=?, approved_by=?, approved_at=datetime('now','localtime') WHERE id=?`)
      .run(Number(jumlah_disetujui) || pencairan.jumlah_diajukan, catatan || '', user.id, pencairan.id);
  }

  res.json({ success: true });
});

module.exports = router;
