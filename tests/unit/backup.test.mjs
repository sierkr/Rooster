// Unit-tests voor de online backup (v3.39.0): Rooster-functions/functions/
// backup-kern.js, met nep-database en nep-opslag (geen emulator nodig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const kern = require('../../Rooster-functions/functions/backup-kern.js');

// Een tijdstempel zoals firebase-admin hem teruggeeft.
const tijd = (iso) => ({ toDate: () => new Date(iso), toMillis: () => Date.parse(iso) });

function nepDb(inhoud) {
  const geschreven = [];
  return {
    geschreven,
    collection: (naam) => ({
      get: async () => ({ docs: (inhoud[naam] || []).map(([id, data]) => ({ id, data: () => data })) }),
      doc: (id) => ({ set: async (v, o) => { geschreven.push({ naam, id, v, o }); } }),
    }),
  };
}

function nepOpslag() {
  const bestanden = new Map();
  return {
    bestanden,
    file: (naam) => ({
      save: async (inhoud, opties) => {
        bestanden.set(naam, { inhoud, metadata: { size: String(Buffer.byteLength(inhoud)), timeCreated: new Date().toISOString(), metadata: opties.metadata.metadata } });
      },
      download: async () => {
        if (!bestanden.has(naam)) throw new Error('No such object');
        return [Buffer.from(bestanden.get(naam).inhoud, 'utf8')];
      },
      delete: async () => { bestanden.delete(naam); },
    }),
    getFiles: async ({ prefix }) => [[...bestanden.entries()]
      .filter(([n]) => n.startsWith(prefix))
      .map(([name, b]) => ({ name, metadata: b.metadata }))],
  };
}

const VOORBEELD = {
  radiologen: [['W1', { code: 'GJG', bezetting_historie: [{ van: '2026-07-06', tot: null }] }]],
  indeling: [['2026-11-02', { datum: '2026-11-02', toewijzingen: { W1: ['A'] } }]],
  wensen: [['w1', { datum: '2026-11-06', radioloog_id: 'W1', verwerkt_op: tijd('2026-10-30T09:15:00.000Z') }]],
  gebruikers: [['u1', { rol: 'beheerder', naam: 'sierk' }]],
};

test('backup maken: één bestand met alle collecties, tijdstempels leesbaar, laatste backup bijgewerkt', async () => {
  const db = nepDb(VOORBEELD), opslag = nepOpslag();
  const nu = new Date('2026-10-31T02:15:00.000Z');
  const r = await kern.maakBackup({ db, bucket: opslag, omgeving: 'prod', reden: 'nacht', door: 'automatisch', nu });
  assert.equal(r.pad, 'backups/prod/2026-10-31T02-15-00-000Z_nacht.json');
  assert.equal(r.aantallen.indeling, 1);
  assert.equal(r.aantallen.functies, 0);
  const data = JSON.parse(opslag.bestanden.get(r.pad).inhoud);
  assert.deepEqual(Object.keys(data).filter(k => k !== '_meta').sort(), [...kern.COLLECTIES].sort());
  assert.deepEqual(data._meta.collecties, kern.COLLECTIES);
  assert.equal(data._meta.reden, 'nacht');
  assert.deepEqual(data.indeling[0], { id: '2026-11-02', datum: '2026-11-02', toewijzingen: { W1: ['A'] } });
  assert.deepEqual(data.wensen[0].verwerkt_op, { __tijd: '2026-10-30T09:15:00.000Z' });
  assert.deepEqual(data.radiologen[0].bezetting_historie, [{ van: '2026-07-06', tot: null }]);
  assert.deepEqual(db.geschreven, [{ naam: 'instellingen', id: 'algemeen',
    v: { laatste_backup: '2026-10-31T02:15:00.000Z', laatste_backup_reden: 'nacht' }, o: { merge: true } }]);
  assert.equal(opslag.bestanden.get(r.pad).metadata.metadata.reden, 'nacht');
});

test('onbekende omgeving of reden wordt geweigerd', async () => {
  await assert.rejects(kern.maakBackup({ db: nepDb({}), bucket: nepOpslag(), omgeving: 'live', reden: 'nacht' }), /Onbekende omgeving/);
  await assert.rejects(kern.maakBackup({ db: nepDb({}), bucket: nepOpslag(), omgeving: 'prod', reden: 'zomaar' }), /Onbekende reden/);
});

