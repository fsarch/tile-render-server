-- "default" template: reproduces today's hardcoded look exactly (pixel-identical to
-- no template being active at all) - a reference for the default value of every
-- variable that maps 1:1 to a single color, and a safe starting point to tweak from.
--
-- Deliberately omits every variable that *bundles* several originally-distinct shades
-- under one name (see THEMEABLE_COLOR_VARIABLES in styles.ts) - setting one of those
-- here would flatten that group to one shade, which is not what "default" means.
-- Omitted for that reason (left at each element's own built-in fallback instead):
--   --map-background : land polygon fill (#f5f3e7) differs from its own line/point
--                       stroke (#e8e0cb)
--   --map-water       : polygon fill (#9ecfff) differs from line/point stroke (#7bb7ef)
--   --map-buildings   : fill (#e5ddd0) differs from stroke (#cdbfaa)
--   --map-landuse     : shared by park/meadow/grass/forest/scrub/heath/shrub/wetland/
--                       the generic fallback - each has its own distinct shade (see
--                       LANDUSE_VARIANT_STYLES in styles.ts)
--   --map-urban       : fill (#ece6db) differs from stroke/point (#d6cebf)
--   --map-farmland    : fill (#e6e2b8) differs from stroke/point (#d1c98f)
--   --road-minor      : shared by minor/residential/unclassified/service/track/path/
--                       ferry/pier/bridge/raceway/transit, which all have their own
--                       distinct shade (see ROAD_VARIANT_STYLES in styles.ts)
--   --label-text      : road labels (#5d5241) differ from place labels (#444444)
-- If you want a custom-but-uniform look for one of these groups (e.g. every "minor
-- road" class in one color), set that variable explicitly - see dark-template.sql for
-- an example of a template that does exactly that on purpose.
--
-- Run this, then see activate-template.sql to make it the active one.
INSERT INTO templates (id, name, colors, is_active)
VALUES (
  gen_random_uuid(),
  'default',
  '{
    "--road-motorway": "#f4a23c",
    "--road-trunk": "#f4a23c",
    "--road-primary": "#f7c948",
    "--road-secondary": "#f8dea1",
    "--road-tertiary": "#f5dcaa",
    "--railways": "#bdbdbd",
    "--label-halo": "#ffffff",
    "--water-label-text": "#2f6ea6",
    "--nature-label-text": "#49613b"
  }'::jsonb,
  false
);
