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
import { state } from './state.js';
import { IMPORT_SHEET, IMPORT_KOL_DIENST, IMPORT_KOL_BESPR, IMPORT_KOL_INTERV, IMPORT_KOL_OPM, IMPORT_KOLOM_NAAR_RADID } from './import.js';
import { isHoofd, functieFlags, kolomNaarRadId } from './helpers.js';

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
    const code = (f.code || f.id || '').charAt(0).toUpperCase();
    if (code && f.kleur) map[code] = f.kleur.replace('#', '');
  });
  return map;
}

function hoofdLetter(code) {
  return (code || '').replace(/^\./, '').replace(/^[0-9]+/, '').replace(/^YY/, '').charAt(0).toUpperCase();
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
    `((${range}="${l}")+` +
    `(LEFT(${range},1)="${l}")+` +
    `((LEFT(${range},1)=".")*(MID(${range},2,1)="${l}"))+` +
    `((ISNUMBER(VALUE(LEFT(${range},1))))*(MID(${range},2,1)="${l}"))>0)*1)`
  );
}

// Formule voor kolom T (werkvloerbezetting): som van W+B+E+M+D+O+S per rij
function aantalFormule(rij, letters) {
  const range = `C${rij}:O${rij}`;
  if (!letters || letters.length === 0) return '=0';
  return '=' + letters.map(l => telLetterFormule(l, range)).join('+');
}

// Formule voor kolom V–AA: toon letter als die functie NIET aanwezig is
function ontbrekendFormule(letter, rij) {
  const range = `C${rij}:O${rij}`;
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

// ---- Hoofd-export -----------------------------------------------------------
export async function actExportJaar(jaar) {
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
    // Kolom-indices (1-based in ExcelJS):
    // 1=Dag, 2=Datum, 3..15=radiologen, 16=Dienst, 17=Bespr, 18=Interv, 19=Opm
    // 20=Aantal(T), 21=spacer(U), 22..N=werkvloer-indicatoren (dynamisch)
    // 1=Dag, 2=Datum, 3..(2+n)=rads, (3+n)..(6+n)=Dienst/Bespr/Interv/Opm, (7+n)=Aantal, (8+n)=Spacer
    const COL_AANTAL   = 2 + radKolommen.length + 5;
    const FUNCTIE_LETTERS = (state.functies || [])
      .filter(f => isHoofd(f) && functieFlags(f.code || f.id).werkvloer)
      .map(f => (f.code || f.id).toUpperCase())
      .sort();
    const COL_FUNCTIES = FUNCTIE_LETTERS.map((_, i) => COL_AANTAL + 2 + i);

    // ---- Werkboek + werkblad ------------------------------------------------
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Rooster-app';
    wb.created = new Date();
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
          const letter = hoofdLetter(firstCode || '');

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

      // Dienst / Bespr / Interventie / Opmerking (kolommen 16–19)
      rij.getCell(16).value = dag.dienst?.dag  || '';
      rij.getCell(17).value = dag.bespreking   || '';
      rij.getCell(18).value = dag.interventie  || '';
      rij.getCell(19).value = dag.opmerking    || '';
      for (let ci = 16; ci <= 19; ci++) {
        rij.getCell(ci).alignment = { vertical: 'middle' };
      }

      // Kolom T (Aantal): formule
      const aantalCel = rij.getCell(COL_AANTAL);
      aantalCel.value     = { formula: aantalFormule(excelRij, FUNCTIE_LETTERS) };
      aantalCel.alignment = { horizontal: 'center', vertical: 'middle' };
      aantalCel.font      = { bold: true };

      // Kolommen V–AA: ontbrekende functie-indicatoren
      FUNCTIE_LETTERS.forEach((letter, li) => {
        const cel = rij.getCell(COL_FUNCTIES[li]);
        cel.value     = { formula: ontbrekendFormule(letter, excelRij) };
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
          fill:   { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } },
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
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC6EFCE' } },
                   font: { color: { argb: 'FF276221' } } },
          priority: 3,
        },
        {
          type: 'cellIs', operator: 'equal', formulae: [4],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFEB9C' } },
                   font: { color: { argb: 'FF9C5700' } } },
          priority: 2,
        },
        {
          type: 'cellIs', operator: 'lessThan', formulae: [4],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } },
                   font: { color: { argb: 'FF9C0006' }, bold: true } },
          priority: 1,
        },
      ],
    });

    // 3. Radioloog-cellen V of K: lichtgeel achtergrond (condformat als extra laag,
    //    bovenop de statische kleur die al gezet is — voor gebruikers die data aanpassen)
    ws.addConditionalFormatting({
      ref: radRef,
      rules: [{
        type: 'expression',
        formulae: ['OR(C2="V",C2="K")'],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFFF99' } },
          font: { color: { argb: 'FF5A4800' } },
        },
        priority: 1,
      }],
    });

    // ---- Downloaden ---------------------------------------------------------
    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(buffer, `Indeling_${jaar}.xlsx`);

  } catch (e) {
    console.error('actExportJaar', e);
    alert('Export mislukt:\n\n' + (e.message || e));
  }
}
