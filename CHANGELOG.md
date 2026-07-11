## v3.27.123 — Waarnemer-schuifje weerspiegelt de echte bezetting + datumkiezer

### Fix
- **Schuifje volgt nu de werkelijke bezetting.** Het waarnemer-schuifje in Beheer
  las voorheen de rauwe `actief`-vlag. Die werd bij een **→ Vast** met een datum in
  de toekomst meteen op `false` gezet, waardoor het schuifje "uit" stond terwijl de
  waarnemer nog gewoon actief was (bv. GJG die pas per 1-1-2027 vast in dienst komt).
  Het schuifje kijkt nu naar de lopende **óf geplande** bezetter (`bezetting_historie`)
  en staat "aan" zolang er een waarnemer lopend of gepland is. Achter de schermen
  bleef GJG altijd al correct waarnemer tot de ingangsdatum — nu klopt ook de weergave.

### Nieuw
- **Datumkiezer bij activeren én stoppen.** Tik het schuifje om een waarnemer te
  **activeren** (code + achternaam + "actief vanaf"-datum) of te laten **stoppen**
  ("geen waarnemer meer vanaf"-datum). Zo bepaal jij de datum — een waarnemer die
  woensdag begint, of volgende maand stopt, kan zonder dat de app een datum oplegt.
  De rij toont bij een toekomstige start "(vanaf …)" en bij een geplande einddatum
  "(t/m …)".
- **"Waarnemers opslaan" is nu rename-only.** De bulk-opslaanknop werkt uitsluitend
  de code/achternaam bij van de reeds lopende/geplande waarnemer. Hij maakt,
  verplaatst of sluit geen periodes meer af (dat gaat via het schuifje + datumkiezer).
  Hiermee vervalt de kans dat bulk-opslaan een geplande → Vast overschreef of een
  dubbele boeking (waarnemer op W-slot én vaste stoel) veroorzaakte.

---

## v3.27.122 — Backfill bestaande wijzigingen + Mutaties-blad read-only

### Nieuw
- **Backfill "Bestaande wijzigingen registreren".** Knop in de kaart "Recente
  stoel-wijzigingen". Reconstrueert voor elke overgang in de stoel-tijdlijnen die
  nog geen logboek-record heeft, alsnog een mutatie-record met de gereconstrueerde
  situatie van ervóór — zodat óók wijzigingen die vóór het logboek ontstonden
  (zoals een bestaande BL→GJG-opvolging) terug te draaien zijn. Idempotent
  (sleutel = stoel + ingangsdatum). Zulke records zijn gemarkeerd als
  "alleen tijdlijn": terugdraaien herstelt de stoel-tijdlijn, maar zet eventueel
  eerder verplaatste roosterdata van een oude → Vast NIET automatisch terug —
  dat staat ook in de terugdraai-bevestiging.

### Fix
- **export.js — Mutaties-blad read-only + info-banner.** Het blad "Mutaties" is nu
  beschermd (read-only) en heeft bovenaan een duidelijke banner: "Alleen ter info —
  wijzigingen doen in de app, niet in dit blad." Selecteren/kopiëren blijft mogelijk;
  het blad wordt bij elke export opnieuw opgebouwd en bij import genegeerd.

---

## v3.27.121 — Stoel-koppeling alleen voor radioloog/beheerder

### Waarom
Technici en secretariaat kunnen nooit een stoel bezetten, maar het veld
"Gekoppeld aan" werd toch getoond bij die rollen.

### Fix
- **gebruikers.js** — het veld "Gekoppeld aan" verschijnt nu alleen als de rol
  radioloog of beheerder is, en schakelt live mee als je de rol in het scherm
  wijzigt (bij zowel "Nieuwe gebruiker" als "Rol wijzigen"). Als vangnet wordt de
  koppeling bij opslaan hard op "geen" gezet zodra de rol geen stoel-rol is, zodat
  een technicus/secretariaat nooit een verweesde stoel-koppeling houdt.

---

## v3.27.120 — Round-trip-fix, verschil-diagnose en tab-persistentie

### Waarom
Een export → (ongewijzigd) import toonde toch "14 toewijzingen gewijzigd". Analyse
van het geëxporteerde bestand liet zien dat de celwaarden schoon round-trippen; de
verschillen kwamen van kolom-lidmaatschap: stoelen die in Firestore nog een
toewijzing hebben maar geen bezetter (bv. een leeggeraakte waarnemer-plek) kregen
géén exportkolom, waardoor die dagen bij re-import als "gewijzigd" telden.

### Fixes
- **export.js — round-trip sluitend.** De export neemt nu ook een kolom op voor
  elke stoel die dat jaar een niet-lege toewijzing heeft maar geen bezetter/kolom
  kreeg (kolomkop = laatst bekende code of stoel-id). Zo valt geen ingevulde dag
  meer weg en toont een verse re-import geen spookwijzigingen meer.
- **import.js + gebruikers.js — "Toon verschillen".** De import-preview heeft een
  uitklap die exact opsomt welke cellen afwijken (datum · stoel · oud → nieuw),
  zodat een resterend verschil altijd herleidbaar en controleerbaar is.
- **gebruikers.js — tab-persistentie.** De Beheer-view onthoudt de actieve
  (sub-)tab. Na het kiezen van een importbestand blijf je op Control → Overige
  instellingen staan i.p.v. terug te springen naar Stoel bezetting.

---

## v3.27.119 — Stoel-wijzigingen: inzichtelijk, terugdraaibaar, met impact-preview

### Waarom
Vervolg op 3.27.118. Wens: elke ingreep op een stoel — vervanging (Wissel),
vertrek/pensioen en vast-in-dienst (→ Vast) — moet zichtbaar én terug te draaien
zijn, en de planner moet vooraf de gevolgen zien wanneer er al gepland is.

### Nieuw
- **Terugdraaien van elke stoel-ingreep.** Nieuw module `bezetting-mutaties.js`
  + collectie `bezetting_mutaties`. Elke Wissel, Vertrek, → Vast en Nieuwe stoel
  legt vóór opslaan een record vast met een volledige snapshot van de betrokken
  stoel-documenten, en bij → Vast bovendien de exacte inverse van de verplaatste
  roosterdata (alleen de gewijzigde cellen: toewijzingen, vakantie-V, diensten,
  wensen, gebruikerskoppeling). In de Beheer-tab staat "Recente stoel-wijzigingen"
  met per ingreep een **Terugdraaien**-knop. Terugdraaien herstelt de snapshots
  én de roosterdata, gevalideerd met de invariant-controle vóór opslaan. Alleen
  de nieuwste ingreep per stoel is direct terug te draaien (undo-stack-volgorde).
- **Tijdlijn-weergave.** Per stoel én per persoon (bv. GJG over meerdere stoelen
  heen) een chronologisch overzicht van alle periodes: code, achternaam, van–tot,
  en status (lopend / gepland / afgesloten). Knop "Tijdlijn" bij elke vaste stoel.
- **Impact-preview voor de planner.** Bij Wissel, Vertrek en Terugdraaien toont de
  app vóór bevestigen wat er vanaf de ingangsdatum al gepland staat op de stoel
  (toewijzingen, vakantie-V, diensten, wensen), met een extra waarschuwing als er
  dagen binnen 30 dagen bij zitten. → Vast had deze preview al.

