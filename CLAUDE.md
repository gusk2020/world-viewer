# world-viewer — project notes for future sessions

## What this is

A phone-first web map viewer for fictional worlds. The user (gusk2020) is a
non-programmer on an Android phone (Pixel 7a) only — no PC, no terminal.
Do all coding, testing, and GitHub file management yourself. Keep
explanations to the user short, jargon-free, and phrased as easy A/B
preference questions when input is needed. Only ask the user about: visual
preferences, world-setting content, on-phone confirmation, or account
actions only they can do. Everything else (technical judgment calls) is
yours to decide.

Ultimate goal: one shared map app, swappable per-world data (start: 過速世界
only; later: 碧き海狼, 罅間). Do not build support for worlds beyond
過速世界 until asked — avoid speculative generalization, but also avoid
hardcoding 過速世界-specific assumptions into the *code* (data can and
should be 過速世界-specific for now; the code that reads it shouldn't care
which world it's reading). The real purpose of the whole app is a
**sea-level-rise / ice-sheet simulator** (coastline change and glacier/ice-
sheet extent under warming), not just a static map — the user has
repeatedly prioritized "real, correct data" over "looks fine, isn't quite
right," including accepting a full engine rewrite to get there (see
"Architecture history" below).

**Critical process rule, given directly by the user**: build this one
version at a time, in the fixed order below. Don't skip ahead, and don't
build a feature from a later version early even if it seems easy while
already touching related code. Each version only proceeds to the next
after the user has tested it on their Pixel 7a and explicitly said to
continue.

## Version plan (do not reorder or skip)

- **V0.1 (done, user-confirmed on Pixel 7a)**: one rotatable 3D textured
  sphere, Three.js only. No terrain relief, no elevation data, no cities,
  no borders, no OpenLayers, no 2D map yet. The one and only goal: a
  technically clean whole-globe sphere with **no black hole, gap, or seam
  at either pole**, smooth touch rotate + pinch zoom on a Pixel 7a.
- **V0.2 (done, user confirmed to continue)**: add an OpenLayers 2D world
  map (separate from the 3D view, not yet switchable).
- **V0.3 (done, user confirmed to continue)**: add a 3D/2D toggle button,
  preserving view position/zoom across the switch as closely as
  practical.
- **V0.4 (current)**: add real global elevation data, giving the 3D globe
  actual terrain relief (not just a flat textured sphere).
- **V0.5**: add a sea-level-height control — see "Future sea-level
  design" below for the land/ocean split this implies.
- **V0.6+**: cities, borders/territories, historical eras, and other
  過速世界-specific data.

Nothing from V0.5 onward is implemented yet. Do not add pieces of them
now "while already in the file."

## Architecture (Three.js for 3D, OpenLayers for 2D, one page, toggle button)

**Three.js** for the 3D globe, **OpenLayers** for the 2D map, both mounted
on `index.html` and switched with a button (`js/main.js`, added in V0.3 —
see below; `map2d.html` from V0.2's standalone-page stepping stone is
retired now that both views live on one page). Explicitly **not** MapLibre
GL JS and **not** CesiumJS — both were
used in an earlier version of this app and both are retired; see
"Architecture history" below for why, and don't reintroduce either without
the user asking first.

Why this combination fixes the recurring pole problem structurally rather
than case-by-case: MapLibre's globe mode drapes a *tiled* raster projection
onto a sphere (geometrically degenerate at the poles) and CesiumJS's real-
terrain imagery pipeline needed matching a tile-server's own indexing
scheme exactly (three rounds of bugs came from exactly that indexing, see
history) — both failure modes share one root cause: representing the
globe's surface as many discrete tiles that have to align perfectly at
the poles. Three.js's V0.1 approach has no tiles at all: **one single
static equirectangular image, mapped via UV coordinates onto one sphere
mesh**. There is no discrete grid to misalign, no tile index math, nothing
to get an off-by-one in — the image's top row *is* the north pole and its
bottom row *is* the south pole, by construction of what an equirectangular
projection means. This was verified directly (not just argued): a
Playwright-rendered screenshot with the camera pointed straight down at
each pole (`/tmp/.../three-north-pole.png` during dev, not committed)
showed a clean, seamless Antarctica with no gap or artifact.

