// Vakantie-view: jaar-matrix per dag × radioloog met V-toggles,
// beheer-kolommen (X / Min / Rank) en ranking-CRUD.
//
// Datamodel in Firestore:
//   indeling/{datum}.vakantie_x    bool   - dag gemarkeerd als vakantiedag
//   indeling/{datum}.vakantie_min  number - minimale bezetting
//   indeling/{datum}.vakantie_rank string - naam van ranking-tabel
//   indeling/{datum}.vakantie_v    object - { [radioloog_id]: true }
//
//   vakantie_rankings/{naam}  {
//     naam, label, kleur, anker_jaar, anker_volgorde: [8 radioloog_ids]
//   }

import {
  collection, doc, setDoc, updateDoc, deleteDoc, getDocs,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { db } from '../firebase-init.js';
import { state, VASTE_RAD_IDS } from '../state.js';
import {
  vasteRads, radiologenMap, vandaagIso, formatDatum,
  magBeheerLezen,
} from '../helpers.js';
import { openSheet, closeSheet } from '../sheets.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function isBeheerder() {
  return state.profiel?.rol === 'beheerder';
}

function eigenRadId() {
  return state.profiel?.radioloog_id || null;
}

// Genereer alle datums voor het huidige jaar
function jaarDatums(jaar) {
  const lijst = [];
  const start = new Date(jaar, 0, 1);
  const eind  = new Date(jaar, 11, 31);
  for (let d = new Date(start); d <= eind; d.setDate(d.getDate() + 1)) {
    lijst.push(d.toISOString().slice(0, 10));
  }
  return lijst;
}

function huidigJaar() {
  return new Date().getFullYear();
}

const MAAND_KORT = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
const DAG_KORT   = ['zo','ma','di','wo','do','vr','za'];

function dagLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  return `${DAG_KORT[d.getDay()]} ${d.getDate()} ${MAAND_KORT[d.getMonth()]}`;
}

// Bereken volgorde voor een ranking in een bepaald jaar
function rankingVolgordeVoorJaar(ranking, jaar) {
  if (!ranking) return [];
  const anker = ranking.anker_jaar || huidigJaar();
  const ankerVolgorde = ranking.anker_volgorde || [];
  const verschuiving = ((jaar - anker) * 3) % 8;
  const n = ankerVolgorde.length;
  if (n === 0) return [];
  return ankerVolgorde.map((_, i) => ankerVolgorde[(i + verschuiving + n * 8) % n]);
}

// Lokale cache voor rankings (geladen bij mount)
let _rankings = {};

async function laadRankings() {
  try {
    const snap = await getDocs(collection(db, 'vakantie_rankings'));
    _rankings = {};
    snap.forEach(d => { _rankings[d.id] = { id: d.id, ...d.data() }; });
  } catch (e) {
    console.error('Rankings laden mislukt', e);
  }
}

// ─── saldo berekening ────────────────────────────────────────────────────────

function berekenSaldo(radId, jaar) {
  let vakantieV = 0;
  let dienstV   = 0;
  Object.values(state.indelingMap).forEach(dag => {
    if (!dag?.datum || !dag.datum.startsWith(String(jaar))) return;
    if (dag.vakantie_v?.[radId]) {
      vakantieV++;
      // Als diezelfde dag ook dienst is voor deze rad, telt het niet mee
      const codes = dag.toewijzingen?.[radId] || [];
      if (codes.includes('D') || codes.includes('dienst')) dienstV++;
    }
  });
  return { vakantieV, dienstV, saldo: vakantieV - dienstV };
}

// ─── render ──────────────────────────────────────────────────────────────────

