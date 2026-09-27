// v2 3D view (from v1s's js/globe3d.js): scene, camera, the light that
// follows the camera, touch controls, the photo terrain mesh (GEBCO ice
// surface, 標準) or the stage mesh (Anti-KyTerra bedrock, the seven stages),
// the sea sphere, axis tilt and graticule. It draws; it does not decide any
// colour of a stage -- that is stage-draw.js -- and it holds no stage data.
//
// Everything specific to the body being drawn (its radius, how much the
// relief is exaggerated, the photo's gamma) comes from the world's
// config.json, not from constants here.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  directionToLngLat,
  lngLatToDirection,
  distanceToZoom,
  zoomToDistance,
} from "./geoConvert.js";
import { decodeElevationGrid, pickElevationLevel, sampleMetres } from "./elevation.js";
import { buildCubeSphere } from "./cubeSphere.js";
import { buildHypsometricRamp } from "./hypsometric.js";
import { buildGraticule } from "./graticule.js";
import { prepareSurfaceTexture } from "./surface.js";

const MIN_DISTANCE = 1.3;
const MAX_DISTANCE = 8;

// Quads along one edge of one cube face. Odd on purpose -- see
// buildCubeSphere. 6 faces x 256x256 vertices = 393k vertices, ~780k
// triangles.
const FACE_SEGMENTS = 255;

// 4 faces of (FACE_SEGMENTS + 1) vertices meet around the equator, and 2x
// that gives a little oversampling headroom so the mesh isn't sampling the
// raster one-to-one. Wider levels than this carry detail no vertex can
// express, so downloading them would be wasted bytes on a phone.
const USEFUL_GRID_WIDTH = 4 * (FACE_SEGMENTS + 1) * 2;

