const express = require('express');
const router = express.Router();
const db = require('../database');
const { notifySPHCreated, notifySPHResult } = require('../notif');
const { generateDoc } = require('../docGenerator');
const { generateHTML, generateHeaderHTML, generateFooterHTML } = require('../htmlGenerator');
const os = require('os');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const upload = multer({
    dest: path.join(__dirname, '..', 'uploads'),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
          if (file.mimetype.startsWith('image/')) cb(null, true);
          else cb(new Error('Hanya file gambar yang diizinkan'), false);
    }
});

// Middleware: harus login
function requireLogin(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Belum login' });
    next();
}

// Middleware: harus admin
function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
          return res.status(403).json({ error: 'Akses ditolak' });
    }
    next();
}

// Middleware: admin atau kantor_pusat
function requireAdminOrKP(req, res, next) {
    const role = req.session.user?.role;
    if (role !== 'admin' && role !== 'kantor_pusat') {
          return res.status(403).json({ error: 'Akses ditolak' });
    }
    next();
}

function isAdminOrKP(user) {
    return user.role === 'admin' || user.role === 'kantor_pusat';
}

// Middleware: approve/reject SPH — admin, kantor_pusat, gm, gm2
function requireSPHApprover(req, res, next) {
    const role = req.session.user?.role;
    if (!['admin', 'kantor_pusat', 'gm', 'gm2'].includes(role)) {
        return res.status(403).json({ error: 'Akses ditolak' });
    }
    next();
}

// Generate nomor urut otomatis
function generateNomor() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'nomor_prefix'").get();
    const prefix = setting ? setting.value : 'PMH-LAK';
    const monthStr = `${year}-${month}`;
    const count = db.prepare(`
        SELECT COUNT(*) as cnt FROM submissions
            WHERE created_at LIKE ? AND nomor IS NOT NULL
              `).get(`${monthStr}%`);
    const seq = String((count.cnt || 0) + 1).padStart(3, '0');
    const romans = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
    const roman = romans[now.getMonth()];
    return `${seq}/${prefix}/${roman}/${year}`;
}

// GET /api/submissions - list pengajuan
router.get('/', requireLogin, (req, res) => {
    let rows;
    const user = req.session.user;
    if (isAdminOrKP(user)) {
          rows = db.prepare(`
                SELECT s.*, u.full_name as creator_name, a.full_name as approver_name
                      FROM submissions s
                            LEFT JOIN users u ON s.created_by = u.id
                                  LEFT JOIN users a ON s.approved_by = a.id
                                        ORDER BY s.created_at DESC
                                            `).all();
    } else if (user.role === 'gm' || user.role === 'gm2') {
          rows = db.prepare(`
                SELECT s.*, u.full_name as creator_name, a.full_name as approver_name
                      FROM submissions s
                            LEFT JOIN users u ON s.created_by = u.id
                                  LEFT JOIN users a ON s.approved_by = a.id
                                        WHERE (s.submission_type = 'sph' OR s.submission_type IS NULL)
                                              ORDER BY s.created_at DESC
                                                  `).all();
    } else if (user.role === 'area_manager') {
          const area = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(user.id)?.area_kerja || '';
          rows = db.prepare(`
                SELECT s.*, u.full_name as creator_name, a.full_name as approver_name
                      FROM submissions s
                            LEFT JOIN users u ON s.created_by = u.id
                                  LEFT JOIN users a ON s.approved_by = a.id
                                        WHERE (s.submission_type = 'sph' OR s.submission_type IS NULL)
                                          AND LOWER(TRIM(u.area_kerja)) = LOWER(TRIM(?))
                                              ORDER BY s.created_at DESC
                                                  `).all(area);
    } else {
          rows = db.prepare(`
                SELECT s.*, u.full_name as creator_name, a.full_name as approver_name
                      FROM submissions s
                            LEFT JOIN users u ON s.created_by = u.id
                                  LEFT JOIN users a ON s.approved_by = a.id
                                        WHERE s.created_by = ?
                                              ORDER BY s.created_at DESC
                                                  `).all(user.id);
    }
    rows = rows.map(r => ({ ...r, items: JSON.parse(r.items) }));
    res.json(rows);
});

