import "reflect-metadata";
import { getMetadataArgsStorage } from "typeorm";
import { describe, expect, it } from "vitest";
import { DatasetVersion } from "./dataset-version.entity.js";

describe("DatasetVersion entity", () => {
  it("maps to the dataset_versions table", () => {
    const table = getMetadataArgsStorage().tables.find((t) => t.target === DatasetVersion);
    expect(table?.name).toBe("dataset_versions");
  });

  it("has an id primary key plus path and is_active columns", () => {
    const columnNames = getMetadataArgsStorage()
      .columns.filter((c) => c.target === DatasetVersion)
      .map((c) => c.propertyName);
    expect(columnNames).toEqual(
      expect.arrayContaining(["id", "path", "isActive", "creationTime", "updateTime"])
    );
  });
});
