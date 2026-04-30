// Schrijf-acties naar Firestore: cel-toewijzingen, opmerkingen, dienst.
// Bevat de business-logica rondom wens-checks en audit-logging.
import { collection, doc, setDoc, updateDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';
import { state, DAGEN_NL } from './state.js';
import { isoWeekVan, hoofdLetterCode, magWijzigen, magAlleWensenZien } from './helpers.js';
import { checkCelConflict } from './validatie.js';

// Schrijf cel-toewijzing + (optioneel) cel-opmerking. Ook check op
// blokkerende regels en verwerkte wensen.
//
// `code` mag een string zijn (één code) of een array van codes (max 2).
// Lege string of lege array betekent: cel leegmaken.
export async function slaToewijzingOp(datum, radId, code, opmerking) {
  // Normaliseer naar array
  const codesArr = Array.isArray(code)
    ? code.filter(Boolean)
    : (code ? [code] : []);
  // De "primaire" code (voor wens-matching) is de eerste in de array
  const primaireCode = codesArr[0] || '';

  const bestaand = state.indelingMap[datum];
  const toewijzingen = { ...(bestaand?.toewijzingen || {}) };
  toewijzingen[radId] = codesArr;

  const dagNr = new Date(datum + 'T00:00:00').getDay();
  const dagNlIdx = dagNr === 0 ? 6 : dagNr - 1;

  // Pre-check: zou deze wijziging een blokkerende regel triggeren?
  const conflicten = checkCelConflict(datum, radId, codesArr);
  const blokkades = conflicten.filter(c => c.ernst === 'blokkeren');
  if (blokkades.length > 0) {
    const ok = confirm(
      `Deze wijziging veroorzaakt ${blokkades.length} blokkerend conflict:\n\n` +
      blokkades.map(c => '• ' + c.bericht).join('\n') +
      '\n\nToch doorgaan?'
    );
    if (!ok) return;
  }

  // Check: breekt deze wijziging een verwerkte wens?
  const verwerkteWens = state.wensen.find(w =>
    w.datum === datum && w.radioloog_id === radId && (w.status || 'open') === 'verwerkt'
  );
  if (verwerkteWens) {
    const nieuweHoofd = hoofdLetterCode(primaireCode);
    let breekt = false;
    if (verwerkteWens.type === 'vakantie') breekt = nieuweHoofd !== 'V';
    else if (verwerkteWens.type === 'niet_beschikbaar') breekt = primaireCode && !['V','Z','K','Q'].includes(nieuweHoofd);
    else if (verwerkteWens.type === 'voorkeur') breekt = nieuweHoofd !== verwerkteWens.voorkeur_code;

    if (breekt) {
      const regel = state.validatieRegels.find(r => r.id === 'wijziging-na-verwerkte-wens');
      const ernst = regel ? (regel.actief !== false ? regel.ernst : null) : 'waarschuwing';
      if (ernst === 'blokkeren') {
        alert(`Geblokkeerd: deze cel hoort bij een verwerkte wens. Heropen de wens via de Wensen-tab eerst.`);
        return;
      } else if (ernst === 'waarschuwing') {
        const ok = confirm(`Let op: voor deze cel is een verwerkte wens. Door deze wijziging klopt de wens niet meer.\n\nToch doorgaan?\n(De wens-status wordt teruggezet naar 'open'.)`);
        if (!ok) return;
        try {
          await updateDoc(doc(db, 'wensen', verwerkteWens.id), {
            status: 'open', verwerkt_op: null, verwerkt_door: null,
          });
        } catch (e) { /* niet kritiek */ }
      }
    }
  }

  const docData = {
    datum,
    weeknr: isoWeekVan(datum),
    dag: DAGEN_NL[dagNlIdx],
    toewijzingen,
    dienst: bestaand?.dienst || {},
    bespreking: bestaand?.bespreking || null,
    interventie: bestaand?.interventie || null,
    opmerking: bestaand?.opmerking || null,
  };

  // Cel-opmerking meeschrijven (alleen als parameter is meegegeven)
  const oudeCelOpm = bestaand?.cel_opmerkingen?.[radId] || '';
  let celOpmGewijzigd = false;
  if (typeof opmerking === 'string') {
    const nieuw = { ...(bestaand?.cel_opmerkingen || {}) };
    if (opmerking) nieuw[radId] = opmerking;
    else delete nieuw[radId];
    docData.cel_opmerkingen = nieuw;
    celOpmGewijzigd = (oudeCelOpm !== opmerking);
  }

  try {
    await setDoc(doc(db, 'indeling', datum), docData, { merge: true });
    await addDoc(collection(db, 'wijzigingen'), {
      uid: state.user.uid,
      email: state.profiel.email,
      datum,
      radioloog_id: radId,
      van: bestaand?.toewijzingen?.[radId] || [],
      naar: codesArr,
      wanneer: serverTimestamp(),
    });
    if (celOpmGewijzigd) {
      await addDoc(collection(db, 'wijzigingen'), {
        uid: state.user.uid,
        email: state.profiel.email,
        datum,
        radioloog_id: radId,
        veld: 'cel_opmerking',
        van: oudeCelOpm || null,
        naar: opmerking || null,
        wanneer: serverTimestamp(),
      });
    }

    // Auto-verwerk: open wens die nu matcht → automatisch op verwerkt
    if (magAlleWensenZien()) {
      const openWens = state.wensen.find(w =>
        w.datum === datum && w.radioloog_id === radId && (w.status || 'open') === 'open'
      );
      if (openWens) {
        const nieuweHoofd = hoofdLetterCode(primaireCode);
        let matcht = false;
        if (openWens.type === 'vakantie') matcht = nieuweHoofd === 'V';
        else if (openWens.type === 'niet_beschikbaar') matcht = !primaireCode || ['V','Z','K','Q'].includes(nieuweHoofd);
        else if (openWens.type === 'voorkeur') matcht = nieuweHoofd === openWens.voorkeur_code;

        if (matcht) {
          try {
            await updateDoc(doc(db, 'wensen', openWens.id), {
              status: 'verwerkt',
              verwerkt_op: serverTimestamp(),
              verwerkt_door: state.user.uid,
              toelichting: null,
            });
          } catch (e) { /* niet kritiek */ }
        }
      }
    }
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
}

// Alleen cel-opmerking opslaan (zonder code-wijziging)
export async function slaCelOpmerkingOp(datum, radId, opmerking) {
  if (!magWijzigen()) return;
  const bestaand = state.indelingMap[datum];
  const oude = bestaand?.cel_opmerkingen?.[radId] || '';
  const nieuw = { ...(bestaand?.cel_opmerkingen || {}) };
  if (opmerking) nieuw[radId] = opmerking;
  else delete nieuw[radId];

  const dagNr = new Date(datum + 'T00:00:00').getDay();
  const dagNlIdx = dagNr === 0 ? 6 : dagNr - 1;

  const docData = {
    datum,
    weeknr: isoWeekVan(datum),
    dag: DAGEN_NL[dagNlIdx],
    toewijzingen: bestaand?.toewijzingen || {},
    dienst: bestaand?.dienst || {},
    bespreking: bestaand?.bespreking || null,
    interventie: bestaand?.interventie || null,
    opmerking: bestaand?.opmerking || null,
    cel_opmerkingen: nieuw,
  };

  try {
    await setDoc(doc(db, 'indeling', datum), docData, { merge: true });
    if (oude !== opmerking) {
      await addDoc(collection(db, 'wijzigingen'), {
        uid: state.user.uid,
        email: state.profiel.email,
        datum,
        radioloog_id: radId,
        veld: 'cel_opmerking',
        van: oude || null,
        naar: opmerking || null,
        wanneer: serverTimestamp(),
      });
    }
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
}

export async function slaOpmerkingOp(datum, opmerking) {
  try {
    await updateDoc(doc(db, 'indeling', datum), {
      opmerking: opmerking || null,
    });
  } catch (e) {
    if (e.code === 'not-found') {
      const dagNr = new Date(datum + 'T00:00:00').getDay();
      const dagNlIdx = dagNr === 0 ? 6 : dagNr - 1;
      await setDoc(doc(db, 'indeling', datum), {
        datum, weeknr: isoWeekVan(datum), dag: DAGEN_NL[dagNlIdx],
        toewijzingen: {}, dienst: {}, bespreking: null, interventie: null,
        opmerking: opmerking || null,
      });
    } else {
      alert('Opslaan mislukt: ' + e.message);
    }
  }
}

export async function slaDienstOp(datum, radId) {
  const bestaand = state.indelingMap[datum];
  const dagNr = new Date(datum + 'T00:00:00').getDay();
  const dagNlIdx = dagNr === 0 ? 6 : dagNr - 1;

  const docData = {
    datum,
    weeknr: isoWeekVan(datum),
    dag: DAGEN_NL[dagNlIdx],
    toewijzingen: bestaand?.toewijzingen || {},
    dienst: { ...(bestaand?.dienst || {}), dag: radId || null },
    bespreking: bestaand?.bespreking || null,
    interventie: bestaand?.interventie || null,
    opmerking: bestaand?.opmerking || null,
  };

  try {
    await setDoc(doc(db, 'indeling', datum), docData, { merge: true });
    await addDoc(collection(db, 'wijzigingen'), {
      uid: state.user.uid,
      email: state.profiel.email,
      datum,
      veld: 'dienst.dag',
      van: bestaand?.dienst?.dag || null,
      naar: radId || null,
      wanneer: serverTimestamp(),
    });
  } catch (e) {
    alert('Opslaan dienst mislukt: ' + e.message);
  }
}
