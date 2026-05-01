// Vakantie-view: maand-per-maand kalender met V-toggle en code-keuze.
// Enkel-tik = V toggle. Dubbel-tik = code-keuze sheet (V/K/Z of vrije code).
//
// Datamodel:
//   indeling/{datum}.vakantie_x        bool
//   indeling/{datum}.vakantie_min      number
//   indeling/{datum}.vakantie_rank     string
//   indeling/{datum}.vakantie_v        { [radId]: true | "K" | "Z" | ... }
//   indeling/{datum}.vakantie_geaccordeerd bool
//   vakantie_rankings/{naam} { naam, label, kleur, anker_jaar, anker_volgorde[8] }

import {
  setDoc, updateDoc, doc, deleteDoc, writeBatch, deleteField
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

// Lazy ranking-resolution: als een dag geen eigen vakantie_rank heeft,
// gebruik dan de rank van de meest recente eerdere X-dag met expliciete rank.
function effectieveRank(datum) {
  const dag = state.indelingMap[datum];
  if (dag?.vakantie_rank) return dag.vakantie_rank;
  return vorigeRankWaarde(datum);
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
// Eerste tik: start een 300ms timer met de "enkel"-actie. Als binnen die
// 300ms een tweede tik komt op dezelfde cel, annuleer de timer en doe de
// "dubbel"-actie (sheet openen).

const DBL_TAP_MS = 300;
let _dblTimer = null;
let _dblTarget = null;

function attachDblTap(el, key, onEnkel, onDubbel) {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (_dblTimer && _dblTarget === key) {
      // Tweede tik binnen vertraging: annuleer enkel-actie en doe dubbel-actie
      clearTimeout(_dblTimer);
      _dblTimer = null;
      _dblTarget = null;
      onDubbel();
    } else {
      // Eerste tik: wacht of er een tweede komt
      if (_dblTimer) clearTimeout(_dblTimer);
      _dblTarget = key;
      _dblTimer = setTimeout(() => {
        _dblTimer = null;
        _dblTarget = null;
        onEnkel();
      }, DBL_TAP_MS);
    }
  });
}

// ----- Render --------------------------------------------------------------