All of this lives in `js/globe3d.js` (`initGlobe3D(containerId, textureUrl)`,
exporting `getView()`/`setView()` for V0.3's toggle to use — see below),
called from `js/main.js`.

- **Library**: `three` (MIT license, free), version pinned exactly in
  `index.html`'s import map (currently `0.185.1` — check
  `npm view three version` for a newer stable release before bumping, and
  re-test after any bump since three.js does make breaking changes across
  versions). Loaded via a browser-native `<script type="importmap">`
  resolving the bare `"three"` and `"three/addons/"` specifiers to
  jsdelivr CDN URLs — no bundler, no build step, matches this project's
  "plain static files, no build step" hosting model. Chrome on Pixel 7a
  has supported import maps since well before this project started, so no
  polyfill is needed.
- **The globe**: `THREE.SphereGeometry(1, 128, 64)` (radius 1; bumped from
  64×32 in V0.1 to actually show the V0.4 elevation relief below at a
  reasonable resolution — see that section for why not higher) with a
  `THREE.MeshLambertMaterial` (switched from V0.1-V0.3's unlit
  `MeshBasicMaterial` in V0.4, once there was real geometry variation for
  a light to reveal — terrain relief is only visible through shading).
- **Controls**: `three/addons/controls/OrbitControls.js`, Three.js's own
  official addon — handles touch rotate (one-finger drag) and pinch-zoom
  (two-finger pinch → dolly) out of the box, same "the library already
  does this, don't write custom gesture code" principle used throughout
  this project. `enablePan = false` (panning a single free-floating globe
  doesn't make sense — there's nothing to pan relative to); `minDistance`/
  `maxDistance` bound the zoom range so the camera can't go inside the
  sphere or fly off to nothing.
- **The globe texture (the actual "no black hole at the poles" fix)**:
  `worlds/kasoku-sekai/textures/globe.jpg`, a **self-hosted, committed
  file** (~500KB), not fetched from any external host at runtime. This is
  `examples/textures/planets/earth_atmos_2048.jpg` from the official
  `mrdoob/three.js` GitHub repository (the exact texture used in Three.js's
  *own* official rotating-Earth example) — a NASA Blue Marble-derived
  composite, 2048×1024 (exactly 2:1, i.e. a proper full equirectangular
  projection), public-domain-sourced. **Verified directly before choosing
  it, not assumed**: downloaded the file and inspected it with Pillow —
  confirmed exact 2048×1024 dimensions, and confirmed the top row and
  bottom-row pixels are white/near-white (ice/snow), not black — i.e. this
  specific file has real, complete image content reaching both poles.
  Self-hosting it (instead of hotlinking `raw.githubusercontent.com` at
  runtime, which does work but is not an appropriate thing to depend on in
  production, or re-deriving it from NASA GIBS, which is what caused three
  rounds of tiling bugs in the Cesium version) means the core visual has
  **zero external runtime dependency** — matches "as free/open as
  possible" and removes an entire class of failure (a remote host being
  slow, down, or blocked) that affected every prior version of this app.
  **This is placeholder real-Earth imagery, not 過速世界's actual
  geography** — same "real placeholder, not fake, until real setting data
  exists" convention used for the old version's territory/city/glacier
  data. Swap `worlds/kasoku-sekai/config.json`'s `globeTexture` path for a
  real 過速世界 world-map image whenever the user has one; no code change
  needed.
- **Hosting**: unchanged — GitHub Pages serving straight from this repo's
  branch, no build/CI step, plain static HTML/CSS/JS (+ one committed
  JPG).

### V0.4: real elevation / terrain relief

Same "one static, verified, self-hosted equirectangular image, no tiles"
approach that fixed the pole problem for the color texture, applied again
here — deliberately not going anywhere near a tiled elevation service.

