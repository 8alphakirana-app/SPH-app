const express = require('express');
const router  = express.Router();
const db      = require('../database');
const path    = require('path');
const fs      = require('fs');
const zlib    = require('zlib');

const DB_PATH        = path.join(__dirname, '..', 'data', 'sph.db');
const BACKUP_DIR     = path.join(__dirname, '..', 'data', 'backups');
const RESTORE_MARKER = path.join(__dirname, '..', 'data', 'RESTORE_PENDING');
const RESTORE_DB     = path.join(__dirname, '..', 'data', 'restore_pending.db');
const MAX_BACKUPS    = 10;

function requireAdmin(req, res, next) {
  if (!req.session?.user || req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin only' });
  next();
}

function getBackupList() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.db.gz'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { filename: f, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// POST /api/backup/create
router.post('/create', requireAdmin, async (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const ts        = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const tempPath  = path.join(BACKUP_DIR, `_temp_${ts}.db`);
    const finalPath = path.join(BACKUP_DIR, `backup_${ts}.db.gz`);
    await db.backup(tempPath);
    const compressed = zlib.gzipSync(fs.readFileSync(tempPath), { level: 9 });
    fs.writeFileSync(finalPath, compressed);
    fs.unlinkSync(tempPath);
    // Hapus backup lama
    const files = getBackupList();
    files.slice(MAX_BACKUPS).forEach(b => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, b.filename)); } catch {}
    });
    res.json({ success: true, filename: path.basename(finalPath), size: compressed.length });
  } catch (e) {
    console.error('Backup error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/backup/list
router.get('/list', requireAdmin, (req, res) => {
  res.json(getBackupList());
});

// GET /api/backup/download/:filename
router.get('/download/:filename', requireAdmin, (req, res) => {
  const { filename } = req.params;
  if (!/^backup_[\dT\-]+\.db\.gz$/.test(filename))
    return res.status(400).json({ error: 'Nama file tidak valid' });
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File tidak ditemukan' });
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  fs.createReadStream(filepath).pipe(res);
});

// DELETE /api/backup/:filename
router.delete('/:filename', requireAdmin, (req, res) => {
  const { filename } = req.params;
  if (!/^backup_[\dT\-]+\.db\.gz$/.test(filename))
    return res.status(400).json({ error: 'Nama file tidak valid' });
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File tidak ditemukan' });
  fs.unlinkSync(filepath);
  res.json({ success: true });
});

// POST /api/backup/restore/:filename
router.post('/restore/:filename', requireAdmin, (req, res) => {
  const { filename } = req.params;
  if (!/^backup_[\dT\-]+\.db\.gz$/.test(filename))
    return res.status(400).json({ error: 'Nama file tidak valid' });
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File tidak ditemukan' });
  try {
    const decompressed = zlib.gunzipSync(fs.readFileSync(filepath));
    fs.writeFileSync(RESTORE_DB, decompressed);
    fs.writeFileSync(RESTORE_MARKER, filename);
    res.json({ success: true, message: 'Pemulihan disiapkan. Server akan berhenti — jalankan kembali server untuk menerapkan.' });
    // Beri waktu response terkirim sebelum exit
    setTimeout(() => process.exit(0), 600);
  } catch (e) {
    console.error('Restore error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
