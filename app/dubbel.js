// Eén persoon op twee stoelen — controle en samenvoeg-plan (v3.38.0).
//
// Aanleiding (oktober 2026): GJG stond als waarnemer op W1 en kreeg daarna via
// "Nieuwe stoel" een tweede, vaste stoel. W1 werd niet afgesloten. De app zag
// daardoor twee mensen: GJG telde dubbel en zijn indeling stond verdeeld over
// twee kolommen.
//
// Deze module doet twee dingen, allebei zonder te schrijven:
//   1. zoekDubbelen() — vindt dezelfde persoon op twee stoelen tegelijk
//      (zelfde persoon-id, of zelfde code + achternaam), en "losse dagen":
//      rooster dat op een stoel achterbleef nadat iemand daar wegging, terwijl
//      hij op een andere stoel gewoon doorwerkt.
//   2. maakPlan() / schrijfOpdrachten() — rekenen precies uit wat samenvoegen
//      doet: welke stoel blijft, wat er verhuist, waar beide stoelen op
//      dezelfde dag iets hebben (botsingen) en wat er per veld geschreven wordt,
//      inclusief de exacte terugdraai-gegevens.
// Het schrijven zelf staat in views/samenvoegen.js. Doordat hier alleen
// rekenwerk staat, controleren de unit-tests het rechtstreeks.
import { state, SLOTS, VASTE_RAD_IDS } from './state.js';
import { plusDagen, persoonFallbackKey, alleVasteStoelIds, nieuwPersoonId } from './helpers.js';
import { codesNaarTekst } from './concept.js';

export const WEG = '__DEL__'; // "veld verwijderen" — views/samenvoegen.js maakt er deleteField() van

const MIN = '0000-00-00';
const MAX = '9999-12-31';
const begin = (p) => p.van || MIN;
const eind = (p) => p.tot || MAX;
const grootste = (a, b) => (a > b ? a : b);
const kleinste = (a, b) => (a < b ? a : b);
const dekt = (p, d) => begin(p) <= d && d <= eind(p);
const isLeeg = (v) => (Array.isArray(v) ? v.length === 0 : !v);
const gelijk = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Periodes per stoel ---------------------------------------------------------

// Een entry zonder echte naam (bv. "W1 · W1" uit het oude model) is geen
// persoon maar een plaatshouder voor een lege stoel.
export function isPlaatshouder(e, stoelId) {
  const ach = String((e && e.achternaam) || '').trim();
  return !ach || ach === stoelId || SLOTS.includes(ach);
}

// De bezetting_historie van een stoel; voor het oude model zonder historie een
// lijst met één entry uit de velden bovenaan (zoals bezettingOpDatum doet).
export function historieVan(stoel) {
  if (!stoel) return [];
  const h = Array.isArray(stoel.bezetting_historie) ? stoel.bezetting_historie : [];
  if (h.length) return h.map(e => ({ ...e }));
  if (stoel.isSlot && stoel.actief === false) return [];
  if (!String(stoel.achternaam || '').trim()) return [];
  return [{
    voornaam: stoel.voornaam || '', achternaam: stoel.achternaam || '', code: stoel.code || stoel.id,
    vakantierecht: typeof stoel.vakantierecht === 'number' ? stoel.vakantierecht : 40,
    parttime_factor: typeof stoel.parttime_factor === 'number' ? stoel.parttime_factor : 1,
    in_dienst: stoel.in_dienst || null, persoon_id: stoel.persoon_id || null,
    van: null, tot: null,
  }];
}

export function alleStoelIds() {
  return [...alleVasteStoelIds(), ...SLOTS];
}

export function stoelDoc(id) {
  return (state.radiologen || []).find(r => r.id === id) || null;
}

export function periodesVanStoel(stoelId) {
  return historieVan(stoelDoc(stoelId)).map((e, idx) => ({
    stoelId, idx,
    van: e.van || null, tot: e.tot || null,
    pid: e.persoon_id || null,
    sleutel: persoonFallbackKey(e.achternaam, e.code),
    code: e.code || stoelId, achternaam: e.achternaam || '', voornaam: e.voornaam || '',
    plaatshouder: isPlaatshouder(e, stoelId),
  }));
}

