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
- Lower-priority road names must be hidden at zoom `13+` **of the dataset's own real data** — this restriction exists to avoid clutter at the dataset's most detailed zoom levels, so it does not apply once the requested zoom exceeds the dataset's actual max zoom via overzoom (§17): once overzoom itself is doing the "zooming in" rather than real additional detail, a tile covers a much smaller area and there is room to label every road class again.
- `trunk` road labels must additionally not render below zoom `10`, and `tertiary` road labels not below zoom `13`, independent of the zoom `13+` restriction above.
- `minor`, `track`, `path`, and `transit` road labels must not render below zoom `14`, matching when their geometry starts rendering.
- For `motorway` and `trunk` roads, the label must prefer the route reference (`ref`, e.g. `"A 40"`) over a historical or colloquial `name` when both are present, since route-number roads are conventionally identified by their reference on maps.
- A road name whose line touches a tile edge must be continued into the neighboring tile rather than suppressed or rendered as an isolated fragment (see §9 "Cross-tile line label continuation").

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
- The same ~90%-visibility rule applies to line-following labels (road names, river/stream names rendered via a curved text path): since the text is centered at 50% of the line's arc length and follows the line's actual curve (not a straight box around one point), visibility must be evaluated against the bounding box of the specific arc-length window the text will occupy, not just the line's midpoint vertex. A curving line can have its midpoint comfortably inside a tile while the text still sweeps outside it as the curve bends toward an edge; this must be caught and the label suppressed in that tile — **unless** the line was continued into a neighboring tile (see §9 "Cross-tile line label continuation"), in which case each tile is expected to show only part of the text by design and the 90% rule does not apply.
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
  - Resolved anchors must be persisted in a shared store (not just kept in the rendering process's memory) so that resolution survives process restarts and is not repeated independently by multiple API instances serving the same deployment. This must stay lazy/on-demand — computed only for features actually requested, never as an upfront bulk pass over the whole dataset. Every persisted anchor must be scoped to the dataset build it was resolved against (a real foreign key onto `dataset_versions.id`, not a manually-bumped string) so anchors computed against a prior dataset build cannot silently leak into a new one — a newly-activated `dataset_versions` row always gets a fresh id, so this requires no separate invalidation step when the underlying tile dataset is regenerated/replaced.

- **Cross-tile line label continuation** (roads and rivers/streams, as opposed to the area anchors above): when a road or water line's label geometry touches a tile edge, the text must not simply be suppressed or shown as an oddly-placed local fragment — it must render as if it were one continuous piece of text split naturally across both tiles (e.g. the upper half of the name in the tile above, the lower half in the tile below), matching how the feature would look if the tile boundary weren't there.
  - For each edge direction a line touches, fetch the same-zoom neighboring tile across that edge and look for the same feature's line there: strictly by feature id when the feature has a real MVT/OSM id (never falling back to name in that case, to avoid joining an unrelated same-named line); by best name match only when the feature has no real id at all (matching the synthetic name-based id fallback used for area anchors).
  - Join the local line and the matched neighbor line end-to-end (picking whichever pairing of the two lines' endpoints is closest together, so endpoint ordering doesn't matter) and translate the neighbor's geometry into the local tile's coordinate space (so the joined line legitimately extends beyond the local tile's `0..256` bounds). If the closest endpoint pairing is too far apart to plausibly be the same real-world connection, the line is left unextended rather than force-joined.
  - Both tiles sharing the boundary independently perform this join and each end up with the same combined line (just offset differently into their own local coordinate space); rendering each tile's `<textPath>` against its own copy and letting the SVG viewport clip to `0..256` is what naturally produces the split-text effect, rather than any explicit "render only half the string" logic.
  - This is a single hop only (it does not chase a join across a third tile) and is computed fresh per request rather than persisted — unlike the area-anchor cache above, this is a cheap, per-(tile, feature) fact rather than one shared globally across the whole dataset.
  - The line used for label placement is simplified (see §8.3) only *after* joining, so a join exactly at a tile boundary between two straight, colinear segments collapses cleanly into one straight simplified line rather than leaving a visible kink at the seam.

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

## 17. Overzoom (REST API only)
- The REST API may serve zoom levels beyond `planet.pmtiles`'s own max zoom by "overzooming": cropping and scaling the deepest available real tile's already-decoded geometry to stand in for the requested (deeper) tile, instead of rejecting the request.
  - Disabled by default: a request above the dataset's actual max zoom still 404s unless `tiles.maxZoom` is configured higher in `config.yaml`. A configured value can only extend serving upward, never below the dataset's real max zoom.
  - The crop+scale transform (see `computeOverzoomTransform` in `src/core/geometry.ts`) is applied uniformly wherever tile geometry is decoded for the request - the tile's own layers, and any same-zoom neighbor or coarser-ancestor tile fetched for cross-tile line-joining (§9) or area-label-anchor resolution (§9) - so those mechanisms keep working correctly (including neighbor tiles that are themselves overzoomed) without being aware overzoom is happening.
  - Zoom-dependent styling and label-visibility rules (elsewhere in this document) key off the *requested* zoom, not the dataset's real max zoom - e.g. a label suppressed below zoom 9 stays suppressed/shown based on the overzoomed request's own zoom. The one exception is §8.2's "high-priority roads only from zoom 13+" clutter guard, which is calibrated for the dataset's own real detail and is lifted once the requested zoom exceeds the dataset's actual max zoom (see §8.2).
  - The batch CLI never overzooms: `--max-zoom` above the dataset's actual max zoom is still capped down to it (§12), since pre-rendering upscaled duplicates of the same source tile to `output/` has no benefit over rendering that source tile once.

## 18. Dataset Versions and Color Templates (REST API only)
- The pmtiles file the REST API serves is selected via the `dataset_versions` database table (`path` column), not `config.yaml` - there is no `tiles.input` setting. Exactly one row may be active (`is_active`) at a time; the API fails to start if none is.
  - Activating a different row only takes effect on the API's next restart - the already-opened PMTiles archive is not swapped out mid-process.
  - The persisted cross-tile label-anchor cache (§9) is scoped by this same table's `id` (a real foreign key, not a separate config string) - `TilesService` sets it on the label-anchor cache as soon as it resolves the active row, before any tile is rendered.
- Rendering (geometry, layout) and styling (colors) must be kept separate, so that a rendered tile's markup does not need to change - and can be cached/reused unchanged - across different color choices.
  - A curated set of colors must always be emitted as a CSS custom property reference (`var(--name, <default>)`), never a literal color value: background, water, buildings (fill and stroke share one variable), roads - grouped into the same high-priority classes §8.2 already treats specially, plus one shared "minor roads" bucket for everything else - railways, label text/halo colors, and landuse ground cover grouped by broad category (all "green" nature ground cover - forest, park, meadow, grass, scrub, heath, shrub, wetland - sharing one variable; residential/commercial/industrial/railway zones sharing another; farmland its own). Rendering a tile with no active template must look pixel-identical to using a literal color value directly.
  - Some of these variables intentionally bundle several originally-distinct colors under one name (e.g. every "green" nature ground-cover class, or every "minor road" class) - a template that sets such a variable unifies that whole group to one color by design. A template must therefore only be assumed pixel-identical to "no template" if it deliberately omits every such bundling variable (as the seeded "default" template does); setting one is a legitimate, intentional stylistic choice, not a bug.
  - A **template** (`templates` database table: `name`, `colors` as a JSON map of variable name to CSS color value, `is_active`; at most one active at a time) supplies the concrete color values for a subset (or all) of those variables. Applying a template must be a distinct, final step performed on an already-fully-rendered tile - injecting a `<style>` block that defines the chosen variables - never a parameter to rendering itself.
  - An unknown variable name, or a value that does not look like a plausible CSS color, must be ignored individually (that one color keeps its default) rather than failing the whole request or producing broken markup.
  - Changing the active template must take effect on the very next request, without an API restart and without needing to re-render any tile.
- A tile must be requestable with an explicitly chosen template, independent of which one (if any) is currently active: `GET /v1/templates/:id/tiles/:z/:x/:y.svg` renders/responds identically to `GET /v1/tiles/:z/:x/:y.svg`, except the color theme comes from the template with that id rather than the active one.
  - `:id` must be validated as a well-formed template id (a 400 if not) and must resolve to an existing template (a 404 if not) before rendering proceeds.
  - This must not require a second render of the tile's geometry - it is the same rendering path as the active-template route, just fed a different template lookup.

## 19. Storage and the Rendered-Tile Cache (REST API only)
- Two independently configurable storage backends must exist in `config.yaml`, under `storage.data` and `storage.cache`. Each must support at least a local filesystem backend (a base directory) and an S3 backend (bucket, region, optional credentials/endpoint/prefix); mixing backends (e.g. S3 for data, filesystem for cache) must be possible.
  - `storage.data` is where `dataset_versions.path` is resolved from - a base directory for filesystem, or a bucket/prefix for S3. `dataset_versions.path` is a key/relative path within it, not necessarily an absolute filesystem path.
  - `storage.cache` is where rendered tiles are cached (see below).
  - The pmtiles archive must never be read in full to serve a tile: both backends must support random-access byte-range reads (matching how the PMTiles format itself is designed to be queried), since a real archive is commonly hundreds of MB to several GB.
- The batch CLI is unaffected by either setting - it always reads/writes plain local filesystem paths given via `--input`/`--output`, independent of `config.yaml`/`storage.*`/Postgres.
- The REST API must cache a tile's *rendered* markup (post-rendering, pre-template - see §18's rendering/styling separation) in `storage.cache`, keyed by dataset version and coordinates, so identical requests skip re-rendering:
  - The cache key must include the active dataset version's identity, not just `z`/`x`/`y` - otherwise, after switching `dataset_versions` (and restarting, per §18), a stale cache entry from the previous dataset could be served under coordinates that coincidentally match in the new one.
  - A cache hit must still go through template resolution/injection (§18) - the cache holds one shared, template-agnostic render; the active/requested template is applied fresh on every request regardless of whether the render came from cache or was just computed.
  - A cache miss must render normally, then populate the cache, then proceed with template injection as usual.
- `storage.cache` (only - not `storage.data`) must additionally support an in-process memory backend, and layering multiple backends together:
  - A memory backend must be bounded (by entry count and/or total byte size, both configurable) and evict least-recently-used entries once a bound is exceeded - an unbounded in-memory tile cache is not acceptable.
  - Layering must let multiple cache backends be configured together and checked in order (e.g. memory first, then a persistent filesystem-or-S3 layer) - "look in the memory cache first, and if it's not there, check the next cache layer". A hit found in a slower layer must be written back into every faster layer, so a subsequent request for the same tile is served from the fast layer.
  - Writes (populating the cache after a miss) must be applied to every configured layer, not just the fastest one.
  - Any single layer must be restrictable to a zoom range (`minZoom`/`maxZoom`, inclusive, both optional) - e.g. to keep an S3 layer from being filled with deep-zoom (especially overzoomed, §17) tiles. A request for a zoom outside a layer's configured range must not read from or write to that layer, and must not be treated as an error; if no configured layer covers that zoom at all, the tile is simply never cached (rendered fresh on every request) rather than failing.