export async function renderVakView() {
  const container = document.getElementById('view-vak');
  container.innerHTML = '<div class="card"><p class="muted">Laden…</p></div>';

  await laadRankings();

  const jaar = huidigJaar();
  const rads = vasteRads();
  const radMap = radiologenMap();
  const eigenId = eigenRadId();
  const beheer  = isBeheerder();

  // Saldo-rij boven de tabel
  const saldoRij = rads.map(r => {
    const { vakantieV, saldo } = berekenSaldo(r.id, jaar);
    return `<th title="${r.achternaam}">${r.code}<br><span style="font-weight:400;font-size:11px">${vakantieV}</span></th>`;
  }).join('');

  // Datums
  const datums = jaarDatums(jaar);

  // Tabel opbouwen
  let tbody = '';
  let vorigeMaand = '';

  datums.forEach(iso => {
    const dag = state.indelingMap[iso] || {};
    const x   = dag.vakantie_x || false;
    const min = dag.vakantie_min != null ? dag.vakantie_min : '';
    const rankNaam = dag.vakantie_rank || '';
    const ranking  = _rankings[rankNaam] || null;
    const vData    = dag.vakantie_v || {};

    const d = new Date(iso + 'T12:00:00');
    const maand = MAAND_KORT[d.getMonth()];
    const isWeekend = (d.getDay() === 0 || d.getDay() === 6);

    // Rij-kleur: weekend = lichtgrijs, vakantiedag = rankingkleur
    let rijKleur = '';
    if (x && ranking?.kleur) {
      rijKleur = `style="background:${ranking.kleur}22;"`;
    } else if (isWeekend) {
      rijKleur = `style="background:var(--bg-secondary,#f5f5f5);"`;
    }

    // Overschrijding? (V's > 8 − min)
    const aantalV = Object.values(vData).filter(Boolean).length;
    const maxV    = (min !== '' && !isNaN(min)) ? (rads.length - Number(min)) : Infinity;
    const overschreden = aantalV > maxV;

    if (overschreden) rijKleur = `style="background:#ffdddd;"`;

    // Maandscheiding
    let maandRij = '';
    if (maand !== vorigeMaand) {
      maandRij = `<tr><td colspan="${3 + rads.length}" style="background:var(--accent-color,#1565c0);color:#fff;font-weight:600;font-size:12px;padding:3px 8px;">${maand.toUpperCase()} ${jaar}</td></tr>`;
      vorigeMaand = maand;
    }

    // Beheer-kolommen
    const xCell = beheer
      ? `<td style="text-align:center;cursor:pointer;" onclick="window.vakToggleX('${iso}')">${x ? '✓' : '<span style="color:#ccc">—</span>'}</td>`
      : `<td style="text-align:center;color:#999">${x ? '✓' : ''}</td>`;

    const minCell = beheer
      ? `<td style="text-align:center;"><input type="number" min="0" max="${rads.length}" value="${min}" style="width:44px;text-align:center;border:1px solid #ddd;border-radius:4px;padding:2px;" onchange="window.vakSetMin('${iso}', this.value)" ${x ? '' : 'disabled'}></td>`
      : `<td style="text-align:center;color:#666">${min}</td>`;

    const rankOpties = Object.keys(_rankings).map(n =>
      `<option value="${n}" ${n === rankNaam ? 'selected' : ''}>${_rankings[n].label || n}</option>`
    ).join('');
    const rankCell = beheer
      ? `<td><select style="font-size:12px;border:1px solid #ddd;border-radius:4px;padding:2px;" onchange="window.vakSetRank('${iso}', this.value)" ${x ? '' : 'disabled'}><option value="">—</option>${rankOpties}</select></td>`
      : `<td style="font-size:12px;color:#666">${ranking?.label || rankNaam}</td>`;

    // Rad-kolommen: V-toggle
    const radCellen = rads.map(r => {
      const v = vData[r.id] || false;
      const kanToggle = x && min !== '';
      const isEigen = r.id === eigenId;
      const magToggle = kanToggle && (beheer || isEigen);
      const titel = overschreden ? `Overschrijding: ${aantalV} van max ${maxV}` : '';

      if (magToggle) {
        return `<td style="text-align:center;cursor:pointer;" title="${titel}" onclick="window.vakToggleV('${iso}','${r.id}')">${v ? '<span style="color:#2e7d32;font-weight:700">V</span>' : '<span style="color:#ccc">·</span>'}</td>`;
      } else {
        return `<td style="text-align:center;color:${v ? '#2e7d32' : '#eee'}">${v ? 'V' : '·'}</td>`;
      }
    }).join('');

    tbody += `
      ${maandRij}
      <tr ${rijKleur}>
        <td style="font-size:12px;white-space:nowrap;padding:3px 6px;">${dagLabel(iso)}</td>
        ${xCell}
        ${minCell}
        ${rankCell}
        ${radCellen}
      </tr>`;
  });

  // Saldo totalen per rad
  const saldoCellen = rads.map(r => {
    const { vakantieV, dienstV, saldo } = berekenSaldo(r.id, jaar);
    return `<td style="text-align:center;font-size:12px;font-weight:600;padding:4px;">${saldo}<br><span style="font-weight:400;color:#666">${vakantieV}−${dienstV}</span></td>`;
  }).join('');

  const html = `
    <div class="card" style="margin-bottom:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <p style="font-size:17px;font-weight:500;margin:0;">Vakantie ${jaar}</p>
          <p class="muted" style="margin:4px 0 0;">V = vakantie · rood = te weinig bezetting · beheerder zet X + Min + Rank</p>
        </div>
        ${beheer ? `<button class="btn btn-primary" onclick="window.openRankingBeheer()">⚙ Rankings</button>` : ''}
      </div>
    </div>

    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;font-size:13px;min-width:600px;width:100%;">
        <thead>
          <tr style="background:var(--accent-color,#1565c0);color:#fff;">
            <th style="text-align:left;padding:6px 8px;position:sticky;left:0;background:var(--accent-color,#1565c0);">Datum</th>
            <th title="Vakantiedag" style="padding:4px;">X</th>
            <th title="Min bezetting" style="padding:4px;">Min</th>
            <th title="Ranking" style="padding:4px;">Rank</th>
            ${rads.map(r => `<th style="padding:4px;min-width:36px;" title="${r.achternaam}">${r.code}</th>`).join('')}
          </tr>
          <tr style="background:#e3f2fd;font-size:12px;">
            <td style="padding:3px 8px;font-weight:600;">Saldo (V − dienst)</td>
            <td></td><td></td><td></td>
            ${saldoCellen}
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>

    ${beheer ? renderRankingBeheerPanel() : ''}
  `;

  container.innerHTML = html;
}

