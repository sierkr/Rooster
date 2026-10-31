// Samenvoegen: één persoon die twee keer in de app staat weer één maken (v3.38.0).
//
// De controle en het rekenwerk staan in dubbel.js. Hier staat wat de beheerder
// ziet: de waarschuwingsbalk bovenaan Overzicht, Indelen en Beheer › Stoel
// bezetting, en het venster dat hem in vier stappen door het samenvoegen leidt:
//   1. wat de app ziet (beide stoelen, periodes, wat erop staat);
//   2. welke stoel blijft en vanaf welke datum (met voorstel);
//   3. botsingen: dagen waarop beide stoelen iets hebben — per dag kiezen;
//   4. samenvatting, dan één knop "Samenvoegen".
// Het terugdraai-record wordt vastgelegd vóórdat er iets geschreven wordt, dus
// samenvoegen is altijd terug te draaien via "Recente stoel-wijzigingen".
import { collection, doc, getDoc, getDocs, deleteField } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { setDoc, updateDoc, writeBatch } from '../schrijven.js';
import { db } from '../firebase-init.js';
import { state, SLOTS, VASTE_RAD_IDS } from '../state.js';
import { esc, formatDatum, assertBezettingGeldig } from '../helpers.js';
import { openSheet, closeSheet } from '../sheets.js';
import { meld } from '../dialoog.js';
import { snapshotStoelen, legMutatieVast } from '../bezetting-mutaties.js';
import {
  zoekDubbelen, standaardKeuze, standaardDatum, maakPlan, schrijfOpdrachten,
  stoelOverzicht, periodesVanStoel, veldTekst, VELD_LABEL, tellingTekst, WEG,
} from '../dubbel.js';

const isBeheerder = () => state.profiel?.rol === 'beheerder';

// ---- Namen en datums ------------------------------------------------------------
export function datumJ(iso) {
  return iso ? `${formatDatum(iso, 'kort')} ${iso.slice(0, 4)}` : '';
}
export function stoelNaam(id) {
  if (SLOTS.includes(id)) return `${id} (waarnemer)`;
  if (VASTE_RAD_IDS.includes(id)) return `stoel ${id}`;
  // Een extra vaste stoel heeft een onleesbaar intern nummer; noem zijn begin.
  const eerste = periodesVanStoel(id).filter(p => !p.plaatshouder)
    .sort((a, b) => ((a.van || '') < (b.van || '') ? -1 : 1))[0];
  if (!eerste || !eerste.van) return 'extra vaste stoel';
  const [j, m, d] = eerste.van.split('-');
  const MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `vaste stoel (sinds ${+d} ${MND[+m - 1]} ${j})`;
}
const NAAM = { stoel: stoelNaam, datum: datumJ };
const periodeTekst = (van, tot) => `${van ? datumJ(van) : 'begin'} – ${tot ? datumJ(tot) : 'heden'}`;

// ---- Waarschuwingsbalk ----------------------------------------------------------
// Eén regel per gevonden probleem. Leeg voor wie geen beheerder is.
export function dubbelBannerHtml() {
  if (!isBeheerder()) return '';
  let lijst;
  try { lijst = zoekDubbelen(); } catch (e) { console.warn('zoekDubbelen', e); return ''; }
  if (!lijst.length) return '';
  return `<div class="dubbel-banner" role="alert">${lijst.map(b => {
    const wat = b.soort === 'los'
      ? `<b>${esc(b.code)}</b>: ${b.losseDagen.length === 1 ? '1 dag staat' : b.losseDagen.length + ' dagen staan'} nog op ${esc(stoelNaam(b.a.stoelId))}`
      : `<b>${esc(b.code)}</b> staat twee keer in de app`;
    return `<div class="dubbel-regel"><span>⚠ ${wat}</span>
      <button class="btn dubbel-knop" onclick="window.openSamenvoegen('${esc(b.sleutel)}')">Oplossen</button></div>`;
  }).join('')}</div>`;
}

