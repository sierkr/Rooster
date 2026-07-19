// Activiteit-view: matrix met counts/ratios/verdeling per radioloog × functie.
// Groot bestand omdat alle berekeningen, helpers en handlers hier samenkomen.
import { state, VASTE_RAD_IDS, DAGEN_NL, HOOFD_FUNCTIES, BELASTING_GRENS } from '../state.js';
import {
  vasteRads, actieveInvallers, vasteRadsOpDatum, actieveInvallersOpDatum,
  bezettingenInRange, alleVasteStoelIds, isVasteStoel,
  radiologenMap, vandaagIso, formatDatum, fclass,
  hoofdLetterCode, functieFlags, parttimeFactor, huidigKalenderJaar,
  magBeheerLezen,
} from '../helpers.js';
import { openSheet, closeSheet } from '../sheets.js';

function periodeRange() {
  // Periode-presets relatief aan het huidige kalenderjaar.
  const jaar = huidigKalenderJaar();
  const p = state.actPeriode;
  if (p === 'q1')   return { vanaf: `${jaar}-01-01`, tot: `${jaar}-03-31` };
  if (p === 'q2')   return { vanaf: `${jaar}-04-01`, tot: `${jaar}-06-30` };
  if (p === 'q3')   return { vanaf: `${jaar}-07-01`, tot: `${jaar}-09-30` };
  if (p === 'q4')   return { vanaf: `${jaar}-10-01`, tot: `${jaar}-12-31` };
  if (p === 'maand') {
    const v = vandaagIso();
    const m = v.slice(0, 7);
    const eindDag = new Date(parseInt(m.slice(0,4)), parseInt(m.slice(5,7)), 0).getDate();
    return { vanaf: `${m}-01`, tot: `${m}-${String(eindDag).padStart(2,'0')}` };
  }
  if (p === 'custom') return { vanaf: state.actVanaf, tot: state.actTot };
  return { vanaf: `${jaar}-01-01`, tot: `${jaar}-12-31` };
}

function berekenActiviteit() {
  const { vanaf, tot } = periodeRange();
  // Pak alle slot-IDs (vast + actieve W). De actieve-W lijst gebruikt
  // vandaag als peildatum — dat is OK omdat we ook werkvloerdata over de
  // hele periode ophalen, niet alleen voor de actuele bezetters.
  const radIds = [...alleVasteStoelIds(), ...actieveInvallers().map(r => r.id)];

  const counts = {};
  const datums = {};
  const dienst = {};
  const dienstDatums = {};
  const werkvloerDatums = {}; // datums waarop iemand werkvloer-actief was
  radIds.forEach(rid => {
    counts[rid] = {};
    datums[rid] = {};
    dienst[rid] = 0;
    dienstDatums[rid] = [];
    werkvloerDatums[rid] = [];
  });

  Object.values(state.indelingMap).forEach(dag => {
    const dat = dag?.datum;
    if (!dat) return;
    if (dat < vanaf || dat > tot) return;

    const toew = dag.toewijzingen || {};
    radIds.forEach(rid => {
      const codes = toew[rid] || [];
      let werkvloerOpDag = false;
      codes.forEach(c => {
        counts[rid][c] = (counts[rid][c] || 0) + 1;
        if (!datums[rid][c]) datums[rid][c] = [];
        datums[rid][c].push(dat);
        if (functieFlags(c).werkvloer) werkvloerOpDag = true;
      });
      if (werkvloerOpDag) werkvloerDatums[rid].push(dat);
    });

    const dId = dag.dienst?.dag;
    if (dId && dienst[dId] !== undefined) {
      dienst[dId] += 1;
      dienstDatums[dId].push(dat);
    }
  });

  return { vanaf, tot, radIds, counts, datums, dienst, dienstDatums, werkvloerDatums };
}

// Tel hoe vaak code voorkomt voor slotId in de sub-periode [vanSub..totSub].
function aantalIn(datums, slotId, code, vanSub, totSub) {
  const lijst = datums[slotId]?.[code] || [];
  if (!vanSub && !totSub) return lijst.length;
  return lijst.filter(d => (!vanSub || d >= vanSub) && (!totSub || d <= totSub)).length;
}

