import { COLORS, loadJSON, loadMapping, saveMappingLocal, saveUserPolygonsLocal, centroidOf, downloadJSON, initImageMap, toLatLngs, buildPlotIndex } from "./shared.js";

const polysData = await loadJSON("assets/polygons.json");
const plotsData = await loadJSON("assets/plots.json");
const loaded = await loadMapping();
let mapping = loaded.polygon_to_plot || {};
let userPolygons = loaded.user_polygons || [];   // [{id, points, centroid}]
const plotIndex = buildPlotIndex(plotsData);

// User-drawn polygon IDs start at 10000 to never clash with auto-detected 0..868.
const USER_ID_BASE = 10000;
function nextUserId() {
  const taken = new Set(userPolygons.map(p => p.id));
  let id = USER_ID_BASE;
  while (taken.has(id)) id++;
  return id;
}

// Combined polygon list: auto-detected (unchanged) + user-drawn.
function allPolygons() {
  return [...polysData.polygons, ...userPolygons];
}

let predictions = {};
try {
  predictions = (await loadJSON("assets/predictions.json")).by_polygon || {};
} catch (_) {}

const imgW = polysData.width;
const imgH = polysData.height;
const { map } = initImageMap("map", imgW, imgH, "assets/map.jpg");

function refreshPolyCount() {
  const n = polysData.polygons.length;
  const u = userPolygons.length;
  document.getElementById("poly-count").textContent = u ? `${n} + ${u} drawn polygons` : `${n} polygons`;
}
refreshPolyCount();

const layers = new Map(); // polygonId -> L.Polygon
let selected = null;       // polygonId

// Reverse lookup
function plotForPolygon(polyId) {
  return mapping[String(polyId)];
}
function polygonForPlot(plotNo) {
  for (const [k, v] of Object.entries(mapping)) if (Number(v) === Number(plotNo)) return Number(k);
  return null;
}

// Style rules:
//   selected   -> bright magenta OUTLINE only (no fill) so the Hindi number under it stays visible
//   labeled    -> single green color for ALL owners (so you can see at a glance "yeh ho gaya, dobara mat karo")
//                 outline-only too so number is readable
//   unlabeled  -> very faint thin outline; effectively invisible until hovered/clicked
function styleFor(polyId, isSelected) {
  const plotNo = plotForPolygon(polyId);
  const isUser = polyId >= 10000;
  if (isSelected) {
    return { color: "#ff00ff", weight: 4, opacity: 1, fillColor: "#ff00ff", fillOpacity: 0, dashArray: null };
  }
  if (hideLabeled && plotNo != null) {
    return { color: "#000", weight: 0, opacity: 0, fillOpacity: 0 };
  }
  if (plotNo != null) {
    // Labeled (auto or user) -> green; user-drawn labeled gets a dashed outline so you can tell it apart.
    return { color: "#06d6a0", weight: 2.5, opacity: 1, fillColor: "#06d6a0", fillOpacity: 0.08, dashArray: isUser ? "4 3" : null };
  }
  // Unlabeled: user-drawn = bright cyan dashed so you can see it; auto = faint gray
  if (isUser) {
    return { color: "#00e5ff", weight: 2, opacity: 0.9, fillColor: "#00e5ff", fillOpacity: 0.05, dashArray: "4 3" };
  }
  return { color: "#5a6a7a", weight: 0.8, opacity: 0.45, fillColor: "#5a6a7a", fillOpacity: 0 };
}

let hideLabeled = false;

function refresh(polyId) {
  const layer = layers.get(polyId);
  if (layer) layer.setStyle(styleFor(polyId, polyId === selected));
}

