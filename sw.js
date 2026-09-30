// Service Worker — Indeling Radiologen
// Cache-naam bevat versienummer. Bij een nieuwe versie worden oude caches
// automatisch verwijderd en alle bestanden opnieuw gecached.

const VERSION = '3.33.13';
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
  './app/dialoog.js',
  './app/logboek.js',
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
  './app/views/logboek.js',
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
// v3.30.0 (M3): optionele vendor-bestanden (lokale kopieën van SheetJS en
// ExcelJS). Als ze in de repo staan worden ze gecached (import/export werkt
// dan volledig offline); ontbreken ze, dan mag de install NIET falen.
const PRECACHE_OPTIONEEL = [
  './vendor/xlsx.full.min.js',
  './vendor/exceljs.min.js',
];

// v3.33.4: de Firebase-SDK zelf. Die komt van www.gstatic.com en zat daardoor
// NIET in deze voorraad — offline leende de app hem uit de tijdelijke cache van
// de browser. Safari op iOS ruimt die cache op, en dan kwam index.html wél uit
// onze voorraad maar kon app/main.js zijn imports niet laden: de app bleef op
// het laadsymbool hangen (nagemeten en gereproduceerd, 29 september 2026).
// Cachen mag: gstatic stuurt 'access-control-allow-origin: *' en het
// versienummer staat in het adres, dus deze bestanden verouderen nooit.
// Ontbreken ze bij de install, dan mag die NIET falen — dan werkt de app
// online precies als voorheen.
const SDK_BASIS = 'https://www.gstatic.com/firebasejs/10.12.0/';
const PRECACHE_SDK = [
  'firebase-app.js',
  'firebase-auth.js',
  'firebase-firestore.js',
  'firebase-functions.js',
].map(naam => SDK_BASIS + naam);

// gstatic stuurt 'vary: Accept-Encoding'. Zonder ignoreVary kan het opzoeken
// mislukken terwijl het bestand er wél staat (de import-aanvraag van de browser
// draagt niet dezelfde koppen als de aanvraag waarmee we hem opsloegen).
const MATCH = { ignoreVary: true };

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(
        PRECACHE.map(url => new Request(url, { cache: 'reload' }))
      ).then(() => Promise.all(
        PRECACHE_OPTIONEEL.map(url =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
        )
      )).then(() => Promise.all(
        PRECACHE_SDK.map(url =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
        )
      )))
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

  const url = new URL(event.request.url);

  // v3.33.4: de vier Firebase-SDK-bestanden komen eerst uit onze eigen
  // voorraad, zodat de app ook zonder netwerk kan opstarten. ALLEEN deze vier
  // adressen. Al het andere verkeer naar Google — Firestore, Auth en Functions
  // op *.googleapis.com en *.cloudfunctions.net — moet rechtstreeks blijven
  // gaan; daar mag deze service worker niet tussen gaan zitten, anders breekt
  // de realtime verbinding met de databank.
  if (PRECACHE_SDK.includes(url.href)) {
    event.respondWith(
      caches.match(event.request, MATCH).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.ok) {
            const toCache = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, toCache));
          }
          return response;
        });
      })
    );
    return;
  }

  // CDN en overige externe URLs altijd via netwerk
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
