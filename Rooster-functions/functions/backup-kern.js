/**
 * Kern van de online backup (v3.39.0).
 *
 * Wat de server doet bij een backup: alle collecties van één database lezen,
 * er één JSON-bestand van maken en dat in de opslag (Cloud Storage van het
 * eigen Firebase-project) zetten onder backups/<omgeving>/. Geen wachtwoord:
 * alleen een ingelogde beheerder kan via de app een backup maken, zien of
 * terugzetten (index.js controleert dat), en Google versleutelt de opslag
 * zelf, net als de database.
 *
 * Dit bestand kent Firebase niet: database en opslag komen binnen als
 * argument. Daardoor controleren de unit-tests (tests/unit/backup.test.mjs)
 * het met nep-opslag, zonder emulator.
 *
 * Het bestand heeft hetzelfde formaat als een ontsleutelde backup uit de app
 * (backup-client.js): { _meta, <collectie>: [ { id, ...velden } ] }. Een
 * tijdstempel wordt { __tijd: "<ISO>" }; de app maakt er bij terugzetten
 * weer een echte tijdstempel van.
 */

// Zelfde lijst als BACKUP_COLLECTIES in app/backup-client.js. 'wijzigingen'
// en 'audit_log' horen er bewust niet in (alleen aan te vullen, niet terug te
// zetten — zie de uitleg daar).
const COLLECTIES = [
  "radiologen", "functies", "indeling", "wensen",
  "gebruikers", "instellingen", "validatie_regels", "besprekingen",
  "vakantie_rankings", "bezetting_mutaties",
];
const OMGEVINGEN = { prod: "(default)", test: "test" };
const REDENEN = ["nacht", "handmatig", "voor-import", "voor-publicatie", "voor-terugzetten"];
const BEWAAR_DAGEN = 30;
const ALTIJD_BEWAREN = 5; // de nieuwste vijf blijven altijd staan

function fout(code, tekst) {
  const e = new Error(tekst);
  e.kernCode = code;
  return e;
}

function controleerOmgeving(o) {
  if (!Object.prototype.hasOwnProperty.call(OMGEVINGEN, o)) throw fout("invalid-argument", "Onbekende omgeving.");
  return o;
}
function controleerReden(r) {
  if (!REDENEN.includes(r)) throw fout("invalid-argument", "Onbekende reden voor de backup.");
  return r;
}

// Firestore-waarden naar gewone JSON. Tijdstempels krijgen een herkenbare vorm.
function serialiseer(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(serialiseer);
  if (typeof v === "object") {
    if (typeof v.toDate === "function" && typeof v.toMillis === "function") {
      return { __tijd: v.toDate().toISOString() };
    }
    if (typeof v.path === "string" && v.firestore) return { __ref: v.path };
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = serialiseer(x);
    return o;
  }
  return v;
}

function padVoor(omgeving, reden, nu) {
  return `backups/${omgeving}/${nu.toISOString().replace(/[:.]/g, "-")}_${reden}.json`;
}
// Welke omgeving hoort bij een pad? null = geen geldig backup-pad.
function omgevingVanPad(pad) {
  const m = /^backups\/(prod|test)\/[A-Za-z0-9_-]+\.json$/.exec(String(pad || ""));
  return m ? m[1] : null;
}
// Mag een backup uit `bron` worden teruggezet in `doel`? Een test-backup
// nooit in live; een live-backup in test wel (oefenen met echte gegevens).
function magTerugzetten(doel, bron) {
  if (!OMGEVINGEN[doel] || !OMGEVINGEN[bron]) return false;
  return !(doel === "prod" && bron === "test");
}
function redenUitNaam(naam) {
  const m = /_([a-z-]+)\.json$/.exec(naam);
  return m ? m[1] : "";
}

async function maakBackup({ db, bucket, omgeving, reden, door = "", nu = new Date() }) {
  controleerOmgeving(omgeving);
  controleerReden(reden);
  const data = { _meta: null };
  const aantallen = {};
  for (const naam of COLLECTIES) {
    const snap = await db.collection(naam).get();
    data[naam] = snap.docs.map((d) => ({ id: d.id, ...serialiseer(d.data()) }));
    aantallen[naam] = data[naam].length;
  }
  const tijdstip = nu.toISOString();
  data._meta = {
    tijdstip, reden, door, omgeving, collecties: COLLECTIES, aantallen,
    formaat_versie: "3.0", bron: "server",
  };
  const inhoud = JSON.stringify(data);
  const pad = padVoor(omgeving, reden, nu);
  await bucket.file(pad).save(inhoud, {
    contentType: "application/json",
    resumable: false,
    metadata: { metadata: { reden, door: String(door || ""), tijdstip, aantallen: JSON.stringify(aantallen) } },
  });
  // De waarschuwing "laatste backup" in de app leest dit.
  await db.collection("instellingen").doc("algemeen").set(
    { laatste_backup: tijdstip, laatste_backup_reden: reden }, { merge: true });
  return { pad, tijdstip, reden, aantallen, grootte: Buffer.byteLength(inhoud, "utf8") };
}

async function lijstBackups({ bucket, omgeving }) {
  controleerOmgeving(omgeving);
  const [files] = await bucket.getFiles({ prefix: `backups/${omgeving}/` });
  return files
    .filter((f) => omgevingVanPad(f.name) === omgeving)
    .map((f) => {
      const m = f.metadata || {};
      const eigen = m.metadata || {};
      return {
        pad: f.name, omgeving,
        tijdstip: eigen.tijdstip || m.timeCreated || null,
        reden: eigen.reden || redenUitNaam(f.name),
        door: eigen.door || "",
        grootte: Number(m.size || 0),
      };
    })
    .sort((a, b) => String(b.tijdstip || "").localeCompare(String(a.tijdstip || "")));
}

async function haalBackup({ bucket, pad }) {
  if (!omgevingVanPad(pad)) throw fout("invalid-argument", "Ongeldige backup.");
  const [buf] = await bucket.file(pad).download();
  return buf.toString("utf8");
}

// Ruimt backups ouder dan BEWAAR_DAGEN op; de nieuwste ALTIJD_BEWAREN blijven.
async function ruimOp({ bucket, omgeving, nu = new Date(), dagen = BEWAAR_DAGEN }) {
  const lijst = await lijstBackups({ bucket, omgeving });
  const grens = new Date(nu.getTime() - dagen * 86400000).toISOString();
  const weg = lijst.slice(ALTIJD_BEWAREN).filter((b) => b.tijdstip && b.tijdstip < grens);
  for (const b of weg) await bucket.file(b.pad).delete({ ignoreNotFound: true });
  return weg.length;
}

module.exports = {
  COLLECTIES, OMGEVINGEN, REDENEN, BEWAAR_DAGEN, ALTIJD_BEWAREN,
  controleerOmgeving, controleerReden, serialiseer, padVoor, omgevingVanPad, magTerugzetten,
  maakBackup, lijstBackups, haalBackup, ruimOp,
};
