# Deploy-stappenplan — v3.30.0 (Fase 3: verharding)

Twee verplichte onderdelen (functions + app) en twee optionele
verbeteringen (vendor-bestanden, App Check). Geen rules-wijziging.
Reminder: de map `Rooster-functions` gaat NIET mee naar GitHub.

---

## Stap 1 — Cloud Functions deployen (met Node 22-upgrade)

Zelfde routine als bij fase 1 (2d–2f), met één extra aandachtspunt: de
dependencies zijn vernieuwd, dus `npm install` is dit keer verplicht.

1. Pak de zip uit naar een aparte deploy-map (niet je GitHub-upload-map).
2. Opdrachtprompt:
   ```
   cd <deploy-map>\Rooster-functions\functions
   npm install
   cd ..
   firebase deploy --only functions
   ```
   `npm install` vernieuwt ook het oude package-lock.json automatisch.
3. In de deploy-output hoort nu **Node.js 22** te staan bij alle functies.
   De waarschuwingen over Node 20-deprecatie en een verouderde
   firebase-functions uit de vorige deploy zijn hiermee verholpen.
4. Mislukt de deploy met een melding over de firebase-tools-versie:
   `npm install -g firebase-tools` (bijwerken) en opnieuw proberen.

## Stap 2 — App-bestanden uploaden

Zoals gewend: zip-inhoud (zonder `Rooster-functions`) naar **Rooster-test**,
testen, dan naar **Rooster**. Versielabel: **3.30.0**.
Nieuw in de upload: de map `vendor/` (met alleen een LEESMIJ.txt tot je
stap 4 doet) — gewoon meenemen.

## Stap 3 — Verificatie (testomgeving)

1. **CSP:** open de app en controleer dat alles normaal werkt (inloggen,
   Overzicht, cel wijzigen, Excel-export). Werkt iets opeens niet en zie je
   in de browser-console (F12) een "Content Security Policy"-melding, meld
   het dan — de meta-tag in index.html verwijderen is de noodrem.
2. **Wachtwoord-reset (in productie testen na stap 5, of nu in test met een
   testaccount als de functies daar bereikbaar zijn):** Beheer → 🔑 bij een
   gebruiker → er verschijnt een willekeurig tijdelijk wachtwoord dat je
   eenmalig kunt kopiëren.
3. **Nieuwe gebruiker:** het formulier stelt een willekeurig tijdelijk
   wachtwoord voor (geen RoosterZMC meer).
4. **Eerste-login-scherm:** een nieuw wachtwoord korter dan 12 tekens wordt
   geweigerd.
5. **esc()-pass:** namen en opmerkingen met rare tekens (&, <, >) worden
   overal correct getoond.

## Stap 4 — Optioneel maar aanbevolen: vendor-bestanden

Maakt Excel-import/-export CDN-onafhankelijk en offline-werkend.

1. Download in je browser:
   - https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
   - https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js
2. Zet beide bestanden in de map `vendor/` (exact deze namen).
3. Upload de vendor-map mee naar beide repos. Klaar — de app pakt ze
   automatisch op; zonder deze stap blijft alles via CDN werken.

## Stap 5 — Optioneel: App Check aanzetten

Bindt al het Firestore/Functions-verkeer aan jouw webapp (blokkeert
scripts/tools van derden met gestolen API-config).

1. Firebase-console → **App Check** → registreer de web-app met
   **reCAPTCHA v3** → je krijgt een *site key*.
2. Zet die key in `config.js`: `window.APPCHECK_SITE_KEY = '...';` en
   upload config.js opnieuw naar beide repos.
3. Draai enkele dagen in "monitor"-modus (console toont het percentage
   geverifieerde verzoeken). Pas als dat ~100% is: in de console
   **Enforce** aanzetten voor Firestore en Cloud Functions.
   NIET direct enforcen — dan sluit je gebruikers met een nog gecachte
   oude app-versie buiten.

## Stap 6 — Productie

App-upload naar de productie-repo; verificatie 1 t/m 3 kort herhalen.

---

## Bekende aandachtspunten

- **Gefaseerde uitrol functions/app:** deploy je de functions vóór de
  app-upload, dan werkt de wachtwoord-reset in de tussentijd al wél maar
  toont de oude app alleen "gereset" zonder het tijdelijke wachtwoord.
  Doe stap 1 en 2 daarom kort na elkaar.
- **Wachtwoord-reset-melding:** het tijdelijke wachtwoord is daarna echt
  nergens meer op te vragen — direct noteren/doorgeven.
- **CSP is bewust streng:** voeg je later een nieuwe externe bron toe
  (script of API), dan moet die ook in de CSP-regel in index.html.