// ---- Het venster ----------------------------------------------------------------
const wz = { stap: 1, sleutel: null, bev: null, keuze: null, keuzes: {}, concepten: {}, plan: null, bezig: false, laadNr: 0 };

function zoekBevinding(sleutel) {
  return zoekDubbelen().find(b => b.sleutel === sleutel) || null;
}

async function laadConcepten(bev) {
  const datums = Object.keys(state.indelingMap || {}).sort();
  const vanJaar = +((bev.a.van || bev.b.van || datums[0] || '2025').slice(0, 4));
  const totJaar = +((datums[datums.length - 1] || String(vanJaar)).slice(0, 4));
  const uit = {};
  for (let j = Math.min(vanJaar, totJaar); j <= totJaar; j++) {
    try {
      const snap = await getDoc(doc(db, 'indeling_concept', String(j)));
      if (snap.exists()) uit[String(j)] = (snap.data().cellen) || {};
    } catch (e) { console.warn('concept laden', j, e && e.message); }
  }
  return uit;
}

// opties: { blijftId, datum } — vooraf ingevuld (bv. vanuit → Vast).
window.openSamenvoegen = async function(sleutel, opties = null) {
  if (!isBeheerder()) { await meld('Geen rechten', 'Alleen een beheerder kan samenvoegen.'); return; }
  let bev = zoekBevinding(sleutel);
  if (!bev) { await meld('Niets meer te doen', 'Dit probleem is er niet meer. Misschien heeft iemand het intussen al opgelost.'); return; }
  const nr = ++wz.laadNr;
  Object.assign(wz, { stap: 1, sleutel, bev, keuzes: {}, concepten: {}, plan: null, bezig: false });
  document.getElementById('sheetTitle').textContent = `Samenvoegen: ${bev.code} · ${bev.achternaam}`;
  document.getElementById('sheetSub').textContent = 'Eén persoon, één stoel';
  document.getElementById('sheetBody').innerHTML = '<div class="empty-state">Bezig met laden…</div>';
  openSheet();
  try {
    // Het hele rooster vanaf zijn eerste periode moet geladen zijn, anders
    // tellen en verhuizen we maar een deel.
    const vanaf = [bev.a.van, bev.b.van].filter(Boolean).sort()[0] || '2000-01-01';
    if (window.zorgIndelingVensterTotEinde) await window.zorgIndelingVensterTotEinde(vanaf);
    // Accounts: Beheer laadt ze, Overzicht en Indelen niet.
    try {
      const snap = await getDocs(collection(db, 'gebruikers'));
      state.gebruikers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn('gebruikers laden', e && e.message); }
    bev = zoekBevinding(sleutel) || bev;
    const concepten = await laadConcepten(bev);
    if (nr !== wz.laadNr) return; // intussen een ander venster geopend
    const keuze = standaardKeuze(bev);
    if (opties && opties.blijftId && [bev.a.stoelId, bev.b.stoelId].includes(opties.blijftId)) {
      keuze.blijftId = opties.blijftId;
      keuze.datum = opties.datum || standaardDatum(bev, opties.blijftId);
    }
    Object.assign(wz, { bev, concepten, keuze });
    herbereken();
    teken();
  } catch (e) {
    document.getElementById('sheetBody').innerHTML = `<div class="form-info">Laden mislukt: ${esc(e.message || e)}</div>
      <button class="btn" style="width:100%;margin-top:10px;" onclick="window.closeSheet()">Sluiten</button>`;
  }
};

function herbereken() {
  wz.plan = maakPlan(wz.bev, wz.keuze, wz.concepten, NAAM);
  // Keuzes van dagen die geen botsing meer zijn, vergeten.
  if (wz.plan && !wz.plan.fout) {
    const bots = new Set(wz.plan.botsingen.map(x => x.datum));
    Object.keys(wz.keuzes).forEach(d => { if (!bots.has(d)) delete wz.keuzes[d]; });
  }
}

