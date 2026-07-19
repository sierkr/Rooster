// Excel-import: lees .xlsm/.xlsx, parse 'Indeling 2026'-sheet en schrijf
// naar Firestore. Cell-comments worden cel_opmerkingen, kolom S = dag-opm,
// P = dienst, Q = bespreking, R = interventie.
//
// Na het schrijven van indeling-docs worden open wensen automatisch
// gesynchroniseerd:
//  - Open wens die nu matcht met de geïmporteerde code → status 'verwerkt'
//  - Verwerkte wens die nu gebroken wordt door de import → status terug naar 'open'
import { doc, writeBatch, updateDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, IS_TEST_DB } from './firebase-init.js';
import { state, DAGEN_NL } from './state.js';
import { isoWeekVan, vandaagIso, plusDagen, kolomNaarRadId, wensMatcht, hoofdLetterCode } from './helpers.js';
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

// Wens-matching komt uit helpers.js (wensMatcht) — één canonieke
// implementatie, gedeeld met save.js.

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

    // SheetJS bewaart defined names in wb.Workbook.Names (niet wb.Defined —
    // dat veld bestaat niet en kon dus nooit true worden).
    const heeftWatermerk = wb.SheetNames.includes('_RoosterApp') ||
                           (wb.Workbook && Array.isArray(wb.Workbook.Names) &&
                            wb.Workbook.Names.some(d => d.Name === 'RoosterApp'));

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
    // BELANGRIJK: eerste match wint en de scan stopt bij 'Aantal'. Rechts van
    // 'Aantal' staan de functie-indicatorkolommen, met losse functieletters
    // als header die kunnen samenvallen met de datakolom-headers P/Q/R/S
    // (bv. indicator 'S' van Saendelft vs. de Opmerking-kolom 'S'). Zonder
    // deze grens versprong kolOpm naar de indicatorkolom en werden alle
    // dag-opmerkingen bij import vervangen door formule-restwaarden.
    let kolDienst = -1, kolBespr = -1, kolInterv = -1, kolOpm = -1;
    for (let c = 2; c <= range.e.c; c++) {
      const h = _celStr(ws[XLSX.utils.encode_cell({ c, r: headerRij })]);
      if (h === 'Aantal') break;
      if      (kolDienst < 0 && h === IMPORT_KOL_DIENST) kolDienst = c;
      else if (kolBespr  < 0 && h === IMPORT_KOL_BESPR)  kolBespr  = c;
      else if (kolInterv < 0 && h === IMPORT_KOL_INTERV) kolInterv = c;
      else if (kolOpm    < 0 && h === IMPORT_KOL_OPM)    kolOpm    = c;
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

    // K2 (v3.28.0): valideer de geparste dagen tegen de actieve validatie-
    // regels VOORDAT er geschreven wordt. Voorheen gold de regelvalidatie
    // alleen voor losse cel-bewerkingen in de app; een import kon blokkerende
    // conflicten stilzwijgend binnenbrengen.
    const regelConflicten = _valideerDagenTegenRegels(dagen);
    const regelBlokkades = regelConflicten.filter(c => c.ernst === 'blokkeren');
    const regelWaarschuwingen = regelConflicten.filter(c => c.ernst !== 'blokkeren');

    // Bereken wijzigingen t.o.v. huidige Firestore-data (voor preview)
    const vandaagPrev = vandaagIso();
    const grensPrev   = plusDagen(vandaagPrev, NABIJ_DAGEN);
    let totaalGewijzigd = 0;
    let nabijeCellen    = 0;
    const nabijeDatumsSet = new Set();
    const verschillen = []; // diagnose: welke cellen wijken af (max 200)
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
          if (verschillen.length < 200) {
            verschillen.push({ datum: dag.datum, stoel: radId, oud: oudeCodes, nieuw: nieuweCodes });
          }
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
      verschillen,
      regelBlokkades: regelBlokkades.slice(0, 50),
      regelBlokkadesTotaal: regelBlokkades.length,
      regelWaarschuwingen: regelWaarschuwingen.slice(0, 50),
      regelWaarschuwingenTotaal: regelWaarschuwingen.length,
    };
  } catch (e) {
    console.error('actImportFile', e);
    alert('Bestand inlezen mislukt:\n\n' + (e.message || e));
  } finally {
    state.importBezig = false;
    renderGebView();
  }
}

