// Tabblad Indelen (v3.36.0): indelen zoals in Excel, met een concept.
//
// Waarom: de indeler maakt het rooster in Excel, omdat hij daar een hele
// periode ziet, codes direct intypt en blokken kopieert. In de app ging dat
// cel voor cel via een venster. Dit tabblad doet het zoals Excel:
//   - het hele jaar onder elkaar, dezelfde kolommen en hulpkolommen als het
//     Excel-bestand (kolommen.js, gedeeld met de export);
//   - typen in de cel; Enter, Tab en de pijltjes; Delete maakt leeg;
//     kopiëren en plakken (ook uit en naar Excel); Ctrl+Z maakt ongedaan;
//   - wensen, vakantieplanning en regelconflicten zichtbaar in de cel.
// Wat hij typt is eerst een CONCEPT (concept.js): alleen beheerders zien het,
// het staat meteen in de databank en gaat pas met "Publiceren" het rooster in.
// Publiceren gebruikt precies dezelfde schrijfweg als de Excel-import
// (schrijfDagenWeg in import.js): terugdraai-punt, backup, meldingen, wensen.
//
// Alleen voor de rol beheerder (net als de import). Werkt op elk scherm
// (v3.36.1, besluit Sierk 30 okt): met muis en toetsenbord zoals Excel, met de
// vinger door te tikken — één tik kiest een cel, nog een tik opent het
// toetsenbord in de cel, Enter slaat op en gaat door naar de cel eronder.
import { doc, onSnapshot, deleteField } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { setDoc, deleteDoc, magSchrijven, controleerVerbinding } from '../schrijven.js';
import { db } from '../firebase-init.js';
import { state, DAGEN_NL } from '../state.js';
import {
  esc, fclass, vandaagIso, plusDagen, mandagVanIso, huidigKalenderJaar,
  bezettingOpDatum, isFeestdag, functieNaam,
} from '../helpers.js';
import { valideerWeek } from '../validatie.js';
import { meld, bevestig } from '../dialoog.js';
import { jaarKolommen, functieEisen, hulpKolommen } from '../kolommen.js';
import {
  EXTRA_KOLOMMEN, isExtraKolom, celSleutel, liveTekst, zichtbareTekst,
  conceptNaInvoer, indelingMetConcept, metIndelingMap, bouwPublicatie,
  leesKlembord, maakKlembord, splitsSleutel,
} from '../concept.js';
import {
  schrijfDagenWeg, valideerDagenTegenRegels, NABIJ_DAGEN,
} from '../import.js';
import {
  legVast, tel, schrijfactieBezig, zetSchrijfactie,
  laatsteTerugdraaiPunt, vergeetLaatstePunt,
} from '../logboek.js';
import { terugdraaiBlokHtml } from './gebruikers.js';

export const CONCEPT_COLLECTIE = 'indeling_concept';
const OPSLAAN_NA_MS = 400;    // wacht even met opslaan, zodat snel typen één schrijfactie wordt

// ---- Toestand van dit scherm --------------------------------------------------
const ui = {
  jaar: null,
  // concept = wat de databank heeft, met de nog niet bevestigde wijzigingen
  // (onderweg + wachtrij) erover heen. Dat is wat het raster toont.
  server: {},            // cellen zoals de databank ze laatst meldde
  meta: null,            // { bijgewerkt_door, bijgewerkt_lokaal }
  onderweg: {},          // naar de databank gestuurd, nog niet bevestigd
  wachtrij: {},          // nog te sturen (sleutel -> regel, null = weghalen)
  concept: {},
  conceptGeladen: false,
  conceptFout: null,
  conceptJaar: null,
  conceptUnsub: null,
  opslaanTimer: null,
  opslaanBezig: null,    // Promise zolang er een schrijfactie loopt
  ongedaan: [],          // stapel acties: [{ sleutel, voor, na }]
  // raster
  kolommen: [],          // bewerkbare kolommen: { id, header, titel, extra }
  datums: [],
  td: [],                // td[r][c] na elke tekening
  actief: { r: 0, c: 0 },
  anker: { r: 0, c: 0 },
  slepen: false,
  bewerken: null,        // { r, c, modus: 'invoer' | 'wijzig', input }
  tekenGepland: false,
  uitgesteld: false,     // er kwam een hertekening binnen tijdens het typen
  publiceertBezig: false,
  vensterBezig: false,
  eersteKeer: true,
  gekozen: false,        // heeft de gebruiker zelf al een cel gekozen?
  aanwijzer: null,       // 'mouse' | 'touch' | 'pen' — hoe de laatste tik/klik kwam
};

function isBeheerder() { return state.profiel?.rol === 'beheerder'; }
function el(id) { return document.getElementById(id); }

// Het toetsenbord en het klembord lopen via een onzichtbaar tekstvak. Een
// gewoon vak (div) krijgt in Safari geen plak-gebeurtenis; een tekstvak in
// elke browser wel. Zolang dit vak de focus heeft, "luistert" het raster.
function vangFocus() {
  if (isAanraken()) return;
  const v = el('ind-vang');
  if (v && document.activeElement !== v) v.focus({ preventScroll: true });
}

// Werkt de gebruiker met de vinger? Dan geen onzichtbaar tekstvak (dat zou bij
// elke tik het schermtoetsenbord openen, en Android meldt daar de getypte
// letters niet betrouwbaar), maar typen in een echt vakje in de cel.
function isAanraken() {
  if (ui.aanwijzer) return ui.aanwijzer !== 'mouse';
  return !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
}

// ---- Concept: laden, bijwerken, opslaan ---------------------------------------

function _herberekenConcept() {
  const c = { ...ui.server };
  [ui.onderweg, ui.wachtrij].forEach(laag => {
    Object.entries(laag).forEach(([k, v]) => { if (v) c[k] = v; else delete c[k]; });
  });
  ui.concept = c;
}

function _stopConcept() {
  if (ui.conceptUnsub) { ui.conceptUnsub(); ui.conceptUnsub = null; }
  ui.conceptJaar = null;
  ui.server = {}; ui.meta = null; ui.onderweg = {}; ui.wachtrij = {};
  ui.concept = {}; ui.conceptGeladen = false; ui.conceptFout = null;
  ui.ongedaan = [];
}

