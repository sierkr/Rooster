/**
 * Cloud Functions voor Indeling Radiologen
 *
 * Deze functions draaien server-side met admin-rechten. Ze omzeilen het
 * probleem dat `createUserWithEmailAndPassword` in de browser de ingelogde
 * gebruiker wisselt naar de nieuwe gebruiker.
 *
 * Functies:
 *   - gebruikerAanmaken: maakt Auth-account + Firestore-profiel in één
 *   - gebruikerVerwijderen: verwijdert Auth-account én Firestore-profiel
 *   - gebruikerResetWachtwoord: zet wachtwoord terug naar standaard + wachtwoord_gewijzigd: false
 *   - agendaFeed: iCal-feed voor agenda-abonnementen
 *   - auditIndeling (v3.28.0, K3): server-side, onvervalsbaar audit-log —
 *     schrijft bij ELKE wijziging aan een indeling-doc een diff-record naar
 *     de collectie audit_log, inclusief de uid van de veroorzaker (auth-
 *     context). Clients kunnen audit_log niet schrijven (zie firestore.rules);
 *     dit spoor kan dus niet worden vervalst of overgeslagen.
 *
 * Alle callable functies controleren dat de aanroeper een beheerder is.
 */

const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onDocumentWrittenWithAuthContext } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

// Region: europe-west1 voor latency + AVG
const REGION = "europe-west1";

// ============================================================================
// Helpers
// ============================================================================

// v3.30.0 (H4): server-side omgevingscheck. De app stuurt bij account-
// functies zijn omgeving mee ('prod'/'test', bepaald uit de URL). Deze
// functies werken ALTIJD op de live database + Auth; een aanroep die
// expliciet uit de testomgeving komt wordt daarom server-side geweigerd —
// voorheen was die blokkade alleen client-side. (Een ontbrekende omgeving
// wordt toegestaan voor achterwaartse compatibiliteit; de client-side
// blokkade blijft daarnaast bestaan.)
function assertProductieOmgeving(data) {
  if (data && data.omgeving && data.omgeving !== "prod") {
    throw new HttpsError(
      "failed-precondition",
      "Gebruikersbeheer is uitgeschakeld buiten de productieomgeving — dit zou de live database raken."
    );
  }
}

// v3.30.0 (H3): willekeurig tijdelijk wachtwoord (crypto), 14 tekens.
function genereerTijdelijkWachtwoord() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const buf = require("crypto").randomBytes(14);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

async function assertBeheerder(auth) {
  if (!auth) {
    throw new HttpsError("unauthenticated", "Niet ingelogd");
  }
  const db = getFirestore();
  const snap = await db.collection("gebruikers").doc(auth.uid).get();
  if (!snap.exists) {
    throw new HttpsError("permission-denied", "Geen gebruikersprofiel");
  }
  const data = snap.data();
  if (data.rol !== "beheerder") {
    throw new HttpsError("permission-denied", "Alleen beheerders mogen dit");
  }
  return { uid: auth.uid, data };
}

function valideerRol(rol) {
  const geldige = ["beheerder", "radioloog", "secretariaat", "technician", "lezer"];
  if (!geldige.includes(rol)) {
    throw new HttpsError("invalid-argument", `Ongeldige rol: ${rol}`);
  }
}

