// Logboek — v3.33.0
//
// Twee bronnen, bewust gescheiden:
//
//  1. audit_log  — bestond al sinds v3.28.0. De Cloud Function auditIndeling
//     schrijft daar bij élke wijziging aan een roosterdag een regel: wie,
//     welke dag, welk veld, van → naar, servertijd. Onvervalsbaar: alleen de
//     server schrijft erin (zie firestore.rules). Deze module leest het
//     alleen. Let op: de trigger draait uitsluitend op de live-database, dus
//     in de testomgeving blijft dit leeg.
//
//  2. export_log — nieuw. De export en de import lieten geen enkel spoor na,
//     waardoor achteraf niet te zien was wát er in een geëxporteerd bestand
//     zat. Nu wordt per export en per import een samenvatting weggeschreven:
//     wie, wanneer, welk jaar, hoeveel dagen en hoeveel gevulde cellen — en
//     bij een import ook hoeveel cellen er daadwerkelijk wijzigden.
//     Dit log wordt door de app zelf geschreven; het is dus compleet, maar
//     niet onvervalsbaar zoals audit_log.

import {
  collection, addDoc, getDocs, query, orderBy, limit, where, serverTimestamp,
  doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';
import { state } from './state.js';

export const EXPORT_LOG = 'export_log';
export const AUDIT_LOG  = 'audit_log';
export const SNAPSHOTS  = 'import_snapshots';

// v3.33.2: er blijft er precies ÉÉN bewaard — dat van de laatste import.
// Terugdraaien is een noodgreep voor de import die je net verkeerd inschatte;
// die gebruik je binnen minuten, niet drie imports later. Meer punten bewaren
// maakte een oude knop mogelijk die stilletjes recent werk opruimt. Met één
// punt kan dat niet: verder terug dan de laatste import bestaat gewoon niet.
const BEWAAR_PUNTEN = 1;

// Eén slot voor schrijfacties die over dezelfde roosterdagen gaan. Zonder dit
// konden een import en een terugdraaiing tegelijk lopen en won degene die
// toevallig als laatste klaar was.
let _bezig = false;
export function schrijfactieBezig() { return _bezig; }
export function zetSchrijfactie(aan) { _bezig = !!aan; }

// ---- Schrijven --------------------------------------------------------------

// Legt één export- of import-gebeurtenis vast. Mislukt dit, dan mag de
// export/import daar nooit op stuklopen: een logboek is bijzaak.
export async function legVast(record) {
  try {
    await addDoc(collection(db, EXPORT_LOG), {
      ...record,
      uid:    state.user?.uid || null,
      email:  state.profiel?.email || null,
      naam:   state.profiel?.naam || null,
      wanneer: serverTimestamp(),
      // Lokale tijd meesturen: bij het lezen is de servertijd er soms nog niet
      // (serverTimestamp vult pas bij het schrijven), en dan is dit het anker.
      wanneer_lokaal: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('logboek.legVast mislukt', e && e.message);
  }
}

// Telt de gevulde cellen in een lijst dagen ({ datum, toewijzingen }).
// Geeft { dagen, gevuldeCellen, gevuldeDagen, perKolom, jaren }.
export function tel(dagen) {
  const perKolom = {};
  const jaren = {};
  let gevuldeCellen = 0, gevuldeDagen = 0;
  (dagen || []).forEach(d => {
    const tw = d.toewijzingen || {};
    let dagGevuld = false;
    Object.entries(tw).forEach(([radId, codes]) => {
      const n = Array.isArray(codes) ? codes.filter(Boolean).length : (codes ? 1 : 0);
      if (n > 0) {
        gevuldeCellen += n;
        perKolom[radId] = (perKolom[radId] || 0) + n;
        dagGevuld = true;
      }
    });
    if (dagGevuld) gevuldeDagen++;
    const j = String(d.datum || '').slice(0, 4);
    if (j) jaren[j] = (jaren[j] || 0) + 1;
  });
  return { dagen: (dagen || []).length, gevuldeCellen, gevuldeDagen, perKolom, jaren };
}

// ---- Lezen ------------------------------------------------------------------

export async function laadExportLog(max = 200) {
  const q = query(collection(db, EXPORT_LOG), orderBy('wanneer_lokaal', 'desc'), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Leest audit_log. `vanaf`/`tot` filteren op de ROOSTERDATUM (het veld datum),
// niet op het tijdstip van de wijziging — dat is wat je meestal wilt weten
// ("is er ooit aan 2027 gewerkt?"). Zonder filter: de nieuwste regels.
export async function laadAuditLog({ vanaf = '', tot = '', max = 300 } = {}) {
  let q;
  if (vanaf || tot) {
    const clauses = [];
    if (vanaf) clauses.push(where('datum', '>=', vanaf));
    if (tot)   clauses.push(where('datum', '<=', tot));
    q = query(collection(db, AUDIT_LOG), ...clauses, orderBy('datum', 'desc'), limit(max));
  } else {
    q = query(collection(db, AUDIT_LOG), orderBy('tijdstip', 'desc'), limit(max));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// uid → leesbare naam, via de al geladen gebruikers/radiologen.
export function naamVanUid(uid) {
  if (!uid) return 'onbekend';
  const g = (state.gebruikers || []).find(x => x.id === uid);
  if (!g) return uid.slice(0, 8) + '…';
  if (g.radioloog_id) {
    const r = (state.radiologen || []).find(x => x.id === g.radioloog_id);
    if (r && r.code) return `${r.code}${g.naam ? ' · ' + g.naam : ''}`;
  }
  return g.naam || g.email || uid.slice(0, 8) + '…';
}

// Firestore-timestamp of ISO-string → leesbare datum/tijd.
export function tijdTekst(v) {
  if (!v) return '';
  const d = typeof v === 'object' && typeof v.toDate === 'function' ? v.toDate() : new Date(v);
  if (isNaN(d)) return '';
  return d.toLocaleString('nl-NL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Vat het velden-diff van één audit-regel samen in korte tekst.
export function diffTekst(velden) {
  if (!velden || typeof velden !== 'object') return '';
  const delen = [];
  const toon = (v) => {
    if (v === null || v === undefined) return 'leeg';
    if (Array.isArray(v)) return v.length ? v.join(',') : 'leeg';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v) || 'leeg';
  };
  for (const [veld, inhoud] of Object.entries(velden)) {
    if (inhoud && typeof inhoud === 'object' && 'van' in inhoud && 'naar' in inhoud) {
      delen.push(`${veld}: ${toon(inhoud.van)} → ${toon(inhoud.naar)}`);
    } else if (inhoud && typeof inhoud === 'object') {
      for (const [sleutel, w] of Object.entries(inhoud)) {
        delen.push(`${sleutel}: ${toon(w && w.van)} → ${toon(w && w.naar)}`);
      }
    }
  }
  return delen.join(' · ');
}


// ---- Terugdraai-punten (v3.33.1) -------------------------------------------
//
// Vóór een import bewaren we de HUIDIGE inhoud van precies de dagen die de
// import gaat overschrijven. Niet als bestand met een wachtwoord — dat belandt
// op de computer van degene die toevallig importeerde — maar in de database
// zelf. Zo kan elke beheerder een import later met één knop terugdraaien,
// vanaf elk apparaat.
//
// Opslag: één meta-document per punt, plus per kalendermaand één document met
// de dagen erin. Die opsplitsing houdt elk document ruim onder de limiet van
// Firestore (1 MB) en maakt terugdraaien in behapbare brokken mogelijk.
// Een dag die vóór de import nog niet bestond wordt als null bewaard; bij
// terugdraaien wordt zo'n dag weer verwijderd.

function _maandVan(datum) { return String(datum).slice(0, 7); }

// Maakt het terugdraai-punt. `dagen` is de lijst uit de import-preview; de
// vorige inhoud komt uit state.indelingMap, dat door actImportFile al voor het
// volledige datumbereik van het bestand is bijgeladen.
// Geeft het id van het punt terug, of null als het niet lukte (een import mag
// hier nooit op stuklopen).
export async function maakTerugdraaiPunt(dagen, bestandsnaam) {
  try {
    const perMaand = {};
    const jaren = {};
    (dagen || []).forEach(d => {
      const m = _maandVan(d.datum);
      if (!perMaand[m]) perMaand[m] = {};
      const bestaand = state.indelingMap[d.datum];
      if (bestaand) {
        const { id: _id, ...rest } = bestaand;
        perMaand[m][d.datum] = rest;
      } else {
        perMaand[m][d.datum] = null; // bestond niet → bij terugdraaien weghalen
      }
      const j = String(d.datum).slice(0, 4);
      jaren[j] = (jaren[j] || 0) + 1;
    });

    const maanden = Object.keys(perMaand).sort();
    const metaRef = doc(collection(db, SNAPSHOTS));

    for (const m of maanden) {
      await setDoc(doc(db, SNAPSHOTS, metaRef.id, 'maanden', m), { dagen: perMaand[m] });
    }

    await setDoc(metaRef, {
      wanneer: serverTimestamp(),
      wanneer_lokaal: new Date().toISOString(),
      uid: state.user?.uid || null,
      email: state.profiel?.email || null,
      naam: state.profiel?.naam || null,
      bestandsnaam: bestandsnaam || '',
      jaren: Object.keys(jaren).sort().join(', '),
      aantal_dagen: (dagen || []).length,
      maanden,
      teruggedraaid: false,
    });

    await _ruimOudePuntenOp();
    vergeetLaatstePunt();
    return metaRef.id;
  } catch (e) {
    console.warn('maakTerugdraaiPunt mislukt', e && e.message);
    return null;
  }
}

// Ruimt alles op behalve de BEWAAR_PUNTEN nieuwste (sinds v3.33.2: één).
async function _ruimOudePuntenOp() {
  try {
    const snap = await getDocs(query(collection(db, SNAPSHOTS), orderBy('wanneer_lokaal', 'desc')));
    const teOud = snap.docs.slice(BEWAAR_PUNTEN);
    for (const d of teOud) {
      const maanden = (d.data().maanden) || [];
      for (const m of maanden) {
        await deleteDoc(doc(db, SNAPSHOTS, d.id, 'maanden', m)).catch(() => null);
      }
      await deleteDoc(doc(db, SNAPSHOTS, d.id)).catch(() => null);
    }
  } catch (e) {
    console.warn('opruimen terugdraai-punten mislukt', e && e.message);
  }
}

// Onthoudt het laatste punt zodat de Excel-tab het kan tonen zonder bij elke
// hertekening opnieuw te lezen. Na een import of terugdraaiing vergeten we het.
let _laatste = null;
let _laatsteGeladen = false;

export function vergeetLaatstePunt() { _laatste = null; _laatsteGeladen = false; }

export async function laatsteTerugdraaiPunt() {
  if (_laatsteGeladen) return _laatste;
  try {
    const snap = await getDocs(
      query(collection(db, SNAPSHOTS), orderBy('wanneer_lokaal', 'desc'), limit(1))
    );
    _laatste = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (e) {
    console.warn('laatsteTerugdraaiPunt mislukt', e && e.message);
    _laatste = null;
  }
  _laatsteGeladen = true;
  return _laatste;
}

export async function laadTerugdraaiPunt(id) {
  const d = await getDoc(doc(db, SNAPSHOTS, id));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

// Zet de bewaarde dagen terug. Geeft { hersteld, verwijderd } terug.
// onVoortgang(tekst) wordt per maand aangeroepen.
export async function draaiTerug(id, onVoortgang = () => {}) {
  const meta = await laadTerugdraaiPunt(id);
  if (!meta) throw new Error('Dit terugdraai-punt bestaat niet meer.');
  if (meta.teruggedraaid) throw new Error('Deze import is al teruggedraaid.');

  let hersteld = 0, verwijderd = 0;
  for (const m of (meta.maanden || [])) {
    const mSnap = await getDoc(doc(db, SNAPSHOTS, id, 'maanden', m));
    if (!mSnap.exists()) continue;
    const dagen = mSnap.data().dagen || {};
    const datums = Object.keys(dagen).sort();
    for (let i = 0; i < datums.length; i += 400) {
      const batch = writeBatch(db);
      datums.slice(i, i + 400).forEach(datum => {
        const vorige = dagen[datum];
        if (vorige === null || vorige === undefined) {
          batch.delete(doc(db, 'indeling', datum));
          verwijderd++;
        } else {
          batch.set(doc(db, 'indeling', datum), vorige);
          hersteld++;
        }
      });
      await batch.commit();
    }
    onVoortgang(`${m} teruggezet`);
  }

  await updateDoc(doc(db, SNAPSHOTS, id), {
    teruggedraaid: true,
    teruggedraaid_op: serverTimestamp(),
    teruggedraaid_door: state.profiel?.naam || state.profiel?.email || state.user?.uid || null,
  });

  vergeetLaatstePunt();

  await legVast({
    soort: 'terugdraaien',
    jaar: meta.jaren || '',
    bestandsnaam: meta.bestandsnaam || '',
    dagen: hersteld + verwijderd,
    gevulde_cellen: 0,
    gevulde_dagen: 0,
    hersteld,
    verwijderd,
    snapshot_id: id,
  });

  return { hersteld, verwijderd };
}
