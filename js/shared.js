// Shared helpers used by both labeler and viewer.

export const COLORS = { A: "#ff5252", B: "#4cc9f0", C: "#ffd166", D: "#06d6a0" };

export async function loadJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
  return r.json();
}

// Try fetching a saved mapping. Falls back to localStorage so deploys without
// a committed mapping.json still see the user's in-progress labels.
// The mapping schema has been extended to also carry user-drawn polygons:
//   { polygon_to_plot: { ... }, user_polygons: [ {id, points, centroid}, ... ] }
// Old mappings without `user_polygons` still load fine (defaults to []).
export async function loadMapping() {
  let fromFile = { polygon_to_plot: {}, user_polygons: [] };
  try {
    const f = await loadJSON("assets/mapping.json");
    fromFile = {
      polygon_to_plot: f.polygon_to_plot || {},
      user_polygons: Array.isArray(f.user_polygons) ? f.user_polygons : [],
    };
  } catch (_) {}
  // localStorage overrides for in-progress work
  const localMap = localStorage.getItem("polygon_to_plot");
  if (localMap) {
    try {
      const parsed = JSON.parse(localMap);
      fromFile.polygon_to_plot = { ...fromFile.polygon_to_plot, ...parsed };
    } catch (_) {}
  }
  const localUserPolys = localStorage.getItem("user_polygons");
  if (localUserPolys) {
    try {
      const parsed = JSON.parse(localUserPolys);
      if (Array.isArray(parsed) && parsed.length) {
        // Merge by id: localStorage version wins for duplicate IDs.
        const byId = new Map(fromFile.user_polygons.map(p => [p.id, p]));
        for (const p of parsed) byId.set(p.id, p);
        fromFile.user_polygons = Array.from(byId.values());
      }
    } catch (_) {}
  }
  return fromFile;
}

export function saveMappingLocal(mapping) {
  localStorage.setItem("polygon_to_plot", JSON.stringify(mapping));
}

export function saveUserPolygonsLocal(userPolys) {
  localStorage.setItem("user_polygons", JSON.stringify(userPolys));
}

// Compute centroid from a list of [x, y] points (simple mean).
export function centroidOf(points) {
  if (!points.length) return [0, 0];
  let sx = 0, sy = 0;
  for (const [x, y] of points) { sx += x; sy += y; }
  return [Math.round(sx / points.length), Math.round(sy / points.length)];
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Initialise a Leaflet map that treats the image as its own coordinate system.
export function initImageMap(elId, imgW, imgH, imgUrl) {
  const map = L.map(elId, {
    crs: L.CRS.Simple,
    minZoom: -4,
    maxZoom: 3,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 80,
    attributionControl: false,
    preferCanvas: true,
    tap: true,
    zoomControl: false,   // move zoom controls out of the way of the sidebar toggle
  });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  const bounds = [[0, 0], [imgH, imgW]];
  L.imageOverlay(imgUrl, bounds).addTo(map);
  map.fitBounds(bounds);
  map.setMaxBounds([[-imgH * 0.2, -imgW * 0.2], [imgH * 1.2, imgW * 1.2]]);

  // Wire up the sidebar collapse toggle, if present on the page.
  setupSidebarToggle(map, bounds);

  return { map, bounds };
}

function setupSidebarToggle(map, bounds) {
  const app = document.querySelector(".app");
  const btn = document.getElementById("sidebar-toggle");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!app || !btn) return;

  const isNarrow = () => window.matchMedia("(max-width: 768px)").matches;

  // On narrow screens default to collapsed so the map gets full width on load.
  if (isNarrow()) app.classList.add("sidebar-collapsed");
  if (backdrop) backdrop.hidden = !isNarrow();

  function invalidateLater() {
    // Leaflet needs to recalculate its container size after CSS transition.
    setTimeout(() => {
      map.invalidateSize();
      // If now collapsed, keep the current view; if newly opened, refit so the
      // whole map is visible in the smaller area on mobile.
    }, 260);
  }

  function toggle(forceCollapse) {
    const wasCollapsed = app.classList.contains("sidebar-collapsed");
    const shouldCollapse = forceCollapse === undefined ? !wasCollapsed : forceCollapse;
    app.classList.toggle("sidebar-collapsed", shouldCollapse);
    if (backdrop) backdrop.hidden = !isNarrow();
    invalidateLater();
  }

  btn.addEventListener("click", () => toggle());
  if (backdrop) backdrop.addEventListener("click", () => toggle(true));

  // Re-evaluate behaviour on resize (e.g. rotate phone)
  window.addEventListener("resize", () => {
    if (backdrop) backdrop.hidden = !isNarrow();
    map.invalidateSize();
  });

  // Esc closes overlay sidebar on mobile
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isNarrow() && !app.classList.contains("sidebar-collapsed")) {
      toggle(true);
    }
  });
}

// Convert a polygon's [x, y] image coords -> Leaflet [lat, lng] = [imgH - y, x].
export function toLatLngs(points, imgH) {
  return points.map(([x, y]) => [imgH - y, x]);
}

export function buildPlotIndex(plotsData) {
  // plot number -> { identifier, khasra, rakba, sno }
  const byPlot = new Map();
  for (const r of plotsData.rows) byPlot.set(r.plot, r);
  return byPlot;
}
