// Statusbalken bovenaan het scherm (v3.34.0).
//
// Eén plek voor de drie balken die zeggen dat er iets met de verbinding is:
//   'verbinding' — grijs:  geen verbinding, je ziet het laatst bekende rooster
//   'opslag'     — oranje: een wijziging is na 10 seconden nog niet bevestigd
//   'luisteraar' — rood:   de databank geeft geen wijzigingen meer door
//
// Tot v3.34.0 bestond alleen de grijze balk, en die verscheen alléén als de
// app zónder verbinding opstartte. Viel de verbinding weg terwijl de app al
// openstond, dan zag je niets.

const KLEUREN = {
  verbinding: '#5f5e5a',
  opslag:     '#b45309',
  luisteraar: '#b91c1c',
};
const VOLGORDE = ['luisteraar', 'opslag', 'verbinding'];

function _houder() {
  let h = document.getElementById('statusbalken');
  if (!h) {
    h = document.createElement('div');
    h.id = 'statusbalken';
    h.style.cssText = 'position:sticky;top:0;z-index:9998;';
    document.body.insertBefore(h, document.body.firstChild);
  }
  return h;
}

/**
 * Toon (of vervang) een balk. `knop` is optioneel: { label, actie }.
 */
export function toonBalk(soort, tekst, knop = null) {
  const h = _houder();
  let balk = document.getElementById('statusbalk-' + soort);
  if (!balk) {
    balk = document.createElement('div');
    balk.id = 'statusbalk-' + soort;
    balk.dataset.soort = soort;
    balk.style.cssText = `background:${KLEUREN[soort] || KLEUREN.verbinding};color:#fff;`
      + 'font-family:system-ui,sans-serif;font-weight:600;font-size:13px;'
      + 'text-align:center;padding:6px 10px;';
    // Vaste volgorde, zodat de ernstigste balk altijd bovenaan staat.
    const na = [...h.children].find(el =>
      VOLGORDE.indexOf(el.dataset.soort) > VOLGORDE.indexOf(soort));
    h.insertBefore(balk, na || null);
  }
  balk.textContent = tekst;
  if (knop) {
    const b = document.createElement('button');
    b.textContent = knop.label;
    b.style.cssText = 'margin-left:10px;padding:2px 10px;border-radius:6px;'
      + 'border:1px solid #fff;background:transparent;color:#fff;font-weight:600;cursor:pointer;';
    b.addEventListener('click', knop.actie);
    balk.appendChild(b);
  }
}

export function verbergBalk(soort) {
  const balk = document.getElementById('statusbalk-' + soort);
  if (balk) balk.remove();
}

export function balkZichtbaar(soort) {
  return !!document.getElementById('statusbalk-' + soort);
}
