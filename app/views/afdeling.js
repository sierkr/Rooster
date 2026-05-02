// Afdeling-view: per dag wie wat doet, gesorteerd op functie/aanwezigheid.
import { state, SLOTS, DAGEN_LANG, DAGEN_NL } from '../state.js';
import {
  vasteRads, vasteRadsOpDatum, functiesMap, vandaagIso, formatDatum, functieNaam,
  toewijzingVoor, huidigKalenderJaar, magBeheerLezen,
  mandagVanIso, datumsVanWeek,
} from '../helpers.js';

export function renderAfdView() {
  const container = document.getElementById('view-afd');
  const datum = state.huidigeDatum || vandaagIso();
  const dag = state.indelingMap[datum];
  const vandaag = vandaagIso();

  let html = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <p class="muted" style="margin: 0 0 2px;">${formatDatum(datum, 'lang')}${new Date(datum+'T12:00:00').getFullYear() !== huidigKalenderJaar() ? ' ' + new Date(datum+'T12:00:00').getFullYear() : ''}</p>
          <p style="font-size: 17px; font-weight: 500; margin: 0;">Wie doet wat</p>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="nav-btn" onclick="window.exportAfdWeek()" title="Exporteer hele week naar Excel">\uD83D\uDCC2</button>
          <button class="nav-btn" onclick="window.printAfdWeek()" title="Print hele week landscape">\uD83D\uDDA8</button>
          <button class="nav-btn" onclick="window.navigeerDag(-1)">\u2039</button>
          <button class="nav-btn" onclick="window.navigeerDag(1)">\u203a</button>
        </div>
      </div>
      ${datum !== vandaag ? `<button class="nav-btn today" onclick="window.naarVandaag()" style="margin-top: 10px;">Naar vandaag</button>` : ''}
    </div>
  `;

  if (!dag) {
    html += `<div class="empty-state"><div class="empty-state-icon">·</div>Geen indeling voor deze dag</div>`;
  } else {
    const beperkt = !magBeheerLezen();
    // Privacy-gevoelige codes die voor gebruikers zonder Overzicht-rechten
    // verborgen blijven.
    const VERBORGEN_CODES = ['V', 'Z', 'K'];

    const items = [];
    vasteRads().forEach(r => {
      const codes = toewijzingVoor(datum, r.id);
      if (codes.length === 0) return;
      const hoofdLetters = codes.map(c => c.charAt(0).toUpperCase());
      // Bij beperkt zicht: hele item verbergen als ÉÉN van de codes privacy-gevoelig is
      if (beperkt && hoofdLetters.some(l => VERBORGEN_CODES.includes(l))) return;

      // Functienaam zonder "/Echo"-suffix etc.
      const eersteDeel = (code) => {
        const f = functiesMap()[code];
        const naam = f?.naam || functieNaam(code);
        return naam.split('/')[0];
      };

      const hoofdCode = codes[0];
      const isAfwezig = ['V', 'Z', 'A', 'K', 'Q', 'T'].includes(hoofdLetters[0]);
      // Naam: bij duo voluit met "/" tussen beide functienamen
      const naam = codes.length === 2
        ? `${eersteDeel(codes[0])}/${eersteDeel(codes[1])}`
        : (functiesMap()[hoofdCode]?.naam || functieNaam(hoofdCode));
      items.push({ rad: r, code: hoofdCode, codes, naam, isAfwezig });
    });
    items.sort((a, b) => { if (a.isAfwezig !== b.isAfwezig) return a.isAfwezig ? 1 : -1; return a.naam.localeCompare(b.naam); });

    items.forEach(it => {
      const kleur = functiesMap()[it.code]?.kleur || '#ccc';
      if (it.isAfwezig) {
        html += `<div class="afd-item inactive"><div><div class="afd-item-title">${it.rad.code} · ${it.rad.achternaam}</div><div class="afd-item-sub">${it.naam}</div></div></div>`;
      } else {
        html += `<div class="afd-item"><div><div class="afd-item-title">${it.naam}</div><div class="afd-item-sub">${it.rad.code} · ${it.rad.achternaam}</div></div><div class="dot" style="background: ${kleur};"></div></div>`;
      }
    });

    const weekRads = SLOTS.map(s => ({ slot: s, codes: toewijzingVoor(datum, s) })).filter(x => x.codes.length > 0);
    if (weekRads.length > 0) {
      html += `<div class="summary"><div class="summary-label">Waarnemers</div><div class="summary-text">${weekRads.map(w => `${w.slot}: ${w.codes.join(', ')}`).join(' · ')}</div></div>`;
    }
    if (dag.bespreking)  html += `<div class="summary"><div class="summary-label">Bespreking</div><div class="summary-text">${dag.bespreking}</div></div>`;
    if (dag.interventie) html += `<div class="summary"><div class="summary-label">Interventie</div><div class="summary-text">${dag.interventie}</div></div>`;
    if (dag.opmerking)   html += `<div class="summary"><div class="summary-label">Opmerking</div><div class="summary-text">${dag.opmerking}</div></div>`;
  }

  container.innerHTML = html;
}

// ----- Print hele week landscape -----------------------------------------

window.printAfdWeek = function() {
  const datum = state.huidigeDatum || vandaagIso();
  const maandag = mandagVanIso(datum);
  const datums = datumsVanWeek(maandag);
  const beperkt = !magBeheerLezen();
  const VERBORGEN_CODES = ['V', 'Z', 'K'];
  const fmap = functiesMap();
  const rads = vasteRads();

  const eersteDeel = (code) => {
    const f = fmap[code];
    const naam = f?.naam || functieNaam(code);
    return naam.split('/')[0];
  };

  // Bouw kolommen: één per dag (ma t/m zo)
  const kolommen = datums.map(iso => {
    const d = new Date(iso + 'T12:00:00');
    const dagLang = DAGEN_LANG[d.getDay() === 0 ? 6 : d.getDay() - 1];
    const dagLabel = `${dagLang.charAt(0).toUpperCase() + dagLang.slice(1)} ${d.getDate()}-${d.getMonth()+1}`;
    const dagData = state.indelingMap[iso];

    let inhoud = '';
    if (!dagData) {
      inhoud = '<div class="leeg">—</div>';
    } else {
      const items = [];
      rads.forEach(r => {
        const codes = toewijzingVoor(iso, r.id);
        if (codes.length === 0) return;
        const hoofdLetters = codes.map(c => c.charAt(0).toUpperCase());
        if (beperkt && hoofdLetters.some(l => VERBORGEN_CODES.includes(l))) return;
        const hoofdCode = codes[0];
        const isAfwezig = ['V', 'Z', 'A', 'K', 'Q', 'T'].includes(hoofdLetters[0]);
        const naam = codes.length === 2
          ? `${eersteDeel(codes[0])}/${eersteDeel(codes[1])}`
          : (fmap[hoofdCode]?.naam || functieNaam(hoofdCode));
        const kleur = fmap[hoofdCode]?.kleur || '#ccc';
        items.push({ rad: r, code: hoofdCode, naam, isAfwezig, kleur });
      });
      items.sort((a, b) => {
        if (a.isAfwezig !== b.isAfwezig) return a.isAfwezig ? 1 : -1;
        return a.naam.localeCompare(b.naam);
      });

      items.forEach(it => {
        if (it.isAfwezig) {
          inhoud += `<div class="item afwezig"><div class="t">${it.rad.code} \u00b7 ${it.rad.achternaam}</div><div class="s">${it.naam}</div></div>`;
        } else {
          inhoud += `<div class="item"><div class="dot" style="background:${it.kleur};"></div><div><div class="t">${it.naam}</div><div class="s">${it.rad.code} \u00b7 ${it.rad.achternaam}</div></div></div>`;
        }
      });

      // Waarnemers + opmerkingen
      const weekRads = SLOTS.map(s => ({ slot: s, codes: toewijzingVoor(iso, s) })).filter(x => x.codes.length > 0);
      if (weekRads.length > 0) {
        inhoud += `<div class="extra"><span class="lbl">Waarnemers:</span> ${weekRads.map(w => `${w.slot}: ${w.codes.join(', ')}`).join(' \u00b7 ')}</div>`;
      }
      if (dagData.bespreking)  inhoud += `<div class="extra"><span class="lbl">Bespreking:</span> ${dagData.bespreking}</div>`;
      if (dagData.interventie) inhoud += `<div class="extra"><span class="lbl">Interventie:</span> ${dagData.interventie}</div>`;
      if (dagData.opmerking)   inhoud += `<div class="extra"><span class="lbl">Opmerking:</span> ${dagData.opmerking}</div>`;
    }

    return `<div class="dag"><div class="kop">${dagLabel}</div>${inhoud}</div>`;
  }).join('');

  const eindDatum = datums[datums.length - 1];
  const eind = new Date(eindDatum + 'T12:00:00');
  const start = new Date(maandag + 'T12:00:00');
  const titelTekst = `Week ${start.getDate()}-${start.getMonth()+1} t/m ${eind.getDate()}-${eind.getMonth()+1}-${eind.getFullYear()}`;

  const printDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${titelTekst}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; color: #2c2c2a; font-size: 10px; }
  h1 { font-size: 14px; margin: 0 0 6px; }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .dag { border: 1px solid #999; border-radius: 4px; padding: 4px; min-height: 100px; page-break-inside: avoid; }
  .kop { font-weight: 600; font-size: 11px; padding: 2px 0 4px; border-bottom: 1px solid #ccc; margin-bottom: 4px; }
  .item { display: flex; align-items: center; gap: 4px; padding: 2px 0; border-bottom: 0.5px solid #eee; }
  .item .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .item .t { font-weight: 500; }
  .item .s { color: #666; font-size: 9px; }
  .item.afwezig { color: #888; font-style: italic; }
  .extra { margin-top: 4px; padding-top: 3px; border-top: 0.5px dashed #ccc; font-size: 9px; }
  .extra .lbl { font-weight: 600; }
  .leeg { color: #aaa; font-style: italic; padding: 8px 0; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<h1>${titelTekst}</h1>
<div class="grid">${kolommen}</div>
<script>window.onload = function() { setTimeout(function() { window.print(); }, 200); };<\/script>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up geblokkeerd. Sta pop-ups toe en probeer opnieuw.'); return; }
  w.document.open();
  w.document.write(printDoc);
  w.document.close();
};

// ----- Export hele week naar Excel ---------------------------------------

// Voor cell-styling (borders, fills, bold) gebruiken we de fork
// xlsx-js-style — drop-in vervanger van SheetJS Community die ook celstijlen
// wegschrijft. Wordt eenmalig geladen vanaf jsDelivr CDN.
let _xlsxStylePromise = null;
function _laadXLSXStyle() {
  if (_xlsxStylePromise) return _xlsxStylePromise;
  _xlsxStylePromise = new Promise((resolve, reject) => {
    if (window.XLSX && window.__XLSX_STYLED__) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
    s.onload = () => { window.__XLSX_STYLED__ = true; resolve(window.XLSX); };
    s.onerror = () => reject(new Error('Kon xlsx-js-style niet laden (offline?).'));
    document.head.appendChild(s);
  });
  return _xlsxStylePromise;
}

// Layout: kolommen = vaste rads (8) + Dienst + Opmerking. Per dag een blok
// van 6 rijen: dag-rij (ochtend-codes), middag-rij, cel-opmerking-rij, en 3
// blanke rijen voor handmatige time-stamped notities (bv "12:00 Vaatbes").
// Met opmaak: bold headers, alternerende lichte achtergrond per dag, dikke
// rand rond elk dag-blok, kolom-kleuren voor Dienst/Opmerking.
window.exportAfdWeek = async function() {
  let XLSX;
  try { XLSX = await _laadXLSXStyle(); }
  catch (e) { alert(e.message); return; }

  const datum = state.huidigeDatum || vandaagIso();
  const maandag = mandagVanIso(datum);
  const datums = datumsVanWeek(maandag);
  const beperkt = !magBeheerLezen();
  const VERBORGEN_CODES = ['V', 'Z', 'K'];
  const fmap = functiesMap();
  const rads = vasteRadsOpDatum(maandag);

  const codeNaam = (code) => {
    if (!code) return '';
    const f = fmap[code];
    const naam = f?.naam || functieNaam(code);
    return naam.split('/')[0];
  };
  const radLabel = (radId) => {
    if (!radId) return '';
    const r = state.radiologen.find(x => x.id === radId);
    if (!r) return radId;
    return [r.code, r.achternaam].filter(Boolean).join(' · ');
  };

  const N_RAD = rads.length;
  const N_KOL = 1 + N_RAD + 2; // datum + rads + dienst + opmerking
  const lege = (n) => Array.from({ length: n }, () => '');
  const BLANK_ROWS_PER_DAG = 3;
  const ROWS_PER_DAG = 3 + BLANK_ROWS_PER_DAG; // dag + middag + celopm + blanks
  const HEADER_ROWS = 2;

  const aoa = [];
  aoa.push(['', ...rads.map(r => r.code || r.id), 'Dienst', 'Opmerking']);
  aoa.push(['', ...rads.map(r => r.achternaam || ''), '', '']);

  datums.forEach(iso => {
    const d = new Date(iso + 'T12:00:00');
    const dagKort = DAGEN_NL[d.getDay() === 0 ? 6 : d.getDay() - 1];
    const dagLabel = `${dagKort} ${d.getDate()}-${d.getMonth()+1}`;
    const dagData = state.indelingMap[iso];

    if (!dagData) {
      aoa.push([dagLabel, ...lege(N_RAD), '', '']);
      for (let i = 0; i < ROWS_PER_DAG - 1; i++) aoa.push(['', ...lege(N_RAD), '', '']);
      return;
    }

    const radInfo = rads.map(r => {
      const codes = toewijzingVoor(iso, r.id);
      const hoofdLetters = codes.map(c => c.charAt(0).toUpperCase());
      const verborgen = codes.length > 0 && beperkt && hoofdLetters.some(l => VERBORGEN_CODES.includes(l));
      let ochtend = '', middag = '';
      if (codes.length > 0 && !verborgen) {
        ochtend = codeNaam(codes[0]);
        if (codes.length === 2) middag = codeNaam(codes[1]);
      }
      const opm = (!verborgen && dagData.cel_opmerkingen?.[r.id]) || '';
      return { ochtend, middag, opm };
    });

    const dienstStr = radLabel(dagData.dienst?.dag);
    aoa.push([dagLabel, ...radInfo.map(ri => ri.ochtend), dienstStr, dagData.opmerking || '']);
    aoa.push(['', ...radInfo.map(ri => ri.middag), '', dagData.bespreking ? `Besp: ${dagData.bespreking}` : '']);
    aoa.push(['', ...radInfo.map(ri => ri.opm), '', dagData.interventie ? `Interv: ${dagData.interventie}` : '']);
    for (let i = 0; i < BLANK_ROWS_PER_DAG; i++) {
      aoa.push(['', ...lege(N_RAD), '', '']);
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 10 },
    ...rads.map(() => ({ wch: 14 })),
    { wch: 18 },
    { wch: 36 },
  ];
  // Rijhoogte: header iets hoger
  ws['!rows'] = [{ hpx: 22 }, { hpx: 18 }];

  // ---- Stijl-helpers --------------------------------------------------
  const KLEUR_HEADER     = 'D7EAF0'; // cyaan-grijs voor header (codes/namen)
  const KLEUR_DAG_EVEN   = 'E0F0EA'; // licht teal-groen
  const KLEUR_DAG_ODD    = 'FFFFFF'; // wit
  const KLEUR_DATUM      = 'F0F0EE'; // grijs voor datum-kolom
  const KLEUR_DIENST     = 'F2EFE6'; // licht beige voor Dienst
  const KLEUR_OPMERKING  = 'FFF7E5'; // licht crème voor Opmerking
  const ZWART            = '000000';  const GRIJS            = '999999';

  const dun  = { style: 'thin', color: { rgb: GRIJS } };
  const dik  = { style: 'medium', color: { rgb: ZWART } };

  const setCel = (r, c, style) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (!ws[addr]) ws[addr] = { v: '', t: 's' };
    const oud = ws[addr].s || {};
    ws[addr].s = {
      ...oud,
      ...style,
      border: { ...(oud.border || {}), ...(style.border || {}) },
      font: { ...(oud.font || {}), ...(style.font || {}) },
      alignment: { ...(oud.alignment || {}), ...(style.alignment || {}) },
      fill: style.fill || oud.fill,
    };
  };

  // ---- Header-rijen ---------------------------------------------------
  for (let c = 0; c < N_KOL; c++) {
    setCel(0, c, {
      font: { bold: true, sz: 12 },
      alignment: { horizontal: 'center', vertical: 'center' },
      fill: { fgColor: { rgb: KLEUR_HEADER }, patternType: 'solid' },
      border: { top: dik, left: dun, right: dun, bottom: dun },
    });
    setCel(1, c, {
      font: { bold: false, sz: 10, italic: true },
      alignment: { horizontal: 'center', vertical: 'center' },
      fill: { fgColor: { rgb: KLEUR_HEADER }, patternType: 'solid' },
      border: { top: dun, left: dun, right: dun, bottom: dik },
    });
  }

  // ---- Dag-blokken ----------------------------------------------------
  datums.forEach((iso, dagIdx) => {
    const startRij = HEADER_ROWS + dagIdx * ROWS_PER_DAG;
    const eindRij  = startRij + ROWS_PER_DAG - 1;
    const bgDag    = (dagIdx % 2 === 0) ? KLEUR_DAG_EVEN : KLEUR_DAG_ODD;

    for (let r = startRij; r <= eindRij; r++) {
      for (let c = 0; c < N_KOL; c++) {
        let bg = bgDag;
        if (c === 0) bg = KLEUR_DATUM;
        else if (c === N_KOL - 2) bg = KLEUR_DIENST;
        else if (c === N_KOL - 1) bg = KLEUR_OPMERKING;

        const isFirstRow = (r === startRij);
        const isLastRow  = (r === eindRij);
        const isFirstCol = (c === 0);
        const isLastCol  = (c === N_KOL - 1);

        setCel(r, c, {
          font: isFirstRow && c === 0
            ? { bold: true, sz: 11 }
            : { sz: 10 },
          alignment: c === N_KOL - 1
            ? { horizontal: 'left', vertical: 'top', wrapText: true }
            : { horizontal: 'center', vertical: 'center', wrapText: true },
          fill: { fgColor: { rgb: bg }, patternType: 'solid' },
          border: {
            top:    isFirstRow ? dik : dun,
            bottom: isLastRow  ? dik : dun,
            left:   isFirstCol ? dik : dun,
            right:  isLastCol  ? dik : dun,
          },
        });
      }
    }
  });

  const eindDatum = datums[datums.length - 1];
  const start = new Date(maandag + 'T12:00:00');
  const sheetNaam = `Week ${start.getDate()}-${start.getMonth()+1}`;
  const bestandsnaam = `Weekoverzicht_${maandag}_tm_${eindDatum}.xlsx`;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetNaam.slice(0, 31));
  XLSX.writeFile(wb, bestandsnaam);
};