function _volgConcept(jaar) {
  if (ui.conceptJaar === jaar && ui.conceptUnsub) return;
  _stopConcept();
  ui.conceptJaar = jaar;
  // Bij uitloggen moet deze luisteraar ook weg (main.js roept ze allemaal aan).
  if (!state.unsubscribers.includes(_stopConcept)) state.unsubscribers.push(_stopConcept);
  ui.conceptUnsub = onSnapshot(doc(db, CONCEPT_COLLECTIE, String(jaar)), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    ui.server = data.cellen || {};
    ui.meta = snap.exists()
      ? { door: data.bijgewerkt_door || '', wanneer: data.bijgewerkt_lokaal || '' }
      : null;
    ui.conceptGeladen = true;
    ui.conceptFout = null;
    _herberekenConcept();
    planTekenen();
  }, (e) => {
    console.error('indeling_concept', e);
    ui.conceptFout = (e && (e.code || e.message)) || 'onbekend';
    ui.conceptGeladen = true;
    planTekenen();
  });
}

function _planOpslaan() {
  clearTimeout(ui.opslaanTimer);
  ui.opslaanTimer = setTimeout(() => { slaConceptOp(); }, OPSLAAN_NA_MS);
}

// Stuurt de wachtrij in één schrijfactie naar de databank. Wacht eerst op een
// vorige schrijfactie, zodat de volgorde klopt.
async function slaConceptOp() {
  clearTimeout(ui.opslaanTimer);
  if (ui.opslaanBezig) { await ui.opslaanBezig; }
  if (!Object.keys(ui.wachtrij).length) return;
  const jaar = ui.conceptJaar;
  const teSturen = ui.wachtrij;
  ui.wachtrij = {};
  ui.onderweg = { ...ui.onderweg, ...teSturen };
  const cellen = {};
  Object.entries(teSturen).forEach(([k, v]) => { cellen[k] = v ? v : deleteField(); });
  tekenStatus();
  ui.opslaanBezig = (async () => {
    try {
      await setDoc(doc(db, CONCEPT_COLLECTIE, String(jaar)), {
        jaar: String(jaar),
        cellen,
        bijgewerkt_door: state.profiel?.naam || state.profiel?.email || '',
        bijgewerkt_lokaal: new Date().toISOString(),
      }, { merge: true });
    } catch (e) {
      console.error('concept opslaan', e);
      // Wat niet aankwam, verdwijnt weer uit beeld: het scherm mag niet iets
      // tonen dat niet bewaard is.
      Object.keys(teSturen).forEach(k => { delete ui.onderweg[k]; });
      _herberekenConcept();
      planTekenen();
      await meld('Concept niet opgeslagen',
        `Je laatste wijziging${Object.keys(teSturen).length === 1 ? '' : 'en'} in het concept ` +
        `${Object.keys(teSturen).length === 1 ? 'is' : 'zijn'} niet bewaard en weer weggehaald.\n\n` +
        `Reden: ${e.message || e}`);
      return;
    } finally {
      ui.opslaanBezig = null;
    }
    Object.entries(teSturen).forEach(([k, v]) => { if (ui.onderweg[k] === v) delete ui.onderweg[k]; });
    _herberekenConcept();
    tekenStatus();
  })();
  await ui.opslaanBezig;
}

// Bij het sluiten van het venster: wat nog in de wachtrij staat meteen
// versturen. Firebase bewaart een verstuurde wijziging op het toestel tot hij
// aankomt, dus alleen de laatste 0,4 seconde kon nog verloren gaan.
window.addEventListener('pagehide', () => { if (Object.keys(ui.wachtrij).length) slaConceptOp(); });

// Verwerkt een lijst invoer [{ r, c, tekst }] in het concept.
// Geeft het aantal cellen terug dat echt veranderde.
function pasToe(lijst) {
  if (!magSchrijven()) {
    try { controleerVerbinding(); } catch (e) { /* venster staat al open */ }
    return 0;
  }
  const actie = [];
  lijst.forEach(({ r, c, tekst }) => {
    const datum = ui.datums[r];
    const kol = ui.kolommen[c];
    if (!datum || !kol) return;
    const { sleutel, voor, na } = conceptNaInvoer(ui.concept, state.indelingMap, datum, kol.id, tekst);
    if (JSON.stringify(voor) === JSON.stringify(na)) return;
    actie.push({ sleutel, voor, na });
    if (na) ui.concept[sleutel] = na; else delete ui.concept[sleutel];
    ui.wachtrij[sleutel] = na;
  });
  if (actie.length) {
    ui.ongedaan.push(actie);
    if (ui.ongedaan.length > 200) ui.ongedaan.shift();
    _planOpslaan();
    planTekenen();
  }
  return actie.length;
}

function maakOngedaan() {
  const actie = ui.ongedaan.pop();
  if (!actie) return;
  if (!magSchrijven()) {
    ui.ongedaan.push(actie);
    try { controleerVerbinding(); } catch (e) { /* venster staat al open */ }
    return;
  }
  actie.slice().reverse().forEach(({ sleutel, voor }) => {
    if (voor) ui.concept[sleutel] = voor; else delete ui.concept[sleutel];
    ui.wachtrij[sleutel] = voor;
  });
  // Selectie naar de eerste cel van de ongedaan gemaakte actie, zodat je ziet
  // wat er terugging.
  const { datum, kolomId } = splitsSleutel(actie[0].sleutel);
  const r = ui.datums.indexOf(datum);
  const c = ui.kolommen.findIndex(k => k.id === kolomId);
  if (r >= 0 && c >= 0) { ui.actief = { r, c }; ui.anker = { r, c }; }
  _planOpslaan();
  planTekenen();
}

// ---- Tekenen ------------------------------------------------------------------

export function renderIndView() {
  const container = el('view-ind');
  if (!container) return;

  if (!isBeheerder()) {
    container.innerHTML = '<div class="empty-state">Indelen is alleen voor beheerders.</div>';
    return;
  }
  if (!ui.jaar) ui.jaar = huidigKalenderJaar();
  const jaar = ui.jaar;

  // Het datumvenster van de rooster-luisteraar moet het hele jaar dekken.
  const venster = state.indelingVenster;
  const dekt = venster && venster.van <= `${jaar}-01-01` && venster.tot >= `${jaar}-12-31`;
  if (!dekt) {
    if (!ui.vensterBezig && window.zorgIndelingVenster) {
      ui.vensterBezig = true;
      window.zorgIndelingVenster(`${jaar}-01-01`, `${jaar}-12-31`)
        .catch(e => meld('Rooster niet geladen', String(e.message || e)))
        .finally(() => { ui.vensterBezig = false; planTekenen(); });
    }
    container.innerHTML = '<div class="empty-state">Rooster van ' + jaar + ' laden…</div>';
    container.dataset.skelet = '';
    return;
  }
  _volgConcept(jaar);

  // Het vaste kader (knoppen, schuifvak) één keer neerzetten; daarna alleen
  // de tabel en de status vervangen, zodat de schuifpositie en de focus blijven.
  if (container.dataset.skelet !== String(jaar)) {
    container.innerHTML = kaderHtml(jaar);
    container.dataset.skelet = String(jaar);
    koppelRaster();
    ui.eersteKeer = true;
  }
  if (ui.bewerken) { ui.uitgesteld = true; return; }
  tekenTabel();
  tekenStatus();
  tekenTerugdraaiBlok();
}

