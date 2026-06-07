// ============================================================================
// Firebase configuratie — TESTOMGEVING
// ============================================================================
// Drop-in vervanger voor config.js op de test-branch. Gebruikt HETZELFDE
// Firebase-project (en dus dezelfde inlog-accounts), maar wijst de app naar een
// aparte Firestore named database 'test'. De live (default) database blijft
// daardoor volledig ongewijzigd tijdens het testen.
//
// Gebruik: op de test-branch dit bestand over config.js heen kopiëren
// (zie TESTOMGEVING.md). NIET op de productie-branch gebruiken.
// ============================================================================
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCIp8T0-BNPlh3j9X2QbXkQsaq7F91xoOA",
  authDomain: "rooster-radiologie.firebaseapp.com",
  projectId: "rooster-radiologie",
  storageBucket: "rooster-radiologie.firebasestorage.app",
  messagingSenderId: "798466630775",
  appId: "1:798466630775:web:65252d0d0a606ab9141272"
};

// Named Firestore-database voor de testomgeving. Productie laat deze weg
// (= '(default)'). Zolang deze op 'test' staat:
//   - leest/schrijft de app uitsluitend in de 'test'-database;
//   - zijn de account-Cloud-Functions (gebruiker aanmaken/verwijderen/reset)
//     geblokkeerd, omdat die altijd de live database zouden raken.
window.FIRESTORE_DB = "test";

// Versie van de app - wordt gebruikt voor cache-busting. Het -TEST label maakt
// in de UI (versielabel) direct zichtbaar dat dit de testomgeving is.
window.APP_VERSIE = "3.27.97-TEST";
