const express = require('express');
const router  = express.Router();
const db      = require('../database');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Belum login' });
  next();
}

// Khusus area kerja Kantor Pusat yang boleh membuat & melihat MOM Meeting
function requireKantorPusat(req, res, next) {
  const u = req.session.user;
  const isKantorPusatArea = (u?.area_kerja || '').trim().toLowerCase() === 'kantor pusat';
  if (!isKantorPusatArea) return res.status(403).json({ error: 'Akses ditolak, khusus area kerja Kantor Pusat' });
  next();
}

function getPeserta(meetingId) {
  return db.prepare('SELECT * FROM mom_peserta WHERE meeting_id=? ORDER BY urutan ASC').all(meetingId);
}
function getPoin(meetingId) {
  return db.prepare('SELECT * FROM mom_poin WHERE meeting_id=? ORDER BY urutan ASC').all(meetingId);
}

function saveChildren(meetingId, peserta, poin) {
  db.prepare('DELETE FROM mom_peserta WHERE meeting_id=?').run(meetingId);
  (Array.isArray(peserta) ? peserta : []).forEach((p, idx) => {
    db.prepare(`
      INSERT INTO mom_peserta (meeting_id, urutan, nama, jabatan, hadir)
      VALUES (?, ?, ?, ?, ?)
    `).run(meetingId, p.urutan ?? idx, p.nama || '', p.jabatan || '', p.hadir ? 1 : 0);
  });

  db.prepare('DELETE FROM mom_poin WHERE meeting_id=?').run(meetingId);
  (Array.isArray(poin) ? poin : []).forEach((p, idx) => {
    const text = typeof p === 'string' ? p : (p.poin || '');
    if (!text.trim()) return;
    db.prepare(`
      INSERT INTO mom_poin (meeting_id, urutan, poin)
      VALUES (?, ?, ?)
    `).run(meetingId, idx, text);
  });
}

// ── GET /api/mom ────────────────────────────────────────────────────────────
router.get('/', requireLogin, requireKantorPusat, (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, u.full_name as creator_name
    FROM mom_meeting m
    LEFT JOIN users u ON u.id = m.created_by
    ORDER BY m.tanggal DESC, m.created_at DESC
  `).all();
  res.json(rows);
});

// ── GET /api/mom/:id ────────────────────────────────────────────────────────
router.get('/:id', requireLogin, requireKantorPusat, (req, res) => {
  const row = db.prepare(`
    SELECT m.*, u.full_name as creator_name
    FROM mom_meeting m
    LEFT JOIN users u ON u.id = m.created_by
    WHERE m.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Data tidak ditemukan' });

  res.json({ ...row, peserta: getPeserta(row.id), poin: getPoin(row.id) });
});

// ── POST /api/mom ───────────────────────────────────────────────────────────
router.post('/', requireLogin, requireKantorPusat, (req, res) => {
  const { judul, perusahaan, agenda, tanggal, waktu, lokasi, keterangan, peserta, poin } = req.body;
  if (!judul) return res.status(400).json({ error: 'Judul rapat wajib diisi' });
  if (!tanggal) return res.status(400).json({ error: 'Tanggal rapat wajib diisi' });

  const result = db.prepare(`
    INSERT INTO mom_meeting (judul, perusahaan, agenda, tanggal, waktu, lokasi, keterangan, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    judul,
    perusahaan || '',
    agenda || '',
    tanggal,
    waktu || '',
    lokasi || '',
    keterangan || '',
    req.session.user.id
  );

  const meetingId = result.lastInsertRowid;
  saveChildren(meetingId, peserta, poin);

  res.json({ success: true, id: meetingId });
});

// ── PUT /api/mom/:id ────────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireKantorPusat, (req, res) => {
  const existing = db.prepare('SELECT id FROM mom_meeting WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan' });

  const { judul, perusahaan, agenda, tanggal, waktu, lokasi, keterangan, peserta, poin } = req.body;
  if (!judul) return res.status(400).json({ error: 'Judul rapat wajib diisi' });
  if (!tanggal) return res.status(400).json({ error: 'Tanggal rapat wajib diisi' });

  db.prepare(`
    UPDATE mom_meeting SET
      judul=?, perusahaan=?, agenda=?, tanggal=?, waktu=?, lokasi=?, keterangan=?,
      updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(
    judul,
    perusahaan || '',
    agenda || '',
    tanggal,
    waktu || '',
    lokasi || '',
    keterangan || '',
    req.params.id
  );

  saveChildren(req.params.id, peserta, poin);

  res.json({ success: true });
});

// ── DELETE /api/mom/:id ─────────────────────────────────────────────────────
router.delete('/:id', requireLogin, requireKantorPusat, (req, res) => {
  const existing = db.prepare('SELECT id FROM mom_meeting WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan' });

  db.prepare('DELETE FROM mom_peserta WHERE meeting_id=?').run(req.params.id);
  db.prepare('DELETE FROM mom_poin WHERE meeting_id=?').run(req.params.id);
  db.prepare('DELETE FROM mom_meeting WHERE id=?').run(req.params.id);

  res.json({ success: true });
});

module.exports = router;
