// backup-client.js — in-app Firestore backup als versleuteld JSON-download.
// Versleuteling: AES-256-GCM met sleutel afgeleid via PBKDF2 (Web Crypto API).
// Geen externe libraries — alles ingebouwd in de browser.
//
// Gebruik:
//   import { maakClientBackup, herstelClientBackup } from './backup-client.js';
//   await maakClientBackup('handmatig');
//
// Restore: upload het .json-bestand via Beheer → "Backup terugzetten".
// LET OP: bij vergeten wachtwoord is de backup NIET te herstellen.

import { collection, getDocs, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, IS_TEST_DB } from './firebase-init.js';
import { state } from './state.js';

// 'wijzigingen' zit er bewust NIET in: de Firestore-rules maken de audit-log
// append-only (create eist uid == eigen uid, geen updates/deletes), dus een
// restore van die collectie zou tegen de rules stranden.
const BACKUP_COLLECTIES = [
  'radiologen', 'functies', 'indeling', 'wensen',
  'gebruikers', 'instellingen', 'validatie_regels', 'besprekingen',
  'vakantie_rankings',
];

function tijdstempel() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadBlob(inhoud, bestandsnaam) {
  const blob = new Blob([inhoud], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = bestandsnaam;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

// ---- Crypto helpers ---------------------------------------------------------

function base64Encode(buf) {
  // Bytes in vaste blokken verwerken i.p.v. in één keer spreaden: bij een grote
  // backup (veel radiologen/indelingen/historie) overschrijdt
  // String.fromCharCode(...bytes) anders de argumentenlimiet van de engine,
  // wat zich uitte als "Maximum call stack size exceeded".
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000; // 32768 bytes per stuk, ruim onder elke argumentenlimiet
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
function base64Decode(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

async function sleutelVanWachtwoord(wachtwoord, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(wachtwoord), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function versleutel(plaintext, wachtwoord) {
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await sleutelVanWachtwoord(wachtwoord, salt);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  return {
    encrypted:    true,
    formaat:      'AES-256-GCM-PBKDF2-v1',
    salt:         base64Encode(salt),
    iv:           base64Encode(iv),
    data:         base64Encode(data),
  };
}

async function ontsleutel(obj, wachtwoord) {
  const dec  = new TextDecoder();
  const salt = base64Decode(obj.salt);
  const iv   = base64Decode(obj.iv);
  const data = base64Decode(obj.data);
  const key  = await sleutelVanWachtwoord(wachtwoord, salt);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return dec.decode(plain);
  } catch {
    throw new Error('Onjuist wachtwoord of beschadigd bestand.');
  }
}

// ---- Wachtwoord opvragen ----------------------------------------------------

function vraagWachtwoord(titel, bevestig = false) {
  const ww = prompt(titel + '\n\nLET OP: bij vergeten wachtwoord is de backup niet terug te zetten.');
  if (!ww) return null;
  if (bevestig) {
    const ww2 = prompt('Bevestig het wachtwoord:');
    if (ww !== ww2) {
      alert('Wachtwoorden komen niet overeen. Backup geannuleerd.');
      return null;
    }
  }
  if (ww.length < 6) {
    alert('Wachtwoord moet minimaal 6 tekens zijn.');
    return null;
  }
  return ww;
}

// ---- Hoofd-functies ---------------------------------------------------------

/**
 * Maakt een versleutelde Firestore-backup en downloadt die als JSON.
 * De beheerder kiest zelf een wachtwoord.
 */
export async function maakClientBackup(reden = 'handmatig') {
  // In de testomgeving kan geen backup gemaakt worden: een backup van testdata
  // zou per ongeluk in de live-agenda teruggezet kunnen worden. Door het maken
  // bij de bron te blokkeren, kan zo'n testbackup simpelweg niet bestaan.
  if (IS_TEST_DB) {
    return { geblokkeerd: true, reden: 'test' };
  }
  // Wachtwoord opvragen (bij automatische voor-import backup ook)
  const wachtwoord = vraagWachtwoord(
    `Kies een wachtwoord voor deze backup (reden: ${reden}).`,
    true
  );
  if (!wachtwoord) return null; // geannuleerd

  // Data ophalen
  const resultaten = await Promise.all(
    BACKUP_COLLECTIES.map(naam =>
      getDocs(collection(db, naam))
        .then(snap => ({ naam, docs: snap.docs.map(d => ({ id: d.id, ...d.data() })) }))
        .catch(err => ({ naam, docs: [], fout: err.message }))
    )
  );

  const data = { _meta: null };
  const aantallen = {};
  for (const { naam, docs } of resultaten) {
    data[naam] = docs;
    aantallen[naam] = docs.length;
  }

  const tijdstip = new Date().toISOString();
  data._meta = { tijdstip, reden, collecties: BACKUP_COLLECTIES, aantallen, formaat_versie: '2.0' };

  // Versleutelen
  const envelop = await versleutel(JSON.stringify(data), wachtwoord);
  envelop._info = { tijdstip, reden }; // leesbaar zonder wachtwoord (geen gevoelige data)

  // Download — bestandsnaam eenmalig genereren zodat geschiedenis overeenkomt
  const bestandsnaam = 'rooster-backup-' + tijdstempel() + '.json';
  downloadBlob(JSON.stringify(envelop, null, 2), bestandsnaam);

  // Tijdstip + geschiedenis opslaan in Firestore
  const nieuweEntry  = { tijdstip, reden, bestandsnaam };
  const huidigeGesch = Array.isArray(state?.instellingen?.backup_geschiedenis)
    ? state.instellingen.backup_geschiedenis
    : [];
  const nieuweGesch  = [nieuweEntry, ...huidigeGesch].slice(0, 10);

  await setDoc(
    doc(db, 'instellingen', 'algemeen'),
    {
      laatste_backup:         tijdstip,
      laatste_backup_reden:   reden,
      backup_geschiedenis:    nieuweGesch,
    },
    { merge: true }
  );

  // State direct bijwerken zodat renderGebView() meteen de nieuwe waarden ziet
  // (onSnapshot-listener kan te laat komen na snel re-renderen)
  if (state && state.instellingen) {
    state.instellingen.laatste_backup       = tijdstip;
    state.instellingen.laatste_backup_reden = reden;
    state.instellingen.backup_geschiedenis  = nieuweGesch;
  }

  return { tijdstip, aantallen };
}

/**
 * Zet een versleuteld backup-bestand terug naar Firestore.
 * Vraagt het wachtwoord op, ontsleutelt, en schrijft naar Firestore.
 */
export async function herstelClientBackup(file, onVoortgang = () => {}) {
  const { writeBatch, doc: fsDoc } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
  );

  const tekst  = await file.text();
  const envelop = JSON.parse(tekst);

  // Tijdstip tonen (leesbaar zonder wachtwoord)
  const info = envelop._info || {};
  onVoortgang(`Backup van: ${info.tijdstip ? new Date(info.tijdstip).toLocaleString('nl-NL') : 'onbekend'}`);

  // Ontsleutelen
  if (!envelop.encrypted) {
    throw new Error('Dit bestand is niet versleuteld of heeft een onbekend formaat.');
  }
  const wachtwoord = prompt('Voer het wachtwoord in voor deze backup:');
  if (!wachtwoord) throw new Error('Geen wachtwoord ingevoerd.');

  onVoortgang('Ontsleutelen…');
  const plaintext = await ontsleutel(envelop, wachtwoord);
  const data = JSON.parse(plaintext);
  const meta = data._meta || {};

  onVoortgang(`Backup bevat ${Object.values(meta.aantallen || {}).reduce((a,b)=>a+b,0)} documenten.`);

  const collecties = meta.collecties || BACKUP_COLLECTIES;
  let totaal = 0;

  for (const naam of collecties) {
    const items = data[naam];
    if (!Array.isArray(items) || items.length === 0) {
      onVoortgang(`${naam}: overgeslagen`);
      continue;
    }
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

  onVoortgang(`Klaar — ${totaal} documenten hersteld.`);
  return totaal;
}