// Bereken aggregaties (werkvloer/mtsdagen/etc.) voor een slot in een sub-periode.
function aggrIn(datums, slotId, vanSub, totSub) {
  const mtsCodes = (window.MTSDAGEN_CODES || ['W','B','E','M','D','O','S','A','Z','T','X']);
  let werkvloer = 0, mtsdagen = 0;
  let Q = 0, K = 0, P = 0, R = 0, V = 0;
  Object.entries(datums[slotId] || {}).forEach(([code, dates]) => {
    const inSub = dates.filter(d => (!vanSub || d >= vanSub) && (!totSub || d <= totSub)).length;
    if (functieFlags(code).werkvloer) werkvloer += inSub;
    if (mtsCodes.includes(hoofdLetterCode(code))) mtsdagen += inSub;
    if (code === 'Q') Q = inSub;
    if (code === 'K') K = inSub;
    if (code === 'P') P = inSub;
    if (code === 'R') R = inSub;
    if (code === 'V') V = inSub;
  });
  const mtsstby   = mtsdagen + (mtsCodes.includes('Q') ? 0 : Q);
  const werkdagen = mtsstby  + (mtsCodes.includes('K') ? 0 : K);
  const roostervrij = K + P + Q + R + V;
  return { werkvloer, mtsdagen, mtsstby, werkdagen, roostervrij };
}

// Tel werkvloer-aanwezigheid op een specifieke weekdag in de sub-periode.
function perWeekdagIn(werkvloerDatums, slotId, dagNl, vanSub, totSub) {
  const lijst = werkvloerDatums[slotId] || [];
  return lijst.filter(d => {
    if (vanSub && d < vanSub) return false;
    if (totSub && d > totSub) return false;
    const dt = new Date(d + 'T00:00:00');
    const idx = dt.getDay() === 0 ? 6 : dt.getDay() - 1;
    return DAGEN_NL[idx] === dagNl && idx < 5; // alleen werkdagen
  }).length;
}

function somHoofdGroep(counts, hoofd) {
  let n = counts[hoofd.letter] || 0;
  hoofd.varianten.forEach(v => { n += counts[v] || 0; });
  return n;
}

