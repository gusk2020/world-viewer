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

// Quads along one edge of one cube face. **Odd on purpose**: with an even
// count a vertex lands exactly on the centre of the +Y/-Y face, which is
// exactly a pole -- the one place on an equirectangular map where
// longitude is undefined. Odd puts the pole in the middle of a quad
// instead, so every vertex has a well-defined longitude.
// 6 faces x 256x256 vertices = 393k vertices, ~780k triangles.
const FACE_SEGMENTS = 255;

const EARTH_RADIUS_M = 6371000;

// Earth's real relief is about +/-0.15% of its radius -- true to scale the
// globe renders as a featureless ball (a real fact about Earth, not a
// limitation here). Exaggerated for visibility, the same convention used
// by essentially every scientific terrain visualisation.
//
// Crucially this factor is applied identically to the terrain and to the
// sea-level sphere, so *which* land ends up underwater is unaffected by
// it: terrain height h is at radius 1 + k*h and sea level s is at
// 1 + k*s, so submerged <=> h < s for any k. The exaggeration changes how
// visible the relief is, never which coastline floods.
const VERTICAL_EXAGGERATION = 30;

// Forests etc. measured very dark in the source imagery (RGB ~30-60/255
// for rainforest vs ~240 for desert) -- confirmed baked into the texture
// itself, not a lighting artifact. A gamma curve lifts shadows far more
// than highlights (black stays black, white stays white), so it fixes the
// dark greens without blowing out deserts, ice and cloud. Per the user's
// explicit "リアルさより分かりやすさ" direction.
const COLOR_GAMMA = 0.6;

// The globe (V0.6: real GEBCO elevation on a pole-free cube-sphere).
// Exports getView()/setView() for the 3D/2D toggle and setSeaLevel() for
// the sea-level control.
export async function initGlobe3D(containerId, worldConfig) {
  const scene = new THREE.Scene();

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

  const terrain = worldConfig.terrain;
  const [colorImage, elevation] = await Promise.all([
    loadImage(worldConfig.globeTexture),
    loadElevationGrid(pickElevationLevel(terrain.levels), terrain.encoding),
  ]);

  const texture = new THREE.CanvasTexture(prepareGlobeTexture(colorImage, COLOR_GAMMA));
  texture.colorSpace = THREE.SRGBColorSpace;
  // Antimeridian-crossing triangles carry u values just past 1 (see
  // splitSeamVertices) -- they must wrap, not clamp.
  texture.wrapS = THREE.RepeatWrapping;

  const geometry = buildTerrainGeometry(FACE_SEGMENTS, elevation);

  const globe = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture }));
  scene.add(globe);

  // Land and sea are two independent objects, per the user's own design
  // direction: raising sea level only resizes this sphere and never
  // touches or re-bakes the terrain. With real GEBCO metres the sea sits
  // at exactly radius 1 (elevation 0 m), so no calibration guesswork.
  const seaSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 64),
    new THREE.MeshLambertMaterial({
      color: 0x2f6fa8,
      transparent: true,
      // Lowered from V0.5's 0.6 now that there is real seafloor under it:
      // GEBCO's ridges, trenches and shelves are the point of this
      // version, and at 0.6 the sea hid nearly all of them. Checked by
      // rendering the mid-Atlantic at 0.6 / 0.45 / 0.3 -- 0.4 shows the
      // ridge and the continental shelves while a +100 m rise over the
      // Bengal delta still reads unmistakably as flooding.
      opacity: 0.4,
      depthWrite: false,
    })
  );
  scene.add(seaSphere);

  function setSeaLevel(metresAbovePresent) {
    seaSphere.scale.setScalar(radiusForMetres(metresAbovePresent));
  }
  setSeaLevel(0);

  // Fixed "sun" plus a bright ambient fill so the far side stays readable
  // (there's no night-side feature that would make a dark half meaningful
  // yet). Intensities were calibrated by measuring rendered luminance, not
  // by eye: this three.js uses physically-based light units, where
  // intensity 1 reads much dimmer than older tutorials assume.
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

