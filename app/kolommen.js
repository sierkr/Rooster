// Kolommen en hulpkolommen van een jaarindeling — v3.36.0.
//
// Tot v3.35 stond dit midden in de Excel-export (export.js). Sinds het
// tabblad Indelen (v3.36.0) gebruiken twee schermen precies dezelfde
// kolommen en dezelfde tellingen: de export en het indeelraster. Daarom staat
// het hier, één keer. Wijzig je iets aan de kolomvolgorde of de normen, dan
// verandert het in Excel én in het raster tegelijk — zo kunnen die twee nooit
// stilletjes uit elkaar gaan lopen.
//
// Geen afhankelijkheid op DOM of Firebase (wel op de app-state), zodat de
// unit-tests het rechtstreeks kunnen controleren.
import { state, SLOTS } from './state.js';
import {
  functieFlags, hoofdLetterCode, vandaagIso, huidigKalenderJaar,
  bezettingOpDatum, bezettingenInRange, alleVasteStoelIds,
  senioriteitSortKey, vasteIdxVoorStoel, vergelijkOpSenioriteit,
} from './helpers.js';

// ---- Kolommen (vaste stoelen + waarnemers), datum-bewust op senioriteit -----
// Kolomvolgorde en kolomkop identiek aan hoe de app dit toont (Overzicht/
// Afdeling): gesorteerd op de in_dienst-datum van de HUIDIGE bezetter, met
// de waarnemer-slots (W5..W1) vast na de vaste stoelen. Een stoel/slot
// krijgt een kolom zodra hij in dit jaar minstens één bezetter heeft gehad
// — ook als die inmiddels via "→ Vast" is doorgeschoven.
//
// `dagen` = de roosterdagen van dat jaar (voor het round-trip-vangnet).
// Geeft een lijst { id, isSlot, idx, sortKey, code, notitie, bezetters, header }.
export function jaarKolommen(jaar, dagen) {
  const jaarStart = `${jaar}-01-01`;
  const jaarEind  = `${jaar}-12-31`;
  const REFDATUM  = (String(jaar) === String(huidigKalenderJaar())) ? vandaagIso() : jaarEind;

  const kandidaten = [...alleVasteStoelIds(), ...SLOTS];
  const kolomEntries = kandidaten
      .map(id => {
        const bezetters = bezettingenInRange(id, jaarStart, jaarEind);
        if (bezetters.length === 0) return null; // niet bezet dit jaar → geen kolom
        const huidig  = bezettingOpDatum(id, REFDATUM);
        const laatste = bezetters[bezetters.length - 1];
        const bez     = huidig || laatste;
        const isSlot  = SLOTS.includes(id);
        // Zelfde senioriteits-formule als Overzicht/Afdeling (helpers.js) —
        // niet hier opnieuw uitgeschreven, om te voorkomen dat de
        // kolomvolgorde ooit stilzwijgend afwijkt van de app.
        const sortKey = senioriteitSortKey(id, bez?.in_dienst);
        const idx     = vasteIdxVoorStoel(id);
        let notitie = null;
        if (bezetters.length > 1) {
          notitie = 'Bezetters in ' + jaar + ':\n' + bezetters.map(b => {
            const van = b.van ? b.van.split('-').reverse().join('-') : 'begin';
            const tot = b.tot ? b.tot.split('-').reverse().join('-') : 'heden';
            return `${b.code || id} · ${b.achternaam || ''} (${van} – ${tot})`;
          }).join('\n');
        }
        return { id, isSlot, idx, sortKey, code: bez?.code || id, notitie, bezetters };
      })
      .filter(Boolean);

  // Round-trip-vangnet: neem ook stoelen op die dit jaar een NIET-lege
  // toewijzing hebben maar (nog) geen bezetter/kolom kregen. Zonder dit zou de
  // export die stille data laten vallen en een verse re-import "wijzigingen"
  // tonen (Firestore heeft de cel, Excel niet). Kolomkop = laatst bekende code
  // of het stoel-id.
  const reedsKolom = new Set(kolomEntries.map(e => e.id));
  const extraIds = new Set();
  (dagen || []).forEach(dag => {
    const tw = dag && dag.toewijzingen;
    if (!tw) return;
    Object.keys(tw).forEach(id => {
      if (reedsKolom.has(id) || extraIds.has(id)) return;
      const v = tw[id];
      const nietLeeg = Array.isArray(v) ? v.length > 0 : !!v;
      if (nietLeeg) extraIds.add(id);
    });
  });
  extraIds.forEach(id => {
    const stoel = (state.radiologen || []).find(r => r.id === id);
    kolomEntries.push({
      id, isSlot: SLOTS.includes(id), idx: vasteIdxVoorStoel(id),
      sortKey: senioriteitSortKey(id, null), code: (stoel && stoel.code) || id,
      notitie: null, bezetters: [],
    });
  });

  // Vaste stoelen eerst (op senioriteit, via dezelfde canonieke functie als
  // Overzicht/Afdeling), waarnemer-slots daarna (vaste W5..W1-volgorde).
  kolomEntries.sort((a, b) => {
    if (a.isSlot !== b.isSlot) return a.isSlot ? 1 : -1;
    if (a.isSlot && b.isSlot) return SLOTS.indexOf(a.id) - SLOTS.indexOf(b.id);
    return vergelijkOpSenioriteit(a, b);
  });

  // Kolomkop-strings uniek maken (zeldzaam randgeval: twee kolommen met
  // toevallig dezelfde code) zodat er nooit twee kolommen op dezelfde header
  // samenvallen.
  const gebruikteHeaders = new Set();
  kolomEntries.forEach(e => {
    let header = e.code || e.id;
    if (gebruikteHeaders.has(header)) header = `${header} (${e.id})`;
    gebruikteHeaders.add(header);
    e.header = header;
  });

  return kolomEntries;
}

