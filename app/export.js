// Excel-export: lees Firestore-indeling voor een gekozen jaar en schrijf een .xlsx
// dat zoveel mogelijk lijkt op het bestaande handmatige werkblad:
//  - Kolomvolgorde: Dag | Datum | radiologen | Dienst | Bespr | Interventie | Opmerking
//  - Datum als echte Excel-datumcel (niet als tekst)
//  - Kleurcodering per functiecode (W/B/E/M/D/O/S/A/R/V/Q/Z/K/T/X)
//  - Weekend-rijen (za/zo) lichtgrijs
//  - Header-rij vetgedrukt met donkerblauwe achtergrond (zoals origineel)
//  - Bevroren header-rij + kolommen Dag+Datum
//  - Kolombreedte passend bij het origineel
//  - Cel-opmerkingen (cel_opmerkingen) als Excel cell comments

import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';
import { state } from './state.js';
import { IMPORT_SHEET, IMPORT_KOL_DIENST, IMPORT_KOL_BESPR, IMPORT_KOL_INTERV, IMPORT_KOL_OPM, IMPORT_KOLOM_NAAR_RADID } from './import.js';

// ---- Kleuren per hoofdletter-functiecode ------------------------------------
// Fallback-map; wordt aangevuld/overschreven met kleuren uit state.functies.
const FALLBACK_KLEUREN = {
  W: '#dce6f1', // weekradioloog – lichtblauw
  B: '#e2efda', // bucky/echo – lichtgroen
  E: '#fff2cc', // echo – lichtgeel
  M: '#fce4d6', // mammo/CT – licht oranje-roze
  D: '#ede9f8', // DSI/SD – lichtpaars
  O: '#d9ead3', // omnipotent – groen
  S: '#fce4d6', // S-dienst
  A: '#f4f4f4', // admin/trans/ziek – lichtgrijs
  R: '#fafafa', // roostervrij – heel licht
  V: '#ffffc0', // verlof/vakantie – lichtgeel
  Z: '#ffe0b2', // ziek – licht amber
  K: '#e8f0fe', // klinische les
  T: '#f3e5f5', // transport
  X: '#ffebee', // boventallig
  Q: '#e0f7fa', // deeltijd zonder dienst
};

// Tekstkleur op basis van achtergrond (luma-drempel)
function tekstKleurVoor(hex) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 'FF000000';
  const r = parseInt(h.slice(0,2), 16);
  const g = parseInt(h.slice(2,4), 16);
  const b = parseInt(h.slice(4,6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? 'FF1a1a18' : 'FFFFFFFF';
}

// Bouw een gecombineerde kleurenmap uit state.functies + fallback
function bouwKleurenMap() {
  const map = { ...FALLBACK_KLEUREN };
  (state.functies || []).forEach(f => {
    const code = (f.code || f.id || '').charAt(0).toUpperCase();
    if (code && f.kleur) map[code] = f.kleur;
  });
  return map;
}

// Geef de hoofd-letter van een code (bijv. '.WB' -> 'W', '5E' -> 'E')
function hoofdLetter(code) {
  return (code || '').replace(/^\./, '').replace(/^[0-9]+/, '').replace(/^YY/, '').charAt(0).toUpperCase();
}

// Laad SheetJS (gedeeld met import.js via window.XLSX)
let _xlsxPromise = null;
function laadSheetJS() {
  if (_xlsxPromise) return _xlsxPromise;
  _xlsxPromise = new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Kon SheetJS niet laden (offline?).'));
    document.head.appendChild(s);
  });
  return _xlsxPromise;
}

// Helper: zet stijl op een cel
function zetCelStijl(ws, adres, stijl) {
  if (!ws[adres]) return;
  ws[adres].s = stijl;
}

// Helper: maak stijl voor een functiecode-cel
function maakCelStijl(code, kleurenMap, extra) {
  const letter = hoofdLetter(code);
  const bgHex = (kleurenMap[letter] || '').replace('#', '');
  if (!bgHex || bgHex.length !== 6) return extra || {};
  const bg = 'FF' + bgHex.toUpperCase();
  const fg = tekstKleurVoor('#' + bgHex);
  return Object.assign({
    fill: { fgColor: { rgb: bg } },
    font: { color: { rgb: fg } },
    alignment: { horizontal: 'center', vertical: 'center' },
  }, extra || {});
}

