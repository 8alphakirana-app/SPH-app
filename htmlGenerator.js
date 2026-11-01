const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

function formatRupiah(angka) {
    if (!angka && angka !== 0) return '0';
    return new Intl.NumberFormat('id-ID').format(angka);
}

function getNamaBulan(date) {
    const bulan = ['Januari','Februari','Maret','April','Mei','Juni',
                   'Juli','Agustus','September','Oktober','November','Desember'];
    return bulan[date.getMonth()];
}

function getTanggalIndo(dateStr) {
    const d = dateStr ? new Date(dateStr) : new Date();
    return `${d.getDate()} ${getNamaBulan(d)} ${d.getFullYear()}`;
}

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toBase64(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

async function generateBarcodeDataUrl(text) {
    try {
        return await QRCode.toDataURL(text, { width: 100, margin: 1 });
    } catch (err) {
        console.error('QR Code generation error:', err);
        return null;
    }
}

async function generateHTML(submission, settings) {
    const {
        nomor, client_title, client_name, client_address, client_city,
        items, ppn_included, ongkir_included, notes, lampiran, created_at
    } = submission;

    const companyName      = settings.company_name      || 'PT. Lapan Alpha Kirana';
    const companyTagline   = settings.company_tagline   || 'Perdagangan Alat Kesehatan';
    const companyAddress   = settings.company_address   || 'Jakarta';
    const companyHeadoffice= settings.company_headoffice|| '';
    const companyWarehouse = settings.company_warehouse || '';
    const signerName       = settings.signer_name       || 'Aris Hamdanny';
    const signerTitle      = settings.signer_title      || 'General Manager';
    const tanggal = getTanggalIndo(created_at);

    // Coba logo.png, fallback ke logo.jpg
    let logoDataUrl = toBase64(path.join(__dirname, 'public', 'img', 'logo.png'));
    if (!logoDataUrl) logoDataUrl = toBase64(path.join(__dirname, 'public', 'img', 'logo.jpg'));
    const ttdDataUrl = toBase64(path.join(__dirname, 'public', 'img', 'ttd.png'));

    const grandTotal = items.reduce(
        (s, i) => s + (parseFloat(i.qty) || 0) * (parseFloat(i.harga_satuan) || 0),
        0
    );

    const itemRows = (await Promise.all(items.map(async (item, idx) => {
        const qty   = parseFloat(item.qty)          || 0;
        const harga = parseFloat(item.harga_satuan) || 0;
        const bg    = idx % 2 === 0 ? '#ffffff' : '#eef4fb';
        let linkCell;
        if (item.link) {
            const barcodeDataUrl = await generateBarcodeDataUrl(item.link);
            if (barcodeDataUrl) {
                linkCell = `<td style="text-align:center;padding:2px 4px"><img src="${barcodeDataUrl}" style="width:60px;height:60px;" alt="QR"></td>`;
            } else {
                linkCell = `<td style="text-align:center;padding:2px 4px"><a href="${esc(item.link)}" target="_blank" style="color:#1F4E79;word-break:break-all;font-size:8pt">${esc(item.link)}</a></td>`;
            }
        } else {
            linkCell = `<td style="text-align:center;color:#aaa">-</td>`;
        }
        return `<tr style="background:${bg}">
            <td style="text-align:center">${idx + 1}</td>
            <td><strong>${esc(item.nama_produk)}</strong></td>
            <td>${esc(item.pabrikan || '')}</td>
            <td>${esc(item.spesifikasi || '')}</td>
            <td style="text-align:center">${esc(String(item.qty || ''))}</td>
            <td style="text-align:center">${esc(item.satuan || '')}</td>
            <td style="text-align:right">Rp ${formatRupiah(harga)}</td>
            <td style="text-align:right"><strong>Rp ${formatRupiah(qty * harga)}</strong></td>
            ${linkCell}
        </tr>`;
    }))).join('');

    const kondisi = [
        `Harga <strong>${ppn_included ? 'sudah' : 'belum'}</strong> termasuk PPN`,
        `Harga <strong>${ongkir_included ? 'sudah' : 'belum'}</strong> termasuk ongkos kirim`,
        ...(notes && notes.trim() ? [esc(notes.trim())] : []),
    ];



    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: #111; background: #fff; }
        .info-table { border-collapse: collapse; margin-bottom: 10px; }
        .info-table td { padding: 1px 0; font-size: 11pt; }
        .info-table .lbl { width: 80px; }
        .info-table .sep { width: 10px; }
        .kepada { line-height: 1.6; margin-bottom: 10px; }
        .pembuka { line-height: 1.7; margin-bottom: 10px; text-align: justify; }
        .tbl { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9pt; }
        .tbl th { background: #1F4E79; color: #fff; font-family: Arial, sans-serif; font-size: 8pt; font-weight: bold; padding: 5px 6px; text-align: center; border: 1px solid #1F4E79; }
        .tbl td { border: 1px solid #bbb; padding: 3px 6px; vertical-align: middle; }
        .tbl tfoot td { background: #d6e4f7; font-family: Arial, sans-serif; font-size: 9pt; font-weight: bold; color: #1F4E79; border: 1px solid #bbb; padding: 5px 6px; }
        .kondisi { margin-bottom: 8px; }
        .kondisi ul { padding-left: 16px; line-height: 1.7; }
        .penutup { line-height: 1.7; text-align: justify; margin-bottom: 8px; }
        .ttd-section { line-height: 1.6; }
        .ttd-img { display: block; max-height: 72px; max-width: 145px; margin: 3px 0; }
        .signer-name { text-decoration: underline; }
        .lampiran-header-logo { text-align: right; margin-bottom: 2mm; }
        .lampiran-header-logo img { max-height: 20mm; max-width: 35mm; object-fit: contain; }
        .lampiran-divider { border-top: 3px solid #1F4E79; border-bottom: 1px solid #1F4E79; height: 3px; margin-bottom: 8mm; }
    </style>
</head>
<body>

<!-- ════ INFO SURAT ════ -->
<table class="info-table">
    <tr><td class="lbl">Nomor</td>  <td class="sep">:</td><td>${esc(nomor || '___/___/___/____')}</td></tr>
    <tr><td class="lbl">Perihal</td> <td class="sep">:</td><td>Penawaran Harga</td></tr>
    <tr><td class="lbl">Lampiran</td><td class="sep">:</td><td>${esc(lampiran || '-')}</td></tr>
</table>

<!-- ════ KEPADA ════ -->
<div class="kepada">
    <div>Kepada Yth.</div>
    ${client_title ? `<div>${esc(client_title)}</div>` : ''}
    <div>${esc(client_name)}</div>
    <div>${esc(client_address)}</div>
    <div>${esc(client_city || 'di Tempat')}</div>
</div>

<!-- ════ PEMBUKA ════ -->
<div class="pembuka">
    <div style="margin-bottom:6px"><em>Dengan hormat,</em></div>
    <div>Bersama ini kami ${esc(companyName)} yang bergerak dibidang ${esc(companyTagline.toLowerCase())} bermaksud mengajukan penawaran produk sebagaimana terlampir.</div>
</div>

<!-- ════ KONDISI ════ -->
<div class="kondisi">
    <div>Dengan kondisi penawaran :</div>
    <ul>${kondisi.map(k => `<li>${k}</li>`).join('')}</ul>
</div>

<!-- ════ PENUTUP ════ -->
<div class="penutup">
    Demikian surat penawaran ini kami sampaikan. Atas perhatian dan kerjasamanya kami ucapkan terima kasih.
</div>

<!-- ════ TANDA TANGAN ════ -->
<div class="ttd-section">
    <div>${esc(companyAddress)}, ${tanggal}</div>
    <div>Hormat Kami,</div>
    <div>${esc(companyName)}</div>
    <br>
    ${ttdDataUrl ? `<img src="${ttdDataUrl}" class="ttd-img" alt="TTD">` : '<br><br><br>'}
    <div class="signer-name">${esc(signerName)}</div>
    <div>${esc(signerTitle)}</div>
</div>

<!-- ════ HALAMAN LAMPIRAN ════ -->
<div style="page-break-before:always;">

    <!-- Judul Lampiran -->
    <div style="font-family:Arial,sans-serif;font-size:11pt;font-weight:bold;margin-bottom:4px;">LAMPIRAN</div>
    <div style="font-family:'Times New Roman',Times,serif;font-size:11pt;margin-bottom:12px;">
        Surat No. ${esc(nomor || '___/___/___/____')}
    </div>

    <!-- Tabel Produk -->
    <table class="tbl">
        <thead>
            <tr>
                <th>No</th><th>Nama Produk</th><th>Pabrikan</th><th>Spesifikasi</th>
                <th>Qty</th><th>Satuan</th><th>Harga Satuan</th><th>Total</th><th>Info</th>
            </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
            <tr>
                <td colspan="8" style="text-align:right">GRAND TOTAL</td>
                <td style="text-align:right">Rp ${formatRupiah(grandTotal)}</td>
            </tr>
        </tfoot>
    </table>

</div>

</body>
</html>`;
}

// generateHeaderHTML — Puppeteer headerTemplate (setiap halaman)
function generateHeaderHTML(settings) {
    const companyName = settings.company_name || 'PT. Lapan Alpha Kirana';
    let logoDataUrl = toBase64(path.join(__dirname, 'public', 'img', 'logo.png'));
    if (!logoDataUrl) logoDataUrl = toBase64(path.join(__dirname, 'public', 'img', 'logo.jpg'));
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; width: 100%; -webkit-print-color-adjust: exact; }
        .header-wrap { padding: 0 20mm; width: 100%; }
        .logo-row { text-align: right; padding-top: 8mm; }
        .logo-row img { max-height: 20mm; max-width: 35mm; object-fit: contain; }
        .divider { margin-top: 2mm; border: none; border-top: 3px solid #1F4E79; border-bottom: 1px solid #1F4E79; height: 3px; }
    </style>
</head><body>
    <div class="header-wrap">
        <div class="logo-row">
            ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo">` : `<span style="font-weight:bold;color:#1F4E79">${esc(companyName)}</span>`}
        </div>
        <div class="divider"></div>
    </div>
</body></html>`;
}

// generateFooterHTML — Puppeteer footerTemplate (setiap halaman)
function generateFooterHTML(settings) {
    const companyName       = settings.company_name       || 'PT. Lapan Alpha Kirana';
    const companyHeadoffice = settings.company_headoffice || '';
    const companyWarehouse  = settings.company_warehouse  || '';
    if (!companyHeadoffice && !companyWarehouse) return '<html><body></body></html>';
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 7.5pt; color: #555; width: 100%; -webkit-print-color-adjust: exact; }
        .footer-wrap { padding: 0 20mm; width: 100%; border-top: 1.5px solid #1F4E79; padding-top: 2mm; text-align: center; line-height: 1.5; }
        .ft-name { font-weight: bold; color: #1F4E79; font-size: 8pt; }
    </style>
</head><body>
    <div class="footer-wrap">
        <span class="ft-name">${esc(companyName.toUpperCase())}</span>
        ${companyHeadoffice ? `<br>Head Office : ${esc(companyHeadoffice)}` : ''}
        ${companyWarehouse  ? `<br>Warehouse : ${esc(companyWarehouse)}`   : ''}
    </div>
</body></html>`;
}

// ── Halaman cetak browser (window.print) ──
// CSS ter-scope untuk kop & footer cetak (hanya selector .ph-* / .pf-*)
const PRINT_HF_CSS = `<style>
    .ph-wrap, .ph-wrap *, .pf-wrap, .pf-wrap * { box-sizing: border-box; margin: 0; padding: 0; }
    .ph-wrap { font-family: Arial, sans-serif; width: 100%; padding: 0 20mm; background: #fff; }
    .ph-logo-row { text-align: right; padding-top: 8mm; }
    .ph-logo-row img { max-height: 20mm; max-width: 35mm; object-fit: contain; }
    .ph-company { font-weight: bold; color: #1F4E79; }
    .ph-divider { margin-top: 2mm; border: none; border-top: 3px solid #1F4E79; border-bottom: 1px solid #1F4E79; height: 3px; }
    .pf-wrap { font-family: Arial, sans-serif; font-size: 7.5pt; color: #555; width: 100%; background: #fff; padding: 0 20mm 6mm; }
    .pf-inner { border-top: 1.5px solid #1F4E79; padding-top: 2mm; text-align: center; line-height: 1.5; }
    .pf-name { font-weight: bold; color: #1F4E79; font-size: 8pt; }
</style>`;

// generatePrintHeader — fragmen kop surat untuk halaman cetak browser
function generatePrintHeader(settings) {
    const companyName = settings.company_name || 'PT. Lapan Alpha Kirana';
    let logoDataUrl = toBase64(path.join(__dirname, 'public', 'img', 'logo.png'));
    if (!logoDataUrl) logoDataUrl = toBase64(path.join(__dirname, 'public', 'img', 'logo.jpg'));
    return `<div class="ph-wrap">
        <div class="ph-logo-row">
            ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo">` : `<span class="ph-company">${esc(companyName)}</span>`}
        </div>
        <div class="ph-divider"></div>
    </div>`;
}

// generatePrintFooter — fragmen footer untuk halaman cetak browser ('' jika alamat kosong)
function generatePrintFooter(settings) {
    const companyName       = settings.company_name       || 'PT. Lapan Alpha Kirana';
    const companyHeadoffice = settings.company_headoffice || '';
    const companyWarehouse  = settings.company_warehouse  || '';
    if (!companyHeadoffice && !companyWarehouse) return '';
    return `<div class="pf-wrap"><div class="pf-inner">
        <span class="pf-name">${esc(companyName.toUpperCase())}</span>
        ${companyHeadoffice ? `<br>Head Office : ${esc(companyHeadoffice)}` : ''}
        ${companyWarehouse  ? `<br>Warehouse : ${esc(companyWarehouse)}`   : ''}
    </div></div>`;
}

module.exports = { generateHTML, generateHeaderHTML, generateFooterHTML, generatePrintHeader, generatePrintFooter, PRINT_HF_CSS };
