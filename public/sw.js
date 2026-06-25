const CACHE_VERSION = 'v2';  // Bump → hapus cache lama, paksa ambil file baru
const SHELL_CACHE = 'dms-shell-' + CACHE_VERSION;
const API_CACHE   = 'dms-api-'   + CACHE_VERSION;

// Pre-cache HANYA icon — tidak berubah antar deploy
// HTML/JS/CSS JANGAN di-pre-cache agar selalu ambil versi terbaru dari server
const PRECACHE_ASSETS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== API_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Jangan intercept auth — biarkan session cookie berjalan normal
  if (url.pathname.startsWith('/api/auth')) return;

  // Hanya handle GET
  if (event.request.method !== 'GET') return;

  // API: network-first, fallback cache (untuk offline)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then(c => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // HTML / JS / CSS: NETWORK-FIRST
  // Selalu ambil versi terbaru dari server, simpan ke cache sebagai fallback offline
  const ext = url.pathname.split('.').pop().toLowerCase();
  const isAppFile = ['html', 'js', 'css'].includes(ext)
    || url.pathname === '/'
    || !url.pathname.includes('.');

  if (isAppFile) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(SHELL_CACHE).then(c => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Icon & aset lain (gambar, font): cache-first — jarang berubah
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});

// Terima pesan dari main thread untuk tampilkan notifikasi OS
self.addEventListener('message', event => {
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag } = event.data;
    self.registration.showNotification(title, {
      body: body || '',
      tag: tag || 'dms-notif',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      renotify: true,
    });
  }
});
