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

// Optional reference overlay + manual drag-to-align workflow.
// User drags the overlay to line up with satellite; both the overlay and the
// rendered plot polygons receive the same lat/lon shift (saved in localStorage).
const BHU_CS_BOUNDS_RAW = [[25.161056, 84.885830], [25.191833, 84.942174]];

// Load any saved alignment shift
function loadShift() {
  try { const s = JSON.parse(localStorage.getItem("alignment_shift")); if (s && typeof s.lat === "number") return s; }
  catch (_) {}
  return { lat: 0, lng: 0 };
}
function saveShift(s) { localStorage.setItem("alignment_shift", JSON.stringify(s)); }
let shift = loadShift();

function shiftedBounds() {
  return [
    [BHU_CS_BOUNDS_RAW[0][0] + shift.lat, BHU_CS_BOUNDS_RAW[0][1] + shift.lng],
    [BHU_CS_BOUNDS_RAW[1][0] + shift.lat, BHU_CS_BOUNDS_RAW[1][1] + shift.lng],
  ];
}
const bhuOverlay = L.imageOverlay("assets/bhunaksha_cs_debug.jpg", shiftedBounds(), { opacity: 0.5 });

function metersFromShift(s) {
  const M_PER_DEG_LAT = 110574;
  const lat0 = (BHU_CS_BOUNDS_RAW[0][0] + BHU_CS_BOUNDS_RAW[1][0]) / 2;
  const mPerDegLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  return { east: s.lng * mPerDegLon, north: s.lat * M_PER_DEG_LAT };
}
function updateStatusLabel() {
  const m = metersFromShift(shift);
  document.getElementById("align-status").textContent =
    `Shift: ${m.east.toFixed(0)} m east, ${m.north.toFixed(0)} m north`;
}

const bhuToggle = document.getElementById("toggle-bhu-overlay");
const bhuOpacity = document.getElementById("bhu-opacity");
const bhuDragToggle = document.getElementById("toggle-bhu-drag");
const bhuResetBtn = document.getElementById("btn-align-reset");

bhuToggle.addEventListener("change", () => {
  if (bhuToggle.checked) bhuOverlay.addTo(map); else map.removeLayer(bhuOverlay);
});
bhuOpacity.addEventListener("input", () => {
  bhuOverlay.setOpacity(Number(bhuOpacity.value) / 100);
});

// Drag handling: when drag mode is ON, we listen for map-wide mousedown then
// treat any drag as a shift to the overlay. The overlay itself is sent to
// front so it visually appears on top of polygons.
let dragStart = null;
function applyDragMode() {
  const el = bhuOverlay.getElement();
  if (!el) return;
  const on = bhuDragToggle.checked;
  el.style.cursor = on ? "move" : "";
  el.style.zIndex = on ? "650" : "";   // above polygon canvas
  // When dragging, disable Leaflet's own map drag so clicks don't pan.
  if (on) map.dragging.disable(); else map.dragging.enable();
}
bhuOverlay.on("add", applyDragMode);
bhuDragToggle.addEventListener("change", applyDragMode);

const mapEl = document.getElementById("map");
mapEl.addEventListener("mousedown", (e) => {
  if (!bhuDragToggle.checked || !map.hasLayer(bhuOverlay)) return;
  dragStart = { x: e.clientX, y: e.clientY, baseShift: { ...shift } };
});
mapEl.addEventListener("mousemove", (e) => {
  if (!dragStart) return;
  const start = map.containerPointToLatLng([dragStart.x, dragStart.y]);
  const cur = map.containerPointToLatLng([e.clientX, e.clientY]);
  shift = {
    lat: dragStart.baseShift.lat + (cur.lat - start.lat),
    lng: dragStart.baseShift.lng + (cur.lng - start.lng),
  };
  bhuOverlay.setBounds(L.latLngBounds(
    [BHU_CS_BOUNDS_RAW[0][0] + shift.lat, BHU_CS_BOUNDS_RAW[0][1] + shift.lng],
    [BHU_CS_BOUNDS_RAW[1][0] + shift.lat, BHU_CS_BOUNDS_RAW[1][1] + shift.lng],
  ));
  applyShiftToPolygons();
  updateStatusLabel();
});
window.addEventListener("mouseup", () => {
  if (!dragStart) return;
  dragStart = null;
  saveShift(shift);
});

bhuResetBtn.addEventListener("click", () => {
  shift = { lat: 0, lng: 0 };
  saveShift(shift);
  bhuOverlay.setBounds(L.latLngBounds(BHU_CS_BOUNDS_RAW));
  updateStatusLabel();
  applyShiftToPolygons();
});

updateStatusLabel();

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

// Cache original lat/lng arrays so we can re-shift polygons when alignment changes.
const polygonOriginal = [];

for (const f of features) {
  const original = f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);
  const shiftedLL = original.map(([lat, lng]) => [lat + shift.lat, lng + shift.lng]);
  const props = f.properties;
  const isLabeled = !!props.plot;
  const layer = L.polygon(shiftedLL, {
    color: "#7e8a99", weight: 0.5, opacity: 0.0,
    fillColor: "#ffffff", fillOpacity: 0, interactive: isLabeled,
  });
  if (isLabeled) {
    layer.bindTooltip(tooltipHtml(props), { sticky: true, direction: "top" });
    plotLayer.set(props.plot, { layer, props });
  }
  allLayer.addLayer(layer);
  polygonOriginal.push({ layer, original });
}

const hlOriginal = [];     // {layer, original} for highlight layers, so they can re-shift too

function applyShiftToPolygons() {
  for (const { layer, original } of polygonOriginal) {
    layer.setLatLngs(original.map(([lat, lng]) => [lat + shift.lat, lng + shift.lng]));
  }
  for (const { layer, original } of hlOriginal) {
    layer.setLatLngs(original.map(([lat, lng]) => [lat + shift.lat, lng + shift.lng]));
  }
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

  hlOriginal.length = 0;
  for (const r of rows) {
    const entry = plotLayer.get(r.plot);
    if (!entry) continue;
    linked++;
    const color = COLORS[r.identifier] || "#ffffff";
    const currentLL = entry.layer.getLatLngs()[0].map(p => [p.lat, p.lng]);
    const hl = L.polygon(currentLL, {
      color, weight: 1.5, opacity: 1, fillColor: color, fillOpacity: 0.5, interactive: true,
    });
    hl.bindTooltip(tooltipHtml(entry.props), { sticky: true, direction: "top" });
    hl.addTo(hlLayer);
    // Find original for this entry from the cache (so re-shifting works)
    const orig = polygonOriginal.find(po => po.layer === entry.layer);
    if (orig) hlOriginal.push({ layer: hl, original: orig.original });
    bounds.push(...currentLL);
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
