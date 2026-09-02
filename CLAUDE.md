# world-viewer — project notes for future sessions

## What this is

A phone-first web map viewer for fictional worlds. The user (gusk2020) is a
non-programmer on an Android phone (Pixel 7a) only — no PC, no terminal.
Do all coding, testing, and GitHub file management yourself. Keep
explanations to the user short, jargon-free, and phrased as easy A/B
preference questions when input is needed.

Ultimate goal: one shared map app, swappable per-world data (start: 過速世界
only; later: 碧き海狼, 罅間). Do not build support for worlds beyond
過速世界 until asked — avoid speculative generalization. The real purpose
of the whole app is a **sea-level-rise / ice-sheet simulator** (coastline
change and glacier/ice-sheet extent under warming), not just a static map —
keep that in mind when a feature choice affects data quality vs. visual
polish; the user has repeatedly prioritized "real, correct data" over
"looks fine, isn't quite right," including accepting large engine/tooling
changes to get there (see the CesiumJS migration below).

## Stack decisions (current: CesiumJS)

**CesiumJS**, not MapLibre GL JS. This is a deliberate engine switch made
after the MapLibre-based version (v0.1–v0.3, see "History" below) could not
render the poles correctly and a same-engine OpenLayers workaround, while
functional, still meant maintaining two separate rendering engines and no
path to real 3D terrain. Cesium is a proper WGS84-ellipsoid 3D globe engine
(not a flat map projection draped onto a sphere), which is exactly the
class of bug that broke MapLibre at the poles — Cesium doesn't have that
failure mode by construction. Requirements this satisfies: Pixel 7a/Chrome
priority, touch rotate/zoom, a 3D/2D switch, shared use across future
worlds, free/open, and no programming work required from the user (one
free service account is *not* currently needed — see below).

- **Library**: `cesium@1.145.0` (Apache 2.0, free). Loaded via plain
  `<script>` tags from jsdelivr (`Build/Cesium/Cesium.js` is a classic
  global-namespace IIFE bundle exposing `window.Cesium` — no ESM import-map
  juggling, unlike MapLibre v6). **Gotcha**: set `window.CESIUM_BASE_URL`
  to the same CDN base path *before* loading `Cesium.js` — Cesium fetches
  additional runtime assets (Workers/, Assets/, Widgets/, ThirdParty/) from
  that base URL, and while it can sometimes auto-detect its own script
  origin, explicitly setting it is the documented, reliable approach and
  is what `index.html` does.
