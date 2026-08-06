import { describe, expect, it } from "vitest";
import { DATABASE_OPTIONS } from "./index.js";
import { LabelAnchor } from "./entities/label-anchor.entity.js";

describe("DATABASE_OPTIONS", () => {
  it("registers the LabelAnchor entity", () => {
    expect(DATABASE_OPTIONS.entities).toContain(LabelAnchor);
  });

  it("has at least one migration", () => {
    expect(DATABASE_OPTIONS.migrations.length).toBeGreaterThan(0);
  });
});