function registerPolygon(p) {
  const latlngs = toLatLngs(p.points, imgH);
  const layer = L.polygon(latlngs, styleFor(p.id, false));
  layer.on("click", (e) => {
    if (drawState.active) return;     // ignore polygon clicks while drawing
    L.DomEvent.stopPropagation(e);
    selectPolygon(p.id);
  });
  layer.on("mouseover", () => {
    if (drawState.active) return;
    const plotNo = plotForPolygon(p.id);
    if (plotNo != null) {
      const r = plotIndex.get(Number(plotNo));
      if (r) {
        const init = r.initials || r.identifier;
        layer.bindTooltip(
          `<div class="tooltip-box"><div><strong>Plot ${r.plot}</strong> · ${init} (${r.identifier})</div><div>Khasra ${r.khasra} · Rakba ${r.rakba}</div></div>`,
          { sticky: true, direction: "top" }
        ).openTooltip();
      }
    } else {
      const tag = p.id >= USER_ID_BASE ? "user-drawn" : "auto-detected";
      layer.bindTooltip(
        `<div class="tooltip-box muted">Polygon #${p.id} — unlabeled (${tag})</div>`,
        { sticky: true, direction: "top" }
      ).openTooltip();
    }
  });
  layer.addTo(map);
  layers.set(p.id, layer);
}

for (const p of allPolygons()) registerPolygon(p);

// ============================================================
// DRAW MODE — let the user create a polygon for plots that auto-
// detection missed. Stored separately in localStorage; exported as
// part of mapping.json under "user_polygons".
// ============================================================
const drawState = {
  active: false,
  vertices: [],         // [[x, y], ...] in image pixel coords
  tempLine: null,       // L.Polyline while drawing
  vertexMarkers: [],    // L.CircleMarkers shown at each click
};

function clickToImageXY(latlng) {
  // CRS.Simple: lat = imgH - y, lng = x. Invert that.
  return [Math.round(latlng.lng), Math.round(imgH - latlng.lat)];
}

function refreshDrawVisual() {
  if (drawState.tempLine) { map.removeLayer(drawState.tempLine); drawState.tempLine = null; }
  for (const m of drawState.vertexMarkers) map.removeLayer(m);
  drawState.vertexMarkers = [];
  if (drawState.vertices.length === 0) return;
  // Close the visual loop with a dashed line if we have >=3 vertices.
  const latlngs = drawState.vertices.map(([x, y]) => [imgH - y, x]);
  const ring = drawState.vertices.length >= 3 ? [...latlngs, latlngs[0]] : latlngs;
  drawState.tempLine = L.polyline(ring, {
    color: "#00e5ff", weight: 3, opacity: 0.95, dashArray: "6 6", interactive: false,
  }).addTo(map);
  for (const ll of latlngs) {
    const m = L.circleMarker(ll, {
      radius: 6, color: "#00e5ff", weight: 2, fillColor: "#00e5ff", fillOpacity: 0.8, interactive: false,
    }).addTo(map);
    drawState.vertexMarkers.push(m);
  }
}

function updateDrawStatus() {
  const el = document.getElementById("draw-status");
  const finBtn = document.getElementById("btn-draw-finish");
  const cancelBtn = document.getElementById("btn-draw-cancel");
  const startBtn = document.getElementById("btn-draw-start");
  if (!drawState.active) {
    el.textContent = "Use this for plots whose boundary auto-detect ne miss kar diya.";
    startBtn.disabled = false;
    finBtn.disabled = true;
    cancelBtn.disabled = true;
    return;
  }
  const n = drawState.vertices.length;
  el.innerHTML = `<strong>Drawing</strong>: ${n} vertices clicked. ` +
    (n >= 3 ? `Press Enter or Finish to save.` : `Need at least ${3 - n} more.`);
  startBtn.disabled = true;
  finBtn.disabled = n < 3;
  cancelBtn.disabled = false;
}

function startDrawing() {
  if (drawState.active) return;
  drawState.active = true;
  drawState.vertices = [];
  // Disable polygon interactivity so map clicks always add vertices.
  layers.forEach(l => l.options && (l._origInteractive = l.options.interactive, l.options.interactive = false));
  // Visually de-emphasise existing polygons during draw mode (optional).
  document.getElementById("map").style.cursor = "crosshair";
  // If a polygon was selected, deselect (so its style refreshes off-magenta).
  if (selected != null) { const s = selected; selected = null; refresh(s); }
  updateDrawStatus();
  refreshDrawVisual();
}

function cancelDrawing() {
  if (!drawState.active) return;
  drawState.active = false;
  drawState.vertices = [];
  layers.forEach(l => l.options && (l.options.interactive = true));
  document.getElementById("map").style.cursor = "";
  refreshDrawVisual();
  updateDrawStatus();
}

