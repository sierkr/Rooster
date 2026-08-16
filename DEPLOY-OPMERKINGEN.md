# Deploy-stappenplan — v3.32.0 / v3.32.1 (ongelezen dag-opmerkingen)

> **Kom je van v3.32.0 en ga je naar v3.32.1?** Dan is stap 1 al gedaan en
> hoef je alleen stap 2 (app uploaden) te doen. De rules zijn in v3.32.1
> niet gewijzigd. Sla je v3.32.0 over en ga je van v3.31.1 rechtstreeks naar
> v3.32.1, dan gelden beide stappen gewoon.

Twee stappen: de app uploaden én de rules publiceren. De rules-stap is
**verplicht** — zonder die stap kan de app de leesstatus niet opslaan en blijft
elke opmerking eeuwig als ongelezen staan.

Geen functions-deploy nodig. Aan de `indeling`-documenten verandert niets, dus
er is ook geen datamigratie.

---

## Stap 1 — Rules publiceren (eerst!)

De nieuwe collectie `opmerking_gelezen` bestaat nog niet in de rules die er nu
live staan. Publiceer daarom eerst, anders krijgt iedereen die na de app-upload
op "Gelezen ✓" tikt een stille schrijffout in de console.

1. Open de [Firebase-console](https://console.firebase.google.com/) →
   project **rooster-radiologie** → **Firestore Database** → tabblad **Rules**.
2. Zorg dat je bovenaan de juiste database hebt geselecteerd.
3. Plak de volledige inhoud van `firestore.rules` uit deze zip.
4. **Publish**.
5. Herhaal dit voor de **andere** database. Er zijn er twee:
   - `(default)` — productie
   - `test` — testomgeving

Beide moeten. Sla je `test` over, dan werkt de functie in de testomgeving niet;
sla je `(default)` over, dan werkt hij in productie niet.

Het toegevoegde blok staat onderaan het bestand en is bewust klein:

```
match /opmerking_gelezen/{uid} {
  allow read, write: if isIngelogd() && request.auth.uid == uid;
}
```

Iedere gebruiker mag uitsluitend bij zijn eigen document. Er is bewust géén
uitzondering voor beheerders: dit is privé leesgedrag en dat hoort voor niemand
inzichtelijk te zijn.

## Stap 2 — App uploaden

Upload de zip-inhoud (zonder `Rooster-functions`, zoals altijd) eerst naar
**Rooster-test**, controleer, en daarna naar **Rooster**. Inclusief de mappen
`.github` en `tests`, net als bij v3.31.0.

Gewijzigde bestanden in deze release:

| Bestand | Wat |
|---|---|
| `config.js`, `sw.js` | versienummer 3.32.0 |
| `firestore.rules` | nieuw collectieblok |
| `index.html` | CSS voor de pulserende markering, de balk en het Was/Nu-blok |
| `app/state.js` | drie state-velden |
| `app/helpers.js` | statusbepaling, tellingen, opschonen |
| `app/main.js` | listener, tab-badge, schuifje in het profielpaneel |
| `app/save.js` | schrijven van de leesstatus, eigen tekst auto-gelezen |
| `app/views/overzicht.js` | balk, markering, panelen, bevestigknop |
| `tests/unit/opmerkingen.test.mjs` | nieuw (21 tests) |
| `tests/rules/rules.test.mjs` | 6 tests erbij |

---

## Stap 3 — Controleren

In de testomgeving, ingelogd als beheerder:

1. Ga naar **Overzicht** en zet een opmerking op een dag in de huidige week.
   Sla op. → De balk toont een **grijze** regel met vinkje, "1 opmerking deze
   week — tik voor details": wat je zelf schrijft is meteen gelezen.
2. Log in als een andere gebruiker (of gebruik een tweede browser). → De balk
   is daar **blauw** ("1 van 1 opmerkingen niet gelezen") en het driehoekje bij
   die dag is groter en knippert.
3. Tik de dag aan, lees de opmerking, tik **Gelezen ✓**. → Balk wordt grijs
   (hij verdwijnt niet), driehoekje weer klein en stil.
4. Wijzig als beheerder de tekst van diezelfde opmerking. → Bij de andere
   gebruiker komt de waarschuwing terug, en het paneel toont "Was" (doorgehaald)
   en "Nu".
5. Tik op je initialen rechtsboven → schuifje **Ongelezen dag-opmerkingen
   buiten deze week melden** aan. → Er verschijnt een blauwe teller op de
   Overzicht-tab met alle ongelezen dagen vanaf vandaag.

Gaat stap 2 niet op maar zie je in de browserconsole een
`permission-denied` op `opmerking_gelezen`, dan is stap 1 niet (of op maar één
database) uitgevoerd.

---

## Wat gebruikers de eerste dag merken

Alle bestaande dag-opmerkingen vanaf vandaag beginnen als ongelezen. Dat is een
bewuste keuze: er wordt niets stilzwijgend als gelezen weggezet. Omdat de
melding standaard alleen naar de zichtbare week kijkt, zijn dat er nooit meer
dan zeven tegelijk.

Zet iemand het schuifje voor melden buiten de week aan, dan ziet die persoon in
één keer het volledige restant vanaf vandaag. Dat is dan een eigen keuze en het
getal loopt vanzelf terug bij het bevestigen.

## Terugdraaien

De vorige versie terugzetten kan zonder verdere actie: upload de app-bestanden
van v3.31.1 opnieuw. De rules mogen blijven staan — het extra blok raakt niets
anders. De documenten in `opmerking_gelezen` blijven onaangeroerd achter en
worden weer gebruikt zodra v3.32.0 opnieuw wordt geplaatst.