- **The elevation data**: `worlds/kasoku-sekai/textures/elevation.jpg`
  (1000×500, exact 2:1 equirectangular, ~90KB, self-hosted/committed, no
  external runtime dependency), `config.json`'s `elevationMap`. This is
  `01_earthbump1k.jpg` from the `Izaacapp/threejs-earth` GitHub repo,
  sourced from planetpixelemporium.com's well-known free Earth texture
  set (their elevation/bump map, derived from real topography+bathymetry
  data, not hand-painted). **Verified directly before choosing it**:
  downloaded and inspected with Pillow — confirmed 1000×500 (2:1), confirmed
  grayscale, and confirmed the top-row (north/Arctic Ocean) and
  bottom-row (south/Antarctica) pixel values are low-but-uniform and
  high-but-uniform respectively, geographically sensible (real data, not
  a corrupted/missing-data gap) — same rigor as the color texture check
  in V0.1.
- **Displacement is baked into real CPU-side vertex positions, not a GPU
  `displacementMap`**: `applyElevation()` in `js/globe3d.js` reads the
  elevation image into pixel data via an offscreen canvas
  (`loadElevationSamples()`), then for every sphere vertex samples the
  corresponding pixel by UV coordinate and pushes that vertex outward (or
  inward) along its own direction from the sphere's center, before
  calling `geometry.computeVertexNormals()` so lighting shades the new
  bumpy surface correctly. A plain `MeshStandardMaterial.displacementMap`
  would have been less code, but it's a vertex-shader-only effect — the
  CPU-side `geometry.attributes.position` values never actually change,
  so nothing on the JS side (raycasting, distance queries, a future
  "compare this point's height against sea level") could ever see the
  real 3D shape. Baking it into real geometry now, while it's cheap and
  the mesh is small, keeps V0.5's planned separate land-terrain-vs-sea-
  level-sphere comparison (see "Future sea-level design" below) actually
  possible later.
- **Exaggerated on purpose, not to scale**: `DISPLACEMENT_SCALE`/
  `DISPLACEMENT_BIAS` constants in `globe3d.js`. Earth's real elevation
  range (-11km to +8.8km) is only about ±0.15% of its radius — rendered
  true-to-scale the globe would look like a perfectly smooth ball (a
  well-known real fact, not a limitation of this approach). The
  exaggeration is a deliberate, standard, transparent display choice
  (same convention used in most scientific terrain visualizations) — the
  underlying elevation *data* is real, only the *display scale* is
  inflated for visibility. Tune these two numbers if the relief looks too
  subtle or too extreme on-phone; nothing else needs to change.
- **Pole handling, the actual hard part**: every vertex in the sphere's
  top ring (north pole) and bottom ring (south pole) occupies the exact
  same 3D point *before* displacement, despite having different
  longitudes — sampling the elevation map per-vertex there would push
  these coincident points to different final distances from center,
  tearing the pole open into a gap or spike (precisely the class of bug
  this whole project has repeatedly fought with other engines, just via
  a different mechanism this time). Fixed by forcing every vertex in each
  pole's ring to the *same* value — the average across that entire row of
  the source image — keeping them coincident after displacement too.
  **Verified directly, not just argued**: read back every north-ring and
  south-ring vertex position after displacement and confirmed zero spread
  (every vertex in each ring is bit-for-bit identical) — see "How this
  was tested" below.
- **A separate, pre-existing, cosmetic-only artifact investigated and
  deliberately left alone**: zooming the camera in tight directly on a
  pole shows faint streaks radiating from it. Spent real effort chasing
  this as a possible new pole bug — tried tapering near-pole vertices'
  sampled elevation toward the pole's flat average over blend zones ranging
  from 12° to 30° of latitude, and it made **no visible difference at
  all**. Isolated the actual cause by swapping in a flat, fully unlit
  material (no elevation, no lighting) at the same camera angle: the
  exact same streaks were still there. This means it's the equirectangular
  **color** texture's own pixel/mipmap sampling becoming highly compressed
  near a UV-sphere's pole (many texture columns squeezed into a visually
  tiny screen area), unrelated to elevation or lighting entirely — and
  it's not new: the same pattern, fainter, is visible on close inspection
  of V0.1's own already-user-approved pole screenshot at the normal
  (further) zoom. Left as-is: it's cosmetic, pre-existing, only shows up
  zoomed in tight directly on a pole (not a typical viewing distance), and
  a real fix would mean texture filtering/resolution work unrelated to
  V0.4's actual scope, not an elevation-side change. Don't re-attempt an
  elevation-blending fix for this specific artifact without re-confirming
  the color-texture-only cause hasn't changed.
