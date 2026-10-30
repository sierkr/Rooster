// Unit-tests voor het tabblad Indelen (v3.36.0): het concept (concept.js) en
// de gedeelde kolommen/hulpkolommen (kolommen.js, ook gebruikt door de export).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../../app/state.js';
import {
  celTeltVoor, hulpKolommen, functieEisen, jaarKolommen, weekdagNr,
} from '../../app/kolommen.js';
import {
  normaliseer, tekstNaarCodes, codesNaarTekst, liveTekst, zichtbareTekst,
  conceptNaInvoer, dagMetConcept, bouwPublicatie, indelingMetConcept,
  metIndelingMap, leesKlembord, maakKlembord, celSleutel, splitsSleutel,
} from '../../app/concept.js';

beforeEach(() => {
  state.radiologen = [];
  state.functies = [];
  state.validatieRegels = [];
  state.indelingMap = {};
});

// ---- Tellen zoals de Excel-formule ---------------------------------------------

test('celTeltVoor volgt de Excel-formule (hele cel, eerste letter, .X, cijfer+X)', () => {
  assert.equal(celTeltVoor('B', 'B'), true);
  assert.equal(celTeltVoor('b', 'B'), true);            // hoofdletterongevoelig
  assert.equal(celTeltVoor('.WB', 'W'), true);
  assert.equal(celTeltVoor('.WB', 'B'), false);
  assert.equal(celTeltVoor('5W', 'W'), true);
  assert.equal(celTeltVoor('E,M', 'E'), true);
  assert.equal(celTeltVoor('E,M', 'M'), false);         // in Excel telt alleen de eerste code
  assert.equal(celTeltVoor('', 'B'), false);
  assert.equal(celTeltVoor('V', 'B'), false);
});

test('weekdagNr is 1 (ma) t/m 7 (zo), zoals WEEKDAY(;2)', () => {
  assert.equal(weekdagNr('2027-01-04'), 1); // maandag
  assert.equal(weekdagNr('2027-01-10'), 7); // zondag
});

function zetFuncties() {
  state.functies = [
    { id: 'B', code: 'B', verplicht: true, werkvloer: true },
    { id: 'E', code: 'E', verplicht: true, werkvloer: true },
    { id: 'M', code: 'M', werkvloer: true },
    { id: 'V', code: 'V', werkvloer: false },
  ];
  state.validatieRegels = [
    { id: 'r-b', type: 'bezetting', dag: 'ma', code: 'B', aantal: 2, ernst: 'blokkeren', bericht: 'Te weinig B' },
  ];
}

test('functieEisen: werkvloer, verplicht en bezetting-regel', () => {
  zetFuncties();
  const e = functieEisen();
  assert.deepEqual(e.werkvloerUniek.sort(), ['B', 'E', 'M']);
  assert.deepEqual(e.functieLetters, ['B', 'E', 'M']);
  assert.equal(e.reqByCode.B[1], 2);   // maandag: regel vraagt 2
  assert.equal(e.reqByCode.B[2], 1);   // dinsdag: verplicht → 1
  assert.equal(e.reqByCode.B[6], 0);   // zaterdag: geen eis
  assert.ok(e.strictCodes.has('B') && e.strictCodes.has('E'));
  assert.ok(!e.strictCodes.has('M'));  // alleen werkvloer → niet strikt
});

test('hulpKolommen: Aantal, ontbrekende functies en tekort', () => {
  zetFuncties();
  const e = functieEisen();
  // maandag 4 jan 2027: één B, één E, één V
  const h = hulpKolommen('2027-01-04', ['B', 'E', 'V', ''], e);
  assert.equal(h.aantal, 2);
  assert.deepEqual(h.ontbrekend, ['B', 'M']); // B: 1 < 2, M ontbreekt
  assert.equal(h.tekort, true);               // B is strikt
  assert.equal(h.werkdag, true);
  // dinsdag met B, E, M: alles gehaald
  const h2 = hulpKolommen('2027-01-05', ['B', 'E', 'M'], e);
  assert.deepEqual(h2.ontbrekend, []);
  assert.equal(h2.tekort, false);
  // zaterdag: geen eisen, geen tekort
  const h3 = hulpKolommen('2027-01-09', [], e);
  assert.deepEqual(h3.ontbrekend, []);
  assert.equal(h3.tekort, false);
  assert.equal(h3.werkdag, false);
});

