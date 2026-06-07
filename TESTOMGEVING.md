# Testomgeving Rooster

Een geïsoleerde testomgeving om structurele en interface-wijzigingen te
bekijken voordat ze live gaan (bv. een kolom verwijderen, een radioloog
verwijderen en het opschuiven in het overzicht, of een nieuwe opzet van de
interface). Twee reviewers kunnen meekijken met hun eigen, bestaande account.

## Hoe het werkt

- **Hetzelfde Firebase-project**, dus dezelfde inlog-accounts — geen nieuwe
  testlogins nodig.
- Een **aparte Firestore named database `test`** binnen dat project. De app
  leest en schrijft daar uitsluitend; de live `(default)`-database blijft
  ongewijzigd.
- De **test-branch** op GitHub Pages serveert de (eventueel experimentele)
  interface met `config.test.js`. De productie-URL blijft onaangeroerd.
- **Account-Cloud-Functions zijn in test geblokkeerd.** Gebruiker
  aanmaken/verwijderen/wachtwoord-reset draaien server-side altijd op de live
  database + Auth; daarom weigeren ze met een duidelijke melding zodra de app in
  testmodus draait. Alle andere acties (radiologen, kolommen, indeling, wensen,
  vakantie, regels, import/export) werken volledig in de test-database.

> Snapshot, geen live spiegel: je vult de test-database met een kopie van de
> actuele productie-data. Die kopie drijft daarna af van productie — ververs hem
> wanneer je weer met actuele data wilt testen (zie "Data verversen").

## Eenmalige inrichting

1. **Named database aanmaken**
   Firebase Console → Firestore → databases → nieuwe database met id `test`,
   in dezelfde regio (`europe-west1`).

2. **Security rules publiceren op `test`**
   Publiceer dezelfde `firestore.rules` op de `test`-database. De rules zijn
   per database; zonder dit kan niemand lezen/schrijven in test.

3. **Eerste beheerder bootstrappen**
   De `test`-database start leeg, dus er is nog geen rol die schrijven toestaat.
   Maak in de Console handmatig één document aan in de `test`-database:
   `gebruikers/{jouw-auth-uid}` met o.a. veld `rol: "beheerder"`.
   (Je auth-uid vind je in Firebase Console → Authentication. Het is hetzelfde
   account/uid als in productie, omdat het project gedeeld is.)

4. **Test-branch met config.test.js**
   Maak een `test`-branch (of een `/test/`-submap) op GitHub Pages. Kopieer daar
   `config.test.js` over `config.js` heen, zodat `index.html` ongewijzigd de
   testconfig laadt. Deze branch gebruik je ook om een nieuwe interface-opzet te
   tonen.

## Data verversen (snapshot van productie)

1. Open de **productie**-app, ga naar Beheer → backup en maak een
   (versleutelde) backup. Bewaar het wachtwoord.
2. Open de **test**-app (test-URL), log in en ga naar Beheer → "Backup
   terugzetten". Zet de zojuist gemaakte productie-backup terug.
   Dit schrijft uitsluitend in de `test`-database.
3. Klaar: de testomgeving bevat nu een actuele kopie. Herhaal wanneer je weer
   met verse data wilt testen.

> De ingebouwde backup dekt: radiologen, functies, indeling, wensen,
> gebruikers, instellingen, validatie_regels, besprekingen. De
> `gebruikers`-documenten verwijzen naar dezelfde auth-uid's als productie,
> dus de rollen van beide reviewers werken meteen na het terugzetten.

## Reviewers

Beide reviewers openen de **test-URL** en loggen in met hun normale account.
Omdat hun rol uit de meegekopieerde `gebruikers`-documenten komt, hebben ze in
test dezelfde rechten als in productie.

## Terug naar productie

De productie-branch gebruikt gewoon `config.js` (zonder `FIRESTORE_DB`). Niets
aan de live-omgeving verandert door het bestaan van de testomgeving.
