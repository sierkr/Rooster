// Stoel-mutaties: logboek, terugdraaien (undo) en tijdlijn-weergave.
// ---------------------------------------------------------------------------
// Elke ingreep op een stoel (Wissel, Vertrek, → Vast, Nieuwe stoel) legt hier
// een mutatie-record vast met (a) een volledige snapshot van de betrokken
// stoel-documenten van VÓÓR de ingreep en (b) — bij → Vast — de exacte inverse
// van de verplaatste roosterdata (alleen de gewijzigde cellen). Daarmee is elke
// ingreep exact en gevalideerd terug te draaien. De tijdlijn-weergave maakt alle
// gebeurtenissen per stoel én per persoon inzichtelijk.
import {
  collection, doc, getDocs, addDoc, updateDoc, setDoc, deleteDoc, deleteField, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';
import { state } from './state.js';
import {
  vandaagIso, plusDagen, formatDatum, assertBezettingGeldig,
  loopbaanVoorPersoon, persoonFallbackKey, bezettingenInRange,
} from './helpers.js';
import { openSheet, closeSheet } from './sheets.js';

const MUT_COLL = 'bezetting_mutaties';
const NEARTERM_DAGEN = 30; // "nabij" = binnen zoveel dagen → extra waarschuwing

const TYPE_LABEL = {
  wissel: 'Vervanging (Wissel)',
  vertrek: 'Vertrek / pensioen',
  maakVast: 'Vast in dienst (→ Vast)',
  nieuweStoel: 'Nieuwe stoel',
};

// ---- Laden ------------------------------------------------------------------
export async function laadBezettingMutaties() {
  try {
    const snap = await getDocs(collection(db, MUT_COLL));
    state.bezettingMutaties = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.tijdstip || '').localeCompare(a.tijdstip || ''));
  } catch (e) {
    state.bezettingMutaties = [];
    console.warn('laadBezettingMutaties', e && e.message);
  }
}

// ---- Snapshot + registratie -------------------------------------------------
// Volledige (diepe) kopie van de stoel-documenten. seatIds die (nog) niet
// bestaan krijgen null → terugdraaien verwijdert die stoel weer.
export function snapshotStoelen(seatIds) {
  const out = {};
  seatIds.forEach(id => {
    const st = state.radiologen.find(r => r.id === id);
    out[id] = st ? JSON.parse(JSON.stringify(st)) : null;
  });
  return out;
}

export async function registreerMutatie(rec) {
  const doc0 = {
    tijdstip: new Date().toISOString(),
    door: state.profiel?.naam || state.user?.email || 'onbekend',
    teruggedraaid: false,
    ...rec,
  };
  try {
    const ref = await addDoc(collection(db, MUT_COLL), doc0);
    state.bezettingMutaties = [{ id: ref.id, ...doc0 }, ...(state.bezettingMutaties || [])];
  } catch (e) {
    // Een mislukte log-registratie mag de ingreep zelf niet ongedaan maken;
    // we waarschuwen wel, want zonder record is deze ingreep niet terug te draaien.
    console.warn('registreerMutatie', e && e.message);
    alert('Let op: de wijziging is doorgevoerd, maar kon niet in het terugdraai-logboek worden vastgelegd '
      + '(controleer of firestore.rules de collectie "bezetting_mutaties" toestaat). '
      + 'Deze specifieke ingreep is daardoor niet via "Terugdraaien" ongedaan te maken.');
  }
}

// ---- Impact-preview ---------------------------------------------------------
// Telt wat er vanaf `datumVanaf` al gepland staat op de betrokken stoelen, zodat
// de planner de gevolgen ziet vóór bevestigen. nabij = binnen NEARTERM_DAGEN.
export function impactVanaf(datumVanaf, seatIds) {
  const vanaf = datumVanaf || vandaagIso();
  const grensNabij = plusDagen(vandaagIso(), NEARTERM_DAGEN);
  const set = new Set(seatIds);
  let toew = 0, vak = 0, dienst = 0;
  const nabijeDagen = new Set();
  Object.values(state.indelingMap || {}).forEach(dag => {
    if (!dag?.datum || dag.datum < vanaf) return;
    let raakDag = false;
    set.forEach(sid => {
      if (dag.toewijzingen && dag.toewijzingen[sid]) { toew++; raakDag = true; }
      if (dag.vakantie_v && (sid in dag.vakantie_v)) { vak++; raakDag = true; }
      if (dag.dienst) ['dag', 'avond', 'nacht'].forEach(s => { if (dag.dienst[s] === sid) { dienst++; raakDag = true; } });
    });
    if (raakDag && dag.datum >= vandaagIso() && dag.datum <= grensNabij) nabijeDagen.add(dag.datum);
  });
  let wensen = 0;
  (state.wensen || []).forEach(w => { if (set.has(w.radioloog_id) && w.datum >= vanaf) wensen++; });
  return { toew, vak, dienst, wensen, nabij: nabijeDagen.size > 0, nabijeDagen: [...nabijeDagen].sort() };
}

