// Saklar fitur yang disimpan di tabel settings (bisa diubah admin tanpa deploy).
// database.js di-require secara lazy agar database.js bisa memakai konstanta di file ini
// untuk seed tanpa circular require.

const ERP_NOTICE_DEFAULTS = {
  erp_notice_sppd: 'Pengajuan SPPD baru kini dilakukan melalui ERP. Data SPPD lama tetap dapat dilihat dan diproses di sini.',
  erp_notice_um:   'Pengajuan Uang Muka baru kini dilakukan melalui ERP. Data Uang Muka lama tetap dapat dilihat dan diproses di sini.',
};

function getSetting(key) {
  const row = require('./database').prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : undefined;
}

// true hanya jika value === '1'
function isFeatureEnabled(key) {
  return getSetting(key) === '1';
}

// Teks pemberitahuan ERP; fallback ke default jika key tidak ada / kosong
function getErpNotice(key) {
  const v = getSetting(key);
  return (typeof v === 'string' && v.trim()) ? v : (ERP_NOTICE_DEFAULTS[key] || '');
}

module.exports = { ERP_NOTICE_DEFAULTS, getSetting, isFeatureEnabled, getErpNotice };
