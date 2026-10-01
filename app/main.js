// Entry point van de app. Laadt alle modules in juiste volgorde, registreert
// algemene window-handlers, doet render-dispatch en boot via Firebase Auth.
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, onSnapshot, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { updateDoc } from './schrijven.js';
import { auth, db } from './firebase-init.js';
import { state, VASTE_RAD_IDS } from './state.js';
import {
  vandaagIso, mandagVanIso, plusDagen, radiologenMap, vertalFirebaseFout,
  magBeheerLezen, magRegelsBeheren, magGebruikersBeheren, magAlleWensenZien, magWijzigen,
  magVakantieZien, valideerWachtwoord, isVasteStoel, ongelezenOpmerkingenTotaal,
} from './helpers.js';
import { zetMeldenBuitenWeek } from './save.js';
import { openSheet, closeSheet } from './sheets.js';
import { meld, bevestig } from './dialoog.js';
import { toonBalk, verbergBalk } from './statusbalk.js';

// Importeer alle render-functies (modules registreren ook hun window-handlers)
import { renderRadView } from './views/radioloog.js';
import { renderJaaView } from './views/jaaroverzicht.js';
import { renderAfdView } from './views/afdeling.js';
import { renderDieView } from './views/dienst.js';
import { renderActView } from './views/activiteit.js';
import { renderWenView } from './views/wensen.js';
import { renderVakView } from './views/vakantie.js';
import { renderBehView } from './views/overzicht.js';
import { renderRegView } from './views/regels.js';
import { renderGebView } from './views/gebruikers.js';

// ==== Aantekening van dit toestel (v3.33.8) =================================
// Gemeten op een iPhone zonder verbinding: de aanmeldcontrole van Firebase
// antwoordt daar nooit. Geen fout, geen weigering — de vraag "wie is er
// ingelogd?" blijft simpelweg onbeantwoord, en daardoor kwam de app nooit
// verder dan de stap 'aanmeldcontrole gestart'. Firebase kunnen we niet
// repareren; eindeloos wachten hoeven we niet.
//
// Daarom legt de app bij elke geslaagde start zelf vast wie er op dit toestel
// inlogde. Zwijgt de aanmeldcontrole én meldt het toestel dat het geen
// verbinding heeft, dan gaat de app op die aantekening verder.
//
// ⚠ De sleutel bevat de omgeving. /Rooster/ en /Rooster-test/ staan op
// hetzelfde webadres en delen dus hun opslag; zonder dat onderscheid zou een
// aantekening uit de testomgeving in live gebruikt kunnen worden.
const TOESTEL_SLEUTEL = 'rooster_toestel_gebruiker_' + (window.APP_ENV || 'onbekend');

function onthoudToestelGebruiker(user, profiel) {
  try {
    localStorage.setItem(TOESTEL_SLEUTEL, JSON.stringify({
      uid: user.uid,
      email: user.email || profiel.email || null,
      profiel,
      opgeslagen: new Date().toISOString(),
    }));
  } catch (e) { /* opslag vol of geweigerd: dan blijft alleen de gewone weg over */ }
}

function vergeetToestelGebruiker() {
  try { localStorage.removeItem(TOESTEL_SLEUTEL); } catch (e) { /* niets aan te doen */ }
}

function toestelGebruiker() {
  try {
    const rauw = localStorage.getItem(TOESTEL_SLEUTEL);
    if (!rauw) return null;
    const g = JSON.parse(rauw);
    return (g && g.uid && g.profiel) ? g : null;
  } catch (e) { return null; }
}

// ==== Stempels onderweg (v3.33.7) ===========================================
// Het scherm "Geen verbinding" meldde alleen "geen antwoord" en zei daarmee
// niet wáár de app op stond te wachten. Deze stempels zetten de laatst
// bereikte stap neer; die komt op dat scherm te staan. Het vangnet in
// index.html houdt ze bij — dat staat er bewust vóór, zodat "app/main.js nog
// niet begonnen" ook zichtbaar wordt.
function stap(naam) {
  if (typeof window.__stap === 'function') window.__stap(naam);
}
// Dit is de eerste regel die draait nadat álle imports gelukt zijn.
stap('Firebase geladen');

// ==== Sheet helpers op window (voor inline onclick="window.closeSheet()") ====

window.openSheet  = openSheet;
window.closeSheet = closeSheet;

// ==== Help-pagina opener =====================================================
window.toonHelp = function() {
  const isBeheerder = typeof magGebruikersBeheren === 'function'
    ? magGebruikersBeheren()
    : false;
  // Bouw absolute URL op basis van de huidige paginalocatie
  // zodat het ook werkt als de app in een submap staat (bijv. GitHub Pages)
  const base = window.location.href.replace(/\/[^\/]*$/, '/');
  const url = base + (isBeheerder ? 'help/beheerder.html' : 'help/gebruiker.html');
  window.open(url, '_blank', 'noopener');
};

// ==== Auth handlers ==========================================================

window.doLogin = async function() {
  const invoer = document.getElementById('loginEmail').value.trim();
  // Voeg @rooster.intern toe als de gebruiker alleen voornaam.achternaam typt
  const email = invoer.includes('@') ? invoer : invoer + '@rooster.intern';
  const pw    = document.getElementById('loginPassword').value;
  const err   = document.getElementById('loginError');
  err.style.display = 'none';
  if (!invoer || !pw) {
    err.textContent = 'Vul naam en wachtwoord in';
    err.style.display = 'block';
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, pw);
  } catch (e) {
    err.textContent = vertalFirebaseFout(e.code);
    err.style.display = 'block';
  }
};

