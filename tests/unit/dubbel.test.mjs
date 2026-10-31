// Unit-tests voor "één persoon op twee stoelen" (v3.38.0): de controle en het
// samenvoeg-plan uit app/dubbel.js. De beginsituatie is die van live in
// oktober 2026: GJG als waarnemer op W1 (sinds 6 jul 2026, nooit afgesloten)
// en dezelfde GJG via "Nieuwe stoel" op een vaste stoel per 1 nov 2026.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../../app/state.js';
import { assertBezettingGeldig } from '../../app/helpers.js';
import {
  zoekDubbelen, standaardKeuze, maakPlan, schrijfOpdrachten, datumProbleem,
  zelfdePersoonElders, stoelOverzicht, WEG,
} from '../../app/dubbel.js';

const VS = 'VSmtr05qqh';

function dag(datum, velden = {}) {
  return { datum, toewijzingen: {}, dienst: {}, vakantie_v: {}, cel_opmerkingen: {}, ...velden };
}

function beginsituatie({ w1Tot = null } = {}) {
  state.radiologen = [
    { id: 'F', code: 'GFR', achternaam: 'Fransen', vaste_stoel: true, isSlot: false, actief: true,
      bezetting_historie: [{ code: 'GF', achternaam: 'Fransen', van: null, tot: '2026-12-31' },
        { code: 'GFR', achternaam: 'Fransen', van: '2027-01-01', tot: null, persoon_id: 'Pfr' }] },
    { id: 'V', code: 'HVL', achternaam: 'van Vleuten', vaste_stoel: true, isSlot: false, actief: true,
      bezetting_historie: [{ code: 'HVL', achternaam: 'van Vleuten', van: '2006-01-01', tot: '2026-12-31', persoon_id: 'Pv1' },
        { code: 'HVL', achternaam: 'van Vleuten', van: '2027-01-01', tot: null, persoon_id: 'Pv2' }] },
    { id: VS, code: 'GJG', achternaam: 'Greuter', voornaam: 'G', vaste_stoel: true, isSlot: false, actief: true,
      in_dienst: '2026-11-01', persoon_id: 'Pnieuw',
      bezetting_historie: [{ code: 'GJG', achternaam: 'Greuter', voornaam: 'G', van: '2026-11-01', tot: null, persoon_id: 'Pnieuw', in_dienst: '2026-11-01' }] },
    { id: 'W1', code: 'GJG', achternaam: 'Greuter', isSlot: true, actief: true, persoon_id: 'Poud', in_dienst: '2026-07-06',
      bezetting_historie: [{ code: 'W1', achternaam: 'W1', van: null, tot: '2026-07-05' },
        { code: 'GJG', achternaam: 'Greuter', van: '2026-07-06', tot: w1Tot, persoon_id: 'Poud', in_dienst: '2026-07-06' }] },
    { id: 'W2', code: 'W2', achternaam: 'W2', isSlot: true, actief: false, bezetting_historie: [] },
    { id: 'W3', code: 'EB', achternaam: 'Beurle', isSlot: true, actief: true, bezetting_historie: [{ code: 'EB', achternaam: 'Beurle', van: null, tot: null }] },
  ];
  state.indelingMap = {};
  ['A', 'D', 'R', 'D', 'O'].forEach((c, i) => {
    const d = `2026-11-0${i + 2}`;
    state.indelingMap[d] = dag(d, { toewijzingen: { W1: [c], F: ['B'] } });
  });
  ['2027-01-04', '2027-01-13', '2027-01-14'].forEach(d => { state.indelingMap[d] = dag(d, { toewijzingen: { [VS]: ['W'] } }); });
  state.wensen = [];
  state.gebruikers = [];
}

beforeEach(() => beginsituatie());

