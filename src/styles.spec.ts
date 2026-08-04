import { describe, expect, it } from "vitest";
import { getTextStyleForFeature } from "./styles.js";

describe("getTextStyleForFeature", () => {
  it("keeps a city label visible at zoom 9", () => {
    const style = getTextStyleForFeature("places", {
      class: "city",
      population: 180000,
      rank: 3,
    }, 9);

    expect(style).not.toBeNull();
  });

  it("hides small towns at zoom 9 and lower", () => {
    const style = getTextStyleForFeature("places", {
      class: "town",
      population: 24000,
      rank: 12,
    }, 9);

    expect(style).toBeNull();
  });

  it("hides villages at zoom 9 and lower", () => {
    const style = getTextStyleForFeature("places", {
      class: "village",
      population: 3000,
    }, 8);

    expect(style).toBeNull();
  });
});
