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
- Every tile must include an opaque background rectangle (`<rect>`) covering the full `256x256` area, using the same fill color as the `land` layer, so tiles are never transparent even where the `land` layer itself has no coverage.

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
- Roads must be visually hierarchical by class, from highest to lowest: motorway/trunk (Autobahn) → primary (Bundesstraße) → secondary (Landstraße) → tertiary → minor → residential/unclassified → service → ferry → track/path/transit → pier/bridge/raceway. Each class has its own stroke color and width; `service` and `tertiary` must remain clearly visible (not near-white/near-invisible), while `minor`/`service` must stay subtle rather than visually dominant.
- Draw order within the `roads` layer must follow the same hierarchy: higher-class roads render on top of (after) lower-class roads, so they stay visually continuous at intersections regardless of the order features happen to appear in the source data.
- Road stroke widths must scale down below zoom `11` (all classes, proportionally), since full-size strokes look disproportionately thick when a tile covers much more ground.
- `minor`, `track`, and `path` road classes (geometry and their labels) must only render from zoom `14+`.
- Road classes ending in `_construction` (roads under construction, any base class) must not be rendered at all.
- `track` renders as a thin, muted green dashed line; `path` as a thin dashed line in the existing neutral tone; `transit` as a thin solid (non-dashed) line; `ferry` as a dashed blue line.
- Railways must be rendered as thin lines with short, thin perpendicular sleeper ticks (the ticks noticeably thinner than the rail line itself).
- The `railways` layer must only render from zoom `10+`.
- Boundaries must render as a thin, low-contrast dashed line — visible but not visually dominant.
- Only country/state/region-level boundaries (`admin_level` `1`–`4`) may render; lower administrative subdivisions (county/municipality/district/etc., and anything missing `admin_level` entirely) must not be rendered.

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
  - tertiary
- Lower-priority road names must be hidden at zoom `13+`.
- `trunk` road labels must additionally not render below zoom `10`, and `tertiary` road labels not below zoom `13`, independent of the zoom `13+` restriction above.
- `minor`, `track`, `path`, and `transit` road labels must not render below zoom `14`, matching when their geometry starts rendering.
- For `motorway` and `trunk` roads, the label must prefer the route reference (`ref`, e.g. `"A 40"`) over a historical or colloquial `name` when both are present, since route-number roads are conventionally identified by their reference on maps.

### 8.3 Water and Nature Labels
- Names for water and nature areas must be supported (e.g., rivers, lakes, seas, parks, forests, recreation areas).
- Rendering thresholds from the chat-derived behavior:
  - Water labels generally start at zoom `>= 6`.
  - River-like line labels require zoom `>= 12` and sufficient line length.
  - Non-river water line labels require sufficient line length.
  - Water polygon labels require minimum area.
  - Standing-water features (lake/pond/reservoir/basin/lagoon/pool/Weiher, by class) that only exist as a point geometry (no polygon/line outline available) must not get a label — a point label for a small lake creates clutter without conveying its extent.
  - Nature area labels (parks/forests/reserves/etc., "Grüngebiete") must only render from zoom `12+`, in addition to the minimum geometry size.
- The following classes must never render an area label, regardless of size: `naturpark`, `vogelschutzgebiet` (bird sanctuary / EU special protection area), `landschaftsschutzgebiet` (landscape protection area — often named after every stream/valley it covers, producing unusably long labels).
- A generic `protected_area`-classed feature must only render a label when it can be identified as nature-related (via `protect_class` in the relevant numeric ranges, or `protection_object`/`protection_title`/`boundary`/`natural`/`landuse` tokens indicating nature/habitat/water/forest/etc.); otherwise it must be suppressed regardless of size.
- Within a single tile, at most one label per unique (theme, name) may render — even when the underlying named area is split into several disjoint polygon fragments (common for large nature reserves) that don't spatially overlap each other. The highest-scoring candidate (best ratio of visible to total label area) wins; this must be deterministic.
- An anchored label (nature/water or generic) must not render in a tile unless at least ~90% of its estimated text width **and** height would actually be visible within the tile bounds (both directions, not just width). This prevents labels whose anchor sits close to a tile edge (typically from a feature fragmented across tiles) from rendering visibly truncated/cut-off text.
- The same ~90%-visibility rule applies to line-following labels (road names, river/stream names rendered via a curved text path): since the text is centered at 50% of the line's arc length and follows the line's actual curve (not a straight box around one point), visibility must be evaluated against the bounding box of the specific arc-length window the text will occupy, not just the line's midpoint vertex. A curving line can have its midpoint comfortably inside a tile while the text still sweeps outside it as the curve bends toward an edge; this must be caught and the label suppressed in that tile.
- Line-following labels (road and river/stream names) must render along a smoothed version of the line, not the raw, possibly tightly-zigzagging source geometry — heavily meandering lines (e.g. small streams) otherwise cause consecutive letters to flip to sharply different angles and become unreadable. The smoothing applies only to the path text follows, never to the actual rendered geometry of the feature.