export async function actExportJaar(jaar) {
  if (!jaar) { alert('Kies eerst een jaar.'); return; }

  try {
    const XLSX = await laadSheetJS();

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

    // Kolom-volgorde: Dag, Datum, radiologen, P/Q/R/S
    const radKolommen = Object.keys(IMPORT_KOLOM_NAAR_RADID);
    const headers = [
      'Dag', 'Datum',
      ...radKolommen,
      IMPORT_KOL_DIENST, IMPORT_KOL_BESPR, IMPORT_KOL_INTERV, IMPORT_KOL_OPM,
    ];

    const DAGEN_NL_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

    // ---- Bouw worksheet-data ----
    const wsData = [headers];
    for (const dag of dagen) {
      const d = new Date(dag.datum + 'T12:00:00');
      const dagNlIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;
      // Datum als JS Date zodat SheetJS een echte datumcel maakt
      const datumObj = new Date(dag.datum + 'T12:00:00');
      const rij = [DAGEN_NL_KORT[dagNlIdx], datumObj];
      for (const kolHoofd of radKolommen) {
        const radId = IMPORT_KOLOM_NAAR_RADID[kolHoofd];
        const codes = dag.toewijzingen?.[radId];
        rij.push(Array.isArray(codes) ? codes.join(',') : (codes || ''));
      }
      rij.push(dag.dienst?.dag || '');
      rij.push(dag.bespreking || '');
      rij.push(dag.interventie || '');
      rij.push(dag.opmerking || '');
      wsData.push(rij);
    }

    // ---- SheetJS worksheet ----
    const ws = XLSX.utils.aoa_to_sheet(wsData, { cellDates: true, dateNF: 'DD-MM-YYYY' });

    // ---- Kolombreedten (karaktereenheden, passend bij het origineel) ----
    ws['!cols'] = [
      { wch: 4  },  // Dag
      { wch: 11 },  // Datum
      ...radKolommen.map(() => ({ wch: 5.5 })),
      { wch: 5  },  // Dienst
      { wch: 4  },  // Bespr
      { wch: 5  },  // Interventie
      { wch: 52 },  // Opmerking
    ];

    // ---- Bevroren rij + kolommen: header-rij + Dag+Datum ----
    // SheetJS: !freeze als SheetView-like object
    ws['!freeze'] = { xSplit: 2, ySplit: 1, topLeftCell: 'C2', activePane: 'bottomRight', state: 'frozen' };

    // ---- Stijlen ----
    const HEADER_STIJL = {
      fill: { fgColor: { rgb: 'FF1F3863' } },
      font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { bottom: { style: 'medium', color: { rgb: 'FF9DC3E6' } } },
    };
    const WEEKEND_BG = { fill: { fgColor: { rgb: 'FFF2F2F2' } } };
    const DATUM_STIJL = {
      numFmt: 'DD-MM-YYYY',
      alignment: { horizontal: 'left', vertical: 'center' },
    };
    const DATUM_WEEKEND = {
      numFmt: 'DD-MM-YYYY',
      alignment: { horizontal: 'left', vertical: 'center' },
      fill: { fgColor: { rgb: 'FFF2F2F2' } },
    };

    // Header-rij stylen
    headers.forEach((_, ci) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: ci });
      zetCelStijl(ws, addr, HEADER_STIJL);
    });

    // Data-rijen stylen
    dagen.forEach((dag, ri) => {
      const excelRij = ri + 1;
      const d = new Date(dag.datum + 'T12:00:00');
      const dagNlIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const isWeekend = dagNlIdx >= 5;

      // Dag-cel
      const dagAddr = XLSX.utils.encode_cell({ r: excelRij, c: 0 });
      if (isWeekend) zetCelStijl(ws, dagAddr, WEEKEND_BG);

      // Datum-cel
      const datAddr = XLSX.utils.encode_cell({ r: excelRij, c: 1 });
      if (ws[datAddr]) {
        ws[datAddr].t = 'd';
        ws[datAddr].s = isWeekend ? DATUM_WEEKEND : DATUM_STIJL;
      }

      // Radioloog-cellen
      radKolommen.forEach((kolHoofd, ki) => {
        const ci = 2 + ki;
        const addr = XLSX.utils.encode_cell({ r: excelRij, c: ci });
        const radId = IMPORT_KOLOM_NAAR_RADID[kolHoofd];
        const codes = dag.toewijzingen?.[radId];
        const codeStr = Array.isArray(codes) ? codes[0] : (codes || '');

        if (ws[addr]) {
          if (codeStr) {
            ws[addr].s = maakCelStijl(codeStr, kleurenMap,
              isWeekend ? { fill: { fgColor: { rgb: 'FFF2F2F2' } } } : null);
          } else if (isWeekend) {
            ws[addr].s = WEEKEND_BG;
          }

          // Cel-opmerking als Excel comment
          const opm = dag.cel_opmerkingen?.[radId];
          if (opm) {
            ws[addr].c = ws[addr].c || [];
            ws[addr].c.push({ a: 'Rooster', t: opm, hidden: true });
          }
        }
      });

      // Dienst/Bespr/Interventie/Opmerking – alleen weekend-grijs
      if (isWeekend) {
        const nRad = radKolommen.length;
        [2 + nRad, 3 + nRad, 4 + nRad, 5 + nRad].forEach(ci => {
          const addr = XLSX.utils.encode_cell({ r: excelRij, c: ci });
          if (ws[addr]) ws[addr].s = WEEKEND_BG;
        });
      }
    });

    // ---- Werkboek + download ----
    const sheetNaam = IMPORT_SHEET.replace(/\d{4}/, jaar);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetNaam);
    XLSX.writeFile(wb, `Indeling_${jaar}.xlsx`, { cellStyles: true, bookSST: false });

  } catch (e) {
    console.error('actExportJaar', e);
    alert('Export mislukt:\n\n' + (e.message || e));
  }
}