const STAP_TITEL = { 1: 'Wat de app ziet', 2: 'Welke stoel blijft', 3: 'Botsingen', 4: 'Samenvatting' };

function teken() {
  document.getElementById('sheetSub').textContent = `Stap ${wz.stap} van 4 · ${STAP_TITEL[wz.stap]}`;
  const body = document.getElementById('sheetBody');
  let html = '';
  if (wz.stap === 1) html = stap1();
  else if (wz.stap === 2) html = stap2();
  else if (wz.stap === 3) html = stap3();
  else html = stap4();
  body.innerHTML = `<div class="sv">${html}</div>`;
}

function knoppen(links, rechts) {
  return `<div class="sv-knoppen">${links}${rechts}</div>`;
}

function stoelKaart(periode) {
  const o = stoelOverzicht(periode);
  const regels = [
    `<div><span class="muted">Periode</span> ${esc(periodeTekst(o.van, o.tot))}</div>`,
    `<div><span class="muted">Ingepland</span> ${o.dagen ? `${o.dagen} dag${o.dagen === 1 ? '' : 'en'} (${esc(datumJ(o.eerste))}${o.dagen > 1 ? ' – ' + esc(datumJ(o.laatste)) : ''})` : 'niets'}</div>`,
    `<div><span class="muted">Vakantie-V</span> ${o.vak} · <span class="muted">Diensten</span> ${o.dienst} · <span class="muted">Wensen</span> ${o.wensen}</div>`,
    `<div><span class="muted">Account</span> ${o.accounts.length ? esc(o.accounts.join(', ')) : 'geen'}</div>`,
  ];
  return `<div class="sv-kaart"><div class="sv-kaart-kop">${esc(stoelNaam(o.stoelId))}</div>${regels.join('')}</div>`;
}

function stap1() {
  const b = wz.bev;
  const uitleg = b.soort === 'los'
    ? `<b>${esc(b.code)} · ${esc(b.achternaam)}</b> zit vanaf ${esc(datumJ(b.b.van))} op ${esc(stoelNaam(b.b.stoelId))}. Op ${esc(stoelNaam(b.a.stoelId))} is hij gestopt op ${esc(datumJ(b.a.tot))}, maar daar staan daarna nog ${b.losseDagen.length} dag${b.losseDagen.length === 1 ? '' : 'en'} van hem (${esc(datumJ(b.losseDagen[0]))}${b.losseDagen.length > 1 ? ' – ' + esc(datumJ(b.losseDagen[b.losseDagen.length - 1])) : ''}). Die horen niet bij iemand.`
    : `<b>${esc(b.code)} · ${esc(b.achternaam)}</b> staat ${b.vanaf ? 'vanaf ' + esc(datumJ(b.vanaf)) : ''} op twee stoelen tegelijk. Het is één persoon, dus hij hoort op één stoel. Nu telt hij op dagen waarop beide stoelen iets hebben dubbel mee, en staat zijn indeling verdeeld over twee kolommen.`;
  return `
    <p class="sv-tekst">${uitleg}</p>
    <div class="sv-kaarten">${stoelKaart(b.a)}${stoelKaart(b.b)}</div>
    <p class="muted sv-klein">Nog niets veranderd. In de volgende stappen kies je en zie je precies wat er gebeurt.</p>
    ${knoppen('<button class="btn" onclick="window.closeSheet()">Annuleren</button>', '<button class="btn btn-primary" onclick="window.svStap(2)">Volgende</button>')}`;
}

