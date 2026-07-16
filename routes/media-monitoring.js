const express = require('express');
const router  = express.Router();
const db      = require('../database');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Belum login' });
  next();
}

function requireViewer(req, res, next) {
  // kantor_pusat dan admin boleh lihat, manager_keuangan (pengelola) juga boleh lihat,
  // begitu juga user dengan area kerja Kantor Pusat apapun role-nya
  const u = req.session.user;
  const r = u?.role;
  const isKantorPusatArea = (u?.area_kerja || '').trim().toLowerCase() === 'kantor pusat';
  if (!['admin', 'kantor_pusat', 'manager_keuangan'].includes(r) && !isKantorPusatArea)
    return res.status(403).json({ error: 'Akses ditolak' });
  next();
}

function requireEditor(req, res, next) {
  // hanya manager_keuangan yang bisa ubah data
  if (req.session.user?.role !== 'manager_keuangan')
    return res.status(403).json({ error: 'Hanya Manager Keuangan yang dapat mengelola data ini' });
  next();
}

function calcEntry(row, pembayaran = []) {
  const inv   = parseFloat(row.nilai_investasi) || 0;
  const balik = parseFloat(row.nilai_uang_kembali) || 0;
  const margin_pct = inv > 0 ? ((balik - inv) / inv) * 100 : 0;
  const today      = new Date(); today.setHours(0, 0, 0, 0);
  const terbayar   = pembayaran.filter(p => p.status === 'lunas')
                               .reduce((s, p) => s + (parseFloat(p.nilai_pembayaran) || 0), 0);
  const sisa       = inv - terbayar;

  // Cari keterlambatan: pembayaran belum lunas dengan tanggal sudah lewat
  let max_telat_hari = 0;
  let ada_keterlambatan = false;
  pembayaran.filter(p => p.status === 'belum' && p.tanggal_pembayaran).forEach(p => {
    const tgl = new Date(p.tanggal_pembayaran); tgl.setHours(0, 0, 0, 0);
    if (tgl < today) {
      const hari = Math.floor((today - tgl) / 86400000);
      if (hari > max_telat_hari) max_telat_hari = hari;
      ada_keterlambatan = true;
    }
  });
  return { ...row, margin_pct, terbayar, sisa, ada_keterlambatan, max_telat_hari, pembayaran };
}

function getPembayaran(monitoringId) {
  return db.prepare('SELECT * FROM media_monitoring_pembayaran WHERE monitoring_id=? ORDER BY urutan ASC').all(monitoringId);
}

// ── GET /api/media-monitoring ──────────────────────────────────────────────────
router.get('/', requireLogin, requireViewer, (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, u.full_name as creator_name
    FROM media_monitoring m
    LEFT JOIN users u ON u.id = m.created_by
    ORDER BY m.created_at DESC
  `).all();

  const result = rows.map(row => calcEntry(row, getPembayaran(row.id)));
  res.json(result);
});

// ── GET /api/media-monitoring/dashboard ────────────────────────────────────────
router.get('/dashboard', requireLogin, requireViewer, (req, res) => {
  const rows = db.prepare('SELECT * FROM media_monitoring ORDER BY created_at DESC').all();
  const entries = rows.map(row => {
    const pembayaran = getPembayaran(row.id);
    const calc = calcEntry(row, pembayaran);
    return {
      id: calc.id,
      nama_perusahaan: calc.nama_perusahaan,
      pekerjaan: calc.pekerjaan,
      nilai_investasi: calc.nilai_investasi,
      nilai_uang_kembali: calc.nilai_uang_kembali,
      margin_pct: calc.margin_pct,
      terbayar: calc.terbayar,
      sisa: calc.sisa,
      ada_keterlambatan: calc.ada_keterlambatan,
      max_telat_hari: calc.max_telat_hari,
      ada_jadwal: pembayaran.length > 0,
      semua_lunas: pembayaran.length > 0 && pembayaran.every(p => p.status === 'lunas'),
    };
  });

  const total_investasi = entries.reduce((s, e) => s + (parseFloat(e.nilai_investasi) || 0), 0);
  const total_terbayar  = entries.reduce((s, e) => s + (parseFloat(e.terbayar) || 0), 0);
  const total_sisa      = entries.reduce((s, e) => s + (parseFloat(e.sisa) || 0), 0);

  res.json({ entries, total_investasi, total_terbayar, total_sisa });
});

// ── GET /api/media-monitoring/:id ──────────────────────────────────────────────
router.get('/:id', requireLogin, requireViewer, (req, res) => {
  const row = db.prepare(`
    SELECT m.*, u.full_name as creator_name
    FROM media_monitoring m
    LEFT JOIN users u ON u.id = m.created_by
    WHERE m.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Data tidak ditemukan' });

  res.json(calcEntry(row, getPembayaran(row.id)));
});

