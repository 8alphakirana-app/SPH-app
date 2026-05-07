const express = require('express');
const router = express.Router();
const db = require('../database');
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
    if (req.session.user.role === 'admin') {
          rows = db.prepare(`
                SELECT s.*, u.full_name as creator_name, a.full_name as approver_name
                      FROM submissions s
                            LEFT JOIN users u ON s.created_by = u.id
                                  LEFT JOIN users a ON s.approved_by = a.id
                                        ORDER BY s.created_at DESC
                                            `).all();
    } else {
          rows = db.prepare(`
                SELECT s.*, u.full_name as creator_name, a.full_name as approver_name
                      FROM submissions s
                            LEFT JOIN users u ON s.created_by = u.id
                                  LEFT JOIN users a ON s.approved_by = a.id
                                        WHERE s.created_by = ?
                                              ORDER BY s.created_at DESC
                                                  `).all(req.session.user.id);
    }
    rows = rows.map(r => ({ ...r, items: JSON.parse(r.items) }));
    res.json(rows);
});

// GET /api/submissions/dashboard-stats?month=YYYY-MM  (admin only)
router.get('/dashboard-stats', requireAdmin, (req, res) => {
    const month = req.query.month || null;
    try {
        let perUser;
        if (month) {
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
                GROUP BY u.id ORDER BY total DESC, u.full_name ASC
            `).all(month);
        } else {
            perUser = db.prepare(`
                SELECT u.id, u.full_name, u.username,
                    COUNT(s.id) as total,
                    SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END) as disetujui,
                    SUM(CASE WHEN s.status = 'rejected' THEN 1 ELSE 0 END) as ditolak,
                    SUM(CASE WHEN s.status = 'pending' THEN 1 ELSE 0 END) as menunggu,
                    COUNT(DISTINCT s.client_name) as jumlah_pelanggan
                FROM users u
                LEFT JOIN submissions s ON s.created_by = u.id
                GROUP BY u.id ORDER BY total DESC, u.full_name ASC
            `).all();
        }

        const perUserWithProducts = perUser.map(user => {
            const subs = month
                ? db.prepare('SELECT items FROM submissions WHERE created_by = ? AND strftime("%Y-%m", created_at) = ?').all(user.id, month)
                : db.prepare('SELECT items FROM submissions WHERE created_by = ?').all(user.id);
            let jumlah_produk = 0;
            for (const s of subs) { try { jumlah_produk += JSON.parse(s.items).length; } catch {} }
            return { ...user, jumlah_produk };
        });

        const allSubs = month
            ? db.prepare('SELECT items, status, client_name FROM submissions WHERE strftime("%Y-%m", created_at) = ?').all(month)
            : db.prepare('SELECT items, status, client_name FROM submissions').all();

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

// GET /api/submissions/bulk-pdf-zip?month=YYYY-MM  (admin only)
router.get('/bulk-pdf-zip', requireAdmin, async (req, res) => {
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
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
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
    if (req.session.user.role !== 'admin' && row.created_by !== req.session.user.id) {
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
    res.json({ success: true, id: result.lastInsertRowid });
});

// POST /api/submissions/:id/approve - admin approve
router.post('/:id/approve', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'Pengajuan sudah diproses' });
    const nomor = generateNomor();
    const now = new Date().toISOString();
    db.prepare(`
        UPDATE submissions SET status = 'approved', nomor = ?, approved_by = ?, approved_at = ? WHERE id = ?
          `).run(nomor, req.session.user.id, now, req.params.id);
    res.json({ success: true, nomor });
});

// POST /api/submissions/:id/reject - admin reject
router.post('/:id/reject', requireAdmin, (req, res) => {
    const { reason } = req.body;
    const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'Pengajuan sudah diproses' });
    db.prepare(`
        UPDATE submissions SET status = 'rejected', reject_reason = ? WHERE id = ?
          `).run(reason || 'Tidak ada keterangan', req.params.id);
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
    if (req.session.user.role !== 'admin' && row.created_by !== req.session.user.id) {
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
    if (req.session.user.role !== 'admin' && row.created_by !== req.session.user.id)
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
                  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
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
    if (req.session.user.role !== 'admin' && row.created_by !== req.session.user.id) {
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

// DELETE /api/submissions/:id - hapus pengajuan pending
router.delete('/:id', requireLogin, (req, res) => {
    const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'Hanya pengajuan berstatus pending yang dapat dihapus' });
    if (req.session.user.role !== 'admin' && row.created_by !== req.session.user.id) {
        return res.status(403).json({ error: 'Akses ditolak' });
    }
    db.prepare('DELETE FROM submissions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// GET /api/submissions/meta/settings
router.get('/meta/settings', requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
});

// PUT /api/submissions/meta/settings
router.put('/meta/settings', requireAdmin, (req, res) => {
    const allowed = ['company_name','company_tagline','company_address','company_phone','company_email','company_headoffice','company_warehouse','signer_name','signer_title','nomor_prefix'];
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const key of allowed) {
          if (req.body[key] !== undefined) stmt.run(key, req.body[key]);
    }
    res.json({ success: true });
});

// POST /api/submissions/meta/upload/:type
router.post('/meta/upload/:type', requireAdmin, upload.single('image'), async (req, res) => {
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
router.get('/meta/users', requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT id, username, full_name, role, created_at FROM users ORDER BY role, full_name').all();
    res.json(rows);
});

// POST /api/submissions/meta/users
router.post('/meta/users', requireAdmin, (req, res) => {
    const { username, password, full_name, role } = req.body;
    if (!username || !password || !full_name || !role) {
          return res.status(400).json({ error: 'Semua field wajib diisi' });
    }
    try {
          const result = db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run(username, password, full_name, role);
          res.json({ success: true, id: result.lastInsertRowid })
    } catch (e) {
          res.status(400).json({ error: 'Username sudah digunakan' });
    }
});

// DELETE /api/submissions/meta/users/:id
router.delete('/meta/users/:id', requireAdmin, (req, res) => {
    if (req.params.id == req.session.user.id) {
          return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

module.exports = router;