function uitlegPlan(p) {
  if (p.soort === 'los') {
    return `${esc(stoelNaam(p.S))} blijft. ${esc(stoelNaam(p.C))} hoeft niet afgesloten te worden: dat is al gebeurd. Alleen de achtergebleven dagen gaan naar ${esc(stoelNaam(p.S))}.`;
  }
  const r = [];
  if (p.Cna.weg) r.push(`${esc(stoelNaam(p.C))} verdwijnt helemaal voor ${esc(p.code)}${p.cVerwijderen ? ' (de stoel was alleen voor hem; de kolom gaat weg)' : ''}.`);
  else if (p.Cna.tot !== p.Coud.tot) r.push(`${esc(stoelNaam(p.C))}: ${esc(p.code)} stopt daar op <b>${esc(datumJ(p.Cna.tot))}</b> (laatste dag).`);
  r.push(`${esc(stoelNaam(p.S))}: ${esc(p.code)} staat daar ${p.Svan ? 'vanaf <b>' + esc(datumJ(p.Svan)) + '</b>' : 'vanaf het begin'}${p.Svan !== p.Soud.van ? ` (was ${p.Soud.van ? esc(datumJ(p.Soud.van)) : 'het begin'})` : ''}.`);
  return r.map(x => `<div>• ${x}</div>`).join('');
}

function stap2() {
  const b = wz.bev, k = wz.keuze, p = wz.plan;
  let keuzeHtml;
  if (b.soort === 'los') {
    keuzeHtml = `<div class="sv-kaart"><div class="sv-kaart-kop">${esc(stoelNaam(b.b.stoelId))} blijft</div>
      <div class="muted">Daar zit ${esc(b.code)} echt op die dagen.</div></div>`;
  } else {
    const voorstel = standaardKeuze(b).blijftId;
    const optie = (per) => `<label class="sv-optie">
        <input type="radio" name="svBlijft" value="${per.stoelId}" ${k.blijftId === per.stoelId ? 'checked' : ''} onchange="window.svKiesStoel('${per.stoelId}')">
        <span><b>${esc(stoelNaam(per.stoelId))}</b>${per.stoelId === voorstel ? ' <span class="sv-voorstel">voorstel</span>' : ''}
        <span class="muted"><br>${esc(periodeTekst(per.van, per.tot))}</span></span></label>`;
    keuzeHtml = `<div class="sv-label">Welke stoel blijft?</div>${optie(b.a)}${optie(b.b)}
      <div class="sv-label">Vanaf welke datum hoort ${esc(b.code)} op die stoel?</div>
      <input type="date" class="input" id="svDatum" value="${esc(k.datum || '')}" onchange="window.svDatum(this.value)">
      <div class="muted sv-klein">Voorstel: de dag dat hij op die stoel begon.</div>`;
  }
  const gevolg = (p && p.fout)
    ? `<div class="sv-fout">${esc(p.fout)}</div>`
    : `<div class="sv-gevolg">${uitlegPlan(p)}</div>`;
  return `${keuzeHtml}${gevolg}
    ${knoppen('<button class="btn" onclick="window.svStap(1)">Vorige</button>',
      `<button class="btn btn-primary" ${p && p.fout ? 'disabled' : ''} onclick="window.svStap(3)">Volgende</button>`)}`;
}

function waardenVan(x, kant) {
  // kant 'S' of 'C': de waarden zoals ze nu op die stoel staan.
  const opS = x.doel === wz.plan.S;
  const welke = (kant === 'S') === opS ? 'doel' : 'bron';
  const delen = x.botsVelden.map(v => {
    const t = veldTekst(v, welke);
    return t ? `${VELD_LABEL[v.soort]}: <b>${esc(t)}</b>` : `${VELD_LABEL[v.soort]}: leeg`;
  });
  if (x.conceptBotst) {
    const cel = (wz.concepten[x.datum.slice(0, 4)] || {})[`${x.datum}|${kant === 'S' ? wz.plan.S : wz.plan.C}`];
    delen.push(`${VELD_LABEL.concept}: <b>${esc(cel ? (cel.nieuw || 'leeg') : '')}</b>`);
  }
  return delen.join('<br>');
}