export function impactTekst(imp) {
  const r = [];
  if (imp.toew) r.push(`${imp.toew} toewijzing${imp.toew === 1 ? '' : 'en'}`);
  if (imp.vak) r.push(`${imp.vak} vakantie-V`);
  if (imp.dienst) r.push(`${imp.dienst} dienst${imp.dienst === 1 ? '' : 'en'}`);
  if (imp.wensen) r.push(`${imp.wensen} wens${imp.wensen === 1 ? '' : 'en'}`);
  return r.length ? r.join(', ') : 'geen reeds geplande gegevens';
}

// ---- Terugdraaibaarheid -----------------------------------------------------
// Alleen de MEEST RECENTE, nog niet teruggedraaide mutatie per stoel is veilig
// terug te draaien (een oudere undo zou latere wijzigingen negeren). Returnt een
// reden-string als het niet kan, anders null.
export function ondraaibaarReden(m) {
  if (!m) return 'onbekende mutatie';
  if (m.teruggedraaid) return 'al teruggedraaid';
  const seats = m.stoelen || Object.keys(m.voor || {});
  const nieuwer = (state.bezettingMutaties || []).some(x =>
    !x.teruggedraaid && x.id !== m.id && (x.tijdstip || '') > (m.tijdstip || '') &&
    (x.stoelen || Object.keys(x.voor || {})).some(s => seats.includes(s)));
  if (nieuwer) return 'draai eerst de nieuwere wijziging(en) op deze stoel terug';
  return null;
}

// ---- Terugdraaien -----------------------------------------------------------
window.terugdraaiMutatie = async function(id) {
  const m = (state.bezettingMutaties || []).find(x => x.id === id);
  if (!m) { alert('Mutatie niet gevonden.'); return; }
  const reden = ondraaibaarReden(m);
  if (reden) { alert('Kan niet terugdraaien: ' + reden + '.'); return; }

  const seats = m.stoelen || Object.keys(m.voor || {});
  const imp = impactVanaf(m.ingangsdatum || vandaagIso(), seats);
  const invers = (m.roosterInvers || []).length + (m.wensenInvers || []).length + (m.gebruikersInvers || []).length;
  let waarschuw = `Terugdraaien: ${m.beschrijving || TYPE_LABEL[m.type] || 'wijziging'}\n\n`
    + `Dit herstelt de situatie van vóór deze ingreep.\n`
    + `Reeds gepland in het geraakte venster: ${impactTekst(imp)}.\n`
    + `Roosterregels die exact worden teruggezet: ${invers}.`;
  if (imp.nabij) waarschuw += `\n\n⚠ LET OP: hiervan liggen ${imp.nabijeDagen.length} dag(en) binnen ${NEARTERM_DAGEN} dagen `
    + `(${imp.nabijeDagen.slice(0, 5).map(d => d.slice(5)).join(', ')}${imp.nabijeDagen.length > 5 ? ' …' : ''}). `
    + `Betrokkenen zien een al rondgestuurd rooster veranderen.`;
  if (m.alleenTijdlijn) waarschuw += `\n\nLet op: deze ingreep staat alleen op tijdlijn-niveau in het logboek (backfill). `
    + `Terugdraaien herstelt de bezetting van de stoel, maar zet eventueel eerder verplaatste roosterdata NIET automatisch terug.`;
  waarschuw += `\n\nDoorgaan?`;
  if (!confirm(waarschuw)) return;

  try {
    // 1. Stoel-documenten terugzetten (volledige vervanging) of verwijderen.
    for (const sid of Object.keys(m.voor || {})) {
      const snap = m.voor[sid];
      if (snap === null || snap === undefined) { await deleteDoc(doc(db, 'radiologen', sid)); continue; }
      if (Array.isArray(snap.bezetting_historie)) assertBezettingGeldig(snap.bezetting_historie, sid);
      const data = { ...snap }; delete data.id;
      await setDoc(doc(db, 'radiologen', sid), data);
    }
    // 2. Roosterdata terugzetten (alleen gewijzigde cellen).
    const invLijst = m.roosterInvers || [];
    for (let i = 0; i < invLijst.length; i += 400) {
      const chunk = invLijst.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach(r => {
        const data = {};
        Object.entries(r.herstel || {}).forEach(([k, v]) => { data[k] = (v === '__DEL__') ? deleteField() : v; });
        if (Object.keys(data).length) batch.update(doc(db, 'indeling', r.datum), data);
      });
      await batch.commit();
    }
    // 3. Wensen en gebruikerskoppelingen terug.
    for (const w of (m.wensenInvers || [])) await updateDoc(doc(db, 'wensen', w.id), { radioloog_id: w.radioloog_id });
    for (const g of (m.gebruikersInvers || [])) await updateDoc(doc(db, 'gebruikers', g.id), { radioloog_id: g.radioloog_id });
    // 4. Mutatie markeren.
    await updateDoc(doc(db, MUT_COLL, id), { teruggedraaid: true, teruggedraaid_op: new Date().toISOString() });
    m.teruggedraaid = true;
    alert('Wijziging teruggedraaid. Wil je het opnieuw doen met een andere datum, voer dan de ingreep opnieuw uit.');
    if (window.__herlaadBeheer) await window.__herlaadBeheer();
  } catch (e) {
    alert('Terugdraaien mislukt: ' + (e.message || e));
  }
};