// GET /api/submissions/dashboard-stats?month=YYYY-MM
router.get('/dashboard-stats', requireLogin, (req, res) => {
    const role = req.session.user.role;
    if (role !== 'admin' && role !== 'kantor_pusat' && role !== 'area_manager') {
        return res.status(403).json({ error: 'Akses ditolak' });
    }
    const month = req.query.month || null;
    try {
        const isAreaMgr = role === 'area_manager';
        const area = isAreaMgr
            ? (db.prepare('SELECT area_kerja FROM users WHERE id=?').get(req.session.user.id)?.area_kerja || '').trim().toLowerCase()
            : (req.query.area ? req.query.area.trim().toLowerCase() : null);

        const areaWhere = area ? ' AND LOWER(TRIM(u.area_kerja)) = ?' : '';

        let perUser;
        if (month) {
            const params = area ? [month, area] : [month];
            perUser = db.prepare(`
                SELECT u.id, u.full_name, u.username,
                    COUNT(s.id) as total,
                    SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END) as disetujui,
                    SUM(CASE WHEN s.status = 'rejected' THEN 1 ELSE 0 END) as ditolak,
                    SUM(CASE WHEN s.status = 'pending' THEN 1 ELSE 0 END) as menunggu,
                    COUNT(DISTINCT CASE WHEN s.id IS NOT NULL THEN s.client_name END) as jumlah_pelanggan
                FROM users u
                LEFT JOIN submissions s ON s.created_by = u.id
                    AND strftime('%Y-%m', s.created_at) = ?
                WHERE 1=1 ${areaWhere}
                GROUP BY u.id ORDER BY total DESC, u.full_name ASC
            `).all(...params);
        } else {
            const params = area ? [area] : [];
            perUser = db.prepare(`
                SELECT u.id, u.full_name, u.username,
                    COUNT(s.id) as total,
                    SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END) as disetujui,
                    SUM(CASE WHEN s.status = 'rejected' THEN 1 ELSE 0 END) as ditolak,
                    SUM(CASE WHEN s.status = 'pending' THEN 1 ELSE 0 END) as menunggu,
                    COUNT(DISTINCT s.client_name) as jumlah_pelanggan
                FROM users u
                LEFT JOIN submissions s ON s.created_by = u.id
                WHERE 1=1 ${areaWhere}
                GROUP BY u.id ORDER BY total DESC, u.full_name ASC
            `).all(...params);
        }

        const perUserWithProducts = perUser.map(user => {
            const subs = month
                ? db.prepare('SELECT items FROM submissions WHERE created_by = ? AND strftime("%Y-%m", created_at) = ?').all(user.id, month)
                : db.prepare('SELECT items FROM submissions WHERE created_by = ?').all(user.id);
            let jumlah_produk = 0;
            for (const s of subs) { try { jumlah_produk += JSON.parse(s.items).length; } catch {} }
            return { ...user, jumlah_produk };
        });

        let allSubs;
        if (area) {
            allSubs = month
                ? db.prepare(`SELECT s.items, s.status, s.client_name FROM submissions s JOIN users u ON u.id = s.created_by WHERE strftime('%Y-%m', s.created_at) = ? AND LOWER(TRIM(u.area_kerja)) = ?`).all(month, area)
                : db.prepare(`SELECT s.items, s.status, s.client_name FROM submissions s JOIN users u ON u.id = s.created_by WHERE LOWER(TRIM(u.area_kerja)) = ?`).all(area);
        } else {
            allSubs = month
                ? db.prepare('SELECT items, status, client_name FROM submissions WHERE strftime("%Y-%m", created_at) = ?').all(month)
                : db.prepare('SELECT items, status, client_name FROM submissions').all();
        }

        let totalProduk = 0;
        const pelangganSet = new Set();
        let disetujui = 0, ditolak = 0, menunggu = 0;
        for (const s of allSubs) {
            if (s.status === 'approved') disetujui++;
            else if (s.status === 'rejected') ditolak++;
            else menunggu++;
            if (s.client_name) pelangganSet.add(s.client_name);
            try { totalProduk += JSON.parse(s.items).length; } catch {}
        }

        const available_months = db.prepare(`
            SELECT DISTINCT strftime('%Y-%m', created_at) as month
            FROM submissions ORDER BY month DESC
        `).all().map(r => r.month);

        res.json({
            summary: { total: allSubs.length, disetujui, ditolak, menunggu, jumlah_produk: totalProduk, jumlah_pelanggan: pelangganSet.size },
            per_user: perUserWithProducts,
            available_months
        });
    } catch (err) {
        console.error('Dashboard stats error:', err);
        res.status(500).json({ error: 'Gagal memuat statistik' });
    }
});