- **A separate 2D-map interaction found while testing V0.4's near-pole
  views through the V0.3 toggle** (not a V0.4 bug itself, but only
  surfaced by finally testing the toggle at extreme latitudes): OpenLayers's
  `View` doesn't just fail to show latitudes past Mercator's real ~85.05°
  limit, it silently **repositions the center** at low zoom levels to
  whatever latitude fits the current viewport rectangle inside the
  projection's valid extent — confirmed directly that at zoom 3 on a
  phone-sized viewport, requesting -80, -85, and -89.9999 all produced the
  *exact same* -70.7° result, nowhere near the pole and not obviously
  related to any of those requests. Since this app's whole focus is the
  poles, silently landing somewhere else would be confusing. Fixed in
  `map2d.js`'s `setView()`: a request beyond ±80° latitude now forces the
  2D zoom up to at least 6 first (confirmed this lands within about a
  degree of the real Mercator limit instead), at the cost of not carrying
  the exact 3D zoom level in this one edge case — position accuracy wins
  over exact zoom preservation here, consistent with zoom already being
  documented as approximate, not exact.

### The OpenLayers 2D map

Lives in `js/map2d.js` (`initMap2D(targetId)`, exporting `getView()`/
`setView()` — same shape as `globe3d.js`), mounted into `#map2d` on
`index.html` alongside the 3D globe. (In V0.2 this was briefly a
standalone `map2d.html` page instead — retired in V0.3 once there was a
toggle button to switch between the two on one page; don't recreate that
file.)

- **Library**: `ol` (OpenLayers, BSD-2-Clause, free), version pinned
  exactly (currently `10.10.0`). **Loaded differently from Three.js, for a
  concrete reason**: OpenLayers's raw npm package ships genuine ESM
  source files (`ol/Map.js`, `ol/View.js`, etc., same idea as Three.js),
  but unlike Three.js those files have real bare-specifier npm
  dependencies of their own (`rbush`, `pbf`, `earcut`, and rbush's own
  dependency `quickselect`, at minimum for a plain tile map — confirmed by
  actually trying the import-map approach first and hitting
  `Failed to resolve module specifier "rbush"`). Mapping every one of
  those transitively by hand is fragile and easy to silently miss one.
  OpenLayers's npm package also ships a pre-bundled, dependency-free
  global build at `dist/ol.js` (confirmed by inspection — zero bare
  imports, all five-ish dependencies already inlined), so `index.html`
  loads that instead via a plain `<script src=".../ol@10.10.0/dist/ol.js">`
  tag (exposing a global `ol` namespace: `ol.Map`, `ol.View`,
  `ol.layer.Tile`, `ol.source.OSM`, `ol.proj`, ...) plus the matching
  `ol.css` for its default UI controls — same "global script tag, no
  bundler" shape as the old Cesium build, chosen for the same practical
  reason (it's the version of the library that's actually self-contained),
  not because of any special preference for that pattern. `js/map2d.js`
  is consequently an ES module (`export function initMap2D(...)`, so
  `js/main.js` can `import` it) that internally references the plain
  global `ol` rather than importing it — this works fine since the classic
  `<script src=".../ol.js">` tag in `<head>` always finishes running
  before any `type="module"` script executes, regardless of the tags'
  order in the page. Don't add `import ... from "ol"`-style statements to
  this file — there's no such module to import from, only the global.
