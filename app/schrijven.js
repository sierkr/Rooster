// Alle schrijfopdrachten naar de databank lopen hierdoorheen (v3.34.0).
//
// De modules importeren setDoc / updateDoc / deleteDoc / addDoc / writeBatch
// hiervandaan in plaats van rechtstreeks van Firebase. Dat doet twee dingen:
//
// 1. ZONDER VERBINDING GEEN WIJZIGINGEN. Firebase accepteert een wijziging ook
//    offline: ze staat meteen op het scherm, maar gaat pas naar de databank
//    als de verbinding terug is — en heeft iemand intussen hetzelfde vakje
//    gewijzigd, dan wint wie het laatst binnenkomt, zonder melding. Bovendien
//    zijn de controles (conflicten, verwerkte wensen) dan gedaan tegen een
//    mogelijk verouderd rooster. In deze app zijn fouten duur, dus: blokkeren
//    en zeggen waarom. Besloten door Sierk op 1 oktober 2026 (keuze B).
//    Ook geblokkeerd: de app draait op de aantekening van dit toestel (zie
//    main.js) en Firebase heeft de aanmelding nog niet bevestigd. Dan is er
//    geen inlogbewijs en zou de wijziging evengoed blijven hangen.
//
// 2. EEN WIJZIGING DIE BLIJFT HANGEN, MELDT ZICH. Een telefoon kan zeggen dat
//    hij verbinding heeft terwijl er niets doorkomt. Is een wijziging na
//    10 seconden nog niet door de databank bevestigd, dan verschijnt een
//    oranje balk. Die verdwijnt zodra alles alsnog is aangekomen.
//
// ⚠ Bewust NIET via deze module (die werken ook zonder verbinding):
//    - leesstatus van dag-opmerkingen (save.js, opmerking_gelezen)
//    - "wijziging gezien" (views/overzicht.js)
//    - logboekregels van export/import (logboek.js, legVast)
//    - registratie van de laatste backup (backup-client.js)
//   Dat zijn geen roosterwijzigingen; ze mogen later alsnog aankomen.

import * as fs from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { state } from './state.js';
import { meld } from './dialoog.js';
import { toonBalk, verbergBalk } from './statusbalk.js';

export const GEEN_VERBINDING_TEKST =
  'Geen verbinding — wijzigen kan weer zodra de verbinding terug is.';

export class GeenVerbindingFout extends Error {
  constructor() {
    super(GEEN_VERBINDING_TEKST);
    this.name = 'GeenVerbindingFout';
    this.code = 'geen-verbinding';
  }
}

// De aantekening-gebruiker uit main.js is een gewoon object met uid en e-mail;
// een echte Firebase-gebruiker kan een inlogbewijs leveren.
function _opAantekening() {
  return !!state.user && typeof state.user.getIdToken !== 'function';
}

export function magSchrijven() {
  return navigator.onLine && !_opAantekening();
}

/**
 * Gooit GeenVerbindingFout (en toont de melding) als wijzigen nu niet kan.
 * De aanroepende code vangt de fout meestal zelf af en toont "Opslaan
 * mislukt: …"; dat venster vervangt dan dit venster. Code die de fout níet
 * afvangt, laat de gebruiker dankzij dit venster toch niet in het ongewisse.
 */
export function controleerVerbinding() {
  if (magSchrijven()) return;
  meld('Geen verbinding',
    'Wijzigen kan weer zodra de verbinding terug is.\n\n'
    + 'Je ziet nu het laatst bekende rooster. Er is niets opgeslagen.');
  throw new GeenVerbindingFout();
}

// ---- Bewaking van wijzigingen die blijven hangen -----------------------------
const WACHTTIJD_MS = 10000;
const _onderweg = new Map(); // volgnummer -> begintijd
let _volgnr = 0;

function _bijwerkenBalk() {
  if (_onderweg.size === 0) { verbergBalk('opslag'); return; }
  const oudste = Math.min(..._onderweg.values());
  if (Date.now() - oudste >= WACHTTIJD_MS) {
    toonBalk('opslag', 'Wijziging nog niet opgeslagen — wacht op verbinding');
  }
}

function _bewaak(belofte) {
  const nr = ++_volgnr;
  _onderweg.set(nr, Date.now());
  const t = setTimeout(_bijwerkenBalk, WACHTTIJD_MS);
  const klaar = () => { clearTimeout(t); _onderweg.delete(nr); _bijwerkenBalk(); };
  belofte.then(klaar, klaar);
  return belofte;
}

// ---- De schrijfopdrachten zelf ------------------------------------------------
// Let op: de Firebase-opdracht wordt meteen (synchroon) gegeven, net als
// voorheen; alleen de controle ervoor is nieuw.
export async function setDoc(...a)    { controleerVerbinding(); return _bewaak(fs.setDoc(...a)); }
export async function updateDoc(...a) { controleerVerbinding(); return _bewaak(fs.updateDoc(...a)); }
export async function deleteDoc(...a) { controleerVerbinding(); return _bewaak(fs.deleteDoc(...a)); }
export async function addDoc(...a)    { controleerVerbinding(); return _bewaak(fs.addDoc(...a)); }

export function writeBatch(db) {
  const batch = fs.writeBatch(db);
  const commit = batch.commit.bind(batch);
  batch.commit = async () => { controleerVerbinding(); return _bewaak(commit()); };
  return batch;
}

/** Voor de Cloud Functions (gebruikersbeheer): alleen de controle vooraf. */
export function metVerbindingsControle(callable) {
  return async (...a) => { controleerVerbinding(); return callable(...a); };
}
