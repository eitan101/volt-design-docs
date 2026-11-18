/* Auto-generated Offline-First Service Worker (volt-docs-v1-400e863b1a) */
'use strict';

const CACHE_NAME = "volt-docs-v1-400e863b1a";
const PRECACHE_URLS = [
  "./",
  "./app.js",
  "./docs-data.js",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512-maskable.png",
  "./icons/icon-512.png",
  "./index.html",
  "./manifest.webmanifest",
  "./styles.css",
  "./vendor/fonts/KaTeX_AMS-Regular.woff2",
  "./vendor/fonts/KaTeX_Caligraphic-Bold.woff2",
  "./vendor/fonts/KaTeX_Caligraphic-Regular.woff2",
  "./vendor/fonts/KaTeX_Fraktur-Bold.woff2",
  "./vendor/fonts/KaTeX_Fraktur-Regular.woff2",
  "./vendor/fonts/KaTeX_Main-Bold.woff2",
  "./vendor/fonts/KaTeX_Main-BoldItalic.woff2",
  "./vendor/fonts/KaTeX_Main-Italic.woff2",
  "./vendor/fonts/KaTeX_Main-Regular.woff2",
  "./vendor/fonts/KaTeX_Math-BoldItalic.woff2",
  "./vendor/fonts/KaTeX_Math-Italic.woff2",
  "./vendor/fonts/KaTeX_SansSerif-Bold.woff2",
  "./vendor/fonts/KaTeX_SansSerif-Italic.woff2",
  "./vendor/fonts/KaTeX_SansSerif-Regular.woff2",
  "./vendor/fonts/KaTeX_Script-Regular.woff2",
  "./vendor/fonts/KaTeX_Size1-Regular.woff2",
  "./vendor/fonts/KaTeX_Size2-Regular.woff2",
  "./vendor/fonts/KaTeX_Size3-Regular.woff2",
  "./vendor/fonts/KaTeX_Size4-Regular.woff2",
  "./vendor/fonts/KaTeX_Typewriter-Regular.woff2",
  "./vendor/katex.min.css",
  "./vendor/mermaid.min.js"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('volt-docs-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
      const allClients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of allClients) {
        client.postMessage({ type: 'SW_OFFLINE_READY', cacheName: CACHE_NAME });
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CHECK_OFFLINE_STATUS') {
    caches.has(CACHE_NAME).then((ready) => {
      if (event.source) {
        event.source.postMessage({ type: 'SW_OFFLINE_STATUS', ready, cacheName: CACHE_NAME });
      }
    });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation requests (opening the installed PWA or refreshing offline) always resolve from cache first
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedIndex = (await cache.match('./index.html')) || (await cache.match('./'));
        if (cachedIndex) {
          // Refresh index in background when online
          fetch(req)
            .then((res) => {
              if (res && res.ok) cache.put('./index.html', res.clone());
            })
            .catch(() => {});
          return cachedIndex;
        }
        return fetch(req);
      })()
    );
    return;
  }

  // Static assets: Cache-First for instant offline response, background revalidate when online
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) {
        return cached;
      }
      try {
        const networkRes = await fetch(req);
        if (networkRes && networkRes.ok) {
          cache.put(req, networkRes.clone());
        }
        return networkRes;
      } catch (err) {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
        throw err;
      }
    })()
  );
});
