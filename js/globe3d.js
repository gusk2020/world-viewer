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

// The 3D globe (V0.1-V0.3 texture-only, V0.4 adds real elevation relief),
// wrapped as a self-contained module so V0.3's toggle can read/set its
// current view -- see getView()/setView() below and js/geoConvert.js for
// the lng/lat and zoom conversion this relies on.
export async function initGlobe3D(containerId, textureUrl, elevationMapUrl) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 0, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById(containerId).appendChild(renderer.domElement);

  const [texture, elevationSamples] = await Promise.all([
    new THREE.TextureLoader().loadAsync(textureUrl),
    loadElevationSamples(elevationMapUrl),
  ]);
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.SphereGeometry(1, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS);
  applyElevation(geometry, elevationSamples);

  // MeshLambertMaterial (diffuse-only lighting, no PBR overhead): terrain
  // relief is only visible through shading, so V0.4 adds real lights
  // below -- V0.1-V0.3 used an unlit MeshBasicMaterial since there was no
  // geometry variation for a light to reveal yet.
  const globe = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture }));
  scene.add(globe);

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

  return { getView, setView };
}

// Reads a grayscale equirectangular elevation image into plain pixel data
// (via an offscreen canvas) so applyElevation() below can sample it on the
// CPU. Displacement is baked into real vertex positions (not a GPU-only
// `displacementMap`) so the globe's actual 3D shape is available for
// things like V0.5's land-vs-sea-level comparison later -- a shader-only
// displacement wouldn't expose real geometry to read back.
async function loadElevationSamples(url) {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  const image = texture.image;
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
function applyElevation(geometry, elevationSamples) {
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
    const radiusScale = 1 + heightValue * DISPLACEMENT_SCALE + DISPLACEMENT_BIAS;
    vertex.multiplyScalar(radiusScale);
    posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}