test('jaarKolommen: vaste stoelen op senioriteit, waarnemers erna, extra kolom bij data', () => {
  state.radiologen = [
    { id: 'L', code: 'BL', bezetting_historie: [{ code: 'BL', van: null, tot: null, in_dienst: '2001-01-01' }] },
    { id: 'P', code: 'KdP', bezetting_historie: [{ code: 'KdP', van: null, tot: null, in_dienst: '1999-01-01' }] },
    { id: 'W1', code: 'GJG', isSlot: true, bezetting_historie: [{ code: 'GJG', van: '2027-03-01', tot: null }] },
  ];
  const k = jaarKolommen(2027, [{ datum: '2027-01-04', toewijzingen: { X9: ['B'] } }]);
  const ids = k.map(x => x.id);
  assert.deepEqual(ids.slice(0, 2), ['P', 'L']);       // KdP langer in dienst → eerst
  assert.ok(ids.indexOf('W1') > ids.indexOf('L'));     // waarnemer na vaste stoelen
  assert.ok(ids.includes('X9'));                       // round-trip-vangnet
  assert.equal(k.find(x => x.id === 'W1').header, 'GJG');
});

// ---- Concept ----------------------------------------------------------------------

test('normaliseer: scheidingstekens worden een komma, hoofdletters blijven', () => {
  assert.equal(normaliseer(' E / M ', 'L'), 'E,M');
  assert.equal(normaliseer('E;M', 'L'), 'E,M');
  assert.equal(normaliseer('E M', 'L'), 'E,M');
  assert.equal(normaliseer('bo', 'L'), 'bo');
  assert.equal(normaliseer('  ', 'L'), '');
  assert.equal(normaliseer(' W1 ', '_dienst'), 'W1');   // P/Q/R: alleen bijknippen
  assert.deepEqual(tekstNaarCodes('E,M'), ['E', 'M']);
  assert.equal(codesNaarTekst(['E', 'M']), 'E,M');
  assert.equal(codesNaarTekst('B'), 'B');
});

test('sleutels: datum en kolom terug te halen, ook voor de extra kolommen', () => {
  assert.deepEqual(splitsSleutel(celSleutel('2027-01-04', '_dienst')), { datum: '2027-01-04', kolomId: '_dienst' });
  assert.deepEqual(splitsSleutel(celSleutel('2027-01-04', 'W1')), { datum: '2027-01-04', kolomId: 'W1' });
});

test('liveTekst leest toewijzing, dienst, bespreking en interventie', () => {
  const dag = { toewijzingen: { L: ['E', 'M'] }, dienst: { dag: 'P' }, bespreking: 'X', interventie: 'Y' };
  assert.equal(liveTekst(dag, 'L'), 'E,M');
  assert.equal(liveTekst(dag, 'P'), '');          // stoel P, niet de dienstkolom
  assert.equal(liveTekst(dag, '_dienst'), 'P');
  assert.equal(liveTekst(dag, '_bespr'), 'X');
  assert.equal(liveTekst(dag, '_interv'), 'Y');
  assert.equal(liveTekst(undefined, 'L'), '');
});

test('conceptNaInvoer: nieuwe cel bewaart de roosterwaarde als "was"', () => {
  const map = { '2027-01-04': { toewijzingen: { L: ['B'] } } };
  const r = conceptNaInvoer({}, map, '2027-01-04', 'L', 'e');
  assert.equal(r.sleutel, '2027-01-04|L');
  assert.equal(r.voor, null);
  assert.deepEqual(r.na, { nieuw: 'e', was: 'B' });
});

