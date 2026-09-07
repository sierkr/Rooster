// Logboek-scherm — Beheer → Control → Logboek.
//
// v3.33.2: dit scherm rapporteert alleen. De terugdraai-knop stond hier eerst,
// maar hoort bij de import: wie zich vergist heeft staat op de Excel-tab, niet
// in het logboek. Hier staat nog wél of een import is teruggedraaid.
//
// Twee tabbladen:
//   "Wie deed wat"       — venster op de bestaande collectie audit_log, die
//                          sinds v3.28.0 door de Cloud Function auditIndeling
//                          gevuld wordt maar nergens te zien was.
//   "Exports en imports" — de nieuwe collectie export_log.
//
// Beide worden pas geladen als je het tabblad opent.

import { state } from '../state.js';
import { esc } from '../helpers.js';
import {
  laadExportLog, laadAuditLog, naamVanUid, tijdTekst, diffTekst,
} from '../logboek.js';

const _st = {
  tab: 'audit',          // 'audit' | 'export'
  jaar: '',              // roosterjaar-filter voor audit ('' = geen filter)
  persoon: '',           // uid-filter voor audit
  auditRijen: null,      // null = nog niet geladen
  exportRijen: null,
  bezig: false,
  fout: '',
};

function _vak() { return document.getElementById('view-logboek'); }

function _jaarKeuzes() {
  const nu = new Date().getFullYear();
  const jaren = [];
  for (let j = nu - 2; j <= nu + 3; j++) jaren.push(j);
  return jaren;
}

// ---- Tabblad "Wie deed wat" -------------------------------------------------

function _auditHtml() {
  const rijen = _st.auditRijen;
  if (rijen === null) return '<div class="empty-state">Nog niet geladen.</div>';
  if (!rijen.length) {
    return `
      <div class="empty-state">
        Geen regels gevonden${_st.jaar ? ` voor ${esc(_st.jaar)}` : ''}.
        <div class="muted" style="font-size:12px; margin-top:8px;">
          Let op: dit logboek wordt alleen op de live-omgeving gevuld en bestaat
          pas vanaf versie 3.28.0. In de testomgeving blijft het altijd leeg.
        </div>
      </div>`;
  }

  // Samenvatting per persoon
  const perPersoon = {};
  rijen.forEach(r => {
    const n = naamVanUid(r.auth_uid);
    perPersoon[n] = (perPersoon[n] || 0) + 1;
  });
  const samenvatting = Object.entries(perPersoon)
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `<span style="display:inline-block; margin:0 10px 4px 0;"><b>${esc(n)}</b> ${c}</span>`)
    .join('');

  const gefilterd = _st.persoon
    ? rijen.filter(r => r.auth_uid === _st.persoon)
    : rijen;

  const lijst = gefilterd.map(r => {
    const wat = r.aangemaakt ? 'dag aangemaakt'
              : r.verwijderd ? 'dag verwijderd'
              : diffTekst(r.velden);
    return `
      <div style="padding:6px 8px; border-bottom:1px solid rgba(0,0,0,0.06); font-size:12px;">
        <div><b>${esc(r.datum || '')}</b> · ${esc(naamVanUid(r.auth_uid))}</div>
        <div class="muted" style="font-size:11px;">${esc(tijdTekst(r.tijdstip || r.event_tijd))}</div>
        <div style="margin-top:2px;">${esc(wat || '—')}</div>
      </div>`;
  }).join('');

  return `
    <div style="background:#eef4ff; color:#1a3a6b; padding:8px 10px; border-radius:6px; font-size:12px; margin-bottom:8px;">
      <b>${gefilterd.length}</b> wijziging${gefilterd.length === 1 ? '' : 'en'} getoond${rijen.length >= 300 ? ' (maximaal 300 — verfijn het filter voor oudere regels)' : ''}.
      <div style="margin-top:6px;">${samenvatting}</div>
    </div>
    <div style="max-height:420px; overflow:auto; border:1px solid rgba(0,0,0,0.08); border-radius:6px;">
      ${lijst}
    </div>`;
}