- **The basemap**: real OpenStreetMap raster tiles
  (`ol.source.OSM()`, OpenLayers's own built-in source class — standard
  Web Mercator XYZ tiles, `tile.openstreetmap.org/{z}/{x}/{y}.png`, no
  custom tiling-scheme code at all). Chosen deliberately to avoid
  reopening the exact class of problem the Cesium/GIBS era spent three
  rounds fighting (matching a tile server's own irregular indexing) —
  `ol.source.OSM` is one of OpenLayers's most standard, heavily-used
  built-in sources, with nothing custom for this app to get wrong. Same
  "real placeholder, not fake, until 過速世界's own map exists" convention
  as the 3D globe's Earth-photo texture — this is a real map of the real
  Earth, not 過速世界's geography.
  **Known, expected, non-bug limitation**: Web Mercator (which essentially
  every standard 2D web tile service including this one uses) cannot
  represent latitudes beyond about ±85.05° by construction of the
  projection itself — the poles simply aren't part of a Mercator
  rectangle. This is completely normal for a flat 2D map (every major web
  map — Google, Bing, OSM's own site — has exactly the same limit) and is
  a *different, well-understood, universally-accepted* situation from the
  black-hole bug that drove the whole engine rewrite: that bug was about
  literally missing/misaligned imagery *within* a projection that should
  have covered the pole; this is a projection that was never designed to
  reach the pole at all. Don't try to "fix" this for V0.2 — if accurate
  polar coverage in the 2D view ever matters (e.g. for the sea-level
  simulator), that's a deliberate future design question (a polar-
  stereographic inset, most likely), not a bug to patch now.
- **Per-world data**: none yet, deliberately. The OSM basemap is hardcoded
  in `js/map2d.js` rather than read from `worlds/kasoku-sekai/config.json`
  — unlike the 3D texture, there's no concrete second use case yet for
  *which* 2D basemap a given world uses (a real-Earth world vs. a fully
  invented one like 碧き海狼/罅間 would need fundamentally different kinds
  of 2D map sources, not just a different URL), so designing that seam now
  would be guessing. Revisit when a second world's 2D map is actually
  being built.
- **Interactions**: OpenLayers's own default interaction set (created
  automatically when `Map` isn't given an explicit `interactions` option)
  — drag-to-pan and pinch-to-zoom (plus mouse-wheel zoom, double-click
  zoom, etc.) all work out of the box, no custom gesture code, same
  principle as `OrbitControls` on the 3D side.

### V0.3: the 3D/2D toggle

`index.html` mounts both `#app` (3D) and `#map2d` (2D) plus one
`#view-toggle` button; `js/main.js` shows/hides them with the `hidden`
attribute and calls each view's own `getView()`/`setView()` to carry the
current position/zoom across the switch, per the user's explicit "as
closely as practical" requirement.

- **Lazy 2D construction**: `initMap2D()` isn't called until the user
  first switches to 2D, not at page load. Reason: OpenLayers measures its
  target container's size when the `Map` is constructed, and `#map2d`
  starts out `hidden` (`display:none`, since the app opens in 3D mode) —
  constructing it only once `#map2d` is actually visible sidesteps the
  "map thinks its container is 0×0" class of bug entirely, rather than
  working around it with an explicit `updateSize()` at the *first*
  reveal. (A `updateSize()` call is still made on every *subsequent*
  switch back to 2D, in case the window was resized while it was hidden —
  cheap, and avoids relying on OpenLayers's own `ResizeObserver` noticing
  a container that was hidden the whole time it changed size.)
- **The lng/lat/zoom conversion** lives in `js/geoConvert.js`
  (`directionToLngLat`/`lngLatToDirection` for the 3D camera's direction
  vector ↔ plain lng/lat, and `distanceToZoom`/`zoomToDistance` for a
  rough correspondence between the 3D camera's distance-from-globe-center
  and OpenLayers's zoom level), imported by both `globe3d.js` and used
  directly by `main.js`'s toggle handler (`map2d.js` does its own
  lng/lat ↔ Mercator conversion via `ol.proj`, since OpenLayers already
  has that built in).
  - The direction↔lng/lat math is derived from — and must stay consistent
    with — exactly how `THREE.SphereGeometry`'s default UV mapping lays
    the equirectangular texture onto the sphere in `globe3d.js` (+Y is the
    north pole, longitude increases eastward from the texture's left
    edge at -180°). If the sphere is ever rotated, given a different
    `phiStart`, or the texture is replaced with a differently-oriented
    one, this conversion needs re-deriving to match — it is *not* a
    general-purpose spherical-coordinates utility.
  - The zoom correspondence is **deliberately approximate, not exact**:
    the 3D camera's usable distance range (`MIN_DISTANCE`/`MAX_DISTANCE`
    in `globe3d.js`, currently 1.3–8) is far narrower than OpenLayers's
    zoom range, since the 3D globe has no terrain/city detail to zoom into
    yet. The mapping is calibrated so each view's own shared starting
    point (3D distance 3 ↔ 2D zoom 2) matches exactly; requesting a
    zoom level beyond what the 3D camera's range supports just clamps at
    `MIN_DISTANCE`/`MAX_DISTANCE` instead of erroring, which is expected,
    not a bug — verified directly: setting the 2D view to zoom 4 and
    switching to 3D lands at the clamped equivalent (~zoom 3.2, matching
    `MIN_DISTANCE`), not an error or a wildly wrong value. Revisit this
    calibration once V0.4 (terrain) or a later version gives the 3D
    camera a reason to support a narrower/closer zoom range.
