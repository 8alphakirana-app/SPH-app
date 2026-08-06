const express = require('express');
const router = express.Router();
const db = require('../database');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
router.use(requireLogin);

function blockViewer(req, res, next) {
  if (req.session.user?.role === 'viewer') {
    return res.status(403).json({ error: 'Viewer hanya dapat melihat data' });
  }
  next();
}

function canSeeAllAreas(role) {
  return ['admin', 'kantor_pusat', 'gm', 'gm2', 'manager_keuangan', 'direktur_ops', 'direktur_utama', 'viewer'].includes(role);
}
function canSeeAll(role) {
  return canSeeAllAreas(role) || role === 'area_manager';
}
function canReview(role) {
  return ['admin', 'gm', 'gm2'].includes(role);
}
function blockNonReviewer(req, res, next) {
  if (!canReview(req.session.user?.role)) {
    return res.status(403).json({ error: 'Hanya GM1, GM2, dan Admin' });
  }
  next();
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
      lb.rencana_bulan_depan, lb.prognosa_bulan_depan, lb.isu_bulan_ini, lb.updated_at,
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

// GET /api/laporan/rekap-excel — unduh rekap project per area dalam format Excel
router.get('/rekap-excel', (req, res) => {
  const user = req.session.user;
  const { periode, area_kerja, user_id } = req.query;

  let sql = `
    SELECT lb.id, lb.user_id, lb.periode, lb.prognosa_bulan_depan,
           u.full_name, u.area_kerja
    FROM laporan_bulanan lb
    JOIN users u ON lb.user_id = u.id
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
  sql += ' ORDER BY u.area_kerja ASC, u.full_name ASC';

  let rows;
  try {
    rows = db.prepare(sql).all(...params);
    attachDetails(rows);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DMS LAK';
  wb.created = new Date();

  const safePeriode = (periode || 'semua').replace(/[^a-zA-Z0-9-]/g, '');
  const safeArea   = (area_kerja || 'semua-area').replace(/[^a-zA-Z0-9-]/g, '_');
  const filename   = `rekap-project_${safeArea}_${safePeriode}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  if (!rows.length) {
    const ws = wb.addWorksheet('Rekap Project');
    ws.addRow(['Tidak ada data laporan untuk filter yang dipilih.']);
    return wb.xlsx.write(res).then(() => res.end()).catch(e => res.end());
  }

  // Kelompokkan per area
  const byArea = {};
  rows.forEach(r => {
    const key = r.area_kerja || 'Tanpa Area';
    if (!byArea[key]) byArea[key] = [];
    byArea[key].push(r);
  });

  const periodeLabel = periode
    ? new Date(periode + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
    : 'Semua Periode';

  const HDR_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  const HDR_FONT  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  const SUB_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  const SUB_FONT  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  const TOT_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  const TOT_FONT  = { bold: true, size: 10 };
  const THIN      = { style: 'thin', color: { argb: 'FFCBD5E1' } };
  const BORDER    = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  const COLS      = ['A','B','C','D','E','F','G','H'];

  function applyBorder(row) {
    row.eachCell({ includeEmpty: true }, cell => { cell.border = BORDER; });
  }

  function buildAreaSheet(ws, areaName, laporanList) {
    ws.columns = [
      { key: 'no',       width: 5  },
      { key: 'salesman', width: 22 },
      { key: 'pelanggan',width: 24 },
      { key: 'principal',width: 18 },
      { key: 'produk',   width: 20 },
      { key: 'nilai',    width: 18 },
      { key: 'prob',     width: 12 },
      { key: 'prognosa', width: 20 },
    ];
    const titleRow = ws.addRow([`REKAP PROJECT - ${areaName.toUpperCase()}`]);
    ws.mergeCells(`A${titleRow.number}:H${titleRow.number}`);
    titleRow.getCell('A').font = { bold: true, size: 13, color: { argb: 'FF1E3A5F' } };
    titleRow.getCell('A').alignment = { horizontal: 'center' };
    titleRow.height = 22;
    const subTitle = ws.addRow([`Periode: ${periodeLabel}   |   Dicetak: ${new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' })}`]);
    ws.mergeCells(`A${subTitle.number}:H${subTitle.number}`);
    subTitle.getCell('A').font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
    subTitle.getCell('A').alignment = { horizontal: 'center' };
    ws.addRow([]);
    const hdr = ws.addRow(['No', 'Salesman', 'Pelanggan', 'Principal', 'Produk', 'Nilai Project (Rp)', 'Prob (%)', 'Prognosa Bln Depan (Rp)']);
    hdr.eachCell(cell => { cell.fill = HDR_FILL; cell.font = HDR_FONT; cell.alignment = { horizontal: 'center', wrapText: true }; cell.border = BORDER; });
    hdr.height = 28;

    let no = 1, totalNilai = 0, totalPrognosa = 0;
    laporanList.forEach(lap => {
      const prognosa = lap.prognosa_bulan_depan || 0;
      totalPrognosa += prognosa;
      const projects = lap.projects || [];
      if (!projects.length) {
        const r = ws.addRow([no++, lap.full_name, '-', '-', '-', 0, '-', prognosa]);
        r.getCell('F').numFmt = '#,##0'; r.getCell('H').numFmt = '#,##0';
        r.getCell('F').alignment = { horizontal: 'right' }; r.getCell('H').alignment = { horizontal: 'right' };
        applyBorder(r);
      } else {
        projects.forEach((p, i) => {
          const nilai = p.nilai || 0;
          totalNilai += nilai;
          const r = ws.addRow([
            i === 0 ? no++ : '', i === 0 ? lap.full_name : '',
            p.pelanggan || '', p.principal || '', p.produk || '',
            nilai, p.probability != null ? p.probability : '', i === 0 ? prognosa : '',
          ]);
          r.getCell('F').numFmt = '#,##0'; r.getCell('H').numFmt = '#,##0';
          r.getCell('F').alignment = { horizontal: 'right' };
          r.getCell('G').alignment = { horizontal: 'center' };
          r.getCell('H').alignment = { horizontal: 'right' };
          applyBorder(r);
        });
      }
    });
    const totRow = ws.addRow(['', 'TOTAL', '', '', '', totalNilai, '', totalPrognosa]);
    ws.mergeCells(`B${totRow.number}:E${totRow.number}`);
    totRow.eachCell({ includeEmpty: true }, cell => { cell.fill = TOT_FILL; cell.font = TOT_FONT; cell.border = BORDER; });
    totRow.getCell('F').numFmt = '#,##0'; totRow.getCell('H').numFmt = '#,##0';
    totRow.getCell('B').alignment = { horizontal: 'center' };
    totRow.getCell('F').alignment = { horizontal: 'right' };
    totRow.getCell('H').alignment = { horizontal: 'right' };
    totRow.height = 20;
    return { totalNilai, totalPrognosa };
  }

  const areaEntries = Object.entries(byArea);

  // Sheet Ringkasan duluan jika lebih dari 1 area
  if (areaEntries.length > 1) {
    const wsSummary = wb.addWorksheet('Ringkasan');
    wsSummary.columns = [
      { key: 'area',    width: 22 }, { key: 'jml', width: 12 },
      { key: 'project', width: 12 }, { key: 'nilai', width: 22 }, { key: 'prognosa', width: 22 },
    ];
    const titleS = wsSummary.addRow(['RINGKASAN REKAP PROJECT SEMUA AREA']);
    wsSummary.mergeCells(`A${titleS.number}:E${titleS.number}`);
    titleS.getCell('A').font = { bold: true, size: 13, color: { argb: 'FF1E3A5F' } };
    titleS.getCell('A').alignment = { horizontal: 'center' };
    titleS.height = 22;
    const subS = wsSummary.addRow([`Periode: ${periodeLabel}`]);
    wsSummary.mergeCells(`A${subS.number}:E${subS.number}`);
    subS.getCell('A').font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
    subS.getCell('A').alignment = { horizontal: 'center' };
    wsSummary.addRow([]);
    const hdrS = wsSummary.addRow(['Area Kerja', 'Jml Laporan', 'Jml Project', 'Total Nilai (Rp)', 'Total Prognosa (Rp)']);
    hdrS.eachCell(cell => { cell.fill = HDR_FILL; cell.font = HDR_FONT; cell.border = BORDER; cell.alignment = { horizontal: 'center' }; });
    hdrS.height = 28;

    let grandNilai = 0, grandPrognosa = 0;
    areaEntries.forEach(([areaName, laporanList]) => {
      const jmlProject  = laporanList.reduce((s, l) => s + (l.projects || []).length, 0);
      const sumNilai    = laporanList.reduce((s, l) => s + (l.projects || []).reduce((ss, p) => ss + (p.nilai || 0), 0), 0);
      const sumPrognosa = laporanList.reduce((s, l) => s + (l.prognosa_bulan_depan || 0), 0);
      grandNilai += sumNilai; grandPrognosa += sumPrognosa;
      const r = wsSummary.addRow([areaName, laporanList.length, jmlProject, sumNilai, sumPrognosa]);
      r.getCell('D').numFmt = '#,##0'; r.getCell('E').numFmt = '#,##0';
      r.getCell('D').alignment = { horizontal: 'right' }; r.getCell('E').alignment = { horizontal: 'right' };
      applyBorder(r);
    });
    const totS = wsSummary.addRow(['TOTAL', '', '', grandNilai, grandPrognosa]);
    totS.eachCell({ includeEmpty: true }, cell => { cell.fill = TOT_FILL; cell.font = TOT_FONT; cell.border = BORDER; });
    totS.getCell('D').numFmt = '#,##0'; totS.getCell('E').numFmt = '#,##0';
    totS.getCell('D').alignment = { horizontal: 'right' }; totS.getCell('E').alignment = { horizontal: 'right' };
    totS.height = 20;
  }

  // Sheet per area
  areaEntries.forEach(([areaName, laporanList]) => {
    const ws = wb.addWorksheet(areaName.substring(0, 31));
    buildAreaSheet(ws, areaName, laporanList);
  });

  wb.xlsx.write(res).then(() => res.end()).catch(e => res.end());
});

// GET /api/laporan/rincian-prognosa-excel — unduh rincian prognosa (dashboard) dalam format Excel
router.get('/rincian-prognosa-excel', (req, res) => {
  const user = req.session.user;
  const { periode, area_kerja, user_id, prob } = req.query;

  let sql = `
    SELECT lb.id, lb.user_id, lb.periode,
           u.full_name, u.area_kerja
    FROM laporan_bulanan lb
    JOIN users u ON lb.user_id = u.id
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
  sql += ' ORDER BY u.area_kerja ASC, u.full_name ASC';

  let rows;
  try {
    rows = db.prepare(sql).all(...params);
    attachDetails(rows);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  // Ratakan semua project dari semua laporan, filter probability bila diminta
  const monthsID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  function periodeNextLabel(p) {
    if (!p) return '';
    const [y, m] = p.split('-').map(Number);
    const next = new Date(y, m, 1); // m sudah 1-based -> bulan berikutnya
    return `${monthsID[next.getMonth()]} ${next.getFullYear()}`;
  }

  let allProjects = [];
  rows.forEach(r => {
    (r.projects || []).forEach(p => {
      allProjects.push({
        full_name: r.full_name,
        area_kerja: r.area_kerja,
        pelanggan: p.pelanggan,
        principal: p.principal,
        produk: p.produk,
        nilai: p.nilai || 0,
        probability: p.probability != null ? p.probability : 0,
        periodeNext: periodeNextLabel(r.periode),
      });
    });
  });

  if (prob === 'ge70') allProjects = allProjects.filter(p => p.probability >= 70);
  else if (prob === 'lt70') allProjects = allProjects.filter(p => p.probability < 70);

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DMS LAK';
  wb.created = new Date();

  const safePeriode = (periode || 'semua').replace(/[^a-zA-Z0-9-]/g, '');
  const safeArea    = (area_kerja || 'semua-area').replace(/[^a-zA-Z0-9-]/g, '_');
  const safeProb     = prob === 'ge70' ? 'prob-ge70' : prob === 'lt70' ? 'prob-lt70' : 'semua-prob';
  const filename    = `rincian-prognosa_${safeArea}_${safePeriode}_${safeProb}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const ws = wb.addWorksheet('Rincian Prognosa');
  ws.columns = [
    { key: 'no',        width: 5  },
    { key: 'pelapor',   width: 22 },
    { key: 'area',      width: 16 },
    { key: 'pelanggan', width: 24 },
    { key: 'principal', width: 18 },
    { key: 'produk',    width: 20 },
    { key: 'nilai',     width: 18 },
    { key: 'prob',      width: 12 },
    { key: 'periode',   width: 16 },
  ];

  const HDR_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  const HDR_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  const TOT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  const TOT_FONT = { bold: true, size: 10 };
  const THIN     = { style: 'thin', color: { argb: 'FFCBD5E1' } };
  const BORDER   = { top: THIN, left: THIN, bottom: THIN, right: THIN };

  const periodeLabel = periode
    ? new Date(periode + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
    : 'Semua Periode';
  const probLabel = prob === 'ge70' ? 'Probability ≥ 70%' : prob === 'lt70' ? 'Probability < 70%' : 'Semua Probability';

  const titleRow = ws.addRow(['RINCIAN PROGNOSA']);
  ws.mergeCells(`A${titleRow.number}:I${titleRow.number}`);
  titleRow.getCell('A').font = { bold: true, size: 13, color: { argb: 'FF1E3A5F' } };
  titleRow.getCell('A').alignment = { horizontal: 'center' };
  titleRow.height = 22;

  const subTitle = ws.addRow([`Periode: ${periodeLabel}   |   Filter: ${probLabel}   |   Dicetak: ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}`]);
  ws.mergeCells(`A${subTitle.number}:I${subTitle.number}`);
  subTitle.getCell('A').font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
  subTitle.getCell('A').alignment = { horizontal: 'center' };
  ws.addRow([]);

  const hdr = ws.addRow(['No', 'Pelapor', 'Area', 'Pelanggan', 'Principal', 'Produk', 'Nilai (Rp)', 'Prob (%)', 'Periode']);
  hdr.eachCell(cell => { cell.fill = HDR_FILL; cell.font = HDR_FONT; cell.alignment = { horizontal: 'center', wrapText: true }; cell.border = BORDER; });
  hdr.height = 24;

  if (!allProjects.length) {
    const r = ws.addRow(['-', 'Tidak ada data untuk filter yang dipilih.']);
    ws.mergeCells(`B${r.number}:I${r.number}`);
  } else {
    let totalNilai = 0;
    allProjects.forEach((p, i) => {
      totalNilai += p.nilai;
      const r = ws.addRow([i + 1, p.full_name, p.area_kerja, p.pelanggan, p.principal, p.produk, p.nilai, p.probability, p.periodeNext]);
      r.getCell('G').numFmt = '#,##0';
      r.getCell('G').alignment = { horizontal: 'right' };
      r.getCell('H').alignment = { horizontal: 'center' };
      r.eachCell({ includeEmpty: true }, cell => { cell.border = BORDER; });
    });
    const totRow = ws.addRow(['', '', '', '', '', 'TOTAL', totalNilai, '', '']);
    ws.mergeCells(`A${totRow.number}:F${totRow.number}`);
    totRow.eachCell({ includeEmpty: true }, cell => { cell.fill = TOT_FILL; cell.font = TOT_FONT; cell.border = BORDER; });
    totRow.getCell('F').alignment = { horizontal: 'center' };
    totRow.getCell('G').numFmt = '#,##0';
    totRow.getCell('G').alignment = { horizontal: 'right' };
    totRow.height = 20;
  }

  wb.xlsx.write(res).then(() => res.end()).catch(e => res.end());
});

// GET /api/laporan/laporan-bulanan-excel — unduh laporan gabungan lengkap 1 bulan dalam format Excel
router.get('/laporan-bulanan-excel', (req, res) => {
  const user = req.session.user;
  const { periode, area_kerja, user_id } = req.query;

  let sql = `
    SELECT lb.id, lb.user_id, lb.periode, lb.alasan, lb.aktivitas_bulan_ini, lb.rencana_bulan_depan, lb.prognosa_bulan_depan, lb.isu_bulan_ini,
           u.full_name, u.area_kerja
    FROM laporan_bulanan lb
    JOIN users u ON lb.user_id = u.id
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
  sql += ' ORDER BY u.area_kerja ASC, u.full_name ASC';

  let rows;
  try {
    rows = db.prepare(sql).all(...params);
    attachDetails(rows);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DMS LAK';
  wb.created = new Date();

  const safePeriode = (periode || 'semua').replace(/[^a-zA-Z0-9-]/g, '');
  const safeArea    = (area_kerja || 'semua-area').replace(/[^a-zA-Z0-9-]/g, '_');
  const filename    = `laporan-bulanan_${safeArea}_${safePeriode}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const HDR_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  const HDR_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  const TOT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  const TOT_FONT = { bold: true, size: 10 };
  const THIN     = { style: 'thin', color: { argb: 'FFCBD5E1' } };
  const BORDER   = { top: THIN, left: THIN, bottom: THIN, right: THIN };

  const periodeLabel = periode
    ? new Date(periode + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
    : 'Semua Periode';

  const ws = wb.addWorksheet('Laporan Bulanan');
  ws.columns = [
    { key: 'no',        width: 5  },
    { key: 'nama',      width: 22 },
    { key: 'area',      width: 16 },
    { key: 'periode',   width: 14 },
    { key: 'alasan',    width: 32 },
    { key: 'aktivitas', width: 32 },
    { key: 'rencana',   width: 32 },
    { key: 'prognosa',  width: 18 },
    { key: 'support',   width: 36 },
    { key: 'isu',       width: 28 },
  ];

  const titleRow = ws.addRow(['LAPORAN BULANAN GABUNGAN']);
  ws.mergeCells(`A${titleRow.number}:J${titleRow.number}`);
  titleRow.getCell('A').font = { bold: true, size: 13, color: { argb: 'FF1E3A5F' } };
  titleRow.getCell('A').alignment = { horizontal: 'center' };
  titleRow.height = 22;

  const subTitle = ws.addRow([`Periode: ${periodeLabel}   |   Dicetak: ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}`]);
  ws.mergeCells(`A${subTitle.number}:J${subTitle.number}`);
  subTitle.getCell('A').font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
  subTitle.getCell('A').alignment = { horizontal: 'center' };
  ws.addRow([]);

  const hdr = ws.addRow(['No', 'Nama', 'Area', 'Periode', 'Alasan Tidak Tercapai', 'Aktivitas Bulan Ini', 'Rencana Bulan Depan', 'Prognosa (Rp)', 'Support yang Dibutuhkan', 'Isu Bulan Ini']);
  hdr.eachCell(cell => { cell.fill = HDR_FILL; cell.font = HDR_FONT; cell.alignment = { horizontal: 'center', wrapText: true }; cell.border = BORDER; });
  hdr.height = 26;

  if (!rows.length) {
    const r = ws.addRow(['-', 'Tidak ada data laporan untuk filter yang dipilih.']);
    ws.mergeCells(`B${r.number}:J${r.number}`);
  } else {
    let totalPrognosa = 0;
    rows.forEach((lap, i) => {
      const prognosa = lap.prognosa_bulan_depan || 0;
      totalPrognosa += prognosa;
      const supportText = (lap.support || []).map(s => `• ${s.keterangan}`).join('\n') || '-';
      const r = ws.addRow([
        i + 1, lap.full_name, lap.area_kerja, lap.periode, lap.alasan || '-',
        lap.aktivitas_bulan_ini || '-', lap.rencana_bulan_depan || '-', prognosa, supportText, lap.isu_bulan_ini || '-',
      ]);
      r.getCell('E').alignment = { wrapText: true, vertical: 'top' };
      r.getCell('F').alignment = { wrapText: true, vertical: 'top' };
      r.getCell('G').alignment = { wrapText: true, vertical: 'top' };
      r.getCell('H').numFmt = '#,##0';
      r.getCell('H').alignment = { horizontal: 'right', vertical: 'top' };
      r.getCell('I').alignment = { wrapText: true, vertical: 'top' };
      r.getCell('J').alignment = { wrapText: true, vertical: 'top' };
      r.eachCell({ includeEmpty: true }, cell => { cell.border = BORDER; });
    });
    const totRow = ws.addRow(['', '', '', '', '', '', 'TOTAL', totalPrognosa, '', '']);
    ws.mergeCells(`A${totRow.number}:F${totRow.number}`);
    totRow.eachCell({ includeEmpty: true }, cell => { cell.fill = TOT_FILL; cell.font = TOT_FONT; cell.border = BORDER; });
    totRow.getCell('G').alignment = { horizontal: 'center' };
    totRow.getCell('H').numFmt = '#,##0';
    totRow.getCell('H').alignment = { horizontal: 'right' };
    totRow.height = 20;
  }

  // Sheet ringkasan per area (hanya bila lebih dari 1 area muncul di hasil)
  const byArea = {};
  rows.forEach(r => { (byArea[r.area_kerja || 'Tanpa Area'] = byArea[r.area_kerja || 'Tanpa Area'] || []).push(r); });
  const areaEntries = Object.entries(byArea);

  if (areaEntries.length > 1) {
    const wsSum = wb.addWorksheet('Ringkasan Area');
    wsSum.columns = [
      { key: 'area', width: 22 }, { key: 'jml', width: 12 },
      { key: 'support', width: 14 }, { key: 'prognosa', width: 20 },
    ];
    const titleS = wsSum.addRow(['RINGKASAN LAPORAN PER AREA']);
    wsSum.mergeCells(`A${titleS.number}:D${titleS.number}`);
    titleS.getCell('A').font = { bold: true, size: 13, color: { argb: 'FF1E3A5F' } };
    titleS.getCell('A').alignment = { horizontal: 'center' };
    titleS.height = 22;
    const subS = wsSum.addRow([`Periode: ${periodeLabel}`]);
    wsSum.mergeCells(`A${subS.number}:D${subS.number}`);
    subS.getCell('A').font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
    subS.getCell('A').alignment = { horizontal: 'center' };
    wsSum.addRow([]);
    const hdrS = wsSum.addRow(['Area Kerja', 'Jml Laporan', 'Jml Support', 'Total Prognosa (Rp)']);
    hdrS.eachCell(cell => { cell.fill = HDR_FILL; cell.font = HDR_FONT; cell.border = BORDER; cell.alignment = { horizontal: 'center' }; });
    hdrS.height = 24;

    let grandPrognosa = 0;
    areaEntries.forEach(([areaName, laporanList]) => {
      const jmlSupport  = laporanList.reduce((s, l) => s + (l.support || []).length, 0);
      const sumPrognosa = laporanList.reduce((s, l) => s + (l.prognosa_bulan_depan || 0), 0);
      grandPrognosa += sumPrognosa;
      const r = wsSum.addRow([areaName, laporanList.length, jmlSupport, sumPrognosa]);
      r.getCell('D').numFmt = '#,##0';
      r.getCell('D').alignment = { horizontal: 'right' };
      r.eachCell({ includeEmpty: true }, cell => { cell.border = BORDER; });
    });
    const totS = wsSum.addRow(['TOTAL', '', '', grandPrognosa]);
    totS.eachCell({ includeEmpty: true }, cell => { cell.fill = TOT_FILL; cell.font = TOT_FONT; cell.border = BORDER; });
    totS.getCell('D').numFmt = '#,##0';
    totS.getCell('D').alignment = { horizontal: 'right' };
    totS.height = 20;
  }

  wb.xlsx.write(res).then(() => res.end()).catch(e => res.end());
});

// POST /api/laporan
router.post('/', blockViewer, (req, res) => {
  const userId = req.session.user.id;
  const { periode, alasan, aktivitas_bulan_ini, rencana_bulan_depan, prognosa_bulan_depan, isu_bulan_ini, support, projects } = req.body;

  if (!periode || !/^\d{4}-\d{2}$/.test(periode)) {
    return res.status(400).json({ error: 'Periode tidak valid (format: YYYY-MM)' });
  }

  const upsert = db.transaction(() => {
    let laporan = db.prepare('SELECT id FROM laporan_bulanan WHERE user_id = ? AND periode = ?').get(userId, periode);
    if (laporan) {
      db.prepare(`
        UPDATE laporan_bulanan
        SET alasan=?, aktivitas_bulan_ini=?, rencana_bulan_depan=?,
            prognosa_bulan_depan=?, isu_bulan_ini=?, updated_at=datetime('now','localtime')
        WHERE id=?
      `).run(alasan || '', aktivitas_bulan_ini || '', rencana_bulan_depan || '',
             parseFloat(prognosa_bulan_depan) || 0, isu_bulan_ini || '', laporan.id);
    } else {
      const r = db.prepare(`
        INSERT INTO laporan_bulanan (user_id, periode, alasan, aktivitas_bulan_ini, rencana_bulan_depan, prognosa_bulan_depan, isu_bulan_ini)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, periode, alasan || '', aktivitas_bulan_ini || '', rencana_bulan_depan || '',
             parseFloat(prognosa_bulan_depan) || 0, isu_bulan_ini || '');
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

// GET /api/laporan/gm-isu?periode=YYYY-MM — daftar isu bulan ini yang dikelola GM/Admin
router.get('/gm-isu', (req, res) => {
  const { periode } = req.query;
  try {
    const rows = periode
      ? db.prepare('SELECT * FROM gm_isu_bulan_ini WHERE periode = ? ORDER BY created_at DESC').all(periode)
      : db.prepare('SELECT * FROM gm_isu_bulan_ini ORDER BY periode DESC, created_at DESC').all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/laporan/gm-isu — tambah isu (hanya GM1/GM2/Admin)
router.post('/gm-isu', blockNonReviewer, (req, res) => {
  const { periode, isi } = req.body;
  if (!periode || !/^\d{4}-\d{2}$/.test(periode)) {
    return res.status(400).json({ error: 'Periode tidak valid (format: YYYY-MM)' });
  }
  if (!isi || !String(isi).trim()) {
    return res.status(400).json({ error: 'Isi isu tidak boleh kosong' });
  }
  const user = req.session.user;
  try {
    const r = db.prepare(`
      INSERT INTO gm_isu_bulan_ini (periode, isi, created_by, created_by_name)
      VALUES (?, ?, ?, ?)
    `).run(periode, String(isi).trim(), user.id, user.full_name);
    const row = db.prepare('SELECT * FROM gm_isu_bulan_ini WHERE id = ?').get(r.lastInsertRowid);
    res.json({ success: true, row });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/laporan/gm-isu/:id — edit isu (hanya GM1/GM2/Admin)
router.put('/gm-isu/:id', blockNonReviewer, (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const { isi } = req.body;
  if (!isi || !String(isi).trim()) {
    return res.status(400).json({ error: 'Isi isu tidak boleh kosong' });
  }
  const existing = db.prepare('SELECT id FROM gm_isu_bulan_ini WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Isu tidak ditemukan' });
  try {
    db.prepare(`
      UPDATE gm_isu_bulan_ini SET isi = ?, updated_at = datetime('now','localtime') WHERE id = ?
    `).run(String(isi).trim(), id);
    const row = db.prepare('SELECT * FROM gm_isu_bulan_ini WHERE id = ?').get(id);
    res.json({ success: true, row });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/laporan/gm-isu/:id — hapus isu (hanya GM1/GM2/Admin)
router.delete('/gm-isu/:id', blockNonReviewer, (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const existing = db.prepare('SELECT id FROM gm_isu_bulan_ini WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Isu tidak ditemukan' });
  try {
    db.prepare('DELETE FROM gm_isu_bulan_ini WHERE id = ?').run(id);
    res.json({ success: true });
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
