import { COLORS, loadJSON, buildPlotIndex } from "./shared.js";

const features = (await loadJSON("assets/polygons_latlon.json")).features;
const plotsData = await loadJSON("assets/plots.json");
const plotIndex = buildPlotIndex(plotsData);
const INITIALS = plotsData.initials_map || {};
const ALL_IDENT = "(all)";

// Initialise a normal lat/lon Leaflet map
const map = L.map("map", {
  attributionControl: true,
  preferCanvas: true,
  zoomControl: false,
});
L.control.zoom({ position: "bottomright" }).addTo(map);

// Tile providers
const TILE_LAYERS = {
  esri: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles © Esri" }
  ),
  google: L.tileLayer(
    "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    { maxZoom: 20, attribution: "© Google" }
  ),
  osm: L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{y}/{x}.png".replace("{y}/{x}", "{z}/{x}/{y}"),
    { maxZoom: 19, attribution: "© OpenStreetMap contributors" }
  ),
};

// OSM URL fix (above line had wrong format)
TILE_LAYERS.osm = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  { maxZoom: 19, attribution: "© OpenStreetMap contributors" }
);

let currentTiles = null;
function setTiles(name) {
  if (currentTiles) map.removeLayer(currentTiles);
  currentTiles = TILE_LAYERS[name] || TILE_LAYERS.esri;
  currentTiles.addTo(map);
  currentTiles.bringToBack();
}
setTiles("esri");

document.getElementById("basemap-tiles").addEventListener("change", (e) => setTiles(e.target.value));

// Optional reference overlay: the official Bhu-Naksha cadastral raster at its
// claimed lat/lon bounds (EPSG:24345 Indian datum, the projection actually used
// by Bihar Bhu-Naksha — not WGS84 UTM as the WMS metadata claims).
const BHU_CS_BOUNDS = [[25.161056, 84.885830], [25.191833, 84.942174]];
const bhuOverlay = L.imageOverlay("assets/bhunaksha_cs_debug.jpg", BHU_CS_BOUNDS, {opacity: 0.5});
const bhuToggle = document.getElementById("toggle-bhu-overlay");
if (bhuToggle) {
  bhuToggle.addEventListener("change", () => {
    if (bhuToggle.checked) bhuOverlay.addTo(map); else map.removeLayer(bhuOverlay);
  });
}

// Compute bounds from features
let allLat = [], allLon = [];
for (const f of features) {
  for (const [lon, lat] of f.geometry.coordinates[0]) {
    allLat.push(lat); allLon.push(lon);
  }
}
const bounds = [[Math.min(...allLat), Math.min(...allLon)], [Math.max(...allLat), Math.max(...allLon)]];
map.fitBounds(bounds);

// Build polygon layers — key by plot
const plotLayer = new Map();      // plot number -> Leaflet polygon
const allLayer = L.layerGroup().addTo(map);
const hlLayer = L.layerGroup().addTo(map);

function tooltipHtml(props) {
  if (props.plot) {
    const init = props.initials || INITIALS[props.identifier] || props.identifier;
    return `<div class="tooltip-box">
      <div><strong>Plot ${props.plot}</strong> · ${init} (${props.identifier})</div>
      <div>Khasra: ${props.khasra}</div>
      <div>Rakba: ${props.rakba}</div>
    </div>`;
  }
  return `<div class="tooltip-box"><div class="muted">Polygon #${props.polygon_id} — unlabeled</div></div>`;
}

for (const f of features) {
  const latlngs = f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);
  const props = f.properties;
  const isLabeled = !!props.plot;
  const layer = L.polygon(latlngs, {
    color: "#7e8a99", weight: 0.5, opacity: 0.0,
    fillColor: "#ffffff", fillOpacity: 0, interactive: isLabeled,
  });
  if (isLabeled) {
    layer.bindTooltip(tooltipHtml(props), { sticky: true, direction: "top" });
    plotLayer.set(props.plot, { layer, props });
  }
  allLayer.addLayer(layer);
}

