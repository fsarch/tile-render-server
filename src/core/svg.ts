import type { NormalizedGeometry, Point2D } from "./geometry.js";
import { getBackgroundFill, getLayerOrder, THEMEABLE_COLOR_VARIABLES, type SvgStyle } from "./styles.js";

function escapeXml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(2)).toString();
}

function attributesToString(attributes: Record<string, unknown> = {}): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(" ");
}

function lineToPath(line: Point2D[], close = false): string {
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

export function lineToPathData(line: Point2D[]): string {
  return lineToPath(line, false);
}

export function renderGeometryElements(
  geometry: NormalizedGeometry,
  style: SvgStyle,
  className: string,
  extraAttributes: Record<string, unknown> = {}
): string[] {
  const baseAttributes: Record<string, unknown> = {
    ...style,
    class: className || undefined,
    ...extraAttributes,
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

  const radius = typeof style.r === "number" ? style.r : 2;
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

export function renderRailwayElements(
  geometry: NormalizedGeometry,
  railStyle: SvgStyle,
  sleeperStyle: SvgStyle,
  className: string,
  extraAttributes: Record<string, unknown> = {}
): string[] {
  if (geometry.kind !== "LineString") {
    return renderGeometryElements(geometry, railStyle, className, extraAttributes);
  }

  const output: string[] = [];
  const sleeperSegments: string[] = [];
  const sleeperSpacing = 8;
  const sleeperHalfLength = 2;

  for (const line of geometry.lines) {
    const d = lineToPath(line, false);
    if (d) {
      output.push(
        `<path ${attributesToString({
          ...railStyle,
          class: className || undefined,
          ...extraAttributes,
          d,
        })} />`
      );
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
    output.push(
      `<path ${attributesToString({
        ...sleeperStyle,
        class: className ? `${className} rail-sleeper` : "rail-sleeper",
        ...extraAttributes,
        d: sleeperSegments.join(" "),
      })} />`
    );
  }

  return output;
}

export function renderLabelElement(
  anchor: Point2D | null,
  text: string,
  className: string,
  textStyle: SvgStyle = {},
  extraAttributes: Record<string, unknown> = {}
): string {
  if (!anchor || text.trim().length === 0) return "";
  return `<text ${attributesToString({
    ...textStyle,
    class: className || undefined,
    ...extraAttributes,
    x: formatNumber(anchor.x),
    y: formatNumber(anchor.y),
  })}>${escapeXml(text)}</text>`;
}

export function renderLineLabelElement(
  pathId: string,
  pathData: string,
  text: string,
  className: string,
  textStyle: SvgStyle = {},
  extraAttributes: Record<string, unknown> = {}
): string {
  if (!pathId || !pathData || text.trim().length === 0) return "";
  const hiddenPath = `<path ${attributesToString({
    id: pathId,
    d: pathData,
    fill: "none",
    stroke: "none",
    ...extraAttributes,
  })} />`;
  const textAttrs = attributesToString({
    ...textStyle,
    class: className ? `${className} road-label` : "road-label",
    ...extraAttributes,
  });
  return `${hiddenPath}<text ${textAttrs}><textPath href="#${escapeXml(pathId)}" startOffset="50%">${escapeXml(text)}</textPath></text>`;
}

export function buildSvgDocument(groups: Map<string, string>, overlayContent = ""): string {
  const ordered = getLayerOrder();
  const layerContent = ordered
    .map((layerName) => `<g id="${layerName}">${groups.get(layerName) ?? ""}</g>`)
    .join("");

  const overlay = overlayContent ? `<g id="labels">${overlayContent}</g>` : "";
  // Always give the tile an opaque background so gaps in the "land" layer (or tiles
  // where it has no coverage at all) never fall through to a transparent tile.
  const background = `<rect x="0" y="0" width="256" height="256" fill="${getBackgroundFill()}" class="background" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${background}${layerContent}${overlay}</svg>\n`;
}

// A CSS color value safe enough to interpolate into a <style> block as-is: hex codes,
// rgb()/rgba()/hsl()/hsla() function notation, and plain keyword colors (e.g.
// "steelblue"). Rejects anything containing characters that could break out of the
// block (quotes, angle brackets, semicolons, etc.) - colors ultimately come from a
// database column (Template.colors), so this is a defense-in-depth check, not just a
// format nicety.
const SAFE_CSS_COLOR_VALUE = /^[a-zA-Z0-9#(),.\s%-]{1,64}$/;

// Injects a color theme into an already fully-rendered tile, as the very last step
// before serving it (see TilesService.renderTileSvg) - this is the only place a
// template's colors ever touch the document. renderTileToSvg itself has no notion of
// templates at all (every themeable color it emits is a `var(--x, <default>)`
// reference, see THEMEABLE_COLOR_VARIABLES in styles.ts), which is what lets one
// rendered tile be reused unchanged across any number of templates - rendering and
// styling stay fully separate, so only *this* step needs re-running when the active
// template changes, not a re-render.
//
// `colors` is filtered down to known variable names (unknown keys are ignored) and to
// values that look like a plausible CSS color (anything else is ignored too) - a
// partial or even malformed template degrades to "that one color keeps its default"
// rather than producing broken markup or failing the request.
export function injectStyleTemplate(
  svgDocument: string,
  colors: Record<string, string> | null | undefined
): string {
  if (!colors) return svgDocument;

  const declarations = THEMEABLE_COLOR_VARIABLES.filter((name) => Object.hasOwn(colors, name))
    .map((name): [string, string] => [name, colors[name]])
    .filter(([, value]) => typeof value === "string" && SAFE_CSS_COLOR_VALUE.test(value))
    .map(([name, value]) => `${name}:${value};`)
    .join("");

  if (!declarations) return svgDocument;

  const styleTag = `<style>:root{${declarations}}</style>`;
  // Insert right after the opening <svg ...> tag, before the background rect and
  // everything else - buildSvgDocument never puts a ">" inside an attribute value, so
  // the first one found is reliably the opening tag's closing bracket.
  const insertAt = svgDocument.indexOf(">") + 1;
  if (insertAt <= 0) return svgDocument;
  return svgDocument.slice(0, insertAt) + styleTag + svgDocument.slice(insertAt);
}
