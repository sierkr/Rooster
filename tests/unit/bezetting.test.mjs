// Unit-tests stoel-tijdlijnen / bezetting_historie (v3.31.0, fase 4).
// Bevat de W1/GJG-casus (juli 2026) als blijvende regressietest.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../../app/state.js';
import {
  laatsteEntry, clipHistorieVoorWissel, bezettingOpDatum,
  controleerBezettingHistorie,
} from '../../app/helpers.js';

beforeEach(() => { state.radiologen = []; });

// ---- laatsteEntry ----------------------------------------------------------

test('laatsteEntry: leeg of geen array geeft null', () => {
  assert.equal(laatsteEntry([]), null);
  assert.equal(laatsteEntry(null), null);
  assert.equal(laatsteEntry(undefined), null);
});

test('laatsteEntry: bij overlap wint de entry met de laatste van-datum', () => {
  const oud = { code: 'W1', van: null, tot: '2026-10-31' };
  const nieuw = { code: 'GJG', van: '2026-07-06', tot: null };
  assert.equal(laatsteEntry([oud, nieuw]), nieuw);
  assert.equal(laatsteEntry([nieuw, oud]), nieuw, 'array-volgorde mag niet uitmaken');
});

test('laatsteEntry: van=null telt als oudste', () => {
  const a = { code: 'A', van: null };
  const b = { code: 'B', van: '2020-01-01' };
  assert.equal(laatsteEntry([a, b]), b);
});

// ---- clipHistorieVoorWissel ------------------------------------------------

test('clipHistorieVoorWissel: open periode wordt gesloten op de dag vóór de wissel', () => {
  const hist = [{ code: 'BL', van: '2024-01-01', tot: null }];
  const res = clipHistorieVoorWissel(hist, '2026-07-06');
  assert.equal(res.length, 1);
  assert.equal(res[0].tot, '2026-07-05');
});

test('clipHistorieVoorWissel: periode die op/na de wisseldatum begint vervalt', () => {
  const hist = [{ code: 'X', van: '2026-07-06', tot: null }];
  assert.equal(clipHistorieVoorWissel(hist, '2026-07-06').length, 0);
});

test('clipHistorieVoorWissel: al afgesloten periode vóór de wissel blijft ongemoeid', () => {
  const hist = [{ code: 'BL', van: '2023-01-01', tot: '2024-06-30' }];
  const res = clipHistorieVoorWissel(hist, '2026-07-06');
  assert.deepEqual(res[0], { code: 'BL', van: '2023-01-01', tot: '2024-06-30' });
});

test('clipHistorieVoorWissel: gesloten periode die over de wisseldatum loopt wordt geclipt', () => {
  const hist = [{ code: 'BL', van: '2025-01-01', tot: '2026-12-31' }];
  const res = clipHistorieVoorWissel(hist, '2026-07-06');
  assert.equal(res[0].tot, '2026-07-05');
});

// ---- bezettingOpDatum ------------------------------------------------------

test('bezettingOpDatum: kiest de juiste entry per datum (historie is leidend)', () => {
  state.radiologen = [{
    id: 'W1', isSlot: true, code: 'GJG', achternaam: 'Greuter',
    bezetting_historie: [
      { code: 'W1', achternaam: 'W1', van: null, tot: '2026-07-05' },
      { code: 'GJG', achternaam: 'Greuter', van: '2026-07-06', tot: null },
    ],
  }];
  assert.equal(bezettingOpDatum('W1', '2026-07-05').code, 'W1');
  assert.equal(bezettingOpDatum('W1', '2026-07-06').code, 'GJG');
  assert.equal(bezettingOpDatum('W1', '2027-03-01').code, 'GJG', 'open periode loopt door');
});

test('bezettingOpDatum: bij (legacy) overlap wint de laatste van-datum, niet de array-volgorde', () => {
  state.radiologen = [{
    id: 'W1', isSlot: true,
    bezetting_historie: [
      { code: 'W1', van: null, tot: '2026-10-31' },            // corrupte, te lange periode
      { code: 'GJG', van: '2026-07-06', tot: null },
    ],
  }];
  assert.equal(bezettingOpDatum('W1', '2026-08-01').code, 'GJG',
    'shadowing-bug: oude entry mag de nieuwe bezetter niet verbergen');
});

test('bezettingOpDatum: fallback op top-level velden zonder historie', () => {
  state.radiologen = [{ id: 'L', code: 'BL', achternaam: 'Beurle', vakantierecht: 35 }];
  const b = bezettingOpDatum('L', '2026-07-13');
  assert.equal(b.code, 'BL');
  assert.equal(b.vakantierecht, 35);
});

test('bezettingOpDatum: inactief W-slot zonder historie is leeg', () => {
  state.radiologen = [{ id: 'W2', isSlot: true, actief: false }];
  assert.equal(bezettingOpDatum('W2', '2026-07-13'), null);
});

// ---- controleerBezettingHistorie -------------------------------------------
// Regressietest: de exacte corrupte W1-data uit productie (juli 2026), die
// drie problemen gaf, en de gerepareerde variant die er nul geeft.

const W1_CORRUPT = {
  bezetting_historie: [
    { code: 'W1', achternaam: 'W1', van: null, tot: '2026-10-31' },
    { code: 'GJG', achternaam: 'Greuter', van: '2026-11-01', tot: '2026-07-05' },
    { code: 'GJG', achternaam: 'Greuter', van: '2026-07-06', tot: null },
  ],
};

const W1_GEREPAREERD = {
  bezetting_historie: [
    { code: 'W1', achternaam: 'W1', van: null, tot: '2026-07-05' },
    { code: 'GJG', achternaam: 'Greuter', van: '2026-07-06', tot: null },
  ],
};

test('controleerBezettingHistorie: de corrupte W1-tijdlijn geeft precies 3 problemen', () => {
  const problemen = controleerBezettingHistorie(W1_CORRUPT);
  assert.equal(problemen.length, 3, problemen.join(' | '));
});

test('controleerBezettingHistorie: de gerepareerde W1-tijdlijn is schoon', () => {
  assert.deepEqual(controleerBezettingHistorie(W1_GEREPAREERD), []);
});

test('controleerBezettingHistorie: twee open periodes is een fout', () => {
  const problemen = controleerBezettingHistorie({
    bezetting_historie: [
      { code: 'A', van: '2025-01-01', tot: null },
      { code: 'B', van: '2026-01-01', tot: null },
    ],
  });
  assert.ok(problemen.some(p => p.includes('open')), problemen.join(' | '));
});

test('controleerBezettingHistorie: een gat in de tijdlijn is GEEN fout', () => {
  assert.deepEqual(controleerBezettingHistorie({
    bezetting_historie: [
      { code: 'A', van: '2025-01-01', tot: '2025-06-30' },
      { code: 'B', van: '2026-01-01', tot: null },
    ],
  }), []);
});

test('controleerBezettingHistorie: lege historie is in orde', () => {
  assert.deepEqual(controleerBezettingHistorie({ bezetting_historie: [] }), []);
  assert.deepEqual(controleerBezettingHistorie({}), []);
});
