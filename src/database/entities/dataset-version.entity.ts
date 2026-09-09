import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// Registers a known planet.pmtiles build the REST API can serve. Replaces the old
// `tiles.input` config.yaml setting entirely: TilesService opens whichever row has
// `isActive: true` at boot (see src/controllers/tiles/tiles.service.ts), so switching
// datasets is a DB update instead of a config/redeploy - though, like the old
// config-based setting, the API still only picks up the change on its next restart
// (the opened PMTiles archive isn't hot-swapped mid-process).
//
// This is a distinct concept from the `tiles.datasetVersion` *config* value (see
// config.example.yaml / label_anchors.dataset_version): that one is a manually-bumped
// cache-busting string for the cross-tile label-anchor cache, untouched by this table.
// A future iteration could consolidate the two (using this row's `id` as the
// label-anchor cache-scoping key instead), but that's out of scope here.
@Entity({ name: "dataset_versions" })
export class DatasetVersion {
  // Generated application-side (crypto.randomUUID(), see DatasetVersionService) rather
  // than via a DB-side default, matching the fsarch convention and avoiding a
  // dependency on a Postgres UUID-generation extension.
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  // Path to a planet.pmtiles file, resolved the same way tiles.input used to be
  // (relative to the process's cwd).
  @Column({ type: "varchar", length: 1024 })
  path!: string;

  // Exactly one row may have isActive: true - enforced by a partial unique index (see
  // the create-dataset-versions migration), not just application logic.
  @Column({ name: "is_active", type: "boolean", default: false })
  isActive!: boolean;

  @CreateDateColumn({ name: "creation_time", type: "timestamptz" })
  creationTime!: Date;

  @UpdateDateColumn({ name: "update_time", type: "timestamptz" })
  updateTime!: Date;
}