export function zelfdePersoon(a, b) {
  if (!a || !b || a.plaatshouder || b.plaatshouder) return false;
  if (a.pid && b.pid && a.pid === b.pid) return true;
  return a.sleutel === b.sleutel;
}

// Hoort wat er op `d` op deze stoel staat (vóór het samenvoegen) bij periode p?
// Ja als p er die dag zit, of als er die dag niemand zit en p de laatste was
// die er zat (rooster dat na zijn vertrek is blijven staan).
function hoortBij(periodes, p, d) {
  const echte = periodes.filter(x => !x.plaatshouder);
  const zit = echte.find(x => dekt(x, d));
  if (zit) return zit.idx === p.idx;
  const eerder = echte.filter(x => eind(x) < d);
  if (!eerder.length) return false;
  const laatste = eerder.reduce((a, b) => (eind(b) > eind(a) ? b : a));
  return laatste.idx === p.idx;
}

// Staat er op deze dag iets voor deze stoel in het rooster?
export function stoelHeeftData(dag, id) {
  if (!dag) return false;
  if (!isLeeg(dag.toewijzingen && dag.toewijzingen[id])) return true;
  if (dag.vakantie_v && (id in dag.vakantie_v)) return true;
  if (dag.cel_opmerkingen && dag.cel_opmerkingen[id]) return true;
  const di = dag.dienst || {};
  return ['dag', 'avond', 'nacht'].some(s => di[s] === id);
}

function paarSleutel(a, b) {
  return [`${a.stoelId}#${a.idx}`, `${b.stoelId}#${b.idx}`].sort().join('|');
}

// ---- 1. Controle ------------------------------------------------------------------

// Geeft een lijst bevindingen:
//   { soort: 'dubbel', sleutel, a, b, vanaf, tot, code, achternaam }
//       a en b zijn de twee periodes (op verschillende stoelen) die overlappen.
//   { soort: 'los', sleutel, a, b, losseDagen: [...], vanaf, code, achternaam }
//       a = de periode die afgesloten is (met achtergebleven rooster),
//       b = de periode op de stoel waar hij die dagen echt zit.
export function zoekDubbelen() {
  const perStoel = {};
  const alle = [];
  alleStoelIds().forEach(id => {
    perStoel[id] = periodesVanStoel(id);
    alle.push(...perStoel[id]);
  });
  const echte = alle.filter(p => !p.plaatshouder);
  const uit = [];
  const gezien = new Set();
  const info = (a, b) => {
    const recent = begin(a) >= begin(b) ? a : b;
    return { code: recent.code, achternaam: recent.achternaam, voornaam: recent.voornaam };
  };

  for (let i = 0; i < echte.length; i++) {
    for (let j = i + 1; j < echte.length; j++) {
      const a = echte[i], b = echte[j];
      if (a.stoelId === b.stoelId || !zelfdePersoon(a, b)) continue;
      const s = grootste(begin(a), begin(b));
      const t = kleinste(eind(a), eind(b));
      if (s > t) continue;
      const sleutel = paarSleutel(a, b);
      gezien.add(sleutel);
      uit.push({ soort: 'dubbel', sleutel, a, b, vanaf: s === MIN ? null : s, tot: t === MAX ? null : t, ...info(a, b) });
    }
  }

  const datums = Object.keys(state.indelingMap || {}).sort();
  for (const c of echte) {
    if (!c.tot) continue;
    for (const s of echte) {
      if (s.stoelId === c.stoelId || !zelfdePersoon(c, s) || eind(s) <= c.tot) continue;
      const sleutel = paarSleutel(c, s);
      if (gezien.has(sleutel)) continue;
      const losseDagen = datums.filter(d => d > c.tot && dekt(s, d)
        && stoelHeeftData(state.indelingMap[d], c.stoelId)
        && hoortBij(perStoel[c.stoelId], c, d));
      if (!losseDagen.length) continue;
      gezien.add(sleutel);
      uit.push({ soort: 'los', sleutel, a: c, b: s, losseDagen, vanaf: losseDagen[0], ...info(c, s) });
    }
  }
  return uit;
}

// ---- 2. Het plan ------------------------------------------------------------------

