type StyleValue = string | number;
export type SvgStyle = Record<string, StyleValue>;

type LayerName =
  | "water"
  | "land"
  | "landuse"
  | "railways"
  | "roads"
  | "boundaries"
  | "buildings"
  | "places";

type GeometryKind = "Polygon" | "LineString" | "Point";

type LayerStyleDef = {
  polygon?: SvgStyle;
  line?: SvgStyle;
  point?: SvgStyle;
  text?: SvgStyle;
};

export const LAYER_ORDER: LayerName[] = [
  "water",
  "land",
  "landuse",
  "railways",
  "roads",
  "boundaries",
  "buildings",
  "places",
];

const SOURCE_LAYER_ALIASES: Record<LayerName, string[]> = {
  water: ["water", "waterway"],
  land: ["land"],
  landuse: ["landuse", "landcover", "park"],
  roads: ["roads", "transportation"],
  railways: ["transportation"],
  boundaries: ["boundaries", "boundary"],
  buildings: ["buildings", "building"],
  places: ["places", "place"],
};

const NATURE_LABEL_STYLES = {
  water: {
    fill: "#2f6ea6",
    "font-size": 10,
    "font-family": "sans-serif",
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "paint-order": "stroke",
    stroke: "#ffffff",
    "stroke-width": 2.4,
    "stroke-linejoin": "round",
  },
  nature: {
    fill: "#49613b",
    "font-size": 10,
    "font-family": "sans-serif",
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "paint-order": "stroke",
    stroke: "#ffffff",
    "stroke-width": 2.2,
    "stroke-linejoin": "round",
  },
} as const satisfies Record<string, SvgStyle>;

const LAYER_STYLES: Record<LayerName, LayerStyleDef> = {
  water: {
    polygon: { fill: "#9ecfff", stroke: "none" },
    line: { stroke: "#7bb7ef", "stroke-width": 1, fill: "none" },
    point: { fill: "#7bb7ef", stroke: "none", r: 1.5 },
  },
  land: {
    polygon: { fill: "#f5f3e7", stroke: "none" },
    line: { stroke: "#e8e0cb", "stroke-width": 1, fill: "none" },
    point: { fill: "#e8e0cb", stroke: "none", r: 1.5 },
  },
  roads: {
    line: {
      stroke: "#ffffff",
      "stroke-width": 1.5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      fill: "none",
    },
    text: {
      fill: "#5d5241",
      "font-size": 9,
      "font-family": "sans-serif",
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "paint-order": "stroke",
      stroke: "#ffffff",
      "stroke-width": 2.5,
      "stroke-linejoin": "round",
    },
  },
  railways: {
    line: {
      stroke: "#bdbdbd",
      "stroke-width": 0.9,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      fill: "none",
    },
  },
  buildings: {
    polygon: { fill: "#e5ddd0", stroke: "#cdbfaa", "stroke-width": 0.5 },
  },
  boundaries: {
    line: {
      stroke: "#8f8f8f",
      "stroke-width": 0.9,
      "stroke-dasharray": "3 2",
      fill: "none",
    },
  },
  places: {
    point: { fill: "#666666", stroke: "none", r: 1.8 },
    text: {
      fill: "#444444",
      "font-size": 10,
      "font-family": "sans-serif",
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "paint-order": "stroke",
      stroke: "#ffffff",
      "stroke-width": 2,
    },
  },
  landuse: {
    polygon: { fill: "#cfe7b9", stroke: "none" },
    line: { stroke: "#aacd95", "stroke-width": 1, fill: "none" },
    point: { fill: "#aacd95", stroke: "none", r: 1.4 },
  },
};

const RAIL_SLEEPER_STYLE: SvgStyle = {
  fill: "#bdbdbd",
  stroke: "#bdbdbd",
  "stroke-width": 0.7,
  "stroke-linecap": "round",
};

const BASE_CLASS_BY_LAYER: Record<LayerName, string> = {
  water: "water",
  land: "land",
  roads: "road",
  railways: "rail",
  buildings: "building",
  boundaries: "boundary",
  places: "place",
  landuse: "landuse",
};

function clampNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return value;
}

function roadWidthFromClass(value: string, fallback: number): number {
  if (value === "motorway" || value === "trunk") return 2.9;
  if (value === "primary") return 2.4;
  if (value === "secondary") return 2.1;
  if (value === "tertiary") return 1.8;
  if (value === "minor") return 1.5;
  if (value === "residential" || value === "unclassified" || value === "service") return 1.4;
  if (value === "track" || value === "path") return 1.1;
  return fallback;
}

