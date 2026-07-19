// Schrijf-acties naar Firestore: cel-toewijzingen, opmerkingen, dienst.
// Bevat de business-logica rondom wens-checks en audit-logging.
//
// v3.28.0 (K1): alle schrijfacties zijn "cel-gescoped" en atomair.
//  - Er wordt NOOIT meer een volledige toewijzingen/cel_opmerkingen-map uit de
//    lokale cache teruggeschreven. In plaats daarvan schrijft setDoc(merge)
//    alléén de eigen sleutel (toewijzingen.<radId>, cel_opmerkingen.<radId>,
//    dienst.dag). Twee beheerders die tegelijk verschillende cellen bewerken
//    kunnen elkaar daardoor niet meer overschrijven (lost update).
//  - De data-write en het bijbehorende wijziging-record gaan in ÉÉN writeBatch:
//    of allebei slagen, of geen van beide. Een roosterwijziging zonder
//    logregel kan dus niet meer ontstaan.
//  - Onafhankelijk hiervan schrijft de server-side Cloud Function
//    (auditIndeling) een onvervalsbaar audit_log-record bij elke wijziging.
import { collection, doc, setDoc, updateDoc, writeBatch, deleteField, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-init.js';
import { state, DAGEN_NL } from './state.js';
import { isoWeekVan, magWijzigen, magAlleWensenZien, vandaagIso, plusDagen, wensMatcht } from './helpers.js';
import { checkCelConflict } from './validatie.js';

// Basis-metadata voor een indeling-doc (idempotent, mag bij elke merge mee)
function _dagMeta(datum) {
  const dagNr = new Date(datum + 'T00:00:00').getDay();
  const dagNlIdx = dagNr === 0 ? 6 : dagNr - 1;
  return { datum, weeknr: isoWeekVan(datum), dag: DAGEN_NL[dagNlIdx] };
}

// Nieuw wijziging-record met vaste basisvelden (zie firestore.rules:
// de create-rule eist exact deze veldenset + serverTimestamp).
function _wijzigingBasis() {
  return {
    uid: state.user.uid,
    email: state.profiel.email,
    wanneer: serverTimestamp(),
  };
}

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
    // Canonieke wens-matching uit helpers.js — zelfde logica als de
    // import-synchronisatie (voorheen drie losse kopieën).
    const breekt = !wensMatcht(verwerkteWens.type, verwerkteWens.voorkeur_code, primaireCode);

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

  // ---- Cel-gescoped payload: alleen de eigen sleutel wordt geraakt ---------
  const docData = {
    ..._dagMeta(datum),
    toewijzingen: { [radId]: codesArr },
  };

  // Cel-opmerking meeschrijven (alleen als parameter is meegegeven)
  const oudeCelOpm = bestaand?.cel_opmerkingen?.[radId] || '';
  let celOpmGewijzigd = false;
  if (typeof opmerking === 'string') {
    // deleteField() binnen een merge verwijdert alléén deze sleutel;
    // opmerkingen van andere radiologen blijven onaangeroerd.
    docData.cel_opmerkingen = { [radId]: opmerking ? opmerking : deleteField() };
    celOpmGewijzigd = (oudeCelOpm !== opmerking);
  }

  // Bepaal of er een echte toewijzingswijziging is t.o.v. vorige waarde
  const oudeCodesArr = bestaand?.toewijzingen?.[radId] || [];
  const isGewijzigd = JSON.stringify(oudeCodesArr) !== JSON.stringify(codesArr);

  try {
    // ---- Atomaire batch: data + wijziging-records in één commit ------------
    const batch = writeBatch(db);
    batch.set(doc(db, 'indeling', datum), docData, { merge: true });

    if (isGewijzigd) {
      // De schrijver is altijd een beheerder/secretariaat (radiologen hebben
      // geen mag_beheer). Een beheerder die toevallig op hetzelfde slot zit
      // (bijv. W3) wijzigt toch de cel van de betrokken radioloog → altijd
      // gezien:false als de datum nabij is.
      const markeerOngelezen = _isDatumNabij(datum) && magWijzigen();
      batch.set(doc(collection(db, 'wijzigingen')), {
        ..._wijzigingBasis(),
        datum,
        radioloog_id: radId,
        van: oudeCodesArr,
        naar: codesArr,
        gezien: markeerOngelezen ? false : true,
      });
    }

    if (celOpmGewijzigd) {
      batch.set(doc(collection(db, 'wijzigingen')), {
        ..._wijzigingBasis(),
        datum,
        radioloog_id: radId,
        veld: 'cel_opmerking',
        van: oudeCelOpm || null,
        naar: opmerking || null,
        gezien: true, // opmerking-wijzigingen hoeven geen bevestiging
      });
    }

    await batch.commit();

    // Auto-verwerk: open wens die nu matcht → automatisch op verwerkt
    if (magAlleWensenZien()) {
      const openWens = state.wensen.find(w =>
        w.datum === datum && w.radioloog_id === radId && (w.status || 'open') === 'open'
      );
      if (openWens) {
        const matcht = wensMatcht(openWens.type, openWens.voorkeur_code, primaireCode);

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

// Drempel: wijzigingen binnen N dagen zijn "nabij" en krijgen gezien:false
const NABIJ_DAGEN = 30;
function _isDatumNabij(datum) {
  const vandaag = vandaagIso();
  const grens = plusDagen(vandaag, NABIJ_DAGEN);
  return datum >= vandaag && datum <= grens;
}

// Alleen cel-opmerking opslaan (zonder code-wijziging).
// Cel-gescoped + atomair (zie header).
export async function slaCelOpmerkingOp(datum, radId, opmerking) {
  if (!magWijzigen()) return;
  const bestaand = state.indelingMap[datum];
  const oude = bestaand?.cel_opmerkingen?.[radId] || '';

  const docData = {
    ..._dagMeta(datum),
    cel_opmerkingen: { [radId]: opmerking ? opmerking : deleteField() },
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'indeling', datum), docData, { merge: true });
    if (oude !== opmerking) {
      batch.set(doc(collection(db, 'wijzigingen')), {
        ..._wijzigingBasis(),
        datum,
        radioloog_id: radId,
        veld: 'cel_opmerking',
        van: oude || null,
        naar: opmerking || null,
        gezien: true,
      });
    }
    await batch.commit();
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
}

// Dag-opmerking opslaan. setDoc(merge) raakt alleen het opmerking-veld en
// maakt het doc aan als het nog niet bestaat (geen aparte not-found-fallback
// meer nodig — dat pad schreef voorheen een compleet doc uit de cache).
export async function slaOpmerkingOp(datum, opmerking) {
  try {
    await setDoc(doc(db, 'indeling', datum), {
      ..._dagMeta(datum),
      opmerking: opmerking || null,
    }, { merge: true });
  } catch (e) {
    alert('Opslaan mislukt: ' + e.message);
  }
}

// Dienst (dag) opslaan. Genest merge-object raakt alléén dienst.dag;
// dienst.avond/nacht en alle andere velden blijven server-side onaangeroerd.
export async function slaDienstOp(datum, radId) {
  const bestaand = state.indelingMap[datum];

  const docData = {
    ..._dagMeta(datum),
    dienst: { dag: radId || null },
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'indeling', datum), docData, { merge: true });
    batch.set(doc(collection(db, 'wijzigingen')), {
      ..._wijzigingBasis(),
      datum,
      veld: 'dienst.dag',
      van: bestaand?.dienst?.dag || null,
      naar: radId || null,
      gezien: true,
    });
    await batch.commit();
  } catch (e) {
    alert('Opslaan dienst mislukt: ' + e.message);
  }
}