function finishDrawing() {
  if (!drawState.active) return;
  if (drawState.vertices.length < 3) return;
  const points = drawState.vertices.slice();
  const id = nextUserId();
  const poly = { id, points, centroid: centroidOf(points) };
  userPolygons.push(poly);
  saveUserPolygonsLocal(userPolygons);
  refreshPolyCount();
  // Exit draw mode and register the new polygon as a normal one
  drawState.active = false;
  drawState.vertices = [];
  layers.forEach(l => l.options && (l.options.interactive = true));
  document.getElementById("map").style.cursor = "";
  refreshDrawVisual();
  updateDrawStatus();
  registerPolygon(poly);
  // Select it so user can immediately assign a plot number
  selectPolygon(id);
}

// Map click — only consumed in draw mode. Polygon clicks have their own
// handler and call stopPropagation, so map click won't fire when clicking
// directly on an existing polygon under normal mode.
map.on("click", (e) => {
  if (!drawState.active) return;
  drawState.vertices.push(clickToImageXY(e.latlng));
  refreshDrawVisual();
  updateDrawStatus();
});

document.getElementById("btn-draw-start").addEventListener("click", startDrawing);
document.getElementById("btn-draw-finish").addEventListener("click", finishDrawing);
document.getElementById("btn-draw-cancel").addEventListener("click", cancelDrawing);
updateDrawStatus();


function selectPolygon(polyId) {
  const prev = selected;
  selected = polyId;
  if (prev != null) refresh(prev);
  refresh(polyId);

  const info = document.getElementById("sel-info");
  const plotNo = plotForPolygon(polyId);
  const inp = document.getElementById("plot-input");
  if (plotNo != null) {
    const r = plotIndex.get(Number(plotNo));
    info.textContent = r
      ? `Polygon #${polyId} → Plot ${r.plot} (${r.identifier}, Khasra ${r.khasra}, Rakba ${r.rakba})`
      : `Polygon #${polyId} → Plot ${plotNo} (not in records)`;
    inp.value = plotNo;
  } else {
    // Suggest the OCR guess if any
    const guess = predictions[String(polyId)];
    if (guess) {
      const conf = guess.confident ? "high" : (guess.in_excel ? "medium" : "low");
      info.textContent = `Polygon #${polyId} — unlabeled. OCR suggests Plot ${guess.plot} (confidence: ${conf}, score ${guess.score}).`;
      inp.value = String(guess.plot);
      inp.dispatchEvent(new Event("input"));
    } else {
      info.textContent = `Polygon #${polyId} — unlabeled (no OCR guess).`;
      inp.value = "";
    }
  }
  // Defer focus past Leaflet's click handler so it actually takes.
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}

document.getElementById("plot-input").addEventListener("input", (e) => {
  const v = Number(e.target.value);
  const r = plotIndex.get(v);
  const minfo = document.getElementById("match-info");
  if (!v) { minfo.textContent = ""; return; }
  if (!r) { minfo.textContent = `Plot ${v} is not in records.`; return; }
  const existing = polygonForPlot(v);
  if (existing != null && existing !== selected) {
    minfo.textContent = `Plot ${v} → ${r.identifier}, Khasra ${r.khasra}. WARNING: already assigned to polygon #${existing}; reassigning will move it.`;
  } else {
    minfo.textContent = `Plot ${v} → ${r.identifier}, Khasra ${r.khasra}, Rakba ${r.rakba}.`;
  }
});

function flashOk() {
  // brief tick in the sel-info line so the user sees their Enter took effect
  const el = document.getElementById("sel-info");
  const original = el.textContent;
  el.style.color = "#06d6a0";
  el.textContent = "✓ Saved — click next polygon";
  setTimeout(() => { el.style.color = ""; }, 800);
}

function doAssign() {
  if (selected == null) return;
  const v = Number(document.getElementById("plot-input").value);
  if (!v) return;
  // Remove any prior assignment of this plot to a different polygon
  const existing = polygonForPlot(v);
  if (existing != null && existing !== selected) {
    delete mapping[String(existing)];
    refresh(existing);
  }
  mapping[String(selected)] = v;
  saveMappingLocal(mapping);
  const justAssigned = selected;
  selected = null;
  refresh(justAssigned);
  updateStatus();
  flashOk();
  // Auto-advance: list lost one item, same index = next pending plot.
  afterAssign();
  document.getElementById("match-info").textContent = "";
}

