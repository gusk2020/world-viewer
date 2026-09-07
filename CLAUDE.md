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
- **V0.4 (done, user confirmed to continue)**: add real global elevation
  data, giving the 3D globe actual terrain relief (not just a flat
  textured sphere). First pass came back "too dark to read the relief
  clearly" — fixed via measured lighting brightness (see "V0.4: real
  elevation" below) before the user signed off.
- **V0.5 (done, user confirmed on Pixel 7a)**: add a sea-level-height
  control — see "Future sea-level design" below for the land/ocean split
  this implies. Bundled together with a forest-brightness fix at the
  user's explicit request ("森をもう少し明るくしてください...これは次の
  機能追加とまとめて行ってください") — see "V0.5: forest brightness
  (gamma correction)" and "V0.5: sea-level control" below. First pass had
  a real coastline change happening but far too subtle to see on-phone
  (~0.0007 radius units, under one screen pixel) — recalibrated to a
  clearly visible magnitude (see the "Third mistake" note under "V0.5:
  sea-level control" below) before the user signed off with "仮の地形
  データということであれば合格です" (acceptable, given this is placeholder
  terrain data).
- **V0.6+ (current)**: cities, borders/territories, historical eras, and
  other 過速世界-specific data. This bucket covers several distinct
  features, not one version — per the "one version at a time" rule, treat
  each as its own sub-version (V0.6, V0.7, ...) in whatever order makes
  sense once there's actual 過速世界 data to work from, rather than
  building any of it speculatively. **Needs the user's own world-setting
  data first** (city names/locations, territory/border shapes, era
  definitions) — this is 過速世界 content, not a technical judgment call,
  so ask the user for it rather than inventing placeholder cities/borders
  the way placeholder Earth imagery was used for the globe texture itself.

Nothing from V0.6 onward is implemented yet. Do not add pieces of them
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
- **First-round user feedback, addressed**: the user found the lit globe
  "too dark overall" to make the new terrain relief out clearly, and
  separately confirmed the pole streaks above are "better than before,"
  not something to chase further right now. Fixed the darkness by
  **measuring** rendered brightness rather than adjusting by feel:
  average pixel luminance across the visible globe was ~34/255 for the
  old unlit (V0.1-V0.3) texture, but only ~21/255 with the first lighting
  pass (`DirectionalLight` 1.2 + `AmbientLight` 0.7) — this version of
  Three.js uses physically-based light units unconditionally (there is no
  `useLegacyLights`/`physicallyCorrectLights` toggle to fall back to any
  more), where intensity 1 reads dimmer than older non-physical tutorials
  assume, which is almost certainly why the first pass came out darker
  than the original unlit brightness rather than just "revealing shading
  on top of it." Retuned to `DirectionalLight` 3.0 + `AmbientLight` 2.0,
  measured at ~39/255 — brighter than the original unlit baseline, with
  enough of a directional/ambient split left for terrain shading to still
  read as three-dimensional. Re-measure the same way (render, read back
  pixels, average luminance vs. the ~34/255 unlit baseline) if these need
  retuning again, rather than guessing. **Trade-off worth knowing**: since
  the pole-streak artifact above is a subtle brightness/contrast pattern,
  brightening the whole scene made it *somewhat* more visible too (more
  overall exposure reveals more of any subtle pattern) — flagged to the
  user rather than treated as a new regression, since it's the same
  underlying pre-existing, already-discussed cause, not something this
  brightness change introduced.
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

### V0.5: forest brightness (gamma correction)

