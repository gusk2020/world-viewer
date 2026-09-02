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
Rendered via a `color-relief` layer only (elevation→color ramp, MapLibre
v6; note this layer type is expected to be renamed `dem` in a future
MapLibre version). The elevation→color stops live in `js/elevationColor.js`
(`ELEVATION_STOPS`), shared between this GL expression
(`toColorReliefExpression()`) and the polar maps' canvas-based recoloring
(see below) — check that file if colors stop working after a library
upgrade. **Deliberately no
`hillshade` layer**: an earlier version added one, but hillshade computed
from Web-Mercator-tiled raster-dem data breaks down at the poles (tiles
become degenerate slivers there), producing a visible radial streak
artifact around the Arctic/Antarctic — confirmed by the user on their
phone. Hillshade's default `illumination-anchor` is also viewport-relative,
so the same real terrain visibly re-shades as you rotate/tilt the globe,
which read as "two different renderings of the same place" to the user.

Removing hillshade turned out not to be enough on its own — the user
confirmed the radial streak (fainter but present) and the
rotation/zoom-dependent look **also happen on `color-relief` alone**. This
means the degeneracy is in the raster-dem *source data/texture mapping*
itself this close to the poles (MapLibre's globe renderer drapes Web
Mercator raster tiles onto the sphere, and a Mercator tile's row right at
90°/-90° is an infinitely-thin sliver in real-world terms). A follow-up
attempt added `terrain-pole-mask`, a solid-fill patch over the pole to
hide it — the user found the patch itself looked worse than the artifact
it was covering, so **it was removed**. Current state: the pole-area
render artifact is a known, accepted limitation of Web-Mercator-tiled DEM
data draped on a 3D globe (see the explanation given to the user for the
plain-language version) and is left as-is. Don't re-add a masking patch
without checking with the user first — they explicitly didn't want that
trade-off. If this needs a real fix later, it likely means either a
polar-specific projection/dataset for high latitudes, or waiting on
MapLibre's own globe-rendering code to handle the pole singularity better
— both bigger than this feature currently warrants.
Glacier extent (`worlds/<world-id>/glaciers.json`) is a separate toggle-able
fill layer on top — currently just placeholder polar-cap boxes, not real
ice-extent data. Turning it off reveals the terrain layer underneath it
(it doesn't remove terrain, just hides the glacier fill layer).

Layer stacking (bottom→top) inside the base style, using `beforeId:
"countries-boundary"` for every custom layer so they sit above the base
style's `countries-fill` but below its boundary/label layers:
`terrain-color-relief` → `glacier-fill` → `territories-fill` →
`territories-outline`, then city circle/label layers added last (topmost,
no `beforeId`). Only one of {terrain group, history group} is visible at a
time — controlled by `state.mode` in `js/app.js`.

### Tap-and-hold to center + flatten — tried, then removed

v0.2 first shipped a custom long-press detector (Pointer Events on the map
canvas, since MapLibre's `contextmenu` event doesn't fire reliably on a
mobile long-press — confirmed via their GitHub issues) that flattened to
2D **centered on the tapped point**. The user tested it and clarified what
they'd actually pictured: tapping a point (e.g. the North Pole) should
redraw the 2D map with *that point placed at the pole/center of a
differently-oriented projection*, not just re-center a standard Mercator
view there — a bigger change to how the flat map is drawn, not just its
center. They said this feature isn't a priority, so it was removed rather
than rebuilt: 2D/3D switching is back to being solely the built-in
`GlobeControl` button (next to the zoom buttons), which keeps the current
view center when it toggles projection. Don't reintroduce a custom
tap-to-flatten gesture unless asked again, and if so, clarify up front
whether "centered on the point" means simple re-centering or a
reprojection around that point.

### Dedicated polar maps (v0.3) — why a second map engine

The user's actual goal for this whole app is a **sea-level-rise / ice-sheet
simulator**, and the poles are the single most important place to get
right — so the pole rendering artifact above wasn't an acceptable
permanent limitation for this project, even though it's a real MapLibre
limitation. Researched alternatives (see chat history for the fuller
comparison): CesiumJS fixes the globe-drape problem in general (real
ellipsoid terrain) but has *no native polar-stereographic support either*
and would mean rebuilding everything (history layers, city labels, era
slider) in a different API — worst effort/benefit ratio for this
specific problem. **OpenLayers** was chosen instead: it natively supports
arbitrary projections via proj4, and — critically — can reproject an
ordinary Web Mercator XYZ tile source into a different view projection on
the fly. A polar-stereographic projection has no singularity at its own
pole (that's the whole point of the projection), so this sidesteps the
MapLibre bug entirely rather than working around it. This is also the
same technique real polar science tools use (NASA GIBS, NSIDC/PolarView),
which use OpenLayers for exactly this reason.

**Four view modes now**, chosen explicitly by the user (not to be
collapsed back to fewer without asking): a row of 4 buttons in
`#view-mode-row` (`js/app.js`, `state.viewMode`):
1. `globe` — the original rotatable 3D MapLibre globe (world overview).
2. `flat` — the original flat MapLibre mercator view.
3. `arctic` — dedicated OpenLayers map, view projection `EPSG:3413`
   (NSIDC Sea Ice Polar Stereographic North).
4. `antarctic` — dedicated OpenLayers map, view projection `EPSG:3031`
   (Antarctic Polar Stereographic).

`globe`/`flat` share one `MapLibreMap` instance (`#map`, projection is
just toggled) exactly as in v0.1/v0.2. `arctic`/`antarctic` are separate
`ol.Map` instances (`#map-arctic` / `#map-antarctic`, one per pole,
**lazily created** on first switch to that mode — see
`ensurePolarMap()` in `js/app.js`) since they're a different rendering
engine entirely. Only the container for the active mode is un-`hidden`;
`renderViewMode()` in `js/app.js` is the single place that knows how to
show/hide containers, flip the MapLibre projection, and show/hide the
right control panels for whichever mode is active. `state.dataMode`
(history vs. terrain) only applies within `globe`/`flat` — the polar maps
have no historical-border content (our placeholder territories/cities
are all fictional mid-latitude rectangles nowhere near the poles), so
they're terrain+glacier only; the `#mode-toggle` button and
`#history-panel` are hidden whenever `viewMode` is `arctic`/`antarctic`.

**Libraries** (`index.html`, plain `<script>` tags, not ES modules —
OpenLayers' `dist/ol.js` and proj4's `dist/proj4.js` are both classic
global-namespace UMD/IIFE bundles, so no import-map gymnastics like
MapLibre v6 needed): `ol@10.10.0` + `proj4@2.22.0` from jsdelivr. Loaded
before `js/app.js` so `window.ol`/`window.proj4` exist by the time
`js/polarMap.js` uses them (`ensureProjectionsRegistered()` calls
`proj4.defs(...)` for both EPSG codes, then `ol.proj.proj4.register(proj4)`
once).

**How the polar terrain layer actually works**
(`js/polarMap.js`): the same AWS Terrarium DEM tiles used by the MapLibre
engine are loaded via `ol.source.XYZ` with `projection: 'EPSG:3857'`
(their real, native projection) — OpenLayers then reprojects that layer
into the view's EPSG:3413/3031 automatically, and because this is a
standard 2D image reprojection (not a sphere-draping operation), it does
not hit the pole-singularity bug. But we need *colored elevation*, not
raw grayscale-ish Terrarium PNGs, and there's no `color-relief`-equivalent
paint property in OpenLayers for this — so `tileLoadFunction` is
overridden to: fetch the raw tile image, draw it to an offscreen canvas,
decode each pixel's Terrarium-encoded elevation
(`decodeTerrariumElevation()` in `js/elevationColor.js`), recolor it via
the *same* `ELEVATION_STOPS` ramp the MapLibre engine uses
(`elevationToRGB()`), and hand the recolored canvas back as the tile
image (via `canvas.toDataURL()`). This requires `crossOrigin: 'anonymous'`
on both the source and the loader `Image`, which requires the AWS bucket
to actually send CORS headers — untested from this sandbox (the whole
host is network-blocked here), but very likely fine since this bucket is
specifically published as an open dataset for exactly this kind of
client-side/browser DEM decoding. **If polar terrain tiles come back
blank/gray/broken on the phone, check the browser console for a CORS
error first** — that's the one part of this design that couldn't be
verified before shipping.

Glacier layer on the polar maps: same `worlds/<world-id>/glaciers.json`
placeholder data, read via `ol.format.GeoJSON` with
`dataProjection: 'EPSG:4326'` / `featureProjection: <the pole's EPSG
code>`, rendered as an `ol.layer.Vector`. The `#glacier-toggle` button
routes to whichever engine(s) are relevant via `applyVisibility()`.

**Deliberately not built in v0.3** (kept in scope, ask before adding):
political border/territory overlay on the polar maps (no placeholder data
exists there anyway); 3D tilt/perspective on the polar maps (they're flat
2D by design — that's what fixes the pole rendering); performance tuning
of the per-tile canvas recolor (works, but a `DataTile`+`WebGLTile`-based
version would be faster if this turns out too slow on the phone with many
tiles in view).

**Rollback point**: commit `d2b35aa` ("Remove polar cap mask; user prefers
the artifact to the patch") is the last state before this OpenLayers/polar
redesign began — a known-good, user-approved v0.2. If the v0.3 polar work
needs to be undone, revert/reset to that commit rather than trying to
manually un-build pieces of it. (A `v0.2-stable` git tag was attempted for
this but this session's push token doesn't have permission to push tags —
only the branch — so the commit hash is the actual rollback anchor;
GitHub's own commit history keeps `d2b35aa` reachable indefinitely as long
as the branch isn't force-pushed over it.)

## Version 0.1 scope (done)

1. Globe/world map displays.
2. Touch rotate/pan/pinch-zoom works (MapLibre default handlers).
3. 2D/3D switch via GlobeControl button.
4. Mobile-usable layout: fullscreen map, `100dvh`, safe-area insets for
   controls, enlarged control tap targets, no page scroll/bounce.

## Version 0.2 scope (done, then adjusted per phone feedback)

1. ~~Tap-and-hold a point on the 3D globe → recenters and flattens to 2D
   there.~~ Built, tested by the user, then removed — see "Tap-and-hold to
   center + flatten — tried, then removed" above. 2D/3D switching is just
   the `GlobeControl` button again.
2. Year slider (12th century → present, 20-year steps) redraws
   territory/border polygons per era, snapping to the nearest keyframe
   with real data.
3. Top-3 city labels (capital/secondary/third) per era/faction, with a
   show/hide toggle.
4. A second base-layer mode: real-world terrain + bathymetry (elevation
   color ramp only — see the hillshade note above for why hillshade was
   removed), with an independent glacier-layer toggle.

Still out of scope (per user instructions / not yet asked for): sea level
slider/flooding simulation, any second world, real (non-placeholder)
border/city/glacier data.

## Version 0.3 scope (done, pending on-phone confirmation)

The stated purpose of this whole app is a sea-level-rise / ice-sheet
simulator, and the user flagged the pole rendering artifact from v0.2 as
a priority-one blocker rather than a cosmetic nit — see "Dedicated polar
maps (v0.3)" above for the full design rationale and rollback point.

1. Two new dedicated flat polar-stereographic maps (Arctic `EPSG:3413`,
   Antarctic `EPSG:3031`), built with OpenLayers, showing real colorized
   elevation/bathymetry with no pole singularity artifact.
2. A 4-way view-mode switch (3D globe / flat 2D / Arctic / Antarctic)
   replacing the old implicit globe↔flat-only toggle.
3. Glacier toggle now works across all four modes (routes to whichever
   engine is active).

Not yet verified on a real device: whether the AWS Terrarium bucket's CORS
headers actually allow the client-side canvas pixel decode this needs (see
the CORS note above) — this is the one part of v0.3 that could still fail
in a way the sandbox couldn't catch.

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
(`getLayer`/`getSource`). Re-run this whole check before shipping further
map-logic changes. Note the limits of this approach, though: the pole
hillshade artifact and the viewport-relative shading that got reported
after shipping were both real-world-data rendering issues that only show
up with actual AWS terrain tiles loaded — the sandbox's local placeholder
DEM tiles can't surface that class of bug, so changes to terrain
rendering specifically still need the user's on-phone confirmation.

For v0.3 (the OpenLayers polar maps), `ol` and `proj4` were installed from
npm into the same scratch copy and vendored locally the same way as
`maplibre-gl`, and the CDN `<script>` tags swapped to local paths for the
test. Verified via Playwright: `window.__polarMaps.{arctic,antarctic}.map
.getView().getProjection().getCode()` returns exactly `EPSG:3413` /
`EPSG:3031` after switching to those modes (confirms the projections were
registered and applied correctly); all 4 view-mode buttons show/hide the
right container and control panels; the glacier toggle flips the correct
OpenLayers layer's `getVisible()` when a polar mode is active; no
`pageerror`s across the whole sequence. Also unit-tested
`js/elevationColor.js`'s `decodeTerrariumElevation`/`elevationToRGB`
directly in plain Node (no browser needed) against known encode/decode
values. What this *couldn't* verify (network-blocked in this sandbox, same
as always): whether real AWS Terrarium tiles actually load into the
colorized polar layer without a CORS error, and what the recolored
elevation/bathymetry actually looks like at the poles — needs the user's
phone.

## Working conventions

- Develop on branch `claude/map-app-v0-1-az6aoa` (already the checked-out
  branch); push there. Don't open a PR unless asked.
- No build step, no `node_modules` committed — keep it deployable as
  plain static files.
- Give the user Settings/Pages-button-level instructions, never git/CLI
  instructions — they cannot run commands.
