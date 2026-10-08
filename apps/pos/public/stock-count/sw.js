// Service worker for the stock-count PWA, scoped to /stock-count/.
//
// Its entire job is the shell. It deliberately does NOT cache or queue the API: a stock count is an
// authoritative business fact, and a scan replayed from a cache after the fact is a count nobody
// reviewed. If the network is gone, this app must fail visibly rather than quietly accumulate work
// that lands later.
//
// Scoped to its own directory on purpose. The POS shell already registers a service worker at the
// origin root, and a count device is often the same device as the till — two overlapping scopes
// fighting over navigations would be its own class of bug.
const CACHE = 'toko360-stock-count-v1';
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  // A missing shell entry must not fail the whole install: the app still works online without a cache.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The API is never served from, or written to, this cache. Not on a cache hit, not on a miss, not
  // "just in case". A stock count is authoritative; a stale read of it is a wrong answer presented
  // confidently, and a queued mutation is worse than no answer.
  if (url.pathname.startsWith('/api/')) return;
  if (request.headers.get('accept')?.includes('application/json')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.mode === 'navigate') {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) || (await caches.match('./index.html')) || Response.error()),
  );
});
