// Latitude and longitude lines drawn on the globe.
//
// The lines follow the terrain rather than floating on a sphere of their
// own. That matters more than it sounds: Mars's relief spans radius 0.977
// to 1.062 once exaggerated, so a constant-radius graticule would hang
// visibly off the surface at the limb and sink into every mountain. Each
// point is sampled from the same elevation data the mesh uses and lifted by
// a small constant, so a line reads as drawn *on* the ground.
//
// Two densities are built and swapped by camera distance. One fixed spacing
// cannot serve both ends of the zoom range: 30 degrees is right for the
// whole globe and nearly empty close in, while 10 degrees is right close in
// and a solid mesh from far away. Both are cheap enough to build once and
// keep (a few thousand points each), so switching is a visibility flag.
import * as THREE from "three";

const COARSE_STEP_DEGREES = 30;
const FINE_STEP_DEGREES = 10;
// Below this camera distance the fine set takes over. Picked so the swap
// happens while the coarse lines are still comfortably far apart.
const FINE_DISTANCE = 2.2;

// How far above the ground the lines sit, in globe radii. Large enough to
// clear depth-buffer noise against the terrain, small enough that the lines
// still look attached to it at the limb.
const SURFACE_LIFT = 0.0015;

// Dark, not light. Measured as the luminance step across a line against the
// two hardest backgrounds the app draws: over the Sahara (the brightest
// ground, luminance ~224) a white line at 0.42 shifts the pixel by only
// 14 -- effectively invisible, because white on near-white has nowhere to
// go -- while black at 0.45 shifts it by 100. Over deep ocean (~124) the
// same black line gives 35, which matches what the white line managed
// there. So dark wins outright: seven times the contrast where white failed,
// and no loss where white worked.
// Must match the sea sphere's renderOrder in globe3d.js (its default, 0).
const SEA_RENDER_ORDER = 0;

const COLOR = 0x000000;
const OPACITY = 0.45;

function circleOfLatitude(lat, radiusAt, segments) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const lng = -180 + (360 * i) / segments;
    points.push(pointAt(lng, lat, radiusAt));
  }
  return points;
}

function meridian(lng, radiusAt, segments) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const lat = -90 + (180 * i) / segments;
    points.push(pointAt(lng, lat, radiusAt));
  }
  return points;
}

// Matches js/geoConvert.js's lngLatToDirection exactly -- if that convention
// ever changes, the graticule would silently land on the wrong meridians.
function pointAt(lng, lat, radiusAt) {
  const theta = ((90 - lat) * Math.PI) / 180;
  const phi = ((lng + 180) * Math.PI) / 180;
  const sinTheta = Math.sin(theta);
  const x = -Math.cos(phi) * sinTheta;
  const y = Math.cos(theta);
  const z = Math.sin(phi) * sinTheta;
  const r = radiusAt(lng, lat) + SURFACE_LIFT;
  return new THREE.Vector3(x * r, y * r, z * r);
}

function linesFrom(polylines) {
  const positions = [];
  for (const points of polylines) {
    for (let i = 0; i + 1 < points.length; i++) {
      positions.push(points[i].x, points[i].y, points[i].z);
      positions.push(points[i + 1].x, points[i + 1].y, points[i + 1].z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positions), 3)
  );
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: COLOR, transparent: true, opacity: OPACITY })
  );
  // Draw after the sea. Both the sea and these lines are transparent, so
  // three.js sorts them back to front -- and wherever the seabed lies below
  // sea level the lines are *further* from the camera than the water, so
  // they were painted first and the water then covered them. Past about 60%
  // opacity that made the graticule vanish over every ocean, which is
  // exactly what the user reported ("海の下に潜る感じ").
  //
  // Ordering them last is safe rather than a hack: the sea has
  // depthWrite: false, so the depth buffer holds only the terrain, and these
  // lines still depth-test against it. Lines on the far side of the globe
  // stay hidden; only the water stops hiding them. A graticule is a map
  // overlay, and overlays belong on top of what they annotate.
  lines.renderOrder = SEA_RENDER_ORDER + 1;
  return lines;
}

function buildSet(step, radiusAt) {
  // Enough segments that a circle reads as a circle rather than a polygon,
  // and enough that the line tracks the terrain it is sampling.
  const around = 360;
  const overPole = 180;

  const parallels = [];
  for (let lat = -90 + step; lat <= 90 - step + 1e-9; lat += step) {
    parallels.push(circleOfLatitude(lat, radiusAt, around));
  }
  const meridians = [];
  for (let lng = -180; lng < 180 - 1e-9; lng += step) {
    meridians.push(meridian(lng, radiusAt, overPole));
  }
  return { parallels: linesFrom(parallels), meridians: linesFrom(meridians) };
}

// Returns an object that owns the lines and answers to the four-state
// button: off -> parallels -> both -> meridians -> off.
export function buildGraticule(radiusAt) {
  const group = new THREE.Group();
  const coarse = buildSet(COARSE_STEP_DEGREES, radiusAt);
  const fine = buildSet(FINE_STEP_DEGREES, radiusAt);
  for (const set of [coarse, fine]) {
    group.add(set.parallels, set.meridians);
  }

  let mode = "off";

  function apply(cameraDistance) {
    const set = cameraDistance <= FINE_DISTANCE ? fine : coarse;
    const other = set === fine ? coarse : fine;
    other.parallels.visible = false;
    other.meridians.visible = false;
    set.parallels.visible = mode === "parallels" || mode === "both";
    set.meridians.visible = mode === "meridians" || mode === "both";
  }

  return {
    group,
    setMode(next, cameraDistance) {
      mode = next;
      apply(cameraDistance);
    },
    update(cameraDistance) {
      if (mode !== "off") apply(cameraDistance);
    },
    dispose() {
      for (const set of [coarse, fine]) {
        for (const lines of [set.parallels, set.meridians]) {
          lines.geometry.dispose();
          lines.material.dispose();
        }
      }
    },
  };
}