export function planTekenen() {
  if (ui.tekenGepland) return;
  ui.tekenGepland = true;
  requestAnimationFrame(() => {
    ui.tekenGepland = false;
    if (state.huidigeView !== 'ind') return;
    renderIndView();
  });
}

function kaderHtml(jaar) {
  return `
    <div class="ind-balk">
      <div class="ind-jaar">
        <button class="nav-btn" onclick="window.indJaar(-1)" title="Vorig jaar">‹</button>
        <span class="ind-jaartal">${jaar}</span>
        <button class="nav-btn" onclick="window.indJaar(1)" title="Volgend jaar">›</button>
      </div>
      <div id="ind-status" class="ind-status"></div>
      <div class="ind-knoppen">
        <button class="btn" id="ind-ongedaan" onclick="window.indOngedaan()" title="Ctrl+Z">↶ Ongedaan</button>
        <button class="btn" id="ind-weggooien" onclick="window.indConceptWeggooien()">Concept weggooien</button>
        <button class="btn btn-primary" id="ind-publiceer" onclick="window.indPubliceer()">Publiceren</button>
      </div>
    </div>
    <div class="ind-uitleg muted">
      <span class="ind-uitleg-pc">Klik een cel en typ een code (<b>E,M</b> = ochtend/middag). <b>Enter</b> omlaag, <b>Tab</b> naar rechts,
      pijltjes om te bewegen, <b>Shift</b> om een blok te kiezen. <b>Delete</b> maakt leeg,
      <b>Ctrl+C / Ctrl+V</b> kopieert en plakt (ook uit Excel), <b>Ctrl+Z</b> maakt ongedaan.</span>
      <span class="ind-uitleg-tik">Tik een cel om hem te kiezen, tik nog eens om te typen (<b>E,M</b> = ochtend/middag).
      <b>Enter</b> slaat op en gaat naar de cel eronder; ergens anders tikken slaat ook op.</span>
      <span class="ind-leg"><span class="ind-leg-concept"></span> concept</span>
      <span class="ind-leg"><span class="ind-leg-fout"></span> regelconflict</span>
      <span class="ind-leg"><span class="wens-marker wens-marker-open" style="position:static;display:inline-block;"></span> wens</span>
      <span class="ind-leg"><span class="ind-vak" style="position:static;">V</span> vakantieplanning</span>
    </div>
    <div id="ind-scroll" class="ind-scroll"></div>
    <textarea id="ind-vang" class="ind-vang" aria-label="Indeelraster: typ een code" autocomplete="off" spellcheck="false"></textarea>
    <div id="ind-terug"></div>
  `;
}

function tekenStatus() {
  const s = el('ind-status');
  if (!s) return;
  const n = Object.keys(ui.concept).length;
  const bezigMetOpslaan = Object.keys(ui.wachtrij).length || Object.keys(ui.onderweg).length;
  let tekst;
  if (ui.conceptFout) {
    tekst = `<span style="color:#9c0006;">Concept niet te lezen (${esc(ui.conceptFout)})</span>`;
  } else if (!ui.conceptGeladen) {
    tekst = 'Concept laden…';
  } else if (n === 0) {
    tekst = 'Geen concept — alles wat je typt wordt eerst concept.';
  } else {
    tekst = `<b>Concept: ${n} cel${n === 1 ? '' : 'len'}</b> · ${bezigMetOpslaan ? 'opslaan…' : 'opgeslagen'}`;
    const ik = state.profiel?.naam || state.profiel?.email || '';
    if (ui.meta && ui.meta.door && ui.meta.door !== ik) {
      tekst += ` · laatst gewijzigd door ${esc(ui.meta.door)}`;
    }
  }
  s.innerHTML = tekst;
  const pub = el('ind-publiceer');
  if (pub) {
    pub.disabled = n === 0 || ui.publiceertBezig || !ui.conceptGeladen;
    pub.textContent = ui.publiceertBezig ? 'Publiceren…' : (n ? `Publiceren (${n})` : 'Publiceren');
  }
  const weg = el('ind-weggooien');
  if (weg) weg.disabled = n === 0 || ui.publiceertBezig;
  const ond = el('ind-ongedaan');
  if (ond) ond.disabled = ui.ongedaan.length === 0;
}

// laatsteTerugdraaiPunt() onthoudt het punt zelf tot een import, publicatie of
// terugdraaiing het vergeet; dit kost dus geen leesactie per hertekening.
async function tekenTerugdraaiBlok() {
  let punt = null;
  try { punt = await laatsteTerugdraaiPunt(); } catch (e) { punt = null; }
  const vak = el('ind-terug');
  if (vak) vak.innerHTML = terugdraaiBlokHtml(punt);
}

// Alles wat per cel en per rij getoond wordt, in één keer berekend.
function berekenRaster(jaar) {
  const datums = [];
  for (let d = `${jaar}-01-01`; d <= `${jaar}-12-31`; d = plusDagen(d, 1)) datums.push(d);
  const dagen = datums.map(d => state.indelingMap[d]).filter(Boolean);
  const radKolommen = jaarKolommen(jaar, dagen);
  const kolommen = [
    ...radKolommen.map(k => ({ id: k.id, header: k.header, titel: k.notitie || '', extra: false })),
    ...EXTRA_KOLOMMEN.map(k => ({ id: k.id, header: k.header, titel: k.titel, extra: true })),
  ];

  // Regelcontrole op het rooster mét concept, met de gewone regels van de app.
  const map = indelingMetConcept(ui.concept, state.indelingMap);
  const celStatus = {}; // `${datum}|${radId}` -> { ernst, berichten[] }
  const dagFouten = {}; // datum -> berichten[] (blokkerend, hele dag)
  const dagMeldingen = {};
  metIndelingMap(map, () => {
    for (let ma = mandagVanIso(`${jaar}-01-01`); ma <= `${jaar}-12-31`; ma = plusDagen(ma, 7)) {
      valideerWeek(ma).forEach(cf => {
        if (cf.datum < `${jaar}-01-01` || cf.datum > `${jaar}-12-31`) return;
        if (cf.radId) {
          const k = `${cf.datum}|${cf.radId}`;
          const s = celStatus[k] || (celStatus[k] = { ernst: 'waarschuwing', berichten: [] });
          if (cf.ernst === 'blokkeren') s.ernst = 'blokkeren';
          s.berichten.push(cf.bericht);
        } else {
          (dagMeldingen[cf.datum] = dagMeldingen[cf.datum] || []).push(cf.bericht);
          if (cf.ernst === 'blokkeren') (dagFouten[cf.datum] = dagFouten[cf.datum] || []).push(cf.bericht);
        }
      });
    }
  });

  const wensen = {};
  (state.wensen || []).forEach(w => {
    if (!w.datum || !w.datum.startsWith(String(jaar))) return;
    wensen[`${w.datum}|${w.radioloog_id}`] = w;
  });

  return { datums, kolommen, radKolommen, celStatus, dagFouten, dagMeldingen, wensen, eisen: functieEisen() };
}

