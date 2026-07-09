// ============================================================================
// Firebase configuratie + automatische omgeving-detectie
// ============================================================================
// ÉÉN config.js voor zowel productie als test. De omgeving wordt automatisch
// uit de URL bepaald, zodat je bij het uploaden NOOIT meer iets handmatig hoeft
// om te zetten — je gebruikt in beide repos exact dezelfde bestanden.
//
//   .../Rooster-test/...  -> TEST,      schrijft naar de 'test'-database
//   .../Rooster/...       -> PRODUCTIE, schrijft naar de (default)-database
//   iets anders / onbekend -> de app BLOKKEERT zichzelf (fail-safe), zodat er
//                             nooit per ongeluk naar de verkeerde database
//                             geschreven kan worden.
// ============================================================================
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCIp8T0-BNPlh3j9X2QbXkQsaq7F91xoOA",
  authDomain: "rooster-radiologie.firebaseapp.com",
  projectId: "rooster-radiologie",
  storageBucket: "rooster-radiologie.firebasestorage.app",
  messagingSenderId: "798466630775",
  appId: "1:798466630775:web:65252d0d0a606ab9141272"
};

// Basis-versienummer (cache-busting). In test krijgt het label '-TEST' erbij.
window.APP_VERSIE_BASIS = "3.27.118";

(function bepaalOmgeving() {
  var pad = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
  var isTest = /\/Rooster-test(\/|$)/i.test(pad);
  var isProd = !isTest && /\/Rooster(\/|$)/i.test(pad);

  if (isTest) {
    window.APP_ENV     = 'test';
    window.FIRESTORE_DB = 'test';
    window.APP_VERSIE   = window.APP_VERSIE_BASIS + '-TEST';
  } else if (isProd) {
    window.APP_ENV     = 'prod';
    window.FIRESTORE_DB = '(default)';
    window.APP_VERSIE   = window.APP_VERSIE_BASIS;
  } else {
    // Onbekende omgeving: niet raden. main.js blokkeert de app volledig.
    window.APP_ENV     = 'unknown';
    window.FIRESTORE_DB = '(default)';
    window.APP_VERSIE   = window.APP_VERSIE_BASIS + '-?';
  }
})();
