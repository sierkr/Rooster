// Afdeling-view: per dag wie wat doet, gesorteerd op functie/aanwezigheid.
import { state, SLOTS, DAGEN_LANG } from '../state.js';
import {
  vasteRads, functiesMap, vandaagIso, formatDatum, functieNaam,
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