const WENS_TYPE = { vakantie: 'Vakantie', niet_beschikbaar: 'Niet beschikbaar', voorkeur: 'Voorkeur' };
const WENS_STATUS = { open: 'nog niet behandeld', verwerkt: 'goedgekeurd', afgewezen: 'afgewezen' };

function vakCode(waarde) {
  if (!waarde) return '';
  if (waarde === true) return 'V';
  if (typeof waarde === 'string') return waarde;
  if (typeof waarde === 'object' && waarde.code) return waarde.code;
  return '';
}

function tekenTabel() {
  const scroll = el('ind-scroll');
  if (!scroll) return;
  const jaar = ui.jaar;
  if (!(state.radiologen || []).length || !(state.functies || []).length) {
    scroll.innerHTML = '<div class="empty-state">Radiologen en functies laden…</div>';
    return;
  }
  const R = berekenRaster(jaar);
  ui.datums = R.datums;
  ui.kolommen = R.kolommen;
  _begrensSelectie();
  const sel = _selectie();
  const vandaag = vandaagIso();
  const nRad = R.radKolommen.length;

  const kop = `
    <tr>
      <th class="ind-dag ind-vast">Dag</th>
      <th class="ind-datum ind-vast2">Datum</th>
      ${R.kolommen.map((k, i) => `<th class="${i === nRad ? 'ind-scheiding' : ''}" title="${esc(k.titel || k.header)}">${esc(k.header)}</th>`).join('')}
      <th class="ind-scheiding" title="Werkvloerbezetting (zoals de kolom Aantal in Excel)">Aantal</th>
      ${R.eisen.functieLetters.map(l => `<th class="ind-ind" title="${esc(functieNaam(l) || l)} — staat hier als hij die dag nog ontbreekt">${esc(l)}</th>`).join('')}
    </tr>`;

  const rijen = R.datums.map((datum, r) => {
    const d = new Date(datum + 'T12:00:00');
    const dagIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;
    const weekend = dagIdx >= 5;
    const live = state.indelingMap[datum];
    const teksten = [];
    const cellen = R.kolommen.map((k, c) => {
      const sleutel = celSleutel(datum, k.id);
      const concept = ui.concept[sleutel];
      const tekst = zichtbareTekst(ui.concept, state.indelingMap, datum, k.id);
      if (!k.extra) teksten.push(tekst);
      const klassen = ['ind-cel'];
      const titels = [];
      let markers = '';
      if (!k.extra) {
        const eerste = tekst.split(',')[0];
        klassen.push(eerste ? fclass(eerste) : 'ind-leeg');
        const bez = bezettingOpDatum(k.id, datum);
        if (!bez) { klassen.push('ind-onbezet'); titels.push('Stoel op deze datum niet bezet'); }
        else if (bez.code && bez.code !== k.header) titels.push(`Op deze datum: ${bez.code}`);
        const st = R.celStatus[`${datum}|${k.id}`];
        if (st) {
          klassen.push(st.ernst === 'blokkeren' ? 'ind-fout' : 'ind-waarsch');
          titels.push(...st.berichten);
        }
        const wens = R.wensen[`${datum}|${k.id}`];
        if (wens) {
          const status = wens.status || 'open';
          markers += `<span class="wens-marker wens-marker-${esc(status)}"></span>`;
          titels.push(`Wens: ${WENS_TYPE[wens.type] || wens.type}${wens.voorkeur_code ? ' (' + wens.voorkeur_code + ')' : ''} — ${WENS_STATUS[status] || status}${wens.opmerking ? ' — ' + wens.opmerking : ''}`);
        }
        const vak = vakCode(live?.vakantie_v?.[k.id]);
        if (vak) { markers += `<span class="ind-vak">${esc(vak)}</span>`; titels.push(`Vakantieplanning: ${vak}`); }
        const opm = live?.cel_opmerkingen?.[k.id];
        if (opm) { markers += '<span class="opm-marker"></span>'; titels.push(`Opmerking: ${opm}`); }
      } else {
        klassen.push('ind-extra');
        if (c === nRad) klassen.push('ind-scheiding');
      }
      if (concept) {
        klassen.push('ind-concept');
        titels.unshift(`Concept — in het rooster: ${concept.was || '(leeg)'}`);
      }
      if (r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2) klassen.push('ind-sel');
      if (r === ui.actief.r && c === ui.actief.c) klassen.push('ind-actief');
      const titel = titels.length ? ` title="${esc(titels.join('\n'))}"` : '';
      return `<td class="${klassen.join(' ')}" data-r="${r}" data-c="${c}"${titel}>${esc(tekst)}${markers}</td>`;
    }).join('');

    const h = hulpKolommen(datum, teksten, R.eisen);
    const dagMeld = R.dagMeldingen[datum] || [];
    const dagFout = R.dagFouten[datum] || [];
    const feest = isFeestdag(datum);
    const rijKlassen = [weekend ? 'ind-weekend' : '', datum === vandaag ? 'ind-vandaag' : '', feest ? 'ind-feest' : ''].join(' ');
    const datumKlasse = h.tekort ? 'ind-tekort' : '';
    const aantalKlasse = h.werkdag ? (h.tekort ? 'ind-tekort' : 'ind-genoeg') : '';
    const dagTitel = [feest ? 'Feestdag' : '', live?.opmerking ? 'Opmerking: ' + live.opmerking : '', ...dagMeld].filter(Boolean).join('\n');
    return `
      <tr class="${rijKlassen}">
        <td class="ind-dag ind-vast"${dagTitel ? ` title="${esc(dagTitel)}"` : ''}>${DAGEN_NL[dagIdx]}${dagFout.length ? '<span class="ind-dagfout">!</span>' : ''}${live?.opmerking ? '<span class="opm-marker"></span>' : ''}</td>
        <td class="ind-datum ind-vast2 ${datumKlasse}">${datum.slice(8, 10)}-${datum.slice(5, 7)}<span class="ind-jj">-${datum.slice(0, 4)}</span></td>
        ${cellen}
        <td class="ind-aantal ind-scheiding ${aantalKlasse}">${h.aantal}</td>
        ${R.eisen.functieLetters.map(l => `<td class="ind-ind ${h.ontbrekend.includes(l) ? 'ind-ontbreekt' : ''}">${h.ontbrekend.includes(l) ? esc(l) : ''}</td>`).join('')}
      </tr>`;
  }).join('');

  scroll.innerHTML = `<table class="ind-tabel"><thead>${kop}</thead><tbody>${rijen}</tbody></table>`;

  // Snelle verwijzing naar elke bewerkbare cel (voor selectie zonder hertekenen).
  ui.td = [];
  scroll.querySelectorAll('td[data-c]').forEach(td => {
    const r = +td.dataset.r, c = +td.dataset.c;
    (ui.td[r] = ui.td[r] || [])[c] = td;
  });
  // De selectie staat al in de nieuwe tabel; onthoud díe cellen, anders blijft
  // een oude selectie blauw staan na de volgende muisklik.
  _vorigeSelectie = [...scroll.querySelectorAll('td.ind-sel, td.ind-actief')];

  pasHoogteAan();
  if (ui.eersteKeer) {
    ui.eersteKeer = false;
    // Begin bij vandaag als dat in dit jaar valt, anders bovenaan.
    const r = ui.datums.indexOf(vandaag);
    if (r >= 0 && !ui.gekozen) { ui.actief = { r, c: 0 }; ui.anker = { r, c: 0 }; tekenSelectie(); }
    toonActief(true);
    vangFocus();
  }
}