// Past de schrijfopdrachten toe op de state, zoals Firestore dat zou doen.
function pasToe(plan, keuzes = {}) {
  const opdr = schrijfOpdrachten(plan, keuzes);
  opdr.indeling.forEach(o => {
    const d = state.indelingMap[o.datum];
    Object.entries(o.upd).forEach(([pad, v]) => {
      const [veld, sleutel] = pad.split('.');
      d[veld] = d[veld] || {};
      if (v === WEG) delete d[veld][sleutel]; else d[veld][sleutel] = v;
    });
  });
  Object.entries(plan.stoelUpdates).forEach(([id, upd]) => {
    const st = state.radiologen.find(r => r.id === id);
    Object.assign(st, upd);
  });
  if (plan.cVerwijderen) state.radiologen = state.radiologen.filter(r => r.id !== plan.C);
  plan.wensen.forEach(w => { state.wensen.find(x => x.id === w.id).radioloog_id = w.naar; });
  plan.gebruikers.forEach(g => { state.gebruikers.find(x => x.id === g.id).radioloog_id = g.naar; });
  return opdr;
}

test('ziet GJG twee keer: W1 en de nieuwe vaste stoel overlappen vanaf 1 nov 2026', () => {
  const lijst = zoekDubbelen();
  assert.equal(lijst.length, 1);
  assert.equal(lijst[0].soort, 'dubbel');
  assert.equal(lijst[0].code, 'GJG');
  assert.equal(lijst[0].vanaf, '2026-11-01');
  assert.deepEqual([lijst[0].a.stoelId, lijst[0].b.stoelId].sort(), ['W1', VS].sort());
});

test('geen valse meldingen: plaatshouders, lege W-stoelen en dezelfde stoel met twee persoon-ids', () => {
  state.radiologen = state.radiologen.filter(r => r.id !== VS);
  assert.deepEqual(zoekDubbelen(), []);
});

test('voorstel: de vaste stoel blijft, vanaf de dag dat hij daar begon', () => {
  const k = standaardKeuze(zoekDubbelen()[0]);
  assert.deepEqual(k, { blijftId: VS, datum: '2026-11-01' });
});

test('plan voor GJG: W1 stopt 31 okt, 5 dagen naar de vaste stoel, geen botsingen, één persoon-id', () => {
  const bev = zoekDubbelen()[0];
  const p = maakPlan(bev, standaardKeuze(bev));
  assert.equal(p.fout, null);
  assert.equal(p.S, VS); assert.equal(p.C, 'W1');
  assert.equal(p.Cna.tot, '2026-10-31');
  assert.equal(p.Svan, '2026-11-01');
  assert.equal(p.tellingen.naarS.toew, 5);
  assert.equal(p.botsingen.length, 0);
  assert.equal(p.pidHouden, 'Poud');   // het id van zijn eerste periode (W1) blijft
  assert.equal(p.pidWeg, 'Pnieuw');
  assert.equal(p.cLeeg, true);         // W1 is daarna leeg
  assert.equal(p.cVerwijderen, false);
  assert.equal(p.stoelUpdates[VS].persoon_id, 'Poud');
  assert.equal(p.stoelUpdates[VS].bezetting_historie[0].persoon_id, 'Poud');
  assert.equal(p.stoelUpdates.W1.bezetting_historie[1].tot, '2026-10-31');
  assert.equal(p.stoelUpdates.W1.actief, false);
  Object.entries(p.stoelUpdates).forEach(([id, u]) => assertBezettingGeldig(u.bezetting_historie, id));
});

test('schrijfopdrachten verplaatsen precies de W1-cellen en bewaren de exacte terugweg', () => {
  const bev = zoekDubbelen()[0];
  const p = maakPlan(bev, standaardKeuze(bev));
  const opdr = schrijfOpdrachten(p);
  assert.equal(opdr.indeling.length, 5);
  const nov2 = opdr.indeling.find(o => o.datum === '2026-11-02');
  assert.deepEqual(nov2.upd, { [`toewijzingen.${VS}`]: ['A'], 'toewijzingen.W1': WEG });
  assert.deepEqual(nov2.herstel, { [`toewijzingen.${VS}`]: WEG, 'toewijzingen.W1': ['A'] });
  assert.equal(opdr.concept.length, 0);
});

