const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const DB_PATH    = path.join(__dirname, 'data', 'sph.db');
const BACKUP_DIR = path.join(__dirname, 'data', 'backups');
const RESTORE_MARKER = path.join(__dirname, 'data', 'RESTORE_PENDING');
const RESTORE_DB     = path.join(__dirname, 'data', 'restore_pending.db');

// Pastikan folder data ada
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

// ── Cek & terapkan restore pending (sebelum buka DB) ─────────────────────────
if (fs.existsSync(RESTORE_MARKER) && fs.existsSync(RESTORE_DB)) {
  try {
    fs.copyFileSync(RESTORE_DB, DB_PATH);
    fs.unlinkSync(RESTORE_MARKER);
    fs.unlinkSync(RESTORE_DB);
    console.log('✅ Database berhasil dipulihkan dari backup');
  } catch (e) {
    console.error('❌ Gagal memulihkan database:', e.message);
  }
}

const db = new Database(DB_PATH);

// Aktifkan WAL mode untuk performa lebih baik
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Inisialisasi tabel
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'staff')),
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nomor TEXT,
    perihal TEXT DEFAULT 'Penawaran Harga',
    lampiran TEXT DEFAULT '',
    client_title TEXT NOT NULL,
    client_name TEXT NOT NULL,
    client_address TEXT NOT NULL,
    client_city TEXT NOT NULL DEFAULT 'di Tempat',
    items TEXT NOT NULL,
    ppn_included INTEGER DEFAULT 1,
    ongkir_included INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    reject_reason TEXT DEFAULT '',
    created_by INTEGER NOT NULL,
    approved_by INTEGER,
    approved_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── MIGRATION v2: add approver roles ─────────────────────────────────────────
const userTableDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
if (userTableDef && !userTableDef.sql.includes('manager_keuangan')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE users_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','staff','gm','manager_keuangan','direktur_ops','direktur_utama')),
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    INSERT INTO users_v2 SELECT * FROM users;
    DROP TABLE users;
    ALTER TABLE users_v2 RENAME TO users;
  `);
  db.pragma('foreign_keys = ON');
  console.log('✅ Users table upgraded: approver roles added');
}

// ── MIGRATION v3: add kantor_pusat role ───────────────────────────────────────
const userTableDef2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
if (userTableDef2 && !userTableDef2.sql.includes('kantor_pusat')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE users_v3 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','staff','gm','manager_keuangan','direktur_ops','direktur_utama','kantor_pusat')),
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    INSERT INTO users_v3 SELECT * FROM users;
    DROP TABLE users;
    ALTER TABLE users_v3 RENAME TO users;
  `);
  db.pragma('foreign_keys = ON');
  console.log('✅ Users table upgraded: kantor_pusat role added');
}

// ── MIGRATION: update default passwords to kirana ─────────────────────────────
[
  { username: 'admin',   old: 'admin123' },
  { username: 'staff1',  old: 'staff123' },
  { username: 'syaiful', old: 'pass123'  },
  { username: 'aziz',    old: 'pass123'  },
  { username: 'arief',   old: 'pass123'  },
  { username: 'jimmy',   old: 'pass123'  },
].forEach(({ username, old }) => {
  db.prepare('UPDATE users SET password=? WHERE username=? AND password=?').run('kirana', username, old);
});

// ── Add new columns to submissions if not exists ─────────────────────────────
[
  "ALTER TABLE submissions ADD COLUMN submission_type TEXT DEFAULT 'sph'",
  "ALTER TABLE submissions ADD COLUMN kk_approval_level INTEGER DEFAULT 0"
].forEach(sql => { try { db.exec(sql); } catch {} });

// ── New tables for Kertas Kerja ───────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS kertas_kerja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    nama_pekerjaan TEXT DEFAULT '',
    nomor_surat TEXT DEFAULT '',
    perihal TEXT DEFAULT '',
    satker TEXT DEFAULT '',
    prinsipal TEXT DEFAULT '',
    nama_barang TEXT DEFAULT '',
    pelanggan TEXT DEFAULT '',
    nilai_kontrak_total REAL DEFAULT 0,
    nilai_pembyr REAL DEFAULT 0,
    b_distribusi_ongkir REAL DEFAULT 0,
    term_payment_supplier TEXT DEFAULT '',
    term_payment_pelanggan TEXT DEFAULT '',
    sumber_anggaran TEXT DEFAULT '',
    FOREIGN KEY (submission_id) REFERENCES submissions(id)
  );

  CREATE TABLE IF NOT EXISTS kk_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    approver_user_id INTEGER,
    status TEXT DEFAULT 'pending',
    note TEXT DEFAULT '',
    acted_at TEXT,
    FOREIGN KEY (submission_id) REFERENCES submissions(id),
    FOREIGN KEY (approver_user_id) REFERENCES users(id)
  );