// GET /api/submissions/bulk-pdf-zip?month=YYYY-MM
router.get('/bulk-pdf-zip', requireAdminOrKP, async (req, res) => {
    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: 'Parameter month diperlukan (format: YYYY-MM)' });
    }
    const rows = db.prepare(`
        SELECT s.*, u.full_name as creator_name
        FROM submissions s LEFT JOIN users u ON s.created_by = u.id
        WHERE s.status = 'approved' AND strftime('%Y-%m', s.created_at) = ?
        ORDER BY s.created_at ASC
    `).all(month);
    if (rows.length === 0) {
        return res.status(404).json({ error: 'Tidak ada SPH yang disetujui untuk bulan ' + month });
    }
    const settings = {};
    db.prepare('SELECT key, value FROM settings').all().forEach(s => { settings[s.key] = s.value; });
    const archiver = require('archiver');
    const puppeteer = require('puppeteer');
    const [yr, mo] = month.split('-');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="SPH_${yr}_${mo}.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => console.error('Archiver error:', err));
    archive.pipe(res);
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const headerHtml = generateHeaderHTML(settings);
        const footerHtml = generateFooterHTML(settings);
        const hasFooter = !!(settings.company_headoffice || settings.company_warehouse);
        for (const row of rows) {
            const submission = { ...row, items: JSON.parse(row.items) };
            const html = await generateHTML(submission, settings);
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });
            const pdfBuffer = await page.pdf({
                format: 'A4', printBackground: true, displayHeaderFooter: true,
                headerTemplate: headerHtml,
                footerTemplate: hasFooter ? footerHtml : '<span></span>',
                margin: { top: '38mm', bottom: hasFooter ? '28mm' : '15mm', left: '20mm', right: '20mm' }
            });
            await page.close();
            const safeNomor = row.nomor ? row.nomor.replace(/\//g, '-') : `ID${row.id}`;
            const safeName = row.client_name.replace(/[^a-zA-Z0-9]/g, '_');
            archive.append(Buffer.from(pdfBuffer), { name: `SPH_${safeNomor}_${safeName}.pdf` });
        }
        await browser.close(); browser = null;
        await archive.finalize();
    } catch (err) {
        if (browser) { try { await browser.close(); } catch {} }
        console.error('Bulk PDF ZIP error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Gagal membuat ZIP: ' + err.message });
    }
});

// GET /api/submissions/bulk-pdf-zip-all  — download semua SPH disetujui sebagai ZIP
router.get('/bulk-pdf-zip-all', requireLogin, async (req, res) => {
    const user = req.session.user;
    let rows;
    if (user.role === 'area_manager') {
        const area = db.prepare('SELECT area_kerja FROM users WHERE id=?').get(user.id)?.area_kerja || '';
        rows = db.prepare(`
            SELECT s.*, u.full_name as creator_name
            FROM submissions s LEFT JOIN users u ON s.created_by = u.id
            WHERE s.status = 'approved' AND (s.submission_type = 'sph' OR s.submission_type IS NULL)
              AND LOWER(TRIM(u.area_kerja)) = LOWER(TRIM(?))
            ORDER BY s.created_at ASC
        `).all(area);
    } else {
        rows = db.prepare(`
            SELECT s.*, u.full_name as creator_name
            FROM submissions s LEFT JOIN users u ON s.created_by = u.id
            WHERE s.status = 'approved' AND (s.submission_type = 'sph' OR s.submission_type IS NULL)
            ORDER BY s.created_at ASC
        `).all();
    }
    if (rows.length === 0) return res.status(404).json({ error: 'Belum ada SPH yang disetujui' });
    const settings = {};
    db.prepare('SELECT key, value FROM settings').all().forEach(s => { settings[s.key] = s.value; });
    const archiver = require('archiver');
    const puppeteer = require('puppeteer');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="Semua_SPH.zip"');
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => console.error('Archiver error:', err));
    archive.pipe(res);
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const headerHtml = generateHeaderHTML(settings);
        const footerHtml = generateFooterHTML(settings);
        const hasFooter = !!(settings.company_headoffice || settings.company_warehouse);
        for (const row of rows) {
            const submission = { ...row, items: JSON.parse(row.items) };
            const html = await generateHTML(submission, settings);
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });
            const pdfBuffer = await page.pdf({
                format: 'A4', printBackground: true, displayHeaderFooter: true,
                headerTemplate: headerHtml,
                footerTemplate: hasFooter ? footerHtml : '<span></span>',
                margin: { top: '38mm', bottom: hasFooter ? '28mm' : '15mm', left: '20mm', right: '20mm' }
            });
            await page.close();
            const safeNomor = row.nomor ? row.nomor.replace(/\//g, '-') : `ID${row.id}`;
            const safeName = row.client_name.replace(/[^a-zA-Z0-9]/g, '_');
            archive.append(Buffer.from(pdfBuffer), { name: `SPH_${safeNomor}_${safeName}.pdf` });
        }
        await browser.close(); browser = null;
        await archive.finalize();
    } catch (err) {
        if (browser) { try { await browser.close(); } catch {} }
        console.error('Bulk PDF ZIP error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Gagal membuat ZIP: ' + err.message });
    }
});

