// v3.41.0: kleur per hoofdletter voor de Excel-export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kleurPerHoofdletter, automatischZwart, letterZwart } from '../../app/helpers.js';

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

// v3.42.0: vinkje "Letter zwart".
test('automatisch: zwart op licht, wit op donker; #ff7a6e is nét zwart', () => {
  assert.equal(automatischZwart('#ff7a6e'), true);   // helderheid 160,4
  assert.equal(automatischZwart('#e10e0e'), false);  // rood
  assert.equal(automatischZwart('#1f3863'), false);  // donkerblauw
  assert.equal(automatischZwart('#000000'), false);
  assert.equal(automatischZwart('#faece7'), true);
});

test('zonder vinkje-veld geldt de automatische keuze; met veld wint het vinkje', () => {
  assert.equal(letterZwart({ kleur: '#e10e0e' }), false);
  assert.equal(letterZwart({ kleur: '#e10e0e', letter_zwart: true }), true);
  assert.equal(letterZwart({ kleur: '#faece7', letter_zwart: false }), false);
});

test('Excel: zwart per letter komt van dezelfde functie als de kleur', () => {
  const f = [
    { code: '3W', kleur: '#eeedfe' },
    { code: 'W', kleur: '#e10e0e', letter_zwart: true },
    { code: 'YYW', kleur: '#eeedfe', letter_zwart: false },
    { code: 'B', kleur: '#faece7' },
  ];
  const z = kleurPerHoofdletter(f, { Q: 'E0F7FA', X: '1F3863' }, true);
  assert.equal(z.W, true);    // vinkje van W, niet van YYW
  assert.equal(z.B, true);    // automatisch
  assert.equal(z.Q, true);    // terugval, automatisch
  assert.equal(z.X, false);
});
