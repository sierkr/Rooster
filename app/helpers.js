// Algemene helpers: datum/tijd, permissies, lookup-maps, functie-flags.
// Deze module heeft géén afhankelijkheid op DOM of Firebase.
import { state, VASTE_RAD_IDS, SLOTS, DAGEN_NL, DAGEN_LANG, MAANDEN, AFWEZIG_CODES } from './state.js';

// ==== Permissies =============================================================

export function defaultPermissies(rol) {
  if (rol === 'beheerder') return {
    mag_beheer: true, mag_beheer_lezen: true, mag_regels: true,
    mag_gebruikers: true, mag_wensen_alle: true, mag_vakantie: true,
  };
  if (rol === 'secretariaat') return {
    mag_beheer: false, mag_beheer_lezen: false, mag_regels: false,
    mag_gebruikers: false, mag_wensen_alle: false, mag_vakantie: false,
  };
  if (rol === 'radioloog') return {
    mag_beheer: false, mag_beheer_lezen: true, mag_regels: false,
    mag_gebruikers: false, mag_wensen_alle: false, mag_vakantie: true,
  };
  if (rol === 'technician' || rol === 'lezer') return {
    mag_beheer: false, mag_beheer_lezen: false, mag_regels: false,
    mag_gebruikers: false, mag_wensen_alle: false, mag_vakantie: false,
  };
  return {
    mag_beheer: false, mag_beheer_lezen: false, mag_regels: false,
    mag_gebruikers: false, mag_wensen_alle: false, mag_vakantie: false,
  };
}
export function permissie(naam) {
  const p = state.profiel;
  if (!p) return false;
  if (p.permissies && naam in p.permissies) return !!p.permissies[naam];
  return !!defaultPermissies(p.rol)[naam];
}
export function magWijzigen()         { return permissie('mag_beheer'); }
export function magBeheerLezen()      { return permissie('mag_beheer_lezen') || permissie('mag_beheer'); }
export function magOpmerkingen()      { return state.profiel?.rol === 'beheerder'; }
export function magGebruikersBeheren(){ return permissie('mag_gebruikers'); }
export function magRegelsBeheren()    { return permissie('mag_regels'); }
export function magAlleWensenZien()   { return permissie('mag_wensen_alle'); }
export function magVakantieZien()     { return permissie('mag_vakantie'); }

// Effectieve rol: behandelt 'lezer' als 'technician' voor achterwaartse compatibiliteit.
export function effectieveRol() {
  const r = state.profiel?.rol;
  if (r === 'lezer') return 'technician';
  return r;
}
// Beperkt-zicht-rollen zien alleen Overzicht, Afdeling en Dienst.
export function isBeperktZichtRol() {
  const r = effectieveRol();
  return r === 'secretariaat' || r === 'technician';
}

// ==== Lookup-maps ============================================================

export function radiologenMap() {
  return Object.fromEntries(state.radiologen.map(r => [r.id, r]));
}
export function functiesMap() {
  return Object.fromEntries(state.functies.map(f => [f.id, f]));
}
export function kolomNaarRadId() {
  const map = {};
  (state.radiologen || []).forEach(r => {
    const header = r.code || r.id;
    if (header) map[header] = r.id;
  });
  return map;
}
export function isHoofd(f) {
  const c = f.code || f.id || '';
  return !c.startsWith('.') && !c.startsWith('YY') && !/^\d/.test(c) && c !== '-' && c.length <= 3;
}

// ==== Bezetting per stoel over tijd =========================================
//
// Een "stoel" (slotId in VASTE_RAD_IDS of SLOTS) houdt een tijdlijn bij van
// wie er op zit, in `bezetting_historie`. Een entry is:
//   { voornaam, achternaam, code, vakantierecht, parttime_factor,
//     van: 'YYYY-MM-DD'|null, tot: 'YYYY-MM-DD'|null }
// `van=null` = altijd al; `tot=null` = lopend. Voor records zonder historie
// (oud datamodel) vallen we terug op de top-level velden alsof er één open
// entry van begin tot oneindig is.

function _binnen(entry, datum) {
  if (entry.van && datum < entry.van) return false;
  if (entry.tot && datum > entry.tot) return false;
  return true;
}