`);

// ── Cek apakah sudah ada data awal ───────────────────────────────────────────
const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!adminExists) {
  // Buat user admin dan staff default
  const insertUser = db.prepare(`
    INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)
  `);

  insertUser.run('admin', 'kirana', 'Administrator', 'admin');
  insertUser.run('staff1', 'kirana', 'Staff Penjualan 1', 'staff');

  console.log('✅ User default dibuat: admin/kirana dan staff1/kirana');
}

// Cek pengaturan perusahaan
const companyExists = db.prepare("SELECT value FROM settings WHERE key = 'company_name'").get();
if (!companyExists) {
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('company_name', 'PT. Lapan Alpha Kirana');
  insertSetting.run('company_tagline', 'Perdagangan Alat Kesehatan');
  insertSetting.run('company_address', 'Jakarta');
  insertSetting.run('signer_name', 'Aris Hamdanny');
  insertSetting.run('signer_title', 'General Manager');
  insertSetting.run('nomor_prefix', 'PMH-LAK');
}

// ── Default approver users untuk KK ──────────────────────────────────────────
[
  { username: 'syaiful', password: 'kirana', full_name: 'M. Syaiful Hidayat',   role: 'gm' },
  { username: 'aziz',    password: 'kirana', full_name: 'Nur Aziz Pratama',      role: 'manager_keuangan' },
  { username: 'arief',   password: 'kirana', full_name: 'Arief Adityo Gumilang', role: 'direktur_ops' },
  { username: 'jimmy',   password: 'kirana', full_name: 'Jimmy F. Zega',          role: 'direktur_utama' },
].forEach(u => {
  if (!db.prepare('SELECT id FROM users WHERE username = ?').get(u.username)) {
    db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run(u.username, u.password, u.full_name, u.role);
    console.log(`✅ Approver default dibuat: ${u.username} (${u.role})`);
  }
});

// ── MIGRATION v4: add SPPD roles + area_kerja / jabatan_detail columns ────────
const userTableDef3 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
if (userTableDef3 && !userTableDef3.sql.includes('gm2')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE users_v4 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','staff','gm','manager_keuangan','direktur_ops','direktur_utama','kantor_pusat','marketing','supervisor','area_manager','gm2')),
      area_kerja TEXT DEFAULT '',
      jabatan_detail TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
    INSERT INTO users_v4 SELECT id, username, password, full_name, role, '' AS area_kerja, '' AS jabatan_detail, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_v4 RENAME TO users;
  `);
  db.pragma('foreign_keys = ON');
  console.log('✅ Users table upgraded: SPPD roles + area_kerja/jabatan_detail added');
}

// ── Add sppd_approval_level to submissions ────────────────────────────────────
try { db.exec("ALTER TABLE submissions ADD COLUMN sppd_approval_level INTEGER DEFAULT 0"); } catch {}

// ── Add dpp_beli to kertas_kerja ──────────────────────────────────────────────
try { db.exec("ALTER TABLE kertas_kerja ADD COLUMN dpp_beli REAL DEFAULT 0"); } catch {}

// ── Add b_distribusi / ongkir to kertas_kerja ─────────────────────────────────
try { db.exec("ALTER TABLE kertas_kerja ADD COLUMN b_distribusi REAL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE kertas_kerja ADD COLUMN ongkir REAL DEFAULT 0"); } catch {}

// ── Add products JSON to kertas_kerja ─────────────────────────────────────────
try { db.exec("ALTER TABLE kertas_kerja ADD COLUMN products TEXT DEFAULT '[]'"); } catch {}

