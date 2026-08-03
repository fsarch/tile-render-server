const DEFAULT_STYLE = Object.freeze({
  fill: "none",
  stroke: "none",
});

export const LAYER_ORDER = Object.freeze([
  "water",
  "land",
  "landuse",
  "railways",
  "roads",
  "boundaries",
  "buildings",
  "places",
]);

const SOURCE_LAYER_ALIASES = Object.freeze({
  water: ["water", "waterway"],
  land: ["land"],
  landuse: ["landuse", "landcover", "park"],
  roads: ["roads", "transportation"],
  railways: ["transportation"],
  boundaries: ["boundaries", "boundary"],
  buildings: ["buildings", "building"],
  places: ["places", "place"],
});

const NATURE_LABEL_STYLES = Object.freeze({
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
});

const LAYER_STYLES = Object.freeze({
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
      sleeper: {
        fill: "#bdbdbd",
        stroke: "#bdbdbd",
        "stroke-width": 0.7,
        "stroke-linecap": "round",
      }
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
});

const BASE_CLASS_BY_LAYER = Object.freeze({
  water: "water",
  land: "land",
  roads: "road",
  railways: "rail",
  buildings: "building",
  boundaries: "boundary",
  places: "place",
  landuse: "landuse",
});

function clampNumber(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return value;
}

function roadWidthFromClass(value, fallback) {
  if (value === "motorway" || value === "trunk") return 2.9;
  if (value === "primary") return 2.4;
  if (value === "secondary") return 2.1;
  if (value === "tertiary") return 1.8;
  if (value === "minor") return 1.5;
  if (value === "residential" || value === "unclassified" || value === "service") return 1.4;
  if (value === "track" || value === "path") return 1.1;
  return fallback;
}

const ROAD_VARIANT_STYLES = Object.freeze({
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
  path: { stroke: "#c8beaF", "stroke-dasharray": "2 1.5" },
});

export function normalizeRoadClass(properties = {}) {
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

const LANDUSE_VARIANT_STYLES = Object.freeze({
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
});

function normalizeClassToken(properties = {}) {
  const raw =
    properties.class ?? properties.subclass ?? properties.type ?? properties.kind ?? "";
  return String(raw).trim().toLowerCase();
}

function getLanduseVariant(properties = {}) {
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
  if (token.includes("park") || token.includes("recreation")) {
    return "park";
  }
  if (token.includes("pitch") || token.includes("garden") || token.includes("golf")) {
    return "park";
  }
  if (token.includes("meadow")) {
    return "meadow";
  }
  if (token.includes("grass")) {
    return "grass";
  }
  return "default";
}

export function isSupportedLayer(layerName) {
  return Object.hasOwn(LAYER_STYLES, layerName);
}

export function isFeatureAllowedForLayer(layerName, properties = {}) {
  const roadClass = normalizeRoadClass(properties);
  if (layerName === "railways") {
    return roadClass === "rail";
  }
  if (layerName === "roads") {
    return roadClass !== "rail";
  }
  return true;
}

export function getLayerOrder() {
  return LAYER_ORDER;
}

export function getSourceLayerNames(layerName) {
  return SOURCE_LAYER_ALIASES[layerName] ?? [layerName];
}

export function getNatureTextStyle(theme) {
  const style = NATURE_LABEL_STYLES[theme];
  if (!style) return null;
  return { ...style };
}

export function getStyleForFeature(layerName, geometryKind, properties = {}) {
  const styleSet = LAYER_STYLES[layerName];
  if (!styleSet) return null;

  const byGeometry =
    geometryKind === "Polygon"
      ? styleSet.polygon
      : geometryKind === "LineString"
        ? styleSet.line
        : styleSet.point;

  if (!byGeometry) return null;
  const style = { ...byGeometry };

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

export function getTextStyleForLayer(layerName) {
  const styleSet = LAYER_STYLES[layerName];
  if (!styleSet || !styleSet.text) return null;
  return { ...styleSet.text };
}

function sanitizeClassToken(token) {
  if (typeof token !== "string") return "";
  return token.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

export function buildFeatureClasses(layerName, properties = {}) {
  const tokens = [];
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
