const express = require('express');
const router  = express.Router();
const db      = require('../database');
const fs      = require('fs');
const path    = require('path');
const { notifyKKNextLevel, notifyKKResult } = require('../notif');

const LEVEL_ROLES  = { 1: 'area_manager', 2: 'manager_keuangan', 3: 'gm', 4: 'gm2', 5: 'direktur_ops', 6: 'direktur_utama' };
const ROLE_LEVELS  = { area_manager: 1, manager_keuangan: 2, gm: 3, gm2: 4, direktur_ops: 5, direktur_utama: 6 };
const LEVEL_LABELS = { 1: 'Area Manager', 2: 'Manager Keuangan', 3: 'GM 1', 4: 'GM 2', 5: 'Direktur Operasional', 6: 'Direktur Utama' };
const MAX_LEVEL    = 6;

function hasAreaManagerForArea(area_kerja) {
  if (!area_kerja) return false;
  return !!db.prepare(
    "SELECT id FROM users WHERE role='area_manager' AND LOWER(TRIM(area_kerja)) = LOWER(TRIM(?))"
  ).get(area_kerja);
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Belum login' });
  next();
}

function calcKK(kk) {
  let products = [];
  try { products = JSON.parse(kk.products || '[]'); } catch {}

  let nkt, dppBeli, bDistribusi, ongkir;
  if (products.length > 0) {
    nkt          = products.reduce((s, p) => s + (p.nilai_kontrak || 0), 0);
    dppBeli      = products.reduce((s, p) => s + (p.dpp_beli || 0), 0);
    bDistribusi  = products.reduce((s, p) => s + (p.b_distribusi || 0), 0);
    ongkir       = products.reduce((s, p) => s + (p.ongkir || 0), 0);
  } else {
    nkt          = parseFloat(kk.nilai_kontrak_total) || 0;
    dppBeli      = parseFloat(kk.dpp_beli) || (parseFloat(kk.nilai_pembyr) || 0) / 1.11;
    bDistribusi  = parseFloat(kk.b_distribusi) || 0;
    ongkir       = parseFloat(kk.ongkir) || 0;
    const bdo    = (bDistribusi + ongkir) || parseFloat(kk.b_distribusi_ongkir) || 0;
    if (!bDistribusi && !ongkir && bdo) bDistribusi = bdo;
  }

  const bdo            = bDistribusi + ongkir;
  const dppKontrak     = nkt / 1.11;
  const ppnKontrak     = dppKontrak * 0.11;
  const pphKontrak     = dppKontrak * 0.015;
  const penerimaanUang = nkt - (ppnKontrak + pphKontrak);

  const ppnBeli        = dppBeli * 0.11;
  const nilaiPembyr    = dppBeli * 1.11;

  const surplusDefisit = penerimaanUang - (dppBeli + ppnBeli + bdo);
  const laba           = dppKontrak - dppBeli - bdo;
  const bMargin        = penerimaanUang > 0 ? (bDistribusi / penerimaanUang) * 100 : 0;
  const ongkirPct      = penerimaanUang > 0 ? (ongkir / penerimaanUang) * 100 : 0;
  const netMargin      = dppKontrak > 0 ? (laba / dppKontrak) * 100 : 0;

  return { dppKontrak, ppnKontrak, pphKontrak, penerimaanUang, dppBeli, ppnBeli, nilaiPembyr, bDistribusi, ongkir, surplusDefisit, laba, bMargin, ongkirPct, netMargin, products };
}

function generateNomorKK() {
  const now = new Date();
  const year = now.getFullYear();
  const romanMonth = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][now.getMonth()];
  const count = db.prepare("SELECT COUNT(*) as cnt FROM kertas_kerja WHERE nomor_surat LIKE ?").get(`%/KK/${romanMonth}/${year}`).cnt;
  return `${String(count + 1).padStart(3, '0')}/KK/${romanMonth}/${year}`;
}