test('na samenvoegen staat GJG één keer in de app, met al zijn dagen op één stoel', () => {
  const bev = zoekDubbelen()[0];
  const p = maakPlan(bev, standaardKeuze(bev));
  pasToe(p);
  assert.deepEqual(zoekDubbelen(), []);
  assert.deepEqual(state.indelingMap['2026-11-04'].toewijzingen, { [VS]: ['R'], F: ['B'] });
  const o = stoelOverzicht({ stoelId: VS, idx: 0 });
  assert.equal(o.dagen, 8); // 5 uit W1 + 3 eigen
});

test('botsing: op een dag hebben beide stoelen iets — voorstel houdt de blijvende stoel, keuze C neemt W1', () => {
  state.indelingMap['2026-11-03'].toewijzingen[VS] = ['B'];
  const bev = zoekDubbelen()[0];
  const p = maakPlan(bev, standaardKeuze(bev));
  assert.equal(p.botsingen.length, 1);
  assert.equal(p.botsingen[0].datum, '2026-11-03');
  const s = schrijfOpdrachten(p, {}).indeling.find(o => o.datum === '2026-11-03');
  assert.deepEqual(s.upd, { 'toewijzingen.W1': WEG });             // B blijft, D vervalt
  assert.deepEqual(s.herstel, { 'toewijzingen.W1': ['D'] });
  const c = schrijfOpdrachten(p, { '2026-11-03': 'C' }).indeling.find(o => o.datum === '2026-11-03');
  assert.deepEqual(c.upd, { [`toewijzingen.${VS}`]: ['D'], 'toewijzingen.W1': WEG });
  assert.deepEqual(c.herstel, { [`toewijzingen.${VS}`]: ['B'], 'toewijzingen.W1': ['D'] });
});

test('gelijke waarde op beide stoelen is geen botsing', () => {
  state.indelingMap['2026-11-03'].toewijzingen[VS] = ['D'];
  const bev = zoekDubbelen()[0];
  assert.equal(maakPlan(bev, standaardKeuze(bev)).botsingen.length, 0);
});

test('vakantie-V, dienst, opmerking, wens, account en conceptcel gaan mee', () => {
  const m = state.indelingMap;
  m['2026-11-04'].vakantie_v = { W1: true };
  m['2026-11-05'].dienst = { dag: 'W1', avond: 'F' };
  m['2026-11-06'].cel_opmerkingen = { W1: 'later' };
  state.wensen = [{ id: 'w1', datum: '2026-11-06', radioloog_id: 'W1' }, { id: 'w0', datum: '2026-10-01', radioloog_id: 'W1' }];
  state.gebruikers = [{ id: 'u1', naam: 'gjg', radioloog_id: 'W1' }];
  const concepten = { 2026: { '2026-11-04|W1': { nieuw: 'B', was: 'R' }, '2026-11-02|_dienst': { nieuw: 'W1', was: '' } } };
  const bev = zoekDubbelen()[0];
  const p = maakPlan(bev, standaardKeuze(bev), concepten);
  assert.equal(p.tellingen.naarS.vak, 1);
  assert.equal(p.tellingen.naarS.dienst, 1);
  assert.equal(p.tellingen.naarS.opm, 1);
  assert.equal(p.tellingen.naarS.wensen, 1);   // de wens van oktober hoort bij W1-tijd
  assert.equal(p.tellingen.naarS.concept, 1);
  assert.deepEqual(p.gebruikers.map(g => [g.id, g.naar]), [['u1', VS]]);
  const opdr = schrijfOpdrachten(p);
  const d5 = opdr.indeling.find(o => o.datum === '2026-11-05');
  assert.equal(d5.upd['dienst.dag'], VS);
  assert.equal(d5.herstel['dienst.dag'], 'W1');
  assert.equal(d5.upd['dienst.avond'], undefined);
  const cel = (s) => opdr.concept.find(c => c.sleutel === s);
  assert.deepEqual(cel('2026-11-04|W1'), { jaar: '2026', sleutel: '2026-11-04|W1', nieuw: null, oud: { nieuw: 'B', was: 'R' } });
  assert.deepEqual(cel(`2026-11-04|${VS}`).nieuw, { nieuw: 'B', was: 'R' });
  // Dienst in het concept op W1 wordt de vaste stoel; "was" blijft wat er in het rooster staat.
  assert.deepEqual(cel('2026-11-02|_dienst').nieuw, { nieuw: VS, was: '' });
});

