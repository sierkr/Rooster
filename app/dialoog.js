// In-app dialoogvensters — vervangt de native alert() / confirm() / prompt().
//
// v3.32.8. Aanleiding: native dialogen zijn niet betrouwbaar. Sommige browsers
// (en ingebouwde browservensters) onderdrukken ze volledig; Chrome en Firefox
// bieden de gebruiker bovendien zelf een vinkje "voorkom dat deze pagina extra
// dialoogvensters maakt" zodra er meerdere achter elkaar komen. Vanaf dat
// moment geeft confirm() zonder enige melding false terug en prompt() null.
// Een import stopte dan geruisloos: je klikte op Importeer en er gebeurde
// niets, hoe vaak je het ook probeerde.
//
// Deze vensters zijn gewone pagina-elementen. Die kan geen enkele browser
// onderdrukken en ze volgen de stijl (en donkere modus) van de app.
//
// Alle drie de functies geven een Promise terug:
//   await meld(titel, tekst)                 -> undefined
//   await bevestig(titel, tekst, ja, nee)    -> true | false
//   await vraagTekst(titel, tekst, opties)   -> string | null  (null = geannuleerd)

let _actief = null; // { el, sluit } van het venster dat nu openstaat

function _sluitActief(waarde) {
  if (!_actief) return;
  const { el, klaar, toetsHandler } = _actief;
  _actief = null;
  document.removeEventListener('keydown', toetsHandler, true);
  if (el && el.parentNode) el.parentNode.removeChild(el);
  klaar(waarde);
}

// Bouwt het venster. `velden` is de HTML tussen tekst en knoppen (mag leeg).
// `knoppen` is een lijst { label, waarde, primair }.
// `leesWaarde` mag de teruggegeven waarde bepalen op basis van het venster.
function _toon({ titel, tekst, veldHtml = '', knoppen, leesWaarde = null }) {
  return new Promise((klaar) => {
    // Staat er al een venster open, sluit dat dan af als "geannuleerd".
    if (_actief) _sluitActief(null);

    const bg = document.createElement('div');
    bg.className = 'dlg-bg';
    bg.setAttribute('role', 'dialog');
    bg.setAttribute('aria-modal', 'true');

    const veilig = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    bg.innerHTML = `
      <div class="dlg">
        <p class="dlg-title">${veilig(titel)}</p>
        <p class="dlg-tekst">${veilig(tekst)}</p>
        ${veldHtml}
        <div class="dlg-knoppen">
          ${knoppen.map((k, i) => `
            <button class="btn ${k.primair ? 'btn-primary' : ''}" data-dlg-knop="${i}">${veilig(k.label)}</button>
          `).join('')}
        </div>
      </div>`;

    const toetsHandler = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        _sluitActief(null);
      } else if (ev.key === 'Enter') {
        const primair = knoppen.findIndex(k => k.primair);
        if (primair >= 0) {
          ev.preventDefault();
          _kies(primair);
        }
      }
    };

    function _kies(i) {
      const knop = knoppen[i];
      const waarde = leesWaarde ? leesWaarde(bg, knop) : knop.waarde;
      _sluitActief(waarde);
    }

    bg.querySelectorAll('[data-dlg-knop]').forEach(btn => {
      btn.addEventListener('click', () => _kies(Number(btn.dataset.dlgKnop)));
    });

    // Klik náást het venster telt als annuleren — net als het kruisje elders
    // in de app. Klikken ín het venster mag daar niet doorheen lekken.
    bg.addEventListener('click', (ev) => { if (ev.target === bg) _sluitActief(null); });

    document.body.appendChild(bg);
    document.addEventListener('keydown', toetsHandler, true);
    _actief = { el: bg, klaar, toetsHandler };

    // Focus: eerst een invoerveld, anders de primaire knop.
    const veld = bg.querySelector('[data-dlg-veld]');
    const primaireKnop = bg.querySelector('.btn-primary[data-dlg-knop]');
    setTimeout(() => { (veld || primaireKnop)?.focus(); }, 30);
  });
}

/** Mededeling met één knop. Vervangt alert(). */
export function meld(titel, tekst, knopLabel = 'Sluiten') {
  return _toon({
    titel, tekst,
    knoppen: [{ label: knopLabel, waarde: undefined, primair: true }],
  }).then(() => undefined);
}

/** Ja/nee-vraag. Vervangt confirm(). Geeft true bij bevestigen. */
export function bevestig(titel, tekst, jaLabel = 'Doorgaan', neeLabel = 'Annuleren') {
  return _toon({
    titel, tekst,
    knoppen: [
      { label: neeLabel, waarde: false },
      { label: jaLabel,  waarde: true, primair: true },
    ],
  }).then(v => v === true);
}

/**
 * Vraagt om tekst. Vervangt prompt(). Geeft null bij annuleren of leeg.
 * opties: { wachtwoord: true } toont een wachtwoordveld.
 */
export function vraagTekst(titel, tekst, opties = {}) {
  const type = opties.wachtwoord ? 'password' : 'text';
  const veldHtml = `
    <input class="input" data-dlg-veld type="${type}"
      autocomplete="${opties.wachtwoord ? 'new-password' : 'off'}"
      style="width: 100%; margin-bottom: 1rem;" />`;
  return _toon({
    titel, tekst, veldHtml,
    knoppen: [
      { label: opties.neeLabel || 'Annuleren', waarde: null },
      { label: opties.jaLabel  || 'OK',        waarde: true, primair: true },
    ],
    leesWaarde: (el, knop) => {
      if (knop.waarde !== true) return null;
      const v = el.querySelector('[data-dlg-veld]')?.value ?? '';
      return v.trim() ? v : null;
    },
  });
}
