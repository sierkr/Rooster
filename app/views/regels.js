// Regels-view: validatieregels aan/uit, ernst, telcode-instellingen.
import { doc, setDoc, updateDoc, getDocs, deleteDoc, collection, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from '../firebase-init.js';
import { state } from '../state.js';
import { functiesMap, magGebruikersBeheren } from '../helpers.js';

export function renderRegView() {
  const container = document.getElementById('view-reg');
  if (!magGebruikersBeheren()) { container.innerHTML = '<div class="empty-state">Geen toegang</div>'; return; }

  const regels = state.validatieRegels;
  const groepen = {
    conflict:  regels.filter(r => r.type === 'conflict'),
    context:   regels.filter(r => r.type === 'context'),
    uniciteit: regels.filter(r => r.type === 'uniciteit'),
    limiet:    regels.filter(r => r.type === 'limiet'),
    wens:      regels.filter(r => r.type === 'wens'),
  };
  const groepLabels = {
    conflict:  'Conflicten',
    context:   'Context (weekend, feestdag)',
    uniciteit: 'Uniciteit',
    limiet:    'Limieten',
    wens:      'Wensen',
  };

  const bezettingRegels = regels.filter(r => r.type === 'bezetting');

  let html = `
    <div class="card">
      <p style="font-size: 17px; font-weight: 500; margin: 0;">Validatie-regels</p>
      <p class="muted" style="margin: 2px 0 0;">${regels.length - bezettingRegels.length} regels actief: ${regels.filter(r => r.actief !== false && r.type !== 'bezetting').length}</p>
      <p class="muted" style="margin: 8px 0 0; font-size: 12px;">Tik op de pillen om strengheid aan te passen, of de schakelaar om een regel uit/aan te zetten.</p>
      ${bezettingRegels.length > 0 ? `
        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,0.06); display: flex; justify-content: space-between; align-items: center;">
          <span class="muted" style="font-size: 12px;">${bezettingRegels.length} verouderde bezettingsregels (uit Excel)</span>
          <button class="btn" style="font-size: 12px; color: #501313;" onclick="window.verwijderBezettingRegels()">Verwijderen</button>
        </div>
      ` : ''}
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
  renderFunctiesEditor();
}

// ==== Functies-editor ========================================================

function renderFunctiesEditor() {
  const container = document.getElementById('view-reg');
  // Toon alleen hoofdfuncties — geen varianten (.WB, 5W, YYB1 etc.)
  const isHoofdFunctie = f => {
    const code = f.code || f.id || '';
    return !code.startsWith('.') &&
           !code.startsWith('YY') &&
           !/^\d/.test(code) &&
           code !== '-';
  };

  const functies = (state.functies || [])
    .filter(isHoofdFunctie)
    .sort((a, b) => (a.volgorde || 99) - (b.volgorde || 99));

  const editorHtml = `
    <div style="margin-top: 1.5rem;">
      <div style="font-size: 12px; font-weight: 500; color: #5f5e5a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Functies beheren</div>
      <div class="card" style="padding: 0; overflow: hidden;">
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; min-width: 480px;">
            <thead>
              <tr style="background: rgba(0,0,0,0.03); border-bottom: 1px solid rgba(0,0,0,0.08);">
                <th style="padding: 8px 10px; text-align: left; font-weight: 500; width: 60px;">Code</th>
                <th style="padding: 8px 10px; text-align: left; font-weight: 500;">Naam</th>
                <th style="padding: 8px 10px; text-align: center; font-weight: 500; width: 50px;">Kleur</th>
                <th style="padding: 8px 10px; text-align: center; font-weight: 500; width: 70px;">Werkvloer</th>
                <th style="padding: 8px 10px; text-align: center; font-weight: 500; width: 60px;">Volgorde</th>
                <th style="padding: 8px 10px; width: 40px;"></th>
              </tr>
            </thead>
            <tbody id="functiesEditorBody">
              ${functies.map(f => functiRij(f)).join('')}
              ${legeRij()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  container.innerHTML += editorHtml;
}

function functiRij(f) {
  const id = f.code || f.id || '';
  return `
    <tr style="border-bottom: 1px solid rgba(0,0,0,0.05);" id="functie-rij-${id}">
      <td style="padding: 6px 10px;">
        <input class="input" style="width: 50px; font-size: 12px; padding: 4px 6px; font-family: monospace;" value="${id}" id="fcode-${id}" onchange="window.functieCodeGewijzigd('${id}', this.value)" placeholder="Code">
      </td>
      <td style="padding: 6px 10px;">
        <input class="input" style="font-size: 12px; padding: 4px 6px; width: 100%;" value="${f.naam || ''}" id="fnaam-${id}" placeholder="Naam">
      </td>
      <td style="padding: 6px 10px; text-align: center;">
        <input type="color" style="width: 36px; height: 28px; border: none; border-radius: 6px; cursor: pointer; padding: 2px;" value="${f.kleur || '#cccccc'}" id="fkleur-${id}">
      </td>
      <td style="padding: 6px 10px; text-align: center;">
        <input type="checkbox" id="fwerkvloer-${id}" ${f.werkvloer ? 'checked' : ''} style="width: 16px; height: 16px;">
      </td>
      <td style="padding: 6px 10px; text-align: center;">
        <input class="input" type="number" style="width: 50px; font-size: 12px; padding: 4px 6px; text-align: center;" value="${f.volgorde || ''}" id="fvolgorde-${id}" placeholder="0">
      </td>
      <td style="padding: 6px 10px; text-align: center;">
        <button style="background: none; border: none; color: #888; cursor: pointer; font-size: 16px; padding: 2px 4px;" onclick="window.slaFunctieOp('${id}')" title="Opslaan">💾</button>
        <button style="background: none; border: none; color: #c44; cursor: pointer; font-size: 16px; padding: 2px 4px;" onclick="window.verwijderFunctie('${id}')" title="Verwijderen">🗑</button>
      </td>
    </tr>
  `;
}

function legeRij() {
  return `
    <tr style="border-top: 2px solid rgba(0,0,0,0.08); background: rgba(0,0,0,0.01);" id="functie-rij-nieuw">
      <td style="padding: 6px 10px;">
        <input class="input" style="width: 50px; font-size: 12px; padding: 4px 6px; font-family: monospace;" id="fcode-nieuw" placeholder="Code">
      </td>
      <td style="padding: 6px 10px;">
        <input class="input" style="font-size: 12px; padding: 4px 6px; width: 100%;" id="fnaam-nieuw" placeholder="Nieuwe functie…">
      </td>
      <td style="padding: 6px 10px; text-align: center;">
        <input type="color" style="width: 36px; height: 28px; border: none; border-radius: 6px; cursor: pointer; padding: 2px;" value="#cccccc" id="fkleur-nieuw">
      </td>
      <td style="padding: 6px 10px; text-align: center;">
        <input type="checkbox" id="fwerkvloer-nieuw" style="width: 16px; height: 16px;">
      </td>
      <td style="padding: 6px 10px; text-align: center;">
        <input class="input" type="number" style="width: 50px; font-size: 12px; padding: 4px 6px; text-align: center;" id="fvolgorde-nieuw" placeholder="0">
      </td>
      <td style="padding: 6px 10px; text-align: center;">
        <button style="background: none; border: none; color: #2c8; cursor: pointer; font-size: 16px; padding: 2px 4px;" onclick="window.slaFunctieOp('nieuw')" title="Toevoegen">➕</button>
      </td>
    </tr>
  `;
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

window.verwijderBezettingRegels = async function() {
  const bezetting = state.validatieRegels.filter(r => r.type === 'bezetting');
  if (!confirm(`${bezetting.length} bezettingsregels permanent verwijderen uit Firestore?`)) return;
  try {
    const batch = writeBatch(db);
    bezetting.forEach(r => batch.delete(doc(db, 'validatie_regels', r.id)));
    await batch.commit();
    alert(`${bezetting.length} bezettingsregels verwijderd.`);
  } catch (e) {
    alert('Mislukt: ' + e.message);
  }
};

window.slaFunctieOp = async function(id) {
  const code    = document.getElementById(`fcode-${id}`)?.value?.trim();
  const naam    = document.getElementById(`fnaam-${id}`)?.value?.trim();
  const kleur   = document.getElementById(`fkleur-${id}`)?.value || '#cccccc';
  const werkvloer = document.getElementById(`fwerkvloer-${id}`)?.checked || false;
  const volgorde = parseInt(document.getElementById(`fvolgorde-${id}`)?.value) || 0;

  if (!code) { alert('Code is verplicht.'); return; }
  if (!naam)  { alert('Naam is verplicht.'); return; }

  try {
    await setDoc(doc(db, 'functies', code), { code, naam, kleur, werkvloer, volgorde, actief: true }, { merge: true });
    if (id === 'nieuw') {
      // Wis nieuwe rij
      ['fcode','fnaam','fwerkvloer','fvolgorde'].forEach(f => {
        const el = document.getElementById(`${f}-nieuw`);
        if (el) el.type === 'checkbox' ? el.checked = false : el.value = '';
      });
      document.getElementById('fkleur-nieuw').value = '#cccccc';
    }
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
};

window.verwijderFunctie = async function(id) {
  if (!confirm(`Functie "${id}" verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
  try {
    await deleteDoc(doc(db, 'functies', id));
  } catch (e) {
    alert('Verwijderen mislukt: ' + e.message);
  }
};

window.functieCodeGewijzigd = function(oudCode, nieuwCode) {
  const bestaatAl = (state.functies || []).some(f => f.code === nieuwCode || f.id === nieuwCode);
  if (bestaatAl && nieuwCode !== oudCode) {
    alert(`Code "${nieuwCode}" bestaat al.`);
  }
};
