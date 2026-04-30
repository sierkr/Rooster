// Afdeling-view: per dag wie wat doet, gesorteerd op functie/aanwezigheid.
import { state, SLOTS } from '../state.js';
import {
  vasteRads, functiesMap, vandaagIso, formatDatum, functieNaam,
  toewijzingVoor, huidigKalenderJaar, isBeperktZichtRol,
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
          <button class="nav-btn" onclick="window.navigeerDag(-1)">‹</button>
          <button class="nav-btn" onclick="window.navigeerDag(1)">›</button>
        </div>
      </div>
      ${datum !== vandaag ? `<button class="nav-btn today" onclick="window.naarVandaag()" style="margin-top: 10px;">Naar vandaag</button>` : ''}
    </div>
  `;

  if (!dag) {
    html += `<div class="empty-state"><div class="empty-state-icon">·</div>Geen indeling voor deze dag</div>`;
  } else {
    const beperkt = isBeperktZichtRol();
    // Privacy-gevoelige codes die voor secretariaat + technician verborgen blijven.
    const VERBORGEN_CODES = ['V', 'Z', 'K'];

    const items = [];
    vasteRads().forEach(r => {
      const codes = toewijzingVoor(datum, r.id);
      if (codes.length === 0) return;
      const hoofdCode = codes[0];
      const hoofdLetter = hoofdCode.charAt(0).toUpperCase();
      if (beperkt && VERBORGEN_CODES.includes(hoofdLetter)) return;
      const f = functiesMap()[hoofdCode];
      const naam = f?.naam || functieNaam(hoofdCode);
      const isAfwezig = ['V', 'Z', 'A', 'K', 'Q', 'T'].includes(hoofdLetter);
      items.push({ rad: r, code: hoofdCode, naam, isAfwezig });
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
