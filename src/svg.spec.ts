import { describe, expect, it } from "vitest";
import { buildSvgDocument } from "./svg.js";

describe("buildSvgDocument", () => {
  it("places label overlay after the map layers", () => {
    const svg = buildSvgDocument(new Map([["roads", "<path id='road' />"]]), "<text id='label' />");

    expect(svg.indexOf("<g id=\"roads\">")).toBeLessThan(svg.indexOf("<g id=\"labels\">"));
    expect(svg).toContain("<g id=\"labels\"><text id='label' /></g>");
  });
});