// ── POST /api/kk ─────────────────────────────────────────────────────────────
router.post('/', requireLogin, (req, res) => {
  const {
    perihal, satker, prinsipal, nama_barang,
    nama_pekerjaan, pelanggan, nilai_kontrak_total, dpp_beli, b_distribusi, ongkir,
    term_payment_supplier, term_payment_pelanggan, sumber_anggaran, notes,
    products
  } = req.body;

  if (!nama_pekerjaan || !pelanggan) {
    return res.status(400).json({ error: 'Nama pekerjaan dan pelanggan wajib diisi' });
  }

  const productsArr    = Array.isArray(products) ? products : [];
  const productsJson   = JSON.stringify(productsArr);
  const totNkt         = productsArr.length > 0
    ? productsArr.reduce((s, p) => s + (parseFloat(p.nilai_kontrak) || 0), 0)
    : parseFloat(nilai_kontrak_total) || 0;
  const dppBeliVal     = productsArr.length > 0
    ? productsArr.reduce((s, p) => s + (parseFloat(p.dpp_beli) || 0), 0)
    : parseFloat(dpp_beli) || 0;
  const nilaiPembyrVal = dppBeliVal * 1.11;
  const bDistribusiVal = productsArr.length > 0
    ? productsArr.reduce((s, p) => s + (parseFloat(p.b_distribusi) || 0), 0)
    : parseFloat(b_distribusi) || 0;
  const ongkirVal      = productsArr.length > 0
    ? productsArr.reduce((s, p) => s + (parseFloat(p.ongkir) || 0), 0)
    : parseFloat(ongkir) || 0;
  const bdoVal         = bDistribusiVal + ongkirVal;
  const nomorSurat     = generateNomorKK();

  const creator = db.prepare('SELECT area_kerja, role FROM users WHERE id=?').get(req.session.user.id);
  // Level 1 (AM) di-skip jika: tidak ada AM di area ini, ATAU creator sendiri adalah AM
  const noAMKK = !hasAreaManagerForArea(creator?.area_kerja) || creator?.role === 'area_manager';
  const kkInitLevel = noAMKK ? 2 : 1;

  const subResult = db.prepare(`
    INSERT INTO submissions
      (client_title, client_name, client_address, client_city, items,
       ppn_included, ongkir_included, notes, lampiran, created_by,
       submission_type, kk_approval_level, status)
    VALUES ('', ?, '', 'di Tempat', '[]', 0, 0, ?, '', ?, 'kk', ?, 'pending')
  `).run(pelanggan, notes || '', req.session.user.id, kkInitLevel);

  const submissionId = subResult.lastInsertRowid;

  db.prepare(`
    INSERT INTO kertas_kerja
      (submission_id, nama_pekerjaan, nomor_surat, perihal, satker, prinsipal,
       nama_barang, pelanggan, nilai_kontrak_total, dpp_beli, nilai_pembyr,
       b_distribusi, ongkir, b_distribusi_ongkir, term_payment_supplier, term_payment_pelanggan, sumber_anggaran, products)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    submissionId, nama_pekerjaan, nomorSurat, perihal || '',
    satker || '', prinsipal || '', nama_barang || '', pelanggan,
    totNkt, dppBeliVal, nilaiPembyrVal,
    bDistribusiVal, ongkirVal, bdoVal,
    term_payment_supplier || '', term_payment_pelanggan || '', sumber_anggaran || '',
    productsJson
  );

  for (let level = 1; level <= MAX_LEVEL; level++) {
    if (level === 1 && noAMKK) {
      const autoNote = creator?.role === 'area_manager'
        ? 'Auto: dibuat oleh Area Manager'
        : 'Auto: tidak ada Area Manager di area ini';
      db.prepare("INSERT INTO kk_approvals (submission_id, level, status, note, acted_at) VALUES (?, 1, 'approved', ?, datetime('now','localtime'))")
        .run(submissionId, autoNote);
    } else {
      db.prepare("INSERT INTO kk_approvals (submission_id, level, status) VALUES (?, ?, 'pending')").run(submissionId, level);
    }
  }

  // Notifikasi ke approver level pertama
  notifyKKNextLevel(submissionId, kkInitLevel, creator?.area_kerja || '');

  res.json({ success: true, id: submissionId });
});

// ── GET /api/kk ──────────────────────────────────────────────────────────────
router.get('/', requireLogin, (req, res) => {
  const user = req.session.user;
  let rows;

  const base = `
    SELECT s.id, s.status, s.kk_approval_level, s.created_at, s.created_by, s.reject_reason,
           kk.nama_pekerjaan, kk.pelanggan, kk.nilai_kontrak_total, kk.dpp_beli, kk.nilai_pembyr, kk.b_distribusi, kk.ongkir, kk.b_distribusi_ongkir, kk.products,
           kk.nomor_surat, kk.perihal, kk.satker, kk.prinsipal, kk.nama_barang,
           kk.term_payment_supplier, kk.term_payment_pelanggan, kk.sumber_anggaran,
           u.full_name as creator_name,
           (SELECT COUNT(*) FROM kk_approvals ka WHERE ka.submission_id = s.id AND ka.level = 1 AND ka.status = 'approved' AND ka.approver_user_id IS NULL) as am_auto_skipped,
           (SELECT ka.status FROM kk_approvals ka WHERE ka.submission_id = s.id AND ka.level = 1) as lvl1_status,
           (SELECT ka.status FROM kk_approvals ka WHERE ka.submission_id = s.id AND ka.level = 2) as lvl2_status,
           (SELECT ka.status FROM kk_approvals ka WHERE ka.submission_id = s.id AND ka.level = 3) as lvl3_status,
           (SELECT ka.status FROM kk_approvals ka WHERE ka.submission_id = s.id AND ka.level = 4) as lvl4_status,
           (SELECT ka.status FROM kk_approvals ka WHERE ka.submission_id = s.id AND ka.level = 5) as lvl5_status,
           (SELECT ka.status FROM kk_approvals ka WHERE ka.submission_id = s.id AND ka.level = 6) as lvl6_status
    FROM submissions s
    JOIN kertas_kerja kk ON kk.submission_id = s.id
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.submission_type = 'kk'
  `;

  // Roles yang bisa melihat SEMUA KK (bisa approve atau perlu visibilitas penuh)
  const canSeeAllRoles = ['admin', 'direktur_utama', 'kantor_pusat', 'gm', 'gm2', 'direktur_ops'];
  if (canSeeAllRoles.includes(user.role)) {
    rows = db.prepare(base + ' ORDER BY s.created_at DESC').all();
  } else if (user.role === 'area_manager') {
    const area = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(user.id)?.area_kerja || '';
    rows = db.prepare(base + `
      AND EXISTS (
        SELECT 1 FROM users u2 WHERE u2.id = s.created_by
        AND LOWER(TRIM(u2.area_kerja)) = LOWER(TRIM(?))
      )
      ORDER BY s.created_at DESC
    `).all(area);
  } else if (ROLE_LEVELS[user.role]) {
    // manager_keuangan: hanya KK di level mereka atau yang sudah mereka approve
    const myLevel = ROLE_LEVELS[user.role];
    rows = db.prepare(base + `
      AND (s.kk_approval_level = ?
           OR EXISTS (SELECT 1 FROM kk_approvals a WHERE a.submission_id=s.id AND a.level=? AND a.approver_user_id=?))
      ORDER BY s.created_at DESC
    `).all(myLevel, myLevel, user.id);
  } else {
    rows = db.prepare(base + ' AND s.created_by = ? ORDER BY s.created_at DESC').all(user.id);
  }

  res.json(rows.map(r => ({ ...r, calc: calcKK(r) })));
});

// ── KK Stats endpoint (untuk dashboard) ──────────────────────────────────────
router.get('/stats', requireLogin, (req, res) => {
  const { month } = req.query;
  const likeMonth = month ? month + '%' : null;
  const user = req.session.user;
  const isAreaMgr = user.role === 'area_manager';
  const area = isAreaMgr
    ? (db.prepare('SELECT area_kerja FROM users WHERE id=?').get(user.id)?.area_kerja || '').trim().toLowerCase()
    : null;

  function cnt(statusClause) {
    if (isAreaMgr) {
      const base = `SELECT COUNT(*) AS c FROM submissions s JOIN users u ON u.id = s.created_by WHERE s.submission_type='kk' AND LOWER(TRIM(u.area_kerja)) = ?`;
      const params = [area];
      if (likeMonth) params.unshift(likeMonth);
      return likeMonth
        ? db.prepare(base + " AND s.created_at LIKE ? " + statusClause).get(area, likeMonth).c
        : db.prepare(base + " " + statusClause).get(area).c;
    }
    const base = "SELECT COUNT(*) AS c FROM submissions s WHERE s.submission_type='kk'";
    return likeMonth
      ? db.prepare(base + " AND s.created_at LIKE ? " + statusClause).get(likeMonth).c
      : db.prepare(base + " " + statusClause).get().c;
  }

  res.json({
    total:    cnt(''),
    menunggu: cnt("AND s.status='pending'"),
    disetujui:cnt("AND s.status='approved'"),
    ditolak:  cnt("AND s.status='rejected'"),
  });
});

// ── GET /api/kk/:id ───────────────────────────────────────────────────────────
router.get('/:id', requireLogin, (req, res) => {
  const user = req.session.user;
  const row  = db.prepare(`
    SELECT s.*, kk.*, u.full_name as creator_name,
           (SELECT COUNT(*) FROM kk_approvals ka WHERE ka.submission_id = s.id AND ka.level = 3 AND ka.status = 'approved') as gm1_approved,
           (SELECT COUNT(*) FROM kk_approvals ka WHERE ka.submission_id = s.id AND ka.level = 4 AND ka.status = 'approved') as gm2_approved
    FROM submissions s
    JOIN kertas_kerja kk ON kk.submission_id = s.id
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.id = ? AND s.submission_type = 'kk'
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'KK tidak ditemukan' });
  const canSeeAll = ['admin','direktur_utama','kantor_pusat','gm','gm2','direktur_ops'].includes(user.role);
  if (!canSeeAll && !ROLE_LEVELS[user.role] && row.created_by !== user.id) return res.status(403).json({ error: 'Akses ditolak' });

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
    nama_pekerjaan, perihal, satker, prinsipal, nama_barang,
    pelanggan, nilai_kontrak_total, dpp_beli, b_distribusi, ongkir,
    term_payment_supplier, term_payment_pelanggan, sumber_anggaran, notes,
    products
  } = req.body;

  if (!nama_pekerjaan || !pelanggan) return res.status(400).json({ error: 'Nama pekerjaan dan pelanggan wajib diisi' });

  const existingKK     = db.prepare('SELECT nomor_surat FROM kertas_kerja WHERE submission_id=?').get(req.params.id);
  const productsArr    = Array.isArray(products) ? products : [];
  const productsJson   = JSON.stringify(productsArr);
  const dppBeliVal     = parseFloat(dpp_beli) || 0;
  const nilaiPembyrVal = dppBeliVal * 1.11;
  const bDistribusiVal = parseFloat(b_distribusi) || 0;
  const ongkirVal      = parseFloat(ongkir) || 0;
  const bdoVal         = bDistribusiVal + ongkirVal;
  const totNkt         = productsArr.length > 0
    ? productsArr.reduce((s, p) => s + (parseFloat(p.nilai_kontrak) || 0), 0)
    : parseFloat(nilai_kontrak_total) || 0;

  db.prepare('UPDATE submissions SET client_name=?, notes=? WHERE id=?').run(pelanggan, notes || '', req.params.id);
  db.prepare(`
    UPDATE kertas_kerja SET
      nama_pekerjaan=?, nomor_surat=?, perihal=?, satker=?, prinsipal=?, nama_barang=?,
      pelanggan=?, nilai_kontrak_total=?, dpp_beli=?, nilai_pembyr=?, b_distribusi=?, ongkir=?, b_distribusi_ongkir=?,
      term_payment_supplier=?, term_payment_pelanggan=?, sumber_anggaran=?, products=?
    WHERE submission_id=?
  `).run(
    nama_pekerjaan, existingKK?.nomor_surat || '', perihal || '', satker || '', prinsipal || '', nama_barang || '',
    pelanggan, totNkt, dppBeliVal, nilaiPembyrVal, bDistribusiVal, ongkirVal, bdoVal,
    term_payment_supplier||'', term_payment_pelanggan||'', sumber_anggaran||'', productsJson, req.params.id
  );

  res.json({ success: true });
});

