
# tile-render-server

`tile-render-server` kann SVG-Tiles weiter batchweise rendern und stellt jetzt zusätzlich eine `@fsarch/server`-basierte REST-API für On-Demand-Rendering bereit.

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
  username: tile_render_server
  password: ...
  database: tile_render_server
```

## Storage

Die REST-API liest/schreibt zwei unabhängig konfigurierbare Storage-Backends (`src/storage/`, angelehnt an das Storage-Modul von `image-server`) — jeweils lokales Dateisystem oder S3, frei mischbar:

```yaml
storage:
  data: .          # Basis für dataset_versions.path (siehe unten)
  cache: ./cache   # gerenderte (ungestylte) SVG-Kacheln
```

Beide akzeptieren wahlweise einen bloßen String (Kurzform für lokales Dateisystem) oder die explizite Form mit S3:

```yaml
storage:
  data:
    type: s3
    config:
      bucket: my-pmtiles-bucket
      region: eu-central-1
      accessKeyId: ...       # optional bei IAM-Rollen/Standard-AWS-Credentials
      secretAccessKey: ...   # nur zusammen mit accessKeyId
      endpoint: https://...  # optional, für S3-kompatible Dienste (MinIO etc.)
      prefix: datasets/      # optional
```

`storage.cache` speichert dort die **gerenderte, noch ungestylte** Kachel (Schlüssel `{datasetVersionId}/{z}/{x}/{y}.svg`) — genau das, was die Trennung von Rendering und Styling (siehe unten) überhaupt erst ermöglicht: ein Cache-Eintrag bedient jedes Template, ein Template-Wechsel invalidiert den Cache nie. Der Ordner/Bucket muss nicht vorbefüllt werden, er füllt sich bei Bedarf.

**Nur `storage.cache`** (nicht `storage.data`) akzeptiert zusätzlich einen `memory`-Backend-Typ sowie eine Liste mehrerer Schichten, die der Reihe nach durchsucht werden:

```yaml
storage:
  cache:
    - type: memory
      config:
        maxItems: 1000       # optional, Default 1000
        maxBytes: 134217728  # optional, Default 128 MiB
    - ./cache                # oder S3 — jede der obigen Formen ist als weitere Schicht erlaubt
```

Beim Lesen wird Schicht für Schicht geprüft — "schau zuerst im Memory-Cache, wenn dort nichts ist, schau in der nächsten Cache-Schicht". Ein Treffer in einer langsameren Schicht wird automatisch in alle schnelleren zurückgeschrieben, damit der nächste Request für dieselbe Kachel aus dem Memory-Cache bedient wird. Geschrieben wird bei einem Miss immer in alle (passenden, s.u.) Schichten. Der Memory-Cache ist pro Prozess und geht bei einem Neustart verloren — er ist als schnelle erste Schicht vor einer persistenten gedacht, nicht als Ersatz dafür. Eviction erfolgt nach LRU, sobald `maxItems` oder `maxBytes` überschritten wird.

Jede einzelne Schicht lässt sich zusätzlich auf einen Zoom-Bereich beschränken (`minZoom`/`maxZoom`, beide optional, inklusiv) — z.B. um eine S3-Schicht nicht mit (insbesondere überzoomten) tiefen Zoomstufen vollzupacken:

```yaml
storage:
  cache:
    - type: memory
      config:
        maxItems: 1000
    - type: s3
      maxZoom: 14 # nur z0-14 landen in S3, überzoomte z15+ nie
      config:
        bucket: my-tile-cache
        region: eu-central-1
```

Eine Zoomstufe, die von keiner Schicht abgedeckt wird, wird einfach gar nicht gecacht (jedes Mal frisch gerendert) statt einen Fehler zu werfen.

Die Batch-CLI ist von `storage.*` komplett unberührt — `--input`/`--output` bleiben immer lokale Dateisystempfade, unabhängig von `config.yaml`.

## Datasets und Themes

Der Pfad zur `planet.pmtiles`-Datei kommt nicht mehr aus `config.yaml` (kein `tiles.input` mehr), sondern ausschließlich aus der `dataset_versions`-Tabelle — genau eine Zeile ist per `is_active` aktiv; `path` wird relativ zu `storage.data` aufgelöst (s.o.). Es gibt noch keine Verwaltungs-API dafür; Zeilen werden direkt per SQL angelegt/aktiviert:

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
