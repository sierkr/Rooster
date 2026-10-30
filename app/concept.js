// Het concept van het tabblad Indelen — rekenwerk (v3.36.0).
//
// Een concept is een lijst cellen die de indeler heeft veranderd maar nog niet
// heeft gepubliceerd. Het staat in de databank (indeling_concept/{jaar}),
// zodat hij morgen, of op een andere pc, verder kan. Radiologen zien het niet:
// alleen een beheerder mag het lezen (firestore.rules).
//
// Per cel bewaren we twee dingen:
//   nieuw — wat de indeler intypte ("B", "E,M", "" = leeg gemaakt)
//   was   — wat er in het rooster stond toen hij de cel voor het eerst
//           veranderde. Wijkt het rooster bij het publiceren daarvan af, dan
//           heeft iemand anders de cel intussen gewijzigd; dat melden we.
// Typt hij de oude waarde terug, dan verdwijnt de cel uit het concept.
//
// Bij het publiceren gaan ALLEEN de veranderde cellen naar het rooster. De
// rest van de dag blijft zoals hij in het rooster staat. Een publicatie kan
// dus nooit per ongeluk een heel jaar leegmaken (anders dan een import, die
// bewust "Excel = waarheid" is).
//
// Geen afhankelijkheid op DOM of Firebase, zodat de unit-tests dit
// rechtstreeks kunnen controleren.
import { state, DAGEN_NL } from './state.js';
import { isoWeekVan } from './helpers.js';

// De drie kolommen rechts van de radiologen, zoals in Excel (P, Q, R).
// De id's beginnen met '_' zodat ze nooit samenvallen met een stoel-id
// (stoel "P" bestaat namelijk ook).
export const EXTRA_KOLOMMEN = [
  { id: '_dienst', header: 'P', titel: 'Dienst' },
  { id: '_bespr',  header: 'Q', titel: 'Bespreking' },
  { id: '_interv', header: 'R', titel: 'Interventie' },
];
const EXTRA_IDS = new Set(EXTRA_KOLOMMEN.map(k => k.id));
export function isExtraKolom(kolomId) { return EXTRA_IDS.has(kolomId); }

export function celSleutel(datum, kolomId) { return `${datum}|${kolomId}`; }
export function splitsSleutel(sleutel) {
  const i = String(sleutel).indexOf('|');
  return { datum: sleutel.slice(0, i), kolomId: sleutel.slice(i + 1) };
}

// ---- Tekst ↔ codes ------------------------------------------------------------
// In het raster staat een cel als tekst, net als in Excel: "B", of "E,M" voor
// ochtend/middag. Bij het intypen mag ook "E/M", "E;M" of "E M"; dat wordt
// "E,M". Hoofdletters blijven zoals getypt (er bestaan kleine codes als "bo").
export function codesNaarTekst(codes) {
  if (Array.isArray(codes)) return codes.filter(Boolean).join(',');
  return codes ? String(codes) : '';
}

export function tekstNaarCodes(tekst) {
  return String(tekst || '').split(/[,/;\s]+/).map(x => x.trim()).filter(Boolean);
}

export function normaliseer(tekst, kolomId) {
  if (isExtraKolom(kolomId)) return String(tekst || '').trim();
  return tekstNaarCodes(tekst).join(',');
}

// Wat er nu in het rooster staat (als tekst).
export function liveTekst(dag, kolomId) {
  if (!dag) return '';
  if (kolomId === '_dienst') return dag.dienst?.dag ? String(dag.dienst.dag) : '';
  if (kolomId === '_bespr')  return dag.bespreking ? String(dag.bespreking) : '';
  if (kolomId === '_interv') return dag.interventie ? String(dag.interventie) : '';
  return codesNaarTekst(dag.toewijzingen?.[kolomId]);
}

// Wat het raster toont: het concept als de cel erin staat, anders het rooster.
export function zichtbareTekst(concept, indelingMap, datum, kolomId) {
  const c = concept[celSleutel(datum, kolomId)];
  if (c) return c.nieuw;
  return liveTekst(indelingMap[datum], kolomId);
}

// Eén invoer verwerken. Geeft { sleutel, voor, na } terug; `na` = null
// betekent: de cel gaat uit het concept (hij is weer gelijk aan het rooster).
// `voor` is de vorige concept-regel (of null) — nodig voor ongedaan maken.
export function conceptNaInvoer(concept, indelingMap, datum, kolomId, invoer) {
  const sleutel = celSleutel(datum, kolomId);
  const tekst = normaliseer(invoer, kolomId);
  const voor = concept[sleutel] || null;
  const was = voor ? voor.was : liveTekst(indelingMap[datum], kolomId);
  const na = (tekst === was) ? null : { nieuw: tekst, was };
  return { sleutel, voor, na };
}