// Het schuifvak vult de rest van het zichtbare scherm (bouwnorm E1: meet het
// écht zichtbare deel, niet 100vh).
function pasHoogteAan() {
  const scroll = el('ind-scroll');
  if (!scroll) return;
  const boven = scroll.getBoundingClientRect().top;
  const hoogte = Math.max(240, window.innerHeight - Math.max(boven, 0) - 16);
  scroll.style.height = hoogte + 'px';
}
window.addEventListener('resize', () => {
  // Niet tijdens het typen: op een telefoon verandert de hoogte als het
  // schermtoetsenbord opengaat, en dan moet het vak blijven staan.
  if (state.huidigeView !== 'ind' || ui.bewerken) return;
  pasHoogteAan();
});

// ---- Selectie -----------------------------------------------------------------

function _begrensSelectie() {
  const maxR = Math.max(0, ui.datums.length - 1);
  const maxC = Math.max(0, ui.kolommen.length - 1);
  const b = p => ({ r: Math.min(Math.max(p.r, 0), maxR), c: Math.min(Math.max(p.c, 0), maxC) });
  ui.actief = b(ui.actief);
  ui.anker = b(ui.anker);
}

function _selectie() {
  return {
    r1: Math.min(ui.anker.r, ui.actief.r), r2: Math.max(ui.anker.r, ui.actief.r),
    c1: Math.min(ui.anker.c, ui.actief.c), c2: Math.max(ui.anker.c, ui.actief.c),
  };
}

let _vorigeSelectie = [];
function tekenSelectie() {
  _vorigeSelectie.forEach(td => td.classList.remove('ind-sel', 'ind-actief'));
  _vorigeSelectie = [];
  const s = _selectie();
  for (let r = s.r1; r <= s.r2; r++) {
    for (let c = s.c1; c <= s.c2; c++) {
      const td = ui.td[r]?.[c];
      if (td) { td.classList.add('ind-sel'); _vorigeSelectie.push(td); }
    }
  }
  const a = ui.td[ui.actief.r]?.[ui.actief.c];
  if (a) { a.classList.add('ind-actief'); _vorigeSelectie.push(a); }
}

// Schuift het vak zó dat de actieve cel zichtbaar is — en alleen het vak, niet
// de hele pagina. De vaste kop en de vaste datumkolommen mogen de cel niet
// bedekken.
function toonActief(midden = false) {
  const td = ui.td[ui.actief.r]?.[ui.actief.c];
  const scroll = el('ind-scroll');
  if (!td || !scroll) return;
  const sr = scroll.getBoundingClientRect();
  const tr = td.getBoundingClientRect();
  const kop = scroll.querySelector('thead');
  const kopH = kop ? kop.getBoundingClientRect().height : 0;
  const vast = scroll.querySelector('tbody td.ind-vast2');
  const vastB = vast ? (vast.getBoundingClientRect().right - sr.left) : 0;
  const top = tr.top - sr.top + scroll.scrollTop;
  const links = tr.left - sr.left + scroll.scrollLeft;
  if (midden) {
    scroll.scrollTop = Math.max(0, top - scroll.clientHeight / 2);
  } else if (top - kopH < scroll.scrollTop) {
    scroll.scrollTop = top - kopH;
  } else if (top + tr.height > scroll.scrollTop + scroll.clientHeight) {
    scroll.scrollTop = top + tr.height - scroll.clientHeight;
  }
  if (links - vastB < scroll.scrollLeft) {
    scroll.scrollLeft = Math.max(0, links - vastB);
  } else if (links + tr.width > scroll.scrollLeft + scroll.clientWidth) {
    scroll.scrollLeft = links + tr.width - scroll.clientWidth;
  }
}

function zet(r, c, uitbreiden = false) {
  ui.actief = { r, c };
  if (!uitbreiden) ui.anker = { r, c };
  _begrensSelectie();
  ui.gekozen = true;
  tekenSelectie();
  toonActief();
}

function beweeg(dr, dc, uitbreiden = false) {
  zet(ui.actief.r + dr, ui.actief.c + dc, uitbreiden);
}

// ---- Bewerken in de cel ---------------------------------------------------------

// opties.aanraken: typen met het schermtoetsenbord (telefoon/iPad).
// opties.alles: de bestaande tekst geselecteerd, zodat typen hem vervangt.
function startBewerken(modus, beginTekst, opties = {}) {
  const { r, c } = ui.actief;
  const td = ui.td[r]?.[c];
  if (!td) return;
  if (!magSchrijven()) {
    try { controleerVerbinding(); } catch (e) { /* venster staat al open */ }
    return;
  }
  ui.anker = { r, c };
  tekenSelectie();
  const huidig = zichtbareTekst(ui.concept, state.indelingMap, ui.datums[r], ui.kolommen[c].id);
  const input = document.createElement('input');
  input.className = 'ind-invoer';
  input.value = beginTekst !== undefined ? beginTekst : huidig;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'characters');
  input.setAttribute('enterkeyhint', 'next');
  td.appendChild(input);
  ui.bewerken = { r, c, modus, input, aanraken: !!opties.aanraken };
  input.focus({ preventScroll: true });
  if (opties.alles) input.select();
  else input.setSelectionRange(input.value.length, input.value.length);
  toonActief();
  input.addEventListener('keydown', invoerToets);
  input.addEventListener('blur', () => { if (ui.bewerken && ui.bewerken.input === input) stopBewerken(true); });
}