// Welke maand is het laatst gerenderd. Wordt gebruikt om scroll-positie wel
// te behouden binnen dezelfde maand, maar te resetten bij maandwissel.
let _laatsteGeRenderdeMaand = null;

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
  // Welke maand wordt getoond? Default = huidige maand.
  // state.vakZichtbareMaand is bv. "2026-04" voor april 2026.
  const vandaag = vandaagIso();
  if (!state.vakZichtbareMaand) {
    state.vakZichtbareMaand = vandaag.slice(0, 7);
  }
  const [zichtbaarJaarStr, zichtbaarMaandStr] = state.vakZichtbareMaand.split('-');
  const zichtbaarJaarNum = parseInt(zichtbaarJaarStr, 10);
  const zichtbaarMaandNum = parseInt(zichtbaarMaandStr, 10) - 1; // 0-indexed
  const startMaand = new Date(zichtbaarJaarNum, zichtbaarMaandNum, 1);
  const eindMaand  = new Date(zichtbaarJaarNum, zichtbaarMaandNum + 1, 0); // laatste dag van maand
  const startDatum = startMaand.toISOString().slice(0, 10);
  const eindDatum  = eindMaand.toISOString().slice(0, 10);

  const datums = dagenInBereik(startDatum, eindDatum);

  const rankingMap = {};
  state.vakantieRankings.forEach(r => { rankingMap[r.naam] = r; });

  // Saldo voor het zichtbare jaar
  const huidigJaar = zichtbaarJaarNum;
  const jaarStart = `${huidigJaar}-01-01`;
  const jaarEind  = `${huidigJaar}-12-31`;
  const saldoMap = {};
  allKolommen.forEach(k => { saldoMap[k.id] = berekenSaldoRange(k.id, jaarStart, jaarEind); });

  const toonBeheer = state.toonWeekRads;
  const toonW = state.toonWeekRads;

  const radCount = allKolommen.length;
  const radColsCss = `repeat(${radCount}, minmax(28px, 1fr))`;
  const beheerCols = toonBeheer ? ' 24px 32px 64px 50px' : '';
  const gridCols = `50px ${radColsCss}${beheerCols}`;
  const totaalKolommen = 1 + radCount + (toonBeheer ? 4 : 0);

  const radHeads = allKolommen.map((k, i) => {
    const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);padding-left:4px;' : '';
    return `<div class="grid-head" style="${sep}" title="${radsMap[k.id]?.achternaam || k.label}">${k.label}</div>`;
  }).join('');
  const beheerHeads = toonBeheer
    ? `<div class="grid-head" title="Vakantiedag aan/uit">X</div>` +
      `<div class="grid-head" title="Minimale bezetting">Min</div>` +
      `<div class="grid-head" title="Ranking-tabel">Rank</div>` +
      `<div class="grid-head"></div>`
    : '';

  const saldoCells = allKolommen.map((k, i) => {
    const s = saldoMap[k.id];
    const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);padding-left:4px;' : '';
    const radObj = rads.find(r => r.id === k.id) || invallers.find(r => r.id === k.id);
    const recht = (typeof radObj?.vakantierecht === 'number') ? radObj.vakantierecht : 40;
    const resterend = recht - s.saldo;
    const overschreden = resterend < 0;
    const kleur = overschreden ? 'color: #c0392b; font-weight: 700;' : '';
    const titel = `${s.v} V-dagen ingedeeld, ${s.vEnDienst} samenvallend met dienst, recht ${recht}, resterend ${resterend}`;
    return `<div class="vak-saldo-cell" style="${sep} ${kleur}" title="${titel}">${resterend}</div>`;
  }).join('');

  // Ranking-balk: continu in beeld zolang er ergens een ranking bekend is.
  // Pak de eerste expliciete rank in de zichtbare maand; valt terug op de
  // meest recente eerdere rank zodat de balk ook getoond wordt op maanden
  // zonder eigen X-dagen of expliciete rank.
  let rankingCells = '';
  let rankingActief = false;
  {
    let rankNaam = null;
    for (const iso of datums) {
      const r = state.indelingMap[iso]?.vakantie_rank;
      if (r) { rankNaam = r; break; }
    }
    if (!rankNaam) {
      rankNaam = vorigeRankWaarde(datums[0]);
    }
    const rk = rankNaam ? rankingMap[rankNaam] : null;
    if (rk) {
      rankingActief = true;
      const jaar = zichtbaarJaarNum;
      const volgorde = rankingVolgordeVoorJaar(rk, jaar);
      // posMap: radId -> positie 1..8
      const posMap = {};
      volgorde.forEach((rid, i) => { posMap[rid] = i + 1; });
      rankingCells = allKolommen.map((k, i) => {
        const sep = (i === rads.length && toonW) ? 'border-left:1px solid rgba(0,0,0,0.15);padding-left:4px;' : '';
        const pos = posMap[k.id];
        return `<div class="vak-rank-cell" style="${sep}" title="${rk.label || rk.naam}">${pos != null ? pos : ''}</div>`;
      }).join('');
    }
  }

  let body = '';

  datums.forEach(iso => {
    const d = new Date(iso + 'T12:00:00');

    const dag = state.indelingMap[iso] || {};
    const x   = dag.vakantie_x || false;
    const min = (typeof dag.vakantie_min === 'number') ? dag.vakantie_min : 5;
    // Lazy rank: als deze dag geen rank heeft, erf van eerdere X-dag.
    const rank = x ? effectieveRank(iso) : (dag.vakantie_rank || null);
    const ranking = rank ? rankingMap[rank] : null;
    const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
    const isVandaag = (iso === vandaag);
    const geaccordeerd = dag.vakantie_geaccordeerd || false;

    const vDataObj = dag.vakantie_v || {};
    const vAantal = allKolommen.reduce((n, k) => n + (vCode(vDataObj[k.id]) === 'V' ? 1 : 0), 0);
    const overschreden = vAantal > (rads.length - min);

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
        if (code === 'V') {
          return `<div class="grid-cell f-V" style="${sep} ${eigenMark} ${cursor}" ${dataAttr}>${code}</div>`;
        } else {
          // Niet-V (K, Z, vrije code) krijgt een gele celkleur, niet de hele rij
          return `<div class="grid-cell" style="${sep} ${eigenMark} ${cursor} background: #fff3d6; color: #6b5b1a; font-weight: 500;" ${dataAttr}>${code}</div>`;
        }
      } else {
        return `<div class="grid-cell grid-cell-empty" style="${sep} ${eigenMark} ${rijStyle} ${cursor}" ${dataAttr}>\u00b7</div>`;
      }
    }).join('');

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
      if (isBeheer && !geaccordeerd) {
        // Beheerder mag minimale bezetting altijd wijzigen, ook als X uit staat.
        // Toon werkelijke opgeslagen waarde (geen default 5) zodat leeg blijft als
        // er nog niets is gezet.
        const val = (typeof dag.vakantie_min === 'number') ? dag.vakantie_min : '';
        mCel = `<div class="vak-cell-readonly" style="${rijStyle} padding: 2px;"><input type="number" min="0" max="${rads.length}" value="${val}" onchange="window.vakSetMin('${iso}', this.value)" style="width: 28px; border: 1px solid rgba(0,0,0,0.1); border-radius: 3px; padding: 2px; text-align: center; font-size: 11px; background: transparent;"></div>`;
      } else {
        const toon = (typeof dag.vakantie_min === 'number') ? dag.vakantie_min : '';
        mCel = `<div class="vak-cell-readonly" style="${rijStyle}">${toon}</div>`;
      }

      let rCel;
      if (isBeheer && !geaccordeerd) {
        // Beheerder mag ranking altijd kiezen, onafhankelijk van X. Toon de
        // effectieve rank (eigen of ge\u00ebrfd voor X-dagen) als selectie zodat
        // duidelijk is welke ranking actief is. Een wijziging zet altijd een
        // expliciete rank op deze dag.
        const huidigeRank = rank || '';
        const opties = state.vakantieRankings.map(rk =>
          `<option value="${rk.naam}" ${rk.naam === huidigeRank ? 'selected' : ''}>${rk.label || rk.naam}</option>`
        ).join('');
        rCel = `<div class="vak-cell-readonly" style="${rijStyle} padding: 2px;"><select onchange="window.vakSetRank('${iso}', this.value)" style="width:100%; border: 1px solid rgba(0,0,0,0.1); border-radius: 3px; padding: 2px; font-size: 10px; background: transparent;"><option value="">\u2014</option>${opties}</select></div>`;
      } else {
        const klikbaar = isBeheer && x && rank;
        const ds = klikbaar ? `data-vak-blok="${iso}"` : '';
        const cur = klikbaar ? 'cursor:pointer;' : '';
        rCel = `<div class="vak-cell-readonly" style="${rijStyle} font-size:10px; ${cur}" ${ds} title="${ranking?.label || ''}${klikbaar ? ' \u2014 tik voor accordeer' : ''}">${ranking?.label || rank || ''}</div>`;
      }

      beheerCells = xCel + mCel + rCel;

      // Extra datum-kolom helemaal rechts (zelfde inhoud als links)
      const dagCellRechts = `<div class="grid-day" style="${dagCellStyle}"><span>${dagNaamKort}</span><span>${dagNummer}</span></div>`;
      beheerCells += dagCellRechts;
    }

    body += dagCell + radCells + beheerCells;
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
          ${beheerHeads}
        </div>
        <div class="vak-sticky-row vak-saldo-row" id="vakSaldoRow">
          <div class="vak-saldo-label" id="vakSaldoLabel">Saldo</div>
          ${saldoCells}
          ${toonBeheer ? '<div></div><div></div><div></div><div></div>' : ''}
        </div>
        ${rankingActief ? `<div class="vak-sticky-row vak-rank-row">
          <div class="vak-rank-label">Rang</div>
          ${rankingCells}
          ${toonBeheer ? '<div></div><div></div><div></div><div></div>' : ''}
        </div>` : ''}
        <div class="vak-maand-nav" style="top: ${rankingActief ? '82px' : '56px'}; grid-column: 1 / span ${totaalKolommen};">
          <button class="nav-btn" onclick="window.vakNavMaand(-1)" title="Vorige maand">\u2039</button>
          <span class="vak-maand-titel">${MAANDEN[zichtbaarMaandNum].toUpperCase()} ${zichtbaarJaarNum}</span>
          <button class="nav-btn" onclick="window.vakNavMaand(1)" title="Volgende maand">\u203a</button>
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
    attachDblTap(el, 'x|' + datum,
      () => window.vakToggleX(datum),
      () => window.openVakXSheet(datum),
    );
  });
  container.querySelectorAll('[data-vak-blok]').forEach(el => {
    const datum = el.getAttribute('data-vak-blok');
    el.addEventListener('click', () => window.openVakBlokSheet(datum));
  });

  // Scroll-positie behouden bij re-render binnen dezelfde maand.
  // Bij maandwissel begint de scroll vanzelf bovenaan.
  const wrap = container.querySelector('.vak-grid-wrap');
  if (wrap && state.vakZichtbareMaand === _laatsteGeRenderdeMaand) {
    wrap.scrollTop = scrollTop;
    wrap.scrollLeft = scrollLeft;
  }
  _laatsteGeRenderdeMaand = state.vakZichtbareMaand;
}