// ---- Backfill: bestaande overgangen alsnog registreren ----------------------
// Reconstrueert voor elke overgang in de stoel-tijdlijnen die nog geen
// logboek-record heeft, alsnog een mutatie-record met de gereconstrueerde
// "voor"-situatie. Zo worden ook wijzigingen van vóór het logboek terugdraaibaar.
// Idempotent (sleutel = stoel + ingangsdatum). alleenTijdlijn: reconstrueert de
// stoel-tijdlijn, NIET eerder verplaatste roosterdata van een oude → Vast.
let _backfillTeller = 0;

function _bouwBackfill(seat, voorHist, datum, prev, cur, type) {
  const laatste = voorHist[voorHist.length - 1] || {};
  const voorDoc = JSON.parse(JSON.stringify(seat));
  voorDoc.bezetting_historie = voorHist;
  voorDoc.code = laatste.code || '';
  voorDoc.achternaam = laatste.achternaam || '';
  voorDoc.voornaam = laatste.voornaam || '';
  voorDoc.in_dienst = laatste.in_dienst || null;
  voorDoc.persoon_id = laatste.persoon_id || null;
  voorDoc.actief = true;
  const beschr = (type === 'vertrek')
    ? `Bestaand vertrek op ${seat.id}: ${prev.code || ''} per ${formatDatum(datum, 'kort')} (backfill, alleen tijdlijn)`
    : `Bestaande wijziging op ${seat.id}: ${prev.code || ''} → ${cur.code || ''} per ${formatDatum(datum, 'kort')} (backfill, alleen tijdlijn)`;
  return {
    type, stoelen: [seat.id], voor: { [seat.id]: voorDoc },
    ingangsdatum: datum, backfill: true, alleenTijdlijn: true,
    tijdstip: new Date(Date.now() + (_backfillTeller++)).toISOString(),
    beschrijving: beschr,
  };
}

