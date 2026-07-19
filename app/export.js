// Excel-export: lees Firestore-indeling voor een gekozen jaar en schrijf een .xlsx
// met volledige opmaak + formules via ExcelJS:
//
//  Kolommen A–S  : data (identiek aan import-formaat)
//  Kolom  T      : Aantal — werkvloerbezetting per dag (formule)
//  Kolom  U      : leeg (spacer)
//  Kolommen V–AA : W B E M D O — toont de letter als die functie nog NIET bezet is (formule)
//
//  Conditionele opmaak:
//   - Kolom B (datum) rood als bezetting < norm (5 op ma-do, 4 op vr)
//   - Kolom T (Aantal) groen ≥5, oranje =4, rood <4
//   - Radioloog-cellen C–O lichtgeel bij V of K (afwezigheid)
//
//  Overig:
//   - Kleurcodering per functiecode (uit state.functies + fallback)
//   - Weekend-rijen lichtgrijs
//   - Header donkerblauw + vet
//   - Bevroren rij 1 + kolommen A+B
//   - Kolombreedte passend bij origineel
//   - Cel-opmerkingen als Excel notes

import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';
import { state, HOOFD_FUNCTIES, SLOTS } from './state.js';
import { IMPORT_SHEET, IMPORT_KOL_DIENST, IMPORT_KOL_BESPR, IMPORT_KOL_INTERV, IMPORT_KOL_OPM } from './import.js';
import {
  isHoofd, functieFlags, hoofdLetterCode, plusDagen, vandaagIso, huidigKalenderJaar,
  bezettingOpDatum, bezettingenInRange, alleVasteStoelIds,
  senioriteitSortKey, vasteIdxVoorStoel, vergelijkOpSenioriteit,
} from './helpers.js';

// ---- Kleuren per hoofdletter-functiecode ------------------------------------
const FALLBACK_KLEUREN = {
  W: 'DCE6F1', B: 'E2EFDA', E: 'FFF2CC', M: 'FCE4D6',
  D: 'EDE9F8', O: 'D9EAD3', S: 'FCE4D6', A: 'F4F4F4',
  R: 'FAFAFA', V: 'FFFFC0', Z: 'FFE0B2', K: 'E8F0FE',
  T: 'F3E5F5', X: 'FFEBEE', Q: 'E0F7FA',
};

function bouwKleurenMap() {
  const map = { ...FALLBACK_KLEUREN };
  (state.functies || []).forEach(f => {
    const code = hoofdLetterCode(f.code || f.id);
    if (code && f.kleur) map[code] = f.kleur.replace('#', '');
  });
  return map;
}

function tekstArgb(hex6) {
  const r = parseInt(hex6.slice(0,2), 16);
  const g = parseInt(hex6.slice(2,4), 16);
  const b = parseInt(hex6.slice(4,6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? 'FF1A1A18' : 'FFFFFFFF';
}

// ---- Formule-helpers --------------------------------------------------------
// Bouw een SUMPRODUCT-formule die telt hoeveel cellen in `range` de hoofdletter
// `letter` hebben. Werkt voor codes zoals W, .WB, 5W, YYW1 etc.
function telLetterFormule(letter, range) {
  const l = letter.toUpperCase();
  return (
    `SUMPRODUCT(` +
    `((UPPER(${range})="${l}")+` +
    `(UPPER(LEFT(${range},1))="${l}")+` +
    `((UPPER(LEFT(${range},1))=".")*(UPPER(MID(${range},2,1))="${l}"))+` +
    `((ISNUMBER(VALUE(LEFT(${range},1))))*(UPPER(MID(${range},2,1))="${l}"))>0)*1)`
  );
}

// Formule voor kolom Aantal (werkvloerbezetting): som over alle rad-kolommen per rij
// eindKol = Excel-kolomletter van de laatste radioloogkolom (bijv. 'O' bij 13 rads)
function aantalFormule(rij, letters, eindKol) {
  const range = `C${rij}:${eindKol}${rij}`;
  if (!letters || letters.length === 0) return '=0';
  return '=' + letters.map(l => telLetterFormule(l, range)).join('+');
}

// Formule voor functie-indicatoren: toon letter als die functie NIET aanwezig is
function ontbrekendFormule(letter, rij, eindKol) {
  const range = `C${rij}:${eindKol}${rij}`;
  return `=IF(${telLetterFormule(letter, range)}=0,"${letter}","")`;
}

// Bouwt een Excel-uitdrukking die voor de datum in cel B{rij} het VEREISTE aantal
// van een code teruggeeft, op basis van de regels (per weekdag). reqPerDag is een
// array met index 1..7 (ma..zo). Dagen zonder eis → 0. Zo volgt de norm exact de
// in de app ingestelde bezetting-regels (en verplicht-vlaggen).
function vereistExpr(reqPerDag, bcel) {
  let expr = '0';
  for (let d = 7; d >= 1; d--) {
    const v = reqPerDag[d] || 0;
    if (v > 0) expr = `IF(WEEKDAY(${bcel},2)=${d},${v},${expr})`;
  }
  return expr;
}

// Indicator-formule: toon de code zolang er op die dag een TEKORT is t.o.v. de
// vereiste (regel-gedreven) bezetting. Leeg als de eis gehaald wordt of er geen
// eis geldt voor die weekdag.
function indicatorFormule(code, reqPerDag, rij, eindKol) {
  const range = `C${rij}:${eindKol}${rij}`;
  const req = vereistExpr(reqPerDag, `B${rij}`);
  return `=IF(${telLetterFormule(code, range)}<${req},"${code}","")`;
}

// Converteert 1-based kolomnummer naar Excel-letter (bijv. 20 → 'T')
function kolLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ---- ExcelJS laden ----------------------------------------------------------
// v3.30.0 (M3): vendor-first laden. Staat er een lokale kopie in vendor/
// (zie DEPLOY-FASE3.md), dan wordt die gebruikt — geen CDN-afhankelijkheid,
// werkt offline en is immuun voor CDN-compromittering. Ontbreekt de lokale
// kopie, dan valt de loader terug op het (versie-gepinde) CDN.
let _excelJsPromise = null;
function laadExcelJS() {
  if (_excelJsPromise) return _excelJsPromise;
  _excelJsPromise = new Promise((resolve, reject) => {
    if (window.ExcelJS) return resolve(window.ExcelJS);
    const laad = (src, opFout) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(window.ExcelJS);
      s.onerror = opFout;
      document.head.appendChild(s);
    };
    laad('vendor/exceljs.min.js', () => {
      laad('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
        () => reject(new Error('Kon ExcelJS niet laden (offline en geen lokale vendor-kopie?).')));
    });
  });
  return _excelJsPromise;
}

function downloadBlob(buffer, bestandsnaam) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = bestandsnaam;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}