// Canonieke "meest recente entry"-selectie: geeft uit een lijst historie-
// entries de entry met de LAATSTE van-datum (van=null telt als oudste).
// De array-volgorde van bezetting_historie is géén betrouwbare recency-
// indicator — gebruik overal deze helper i.p.v. eigen zoek-loops.
export function laatsteEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  let beste = null, besteVan = '';
  entries.forEach(e => {
    const v = e.van || '0000-00-00';
    if (beste === null || v >= besteVan) { beste = e; besteVan = v; }
  });
  return beste;
}

// Clip een bezetting_historie voor een wissel/migratie per `datum`:
//  - open entries (tot=null) worden gesloten op de dag vóór `datum`;
//  - gesloten entries die tot op/ná `datum` doorlopen worden geclipt;
//  - entries die volledig op/ná `datum` beginnen vervallen.
// Zo kan een oude periode de nieuwe bezetter nooit overschaduwen.
export function clipHistorieVoorWissel(hist, datum) {
  const dagVoor = plusDagen(datum, -1);
  return (hist || [])
    .filter(e => !(e.van && e.van >= datum))
    .map(e => (!e.tot || e.tot >= datum) ? { ...e, tot: dagVoor } : { ...e });
}

// Geeft de bezetting-entry die op `datum` op deze stoel zit, of null als
// de stoel op die datum leeg is.
export function bezettingOpDatum(slotId, datum) {
  const stoel = state.radiologen.find(r => r.id === slotId);
  if (!stoel) return null;
  const hist = Array.isArray(stoel.bezetting_historie) ? stoel.bezetting_historie : null;
  if (hist && hist.length > 0) {
    // Bij overlappende entries (bv. historie die vóór de clip-fix niet werd
    // geclipt) wint de entry met de laatste van-datum — niet de eerste
    // array-match. Dit voorkomt shadowing ("W1" i.p.v. de juiste initialen).
    const entry = laatsteEntry(hist.filter(e => _binnen(e, datum)));
    if (!entry) return null;
    return {
      slotId,
      voornaam: entry.voornaam || '',
      achternaam: entry.achternaam || '',
      code: entry.code || stoel.code || slotId,
      vakantierecht: typeof entry.vakantierecht === 'number' ? entry.vakantierecht : (stoel.vakantierecht ?? 40),
      parttime_factor: typeof entry.parttime_factor === 'number' ? entry.parttime_factor : (stoel.parttime_factor ?? 1),
      in_dienst: entry.in_dienst || null,
      van: entry.van || null,
      tot: entry.tot || null,
    };
  }
  // Fallback: oud datamodel zonder historie. Behandel top-level als één
  // open entry. Voor W-slots geldt dat actief=false betekent "leeg".
  if (stoel.isSlot && stoel.actief === false) return null;
  return {
    slotId,
    voornaam: stoel.voornaam || '',
    achternaam: stoel.achternaam || '',
    code: stoel.code || slotId,
    vakantierecht: typeof stoel.vakantierecht === 'number' ? stoel.vakantierecht : 40,
    parttime_factor: typeof stoel.parttime_factor === 'number' ? stoel.parttime_factor : 1,
    in_dienst: stoel.in_dienst || null,
    van: null,
    tot: null,
  };
}

// Geeft de naam (of code) die in de kolomheader hoort op `datum`.
export function naamVoorSlotOpDatum(slotId, datum) {
  const b = bezettingOpDatum(slotId, datum);
  return b ? (b.code || b.achternaam || slotId) : slotId;
}

