// Firebase 10 modular SDK + initialisatie. Andere modules importeren
// db / auth / fnX uit dit bestand. SDK-helpers (doc, collection, setDoc, ...)
// worden direct uit de Firebase modules geïmporteerd in de modules die ze nodig hebben.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

export const firebaseApp = initializeApp(window.FIREBASE_CONFIG);

// v3.30.0 (H3, optioneel): Firebase App Check met reCAPTCHA v3. Wordt alléén
// geactiveerd als in config.js een site key is gezet (window.APPCHECK_SITE_KEY).
// Activering vereist eenmalige registratie in de Firebase-console — zie
// DEPLOY-FASE3.md. Zonder site key verandert er niets aan het gedrag.
if (typeof window !== 'undefined' && window.APPCHECK_SITE_KEY) {
  // Async IIFE (géén top-level await: dat zou op oudere Safari-versies de
  // volledige module-graph laten stranden op een parse error).
  (async () => {
    try {
      const { initializeAppCheck, ReCaptchaV3Provider } = await import(
        "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js"
      );
      initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaV3Provider(window.APPCHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (e) {
      console.warn('App Check kon niet worden geïnitialiseerd:', e && e.message);
    }
  })();
}

export const auth = getAuth(firebaseApp);

// ----------------------------------------------------------------------------
// Database-selectie: productie gebruikt de (default) database; de testomgeving
// zet window.FIRESTORE_DB = 'test' op basis van de URL (zie config.js), waardoor
// aparte named Firestore-database binnen hetzelfde project gebruikt. De live
// data blijft daardoor volledig ongemoeid tijdens het testen.
// ----------------------------------------------------------------------------
const FIRESTORE_DB = (typeof window !== 'undefined' && window.FIRESTORE_DB)
  ? window.FIRESTORE_DB
  : '(default)';
export const IS_TEST_DB = FIRESTORE_DB !== '(default)';

// v3.29.0 (Fase 2, offline): persistente lokale cache met multi-tab-support.
// Data die eenmaal geladen is blijft in IndexedDB beschikbaar, ook zonder
// netwerk: bij een netwerkstoring toont de app het laatst bekende rooster
// (alleen-lezen tot de verbinding terug is; writes worden dan gequeued).
// Als IndexedDB niet beschikbaar is (bv. private browsing) valt de SDK
// automatisch terug op geheugen-cache — zelfde gedrag als vóór v3.29.0.
const CACHE_INSTELLING = {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
};

export const db = IS_TEST_DB
  ? initializeFirestore(firebaseApp, CACHE_INSTELLING, FIRESTORE_DB)
  : initializeFirestore(firebaseApp, CACHE_INSTELLING);

export const functions = getFunctions(firebaseApp, 'europe-west1');

// ----------------------------------------------------------------------------
// Veiligheidsguard voor account-Cloud-Functions in de testomgeving.
// gebruikerAanmaken / gebruikerVerwijderen / gebruikerResetWachtwoord draaien
// server-side via de Admin SDK en werken ALTIJD op de live (default) database
// + Firebase Auth — ongeacht window.FIRESTORE_DB. In de testomgeving zouden ze
// dus productiegegevens raken. Daarom blokkeren we ze hard met een duidelijke
// foutmelding; de aanroepende UI vangt deze error af en toont hem.
// ----------------------------------------------------------------------------
function accountFunctie(naam) {
  const callable = httpsCallable(functions, naam);
  if (!IS_TEST_DB) return callable;
  return async () => {
    throw new Error('Gebruikersbeheer is uitgeschakeld in de testomgeving — dit zou de live database raken.');
  };
}

// Callable Cloud Functions
export const fnGebruikerAanmaken        = accountFunctie('gebruikerAanmaken');
export const fnGebruikerVerwijderen     = accountFunctie('gebruikerVerwijderen');
export const fnGebruikerResetWachtwoord = accountFunctie('gebruikerResetWachtwoord');

export { reauthenticateWithCredential, EmailAuthProvider };
