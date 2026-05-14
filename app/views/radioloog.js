// Radioloog-view: per maat een week-overzicht met dag-cards.
import { state } from '../state.js';
import {
  vasteRads, radiologenMap, vandaagIso, isoWeekVan, datumsVanWeek,
  weekRange, formatDatum, fclass, functieNaam, toewijzingVoor, magOpmerkingen,
  magBeheerLezen, magWijzigen, esc,
} from '../helpers.js';
import { openSheet, closeSheet } from '../sheets.js';
import { auth, db, reauthenticateWithCredential, EmailAuthProvider } from '../firebase-init.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function renderRadView() {
  const container = document.getElementById('view-rad');
  const rads = vasteRads();
  if (rads.length === 0) { container.innerHTML = '<div class="empty-state">Nog geen radiologen geladen…</div>'; return; }

  const eigenRadId = state.profiel?.radioloog_id;
  const isBeheer = magWijzigen();

  // Gewone radioloog ziet alleen zichzelf; beheerder ziet allen met achternaam
  const zichtbareRads = isBeheer
    ? rads.filter(r => r.achternaam)
    : rads.filter(r => r.id === eigenRadId);

  // Zorg dat huidigeRadId altijd geldig is voor deze gebruiker
  if (!isBeheer && eigenRadId) state.huidigeRadId = eigenRadId;

  const rad = radiologenMap()[state.huidigeRadId] || zichtbareRads[0];
  if (!rad) { container.innerHTML = '<div class="empty-state">Geen gekoppeld radioloog-profiel gevonden.</div>'; return; }

  const wkMa = state.weekMaandag;
  const datums = datumsVanWeek(wkMa);
  const vandaag = vandaagIso();
  const wkNr = isoWeekVan(wkMa);

  const radSelector = isBeheer
    ? `<select class="select" style="font-weight: 500; font-size: 15px; padding: 4px 8px;" onchange="window.zetRadId(this.value)">
        ${zichtbareRads.map(r => `<option value="${r.id}" ${r.id===rad.id?'selected':''}>${r.achternaam}</option>`).join('')}
       </select>`
    : `<span style="font-weight: 500; font-size: 15px;">${rad.achternaam}</span>`;

  let html = `
    <div class="card">
      <div class="row">
        <div class="avatar">${rad.code}</div>
        <div style="flex: 1; min-width: 0;">${radSelector}</div>
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
      ${eigenRadId === rad.id ? `<div style="margin-top: 10px; border-top: 1px solid rgba(0,0,0,0.06); padding-top: 10px;">
        <button class="btn" style="width: 100%; font-size: 13px;" onclick="window.agendaLinkGenereren()">🔗 Agenda-link</button>
      </div>` : ''}
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
  if (dag?.bespreking)  body += `<div style="margin-bottom: 10px;"><span class="muted">Bespreking</span><br>${esc(dag.bespreking)}</div>`;
  if (dag?.interventie) body += `<div style="margin-bottom: 10px;"><span class="muted">Interventie</span><br>${esc(dag.interventie)}</div>`;
  const celOpm = dag?.cel_opmerkingen?.[radId];
  if (celOpm)           body += `<div style="margin-bottom: 10px;"><span class="muted">Mijn opmerking</span><br>${esc(celOpm)}</div>`;
  if (dag?.opmerking)   body += `<div style="margin-bottom: 10px;"><span class="muted">Dag-opmerking</span><br>${esc(dag.opmerking)}</div>`;
  body += `</div>`;

  if (magOpmerkingen()) {
    body += `<button class="btn" style="width: 100%;" onclick="window.opmerkingBewerken('${datum}')">Opmerking bewerken</button>`;
  }

  document.getElementById('sheetBody').innerHTML = body;
  openSheet();
};

// ==== Agenda-link ============================================================

window.agendaLinkGenereren = async function() {
  const uid = state.user?.uid;
  const email = state.profiel?.email || state.user?.email;
  if (!uid) return;

  // Stap 1: wachtwoord verificatie via sheet
  document.getElementById('sheetTitle').textContent = 'Agenda-link';
  document.getElementById('sheetSub').textContent = 'Verifieer je identiteit';
  document.getElementById('sheetBody').innerHTML = `
    <p style="font-size: 13px; color: #3a3a38; margin: 0 0 1rem;">Voer je wachtwoord in om door te gaan.</p>
    <div class="form-field">
      <label class="form-label">Wachtwoord</label>
      <input type="password" class="input" id="agendaPw" autocomplete="current-password">
    </div>
    <div id="agendaPwFout" class="form-error" style="display:none;"></div>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      <button class="btn" style="flex:1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex:1;" onclick="window.agendaLinkVerifieer('${uid}', '${email}')">Verifiëren</button>
    </div>
  `;
  openSheet();
};

window.agendaLinkVerifieer = async function(uid, email) {
  const pw = document.getElementById('agendaPw')?.value;
  const fout = document.getElementById('agendaPwFout');
  if (!pw) { fout.textContent = 'Voer je wachtwoord in'; fout.style.display = 'block'; return; }

  try {
    const credential = EmailAuthProvider.credential(email, pw);
    await reauthenticateWithCredential(auth.currentUser, credential);
  } catch (e) {
    const foutEl = document.getElementById('agendaPwFout');
    if (foutEl) { foutEl.textContent = 'Wachtwoord onjuist'; foutEl.style.display = 'block'; }
    return;
  }

  // Stap 2: waarschuwing tonen
  document.getElementById('sheetTitle').textContent = 'Agenda-link — waarschuwing';
  document.getElementById('sheetSub').textContent = '';
  document.getElementById('sheetBody').innerHTML = `
    <div class="form-error" style="display:block; margin-bottom: 1rem;">
      ⚠️ Deze link geeft <strong>iedereen</strong> die toegang heeft tot de link direct toegang tot jouw rooster.<br><br>
      Deel de link nooit met anderen. Gebruik de link alleen in je eigen privé-agenda-app.
    </div>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      <button class="btn" style="flex:1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex:1;" onclick="window.agendaLinkMaken('${uid}')">Ik begrijp het, genereer link</button>
    </div>
  `;
};

window.agendaLinkMaken = async function(uid) {
  try {
    // Haal bestaand token op of maak nieuw aan
    const snap = await getDoc(doc(db, 'gebruikers', uid));
    let token = snap.data()?.agenda_token;
    if (!token) {
      token = crypto.randomUUID();
      await setDoc(doc(db, 'gebruikers', uid), { agenda_token: token }, { merge: true });
    }

    const link = `https://europe-west1-rooster-radiologie.cloudfunctions.net/agendaFeed?token=${token}`;

    document.getElementById('sheetTitle').textContent = 'Agenda-link';
    document.getElementById('sheetSub').textContent = 'Kopieer en plak in je agenda-app';
    document.getElementById('sheetBody').innerHTML = `
      <p class="muted" style="font-size: 12px; margin: 0 0 8px;">Gebruik deze link als <strong>webcal/iCal-abonnement</strong> in bijv. Google Agenda, Outlook of Apple Agenda.</p>
      <div class="form-info" style="font-size: 12px; word-break: break-all; margin-bottom: 1rem;">${link}</div>
      <div style="display: flex; gap: 8px;">
        <button class="btn" style="flex:1;" onclick="window.kopieerLink('${link}')">Kopiëren</button>
        <button class="btn" style="flex:1;" onclick="window.agendaLinkIntrekken('${uid}')">Link intrekken</button>
      </div>
      <button class="btn" style="width:100%; margin-top: 8px;" onclick="window.closeSheet()">Sluiten</button>
    `;
  } catch (e) {
    alert('Genereren mislukt: ' + e.message);
  }
};

window.agendaLinkIntrekken = async function(uid) {
  if (!confirm('Huidige agenda-link ongeldig maken?\n\nAgenda-apps die de link gebruiken zullen geen updates meer ontvangen.')) return;
  try {
    await setDoc(doc(db, 'gebruikers', uid), { agenda_token: null }, { merge: true });
    alert('Link ingetrokken. Genereer een nieuwe link als je de koppeling wilt herstellen.');
    closeSheet();
  } catch (e) {
    alert('Intrekken mislukt: ' + e.message);
  }
};
