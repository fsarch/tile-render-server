# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`maps-converter` renders SVG map tiles from a Planetiler `planet.pmtiles` dataset (Mapbox Vector Tile format). It has two entrypoints that share the same rendering core:

1. **On-demand REST API** (`@fsarch/server`/NestJS) — `GET /v1/tiles/:z/:x/:y.svg`, versioned, with Swagger docs and a health endpoint.
2. **Batch CLI renderer** — walks every tile in a PMTiles archive up to a max zoom and writes `output/{z}/{x}/{y}.svg` using a worker-thread pool.

Requirements are tracked in `REQUIREMENTS.md` (the source of truth for rendering rules, label behavior, and API contracts — consult it before changing rendering logic).

## Commands

```bash
npm run build      # tsc -> dist/
npm start           # node dist/main.js — starts the REST API (reads config.yaml)
npm run render       # node dist/index.js — batch CLI renderer (requires build first)
npm run example      # node dist/example-server.js — static tile viewer, proxies to the API
npm test             # npm run build && vitest run
```

- Tests live alongside source as `*.spec.ts` (e.g. `src/svg.spec.ts`, `src/styles.spec.ts`, `src/controllers/tiles/tiles.service.spec.ts`) and run via Vitest (`vitest.config.ts` includes `src/**/*.spec.ts`).
- Run a single test file: `npx vitest run src/svg.spec.ts`. Run by name: `npx vitest run -t "places labels"`.
- `npm test` always rebuilds first — the NestJS controllers/services import compiled `.js` paths (ESM, `NodeNext` module resolution), so a stale `dist/` can mask breakage even though Vitest itself runs against `.ts` sources.
- Batch CLI flags: `--input`, `--output`, `--max-zoom`, `--concurrency`, `--overwrite`, `--labels`, `--road-labels`, `--nature-labels` (see `src/index.ts` `parseCli`).

## Architecture

Both entrypoints funnel through the same pipeline, kept in strict separation of concerns:

```
pmtiles.ts   → open a PMTiles archive, fetch raw tile bytes, enumerate tile coords
renderer.ts  → decode MVT, apply per-feature rendering/label rules, orchestrate layer order
geometry.ts  → decode+normalize MVT geometry (extent -> 256px), area/length helpers, label anchors
styles.ts    → pure lookup tables: layer order, per-feature style, text style, CSS class names
svg.ts       → pure string builders: turn geometry/style into SVG path/circle/text markup
```

- **`src/pmtiles.ts`** wraps the `pmtiles` package with a Node `fs`-backed `Source` (`NodeFileSource`) so archives can be read from local disk without HTTP. `LocalPMTilesArchive` exposes `getTile(z,x,y)`, `countTiles`, and an async generator `iterateTileCoords` (walks the PMTiles directory tree recursively via `iterateRunEntries`).
- **`src/renderer.ts`** (`renderTileToSvg`) is the core: decodes the MVT buffer, iterates `getLayerOrder()` from `styles.ts`, and for each layer renders geometry + optional labels. Label logic is the most complex part — separate code paths exist for generic feature labels, road labels (`renderRoadLabels`, priority-filtered by zoom/road class), and nature/water labels (`renderNatureLabels`, with cross-tile dedup bucketing via `buildGlobalLabelBucketKey` and overlap-based candidate selection via `pushBestNatureLabels`). All labels render in an overlay group *after* geometry layers, in the fixed order: road labels → feature labels → nature labels.
- **`src/geometry.ts`** normalizes raw MVT coordinates (typically 0–4096 extent) into the fixed 256×256 tile space, and provides `getLabelAnchor` (point centroid / line midpoint / polygon centroid of the largest ring).
- **`src/styles.ts`** is data-driven and side-effect-free: `LAYER_ORDER` defines the canonical `land -> landuse -> water -> boundaries -> railways -> roads -> buildings -> places -> labels` order; per-layer source-layer name mappings, style tables, and zoom/importance-based text style rules (e.g. suppressing small `village`/`town` place labels below zoom 9) live here. Changing what's visually distinguishable (colors, widths, label thresholds) belongs in this file, not in `renderer.ts`.
- **`src/svg.ts`** has no domain knowledge — it only turns already-decided geometry/style/class/attributes into SVG markup strings (`<path>`, `<circle>`, `<text>`/`<textPath>`), plus railway sleeper-tick rendering and final document assembly (`buildSvgDocument`, which groups content by `<g id="...">` per layer and appends the label overlay last).
- **`src/worker.ts`** is the `worker_threads` entrypoint used by the batch CLI (`src/index.ts`): each worker owns its own PMTiles archive handle and renders tiles pushed to it via `postMessage`, skipping existing files unless `--overwrite` is set.
- **`src/index.ts`** is the batch CLI driver: opens the archive once to compute `totalTiles`, spins up a worker pool sized by `--concurrency`, streams `iterateTileCoords`, and prints periodic progress/ETA.
- **REST API** (`src/main.ts`, `src/app.module.ts`, `src/controllers/**`): built on `@fsarch/server`'s `FsArchAppBuilder` wrapping NestJS. `TilesController` (`v1/tiles/:z/:x/:y.svg`) validates coordinates (regex + bounds check against `2^z - 1`) before calling `TilesService.renderTileSvg`, which lazily opens a single shared PMTiles archive (`onModuleInit`/`onModuleDestroy` lifecycle) and calls the same `renderTileToSvg` used by the batch path. Both public routes use `@Public()` from `@fsarch/server/auth`. Runtime config (host/port, PMTiles input path, label toggles, cache-control header) comes from `config.yaml` via `@nestjs/config`.
- **`src/example-server.ts`** + `example/` is a minimal static Leaflet-style viewer that fetches tiles from the REST API (`--api-base` overridable) and persists zoom/position in the URL hash.

## Conventions

- ESM throughout (`"type": "module"` in `package.json`, `NodeNext` resolution) — internal imports use explicit `.js` extensions even in `.ts` source files.
- Keep `styles.ts`/`svg.ts` free of cross-concern logic: styling decisions (what/how something looks, zoom thresholds, suppression rules) belong in `styles.ts`; markup generation belongs in `svg.ts`; feature-selection/orchestration logic belongs in `renderer.ts`.
- `REQUIREMENTS.md` encodes specific, testable rendering rules (e.g. exact zoom thresholds for suppressing labels, which road classes get labels at zoom 13+, `naturschutzgebiet` styling). When changing label or styling behavior, check it for a rule you might be breaking, and update it if a requirement changes.