window.doLogout = async function() {
  if (!(await bevestig('Uitloggen', 'Wil je uitloggen?', 'Uitloggen'))) return;
  state.unsubscribers.forEach(fn => fn());
  state.unsubscribers = [];
  // v3.33.8: eerst de aantekening weg. Bleef die staan, dan zou uitloggen
  // zonder verbinding niets betekenen — de app zou je er zo weer inlaten.
  vergeetToestelGebruiker();
  await signOut(auth);
};

// ==== Eerste aanmelding: wachtwoord wijzigen ================================

window.cpValideer = function() {
  const nieuw    = document.getElementById('cpNieuw')?.value || '';
  const herhaal  = document.getElementById('cpHerhaal')?.value || '';
  const akkoord  = document.getElementById('cpAkkoord')?.checked || false;
  const btn      = document.getElementById('cpBtn');
  const fout     = valideerWachtwoord(nieuw);
  const geldig   = !fout && nieuw === herhaal && akkoord;
  if (btn) btn.disabled = !geldig;
};

window.toonVoorwaarden = function() {
  document.getElementById('voorwaardenModal').style.display = 'flex';
};

window.sluitVoorwaarden = function() {
  document.getElementById('voorwaardenModal').style.display = 'none';
};

window.doChangePassword = async function() {
  const nieuw   = document.getElementById('cpNieuw').value;
  const herhaal = document.getElementById('cpHerhaal').value;
  const err     = document.getElementById('cpError');
  err.style.display = 'none';

  const fout = valideerWachtwoord(nieuw);
  if (fout) { err.textContent = fout; err.style.display = 'block'; return; }
  if (nieuw !== herhaal) { err.textContent = 'Wachtwoorden komen niet overeen'; err.style.display = 'block'; return; }

  const btn = document.getElementById('cpBtn');
  btn.disabled = true;
  btn.textContent = 'Bezig…';

  try {
    await updatePassword(state.user, nieuw);
    await updateDoc(doc(db, 'gebruikers', state.user.uid), { wachtwoord_gewijzigd: true });
    document.getElementById('change-password').style.display = 'none';
    startApp();
  } catch (e) {
    err.textContent = vertalFirebaseFout(e.code) || e.message;
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Opslaan en doorgaan';
  }
};

