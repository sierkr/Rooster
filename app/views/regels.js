// Regels-view: validatieregels aan/uit, ernst, en functies-matrix.
import { doc, setDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from '../firebase-init.js';
import { state } from '../state.js';
import { esc, functiesMap, defaultFunctieFlags, magGebruikersBeheren, magRegelsBeheren, isHoofd, functieFlags } from '../helpers.js';


// Eenmalige migratie: corrigeer werkvloer-waarden die door oude code fout zijn opgeslagen.
// Draait één keer; daarna is de vlag gezet in Firestore en slaan we de functie over.
async function migrateerWerkvloer() {
  if (state.instellingen?.werkvloer_migratie_v1) return;
  const fixes = (state.functies || [])
    .filter(f => {
      const code = f.code || f.id;
      const def  = defaultFunctieFlags(code);
      // Alleen corrigeren als de standaard 'true' is maar Firestore 'false' bevat (oude bug)
      return def.werkvloer === true && f.werkvloer !== true;
    })
    .map(f => {
      const code = f.code || f.id;
      return setDoc(doc(db, 'functies', code), { werkvloer: true }, { merge: true });
    });
  fixes.push(setDoc(doc(db, 'instellingen', 'algemeen'), { werkvloer_migratie_v1: true }, { merge: true }));
  await Promise.all(fixes);
}

export function renderRegView() {
  const container = document.getElementById('view-reg');
  if (!container) return;
  if (!magGebruikersBeheren() && !magRegelsBeheren()) { container.innerHTML = '<div class="empty-state">Geen toegang</div>'; return; }
  migrateerWerkvloer().catch(console.error);

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

  const actieveRegels = regels.filter(r => r.type !== 'bezetting');
  const bezetting = regels.filter(r => r.type === 'bezetting');

  let html = `
    <div class="card">
      <p style="font-size: 17px; font-weight: 500; margin: 0;">Validatie-regels</p>
      <p class="muted" style="margin: 2px 0 0;">${actieveRegels.length} regels actief: ${actieveRegels.filter(r => r.actief !== false).length}</p>
      <p class="muted" style="margin: 8px 0 0; font-size: 12px;">Tik op de pillen om strengheid aan te passen, of de schakelaar om een regel uit/aan te zetten.</p>
      ${bezetting.length > 0 ? `
        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,0.06); display: flex; justify-content: space-between; align-items: center;">
          <span class="muted" style="font-size: 12px;">${bezetting.length} verouderde bezettingsregels</span>
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
              <div class="regel-titel">${esc(r.bericht || r.id)}</div>
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

  // ==== Functies-matrix ====================================================
  const telCodes = window.TELLEN_CODES   || ['B','E','M','D','O','S','W'];
  const mtsCodes = window.MTSDAGEN_CODES || ['W','B','E','M','D','O','S','A','Z','T','X'];

  const functies = (state.functies || [])
    .filter(isHoofd)
    .sort((a, b) => (a.volgorde || 99) - (b.volgorde || 99));

  html += `
    <div style="margin-top: 1.5rem;">
      <div style="font-size: 12px; font-weight: 500; color: #5f5e5a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Functies</div>
      <div class="card" style="padding: 0; overflow: hidden;">
        <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; min-width: 380px;">
            <thead>
              <tr style="background: rgba(0,0,0,0.03); border-bottom: 1px solid rgba(0,0,0,0.08);">
                <th style="padding: 8px; text-align: left; font-weight: 500; width: 48px;">Code</th>
                <th style="padding: 8px; text-align: left; font-weight: 500;">Naam</th>
                <th style="padding: 8px 4px; text-align: center; font-weight: 500; width: 36px;" title="Kleur">🎨</th>
                <th style="padding: 8px 4px; text-align: center; font-weight: 500; width: 46px; font-size: 10px; line-height: 1.3;">Dag-<br>teller</th>
                <th style="padding: 8px 4px; text-align: center; font-weight: 500; width: 46px; font-size: 10px; line-height: 1.3;">Maat-<br>schaps</th>
                <th style="padding: 8px 4px; text-align: center; font-weight: 500; width: 46px; font-size: 10px; line-height: 1.3;">Werk-<br>vloer</th>
                <th style="padding: 8px 4px; text-align: center; font-weight: 500; width: 46px; font-size: 10px; line-height: 1.3;">Ver-<br>plicht</th>
                <th style="padding: 8px 4px; text-align: center; font-weight: 500; width: 46px; font-size: 10px; line-height: 1.3;">Actief</th>
                <th style="padding: 8px 4px; width: 28px;"></th>
              </tr>
            </thead>
            <tbody>
              ${functies.map(f => {
                const id = f.code || f.id;
                return `<tr style="border-bottom: 1px solid rgba(0,0,0,0.05);">${rijCellen(f, id, telCodes, mtsCodes, false)}</tr>`;
              }).join('')}
              <tr id="nieuwe-rij" style="display: none; background: rgba(44,130,210,0.04); border-top: 2px dashed rgba(0,0,0,0.1);">
                ${rijCellen({ code:'', naam:'', kleur:'#cccccc', werkvloer:false, actief:true }, 'nieuw', [], [], true)}
              </tr>
            </tbody>
          </table>
        </div>
        <div style="padding: 8px 12px; border-top: 1px solid rgba(0,0,0,0.06); display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <button class="btn" style="font-size: 12px;" onclick="window.toonNieuweRij()">+ Nieuwe functie</button>
          <button class="btn btn-primary" onclick="window.opslaanAlleCheckboxes()">Opslaan</button>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

function rijCellen(f, id, telCodes, mtsCodes, isNieuw) {
  const code      = f.code || f.id || '';
  const naam      = f.naam || '';
  const kleur     = f.kleur || '#cccccc';
  const isTel     = telCodes.includes(code);
  const isMts     = mtsCodes.includes(code);
  const isWerk    = functieFlags(code).werkvloer;
  const isVerp    = f.verplicht === true;
  const isActief  = f.actief !== false;

  return `
    <td style="padding: 5px 8px;">
      <input class="input" style="width: 42px; font-size: 12px; padding: 3px 5px; font-family: monospace; font-weight: 600;"
        value="${code}" id="fcode-${id}" placeholder="Code">
    </td>
    <td style="padding: 5px 8px;">
      <input class="input" style="width: 120px; font-size: 12px; padding: 3px 5px;"
        value="${naam}" id="fnaam-${id}" placeholder="Naam">
    </td>
    <td style="padding: 5px 4px; text-align: center;">
      <input type="color" style="width: 28px; height: 22px; border: none; border-radius: 3px; cursor: pointer; padding: 1px;"
        value="${kleur}" id="fkleur-${id}">
    </td>
    <td style="padding: 5px 4px; text-align: center;">
      <input type="checkbox" id="ftel-${id}" ${isTel ? 'checked' : ''} style="width: 15px; height: 15px;">
    </td>
    <td style="padding: 5px 4px; text-align: center;">
      <input type="checkbox" id="fmts-${id}" ${isMts ? 'checked' : ''} style="width: 15px; height: 15px;">
    </td>
    <td style="padding: 5px 4px; text-align: center;">
      <input type="checkbox" id="fwerkvloer-${id}" ${isWerk ? 'checked' : ''} style="width: 15px; height: 15px;">
    </td>
    <td style="padding: 5px 4px; text-align: center;">
      <input type="checkbox" id="fverplicht-${id}" ${isVerp ? 'checked' : ''} style="width: 15px; height: 15px;">
    </td>
    <td style="padding: 5px 4px; text-align: center;">
      <input type="checkbox" id="factief-${id}" ${isActief ? 'checked' : ''} style="width: 15px; height: 15px;">
    </td>
    <td style="padding: 5px 4px; text-align: center;">
      ${isNieuw
        ? `<button style="background:none;border:none;font-size:14px;cursor:pointer;color:#2a8;padding:2px;" onclick="window.slaFunctieOp('nieuw')" title="Toevoegen">➕</button>`
        : `<button style="background:none;border:none;font-size:14px;cursor:pointer;color:#c44;padding:2px;" onclick="window.verwijderFunctie('${id}')" title="Verwijderen">🗑</button>`
      }
    </td>
  `;
}

// ==== Handlers ===============================================================

window.toonNieuweRij = function() {
  const rij = document.getElementById('nieuwe-rij');
  if (rij) rij.style.display = '';
  document.getElementById('fcode-nieuw')?.focus();
};

window.slaFunctieOp = async function(id) {
  const code     = document.getElementById(`fcode-${id}`)?.value?.trim();
  const naam     = document.getElementById(`fnaam-${id}`)?.value?.trim();
  const kleur    = document.getElementById(`fkleur-${id}`)?.value || '#cccccc';
  const werkvloer = document.getElementById(`fwerkvloer-${id}`)?.checked || false;
  const actief   = document.getElementById(`factief-${id}`)?.checked !== false;

  if (!code) { alert('Code is verplicht.'); return; }
  if (!naam)  { alert('Naam is verplicht.'); return; }

  const bestaatAl = (state.functies || []).some(f => (f.code || f.id) === code);
  if (bestaatAl && id === 'nieuw') { alert(`Code "${code}" bestaat al.`); return; }

  try {
    await setDoc(doc(db, 'functies', code), { code, naam, kleur, werkvloer, actief }, { merge: true });
    if (window.injecteerNieuweKleuren) window.injecteerNieuweKleuren([...( state.functies || []), { code, naam, kleur }]);
    if (id === 'nieuw') {
      document.getElementById('nieuwe-rij').style.display = 'none';
      document.getElementById('fcode-nieuw').value = '';
      document.getElementById('fnaam-nieuw').value = '';
      document.getElementById('fkleur-nieuw').value = '#cccccc';
    }
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
};

window.verwijderFunctie = async function(id) {
  if (!confirm(`Functie "${id}" verwijderen?`)) return;
  try {
    await deleteDoc(doc(db, 'functies', id));
  } catch (e) {
    alert('Verwijderen mislukt: ' + e.message);
  }
};

window.opslaanAlleCheckboxes = async function() {
  const functies = (state.functies || []).filter(isHoofd);
  const telCodes = [];
  const mtsCodes = [];

  try {
    await Promise.all(functies.map(async f => {
      const id        = f.code || f.id;
      const naam      = document.getElementById(`fnaam-${id}`)?.value?.trim() || f.naam;
      const kleur     = document.getElementById(`fkleur-${id}`)?.value || f.kleur;
      const werkvloer = document.getElementById(`fwerkvloer-${id}`)?.checked || false;
      const verplicht = document.getElementById(`fverplicht-${id}`)?.checked || false;
      const actief    = document.getElementById(`factief-${id}`)?.checked !== false;
      if (document.getElementById(`ftel-${id}`)?.checked) telCodes.push(id);
      if (document.getElementById(`fmts-${id}`)?.checked) mtsCodes.push(id);
      return setDoc(doc(db, 'functies', id), { naam, kleur, werkvloer, verplicht, actief }, { merge: true });
    }));
    await setDoc(doc(db, 'instellingen', 'algemeen'), { tellen_codes: telCodes, mtsdagen_codes: mtsCodes }, { merge: true });
    alert('Opgeslagen.');
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
};


window.verwijderBezettingRegels = async function() {
  const bezetting = state.validatieRegels.filter(r => r.type === 'bezetting');
  if (!confirm(`${bezetting.length} bezettingsregels permanent verwijderen?`)) return;
  try {
    await Promise.all(bezetting.map(r => deleteDoc(doc(db, 'validatie_regels', r.id))));
    alert(`${bezetting.length} bezettingsregels verwijderd.`);
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
