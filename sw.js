/* Tatame · service worker (offline) */
const CACHE = 'tatame-v12';
const SHELL = [
  './',
  './index.html',
  './styles.css?v=2.6.6',
  './adaptive.css?v=2.6.6',
  './app.js?v=2.6.6',
  './data.js?v=2.6.6',
  './fonts/fonts.css?v=2.6.6',
  './fonts/inter-tight-0.woff2',
  './fonts/jbmono-0.woff2',
  './fonts/instrument-serif-0.woff2',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  // navegação: sempre rede primeiro (sem cache HTTP), cache como fallback offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // assets: stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req, { cache: 'no-store' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
