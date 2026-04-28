// Gebruikers-view: gebruikers beheren, parttime, waarnemers, Excel-import.
import { collection, doc, getDocs, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, fnGebruikerAanmaken, fnGebruikerVerwijderen, fnGebruikerResetWachtwoord } from '../firebase-init.js';
import { state, SLOTS, VASTE_BEHEERDER_EMAIL } from '../state.js';
import {
  vasteRads, radiologenMap, parttimeFactor, defaultPermissies,
  magGebruikersBeheren, genereerWachtwoord,
} from '../helpers.js';
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

  // Vaste radiologen — parttime-percentage
  html += `
    <div style="margin-top: 1.5rem;">
      <div class="summary-label" style="margin-bottom: 6px;">Vaste radiologen — parttime</div>
      <div class="card">
        <p class="muted" style="margin: 0 0 10px;">Percentage van fulltime (default 100%). Gebruikt voor de ratio-weergave in Activiteit-tab.</p>
        ${vasteRads().map(r => {
          const pf = parttimeFactor(r.id);
          const pct = Math.round(pf * 100);
          return `
            <div style="display: grid; grid-template-columns: 90px 1fr 70px; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.06);">
              <div style="font-weight: 500;">${r.code}</div>
              <div class="muted" style="font-size: 13px;">${r.achternaam || ''}</div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <input type="number" class="input" id="pf_${r.id}" value="${pct}" min="10" max="100" step="1" style="padding: 6px 8px; font-size: 13px; text-align: right;">
                <span class="muted" style="font-size: 13px;">%</span>
              </div>
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
        <p class="muted" style="margin: 0 0 10px;">Alleen "actief" waarnemers verschijnen in het beheer-raster en in tellingen. Code is de afkorting (max 4 tekens).</p>
        ${SLOTS.map(slotId => {
          const slot = state.radiologen.find(r => r.id === slotId) || { id: slotId, code: '', achternaam: '', actief: false };
          const isActief = slot.actief !== false;
          return `
            <div style="display: grid; grid-template-columns: auto 1fr 1fr auto; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.06);">
              <div style="font-weight: 500; color: #5f5e5a; min-width: 28px;">${slotId}</div>
              <input type="text" class="input" id="inv_code_${slotId}" placeholder="Code" maxlength="4" value="${(slot.code||'').replace(/"/g,'&quot;')}" style="padding: 6px 8px; font-size: 13px;">
              <input type="text" class="input" id="inv_naam_${slotId}" placeholder="Achternaam" value="${(slot.achternaam||'').replace(/"/g,'&quot;')}" style="padding: 6px 8px; font-size: 13px;">
              <span class="toggle-switch ${isActief ? 'aan' : ''}" id="inv_act_${slotId}" onclick="this.classList.toggle('aan')"></span>
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
      const el = document.getElementById('pf_' + r.id);
      if (!el) continue;
      const pct = Math.max(10, Math.min(100, parseInt(el.value, 10) || 100));
      const factor = pct / 100;
      await setDoc(doc(db, 'radiologen', r.id), { parttime_factor: factor }, { merge: true });
    }
    alert('Parttime-percentages opgeslagen.');
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
    <div class="form-field"><label class="form-label">Tijdelijk wachtwoord</label><input type="text" class="input" id="nuPw" value="${genereerWachtwoord()}"></div>
    <div class="form-field"><label class="form-label">Rol</label>
      <select class="select" id="nuRol">
        <option value="radioloog">Radioloog</option>
        <option value="beheerder">Beheerder</option>
        <option value="secretariaat">Secretariaat</option>
        <option value="lezer">Lezer</option>
      </select>
    </div>
    <div class="form-field"><label class="form-label">Gekoppeld aan radioloog (optioneel)</label>
      <select class="select" id="nuRadId">
        <option value="">— geen —</option>
        ${rads.map(r => `<option value="${r.id}">${r.code} · ${r.achternaam}</option>`).join('')}
      </select>
    </div>
    <div class="form-info" style="font-size: 12px;">De gebruiker kan direct inloggen met dit wachtwoord en moet het zelf veranderen via 'Wachtwoord vergeten' of je reset-functie.</div>
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
    { id: 'mag_beheer', label: 'Beheer (rooster wijzigen)' },
    { id: 'mag_beheer_lezen', label: 'Beheer (alleen-lezen)' },
    { id: 'mag_regels', label: 'Regels' },
    { id: 'mag_gebruikers', label: 'Gebruikers' },
    { id: 'mag_wensen_alle', label: 'Wensen van iedereen zien' },
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
        <option value="lezer" ${g.rol==='lezer'?'selected':''}>Lezer</option>
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
      <p class="muted" style="margin-top: 6px; font-size: 11px;">Knop hieronder zet permissies terug op de standaard voor de gekozen rol.</p>
      <button class="btn" style="width: 100%; font-size: 12px; padding: 6px; margin-top: 4px;" onclick="window.wzPermissiesReset()">Permissies → standaard voor rol</button>
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