document.getElementById("plot-input").addEventListener("keydown", (e) => {
  if (drawState.active) {
    if (e.key === "Enter") { e.preventDefault(); finishDrawing(); return; }
    if (e.key === "Escape") { e.preventDefault(); cancelDrawing(); return; }
    return;   // ignore other keys (Tab etc.) during draw
  }
  if (e.key === "Enter") { e.preventDefault(); doAssign(); return; }
  if (e.key === "Tab") {
    e.preventDefault();
    if (!e.shiftKey && selected != null && Number(e.target.value) > 0) {
      doAssign();
    } else {
      advanceTarget(e.shiftKey ? -1 : 1);
    }
    return;
  }
  if (e.key === "Backspace" && e.target.value === "" && selected != null) {
    e.preventDefault();
    delete mapping[String(selected)];
    saveMappingLocal(mapping);
    refresh(selected);
    updateStatus();
    renderPending();
  }
});

// Global Tab — when focus is elsewhere (map canvas, body) Tab still cycles targets.
document.addEventListener("keydown", (e) => {
  const ae = document.activeElement;
  const tag = (ae?.tagName || "").toLowerCase();
  const inInput = ae?.id === "plot-input";

  // D = start drawing (when not typing in a field)
  if ((e.key === "d" || e.key === "D") && !inInput && tag !== "input" && tag !== "select" && tag !== "textarea") {
    if (!drawState.active) { e.preventDefault(); startDrawing(); return; }
  }
  // Enter/Escape during draw mode work globally
  if (drawState.active) {
    if (e.key === "Enter") { e.preventDefault(); finishDrawing(); return; }
    if (e.key === "Escape") { e.preventDefault(); cancelDrawing(); return; }
    return;
  }

  if (e.key !== "Tab") return;
  if (inInput) return;     // input handler already took it
  if (tag === "select" || tag === "button" || tag === "a") return;
  e.preventDefault();
  advanceTarget(e.shiftKey ? -1 : 1);
});

document.getElementById("btn-unassign").addEventListener("click", () => {
  if (selected == null) return;
  delete mapping[String(selected)];
  saveMappingLocal(mapping);
  refresh(selected);
  document.getElementById("plot-input").value = "";
  document.getElementById("match-info").textContent = "";
  updateStatus();
  renderPending();
});

document.getElementById("btn-export").addEventListener("click", () => {
  const payload = { polygon_to_plot: mapping };
  if (userPolygons.length) payload.user_polygons = userPolygons;
  downloadJSON("mapping.json", payload);
});

document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("import-file").click();
});
document.getElementById("import-file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const txt = await f.text();
  try {
    const j = JSON.parse(txt);
    mapping = j.polygon_to_plot || {};
    saveMappingLocal(mapping);
    // Merge in user_polygons if present
    if (Array.isArray(j.user_polygons)) {
      // Replace existing user-drawn set with the imported one
      // (Remove their layers first so we re-register cleanly)
      for (const up of userPolygons) {
        const l = layers.get(up.id);
        if (l) { map.removeLayer(l); layers.delete(up.id); }
      }
      userPolygons = j.user_polygons;
      saveUserPolygonsLocal(userPolygons);
      for (const p of userPolygons) registerPolygon(p);
      refreshPolyCount();
    }
    layers.forEach((_, id) => refresh(id));
    updateStatus();
    renderPending();
  } catch (err) { alert("Invalid JSON: " + err.message); }
});

document.getElementById("btn-clear").addEventListener("click", () => {
  if (!confirm("Clear all local labels? (User-drawn polygons are NOT removed.)")) return;
  mapping = {};
  saveMappingLocal(mapping);
  layers.forEach((_, id) => refresh(id));
  updateStatus();
  renderPending();
});

function updateStatus() {
  const labeled = Object.keys(mapping).length;
  const total = plotsData.rows.length;
  document.getElementById("status-pill").textContent = `${labeled} of ${total} labeled`;
}

