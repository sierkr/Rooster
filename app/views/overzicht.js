// Overzicht-view (voorheen "Beheer"): hoofdraster met cellen per (datum × radioloog).
// Klik op cel = wijzigen (beheerders), opmerking lezen (lezers).
import { state, DAGEN_NL } from '../state.js';
import {
  vasteRads, actieveInvallers, vasteRadsOpDatum, actieveInvallersOpDatum,
  radiologenMap, functiesMap, vandaagIso,
  isoWeekVan, datumsVanWeek, weekRange, formatDatum, fclass, functieNaam,
  toewijzingVoor, hoofdLetterCode, magWijzigen, magOpmerkingen, magBeheerLezen,
  magAlleWensenZien,
} from '../helpers.js';
import { openSheet } from '../sheets.js';
import { valideerWeek } from '../validatie.js';
import { slaToewijzingOp, slaCelOpmerkingOp, slaOpmerkingOp } from '../save.js';

export function renderBehView() {
  const container = document.getElementById('view-beh');
  const wkMa = state.weekMaandag;
  // Datum-aware bezetting: kolomnamen tonen wie er die week op de stoel zit.
  const vasteRadsList = vasteRadsOpDatum(wkMa);
  if (vasteRadsList.length === 0) { container.innerHTML = '<div class="empty-state">Laden…</div>'; return; }
  const wkNr = isoWeekVan(wkMa);
  const datums = datumsVanWeek(wkMa);
  const vandaag = vandaagIso();

  const alleenOpmerkingen = !magWijzigen() && magOpmerkingen();
  const alleenLezen = !magWijzigen() && !magOpmerkingen();

  const toonW = state.toonWeekRads;
  const invallers = toonW ? actieveInvallersOpDatum(wkMa) : [];
  const allKolommen = [
    ...vasteRadsList.map(r => ({ id: r.id, label: r.code, isSlot: false })),
    ...invallers.map(r => ({ id: r.id, label: r.code || r.id, isSlot: true })),
  ];
  const kolBreedte = toonW ? 'minmax(28px, 1fr)' : 'minmax(0, 1fr)';
  const gridCols = `34px repeat(${allKolommen.length}, ${kolBreedte})${toonW ? ' 32px' : ''}`;

  const tellenCodes = (window.TELLEN_CODES || ['B','E','M','D','O','S','W']);
  function telPerDag(datum) {
    let n = 0;
    [...vasteRadsList, ...invallers].forEach(r => {
      const codes = toewijzingVoor(datum, r.id);
      if (codes.some(c => tellenCodes.includes(hoofdLetterCode(c)))) n++;
    });
    return n;
  }
  function telKleur(n) {
    if (n <= 4) return '#c0392b';
    if (n === 5) return '#5dcaa5';
    return '#2e7d50';
  }

  const conflicten = valideerWeek(wkMa);
  const fouten = conflicten.filter(c => c.ernst === 'blokkeren');
  const warnings = conflicten.filter(c => c.ernst === 'waarschuwing');

  const celStatus = {};
  conflicten.forEach(c => {
    if (c.radId) {
      const k = `${c.datum}|${c.radId}`;
      const huidig = celStatus[k];
      if (c.ernst === 'blokkeren') celStatus[k] = 'error';
      else if (!huidig) celStatus[k] = 'warn';
    }
  });

  const wensenIndex = {};
  // Beheerder of gebruiker met "Wensen van iedereen zien" → alle stippen.
  // Anders: alleen de eigen wensen.
  const eigenRadId = state.profiel?.radioloog_id;
  const alleZien = magAlleWensenZien();
  state.wensen.forEach(w => {
    if (!datums.includes(w.datum)) return;
    if (!alleZien && w.radioloog_id !== eigenRadId) return;
    const k = `${w.datum}|${w.radioloog_id}`;
    wensenIndex[k] = w.status || 'open';
  });

  let bannerHtml = '';
  if (fouten.length > 0) {
    bannerHtml = `<div class="validatie-banner validatie-banner-error" onclick="window.toonConflictenSheet('${wkMa}')">
      <div class="validatie-icon validatie-icon-error">!</div>
      <div><b>${fouten.length} conflict${fouten.length===1?'':'en'}</b> deze week${warnings.length ? `, en ${warnings.length} waarschuwing${warnings.length===1?'':'en'}` : ''} — tik voor details</div>
    </div>`;
  } else if (warnings.length > 0) {
    bannerHtml = `<div class="validatie-banner validatie-banner-warn" onclick="window.toonConflictenSheet('${wkMa}')">
      <div class="validatie-icon validatie-icon-warn">!</div>
      <div><b>${warnings.length} waarschuwing${warnings.length===1?'':'en'}</b> deze week — tik voor details</div>
    </div>`;
  } else if (state.validatieRegels.length > 0) {
    bannerHtml = `<div class="validatie-banner validatie-banner-ok">
      <div class="validatie-icon validatie-icon-ok">✓</div>
      <div>Geen conflicten of waarschuwingen deze week</div>
    </div>`;
  }

  let html = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
        <button class="nav-btn" onclick="window.navigeerWeek(-1)">‹</button>
        <div class="wk-datum-wrap" style="flex: 1; text-align: center;" title="Kies een datum">
          <div style="font-size: 15px; font-weight: 500; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px;">Week ${wkNr}</div>
          <div class="muted">${weekRange(wkMa)}</div>
          <input type="date" class="wk-datum-input" value="${wkMa}" onchange="window.weekKiezerWissel(this)">
        </div>
        <button class="nav-btn" onclick="window.navigeerWeek(1)">›</button>
        <button class="nav-btn today" onclick="window.naarVandaag()">Nu</button>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <p class="muted" style="margin: 0;">${alleenLezen ? 'Alleen-lezen — tik ▲ voor opmerking' : (alleenOpmerkingen ? 'Tik op een dag voor opmerking' : 'Tik op een cel om te wijzigen')}</p>
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
          <span class="muted">W-slots</span>
          <span class="toggle-switch ${toonW ? 'aan' : ''}" onclick="window.toggleWeekRads()"></span>
        </label>
      </div>
    </div>

    ${bannerHtml}

    <div class="grid-wrap">
      <div class="plan-grid" style="grid-template-columns: ${gridCols}; min-width: ${toonW ? '500' : '330'}px;">
        <div class="grid-head"></div>
        ${allKolommen.map((k, i) => {
          const sep = (i === vasteRadsList.length && toonW) ? 'border-left: 1px solid rgba(0,0,0,0.15); padding-left: 4px;' : '';
          return `<div class="grid-head" style="${sep}">${k.label}</div>`;
        }).join('')}
        ${toonW ? `<div class="grid-head" style="border-left: 1px solid rgba(0,0,0,0.15); padding-left: 4px;" title="Aantal radiologen actief op tellende functies">∑</div>` : ''}
        ${datums.map(datum => {
          const d = new Date(datum + 'T12:00:00');
          const isVandaag = datum === vandaag;
          const dagNaamKort = DAGEN_NL[d.getDay() === 0 ? 6 : d.getDay() - 1];
          const dagNummer = d.getDate();
          const dagLabel = `<span>${dagNaamKort}</span><span>${dagNummer}</span>`;
          const dagOpm = state.indelingMap[datum]?.opmerking;
          let dagOnclick, dagCursor;
          if (alleenLezen) {
            dagOnclick = dagOpm ? `onclick="window.toonDagOpmerking('${datum}')"` : '';
            dagCursor = dagOpm ? 'pointer' : 'default';
          } else {
            dagOnclick = `onclick="window.opmerkingBewerken('${datum}')"`;
            dagCursor = 'pointer';
          }
          const dagOpmMarker = dagOpm ? `<span class="opm-marker" title="${(dagOpm+'').replace(/"/g,'&quot;')}"></span>` : '';
          return `
            <div class="grid-day ${isVandaag ? 'grid-day-active' : ''}" ${dagOnclick} style="cursor: ${dagCursor}; position: relative; display: flex; justify-content: space-between; align-items: baseline; padding-right: 4px;">${dagLabel}${dagOpmMarker}</div>
            ${allKolommen.map((k, i) => {
              const codes = toewijzingVoor(datum, k.id);
              const code1 = codes[0] || '';
              const code2 = codes[1] || '';
              const isDuo = !!code2;
              // Bij duo: gebruik kleur van eerste code als hoofdkleur
              const cls = code1 ? fclass(code1) : 'grid-cell-empty';
              const celOpm = state.indelingMap[datum]?.cel_opmerkingen?.[k.id];
              let onclick, readonly;
              if (alleenOpmerkingen || alleenLezen) {
                if (celOpm) {
                  onclick = `onclick="window.toonCelDetail('${datum}', '${k.id}')"`;
                  readonly = '';
                } else {
                  onclick = '';
                  readonly = 'grid-cell-readonly';
                }
              } else {
                onclick = `onclick="window.openCell('${datum}', '${k.id}')"`;
                readonly = '';
              }
              const status = celStatus[`${datum}|${k.id}`];
              const statusCls = status === 'error' ? 'grid-cell-conflict-error' : (status === 'warn' ? 'grid-cell-conflict-warn' : '');
              const sep = (i === vasteRadsList.length && toonW) ? 'border-left: 1px solid rgba(0,0,0,0.15);' : '';
              const wens = wensenIndex[`${datum}|${k.id}`];
              const wensTitels = { open: 'Wens: nog niet behandeld', verwerkt: 'Wens: goedgekeurd', afgewezen: 'Wens: afgewezen' };
              const wensMarker = wens ? `<span class="wens-marker wens-marker-${wens}" title="${wensTitels[wens] || wens}"></span>` : '';
              const opmMarker = celOpm ? `<span class="opm-marker" title="${(celOpm+'').replace(/"/g,'&quot;')}"></span>` : '';
              // Duo-weergave: codes met ' / ' tussen, bv. "B / M".
              const inhoud = isDuo
                ? `${code1} / ${code2}`
                : (code1 || '·');
              return `<div class="grid-cell ${cls} ${readonly} ${statusCls}" style="${sep}" ${onclick}>${inhoud}${wensMarker}${opmMarker}</div>`;
            }).join('')}
            ${toonW ? (() => {
              const n = telPerDag(datum);
              return `<div class="grid-cell" style="border-left: 1px solid rgba(0,0,0,0.15); background: transparent; color: ${telKleur(n)}; font-weight: 600;">${n}</div>`;
            })() : ''}
          `;
        }).join('')}
      </div>
    </div>

    <div class="legend">
      <div class="legend-label">Legenda</div>
      <div class="legend-items">
        ${['W','B','E','M','D','O','S','A','R','Z','V','K'].map(c => {
          const f = functiesMap()[c];
          const naam = f ? f.naam.split('/')[0] : c;
          return `<span class="legend-item f-${c}">${c} ${naam}</span>`;
        }).join('')}
      </div>
    </div>
  `;
  container.innerHTML = html;
}

