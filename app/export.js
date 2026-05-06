// Excel-export: lees Firestore-indeling voor een gekozen jaar en schrijf een .xlsx
// met volledige opmaak via ExcelJS (gratis, ondersteunt stijlen in browser):
//  - Datum als echte Excel-datumcel (DD-MM-YYYY)
//  - Kleurcodering per functiecode vanuit state.functies (+ fallback-map)
//  - Weekend-rijen lichtgrijs
//  - Header-rij vetgedrukt met donkerblauwe achtergrond
//  - Bevroren header-rij + kolommen Dag+Datum
//  - Kolombreedte passend bij het origineel
//  - Cel-opmerkingen (cel_opmerkingen) als Excel cell notes

import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';
import { state } from './state.js';
import { IMPORT_SHEET, IMPORT_KOL_DIENST, IMPORT_KOL_BESPR, IMPORT_KOL_INTERV, IMPORT_KOL_OPM, IMPORT_KOLOM_NAAR_RADID } from './import.js';

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

// Tekstkleur: donker op lichte achtergrond, licht op donkere
function tekstArgb(hex6) {
  const r = parseInt(hex6.slice(0,2), 16);
  const g = parseInt(hex6.slice(2,4), 16);
  const b = parseInt(hex6.slice(4,6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? 'FF1A1A18' : 'FFFFFFFF';
}

// ---- ExcelJS laden via CDN --------------------------------------------------
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

// ---- Blob downloaden --------------------------------------------------------
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
    const radKolommen = Object.keys(IMPORT_KOLOM_NAAR_RADID);

    // ---- Werkboek + werkblad ------------------------------------------------
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Rooster-app';
    wb.created = new Date();

    const sheetNaam = IMPORT_SHEET.replace(/\d{4}/, jaar);
    const ws = wb.addWorksheet(sheetNaam);

    // ---- Kolommen (volgorde + breedte) --------------------------------------
    ws.columns = [
      { header: 'Dag',          key: 'dag',    width: 5   },
      { header: 'Datum',        key: 'datum',  width: 13  },
      ...radKolommen.map(k => ({ header: k, key: k, width: 6 })),
      { header: IMPORT_KOL_DIENST, key: 'dienst',     width: 6  },
      { header: IMPORT_KOL_BESPR,  key: 'bespr',      width: 5  },
      { header: IMPORT_KOL_INTERV, key: 'interventie',width: 6  },
      { header: IMPORT_KOL_OPM,    key: 'opmerking',  width: 54 },
    ];

    // ---- Header-rij stijl ---------------------------------------------------
    const headerRij = ws.getRow(1);
    headerRij.height = 18;
    ws.columns.forEach((_, ci) => {
      const cel = headerRij.getCell(ci + 1);
      cel.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cel.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3863' } };
      cel.alignment = { horizontal: 'center', vertical: 'middle' };
      cel.border    = { bottom: { style: 'medium', color: { argb: 'FF9DC3E6' } } };
    });

    // ---- Bevroren rijen/kolommen: rij 1 + kolommen A+B ----------------------
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2', activePane: 'bottomRight' }];

    // ---- Data-rijen ---------------------------------------------------------
    const DAGEN_NL_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

    for (const dag of dagen) {
      const d = new Date(dag.datum + 'T12:00:00');
      const dagIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const isWeekend = dagIdx >= 5;

      // Rij-data opbouwen
      const rijData = {
        dag:   DAGEN_NL_KORT[dagIdx],
        datum: new Date(dag.datum + 'T12:00:00'),
      };
      for (const kolHoofd of radKolommen) {
        const radId = IMPORT_KOLOM_NAAR_RADID[kolHoofd];
        const codes = dag.toewijzingen?.[radId];
        rijData[kolHoofd] = Array.isArray(codes) ? codes.join(',') : (codes || '');
      }
      rijData.dienst      = dag.dienst?.dag  || '';
      rijData.bespr       = dag.bespreking   || '';
      rijData.interventie = dag.interventie  || '';
      rijData.opmerking   = dag.opmerking    || '';

      const rij = ws.addRow(rijData);
      rij.height = 15;

      // Datum-cel: opmaak als datum
      const datumCel = rij.getCell(2);
      datumCel.numFmt = 'DD-MM-YYYY';
      datumCel.alignment = { horizontal: 'left', vertical: 'middle' };

      // Weekend-achtergrond op alle cellen
      if (isWeekend) {
        rij.eachCell({ includeEmpty: true }, cel => {
          cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        });
      }

      // Radioloog-cellen: kleur per functiecode + optionele cel-opmerking
      radKolommen.forEach((kolHoofd, ki) => {
        const colIdx = 3 + ki; // 1-based: col1=Dag, col2=Datum, col3=eerste rad
        const cel = rij.getCell(colIdx);
        cel.alignment = { horizontal: 'center', vertical: 'middle' };

        const radId = IMPORT_KOLOM_NAAR_RADID[kolHoofd];
        const codes = dag.toewijzingen?.[radId];
        const codeStr = Array.isArray(codes) ? codes[0] : (codes || '');

        if (codeStr) {
          const letter = hoofdLetter(codeStr);
          const bg = kleurenMap[letter];
          if (bg && bg.length === 6) {
            cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg.toUpperCase() } };
            cel.font = { color: { argb: tekstArgb(bg) } };
          }
        }

        // Cel-opmerking als Excel note
        const opm = dag.cel_opmerkingen?.[radId];
        if (opm) {
          cel.note = { texts: [{ text: opm }] };
        }
      });
    }

    // ---- Downloaden ---------------------------------------------------------
    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(buffer, `Indeling_${jaar}.xlsx`);

  } catch (e) {
    console.error('actExportJaar', e);
    alert('Export mislukt:\n\n' + (e.message || e));
  }
}
