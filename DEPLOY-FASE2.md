# Deploy-stappenplan — v3.29.0 (Fase 2: H1, H2, offline)

Goed nieuws: deze release heeft **geen** rules- of functions-stap.
Alleen app-bestanden uploaden, plus één eenmalige console-actie
(automatische backups). De map `Rooster-functions` hoeft — zoals altijd —
**niet** mee naar GitHub.

---

## Stap 1 — App-bestanden uploaden

Zoals gewend: upload de inhoud van de zip (zonder `Rooster-functions`) naar
**Rooster-test**, test daar, daarna naar **Rooster** (productie).
Hard refresh (Ctrl+F5). Versielabel moet **3.29.0** tonen (test: 3.29.0-TEST).

## Stap 2 — Verificatie (testomgeving)

1. **Normale werking:** Overzicht, week vooruit/terug, cel wijzigen — alles
   hoort te werken zoals voorheen.
2. **Datumvenster:** navigeer met de week-pijlen ver terug (bv. 2+ jaar).
   De eerste keer is het raster heel even leeg en vult zich dan vanzelf —
   dat is het venster dat uitbreidt. Daarna is het direct.
3. **Offline:** laad de app, zet daarna je netwerk uit (vliegtuigstand of
   wifi uit). Herlaad de pagina: het rooster moet zichtbaar blijven met de
   laatst bekende data. Zet het netwerk weer aan.
4. **Restore-keuze:** Beheer → Backup terugzetten → na het wachtwoord
   verschijnt nu de vraag "Volledige terugzetting?" — annuleer de test of
   probeer hem in de testomgeving met een verse backup.

## Stap 3 — Automatische backups aanzetten (eenmalig, alleen productie)

Dit dekt structureel het risico af van vergeten handmatige backups of een
kwijtgeraakt backup-wachtwoord. Twee onderdelen, allebei aanbevolen:

### 3a. Point-in-time recovery (PITR)

Hiermee kan Google elke toestand van de afgelopen 7 dagen terugzetten.

1. Ga naar https://console.cloud.google.com → project **rooster-radiologie**.
2. Menu → **Firestore** → **Disaster Recovery** (of "Noodherstel").
3. Zet **Point-in-time recovery** aan voor de **(default)** database.

### 3b. Geplande dagelijkse backups

1. Op dezelfde Disaster Recovery-pagina: kies **Backups plannen**
   ("Scheduled backups").
2. Database: **(default)** · Frequentie: **dagelijks** · Bewaartermijn:
   bv. **7 weken** (maximum bij dagelijks).
3. Bevestig.

Lukt het niet via de console, dan kan het ook met één opdracht in de
**Cloud Shell** (het >_-icoon rechtsboven in de Google Cloud console):

```
gcloud firestore backups schedules create \
  --database='(default)' --recurrence=daily --retention=7w
```

Kosten: enkele centen tot ~een euro per maand bij deze datagrootte.
De handmatige, versleutelde JSON-backup vóór elke import blijft gewoon
bestaan en behoudt zijn nut (lokale kopie in eigen beheer).

## Stap 4 — Productie

Herhaal stap 1 voor de productie-repo en doe verificatie 1 t/m 3 kort op de
productie-URL.

---

## Bekende aandachtspunten

- **Eerste start na de update** bouwt de lokale cache (IndexedDB) op; daarna
  zijn starts juist sneller. In private browsing is er geen persistente
  cache; de app werkt dan zoals vóór deze release.
- **Meerdere tabbladen** delen dezelfde cache (multi-tab manager); dat is
  ondersteund en veilig.
- **Offline is de app feitelijk alleen-lezen in de praktijk**: wijzigen kan,
  maar wordt pas doorgestuurd (en door de server gelogd) zodra er weer
  verbinding is. Voor kritieke wijzigingen: controleer dat je online bent.
- **PITR/geplande backups gelden per database** — voor de testdatabase is
  dit bewust niet nodig.
