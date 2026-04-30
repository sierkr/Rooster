// Vakantie-view (Fase 4: doorlopende kalender + dubbel-tik + bevries periode).
//
// Datamodel:
//   indeling/{datum}.vakantie_x        bool
//   indeling/{datum}.vakantie_min      number
//   indeling/{datum}.vakantie_rank     string
//   indeling/{datum}.vakantie_v        { [radId]: true | "K" | "Z" | ... }
//   indeling/{datum}.vakantie_geaccordeerd bool
//   vakantie_rankings/{naam} { naam, label, kleur, anker_jaar, anker_volgorde[8] }

import {
  setDoc, doc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from '../firebase-init.js';
import { state, DAGEN_NL, MAANDEN } from '../state.js';
import {
  vasteRads, actieveInvallers, radiologenMap, vandaagIso,
} from '../helpers.js';
import { openSheet, closeSheet } from '../sheets.js';

// ----- Helpers -------------------------------------------------------------

export function rankingVolgordeVoorJaar(ranking, jaar) {
  if (!ranking?.anker_volgorde) return [];
  const v = ranking.anker_volgorde;
  const verschuiving = ((jaar - (ranking.anker_jaar || jaar)) * 3) % v.length;
  const offset = ((verschuiving % v.length) + v.length) % v.length;
  return v.map((_, i) => v[(i + offset) % v.length]);
}

function vCode(waarde) {
  if (!waarde) return null;
  if (waarde === true) return 'V';
  if (typeof waarde === 'string') return waarde;
  if (typeof waarde === 'object' && waarde.code) return waarde.code;
  return null;
}

function berekenSaldoRange(radId, isoStart, isoEind) {
  let v = 0, vEnDienst = 0;
  Object.values(state.indelingMap).forEach(dag => {
    if (!dag?.datum) return;
    if (dag.datum < isoStart || dag.datum > isoEind) return;
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

function plusDagenIso(iso, n) {
  return new Date(new Date(iso + 'T12:00:00').getTime() + n * 86400000)
    .toISOString().slice(0, 10);
}

function vorigeMinWaarde(datum) {
  const allDates = Object.keys(state.indelingMap).filter(d => d < datum).sort();
  for (let i = allDates.length - 1; i >= 0; i--) {
    const dag = state.indelingMap[allDates[i]];
    if (typeof dag?.vakantie_min === 'number') return dag.vakantie_min;
  }
  return null;
}

function vorigeRankWaarde(datum) {
  const allDates = Object.keys(state.indelingMap).filter(d => d < datum).sort();
  for (let i = allDates.length - 1; i >= 0; i--) {
    const dag = state.indelingMap[allDates[i]];
    if (dag?.vakantie_rank) return dag.vakantie_rank;
  }
  return null;
}

function vindBlok(datum) {
  const dag = state.indelingMap[datum];
  if (!dag?.vakantie_x || !dag?.vakantie_rank) return null;
  const rank = dag.vakantie_rank;

  let start = datum;
  while (true) {
    const prev = plusDagenIso(start, -1);
    const prevDag = state.indelingMap[prev];
    if (!prevDag?.vakantie_x || prevDag.vakantie_rank !== rank) break;
    start = prev;
  }
  let eind = datum;
  while (true) {
    const next = plusDagenIso(eind, 1);
    const nextDag = state.indelingMap[next];
    if (!nextDag?.vakantie_x || nextDag.vakantie_rank !== rank) break;
    eind = next;
  }
  return { rank, start, eind };
}

function dagenInBereik(startISO, eindISO) {
  const dagen = [];
  let cur = startISO;
  while (cur <= eindISO) {
    dagen.push(cur);
    cur = plusDagenIso(cur, 1);
  }
  return dagen;
}

// ----- Dubbel-tik detectie -------------------------------------------------
//
// Eerste tik: start een 300ms timer met de "kort"-actie. Als binnen die
// 300ms een tweede tik komt op dezelfde cel, annuleer de timer en doe de
// "lang"-actie (sheet openen).

const DBL_TAP_MS = 300;
let _dblTimer = null;
let _dblTarget = null;

function attachDblTap(el, key, onShort, onLong) {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (_dblTimer && _dblTarget === key) {
      // Tweede tik binnen vertraging: annuleer V-toggle en open sheet
      clearTimeout(_dblTimer);
      _dblTimer = null;
      _dblTarget = null;
      onLong();
    } else {
      // Eerste tik: wacht of er een tweede komt
      if (_dblTimer) clearTimeout(_dblTimer);
      _dblTarget = key;
      _dblTimer = setTimeout(() => {
        _dblTimer = null;
        _dblTarget = null;
        onShort();
      }, DBL_TAP_MS);
    }
  });
}

// ----- Render --------------------------------------------------------------

// Of de matrix al een keer is gerenderd (voor scroll-naar-vandaag bij eerste opening)
let _eersteRender = true;

export function renderVakView() {
  const container = document.getElementById('view-vak');
  if (!container) return;

  // Scroll-positie bewaren
  const oudeScrollWrap = container.querySelector('.vak-grid-wrap');
  const scrollTop = oudeScrollWrap?.scrollTop || 0;
  const scrollLeft = oudeScrollWrap?.scrollLeft || 0;

  const rads = vasteRads();
  const invallers = state.toonWeekRads ? actieveInvallers() : [];
  const radsMap = radiologenMap();
  const eigenId = eigenRadId();
  const isBeheer = isBeheerder();

  const allKolommen = [
    ...rads.map(r => ({ id: r.id, label: r.code })),
    ...invallers.map(r => ({ id: r.id, label: r.slot || r.code })),
  ];

  // Doorlopende kalender: 6 maanden terug, 18 vooruit (~2 jaar totaal)
  const vandaag = vandaagIso();
  const startDatum = plusDagenIso(vandaag, -183);
  const eindDatum  = plusDagenIso(vandaag, 549);

  const datums = dagenInBereik(startDatum, eindDatum);

  const rankingMap = {};
  state.vakantieRankings.forEach(r => { rankingMap[r.naam] = r; });

  // Saldo voor het lopende kalenderjaar
  const huidigJaar = new Date().getFullYear();
  const jaarStart = `${huidigJaar}-01-01`;
  const jaarEind  = `${huidigJaar}-12-31`;
  const saldoMap = {};
  allKolommen.forEach(k => { saldoMap[k.id] = berekenSaldoRange(k.id, jaarStart, jaarEind); });

  const toonBeheer = state.toonWeekRads;
  const toonW = state.toonWeekRads;

  const radCount = allKolommen.length;
  const radColsCss = `repeat(${radCount}, minmax(28px, 1fr))`;
  const beheerCols = toonBeheer ? ' 24px 32px 64px' : '';
  const gridCols = `50px ${radColsCss} 38px${beheerCols}`;
  const totaalKolommen = 1 + radCount + 1 + (toonBeheer ? 3 : 0);

  const radHeads = allKolommen.map((k, i) => {
    const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);padding-left:4px;' : '';
    return `<div class="grid-head" style="${sep}" title="${radsMap[k.id]?.achternaam || k.label}">${k.label}</div>`;
  }).join('');
  const beheerHeads = toonBeheer
    ? `<div class="grid-head" title="Vakantiedag aan/uit">X</div>` +
      `<div class="grid-head" title="Minimale bezetting">Min</div>` +
      `<div class="grid-head" title="Ranking-tabel">Rank</div>`
    : '';

  const saldoCells = allKolommen.map((k, i) => {
    const s = saldoMap[k.id];
    const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);padding-left:4px;' : '';
    const radObj = rads.find(r => r.id === k.id) || invallers.find(r => r.id === k.id);
    const recht = (typeof radObj?.vakantierecht === 'number') ? radObj.vakantierecht : 40;
    const overschreden = s.saldo > recht;
    const kleur = overschreden ? 'color: #c0392b; font-weight: 700;' : '';
    const titel = `${s.v} V-dagen, ${s.vEnDienst} samenvallend met dienst, recht ${recht}`;
    return `<div class="vak-saldo-cell" style="${sep} ${kleur}" title="${titel}">${s.saldo}/${recht}</div>`;
  }).join('');

  let body = '';
  let vorigeMaandKey = '';

  datums.forEach(iso => {
    const d = new Date(iso + 'T12:00:00');
    const m = d.getMonth();
    const y = d.getFullYear();
    const maandKey = `${y}-${m}`;
    if (maandKey !== vorigeMaandKey) {
      vorigeMaandKey = maandKey;
      body += `<div class="vak-maand-rij" style="grid-column: 1 / span ${totaalKolommen};">${MAANDEN[m].toUpperCase()} ${y}</div>`;
    }

    const dag = state.indelingMap[iso] || {};
    const x   = dag.vakantie_x || false;
    const min = dag.vakantie_min;
    const rank = dag.vakantie_rank;
    const ranking = rank ? rankingMap[rank] : null;
    const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
    const isVandaag = (iso === vandaag);
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

    const dagNaamKort = DAGEN_NL[d.getDay() === 0 ? 6 : d.getDay() - 1];
    const dagNummer = d.getDate();
    const dagCellStyle = `${rijStyle} display:flex; justify-content:space-between; align-items:baseline; padding:6px 4px 0 2px; ${isVandaag ? 'color:#185fa5; font-weight:500;' : ''}`;
    const vandaagAttr = isVandaag ? 'data-vak-vandaag="1"' : '';
    const dagCell = `<div class="grid-day" style="${dagCellStyle}" ${vandaagAttr}><span>${dagNaamKort}</span><span>${dagNummer}</span></div>`;

    const radCells = allKolommen.map((k, i) => {
      const code = vCode(vDataObj[k.id]);
      const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);' : '';
      const isEigen = k.id === eigenId;
      const eigenMark = isEigen ? 'box-shadow: inset 0 0 0 1px rgba(24,95,165,0.3);' : '';

      const magKlikken = !geaccordeerd && (isBeheer || isEigen);
      const dataAttr = magKlikken ? `data-vak-cel="${iso}|${k.id}"` : '';
      const cursor = magKlikken ? 'cursor:pointer;' : 'cursor:default;';

      if (code) {
        const cls = code === 'V' ? 'f-V' : (code === 'K' ? 'f-K' : (code === 'Z' ? 'f-Z' : 'f-V'));
        return `<div class="grid-cell ${cls}" style="${sep} ${eigenMark} ${cursor}" ${dataAttr}>${code}</div>`;
      } else {
        return `<div class="grid-cell grid-cell-empty" style="${sep} ${eigenMark} ${rijStyle} ${cursor}" ${dataAttr}>\u00b7</div>`;
      }
    }).join('');

    const saldoCel = `<div class="vak-saldo-cell" style="${rijStyle}"></div>`;

    let beheerCells = '';
    if (toonBeheer) {
      let xCel;
      const slotje = geaccordeerd ? ' \uD83D\uDD12' : '';
      if (isBeheer && !geaccordeerd) {
        xCel = `<div class="vak-cell-readonly" style="${rijStyle} cursor:pointer;" data-vak-x="${iso}">${x ? '\u2713' : ''}${slotje}</div>`;
      } else {
        xCel = `<div class="vak-cell-readonly" style="${rijStyle}">${x ? '\u2713' : ''}${slotje}</div>`;
      }

      let mCel;
      if (isBeheer && x && !geaccordeerd) {
        const val = (typeof min === 'number') ? min : '';
        mCel = `<div class="vak-cell-readonly" style="${rijStyle} padding: 2px;"><input type="number" min="0" max="${rads.length}" value="${val}" onchange="window.vakSetMin('${iso}', this.value)" style="width: 28px; border: 1px solid rgba(0,0,0,0.1); border-radius: 3px; padding: 2px; text-align: center; font-size: 11px; background: transparent;"></div>`;
      } else {
        mCel = `<div class="vak-cell-readonly" style="${rijStyle}">${typeof min === 'number' ? min : ''}</div>`;
      }

      let rCel;
      if (isBeheer && x && !geaccordeerd) {
        const opties = state.vakantieRankings.map(rk =>
          `<option value="${rk.naam}" ${rk.naam === rank ? 'selected' : ''}>${rk.label || rk.naam}</option>`
        ).join('');
        rCel = `<div class="vak-cell-readonly" style="${rijStyle} padding: 2px;"><select onchange="window.vakSetRank('${iso}', this.value)" style="width:100%; border: 1px solid rgba(0,0,0,0.1); border-radius: 3px; padding: 2px; font-size: 10px; background: transparent;"><option value="">\u2014</option>${opties}</select></div>`;
      } else {
        const klikbaar = isBeheer && x && rank;
        const ds = klikbaar ? `data-vak-blok="${iso}"` : '';
        const cur = klikbaar ? 'cursor:pointer;' : '';
        rCel = `<div class="vak-cell-readonly" style="${rijStyle} font-size:10px; ${cur}" ${ds} title="${ranking?.label || ''}${klikbaar ? ' \u2014 tik voor accordeer' : ''}">${ranking?.label || rank || ''}</div>`;
      }

      beheerCells = xCel + mCel + rCel;
    }

    body += dagCell + radCells + saldoCel + beheerCells;
  });

  const html = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
        <div>
          <p style="font-size: 15px; font-weight: 500; margin: 0;">Vakantie</p>
          <p class="muted" style="margin: 2px 0 0;">Tik = V toggle &middot; dubbel-tik = code kiezen (V/K/Z)</p>
        </div>
        ${isBeheer ? `<div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn" onclick="window.openVakBevriezenSheet()" style="font-size: 12px; padding: 6px 12px;">\uD83D\uDD12 Bevries periode</button>
          <button class="btn btn-primary" onclick="window.openVakRankings()" style="font-size: 12px; padding: 6px 12px;">\u2699 Rankings</button>
        </div>` : ''}
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <button class="btn" onclick="window.vakScrollNaarVandaag()" style="font-size: 12px; padding: 4px 10px;">\u2190 Vandaag</button>
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
          <div class="grid-head" title="Saldo dit jaar (V minus dagen samenvallend met dienst)">\u2211</div>
          ${beheerHeads}
        </div>
        <div class="vak-sticky-row vak-saldo-row">
          <div class="vak-saldo-label">Saldo ${huidigJaar}</div>
          ${saldoCells}
          <div></div>
          ${toonBeheer ? '<div></div><div></div><div></div>' : ''}
        </div>
        ${body}
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Click handlers koppelen
  container.querySelectorAll('[data-vak-cel]').forEach(el => {
    const key = el.getAttribute('data-vak-cel');
    const [datum, radId] = key.split('|');
    attachDblTap(el, key,
      () => window.vakToggleV(datum, radId),
      () => window.openVakCelSheet(datum, radId),
    );
  });
  container.querySelectorAll('[data-vak-x]').forEach(el => {
    const datum = el.getAttribute('data-vak-x');
    el.addEventListener('click', () => window.vakToggleX(datum));
  });
  container.querySelectorAll('[data-vak-blok]').forEach(el => {
    const datum = el.getAttribute('data-vak-blok');
    el.addEventListener('click', () => window.openVakBlokSheet(datum));
  });

  // Scroll-positie behouden of naar vandaag scrollen bij eerste render
  const wrap = container.querySelector('.vak-grid-wrap');
  if (wrap) {
    if (_eersteRender) {
      _eersteRender = false;
      const vandaagEl = container.querySelector('[data-vak-vandaag]');
      if (vandaagEl) {
        // Wacht op layout, scroll dan zodat vandaag bovenaan staat (onder de sticky kop)
        requestAnimationFrame(() => {
          const offset = vandaagEl.offsetTop - 60;
          wrap.scrollTop = Math.max(0, offset);
        });
      }
    } else {
      wrap.scrollTop = scrollTop;
      wrap.scrollLeft = scrollLeft;
    }
  }
}

