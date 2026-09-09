import { describe, expect, it } from "vitest";
import { buildSvgDocument, injectStyleTemplate, renderGeometryElements, renderLabelElement } from "./svg.js";

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

describe("injectStyleTemplate", () => {
  const baseSvg = buildSvgDocument(new Map([["roads", "<path />"]]));

  it("does nothing when no colors are given", () => {
    expect(injectStyleTemplate(baseSvg, null)).toBe(baseSvg);
    expect(injectStyleTemplate(baseSvg, undefined)).toBe(baseSvg);
    expect(injectStyleTemplate(baseSvg, {})).toBe(baseSvg);
  });

  it("inserts a :root style block with known variables right after the opening <svg> tag", () => {
    const result = injectStyleTemplate(baseSvg, { "--map-water": "#123456", "--road-primary": "rgb(1,2,3)" });

    expect(result).toContain("<style>:root{--map-water:#123456;--road-primary:rgb(1,2,3);}</style>");
    expect(result.indexOf("<style>")).toBeLessThan(result.indexOf("<rect"));
    expect(result.indexOf("<svg")).toBeLessThan(result.indexOf("<style>"));
  });

  it("ignores unknown variable names (not in THEMEABLE_COLOR_VARIABLES)", () => {
    const result = injectStyleTemplate(baseSvg, { "--not-a-real-variable": "#123456" });
    expect(result).toBe(baseSvg);
  });

  it("ignores values that don't look like a plausible CSS color, without failing the whole template", () => {
    const result = injectStyleTemplate(baseSvg, {
      "--map-water": "#123456",
      "--road-primary": "red; } </style><script>alert(1)</script>",
    });

    expect(result).toContain("--map-water:#123456;");
    expect(result).not.toContain("--road-primary");
    expect(result).not.toContain("<script>");
  });

  it("leaves the rest of the document byte-for-byte identical", () => {
    const result = injectStyleTemplate(baseSvg, { "--map-water": "#123456" });
    expect(result.replace("<style>:root{--map-water:#123456;}</style>", "")).toBe(baseSvg);
  });
});
