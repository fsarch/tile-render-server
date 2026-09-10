const searchParams = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const minZoom = Number(searchParams.get("minZoom") ?? 0);
const maxZoom = Number(searchParams.get("maxZoom") ?? 18);
const apiBase = (searchParams.get("apiBase") ?? "").replace(/\/+$/, "");
const initialZoom = Number(hashParams.get("zoom") ?? searchParams.get("zoom") ?? 2);
const initialLat = Number(hashParams.get("lat") ?? searchParams.get("lat") ?? 20);
const initialLng = Number(hashParams.get("lng") ?? searchParams.get("lng") ?? 0);
const initialTheme = hashParams.get("theme") === "dark" ? "dark" : "light";

// --- Tile source -----------------------------------------------------------------
//
// The default tile source is the plain, active-template route under apiBase
// (/v1/tiles/{z}/{x}/{y}.svg - see the light/dark toggle further below for the named-
// template routes it builds on top of that same apiBase). `?tilesUrl=` (or the
// "Tile-Quelle" field in the header, which is just a live editor for the same value)
// overrides that entirely with an arbitrary base - e.g. a specific template's route on
// a deployed instance such as
// https://tiles.braun-vedder.de/templates/<id>/tiles - so a particular template can be
// pinned and inspected without needing apiBase to also point at that instance, and
// independent of whatever route layout that instance's reverse proxy exposes.
const defaultTilesBase = () => `${apiBase}/v1/tiles`;
let tilesBaseOverride = (searchParams.get("tilesUrl") ?? "").replace(/\/+$/, "");
let plainTilesUrl = buildTileUrl(tilesBaseOverride || defaultTilesBase());

function buildTileUrl(base) {
  return `${base}/{z}/{x}/{y}.svg`;
}

const map = L.map("map", {
  center: [initialLat, initialLng],
  zoom: initialZoom,
  minZoom,
  maxZoom,
  worldCopyJump: true,
});

L.control
  .scale({
    imperial: false,
  })
  .addTo(map);

const tileLayer = L.tileLayer(plainTilesUrl, {
  minZoom,
  maxZoom,
  maxNativeZoom: maxZoom,
  noWrap: false,
  crossOrigin: true,
  errorTileUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'/%3E",
}).addTo(map);

function normalizeNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function readViewState() {
  const center = map.getCenter();
  return {
    zoom: map.getZoom(),
    lat: normalizeNumber(center.lat, initialLat),
    lng: normalizeNumber(center.lng, initialLng),
  };
}

function formatViewHash() {
  const view = readViewState();
  const nextHash = new URLSearchParams();
  nextHash.set("zoom", String(view.zoom));
  nextHash.set("lat", view.lat.toFixed(6));
  nextHash.set("lng", view.lng.toFixed(6));
  if (currentTheme === "dark") {
    nextHash.set("theme", "dark");
  }
  return `#${nextHash.toString()}`;
}

function syncUrlHash() {
  const nextHash = formatViewHash();
  if (window.location.hash === nextHash) {
    return;
  }
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${nextHash}`
  );
}

// Mirrors a value into the URL's query string (as opposed to syncUrlHash's hash) -
// used for tilesUrl, so a pinned tile source round-trips through reload/copy-paste the
// same way apiBase already does, without polluting the hash (which is reserved for
// map view state).
function syncSearchParam(name, value) {
  const nextParams = new URLSearchParams(window.location.search);
  if (value) {
    nextParams.set(name, value);
  } else {
    nextParams.delete(name);
  }
  const nextSearch = nextParams.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`
  );
}

// Applies a new tile source, either from the "Tile-Quelle" field or from the initial
// ?tilesUrl= param (see setupTilesSourceForm below). An empty value resets to the
// default (apiBase + /v1/tiles) and re-enables the named-template light/dark toggle;
// a non-empty value pins the map to exactly that base and disables the toggle, since
// the toggle is built relative to apiBase and would otherwise silently overwrite the
// pin the next time it's clicked.
function applyTilesSource(rawValue) {
  const value = (rawValue ?? "").trim().replace(/\/+$/, "");
  tilesBaseOverride = value;
  plainTilesUrl = buildTileUrl(value || defaultTilesBase());
  themeTileUrls.light = plainTilesUrl;
  tileLayer.setUrl(plainTilesUrl);
  syncSearchParam("tilesUrl", value);

  if (value) {
    themeTileUrls.dark = null;
    toggleContainer.hidden = true;
    if (currentTheme === "dark") {
      currentTheme = "light";
      document.body.classList.remove("dark-mode");
    }
    syncUrlHash();
  } else {
    loadThemeToggle();
  }
}

function setupTilesSourceForm() {
  const form = document.getElementById("tiles-source-form");
  const input = document.getElementById("tiles-source-input");
  input.value = tilesBaseOverride;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    applyTilesSource(input.value);
    input.value = tilesBaseOverride;
  });
}

// --- Light/dark theme toggle --------------------------------------------------------
//
// Two templates named exactly "default" and "dark" (see src/database/seeds/) are
// looked up by name via GET /v1/templates once, at load - their ids are then used with
// GET /v1/templates/:id/tiles/{z}/{x}/{y}.svg so the toggle always renders the *named*
// theme regardless of whichever template happens to be the server's globally active
// one (see TilesController vs. TemplatesController). If no "dark" template exists, the
// toggle stays hidden entirely and the map just uses the plain, active-template route,
// unchanged from before this existed.

let currentTheme = initialTheme;
const themeTileUrls = { light: plainTilesUrl, dark: null };
const toggleContainer = document.getElementById("theme-toggle");
const toggleButton = document.getElementById("theme-toggle-button");

function describeTheme(theme) {
  return theme === "dark" ? { icon: "☀️", label: "Light Mode" } : { icon: "🌙", label: "Dark Mode" };
}

function applyTheme(theme) {
  currentTheme = theme;
  document.body.classList.toggle("dark-mode", theme === "dark");
  tileLayer.setUrl(themeTileUrls[theme] ?? plainTilesUrl);
  const next = describeTheme(theme);
  toggleButton.textContent = `${next.icon} ${next.label}`;
  toggleButton.setAttribute("aria-pressed", String(theme === "dark"));
  syncUrlHash();
}

toggleButton.addEventListener("click", () => {
  applyTheme(currentTheme === "dark" ? "light" : "dark");
});

async function loadThemeToggle() {
  let templates;
  try {
    const response = await fetch(`${apiBase}/v1/templates`);
    if (!response.ok) return;
    templates = await response.json();
  } catch (error) {
    console.warn("Light/dark toggle unavailable - could not load GET /v1/templates:", error);
    return;
  }

  for (const template of Array.isArray(templates) ? templates : []) {
    const name = String(template && template.name ? template.name : "").toLowerCase();
    const tileUrl = `${apiBase}/v1/templates/${template.id}/tiles/{z}/{x}/{y}.svg`;
    if (name === "dark") themeTileUrls.dark = tileUrl;
    if (name === "default") themeTileUrls.light = tileUrl;
  }

  if (!themeTileUrls.dark) {
    // Nothing to toggle to - leave the map on the plain, active-template route, and
    // don't claim "dark" in the URL hash if a prior visit (with a "dark" template
    // available then) left it there.
    if (currentTheme === "dark") {
      currentTheme = "light";
      syncUrlHash();
    }
    return;
  }

  toggleContainer.hidden = false;
  applyTheme(currentTheme);
}

syncUrlHash();
map.on("moveend", syncUrlHash);
setupTilesSourceForm();
if (tilesBaseOverride) {
  toggleContainer.hidden = true;
} else {
  loadThemeToggle();
}
