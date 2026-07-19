// Gebruikers-view: gebruikers beheren, parttime, waarnemers, Excel-import.
import { collection, doc, getDocs, query, where, setDoc, updateDoc, writeBatch, deleteField, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db, fnGebruikerAanmaken, fnGebruikerVerwijderen, fnGebruikerResetWachtwoord, IS_TEST_DB } from '../firebase-init.js';
import { state, SLOTS, VASTE_RAD_IDS, VASTE_BEHEERDER_EMAIL } from '../state.js';
import {
  vasteRads, vasteRadsOpDatum, actieveInvallers, radiologenMap, parttimeFactor, defaultPermissies,
  magGebruikersBeheren, magRegelsBeheren, genereerWachtwoord, bezettingOpDatum, vandaagIso, plusDagen, formatDatum,
  alleVasteStoelIds, isVasteStoel, nieuwPersoonId, laatsteEntry, clipHistorieVoorWissel,
  assertBezettingGeldig, controleerAlleBezettingen,
} from '../helpers.js';
import { renderRegView } from './regels.js';
import { STANDAARD_WACHTWOORD } from '../helpers.js';
import { openSheet, closeSheet } from '../sheets.js';
import { IMPORT_SHEET, actImportFile, actImportSchrijven, actImportAnnuleren, actZetImportJaar } from '../import.js';
import { actExportJaar } from '../export.js';
import { maakClientBackup, herstelClientBackup } from '../backup-client.js';
import {
  laadBezettingMutaties, snapshotStoelen, registreerMutatie, renderRecenteMutaties,
  impactVanaf, impactTekst,
} from '../bezetting-mutaties.js';

