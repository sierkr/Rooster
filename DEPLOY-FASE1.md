# Deploy-stappenplan — v3.28.0 (Fase 1: K1, K2, K3, M4)

Deze release bestaat uit DRIE onderdelen die alle drie nodig zijn:
app-bestanden, Firestore-rules en Cloud Functions. Volg de volgorde
hieronder exact; test eerst volledig op de test-URL.

---

## Stap 1 — Rules publiceren (eerst!)

De nieuwe app-code schrijft wijziging-records met een vaste veldenset die de
nieuwe rules eisen — maar de OUDE rules accepteren die records ook gewoon.
Andersom accepteren de NIEUWE rules ook de writes van de oude app-versie
niet in alle gevallen (de oude save.js schreef complete maps). Publiceer
daarom de rules en de app-bestanden kort na elkaar, rules eerst is prima,
maar rond beide stappen in één sessie af.

1. Open de Firebase-console → Firestore Database → Rules.
2. Plak de inhoud van `firestore.rules` en publiceer op de **(default)**
   database.
3. Wissel linksboven naar de named database **test** en publiceer daar
   exact dezelfde rules (rules zijn per database!).

## Stap 2 — Cloud Functions deployen

In de map `Rooster-functions/`:

```
cd Rooster-functions
firebase deploy --only functions
```

Dit deployt naast de bestaande functies de nieuwe trigger **auditIndeling**
(regio europe-west1). Controleer na afloop in de console (Functions) dat
`auditIndeling` in de lijst staat.

Opmerkingen:
- De trigger luistert alleen op de **(default)** database. De testomgeving
  (named database `test`) valt buiten het audit-spoor; dat is bewust.
- `firebase-functions` ^5.x is vereist (staat al in package.json). Draai bij
  twijfel eenmalig `npm install` in `Rooster-functions/functions/`.

## Stap 3 — App-bestanden uploaden

Zoals altijd: upload exact dezelfde bestanden naar **Rooster-test** en test
daar eerst; daarna naar **Rooster** (productie). Hard refresh (Ctrl+F5).
Versielabel moet **3.28.0** (test: 3.28.0-TEST) tonen.

## Stap 4 — Verificatie (testomgeving)

1. **K1:** open de app in twee browservensters als twee verschillende
   beheerders. Wijzig in venster A een cel van radioloog L op dag X; wijzig
   vrijwel tegelijk in venster B een cel van radioloog P op dezelfde dag.
   Beide wijzigingen moeten blijven staan.
2. **K2 (rules):** probeer via de app een normale celwijziging (moet werken).
   De schema-check merk je alleen als iets fout zit — normale werking is de test.
3. **K2 (import):** importeer een Excel met een bekend blokkerend conflict
   (bv. tweemaal dezelfde uniciteitscode op één dag). De preview moet een
   rode lijst "Blokkerende regelconflicten" tonen en de bevestigingsdialoog
   moet ze benoemen.
4. **K3:** maak in productie (ná stap 2+3, of in test kun je dit pas na een
   aparte test-deploy van de trigger zien) een celwijziging en controleer in
   de Firebase-console dat er in `audit_log` een record verschijnt met jouw
   auth_uid en de van/naar-diff.
5. **M4:** log in als radioloog en controleer dat vakantie toggelen,
   agenda-link genereren en eerste-login-wachtwoordwissel gewoon werken.

## Stap 5 — Productie

Herhaal stap 3 voor de productie-repo en voer verificatie 1 en 4 nogmaals
kort uit op de productie-URL.

---

## Bekende aandachtspunten

- **Restore van oude backups.** De nieuwe schema-check op indeling-docs
  staat bij een UPDATE (bestaand doc overschrijven) alle bekende situaties
  toe, maar bij een CREATE (restore naar een lege/nieuwe database) worden
  alleen de bekende veldnamen geaccepteerd. Strandt een restore van een zeer
  oude backup hierop, publiceer dan tijdelijk de vorige rules, doe de
  restore, en zet de nieuwe rules terug.
- **audit_log groeit onbegrensd.** Bewust append-only. Opruimen (bv. ouder
  dan X jaar) kan later server-side; verwijderen kan alleen met de Admin SDK.
- **wijzigingen-collectie:** de oude app-versie (≤3.27.x) kan na de
  rules-publicatie geen wijziging-records meer schrijven als een gebruiker
  nog een oude tab open heeft (create-rule eist nu de vaste veldenset —
  de oude versie schreef dezelfde velden, dus in de praktijk werkt ook dat
  nog; alleen echt afwijkende/handmatige writes worden geweigerd).
