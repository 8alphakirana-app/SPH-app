const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { notifyUMNextLevel, notifyUMResult } = require('../notif');

const ROLE_LEVELS  = { area_manager: 1, manager_keuangan: 2, gm: 3, gm2: 4, direktur_ops: 5, direktur_utama: 6 };
const LEVEL_LABELS = { 1: 'Area Manager', 2: 'Manager Keuangan', 3: 'GM 1', 4: 'GM 2', 5: 'Direktur Operasional', 6: 'Direktur Utama' };
const MAX_LEVEL     = 6;
const CAN_SEE_ALL   = ['admin', 'direktur_utama', 'kantor_pusat', 'gm', 'gm2', 'direktur_ops', 'viewer'];

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

function blockViewer(req, res, next) {
  if (req.session.user?.role === 'viewer') {
    return res.status(403).json({ error: 'Viewer hanya dapat melihat data' });
  }
  next();
}

function generateNomorUM() {
  const now = new Date();
  const year = now.getFullYear();
  const romanMonth = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][now.getMonth()];
  const count = db.prepare("SELECT COUNT(*) as cnt FROM uang_muka WHERE nomor LIKE ?").get(`%/UM/${romanMonth}/${year}`).cnt;
  return `${String(count + 1).padStart(3, '0')}/UM/${romanMonth}/${year}`;
}

