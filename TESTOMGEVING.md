# Testomgeving Rooster

Een geïsoleerde testomgeving om wijzigingen te bekijken voordat ze live gaan.
Twee reviewers kunnen meekijken met hun eigen, bestaande account.

## Hoe het werkt (vanaf v3.27.101)

- **Eén `config.js` voor beide omgevingen.** De app bepaalt de omgeving
  automatisch uit de URL — je hoeft bij het uploaden NOOIT meer iets handmatig
  om te zetten:
  - `https://sierkr.github.io/Rooster-test/` → **TEST**, schrijft naar de
    `test`-database, met een oranje "TESTOMGEVING"-balk bovenaan.
  - `https://sierkr.github.io/Rooster/` → **PRODUCTIE**, schrijft naar de
    `(default)`-database.
  - Een onbekende URL → de app **blokkeert zichzelf** (rood scherm), zodat er
    nooit per ongeluk naar de verkeerde database geschreven wordt.
- `config.test.js` bestaat niet meer en is niet meer nodig.

## Uploaden / deployen

Upload **exact dezelfde** bestanden (dezelfde zip-inhoud) naar beide repos:
- `Rooster`      → productie-URL
- `Rooster-test` → test-URL

Geen enkel bestand hoeft per repo te worden aangepast. De URL beslist de
omgeving. Controle achteraf: op de test-URL hoor je de oranje balk en het
`-TEST`-label te zien; op productie niet.

## Eenmalige inrichting van de test-database

1. **Named database `test`** aanmaken in de Firebase-console, zelfde regio als
   `(default)`.
2. Dezelfde `firestore.rules` op de `test`-database publiceren (rules zijn per
   database).
3. **Eerste beheerder bootstrappen**: in de `test`-database handmatig één
   document `gebruikers/{jouw-auth-uid}` aanmaken met o.a. `rol: "beheerder"`
   (zelfde uid als productie, want het project is gedeeld).
4. **Data vullen**: open productie → Beheer → maak een backup; open de test-URL
   → Beheer → "Backup terugzetten". Dit schrijft alleen in de `test`-database.

## Veiligheid

- Account-Cloud-Functions (gebruiker aanmaken/verwijderen/wachtwoord) blijven in
  test geblokkeerd, omdat die server-side altijd de live database + Auth raken.
- Onbekende omgeving = app geblokkeerd (fail-safe).
- Backup maken is altijd veilig (lezen). Een restore schrijft alleen in de
  database van de omgeving waarin je op dat moment zit.