// Voorstel: de vaste stoel blijft (bij twee vaste of twee waarnemer-stoelen:
// de stoel waar hij het laatst begon), vanaf de dag dat hij daar begon.
export function standaardKeuze(bev) {
  let blijftId;
  if (bev.soort === 'los') blijftId = bev.b.stoelId;
  else {
    const aVast = !SLOTS.includes(bev.a.stoelId);
    const bVast = !SLOTS.includes(bev.b.stoelId);
    if (aVast !== bVast) blijftId = aVast ? bev.a.stoelId : bev.b.stoelId;
    else blijftId = begin(bev.a) >= begin(bev.b) ? bev.a.stoelId : bev.b.stoelId;
  }
  return { blijftId, datum: standaardDatum(bev, blijftId) };
}

function rollen(bev, blijftId) {
  const S = bev.a.stoelId === blijftId ? bev.a : bev.b;
  const C = S === bev.a ? bev.b : bev.a;
  return { S, C };
}

export function standaardDatum(bev, blijftId) {
  const { S, C } = rollen(bev, blijftId);
  return S.van || C.van || bev.vanaf || null;
}

// Vanaf welke dag zit hij na het samenvoegen op de stoel die blijft (S)?
// Datum op of vóór zijn begin op C: C valt helemaal weg en S neemt zijn hele
// periode over. Anders: vanaf de gekozen datum.
function nieuweStartS(S, C, D) {
  if (D <= begin(C)) {
    const g = kleinste(begin(C), begin(S));
    return g === MIN ? null : g;
  }
  return D;
}

// Grenzen en problemen van een gekozen datum. Uitgangspunt: na het samenvoegen
// zit hij vóór de datum op de stoel die verdwijnt (C) en vanaf de datum op de
// stoel die blijft (S) — zonder overlap, zonder gat, en de periode waarin hij
// bij de maatschap is blijft precies hetzelfde.
// `naam` = { stoel(id), datum(iso) } voor leesbare meldingen.
export function datumProbleem(bev, blijftId, D, naam = {}) {
  if (bev.soort === 'los') return null; // datum ligt vast: alleen de losse dagen verhuizen
  const st = naam.stoel || ((id) => id);
  const dt = naam.datum || ((iso) => iso);
  const { S, C } = rollen(bev, blijftId);
  if (!D) return 'Kies een datum.';
  if (eind(S) < eind(C)) {
    return `${st(C.stoelId)} loopt langer door dan ${st(S.stoelId)}. Kies ${st(C.stoelId)} als stoel die blijft.`;
  }
  if (S.tot && D > S.tot) return `Kies een datum tot en met ${dt(S.tot)}.`;
  if (D > begin(C)) {
    // C houdt hem tot de dag vóór D; S moet dan aaneengesloten vanaf D lopen.
    if (begin(S) < begin(C)) return `Kies een datum op of vóór ${dt(C.van)}.`;
    if (D > begin(S) && C.tot && D > plusDagen(C.tot, 1)) return `Kies een datum tot en met ${dt(plusDagen(C.tot, 1))}.`;
  }
  const startS = nieuweStartS(S, C, D);
  if (startS && startS < begin(S)) {
    // De blijvende stoel moet in de extra dagen vrij zijn.
    const bezet = periodesVanStoel(S.stoelId).filter(x => x.idx !== S.idx && !x.plaatshouder
      && begin(x) <= plusDagen(S.van, -1) && eind(x) >= startS);
    if (bezet.length) {
      const laatste = bezet.reduce((a, b) => (eind(b) > eind(a) ? b : a));
      return `${st(S.stoelId)} is tot en met ${dt(laatste.tot)} bezet door ${laatste.code}. Kies een datum na ${dt(laatste.tot)}.`;
    }
  }
  if (VASTE_RAD_IDS.includes(C.stoelId) && D <= begin(C)) {
    const anderen = periodesVanStoel(C.stoelId).filter(x => x.idx !== C.idx && !x.plaatshouder);
    if (!anderen.length) return `${st(C.stoelId)} kan niet helemaal verdwijnen. Kies een datum na ${C.van ? dt(C.van) : 'zijn begin'}.`;
  }
  return null;
}

