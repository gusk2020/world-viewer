import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  directionToLngLat,
  lngLatToDirection,
  distanceToZoom,
  zoomToDistance,
} from "./geoConvert.js";

const MIN_DISTANCE = 1.3;
const MAX_DISTANCE = 8;

const SPHERE_WIDTH_SEGMENTS = 128;
const SPHERE_HEIGHT_SEGMENTS = 64;

// Exaggerated on purpose, not to scale: Earth's real elevation range (-11km
// to +8.8km) is only about +/-0.15% of its radius -- rendered true-to-scale
// the globe would look like a perfectly smooth ball (this is also true in
// real life, a well-known fact). Scale/bias below are chosen purely for
// visibility of REAL elevation data, the same widely-used convention as
// vertical exaggeration in scientific terrain visualizations -- the values
// themselves are real, only the DISPLAY scale is exaggerated. Tune these
// two numbers if the terrain relief looks too subtle or too extreme
// on-phone; nothing else needs to change to adjust it.
const DISPLACEMENT_SCALE = 0.06;
const DISPLACEMENT_BIAS = -0.02;

// The color texture's forests/dark terrain measured very dark in the raw
// source image itself (RGB ~30-60/255 for rainforest, vs ~240/255 for
// desert) -- confirmed this is baked into the texture, not a lighting
// artifact, by sampling the raw image data directly. A uniform brightness
// multiplier would have to blow out already-bright areas (deserts, ice,
// clouds) to lift those dark greens to a readable level. A gamma curve
// lifts shadows much more than highlights (anchored at black=black,
// white=white), so it targets exactly this without washing out the rest
// of the map -- prioritizing legibility over a literal rendering of the
// source photo, per explicit user direction ("リアルさより分かりやすさ").
const COLOR_GAMMA = 0.6;

// The sea-level baseline is the elevation map's own minimum pixel value,
// not a guessed threshold. **First attempt at this got the flooding wildly
// wrong and is worth recording**: originally picked the height-value
// percentile matching Earth's real ~71% ocean-area fraction, assuming a
// roughly continuous elevation surface. Actually inspecting this specific
// bump map's histogram (Pillow, counted every pixel) showed that's the
// wrong model for this data: 65% of ALL pixels are *exactly* 0 (ocean
// encoded as a flat, uniform floor -- no bathymetric variation baked in),
// and land elevation rises very steeply even from tiny values (just
// pixel-value 1, barely above the ocean floor, already covers 5% of all
// *land* pixels; value 3 covers 11%). The 71st-percentile approach landed
// almost exactly on the ocean floor anyway by coincidence, but a
// completely different (and much larger, catastrophically wrong -- see
// below) rise amount had been chosen assuming a gentler, continuous
// slope. Taking the data's actual minimum directly is simpler and matches
// what the source data really encodes; **verify this assumption again
// with a histogram check** (same method) if a future world's elevation
// data doesn't turn out to have this same "flat ocean floor" property.
function seaLevelBaseHeightValue(elevationSamples) {
  const { data } = elevationSamples;
  let min = 255;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < min) min = data[i];
  }
  return min / 255;
}

// How far (in the same 0-1 height-value units the elevation map itself
// uses, then scaled by DISPLACEMENT_SCALE like everything else) the sea
// surface can rise above its baseline at the slider's maximum. **Second
// mistake, also worth recording**: an earlier version of this constant
// (0.025) was specified directly in final *radius* units and sized as "a
// fraction of the total land relief range" -- reasonable-sounding, but
// against this data's actual histogram (see above) that rise submerged
// upwards of 40% of all land, drowning entire regions with no meaningful
// elevation to speak of (confirmed directly: a mid-continent camera view
// that should show a clear coastline became entirely blue at max slider).
// This value is instead picked directly from the histogram to submerge
// only the lowest ~8% of land pixels at maximum -- a small, plausible-
// looking coastal band, not "half of South America." Re-derive from a
// fresh histogram (Pillow: count pixels at each level, express as a
// fraction of non-zero/non-ocean pixels) rather than guessing again if
// this needs retuning or a future world's data is swapped in.
const SEA_LEVEL_MAX_RISE_HEIGHT = 3 / 255;

