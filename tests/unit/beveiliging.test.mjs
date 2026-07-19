// Unit-tests beveiligingshelpers (v3.31.0, fase 4).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../../app/state.js';
import {
  esc, valideerWachtwoord, genereerWachtwoord,
  defaultPermissies, permissie, magWijzigen,
} from '../../app/helpers.js';

// ---- esc (XSS-ontsnapping) -------------------------------------------------

test('esc: alle vijf HTML-specials worden ontsnapt', () => {
  assert.equal(esc(`<script>&"'</script>`),
    '&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
});

test('esc: null/undefined worden lege string, getallen blijven leesbaar', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('esc: gewone namen blijven ongewijzigd', () => {
  assert.equal(esc('Greuter'), 'Greuter');
  assert.equal(esc('van der Meer-Jansen'), 'van der Meer-Jansen');
});

// ---- valideerWachtwoord (H3-beleid) ----------------------------------------

test('valideerWachtwoord: korter dan 12 tekens wordt geweigerd', () => {
  assert.notEqual(valideerWachtwoord('elftekens11'), null);   // 11 tekens
  assert.notEqual(valideerWachtwoord(''), null);
  assert.notEqual(valideerWachtwoord(null), null);
});

test('valideerWachtwoord: 12 tekens of meer is geldig', () => {
  assert.equal(valideerWachtwoord('twaalftekens'), null);      // 12 tekens
  assert.equal(valideerWachtwoord('een-hele-lange-zin-2026'), null);
});

test('valideerWachtwoord: het oude standaardwachtwoord wordt altijd geweigerd', () => {
  assert.notEqual(valideerWachtwoord('RoosterZMC'), null);
});

// ---- genereerWachtwoord (crypto) -------------------------------------------

test('genereerWachtwoord: 14 tekens uit de veilige tekenset', () => {
  const pw = genereerWachtwoord();
  assert.equal(pw.length, 14);
  assert.match(pw, /^[abcdefghijkmnpqrstuvwxyz23456789]{14}$/);
});

test('genereerWachtwoord: opeenvolgende wachtwoorden verschillen', () => {
  assert.notEqual(genereerWachtwoord(), genereerWachtwoord());
});

test('genereerWachtwoord: voldoet zelf aan het wachtwoordbeleid', () => {
  assert.equal(valideerWachtwoord(genereerWachtwoord()), null);
});

// ---- permissies ------------------------------------------------------------

beforeEach(() => { state.profiel = null; });

test('defaultPermissies: beheerder heeft alles, lezer niets', () => {
  const b = defaultPermissies('beheerder');
  assert.equal(Object.values(b).every(v => v === true), true);
  const l = defaultPermissies('lezer');
  assert.equal(Object.values(l).every(v => v === false), true);
});

test('defaultPermissies: radioloog mag lezen en vakantie, niet wijzigen', () => {
  const r = defaultPermissies('radioloog');
  assert.equal(r.mag_beheer, false);
  assert.equal(r.mag_beheer_lezen, true);
  assert.equal(r.mag_vakantie, true);
  assert.equal(r.mag_gebruikers, false);
});

test('permissie: zonder profiel is alles false', () => {
  state.profiel = null;
  assert.equal(magWijzigen(), false);
});

test('permissie: rol-default geldt zonder expliciete permissies-map', () => {
  state.profiel = { rol: 'beheerder' };
  assert.equal(magWijzigen(), true);
  state.profiel = { rol: 'radioloog' };
  assert.equal(magWijzigen(), false);
});

test('permissie: expliciete permissies-map wint van de rol-default', () => {
  state.profiel = { rol: 'secretariaat', permissies: { mag_beheer: true } };
  assert.equal(magWijzigen(), true, 'toegekende permissie geldt');
  state.profiel = { rol: 'beheerder', permissies: { mag_beheer: false } };
  assert.equal(magWijzigen(), false, 'ingetrokken permissie geldt ook voor beheerder-rol');
});

test('permissie: onbekende sleutel in permissies-map valt terug op default', () => {
  state.profiel = { rol: 'radioloog', permissies: { mag_gebruikers: false } };
  assert.equal(permissie('mag_beheer_lezen'), true, 'niet-genoemde permissie volgt rol-default');
});