// ─── Ranking beheer-paneel ───────────────────────────────────────────────────

function renderRankingBeheerPanel() {
  const jaar = huidigJaar();
  const rads = vasteRads();

  let lijstHtml = '';
  Object.values(_rankings).forEach(rk => {
    const volgorde = rankingVolgordeVoorJaar(rk, jaar);
    const volgordeNamen = volgorde.map((id, i) => {
      const r = rads.find(r => r.id === id);
      return `${i+1}. ${r ? r.code : id}`;
    }).join(', ');

    lijstHtml += `
      <div class="card" style="margin-bottom:8px;padding:10px 14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${rk.kleur||'#aaa'};vertical-align:middle;margin-right:6px;"></span>
            <strong>${rk.label || rk.naam}</strong>
            <span class="muted" style="margin-left:8px;font-size:12px;">anker ${rk.anker_jaar} · stap 3</span>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn" style="font-size:12px;padding:4px 10px;" onclick="window.bewerkRanking('${rk.id}')">Bewerk</button>
            <button class="btn" style="font-size:12px;padding:4px 10px;color:#c00;" onclick="window.verwijderRanking('${rk.id}')">✕</button>
          </div>
        </div>
        <div class="muted" style="margin-top:6px;font-size:12px;">
          Volgorde ${jaar}: ${volgordeNamen || '—'}
        </div>
      </div>`;
  });

  if (!lijstHtml) lijstHtml = '<p class="muted">Nog geen rankings aangemaakt.</p>';

  return `
    <div id="ranking-beheer-panel" style="display:none;margin-top:1.5rem;">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <p style="font-size:15px;font-weight:600;margin:0;">⚙ Ranking-tabellen</p>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary" onclick="window.nieuweRanking()">+ Nieuw</button>
            <button class="btn" onclick="window.sluitRankingBeheer()">Sluiten</button>
          </div>
        </div>
        <p class="muted" style="font-size:12px;margin-bottom:12px;">
          Elke ranking verschuift per jaar 3 posities (formule: <code>(pos + (jaar − anker) × 3) mod 8</code>).
        </p>
        <div id="ranking-lijst">${lijstHtml}</div>
      </div>
    </div>`;
}

// ─── window handlers ─────────────────────────────────────────────────────────

// Beheer-paneel tonen/sluiten
window.openRankingBeheer = function() {
  const panel = document.getElementById('ranking-beheer-panel');
  if (panel) panel.style.display = 'block';
};