// ── SPPD tables ───────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sppd (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nomor TEXT DEFAULT '',
    created_by INTEGER NOT NULL,
    nama_pegawai TEXT DEFAULT '',
    jabatan TEXT DEFAULT '',
    area_kerja TEXT DEFAULT '',
    tujuan TEXT DEFAULT '',
    keperluan TEXT DEFAULT '',
    tanggal_berangkat TEXT DEFAULT '',
    tanggal_kembali TEXT DEFAULT '',
    transport TEXT DEFAULT '',
    uang_muka REAL DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','completed')),
    sppd_approval_level INTEGER DEFAULT 0,
    reject_reason TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sppd_itinerary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sppd_id INTEGER NOT NULL,
    tanggal TEXT DEFAULT '',
    dari TEXT DEFAULT '',
    ke TEXT DEFAULT '',
    transport TEXT DEFAULT '',
    keterangan TEXT DEFAULT '',
    FOREIGN KEY (sppd_id) REFERENCES sppd(id)
  );

  CREATE TABLE IF NOT EXISTS sppd_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sppd_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    approver_user_id INTEGER,
    status TEXT DEFAULT 'pending',
    note TEXT DEFAULT '',
    acted_at TEXT,
    FOREIGN KEY (sppd_id) REFERENCES sppd(id),
    FOREIGN KEY (approver_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sppd_laporan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sppd_id INTEGER NOT NULL UNIQUE,
    tanggal_laporan TEXT DEFAULT '',
    isi_laporan TEXT DEFAULT '',
    total_biaya REAL DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    laporan_approval_level INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (sppd_id) REFERENCES sppd(id)
  );

  CREATE TABLE IF NOT EXISTS sppd_laporan_kunjungan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    laporan_id INTEGER NOT NULL,
    tanggal TEXT DEFAULT '',
    nama_instansi TEXT DEFAULT '',
    nama_kontak TEXT DEFAULT '',
    hasil TEXT DEFAULT '',
    FOREIGN KEY (laporan_id) REFERENCES sppd_laporan(id)
  );

  CREATE TABLE IF NOT EXISTS sppd_laporan_biaya (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    laporan_id INTEGER NOT NULL,
    keterangan TEXT DEFAULT '',
    jumlah REAL DEFAULT 0,
    FOREIGN KEY (laporan_id) REFERENCES sppd_laporan(id)
  );

  CREATE TABLE IF NOT EXISTS sppd_laporan_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    laporan_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    approver_user_id INTEGER,
    status TEXT DEFAULT 'pending',
    note TEXT DEFAULT '',
    acted_at TEXT,
    FOREIGN KEY (laporan_id) REFERENCES sppd_laporan(id),
    FOREIGN KEY (approver_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sppd_pencairan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sppd_id INTEGER NOT NULL UNIQUE,
    jumlah_diajukan REAL DEFAULT 0,
    jumlah_disetujui REAL DEFAULT 0,
    catatan TEXT DEFAULT '',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    approved_by INTEGER,
    approved_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (sppd_id) REFERENCES sppd(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
  );
`);

// ── Default users untuk SPPD ──────────────────────────────────────────────────
[
  { username: 'area_manager1', password: 'kirana', full_name: 'Area Manager 1', role: 'area_manager' },
  { username: 'danny',         password: 'kirana', full_name: 'Danny',          role: 'gm2' },
].forEach(u => {
  if (!db.prepare('SELECT id FROM users WHERE username = ?').get(u.username)) {
    db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run(u.username, u.password, u.full_name, u.role);
    console.log(`✅ SPPD user default dibuat: ${u.username} (${u.role})`);
  }
});

// ── MIGRATION: rename username gm2 → danny ────────────────────────────────────
const oldGm2User = db.prepare("SELECT id FROM users WHERE username = 'gm2' AND role = 'gm2'").get();
if (oldGm2User) {
  // Hapus user danny yang baru saja di-seed (belum punya data) agar tidak konflik UNIQUE
  db.prepare("DELETE FROM users WHERE username='danny' AND role='gm2' AND id != ?").run(oldGm2User.id);
  db.prepare("UPDATE users SET username='danny', full_name='Danny' WHERE id=?").run(oldGm2User.id);
  console.log('✅ User gm2 direname menjadi danny');
}

// ── MIGRATION: sppd_itinerary new columns (rencana kunjungan) ─────────────────
[
  "ALTER TABLE sppd_itinerary ADD COLUMN lokasi TEXT DEFAULT ''",
  "ALTER TABLE sppd_itinerary ADD COLUMN pelanggan TEXT DEFAULT ''",
  "ALTER TABLE sppd_itinerary ADD COLUMN aktivitas TEXT DEFAULT ''",
  "ALTER TABLE sppd_itinerary ADD COLUMN sasaran_nilai_project REAL DEFAULT 0",
  "ALTER TABLE sppd_itinerary ADD COLUMN produk TEXT DEFAULT ''",
].forEach(sql => { try { db.exec(sql); } catch {} });

// ── New sppd_biaya table (structured cost estimate per SPPD) ──────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sppd_biaya (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sppd_id INTEGER NOT NULL UNIQUE,
    akomodasi REAL DEFAULT 0,
    konsumsi REAL DEFAULT 0,
    transportasi REAL DEFAULT 0,
    entertain REAL DEFAULT 0,
    uang_saku REAL DEFAULT 0,
    biaya_lain REAL DEFAULT 0,
    biaya_lain_ket TEXT DEFAULT '',
    total REAL DEFAULT 0,
    FOREIGN KEY (sppd_id) REFERENCES sppd(id)
  );
`);