window.kopieerLink = async function(link) {
  try {
    await navigator.clipboard.writeText(link);
    meld('Link gekopieerd', 'De link staat op het klembord.');
  } catch (e) {
    meld('Kopiëren mislukt', 'Selecteer de link handmatig.');
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
  window.zorgIndelingVenster(state.weekMaandag, plusDagen(state.weekMaandag, 6));
  render();
};

window.navigeerDag = function(delta) {
  const huidig = state.huidigeDatum || vandaagIso();
  state.huidigeDatum = plusDagen(huidig, delta);
  state.weekMaandag = mandagVanIso(state.huidigeDatum);
  window.zorgIndelingVenster(state.huidigeDatum);
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
  window.zorgIndelingVenster(state.weekMaandag, plusDagen(state.weekMaandag, 6));
  render();
};

window.springNaarBeheer = function(datum) {
  if (!magBeheerLezen()) return;
  state.huidigeDatum = datum;
  state.weekMaandag = mandagVanIso(datum);
  state.huidigeView = 'beh';
  window.zorgIndelingVenster(state.weekMaandag, plusDagen(state.weekMaandag, 6));
  render();
};

window.toonGebruikerSheet = function() {
  const p = state.profiel;
  const voornaam = p.naam?.split('.')[0] || p.email?.split('@')[0]?.split('.')[0] || '?';
  document.getElementById('sheetTitle').textContent = voornaam;
  document.getElementById('sheetSub').textContent = `Ingelogd als ${p.rol}`;
  document.getElementById('sheetBody').innerHTML = `
    <div class="summary"><div class="summary-label">Account</div><div class="summary-text">${voornaam}</div></div>
    <div class="summary"><div class="summary-label">Rol</div><div class="summary-text">${p.rol}</div></div>
    ${p.radioloog_id ? `<div class="summary"><div class="summary-label">Gekoppeld als radioloog</div><div class="summary-text">${p.radioloog_id}</div></div>` : ''}
    <div class="summary">
      <div class="summary-label">Meldingen</div>
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-top: 4px;">
        <div style="font-size: 13px;">
          Ongelezen dag-opmerkingen buiten deze week melden
          <div class="muted" style="font-size: 11px; margin-top: 2px;">
            Uit: alleen een balk in de week die je bekijkt. Aan: ook een teller
            op de Overzicht-tab voor alle dagen vanaf vandaag.
          </div>
        </div>
        <span class="toggle-switch ${state.meldenBuitenWeek ? 'aan' : ''}"
              style="flex-shrink: 0; margin-top: 2px;"
              onclick="window.toggleMeldenBuitenWeek()"></span>
      </div>
    </div>
    <button class="btn" style="width: 100%; margin-top: 1rem;" onclick="window.doLogout()">Uitloggen</button>
  `;
  openSheet();
};

// v3.32.0: persoonlijke voorkeur voor de tab-badge. Sheet wordt direct opnieuw
// opgebouwd zodat het schuifje meteen meebeweegt.
window.toggleMeldenBuitenWeek = async function() {
  await zetMeldenBuitenWeek(!state.meldenBuitenWeek);
  render();
  window.toonGebruikerSheet();
};

// ==== Tabs + user chip =======================================================

function renderTabs() {
  const tabs = [
    { id: 'beh', label: (() => {
      let label = 'Overzicht';
      const eigenRadId = state.profiel?.radioloog_id;
      if (eigenRadId && !magWijzigen()) {
        const n = (state.wijzigingen || []).length;
        if (n > 0) label += `<span class="tab-badge tab-badge-oranje">${n}</span>`;
      }
      // v3.32.0: tweede badge voor ongelezen dag-opmerkingen over álle weken
      // vanaf vandaag. Staat standaard uit; de gebruiker zet hem zelf aan in
      // zijn profiel. De blauwe kleur onderscheidt hem van de oranje badge
      // voor gewijzigde eigen roosterdagen.
      if (state.meldenBuitenWeek) {
        const nOpm = ongelezenOpmerkingenTotaal().length;
        if (nOpm > 0) label += `<span class="tab-badge tab-badge-opm">${nOpm}</span>`;
      }
      return label;
    })() },
    { id: 'rad', label: 'Radioloog' },
  ];
  if (window.TOON_JAAROVERZICHT) tabs.push({ id: 'jaa', label: 'Jaaroverzicht' });
  tabs.push({ id: 'afd', label: 'Afdeling' });
  tabs.push({ id: 'die', label: 'Dienst' });
  const rol = state.profiel?.rol;
  tabs.push({ id: 'act', label: 'Activiteit' });
  if (rol === 'radioloog' || magAlleWensenZien()) {
    let label = 'Wensen';
    if (magAlleWensenZien()) {
      const open = state.wensen.filter(w => (w.status || 'open') === 'open' && w.datum >= vandaagIso()).length;
      if (open > 0) label += `<span class="tab-badge">${open}</span>`;
    }
    tabs.push({ id: 'wen', label });
  }
  // Vakantie-tab: zichtbaar als gebruiker mag_vakantie heeft
  if (magVakantieZien()) tabs.push({ id: 'vak', label: 'Vakantie' });
  // Regels is samengevoegd in de Beheer-tab (onder Control). De Beheer-tab is
  // zichtbaar zodra de gebruiker gebruikers óf regels mag beheren.
  if (magGebruikersBeheren() || magRegelsBeheren()) tabs.push({ id: 'geb', label: 'Beheer' });

  document.getElementById('tabs').innerHTML = tabs.map(t => `
    <button class="tab ${t.id === state.huidigeView ? 'active' : ''}" onclick="window.showView('${t.id}')">${t.label}</button>
  `).join('');

  ['rad', 'jaa', 'afd', 'die', 'act', 'wen', 'vak', 'beh', 'geb'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.style.display = v === state.huidigeView ? 'block' : 'none';
  });
}

function renderUserChip() {
  const el = document.getElementById('userChip');
  if (!el || !state.profiel) return;
  const p = state.profiel;
  const rad = p.radioloog_id ? radiologenMap()[p.radioloog_id] : null;
  const naam = rad ? rad.code : (p.naam?.split('.')[0] || p.email?.split('@')[0]?.split('.')[0] || '?');
  el.textContent = `${naam} · ${p.rol}`;
}

// ==== Render-dispatcher ======================================================

function render() {
  renderUserChip();
  renderTabs();
  if      (state.huidigeView === 'rad') renderRadView();
  else if (state.huidigeView === 'jaa') renderJaaView();
  else if (state.huidigeView === 'afd') renderAfdView();
  else if (state.huidigeView === 'die') renderDieView();
  else if (state.huidigeView === 'act') renderActView();
  else if (state.huidigeView === 'wen') renderWenView();
  else if (state.huidigeView === 'vak') renderVakView();
  else if (state.huidigeView === 'beh') renderBehView();
  else if (state.huidigeView === 'reg') { state.huidigeView = 'geb'; renderGebView(); }
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

// ==== Indeling-datumvenster (v3.29.0, H2) ====================================
// De indeling-collectie groeit onbegrensd (één doc per dag, jaar na jaar).
// In plaats van de hele collectie te streamen, abonneren we op een datum-
// venster: standaard vorig t/m volgend kalenderjaar. Navigeert de gebruiker
// (of een functie) buiten dat bereik, dan breidt het venster automatisch uit
// en her-abonneert de listener. Eerder geladen docs buiten het venster
// blijven in de cache staan (historisch, praktisch read-only); binnen het
// venster is de realtime snapshot leidend, inclusief verwijderingen.

let _indelingUnsub = null;
const _indelingLogoutUnsub = () => {
  if (_indelingUnsub) { _indelingUnsub(); _indelingUnsub = null; }
};

function standaardVensterVan() { return `${new Date().getFullYear() - 1}-01-01`; }
function standaardVensterTot() { return `${new Date().getFullYear() + 1}-12-31`; }

// Abonneer (of her-abonneer) op [vanIso .. totIso]. Returnt een Promise die
// vervult zodra de eerste snapshot binnen is — awaiten vóór berekeningen die
// de volledige indelingMap in dit bereik nodig hebben.
function abonneerIndeling(vanIso, totIso) {
  return new Promise((resolve, reject) => {
    if (_indelingUnsub) { _indelingUnsub(); _indelingUnsub = null; }
    // Logout-hook eenmalig (per sessie) registreren
    if (!state.unsubscribers.includes(_indelingLogoutUnsub)) {
      state.unsubscribers.push(_indelingLogoutUnsub);
    }
    state.indelingVenster = { van: vanIso, tot: totIso };
    let eerste = true;
    const q = query(
      collection(db, 'indeling'),
      where('datum', '>=', vanIso),
      where('datum', '<=', totIso)
    );
    _indelingUnsub = onSnapshot(q, (snap) => {
      const map = {};
      Object.entries(state.indelingMap || {}).forEach(([k, v]) => {
        if (k < vanIso || k > totIso) map[k] = v; // behoud buiten venster
      });
      snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() }; });
      state.indelingMap = map;
      render();
      if (eerste) { eerste = false; resolve(); }
    }, (e) => {
      luisteraarFout('indeling')(e);
      // v3.34.0: zonder dit bleef wie op het venster wachtte (de import
      // bijvoorbeeld) eeuwig hangen. Afwijzen, niet vervullen: de import
      // vergelijkt anders tegen een onvolledig rooster.
      if (eerste) { eerste = false; reject(e); }
    });
  });
}

