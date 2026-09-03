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
  — no reprojection needed, since GIBS renders this layer natively in
  EPSG:4326 too (same "ask for data already in the right projection instead
  of coercing it" principle as the old polar-maps design).
  **Gotcha found in v0.1 phone testing, fixed**: Cesium's default
  `Cesium.GeographicTilingScheme` assumes a simple doubling tile pyramid
  (2×1, 4×2, 8×4, 16×8, ...), but GIBS's actual EPSG:4326 "500m" matrix set
  uses an **irregular, non-doubling** progression: 2×1, 3×2, 5×3, 10×5,
  20×10, 40×20, 80×40, 160×80. Using the default scheme meant requesting
  tiles at X/Y coordinates GIBS doesn't have at several zoom levels, which
  is what caused the user's reported symptom — a black circle at the north
  pole, the wrong latitude for the south pole, and black gaps covering
  roughly a third of every longitude band. Fixed with a custom
  `js/gibsGeographicTilingScheme.js` (`createGibsGeographicTilingScheme()`
  + `GIBS_GEOGRAPHIC_MAX_LEVEL = 7`), ported from NASA's own official
  reference implementation (`nasa-gibs/gibs-web-examples`,
  `examples/cesium/gibs.js`) rather than derived independently — trust
  that file's tile-width/level table over re-deriving it. Level count is
  8 (0–7) for this "500m" matrix set; NASA's example uses 9 levels for the
  finer "250m" set, so don't copy the level count verbatim if the imagery
  URL is ever changed to a different resolution — re-check against GIBS's
  own capabilities XML for that layer. `createImageryProvider()` in
  `js/app.js` passes this scheme + max level explicitly instead of the
  Cesium default; `config.imagery.maximumLevel` was removed from
  `config.json` since it's now derived from this constant, avoiding two
  copies of the same number drifting apart.
  **Second gotcha, found after the fix above still left a black pole gap**:
  the per-level tile-count fix (above) wasn't the whole story. Using the
  exact same resolution table NASA's example uses, the total angular size
  each level's tiles add up to (`tile count × per-tile angular width`,
  computed straight from that table) only equals the real 360°×180° extent
  from level 3 onward — level 0 overshoots by 60% in both directions,
  level 1 by ~50%/20%, level 2 by an exact 20% in latitude. (Confirmed by
  direct calculation, not guesswork: level 3's 10×5 tiles at its resolution
  reproduce `Cesium.Rectangle.MAX_VALUE` exactly; levels 0-2 don't.)
  Cesium's own tile-selection code (`ImageryLayer._createTileImagerySkeletons`,
  read directly from the vendored `cesium` npm package to confirm this
  rather than guessed) *does* respect an imagery provider's `minimumLevel`
  by flooring the selected level to it — so `createImageryProvider()` now
  also sets `minimumLevel: GIBS_GEOGRAPHIC_MIN_LEVEL` (3, exported next to
  `GIBS_GEOGRAPHIC_MAX_LEVEL` in the same file) to skip the three levels
  whose own geometry doesn't add up. **Separately**, `positionToTileXY` in
  that same ported file had a genuine off-by-one bug carried over from
  NASA's own code: its Y-index bounds check used `y > yTiles` while the
  X-index check just above it correctly used `x >= xTiles` — at exactly
  the true south pole (latitude -90°) this computes `y === yTiles` (an
  out-of-range row index one past the last real row), which `>` never
  catches, so Cesium ends up asking GIBS for a tile row that doesn't
  exist right at the pole. Fixed to `y >= yTiles`, matching the X check.
  Both fixes were verified directly (not just inferred): after fixing,
  `positionToTileXY` for the exact south pole at level 3 returns `y: 4`
  (the real last row) instead of `y: 5`; the level-3 rectangle math
  reproduces the exact global extent with no overshoot. **Still not fully
  certain**: whether this fully eliminates the black pole circle the user
  saw, since this sandbox's network block means every GIBS request fails
  regardless of level, so the *real* server's tile availability at the
  poles (vs. our computed indices) can't be confirmed here — needs the
  user's phone again to know if the circle is gone, smaller, or unchanged.
  **Third round — the pole gap was still there after both fixes above, so
  the user redirected the approach**: rather than keep chasing indexing
  bugs in the WMTS request math, the user asked to treat it as an imagery
  *coverage* problem and stop treating it as a CesiumJS engine problem —
  add a guaranteed full-coverage layer underneath, so the detailed layer's
  gaps (whatever their exact cause) simply reveal real imagery instead of
  black. Implemented as a second Cesium `ImageryLayer`,
  `createBaseImageryProvider()` in `js/app.js`, added to
  `viewer.imageryLayers` *before* (i.e. underneath) the existing detailed
  layer. Critically, this base layer uses **WMS**, not WMTS/tiles
  (`Cesium.WebMapServiceImageryProvider`, GIBS's WMS endpoint
  `config.imagery.wmsBaseUrl` = `.../wms/epsg4326/best/wms.cgi`,
  `config.imagery.wmsLayer` = same `BlueMarble_ShadedRelief_Bathymetry`
  layer). WMS has no fixed tile pyramid to align indices against — Cesium
  asks the server for an arbitrary bounding box (using Cesium's own plain
  `GeographicTilingScheme`, not the GIBS-specific irregular one the
  detailed layer needs), and the server renders exactly that box. This
  sidesteps the whole class of bug the last two rounds were chasing (no
  discrete tile grid means no off-by-one or overshoot is even possible),
  and was confirmed directly: outgoing WMS request bboxes at the poles
  read e.g. `bbox=-180,-90,0,90` — reaching the true `-90`/`90` extremes
  exactly, generated by Cesium's own tiling code, not ours. Cesium's
  `ImageryLayer` stack composites top-to-bottom by transparency — wherever
  the detailed (WMTS) layer's tile fails to load, Cesium simply doesn't
  draw that layer there, so the WMS base layer underneath shows through
  automatically, no visibility/toggle logic needed. Both layers request
  the same real layer, so wherever the base shows through it's the same
  photograph, not a visually-distinct fallback. The detailed layer's
  `minimumLevel`/off-by-one fixes from the second round were left in place
  (still avoid requesting known-bad indices — cheaper than falling back to
  WMS unnecessarily). GIBS's WMS support and endpoint were confirmed from
  NASA's own docs (`nasa-gibs/gibs-api-docs`, `docs/access-basics.md`,
  fetched via `raw.githubusercontent.com` — the only NASA-related host
  reachable from this sandbox; `gibs.earthdata.nasa.gov` itself is
  blocked here same as always). **Not fully confirmed even now**: whether
  GIBS's WMS server actually has real image data at the exact poles for
  this layer (very likely, since Blue Marble is a synthesized whole-globe
  composite basemap with no known deliberate polar gap, but genuinely
  unverifiable from this sandbox) — still needs the user's phone.
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
  Viewer option, no custom code. The user reported it sat too close to the
  literal screen corner to tap reliably on-phone; fixed purely in CSS
  (`.cesium-viewer-toolbar` in `css/style.css` now insets `top`/`right` by
  10px instead of 0). **Second gotcha**: once the compass button (below)
  existed, tapping this picker open a dropdown of 3D/2D/Columbus-view
  options that expands *downward* from the button — which landed right on
  top of the compass button positioned just below it, making neither
  tappable. Fixed by swapping their vertical order in CSS (compass now on
  top at the 10px inset, toolbar below it at a 62px inset) so the
  dropdown opens into empty space instead of over another control. This
  also means the whole "4 view modes /
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
- **Scale bar and compass**: Cesium's `Viewer` widget, unlike
  MapLibre/OpenLayers, has no built-in scale bar or north-reset/compass
  control, so both are hand-built (no third-party plugin) in `js/app.js`:
  - `setupScaleBar()` measures the real-world ground distance between two
    points 100 screen-pixels apart at the center of the viewport via
    `viewer.camera.pickEllipsoid()`, then picks the largest "nice" round
    number (from a fixed step table) that fits an ~80px-wide bar, updating
    on every `viewer.scene.postRender`. Hides itself (`visibility: hidden`)
    when the center of the screen isn't looking at the globe at all (e.g.
    zoomed out past the horizon) since `pickEllipsoid` returns `undefined`
    there.
  - `setupCompass()` rotates a CSS arrow (`#compass-btn .compass-arrow`) to
    `viewer.camera.heading` on every `postRender`, and tapping the button
    calls `viewer.camera.setView({ orientation: { heading: 0, ... } })` to
    reset to north-up without changing position/pitch. Note: Cesium
    sometimes reports the reset heading back as `2π` rather than `0`
    (they're the same angle) — this is expected, not a bug; don't
    "fix" it by comparing heading to exactly `0`.
  - Both are plain fixed-position DOM elements in `index.html`/`style.css`
    (`#scale-bar` top-left, `#compass-btn` top-right below the scene mode
    picker), not Cesium widgets — kept deliberately simple since neither
    needs to interact with Cesium's own widget/tooltip system.

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

**Second gotcha, found on-phone**: city points/labels originally also used
`heightReference: Cesium.HeightReference.CLAMP_TO_GROUND`, matching the
territory polygons above — but this is a *different* Cesium code path for
Entity points/labels than for terrain-draped polygons, and it re-samples
the real terrain height asynchronously in batches rather than continuously
per-frame. The user reported every city label jumping to a slightly
different position all at once whenever they rotated the globe — the
classic symptom of that batched re-clamp landing on a new height for
every entity in the same frame. Since `disableDepthTestDistance: Infinity`
already forces these to render on top regardless of the terrain beneath
them, the true clamped height barely mattered visually anyway, so
`heightReference` was simply removed from both the point and the label in
`historyLayers.js` — `Cesium.Cartesian3.fromDegrees(lng, lat)` now places
them at plain sea-level height, which needs no runtime re-clamping and so
can't drift. Territory polygons keep their terrain-draped `heightReference`-
free behavior unchanged (that's the different, unaffected code path — the
user confirmed territories look fine on the 3D globe).

**Gotcha found in v0.1 phone testing, fixed**: Cesium Entity polygons draw
a straight geodesic line between each pair of consecutive ring vertices,
with no automatic subdivision. The placeholder territory boxes (tens of
degrees wide) showed visibly bowed/curved edges instead of straight ones —
most noticeable in 2D mode, where the user reported territories "looked
like they were drawn on a curved surface" — and this also made positions
look like they didn't line up with the map underneath, since a
5-point-per-box polygon's true shape diverges further from the intended
rectangle the larger it is. Fixed with `densifyRing()` in the new
`js/geoUtils.js`: inserts intermediate points along every ring edge at a
max 5° step before handing the ring to `Cesium.Cartesian3.fromDegreesArray()`.
Applied in `historyLayers.js`'s `applyEraData()` for territories. If a
future territory shape is very large or crosses a pole, re-check that 5°
is still fine enough — this was tuned against the current small
placeholder boxes, not derived from a hard requirement.

The 6 keyframes currently in the repo (1100/1300/1500/1700/1900/2020,
three fictional 勢力A/B/C rectangles) are **placeholder dummy data only**
— the user has no real 過速世界 border/city history yet. Swap in real
GeoJSON per keyframe later; the loading/slider/rendering code does not
need to change.

### Glacier layer

`worlds/<world-id>/glaciers.json` — placeholder polar-cap boxes, not real
ice-extent data — rendered the same way as territories (a
`Cesium.CustomDataSource` of terrain-draped polygon entities, see
`js/glacierLayer.js`), toggled on/off via `dataSource.show`. Same
`densifyRing()` treatment as territories (see above) is applied here too —
the placeholder glacier boxes span the *full* 360° of longitude at each
pole, which made the un-densified polygons render as near-invisible
degenerate slivers rather than caps (this, not the toggle logic, was the
actual cause of the user's "glacier button doesn't work" report — the
toggle itself was already correct; there was just nothing visible to
toggle).

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
toggle). **Deliberately out of scope for this round, per explicit user
instruction**: sea-level-rise calculation itself — this version's job was
specifically to get clean whole-globe 3D terrain (poles included) working
first.

