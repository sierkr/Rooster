// Vakantie-view (Fase 2: schrijfacties).
//
// Datamodel:
//   indeling/{datum}.vakantie_x        bool
//   indeling/{datum}.vakantie_min      number
//   indeling/{datum}.vakantie_rank     string
//   indeling/{datum}.vakantie_v        { [radId]: true | "K" | "Z" | ... }
//   indeling/{datum}.vakantie_geaccordeerd bool
//   vakantie_rankings/{naam} { naam, label, kleur, anker_jaar, anker_volgorde[8] }

import { setDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from '../firebase-init.js';
import { state, DAGEN_NL, MAANDEN } from '../state.js';
import {
  vasteRads, actieveInvallers, radiologenMap, vandaagIso,
} from '../helpers.js';

// ----- Helpers -------------------------------------------------------------

// Volgorde voor een ranking voor een specifiek jaar.
// Formule: (pos + (jaar - anker_jaar) * 3) mod 8
export function rankingVolgordeVoorJaar(ranking, jaar) {
  if (!ranking?.anker_volgorde) return [];
  const v = ranking.anker_volgorde;
  const verschuiving = ((jaar - (ranking.anker_jaar || jaar)) * 3) % v.length;
  const offset = ((verschuiving % v.length) + v.length) % v.length;
  return v.map((_, i) => v[(i + offset) % v.length]);
}

// V/K/Z code uit vakantie_v[radId] halen.
function vCode(waarde) {
  if (!waarde) return null;
  if (waarde === true) return 'V';
  if (typeof waarde === 'string') return waarde;
  if (typeof waarde === 'object' && waarde.code) return waarde.code;
  return null;
}

// Saldo: V-cellen tellen, vakantie+dienst telt minder.
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

function isBeheerder() {
  return state.profiel?.rol === 'beheerder';
}
function eigenRadId() {
  return state.profiel?.radioloog_id || null;
}

// ----- Render --------------------------------------------------------------

export function renderVakView() {
  const container = document.getElementById('view-vak');
  if (!container) return;

  const rads = vasteRads();
  const invallers = state.toonWeekRads ? actieveInvallers() : [];
  const radsMap = radiologenMap();
  const eigenId = eigenRadId();
  const isBeheer = isBeheerder();

  const allKolommen = [
    ...rads.map(r => ({ id: r.id, label: r.code })),
    ...invallers.map(r => ({ id: r.id, label: r.slot || r.code })),
  ];

  const jaar = new Date().getFullYear();

  // Datums voor heel jaar
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

  // Beheer-kolommen (X / Min / Rank) zijn zichtbaar als de "W-slots"-toggle
  // aan staat. Voor beheerder = read/write; voor anderen = read-only.
  const toonBeheer = state.toonWeekRads;
  const toonW = state.toonWeekRads;

  // Layout (links → rechts):
  //   Datum | rad-kolommen (8 + W's) | Saldo | [X | Min | Rank]
  const radCount = allKolommen.length;
  const radColsCss = `repeat(${radCount}, minmax(28px, 1fr))`;
  const beheerCols = toonBeheer ? ' 24px 32px 64px' : '';
  const gridCols = `50px ${radColsCss} 38px${beheerCols}`;
  const totaalKolommen = 1 + radCount + 1 + (toonBeheer ? 3 : 0);

  // Hoofdkop
  const radHeads = allKolommen.map((k, i) => {
    const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);padding-left:4px;' : '';
    return `<div class="grid-head" style="${sep}" title="${radsMap[k.id]?.achternaam || k.label}">${k.label}</div>`;
  }).join('');
  const beheerHeads = toonBeheer
    ? `<div class="grid-head" title="Vakantiedag aan/uit">X</div>` +
      `<div class="grid-head" title="Minimale bezetting">Min</div>` +
      `<div class="grid-head" title="Ranking-tabel">Rank</div>`
    : '';

  // Saldo-rij
  const saldoCells = allKolommen.map((k, i) => {
    const s = saldoMap[k.id];
    const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);padding-left:4px;' : '';
    return `<div class="vak-saldo-cell" style="${sep}" title="${s.v} V-dagen, ${s.vEnDienst} samenvallend met dienst">${s.saldo}</div>`;
  }).join('');

  // Body
  let body = '';
  let vorigeMaand = -1;

  datums.forEach(iso => {
    const d = new Date(iso + 'T12:00:00');
    const m = d.getMonth();
    if (m !== vorigeMaand) {
      vorigeMaand = m;
      body += `<div class="vak-maand-rij" style="grid-column: 1 / span ${totaalKolommen};">${MAANDEN[m].toUpperCase()} ${jaar}</div>`;
    }

    const dag = state.indelingMap[iso] || {};
    const x   = dag.vakantie_x || false;
    const min = dag.vakantie_min;
    const rank = dag.vakantie_rank;
    const ranking = rank ? rankingMap[rank] : null;
    const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
    const isVandaag = (iso === vandaagIso());
    const geaccordeerd = dag.vakantie_geaccordeerd || false;

    const vDataObj = dag.vakantie_v || {};
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

    // Datumcel
    const dagNaamKort = DAGEN_NL[d.getDay() === 0 ? 6 : d.getDay() - 1];
    const dagNummer = d.getDate();
    const dagCellStyle = `${rijStyle} display:flex; justify-content:space-between; align-items:baseline; padding:6px 4px 0 2px; ${isVandaag ? 'color:#185fa5; font-weight:500;' : ''}`;
    const dagCell = `<div class="grid-day" style="${dagCellStyle}"><span>${dagNaamKort}</span><span>${dagNummer}</span></div>`;

    // Rad-cellen
    const radCells = allKolommen.map((k, i) => {
      const code = vCode(vDataObj[k.id]);
      const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);' : '';
      const isEigen = k.id === eigenId;
      const eigenMark = isEigen ? 'box-shadow: inset 0 0 0 1px rgba(24,95,165,0.3);' : '';

      // Klikbaar voor: eigen rad altijd, beheerder altijd voor iedereen
      const magKlikken = !geaccordeerd && (isBeheer || isEigen);
      const onclick = magKlikken
        ? `onclick="window.vakToggleV('${iso}','${k.id}')"`
        : '';
      const cursor = magKlikken ? 'cursor:pointer;' : 'cursor:default;';

      if (code) {
        const cls = code === 'V' ? 'f-V' : (code === 'K' ? 'f-K' : (code === 'Z' ? 'f-Z' : 'f-V'));
        return `<div class="grid-cell ${cls}" style="${sep} ${eigenMark} ${cursor}" ${onclick}>${code}</div>`;
      } else {
        return `<div class="grid-cell grid-cell-empty" style="${sep} ${eigenMark} ${rijStyle} ${cursor}" ${onclick}>·</div>`;
      }
    }).join('');

    // Saldo-cel (placeholder per rij)
    const saldoCel = `<div class="vak-saldo-cell" style="${rijStyle}"></div>`;

    // Beheer-cellen
    let beheerCells = '';
    if (toonBeheer) {
      // X-cel
      let xCel;
      if (isBeheer && !geaccordeerd) {
        xCel = `<div class="vak-cell-readonly" style="${rijStyle} cursor:pointer;" onclick="window.vakToggleX('${iso}')">${x ? '\u2713' : ''}${geaccordeerd ? ' \uD83D\uDD12' : ''}</div>`;
      } else {
        xCel = `<div class="vak-cell-readonly" style="${rijStyle}">${x ? '\u2713' : ''}${geaccordeerd ? ' \uD83D\uDD12' : ''}</div>`;
      }

      // Min-cel
      let mCel;
      if (isBeheer && x && !geaccordeerd) {
        const val = (typeof min === 'number') ? min : '';
        mCel = `<div class="vak-cell-readonly" style="${rijStyle} padding: 2px;"><input type="number" min="0" max="${rads.length}" value="${val}" onchange="window.vakSetMin('${iso}', this.value)" style="width: 28px; border: 1px solid rgba(0,0,0,0.1); border-radius: 3px; padding: 2px; text-align: center; font-size: 11px; background: transparent;"></div>`;
      } else {
        mCel = `<div class="vak-cell-readonly" style="${rijStyle}">${typeof min === 'number' ? min : ''}</div>`;
      }

      // Rank-cel
      let rCel;
      if (isBeheer && x && !geaccordeerd) {
        const opties = state.vakantieRankings.map(rk =>
          `<option value="${rk.naam}" ${rk.naam === rank ? 'selected' : ''}>${rk.label || rk.naam}</option>`
        ).join('');
        rCel = `<div class="vak-cell-readonly" style="${rijStyle} padding: 2px;"><select onchange="window.vakSetRank('${iso}', this.value)" style="width:100%; border: 1px solid rgba(0,0,0,0.1); border-radius: 3px; padding: 2px; font-size: 10px; background: transparent;"><option value="">—</option>${opties}</select></div>`;
      } else {
        rCel = `<div class="vak-cell-readonly" style="${rijStyle} font-size:10px;" title="${ranking?.label || ''}">${ranking?.label || rank || ''}</div>`;
      }

      beheerCells = xCel + mCel + rCel;
    }

    body += dagCell + radCells + saldoCel + beheerCells;
  });

  const html = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
        <div>
          <p style="font-size: 15px; font-weight: 500; margin: 0;">Vakantie ${jaar}</p>
          <p class="muted" style="margin: 2px 0 0;">Tik op je eigen kolom om V toe te voegen of te verwijderen</p>
        </div>
        ${isBeheer ? `<button class="btn btn-primary" onclick="window.openVakRankings()" style="font-size: 12px; padding: 6px 12px;">\u2699 Rankings</button>` : ''}
      </div>
      <div style="display: flex; justify-content: flex-end; align-items: center; margin-top: 10px;">
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
          <span class="muted">Waarnemers + beheerkolommen</span>
          <span class="toggle-switch ${toonW ? 'aan' : ''}" onclick="window.vakToggleW()"></span>
        </label>
      </div>
    </div>

    <div class="vak-grid-wrap">
      <div class="vak-grid" style="grid-template-columns: ${gridCols};">
        <div class="vak-sticky-row vak-head-row">
          <div class="grid-head"></div>
          ${radHeads}
          <div class="grid-head" title="Saldo (V minus dagen samenvallend met dienst)">\u2211</div>
          ${beheerHeads}
        </div>
        <div class="vak-sticky-row vak-saldo-row">
          <div class="vak-saldo-label">Saldo</div>
          ${saldoCells}
          <div></div>
          ${toonBeheer ? '<div></div><div></div><div></div>' : ''}
        </div>
        ${body}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// ----- Window handlers -----------------------------------------------------