// ── POST /api/uang-muka ─────────────────────────────────────────────────────
router.post('/', requireLogin, blockViewer, (req, res) => {
  const { keperluan, nominal, tanggal_dibutuhkan, catatan } = req.body;
  if (!keperluan) return res.status(400).json({ error: 'Keperluan wajib diisi' });
  const nominalVal = Number(nominal) || 0;
  if (nominalVal <= 0) return res.status(400).json({ error: 'Nominal harus lebih dari 0' });
  if (!tanggal_dibutuhkan) return res.status(400).json({ error: 'Tanggal dibutuhkan wajib diisi' });

  const creator = db.prepare('SELECT area_kerja, role FROM users WHERE id=?').get(req.session.user.id);
  const noAM = !hasAreaManagerForArea(creator?.area_kerja) || creator?.role === 'area_manager';
  const initLevel = noAM ? 2 : 1;
  const nomor = generateNomorUM();

  const result = db.prepare(`
    INSERT INTO uang_muka (nomor, created_by, keperluan, nominal, tanggal_dibutuhkan, area_kerja, catatan, approval_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nomor, req.session.user.id, keperluan, nominalVal, tanggal_dibutuhkan, creator?.area_kerja || '', catatan || '', initLevel);

  const umId = result.lastInsertRowid;

  for (let level = 1; level <= MAX_LEVEL; level++) {
    if (level === 1 && noAM) {
      const autoNote = creator?.role === 'area_manager'
        ? 'Auto: dibuat oleh Area Manager'
        : 'Auto: tidak ada Area Manager di area ini';
      db.prepare("INSERT INTO uang_muka_approvals (uang_muka_id, level, status, note, acted_at) VALUES (?, 1, 'approved', ?, datetime('now','localtime'))")
        .run(umId, autoNote);
    } else {
      db.prepare("INSERT INTO uang_muka_approvals (uang_muka_id, level, status) VALUES (?, ?, 'pending')").run(umId, level);
    }
  }

  notifyUMNextLevel(umId, initLevel, creator?.area_kerja || '');

  res.json({ success: true, id: umId });
});

// ── GET /api/uang-muka ───────────────────────────────────────────────────────
router.get('/', requireLogin, (req, res) => {
  const user = req.session.user;
  let rows;

  const base = `
    SELECT u.*, us.full_name as creator_name,
           (SELECT COUNT(*) FROM uang_muka_approvals a WHERE a.uang_muka_id = u.id AND a.level = 1 AND a.status = 'approved' AND a.approver_user_id IS NULL) as am_auto_skipped,
           (SELECT a.status FROM uang_muka_approvals a WHERE a.uang_muka_id = u.id AND a.level = 1) as lvl1_status,
           (SELECT a.status FROM uang_muka_approvals a WHERE a.uang_muka_id = u.id AND a.level = 2) as lvl2_status,
           (SELECT a.status FROM uang_muka_approvals a WHERE a.uang_muka_id = u.id AND a.level = 3) as lvl3_status,
           (SELECT a.status FROM uang_muka_approvals a WHERE a.uang_muka_id = u.id AND a.level = 4) as lvl4_status,
           (SELECT a.status FROM uang_muka_approvals a WHERE a.uang_muka_id = u.id AND a.level = 5) as lvl5_status,
           (SELECT a.status FROM uang_muka_approvals a WHERE a.uang_muka_id = u.id AND a.level = 6) as lvl6_status,
           (SELECT COUNT(*) FROM uang_muka_realisasi r WHERE r.uang_muka_id = u.id) as has_realisasi
    FROM uang_muka u
    LEFT JOIN users us ON us.id = u.created_by
  `;

  if (CAN_SEE_ALL.includes(user.role)) {
    rows = db.prepare(base + ' ORDER BY u.created_at DESC').all();
  } else if (user.role === 'area_manager') {
    const area = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(user.id)?.area_kerja || '';
    rows = db.prepare(base + `
      WHERE EXISTS (
        SELECT 1 FROM users u2 WHERE u2.id = u.created_by
        AND LOWER(TRIM(u2.area_kerja)) = LOWER(TRIM(?))
      )
      ORDER BY u.created_at DESC
    `).all(area);
  } else if (ROLE_LEVELS[user.role]) {
    const myLevel = ROLE_LEVELS[user.role];
    rows = db.prepare(base + `
      WHERE (u.approval_level = ?
             OR EXISTS (SELECT 1 FROM uang_muka_approvals a WHERE a.uang_muka_id=u.id AND a.level=? AND a.approver_user_id=?))
      ORDER BY u.created_at DESC
    `).all(myLevel, myLevel, user.id);
  } else {
    rows = db.prepare(base + ' WHERE u.created_by = ? ORDER BY u.created_at DESC').all(user.id);
  }

  res.json(rows);
});

// ── GET /api/uang-muka/:id ───────────────────────────────────────────────────
router.get('/:id', requireLogin, (req, res) => {
  const user = req.session.user;
  const row = db.prepare(`
    SELECT u.*, us.full_name as creator_name
    FROM uang_muka u
    LEFT JOIN users us ON us.id = u.created_by
    WHERE u.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Pengajuan Uang Muka tidak ditemukan' });

  const canSeeAll = CAN_SEE_ALL.includes(user.role);
  if (!canSeeAll && !ROLE_LEVELS[user.role] && row.created_by !== user.id) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  const approvals = db.prepare(`
    SELECT a.*, u2.full_name as approver_name
    FROM uang_muka_approvals a LEFT JOIN users u2 ON a.approver_user_id = u2.id
    WHERE a.uang_muka_id = ? ORDER BY a.level ASC
  `).all(req.params.id);

  const realisasi = db.prepare('SELECT * FROM uang_muka_realisasi WHERE uang_muka_id=?').get(req.params.id);
  let rincian = [];
  if (realisasi) rincian = db.prepare('SELECT * FROM uang_muka_realisasi_rincian WHERE realisasi_id=? ORDER BY id').all(realisasi.id);

  res.json({ ...row, approvals, realisasi: realisasi ? { ...realisasi, rincian } : null });
});

// ── PUT /api/uang-muka/:id  (edit selagi masih pending) ──────────────────────
router.put('/:id', requireLogin, (req, res) => {
  const user = req.session.user;
  const row = db.prepare('SELECT * FROM uang_muka WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Pengajuan Uang Muka tidak ditemukan' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Hanya pengajuan pending yang dapat diedit' });
  if (user.role !== 'admin' && row.created_by !== user.id) return res.status(403).json({ error: 'Akses ditolak' });

  const { keperluan, nominal, tanggal_dibutuhkan, catatan } = req.body;
  if (!keperluan) return res.status(400).json({ error: 'Keperluan wajib diisi' });
  const nominalVal = Number(nominal) || 0;
  if (nominalVal <= 0) return res.status(400).json({ error: 'Nominal harus lebih dari 0' });
  if (!tanggal_dibutuhkan) return res.status(400).json({ error: 'Tanggal dibutuhkan wajib diisi' });

  db.prepare(`
    UPDATE uang_muka SET keperluan=?, nominal=?, tanggal_dibutuhkan=?, catatan=?, updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(keperluan, nominalVal, tanggal_dibutuhkan, catatan || '', req.params.id);

  res.json({ success: true });
});

// ── DELETE /api/uang-muka/:id ─────────────────────────────────────────────────
router.delete('/:id', requireLogin, (req, res) => {
  const user = req.session.user;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
  const row = db.prepare('SELECT id FROM uang_muka WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Pengajuan Uang Muka tidak ditemukan' });

  const realisasi = db.prepare('SELECT id FROM uang_muka_realisasi WHERE uang_muka_id=?').get(req.params.id);
  if (realisasi) {
    db.prepare('DELETE FROM uang_muka_realisasi_rincian WHERE realisasi_id=?').run(realisasi.id);
    db.prepare('DELETE FROM uang_muka_realisasi WHERE id=?').run(realisasi.id);
  }
  db.prepare('DELETE FROM uang_muka_approvals WHERE uang_muka_id=?').run(req.params.id);
  db.prepare('DELETE FROM uang_muka WHERE id=?').run(req.params.id);

  res.json({ success: true });
});

// ── POST /api/uang-muka/:id/approve ───────────────────────────────────────────
router.post('/:id/approve', requireLogin, (req, res) => {
  const user = req.session.user;
  const { note } = req.body;
  const row = db.prepare('SELECT * FROM uang_muka WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Pengajuan Uang Muka tidak ditemukan' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Pengajuan sudah diproses' });

  const currentLevel = row.approval_level;
  const now = new Date().toISOString();
  let approvalLevel;

  if (user.role === 'area_manager') {
    if (currentLevel !== 1) return res.status(403).json({ error: 'Bukan giliran Area Manager' });
    if (row.created_by === user.id) return res.status(403).json({ error: 'Anda tidak dapat menyetujui pengajuan Anda sendiri' });
    const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(row.created_by);
    if ((creator?.area_kerja || '').trim().toLowerCase() !== (user.area_kerja || '').trim().toLowerCase()) {
      return res.status(403).json({ error: 'Area Anda tidak sesuai dengan area pembuat pengajuan' });
    }
    approvalLevel = 1;
  } else if (user.role === 'gm') {
    if (currentLevel !== 3) return res.status(403).json({ error: 'Bukan giliran GM' });
    const existing = db.prepare('SELECT status FROM uang_muka_approvals WHERE uang_muka_id=? AND level=3').get(req.params.id);
    if (existing?.status !== 'pending') return res.status(400).json({ error: 'Anda sudah menyetujui pengajuan ini' });
    approvalLevel = 3;
  } else if (user.role === 'gm2') {
    if (currentLevel !== 3) return res.status(403).json({ error: 'Bukan giliran GM 2' });
    const existing = db.prepare('SELECT status FROM uang_muka_approvals WHERE uang_muka_id=? AND level=4').get(req.params.id);
    if (existing?.status !== 'pending') return res.status(400).json({ error: 'Anda sudah menyetujui pengajuan ini' });
    approvalLevel = 4;
  } else if (user.role === 'admin') {
    if (currentLevel === 3) {
      const gm1 = db.prepare('SELECT status FROM uang_muka_approvals WHERE uang_muka_id=? AND level=3').get(req.params.id);
      const gm2 = db.prepare('SELECT status FROM uang_muka_approvals WHERE uang_muka_id=? AND level=4').get(req.params.id);
      if (gm1?.status !== 'pending' && gm2?.status !== 'pending') return res.status(400).json({ error: 'GM stage sudah selesai' });
      approvalLevel = gm1?.status === 'pending' ? 3 : 4;
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

  db.prepare("UPDATE uang_muka_approvals SET status='approved', approver_user_id=?, note=?, acted_at=? WHERE uang_muka_id=? AND level=?")
    .run(user.id, note || '', now, req.params.id, approvalLevel);

  let nextLevel;
  if (approvalLevel === 3 || approvalLevel === 4) {
    const gm1 = db.prepare('SELECT status FROM uang_muka_approvals WHERE uang_muka_id=? AND level=3').get(req.params.id);
    const gm2 = db.prepare('SELECT status FROM uang_muka_approvals WHERE uang_muka_id=? AND level=4').get(req.params.id);
    nextLevel = (gm1?.status === 'approved' && gm2?.status === 'approved') ? 5 : 3;
  } else if (approvalLevel < MAX_LEVEL) {
    nextLevel = approvalLevel + 1;
  } else {
    db.prepare("UPDATE uang_muka SET status='approved', approval_level=7, updated_at=datetime('now','localtime') WHERE id=?")
      .run(req.params.id);
    notifyUMResult(req.params.id, row.created_by, 'approved');
    return res.json({ success: true, nextLevel: null });
  }

  db.prepare('UPDATE uang_muka SET approval_level=? WHERE id=?').run(nextLevel, req.params.id);
  const creatorArea = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(row.created_by)?.area_kerja || '';
  if (nextLevel === 3) {
    const lvl3 = db.prepare('SELECT status FROM uang_muka_approvals WHERE uang_muka_id=? AND level=3').get(req.params.id);
    const lvl4 = db.prepare('SELECT status FROM uang_muka_approvals WHERE uang_muka_id=? AND level=4').get(req.params.id);
    if (lvl3?.status !== 'approved') notifyUMNextLevel(req.params.id, 3, creatorArea);
    if (lvl4?.status !== 'approved') notifyUMNextLevel(req.params.id, 4, creatorArea);
  } else {
    notifyUMNextLevel(req.params.id, nextLevel, creatorArea);
  }
  res.json({ success: true, nextLevel });
});

// ── POST /api/uang-muka/:id/reject ────────────────────────────────────────────
router.post('/:id/reject', requireLogin, (req, res) => {
  const user = req.session.user;
  const { note } = req.body;
  const row = db.prepare('SELECT * FROM uang_muka WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Pengajuan Uang Muka tidak ditemukan' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Pengajuan sudah diproses' });

  const currentLevel = row.approval_level;
  let approvalLevel;

  if (user.role === 'area_manager') {
    if (currentLevel !== 1) return res.status(403).json({ error: `Anda tidak berwenang reject level ${currentLevel}` });
    if (row.created_by === user.id) return res.status(403).json({ error: 'Anda tidak dapat menolak pengajuan Anda sendiri' });
    const creator = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(row.created_by);
    if ((creator?.area_kerja || '').trim().toLowerCase() !== (user.area_kerja || '').trim().toLowerCase()) {
      return res.status(403).json({ error: 'Area Anda tidak sesuai dengan area pembuat pengajuan' });
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
  db.prepare("UPDATE uang_muka_approvals SET status='rejected', approver_user_id=?, note=?, acted_at=? WHERE uang_muka_id=? AND level=?")
    .run(user.id, note || '', now, req.params.id, approvalLevel);
  db.prepare("UPDATE uang_muka SET status='rejected', reject_reason=? WHERE id=?").run(note || 'Ditolak', req.params.id);
  notifyUMResult(req.params.id, row.created_by, 'rejected');

  res.json({ success: true });
});

// ── POST /api/uang-muka/:id/realisasi  (pertanggungjawaban) ──────────────────
router.post('/:id/realisasi', requireLogin, (req, res) => {
  const user = req.session.user;
  const row = db.prepare('SELECT * FROM uang_muka WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Pengajuan Uang Muka tidak ditemukan' });
  if (user.role !== 'admin' && row.created_by !== user.id) return res.status(403).json({ error: 'Akses ditolak' });
  if (row.status !== 'approved') return res.status(400).json({ error: 'Realisasi hanya dapat diisi setelah pengajuan disetujui' });
  if (db.prepare('SELECT id FROM uang_muka_realisasi WHERE uang_muka_id=?').get(req.params.id)) {
    return res.status(400).json({ error: 'Realisasi sudah pernah diisi' });
  }

  const { tanggal_realisasi, keterangan, rincian } = req.body;
  const rincianArr = Array.isArray(rincian) ? rincian : [];
  const totalTerpakai = rincianArr.reduce((s, r) => s + (Number(r.jumlah) || 0), 0);
  const sisa = (row.nominal || 0) - totalTerpakai;

  const result = db.prepare(`
    INSERT INTO uang_muka_realisasi (uang_muka_id, tanggal_realisasi, keterangan, total_terpakai, sisa, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, tanggal_realisasi || '', keterangan || '', totalTerpakai, sisa, user.id);

  const realisasiId = result.lastInsertRowid;
  const ins = db.prepare('INSERT INTO uang_muka_realisasi_rincian (realisasi_id, keterangan, jumlah, bukti) VALUES (?, ?, ?, ?)');
  rincianArr.forEach(r => ins.run(realisasiId, r.keterangan || '', Number(r.jumlah) || 0, r.bukti || null));

  db.prepare("UPDATE uang_muka SET status='selesai', updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);

  res.json({ success: true, id: realisasiId, total_terpakai: totalTerpakai, sisa });
});

module.exports = router;