// Zorg dat het venster (minimaal) de opgegeven datums dekt. Afgerond op hele
// kalenderjaren zodat her-abonneren zelden nodig is. Returnt Promise die
// vervult zodra de data beschikbaar is (direct als het venster al dekt).
window.zorgIndelingVenster = function(vanIso, totIso) {
  if (!vanIso && !totIso) return Promise.resolve();
  const a = vanIso || totIso;
  const b = totIso || vanIso;
  const doelVan = `${(a < b ? a : b).slice(0, 4)}-01-01`;
  const doelTot = `${(a > b ? a : b).slice(0, 4)}-12-31`;
  const huidig = state.indelingVenster;
  if (huidig && huidig.van <= doelVan && huidig.tot >= doelTot) return Promise.resolve();
  const nieuwVan = (huidig && huidig.van < doelVan) ? huidig.van : doelVan;
  const nieuwTot = (huidig && huidig.tot > doelTot) ? huidig.tot : doelTot;
  return abonneerIndeling(nieuwVan, nieuwTot);
};

// Variant voor bulk-operaties die ALLE data vanaf een datum nodig hebben
// (stoel-migraties, impact-previews): bepaalt eerst de laatste datum die in
// Firestore bestaat en breidt het venster tot daar uit.
window.zorgIndelingVensterTotEinde = async function(vanafIso) {
  let maxDatum = null;
  try {
    const snap = await getDocs(query(collection(db, 'indeling'), orderBy('datum', 'desc'), limit(1)));
    if (!snap.empty) maxDatum = snap.docs[0].data().datum || snap.docs[0].id;
  } catch (e) { /* val terug op standaard venster-uitbreiding */ }
  const tot = (maxDatum && maxDatum > standaardVensterTot()) ? maxDatum : standaardVensterTot();
  return window.zorgIndelingVenster(vanafIso || vandaagIso(), tot);
};

// v3.34.0: vangnet voor de luisteraars. Tot nu toe had alleen die voor
// opmerking_gelezen er een. Brak een verbinding af — rechten gewijzigd,
// account uitgezet, sessie ingetrokken — dan bleef het scherm een oud rooster
// tonen dat er actueel uitzag, zonder enige melding.
// Zonder verbinding breekt een luisteraar NIET af (dan levert hij uit de
// voorraad en wacht hij); dit gaat dus alleen af bij een echte weigering.
function luisteraarFout(naam) {
  return (e) => {
    console.error('luisteraar ' + naam, e);
    meldReden(e);
    // Even wachten: bij uitloggen of een verlopen sessie komt de afmelding
    // vlak na de weigering binnen. Dan staat het appscherm niet meer open en
    // is er niets te melden.
    setTimeout(() => {
      const app = document.getElementById('app');
      if (!_appGestart || !app || app.style.display === 'none') return;
      const code = (e && e.code) ? ` (${e.code})` : '';
      toonBalk('luisteraar', 'Het rooster wordt niet meer bijgewerkt' + code + '.',
        { label: 'Herladen', actie: () => location.reload() });
    }, 1500);
  };
}

