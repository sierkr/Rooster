// Rules-tests: rollen-matrix tegen firestore.rules (v3.31.0, fase 4).
// Draait uitsluitend tegen de lokale emulator (firebase emulators:exec).
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';

let env;
let admin, radL, lezer; // Firestore-instanties per rol

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rooster',
    firestore: {
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
  });

  // Seed: gebruikersprofielen + wat basisdata (buiten de rules om)
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'gebruikers/uid-admin'), {
      rol: 'beheerder', email: 'admin@rooster.intern', naam: 'Admin', radioloog_id: null,
    });
    await setDoc(doc(db, 'gebruikers/uid-radl'), {
      rol: 'radioloog', email: 'radl@rooster.intern', naam: 'RadL',
      radioloog_id: 'L', wachtwoord_gewijzigd: false,
    });
    await setDoc(doc(db, 'gebruikers/uid-lezer'), {
      rol: 'lezer', email: 'lezer@rooster.intern', naam: 'Lezer', radioloog_id: null,
    });
    await setDoc(doc(db, 'indeling/2026-07-14'), {
      datum: '2026-07-14', weeknr: 29, dag: 'di',
      toewijzingen: { L: ['B'], P: ['E'] }, dienst: {}, vakantie_v: {},
    });
    await setDoc(doc(db, 'wijzigingen/w-eigen'), {
      uid: 'uid-admin', email: 'admin@rooster.intern', datum: '2026-07-14',
      radioloog_id: 'L', van: ['B'], naar: ['E'], gezien: false,
    });
    await setDoc(doc(db, 'audit_log/a1'), { datum: '2026-07-14', velden: {} });
  });

  admin = env.authenticatedContext('uid-admin').firestore();
  radL  = env.authenticatedContext('uid-radl').firestore();
  lezer = env.authenticatedContext('uid-lezer').firestore();
});

after(async () => { await env.cleanup(); });

// ---- indeling: schema-bewaking (K2) ----------------------------------------

test('beheerder: geldig indeling-doc aanmaken mag', async () => {
  await assertSucceeds(setDoc(doc(admin, 'indeling/2026-07-13'), {
    datum: '2026-07-13', weeknr: 29, dag: 'ma',
    toewijzingen: { L: ['B'] }, dienst: {},
  }));
});

test('beheerder: onbekend veld bij create wordt geweigerd', async () => {
  await assertFails(setDoc(doc(admin, 'indeling/2026-07-15'), {
    datum: '2026-07-15', weeknr: 29, dag: 'wo', toewijzingen: {}, onbekend_veld: true,
  }));
});

test('beheerder: datum-veld dat afwijkt van het doc-id wordt geweigerd', async () => {
  await assertFails(setDoc(doc(admin, 'indeling/2026-07-16'), {
    datum: '2026-07-17', weeknr: 29, dag: 'do', toewijzingen: {},
  }));
});

test('beheerder: toewijzingen met verkeerd type wordt geweigerd', async () => {
  await assertFails(setDoc(doc(admin, 'indeling/2026-07-14'),
    { toewijzingen: 'kapot' }, { merge: true }));
});

test('K1-semantiek: merge op één cel laat de cel van een collega intact', async () => {
  await assertSucceeds(setDoc(doc(admin, 'indeling/2026-07-14'),
    { datum: '2026-07-14', toewijzingen: { L: ['M'] } }, { merge: true }));
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), 'indeling/2026-07-14'));
    const t = snap.data().toewijzingen;
    if (JSON.stringify(t.P) !== JSON.stringify(['E'])) {
      throw new Error('cel van P is overschreven: ' + JSON.stringify(t));
    }
    if (JSON.stringify(t.L) !== JSON.stringify(['M'])) {
      throw new Error('cel van L is niet bijgewerkt: ' + JSON.stringify(t));
    }
  });
});

// ---- indeling: radioloog-rechten -------------------------------------------

test('radioloog: eigen vakantie_v-kolom toggelen mag', async () => {
  await assertSucceeds(updateDoc(doc(radL, 'indeling/2026-07-14'), {
    'vakantie_v.L': true,
  }));
});

test('radioloog: andermans vakantie_v-kolom wordt geweigerd', async () => {
  await assertFails(updateDoc(doc(radL, 'indeling/2026-07-14'), {
    'vakantie_v.P': true,
  }));
});

test('radioloog: toewijzingen schrijven wordt geweigerd', async () => {
  await assertFails(updateDoc(doc(radL, 'indeling/2026-07-14'), {
    'toewijzingen.L': ['V'],
  }));
});

test('radioloog: nieuw doc alleen met datum + eigen vakantie_v mag', async () => {
  await assertSucceeds(setDoc(doc(radL, 'indeling/2026-08-03'), {
    datum: '2026-08-03', vakantie_v: { L: true },
  }));
  await assertFails(setDoc(doc(radL, 'indeling/2026-08-04'), {
    datum: '2026-08-04', vakantie_v: { P: true },
  }));
});