// ---- Activiteit-sheet -------------------------------------------------------
// Tweede worksheet "Activiteit" met formules die verwijzen naar het hoofdblad.
// Rijen = functies / weekdagen / aggregaten; kolommen = radiologen.
function voegActiviteitSheetToe(wb, mainSheetNaam, radKolommen, dynKolomMap, COL_DIENST, dataEindRij) {
  const ws = wb.addWorksheet('Activiteit');
  const n  = radKolommen.length;
  const totaalKol = n + 2; // label + n rads + gem

  ws.columns = [
    { width: 24 },
    ...radKolommen.map(() => ({ width: 7 })),
    { width: 8 },
  ];

  // Kolomletters in het hoofdblad
  const mainRadKols    = radKolommen.map((_, i) => kolLetter(3 + i));
  const mainDienstKol  = kolLetter(COL_DIENST);
  const eindRij        = dataEindRij;

  // Helper: SUMPRODUCT-check of een cel de hoofdletter `l` bevat
  function bevatLetterCheck(letter, range) {
    const l = letter.toUpperCase();
    return (
      `(((${range}="${l}")` +
      `+(LEFT(${range},1)="${l}")` +
      `+((LEFT(${range},1)=".")*(MID(${range},2,1)="${l}"))` +
      `+((ISNUMBER(VALUE(LEFT(${range},1))))*(MID(${range},2,1)="${l}")))>0)`
    );
  }

  // Formule: tel hoofd-letter in hoofdblad-kolom
  function telHoofdFormule(letter, mainKol) {
    const rng = `${mainSheetNaam}!${mainKol}$2:${mainKol}$${eindRij}`;
    return `=SUMPRODUCT(${bevatLetterCheck(letter, rng)})`;
  }

  // Formule: exacte variant-code tellen (bijv. ".WB")
  function telVariantFormule(code, mainKol) {
    const rng = `${mainSheetNaam}!${mainKol}$2:${mainKol}$${eindRij}`;
    return `=COUNTIF(${rng},"${code}")`;
  }

  // Werkvloer-codes (voor weekdag-formule)
  const werkCodes = (state.functies || [])
    .filter(f => functieFlags(f.code || f.id).werkvloer)
    .map(f => (f.code || f.id).toUpperCase());

  // Formule: werkvloer-aanwezigheid op weekdag (1=ma … 5=vr)
  function weekdagFormule(dagNr, mainKol) {
    if (werkCodes.length === 0) return '=0';
    const datRng = `${mainSheetNaam}!$B$2:$B$${eindRij}`;
    const celRng = `${mainSheetNaam}!${mainKol}$2:${mainKol}$${eindRij}`;
    const checks = werkCodes.map(c => bevatLetterCheck(c, celRng)).join('+');
    return (
      `=SUMPRODUCT(` +
      `(WEEKDAY(${datRng},2)=${dagNr})` +
      `*(WEEKDAY(${datRng},2)<6)` +
      `*(${checks}>0)*1)`
    );
  }

  // Formule: dienst-teller (COUNTIF op slotId in dienst-kolom)
  function dienstFormule(mainKol, slotId) {
    const rng = `${mainSheetNaam}!${mainDienstKol}$2:${mainDienstKol}$${eindRij}`;
    return `=COUNTIF(${rng},"${slotId}")`;
  }

  // Gemiddelde-formule voor huidige rij
  function gemFormule(huidigeRij) {
    return `=IFERROR(AVERAGE(${kolLetter(2)}${huidigeRij}:${kolLetter(n+1)}${huidigeRij}),0)`;
  }

  // SOM van specifieke rijen in dit sheet (voor aggregaten)
  function aggrSomFormule(rijNrs, kolIdx) {
    const kol  = kolLetter(kolIdx);
    const refs = rijNrs.map(r => `${kol}${r}`);
    return `=SUM(${refs.join(',')})`;
  }

  // ---- Stijlen ----------------------------------------------------------------
  const BLAUW_F  = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1F3863' } };
  const BLAUW_FO = { bold:true, color:{ argb:'FFFFFFFF' }, size:10 };
  const GEM_F    = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF2F5496' } };
  const SECT_F   = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD6E4F0' } };
  const SECT_FO  = { bold:true, size:10 };
  const AGGR_F   = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFEBF2FC' } };
  const AGGR_FO  = { bold:true, size:10 };

  let rij = 1;

  // Header-rij
  {
    const r = ws.getRow(rij); r.height = 18;
    const lc = r.getCell(1);
    lc.value = 'Functie'; lc.fill = BLAUW_F; lc.font = BLAUW_FO;
    radKolommen.forEach((k, i) => {
      const c = r.getCell(2 + i);
      c.value = k; c.fill = BLAUW_F; c.font = BLAUW_FO;
      c.alignment = { horizontal:'center' };
    });
    const gc = r.getCell(n + 2);
    gc.value = 'Gem'; gc.fill = GEM_F; gc.font = BLAUW_FO;
    gc.alignment = { horizontal:'center' };
    rij++;
  }

  // Sectie-kop
  function schrijfSectie(label) {
    const r = ws.getRow(rij); r.height = 15;
    for (let c = 1; c <= totaalKol; c++) r.getCell(c).fill = SECT_F;
    r.getCell(1).value = label; r.getCell(1).font = SECT_FO;
    ws.mergeCells(rij, 1, rij, totaalKol);
    rij++;
  }

  // Data-rij (formule per radioloog-kolom)
  function schrijfRij(label, formFn, opties = {}) {
    const r = ws.getRow(rij); r.height = 14;
    const lc = r.getCell(1);
    lc.value = opties.variant ? '   ' + label : label;
    if (opties.aggr)    { lc.fill = AGGR_F; lc.font = AGGR_FO; }
    if (opties.variant) { lc.font = { italic:true, size:9, color:{ argb:'FF5F5E5A' } }; }

    radKolommen.forEach((k, i) => {
      const c = r.getCell(2 + i);
      c.value = { formula: formFn(mainRadKols[i], dynKolomMap[k]) };
      c.alignment = { horizontal:'center' };
      if (opties.aggr)    c.fill = AGGR_F;
      if (opties.variant) c.font = { italic:true, size:9, color:{ argb:'FF5F5E5A' } };
    });

    const gc = r.getCell(n + 2);
    gc.value = { formula: gemFormule(rij) };
    gc.alignment = { horizontal:'center' };
    if (opties.aggr) gc.fill = AGGR_F;

    const thisRij = rij; rij++; return thisRij;
  }

  // Aggregaat-rij via SUM van specifieke rijen in dit sheet
  function schrijfAggrRij(label, rijNrs) {
    const r = ws.getRow(rij); r.height = 14;
    r.getCell(1).value = label;
    r.getCell(1).fill = AGGR_F; r.getCell(1).font = AGGR_FO;
    for (let i = 0; i < n; i++) {
      const c = r.getCell(2 + i);
      c.value = { formula: aggrSomFormule(rijNrs, 2 + i) };
      c.alignment = { horizontal:'center' };
      c.fill = AGGR_F;
    }
    const gc = r.getCell(n + 2);
    gc.value = { formula: gemFormule(rij) };
    gc.alignment = { horizontal:'center' };
    gc.fill = AGGR_F;
    const thisRij = rij; rij++; return thisRij;
  }

  // ==== Sectie 1: Functie-aantallen ==========================================
  schrijfSectie('Functie-aantallen');

  const hoofdRijNrs = {}; // letter → rijnummer in dit sheet
  HOOFD_FUNCTIES.forEach(hoofd => {
    const rn = schrijfRij(
      `${hoofd.letter}  ·  ${hoofd.label}`,
      (mainKol) => telHoofdFormule(hoofd.letter, mainKol)
    );
    hoofdRijNrs[hoofd.letter] = rn;

    // Varianten (ingesprongen, kleinere tekst)
    hoofd.varianten.forEach(v => {
      schrijfRij(v, (mainKol) => telVariantFormule(v, mainKol), { variant: true });
    });
  });

  // ==== Sectie 2: Aanwezigheid per weekdag ===================================
  schrijfSectie('Aanwezigheid per weekdag (werkvloer)');
  [
    { label:'maandag',   dag:1 },
    { label:'dinsdag',   dag:2 },
    { label:'woensdag',  dag:3 },
    { label:'donderdag', dag:4 },
    { label:'vrijdag',   dag:5 },
  ].forEach(({ label, dag }) => {
    schrijfRij(label, (mainKol) => weekdagFormule(dag, mainKol));
  });

  // ==== Sectie 3: Samenvatting ===============================================
  schrijfSectie('Samenvatting');

  // Dienst (COUNTIF op slotId in dienst-kolom)
  schrijfRij('Dienst', dienstFormule);

  // Werkvloer = SOM van functies met werkvloer-vlag
  const werkRijen = Object.entries(hoofdRijNrs)
    .filter(([letter]) => functieFlags(letter).werkvloer)
    .map(([, rn]) => rn);
  const werkvloerRij = schrijfAggrRij('Werkvloer', werkRijen);

  // Maatschapsdagen = SOM van codes die in MTSDAGEN_CODES zitten
  const mtsCodes = window.MTSDAGEN_CODES || ['W','B','E','M','D','O','S','A','Z','T','X'];
  const mtsRijen = Object.entries(hoofdRijNrs)
    .filter(([letter]) => mtsCodes.includes(letter))
    .map(([, rn]) => rn);
  const mtsRij = schrijfAggrRij('Maatschapsdagen', mtsRijen);

  // Mts + Stby = Maatschapsdagen + Q
  const qRij = hoofdRijNrs['Q'];
  const mtsstbyRij = schrijfAggrRij('Mts + Stby', [mtsRij, ...(qRij ? [qRij] : [])]);

  // Werkdagen = Mts+Stby + K
  const kRij = hoofdRijNrs['K'];
  schrijfAggrRij('Werkdagen', [mtsstbyRij, ...(kRij ? [kRij] : [])]);

  // Roostervrij = K + P + Q + R + V
  const rvrRijen = ['K','P','Q','R','V']
    .map(l => hoofdRijNrs[l])
    .filter(Boolean);
  schrijfAggrRij('Roostervrij', rvrRijen);

  // ==== Bevroren header ======================================================
  ws.views = [{ state:'frozen', ySplit:1, topLeftCell:'A2', activePane:'bottomLeft' }];
}