function stopBewerken(opslaan) {
  const b = ui.bewerken;
  if (!b) return;
  ui.bewerken = null;
  const waarde = b.input.value;
  if (b.input.parentNode) b.input.parentNode.removeChild(b.input);
  vangFocus();
  if (opslaan) pasToe([{ r: b.r, c: b.c, tekst: waarde }]);
  werkCelBij(b.r, b.c);
  if (ui.uitgesteld) { ui.uitgesteld = false; planTekenen(); }
}

// Met de vinger: Enter slaat op en opent meteen de cel eronder, zodat het
// schermtoetsenbord open blijft en je een kolom kunt doortypen. Het nieuwe
// vakje krijgt de focus vóórdat het oude verdwijnt; anders klapt het
// toetsenbord dicht. De hele tabel wordt pas opnieuw getekend als je stopt;
// tot dan wordt alleen de net ingevulde cel bijgewerkt.
function doorNaarVolgende(dr, dc) {
  const oud = ui.bewerken;
  ui.bewerken = null;
  const waarde = oud.input.value;
  zet(oud.r + dr, oud.c + dc);
  startBewerken('wijzig', undefined, { aanraken: true, alles: true });
  if (oud.input.parentNode) oud.input.parentNode.removeChild(oud.input);
  pasToe([{ r: oud.r, c: oud.c, tekst: waarde }]);
  werkCelBij(oud.r, oud.c);
}

// Werkt één cel bij zonder de tabel opnieuw te tekenen (tekst, kleur, concept).
function werkCelBij(r, c) {
  const td = ui.td[r]?.[c];
  const kol = ui.kolommen[c];
  if (!td || !kol) return;
  const datum = ui.datums[r];
  const tekst = zichtbareTekst(ui.concept, state.indelingMap, datum, kol.id);
  const tekstKnoop = [...td.childNodes].find(n => n.nodeType === 3);
  if (tekstKnoop) tekstKnoop.textContent = tekst;
  else td.insertBefore(document.createTextNode(tekst), td.firstChild);
  [...td.classList].filter(k => /^f-/.test(k) || k === 'ind-leeg').forEach(k => td.classList.remove(k));
  if (!kol.extra) td.classList.add(tekst ? fclass(tekst.split(',')[0]) : 'ind-leeg');
  td.classList.toggle('ind-concept', !!ui.concept[celSleutel(datum, kol.id)]);
}

function invoerToets(ev) {
  const b = ui.bewerken;
  if (!b) return;
  const k = ev.key;
  if (b.aanraken && k === 'Enter') {
    ev.preventDefault(); ev.stopPropagation();
    const volgende = Math.min(b.r + (ev.shiftKey ? -1 : 1), ui.datums.length - 1);
    if (volgende === b.r) { stopBewerken(true); return; } // laatste dag van het jaar
    doorNaarVolgende(ev.shiftKey ? -1 : 1, 0);
    return;
  }
  const afsluiten = (dr, dc) => { ev.preventDefault(); ev.stopPropagation(); stopBewerken(true); beweeg(dr, dc); };
  if (k === 'Enter') return afsluiten(ev.shiftKey ? -1 : 1, 0);
  if (k === 'Tab') return afsluiten(0, ev.shiftKey ? -1 : 1);
  if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); stopBewerken(false); return; }
  if (k === 'ArrowUp') return afsluiten(-1, 0);
  if (k === 'ArrowDown') return afsluiten(1, 0);
  if (b.modus === 'invoer' && k === 'ArrowLeft') return afsluiten(0, -1);
  if (b.modus === 'invoer' && k === 'ArrowRight') return afsluiten(0, 1);
  ev.stopPropagation();
}

// ---- Toetsenbord, muis, klembord op het raster -----------------------------------

function _dialoogOpen() {
  return !!document.querySelector('.dlg-bg') || !!document.querySelector('.sheet.open');
}

function rasterToets(ev) {
  if (ui.bewerken || _dialoogOpen()) return;
  const k = ev.key;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && (k === 'z' || k === 'Z')) { ev.preventDefault(); maakOngedaan(); return; }
  if (mod && /^[cxCX]$/.test(k)) {
    // Het gekozen blok als tekst in het tekstvak zetten en selecteren: dan
    // kopieert de browser het zelf, ook als hij de kopieer-gebeurtenis niet
    // doorgeeft. De gebeurtenis zelf (hieronder) zet hetzelfde klaar.
    const v = el('ind-vang');
    v.value = maakKlembord(_selectieTekst());
    v.select();
    return;
  }
  if (mod) return; // Ctrl+V: de browser plakt in het tekstvak, zie 'paste' hieronder
  if (k === 'ArrowUp')    { ev.preventDefault(); beweeg(-1, 0, ev.shiftKey); return; }
  if (k === 'ArrowDown')  { ev.preventDefault(); beweeg(1, 0, ev.shiftKey); return; }
  if (k === 'ArrowLeft')  { ev.preventDefault(); beweeg(0, -1, ev.shiftKey); return; }
  if (k === 'ArrowRight') { ev.preventDefault(); beweeg(0, 1, ev.shiftKey); return; }
  if (k === 'PageDown')   { ev.preventDefault(); beweeg(15, 0, ev.shiftKey); return; }
  if (k === 'PageUp')     { ev.preventDefault(); beweeg(-15, 0, ev.shiftKey); return; }
  if (k === 'Enter')      { ev.preventDefault(); beweeg(ev.shiftKey ? -1 : 1, 0); return; }
  if (k === 'Tab')        { ev.preventDefault(); beweeg(0, ev.shiftKey ? -1 : 1); return; }
  if (k === 'Escape')     { ui.anker = { ...ui.actief }; tekenSelectie(); return; }
  if (k === 'F2')         { ev.preventDefault(); startBewerken('wijzig'); return; }
  if (k === 'Delete' || k === 'Backspace') {
    ev.preventDefault();
    const s = _selectie();
    const lijst = [];
    for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) lijst.push({ r, c, tekst: '' });
    pasToe(lijst);
    return;
  }
  if (k.length === 1 && !ev.altKey) {
    ev.preventDefault();
    startBewerken('invoer', k);
  }
}

function celVan(doel) {
  const td = doel && doel.closest ? doel.closest('td[data-c]') : null;
  if (!td) return null;
  return { r: +td.dataset.r, c: +td.dataset.c };
}

