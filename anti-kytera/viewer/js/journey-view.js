// グレートジャーニー: drawing the movement arrows, on the globe (three.js
// ribbons lying on the surface) and on the 2D map (canvas strokes on the
// Mercator picture). The reached/settled range itself is drawn by the stage
// shader (stage-draw.js, stage "journey"), so 3D and 2D share it exactly.
//
// Each arrow is one ~1000-year period in one 6x6-degree bin (journey.js):
// its direction is the area-weighted mean direction of the first-arrival
// steps started in that bin, its thickness the ground AREA newly reached
// (km2, so polar cells and small bodies are not over-counted), relative to
// this journey's largest. It is never a head count or a population. Sizes on
// screen are in degrees, so an arrow looks the same on every body.
import * as THREE from "three";
import { ARROW_YEARS } from "./journey.js";
import { lngLatToDirection } from "./geoConvert.js";

const LENGTH_DEG = 3.6, HEAD_SHARE = 0.35;
const WIDTH_MIN_DEG = 0.2, WIDTH_MAX_DEG = 1.1;
const ARROW_RGB = [24, 24, 38];
const MAX_ARROWS = 260;             // never cover the map

// the largest newly reached area of any arrow (km2): the thickest arrow
export const maxArrowArea = (journey) => journey.arrows.reduce((m, a) => Math.max(m, a.area), 1);

// Which arrows to show at time t. style: "recent" = the last 5 periods,
// "all" = every period so far (older ones thinner and fainter), "none".
export function visibleArrows(journey, t, style) {
  if (!journey || style === "none") return [];
  const now = Math.floor(t / ARROW_YEARS);
  const aMax = maxArrowArea(journey);
  const periodMax = new Map();                                  // the largest area of each period
  for (const a of journey.arrows) periodMax.set(a.m, Math.max(periodMax.get(a.m) || 0, a.area));
  const out = [];
  for (const a of journey.arrows) {
    if (a.m > now) continue;
    const age = now - a.m;
    if (style === "recent" && age >= 5) continue;
    if (age > 0 && a.area < 0.25 * periodMax.get(a.m)) continue;   // small areas of past periods drop out first
    const rel = Math.sqrt(a.area / aMax);
    const width = (WIDTH_MIN_DEG + (WIDTH_MAX_DEG - WIDTH_MIN_DEG) * rel) * (age ? 0.7 : 1);
    const alpha = age ? Math.max(style === "all" ? 0.35 : 0.3, 0.8 * Math.pow(0.72, age)) : 0.95;
    out.push({ ...a, width, alpha, age });
  }
  out.sort((x, y) => x.age - y.age || y.area - x.area);
  return out.slice(0, MAX_ARROWS).reverse();     // oldest first, so the newest draw on top
}

// Points along the arrow, as [lng, lat] on the great circle through its start.
function arrowPath(a) {
  const d2r = Math.PI / 180, lat0 = a.lat * d2r, lng0 = a.lng * d2r;
  const brg = Math.atan2(a.east, a.north);
  const at = (deg) => {
    const d = deg * d2r;
    const lat = Math.asin(Math.sin(lat0) * Math.cos(d) + Math.cos(lat0) * Math.sin(d) * Math.cos(brg));
    const lng = lng0 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat0), Math.cos(d) - Math.sin(lat0) * Math.sin(lat));
    return [((lng / d2r + 540) % 360) - 180, lat / d2r];
  };
  return { at, shaftEnd: LENGTH_DEG * (1 - HEAD_SHARE), tip: LENGTH_DEG };
}

