import { DatasetVersion } from "./entities/dataset-version.entity.js";
import { LabelAnchor } from "./entities/label-anchor.entity.js";
import { Template } from "./entities/template.entity.js";
import { CreateLabelAnchors1786019144724 } from "./migrations/1786019144724-create-label-anchors.js";
import { CreateDatasetVersions1788882245338 } from "./migrations/1788882245338-create-dataset-versions.js";
import { CreateTemplates1788882245339 } from "./migrations/1788882245339-create-templates.js";

// Passed to FsArchAppBuilder.setDatabase(...) in main.ts. The installed
// @fsarch/server always runs migrations at boot (migrationsRun: true) and ignores any
// "synchronize" field here (hardcoded to false) - don't add one.
export const DATABASE_OPTIONS = {
  entities: [LabelAnchor, DatasetVersion, Template],
  migrations: [CreateLabelAnchors1786019144724, CreateDatasetVersions1788882245338, CreateTemplates1788882245339],
};