test('conceptNaInvoer: de oude waarde terugtypen haalt de cel uit het concept', () => {
  const map = { '2027-01-04': { toewijzingen: { L: ['B'] } } };
  const concept = { '2027-01-04|L': { nieuw: 'E', was: 'B' } };
  const r = conceptNaInvoer(concept, map, '2027-01-04', 'L', 'B');
  assert.equal(r.na, null);
  assert.deepEqual(r.voor, { nieuw: 'E', was: 'B' });
});

test('conceptNaInvoer: tweede wijziging houdt de oorspronkelijke "was"', () => {
  const map = { '2027-01-04': { toewijzingen: { L: ['B'] } } };
  const concept = { '2027-01-04|L': { nieuw: 'E', was: 'B' } };
  const r = conceptNaInvoer(concept, map, '2027-01-04', 'L', 'M');
  assert.deepEqual(r.na, { nieuw: 'M', was: 'B' });
});

test('zichtbareTekst: concept gaat voor het rooster', () => {
  const map = { '2027-01-04': { toewijzingen: { L: ['B'], P: ['S'] } } };
  const concept = { '2027-01-04|L': { nieuw: '', was: 'B' } };
  assert.equal(zichtbareTekst(concept, map, '2027-01-04', 'L'), '');
  assert.equal(zichtbareTekst(concept, map, '2027-01-04', 'P'), 'S');
});

test('dagMetConcept: alleen de geraakte cellen veranderen', () => {
  const live = {
    datum: '2027-01-04', toewijzingen: { L: ['B'], P: ['S'], V: ['O'] },
    dienst: { dag: 'L', avond: 'P' }, bespreking: 'X', interventie: null,
    opmerking: 'hallo', cel_opmerkingen: { L: 'let op' }, vakantie_v: { F: true },
  };
  const d = dagMetConcept('2027-01-04', live, [
    { kolomId: 'L', nieuw: 'E,M' },
    { kolomId: 'P', nieuw: '' },
    { kolomId: '_interv', nieuw: 'R1' },
  ]);
  assert.deepEqual(d.toewijzingen, { L: ['E', 'M'], V: ['O'] });
  assert.deepEqual(d.dienst, { dag: 'L' });
  assert.equal(d.bespreking, 'X');
  assert.equal(d.interventie, 'R1');
  assert.equal(d.dag, 'ma');
  assert.equal(d.weeknr, 1);
  // Opmerkingen en vakantieplanning horen er niet in: die blijven bij het
  // wegschrijven op het bestaande document staan.
  assert.ok(!('opmerking' in d));
  assert.ok(!('cel_opmerkingen' in d));
  assert.ok(!('vakantie_v' in d));
});

test('dagMetConcept: nieuwe dag zonder rooster', () => {
  const d = dagMetConcept('2027-01-05', undefined, [{ kolomId: 'L', nieuw: 'B' }]);
  assert.deepEqual(d.toewijzingen, { L: ['B'] });
  assert.deepEqual(d.dienst, {});
  assert.equal(d.bespreking, null);
});

test('bouwPublicatie: alleen echte wijzigingen, met "intussen gewijzigd" en 30-dagen-telling', () => {
  const map = {
    '2026-11-02': { datum: '2026-11-02', toewijzingen: { L: ['B'], P: ['E'] } },
    '2026-11-03': { datum: '2026-11-03', toewijzingen: { L: ['M'] } },
    '2027-02-01': { datum: '2027-02-01', toewijzingen: {} },
  };
  const concept = {
    '2026-11-02|L': { nieuw: 'E', was: 'B' },        // echte wijziging, binnen 30 dagen
    '2026-11-02|_dienst': { nieuw: 'L', was: '' },   // extra kolom: telt niet als melding
    '2026-11-03|L': { nieuw: 'M', was: 'B' },        // staat al zo in het rooster → niets te doen
    '2027-02-01|P': { nieuw: 'S', was: 'B' },        // intussen gewijzigd (rooster leeg, was B)
  };
  const p = bouwPublicatie(concept, map, '2026-10-30', '2026-11-29');
  assert.equal(p.cellen.length, 3);
  assert.deepEqual(p.dagen.map(d => d.datum), ['2026-11-02', '2027-02-01']);
  assert.deepEqual(p.dagen[0].toewijzingen, { L: ['E'], P: ['E'] });
  assert.deepEqual(p.dagen[0].dienst, { dag: 'L' });
  assert.equal(p.nabij, 1);
  assert.equal(p.nabijeDagen, 1);
  assert.equal(p.intussen.length, 1);
  assert.equal(p.intussen[0].datum, '2027-02-01');
  // Alles mag na publiceren uit het concept, ook de cel die al klopte.
  assert.deepEqual(Object.keys(p.opruimen).sort(), Object.keys(concept).sort());
});