User feedback on V0.4's lit globe (after the lighting-intensity fix
above): "森をもう少し明るくしてください。リアルさより分かりやすさを重視
します" (brighten the forests a bit; prioritize clarity over realism).
Measured the actual problem before picking a fix, same as the lighting
darkness fix: sampled raw texture RGB at known forest coordinates (Amazon
~(44,46,61), Congo ~(31,34,51)) vs. a known desert coordinate (~(238,215,
163)) — confirmed the darkness is baked into the source texture's own
pixel data, not a lighting artifact on top of it. A uniform brightness
multiplier would have to blow out the already-bright areas (desert, ice,
clouds) to lift those dark greens to a readable level. Fixed instead with
a gamma curve (`COLOR_GAMMA = 0.6` in `js/globe3d.js`, applied via
`applyGammaCorrection()`): `output = 255 * (input/255)^gamma`, computed
through a 256-entry lookup table (cheap — this runs once per texture pixel
at load time, not per frame) and applied to the texture via canvas
`getImageData`/`putImageData` before it's uploaded as a `THREE.
CanvasTexture`. A gamma curve below 1 lifts shadows much more than
highlights while keeping black anchored at black and white at white — it
targets exactly the dark-forest problem without washing out the rest of
the map. Verified directly: re-measured the same coordinates after the
fix — Amazon → (89,91,108) (~2x brighter), desert → (245,230,195) (barely
moved). This is a deliberate clarity-over-realism display choice, same as
V0.4's elevation exaggeration and per the user's own explicit direction
this time, not an attempt to reproduce the source photo faithfully.

### V0.5: sea-level control

A slider (`#sea-level-control` in `index.html`, wired up in `js/main.js`,
only shown in 3D mode — the 2D map has no sea-level concept yet) that
calls `globe3d.setSeaLevel(fraction)` (0-1) on input. Implements the
land/ocean split from "Future sea-level design" below: a separate,
semi-transparent sea sphere (`THREE.MeshLambertMaterial`, blue, opacity
0.6) sits independently of the land terrain mesh — raising sea level only
resizes this sphere via `scale.setScalar()`, never touches or re-bakes the
land geometry.

**Calibrating the baseline and the slider's range — two real mistakes made
and corrected, not a straight first-try success**:

- **Baseline height**: initially assumed the elevation map's height values
  form a roughly continuous surface, so the sea-level baseline was picked
  as the histogram percentile matching Earth's real ~71% ocean-area
  fraction (`OCEAN_AREA_FRACTION = 0.71`). Actually inspecting this
  specific bump map's histogram (Python/Pillow, counted every pixel) showed
  that's the wrong model for this data: **65% of all pixels are exactly
  0** — the ocean is encoded as a flat, uniform floor with no bathymetric
  variation at all, not a continuous slope down from the coast. Land
  elevation also rises very steeply from that floor (pixel value 1 alone
  already covers 5% of all *land* pixels; value 3 covers 11%). The
  71st-percentile approach happened to land almost exactly on the ocean
  floor anyway, by coincidence — but the fix was simplified to match what
  the data actually encodes: the baseline is just the data's true minimum
  pixel value (`seaLevelBaseHeightValue()` in `js/globe3d.js`, a plain
  min-scan), no percentile math needed. **Re-verify this "flat ocean
  floor" assumption with a fresh histogram check** (same method) before
  reusing this approach for a future world's elevation data — it might not
  hold.
