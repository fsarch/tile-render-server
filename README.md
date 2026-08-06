
# maps-converter

`maps-converter` kann SVG-Tiles weiter batchweise rendern und stellt jetzt zusätzlich eine `@fsarch/server`-basierte REST-API für On-Demand-Rendering bereit.

## REST API

1. `npm install`
2. `cp config.example.yaml config.yaml` und die `database:`-Zugangsdaten eintragen (siehe [Datenbank](#datenbank))
3. `npm run build`
4. `npm start`

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

## Example Viewer

```bash
npm run example
```

Der Viewer lädt Tiles über `GET /v1/tiles/:z/:x/:y.svg` vom API-Server und kann bei Bedarf mit `--api-base` auf eine andere URL zeigen.
Zoom und Kartenposition werden im URL-Hash gespeichert, damit ein Reload dieselbe Ansicht wiederherstellt.

## Batch Rendering

```bash
node ./dist/index.js --input planet.pmtiles --output ./output --max-zoom 19 --labels --road-labels --concurrency 6 --nature-labels
```