// ── MIGRATION: sppd_laporan new column ───────────────────────────────────────
try { db.exec("ALTER TABLE sppd_laporan ADD COLUMN catatan_umum TEXT DEFAULT ''"); } catch {}

// ── MIGRATION: sppd_laporan_kunjungan new columns ─────────────────────────────
[
  "ALTER TABLE sppd_laporan_kunjungan ADD COLUMN nama_pelanggan TEXT DEFAULT ''",
  "ALTER TABLE sppd_laporan_kunjungan ADD COLUMN laporan_kunjungan TEXT DEFAULT ''",
].forEach(sql => { try { db.exec(sql); } catch {} });

// ── MIGRATION: recreate sppd_pencairan with new schema ────────────────────────
const pencairanDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sppd_pencairan'").get();
if (pencairanDef && !pencairanDef.sql.includes('jumlah_usulan')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE sppd_pencairan_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sppd_id INTEGER NOT NULL UNIQUE,
      jumlah_usulan REAL DEFAULT 0,
      jumlah_realisasi REAL DEFAULT 0,
      jumlah_dicairkan REAL DEFAULT 0,
      catatan TEXT DEFAULT '',
      status TEXT DEFAULT 'belum_cair' CHECK(status IN ('belum_cair','dalam_proses','sudah_cair')),
      updated_by INTEGER,
      updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (sppd_id) REFERENCES sppd(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );
    INSERT INTO sppd_pencairan_v2 (sppd_id, jumlah_usulan, jumlah_dicairkan, catatan, status, created_at)
      SELECT sppd_id, jumlah_diajukan, jumlah_disetujui, catatan,
        CASE status WHEN 'approved' THEN 'sudah_cair' WHEN 'pending' THEN 'belum_cair' ELSE 'belum_cair' END,
        created_at FROM sppd_pencairan;
    DROP TABLE sppd_pencairan;
    ALTER TABLE sppd_pencairan_v2 RENAME TO sppd_pencairan;
  `);
  db.pragma('foreign_keys = ON');
  console.log('✅ sppd_pencairan upgraded: belum_cair/dalam_proses/sudah_cair schema');
}

// ── Default SPPD settings ─────────────────────────────────────────────────────
[
  ['sppd_nomor_prefix', 'SPPD-LAK'],
  ['sppd_kota_asal', 'Jakarta'],
].forEach(([key, val]) => {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, val);
});

// ── Default user marketing1 ───────────────────────────────────────────────────
if (!db.prepare('SELECT id FROM users WHERE username = ?').get('marketing1')) {
  db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run('marketing1', 'kirana', 'Marketing 1', 'marketing');
  console.log('✅ Default user marketing1 dibuat');
}

// ── Pencairan approval table & column ─────────────────────────────────────────
try { db.exec("ALTER TABLE sppd_pencairan ADD COLUMN pencairan_approval_level INTEGER DEFAULT 1"); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS sppd_pencairan_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pencairan_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    approver_user_id INTEGER,
    status TEXT DEFAULT 'pending',
    note TEXT DEFAULT '',
    acted_at TEXT,
    FOREIGN KEY (pencairan_id) REFERENCES sppd_pencairan(id),
    FOREIGN KEY (approver_user_id) REFERENCES users(id)
  );
`);

// ── MIGRATION: pending SPPD approval level remap ──────────────────────────────
// Old: sppd_approval_level=1 means "AM approved, waiting for GM (sequential)"
// New: sppd_approval_level=1 means "AM approved, waiting for GM1+GM2 (parallel)"
// Semantic is the same for level 1, but old level 2 (gm approved, waiting for gm2) is now
// still level 1 in new semantics — gm2 can approve even if gm already approved.
// No remap needed: both old and new use sppd_approval_level=1 for "GM stage".

