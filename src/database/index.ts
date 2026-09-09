import { DatasetVersion } from "./entities/dataset-version.entity.js";
import { LabelAnchor } from "./entities/label-anchor.entity.js";
import { Template } from "./entities/template.entity.js";
import { CreateSchema1786019144724 } from "./migrations/1786019144724-create-schema.js";

// Passed to FsArchAppBuilder.setDatabase(...) in main.ts. The installed
// @fsarch/server always runs migrations at boot (migrationsRun: true) and ignores any
// "synchronize" field here (hardcoded to false) - don't add one.
export const DATABASE_OPTIONS = {
  entities: [LabelAnchor, DatasetVersion, Template],
  migrations: [CreateSchema1786019144724],
};