// ==== Handlers ===============================================================

window.toonConflictenSheet = function(weekId) {
  const conflicten = valideerWeek(weekId);
  const fouten = conflicten.filter(c => c.ernst === 'blokkeren');
  const warnings = conflicten.filter(c => c.ernst === 'waarschuwing');
  const wkLabel = typeof weekId === 'string' ? `Week ${isoWeekVan(weekId)}` : `Week ${weekId}`;

  document.getElementById('sheetTitle').textContent = `${wkLabel} — controle`;
  document.getElementById('sheetSub').textContent = `${fouten.length} conflict${fouten.length===1?'':'en'}, ${warnings.length} waarschuwing${warnings.length===1?'':'en'}`;

  let body = '';
  if (fouten.length === 0 && warnings.length === 0) {
    body = `<div class="empty-state"><div class="empty-state-icon">✓</div>Alles in orde</div>`;
  } else {
    if (fouten.length > 0) {
      body += `<div style="font-size: 12px; font-weight: 500; margin-bottom: 6px; color: #501313;">Conflicten</div>`;
      fouten.forEach(c => {
        const radNaam = c.radId ? (radiologenMap()[c.radId]?.code || c.radId) : '';
        body += `<div class="conflict-item conflict-error">
          <div>${c.bericht}</div>
          <div class="conflict-meta">${formatDatum(c.datum, 'kort')}${radNaam ? ' · ' + radNaam : ''} ${c.codes?.join(',') ? '· ' + c.codes.join(',') : ''}</div>
        </div>`;
      });
    }
    if (warnings.length > 0) {
      body += `<div style="font-size: 12px; font-weight: 500; margin: 12px 0 6px; color: #412402;">Waarschuwingen</div>`;
      warnings.forEach(c => {
        const radNaam = c.radId ? (radiologenMap()[c.radId]?.code || c.radId) : '';
        body += `<div class="conflict-item conflict-warn">
          <div>${c.bericht}</div>
          <div class="conflict-meta">${formatDatum(c.datum, 'kort')}${radNaam ? ' · ' + radNaam : ''} ${c.codes?.join(',') ? '· ' + c.codes.join(',') : ''}</div>
        </div>`;
      });
    }
  }
  body += `<button class="btn" style="width: 100%; margin-top: 1rem;" onclick="window.closeSheet()">Sluiten</button>`;
  document.getElementById('sheetBody').innerHTML = body;
  openSheet();
};

