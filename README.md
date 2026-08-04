
# maps-converter

`maps-converter` kann SVG-Tiles weiter batchweise rendern und stellt jetzt zusätzlich eine `@fsarch/server`-basierte REST-API für On-Demand-Rendering bereit.

## REST API

1. `npm install`
2. `npm run build`
3. `npm start`

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

Die Laufzeitkonfiguration liegt in `config.yaml`.

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
