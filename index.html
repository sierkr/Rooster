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
 *
 * Alle functies controleren dat de aanroeper een beheerder is.
 */

const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

// Region: europe-west1 voor latency + AVG
const REGION = "europe-west1";

// ============================================================================
// Helpers
// ============================================================================

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
  const beheerder = await assertBeheerder(request.auth);

  const { email, wachtwoord, rol, radioloog_id, naam, weergavenaam } = request.data || {};

  if (!email || !wachtwoord) {
    throw new HttpsError("invalid-argument", "E-mail en wachtwoord zijn verplicht");
  }
  if (wachtwoord.length < 6) {
    throw new HttpsError("invalid-argument", "Wachtwoord min. 6 tekens");
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
// Zet wachtwoord terug naar standaard en markeert wachtwoord_gewijzigd: false,
// zodat de gebruiker bij de volgende login het eerste-aanmelding proces doorloopt.
// ============================================================================
exports.gebruikerResetWachtwoord = onCall({ region: REGION }, async (request) => {
  await assertBeheerder(request.auth);
  const { uid } = request.data || {};

  if (!uid) {
    throw new HttpsError("invalid-argument", "UID is verplicht");
  }

  const STANDAARD_WACHTWOORD = "RoosterZMC";
  const auth = getAuth();
  const db = getFirestore();

  try {
    await auth.getUser(uid);
  } catch (err) {
    throw new HttpsError("not-found", "Gebruiker niet gevonden");
  }

  try {
    await auth.updateUser(uid, { password: STANDAARD_WACHTWOORD });
    await db.collection("gebruikers").doc(uid).update({ wachtwoord_gewijzigd: false });
    return { ok: true };
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
exports.agendaFeed = onRequest({ region: REGION, cors: false }, async (req, res) => {
  const token = req.query.token;
  if (!token) { res.status(400).send('Token ontbreekt'); return; }

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

    // DESCRIPTION: cel-opmerking en dag-opmerking
    const celOpm = dag.cel_opmerkingen?.[radId] || '';
    const dagOpm = dag.opmerking || '';
    const delen = [];
    if (celOpm) delen.push(`Opmerking: ${celOpm}`);
    if (dagOpm) delen.push(`Dag: ${dagOpm}`);
    const beschrijving = delen.join('\n');
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
  res.status(200).send(ical.join('\r\n'));
});

function toIcalDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function escIcal(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
