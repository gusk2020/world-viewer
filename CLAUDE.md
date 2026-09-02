# world-viewer — project notes for future sessions

## What this is

A phone-first web map viewer for fictional worlds. The user (gusk2020) is a
non-programmer on an Android phone (Pixel 7a) only — no PC, no terminal.
Do all coding, testing, and GitHub file management yourself. Keep
explanations to the user short, jargon-free, and phrased as easy A/B
preference questions when input is needed.

Ultimate goal: one shared map app, swappable per-world data (start: 過速世界
only; later: 碧き海狼, 罅間). Do not build support for worlds beyond
過速世界 until asked — avoid speculative generalization.

## Stack decisions

- **MapLibre GL JS v6** (ESM only as of v6 — no UMD/global build). Loaded
  directly via `<script type="module">` + CDN import, no bundler/build step,
  so the user never needs to run anything locally.
  - CDN: `https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs`
    (and matching `.css`). `@6` (major-only) lets jsdelivr resolve the latest
    v6.x automatically.
  - **Important gotcha**: v6's `.mjs` has **no default export**. Import
    named exports, e.g. `import { MapLibreMap, NavigationControl,
    GlobeControl } from ...`. (`MapLibreMap` is the library's own alias for
    `Map`, used here to avoid shadowing the JS built-in `Map`.)
  - Globe/2D switch uses the library's built-in `GlobeControl` (a single
    button, official MapLibre UI) rather than a custom toggle — less code,
    already touch-friendly.
  - Touch rotate/pan/zoom is MapLibre's default handler behavior; nothing
    custom was needed for that.
- **Base map data**: `https://demotiles.maplibre.org/style.json`, MapLibre's
  own public demo vector style (real-world country borders/coastlines, no
  API key, no usage limits). This is a **placeholder basemap**, standing in
  for 過速世界's real terrain/border data until that's built. Swapping it
  is a one-line change (see below).
- **Hosting**: GitHub Pages serving straight from this repo's branch (no
  build/CI step — it's plain static HTML/CSS/JS). See README.md for the
  exact Settings→Pages steps already given to the user.

## World-data structure (the "common app, swappable data" seam)

`worlds/<world-id>/config.json` holds:
`styleUrl`, `center`, `zoom`, `minZoom`, `maxZoom`, `defaultProjection`,
`history` (`indexUrl` + `eraUrlTemplate`, see below), `glaciersUrl`,
`terrain` (raster-dem tile source: `tiles`, `encoding`, `tileSize`,
`maxzoom`, `attribution`).
`js/app.js` fetches one hardcoded world config
(`worlds/kasoku-sekai/config.json`) and initializes the map from it — it
does not know anything world-specific beyond that path. When a second world
is added later, the natural next step is a small world-picker that changes
which config path is fetched; do not build that picker now.

Do not add fields to config.json speculatively until the feature that uses
them is actually being implemented.

### Historical eras (borders/territories/cities over time)

`worlds/<world-id>/eras/index.json` — `{startYear, presentYear, stepYears,
keyframes: [year, ...]}`. The year slider covers `startYear..presentYear`
in `stepYears` steps, but only `keyframes` years have real data files
(`eras/<year>.json`, each `{year, territories: FeatureCollection,
cities: FeatureCollection}`). This mirrors how real historical borders
work — they don't change every 20 years — so the slider can offer fine
granularity without needing a data file per step. `nearestKeyframe()` in
`js/historyLayers.js` picks the latest keyframe ≤ the slider's year; the UI
shows a "(データ: N年時点)" note whenever the slider year isn't itself a
keyframe, so it's honest with the user about what's actually being shown.
Cities carry a `rank` of `capital` / `secondary` / `third` (their name,
faction, color, and lng/lat) — this is the "首都・副首都・第3都市 top 3"
requirement.

The 6 keyframes currently in the repo (1100/1300/1500/1700/1900/2020,
three fictional 勢力A/B/C rectangles) are **placeholder dummy data only**
— the user has no real 過速世界 border/city history yet. Swap in real
GeoJSON per keyframe later; the loading/slider/rendering code does not
need to change.

### Terrain / bathymetry + glacier layer