// K2 (v3.28.0): pas de actieve validatieregels toe op geparste import-dagen.
// Dekt de regeltypes limiet, conflict, uniciteit en bezetting — dezelfde
// semantiek als validatie.js/valideerWeek, maar dan op de Excel-data zelf
// (vóór het schrijven) i.p.v. op de al opgeslagen indeling.
// Returnt: [{ datum, radId, ernst, bericht }]
function _valideerDagenTegenRegels(dagen) {
  const conflicten = [];
  const actieveRegels = (state.validatieRegels || []).filter(r => r.actief !== false);
  if (actieveRegels.length === 0) return conflicten;

  for (const dag of dagen) {
    const dagNl = dag.dag;
    const isWeekend = dagNl === 'za' || dagNl === 'zo';
    const toewijzingen = dag.toewijzingen || {};

    // Per cel: limiet + conflict
    for (const [radId, codes] of Object.entries(toewijzingen)) {
      if (!codes || !codes.length) continue;
      const hoofd = codes.map(hoofdLetterCode);
      for (const regel of actieveRegels) {
        if (regel.type === 'limiet' && codes.length > (regel.max_codes || 2)) {
          conflicten.push({ datum: dag.datum, radId, ernst: regel.ernst, bericht: regel.bericht });
        }
        if (regel.type === 'conflict' && regel.code_blokkerend
            && hoofd.includes(regel.code_blokkerend) && codes.length > 1) {
          conflicten.push({ datum: dag.datum, radId, ernst: regel.ernst, bericht: regel.bericht });
        }
      }
    }

    // Per dag: uniciteit + bezetting
    for (const regel of actieveRegels) {
      if (regel.type === 'uniciteit') {
        const counts = {};
        for (const codes of Object.values(toewijzingen)) {
          (codes || []).forEach(c => {
            const h = hoofdLetterCode(c);
            if (regel.codes_uniek?.includes(h)) counts[h] = (counts[h] || 0) + 1;
          });
        }
        for (const [code, n] of Object.entries(counts)) {
          if (n > 1) {
            conflicten.push({
              datum: dag.datum, radId: null, ernst: regel.ernst,
              bericht: `${regel.bericht} (${n}× ${code})`,
            });
          }
        }
      }
      if (regel.type === 'bezetting' && regel.dag === dagNl && !isWeekend) {
        let aantalAanwezig = 0;
        for (const codes of Object.values(toewijzingen)) {
          if ((codes || []).some(c => hoofdLetterCode(c) === regel.code || c === regel.code)) {
            aantalAanwezig += 1;
          }
        }
        if (aantalAanwezig < regel.aantal) {
          conflicten.push({
            datum: dag.datum, radId: null, ernst: regel.ernst,
            bericht: `${regel.bericht} (nu ${aantalAanwezig})`,
          });
        }
      }
    }
  }
  return conflicten;
}

export async function actImportSchrijven(renderGebView) {
  const p = state.importPreview;
  if (!p || !p.dagen.length) return;
  // Rol-check i.p.v. permissie-check: de Firestore-rules staan indeling-writes
  // alleen toe aan de rol 'beheerder'. Een gebruiker met alleen de
  // mag_gebruikers-permissie zou anders halverwege de batch stranden met een
  // half geïmporteerde staat.
  if (state.profiel?.rol !== 'beheerder') {
    alert('Alleen een beheerder kan een import wegschrijven (Firestore-rechten).');
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

  // K2: blokkerende regelconflicten expliciet in de bevestiging benoemen
  const blokkadeWaarschuwing = (p.regelBlokkadesTotaal || 0) > 0
    ? `\n\n⛔ ${p.regelBlokkadesTotaal} BLOKKEREND regelconflict${p.regelBlokkadesTotaal === 1 ? '' : 'en'} in dit bestand (zie de rode lijst in de preview). Importeren negeert deze regels.`
    : '';

  const ok = confirm(
    `OVERSCHRIJVEN — ${jaarDeel} worden in Firestore vervangen door wat in '${p.bestandnaam}' staat.\n\n` +
    `${p.dagen.length} dagen, ${p.celOpmsAantal} cel-opmerkingen, ${p.dagOpmsAantal} dag-opmerkingen.\n\n` +
    `Wens-statussen worden automatisch bijgewerkt.` +
    nabijWaarschuwing +
    blokkadeWaarschuwing +
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

    // 1. Indeling wegschrijven — met behoud van app-only velden.
    //    Excel bevat alleen toewijzingen, dienst.dag, bespreking, interventie,
    //    dag-opmerking en cel-opmerkingen. Alle overige velden op het
    //    bestaande indeling-doc (vakantie_v uit de Vakantie-tab,
    //    dienst.avond/nacht, en eventuele toekomstige velden) moeten een
    //    import overleven — vóór deze fix wiste een export→import-cyclus
    //    stilzwijgend een heel jaar aan vakantieregistraties.
    const BATCH = 400;
    let geschreven = 0;
    for (let i = 0; i < p.dagen.length; i += BATCH) {
      const batch = writeBatch(db);
      const slice = p.dagen.slice(i, i + BATCH);
      slice.forEach(d => {
        const { id: _id, ...bestaandDoc } = state.indelingMap[d.datum] || {};
        const definitief = {
          ...bestaandDoc,  // app-only velden behouden (o.a. vakantie_v)
          ...d,            // Excel is leidend voor de geëxporteerde velden
          dienst: { ...(bestaandDoc.dienst || {}), dag: d.dienst?.dag || null },
        };
        batch.set(doc(db, 'indeling', d.datum), definitief);
      });
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
    // Schrijf in échte batches van 400 (writeBatch met auto-id docs) —
    // atomair per chunk i.p.v. 400 losse addDoc-calls.
    for (let i = 0; i < wijzWrites.length; i += 400) {
      const slice = wijzWrites.slice(i, i + 400);
      const wBatch = writeBatch(db);
      slice.forEach(w => wBatch.set(doc(collection(db, 'wijzigingen')), w));
      await wBatch.commit();
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
