// printWrapper.js — bungkus dokumen HTML lama menjadi halaman cetak browser (window.print)
// Kop & footer memakai position:fixed (berulang di setiap halaman saat dicetak di Chrome/Edge),
// sedangkan spacer di <thead>/<tfoot> tabel bingkai berulang di setiap halaman agar konten
// tidak tertimpa kop/footer.
const { PRINT_HF_CSS } = require('./htmlGenerator');

function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildPrintCss({ orientation, topSpace, bottomSpace, sidePad }) {
    return `<style>
    @page { size: A4 ${orientation}; margin: 0; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .print-frame { width: 100%; border-collapse: collapse; }
    .print-frame > thead > tr > td, .print-frame > tfoot > tr > td, .print-frame > tbody > tr > td.print-content { padding: 0 ${sidePad}; border: none; vertical-align: top; }
    .print-space-top { height: ${topSpace}; }
    .print-space-bottom { height: ${bottomSpace}; }
    tr, img, .ttd-img { page-break-inside: avoid; }
    @media screen {
        body { background: #e5e7eb; margin: 0; }
        .print-toolbar { position: sticky; top: 0; z-index: 10; background: #1F4E79; color: #fff; padding: 8px 16px;
                         display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-family: Arial, sans-serif; font-size: 13px; }
        .print-toolbar button { padding: 6px 14px; cursor: pointer; font-family: Arial, sans-serif; font-size: 13px; }
        .print-sheet { position: relative; background: #fff; margin: 16px auto; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
        .print-portrait { width: 210mm; min-height: 297mm; }
        .print-landscape { width: 297mm; min-height: 210mm; }
        .print-header { position: absolute; top: 0; left: 0; right: 0; }
        .print-footer { position: absolute; bottom: 0; left: 0; right: 0; }
    }
    @media print {
        body { background: #fff; margin: 0; }
        .print-toolbar { display: none !important; }
        .print-sheet { width: auto; min-height: 0; margin: 0; box-shadow: none; }
        .print-header { position: fixed; top: 0; left: 0; right: 0; }
        .print-footer { position: fixed; bottom: 0; left: 0; right: 0; }
    }
</style>`;
}

function buildPrintPage({ docHtml, title, orientation = 'portrait', headerHtml = '', footerHtml = '', topSpace = '10mm', bottomSpace = '10mm', sidePad = '8mm' }) {
    const html = String(docHtml || '');
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const headInner = headMatch
        ? headMatch[1].replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '').replace(/<meta[^>]*charset[^>]*>/gi, '')
        : '';
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyInner = bodyMatch ? bodyMatch[1] : html;

    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${headInner}
${PRINT_HF_CSS}
${buildPrintCss({ orientation, topSpace, bottomSpace, sidePad })}
</head>
<body>
<div class="print-toolbar">
    <button type="button" onclick="window.print()">🖨️ Cetak / Simpan PDF</button>
    <button type="button" onclick="window.close()">Tutup</button>
    <span>Di jendela cetak pilih Tujuan: <b>Simpan sebagai PDF</b>. Jika warna tidak muncul, aktifkan "Grafis latar belakang".</span>
</div>
<div class="print-sheet print-${orientation}">
    ${headerHtml ? `<div class="print-header">${headerHtml}</div>` : ''}
    ${footerHtml ? `<div class="print-footer">${footerHtml}</div>` : ''}
    <table class="print-frame">
        <thead><tr><td><div class="print-space-top"></div></td></tr></thead>
        <tfoot><tr><td><div class="print-space-bottom"></div></td></tr></tfoot>
        <tbody><tr><td class="print-content">${bodyInner}</td></tr></tbody>
    </table>
</div>
</body>
</html>`;
}

function sendPrintError(res, status, message) {
    res.set('Cache-Control', 'no-store');
    return res.status(status).type('html').send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tidak dapat mencetak dokumen</title>
<style>
    body { font-family: Arial, sans-serif; background: #f3f4f6; margin: 0; padding: 40px 16px; color: #111827; }
    .box { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,.1); text-align: center; }
    h1 { font-size: 18px; color: #b91c1c; margin: 0 0 12px; }
    p { font-size: 14px; margin: 0 0 20px; }
    button { padding: 8px 18px; cursor: pointer; }
</style>
</head>
<body>
<div class="box">
    <h1>Tidak dapat mencetak dokumen</h1>
    <p>${esc(message)}</p>
    <button type="button" onclick="window.close()">Tutup</button>
</div>
</body>
</html>`);
}

module.exports = { buildPrintPage, sendPrintError, esc };
