# Tests (v3.31.0, fase 4)

Twee testlagen die automatisch draaien via GitHub Actions bij elke upload
(zie `.github/workflows/tests.yml`). Je hoeft hier zelf niets voor te doen —
kijk na een upload in het tabblad **Actions** van de repo of alles groen is.

## tests/unit/ — 63 unit-tests op de rekenlogica

Draaien puur op Node.js, zonder Firebase. Dekken: datum-helpers
(ISO-weeknummers, jaargrenzen, schrikkeljaren), functiecode-reductie,
wens-matching, stoel-tijdlijnen (incl. de W1/GJG-casus van juli 2026 als
blijvende regressietest), de volledige validatie-engine (alle regeltypes)
en de beveiligingshelpers (esc, wachtwoordbeleid, permissies).

Lokaal draaien (optioneel): `node --test tests/unit/*.test.mjs`

## tests/rules/ — 22 rules-tests tegen de Firestore-emulator

Een rollen-matrix die verifieert wat beheerder, radioloog en lezer wel en
niet mogen volgens `firestore.rules`: schema-bewaking op indeling-docs, de
vakantie-toggle-beperking, het aangescherpte wijzigingen-log, de
onschrijfbaarheid van audit_log, en de eigen-profiel-whitelist. Plus één
K1-test die bewijst dat een merge op één cel de cel van een collega intact
laat. Draait tegen een lokale nep-database; raakt nooit echte data.

## Aandachtspunt

`app/package.json` (type: module) is nodig zodat Node de app-modules kan
importeren; browser en app negeren dat bestand. De tests- en .github-mappen
staan mee in de repo (nodig voor CI) maar zijn geen onderdeel van de app.
