import { getLayerOrder } from "./styles.js";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(2)).toString();
}

function attributesToString(attributes = {}) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(" ");
}

function lineToPath(line, close = false) {
  if (!Array.isArray(line) || line.length === 0) return "";
  const first = line[0];
  const segments = [`M ${formatNumber(first.x)} ${formatNumber(first.y)}`];
  for (let i = 1; i < line.length; i += 1) {
    const point = line[i];
    segments.push(`L ${formatNumber(point.x)} ${formatNumber(point.y)}`);
  }

  if (close) segments.push("Z");
  return segments.join(" ");
}

export function lineToPathData(line) {
  return lineToPath(line, false);
}

export function renderGeometryElements(geometry, style, className) {
  const baseAttributes = {
    ...style,
    class: className || undefined,
  };

  if (geometry.kind === "Polygon") {
    const d = geometry.rings.map((ring) => lineToPath(ring, true)).join(" ");
    if (!d) return [];
    const attrs = attributesToString({
      ...baseAttributes,
      d,
      "fill-rule": "evenodd",
    });
    return [`<path ${attrs} />`];
  }

  if (geometry.kind === "LineString") {
    return geometry.lines
      .map((line) => lineToPath(line, false))
      .filter((d) => d.length > 0)
      .map((d) => `<path ${attributesToString({ ...baseAttributes, d })} />`);
  }

  if (geometry.kind === "Point") {
    const radius = style.r ?? 2;
    const circleStyle = { ...baseAttributes };
    delete circleStyle.r;
    return geometry.points.map(
      (point) =>
        `<circle ${attributesToString({
          ...circleStyle,
          cx: formatNumber(point.x),
          cy: formatNumber(point.y),
          r: formatNumber(radius),
        })} />`
    );
  }

  return [];
}

export function renderRailwayElements(geometry, styleArg, className) {
  const { sleeper, ...style } = styleArg;

  if (geometry.kind !== "LineString") {
    return renderGeometryElements(geometry, style, className);
  }

  const output = [];
  const sleeperSegments = [];
  const sleeperSpacing = 8;
  const sleeperHalfLength = 2;

  for (const line of geometry.lines) {
    const d = lineToPath(line, false);
    if (d) {
      output.push(`<path ${attributesToString({ ...style, class: className || undefined, d })} />`);
    }

    if (!Array.isArray(line) || line.length < 2) continue;
    let carry = sleeperSpacing / 2;
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen < 0.001) continue;

      let distance = carry;
      while (distance < segLen) {
        const t = distance / segLen;
        const cx = a.x + dx * t;
        const cy = a.y + dy * t;
        const nx = -dy / segLen;
        const ny = dx / segLen;
        const x1 = cx - nx * sleeperHalfLength;
        const y1 = cy - ny * sleeperHalfLength;
        const x2 = cx + nx * sleeperHalfLength;
        const y2 = cy + ny * sleeperHalfLength;
        sleeperSegments.push(
          `M ${formatNumber(x1)} ${formatNumber(y1)} L ${formatNumber(x2)} ${formatNumber(y2)}`
        );
        distance += sleeperSpacing;
      }
      carry = distance - segLen;
    }
  }

  if (sleeperSegments.length > 0) {
    const sleeperAttrs = attributesToString({
      ...sleeper,
      class: className ? `${className} rail-sleeper` : "rail-sleeper",
      d: sleeperSegments.join(" "),
    });
    output.push(`<path ${sleeperAttrs} />`);
  }

  return output;
}

export function renderLabelElement(anchor, text, className, textStyle = {}) {
  if (!anchor || typeof text !== "string" || text.trim().length === 0) return "";
  return `<text ${attributesToString({
    ...textStyle,
    class: className || undefined,
    x: formatNumber(anchor.x),
    y: formatNumber(anchor.y),
  })}>${escapeXml(text)}</text>`;
}

export function renderLineLabelElement(pathId, pathData, text, className, textStyle = {}) {
  if (!pathId || !pathData || typeof text !== "string" || text.trim().length === 0) return "";

  const hiddenPath = `<path ${attributesToString({
    id: pathId,
    d: pathData,
    fill: "none",
    stroke: "none",
  })} />`;
  const textAttrs = attributesToString({
    ...textStyle,
    class: className ? `${className} road-label` : "road-label",
  });
  return `${hiddenPath}<text ${textAttrs}><textPath href="#${escapeXml(pathId)}" startOffset="50%">${escapeXml(text)}</textPath></text>`;
}

export function buildSvgDocument(groups) {
  const ordered = getLayerOrder();
  const layerContent = ordered
    .map((layerName) => {
      const inner = groups.get(layerName) ?? "";
      return `<g id="${layerName}">${inner}</g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${layerContent}</svg>\n`;
}