// ---- Hoofd-export -----------------------------------------------------------
export async function actExportJaar(jaar, naamParam) {
  if (!jaar) { alert('Kies eerst een jaar.'); return; }

  try {
    const ExcelJS = await laadExcelJS();

    // Firestore: alle indeling-docs voor dit jaar
    const q = query(
      collection(db, 'indeling'),
      where('datum', '>=', `${jaar}-01-01`),
      where('datum', '<=', `${jaar}-12-31`)
    );
    const snap = await getDocs(q);
    const dagenMap = new Map();
    snap.docs.forEach(d => { const data = d.data(); dagenMap.set(data.datum, data); });

    // Alle kalenderdagen van het jaar opbouwen — ook dagen zonder Firestore-
    // document (nieuw jaar, nog niets ingevuld) krijgen een lege placeholder-rij
    // zodat het hele jaar in de export staat, niet alleen de ingevulde dagen.
    const dagen = [];
    for (let d = `${jaar}-01-01`; d <= `${jaar}-12-31`; d = plusDagen(d, 1)) {
      dagen.push(dagenMap.get(d) || { datum: d });
    }

    const kleurenMap = bouwKleurenMap();

    // ---- Kolommen (vaste stoelen + waarnemers), datum-bewust op senioriteit -
    // Kolomvolgorde en kolomkop identiek aan hoe de app dit toont (Overzicht/
    // Afdeling): gesorteerd op de in_dienst-datum van de HUIDIGE bezetter, met
    // de waarnemer-slots (W5..W1) vast na de vaste stoelen. Een stoel/slot
    // krijgt een kolom zodra hij in dit jaar minstens één bezetter heeft gehad
    // — ook als die inmiddels via "→ Vast" is doorgeschoven.
    const jaarStart = `${jaar}-01-01`;
    const jaarEind  = `${jaar}-12-31`;
    const REFDATUM  = (String(jaar) === String(huidigKalenderJaar())) ? vandaagIso() : jaarEind;
    // Zonder geladen state is er geen betrouwbare, datum-bewuste kolominfo.
    // Blokkeer dan expliciet — vroeger viel de export terug op een hardcoded
    // code→stoel-mapping, wat na wissels/nieuwe stoelen stilzwijgend een
    // verkeerd bestand opleverde.
    if ((state.radiologen || []).length === 0) {
      alert('Radiologen zijn nog niet geladen — open de app volledig en probeer de export opnieuw.');
      return;
    }

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
          // kolomvolgorde in Excel ooit stilzwijgend afwijkt van de app.
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
    dagen.forEach(dag => {
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
    // samenvallen in dynKolomMap.
    const gebruikteHeaders = new Set();
    kolomEntries.forEach(e => {
      let header = e.code || e.id;
      if (gebruikteHeaders.has(header)) header = `${header} (${e.id})`;
      gebruikteHeaders.add(header);
      e.header = header;
    });

    const radKolommen = kolomEntries.map(e => e.header);
    const dynKolomMap = Object.fromEntries(kolomEntries.map(e => [e.header, e.id]));
    // Kolom-indices (1-based in ExcelJS) — volledig dynamisch op basis van aantal radiologen:
    // 1=Dag, 2=Datum, 3..(2+n)=rads, (3+n)=Dienst, (4+n)=Bespr, (5+n)=Interv, (6+n)=Opm,
    // (7+n)=Aantal, (8+n)=Spacer, (9+n)..=functie-indicatoren
    const COL_RAD_EIND = 2 + radKolommen.length;       // laatste radioloogkolom
    const RAD_EIND_KOL = kolLetter(COL_RAD_EIND);      // Excel-letter voor formule-ranges
    const COL_DIENST   = COL_RAD_EIND + 1;
    const COL_BESPR    = COL_RAD_EIND + 2;
    const COL_INTERV   = COL_RAD_EIND + 3;
    const COL_OPM      = COL_RAD_EIND + 4;
    const COL_AANTAL   = COL_RAD_EIND + 5;
    // ---- Regel-/functie-afgeleide logica (op exporttijd uit de app) --------
    const DAGNR = { ma: 1, di: 2, wo: 3, do: 4, vr: 5, za: 6, zo: 7 };
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
    const FUNCTIE_LETTERS = Object.keys(reqByCode).sort();
    const COL_FUNCTIES = FUNCTIE_LETTERS.map((_, i) => COL_AANTAL + 2 + i);

    if (functiesActief.length === 0) {
      alert('Functies zijn nog niet geladen — open de app volledig (Regels/Functies-tab) en probeer de export opnieuw.');
      return;
    }

    // ---- Werkboek + werkblad ------------------------------------------------
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Rooster-app';
    wb.created = new Date();
    // Vertel Excel dat formules herberekend moeten worden bij openen
    wb.calcProperties = { fullCalcOnLoad: true };
    const sheetNaam = IMPORT_SHEET.replace(/\d{4}/, jaar);
    const ws = wb.addWorksheet(sheetNaam);

    // ---- Kolommen -----------------------------------------------------------
    ws.columns = [
      { header: 'Dag',             key: 'dag',         width: 5  },
      { header: 'Datum',           key: 'datum',       width: 13 },
      ...radKolommen.map(k => ({ header: k, key: k, width: 6 })),
      { header: IMPORT_KOL_DIENST, key: 'dienst',      width: 6  },
      { header: IMPORT_KOL_BESPR,  key: 'bespr',       width: 5  },
      { header: IMPORT_KOL_INTERV, key: 'interventie', width: 6  },
      { header: IMPORT_KOL_OPM,    key: 'opmerking',   width: 54 },
      { header: 'Aantal',          key: 'aantal',      width: 7  },
      { header: '',                key: 'spacer',      width: 3  },
      ...FUNCTIE_LETTERS.map(l => ({ header: l, key: `fn_${l}`, width: 4 })),
    ];

    // ---- Header-rij ---------------------------------------------------------
    const headerRij = ws.getRow(1);
    headerRij.height = 18;
    const totalCols = ws.columns.length;
    for (let ci = 1; ci <= totalCols; ci++) {
      const cel = headerRij.getCell(ci);
      // Spacer-kolom (U) en functie-indicatoren krijgen subtielere header
      const isFunctieKol = ci >= COL_AANTAL + 2;
      cel.font      = { bold: true, color: { argb: isFunctieKol ? 'FF5F5E5A' : 'FFFFFFFF' }, size: 10 };
      cel.fill      = { type: 'pattern', pattern: 'solid',
                        fgColor: { argb: isFunctieKol ? 'FFE8EDF2' : 'FF1F3863' } };
      cel.alignment = { horizontal: 'center', vertical: 'middle' };
      if (!isFunctieKol) {
        cel.border  = { bottom: { style: 'medium', color: { argb: 'FF9DC3E6' } } };
      }
    }
    // Header Aantal kolom apart stijlen
    const aantalHeaderCel = headerRij.getCell(COL_AANTAL);
    aantalHeaderCel.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    aantalHeaderCel.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3863' } };
    aantalHeaderCel.border = { bottom: { style: 'medium', color: { argb: 'FF9DC3E6' } } };

    // Kolomkop-notitie: als een stoel/slot in dit jaar meerdere bezetters had
    // (wissel, of waarnemer → vaste stoel), staat de volledige tijdlijn in een
    // Excel-notitie op de kolomkop, zodat altijd herleidbaar blijft wie je op
    // welke dag daadwerkelijk hebt ingedeeld.
    kolomEntries.forEach((entry, i) => {
      if (!entry.notitie) return;
      const cel = headerRij.getCell(3 + i);
      cel.note = { texts: [{ text: entry.notitie }] };
    });

    // ---- Bevroren rij 1 + kolommen A+B -------------------------------------
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2', activePane: 'bottomRight' }];

    // ---- Data-rijen ---------------------------------------------------------
    const DAGEN_NL_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
    const WEEKEND_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };

    let excelRij = 2; // rij 1 = header

    for (const dag of dagen) {
      const d = new Date(dag.datum + 'T12:00:00');
      const dagIdx  = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const isWeekend = dagIdx >= 5;

      const rij = ws.getRow(excelRij);
      rij.height = 15;

      // Dag-cel
      rij.getCell(1).value = DAGEN_NL_KORT[dagIdx];

      // Datum-cel
      const datumCel = rij.getCell(2);
      datumCel.value  = new Date(dag.datum + 'T12:00:00');
      datumCel.numFmt = 'DD-MM-YYYY';
      datumCel.alignment = { horizontal: 'left', vertical: 'middle' };

      // Weekend-achtergrond basislaag
      if (isWeekend) {
        for (let ci = 1; ci <= totalCols; ci++) {
          rij.getCell(ci).fill = WEEKEND_FILL;
        }
      }

      // Radioloog-cellen (kolommen 3–15)
      radKolommen.forEach((kolHoofd, ki) => {
        const ci  = 3 + ki;
        const cel = rij.getCell(ci);
        cel.alignment = { horizontal: 'center', vertical: 'middle' };

        const radId   = dynKolomMap[kolHoofd];
        const codes   = dag.toewijzingen?.[radId];
        const codeStr = Array.isArray(codes) ? codes.join(',') : (codes || '');
        cel.value = codeStr;

        if (codeStr) {
          const firstCode = Array.isArray(codes) ? codes[0] : codes;
          const letter = hoofdLetterCode(firstCode || '');
          // Celkleur uit de functiekleur van de app (incl. V/K).
          const bg = kleurenMap[letter];
          if (bg && bg.length === 6) {
            cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg.toUpperCase() } };
            cel.font = { color: { argb: tekstArgb(bg) } };
          }
        }

        // Cel-opmerking als note
        const opm = dag.cel_opmerkingen?.[radId];
        if (opm) cel.note = { texts: [{ text: opm }] };
      });

      // Dienst / Bespr / Interventie / Opmerking (dynamische kolommen)
      rij.getCell(COL_DIENST).value = dag.dienst?.dag  || '';
      rij.getCell(COL_BESPR).value  = dag.bespreking   || '';
      rij.getCell(COL_INTERV).value = dag.interventie  || '';
      rij.getCell(COL_OPM).value    = dag.opmerking    || '';
      for (let ci = COL_DIENST; ci <= COL_OPM; ci++) {
        rij.getCell(ci).alignment = { vertical: 'middle' };
      }

      // Kolom Aantal: werkvloerbezetting = som van alle werkvloer-codes (C..eind)
      const aantalCel = rij.getCell(COL_AANTAL);
      aantalCel.value     = { formula: aantalFormule(excelRij, werkvloerUniek, RAD_EIND_KOL) };
      aantalCel.alignment = { horizontal: 'center', vertical: 'middle' };
      aantalCel.font      = { bold: true };

      // Functie-indicatoren: toon de code zolang er een tekort is t.o.v. de
      // (regel-gedreven) vereiste bezetting voor die weekdag.
      FUNCTIE_LETTERS.forEach((letter, li) => {
        const cel = rij.getCell(COL_FUNCTIES[li]);
        cel.value     = { formula: indicatorFormule(letter, reqByCode[letter], excelRij, RAD_EIND_KOL) };
        cel.alignment = { horizontal: 'center', vertical: 'middle' };
        cel.font      = { color: { argb: 'FF888888' }, italic: true, size: 9 };
        if (isWeekend) cel.fill = WEEKEND_FILL;
      });

      excelRij++;
    }

    // ---- Conditionele opmaak ------------------------------------------------
    const dataRef       = `B2:B${excelRij - 1}`;
    const aantalLetter  = kolLetter(COL_AANTAL);
    const aantalRef     = `${aantalLetter}2:${aantalLetter}${excelRij - 1}`;
    const radEindLetter = kolLetter(2 + radKolommen.length);
    const radRef        = `C2:${radEindLetter}${excelRij - 1}`;

    // Indicator-kolomletters + "is er een tekort op deze dag?"-uitdrukkingen.
    const indLetters   = FUNCTIE_LETTERS.map((_, li) => kolLetter(COL_FUNCTIES[li]));
    // Voor datum/Aantal-rood tellen alleen de strikte criteria (verplicht +
    // bezetting-regels) mee; werkvloer-only indicatoren dienen als overzicht.
    const strictLetters = FUNCTIE_LETTERS
      .map((code, li) => (strictCodes.has(code) ? kolLetter(COL_FUNCTIES[li]) : null))
      .filter(Boolean);
    const tekortOR     = strictLetters.length ? `OR(${strictLetters.map(k => `${k}2<>""`).join(',')})` : null;
    const geenTekort   = strictLetters.length ? strictLetters.map(k => `${k}2=""`).join(',') : null;

    // 1. Datum rood op een werkdag zodra een norm niet gehaald wordt (tekort).
    //    De normen komen uit de bezetting-regels + verplichte functies (zie
    //    indicator-kolommen). Geen vaste 5/4 meer.
    if (tekortOR) {
      ws.addConditionalFormatting({
        ref: dataRef,
        rules: [{
          type: 'expression',
          formulae: [`AND(WEEKDAY(B2,2)<6,${tekortOR})`],
          style: {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
            font: { color: { argb: 'FF9C0006' }, bold: true },
          },
          priority: 1,
        }],
      });
    }

    // 2. Aantal-kolom: rood bij tekort op een werkdag, groen als alle normen
    //    gehaald worden. Volledig regel-gedreven (geen vaste drempels).
    if (tekortOR) {
      ws.addConditionalFormatting({
        ref: aantalRef,
        rules: [
          {
            type: 'expression',
            formulae: [`AND(WEEKDAY(B2,2)<6,${tekortOR})`],
            style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
                     font: { color: { argb: 'FF9C0006' }, bold: true } },
            priority: 1,
          },
          {
            type: 'expression',
            formulae: [`AND(WEEKDAY(B2,2)<6,AND(${geenTekort}))`],
            style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } },
                     font: { color: { argb: 'FF276221' } } },
            priority: 2,
          },
        ],
      });
    }

    // 3. Radioloog-cellen: kleur per functiecode — dynamisch uit de app-kleuren
    //    (inclusief V/K). Verandert mee als je een waarde in Excel aanpast.
    const functieCfRules = Object.entries(kleurenMap)
      .filter(([, hex]) => hex && hex.length === 6)
      .map(([code, hex], i) => ({
        type: 'expression',
        formulae: [`OR(UPPER(C2)="${code}",UPPER(LEFT(C2,1))="${code}",AND(LEFT(C2,1)=".",UPPER(MID(C2,2,1))="${code}"),AND(ISNUMBER(VALUE(LEFT(C2,1))),UPPER(MID(C2,2,1))="${code}"))`],
        style: {
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex.toUpperCase() } },
          font: { color: { argb: tekstArgb(hex) } },
        },
        priority: 20 + i,
      }));
    if (functieCfRules.length > 0) {
      ws.addConditionalFormatting({ ref: radRef, rules: functieCfRules });
    }

    // 4. Indicator-kolommen: rood+vet als de cel niet leeg is (= tekort op die functie).
    FUNCTIE_LETTERS.forEach((letter, li) => {
      const indKol = kolLetter(COL_FUNCTIES[li]);
      const indRef = `${indKol}2:${indKol}${excelRij - 1}`;
      ws.addConditionalFormatting({
        ref: indRef,
        rules: [{
          type: 'expression',
          formulae: [`${indKol}2<>""`],
          style: {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
            font: { color: { argb: 'FF9C0006' }, bold: true, size: 10 },
          },
          priority: 1,
        }],
      });
    });

    // ---- Activiteit-sheet ---------------------------------------------------
    // Activiteit-sheet tijdelijk uitgeschakeld (formule-bugs in sheet2)
    // voegActiviteitSheetToe(wb, sheetNaam, radKolommen, dynKolomMap, COL_DIENST, excelRij - 1);

    // ---- Zichtbaar blad "Mutaties" ------------------------------------------
    // Wisselingen midden in het jaar (Wissel / waarnemer → vaste stoel) worden
    // hier expliciet en VOLLEDIG leesbaar vastgelegd, i.p.v. via een cel-notitie
    // op de kolomkop die door Excel wordt afgekapt. Elke regel is één overgang:
    // welke kolom, van welke bezetter naar welke, en per welke datum. Zo is in
    // één oogopslag te zien dat een kolom in dit jaar van persoon wisselt.
    const mutaties = [];
    kolomEntries.forEach(e => {
      const bez = Array.isArray(e.bezetters) ? e.bezetters.slice() : [];
      if (bez.length < 2) return;
      bez.sort((a, b) => (a.van || '0000-00-00') < (b.van || '0000-00-00') ? -1 : 1);
      for (let i = 1; i < bez.length; i++) {
        const vorige = bez[i - 1];
        const cur = bez[i];
        mutaties.push({
          kolom: e.header,
          stoel: e.id,
          van: `${vorige.code || ''}${vorige.achternaam ? ' · ' + vorige.achternaam : ''}`,
          naar: `${cur.code || ''}${cur.achternaam ? ' · ' + cur.achternaam : ''}`,
          per: cur.van || '',
        });
      }
    });
    // Sorteer op ingangsdatum, dan kolom.
    mutaties.sort((a, b) => (a.per || '').localeCompare(b.per || '') || a.kolom.localeCompare(b.kolom));

    const mutWs = wb.addWorksheet('Mutaties');
    mutWs.columns = [
      { key: 'kolom', width: 10 },
      { key: 'stoel', width: 12 },
      { key: 'van',   width: 26 },
      { key: 'naar',  width: 26 },
      { key: 'per',   width: 13 },
    ];
    // Rij 1: duidelijke "alleen ter info"-banner over de volle breedte.
    mutWs.mergeCells('A1:E1');
    const mutBanner = mutWs.getCell('A1');
    mutBanner.value = '⚠ Alleen ter info — wijzigingen doen in de app, niet in dit blad. '
      + 'Dit overzicht wordt bij elke export opnieuw opgebouwd en bij import genegeerd.';
    mutBanner.font = { bold: true, color: { argb: 'FF6B3A00' }, size: 10 };
    mutBanner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4E0' } };
    mutBanner.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    mutWs.getRow(1).height = 28;
    // Rij 2: kolomkoppen.
    const mutKoppen = ['Kolom', 'Stoel-ID', 'Van (vorige bezetter)', 'Naar (nieuwe bezetter)', 'Per datum'];
    const mutHead = mutWs.getRow(2);
    mutHead.height = 18;
    mutKoppen.forEach((h, i) => {
      const cel = mutHead.getCell(i + 1);
      cel.value = h;
      cel.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3863' } };
      cel.alignment = { horizontal: 'left', vertical: 'middle' };
      cel.border = { bottom: { style: 'medium', color: { argb: 'FF9DC3E6' } } };
    });
    // Data vanaf rij 3.
    let mutRij = 3;
    if (mutaties.length === 0) {
      mutWs.getCell(`C${mutRij}`).value = `Geen wisselingen in ${jaar}.`;
    } else {
      mutaties.forEach(m => {
        const rij = mutWs.getRow(mutRij);
        rij.getCell(1).value = m.kolom;
        rij.getCell(2).value = m.stoel;
        rij.getCell(3).value = m.van;
        rij.getCell(4).value = m.naar;
        if (m.per) { rij.getCell(5).value = new Date(m.per + 'T12:00:00'); rij.getCell(5).numFmt = 'DD-MM-YYYY'; }
        mutRij++;
      });
    }
    mutWs.views = [{ state: 'frozen', ySplit: 2 }];
    // Read-only: alle cellen zijn standaard 'locked'; met bescherming aan kan er
    // niet in getypt worden. Selecteren en kopiëren blijft mogelijk.
    await mutWs.protect('', { selectLockedCells: true, selectUnlockedCells: true });

    // ---- Watermerk _RoosterApp ----------------------------------------------
    // Verborgen blad waaraan de import een app-export herkent, onafhankelijk
    // van de sheetnaam. (Een named range is met SheetJS lastig betrouwbaar te
    // lezen; een verborgen sheet is triviaal detecteerbaar via wb.SheetNames.)
    const wmWs = wb.addWorksheet('_RoosterApp');
    wmWs.state = 'hidden';
    wmWs.getCell('A1').value = 'RoosterApp';
    wmWs.getCell('A2').value = `versie ${window.APP_VERSIE || ''}`;
    wmWs.getCell('A3').value = `geëxporteerd ${new Date().toISOString()}`;

    // ---- Verborgen kolom-mapping (code → stoel-id) --------------------------
    // Vastgelegd zoals geldig op het moment van export. Hiermee koppelt de
    // import elke kolom op de juiste, stabiele stoel — ook nadat er later een
    // wissel is geweest. Ontbreekt dit blad, dan valt de import terug op de code.
    const mapWs = wb.addWorksheet('_kolommen');
    mapWs.state = 'hidden';
    mapWs.columns = [
      { header: 'Code', key: 'code', width: 12 },
      { header: 'StoelId', key: 'stoel', width: 12 },
    ];
    radKolommen.forEach(code => { mapWs.addRow({ code, stoel: dynKolomMap[code] }); });

    // ---- Verborgen naslagblad _regels --------------------------------------
    // Legt vast welke functie-instellingen en bezetting-normen zijn gebruikt om
    // dit bestand op te bouwen (puur ter controle/herleidbaarheid).
    const regWs = wb.addWorksheet('_regels');
    regWs.state = 'hidden';
    regWs.columns = [
      { header: 'Soort',     key: 'soort',  width: 12 },
      { header: 'Code',      key: 'code',   width: 8  },
      { header: 'Dag',       key: 'dag',    width: 6  },
      { header: 'Aantal',    key: 'aantal', width: 8  },
      { header: 'Kleur',     key: 'kleur',  width: 10 },
      { header: 'Werkvloer', key: 'werk',   width: 10 },
      { header: 'Verplicht', key: 'verp',   width: 10 },
    ];
    functiesActief.forEach(f => {
      const code = (f.code || f.id || '');
      regWs.addRow({
        soort: 'functie',
        code,
        dag: '',
        aantal: '',
        kleur: f.kleur || '',
        werk: functieFlags(code).werkvloer ? 'ja' : 'nee',
        verp: f.verplicht === true ? 'ja' : 'nee',
      });
    });
    bezettingRegels.forEach(r => {
      regWs.addRow({
        soort: 'norm',
        code: r.code || '',
        dag: r.dag || '',
        aantal: Number(r.aantal) || 0,
        kleur: '', werk: '', verp: '',
      });
    });

    // ---- Downloaden ---------------------------------------------------------
    const buffer = await wb.xlsx.writeBuffer();
    const defaultNaam = `Indeling_${jaar}.xlsx`;
    const bestandsnaam = (naamParam && naamParam.trim())
      ? (naamParam.trim().endsWith('.xlsx') ? naamParam.trim() : naamParam.trim() + '.xlsx')
      : defaultNaam;
    downloadBlob(buffer, bestandsnaam);

  } catch (e) {
    console.error('actExportJaar', e);
    alert('Export mislukt:\n\n' + (e.message || e));
  }
}
