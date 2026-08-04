# REQUIREMENTS

## 1. Goal
Build a production-ready Node.js project (ESM, current LTS) that renders a Planetiler `planet.pmtiles` (MVT) dataset into SVG tiles.

## 2. Input
- Default input file: `planet.pmtiles`
- Data type: Planetiler vector tiles (Mapbox Vector Tile / MVT)

## 3. Output
- Output layout:
  - `output/{z}/{x}/{y}.svg`
- Examples:
  - `output/0/0/0.svg`
  - `output/1/0/0.svg`
  - `output/14/8723/5412.svg`

## 4. Core Rendering Rules
- Render every tile as a real SVG file.
- SVG size must be `256x256`.
- SVG must use `viewBox="0 0 256 256"`.
- Transform all MVT geometries correctly from tile extent (typically `4096`) to `256`.

## 5. Supported Geometry Types
- Polygon / MultiPolygon
- LineString / MultiLineString
- Point / MultiPoint

## 6. Required Layers and Styling
Minimum supported target layers:
- `water`
- `land`
- `roads`
- `buildings`
- `boundaries`
- `places`
- `landuse`
- `railways` (added requirement from follow-up requests)

If a layer is missing in a tile, skip it without failing.

### 6.1 Visual Differentiation
- Buildings must be clearly distinguishable from:
  - parks/grass/meadows
  - farmland/fields
  - forests/wooded areas
- Roads must be visually hierarchical:
  - motorways
  - trunk/primary (federal/high-level roads)
  - smaller roads
- Railways must be rendered as thin lines with short perpendicular sleeper ticks.

## 7. SVG Structure and Classes
- SVG content must be grouped logically with layer groups, for example:
  - `<g id="water">...</g>`
  - `<g id="landuse">...</g>`
  - `<g id="roads">...</g>`
  - `<g id="buildings">...</g>`
  - `<g id="places">...</g>`
- Elements must include useful CSS classes, e.g.:
  - `class="road motorway"`
  - `class="road residential"`
  - `class="building"`
  - `class="water"`

## 8. Labeling Requirements (Detailed)

### 8.1 Generic Labels
- Point features with a `name` attribute may render as `<text>` labels (optional via CLI).

### 8.2 Road Labels
- Road names must be supported.
- From zoom `13+`, road labels must be restricted to high-priority roads only:
  - motorway
  - trunk
  - primary
- Lower-priority road names must be hidden at zoom `13+`.

### 8.3 Water and Nature Labels
- Names for water and nature areas must be supported (e.g., rivers, lakes, seas, parks, forests, recreation areas).
- Rendering thresholds from the chat-derived behavior:
  - Water labels generally start at zoom `>= 6`.
  - River-like line labels require zoom `>= 12` and sufficient line length.
  - Non-river water line labels require sufficient line length.
  - Water polygon labels require minimum area.
  - Nature area labels (parks/forests/etc.) require minimum zoom and minimum geometry size.

### 8.4 Place/City Labels
- City/place labels must be rendered with different font sizes based on importance, using available feature attributes such as:
  - place class (city/town/village/etc.)
  - rank
  - population
  - capital indicator
- State/province/federal-state names are **not required** and should be suppressed as text labels.

## 9. Cross-Tile Label De-duplication
- Avoid showing the same label on neighboring tiles for shared large features (especially nature/water names).
- De-duplication must be deterministic and compatible with parallel tile rendering.

## 10. Performance and Scalability
- Rendering must run in parallel.
- Use worker threads or a promise pool.
- Concurrency must be configurable.
- Skip already existing SVG files by default.
- Support overwrite mode (`--overwrite`).
- Keep memory usage low.

## 11. Logging
During generation, show:
- current zoom
- rendered tile count
- tiles per second
- estimated remaining time (ETA)
- errors

## 12. CLI Requirements
Minimum parameters:
- `--input planet.pmtiles`
- `--output output/`
- `--max-zoom 14` (configurable; higher zoom levels must be supported)
- `--concurrency 8`
- `--overwrite`

Additional flags required by follow-up requests:
- label toggles (general labels, road labels, nature/water labels)

## 13. Example Viewer
- Provide an `example` page that displays generated SVG tiles.
- Example must support the generated zoom range, including higher zoom levels.

## 14. Project Structure
Keep a modular `src/` layout:
- `pmtiles.*`
- `renderer.*`
- `geometry.*`
- `styles.*`
- `svg.*`
- `worker.*`
- `index.*`

Implementation requirement from follow-up:
- TypeScript rewrite (ESM), with clean typing and modular code.

## 15. Error Handling
- Skip invalid or empty tiles.
- Continue processing on individual tile errors (no full-run abort).

## 16. Open-Source Constraint
- Use only open-source libraries.
- Use suitable PMTiles/MVT libraries (e.g., `pmtiles`, `@mapbox/vector-tile`, `pbf`).