// ============================================================================
// gebruikerAanmaken
// Input: { email, wachtwoord, rol, radioloog_id?, weergavenaam? }
// Output: { uid, email }
// ============================================================================
exports.gebruikerAanmaken = onCall({ region: REGION }, async (request) => {
  assertProductieOmgeving(request.data);
  const beheerder = await assertBeheerder(request.auth);

  const { email, wachtwoord, rol, radioloog_id, naam, weergavenaam } = request.data || {};

  if (!email || !wachtwoord) {
    throw new HttpsError("invalid-argument", "E-mail en wachtwoord zijn verplicht");
  }
  if (wachtwoord.length < 12) {
    throw new HttpsError("invalid-argument", "Wachtwoord min. 12 tekens");
  }
  valideerRol(rol);

  const auth = getAuth();
  const db = getFirestore();

  let nieuweUser;
  try {
    const userData = {
      email: email.trim(),
      password: wachtwoord,
      emailVerified: false,
      disabled: false,
    };
    const displayName = naam || weergavenaam;
    if (displayName) {
      userData.displayName = displayName;
    }
    nieuweUser = await auth.createUser(userData);
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "E-mailadres is al in gebruik");
    }
    if (err.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Ongeldig e-mailadres");
    }
    throw new HttpsError("internal", `Auth-fout: ${err.message}`);
  }

  try {
    await db.collection("gebruikers").doc(nieuweUser.uid).set({
      email: email.trim(),
      naam: naam || null,
      rol,
      radioloog_id: radioloog_id || null,
      wachtwoord_gewijzigd: false,
      aangemaakt_op: FieldValue.serverTimestamp(),
      aangemaakt_door: beheerder.uid,
    });
  } catch (err) {
    // Rollback: verwijder Auth-account als Firestore-schrijven faalt
    try { await auth.deleteUser(nieuweUser.uid); } catch (_) { /* negeer */ }
    throw new HttpsError("internal", `Firestore-fout: ${err.message}`);
  }

  return { uid: nieuweUser.uid, email: nieuweUser.email };
});

// ============================================================================
// gebruikerVerwijderen
// Input: { uid }
// Output: { verwijderd: true }
// ============================================================================
exports.gebruikerVerwijderen = onCall({ region: REGION }, async (request) => {
  assertProductieOmgeving(request.data);
  const beheerder = await assertBeheerder(request.auth);
  const { uid } = request.data || {};

  if (!uid) {
    throw new HttpsError("invalid-argument", "UID is verplicht");
  }
  if (uid === beheerder.uid) {
    throw new HttpsError("failed-precondition", "Je kunt jezelf niet verwijderen");
  }

  const auth = getAuth();
  const db = getFirestore();

  // Eerst Firestore (kan falen bij non-existent, dat is prima)
  try {
    await db.collection("gebruikers").doc(uid).delete();
  } catch (err) {
    // Negeer als document al weg is
  }

  // Dan Auth
  try {
    await auth.deleteUser(uid);
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      // Prima, account was er al niet
    } else {
      throw new HttpsError("internal", `Auth-verwijder-fout: ${err.message}`);
    }
  }

  return { verwijderd: true };
});

// ============================================================================
// gebruikerResetWachtwoord
// Input: { uid }
// v3.30.0 (H3): genereert een WILLEKEURIG tijdelijk wachtwoord (voorheen een
// vast, in de code leesbaar standaardwachtwoord), markeert
// wachtwoord_gewijzigd: false en geeft het tijdelijke wachtwoord eenmalig
// terug aan de aanroepende beheerder. Het wordt nergens opgeslagen.
// ============================================================================
exports.gebruikerResetWachtwoord = onCall({ region: REGION }, async (request) => {
  assertProductieOmgeving(request.data);
  await assertBeheerder(request.auth);
  const { uid } = request.data || {};

  if (!uid) {
    throw new HttpsError("invalid-argument", "UID is verplicht");
  }

  const auth = getAuth();
  const db = getFirestore();

  try {
    await auth.getUser(uid);
  } catch (err) {
    throw new HttpsError("not-found", "Gebruiker niet gevonden");
  }

  const tijdelijkWachtwoord = genereerTijdelijkWachtwoord();

  try {
    await auth.updateUser(uid, { password: tijdelijkWachtwoord });
    await db.collection("gebruikers").doc(uid).update({ wachtwoord_gewijzigd: false });
    return { ok: true, tijdelijkWachtwoord };
  } catch (err) {
    throw new HttpsError("internal", `Reset mislukt: ${err.message}`);
  }
});
// ============================================================================
// agendaFeed
// HTTP GET ?token=<agenda_token>
// Geeft een iCal-feed (.ics) terug met de indeling van de gekoppelde radioloog
// voor de komende 90 dagen en de afgelopen 30 dagen.
// ============================================================================
// v3.30.0 (M1): eenvoudige best-effort rate limiting per token (per warme
// instance): max 30 verzoeken per 5 minuten. Beschermt tegen brute-force op
// tokens en tegen agenda-apps die doorslaan in poll-frequentie.
const _feedVerzoeken = new Map(); // token -> [timestamps]
function feedRateLimitOverschreden(token) {
  const nu = Date.now();
  const lijst = (_feedVerzoeken.get(token) || []).filter((t) => nu - t < 5 * 60 * 1000);
  lijst.push(nu);
  _feedVerzoeken.set(token, lijst);
  if (_feedVerzoeken.size > 1000) _feedVerzoeken.clear(); // geheugen-vangnet
  return lijst.length > 30;
}

