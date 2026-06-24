const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT !== undefined;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Trust proxy (Railway / reverse proxy)
app.set('trust proxy', 1);

// Session
app.use(session({
    secret: 'sph-app-secret-2024-lapan-alpha-kirana',
    resave: false,
    saveUninitialized: false,
    cookie: {
          secure: isProd,
          sameSite: isProd ? 'none' : 'lax',
          maxAge: 8 * 60 * 60 * 1000 // 8 jam
    }
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/submissions', require('./routes/submissions'));
app.use('/api/kk', require('./routes/kk'));
app.use('/api/sppd', require('./routes/sppd'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/laporan', require('./routes/laporan'));
app.use('/api/sales-target', require('./routes/sales-target'));

// SPA fallback - semua route ke index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Aplikasi SPH berjalan di http://localhost:${PORT}`);
    console.log(`\n📋 Akun default:`);
    console.log(`   Admin : admin / admin123`);
    console.log(`   Staff : staff1 / staff123`);
    console.log(`\nGunakan Ctrl+C untuk menghentikan server\n`);
});
