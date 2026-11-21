// v3.41.0: kleur per hoofdletter voor de Excel-export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kleurPerHoofdletter } from '../../app/helpers.js';

// Volgorde zoals Firestore ze in live teruggeeft (document-id), gemeten 21 nov 2026.
const live = [
  { code: '.WB', kleur: '#eeedfe' }, { code: '3W', kleur: '#eeedfe' },
  { code: 'A', kleur: '#b1e7f2' }, { code: 'B', kleur: '#faece7' },
  { code: 'O', kleur: '#e8dee8' }, { code: 'T', kleur: '#08fb04' },
  { code: 'W', kleur: '#ff7a6e' },
  { code: 'YYA', kleur: '#faeeda' }, { code: 'YYO2', kleur: '#e1f5ee' },
  { code: 'YYW', kleur: '#eeedfe' },
  { code: 'bo', kleur: '#eaf97b' }, { code: 'tw', kleur: '#d6d5c2' },
];

test('de functie met precies de letter wint van varianten erna', () => {
  const m = kleurPerHoofdletter(live);
  assert.equal(m.W, 'ff7a6e');
  assert.equal(m.B, 'faece7');
  assert.equal(m.A, 'b1e7f2');
  assert.equal(m.O, 'e8dee8');
  assert.equal(m.T, '08fb04');
});

test('ook als de variant vóór de eigen code staat', () => {
  const m = kleurPerHoofdletter([{ code: 'W', kleur: '#ff0000' }, { code: '3W', kleur: '#eeeeee' }]);
  assert.equal(m.W, 'ff0000');
});

test('zonder eigen code valt hij terug op een variant, daarna op de vaste lijst', () => {
  assert.equal(kleurPerHoofdletter([{ code: 'YYC', kleur: '#123456' }]).C, '123456');
  assert.equal(kleurPerHoofdletter([], { W: 'DCE6F1' }).W, 'DCE6F1');
});

test('ongeldige kleuren worden overgeslagen', () => {
  const m = kleurPerHoofdletter([{ code: 'W', kleur: '#fff' }, { code: 'B', kleur: '' }], { W: 'DCE6F1' });
  assert.equal(m.W, 'DCE6F1');
  assert.equal(m.B, undefined);
});
