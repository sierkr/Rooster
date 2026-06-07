// Firebase 10 modular SDK + initialisatie. Andere modules importeren
// db / auth / fnX uit dit bestand. SDK-helpers (doc, collection, setDoc, ...)
// worden direct uit de Firebase modules geïmporteerd in de modules die ze nodig hebben.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

export const firebaseApp = initializeApp(window.FIREBASE_CONFIG);
export const auth = getAuth(firebaseApp);

// ----------------------------------------------------------------------------
// Database-selectie: productie gebruikt de (default) database; de testomgeving
// zet window.FIRESTORE_DB = 'test' in config.test.js, waardoor de app een
// aparte named Firestore-database binnen hetzelfde project gebruikt. De live
// data blijft daardoor volledig ongemoeid tijdens het testen.
// ----------------------------------------------------------------------------
const FIRESTORE_DB = (typeof window !== 'undefined' && window.FIRESTORE_DB)
  ? window.FIRESTORE_DB
  : '(default)';
export const IS_TEST_DB = FIRESTORE_DB !== '(default)';

export const db = IS_TEST_DB
  ? getFirestore(firebaseApp, FIRESTORE_DB)
  : getFirestore(firebaseApp);

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
