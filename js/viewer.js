import { COLORS, loadJSON, loadMapping, initImageMap, toLatLngs, buildPlotIndex } from "./shared.js";

const polysData = await loadJSON("assets/polygons.json");
const plotsData = await loadJSON("assets/plots.json");
const mapping = await loadMapping();

const polygonToPlot = mapping.polygon_to_plot || {};
const userPolygons = mapping.user_polygons || [];
const plotIndex = buildPlotIndex(plotsData);
const INITIALS = plotsData.initials_map || {};
const ALL_IDENT = "(all)";

const imgW = polysData.width;
const imgH = polysData.height;
const { map, baseOverlay: pdfOverlay } = initImageMap("map", imgW, imgH, "assets/map.jpg");

// Optional Bhu-Naksha official base map (loaded lazily on first toggle)
let bhuOverlay = null;
let bhuMeta = null;
async function ensureBhuOverlay() {
  if (bhuOverlay) return bhuOverlay;
  try {
    bhuMeta = await loadJSON("assets/bhunaksha_meta.json");
    const bw = bhuMeta.image.width, bh = bhuMeta.image.height;
    bhuOverlay = L.imageOverlay(bhuMeta.image.file, [[0, 0], [bh, bw]]);
  } catch (e) {
    console.warn("Bhu-Naksha metadata unavailable:", e);
    bhuOverlay = null;
  }
  return bhuOverlay;
}

const pdfBounds = [[0, 0], [imgH, imgW]];

// Combined polygon list: auto-detected + user-drawn (from mapping.json/localStorage)
const allPolygons = [...polysData.polygons, ...userPolygons];

// plotNo -> [layer, polygonId]
const plotLayers = new Map();
// All layers as a single group
const allLayers = L.layerGroup().addTo(map);
// Highlighted layers (on top)
const highlightLayers = L.layerGroup().addTo(map);

function tooltipHtml(plotNo, polyId) {
  const r = plotIndex.get(plotNo);
  if (r) {
    const init = r.initials || INITIALS[r.identifier] || r.identifier;
    return `<div class="tooltip-box">
      <div><strong>Plot ${r.plot}</strong> · ${init} (${r.identifier})</div>
      <div>Khasra: ${r.khasra}</div>
      <div>Rakba: ${r.rakba}</div>
    </div>`;
  }
  return `<div class="tooltip-box"><div class="muted">Unlabeled polygon #${polyId}</div></div>`;
}

// Build base layers (all polygons including user-drawn, very faint until needed).
for (const p of allPolygons) {
  const plotNo = polygonToPlot[String(p.id)];
  const latlngs = toLatLngs(p.points, imgH);
  const layer = L.polygon(latlngs, {
    color: "#7e8a99",
    weight: 0.6,
    opacity: 0.0,        // hidden by default
    fillColor: "#ffffff",
    fillOpacity: 0,
    interactive: !!plotNo, // only interact if labeled
  });
  if (plotNo != null) {
    layer.bindTooltip(tooltipHtml(plotNo, p.id), { sticky: true, direction: "top", className: "no-style" });
    plotLayers.set(Number(plotNo), { layer, polyId: p.id });
  }
  layer.addTo(allLayers);
}