test('bouwPublicatie: leeg concept = niets te publiceren', () => {
  const p = bouwPublicatie({}, {}, '2026-10-30', '2026-11-29');
  assert.equal(p.cellen.length, 0);
  assert.equal(p.dagen.length, 0);
});

test('indelingMetConcept + metIndelingMap: regelcontrole ziet het concept, state blijft heel', () => {
  const map = { '2027-01-04': { datum: '2027-01-04', toewijzingen: { L: ['B'] }, opmerking: 'x' } };
  state.indelingMap = map;
  const samen = indelingMetConcept({ '2027-01-04|L': { nieuw: 'E', was: 'B' } }, map);
  assert.deepEqual(samen['2027-01-04'].toewijzingen, { L: ['E'] });
  assert.equal(samen['2027-01-04'].opmerking, 'x');
  assert.deepEqual(map['2027-01-04'].toewijzingen, { L: ['B'] }); // origineel onaangeroerd
  const gezien = metIndelingMap(samen, () => state.indelingMap['2027-01-04'].toewijzingen.L[0]);
  assert.equal(gezien, 'E');
  assert.equal(state.indelingMap, map);
  assert.throws(() => metIndelingMap(samen, () => { throw new Error('x'); }));
  assert.equal(state.indelingMap, map); // ook na een fout teruggezet
});

test('leesKlembord: Excel-blok met tabs, regeleindes en aanhalingstekens', () => {
  assert.deepEqual(leesKlembord('B\tE\r\nV\t\r\n'), [['B', 'E'], ['V', '']]);
  assert.deepEqual(leesKlembord('M'), [['M']]);
  assert.deepEqual(leesKlembord('"E,M"\tB\n'), [['E,M', 'B']]);
  assert.equal(maakKlembord([['B', 'E'], ['', 'M']]), 'B\tE\n\tM');
});

// ---- Keuzelijst (v3.37.0) --------------------------------------------------------

test('gangbareFuncties: actief, geen varianten, op volgorde (lijst van Overzicht én Indelen)', async () => {
  const { gangbareFuncties } = await import('../../app/helpers.js');
  state.functies = [
    { id: 'E', code: 'E', volgorde: 2 },
    { id: 'B', code: 'B', volgorde: 1 },
    { id: '.WB', code: '.WB', volgorde: 0 },
    { id: '5W', code: '5W', volgorde: 0 },
    { id: 'YYB1', code: 'YYB1', volgorde: 0 },
    { id: '-', code: '-', volgorde: 0 },
    { id: 'LANG', code: 'LANG', volgorde: 0 },
    { id: 'X', code: 'X', volgorde: 3, actief: false },
    { id: 'bo', code: 'bo', volgorde: 4 },
  ];
  assert.deepEqual(gangbareFuncties().map(f => f.code), ['B', 'E', 'bo']);
});

test('keuzelijst-standen: vier keuzes, menu is de standaard', async () => {
  const { INDELEN_STANDEN, INDELEN_STAND_STANDAARD } = await import('../../app/state.js');
  assert.deepEqual(INDELEN_STANDEN.map(s => s.id), ['menu', 'balk', 'blad', 'uit']);
  assert.equal(INDELEN_STAND_STANDAARD, 'menu');
});