// GET /api/submissions/:id - detail
router.get('/:id', requireLogin, (req, res) => {
    const row = db.prepare(`
        SELECT s.*, u.full_name as creator_name, a.full_name as approver_name
            FROM submissions s
                LEFT JOIN users u ON s.created_by = u.id
                    LEFT JOIN users a ON s.approved_by = a.id
                        WHERE s.id = ?
                          `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
    const u = req.session.user;
    const canView = isAdminOrKP(u) || ['gm', 'gm2'].includes(u.role) || row.created_by === u.id;
    if (!canView) {
          return res.status(403).json({ error: 'Akses ditolak' });
    }
    res.json({ ...row, items: JSON.parse(row.items) });
});

// POST /api/submissions - buat pengajuan baru
router.post('/', requireLogin, (req, res) => {
    const { client_title, client_name, client_address, client_city, items, ppn_included, ongkir_included, notes, lampiran } = req.body;
    if (!client_name || !client_address || !items || !Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: 'Data tidak lengkap' });
    }
    for (const item of items) {
          if (!item.nama_produk || !item.qty || !item.harga_satuan) {
                  return res.status(400).json({ error: 'Data produk tidak lengkap (nama, qty, harga wajib diisi)' });
          }
    }
    const stmt = db.prepare(`
        INSERT INTO submissions (client_title, client_name, client_address, client_city, items, ppn_included, ongkir_included, notes, lampiran, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `);
    const result = stmt.run(
          client_title || 'Kepala Dinas',
          client_name, client_address,
          client_city || 'di Tempat',
          JSON.stringify(items),
          ppn_included ? 1 : 0,
          ongkir_included ? 1 : 0,
          notes || '',
          lampiran || '',
          req.session.user.id
        );
    const newId = result.lastInsertRowid;
    notifySPHCreated(newId);
    res.json({ success: true, id: newId });
});

// POST /api/submissions/:id/approve - admin / kantor_pusat / gm / gm2 approve
router.post('/:id/approve', requireSPHApprover, (req, res) => {
    const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'Pengajuan sudah diproses' });
    const nomor = generateNomor();
    const now = new Date().toISOString();
    db.prepare(`
        UPDATE submissions SET status = 'approved', nomor = ?, approved_by = ?, approved_at = ? WHERE id = ?
          `).run(nomor, req.session.user.id, now, req.params.id);
    notifySPHResult(req.params.id, row.created_by, 'approved');
    res.json({ success: true, nomor });
});

// POST /api/submissions/:id/reject - admin / kantor_pusat / gm / gm2 reject
router.post('/:id/reject', requireSPHApprover, (req, res) => {
    const { reason } = req.body;
    const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'Pengajuan sudah diproses' });
    db.prepare(`
        UPDATE submissions SET status = 'rejected', reject_reason = ? WHERE id = ?
          `).run(reason || 'Tidak ada keterangan', req.params.id);
    notifySPHResult(req.params.id, row.created_by, 'rejected');
    res.json({ success: true });
});