function radiusForMetres(metres) {
  return 1 + (metres / EARTH_RADIUS_M) * VERTICAL_EXAGGERATION;
}

// ---------------------------------------------------------------------------
// Cube-sphere geometry
//
// This replaces the UV sphere (THREE.SphereGeometry) that V0.1-V0.5 used.
// A UV sphere has a genuine singularity at each pole: every vertex of its
// top and bottom ring sits at the *same* 3D point while carrying different
// longitudes, and the rings just below are crushed together
// circumferentially. That is what produced the radial streaks the user kept
// seeing -- a fan of sliver triangles each smearing a different column of
// the map across a wedge, plus wildly different elevation samples between
// vertices millimetres apart. Smoothing the source data only ever hid it.
//
// A spherified cube has no pole at all: six ordinary grids, every quad
// roughly the same size everywhere on the globe, no vertex shared by a
// whole ring. The poles land in the middle of an ordinary quad on the +Y
// and -Y faces and get no special treatment whatsoever.
// ---------------------------------------------------------------------------

// [forward, right, up] per face, chosen so right x up === forward on all
// six. That makes one single winding order come out front-facing (outward)
// everywhere, with no per-face special cases.
const CUBE_FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];

// Plain normalisation of an evenly-spaced cube grid bunches vertices up
// towards the face corners. Warping each axis through tan() first spreads
// them almost evenly over the sphere, which is the whole point of using a
// cube-sphere here.
function warpAxis(t) {
  return Math.tan(t * (Math.PI / 4));
}