// Rekent het samenvoegen uit voor bevinding `bev`, blijvende stoel `blijftId`
// en datum `D`. `concepten` = { jaar: cellen } van het Indelen-concept.
// Schrijft niets. Geeft { fout } of het volledige plan.
export function maakPlan(bev, { blijftId, datum }, concepten = {}, naam = {}) {
  const { S, C } = rollen(bev, blijftId);
  const D = bev.soort === 'los' ? S.van : datum;
  const fout = datumProbleem(bev, blijftId, D, naam);
  if (fout) return { fout };

  const stoelS = stoelDoc(S.stoelId), stoelC = stoelDoc(C.stoelId);
  const perC = periodesVanStoel(C.stoelId);
  const histS = historieVan(stoelS), histC = historieVan(stoelC);

  // Nieuwe periodes.
  let nieuwSvan = S.van;
  let nieuwC = { van: C.van, tot: C.tot, weg: false };
  if (bev.soort !== 'los') {
    nieuwSvan = nieuweStartS(S, C, D);
    if (begin(C) >= D) nieuwC = { van: C.van, tot: C.tot, weg: true };
    else if (eind(C) >= D) nieuwC = { van: C.van, tot: plusDagen(D, -1), weg: false };
  }
  const Sna = { ...S, van: nieuwSvan };
  const Cna = nieuwC.weg ? null : { ...C, van: nieuwC.van, tot: nieuwC.tot };

  // Eén persoon-id: dat van de periode die het eerst begon (zijn loopbaan).
  const eerst = begin(C) <= begin(S) ? C : S;
  const later = eerst === C ? S : C;
  const pidHouden = eerst.pid || later.pid || nieuwPersoonId();
  const pidWeg = [eerst.pid, later.pid].find(p => p && p !== pidHouden) || null;

  // Welke kant op verhuist het rooster op dag d? (null = deze dag niet)
  const richting = (d) => {
    if (dekt(Sna, d)) {
      if (hoortBij(perC, C, d)) return { bron: C.stoelId, doel: S.stoelId };
      return null;
    }
    if (Cna && dekt(Cna, d) && dekt(S, d)) return { bron: S.stoelId, doel: C.stoelId };
    return null;
  };

  // ---- Per dag: wat verhuist, wat botst ----
  const tel = () => ({ toew: 0, vak: 0, dienst: 0, opm: 0, wensen: 0, concept: 0 });
  const tellingen = { naarS: tel(), naarC: tel() };
  const dagen = [];
  const datums = Object.keys(state.indelingMap || {}).sort();
  datums.forEach(d => {
    const r = richting(d);
    if (!r) return;
    const dag = state.indelingMap[d];
    const t = r.doel === S.stoelId ? tellingen.naarS : tellingen.naarC;
    const velden = [];
    const tw = dag.toewijzingen || {};
    if (!isLeeg(tw[r.bron])) {
      velden.push({ soort: 'toew', bron: tw[r.bron], doel: isLeeg(tw[r.doel]) ? null : tw[r.doel] });
      t.toew++;
    }
    const vv = dag.vakantie_v || {};
    if (r.bron in vv) {
      velden.push({ soort: 'vak', bron: vv[r.bron], doel: (r.doel in vv) ? vv[r.doel] : null, doelHeeft: (r.doel in vv) });
      t.vak++;
    }
    const co = dag.cel_opmerkingen || {};
    if (co[r.bron]) {
      velden.push({ soort: 'opm', bron: co[r.bron], doel: co[r.doel] || null });
      t.opm++;
    }
    const di = dag.dienst || {};
    ['dag', 'avond', 'nacht'].forEach(s => { if (di[s] === r.bron) { velden.push({ soort: 'dienst', slot: s }); t.dienst++; } });

    const jaar = d.slice(0, 4);
    const cellen = (concepten && concepten[jaar]) || {};
    const cb = cellen[`${d}|${r.bron}`];
    const cd = cellen[`${d}|${r.doel}`];
    const cDienst = cellen[`${d}|_dienst`];
    const conceptRaakt = !!cb || !!cd || (cDienst && cDienst.nieuw === r.bron);
    if (cb) t.concept++;

    if (!velden.length && !conceptRaakt) return;
    // Botsing = beide stoelen hebben op deze dag een (verschillende) waarde.
    const botsVelden = [];
    velden.forEach(v => {
      if (v.soort === 'toew' && v.doel && !gelijk(v.bron, v.doel)) botsVelden.push(v);
      if (v.soort === 'vak' && v.doelHeeft && !gelijk(v.bron, v.doel)) botsVelden.push(v);
      if (v.soort === 'opm' && v.doel && v.doel !== v.bron) botsVelden.push(v);
    });
    const conceptBotst = !!(cb && cd && cb.nieuw !== cd.nieuw);
    dagen.push({ datum: d, ...r, velden, botsVelden, conceptBotst, botsing: botsVelden.length > 0 || conceptBotst });
  });

  // ---- Wensen en accounts ----
  const wensen = (state.wensen || [])
    .map(w => ({ w, r: w.datum ? richting(w.datum) : null }))
    .filter(x => x.r && x.w.radioloog_id === x.r.bron)
    .map(({ w, r }) => {
      (r.doel === S.stoelId ? tellingen.naarS : tellingen.naarC).wensen++;
      return { id: w.id, datum: w.datum, van: r.bron, naar: r.doel };
    });
  // Een account dat aan de stoel die (deels) verdwijnt hangt, hoort bij deze
  // persoon als hij daar de laatste bezetter was. Het gaat mee naar de stoel
  // die blijft.
  const laatsteOpC = perC.filter(x => !x.plaatshouder).reduce((a, b) => (!a || begin(b) >= begin(a) ? b : a), null);
  const accountsMee = !!laatsteOpC && laatsteOpC.idx === C.idx;
  const gebruikers = accountsMee
    ? (state.gebruikers || []).filter(g => g.radioloog_id === C.stoelId).map(g => ({ id: g.id, naam: g.naam || g.email || g.id, van: C.stoelId, naar: S.stoelId }))
    : [];

  // ---- Nieuwe stoel-documenten ----
  const zetPid = (e) => (e.persoon_id === pidWeg && pidWeg ? { ...e, persoon_id: pidHouden } : e);
  const nieuwHistS = histS.map((e, i) => (i === S.idx ? { ...e, van: nieuwSvan, persoon_id: pidHouden } : zetPid(e)));
  let nieuwHistC = histC.map((e, i) => (i === C.idx ? { ...e, tot: nieuwC.tot, persoon_id: pidHouden } : zetPid(e)));
  if (nieuwC.weg) nieuwHistC = nieuwHistC.filter((e, i) => i !== C.idx);

  const cIsSlot = SLOTS.includes(C.stoelId);
  const cEchteNa = nieuwHistC.filter(e => !isPlaatshouder(e, C.stoelId));
  const cVerwijderen = !cIsSlot && cEchteNa.length === 0;
  // Zit er op C vanaf de datum nog iemand? Zo niet, dan maken we een
  // waarnemer-stoel bovenaan leeg (zoals bij → Vast).
  const cNogBezet = cEchteNa.some(e => eind(e) >= (D || MIN));

  const stoelUpdates = {};
  stoelUpdates[S.stoelId] = {
    bezetting_historie: nieuwHistS,
    ...((stoelS.persoon_id === pidWeg && pidWeg) || persoonFallbackKey(stoelS.achternaam, stoelS.code) === S.sleutel
      ? { persoon_id: pidHouden } : {}),
  };
  if (!cVerwijderen) {
    const upd = { bezetting_historie: nieuwHistC };
    if (cIsSlot && !cNogBezet) Object.assign(upd, { code: '', voornaam: '', achternaam: '', actief: false, in_dienst: null, persoon_id: null });
    else if (stoelC.persoon_id && stoelC.persoon_id === pidWeg) upd.persoon_id = pidHouden;
    stoelUpdates[C.stoelId] = upd;
  }
  // Andere stoelen met het oude persoon-id (eerdere periodes van dezelfde persoon).
  if (pidWeg) {
    (state.radiologen || []).forEach(st => {
      if (st.id === S.stoelId || st.id === C.stoelId) return;
      const h = Array.isArray(st.bezetting_historie) ? st.bezetting_historie : [];
      const raak = h.some(e => e.persoon_id === pidWeg) || st.persoon_id === pidWeg;
      if (!raak) return;
      stoelUpdates[st.id] = {
        bezetting_historie: h.map(zetPid),
        ...(st.persoon_id === pidWeg ? { persoon_id: pidHouden } : {}),
      };
    });
  }

  const botsingen = dagen.filter(x => x.botsing);
  return {
    fout: null, soort: bev.soort,
    S: S.stoelId, C: C.stoelId, D, code: bev.code, achternaam: bev.achternaam,
    Svan: nieuwSvan, Coud: { van: C.van, tot: C.tot }, Cna: nieuwC, Soud: { van: S.van, tot: S.tot },
    cVerwijderen, cLeeg: cIsSlot && !cNogBezet,
    pidHouden, pidWeg,
    stoelUpdates, dagen, botsingen, tellingen, wensen, gebruikers,
    concepten,
  };
}