### 8.4 Place/City Labels
- City/place labels must be rendered with different font sizes based on importance, using available feature attributes such as:
  - place class (city/town/village/etc.)
  - rank
  - population
  - capital indicator
- At zoom `<= 9`, place label font sizes must be scaled down noticeably compared to the same class at higher zoom (the map shows many places at once at low zoom). This scaling must be purely cosmetic: whether a place is significant enough to get a label at all must be decided using its unscaled size, so the low-zoom shrink never causes additional places to disappear entirely.
- State/province/federal-state names are **not required** and should be suppressed as text labels.

## 9. Cross-Tile Label De-duplication
- Avoid showing the same label on neighboring tiles for shared large features (especially nature/water names).
- De-duplication must be deterministic and compatible with parallel tile rendering.
- De-duplication must also cover same-name duplicates *within* a single tile arising from a feature split into multiple disjoint geometry fragments (see 8.3), not just spatially-overlapping candidates.
- Labels that would render mostly (but not almost entirely) outside a tile's bounds must be suppressed in that tile rather than shown truncated (see 8.3); this is the primary mechanism preventing a single label from appearing "cut in half" across a tile boundary.
- For a named nature area (park/reserve/etc.) whose polygon is fragmented across many neighboring tiles (not just two adjacent ones, but a whole cluster), only a single tile in that cluster may render the label — positioned at the area's true overall center, not at any one fragment's local centroid:
  - Resolve the center by walking to coarser (lower) zoom ancestor tiles for the same feature, stopping either when the area fits fully inside one ancestor tile (not touching its edges — use that tile's centroid) or when the feature is no longer present in the data at that zoom.
  - If the feature disappears while zooming out before it ever fits in one tile, fall back to scanning outward (left/right/up/down, bounded radius) from the last zoom level where it was still present, to approximate the overall bounding box and use its center.
  - Whichever single tile geographically contains the resolved center renders the label there; every other tile touching the same feature must suppress its own local fragment(s) of that label entirely (regardless of geometry kind — point or polygon fragments of the same feature are both covered).
  - A tile that only has a point-marker representation of the feature (no polygon at all, common when Planetiler places one label-reference point per tile a large multipolygon touches) must still correctly defer to whichever neighboring tile owns the real polygon — point markers count as "the feature is present here" for search purposes, but must never themselves be treated as if they were the area's full extent, and a tile with only a point marker must not stop the neighbor search from finding the real polygon just because that specific tile had nothing else to contribute.
  - This resolution requires read access to tiles beyond the one currently being rendered (ancestor and neighboring tiles from the PMTiles archive) and must be cached, since the same question would otherwise be repeated for every fragment/tile of the same area.
  - **Grouping is by the feature's MVT/OSM id, not by name.** Several genuinely distinct real-world features can share one name (e.g. a forest called "Borkenberge" turned out to be several separate OSM relations with different ids) — matching by name alone incorrectly unions unrelated features into one bogus combined center. The same-zoom neighbor scan matches strictly by id. The ancestor zoom-out walk matches by id first and falls back to name-matching for a given ancestor tile only when that specific tile has zero id matches (ids reliably survive per-tile clipping within one zoom level, but aren't guaranteed to survive Planetiler's cross-zoom generalization into a coarser feature with a different id) — this is a narrow, deliberately accepted trade-off, not a general reliance on names. A feature with no id at all is matched by name everywhere (the pre-id-based behavior, preserved as a fallback). The existing same-tile, same-name de-duplication rule above still applies as a complementary safety net for the rare case where two distinct ids' independently-resolved owning tiles happen to coincide.
  - Resolved anchors must be persisted in a shared store (not just kept in the rendering process's memory) so that resolution survives process restarts and is not repeated independently by multiple API instances serving the same deployment. This must stay lazy/on-demand — computed only for features actually requested, never as an upfront bulk pass over the whole dataset. A manual per-dataset invalidation key must be available (bump when the underlying tile dataset is regenerated/replaced) so anchors computed against a prior dataset build cannot silently leak into a new one.

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
