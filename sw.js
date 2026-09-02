// CareBridge Mumbai — Service Worker v1.7
// Bump CACHE whenever index.html/admin.html/join.html/manifest.json changes
// so returning visitors/coordinators get the fresh version, not a stale cache.
const CACHE = 'carebridge-v8';
const OFFLINE_URL = '/index.html';

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Let Appwrite & WhatsApp requests pass through
  const url = event.request.url;
  if (url.includes('appwrite.io') || url.includes('wa.me') || url.includes('googleapis.com') || url.includes('jsdelivr')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(OFFLINE_URL));
    })
  );
});