// Exports getView()/setView() for the 3D/2D toggle, plus the controls on
// screen: sea level, water opacity, stage mesh, axis and graticule.
export async function initGlobe3D(containerId, worldConfig, onFrame = null) {
  const body = worldConfig.body;
  const display = worldConfig.display;
  const terrain = worldConfig.terrain;

  // Relief is exaggerated because true to scale a planet renders as a
  // featureless ball -- Earth's real relief is about +/-0.15% of its radius
  // (a fact about the planet, not a limitation here). Crucially the same
  // factor is applied to the terrain and to the sea sphere, so *which* land
  // ends up underwater is unaffected by it: terrain height h sits at radius
  // 1 + k*h and sea level s at 1 + k*s, so submerged <=> h < s for any k.
  const metresToRadius =
    requireNumber(display.verticalExaggeration, "display.verticalExaggeration") /
    requireNumber(body.radiusMetres, "body.radiusMetres");
  const radiusForMetres = (metres) => 1 + metres * metresToRadius;

  const scene = new THREE.Scene();

  // The near plane has to stay well under the closest the camera can get to
  // the highest terrain: at MIN_DISTANCE the gap is only ~0.26 units, and a
  // near plane above that silently clips the whole near face of the globe
  // away to black. Re-test at both zoom extremes if these ever change.
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    20
  );
  camera.position.set(0, 0, 3);

  // Two ways to colour a world, chosen by what data it has. Earth has a
  // satellite photograph, so it is painted with one. Mars and the Moon
  // arrive as elevation and nothing else, so they are tinted by height the
  // way a physical relief globe is -- see js/hypsometric.js. Everything
  // below this point is common to both.
  const usesPhoto = Boolean(worldConfig.globeTexture);

  // **The images are loaded before any WebGL context exists, and that
  // ordering is the fix for a real bug the user hit on their phone.** The
  // renderer used to be built and its canvas attached first, so a failed
  // image load -- a few megabytes over a mobile connection is exactly where
  // that happens -- threw out of here leaving a live context and a canvas
  // attached to the page with nothing owning them and no way to dispose
  // them. Repeat that a few times and the browser starts dropping the
  // oldest context to stay under its limit, which kills the globe that was
  // still working. Loading first means a failure creates nothing at all and
  // there is nothing to clean up.
  const [colorImage, elevationImage] = await Promise.all([
    usesPhoto ? loadImage(worldConfig.globeTexture) : null,
    loadImage(pickElevationLevel(terrain.levels, USEFUL_GRID_WIDTH).url),
  ]);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const containerEl = document.getElementById(containerId);
  containerEl.appendChild(renderer.domElement);
  const elevation = decodeElevationGrid(elevationImage, terrain.encoding);
  const metresAt = (lng, lat) => sampleMetres(elevation, lng, lat);

  let texture;
  let ramp = null;
  let surface = null;
  let meshOptions;

  if (usesPhoto) {
    // The seabed is always the photograph itself (v2 fixes the seabed colour
    // to v1s's default, 写真), so no repaint machinery is carried.
    surface = prepareSurfaceTexture(
      colorImage,
      requireNumber(display.surfaceGamma, "display.surfaceGamma")
    );

    texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Antimeridian-crossing triangles carry u values just past 1 (see
    // splitSeamVertices in cubeSphere.js) -- they must wrap, not clamp.
    texture.wrapS = THREE.RepeatWrapping;

    meshOptions = {
      metresAt,
      radiusForMetres,
      uAt: (lng) => (lng + 180) / 360,
      vAt: (lng, lat) => (lat + 90) / 180,
      splitSeam: true,
    };
  } else {
    ramp = buildHypsometricRamp(display.hypsometric.stops);
    texture = ramp.texture;
    // The vertex's *height* is its texture coordinate, so moving the virtual
    // sea is one offset assignment rather than a repaint. v is anywhere in
    // the ramp's single row.
    meshOptions = {
      metresAt,
      radiusForMetres,
      uAt: (lng, lat, metres) => ramp.uForMetres(metres),
      vAt: () => 0.5,
      splitSeam: false,
    };
  }

  // Everything belonging to the body hangs off one group, so the axial-tilt
  // control is a single rotation rather than something each object has to
  // know about. The group starts at identity, which is exactly the upright
  // globe every earlier version drew.
  const body3d = new THREE.Group();
  scene.add(body3d);

  const globe = new THREE.Mesh(
    buildCubeSphere(FACE_SEGMENTS, meshOptions),
    new THREE.MeshLambertMaterial({ map: texture })
  );
  body3d.add(globe);

  // Land and sea are two independent objects, per the user's own design
  // direction: raising sea level only resizes this sphere and never
  // touches or re-bakes the terrain. With real metres the sea sits at
  // exactly radius 1 (elevation 0 m), so no calibration guesswork.
  //
  // Built from the same cube-sphere as the terrain, NOT
  // THREE.SphereGeometry. A sphere mesh is a polyhedron and each flat facet
  // sags below the true radius by about theta^2/8. On the 128x64 sphere
  // used at first that sag was 3.0e-4 radius units, which against 30x
  // exaggerated relief is **64 metres of equivalent elevation error** -- so
  // in shallow water the seabed poked up through the middle of every facet,
  // drawing a grid of dark scalloped blobs, and raising the level made
  // those blobs shrink instead of flooding land. Reported from the phone
  // and reproduced here exactly. At FACE_SEGMENTS the sag is ~4.7e-6, about
  // 1 metre. Matching the terrain's tessellation also means the two
  // surfaces cross each other cleanly.
  const seaSphere = new THREE.Mesh(
    buildCubeSphere(FACE_SEGMENTS),
    new THREE.MeshLambertMaterial({
      color: 0x2f6fa8,
      // Opacity is a user control, not a constant: opaque water reads
      // better as "flooded", transparent water shows the seafloor, and
      // which matters depends on what you are looking at. main.js sets the
      // starting value from the slider.
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    })
  );
  body3d.add(seaSphere);

  let seaLevelMetres = 0;

  function setSeaLevel(metres) {
    seaLevelMetres = metres;
    seaSphere.scale.setScalar(radiusForMetres(metres));
    // On a height-tinted world the colour scale is defined relative to the
    // sea, so the shoreline, the shallows and the newly drained ground all
    // re-tint as the slider moves. This is the whole reason the ramp is a
    // 1-D texture indexed by height: it costs one number per slider step
    // instead of a repaint.
    if (ramp) {
      ramp.texture.offset.x = ramp.offsetForSeaLevel(metres);
    }
  }
  setSeaLevel(0);

  function setWaterOpacity(fraction) {
    seaSphere.material.opacity = fraction;
  }

  // --- Anti-KyTerra stage seam ------------------------------------------
  // v1s's globe, sea sphere, light and controls are kept as they are. For the
  // seven stages a second terrain mesh is shown instead of the photo mesh: it
  // is shaped by the Anti-KyTerra bedrock (sub-ice, 0.25 deg), and its
  // material is v1s's own Lambert material with the diffuse colour computed
  // per pixel from the data (stages.js). Nothing of the photo path changes.
  const supportsStages = usesPhoto;
  let stageMesh = null;
  let stageApi = null;
  let showingStage = false;
  function setStage(api, hideSea = false) {
    if (!supportsStages) return false;
    if (api && !stageMesh) {
      stageApi = api;
      stageMesh = new THREE.Mesh(
        buildCubeSphere(FACE_SEGMENTS, { metresAt: api.bedMetresAt, radiusForMetres }),
        api.createMaterial()
      );
      body3d.add(stageMesh);
    }
    showingStage = Boolean(api);
    globe.visible = !showingStage;
    if (stageMesh) stageMesh.visible = showingStage;
    seaSphere.visible = !(showingStage && hideSea);
    rebuildGraticule();
    return showingStage;
  }

  let axisTiltDegrees = 0;

  // Leaned about X rather than Z on purpose. Nothing physical picks one over
  // the other -- which way a spin axis leans relative to some arbitrary
  // world direction is meaningless without modelling the orbit too -- but
  // the choice decides what the user sees when they press the button. About
  // Z, the pole leans straight at the camera from the opening view: the
  // globe really is tilted, yet it still *looks* upright and the readout
  // honestly says 0 degrees, so the button appears to do nothing. About X it
  // leans across the screen, which is the familiar school-globe-on-a-stand
  // pose and makes the readout mean something the moment it is pressed.
  function setAxisTilt(degrees) {
    axisTiltDegrees = degrees;
    body3d.rotation.set((degrees * Math.PI) / 180, 0, 0);
    body3d.updateMatrixWorld(true);
  }

  // The angle between the spin axis and "up on your screen", in 3D.
  //
  // This started out as the angle of the axis *projected* onto the screen,
  // which was a mistake: OrbitControls keeps its up vector at +Y, so an
  // upright body's axis is exactly vertical on screen from every possible
  // camera position, and the projected angle was pinned at 0 forever. Since
  // upright is the default, the readout looked simply broken -- which is
  // what the user reported ("常に0度のままで動かしても変化しません").
  //
  // Measured in 3D it always responds, because tipping the axis toward or
  // away from the viewer is a real change even when it still *draws*
  // vertical. Upright and looking at the equator reads 0; orbit up to the
  // pole and it sweeps to 90 as the axis turns to point at you. A tilted
  // body at the reference pose reads its own obliquity, so the readout and
  // the button still agree. It also has no degenerate case to guard: looking
  // straight down the axis is simply 90 degrees.
  const axisWorld = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();

  function getAxisAngle() {
    axisWorld.set(0, 1, 0).applyQuaternion(body3d.quaternion);
    camera.matrixWorld.extractBasis(new THREE.Vector3(), cameraUp, new THREE.Vector3());
    const cosine = Math.min(1, Math.max(-1, axisWorld.dot(cameraUp)));
    return (Math.acos(cosine) * 180) / Math.PI;
  }

  // Built on first use: a graticule nobody has switched on should cost
  // nothing at startup, which also keeps Earth's load time unchanged.
  let graticule = null;
  let graticuleMode = "off";

  // The lines follow whichever terrain is on screen (photo mesh = GEBCO ice
  // surface, stage mesh = sub-ice bedrock), so they are rebuilt on a switch.
  let graticuleKind = null;
  let graticuleColor = 0x000000;
  function rebuildGraticule() {
    const kind = showingStage ? "stage" : "photo";
    if (!graticule || graticuleKind === kind) return;
    body3d.remove(graticule.group);
    graticule.dispose();
    graticule = null;
    setGraticule(graticuleMode);
  }
  function setGraticule(mode) {
    if (mode === "off" && !graticule) {
      graticuleMode = mode;
      return;
    }
    if (!graticule) {
      const at = showingStage ? stageApi.bedMetresAt : metresAt;
      graticule = buildGraticule((lng, lat) => radiusForMetres(at(lng, lat)));
      graticuleKind = showingStage ? "stage" : "photo";
      graticule.setColor(graticuleColor);
      body3d.add(graticule.group);
    }
    graticuleMode = mode;
    graticule.setMode(mode, camera.position.length());
  }
  function setGraticuleColor(hex) {
    graticuleColor = hex;
    if (graticule) graticule.setColor(hex);
  }

  // Ground metres per screen pixel, at the point of the globe nearest the
  // camera. A single number can only ever be approximate on a sphere -- the
  // scale falls away towards the limb -- so this is the scale at the middle
  // of the view, which is what a scale bar on a globe can honestly claim.
  function getMetresPerPixel() {
    const toSurface = Math.max(0.01, camera.position.length() - 1);
    const worldPerPixel =
      (2 * toSurface * Math.tan((camera.fov * Math.PI) / 360)) /
      renderer.domElement.clientHeight;
    return worldPerPixel * body.radiusMetres;
  }

  // The light follows the camera instead of sitting at a fixed point in
  // space. It used to be pinned at (5,3,5), which is overhead at 45W 23N --
  // the mid-Atlantic. That lit the Atlantic seafloor beautifully and left
  // the Pacific, its antipode, falling on ambient light only. Ambient has
  // no direction, so it produces no shading at all, and relief there was
  // invisible: the user reported exactly this ("大西洋の海底地形は見えますが
  // 太平洋は暗くて見にくい") and correctly guessed the lighting.
  //
  // This is a map to read, not a day/night globe, so a fixed sun buys
  // nothing. Offsetting the light from the view direction rather than
  // aiming straight down it matters just as much: a light exactly behind
  // the viewer flattens everything, because surfaces facing you and
  // surfaces tilted away are lit almost identically. The offset keeps a
  // raking angle, which is what makes ridges and trenches read -- the same
  // reason relief maps are conventionally lit from the upper left.
  //
  // Intensities are calibrated by measuring rendered luminance rather than
  // by eye: this three.js uses physically-based light units, where
  // intensity 1 reads much dimmer than older tutorials assume.
  const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0xffffff, 2.0));

  const LIGHT_OFFSET_RADIANS = (38 * Math.PI) / 180;
  const lightDirection = new THREE.Vector3();
  const lightUp = new THREE.Vector3();
  const lightRight = new THREE.Vector3();

  function updateSunLight() {
    lightDirection.copy(camera.position).normalize();

    // Any reference that isn't parallel to the view; swapped near the poles
    // so the cross products below stay well conditioned.
    lightUp.set(0, 1, 0);
    if (Math.abs(lightDirection.y) > 0.99) lightUp.set(0, 0, 1);

    lightRight.crossVectors(lightUp, lightDirection).normalize();
    lightUp.crossVectors(lightDirection, lightRight).normalize();

    // Up and to the left of the viewer, by LIGHT_OFFSET_RADIANS.
    const tilt = Math.sin(LIGHT_OFFSET_RADIANS) * Math.SQRT1_2;
    lightDirection
      .multiplyScalar(Math.cos(LIGHT_OFFSET_RADIANS))
      .addScaledVector(lightUp, tilt)
      .addScaledVector(lightRight, -tilt)
      .normalize();

    sunLight.position.copy(lightDirection).multiplyScalar(10);
  }
  updateSunLight();

  // OrbitControls gives one-finger rotate and two-finger pinch-zoom out of
  // the box -- no custom gesture code. Panning is off because there is
  // nothing to pan a free-floating globe relative to, and the distance
  // bounds keep the camera outside the terrain and in sight of it.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.rotateSpeed = 0.5;

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);

  renderer.setAnimationLoop(() => {
    controls.update();
    updateSunLight();
    if (graticule && graticuleMode !== "off") graticule.update(camera.position.length());
    // Not drawn while the 2D map is showing: nothing would see it, and on a
    // hidden canvas the frames are never presented, so they pile up on the
    // GPU and the 2D map's own read-back has to wait for all of them.
    if (!containerEl.hidden) renderer.render(scene, camera);
    if (onFrame) onFrame();
  });

  // lng/lat is a fact about the body, so it is measured in the body's own
  // frame -- the tilt has to be taken back off on the way in and put back on
  // on the way out. At zero tilt both conversions are the identity.
  const viewDirection = new THREE.Vector3();

  function getView() {
    viewDirection
      .copy(camera.position)
      .normalize()
      .applyQuaternion(body3d.quaternion.clone().invert());
    const { lng, lat } = directionToLngLat(viewDirection.x, viewDirection.y, viewDirection.z);
    return { lng, lat, zoom: distanceToZoom(camera.position.length()) };
  }

  function setView({ lng, lat, zoom }) {
    const distance = zoomToDistance(zoom, MIN_DISTANCE, MAX_DISTANCE);
    const direction = lngLatToDirection(lng, lat);
    viewDirection
      .set(direction.x, direction.y, direction.z)
      .applyQuaternion(body3d.quaternion)
      .multiplyScalar(distance);
    camera.position.copy(viewDirection);
    controls.update();
  }

  // Switching bodies rebuilds the view from scratch, so everything holding
  // GPU memory has to be handed back -- three.js does not free geometries,
  // textures or the WebGL context on its own, and a phone has few contexts
  // to spare.
  function dispose() {
    renderer.setAnimationLoop(null);
    window.removeEventListener("resize", onResize);
    controls.dispose();
    globe.geometry.dispose();
    globe.material.dispose();
    seaSphere.geometry.dispose();
    seaSphere.material.dispose();
    if (graticule) graticule.dispose();
    texture.dispose();
    if (stageMesh) { stageMesh.geometry.dispose(); stageMesh.material.dispose(); }
    renderer.dispose();
    renderer.domElement.remove();
  }

  // Where the crosshair (screen centre) meets the unit sphere, in the body's
  // own frame (so the axis tilt is accounted for).
  const _ray = new THREE.Raycaster();
  const _q = new THREE.Quaternion();
  function getCentre() {
    _ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const d = _ray.ray.direction, o = _ray.ray.origin;
    const b = o.dot(d), c = o.dot(o) - 1, disc = b * b - c;
    if (disc < 0) return null;
    const p = o.clone().addScaledVector(d, -b - Math.sqrt(disc));
    p.applyQuaternion(_q.copy(body3d.quaternion).invert());
    return directionToLngLat(p.x, p.y, p.z);
  }

  return {
    getView,
    setView,
    setSeaLevel,
    getSeaLevel: () => seaLevelMetres,
    setWaterOpacity,
    setAxisTilt,
    getAxisAngle,
    supportsStages,
    setStage,
    setGraticule,
    setGraticuleColor,
    getMetresPerPixel,
    getCentre,
    renderer,
    // The photo (after v1s's gamma lift and polar low-pass) and the GEBCO
    // ice-surface grid, so the 2D map can draw the same 標準 view.
    photoTexture: usesPhoto ? texture : null,
    getElevation: () => ({ width: elevation.width, height: elevation.height, metres: elevation.metres }),
    dispose,
  };
}

// A missing config number would otherwise propagate as NaN into vertex
// positions and render a black screen with no error at all -- worth one
// check to fail where the mistake actually is.
function requireNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a number in the world's config.json`);
  }
  return value;
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
