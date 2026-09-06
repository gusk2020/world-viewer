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
- **V0.2 (current)**: add an OpenLayers 2D world map (separate from the 3D
  view, not yet switchable).
- **V0.3**: add a 3D/2D toggle button, preserving view position/zoom
  across the switch as closely as practical.
- **V0.4**: add real global elevation data, giving the 3D globe actual
  terrain relief (not just a flat textured sphere).
- **V0.5**: add a sea-level-height control — see "Future sea-level
  design" below for the land/ocean split this implies.
- **V0.6+**: cities, borders/territories, historical eras, and other
  過速世界-specific data.

Nothing from V0.3 onward is implemented yet. Do not add pieces of them
now "while already in the file."

## Architecture (Three.js for 3D, OpenLayers for 2D, not yet linked)

**Three.js** for the 3D globe, **OpenLayers** for the 2D map (added in
V0.2, a separate page for now — see below). Explicitly **not** MapLibre
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
- **The globe**: `THREE.SphereGeometry(1, 64, 32)` (radius 1, 64×32
  segments — smooth enough to look round at any zoom, cheap enough that
  segment count was never a performance concern even in the software-
  rendered/swiftshader test environment) with a `THREE.MeshBasicMaterial`
  (deliberately **unlit** — no `THREE.MeshStandardMaterial` + light setup
  yet, so the whole globe renders evenly bright everywhere instead of half
  of it going dark for lack of a light source; revisit this choice once
  V0.4's terrain relief makes shading actually useful).
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

### V0.2: the OpenLayers 2D map

Lives entirely at `map2d.html` / `js/map2d.js`, a **separate page** from
the 3D globe (`index.html`/`js/main.js`) — nothing links them yet, that's
V0.3's job. To view it: the same GitHub Pages URL with `map2d.html`
instead of `index.html` at the end.

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
  imports, all five-ish dependencies already inlined), so `map2d.html`
  loads that instead via a plain `<script src=".../ol@10.10.0/dist/ol.js">`
  tag (exposing a global `ol` namespace: `ol.Map`, `ol.View`,
  `ol.layer.Tile`, `ol.source.OSM`, ...) plus the matching `ol.css` for
  its default UI controls — same "global script tag, no bundler" shape as
  the old Cesium build, chosen for the same practical reason (it's the
  version of the library that's actually self-contained), not because of
  any special preference for that pattern. `js/map2d.js` is consequently
  a plain classic script (no `type="module"`, no `import` statements) —
  don't add ESM `import`s to it without switching the loading approach
  back, or they'll fail with no `ol` module scope to import from.
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
touch feel again need the user's phone.

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
