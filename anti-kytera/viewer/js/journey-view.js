// グレートジャーニー: drawing the movement arrows, on the globe (three.js
// ribbons lying on the surface) and on the 2D map (canvas strokes on the
// Mercator picture). The reached/settled range itself is drawn by the stage
// shader (stage-draw.js, stage "journey"), so 3D and 2D share it exactly; in
// the default "arrows only" display it is not filled at all.
//
// Which arrows, their colours and widths come from journey-arrows.js (the
// era colours, and the display-time merge of nearby same-era arrows); this
// file only draws them. Every shown arrow stays once it has appeared -- none
// is dropped or thinned -- so the picture at time t is the whole route so
// far. Never a head count.
import * as THREE from "three";
import { lngLatToDirection } from "./geoConvert.js";

export { eras, journeyArrows, shownCount, maxShownArea } from "./journey-arrows.js";
import { shownCount } from "./journey-arrows.js";

const LENGTH_DEG = 3.6, HEAD_SHARE = 0.35;
const OUTLINE_RGB = [20, 20, 28], OUTLINE_ALPHA = 0.75, OUTLINE_DEG = 0.12;   // a dark rim: readable on any background

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
// One mesh for the whole journey: each arrow is a dark rim then its coloured
// body, arrows in time order, so showing time t is only a draw range
// (setTime) -- nothing is rebuilt while the journey plays.
const dir = (lng, lat) => { const d = lngLatToDirection(lng, lat); return new THREE.Vector3(d.x, d.y, d.z); };
export function buildArrowMesh(arrows, radiusAt) {
  const pos = [], col = [], ends = [];
  const LIFT = 0.004;
  const tangent = new THREE.Vector3(), sideV = new THREE.Vector3();
  const put = (lng, lat, side, halfDeg, next) => {       // a point offset sideways from the path
    const p = dir(lng, lat), q = dir(next[0], next[1]);
    tangent.copy(q).sub(p).normalize();
    sideV.crossVectors(p, tangent).normalize().multiplyScalar(side * halfDeg * Math.PI / 180);
    return p.add(sideV).normalize().multiplyScalar(radiusAt(lng, lat) + LIFT);
  };
  const STEPS = 4;
  const shape = (a, grow, c) => {                          // shaft + head, `grow` degrees wider all round
    const { at, shaftEnd, tip } = arrowPath(a);
    const tri = (A, B, C) => { for (const v of [A, B, C]) { pos.push(v.x, v.y, v.z); col.push(...c); } };
    const hw = a.width / 2 + grow, s0 = -grow;
    for (let s = 0; s < STEPS; s++) {
      const d0 = s0 + (shaftEnd - s0) * s / STEPS, d1 = s0 + (shaftEnd - s0) * (s + 1) / STEPS;
      const p0 = at(d0), p1 = at(d1), p2 = at(d1 + 0.05);
      const l0 = put(p0[0], p0[1], 1, hw, p1), r0 = put(p0[0], p0[1], -1, hw, p1);
      const l1 = put(p1[0], p1[1], 1, hw, p2), r1 = put(p1[0], p1[1], -1, hw, p2);
      tri(l0, r0, l1); tri(r0, r1, l1);
    }
    const b = at(shaftEnd - grow), bn = at(shaftEnd - grow + 0.05), tp = at(tip + grow * 1.8), tn = at(tip + grow * 1.8 + 0.05);
    tri(put(b[0], b[1], 1, a.width / 2 * 2.4 + grow * 1.8, bn), put(b[0], b[1], -1, a.width / 2 * 2.4 + grow * 1.8, bn), put(tp[0], tp[1], 0, 0, tn));
  };
  // vertex colours are linear; the sRGB colours of the legend and the 2D map
  // are converted so the globe shows the same colours
  const lin = (rgb) => { const c = new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace); return [c.r, c.g, c.b]; };
  const rim = [...lin(OUTLINE_RGB), OUTLINE_ALPHA];
  for (const a of arrows) {
    shape(a, OUTLINE_DEG, rim);
    shape(a, 0, [...lin(a.rgb), 1]);
    ends.push(pos.length / 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const setTime = (t) => { const n = shownCount(arrows, t); g.setDrawRange(0, n ? ends[n - 1] : 0); };
  setTime(0);
  return { mesh, setTime, triangles: pos.length / 9 };
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
  const rimPx = OUTLINE_DEG * pxPerDeg;
  for (const a of arrows) {
    const path = a.path2d || (a.path2d = (() => {             // lng/lat points, cached on the arrow
      const { at, shaftEnd, tip } = arrowPath(a);
      return { pts: [0, 0.25, 0.5, 0.75, 1].map((f) => at(shaftEnd * f)), tip: at(tip) };
    })());
    const base = path.pts[0][0], unwrap = (lng) => lng + (lng - base > 180 ? -360 : lng - base < -180 ? 360 : 0);
    for (const shift of shifts) {
      // keep the arrow on one side of the date line
      const P = path.pts.map(([lng, lat]) => toPx(unwrap(lng), lat, shift));
      if (P.every(([x, y]) => x < -50 || x > w + 50 || y < -50 || y > h + 50)) continue;
      const b = P[P.length - 1], T = toPx(unwrap(path.tip[0]), path.tip[1], shift);
      const dx = T[0] - b[0], dy = T[1] - b[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const lw = Math.max(1.2, a.width * pxPerDeg), hw = Math.max(3, a.width * pxPerDeg * 1.2);
      for (const [rgba, grow] of [[`rgba(${OUTLINE_RGB.join(",")},${OUTLINE_ALPHA})`, Math.max(1, rimPx)], [`rgb(${a.rgb.join(",")})`, 0]]) {
        ctx.strokeStyle = ctx.fillStyle = rgba;
        ctx.lineWidth = lw + 2 * grow;
        ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        const g = grow * 1.8, nx = -uy * (hw + g), ny = ux * (hw + g);
        const bx = b[0] - ux * grow, by = b[1] - uy * grow;
        ctx.beginPath(); ctx.moveTo(bx + nx, by + ny); ctx.lineTo(bx - nx, by - ny); ctx.lineTo(T[0] + ux * g, T[1] + uy * g); ctx.closePath(); ctx.fill();
      }
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