// ── DELETE /api/kk/:id ────────────────────────────────────────────────────────
router.delete('/:id', requireLogin, (req, res) => {
  const user = req.session.user;
  const sub  = db.prepare("SELECT * FROM submissions WHERE id=? AND submission_type='kk'").get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'KK tidak ditemukan' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
  try {
    db.prepare('DELETE FROM kk_approvals WHERE submission_id=?').run(req.params.id);
    db.prepare('DELETE FROM kertas_kerja WHERE submission_id=?').run(req.params.id);
    db.prepare('DELETE FROM submissions WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE KK error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/kk/:id/approve ──────────────────────────────────────────────────
router.post('/:id/approve', requireLogin, (req, res) => {
  const user = req.session.user;
  const { note } = req.body;
  const sub = db.prepare("SELECT * FROM submissions WHERE id=? AND submission_type='kk'").get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'KK tidak ditemukan' });
  if (sub.status !== 'pending') return res.status(400).json({ error: 'KK sudah diproses' });

  const currentLevel = sub.kk_approval_level;
  const now = new Date().toISOString();
  let approvalLevel;

  if (user.role === 'area_manager') {
    if (currentLevel !== 1) return res.status(403).json({ error: 'Bukan giliran Area Manager' });
    // AM tidak boleh approve KK yang dia buat sendiri
    if (sub.created_by === user.id) return res.status(403).json({ error: 'Anda tidak dapat menyetujui KK yang Anda buat sendiri' });
    const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sub.created_by);
    if ((creator?.area_kerja || '').trim().toLowerCase() !== (user.area_kerja || '').trim().toLowerCase()) {
      return res.status(403).json({ error: 'Area Anda tidak sesuai dengan area pembuat KK' });
    }
    approvalLevel = 1;
  } else if (user.role === 'gm') {
    if (currentLevel !== 3) return res.status(403).json({ error: 'Bukan giliran GM' });
    const existing = db.prepare("SELECT status FROM kk_approvals WHERE submission_id=? AND level=3").get(req.params.id);
    if (existing?.status !== 'pending') return res.status(400).json({ error: 'Anda sudah menyetujui KK ini' });
    approvalLevel = 3;
  } else if (user.role === 'gm2') {
    if (currentLevel !== 3) return res.status(403).json({ error: 'Bukan giliran GM 2' });
    const existing = db.prepare("SELECT status FROM kk_approvals WHERE submission_id=? AND level=4").get(req.params.id);
    if (existing?.status !== 'pending') return res.status(400).json({ error: 'Anda sudah menyetujui KK ini' });
    approvalLevel = 4;
  } else if (user.role === 'admin') {
    if (currentLevel === 3) {
      // Admin approve GM stage: approve whichever GM level is still pending
      const gm1 = db.prepare("SELECT status FROM kk_approvals WHERE submission_id=? AND level=3").get(req.params.id);
      const gm2 = db.prepare("SELECT status FROM kk_approvals WHERE submission_id=? AND level=4").get(req.params.id);
      if (gm1?.status !== 'pending' && gm2?.status !== 'pending') return res.status(400).json({ error: 'GM stage sudah selesai' });
      if (gm1?.status === 'pending') approvalLevel = 3;
      else approvalLevel = 4;
    } else {
      approvalLevel = currentLevel;
    }
  } else if (ROLE_LEVELS[user.role]) {
    approvalLevel = ROLE_LEVELS[user.role];
    if (currentLevel !== approvalLevel) {
      return res.status(403).json({ error: `Anda tidak berwenang approve level ${currentLevel} (${LEVEL_LABELS[currentLevel]})` });
    }
  } else {
    return res.status(403).json({ error: 'Tidak berwenang' });
  }

  db.prepare("UPDATE kk_approvals SET status='approved', approver_user_id=?, note=?, acted_at=? WHERE submission_id=? AND level=?")
    .run(user.id, note || '', now, req.params.id, approvalLevel);

  // Determine next kk_approval_level
  let nextLevel;
  if (approvalLevel === 3 || approvalLevel === 4) {
    // GM stage: advance only when BOTH gm (3) and gm2 (4) have approved
    const gm1 = db.prepare("SELECT status FROM kk_approvals WHERE submission_id=? AND level=3").get(req.params.id);
    const gm2 = db.prepare("SELECT status FROM kk_approvals WHERE submission_id=? AND level=4").get(req.params.id);
    if (gm1?.status === 'approved' && gm2?.status === 'approved') {
      nextLevel = 5;
    } else {
      nextLevel = 3; // Stay at GM stage
    }
  } else if (approvalLevel < MAX_LEVEL) {
    nextLevel = approvalLevel + 1;
  } else {
    // Final approval (direktur_utama)
    db.prepare("UPDATE submissions SET status='approved', kk_approval_level=7, approved_by=?, approved_at=? WHERE id=?")
      .run(user.id, now, req.params.id);
    notifyKKResult(req.params.id, sub.created_by, 'approved');
    return res.json({ success: true, nextLevel: null });
  }

  db.prepare('UPDATE submissions SET kk_approval_level=? WHERE id=?').run(nextLevel, req.params.id);
  const creatorArea = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sub.created_by)?.area_kerja || '';
  if (nextLevel === 3) {
    // GM stage: notifikasi hanya ke yang belum approve (hindari notif ganda)
    const lvl3 = db.prepare("SELECT status FROM kk_approvals WHERE submission_id=? AND level=3").get(req.params.id);
    const lvl4 = db.prepare("SELECT status FROM kk_approvals WHERE submission_id=? AND level=4").get(req.params.id);
    if (lvl3?.status !== 'approved') notifyKKNextLevel(req.params.id, 3, creatorArea);
    if (lvl4?.status !== 'approved') notifyKKNextLevel(req.params.id, 4, creatorArea);
  } else {
    notifyKKNextLevel(req.params.id, nextLevel, creatorArea);
  }
  res.json({ success: true, nextLevel });
});