Base elevation data: AWS Open Data's public, keyless Terrarium-encoded
DEM tiles (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`,
`encoding: "terrarium"` on a `raster-dem` source) — this is real-world
elevation *and* ocean-floor bathymetry (negative values), which is exactly
what "水中/海底図も含めて" asked for, and it's the same DEM source the
future sea-level slider will need, so this groundwork carries forward.
Rendered via a `color-relief` layer (elevation→color ramp, MapLibre v6;
note this layer type is expected to be renamed `dem` in a future MapLibre
version — check `js/terrainLayers.js`'s `ELEVATION_COLOR_RAMP` if colors
stop working after a library upgrade) plus a `hillshade` layer for shading.
Glacier extent (`worlds/<world-id>/glaciers.json`) is a separate toggle-able
fill layer on top — currently just placeholder polar-cap boxes, not real
ice-extent data. Turning it off reveals the terrain layer underneath it
(it doesn't remove terrain, just hides the glacier fill layer).

Layer stacking (bottom→top) inside the base style, using `beforeId:
"countries-boundary"` for every custom layer so they sit above the base
style's `countries-fill` but below its boundary/label layers:
`terrain-color-relief` → `terrain-hillshade` → `glacier-fill` →
`territories-fill` → `territories-outline`, then city circle/label layers
added last (topmost, no `beforeId`). Only one of {terrain group, history
group} is visible at a time — controlled by `state.mode` in `js/app.js`.

### Tap-and-hold to center + flatten

"3Dの指定した点を中心に2Dマップにしたい": implemented as a manual
long-press detector on the map canvas using Pointer Events (`js/app.js`,
`setupLongPressToFlatten`) — NOT MapLibre's `contextmenu` map event, which
does not reliably fire on a mobile long-press (regressed in mapbox-gl/
maplibre-gl years ago, confirmed via their GitHub issues). The custom
detector: 500ms hold, cancels itself if the pointer moves >10px (a pan) or
a second pointer arrives (start of a pinch/rotate). On a successful long
press it drops a brief white marker, `flyTo`s to that point, and calls
`setProjection({type: 'mercator'})`.

## Version 0.1 scope (done)

1. Globe/world map displays.
2. Touch rotate/pan/pinch-zoom works (MapLibre default handlers).
3. 2D/3D switch via GlobeControl button.
4. Mobile-usable layout: fullscreen map, `100dvh`, safe-area insets for
   controls, enlarged control tap targets, no page scroll/bounce.

## Version 0.2 scope (done)

1. Tap-and-hold a point on the 3D globe → recenters and flattens to 2D
   there.
2. Year slider (12th century → present, 20-year steps) redraws
   territory/border polygons per era, snapping to the nearest keyframe
   with real data.
3. Top-3 city labels (capital/secondary/third) per era/faction, with a
   show/hide toggle.
4. A second base-layer mode: real-world terrain + bathymetry (elevation
   color ramp + hillshade), with an independent glacier-layer toggle.

Still out of scope (per user instructions / not yet asked for): sea level
slider/flooding simulation, any second world, real (non-placeholder)
border/city/glacier data.

## How this was tested (no browser on the dev side either)

Real basemap/library CDN hosts (jsdelivr, demotiles.maplibre.org) are
blocked by this environment's own egress policy — that's a sandbox
restriction, not a real-world problem; the user's phone has normal
internet. To verify the code anyway: installed `maplibre-gl` from npm
(registry.npmjs.org is allowed) into a scratch copy, substituted a local
stand-in style.json, served it over a local static server, and drove it
with Playwright/Chromium (software WebGL via swiftshader) — confirmed the
canvas renders, both MapLibre controls attach, the loading overlay hides on
`load`, and clicking the GlobeControl button visibly switches globe↔flat
projection (screenshots compared). That's how the ESM-no-default-export
gotcha above was actually caught before it could reach the user's phone.
If you change the map init code again, re-verify the same way before
telling the user it's ready — don't rely on reading the code alone.

For v0.2, the same scratch-copy-plus-Playwright approach was extended: a
local `style.json` stand-in was given every layer id the code references
via `beforeId` (`countries-boundary` etc.), so `addLayer` doesn't throw;
AWS terrain tiles and demotiles glyphs still 404 in-sandbox (harmless —
MapLibre falls back gracefully, and both work fine from the user's real
phone). Verified: slider year label + "(データ: N年時点)" note logic at
both a keyframe year and a non-keyframe year; mode toggle swaps panels and
layer visibility; city/glacier toggle buttons flip `aria-pressed` and
label text; every added layer/source id exists on the live `Map` instance
(`getLayer`/`getSource`); simulated pointer-down-hold-up on the canvas
triggers the long-press flatten (confirmed by the globe rendering flat
afterward). Re-run this whole check before shipping further map-logic
changes.

## Working conventions

- Develop on branch `claude/map-app-v0-1-az6aoa` (already the checked-out
  branch); push there. Don't open a PR unless asked.
- No build step, no `node_modules` committed — keep it deployable as
  plain static files.
- Give the user Settings/Pages-button-level instructions, never git/CLI
  instructions — they cannot run commands.
