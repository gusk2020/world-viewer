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
- **V0.6 (current)**: real global terrain. The user redirected here rather
  than starting on cities/borders: "地形データの方針を変更してください"
  — Blue Marble goes back to being *surface imagery only*, and the 3D
  shape comes from **GEBCO_2026** (land + seafloor in one dataset, both
  poles included). Their hard requirement: polar streaks/holes are the
  most important test, and if a lat/lon grid crowding vertices at the
  poles is the cause, fix the *mesh*, not the data ("データの平滑化で
  ごまかさず、球体メッシュや極域の生成方法そのものを修正してください").
  Also: never make the user download/convert multi-GB files — they only
  have a Pixel 7a — so the data pipeline runs on GitHub Actions. See
  "V0.6: GEBCO_2026 terrain on a cube-sphere" below.
- **V0.7 (current, done — needs the user's Pixel 7a confirmation)**: Mars
  and the Moon alongside Earth, switchable in-app. Real global DEMs (MOLA
  and LOLA), height-based colouring instead of imagery, and a **virtual**
  sea on each. The user's framing: this is not a claim that Mars or the
  Moon have oceans, it is "if there were liquid up to this height, where
  would the coast be" — so the UI says so in as many words. See "V0.7:
  Mars and the Moon" below.
- **V0.7.1 (current, done — needs the user's Pixel 7a confirmation)**: an
  axial-tilt control and a latitude/longitude graticule with a scale bar,
  on all three bodies. See "V0.7.1: axial tilt and the graticule" below.
- **V0.8 stage 1 (current, done — needs the user's Pixel 7a confirmation)**:
  a small climate model that paints a plausible-looking surface from a few
  conditions. Nine stages were specified; this is stage 1 only, and the
  user asked for a report and a pause at each. See "V0.8: the climate
  colouring" below.
- **V0.9+**: cities, borders/territories, historical eras, and other
  過速世界-specific data. Several distinct features, not one version —
  treat each as its own sub-version. **Needs the user's own world-setting
  data first** (city names/locations, territory/border shapes, era
  definitions): that is 過速世界 content, not a technical judgment call,
  so ask rather than inventing placeholder cities the way placeholder
  Earth imagery was used for the globe texture.
- **Deferred by the user, do not build yet**: REMA 10 m (Antarctic) and
  ArcticDEM 10 m (Arctic) as zoomed-in polar detail. Explicitly "今は
  実装しないでください" — GEBCO alone first.

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

### Where things live

Split by role after V0.6, so that adding a body or a data source touches
one file rather than all of one. Every file is plain ES modules loaded
straight by the browser — still no bundler and no build step.

| File | Role |
| --- | --- |
| `js/main.js` | Loads the world config, wires the on-screen controls, owns the 3D/2D toggle. |
| `js/globe3d.js` | The 3D view: scene, camera, lighting, touch controls, terrain mesh, sea sphere. `initGlobe3D(containerId, worldConfig)` → `getView`/`setView`/`setSeaLevel`/`setWaterOpacity`/`setSeabedStyle`. |
| `js/cubeSphere.js` | The mesh, and nothing else. `buildCubeSphere(segments, { radiusAt })` — pure geometry, no idea what a planet or an elevation raster is. Both the terrain and the sea surface come from it. |
| `js/elevation.js` | The height raster: decoding, level picking, bilinear sampling. The mesh and the seabed colouring sample through the *same* function here, which is what keeps them from disagreeing about where the coastline is. |
| `js/surface.js` | The colour texture: the load-time gamma lift and polar low-pass, plus repainting the seabed by depth. Plain pixel buffers — no three.js. |
| `js/map2d.js` | The OpenLayers 2D map. |
| `js/geoConvert.js` | lng/lat ↔ 3D direction, and the approximate 3D-distance ↔ 2D-zoom correspondence. |

**Anything specific to the body being drawn lives in the world's
`config.json`, not in the code** — its radius, the relief exaggeration, the
photo's gamma, how deep the seabed ramp runs. That split exists so the Moon
or Mars can be added as data (see "World-data structure" below); it is not
a plugin system, and nothing should be generalised further until a second
body actually needs it. `js/globe3d.js` throws if one of those numbers is
missing rather than letting a `NaN` propagate into vertex positions and
render a silent black screen.

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
- **The globe**: a **spherified cube** built in `js/cubeSphere.js`
  (`buildCubeSphere`), radius 1, 6 faces × 255² quads ≈ 393k
  vertices / 780k triangles, with a `THREE.MeshLambertMaterial` (switched
  from V0.1-V0.3's unlit `MeshBasicMaterial` in V0.4, once there was real
  geometry variation for a light to reveal — relief is only visible
  through shading). **`THREE.SphereGeometry` was removed in V0.6** — see
  "V0.6: GEBCO_2026 terrain on a cube-sphere" below for why a UV sphere
  could never render the poles cleanly, no matter what was done to the
  data.
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

**Historical — none of this code exists any more.** V0.6 replaced the bump
map with GEBCO metres and the UV sphere with a cube-sphere, so
`applyElevation()`, `loadElevationSamples()`, `DISPLACEMENT_SCALE`,
`DISPLACEMENT_BIAS`, `elevation.jpg` and the pole-ring averaging are all
gone. Kept because the *lessons* still apply (measure rendered brightness
rather than adjusting by feel; isolate an artifact by removing one input at
a time) and because it records what was already tried. For how the globe
actually works now, read "V0.6" and "Where things live".

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

**Historical — the calibration below is entirely retired.** With real GEBCO
metres, sea level is exactly radius 1 and the slider reads in real metres,
so `SEA_LEVEL_MAX_RISE_HEIGHT`, `OCEAN_AREA_FRACTION`,
`seaLevelBaseHeightValue()` and `OCEAN_FLOOR_EXTRA_DIP` are all gone along
with the three-wrong-constants saga that produced them. Kept for the method
(check what the data actually encodes before modelling it; a correctly
calibrated but invisible control is worth nothing) and because the
land/sea two-object design it established is still exactly how this works.

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

### V0.6: GEBCO_2026 terrain on a cube-sphere

Three things changed together, because none of them works without the
others: the data source, the mesh, and where the data gets prepared.

**The data: GEBCO_2026, ice-surface version.** 15 arc-second global grid
(86400×43200, Int16 metres, EPSG:4326), land elevation *and* ocean
bathymetry in one continuous dataset, full coverage including both poles.
Fetched from CEDA at
`https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2026/ice_surface_elevation/netcdf/GEBCO_2026.nc`
(7.47 GB). This finally answers the question the "Investigated and
rejected" section below could not: every WebGL-globe bump map that project
tried encoded a *flat zero* for the entire ocean. GEBCO does not — it is
the actual reference bathymetry dataset.

There is also a `sub_ice_topography_bathymetry/` variant (bedrock under
Greenland/Antarctic ice) in the same directory, and a
`type_identifier_grid/`. The user asked for ice-surface first; swapping is
a one-line change to `SOURCE_URL` in the workflow.

**Blue Marble is now imagery only.** Per the user's explicit redirection,
the colour texture no longer has anything to do with the 3D shape. That
retires the old `elevation.jpg` bump map entirely (deleted).

**The globe texture is now `earth_day_4096.jpg`** (4096×2048, ~460 KB,
still from `mrdoob/three.js`'s examples, so the same licensing story as
the 2048 one it replaces). Adopted after the user reported that terrain
"didn't look any more detailed": a resolution sweep showed **511 segments
looked identical to 255**, because at any zoom the app allows the limiting
factor is the surface photo, not the mesh — 2048×1024 is roughly 20 km per
pixel. Doubling the texture made Japan legible where it had been a purple
smear. Two side effects worth knowing: this texture has **no cloud layer**
(better for a map — you see the actual ground), and its colours run
greener and brighter than the old atmospheric-tinted one, which happens to
suit the user's earlier "brighten the forests" request. Note this texture
was tried and *rejected* before V0.6 for making pole streaks worse; that
was the UV sphere's fault, and it is fine on the cube-sphere.

**Mesh resolution is deliberately staying at 255.** Raising it costs
memory and load time and changes nothing visible while the photo is the
bottleneck. The next real step for close-up detail is per-region imagery
tiles, not more triangles.

**The mesh: why the UV sphere had to go.** `THREE.SphereGeometry` is a
lat/lon grid, which has a genuine mathematical singularity at each pole:
every vertex of the top and bottom ring occupies the *same 3D point* while
carrying different longitudes, and the rings just below are crushed
together circumferentially while staying full-width in texture space. That
produces a fan of sliver triangles at each pole, each smearing a different
column of the map across a wedge, and each sampling wildly different
elevation values from points that are metres apart in 3D. **That is the
real, structural cause of every "radial streak" round this project has
fought** — V0.4 misdiagnosed it as purely a colour-texture sampling
artifact, then a later round proved elevation data mattered too, and both
"fixes" were really just data smoothing hiding a mesh defect. The user
called this correctly and told us to fix the mesh.

A spherified cube has no pole at all. Six ordinary square grids, each
point pushed out to the sphere; quads stay roughly the same size
everywhere; no vertex is shared by a whole ring; and the poles land in the
middle of an ordinary quad on the +Y/-Y faces, receiving **no special
casing whatsoever**. Details worth knowing:

- **`warpAxis` (tangent warp)**: plain normalisation of an evenly spaced
  cube grid bunches vertices toward face corners. Running each axis
  through `tan(t·π/4)` first spreads them almost evenly, which is the
  entire reason for choosing a cube-sphere over just accepting a UV
  sphere's distortion.
- **`FACE_SEGMENTS` is odd (255) on purpose.** With an even count a vertex
  would land exactly on the centre of the +Y/-Y face — exactly on a pole,
  the one place where longitude is undefined. Odd puts the pole mid-quad,
  so every vertex has a well-defined longitude and UV. Keep it odd.
- **`CUBE_FACES` bases are chosen so `right × up === forward` on all
  six**, which is what lets a single winding order come out front-facing
  everywhere with no per-face special cases. Verified numerically, not
  assumed: the test asserts every sampled vertex normal has a positive dot
  product with its own position (i.e. the globe is not inside-out).
- **Antimeridian seam**: a triangle straddling ±180° has corners at
  u≈0.99 and u≈0.01, so interpolating runs the texture backwards across
  the whole map in one triangle. `splitSeamVertices` gives those corners a
  private copy carrying `u + 1` (hence `texture.wrapS = RepeatWrapping`).
  Only ~514 vertices along one meridian are affected. **Normals are
  computed before the split** so duplicates inherit an identical normal
  and the seam shows no lighting break — getting that order wrong would
  put a visible lit stripe down the Pacific.
- **Cube edges are duplicated by construction** (each of the 12 edges is
  generated once per adjoining face — the test counts ~3578 coincident
  vertices, which is expected, not a bug). They sit at identical positions
  with identical elevations so there is no crack; their normals are
  computed per-face and could in principle differ, but the surface is
  smooth there and no edge seam is visible in renders. If a future change
  ever does show cube-edge lighting seams, that is the place to look.

**The one artifact that survived the mesh change, and why smoothing the
*texture* is legitimate here.** After the cube-sphere landed, a faint soft
radial smear was still visible looking straight down a pole. Isolated it
the same way this project always does — rendered the pole with the colour
texture removed entirely — and the surface came back perfectly smooth,
proving the mesh was blameless and the photo was the whole cause. An
equirectangular image gives every latitude the same pixel width while the
circle it wraps shrinks by cos(latitude), so near a pole it carries about
1/cos(lat) times more longitudinal detail than the globe can physically
hold; that surplus is what smears. `lowPassPolarRows` averages each row
over a 1/cos(lat)-wide circular window, which discards exactly the
information that was never really there. **This is not the "smooth the
data to hide it" move the user rightly rejected** — that would have been
smoothing *terrain* to mask a mesh defect. Here the mesh is provably
correct and the filtering is ordinary anti-aliasing of an oversampled
projection. A circular running sum keeps it O(width) per row, which
matters because the window spans most of the image in the last row or two.

**The sea surface must be a cube-sphere too — this was a real bug.**
It was first built as `THREE.SphereGeometry(1, 128, 64)`, and the user
reported dark scalloped blobs across every shallow sea, with the
sea-level slider seeming to shrink those blobs rather than flood land.
Reproduced and measured here: a sphere mesh is a polyhedron, and each flat
facet sags below the true radius by roughly θ²/8 — at 128 segments that is
3.0×10⁻⁴ radius units, which against 30× exaggerated relief is
**64 metres of equivalent elevation error**. So anywhere the seabed lay
within ~64 m of sea level it poked up through the middle of each facet,
one blob per facet. Rebuilding the sea from `buildCubeSphere` at
`FACE_SEGMENTS` drops that to about 1 m, below the slider's own step, and
the blobs vanish entirely. **Lesson: any surface being compared against
terrain at metre scale needs tessellation error smaller than the
comparison, and `SphereGeometry`'s default resolutions are nowhere near
it.** The sea geometry carries no UVs (no texture), so it costs little.

**The light follows the camera, and that is a deliberate cartographic
choice.** It was originally pinned at `(5, 3, 5)`, which works out to
overhead at **45°W 23°N — the mid-Atlantic**. So the Atlantic seafloor
looked superb and the Pacific, its antipode, got ambient light only.
Ambient light has *no direction*, therefore produces *no shading*, so
relief there was not merely dark but genuinely flat. The user spotted it
from the phone and guessed the cause correctly ("大西洋の海底地形は見え
ますが太平洋は暗くて見にくいです。光の当て方ですか？").

`updateSunLight()` now places the light relative to the camera each frame.
Two details matter:

- **The offset (`LIGHT_OFFSET_RADIANS`, 38°) is the whole point.** A light
  aimed straight down the view axis is a headlamp: surfaces facing the
  camera and surfaces tilted away receive nearly the same illumination, so
  everything flattens out. Tilting it up-and-left preserves a raking angle
  at every view — the same reason relief maps are conventionally lit from
  the upper left.
- Near the poles the view direction is parallel to +Y, so the reference
  vector used for the cross products swaps to +Z to stay well conditioned.
  Verified: the light-to-camera dot product is 0.788 (= cos 38°) at every
  view tested including both poles.

Measured, not eyeballed — std-dev of luminance over open-water pixels,
which distinguishes "dark" from "flat" in a way mean brightness cannot:
Pacific contrast **4.67 → 11.44** (2.4×) and mean 81.9 → 112.7, while the
Atlantic *also* improved (8.35 → 13.2) because a raking light reveals more
than the old near-overhead one did. Screenshots confirm the
Hawaiian-Emperor seamount chain, fracture zones and trench arcs are now
plainly visible where the Pacific had been featureless.

There is no day/night feature that a fixed sun would serve, so nothing is
lost. **If one is ever added, this is the trade-off to revisit** — a real
sun and readable relief everywhere are mutually exclusive without a
separate shading pass.

**One testing gotcha this re-surfaced**: `updateSunLight()` runs inside the
animation loop, so reading the light back in the same task as `setView()`
returns the *previous* frame's value and looks exactly like a broken
feature. Let a frame tick first. (And per the standing note above, canvas
readback must render in the same synchronous task, or the buffer is
already cleared and every sampled pixel comes back empty.)

**Draining the water needed a repainted seabed, not just a hidden sea.**
The user asked to take the water below 0% and see the seabed in earth
colours. Turning the sea sphere off alone can never do that: **the blue of
the seabed lives in the satellite photograph, not in the water.** So
`setSeabedStyle()` repaints every pixel below 0 m from a depth ramp,
leaving land as photographed. Four options — `photo` (default, the
untouched image), `brown`, `grey`, `land` — chosen by the user, who asked
for all three ramps switchable rather than one.

- **Only the colour is invented; the shape and shading stay real GEBCO.**
  There is no photograph of the seabed to be faithful to, so a depth ramp
  is the honest option. Worth keeping straight given this project's
  "real data over looks" line.
- **Rebuilt on demand, not pre-baked.** Three ready-made 4096×2048
  textures would be >100 MB of image data on a phone. One spare buffer
  plus a repaint is far cheaper. Measured in-page: ~265 ms per repaint
  (~500 ms on the first, which allocates the buffer), so roughly 0.5-0.8 s
  on a Pixel 7a. `main.js` defers the call by one animation frame so the
  button's pressed state paints before the work blocks the thread.
- **Independent of sea level by design**, so dragging that slider never
  triggers a repaint — the sea sphere covers whatever is currently
  submerged, over a seabed that is already coloured by its own depth.
- **Bilinear depth sampling earns its cost; the fade that shipped beside
  it did not.** The colour texture is finer than the elevation grid, so
  nearest-neighbour painted the grid's ~20 km cells as visible staircase
  blocks along every drained coastline (seen clearly at −120 m over the
  Sunda shelf). Bilinear sampling fixed that by putting the 0 m contour
  between cells. **A `SEABED_FADE_M = 60` blend back toward the photograph
  shipped in the same change and was wrongly credited with the same fix.**
  It did nothing for the staircase and actively caused a bug: the photo's
  shallow water is bright cyan, so blending toward it painted a blue rim
  hugging every drained coastline — which the user then reported, asking
  whether better data was needed. It wasn't; the fade was removed and the
  rim went with it (blue-dominant pixels over a drained East Asia shelf:
  43% → 32%, staircase still absent, pass slightly cheaper at ~215 ms).
  **Never blend the seabed back toward the photograph** — the photo's
  water colour is exactly what this feature exists to replace.
  The wider lesson: two changes went in together and both got the credit,
  which hid a regression for a whole round. Isolate them next time.
- **`SEABED_DEEPEST_M` is 8000, not the real 10.9 km maximum.** Trenches
  that deep are vanishingly rare; stretching the ramp to reach them wastes
  most of its range on depths almost nowhere on Earth and flattens the
  abyssal plains and continental slopes where the shape actually is.
- **What was left after the fade came out was a two-dataset disagreement,
  not a resolution shortfall — and that was measured before anything was
  built.** The user reported the rim "かなりマシになりました" but still
  saw scattered blue specks along drained coasts, and asked the obvious
  question: does this need better or different map data? No. GEBCO's 0 m
  contour and the satellite photograph's own coastline disagree by about
  one texture pixel, and each disagreement stranded a speck of leftover
  sea colour on the drained shore. Repainting from the committed
  4096×2048 elevation level instead of 2048×1024 removed only **4%** of
  those specks (118,259 → 113,142 pixels globally), which settles it:
  doubling the elevation resolution buys nothing here, and the 10.9 MB
  download it would have cost the phone was not worth spending.
  `growSeabedOverWater` fixes it instead — a pixel the grid calls dry but
  the *photograph* plainly shows as open water gets the ramp's shallowest
  colour. Two guards, both calibrated from the real texture rather than
  guessed:
  - **A blue *ratio*, not a blue difference** (`WATER_BLUE_RATIO = 0.3`,
    `(B−R)/B`). Sampled across the actual image, open water sits at
    0.55–0.76 and snow/ice at 0.00–0.09, with every land cover negative —
    an enormous margin, and the reason the ice caps come through
    untouched. A plain `B−R > 15` test does not separate them: it flags
    118k pixels of which most are Antarctic and Greenland ice.
  - **Bounded growth outward from genuinely submerged pixels**
    (`SEABED_RIM_PASSES = 3`). Unbounded, the flood reaches the Great
    Lakes through the St. Lawrence and drains them; three steps captures
    91% of the specks and goes nowhere near them. Note the lakes'
    *deepest* parts were already painted before this change and still are,
    because GEBCO genuinely puts Lake Superior's bed below sea level —
    pre-existing, unrelated, and left alone.
  Measured in rendered frames at −120 m with the water hidden (blue-
  dominant pixels): Japan **1.29% → 0.19%**, the Sunda shelf 1.27% →
  0.17%, Australia 0.43% → 0.11%, Greenland's fjords 1.16% → 0.80%,
  Antarctica 0.50% → 0.48% (i.e. untouched, as intended), and the Baltic
  3.46% → 2.42% — the remainder there being Vänern, Ladoga and the Finnish
  lakes, which are lakes and should stay blue.
- **The paint pass is now split into a cached plan and a cheap repaint.**
  Which pixel gets which ramp step depends only on the elevation grid and
  the photo, never on the chosen colour, so `buildSeabedPlan` works it out
  once into one byte per texture pixel (0 = leave the photograph alone,
  otherwise ramp index + 1; the index is clamped to 254 so 0 can mean
  "unpainted", and the two deepest steps differ by well under one RGB
  unit). Style switches after the first cost **~60 ms instead of ~215 ms**,
  measured in-page; the first is ~660 ms because it also allocates the
  spare buffer and runs the rim passes. This is a pure refactor with no
  visual effect — it was measured separately from the rim fix on purpose,
  per the lesson above about two changes sharing one round's credit.

**Sea level runs both ways, on an asymmetric scale** (−6000 m to +200 m).
`radiusForMetres` already handled negatives, so going below zero was a
slider range and a readout that signs itself. The scale is the part worth
knowing: the user asked for 2 m steps upward and 20 m steps downward, and
an `<input type="range">` has exactly one `step`, so the slider carries
**steps, not metres** and `seaLevelMetres()` in `main.js` multiplies by
`SEA_LEVEL_STEP_UP_M` (2) or `SEA_LEVEL_STEP_DOWN_M` (20) depending on the
sign. That is 300 steps down against 100 up, so present-day sea level sits
three quarters of the way along the track rather than in the middle — the
range in `index.html` has to match those two constants. The asymmetry
matches the subject: upward, every interesting number is close together
(melting every ice sheet is about +65 m), while downward the shelf edge is
around −2000 m and the abyssal plains near −6000 m. Measured from the
committed raster, land as a fraction of the globe: **99.3% at −6000 m** (only
the trenches still hold water), 40.4% at −2000 m, **33.3% at −120 m** (the
last glacial maximum, exposing the Sunda shelf, the North Sea and the
Bering land bridge), 29.1% today, 21.0% at +200 m. Note the descent and the
repainted seabed are coupled — lowering sea level without one just exposes
blue photograph, which is why they were built in that order.

**Water opacity is a user control now** (`setWaterOpacity`, second slider,
default 40%). There is no single right value — opaque water reads better
as "flooded", transparent water shows the GEBCO seafloor — so after the
user asked to adjust it themselves, it stopped being a constant to tune
here.

**Elevation is real metres now, and that fixes sea level properly.**
The raster stores metres, so sea level is exactly radius 1 and the slider
reads in real metres instead of an opaque 0-100. `VERTICAL_EXAGGERATION`
(30×) is applied *identically* to terrain and to the sea sphere, so
submerged ⟺ `height < sea level` regardless of the exaggeration factor —
**which coastline floods is geographically exact even though the relief is
visually exaggerated**. That retires the entire V0.5 calibration saga
(three wrong constants derived from a bump map's histogram); none of that
reasoning applies any more and the constants are gone. The
`OCEAN_FLOOR_EXTRA_DIP` z-fighting hack is gone too: with real bathymetry
the seafloor is genuinely kilometres below sea level, so the exact depth
tie that caused the checkerboard cannot occur.

**The encoding, and one gotcha worth remembering.** Elevation ships as a
PNG where `metres = (R × 256 + G) − offsetMetres` (offset 12000, so the
whole real range of Earth's relief stays inside a uint16). Two 8-bit
channels rather than a 16-bit greyscale PNG because **a canvas hands
JavaScript back 8-bit samples no matter what the file contained** — a
genuine 16-bit greyscale PNG would silently lose its low byte on read,
producing plausible-looking wrong elevations. PNG rather than JPEG because
the packing is only meaningful if every byte survives exactly. The
encoding parameters live in the world's `config.json`, not in the code.

**The pipeline: `.github/workflows/build-terrain.yml`.** The user cannot
be asked to handle a 7.5 GB file on a phone, and this sandbox's egress
proxy blocks every geodata host, so the work happens on a GitHub runner:
download → area-average downsample → encode → commit only the small PNGs.
Notes:

- **`-r average`, never point decimation.** Picking every Nth cell of a
  heightmap drops peaks and trenches outright; averaging keeps each output
  cell representative of the ground it covers. This matters for a dataset
  whose whole point is being real.
- One expensive read produces a 4096×2048 base level; the smaller levels
  are averaged down from *that*, not by re-reading 7.5 GB per level.
- CEDA serves roughly 5 MB/s on one connection, so the download uses
  `aria2c -x 12` with a curl fallback. Expect the whole run to take on the
  order of half an hour, nearly all of it waiting on CEDA.
- `tools/verify_elevation.py` runs before the commit step and **fails the
  build** if the result is not real global terrain: it samples Everest,
  the Mariana Trench, the Sahara, mid-Pacific abyssal plain and both
  poles, checks the below-sea-level fraction is Earth-like (55-80%),
  requires real trenches and mountains, and requires both pole rows to
  vary rather than be a constant fill. Given this project's history of
  adopting sources that turned out to be flat-ocean fakes, that check
  earns its keep.
- **The repo now has CI, but the *app* still has no build step.** GitHub
  Pages continues to serve plain static files; the workflow is a data
  preparation tool that happens to commit its output. Don't let this
  become a build step for the site itself.

**Levels and "load only what's needed".** The pipeline emits 512×256,
1024×512, 2048×1024 and 4096×2048. `pickElevationLevel` takes the finest
level that is still worth its bytes: the mesh has ~4×`FACE_SEGMENTS`
vertices around the equator, so a grid wider than about twice that carries
detail no vertex can express. Today that selects 2048×1024. Worth being
honest about the scope here: with `MIN_DISTANCE = 1.3` the camera never
gets closer than ~1900 km altitude, where the phone screen shows roughly
8 km per pixel — so **one global level already saturates what can be seen
at any allowed zoom**, and region-by-region streaming would currently buy
nothing. The wider levels exist for when that changes; genuine
view-dependent tile streaming is the thing to build when the deferred
REMA/ArcticDEM 10 m polar data arrives and the zoom limit opens up.

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

## Investigated and rejected: higher-resolution elevation/color textures, real bathymetry

**Superseded by V0.6 — read this only for the "what was already tried"
list, not for conclusions.** The blocker recorded below (no reachable real
bathymetry) was solved by moving the fetch to GitHub Actions and using
GEBCO_2026; the pole artifacts blamed on texture/elevation *data* here
turned out to be the UV sphere's polar singularity, fixed by changing the
mesh. Both are covered in "V0.6: GEBCO_2026 terrain on a cube-sphere".

After V0.5 shipped, the user asked to improve "地形の高さデータと地球の見た目、
海面下の海底地形" (elevation data resolution, the globe's visual quality, and
real seafloor/bathymetry terrain) before moving on to V0.6. Investigated all
three; none shipped this round.

- **Real bathymetry**: this sandbox's own egress policy blocks every
  dedicated geo-data host tried — `eoimages.gsfc.nasa.gov`,
  `visibleearth.nasa.gov`, `gebco.net`, `opentopography.org`,
  `topex.ucsd.edu`, `commons.wikimedia.org` all returned a proxy-level
  403/connect-rejected, not a real-world "file doesn't exist." Also
  checked whether any popular WebGL-globe GitHub repo happens to bundle a
  real combined topography+bathymetry raster directly (reachable via
  `raw.githubusercontent.com`, which does work from here) — checked
  `mrdoob/three.js`'s own bundled bump maps, `vasturiano/three-globe`'s
  `earth-topology.png`, and the classic NASA "world.topo.bathy" file (only
  its md5 checksum is committed to `AlbertVeli/heightmap`, sourced from
  the same blocked NASA host at fetch time) — every one of these had
  *exactly* 0 for every ocean pixel sampled (mid-Pacific, Mariana Trench,
  mid-Atlantic Ridge), meaning none of them actually encode bathymetry at
  all despite some file names suggesting otherwise; they're all derived
  from the same land-only bump map lineage. Asked the user whether they
  could download a real topo+bathy file from their own phone (which has
  normal internet, unlike this sandbox) and send it here — they found
  that too difficult to attempt right now, so this is parked. If revisited:
  the concrete, verified-reachable-by-a-human-on-a-phone target is NASA
  Visible Earth's "Blue Marble Next Generation w/ Topography and
  Bathymetry" series (e.g. `visibleearth.nasa.gov/images/73909/...`),
  which does offer a plain one-tap JPEG download at a few resolutions —
  the user (or a future session with different network access) would
  need to download it and get the file into this repo some other way,
  since this sandbox cannot fetch it directly.
- **Higher-resolution color texture**: found `earth_day_4096.jpg` in
  `mrdoob/three.js`'s own examples (4096×2048, double the current
  `earth_atmos_2048.jpg`'s resolution, similar file size ~460KB, poles
  confirmed white/near-white not black). Swapping it in made the
  already-known, already-accepted V0.4 pole-streak cosmetic artifact
  **dramatically** worse — a sharp, high-contrast pinwheel pattern, not
  the faint one the user had already signed off on. Tried the standard
  real fix (`texture.anisotropy = renderer.capabilities.getMaxAnisotropy()`)
  and it made no visible difference (possibly a swiftshader software-
  renderer limitation, per this project's standing caveat about
  swiftshader not perfectly replicating real GPU filtering behavior).
  Reverted to the original `earth_atmos_2048.jpg` rather than ship a
  visibly worse pole artifact — confirmed via a fresh pole screenshot
  that this fully restored the original mild streak level.
- **Higher-resolution elevation data**: extracted the bump/height channel
  from `mrdoob/three.js`'s `earth_bump_roughness_clouds_4096.jpg` (R
  channel, resized to 2048×1024 — double the current `elevation.jpg`'s
  1000×500). This one made the pole-streak artifact dramatically worse
  too, but confirmed via a clean isolated test (reverted the color
  texture back to original, kept only the new elevation data, re-tested)
  that **this time the elevation data itself, not the color texture, was
  the cause** — a genuinely different mechanism than the color-texture-
  sampling artifact V0.4 originally diagnosed. Confirmed by direct pixel
  inspection: the current `elevation.jpg`'s near-pole rows are *exactly*
  0 with zero variance (Arctic Ocean, legitimately flat in that dataset),
  while the new source's near-pole rows have small but real variance
  (0-10 out of 255) — genuine fine terrain/noise detail close to the
  pole that the old data simply didn't have. That small per-vertex
  variance, at the extreme circumferential compression near a UV-sphere's
  pole, creates dramatic lighting-based streaks (the near-pole vertices
  are physically tiny distances apart in 3D space but sample wildly
  different U/longitude columns of source data). Tried flattening a
  ~5°-latitude band near each pole in the source image to a single
  averaged value (same technique `applyElevation()` already uses for the
  exact pole ring itself, just widened) — this fixed the innermost ring
  cleanly (confirmed via screenshot: a clean flat disc right at the
  pole) but streaks still radiated from just outside that band, meaning
  the real noise extends further than 5° in this dataset. Did not keep
  pushing the flattened band wider, since that starts trading away real
  data for an ever-larger fake-flat region, working against this
  project's core "real data over convenience" value — reverted to the
  original elevation data instead of shipping either a pole regression or
  an increasingly artificial flattened cap.
- **Net result at the time**: no texture/data files changed that round.
  **Both conclusions were later reversed in V0.6, and correctly so.** The
  bathymetry blocker was a *network* problem, solved by moving the fetch to
  GitHub Actions. The near-pole failures blamed on these two textures were
  really the UV sphere's polar singularity: once the mesh had no pole,
  `earth_day_4096.jpg` was retried and adopted as the globe texture with
  clean poles. The lesson to keep is the method (check a candidate's
  near-pole behaviour before adopting it), not the verdict.

## World-data structure (the "common app, swappable data" seam)

Kept deliberately minimal for V0.1 — just enough seam that a second world
means adding a new `worlds/<world-id>/` folder + config, not touching
`js/main.js`. Don't build more of this than the current version needs.

`worlds/<world-id>/config.json` holds `id`, `name`, `globeTexture` (path to
that world's equirectangular surface image), plus three blocks added in
V0.6:

- **`body`** — facts about the world itself. Just `radiusMetres` today.
  This is the block that exists so the Moon and Mars can be added as data:
  it is what turns "metres of elevation" into "fraction of the radius", and
  it is wrong for anything but Earth.
- **`display`** — deliberate drawing choices, not facts:
  `verticalExaggeration` (30×, applied identically to terrain and sea so
  which coastline floods stays exact), `surfaceGamma` (0.6, tuned to *this*
  photograph's dark forests), `seabedDeepestMetres` (8000, where the depth
  ramp bottoms out).
- **`terrain`** — the height raster: its `source`, its `encoding`
  (`rg16-metres` and the `offsetMetres` the pipeline packed it with), and
  the `levels` available. `terrain.encoding.offsetMetres` is the **single
  source of truth** for that number: `tools/elevation_encoding.py` reads it
  so the encoder, the verifier and the browser cannot drift apart. They
  used to each carry their own copy, which would have silently shifted
  every elevation by a fixed amount if one had ever been edited alone.

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

## V0.7: Mars and the Moon

Added without touching how Earth renders. The proof of that is in "How this
was tested": every one of the ten Earth regression screenshots came back
with **zero differing pixels below the control panel**, and every measured
value — geometry, per-vertex radii, seabed plan checksum, sea-sphere scale,
light angle, rendered brightness and contrast — matched exactly. The only
pixels that changed anywhere on Earth are the new 天体 row in the overlay.

Two safe restore points exist on GitHub and must not be deleted or moved:
**`safe-v0.6-working`** (before the cleanup pass) and
**`safe-earth-v0.6-before-planets`** (`70c80bf`, the Earth-only version the
user confirmed on their phone before this work).

### The data, and what the probe run established

The sandbox cannot reach any planetary-data host, so a throwaway
`planet-probe.yml` ran `curl -I` and `gdalinfo /vsicurl/...` from a GitHub
runner — the same trick that established the GEBCO/CEDA layout in V0.6.
Deleted once the real workflow existed. What it found:

| | Mars | Moon |
| --- | --- | --- |
| Product | Mars MGS MOLA DEM global mosaic | LRO LOLA global LDEM, Mar 2014 |
| Source | USGS Astrogeology `planetarymaps.usgs.gov/mosaic/` | same |
| Grid | 46080×23040, 463 m/px, ~2.1 GB | 92160×46080, 118 m/px, **8.49 GB** |
| Datum | the **areoid** — 0 m is Mars's equipotential surface | a **sphere of radius 1737400 m** |
| Encoding | plain Int16 metres | Int16 with **`Scale: 0.5`** |

**The lunar scale factor is the detail that would have gone unnoticed.**
LOLA stores half-metres. Without `gdal_translate -unscale` every lunar
height would be exactly doubled — terrain that still looks completely
plausible, since nobody carries the Moon's relief range in their head. It
is caught in the committed raster's range: **−8819..10567 m**, which matches
LOLA's published extent; un-unscaled it would have read about ±2× that.
`terrain.build.unscale` in the world config drives it.

Mars's own numbers came back right first time: Olympus Mons **19858 m**,
Hellas **−6063 m**, Vastitas Borealis −3848 m, south polar deposits 3910 m.

### The pipeline is now one workflow for any body

`build-terrain.yml` takes a world id and reads everything else from that
world's `config.json`: `terrain.build` (source URL, whether to unscale, the
base size) and `terrain.verify` (that body's own landmarks and the range
each must fall in). Earth's checks moved out of `verify_elevation.py`
unchanged and still pass. `tools/update_levels.py` writes `terrain.levels`
from the PNGs that actually got built, so config and disk cannot disagree.

**The verifier earned its keep immediately, in the way that matters** — it
failed the first Mars build, and the failure was *mine*, not the data's:
the Tharsis ceiling was below the rise's real height, and the Valles
Marineris sample point sits on plateau between the chasmata once cells are
averaged to ~10 km. The lesson is the one this project keeps relearning:
write the check, then believe the data over the check until you have looked.
Landmark ranges are deliberately wide — they prove the raster is that body,
they do not measure it.

### Colouring by height, and why the ramp is a 1-D texture

Mars and the Moon arrive as elevation and nothing else, so `js/hypsometric.js`
tints them the way a physical relief globe is tinted: deep water dark blue,
shallow light blue, coast, lowland, upland, bare rock, snow. The stops live
in each world's `display.hypsometric.stops`, in metres **relative to the
virtual sea**, because Earth's numbers are meaningless on a body whose
relief spans nearly 30 km.

The design point worth keeping: **the ramp is a 1-D texture and each
vertex's height is its `u` coordinate.** Since the scale is defined
relative to the sea, moving the sea is a pure shift along `u` — one
`texture.offset.x` assignment per slider step. Recolouring 8 million
texture pixels, or 400k vertex colours, on every frame of a slider drag
would be hopeless on a phone; this costs nothing, so ground turns green the
instant it drains instead of staying blue. That is the same complaint the
Earth version needed a whole round of work to fix, avoided here by
construction.

It has a second consequence that matters more than it looks: because `u`
carries height rather than longitude, **these worlds need neither the
antimeridian seam split nor the polar low-pass** an equirectangular
photograph forces on Earth. There is no wrapped image to tear and none to
oversample at the poles. Rendered pole close-ups with the sea fully drained
and the water hidden come back clean on both bodies — no streaks, no
pinwheel, no hole — and the antimeridian shows no stripe.

### Per-body settings, all of them data

`body.radiusMetres` is the real radius (Earth 6371000, Mars 3389500, Moon
1737400) and only ever converts metres into a fraction of the globe. **Every
body still draws at radius 1**, so the Moon is exactly as easy to handle on
screen as Earth — the user's "don't let the Moon end up too small to use"
requirement needed no code, only this separation.

`display.verticalExaggeration` is per body and is *not* Earth's 30: Mars and
the Moon have far more relief relative to their size (Mars spans ~29 km on a
3390 km radius), so both use 10. `display.seaLevel` carries each body's own
range and step, Earth's −6000..+200 among them.

### UI

One `天体` row of buttons at the top of the existing panel, and
`worlds/index.json` lists what exists. Earth opens first, as before.
Switching disposes the whole three.js view and rebuilds it —
`initGlobe3D` now returns `dispose()`, and it has to, because three.js frees
neither geometries nor WebGL contexts on its own and a phone has very few
contexts to spare. Verified by switching through all three bodies twice and
confirming exactly one canvas each time, with identical rendering per body
on both rounds.

Controls that only make sense on Earth hide themselves: the seabed-colour
buttons (they repaint a photograph, and these worlds have none) and the 2D
toggle (OpenStreetMap is a map of Earth). Switching away from Earth while
in 2D forces the view back to 3D, so nobody is stranded looking at
OpenStreetMap while the panel says 火星.

**A CSS bug this uncovered**: a `.control-row` set to `display: flex`
outranks the browser's own `[hidden] { display: none }`, so hiding a row
from JavaScript silently did nothing. Fixed with
`#sea-level-control [hidden] { display: none }`.

**A pre-existing instance of the same bug, deliberately left alone**:
`#sea-level-control` itself is `display: flex`, so the panel has been
visible over the 2D map since V0.5 even though `main.js` has always set
`.hidden` on it. Fixing it would change Earth's 2D view, which this task was
explicitly told not to do. Flagged to the user instead — it is a one-line
change whenever they want it.

## V0.7.1: axial tilt and the graticule

Two controls, added to all three bodies at once, with Earth's default state
left pixel-identical: the tilt starts upright (a zero rotation) and the
graticule starts off and is not even built until first used. Verified the
usual way — every measured value matched and **every screenshot was
byte-identical below the control panel**.

### The axial tilt — really a posture button

One button with two positions, and **both of them put the body into the same
reference pose**: equator horizontal, spin axis in the screen's vertical
plane, and lng/lat 0,0 dead centre facing the viewer. They differ only in
whether the axis stands vertical or leans at the body's real obliquity
(`body.axialTiltDegrees`: Earth 23.44°, Mars 25.19°, Moon 6.68°, each
measured against its own orbital plane, the convention that makes Earth's
figure 23.44 rather than 0). The user's own framing: "どんな向きになって
いてもその表示に戻る姿勢リセットボタン".

**It is not a plain toggle, and that distinction is the whole feature.**
"One press returns to the zero pose from any orientation, a second press
tilts from there" only holds if a press that finds the globe dragged away
*snaps it back* rather than advancing to the other state — otherwise the
very first press on a freshly loaded, already-upright globe would tilt it
instead of resetting it, which is the opposite of what was asked for. So
`atZeroPose()` checks both the tilt and that the view is within half a
degree of 0,0, and the press only advances when it is already there.

**Zoom is deliberately not reset.** How far in you are is not part of the
orientation, and discarding a close-up would make the button annoying to
press.

**The recentring happens only on a press, never on load.** The opening view
sits at lng −90 (camera at `(0, 0, 3)`), which the user has already signed
off on; recentring during `loadWorld` would quietly move it. `applyAxis`
takes a `recentre` flag for exactly this.

**The body is tilted, not the camera.** That keeps `OrbitControls`' own up
vector at +Y, so dragging, the polar clamp and the zoom limits all behave
exactly as before. The cost is that lng/lat is now measured in the body's
frame rather than the world's, so `getView`/`setView` apply the group
quaternion and its inverse. At zero tilt both are the identity, which is why
Earth's default view and its 2D toggle are unchanged — and the tilted round
trip is exact, tested at three coordinates including lat 89.

**Which axis it leans about was a real UX decision, not a detail.** The
first version rotated about Z. From the opening view the camera sits on +X,
so the pole leaned straight *at* the camera: the globe genuinely tilted
(Antarctica swung into view) but still looked upright, and the readout
honestly said 0° — so the button appeared to do nothing. Nothing physical
picks one axis over the other; which way a spin axis leans relative to an
arbitrary world direction is meaningless without modelling the orbit too.
Rotating about X instead leans it across the screen, the familiar
globe-on-a-stand pose, and the readout reads 23°/25°/7° the moment it is
pressed. Caught by the test asserting the readout, not by looking.

**The readout is the angle between the spin axis and "up on your screen",
measured in 3D** — and getting there took a correction worth recording.

It began as the angle of the axis *projected* onto the screen. That was
wrong in a way no amount of testing the tilted state would reveal:
OrbitControls keeps its up vector at +Y, so an upright body's axis draws
exactly vertical from every possible camera position, and the projected
angle is pinned at **0 for ever**. Upright is the default, so the live
readout looked simply broken, and the user reported exactly that — "常に0度
のままで動かしても変化しません". The bug had been sitting in front of a
passing test suite the whole time, because every assertion checked the
tilted state, where the projected angle does move.

Measured in 3D (`acos(axis · cameraUp)`) it always responds, because tipping
the axis toward or away from the viewer is a real change even when it still
*draws* vertical. Upright at the equator reads 0°; orbit up to the pole and
it sweeps to 90° as the axis turns to point at you (so in the upright state
it doubles as "how far north or south am I looking"). A tilted body at the
reference pose reads its own obliquity — 23°/25°/7° — so the readout and the
button still agree. It also has no degenerate case left to special-case:
looking straight down the axis is simply 90°.

Orbiting *horizontally* on an upright body still holds at 0°, and that is
geometrically true rather than a leftover of the bug — a vertical axis stays
vertical relative to screen-up however far you spin around it. Any up-down
component in the drag moves the number.

### The graticule

Four states in a cycle, in the order asked for: off → parallels → both →
meridians → off.

**The lines follow the terrain.** Mars's relief spans radius 0.977 to 1.062
once exaggerated, so a constant-radius graticule would hang visibly off the
surface at the limb and sink into every mountain. Each point samples the
same elevation data the mesh uses and is lifted by a small constant;
measured, the lines sit 0.001481–0.001509 above the surface, i.e. they track
the ground to within 3×10⁻⁵ radii.

**Two densities, swapped by camera distance** (30° far, 10° within 2.2
radii). One spacing cannot serve both ends of the zoom range: 30° is right
for the whole globe and nearly empty close in, 10° the reverse. Both are a
few thousand points, so both are built once and the swap is a visibility
flag.

**They are drawn after the sea, and that was a real bug.** The user
reported the graticule fading out above about 50-60% water opacity and
vanishing at 100% — "海の下や地形の下に潜る感じ". Both the sea and the lines
are transparent, so three.js sorts them back to front, and wherever the
seabed lies below sea level the lines are *further* from the camera than the
water: they were painted first and the water covered them. Giving the lines
`renderOrder = 1` fixes it, and it is safe rather than a hack — the sea has
`depthWrite: false`, so the depth buffer holds only the terrain and the
lines still depth-test against it. Lines on the far side of the globe stay
hidden; only the water stops hiding them. A graticule is a map overlay, and
overlays belong on top of what they annotate.

Measured by A/B on that one line, on Mars at the same view: without it,
100% water leaves only **2048** of ~7090 line pixels (just the ones over
land) and 60% water washes the survivors from contrast 29.7 down to 17.3.
With it, all **7090** survive at every opacity, contrast 29.7 → 33.2.

**One methodology note worth keeping**: the first attempt to measure this
scanned for the sharpest luminance edge in a row and reported *no
difference at all* — because over a coastline the sharpest edge is the
coast, not the graticule. The measurement that works renders the same frame
with the lines off and on and diffs the two: whatever changes **is** the
lines. When a probe says "no effect" and the eye says otherwise, suspect the
probe.

**Dark lines, and that was measured rather than assumed.** The luminance
step across a line, against the two hardest backgrounds the app draws: over
the Sahara (the brightest ground, ~224) a white line at 0.42 opacity moves
the pixel by only **14** — effectively invisible, because white on
near-white has nowhere to go — while black at 0.45 moves it by **100**. Over
deep ocean (~124) that same black line gives 35, matching what white managed
there. So dark wins outright: seven times the contrast where white failed
and no loss where white worked. Raising white's opacity does not fix it
(0.7 only reaches 22 on the Sahara while glaring at 54 on the ocean) — the
problem is the colour, not the strength.

### The control panel

Folded to **169 px, 19% of a Pixel 7a's screen, from 252 px / 28%** after
the user said it had grown too big. The axis and graticule controls share
one row (which needed the panel widened from 320 to 368 px to fit), row
height went 36 → 30 px, gaps 4 → 2 px, and the buttons carry their own
short prefixes (`軸 垂直`, `線 緯度+経度`) since a shared row has no space
for a left-hand label. Same height on all three bodies.

### The scale bar

Shown only alongside a graticule, as asked; the two answer the same
question. It reports ground metres per pixel at the point of the globe
nearest the camera — a single number can only ever be approximate on a
sphere, since the scale falls away toward the limb, so this is the scale at
the middle of the view, which is what a scale bar on a globe can honestly
claim.

**Validated against the geometry, not by eye**: two points a known
great-circle distance apart at the view centre are projected with the real
camera, and the measured metres-per-pixel is compared with what the bar
claims. Agreement is **0.0% at every zoom on all three bodies**. It also
falls out of that test that the bar is reading each body's real size: at the
same zoom, Earth shows 1000 km where Mars shows 500 km and the Moon 200 km.

The bar is hidden in 2D mode — it is derived from the 3D camera, so it would
be quietly wrong sitting on the OpenLayers map, which draws its own.

## V0.8: the climate colouring (stage 1 of nine)

The goal is explicitly **not** a climate model: "科学的に厳密な気候
シミュレーションを目的としていません ... 見た人が自然だと感じる リアルっぽい
惑星表面を作る". Real physics and frank fudge factors are allowed to sit side
by side — and `js/climate.js` makes every parameter say which it is, because
the moment that distinction is lost, a number invented to make a picture look
right starts being cited as if it meant something.

Stage 1 uses only what the user listed: global mean temperature, latitude,
altitude, axial tilt, land-or-sea, and distance from the sea. Wind, rotation
and rain shadow are stage 2 and are deliberately absent.

### Where the parameters live, and why not in the config

`CLIMATE_PARAMETERS` in `js/climate.js` holds the schema — default, `kind`
(`physical` / `empirical`), min, max and what the term means. A world's
`config.json` carries only **overrides by name**. Both compatibility rules
the user asked for then fall out for free: a saved set missing a newer
parameter takes its default, and one still carrying a retired parameter is
reported and skipped rather than throwing. A leading underscore marks a human
note so a set can describe itself. Non-numeric values are rejected rather
than propagated. All four behaviours are asserted in the test.

### Two structural faults the first run exposed

Both were model errors, not tuning errors, and neither would have been fixed
by moving numbers:

- **The Sahara came out grey.** Bare ground was blended toward rock by how
  *dry* it was, so the driest places on Earth were painted stone. What
  actually decides the look of bare ground is how *warm* it is: a hot desert
  is sand, a cold one is rock and gravel. Keyed off warmth instead.
- **Siberia came out solid white.** The snow line sat at the physical
  freezing point, and Siberia's annual mean genuinely is about −5 °C. An
  annual-mean model cannot know that summer melts it, so
  `permanentSnowOffsetC` (empirical, ≈ −5) stands in for the seasonal cycle.
  `freezeTemperatureC` stays 0 °C because that is a fact about water.

### Fitting, done by a program

Per the user's explicit instruction not to burn model inference on parameter
search, `scratchpad/fit-stage1.js` does it: 1600 candidates evaluated and
scored **in the browser in ~17 seconds**, importing the real `js/climate.js`
so the thing being optimised is the thing that ships. Score 2.51 → 0.22.

Two rounds of the search failing *usefully* are worth recording, because both
were the objective's fault rather than the search's:

1. **Zonal land-cover fractions alone let it cheat.** The first fit pushed
   `moistureDecayKm` to its bound, switching continentality off entirely, and
   still scored well — because a band average cannot tell "dry because it is
   inland" from "dry because of its latitude". Fixed by adding 14 named
   places to the objective; the Gobi and the Taklamakan are dry at 39–43°N,
   well outside the subtropical belt, for no reason but distance from the sea.
2. **It then collapsed the gradients.** `vegetationMoistureWidth` went to
   0.01 — a hard desert/forest edge, which fits the numbers and directly
   contradicts "境界はできるだけ自然なグラデーションに". Bounds are part of a
   parameter's meaning, so the widths are now floored well above zero, and
   `polarExtraC` is held to ±12 so the search cannot turn a correction into a
   second contrast term fighting the first.

The result is a *worse* score than run 2 (0.22 vs 0.11) from a *better*
model. Worth stating plainly: a search will always find the degenerate
solution if the objective permits one, and the fix belongs in the objective.

**One independent corroboration.** The fitted `insolationSensitivityC` came
out at **63.3**, against **67** obtained separately by least-squares from
Earth's real zonal-mean temperatures. Two unrelated routes to the same
number is the closest thing to validation this stage has.

### The model itself

- **Insolation is integrated, not approximated.** The annual-mean daily
  insolation is computed numerically per latitude rather than via the usual
  second-Legendre fit. It costs a few thousand evaluations — nothing — and it
  means one piece of code covers Earth's 23.4°, Mars's 25.2°, the Moon's 6.7°
  and a world tilted 80° with no second formula.
- **Distance to the sea is a weighted chamfer transform**, weighted because a
  step in longitude is a different distance on the ground at every latitude;
  treating the grid as square would make polar continents look far wider than
  they are. Longitude wraps, so the sweeps run twice — one pass cannot carry
  a distance the whole way round.
- **Smooth fields coarse, sharp fields fine.** Distance-to-sea and the
  latitude temperature profile are computed on a 512×256 grid because they
  genuinely are smooth; altitude and the land/sea line are read at the
  elevation raster's full resolution because both are sharp and both matter
  to the eye. Painting is a single pass with no full-resolution intermediate
  arrays — holding a temperature and a moisture field beside the image would
  cost 17 MB for numbers each used once. Measured: **~270 ms** for the whole
  globe, comparable to the seabed repaint the user already accepts.
- **`classifyPoint` is shared by the painter and the scorer** on purpose. A
  search that optimised one formula while the globe drew another would be
  worse than no search at all.

### Scope: Earth only, and deliberately

The climate texture is a map, so it needs equirectangular UVs — which today
means the body drawn from a photograph. Mars and the Moon index their colours
by *height* (see `hypsometric.js`), so painting a map onto them needs a second
UV set. That is left for the stage that actually applies climate to them
rather than changing two working globes now; `supportsClimate` is false for
them, the 地表 row hides itself, and `setSurfaceMode` is a no-op that returns
"standard". Verified: Mars and the Moon are untouched, their panel stays at
19% of the screen, and Earth returns to 標準 after a world round trip.

Earth's own default (標準) is byte-identical to before across all ten
regression views.

## The V0.6 cleanup pass (no feature changes)

The user paused feature work and asked for an inspection and tidy-up with
one hard rule: **do not lose the state that works on the Pixel 7a**. A
restore point was pushed to GitHub first — branch **`safe-v0.6-working`**
at commit `1a2f9b5`, the version they had just confirmed. It is still
there; if anything below ever turns out to have broken something, that
branch is the way back.

The bar for every change was "same pixels out". The harness for that is
`scratchpad/baseline.js`, run once before and once after: it records
geometry counts, per-vertex radii to nine decimals, the seabed plan's
checksum, painted colours at three fixed coordinates, sea-sphere scale at
every slider extreme, the light-to-camera angle, rendered mean/contrast/
blue-fraction at nine views plus a drained one, drag and wheel response,
and both toggle directions. **All ten rendered screenshots came back
byte-for-byte identical and every measured value matched**; only wall-clock
timings differed. Re-run it the same way before any future refactor.

What was actually wrong, and what was done:

- **One 814-line file held six roles.** Split by role into `cubeSphere.js`
  (mesh), `elevation.js` (height data), `surface.js` (colour texture) and
  `globe3d.js` (the view), per the table in "Where things live". Pure
  moves, no logic edits. Deliberately four files, not seven — the
  temptation to also split out lighting, controls and the sea sphere was
  refused because those are all one concern (drawing the globe) and
  splitting them would have made the code harder to follow, not easier.
- **The bilinear elevation sampler existed twice**, once for the mesh and
  once inlined in the seabed pass, with the same maths written two
  different ways. Now both call `sampleGridMetres`. This is the duplication
  that mattered most: the two copies decide *where the coastline is*, and
  had they ever drifted, the terrain and its colouring would have disagreed
  in a way that looks like bad data rather than a bug. The plan checksum
  proved the merge changed nothing.
- **The elevation raster was kept as the canvas's raw RGBA.** Decoding it
  once into an `Int16Array` of metres halves it (8.39 MB → 4.19 MB) and
  removes the byte-unpacking from both hot loops — the 393k-vertex mesh
  build and the 8.4M-pixel seabed pass. Measured in-page: JS heap after the
  first seabed repaint **144.9 MB → 133.2 MB**, and startup was no slower.
- **`OFFSET_M = 12000` was written out three times** — encoder, verifier,
  and `config.json` — and had to agree or every elevation would silently be
  wrong by a fixed amount. `tools/elevation_encoding.py` now reads it from
  the world's config, which is where the browser already read it.
- **A real time bomb in the pipeline**: `verify_elevation.py` called
  `ndarray.ptp()`, removed in NumPy 2.0, and the workflow installs numpy
  unpinned. The next terrain rebuild would have crashed *at the final
  check*, after half an hour of downloading. Fixed to `np.ptp()`. Found by
  running the tool rather than reading it — worth remembering, since CI
  that only runs on demand can rot silently for months.
- **Earth was hardcoded in the rendering code**: radius, exaggeration,
  gamma, ramp depth. All four moved to `config.json` (`body` and `display`),
  and `buildCubeSphere` now takes a `radiusAt(lng, lat)` callback instead of
  an elevation grid, so the mesh module knows nothing about planets or
  rasters at all. This is the groundwork the user asked for ahead of the
  Moon and Mars — and it stops there on purpose. **No second body, no
  registry, no abstraction over "kinds of world" was built**, because
  exactly one world exists and inventing that structure now would be
  guessing at requirements.

Deliberately **not** changed, with reasons, so a future session doesn't
re-open them:

- **The 4096×2048 elevation PNG (10.9 MB) stays committed even though the
  app never downloads it.** `pickElevationLevel` takes the 2048 level and
  always will while the mesh is 255 segments, so it costs the phone
  nothing; regenerating it costs a 30-minute CEDA download; and the
  deferred REMA/ArcticDEM work will want it. Repo weight is the cheapest
  thing here.
- **Mesh resolution, light angles, ramp colours, opacity default, camera
  near/far, `FACE_SEGMENTS`, `SEABED_RIM_PASSES`, `WATER_BLUE_RATIO`** —
  every one of these is a number the user has already looked at on the
  phone and accepted. Touching them is how a "tidy-up" turns into a
  regression.
- **`lowPassPolarRows`'s window can be one sample wider than the image on
  the last row or two**, which double-counts a single pixel in that row's
  average. Genuinely an off-by-one; the visible effect is nil (those rows
  are already an average of nearly the whole width). Left alone because
  the fix would change approved pixels for no benefit anyone can see.
- **The 2D map, `geoConvert.js`, the OpenLayers loading arrangement, and
  the `index.html` import map** — all small, all working, nothing to gain.

Net, and stated honestly: this did **not** shrink the code. `globe3d.js`
went from 814 lines to 291, but the four files it became total 840, and the
project's JavaScript went from 1044 lines to 1070. Counting only actual
statements (no blanks, no comments) it is 621 → 629 — eight lines more,
which is the `requireNumber` guard and the config plumbing. Everything else
that looks like growth is comments.

That is the right outcome to expect from this kind of pass and worth being
clear about, because "fewer lines" was never the goal. What changed is that
the biggest file dropped by two thirds, the one piece of duplicated logic
that could actually cause a visible bug is gone, and "where does the height
data get read" and "where does the mesh get built" now have one-word
answers. The real reductions were elsewhere: one raster buffer halved
(8.39 → 4.19 MB), one constant that lived in three places down to one, and
one dead file's worth of stale documentation retired.

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

For V0.6 (GEBCO terrain + cube-sphere): the same vendor-and-drive-with-
Playwright method, plus a new trick for the parts this sandbox cannot
reach. Since the egress proxy blocks every geodata host, **GitHub Actions
became the diagnostic instrument**: a throwaway `gebco-probe.yml` ran
three rounds of `curl`/`gdalinfo` from a runner to find out what was
actually fetchable, which is how the CEDA archive layout, the exact
`GEBCO_2026.nc` URL, the grid's shape, and CEDA's ~5 MB/s throughput were
established rather than guessed. Worth reusing whenever a data source is
unreachable from here; delete the probe workflow once done.

Client-side verification did not wait on the 30-minute GEBCO run: a
scratch generator produced a stand-in raster in the *same* R/G-metres
encoding, so the mesh could be tested immediately. Verified against it:
393,730 vertices / 780,300 triangles (393,216 base + 514 seam
duplicates, matching prediction); **every sampled vertex normal has a
positive dot product with its position**, i.e. the globe is not
inside-out — worth checking explicitly, since a cube-sphere's winding is
easy to get wrong on some faces; **no vertex within 0.0043 radius units
(~27 km) of either pole**, confirming the odd-segment trick keeps
vertices off the singular point; ~3578 coincident vertices, which is the
expected shared-cube-edge duplication and not a defect; and rendered
screenshots pointed straight down at **both poles show no radial streaks,
no pinwheel, no hole and no gap** — the artifact that survived three
previous rounds of data-side fixes is simply absent once the mesh has no
pole. A screenshot centred on the antimeridian confirms the seam split
works (no stripe down the Pacific), and the V0.3 toggle regression still
passes.

Two gotchas hit while setting this up, both worth remembering. First, the
test site's `index.html` must keep its *vendored* import map — copying the
production one over it silently points three.js and OpenLayers at
jsdelivr, which this sandbox cannot reach, and the page just never
finishes loading. Second, a multi-line `git commit -m` message inside a
workflow's `run: |` block must stay indented; at column 0 it terminates
the YAML block scalar, and GitHub responds not with a parse error but by
reporting the workflow "does not have 'workflow_dispatch' trigger", which
is a thoroughly misleading symptom. `python3 -c "import yaml; yaml.safe_load(...)"`
on the workflow file diagnoses it in seconds.

For the coastal-speck round, the useful diagnostic ran **outside** the
browser first: the committed texture and both committed elevation levels
were loaded straight into Python/Pillow/numpy, and the candidate rules were
simulated over the whole globe before a line of JS was written. That is
what established, cheaply, that the finer elevation level removes only 4%
of the specks (so no bigger download would help), that a blue *ratio*
separates water from ice with a huge margin while a blue *difference* does
not, and that an unbounded flood drains the Great Lakes while three steps
does not. Side-by-side crops of the repainted texture over Japan, the
Sunda shelf, the Baltic and the Great Lakes were rendered from the same
script and inspected directly. Only then did the rule go into
`globe3d.js`, where Playwright confirmed the same result in real rendered
frames by A/B-ing `SEABED_RIM_PASSES` between 0 and 3 in one browser run
(numbers above). Worth reusing: anything that is a pure function of
committed raster data can be settled in seconds offline, and the browser
run then only has to confirm the port.

For V0.7 (Mars and the Moon), the headline test was that **Earth did not
move**. The same `scratchpad/baseline.js` was run before and after: every
measured value matched exactly, and although all ten screenshots differ as
files, a pixel-level diff showed every differing pixel sits inside the
control panel (first differing row 26, **zero differing pixels below row
260**) — i.e. the new 天体 row, not the globe.

For the new bodies, the pole and seam test is run with the sea slider at its
minimum *and the water opacity at zero*, so nothing hides the mesh: a
half-transparent blue sphere over a flooded pole would have concealed
exactly the defect being looked for. Alongside the screenshots, a numeric
check bins the frame into 72 wedges around the screen centre at a fixed
radius and reports the spread between them — radial streaking is a
*directional* pattern, so it shows up there in a way mean brightness cannot
see. Mars came back at 3.0-8.9, the Moon at 17.9-41.5 where the imagery
confirms genuine crater relief rather than an artefact.

Switching was tested by cycling all three bodies twice and asserting
**exactly one canvas** after each switch (a leaked WebGL context is how this
would fail on a phone) plus identical rendered statistics per body on both
rounds. Two harness traps worth remembering, both of which produced
convincing false failures: the loading overlay is raised inside a
`requestAnimationFrame`, so waiting on it can return before the switch has
even started — wait for the world id to change instead; and OpenLayers keeps
retrying tile loads this sandbox blocks, which leaves Playwright's real
mouse click waiting forever for the element to become "stable", so the 2D
toggle has to be driven in-page.

For the cleanup pass, the whole method is written up under "The V0.6
cleanup pass" above — the short version is that `scratchpad/baseline.js`
was run once before and once after, and every rendered screenshot came back
byte-identical. Reuse that harness for any future refactor: a tidy-up that
cannot prove it changed nothing is not worth shipping to a user who can
only test on one phone.

Also re-verified in the same run, since the paint pass and the sea-level
slider both changed: the cube-sphere still comes out at 393,730 vertices /
780,300 triangles with **no inside-out normals and no vertex within 0.0138
radius units of either pole**; the slider's step→metre mapping and its
readout are exact at every extreme (−100 → −2000 m, −6 → −120 m, 0 → ±0 m,
+1 → +2 m, +100 → +200 m) and the sea sphere's scale tracks it
(0.990582 at −2000 m, 1.000942 at +200 m); the ice caps are visually
unchanged by the rim pass at both Greenland and the south pole; and there
are no console errors beyond the test server's own favicon 404.

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