function luisterNaarData() {
  // render() mag pas lopen als functies geladen zijn (kleuren nodig voor weergave)
  let functiesGeladen = false;

  state.unsubscribers.push(onSnapshot(collection(db, 'radiologen'), (snap) => {
    _gegevensBinnen = true;
    verbergGeenGegevensMelding();
    state.radiologen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!state.huidigeRadId) {
      state.huidigeRadId = state.profiel?.radioloog_id && isVasteStoel(state.profiel.radioloog_id)
        ? state.profiel.radioloog_id
        : VASTE_RAD_IDS[0];
    }
    if (functiesGeladen) render();
  }, luisteraarFout('radiologen')));

  state.unsubscribers.push(onSnapshot(collection(db, 'functies'), (snap) => {
    state.functies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    window.injecteerNieuweKleuren(state.functies);
    functiesGeladen = true;
    render();
  }, luisteraarFout('functies')));

  state.unsubscribers.push(onSnapshot(collection(db, 'besprekingen'), (snap) => {
    state.besprekingen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }, luisteraarFout('besprekingen')));

  // v3.29.0 (H2): de indeling-listener is begrensd op een datumvenster
  // (standaard: vorig t/m volgend kalenderjaar) i.p.v. de hele collectie.
  // Het venster breidt automatisch uit zodra ergens in de app een datum
  // buiten het bereik nodig is (zie zorgIndelingVenster hieronder).
  abonneerIndeling(standaardVensterVan(), standaardVensterTot());

  state.unsubscribers.push(onSnapshot(collection(db, 'validatie_regels'), (snap) => {
    state.validatieRegels = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, luisteraarFout('validatie_regels')));

  state.unsubscribers.push(onSnapshot(collection(db, 'instellingen'), (snap) => {
    state.instellingen = {};
    snap.docs.forEach(d => {
      const data = d.data();
      Object.assign(state.instellingen, data);  // spiegel alles (incl. migratie-vlaggen)
      if (data.dect_speciaal)      window.DECT_SPECIAAL = data.dect_speciaal;
      if (data.tellen_codes)       window.TELLEN_CODES = data.tellen_codes;
      if (data.mtsdagen_codes)     window.MTSDAGEN_CODES = data.mtsdagen_codes;
      if (data.toon_jaaroverzicht !== undefined) window.TOON_JAAROVERZICHT = data.toon_jaaroverzicht;
    });
    render();
  }, luisteraarFout('instellingen')));

  state.unsubscribers.push(onSnapshot(collection(db, 'wensen'), (snap) => {
    state.wensen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, luisteraarFout('wensen')));

  state.unsubscribers.push(onSnapshot(collection(db, 'vakantie_rankings'), (snap) => {
    state.vakantieRankings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, luisteraarFout('vakantie_rankings')));

  // Ongelezen wijzigingen: gefilterde query op eigen radioloog_id + gezien===false.
  // Volledige collectie-scan werkt niet: Firestore verwerpt de query zodra er
  // ook docs zijn die de radioloog niet mag lezen.
  const eigenRadId = state.profiel?.radioloog_id;
  if (eigenRadId && !magWijzigen()) {
    const wijzQuery = query(
      collection(db, 'wijzigingen'),
      where('radioloog_id', '==', eigenRadId),
      where('gezien', '==', false)
    );
    state.unsubscribers.push(onSnapshot(wijzQuery, (snap) => {
      const vandaag = vandaagIso();
      state.wijzigingen = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(w => w.datum >= vandaag);
      render();
    }, luisteraarFout('wijzigingen')));
  } else {
    state.wijzigingen = [];
  }

  // v3.32.0: privé leesstatus van dag-opmerkingen (één doc per gebruiker).
  // Bestaat het document nog niet, dan blijft de map leeg en gelden álle
  // bestaande dag-opmerkingen vanaf vandaag als ongelezen — bewust, zodat er
  // niets stilzwijgend wordt weggeklikt. De balk toont er nooit meer dan zeven
  // tegelijk, want die kijkt alleen naar de zichtbare week.
  if (state.user?.uid) {
    state.unsubscribers.push(onSnapshot(
      doc(db, 'opmerking_gelezen', state.user.uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        state.opmerkingGelezen = data.gelezen || {};
        state.meldenBuitenWeek = data.melden_buiten_week === true;
        state.opmerkingGelezenGeladen = true;
        render();
      },
      (e) => {
        console.error('opmerking_gelezen listener', e);
        state.opmerkingGelezenGeladen = true;
      }
    ));
  }
}

// ==== App starten (na eventuele wachtwoord-wissel) ===========================

// ==== Dynamische kleuren voor nieuwe functies ================================
// Voegt alleen CSS-klassen toe voor functies die nog geen .f-X klasse hebben.
// Bestaande hardcoded kleuren in index.html worden nooit overschreven.

window.injecteerNieuweKleuren = function(functies) {
  let styleEl = document.getElementById('functie-kleuren-extra');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'functie-kleuren-extra';
    document.head.appendChild(styleEl);
  }

  const regels = (functies || [])
    .filter(f => f.kleur && (f.code || f.id))
    .map(f => {
      const code = f.code || f.id;
      // v3.30.0 (M2): CSS-injectie-bewaking — een code die geen geldige
      // CSS-klassenaam is (alleen letters/cijfers/punt/underscore/streepje)
      // wordt overgeslagen i.p.v. rauw in het <style>-element te belanden.
      if (!/^[A-Za-z0-9._-]+$/.test(String(code))) return '';
      const hex = f.kleur.replace('#', '');
      if (hex.length !== 6) return '';
      const r = parseInt(hex.slice(0,2), 16);
      const g = parseInt(hex.slice(2,4), 16);
      const b = parseInt(hex.slice(4,6), 16);
      const bg = f.kleur;
      // Tekstkleur: donker op lichte achtergrond, licht op donkere achtergrond
      const helderheid = (r * 299 + g * 587 + b * 114) / 1000;
      const tekst = helderheid > 160 ? '#1a1a18' : '#ffffff';
      return `.f-${code} { background: ${bg}; color: ${tekst}; }`;
    })
    .filter(Boolean);

  // Dedupliceer — laatste wint
  const gezien = new Set();
  const uniek = [];
  for (const r of regels) {
    const cls = r.match(/\.f-\S+/)?.[0];
    if (cls && !gezien.has(cls)) { gezien.add(cls); uniek.push(r); }
  }

  styleEl.textContent = uniek.join('\n');
};


function startApp() {
  toonScherm('app', 'block');
  state.huidigeDatum = vandaagIso();
  state.weekMaandag = mandagVanIso(state.huidigeDatum);
  state.huidigeView = 'beh';
  renderTabs();
  luisterNaarData();
  _appGestart = true;
  if (!navigator.onLine) toonAantekeningBalk();
  stap('app gestart');
}

// ==== Boot ===================================================================

// Omgevings-bewaking (fail-safe). De omgeving is in config.js uit de URL bepaald.
// - 'unknown': blokkeer de app volledig zodat er nooit per ongeluk naar een
//   database geschreven wordt.
// - 'test': toon een opvallende balk zodat je altijd ziet dat je in test zit.
(function omgevingBewaking() {
  const env = window.APP_ENV || 'unknown';
  if (env === 'unknown') {
    document.body.innerHTML =
      '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;'
      + 'background:#7a1414;color:#fff;font-family:system-ui,sans-serif;padding:24px;text-align:center;z-index:99999;">'
      + '<div><h1 style="margin:0 0 12px;">Omgeving niet herkend</h1>'
      + '<p style="max-width:520px;margin:0 auto;line-height:1.5;">Deze app draait niet op een herkende URL '
      + '(<b>/Rooster/</b> of <b>/Rooster-test/</b>) en is daarom geblokkeerd, om te voorkomen dat er per '
      + 'ongeluk naar de verkeerde database wordt geschreven.</p></div></div>';
    throw new Error('Onbekende omgeving — app geblokkeerd.');
  }
  if (env === 'test') {
    const bar = document.createElement('div');
    bar.textContent = '⚠ TESTOMGEVING — schrijft naar de test-database (' + (window.APP_VERSIE || '') + ')';
    bar.style.cssText = 'position:sticky;top:0;z-index:9999;background:#d9760a;color:#fff;'
      + 'font-family:system-ui,sans-serif;font-weight:600;font-size:13px;text-align:center;padding:6px 10px;';
    document.body.insertBefore(bar, document.body.firstChild);
  }
})();

document.getElementById('versieLabel').textContent = window.APP_VERSIE;
// Versielabel ook in het change-password scherm
document.querySelectorAll('.versieLabel2').forEach(el => el.textContent = window.APP_VERSIE);

// ==== Opstarten na aanmelding (v3.33.4) ======================================
// Een verbindingsfout bij het opstarten is GEEN reden om uit te loggen. Offline
// kan er niet opnieuw ingelogd worden — daarvoor is de server nodig — dus een
// signOut() hier maakt de app onbruikbaar tot er weer internet is, terwijl het
// rooster nog op het toestel staat. Uitloggen doen we alleen als er echt iets
// met het account aan de hand is (bijvoorbeeld: geen profiel).
function isVerbindingsFout(e) {
  const code  = (e && e.code)    ? String(e.code) : '';
  const tekst = (e && e.message) ? String(e.message).toLowerCase() : '';
  return code === 'unavailable'
      || code === 'auth/network-request-failed'
      || tekst.includes('offline')
      || tekst.includes('network error')
      || tekst.includes('failed to fetch');
}

let _opstartUser = null;
let _wachtOpVerbinding = false;
let _aanmeldingBeantwoord = false;
let _appGestart = false;

// v3.33.5: één plek die bepaalt wat er te zien is. Het laadsymbool verdween
// vroeger meteen aan het begin van de aanmeldcontrole — dus vóórdat bekend was
// wát er getoond moest worden. Ging het daarna mis, dan bleef er een leeg wit
// scherm over zonder enige uitleg (iPhone, offline, 29 september 2026). Nu
// blijft het laadsymbool staan tot hier een scherm gekozen wordt, en weet het
// vangnet in index.html dat het niet meer hoeft in te grijpen.
// v3.33.9: een smalle balk zolang de app op de aantekening draait. Zonder die
// balk is niet te zien of je naar actuele gegevens kijkt, en bij een rooster is
// dat geen detail. Hij hangt aan de verbinding, niet aan Firebase: ook als
// Firebase alsnog antwoordt, is er dan nog steeds geen verbinding.
let _gegevensBinnen = false;

// v3.33.10: draait de app op de aantekening en komt er niets uit de voorraad,
// dan bleef het scherm leeg zonder uitleg. Gemeten: zolang de aanmeldcontrole
// zwijgt doet Firestore helemaal niets — ook zijn eigen voorraad niet lezen, en
// zelfs zonder foutmelding. Een scherm dat niets doet moet dat zeggen.
function toonGeenGegevensMelding() {
  if (document.getElementById('geen-gegevens')) return;
  const app = document.getElementById('app');
  if (!app) return;
  const blok = document.createElement('div');
  blok.id = 'geen-gegevens';
  blok.className = 'empty-state';
  blok.style.cssText = 'padding:24px 16px;text-align:center;';

  const tekst = document.createElement('div');
  tekst.textContent = 'Geen verbinding, en de opgeslagen gegevens op dit toestel '
    + 'zijn niet bereikbaar. Het rooster kan daardoor niet getoond worden.';
  blok.appendChild(tekst);

  // v3.33.11: de uitkomst van de opslagproef stond alleen op het scherm "Geen
  // verbinding" — en juist als de app wél opstart komt niemand daar. Hij hoort
  // hier, want dit is het scherm dat je dan te zien krijgt.
  const opslag = document.createElement('div');
  opslag.className = 'muted';
  opslag.style.cssText = 'margin-top:12px;';
  // v3.33.14: de proef heeft nu meer stappen en kan nog lopen als deze melding
  // verschijnt. Bijwerken tot hij klaar is, anders blijft er een halve uitkomst.
  const zetOpslag = () => {
    opslag.textContent = 'opslag op dit toestel: '
      + (typeof window.__idbProef === 'undefined' ? 'onbekend' : window.__idbProef);
    // Niet controleren of de regel al in beeld staat: bij de eerste keer is
    // hij nog niet toegevoegd, en dan zou het bijwerken meteen stoppen.
    if (window.__idbProefKlaar === false) {
      setTimeout(zetOpslag, 500);
    }
  };
  zetOpslag();
  blok.appendChild(opslag);

  // v3.33.15: wat Firebase zelf deed bij het opstarten, bijgewerkt zolang de
  // melding staat. Dit is de meting die de volgende stap bepaalt.
  if (typeof window.__spoorTekst === 'function') {
    const spoor = document.createElement('div');
    spoor.className = 'muted';
    spoor.style.cssText = 'margin-top:6px;word-break:break-word;';
    blok.appendChild(spoor);
    window.__houdBij(spoor, () => 'spoor: ' + window.__spoorTekst());
  }

  // v3.33.13: welke inlogverzoeken zijn afgebroken? Blijft het rooster ondanks
  // die maatregel leeg, dan zegt deze regel of de maatregel überhaupt heeft
  // ingegrepen — zonder dat is de volgende stap weer gissen.
  if (window.__afgebroken && window.__afgebroken.length) {
    const afg = document.createElement('div');
    afg.className = 'muted';
    afg.style.cssText = 'margin-top:6px;';
    afg.textContent = 'afgebroken inlogverzoeken: ' + window.__afgebroken.join(', ');
    blok.appendChild(afg);
  }

  app.insertBefore(blok, app.firstChild);
}

function verbergGeenGegevensMelding() {
  const blok = document.getElementById('geen-gegevens');
  if (blok) blok.remove();
}

// v3.34.0: de balk staat nu in statusbalk.js en verschijnt ook als de
// verbinding wegvalt terwijl de app al openstaat. Tot nu toe kwam hij alleen
// bij opstarten zonder verbinding, en zag een beheerder die onderweg de
// verbinding verloor niets. Wijzigen is dan geblokkeerd (schrijven.js), dus
// dat staat er ook bij.
function toonAantekeningBalk() {
  toonBalk('verbinding', 'Geen verbinding — laatst bekende rooster. Wijzigen kan even niet.');
}

function verbergAantekeningBalk() {
  verbergBalk('verbinding');
}

// Komt de verbinding terug, dan mag de balk weg.
window.addEventListener('online', verbergAantekeningBalk);
// Valt hij weg terwijl de app openstaat, dan komt de balk terug.
window.addEventListener('offline', () => { if (_appGestart) toonAantekeningBalk(); });

function toonScherm(id, weergave) {
  ['login', 'change-password', 'app', 'geen-verbinding'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = (s === id) ? (weergave || 'flex') : 'none';
  });
  const laad = document.getElementById('loading');
  if (laad) laad.style.display = 'none';
  window.__schermGetoond = true;
}

