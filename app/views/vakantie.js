// Vakantie-view (Fase 1: read-only skelet).
//
// Toont per dag een rij voor het hele jaar. V-cellen, beheer-kolommen
// (X / Min / Rank), saldo-rij sticky bovenaan. Schrijfacties komen in Fase 2.
//
// Stijl matcht Overzicht: .card, .grid-wrap, .plan-grid, .grid-cell, .f-V.
// Datamodel:
//   indeling/{datum}.vakantie_x        bool
//   indeling/{datum}.vakantie_min      number
//   indeling/{datum}.vakantie_rank     string
//   indeling/{datum}.vakantie_v        { [radId]: true | "K" | "Z" | ... }
//   indeling/{datum}.vakantie_geaccordeerd bool
//   vakantie_rankings/{naam} { naam, label, kleur, anker_jaar, anker_volgorde[8] }

import { state, DAGEN_NL, MAANDEN } from '../state.js';
import {
  vasteRads, actieveInvallers, radiologenMap, vandaagIso,
} from '../helpers.js';

// Berekent volgorde voor een ranking voor een specifiek jaar.
// Formule: (pos + (jaar - anker_jaar) * 3) mod 8
export function rankingVolgordeVoorJaar(ranking, jaar) {
  if (!ranking?.anker_volgorde) return [];
  const v = ranking.anker_volgorde;
  const verschuiving = ((jaar - (ranking.anker_jaar || jaar)) * 3) % v.length;
  const offset = ((verschuiving % v.length) + v.length) % v.length;
  return v.map((_, i) => v[(i + offset) % v.length]);
}

// Tel V's per radioloog voor een jaar. K en Z tellen niet.
// Als dezelfde dag dienst.dag === radId, telt de V minus 1.
function berekenSaldo(radId, jaar) {
  let v = 0, vEnDienst = 0;
  Object.values(state.indelingMap).forEach(dag => {
    if (!dag?.datum?.startsWith(String(jaar))) return;
    const w = dag.vakantie_v?.[radId];
    if (!w) return;
    const isV = (w === true || w === 'V' || (typeof w === 'object' && (w.code || 'V') === 'V'));
    if (!isV) return;
    v++;
    if (dag.dienst?.dag === radId) vEnDienst++;
  });
  return { v, vEnDienst, saldo: v - vEnDienst };
}

// Geeft de waarde uit vakantie_v terug als string (V/K/Z/...) of null.
function vCode(waarde) {
  if (!waarde) return null;
  if (waarde === true) return 'V';
  if (typeof waarde === 'string') return waarde;
  if (typeof waarde === 'object' && waarde.code) return waarde.code;
  return null;
}

