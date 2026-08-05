import { describe, expect, it } from "vitest";
import { buildSvgDocument, renderGeometryElements, renderLabelElement } from "./svg.js";

describe("buildSvgDocument", () => {
  it("places label overlay after the map layers", () => {
    const svg = buildSvgDocument(new Map([["roads", "<path id='road' />"]]), "<text id='label' />");

    expect(svg.indexOf("<g id=\"roads\">")).toBeLessThan(svg.indexOf("<g id=\"labels\">"));
    expect(svg).toContain("<g id=\"labels\"><text id='label' /></g>");
  });

  it("renders data attributes on geometry and label elements", () => {
    const geometry = renderGeometryElements(
      { kind: "Point", points: [{ x: 12, y: 34 }] },
      { fill: "#000", r: 2 },
      "place",
      { "data-id": "feature-123", "data-protect-class": "4" }
    );
    const label = renderLabelElement(
      { x: 12, y: 34 },
      "Test",
      "place",
      { fill: "#000" },
      { "data-id": "feature-123", "data-protect-class": "4" }
    );

    expect(geometry[0]).toContain('data-id="feature-123"');
    expect(geometry[0]).toContain('data-protect-class="4"');
    expect(label).toContain('data-id="feature-123"');
    expect(label).toContain('data-protect-class="4"');
  });
});
