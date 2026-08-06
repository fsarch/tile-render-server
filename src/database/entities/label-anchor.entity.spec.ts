import "reflect-metadata";
import { getMetadataArgsStorage } from "typeorm";
import { describe, expect, it } from "vitest";
import { LabelAnchor } from "./label-anchor.entity.js";

describe("LabelAnchor entity", () => {
  it("maps to the label_anchors table", () => {
    const table = getMetadataArgsStorage().tables.find((t) => t.target === LabelAnchor);
    expect(table?.name).toBe("label_anchors");
  });

  it("has a composite primary key of (source_layer, feature_id, dataset_version)", () => {
    const primaryColumns = getMetadataArgsStorage()
      .columns.filter((c) => c.target === LabelAnchor && c.options.primary)
      .map((c) => c.propertyName)
      .sort();
    expect(primaryColumns).toEqual(["datasetVersion", "featureId", "sourceLayer"].sort());
  });

  it("has fx/fy columns for the world-normalized anchor position", () => {
    const columnNames = getMetadataArgsStorage()
      .columns.filter((c) => c.target === LabelAnchor)
      .map((c) => c.propertyName);
    expect(columnNames).toEqual(
      expect.arrayContaining(["fx", "fy", "resolvedZoom", "creationTime", "updateTime"])
    );
  });
});