export async function laadGebruikers() {
  if (!magGebruikersBeheren()) return;
  const snap = await getDocs(collection(db, 'gebruikers'));
  state.gebruikers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Onthoudt de laatst gekozen (sub-)tab binnen Beheer, zodat een her-render
// (bv. na het kiezen van een importbestand) niet terugspringt naar de eerste tab.
let _behTab1 = null;
const _behTab2 = { geb: 'rad', ctl: 'regels' };

// Bepaalt de bezetting die in het beheer-raster van een W-slot getoond moet
// worden: de lopende bezetter van vandaag, of — als het slot vandaag leeg is —
// de eerstvolgende geplande bezetter (bv. een waarnemer die woensdag begint).
// Retourneert { code, achternaam, van, tot, persoon_id, toekomstig } of null als
// er geen lopende én geen geplande bezetter is.
function huidigeOfGeplandeBezetting(slotId) {
  const vandaag = vandaagIso();
  const nu = bezettingOpDatum(slotId, vandaag);
  if (nu) return { ...nu, toekomstig: false };
  const stoel = state.radiologen.find(r => r.id === slotId);
  const hist = Array.isArray(stoel?.bezetting_historie) ? stoel.bezetting_historie : [];
  const toekomst = hist
    .filter(e => e.van && e.van > vandaag && (!e.tot || e.tot >= e.van))
    .sort((a, b) => (a.van < b.van ? -1 : 1))[0];
  if (!toekomst) return null;
  return {
    slotId,
    voornaam: toekomst.voornaam || '',
    achternaam: toekomst.achternaam || '',
    code: toekomst.code || slotId,
    vakantierecht: typeof toekomst.vakantierecht === 'number' ? toekomst.vakantierecht : 40,
    parttime_factor: typeof toekomst.parttime_factor === 'number' ? toekomst.parttime_factor : 1,
    in_dienst: toekomst.in_dienst || null,
    van: toekomst.van || null,
    tot: toekomst.tot || null,
    persoon_id: toekomst.persoon_id || null,
    toekomstig: true,
  };
}

export async function renderGebView() {
  const container = document.getElementById('view-geb');
  const canGeb = magGebruikersBeheren();
  const canReg = magRegelsBeheren() || canGeb;
  if (!canGeb && !canReg) { container.innerHTML = '<div class="empty-state">Geen toegang</div>'; return; }

  if (canGeb) await laadGebruikers();
  if (canGeb) await laadBezettingMutaties();
  const rads = radiologenMap();

  let htmlBezetting = '';
  let htmlOverig = '';

  // ---- App gebruikers: accounts gesplitst per soort medewerker -------------
  // Categorie bepaalt de onder-tab; alleen radiologen kunnen aan een stoel
  // gekoppeld worden. Een radioloog met beheerrechten krijgt de dubbele titel
  // "Radioloog, beheerder". Onderliggende rol/permissies blijven ongewijzigd.
  const accountRij = (g) => {
    const rad = g.radioloog_id ? rads[g.radioloog_id] : null;
    const eff = g.permissies || defaultPermissies(g.rol);
    const isAdmin = g.rol === 'beheerder' || eff.mag_gebruikers === true;
    let cat;
    if (g.rol === 'technician' || g.rol === 'lezer') cat = 'tech';
    else if (g.rol === 'secretariaat') cat = 'sec';
    else cat = 'rad';
    let titel;
    if (cat === 'tech') titel = 'Technicus';
    else if (cat === 'sec') titel = 'Secretariaat';
    else if (g.rol === 'beheerder') titel = g.radioloog_id ? 'Radioloog, beheerder' : 'Beheerder';
    else titel = isAdmin ? 'Radioloog, beheerder' : 'Radioloog';
    const html = `
      <div class="gebruiker-item">
        <div class="gebruiker-hoofd">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 500; overflow: hidden; text-overflow: ellipsis;">${g.naam || g.email}</div>
            ${rad ? `<div class="muted">${rad.code} · ${rad.achternaam}</div>` : ''}
          </div>
          <span class="rol-badge rol-${g.rol}">${titel}</span>
        </div>
        <div style="margin-top: 10px; display: flex; gap: 6px;">
          <button class="btn" style="flex: 1; font-size: 12px; padding: 6px;" onclick="window.gebruikerBewerken('${g.id}')">Rol wijzigen</button>
          <button class="btn" style="font-size: 12px; padding: 6px 10px;" onclick="window.gebruikerWachtwoordReset('${g.id}', '${g.naam || g.email}')">🔑</button>
          ${(g.id !== state.user.uid && (g.email||'').toLowerCase() !== VASTE_BEHEERDER_EMAIL) ? `<button class="btn" style="font-size: 12px; padding: 6px 10px; color: #501313;" onclick="window.gebruikerVerwijderen('${g.id}', '${g.naam || g.email}')">🗑</button>` : ''}
        </div>
      </div>
    `;
    return { cat, html };
  };

  let radRows = '', techRows = '', secRows = '';
  if (canGeb) {
    state.gebruikers.forEach(g => {
      const r = accountRij(g);
      if (r.cat === 'tech') techRows += r.html;
      else if (r.cat === 'sec') secRows += r.html;
      else radRows += r.html;
    });
  }

  // Vaste radiologen — parttime-percentage en vakantierecht
  htmlBezetting += `
    <div style="margin-top: 1.5rem;">
      <div class="summary-label" style="margin-bottom: 6px;">Vaste radiologen — parttime &amp; vakantierecht</div>
      <div class="card">
        <p class="muted" style="margin: 0 0 10px;">Parttime: percentage van fulltime (default 100%). Vakantierecht: aantal V-dagen per jaar (default 40). Tik <b>Wissel</b> om een NIEUWE persoon (zonder eigen indeling) op deze stoel te zetten vanaf een datum. Nieuwe radioloog, nog geen stoel of waarnemer-plek? Gebruik <b>+ Nieuwe stoel aanmaken</b> hieronder. Bestaande waarnemer vast in dienst nemen mét behoud van diens indeling? Gebruik <b>→ Vast</b> bij die waarnemer.</p>
        <div style="display: grid; grid-template-columns: 50px 1fr 120px 56px 56px 120px; gap: 6px; padding-bottom: 6px; border-bottom: 1px solid rgba(0,0,0,0.1); font-size: 11px; font-weight: 600; color: #5f5e5a;">
          <div>Code</div>
          <div>Naam</div>
          <div style="text-align: center;">In dienst</div>
          <div style="text-align: center;">Parttime</div>
          <div style="text-align: center;">Vakantie</div>
          <div></div>
        </div>
        ${vasteRads().map(r => {
          const pf = parttimeFactor(r.id);
          const pct = Math.round(pf * 100);
          const vrecht = (typeof r.vakantierecht === 'number') ? r.vakantierecht : 40;
          const stoel = state.radiologen.find(x => x.id === r.id);
          const hist = Array.isArray(stoel?.bezetting_historie) ? stoel.bezetting_historie : [];
          const open = hist.find(e => !e.tot);
          // In-dienst (anciënniteit) bepaalt de kolomvolgorde (oudste = links).
          // Placeholder behoudt de huidige vaste volgorde tot je echte data invult.
          const idx = VASTE_RAD_IDS.indexOf(r.id);
          const indienstPlaceholder = idx < 0 ? '9999-01-01' : `${2000 + idx}-01-01`;
          const indienstWaarde = open?.in_dienst || stoel?.in_dienst || indienstPlaceholder;
          // Gepland vertrek: de bezetter van vandaag heeft een einddatum (tot) in
          // de toekomst. De stoel is dan nog zichtbaar tot die datum.
          const geplandVertrek = r.tot ? plusDagen(r.tot, 1) : null;
          // Opvolging: staat er per de dag ná de einddatum al een opvolger klaar?
          // Dan is het geen "vertrek" maar een overname — niet als vertrek tonen.
          const opvolger = geplandVertrek ? hist.find(e => e.van === geplandVertrek) : null;
          return `
            <div style="display: grid; grid-template-columns: 50px 1fr 120px 56px 56px 120px; gap: 6px; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.06);">
              <div style="font-weight: 500;">${r.code}</div>
              <div style="min-width: 0;">
                <div class="muted" style="font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${r.achternaam || ''}</div>
                ${geplandVertrek ? (opvolger
                  ? `<div style="font-size: 10px; color: #9c5700;">opgevolgd door ${(opvolger.code || '').replace(/"/g, '&quot;')} per ${formatDatum(geplandVertrek, 'kort')}</div>`
                  : `<div style="font-size: 10px; color: #b3261e;">vertrekt per ${formatDatum(geplandVertrek, 'kort')}</div>`) : ''}
              </div>
              <div>
                <input type="date" class="input" id="id_${r.id}" value="${indienstWaarde}" oninput="window.gebMarkDirty('vast')" style="padding: 6px 4px; font-size: 12px; width: 100%;">
              </div>
              <div style="display: flex; align-items: center; gap: 2px;">
                <input type="number" class="input" id="pf_${r.id}" value="${pct}" min="10" max="100" step="1" oninput="window.gebMarkDirty('vast')" style="padding: 6px 4px; font-size: 13px; text-align: right;">
                <span class="muted" style="font-size: 11px;">%</span>
              </div>
              <div>
                <input type="number" class="input" id="vr_${r.id}" value="${vrecht}" min="0" max="100" step="1" oninput="window.gebMarkDirty('vast')" style="padding: 6px 4px; font-size: 13px; text-align: right; width: 100%;">
              </div>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                <button class="btn" style="font-size: 11px; padding: 6px 4px; flex: 1;" onclick="window.openWisselSheet('${r.id}')">Wissel</button>
                <button class="btn" style="font-size: 11px; padding: 6px 4px; flex: 1;" onclick="window.toonStoelTijdlijn('${r.id}')" title="Tijdlijn van deze stoel">Tijdlijn</button>
                ${geplandVertrek
                  ? (opvolger
                      ? ''
                      : `<button class="btn" style="font-size: 11px; padding: 6px 4px; flex: 1;" onclick="window.vertrekIntrekken('${r.id}')" title="Gepland vertrek intrekken">Intrekken</button>`)
                  : `<button class="btn" style="font-size: 11px; padding: 6px 4px; flex: 1;" onclick="window.openVertrekSheet('${r.id}')" title="Stoel laten vertrekken per datum">Vertrek</button>`}
              </div>
            </div>
          `;
        }).join('')}
        <button id="btnOpslaanVast" class="btn" disabled style="width: 100%; margin-top: 10px; opacity: 0.5; cursor: not-allowed;" onclick="window.opslaanParttime()">Opslaan</button>
        <button class="btn" style="width: 100%; margin-top: 6px; font-size: 12px;" onclick="window.openNieuweStoelSheet()">➕ Nieuwe stoel aanmaken</button>
        <button class="btn" style="width: 100%; margin-top: 6px; font-size: 11px; opacity: 0.85;" onclick="window.initialiseerPersoonIds()" title="Eenmalig: ken persoon-id's toe aan de huidige bezetters">Persoon-id's toekennen</button>
        <button class="btn" style="width: 100%; margin-top: 6px; font-size: 11px; opacity: 0.85;" onclick="window.controleerBezetting()" title="Controleer alle stoel-tijdlijnen op overlap of dubbele lopende periodes">🔎 Controleer bezetting</button>
      </div>
    </div>
  `;

  // Vertrokken stoelen — stoelen met historie maar zonder actieve bezetter
  // vandaag (vertrekdatum al gepasseerd). Herstellen zet de bezetting weer open.
  const vertrokken = alleVasteStoelIds().map(id => {
    const st = state.radiologen.find(r => r.id === id);
    if (!st || bezettingOpDatum(id, vandaagIso())) return null;
    const h = Array.isArray(st.bezetting_historie) ? st.bezetting_historie : [];
    if (h.length === 0) return null;
    const e = laatsteEntry(h);
    if (!e || !e.tot) return null;
    return { id, code: e.code || id, achternaam: e.achternaam || '', tot: e.tot };
  }).filter(Boolean);

  if (vertrokken.length > 0) {
    htmlBezetting += `
      <div style="margin-top: 1.5rem;">
        <div class="summary-label" style="margin-bottom: 6px;">Vertrokken stoelen</div>
        <div class="card">
          <p class="muted" style="margin: 0 0 10px;">De bezetter is vertrokken en de kolom is verdwenen. <b>Herstellen</b> trekt het vertrek in: de stoel wordt weer doorlopend actief en de kolom komt terug.</p>
          ${vertrokken.map(v => `
            <div style="display: grid; grid-template-columns: 50px 1fr 110px; gap: 6px; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.06);">
              <div style="font-weight: 500;">${v.code}</div>
              <div class="muted" style="font-size: 13px;">${v.achternaam} <span style="font-size: 11px;">· weg sinds ${formatDatum(plusDagen(v.tot, 1), 'kort')}</span></div>
              <button class="btn" style="font-size: 11px; padding: 6px 4px;" onclick="window.vertrekIntrekken('${v.id}')">Herstellen</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Waarnemers-sectie
  htmlBezetting += `
    <div style="margin-top: 1.5rem;">
      <div class="summary-label" style="margin-bottom: 6px;">Waarnemers (W-slots)</div>
      <div class="card">
        <p class="muted" style="margin: 0 0 10px;">Het schuifje staat <b>aan</b> zolang er een lopende óf geplande waarnemer op dit W-slot zit. Tik het schuifje om een waarnemer te <b>activeren</b> (met startdatum) of te laten <b>stoppen</b> (met einddatum) — jij bepaalt de datum. <b>Wissel</b> zet een NIEUWE waarnemer op dit W-slot vanaf een datum. <b>→ Vast</b> maakt de huidige waarnemer per datum de bezetter van een vaste stoel, mét behoud van diens indeling, wensen en diensten.</p>
        ${SLOTS.map(slotId => {
          // Weergave via de werkelijke bezetting: de lopende bezetter van vandaag,
          // en anders de eerstvolgende geplande bezetter (bv. "begint woensdag").
          // Zo staat het schuifje aan zodra er een waarnemer lopend óf gepland is —
          // ook als de startdatum in de toekomst ligt of een →Vast een einddatum
          // in de toekomst heeft. De ruwe top-level actief-vlag wordt hiervoor
          // NIET meer gebruikt (die kon "uit" staan terwijl er nog een waarnemer was).
          const bez = huidigeOfGeplandeBezetting(slotId);
          const code = bez?.code || '';
          const naam = bez?.achternaam || '';
          const isActief = !!bez;
          const isLeeg = !bez;
          const datumInfo = bez
            ? (bez.toekomstig
                ? ` <span class="muted" style="font-size:11px;">(vanaf ${formatDatum(bez.van, 'kort')})</span>`
                : (bez.tot ? ` <span class="muted" style="font-size:11px;">(t/m ${formatDatum(bez.tot, 'kort')})</span>` : ''))
            : '';
          return `
            <div style="display: grid; grid-template-columns: 32px 1fr 1fr 38px 60px 60px; gap: 6px; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.06);">
              <div style="font-weight: 500; color: #5f5e5a;">${slotId}${datumInfo}</div>
              <input type="text" class="input" id="inv_code_${slotId}" placeholder="Code" maxlength="4" value="${code.replace(/"/g,'&quot;')}" oninput="window.gebMarkDirty('wnr')" style="padding: 6px 8px; font-size: 13px;">
              <input type="text" class="input" id="inv_naam_${slotId}" placeholder="Achternaam" value="${naam.replace(/"/g,'&quot;')}" oninput="window.gebMarkDirty('wnr')" style="padding: 6px 8px; font-size: 13px;">
              <span class="toggle-switch ${isActief ? 'aan' : ''}" id="inv_act_${slotId}" onclick="window.wnrToggle('${slotId}')" title="${isActief ? 'Waarnemer laten stoppen per datum' : 'Waarnemer activeren per datum'}"></span>
              <button class="btn" style="font-size: 11px; padding: 6px 4px;" onclick="window.openWisselSheet('${slotId}')">Wissel</button>
              <button class="btn" style="font-size: 11px; padding: 6px 4px; ${isLeeg ? 'opacity:0.4; cursor:not-allowed;' : ''}" ${isLeeg ? 'disabled' : ''} onclick="window.openMaakVastSheet('${slotId}')" title="Maak vast in een vaste-stoel">→ Vast</button>
            </div>
          `;
        }).join('')}
        <button id="btnOpslaanWnr" class="btn" disabled style="width: 100%; margin-top: 10px; opacity: 0.5; cursor: not-allowed;" onclick="window.opslaanInvallers()">Waarnemers opslaan</button>
      </div>
    </div>
  `;

  htmlBezetting += renderRecenteMutaties();

  // Excel-import sectie
  const p = state.importPreview;
  const bezig = state.importBezig;
  htmlOverig += `
    <div style="margin-top: 1.5rem;">
      <div class="summary-label" style="margin-bottom: 6px;">Excel-import</div>
      <div class="card">
        <p class="muted" style="margin: 0 0 10px;">Lees een <code>.xlsm</code>/<code>.xlsx</code>-bestand en zet de inhoud van het sheet '${IMPORT_SHEET}' over naar Firestore. <b>Excel = waarheid</b> — bestaande dagen in Firestore worden vervangen.</p>
        ${!p ? `
          <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
            <label class="muted" style="font-size: 12px;">Filter jaar:</label>
            <select class="select" id="impJaar" onchange="window.actZetImportJaar(this.value)" style="width: auto; padding: 6px 8px; font-size: 13px;">
              <option value="" ${!state.importJaar?'selected':''}>(alle jaren)</option>
              ${[2024,2025,2026,2027,2028,2029,2030].map(j => `<option value="${j}" ${state.importJaar==String(j)?'selected':''}>${j}</option>`).join('')}
            </select>
          </div>
          <input type="file" accept=".xlsx,.xlsm,.xls" id="impFile" onchange="window.actImportFile(this)" ${bezig?'disabled':''} style="font-size: 13px;">
          ${bezig ? '<div style="margin-top: 10px; display: flex; align-items: center; gap: 8px;"><span class="loader"></span><span class="muted">Bezig met inlezen…</span></div>' : ''}
        ` : `
          <div class="form-info" style="margin-bottom: 10px; font-size: 12px;">
            <b>${p.bestandnaam}</b><br>
            ${p.dagen.length} dagen · ${p.celOpmsAantal} cel-opmerkingen · ${p.dagOpmsAantal} dag-opmerkingen<br>
            ${p.dienstAantal} dienst-toewijzingen · ${p.besprAantal} besprekingen · ${p.intervAantal} interventies
          </div>
          ${p.totaalGewijzigd > 0 ? `
            <div style="background: #eef4ff; color: #1a3a6b; padding: 8px 10px; border-radius: 6px; font-size: 12px; margin-bottom: 8px;">
              📝 <b>${p.totaalGewijzigd} toewijzing${p.totaalGewijzigd === 1 ? '' : 'en'}</b> gewijzigd t.o.v. huidige Firestore-data
            </div>
          ` : `
            <div style="background: #eefaf2; color: #1a4a2a; padding: 8px 10px; border-radius: 6px; font-size: 12px; margin-bottom: 8px;">
              ✓ Geen wijzigingen t.o.v. huidige Firestore-data
            </div>
          `}
          ${(p.verschillen && p.verschillen.length) ? `
            <details style="margin-bottom: 8px;">
              <summary class="muted" style="cursor: pointer; font-size: 12px;">Toon verschillen (${p.totaalGewijzigd})</summary>
              <div style="font-size: 11px; max-height: 220px; overflow: auto; margin-top: 6px; border: 1px solid rgba(0,0,0,0.08); border-radius: 4px;">
                ${p.verschillen.map(v => `<div style="padding: 3px 8px; border-bottom: 1px solid rgba(0,0,0,0.05);">${v.datum} · <b>${String(v.stoel).replace(/</g,'&lt;')}</b>: ${JSON.stringify(v.oud).replace(/</g,'&lt;')} → ${JSON.stringify(v.nieuw).replace(/</g,'&lt;')}</div>`).join('')}
                ${p.totaalGewijzigd > p.verschillen.length ? `<div class="muted" style="padding: 3px 8px;">… en ${p.totaalGewijzigd - p.verschillen.length} meer</div>` : ''}
              </div>
            </details>
          ` : ''}
          ${p.nabijeCellen > 0 ? `
            <div style="background: #fff4e0; color: #6b3a00; padding: 8px 10px; border-radius: 6px; font-size: 12px; margin-bottom: 8px; border-left: 3px solid #f0a020;">
              ⚠ <b>${p.nabijeCellen} toewijzing${p.nabijeCellen === 1 ? '' : 'en'}</b> gewijzigd binnen 30 dagen
              (${p.nabijeDagen} dag${p.nabijeDagen === 1 ? '' : 'en'}:
              ${p.nabijeDagsList.slice(0, 5).map(d => d.slice(5)).join(', ')}${p.nabijeDagen > 5 ? ' …' : ''}).
              Betrokken radiologen krijgen een notificatie.
            </div>
          ` : ''}
          ${p.waarschuwingen.length ? `
            <div style="background: #faeeda; color: #412402; padding: 8px 10px; border-radius: 6px; font-size: 12px; margin-bottom: 10px;">
              <b>Waarschuwingen (${p.waarschuwingenTotaal}):</b><br>
              ${p.waarschuwingen.map(w => `• ${w}`).join('<br>')}
              ${p.waarschuwingenTotaal > p.waarschuwingen.length ? `<br>… en ${p.waarschuwingenTotaal - p.waarschuwingen.length} meer` : ''}
            </div>
          ` : ''}
          ${(p.regelBlokkadesTotaal || 0) > 0 ? `
            <div style="background: #fbe9e9; color: #6b1414; padding: 8px 10px; border-radius: 6px; font-size: 12px; margin-bottom: 10px; border-left: 3px solid #c0392b;">
              <b>⛔ Blokkerende regelconflicten (${p.regelBlokkadesTotaal}):</b><br>
              ${p.regelBlokkades.map(c => `• ${c.datum}${c.radId ? ' · ' + String(c.radId).replace(/</g,'&lt;') : ''}: ${String(c.bericht || '').replace(/</g,'&lt;')}`).join('<br>')}
              ${p.regelBlokkadesTotaal > p.regelBlokkades.length ? `<br>… en ${p.regelBlokkadesTotaal - p.regelBlokkades.length} meer` : ''}
            </div>
          ` : ''}
          ${(p.regelWaarschuwingenTotaal || 0) > 0 ? `
            <details style="margin-bottom: 10px;">
              <summary class="muted" style="cursor: pointer; font-size: 12px;">Regel-waarschuwingen (${p.regelWaarschuwingenTotaal})</summary>
              <div style="font-size: 11px; max-height: 180px; overflow: auto; margin-top: 6px; border: 1px solid rgba(0,0,0,0.08); border-radius: 4px;">
                ${p.regelWaarschuwingen.map(c => `<div style="padding: 3px 8px; border-bottom: 1px solid rgba(0,0,0,0.05);">${c.datum}${c.radId ? ' · <b>' + String(c.radId).replace(/</g,'&lt;') + '</b>' : ''}: ${String(c.bericht || '').replace(/</g,'&lt;')}</div>`).join('')}
                ${p.regelWaarschuwingenTotaal > p.regelWaarschuwingen.length ? `<div class="muted" style="padding: 3px 8px;">… en ${p.regelWaarschuwingenTotaal - p.regelWaarschuwingen.length} meer</div>` : ''}
              </div>
            </details>
          ` : ''}
          <details style="margin-bottom: 10px;">
            <summary class="muted" style="cursor: pointer; font-size: 12px;">Voorbeeld eerste 3 dagen</summary>
            <pre style="font-size: 10px; overflow-x: auto; background: rgba(0,0,0,0.03); padding: 8px; border-radius: 4px; margin-top: 6px;">${(p.dagen.slice(0, 3).map(d => JSON.stringify(d, null, 2)).join('\n\n')).replace(/</g,'&lt;')}</pre>
          </details>
          <div style="display: flex; gap: 8px;">
            <button class="btn" style="flex: 1;" ${bezig?'disabled':''} onclick="window.actImportAnnuleren()">Annuleren</button>
            <button class="btn btn-primary" style="flex: 1;" ${bezig?'disabled':''} onclick="window.actImportSchrijven()">${bezig ? 'Schrijven…' : 'Importeer (vervangt Firestore)'}</button>
          </div>
        `}
      </div>
    </div>
  `;

  // Excel-export sectie
  htmlOverig += `
    <div style="margin-top: 1rem;">
      <div class="summary-label" style="margin-bottom: 6px;">Excel-export</div>
      <div class="card">
        <p class="muted" style="margin: 0 0 10px;">Exporteer de Firestore-indeling van een jaar naar een <code>.xlsx</code> in hetzelfde formaat als de import.</p>
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <select class="select" id="expJaar" style="width: auto; padding: 6px 8px; font-size: 13px;">
            ${[2024,2025,2026,2027,2028,2029,2030].map(j => `<option value="${j}" ${j===new Date().getFullYear()?'selected':''}>${j}</option>`).join('')}
          </select>
          <input type="text" id="expBestandsnaam" class="input" placeholder="Bestandsnaam (optioneel)"
            style="width: 220px; padding: 6px 8px; font-size: 13px;"
            value="${(localStorage.getItem('rooster_export_naam') || '')}"
            oninput="localStorage.setItem('rooster_export_naam', this.value.trim())" />
          <button class="btn" onclick="window.actExportJaar(document.getElementById('expJaar').value, document.getElementById('expBestandsnaam').value.trim())">⬇ Exporteer</button>
        </div>
        <p class="muted" style="margin: 6px 0 0; font-size: 12px;">Laat leeg voor de standaardnaam (<code>Indeling_[jaar].xlsx</code>).</p>
      </div>
    </div>
  `;

  // Database-backup sectie
  if (magGebruikersBeheren()) {
    const _lb     = state.instellingen?.laatste_backup;
    const _dagOud = _lb ? Math.floor((Date.now() - new Date(_lb).getTime()) / 86400000) : null;
    const _nooit  = _dagOud === null;
    const _teOud  = _dagOud !== null && _dagOud > 30;
    const _lbDag  = _dagOud === 0 ? 'vandaag' : _dagOud === 1 ? 'gisteren' : _dagOud + ' dagen geleden';
    const _lbTxt  = _nooit ? 'Nog nooit een backup gemaakt' : 'Laatste backup: ' + _lbDag + ' · ' + new Date(_lb).toLocaleDateString('nl-NL');
    const _lbRed  = state.instellingen?.laatste_backup_reden || '';
    const _lbRStr = (_lbRed && _lbRed !== 'handmatig') ? ' (' + _lbRed + ')' : '';
    const _wBg    = _nooit ? '#fff0f0' : '#fff4e0';
    const _wKl    = _nooit ? '#7a1010' : '#6b3a00';
    const _wRd    = _nooit ? '#e04040' : '#f0a020';
    const _wTxt   = _nooit
      ? '⚠ Nog nooit een backup gemaakt. Maak er een vóór je iets wijzigt.'
      : '⚠ Laatste backup is ' + _dagOud + ' dagen geleden. Aanbevolen: maandelijks of vóór grote wijzigingen.';
    const _wHtml  = (_nooit || _teOud)
      ? '<div style="background:' + _wBg + ';color:' + _wKl + ';padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:10px;border-left:3px solid ' + _wRd + ';">' + _wTxt + '</div>'
      : '';

    // Backup-geschiedenis lijst
    const _gesch  = (state.instellingen?.backup_geschiedenis || []);
    const _reden  = { handmatig: 'handmatig', 'voor-import': 'vóór import' };
    const _geschHtml = _gesch.length === 0
      ? '<p class="muted" style="margin:10px 0 0;font-size:11px;font-style:italic;">Nog geen backup-geschiedenis beschikbaar.</p>'
      : '<div style="margin-top:10px;">'
        + '<div style="font-size:11px;color:#5f5e5a;margin-bottom:4px;font-weight:500;">Eerdere backups (herstel door bestand te selecteren):</div>'
        + '<div style="display:flex;flex-direction:column;gap:4px;">'
        + _gesch.map((e, i) => {
            const _d  = new Date(e.tijdstip);
            const _dd = _d.toLocaleDateString('nl-NL') + ' ' + _d.toLocaleTimeString('nl-NL', {hour:'2-digit',minute:'2-digit'});
            const _r  = _reden[e.reden] || e.reden || '';
            const _fn = e.bestandsnaam || '';
            return '<div style="font-size:11px;background:#f5f4f0;padding:5px 8px;border-radius:4px;display:flex;justify-content:space-between;align-items:center;">'
              + '<span style="color:#3a3937;">' + _dd + (_r ? ' <span style="color:#888;">(' + _r + ')</span>' : '') + '</span>'
              + '<span style="color:#888;font-family:monospace;font-size:10px;">' + _fn + '</span>'
              + '</div>';
          }).join('')
        + '</div></div>';

    htmlOverig += `
      <div style="margin-top: 1rem;">
        <div class="summary-label" style="margin-bottom: 6px;">Database-backup</div>
        <div class="card">
          ${_wHtml}
          <div style="font-size:12px;color:#5f5e5a;margin-bottom:10px;">${_lbTxt}${_lbRStr}</div>
          ${IS_TEST_DB
            ? `<div style="font-size:12px;color:#9c5700;background:#fff6e0;border:1px solid #e6a817;border-radius:6px;padding:8px 10px;margin-bottom:10px;">
                 In de <b>testomgeving</b> kan geen backup gemaakt worden. Maak een backup in de live-agenda; die kun je hier wél terugzetten om met actuele data te oefenen.
               </div>`
            : `<div style="font-size:12px;color:#5f5e5a;margin-bottom:8px;">
                 Klik op <b>Nu backup maken</b> om een versleutelde snapshot van de hele database te downloaden.
                 Vóór elke Excel-import wordt automatisch een backup gemaakt.
               </div>`}
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="window.actMaakBackup()">⬇ Nu backup maken</button>
            <button class="btn" onclick="document.getElementById('herstelFileInput').click()">↩ Backup terugzetten</button>
            <input type="file" accept=".json" id="herstelFileInput" style="display:none;" onchange="window.actHerstelBackup(this)">
          </div>
          <p class="muted" style="margin:8px 0 0;font-size:11px;">
            Backup is versleuteld met jouw wachtwoord. Auth-accounts blijven altijd bewaard via Firebase Auth.
          </p>
          ${_geschHtml}
        </div>
      </div>
    `;
  }

  // Gegevensbeheer sectie (alleen beheerder)
  if (magGebruikersBeheren()) {
    htmlOverig += `
      <div style="margin-top: 1rem;">
        <div class="summary-label" style="margin-bottom: 6px;">App-instellingen</div>
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 13px; font-weight: 500;">Jaaroverzicht-tab</div>
              <div class="muted" style="font-size: 12px;">Compact weekraster per radioloog voor het hele jaar</div>
            </div>
            <span class="toggle-switch ${window.TOON_JAAROVERZICHT ? 'aan' : ''}" onclick="window.toggleJaaroverzicht()"></span>
          </div>
        </div>
      </div>
    `;
  }
  if (magGebruikersBeheren()) {
    const tweeJaarGeleden = new Date();
    tweeJaarGeleden.setFullYear(tweeJaarGeleden.getFullYear() - 2);
    const grensdatum = tweeJaarGeleden.toISOString().slice(0, 10);
    const vandaag = vandaagIso();

    htmlOverig += `
      <div style="margin-top: 1rem;">
        <div class="summary-label" style="margin-bottom: 6px;">Gegevensbeheer</div>
        <div class="card">
          <p class="muted" style="margin: 0 0 12px;">Verwijder verlopen of verouderde gegevens conform de gebruikersovereenkomst.</p>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
              <div>
                <div style="font-size: 13px; font-weight: 500;">Verlopen wensen</div>
                <div class="muted" style="font-size: 12px;">Wensen met datum vóór vandaag (${formatDatum(vandaag, 'kort')})</div>
              </div>
              <button class="btn" style="white-space: nowrap; flex-shrink: 0;" onclick="window.verwijderVerlopenWensen()">Opruimen</button>
            </div>
            <div style="border-top: 1px solid rgba(0,0,0,0.06); padding-top: 8px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
              <div>
                <div style="font-size: 13px; font-weight: 500;">Gegevens ouder dan 2 jaar</div>
                <div class="muted" style="font-size: 12px;">Indeling en wensen vóór ${formatDatum(grensdatum, 'kort')} — conform AVG-bewaarplicht</div>
              </div>
              <button class="btn" style="white-space: nowrap; flex-shrink: 0; color: #501313;" onclick="window.verwijderOudeGegevens()">Verwijderen</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ---- Assemblage: Beheer met drie sub-tabs --------------------------------
  const v = window.APP_VERSIE || '?';
  const showBez = canGeb, showGeb = canGeb, showCtl = canReg;
  const beschikbareTabs = [showBez && 'bezetting', showGeb && 'gebruikers', showCtl && 'control'].filter(Boolean);
  const eersteTab = (_behTab1 && beschikbareTabs.includes(_behTab1)) ? _behTab1 : beschikbareTabs[0];
  const disp = (id) => id === eersteTab ? 'block' : 'none';
  const tab1 = (id, label) => `<button class="beh-tab1 ${id===eersteTab?'active':''}" data-t="${id}" onclick="window.gebTab1('${id}')">${label}</button>`;
  const tab2 = (scope, id, label, active) => `<button class="beh-tab2 ${active?'active':''}" data-scope="${scope}" data-t="${id}" onclick="window.gebTab2('${scope}','${id}')">${label}</button>`;

  let tabs1 = '';
  if (showBez) tabs1 += tab1('bezetting', 'Stoel bezetting');
  if (showGeb) tabs1 += tab1('gebruikers', 'App gebruikers');
  if (showCtl) tabs1 += tab1('control', 'Control');

  // App gebruikers-paneel met onder-tabs Radiologen / Technici / Secretariaat
  const gebPanel = `
    <div class="beh-tabs2">
      ${tab2('geb','rad','Radiologen',true)}
      ${tab2('geb','tech','Technici',false)}
      ${tab2('geb','sec','Secretariaat',false)}
    </div>
    <div id="gebsub-rad" class="gebsub">
      <div class="card">
        <p class="muted" style="margin:0 0 10px;">Alleen radiologen kunnen aan een stoel gekoppeld worden. Een radioloog die ook beheerder is, staat als <b>Radioloog, beheerder</b>.</p>
        <button class="btn btn-primary" style="width:100%;" onclick="window.nieuweGebruiker('radioloog')">+ Nieuwe radioloog</button>
      </div>
      ${radRows || '<div class="empty-state">Nog geen radiologen</div>'}
    </div>
    <div id="gebsub-tech" class="gebsub" style="display:none;">
      <div class="card">
        <p class="muted" style="margin:0 0 10px;">Technici hebben een account met beperktere toegang en krijgen geen stoel.</p>
        <button class="btn btn-primary" style="width:100%;" onclick="window.nieuweGebruiker('technician')">+ Nieuwe technicus</button>
      </div>
      ${techRows || '<div class="empty-state">Nog geen technici</div>'}
    </div>
    <div id="gebsub-sec" class="gebsub" style="display:none;">
      <div class="card">
        <p class="muted" style="margin:0 0 10px;">Secretariaat heeft een account met beperktere toegang en krijgt geen stoel.</p>
        <button class="btn btn-primary" style="width:100%;" onclick="window.nieuweGebruiker('secretariaat')">+ Nieuw secretariaat</button>
      </div>
      ${secRows || '<div class="empty-state">Nog geen secretariaat</div>'}
    </div>
  `;

  // Control-paneel met onder-tabs Regels + Overige instellingen
  const regelsDefault = canReg;
  const controlPanel = `
    <div class="beh-tabs2">
      ${canReg ? tab2('ctl','regels','Regels',true) : ''}
      ${canGeb ? tab2('ctl','overig','Overige instellingen',!regelsDefault) : ''}
    </div>
    ${canReg ? `<div id="ctlsub-regels" class="ctlsub"><div id="view-reg" class="view"></div></div>` : ''}
    ${canGeb ? `<div id="ctlsub-overig" class="ctlsub" style="${regelsDefault?'display:none;':''}">${htmlOverig}</div>` : ''}
  `;

  container.innerHTML = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <p style="font-size:17px; font-weight:500; margin:0;">Beheer</p>
          <p class="muted" style="margin:2px 0 0;">Stoel bezetting, app gebruikers en instellingen</p>
        </div>
        <span class="muted" style="font-size:11px;">v${v}</span>
      </div>
    </div>
    <div class="beh-tabs1">${tabs1}</div>
    ${showBez ? `<div id="behpanel-bezetting" class="behpanel" style="display:${disp('bezetting')};">${htmlBezetting}</div>` : ''}
    ${showGeb ? `<div id="behpanel-gebruikers" class="behpanel" style="display:${disp('gebruikers')};">${gebPanel}</div>` : ''}
    ${showCtl ? `<div id="behpanel-control" class="behpanel" style="display:${disp('control')};">${controlPanel}</div>` : ''}
  `;

  // Regels-view in het Control-paneel renderen (vult #view-reg dat hierboven is
  // aangemaakt). Alleen als de gebruiker regels mag beheren.
  if (canReg) renderRegView();

  // Herstel de eerder gekozen (sub-)tab na opnieuw tekenen, zodat je na bv. het
  // kiezen van een importbestand op dezelfde plek blijft i.p.v. terug te
  // springen naar Stoel bezetting.
  if (_behTab1 && beschikbareTabs.includes(_behTab1)) window.gebTab1(_behTab1);
  if (showGeb) window.gebTab2('geb', _behTab2.geb);
  if (showCtl) window.gebTab2('ctl', _behTab2.ctl);
}