// ---- Rooster met het concept erover heen ---------------------------------------
// Bouwt de dag zoals hij na publiceren zou zijn, in het formaat van de import
// (zodat dezelfde schrijfweg hem kan wegschrijven). Velden die het concept niet
// raakt — opmerkingen, vakantieplanning, avond- en nachtdienst — komen er niet
// in en blijven dus staan zoals ze in het rooster staan.
export function dagMetConcept(datum, liveDag, conceptCellen) {
  const toewijzingen = {};
  Object.entries(liveDag?.toewijzingen || {}).forEach(([k, v]) => {
    const codes = Array.isArray(v) ? v.filter(Boolean) : (v ? [String(v)] : []);
    if (codes.length) toewijzingen[k] = codes;
  });
  let dienst      = liveTekst(liveDag, '_dienst');
  let bespreking  = liveTekst(liveDag, '_bespr');
  let interventie = liveTekst(liveDag, '_interv');

  (conceptCellen || []).forEach(({ kolomId, nieuw }) => {
    if (kolomId === '_dienst')      dienst = nieuw;
    else if (kolomId === '_bespr')  bespreking = nieuw;
    else if (kolomId === '_interv') interventie = nieuw;
    else {
      const codes = tekstNaarCodes(nieuw);
      if (codes.length) toewijzingen[kolomId] = codes;
      else delete toewijzingen[kolomId];
    }
  });

  const d = new Date(datum + 'T12:00:00');
  return {
    datum,
    weeknr: isoWeekVan(datum),
    dag: DAGEN_NL[d.getDay() === 0 ? 6 : d.getDay() - 1],
    toewijzingen,
    dienst: dienst ? { dag: dienst } : {},
    bespreking: bespreking || null,
    interventie: interventie || null,
  };
}

// Groepeert het concept per datum: { datum: [{ sleutel, kolomId, nieuw, was }] }
export function conceptPerDatum(concept) {
  const per = {};
  Object.entries(concept || {}).forEach(([sleutel, c]) => {
    if (!c) return;
    const { datum, kolomId } = splitsSleutel(sleutel);
    (per[datum] = per[datum] || []).push({ sleutel, kolomId, nieuw: c.nieuw, was: c.was });
  });
  return per;
}

// Kopie van de indelingMap met het concept erover heen — voor de regelcontrole
// in het raster (die leest state.indelingMap).
export function indelingMetConcept(concept, indelingMap) {
  const map = { ...indelingMap };
  Object.entries(conceptPerDatum(concept)).forEach(([datum, cellen]) => {
    const live = indelingMap[datum];
    map[datum] = { ...(live || {}), ...dagMetConcept(datum, live, cellen) };
  });
  return map;
}

// Voert fn uit terwijl state.indelingMap tijdelijk `map` is. De regelcontrole
// (validatie.js) leest de state; zo controleert hij het rooster mét concept,
// zonder een tweede kopie van de regels. fn moet synchroon zijn.
export function metIndelingMap(map, fn) {
  const oud = state.indelingMap;
  state.indelingMap = map;
  try { return fn(); } finally { state.indelingMap = oud; }
}

// ---- Publiceren ---------------------------------------------------------------
// Zet het concept om in wat er gepubliceerd wordt.
// `vandaag` en `grens` begrenzen "binnen 30 dagen" (dan krijgt de radioloog een
// melding). Geeft:
//   dagen        — de dagen in import-formaat (alleen dagen met een echte wijziging)
//   cellen       — elke cel die echt verandert: { datum, kolomId, rooster, nieuw, was }
//   intussen     — de cellen uit `cellen` waarvan het rooster sinds het
//                  concept is veranderd (rooster ≠ was)
//   nabij        — aantal radioloogcellen binnen [vandaag, grens]
//   nabijeDagen  — aantal dagen daarvan
//   opruimen     — alle concept-sleutels die na het publiceren weg mogen,
//                  met de waarde die gepubliceerd is ({ sleutel: nieuw })
export function bouwPublicatie(concept, indelingMap, vandaag, grens) {
  const per = conceptPerDatum(concept);
  const dagen = [];
  const cellen = [];
  const intussen = [];
  const opruimen = {};
  let nabij = 0;
  const nabijeDagen = new Set();

  Object.keys(per).sort().forEach(datum => {
    const live = indelingMap[datum];
    const echt = [];
    per[datum].forEach(c => {
      opruimen[c.sleutel] = c.nieuw;
      const rooster = liveTekst(live, c.kolomId);
      if (rooster === c.nieuw) return; // staat er al zo — niets te doen
      const cel = { datum, kolomId: c.kolomId, rooster, nieuw: c.nieuw, was: c.was };
      echt.push(c);
      cellen.push(cel);
      if (rooster !== c.was) intussen.push(cel);
      if (!isExtraKolom(c.kolomId) && datum >= vandaag && datum <= grens) {
        nabij++;
        nabijeDagen.add(datum);
      }
    });
    if (echt.length) dagen.push(dagMetConcept(datum, live, per[datum]));
  });

  return { dagen, cellen, intussen, nabij, nabijeDagen: nabijeDagen.size, opruimen };
}

// ---- Plakken --------------------------------------------------------------------
// Tekst van het klembord (uit Excel of uit het raster zelf) → rijen × kolommen.
// Excel zet tabs tussen de cellen en een regeleinde na elke rij (ook na de
// laatste). Aanhalingstekens rond een cel (Excel doet dat bij een regeleinde
// in de cel) halen we weg.
export function leesKlembord(tekst) {
  let regels = String(tekst || '').replace(/\r\n?/g, '\n').split('\n');
  if (regels.length > 1 && regels[regels.length - 1] === '') regels = regels.slice(0, -1);
  return regels.map(r => r.split('\t').map(c => {
    const t = c.trim();
    return (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) ? t.slice(1, -1).replace(/""/g, '"').trim() : t;
  }));
}

export function maakKlembord(rijen) {
  return rijen.map(r => r.join('\t')).join('\n');
}