### Fixes
- **Opvolging vs. vertrek.** Na een → Vast toonde de beheer-lijst de oude bezetter
  (bv. BL) als "gepland vertrek" met een *Intrekken*-knop die faalde ("geen
  vertrek om in te trekken"), terwijl er in werkelijkheid een opvolger klaarstond.
  Nu toont de rij "opgevolgd door <code> per <datum>" zonder de misleidende knop.
- **Senioriteit onbekend = rechts.** Een stoel waarvan de bezetter geen
  in-dienstdatum heeft, sorteert nu achteraan (junior) i.p.v. de oude stoelrang
  te erven. Een overnemer zonder ingevulde senioriteit (bv. een net vast-in-dienst
  genomen waarnemer) blijft dus niet op de senior-plek van de vorige staan.

### Let op (deployment)
De nieuwe collectie vereist een regel in `firestore.rules` (meegeleverd:
`bezetting_mutaties`, alleen beheerder). Deploy de bijgewerkte rules naar Firebase,
anders kan het terugdraai-logboek niet worden weggeschreven (de ingreep zelf gaat
wel door; alleen "Terugdraaien" is dan niet beschikbaar voor die ingreep).

---

## v3.27.118 — Bezetting: betrouwbaarheid van de stoel-tijdlijn

### Waarom
Aanleiding: na een "→ Vast"-migratie (waarnemer GJG per 1-1-2027 op de vaste
stoel i.p.v. BL) liepen weergaven uiteen en verdween een nieuw geplaatste
waarnemer op het vrijgekomen W-slot bij opslaan. De onderliggende oorzaak was
dat één stoel-tijdlijn (`bezetting_historie`) op meerdere plekken niet
consistent werd gelezen/geschreven. Deze release maakt de tijdlijn de enige
bron van waarheid en bewaakt de integriteit ervan.

### Kritieke fix (dataverlies bij invoer)
- **gebruikers.js — nieuwe waarnemer op een W-slot mét historie verdween na
  opslaan.** `opslaanInvallers` werkte alleen een BESTAANDE lopende
  (`tot=null`) periode bij. Had een W-slot wél een historie maar géén lopende
  periode (typisch nadat de vorige waarnemer via "→ Vast" was doorgeschoven en
  diens periode was afgesloten), dan werd enkel de top-level code/naam
  weggeschreven, terwijl de weergave (`bezettingOpDatum`) uit de historie leest
  en daar niets geldigs meer vond — de waarnemer "verdween" dus direct. Nu maakt
  het opslaan in dat geval een nieuwe lopende periode vanaf vandaag aan
  (met clipping), en sluit het bij deactiveren een lopende periode netjes af.

### Fix (weergave-consistentie)
- **overzicht.js — dagdetail/cel toonde een andere bezetter dan het raster.**
  De kolomkoppen lazen datum-bewust (`bezettingOpDatum`), maar het cel-detail,
  de cel-picker en de conflictlijst lazen de rauwe top-level code/achternaam.
  Na een toekomstige wissel/→Vast bevat top-level al de nieuwe bezetter,
  waardoor het raster BL toonde en het dagdetail GJG. Alle weergaven lezen nu
  datum-canoniek via de nieuwe helper `bezetterLabelOpDatum(stoel, datum)`.

### Betrouwbaarheid (invariant-bewaking)
- **helpers.js — integriteitscontrole op de stoel-tijdlijn.** Nieuwe helpers
  `controleerBezettingHistorie()`, `controleerAlleBezettingen()` en
  `assertBezettingGeldig()`. Model: één stoel = niet-overlappende periodes
  `[van, tot]`, hooguit één lopende. Elke schrijf-actie (Wissel, → Vast,
  waarnemer opslaan, Vertrek) valideert de nieuwe tijdlijn vóór opslaan en
  blokkeert bij overlap of dubbele lopende periode — zo kan een bug de database
  niet meer stilzwijgend corrumperen.
- **gebruikers.js — knop "🔎 Controleer bezetting"** in de Stoel-bezetting-tab
  scant alle stoelen en meldt eventuele overlap/dubbel-open problemen (of geeft
  groen licht). Puur lezend.

### Excel
- **export.js — zichtbaar blad "Mutaties".** Wisselingen midden in het jaar
  worden nu volledig leesbaar op een apart tabblad vastgelegd (kolom, stoel-ID,
  vorige bezetter → nieuwe bezetter, ingangsdatum), i.p.v. via een cel-notitie
  op de kolomkop die door Excel werd afgekapt. De kolomkop-notitie blijft als
  extra hint bestaan. De import negeert het Mutaties-blad (zoekt het hoofdblad
  op de Dag/Datum-kop).

---

## v3.27.117 — Excel-round-trip: twee dataverlies-bugs opgelost + consistentie-fixes

### Waarom
Een volledige code-review van de Excel-keten (export.js ⇄ import.js) legde twee
ernstige dataverlies-bugs in de import bloot, plus een reeks inconsistenties
tussen app en Excel. Alles in deze release is daarop gericht: de round-trip
export → (bewerken in Excel) → import is nu verliesvrij voor alle velden die
niet in het Excel-bestand zitten.

### Kritieke fixes (dataverlies)
- **import.js — import wiste vakantie_v en avond/nachtdiensten.** De import
  schreef elk indeling-doc volledig opnieuw (`batch.set` zonder veldbehoud),
  terwijl de export `vakantie_v` (Vakantie-tab) en `dienst.avond`/`dienst.nacht`
  niet bevat. Eén export→import-cyclus wiste dus stilzwijgend een heel jaar aan
  vakantieregistraties. De import behoudt nu alle app-only velden van het
  bestaande doc; Excel blijft leidend voor toewijzingen, dienst.dag,
  bespreking, interventie, dag-opmerking en cel-opmerkingen.
- **import.js — kolomkop-botsing 'S' corrumpeerde dag-opmerkingen.** De headers
  van de datakolommen (P/Q/R/S) kunnen samenvallen met de headers van de
  functie-indicatorkolommen rechts van 'Aantal' (bv. indicator 'S' van
  Saendelft). De header-scan liep over de volle breedte en liet de láátste
  match winnen, waardoor kolOpm naar de indicatorkolom versprong en alle
  dag-opmerkingen bij import werden vervangen door formule-restwaarden ("S").
  De scan stopt nu bij 'Aantal' en de eerste match wint.

### Fixes (correctheid / consistentie)
- **helpers.js — `bezettingOpDatum` pakt nu de entry met de laatste van-datum**
  i.p.v. de eerste array-match. Dit was de oorzaak van de shadowing-bug waarbij
  een stoel-ID-literal (bv. "W1") als kolomkop verscheen i.p.v. de juiste
  initialen. Nieuwe canonieke helpers: `laatsteEntry()` en
  `clipHistorieVoorWissel()`.
- **gebruikers.js — Wissel en →Vast clippen nu de volledige historie** per de
  dag vóór de ingangsdatum (open entries gesloten, overlappende gesloten
  entries geclipt, entries die op/ná de datum beginnen vervallen). Oude
  periodes kunnen een nieuwe bezetter niet meer overschaduwen. De drie
  gedupliceerde "zoek laatste entry"-loops zijn vervangen door `laatsteEntry()`.
- **helpers.js — `bezettingenInRange` respecteert nu `actief === false`** voor
  W-slots zonder historie (zelfde leeg-check als `bezettingOpDatum`). Een leeg,
  inactief W-slot krijgt geen exportkolom met de slot-ID als kop meer.
- **export.js + import.js — watermerk werkend gemaakt.** De export schrijft nu
  een verborgen `_RoosterApp`-blad; de import herkende dat al maar het werd
  nooit geschreven. De named-range-check in de import las bovendien het niet-
  bestaande `wb.Defined` — gecorrigeerd naar `wb.Workbook.Names` (SheetJS).
- **export.js — hardcoded fallback-kolommapping verwijderd.** Zonder geladen
  state blokkeert de export nu expliciet i.p.v. terug te vallen op een
  verouderde code→stoel-tabel die na wissels een verkeerd bestand opleverde.
- **validatie.js — bezetting-normen tellen nu ook W-slots mee**, dezelfde
  telbasis als de Excel-export (alle radioloogkolommen). App en Excel kleuren
  nu dezelfde dagen rood. (Keuze bevestigd: een waarnemer vult de bezetting in.)
- **import.js — rechten-check op rol i.p.v. permissie.** De Firestore-rules
  staan indeling-writes alleen toe aan rol 'beheerder'; de oude
  `magGebruikersBeheren()`-check kon halverwege de batch stranden met een half
  geïmporteerde staat.
- **backup-client.js — `vakantie_rankings` toegevoegd aan de backup.** Die
  collectie ontbrak; een restore verloor de vakantie-rangorde. ('wijzigingen'
  blijft bewust buiten de backup: de rules maken de audit-log append-only.)
- **save.js + import.js — wens-matching gecentraliseerd** in helpers.js
  (`wensMatcht`), voorheen drie losse kopieën met drift-risico.
- **import.js — wijzigingen-docs via échte writeBatch** (auto-id docs) i.p.v.
  400 losse addDoc-calls.

### Bekende, gedocumenteerde beperking
- Bij multi-code cellen ("V,K") telt Excel alleen de eerste code mee in de
  formules; de app telt alle codes. Volledige formule-pariteit is bewust niet
  gebouwd (onleesbare formules); verschil is alleen zichtbaar bij dubbele codes.

### Bestanden
`app/helpers.js`, `app/import.js`, `app/export.js`, `app/save.js`,
`app/validatie.js`, `app/backup-client.js`, `app/views/gebruikers.js`,
`config.js`, `sw.js`.

---

## v3.27.116 — Beheer: nieuwe-stoel als losse actie, waarnemer-databug en dubbele senioriteitslogica opgelost

### Waarom
Na het testen van v3.27.115 kwamen vier verwante problemen naar boven in de
Beheer-tab (Stoel bezetting):
1. Een nieuwe vaste stoel aanmaken kon alleen via een verstopte optie in de
   →Vast-dropdown van een waarnemer — niet vindbaar als je nog geen waarnemer
   had aangemaakt.
2. Er waren twee losse, niet nader toegelichte manieren om iemand op een
   vaste stoel te zetten (Wissel en →Vast), met verschillend gedrag.
3. Een leeg code-veld bij een waarnemer werd bij "Waarnemers opslaan"
   stilzwijgend vervangen door de letterlijke slot-ID (bv. "W4"), die daarna
   als échte data bleef staan.
4. Een waarnemer die via →Vast met een ingangsdatum in de toekomst werd
   vastgemaakt, verdween meteen uit de Waarnemers-lijst — maanden vóór de
   wissel daadwerkelijk inging.

Daarnaast bleek de senioriteits-sorteerformule (bepaalt kolomvolgorde in
Overzicht/Afdeling én Excel-export) dubbel geïmplementeerd: identiek in
gedrag, maar in twee losse stukken code die zonder waarschuwing uit elkaar
hadden kunnen groeien.

### Fixes
- **Gebruikers.js**: nieuwe knop "➕ Nieuwe stoel aanmaken" bij Vaste
  radiologen — een eigen, vindbare sheet om een radioloog op een gloednieuwe
  vaste stoel te zetten, los van de waarnemer-flow. De "➕ Nieuwe stoel"-optie
  in de →Vast-dropdown van een waarnemer blijft bestaan voor het andere
  gebruik: een bestaande waarnemer vast in dienst nemen mét behoud van diens
  indeling.
- **Gebruikers.js**: toelichtende tekst bij Vaste radiologen en Waarnemers
  aangescherpt om het verschil tussen Wissel (nieuwe persoon, geen migratie)
  en →Vast (bestaande waarnemer, migreert mét indeling/wensen/diensten)
  expliciet te maken.
- **Gebruikers.js**: `opslaanInvallers` schrijft een leeg code-veld nu ook
  echt leeg weg (nooit meer de slot-ID als code). Een waarnemer die op
  "actief" staat zonder code kan niet meer opgeslagen worden — duidelijke
  foutmelding i.p.v. stille datavervuiling.
- **Gebruikers.js**: de Waarnemers-lijst toont de huidige bezetter nu altijd
  via `bezettingOpDatum(slotId, vandaag)` in plaats van de rauwe top-level
  velden. Die velden worden bij een →Vast-migratie al direct leeggemaakt,
  ook bij een toekomstige ingangsdatum — de historie houdt daarentegen wél
  rekening met de datum, dus de waarnemer blijft nu zichtbaar tot de wissel
  écht ingaat.
- **Helpers.js**: nieuwe canonieke functies `senioriteitSortKey`,
  `vasteIdxVoorStoel` en `vergelijkOpSenioriteit` — de enige plek waar de
  senioriteits-sorteerformule nog staat. `vasteRadsOpDatum` gebruikt ze nu
  intern.
- **Export.js**: de eigen, dubbel geïmplementeerde sorteerformule is vervangen
  door aanroepen van dezelfde canonieke functies uit `helpers.js`. Gedrag is
  ongewijzigd (zelfde formule, zelfde uitkomst), maar kolomvolgorde in
  Overzicht/Afdeling en Excel-export kan nu niet meer stilzwijgend uit elkaar
  lopen na een toekomstige wijziging.

### Let op — bestaande datavervuiling
Als een waarnemer-slot al vóór deze versie leeg opgeslagen is met code = de
slot-ID (bv. "W4" als code, waarnemer op "inactief"), verdwijnt dat in de
weergave vanzelf zodra de W-stoel op "inactief" staat (zie fix hierboven).
Staat zo'n vervuilde rij per ongeluk wél op "actief" met een echte
achternaam: eenmalig het code-veld corrigeren en op "Waarnemers opslaan"
klikken — de bug komt na deze versie niet meer terug.

### Upgrade
1. Vervang `app/views/gebruikers.js`, `app/helpers.js`, `app/export.js`,
   `config.js` en `sw.js`.
2. Hard refresh (versie is nu 3.27.116).

## v3.27.115 — "Gebruikers"-tab herzien naar "Beheer" met drie sub-tabs

### Waarom
De Gebruikers-tab bundelde drie verschillende zaken (stoelbezetting,
inlogaccounts en losse instellingen) in één lange lijst, wat verwarrend werkte.
Vooral het onderscheid tussen roosterpersonen (radiologen/waarnemers) en
inlogaccounts (ook technici en secretariaat) was onduidelijk.

### Wat is er veranderd (alleen presentatie/indeling; datamodel ongewijzigd)
- De tab "Gebruikers" heet nu **Beheer**.
- Beheer heeft drie sub-tabs:
  1. **Stoel bezetting** — vaste radiologen en waarnemers, ongewijzigd.
  2. **App gebruikers** — de bestaande accounts, met onder-tabs Radiologen,
     Technici en Secretariaat. Alleen radiologen kunnen aan een stoel gekoppeld
     worden; een radioloog die ook beheerder is, staat als "Radioloog,
     beheerder". "+ Nieuw" per onder-tab vult de juiste rol alvast in.
  3. **Control** — met onder-tabs Regels (de voormalige aparte Regels-tab, nu
     hierheen verplaatst) en Overige instellingen (Excel-import, Excel-export,
     database-backup, app-instellingen en gegevensbeheer).
- De aparte "Regels"-tab in de hoofdnavigatie is vervallen en zit nu in Beheer.
  De Beheer-tab is zichtbaar zodra de gebruiker gebruikers- óf regels-rechten
  heeft; onder-tabs verschijnen alleen waar de gebruiker rechten voor heeft.

### Upgrade
1. Vervang `app/views/gebruikers.js`, `app/views/regels.js`, `app/main.js`,
   `index.html`, `config.js` en `sw.js`.
2. Hard refresh (versie is nu 3.27.115).

## v3.27.114 — Oude versie bleef actief op iPhone (PWA-update)

### Waarom
Op de iPhone bleef de oude versie van de app soms actief, ook na een nieuwe
release. Twee oorzaken: (1) de app vroeg zelf nooit actief om een update, en
Safari op iOS controleert daar uit zichzelf zelden op — een PWA vanaf het
beginscherm wordt vaak hervat vanuit een snapshot i.p.v. echt herladen; (2) bij
het precachen van een nieuwe versie kon de browser bestanden uit zijn eigen
HTTP-cache teruggeven, waardoor een "nieuwe" service worker toch oude bestanden
opsloeg.

### Fixes
- **sw.js**: precache haalt elk bestand nu op met `cache: 'reload'`, dus altijd
  rechtstreeks van de server, nooit uit de HTTP-cache.
- **index.html**: service worker geregistreerd met `updateViaCache: 'none'`, en
  de app vraagt nu zelf actief om een update — bij het laden én telkens wanneer
  de app weer op de voorgrond komt (app-wissel, ontgrendelen, terugkeren naar de
  PWA). Zodra een nieuwe versie actief wordt, herlaadt de app eenmalig voor
  verse bestanden.

### Upgrade
1. Vervang `sw.js`, `index.html` en `config.js`.
2. Hard refresh (versie is nu 3.27.114). Let op: doordat dit juist de
   update-afhandeling zélf betreft, kan het op een iPhone die nog op een oude
   versie staat éénmalig nodig zijn de PWA te sluiten en opnieuw te openen (of
   in Safari te herladen) om de nieuwe service worker op te pikken.
   Vanaf deze versie werkt het daarna automatisch.

## v3.27.113 — Backup: "Maximum call stack size exceeded" bij grote database opgelost

### Waarom
"Nu backup maken" gaf de foutmelding "Backup mislukt: Maximum call stack size
exceeded" en downloadde niets. Oorzaak: `base64Encode()` in
`app/backup-client.js` zette de versleutelde backup in één keer om via
`String.fromCharCode(...bytes)`. Bij een kleine database werkt dat, maar
JavaScript-engines hebben een harde limiet op het aantal argumenten in één
functieaanroep. Na lange tijd gebruik (meer radiologen, indelingen en
historie) is de backup groot genoeg om die limiet te overschrijden, waardoor
elke backup faalde — en dus ook de automatische backup vóór een Excel-import.

### Fix
- **Backup-client.js**: `base64Encode()` verwerkt de data nu in blokken van
  32.768 bytes in plaats van in één keer, ongeacht hoe groot de database is.
  Functioneel identiek resultaat, geen limiet meer op de databasegrootte.

### Upgrade
1. Vervang `app/backup-client.js`, `config.js` en `sw.js`.
2. Hard refresh (versie is nu 3.27.113).

## v3.27.112 — Excel-export: volledig jaar, senioriteitsvolgorde en herleidbare kolomkoppen

### Waarom
De Excel-export toonde bij een nieuw kalenderjaar alleen de al ingevulde dagen
i.p.v. het hele jaar. Daarnaast gebruikte de export een vaste, hardgecodeerde
kolomvolgorde (stoel-ID) i.p.v. de senioriteitsvolgorde die de rest van de app
al gebruikt, waardoor een nieuwe radioloog op een seniore stoel niet naar
rechts verschoof zoals in de app. Tot slot bleef bij een stoelwissel of een
waarnemer die "→ Vast" ging, de kolomkop het hele jaar op één naam staan, ook
voor de dagen van de vorige bezetter.

### Fixes
- **Export.js**: alle kalenderdagen van het gekozen jaar worden nu geëxporteerd,
  ook dagen zonder Firestore-document (leeg = nog geen indeling).
- **Export.js**: kolomvolgorde is nu gebaseerd op dezelfde senioriteits-logica
  (`in_dienst`-datum van de huidige bezetter) als Overzicht/Afdeling, i.p.v. een
  vaste stoel-ID-volgorde. Waarnemer-slots (W5..W1) blijven na de vaste stoelen
  staan, in vaste volgorde.
- **Export.js**: kolomkop is nu datum-bewust — bij een stoel/slot met meerdere
  bezetters in het geëxporteerde jaar (wissel, of waarnemer → vaste stoel)
  wordt een Excel-notitie op de kolomkop gezet met de volledige tijdlijn
  (wie zat wanneer op deze stoel), zodat altijd herleidbaar blijft wie je op
  welke dag hebt ingedeeld.
- **Gebruikers.js**: het invullen van code/achternaam van een waarnemer via de
  simpele Waarnemers-tabel wordt nu ook doorgeschreven naar de open
  bezetting_historie-entry van die stoel. Voorheen kon dit stilzwijgend genegeerd
  worden door de weergave zodra een stoel ooit gewisseld of gemigreerd was,
  omdat de weergave altijd voorrang geeft aan de historie-entry boven het
  top-level veld.

### Upgrade
1. Vervang `app/export.js`, `app/views/gebruikers.js` en `config.js`.
2. Hard refresh (versie is nu 3.27.112).

## v3.27.111 — Backups geblokkeerd in de testomgeving

### Waarom
Een backup van testdata zou per ongeluk in de live-agenda teruggezet kunnen worden. Door het maken van een backup in de testomgeving onmogelijk te maken, kan zo'n testbackup simpelweg niet bestaan — het gevaar is bij de bron weg.

### Wijzigingen
- **backup-client.js**: `maakClientBackup` stopt direct in de testomgeving (geen download, geen schrijf-actie).
- **Gebruikers-tab**: klikken op "Nu backup maken" in test toont de melding *"In de testomgeving kan geen backup gemaakt worden."* De backup-kaart toont in test een duidelijke hint.
- **Excel-import in test**: de automatische backup-vóór-import wordt overgeslagen (geen nag-prompt; testdata hoeft niet veiliggesteld te worden).
- **Backup terugzetten blijft in test wél mogelijk**, zodat je een in de live-agenda gemaakte backup hier kunt herstellen om met actuele data te oefenen (de nuttige richting live → test).

Versie 3.27.110 → 3.27.111 (config-basis, sw.js).

---

## v3.27.110 — Beheerdershandleiding bijgewerkt

### Wijziging
- Help-bestand `help/beheerder.html` geactualiseerd: datum/versie (juni 2026 · 3.27.110) en de uitgebreide beheerders-opties.
- Nieuw/bijgewerkt beschreven: flexibele stoelen (toevoegen/opheffen, max 12, anciënniteit-volgorde), "Wissel"/→Vast met schoon overnemen, "Vertrek" + intrekken/herstellen ("Vertrokken stoelen"), persoon-id toekennen, loopbaan-weergave.
- Export-sectie: regel-gedreven normen (geen vaste 5/4 meer), werkvloer = Aantal, indicator-monitor, celkleur uit functiekleur incl. live recolor, verborgen bladen `_kolommen` en `_regels`.
- Import-sectie: koppeling via stabiel stoel-id met code-fallback, waarschuwingen i.p.v. stil overslaan.
- Korte notitie over de testomgeving (oranje balk, eigen database).

Alleen documentatie + versiebump. Versie 3.27.109 → 3.27.110 (config-basis, sw.js).

---

## v3.27.109 — Werkvloer-monitor terug, kleur-recolor & vakantie-waarschuwing

### Wijzigingen
- **Per-dag-monitor terug (Optie B)**: indicator-kolommen tonen weer álle werkvloer-functies (≥1 op werkdagen), niet alleen de verplichte. Zo zie je per dag weer welke functies niet bezet zijn.
- **Datum/Aantal-rood blijft zuiver**: alleen de strikte app-criteria (verplichte functies + bezetting-regels) laten de datum/Aantal rood worden. Werkvloer-only functies kleuren alleen hun eigen indicator-kolom rood als ze ontbreken — een normale dag zonder bv. Mammo maakt niet de hele datum rood.
- **Kleur-recolor in Excel hersteld**: de conditionele kleurregel herkent nu alle codevormen (exacte code, eerste letter, punt-prefix zoals `.WB`, én cijfer-prefix zoals `3W`/`5B`) en is hoofdletterongevoelig. Wijzig je een cel in Excel, dan krijgt die meteen de juiste functiekleur.
- **Waarschuwing bij iedereen-vakantie**: doordat de werkvloer-indicatoren weer aanstaan, lichten op een dag waarop iedereen vrij is alle werkvloer-letters rood op (en de datum als er strikte criteria gelden).

Versie 3.27.108 → 3.27.109 (config-basis, sw.js).

---

## v3.27.108 — Export volgt de app exact (regel-gedreven formules)

### Probleem
De Excel-export bakte vaste aannames in (norm 5/4, vaste Aantal-drempels, indicator-set, V/K-kleur). Na het wijzigen van regels, functies of kleuren in de app klopte de Excel niet meer.

### Oplossing — alles op exporttijd uit de app afgeleid
- **Aantal = werkvloerbezetting**: telt nu de codes met de werkvloer-vlag uit `state.functies` (i.p.v. de indicator-set).
- **Normen uit de bezetting-regels**: de rode datum-markering en de Aantal-kleur volgen nu de actieve `bezetting`-regels (per dag/code/aantal) gecombineerd met de verplichte functies. Geen vaste 5/4 meer.
- **Indicatoren tonen een tekort**: een indicator-kolom toont de code zolang de bezetting op die weekdag onder de vereiste (regel-)norm zit — niet alleen bij volledig ontbreken. Per weekdag wordt de vereiste op de spot in de formule gezet.
- **Celkleuren (incl. V/K) volledig uit de functiekleur** van de app; de vaste lichtgeel-markering voor V/K is vervallen. Fallback-tabel alleen nog voor codes zonder ingestelde kleur.
- **Verborgen `_regels`-blad**: legt de gebruikte functies (kleur/werkvloer/verplicht) en normen vast, puur ter controle.
- **Vangnet**: export stopt met een melding als de functies nog niet geladen zijn.

Layout (kolommen, kleuren-aanpak, weekendarcering, bevroren rij/kolommen, notities, `_kolommen`-blad) blijft ongewijzigd. `fullCalcOnLoad` blijft aan zodat Excel bij openen herberekent.

Versie 3.27.107 → 3.27.108 (config-basis, sw.js).

---

## v3.27.107 — Persoon-id toekenning aangescherpt

### Probleem
De eenmalige toekenning telde te ruim: lege W-stoelen (waarvan de 'code' standaard de slotnaam is) en restdocumenten werden meegeteld (bv. 17 i.p.v. 10).

### Wijziging
- Toekenning gebeurt nu alleen voor bezetters met een **echte achternaam**. Lege slots en kale restdocumenten worden overgeslagen.
- `opslaanInvallers` kent alleen een persoon-id toe als er een achternaam is ingevuld (niet bij een kale slotnaam).
- Tekst en telling spreken nu over "bezetters" i.p.v. "stoelen".

Versie 3.27.106 → 3.27.107 (config-basis, sw.js).

---

## v3.27.106 — Schoon overnemen bij vervang-wissel

### Wijziging
Bij "→ Vast" op een **bestaande** stoel toont de doelstoel vanaf de ingangsdatum nog uitsluitend de indeling van de nieuwe bezetter:
- Dagen waarop de waarnemer een toewijzing had → die verhuist mee (overschrijft een rest van de vertrekker).
- Dagen waarop de waarnemer niets had maar de doelstoel nog een toewijzing van de vertrekker → die rest wordt **gewist**. Geen mengvormen meer.
- Geldt ook voor vakantie-V. Diensten worden zoals voorheen hernoemd (vanSlot → naarSlot).
- Bij de **nieuwe-stoel**-route is dit automatisch een no-op (de stoel is leeg).

Bevestigingstekst bij vervangen vermeldt nu expliciet dat resten van de vorige bezetter worden gewist.

Versie 3.27.105 → 3.27.106 (config-basis, sw.js).

---

## v3.27.105 — Export/import op stabiel stoel-id + waarschuwingen

### Probleem dat dit oplost
De koppeling Excel↔stoel liep via de huidige code (initialen). Na een wissel mapte een oude code (bv. 'BL') nergens meer op, waardoor die kolom bij import **stil werd overgeslagen** (dataverlies).

### Oplossing
- **Export** schrijft een verborgen blad **`_kolommen`** met de mapping code → stoel-id, zoals geldig op het moment van export. Het hoofdblad blijft ongewijzigd leesbaar (codes als kop).
- **Import** koppelt elke kolom bij voorkeur via die stabiele stoel-id uit het bestand; **valt terug op de code** (huidige + vaste mapping) voor vreemde/oude bestanden. Zo komt elke kolom op de juiste stoel terecht, ook na een wissel.
- **Waarschuwingen** i.p.v. stil overslaan: een kolom die niet gekoppeld kan worden, wordt expliciet gemeld ("kolom 'X' is NIET geïmporteerd"). Bij een app-bestand wordt ook een ontbrekende verwachte kolom gemeld.
- Radioloog-kolommen worden nu strikt uit de zone vóór de Dienst-kolom gelezen, zodat Aantal/indicator-kolommen geen valse waarschuwingen geven.
- Versie 3.27.104 → 3.27.105 (config-basis, sw.js).

### Compatibiliteit
Code-fallback blijft behouden: oudere Excel-bestanden zonder `_kolommen`-blad importeren zoals voorheen, nu mét waarschuwing bij niet-herkende kolommen.

---

## v3.27.104 — Persoon-id (Niveau 1) + loopbaan-weergave

### Doel
Een persoon over stoelen heen herleidbaar maken (waarnemer → vaste stoel, of stoelwissel), onafhankelijk van code-hergebruik.

### Model (Niveau 1 — bewust gekozen, gedocumenteerd)
- Nieuw veld **`persoon_id`** op elke `bezetting_historie`-entry (en top-level op stoelen zonder historie, zoals W-stoelen).
- **Niveau 1 = GEEN aparte `personen`-collectie.** Stamgegevens (naam/code) blijven gedenormaliseerd op de entries. `persoon_id` groepeert ze tot één persoon. Later optioneel uitbreidbaar naar Niveau 2 (register) zonder dataverlies.
- Een `persoon_id` wordt **nooit hergebruikt**; codes (initialen) mogen wel terugkomen.
- **Geen terugwerkende migratie**: de situatie is stabiel (8 stoelen/8 radiologen, 2 waarnemers). Persoon-id wordt "vanaf nu" toegekend.

### Wijzigingen
- **helpers.js**: `nieuwPersoonId()`, `persoonFallbackKey()`, `loopbaanVoorPersoon()` (verzamelt periodes per persoon over alle stoelen).
- **Persoon_id loopt mee** bij Wissel (nieuwe identiteit → vers id), bij →Vast/stoelwissel/nieuwe stoel (bestaand id verhuist mee via `migreerBezetting`), en bij waarnemer-opslag (top-level id).
- **Knop "Persoon-id's toekennen"** (Gebruikers-tab, onder vaste radiologen): eenmalige, idempotente toekenning aan de huidige bezetters.
- **Loopbaan-weergave** geïntegreerd in de Radioloog-tab (read-only, alleen beheer): periodes per persoon over alle stoelen (stoel · code · van–tot). Werkt met fallback op naam+code zolang persoon-id's nog niet zijn toegekend.
- Versie 3.27.103 → 3.27.104 (config-basis, sw.js).

### Indeling blijft per stoel
De dagindeling blijft per stoel-id opgeslagen. Persoon-id is een koppeling (persoon → stoel+periode → indeling van die stoel), geen nieuwe opslag van indeling.

---

## v3.27.103 — Vertrek herstellen / corrigeren

### Wijzigingen
- **Gepland vertrek (vertrekdatum nog niet gepasseerd)**: de stoel blijft zichtbaar met de melding "vertrekt per <datum>"; de Vertrek-knop wordt een **Intrekken**-knop waarmee je het geplande vertrek terugdraait.
- **Vertrokken stoel (datum al gepasseerd)**: verschijnt in een nieuwe sectie **"Vertrokken stoelen"** met een **Herstellen**-knop; dat trekt het vertrek in en de kolom komt terug.
- Intrekken/Herstellen zet de laatste bezetting-entry weer op lopend (`tot = null`); de bezetter is dan weer doorlopend actief.
- **opslaanParttime** robuuster: bij een gepland vertrek (geen open entry) wordt de in-dienst datum op de laatste entry bijgewerkt i.p.v. een dubbele open entry aan te maken.
- Versie 3.27.102 → 3.27.103 (config-basis, sw.js).

---

## v3.27.102 — Flexibele vaste stoelen (toevoegen/opheffen, datum-correct)

### Wijzigingen
- **Aantal vaste stoelen is niet langer vast op 8.** Stoelen ontstaan en verdwijnen vanuit acties op personen:
  - **Nieuwe stoel**: in "→ Vast" kun je nu kiezen tussen een **bestaande stoel** (vervangen) of een **nieuwe stoel** (kolom erbij). Een nieuwe stoel krijgt een vers, uniek intern id (nooit hergebruikt).
  - **Vertrek**: per vaste radioloog een knop **Vertrek** met een vertrekdatum. Vanaf die datum verdwijnt de kolom; de historie ervóór blijft zichtbaar.
- **Maximum 12** gelijktijdig actieve vaste stoelen (gecontroleerd bij toevoegen).
- **helpers.js**: `vasteRadsOpDatum` toont per datum alleen stoelen met een actieve bezetter (leeg = geen kolom); nieuwe helpers `alleVasteStoelIds()` en `isVasteStoel()`. Het kolom-aantal volgt nu per week uit de bezetting (8 nu, meer/minder na mutaties).
- **activiteit.js, validatie.js, main.js**: gebruiken de dynamische stoelenset i.p.v. de vaste lijst, zodat nieuwe stoelen overal meetellen.
- Versie 3.27.101 → 3.27.102 (config-basis, sw.js).

### Model
- Een extra stoel = een `radiologen`-document met `vaste_stoel: true`. De oorspronkelijke 8 blijven ongewijzigd (geen migratie). Codes mogen later terugkomen; interne stoel-id's worden nooit hergebruikt.
- Geen rules-wijziging nodig.

---

## v3.27.101 — Veiliger deployen: automatische omgeving-detectie + fail-safe

### Wijzigingen
- **config.js**: één config voor productie én test. De omgeving wordt automatisch uit de URL bepaald (`/Rooster/` = productie, `/Rooster-test/` = test). Geen handmatige config-omzetting meer nodig bij het uploaden — dezelfde bestanden gaan naar beide repos.
- **config.test.js**: verwijderd (overbodig geworden).
- **main.js**: fail-safe — bij een **onbekende** URL blokkeert de app zichzelf met een rood scherm, zodat er nooit per ongeluk naar de verkeerde database wordt geschreven. In **test** verschijnt een opvallende oranje "TESTOMGEVING"-balk bovenaan.
- **TESTOMGEVING.md**: bijgewerkt naar de nieuwe methode (zelfde zip naar beide repos).
- Versie 3.27.100 → 3.27.101 (config.js basis, sw.js).

### Waarom
Voorheen moest je bij elke upload `config.js` handmatig omzetten naar de test-inhoud; dat vergeten schreef stilletjes naar productie. De URL-detectie haalt die foutgevoelige stap volledig weg.

---

## v3.27.100 — UX: directe kolomvolgorde + dirty-state Opslaan

### Wijzigingen
- **Gebruikers-tab**: het regeltje “vast sinds …” onder de naam is verwijderd; geen onderscheid meer tussen de maten in de lijst.
- **helpers.js** (`vasteRadsOpDatum`): de “alles-of-niets”-fallback is vervangen door een **per-stoel** placeholder. Een stoel zonder in-dienst datum houdt zijn oorspronkelijke vaste positie; stoelen met een datum sorteren daar tussendoor. De kolomvolgorde klopt nu **altijd direct** — ook meteen na “Doorvoeren”, zonder dat eerst op Opslaan geklikt hoeft te worden.
- **Gebruikers-tab**: beide Opslaan-knoppen (vaste radiologen + waarnemers) starten **grijs/uitgeschakeld** en worden pas **actief** zodra je een veld wijzigt (dirty-state). Na opslaan (re-render) staan ze weer grijs.
- Versie 3.27.99 → 3.27.100 (config.js, sw.js).

---

## v3.27.99 — Historisch correcte kolomvolgorde (senioriteit per bezetter)

### Wijzigingen
- **helpers.js** (`bezettingOpDatum`): een afgesloten bezetting-entry gebruikt nu uitsluitend zijn **eigen** `in_dienst` (geen terugval meer op de stoel-datum). Daardoor klopt de kolomvolgorde ook als je terugbladert: oude weken sorteren op de senioriteit van wie er tóén zat, nieuwe weken op de huidige bezetter.
- **Wissel-sheet** (`opslaanWissel`): nieuw veld "In dienst / senioriteit" voor de nieuwe persoon; wordt op diens bezetting-entry vastgelegd.
- **Maak-vast-sheet** (`maakVastDoorvoeren` / `migreerBezetting`): nieuw veld "In dienst / senioriteit", los van de ingangsdatum. De nieuwe (juniore) vervanger krijgt zo zijn eigen senioriteit-datum mee i.p.v. de stoelpositie van de voorganger te erven.
- Versie 3.27.98 → 3.27.99 (config.js, sw.js).

### Model (verduidelijking)
- `van`/`tot` op een bezetting-entry = wie er op welke datum op de stoel zit (historie).
- `in_dienst` op de bezetting-entry = senioriteit van die persoon; bepaalt de kolomvolgorde (oudste = links).
- Beide staan los van elkaar: senioriteit ≠ ingangsdatum op de stoel.

---

## v3.27.98 — Kolomvolgorde op anciënniteit (in-dienst datum)

### Wijzigingen
- **Gebruikers-tab**: nieuw datumveld **In dienst** per vaste radioloog, links van de Parttime-kolom. Voorgevuld met een placeholder-datum die de huidige vaste volgorde behoudt (oudste = links); aan te passen naar de echte anciënniteitsdata. Opslaan schrijft de datum naar de open `bezetting_historie`-entry van de stoel.
- **helpers.js** (`vasteRadsOpDatum`): de vaste radiologen worden nu gesorteerd op de in-dienst datum van de bezetter op de getoonde datum (oudste = links). Fallback: zolang niet álle stoelen een datum hebben, blijft de oorspronkelijke vaste volgorde behouden. Werkt door in Overzicht, Afdeling, Dienst, Vakantie, Radioloog en Jaaroverzicht.
- **helpers.js** (`bezettingOpDatum`): geeft `in_dienst` mee (uit de entry, met top-level fallback).
- **Activiteit-tab**: kolomvolgorde van het vaste deel volgt nu dezelfde anciënniteit-sortering (gesorteerd op periode-einde); waarnemers blijven rechts.
- **“Maak vast” / stoelwissel**: `in_dienst` verhuist mee met de persoon, zodat een nieuwe (juniore) vervanger automatisch rechts in het overzicht komt.
- Versie 3.27.97 → 3.27.98 (config.js, sw.js).

### Datamodel
- Nieuw veld `in_dienst` (`YYYY-MM-DD`) op de `bezetting_historie`-entry (per persoon), met top-level spiegel op het stoel-record als fallback. Geen rules-wijziging nodig.

---

## v3.27.97 — Testomgeving: named Firestore-database + guard

### Wijzigingen
- **firebase-init.js**: database-selectie via `window.FIRESTORE_DB`. Productie blijft de `(default)`-database; de testomgeving gebruikt een named database (`test`) binnen hetzelfde project, zodat live data ongewijzigd blijft tijdens testen. Nieuw export: `IS_TEST_DB`.
- **firebase-init.js**: veiligheidsguard — de account-Cloud-Functions (`gebruikerAanmaken`, `gebruikerVerwijderen`, `gebruikerResetWachtwoord`) worden in de testomgeving geblokkeerd met een duidelijke foutmelding, omdat ze server-side altijd de live database + Auth zouden raken.
- **config.test.js** (nieuw): drop-in config voor de test-branch (`FIRESTORE_DB = 'test'`, versielabel `-TEST`).
- **TESTOMGEVING.md** (nieuw): inrichting, data verversen via de ingebouwde backup/restore, en reviewer-instructies.
- **sw.js**: cache-versie 3.27.96 → 3.27.97.

---

## v3.27.96 — Bugfix: watermerk verwijderd + FUNCTIE_LETTERS fallback

### Wijzigingen
- **export.js**: verborgen `_RoosterApp` sheet verwijderd — die verschoof de hoofdsheet naar positie 2 waardoor comments/drawings hernummerd werden en Excel de structuur als corrupt beschouwde.
- **export.js**: `FUNCTIE_LETTERS` heeft nu een fallback: als geen functies als "verplicht" zijn aangevinkt, worden alle werkvloer-functies gebruikt (gedrag zoals v3.27.85). Zo blijft de Aantal-kolom altijd gevuld.

---

## v3.27.95 — Export: veilige features toegevoegd op v85-basis

### Wijzigingen
- **export.js**: `bgColor` → `fgColor` in alle conditionele opmaak (correcte ExcelJS-syntax)
- **export.js**: `UPPER()` in `telLetterFormule` — lowercase celwaarden (bijv. `bo`) geven geen fouten meer
- **export.js**: `wb.calcProperties = { fullCalcOnLoad: true }` — Excel herberekent formules correct bij openen
- **export.js**: Watermerk als verborgen sheet `_RoosterApp` (state: veryHidden)
- **export.js**: `FUNCTIE_LETTERS` filtert nu alleen functies met `verplicht=true` (i.p.v. alle werkvloer-functies)
- **export.js**: Indicator-kolommen worden rood+vet als verplichte functie ontbreekt op werkdag
- **export.js**: Datumcel (kolom B) kleurt rood als verplichte functie ontbreekt
- Activiteit-sheet blijft uitgeschakeld

---

## v3.27.94 — Activiteit-sheet tijdelijk uitgeschakeld

### Wijzigingen
- **export.js**: `voegActiviteitSheetToe` uitgecommentarieerd. De Activiteit-sheet (sheet2) bleek de enige oorzaak van de Excel-foutmeldingen — bestanden zonder dit sheet openen foutloos. Test of export nu foutloos werkt voordat het sheet structureel wordt opgelost.

---

## v3.27.93 — Export.js teruggezet naar v3.27.85-basis

### Wijzigingen
- **export.js**: volledig teruggezet naar de v3.27.85-versie die foutloos werkte. Alle wijzigingen na v85 (UPPER, calcProperties, watermerk, verplicht-filter, bgColor-fix) zijn verwijderd. Enige toevoeging t.o.v. v85: de bestandsnaam-parameter (naamParam) uit v3.27.86.

---

## v3.27.92 — Bugfix: watermerk veroorzaakte Excel-corruptie

### Wijzigingen
- **export.js**: `wb.definedNames.add('RoosterApp', { formula: '"1"' })` gebruikte de ExcelJS API verkeerd — het tweede argument moet een celreferentie-string zijn, niet een object. Dit produceerde `[object Object]` in de werkboek-XML, waardoor Excel het bestand moest repareren. Vervangen door een verborgen werkblad `_RoosterApp` (state: veryHidden) met waarde `1` in cel A1 — betrouwbaar en zonder API-risico.
- **import.js**: watermerk-detectie bijgewerkt naar `wb.SheetNames.includes('_RoosterApp')` met fallback op de oude named-range check.

---

## v3.27.91 — Versienummer zichtbaar in gebruikers-tab

### Wijzigingen
- **gebruikers.js**: versienummer (`v3.27.91`) zichtbaar onder de "+ Nieuw"-knop in de Gebruikers-card, zodat na een upload direct te controleren is of de browser de juiste versie toont.

---

## v3.27.90 — Excel: formule-kwaliteit + watermerk + import-herkenning

### Wijzigingen
- **export.js**: `wb.calcProperties = { fullCalcOnLoad: true }` toegevoegd — Excel herberekent formules correct bij openen in plaats van te klagen over ontbrekende cache
- **export.js**: `UPPER()` toegevoegd om `LEFT()` en `MID()` in alle SUMPRODUCT-formules (zowel hoofdblad als Activiteit-sheet) — lowercase celwaarden zoals `bo` veroorzaken geen `#VALUE!` meer
- **export.js**: Named range `RoosterApp` toegevoegd als watermerk — maakt het bestand herkenbaar bij import ongeacht de sheetnaam
- **import.js**: Sheetnaam-detectie uitgebreid: bij aanwezig watermerk zoekt de import de sheet met `Dag`/`Datum`-header in alle sheets (naam-onafhankelijk); zonder watermerk blijft het klassieke `Indeling YYYY`-patroon werken als fallback

---

## v3.27.89 — Bugfix: Activiteit-sheet formules gecorrigeerd

### Wijzigingen
- **export.js**: Alle cross-sheet formule-referenties in de Activiteit-sheet gebruikten een ongecieerde sheetnaam (`Indeling 2026!A$2`). Excel vereist single quotes om namen met spaties (`'Indeling 2026'!A$2`). Dit veroorzaakte `#NAME?`-fouten, verwijdering van formule-records, en de "unable to refresh linked workbook"-waarschuwing.
- **export.js**: `schrijfSectie` stijlde na `mergeCells` alle cellen in de rij via een loop. ExcelJS staat na merge alleen schrijven naar cel 1 toe — de loop produceerde ongeldige XML. Nu alleen cel 1 gestyled.
- **export.js**: Dode functie `dienstFormule` verwijderd (werd niet meer aangeroepen sinds v3.27.88).

---

## v3.27.88 — Excel-bugfixes + verplichte functies

### Wijzigingen
- **export.js bugfix**: `bgColor` → `fgColor` in alle conditionele opmaak (veroorzaakte Excel-corruptie bij openen)
- **export.js bugfix**: `mergeCells` in Activiteit-sheet nu vóór cel-schrijven (fix ongeldige XML)
- **export.js bugfix**: Dienst-rij in Activiteit-sheet gebruikte verkeerde parameter; nu correcte COUNTIF op kolomletter
- **export.js feature**: Indicator-kolommen tonen alleen functies met `verplicht=true` (was: alle werkvloer-functies)
- **export.js feature**: Indicator-kolommen worden rood+vet als de functie ontbreekt op een werkdag
- **export.js feature**: Datumcel (kolom B) kleurt ook rood als een verplichte functie ontbreekt
- **regels.js feature**: Nieuwe checkbox "Verplicht" per functie in de functies-matrix; naamveld smaller gemaakt
- **validatie.js feature**: `valideerWeek()` checkt nu of verplichte functies aanwezig zijn op werkdagen; conflict verschijnt in weekoverzicht

---

## v3.27.87 — Bugfix: bestandsnaam Excel-export werd niet doorgegeven

### Wijzigingen
- **gebruikers.js**: `window.actExportJaar` gaf de `naam`-parameter niet door aan `actExportJaar` — exporteerde altijd de standaardnaam. Opgelost.

---

## v3.27.86 — Excel-export: instelbare bestandsnaam

### Wijzigingen
- **Gebruikers-tab / Excel-export**: nieuw tekstveld "Bestandsnaam" naast het jaarkeuze-menu. De ingevulde naam wordt opgeslagen in `localStorage` en blijft bewaard tussen sessies. Als het veld leeg is gebruikt het systeem de standaardnaam (`Indeling_[jaar].xlsx`). Een `.xlsx`-extensie wordt automatisch toegevoegd als die ontbreekt.

---

## v3.27.85 — Service Worker reload-trigger vereenvoudigd

### Wijzigingen
- `index.html` had twee listeners die de pagina herlaadden bij een SW-update: één op `updatefound + statechange === 'activated'`, één op `controllerchange`. In de praktijk vuren beide bij dezelfde update en kon dat een dubbele reload of incidentele race-condition geven.
- Vervangen door één canonieke `controllerchange`-listener, met een first-install guard: er wordt onthouden of er bij page-load al een service worker de controle had. Pas als die er was *en* er later een controllerchange volgt, wordt herladen. Bij een eerste bezoek (geen vorige controller) wordt niet herladen — dat zou een vreemde reload geven net na de eerste page-load.

## v3.27.84 — Help-pagina datums bijgewerkt

### Wijzigingen
- `help/gebruiker.html` en `help/beheerder.html` toonden in de subtitel "versie december 2025". Bijgewerkt naar "versie mei 2026". Inhoud van de help-pagina's is niet gereviewed — alleen de datum-subtitel.

## v3.27.83 — State-declaratie opgeschoond

### Wijzigingen
- In `state.js` stond `vakZichtbaarJaar` gedeclareerd maar werd dit veld nergens gelezen of geschreven. Tegelijk gebruikte `vakantie.js` het veld `vakZichtbareMaand` zonder dat het in `state.js` gedeclareerd stond. Veld omgewisseld: `vakZichtbaarJaar` weg, `vakZichtbareMaand: null` toegevoegd met passende comment. Geen functionele wijziging — de Vakantie-view werkt zoals voorheen; de teller-reset bij jaarwissel hangt af van de saldo-berekening (die het jaar afleidt uit de zichtbare maand) en blijft onveranderd.

## v3.27.82 — Jaaroverzicht: UTC-veilige datum-helpers

### Wijzigingen
- `jaaroverzicht.js` gebruikte lokale-tijd Date-objecten gecombineerd met `toISOString().slice(0,10)` — exact het patroon dat in v3.19.0 elders al als bug was opgelost. Voor Nederland geeft dat in de praktijk geen verkeerde data (positieve UTC-offset), maar het patroon is fragiel bij DST-overgangen en faalt in negatieve tijdzones. Alle vier de lokale helper-functies herschreven:
  - `maandagsVanJaar`: nu via `Date.UTC` + `getUTCDay`/`setUTCDate`.
  - `dagVanWeek`: vervangen door aanroep van bestaande `plusDagen()` helper.
  - `maandLabel`: gebruikt nu UTC-Date met `timeZone: 'UTC'` in `toLocaleDateString`.
  - `isoWeek`: vervangen door bestaande `isoWeekVan()` helper.
- Output is voor 2024–2030 identiek aan voorheen geverifieerd; geen zichtbare verandering in het jaaroverzicht.

## v3.27.81 — Consistente hoofdletter-extractie uit codes

### Wijzigingen
- `afdeling.js` gebruikte op drie plekken `c.charAt(0).toUpperCase()` om de "rol-letter" uit een code te halen. Dat werkt voor kale codes (V, K, Z) maar levert voor codes met prefix (`.WB` → `.`, `5B` → `5`, `YYE1` → `Y`) een verkeerde letter op. Vervangen door de bestaande helper `hoofdLetterCode()` die de prefix wegfilter t voordat hij de hoofdletter pakt. Gevolg: afwezigheids-detectie en verbergen-bij-beperkt-zicht werken nu ook correct voor codes met prefix.
- `export.js`: lokale duplicate-functie `hoofdLetter()` verwijderd, alle aanroepers gebruiken nu `hoofdLetterCode()` uit `helpers.js`. Daarnaast fixt dit een sluimerende bug in `bouwKleurenMap`: functies met prefix-codes (zoals `.WB`) krijgen nu hun gedefinieerde kleur in de Excel-export, in plaats van de fallback-kleur.
- `helpers.js`: twee inline duplicates van dezelfde regex-keten in `fclass()` en `functieNaam()` vervangen door aanroepen van `hoofdLetterCode()`. De logica zit nu op één plek; toekomstige uitbreidingen aan de prefix-stripping (bv. een `XX`-prefix toevoegen) hoeven nog maar op één plek.

## v3.27.80 — Vrije-tekst velden veilig getoond

### Wijzigingen
- Nieuwe hulp-functie `esc()` in `helpers.js` die HTML-special characters (`& < > " '`) vervangt door hun entiteit. Veilig toepasbaar op vrije-tekst velden die in template-strings via innerHTML worden geinjecteerd.
- `esc()` toegepast op alle opmerking-achtige velden in de UI:
  - **wensen.js**: `w.opmerking` (twee plekken: kaart-weergave en sheet-textarea), `w.toelichting`.
  - **overzicht.js**: `wens.opmerking` in openCell, plus de bestaande inline-escapes vervangen door de volledige `esc()` (waren incompleet — alleen `<` werd vervangen, niet `>`, `"`, `&`).
  - **afdeling.js**: `dag.bespreking`, `dag.interventie`, `dag.opmerking` (zowel in summary-cards als in print-versie).
  - **dienst.js**: `interventie`.
  - **radioloog.js**: `dag.bespreking`, `dag.interventie`, `dag.opmerking`, en eigen cel-opmerking in toonDagDetail.
- Namen, codes, e-mailadressen en functie-labels zijn bewust **niet** geescaped — die zijn praktisch ASCII en een eventuele injectie daar zou direct visueel opvallen. Mocht dit later toch een issue worden, dan kan dezelfde `esc()` daar eenvoudig op toegepast worden.

## v3.27.79 — Schrijfrechten op indeling-docs versmald

### Wijzigingen
- Firestore rules op `indeling/{datum}` aangescherpt:
  - **Radioloog**: mag alleen `vakantie_v.<eigen radId>` schrijven (en `datum` bij create). Voorheen stond de rule óók `vakantie_v.<andere radId>`, `cel_opmerkingen.<elke radId>` en `opmerking` (dag-niveau) toe. De UI bood dit niet aan, maar via een directe Firestore-call was het wel mogelijk.
  - **Secretariaat**: geen schrijfrechten meer op indeling-docs. Voorheen mocht secretariaat de dag-opmerking schrijven, plus (door een gat in de oude check) ook andere velden zoals `vakantie_v`. Nu uitsluitend lezen.
  - **Beheerder**: ongewijzigd, blijft volledig beheer.
- `helpers.js` → `magOpmerkingen()` levert nu alleen `true` voor beheerder. Hierdoor verdwijnt de "Opmerking bewerken"-knop bij secretariaat-gebruikers (consistent met de rules).
- Twee oude rule-helpers `alleenOpmerkingGewijzigd` en `alleenOpmerkingEnWensenGewijzigd` vervangen door één nieuwe helper `radioloogMagVakantieToggelen` die specifiek checkt op de eigen radId-key binnen `vakantie_v`.

## v3.27.78 — Feestdag-validatie jaar-onafhankelijk

### Wijzigingen
- `validatie.js` checkte feestdagen alleen tegen `regel.feestdagen_2026` — dat hardgecodeerde jaar zou vanaf 2027 stille degradatie geven (geen waarschuwing meer voor ongebruikelijke codes op feestdagen in latere jaren). Vervangen door `regel[`feestdagen_${jaar}`]` waarbij het jaar uit de datum-string komt. Mits Firestore voor elk jaar een `feestdagen_YYYY`-veld bevat, werkt de check nu automatisch jaar-onafhankelijk.

## v3.27.77 — Versie-inconsistentie hersteld

### Wijzigingen
- `config.js` (APP_VERSIE) liep achter op `sw.js` (VERSION) en op de bestandsnaam van de release. Beide nu gelijkgetrokken op `3.27.77`. Het versielabel in login- en change-password-scherm toont vanaf nu hetzelfde nummer als de service worker cache.

## v3.26.0 — Excel-export: 2 weken + DECT in header

### Wijzigingen
- Export bevat nu **twee opeenvolgende weken** (huidige + volgende) in één sheet, elk met een eigen header-blok.
- Header per week heeft drie rijen: **DECT-nummer**, code, achternaam — gepakt uit `r.dect` (zelfde veld dat de Dienst-tab gebruikt).
- Linkerkolom van de eerste header-rij toont het **weeknummer** (vetgedrukt, groter).
- Bestandsnaam: `Weekoverzicht_<maandag wk1>_tm_<zondag wk2>.xlsx`.

## v3.25.0 — Excel-export met opmaak

### Wijzigingen
- Excel-export gebruikt nu de **xlsx-js-style** fork (vervangt SheetJS Community alleen voor de export). Hierdoor worden cell-styles wel weggeschreven naar het bestand.
- Header-rijen vetgedrukt met cyaan-grijze achtergrond en dikke onder-rand.
- Per dag een blok met **dikke randen** rondom; alternerende achtergrond (licht teal-groen / wit) voor visuele scheiding.
- Datum-kolom grijs, Dienst-kolom licht beige, Opmerking-kolom licht crème.
- Opmerking-kolom links uitgelijnd met word-wrap; overige cellen gecentreerd.

## v3.24.0 — Excel-export afdeling: per-rad layout

### Wijzigingen
- De Excel-export in de Afdeling-tab is herzien naar een layout met **kolommen per radioloog** (8 vaste stoelen) + Dienst + Opmerking, naar voorbeeld van het bestaande Excel-rooster van de afdeling.
- Per dag een blok van 6 rijen: dag-rij (ochtend-codes), middag-rij (alleen waar duo), cel-opmerking-rij, en **3 blanke rijen** voor handmatige time-stamped notities (bv. "12:00 Vaatbes").
- Twee header-rijen: codes (L, P, V, …) bovenop, achternamen eronder.
- Kolomtitels reflecteren de bezetting van de getoonde week (datum-aware via `vasteRadsOpDatum`).
- Privacy-filter (V/Z/K verbergen voor gebruikers zonder Overzicht-leesrecht) blijft van toepassing.

## v3.23.0 — Afdeling: weekoverzicht naar Excel

### Wijzigingen
- Naast de bestaande print-knop in de Afdeling-tab is er nu een **Excel-export-knop** (📂). Genereert een `.xlsx`-bestand met één sheet voor de huidige week — één kolom per dag, één regel per radioloog (functienaam — code · achternaam, met (afw) voor afwezigen) en de extras (waarnemers, bespreking, interventie, opmerking) onderaan elke kolom.
- Bestandsnaam: `Weekoverzicht_<maandag>_tm_<zondag>.xlsx`. SheetJS wordt lazy geladen vanaf de CDN.

## v3.22.0 — Gebruiker koppelen aan waarnemer

### Wijzigingen
- In de "+ Nieuw"- en "Rol wijzigen"-sheets is de "Gekoppeld aan"-dropdown uitgebreid met een groep **Waarnemers** (de actieve W-slots) naast de bestaande **Vaste radiologen**, zodat een gebruikersaccount aan een W-stoel gekoppeld kan worden.
- De huidige selectie blijft zichtbaar, ook als die naar een (nu) inactieve W-stoel wijst.

## v3.21.0 — Stoel-bezetting over tijd

### Datamodel
- `radiologen/{slotId}` krijgt een nieuw veld `bezetting_historie` met entries `{ voornaam, achternaam, code, vakantierecht, parttime_factor, van, tot }`. Bestaande records werken zonder migratie — top-level velden worden behandeld als één open entry.

### Helpers
- Nieuw: `bezettingOpDatum(slotId, datum)`, `naamVoorSlotOpDatum`, `bezettingenInRange`, `vasteRadsOpDatum`, `actieveInvallersOpDatum`. Bestaande `vasteRads()` / `actieveInvallers()` zijn nu wrappers met "vandaag" als peildatum.

### Gebruikers-tab
- Per vaste rad-rij een **Wissel**-knop: opent sheet om persoon op de stoel te wisselen vanaf een ingangsdatum (sluit oude entry, opent nieuwe). Pill onder de naam toont "vast sinds …".
- Per W-slot-rij een **Wissel**-knop (zelfde gedrag) plus een **→ Vast**-knop voor gevulde slots: opent migratie-sheet met preview en bevestiging.
- Migratie verhuist toewijzingen, vakantie_v, dienst-velden, wensen en gebruiker-koppeling vanaf de ingangsdatum van W-slot naar de gekozen vaste stoel; data van vóór de datum blijft staan.

### Render — datum-bewust
- **Overzicht-tab**: kolomnamen tonen nu de bezetting van die week (week-maandag als peildatum).
- **Vakantie-tab**: kolomnamen tonen de bezetting van de zichtbare maand.
- **Activiteit-tab**: bij meerdere bezettings-entries van een stoel binnen de gekozen periode worden er sub-kolommen per persoon aangemaakt, gelabeld met code + sub-periode. Aantallen worden per sub-periode geteld; dienst-rij, weekdag-aanwezigheid en aggregaties (werkvloer/maatschapsdagen/etc.) eveneens. Drilldown filtert ook op sub-periode.

## v3.20.0 — Activiteit: gemiddelde-symbool en hele getallen

### Wijzigingen
- **Kolomkop "Gemiddelde"** vervangen door symbool `x̄` (titel-tooltip "Gemiddelde"). Kolombreedte teruggebracht naar 44px.
- **Gemiddelde algebraïsch afgerond** op heel getal (half naar boven, via `Math.round`).

## v3.19.0 — Vakantie & Activiteit fixes

### Wijzigingen
- **Vakantie**: januari-weergave begint nu correct op 1 januari (i.p.v. 31 december — bug door tijdzone-conversie via `toISOString`).
- **Activiteit — definities**: achter "Maatschapsdagen" worden nu de werkelijk geselecteerde codes uit de Regels-tab getoond.
- **Activiteit — Max-kolom → Gemiddelde**: de laatste kolom toont nu het rij-gemiddelde (1 decimaal) i.p.v. het maximum. Ratio-modus gebruikt het gemiddelde als 100%-referentie.

## v3.18.0 — Vakantie-tab opschoning

### Wijzigingen
- **Maandnavigatie** gebruikt nu dezelfde witte `nav-btn`-pijltjes als in Overzicht, met meer ruimte rondom de maandtitel.
- **Ranking-rij** is continu in beeld zolang er ergens een ranking bekend is (valt terug op de meest recente eerdere rank), niet meer alleen wanneer er een X-dag in de zichtbare maand staat.
- **Ranking selecteren** kan nu door de beheerder onafhankelijk van de X-kolom — de dropdown is altijd beschikbaar (mits niet geaccordeerd).
- **Minimale bezetting** kan ook onafhankelijk van de X-kolom door de beheerder worden gewijzigd. Toont nu de werkelijke opgeslagen waarde (geen default 5).
- **∑-kolom verwijderd**: de lege kolom links van X is voor alle gebruikers verborgen. De saldo-info blijft zichtbaar in de sticky saldo-rij in de radioloog-kolommen.

## v3.14.5 — Twee codes per cel (ochtend/middag)

### Nieuw
Een cel in Overzicht kan nu twee codes bevatten — bijvoorbeeld B (Bucky) ochtend en M (Mammo) middag.

**Visueel in Overzicht-tab:**
- Diagonale streep linksonder → rechtsboven
- Eerste code linksboven (= ochtend)
- Tweede code rechtsonder (= middag)
- Eén code = vol blok zoals voorheen

**Picker (toggle-logica):**
- Klik op code → wordt eerste/tweede code (afhankelijk van wat al geselecteerd is)
- Klik op een code die al staat → die code gaat eruit
- Drie of meer codes wordt **genegeerd** — eerst eentje uitvinken
- Selectie-indicator boven de picker toont actuele keuze
- Sheet sluit pas op "Opslaan" of "Annuleren"

**Afdeling-tab:**
- Bij twee codes: functienaam voluit met `/`, bv. **Bucky/Mammo**
- Privacy-filter: als één van de codes V/Z/K is, blijft het hele item verborgen voor gebruikers zonder Overzicht-rechten

**Radioloog-tab:** toont al twee codes als twee badges naast elkaar (geen wijziging nodig)

### Datamodel
- `indeling/{datum}.toewijzingen[radId]` blijft een array — nu daadwerkelijk maximaal 2 codes
- Audit-log (`wijzigingen/`) registreert volledige array

### Code
- `slaToewijzingOp(datum, radId, code, opm)` accepteert nu zowel string als array
- Wens-matching gebruikt eerste code als hoofdcode

## v3.14.4 — Tab-zichtbaarheid via permissies

### Belangrijkste wijziging
Tab-zichtbaarheid wordt nu volledig bepaald door **permissies** in plaats van rol. Alle aanpassingen kun je doen via de Gebruikers-tab — niet meer in de code.

### Tab-regels
- **Overzicht**: zichtbaar als "Overzicht — wijzigen" of "Overzicht — bekijken" aanstaat
- **Radioloog**: alleen voor mensen met rol radioloog (vanwege koppeling aan eigen radioloog_id)
- **Afdeling + Dienst**: altijd zichtbaar voor iedereen
- **Activiteit**: voor radiologen en beheerders
- **Wensen**: voor radiologen, of beheerders met "Wensen van iedereen zien"
- **Regels / Gebruikers**: op basis van eigen permissie

### Nieuwe defaults voor nieuwe gebruikers
- **Beheerder**: alle permissies aan (ongewijzigd)
- **Radioloog**: "Overzicht — bekijken" standaard **AAN** (was uit) — ziet daardoor Overzicht-tab
- **Secretariaat**: "Overzicht — bekijken" standaard **UIT** (was aan) — ziet daardoor alleen Afdeling + Dienst
- **Technician**: alles uit (ongewijzigd)

Bestaande gebruikers behouden hun huidige permissies — pas ze handmatig aan in de Gebruikers-tab waar nodig.

### UI
- Permissie-labels:
  - "Beheer (rooster wijzigen)" → "Overzicht — wijzigen"
  - "Beheer (alleen-lezen)" → "Overzicht — bekijken"
- "Permissies → standaard voor rol" knop verborgen

### Privacy-filter Afdeling-tab
V/Z/K worden verborgen voor iedereen zonder Overzicht-leesrecht (niet meer op rol gebaseerd).

## v3.14.2 — Rollen, beperkt-zicht en wachtwoord-flow

### Nieuw

**Rol "Technician"** — vervangt "Lezer" als label. Bestaande `lezer`-gebruikers blijven werken (achterwaarts compatibel) en worden behandeld als technician.

**Beperkt zicht voor secretariaat + technician**
- Zien alleen tabs Overzicht, Afdeling, Dienst (geen Radioloog, Activiteit, Wensen, Regels, Gebruikers)
- In Afdeling-tab worden privacy-gevoelige codes (V/Z/K) niet getoond

**Standaard wachtwoord + eerste-login flow**
- Nieuwe gebruikers krijgen vast standaard wachtwoord `RoosterZMC` (geen random meer)
- Bij eerste login detecteert de app dit wachtwoord en forceert een wissel
- Twee invoervelden (nieuw + bevestigen) om typo's te voorkomen
- `valideerWachtwoord()` helper voorbereid voor latere uitbreiding (nu min. 6 tekens)

### Fixes
- Label "Weekradiologen" in Afdeling-tab is nu "Waarnemers"

### Datamodel
- Nieuw veld `gebruikers/{uid}.wachtwoord_gewijzigd` (bool) — false na aanmaken, true na eerste-login wissel

### Cloud Functions
- `gebruikerAanmaken` accepteert nu rol `technician` én `lezer` (compat)
- Schrijft `wachtwoord_gewijzigd: false` bij aanmaak

### Firestore rules
- Rol `technician` toegevoegd aan toegestane rollen voor `magLezen()`
- Bestaande `lezer` rol blijft werken

### Upgrade
1. Vervang `app/`, `index.html`, `config.js`, `firestore.rules`
2. Cloud Functions opnieuw deployen (`firebase deploy --only functions`)
3. Firestore rules publiceren via Firebase Console
4. Hard refresh (versie is nu 3.14.2)

# CHANGELOG

## v3.14.0 — Modulaire refactor

**Geen functionele wijzigingen.** De bestaande code uit één 3.400-regel
`index.html` is opgesplitst in 14 ES-modules onder `a