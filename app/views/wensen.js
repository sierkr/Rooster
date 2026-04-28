// Wensen-view: radiologen dienen vakantie/niet-beschikbaar/voorkeur in;
// beheerders verwerken/wijzen af.
import { collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from '../firebase-init.js';
import { state } from '../state.js';
import {
  radiologenMap, functiesMap, vandaagIso, formatDatum,
  toewijzingVoor, hoofdLetterCode, magAlleWensenZien,
} from '../helpers.js';
import { openSheet, closeSheet } from '../sheets.js';

export function renderWenView() {
  const container = document.getElementById('view-wen');
  const eigenRadId = state.profiel?.radioloog_id;
  const isBeheerder = magAlleWensenZien();

  const vandaag = vandaagIso();
  let zichtbaar = state.wensen.filter(w => w.datum >= vandaag);

  let eigen = zichtbaar.filter(w => w.radioloog_id === eigenRadId);
  let anderen = zichtbaar.filter(w => w.radioloog_id !== eigenRadId);

  const sorter = (a, b) => a.datum.localeCompare(b.datum);
  eigen.sort(sorter);
  anderen.sort(sorter);

  let html = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div><p style="font-size: 17px; font-weight: 500; margin: 0;">Wensen</p></div>
        ${eigenRadId ? `<button class="btn btn-primary" onclick="window.nieuweWens()">+ Nieuw</button>` : ''}
      </div>
      ${!eigenRadId && !isBeheerder ? `<p class="muted" style="margin-top:10px;">Je account is niet aan een radioloog gekoppeld. Vraag een beheerder om dit te koppelen.</p>` : ''}
    </div>
  `;

  if (eigenRadId) {
    html += `<div style="margin-top: 1rem;"><div class="summary-label" style="margin-bottom: 6px;">Mijn wensen</div>`;
    if (eigen.length === 0) {
      html += `<div class="empty-state" style="padding: 1rem;">Nog geen wensen ingediend</div>`;
    } else {
      eigen.forEach(w => { html += renderWensCard(w, true); });
    }
    html += `</div>`;
  }

  if (isBeheerder) {
    const open = anderen.filter(w => (w.status || 'open') === 'open');
    const afgehandeld = anderen.filter(w => (w.status || 'open') !== 'open');

    if (open.length > 0) {
      html += `<div style="margin-top: 1.5rem;"><div class="summary-label" style="margin-bottom: 6px;">Open — ${open.length}</div>`;
      open.forEach(w => { html += renderWensCard(w, false); });
      html += `</div>`;
    }
    if (afgehandeld.length > 0) {
      html += `<div style="margin-top: 1.5rem;"><div class="summary-label" style="margin-bottom: 6px;">Afgehandeld</div>`;
      afgehandeld.forEach(w => { html += renderWensCard(w, false); });
      html += `</div>`;
    }
    if (anderen.length === 0) {
      html += `<div style="margin-top: 1.5rem;"><div class="empty-state" style="padding: 1rem;">Geen overige wensen</div></div>`;
    }
  }

  container.innerHTML = html;
}

function renderWensCard(w, eigen) {
  const radsMap = radiologenMap();
  const rad = radsMap[w.radioloog_id];
  const naam = rad ? `${rad.code} · ${rad.achternaam}` : w.radioloog_id;
  const typeLabel = { vakantie: 'Vakantie', niet_beschikbaar: 'Niet beschikbaar', voorkeur: 'Voorkeur' }[w.type] || w.type;
  const typeKleur = { vakantie: 'f-V', niet_beschikbaar: 'f-K', voorkeur: 'f-W' }[w.type] || 'f-V';
  const voorkeur = w.voorkeur_code ? ` → ${w.voorkeur_code}` : '';

  const status = w.status || 'open';
  const isBeheer = magAlleWensenZien();

  const statusBadge = {
    open:      `<span class="status-badge status-open">Open</span>`,
    verwerkt:  `<span class="status-badge status-verwerkt">✓ Verwerkt</span>`,
    afgewezen: `<span class="status-badge status-afgewezen">✗ Afgewezen</span>`,
  }[status] || '';

  const beheerKnoppen = (isBeheer && status === 'open') ? `
    <div style="display: flex; gap: 6px; margin-top: 10px;">
      <button class="btn btn-primary" style="flex: 1; font-size: 12px; padding: 6px;" onclick="event.stopPropagation(); window.wensVerwerk('${w.id}')">Verwerk</button>
      <button class="btn" style="flex: 1; font-size: 12px; padding: 6px;" onclick="event.stopPropagation(); window.wensAfwijs('${w.id}')">Afwijzen</button>
    </div>
  ` : '';

  const heropenKnop = (isBeheer && status !== 'open') ? `
    <button class="btn" style="font-size: 11px; padding: 4px 8px; margin-top: 8px;" onclick="event.stopPropagation(); window.wensHeropen('${w.id}')">Status terug naar open</button>
  ` : '';

  const toelichting = w.toelichting ? `<div class="note" style="margin-top: 6px;">Beheerder: ${w.toelichting}</div>` : '';

  const klikActie = eigen
    ? `onclick="window.bewerkWens('${w.id}')"`
    : (isBeheer ? `onclick="window.springNaarBeheer('${w.datum}')"` : '');
  const cursor = (eigen || isBeheer) ? 'pointer' : 'default';

  return `
    <div class="card card-compact" style="cursor: ${cursor};" ${klikActie}>
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13px; color: #5f5e5a;">${formatDatum(w.datum, 'lang')}</div>
          <div style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
            <span class="badge ${typeKleur}">${typeLabel}${voorkeur}</span>
            ${statusBadge}
          </div>
          ${!eigen ? `<div class="muted" style="margin-top: 4px; font-size: 12px;">${naam}</div>` : ''}
          ${w.opmerking ? `<div class="note" style="margin-top: 6px;">${w.opmerking}</div>` : ''}
          ${toelichting}
        </div>
      </div>
      ${beheerKnoppen}
      ${heropenKnop}
    </div>
  `;
}

function toonWensFormulier(bestaand) {
  const isNieuw = !bestaand;
  const vandaag = vandaagIso();
  const w = bestaand || { datum: vandaag, type: 'vakantie', voorkeur_code: '', opmerking: '' };

  document.getElementById('sheetTitle').textContent = isNieuw ? 'Nieuwe wens' : 'Wens bewerken';
  document.getElementById('sheetSub').textContent = isNieuw ? 'Vul de details in' : formatDatum(w.datum, 'lang');

  const codes = ['W','B','E','M','D','O','S','A','R','V','Z','K'];

  document.getElementById('sheetBody').innerHTML = `
    <div class="form-field">
      <label class="form-label">Datum</label>
      <input type="date" class="input" id="wDatum" value="${w.datum}" min="${vandaag}">
    </div>
    <div class="form-field">
      <label class="form-label">Type</label>
      <select class="select" id="wType" onchange="window.wensTypeWissel()">
        <option value="vakantie" ${w.type==='vakantie'?'selected':''}>Vakantie</option>
        <option value="niet_beschikbaar" ${w.type==='niet_beschikbaar'?'selected':''}>Niet beschikbaar (cursus, congres)</option>
        <option value="voorkeur" ${w.type==='voorkeur'?'selected':''}>Voorkeur voor functie</option>
      </select>
    </div>
    <div class="form-field" id="wVoorkeurVeld" style="${w.type==='voorkeur'?'':'display:none;'}">
      <label class="form-label">Voorkeursfunctie</label>
      <select class="select" id="wVoorkeur">
        <option value="">— kies —</option>
        ${codes.map(c => {
          const f = functiesMap()[c];
          const naam = f ? f.naam.split('/')[0] : c;
          return `<option value="${c}" ${w.voorkeur_code===c?'selected':''}>${c} · ${naam}</option>`;
        }).join('')}
      </select>
    </div>
    <div class="form-field">
      <label class="form-label">Opmerking (optioneel)</label>
      <textarea class="input" id="wOpmerking" rows="2">${(w.opmerking||'').replace(/</g,'&lt;')}</textarea>
    </div>
    <div style="display: flex; gap: 8px; margin-top: 1rem;">
      ${!isNieuw ? `<button class="btn" style="color: #501313;" onclick="window.verwijderWens('${bestaand.id}')">Verwijder</button>` : ''}
      <button class="btn" style="flex: 1;" onclick="window.closeSheet()">Annuleren</button>
      <button class="btn btn-primary" style="flex: 1;" onclick="window.opslaanWens('${bestaand?.id || ''}')">${isNieuw?'Indienen':'Opslaan'}</button>
    </div>
  `;
  openSheet();
}

function checkWensTegenRooster(w) {
  const codes = toewijzingVoor(w.datum, w.radioloog_id);
  const huidig = codes[0] || '';
  const huidigHoofd = hoofdLetterCode(huidig);

  if (w.type === 'vakantie') {
    return { ok: huidigHoofd === 'V', huidig: huidig || '(leeg)', gewenst: 'V (vakantie)' };
  }
  if (w.type === 'niet_beschikbaar') {
    const ok = !huidig || ['V','Z','K','Q'].includes(huidigHoofd);
    return { ok, huidig: huidig || '(leeg)', gewenst: 'V/Z/K/Q of leeg' };
  }
  if (w.type === 'voorkeur') {
    return { ok: huidigHoofd === w.voorkeur_code, huidig: huidig || '(leeg)', gewenst: w.voorkeur_code };
  }
  return { ok: false, huidig: huidig || '(leeg)', gewenst: '?' };
}

// ==== Handlers ===============================================================

window.nieuweWens = function() {
  toonWensFormulier(null);
};

window.bewerkWens = function(wensId) {
  const w = state.wensen.find(x => x.id === wensId);
  if (!w) return;
  const status = w.status || 'open';
  if (status !== 'open') {
    alert(`Deze wens is al ${status === 'verwerkt' ? 'verwerkt' : 'afgewezen'} en kan niet meer worden gewijzigd. Dien eventueel een nieuwe wens in.`);
    return;
  }
  toonWensFormulier(w);
};

window.wensTypeWissel = function() {
  const t = document.getElementById('wType').value;
  document.getElementById('wVoorkeurVeld').style.display = (t === 'voorkeur') ? 'block' : 'none';
};

window.opslaanWens = async function(id) {
  const datum = document.getElementById('wDatum').value;
  const type = document.getElementById('wType').value;
  const voorkeur_code = document.getElementById('wVoorkeur')?.value || null;
  const opmerking = document.getElementById('wOpmerking').value.trim() || null;

  if (!datum) { alert('Datum is verplicht'); return; }
  if (datum < vandaagIso()) { alert('Datum moet in de toekomst liggen'); return; }
  if (type === 'voorkeur' && !voorkeur_code) { alert('Kies een voorkeursfunctie'); return; }

  const data = {
    radioloog_id: state.profiel.radioloog_id,
    datum, type,
    voorkeur_code: type === 'voorkeur' ? voorkeur_code : null,
    opmerking,
  };

  try {
    if (id) {
      await updateDoc(doc(db, 'wensen', id), data);
    } else {
      data.ingediend_op = serverTimestamp();
      await addDoc(collection(db, 'wensen'), data);
    }
    closeSheet();
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
};

window.verwijderWens = async function(id) {
  if (!confirm('Wens verwijderen?')) return;
  try {
    await deleteDoc(doc(db, 'wensen', id));
    closeSheet();
  } catch (e) {
    alert('Verwijderen mislukt: ' + e.message);
  }
};

window.wensVerwerk = async function(id) {
  const w = state.wensen.find(x => x.id === id);
  if (!w) return;
  const check = checkWensTegenRooster(w);
  if (!check.ok) {
    alert(`Kan niet verwerken.\n\nCel staat op: ${check.huidig}\nWens vraagt: ${check.gewenst}\n\nPas eerst de planning aan in de Overzicht-tab, of wijs de wens af.`);
    return;
  }
  try {
    await updateDoc(doc(db, 'wensen', id), {
      status: 'verwerkt',
      verwerkt_op: serverTimestamp(),
      verwerkt_door: state.user.uid,
      toelichting: null,
    });
  } catch (e) {
    alert('Verwerken mislukt: ' + e.message);
  }
};

window.wensAfwijs = async function(id) {
  const reden = prompt('Optionele toelichting voor de radioloog (mag leeg):', '');
  if (reden === null) return;
  try {
    await updateDoc(doc(db, 'wensen', id), {
      status: 'afgewezen',
      verwerkt_op: serverTimestamp(),
      verwerkt_door: state.user.uid,
      toelichting: reden.trim() || null,
    });
  } catch (e) {
    alert('Afwijzen mislukt: ' + e.message);
  }
};

window.wensHeropen = async function(id) {
  if (!confirm('Status terugzetten naar open?')) return;
  try {
    await updateDoc(doc(db, 'wensen', id), {
      status: 'open', verwerkt_op: null, verwerkt_door: null, toelichting: null,
    });
  } catch (e) {
    alert('Mislukt: ' + e.message);
  }
};
