// Entry point van de app. Laadt alle modules in juiste volgorde, registreert
// algemene window-handlers, doet render-dispatch en boot via Firebase Auth.
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, doc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { auth, db } from './firebase-init.js';
import { state, VASTE_RAD_IDS } from './state.js';
import {
  vandaagIso, mandagVanIso, plusDagen, radiologenMap, vertalFirebaseFout,
  magBeheerLezen, magRegelsBeheren, magGebruikersBeheren, magAlleWensenZien,
  isBeperktZichtRol, STANDAARD_WACHTWOORD, valideerWachtwoord,
} from './helpers.js';
import { openSheet, closeSheet } from './sheets.js';

// Importeer alle render-functies (modules registreren ook hun window-handlers)
import { renderRadView } from './views/radioloog.js';
import { renderAfdView } from './views/afdeling.js';
import { renderDieView } from './views/dienst.js';
import { renderActView } from './views/activiteit.js';
import { renderWenView } from './views/wensen.js';
import { renderBehView } from './views/overzicht.js';
import { renderRegView } from './views/regels.js';
import { renderGebView } from './views/gebruikers.js';

// ==== Sheet helpers op window (voor inline onclick="window.closeSheet()") ====

window.openSheet  = openSheet;
window.closeSheet = closeSheet;

// ==== Auth handlers ==========================================================

// Onthoudt het wachtwoord van de zojuist uitgevoerde login. Wordt na de
// eerste-login check op null gezet. Niet in state — alleen module-scope.
let _laatsteLoginWachtwoord = null;

window.doLogin = async function() {
  const email = document.getElementById('loginEmail').value.trim();
  const pw    = document.getElementById('loginPassword').value;
  const err   = document.getElementById('loginError');
  err.style.display = 'none';
  if (!email || !pw) {
    err.textContent = 'Vul e-mail en wachtwoord in';
    err.style.display = 'block';
    return;
  }
  try {
    _laatsteLoginWachtwoord = pw;
    await signInWithEmailAndPassword(auth, email, pw);
  } catch (e) {
    _laatsteLoginWachtwoord = null;
    err.textContent = vertalFirebaseFout(e.code);
    err.style.display = 'block';
  }
};

window.doLogout = async function() {
  if (!confirm('Uitloggen?')) return;
  state.unsubscribers.forEach(fn => fn());
  state.unsubscribers = [];
  await signOut(auth);
};

window.kopieerLink = async function(link) {
  try {
    await navigator.clipboard.writeText(link);
    alert('Link gekopieerd naar klembord');
  } catch (e) {
    alert('Kopiëren mislukte. Selecteer de link handmatig.');
  }
};

// ==== Navigatie-handlers (gedeeld door alle views) ===========================

window.showView = function(v) {
  state.huidigeView = v;
  renderTabs();
  render();
};

window.navigeerWeek = function(delta) {
  state.weekMaandag = plusDagen(state.weekMaandag || mandagVanIso(vandaagIso()), delta * 7);
  render();
};

window.navigeerDag = function(delta) {
  const huidig = state.huidigeDatum || vandaagIso();
  state.huidigeDatum = plusDagen(huidig, delta);
  state.weekMaandag = mandagVanIso(state.huidigeDatum);
  render();
};

window.naarVandaag = function() {
  state.huidigeDatum = vandaagIso();
  state.weekMaandag = mandagVanIso(state.huidigeDatum);
  render();
};

window.toggleWeekRads = function() {
  state.toonWeekRads = !state.toonWeekRads;
  render();
};

window.weekKiezerWissel = function(input) {
  const v = input.value;
  if (!v) return;
  state.huidigeDatum = v;
  state.weekMaandag = mandagVanIso(v);
  render();
};

window.springNaarBeheer = function(datum) {
  if (!magBeheerLezen()) return;
  state.huidigeDatum = datum;
  state.weekMaandag = mandagVanIso(datum);
  state.huidigeView = 'beh';
  render();
};

window.toonGebruikerSheet = function() {
  const p = state.profiel;
  document.getElementById('sheetTitle').textContent = p.email;
  document.getElementById('sheetSub').textContent = `Ingelogd als ${p.rol}`;
  document.getElementById('sheetBody').innerHTML = `
    <div class="summary"><div class="summary-label">Account</div><div class="summary-text">${p.email}</div></div>
    <div class="summary"><div class="summary-label">Rol</div><div class="summary-text">${p.rol}</div></div>
    ${p.radioloog_id ? `<div class="summary"><div class="summary-label">Gekoppeld als radioloog</div><div class="summary-text">${p.radioloog_id}</div></div>` : ''}
    <button class="btn" style="width: 100%; margin-top: 1rem;" onclick="window.doLogout()">Uitloggen</button>
  `;
  openSheet();
};

