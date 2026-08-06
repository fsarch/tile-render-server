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
npm start           # fsarch-server start — starts the REST API (reads config.yaml). Requires a reachable, migratable Postgres (see "Database" below).
npm run render       # node dist/index.js — batch CLI renderer (requires build first). No database needed.
npm run example      # node dist/example-server.js — static tile viewer, proxies to the API
npm test             # npm run build && vitest run. No database needed.
npm run migration:create --name=<name>  # scaffold a new migration in src/database/migrations/
npm run migration:run                    # run pending migrations against config.yaml's database (dev convenience only — migrations already auto-run on every `npm start`)
```

- Tests live alongside source as `*.spec.ts` (e.g. `src/svg.spec.ts`, `src/styles.spec.ts`, `src/controllers/tiles/tiles.service.spec.ts`) and run via Vitest (`vitest.config.ts` includes `src/**/*.spec.ts`).
- Run a single test file: `npx vitest run src/svg.spec.ts`. Run by name: `npx vitest run -t "places labels"`.
- `npm test` always rebuilds first — the NestJS controllers/services import compiled `.js` paths (ESM, `NodeNext` module resolution), so a stale `dist/` can mask breakage even though Vitest itself runs against `.ts` sources.
- Batch CLI flags: `--input`, `--output`, `--max-zoom`, `--concurrency`, `--overwrite`, `--labels`, `--road-labels`, `--nature-labels` (see `src/index.ts` `parseCli`).

### Database

`npm start` requires Postgres — not for map data (still exclusively `planet.pmtiles`), but as a shared, persistent cache for cross-tile label anchor positions (see Architecture below). `config.yaml` is gitignored; copy `config.example.yaml` and fill in real `database:` credentials. Migrations run automatically at boot (`migrationsRun: true`, hardcoded by the installed `@fsarch/server`); `npm run migration:run`/`src/database/data-source.ts` exist only as a dev convenience for scaffolding/running migrations without booting the whole app. The batch CLI and `npm test` never touch Postgres.

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
  - **Cross-tile area-label resolution**: large named `park`-layer features (nature reserves, forests) get clipped by Planetiler/MVT tiling into many disjoint per-tile fragments. `computeAreaGlobalAnchor` walks to coarser ancestor-zoom tiles (or falls back to a bounded neighbor scan) to find one canonical world position for the whole feature; only the tile that geographically owns that position renders the label (`resolveOwnedLocalAnchor`), others suppress their local fragment. Matching is **by the feature's MVT/OSM id** (`getFeatureDataId`), not name — several genuinely distinct real-world features can share one name (see REQUIREMENTS.md §9's "Borkenberge" example), so grouping by id avoids merging them into one wrong combined position; a per-tile scan still falls back to name-matching for one hop during the ancestor walk (ids reliably survive tile-clipping within one zoom level but aren't guaranteed to survive Planetiler's cross-zoom generalization), and features with no id at all fall back to name-matching entirely via a synthetic `name:<normalized>` key. Resolved anchors are cached through the injectable `LabelAnchorCache` (`src/label-anchor-cache.ts`) — `InMemoryLabelAnchorCache` (default, used by the batch CLI/tests) or `PostgresLabelAnchorCache` (`src/controllers/tiles/label-anchor-cache.postgres.ts`, wired in by `TilesModule`/`TilesService`), a shared, persistent store so resolution survives process restarts and is reused across multiple API instances.
- **`src/geometry.ts`** normalizes raw MVT coordinates (typically 0–4096 extent) into the fixed 256×256 tile space, and provides `getLabelAnchor` (point centroid / line midpoint / polygon centroid of the largest ring).
- **`src/styles.ts`** is data-driven and side-effect-free: `LAYER_ORDER` defines the canonical `land -> landuse -> water -> boundaries -> railways -> roads -> buildings -> places -> labels` order; per-layer source-layer name mappings, style tables, and zoom/importance-based text style rules (e.g. suppressing small `village`/`town` place labels below zoom 9) live here. Changing what's visually distinguishable (colors, widths, label thresholds) belongs in this file, not in `renderer.ts`.
- **`src/svg.ts`** has no domain knowledge — it only turns already-decided geometry/style/class/attributes into SVG markup strings (`<path>`, `<circle>`, `<text>`/`<textPath>`), plus railway sleeper-tick rendering and final document assembly (`buildSvgDocument`, which groups content by `<g id="...">` per layer and appends the label overlay last).
- **`src/worker.ts`** is the `worker_threads` entrypoint used by the batch CLI (`src/index.ts`): each worker owns its own PMTiles archive handle and renders tiles pushed to it via `postMessage`, skipping existing files unless `--overwrite` is set.
- **`src/index.ts`** is the batch CLI driver: opens the archive once to compute `totalTiles`, spins up a worker pool sized by `--concurrency`, streams `iterateTileCoords`, and prints periodic progress/ETA.
- **REST API** (`src/main.ts`, `src/app.module.ts`, `src/controllers/**`): built on `@fsarch/server`'s `FsArchAppBuilder` wrapping NestJS. `TilesController` (`v1/tiles/:z/:x/:y.svg`) validates coordinates (regex + bounds check against `2^z - 1`) before calling `TilesService.renderTileSvg`, which lazily opens a single shared PMTiles archive (`onModuleInit`/`onModuleDestroy` lifecycle) and calls the same `renderTileToSvg` used by the batch path, passing its injected `PostgresLabelAnchorCache`. Both public routes use `@Public()` from `@fsarch/server/auth`. Runtime config (host/port, PMTiles input path, label toggles, cache-control header, Postgres credentials, `tiles.datasetVersion`) comes from `config.yaml` via `@nestjs/config`. `main.ts` wires the database via `.setDatabase(DATABASE_OPTIONS)`.
- **`src/database/`**: `entities/label-anchor.entity.ts` (the `label_anchors` cache table, composite natural PK — see cross-tile resolution above), `migrations/`, `index.ts` (exports `DATABASE_OPTIONS` consumed by `main.ts`), `data-source.ts` (CLI-only `DataSource` for the `migration:*` npm scripts, not imported by the app itself).
- **`src/example-server.ts`** + `example/` is a minimal static Leaflet-style viewer that fetches tiles from the REST API (`--api-base` overridable) and persists zoom/position in the URL hash.

## Conventions

- ESM throughout (`"type": "module"` in `package.json`, `NodeNext` resolution) — internal imports use explicit `.js` extensions even in `.ts` source files.
- Keep `styles.ts`/`svg.ts` free of cross-concern logic: styling decisions (what/how something looks, zoom thresholds, suppression rules) belong in `styles.ts`; markup generation belongs in `svg.ts`; feature-selection/orchestration logic belongs in `renderer.ts`.
- `REQUIREMENTS.md` encodes specific, testable rendering rules (e.g. exact zoom thresholds for suppressing labels, which road classes get labels at zoom 13+, `naturschutzgebiet` styling). When changing label or styling behavior, check it for a rule you might be breaking, and update it if a requirement changes.