// ----- Window handlers -----------------------------------------------------

window.vakToggleW = function() {
  state.toonWeekRads = !state.toonWeekRads;
  renderVakView();
};

window.vakScrollNaarVandaag = function() {
  const container = document.getElementById('view-vak');
  const wrap = container?.querySelector('.vak-grid-wrap');
  const vandaagEl = container?.querySelector('[data-vak-vandaag]');
  if (wrap && vandaagEl) {
    wrap.scrollTop = Math.max(0, vandaagEl.offsetTop - 60);
  }
};

window.vakToggleV = async function(datum, radId) {
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;
  const huidig = dag.vakantie_v || {};
  const huidigeCode = vCode(huidig[radId]);
  const nieuw = { ...huidig };
  if (huidigeCode) delete nieuw[radId];
  else nieuw[radId] = true;
  try {
    await setDoc(doc(db, 'indeling', datum), { datum, vakantie_v: nieuw }, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};

window.vakToggleX = async function(datum) {
  if (!isBeheerder()) return;
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;
  const nieuw = !(dag.vakantie_x || false);

  const update = { datum, vakantie_x: nieuw };
  if (nieuw) {
    if (typeof dag.vakantie_min !== 'number') {
      const vorige = vorigeMinWaarde(datum);
      if (vorige !== null) update.vakantie_min = vorige;
    }
    if (!dag.vakantie_rank) {
      const vorige = vorigeRankWaarde(datum);
      if (vorige) update.vakantie_rank = vorige;
    }
  } else {
    update.vakantie_min = null;
    update.vakantie_rank = null;
  }

  try {
    await setDoc(doc(db, 'indeling', datum), update, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};

window.vakSetMin = async function(datum, waarde) {
  if (!isBeheerder()) return;
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;
  const num = waarde === '' ? null : Number(waarde);
  if (num !== null && (isNaN(num) || num < 0)) return;
  try {
    await setDoc(doc(db, 'indeling', datum), { datum, vakantie_min: num }, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};

window.vakSetRank = async function(datum, rankNaam) {
  if (!isBeheerder()) return;
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;
  try {
    await setDoc(doc(db, 'indeling', datum), { datum, vakantie_rank: rankNaam || null }, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};

// ----- Code-keuze sheet (V/K/Z) ------------------------------------------

window.openVakCelSheet = function(datum, radId) {
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;
  const radNaam = radiologenMap()[radId]?.achternaam || radId;
  const huidig = vCode(dag.vakantie_v?.[radId]) || '';

  document.getElementById('sheetTitle').textContent = `${radNaam} \u00b7 ${datum}`;
  document.getElementById('sheetSub').textContent = 'Kies een code voor deze dag';
  document.getElementById('sheetBody').innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 1rem;">
      <button class="picker-option f-V ${huidig==='V'?'selected':''}" onclick="window.vakKiesCode('${datum}','${radId}','V')">V<div class="picker-label">Vakantie</div></button>
      <button class="picker-option f-K ${huidig==='K'?'selected':''}" onclick="window.vakKiesCode('${datum}','${radId}','K')">K<div class="picker-label">Cursus</div></button>
      <button class="picker-option f-Z ${huidig==='Z'?'selected':''}" onclick="window.vakKiesCode('${datum}','${radId}','Z')">Z<div class="picker-label">Ziek</div></button>
    </div>
    <div style="display:flex; gap:8px;">
      <button class="btn" style="flex:1;" onclick="window.vakKiesCode('${datum}','${radId}','')">Leegmaken</button>
      <button class="btn" style="flex:1;" onclick="window.closeSheet()">Annuleer</button>
    </div>
  `;
  openSheet();
};

window.vakKiesCode = async function(datum, radId, code) {
  const dag = state.indelingMap[datum] || {};
  const huidig = dag.vakantie_v || {};
  const nieuw = { ...huidig };
  if (code) nieuw[radId] = (code === 'V') ? true : code;
  else delete nieuw[radId];
  closeSheet();
  try {
    await setDoc(doc(db, 'indeling', datum), { datum, vakantie_v: nieuw }, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};

// ----- Per-blok accorderen -----------------------------------------------

window.openVakBlokSheet = function(datum) {
  if (!isBeheerder()) return;
  const blok = vindBlok(datum);
  if (!blok) return;
  const ranking = state.vakantieRankings.find(r => r.naam === blok.rank);
  const dagen = dagenInBereik(blok.start, blok.eind);
  const eersteDag = state.indelingMap[blok.start];
  const isGeaccordeerd = !!eersteDag?.vakantie_geaccordeerd;

  const rads = vasteRads();
  const tellingen = {};
  rads.forEach(r => { tellingen[r.id] = 0; });
  dagen.forEach(d => {
    const v = state.indelingMap[d]?.vakantie_v || {};
    rads.forEach(r => {
      if (vCode(v[r.id]) === 'V') tellingen[r.id]++;
    });
  });
  const tellLijst = rads.map(r => `<div style="display:flex; justify-content:space-between; padding:3px 0; border-bottom: 1px solid rgba(0,0,0,0.05);"><span>${r.code} \u00b7 ${r.achternaam}</span><strong>${tellingen[r.id]} V</strong></div>`).join('');

  document.getElementById('sheetTitle').textContent = `Vakantieblok: ${ranking?.label || blok.rank}`;
  document.getElementById('sheetSub').textContent = `${blok.start} t/m ${blok.eind} (${dagen.length} dagen)`;

  const knopAccord = isGeaccordeerd
    ? `<button class="btn" style="flex:1; background:#fde0e0;" onclick="window.vakDeaccordeer('${blok.start}','${blok.eind}')">\uD83D\uDD13 Deaccorderen</button>`
    : `<button class="btn btn-primary" style="flex:1;" onclick="window.vakAccordeer('${blok.start}','${blok.eind}')">\uD83D\uDD12 Accorderen + doorzetten</button>`;

  document.getElementById('sheetBody').innerHTML = `
    <div style="margin-bottom: 1rem;">
      <p class="muted" style="margin:0 0 6px; font-size: 12px;">V-totalen in dit blok:</p>
      <div style="font-size: 12px;">${tellLijst}</div>
    </div>
    ${isGeaccordeerd ? '<div class="form-info" style="font-size:12px; margin-bottom:1rem;">Dit blok is geaccordeerd. Radiologen kunnen V niet meer wijzigen.</div>' : '<div class="form-info" style="font-size:12px; margin-bottom:1rem;">Bij accorderen worden alle V-cellen ook als V geschreven naar het hoofdrooster (Overzicht).</div>'}
    <div style="display:flex; gap:8px;">
      ${knopAccord}
      <button class="btn" style="flex:1;" onclick="window.closeSheet()">Sluiten</button>
    </div>
  `;
  openSheet();
};

window.vakAccordeer = async function(startISO, eindISO) {
  if (!isBeheerder()) return;
  if (!confirm('Periode accorderen en V-cellen doorzetten naar het hoofdrooster?')) return;
  closeSheet();
  await accordeerRange(startISO, eindISO, true);
};

window.vakDeaccordeer = async function(startISO, eindISO) {
  if (!isBeheerder()) return;
  if (!confirm('Periode deaccorderen? V-cellen blijven in Overzicht staan tot je ze handmatig wist.')) return;
  closeSheet();
  await accordeerRange(startISO, eindISO, false);
};

// Generieke accorderen/deaccorderen voor een range datums.
// Bij accorderen=true worden V-cellen ook doorgezet naar toewijzingen.
async function accordeerRange(startISO, eindISO, accorderen) {
  const dagen = dagenInBereik(startISO, eindISO);
  try {
    const batch = writeBatch(db);
    for (const datum of dagen) {
      const dag = state.indelingMap[datum] || {};
      const update = { datum, vakantie_geaccordeerd: accorderen };

      if (accorderen) {
        const vData = dag.vakantie_v || {};
        const huidigeToewijzingen = { ...(dag.toewijzingen || {}) };
        Object.entries(vData).forEach(([radId, w]) => {
          if (vCode(w) === 'V') {
            huidigeToewijzingen[radId] = ['V'];
          }
        });
        update.toewijzingen = huidigeToewijzingen;
      }

      batch.set(doc(db, 'indeling', datum), update, { merge: true });
    }
    await batch.commit();
  } catch (e) {
    alert('Bewerking mislukt: ' + (e.message || e.code));
  }
}

// ----- Bevries periode (datum-range) -------------------------------------

window.openVakBevriezenSheet = function() {
  if (!isBeheerder()) return;

  const vandaag = vandaagIso();
  // Default suggesties: 1 mei tot 1 september voor "april" of vergelijkbaar
  const startSugg = vandaag;
  const eindSugg = plusDagenIso(vandaag, 90);

  document.getElementById('sheetTitle').textContent = 'Bevries periode';
  document.getElementById('sheetSub').textContent = 'Accordeer alle vakantiedagen in de gekozen range in een keer';
  document.getElementById('sheetBody').innerHTML = `
    <div style="display:flex; gap:12px; margin-bottom: 12px;">
      <div style="flex:1;">
        <label class="form-label">Vanaf</label>
        <input type="date" class="input" id="vakBvStart" value="${startSugg}">
      </div>
      <div style="flex:1;">
        <label class="form-label">Tot en met</label>
        <input type="date" class="input" id="vakBvEind" value="${eindSugg}">
      </div>
    </div>
    <div id="vakBvPreview" class="form-info" style="font-size:12px; margin-bottom:1rem;">Tik op "Preview" om te zien wat er bevroren wordt.</div>
    <div style="display:flex; gap:8px;">
      <button class="btn" style="flex:1;" onclick="window.vakBevriezenPreview()">Preview</button>
      <button class="btn btn-primary" style="flex:1;" onclick="window.vakBevriezenUitvoeren()">\uD83D\uDD12 Bevries</button>
    </div>
    <button class="btn" style="width:100%; margin-top:8px;" onclick="window.closeSheet()">Annuleer</button>
  `;
  openSheet();
};

window.vakBevriezenPreview = function() {
  const start = document.getElementById('vakBvStart')?.value;
  const eind  = document.getElementById('vakBvEind')?.value;
  const preview = document.getElementById('vakBvPreview');
  if (!start || !eind || start > eind) {
    preview.textContent = 'Kies een geldige periode (vanaf moet voor tot zijn).';
    return;
  }

  const dagen = dagenInBereik(start, eind);
  const xDagen = dagen.filter(d => state.indelingMap[d]?.vakantie_x);
  const rankSet = new Set();
  xDagen.forEach(d => {
    const r = state.indelingMap[d]?.vakantie_rank;
    if (r) rankSet.add(r);
  });

  // V-totalen per radioloog in deze range
  const rads = vasteRads();
  const tellingen = {};
  rads.forEach(r => { tellingen[r.id] = 0; });
  xDagen.forEach(d => {
    const v = state.indelingMap[d]?.vakantie_v || {};
    rads.forEach(r => {
      if (vCode(v[r.id]) === 'V') tellingen[r.id]++;
    });
  });
  const tellLijst = rads.map(r => `<div style="display:flex; justify-content:space-between; padding:2px 0;"><span>${r.code} \u00b7 ${r.achternaam}</span><strong>${tellingen[r.id]} V</strong></div>`).join('');

  preview.innerHTML = `
    <div style="font-size:12px;">
      <p style="margin:0 0 6px;"><strong>${dagen.length}</strong> dagen totaal, waarvan <strong>${xDagen.length}</strong> vakantiedagen (X) over <strong>${rankSet.size}</strong> ranking(s): ${[...rankSet].join(', ') || '\u2014'}</p>
      <div>${tellLijst}</div>
    </div>
  `;
};

window.vakBevriezenUitvoeren = async function() {
  if (!isBeheerder()) return;
  const start = document.getElementById('vakBvStart')?.value;
  const eind  = document.getElementById('vakBvEind')?.value;
  if (!start || !eind || start > eind) { alert('Kies een geldige periode.'); return; }

  if (!confirm(`Periode ${start} t/m ${eind} bevriezen en V-cellen doorzetten naar Overzicht?`)) return;
  closeSheet();
  await accordeerRange(start, eind, true);
};

// ----- Ranking CRUD ------------------------------------------------------

window.openVakRankings = function() {
  if (!isBeheerder()) return;
  const lijst = state.vakantieRankings.length === 0
    ? '<p class="muted" style="font-size:12px; text-align:center;">Nog geen rankings.</p>'
    : state.vakantieRankings.map(rk => `
        <div style="display:flex; align-items:center; gap:8px; padding:8px; border:1px solid rgba(0,0,0,0.08); border-radius:6px; margin-bottom:6px;">
          <span style="display:inline-block; width:16px; height:16px; border-radius:3px; background:${rk.kleur || '#ccc'};"></span>
          <div style="flex:1;">
            <div style="font-size:13px; font-weight:500;">${rk.label || rk.naam}</div>
            <div class="muted" style="font-size:11px;">anker ${rk.anker_jaar} \u00b7 ${(rk.anker_volgorde||[]).length} maten</div>
          </div>
          <button class="btn" style="font-size:12px; padding:4px 8px;" onclick="window.openVakRankingEdit('${rk.naam}')">Bewerk</button>
          <button class="btn" style="font-size:12px; padding:4px 8px; color:#c0392b;" onclick="window.vakVerwijderRanking('${rk.naam}')">\u00d7</button>
        </div>
      `).join('');

  document.getElementById('sheetTitle').textContent = 'Ranking-tabellen';
  document.getElementById('sheetSub').textContent = 'Beheer de vakantieblok-rankings';
  document.getElementById('sheetBody').innerHTML = `
    ${lijst}
    <button class="btn btn-primary" style="width:100%; margin-top: 8px;" onclick="window.openVakRankingEdit('')">+ Nieuwe ranking</button>
    <button class="btn" style="width:100%; margin-top: 8px;" onclick="window.closeSheet()">Sluiten</button>
  `;
  openSheet();
};

window.openVakRankingEdit = function(naam) {
  const bestaand = naam ? state.vakantieRankings.find(r => r.naam === naam) : null;
  const rads = vasteRads();
  const huidigeJaar = new Date().getFullYear();

  const initVolgorde = bestaand?.anker_volgorde && bestaand.anker_volgorde.length === rads.length
    ? bestaand.anker_volgorde
    : rads.map(r => r.id);

  const itemsHtml = initVolgorde.map((rid, i) => {
    const r = rads.find(rr => rr.id === rid);
    return `<div class="vak-rank-item" draggable="true" data-rid="${rid}" style="display:flex; align-items:center; gap:8px; padding:6px 10px; background:#f5f5f5; border-radius:6px; margin-bottom:4px; cursor:grab;">
      <span style="color:#aaa; font-size:18px;">\u22ee\u22ee</span>
      <span class="vak-rank-pos" style="font-weight:600; min-width:24px;">${i+1}.</span>
      <span style="font-size:13px;">${r ? `${r.code} \u00b7 ${r.achternaam}` : rid}</span>
    </div>`;
  }).join('');

  document.getElementById('sheetTitle').textContent = naam ? 'Ranking bewerken' : 'Nieuwe ranking';
  document.getElementById('sheetSub').textContent = 'Naam, label, kleur en anker-volgorde';
  document.getElementById('sheetBody').innerHTML = `
    <div class="form-field">
      <label class="form-label">Naam (intern, geen spaties)</label>
      <input type="text" class="input" id="vakRkNaam" value="${bestaand?.naam || ''}" ${naam ? 'readonly style="background:#f5f5f5"' : ''} placeholder="bv. zomer1">
    </div>
    <div class="form-field">
      <label class="form-label">Label</label>
      <input type="text" class="input" id="vakRkLabel" value="${bestaand?.label || ''}" placeholder="bv. Zomer 1">
    </div>
    <div style="display:flex; gap:12px; margin-bottom: 12px;">
      <div style="flex:1;">
        <label class="form-label">Kleur</label>
        <input type="color" id="vakRkKleur" value="${bestaand?.kleur || '#4caf50'}" style="width:100%; height:38px; border:1px solid rgba(0,0,0,0.1); border-radius:6px; padding:2px;">
      </div>
      <div style="flex:1;">
        <label class="form-label">Anker-jaar</label>
        <input type="number" class="input" id="vakRkAnker" value="${bestaand?.anker_jaar || huidigeJaar}" min="2020" max="2050">
      </div>
    </div>
    <label class="form-label">Volgorde voor anker-jaar (sleep)</label>
    <div id="vakRkVolgorde" style="margin-top: 6px;">${itemsHtml}</div>
    <div style="display:flex; gap:8px; margin-top: 12px;">
      <button class="btn btn-primary" style="flex:1;" onclick="window.vakOpslaanRanking('${naam}')">Opslaan</button>
      <button class="btn" style="flex:1;" onclick="window.openVakRankings()">Terug</button>
    </div>
  `;
  if (!naam) openSheet();
  hangVakRankDragDrop();
};

function hangVakRankDragDrop() {
  const container = document.getElementById('vakRkVolgorde');
  if (!container) return;
  let dragSrc = null;
  container.querySelectorAll('.vak-rank-item').forEach(el => {
    el.addEventListener('dragstart', () => { dragSrc = el; el.style.opacity = '0.4'; });
    el.addEventListener('dragend', () => { el.style.opacity = '1'; hernummerVakRank(); });
    el.addEventListener('dragover', e => { e.preventDefault(); });
    el.addEventListener('drop', e => {
      e.preventDefault();
      if (dragSrc && dragSrc !== el) container.insertBefore(dragSrc, el);
    });
  });
}

function hernummerVakRank() {
  const items = document.querySelectorAll('#vakRkVolgorde .vak-rank-item');
  items.forEach((el, i) => {
    const pos = el.querySelector('.vak-rank-pos');
    if (pos) pos.textContent = `${i+1}.`;
  });
}

window.vakOpslaanRanking = async function(origineelNaam) {
  const naam = (document.getElementById('vakRkNaam')?.value || '').trim();
  const label = (document.getElementById('vakRkLabel')?.value || '').trim();
  const kleur = document.getElementById('vakRkKleur')?.value || '#4caf50';
  const ankerJaar = parseInt(document.getElementById('vakRkAnker')?.value, 10) || new Date().getFullYear();

  if (!naam) { alert('Vul een naam in.'); return; }
  if (!label) { alert('Vul een label in.'); return; }
  if (/\s/.test(naam)) { alert('Naam mag geen spaties bevatten.'); return; }

  const items = document.querySelectorAll('#vakRkVolgorde .vak-rank-item');
  const volgorde = [...items].map(el => el.getAttribute('data-rid'));

  try {
    const docId = origineelNaam || naam;
    await setDoc(doc(db, 'vakantie_rankings', docId), {
      naam, label, kleur,
      anker_jaar: ankerJaar,
      anker_volgorde: volgorde,
    });
    closeSheet();
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};

window.vakVerwijderRanking = async function(naam) {
  if (!isBeheerder()) return;
  if (!confirm(`Ranking "${naam}" verwijderen? Dagen die deze ranking gebruiken behouden hun verwijzing maar krijgen geen kleur meer.`)) return;
  try {
    await deleteDoc(doc(db, 'vakantie_rankings', naam));
  } catch (e) {
    alert('Verwijderen mislukt: ' + (e.message || e.code));
  }
};