// ==== Tabs + user chip =======================================================

function renderTabs() {
  const beperkt = isBeperktZichtRol();
  const tabs = beperkt
    ? [
        { id: 'beh', label: 'Overzicht' },
        { id: 'afd', label: 'Afdeling' },
        { id: 'die', label: 'Dienst' },
      ]
    : [
        { id: 'beh', label: 'Overzicht' },
        { id: 'rad', label: 'Radioloog' },
        { id: 'afd', label: 'Afdeling' },
        { id: 'die', label: 'Dienst' },
      ];
  const rol = state.profiel?.rol;
  if (!beperkt) {
    tabs.push({ id: 'act', label: 'Activiteit' });
    if (rol === 'radioloog' || magAlleWensenZien()) {
      let label = 'Wensen';
      if (magAlleWensenZien()) {
        const open = state.wensen.filter(w => (w.status || 'open') === 'open' && w.datum >= vandaagIso()).length;
        if (open > 0) label += `<span class="tab-badge">${open}</span>`;
      }
      tabs.push({ id: 'wen', label });
    }
    if (magRegelsBeheren()) tabs.push({ id: 'reg', label: 'Regels' });
    if (magGebruikersBeheren()) tabs.push({ id: 'geb', label: 'Gebruikers' });
  }

  // Als huidige tab niet meer in de lijst staat (rol-wijziging tijdens sessie),
  // val terug op Overzicht.
  if (!tabs.some(t => t.id === state.huidigeView)) state.huidigeView = 'beh';

  document.getElementById('tabs').innerHTML = tabs.map(t => `
    <button class="tab ${t.id === state.huidigeView ? 'active' : ''}" onclick="window.showView('${t.id}')">${t.label}</button>
  `).join('');

  ['rad', 'afd', 'die', 'act', 'wen', 'beh', 'reg', 'geb'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.style.display = v === state.huidigeView ? 'block' : 'none';
  });
}

function renderUserChip() {
  const el = document.getElementById('userChip');
  if (!el || !state.profiel) return;
  const p = state.profiel;
  const rad = p.radioloog_id ? radiologenMap()[p.radioloog_id] : null;
  const naam = rad ? rad.code : (p.email?.split('@')[0] || '?');
  el.textContent = `${naam} · ${p.rol}`;
}

// ==== Render-dispatcher ======================================================

function render() {
  renderUserChip();
  renderTabs();
  if      (state.huidigeView === 'rad') renderRadView();
  else if (state.huidigeView === 'afd') renderAfdView();
  else if (state.huidigeView === 'die') renderDieView();
  else if (state.huidigeView === 'act') renderActView();
  else if (state.huidigeView === 'wen') renderWenView();
  else if (state.huidigeView === 'beh') renderBehView();
  else if (state.huidigeView === 'reg') renderRegView();
  else if (state.huidigeView === 'geb') renderGebView();
}

// Maak render globaal toegankelijk voor modules die zelf willen re-renderen
window.__rooster_render = render;

// ==== Data loading ===========================================================

async function laadProfiel(uid) {
  const snap = await getDoc(doc(db, 'gebruikers', uid));
  if (!snap.exists()) {
    throw new Error('Jouw account heeft nog geen profiel. Vraag een beheerder om je toe te voegen.');
  }
  return { id: uid, ...snap.data() };
}

function luisterNaarData() {
  state.unsubscribers.push(onSnapshot(collection(db, 'radiologen'), (snap) => {
    state.radiologen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!state.huidigeRadId) {
      state.huidigeRadId = state.profiel?.radioloog_id && VASTE_RAD_IDS.includes(state.profiel.radioloog_id)
        ? state.profiel.radioloog_id
        : VASTE_RAD_IDS[0];
    }
    render();
  }));

  state.unsubscribers.push(onSnapshot(collection(db, 'functies'), (snap) => {
    state.functies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }));

  state.unsubscribers.push(onSnapshot(collection(db, 'besprekingen'), (snap) => {
    state.besprekingen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }));

  state.unsubscribers.push(onSnapshot(collection(db, 'indeling'), (snap) => {
    const map = {};
    snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() }; });
    state.indelingMap = map;
    render();
  }));

  state.unsubscribers.push(onSnapshot(collection(db, 'validatie_regels'), (snap) => {
    state.validatieRegels = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }));

  state.unsubscribers.push(onSnapshot(collection(db, 'instellingen'), (snap) => {
    snap.docs.forEach(d => {
      const data = d.data();
      if (data.dect_speciaal)  window.DECT_SPECIAAL = data.dect_speciaal;
      if (data.tellen_codes)   window.TELLEN_CODES = data.tellen_codes;
      if (data.mtsdagen_codes) window.MTSDAGEN_CODES = data.mtsdagen_codes;
    });
    render();
  }));

  state.unsubscribers.push(onSnapshot(collection(db, 'wensen'), (snap) => {
    state.wensen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }));
}

