// The 3D globe: scene, camera, lighting, touch controls, the terrain mesh
// and the sea surface. The pieces that are really about *data* rather than
// about drawing live next door -- elevation.js reads the height raster,
// cubeSphere.js builds the mesh, surface.js prepares and repaints the
// colour texture -- so this file stays about the view.
//
// Everything specific to the body being drawn (its radius, how much the
// relief is exaggerated, the photo's gamma, how deep the seabed ramp runs)
// comes from the world's config.json, not from constants here.
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
import {
  paintBareRock,
  paintClimate,
  computeClimate,
  resolveClimateSets,
} from "./climate.js";
import {
  SEABED_RAMPS,
  buildSeabedPlan,
  paintSeabed,
  prepareSurfaceTexture,
  rampLut,
} from "./surface.js";

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

// Exports getView()/setView() for the 3D/2D toggle, plus the three controls
// on screen: sea level, water opacity and seabed colour.
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
  // The teacher map -- what this world's surface really looks like, the thing
  // the climate model is scored against. Loaded here with the rest so that
  // pressing 教師 is instant and, more importantly, so that a failure to
  // fetch it fails before anything has been created. It is one paletted PNG
  // of about 50 KB, which next to the terrain raster is nothing.
  const teacherEra = pickTeacherEra(worldConfig.teacher);
  const [colorImage, elevationImage, teacherImage] = await Promise.all([
    usesPhoto ? loadImage(worldConfig.globeTexture) : null,
    loadImage(pickElevationLevel(terrain.levels, USEFUL_GRID_WIDTH).url),
    // A failed teacher fetch must not cost the user the whole world: it is a
    // comparison layer, not the globe. The button simply does not appear.
    teacherEra ? loadImage(teacherEra.map).catch(() => null) : null,
  ]);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById(containerId).appendChild(renderer.domElement);
  const elevation = decodeElevationGrid(elevationImage, terrain.encoding);
  const metresAt = (lng, lat) => sampleMetres(elevation, lng, lat);

  let texture;
  let ramp = null;
  let surface = null;
  let surfaceContext = null;
  let photoPixels = null;
  let seabedPixels = null;
  // Which pixel gets which seabed colour depends only on the elevation grid
  // and the photo, never on the chosen style, so it is worked out once and
  // reused -- switching styles after that is a lookup per pixel.
  let seabedPlan = null;
  let meshOptions;

  if (usesPhoto) {
    // The prepared photo is kept as pixels, not just uploaded and forgotten,
    // because setSeabedStyle below repaints the seabed from it on demand.
    surface = prepareSurfaceTexture(
      colorImage,
      requireNumber(display.surfaceGamma, "display.surfaceGamma")
    );
    surfaceContext = surface.getContext("2d", { willReadFrequently: true });
    photoPixels = surfaceContext.getImageData(0, 0, surface.width, surface.height);

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

  // Styles are rebuilt on demand rather than pre-baked and held: three
  // ready-made copies of a 4096x2048 texture would be over 100 MB of image
  // data on a phone, whereas rebuilding costs a fraction of a second and
  // one spare buffer. Independent of sea level, so moving that slider never
  // triggers a repaint -- the sea sphere covers whatever is submerged, over
  // a seabed already coloured by its own depth.
  function setSeabedStyle(styleId) {
    // Only meaningful where the seabed's colour came from a photograph.
    // A height-tinted world is already coloured by depth.
    if (!usesPhoto) return;
    const stops = SEABED_RAMPS[styleId];
    if (!stops) {
      surfaceContext.putImageData(photoPixels, 0, 0);
      texture.needsUpdate = true;
      return;
    }
    if (!seabedPixels) {
      seabedPixels = surfaceContext.createImageData(surface.width, surface.height);
    }
    if (!seabedPlan) {
      seabedPlan = buildSeabedPlan(
        photoPixels.data,
        surface.width,
        surface.height,
        elevation,
        requireNumber(display.seabedDeepestMetres, "display.seabedDeepestMetres")
      );
    }
    seabedPixels.data.set(photoPixels.data);
    paintSeabed(seabedPixels.data, seabedPlan, rampLut(stops));
    surfaceContext.putImageData(seabedPixels, 0, 0);
    texture.needsUpdate = true;
  }

  // ---------------------------------------------------------------------
  // Surface mode: the photograph (or height ramp) a world already had, bare
  // rock, or the climate model's colouring.
  //
  // Only offered where the mesh carries equirectangular UVs, which today
  // means the body that has a photograph. Mars and the Moon index their
  // texture by *height* instead (see hypsometric.js), so painting a map onto
  // them needs a second UV set -- deliberately left for the stage that
  // actually applies climate to them, rather than changing two working
  // globes now.
  const supportsClimate = usesPhoto;
  // The teacher map is a map, so it needs the same equirectangular UVs the
  // climate colouring needs -- a world without them cannot show it either.
  const hasTeacher = Boolean(teacherImage) && usesPhoto;
  let teacherTexture = null;
  if (hasTeacher) {
    teacherTexture = new THREE.Texture(teacherImage);
    teacherTexture.colorSpace = THREE.SRGBColorSpace;
    // Class colours, not a photograph: interpolating between them would
    // invent a colour that stands for no class at all.
    teacherTexture.magFilter = THREE.NearestFilter;
    teacherTexture.minFilter = THREE.LinearMipmapLinearFilter;
    teacherTexture.wrapS = THREE.RepeatWrapping;
    teacherTexture.needsUpdate = true;
  }

  // A world may carry several named sets -- "現在", "寒冷", "温暖" -- each
  // saying only what it changes. One is active at a time.
  const climateSets = resolveClimateSets(worldConfig);
  let climate = climateSets.sets.find((set) => set.id === climateSets.defaultId);
  for (const set of climateSets.sets) {
    if (!set.ignored.length) continue;
    // Not an error: a parameter set saved before a term was renamed or
    // retired must still load, so unknown names are reported and skipped.
    console.info(`climate set "${set.id}": ignoring unknown parameter(s) ${set.ignored.join(", ")}`);
  }

  let surfaceMode = "standard";
  let climateSetId = climate.id;
  // The mean temperature is a slider rather than one of the numbers buried in
  // the set, because it is the one term with a plain physical meaning and it
  // is what the whole app is ultimately for. It layers *over* whichever set is
  // active: null means "whatever the set itself says", so a set that carries
  // its own temperature is not silently overridden by a slider nobody moved.
  let meanTemperatureOverrideC = null;
  let climateCanvas = null;
  let climateContext = null;
  let climatePixels = null;
  let climateTexture = null;

  function ensureClimateTexture() {
    if (climateTexture) return;
    climateCanvas = document.createElement("canvas");
    climateCanvas.width = elevation.width;
    climateCanvas.height = elevation.height;
    climateContext = climateCanvas.getContext("2d", { willReadFrequently: true });
    climatePixels = climateContext.createImageData(elevation.width, elevation.height);
    climateTexture = new THREE.CanvasTexture(climateCanvas);
    climateTexture.colorSpace = THREE.SRGBColorSpace;
    // The seam split hands antimeridian triangles u just past 1.
    climateTexture.wrapS = THREE.RepeatWrapping;
  }

  // `climate` recomputes the model at the sea level in force when it is
  // called -- that is the "陸地塗り分け" press. Moving the sea slider
  // afterwards still floods the globe, because the water is its own sphere;
  // it just does not re-derive the climate until asked again.
  // Choosing a set repaints straight away if the climate colouring is what is
  // on screen, and otherwise just waits -- pressing 陸地塗り分け later picks
  // up whatever is selected.
  function setClimateSet(id) {
    if (!supportsClimate) return climateSetId;
    const set = climateSets.sets.find((entry) => entry.id === id);
    if (!set || set.id === climateSetId) return climateSetId;
    climate = set;
    climateSetId = set.id;
    // A new set states its own temperature; keeping the old slider position on
    // top of it would hide that. The caller re-reads getMeanTemperature().
    meanTemperatureOverrideC = null;
    if (surfaceMode === "climate") setSurfaceMode("climate");
    return climateSetId;
  }

  // The values actually painted with. Identical to the set's own object while
  // the slider has not been moved, so the approved picture is reproduced by
  // the same code path it always used.
  function climateValues() {
    if (meanTemperatureOverrideC === null) return climate.values;
    return { ...climate.values, meanTemperatureC: meanTemperatureOverrideC };
  }

  function getMeanTemperature() {
    return meanTemperatureOverrideC === null
      ? climate.values.meanTemperatureC
      : meanTemperatureOverrideC;
  }

  function setMeanTemperature(celsius) {
    if (!supportsClimate) return getMeanTemperature();
    if (!Number.isFinite(celsius)) return getMeanTemperature();
    if (celsius === getMeanTemperature()) return celsius;
    meanTemperatureOverrideC = celsius;
    // Only the climate colouring reads it; 標準 and 岩 do not depend on it.
    if (surfaceMode === "climate") setSurfaceMode("climate");
    return celsius;
  }

  function setSurfaceMode(mode) {
    if (!supportsClimate) return surfaceMode;
    // Anything unrecognised means the world's own surface, not bare rock --
    // which is what an unknown name used to fall through to.
    const known = mode === "climate" || mode === "rock" || (mode === "teacher" && hasTeacher);
    surfaceMode = known ? mode : "standard";
    if (surfaceMode === "standard" || surfaceMode === "teacher") {
      globe.material.map = surfaceMode === "teacher" ? teacherTexture : texture;
      globe.material.needsUpdate = true;
      return surfaceMode;
    }
    ensureClimateTexture();
    if (surfaceMode === "climate") {
      // A local, not a field: the coarse grids are about a megabyte and are
      // read once, on the next line. Holding them for the life of the globe
      // bought nothing.
      const values = climateValues();
      const fields = computeClimate({
        elevation,
        seaLevelMetres,
        axialTiltDegrees: requireNumber(body.axialTiltDegrees, "body.axialTiltDegrees"),
        radiusMetres: body.radiusMetres,
        dayLengthHours: requireNumber(body.dayLengthHours, "body.dayLengthHours"),
        rotationDirection: requireNumber(body.rotationDirection, "body.rotationDirection"),
        params: values,
      });
      paintClimate(
        climatePixels.data, elevation, fields, seaLevelMetres,
        values, climate.palette
      );
    } else {
      paintBareRock(
        climatePixels.data, elevation, seaLevelMetres, climateValues(), climate.palette
      );
    }
    climateContext.putImageData(climatePixels, 0, 0);
    climateTexture.needsUpdate = true;
    globe.material.map = climateTexture;
    globe.material.needsUpdate = true;
    return surfaceMode;
  }

  // Axial tilt. The button offers two positions -- upright, and the body's
  // real obliquity from its config -- and "upright" has to mean upright no
  // matter how the globe has been dragged around, so this sets an absolute
  // rotation rather than nudging the current one.
  //
  // Tilting the body rather than the camera keeps OrbitControls' own up
  // vector at +Y, so dragging, the polar clamp and the zoom limits all
  // behave exactly as before. The cost is that lng/lat is now measured in
  // the body's frame rather than the world's, which getView/setView below
  // have to undo -- at zero tilt that undoing is the identity, so Earth's
  // default view and its 2D toggle are bit-for-bit unchanged.
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

  function setGraticule(mode) {
    if (mode === "off" && !graticule) {
      graticuleMode = mode;
      return;
    }
    if (!graticule) {
      graticule = buildGraticule((lng, lat) => radiusForMetres(metresAt(lng, lat)));
      body3d.add(graticule.group);
    }
    graticuleMode = mode;
    graticule.setMode(mode, camera.position.length());
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
    renderer.render(scene, camera);
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
    if (climateTexture) climateTexture.dispose();
    if (teacherTexture) teacherTexture.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    getView,
    setView,
    setSeaLevel,
    setWaterOpacity,
    setSeabedStyle,
    setAxisTilt,
    getAxisAngle,
    setSurfaceMode,
    supportsClimate,
    hasTeacher,
    teacherEra: teacherEra ? { id: teacherEra.id, label: teacherEra.label } : null,
    climateSets: climateSets.sets.map((set) => ({ id: set.id, label: set.label, note: set.note })),
    getClimateSet: () => climateSetId,
    setClimateSet,
    getMeanTemperature,
    setMeanTemperature,
    setGraticule,
    getMetresPerPixel,
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

// Which era's teacher map to show. A world with no teacher block has none,
// and the app simply does not offer the button.
function pickTeacherEra(teacher) {
  if (!teacher || !Array.isArray(teacher.eras) || !teacher.eras.length) return null;
  return teacher.eras.find((era) => era.id === teacher.default) || teacher.eras[0];
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
