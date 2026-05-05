// Excel-export: lees Firestore-indeling voor een gekozen jaar en schrijf
// een .xlsx in hetzelfde formaat als de import (sheet 'Indeling 2026',
// kolommen Dag/Datum/radiologen/P/Q/R/S).
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';
import { IMPORT_SHEET, IMPORT_KOL_DIENST, IMPORT_KOL_BESPR, IMPORT_KOL_INTERV, IMPORT_KOL_OPM, IMPORT_KOLOM_NAAR_RADID } from './import.js';

// Omgekeerde mapping: radId -> kolomhoofd
const RADID_NAAR_KOLOM = Object.fromEntries(
  Object.entries(IMPORT_KOLOM_NAAR_RADID).map(([k, v]) => [v, k])
);

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

    // Kolom-volgorde: Dag, Datum, dan radiologen in vaste volgorde, dan P/Q/R/S
    const radKolommen = Object.keys(IMPORT_KOLOM_NAAR_RADID); // bijv. ['BL','KdP', ...]
    const headers = ['Dag', 'Datum', ...radKolommen,
      IMPORT_KOL_DIENST, IMPORT_KOL_BESPR, IMPORT_KOL_INTERV, IMPORT_KOL_OPM];

    const DAGEN_NL_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

    // Bouw worksheet data
    const wsData = [headers];
    for (const dag of dagen) {
      const d = new Date(dag.datum + 'T12:00:00');
      const dagNlIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const rij = [
        DAGEN_NL_KORT[dagNlIdx],
        dag.datum,
      ];
      // Radioloog-kolommen
      for (const kolHoofd of radKolommen) {
        const radId = IMPORT_KOLOM_NAAR_RADID[kolHoofd];
        const codes = dag.toewijzingen?.[radId];
        rij.push(Array.isArray(codes) ? codes.join(',') : (codes || ''));
      }
      // P/Q/R/S
      rij.push(dag.dienst?.dag || '');
      rij.push(dag.bespreking || '');
      rij.push(dag.interventie || '');
      rij.push(dag.opmerking || '');
      wsData.push(rij);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Sheet-naam zelfde als import maar met het juiste jaar
    const sheetNaam = IMPORT_SHEET.replace(/\d{4}/, jaar);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetNaam);

    XLSX.writeFile(wb, `Indeling_${jaar}.xlsx`);
  } catch (e) {
    console.error('actExportJaar', e);
    alert('Export mislukt:\n\n' + (e.message || e));
  }
}
