// Unit-tests validatie-engine (v3.31.0, fase 4).
// Dekt alle regeltypes: limiet, conflict, uniciteit, bezetting, verplichte
// functies — en de cel-level pre-check.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../../app/state.js';
import { valideerWeek, checkCelConflict } from '../../app/validatie.js';

// Testweek: maandag 13 juli 2026
const MA = '2026-07-13';

function dagDoc(datum, toewijzingen) {
  return { datum, toewijzingen };
}

beforeEach(() => {
  state.radiologen = [];
  state.functies = [];
  state.validatieRegels = [];
  state.indelingMap = {};
});

test('limiet-regel: meer codes dan max geeft conflict', () => {
  state.validatieRegels = [{ id: 'r1', type: 'limiet', max_codes: 2, ernst: 'blokkeren', bericht: 'Max 2 codes' }];
  state.indelingMap = { [MA]: dagDoc(MA, { L: ['B', 'E', 'M'] }) };
  const c = valideerWeek(MA);
  assert.equal(c.length, 1);
  assert.equal(c[0].regelId, 'r1');
  assert.equal(c[0].radId, 'L');
  assert.equal(c[0].ernst, 'blokkeren');
});

test('limiet-regel: precies het maximum is geen conflict', () => {
  state.validatieRegels = [{ id: 'r1', type: 'limiet', max_codes: 2, ernst: 'blokkeren', bericht: 'Max 2' }];
  state.indelingMap = { [MA]: dagDoc(MA, { L: ['B', 'E'] }) };
  assert.equal(valideerWeek(MA).length, 0);
});

test('conflict-regel: blokkerende code gecombineerd met een tweede code', () => {
  state.validatieRegels = [{ id: 'r2', type: 'conflict', code_blokkerend: 'V', ernst: 'waarschuwing', bericht: 'V niet combineren' }];
  state.indelingMap = { [MA]: dagDoc(MA, { P: ['V', 'B'], K: ['V'] }) };
  const c = valideerWeek(MA);
  assert.equal(c.length, 1, 'V alleen (stoel K) mag wél');
  assert.equal(c[0].radId, 'P');
});

test('uniciteit-regel: dezelfde unieke code twee keer op één dag', () => {
  state.validatieRegels = [{ id: 'r3', type: 'uniciteit', codes_uniek: ['W'], ernst: 'blokkeren', bericht: 'W is uniek' }];
  state.indelingMap = { [MA]: dagDoc(MA, { L: ['.WB'], P: ['W'] }) };
  const c = valideerWeek(MA);
  assert.equal(c.length, 1);
  assert.ok(c[0].bericht.includes('2×'));
});

test('bezetting-regel: te weinig bezetting op de betreffende weekdag', () => {
  state.validatieRegels = [{ id: 'r4', type: 'bezetting', dag: 'ma', code: 'B', aantal: 2, ernst: 'waarschuwing', bericht: 'Min 2× B op ma' }];
  state.indelingMap = { [MA]: dagDoc(MA, { L: ['B'], P: ['E'] }) };
  const c = valideerWeek(MA);
  assert.equal(c.length, 1);
  assert.ok(c[0].bericht.includes('(nu 1)'));
});

test('bezetting-regel: W-slots tellen mee in de bezetting', () => {
  state.validatieRegels = [{ id: 'r4', type: 'bezetting', dag: 'ma', code: 'B', aantal: 2, ernst: 'waarschuwing', bericht: 'Min 2× B' }];
  state.indelingMap = { [MA]: dagDoc(MA, { L: ['B'], W1: ['5B'] }) };
  assert.equal(valideerWeek(MA).length, 0);
});

test('verplichte functie: ontbreekt op een werkdag → waarschuwing; weekend niet gecheckt', () => {
  state.functies = [{ id: 'W', code: 'W', naam: 'Weekradioloog', verplicht: true }];
  const ZA = '2026-07-18';
  state.indelingMap = {
    [MA]: dagDoc(MA, { L: ['B'] }),   // ma: W ontbreekt → conflict
    [ZA]: dagDoc(ZA, { L: ['B'] }),   // za: geen check
  };
  const c = valideerWeek(MA);
  assert.equal(c.length, 1);
  assert.equal(c[0].datum, MA);
  assert.equal(c[0].regelId, 'verplicht_W');
});

test('inactieve regel (actief:false) doet niet mee', () => {
  state.validatieRegels = [{ id: 'r1', type: 'limiet', max_codes: 2, ernst: 'blokkeren', bericht: 'Max 2', actief: false }];
  state.indelingMap = { [MA]: dagDoc(MA, { L: ['B', 'E', 'M'] }) };
  assert.equal(valideerWeek(MA).length, 0);
});

test('dagen zonder indeling-doc worden overgeslagen', () => {
  state.validatieRegels = [{ id: 'r1', type: 'limiet', max_codes: 2, ernst: 'blokkeren', bericht: 'Max 2' }];
  state.indelingMap = {}; // hele week leeg
  assert.equal(valideerWeek(MA).length, 0);
});

// ---- checkCelConflict (pre-save cel-check) ---------------------------------

test('checkCelConflict: limiet en conflict worden vóór opslaan gesignaleerd', () => {
  state.validatieRegels = [
    { id: 'r1', type: 'limiet', max_codes: 2, ernst: 'blokkeren', bericht: 'Max 2' },
    { id: 'r2', type: 'conflict', code_blokkerend: 'V', ernst: 'blokkeren', bericht: 'V solo' },
  ];
  assert.equal(checkCelConflict(MA, 'L', ['B', 'E', 'M']).length, 1);
  assert.equal(checkCelConflict(MA, 'L', ['V', 'B']).length, 1);
  assert.equal(checkCelConflict(MA, 'L', ['V']).length, 0);
  assert.equal(checkCelConflict(MA, 'L', ['B', 'E']).length, 0);
});
