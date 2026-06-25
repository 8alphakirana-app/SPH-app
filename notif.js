const db = require('./database');

// ── Alur approval — satu konstanta untuk semua ────────────────────────────────
const KK_APPROVER_ROLES = {
  1: ['area_manager'],
  2: ['manager_keuangan'],
  3: ['gm'],
  4: ['gm2'],
  5: ['direktur_ops'],
  6: ['direktur_utama'],
};

const KK_LEVEL_LABELS = {
  1: 'Area Manager', 2: 'Manager Keuangan', 3: 'GM', 4: 'GM 2',
  5: 'Direktur Ops', 6: 'Direktur Utama',
};

const SPH_APPROVER_ROLES = ['admin', 'kantor_pusat', 'gm', 'gm2'];

const SPPD_APPROVER_ROLES = {
  0: ['area_manager'],
  1: ['gm', 'gm2'],
};

// ── Core ──────────────────────────────────────────────────────────────────────
function createNotification(userId, { title, body = '', type = 'info', ref_type = '', ref_id = null }) {
  try {
    db.prepare(
      'INSERT INTO notifications (user_id, title, body, type, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, title, body, type, ref_type ?? '', ref_id ?? null);
  } catch (e) {
    console.error('[notif] createNotification error:', e.message);
  }
}

function _notifyByRoles(roles, payload, areaKerja = null) {
  try {
    const ph = roles.map(() => '?').join(',');
    let users;
    if (areaKerja) {
      users = db.prepare(
        `SELECT id FROM users WHERE role IN (${ph}) AND LOWER(TRIM(area_kerja)) = LOWER(TRIM(?))`
      ).all(...roles, areaKerja);
    } else {
      users = db.prepare(`SELECT id FROM users WHERE role IN (${ph})`).all(...roles);
    }
    users.forEach(u => createNotification(u.id, payload));
  } catch (e) {
    console.error('[notif] _notifyByRoles error:', e.message);
  }
}

// ── SPH ───────────────────────────────────────────────────────────────────────
function notifySPHCreated(sphId) {
  _notifyByRoles(SPH_APPROVER_ROLES, {
    title: 'SPH Baru Menunggu Persetujuan',
    body: `SPH #${sphId} baru masuk dan menunggu disetujui`,
    type: 'approval',
    ref_type: 'sph',
    ref_id: sphId,
  });
}

function notifySPHResult(sphId, creatorId, action) {
  createNotification(creatorId, {
    title: action === 'approved' ? `SPH #${sphId} Disetujui` : `SPH #${sphId} Ditolak`,
    body: action === 'approved' ? 'SPH Anda telah disetujui' : 'SPH Anda ditolak',
    type: action === 'approved' ? 'success' : 'reject',
    ref_type: 'sph',
    ref_id: sphId,
  });
}

// ── KK ────────────────────────────────────────────────────────────────────────
function notifyKKNextLevel(kkId, nextLevel, creatorAreaKerja) {
  const roles = KK_APPROVER_ROLES[nextLevel];
  if (!roles) return;
  const areaKerja = nextLevel === 1 ? (creatorAreaKerja || null) : null;
  _notifyByRoles(roles, {
    title: `KK #${kkId} Menunggu Persetujuan ${KK_LEVEL_LABELS[nextLevel] || ''}`,
    body: `Kertas Kerja #${kkId} perlu persetujuan Anda`,
    type: 'approval',
    ref_type: 'kk',
    ref_id: kkId,
  }, areaKerja);
}

function notifyKKResult(kkId, creatorId, action) {
  createNotification(creatorId, {
    title: action === 'approved' ? `KK #${kkId} Disetujui Semua` : `KK #${kkId} Ditolak`,
    body: action === 'approved' ? 'Kertas Kerja Anda telah disetujui penuh' : 'Kertas Kerja Anda ditolak',
    type: action === 'approved' ? 'success' : 'reject',
    ref_type: 'kk',
    ref_id: kkId,
  });
}

// ── SPPD ──────────────────────────────────────────────────────────────────────
function notifySPPDNextLevel(sppdId, nextLevel, creatorAreaKerja) {
  const roles = SPPD_APPROVER_ROLES[nextLevel];
  if (!roles) return;
  const areaKerja = nextLevel === 0 ? (creatorAreaKerja || null) : null;
  _notifyByRoles(roles, {
    title: `SPPD #${sppdId} Menunggu Persetujuan`,
    body: `SPPD #${sppdId} perlu persetujuan Anda`,
    type: 'approval',
    ref_type: 'sppd',
    ref_id: sppdId,
  }, areaKerja);
}

function notifySPPDResult(sppdId, creatorId, action) {
  createNotification(creatorId, {
    title: action === 'approved' ? `SPPD #${sppdId} Disetujui` : `SPPD #${sppdId} Ditolak`,
    body: action === 'approved' ? 'SPPD Anda telah disetujui' : 'SPPD Anda ditolak',
    type: action === 'approved' ? 'success' : 'reject',
    ref_type: 'sppd',
    ref_id: sppdId,
  });
}

module.exports = {
  createNotification,
  notifySPHCreated, notifySPHResult,
  notifyKKNextLevel, notifyKKResult,
  notifySPPDNextLevel, notifySPPDResult,
};
