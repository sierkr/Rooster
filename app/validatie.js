// Validatie-engine: past actieve validatieregels toe op een week.
import { state, VASTE_RAD_IDS, SLOTS, DAGEN_NL } from './state.js';
import { datumsVanWeek, hoofdLetterCode, toewijzingVoor } from './helpers.js';

/**
 * Valideer alle dagen in een week.
 * @param {string|number} week ISO-string van maandag óf legacy weeknummer.
 * Returnt: array van conflicten { datum, radId, codes, regelId, ernst, bericht }
 */
export function valideerWeek(week) {
  const conflicten = [];
  const datums = datumsVanWeek(week);
  const actieveRegels = state.validatieRegels.filter(r => r.actief !== false);

  datums.forEach(datum => {
    const dag = state.indelingMap[datum];
    if (!dag) return;
    const d = new Date(datum + 'T00:00:00');
    const dagNl = DAGEN_NL[d.getDay() === 0 ? 6 : d.getDay() - 1];
    const isWeekend = dagNl === 'za' || dagNl === 'zo';

    // Voor elke radioloog: check zijn/haar codes
    const alleRads = [...VASTE_RAD_IDS, ...SLOTS];
    alleRads.forEach(radId => {
      const codes = toewijzingVoor(datum, radId);
      if (!codes.length) return;

      const hoofd = codes.map(hoofdLetterCode);

      actieveRegels.forEach(regel => {
        if (regel.type === 'limiet' && codes.length > (regel.max_codes || 2)) {
          conflicten.push({
            datum, dagNl, radId, codes, regelId: regel.id,
            ernst: regel.ernst, bericht: regel.bericht
          });
        }
        if (regel.type === 'conflict' && regel.code_blokkerend) {
          if (hoofd.includes(regel.code_blokkerend) && codes.length > 1) {
            conflicten.push({
              datum, dagNl, radId, codes, regelId: regel.id,
              ernst: regel.ernst, bericht: regel.bericht
            });
          }
        }
        if (regel.type === 'context' && regel.dagen?.includes(dagNl)) {
          if (hoofd.some(c => regel.codes_ongebruikelijk?.includes(c))) {
            conflicten.push({
              datum, dagNl, radId, codes, regelId: regel.id,
              ernst: regel.ernst, bericht: regel.bericht
            });
          }
        }
        if (regel.type === 'context' && regel.feestdagen_2026?.includes(datum)) {
          if (hoofd.some(c => regel.codes_ongebruikelijk?.includes(c))) {
            conflicten.push({
              datum, dagNl, radId, codes, regelId: regel.id,
              ernst: regel.ernst, bericht: `${regel.bericht} (${datum})`
            });
          }
        }
      });
    });

    // Per-dag regels: bezetting & uniciteit
    actieveRegels.forEach(regel => {
      if (regel.type === 'bezetting' && regel.dag === dagNl && !isWeekend) {
        let aantalAanwezig = 0;
        VASTE_RAD_IDS.forEach(radId => {
          const codes = toewijzingVoor(datum, radId);
          if (codes.some(c => hoofdLetterCode(c) === regel.code || c === regel.code)) {
            aantalAanwezig += 1;
          }
        });
        if (aantalAanwezig < regel.aantal) {
          conflicten.push({
            datum, dagNl, radId: null, codes: [regel.code],
            regelId: regel.id, ernst: regel.ernst,
            bericht: `${regel.bericht} (nu ${aantalAanwezig})`
          });
        }
      }

      if (regel.type === 'uniciteit') {
        const counts = {};
        VASTE_RAD_IDS.forEach(radId => {
          const codes = toewijzingVoor(datum, radId);
          codes.forEach(c => {
            const h = hoofdLetterCode(c);
            if (regel.codes_uniek?.includes(h)) {
              counts[h] = (counts[h] || 0) + 1;
            }
          });
        });
        Object.entries(counts).forEach(([code, n]) => {
          if (n > 1) {
            conflicten.push({
              datum, dagNl, radId: null, codes: [code],
              regelId: regel.id, ernst: regel.ernst,
              bericht: `${regel.bericht} (${n}× ${code} op ${datum})`
            });
          }
        });
      }
    });
  });

  return conflicten;
}

export function conflictenVoorCel(week, datum, radId) {
  const alle = valideerWeek(week);
  return alle.filter(c => c.datum === datum && (c.radId === radId || c.radId === null));
}

// Check of een specifieke nieuwe celwaarde een conflict zou geven
export function checkCelConflict(datum, radId, nieuweCodes) {
  const conflicten = [];
  const actieveRegels = state.validatieRegels.filter(r => r.actief !== false);
  const hoofd = nieuweCodes.map(hoofdLetterCode);

  actieveRegels.forEach(regel => {
    if (regel.type === 'limiet' && nieuweCodes.length > (regel.max_codes || 2)) {
      conflicten.push({ ernst: regel.ernst, bericht: regel.bericht });
    }
    if (regel.type === 'conflict' && regel.code_blokkerend) {
      if (hoofd.includes(regel.code_blokkerend) && nieuweCodes.length > 1) {
        conflicten.push({ ernst: regel.ernst, bericht: regel.bericht });
      }
    }
  });

  return conflicten;
}
