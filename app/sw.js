/* Halves service worker: precaches the app shell so the app opens offline.
   - index.html (navigations): network-first, cached copy when offline.
   - other shell files: stale-while-revalidate (bump VERSION on deploys so all files switch together).
   - /api/* is NEVER cached or intercepted. WebSockets never pass through here. */
const VERSION = 'halves-shell-v1';
const FONTS = 'halves-fonts-v1';
const SHELL = [
  './', 'sync.js', 'manifest.webmanifest',
  'skins/art.css', 'skins/art.js', 'skins/ink.css', 'skins/ink.js',
  'skins/neon.css', 'skins/neon.js', 'skins/poster.css', 'skins/poster.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))
    .then(() => c.add(new Request('join/', {cache: 'reload'})).catch(() => {}))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== FONTS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const scopePath = new URL(self.registration.scope).pathname;
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith(scopePath + 'api/') || url.pathname.startsWith('/api/')) return; // never touch the API
    if (req.mode === 'navigate' || url.pathname === scopePath || url.pathname.endsWith('/index.html')) {
      e.respondWith(fetch(req).then(r => {
        if (r.ok && r.type === 'basic') { const cp = r.clone(); caches.open(VERSION).then(c => c.put(url.pathname.startsWith(scopePath + 'join') ? 'join/' : './', cp)); }
        return r;
      }).catch(() => caches.match(url.pathname.startsWith(scopePath + 'join') ? 'join/' : './')));
      return;
    }
    // stale-while-revalidate: instant from cache, refreshed in the background for the next launch
    e.respondWith(caches.open(VERSION).then(c => c.match(req, {ignoreSearch: true}).then(hit => {
      const net = fetch(req).then(r => { if (r.ok && r.type === 'basic') c.put(req, r.clone()); return r; });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    })));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })));
  }
});
