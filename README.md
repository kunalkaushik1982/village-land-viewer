# Village Land Viewer

Interactive viewer for a village revenue map. Pick an owner from the dropdown
and the map highlights every plot they own. Hover any plot for **Plot No,
Khasra No, Rakba, and Owner Initials**.

## Live demo

Once deployed: `https://<your-user>.github.io/<repo>/`

## Files

| File | Purpose |
|------|---------|
| `index.html` | Viewer — pick identifier, see highlighted plots, hover for details |
| `labeler.html` | Labeling tool — click polygons to assign plot numbers, draw new polygons |
| `js/viewer.js`, `js/labeler.js`, `js/shared.js` | App logic (ES modules) |
| `css/style.css` | Styling |
| `assets/map.jpg` | Web-friendly map image (4000×5654 px) |
| `assets/polygons.json` | Auto-detected plot polygons |
| `assets/plots.json` | Excel data: 95 plots across 4 owners (A/B/C/D) with Initials |
| `assets/mapping.json` | polygon_id → plot_number map + user-drawn polygons |
| `assets/predictions.json` | OCR predictions used as labeler suggestions |
| `.nojekyll` | Tells GitHub Pages to serve files as-is |
| `netlify.toml` | Alt: Netlify cache headers |

## Run locally

```
python -m http.server 8000
# open http://localhost:8000
```

## Deploy on GitHub Pages

1. Repo Settings → Pages
2. Source: `Deploy from a branch`
3. Branch: `main`, folder: `/ (root)`
4. Save — site goes live at `https://<user>.github.io/<repo>/` in ~1 minute.

## Owner initials

| Identifier | Initials |
|------------|----------|
| A | Vi-A |
| B | Ud-B |
| C | RB-C |
| D | Su-D |

## Keyboard shortcuts (labeler)

| Key | Action |
|---|---|
| **Tab** / **Enter** | Save current label + jump to next pending plot |
| **Shift+Tab** | Previous pending plot (no save) |
| **Backspace** on empty input | Unassign current polygon |
| **D** | Start drawing a new polygon (click corners, Enter to finish) |
| **Esc** | Cancel drawing |