// GET /api/submissions/:id/download - download DOCX
router.get('/:id/download', requireLogin, async (req, res) => {
    const row = db.prepare(`
        SELECT s.*, u.full_name as creator_name
            FROM submissions s LEFT JOIN users u ON s.created_by = u.id
                WHERE s.id = ?
                  `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (!isAdminOrKP(req.session.user) && row.created_by !== req.session.user.id) {
          return res.status(403).json({ error: 'Akses ditolak' });
    }
    if (row.status !== 'approved') {
          return res.status(403).json({ error: 'Dokumen belum disetujui admin' });
    }
    try {
          const settings = {};
          db.prepare('SELECT key, value FROM settings').all().forEach(s => { settings[s.key] = s.value; });
          const submission = { ...row, items: JSON.parse(row.items) };
          const docBuffer = await generateDoc(submission, settings);
          const filename = `SPH_${row.nomor.replace(/\//g, '-')}_${row.client_name.replace(/[^a-zA-Z0-9]/g, '_')}.docx`;
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.send(docBuffer);
    } catch (err) {
          console.error('Error generating document:', err);
          res.status(500).json({ error: 'Gagal membuat dokumen: ' + err.message });
    }
});

// GET /api/submissions/:id/download/pdf - download PDF menggunakan Puppeteer
router.get('/:id/download/pdf', requireLogin, async (req, res) => {
    const row = db.prepare(`
        SELECT s.*, u.full_name as creator_name
            FROM submissions s LEFT JOIN users u ON s.created_by = u.id
                WHERE s.id = ?
                  `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (!isAdminOrKP(req.session.user) && row.created_by !== req.session.user.id)
          return res.status(403).json({ error: 'Akses ditolak' });
    if (row.status !== 'approved')
          return res.status(403).json({ error: 'Dokumen belum disetujui admin' });
    try {
          const settings = {};
          db.prepare('SELECT key, value FROM settings').all().forEach(s => { settings[s.key] = s.value; });
          const submission = { ...row, items: JSON.parse(row.items) };
          const html = await generateHTML(submission, settings);

      const puppeteer = require('puppeteer');
          const browser = await puppeteer.launch({
                  headless: 'new',
                  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)),
                  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
          });
          const page = await browser.newPage();
          await page.setContent(html, { waitUntil: 'networkidle0' });

          // Header & footer Puppeteer (muncul di setiap halaman)
          const headerHtml = generateHeaderHTML(settings);
          const footerHtml = generateFooterHTML(settings);
          const hasFooter  = !!(settings.company_headoffice || settings.company_warehouse);

          const pdfBuffer = await page.pdf({
                  format: 'A4',
                  printBackground: true,
                  displayHeaderFooter: true,
                  headerTemplate: headerHtml,
                  footerTemplate: hasFooter ? footerHtml : '<span></span>',
                  margin: {
                    top: '38mm',
                    bottom: hasFooter ? '28mm' : '15mm',
                    left: '20mm',
                    right: '20mm'
                  }
          });
          await browser.close()

      const filename = `SPH_${row.nomor.replace(/\//g,'-')}_${row.client_name.replace(/[^a-zA-Z0-9]/g,'_')}.pdf`;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.send(pdfBuffer);
    } catch (err) {
          console.error('Error generating PDF:', err);
          res.status(500).json({ error: 'Gagal membuat PDF: ' + err.message });
    }
});

// PUT /api/submissions/:id - edit pengajuan pending
router.put('/:id', requireLogin, (req, res) => {
    const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'Hanya pengajuan berstatus pending yang dapat diedit' });
    if (!isAdminOrKP(req.session.user) && row.created_by !== req.session.user.id) {
        return res.status(403).json({ error: 'Akses ditolak' });
    }
    const { client_title, client_name, client_address, client_city, items, ppn_included, ongkir_included, notes, lampiran } = req.body;
    if (!client_name || !client_address || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Data tidak lengkap' });
    }
    for (const item of items) {
        if (!item.nama_produk || !item.qty || !item.harga_satuan) {
            return res.status(400).json({ error: 'Data produk tidak lengkap (nama, qty, harga wajib diisi)' });
        }
    }
    db.prepare(`
        UPDATE submissions SET client_title=?, client_name=?, client_address=?, client_city=?,
            items=?, ppn_included=?, ongkir_included=?, notes=?, lampiran=? WHERE id=?
    `).run(
        client_title || 'Kepala Dinas',
        client_name, client_address,
        client_city || 'di Tempat',
        JSON.stringify(items),
        ppn_included ? 1 : 0,
        ongkir_included ? 1 : 0,
        notes || '',
        lampiran || '',
        req.params.id
    );
    res.json({ success: true });
});

