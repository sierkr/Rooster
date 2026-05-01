// Algemene helpers: datum/tijd, permissies, lookup-maps, functie-flags.
// Deze module heeft géén afhankelijkheid op DOM of Firebase.
import { state, VASTE_RAD_IDS, SLOTS, DAGEN_NL, DAGEN_LANG, MAANDEN } from './state.js';

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
export function magOpmerkingen()      { return state.profiel?.rol === 'beheerder' || state.profiel?.rol === 'secretariaat'; }
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

// Geeft de bezetting-entry die op `datum` op deze stoel zit, of null als
// de stoel op die datum leeg is.
export function bezettingOpDatum(slotId, datum) {
  const stoel = state.radiologen.find(r => r.id === slotId);
  if (!stoel) return null;
  const hist = Array.isArray(stoel.bezetting_historie) ? stoel.bezetting_historie : null;
  if (hist && hist.length > 0) {
    const entry = hist.find(e => _binnen(e, datum));
    if (!entry) return null;
    return {
      slotId,
      voornaam: entry.voornaam || '',
      achternaam: entry.achternaam || '',
      code: entry.code || stoel.code || slotId,
      vakantierecht: typeof entry.vakantierecht === 'number' ? entry.vakantierecht : (stoel.vakantierecht ?? 40),
      parttime_factor: typeof entry.parttime_factor === 'number' ? entry.parttime_factor : (stoel.parttime_factor ?? 1),
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

// Vaste radiologen op een gegeven datum. Wanneer een stoel leeg is op die
// datum (geen geldige entry), valt hij terug op het ruwe stoel-record zodat
// de kolom-volgorde stabiel blijft. Default datum = vandaag.
export function vasteRadsOpDatum(datum) {
  const d = datum || vandaagIso();
  return VASTE_RAD_IDS.map(id => {
    const b = bezettingOpDatum(id, d);
    const stoel = state.radiologen.find(r => r.id === id);
    if (!stoel) return null;
    if (b) return { ...stoel, ...b, id };
    return stoel;
  }).filter(Boolean);
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
  const c = code.replace(/^\./, '').replace(/^[0-9]+/, '').replace(/^YY/, '').charAt(0).toUpperCase();
  return `f-${c}`;
}
export function functieNaam(code) {
  const f = functiesMap()[code];
  if (f) return f.naam;
  const kort = (code || '').replace(/^\./, '').replace(/^[0-9]+/, '').replace(/^YY/, '').charAt(0).toUpperCase();
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
  if (!code) return { werkvloer: false, werkdag: false };
  // Roostervrij: niet werkvloer, niet werkdag
  if (['P','4P','Q','R','V'].includes(code)) return { werkvloer: false, werkdag: false };
  // Wel werkdag, niet werkvloer (cursus/ziek/transfer/admin)
  if (['K','Z','T','A'].includes(code)) return { werkvloer: false, werkdag: true };
  // Alle overige: werkvloer + werkdag (5A, W-varianten, B/E/M/D/S/O-varianten, X)
  return { werkvloer: true, werkdag: true };
}
export function functieFlags(code) {
  const f = functiesMap()[code];
  const def = defaultFunctieFlags(code);
  return {
    werkvloer: typeof f?.werkvloer === 'boolean' ? f.werkvloer : def.werkvloer,
    werkdag:   typeof f?.werkdag === 'boolean'   ? f.werkdag   : def.werkdag,
  };
}
export function parttimeFactor(radId) {
  const r = state.radiologen.find(x => x.id === radId);
  if (!r) return 1;
  const f = Number(r.parttime_factor);
  return (Number.isFinite(f) && f > 0 && f <= 1) ? f : 1;
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

export function genereerWachtwoord() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({length: 10}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Standaard-wachtwoord voor nieuwe gebruikers. Bij eerste login wordt
// gebruiker gedwongen dit te wijzigen.
export const STANDAARD_WACHTWOORD = 'RoosterZMC';

// Validatie. Voorlopig alleen min. 6 tekens; eisen kunnen hier worden uitgebreid.
export function valideerWachtwoord(pw) {
  if (typeof pw !== 'string') return 'Wachtwoord ontbreekt';
  if (pw.length < 6) return 'Wachtwoord moet minimaal 6 tekens zijn';
  if (pw === STANDAARD_WACHTWOORD) return 'Kies een ander wachtwoord dan het standaard wachtwoord';
  return null; // geldig
}