// Geef de reden door aan het vangnet, zodat hij onder de melding komt te staan.
// Zonder dit zou er "geen antwoord" staan terwijl de echte oorzaak bekend was.
function meldReden(e) {
  if (typeof window.__meldReden === 'function') window.__meldReden(e);
}

function toonGeenVerbinding(user) {
  _opstartUser = user || _opstartUser;
  const reden = document.getElementById('gvReden');
  if (reden && typeof window.__redenTekst === 'function') {
    reden.textContent = window.__redenTekst();
  }
  toonScherm('geen-verbinding');

  // Komt de verbinding terug, dan gaat de app zelf verder — zonder dat iemand
  // op een knop hoeft te drukken.
  if (!_wachtOpVerbinding) {
    _wachtOpVerbinding = true;
    window.addEventListener('online', () => {
      _wachtOpVerbinding = false;
      if (_opstartUser) opstarten(_opstartUser);
    }, { once: true });
  }
}

// Vervangt de eenvoudige knop uit het vangnet in index.html: opnieuw proberen
// zonder de hele app opnieuw op te laten starten. Is er geen gebruiker bekend,
// dan is opnieuw laden het enige zinnige.
window.gvOpnieuw = async () => {
  document.getElementById('geen-verbinding').style.display = 'none';
  document.getElementById('loading').style.display = 'flex';
  if (_opstartUser) await opstarten(_opstartUser);
  else location.reload();
};