test('losse dagen: W1 netjes afgesloten, maar zijn dagen bleven op W1 staan', () => {
  beginsituatie({ w1Tot: '2026-10-31' });
  const lijst = zoekDubbelen();
  assert.equal(lijst.length, 1);
  assert.equal(lijst[0].soort, 'los');
  assert.equal(lijst[0].losseDagen.length, 5);
  assert.equal(lijst[0].a.stoelId, 'W1');
  const p = maakPlan(lijst[0], standaardKeuze(lijst[0]));
  assert.equal(p.fout, null);
  assert.equal(p.S, VS);
  assert.equal(p.Cna.tot, '2026-10-31');        // ongewijzigd
  assert.equal(p.Svan, '2026-11-01');           // ongewijzigd
  assert.equal(p.tellingen.naarS.toew, 5);
  pasToe(p);
  assert.deepEqual(zoekDubbelen(), []);
});

test('losse dagen van een opvolger op W1 blijven daar (horen niet bij GJG)', () => {
  beginsituatie({ w1Tot: '2026-10-31' });
  state.radiologen.find(r => r.id === 'W1').bezetting_historie.push({ code: 'XY', achternaam: 'Ander', van: '2026-11-04', tot: null });
  const lijst = zoekDubbelen();
  assert.equal(lijst.length, 1);
  assert.deepEqual(lijst[0].losseDagen, ['2026-11-02', '2026-11-03']);
});

test('andere stoel kiezen: W1 blijft, de nieuwe vaste stoel verdwijnt helemaal', () => {
  const bev = zoekDubbelen()[0];
  const p = maakPlan(bev, { blijftId: 'W1', datum: '2026-07-06' });
  assert.equal(p.fout, null);
  assert.equal(p.cVerwijderen, true);
  assert.equal(p.Svan, '2026-07-06');
  assert.equal(p.tellingen.naarS.toew, 3);
  const fout = datumProbleem(bev, 'W1', '2026-12-01', { stoel: id => id, datum: d => d });
  assert.match(fout, /op of vóór 2026-11-01/);
});

test('latere datum: de dagen tussen de oude en nieuwe startdatum gaan terug naar W1', () => {
  state.indelingMap['2026-12-01'] = dag('2026-12-01', { toewijzingen: { [VS]: ['E'] } });
  const bev = zoekDubbelen()[0];
  const p = maakPlan(bev, { blijftId: VS, datum: '2027-01-01' });
  assert.equal(p.fout, null);
  assert.equal(p.Cna.tot, '2026-12-31');
  assert.equal(p.Svan, '2027-01-01');
  assert.equal(p.tellingen.naarC.toew, 1);   // 1 dec 2026 → W1
  assert.equal(p.tellingen.naarS.toew, 0);   // de november-dagen horen dan bij W1
  pasToe(p);
  assert.deepEqual(zoekDubbelen(), []);
  assert.deepEqual(state.indelingMap['2026-12-01'].toewijzingen, { W1: ['E'] });
});

test('voorkomen: Nieuwe stoel met dezelfde code en naam vindt de bestaande stoel', () => {
  state.radiologen = state.radiologen.filter(r => r.id !== VS);
  const hit = zelfdePersoonElders({ code: 'GJG', achternaam: 'Greuter', datum: '2026-11-01' });
  assert.equal(hit.stoelId, 'W1');
  assert.equal(zelfdePersoonElders({ code: 'AB', achternaam: 'Anders', datum: '2026-11-01' }), null);
  // Al vertrokken vóór de ingangsdatum: geen dubbele.
  state.radiologen.find(r => r.id === 'W1').bezetting_historie[1].tot = '2026-10-15';
  assert.equal(zelfdePersoonElders({ code: 'GJG', achternaam: 'Greuter', datum: '2026-11-01' }), null);
});

test('voorkomen: → Vast ziet dat de waarnemer al op een vaste stoel zit', () => {
  const hit = zelfdePersoonElders({ pid: 'Poud', code: 'GJG', achternaam: 'Greuter', datum: '2026-11-01', behalve: 'W1' });
  assert.equal(hit.stoelId, VS);
});
