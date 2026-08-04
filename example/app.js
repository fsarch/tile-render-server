const searchParams = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const minZoom = Number(searchParams.get("minZoom") ?? 0);
const maxZoom = Number(searchParams.get("maxZoom") ?? 14);
const apiBase = (searchParams.get("apiBase") ?? "").replace(/\/+$/, "");
const initialZoom = Number(hashParams.get("zoom") ?? searchParams.get("zoom") ?? 2);
const initialLat = Number(hashParams.get("lat") ?? searchParams.get("lat") ?? 20);
const initialLng = Number(hashParams.get("lng") ?? searchParams.get("lng") ?? 0);
const tilesUrl = `${apiBase}/v1/tiles/{z}/{x}/{y}.svg`;

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

L.tileLayer(tilesUrl, {
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

syncUrlHash();
map.on("moveend", syncUrlHash);