// Geeft alle bezetting-entries (uit historie) voor een stoel die overlappen
// met de range [van..tot]. Gebruikt door Activiteit-tab voor split-kolom.
export function bezettingenInRange(slotId, vanIso, totIso) {
  const stoel = state.radiologen.find(r => r.id === slotId);
  if (!stoel) return [];
  const hist = Array.isArray(stoel.bezetting_historie) ? stoel.bezetting_historie : null;
  // Zelfde leeg-check als bezettingOpDatum: een inactief W-slot zonder
  // historie is leeg en levert géén fallback-entry op. Zonder deze check
  // kreeg een leeg slot tóch een kolom in de Excel-export (met de slot-ID
  // als kolomkop), terwijl de app hem verbergt.
  if ((!hist || hist.length === 0) && stoel.isSlot && stoel.actief === false) return [];
  const lijst = hist && hist.length > 0
    ? hist.slice()
    : [{
        voornaam: stoel.voornaam || '',
        achternaam: stoel.achternaam || '',
        code: stoel.code || slotId,
        vakantierecht: stoel.vakantierecht,
        parttime_factor: stoel.parttime_factor,
        van: null, tot: null,
      }];
  return lijst
    .filter(e => {
      const eindOk = !e.tot || e.tot >= vanIso;
      const startOk = !e.van || e.van <= totIso;
      return eindOk && startOk;
    })
    .map(e => ({
      slotId,
      voornaam: e.voornaam || '',
      achternaam: e.achternaam || '',
      code: e.code || stoel.code || slotId,
      vakantierecht: typeof e.vakantierecht === 'number' ? e.vakantierecht : (stoel.vakantierecht ?? 40),
      parttime_factor: typeof e.parttime_factor === 'number' ? e.parttime_factor : (stoel.parttime_factor ?? 1),
      van: e.van || null,
      tot: e.tot || null,
    }));
}

// Alle vaste-stoel-id's: de oorspronkelijke 8 (VASTE_RAD_IDS) plus elke stoel
// die als extra vaste stoel is aangemaakt (vaste_stoel === true). W-slots tellen
// niet mee. Opgeheven stoel-id's worden nooit hergebruikt.
export function alleVasteStoelIds() {
  const ids = new Set(VASTE_RAD_IDS);
  (state.radiologen || []).forEach(r => {
    if (r && r.vaste_stoel === true && !SLOTS.includes(r.id)) ids.add(r.id);
  });
  return [...ids];
}
export function isVasteStoel(id) {
  if (VASTE_RAD_IDS.includes(id)) return true;
  return (state.radiologen || []).some(r => r.id === id && r.vaste_stoel === true && !SLOTS.includes(id));
}

// Datum-canoniek label voor een stoel/slot: wie zit er op `datum`. Elke
// weergave die toont wie een stoel bezet MOET dit gebruiken (of
// bezettingOpDatum) i.p.v. de rauwe top-level code/achternaam — die zijn een
// cache die bij een toekomstige wissel/→Vast al de nieuwe bezetter bevat,
// terwijl de datum-bewuste historie nog de juiste (oude) bezetter geeft. Dit
// was de oorzaak van "overzicht toont BL, maar dagdetail toont GJG".
export function bezetterLabelOpDatum(radId, datum) {
  const b = bezettingOpDatum(radId, datum);
  if (b) return { code: b.code || radId, achternaam: b.achternaam || '' };
  const r = radiologenMap()[radId];
  return { code: r?.code || radId, achternaam: r?.achternaam || '' };
}

// ==== Integriteit van bezetting_historie ====================================
// Eén stoel = één tijdlijn van niet-overlappende periodes [van, tot] (tot
// inclusief; tot=null = lopend). Deze controle bewaakt dat model: hooguit één
// lopende periode, geen omgekeerde periodes, en geen overlap tussen periodes.
// Gaten (een stoel die tijdelijk leeg staat) zijn toegestaan en gelden NIET als
// fout. Returnt een lijst probleem-strings; leeg = in orde.
export function controleerBezettingHistorie(stoel) {
  const problemen = [];
  const hist = Array.isArray(stoel?.bezetting_historie) ? stoel.bezetting_historie : [];
  if (hist.length === 0) return problemen;
  const open = hist.filter(e => !e.tot);
  if (open.length > 1) {
    problemen.push(`${open.length} lopende (open) periodes — er mag er hooguit één zijn`);
  }
  const sorted = hist.slice().sort((a, b) => (a.van || '0000-00-00') < (b.van || '0000-00-00') ? -1 : 1);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.van && e.tot && e.van > e.tot) {
      problemen.push(`periode ${e.code || '?'} begint (${e.van}) ná het einde (${e.tot})`);
    }
    if (i > 0) {
      const vorige = sorted[i - 1];
      if (!vorige.tot) {
        problemen.push(`open periode ${vorige.code || '?'} loopt door tot in ${e.code || '?'} — overlap`);
      } else if (e.van && e.van <= vorige.tot) {
        problemen.push(`overlap: ${vorige.code || '?'} (t/m ${vorige.tot}) en ${e.code || '?'} (vanaf ${e.van})`);
      }
    }
  }
  return problemen;
}