window.registreerBestaandeWijzigingen = async function() {
  const gedekt = new Set();
  (state.bezettingMutaties || []).forEach(m => (m.stoelen || []).forEach(s => gedekt.add(s + '|' + (m.ingangsdatum || ''))));

  const teMaken = [];
  (state.radiologen || []).forEach(seat => {
    const hist = Array.isArray(seat.bezetting_historie) ? seat.bezetting_historie : [];
    if (hist.length === 0) return;
    const P = hist.slice().sort((a, b) => (a.van || '0000-00-00') < (b.van || '0000-00-00') ? -1 : 1);
    // Successies: elke nieuwe periode na de eerste is één overgang.
    for (let i = 1; i < P.length; i++) {
      const cur = P[i], prev = P[i - 1];
      const datum = cur.van || '';
      if (!datum || gedekt.has(seat.id + '|' + datum)) continue;
      const voorHist = P.slice(0, i).map(p => ({ ...p }));
      voorHist[voorHist.length - 1] = { ...voorHist[voorHist.length - 1], tot: null };
      teMaken.push(_bouwBackfill(seat, voorHist, datum, prev, cur, 'wissel'));
      gedekt.add(seat.id + '|' + datum);
    }
    // Trailing vertrek: laatste periode afgesloten, geen opvolger.
    const laatste = P[P.length - 1];
    if (laatste && laatste.tot) {
      const datum = plusDagen(laatste.tot, 1);
      if (!gedekt.has(seat.id + '|' + datum)) {
        const voorHist = P.map(p => ({ ...p }));
        voorHist[voorHist.length - 1] = { ...voorHist[voorHist.length - 1], tot: null };
        teMaken.push(_bouwBackfill(seat, voorHist, datum, laatste, null, 'vertrek'));
        gedekt.add(seat.id + '|' + datum);
      }
    }
  });

  if (teMaken.length === 0) { alert('Geen bestaande wijzigingen gevonden die nog niet in het logboek staan.'); return; }
  if (!confirm(`${teMaken.length} bestaande stoel-wijziging(en) worden alsnog in het logboek geregistreerd, zodat je ze kunt terugdraaien.\n\n`
    + `Let op: dit reconstrueert alleen de stoel-tijdlijn. Eerder verplaatste roosterdata van een oude → Vast wordt hiermee NIET teruggezet.\n\nDoorgaan?`)) return;
  try {
    let n = 0;
    for (const rec of teMaken) { await registreerMutatie(rec); n++; }
    alert(`${n} wijziging(en) geregistreerd. Je kunt ze nu terugdraaien via "Recente stoel-wijzigingen".`);
    if (window.__herlaadBeheer) await window.__herlaadBeheer();
  } catch (e) {
    alert('Registreren mislukt: ' + (e.message || e));
  }
};