- **Terrain (real 3D elevation)**: Cesium's own best terrain
  (`createWorldTerrainAsync`) requires a **Cesium ion** account/token. To
  stay keyless, this app uses Esri's free public elevation service instead,
  via Cesium's first-party `ArcGISTiledElevationTerrainProvider` (jointly
  built by Cesium and Esri specifically for this — not a hack):
  `https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/TopoBathy3D/ImageServer`
  (`config.terrain.url` in `worlds/<world-id>/config.json`). This is
  Esri's "topography + bathymetry" variant (as opposed to the more commonly
  documented land-only `Terrain3D`), chosen because this app needs ocean
  depth too. **The exact `TopoBathy3D` name is inferred by naming-pattern
  analogy with the well-documented `Terrain3D` service, not independently
  confirmed** (couldn't reach the host from this sandbox to check) — if it
  turns out wrong, `config.terrain.fallbackUrl` in the same config points
  at the confirmed-real `Terrain3D` (land elevation only, no bathymetry) as
  a safety net, and `js/app.js`'s `createTerrainProvider()` tries both in
  order before finally falling back to a flat `EllipsoidTerrainProvider` if
  both fail (e.g. genuinely no network) so the app never hangs or crashes
  on terrain load failure.
- **Imagery (the visible picture draped on the terrain mesh)**: NASA
  GIBS's `BlueMarble_ShadedRelief_Bathymetry` layer again — same source
  already proven to work for the polar maps in the MapLibre/OpenLayers era
  — but now via its **geographic (EPSG:4326)** endpoint instead of the
  polar-specific ones, since that's Cesium's native global tiling scheme
  (`Cesium.GeographicTilingScheme`, a 2-column×1-row root tile, unlike Web
  Mercator's 1:1 root tile). URL:
  `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_ShadedRelief_Bathymetry/default/500m/{z}/{y}/{x}.jpeg`
  (`config.imagery.url`), loaded via a plain `Cesium.UrlTemplateImageryProvider`
  with `tilingScheme: new Cesium.GeographicTilingScheme()` — no reprojection
  needed, since GIBS renders this layer natively in EPSG:4326 too (same
  "ask for data already in the right projection instead of coercing it"
  principle as the old polar-maps design).
- **Why NOAA ETOPO 2022 (the user's first suggestion) isn't used directly**:
  real, freely-licensed, and does include full-globe topography+bathymetry
  with an ice-free "Bedrock" variant — but it's distributed only as bulk
  15°×15° GeoTIFF/NetCDF tiles for offline GIS use, not as a ready web tile
  or terrain service. Turning it into one needs GDAL-class processing this
  sandbox doesn't have. The Esri/GIBS combination above achieves the same
  *practical* goal (keyless, global, includes bathymetry, proper polar
  coverage) without that processing step. Revisit ETOPO 2022 directly if a
  future session has real GIS tooling and wants the extra rigor.
- **3D/2D switch**: Cesium's own built-in `sceneModePicker` (a single
  toolbar button, top-right) — enabled via the `sceneModePicker: true`
  Viewer option, no custom code. This also means the whole "4 view modes /
  cycle button / separate polar OpenLayers engine" apparatus from v0.3 is
  **gone** — now that the *one* 3D globe renders poles correctly, there's
  no more need for dedicated flat polar maps as a workaround. Don't
  reintroduce them without checking with the user first; if Cesium's poles
  turn out to have some other issue, that's a reason to fix *this* engine's
  setup, not to resurrect the old workaround.
- **Touch rotate/pan/zoom**: Cesium's default `ScreenSpaceCameraController`
  handles this out of the box on both desktop and touch, nothing custom
  needed (same "library already does this" pattern as MapLibre's default
  handlers before it).
- **Hosting**: unchanged — GitHub Pages serving straight from this repo's
  branch, no build/CI step, plain static HTML/CSS/JS.

## World-data structure (the "common app, swappable data" seam)

`worlds/<world-id>/config.json` holds: `history` (`indexUrl` +
`eraUrlTemplate`), `glaciersUrl`, `terrain` (`url` + `fallbackUrl`,
ArcGIS elevation ImageServer endpoints), `imagery` (`url`, `maximumLevel`,
`credit`). `js/app.js` fetches one hardcoded world config
(`worlds/kasoku-sekai/config.json`) and initializes the viewer from it — it
does not know anything world-specific beyond that path. When a second
world is added later, the natural next step is a small world-picker that
changes which config path is fetched; do not build that picker now.

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
keyframe. Cities carry a `rank` of `capital` / `secondary` / `third` (name,
faction, color, lng/lat) — the "首都・副首都・第3都市 top 3" requirement.

This GeoJSON data is engine-agnostic and survived the Cesium migration
unchanged — only the *rendering* code (`js/historyLayers.js`) was rewritten,
from MapLibre GL-style layers/expressions to Cesium `Entity` objects (one
`Cesium.CustomDataSource` for territory polygons, one for city points +
labels). Territory polygons are added **without** `outline`/`height`:
Cesium auto-drapes an Entity polygon onto the real terrain surface when no
height is given (the desired behavior — mountains/coastlines show through),
but it does **not** support combining that terrain-clamped draping with a
polygon outline (it logs a warning and silently drops the outline) — don't
add outline properties back without first giving territories a different
way to stay visually distinct (e.g. thicker fill contrast) if borders need
to be more visible. City points/labels use
`heightReference: Cesium.HeightReference.CLAMP_TO_GROUND` for the same
terrain-following reason, plus `disableDepthTestDistance: Infinity` so
labels aren't hidden behind terrain from a low camera angle.

The 6 keyframes currently in the repo (1100/1300/1500/1700/1900/2020,
three fictional 勢力A/B/C rectangles) are **placeholder dummy data only**
— the user has no real 過速世界 border/city history yet. Swap in real
GeoJSON per keyframe later; the loading/slider/rendering code does not
need to change.

### Glacier layer

`worlds/<world-id>/glaciers.json` — placeholder polar-cap boxes, not real
ice-extent data — rendered the same way as territories (a
`Cesium.CustomDataSource` of terrain-draped polygon entities, see
`js/glacierLayer.js`), toggled on/off via `dataSource.show`.

**Important limitation, told to the user**: turning the glacier overlay off
does *not* reveal real ice-free ground. It only hides our own placeholder
polygon — the GIBS Blue Marble imagery underneath already has real-world
ice baked into the photo (it's satellite imagery of the actual, currently
-icy Earth), so what's "underneath" is still icy. Genuinely showing
Antarctica without its ice sheet needs real bed-topography data (ice
mathematically subtracted) layered in separately — see the Bedmap3 research
note below. This is the same "not usable as-is, but for tooling reasons
not effort reasons" situation as ETOPO 2022 above.

**Research note for a future ice-free-bed-topography feature**: traced
down a real, no-login-required source — BAS's Bedmap3 gridded product
(bed/surface/ice-thickness, 500m, Antarctic Polar Stereographic),
fetched by the actively-maintained `polartoolkit` Python package from:
`https://ramadda.data.bas.ac.uk/repository/entry/get/bedmap3.nc?entryid=synth%3A2d0e4791-8e20-46a3-80e4-f5f6716025d2%3AL2JlZG1hcDMubmM%3D`
(`bed_topography` is the variable wanted). Not usable as-is: it's a single
NetCDF file, not a tile pyramid (size unknown — `ramadda.data.bas.ac.uk` is
blocked from this sandbox, confirmed via curl → 403), and turning it into
something a phone browser can load means either reading it via HTTP range
requests with an HDF5-in-the-browser reader (`h5wasm`; unproven here, and
whether it's fast enough depends on the file's internal chunking, which is
unknowable without downloading it) or preprocessing it into a proper web
tile pyramid with real GIS tooling (GDAL / Python xarray) this sandbox
doesn't have and can't reach the source file to do anyway. This is also
exactly the numeric elevation data a future sea-level/flooding slider would
need (for ice thickness specifically), so it's likely worth tackling both
together. Don't re-research the URL from scratch next time.

## History: the MapLibre GL JS + OpenLayers era (v0.1–v0.3), superseded

The app was originally built on **MapLibre GL JS v6** with a rotatable 3D
"globe" projection. This worked well in general but had an unfixable
rendering bug right at the poles: MapLibre's globe mode works by draping
ordinary Web-Mercator-tiled raster imagery onto a sphere, and that draping
math is geometrically degenerate at 90°/-90° latitude (a Mercator tile's
row right at the pole is an infinitely-thin sliver in real-world terms).
This showed up as a radial streak/pinwheel artifact around the Arctic and
Antarctic that got *worse*, not better, the closer you looked, and also
changed appearance depending on camera rotation (because the related
`hillshade` layer's default lighting is viewport-relative). Multiple fixes
were attempted and rejected by the user on visual grounds: removing
`hillshade` alone didn't fix it (the plain `color-relief` layer had the
same artifact); a solid-fill mask patched over the pole to hide it looked
worse than the artifact itself and was removed. This is a real, structural
MapLibre limitation, not a mistake in this app's code — the user's own
priority (accurate poles, since the app's whole point is an ice-sheet
simulator) made it unacceptable to just live with, though.

**v0.3** worked around this by adding a *second* rendering engine —
OpenLayers — for two dedicated flat polar-stereographic maps (Arctic
`EPSG:3413`, Antarctic `EPSG:3031`), since a polar-stereographic projection
has no singularity at its own pole. This needed NASA GIBS's
`BlueMarble_ShadedRelief_Bathymetry` layer served *natively* in those
projections (an earlier attempt that reprojected Web-Mercator-sourced AWS
Terrarium DEM tiles into the polar view left a literal black hole at the
pole, because Web Mercator itself can't represent latitude beyond ~85.05°
in the first place — nothing to reproject there). This shipped as a 4-way
view-mode switch (3D globe / flat 2D / Arctic / Antarctic) with a single
cycle button, and the polar maps were confirmed by the user to render
cleanly with no artifacts, even zoomed in.

That confirmed the *data and technique* were sound, but running two
separate map engines (MapLibre for the general globe, OpenLayers for
poles) had real costs: no shared 3D terrain (MapLibre's globe still had
its color-relief-only, non-3D-relief style; the OpenLayers maps were flat
2D by design), duplicated interaction-control code (zoom/rotate/scale
across two different control APIs), and no obvious path to a unified
sea-level slider across the whole globe. When the user asked directly for
the poles to be fixed "properly" rather than worked around, and named
CesiumJS as the candidate, that combination of factors (Cesium fixes the
pole problem *structurally*, once, everywhere, and gives the real 3D
terrain the sea-level feature will eventually need) made the full engine
switch worth it. **See "Stack decisions" above for the current
architecture.** The MapLibre/OpenLayers-specific files
(`js/polarMap.js`, `js/terrainLayers.js`, `js/elevationColor.js`) were
deleted rather than kept around unused; git history has them if ever
needed for reference (see rollback point below).

**Rollback point**: commit `d2b35aa` ("Remove polar cap mask; user prefers
the artifact to the patch") is the last MapLibre-only state (before the
OpenLayers polar-maps detour began), and the commit immediately before
this Cesium migration commit is the last MapLibre+OpenLayers v0.3 state
(fully working, user-confirmed) if the Cesium approach needs to be
abandoned. A `v0.2-stable` git tag was attempted early on but this
session's push token doesn't have tag-push permission — only the branch —
so commit hashes are the real rollback anchors; GitHub's own commit
history keeps them reachable indefinitely as long as the branch isn't
force-pushed over them.

## Version history

**v0.1 (MapLibre, superseded)**: globe/world map displays; touch
rotate/pan/pinch-zoom; 2D/3D switch via `GlobeControl`; mobile-usable
layout.

**v0.2 (MapLibre, superseded)**: year slider with per-era territory/city
data; top-3 city labels with show/hide toggle; a terrain+bathymetry base
layer mode with glacier toggle. (A tap-and-hold-to-flatten gesture was
also built and then removed per user feedback — see git history if this
comes up again; the lesson was to clarify up front whether "centered on a
tapped point" means simple re-centering or a full reprojection around that
point before building it.)

**v0.3 (MapLibre + OpenLayers, superseded)**: dedicated Arctic/Antarctic
polar-stereographic maps (OpenLayers + NASA GIBS) to route around the
MapLibre pole bug; a 4-way view-mode cycle button; rotate/compass/zoom/
scale-bar controls on the polar maps and a scale bar (with show/hide
toggle) everywhere. All superseded by the Cesium migration — see
"History" above.

**Cesium v0.1 (current)**: full engine switch to CesiumJS. Real 3D
terrain (Esri WorldElevation3D/TopoBathy3D) + imagery (NASA GIBS Blue
Marble) across the *whole* globe including poles, via Cesium's native
`sceneModePicker` for 3D/2D switching (no more separate polar maps or
custom view-mode UI). Historical era/territory/city data and the glacier
overlay were ported to Cesium's Entity API and work the same as before
(year slider, city top-3 labels, history/terrain mode toggle, glacier
toggle). **Deliberately not carried forward from v0.3, kept in scope, ask
before re-adding**: a page-level scale bar with a show/hide toggle (Cesium
doesn't have an equivalent built-in widget the way MapLibre/OpenLayers
did; would need a custom one). **Deliberately out of scope for this
round, per explicit user instruction**: sea-level-rise calculation itself
— this version's job was specifically to get clean whole-globe 3D terrain
(poles included) working first.

Still out of scope generally (per user instructions / not yet asked for):
sea level slider/flooding simulation, any second world, real
(non-placeholder) border/city/glacier data.

## How this was tested (no browser on the dev side either)

Real basemap/library/data CDN hosts (jsdelivr, demotiles.maplibre.org,
gibs.earthdata.nasa.gov, elevation3d.arcgis.com, etc.) are blocked by this
environment's own egress policy — a sandbox restriction, not a real-world
problem; the user's phone has normal internet. The consistent workaround
throughout this project: install the library from npm (registry.npmjs.org
is allowed) into a scratch copy, vendor it locally alongside a local
static file server, and drive it with Playwright/Chromium (software WebGL
via swiftshader) to verify the *code* is structurally correct — control
wiring, API usage, layer/entity/source creation, event handlers — while
accepting that real remote data loading and final visual appearance can
only be confirmed on the user's actual phone. Re-run this whole approach
before telling the user a map-logic change is ready; don't rely on reading
the code alone. (Full blow-by-blow history of what was checked at each
MapLibre/OpenLayers version is in git history/old CLAUDE.md revisions if
ever needed — condensed here since that engine is no longer in the repo.)

For the Cesium migration specifically: `cesium@1.145.0` installed from npm
and vendored the same way, `CESIUM_BASE_URL` pointed at the local vendor
path. Verified via Playwright: a bare `new Cesium.Viewer()` with
`EllipsoidTerrainProvider` renders a WebGL canvas + the default UI widgets
correctly under swiftshader (confirms the rendering pipeline itself works
in this constrained environment); `ArcGISTiledElevationTerrainProvider
.fromUrl()` and a `UrlTemplateImageryProvider` with
`GeographicTilingScheme` both construct without synchronous API errors and
correctly attempt real network requests to the intended hosts/URLs (which
then fail with connection errors from the sandbox's own network block,
not from any coding mistake — confirmed by the request URLs matching
exactly what was intended, including GIBS's `{z}/{y}/{x}` level-0 root
tiles at X:0/1,Y:0 matching the expected 2-column geographic root tile).
The full app was verified end-to-end: it doesn't hang or crash when both
the primary and fallback terrain URLs fail (falls through to
`EllipsoidTerrainProvider` and still hides the loading overlay); moving
the year slider produces the expected entity counts on the Cesium
`CustomDataSource`s (3 territories, 9 cities, 2 glacier polygons for the
placeholder data); the history/terrain mode toggle and glacier toggle
correctly flip `dataSource.show`. What this *couldn't* verify (network
blocked in this sandbox, same as always): whether `TopoBathy3D` is really
the correct Esri service name (vs. needing the `fallbackUrl`), and what
the real terrain+imagery actually looks like at the poles on-device —
needs the user's phone.

## Working conventions

- Develop on branch `claude/map-app-v0-1-az6aoa` (already the checked-out
  branch); push there. Don't open a PR unless asked.
- No build step, no `node_modules` committed — keep it deployable as
  plain static files.
- Give the user Settings/Pages-button-level instructions, never git/CLI
  instructions — they cannot run commands.
