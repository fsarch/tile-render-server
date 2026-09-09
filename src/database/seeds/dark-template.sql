-- "dark" template: a dark-mode color scheme for the curated variable set (see
-- THEMEABLE_COLOR_VARIABLES in src/core/styles.ts). Backgrounds are near-black,
-- water/nature/urban/farmland ground cover are muted dark hues distinguishable from
-- each other and from the background, buildings are a mid-gray that stands out
-- against it, major roads stay warm and high-contrast, and label text/halo are
-- swapped (light text, dark halo) so text remains readable.
--
-- Unlike default-template.sql, this intentionally sets every bundling variable (see
-- that file's comment) - a dark theme *should* unify a bundled group's several
-- originally-distinct light shades into one coherent dark one, rather than leaving
-- some of them at their (bright, light-mode) per-element default.
--
-- Run this, then see activate-template.sql to make it the active one.
INSERT INTO templates (id, name, colors, is_active)
VALUES (
  gen_random_uuid(),
  'dark',
  '{
    "--map-background": "#1b1f24",
    "--map-water": "#2c5b82",
    "--map-buildings": "#4a5058",
    "--map-landuse": "#2f3b2d",
    "--map-urban": "#332f2a",
    "--map-farmland": "#3c3a26",
    "--road-motorway": "#ffb454",
    "--road-trunk": "#ffb454",
    "--road-primary": "#ffd873",
    "--road-secondary": "#cbbf8e",
    "--road-tertiary": "#b8ac83",
    "--road-minor": "#5a6169",
    "--railways": "#8a8f97",
    "--label-text": "#e8e6df",
    "--label-halo": "#14171a",
    "--water-label-text": "#7ec2f0",
    "--nature-label-text": "#8fd18a"
  }'::jsonb,
  false
);