// ---- Weergave: "Recente stoel-wijzigingen"-kaart ----------------------------
export function renderRecenteMutaties() {
  const lijst = (state.bezettingMutaties || []).slice(0, 15);
  const rijen = lijst.length === 0
    ? '<p class="muted" style="margin:0;font-size:12px;font-style:italic;">Nog geen geregistreerde stoel-wijzigingen.</p>'
    : lijst.map(m => {
        const dt = m.tijdstip ? new Date(m.tijdstip) : null;
        const wanneer = dt ? dt.toLocaleDateString('nl-NL') + ' ' + dt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '';
        const reden = ondraaibaarReden(m);
        const knop = m.teruggedraaid
          ? '<span style="font-size:11px;color:#276221;">✓ teruggedraaid</span>'
          : `<button class="btn" style="font-size:11px;padding:6px 8px;${reden ? 'opacity:0.4;cursor:not-allowed;' : ''}" ${reden ? `disabled title="${reden}"` : ''} onclick="window.terugdraaiMutatie('${m.id}')">Terugdraaien</button>`;
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(0,0,0,0.06);${m.teruggedraaid ? 'opacity:0.55;' : ''}">
            <div style="min-width:0;">
              <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;">${(m.beschrijving || TYPE_LABEL[m.type] || 'wijziging').replace(/</g, '&lt;')}</div>
              <div class="muted" style="font-size:10px;">${TYPE_LABEL[m.type] || m.type} · ${wanneer}${m.door ? ' · ' + String(m.door).replace(/</g, '&lt;') : ''}</div>
            </div>
            <div style="flex-shrink:0;">${knop}</div>
          </div>`;
      }).join('');
  return `
    <div style="margin-top: 1.5rem;">
      <div class="summary-label" style="margin-bottom: 6px;">Recente stoel-wijzigingen</div>
      <div class="card">
        <p class="muted" style="margin:0 0 10px;">Elke vervanging, vertrek of vast-in-dienst is hier terug te draaien. Alleen de nieuwste wijziging per stoel is direct terug te draaien; draai zo nodig eerst een nieuwere wijziging terug. Corrigeren = terugdraaien en opnieuw uitvoeren met de juiste datum.</p>
        <button class="btn" style="width:100%; margin-bottom:10px; font-size:11px; opacity:0.9;" onclick="window.registreerBestaandeWijzigingen()" title="Reconstrueer bestaande overgangen die vóór het logboek ontstonden">➕ Bestaande wijzigingen registreren</button>
        ${rijen}
      </div>
    </div>
  `;
}

// ---- Weergave: tijdlijn per stoel -------------------------------------------
function periodeRegels(periodes, toonStoel) {
  const vandaag = vandaagIso();
  if (periodes.length === 0) return '<p class="muted" style="font-style:italic;">Geen periodes.</p>';
  return periodes.map(p => {
    const van = p.van ? formatDatum(p.van, 'kort') : 'begin';
    const tot = p.tot ? formatDatum(p.tot, 'kort') : 'heden';
    let status = '';
    if (p.van && p.van > vandaag) status = '<span style="color:#9c5700;">gepland</span>';
    else if (!p.tot || p.tot >= vandaag) status = '<span style="color:#276221;">lopend</span>';
    else status = '<span class="muted">afgesloten</span>';
    const stoelStr = toonStoel ? ` <span class="muted">(${p.stoelId || ''})</span>` : '';
    return `<div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(0,0,0,0.06);">
        <div style="font-weight:600;">${(p.code || '').replace(/</g, '&lt;')}</div>
        <div style="font-size:13px;">${(p.achternaam || '').replace(/</g, '&lt;')}${stoelStr}<div class="muted" style="font-size:11px;">${van} – ${tot}</div></div>
        <div style="font-size:11px;">${status}</div>
      </div>`;
  }).join('');
}

window.toonStoelTijdlijn = function(seatId) {
  const st = state.radiologen.find(r => r.id === seatId);
  const hist = Array.isArray(st?.bezetting_historie) ? st.bezetting_historie.slice() : [];
  hist.sort((a, b) => (a.van || '0000-00-00') < (b.van || '0000-00-00') ? -1 : 1);
  document.getElementById('sheetTitle').textContent = `Tijdlijn stoel ${seatId}`;
  document.getElementById('sheetSub').textContent = 'Alle bezetters van deze stoel in de tijd';
  document.getElementById('sheetBody').innerHTML = `
    ${periodeRegels(hist.map(e => ({ ...e, stoelId: seatId })), false)}
    <p class="muted" style="font-size:11px;margin-top:10px;">Een datum corrigeren? Draai de betreffende wijziging terug (Recente stoel-wijzigingen) en voer 'm opnieuw uit met de juiste datum.</p>
    <button class="btn" style="width:100%;margin-top:1rem;" onclick="window.closeSheet()">Sluiten</button>
  `;
  openSheet();
};

window.toonPersoonTijdlijn = function(persoonId, achternaam, code) {
  const fallback = persoonFallbackKey(achternaam, code);
  const periodes = loopbaanVoorPersoon(persoonId || null, fallback);
  document.getElementById('sheetTitle').textContent = `Tijdlijn ${code || ''}${achternaam ? ' · ' + achternaam : ''}`;
  document.getElementById('sheetSub').textContent = 'Alle posities van deze persoon over stoelen heen';
  document.getElementById('sheetBody').innerHTML = `
    ${periodeRegels(periodes, true)}
    <p class="muted" style="font-size:11px;margin-top:10px;">Een positie corrigeren? Draai de betreffende wijziging terug (Recente stoel-wijzigingen) en voer 'm opnieuw uit met de juiste datum.</p>
    <button class="btn" style="width:100%;margin-top:1rem;" onclick="window.closeSheet()">Sluiten</button>
  `;
  openSheet();
};

// Kleine helper voor gebruik door de operatie-handlers: leesbare persoon-tijdlijn
// starten vanaf een stoel (pakt de huidige/laatste bezetter van die stoel).
window.toonTijdlijnVanStoel = function(seatId) {
  const st = state.radiologen.find(r => r.id === seatId);
  const bez = bezettingenInRange(seatId, '0000-01-01', '9999-12-31');
  const laatste = bez[bez.length - 1] || {};
  if (st?.persoon_id || laatste.persoon_id || laatste.achternaam) {
    window.toonPersoonTijdlijn(st?.persoon_id || laatste.persoon_id, laatste.achternaam, laatste.code);
  } else {
    window.toonStoelTijdlijn(seatId);
  }
};