- Position/zoom carrying is **one-directional per switch**, applied once
  at the moment of toggling — there's no continuous two-way sync while
  both views could theoretically be visible (they can't be; only one is
  shown at a time), so this is the simplest correct approach for what the
  toggle actually needs.

## World-data structure (the "common app, swappable data" seam)

Kept deliberately minimal for V0.1 — just enough seam that a second world
means adding a new `worlds/<world-id>/` folder + config, not touching
`js/main.js`. Don't build more of this than the current version needs.

`worlds/<world-id>/config.json` currently holds only `id`, `name`,
`globeTexture` (path to that world's equirectangular sphere texture).
`js/main.js` fetches one hardcoded config path
(`worlds/kasoku-sekai/config.json`) — it doesn't know anything world-
specific beyond that path, and doesn't know it's rendering 過速世界
specifically (it just renders "whatever `globeTexture` says"). When a
second world is added later, the natural next step is a small world-
picker UI that changes which config path is fetched; do not build that
picker now. Each future version's own data (2D map source, elevation
data, city/border data, etc.) should land in this same per-world config
as it's actually implemented — don't add fields speculatively ahead of
the version that uses them.

## Future sea-level design (V0.5, not yet implemented)

Per the user's explicit direction: model **land terrain** and **the ocean
surface** as two separate objects (e.g. two separate meshes/spheres, land
relief on one and a simple sea-level sphere on the other) rather than one
combined terrain+water surface, so that raising "sea level" is just moving
or resizing the ocean sphere relative to the fixed land terrain — not
re-baking terrain data. This is a design note for V0.4/V0.5, not a
decision to act on now; V0.1 has no terrain or ocean concept yet.

## Architecture history: MapLibre GL JS + CesiumJS (retired)

This app was originally built on **MapLibre GL JS**, then migrated to
**CesiumJS** to fix a pole-rendering bug, then went through three rounds
of Cesium-specific pole/imagery bug fixes that still didn't fully satisfy
the user. After the third round, the user made the explicit call recorded
at the top of this file: stop patching that architecture and rebuild from
scratch on Three.js (3D) + OpenLayers (2D, from V0.2), reusing *lessons*
but not *code* from the old version.

**The old version still exists and is fully recoverable** — it was not
deleted. It's preserved on the git branch **`legacy-cesium-maplibre-v0`**
(pushed to GitHub, same repo), which is a snapshot of this branch
immediately before the Three.js rewrite began. That branch's own
`CLAUDE.md` has the complete, detailed history of the MapLibre era, the
Cesium migration, and all three rounds of pole/imagery bug-fixing
(tiling-scheme math, WMS base-layer fallback, etc.) — don't duplicate that
detail here; read it directly from that branch if it's ever needed again
(e.g. `git show legacy-cesium-maplibre-v0:CLAUDE.md`). The short version,
for context on *why* the rewrite happened:

- MapLibre's globe mode draped Web-Mercator-tiled raster imagery onto a
  sphere, which is geometrically degenerate right at ±90° latitude — an
  unfixable structural limitation, not a bug in this app's code.
- A same-engine OpenLayers workaround (dedicated flat polar-stereographic
  maps) fixed the *visual* problem but meant maintaining two rendering
  engines with no shared 3D terrain and no path to a unified sea-level
  feature.