**Cesium v0.1, first-round bug-fix pass**: after the user tested Cesium
v0.1 on-phone, they reported 5 issues; all fixed in this pass (see the
relevant sections above for each): (1) globe rotate/zoom confirmed working
as-is, no change needed; (2) `sceneModePicker` button moved inward from
the literal screen corner; (3) whole-globe imagery coverage gap (black
circle at the north pole, wrong south-pole position, ~1/3 of every
longitude band missing) — root cause was Cesium's default
`GeographicTilingScheme` not matching GIBS's actual irregular tile
pyramid, fixed with `js/gibsGeographicTilingScheme.js`; (4) territory/
glacier polygons showing visible curvature and the glacier toggle
appearing not to work — root cause was un-subdivided geodesic polygon
edges (glaciers being full-360°-longitude made this worst), fixed with
`densifyRing()` in `js/geoUtils.js`; the "territory position doesn't
match the map" report was very likely a consequence of the same imagery
gap + curvature (the affected areas made correct positioning hard to
judge), not a separate coordinate bug — `Cartesian3.fromDegreesArray()`
usage with GeoJSON `[lng, lat]` pairs was structurally correct on
inspection and no separate fix was needed; (5) a custom scale bar and
compass/north-reset button were added (Cesium has no built-in widgets for
either, unlike MapLibre/OpenLayers — see "Scale bar and compass" above).
All four code fixes were verified via the same Playwright/vendored-Cesium
method described below before being reported back to the user as ready to
re-test on-phone.

