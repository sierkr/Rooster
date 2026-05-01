// Gebruikers-view: gebruikers beheren, parttime, waarnemers, Excel-import.
import { collection, doc, getDocs, setDoc, updateDoc, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, fnGebruikerAanmaken, fnGebruikerVerwijderen, fnGebruikerResetWachtwoord } from '../firebase-init.js';
import { state, SLOTS, VASTE_RAD_IDS, VASTE_BEHEERDER_EMAIL } from '../state.js';
import {
  vasteRads, radiologenMap, parttimeFactor, defaultPermissies,
  magGebruikersBeheren, genereerWachtwoord, bezettingOpDatum, vandaagIso, plusDagen, formatDatum,
} from '../helpers.js';
import { STANDAARD_WACHTWOORD } from '../helpers.js';
import { openSheet, closeSheet } from '../sheets.js';
import { IMPORT_SHEET, actImportFile, actImportSchrijven, actImportAnnuleren, actZetImportJaar } from '../import.js';

export async function laadGebruikers() {
  if (!magGebruikersBeheren()) return;
  const snap = await getDocs(collection(db, 'gebruikers'));
  state.gebruikers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function renderGebView() {
  const container = document.getElementById('view-geb');
  if (!magGebruikersBeheren()) { container.innerHTML = '<div class="empty-state">Geen toegang</div>'; return; }

  await laadGebruikers();
  const rads = radiologenMap();

  let html = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <p style="font-size: 17px; font-weight: 500; margin: 0;">Gebruikers</p>
          <p class="muted" style="margin: 2px 0 0;">${state.gebruikers.length} gebruiker${state.gebruikers.length===1?'':'s'}</p>
        </div>
        <button class="btn btn-primary" onclick="window.nieuweGebruiker()">+ Nieuw</button>
      </div>
    </div>
  `;

  state.gebruikers.forEach(g => {
    const rad = g.radioloog_id ? rads[g.radioloog_id] : null;
    html += `
      <div class="gebruiker-item">
        <div class="gebruiker-hoofd">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 500; overflow: hidden; text-overflow: ellipsis;">${g.email}</div>
            ${rad ? `<div class="muted">${rad.code} · ${rad.achternaam}</div>` : ''}
          </div>
          <span class="rol-badge rol-${g.rol}">${g.rol}</span>
        </div>
        <div style="margin-top: 10px; display: flex; gap: 6px;">
          <button class="btn" style="flex: 1; font-size: 12px; padding: 6px;" onclick="window.gebruikerBewerken('${g.id}')">Rol wijzigen</button>
          <button class="btn" style="font-size: 12px; padding: 6px 10px;" onclick="window.gebruikerWachtwoordReset('${g.id}', '${g.email}')">🔑</button>
          ${(g.id !== state.user.uid && (g.email||'').toLowerCase() !== VASTE_BEHEERDER_EMAIL) ? `<button class="btn" style="font-size: 12px; padding: 6px 10px; color: #501313;" onclick="window.gebruikerVerwijderen('${g.id}', '${g.email}')">🗑</button>` : ''}
        </div>
      </div>
    `;
  });

  // Vaste radiologen — parttime-percentage en vakantierecht
  html += `
    <div style="margin-top: 1.5rem;">
      <div class="summary-label" style="margin-bottom: 6px;">Vaste radiologen — parttime &amp; vakantierecht</div>
      <div class="card">
        <p class="muted" style="margin: 0 0 10px;">Parttime: percentage van fulltime (default 100%). Vakantierecht: aantal V-dagen per jaar (default 40). Tik <b>Wissel</b> om een persoon op de stoel te wisselen vanaf een datum.</p>
        <div style="display: grid; grid-template-columns: 50px 1fr 56px 56px 70px; gap: 6px; padding-bottom: 6px; border-bottom: 1px solid rgba(0,0,0,0.1); font-size: 11px; font-weight: 600; color: #5f5e5a;">
          <div>Code</div>
          <div>Naam</div>
          <div style="text-align: center;">Parttime</div>
          <div style="text-align: center;">Vakantie</div>
          <div></div>
        </div>
        ${vasteRads().map(r => {
          const pf = parttimeFactor(r.id);
          const pct = Math.round(pf * 100);
          const vrecht = (typeof r.vakantierecht === 'number') ? r.vakantierecht : 40;
          const stoel = state.radiologen.find(x => x.id === r.id);
          const hist = Array.isArray(stoel?.bezetting_historie) ? stoel.bezetting_historie : [];
          const open = hist.find(e => !e.tot);
          const sinds = open?.van ? `vast sinds ${formatDatum(open.van, 'kort')}` : '';
          return `
            <div style="display: grid; grid-template-columns: 50px 1fr 56px 56px 70px; gap: 6px; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.06);">
              <div style="font-weight: 500;">${r.code}</div>
              <div style="min-width: 0;">
                <div class="muted" style="font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${r.achternaam || ''}</div>
                ${sinds ? `<div class="muted" style="font-size: 10px;">${sinds}</div>` : ''}
              </div>
              <div style="display: flex; align-items: center; gap: 2px;">
                <input type="number" class="input" id="pf_${r.id}" value="${pct}" min="10" max="100" step="1" style="padding: 6px 4px; font-size: 13px; text-align: right;">
                <span class="muted" style="font-size: 11px;">%</span>
              </div>
              <div>
                <input type="number" class="input" id="vr_${r.id}" value="${vrecht}" min="0" max="100" step="1" style="padding: 6px 4px; font-size: 13px; text-align: right; width: 100%;">
              </div>
              <button class="btn" style="font-size: 11px; padding: 6px 4px;" onclick="window.openWisselSheet('${r.id}')">Wissel</button>
            </div>
          `;
        }).join('')}
        <button class="btn btn-primary" style="width: 100%; margin-top: 10px;" onclick="window.opslaanParttime()">Opslaan</button>
      </div>
    </div>
  `;

  // Waarnemers-sectie
  html += `
    <div style="margin-top: 1.5rem;">
      <div class="summary-label" style="margin-bottom: 6px;">Waarnemers (W-slots)</div>
      <div class="card">
        <p class="muted" style="margin: 0 0 10px;">Alleen "actief" waarnemers verschijnen in het beheer-raster en in tellingen. <b>Wissel</b> om persoon op deze W-stoel te wisselen vanaf datum. <b>→ Vast</b> om een waarnemer per datum vast te maken in een vaste-stoel.</p>
        ${SLOTS.map(slotId => {
          const slot = state.radiologen.find(r => r.id === slotId) || { id: slotId, code: '', achternaam: '', actief: false };
          const isActief = slot.actief !== false;
          const isLeeg = !slot.code || slot.actief === false;
          return `
            <div style="display: grid; grid-template-columns: 32px 1fr 1fr 38px 60px 60px; gap: 6px; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.06);">
              <div style="font-weight: 500; color: #5f5e5a;">${slotId}</div>
              <input type="text" class="input" id="inv_code_${slotId}" placeholder="Code" maxlength="4" value="${(slot.code||'').replace(/"/g,'&quot;')}" style="padding: 6px 8px; font-size: 13px;">
              <input type="text" class="input" id="inv_naam_${slotId}" placeholder="Achternaam" value="${(slot.achternaam||'').replace(/"/g,'&quot;')}" style="padding: 6px 8px; font-size: 13px;">
              <span class="toggle-switch ${isActief ? 'aan' : ''}" id="inv_act_${slotId}" onclick="this.classList.toggle('aan')"></span>
              <button class="btn" style="font-size: 11px; padding: 6px 4px;" onclick="window.openWisselSheet('${slotId}')">Wissel</button>
              <button class="btn" style="font-size: 11px; padding: 6px 4px; ${isLeeg ? 'opacity:0.4; cursor:not-allowed;' : ''}" ${isLeeg ? 'disabled' : ''} onclick="window.openMaakVastSheet('${slotId}')" title="Maak vast in een vaste-stoel">→ Vast</button>
            </div>
          `;
        }).join('')}
        <button class="btn btn-primary" style="width: 100%; margin-top: 10px;" onclick="window.opslaanInvallers()">Waarnemers opslaan</button>
      </div>
    </div>
  `;

  // Excel-import sectie
  const p = state.importPreview;
  const bezig = state.importBezig;
  html += `
    <div style="margin-top: 1.5rem;">
      <div class="summary-label" style="margin-bottom: 6px;">Excel-import</div>
      <div class="card">
        <p class="muted" style="margin: 0 0 10px;">Lees een <code>.xlsm</code>/<code>.xlsx</code>-bestand en zet de inhoud van het sheet '${IMPORT_SHEET}' over naar Firestore. <b>Excel = waarheid</b> — bestaande dagen in Firestore worden vervangen.</p>
        ${!p ? `
          <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
            <label class="muted" style="font-size: 12px;">Filter jaar:</label>
            <select class="select" id="impJaar" onchange="window.actZetImportJaar(this.value)" style="width: auto; padding: 6px 8px; font-size: 13px;">
              <option value="" ${!state.importJaar?'selected':''}>(alle jaren)</option>
              ${[2024,2025,2026,2027,2028,2029,2030].map(j => `<option value="${j}" ${state.importJaar==String(j)?'selected':''}>${j}</option>`).join('')}
            </select>
          </div>
          <input type="file" accept=".xlsx,.xlsm,.xls" id="impFile" onchange="window.actImportFile(this)" ${bezig?'disabled':''} style="font-size: 13px;">
          ${bezig ? '<div style="margin-top: 10px; display: flex; align-items: center; gap: 8px;"><span class="loader"></span><span class="muted">Bezig met inlezen…</span></div>' : ''}
        ` : `
          <div class="form-info" style="margin-bottom: 10px; font-size: 12px;">
            <b>${p.bestandnaam}</b><br>
            ${p.dagen.length} dagen · ${p.celOpmsAantal} cel-opmerkingen · ${p.dagOpmsAantal} dag-opmerkingen<br>
            ${p.dienstAantal} dienst-toewijzingen · ${p.besprAantal} besprekingen · ${p.intervAantal} interventies
          </div>
          ${p.waarschuwingen.length ? `
            <div style="background: #faeeda; color: #412402; padding: 8px 10px; border-radius: 6px; font-size: 12px; margin-bottom: 10px;">
              <b>Waarschuwingen (${p.waarschuwingenTotaal}):</b><br>
              ${p.waarschuwingen.map(w => `• ${w}`).join('<br>')}
              ${p.waarschuwingenTotaal > p.waarschuwingen.length ? `<br>… en ${p.waarschuwingenTotaal - p.waarschuwingen.length} meer` : ''}
            </div>
          ` : ''}
          <details style="margin-bottom: 10px;">
            <summary class="muted" style="cursor: pointer; font-size: 12px;">Voorbeeld eerste 3 dagen</summary>
            <pre style="font-size: 10px; overflow-x: auto; background: rgba(0,0,0,0.03); padding: 8px; border-radius: 4px; margin-top: 6px;">${(p.dagen.slice(0, 3).map(d => JSON.stringify(d, null, 2)).join('\n\n')).replace(/</g,'&lt;')}</pre>
          </details>
          <div style="display: flex; gap: 8px;">
            <button class="btn" style="flex: 1;" ${bezig?'disabled':''} onclick="window.actImportAnnuleren()">Annuleren</button>
            <button class="btn btn-primary" style="flex: 1;" ${bezig?'disabled':''} onclick="window.actImportSchrijven()">${bezig ? 'Schrijven…' : 'Importeer (vervangt Firestore)'}</button>
          </div>
        `}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// ==== Handlers ===============================================================

window.opslaanParttime = async function() {
  try {
    for (const r of vasteRads()) {
      const elPf = document.getElementById('pf_' + r.id);
      const elVr = document.getElementById('vr_' + r.id);
      const update = {};
      if (elPf) {
        const pct = Math.max(10, Math.min(100, parseInt(elPf.value, 10) || 100));
        update.parttime_factor = pct / 100;
      }
      if (elVr) {
        const dgn = Math.max(0, Math.min(100, parseInt(elVr.value, 10) || 40));
        update.vakantierecht = dgn;
      }
      if (Object.keys(update).length > 0) {
        await setDoc(doc(db, 'radiologen', r.id), update, { merge: true });
      }
    }
    alert('Parttime &amp; vakantierecht opgeslagen.');
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
};

window.opslaanInvallers = async function() {
  try {
    for (const slotId of SLOTS) {
      const code = document.getElementById('inv_code_' + slotId).value.trim();
      const achternaam = document.getElementById('inv_naam_' + slotId).value.trim();
      const actief = document.getElementById('inv_act_' + slotId).classList.contains('aan');
      await setDoc(doc(db, 'radiologen', slotId), {
        id: slotId, code: code || slotId, achternaam: achternaam || '', actief, isSlot: true,
      }, { merge: true });
    }
    alert('Waarnemers opgeslagen.');
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
};

window.nieuweGebruiker = function() {
  document.getElementById('sheetTitle').textContent = 'Nieuwe gebruiker';
  document.getElementById('sheetSub').textContent = 'Vul de gegevens in';
  const rads = vasteRads();
  document.getElementById('sheetBody').innerHTML = `
    <div class="form-field"><label class="form-label">E-mail</label><input type="email" class="input" id="nuEmail" autocapitalize="off"></div>
    <div class="form-field"><label class="form-label">Tijdelijk wachtwoord</label><input type="text" class="input" id="nuPw" value="${STANDAARD_WACHTWOORD}"></div>
    <div class="form-field"><label class="form-label">Rol</label>
      <select class="select" id="nuRol">
        <option value="radioloog">Radioloog</option>
        <option value="beheerder">Beheerder</option>
        <option value="secretariaat">Secretariaat</option>
        <option value="technician">Technician</option>
      </select>
    </div>
    <div class="form-field"><label class="form-label">Gekoppeld aan radioloog (optioneel)</label>
      <select class="select" id="nuRadId">
        <option value="">— geen —</option>
        ${rads.map(r => `<option value="${r.id}">${r.code} · ${r.achternaam}</option>`).join('')}
      </select>
    </div>
    <div class="form-info" style="font-size: 12px;">De gebruiker logt de eerste keer in met dit wachtwoord en wordt dan gevraagd een eigen wachtwoord te kiezen.</div>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.opslaanNieuweGebruiker()">Aanmaken</button>
    </div>
  `;
  openSheet();
};

window.opslaanNieuweGebruiker = async function() {
  const email = document.getElementById('nuEmail').value.trim();
  const pw = document.getElementById('nuPw').value;
  const rol = document.getElementById('nuRol').value;
  const radId = document.getElementById('nuRadId').value;

  if (!email || !pw) { alert('Vul e-mail en wachtwoord in'); return; }
  if (pw.length < 6) { alert('Wachtwoord min. 6 tekens'); return; }

  const btn = document.querySelector('#sheetBody .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader"></span>'; }

  try {
    await fnGebruikerAanmaken({ email, wachtwoord: pw, rol, radioloog_id: radId || null });
    closeSheet();
    alert(`Gebruiker aangemaakt.\nE-mail: ${email}\nWachtwoord: ${pw}\n\nNoteer dit; het wachtwoord is nu niet meer op te vragen.`);
    await laadGebruikers();
    renderGebView();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Aanmaken'; }
    alert('Aanmaken mislukt: ' + (e.message || 'Onbekende fout'));
  }
};

window.gebruikerBewerken = function(uid) {
  const g = state.gebruikers.find(x => x.id === uid);
  if (!g) return;
  const rads = vasteRads();
  const isEigenAccount = uid === state.user.uid;
  const isVasteBeheerder = (g.email || '').toLowerCase() === VASTE_BEHEERDER_EMAIL;

  const huidigePerm = g.permissies || defaultPermissies(g.rol);

  const permissies = [
    { id: 'mag_beheer', label: 'Overzicht — wijzigen' },
    { id: 'mag_beheer_lezen', label: 'Overzicht — bekijken' },
    { id: 'mag_regels', label: 'Regels' },
    { id: 'mag_gebruikers', label: 'Gebruikers' },
    { id: 'mag_wensen_alle', label: 'Wensen van iedereen zien' },
    { id: 'mag_vakantie', label: 'Vakantie-tab zien' },
  ];

  document.getElementById('sheetTitle').textContent = g.email;
  document.getElementById('sheetSub').textContent = 'Rol, koppeling en permissies';
  document.getElementById('sheetBody').innerHTML = `
    ${isVasteBeheerder ? `<div class="form-info" style="margin-bottom: 1rem; font-size: 12px;">🔒 Hoofdbeheerder-account. Rol en koppeling staan vast.</div>` : ''}
    ${(isEigenAccount && !isVasteBeheerder) ? `<div class="form-info" style="margin-bottom: 1rem; font-size: 12px;">⚠ Eigen account. "Gebruikers" kan niet uitgezet worden om lockout te voorkomen.</div>` : ''}
    <div class="form-field"><label class="form-label">Rol${isVasteBeheerder?' 🔒':''}</label>
      <select class="select" id="wzRol" onchange="window.wzRolWissel()" ${isVasteBeheerder?'disabled':''}>
        <option value="radioloog" ${g.rol==='radioloog'?'selected':''}>Radioloog</option>
        <option value="beheerder" ${g.rol==='beheerder'?'selected':''}>Beheerder</option>
        <option value="secretariaat" ${g.rol==='secretariaat'?'selected':''}>Secretariaat</option>
        <option value="technician" ${(g.rol==='technician' || g.rol==='lezer')?'selected':''}>Technician</option>
      </select>
    </div>
    <div class="form-field"><label class="form-label">Gekoppeld aan radioloog${isVasteBeheerder?' 🔒':''}</label>
      <select class="select" id="wzRadId" ${isVasteBeheerder?'disabled':''}>
        <option value="">— geen —</option>
        ${rads.map(r => `<option value="${r.id}" ${g.radioloog_id===r.id?'selected':''}>${r.code} · ${r.achternaam}</option>`).join('')}
      </select>
    </div>
    <div class="form-field">
      <label class="form-label">Permissies</label>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${permissies.map(p => {
          const vergrendeld = isEigenAccount && p.id === 'mag_gebruikers';
          const checked = vergrendeld ? true : huidigePerm[p.id];
          return `
            <label style="display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.03); cursor: ${vergrendeld?'not-allowed':'pointer'}; ${vergrendeld?'opacity:0.7;':''}">
              <input type="checkbox" id="perm_${p.id}" ${checked ? 'checked' : ''} ${vergrendeld?'disabled':''}>
              <span style="font-size: 14px;">${p.label}${vergrendeld?' 🔒':''}</span>
            </label>
          `;
        }).join('')}
      </div>
    </div>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.opslaanGebruikerUpdate('${uid}')">Opslaan</button>
    </div>
  `;
  openSheet();
};

window.wzRolWissel = function() { /* niets automatisch */ };

window.wzPermissiesReset = function() {
  const rol = document.getElementById('wzRol').value;
  const def = defaultPermissies(rol);
  ['mag_beheer','mag_beheer_lezen','mag_regels','mag_gebruikers','mag_wensen_alle'].forEach(p => {
    const el = document.getElementById('perm_' + p);
    if (el && !el.disabled) el.checked = !!def[p];
  });
};

window.opslaanGebruikerUpdate = async function(uid) {
  const g = state.gebruikers.find(x => x.id === uid);
  const isVasteBeheerder = (g?.email || '').toLowerCase() === VASTE_BEHEERDER_EMAIL;

  const rol = isVasteBeheerder ? 'beheerder' : document.getElementById('wzRol').value;
  const radId = isVasteBeheerder ? (g.radioloog_id || '') : document.getElementById('wzRadId').value;
  const permissies = {};
  ['mag_beheer','mag_beheer_lezen','mag_regels','mag_gebruikers','mag_wensen_alle'].forEach(p => {
    const el = document.getElementById('perm_' + p);
    if (el) permissies[p] = el.checked;
  });

  const heeftMagGebruikers = (g, nieuw) => {
    if (g.id === uid) return !!nieuw.permissies.mag_gebruikers;
    const eff = g.permissies || defaultPermissies(g.rol);
    return !!eff.mag_gebruikers;
  };
  const aantalMet = state.gebruikers.filter(g => heeftMagGebruikers(g, { permissies })).length;
  if (aantalMet === 0) {
    alert('Kan niet opslaan: er moet minstens één gebruiker zijn met "Gebruikers"-permissie.');
    return;
  }

  try {
    await updateDoc(doc(db, 'gebruikers', uid), { rol, radioloog_id: radId || null, permissies });
    closeSheet();
    await laadGebruikers();
    renderGebView();
  } catch (e) {
    alert('Wijzigen mislukt: ' + e.message);
  }
};

window.gebruikerWachtwoordReset = async function(uid, email) {
  if (!confirm(`Wachtwoord-reset-link genereren voor ${email}?`)) return;
  try {
    const result = await fnGebruikerResetWachtwoord({ uid });
    const link = result.data.link;
    document.getElementById('sheetTitle').textContent = 'Reset-link voor ' + email;
    document.getElementById('sheetSub').textContent = 'Deel deze link met de gebruiker. Hij is enkele dagen geldig.';
    document.getElementById('sheetBody').innerHTML = `
      <div class="form-info" style="font-size: 12px; word-break: break-all;">${link}</div>
      <div style="display: flex; gap: 8px; margin-top: 1rem;">
        <button class="btn" style="flex: 1;" onclick="window.kopieerLink('${link.replace(/'/g, "\\'")}')">Kopiëren</button>
        <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Sluiten</button>
      </div>
    `;
    openSheet();
  } catch (e) {
    alert('Versturen mislukt: ' + (e.message || 'onbekende fout'));
  }
};

window.gebruikerVerwijderen = async function(uid, email) {
  if ((email || '').toLowerCase() === VASTE_BEHEERDER_EMAIL) {
    alert('Hoofdbeheerder-account kan niet verwijderd worden.');
    return;
  }
  const overigen = state.gebruikers.filter(g => g.id !== uid);
  const aantalMet = overigen.filter(g => {
    const eff = g.permissies || defaultPermissies(g.rol);
    return !!eff.mag_gebruikers;
  }).length;
  if (aantalMet === 0) {
    alert('Kan niet verwijderen: er moet minstens één gebruiker met "Gebruikers"-permissie overblijven.');
    return;
  }
  if (!confirm(`Gebruiker ${email} verwijderen?\n\nDit verwijdert zowel het account als het profiel.`)) return;
  try {
    await fnGebruikerVerwijderen({ uid });
    await laadGebruikers();
    renderGebView();
  } catch (e) {
    alert('Verwijderen mislukt: ' + (e.message || 'onbekende fout'));
  }
};

// Excel-import handlers — delegeer naar import.js, met renderGebView als callback
window.actImportFile        = (input) => actImportFile(input, renderGebView);
window.actImportSchrijven   = ()      => actImportSchrijven(renderGebView);
window.actImportAnnuleren   = ()      => actImportAnnuleren(renderGebView);
window.actZetImportJaar     = (jaar)  => actZetImportJaar(jaar);

// ==== Bezetting wisselen (zelfde stoel, nieuwe persoon) =====================

// Sheet: vervang persoon op een stoel vanaf een datum. Geen data-migratie
// nodig (toewijzingen blijven onder dezelfde slot-id), wel een nieuwe entry
// in bezetting_historie en update van top-level velden.
window.openWisselSheet = function(slotId) {
  const stoel = state.radiologen.find(r => r.id === slotId);
  const isWaarnemer = SLOTS.includes(slotId);
  const huidigB = bezettingOpDatum(slotId, vandaagIso());
  const defDatum = vandaagIso();

  document.getElementById('sheetTitle').textContent = `Wissel persoon op ${slotId}`;
  document.getElementById('sheetSub').textContent = isWaarnemer
    ? 'Nieuwe waarnemer per datum'
    : 'Nieuwe radioloog op deze vaste stoel per datum';

  document.getElementById('sheetBody').innerHTML = `
    ${huidigB ? `<div class="form-info" style="margin-bottom: 12px; font-size: 12px;">Huidig: <b>${huidigB.code}</b> · ${huidigB.achternaam || ''}${huidigB.van ? ` (sinds ${formatDatum(huidigB.van, 'kort')})` : ''}</div>` : `<div class="form-info" style="margin-bottom: 12px; font-size: 12px;">Stoel is leeg.</div>`}
    <div class="form-field"><label class="form-label">Code (initialen, max 4)</label><input type="text" class="input" id="wsCode" maxlength="4" placeholder="bv. AV"></div>
    <div class="form-field"><label class="form-label">Voornaam</label><input type="text" class="input" id="wsVoornaam" placeholder="Anna"></div>
    <div class="form-field"><label class="form-label">Achternaam</label><input type="text" class="input" id="wsAchternaam" placeholder="de Vries"></div>
    <div style="display: flex; gap: 12px;">
      <div class="form-field" style="flex: 1;"><label class="form-label">Parttime %</label><input type="number" class="input" id="wsPf" value="100" min="10" max="100" step="1"></div>
      <div class="form-field" style="flex: 1;"><label class="form-label">Vakantierecht</label><input type="number" class="input" id="wsVr" value="40" min="0" max="100" step="1"></div>
    </div>
    <div class="form-field"><label class="form-label">Ingangsdatum</label><input type="date" class="input" id="wsDatum" value="${defDatum}"></div>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.opslaanWissel('${slotId}')">Doorvoeren</button>
    </div>
  `;
  openSheet();
};

window.opslaanWissel = async function(slotId) {
  const code = document.getElementById('wsCode').value.trim();
  const voornaam = document.getElementById('wsVoornaam').value.trim();
  const achternaam = document.getElementById('wsAchternaam').value.trim();
  const pf = Math.max(10, Math.min(100, parseInt(document.getElementById('wsPf').value, 10) || 100)) / 100;
  const vr = Math.max(0, Math.min(100, parseInt(document.getElementById('wsVr').value, 10) || 40));
  const datum = document.getElementById('wsDatum').value;
  if (!code || !achternaam) { alert('Code en achternaam zijn verplicht.'); return; }
  if (!datum) { alert('Kies een ingangsdatum.'); return; }

  const stoel = state.radiologen.find(r => r.id === slotId);
  const oudeHist = Array.isArray(stoel?.bezetting_historie) ? [...stoel.bezetting_historie] : [];
  // Zorg dat er een entry voor de huidige bezetting bestaat (lazy-init).
  if (oudeHist.length === 0 && (stoel?.code || stoel?.achternaam)) {
    oudeHist.push({
      voornaam: stoel.voornaam || '',
      achternaam: stoel.achternaam || '',
      code: stoel.code || slotId,
      vakantierecht: typeof stoel.vakantierecht === 'number' ? stoel.vakantierecht : 40,
      parttime_factor: typeof stoel.parttime_factor === 'number' ? stoel.parttime_factor : 1,
      van: null, tot: null,
    });
  }
  // Sluit alle nog open entries op de dag voor de ingangsdatum.
  const dagVoor = plusDagen(datum, -1);
  const nieuweHist = oudeHist.map(e => {
    if (!e.tot) return { ...e, tot: dagVoor };
    return e;
  });
  // Voeg nieuwe entry toe.
  nieuweHist.push({
    voornaam, achternaam, code,
    vakantierecht: vr,
    parttime_factor: pf,
    van: datum,
    tot: null,
  });

  try {
    await setDoc(doc(db, 'radiologen', slotId), {
      id: slotId,
      code, voornaam, achternaam,
      vakantierecht: vr,
      parttime_factor: pf,
      actief: true,
      isSlot: SLOTS.includes(slotId),
      bezetting_historie: nieuweHist,
    }, { merge: true });
    closeSheet();
    alert(`Bezetting van ${slotId} aangepast: ${code} · ${achternaam} per ${formatDatum(datum, 'kort')}.`);
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
};

// ==== Maak vast: waarnemer wordt vaste rad in stoel X =======================

// Preview: wat verschuift er als we W-slot per datum naar vaste stoel migreren?
function previewMigratie(vanSlot, naarSlot, datum) {
  let toew = 0, vakantie = 0, dienstD = 0, wensen = 0;
  Object.values(state.indelingMap).forEach(dag => {
    if (!dag?.datum || dag.datum < datum) return;
    if (dag.toewijzingen && dag.toewijzingen[vanSlot]) toew++;
    if (dag.vakantie_v && (vanSlot in dag.vakantie_v)) vakantie++;
    if (dag.dienst) {
      ['dag','avond','nacht'].forEach(s => {
        if (dag.dienst[s] === vanSlot) dienstD++;
      });
    }
  });
  (state.wensen || []).forEach(w => {
    if (w.radioloog_id === vanSlot && w.datum >= datum) wensen++;
  });
  const gebruikersGekoppeld = state.gebruikers.filter(g => g.radioloog_id === vanSlot).length;
  return { toew, vakantie, dienstD, wensen, gebruikersGekoppeld };
}

window.openMaakVastSheet = function(wSlotId) {
  const stoel = state.radiologen.find(r => r.id === wSlotId);
  if (!stoel || stoel.actief === false || !stoel.code) { alert('Deze W-stoel is leeg.'); return; }

  const huidig = bezettingOpDatum(wSlotId, vandaagIso());
  const defDatum = vandaagIso();
  const opties = VASTE_RAD_IDS.map(id => {
    const b = bezettingOpDatum(id, vandaagIso());
    return `<option value="${id}">${id} — ${b ? `${b.code} · ${b.achternaam}` : '(leeg)'}</option>`;
  }).join('');

  document.getElementById('sheetTitle').textContent = `Maak ${huidig?.code || wSlotId} vast`;
  document.getElementById('sheetSub').textContent = `${huidig?.achternaam || ''} verhuist van ${wSlotId} naar een vaste stoel`;

  document.getElementById('sheetBody').innerHTML = `
    <div class="form-info" style="margin-bottom: 12px; font-size: 12px;">
      <b>${huidig?.code || ''}</b> · ${huidig?.achternaam || ''} (nu in ${wSlotId}) wordt per datum de bezetter van een vaste stoel. Toewijzingen, vakantie-V, diensten en wensen vanaf die datum verhuizen mee. Historie van vóór de datum blijft op ${wSlotId}.
    </div>
    <div class="form-field"><label class="form-label">Welke vaste stoel?</label>
      <select class="select" id="mvSlot">${opties}</select>
    </div>
    <div class="form-field"><label class="form-label">Ingangsdatum</label>
      <input type="date" class="input" id="mvDatum" value="${defDatum}" onchange="window.mvUpdatePreview('${wSlotId}')">
    </div>
    <div id="mvPreview" class="form-info" style="font-size: 12px; margin-bottom: 12px;">Tik <b>Preview</b> om te zien wat er verschuift.</div>
    <div style="display: flex; gap: 8px;">
      <button class="btn" style="flex: 1;" onclick="window.mvUpdatePreview('${wSlotId}')">Preview</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.maakVastDoorvoeren('${wSlotId}')">Doorvoeren</button>
    </div>
    <button class="btn" style="width: 100%; margin-top: 8px;" onclick="window.closeSheet()">Annuleren</button>
  `;
  openSheet();
};

window.mvUpdatePreview = function(wSlotId) {
  const naarSlot = document.getElementById('mvSlot').value;
  const datum = document.getElementById('mvDatum').value;
  const el = document.getElementById('mvPreview');
  if (!datum || !naarSlot) { el.textContent = 'Kies stoel en datum.'; return; }
  const p = previewMigratie(wSlotId, naarSlot, datum);
  const huidigDoel = bezettingOpDatum(naarSlot, datum);
  el.innerHTML = `
    Vanaf <b>${formatDatum(datum, 'kort')}</b> verhuizen:
    <ul style="margin: 6px 0 0 18px; padding: 0;">
      <li>${p.toew} toewijzingen</li>
      <li>${p.vakantie} vakantie-V markeringen</li>
      <li>${p.dienstD} dienst-velden</li>
      <li>${p.wensen} wensen</li>
      <li>${p.gebruikersGekoppeld} gekoppelde gebruiker(s)</li>
    </ul>
    ${huidigDoel ? `<div style="margin-top: 6px;">Huidige bezetter van <b>${naarSlot}</b> (${huidigDoel.code} · ${huidigDoel.achternaam || ''}) wordt afgesloten op ${formatDatum(plusDagen(datum, -1), 'kort')}.</div>` : ''}
  `;
};

window.maakVastDoorvoeren = async function(wSlotId) {
  const naarSlot = document.getElementById('mvSlot').value;
  const datum = document.getElementById('mvDatum').value;
  if (!datum || !naarSlot) { alert('Kies stoel en datum.'); return; }
  if (!VASTE_RAD_IDS.includes(naarSlot)) { alert('Ongeldige doel-stoel.'); return; }
  if (!confirm(`Maak ${wSlotId} vast in ${naarSlot} per ${formatDatum(datum, 'kort')}?\n\nToewijzingen, vakantie-V, diensten, wensen en gebruikerskoppeling vanaf die datum verhuizen mee. Niet ongedaan te maken zonder handmatig terugdraaien.`)) return;

  const btn = document.querySelector('#sheetBody .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader"></span>'; }

  try {
    await migreerBezetting(wSlotId, naarSlot, datum);
    closeSheet();
    alert(`${wSlotId} → ${naarSlot} doorgevoerd per ${formatDatum(datum, 'kort')}.`);
    renderGebView();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Doorvoeren'; }
    alert('Migratie mislukt: ' + (e.message || e));
  }
};

// Doet de daadwerkelijke batch-migratie. Schrijft in <500-doc batches om
// firestore-limieten te respecteren.
async function migreerBezetting(vanSlot, naarSlot, datum) {
  const dagVoor = plusDagen(datum, -1);

  // 1. Bezetting van vanSlot ophalen
  const vanStoel = state.radiologen.find(r => r.id === vanSlot);
  const vanHist = Array.isArray(vanStoel?.bezetting_historie) ? [...vanStoel.bezetting_historie] : [];
  if (vanHist.length === 0 && vanStoel) {
    vanHist.push({
      voornaam: vanStoel.voornaam || '',
      achternaam: vanStoel.achternaam || '',
      code: vanStoel.code || vanSlot,
      vakantierecht: typeof vanStoel.vakantierecht === 'number' ? vanStoel.vakantierecht : 40,
      parttime_factor: typeof vanStoel.parttime_factor === 'number' ? vanStoel.parttime_factor : 1,
      van: null, tot: null,
    });
  }
  const persoon = vanHist.find(e => !e.tot) || vanHist[vanHist.length - 1];
  if (!persoon) throw new Error('Geen persoon gevonden in ' + vanSlot);

  // 2. Bezetting van naarSlot
  const naarStoel = state.radiologen.find(r => r.id === naarSlot);
  const naarHist = Array.isArray(naarStoel?.bezetting_historie) ? [...naarStoel.bezetting_historie] : [];
  if (naarHist.length === 0 && naarStoel) {
    naarHist.push({
      voornaam: naarStoel.voornaam || '',
      achternaam: naarStoel.achternaam || '',
      code: naarStoel.code || naarSlot,
      vakantierecht: typeof naarStoel.vakantierecht === 'number' ? naarStoel.vakantierecht : 40,
      parttime_factor: typeof naarStoel.parttime_factor === 'number' ? naarStoel.parttime_factor : 1,
      van: null, tot: null,
    });
  }

  // Sluit open entries op vanSlot en naarSlot per dagVoor.
  const vanHistNieuw = vanHist.map(e => !e.tot ? { ...e, tot: dagVoor } : e);
  const naarHistNieuw = naarHist.map(e => !e.tot ? { ...e, tot: dagVoor } : e);
  // Voeg persoon toe als nieuwe open entry op naarSlot.
  naarHistNieuw.push({
    voornaam: persoon.voornaam || '',
    achternaam: persoon.achternaam || '',
    code: persoon.code || vanSlot,
    vakantierecht: typeof persoon.vakantierecht === 'number' ? persoon.vakantierecht : 40,
    parttime_factor: typeof persoon.parttime_factor === 'number' ? persoon.parttime_factor : 1,
    van: datum, tot: null,
  });

  // 3. Update beide stoel-records
  const batch1 = writeBatch(db);
  batch1.set(doc(db, 'radiologen', naarSlot), {
    id: naarSlot,
    code: persoon.code || vanSlot,
    voornaam: persoon.voornaam || '',
    achternaam: persoon.achternaam || '',
    vakantierecht: persoon.vakantierecht ?? 40,
    parttime_factor: persoon.parttime_factor ?? 1,
    bezetting_historie: naarHistNieuw,
  }, { merge: true });
  batch1.set(doc(db, 'radiologen', vanSlot), {
    id: vanSlot,
    code: '', voornaam: '', achternaam: '',
    actief: false,
    isSlot: SLOTS.includes(vanSlot),
    bezetting_historie: vanHistNieuw,
  }, { merge: true });
  await batch1.commit();

  // 4. Migreer indelingen vanaf datum: rename van → naar in toewijzingen, vakantie_v, dienst.
  const updates = [];
  Object.values(state.indelingMap).forEach(dag => {
    if (!dag?.datum || dag.datum < datum) return;
    const upd = { datum: dag.datum };
    let raak = false;
    if (dag.toewijzingen && dag.toewijzingen[vanSlot]) {
      upd[`toewijzingen.${naarSlot}`] = dag.toewijzingen[vanSlot];
      upd[`toewijzingen.${vanSlot}`] = deleteField();
      raak = true;
    }
    if (dag.vakantie_v && (vanSlot in dag.vakantie_v)) {
      upd[`vakantie_v.${naarSlot}`] = dag.vakantie_v[vanSlot];
      upd[`vakantie_v.${vanSlot}`] = deleteField();
      raak = true;
    }
    if (dag.dienst) {
      ['dag','avond','nacht'].forEach(s => {
        if (dag.dienst[s] === vanSlot) {
          upd[`dienst.${s}`] = naarSlot;
          raak = true;
        }
      });
    }
    if (raak) updates.push(upd);
  });

  // Schrijf in chunks van 400 documenten per batch (Firestore-limiet 500).
  for (let i = 0; i < updates.length; i += 400) {
    const chunk = updates.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(u => {
      const datumKey = u.datum;
      const data = { ...u };
      delete data.datum;
      batch.update(doc(db, 'indeling', datumKey), data);
    });
    await batch.commit();
  }

  // 5. Wensen migreren
  const wensUpdates = (state.wensen || []).filter(w => w.radioloog_id === vanSlot && w.datum >= datum);
  for (let i = 0; i < wensUpdates.length; i += 400) {
    const chunk = wensUpdates.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(w => {
      batch.update(doc(db, 'wensen', w.id), { radioloog_id: naarSlot });
    });
    await batch.commit();
  }

  // 6. Gebruikers koppeling van vanSlot naar naarSlot
  const gebruikersUpdates = state.gebruikers.filter(g => g.radioloog_id === vanSlot);
  for (const g of gebruikersUpdates) {
    await updateDoc(doc(db, 'gebruikers', g.id), { radioloog_id: naarSlot });
  }
}
