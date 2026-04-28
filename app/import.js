// Excel-import: lees .xlsm/.xlsx, parse 'Indeling 2026'-sheet en schrijf
// naar Firestore. Cell-comments worden cel_opmerkingen, kolom S = dag-opm,
// P = dienst, Q = bespreking, R = interventie.
import { doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';
import { state, DAGEN_NL } from './state.js';
import { isoWeekVan, magGebruikersBeheren } from './helpers.js';

export const IMPORT_SHEET = 'Indeling 2026';
const IMPORT_KOL_DIENST = 'P';
const IMPORT_KOL_BESPR  = 'Q';
const IMPORT_KOL_INTERV = 'R';
const IMPORT_KOL_OPM    = 'S';
const IMPORT_KOLOM_NAAR_RADID = {
  'BL': 'L', 'KdP': 'P', 'HvV': 'V', 'GF': 'F',
  'SK': 'K', 'FvH': 'H', 'SF': 'S', 'BJ': 'J',
  'W5': 'W5', 'W4': 'W4', 'W3': 'W3', 'W2': 'W2', 'W1': 'W1',
};

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

function _parseDatumCel(v) {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
  }
  if (typeof v === 'number') {
    const ms = (v - 25569) * 86400000;
    const d = new Date(ms + 12 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const m2 = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (m2) return `${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  }
  return null;
}

function _celStr(cel) {
  if (!cel) return null;
  const v = cel.w !== undefined ? cel.w : cel.v;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function _celComment(cel) {
  if (!cel || !cel.c || !cel.c.length) return null;
  return cel.c.map(c => (c.t || '').trim()).filter(Boolean).join('\n') || null;
}

// Parse-functie wordt aangeroepen vanuit de Gebruikers-view; de view zelf
// re-rendert na elke statuswijziging via een callback (renderGebView).
export async function actImportFile(input, renderGebView) {
  const file = input?.files?.[0];
  if (!file) return;
  state.importBezig = true;
  state.importPreview = null;
  renderGebView();
  try {
    const XLSX = await laadSheetJS();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { cellComments: true, cellDates: true });
    if (!wb.Sheets[IMPORT_SHEET]) {
      throw new Error(`Sheet '${IMPORT_SHEET}' niet gevonden. Aanwezig: ${wb.SheetNames.join(', ')}`);
    }
    const ws = wb.Sheets[IMPORT_SHEET];
    const ref = ws['!ref'];
    const range = XLSX.utils.decode_range(ref);

    let headerRij = -1;
    for (let r = range.s.r; r <= Math.min(range.s.r + 60, range.e.r); r++) {
      const aCel = ws[XLSX.utils.encode_cell({ c: 0, r })];
      const bCel = ws[XLSX.utils.encode_cell({ c: 1, r })];
      if (_celStr(aCel) === 'Dag' && _celStr(bCel) === 'Datum') { headerRij = r; break; }
    }
    if (headerRij < 0) throw new Error("Header-rij ('Dag' / 'Datum') niet gevonden in sheet.");

    const kolNaarRadId = {};
    for (let c = 2; c <= range.e.c; c++) {
      const headerVal = _celStr(ws[XLSX.utils.encode_cell({ c, r: headerRij })]);
      if (!headerVal) continue;
      const radId = IMPORT_KOLOM_NAAR_RADID[headerVal];
      if (radId) kolNaarRadId[c] = radId;
    }

    const kolDienst = XLSX.utils.decode_col(IMPORT_KOL_DIENST);
    const kolBespr  = XLSX.utils.decode_col(IMPORT_KOL_BESPR);
    const kolInterv = XLSX.utils.decode_col(IMPORT_KOL_INTERV);
    const kolOpm    = XLSX.utils.decode_col(IMPORT_KOL_OPM);

    const dagen = [];
    let celOpmsAantal = 0, dagOpmsAantal = 0, dienstAantal = 0, besprAantal = 0, intervAantal = 0;
    const waarschuwingen = [];

    for (let r = headerRij + 1; r <= range.e.r; r++) {
      const datumCel = ws[XLSX.utils.encode_cell({ c: 1, r })];
      const isoDatum = _parseDatumCel(datumCel?.v);
      if (!isoDatum) continue;
      if (state.importJaar && !isoDatum.startsWith(state.importJaar + '-')) continue;

      const d = new Date(isoDatum + 'T12:00:00');
      const dagNlIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;

      const toewijzingen = {};
      const cel_opmerkingen = {};
      Object.entries(kolNaarRadId).forEach(([cStr, radId]) => {
        const c = parseInt(cStr, 10);
        const cel = ws[XLSX.utils.encode_cell({ c, r })];
        const code = _celStr(cel);
        if (code) {
          const codes = code.includes(',') ? code.split(',').map(x => x.trim()).filter(Boolean) : [code];
          toewijzingen[radId] = codes;
        }
        const opm = _celComment(cel);
        if (opm) {
          cel_opmerkingen[radId] = opm;
          celOpmsAantal++;
        }
      });

      const dienstStr = _celStr(ws[XLSX.utils.encode_cell({ c: kolDienst, r })]);
      const besprStr  = _celStr(ws[XLSX.utils.encode_cell({ c: kolBespr,  r })]);
      const intervStr = _celStr(ws[XLSX.utils.encode_cell({ c: kolInterv, r })]);
      const opmStr    = _celStr(ws[XLSX.utils.encode_cell({ c: kolOpm,    r })]);

      const docData = {
        datum: isoDatum,
        weeknr: isoWeekVan(isoDatum),
        dag: DAGEN_NL[dagNlIdx],
        toewijzingen,
        dienst: dienstStr ? { dag: dienstStr } : {},
        bespreking: besprStr || null,
        interventie: intervStr || null,
        opmerking: opmStr || null,
        cel_opmerkingen,
      };

      if (dienstStr) dienstAantal++;
      if (besprStr) besprAantal++;
      if (intervStr) intervAantal++;
      if (opmStr) dagOpmsAantal++;

      if (dienstStr && !state.radiologen.find(rr => rr.id === dienstStr)) {
        waarschuwingen.push(`${isoDatum}: dienst-id '${dienstStr}' niet bekend`);
      }

      dagen.push(docData);
    }

    state.importPreview = {
      bestandnaam: file.name,
      dagen,
      celOpmsAantal, dagOpmsAantal, dienstAantal, besprAantal, intervAantal,
      waarschuwingen: waarschuwingen.slice(0, 25),
      waarschuwingenTotaal: waarschuwingen.length,
    };
  } catch (e) {
    console.error('actImportFile', e);
    alert('Bestand inlezen mislukt:\n\n' + (e.message || e));
  } finally {
    state.importBezig = false;
    renderGebView();
  }
}

export async function actImportSchrijven(renderGebView) {
  const p = state.importPreview;
  if (!p || !p.dagen.length) return;
  if (!magGebruikersBeheren()) {
    alert('Geen rechten voor schrijven.');
    return;
  }
  const jaarDeel = state.importJaar ? `alle ${state.importJaar}-dagen` : `alle dagen in het bestand`;
  const ok = confirm(
    `OVERSCHRIJVEN — ${jaarDeel} worden in Firestore vervangen door wat in '${p.bestandnaam}' staat.\n\n` +
    `${p.dagen.length} dagen, ${p.celOpmsAantal} cel-opmerkingen, ${p.dagOpmsAantal} dag-opmerkingen.\n\n` +
    `Bestaande data in Firestore wordt vervangen. Doorgaan?`
  );
  if (!ok) return;

  state.importBezig = true;
  renderGebView();
  try {
    const BATCH = 400;
    let geschreven = 0;
    for (let i = 0; i < p.dagen.length; i += BATCH) {
      const batch = writeBatch(db);
      const slice = p.dagen.slice(i, i + BATCH);
      slice.forEach(d => batch.set(doc(db, 'indeling', d.datum), d));
      await batch.commit();
      geschreven += slice.length;
    }
    alert(`Klaar. ${geschreven} dagen weggeschreven.`);
    state.importPreview = null;
  } catch (e) {
    console.error('actImportSchrijven', e);
    alert('Schrijven mislukt:\n\n' + (e.message || e));
  } finally {
    state.importBezig = false;
    renderGebView();
  }
}

export function actImportAnnuleren(renderGebView) {
  state.importPreview = null;
  renderGebView();
}

export function actZetImportJaar(jaar) {
  state.importJaar = jaar || '';
}
