import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { parseUuidParam } from "./parse-uuid-param.util.js";

describe("parseUuidParam", () => {
  it("returns a well-formed uuid unchanged", () => {
    expect(parseUuidParam("id", "9e193fb2-45d0-4665-8849-7549bf37785e")).toBe(
      "9e193fb2-45d0-4665-8849-7549bf37785e"
    );
  });

  it("rejects a malformed value", () => {
    expect(() => parseUuidParam("id", "not-a-uuid")).toThrow(BadRequestException);
  });
});
