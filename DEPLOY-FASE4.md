# Deploy-stappenplan — v3.31.0 (Fase 4: testpakket + CI)

De eenvoudigste deploy tot nu toe: alleen app-bestanden uploaden.
Geen rules-stap, geen functions-stap. Nieuw is dat er twee extra mappen
mee moeten: `.github` en `tests`.

---

## Stap 1 — Uploaden

Upload de zip-inhoud (zonder `Rooster-functions`, zoals altijd) naar
**Rooster-test** en daarna naar **Rooster**. Dit keer horen daar dus bij:

- de map `.github` (met daarin `workflows/tests.yml`)
- de map `tests`
- het nieuwe bestandje `app/package.json`

Let op bij slepen via de GitHub-website: mappen die met een punt beginnen
(`.github`) worden door Windows soms verborgen — zet zo nodig "Verborgen
items" aan in de Verkenner (tabblad Beeld). Versielabel na uploaden: **3.31.0**.

## Stap 2 — Controleer dat de tests draaien

1. Open op GitHub de repo → tabblad **Actions**.
2. Na je upload verschijnt daar vanzelf een run "Tests" met twee jobs:
   - **Unit-tests (rekenlogica)** — hoort direct groen te zijn (deze 63
     tests zijn bij het bouwen al succesvol gedraaid).
   - **Firestore rules-tests (emulator)** — eerste run duurt enkele minuten
     (emulator wordt gedownload). Deze job is bewust nog *niet-blokkerend*.
3. Zie je geen "Actions"-tabblad of geen run: check of de map
   `.github/workflows` echt in de repo staat.

## Stap 3 — Vanaf nu: het vinkje als vaste stap in je workflow

Nieuwe routine bij elke toekomstige release:

1. Upload naar **Rooster-test** → wacht op het vinkje onder Actions.
2. Vinkje groen + handmatige controle op de test-URL goed → upload naar
   **Rooster** (productie).
3. Rood kruis → klik erop, kijk welke test faalt, en meld de foutmelding
   bij mij vóórdat je verder gaat.

## Stap 4 — Emulator-job blokkerend maken

✔ Afgehandeld in v3.31.1: de rules-job draaide op 19-07-2026 groen in de
test-repo en `continue-on-error` is verwijderd. Elke test-fout — unit óf
rules — telt nu als rood kruis.

---

## Aandachtspunten

- De tests draaien op GitHub's servers tegen een nep-database; ze raken
  nooit je echte Firestore-data en kosten niets (Actions is gratis voor
  publieke repos, en ruim voldoende gratis minuten voor private).
- De mappen `tests` en `.github` zijn geen onderdeel van de app; GitHub
  Pages serveert ze wel, maar er staat niets gevoeligs in.
- Faalt de rules-job structureel met een omgevings- of installatiefout
  (niet met een echte testfout), plak dan de log bij mij — de emulator kon
  in mijn bouwomgeving niet vooraf gedraaid worden, dus een eerste-run-
  correctie is denkbaar. Daarom staat hij op niet-blokkerend.