window.sluitRankingBeheer = function() {
  const panel = document.getElementById('ranking-beheer-panel');
  if (panel) panel.style.display = 'none';
};

// X toggling (beheerder)
window.vakToggleX = async function(datum) {
  if (!isBeheerder()) return;
  const dag = state.indelingMap[datum] || {};
  const nieuweX = !(dag.vakantie_x || false);
  try {
    await setDoc(doc(db, 'indeling', datum), {
      datum,
      vakantie_x: nieuweX,
      // Bij uitschakelen ook min/rank resetten
      ...(nieuweX ? {} : { vakantie_min: null, vakantie_rank: null, vakantie_v: {} })
    }, { merge: true });
    // State updaten
    if (!state.indelingMap[datum]) state.indelingMap[datum] = { datum };
    state.indelingMap[datum].vakantie_x = nieuweX;
    if (!nieuweX) {
      state.indelingMap[datum].vakantie_min = null;
      state.indelingMap[datum].vakantie_rank = null;
      state.indelingMap[datum].vakantie_v = {};
    }
    window.appRender?.();
  } catch (e) {
    alert('Fout bij opslaan: ' + e.message);
  }
};

// Min bezetting instellen
window.vakSetMin = async function(datum, waarde) {
  if (!isBeheerder()) return;
  const num = waarde === '' ? null : Number(waarde);
  try {
    await setDoc(doc(db, 'indeling', datum), { datum, vakantie_min: num }, { merge: true });
    if (!state.indelingMap[datum]) state.indelingMap[datum] = { datum };
    state.indelingMap[datum].vakantie_min = num;
    window.appRender?.();
  } catch (e) {
    alert('Fout bij opslaan: ' + e.message);
  }
};

// Ranking instellen
window.vakSetRank = async function(datum, rankNaam) {
  if (!isBeheerder()) return;
  try {
    await setDoc(doc(db, 'indeling', datum), { datum, vakantie_rank: rankNaam || null }, { merge: true });
    if (!state.indelingMap[datum]) state.indelingMap[datum] = { datum };
    state.indelingMap[datum].vakantie_rank = rankNaam || null;
    window.appRender?.();
  } catch (e) {
    alert('Fout bij opslaan: ' + e.message);
  }
};

// V toggle voor maat of beheerder
window.vakToggleV = async function(datum, radId) {
  const dag = state.indelingMap[datum] || {};
  if (!dag.vakantie_x || dag.vakantie_min == null) return;

  const eigenId = eigenRadId();
  if (!isBeheerder() && radId !== eigenId) return;

  const huidigeV = dag.vakantie_v || {};
  const nieuwV = { ...huidigeV, [radId]: !huidigeV[radId] };
  if (!nieuwV[radId]) delete nieuwV[radId]; // Verwijder false-entries

  try {
    await setDoc(doc(db, 'indeling', datum), { datum, vakantie_v: nieuwV }, { merge: true });
    if (!state.indelingMap[datum]) state.indelingMap[datum] = { datum };
    state.indelingMap[datum].vakantie_v = nieuwV;
    window.appRender?.();
  } catch (e) {
    alert('Fout bij opslaan: ' + e.message);
  }
};

// ─── Ranking CRUD ────────────────────────────────────────────────────────────

window.nieuweRanking = function() {
  openRankingSheet(null);
};

window.bewerkRanking = function(id) {
  openRankingSheet(id);
};

window.verwijderRanking = async function(id) {
  if (!confirm('Ranking verwijderen?')) return;
  try {
    await deleteDoc(doc(db, 'vakantie_rankings', id));
    delete _rankings[id];
    window.appRender?.();
  } catch (e) {
    alert('Fout: ' + e.message);
  }
};

