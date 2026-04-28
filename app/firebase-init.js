// Firebase 10 modular SDK + initialisatie. Andere modules importeren
// db / auth / fnX uit dit bestand. SDK-helpers (doc, collection, setDoc, ...)
// worden direct uit de Firebase modules geïmporteerd in de modules die ze nodig hebben.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

export const firebaseApp = initializeApp(window.FIREBASE_CONFIG);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, 'europe-west1');

// Callable Cloud Functions
export const fnGebruikerAanmaken      = httpsCallable(functions, 'gebruikerAanmaken');
export const fnGebruikerVerwijderen   = httpsCallable(functions, 'gebruikerVerwijderen');
export const fnGebruikerResetWachtwoord = httpsCallable(functions, 'gebruikerResetWachtwoord');