// DELETE /api/submissions/:id (SPH only — KK dihapus via /api/kk/:id)
router.delete('/:id', requireLogin, (req, res) => {
    try {
        const row = db.prepare("SELECT * FROM submissions WHERE id = ? AND (submission_type = 'sph' OR submission_type IS NULL)").get(req.params.id);
        if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
        if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
        db.prepare('DELETE FROM submissions WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE submission error:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/submissions/meta/settings
router.get('/meta/settings', requireAdminOrKP, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
});

// PUT /api/submissions/meta/settings
router.put('/meta/settings', requireAdminOrKP, (req, res) => {
    const allowed = ['company_name','company_tagline','company_address','company_phone','company_email','company_headoffice','company_warehouse','signer_name','signer_title','nomor_prefix','kk_kota'];
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const key of allowed) {
          if (req.body[key] !== undefined) stmt.run(key, req.body[key]);
    }
    res.json({ success: true });
});

// POST /api/submissions/meta/upload/user-ttd/:userId
router.post('/meta/upload/user-ttd/:userId', requireAdminOrKP, upload.single('image'), async (req, res) => {
    const userId = parseInt(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'User ID tidak valid' });
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang diupload' });
    const targetPath = path.join(__dirname, '..', 'public', 'img', `ttd_u${userId}.png`);
    try {
        await sharp(req.file.path).png().toFile(targetPath);
        fs.unlink(req.file.path, () => {});
        res.json({ success: true, url: `/img/ttd_u${userId}.png?t=${Date.now()}` });
    } catch (err) {
        fs.unlink(req.file.path, () => {});
        res.status(500).json({ error: 'Gagal memproses gambar: ' + err.message });
    }
});

// POST /api/submissions/meta/upload/my-ttd (any logged-in user uploads own TTD)
// MUST be registered before /meta/upload/:type to avoid being caught by the wildcard
const ttdUploadSelf = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.post('/meta/upload/my-ttd', requireLogin, ttdUploadSelf.single('ttd'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const filename = `ttd_u${req.session.user.id}.png`;
        const outputPath = path.join(__dirname, '..', 'public', 'img', filename);
        await sharp(req.file.buffer)
          .resize(300, 150, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
          .png()
          .toFile(outputPath);
        res.json({ success: true, filename, url: `/img/${filename}?t=${Date.now()}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Upload gagal' });
    }
});

// POST /api/submissions/meta/upload/:type
router.post('/meta/upload/:type', requireAdminOrKP, upload.single('image'), async (req, res) => {
    const type = req.params.type;
    if (!['logo', 'ttd'].includes(type)) {
          return res.status(400).json({ error: 'Tipe tidak valid. Gunakan "logo" atau "ttd"' });
    }
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang diupload' });
    const targetPath = path.join(__dirname, '..', 'public', 'img', `${type}.png`);
    try {
          await sharp(req.file.path).png().toFile(targetPath);
          fs.unlink(req.file.path, () => {});
          res.json({ success: true, url: `/img/${type}.png?t=${Date.now()}` });
    } catch (err) {
          fs.unlink(req.file.path, () => {});
          res.status(500).json({ error: 'Gagal memproses gambar: ' + err.message });
    }
});

// GET /api/submissions/meta/users
router.get('/meta/users', requireAdminOrKP, (req, res) => {
    const rows = db.prepare('SELECT id, username, full_name, role, area_kerja, jabatan_detail, created_at FROM users ORDER BY role, full_name').all();
    res.json(rows);
});

// POST /api/submissions/meta/users
router.post('/meta/users', requireAdminOrKP, (req, res) => {
    const { username, password, full_name, role, area_kerja, jabatan_detail } = req.body;
    if (!username || !password || !full_name || !role) {
          return res.status(400).json({ error: 'Semua field wajib diisi' });
    }
    try {
          const result = db.prepare('INSERT INTO users (username, password, full_name, role, area_kerja, jabatan_detail) VALUES (?, ?, ?, ?, ?, ?)')
            .run(username, password, full_name, role, area_kerja || '', jabatan_detail || '');
          res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) {
          res.status(400).json({ error: 'Username sudah digunakan' });
    }
});

// PUT /api/submissions/meta/users/:id (edit user data)
router.put('/meta/users/:id', requireAdminOrKP, (req, res) => {
    const { full_name, role, area_kerja, jabatan_detail } = req.body;
    if (!full_name || !role) {
        return res.status(400).json({ error: 'Nama dan role wajib diisi' });
    }
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    db.prepare('UPDATE users SET full_name=?, role=?, area_kerja=?, jabatan_detail=? WHERE id=?')
      .run(full_name, role, area_kerja || '', jabatan_detail || '', req.params.id);
    res.json({ success: true });
});

// PUT /api/submissions/meta/users/:id/password  (admin reset password user)
router.put('/meta/users/:id/password', requireAdminOrKP, (req, res) => {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
        return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(new_password, req.params.id);
    res.json({ success: true });
});

// DELETE /api/submissions/meta/users/:id
router.delete('/meta/users/:id', requireAdminOrKP, (req, res) => {
    if (req.params.id == req.session.user.id) {
          return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

module.exports = router;