// The 3D globe (V0.1-V0.3 texture-only, V0.4 adds real elevation relief,
// V0.5 adds a sea-level control), wrapped as a self-contained module so
// V0.3's toggle can read/set its current view -- see getView()/setView()
// below and js/geoConvert.js for the lng/lat and zoom conversion this
// relies on.
export async function initGlobe3D(containerId, textureUrl, elevationMapUrl) {
  const scene = new THREE.Scene();

  // Tried tightening the far plane from V0.1-V0.3's 100 down to 20 (still
  // comfortably beyond MAX_DISTANCE=8) while chasing the ocean z-fighting
  // checkerboard below -- it did NOT fix that (confirmed: the artifact was
  // identical before/after). See OCEAN_FLOOR_EXTRA_DIP near
  // applyElevation() for what actually fixed it. Also tried tightening
  // the near plane to 0.5 at the same time, which broke something else:
  // at MIN_DISTANCE=1.3 the camera can sit only ~0.26 units from the
  // nearest terrain point (a mountain peak at up to radius ~1.04), which
  // is *closer than* a 0.5 near plane -- the globe's near-facing surface
  // was silently clipped away entirely, rendering solid black at close
  // zoom (caught via a screenshot regression, not by eye). Kept near at
  // V0.1-V0.3's original 0.1, comfortably below that ~0.26 minimum gap.
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    20
  );
  camera.position.set(0, 0, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById(containerId).appendChild(renderer.domElement);

  const [colorImage, elevationSamples] = await Promise.all([
    loadImage(textureUrl),
    loadElevationSamples(elevationMapUrl),
  ]);

  const texture = new THREE.CanvasTexture(applyGammaCorrection(colorImage, COLOR_GAMMA));
  texture.colorSpace = THREE.SRGBColorSpace;

  // Computed once, up front: needed both by applyElevation() below (to
  // dip true ocean-floor vertices a hair below this baseline, avoiding a
  // z-fighting exact-tie with the sea sphere -- see OCEAN_FLOOR_EXTRA_DIP)
  // and by the sea sphere's own baseline radius just below. Deriving it
  // twice would risk the two ever going out of sync.
  const seaLevelBaseHeight = seaLevelBaseHeightValue(elevationSamples);

  const geometry = new THREE.SphereGeometry(1, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS);
  applyElevation(geometry, elevationSamples, seaLevelBaseHeight);

  // MeshLambertMaterial (diffuse-only lighting, no PBR overhead): terrain
  // relief is only visible through shading, so V0.4 adds real lights
  // below -- V0.1-V0.3 used an unlit MeshBasicMaterial since there was no
  // geometry variation for a light to reveal yet.
  const globe = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture }));
  scene.add(globe);

  // V0.5: a separate sea-surface sphere, per the user's explicit design
  // direction (see "Future sea-level design" in CLAUDE.md) -- land relief
  // and sea level are two independent objects so raising sea level is
  // just resizing this sphere, never touching the land geometry above.
  const seaLevelBaseRadius = 1 + seaLevelBaseHeight * DISPLACEMENT_SCALE + DISPLACEMENT_BIAS;
  const seaSphere = new THREE.Mesh(
    new THREE.SphereGeometry(seaLevelBaseRadius, 64, 32),
    new THREE.MeshLambertMaterial({
      color: 0x2f6fa8,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      // The real fix for the ocean-floor z-fighting checkerboard is
      // geometric now (OCEAN_FLOOR_EXTRA_DIP, near applyElevation() below)
      // -- this polygonOffset is kept only as a cheap secondary safety net
      // for near-miss cases the exact-tie dip doesn't cover (e.g. a pole
      // row's averaged height landing very close to, but not exactly at,
      // the sea level baseline). A small value is enough for that; it does
      // NOT need to be large enough to fix the checkerboard by itself
      // (that was tried and rejected -- see the comment above
      // OCEAN_FLOOR_EXTRA_DIP for why a polygon-offset-only fix doesn't
      // work here).
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  scene.add(seaSphere);

  function setSeaLevel(fraction) {
    const heightValue = seaLevelBaseHeight + fraction * SEA_LEVEL_MAX_RISE_HEIGHT;
    const radius = 1 + heightValue * DISPLACEMENT_SCALE + DISPLACEMENT_BIAS;
    seaSphere.scale.setScalar(radius / seaLevelBaseRadius);
  }
  setSeaLevel(0);

  // Fixed "sun" direction (not attached to the camera, so it lights a
  // consistent hemisphere of the globe regardless of how the camera
  // orbits) plus a fairly bright ambient fill so the far side is still
  // clearly visible rather than crushed to black -- there's no day/night
  // city-lights feature yet to make a fully dark far side meaningful.
  //
  // Intensities tuned deliberately, not guessed: this version of Three.js
  // uses physically-based light units unconditionally (no legacy-lights
  // toggle exists any more), where intensity 1 reads dimmer than older
  // tutorials assume. The user reported the first pass (1.2 / 0.7) as
  // "too dark overall" once real shading replaced the old always-full-
  // brightness unlit texture. Measured actual rendered pixel brightness
  // (average luminance across the visible globe) to calibrate rather than
  // eyeballing: the unlit V0.1-V0.3 texture averaged ~34/255; 1.2/0.7
  // measured only ~21/255 (noticeably darker, matching the complaint);
  // 3.0/2.0 measures ~39/255, comfortably brighter than the original
  // unlit baseline while still leaving enough directional/ambient
  // difference for terrain shading to actually read as 3D. Re-measure
  // the same way (render, read back pixels, average luminance) if this
  // needs retuning rather than adjusting by feel.
  const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
  sunLight.position.set(5, 3, 5);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0xffffff, 2.0));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.rotateSpeed = 0.5;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  function getView() {
    const direction = camera.position.clone().normalize();
    const { lng, lat } = directionToLngLat(direction.x, direction.y, direction.z);
    return { lng, lat, zoom: distanceToZoom(camera.position.length()) };
  }

  function setView({ lng, lat, zoom }) {
    const distance = zoomToDistance(zoom, MIN_DISTANCE, MAX_DISTANCE);
    const direction = lngLatToDirection(lng, lat);
    camera.position.set(direction.x * distance, direction.y * distance, direction.z * distance);
    controls.update();
  }

  return { getView, setView, setSeaLevel };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

// Lifts shadows (dark forests etc.) much more than highlights (deserts,
// ice, clouds) via a gamma curve, using a 256-entry lookup table instead
// of recomputing Math.pow per pixel (this runs once per pixel of a
// 2048x1024 image at load time, not per frame). See COLOR_GAMMA above for
// why a plain brightness multiplier wasn't the right tool here.
function applyGammaCorrection(image, gamma) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const lut = new Uint8ClampedArray(256);
  for (let level = 0; level < 256; level++) {
    lut[level] = Math.round(255 * Math.pow(level / 255, gamma));
  }

  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// Reads a grayscale equirectangular elevation image into plain pixel data
// (via an offscreen canvas) so applyElevation() below can sample it on the
// CPU. Displacement is baked into real vertex positions (not a GPU-only
// `displacementMap`) so the globe's actual 3D shape is available for
// things like V0.5's land-vs-sea-level comparison later -- a shader-only
// displacement wouldn't expose real geometry to read back.
async function loadElevationSamples(url) {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width: canvas.width, height: canvas.height };
}

