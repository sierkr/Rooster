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