function koppelRaster() {
  const scroll = el('ind-scroll');
  const vang = el('ind-vang');
  if (!scroll || !vang) return;
  vang.addEventListener('keydown', rasterToets);
  vang.addEventListener('copy', bijKopieren);
  vang.addEventListener('cut', bijKnippen);
  vang.addEventListener('paste', bijPlakken);
  // Hoe kwam de tik of klik? pointerdown komt altijd vóór de (nagebootste)
  // muisgebeurtenissen, dus daarmee onderscheiden we vinger en muis.
  scroll.addEventListener('pointerdown', (ev) => { ui.aanwijzer = ev.pointerType || 'mouse'; });
  scroll.addEventListener('mousedown', (ev) => {
    if (ui.aanwijzer !== 'mouse') return; // vinger: zie 'click' hieronder
    if (ev.button !== 0) return;
    if (ev.target.classList && ev.target.classList.contains('ind-invoer')) return;
    const p = celVan(ev.target);
    if (!p) return;
    ev.preventDefault();
    if (ui.bewerken) stopBewerken(true);
    vangFocus();
    zet(p.r, p.c, ev.shiftKey);
    ui.slepen = true;
  });
  scroll.addEventListener('mouseover', (ev) => {
    if (!ui.slepen) return;
    const p = celVan(ev.target);
    if (p && (p.r !== ui.actief.r || p.c !== ui.actief.c)) {
      ui.actief = p;
      tekenSelectie();
    }
  });
  scroll.addEventListener('dblclick', (ev) => {
    if (ui.aanwijzer !== 'mouse') return;
    const p = celVan(ev.target);
    if (!p) return;
    zet(p.r, p.c);
    startBewerken('wijzig');
  });
  // Vinger: eerste tik kiest de cel, tweede tik op dezelfde cel opent het
  // toetsenbord. (Schuiven met de vinger geeft geen tik, dus dat blijft vrij.)
  scroll.addEventListener('click', (ev) => {
    if (ui.aanwijzer === 'mouse') return;
    if (ev.target.classList && ev.target.classList.contains('ind-invoer')) return;
    const p = celVan(ev.target);
    if (!p) return;
    if (ui.bewerken) {
      if (ui.bewerken.r === p.r && ui.bewerken.c === p.c) return;
      stopBewerken(true);
    }
    const s = _selectie();
    const alGekozen = p.r === ui.actief.r && p.c === ui.actief.c && s.r1 === s.r2 && s.c1 === s.c2 && ui.gekozen;
    if (alGekozen) startBewerken('wijzig', undefined, { aanraken: true, alles: true });
    else zet(p.r, p.c);
  });
}
document.addEventListener('mouseup', () => { ui.slepen = false; });

function _selectieTekst() {
  const s = _selectie();
  const rijen = [];
  for (let r = s.r1; r <= s.r2; r++) {
    const rij = [];
    for (let c = s.c1; c <= s.c2; c++) {
      rij.push(zichtbareTekst(ui.concept, state.indelingMap, ui.datums[r], ui.kolommen[c].id));
    }
    rijen.push(rij);
  }
  return rijen;
}

function bijKopieren(ev) {
  if (ui.bewerken) return;
  ev.clipboardData.setData('text/plain', maakKlembord(_selectieTekst()));
  ev.preventDefault();
}

// Knippen = kopiëren en daarna leegmaken (zoals in de meeste web-tabellen).
function bijKnippen(ev) {
  if (ui.bewerken) return;
  bijKopieren(ev);
  const s = _selectie();
  const lijst = [];
  for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) lijst.push({ r, c, tekst: '' });
  pasToe(lijst);
}

function bijPlakken(ev) {
  if (ui.bewerken) return;
  ev.preventDefault();
  const blok = leesKlembord(ev.clipboardData.getData('text/plain'));
  el('ind-vang').value = '';
  if (!blok.length) return;
  const s = _selectie();
  const lijst = [];
  let buiten = 0;
  const enkel = blok.length === 1 && blok[0].length === 1;
  if (enkel && (s.r1 !== s.r2 || s.c1 !== s.c2)) {
    // Eén waarde op een gekozen blok: het hele blok krijgt die waarde (zoals Excel).
    for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) lijst.push({ r, c, tekst: blok[0][0] });
  } else {
    blok.forEach((rij, dr) => rij.forEach((tekst, dc) => {
      const r = s.r1 + dr, c = s.c1 + dc;
      if (r >= ui.datums.length || c >= ui.kolommen.length) { buiten++; return; }
      lijst.push({ r, c, tekst });
    }));
    const breedte = Math.max(...blok.map(x => x.length));
    ui.anker = { r: s.r1, c: s.c1 };
    ui.actief = {
      r: Math.min(s.r1 + blok.length - 1, ui.datums.length - 1),
      c: Math.min(s.c1 + breedte - 1, ui.kolommen.length - 1),
    };
  }
  pasToe(lijst);
  tekenSelectie();
  if (buiten > 0) {
    meld('Niet alles geplakt',
      `${buiten} waarde${buiten === 1 ? '' : 'n'} viel${buiten === 1 ? '' : 'en'} buiten het raster ` +
      `(voorbij de laatste kolom of de laatste dag van ${ui.jaar}) en ${buiten === 1 ? 'is' : 'zijn'} niet geplakt.`);
  }
}

// ---- Knoppen ----------------------------------------------------------------------

window.indJaar = async function(delta) {
  if (ui.bewerken) stopBewerken(true);
  await slaConceptOp();
  ui.jaar = (ui.jaar || huidigKalenderJaar()) + delta;
  ui.gekozen = false;
  ui.actief = { r: 0, c: 0 }; ui.anker = { r: 0, c: 0 };
  renderIndView();
};

window.indOngedaan = function() {
  if (ui.bewerken) stopBewerken(true);
  maakOngedaan();
};

window.indConceptWeggooien = async function() {
  const n = Object.keys(ui.concept).length;
  if (!n) return;
  const ok = await bevestig('Concept weggooien',
    `Je gooit het hele concept van ${ui.jaar} weg: ${n} cel${n === 1 ? '' : 'len'}, ook wat andere beheerders erin zetten.\n\n` +
    'Het rooster zelf verandert niet.',
    'Weggooien', 'Annuleren');
  if (!ok) return;
  try {
    clearTimeout(ui.opslaanTimer);
    if (ui.opslaanBezig) await ui.opslaanBezig;
    ui.wachtrij = {};
    await deleteDoc(doc(db, CONCEPT_COLLECTIE, String(ui.jaar)));
    ui.ongedaan = [];
    await meld('Concept weggegooid', `Het concept van ${ui.jaar} is leeg. Het rooster is niet veranderd.`);
  } catch (e) {
    await meld('Weggooien mislukt', String(e.message || e));
  }
  planTekenen();
};

function _kolomNaam(kolomId) {
  const k = ui.kolommen.find(x => x.id === kolomId);
  return k ? k.header : kolomId;
}
function _kortDatum(datum) { return `${datum.slice(8, 10)}-${datum.slice(5, 7)}`; }