// ── POST /api/kk/:id/reject ───────────────────────────────────────────────────
router.post('/:id/reject', requireLogin, (req, res) => {
  const user = req.session.user;
  const { note } = req.body;
  const sub = db.prepare("SELECT * FROM submissions WHERE id=? AND submission_type='kk'").get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'KK tidak ditemukan' });
  if (sub.status !== 'pending') return res.status(400).json({ error: 'KK sudah diproses' });

  const currentLevel = sub.kk_approval_level;
  let approvalLevel;

  if (user.role === 'area_manager') {
    if (currentLevel !== 1) return res.status(403).json({ error: `Anda tidak berwenang reject level ${currentLevel}` });
    if (sub.created_by === user.id) return res.status(403).json({ error: 'Anda tidak dapat menolak KK yang Anda buat sendiri' });
    const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(sub.created_by);
    if ((creator?.area_kerja || '').trim().toLowerCase() !== (user.area_kerja || '').trim().toLowerCase()) {
      return res.status(403).json({ error: 'Area Anda tidak sesuai dengan area pembuat KK' });
    }
    approvalLevel = 1;
  } else if (user.role === 'gm') {
    if (currentLevel !== 3) return res.status(403).json({ error: `Anda tidak berwenang reject level ${currentLevel}` });
    approvalLevel = 3;
  } else if (user.role === 'gm2') {
    if (currentLevel !== 3) return res.status(403).json({ error: `Anda tidak berwenang reject level ${currentLevel}` });
    approvalLevel = 4;
  } else if (user.role === 'admin') {
    approvalLevel = (currentLevel === 3) ? 3 : currentLevel;
  } else if (ROLE_LEVELS[user.role]) {
    approvalLevel = ROLE_LEVELS[user.role];
    if (currentLevel !== approvalLevel) return res.status(403).json({ error: `Anda tidak berwenang reject level ${currentLevel}` });
  } else {
    return res.status(403).json({ error: 'Tidak berwenang' });
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE kk_approvals SET status='rejected', approver_user_id=?, note=?, acted_at=? WHERE submission_id=? AND level=?")
    .run(user.id, note || '', now, req.params.id, approvalLevel);
  db.prepare("UPDATE submissions SET status='rejected', reject_reason=? WHERE id=?").run(note || 'Ditolak', req.params.id);
  notifyKKResult(req.params.id, sub.created_by, 'rejected');

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
  if (row.status !== 'approved') return res.status(403).json({ error: 'Excel hanya tersedia untuk KK yang sudah disetujui' });

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

// ── GET /api/kk/bulk-pdf-zip — download semua KK disetujui sebagai ZIP ─────────
router.get('/bulk-pdf-zip', requireLogin, async (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, kk.*, u.full_name as creator_name
    FROM submissions s
    JOIN kertas_kerja kk ON kk.submission_id = s.id
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.status = 'approved' AND s.submission_type = 'kk'
    ORDER BY s.created_at ASC
  `).all();
  if (rows.length === 0) return res.status(404).json({ error: 'Belum ada Kertas Kerja yang disetujui' });
  const settings = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(s => { settings[s.key] = s.value; });
  const archiver = require('archiver');
  const puppeteer = require('puppeteer');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="Semua_KK.zip"');
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => console.error('Archiver error:', err));
  archive.pipe(res);
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ||
        (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    for (const row of rows) {
      const approvals = db.prepare(`
        SELECT a.*, u.full_name as approver_name
        FROM kk_approvals a LEFT JOIN users u ON a.approver_user_id = u.id
        WHERE a.submission_id = ? ORDER BY a.level ASC
      `).all(row.id);
      const html = generateKKHTML(row, calcKK(row), approvals, settings);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4', landscape: true, printBackground: true,
        margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' }
      });
      await page.close();
      const safeName = (row.nama_pekerjaan || row.pelanggan || `KK${row.id}`).replace(/[^a-zA-Z0-9]/g, '_');
      const safeNomor = (row.nomor_surat || `ID${row.id}`).replace(/\//g, '-');
      archive.append(Buffer.from(pdfBuffer), { name: `KK_${safeNomor}_${safeName}.pdf` });
    }
    await browser.close(); browser = null;
    await archive.finalize();
  } catch (err) {
    if (browser) { try { await browser.close(); } catch {} }
    console.error('KK Bulk PDF ZIP error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Gagal membuat ZIP: ' + err.message });
  }
});

// ── GET /api/kk/:id/export-pdf ────────────────────────────────────────────────
router.get('/:id/export-pdf', requireLogin, async (req, res) => {
  const row = db.prepare(`
    SELECT s.*, kk.*, u.full_name as creator_name
    FROM submissions s
    JOIN kertas_kerja kk ON kk.submission_id = s.id
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.id = ? AND s.submission_type = 'kk'
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'KK tidak ditemukan' });
  if (row.status !== 'approved') return res.status(403).json({ error: 'PDF hanya tersedia untuk KK yang sudah disetujui' });

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
    const html = generateKKHTML(row, calcKK(row), approvals, settings);
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ||
        (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' }
    });
    await browser.close();
    const safeName = (row.nama_pekerjaan || 'KK').replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="KK_${safeName}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).json({ error: 'Gagal generate PDF: ' + err.message });
  }
});