exports.agendaFeed = onRequest({ region: REGION, cors: false }, async (req, res) => {
  const token = req.query.token;
  // v3.30.0 (M1): tokenformaat afdwingen (UUID) — alles daarbuiten is per
  // definitie ongeldig en verdient geen database-query.
  if (!token || !/^[0-9a-f-]{36}$/i.test(String(token))) {
    res.status(404).send('Ongeldige of ingetrokken link'); return;
  }
  if (feedRateLimitOverschreden(String(token))) {
    res.status(429).send('Te veel verzoeken — probeer later opnieuw'); return;
  }

  const db = getFirestore();

  // Zoek gebruiker met dit token
  const gebruikersSnap = await db.collection('gebruikers')
    .where('agenda_token', '==', token)
    .limit(1)
    .get();

  if (gebruikersSnap.empty) { res.status(404).send('Ongeldige of ingetrokken link'); return; }

  const gebruiker = gebruikersSnap.docs[0].data();
  const radId = gebruiker.radioloog_id;
  if (!radId) { res.status(404).send('Geen radioloog gekoppeld aan dit account'); return; }

  // Datumrange: 30 dagen terug t/m 90 dagen vooruit
  const nu = new Date();
  const van = new Date(nu); van.setDate(van.getDate() - 30);
  const tot = new Date(nu); tot.setDate(tot.getDate() + 90);
  const vanIso = van.toISOString().slice(0, 10);
  const totIso = tot.toISOString().slice(0, 10);

  const indelingSnap = await db.collection('indeling')
    .where('datum', '>=', vanIso)
    .where('datum', '<=', totIso)
    .get();

  // Radioloog-naam ophalen
  let radNaam = radId;
  try {
    const radSnap = await db.collection('radiologen').doc(radId).get();
    if (radSnap.exists) {
      const r = radSnap.data();
      radNaam = `${r.code || ''} ${r.achternaam || ''}`.trim();
    }
  } catch (_) {}

  // Functies ophalen voor uitgeschreven namen
  const functiesMap = {};
  try {
    const functiesSnap = await db.collection('functies').get();
    functiesSnap.docs.forEach(d => { const data = d.data(); const key = data.code || d.id; functiesMap[key] = data; });
  } catch (_) {}

  function functieNaam(code) {
    // Probeer exacte match, dan zonder punt-prefix, dan eerste hoofdletter
    const f = functiesMap[code]
      || functiesMap[code.replace(/^\./, '')]
      || functiesMap[code.replace(/^\./, '').replace(/^[0-9]+/, '').replace(/^YY/, '').charAt(0).toUpperCase()];
    if (!f) return code;
    return f.naam ? f.naam.split('/')[0].trim() : code;
  }

  // iCal opbouwen
  const now = toIcalDate(new Date());
  let ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Indeling Radiologen ZMC//NL',
    `X-WR-CALNAME:Indeling ${radNaam}`,
    'X-WR-TIMEZONE:Europe/Amsterdam',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  indelingSnap.docs.forEach(d => {
    const dag = d.data();
    const codes = dag.toewijzingen?.[radId];
    if (!codes || !codes.length) return;

    // SUMMARY: codes uitgeschreven, bijv. "W · Weekdienst, B · Beschikbaar"
    const codeArray = Array.isArray(codes) ? codes : [codes];
    const label = codeArray.map(c => `${c} · ${functieNaam(c)}`).join(', ');

    // DESCRIPTION: alleen de EIGEN cel-opmerking. v3.30.0 (M1/M6): de
    // dag-opmerking is uit de feed gehaald — die kan informatie over
    // anderen bevatten en hoort niet thuis in een extern (token-beveiligd
    // maar onge-authenticeerd) kanaal. In de app blijft hij gewoon zichtbaar.
    const celOpm = dag.cel_opmerkingen?.[radId] || '';
    const beschrijving = celOpm ? `Opmerking: ${celOpm}` : '';
    const datumStr = dag.datum.replace(/-/g, '');

    ical.push('BEGIN:VEVENT');
    ical.push(`UID:${dag.datum}-${radId}@rooster-radiologie`);
    ical.push(`DTSTAMP:${now}`);
    ical.push(`DTSTART;VALUE=DATE:${datumStr}`);
    ical.push(`DTEND;VALUE=DATE:${datumStr}`);
    ical.push(`SUMMARY:${escIcal(label)}`);
    if (beschrijving) ical.push(`DESCRIPTION:${escIcal(beschrijving)}`);
    ical.push('END:VEVENT');
  });

  ical.push('END:VCALENDAR');

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="indeling-${radId}.ics"`);
  // v3.30.0 (M1): niet cachen door tussenliggende proxies; 5 min client-cache
  res.set('Cache-Control', 'private, max-age=300');
  res.set('X-Content-Type-Options', 'nosniff');
  res.status(200).send(ical.join('\r\n'));
});

function toIcalDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function escIcal(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// ============================================================================
// auditIndeling (v3.28.0, K3)
// Firestore-trigger op indeling/{datum} in de (default) database.
// Schrijft per wijziging één diff-record naar audit_log/ met:
//   - wie   (auth_uid + auth_type uit de auth-context van de write)
//   - wat   (per veld/sleutel: van → naar; alleen de daadwerkelijk
//            gewijzigde sleutels van maps als toewijzingen/cel_opmerkingen)
//   - wanneer (servertijd) en op welke datum (doc-id)
// Dit log wordt uitsluitend hier (Admin SDK) geschreven; de rules blokkeren
// elke client-write. Let op: de testomgeving gebruikt de named database
// 'test' — deze trigger bewaakt alleen productie ((default)).
// ============================================================================

// Velden met platte waarden: diff als geheel
const AUDIT_SCALAIRE_VELDEN = [
  "opmerking", "bespreking", "interventie", "weeknr", "dag",
  "vakantie_min", "vakantie_rank", "vakantie_geaccordeerd", "vakantie_x",
];
// Map-velden: diff per sleutel (radId e.d.)
const AUDIT_MAP_VELDEN = ["toewijzingen", "cel_opmerkingen", "dienst", "vakantie_v"];

function _auditDiff(voor, na) {
  const diff = {};
  const eq = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

  for (const veld of AUDIT_SCALAIRE_VELDEN) {
    if (!eq(voor[veld], na[veld])) {
      diff[veld] = { van: voor[veld] === undefined ? null : voor[veld], naar: na[veld] === undefined ? null : na[veld] };
    }
  }
  for (const veld of AUDIT_MAP_VELDEN) {
    const v = voor[veld] || {};
    const n = na[veld] || {};
    const sleutels = new Set([...Object.keys(v), ...Object.keys(n)]);
    const veldDiff = {};
    for (const k of sleutels) {
      if (!eq(v[k], n[k])) {
        veldDiff[k] = { van: v[k] === undefined ? null : v[k], naar: n[k] === undefined ? null : n[k] };
      }
    }
    if (Object.keys(veldDiff).length > 0) diff[veld] = veldDiff;
  }
  return diff;
}

exports.auditIndeling = onDocumentWrittenWithAuthContext(
  { region: REGION, document: "indeling/{datum}" },
  async (event) => {
    const voorSnap = event.data && event.data.before;
    const naSnap = event.data && event.data.after;
    const voor = voorSnap && voorSnap.exists ? voorSnap.data() : {};
    const na = naSnap && naSnap.exists ? naSnap.data() : {};

    const aangemaakt = !(voorSnap && voorSnap.exists);
    const verwijderd = !(naSnap && naSnap.exists);
    const velden = _auditDiff(voor, na);

    // Niets materieel gewijzigd (bv. idempotente merge van alleen metadata)
    if (!aangemaakt && !verwijderd && Object.keys(velden).length === 0) return;

    const db = getFirestore();
    await db.collection("audit_log").add({
      datum: event.params.datum,
      tijdstip: FieldValue.serverTimestamp(),
      event_tijd: event.time || null,
      auth_uid: event.authId || null,
      auth_type: event.authType || null,
      aangemaakt,
      verwijderd,
      velden,
    });
  }
);
