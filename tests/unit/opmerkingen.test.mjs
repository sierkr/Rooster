// Unit-tests leesstatus dag-opmerkingen (v3.32.0).
// Draaien met: node --test tests/unit/
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../../app/state.js';
import {
  bepaalOpmerkingStatus, opmerkingStatus, opmerkingIsOngelezen,
  dagOpmerkingTekst, eerderGelezenTekst, ongelezenOpmerkingenInWeek,
  ongelezenOpmerkingenTotaal, snoeiGelezen,
} from '../../app/helpers.js';

const VANDAAG = '2026-08-17'; // maandag

beforeEach(() => {
  state.indelingMap = {};
  state.opmerkingGelezen = {};
});

// ---- bepaalOpmerkingStatus: de zuivere kern --------------------------------

test('status "geen" als er geen opmerking staat', () => {
  assert.equal(bepaalOpmerkingStatus('', {}, '2026-08-19', VANDAAG), 'geen');
  assert.equal(bepaalOpmerkingStatus(null, {}, '2026-08-19', VANDAAG), 'geen');
  assert.equal(bepaalOpmerkingStatus(undefined, {}, '2026-08-19', VANDAAG), 'geen');
});

test('een opmerking van alleen witruimte telt als geen opmerking', () => {
  assert.equal(bepaalOpmerkingStatus('   \n  ', {}, '2026-08-19', VANDAAG), 'geen');
});

test('status "nieuw" als de datum nog niet in de gelezen-map staat', () => {
  assert.equal(bepaalOpmerkingStatus('Sjon valt in', {}, '2026-08-19', VANDAAG), 'nieuw');
});

test('status "gelezen" als de gelezen tekst gelijk is aan de huidige', () => {
  const map = { '2026-08-19': 'Sjon valt in' };
  assert.equal(bepaalOpmerkingStatus('Sjon valt in', map, '2026-08-19', VANDAAG), 'gelezen');
});

test('status "gewijzigd" zodra de tekst afwijkt van wat gelezen is', () => {
  const map = { '2026-08-19': 'Sjon valt in' };
  assert.equal(bepaalOpmerkingStatus('Piet valt in', map, '2026-08-19', VANDAAG), 'gewijzigd');
});

test('omdraaiing van dezelfde woorden wordt óók als wijziging gezien', () => {
  // Precies het scenario waar een subtiele aanpassing anders onopgemerkt blijft.
  const map = { '2026-08-19': 'Sjon vervangt Piet' };
  assert.equal(bepaalOpmerkingStatus('Piet vervangt Sjon', map, '2026-08-19', VANDAAG), 'gewijzigd');
});

test('verschil in omringende witruimte is géén wijziging', () => {
  const map = { '2026-08-19': 'Sjon valt in' };
  assert.equal(bepaalOpmerkingStatus('  Sjon valt in  ', map, '2026-08-19', VANDAAG), 'gelezen');
});

test('dagen vóór vandaag waarschuwen nooit, ook niet als ze ongelezen zijn', () => {
  assert.equal(bepaalOpmerkingStatus('Oude notitie', {}, '2026-08-16', VANDAAG), 'gelezen');
});

test('vandaag zelf waarschuwt wel', () => {
  assert.equal(bepaalOpmerkingStatus('Vandaag geen bespreking', {}, VANDAAG, VANDAAG), 'nieuw');
});

test('een lege string als gelezen tekst is niet hetzelfde als nooit gelezen', () => {
  // hasOwnProperty-check: de sleutel bestaat, dus niet 'nieuw' maar 'gewijzigd'.
  const map = { '2026-08-19': '' };
  assert.equal(bepaalOpmerkingStatus('Nu wel iets', map, '2026-08-19', VANDAAG), 'gewijzigd');
});

// ---- state-wrappers --------------------------------------------------------

test('dagOpmerkingTekst leest en trimt uit de indelingMap', () => {
  state.indelingMap = { '2026-08-19': { opmerking: '  Let op  ' } };
  assert.equal(dagOpmerkingTekst('2026-08-19'), 'Let op');
  assert.equal(dagOpmerkingTekst('2026-08-20'), '');
});

test('dagOpmerkingTekst geeft leeg bij opmerking null', () => {
  state.indelingMap = { '2026-08-19': { opmerking: null } };
  assert.equal(dagOpmerkingTekst('2026-08-19'), '');
});

