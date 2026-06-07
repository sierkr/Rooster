/**
 * Volledige backup van Firestore naar JSON-bestanden.
 *
 * Maakt een map "backup-YYYY-MM-DD-HHMM" met:
 *   - radiologen.json
 *   - functies.json
 *   - besprekingen.json
 *   - indeling.json
 *   - validatie_regels.json
 *   - wensen.json
 *   - gebruikers.json (zonder wachtwoorden — die zijn alleen in Auth)
 *   - instellingen.json
 *   - wijzigingen.json (audit log)
 *   - meta.json (versie, datum, projectnaam)
 *
 * Gebruik:
 *   1. serviceAccountKey.json naast dit bestand zetten
 *   2. npm install firebase-admin (eenmalig)
 *   3. node backup.js
 *
 * Aanrader: maandelijks, of voor elke grote wijziging.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const COLLECTIES = [
  'radiologen', 'functies', 'besprekingen', 'indeling',
  'validatie_regels', 'wensen', 'gebruikers', 'instellingen', 'wijzigingen',
];

function tijdstempel() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function exportCollectie(naam) {
  const snap = await db.collection(naam).get();
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return items;
}

async function main() {
  const stamp = tijdstempel();
  const map = path.join(__dirname, `backup-${stamp}`);
  fs.mkdirSync(map, { recursive: true });
  console.log(`Backup naar ${map}`);

  let totaal = 0;
  for (const naam of COLLECTIES) {
    try {
      const items = await exportCollectie(naam);
      const pad = path.join(map, `${naam}.json`);
      fs.writeFileSync(pad, JSON.stringify(items, null, 2));
      console.log(`  ${naam}: ${items.length} documenten`);
      totaal += items.length;
    } catch (err) {
      console.error(`  ${naam}: FOUT — ${err.message}`);
    }
  }

  // Meta
  const meta = {
    backup_tijdstip: new Date().toISOString(),
    project_id: serviceAccount.project_id,
    aantal_documenten: totaal,
    collecties: COLLECTIES,
    formaat_versie: '1.0',
  };
  fs.writeFileSync(path.join(map, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log(`\nKlaar. Totaal: ${totaal} documenten in ${map}`);
  console.log(`\nLet op: dit is een data-backup. Auth-accounts (e-mail/wachtwoord) staan niet in deze backup.`);
  console.log(`Voor volledige restore: data hieruit + Auth-accounts opnieuw aanmaken via Firebase Console of script.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