function averageRowHeight(elevationSamples, row) {
  const { data, width } = elevationSamples;
  let sum = 0;
  for (let x = 0; x < width; x++) {
    sum += data[(row * width + x) * 4];
  }
  return sum / width / 255;
}

// `uvCoordY` here is the geometry's stored UV.y, which for
// THREE.SphereGeometry is `1 - v` (v being the top-to-bottom sweep
// fraction) -- i.e. UV.y is 1 at the north pole ring and 0 at the south
// pole ring, the OPPOSITE of a naive "v=0 is the top" assumption. Combined
// with THREE's default flipY texture upload, this works out to: UV.y=1
// samples the source image's first (top) row, UV.y=0 samples its last
// (bottom) row -- confirmed consistent with V0.1's own verified pole
// behavior (setting the camera to look at the south pole rendered the
// image's actual bottom-row content), not just reasoned from the
// SphereGeometry source alone.
function sampleElevation(elevationSamples, u, uvCoordY) {
  const { data, width, height } = elevationSamples;
  const rowFraction = 1 - uvCoordY;
  const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
  const py = Math.min(height - 1, Math.max(0, Math.floor(rowFraction * height)));
  return data[(py * width + px) * 4] / 255;
}

// Every vertex in the sphere's top ring (north pole) and bottom ring
// (south pole) occupies the SAME 3D point before displacement, despite
// having different UV.x/longitude values -- sampling the elevation map
// per-vertex there would push these coincident points to different
// final distances from center, tearing the pole open into a gap or spike
// (exactly the class of bug this whole project has repeatedly fought with
// other engines). Forcing every pole vertex to the same value (the
// average across that row of the source image) keeps them coincident
// after displacement too, the same way the color texture's own poles stay
// visually seamless.
const POLE_UV_EPSILON = 1e-4;