// Sub-tab-navigatie binnen Beheer (niveau 1: Stoel bezetting / App gebruikers /
// Control). Panelen blijven in de DOM en worden alleen getoond/verborgen, zodat
// ingevulde formuliervelden en knop-statussen behouden blijven.
window.gebTab1 = function(id) {
  _behTab1 = id;
  ['bezetting','gebruikers','control'].forEach(k => {
    const el = document.getElementById('behpanel-' + k);
    if (el) el.style.display = (k === id) ? 'block' : 'none';
  });
  document.querySelectorAll('.beh-tab1').forEach(b => b.classList.toggle('active', b.dataset.t === id));
};

// Sub-tab-navigatie niveau 2. scope 'geb' = App gebruikers (rad/tech/sec),
// scope 'ctl' = Control (regels/overig).
window.gebTab2 = function(scope, id) {
  _behTab2[scope] = id;
  const prefix = scope === 'geb' ? 'gebsub-' : 'ctlsub-';
  const keys = scope === 'geb' ? ['rad','tech','sec'] : ['regels','overig'];
  keys.forEach(k => {
    const el = document.getElementById(prefix + k);
    if (el) el.style.display = (k === id) ? 'block' : 'none';
  });
  document.querySelectorAll('.beh-tab2[data-scope="' + scope + '"]').forEach(b => b.classList.toggle('active', b.dataset.t === id));
};