// ---- Tabblad "Exports en imports" -------------------------------------------

function _exportHtml() {
  const rijen = _st.exportRijen;
  if (rijen === null) return '<div class="empty-state">Nog niet geladen.</div>';
  if (!rijen.length) {
    return `
      <div class="empty-state">
        Nog geen exports of imports vastgelegd.
        <div class="muted" style="font-size:12px; margin-top:8px;">
          Dit logboek begint bij versie 3.33.0; wat daarvóór is geëxporteerd of
          geïmporteerd, is niet vastgelegd.
        </div>
      </div>`;
  }

  // v3.33.2: welke imports zijn teruggedraaid? Dat staat als eigen regel in
  // ditzelfde logboek, dus dat kost geen extra leesactie.
  const teruggedraaideIds = new Set(
    rijen.filter(x => x.soort === 'terugdraaien' && x.snapshot_id).map(x => x.snapshot_id)
  );

  const lijst = rijen.map(r => {
    const isImport = r.soort === 'import';
    const kleur = r.soort === 'terugdraaien' ? '#6b1414' : (isImport ? '#6b3a00' : '#1a4a2a');
    const achtergrond = r.soort === 'terugdraaien' ? '#fbe9e9' : (isImport ? '#fff4e0' : '#eefaf2');
    const perKolom = Object.entries(r.per_kolom || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${esc(k)} ${v}`)
      .join(' · ');
    const leeg = (r.gevulde_cellen || 0) === 0;
    const isTerug = r.soort === 'terugdraaien';
    return `
      <div style="padding:8px; border-bottom:1px solid rgba(0,0,0,0.06); font-size:12px;">
        <div>
          <span style="background:${achtergrond}; color:${kleur}; padding:1px 6px; border-radius:4px; font-weight:600;">
            ${r.soort === 'terugdraaien' ? 'TERUGGEDRAAID' : (isImport ? 'IMPORT' : 'EXPORT')}
          </span>
          <b style="margin-left:6px;">${esc(r.jaar || '')}</b>
          <span class="muted"> · ${esc(tijdTekst(r.wanneer || r.wanneer_lokaal))}</span>
        </div>
        <div class="muted" style="font-size:11px; margin-top:2px;">
          ${esc(r.naam || r.email || naamVanUid(r.uid))} · ${esc(r.bestandsnaam || '')}
        </div>
        <div style="margin-top:3px;">
          ${r.dagen || 0} dagen ·
          <b${leeg ? ' style="color:#9c0006;"' : ''}>${r.gevulde_cellen || 0} gevulde cellen</b>
          op ${r.gevulde_dagen || 0} dagen${isImport ? ` · ${r.gewijzigde_cellen || 0} daadwerkelijk gewijzigd` : ''}
          ${leeg ? ' — <b style="color:#9c0006;">leeg bestand</b>' : ''}
        </div>
        ${perKolom ? `<div class="muted" style="font-size:11px; margin-top:2px;">per stoel: ${perKolom}</div>` : ''}
        ${isImport && r.jaarfilter ? `<div class="muted" style="font-size:11px;">jaarfilter stond op ${esc(r.jaarfilter)}</div>` : ''}
        ${isImport && teruggedraaideIds.has(r.snapshot_id) ? `
          <div style="margin-top:4px; color:#6b1414;"><b>Teruggedraaid.</b></div>
        ` : ''}
        ${isTerug ? `<div style="margin-top:3px;">${r.hersteld || 0} dagen hersteld, ${r.verwijderd || 0} verwijderd.</div>` : ''}
      </div>`;
  }).join('');

  return `
    <div style="max-height:460px; overflow:auto; border:1px solid rgba(0,0,0,0.08); border-radius:6px;">
      ${lijst}
    </div>`;
}

// ---- Hoofdrender ------------------------------------------------------------

export function renderLogboek() {
  const vak = _vak();
  if (!vak) return;

  const personen = (state.gebruikers || [])
    .map(g => ({ uid: g.id, naam: naamVanUid(g.id) }))
    .sort((a, b) => a.naam.localeCompare(b.naam));

  const seg = (id, label) => `
    <button class="btn ${_st.tab === id ? 'btn-primary' : ''}" style="flex:1;"
      onclick="window.logboekTab('${id}')">${label}</button>`;

  vak.innerHTML = `
    <div class="card">
      <p style="font-size:15px; font-weight:500; margin:0 0 4px;">Logboek</p>
      <p class="muted" style="margin:0 0 10px; font-size:12px;">
        Wie wanneer aan het rooster werkte, en wat er in geëxporteerde of
        geïmporteerde Excel-bestanden zat.
      </p>
      <div style="display:flex; gap:6px; margin-bottom:10px;">
        ${seg('audit', 'Wie deed wat')}
        ${seg('export', 'Exports en imports')}
      </div>

      ${_st.tab === 'audit' ? `
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:8px;">
          <label class="muted" style="font-size:12px;">Roosterjaar:</label>
          <select class="select" style="width:auto; padding:5px 8px; font-size:13px;"
            onchange="window.logboekJaar(this.value)">
            <option value="" ${!_st.jaar ? 'selected' : ''}>(nieuwste, alle jaren)</option>
            ${_jaarKeuzes().map(j => `<option value="${j}" ${_st.jaar === String(j) ? 'selected' : ''}>${j}</option>`).join('')}
          </select>
          <label class="muted" style="font-size:12px;">Persoon:</label>
          <select class="select" style="width:auto; padding:5px 8px; font-size:13px;"
            onchange="window.logboekPersoon(this.value)">
            <option value="">(iedereen)</option>
            ${personen.map(p => `<option value="${esc(p.uid)}" ${_st.persoon === p.uid ? 'selected' : ''}>${esc(p.naam)}</option>`).join('')}
          </select>
          <button class="btn" style="padding:5px 12px; font-size:13px;"
            ${_st.bezig ? 'disabled' : ''} onclick="window.logboekLaad()">
            ${_st.bezig ? 'Bezig…' : 'Ophalen'}
          </button>
        </div>
      ` : `
        <div style="margin-bottom:8px;">
          <button class="btn" style="padding:5px 12px; font-size:13px;"
            ${_st.bezig ? 'disabled' : ''} onclick="window.logboekLaad()">
            ${_st.bezig ? 'Bezig…' : 'Ophalen'}
          </button>
        </div>
      `}

      ${_st.fout ? `
        <div style="background:#fbe9e9; color:#6b1414; padding:8px 10px; border-radius:6px; font-size:12px; margin-bottom:8px;">
          ${esc(_st.fout)}
        </div>` : ''}

      ${_st.tab === 'audit' ? _auditHtml() : _exportHtml()}

      <p class="muted" style="font-size:11px; margin:10px 0 0;">
        "Wie deed wat" wordt door de server geschreven en is niet te wijzigen.
        "Exports en imports" wordt door de app zelf geschreven: compleet, maar
        niet onvervalsbaar. Alleen beheerders kunnen dit logboek lezen.
      </p>
    </div>`;
}

// ---- Handlers ---------------------------------------------------------------

window.logboekTab = (id) => { _st.tab = id; _st.fout = ''; renderLogboek(); };
window.logboekJaar = (j) => { _st.jaar = j || ''; };
window.logboekPersoon = (uid) => { _st.persoon = uid || ''; renderLogboek(); };

window.logboekLaad = async () => {
  _st.bezig = true; _st.fout = ''; renderLogboek();
  try {
    if (_st.tab === 'audit') {
      const bereik = _st.jaar
        ? { vanaf: `${_st.jaar}-01-01`, tot: `${_st.jaar}-12-31` }
        : {};
      _st.auditRijen = await laadAuditLog(bereik);
    } else {
      _st.exportRijen = await laadExportLog();
    }
  } catch (e) {
    console.error('logboekLaad', e);
    _st.fout = 'Ophalen mislukt: ' + (e.message || e);
  } finally {
    _st.bezig = false;
    renderLogboek();
  }
};