async function opstarten(user) {
  _opstartUser = user;
  try {
    stap('profiel opvragen');
    const profiel = await laadProfiel(user.uid);
    stap('profiel binnen');
    state.user = user;
    state.profiel = profiel;
    onthoudToestelGebruiker(user, profiel);

    if (profiel.wachtwoord_gewijzigd === false) {
      // Eerste aanmelding: wachtwoord wijzigen + akkoord
      toonScherm('change-password');
      window.cpValideer();
    } else {
      // v3.33.5: gaat het opstarten van de app zelf mis, dan verdween dat tot
      // nu toe spoorloos — het appscherm stond al zichtbaar, maar leeg.
      try {
        startApp();
      } catch (e) {
        meldReden(e);
        toonGeenVerbinding(user);
      }
    }
  } catch (e) {
    meldReden(e);
    if (isVerbindingsFout(e) || !navigator.onLine) {
      toonGeenVerbinding(user);
      return;
    }
    const err = document.getElementById('loginError');
    err.textContent = e.message;
    err.style.display = 'block';
    await signOut(auth);
  }
}

stap('aanmeldcontrole gestart');
onAuthStateChanged(auth, async (user) => {
  _aanmeldingBeantwoord = true;
  if (!user) {
    // Firebase heeft het laatste woord: zegt hij dat er niemand is, dan is er
    // niemand — ook als de app al op de aantekening was gestart.
    stap('niemand ingelogd');
    // v3.34.0: draaide de app al (op de aantekening), dan staan de luisteraars
    // nog open. Zonder inlogbewijs weigert de databank ze, en dat zou hier als
    // "rooster wordt niet meer bijgewerkt" op het inlogscherm verschijnen.
    state.unsubscribers.forEach(fn => fn());
    state.unsubscribers = [];
    verbergBalk('luisteraar');
    // v3.34.1: ook vergeten dát de app draaide en voor wie. Bleef dit staan,
    // dan zag het opnieuw inloggen "zelfde gebruiker, app draait al" en sloeg
    // het opstarten over: wie uitlogde en meteen weer inlogde, bleef op het
    // inlogscherm hangen tot de app helemaal werd afgesloten (sinds v3.33.8;
    // gemeten op v3.33.16 in de oefendatabank, 1 oktober 2026).
    _appGestart = false;
    _opstartUser = null;
    state.user = null;
    state.profiel = null;
    vergeetToestelGebruiker();
    verbergAantekeningBalk();
    toonScherm('login');
    return;
  }
  stap('gebruiker bekend');
  if (_appGestart && state.user && state.user.uid === user.uid) {
    // De app draaide al op de aantekening en het is dezelfde persoon: niet
    // opnieuw opstarten, alleen de echte gebruiker erin zetten (die heeft een
    // geldig inlogbewijs, de aantekening niet).
    state.user = user;
    if (navigator.onLine) verbergAantekeningBalk();
    stap('aanmeldcontrole alsnog beantwoord');
    return;
  }
  await opstarten(user);
});