// Identifier filter for pending list
const fsel = document.getElementById("filter-ident");
for (const id of plotsData.identifiers) {
  const o = document.createElement("option");
  o.value = id; o.textContent = id;
  fsel.appendChild(o);
}
fsel.addEventListener("change", () => {
  targetState.index = -1;
  renderPending();
});

// Pending-plot queue for Tab navigation.
const targetState = { list: [], index: -1 };

function rebuildPending() {
  const filter = fsel.value;
  const labeledPlots = new Set(Object.values(mapping).map(Number));
  // Stable order: by owner then by plot number so Tab feels predictable.
  targetState.list = plotsData.rows
    .filter(r => !labeledPlots.has(r.plot) && (!filter || r.identifier === filter))
    .sort((a, b) => (a.identifier > b.identifier ? 1 : a.identifier < b.identifier ? -1 : a.plot - b.plot));
}

function showTargetInfo() {
  const el = document.getElementById("target-info");
  if (!el) return;
  if (targetState.list.length === 0) {
    el.textContent = "🎉 All plots in this filter are labeled.";
    return;
  }
  if (targetState.index < 0) {
    el.textContent = `${targetState.list.length} plots pending. Press Tab to start.`;
    return;
  }
  const t = targetState.list[targetState.index];
  el.innerHTML = `Hunting for <strong>Plot ${t.plot}</strong> · ${t.identifier} · Khasra ${t.khasra} · Rakba ${t.rakba}<br>` +
    `<span class="muted">(${targetState.index + 1} of ${targetState.list.length} pending)</span>`;
}

function highlightPendingRow() {
  const rows = document.querySelectorAll("#pending-list .row");
  rows.forEach(r => r.classList.remove("active"));
  const i = targetState.index + 1;          // +1 to skip the header row
  if (rows[i]) {
    rows[i].classList.add("active");
    rows[i].scrollIntoView({ block: "nearest" });
  }
}

function selectTarget(idx) {
  if (targetState.list.length === 0) { targetState.index = -1; }
  else { targetState.index = Math.max(0, Math.min(idx, targetState.list.length - 1)); }
  const inp = document.getElementById("plot-input");
  if (targetState.index >= 0) {
    const t = targetState.list[targetState.index];
    inp.value = t.plot;
    inp.dispatchEvent(new Event("input"));
  } else {
    inp.value = "";
  }
  showTargetInfo();
  highlightPendingRow();
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}

function advanceTarget(dir) {
  rebuildPending();
  renderPendingDOM();
  if (targetState.list.length === 0) { selectTarget(-1); return; }
  let next;
  if (targetState.index < 0) next = (dir > 0) ? 0 : targetState.list.length - 1;
  else next = (targetState.index + dir + targetState.list.length) % targetState.list.length;
  selectTarget(next);
}

// Called right after an assign: list lost one item; the *same* index now points
// to what was the next pending plot, so we stay where we are.
function afterAssign() {
  const saved = targetState.index;
  rebuildPending();
  renderPendingDOM();
  if (targetState.list.length === 0) { selectTarget(-1); return; }
  // saved index might now be at end-of-list; clamp.
  selectTarget(Math.min(saved, targetState.list.length - 1));
}

function renderPendingDOM() {
  const el = document.getElementById("pending-list");
  el.innerHTML = `<div class="row head"><div>Plot</div><div>Owner</div><div>Khasra</div></div>`;
  targetState.list.forEach((r, idx) => {
    const div = document.createElement("div");
    div.className = "row unlinked";
    div.innerHTML = `<div>${r.plot}</div><div>${r.identifier}</div><div>${r.khasra}</div>`;
    div.onclick = () => selectTarget(idx);
    el.appendChild(div);
  });
  highlightPendingRow();
}

function renderPending() {
  rebuildPending();
  renderPendingDOM();
  if (targetState.index >= targetState.list.length) targetState.index = -1;
  showTargetInfo();
  highlightPendingRow();
}

// Hide-labeled toggle
const hideToggle = document.getElementById("toggle-hide-labeled");
if (hideToggle) {
  hideToggle.addEventListener("change", () => {
    hideLabeled = hideToggle.checked;
    layers.forEach((_, id) => refresh(id));
  });
}

updateStatus();
renderPending();
