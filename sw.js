const CACHE = 'bioinfogpt-v4-clean-redesign';
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
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{}))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
      .then(()=>{
        // Force reload all clients to get fresh UI after redesign
        return self.clients.matchAll({type:'window'}).then(clients=>{
          clients.forEach(client=>{
            client.postMessage({type:'SW_UPDATED', version:CACHE});
          });
        });
      })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/chat') || url.pathname.includes('/models') || url.pathname.includes('/api/')) return;

  // Network-first for HTML to ensure user always sees latest redesign
  const isHTML = e.request.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/');
  if (isHTML) {
    e.respondWith(
      fetch(e.request).then(res=>{
        if (res.ok) {
          const clone=res.clone();
          caches.open(CACHE).then(c=>c.put(e.request, clone));
        }
        return res;
      }).catch(()=>caches.match(e.request))
    );
    return;
  }

  // Cache-first for assets (CSS/JS) but update in background
  e.respondWith(
    caches.match(e.request).then(cached=>{
      const fetchPromise = fetch(e.request).then(res=>{
        if (res.ok) {
          const clone=res.clone();
          caches.open(CACHE).then(c=>c.put(e.request, clone));
        }
        return res;
      }).catch(()=>cached);
      return cached || fetchPromise;
    })
  );
});

self.addEventListener('message', e=>{
  if (e.data && e.data.type==='SKIP_WAITING') self.skipWaiting();
});