test('opmerkingStatus en opmerkingIsOngelezen werken op de live state', () => {
  state.indelingMap = { '2026-08-19': { opmerking: 'Nieuwe MRI-tijden' } };
  assert.equal(opmerkingStatus('2026-08-19', VANDAAG), 'nieuw');
  assert.equal(opmerkingIsOngelezen('2026-08-19', VANDAAG), true);

  state.opmerkingGelezen = { '2026-08-19': 'Nieuwe MRI-tijden' };
  assert.equal(opmerkingStatus('2026-08-19', VANDAAG), 'gelezen');
  assert.equal(opmerkingIsOngelezen('2026-08-19', VANDAAG), false);
});

test('eerderGelezenTekst geeft de gelezen versie terug, of null', () => {
  state.opmerkingGelezen = { '2026-08-19': 'Was dit' };
  assert.equal(eerderGelezenTekst('2026-08-19'), 'Was dit');
  assert.equal(eerderGelezenTekst('2026-08-20'), null);
});

// ---- tellingen -------------------------------------------------------------

test('ongelezenOpmerkingenInWeek telt maximaal de zeven dagen van die week', () => {
  // Week van maandag 17 t/m zondag 23 augustus 2026, allemaal ongelezen.
  const map = {};
  for (let d = 17; d <= 23; d++) map[`2026-08-${d}`] = { opmerking: `dag ${d}` };
  // Een dag buiten de week mag niet meetellen.
  map['2026-08-24'] = { opmerking: 'volgende week' };
  state.indelingMap = map;

  const dagen = ongelezenOpmerkingenInWeek('2026-08-17', VANDAAG);
  assert.equal(dagen.length, 7);
  assert.ok(!dagen.includes('2026-08-24'));
});

test('ongelezenOpmerkingenInWeek slaat gelezen en lege dagen over', () => {
  state.indelingMap = {
    '2026-08-17': { opmerking: 'a' },
    '2026-08-18': { opmerking: 'b' },
    '2026-08-19': { opmerking: '' },
    '2026-08-20': {},
  };
  state.opmerkingGelezen = { '2026-08-18': 'b' };
  assert.deepEqual(ongelezenOpmerkingenInWeek('2026-08-17', VANDAAG), ['2026-08-17']);
});

test('ongelezenOpmerkingenTotaal negeert het verleden en sorteert oplopend', () => {
  state.indelingMap = {
    '2026-08-10': { opmerking: 'verleden' },
    '2026-09-01': { opmerking: 'later' },
    '2026-08-19': { opmerking: 'binnenkort' },
  };
  assert.deepEqual(ongelezenOpmerkingenTotaal(VANDAAG), ['2026-08-19', '2026-09-01']);
});

test('ongelezenOpmerkingenTotaal is leeg als alles gelezen is', () => {
  state.indelingMap = { '2026-08-19': { opmerking: 'x' } };
  state.opmerkingGelezen = { '2026-08-19': 'x' };
  assert.deepEqual(ongelezenOpmerkingenTotaal(VANDAAG), []);
});

// ---- opschonen -------------------------------------------------------------

test('snoeiGelezen verwijdert datums vóór vandaag en laat de rest staan', () => {
  const map = {
    '2025-01-01': 'oud',
    '2026-08-16': 'gisteren',
    '2026-08-17': 'vandaag',
    '2026-12-31': 'later',
  };
  assert.deepEqual(snoeiGelezen(map, VANDAAG), {
    '2026-08-17': 'vandaag',
    '2026-12-31': 'later',
  });
});

test('snoeiGelezen muteert het origineel niet', () => {
  const map = { '2025-01-01': 'oud', '2026-12-31': 'later' };
  snoeiGelezen(map, VANDAAG);
  assert.equal(Object.keys(map).length, 2, 'invoer moet ongemoeid blijven');
});

test('snoeiGelezen gaat om met leeg of ontbrekend invoerobject', () => {
  assert.deepEqual(snoeiGelezen({}, VANDAAG), {});
  assert.deepEqual(snoeiGelezen(null, VANDAAG), {});
  assert.deepEqual(snoeiGelezen(undefined, VANDAAG), {});
});