test('lijst: alleen de eigen omgeving, nieuwste eerst', async () => {
  const opslag = nepOpslag();
  for (const [omg, iso, reden] of [['prod', '2026-10-29T02:15:00Z', 'nacht'], ['prod', '2026-10-31T07:00:00Z', 'handmatig'],
    ['test', '2026-10-30T10:00:00Z', 'voor-import'], ['prod', '2026-10-30T02:15:00Z', 'nacht']]) {
    await kern.maakBackup({ db: nepDb({}), bucket: opslag, omgeving: omg, reden, nu: new Date(iso) });
  }
  const live = await kern.lijstBackups({ bucket: opslag, omgeving: 'prod' });
  assert.deepEqual(live.map(b => [b.tijdstip.slice(0, 10), b.reden]), [['2026-10-31', 'handmatig'], ['2026-10-30', 'nacht'], ['2026-10-29', 'nacht']]);
  const test = await kern.lijstBackups({ bucket: opslag, omgeving: 'test' });
  assert.deepEqual(test.map(b => b.reden), ['voor-import']);
  assert.ok(live.every(b => b.grootte > 0));
});

test('ophalen: alleen geldige backup-paden', async () => {
  const opslag = nepOpslag();
  const r = await kern.maakBackup({ db: nepDb(VOORBEELD), bucket: opslag, omgeving: 'test', reden: 'handmatig' });
  const inhoud = await kern.haalBackup({ bucket: opslag, pad: r.pad });
  assert.equal(JSON.parse(inhoud)._meta.omgeving, 'test');
  for (const pad of ['backups/prod/../geheim.json', 'gebruikers/u1', 'backups/elders/x.json', '', null]) {
    await assert.rejects(kern.haalBackup({ bucket: opslag, pad }), /Ongeldige backup/);
  }
  assert.equal(kern.omgevingVanPad(r.pad), 'test');
  assert.equal(kern.omgevingVanPad('backups/prod/2026-10-31T02-15-00-000Z_nacht.json'), 'prod');
});

test('opruimen: ouder dan 30 dagen weg, maar de nieuwste vijf blijven altijd', async () => {
  const opslag = nepOpslag();
  const nu = new Date('2026-10-31T03:00:00Z');
  const dagen = [0, 1, 2, 10, 29, 31, 35, 40];
  for (const d of dagen) {
    await kern.maakBackup({ db: nepDb({}), bucket: opslag, omgeving: 'prod', reden: 'nacht', nu: new Date(nu.getTime() - d * 86400000) });
  }
  const weg = await kern.ruimOp({ bucket: opslag, omgeving: 'prod', nu });
  assert.equal(weg, 3); // 31, 35 en 40 dagen oud
  assert.equal((await kern.lijstBackups({ bucket: opslag, omgeving: 'prod' })).length, 5);

  // Al weken geen backup gelukt: dan blijven de laatste vijf toch staan.
  const oud = nepOpslag();
  for (const d of [50, 60, 70]) {
    await kern.maakBackup({ db: nepDb({}), bucket: oud, omgeving: 'prod', reden: 'nacht', nu: new Date(nu.getTime() - d * 86400000) });
  }
  assert.equal(await kern.ruimOp({ bucket: oud, omgeving: 'prod', nu }), 0);
});

test('serialiseer laat gewone gegevens ongemoeid', () => {
  const v = { a: 1, b: 'x', c: null, d: [1, { e: true }], f: { g: [] } };
  assert.deepEqual(kern.serialiseer(v), v);
});

test('een test-backup kan nooit in live worden teruggezet; live in test wel', () => {
  assert.equal(kern.magTerugzetten('prod', 'test'), false);
  assert.equal(kern.magTerugzetten('test', 'prod'), true);
  assert.equal(kern.magTerugzetten('prod', 'prod'), true);
  assert.equal(kern.magTerugzetten('test', 'test'), true);
  assert.equal(kern.magTerugzetten('live', 'prod'), false);
});
