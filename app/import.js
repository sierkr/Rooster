// Excel-import: lees .xlsm/.xlsx, parse 'Indeling 2026'-sheet en schrijf
// naar Firestore. Cell-comments worden cel_opmerkingen, kolom S = dag-opm,
// P = dienst, Q = bespreking, R = interventie.
//
// Na het schrijven van indeling-docs worden open wensen automatisch
// gesynchroniseerd:
//  - Open wens die nu matcht met de geïmporteerde code → status 'verwerkt'
//  - Verwerkte wens die nu gebroken wordt door de import → status terug naar 'open'
import { doc, writeBatch, updateDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, IS_TEST_DB } from './firebase-init.js';
import { state, DAGEN_NL } from './state.js';
import { isoWeekVan, magGebruikersBeheren, hoofdLetterCode, vandaagIso, plusDagen, kolomNaarRadId } from './helpers.js';
import { maakClientBackup } from './backup-client.js';

// Horizon: wijzigingen binnen N dagen worden als "nabij" beschouwd
const NABIJ_DAGEN = 30;

export const IMPORT_SHEET = 'Indeling 2026';
export const IMPORT_KOL_DIENST = 'P';
export const IMPORT_KOL_BESPR  = 'Q';
export const IMPORT_KOL_INTERV = 'R';
export const IMPORT_KOL_OPM    = 'S';
export const IMPORT_KOLOM_NAAR_RADID = {
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
    const m2 = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
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

// ---- Wens-matching (zelfde logica als save.js) ------------------------------
// Geeft terug of een code matcht met een wens-type.
function wensMatcht(type, voorkeurCode, primaireCode) {
  const hoofd = hoofdLetterCode(primaireCode);
  if (type === 'vakantie')         return hoofd === 'V';
  if (type === 'niet_beschikbaar') return !primaireCode || ['V','Z','K','Q'].includes(hoofd);
  if (type === 'voorkeur')         return hoofd === voorkeurCode;
  return false;
}

// Synchroniseer wens-statussen na import.
// Vergelijkt de geïmporteerde toewijzingen met state.wensen en werkt statussen bij:
//  - open wens die nu matcht → 'verwerkt'
//  - verwerkte wens die nu gebroken is → 'open'
// Retourneert { verwerkt: N, heropend: N } voor rapportage.
async function synchroniseerWensen(importDagen, importeerderUid) {
  // Bouw een map datum+radId → primaireCode vanuit de geïmporteerde data
  const nieuweToewijzingen = {}; // `${datum}|${radId}` → primaireCode
  for (const dag of importDagen) {
    for (const [radId, codes] of Object.entries(dag.toewijzingen || {})) {
      const prima = Array.isArray(codes) ? (codes[0] || '') : (codes || '');
      nieuweToewijzingen[`${dag.datum}|${radId}`] = prima;
    }
  }

  const datums = new Set(importDagen.map(d => d.datum));
  const relevanteWensen = state.wensen.filter(w => datums.has(w.datum));

  const updates = []; // { id, nieuweStatus }
  for (const w of relevanteWensen) {
    const sleutel = `${w.datum}|${w.radioloog_id}`;
    const primaireCode = nieuweToewijzingen[sleutel] ?? null;
    const huidigStatus = w.status || 'open';
    const matcht = wensMatcht(w.type, w.voorkeur_code, primaireCode);

    if (huidigStatus === 'open' && matcht) {
      updates.push({ id: w.id, nieuweStatus: 'verwerkt' });
    } else if (huidigStatus === 'verwerkt' && !matcht) {
      updates.push({ id: w.id, nieuweStatus: 'open' });
    }
  }

  let verwerkt = 0, heropend = 0;
  for (const upd of updates) {
    try {
      if (upd.nieuweStatus === 'verwerkt') {
        await updateDoc(doc(db, 'wensen', upd.id), {
          status: 'verwerkt',
          verwerkt_op: serverTimestamp(),
          verwerkt_door: importeerderUid,
          toelichting: 'Auto-verwerkt bij Excel-import',
        });
        verwerkt++;
      } else {
        await updateDoc(doc(db, 'wensen', upd.id), {
          status: 'open',
          verwerkt_op: null,
          verwerkt_door: null,
          toelichting: null,
        });
        heropend++;
      }
    } catch (e) {
      console.warn('synchroniseerWensen: updateDoc mislukt voor', upd.id, e);
    }
  }
  return { verwerkt, heropend };
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

    // ---- Sheetnaam bepalen --------------------------------------------------
    // Volgorde:
    // 1. Watermerk aanwezig (named range 'RoosterApp') → zoek sheet met Dag/Datum-header
    // 2. Klassiek patroon 'Indeling YYYY' → gebruik die sheet
    // 3. Geforceerd jaar via state.importJaar → gebruik die sheet
    // 4. Geen herkenning → foutmelding

    const heeftWatermerk = wb.SheetNames.includes('_RoosterApp') ||
                           (wb.Defined && wb.Defined.some(d => d.Name === 'RoosterApp'));

    let sheetNaam = null;

    if (heeftWatermerk) {
      // Nieuw formaat: zoek in alle sheets naar de eerste met Dag/Datum-header
      for (const naam of wb.SheetNames) {
        const ws = wb.Sheets[naam];
        if (!ws || !ws['!ref']) continue;
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let r = range.s.r; r <= Math.min(range.s.r + 60, range.e.r); r++) {
          const aCel = ws[XLSX.utils.encode_cell({ c: 0, r })];
          const bCel = ws[XLSX.utils.encode_cell({ c: 1, r })];
          if (_celStr(aCel) === 'Dag' && _celStr(bCel) === 'Datum') {
            sheetNaam = naam;
            break;
          }
        }
        if (sheetNaam) break;
      }
      if (!sheetNaam) throw new Error('Rooster-bestand herkend (watermerk aanwezig) maar geen sheet met Dag/Datum-header gevonden.');
    } else {
      // Oud formaat of handmatig jaar: zoek op sheetnaam-patroon
      if (state.importJaar) {
        sheetNaam = IMPORT_SHEET.replace(/\d{4}/, state.importJaar);
      } else {
        sheetNaam = wb.SheetNames.find(n => /^Indeling \d{4}$/.test(n)) || IMPORT_SHEET;
      }
      if (!wb.Sheets[sheetNaam]) {
        throw new Error(`Sheet '${sheetNaam}' niet gevonden. Aanwezig: ${wb.SheetNames.join(', ')}\n\nTip: zorg dat het hoofdblad 'Indeling [jaar]' heet, of exporteer opnieuw vanuit de app.`);
      }
    }

    const ws = wb.Sheets[sheetNaam];
    const ref = ws['!ref'];
    const range = XLSX.utils.decode_range(ref);

    let headerRij = -1;
    for (let r = range.s.r; r <= Math.min(range.s.r + 60, range.e.r); r++) {
      const aCel = ws[XLSX.utils.encode_cell({ c: 0, r })];
      const bCel = ws[XLSX.utils.encode_cell({ c: 1, r })];
      if (_celStr(aCel) === 'Dag' && _celStr(bCel) === 'Datum') { headerRij = r; break; }
    }
    if (headerRij < 0) throw new Error("Header-rij ('Dag' / 'Datum') niet gevonden in sheet.");

    const waarschuwingen = [];

    // Verborgen kolom-mapping (code → stoel-id) zoals geldig bij export. Hiermee
    // koppelt de import elke kolom op de juiste, stabiele stoel — ook na een
    // wissel, los van wie er nu op die stoel zit. Ontbreekt deze sheet (vreemd/
    // oud bestand), dan valt de import terug op de code-mapping.
    const fileKolMap = {};
    const mapSheet = wb.Sheets['_kolommen'];
    if (mapSheet && mapSheet['!ref']) {
      const mr = XLSX.utils.decode_range(mapSheet['!ref']);
      for (let r = mr.s.r + 1; r <= mr.e.r; r++) {
        const code  = _celStr(mapSheet[XLSX.utils.encode_cell({ c: 0, r })]);
        const stoel = _celStr(mapSheet[XLSX.utils.encode_cell({ c: 1, r })]);
        if (code && stoel) fileKolMap[code] = stoel;
      }
    }
    const heeftFileMap = Object.keys(fileKolMap).length > 0;

    // Zoek Dienst/Bespr/Interv/Opm eerst op naam — die markeren het einde van de
    // radioloog-zone (kolommen C t/m vóór Dienst).
    let kolDienst = -1, kolBespr = -1, kolInterv = -1, kolOpm = -1;
    for (let c = 2; c <= range.e.c; c++) {
      const h = _celStr(ws[XLSX.utils.encode_cell({ c, r: headerRij })]);
      if (h === IMPORT_KOL_DIENST) kolDienst = c;
      else if (h === IMPORT_KOL_BESPR)  kolBespr  = c;
      else if (h === IMPORT_KOL_INTERV) kolInterv = c;
      else if (h === IMPORT_KOL_OPM)    kolOpm    = c;
    }
    // Fallback naar vaste kolomposities als header niet gevonden
    if (kolDienst < 0) kolDienst = XLSX.utils.decode_col(IMPORT_KOL_DIENST);
    if (kolBespr  < 0) kolBespr  = XLSX.utils.decode_col(IMPORT_KOL_BESPR);
    if (kolInterv < 0) kolInterv = XLSX.utils.decode_col(IMPORT_KOL_INTERV);
    if (kolOpm    < 0) kolOpm    = XLSX.utils.decode_col(IMPORT_KOL_OPM);

    // Radioloog-kolommen: alleen de zone vóór de Dienst-kolom.
    const radZoneEind = (kolDienst >= 2 ? kolDienst : range.e.c + 1) - 1;
    const dynMap = Object.keys(kolomNaarRadId()).length > 0 ? kolomNaarRadId() : IMPORT_KOLOM_NAAR_RADID;
    const kolNaarRadId = {};
    const gevondenCodes = new Set();
    for (let c = 2; c <= radZoneEind; c++) {
      const headerVal = _celStr(ws[XLSX.utils.encode_cell({ c, r: headerRij })]);
      if (!headerVal) continue;
      // Eerst stabiele stoel-id uit het bestand, anders code-fallback.
      const radId = fileKolMap[headerVal] || dynMap[headerVal];
      if (radId) {
        kolNaarRadId[c] = radId;
        gevondenCodes.add(headerVal);
      } else {
        waarschuwingen.push(`Kolom '${headerVal}' kon niet aan een stoel gekoppeld worden — die kolom is NIET geïmporteerd.`);
      }
    }
    // Bij een app-bestand: meld kolommen die volgens de mapping verwacht werden
    // maar ontbreken in het blad.
    if (heeftFileMap) {
      Object.keys(fileKolMap).forEach(code => {
        if (!gevondenCodes.has(code)) {
          waarschuwingen.push(`Verwachte kolom '${code}' (stoel ${fileKolMap[code]}) ontbreekt in het blad.`);
        }
      });
    }

    const dagen = [];
    let celOpmsAantal = 0, dagOpmsAantal = 0, dienstAantal = 0, besprAantal = 0, intervAantal = 0;

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

    // Bereken wijzigingen t.o.v. huidige Firestore-data (voor preview)
    const vandaagPrev = vandaagIso();
    const grensPrev   = plusDagen(vandaagPrev, NABIJ_DAGEN);
    let totaalGewijzigd = 0;
    let nabijeCellen    = 0;
    const nabijeDatumsSet = new Set();
    for (const dag of dagen) {
      const bestaand      = state.indelingMap[dag.datum];
      const nieuweTwz     = dag.toewijzingen || {};
      const oudeTwz       = bestaand?.toewijzingen || {};
      // Verzamel alle radId's: zowel in Excel als in Firestore (om verwijderingen te vangen)
      const alleRadIds    = new Set([...Object.keys(nieuweTwz), ...Object.keys(oudeTwz)]);
      for (const radId of alleRadIds) {
        const nieuweCodes = nieuweTwz[radId] || [];
        const oudeCodes   = oudeTwz[radId]   || [];
        if (JSON.stringify(oudeCodes) !== JSON.stringify(nieuweCodes)) {
          totaalGewijzigd++;
          if (dag.datum >= vandaagPrev && dag.datum <= grensPrev) {
            nabijeCellen++;
            nabijeDatumsSet.add(dag.datum);
          }
        }
      }
    }

    state.importPreview = {
      bestandnaam: file.name,
      dagen,
      celOpmsAantal, dagOpmsAantal, dienstAantal, besprAantal, intervAantal,
      waarschuwingen: waarschuwingen.slice(0, 25),
      waarschuwingenTotaal: waarschuwingen.length,
      totaalGewijzigd,
      nabijeCellen,
      nabijeDagen: nabijeDatumsSet.size,
      nabijeDagsList: [...nabijeDatumsSet].sort(),
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
  // Tel wijzigingen binnen de 30-dagengrens vóór bevestiging
  const vandaag = vandaagIso();
  const grens   = plusDagen(vandaag, NABIJ_DAGEN);
  let nabijeCellen = 0;
  const nabijeDatums = new Set();
  for (const dag of p.dagen) {
    if (dag.datum < vandaag || dag.datum > grens) continue;
    const bestaand = state.indelingMap[dag.datum];
    for (const [radId, nieuweCodes] of Object.entries(dag.toewijzingen || {})) {
      const oudeCodes = bestaand?.toewijzingen?.[radId] || [];
      if (JSON.stringify(oudeCodes) !== JSON.stringify(nieuweCodes)) {
        nabijeCellen++;
        nabijeDatums.add(dag.datum);
      }
    }
  }

  const jaarDeel = state.importJaar ? `alle ${state.importJaar}-dagen` : `alle dagen in het bestand`;
  const nabijWaarschuwing = nabijeCellen > 0
    ? `\n\n⚠ LET OP: ${nabijeCellen} toewijzing${nabijeCellen === 1 ? '' : 'en'} worden gewijzigd binnen ${NABIJ_DAGEN} dagen (${nabijeDatums.size} dag${nabijeDatums.size === 1 ? '' : 'en'}). Betrokken radiologen krijgen een notificatie.`
    : '';

  const ok = confirm(
    `OVERSCHRIJVEN — ${jaarDeel} worden in Firestore vervangen door wat in '${p.bestandnaam}' staat.\n\n` +
    `${p.dagen.length} dagen, ${p.celOpmsAantal} cel-opmerkingen, ${p.dagOpmsAantal} dag-opmerkingen.\n\n` +
    `Wens-statussen worden automatisch bijgewerkt.` +
    nabijWaarschuwing +
    `\n\nBestaande data in Firestore wordt vervangen. Doorgaan?`
  );
  if (!ok) return;

  state.importBezig = true;
  renderGebView();
  try {
    // 0. Backup vóór schrijven — download JSON zodat altijd teruggedraaid kan worden.
    //    In de testomgeving is een backup geblokkeerd; dan slaan we deze stap
    //    over (testdata hoeft niet veiliggesteld te worden).
    if (!IS_TEST_DB) {
      try {
        const backupResultaat = await maakClientBackup('voor-import');
        if (backupResultaat === null) {
          // Gebruiker heeft wachtwoord-prompt geannuleerd — geen backup gemaakt
          const doorgaan = confirm(
            'De backup is niet gemaakt omdat het wachtwoord werd geannuleerd.\n\n' +
            'Zonder backup kun je de import niet terugdraaien als er iets misgaat.\n\n' +
            'Wil je toch doorgaan zonder backup?'
          );
          if (!doorgaan) {
            state.importBezig = false;
            renderGebView();
            return;
          }
        }
      } catch (backupErr) {
        console.warn('Backup mislukt (import gaat wel door):', backupErr);
      }
    }

    // 1. Indeling wegschrijven
    const BATCH = 400;
    let geschreven = 0;
    for (let i = 0; i < p.dagen.length; i += BATCH) {
      const batch = writeBatch(db);
      const slice = p.dagen.slice(i, i + BATCH);
      slice.forEach(d => batch.set(doc(db, 'indeling', d.datum), d));
      await batch.commit();
      geschreven += slice.length;
    }

    // 2. Wijziging-docs schrijven voor gewijzigde cellen (gezien: false)
    // vandaag en grens zijn al berekend vóór de bevestiging
    let wijzigingenGeschreven = 0;
    const wijzWrites = [];
    for (const dag of p.dagen) {
      if (dag.datum < vandaag || dag.datum > grens) continue;
      const bestaand = state.indelingMap[dag.datum];
      for (const [radId, nieuweCodes] of Object.entries(dag.toewijzingen || {})) {
        const oudeCodes = bestaand?.toewijzingen?.[radId] || [];
        if (JSON.stringify(oudeCodes) === JSON.stringify(nieuweCodes)) continue;
        wijzWrites.push({
          uid: state.user?.uid || 'import',
          email: state.profiel?.email || 'import',
          datum: dag.datum,
          radioloog_id: radId,
          van: oudeCodes,
          naar: nieuweCodes,
          wanneer: serverTimestamp(),
          gezien: false,
        });
      }
    }
    // Schrijf in batches van 400
    for (let i = 0; i < wijzWrites.length; i += 400) {
      const slice = wijzWrites.slice(i, i + 400);
      await Promise.all(slice.map(w => addDoc(collection(db, 'wijzigingen'), w)));
      wijzigingenGeschreven += slice.length;
    }

    // 3. Wens-statussen synchroniseren
    const { verwerkt, heropend } = await synchroniseerWensen(
      p.dagen,
      state.user?.uid || 'import'
    );

    let berichtDelen = [`${geschreven} dagen weggeschreven.`];
    if (wijzigingenGeschreven > 0) berichtDelen.push(`${wijzigingenGeschreven} cel${wijzigingenGeschreven === 1 ? '' : 'len'} gemarkeerd als ongelezen voor betrokken radiologen.`);
    if (verwerkt > 0)  berichtDelen.push(`${verwerkt} wens${verwerkt === 1 ? '' : 'en'} automatisch verwerkt.`);
    if (heropend > 0)  berichtDelen.push(`${heropend} wens${heropend === 1 ? '' : 'en'} teruggezet naar 'open' (indeling klopt niet meer).`);
    alert('Klaar. ' + berichtDelen.join('\n'));

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
