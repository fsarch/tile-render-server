import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// A color theme for the rendered map, applied as a *post-processing* step on top of an
// already-rendered SVG tile (see injectStyleTemplate in src/core/svg.ts) - never during
// rendering itself. This is what keeps rendering (geometry, layout - the expensive,
// cacheable part) and styling (colors - cheap, swappable, no cache impact) separate:
// renderTileToSvg always emits `fill="var(--map-water, #9ecfff)"`-style references for
// the curated set of themeable colors (see THEMEABLE_COLOR_VARIABLES in styles.ts), and
// a rendered tile looks identical with or without an active template (the CSS fallback
// value matches today's hardcoded look) - only the `<style>` block TilesService injects
// as the last step before responding actually binds those variables to a color.
//
// Unlike DatasetVersion, activating a different template takes effect immediately (on
// the very next request) - it never touches the opened PMTiles archive.
@Entity({ name: "templates" })
export class Template {
  // Generated application-side (crypto.randomUUID(), see TemplateService) rather than
  // via a DB-side default, matching the fsarch convention and avoiding a dependency on
  // a Postgres UUID-generation extension.
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  // Maps a subset of THEMEABLE_COLOR_VARIABLES (styles.ts) to CSS color values, e.g.
  // { "--map-water": "#1c3f5f", "--road-primary": "#ffcc66" }. Keys not present here -
  // or not in that whitelist, or whose value doesn't look like a plausible CSS color -
  // are ignored at injection time (see injectStyleTemplate), so a partial or malformed
  // template degrades to "use the default for that one color" rather than failing.
  @Column({ type: "jsonb" })
  colors!: Record<string, string>;

  // Exactly one row may have isActive: true - enforced by a partial unique index (see
  // the create-templates migration), not just application logic.
  @Column({ name: "is_active", type: "boolean", default: false })
  isActive!: boolean;

  @CreateDateColumn({ name: "creation_time", type: "timestamptz" })
  creationTime!: Date;

  @UpdateDateColumn({ name: "update_time", type: "timestamptz" })
  updateTime!: Date;
}
