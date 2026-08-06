import { LabelAnchor } from "./entities/label-anchor.entity.js";
import { CreateLabelAnchors1786019144724 } from "./migrations/1786019144724-create-label-anchors.js";

// Passed to FsArchAppBuilder.setDatabase(...) in main.ts. The installed
// @fsarch/server always runs migrations at boot (migrationsRun: true) and ignores any
// "synchronize" field here (hardcoded to false) - don't add one.
export const DATABASE_OPTIONS = {
  entities: [LabelAnchor],
  migrations: [CreateLabelAnchors1786019144724],
};
