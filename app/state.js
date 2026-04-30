// Globale app-state. Deze wordt door alle modules gedeeld via een named import.
// Mutatie gebeurt direct op het object (state.x = y); bij een wijziging moet
// de relevante render-functie zelf gerenderd worden door de aanroeper.
export const state = {
  user: null,             // Firebase User
  profiel: null,          // Document uit gebruikers/
  radiologen: [],
  functies: [],
  besprekingen: [],
  indelingMap: {},        // datum (ISO) -> indeling-doc
  validatieRegels: [],    // array van regels
  wensen: [],             // array van wensen-documenten
  vakantieRankings: [],   // array van vakantie_rankings-documenten
  vakToonBeheerKolommen: false, // X/Min/Rank kolommen tonen in Vakantie-tab
  huidigeRadId: null,
  // weekMaandag = ISO-string van de maandag van de huidige week.
  // Vervangt het oude state.huidigeWeek (nummer 1-53) zodat de agenda
  // vloeiend over jaargrenzen werkt. Wordt bij boot gezet op maandag van vandaag.
  weekMaandag: null,
  huidigeDatum: null,
  huidigeView: 'beh',     // start altijd op Overzicht (= Beheer-view)
  toonWeekRads: false,    // W5..W1 zichtbaar in beheer-raster?
  unsubscribers: [],      // voor realtime listeners
  gebruikers: [],
  // Activiteit-tab
  actModus: 'aantal',     // 'aantal' | 'ratio' | 'verdeling'
  actPeriode: 'jaar',     // 'jaar' | 'q1'..'q4' | 'maand' | 'custom'
  actVanaf: '',
  actTot: '',
  actInvallers: false,    // W-slots zichtbaar in matrix
  actUitgeklapt: {},      // { 'W': true } - hoofdfuncties die uitgeklapt staan
  // Excel-import
  importPreview: null,
  importBezig: false,
  importJaar: '',         // '' = alle jaren in bestand, anders bv '2026'
};

// ==== Constants ==============================================================

export const VASTE_RAD_IDS = ['L', 'P', 'V', 'F', 'K', 'H', 'S', 'J'];
export const SLOTS         = ['W5', 'W4', 'W3', 'W2', 'W1'];
export const DAGEN_NL      = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
export const DAGEN_LANG    = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
export const MAANDEN       = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

// E-mailadres van de hoofdbeheerder dat altijd de rol "beheerder" houdt en
// niet via de UI gewijzigd kan worden.
export const VASTE_BEHEERDER_EMAIL = 'sierkr@gmail.com';

// Activiteit-tab — hoofdfuncties met varianten en aggregatiegroepen.
// Volgorde komt uit Excel-Inzet sheet.
export const HOOFD_FUNCTIES = [
  { letter: 'K', label: 'Cursus',           varianten: [] },
  { letter: 'P', label: 'Parttime',         varianten: ['4P'] },
  { letter: 'Q', label: 'Quarantaine',      varianten: [] },
  { letter: 'R', label: 'Reserve',          varianten: [] },
  { letter: 'V', label: 'Vakantie',         varianten: [] },
  { letter: 'Z', label: 'Ziek',             varianten: [] },
  { letter: 'T', label: 'Reserve Transfer', varianten: [] },
  { letter: 'A', label: 'Administratie',    varianten: ['5A'] },
  { letter: 'W', label: 'Weekradioloog',    varianten: ['.WB','.WE','.WM','3W','4W','5W'] },
  { letter: 'B', label: 'Bucky/Echo',       varianten: ['.BW','3B','4B','5B'] },
  { letter: 'E', label: 'Echo/Bucky',       varianten: ['.EW','3E','4E','5E'] },
  { letter: 'M', label: 'Mammo',            varianten: ['.MW','3M','4M','5M'] },
  { letter: 'D', label: 'DSI',              varianten: ['.DW','4D','5D'] },
  { letter: 'S', label: 'Saendelft',        varianten: ['3S','4S','5S'] },
  { letter: 'O', label: 'Omloop',           varianten: ['.O','3O','4O','5O'] },
  { letter: 'X', label: 'Werkdag',          varianten: [] },
];

export const AFWEZIG_CODES = ['V', 'Z', 'K', 'Q'];
export const WERK_CODES    = ['B', 'E', 'M', 'D', 'O', 'C', 'S', 'A', 'X'];
