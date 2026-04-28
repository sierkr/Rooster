// Regels-view: validatieregels aan/uit, ernst, telcode-instellingen.
import { doc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from '../firebase-init.js';
import { state } from '../state.js';
import { functiesMap, magGebruikersBeheren } from '../helpers.js';

export function renderRegView() {
  const container = document.getElementById('view-reg');
  if (!magGebruikersBeheren()) { container.innerHTML = '<div class="empty-state">Geen toegang</div>'; return; }

  const regels = state.validatieRegels;
  const groepen = {
    bezetting: regels.filter(r => r.type === 'bezetting'),
    conflict:  regels.filter(r => r.type === 'conflict'),
    context:   regels.filter(r => r.type === 'context'),
    uniciteit: regels.filter(r => r.type === 'uniciteit'),
    limiet:    regels.filter(r => r.type === 'limiet'),
    wens:      regels.filter(r => r.type === 'wens'),
  };
  const groepLabels = {
    bezetting: 'Bezetting (uit Excel)',
    conflict:  'Conflicten',
    context:   'Context (weekend, feestdag)',
    uniciteit: 'Uniciteit',
    limiet:    'Limieten',
    wens:      'Wensen',
  };

  let html = `
    <div class="card">
      <p style="font-size: 17px; font-weight: 500; margin: 0;">Validatie-regels</p>
      <p class="muted" style="margin: 2px 0 0;">${regels.length} regels actief: ${regels.filter(r=>r.actief!==false).length}</p>
      <p class="muted" style="margin: 8px 0 0; font-size: 12px;">Tik op de pillen om strengheid aan te passen, of de schakelaar om een regel uit/aan te zetten.</p>
    </div>
  `;

  Object.entries(groepen).forEach(([type, items]) => {
    if (items.length === 0) return;
    html += `<div style="margin-top: 1rem;"><div style="font-size: 12px; font-weight: 500; color: #5f5e5a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">${groepLabels[type]}</div>`;
    items.forEach(r => {
      const actief = r.actief !== false;
      const ernst = r.ernst || 'waarschuwing';
      html += `
        <div class="regel-item" style="${actief ? '' : 'opacity: 0.5;'}">
          <div class="regel-hoofd">
            <div style="flex: 1; min-width: 0;">
              <div class="regel-titel">${r.bericht || r.id}</div>
              <div class="regel-meta">${r.id}</div>
            </div>
            <div class="toggle-switch ${actief ? 'aan' : ''}" onclick="window.regelToggle('${r.id}')"></div>
          </div>
          <div style="display: flex; gap: 6px; margin-top: 8px;">
            <span class="ernst-pil ernst-warn ${ernst==='waarschuwing'?'actief':''}" onclick="window.regelErnst('${r.id}', 'waarschuwing')">⚠ Waarschuwing</span>
            <span class="ernst-pil ernst-error ${ernst==='blokkeren'?'actief':''}" onclick="window.regelErnst('${r.id}', 'blokkeren')">⛔ Blokkeren</span>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  });

  // Sectie: telt mee voor dagteller
  const alleCodes = ['W','B','E','M','D','O','S','A','R','V','Z','K','T','X'];
  const huidigeCodes = window.TELLEN_CODES || ['B','E','M','D','O','S','W'];
  html += `
    <div style="margin-top: 1.5rem;">
      <div style="font-size: 12px; font-weight: 500; color: #5f5e5a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Telt mee voor dagteller</div>
      <div class="card">
        <p class="muted" style="margin: 0 0 10px;">Welke functies tellen mee voor de teller-kolom in het beheer-raster (zichtbaar als W-slots aanstaan).</p>
        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
          ${alleCodes.map(c => {
            const aan = huidigeCodes.includes(c);
            const f = functiesMap()[c];
            const naam = f ? f.naam.split('/')[0] : c;
            return `<label style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px; background: ${aan ? '#e1f5ee' : 'rgba(0,0,0,0.04)'}; cursor: pointer; font-size: 13px;">
              <input type="checkbox" id="tel_${c}" ${aan ? 'checked' : ''}>
              <span><b>${c}</b> ${naam}</span>
            </label>`;
          }).join('')}
        </div>
        <button class="btn btn-primary" style="width: 100%; margin-top: 12px;" onclick="window.opslaanTellenCodes()">Opslaan</button>
      </div>
    </div>
  `;

  // Sectie: telt mee voor Maatschapsdagen
  const mtsHuidig = window.MTSDAGEN_CODES || ['W','B','E','M','D','O','S','A','Z','T','X'];
  html += `
    <div style="margin-top: 1.5rem;">
      <div style="font-size: 12px; font-weight: 500; color: #5f5e5a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Telt mee voor maatschapsdagen</div>
      <div class="card">
        <p class="muted" style="margin: 0 0 10px;">Welke hoofdfuncties meegeteld worden in de Maatschapsdagen-rij in de Activiteit-tab. Varianten van een hoofdletter (bv. .WB, 5W) tellen automatisch mee als de hoofdletter aan staat.</p>
        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
          ${alleCodes.map(c => {
            const aan = mtsHuidig.includes(c);
            const f = functiesMap()[c];
            const naam = f ? f.naam.split('/')[0] : c;
            return `<label style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px; background: ${aan ? '#e1f5ee' : 'rgba(0,0,0,0.04)'}; cursor: pointer; font-size: 13px;">
              <input type="checkbox" id="mts_${c}" ${aan ? 'checked' : ''}>
              <span><b>${c}</b> ${naam}</span>
            </label>`;
          }).join('')}
        </div>
        <button class="btn btn-primary" style="width: 100%; margin-top: 12px;" onclick="window.opslaanMtsdagenCodes()">Opslaan</button>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// ==== Handlers ===============================================================

window.opslaanTellenCodes = async function() {
  const codes = ['W','B','E','M','D','O','S','A','R','V','Z','K','T','X'].filter(c =>
    document.getElementById('tel_' + c)?.checked
  );
  try {
    await setDoc(doc(db, 'instellingen', 'algemeen'), { tellen_codes: codes }, { merge: true });
    alert('Opgeslagen.');
  } catch (e) {
    alert('Mislukt: ' + e.message);
  }
};

window.opslaanMtsdagenCodes = async function() {
  const codes = ['W','B','E','M','D','O','S','A','R','V','Z','K','T','X'].filter(c =>
    document.getElementById('mts_' + c)?.checked
  );
  try {
    await setDoc(doc(db, 'instellingen', 'algemeen'), { mtsdagen_codes: codes }, { merge: true });
    alert('Maatschapsdagen-codes opgeslagen.');
  } catch (e) {
    alert('Mislukt: ' + e.message);
  }
};

window.regelToggle = async function(regelId) {
  const r = state.validatieRegels.find(x => x.id === regelId);
  if (!r) return;
  try {
    await updateDoc(doc(db, 'validatie_regels', regelId), { actief: r.actief === false });
  } catch (e) {
    alert('Kan regel niet wijzigen: ' + e.message);
  }
};

window.regelErnst = async function(regelId, nieuwErnst) {
  try {
    await updateDoc(doc(db, 'validatie_regels', regelId), { ernst: nieuwErnst });
  } catch (e) {
    alert('Kan regel niet wijzigen: ' + e.message);
  }
};
