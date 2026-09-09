import "reflect-metadata";
import { getMetadataArgsStorage } from "typeorm";
import { describe, expect, it } from "vitest";
import { Template } from "./template.entity.js";

describe("Template entity", () => {
  it("maps to the templates table", () => {
    const table = getMetadataArgsStorage().tables.find((t) => t.target === Template);
    expect(table?.name).toBe("templates");
  });

  it("has an id primary key plus name, colors, and is_active columns", () => {
    const columnNames = getMetadataArgsStorage()
      .columns.filter((c) => c.target === Template)
      .map((c) => c.propertyName);
    expect(columnNames).toEqual(
      expect.arrayContaining(["id", "name", "colors", "isActive", "creationTime", "updateTime"])
    );
  });
});