// ------------------------------------------------------------ 3D
const dir = (lng, lat) => { const d = lngLatToDirection(lng, lat); return new THREE.Vector3(d.x, d.y, d.z); };
export function buildArrowMesh(arrows, radiusAt) {
  const pos = [], col = [];
  const LIFT = 0.004;
  const put = (lng, lat, side, halfDeg, next) => {       // a point offset sideways from the path
    const p = dir(lng, lat), q = dir(next[0], next[1]);
    const tangent = q.clone().sub(p).normalize();
    const sideV = new THREE.Vector3().crossVectors(p, tangent).normalize().multiplyScalar(side * halfDeg * Math.PI / 180);
    const v = p.clone().add(sideV).normalize();
    return v.multiplyScalar(radiusAt(lng, lat) + LIFT);
  };
  for (const a of arrows) {
    const { at, shaftEnd, tip } = arrowPath(a);
    const c = [...ARROW_RGB.map((x) => x / 255), a.alpha];
    const tri = (A, B, C) => { for (const v of [A, B, C]) { pos.push(v.x, v.y, v.z); col.push(...c); } };
    const STEPS = 4, hw = a.width / 2;
    for (let s = 0; s < STEPS; s++) {
      const d0 = shaftEnd * s / STEPS, d1 = shaftEnd * (s + 1) / STEPS;
      const p0 = at(d0), p1 = at(d1), p2 = at(d1 + 0.05);
      const l0 = put(p0[0], p0[1], 1, hw, p1), r0 = put(p0[0], p0[1], -1, hw, p1);
      const l1 = put(p1[0], p1[1], 1, hw, p2), r1 = put(p1[0], p1[1], -1, hw, p2);
      tri(l0, r0, l1); tri(r0, r1, l1);
    }
    const b = at(shaftEnd), bn = at(shaftEnd + 0.05), tp = at(tip), tn = at(tip + 0.05);
    tri(put(b[0], b[1], 1, hw * 2.4, bn), put(b[0], b[1], -1, hw * 2.4, bn), put(tp[0], tp[1], 0, 0, tn));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------ 2D
const MERC_R = 6378137;
// extent: EPSG:3857 [minx, miny, maxx, maxy] of a canvas w x h
export function drawArrows2D(canvas, extent, arrows, startLngLat) {
  const ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  const [x0, y0, x1, y1] = extent, world = 2 * Math.PI * MERC_R;
  const pxPerDeg = w / (x1 - x0) * world / 360;
  const toPx = (lng, lat, shift) => {
    const mx = (lng + shift) * Math.PI / 180 * MERC_R;
    const my = MERC_R * Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360));
    return [(mx - x0) / (x1 - x0) * w, (y1 - my) / (y1 - y0) * h];
  };
  // every copy of the world the extent shows
  const shifts = [];
  for (let k = Math.floor((x0 / world) - 0.5); k <= Math.ceil((x1 / world) + 0.5); k++) shifts.push(k * 360);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const a of arrows) {
    const { at, shaftEnd, tip } = arrowPath(a);
    const pts = [0, 0.25, 0.5, 0.75, 1].map((f) => at(shaftEnd * f));
    for (const shift of shifts) {
      // keep the arrow on one side of the date line
      const base = pts[0][0], P = pts.map(([lng, lat]) => toPx(lng + (lng - base > 180 ? -360 : lng - base < -180 ? 360 : 0), lat, shift));
      if (P.every(([x, y]) => x < -50 || x > w + 50 || y < -50 || y > h + 50)) continue;
      ctx.strokeStyle = ctx.fillStyle = `rgba(${ARROW_RGB.join(",")},${a.alpha})`;
      ctx.lineWidth = Math.max(1.2, a.width * pxPerDeg);
      ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      const t = at(tip), b = P[P.length - 1];
      let tl = t[0]; if (tl - base > 180) tl -= 360; if (tl - base < -180) tl += 360;
      const T = toPx(tl, t[1], shift), dx = T[0] - b[0], dy = T[1] - b[1], L = Math.hypot(dx, dy) || 1;
      const hw = Math.max(3, a.width * pxPerDeg * 1.2), nx = -dy / L * hw, ny = dx / L * hw;
      ctx.beginPath(); ctx.moveTo(b[0] + nx, b[1] + ny); ctx.lineTo(b[0] - nx, b[1] - ny); ctx.lineTo(T[0], T[1]); ctx.closePath(); ctx.fill();
    }
  }
  if (startLngLat) for (const shift of shifts) {
    const [x, y] = toPx(startLngLat.lng, startLngLat.lat, shift);
    if (x < -20 || x > w + 20) continue;
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#111"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }
}

// the start marker on the globe: a small white disc with a dark rim
export function buildStartMarker(lng, lat, radiusAt) {
  const group = new THREE.Group();
  const p = dir(lng, lat).multiplyScalar(radiusAt(lng, lat) + 0.006);
  for (const [r, c] of [[0.018, 0x111111], [0.012, 0xffffff]]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, depthWrite: false, transparent: true }));
    m.position.copy(p); m.lookAt(p.clone().multiplyScalar(2));
    if (c === 0xffffff) m.position.addScaledVector(p.clone().normalize(), 0.0005);
    group.add(m);
  }
  return group;
}
