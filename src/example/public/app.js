const searchParams = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const minZoom = Number(searchParams.get("minZoom") ?? 0);
const maxZoom = Number(searchParams.get("maxZoom") ?? 18);
const apiBase = (searchParams.get("apiBase") ?? "").replace(/\/+$/, "");
const initialZoom = Number(hashParams.get("zoom") ?? searchParams.get("zoom") ?? 2);
const initialLat = Number(hashParams.get("lat") ?? searchParams.get("lat") ?? 20);
const initialLng = Number(hashParams.get("lng") ?? searchParams.get("lng") ?? 0);
const initialTheme = hashParams.get("theme") === "dark" ? "dark" : "light";
const plainTilesUrl = `${apiBase}/v1/tiles/{z}/{x}/{y}.svg`;

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
loadThemeToggle();