function fmtRp(n) {
  return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
}

function generateKKHTML(row, calc, approvals, settings) {
  const companyName = settings.company_name || 'PT. Lapan Alpha Kirana';
  const city = settings.kk_kota || settings.company_city || 'Jakarta';

  const approvalLevel6 = approvals.find(a => a.level === 6 && a.status === 'approved');
  const dateStr = (approvalLevel6 ? new Date(approvalLevel6.acted_at) : new Date())
    .toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

  let products = [];
  try { products = JSON.parse(row.products || '[]'); } catch {}

  const statusMap = { approved: 'Disetujui', pending: 'Menunggu', rejected: 'Ditolak' };
  const statusColor = { approved: '#16a34a', pending: '#d97706', rejected: '#dc2626' };

  const infoRows = [
    ['Nama Pekerjaan', row.nama_pekerjaan],
    ['Nomor Surat', row.nomor_surat],
    ['Perihal', row.perihal],
    ['Satker', row.satker],
    ['Prinsipal', row.prinsipal],
    ['Nama Barang', row.nama_barang],
    ['Pelanggan', row.pelanggan],
    ['Status', `<span style="color:${statusColor[row.status] || '#555'};font-weight:600">${statusMap[row.status] || row.status}</span>`],
    ['Sumber Anggaran', row.sumber_anggaran],
    ['Term Payment Supplier', row.term_payment_supplier],
    ['Term Payment Pelanggan', row.term_payment_pelanggan],
  ].filter(([, v]) => v).map(([k, v]) => `
    <tr>
      <td style="padding:5px 8px;font-weight:600;width:200px;color:#374151">${k}</td>
      <td style="padding:5px 8px;width:10px;color:#374151">:</td>
      <td style="padding:5px 8px;color:#111827">${v || '-'}</td>
    </tr>`).join('');

  let financeRows = '';
  if (products.length > 0) {
    products.forEach((p, i) => {
      const pDppK = (p.nilai_kontrak || 0) / 1.11;
      const pPpnK = pDppK * 0.11;
      const pPphK = pDppK * 0.015;
      const pPen  = (p.nilai_kontrak || 0) - pPpnK - pPphK;
      const pDppB = p.dpp_beli || 0;
      const pPpnB = pDppB * 0.11;
      const pNPay = pDppB * 1.11;
      const pBdo  = (p.b_distribusi || 0) + (p.ongkir || 0);
      const pSurp = pPen - (pDppB + pPpnB + pBdo);
      const pLaba = pDppK - pDppB - pBdo;
      const pNM   = pDppK > 0 ? (pLaba / pDppK * 100).toFixed(2) : '0.00';
      financeRows += `<tr style="background:${i % 2 === 0 ? '#f9fafb' : '#fff'}">
        <td style="padding:3px;text-align:center">${i + 1}</td>
        <td style="padding:3px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.nama || '-'}</td>
        <td style="padding:3px;text-align:right">${fmtRp(p.nilai_kontrak)}</td>
        <td style="padding:3px;text-align:right">${fmtRp(pDppK)}</td>
        <td style="padding:3px;text-align:right">${fmtRp(pPpnK)}</td>
        <td style="padding:3px;text-align:right">${fmtRp(pPphK)}</td>
        <td style="padding:3px;text-align:right">${fmtRp(pPen)}</td>
        <td style="padding:3px;text-align:right">${fmtRp(pDppB)}</td>
        <td style="padding:3px;text-align:right">${fmtRp(p.b_distribusi)}</td>
        <td style="padding:3px;text-align:right">${fmtRp(p.ongkir)}</td>
        <td style="padding:3px;text-align:right;color:${pSurp >= 0 ? '#16a34a' : '#dc2626'}">${fmtRp(pSurp)}</td>
        <td style="padding:3px;text-align:right;color:${pLaba >= 0 ? '#16a34a' : '#dc2626'}">${fmtRp(pLaba)}</td>
        <td style="padding:3px;text-align:right">${pNM}%</td>
      </tr>`;
    });
    financeRows += `<tr style="background:#dbeafe;font-weight:700">
      <td colspan="2" style="padding:3px;text-align:center">TOTAL</td>
      <td style="padding:3px;text-align:right">${fmtRp(products.reduce((s, p) => s + (p.nilai_kontrak || 0), 0))}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.dppKontrak)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.ppnKontrak)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.pphKontrak)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.penerimaanUang)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.dppBeli)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.bDistribusi)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.ongkir)}</td>
      <td style="padding:3px;text-align:right;color:${calc.surplusDefisit >= 0 ? '#16a34a' : '#dc2626'}">${fmtRp(calc.surplusDefisit)}</td>
      <td style="padding:3px;text-align:right;color:${calc.laba >= 0 ? '#16a34a' : '#dc2626'}">${fmtRp(calc.laba)}</td>
      <td style="padding:3px;text-align:right">${calc.netMargin.toFixed(2)}%</td>
    </tr>`;
  } else {
    financeRows = `<tr style="background:#f9fafb">
      <td style="padding:3px;text-align:center">1</td>
      <td style="padding:3px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${row.pelanggan || '-'}</td>
      <td style="padding:3px;text-align:right">${fmtRp(row.nilai_kontrak_total)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.dppKontrak)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.ppnKontrak)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.pphKontrak)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.penerimaanUang)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.dppBeli)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.bDistribusi)}</td>
      <td style="padding:3px;text-align:right">${fmtRp(calc.ongkir)}</td>
      <td style="padding:3px;text-align:right;color:${calc.surplusDefisit >= 0 ? '#16a34a' : '#dc2626'}">${fmtRp(calc.surplusDefisit)}</td>
      <td style="padding:3px;text-align:right;color:${calc.laba >= 0 ? '#16a34a' : '#dc2626'}">${fmtRp(calc.laba)}</td>
      <td style="padding:3px;text-align:right">${calc.netMargin.toFixed(2)}%</td>
    </tr>`;
  }

  const sigBlocks = [
    { title: 'Yang Mengajukan', role: '', name: row.creator_name || '-', userId: row.created_by },
    { title: 'Mengetahui', role: 'Area Manager', ...approvals.find(a => a.level === 1) || {}, name: approvals.find(a => a.level === 1)?.approver_name || '( _____________ )', userId: approvals.find(a => a.level === 1)?.approver_user_id },
    { title: 'Mengetahui', role: 'Manager Keuangan', name: approvals.find(a => a.level === 2)?.approver_name || '( _____________ )', userId: approvals.find(a => a.level === 2)?.approver_user_id },
    { title: 'Mengetahui', role: 'GM 1', name: approvals.find(a => a.level === 3)?.approver_name || '( _____________ )', userId: approvals.find(a => a.level === 3)?.approver_user_id },
    { title: 'Mengetahui', role: 'GM 2', name: approvals.find(a => a.level === 4)?.approver_name || '( _____________ )', userId: approvals.find(a => a.level === 4)?.approver_user_id },
    { title: 'Mengetahui', role: 'Dir. Operasional', name: approvals.find(a => a.level === 5)?.approver_name || '( _____________ )', userId: approvals.find(a => a.level === 5)?.approver_user_id },
    { title: 'Menyetujui', role: 'Direktur Utama', name: approvals.find(a => a.level === 6)?.approver_name || '( _____________ )', userId: approvals.find(a => a.level === 6)?.approver_user_id },
  ];

  const sigHTML = sigBlocks.map(sig => {
    const imgPath = sig.userId ? path.join(__dirname, '..', 'public', 'img', `ttd_u${sig.userId}.png`) : null;
    let imgTag = '';
    if (imgPath && fs.existsSync(imgPath)) {
      try {
        const b64 = fs.readFileSync(imgPath).toString('base64');
        imgTag = `<img src="data:image/png;base64,${b64}" style="max-height:60px;max-width:100px;display:block;margin:4px auto">`;
      } catch {}
    }
    return `<td style="text-align:center;vertical-align:top;padding:6px 4px;border:1px solid #d1d5db">
      <div style="font-weight:600;font-size:11px;margin-bottom:4px">${sig.title}</div>
      <div style="min-height:70px;display:flex;align-items:center;justify-content:center">${imgTag}</div>
      <div style="font-weight:700;font-size:11px;border-top:1px solid #374151;padding-top:4px;margin-top:4px">${sig.name}</div>
      <div style="font-style:italic;font-size:10px;color:#6b7280">${sig.role}</div>
    </td>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111827; }
  h1 { font-size: 18px; }
  h2 { font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  .section-title { font-weight: 700; font-size: 12px; color: #1e40af; border-left: 4px solid #1e40af; padding-left: 8px; margin: 14px 0 6px; }
</style>
</head>
<body>
  <div style="background:#1f4e79;color:#fff;text-align:center;padding:12px 0 6px">
    <h1>KERTAS KERJA</h1>
    <h2>${companyName}</h2>
  </div>

  <div class="section-title">Informasi Pekerjaan</div>
  <table style="border:1px solid #e5e7eb">
    <tbody>${infoRows}</tbody>
  </table>

  <div class="section-title">Perhitungan Keuangan</div>
  <table style="font-size:7.5px;border:1px solid #e5e7eb;table-layout:fixed;width:100%">
    <colgroup>
      <col style="width:22px">
      <col style="width:13%">
      <col style="width:8%">
      <col style="width:8%">
      <col style="width:7%">
      <col style="width:7%">
      <col style="width:8%">
      <col style="width:8%">
      <col style="width:7%">
      <col style="width:6%">
      <col style="width:8%">
      <col style="width:8%">
      <col style="width:6%">
    </colgroup>
    <thead>
      <tr style="background:#1f4e79;color:#fff">
        <th style="padding:4px 3px;text-align:center" rowspan="2">No</th>
        <th style="padding:4px 3px;text-align:center" rowspan="2">Pelanggan / Produk</th>
        <th style="padding:4px 3px;text-align:center" colspan="5">Nilai Kontrak</th>
        <th style="padding:4px 3px;text-align:center" rowspan="2">DPP Beli</th>
        <th style="padding:4px 3px;text-align:center" rowspan="2">B. Distrib.</th>
        <th style="padding:4px 3px;text-align:center" rowspan="2">Ongkir</th>
        <th style="padding:4px 3px;text-align:center" rowspan="2">Surplus/<br>Defisit</th>
        <th style="padding:4px 3px;text-align:center" rowspan="2">Laba</th>
        <th style="padding:4px 3px;text-align:center" rowspan="2">Margin%</th>
      </tr>
      <tr style="background:#2e75b6;color:#fff">
        <th style="padding:3px;text-align:center">Total</th>
        <th style="padding:3px;text-align:center">DPP</th>
        <th style="padding:3px;text-align:center">PPN 11%</th>
        <th style="padding:3px;text-align:center">PPh 1,5%</th>
        <th style="padding:3px;text-align:center">Penerimaan</th>
      </tr>
    </thead>
    <tbody>${financeRows}</tbody>
  </table>

  <div style="margin-top:20px;text-align:right;font-size:11px;color:#374151">
    ${city}, ${dateStr}
  </div>
  <div class="section-title">Tanda Tangan</div>
  <table style="width:100%;border-collapse:collapse;margin-top:8px">
    <tbody><tr>${sigHTML}</tr></tbody>
  </table>
</body>
</html>`;
}

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
    { width: 18 }, // K B. Distribusi
    { width: 15 }, // L Ongkir
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
    ['H11:J11', 'Pembelian'],
    ['K11:K12', 'B.\nDistribusi'],
    ['L11:L12', 'Ongkir'],
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
  ].forEach(([col, val]) => {
    const c = ws.getCell(`${col}12`);
    c.value     = val;
    c.font      = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    c.fill      = midBlue;
    c.alignment = centerMid;
    c.border    = border;
  });
  ws.getRow(12).height = 28;

  // ── Rows 13+: Data rows (one per product, or single row fallback) ────────
  const numFmt   = '#,##0';
  const products = calc.products || [];
  let nextRow    = 13;

  function writeDataRow(rn, no, label, nkt, dppK, ppnK, pphK, pen, dppB, ppnB, nPembyr, bDist, onk, surplus, laba, nm) {
    const dr = ws.getRow(rn);
    const vals = [
      [1,  no,              null],
      [2,  label,           null],
      [3,  Math.round(nkt), numFmt],
      [4,  Math.round(dppK), numFmt],
      [5,  Math.round(ppnK), numFmt],
      [6,  Math.round(pphK), numFmt],
      [7,  Math.round(pen),  numFmt],
      [8,  Math.round(dppB), numFmt],
      [9,  Math.round(ppnB), numFmt],
      [10, Math.round(nPembyr), numFmt],
      [11, Math.round(bDist), numFmt],
      [12, Math.round(onk),  numFmt],
      [13, Math.round(surplus), numFmt],
      [14, Math.round(laba), numFmt],
      [15, parseFloat(nm.toFixed(2)), '0.00"%"'],
    ];
    vals.forEach(([col, val, fmt]) => {
      const c = dr.getCell(col);
      c.value     = val;
      c.border    = border;
      c.alignment = col <= 2 ? (col === 1 ? centerMid : { vertical: 'middle' }) : rightMid;
      if (fmt) c.numFmt = fmt;
    });
    dr.height = 20;
  }

  if (products.length > 0) {
    products.forEach((p, idx) => {
      const pNkt  = p.nilai_kontrak || 0;
      const pDppB = p.dpp_beli     || 0;
      const pDist = p.b_distribusi || 0;
      const pOnk  = p.ongkir       || 0;
      const pBdo  = pDist + pOnk;
      const pDppK = pNkt / 1.11;
      const pPpnK = pDppK * 0.11;
      const pPphK = pDppK * 0.015;
      const pPen  = pNkt - (pPpnK + pPphK);
      const pPpnB = pDppB * 0.11;
      const pNPay = pDppB * 1.11;
      const pSurp = pPen - (pDppB + pPpnB + pBdo);
      const pLaba = pDppK - pDppB - pBdo;
      const pNM   = pDppK > 0 ? (pLaba / pDppK) * 100 : 0;
      writeDataRow(nextRow, idx + 1, p.nama || '-', pNkt, pDppK, pPpnK, pPphK, pPen, pDppB, pPpnB, pNPay, pDist, pOnk, pSurp, pLaba, pNM);
      nextRow++;
    });

    // TOTAL row
    const tr = ws.getRow(nextRow);
    const tVals = [
      [1,  '',    null],
      [2,  'TOTAL', null],
      [3,  Math.round(products.reduce((s,p)=>s+(p.nilai_kontrak||0),0)), numFmt],
      [4,  Math.round(calc.dppKontrak),     numFmt],
      [5,  Math.round(calc.ppnKontrak),     numFmt],
      [6,  Math.round(calc.pphKontrak),     numFmt],
      [7,  Math.round(calc.penerimaanUang), numFmt],
      [8,  Math.round(calc.dppBeli),        numFmt],
      [9,  Math.round(calc.ppnBeli),        numFmt],
      [10, Math.round(calc.nilaiPembyr),    numFmt],
      [11, Math.round(calc.bDistribusi),    numFmt],
      [12, Math.round(calc.ongkir),         numFmt],
      [13, Math.round(calc.surplusDefisit), numFmt],
      [14, Math.round(calc.laba),           numFmt],
      [15, parseFloat(calc.netMargin.toFixed(2)), '0.00"%"'],
    ];
    tVals.forEach(([col, val, fmt]) => {
      const c = tr.getCell(col);
      c.value     = val;
      c.border    = border;
      c.font      = { bold: true };
      c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
      c.alignment = col <= 2 ? (col === 1 ? centerMid : { vertical: 'middle' }) : rightMid;
      if (fmt) c.numFmt = fmt;
    });
    tr.height = 20;
    nextRow++;
  } else {
    writeDataRow(nextRow, 1, row.pelanggan,
      row.nilai_kontrak_total || 0,
      calc.dppKontrak, calc.ppnKontrak, calc.pphKontrak,
      calc.penerimaanUang, calc.dppBeli, calc.ppnBeli, calc.nilaiPembyr,
      calc.bDistribusi, calc.ongkir,
      calc.surplusDefisit, calc.laba, calc.netMargin
    );
    nextRow++;
  }

  // ── Empty separator row ───────────────────────────────────────────────────
  ws.addRow([]);
  nextRow++;

  // ── Footer info (Term of Payment, Sumber Anggaran) ────────────────────────
  const footerData = [
    ['Term of Payment Supplier',  row.term_payment_supplier],
    ['Term of Payment Pelanggan', row.term_payment_pelanggan],
    ['Sumber Anggaran',           row.sumber_anggaran],
  ];
  let fr = nextRow;
  for (const [label, value] of footerData) {
    ws.getCell(`A${fr}`).value = label;
    ws.getCell(`A${fr}`).font = { bold: true };
    ws.mergeCells(`A${fr}:B${fr}`);
    ws.getCell(`C${fr}`).value = ':';
    ws.mergeCells(`D${fr}:${lastCol}${fr}`);
    ws.getCell(`D${fr}`).value = value || '';
    fr++;
  }
  nextRow = fr;

  // ── Two empty rows before signature ──────────────────────────────────────
  ws.addRow([]); ws.addRow([]);
  nextRow += 2;

  // ── Signature block ───────────────────────────────────────────────────────
  const sigStart = nextRow;
  const approvalLevel6 = approvals.find(a => a.level === 6 && a.status === 'approved');
  const dateStr = approvalLevel6
    ? new Date(approvalLevel6.acted_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  const city = settings.kk_kota || settings.company_city || 'Jakarta';

  // 7 signature blocks: creator (3 cols) + 6 approvals (2 cols each) = 15 cols total (A-O)
  const sigCols    = ['A', 'D', 'F', 'H', 'J', 'L', 'N'];
  const sigEndCols = ['C', 'E', 'G', 'I', 'K', 'M', 'O'];
  const sigTitles  = ['Yang Mengajukan', 'Mengetahui', 'Mengetahui', 'Mengetahui', 'Mengetahui', 'Mengetahui', 'Menyetujui'];
  const sigRoles   = ['', 'Area Manager', 'Manager Keuangan', 'GM 1', 'GM 2', 'Dir. Operasional', 'Direktur Utama'];
  const sigNames   = [
    row.creator_name || '-',
    approvals.find(a => a.level === 1)?.approver_name || '( _____________ )',
    approvals.find(a => a.level === 2)?.approver_name || '( _____________ )',
    approvals.find(a => a.level === 3)?.approver_name || '( _____________ )',
    approvals.find(a => a.level === 4)?.approver_name || '( _____________ )',
    approvals.find(a => a.level === 5)?.approver_name || '( _____________ )',
    approvals.find(a => a.level === 6)?.approver_name || '( _____________ )',
  ];

  // TTD user IDs: index 0=creator, 1-6=approval levels
  const ttdUserIds = [
    row.created_by,
    approvals.find(a => a.level === 1)?.approver_user_id || null,
    approvals.find(a => a.level === 2)?.approver_user_id || null,
    approvals.find(a => a.level === 3)?.approver_user_id || null,
    approvals.find(a => a.level === 4)?.approver_user_id || null,
    approvals.find(a => a.level === 5)?.approver_user_id || null,
    approvals.find(a => a.level === 6)?.approver_user_id || null,
  ];

  const r0 = sigStart;     // date / city
  const r1 = sigStart + 1; // title
  const r2 = sigStart + 2; // sig image top
  const r3 = sigStart + 3; // sig image bottom
  const r4 = sigStart + 4; // name
  const r5 = sigStart + 5; // role

  for (let i = 0; i < 5; i++) {
    const sc = sigCols[i]; const ec = sigEndCols[i];

    ws.mergeCells(`${sc}${r0}:${ec}${r0}`);
    ws.getCell(`${sc}${r0}`).value     = i === 0 ? `${city}, ${dateStr}` : ' ';
    ws.getCell(`${sc}${r0}`).alignment = centerMid;

    ws.mergeCells(`${sc}${r1}:${ec}${r1}`);
    ws.getCell(`${sc}${r1}`).value     = sigTitles[i];
    ws.getCell(`${sc}${r1}`).font      = { bold: true };
    ws.getCell(`${sc}${r1}`).alignment = centerMid;

    ws.mergeCells(`${sc}${r2}:${ec}${r3}`);
    ws.getRow(r2).height = 50;

    ws.mergeCells(`${sc}${r4}:${ec}${r4}`);
    ws.getCell(`${sc}${r4}`).value     = sigNames[i];
    ws.getCell(`${sc}${r4}`).font      = { bold: true };
    ws.getCell(`${sc}${r4}`).alignment = centerMid;

    ws.mergeCells(`${sc}${r5}:${ec}${r5}`);
    ws.getCell(`${sc}${r5}`).value     = sigRoles[i];
    ws.getCell(`${sc}${r5}`).alignment = centerMid;
    ws.getCell(`${sc}${r5}`).font      = { italic: true, size: 9 };

    const uid = ttdUserIds[i];
    if (uid) {
      const imgPath = path.join(__dirname, '..', 'public', 'img', `ttd_u${uid}.png`);
      if (fs.existsSync(imgPath)) {
        try {
          const imgId = wb.addImage({ buffer: fs.readFileSync(imgPath), extension: 'png' });
          ws.addImage(imgId, `${sc}${r2}:${ec}${r3}`);
        } catch {}
      }
    }
  }

  return wb.xlsx.writeBuffer();
}

module.exports = router;
