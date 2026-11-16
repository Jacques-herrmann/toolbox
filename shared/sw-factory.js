// Service worker générique : réseau d'abord, cache en secours (hors-ligne).
// Utilisation dans un sw.js :  importScripts('../shared/sw-factory.js'); toolboxSW('nom-v1', [...fichiers]);
self.toolboxSW = function (cacheName, files) {
  self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(cacheName).then((c) => c.addAll(files)));
    self.skipWaiting();
  });
  self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith(cacheName.split('-v')[0] + '-v') && k !== cacheName).map((k) => caches.delete(k))
    )));
    self.clients.claim();
  });
  self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const sameOrigin = new URL(req.url).origin === location.origin;
    const isCdn = /cdn\.jsdelivr\.net/.test(req.url);
    if (!sameOrigin && !isCdn) return;
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(cacheName).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./')))
    );
  });
};