window.indPubliceer = async function() {
  if (ui.bewerken) stopBewerken(true);
  if (!isBeheerder()) { await meld('Geen rechten', 'Alleen een beheerder kan publiceren.'); return; }
  if (schrijfactieBezig()) {
    await meld('Even wachten', 'Er loopt al een import, publicatie of terugdraaiing. Wacht tot die klaar is.');
    return;
  }
  if (!magSchrijven()) { try { controleerVerbinding(); } catch (e) { /* venster staat al open */ } return; }

  await slaConceptOp();
  const jaar = ui.jaar;
  const vandaag = vandaagIso();
  const grens = plusDagen(vandaag, NABIJ_DAGEN);
  const pub = bouwPublicatie(ui.concept, state.indelingMap, vandaag, grens);

  if (!pub.cellen.length) {
    // Alles in het concept staat al zo in het rooster. Opruimen en zeggen.
    await _ruimConceptOp(pub.opruimen);
    await meld('Niets te publiceren', 'Alles in het concept staat al zo in het rooster. Het concept is opgeruimd.');
    planTekenen();
    return;
  }

  const conflicten = valideerDagenTegenRegels(pub.dagen);
  const blokkades = conflicten.filter(c => c.ernst === 'blokkeren');
  const nCellen = pub.cellen.length;
  const delen = [
    `${nCellen} cel${nCellen === 1 ? '' : 'len'} op ${pub.dagen.length} dag${pub.dagen.length === 1 ? '' : 'en'} gaan het rooster van ${jaar} in. ` +
    'De rest van het rooster blijft zoals het is.',
  ];
  if (pub.nabij > 0) {
    delen.push(`⚠ ${pub.nabij} toewijzing${pub.nabij === 1 ? '' : 'en'} binnen ${NABIJ_DAGEN} dagen ` +
      `(${pub.nabijeDagen} dag${pub.nabijeDagen === 1 ? '' : 'en'}). Betrokken radiologen krijgen een melding.`);
  }
  if (pub.intussen.length) {
    const voorbeelden = pub.intussen.slice(0, 8).map(c =>
      `• ${_kortDatum(c.datum)} ${_kolomNaam(c.kolomId)}: was "${c.was || 'leeg'}", nu in het rooster "${c.rooster || 'leeg'}", concept "${c.nieuw || 'leeg'}"`
    ).join('\n');
    delen.push(`⚠ ${pub.intussen.length} cel${pub.intussen.length === 1 ? ' is' : 'len zijn'} in het rooster gewijzigd nadat je ze in het concept zette. ` +
      `Publiceren zet de waarde uit het concept neer:\n${voorbeelden}${pub.intussen.length > 8 ? '\n• …' : ''}`);
  }
  if (blokkades.length) {
    delen.push(`⛔ ${blokkades.length} blokkerend regelconflict${blokkades.length === 1 ? '' : 'en'} op deze dagen ` +
      `(rood omrand in het raster). Publiceren negeert deze regels.`);
  }
  delen.push('Vóór het wegschrijven bewaart de app de huidige inhoud van deze dagen, zodat je dit met één knop kunt terugdraaien.');

  const ok = await bevestig('Publiceren', delen.join('\n\n'), 'Publiceren', 'Annuleren');
  if (!ok) return;

  ui.publiceertBezig = true;
  zetSchrijfactie(true);
  tekenStatus();
  try {
    const bestandsnaam = `Indelen ${jaar} (publicatie)`;
    const uitkomst = await schrijfDagenWeg(pub.dagen, { soort: 'publicatie', bestandsnaam, vandaag, grens });
    if (!uitkomst) return; // afgebroken; de melding is al getoond
    const { wijzigingenGeschreven, verwerkt, heropend, terugdraaiId } = uitkomst;

    const telling = tel(pub.dagen);
    await legVast({
      soort: 'publicatie',
      bestandsnaam,
      jaar: String(jaar),
      dagen: telling.dagen,
      gevulde_cellen: telling.gevuldeCellen,
      gevulde_dagen: telling.gevuldeDagen,
      per_kolom: telling.perKolom,
      dagen_per_jaar: telling.jaren,
      gewijzigde_cellen: nCellen,
      snapshot_id: terugdraaiId || null,
    });

    await _ruimConceptOp(pub.opruimen);
    ui.ongedaan = [];

    const bericht = [`${nCellen} cel${nCellen === 1 ? '' : 'len'} op ${pub.dagen.length} dag${pub.dagen.length === 1 ? '' : 'en'} gepubliceerd.`];
    if (wijzigingenGeschreven > 0) bericht.push(`${wijzigingenGeschreven} cel${wijzigingenGeschreven === 1 ? '' : 'len'} gemarkeerd als ongelezen voor betrokken radiologen.`);
    if (verwerkt > 0) bericht.push(`${verwerkt} wens${verwerkt === 1 ? '' : 'en'} automatisch verwerkt.`);
    if (heropend > 0) bericht.push(`${heropend} wens${heropend === 1 ? '' : 'en'} teruggezet naar 'open' (indeling klopt niet meer).`);
    await meld('Gepubliceerd', bericht.join('\n'));
  } catch (e) {
    console.error('indPubliceer', e);
    await meld('Publiceren mislukt', String(e.message || e));
  } finally {
    ui.publiceertBezig = false;
    zetSchrijfactie(false);
    vergeetLaatstePunt();
    planTekenen();
  }
};

// Haalt de gepubliceerde cellen uit het concept — alleen als ze intussen niet
// opnieuw zijn veranderd (een andere beheerder kan tegelijk doorwerken).
async function _ruimConceptOp(opruimen) {
  const cellen = {};
  Object.entries(opruimen).forEach(([k, nieuw]) => {
    const huidig = ui.concept[k];
    if (huidig && huidig.nieuw === nieuw && !(k in ui.wachtrij)) cellen[k] = deleteField();
  });
  if (!Object.keys(cellen).length) return;
  try {
    await setDoc(doc(db, CONCEPT_COLLECTIE, String(ui.jaar)), {
      cellen,
      bijgewerkt_door: state.profiel?.naam || state.profiel?.email || '',
      bijgewerkt_lokaal: new Date().toISOString(),
    }, { merge: true });
  } catch (e) {
    console.error('concept opruimen', e);
    await meld('Concept niet opgeruimd',
      'Het publiceren is gelukt, maar de gepubliceerde cellen staan nog in het concept. ' +
      'Ze zijn gelijk aan het rooster; bij de volgende keer publiceren worden ze opgeruimd.\n\n' +
      `Reden: ${e.message || e}`);
  }
}