// ---- Normen per functie (regel-/functie-afgeleid) ---------------------------
// Basis voor de kolom "Aantal" en de functie-indicatoren (welke functie op een
// dag nog ontbreekt). Uit de app-instellingen op het moment van aanroepen.
export const DAGNR = { ma: 1, di: 2, wo: 3, do: 4, vr: 5, za: 6, zo: 7 };

export function functieEisen() {
  const functiesActief  = (state.functies || []);
  const actieveRegels   = (state.validatieRegels || []).filter(r => r.actief !== false);
  const bezettingRegels = actieveRegels.filter(r => r.type === 'bezetting');

  // "Aantal" = werkvloerbezetting: alle codes met werkvloer-vlag in de app.
  const werkvloerUniek = [...new Set(
    functiesActief
      .filter(f => functieFlags(f.code || f.id).werkvloer)
      .map(f => hoofdLetterCode(f.code || f.id))
      .filter(Boolean)
  )];

  // Vereist aantal per code per weekdag (1..7), als basis voor de
  // indicator-kolommen. Bronnen, gecombineerd via max:
  //  - verplicht-vlag  → ≥1 op werkdagen
  //  - bezetting-regel → aantal op die weekdag
  //  - werkvloer-vlag  → ≥1 op werkdagen (per-dag-monitor: toon wat ontbreekt)
  const reqByCode = {};
  const ensureReq = (code) => (reqByCode[code] = reqByCode[code] || [0, 0, 0, 0, 0, 0, 0, 0]);
  const verplichteCodes = functiesActief.filter(f => f.verplicht === true)
    .map(f => hoofdLetterCode(f.code || f.id)).filter(Boolean);
  verplichteCodes.forEach(code => { const a = ensureReq(code); for (let d = 1; d <= 5; d++) a[d] = Math.max(a[d], 1); });
  bezettingRegels.forEach(r => {
    const code = hoofdLetterCode(r.code || '');
    const dn = DAGNR[r.dag];
    const aantal = Number(r.aantal) || 0;
    if (code && dn && aantal > 0) { const a = ensureReq(code); a[dn] = Math.max(a[dn], aantal); }
  });
  // Werkvloer-functies als per-dag-monitor (≥1 op werkdagen).
  werkvloerUniek.forEach(code => { const a = ensureReq(code); for (let d = 1; d <= 5; d++) a[d] = Math.max(a[d], 1); });

  // "Strikte" codes = de échte app-criteria (verplicht + bezetting-regels).
  // Alleen déze laten de datum/Aantal rood worden; werkvloer-only codes dienen
  // als overzicht (rode letter in hun eigen indicator-kolom als ze ontbreken),
  // zodat een normale dag zonder bv. Mammo niet meteen de hele datum rood maakt.
  const strictCodes = new Set([
    ...verplichteCodes,
    ...bezettingRegels.map(r => hoofdLetterCode(r.code || '')).filter(Boolean),
  ]);

  // Indicator-kolommen: elke code met een eis (verplicht, regel én/of werkvloer).
  const functieLetters = Object.keys(reqByCode).sort();

  return {
    functiesActief, bezettingRegels, werkvloerUniek, reqByCode,
    verplichteCodes, strictCodes, functieLetters,
  };
}

// ---- Tellen zoals de Excel-formule ------------------------------------------
// Precies de regel uit de Excel-export (telLetterFormule): een cel telt mee
// voor letter L als de héle cel L is, of als hij met L begint, of met ".L",
// of met een cijfer gevolgd door L. Hoofdletterongevoelig. Bij een gesplitste
// dag ("E,M") telt dus alleen de eerste code — net als in Excel. Zo staan in
// het raster dezelfde getallen als in het Excel-bestand van de indeler.
export function celTeltVoor(celTekst, letter) {
  const s = String(celTekst || '').toUpperCase();
  const l = String(letter || '').toUpperCase();
  if (!s || !l) return false;
  if (s === l) return true;
  if (s.charAt(0) === l) return true;
  if (s.charAt(0) === '.' && s.charAt(1) === l) return true;
  if (/^[0-9]$/.test(s.charAt(0)) && s.charAt(1) === l) return true;
  return false;
}

// Weekdagnummer 1 (ma) .. 7 (zo), zoals WEEKDAY(…;2) in Excel.
export function weekdagNr(datum) {
  const d = new Date(datum + 'T12:00:00');
  return d.getDay() === 0 ? 7 : d.getDay();
}

// Hulpkolommen voor één dag. `celTeksten` = de tekst van elke radioloogcel op
// die rij ("B", "E,M", ""), `eisen` = uitkomst van functieEisen().
// Geeft { aantal, ontbrekend: [letters], tekort: bool, werkdag: bool }.
//  - aantal     = werkvloerbezetting (kolom "Aantal" in Excel)
//  - ontbrekend = de functie-indicatoren die in Excel een letter tonen
//  - tekort     = een strikte norm wordt niet gehaald (datum/Aantal rood)
export function hulpKolommen(datum, celTeksten, eisen) {
  const dn = weekdagNr(datum);
  const werkdag = dn < 6;
  const tel = (letter) => (celTeksten || []).filter(t => celTeltVoor(t, letter)).length;
  const aantal = eisen.werkvloerUniek.reduce((som, l) => som + tel(l), 0);
  const ontbrekend = eisen.functieLetters.filter(l => tel(l) < (eisen.reqByCode[l][dn] || 0));
  const tekort = werkdag && ontbrekend.some(l => eisen.strictCodes.has(l));
  return { aantal, ontbrekend, tekort, werkdag };
}