export function renderVakView() {
  const container = document.getElementById('view-vak');
  if (!container) return;

  const rads = vasteRads();
  const invallers = state.toonWeekRads ? actieveInvallers() : [];
  const radsMap = radiologenMap();
  const eigenRadId = state.profiel?.radioloog_id || null;
  const isBeheer = state.profiel?.rol === 'beheerder';

  const allKolommen = [
    ...rads.map(r => ({ id: r.id, label: r.code })),
    ...invallers.map(r => ({ id: r.id, label: r.slot || r.code })),
  ];

  const jaar = new Date().getFullYear();

  const datums = [];
  const start = new Date(jaar, 0, 1);
  const eind  = new Date(jaar, 11, 31);
  for (let d = new Date(start); d <= eind; d.setDate(d.getDate() + 1)) {
    datums.push(d.toISOString().slice(0, 10));
  }

  const rankingMap = {};
  state.vakantieRankings.forEach(r => { rankingMap[r.naam] = r; });

  const saldoMap = {};
  allKolommen.forEach(k => { saldoMap[k.id] = berekenSaldo(k.id, jaar); });

  const toonBeheer = state.vakToonBeheerKolommen;
  const toonW = state.toonWeekRads;

  const beheerCols = toonBeheer ? '22px 28px 60px ' : '';
  const radCount = allKolommen.length;
  const radColsCss = `repeat(${radCount}, minmax(28px, 1fr))`;
  const gridCols = `50px ${beheerCols}${radColsCss} 40px`;
  const beheerHeads = toonBeheer
    ? `<div class="grid-head" title="Vakantiedag">X</div><div class="grid-head" title="Min bezetting">Min</div><div class="grid-head" title="Ranking">Rank</div>`
    : '';

  const radHeads = allKolommen.map((k, i) => {
    const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);padding-left:4px;' : '';
    return `<div class="grid-head" style="${sep}" title="${radsMap[k.id]?.achternaam || k.label}">${k.label}</div>`;
  }).join('');

  const saldoCells = allKolommen.map((k, i) => {
    const s = saldoMap[k.id];
    const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);padding-left:4px;' : '';
    return `<div class="vak-saldo-cell" style="${sep}" title="${s.v} V-dagen, ${s.vEnDienst} samenvallend met dienst">${s.saldo}</div>`;
  }).join('');

  let body = '';
  let vorigeMaand = -1;
  const totaalKolommen = 1 + (toonBeheer ? 3 : 0) + radCount + 1;

  datums.forEach(iso => {
    const d = new Date(iso + 'T12:00:00');
    const m = d.getMonth();
    if (m !== vorigeMaand) {
      vorigeMaand = m;
      body += `<div class="vak-maand-rij" style="grid-column: 1 / span ${totaalKolommen};">${MAANDEN[m].toUpperCase()} ${jaar}</div>`;
    }

    const dag = state.indelingMap[iso];
    const x   = dag?.vakantie_x || false;
    const min = dag?.vakantie_min;
    const rank = dag?.vakantie_rank;
    const ranking = rank ? rankingMap[rank] : null;
    const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
    const isVandaag = (iso === vandaagIso());
    const geaccordeerd = dag?.vakantie_geaccordeerd || false;

    const vDataObj = dag?.vakantie_v || {};
    const vAantal = allKolommen.reduce((n, k) => n + (vCode(vDataObj[k.id]) === 'V' ? 1 : 0), 0);
    const overschreden = (typeof min === 'number' && vAantal > (rads.length - min));

    let rijStyle = '';
    if (overschreden) {
      rijStyle = 'background: #fde0e0;';
    } else if (x && ranking?.kleur) {
      rijStyle = `background: ${ranking.kleur}1F;`;
    } else if (isWeekend) {
      rijStyle = 'background: #fafaf6;';
    }

    const dagNaamKort = DAGEN_NL[d.getDay() === 0 ? 6 : d.getDay() - 1];
    const dagNummer = d.getDate();
    const dagCellStyle = `${rijStyle} display:flex; justify-content:space-between; align-items:baseline; padding:6px 4px 0 2px; ${isVandaag ? 'color:#185fa5; font-weight:500;' : ''}`;
    const dagCell = `<div class="grid-day" style="${dagCellStyle}"><span>${dagNaamKort}</span><span>${dagNummer}</span></div>`;

    let beheerCells = '';
    if (toonBeheer) {
      const xCel  = `<div class="vak-cell-readonly" style="${rijStyle}">${x ? '\u2713' : ''}${geaccordeerd ? ' \uD83D\uDD12' : ''}</div>`;
      const mCel  = `<div class="vak-cell-readonly" style="${rijStyle}">${typeof min === 'number' ? min : ''}</div>`;
      const rCel  = `<div class="vak-cell-readonly" style="${rijStyle}; font-size:10px;" title="${ranking?.label || ''}">${ranking?.label || rank || ''}</div>`;
      beheerCells = xCel + mCel + rCel;
    }

    const radCells = allKolommen.map((k, i) => {
      const code = vCode(vDataObj[k.id]);
      const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);' : '';
      const isEigen = k.id === eigenRadId;
      const eigenMark = isEigen ? 'box-shadow: inset 0 0 0 1px rgba(24,95,165,0.3);' : '';
      if (code) {
        const cls = code === 'V' ? 'f-V' : (code === 'K' ? 'f-K' : (code === 'Z' ? 'f-Z' : 'f-V'));
        return `<div class="grid-cell ${cls}" style="${sep} ${eigenMark}">${code}</div>`;
      } else {
        return `<div class="grid-cell grid-cell-empty" style="${sep} ${eigenMark}; ${rijStyle}">\u00b7</div>`;
      }
    }).join('');

    const saldoCel = `<div class="vak-saldo-cell" style="${rijStyle}"></div>`;

    body += dagCell + beheerCells + radCells + saldoCel;
  });

  const html = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
        <div>
          <p style="font-size: 15px; font-weight: 500; margin: 0;">Vakantie ${jaar}</p>
          <p class="muted" style="margin: 2px 0 0;">Doorlopende kalender \u00b7 saldo per radioloog bovenaan</p>
        </div>
        ${isBeheer ? `<button class="btn btn-primary" onclick="window.openVakRankings()" style="font-size: 12px; padding: 6px 12px;">\u2699 Rankings</button>` : ''}
      </div>
      <div style="display: flex; justify-content: flex-end; align-items: center; margin-top: 10px; gap: 16px;">
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
          <span class="muted">Beheer-kolommen</span>
          <span class="toggle-switch ${toonBeheer ? 'aan' : ''}" onclick="window.vakToggleBeheerKol()"></span>
        </label>
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
          <span class="muted">W-slots</span>
          <span class="toggle-switch ${toonW ? 'aan' : ''}" onclick="window.vakToggleW()"></span>
        </label>
      </div>
    </div>

    <div class="vak-grid-wrap">
      <div class="vak-grid" style="grid-template-columns: ${gridCols};">
        <div class="vak-sticky-row vak-head-row">
          <div class="grid-head"></div>
          ${beheerHeads}
          ${radHeads}
          <div class="grid-head" title="Saldo (V minus dagen samenvallend met dienst)">\u2211</div>
        </div>
        <div class="vak-sticky-row vak-saldo-row">
          <div class="vak-saldo-label">Saldo</div>
          ${toonBeheer ? '<div></div><div></div><div></div>' : ''}
          ${saldoCells}
          <div></div>
        </div>
        ${body}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// === Window handlers ===

window.vakToggleBeheerKol = function() {
  state.vakToonBeheerKolommen = !state.vakToonBeheerKolommen;
  renderVakView();
};

window.vakToggleW = function() {
  state.toonWeekRads = !state.toonWeekRads;
  renderVakView();
};

window.openVakRankings = function() {
  alert('Ranking-beheer komt in Fase 3.');
};