// Leesbare tekst van een veldwaarde (voor de botsingen-lijst).
export function veldTekst(v, kant) {
  const w = v[kant];
  if (v.soort === 'toew') return codesNaarTekst(w);
  if (v.soort === 'vak') return (kant === 'doel' && !v.doelHeeft) ? '' : 'V';
  if (v.soort === 'opm') return w ? String(w) : '';
  return '';
}
export const VELD_LABEL = { toew: 'Indeling', vak: 'Vakantie-V', opm: 'Opmerking', concept: 'Concept' };

// Vertaalt het plan + de keuzes per botsdag naar concrete schrijfopdrachten.
// keuzes = { datum: 'S' | 'C' } (ontbreekt = 'S', de stoel die blijft).
// Geeft { indeling: [{ datum, upd, herstel }], concept: [{ jaar, sleutel, nieuw, oud }] }.
// upd/herstel gebruiken WEG voor "veld verwijderen".
export function schrijfOpdrachten(plan, keuzes = {}) {
  const indeling = [];
  const concept = [];
  plan.dagen.forEach(x => {
    const dag = state.indelingMap[x.datum] || {};
    const keuze = keuzes[x.datum] === 'C' ? 'C' : 'S';
    // Wint de bron? Bron = C als we naar S schuiven, en andersom.
    const bronIsS = x.bron === plan.S;
    const bronWint = (keuze === 'S') === bronIsS;
    const upd = {}, herstel = {};
    const zet = (pad, nieuw, oud) => { upd[pad] = nieuw; herstel[pad] = (oud === undefined) ? WEG : oud; };
    let doelToewNa = (dag.toewijzingen || {})[x.doel];

    x.velden.forEach(v => {
      if (v.soort === 'toew') {
        const oudDoel = (dag.toewijzingen || {})[x.doel];
        const nemen = !v.doel || bronWint;
        if (nemen && !gelijk(v.bron, oudDoel)) { zet(`toewijzingen.${x.doel}`, v.bron, oudDoel); doelToewNa = v.bron; }
        zet(`toewijzingen.${x.bron}`, WEG, v.bron);
      } else if (v.soort === 'vak') {
        const vv = dag.vakantie_v || {};
        const nemen = !v.doelHeeft || bronWint;
        if (nemen && !(v.doelHeeft && gelijk(v.bron, v.doel))) zet(`vakantie_v.${x.doel}`, v.bron, v.doelHeeft ? vv[x.doel] : undefined);
        zet(`vakantie_v.${x.bron}`, WEG, v.bron);
      } else if (v.soort === 'opm') {
        const co = dag.cel_opmerkingen || {};
        const nemen = !v.doel || bronWint;
        if (nemen && v.bron !== v.doel) zet(`cel_opmerkingen.${x.doel}`, v.bron, co[x.doel]);
        zet(`cel_opmerkingen.${x.bron}`, WEG, v.bron);
      } else if (v.soort === 'dienst') {
        zet(`dienst.${v.slot}`, x.doel, x.bron);
      }
    });
    if (Object.keys(upd).length) indeling.push({ datum: x.datum, upd, herstel });

    // Concept: de cel van de bron schuift mee; "was" = wat er na het
    // samenvoegen in het rooster staat, zodat publiceren geen valse
    // "intussen gewijzigd"-melding geeft.
    const jaar = x.datum.slice(0, 4);
    const cellen = (plan.concepten && plan.concepten[jaar]) || {};
    const kB = `${x.datum}|${x.bron}`, kD = `${x.datum}|${x.doel}`;
    const cb = cellen[kB], cd = cellen[kD];
    const liveNa = codesNaarTekst(doelToewNa);
    const zetCel = (sleutel, nieuw) => {
      const oud = cellen[sleutel] || null;
      if (gelijk(oud, nieuw)) return;
      concept.push({ jaar, sleutel, nieuw, oud });
    };
    if (cb || cd) {
      let winnaar = cd || null;
      if (cb && (!cd || bronWint)) winnaar = cb;
      if (cb) zetCel(kB, null);
      if (winnaar) zetCel(kD, winnaar.nieuw === liveNa ? null : { ...winnaar, was: liveNa });
    }
    const kDi = `${x.datum}|_dienst`;
    const cDi = cellen[kDi];
    if (cDi && cDi.nieuw === x.bron) {
      const dienstNa = x.velden.some(v => v.soort === 'dienst' && v.slot === 'dag') ? x.doel : ((dag.dienst || {}).dag || '');
      zetCel(kDi, x.doel === dienstNa ? null : { ...cDi, nieuw: x.doel, was: String(dienstNa || '') });
    }
  });
  return { indeling, concept };
}

