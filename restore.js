/**
 * Restore vanuit een backup-map naar Firestore.
 *
 * LET OP: Dit overschrijft bestaande documenten met dezelfde ID.
 * Auth-accounts worden NIET hersteld — die moeten apart aangemaakt worden.
 *
 * Gebruik:
 *   node restore.js backup-2026-04-25-1430
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const backupMap = process.argv[2];
if (!backupMap) {
  console.error('Gebruik: node restore.js <backup-map>');
  process.exit(1);
}

const COLLECTIES = [
  'radiologen', 'functies', 'besprekingen', 'instellingen',
  'validatie_regels', 'gebruikers', 'wensen', 'indeling', 'wijzigingen',
];

async function importCollectie(naam) {
  const pad = path.join(__dirname, backupMap, `${naam}.json`);
  if (!fs.existsSync(pad)) {
    console.log(`  ${naam}: bestand ontbreekt, overslaan`);
    return 0;
  }
  const items = JSON.parse(fs.readFileSync(pad, 'utf-8'));
  const BATCH = 400;
  let totaal = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = db.batch();
    for (const item of items.slice(i, i + BATCH)) {
      const { id, ...rest } = item;
      if (!id) continue;
      batch.set(db.collection(naam).doc(String(id)), rest);
    }
    await batch.commit();
    totaal += Math.min(BATCH, items.length - i);
  }
  return totaal;
}

async function main() {
  console.log(`Restore vanuit ${backupMap}`);
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, backupMap, 'meta.json'), 'utf-8'));
  console.log(`Backup gemaakt: ${meta.backup_tijdstip}`);
  console.log(`Project: ${meta.project_id}\n`);

  console.log('Doorgaan? Dit overschrijft bestaande documenten met dezelfde ID.');
  console.log('Druk Ctrl+C om af te breken, of wacht 5 seconden...\n');
  await new Promise(r => setTimeout(r, 5000));

  for (const naam of COLLECTIES) {
    try {
      const aantal = await importCollectie(naam);
      console.log(`  ${naam}: ${aantal} documenten teruggezet`);
    } catch (err) {
      console.error(`  ${naam}: FOUT — ${err.message}`);
    }
  }

  console.log('\nKlaar.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
