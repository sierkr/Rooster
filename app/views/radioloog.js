// Radioloog-view: per maat een week-overzicht met dag-cards.
import { state } from '../state.js';
import {
  vasteRads, radiologenMap, vandaagIso, isoWeekVan, datumsVanWeek,
  weekRange, formatDatum, fclass, functieNaam, toewijzingVoor, magOpmerkingen,
} from '../helpers.js';
import { openSheet } from '../sheets.js';

export function renderRadView() {
  const container = document.getElementById('view-rad');
  const rads = vasteRads();
  if (rads.length === 0) { container.innerHTML = '<div class="empty-state">Nog geen radiologen geladen…</div>'; return; }
  const rad = radiologenMap()[state.huidigeRadId] || rads[0];
  const wkMa = state.weekMaandag;
  const datums = datumsVanWeek(wkMa);
  const vandaag = vandaagIso();
  const wkNr = isoWeekVan(wkMa);

  let html = `
    <div class="card">
      <div class="row">
        <div class="avatar">${rad.code}</div>
        <div style="flex: 1; min-width: 0;">
          <select class="select" style="font-weight: 500; font-size: 15px; padding: 4px 8px;" onchange="window.zetRadId(this.value)">
            ${rads.map(r => `<option value="${r.id}" ${r.id===rad.id?'selected':''}>${r.achternaam}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; gap: 8px;">
        <button class="nav-btn" onclick="window.navigeerWeek(-1)">‹</button>
        <div class="wk-datum-wrap" style="flex: 1; text-align: center;" title="Kies een datum">
          <div style="font-size: 14px; font-weight: 500; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px;">Week ${wkNr}</div>
          <div class="muted">${weekRange(wkMa)}</div>
          <input type="date" class="wk-datum-input" value="${wkMa}" onchange="window.weekKiezerWissel(this)">
        </div>
        <button class="nav-btn" onclick="window.navigeerWeek(1)">›</button>
        <button class="nav-btn today" onclick="window.naarVandaag()">Nu</button>
      </div>
    </div>
  `;

  datums.forEach(datum => {
    const codes = toewijzingVoor(datum, rad.id);
    const dag = state.indelingMap[datum];
    const isVandaag = datum === vandaag;
    const d = new Date(datum + 'T00:00:00');
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const dagLang = formatDatum(datum, 'lang');

    const badges = codes.length === 0
      ? (weekend ? `<span class="badge f-V">Vrij</span>` : '')
      : codes.map(c => `<span class="badge ${fclass(c)}">${c} · ${functieNaam(c)}</span>`).join('');

    const opmKort = dag?.opmerking ? (dag.opmerking.length > 30 ? dag.opmerking.slice(0, 28) + '…' : dag.opmerking) : '';

    html += `
      <div class="card card-compact ${isVandaag ? 'day-card-today' : ''} ${weekend && codes.length===0 ? 'day-card-weekend' : ''}" onclick="window.toonDagDetail('${datum}', '${rad.id}')">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span class="muted" ${isVandaag?'style="color:#185fa5;font-weight:500;"':''}>${dagLang}${isVandaag ? ' · vandaag' : ''}</span>
          ${opmKort ? `<span style="font-size: 11px; color: #888; font-style: italic; max-width: 50%; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${opmKort}</span>` : ''}
        </div>
        <div class="badges">${badges || '<span class="muted">—</span>'}</div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// View-specifieke handlers (gebonden aan window voor inline onclick="")
window.zetRadId = function(id) { state.huidigeRadId = id; renderRadView(); };

window.toonDagDetail = function(datum, radId) {
  const rad = radiologenMap()[radId];
  const dag = state.indelingMap[datum];
  const codes = toewijzingVoor(datum, radId);

  document.getElementById('sheetTitle').textContent = formatDatum(datum, 'lang');
  document.getElementById('sheetSub').textContent = `${rad.code} · ${rad.achternaam}`;

  let body = `<div style="padding: 0 0 1rem;">`;
  if (codes.length > 0) {
    body += `<div style="margin-bottom: 12px;"><span class="muted">Functie</span><br>`;
    codes.forEach(c => { body += `<span class="badge ${fclass(c)}" style="margin-top: 4px;">${c} · ${functieNaam(c)}</span>`; });
    body += `</div>`;
  }
  if (dag?.bespreking)  body += `<div style="margin-bottom: 10px;"><span class="muted">Bespreking</span><br>${dag.bespreking}</div>`;
  if (dag?.interventie) body += `<div style="margin-bottom: 10px;"><span class="muted">Interventie</span><br>${dag.interventie}</div>`;
  const celOpm = dag?.cel_opmerkingen?.[radId];
  if (celOpm)           body += `<div style="margin-bottom: 10px;"><span class="muted">Mijn opmerking</span><br>${celOpm}</div>`;
  if (dag?.opmerking)   body += `<div style="margin-bottom: 10px;"><span class="muted">Dag-opmerking</span><br>${dag.opmerking}</div>`;
  body += `</div>`;

  if (magOpmerkingen()) {
    body += `<button class="btn" style="width: 100%;" onclick="window.opmerkingBewerken('${datum}')">Opmerking bewerken</button>`;
  }

  document.getElementById('sheetBody').innerHTML = body;
  openSheet();
};