// Identifier dropdown
const sel = document.getElementById("identifier");
const idents = ["(none)", ALL_IDENT, ...plotsData.identifiers];
for (const id of idents) {
  const o = document.createElement("option");
  o.value = id;
  if (id === "(none)") o.textContent = "— Select identifier —";
  else if (id === ALL_IDENT) o.textContent = "All (A + B + C + D)";
  else o.textContent = `${id} (${INITIALS[id] || id})`;
  sel.appendChild(o);
}

function setIdentifier(ident) {
  hlLayer.clearLayers();
  const isAll = ident === ALL_IDENT;
  const rows = (isAll
      ? plotsData.rows.slice()
      : plotsData.rows.filter(r => r.identifier === ident)
    ).sort((a, b) => a.identifier === b.identifier ? a.plot - b.plot : (a.identifier < b.identifier ? -1 : 1));

  const listEl = document.getElementById("plots-list");
  listEl.innerHTML = `<div class="row head row-4"><div>Plot</div><div>Owner</div><div>Khasra</div><div>Rakba</div></div>`;
  let linked = 0;
  const bounds = [];

  for (const r of rows) {
    const entry = plotLayer.get(r.plot);
    const div = document.createElement("div");
    div.className = "row row-4 " + (entry ? "linked" : "unlinked");
    const init = r.initials || INITIALS[r.identifier] || r.identifier;
    div.innerHTML = `<div>${r.plot}</div><div>${init}</div><div>${r.khasra}</div><div>${r.rakba}</div>`;
    if (entry) {
      div.onclick = () => {
        map.flyToBounds(entry.layer.getBounds().pad(2), { duration: 0.6 });
        entry.layer.openTooltip(entry.layer.getBounds().getCenter());
      };
    }
    listEl.appendChild(div);
  }
  document.getElementById("plots-count").textContent = rows.length;

  if (ident === "(none)") {
    document.getElementById("ident-summary").textContent = "";
    document.getElementById("link-status").textContent = "linked 0 / 0";
    return;
  }

  for (const r of rows) {
    const entry = plotLayer.get(r.plot);
    if (!entry) continue;
    linked++;
    const color = COLORS[r.identifier] || "#ffffff";
    const hl = L.polygon(entry.layer.getLatLngs(), {
      color, weight: 1.5, opacity: 1, fillColor: color, fillOpacity: 0.5, interactive: true,
    });
    hl.bindTooltip(tooltipHtml(entry.props), { sticky: true, direction: "top" });
    hl.addTo(hlLayer);
    bounds.push(...entry.layer.getLatLngs()[0]);
  }

  document.getElementById("ident-summary").textContent =
    `${rows.length} plots in records, ${linked} linked to map polygons.`;
  document.getElementById("link-status").textContent = `linked ${linked} / ${rows.length}`;

  if (bounds.length) map.flyToBounds(L.latLngBounds(bounds).pad(0.3), { duration: 0.6 });
}

sel.addEventListener("change", () => setIdentifier(sel.value));

// Auto-pick All
sel.value = ALL_IDENT;
setIdentifier(ALL_IDENT);

// Sidebar toggle (re-use the shared logic by manually wiring here since initImageMap isn't used)
const app = document.querySelector(".app");
const toggleBtn = document.getElementById("sidebar-toggle");
const backdrop = document.getElementById("sidebar-backdrop");
const isNarrow = () => window.matchMedia("(max-width: 768px)").matches;
if (isNarrow()) app.classList.add("sidebar-collapsed");
if (backdrop) backdrop.hidden = !isNarrow();
toggleBtn.addEventListener("click", () => {
  app.classList.toggle("sidebar-collapsed");
  if (backdrop) backdrop.hidden = !isNarrow();
  setTimeout(() => map.invalidateSize(), 260);
});
if (backdrop) backdrop.addEventListener("click", () => {
  app.classList.add("sidebar-collapsed");
  backdrop.hidden = !isNarrow();
  setTimeout(() => map.invalidateSize(), 260);
});
window.addEventListener("resize", () => { if (backdrop) backdrop.hidden = !isNarrow(); map.invalidateSize(); });
