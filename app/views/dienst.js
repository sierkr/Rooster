// Dienst-view: 14-dagen overzicht van wie dienst heeft + DECT-tabel.
import { state } from '../state.js';
import {
  vasteRads, radiologenMap, vandaagIso, isoWeekVan, datumsVanWeek,
  weekRange, plusDagen, formatDatum, magWijzigen,
} from '../helpers.js';
import { openSheet, closeSheet } from '../sheets.js';
import { slaDienstOp } from '../save.js';

export function renderDieView() {
  const container = document.getElementById('view-die');
  const rads = vasteRads();
  if (rads.length === 0) { container.innerHTML = '<div class="empty-state">Laden…</div>'; return; }

  const radsMap = radiologenMap();
  const vandaag = vandaagIso();

  const wkMa1 = state.weekMaandag;
  const wkMa2 = plusDagen(wkMa1, 7);
  const datums = [...datumsVanWeek(wkMa1), ...datumsVanWeek(wkMa2)].slice(0, 14);
  const wkNr1 = isoWeekVan(wkMa1);
  const wkNr2 = isoWeekVan(wkMa2);

  const dectSpeciaal = window.DECT_SPECIAAL || { spoed_echo: '7862', weekradioloog: '7744' };

  let html = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
        <button class="nav-btn" onclick="window.navigeerWeek(-1)">‹</button>
        <div class="wk-datum-wrap" style="flex: 1; text-align: center;" title="Kies een datum">
          <div style="font-size: 15px; font-weight: 500; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px;">Diensten week ${wkNr1} – ${wkNr2}</div>
          <div class="muted">${weekRange(wkMa1)} · ${weekRange(wkMa2)}</div>
          <input type="date" class="wk-datum-input" value="${wkMa1}" onchange="window.weekKiezerWissel(this)">
        </div>
        <button class="nav-btn" onclick="window.navigeerWeek(1)">›</button>
        <button class="nav-btn today" onclick="window.naarVandaag()">Nu</button>
      </div>
    </div>
  `;

  datums.forEach(datum => {
    const dag = state.indelingMap[datum];
    const isVandaag = datum === vandaag;
    const d = new Date(datum + 'T00:00:00');
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    const dienstRadId = dag?.dienst?.dag;
    const dienstRad = dienstRadId ? radsMap[dienstRadId] : null;
    const interventie = dag?.interventie;

    const datumKort = formatDatum(datum, 'kort');
    const klasse = ['dienst-dag'];
    if (isVandaag) klasse.push('dienst-dag-vandaag');
    if (isWeekend) klasse.push('dienst-dag-weekend');

    html += `
      <div class="${klasse.join(' ')}" ${magWijzigen() ? `onclick="window.openDienstSheet('${datum}')"` : ''}>
        <div class="dienst-rij">
          <div class="dienst-datum">${datumKort}${isVandaag ? ' · nu' : ''}</div>
          <div class="dienst-rad">
            ${dienstRad ? `${dienstRad.code} · ${dienstRad.achternaam}` : '<span class="muted">— geen dienst —</span>'}
          </div>
          ${dienstRad?.dect ? `<a class="dienst-dect-btn" href="tel:${dienstRad.dect}" onclick="event.stopPropagation();">📞 ${dienstRad.dect}</a>` : ''}
        </div>
        ${interventie ? `<div class="dienst-meta">Interventie: ${interventie}</div>` : ''}
      </div>
    `;
  });

  html += `
    <div style="margin-top: 1.5rem;">
      <div class="summary-label" style="margin-bottom: 8px;">DECT-nummers</div>
      <div class="dect-tabel">
        <div class="dect-rij dect-rij-prom">
          <div class="dect-naam dect-naam-prom">Spoed / Echo</div>
          <a class="dect-num" href="tel:${dectSpeciaal.spoed_echo}">${dectSpeciaal.spoed_echo}</a>
        </div>
        <div class="dect-rij dect-rij-prom">
          <div class="dect-naam dect-naam-prom">Weekradioloog</div>
          <a class="dect-num" href="tel:${dectSpeciaal.weekradioloog}">${dectSpeciaal.weekradioloog}</a>
        </div>
        ${[...rads].sort((a,b) => a.achternaam.localeCompare(b.achternaam)).map(r => `
          <div class="dect-rij">
            <div class="dect-naam">${r.code} · ${r.achternaam}</div>
            ${r.dect ? `<a class="dect-num" href="tel:${r.dect}">${r.dect}</a>` : '<span class="muted" style="font-size: 12px;">—</span>'}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

window.openDienstSheet = function(datum) {
  if (!magWijzigen()) return;
  const rads = vasteRads();
  const dag = state.indelingMap[datum];
  const huidigDienstId = dag?.dienst?.dag || '';

  document.getElementById('sheetTitle').textContent = `Dienst ${formatDatum(datum, 'lang')}`;
  document.getElementById('sheetSub').textContent = 'Wie heeft dienst?';
  document.getElementById('sheetBody').innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 1rem; max-height: 60vh; overflow-y: auto;">
      <div class="picker-option" style="grid-column: span 2;" onclick="window.zetDienst('${datum}', '')">— geen dienst —</div>
      ${rads.map(r => `
        <div class="picker-option ${r.id === huidigDienstId ? 'selected' : ''}" style="text-align: left; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;" onclick="window.zetDienst('${datum}', '${r.id}')">
          <div>
            <div style="font-weight: 500;">${r.code} · ${r.achternaam}</div>
            ${r.dect ? `<div class="muted" style="font-size: 11px;">DECT ${r.dect}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
    <button class="btn" style="width: 100%;" onclick="window.closeSheet()">Annuleren</button>
  `;
  openSheet();
};

window.zetDienst = async function(datum, radId) {
  closeSheet();
  await slaDienstOp(datum, radId);
};
