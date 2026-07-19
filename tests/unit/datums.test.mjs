// Unit-tests datum-helpers (v3.31.0, fase 4).
// Draaien met: node --test tests/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeekVan, mandagVanIso, plusDagen, datumsVanWeek } from '../../app/helpers.js';

// ---- isoWeekVan: ISO-8601 weeknummers, onafhankelijk verifieerbaar ---------

test('isoWeekVan: 1 jan 2026 (donderdag) is week 1', () => {
  assert.equal(isoWeekVan('2026-01-01'), 1);
});

test('isoWeekVan: 31 dec 2026 valt in week 53 (2026 heeft 53 ISO-weken)', () => {
  assert.equal(isoWeekVan('2026-12-31'), 53);
});

test('isoWeekVan: 29 dec 2025 (maandag) hoort al bij week 1 van 2026', () => {
  assert.equal(isoWeekVan('2025-12-29'), 1);
});

test('isoWeekVan: 30 dec 2024 (maandag) hoort bij week 1 van 2025', () => {
  assert.equal(isoWeekVan('2024-12-30'), 1);
});

test('isoWeekVan: maandag t/m zondag van dezelfde week geven hetzelfde nummer', () => {
  const maandag = '2026-07-13';
  const wk = isoWeekVan(maandag);
  for (let i = 1; i < 7; i++) {
    assert.equal(isoWeekVan(plusDagen(maandag, i)), wk, `dag +${i}`);
  }
});

// ---- mandagVanIso ----------------------------------------------------------

test('mandagVanIso: zondag 19 jul 2026 -> maandag 13 jul 2026', () => {
  assert.equal(mandagVanIso('2026-07-19'), '2026-07-13');
});

test('mandagVanIso: een maandag blijft zichzelf', () => {
  assert.equal(mandagVanIso('2026-07-13'), '2026-07-13');
});

test('mandagVanIso: over de jaargrens — do 1 jan 2026 -> ma 29 dec 2025', () => {
  assert.equal(mandagVanIso('2026-01-01'), '2025-12-29');
});

// ---- plusDagen -------------------------------------------------------------

test('plusDagen: maand-overgang', () => {
  assert.equal(plusDagen('2026-01-31', 1), '2026-02-01');
});

test('plusDagen: jaar-overgang', () => {
  assert.equal(plusDagen('2026-12-31', 1), '2027-01-01');
});

test('plusDagen: schrikkeljaar 2028 — 28 feb + 1 = 29 feb', () => {
  assert.equal(plusDagen('2028-02-28', 1), '2028-02-29');
});

test('plusDagen: geen schrikkeljaar 2026 — 28 feb + 1 = 1 mrt', () => {
  assert.equal(plusDagen('2026-02-28', 1), '2026-03-01');
});

test('plusDagen: negatief aantal dagen', () => {
  assert.equal(plusDagen('2026-01-01', -1), '2025-12-31');
});

test('plusDagen: +7 en -7 zijn elkaars inverse', () => {
  assert.equal(plusDagen(plusDagen('2026-07-13', 7), -7), '2026-07-13');
});

// ---- datumsVanWeek ---------------------------------------------------------

test('datumsVanWeek: 7 opeenvolgende datums vanaf de maandag, over jaargrens', () => {
  const dagen = datumsVanWeek('2025-12-29');
  assert.equal(dagen.length, 7);
  assert.equal(dagen[0], '2025-12-29');
  assert.equal(dagen[3], '2026-01-01');
  assert.equal(dagen[6], '2026-01-04');
});