// ==== Handlers ===============================================================

// Maakt de Opslaan-knop van een sectie zichtbaar/actief zodra er iets wijzigt.
// 'vast' = vaste radiologen, 'wnr' = waarnemers.
window.gebMarkDirty = function(sectie) {
  const btn = document.getElementById(sectie === 'wnr' ? 'btnOpslaanWnr' : 'btnOpslaanVast');
  if (!btn) return;
  btn.disabled = false;
  btn.classList.add('btn-primary');
  btn.style.opacity = '1';
  btn.style.cursor = 'pointer';
};

// Eenmalig: ken een persoon_id toe aan alle huidige bezetters die er nog geen
// hebben. Idempotent — bestaande persoon_id's blijven ongemoeid. Vaste stoelen
// via hun bezetting-entries (+ top-level), W-stoelen via top-level.
window.initialiseerPersoonIds = async function() {
  const teDoen = [];
  (state.radiologen || []).forEach(stoel => {
    const hist = Array.isArray(stoel.bezetting_historie) ? stoel.bezetting_historie.map(e => ({ ...e })) : [];
    let gewijzigd = false;
    let topPid = stoel.persoon_id || null;
    if (hist.length > 0) {
      const perKey = {};
      hist.forEach(e => {
        // Alleen entries met een echte naam zijn een persoon. Lege/kale entries
        // (bv. een vrijgekomen stoel) krijgen géén persoon-id.
        if (!e.persoon_id && (e.achternaam || '').trim()) {
          const k = `${(e.achternaam || '').toLowerCase()}|${(e.code || '').toLowerCase()}`;
          if (!perKey[k]) perKey[k] = nieuwPersoonId();
          e.persoon_id = perKey[k];
          gewijzigd = true;
        }
      });
      const opn = hist.find(e => !e.tot) || hist[hist.length - 1];
      if (opn && opn.persoon_id && stoel.persoon_id !== opn.persoon_id) { topPid = opn.persoon_id; gewijzigd = true; }
    } else if ((stoel.achternaam || '').trim() && !stoel.persoon_id) {
      // Stoel zonder historie (bv. W-stoel): alleen als er een echte bezetter
      // is. Een leeg slot waarvan de 'code' standaard de slotnaam is, telt niet.
      topPid = nieuwPersoonId();
      gewijzigd = true;
    }
    if (gewijzigd) {
      const upd = { persoon_id: topPid };
      if (hist.length > 0) upd.bezetting_historie = hist;
      teDoen.push({ id: stoel.id, upd });
    }
  });
  if (teDoen.length === 0) { alert("Alle bezetters met een naam hebben al een persoon-id."); return; }
  if (!confirm(`${teDoen.length} bezetter(s) krijgen een persoon-id. Doorgaan?`)) return;
  try {
    for (const t of teDoen) {
      await setDoc(doc(db, 'radiologen', t.id), t.upd, { merge: true });
    }
    alert(`Persoon-id's toegekend aan ${teDoen.length} bezetter(s).`);
    renderGebView();
  } catch (e) {
    alert('Mislukt: ' + (e.message || e));
  }
};

// Handmatige integriteitscontrole van alle stoel-tijdlijnen. Toont eventuele
// overlap/dubbel-open problemen; groen als alles klopt. Puur lezend.
window.controleerBezetting = function() {
  const problemen = controleerAlleBezettingen();
  if (problemen.length === 0) {
    alert('✓ Alle stoel-tijdlijnen zijn in orde: geen overlap, geen dubbele lopende periodes.');
    return;
  }
  const tekst = problemen.map(p => `• ${p.code} (${p.id}):\n    - ${p.problemen.join('\n    - ')}`).join('\n\n');
  alert(`⚠ ${problemen.length} stoel(en) met een probleem in de tijdlijn:\n\n${tekst}\n\nCorrigeer dit via Wissel/Vertrek of neem contact op met de beheerder.`);
};

