// Service Worker — Indeling Radiologen
// Cache-naam bevat versienummer. Bij een nieuwe versie worden oude caches
// automatisch verwijderd en alle bestanden opnieuw gecached.

const VERSION = '3.27.122';
const CACHE = `rooster-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './config.js',
  './manifest.json',
  './app/main.js',
  './app/firebase-init.js',
  './app/helpers.js',
  './app/state.js',
  './app/sheets.js',
  './app/save.js',
  './app/import.js',
  './app/export.js',
  './app/backup-client.js',
  './app/validatie.js',
  './app/bezetting-mutaties.js',
  './app/views/radioloog.js',
  './app/views/jaaroverzicht.js',
  './app/views/afdeling.js',
  './app/views/dienst.js',
  './app/views/activiteit.js',
  './app/views/wensen.js',
  './app/views/vakantie.js',
  './app/views/overzicht.js',
  './app/views/regels.js',
  './app/views/gebruikers.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-maskable-512.png',
  './help/gebruiker.html',
  './help/beheerder.html',
];

// Install: precache alle app-bestanden. cache:'reload' dwingt af dat elk
// bestand rechtstreeks van de server komt en nooit uit de HTTP-cache van de
// browser — anders kan een nieuwe SW-versie stiekem oude bestanden precachen
// (komt vooral op iOS/Safari voor, waar die cache lang blijft hangen).
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(
        PRECACHE.map(url => new Request(url, { cache: 'reload' }))
      ))
      .then(() => self.skipWaiting())
  );
});

// Activate: verwijder alle oude caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first voor eigen bestanden, netwerk voor de rest
self.addEventListener('fetch', event => {
  // Alleen GET requests cachen
  if (event.request.method !== 'GET') return;

  // Firebase, CDN en externe URLs altijd via netwerk
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Alleen geldige responses cachen
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, toCache));
        return response;
      });
    })
  );
});

// Luister naar berichten van de app (bijv. skipWaiting aanroep)
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
