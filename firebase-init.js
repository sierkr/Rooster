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
import { state, HOOFD_FUNCTIES } from './state.js';
import { IMPORT_SHEET, IMPORT_KOL_DIENST, IMPORT_KOL_BESPR, IMPORT_KOL_INTERV, IMPORT_KOL_OPM, IMPORT_KOLOM_NAAR_RADID } from './import.js';
import { isHoofd, functieFlags, kolomNaarRadId, hoofdLetterCode } from './helpers.js';

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

// Converteert 1-based kolomnummer naar Excel-letter (bijv. 20 → 'T')
function kolLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ---- ExcelJS laden ----------------------------------------------------------
let _excelJsPromise = null;
function laadExcelJS() {
  if (_excelJsPromise) return _excelJsPromise;
  _excelJsPromise = new Promise((resolve, reject) => {
    if (window.ExcelJS) return resolve(window.ExcelJS);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => reject(new Error('Kon ExcelJS niet laden (offline?).'));
    document.head.appendChild(s);
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
    const dagen = snap.docs
      .map(d => d.data())
      .sort((a, b) => a.datum.localeCompare(b.datum));

    if (!dagen.length) {
      alert(`Geen indeling-data gevonden voor ${jaar}.`);
      return;
    }

    const kleurenMap = bouwKleurenMap();
    const VASTE_VOLGORDE = ['L','P','V','F','K','H','S','J','W5','W4','W3','W2','W1'];
    const dynKolomMap = Object.keys(kolomNaarRadId()).length > 0
      ? kolomNaarRadId() : IMPORT_KOLOM_NAAR_RADID;
    const radKolommen = Object.keys(dynKolomMap).sort((a, b) => {
      const ia = VASTE_VOLGORDE.indexOf(dynKolomMap[a]);
      const ib = VASTE_VOLGORDE.indexOf(dynKolomMap[b]);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
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
    // Functies met verplicht=true als indicator-kolommen; fallback op alle werkvloer-functies
    const verplichteFuncties = (state.functies || []).filter(f => isHoofd(f) && f.verplicht === true);
    const FUNCTIE_LETTERS = (verplichteFuncties.length > 0 ? verplichteFuncties : (state.functies || []).filter(f => isHoofd(f) && functieFlags(f.code || f.id).werkvloer))
      .map(f => (f.code || f.id).toUpperCase())
      .sort();
    const COL_FUNCTIES = FUNCTIE_LETTERS.map((_, i) => COL_AANTAL + 2 + i);

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

    // ---- Bevroren rij 1 + kolommen A+B -------------------------------------
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2', activePane: 'bottomRight' }];

    // ---- Data-rijen ---------------------------------------------------------
    const DAGEN_NL_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
    const WEEKEND_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    const VK_FILL       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } }; // lichtgeel V/K

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

          // V of K → lichtgeel (afwezigheid), overschrijft weekend-grijs
          if (letter === 'V' || letter === 'K') {
            cel.fill = VK_FILL;
            cel.font = { color: { argb: 'FF5A4800' } };
          } else {
            const bg = kleurenMap[letter];
            if (bg && bg.length === 6) {
              cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg.toUpperCase() } };
              cel.font = { color: { argb: tekstArgb(bg) } };
            }
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

      // Kolom Aantal: formule over alle radioloog-kolommen (C tot RAD_EIND_KOL)
      const aantalCel = rij.getCell(COL_AANTAL);
      aantalCel.value     = { formula: aantalFormule(excelRij, FUNCTIE_LETTERS, RAD_EIND_KOL) };
      aantalCel.alignment = { horizontal: 'center', vertical: 'middle' };
      aantalCel.font      = { bold: true };

      // Functie-indicatoren: ontbrekende functies per rij
      FUNCTIE_LETTERS.forEach((letter, li) => {
        const cel = rij.getCell(COL_FUNCTIES[li]);
        cel.value     = { formula: ontbrekendFormule(letter, excelRij, RAD_EIND_KOL) };
        cel.alignment = { horizontal: 'center', vertical: 'middle' };
        cel.font      = { color: { argb: 'FF888888' }, italic: true, size: 9 };
        if (isWeekend) cel.fill = WEEKEND_FILL;
      });

      excelRij++;
    }

    // ---- Conditionele opmaak ------------------------------------------------
    const dataRef    = `B2:B${excelRij - 1}`;
    const aantalLetter = kolLetter(COL_AANTAL);
    const aantalRef  = `${aantalLetter}2:${aantalLetter}${excelRij - 1}`;
    const radEindLetter = kolLetter(2 + radKolommen.length);
    const radRef     = `C2:${radEindLetter}${excelRij - 1}`;

    // 1. Datum rood als bezetting te laag (weekdag + Aantal < norm)
    ws.addConditionalFormatting({
      ref: dataRef,
      rules: [{
        type: 'expression',
        formulae: [`AND(${aantalLetter}2<IF(WEEKDAY(B2,2)=5,4,5),WEEKDAY(B2,2)<6)`],
        style: {
          fill:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
          font:   { color: { argb: 'FF9C0006' }, bold: true },
        },
        priority: 1,
      }],
    });

    // 2. Aantal-kolom: rood <4, oranje =4, groen ≥5
    ws.addConditionalFormatting({
      ref: aantalRef,
      rules: [
        {
          type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [5],
          style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } },
                   font: { color: { argb: 'FF276221' } } },
          priority: 3,
        },
        {
          type: 'cellIs', operator: 'equal', formulae: [4],
          style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } },
                   font: { color: { argb: 'FF9C5700' } } },
          priority: 2,
        },
        {
          type: 'cellIs', operator: 'lessThan', formulae: [4],
          style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
                   font: { color: { argb: 'FF9C0006' }, bold: true } },
          priority: 1,
        },
      ],
    });

    // 3. Radioloog-cellen: kleur per functiecode — dynamisch op basis van kleurenMap.
    //    Zodat celopmaak mee verandert als een gebruiker een waarde aanpast in Excel.
    //    Elke bekende functiecode krijgt een eigen regel met de kleur uit de app.
    const functieCfRules = Object.entries(kleurenMap)
      .filter(([, hex]) => hex && hex.length === 6)
      .map(([code, hex], i) => ({
        type: 'expression',
        formulae: [`OR(C2="${code}",LEFT(C2,1)="${code}",(LEFT(C2,1)=".")*(MID(C2,2,1)="${code}"))`],
        style: {
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex.toUpperCase() } },
          font: { color: { argb: tekstArgb(hex) } },
        },
        priority: 20 + i,
      }));
    if (functieCfRules.length > 0) {
      ws.addConditionalFormatting({ ref: radRef, rules: functieCfRules });
    }

    // 4. Indicator-kolommen: rood+vet als cel niet leeg (= verplichte functie ontbreekt)
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

    // 5. Datumcel rood als verplichte functie ontbreekt op werkdag
    if (FUNCTIE_LETTERS.length > 0) {
      const indLetters = FUNCTIE_LETTERS.map((_, li) => kolLetter(COL_FUNCTIES[li]));
      const ontbreektFormule = indLetters.map(k => `${k}2<>""`).join(',');
      ws.addConditionalFormatting({
        ref: dataRef,
        rules: [{
          type: 'expression',
          formulae: [`AND(WEEKDAY(B2,2)<6,OR(${ontbreektFormule}))`],
          style: {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
            font: { color: { argb: 'FF9C0006' }, bold: true },
          },
          priority: 2,
        }],
      });
    }

    // ---- Activiteit-sheet ---------------------------------------------------
    // Activiteit-sheet tijdelijk uitgeschakeld (formule-bugs in sheet2)
    // voegActiviteitSheetToe(wb, sheetNaam, radKolommen, dynKolomMap, COL_DIENST, excelRij - 1);

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