// Investigated a faint radiating streak pattern visible when the camera
// is zoomed in tight directly on a pole (screenshotted and inspected):
// tried tapering near-pole vertices' sampled height toward the pole's
// flat average over a wide range of blend distances, and it made no
// visible difference at any of them. Isolated the real cause by swapping
// in a flat, unlit material (no elevation, no lighting at all) at the
// same camera angle -- the exact same streaks were still there, coming
// from the equirectangular COLOR texture's own pixel/mipmap sampling
// becoming highly compressed near a UV-sphere's pole (many texture
// columns squeezed into a visually tiny area), not from elevation
// displacement or normals at all. Confirmed this already existed,
// fainter, in V0.1's own already-user-approved pole screenshot at the
// default (further) zoom -- it's a pre-existing texture-sampling
// characteristic of the pole-safe UV-sphere approach itself, not
// something V0.4 introduced, and not a gap/tear (the mesh itself is
// provably seamless, see the pole-coincidence check below). Left
// unaddressed for now since it's cosmetic and only shows up zoomed in
// tight directly on a pole; a real fix would mean mipmapping/anisotropic
// filtering tuning or a higher-resolution color texture, not an
// elevation-side change.
// V0.5 gotcha, found only after actually adding the sea sphere and
// looking at a rendered screenshot: the true open ocean (65% of this
// elevation map's pixels, confirmed by histogram -- see
// seaLevelBaseHeightValue() above) all sit at *exactly* the same height
// value, which places the land mesh at the *exact same radius* as the sea
// sphere's own baseline over most of the visible ocean -- not merely
// close, genuinely tied. Two opaque-ish surfaces at an exact tie is a
// textbook z-fighting setup: the renderer alternates which one wins per
// triangle, producing a checkerboard/diamond flicker across the whole
// ocean (confirmed directly with screenshots, and confirmed it wasn't a
// transparency/blending artifact by testing with the sea material forced
// fully opaque -- same pattern either way). Tried fixing it purely as a
// rendering trick (`polygonOffset` on the sea material) first: too small
// a value did nothing, a large enough value to clear the ocean also
// started incorrectly hiding real dry land behind the sea sphere
// (confirmed with a screenshot showing blotchy fake "flooding" of
// interior South America that didn't correspond to any real elevation
// threshold). The actual fix is geometric, not a rendering hack: nudge
// true ocean-floor vertices a small real amount *below* the sea sphere's
// baseline, so they're no longer tied. A small `polygonOffset` is kept
// too, as a cheap safety net for any near-miss cases this doesn't cover
// (e.g. the pole rows' *averaged* height happening to land very close to
// the same baseline without being an exact tie).
//
// The magnitude was found empirically, not guessed once and assumed
// correct: 0.001 was tried first and screenshotted -- the checkerboard was
// still clearly visible, just as bad as with no dip at all. Tested a
// range up to 0.01 and screenshotted each; 0.003 was the smallest value
// that came back completely clean (smooth ocean, no flicker), and 0.01
// looked identical (no land-encroachment risk here even at a larger
// value, unlike the polygonOffset attempts above -- this dip only ever
// touches vertices already confirmed to be true ocean floor, never a
// coastal/land vertex, so there's nothing nearby for a bigger number to
// accidentally eat). Picked 0.003 for a comfortable margin without going
// further than needed. Re-verify with fresh screenshots (same method) if
// this needs revisiting.
const OCEAN_FLOOR_EXTRA_DIP = 0.003;

function applyElevation(geometry, elevationSamples, seaLevelBaseHeight) {
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;
  const northPoleHeight = averageRowHeight(elevationSamples, 0);
  const southPoleHeight = averageRowHeight(elevationSamples, elevationSamples.height - 1);
  const vertex = new THREE.Vector3();

  for (let i = 0; i < posAttr.count; i++) {
    const u = uvAttr.getX(i);
    const uvCoordY = uvAttr.getY(i);

    let heightValue;
    if (uvCoordY >= 1 - POLE_UV_EPSILON) {
      heightValue = northPoleHeight;
    } else if (uvCoordY <= POLE_UV_EPSILON) {
      heightValue = southPoleHeight;
    } else {
      heightValue = sampleElevation(elevationSamples, u, uvCoordY);
    }

    vertex.fromBufferAttribute(posAttr, i).normalize();
    let radiusScale = 1 + heightValue * DISPLACEMENT_SCALE + DISPLACEMENT_BIAS;
    if (heightValue <= seaLevelBaseHeight) {
      radiusScale -= OCEAN_FLOOR_EXTRA_DIP;
    }
    vertex.multiplyScalar(radiusScale);
    posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}