- **Maximum rise, three attempts, not two**: the first version of
  `SEA_LEVEL_MAX_RISE_HEIGHT` was chosen directly in final radius units
  (0.025) sized as "a plausible fraction of the total land relief range"
  — reasonable-sounding, but checked against this data's actual histogram
  it submerged upwards of 40% of all land, confirmed directly with a
  screenshot: an entire mid-continent view (Brazil's interior) that
  should show a clear coastline went entirely blue at max slider.
  Recalibrated from the histogram directly instead of guessing a
  plausible-sounding fraction: `SEA_LEVEL_MAX_RISE_HEIGHT = 3/255`
  submerged only the lowest ~8-11% of land pixels at the slider's
  maximum, confirmed via a screenshot at a known low-lying river delta
  showing a modest, believable advance of the waterline. **This shipped
  to the user and turned out to be the opposite mistake**: 3/255 scaled
  by `DISPLACEMENT_SCALE=0.06` is a final radius change of only ~0.0007 —
  under one screen pixel at any normal zoom, so on the user's actual
  Pixel 7a the slider produced no visible coastline change at all. They
  reported "dark shadow-like patches expand and shrink, not a real
  coastline change." Diffing the user's own before/after screenshots
  pixel-by-pixel (Pillow `ImageChops.difference`, binned into a coarse
  grid) confirmed the underlying geometry *was* changing exactly along
  every coastline in view — the feature wasn't broken, the change was
  just too thin to read as anything but noise. Recalibrated a second
  time, deliberately trading data-fidelity for visibility per the user's
  own standing "分かりやすさ over リアルさ" direction: tried level 30/255
  first (~10x bigger) and screenshotted a wide South America view as a
  sanity check — it reproduced the earlier catastrophe's shape, shattering
  the Amazon basin into scattered islands. Backed off to level 10/255:
  the same South America view now shows a visible flooded patch in the
  low-lying interior without fragmenting the continent, and a moderate-
  zoom coastal view (matching the framing of the user's own screenshots)
  shows an unmistakable new bay forming. Landed on `10/255` as the
  current value. This submerges a larger nominal fraction of "land
  pixels" (~32%) than the original 8-11% target, which is fine — the
  data's near-sea-level land is heavily front-loaded with low-lying
  coastal fringe, and a "correctly" calibrated but invisible slider has
  zero value for the user's actual goal of seeing sea level change
  happen. **Still needs the user's on-phone confirmation** — this session
  can only judge "looks reasonable" from its own screenshots, not real
  visibility on the actual device; re-tune from here (same histogram +
  screenshot method, plus diffing real user screenshots if it's wrong
  again) rather than guessing blind.
- **Honesty caveat carried into the README for the user**: this
  calibration is illustrative, derived from this specific placeholder
  elevation dataset's own statistics — not a precise "N meters of real
  sea-level rise," and deliberately erring toward a more visible (and so
  less strictly "realistic") flood extent after the invisible first
  attempt. Re-derive both constants from a fresh histogram whenever the
  elevation data is replaced with anything else (a higher-resolution
  dataset, or 過速世界's real terrain later).

**Z-fighting checkerboard on the ocean, found and fixed while testing the
above**: because the true ocean floor (65% of the elevation map, all
exactly the baseline value) sits at the *exact same radius* as the sea
sphere's own baseline, this is a textbook exact depth-tie — the renderer
alternates which of the two coincident surfaces wins the depth test per
triangle, producing a flickering checkerboard/diamond pattern across the
whole ocean (confirmed with screenshots; also confirmed with the sea
material forced fully opaque that it's genuine z-fighting, not a
transparency/blending artifact). Tried and rejected purely as a rendering
trick first: `polygonOffset` on the sea material alone. A small value
(-1) did nothing visible; a large enough value to clear the checkerboard
(-8) also started incorrectly hiding real dry land behind the sea sphere
(confirmed with a screenshot showing blotchy fake "flooding" of interior
South America with no relation to any real elevation threshold) — a
polygon offset nudges the *entire* sea sphere's depth values uniformly, so
a value big enough to win the exact-tie battle over open ocean also wins
against nearby coastal land that isn't actually submerged. Also tried
tightening the camera's near/far planes, on the theory that a needlessly
wide depth range was starving precision where it mattered — measured no
effect at all on the checkerboard (confirmed via an unchanged screenshot
before/after), and see the camera-frustum gotcha below for a real
regression this introduced. The actual fix is geometric, not a rendering
hack: `applyElevation()` now takes the sea-level baseline height as a
parameter and subtracts a small real amount (`OCEAN_FLOOR_EXTRA_DIP`) from
any vertex whose elevation is at or below that baseline, genuinely
separating true ocean-floor geometry from the sea sphere rather than
relying on depth-buffer trickery. This only ever touches vertices already
confirmed to be true ocean floor, never a coastal/land vertex, so — unlike
`polygonOffset` — there's no land nearby for it to accidentally eat even
at a larger magnitude. The magnitude itself was found empirically:
0.001 was tried first and screenshotted — checkerboard still fully
visible, no better than no dip at all. Tested a range up to 0.01,
screenshotting each; 0.003 was the smallest value that came back
completely clean, and larger values looked identical (no land-encroachment
downside to erring larger, given the above). A small `polygonOffset`
(-1/-1) is kept on the sea material as a cheap secondary safety net for
near-miss cases the exact-tie dip doesn't cover (e.g. a pole ring's
*averaged* height landing very close to, but not exactly at, the
baseline) — it no longer needs to be large enough to fix the checkerboard
by itself.

**A real regression caught by the test suite, not by eye, while chasing
the above**: tightening the camera's near plane from V0.1-V0.4's `0.1` to
`0.5` (as part of the near/far tightening attempt above) broke close-up
zoom entirely — at `MIN_DISTANCE = 1.3`, the camera can sit as little as
~0.26 units from the nearest terrain point (a mountain peak reaching
radius ~1.04), which is *closer than* a 0.5 near plane, so the globe's
entire near-facing surface was silently clipped away, rendering solid
black. Caught via a screenshot at a close zoom level that came back
completely black instead of showing the expected close-up terrain — not
something that would have been obvious from the wide default view alone,
which still rendered fine. Reverted the near plane to the original `0.1`
(comfortably below that ~0.26 minimum gap); kept the far-plane tightening
(100 → 20) since it's harmless and still comfortably beyond
`MAX_DISTANCE = 8`. **Lesson for future camera-frustum tuning**: always
re-test at both the widest *and* closest zoom levels the app allows, not
just the default view — a near/far change that looks fine by default can
silently break only at one extreme of the zoom range.

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

## Future sea-level design (V0.5, implemented — see "V0.5: sea-level
control" above)

Per the user's explicit direction: model **land terrain** and **the ocean
surface** as two separate objects (e.g. two separate meshes/spheres, land
relief on one and a simple sea-level sphere on the other) rather than one
combined terrain+water surface, so that raising "sea level" is just moving
or resizing the ocean sphere relative to the fixed land terrain — not
re-baking terrain data. This was the original design note (written back in
V0.1, before there was any terrain or ocean concept yet) and V0.5 followed
it as specified: `js/globe3d.js`'s land mesh and sea sphere are two
independent `THREE.Mesh` objects, and `setSeaLevel()` only ever touches the
sea sphere's `scale`, never the land geometry's vertex positions.

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
phone, as always. **The user then reported the lit globe was too dark to
read the new relief clearly on-phone** (poles unaffected — those were
separately confirmed as improved and acceptable).

For the brightness fix: measured actual rendered pixel brightness
directly rather than guessing — swapped in a flat `MeshBasicMaterial` to
get the old unlit baseline's average luminance (~34/255), then rendered
the lit scene at several `DirectionalLight`/`AmbientLight` intensity
combinations and measured each one's average luminance the same way,
picking the pair (3.0/2.0) that landed brighter than the unlit baseline.
Re-ran the full V0.4 verification suite (pole coincidence, elevation
sanity, scene contents, toggle regression) after the intensity change to
confirm nothing else broke — all passed unchanged.

For V0.5 (forest brightness + sea-level control, bundled together per the
user's own request): same vendor-locally-and-drive-with-Playwright method.
Verified: the gamma-corrected texture's forest/desert pixel colors match
the measured before/after values quoted above; the sea-level baseline
radius falls in the expected land-radius range and the sea sphere's scale
actually changes in response to the slider; the sea-level control's
`hidden` attribute correctly tracks 2D/3D mode; the pole-coincidence
regression (zero spread across every north/south ring vertex) still holds
after the elevation-function signature change. Caught two real bugs this
way, neither visible from reading the code alone:
1. A wiring bug where `applyElevation()` was called before
   `seaLevelBaseHeight` was computed, silently passing `undefined` and
   making the new ocean-floor-dip logic a no-op — caught by tracing the
   actual call order, not by a screenshot (the earlier polygonOffset-only
   safety net masked it just enough that nothing looked obviously broken).
2. The near-plane-clipping regression described above (solid black at
   close zoom) — caught only because the test suite explicitly
   screenshots a close-zoom view, not just the default one.
Took a binary-search series of screenshots (`polygonOffset` at -1/-4/-8,
an opaque-vs-transparent comparison, `OCEAN_FLOOR_EXTRA_DIP` at
0.001/0.003/0.006/0.01) to find the z-fighting fix and its calibrated
magnitude empirically rather than guessing once — see "V0.5: sea-level
control" above for what each attempt showed. Final visual confirmation:
screenshots of a wide coastal view (clean ocean, no checkerboard, visibly
brighter forests) and a known low-lying river delta at slider 0 vs. 100
(a modest, believable advance of the waterline, not a catastrophic
flood). Real visual appearance and on-device touch/slider feel still need
the user's phone, as always.

**The user then reported the sea-level slider had no visible effect** —
"dark shadow-like patches expand/shrink, not a real coastline change" —
despite the sandbox's own screenshots looking fine. Since this session
has no way to reproduce the user's actual device rendering, the
diagnostic method here shifted to analyzing the user's own screenshots
directly: they sent two photos (slider at 0 and 100, same view), which
looked visually identical at a glance. Ran `PIL.ImageChops.difference` on
the two images and binned the result into a coarse grid to visualize
where they differed — the diff traced the exact coastline shape visible
in the photos, confirming the underlying geometry genuinely was changing
in the right place, just far too subtly (the `3/255` calibration's
~0.0007 radius delta is under one screen pixel) to read as "water rising"
rather than noise. This is what led to the third `SEA_LEVEL_MAX_RISE_HEIGHT`
recalibration documented above (10/255) — re-verified with fresh
screenshots at both a South America catastrophe-check view and a
moderate-zoom coastal view matching the user's own framing before
shipping the new value. **This second attempt also still needs the
user's on-phone confirmation** before being considered settled.

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