const ROAD_VARIANT_STYLES: Record<string, SvgStyle> = {
  motorway: { stroke: "#f4a23c" },
  trunk: { stroke: "#f4a23c" },
  primary: { stroke: "#f7c948" },
  secondary: { stroke: "#f8dea1" },
  tertiary: { stroke: "#f7e8c8" },
  minor: { stroke: "#ffffff" },
  residential: { stroke: "#ffffff" },
  unclassified: { stroke: "#ffffff" },
  service: { stroke: "#f2f2f2" },
  track: { stroke: "#d3c8b8", "stroke-dasharray": "2 1.5" },
  path: { stroke: "#c8beaf", "stroke-dasharray": "2 1.5" },
};

export function normalizeRoadClass(properties: Record<string, unknown> = {}): string {
  const token = String(
    properties.class ?? properties.type ?? properties.subclass ?? properties.kind ?? ""
  )
    .trim()
    .toLowerCase();
  if (token.endsWith("_link")) {
    return token.replace("_link", "");
  }
  return token;
}

const LANDUSE_VARIANT_STYLES: Record<string, LayerStyleDef> = {
  urban: {
    polygon: { fill: "#ece6db", stroke: "none" },
    line: { stroke: "#d6cebf", "stroke-width": 1, fill: "none" },
    point: { fill: "#d6cebf", stroke: "none", r: 1.4 },
  },
  park: {
    polygon: { fill: "#cdebb0", stroke: "none" },
    line: { stroke: "#9fcf86", "stroke-width": 1, fill: "none" },
    point: { fill: "#9fcf86", stroke: "none", r: 1.4 },
  },
  meadow: {
    polygon: { fill: "#d7efbb", stroke: "none" },
    line: { stroke: "#a9d38f", "stroke-width": 1, fill: "none" },
    point: { fill: "#a9d38f", stroke: "none", r: 1.4 },
  },
  grass: {
    polygon: { fill: "#d4ebb7", stroke: "none" },
    line: { stroke: "#a7cf8d", "stroke-width": 1, fill: "none" },
    point: { fill: "#a7cf8d", stroke: "none", r: 1.4 },
  },
  farmland: {
    polygon: { fill: "#e6e2b8", stroke: "none" },
    line: { stroke: "#d1c98f", "stroke-width": 1, fill: "none" },
    point: { fill: "#d1c98f", stroke: "none", r: 1.4 },
  },
  forest: {
    polygon: { fill: "#b7d3a8", stroke: "none" },
    line: { stroke: "#8fb784", "stroke-width": 1, fill: "none" },
    point: { fill: "#8fb784", stroke: "none", r: 1.4 },
  },
  bare: {
    polygon: { fill: "#ddd7cb", stroke: "none" },
    line: { stroke: "#c5bdaf", "stroke-width": 1, fill: "none" },
    point: { fill: "#c5bdaf", stroke: "none", r: 1.4 },
  },
  sand: {
    polygon: { fill: "#efe3bf", stroke: "none" },
    line: { stroke: "#d9c999", "stroke-width": 1, fill: "none" },
    point: { fill: "#d9c999", stroke: "none", r: 1.4 },
  },
  scrub: {
    polygon: { fill: "#c8d7b5", stroke: "none" },
    line: { stroke: "#a8bc93", "stroke-width": 1, fill: "none" },
    point: { fill: "#a8bc93", stroke: "none", r: 1.4 },
  },
  wetland: {
    polygon: { fill: "#bfdcc8", stroke: "none" },
    line: { stroke: "#98bfa7", "stroke-width": 1, fill: "none" },
    point: { fill: "#98bfa7", stroke: "none", r: 1.4 },
  },
  ice: {
    polygon: { fill: "#e8f2f8", stroke: "none" },
    line: { stroke: "#c8dae8", "stroke-width": 1, fill: "none" },
    point: { fill: "#c8dae8", stroke: "none", r: 1.4 },
  },
  rock: {
    polygon: { fill: "#cec9c2", stroke: "none" },
    line: { stroke: "#b5aea4", "stroke-width": 1, fill: "none" },
    point: { fill: "#b5aea4", stroke: "none", r: 1.4 },
  },
  heath: {
    polygon: { fill: "#d8ccba", stroke: "none" },
    line: { stroke: "#bfae99", "stroke-width": 1, fill: "none" },
    point: { fill: "#bfae99", stroke: "none", r: 1.4 },
  },
  shrub: {
    polygon: { fill: "#cadab8", stroke: "none" },
    line: { stroke: "#a9be95", "stroke-width": 1, fill: "none" },
    point: { fill: "#a9be95", stroke: "none", r: 1.4 },
  },
};