// Read-only weergave dag-opmerking (voor non-wijzigers)
window.toonDagOpmerking = function(datum) {
  const dag = state.indelingMap[datum];
  const opm = dag?.opmerking || '';
  document.getElementById('sheetTitle').textContent = formatDatum(datum, 'lang');
  document.getElementById('sheetSub').textContent = 'Dag-opmerking';
  document.getElementById('sheetBody').innerHTML = `
    ${opm
      ? `<div class="summary"><div class="summary-label">Opmerking</div><div class="summary-text" style="white-space: pre-wrap;">${opm.replace(/</g,'&lt;')}</div></div>`
      : `<div class="muted" style="font-style: italic;">Geen dag-opmerking</div>`}
    <button class="btn" style="width: 100%; margin-top: 1rem;" onclick="window.closeSheet()">Sluiten</button>
  `;
  openSheet();
};

// Read-only weergave cel-detail (voor lezers/secretariaat/radiologen)
window.toonCelDetail = function(datum, radId) {
  const radsMap = radiologenMap();
  const rad = radsMap[radId];
  const label = rad ? `${rad.code} · ${rad.achternaam}` : radId;
  const codes = toewijzingVoor(datum, radId);
  const huidigCode = codes[0] || '';
  const dag = state.indelingMap[datum];
  const celOpm = dag?.cel_opmerkingen?.[radId] || '';

  document.getElementById('sheetTitle').textContent = `${label} · ${formatDatum(datum, 'kort')}`;
  // Sub-tekst: één code = "B · Bucky/Echo", twee codes = "B · Bucky/Echo  +  M · Mammo"
  let subTekst;
  if (codes.length === 0) subTekst = 'Geen toewijzing';
  else if (codes.length === 1) subTekst = `${codes[0]} · ${functieNaam(codes[0])}`;
  else subTekst = `Ochtend ${codes[0]} · ${functieNaam(codes[0])} — Middag ${codes[1]} · ${functieNaam(codes[1])}`;
  document.getElementById('sheetSub').textContent = subTekst;

  const opmHtml = celOpm
    ? `<div class="summary"><div class="summary-label">Opmerking</div><div class="summary-text" style="white-space: pre-wrap;">${celOpm.replace(/</g,'&lt;')}</div></div>`
    : `<div class="muted" style="font-style: italic;">Geen opmerking</div>`;

  document.getElementById('sheetBody').innerHTML = `
    ${opmHtml}
    ${dag?.opmerking ? `<div class="summary"><div class="summary-label">Dag-opmerking</div><div class="summary-text" style="white-space: pre-wrap;">${dag.opmerking.replace(/</g,'&lt;')}</div></div>` : ''}
    <button class="btn" style="width: 100%; margin-top: 1rem;" onclick="window.closeSheet()">Sluiten</button>
  `;
  openSheet();
};