test('lezer: indeling lezen mag, schrijven niet', async () => {
  await assertSucceeds(getDoc(doc(lezer, 'indeling/2026-07-14')));
  await assertFails(updateDoc(doc(lezer, 'indeling/2026-07-14'), { opmerking: 'x' }));
});

// ---- wijzigingen: aangescherpte create (K3) --------------------------------

function geldigeWijziging(uid, email) {
  return {
    uid, email, datum: '2026-07-14', radioloog_id: 'L',
    van: ['B'], naar: ['E'], wanneer: serverTimestamp(), gezien: false,
  };
}

test('beheerder: geldig wijziging-record aanmaken mag', async () => {
  await assertSucceeds(setDoc(doc(admin, 'wijzigingen/w1'),
    geldigeWijziging('uid-admin', 'admin@rooster.intern')));
});

test('wijziging met andermans uid wordt geweigerd', async () => {
  await assertFails(setDoc(doc(admin, 'wijzigingen/w2'),
    geldigeWijziging('uid-anders', 'admin@rooster.intern')));
});

test('wijziging zonder server-timestamp wordt geweigerd', async () => {
  const d = geldigeWijziging('uid-admin', 'admin@rooster.intern');
  d.wanneer = new Date('2020-01-01');
  await assertFails(setDoc(doc(admin, 'wijzigingen/w3'), d));
});

test('wijziging met extra veld wordt geweigerd', async () => {
  const d = geldigeWijziging('uid-admin', 'admin@rooster.intern');
  d.extra = 'x';
  await assertFails(setDoc(doc(admin, 'wijzigingen/w4'), d));
});

test('lezer (geen mag_beheer): wijziging aanmaken wordt geweigerd', async () => {
  await assertFails(setDoc(doc(lezer, 'wijzigingen/w5'),
    geldigeWijziging('uid-lezer', 'lezer@rooster.intern')));
});

test('radioloog: eigen record op gezien zetten mag, andere velden niet, delete nooit', async () => {
  await assertSucceeds(updateDoc(doc(radL, 'wijzigingen/w-eigen'), { gezien: true }));
  await assertFails(updateDoc(doc(radL, 'wijzigingen/w-eigen'), { naar: ['X'] }));
  await assertFails(deleteDoc(doc(admin, 'wijzigingen/w-eigen')));
});

// ---- audit_log: alleen server-side schrijfbaar (K3) ------------------------

test('audit_log: zelfs beheerder kan niet schrijven; lezen alleen beheerder', async () => {
  await assertFails(setDoc(doc(admin, 'audit_log/a2'), { datum: 'x' }));
  await assertFails(deleteDoc(doc(admin, 'audit_log/a1')));
  await assertSucceeds(getDoc(doc(admin, 'audit_log/a1')));
  await assertFails(getDoc(doc(radL, 'audit_log/a1')));
});

// ---- gebruikers: whitelist eigen profiel (M4) ------------------------------

test('gebruiker: eigen naam wijzigen mag', async () => {
  await assertSucceeds(updateDoc(doc(radL, 'gebruikers/uid-radl'), { naam: 'Nieuw' }));
});

test('gebruiker: eigen rol/radioloog_id/permissies wijzigen wordt geweigerd', async () => {
  await assertFails(updateDoc(doc(radL, 'gebruikers/uid-radl'), { rol: 'beheerder' }));
  await assertFails(updateDoc(doc(radL, 'gebruikers/uid-radl'), { radioloog_id: 'P' }));
  await assertFails(updateDoc(doc(radL, 'gebruikers/uid-radl'), { permissies: { mag_beheer: true } }));
});

test('gebruiker: wachtwoord_gewijzigd alleen naar true', async () => {
  await assertSucceeds(updateDoc(doc(radL, 'gebruikers/uid-radl'), { wachtwoord_gewijzigd: true }));
  await assertFails(updateDoc(doc(radL, 'gebruikers/uid-radl'), { wachtwoord_gewijzigd: false }));
});

test('gebruiker: agenda_token string of null mag, ander type niet', async () => {
  await assertSucceeds(updateDoc(doc(radL, 'gebruikers/uid-radl'), { agenda_token: 'abc-123' }));
  await assertSucceeds(updateDoc(doc(radL, 'gebruikers/uid-radl'), { agenda_token: null }));
  await assertFails(updateDoc(doc(radL, 'gebruikers/uid-radl'), { agenda_token: 12345 }));
});

test('gebruikers lezen: alleen eigen profiel of beheerder', async () => {
  await assertSucceeds(getDoc(doc(radL, 'gebruikers/uid-radl')));
  await assertFails(getDoc(doc(radL, 'gebruikers/uid-admin')));
  await assertSucceeds(getDoc(doc(admin, 'gebruikers/uid-radl')));
});