function normalizeClassToken(properties: Record<string, unknown> = {}): string {
  const raw = properties.class ?? properties.subclass ?? properties.type ?? properties.kind ?? "";
  return String(raw).trim().toLowerCase();
}

function getLanduseVariant(properties: Record<string, unknown> = {}): string {
  const token = normalizeClassToken(properties);
  if (!token) return "default";
  if (
    token.includes("forest") ||
    token.includes("wood") ||
    token.includes("natural_wood") ||
    token.includes("nature_reserve")
  ) {
    return "forest";
  }
  if (
    token.includes("farmland") ||
    token.includes("farm") ||
    token.includes("orchard") ||
    token.includes("vineyard") ||
    token.includes("allotments")
  ) {
    return "farmland";
  }
  if (
    token.includes("residential") ||
    token.includes("commercial") ||
    token.includes("industrial") ||
    token.includes("railway")
  ) {
    return "urban";
  }
  if (token.includes("park") || token.includes("recreation")) return "park";
  if (token.includes("pitch") || token.includes("garden") || token.includes("golf")) return "park";
  if (token.includes("meadow")) return "meadow";
  if (token.includes("grass")) return "grass";
  if (
    token.includes("wetland") ||
    token.includes("marsh") ||
    token.includes("swamp") ||
    token.includes("bog") ||
    token.includes("reed")
  ) {
    return "wetland";
  }
  if (
    token.includes("glacier") ||
    token.includes("ice") ||
    token.includes("snow")
  ) {
    return "ice";
  }
  if (
    token.includes("beach") ||
    token.includes("sand") ||
    token.includes("dune")
  ) {
    return "sand";
  }
  if (
    token.includes("bare_rock") ||
    token.includes("rock") ||
    token.includes("scree") ||
    token.includes("cliff")
  ) {
    return "rock";
  }
  if (token.includes("bare") || token.includes("barren")) return "bare";
  if (token.includes("scrub") || token.includes("bush")) return "scrub";
  if (token.includes("heath") || token.includes("moor")) return "heath";
  if (token.includes("shrub") || token.includes("shrubland")) return "shrub";
  return "default";
}

export function isSupportedLayer(layerName: string): layerName is LayerName {
  return Object.hasOwn(LAYER_STYLES, layerName);
}

export function isFeatureAllowedForLayer(
  layerName: LayerName,
  properties: Record<string, unknown> = {}
): boolean {
  const roadClass = normalizeRoadClass(properties);
  if (layerName === "railways") {
    return roadClass === "rail";
  }
  if (layerName === "roads") {
    return roadClass !== "rail";
  }
  return true;
}

export function getLayerOrder(): LayerName[] {
  return LAYER_ORDER;
}

export function getSourceLayerNames(layerName: LayerName): string[] {
  return SOURCE_LAYER_ALIASES[layerName] ?? [layerName];
}

export function getNatureTextStyle(theme: "water" | "nature"): SvgStyle | null {
  const style = NATURE_LABEL_STYLES[theme];
  if (!style) return null;
  return { ...style };
}

export function getRailSleeperStyle(): SvgStyle {
  return { ...RAIL_SLEEPER_STYLE };
}

export function getStyleForFeature(
  layerName: LayerName,
  geometryKind: GeometryKind,
  properties: Record<string, unknown> = {}
): SvgStyle | null {
  const styleSet = LAYER_STYLES[layerName];
  if (!styleSet) return null;

  const byGeometry =
    geometryKind === "Polygon"
      ? styleSet.polygon
      : geometryKind === "LineString"
        ? styleSet.line
        : styleSet.point;

  if (!byGeometry) return null;
  const style: SvgStyle = { ...byGeometry };

  if (layerName === "roads" && geometryKind === "LineString") {
    const roadClass = normalizeRoadClass(properties);
    const roadVariant = ROAD_VARIANT_STYLES[roadClass];
    if (roadVariant) {
      Object.assign(style, roadVariant);
    }
    style["stroke-width"] = roadWidthFromClass(
      roadClass,
      clampNumber(style["stroke-width"], 1.5)
    );
  }

  if (layerName === "landuse") {
    const variant = getLanduseVariant(properties);
    if (variant !== "default") {
      const variantStyleSet = LANDUSE_VARIANT_STYLES[variant];
      const variantByGeometry =
        geometryKind === "Polygon"
          ? variantStyleSet.polygon
          : geometryKind === "LineString"
            ? variantStyleSet.line
            : variantStyleSet.point;
      if (variantByGeometry) {
        return { ...variantByGeometry };
      }
    }
  }

  return style;
}