- Switching to CesiumJS (a true WGS84-ellipsoid engine) fixed the
  structural MapLibre bug, but needed matching NASA GIBS's real tile-
  server indexing exactly for its detailed imagery layer, which took three
  rounds of increasingly deep bug-fixing (an irregular non-doubling tile
  pyramid, a `minimumLevel` fix, an off-by-one in tile-index math, then
  finally a full second WMS-based fallback imagery layer) and *still*
  hadn't fully satisfied the user by the third round.
- The user concluded the CesiumJS/tiled-imagery approach itself was the
  wrong shape of solution for a problem that a single untiled image
  trivially avoids, and redirected to Three.js for exactly that reason.

Do not re-introduce MapLibre or CesiumJS without the user explicitly
asking for it again.

## How this was tested (no browser on the dev side either)

Real basemap/library/data CDN hosts (jsdelivr, NASA GIBS, Esri, etc.) are
blocked by this environment's own egress policy — a sandbox restriction,
not a real-world problem; the user's phone has normal internet. The
consistent workaround throughout this project: install the library from
npm (`registry.npmjs.org` is allowed) into a scratch copy, vendor it
locally alongside a local static file server, and drive it with
Playwright/Chromium (software WebGL via swiftshader) to verify the app
works — while accepting that final on-device look/feel and performance
still need the user's actual phone. Re-run this whole approach before
telling the user a change is ready; don't rely on reading the code alone.

For V0.1 specifically, this went further than in past versions and
produced **actual rendered-pixel proof**, not just structural checks —
because the globe texture is a self-hosted local file, Playwright could
load it for real (unlike every past NASA/Esri network call in this
sandbox, which always failed here regardless of correctness). Verified:
the texture image loads at its real 2048×1024 size; the sphere geometry
constructs with the expected vertex count; **the camera was pointed
straight down at the north pole and then the south pole, the scene was
rendered, and the center pixel of each render was read back and confirmed
to be white/near-white and fully opaque — not black** (north: RGB
255,255,255; south: RGB 237,238,239 — both alpha 255); a full screenshot
of the south-pole view was also saved and visually confirmed clean, with
no gap, seam, or artifact anywhere near the pole. Also verified: a
simulated pointer drag on the canvas changes `OrbitControls`'s azimuthal
angle (confirms rotate works); a simulated wheel/pinch-equivalent event
changes the camera's distance from the globe (confirms zoom works); no
uncaught page errors; the only console message was a harmless
`favicon.ico 404` from the plain Python test server (not from the app).
One gotcha hit while writing this test, worth remembering for next time:
reading pixels back from a `THREE.WebGLRenderer`'s canvas (via
`drawImage`/`getImageData`) must happen in the **same synchronous task**
as the `render()` call — the renderer doesn't set
`preserveDrawingBuffer`, so the browser can clear the buffer before a
later `page.evaluate()` call gets to read it, producing a false-negative
all-zero/transparent pixel that looks like a rendering bug but isn't.

What this couldn't verify from this sandbox: real on-device frame rate
and touch feel on an actual Pixel 7a (swiftshader software rendering in a
headless browser doesn't reflect real mobile GPU performance) — needs the
user's phone, same as always. **V0.1 was subsequently confirmed working
on the user's actual Pixel 7a** (all 4 points: rotate, pinch-zoom, no gap
at either pole, smooth) before V0.2 began.

For V0.2 (OpenLayers 2D map): same vendor-locally-and-drive-with-
Playwright method, using `ol`'s own bundled `dist/ol.js` (see
"Architecture" above for why the raw ESM source doesn't work standalone).
Confirmed: the map constructs and its loading overlay hides itself even
with every tile request failing (blocked network, same as always in this
sandbox); outgoing tile request URLs match the standard OSM XYZ pattern
exactly; a simulated pointer drag changes the view's center coordinate
(confirms pan); a simulated wheel event changes the view's zoom level
(confirms zoom); no console errors. Real visual appearance and on-device
touch feel again need the user's phone. **V0.2 was subsequently confirmed
by the user** (they said to continue) before V0.3 began.

