// Primero la red para los archivos propios (así nunca queda una versión vieja);
// la caché solo sirve para abrir la app sin internet.
const CACHE = 'cuentas-claras-v1';
const ARCHIVOS = ['./', 'index.html', 'app.css', 'app.js', 'manifest.json', 'icono.svg', 'icono-192.png', 'icono-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copia = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copia));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
