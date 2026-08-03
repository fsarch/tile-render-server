const params = new URLSearchParams(window.location.search);
const minZoom = Number(params.get("minZoom") ?? 0);
const maxZoom = Number(params.get("maxZoom") ?? 14);
const zoom = Number(params.get("zoom") ?? 2);
const centerLat = Number(params.get("lat") ?? 20);
const centerLng = Number(params.get("lng") ?? 0);

const map = L.map("map", {
  center: [centerLat, centerLng],
  zoom,
  minZoom,
  maxZoom,
  worldCopyJump: true,
});

L.tileLayer("/tiles/{z}/{x}/{y}.svg", {
  minZoom,
  maxZoom,
  maxNativeZoom: maxZoom,
  noWrap: false,
  crossOrigin: true,
  errorTileUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'/%3E",
}).addTo(map);