**Cesium v0.1, second-round bug-fix pass**: the first-round pass above
didn't fully fix everything, and introduced one new regression; the user
reported (again with screenshots) after re-testing: (1) the sceneModePicker
button's own dropdown now opened on top of the new compass button, making
both untappable — fixed by swapping their vertical CSS order (see "3D/2D
switch" above); (2) the black pole circles were still there, same size —
root-caused to two *further* issues in `js/gibsGeographicTilingScheme.js`
beyond the per-level tile-count fix: (a) the tiling scheme's own geometry
only sums to the true 360°×180° extent from level 3 onward (levels 0-2
overshoot by 20-60%, confirmed by direct calculation), so
`createImageryProvider()` now also sets `minimumLevel:
GIBS_GEOGRAPHIC_MIN_LEVEL` (3) to skip them — verified Cesium's own
`ImageryLayer._createTileImagerySkeletons` (read from the vendored
`cesium` npm package, not guessed) actually honors an imagery provider's
`minimumLevel`; (b) a genuine off-by-one in `positionToTileXY` (carried
over faithfully from NASA's own reference code) that left the exact south
pole computing an out-of-range tile row, now fixed — see "Imagery" above
for both. Not fully confirmed this round either (this sandbox's network
block means no GIBS tile — at any level — ever actually loads here, so
the *real* server's behavior at the poles still can't be observed
directly), so this needs the user's phone again to know if the circle is
gone, smaller, or unchanged; (3) territories fine on the 3D globe, but all
city labels jumped together to a new position whenever the globe was
rotated — root-caused to `HeightReference.CLAMP_TO_GROUND` on city
points/labels using a different, asynchronously-batched Cesium code path
than the terrain-draped polygons (which were and remain unaffected); fixed
by dropping `heightReference` from cities entirely, relying on
`disableDepthTestDistance: Infinity` (already present) to keep them
visible regardless of true elevation — see "Historical eras" above. All
three fixes were verified the same Playwright/vendored-Cesium way (exact
tile-index checks at the poles, confirmed `minimumLevel` is honored,
confirmed cities carry no `heightReference` post-fix, confirmed the
toolbar/compass CSS `top` ordering) before reporting back to the user.

**Cesium v0.1, third-round fix — base+overlay imagery layering**: the pole
gap was still present after the second round, so the user redirected the
approach: stop treating this as a CesiumJS engine problem and stop
chasing indexing math, and instead add a guaranteed full-coverage NASA
GIBS layer as the bottom-most imagery layer, with the existing detailed
imagery on top, so any gap in the detailed layer (regardless of exact
cause) reveals real imagery instead of black — explicitly no black
circles, solid caps, or artificial polygons. Implemented as a second
`Cesium.WebMapServiceImageryProvider` layer (GIBS's WMS endpoint, same
`BlueMarble_ShadedRelief_Bathymetry` layer) added to `viewer.imageryLayers`
before the existing WMTS-tiled layer — see "Imagery" above for the full
technical detail (why WMS specifically avoids the whole class of tile-grid
bug the last two rounds were chasing). Verified via Playwright that both
layers construct without error, stack in the correct order, and that the
WMS layer's own outgoing request bboxes reach the true poles exactly
(`-90`/`90`), generated by Cesium's own tiling code rather than app code.
Same caveat as every round before it: this sandbox cannot confirm what the
real GIBS server actually returns at the poles for either layer, only
that the app now requests and composites things correctly — needs the
user's phone to confirm the gap is actually gone on-screen.

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

For the first-round bug-fix pass (GIBS tiling scheme, polygon
densification, sceneModePicker position, scale bar, compass): verified via
the same vendored-Cesium-plus-Playwright method. Confirmed the custom
`GeographicTilingScheme` returns NASA's documented tile counts at every
level (level 0: 2×1, level 1: 3×2, level 7: 160×80, `maximumLevel`: 7) and
that outgoing GIBS request URLs only ever ask for X/Y coordinates that
exist at each level (checked levels 0–2 by hand against the counts above).
Confirmed `densifyRing()` measurably increases entity point counts inside
the live Cesium pipeline (not just in isolation) — a territory polygon
went from ~5 source points to 27 after densification, a full-longitude
glacier polygon from ~5 to 153. Confirmed the glacier toggle flips
`dataSource.show` correctly both ways (this was never actually broken —
see "Glacier layer" above). Confirmed the scale bar renders a plausible
width/label and the compass arrow rotates to match `camera.heading`
(tested a 45° camera rotation → arrow read `rotate(-45deg)`) and resets on
tap (heading returned to `2π`, i.e. equivalent to north/0°). Same caveat
as always: this only proves the code is structurally correct, not that
the real imagery/terrain renders correctly on-screen — that still needs
the user's phone.

For the second-round bug-fix pass (imagery `minimumLevel`, the
`positionToTileXY` off-by-one, city `heightReference` removal, toolbar/
compass CSS swap): this round went one step further than reading the
tiling-scheme code — the vendored `cesium` npm package's own unminified
source (`node_modules/cesium/Build/CesiumUnminified/Cesium.js`) was
grepped and read directly to confirm `ImageryLayer._createTileImagerySkeletons`
actually floors its selected level to `imageryProvider.minimumLevel`
before requesting tiles, rather than assuming the option does what its
name suggests. Confirmed via Playwright: `positionToTileXY` at the exact
south pole (lat -90) now returns tile row `y: 4` (the real last row)
instead of the pre-fix `y: 5` (one past the end); the level-3 tile grid's
`tileXYToRectangle` reproduces `Cesium.Rectangle.MAX_VALUE` exactly
(west -180, north 90, east 180, south -90 — no overshoot); the imagery
provider's `.minimumLevel`/`.maximumLevel` read back as 3/7 as configured;
city entities post-fix carry no `heightReference` on either their point or
label; the toolbar's and compass's computed CSS `top` offsets are in the
new swapped order (compass above the toolbar). One thing this *couldn't*
verify even indirectly: whether GIBS's real server actually serves every
tile our now-corrected index math asks for at the poles — in this sandbox
every GIBS request fails outright (network blocked) regardless of which
tile is requested, at any level, so a wrong-but-plausible-looking index
and a correct one both "fail" identically here. The per-level geometry
overshoot (level 0-2, fixed by `minimumLevel: 3`) and the off-by-one (fixed
in `positionToTileXY`) are both real, provable-by-calculation bugs
independent of that — but whether they were the *entire* explanation for
what the user saw, or whether something else remains, still needs a fresh
on-phone screenshot to know for sure.

For the third-round fix (WMS base layer): confirmed via Playwright that
`viewer.imageryLayers` has exactly 2 layers post-load, in the correct
order (index 0's `imageryProvider.constructor.name` is the minified
`WebMapServiceImageryProvider`, index 1 is `UrlTemplateImageryProvider`,
i.e. base then detail); confirmed the WMS provider's own outgoing request
URLs are well-formed WMS 1.1.1 `GetMap` requests with the expected
`service`/`version`/`request`/`layers`/`format`/`srs` params; confirmed,
specifically, that requests generated while looking at the south pole
include a `bbox` reaching exactly `-90` and `90` (e.g.
`bbox=-180,-90,0,90`) — i.e. Cesium's own tiling logic (not app code) is
correctly asking for imagery that includes the true pole, which is the
crux of why this approach should be robust against the class of bug the
last two rounds chased. As with every round before, this sandbox's total
network block means neither layer's tiles ever actually load here (both
"fail" identically), so what GIBS's WMS server truly returns for a
pole-including bbox on this layer remains unconfirmed until the user
checks on their phone.

## Working conventions

- Develop on branch `claude/map-app-v0-1-az6aoa` (already the checked-out
  branch); push there. Don't open a PR unless asked.
- No build step, no `node_modules` committed — keep it deployable as
  plain static files.
- Give the user Settings/Pages-button-level instructions, never git/CLI
  instructions — they cannot run commands.