window.vakToggleW = function() {
  state.toonWeekRads = !state.toonWeekRads;
  renderVakView();
};

window.openVakRankings = function() {
  alert('Ranking-beheer komt in Fase 3.');
};

// V-toggle voor eigen kolom of beheerder voor allen.
// Geaccordeerde dagen zijn read-only (gefilterd in render via magKlikken).
window.vakToggleV = async function(datum, radId) {
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;

  const huidig = dag.vakantie_v || {};
  const huidigeCode = vCode(huidig[radId]);
  const nieuw = { ...huidig };

  if (huidigeCode) {
    delete nieuw[radId];
  } else {
    nieuw[radId] = true; // = "V"
  }

  try {
    await setDoc(doc(db, 'indeling', datum), {
      datum,
      vakantie_v: nieuw,
    }, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};

// X aan/uit (beheerder).
window.vakToggleX = async function(datum) {
  if (!isBeheerder()) return;
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;
  const nieuw = !(dag.vakantie_x || false);

  // Bij uitzetten: ook min en rank wissen voor consistentie.
  const update = { datum, vakantie_x: nieuw };
  if (!nieuw) {
    update.vakantie_min = null;
    update.vakantie_rank = null;
  }

  try {
    await setDoc(doc(db, 'indeling', datum), update, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};

// Min-bezetting instellen (beheerder).
window.vakSetMin = async function(datum, waarde) {
  if (!isBeheerder()) return;
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;
  const num = waarde === '' ? null : Number(waarde);
  if (num !== null && (isNaN(num) || num < 0)) return;

  try {
    await setDoc(doc(db, 'indeling', datum), {
      datum,
      vakantie_min: num,
    }, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};

// Ranking instellen (beheerder).
window.vakSetRank = async function(datum, rankNaam) {
  if (!isBeheerder()) return;
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;

  try {
    await setDoc(doc(db, 'indeling', datum), {
      datum,
      vakantie_rank: rankNaam || null,
    }, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};
