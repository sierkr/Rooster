// backup-client.js — in-app Firestore backup als JSON-download.
// Werkt volledig vanuit de browser (geen Node.js of serviceAccountKey nodig).
//
// Gebruik:
//   import { maakClientBackup } from './backup-client.js';
//   await maakClientBackup('handmatig');        // download + sla tijdstip op
//   await maakClientBackup('voor-import');      // zelfde, andere reden
//
// Restore: upload het JSON-bestand via de Beheer-tab → "Backup terugzetten".

import { collection, getDocs, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';

// Collecties die worden meegenomen in de backup (alles behalve wijzigingen-log).
const BACKUP_COLLECTIES = [
  'radiologen', 'functies', 'indeling', 'wensen',
  'gebruikers', 'instellingen', 'validatie_regels', 'besprekingen',
];

function tijdstempel() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadJson(obj, bestandsnaam) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = bestandsnaam;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

/**
 * Maakt een volledige Firestore-backup als JSON-download.
 * Slaat het tijdstip op in instellingen/algemeen.
 * @param {string} reden  'handmatig' | 'voor-import' | 'periodiek'
 * @returns {Promise<{ tijdstip, aantallen }>}
 */
export async function maakClientBackup(reden = 'handmatig') {
  const data = { _meta: null };

  // Lees alle collecties parallel
  const resultaten = await Promise.all(
    BACKUP_COLLECTIES.map(naam =>
      getDocs(collection(db, naam))
        .then(snap => ({
          naam,
          docs: snap.docs.map(d => ({ id: d.id, ...d.data() })),
        }))
        .catch(err => ({ naam, docs: [], fout: err.message }))
    )
  );

  const aantallen = {};
  for (const { naam, docs } of resultaten) {
    data[naam] = docs;
    aantallen[naam] = docs.length;
  }

  const tijdstip = new Date().toISOString();
  data._meta = {
    tijdstip,
    reden,
    collecties: BACKUP_COLLECTIES,
    aantallen,
    formaat_versie: '2.0',
  };

  // Download
  downloadJson(data, `rooster-backup-${tijdstempel()}.json`);

  // Sla tijdstip op in Firestore zodat de UI dit kan tonen
  await setDoc(
    doc(db, 'instellingen', 'algemeen'),
    { laatste_backup: tijdstip, laatste_backup_reden: reden },
    { merge: true }
  );

  return { tijdstip, aantallen };
}

/**
 * Zet een eerder gedownload JSON-backup-bestand terug naar Firestore.
 * Overschrijft bestaande documenten met dezelfde ID.
 * Auth-accounts worden NIET hersteld.
 * @param {File} file  het .json-backupbestand
 * @param {Function} onVoortgang  callback(tekst) voor statusmeldingen
 */
export async function herstelClientBackup(file, onVoortgang = () => {}) {
  const { writeBatch, doc: fsDoc } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
  );

  const tekst = await file.text();
  const data  = JSON.parse(tekst);
  const meta  = data._meta || {};

  onVoortgang(`Backup van ${meta.tijdstip || 'onbekend'} gevonden.`);

  const collecties = meta.collecties || BACKUP_COLLECTIES;
  let totaal = 0;

  for (const naam of collecties) {
    const items = data[naam];
    if (!Array.isArray(items) || items.length === 0) {
      onVoortgang(`${naam}: overgeslagen (leeg of ontbreekt)`);
      continue;
    }
    // Schrijf in batches van 400
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(db);
      for (const item of items.slice(i, i + 400)) {
        const { id, ...rest } = item;
        if (!id) continue;
        batch.set(fsDoc(db, naam, String(id)), rest);
      }
      await batch.commit();
    }
    totaal += items.length;
    onVoortgang(`${naam}: ${items.length} documenten teruggezet`);
  }

  onVoortgang(`Klaar. ${totaal} documenten hersteld.`);
  return totaal;
}
