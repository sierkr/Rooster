// Unit-tests functiecodes en wens-matching (v3.31.0, fase 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoofdLetterCode, wensMatcht } from '../../app/helpers.js';

// ---- hoofdLetterCode: de "rol-letter" uit een code -------------------------

test('hoofdLetterCode: varianten reduceren naar de hoofdletter', () => {
  assert.equal(hoofdLetterCode('.WB'), 'W');
  assert.equal(hoofdLetterCode('5B'), 'B');
  assert.equal(hoofdLetterCode('YYE1'), 'E');
  assert.equal(hoofdLetterCode('4P'), 'P');
  assert.equal(hoofdLetterCode('.O'), 'O');
  assert.equal(hoofdLetterCode('3S'), 'S');
  assert.equal(hoofdLetterCode('X'), 'X');
});

test('hoofdLetterCode: kleine letters worden hoofdletters', () => {
  assert.equal(hoofdLetterCode('w'), 'W');
});

test('hoofdLetterCode: lege/ontbrekende code geeft lege string', () => {
  assert.equal(hoofdLetterCode(''), '');
  assert.equal(hoofdLetterCode(null), '');
  assert.equal(hoofdLetterCode(undefined), '');
});

// ---- wensMatcht: canonieke wens-matching (zelfde logica als import-sync) ---

test('wensMatcht vakantie: V en varianten matchen, werk-codes niet', () => {
  assert.equal(wensMatcht('vakantie', null, 'V'), true);
  assert.equal(wensMatcht('vakantie', null, '4V'), true);
  assert.equal(wensMatcht('vakantie', null, 'B'), false);
  assert.equal(wensMatcht('vakantie', null, ''), false);
});

test('wensMatcht niet_beschikbaar: leeg of afwezig-code matcht', () => {
  assert.equal(wensMatcht('niet_beschikbaar', null, ''), true);   // lege cel = niet ingedeeld
  assert.equal(wensMatcht('niet_beschikbaar', null, 'V'), true);
  assert.equal(wensMatcht('niet_beschikbaar', null, 'Z'), true);
  assert.equal(wensMatcht('niet_beschikbaar', null, 'K'), true);
  assert.equal(wensMatcht('niet_beschikbaar', null, 'Q'), true);
  assert.equal(wensMatcht('niet_beschikbaar', null, 'B'), false); // wél ingedeeld = wens gebroken
});

test('wensMatcht voorkeur: hoofdletter van de code moet de voorkeur zijn', () => {
  assert.equal(wensMatcht('voorkeur', 'B', '5B'), true);
  assert.equal(wensMatcht('voorkeur', 'B', 'B'), true);
  assert.equal(wensMatcht('voorkeur', 'B', 'E'), false);
  assert.equal(wensMatcht('voorkeur', 'M', '.MW'), true);
});

test('wensMatcht: onbekend type matcht nooit', () => {
  assert.equal(wensMatcht('iets_anders', 'B', 'B'), false);
});