function buildTerrainGeometry(segments, elevation) {
  const perFace = (segments + 1) * (segments + 1);
  const vertexCount = perFace * CUBE_FACES.length;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(segments * segments * 6 * CUBE_FACES.length);

  let vi = 0;
  let ii = 0;

  for (let f = 0; f < CUBE_FACES.length; f++) {
    const [forward, right, up] = CUBE_FACES[f];
    const faceStart = f * perFace;

    for (let j = 0; j <= segments; j++) {
      const wv = warpAxis(-1 + (2 * j) / segments);
      for (let i = 0; i <= segments; i++) {
        const wu = warpAxis(-1 + (2 * i) / segments);

        let x = forward[0] + right[0] * wu + up[0] * wv;
        let y = forward[1] + right[1] * wu + up[1] * wv;
        let z = forward[2] + right[2] * wu + up[2] * wv;
        const inv = 1 / Math.hypot(x, y, z);
        x *= inv;
        y *= inv;
        z *= inv;

        const { lng, lat } = directionToLngLat(x, y, z);
        const radius = radiusForMetres(sampleMetres(elevation, lng, lat));

        positions[vi * 3] = x * radius;
        positions[vi * 3 + 1] = y * radius;
        positions[vi * 3 + 2] = z * radius;
        uvs[vi * 2] = (lng + 180) / 360;
        uvs[vi * 2 + 1] = (lat + 90) / 180;
        vi++;
      }
    }

    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = faceStart + j * (segments + 1) + i;
        const b = a + 1;
        const c = a + (segments + 1);
        const d = c + 1;
        indices[ii++] = a;
        indices[ii++] = b;
        indices[ii++] = d;
        indices[ii++] = a;
        indices[ii++] = d;
        indices[ii++] = c;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // Normals are computed here, *before* the seam split below, so the
  // duplicated seam vertices inherit an identical normal from their
  // original and the antimeridian shows no lighting discontinuity.
  geometry.computeVertexNormals();

  splitSeamVertices(geometry);
  geometry.computeBoundingSphere();
  return geometry;
}

// A triangle straddling the antimeridian has corners at u ~ 0.99 and
// u ~ 0.01, so interpolating between them runs the texture backwards
// across the entire map in one triangle. Give those corners a private copy
// carrying u + 1 instead (the texture wraps, see wrapS above). Only a few
// hundred vertices along one meridian are affected, and position and
// normal are copied verbatim so nothing moves or re-shades.
function splitSeamVertices(geometry) {
  const position = geometry.attributes.position.array;
  const normal = geometry.attributes.normal.array;
  const uv = geometry.attributes.uv.array;
  const index = geometry.index.array;

  const extraPositions = [];
  const extraNormals = [];
  const extraUvs = [];
  const copies = new Map();
  let nextIndex = geometry.attributes.position.count;

  for (let t = 0; t < index.length; t += 3) {
    const u0 = uv[index[t] * 2];
    const u1 = uv[index[t + 1] * 2];
    const u2 = uv[index[t + 2] * 2];
    if (Math.max(u0, u1, u2) - Math.min(u0, u1, u2) <= 0.5) continue;

    for (let k = 0; k < 3; k++) {
      const original = index[t + k];
      if (uv[original * 2] >= 0.5) continue;

      let copy = copies.get(original);
      if (copy === undefined) {
        copy = nextIndex++;
        extraPositions.push(
          position[original * 3],
          position[original * 3 + 1],
          position[original * 3 + 2]
        );
        extraNormals.push(
          normal[original * 3],
          normal[original * 3 + 1],
          normal[original * 3 + 2]
        );
        extraUvs.push(uv[original * 2] + 1, uv[original * 2 + 1]);
        copies.set(original, copy);
      }
      index[t + k] = copy;
    }
  }

  if (copies.size === 0) return;

  geometry.setAttribute("position", concatAttribute(position, extraPositions, 3));
  geometry.setAttribute("normal", concatAttribute(normal, extraNormals, 3));
  geometry.setAttribute("uv", concatAttribute(uv, extraUvs, 2));
  geometry.index.needsUpdate = true;
}

function concatAttribute(base, extra, itemSize) {
  const merged = new Float32Array(base.length + extra.length);
  merged.set(base, 0);
  merged.set(extra, base.length);
  return new THREE.BufferAttribute(merged, itemSize);
}

// ---------------------------------------------------------------------------
// Elevation data
// ---------------------------------------------------------------------------

// Elevation arrives as a PNG carrying real metres, not a brightness ramp:
// each pixel's red and green channels are the high and low byte of an
// unsigned 16-bit value, and metres = (R*256 + G) - offsetMetres. PNG
// because it is lossless -- a JPEG would corrupt the byte packing -- and
// two 8-bit channels because a canvas always hands back 8-bit samples, so
// a genuine 16-bit greyscale PNG would silently lose its low byte on read.
// The encoding parameters live in the world's config.json rather than here,
// so this code stays independent of any one world's data.
// The pipeline emits several sizes of the same global grid. Downloading
// the largest would be wasted bytes on a phone: the mesh has about
// 4 * FACE_SEGMENTS vertices around the equator, so a grid wider than
// roughly twice that carries detail no vertex can ever express. Take the
// finest level that is still worth its download, and leave the wider ones
// in place for when a future version subdivides the mesh further (or
// loads a high-detail patch for one region, which is what the planned
// REMA / ArcticDEM polar data will need).
// 4 faces of (FACE_SEGMENTS + 1) vertices meet around the equator, and 2x
// that gives a little oversampling headroom so the mesh isn't sampling the
// raster one-to-one.
const USEFUL_GRID_WIDTH = 4 * (FACE_SEGMENTS + 1) * 2;

function pickElevationLevel(levels) {
  const affordable = levels.filter((level) => level.width <= USEFUL_GRID_WIDTH);
  const candidates = affordable.length > 0 ? affordable : levels;
  return candidates.reduce((best, level) => (level.width > best.width ? level : best));
}

async function loadElevationGrid(level, encoding) {
  const image = await loadImage(level.url);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    data,
    width: canvas.width,
    height: canvas.height,
    offsetMetres: encoding.offsetMetres,
  };
}