function stap3() {
  const p = wz.plan;
  const bots = p.botsingen;
  let inhoud;
  if (!bots.length) {
    inhoud = `<div class="sv-gevolg">Geen botsingen: er is geen dag waarop op beide stoelen iets staat. Er gaat niets verloren.</div>`;
  } else {
    inhoud = `<p class="sv-tekst">Op ${bots.length === 1 ? 'deze dag' : `deze ${bots.length} dagen`} staat op beide stoelen iets. Kies per dag wat blijft. Voorstel: wat op ${esc(stoelNaam(p.S))} staat.</p>
      <div class="sv-alles">
        <button class="btn" onclick="window.svAlleBots('S')">Overal ${esc(stoelNaam(p.S))}</button>
        <button class="btn" onclick="window.svAlleBots('C')">Overal ${esc(stoelNaam(p.C))}</button>
      </div>
      <div class="sv-bots">${bots.map(x => {
        const k = wz.keuzes[x.datum] === 'C' ? 'C' : 'S';
        const kant = (zijde) => `<label class="sv-bots-kant ${k === zijde ? 'gekozen' : ''}">
            <input type="radio" name="svb_${x.datum}" ${k === zijde ? 'checked' : ''} onchange="window.svBots('${x.datum}','${zijde}')">
            <span><span class="muted">${esc(stoelNaam(zijde === 'S' ? p.S : p.C))}</span><br>${waardenVan(x, zijde)}</span></label>`;
        return `<div class="sv-bots-rij"><div class="sv-bots-datum">${esc(datumJ(x.datum))}</div>${kant('S')}${kant('C')}</div>`;
      }).join('')}</div>`;
  }
  return `${inhoud}
    ${knoppen('<button class="btn" onclick="window.svStap(2)">Vorige</button>', '<button class="btn btn-primary" onclick="window.svStap(4)">Volgende</button>')}`;
}

function stap4() {
  const p = wz.plan;
  const r = [];
  r.push(uitlegPlan(p));
  const naarS = tellingTekst(p.tellingen.naarS);
  const naarC = tellingTekst(p.tellingen.naarC);
  r.push(`<div>• Van ${esc(stoelNaam(p.C))} naar ${esc(stoelNaam(p.S))}: ${naarS ? esc(naarS) : 'niets'}.</div>`);
  if (naarC) r.push(`<div>• Van ${esc(stoelNaam(p.S))} naar ${esc(stoelNaam(p.C))} (de dagen vóór de datum): ${esc(naarC)}.</div>`);
  if (p.botsingen.length) {
    const nC = p.botsingen.filter(x => wz.keuzes[x.datum] === 'C').length;
    const nS = p.botsingen.length - nC;
    r.push(`<div>• Botsingen: ${p.botsingen.length} dag${p.botsingen.length === 1 ? '' : 'en'}. Blijft: ${nS}× ${esc(stoelNaam(p.S))}${nC ? `, ${nC}× ${esc(stoelNaam(p.C))}` : ''}. De andere waarde vervalt (terugdraaien zet hem terug).</div>`);
  } else {
    r.push('<div>• Botsingen: geen. Er gaat niets verloren.</div>');
  }
  r.push(p.gebruikers.length
    ? `<div>• Account: ${esc(p.gebruikers.map(g => g.naam).join(', '))} gaat mee naar ${esc(stoelNaam(p.S))}.</div>`
    : `<div>• Account: er hangt geen account aan ${esc(stoelNaam(p.C))}.</div>`);
  r.push(p.soort === 'los'
    ? `<div>• Tellingen: wat verhuist, telt voortaan op ${esc(stoelNaam(p.S))} (indeling, functietellingen en vakantie-V).</div>`
    : `<div>• Tellingen: ${esc(p.code)} telt elke dag nog maar één keer mee. Wat verhuist, telt voortaan op ${esc(stoelNaam(p.S))} (indeling, functietellingen en vakantie-V).</div>`);
  r.push(`<div>• Loopbaan: blijft zichtbaar als één persoon (één persoon-id).${p.pidWeg ? ' Het tweede persoon-id vervalt.' : ''}</div>`);
  return `<div class="sv-gevolg">${r.join('')}</div>
    <p class="muted sv-klein">Je kunt dit terugdraaien via Beheer › Stoel bezetting › Recente stoel-wijzigingen.</p>
    ${knoppen('<button class="btn" onclick="window.svStap(3)">Vorige</button>',
      `<button class="btn btn-primary" id="svDoe" ${wz.bezig ? 'disabled' : ''} onclick="window.svUitvoeren()">${wz.bezig ? 'Bezig…' : 'Samenvoegen'}</button>`)}`;
}