function openRankingSheet(id) {
  const rads = vasteRads();
  const bestaand = id ? (_rankings[id] || null) : null;

  const jaar = huidigJaar();
  const anker = bestaand?.anker_jaar || jaar;
  const kleur = bestaand?.kleur || '#4caf50';
  const label = bestaand?.label || '';
  const naam  = bestaand?.naam  || '';
  const ankerVolgorde = bestaand?.anker_volgorde || rads.map(r => r.id);

  // Drag-sorteer interface voor de 8 radiologen
  const volgordeHtml = ankerVolgorde.map((rid, i) => {
    const r = rads.find(r => r.id === rid);
    return `<div class="rank-item" draggable="true" data-rid="${rid}" data-index="${i}"
              style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#f5f5f5;border-radius:6px;margin-bottom:4px;cursor:grab;">
              <span style="color:#aaa;font-size:18px;">⠿</span>
              <span style="font-weight:600;min-width:30px;">${i+1}.</span>
              <span>${r ? `${r.code} — ${r.achternaam}` : rid}</span>
            </div>`;
  }).join('');

  const inhoud = `
    <div style="padding: 0 4px;">
      <div style="margin-bottom:12px;">
        <label class="form-label">Naam (intern ID)</label>
        <input id="rk-naam" class="form-input" value="${naam}" placeholder="bv. zomer1" ${id ? 'readonly style="background:#f5f5f5"' : ''}>
      </div>
      <div style="margin-bottom:12px;">
        <label class="form-label">Label (zichtbaar)</label>
        <input id="rk-label" class="form-input" value="${label}" placeholder="bv. Zomer 1">
      </div>
      <div style="display:flex;gap:12px;margin-bottom:12px;">
        <div style="flex:1;">
          <label class="form-label">Kleur</label>
          <input id="rk-kleur" type="color" value="${kleur}" style="width:100%;height:40px;border:none;border-radius:6px;cursor:pointer;">
        </div>
        <div style="flex:1;">
          <label class="form-label">Anker-jaar</label>
          <input id="rk-anker" type="number" class="form-input" value="${anker}" min="2020" max="2040">
        </div>
      </div>
      <div>
        <label class="form-label">Volgorde voor anker-jaar (sleep om te sorteren)</label>
        <div id="rk-volgorde" style="margin-top:6px;">${volgordeHtml}</div>
      </div>
    </div>`;

  const knoppen = `
    <button class="btn btn-primary" onclick="window.slaRankingOp('${id || ''}')">Opslaan</button>
    <button class="btn" onclick="closeSheet()">Annuleer</button>`;

  openSheet(id ? 'Ranking bewerken' : 'Nieuwe ranking', inhoud, knoppen);

  // Drag-sort activeren (na render)
  setTimeout(() => {
    const container = document.getElementById('rk-volgorde');
    if (!container) return;
    let dragSrc = null;
    container.querySelectorAll('.rank-item').forEach(el => {
      el.addEventListener('dragstart', e => { dragSrc = el; el.style.opacity = '0.4'; });
      el.addEventListener('dragend', e => { el.style.opacity = '1'; hernummerItems(); });
      el.addEventListener('dragover', e => { e.preventDefault(); });
      el.addEventListener('drop', e => {
        e.preventDefault();
        if (dragSrc !== el) container.insertBefore(dragSrc, el);
      });
    });
  }, 100);
}

function hernummerItems() {
  const items = document.querySelectorAll('#rk-volgorde .rank-item');
  items.forEach((el, i) => {
    const numSpan = el.querySelector('span:nth-child(2)');
    if (numSpan) numSpan.textContent = `${i+1}.`;
    el.dataset.index = i;
  });
}

window.slaRankingOp = async function(bestaandId) {
  const naam  = document.getElementById('rk-naam')?.value?.trim();
  const label = document.getElementById('rk-label')?.value?.trim();
  const kleur = document.getElementById('rk-kleur')?.value || '#4caf50';
  const anker = parseInt(document.getElementById('rk-anker')?.value || huidigJaar());

  if (!naam) { alert('Vul een naam in.'); return; }
  if (!label) { alert('Vul een label in.'); return; }

  // Volgorde uit DOM lezen
  const items = document.querySelectorAll('#rk-volgorde .rank-item');
  const volgorde = [...items].map(el => el.dataset.rid);

  const data = { naam, label, kleur, anker_jaar: anker, anker_volgorde: volgorde };

  try {
    const docId = bestaandId || naam;
    await setDoc(doc(db, 'vakantie_rankings', docId), data);
    _rankings[docId] = { id: docId, ...data };
    closeSheet();
    window.appRender?.();
  } catch (e) {
    alert('Fout bij opslaan: ' + e.message);
  }
};