function texelMetres(grid, x, y) {
  const i = (y * grid.width + x) * 4;
  return grid.data[i] * 256 + grid.data[i + 1] - grid.offsetMetres;
}

// Bilinear, wrapping in longitude and clamping in latitude. Sampling at a
// higher resolution than the mesh and interpolating keeps the terrain from
// picking up single-pixel noise as spurious bumps.
function sampleMetres(grid, lng, lat) {
  const fx = ((lng + 180) / 360) * grid.width - 0.5;
  const fy = ((90 - lat) / 180) * grid.height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  const xa = wrapColumn(x0, grid.width);
  const xb = wrapColumn(x0 + 1, grid.width);
  const ya = clampRow(y0, grid.height);
  const yb = clampRow(y0 + 1, grid.height);

  const top = texelMetres(grid, xa, ya) * (1 - tx) + texelMetres(grid, xb, ya) * tx;
  const bottom = texelMetres(grid, xa, yb) * (1 - tx) + texelMetres(grid, xb, yb) * tx;
  return top * (1 - ty) + bottom * ty;
}

function wrapColumn(x, width) {
  return ((x % width) + width) % width;
}

function clampRow(y, height) {
  return Math.min(height - 1, Math.max(0, y));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${url}`));
    image.src = url;
  });
}

// Two fixes to the source photo, both applied once at load rather than
// per frame: the gamma lift described at COLOR_GAMMA, and a polar
// low-pass described at lowPassPolarRows.
function prepareGlobeTexture(image, gamma) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Lifts shadows much more than highlights, through a 256-entry lookup
  // table rather than a Math.pow per pixel.
  const lut = new Uint8ClampedArray(256);
  for (let level = 0; level < 256; level++) {
    lut[level] = Math.round(255 * Math.pow(level / 255, gamma));
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }

  lowPassPolarRows(data, canvas.width, canvas.height);

  context.putImageData(imageData, 0, 0);
  return canvas;
}

// An equirectangular image gives every latitude the same pixel width, but
// the circle it wraps around shrinks by cos(latitude) -- so near the poles
// the image carries far more longitudinal detail than the globe can
// physically hold, roughly 1/cos(lat) times too much. Rendered, that
// surplus detail is what smears into faint radial streaks around a pole.
//
// Averaging each row over a 1/cos(lat)-wide window discards exactly the
// information that was never really there, which is ordinary correct
// anti-aliasing for this projection rather than a cover-up: this is a
// property of the *photo*, and it was verified to be the only remaining
// cause here by rendering the pole with the texture removed entirely and
// finding a perfectly smooth surface. The mesh itself has no pole (see
// the cube-sphere notes above) and needs no smoothing of any kind.
//
// A circular running sum keeps this O(width) per row no matter how wide
// the window grows, which matters because the window reaches most of the
// image width in the last row or two.
function lowPassPolarRows(data, width, height) {
  const row = new Float32Array(width);

  for (let y = 0; y < height; y++) {
    const latitude = (0.5 - (y + 0.5) / height) * Math.PI;
    const window = Math.round(1 / Math.max(Math.cos(latitude), 1e-6));
    if (window <= 1) continue;

    const radius = Math.min(window >> 1, width >> 1);
    if (radius < 1) continue;

    const span = 2 * radius + 1;
    const base = y * width * 4;

    for (let channel = 0; channel < 3; channel++) {
      for (let x = 0; x < width; x++) {
        row[x] = data[base + x * 4 + channel];
      }

      let sum = 0;
      for (let d = -radius; d <= radius; d++) {
        sum += row[((d % width) + width) % width];
      }

      for (let x = 0; x < width; x++) {
        data[base + x * 4 + channel] = Math.round(sum / span);
        sum -= row[((x - radius) % width + width) % width];
        sum += row[((x + radius + 1) % width + width) % width];
      }
    }
  }
}