// ── MIGRATION: pending LAPORAN approval remap (4-level → 6-level) ─────────────
// Old: laporan_approval_level=0 means not started (next=gm), 1=gm done, 2=gm2 done...
// New: laporan_approval_level=1 means waiting for AM, 2=waiting for MK, 3=GM stage, 5=waiting DO...
const pendingLaporans = db.prepare(`
  SELECT l.id, l.laporan_approval_level
  FROM sppd_laporan l
  WHERE l.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM sppd_laporan_approvals a WHERE a.laporan_id = l.id AND a.level = 5)
`).all();

for (const laporan of pendingLaporans) {
  const oldLevel = laporan.laporan_approval_level;
  if (oldLevel === 0) {
    // Not yet started: set to 1 (waiting for area_manager)
    db.prepare('UPDATE sppd_laporan SET laporan_approval_level=1 WHERE id=?').run(laporan.id);
    continue;
  }
  // Old approval records for this laporan
  const oldApprovals = db.prepare('SELECT * FROM sppd_laporan_approvals WHERE laporan_id=? ORDER BY level').all(laporan.id);
  const oldToNew = { 1: 3, 2: 4, 3: 5, 4: 6 }; // old level → new level
  const oldLevelToNewSubmLevel = { 0: 1, 1: 3, 2: 5, 3: 6 };

  // Delete old approval records and reinsert at new levels
  db.prepare('DELETE FROM sppd_laporan_approvals WHERE laporan_id=?').run(laporan.id);

  for (const a of oldApprovals) {
    const newLevel = oldToNew[a.level];
    if (!newLevel) continue;
    db.prepare('INSERT INTO sppd_laporan_approvals (laporan_id, level, approver_user_id, status, note, acted_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(laporan.id, newLevel, a.approver_user_id, a.status, a.note, a.acted_at);
  }

  // Auto-insert area_manager (level 1) and manager_keuangan (level 2) as approved for migrated laporans
  db.prepare("INSERT OR IGNORE INTO sppd_laporan_approvals (laporan_id, level, status, note) VALUES (?, 1, 'approved', 'Auto-migrasi sistem')").run(laporan.id);
  db.prepare("INSERT OR IGNORE INTO sppd_laporan_approvals (laporan_id, level, status, note) VALUES (?, 2, 'approved', 'Auto-migrasi sistem')").run(laporan.id);

  // If gm was approved (old level 1 → new level 3), also auto-approve gm2 (new level 4)
  const wasGmApproved = oldApprovals.some(a => a.level === 1 && a.status === 'approved');
  if (wasGmApproved) {
    db.prepare("INSERT OR IGNORE INTO sppd_laporan_approvals (laporan_id, level, status, note) VALUES (?, 4, 'approved', 'Auto-migrasi sistem')").run(laporan.id);
  }

  const newSubmLevel = oldLevelToNewSubmLevel[oldLevel] ?? oldLevel;
  db.prepare('UPDATE sppd_laporan SET laporan_approval_level=? WHERE id=?').run(newSubmLevel, laporan.id);
}
if (pendingLaporans.length > 0) {
  console.log(`✅ Migrasi Laporan: ${pendingLaporans.length} laporan pending diupgrade ke sistem 6 level`);
}

// ── MIGRATION: KK 4-level → 6-level approval system ──────────────────────────
// Level mapping: old(1=MK,2=GM,3=DO,4=DU) → new(1=AM,2=MK,3=GM1,4=GM2,5=DO,6=DU)
const pendingKKSubs = db.prepare(`
  SELECT s.id, s.kk_approval_level
  FROM submissions s
  WHERE s.submission_type = 'kk' AND s.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM kk_approvals a WHERE a.submission_id = s.id AND a.level = 5)
    AND EXISTS (SELECT 1 FROM kk_approvals a WHERE a.submission_id = s.id AND a.level <= 4)
`).all();

if (pendingKKSubs.length > 0) {
  const oldToNewLevel = { 1: 2, 2: 3, 3: 5, 4: 6 };
  const oldToNewSubmLevel = { 1: 2, 2: 3, 3: 5, 4: 6 };

  for (const sub of pendingKKSubs) {
    const oldApprovals = db.prepare('SELECT * FROM kk_approvals WHERE submission_id=? ORDER BY level').all(sub.id);

    db.prepare('DELETE FROM kk_approvals WHERE submission_id=?').run(sub.id);

    for (let level = 1; level <= 6; level++) {
      db.prepare("INSERT INTO kk_approvals (submission_id, level, status) VALUES (?, ?, 'pending')").run(sub.id, level);
    }

    // Auto-approve level 1 (area_manager) — sistem lama tidak memiliki step ini
    db.prepare("UPDATE kk_approvals SET status='approved', note='Auto-migrasi sistem' WHERE submission_id=? AND level=1").run(sub.id);

    // Map old approved levels to new levels
    for (const oldApproval of oldApprovals) {
      if (oldApproval.status === 'approved') {
        const newLevel = oldToNewLevel[oldApproval.level];
        if (newLevel) {
          db.prepare("UPDATE kk_approvals SET status='approved', approver_user_id=?, note=?, acted_at=? WHERE submission_id=? AND level=?")
            .run(oldApproval.approver_user_id, oldApproval.note, oldApproval.acted_at, sub.id, newLevel);
        }
      }
    }

    // Auto-approve gm2 (level 4) jika GM lama sudah approved (agar tidak stuck di GM stage)
    const wasGmApproved = oldApprovals.some(a => a.level === 2 && a.status === 'approved');
    if (wasGmApproved) {
      db.prepare("UPDATE kk_approvals SET status='approved', note='Auto-migrasi sistem' WHERE submission_id=? AND level=4").run(sub.id);
    }

    // Remap kk_approval_level
    const newSubmLevel = oldToNewSubmLevel[sub.kk_approval_level] || sub.kk_approval_level;
    db.prepare('UPDATE submissions SET kk_approval_level=? WHERE id=?').run(newSubmLevel, sub.id);
  }
  console.log(`✅ Migrasi KK: ${pendingKKSubs.length} KK pending diupgrade ke sistem approval 6 level`);
}

// ── Laporan Bulanan tables ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS laporan_bulanan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    periode TEXT NOT NULL,
    alasan TEXT DEFAULT '',
    aktivitas_bulan_ini TEXT DEFAULT '',
    rencana_bulan_depan TEXT DEFAULT '',
    prognosa_bulan_depan REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE (user_id, periode)
  );

  CREATE TABLE IF NOT EXISTS laporan_support (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    laporan_id INTEGER NOT NULL,
    keterangan TEXT DEFAULT '',
    FOREIGN KEY (laporan_id) REFERENCES laporan_bulanan(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS laporan_project (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    laporan_id INTEGER NOT NULL,
    pelanggan TEXT DEFAULT '',
    principal TEXT DEFAULT '',
    produk TEXT DEFAULT '',
    nilai REAL DEFAULT 0,
    FOREIGN KEY (laporan_id) REFERENCES laporan_bulanan(id) ON DELETE CASCADE
  );
`);

// Migrasi: tambah kolom probability jika belum ada
try { db.exec("ALTER TABLE laporan_project ADD COLUMN probability REAL DEFAULT 0"); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS laporan_tanggapan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    laporan_id INTEGER NOT NULL,
    reviewer_id INTEGER NOT NULL,
    tanggapan TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (laporan_id) REFERENCES laporan_bulanan(id) ON DELETE CASCADE,
    UNIQUE(laporan_id, reviewer_id)
  );
  CREATE TABLE IF NOT EXISTS laporan_support_tanggapan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    support_id INTEGER NOT NULL,
    reviewer_id INTEGER NOT NULL,
    tanggapan TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (support_id) REFERENCES laporan_support(id) ON DELETE CASCADE,
    UNIQUE(support_id, reviewer_id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sales_target (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    area_kerja TEXT NOT NULL,
    periode TEXT NOT NULL,
    target REAL DEFAULT 0,
    penjualan REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(area_kerja, periode)
  );
`);

// ── MIGRATION: notifications table ───────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    type TEXT DEFAULT 'info',
    ref_type TEXT DEFAULT '',
    ref_id INTEGER,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
`);

// ── Auto-backup saat server start ────────────────────────────────────────────
(async () => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const tempPath  = path.join(BACKUP_DIR, `_temp_${ts}.db`);
    const finalPath = path.join(BACKUP_DIR, `backup_${ts}.db.gz`);
    await db.backup(tempPath);
    const compressed = zlib.gzipSync(fs.readFileSync(tempPath), { level: 9 });
    fs.writeFileSync(finalPath, compressed);
    fs.unlinkSync(tempPath);
    // Hapus backup lama, simpan hanya 10 terbaru
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup_') && f.endsWith('.db.gz'))
      .sort().reverse();
    files.slice(10).forEach(f => { try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {} });
    console.log(`✅ Auto-backup: ${path.basename(finalPath)} (${(compressed.length/1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error('Auto-backup gagal:', e.message);
  }
})();

module.exports = db;