export function renderActView() {
  const container = document.getElementById('view-act');
  const rads = vasteRads();
  if (rads.length === 0) { container.innerHTML = '<div class="empty-state">Laden…</div>'; return; }

  const data = berekenActiviteit();
  const { datums, dienstDatums, werkvloerDatums, vanaf, tot } = data;

  const toonInv = state.actInvallers;
  const invallers = toonInv ? actieveInvallers() : [];
  const slotIds = [
    ...vasteRadsOpDatum(tot).map(r => r.id),
    ...(toonInv ? invallers.map(r => r.id) : []),
  ];

  // Bouw kolommen op basis van bezetting_historie binnen de periode.
  // Bij meerdere overlappende entries krijgt de stoel een sub-kolom per entry,
  // zodat een wisseljaar gesplitst getoond wordt per persoon.
  const kolommen = [];
  slotIds.forEach(slotId => {
    const entries = bezettingenInRange(slotId, vanaf, tot);
    const isVast = isVasteStoel(slotId);
    if (entries.length === 0) {
      // Stoel had geen bezetting in periode — toon lege kolom voor stabiliteit (alleen vast).
      if (isVast) kolommen.push({ id: slotId, slotId, label: slotId, isSlot: false, vanSub: vanaf, totSub: tot });
      return;
    }
    if (entries.length === 1) {
      const e = entries[0];
      kolommen.push({
        id: slotId, slotId,
        label: (e.code || slotId).slice(0, 4),
        isSlot: !isVast,
        vanSub: vanaf, totSub: tot,
        bezetting: e,
      });
    } else {
      // Splits: één kolom per entry, elk geclamped op periode.
      entries.forEach((e, i) => {
        const subVan = e.van && e.van > vanaf ? e.van : vanaf;
        const subTot = e.tot && e.tot < tot ? e.tot : tot;
        kolommen.push({
          id: `${slotId}#${i}`, slotId,
          label: (e.code || slotId).slice(0, 4),
          subLabel: `${formatDatum(subVan, 'kort')} – ${formatDatum(subTot, 'kort')}`,
          isSlot: !isVast,
          vanSub: subVan, totSub: subTot,
          bezetting: e,
        });
      });
    }
  });

  const periodes = [
    { id: 'jaar',   label: 'Heel jaar' },
    { id: 'q1',     label: 'Q1' },
    { id: 'q2',     label: 'Q2' },
    { id: 'q3',     label: 'Q3' },
    { id: 'q4',     label: 'Q4' },
    { id: 'custom', label: 'Aangepast' },
  ];

  const ratio = state.actModus === 'ratio';
  const verdeling = state.actModus === 'verdeling';
  const belasting = state.actModus === 'belasting';

  const aantalKol = kolommen.length;
  const labelBreedte = '110px';
  const cellBreedte = ratio ? 'minmax(40px, 1fr)' : 'minmax(30px, 1fr)';
  const gridCols = `${labelBreedte} repeat(${aantalKol}, ${cellBreedte}) 44px`;
  const minWidth = 120 + aantalKol * (ratio ? 44 : 34) + 44;
  // Eerste kolom-index van de waarnemer-sectie (voor visuele scheiding).
  const sepKolomIndex = kolommen.findIndex(k => k.isSlot);

  // Codes waarvoor "verdeling" niet zinvol is (niet stuurbaar / individueel)
  const GEEN_VERDELING_CODES = ['Z'];
  function rijHeeftKleur(rij) {
    if (rij.kind === 'hoofd' && GEEN_VERDELING_CODES.includes(rij.code)) return false;
    if (rij.kind === 'variant' && GEEN_VERDELING_CODES.includes(rij.code)) return false;
    return true;
  }
  function pfVan(k) {
    const pf = k.bezetting && typeof k.bezetting.parttime_factor === 'number'
      ? k.bezetting.parttime_factor
      : parttimeFactor(k.slotId);
    return Number.isFinite(pf) && pf > 0 ? Math.min(1, pf) : 1;
  }
  function rowGemPt(rij) {
    let som = 0, n = 0;
    kolommen.forEach(k => {
      if (k.isSlot) return; // alleen vaste stoelen tellen voor de norm
      const pf = pfVan(k);
      if (pf > 0) { som += celWaarde(rij, k) / pf; n++; }
    });
    return n ? som / n : 0;
  }
  function zoneClass(waarde, gem, k) {
    if (!gem) return '';
    const pf = pfVan(k);
    if (pf <= 0) return '';
    const r = (waarde / pf) / gem;
    if (r < 0.85) return 'act-zone-laag';
    if (r > 1.15) return 'act-zone-hoog';
    return '';
  }

  const rijen = [];
  HOOFD_FUNCTIES.forEach(hoofd => {
    rijen.push({ kind: 'hoofd', code: hoofd.letter, label: `${hoofd.letter} · ${hoofd.label}`, hoofd });
    if (state.actUitgeklapt[hoofd.letter] && hoofd.varianten.length > 0) {
      hoofd.varianten.forEach(v => {
        rijen.push({ kind: 'variant', code: v, label: v });
      });
    }
  });

  function celWaarde(rij, k) {
    const s = k.slotId;
    const v = k.vanSub, t = k.totSub;
    if (rij.kind === 'hoofd') {
      let n = aantalIn(datums, s, rij.hoofd.letter, v, t);
      rij.hoofd.varianten.forEach(va => { n += aantalIn(datums, s, va, v, t); });
      return n;
    }
    if (rij.kind === 'variant') return aantalIn(datums, s, rij.code, v, t);
    if (rij.kind === 'aggr')    return aggrIn(datums, s, v, t)[rij.aggrKey] || 0;
    if (rij.kind === 'dienst') {
      return (dienstDatums[s] || []).filter(d => (!v || d >= v) && (!t || d <= t)).length;
    }
    if (rij.kind === 'weekdag') return perWeekdagIn(werkvloerDatums, s, rij.dagNl, v, t);
    return 0;
  }
  function rowGem(rij) {
    if (kolommen.length === 0) return 0;
    let som = 0;
    kolommen.forEach(k => { som += celWaarde(rij, k); });
    return som / kolommen.length;
  }
  function celRatio(waarde, gem, k) {
    if (!gem) return null;
    const pf = pfVan(k);
    if (pf <= 0) return null;
    return waarde / gem / pf;
  }
  function fmtPct(v) {
    if (v === null || v === undefined) return '';
    return Math.round(v * 100) + '%';
  }
  function fmtGem(v) {
    if (v === null || v === undefined) return '';
    // Algebraïsch afronden (half naar boven) op heel getal.
    return String(Math.round(v));
  }

  function rijHtml(rij) {
    const gem = rowGem(rij);
    const cls = rij.kind === 'hoofd'   ? 'act-row-hoofd'
              : rij.kind === 'variant' ? 'act-row-variant'
              : rij.kind === 'aggr'    ? 'act-row-aggregaat'
              : rij.kind === 'dienst'  ? 'act-row-aggregaat'
              : '';
    const isExpandable = rij.kind === 'hoofd' && rij.hoofd.varianten.length > 0;
    const arrow = isExpandable
      ? (state.actUitgeklapt[rij.hoofd.letter] ? '▾ ' : '▸ ')
      : '';
    const onclick = isExpandable
      ? `onclick="window.actToggleHoofd('${rij.hoofd.letter}')"`
      : '';

    const kleurDezeRij = verdeling && rijHeeftKleur(rij);
    const gemPt = kleurDezeRij ? rowGemPt(rij) : 0;

    let html = `<div class="act-cell act-cell-label ${cls}" ${onclick} style="grid-column: 1;">${arrow}${rij.label}</div>`;

    kolommen.forEach((k, i) => {
      const waarde = celWaarde(rij, k);
      const sep = (i === sepKolomIndex && sepKolomIndex !== -1 && toonInv) ? 'act-sep' : '';
      const zero = waarde === 0 ? 'act-cell-zero' : '';
      let inhoud;
      if (ratio) {
        const r = celRatio(waarde, gem, k);
        if (r === null) {
          inhoud = `<span class="act-cell-zero">—</span>`;
        } else {
          const pct = fmtPct(r);
          const w = Math.min(100, Math.round(r * 100));
          const alpha = (0.18 + Math.min(1, r) * 0.37).toFixed(2);
          inhoud = `
            <div class="act-bar-wrap">
              <div class="act-bar-bg" style="width: ${w}%; background: rgba(55,138,221,${alpha});"></div>
              <div class="act-bar-fg act-pct">${pct}</div>
            </div>`;
        }
      } else if (belasting && rij.kind === 'hoofd' && BELASTING_GRENS[rij.code] !== undefined) {
        // Belasting: waarde / max(kolom) / parttime → vergelijk met grens
        const pf = pfVan(k);
        const maxWaarde = Math.max(1, ...kolommen.filter(kk => !kk.isSlot).map(kk => celWaarde(rij, kk)));
        const rel = pf > 0 ? (waarde / pf) / maxWaarde : 0;
        const grens = BELASTING_GRENS[rij.code];
        const pct = fmtPct(rel);
        const overGrens = rel > grens;
        const dichtBijGrens = !overGrens && rel > grens * 0.85;
        const kleur = overGrens
          ? 'rgba(220,53,69,0.15)'
          : dichtBijGrens
            ? 'rgba(255,165,0,0.15)'
            : 'rgba(40,167,69,0.10)';
        const tekstKleur = overGrens ? '#a01020' : dichtBijGrens ? '#7a4f00' : '#1a6b2f';
        inhoud = `<span style="color:${tekstKleur}; font-weight: ${overGrens ? '600' : '400'};">${pct}</span>`;
        // Overschrijf zone-achtergrond via inline style op de cel — zie hieronder
      } else if (belasting) {
        inhoud = `<span class="act-cell-zero">${waarde || '—'}</span>`;
      } else {
        inhoud = `<span class="${zero}">${waarde}</span>`;
      }
      const klikbaar = waarde > 0 && rij.kind !== 'aggr' ? 'act-cell-clickable' : '';
      const klikAttr = (waarde > 0 && rij.kind !== 'aggr')
        ? `onclick="window.actToonDrilldown('${k.slotId}','${rij.kind}','${(rij.code||rij.dagNl||'')}','${k.vanSub||''}','${k.totSub||''}')"`
        : '';
      const zone = kleurDezeRij ? zoneClass(waarde, gemPt, k) : '';

      // Belasting: achtergrondkleur op celniveau voor hoofdfuncties met grens
      let belastingStyle = '';
      if (belasting && rij.kind === 'hoofd' && BELASTING_GRENS[rij.code] !== undefined) {
        const pf = pfVan(k);
        const maxWaarde = Math.max(1, ...kolommen.filter(kk => !kk.isSlot).map(kk => celWaarde(rij, kk)));
        const rel = pf > 0 ? (waarde / pf) / maxWaarde : 0;
        const grens = BELASTING_GRENS[rij.code];
        belastingStyle = `background: ${rel > grens ? 'rgba(220,53,69,0.12)' : rel > grens * 0.85 ? 'rgba(255,165,0,0.12)' : 'rgba(40,167,69,0.08)'};`;
      }

      html += `<div class="act-cell ${cls} ${sep} ${klikbaar} ${zone}" ${klikAttr} style="${belastingStyle}">${inhoud}</div>`;
    });

    const gemCelInhoud = gem
      ? `<span class="act-cell-max">${fmtGem(gem)}</span>`
      : '<span class="act-cell-zero">0</span>';
    html += `<div class="act-cell ${cls} act-sep">${gemCelInhoud}</div>`;
    return html;
  }

  function sectieKopHtml(label) {
    const totaalKol = aantalKol + 2;
    return `<div class="act-cell act-row-sectie" style="grid-column: 1 / span ${totaalKol};">${label}</div>`;
  }

  let html = `
    <div class="card">
      <div class="seg" style="width: 100%;">
        <button class="seg-btn ${state.actModus==='aantal' ? 'actief' : ''}" onclick="window.actZetModus('aantal')">Aantallen</button>
        <button class="seg-btn ${state.actModus==='ratio' ? 'actief' : ''}" onclick="window.actZetModus('ratio')">Ratio's</button>
        <button class="seg-btn ${state.actModus==='verdeling' ? 'actief' : ''}" onclick="window.actZetModus('verdeling')">Verdeling</button>
        <button class="seg-btn ${state.actModus==='belasting' ? 'actief' : ''}" onclick="window.actZetModus('belasting')">Belasting</button>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 8px;">
        <p style="font-size: 15px; font-weight: 500; margin: 0;">Activiteit</p>
        <p class="muted" style="margin: 0; font-size: 13px;">${formatDatum(vanaf,'kort')} – ${formatDatum(tot,'kort')}</p>
      </div>
      <div class="act-controls" style="margin-top: 8px;">
        ${periodes.map(p => `
          <button class="seg-btn ${state.actPeriode===p.id?'actief':''}" style="background: ${state.actPeriode===p.id?'#fff':'rgba(0,0,0,0.05)'}; box-shadow: ${state.actPeriode===p.id?'0 1px 2px rgba(0,0,0,0.04)':'none'};" onclick="window.actZetPeriode('${p.id}')">${p.label}</button>
        `).join('')}
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; margin-left: auto;">
          <span class="muted">Waarnemers</span>
          <span class="toggle-switch ${toonInv ? 'aan' : ''}" onclick="window.actToggleInvallers()"></span>
        </label>
      </div>
      ${state.actPeriode === 'custom' ? `
        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <input type="date" class="act-period-input" id="actVanaf" value="${state.actVanaf || huidigKalenderJaar()+'-01-01'}" onchange="window.actZetVanafTot()">
          <span class="muted" style="align-self: center;">tot</span>
          <input type="date" class="act-period-input" id="actTot" value="${state.actTot || huidigKalenderJaar()+'-12-31'}" onchange="window.actZetVanafTot()">
        </div>
      ` : ''}
      <p class="muted" style="margin: 10px 0 0; font-size: 11px;">${
        ratio
          ? 'Ratio = aantal / rij-gemiddelde / parttime-factor (100% = gemiddelde)'
          : verdeling
            ? 'Kleur = afwijking t.o.v. rij-gemiddelde (parttime-gecorrigeerd, vaste 8 als basis).'
            : belasting
              ? 'Belasting = aandeel t.o.v. hoogst-belaste radioloog (parttime-gecorrigeerd). Groen = onder grens, oranje = dichtbij, rood = over grens.'
              : 'Tik een hoofdfunctie om varianten in/uit te klappen. Tik een cel voor de datums.'
      }</p>
      ${verdeling ? `
        <div class="act-zone-legend">
          <span class="act-zone-swatch act-zone-laag">&lt; 85%</span>
          <span class="act-zone-swatch" style="background: rgba(0,0,0,0.04);">85 – 115%</span>
          <span class="act-zone-swatch act-zone-hoog">&gt; 115%</span>
          <span class="muted" style="margin-left: auto; font-size: 11px;">100% = rij-gemiddelde</span>
        </div>
      ` : ''}
      ${belasting ? `
        <div class="act-zone-legend">
          <span class="act-zone-swatch" style="background: rgba(40,167,69,0.15); color:#1a6b2f;">✓ Onder grens</span>
          <span class="act-zone-swatch" style="background: rgba(255,165,0,0.15); color:#7a4f00;">⚠ Dichtbij grens</span>
          <span class="act-zone-swatch" style="background: rgba(220,53,69,0.15); color:#a01020;">✗ Over grens</span>
          <span class="muted" style="margin-left: auto; font-size: 11px;">Grens per functie: W/O/B=50% · E/M=90% · D/S=100%</span>
        </div>
      ` : ''}
    </div>

    <div class="act-grid-wrap">
      <div class="act-grid" style="grid-template-columns: ${gridCols}; min-width: ${minWidth}px;">
        <div class="act-head act-cell-label">Functie</div>
        ${kolommen.map((k, i) => {
          const sep = (i === sepKolomIndex && sepKolomIndex !== -1 && toonInv) ? 'act-sep' : '';
          const tooltip = k.subLabel ? `${k.label} · ${k.subLabel}` : (k.bezetting?.achternaam || k.label);
          const sub = k.subLabel ? `<div style="font-size:9px; font-weight:400; color:#5f5e5a; line-height:1.1;">${k.subLabel}</div>` : '';
          return `<div class="act-head ${sep}" title="${tooltip}">${k.label}${sub}</div>`;
        }).join('')}
        <div class="act-head act-sep" title="Gemiddelde">x̄</div>

        ${rijen.map(rijHtml).join('')}

        ${sectieKopHtml('Aanwezigheid per weekdag (werkvloer)')}
        ${[
          { kind: 'weekdag', dagNl: 'ma', label: 'maandag' },
          { kind: 'weekdag', dagNl: 'di', label: 'dinsdag' },
          { kind: 'weekdag', dagNl: 'wo', label: 'woensdag' },
          { kind: 'weekdag', dagNl: 'do', label: 'donderdag' },
          { kind: 'weekdag', dagNl: 'vr', label: 'vrijdag' },
        ].map(rijHtml).join('')}

        ${sectieKopHtml('Samenvatting')}
        ${[
          { kind: 'dienst', label: 'Dienst' },
          { kind: 'aggr', aggrKey: 'werkvloer', label: 'Werkvloer' },
          { kind: 'aggr', aggrKey: 'mtsdagen', label: 'Maatschapsdagen' },
          { kind: 'aggr', aggrKey: 'mtsstby', label: 'Mts + Stby' },
          { kind: 'aggr', aggrKey: 'werkdagen', label: 'Werkdagen' },
          { kind: 'aggr', aggrKey: 'roostervrij', label: 'Roostervrij' },
        ].map(rijHtml).join('')}
      </div>
    </div>

    <div class="legend">
      <div class="legend-label">Definities</div>
      <div style="font-size: 11px; line-height: 1.6; color: #5f5e5a;">
        <b>Werkvloer</b> = productie-functies (W, B, E, M, D, S, O, A varianten).<br>
        <b>Maatschapsdagen</b> = ${(window.MTSDAGEN_CODES || ['W','B','E','M','D','O','S','A','Z','T','X']).join(', ')} (configureerbaar in Regels-tab).<br>
        <b>Mts + Stby</b> = Maatschapsdagen + Quarantaine.<br>
        <b>Werkdagen</b> = Mts + Stby + Cursus.<br>
        <b>Roostervrij</b> = Cursus + Parttime + Quarantaine + Reserve + Vakantie.
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// ==== Handlers ===============================================================

window.actZetModus = function(m)        { state.actModus = m; renderActView(); };
window.actZetPeriode = function(p)      { state.actPeriode = p; renderActView(); };
window.actZetVanafTot = function() {
  const a = document.getElementById('actVanaf').value;
  const b = document.getElementById('actTot').value;
  if (a) state.actVanaf = a;
  if (b) state.actTot = b;
  // v3.29.0 (H2): custom bereik kan buiten het geladen datumvenster vallen;
  // breid het venster uit (re-render volgt automatisch via de listener).
  if (state.actVanaf && state.actTot && window.zorgIndelingVenster) {
    window.zorgIndelingVenster(state.actVanaf, state.actTot);
  }
  renderActView();
};
window.actToggleInvallers = function() { state.actInvallers = !state.actInvallers; renderActView(); };
window.actToggleHoofd = function(letter){ state.actUitgeklapt[letter] = !state.actUitgeklapt[letter]; renderActView(); };

window.actToonDrilldown = function(radId, kind, code, vanSub, totSub) {
  const rad = radiologenMap()[radId];
  const radLabel = rad ? `${rad.code} · ${rad.achternaam}` : radId;
  const data = berekenActiviteit();
  const { datums, dienstDatums } = data;
  const inSub = (d) => (!vanSub || d >= vanSub) && (!totSub || d <= totSub);

  let titel = '';
  let lijst = [];
  if (kind === 'hoofd') {
    const hoofd = HOOFD_FUNCTIES.find(h => h.letter === code);
    if (!hoofd) return;
    titel = `${hoofd.letter} · ${hoofd.label}`;
    const set = new Set();
    (datums[radId]?.[hoofd.letter] || []).forEach(d => set.add(d + '|' + hoofd.letter));
    hoofd.varianten.forEach(v => {
      (datums[radId]?.[v] || []).forEach(d => set.add(d + '|' + v));
    });
    lijst = [...set].map(x => { const [d, c] = x.split('|'); return { datum: d, code: c }; });
  } else if (kind === 'variant') {
    titel = code;
    lijst = (datums[radId]?.[code] || []).map(d => ({ datum: d, code }));
  } else if (kind === 'dienst') {
    titel = 'Dienst';
    lijst = (dienstDatums[radId] || []).map(d => ({ datum: d, code: 'D' }));
  } else if (kind === 'weekdag') {
    titel = `Aanwezig op ${ {ma:'maandag',di:'dinsdag',wo:'woensdag',do:'donderdag',vr:'vrijdag'}[code] || code }`;
    const out = [];
    Object.keys(datums[radId] || {}).forEach(c => {
      if (!functieFlags(c).werkvloer) return;
      (datums[radId][c] || []).forEach(d => {
        const dt = new Date(d + 'T00:00:00');
        const dnIdx = dt.getDay() === 0 ? 6 : dt.getDay() - 1;
        if (DAGEN_NL[dnIdx] === code) out.push({ datum: d, code: c });
      });
    });
    lijst = out;
  }
  // Filter op sub-periode (bij split-kolom).
  lijst = lijst.filter(it => inSub(it.datum));
  lijst.sort((a, b) => a.datum.localeCompare(b.datum));

  document.getElementById('sheetTitle').textContent = titel;
  document.getElementById('sheetSub').textContent = `${radLabel} · ${lijst.length} dag${lijst.length===1?'':'en'}`;

  let body = '';
  if (lijst.length === 0) {
    body = `<div class="empty-state" style="padding: 1rem;">Geen dagen in deze periode</div>`;
  } else {
    body = `<div style="max-height: 60vh; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">`;
    lijst.forEach(it => {
      const sprng = magBeheerLezen() ? `onclick="window.springNaarBeheer('${it.datum}'); window.closeSheet();"` : '';
      const cur = magBeheerLezen() ? 'cursor: pointer;' : '';
      body += `
        <div class="card card-compact" style="padding: 8px 12px; ${cur} margin-bottom: 0;" ${sprng}>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>${formatDatum(it.datum, 'kort')}</span>
            <span class="badge ${fclass(it.code)}">${it.code}</span>
          </div>
        </div>
      `;
    });
    body += `</div>`;
  }
  body += `<button class="btn" style="width: 100%; margin-top: 1rem;" onclick="window.closeSheet()">Sluiten</button>`;
  document.getElementById('sheetBody').innerHTML = body;
  openSheet();
};