// Korte samenvatting van tellingen als tekst ("5 ingeplande dagen, 1 dienst").
export function tellingTekst(t) {
  const r = [];
  if (t.toew) r.push(`${t.toew} ingeplande dag${t.toew === 1 ? '' : 'en'}`);
  if (t.vak) r.push(`${t.vak} vakantie-V`);
  if (t.dienst) r.push(`${t.dienst} dienst${t.dienst === 1 ? '' : 'en'}`);
  if (t.opm) r.push(`${t.opm} opmerking${t.opm === 1 ? '' : 'en'}`);
  if (t.wensen) r.push(`${t.wensen} wens${t.wensen === 1 ? '' : 'en'}`);
  if (t.concept) r.push(`${t.concept} conceptcel${t.concept === 1 ? '' : 'len'}`);
  return r.join(', ');
}

// Wat staat er van deze persoon op een stoel (voor stap 1 van het venster)?
export function stoelOverzicht(periode) {
  const per = periodesVanStoel(periode.stoelId);
  const p = per.find(x => x.idx === periode.idx) || periode;
  const id = periode.stoelId;
  const dagenMet = [];
  let vak = 0, dienst = 0, opm = 0;
  Object.keys(state.indelingMap || {}).sort().forEach(d => {
    if (!hoortBij(per, p, d)) return;
    const dag = state.indelingMap[d];
    if (!isLeeg(dag.toewijzingen && dag.toewijzingen[id])) dagenMet.push(d);
    if (dag.vakantie_v && (id in dag.vakantie_v)) vak++;
    if (dag.cel_opmerkingen && dag.cel_opmerkingen[id]) opm++;
    const di = dag.dienst || {};
    ['dag', 'avond', 'nacht'].forEach(s => { if (di[s] === id) dienst++; });
  });
  const wensen = (state.wensen || []).filter(w => w.radioloog_id === id && w.datum && hoortBij(per, p, w.datum)).length;
  const accounts = (state.gebruikers || []).filter(g => g.radioloog_id === id).map(g => g.naam || g.email || g.id);
  return {
    stoelId: id, van: p.van, tot: p.tot, isSlot: SLOTS.includes(id),
    dagen: dagenMet.length, eerste: dagenMet[0] || null, laatste: dagenMet[dagenMet.length - 1] || null,
    vak, dienst, opm, wensen, accounts,
  };
}

// Bij Nieuwe stoel en → Vast: zit deze persoon op of na `datum` al op een
// andere stoel? Geeft de periode daar, of null.
export function zelfdePersoonElders({ pid = null, code, achternaam, datum, behalve = null }) {
  const sleutel = persoonFallbackKey(achternaam, code);
  const ik = { pid, sleutel, plaatshouder: !String(achternaam || '').trim() };
  for (const id of alleStoelIds()) {
    if (id === behalve) continue;
    const hit = periodesVanStoel(id).find(p => zelfdePersoon(ik, p) && eind(p) >= (datum || MIN));
    if (hit) return hit;
  }
  return null;
}