// ==== Meteen het rooster, dan pas de verbinding (v3.33.9) ===================
// In v3.33.8 wachtte de app eerst 6 seconden, en deed hij níets als het toestel
// zei dat het verbinding had terwijl er in werkelijkheid niets doorkwam. Op een
// iPhone gaf dat één keer een rooster en de keer erna niets. Beide gaten zijn
// hier dicht: de gegevens komen in ongeveer 20 milliseconden uit de voorraad,
// dus er valt niets te wachten.
function startOpAantekening(hoe) {
  if (_aanmeldingBeantwoord || _appGestart) return false;
  const g = toestelGebruiker();
  if (!g) {
    stap(hoe + '; dit toestel kent geen eerdere gebruiker');
    return false;
  }
  stap(hoe + '; verder op de aantekening van dit toestel');
  // Een plaatsvervanger: de app gebruikt hiervan alleen uid en e-mail. Er is
  // bewust géén inlogbewijs — schrijven kan pas als de server het goedkeurt,
  // en daar gelden de toegangsregels onverkort.
  const plaatsvervanger = { uid: g.uid, email: g.email || g.profiel.email || null };
  state.user = plaatsvervanger;
  state.profiel = g.profiel;
  _opstartUser = plaatsvervanger;
  try {
    startApp();
    toonAantekeningBalk();
    setTimeout(() => {
      if (_gegevensBinnen) return;
      stap('op de aantekening gestart, maar geen gegevens uit de voorraad');
      toonGeenGegevensMelding();
    }, 4000);
    return true;
  } catch (e) {
    meldReden(e);
    toonGeenVerbinding(plaatsvervanger);
    return false;
  }
}

// 1. Meldt het toestel dat er geen verbinding is: meteen beginnen.
if (!navigator.onLine) startOpAantekening('geen verbinding gemeld');

// 2. Meldt het toestel wél verbinding maar zwijgt de aanmeldcontrole, dan is er
//    iets anders mis — een telefoon die denkt online te zijn terwijl er niets
//    doorkomt. Normaal antwoordt Firebase binnen een halve seconde, dus na drie
//    seconden mogen we ervan uitgaan dat er geen antwoord meer komt.
//    ⚠ Bewust geen keuze op apparaatsoort: een iPad meldt zich als desktop, en
//    "toon desktopversie" doet hetzelfde op een telefoon.
setTimeout(() => { startOpAantekening('aanmeldcontrole zweeg'); }, 3000);
