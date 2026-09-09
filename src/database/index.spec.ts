import { describe, expect, it } from "vitest";
import { DATABASE_OPTIONS } from "./index.js";
import { DatasetVersion } from "./entities/dataset-version.entity.js";
import { LabelAnchor } from "./entities/label-anchor.entity.js";
import { Template } from "./entities/template.entity.js";

describe("DATABASE_OPTIONS", () => {
  it("registers the LabelAnchor, DatasetVersion, and Template entities", () => {
    expect(DATABASE_OPTIONS.entities).toContain(LabelAnchor);
    expect(DATABASE_OPTIONS.entities).toContain(DatasetVersion);
    expect(DATABASE_OPTIONS.entities).toContain(Template);
  });

  it("has at least one migration", () => {
    expect(DATABASE_OPTIONS.migrations.length).toBeGreaterThan(0);
  });
});