export function getTextStyleForLayer(layerName: LayerName): SvgStyle | null {
  const styleSet = LAYER_STYLES[layerName];
  if (!styleSet || !styleSet.text) return null;
  return { ...styleSet.text };
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function placeClassBaseSize(placeClass: string): number {
  if (placeClass === "country") return 16;
  if (placeClass === "state" || placeClass === "province" || placeClass === "region") return 14;
  if (placeClass === "city") return 13;
  if (placeClass === "town") return 11.5;
  if (placeClass === "village" || placeClass === "suburb") return 10;
  return 9;
}

function shouldSuppressPlaceLabel(properties: Record<string, unknown>): boolean {
  const tokens = [
    String(properties.class ?? "").toLowerCase(),
    String(properties.subclass ?? "").toLowerCase(),
    String(properties.kind ?? "").toLowerCase(),
    String(properties.type ?? "").toLowerCase(),
  ];
  return tokens.some((token) =>
    token === "state" ||
    token === "province" ||
    token === "region" ||
    token === "federal_state" ||
    token === "federal-state" ||
    token === "bundesland"
  );
}

function shouldSuppressLowZoomPlaceLabel(
  placeClass: string,
  rank: number | null,
  population: number | null,
  capital: number | null,
  zoom?: number
): boolean {
  if (!Number.isInteger(zoom) || (zoom ?? 0) > 9) {
    return false;
  }

  if (placeClass === "village" || placeClass === "suburb") {
    return true;
  }

  if (placeClass !== "town") {
    return false;
  }

  if (capital !== null && capital > 0) {
    return false;
  }

  const isHighRank = rank !== null && rank <= 6;
  const isLargeEnough = population !== null && population >= 100_000;
  return !isHighRank && !isLargeEnough;
}

export function getTextStyleForFeature(
  layerName: LayerName,
  properties: Record<string, unknown> = {},
  zoom?: number
): SvgStyle | null {
  const base = getTextStyleForLayer(layerName);
  if (!base) return null;

  if (layerName !== "places") {
    return base;
  }
  if (shouldSuppressPlaceLabel(properties)) {
    return null;
  }

  const placeClass = String(properties.class ?? "").toLowerCase();
  const rank = toNumberOrNull(properties.rank);
  const population = toNumberOrNull(properties.population);
  const capital = toNumberOrNull(properties.capital);
  if (shouldSuppressLowZoomPlaceLabel(placeClass, rank, population, capital, zoom)) {
    return null;
  }

  let size = placeClassBaseSize(placeClass);

  if (capital !== null && capital > 0) size += 1;
  if (rank !== null) {
    if (rank <= 3) size += 2;
    else if (rank <= 6) size += 1;
    else if (rank >= 11) size -= 1;
  }
  if (population !== null) {
    if (population >= 2_000_000) size += 2;
    else if (population >= 500_000) size += 1;
    else if (population < 25_000) size -= 0.8;
  }

  const fontSize = Math.max(8, Math.min(18, size));
  if (Number.isInteger(zoom) && (zoom ?? 0) <= 13 && fontSize <= 10) {
    return null;
  }
  const strokeWidth = Number(Math.max(1.8, fontSize * 0.2).toFixed(2));

  return {
    ...base,
    "font-size": Number(fontSize.toFixed(1)),
    "stroke-width": strokeWidth,
  };
}

function sanitizeClassToken(token: unknown): string {
  if (typeof token !== "string") return "";
  return token.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

export function buildFeatureClasses(
  layerName: LayerName,
  properties: Record<string, unknown> = {}
): string {
  const tokens: string[] = [];
  const base = BASE_CLASS_BY_LAYER[layerName];
  if (base) tokens.push(base);

  const detail = sanitizeClassToken(
    String(
      properties.class ?? properties.subclass ?? properties.type ?? properties.kind ?? ""
    )
  );
  if (detail) tokens.push(detail);
  return tokens.join(" ").trim();
}