window.svStap = function(n) {
  if (n >= 3 && (!wz.plan || wz.plan.fout)) { wz.stap = 2; teken(); return; }
  wz.stap = n;
  teken();
};
window.svKiesStoel = function(id) {
  wz.keuze = { blijftId: id, datum: standaardDatum(wz.bev, id) };
  wz.keuzes = {};
  herbereken();
  teken();
};
window.svDatum = function(v) {
  wz.keuze = { ...wz.keuze, datum: v || null };
  herbereken();
  teken();
};
window.svBots = function(datum, kant) {
  wz.keuzes[datum] = kant === 'C' ? 'C' : 'S';
  teken();
};
window.svAlleBots = function(kant) {
  (wz.plan?.botsingen || []).forEach(x => { wz.keuzes[x.datum] = kant === 'C' ? 'C' : 'S'; });
  teken();
};

const botsHandtekening = (plan) => JSON.stringify((plan.botsingen || []).map(x => [x.datum, x.botsVelden, x.conceptBotst]));

window.svUitvoeren = async function() {
  if (wz.bezig) return;
  // Opnieuw uitrekenen op de gegevens van nu: is er intussen iets veranderd,
  // dan eerst opnieuw laten kijken.
  const vers = zoekBevinding(wz.sleutel);
  if (!vers) { closeSheet(); await meld('Niets meer te doen', 'Dit probleem is er niet meer.'); return; }
  wz.bev = vers;
  wz.concepten = await laadConcepten(vers);
  const oud = wz.plan;
  herbereken();
  if (wz.plan.fout) { wz.stap = 2; teken(); return; }
  if (botsHandtekening(oud) !== botsHandtekening(wz.plan)) {
    wz.stap = 3; teken();
    await meld('Intussen veranderd', 'Het rooster is intussen veranderd. Bekijk de botsingen nog even.');
    return;
  }
  const p = wz.plan;
  wz.bezig = true; teken();
  try {
    Object.entries(p.stoelUpdates).forEach(([id, upd]) => assertBezettingGeldig(upd.bezetting_historie, id));
  } catch (e) {
    wz.bezig = false; teken();
    await meld('Niet samengevoegd', String(e.message || e));
    return;
  }
  const opdr = schrijfOpdrachten(p, wz.keuzes);
  const stoelen = [...new Set([...Object.keys(p.stoelUpdates), p.C])];
  const voor = snapshotStoelen(stoelen);
  const beschrijving = `Samengevoegd: ${p.code} — ${stoelNaam(p.C)} → ${stoelNaam(p.S)}${p.soort === 'los' ? ' (losse dagen)' : ` per ${datumJ(p.D)}`}`;
  try {
    await legMutatieVast({
      type: 'samenvoegen', stoelen, voor, ingangsdatum: p.D,
      roosterInvers: opdr.indeling.map(o => ({ datum: o.datum, herstel: o.herstel })),
      wensenInvers: p.wensen.map(w => ({ id: w.id, radioloog_id: w.van })),
      gebruikersInvers: p.gebruikers.map(g => ({ id: g.id, radioloog_id: g.van })),
      conceptInvers: opdr.concept.map(c => ({ jaar: c.jaar, sleutel: c.sleutel, cel: c.oud })),
      beschrijving,
    });
  } catch (e) {
    wz.bezig = false; teken();
    await meld('Niet samengevoegd', 'Het terugdraai-record kon niet worden vastgelegd, dus er is niets veranderd.\n\n' + String(e.message || e));
    return;
  }
  const veld = (v) => (v === WEG ? deleteField() : v);
  try {
    // 1. Stoelen.
    const b1 = writeBatch(db);
    Object.entries(p.stoelUpdates).forEach(([id, upd]) => b1.set(doc(db, 'radiologen', id), upd, { merge: true }));
    if (p.cVerwijderen) b1.delete(doc(db, 'radiologen', p.C));
    await b1.commit();
    // 2. Rooster (in blokken van 400).
    for (let i = 0; i < opdr.indeling.length; i += 400) {
      const b = writeBatch(db);
      opdr.indeling.slice(i, i + 400).forEach(o => {
        const data = {};
        Object.entries(o.upd).forEach(([k, v]) => { data[k] = veld(v); });
        b.update(doc(db, 'indeling', o.datum), data);
      });
      await b.commit();
    }
    // 3. Wensen.
    for (let i = 0; i < p.wensen.length; i += 400) {
      const b = writeBatch(db);
      p.wensen.slice(i, i + 400).forEach(w => b.update(doc(db, 'wensen', w.id), { radioloog_id: w.naar }));
      await b.commit();
    }
    // 4. Accounts.
    for (const g of p.gebruikers) await updateDoc(doc(db, 'gebruikers', g.id), { radioloog_id: g.naar });
    // 5. Concept van het tabblad Indelen.
    const perJaar = {};
    opdr.concept.forEach(c => { (perJaar[c.jaar] = perJaar[c.jaar] || {})[c.sleutel] = c.nieuw ? c.nieuw : deleteField(); });
    for (const [jaar, cellen] of Object.entries(perJaar)) {
      await setDoc(doc(db, 'indeling_concept', jaar), {
        jaar, cellen,
        bijgewerkt_door: state.profiel?.naam || state.profiel?.email || '',
        bijgewerkt_lokaal: new Date().toISOString(),
      }, { merge: true });
    }
  } catch (e) {
    wz.bezig = false;
    closeSheet();
    await meld('Samenvoegen niet afgemaakt', 'Halverwege ging iets mis: ' + String(e.message || e)
      + '\n\nDraai het terug via Beheer › Stoel bezetting › Recente stoel-wijzigingen; dan staat alles weer zoals het was.');
    if (window.__rooster_render) window.__rooster_render();
    return;
  }
  wz.bezig = false;
  closeSheet();
  await meld('Samengevoegd', `${p.code} staat nu op één stoel: ${stoelNaam(p.S)}${p.Svan ? ' vanaf ' + datumJ(p.Svan) : ''}.\n\nTerugdraaien kan via Beheer › Stoel bezetting › Recente stoel-wijzigingen.`);
  if (window.__rooster_render) window.__rooster_render();
};

// ---- Voorkomen (aangeroepen vanuit Beheer) ----------------------------------------
// Opent het venster voor het paar (stoel die verdwijnt, stoel die blijft).
export async function openSamenvoegenVoor(verdwijntId, blijftId, datum) {
  const bev = zoekDubbelen().find(b => b.soort === 'dubbel'
    && [b.a.stoelId, b.b.stoelId].includes(verdwijntId) && [b.a.stoelId, b.b.stoelId].includes(blijftId));
  if (!bev) { await meld('Niet gevonden', 'De app ziet hier (nog) geen dubbele persoon.'); return; }
  await window.openSamenvoegen(bev.sleutel, { blijftId, datum });
}
