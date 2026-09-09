import { BadRequestException } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { assertTileBounds, parseTileCoordinate, writeSvgResponse } from "./tile-request.util.js";

describe("parseTileCoordinate", () => {
  it("parses a valid non-negative integer", () => {
    expect(parseTileCoordinate("z", "12")).toBe(12);
  });

  it("rejects non-numeric input", () => {
    expect(() => parseTileCoordinate("z", "abc")).toThrow(BadRequestException);
  });

  it("rejects negative numbers (not matched by the digits-only pattern)", () => {
    expect(() => parseTileCoordinate("x", "-1")).toThrow(BadRequestException);
  });

  it("enforces an optional max value", () => {
    expect(() => parseTileCoordinate("z", "31", 30)).toThrow(BadRequestException);
    expect(parseTileCoordinate("z", "30", 30)).toBe(30);
  });
});

describe("assertTileBounds", () => {
  it("accepts coordinates within range for the given zoom", () => {
    expect(() => assertTileBounds(2, 3, 3)).not.toThrow();
  });

  it("rejects coordinates outside the valid range for the given zoom", () => {
    expect(() => assertTileBounds(2, 4, 0)).toThrow(BadRequestException);
  });
});

describe("writeSvgResponse", () => {
  it("writes status, headers, and body", () => {
    const response = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse;

    writeSvgResponse(response, "<svg />", "public, max-age=60");

    expect(response.statusCode).toBe(200);
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "image/svg+xml; charset=utf-8");
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "public, max-age=60");
    expect(response.end).toHaveBeenCalledWith("<svg />");
  });
});