// Tijdelijke staat voor de picker — wat de gebruiker nu heeft geselecteerd.
// Wordt bij elke openCell opnieuw geïnitialiseerd vanuit de huidige toewijzing.
let _pickerCodes = [];
let _pickerCtx   = { datum: null, radId: null };

window.openCell = function(datum, radId) {
  if (!magWijzigen()) return;
  const radsMap = radiologenMap();
  const rad = radsMap[radId];
  const label = rad ? rad.code : radId;
  const codes = toewijzingVoor(datum, radId);
  _pickerCodes = [...codes].slice(0, 2);
  _pickerCtx = { datum, radId };

  const dag = state.indelingMap[datum];
  const huidigOpm = dag?.cel_opmerkingen?.[radId] || '';

  const wens = state.wensen.find(w => w.datum === datum && w.radioloog_id === radId);
  let wensInfo = '';
  if (wens) {
    const typeLabel = { vakantie: 'Vakantie', niet_beschikbaar: 'Niet beschikbaar', voorkeur: 'Voorkeur' }[wens.type] || wens.type;
    const voorkeur = wens.voorkeur_code ? ` (${wens.voorkeur_code})` : '';
    const opm = wens.opmerking ? ` — ${wens.opmerking}` : '';
    wensInfo = `<div class="form-info" style="margin-bottom: 1rem;">💬 Wens: <b>${typeLabel}${voorkeur}</b>${opm}</div>`;
  }

  document.getElementById('sheetTitle').textContent = `${label} · ${formatDatum(datum, 'kort')}`;
  document.getElementById('sheetSub').textContent = 'Tik 1 code (hele dag) of 2 codes (ochtend/middag)';

  const opmEsc = huidigOpm.replace(/</g, '&lt;').replace(/"/g, '&quot;');

  document.getElementById('sheetBody').innerHTML = `
    ${wensInfo}
    <div id="pickerSelectie" style="margin-bottom: 10px;"></div>
    <div class="picker-grid" id="pickerGrid"></div>
    <div style="display: flex; gap: 6px; margin-top: 8px; margin-bottom: 12px;">
      <button class="btn" style="flex: 1; font-size: 12px; padding: 8px;" onclick="window.pickerLeegmaken()">Leegmaken</button>
    </div>
    <textarea class="input" id="celOpm" rows="2" placeholder="Opmerking…" style="resize: vertical; font-size: 13px; width: 100%; margin-bottom: 10px;">${opmEsc}</textarea>
    <div style="display: flex; gap: 8px;">
      <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.pickerOpslaan()">Opslaan</button>
    </div>
  `;
  pickerHertekenen();
  openSheet();
};

// Hertekenen van de picker-grid en selectie-indicator op basis van _pickerCodes
function pickerHertekenen() {
  const gangbaar = ['W','B','E','M','D','O','S','A','R','V','Z','K'];
  const fs = gangbaar.map(c => functiesMap()[c]).filter(Boolean);
  const codes = _pickerCodes;
  const grid = document.getElementById('pickerGrid');
  const sel  = document.getElementById('pickerSelectie');
  if (!grid || !sel) return;

  // Selectie-indicator
  if (codes.length === 0) {
    sel.innerHTML = '<div class="muted" style="font-size: 12px; font-style: italic;">Geen code geselecteerd</div>';
  } else if (codes.length === 1) {
    sel.innerHTML = `<div style="font-size: 13px;"><b>Hele dag:</b> ${codes[0]} · ${functieNaam(codes[0])}</div>`;
  } else {
    sel.innerHTML = `<div style="font-size: 13px;"><b>Ochtend:</b> ${codes[0]} · ${functieNaam(codes[0])}<br><b>Middag:</b> ${codes[1]} · ${functieNaam(codes[1])}</div>`;
  }

  // Picker-knoppen
  const vol = codes.length >= 2;
  grid.innerHTML = fs.map(f => {
    const idx = codes.indexOf(f.code);
    const isGekozen = idx !== -1;
    const isUitgegrijsd = vol && !isGekozen;
    const positie = isGekozen ? (idx === 0 ? '①' : '②') : '';
    return `<div class="picker-option f-${f.code} ${isGekozen ? 'selected' : ''}"
              style="${isUitgegrijsd ? 'opacity:0.35; cursor:not-allowed;' : ''}"
              onclick="window.pickerToggle('${f.code}')">
              ${f.code}${positie ? ` <sup style="font-size:9px">${positie}</sup>` : ''}
              <div class="picker-label">${f.naam.split('/')[0]}</div>
            </div>`;
  }).join('');
}

// Toggle een code: aan/uit/negeer (als al 2 staan en deze niet gekozen).
window.pickerToggle = function(code) {
  const idx = _pickerCodes.indexOf(code);
  if (idx !== -1) {
    // Code zit er al → eruit halen
    _pickerCodes.splice(idx, 1);
  } else if (_pickerCodes.length < 2) {
    // Plek vrij → toevoegen
    _pickerCodes.push(code);
  } else {
    // Al 2 codes en dit is een nieuwe → negeer (optie 3)
    return;
  }
  pickerHertekenen();
};

window.pickerLeegmaken = function() {
  _pickerCodes = [];
  pickerHertekenen();
};

window.pickerOpslaan = async function() {
  const opm = (document.getElementById('celOpm')?.value || '').trim();
  const { datum, radId } = _pickerCtx;
  const codesArr = [..._pickerCodes];
  window.closeSheet();
  await slaToewijzingOp(datum, radId, codesArr, opm);
};

// Behouden voor compat (oude callsites die selecteerCode aanroepen)
window.selecteerCode = async function(datum, radId, code) {
  const opm = (document.getElementById('celOpm')?.value || '').trim();
  window.closeSheet();
  await slaToewijzingOp(datum, radId, code, opm);
};

window.slaCelOpmerkingAlleen = async function(datum, radId) {
  const opm = (document.getElementById('celOpm')?.value || '').trim();
  window.closeSheet();
  await slaCelOpmerkingOp(datum, radId, opm);
};

window.opmerkingBewerken = function(datum) {
  if (!magOpmerkingen()) return;
  const dag = state.indelingMap[datum];
  const huidig = dag?.opmerking || '';

  document.getElementById('sheetTitle').textContent = formatDatum(datum, 'lang');
  document.getElementById('sheetSub').textContent = 'Opmerking voor deze dag';
  document.getElementById('sheetBody').innerHTML = `
    <textarea class="input" id="opmInput" rows="4" style="font-family: inherit;">${huidig.replace(/</g, '&lt;')}</textarea>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.opslaanOpmerking('${datum}')">Opslaan</button>
    </div>
  `;
  openSheet();
};

window.opslaanOpmerking = async function(datum) {
  const nieuw = document.getElementById('opmInput').value.trim();
  window.closeSheet();
  await slaOpmerkingOp(datum, nieuw);
};
                                                                                                                                                                                                      