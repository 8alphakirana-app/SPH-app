const express = require('express');
const router  = express.Router();
const { parseString } = require('fast-csv');
const ExcelJS = require('exceljs');

// ── Sumber data: CSV hasil publish Google Spreadsheet (bukan DB lokal) ──────
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRFeEKo72z8UUWLC7yiUjs1v7RimLq73UMCJtr3RSDtdSPo-W7GMRLJDUSXHQn3kXh3rShUYYwIfm0g/pub?gid=1919626052&single=true&output=csv';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam
let cache = { rows: null, fetchedAt: 0 };

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

const PUSAT_ROLES = ['admin', 'kantor_pusat', 'gm', 'gm2', 'manager_keuangan', 'direktur_ops', 'direktur_utama', 'viewer'];

function isPusat(user) {
  if (PUSAT_ROLES.includes(user.role)) return true;
  return (user.area_kerja || '').trim().toLowerCase() === 'kantor pusat';
}

// Angka bertipe teks seperti "  3,717,000.00 " -> koma pemisah ribuan, titik desimal
function parseAngka(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

function s(v) {
  return String(v == null ? '' : v).trim();
}

// ── Ambil & cache data CSV di memori ────────────────────────────────────────
function fetchAndParseCsv() {
  return new Promise(async (resolve, reject) => {
    let text;
    try {
      const resp = await fetch(CSV_URL);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      text = await resp.text();
    } catch (e) {
      return reject(e);
    }

    const rows = [];
    parseString(text, { headers: (headers) => headers.map(h => String(h || '').trim()) })
      .on('error', reject)
      .on('data', (row) => {
        rows.push({
          area: s(row['Area']),
          coverage: s(row['Coverage']),
          tipe: s(row['TIPE']),
          jenis: s(row['JENIS BARANG']),
          principal: s(row['PRINCIPAL']),
          custId: s(row['CUST_ID']),
          custName: s(row['NAMA_PELANGGAN']),
          kategori: s(row['KATEGORI_PELANGGAN']),
          prodId: s(row['PROD_ID']),
          prodName: s(row['PROD_NAME']),
          uom: s(row['UOM']),
          kwt: parseAngka(row['KWT']),
          neto: parseAngka(row['NETO']),
          year: s(row['PER_YEAR']),
        });
      })
      .on('end', () => resolve(rows));
  });
}

async function loadRows(forceRefresh) {
  const expired = !cache.rows || (Date.now() - cache.fetchedAt) > CACHE_TTL_MS;
  if (cache.rows && !expired && !forceRefresh) return cache.rows;

  const rows = await fetchAndParseCsv();
  cache = { rows, fetchedAt: Date.now() };
  return rows;
}

const FACETS = ['area', 'coverage', 'principal', 'tipe', 'jenis'];
const FACET_FIELD = { area: 'area', coverage: 'coverage', principal: 'principal', tipe: 'tipe', jenis: 'jenis' };

// ── Terapkan aturan akses area (server-side, tidak boleh di-bypass) + seleksi filter ───────
// Non-pusat: paksa area sendiri, param `sel.area` dari client SELALU diabaikan (termasuk saat exclude='area').
// Pusat: tanpa `sel.area` -> semua area; dengan `sel.area` -> filter 1 area (case-insensitive), kecuali di-exclude.
// opts.exclude: nama 1 facet yang dilewati (dipakai untuk menghitung opsi faceted milik facet itu sendiri).
function applyFilters(rows, user, sel, opts) {
  opts = opts || {};
  const exclude = opts.exclude || '';
  let out = rows;

  if (isPusat(user)) {
    if (exclude !== 'area') {
      const areaSel = s(sel.area).toLowerCase();
      if (areaSel) out = out.filter(r => r.area.toLowerCase() === areaSel);
    }
  } else {
    const myArea = (user.area_kerja || '').trim().toLowerCase();
    out = out.filter(r => r.area.toLowerCase() === myArea);
  }

  ['coverage', 'principal', 'tipe', 'jenis'].forEach(facet => {
    if (facet === exclude) return;
    const val = s(sel[facet]).toLowerCase();
    if (!val) return;
    const field = FACET_FIELD[facet];
    out = out.filter(r => r[field].toLowerCase() === val);
  });

  return out;
}

function uniqSorted(values) {
  return Array.from(new Set(values.filter(v => v))).sort((a, b) => a.localeCompare(b, 'id'));
}

// Dedup Area berdasarkan lowercase, label kanonik = varian ejaan yang paling sering muncul
function buildCanonicalAreaList(rows) {
  const groups = new Map(); // lowercase -> Map<varian, count>
  rows.forEach(r => {
    if (!r.area) return;
    const key = r.area.toLowerCase();
    let variants = groups.get(key);
    if (!variants) { variants = new Map(); groups.set(key, variants); }
    variants.set(r.area, (variants.get(r.area) || 0) + 1);
  });
  const canonical = [];
  groups.forEach(variants => {
    let best = null, bestCount = -1;
    variants.forEach((count, variant) => { if (count > bestCount) { best = variant; bestCount = count; } });
    canonical.push(best);
  });
  return canonical.sort((a, b) => a.localeCompare(b, 'id'));
}

function selFromQuery(q) {
  return { area: q.area, coverage: q.coverage, principal: q.principal, tipe: q.tipe, jenis: q.jenis };
}

// ── GET /api/analisa-pelanggan/filters ──────────────────────────────────────
// Faceted: tiap facet dihitung dari baris yang sudah kena SEMUA filter aktif KECUALI facet itu sendiri,
// sehingga opsi tiap dropdown menyempit mengikuti pilihan di dropdown lain, tapi facet yang sedang
// diubah tetap menampilkan semua nilainya sendiri yang valid.
router.get('/filters', requireLogin, async (req, res) => {
  try {
    const user = req.session.user;
    const allRows = await loadRows(req.query.refresh === '1');
    const sel = selFromQuery(req.query);

    const result = { areas: [], coverage: [], principal: [], tipe: [], jenis: [] };

    if (isPusat(user)) {
      result.areas = buildCanonicalAreaList(applyFilters(allRows, user, sel, { exclude: 'area' }));
    }
    ['coverage', 'principal', 'tipe', 'jenis'].forEach(facet => {
      const rows = applyFilters(allRows, user, sel, { exclude: facet });
      result[facet] = uniqSorted(rows.map(r => r[FACET_FIELD[facet]]));
    });

    res.json(result);
  } catch (e) {
    console.error('Analisa Pelanggan filters error:', e);
    res.status(502).json({ error: 'Gagal mengambil data spreadsheet' });
  }
});

// ── Terapkan aturan akses area + semua filter aktif, dipakai bersama oleh / , /detail, /export ─
async function scopedFilteredRows(req) {
  const rows = await loadRows(req.query.refresh === '1');
  return applyFilters(rows, req.session.user, selFromQuery(req.query), {});
}

function aggregateByCustomer(rows) {
  const byCust = new Map();
  rows.forEach(r => {
    const key = r.custId || r.custName;
    if (!key) return;
    let c = byCust.get(key);
    if (!c) {
      c = { custId: r.custId, custName: r.custName, kategori: r.kategori, total: 0, trxCount: 0, byYear: { '2023': 0, '2024': 0, '2025': 0 } };
      byCust.set(key, c);
    }
    c.total += r.neto;
    c.trxCount += 1;
    if (c.byYear[r.year] !== undefined) c.byYear[r.year] += r.neto;
    if (!c.kategori && r.kategori) c.kategori = r.kategori;
    if (!c.custName && r.custName) c.custName = r.custName;
  });
  return Array.from(byCust.values()).sort((a, b) => b.total - a.total);
}

// ── GET /api/analisa-pelanggan ──────────────────────────────────────────────
router.get('/', requireLogin, async (req, res) => {
  try {
    const rows = await scopedFilteredRows(req);
    const customers = aggregateByCustomer(rows);
    const grandTotal = customers.reduce((sum, c) => sum + c.total, 0);
    res.json({ customers, grandTotal, count: customers.length });
  } catch (e) {
    console.error('Analisa Pelanggan list error:', e);
    res.status(502).json({ error: 'Gagal mengambil data spreadsheet' });
  }
});

// ── GET /api/analisa-pelanggan/detail?cust=... ──────────────────────────────
router.get('/detail', requireLogin, async (req, res) => {
  try {
    const cust = s(req.query.cust).toLowerCase();
    if (!cust) return res.status(400).json({ error: 'Parameter cust diperlukan' });

    let rows = await scopedFilteredRows(req);
    rows = rows.filter(r => (r.custId || r.custName).toLowerCase() === cust);

    const byProd = new Map();
    rows.forEach(r => {
      const key = r.prodId || r.prodName;
      if (!key) return;
      let p = byProd.get(key);
      if (!p) {
        p = { prodName: r.prodName, uom: r.uom, principal: r.principal, jenis: r.jenis, qty: 0, total: 0 };
        byProd.set(key, p);
      }
      p.qty += r.kwt;
      p.total += r.neto;
    });

    const products = Array.from(byProd.values()).sort((a, b) => b.total - a.total);
    res.json({ products });
  } catch (e) {
    console.error('Analisa Pelanggan detail error:', e);
    res.status(502).json({ error: 'Gagal mengambil data spreadsheet' });
  }
});

// ── GET /api/analisa-pelanggan/export ───────────────────────────────────────
router.get('/export', requireLogin, async (req, res) => {
  let rows;
  try {
    rows = await scopedFilteredRows(req);
  } catch (e) {
    console.error('Analisa Pelanggan export error:', e);
    return res.status(502).json({ error: 'Gagal mengambil data spreadsheet' });
  }

  try {
    const customers = aggregateByCustomer(rows);

    const byCustProd = new Map();
    rows.forEach(r => {
      const custKey = r.custId || r.custName;
      const prodKey = r.prodId || r.prodName;
      if (!custKey || !prodKey) return;
      const key = custKey + '||' + prodKey;
      let p = byCustProd.get(key);
      if (!p) {
        p = { custName: r.custName, kategori: r.kategori, prodName: r.prodName, uom: r.uom, principal: r.principal, jenis: r.jenis, qty: 0, total: 0 };
        byCustProd.set(key, p);
      }
      p.qty += r.kwt;
      p.total += r.neto;
    });
    const products = Array.from(byCustProd.values())
      .sort((a, b) => (a.custName || '').localeCompare(b.custName || '', 'id') || b.total - a.total);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SPH LAK';
    wb.created = new Date();

    const ws1 = wb.addWorksheet('Rekap Pelanggan');
    ws1.columns = [
      { header: 'No', key: 'no', width: 5 },
      { header: 'Nama Pelanggan', key: 'nama', width: 42 },
      { header: 'Kategori', key: 'kategori', width: 28 },
      { header: 'Total 2023', key: 't2023', width: 18 },
      { header: 'Total 2024', key: 't2024', width: 18 },
      { header: 'Total 2025', key: 't2025', width: 18 },
      { header: 'Total 3 Tahun', key: 'total', width: 20 },
    ];
    ws1.getRow(1).font = { bold: true };
    ['t2023', 't2024', 't2025', 'total'].forEach(k => { ws1.getColumn(k).numFmt = '#,##0'; });
    customers.forEach((c, i) => {
      ws1.addRow({
        no: i + 1,
        nama: c.custName || '-',
        kategori: c.kategori || '-',
        t2023: Math.round(c.byYear['2023'] || 0),
        t2024: Math.round(c.byYear['2024'] || 0),
        t2025: Math.round(c.byYear['2025'] || 0),
        total: Math.round(c.total || 0),
      });
    });

    const ws2 = wb.addWorksheet('Rincian Produk');
    ws2.columns = [
      { header: 'Nama Pelanggan', key: 'nama', width: 38 },
      { header: 'Kategori', key: 'kategori', width: 26 },
      { header: 'Nama Produk', key: 'prod', width: 38 },
      { header: 'UOM', key: 'uom', width: 10 },
      { header: 'Principal', key: 'principal', width: 20 },
      { header: 'Jenis Barang', key: 'jenis', width: 18 },
      { header: 'Qty', key: 'qty', width: 12 },
      { header: 'Total', key: 'total', width: 18 },
    ];
    ws2.getRow(1).font = { bold: true };
    ['qty', 'total'].forEach(k => { ws2.getColumn(k).numFmt = '#,##0'; });
    products.forEach(p => {
      ws2.addRow({
        nama: p.custName || '-',
        kategori: p.kategori || '-',
        prod: p.prodName || '-',
        uom: p.uom || '-',
        principal: p.principal || '-',
        jenis: p.jenis || '-',
        qty: Math.round(p.qty || 0),
        total: Math.round(p.total || 0),
      });
    });

    const tanggal = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="analisa-pelanggan-${tanggal}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('Analisa Pelanggan export write error:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Gagal membuat file Excel' });
    else res.end();
  }
});

module.exports = router;