// Identifier dropdown with All option
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
  highlightLayers.clearLayers();
  const isAll = ident === ALL_IDENT;
  // Sort rows: by identifier (alphabetical) then by plot number
  const rows = (isAll
      ? plotsData.rows.slice()
      : plotsData.rows.filter(r => r.identifier === ident)
    ).sort((a, b) => a.identifier === b.identifier ? a.plot - b.plot : (a.identifier < b.identifier ? -1 : 1));
  const bounds = [];
  let linked = 0;

  // Render plot list — show Initials column too
  const listEl = document.getElementById("plots-list");
  listEl.innerHTML = `<div class="row head row-4"><div>Plot</div><div>Owner</div><div>Khasra</div><div>Rakba</div></div>`;
  for (const r of rows) {
    const entry = plotLayers.get(r.plot);
    const div = document.createElement("div");
    div.className = "row row-4 " + (entry ? "linked" : "unlinked");
    const init = r.initials || INITIALS[r.identifier] || r.identifier;
    div.innerHTML = `<div>${r.plot}</div><div>${init}</div><div>${r.khasra}</div><div>${r.rakba}</div>`;
    if (entry) {
      div.onclick = () => {
        const b = entry.layer.getBounds();
        map.flyToBounds(b.pad(2), { duration: 0.6 });
        entry.layer.openTooltip(b.getCenter());
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
    const entry = plotLayers.get(r.plot);
    if (!entry) continue;
    linked++;
    const color = COLORS[r.identifier] || "#ffffff";
    const hl = L.polygon(entry.layer.getLatLngs(), {
      color,
      weight: 2.2,
      opacity: 1,
      fillColor: color,
      fillOpacity: 0.45,
      interactive: true,
    });
    hl.bindTooltip(tooltipHtml(r.plot, entry.polyId), { sticky: true, direction: "top" });
    hl.addTo(highlightLayers);
    bounds.push(...entry.layer.getLatLngs()[0]);
  }

  document.getElementById("ident-summary").textContent =
    `${rows.length} plots in records, ${linked} linked to map polygons.`;
  document.getElementById("link-status").textContent = `linked ${linked} / ${rows.length}`;

  if (bounds.length) {
    map.flyToBounds(L.latLngBounds(bounds).pad(0.3), { duration: 0.6 });
  }
}

sel.addEventListener("change", () => setIdentifier(sel.value));

// Base-map toggle — switch between user's PDF map and Bhu-Naksha official.
// Polygon overlays only make sense on the PDF (their coords are in PDF pixels);
// on Bhu-Naksha we hide them and surface a note.
const basemapSel = document.getElementById("basemap");
const basemapNote = document.getElementById("basemap-note");
async function setBaseMap(mode) {
  if (mode === "bhunaksha") {
    const bhu = await ensureBhuOverlay();
    if (!bhu) {
      basemapNote.textContent = "Bhu-Naksha map data not available (assets/bhunaksha_meta.json missing).";
      basemapSel.value = "pdf";
      return;
    }
    map.removeLayer(pdfOverlay);
    allLayers.remove();
    highlightLayers.remove();
    bhu.addTo(map);
    const bw = bhuMeta.image.width, bh = bhuMeta.image.height;
    const bhuBounds = [[0, 0], [bh, bw]];
    map.setMaxBounds([[-bh * 0.2, -bw * 0.2], [bh * 1.2, bw * 1.2]]);
    map.fitBounds(bhuBounds);
    basemapNote.innerHTML =
      `Official Bhu-Naksha cadastral map — Source: <a href="https://bhunaksha.bihar.gov.in" target="_blank">bhunaksha.bihar.gov.in</a>.<br>` +
      `District: ${bhuMeta.location.district} · Circle: ${bhuMeta.location.circle} · Mauza: ${bhuMeta.location.mauza}.<br>` +
      `<em>Owner highlights are only on the PDF map (Phase 2 will align them).</em>`;
  } else {
    if (bhuOverlay) map.removeLayer(bhuOverlay);
    pdfOverlay.addTo(map);
    allLayers.addTo(map);
    highlightLayers.addTo(map);
    map.setMaxBounds([[-imgH * 0.2, -imgW * 0.2], [imgH * 1.2, imgW * 1.2]]);
    map.fitBounds(pdfBounds);
    basemapNote.textContent = "PDF map mein owner highlights visible hain. Bhu-Naksha switch karne pe official cadastral map dikhega bina overlays ke.";
  }
}
basemapSel.addEventListener("change", () => setBaseMap(basemapSel.value));

// Auto-pick All if any data is linked, else first real identifier with data, else (none).
const totalLinked = Object.keys(polygonToPlot).length;
if (totalLinked > 0) {
  sel.value = ALL_IDENT;
  setIdentifier(ALL_IDENT);
} else {
  setIdentifier("(none)");
  document.getElementById("ident-summary").textContent =
    "No plots labeled yet — open the Labeler tab to link plot numbers to map polygons.";
}
