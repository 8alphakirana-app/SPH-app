const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'sph.db');

// Pastikan folder data ada
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
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

module.exports = db;