// Scant alle stoelen. Returnt [{ id, code, problemen[] }] voor stoelen met een
// integriteitsprobleem (leeg = alles in orde).
export function controleerAlleBezettingen() {
  const resultaat = [];
  (state.radiologen || []).forEach(stoel => {
    const p = controleerBezettingHistorie(stoel);
    if (p.length) resultaat.push({ id: stoel.id, code: stoel.code || stoel.id, problemen: p });
  });
  return resultaat;
}

// Guard voor de schrijf-paden (Wissel, →Vast, waarnemer opslaan, vertrek):
// gooit een fout als een net-samengestelde historie het model schendt, zodat
// een bug de database nooit met overlap/dubbele-open kan corrumperen. De
// aanroeper vangt de fout en toont de melding i.p.v. op te slaan.
export function assertBezettingGeldig(hist, contextLabel) {
  const problemen = controleerBezettingHistorie({ bezetting_historie: hist });
  if (problemen.length) {
    throw new Error(`Bezetting ${contextLabel || ''} is ongeldig en is NIET opgeslagen:\n- ` + problemen.join('\n- '));
  }
}

// ==== Persoon-id (Niveau 1) =================================================
// Een stabiel persoon-id identificeert een persoon over stoelen heen. Het leeft
// op de bezetting_historie-entries (en top-level op stoelen zonder historie,
// zoals W-stoelen). Bij een wissel/→Vast loopt het persoon_id mee, zodat het
// verleden van een persoon herleidbaar is — ook als codes (initialen) later
// hergebruikt worden. Niveau 1 = geen aparte 'personen'-collectie; de
// stamgegevens (naam/code) blijven gedenormaliseerd op de entries staan.
// Een persoon_id wordt NOOIT hergebruikt.
export function nieuwPersoonId() {
  return 'P' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Fallback-sleutel als een entry (nog) geen persoon_id heeft.
export function persoonFallbackKey(achternaam, code) {
  return `${(achternaam || '').toLowerCase()}|${(code || '').toLowerCase()}`;
}

// Verzamelt de loopbaan van één persoon: alle bezetting-periodes over álle
// stoelen heen. Match op persoon_id wanneer aanwezig, anders op de
// fallback-sleutel (achternaam|code). Periodes gesorteerd op van-datum.
export function loopbaanVoorPersoon(pid, fallbackKey) {
  const periodes = [];
  (state.radiologen || []).forEach(stoel => {
    const hist = Array.isArray(stoel.bezetting_historie) ? stoel.bezetting_historie : [];
    if (hist.length > 0) {
      hist.forEach(e => {
        const match = (pid && e.persoon_id)
          ? e.persoon_id === pid
          : persoonFallbackKey(e.achternaam, e.code) === fallbackKey;
        if (match) periodes.push({ stoelId: stoel.id, code: e.code || stoel.id, achternaam: e.achternaam || '', van: e.van || null, tot: e.tot || null });
      });
    } else if (stoel.code || stoel.achternaam) {
      // Stoel zonder historie (bv. W-stoel): huidige bezetter als open periode.
      const match = (pid && stoel.persoon_id)
        ? stoel.persoon_id === pid
        : persoonFallbackKey(stoel.achternaam, stoel.code) === fallbackKey;
      if (match) periodes.push({ stoelId: stoel.id, code: stoel.code || stoel.id, achternaam: stoel.achternaam || '', van: null, tot: null });
    }
  });
  periodes.sort((a, b) => (a.van || '0000-00-00') < (b.van || '0000-00-00') ? -1 : 1);
  return periodes;
}

// ==== Senioriteitsvolgorde (canonieke sorteerlogica) ========================
// Eén plek die bepaalt in welke volgorde vaste stoelen op senioriteit staan.
// Overzicht, Afdeling én Excel-export (export.js) gebruiken precies deze drie
// functies — niet elk hun eigen kopie van de formule — zodat kolomvolgorde
// nooit stilzwijgend uit elkaar kan lopen tussen de live-app en de export.
//
// senioriteitSortKey: de sorteersleutel voor één stoel op basis van de
// in_dienst-datum van de bezetter. Zonder in_dienst-datum valt een van de
// oorspronkelijke 8 stoelen terug op zijn vaste historische positie; een
// extra stoel zonder datum sorteert achteraan.
export function senioriteitSortKey(stoelId, inDienst) {
  // Onbekende in-dienstdatum sorteert achteraan (junior), i.p.v. de
  // oorspronkelijke stoelrang te erven. Zo blijft een overnemer zonder
  // ingevulde senioriteit niet op de senior-plek van de vorige bezetter staan.
  // De onderlinge volgorde van datum-loze stoelen blijft stabiel via de
  // idx-tiebreak in vasteIdxVoorStoel/vergelijkOpSenioriteit.
  return inDienst || '9999-01-01';
}
// vasteIdxVoorStoel: tie-break bij een gelijke sorteersleutel — de
// oorspronkelijke 8 (VASTE_RAD_IDS) houden hun onderlinge volgorde, extra
// stoelen komen achteraan.
export function vasteIdxVoorStoel(stoelId) {
  const idx = VASTE_RAD_IDS.indexOf(stoelId);
  return idx < 0 ? 100 : idx;
}
// vergelijkOpSenioriteit: comparator voor Array.sort. Verwacht objecten met
// minstens { sortKey, idx } (zie hierboven).
export function vergelijkOpSenioriteit(a, b) {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  return a.idx - b.idx;
}

// Vaste radiologen op een gegeven datum. Een stoel verschijnt alleen als er op
// die datum een actieve bezetter is (leeg = geen kolom). Het aantal kolommen
// volgt dus per datum uit de bezetting (8 nu, meer/minder na toevoegen/opheffen).
// Gesorteerd op anciënniteit (in_dienst, oudste = links) via de canonieke
// senioriteits-helpers hierboven. Default datum = vandaag.
export function vasteRadsOpDatum(datum) {
  const d = datum || vandaagIso();
  const lijst = alleVasteStoelIds().map((id) => {
    const stoel = state.radiologen.find(r => r.id === id);
    if (!stoel) return null;
    const b = bezettingOpDatum(id, d);
    if (!b) return null; // geen actieve bezetter op deze datum → geen kolom
    const obj = { ...stoel, ...b, id };
    obj.idx = vasteIdxVoorStoel(id); // extra stoelen achteraan bij gelijke sleutel
    obj.sortKey = senioriteitSortKey(id, obj.in_dienst);
    // Compat-aliassen: sommige aanroepers lazen voorheen _vasteIdx/_sortKey rechtstreeks.
    obj._vasteIdx = obj.idx;
    obj._sortKey = obj.sortKey;
    return obj;
  }).filter(Boolean);

  // Kolomvolgorde op anciënniteit: oudste in-dienst = links.
  lijst.sort(vergelijkOpSenioriteit);
  return lijst;
}
export function vasteRads() {
  return vasteRadsOpDatum(vandaagIso());
}

export function actieveInvallersOpDatum(datum) {
  const d = datum || vandaagIso();
  return SLOTS.map(id => {
    const b = bezettingOpDatum(id, d);
    if (!b) return null;
    const stoel = state.radiologen.find(r => r.id === id);
    if (!stoel) return null;
    if (stoel.actief === false && (!Array.isArray(stoel.bezetting_historie) || stoel.bezetting_historie.length === 0)) return null;
    return { ...stoel, ...b, id };
  }).filter(Boolean);
}
export function actieveInvallers() {
  return actieveInvallersOpDatum(vandaagIso());
}

// ==== Datum / week ===========================================================

export function vandaagIso() {
  const nu = new Date();
  const jaar = nu.getFullYear();
  const mm = String(nu.getMonth() + 1).padStart(2, '0');
  const dd = String(nu.getDate()).padStart(2, '0');
  return `${jaar}-${mm}-${dd}`;
}
export function huidigKalenderJaar() {
  return new Date().getFullYear();
}
export function isoWeekVan(iso) {
  // Volledig in UTC om tijdzone-shifts te vermijden.
  const [j, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(j, m - 1, d));
  const dagNr = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dagNr);
  const jaarStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt - jaarStart) / 86400000 + 1) / 7);
}
export function isoWeekJaarVan(iso) {
  // ISO-week-jaar = jaar van de donderdag van die week.
  const [j, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(j, m - 1, d));
  const dagNr = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dagNr);
  return dt.getUTCFullYear();
}
export function mandagVanIso(iso) {
  // Returns ISO-string van maandag van de week waarin iso valt.
  const [j, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(j, m - 1, d));
  const dagNr = dt.getUTCDay() || 7; // 1=ma..7=zo
  dt.setUTCDate(dt.getUTCDate() - (dagNr - 1));
  return dt.toISOString().slice(0, 10);
}
export function mandagVanWeek(jaar, week) {
  // Behouden voor compat (nummer-input). Returnt Date-object.
  const jan4 = new Date(Date.UTC(jaar, 0, 4));
  const dag = jan4.getUTCDay() || 7;
  const week1ma = new Date(jan4);
  week1ma.setUTCDate(jan4.getUTCDate() - dag + 1);
  const doel = new Date(week1ma);
  doel.setUTCDate(week1ma.getUTCDate() + (week - 1) * 7);
  return doel;
}
export function plusDagen(iso, n) {
  const [j, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(j, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export function datumsVanWeek(maandagIso) {
  // Pakt 7 datums vanaf de gegeven maandag. Accepteert ook nummer voor compat.
  if (typeof maandagIso === 'number') {
    const ma = mandagVanWeek(huidigKalenderJaar(), maandagIso);
    maandagIso = ma.toISOString().slice(0, 10);
  }
  const out = [];
  for (let i = 0; i < 7; i++) out.push(plusDagen(maandagIso, i));
  return out;
}
export function formatDatum(iso, stijl = 'kort') {
  const d = new Date(iso + 'T00:00:00');
  const dagNr = d.getDay() === 0 ? 6 : d.getDay() - 1;
  if (stijl === 'lang') return `${DAGEN_LANG[dagNr]} ${d.getDate()} ${MAANDEN[d.getMonth()]}`;
  if (stijl === 'kort') return `${DAGEN_NL[dagNr]} ${d.getDate()} ${MAANDEN[d.getMonth()]}`;
  return iso;
}
export function weekRange(maandagIso) {
  // Returnt range-string. Toont jaartal als de week niet in het huidige
  // kalenderjaar valt (gebaseerd op de maandag).
  if (typeof maandagIso === 'number') {
    const ma = mandagVanWeek(huidigKalenderJaar(), maandagIso);
    maandagIso = ma.toISOString().slice(0, 10);
  }
  const datums = datumsVanWeek(maandagIso);
  const a = new Date(datums[0] + 'T00:00:00');
  const b = new Date(datums[6] + 'T00:00:00');
  const huidigJaar = huidigKalenderJaar();
  const toonJaar = a.getFullYear() !== huidigJaar || b.getFullYear() !== huidigJaar;
  let str;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    str = `${a.getDate()} – ${b.getDate()} ${MAANDEN[a.getMonth()]}`;
  } else if (a.getFullYear() === b.getFullYear()) {
    str = `${a.getDate()} ${MAANDEN[a.getMonth()]} – ${b.getDate()} ${MAANDEN[b.getMonth()]}`;
  } else {
    // Cross-year (week 53 → week 1)
    return `${a.getDate()} ${MAANDEN[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MAANDEN[b.getMonth()]} ${b.getFullYear()}`;
  }
  if (toonJaar) str += ` ${b.getFullYear()}`;
  return str;
}

// ==== Functies / cellen ======================================================

export function fclass(code) {
  if (!code) return 'grid-cell-empty';
  return `f-${hoofdLetterCode(code)}`;
}
export function functieNaam(code) {
  const f = functiesMap()[code];
  if (f) return f.naam;
  const kort = hoofdLetterCode(code);
  return functiesMap()[kort]?.naam || code;
}
export function toewijzingVoor(datum, radId) {
  const dag = state.indelingMap[datum];
  if (!dag) return [];
  return dag.toewijzingen?.[radId] || [];
}
export function hoofdLetterCode(code) {
  // Pak de "rol-letter" uit een code: ".WB" -> "W", "5B" -> "B", "YYE1" -> "E"
  if (!code) return '';
  return code.replace(/^\./, '').replace(/^[0-9]+/, '').replace(/^YY/, '').charAt(0).toUpperCase();
}

// ==== Functie-flags (werkvloer / werkdag) ====================================

export function defaultFunctieFlags(code) {
  if (!code) return { werkvloer: false };
  // Roostervrij: niet werkvloer
  if (['P','4P','Q','R','V'].includes(code)) return { werkvloer: false };
  // Niet werkvloer (cursus/ziek/transfer/admin)
  if (['K','Z','T','A'].includes(code)) return { werkvloer: false };
  // Alle overige: werkvloer
  return { werkvloer: true };
}
export function functieFlags(code) {
  const f = functiesMap()[code];
  const def = defaultFunctieFlags(code);
  return {
    werkvloer: f?.werkvloer ?? def.werkvloer,
  };
}
export function parttimeFactor(radId) {
  const r = state.radiologen.find(x => x.id === radId);
  if (!r) return 1;
  const f = Number(r.parttime_factor);
  return (Number.isFinite(f) && f > 0 && f <= 1) ? f : 1;
}

// ==== Wens-matching (één canonieke implementatie) ============================
// Gebruikt door save.js (breek-check + auto-verwerk) en import.js (sync na
// import). Voorheen bestond deze logica op drie plekken; drift-risico.
// type: 'vakantie' | 'niet_beschikbaar' | 'voorkeur'.
export function wensMatcht(type, voorkeurCode, primaireCode) {
  const hoofd = hoofdLetterCode(primaireCode);
  if (type === 'vakantie')         return hoofd === 'V';
  if (type === 'niet_beschikbaar') return !primaireCode || AFWEZIG_CODES.includes(hoofd);
  if (type === 'voorkeur')         return hoofd === voorkeurCode;
  return false;
}

// ==== Diverse =================================================================

export function vertalFirebaseFout(code) {
  const map = {
    'auth/invalid-email': 'Ongeldig e-mailadres',
    'auth/invalid-credential': 'E-mail of wachtwoord onjuist',
    'auth/user-not-found': 'Gebruiker niet gevonden',
    'auth/wrong-password': 'Wachtwoord onjuist',
    'auth/too-many-requests': 'Te veel pogingen, probeer later opnieuw',
    'auth/network-request-failed': 'Geen internetverbinding',
    'auth/email-already-in-use': 'E-mailadres is al in gebruik',
    'auth/weak-password': 'Wachtwoord te kort (min. 6 tekens)',
  };
  return map[code] || `Fout: ${code}`;
}

// v3.30.0 (H3): cryptografisch veilige generator (Web Crypto) i.p.v.
// Math.random, en langer (14 tekens). Tekenset zonder verwarbare tekens.
export function genereerWachtwoord() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(14);
  crypto.getRandomValues(buf);
  return Array.from(buf, n => chars[n % chars.length]).join('');
}

// Standaard-wachtwoord voor nieuwe gebruikers. Bij eerste login wordt
// gebruiker gedwongen dit te wijzigen.
export const STANDAARD_WACHTWOORD = 'RoosterZMC';

// Validatie. Voorlopig alleen min. 6 tekens; eisen kunnen hier worden uitgebreid.
// v3.30.0 (H3): minimumlengte 6 → 12 voor nieuw gekozen wachtwoorden.
// Bestaande wachtwoorden blijven geldig; de eis geldt bij (eerste) wijziging.
export function valideerWachtwoord(pw) {
  if (typeof pw !== 'string') return 'Wachtwoord ontbreekt';
  if (pw.length < 12) return 'Wachtwoord moet minimaal 12 tekens zijn';
  if (pw === STANDAARD_WACHTWOORD) return 'Kies een ander wachtwoord dan het standaard wachtwoord';
  return null; // geldig
}

// ==== HTML escape =============================================================
// Maakt vrije-tekst uit Firestore veilig om te interpoleren in een
// template-string die later via innerHTML geinjecteerd wordt. Vervangt de
// vijf HTML-special characters door hun entiteit. Toepassen op alles wat de
// gebruiker zelf kon typen (opmerkingen, besprekingen, etc.).
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==== Feestdagen =============================================================
// Geeft true als de datum een Nederlandse officiële feestdag is.
// Gebruikt de feestdagen array uit de context-feestdag validatieregel.
export function isFeestdag(datum) {
  const regel = state.validatieRegels?.find(r => r.id === 'context-feestdag');
  if (!regel) return false;
  // Zoek alle feestdagen_YYYY velden
  return Object.entries(regel)
    .filter(([k]) => k.startsWith('feestdagen_'))
    .some(([, arr]) => Array.isArray(arr) && arr.includes(datum));
}