window.opslaanParttime = async function() {
  try {
    for (const r of vasteRads()) {
      const elPf = document.getElementById('pf_' + r.id);
      const elVr = document.getElementById('vr_' + r.id);
      const elId = document.getElementById('id_' + r.id);
      const update = {};
      if (elPf) {
        const pct = Math.max(10, Math.min(100, parseInt(elPf.value, 10) || 100));
        update.parttime_factor = pct / 100;
      }
      if (elVr) {
        const dgn = Math.max(0, Math.min(100, parseInt(elVr.value, 10) || 40));
        update.vakantierecht = dgn;
      }
      // In-dienst (anciënniteit) op de open bezetting-entry zetten; die bepaalt
      // de kolomvolgorde (oudste = links). Geen historie? Dan maken we een open
      // entry aan uit de top-level velden.
      if (elId && elId.value) {
        const stoel = state.radiologen.find(x => x.id === r.id);
        const hist = Array.isArray(stoel?.bezetting_historie)
          ? stoel.bezetting_historie.map(e => ({ ...e }))
          : [];
        // Doel-entry: de open (lopende) entry, of — bij een gepland vertrek
        // zonder open entry — de laatste entry. Zo voorkomen we een dubbele
        // open entry.
        let doel = hist.find(e => !e.tot);
        if (!doel && hist.length > 0) doel = laatsteEntry(hist);
        if (doel) {
          doel.in_dienst = elId.value;
        } else {
          hist.push({
            voornaam: stoel?.voornaam || '',
            achternaam: stoel?.achternaam || '',
            code: stoel?.code || r.id,
            vakantierecht: typeof stoel?.vakantierecht === 'number' ? stoel.vakantierecht : 40,
            parttime_factor: typeof stoel?.parttime_factor === 'number' ? stoel.parttime_factor : 1,
            in_dienst: elId.value,
            persoon_id: stoel?.persoon_id || nieuwPersoonId(),
            van: null, tot: null,
          });
        }
        update.bezetting_historie = hist;
        update.in_dienst = elId.value;
      }
      if (Object.keys(update).length > 0) {
        await setDoc(doc(db, 'radiologen', r.id), update, { merge: true });
      }
    }
    alert('Parttime, vakantierecht en in-dienst opgeslagen.');
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
};

// "Waarnemers opslaan" is nu uitsluitend een RENAME: het werkt alleen de
// code/achternaam bij van de reeds lopende óf geplande waarnemer per W-slot.
// Het maakt, verplaatst of sluit NOOIT periodes af — dat gebeurt uitsluitend via
// het schuifje + datumkiezer (activeren/stoppen). Zo kan bulk-opslaan een lopende
// of geplande →Vast nooit stilzwijgend overschrijven of dubbelboeken.
window.opslaanInvallers = async function() {
  try {
    const vandaag = vandaagIso();
    for (const slotId of SLOTS) {
      const codeEl = document.getElementById('inv_code_' + slotId);
      const naamEl = document.getElementById('inv_naam_' + slotId);
      if (!codeEl || !naamEl) continue;
      const code = codeEl.value.trim();
      const achternaam = naamEl.value.trim();
      const stoel = state.radiologen.find(r => r.id === slotId);
      const hist = Array.isArray(stoel?.bezetting_historie) ? stoel.bezetting_historie.map(e => ({ ...e })) : [];

      // Relevante entry: de lopende bezetter van vandaag, anders de eerstvolgende
      // geplande. Precies dezelfde entry die het raster toont.
      let entry = hist.find(e => (!e.van || e.van <= vandaag) && (!e.tot || e.tot >= vandaag));
      if (!entry) {
        entry = hist
          .filter(e => e.van && e.van > vandaag && (!e.tot || e.tot >= e.van))
          .sort((a, b) => (a.van < b.van ? -1 : 1))[0] || null;
      }

      if (entry) {
        if (!code) {
          alert(`Waarnemer ${slotId} is actief; een lege code kan niet. Gebruik het schuifje om de waarnemer per datum te laten stoppen.`);
          return;
        }
        entry.code = code;
        entry.achternaam = achternaam || '';
        if (!entry.persoon_id) entry.persoon_id = stoel?.persoon_id || nieuwPersoonId();
        assertBezettingGeldig(hist, slotId);
        await setDoc(doc(db, 'radiologen', slotId), {
          id: slotId, isSlot: true, code, achternaam: achternaam || '',
          persoon_id: entry.persoon_id, bezetting_historie: hist,
        }, { merge: true });
      } else if (!hist.length && !code) {
        // Leeg slot, niks ingevuld → overslaan.
        continue;
      } else if (code) {
        // Leeg slot met ingetypte code maar geen periode: activeren hoort via het
        // schuifje (met startdatum), zodat de waarnemer een geldige periode krijgt.
        alert(`Zet het schuifje bij ${slotId} aan om ${code} te activeren met een startdatum.`);
        return;
      }
    }
    alert('Waarnemers opgeslagen.');
    renderGebView();
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
};

// ==== Waarnemer activeren / stoppen via schuifje + datumkiezer ===============
// Het schuifje bij een W-slot opent een sheet. Staat het slot leeg → activeren
// (code + naam + startdatum). Zit er een lopende/geplande waarnemer → stoppen
// (einddatum). Beide schrijven direct, met canonieke clipping, zodat er nooit
// overlappende periodes ontstaan.
window.wnrToggle = function(slotId) {
  const bez = huidigeOfGeplandeBezetting(slotId);
  if (bez) window.openWnrStopSheet(slotId);
  else window.openWnrActiveerSheet(slotId);
};

window.openWnrActiveerSheet = function(slotId) {
  const codeEl = document.getElementById('inv_code_' + slotId);
  const naamEl = document.getElementById('inv_naam_' + slotId);
  const codeNu = codeEl ? codeEl.value.trim() : '';
  const naamNu = naamEl ? naamEl.value.trim() : '';
  const defDatum = vandaagIso();
  document.getElementById('sheetTitle').textContent = `Waarnemer activeren op ${slotId}`;
  document.getElementById('sheetSub').textContent = 'Vanaf welke datum is deze waarnemer actief?';
  document.getElementById('sheetBody').innerHTML = `
    <div class="form-field"><label class="form-label">Code</label>
      <input type="text" class="input" id="waCode" maxlength="4" value="${codeNu.replace(/"/g,'&quot;')}" placeholder="bv. JD"></div>
    <div class="form-field"><label class="form-label">Achternaam</label>
      <input type="text" class="input" id="waNaam" value="${naamNu.replace(/"/g,'&quot;')}" placeholder="Achternaam"></div>
    <div class="form-field"><label class="form-label">Actief vanaf</label>
      <input type="date" class="input" id="waDatum" value="${defDatum}"></div>
    <div style="display:flex; gap:8px; margin-top:1rem;">
      <button class="btn" style="flex:1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex:1;" onclick="window.wnrActiveerDoorvoeren('${slotId}')">Doorvoeren</button>
    </div>`;
  openSheet();
};

window.wnrActiveerDoorvoeren = async function(slotId) {
  const code = document.getElementById('waCode').value.trim();
  const achternaam = document.getElementById('waNaam').value.trim();
  const datum = document.getElementById('waDatum').value;
  if (!code) { alert('Vul een code in.'); return; }
  if (!datum) { alert('Kies een ingangsdatum.'); return; }
  const stoel = state.radiologen.find(r => r.id === slotId);
  const hist = Array.isArray(stoel?.bezetting_historie) ? stoel.bezetting_historie.map(e => ({ ...e })) : [];
  // Clip bestaande periodes per de ingangsdatum en voeg de nieuwe open periode toe.
  const geclipt = clipHistorieVoorWissel(hist, datum);
  const pid = stoel?.persoon_id || nieuwPersoonId();
  geclipt.push({
    voornaam: '', achternaam: achternaam || '', code,
    vakantierecht: typeof stoel?.vakantierecht === 'number' ? stoel.vakantierecht : 40,
    parttime_factor: typeof stoel?.parttime_factor === 'number' ? stoel.parttime_factor : 1,
    in_dienst: null, persoon_id: pid, van: datum, tot: null,
  });
  const btn = document.querySelector('#sheetBody .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader"></span>'; }
  try {
    assertBezettingGeldig(geclipt, slotId);
    await setDoc(doc(db, 'radiologen', slotId), {
      id: slotId, isSlot: true, actief: true, code, achternaam: achternaam || '',
      voornaam: '', persoon_id: pid, bezetting_historie: geclipt,
    }, { merge: true });
    closeSheet();
    alert(`${code} is waarnemer op ${slotId} vanaf ${formatDatum(datum, 'kort')}.`);
    renderGebView();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Doorvoeren'; }
    alert('Activeren mislukt: ' + (e.message || e));
  }
};

window.openWnrStopSheet = function(slotId) {
  const bez = huidigeOfGeplandeBezetting(slotId);
  const defDatum = vandaagIso();
  document.getElementById('sheetTitle').textContent = `Waarnemer ${bez?.code || slotId} stopt`;
  document.getElementById('sheetSub').textContent = 'Vanaf welke datum is deze waarnemer geen waarnemer meer?';
  document.getElementById('sheetBody').innerHTML = `
    <div class="form-info" style="margin-bottom:12px; font-size:12px;">
      <b>${bez?.code || ''}</b> · ${bez?.achternaam || ''} is waarnemer op ${slotId}. Vanaf de opgegeven datum verdwijnt de waarnemer uit het rooster en de tellingen. De historie ervóór blijft behouden.
    </div>
    <div class="form-field"><label class="form-label">Geen waarnemer meer vanaf</label>
      <input type="date" class="input" id="wdDatum" value="${defDatum}"></div>
    <div style="display:flex; gap:8px; margin-top:1rem;">
      <button class="btn" style="flex:1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex:1;" onclick="window.wnrStopDoorvoeren('${slotId}')">Doorvoeren</button>
    </div>`;
  openSheet();
};

window.wnrStopDoorvoeren = async function(slotId) {
  const datum = document.getElementById('wdDatum').value;
  if (!datum) { alert('Kies een datum.'); return; }
  const stoel = state.radiologen.find(r => r.id === slotId);
  const hist = Array.isArray(stoel?.bezetting_historie) ? stoel.bezetting_historie.map(e => ({ ...e })) : [];
  // Sluit lopende/overlappende periodes af per de dag vóór de stopdatum en laat
  // periodes die volledig ná de stopdatum beginnen vervallen (dezelfde canonieke
  // clipping als bij een wissel).
  const nieuw = clipHistorieVoorWissel(hist, datum);
  const vandaag = vandaagIso();
  const nogActief = nieuw.some(e => !e.tot || e.tot >= vandaag);
  const btn = document.querySelector('#sheetBody .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader"></span>'; }
  try {
    assertBezettingGeldig(nieuw, slotId);
    const upd = { id: slotId, isSlot: true, bezetting_historie: nieuw };
    // Geen lopende bezetter meer over → ook de top-level als leeg markeren.
    if (!nogActief) {
      upd.actief = false; upd.code = ''; upd.achternaam = ''; upd.voornaam = ''; upd.persoon_id = null;
    }
    await setDoc(doc(db, 'radiologen', slotId), upd, { merge: true });
    closeSheet();
    alert(`Waarnemer op ${slotId} stopt per ${formatDatum(datum, 'kort')}.`);
    renderGebView();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Doorvoeren'; }
    alert('Wijzigen mislukt: ' + (e.message || e));
  }
};

window.nieuweGebruiker = function(preRol) {
  document.getElementById('sheetTitle').textContent = 'Nieuwe gebruiker';
  document.getElementById('sheetSub').textContent = 'Vul de gegevens in';
  const rads = vasteRads();
  const waarnemers = actieveInvallers();
  const sel = (r) => preRol === r ? ' selected' : '';
  document.getElementById('sheetBody').innerHTML = `
    <div class="form-field"><label class="form-label">Naam</label><input type="text" class="input" id="nuNaam" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="voornaam.achternaam"></div>
    <div class="form-field"><label class="form-label">Tijdelijk wachtwoord</label><input type="text" class="input" id="nuPw" value="${STANDAARD_WACHTWOORD}"></div>
    <div class="form-field"><label class="form-label">Rol</label>
      <select class="select" id="nuRol" onchange="window.nuRolWissel()">
        <option value="radioloog"${sel('radioloog')}>Radioloog</option>
        <option value="beheerder"${sel('beheerder')}>Beheerder</option>
        <option value="secretariaat"${sel('secretariaat')}>Secretariaat</option>
        <option value="technician"${sel('technician')}>Technician</option>
      </select>
    </div>
    <div class="form-field" id="nuKoppelVeld" style="display: ${['radioloog','beheerder'].includes(preRol) ? 'block' : 'none'};"><label class="form-label">Gekoppeld aan (optioneel)</label>
      <select class="select" id="nuRadId">
        <option value="">— geen —</option>
        <optgroup label="Vaste radiologen">
          ${rads.map(r => `<option value="${r.id}">${r.code} · ${r.achternaam}</option>`).join('')}
        </optgroup>
        ${waarnemers.length ? `<optgroup label="Waarnemers">
          ${waarnemers.map(r => `<option value="${r.id}">${r.id} — ${r.code} · ${r.achternaam}</option>`).join('')}
        </optgroup>` : ''}
      </select>
    </div>
    <div class="form-info" style="font-size: 12px;">De gebruiker logt de eerste keer in met dit wachtwoord en wordt dan gevraagd een eigen wachtwoord te kiezen.</div>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.opslaanNieuweGebruiker()">Aanmaken</button>
    </div>
  `;
  openSheet();
};

// Toon de stoel-koppeling alleen voor rollen die een stoel kunnen bezetten
// (radioloog of radioloog-tevens-beheerder); technici/secretariaat nooit.
window.nuRolWissel = function() {
  const rol = document.getElementById('nuRol')?.value;
  const veld = document.getElementById('nuKoppelVeld');
  if (veld) veld.style.display = ['radioloog','beheerder'].includes(rol) ? 'block' : 'none';
};

window.opslaanNieuweGebruiker = async function() {
  const naam = document.getElementById('nuNaam').value.trim();
  const pw = document.getElementById('nuPw').value;
  const rol = document.getElementById('nuRol').value;
  let radId = document.getElementById('nuRadId').value;
  // Vangnet: alleen radioloog/beheerder kan aan een stoel gekoppeld zijn.
  if (!['radioloog','beheerder'].includes(rol)) radId = '';

  if (!naam || !pw) { alert('Vul naam en wachtwoord in'); return; }
  if (pw.length < 6) { alert('Wachtwoord min. 6 tekens'); return; }

  // Genereer e-mailadres op basis van naam; voeg teller toe bij duplicaat.
  const basis = naam.toLowerCase().replace(/\s+/g, '.') + '@rooster.intern';
  let email = basis;
  let teller = 2;
  while (state.gebruikers.some(g => g.email === email)) {
    email = naam.toLowerCase().replace(/\s+/g, '.') + teller + '@rooster.intern';
    teller++;
  }

  const btn = document.querySelector('#sheetBody .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader"></span>'; }

  try {
    await fnGebruikerAanmaken({ email, naam, wachtwoord: pw, rol, radioloog_id: radId || null });
    closeSheet();
    alert(`Gebruiker aangemaakt.\nNaam: ${naam}\nWachtwoord: ${pw}\n\nNoteer dit; het wachtwoord is nu niet meer op te vragen.`);
    await laadGebruikers();
    renderGebView();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Aanmaken'; }
    alert('Aanmaken mislukt: ' + (e.message || 'Onbekende fout'));
  }
};

window.gebruikerBewerken = function(uid) {
  const g = state.gebruikers.find(x => x.id === uid);
  if (!g) return;
  const rads = vasteRads();
  const waarnemers = actieveInvallers();
  // Toon ook de huidige koppeling als die naar een inactieve W-stoel wijst
  // of naar een onbekende slot — anders verdwijnt de selectie uit de lijst.
  const huidigeId = g.radioloog_id || '';
  if (huidigeId && !rads.some(r => r.id === huidigeId) && !waarnemers.some(r => r.id === huidigeId)) {
    const stoel = state.radiologen.find(r => r.id === huidigeId);
    if (stoel) waarnemers.push(stoel);
  }
  const isEigenAccount = uid === state.user.uid;
  const isVasteBeheerder = (g.email || '').toLowerCase() === VASTE_BEHEERDER_EMAIL;

  const huidigePerm = g.permissies || defaultPermissies(g.rol);

  const permissies = [
    { id: 'mag_beheer', label: 'Overzicht — wijzigen' },
    { id: 'mag_beheer_lezen', label: 'Overzicht — bekijken' },
    { id: 'mag_regels', label: 'Regels' },
    { id: 'mag_gebruikers', label: 'Gebruikers' },
    { id: 'mag_wensen_alle', label: 'Wensen van iedereen zien' },
    { id: 'mag_vakantie', label: 'Vakantie-tab zien' },
  ];

  document.getElementById('sheetTitle').textContent = g.naam || g.email;
  document.getElementById('sheetSub').textContent = 'Rol, koppeling en permissies';
  document.getElementById('sheetBody').innerHTML = `
    ${isVasteBeheerder ? `<div class="form-info" style="margin-bottom: 1rem; font-size: 12px;">🔒 Hoofdbeheerder-account. Rol en koppeling staan vast.</div>` : ''}
    ${(isEigenAccount && !isVasteBeheerder) ? `<div class="form-info" style="margin-bottom: 1rem; font-size: 12px;">⚠ Eigen account. "Gebruikers" kan niet uitgezet worden om lockout te voorkomen.</div>` : ''}
    <div class="form-field"><label class="form-label">Rol${isVasteBeheerder?' 🔒':''}</label>
      <select class="select" id="wzRol" onchange="window.wzRolWissel()" ${isVasteBeheerder?'disabled':''}>
        <option value="radioloog" ${g.rol==='radioloog'?'selected':''}>Radioloog</option>
        <option value="beheerder" ${g.rol==='beheerder'?'selected':''}>Beheerder</option>
        <option value="secretariaat" ${g.rol==='secretariaat'?'selected':''}>Secretariaat</option>
        <option value="technician" ${(g.rol==='technician' || g.rol==='lezer')?'selected':''}>Technician</option>
      </select>
    </div>
    <div class="form-field" id="wzKoppelVeld" style="display: ${['radioloog','beheerder'].includes(g.rol) ? 'block' : 'none'};"><label class="form-label">Gekoppeld aan${isVasteBeheerder?' 🔒':''}</label>
      <select class="select" id="wzRadId" ${isVasteBeheerder?'disabled':''}>
        <option value="" ${!g.radioloog_id?'selected':''}>— geen —</option>
        <optgroup label="Vaste radiologen">
          ${rads.map(r => `<option value="${r.id}" ${g.radioloog_id===r.id?'selected':''}>${r.code} · ${r.achternaam}</option>`).join('')}
        </optgroup>
        ${waarnemers.length ? `<optgroup label="Waarnemers">
          ${waarnemers.map(r => `<option value="${r.id}" ${g.radioloog_id===r.id?'selected':''}>${r.id} — ${r.code || ''} · ${r.achternaam || ''}</option>`).join('')}
        </optgroup>` : ''}
      </select>
    </div>
    <div class="form-field">
      <label class="form-label">Permissies</label>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${permissies.map(p => {
          const vergrendeld = isEigenAccount && p.id === 'mag_gebruikers';
          const checked = vergrendeld ? true : huidigePerm[p.id];
          return `
            <label style="display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.03); cursor: ${vergrendeld?'not-allowed':'pointer'}; ${vergrendeld?'opacity:0.7;':''}">
              <input type="checkbox" id="perm_${p.id}" ${checked ? 'checked' : ''} ${vergrendeld?'disabled':''}>
              <span style="font-size: 14px;">${p.label}${vergrendeld?' 🔒':''}</span>
            </label>
          `;
        }).join('')}
      </div>
    </div>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.opslaanGebruikerUpdate('${uid}')">Opslaan</button>
    </div>
  `;
  openSheet();
};

window.wzRolWissel = function() {
  const rol = document.getElementById('wzRol')?.value;
  const veld = document.getElementById('wzKoppelVeld');
  if (veld) veld.style.display = ['radioloog','beheerder'].includes(rol) ? 'block' : 'none';
};

window.wzPermissiesReset = function() {
  const rol = document.getElementById('wzRol').value;
  const def = defaultPermissies(rol);
  ['mag_beheer','mag_beheer_lezen','mag_regels','mag_gebruikers','mag_wensen_alle'].forEach(p => {
    const el = document.getElementById('perm_' + p);
    if (el && !el.disabled) el.checked = !!def[p];
  });
};

window.opslaanGebruikerUpdate = async function(uid) {
  const g = state.gebruikers.find(x => x.id === uid);
  const isVasteBeheerder = (g?.email || '').toLowerCase() === VASTE_BEHEERDER_EMAIL;

  const rol = isVasteBeheerder ? 'beheerder' : document.getElementById('wzRol').value;
  let radId = isVasteBeheerder ? (g.radioloog_id || '') : document.getElementById('wzRadId').value;
  // Vangnet: alleen radioloog/beheerder kan aan een stoel gekoppeld zijn.
  if (!['radioloog','beheerder'].includes(rol)) radId = '';
  const permissies = {};
  ['mag_beheer','mag_beheer_lezen','mag_regels','mag_gebruikers','mag_wensen_alle'].forEach(p => {
    const el = document.getElementById('perm_' + p);
    if (el) permissies[p] = el.checked;
  });

  const heeftMagGebruikers = (g, nieuw) => {
    if (g.id === uid) return !!nieuw.permissies.mag_gebruikers;
    const eff = g.permissies || defaultPermissies(g.rol);
    return !!eff.mag_gebruikers;
  };
  const aantalMet = state.gebruikers.filter(g => heeftMagGebruikers(g, { permissies })).length;
  if (aantalMet === 0) {
    alert('Kan niet opslaan: er moet minstens één gebruiker zijn met "Gebruikers"-permissie.');
    return;
  }

  try {
    await updateDoc(doc(db, 'gebruikers', uid), { rol, radioloog_id: radId || null, permissies });
    closeSheet();
    await laadGebruikers();
    renderGebView();
  } catch (e) {
    alert('Wijzigen mislukt: ' + e.message);
  }
};

window.gebruikerWachtwoordReset = async function(uid, email) {
  if (!confirm(`Wachtwoord van ${email} terugzetten naar het standaard wachtwoord?\n\nDe gebruiker moet daarna opnieuw inloggen en een nieuw wachtwoord kiezen.`)) return;
  try {
    await fnGebruikerResetWachtwoord({ uid });
    alert(`Wachtwoord van ${email} is teruggezet naar het standaard wachtwoord.`);
  } catch (e) {
    alert('Reset mislukt: ' + (e.message || 'onbekende fout'));
  }
};

window.gebruikerVerwijderen = async function(uid, email) {
  if ((email || '').toLowerCase() === VASTE_BEHEERDER_EMAIL) {
    alert('Hoofdbeheerder-account kan niet verwijderd worden.');
    return;
  }
  const overigen = state.gebruikers.filter(g => g.id !== uid);
  const aantalMet = overigen.filter(g => {
    const eff = g.permissies || defaultPermissies(g.rol);
    return !!eff.mag_gebruikers;
  }).length;
  if (aantalMet === 0) {
    alert('Kan niet verwijderen: er moet minstens één gebruiker met "Gebruikers"-permissie overblijven.');
    return;
  }
  if (!confirm(`Gebruiker ${email} verwijderen?\n\nDit verwijdert zowel het account als het profiel.`)) return;
  try {
    await fnGebruikerVerwijderen({ uid });
    await laadGebruikers();
    renderGebView();
  } catch (e) {
    alert('Verwijderen mislukt: ' + (e.message || 'onbekende fout'));
  }
};

// Excel-import handlers — delegeer naar import.js, met renderGebView als callback
window.actImportFile        = (input) => actImportFile(input, renderGebView);

window.actMaakBackup = async function() {
  if (IS_TEST_DB) {
    alert('In de testomgeving kan geen backup gemaakt worden.\n\nMaak een backup in de live-agenda; die kun je desgewenst in de testomgeving terugzetten om met actuele data te oefenen.');
    return;
  }
  try {
    const knop = document.querySelector('[onclick="window.actMaakBackup()"]');
    if (knop) { knop.disabled = true; knop.textContent = 'Bezig\u2026'; }
    await maakClientBackup('handmatig');
    alert('Backup gedownload. Bewaar dit bestand op een veilige plek.');
  } catch (e) {
    alert('Backup mislukt: ' + e.message);
  } finally {
    renderGebView();
  }
};

window.actHerstelBackup = async function(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!confirm(
    'WAARSCHUWING: Dit overschrijft alle Firestore-data met de inhoud van de backup.\n\n' +
    'Auth-accounts (wachtwoorden) worden NIET aangetast.\n\n' +
    'Doorgaan?'
  )) return;
  const meldingen = [];
  try {
    await herstelClientBackup(file, (t) => meldingen.push(t));
    alert('Restore voltooid:\n\n' + meldingen.join('\n'));
  } catch (e) {
    alert('Restore mislukt: ' + e.message + '\n\n' + meldingen.join('\n'));
  }
  input.value = '';
};

window.actImportSchrijven   = ()      => actImportSchrijven(renderGebView);
window.actImportAnnuleren   = ()      => actImportAnnuleren(renderGebView);
window.actZetImportJaar     = (jaar)  => actZetImportJaar(jaar);
window.actExportJaar        = (jaar, naam)  => actExportJaar(jaar, naam);

// ==== Bezetting wisselen (zelfde stoel, nieuwe persoon) =====================

// Sheet: vervang persoon op een stoel vanaf een datum. Geen data-migratie
// nodig (toewijzingen blijven onder dezelfde slot-id), wel een nieuwe entry
// in bezetting_historie en update van top-level velden.
window.openWisselSheet = function(slotId) {
  const stoel = state.radiologen.find(r => r.id === slotId);
  const isWaarnemer = SLOTS.includes(slotId);
  const huidigB = bezettingOpDatum(slotId, vandaagIso());
  const defDatum = vandaagIso();

  document.getElementById('sheetTitle').textContent = `Wissel persoon op ${slotId}`;
  document.getElementById('sheetSub').textContent = isWaarnemer
    ? 'Nieuwe waarnemer per datum'
    : 'Nieuwe radioloog op deze vaste stoel per datum';

  document.getElementById('sheetBody').innerHTML = `
    ${huidigB ? `<div class="form-info" style="margin-bottom: 12px; font-size: 12px;">Huidig: <b>${huidigB.code}</b> · ${huidigB.achternaam || ''}${huidigB.van ? ` (sinds ${formatDatum(huidigB.van, 'kort')})` : ''}</div>` : `<div class="form-info" style="margin-bottom: 12px; font-size: 12px;">Stoel is leeg.</div>`}
    <div class="form-field"><label class="form-label">Code (initialen, max 4)</label><input type="text" class="input" id="wsCode" maxlength="4" placeholder="bv. AV"></div>
    <div class="form-field"><label class="form-label">Voornaam</label><input type="text" class="input" id="wsVoornaam" placeholder="Anna"></div>
    <div class="form-field"><label class="form-label">Achternaam</label><input type="text" class="input" id="wsAchternaam" placeholder="de Vries"></div>
    <div style="display: flex; gap: 12px;">
      <div class="form-field" style="flex: 1;"><label class="form-label">Parttime %</label><input type="number" class="input" id="wsPf" value="100" min="10" max="100" step="1"></div>
      <div class="form-field" style="flex: 1;"><label class="form-label">Vakantierecht</label><input type="number" class="input" id="wsVr" value="40" min="0" max="100" step="1"></div>
    </div>
    <div class="form-field"><label class="form-label">Ingangsdatum</label><input type="date" class="input" id="wsDatum" value="${defDatum}"></div>
    <div class="form-field"><label class="form-label">In dienst / senioriteit <span class="muted" style="font-weight:400;">(bepaalt kolomvolgorde, oudste = links)</span></label><input type="date" class="input" id="wsInDienst" value="${defDatum}"></div>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.opslaanWissel('${slotId}')">Doorvoeren</button>
    </div>
  `;
  openSheet();
};

window.opslaanWissel = async function(slotId) {
  const code = document.getElementById('wsCode').value.trim();
  const voornaam = document.getElementById('wsVoornaam').value.trim();
  const achternaam = document.getElementById('wsAchternaam').value.trim();
  const pf = Math.max(10, Math.min(100, parseInt(document.getElementById('wsPf').value, 10) || 100)) / 100;
  const vr = Math.max(0, Math.min(100, parseInt(document.getElementById('wsVr').value, 10) || 40));
  const datum = document.getElementById('wsDatum').value;
  const inDienst = document.getElementById('wsInDienst').value || datum;
  if (!code || !achternaam) { alert('Code en achternaam zijn verplicht.'); return; }
  if (!datum) { alert('Kies een ingangsdatum.'); return; }

  const stoel = state.radiologen.find(r => r.id === slotId);
  const oudeHist = Array.isArray(stoel?.bezetting_historie) ? [...stoel.bezetting_historie] : [];
  // Zorg dat er een entry voor de huidige bezetting bestaat (lazy-init).
  if (oudeHist.length === 0 && (stoel?.code || stoel?.achternaam)) {
    oudeHist.push({
      voornaam: stoel.voornaam || '',
      achternaam: stoel.achternaam || '',
      code: stoel.code || slotId,
      vakantierecht: typeof stoel.vakantierecht === 'number' ? stoel.vakantierecht : 40,
      parttime_factor: typeof stoel.parttime_factor === 'number' ? stoel.parttime_factor : 1,
      in_dienst: stoel.in_dienst || null,
      van: null, tot: null,
    });
  }
  // Sluit én clip alle bestaande entries per de dag vóór de ingangsdatum:
  // open entries worden gesloten, gesloten entries die tot op/ná de
  // ingangsdatum doorlopen worden geclipt, en entries die volledig op/ná de
  // ingangsdatum beginnen vervallen. Zo kan een oude periode de nieuwe
  // bezetter nooit meer overschaduwen (de "W1"-shadowing-bug).
  const nieuweHist = clipHistorieVoorWissel(oudeHist, datum);
  // Nieuwe persoon op deze stoel = nieuwe identiteit → vers persoon_id.
  const nieuwPid = nieuwPersoonId();
  // Voeg nieuwe entry toe.
  nieuweHist.push({
    voornaam, achternaam, code,
    vakantierecht: vr,
    parttime_factor: pf,
    in_dienst: inDienst || null,
    persoon_id: nieuwPid,
    van: datum,
    tot: null,
  });

  // Planner helpen: laat zien wat er vanaf de ingangsdatum al op deze stoel
  // gepland staat (blijft staan, maar hoort daarna bij de nieuwe persoon).
  const impW = impactVanaf(datum, [slotId]);
  if (impW.toew || impW.vak || impW.dienst || impW.wensen) {
    let msg = `Let op: vanaf ${formatDatum(datum, 'kort')} staat op stoel ${slotId} al gepland: ${impactTekst(impW)}.\n`
      + `Dat blijft op de stoel staan, maar hoort daarna bij ${code}.`;
    if (impW.nabij) msg += `\n\n⚠ ${impW.nabijeDagen.length} dag(en) hiervan liggen binnenkort.`;
    msg += `\n\nDoorvoeren?`;
    if (!confirm(msg)) return;
  }
  const voorSnap = snapshotStoelen([slotId]);
  try {
    assertBezettingGeldig(nieuweHist, slotId);
    await setDoc(doc(db, 'radiologen', slotId), {
      id: slotId,
      code, voornaam, achternaam,
      vakantierecht: vr,
      parttime_factor: pf,
      in_dienst: inDienst || null,
      persoon_id: nieuwPid,
      actief: true,
      isSlot: SLOTS.includes(slotId),
      bezetting_historie: nieuweHist,
    }, { merge: true });
    await registreerMutatie({
      type: 'wissel', stoelen: [slotId], voor: { [slotId]: voorSnap[slotId] }, ingangsdatum: datum,
      beschrijving: `Wissel op ${slotId}: ${code} · ${achternaam} per ${formatDatum(datum, 'kort')}`,
    });
    closeSheet();
    alert(`Bezetting van ${slotId} aangepast: ${code} · ${achternaam} per ${formatDatum(datum, 'kort')}.`);
    if (window.__herlaadBeheer) await window.__herlaadBeheer();
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
};

// ==== Nieuwe stoel: losse actie, los van Wissel en →Vast =====================
// Expliciete, vindbare manier om een gloednieuwe vaste stoel aan te maken voor
// een radioloog die nog nergens in de app staat (geen bestaande waarnemer, geen
// bestaande stoel). Voorheen kon dit alleen impliciet via de "➕ Nieuwe stoel"-
// optie in de →Vast-dropdown van een waarnemer — verwarrend, want dat vereiste
// eerst een waarnemer aan te maken. Voor een bestaande waarnemer die je vast in
// dienst wilt nemen mét behoud van diens indeling/wensen, blijft →Vast (met de
// "➕ Nieuwe stoel"-optie erin) de juiste weg.
window.openNieuweStoelSheet = function() {
  const defDatum = vandaagIso();
  document.getElementById('sheetTitle').textContent = 'Nieuwe stoel aanmaken';
  document.getElementById('sheetSub').textContent = 'Een vaste stoel met een nieuwe radioloog, per ingangsdatum';
  document.getElementById('sheetBody').innerHTML = `
    <div class="form-info" style="margin-bottom: 12px; font-size: 12px;">
      Er komt een nieuwe kolom bij in het overzicht, zonder gekoppelde indeling of historie. Wil je in plaats daarvan een bestaande waarnemer vast in dienst nemen mét behoud van diens indeling, wensen en diensten? Gebruik dan <b>→ Vast</b> bij die waarnemer in de Waarnemers-sectie hieronder.
    </div>
    <div class="form-field"><label class="form-label">Code (initialen, max 4)</label><input type="text" class="input" id="nsCode" maxlength="4" placeholder="bv. AV"></div>
    <div class="form-field"><label class="form-label">Voornaam</label><input type="text" class="input" id="nsVoornaam" placeholder="Anna"></div>
    <div class="form-field"><label class="form-label">Achternaam</label><input type="text" class="input" id="nsAchternaam" placeholder="de Vries"></div>
    <div style="display: flex; gap: 12px;">
      <div class="form-field" style="flex: 1;"><label class="form-label">Parttime %</label><input type="number" class="input" id="nsPf" value="100" min="10" max="100" step="1"></div>
      <div class="form-field" style="flex: 1;"><label class="form-label">Vakantierecht</label><input type="number" class="input" id="nsVr" value="40" min="0" max="100" step="1"></div>
    </div>
    <div class="form-field"><label class="form-label">Ingangsdatum</label><input type="date" class="input" id="nsDatum" value="${defDatum}"></div>
    <div class="form-field"><label class="form-label">In dienst / senioriteit <span class="muted" style="font-weight:400;">(bepaalt kolomvolgorde, oudste = links)</span></label><input type="date" class="input" id="nsInDienst" value="${defDatum}"></div>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.nieuweStoelDoorvoeren()">Aanmaken</button>
    </div>
  `;
  openSheet();
};

window.nieuweStoelDoorvoeren = async function() {
  const code = document.getElementById('nsCode').value.trim();
  const voornaam = document.getElementById('nsVoornaam').value.trim();
  const achternaam = document.getElementById('nsAchternaam').value.trim();
  const pf = Math.max(10, Math.min(100, parseInt(document.getElementById('nsPf').value, 10) || 100)) / 100;
  const vr = Math.max(0, Math.min(100, parseInt(document.getElementById('nsVr').value, 10) || 40));
  const datum = document.getElementById('nsDatum').value;
  const inDienst = document.getElementById('nsInDienst').value || datum;
  if (!code || !achternaam) { alert('Code en achternaam zijn verplicht.'); return; }
  if (!datum) { alert('Kies een ingangsdatum.'); return; }

  // Max 12 gelijktijdig actieve vaste stoelen (op de ingangsdatum) — zelfde
  // grens als bij →Vast met "➕ Nieuwe stoel".
  if (vasteRadsOpDatum(datum).length >= 12) {
    alert('Er zijn al 12 actieve stoelen op die datum — dat is het maximum. Hef eerst een stoel op (Vertrek).');
    return;
  }

  if (!confirm(`Nieuwe stoel aanmaken voor ${code} · ${achternaam} per ${formatDatum(datum, 'kort')}?

Er komt een kolom bij in het overzicht.`)) return;

  const btn = document.querySelector('#sheetBody .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader"></span>'; }

  try {
    // Vers, uniek stoel-id (nooit hergebruikt) — zelfde patroon als bij een
    // nieuwe stoel via →Vast.
    const nieuweId = 'VS' + Date.now().toString(36);
    const pid = nieuwPersoonId();
    await setDoc(doc(db, 'radiologen', nieuweId), {
      id: nieuweId, vaste_stoel: true, isSlot: false, type: 'radioloog',
      actief: true, code, voornaam, achternaam,
      vakantierecht: vr, parttime_factor: pf,
      in_dienst: inDienst || null,
      persoon_id: pid,
      bezetting_historie: [{
        voornaam, achternaam, code,
        vakantierecht: vr, parttime_factor: pf,
        in_dienst: inDienst || null,
        persoon_id: pid,
        van: datum, tot: null,
      }],
    }, { merge: true });
    await registreerMutatie({
      type: 'nieuweStoel', stoelen: [nieuweId], voor: { [nieuweId]: null }, ingangsdatum: datum,
      beschrijving: `Nieuwe stoel ${code} · ${achternaam} per ${formatDatum(datum, 'kort')}`,
    });
    closeSheet();
    alert(`Nieuwe stoel aangemaakt: ${code} · ${achternaam} per ${formatDatum(datum, 'kort')}.`);
    renderGebView();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Aanmaken'; }
    alert('Aanmaken mislukt: ' + (e.message || e));
  }
};

// ==== Maak vast: waarnemer wordt vaste rad in stoel X =======================

// Preview: wat verschuift er als we W-slot per datum naar vaste stoel migreren?
function previewMigratie(vanSlot, naarSlot, datum) {
  let toew = 0, vakantie = 0, dienstD = 0, wensen = 0;
  Object.values(state.indelingMap).forEach(dag => {
    if (!dag?.datum || dag.datum < datum) return;
    if (dag.toewijzingen && dag.toewijzingen[vanSlot]) toew++;
    if (dag.vakantie_v && (vanSlot in dag.vakantie_v)) vakantie++;
    if (dag.dienst) {
      ['dag','avond','nacht'].forEach(s => {
        if (dag.dienst[s] === vanSlot) dienstD++;
      });
    }
  });
  (state.wensen || []).forEach(w => {
    if (w.radioloog_id === vanSlot && w.datum >= datum) wensen++;
  });
  const gebruikersGekoppeld = state.gebruikers.filter(g => g.radioloog_id === vanSlot).length;
  return { toew, vakantie, dienstD, wensen, gebruikersGekoppeld };
}

window.openMaakVastSheet = function(wSlotId) {
  const stoel = state.radiologen.find(r => r.id === wSlotId);
  if (!stoel || stoel.actief === false || !stoel.code) { alert('Deze W-stoel is leeg.'); return; }

  const huidig = bezettingOpDatum(wSlotId, vandaagIso());
  const defDatum = vandaagIso();
  const opties = vasteRadsOpDatum(vandaagIso()).map(r => {
    return `<option value="${r.id}">${r.code || r.id} · ${r.achternaam || ''} (vervangen)</option>`;
  }).join('') + `<option value="__NIEUW__">➕ Nieuwe stoel (kolom erbij)</option>`;

  document.getElementById('sheetTitle').textContent = `Maak ${huidig?.code || wSlotId} vast`;
  document.getElementById('sheetSub').textContent = `${huidig?.achternaam || ''} verhuist van ${wSlotId} naar een vaste stoel`;

  document.getElementById('sheetBody').innerHTML = `
    <div class="form-info" style="margin-bottom: 12px; font-size: 12px;">
      <b>${huidig?.code || ''}</b> · ${huidig?.achternaam || ''} (nu in ${wSlotId}) wordt per datum de bezetter van een vaste stoel. Toewijzingen, vakantie-V, diensten en wensen vanaf die datum verhuizen mee. Historie van vóór de datum blijft op ${wSlotId}.
    </div>
    <div class="form-field"><label class="form-label">Welke vaste stoel?</label>
      <select class="select" id="mvSlot">${opties}</select>
    </div>
    <div class="form-field"><label class="form-label">Ingangsdatum</label>
      <input type="date" class="input" id="mvDatum" value="${defDatum}" onchange="window.mvUpdatePreview('${wSlotId}')">
    </div>
    <div class="form-field"><label class="form-label">In dienst / senioriteit <span class="muted" style="font-weight:400;">(bepaalt kolomvolgorde, oudste = links)</span></label>
      <input type="date" class="input" id="mvInDienst" value="${huidig?.in_dienst || defDatum}">
    </div>
    <div id="mvPreview" class="form-info" style="font-size: 12px; margin-bottom: 12px;">Tik <b>Preview</b> om te zien wat er verschuift.</div>
    <div style="display: flex; gap: 8px;">
      <button class="btn" style="flex: 1;" onclick="window.mvUpdatePreview('${wSlotId}')">Preview</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.maakVastDoorvoeren('${wSlotId}')">Doorvoeren</button>
    </div>
    <button class="btn" style="width: 100%; margin-top: 8px;" onclick="window.closeSheet()">Annuleren</button>
  `;
  openSheet();
};

window.mvUpdatePreview = function(wSlotId) {
  const naarSlot = document.getElementById('mvSlot').value;
  const datum = document.getElementById('mvDatum').value;
  const el = document.getElementById('mvPreview');
  if (!datum || !naarSlot) { el.textContent = 'Kies stoel en datum.'; return; }
  const p = previewMigratie(wSlotId, naarSlot, datum);
  const huidigDoel = bezettingOpDatum(naarSlot, datum);
  el.innerHTML = `
    Vanaf <b>${formatDatum(datum, 'kort')}</b> verhuizen:
    <ul style="margin: 6px 0 0 18px; padding: 0;">
      <li>${p.toew} toewijzingen</li>
      <li>${p.vakantie} vakantie-V markeringen</li>
      <li>${p.dienstD} dienst-velden</li>
      <li>${p.wensen} wensen</li>
      <li>${p.gebruikersGekoppeld} gekoppelde gebruiker(s)</li>
    </ul>
    ${huidigDoel ? `<div style="margin-top: 6px;">Huidige bezetter van <b>${naarSlot}</b> (${huidigDoel.code} · ${huidigDoel.achternaam || ''}) wordt afgesloten op ${formatDatum(plusDagen(datum, -1), 'kort')}.</div>` : ''}
  `;
};

window.maakVastDoorvoeren = async function(wSlotId) {
  let naarSlot = document.getElementById('mvSlot').value;
  const datum = document.getElementById('mvDatum').value;
  const inDienst = document.getElementById('mvInDienst').value || datum;
  if (!datum || !naarSlot) { alert('Kies stoel en datum.'); return; }

  const nieuweStoel = (naarSlot === '__NIEUW__');
  if (!nieuweStoel && !isVasteStoel(naarSlot)) { alert('Ongeldige doel-stoel.'); return; }

  // Max 12 gelijktijdig actieve vaste stoelen (op de ingangsdatum).
  if (nieuweStoel && vasteRadsOpDatum(datum).length >= 12) {
    alert('Er zijn al 12 actieve stoelen op die datum — dat is het maximum. Hef eerst een stoel op (Vertrek).');
    return;
  }

  const bevestiging = nieuweStoel
    ? `Maak ${wSlotId} vast op een NIEUWE stoel per ${formatDatum(datum, 'kort')}?\n\nEr komt een kolom bij. Toewijzingen, vakantie-V, diensten, wensen en gebruikerskoppeling vanaf die datum verhuizen mee.`
    : `Maak ${wSlotId} vast in ${naarSlot} per ${formatDatum(datum, 'kort')}?\n\nDe doelstoel toont vanaf die datum uitsluitend de indeling van ${wSlotId} (eventuele resten van de vorige bezetter worden gewist). Toewijzingen, vakantie-V, diensten, wensen en gebruikerskoppeling verhuizen mee. Niet ongedaan te maken zonder handmatig terugdraaien.`;
  if (!confirm(bevestiging)) return;

  const btn = document.querySelector('#sheetBody .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader"></span>'; }

  try {
    // Snapshot vóór de migratie voor terugdraaien: wSlot bestaat al; de doelstoel
    // bestaat alleen als het GÉÉN nieuwe stoel is (bij nieuw = null → terugdraaien
    // verwijdert die stoel weer).
    const voor = { [wSlotId]: snapshotStoelen([wSlotId])[wSlotId] };
    if (nieuweStoel) {
      // Vers, uniek stoel-id (nooit hergebruikt). Eerst het lege stoel-document
      // met de vaste-stoel-markering aanmaken, daarna de persoon erop migreren.
      naarSlot = 'VS' + Date.now().toString(36);
      voor[naarSlot] = null;
      await setDoc(doc(db, 'radiologen', naarSlot), {
        id: naarSlot, vaste_stoel: true, isSlot: false, type: 'radioloog',
        actief: true, code: '', voornaam: '', achternaam: '', bezetting_historie: [],
      }, { merge: true });
    } else {
      voor[naarSlot] = snapshotStoelen([naarSlot])[naarSlot];
    }
    const inv = await migreerBezetting(wSlotId, naarSlot, datum, inDienst);
    await registreerMutatie({
      type: 'maakVast', stoelen: [wSlotId, naarSlot], voor, ingangsdatum: datum,
      roosterInvers: inv.roosterInvers, wensenInvers: inv.wensenInvers, gebruikersInvers: inv.gebruikersInvers,
      beschrijving: `→ Vast: ${wSlotId} → ${naarSlot} per ${formatDatum(datum, 'kort')}`,
    });
    closeSheet();
    alert(nieuweStoel
      ? `${wSlotId} → nieuwe stoel doorgevoerd per ${formatDatum(datum, 'kort')}.`
      : `${wSlotId} → ${naarSlot} doorgevoerd per ${formatDatum(datum, 'kort')}.`);
    renderGebView();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Doorvoeren'; }
    alert('Migratie mislukt: ' + (e.message || e));
  }
};

// ==== Vertrek: vaste stoel verdwijnt per datum =============================

window.openVertrekSheet = function(slotId) {
  const huidig = bezettingOpDatum(slotId, vandaagIso());
  const defDatum = vandaagIso();
  document.getElementById('sheetTitle').textContent = `Vertrek ${huidig?.code || slotId}`;
  document.getElementById('sheetSub').textContent = 'De stoel verdwijnt vanaf de opgegeven datum';
  document.getElementById('sheetBody').innerHTML = `
    <div class="form-info" style="margin-bottom: 12px; font-size: 12px;">
      <b>${huidig?.code || ''}</b> · ${huidig?.achternaam || ''} verlaat de stoel. Vanaf de vertrekdatum verdwijnt de kolom uit het overzicht; de historie van vóór die datum blijft zichtbaar.
    </div>
    <div class="form-field"><label class="form-label">Vertrekdatum <span class="muted" style="font-weight:400;">(vanaf deze dag is de stoel weg)</span></label>
      <input type="date" class="input" id="vtDatum" value="${defDatum}">
    </div>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.vertrekDoorvoeren('${slotId}')">Doorvoeren</button>
    </div>
  `;
  openSheet();
};

window.vertrekDoorvoeren = async function(slotId) {
  const datum = document.getElementById('vtDatum').value;
  if (!datum) { alert('Kies een vertrekdatum.'); return; }
  const stoel = state.radiologen.find(r => r.id === slotId);
  if (!stoel) { alert('Stoel niet gevonden.'); return; }
  if (!confirm(`Laat stoel ${slotId} vertrekken per ${formatDatum(datum, 'kort')}?\n\nDe kolom verdwijnt vanaf die datum. De historie ervóór blijft behouden.`)) return;

  // Planner helpen: wat staat er vanaf de vertrekdatum nog op deze stoel?
  const impV = impactVanaf(datum, [slotId]);
  if (impV.toew || impV.vak || impV.dienst || impV.wensen) {
    let msg = `Let op: vanaf ${formatDatum(datum, 'kort')} staat op stoel ${slotId} nog gepland: ${impactTekst(impV)}.\n`
      + `Na vertrek verdwijnt de kolom; die geplande gegevens blijven in de historie maar horen bij niemand meer.`;
    if (impV.nabij) msg += `\n\n⚠ ${impV.nabijeDagen.length} dag(en) hiervan liggen binnenkort.`;
    msg += `\n\nDoorvoeren?`;
    if (!confirm(msg)) return;
  }
  const voorSnap = snapshotStoelen([slotId]);
  // De bezetter is actief t/m de dag vóór de vertrekdatum.
  const dagVoor = plusDagen(datum, -1);
  const hist = Array.isArray(stoel.bezetting_historie) ? stoel.bezetting_historie.map(e => ({ ...e })) : [];
  if (hist.length === 0) {
    // Oud datamodel: maak een entry uit de top-level velden en sluit hem af.
    hist.push({
      voornaam: stoel.voornaam || '', achternaam: stoel.achternaam || '',
      code: stoel.code || slotId,
      vakantierecht: typeof stoel.vakantierecht === 'number' ? stoel.vakantierecht : 40,
      parttime_factor: typeof stoel.parttime_factor === 'number' ? stoel.parttime_factor : 1,
      in_dienst: stoel.in_dienst || null,
      persoon_id: stoel.persoon_id || null,
      van: null, tot: dagVoor,
    });
  } else {
    const open = hist.find(e => !e.tot);
    if (open) open.tot = dagVoor;
  }

  const btn = document.querySelector('#sheetBody .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader"></span>'; }
  try {
    assertBezettingGeldig(hist, slotId);
    await setDoc(doc(db, 'radiologen', slotId), { bezetting_historie: hist }, { merge: true });
    closeSheet();
    await registreerMutatie({
      type: 'vertrek', stoelen: [slotId], voor: { [slotId]: voorSnap[slotId] }, ingangsdatum: datum,
      beschrijving: `Vertrek ${slotId} per ${formatDatum(datum, 'kort')}`,
    });
    alert(`Stoel ${slotId} vertrekt per ${formatDatum(datum, 'kort')}.`);
    renderGebView();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Doorvoeren'; }
    alert('Opslaan mislukt: ' + (e.message || e));
  }
};

window.vertrekIntrekken = async function(slotId) {
  const stoel = state.radiologen.find(r => r.id === slotId);
  if (!stoel) { alert('Stoel niet gevonden.'); return; }
  const hist = Array.isArray(stoel.bezetting_historie) ? stoel.bezetting_historie.map(e => ({ ...e })) : [];
  if (hist.length === 0) { alert('Geen bezetting om te herstellen.'); return; }
  // Laatste (meest recente) entry zoeken via de canonieke helper.
  const e = laatsteEntry(hist);
  const li = e ? hist.indexOf(e) : -1;
  if (li < 0 || !e.tot) { alert('Deze stoel heeft geen vertrek om in te trekken.'); return; }
  if (!confirm(`Vertrek van ${e.code || slotId} (${e.achternaam || ''}) intrekken?\n\nDe stoel wordt weer doorlopend actief en de kolom komt terug.`)) return;
  hist[li] = { ...e, tot: null };
  try {
    await setDoc(doc(db, 'radiologen', slotId), { bezetting_historie: hist }, { merge: true });
    alert(`Vertrek van ${slotId} ingetrokken.`);
    renderGebView();
  } catch (err) {
    alert('Herstellen mislukt: ' + (err.message || err));
  }
};

// Doet de daadwerkelijke batch-migratie. Schrijft in <500-doc batches om
// firestore-limieten te respecteren.
async function migreerBezetting(vanSlot, naarSlot, datum, inDienst) {
  // 1. Bezetting van vanSlot ophalen
  const vanStoel = state.radiologen.find(r => r.id === vanSlot);
  const vanHist = Array.isArray(vanStoel?.bezetting_historie) ? [...vanStoel.bezetting_historie] : [];
  if (vanHist.length === 0 && vanStoel) {
    vanHist.push({
      voornaam: vanStoel.voornaam || '',
      achternaam: vanStoel.achternaam || '',
      code: vanStoel.code || vanSlot,
      vakantierecht: typeof vanStoel.vakantierecht === 'number' ? vanStoel.vakantierecht : 40,
      parttime_factor: typeof vanStoel.parttime_factor === 'number' ? vanStoel.parttime_factor : 1,
      in_dienst: vanStoel.in_dienst || null,
      persoon_id: vanStoel.persoon_id || null,
      van: null, tot: null,
    });
  }
  const persoon = vanHist.find(e => !e.tot) || vanHist[vanHist.length - 1];
  if (!persoon) throw new Error('Geen persoon gevonden in ' + vanSlot);
  // Persoon_id loopt mee zodat de persoon over stoelen heen herleidbaar blijft.
  const pid = persoon.persoon_id || vanStoel?.persoon_id || nieuwPersoonId();

  // 2. Bezetting van naarSlot
  const naarStoel = state.radiologen.find(r => r.id === naarSlot);
  const naarHist = Array.isArray(naarStoel?.bezetting_historie) ? [...naarStoel.bezetting_historie] : [];
  if (naarHist.length === 0 && naarStoel) {
    naarHist.push({
      voornaam: naarStoel.voornaam || '',
      achternaam: naarStoel.achternaam || '',
      code: naarStoel.code || naarSlot,
      vakantierecht: typeof naarStoel.vakantierecht === 'number' ? naarStoel.vakantierecht : 40,
      parttime_factor: typeof naarStoel.parttime_factor === 'number' ? naarStoel.parttime_factor : 1,
      van: null, tot: null,
    });
  }

  // Sluit én clip alle entries op vanSlot en naarSlot per de dag vóór de
  // ingangsdatum (zelfde canonieke clipping als bij een Wissel), zodat er
  // nooit overlappende periodes achterblijven die de nieuwe bezetter
  // overschaduwen.
  const vanHistNieuw = clipHistorieVoorWissel(vanHist, datum);
  const naarHistNieuw = clipHistorieVoorWissel(naarHist, datum);
  // Voeg persoon toe als nieuwe open entry op naarSlot.
  naarHistNieuw.push({
    voornaam: persoon.voornaam || '',
    achternaam: persoon.achternaam || '',
    code: persoon.code || vanSlot,
    vakantierecht: typeof persoon.vakantierecht === 'number' ? persoon.vakantierecht : 40,
    parttime_factor: typeof persoon.parttime_factor === 'number' ? persoon.parttime_factor : 1,
    in_dienst: inDienst || persoon.in_dienst || null,
    persoon_id: pid,
    van: datum, tot: null,
  });

  // Invariant-bewaking vóór het wegschrijven: beide tijdlijnen moeten geldig
  // zijn (geen overlap, hooguit één lopende periode). Zo kan een bug in de
  // migratie de database nooit corrumperen.
  assertBezettingGeldig(naarHistNieuw, naarSlot);
  assertBezettingGeldig(vanHistNieuw, vanSlot);

  // 3. Update beide stoel-records
  const batch1 = writeBatch(db);
  batch1.set(doc(db, 'radiologen', naarSlot), {
    id: naarSlot,
    code: persoon.code || vanSlot,
    voornaam: persoon.voornaam || '',
    achternaam: persoon.achternaam || '',
    vakantierecht: persoon.vakantierecht ?? 40,
    parttime_factor: persoon.parttime_factor ?? 1,
    in_dienst: inDienst || persoon.in_dienst || null,
    persoon_id: pid,
    bezetting_historie: naarHistNieuw,
  }, { merge: true });
  batch1.set(doc(db, 'radiologen', vanSlot), {
    id: vanSlot,
    code: '', voornaam: '', achternaam: '',
    actief: false,
    in_dienst: null,
    persoon_id: null,
    isSlot: SLOTS.includes(vanSlot),
    bezetting_historie: vanHistNieuw,
  }, { merge: true });
  await batch1.commit();

  // 4. Migreer indelingen vanaf datum. "Schoon overnemen": de doelstoel toont
  // vanaf de ingangsdatum uitsluitend de indeling van de nieuwe bezetter.
  // - Had de waarnemer (vanSlot) op een dag een toewijzing → die verhuist naar
  //   de doelstoel (overschrijft een eventuele rest van de vertrekker).
  // - Had de waarnemer niets, maar de doelstoel wél (rest van de vertrekker) →
  //   die rest wordt gewist. Zo blijven er geen mengvormen staan.
  // Bij een nieuwe (lege) stoel is dit automatisch een no-op.
  const updates = [];
  // roosterInvers: per gewijzigde dag de ORIGINELE waarden van precies de
  // aangeraakte velden, zodat "Terugdraaien" de indeling exact herstelt.
  const roosterInvers = [];
  Object.values(state.indelingMap).forEach(dag => {
    if (!dag?.datum || dag.datum < datum) return;
    const upd = { datum: dag.datum };
    const herstel = {};
    let raak = false;

    const vanToew  = dag.toewijzingen && dag.toewijzingen[vanSlot];
    const naarToew = dag.toewijzingen && (naarSlot in dag.toewijzingen);
    if (vanToew) {
      upd[`toewijzingen.${naarSlot}`] = dag.toewijzingen[vanSlot];
      upd[`toewijzingen.${vanSlot}`] = deleteField();
      herstel[`toewijzingen.${vanSlot}`] = dag.toewijzingen[vanSlot];
      herstel[`toewijzingen.${naarSlot}`] = (naarSlot in dag.toewijzingen) ? dag.toewijzingen[naarSlot] : '__DEL__';
      raak = true;
    } else if (naarToew) {
      upd[`toewijzingen.${naarSlot}`] = deleteField();
      herstel[`toewijzingen.${naarSlot}`] = dag.toewijzingen[naarSlot];
      raak = true;
    }

    const vanVk  = dag.vakantie_v && (vanSlot in dag.vakantie_v);
    const naarVk = dag.vakantie_v && (naarSlot in dag.vakantie_v);
    if (vanVk) {
      upd[`vakantie_v.${naarSlot}`] = dag.vakantie_v[vanSlot];
      upd[`vakantie_v.${vanSlot}`] = deleteField();
      herstel[`vakantie_v.${vanSlot}`] = dag.vakantie_v[vanSlot];
      herstel[`vakantie_v.${naarSlot}`] = (naarSlot in dag.vakantie_v) ? dag.vakantie_v[naarSlot] : '__DEL__';
      raak = true;
    } else if (naarVk) {
      upd[`vakantie_v.${naarSlot}`] = deleteField();
      herstel[`vakantie_v.${naarSlot}`] = dag.vakantie_v[naarSlot];
      raak = true;
    }

    if (dag.dienst) {
      ['dag','avond','nacht'].forEach(s => {
        if (dag.dienst[s] === vanSlot) {
          upd[`dienst.${s}`] = naarSlot;
          herstel[`dienst.${s}`] = vanSlot;
          raak = true;
        }
      });
    }
    if (raak) { updates.push(upd); roosterInvers.push({ datum: dag.datum, herstel }); }
  });

  // Schrijf in chunks van 400 documenten per batch (Firestore-limiet 500).
  for (let i = 0; i < updates.length; i += 400) {
    const chunk = updates.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(u => {
      const datumKey = u.datum;
      const data = { ...u };
      delete data.datum;
      batch.update(doc(db, 'indeling', datumKey), data);
    });
    await batch.commit();
  }

  // 5. Wensen migreren
  const wensUpdates = (state.wensen || []).filter(w => w.radioloog_id === vanSlot && w.datum >= datum);
  const wensenInvers = wensUpdates.map(w => ({ id: w.id, radioloog_id: vanSlot }));
  for (let i = 0; i < wensUpdates.length; i += 400) {
    const chunk = wensUpdates.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach(w => {
      batch.update(doc(db, 'wensen', w.id), { radioloog_id: naarSlot });
    });
    await batch.commit();
  }

  // 6. Gebruikers koppeling van vanSlot naar naarSlot
  const gebruikersUpdates = state.gebruikers.filter(g => g.radioloog_id === vanSlot);
  const gebruikersInvers = gebruikersUpdates.map(g => ({ id: g.id, radioloog_id: vanSlot }));
  for (const g of gebruikersUpdates) {
    await updateDoc(doc(db, 'gebruikers', g.id), { radioloog_id: naarSlot });
  }

  return { roosterInvers, wensenInvers, gebruikersInvers };
}
// Herlaad-hook voor de mutatie-module: na een terugdraaiing wordt het
// mutatie-logboek opnieuw geladen en de Beheer-view opnieuw getekend.
window.__herlaadBeheer = renderGebView;

// ==== App-instellingen handlers =============================================

window.toggleJaaroverzicht = async function() {
  const nieuw = !window.TOON_JAAROVERZICHT;
  try {
    await setDoc(doc(db, 'instellingen', 'ui'), { toon_jaaroverzicht: nieuw }, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
};

// ==== Gegevensbeheer handlers ================================================

window.verwijderVerlopenWensen = async function() {
  const vandaag = vandaagIso();
  try {
    const snap = await getDocs(query(collection(db, 'wensen'), where('datum', '<', vandaag)));
    if (snap.empty) { alert('Geen verlopen wensen gevonden.'); return; }
    if (!confirm(`${snap.size} verlopen wens(en) gevonden (datum vóór ${formatDatum(vandaag, 'kort')}).\n\nVerwijderen?`)) return;
    const BATCH = 400;
    let verwijderd = 0;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = writeBatch(db);
      docs.slice(i, i + BATCH).forEach(d => batch.delete(d.ref));
      await batch.commit();
      verwijderd += Math.min(BATCH, docs.length - i);
    }
    alert(`${verwijderd} verlopen wens(en) verwijderd.`);
  } catch (e) {
    alert('Mislukt: ' + e.message);
  }
};

window.verwijderOudeGegevens = async function() {
  const grens = new Date();
  grens.setFullYear(grens.getFullYear() - 2);
  const grensdatum = grens.toISOString().slice(0, 10);

  const bevestig = confirm(
    `Gegevens ouder dan 2 jaar verwijderen?\n\n` +
    `Alles vóór ${formatDatum(grensdatum, 'kort')} wordt permanent gewist:\n` +
    `• Indeling-data\n• Wensen\n\n` +
    `Dit kan niet ongedaan worden gemaakt.`
  );
  if (!bevestig) return;

  try {
    let totaal = 0;

    // Indeling
    const indelingSnap = await getDocs(query(collection(db, 'indeling'), where('datum', '<', grensdatum)));
    if (!indelingSnap.empty) {
      const docs = indelingSnap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
        totaal += Math.min(400, docs.length - i);
      }
    }

    // Wensen
    const wensenSnap = await getDocs(query(collection(db, 'wensen'), where('datum', '<', grensdatum)));
    if (!wensenSnap.empty) {
      const docs = wensenSnap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
        totaal += Math.min(400, docs.length - i);
      }
    }

    if (totaal === 0) {
      alert('Geen gegevens gevonden ouder dan 2 jaar.');
    } else {
      alert(`${totaal} document(en) verwijderd (indeling + wensen vóór ${formatDatum(grensdatum, 'kort')}).`);
    }
  } catch (e) {
    alert('Mislukt: ' + e.message);
  }
};