// ── POST /api/media-monitoring ─────────────────────────────────────────────────
router.post('/', requireLogin, requireEditor, (req, res) => {
  const { nama_perusahaan, pekerjaan, lama_kontrak, nilai_investasi, nilai_uang_kembali, catatan, pembayaran } = req.body;

  if (!nama_perusahaan) return res.status(400).json({ error: 'Nama perusahaan wajib diisi' });

  const result = db.prepare(`
    INSERT INTO media_monitoring (nama_perusahaan, pekerjaan, lama_kontrak, nilai_investasi, nilai_uang_kembali, catatan, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    nama_perusahaan,
    pekerjaan || '',
    lama_kontrak || '',
    parseFloat(nilai_investasi) || 0,
    parseFloat(nilai_uang_kembali) || 0,
    catatan || '',
    req.session.user.id
  );

  const monitoringId = result.lastInsertRowid;
  (Array.isArray(pembayaran) ? pembayaran : []).forEach((p, idx) => {
    db.prepare(`
      INSERT INTO media_monitoring_pembayaran (monitoring_id, urutan, tanggal_pembayaran, nilai_pembayaran, catatan)
      VALUES (?, ?, ?, ?, ?)
    `).run(monitoringId, p.urutan ?? idx, p.tanggal_pembayaran, parseFloat(p.nilai_pembayaran) || 0, p.catatan || '');
  });

  res.json({ success: true, id: monitoringId });
});

// ── PUT /api/media-monitoring/:id ──────────────────────────────────────────────
router.put('/:id', requireLogin, requireEditor, (req, res) => {
  const existing = db.prepare('SELECT id FROM media_monitoring WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan' });

  const { nama_perusahaan, pekerjaan, lama_kontrak, nilai_investasi, nilai_uang_kembali, catatan, pembayaran } = req.body;
  if (!nama_perusahaan) return res.status(400).json({ error: 'Nama perusahaan wajib diisi' });

  db.prepare(`
    UPDATE media_monitoring SET
      nama_perusahaan=?, pekerjaan=?, lama_kontrak=?, nilai_investasi=?, nilai_uang_kembali=?, catatan=?,
      updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(
    nama_perusahaan,
    pekerjaan || '',
    lama_kontrak || '',
    parseFloat(nilai_investasi) || 0,
    parseFloat(nilai_uang_kembali) || 0,
    catatan || '',
    req.params.id
  );

  db.prepare('DELETE FROM media_monitoring_pembayaran WHERE monitoring_id=?').run(req.params.id);
  (Array.isArray(pembayaran) ? pembayaran : []).forEach((p, idx) => {
    db.prepare(`
      INSERT INTO media_monitoring_pembayaran (monitoring_id, urutan, tanggal_pembayaran, nilai_pembayaran, catatan)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.id, p.urutan ?? idx, p.tanggal_pembayaran, parseFloat(p.nilai_pembayaran) || 0, p.catatan || '');
  });

  res.json({ success: true });
});

// ── DELETE /api/media-monitoring/:id ───────────────────────────────────────────
router.delete('/:id', requireLogin, requireEditor, (req, res) => {
  const existing = db.prepare('SELECT id FROM media_monitoring WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan' });

  db.prepare('DELETE FROM media_monitoring_pembayaran WHERE monitoring_id=?').run(req.params.id);
  db.prepare('DELETE FROM media_monitoring WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── PATCH /api/media-monitoring/pembayaran/:pid/status ─────────────────────────
router.patch('/pembayaran/:pid/status', requireLogin, requireEditor, (req, res) => {
  const { status, catatan } = req.body;
  if (!['lunas', 'belum'].includes(status)) return res.status(400).json({ error: 'Status tidak valid' });

  const existing = db.prepare('SELECT * FROM media_monitoring_pembayaran WHERE id=?').get(req.params.pid);
  if (!existing) return res.status(404).json({ error: 'Jadwal pembayaran tidak ditemukan' });

  db.prepare(`
    UPDATE media_monitoring_pembayaran SET
      status=?, catatan=?, updated_by=?, updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(status, catatan ?? existing.catatan, req.session.user.id, req.params.pid);

  res.json({ success: true });
});

module.exports = router;
