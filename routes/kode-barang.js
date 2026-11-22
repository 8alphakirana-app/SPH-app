const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { notifyKodeBarangSelesai } = require('../notif');

// Sama dengan LEVEL_LABELS di routes/kk.js
const LEVEL_LABELS = { 1: 'Area Manager', 2: 'Manager Keuangan', 3: 'GM 1', 4: 'GM 2', 5: 'Direktur Operasional', 6: 'Direktur Utama' };

const STATUS_VALID = ['menunggu', 'selesai', 'batal'];

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
  next();
}

router.use(requireAdmin);

function statusKKLabel(r) {
  if (r.kk_status === 'rejected') return 'Ditolak';
  if (r.kk_status === 'approved') return 'Disetujui';
  return 'Menunggu ' + (LEVEL_LABELS[r.kk_approval_level] || '');
}

function jenisLabel(r) {
  if (r.perlu_kode_baru && r.tayang_ecatalog) return 'Kode Baru + e-Catalog';
  if (r.perlu_kode_baru) return 'Kode Baru';
  if (r.tayang_ecatalog) return 'e-Catalog';
  return '-';
}

// Query antrian dengan filter status / jenis / q
function queryRows(query) {
  const status = query.status || 'menunggu';
  const jenis  = query.jenis || '';
  const q      = (query.q || '').trim();
  const where  = [];
  const params = [];

  if (status !== 'semua') {
    where.push('kb.status = ?');
    params.push(STATUS_VALID.includes(status) ? status : 'menunggu');
  }
  if (jenis === 'kode_baru') where.push('kb.perlu_kode_baru = 1');
  else if (jenis === 'ecat') where.push('kb.tayang_ecatalog = 1 AND kb.perlu_kode_baru = 0');
  if (q) {
    where.push('(kb.nama_barang LIKE ? OR kb.supplier_nama LIKE ? OR kk.nomor_surat LIKE ? OR kk.nama_pekerjaan LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const rows = db.prepare(`
    SELECT kb.*, kk.nomor_surat, kk.nama_pekerjaan, kk.pelanggan,
           s.status AS kk_status, s.kk_approval_level, s.created_by,
           u.full_name AS creator_name
    FROM kk_kode_barang kb
    JOIN kertas_kerja kk ON kk.submission_id = kb.submission_id
    JOIN submissions s   ON s.id = kb.submission_id
    LEFT JOIN users u    ON u.id = s.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY kb.created_at DESC, kb.id DESC
  `).all(...params);

  return rows.map(r => ({ ...r, status_kk_label: statusKKLabel(r) }));
}

// ── GET /api/kode-barang ─────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json(queryRows(req.query));
});

// ── GET /api/kode-barang/count ───────────────────────────────────────────────
router.get('/count', (req, res) => {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM kk_kode_barang WHERE status='menunggu'").get();
  res.json({ menunggu: n });
});

// ── GET /api/kode-barang/export-excel ────────────────────────────────────────
router.get('/export-excel', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const rows = queryRows(req.query);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Kode Barang');
    const rupiah = '"Rp "#,##0';
    const statusAntrian = { menunggu: 'Menunggu', selesai: 'Selesai', batal: 'Batal' };
    const tipeLabel = { serial: 'Serial', lot_ed: 'Lot/ED', none: 'Tidak Ada' };
    const supLabel  = { pks: 'PKS', lokal: 'Lokal' };

    ws.columns = [
      { header: 'Tgl Masuk',             key: 'created_at',       width: 18 },
      { header: 'No. KK',                key: 'nomor_surat',      width: 18 },
      { header: 'Nama Pekerjaan',        key: 'nama_pekerjaan',   width: 32 },
      { header: 'Nama Barang',           key: 'nama_barang',      width: 30 },
      { header: 'Jenis',                 key: 'jenis',            width: 20 },
      { header: 'Satuan',                key: 'satuan',           width: 10 },
      { header: 'Tipe',                  key: 'tipe_barang',      width: 12 },
      { header: 'Supplier',              key: 'supplier_nama',    width: 26 },
      { header: 'Status Supplier',       key: 'supplier_status',  width: 14 },
      { header: 'Harga Jual DPP/unit',   key: 'harga_jual_dpp',   width: 20, style: { numFmt: rupiah } },
      { header: 'Harga Beli DPP/unit',   key: 'harga_beli_dpp',   width: 20, style: { numFmt: rupiah } },
      { header: 'Ada Faktur',            key: 'ada_faktur',       width: 11 },
      { header: 'Link',                  key: 'link_produk',      width: 30 },
      { header: 'Kode Lama',             key: 'kode_barang_lama', width: 16 },
      { header: 'Status KK',             key: 'status_kk_label',  width: 24 },
      { header: 'Status Antrian',        key: 'status',           width: 14 },
      { header: 'Kode Barang',           key: 'kode_barang',      width: 16 },
      { header: 'Catatan',               key: 'catatan_admin',    width: 30 },
      { header: 'KK Ditolak',            key: 'kk_ditolak',       width: 11 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    rows.forEach(r => ws.addRow({
      created_at:       r.created_at || '',
      nomor_surat:      r.nomor_surat || '',
      nama_pekerjaan:   r.nama_pekerjaan || '',
      nama_barang:      r.nama_barang || '',
      jenis:            jenisLabel(r),
      satuan:           r.satuan || '',
      tipe_barang:      tipeLabel[r.tipe_barang] || r.tipe_barang || '',
      supplier_nama:    r.supplier_nama || '',
      supplier_status:  supLabel[r.supplier_status] || r.supplier_status || '',
      harga_jual_dpp:   r.harga_jual_dpp || 0,
      harga_beli_dpp:   r.harga_beli_dpp || 0,
      ada_faktur:       r.ada_faktur ? 'Ya' : 'Tidak',
      link_produk:      r.link_produk || '',
      kode_barang_lama: r.kode_barang_lama || '',
      status_kk_label:  r.status_kk_label,
      status:           statusAntrian[r.status] || r.status,
      kode_barang:      r.kode_barang || '',
      catatan_admin:    r.catatan_admin || '',
      kk_ditolak:       r.kk_ditolak ? 'Ya' : 'Tidak',
    }));

    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="kode-barang-${ymd}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Kode barang Excel error:', err);
    res.status(500).json({ error: 'Gagal generate Excel: ' + err.message });
  }
});

// ── PUT /api/kode-barang/:id/selesai ─────────────────────────────────────────
router.put('/:id/selesai', (req, res) => {
  const row = db.prepare(`
    SELECT kb.*, s.created_by FROM kk_kode_barang kb
    JOIN submissions s ON s.id = kb.submission_id
    WHERE kb.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Data tidak ditemukan' });
  if (row.status !== 'menunggu') return res.status(400).json({ error: 'Hanya antrian berstatus menunggu yang dapat diproses' });

  const kodeBarang = String(req.body.kode_barang ?? '').trim();
  const catatan    = String(req.body.catatan_admin ?? '').trim();
  if (row.perlu_kode_baru && !kodeBarang) return res.status(400).json({ error: 'Kode barang wajib diisi untuk produk kode baru' });

  db.prepare(`
    UPDATE kk_kode_barang SET status='selesai', kode_barang=?, catatan_admin=?,
      processed_by=?, processed_at=datetime('now','localtime')
    WHERE id=?
  `).run(kodeBarang, catatan, req.session.user.id, row.id);

  notifyKodeBarangSelesai(row.submission_id, row.created_by, row.nama_barang, kodeBarang);
  res.json({ success: true });
});

// ── PUT /api/kode-barang/:id/batal ───────────────────────────────────────────
router.put('/:id/batal', (req, res) => {
  const row = db.prepare('SELECT * FROM kk_kode_barang WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Data tidak ditemukan' });
  if (row.status !== 'menunggu') return res.status(400).json({ error: 'Hanya antrian berstatus menunggu yang dapat dibatalkan' });

  const catatan = String(req.body.catatan_admin ?? '').trim();
  if (!catatan) return res.status(400).json({ error: 'Catatan wajib diisi untuk membatalkan' });

  db.prepare(`
    UPDATE kk_kode_barang SET status='batal', catatan_admin=?,
      processed_by=?, processed_at=datetime('now','localtime')
    WHERE id=?
  `).run(catatan, req.session.user.id, row.id);

  res.json({ success: true });
});

module.exports = router;
