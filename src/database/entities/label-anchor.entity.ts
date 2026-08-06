import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// Persisted, shared cache of resolved cross-tile label anchor positions (see
// src/label-anchor-cache.ts and the "ID vs name" section of REQUIREMENTS.md §9).
//
// The primary key is a natural composite key, not a generated id: the triple
// (sourceLayer, featureId, datasetVersion) *is* the cache identity, and having it as
// the PK is what makes a clean upsert possible (ON CONFLICT on the PK itself).
//
// - sourceLayer: the MVT layer the feature comes from (e.g. "park"). A bare
//   featureId is only unique within one layer's own feature table, not globally.
// - featureId: the feature's real MVT/OSM id, or (when a feature has no id at all) a
//   synthetic "name:<normalized>" fallback - see getFeatureDataId/
//   SYNTHETIC_FEATURE_ID_PREFIX in src/renderer.ts.
// - datasetVersion: manual invalidation lever (tiles.datasetVersion in config.yaml) -
//   bump it when planet.pmtiles is regenerated so stale anchors computed against a
//   prior build's ids/geometry can't silently leak into a new one. Old rows simply
//   become unreferenced once the version is bumped; no cleanup is required for
//   correctness.
@Entity({ name: "label_anchors" })
export class LabelAnchor {
  @PrimaryColumn({ name: "source_layer", type: "varchar", length: 64 })
  sourceLayer!: string;

  @PrimaryColumn({ name: "feature_id", type: "varchar", length: 128 })
  featureId!: string;

  @PrimaryColumn({ name: "dataset_version", type: "varchar", length: 64, default: "" })
  datasetVersion!: string;

  // World-normalized fraction [0,1), matching GlobalAreaAnchor exactly - reprojected
  // to any zoom via `256 * 2**zoom` wherever it's consumed.
  @Column({ type: "double precision" })
  fx!: number;

  @Column({ type: "double precision" })
  fy!: number;

  // The ancestor/scan zoom the anchor was resolved at - debugging/observability only,
  // not required for correctness.
  @Column({ name: "resolved_zoom", type: "smallint", nullable: true })
  resolvedZoom?: number | null;

  @CreateDateColumn({ name: "creation_time", type: "timestamptz" })
  creationTime!: Date;

  @UpdateDateColumn({ name: "update_time", type: "timestamptz" })
  updateTime!: Date;
}