// ==== Boot ===================================================================

document.getElementById('versieLabel').textContent = window.APP_VERSIE;

onAuthStateChanged(auth, async (user) => {
  document.getElementById('loading').style.display = 'none';
  if (!user) {
    document.getElementById('app').style.display = 'none';
    document.getElementById('login').style.display = 'flex';
    return;
  }

  try {
    const profiel = await laadProfiel(user.uid);
    state.user = user;
    state.profiel = profiel;

    state.huidigeDatum = vandaagIso();
    state.weekMaandag = mandagVanIso(state.huidigeDatum);

    state.huidigeView = 'beh';

    document.getElementById('login').style.display = 'none';

    // Eerste-login check: als gebruiker met standaard wachtwoord ingelogd is
    // én er nog geen wachtwoordwissel heeft plaatsgevonden, forceer wissel.
    const moetWisselen = profiel.wachtwoord_gewijzigd !== true
                         && _laatsteLoginWachtwoord === STANDAARD_WACHTWOORD;
    _laatsteLoginWachtwoord = null;

    if (moetWisselen) {
      toonEersteLoginSheet();
      return;
    }

    document.getElementById('app').style.display = 'block';
    renderTabs();
    luisterNaarData();
  } catch (e) {
    document.getElementById('login').style.display = 'flex';
    const err = document.getElementById('loginError');
    err.textContent = e.message;
    err.style.display = 'block';
    await signOut(auth);
  }
});

// Eerste-login wachtwoord-wissel: gebruiker moet een eigen wachtwoord kiezen
// voordat de app verder laadt.
function toonEersteLoginSheet() {
  document.getElementById('sheetTitle').textContent = 'Welkom — kies een wachtwoord';
  document.getElementById('sheetSub').textContent = 'Eerste keer inloggen — vervang het standaard wachtwoord';
  document.getElementById('sheetBody').innerHTML = `
    <div class="form-info" style="font-size: 12px; margin-bottom: 1rem;">Je bent ingelogd met het standaard wachtwoord. Kies nu een eigen wachtwoord van minstens 6 tekens.</div>
    <div class="form-field">
      <label class="form-label">Nieuw wachtwoord</label>
      <input type="password" class="input" id="elNw1" autocomplete="new-password">
    </div>
    <div class="form-field">
      <label class="form-label">Bevestig wachtwoord</label>
      <input type="password" class="input" id="elNw2" autocomplete="new-password">
    </div>
    <div id="elFout" class="form-info" style="font-size: 12px; color: #c0392b; display: none; margin-bottom: 8px;"></div>
    <button class="btn btn-primary" style="width: 100%;" onclick="window.elOpslaan()">Wachtwoord opslaan</button>
  `;
  // Sheet openen zonder sluit-mogelijkheid (geen annuleer-knop)
  openSheet();
}

window.elOpslaan = async function() {
  const nw1 = document.getElementById('elNw1').value;
  const nw2 = document.getElementById('elNw2').value;
  const fout = document.getElementById('elFout');
  fout.style.display = 'none';

  const fnFout = (msg) => {
    fout.textContent = msg;
    fout.style.display = 'block';
  };

  if (nw1 !== nw2) { fnFout('De wachtwoorden komen niet overeen'); return; }
  const fout1 = valideerWachtwoord(nw1);
  if (fout1) { fnFout(fout1); return; }

  const btn = document.querySelector('#sheetBody .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Bezig…'; }

  try {
    await updatePassword(state.user, nw1);
    await updateDoc(doc(db, 'gebruikers', state.user.uid), { wachtwoord_gewijzigd: true });
    state.profiel.wachtwoord_gewijzigd = true;
    closeSheet();
    document.getElementById('app').style.display = 'block';
    renderTabs();
    luisterNaarData();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Wachtwoord opslaan'; }
    // Speciaal geval: Firebase vereist soms recente login voor updatePassword
    if (e.code === 'auth/requires-recent-login') {
      fnFout('Sessie te oud — log opnieuw in en probeer nogmaals');
      setTimeout(async () => { await signOut(auth); }, 2000);
    } else {
      fnFout('Wijzigen mislukt: ' + (e.message || e.code));
    }
  }
};