For V0.3 (3D/2D toggle): same method, with both libraries vendored into
one combined test page (mirroring the real merged `index.html`). Verified
directly, not just structurally: set the 3D view to a specific lng/lat/
zoom via `globe3d.setView()`, toggled to 2D, and confirmed
`map2d.getView()` read back the *same* lng/lat/zoom (exact lng/lat, zoom
matching to floating-point precision); did the same in the other
direction (set a 2D view, toggle to 3D, confirm `globe3d.getView()`
matches) including a case chosen specifically to hit the zoom-clamping
edge case (2D zoom 4, which exceeds what `MIN_DISTANCE` allows on the 3D
side) and confirmed it clamps to the expected value rather than erroring
or producing nonsense; switched back to 2D a second time to confirm the
lazy-construction-then-`updateSize()` path also works, not just the
first-ever construction; confirmed a pointer drag still rotates the 3D
globe correctly after multiple toggle round-trips (no leftover broken
state); confirmed `globe3d.setView()`/`getView()` still behave sanely
exactly at the true north pole (lat 90) with no `NaN`/crash — the
underlying sphere/texture rendering code itself is unchanged from V0.1's
already-verified pole screenshot test, only wrapped into a module and
given `getView()`/`setView()`, so that verification still stands. No
console errors in any of this. Real visual appearance and on-device touch
feel need the user's phone, as always. **V0.3 was subsequently confirmed
by the user** before V0.4 began.

For V0.4 (real elevation/terrain relief): the elevation texture is also a
self-hosted local file, so — same as V0.1's texture check — Playwright
could load it for real and produce actual rendered proof, not just
structural checks. Verified: the elevation image loads at its real
1000×500 size; the sphere geometry has the expected 128×64-segment vertex
count (8385). **Pole coincidence, the critical check**: read back every
vertex in the geometry's north-pole ring and south-pole ring (by UV.y) and
computed the maximum pairwise distance within each ring — both came back
exactly 0, confirming every vertex in each ring lands at the bit-for-bit
identical 3D position after displacement (no gap, tear, or spike at
either pole). **Elevation sanity**: sampled the raw elevation data at a
known mountain location (the Himalayas, ~85°E 28°N) and a known deep-ocean
location (mid-Pacific, ~160°W 0°N) and confirmed the mountain value was
clearly higher than the ocean's exact-zero value — real geographic
variation, not corrupted or flat data. Confirmed the scene contains the
expected `Mesh` + `DirectionalLight` + `AmbientLight`. Took real rendered
screenshots (not just pixel-color spot checks) of the default view, a
close-up on the Himalayas, and both poles — the default view clearly
shows visible mountain-range relief silhouetted against the sky at the
globe's edge and directional shading across the continents (screenshot
inspected directly, not just described); this is also where the
color-texture pole-streak investigation happened (see "V0.4: real
elevation" above) — tried and rejected an elevation-blending fix after
confirming via a flat-unlit-material comparison render that the streaks
come from the color texture, not elevation or lighting. Re-ran the full
V0.3 toggle regression suite (exact view carrying both directions, the
zoom-clamping edge case, repeated toggles, drag-to-rotate) and it still
passed after these changes — which is also how the 2D near-pole
View-repositioning issue was found and then re-verified fixed (request
-89.9999° at zoom 3, confirm it now lands at -84.1° and zoom 6 instead of
the pre-fix -70.7°). No console errors. Real visual appearance, on-device
frame rate with the larger mesh, and touch feel all need the user's
phone, as always.

## Working conventions

- Develop on branch `claude/map-app-v0-1-az6aoa` (already the checked-out
  branch); push there. Don't open a PR unless asked.
- No build step, no `node_modules` committed — keep it deployable as
  plain static files (one committed texture JPG is fine; large binary
  assets in general should stay small enough for git to handle
  comfortably).
- Give the user Settings/Pages-button-level instructions, never git/CLI
  instructions — they cannot run commands.
- Report back in the user's required short format: できたこと (what got
  done) / Pixel 7aで確認すること (what to check on their phone) /
  残っている問題があればその問題 (remaining problems, only if any) — no
  long technical explanations unless asked.
