const CACHE = 'bioinfogpt-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/utils.js',
  './js/bio.js',
  './js/api.js',
  './js/app.js',
  './vendor/marked.min.js',
  './vendor/purify.min.js',
  './vendor/highlight.min.js',
  './vendor/github-dark.min.css',
  './favicon.svg',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Only cache same-origin GET
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Don't cache API calls
  if (url.pathname.includes('/chat') || url.pathname.includes('/models')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c=>c.put(e.request, clone));
        }
        return res;
      }).catch(()=>cached);
      return cached || fetchPromise;
    })
  );
});
