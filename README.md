
# maps-converter

`maps-converter` kann SVG-Tiles weiter batchweise rendern und stellt jetzt zusätzlich eine `@fsarch/server`-basierte REST-API für On-Demand-Rendering bereit.

## REST API

1. `npm install`
2. `cp config.example.yaml config.yaml` und die `database:`-Zugangsdaten eintragen (siehe [Datenbank](#datenbank))
3. `npm run build`
4. Eine aktive `dataset_versions`-Zeile anlegen (siehe [Datasets und Themes](#datasets-und-themes)) — ohne sie startet die API nicht
5. `npm start`

Standardroute:

```text
GET /v1/tiles/:z/:x/:y.svg
```

Beispiel:

```text
http://127.0.0.1:3000/v1/tiles/0/0/0.svg
```

Swagger:

```text
http://127.0.0.1:3000/docs
```

Die Laufzeitkonfiguration liegt in `config.yaml` (gitignored, nie committen — Vorlage: `config.example.yaml`).

## Datenbank

`npm start` (die REST-API) benötigt eine erreichbare Postgres-Datenbank — nicht für die Kartendaten selbst (die kommen weiterhin ausschließlich aus `planet.pmtiles`), sondern als geteilter, persistenter Cache für kachelübergreifend aufgelöste Label-Positionen (z. B. große Naturschutzgebiete, die über viele Kacheln verteilt sind). Migrationen laufen beim Start automatisch (`migrationsRun: true`).

`npm test` und `npm run render` (Batch-CLI) benötigen **keine** Datenbank.

```yaml
database:
  type: postgres
  host: localhost
  port: 5432 # muss explizit gesetzt werden, sonst Default 26257 (CockroachDB)
  username: maps_converter
  password: ...
  database: maps_converter
```

## Datasets und Themes

Der Pfad zur `planet.pmtiles`-Datei kommt nicht mehr aus `config.yaml` (kein `tiles.input` mehr), sondern ausschließlich aus der `dataset_versions`-Tabelle — genau eine Zeile ist per `is_active` aktiv. Es gibt noch keine Verwaltungs-API dafür; Zeilen werden direkt per SQL angelegt/aktiviert:

```sql
INSERT INTO dataset_versions (id, path, is_active)
VALUES (gen_random_uuid(), './planet.pmtiles', true);
```

Ein Wechsel der aktiven `dataset_versions`-Zeile wird erst nach einem Neustart der API wirksam (die einmal geöffnete PMTiles-Archiv-Datei wird nicht zur Laufzeit ausgetauscht) — genau wie früher bei einer Änderung von `tiles.input`.

Farben (Wasser, Land, Straßen nach Klasse, Gebäude, Landuse, Labels — siehe `THEMEABLE_COLOR_VARIABLES` in `src/core/styles.ts`) sind unabhängig davon per **Template** änderbar, ganz ohne Neu-Rendern: jede Kachel wird intern immer mit CSS-Variablen (`fill="var(--map-water, #9ecfff)"`) gerendert; das aktive Template liefert nur noch die konkreten Werte, die als `<style>`-Block in die fertig gerenderte SVG eingefügt werden — der letzte Schritt vor der Auslieferung, getrennt vom eigentlichen Rendering. Ein Template-Wechsel wirkt sofort, ohne Neustart.

```sql
INSERT INTO templates (id, name, colors, is_active)
VALUES (
  gen_random_uuid(),
  'dark',
  '{"--map-background": "#111111", "--map-water": "#1c3f5f"}'::jsonb,
  true
);
```

Unbekannte Variablennamen oder Werte, die nicht wie eine gültige CSS-Farbe aussehen, werden beim Einfügen ignoriert (dieses eine Element bleibt dann bei seiner Default-Farbe) statt den Request fehlschlagen zu lassen. Kein aktives Template = alle Farben bleiben beim bisherigen Aussehen.

Ein bestimmtes Template lässt sich auch direkt in der URL anfordern, unabhängig davon, welches gerade aktiv ist:

```text
GET /v1/templates/:id/tiles/:z/:x/:y.svg
```

```text
http://127.0.0.1:3000/v1/templates/2652ce08-e781-415a-8a58-ec7e6d24b35e/tiles/0/0/0.svg
```

`:id` ist die `id`-Spalte der `templates`-Tabelle (uuid) — bei ungültigem Format 400, bei unbekannter id 404. `GET /v1/tiles/:z/:x/:y.svg` (ohne Template in der URL) bleibt unverändert und nutzt weiterhin das gerade aktive Template.

Fertige, copy-paste-bereite Templates (alle kuratierten Variablen abgedeckt) liegen in `src/database/seeds/`:

- `default-template.sql` — reproduziert das bisherige, hart kodierte Aussehen 1:1 (nützlich als Ausgangspunkt zum Anpassen, oder als Referenz für die Default-Werte jeder Variable).
- `dark-template.sql` — ein Dark-Mode-Farbschema für dieselben Variablen.
- `activate-template.sql` — aktiviert ein Template per Name (deaktiviert dabei automatisch das vorher aktive).

```bash
psql "$DATABASE_URL" -f src/database/seeds/default-template.sql
psql "$DATABASE_URL" -f src/database/seeds/dark-template.sql
# aktives Template wechseln (Name im Skript anpassen, Default ist 'default'):
psql "$DATABASE_URL" -f src/database/seeds/activate-template.sql
```

## Example Viewer

```bash
npm run example
```

Der Viewer lädt Tiles über `GET /v1/tiles/:z/:x/:y.svg` vom API-Server und kann bei Bedarf mit `--api-base` auf eine andere URL zeigen.
Zoom und Kartenposition werden im URL-Hash gespeichert, damit ein Reload dieselbe Ansicht wiederherstellt.

## Batch Rendering

```bash
node ./dist/cli/index.js --input planet.pmtiles --output ./output --max-zoom 19 --labels --road-labels --concurrency 6 --nature-labels
```
