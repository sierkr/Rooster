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
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';
import { state } from './state.js';

export const EXPORT_LOG = 'export_log';
export const AUDIT_LOG  = 'audit_log';

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