// ----- Window handlers -----------------------------------------------------

window.vakToggleW = function() {
  state.toonWeekRads = !state.toonWeekRads;
  renderVakView();
};

// Navigeer naar volgende of vorige maand. delta: -1 = terug, +1 = vooruit.
window.vakNavMaand = function(delta) {
  const maand = state.vakZichtbareMaand || vandaagIso().slice(0, 7);
  const [j, m] = maand.split('-').map(Number);
  const d = new Date(j, m - 1 + delta, 1);
  const nj = d.getFullYear();
  const nm = String(d.getMonth() + 1).padStart(2, '0');
  state.vakZichtbareMaand = `${nj}-${nm}`;
  renderVakView();
};

window.vakScrollNaarVandaag = function() {
  // Spring naar de huidige maand
  state.vakZichtbareMaand = vandaagIso().slice(0, 7);
  renderVakView();
};

window.vakToggleV = async function(datum, radId) {
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;
  const huidig = dag.vakantie_v || {};
  const huidigeCode = vCode(huidig[radId]);

  const docRef = doc(db, 'indeling', datum);
  try {
    if (huidigeCode) {
      // Weghalen: gebruik dot-path met deleteField, dan blijven andere
      // radiologen' V's ongemoeid. Document moet bestaan voor updateDoc.
      const veld = `vakantie_v.${radId}`;
      await updateDoc(docRef, { [veld]: deleteField() });
    } else {
      // Toevoegen: dot-path zorgt voor merge per subveld zonder andere
      // velden weg te gooien.
      const veld = `vakantie_v.${radId}`;
      // setDoc met merge zorgt dat het document wordt aangemaakt als het nog
      // niet bestaat (anders zou updateDoc falen).
      await setDoc(docRef, { datum, vakantie_v: { [radId]: true } }, { merge: true });
    }
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
  closeSheet();
  const docRef = doc(db, 'indeling', datum);
  const veld = `vakantie_v.${radId}`;
  try {
    if (code) {
      const waarde = (code === 'V') ? true : code;
      await setDoc(docRef, { datum, vakantie_v: { [radId]: waarde } }, { merge: true });
    } else {
      await updateDoc(docRef, { [veld]: deleteField() });
    }
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};

// ----- X-cel: rij vullen met één code voor iedereen ---------------------

window.openVakXSheet = function(datum) {
  if (!isBeheerder()) return;
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;

  document.getElementById('sheetTitle').textContent = `Hele dag invullen \u00b7 ${datum}`;
  document.getElementById('sheetSub').textContent = 'Vult deze code in voor alle radiologen op deze dag';
  document.getElementById('sheetBody').innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 1rem;">
      <button class="picker-option f-V" onclick="window.vakVulRijIn('${datum}','V')">V<div class="picker-label">Vakantie</div></button>
      <button class="picker-option f-K" onclick="window.vakVulRijIn('${datum}','K')">K<div class="picker-label">Cursus</div></button>
    </div>
    <div class="form-field">
      <label class="form-label">Vrije code (1 letter, bv. F voor feestdag)</label>
      <input type="text" class="input" id="vakXVrij" maxlength="3" placeholder="bv. F" style="text-transform: uppercase;">
    </div>
    <div style="display:flex; gap:8px; margin-top: 12px;">
      <button class="btn btn-primary" style="flex:1;" onclick="window.vakVulRijInVrij('${datum}')">Vrije code invullen</button>
    </div>
    <div style="display:flex; gap:8px; margin-top: 8px;">
      <button class="btn" style="flex:1;" onclick="window.vakVulRijIn('${datum}','')">Rij leegmaken</button>
      <button class="btn" style="flex:1;" onclick="window.closeSheet()">Annuleer</button>
    </div>
  `;
  openSheet();
};

window.vakVulRijIn = async function(datum, code) {
  if (!isBeheerder()) return;
  const dag = state.indelingMap[datum] || {};
  if (dag.vakantie_geaccordeerd) return;

  const rads = vasteRads();
  const nieuw = {};
  if (code) {
    rads.forEach(r => {
      nieuw[r.id] = (code === 'V') ? true : code;
    });
  }
  closeSheet();
  try {
    await setDoc(doc(db, 'indeling', datum), { datum, vakantie_v: nieuw }, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + (e.message || e.code));
  }
};

window.vakVulRijInVrij = function(datum) {
  const inp = document.getElementById('vakXVrij');
  const code = (inp?.value || '').trim().toUpperCase();
  if (!code) { alert('Vul een code in.'); return; }
  if (code.length > 3) { alert('Max 3 tekens.'); return; }
  window.vakVulRijIn(datum, code);
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
