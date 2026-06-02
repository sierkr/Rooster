// Jaaroverzicht-view: compact weekraster per radioloog voor het hele jaar.
// Per week een kolom, per dag (ma-zo) een rij. Elke cel toont de functiecode
// met bijbehorende kleur. Klikbaar naar beheer-overzicht.
import { state, VASTE_RAD_IDS } from '../state.js';
import {
  vasteRads, radiologenMap, vandaagIso, huidigKalenderJaar,
  fclass, magWijzigen, plusDagen, isoWeekVan,
} from '../helpers.js';

const DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

// Geef alle maandag-datums van het jaar terug (ISO strings). UTC-veilig.
function maandagsVanJaar(jaar) {
  const result = [];
  const d = new Date(Date.UTC(jaar, 0, 1));
  // Ga naar eerste maandag van het jaar (UTC-day 1 = maandag, 0 = zondag).
  const dagNr = d.getUTCDay() || 7; // 1=ma..7=zo
  if (dagNr !== 1) d.setUTCDate(d.getUTCDate() + (8 - dagNr));
  while (d.getUTCFullYear() <= jaar) {
    result.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return result;
}

// Geef datum-string voor dag offset vanaf maandag (0=ma, 6=zo).
function dagVanWeek(maandag, offset) {
  return plusDagen(maandag, offset);
}

// Maandlabel: geef maandnaam terug van de gegeven datum.
function maandLabel(maandag) {
  const [j, m, d] = maandag.split('-').map(Number);
  const dt = new Date(Date.UTC(j, m - 1, d));
  return dt.toLocaleDateString('nl-NL', { month: 'short', timeZone: 'UTC' });
}

// ISO weeknummer (UTC-veilig via gedeelde helper).
function isoWeek(maandag) {
  return isoWeekVan(maandag);
}

export function renderJaaView() {
  const container = document.getElementById('view-jaa');
  const rads = vasteRads().filter(r => r.achternaam);
  if (rads.length === 0) { container.innerHTML = '<div class="empty-state">Laden…</div>'; return; }

  const eigenRadId = state.profiel?.radioloog_id;
  const isBeheer = magWijzigen();
  const zichtbareRads = isBeheer ? rads : rads.filter(r => r.id === eigenRadId);

  // Huidige geselecteerde radioloog
  if (!state.jaaRadId || !zichtbareRads.find(r => r.id === state.jaaRadId)) {
    state.jaaRadId = eigenRadId || zichtbareRads[0]?.id;
  }
  const rad = radiologenMap()[state.jaaRadId] || zichtbareRads[0];
  if (!rad) { container.innerHTML = '<div class="empty-state">Geen radioloog gevonden.</div>'; return; }

  const jaar = huidigKalenderJaar();
  const weken = maandagsVanJaar(jaar);
  const vandaag = vandaagIso();

  // Maand-headers: groepeer weken per maand
  let maandHeaders = '';
  let huidigeMaand = '';
  let maandSpan = 0;
  let maandGroepen = [];
  weken.forEach(ma => {
    const m = maandLabel(ma);
    if (m !== huidigeMaand) {
      if (huidigeMaand) maandGroepen.push({ label: huidigeMaand, span: maandSpan });
      huidigeMaand = m;
      maandSpan = 1;
    } else {
      maandSpan++;
    }
  });
  if (huidigeMaand) maandGroepen.push({ label: huidigeMaand, span: maandSpan });

  const radSelector = isBeheer
    ? `<select class="select" style="font-size: 14px; padding: 4px 8px;" onchange="window.jaaZetRad(this.value)">
        ${zichtbareRads.map(r => `<option value="${r.id}" ${r.id === rad.id ? 'selected' : ''}>${r.achternaam}</option>`).join('')}
       </select>`
    : `<span style="font-weight: 500;">${rad.achternaam}</span>`;

  // Grid: 1 kolom label + weken kolommen
  const aantalWeken = weken.length;
  const celBreedte = 22; // px per week

  let html = `
    <div class="card" style="margin-bottom: 10px;">
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <span style="font-size: 17px; font-weight: 500;">Jaaroverzicht ${jaar}</span>
        ${radSelector}
      </div>
    </div>
    <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
      <div style="min-width: ${40 + aantalWeken * celBreedte}px; font-size: 10px;">

        <!-- Maand-headers -->
        <div style="display: flex; margin-left: 28px; margin-bottom: 1px;">
          ${maandGroepen.map(g => `
            <div style="width: ${g.span * celBreedte}px; font-size: 9px; font-weight: 600; color: #5f5e5a; text-transform: uppercase; overflow: hidden; white-space: nowrap; padding-left: 2px;">${g.label}</div>
          `).join('')}
        </div>

        <!-- Week-nummers -->
        <div style="display: flex; margin-left: 28px; margin-bottom: 2px;">
          ${weken.map(ma => {
            const wk = isoWeek(ma);
            const toonWk = wk % 2 === 0 || aantalWeken < 30;
            return `<div style="width: ${celBreedte}px; text-align: center; font-size: 8px; color: #aaa;">${toonWk ? wk : ''}</div>`;
          }).join('')}
        </div>

        <!-- Dag-rijen -->
        ${DAGEN.map((dag, dagIdx) => {
          const isWeekend = dagIdx >= 5;
          return `
            <div style="display: flex; align-items: center; margin-bottom: 1px;">
              <div style="width: 26px; font-size: 9px; color: #888; flex-shrink: 0;">${dag}</div>
              ${weken.map(ma => {
                const datum = dagVanWeek(ma, dagIdx);
                if (datum.slice(0, 4) !== String(jaar)) {
                  return `<div style="width: ${celBreedte}px;"></div>`;
                }
                const dagData = state.indelingMap[datum];
                const codes = dagData?.toewijzingen?.[rad.id] || [];
                const code = codes[0] || '';
                const isVandaag = datum === vandaag;
                const bgClass = code ? fclass(code) : '';
                const weekendStyle = isWeekend && !code ? 'background: rgba(0,0,0,0.03);' : '';
                const vandaagStyle = isVandaag ? 'outline: 2px solid #2c5282; outline-offset: -1px;' : '';
                const clickAttr = magWijzigen() && datum
                  ? `onclick="window.springNaarBeheer('${datum}')" style="cursor:pointer; ${weekendStyle} ${vandaagStyle}"`
                  : `style="${weekendStyle} ${vandaagStyle}"`;
                return `
                  <div class="jaa-cel ${bgClass}" ${clickAttr} title="${datum}${code ? ' · ' + code : ''}">
                    ${code ? `<span style="font-size: 8px; font-weight: 600; line-height: 1;">${code.length > 2 ? code.slice(0,2) : code}</span>` : ''}
                  </div>`;
              }).join('')}
            </div>
          `;
        }).join('')}

      </div>
    </div>

    <div class="legend" style="margin-top: 10px;">
      <div style="font-size: 11px; color: #5f5e5a;">
        Tik een dag om naar het beheer-overzicht te gaan. Cel toont eerste functiecode van die dag.
      </div>
    </div>
  `;

  container.innerHTML = html;
}

window.jaaZetRad = function(id) {
  state.jaaRadId = id;
  renderJaaView();
};
