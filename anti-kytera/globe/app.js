// Anti-KyTerra integrated globe: 1 bedrock -> 2 sea at 0 m -> 3 temperature
// -> 4 humidity -> 5 precipitation -> 6 land ice -> 7 all-year potential
// natural vegetation, on one globe. Pure viewer: it only reads the committed
// results of PR #12 (results/display.json + fields.bin) and of the vegetation
// layer (veg/results/veg_display.json + veg_fields.bin). No estimation here.
// 地球適合 and 地域保留 are never mixed: every model value shown or read out is
// the one for the selected mode.
//
// Drawing: the data grids are uploaded as textures and every screen pixel
// computes its own longitude/latitude from its 3D direction on the sphere, then
// looks the data up. There is no intermediate equirectangular picture, so
// (a) nothing is interpolated in lng/lat across the mesh triangles (that is
// what drew a star at each pole), (b) nothing is squeezed into the last rows
// of a picture near the poles, and (c) the only resolution limit left is the
// data grid itself. Relief shading uses an object-space normal per bed cell
// (see buildNormals) lit from a direction tied to the camera, so its frame
// does not spin around the poles.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildCubeSphere } from "../../js/cubeSphere.js";
import { directionToLngLat, lngLatToDirection } from "../../js/geoConvert.js";

const ICE_MIN_M = 10;          // same threshold as the hand-off ice mask
const RELIEF = 25;             // vertical exaggeration of the relief shading (as before)
const RAMPS = {
  rock: [[0, 58, 52, 50], [0.40, 104, 92, 80], [0.57, 150, 136, 108], [0.62, 128, 140, 96], [0.72, 150, 128, 88],
         [0.85, 120, 100, 84], [1, 236, 232, 226]],
  sea: [[0, 12, 26, 70], [0.6, 22, 70, 140], [1, 90, 170, 215]],
  temp: [[0, 40, 20, 120], [0.25, 60, 110, 220], [0.45, 190, 225, 245], [0.55, 250, 245, 200],
         [0.75, 245, 150, 60], [1, 150, 20, 30]],
  hum: [[0, 245, 238, 220], [0.3, 190, 220, 170], [0.6, 60, 170, 170], [1, 20, 50, 130]],
  precip: [[0, 150, 90, 40], [0.15, 225, 200, 130], [0.35, 235, 240, 200], [0.55, 110, 200, 120],
           [0.8, 30, 120, 170], [1, 40, 30, 120]],
  ice: [[0, 235, 245, 255], [0.3, 150, 200, 240], [0.7, 50, 110, 200], [1, 20, 30, 110]],
  diff: [[0, 30, 60, 170], [0.5, 245, 245, 245], [1, 180, 30, 30]],
};
const RAMP_ROWS = Object.keys(RAMPS);
const BED_LO = -8000, BED_HI = 6000;
const AGREE = { same: [70, 170, 90], veg: [215, 70, 60], ice: [120, 150, 220], none: [90, 90, 90], sea: [20, 40, 70] };

const state = { v: "bed", src: "model", mode: "fit" };
let S, V, F = {}, ready = false;
const vcol = {}, vlab = {};

async function loadBin(path) { return (await fetch(path)).arrayBuffer(); }
function view(meta, buf, keys) {
  for (const k of keys) {
    const f = meta.fields[k];
    F[k] = new ({ i16: Int16Array, u8: Uint8Array, f32: Float32Array }[f.dtype])(buf, f.offset, f.w * f.h);
    F[k].meta = f;
  }
}
async function load() {
  const [s, v] = await Promise.all([
    fetch("../results/display.json").then((r) => r.json()),
    fetch("../veg/results/veg_display.json").then((r) => r.json()),
  ]);
  S = s; V = v;
  const [sb, vb] = await Promise.all([loadBin("../results/fields.bin"), loadBin("../veg/results/veg_fields.bin")]);
  view(S, sb, Object.keys(S.fields));
  view(V, vb, ["veg_fit", "veg_holdout", "veg_teacher"]);
  for (const c of V.classes) { vcol[c.code] = c.rgb; vlab[c.code] = c.ja; }
  for (const [k, s2] of Object.entries(V.special)) { vcol[k] = s2.rgb; vlab[k] = s2.ja; }
  for (const k of Object.keys(S.fields)) { const m = F[k].meta; F[k] = polarFootprint(F[k], m.w, m.h); F[k].meta = m; }
}

// A latitude/longitude grid keeps the same number of cells in every row, so
// near a pole a cell is many times narrower east-west than it is tall (at
// 89.9 degrees on the 0.25-degree grid, ~450 times). Each such sliver is a
// separate average, and drawn side by side they fan out from the pole as
// radial streaks: the streaks are the grid's cell shape, not the terrain.
// Each row of every continuous field is therefore averaged over an odd window
// of about 1/cos(lat) cells, i.e. over a footprint as wide as it is tall. It is
// the same rule for every row of every field (below ~70 degrees the window is
// one cell and nothing changes); vegetation classes are never averaged.
function polarFootprint(a, w, h) {
  const out = new Float32Array(w * h), pre = new Float64Array(w + 1);
  for (let j = 0; j < h; j++) {
    const lat = ((j + 0.5) / h - 0.5) * Math.PI;
    const half = Math.min((w >> 1) - 1, Math.max(0, Math.round((1 / Math.max(Math.cos(lat), 1e-6) - 1) / 2)));
    const row = j * w;
    if (half === 0) { for (let i = 0; i < w; i++) out[row + i] = a[row + i]; continue; }
    for (let i = 0; i < w; i++) pre[i + 1] = pre[i] + a[row + i];
    const n = 2 * half + 1, total = pre[w];
    for (let i = 0; i < w; i++) {
      const lo = i - half, hi = i + half + 1;         // [lo, hi), wrapping in longitude
      let sum;
      if (lo < 0) sum = pre[hi] + total - pre[w + lo];
      else if (hi > w) sum = pre[w] - pre[lo] + pre[hi - w];
      else sum = pre[hi] - pre[lo];
      out[row + i] = sum / n;
    }
  }
  return out;
}

// ---------------------------------------------------------------- sampling (CPU twin of the shader, for the readout)
function cell(name, lng, lat) {
  const f = F[name].meta;
  const y = Math.min(f.h - 1, Math.max(0, Math.floor((lat + 90) / 180 * f.h)));
  const x = ((Math.floor((lng + 180) / 360 * f.w) % f.w) + f.w) % f.w;
  return F[name][y * f.w + x];
}
function bilinear(name, lng, lat) {
  const f = F[name].meta, a = F[name];
  const fy = (lat + 90) / 180 * f.h - 0.5, fx = (lng + 180) / 360 * f.w - 0.5;
  const y0 = Math.max(0, Math.min(f.h - 1, Math.floor(fy))), y1 = Math.min(f.h - 1, y0 + 1);
  const wy = Math.max(0, Math.min(1, fy - y0));
  let x0 = Math.floor(fx); const wx = fx - x0;
  x0 = ((x0 % f.w) + f.w) % f.w; const x1 = (x0 + 1) % f.w;
  return (a[y0 * f.w + x0] * (1 - wx) + a[y0 * f.w + x1] * wx) * (1 - wy) +
         (a[y1 * f.w + x0] * (1 - wx) + a[y1 * f.w + x1] * wx) * wy;
}
// Continuous fields (bed, climate, ice thickness) are interpolated between cell
// centres; the land/sea line is the 0 m contour and the ice edge the 10 m
// contour of that interpolation. Vegetation is a class per 0.5-degree cell and
// is never interpolated. Order: ice > sea > vegetation.
const bed = (lng, lat) => bilinear("bed", lng, lat);
function vegComposite(which, lng, lat) {
  if (bilinear(`H_${which}`, lng, lat) > ICE_MIN_M) return 1;
  if (bed(lng, lat) < 0) return 0;
  return cell(`veg_${which}`, lng, lat) || 255;
}

function ramp(name, x) {
  const r = RAMPS[name];
  x = Math.min(1, Math.max(0, x));
  for (let i = 1; i < r.length; i++) if (x <= r[i][0]) {
    const t = (x - r[i - 1][0]) / (r[i][0] - r[i - 1][0]);
    return [0, 1, 2].map((k) => r[i - 1][k + 1] + t * (r[i][k + 1] - r[i - 1][k + 1]));
  }
  return r[r.length - 1].slice(1);
}
const isClimate = () => ["t2m", "hum", "precip", "ice"].includes(state.v);
const vm = () => S.vars[state.v];
function scale() {
  const m = vm();
  if (state.src === "diff") return { ramp: "diff", lo: -m.diffRange, hi: m.diffRange, log: false };
  return { ramp: m.ramp, lo: m.lo, hi: m.hi, log: !!m.log };
}
const seaColour = (z) => ramp("sea", 1 - Math.min(1, -z / 6000));

// ---------------------------------------------------------------- relief normals
// One object-space unit normal per bed cell. The east-west slope is taken over
// a physical distance close to the north-south cell spacing: near a pole the
// neighbouring longitude cell is only a few hundred metres away, and dividing a
// cell-to-cell difference by that tiny distance is what drew the radial
// streaks. Normals in object space stay meaningful across the pole.
function buildNormals() {
  const f = F.bed.meta, a = F.bed, W = f.w, H = f.h, R = 6.371e6;
  const out = new Uint8Array(W * H * 4), dy = Math.PI * R / H;
  for (let j = 0; j < H; j++) {
    const lat = (j + 0.5) / H * Math.PI - Math.PI / 2, cl = Math.cos(lat), sl = Math.sin(lat);
    const k = Math.min(W >> 2, Math.max(1, Math.round(1 / Math.max(cl, 1e-6))));
    const dx = cl * 2 * Math.PI * R / W * k;
    const jn = Math.min(H - 1, j + 1), js = Math.max(0, j - 1);
    for (let i = 0; i < W; i++) {
      const gx = (a[j * W + (i + k) % W] - a[j * W + (i - k + W) % W]) / (2 * dx) * RELIEF;
      const gy = (a[jn * W + i] - a[js * W + i]) / ((jn - js) * dy) * RELIEF;
      const phi = ((i + 0.5) / W) * 2 * Math.PI;           // lng + 180 deg
      const cp = Math.cos(phi), sp = Math.sin(phi);
      // position, east and north unit vectors (same convention as geoConvert)
      const px = -cp * cl, py = sl, pz = sp * cl;
      const ex = sp, ez = cp;
      const nx = cp * sl, ny = cl, nz = -sp * sl;
      let x = px - gx * ex - gy * nx, y = py - gy * ny, z = pz - gx * ez - gy * nz;
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      const o = (j * W + i) * 4;
      out[o] = Math.round((x * 0.5 + 0.5) * 255); out[o + 1] = Math.round((y * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((z * 0.5 + 0.5) * 255); out[o + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------- textures and shader
const T = {};
function floatTex(arr, w, h) {
  const t = new THREE.DataTexture(arr instanceof Float32Array ? arr : Float32Array.from(arr), w, h,
    THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}
function buildTextures() {
  for (const k of Object.keys(S.fields)) T[k] = floatTex(F[k], F[k].meta.w, F[k].meta.h);
  for (const k of ["veg_fit", "veg_holdout", "veg_teacher"]) {
    const t = new THREE.DataTexture(F[k], F[k].meta.w, F[k].meta.h, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
    T[k] = t;
  }
  const nb = F.bed.meta;
  const n = new THREE.DataTexture(buildNormals(), nb.w, nb.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  n.minFilter = n.magFilter = THREE.LinearFilter; n.generateMipmaps = false;
  n.wrapS = THREE.RepeatWrapping; n.wrapT = THREE.ClampToEdgeWrapping; n.needsUpdate = true;
  T.normal = n;
  const rp = new Uint8Array(256 * RAMP_ROWS.length * 4);
  RAMP_ROWS.forEach((name, r) => {
    for (let i = 0; i < 256; i++) {
      const c = ramp(name, i / 255), o = (r * 256 + i) * 4;
      rp[o] = Math.round(c[0]); rp[o + 1] = Math.round(c[1]); rp[o + 2] = Math.round(c[2]); rp[o + 3] = 255;
    }
  });
  const rt = new THREE.DataTexture(rp, 256, RAMP_ROWS.length, THREE.RGBAFormat, THREE.UnsignedByteType);
  rt.minFilter = rt.magFilter = THREE.LinearFilter; rt.generateMipmaps = false; rt.needsUpdate = true;
  T.ramp = rt;
  const pal = new Uint8Array(256 * 4);
  for (const [code, rgb] of Object.entries(vcol)) pal.set([...rgb, 255], Number(code) * 4);
  const pt = new THREE.DataTexture(pal, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  pt.minFilter = pt.magFilter = THREE.NearestFilter; pt.generateMipmaps = false; pt.needsUpdate = true;
  T.pal = pt;
}

const VERT = /* glsl */`
out vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */`
precision highp float;
precision highp int;
in vec3 vPos;
uniform sampler2D bedT, nrmT, fM, fT, hM, hT, vM, vT, rampT, palT;
uniform int stage, src, rampRow, nRamps;
uniform float lo, hi;
uniform bool logScale;
uniform vec3 lightDir;
const float PI = 3.141592653589793;
const float BED_LO = ${BED_LO.toFixed(1)}, BED_HI = ${BED_HI.toFixed(1)}, ICE_MIN = ${ICE_MIN_M.toFixed(1)};
const int R_ROCK = ${RAMP_ROWS.indexOf("rock")}, R_SEA = ${RAMP_ROWS.indexOf("sea")}, R_ICE = ${RAMP_ROWS.indexOf("ice")}, R_DIFF = ${RAMP_ROWS.indexOf("diff")};

// bilinear between cell centres, longitude wraps, latitude clamps (same as the JS readout)
float bil(sampler2D t, vec2 ll) {
  ivec2 sz = textureSize(t, 0);
  float fx = (ll.x + 180.0) / 360.0 * float(sz.x) - 0.5, fy = (ll.y + 90.0) / 180.0 * float(sz.y) - 0.5;
  int y0 = clamp(int(floor(fy)), 0, sz.y - 1), y1 = min(y0 + 1, sz.y - 1);
  float wy = clamp(fy - float(y0), 0.0, 1.0);
  float fx0 = floor(fx), wx = fx - fx0;
  int x0 = int(mod(fx0, float(sz.x))), x1 = (x0 + 1) % sz.x;
  float a = mix(texelFetch(t, ivec2(x0, y0), 0).r, texelFetch(t, ivec2(x1, y0), 0).r, wx);
  float b = mix(texelFetch(t, ivec2(x0, y1), 0).r, texelFetch(t, ivec2(x1, y1), 0).r, wx);
  return mix(a, b, wy);
}
int cls(sampler2D t, vec2 ll) {
  ivec2 sz = textureSize(t, 0);
  int x = int(mod(floor((ll.x + 180.0) / 360.0 * float(sz.x)), float(sz.x)));
  int y = clamp(int(floor((ll.y + 90.0) / 180.0 * float(sz.y))), 0, sz.y - 1);
  return int(texelFetch(t, ivec2(x, y), 0).r * 255.0 + 0.5);
}
vec3 ramp(int row, float x) {
  return texture(rampT, vec2((clamp(x, 0.0, 1.0) * 255.0 + 0.5) / 256.0, (float(row) + 0.5) / float(nRamps))).rgb * 255.0;
}
vec3 rock(float z) { return ramp(R_ROCK, (z - BED_LO) / (BED_HI - BED_LO)); }
vec3 seaC(float z) { return ramp(R_SEA, 1.0 - min(1.0, -z / 6000.0)); }
float nrm(float x) {
  if (logScale) { float l0 = log(max(lo, 1e-6)); return (log(max(x, lo)) - l0) / (log(hi) - l0); }
  return (x - lo) / (hi - lo);
}
int vegComp(sampler2D h, sampler2D v, vec2 ll, float z) {
  if (bil(h, ll) > ICE_MIN) return 1;
  if (z < 0.0) return 0;
  int c = cls(v, ll);
  return c == 0 ? 255 : c;
}
void main() {
  vec3 d = normalize(vPos);
  float lat = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float phi = atan(d.z, -d.x);
  if (phi < 0.0) phi += 2.0 * PI;
  vec2 ll = vec2(degrees(phi) - 180.0, lat);

  float z = bil(bedT, ll);
  bool sea = z < 0.0;
  vec3 N = normalize(texture(nrmT, vec2((ll.x + 180.0) / 360.0, (ll.y + 90.0) / 180.0)).xyz * 2.0 - 1.0);
  // relief only: a flat surface stays at 1 wherever it is on the disc (no day/night)
  float sh = clamp(1.0 + (dot(N, lightDir) - dot(d, lightDir)) / 0.707, 0.35, 1.25);

  vec3 c;
  if (stage == 0) {
    c = rock(z) * sh;
  } else if (stage == 1) {
    c = sea ? seaC(z) : rock(z) * sh;
  } else if (stage == 4) {
    if (src == 2) {
      int m = vegComp(hM, vM, ll, z), t = vegComp(hT, vT, ll, z);
      if (m == 0 && t == 0) c = vec3(${AGREE.sea.join(",")});
      else if (t == 255) c = vec3(${AGREE.none.join(",")});
      else {
        c = m == t ? vec3(${AGREE.same.join(",")}) : (m == 1 || t == 1) ? vec3(${AGREE.ice.join(",")}) : vec3(${AGREE.veg.join(",")});
        if (!sea) c *= 0.85 + 0.15 * sh;
      }
    } else {
      int k = src == 1 ? vegComp(hT, vT, ll, z) : vegComp(hM, vM, ll, z);
      c = k == 0 ? seaC(z) : texelFetch(palT, ivec2(k, 0), 0).rgb * 255.0 * (0.8 + 0.2 * sh);
    }
  } else {
    float m = bil(fM, ll), t = bil(fT, ll);
    float x = src == 2 ? m - t : src == 0 ? m : t;
    if (stage == 3) {
      bool show = src == 2 ? abs(x) >= 1.0 : x > ICE_MIN;
      if (show) c = ramp(rampRow, nrm(x)) * (0.85 + 0.15 * sh);
      else c = sea ? seaC(z) * 0.8 : rock(z) * sh * 0.85;
    } else {
      c = ramp(rampRow, nrm(x));
      if (!sea) c *= 0.8 + 0.2 * sh;
    }
  }
  // coastline: the 0 m contour, drawn about one screen pixel wide at any zoom
  if (stage != 0) {
    float w = max(fwidth(z), 1e-3);
    c *= mix(0.35, 1.0, smoothstep(0.6, 1.4, abs(z) / w));
  }
  gl_FragColor = vec4(clamp(c, 0.0, 255.0) / 255.0, 1.0);
}`;
// ---------------------------------------------------------------- legend, score, note
const MODE_JA = { fit: "地球適合", holdout: "地域保留" };
const pct = (x) => (x * 100).toFixed(0) + "%";
function legend() {
  const barWrap = document.getElementById("bar-wrap"), cls = document.getElementById("classes");
  const veg = state.v === "veg";
  barWrap.hidden = veg; cls.hidden = !veg;
  let score = "", note = "";
  if (veg) {
    cls.innerHTML = "";
    const item = (rgb, text, n) => {
      const div = document.createElement("div");
      div.innerHTML = `<i style="background:rgb(${rgb.join(",")})"></i><span>${text}</span>` + (n != null ? `<span class="n">${n}</span>` : "");
      cls.appendChild(div);
    };
    const sc = V.scores[state.mode];
    if (state.src === "diff") {
      item(AGREE.same, "一致"); item(AGREE.veg, "植生が不一致"); item(AGREE.ice, "氷の有無が不一致");
      item(AGREE.none, "教師なし"); item(AGREE.sea, "海");
    } else {
      for (const c of V.classes) {
        const iou = sc.iou[String(c.code)];
        item(c.rgb, c.ja, state.src === "model" && iou != null ? Math.round(iou * 100) : null);
      }
      item(vcol[1], "陸氷"); item(seaColour(-3000), "海");
      if (state.src === "teacher") item(vcol[255], "教師なし");
    }
    score = `${MODE_JA[state.mode]}：15区分 一致 ${pct(sc.accuracy)}・κ ${sc.kappa.toFixed(2)}・大区分 ${pct(sc.group)}`;
    note = {
      model: "モデル：年平均の気温・降水・水蒸気圧（この地球儀の3〜5段階と同じ推定値）と岩盤地形から分類した、通年の代表的な自然植生。数字は種類ごとの一致度（%）。",
      teacher: "教師：Ramankutty & Foley (1999) 潜在自然植生（人の土地利用が無い場合）。南極は教師に区分が無い。",
      diff: "差：モデルと教師を、氷＞海＞植生の順に重ねた最終表示どうしで比べた一致・不一致。",
    }[state.src] + " 重ね順は 氷＞海＞植生。限界：年平均だけなので季節性（常緑/落葉、雨季の有無）は区別できない。";
  } else {
    const bc = document.getElementById("bar").getContext("2d");
    let rp, lo, hi, unit;
    if (!isClimate()) { rp = "rock"; lo = BED_LO; hi = BED_HI; unit = "m"; }
    else { const sc = scale(); rp = sc.ramp; lo = sc.lo; hi = sc.hi; unit = vm().unit; }
    for (let i = 0; i < 256; i++) {
      const c = state.v === "sea" && i < 146 ? seaColour(BED_LO + (i / 255) * (BED_HI - BED_LO)) : ramp(rp, i / 255);
      bc.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; bc.fillRect(i, 0, 1, 1);
    }
    const fmt = (x) => Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(Math.abs(x) >= 10 ? 0 : 1);
    document.getElementById("lo").textContent = fmt(lo);
    document.getElementById("hi").textContent = fmt(hi);
    document.getElementById("unit").textContent = unit + (state.src === "diff" && isClimate() ? "（差）" : "");
    if (!isClimate()) { score = S.stages[state.v].score; note = S.stages[state.v].note; }
    else {
      score = `${MODE_JA[state.mode]}：${vm().score[state.mode]}`;
      note = (state.src === "teacher" ? vm().teacherNote : state.src === "model" ? vm().modelNote : "差 = モデル − 教師。") +
        " " + S.modeNote[state.mode];
    }
  }
  if (isClimate() || veg) note += " 地球適合＝見たことのある場所への当てはめ（ほぼ一致して当然）。実力の目安は地域保留。";
  document.getElementById("score").textContent = score;
  document.getElementById("note").textContent = note;
}

// ---------------------------------------------------------------- readout at the crosshair
function readoutText(lng, lat) {
  const pos = `中央 ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(1)}°${lng >= 0 ? "E" : "W"}`;
  const z = bed(lng, lat);
  const tag = `モデル（${MODE_JA[state.mode]}）`;
  if (state.v === "bed" || state.v === "sea") {
    const what = state.v === "sea" ? (z < 0 ? "・海" : "・陸") : "";
    return `${pos}<br><b class="m">入力</b> 岩盤 ${z.toFixed(0)} m${what}　<b class="t">教師</b> なし（入力データの段階）`;
  }
  if (state.v === "veg") {
    const m = vegComposite(state.mode, lng, lat), t = vegComposite("teacher", lng, lat);
    return `${pos}<br><b class="m">${tag}</b> ${vlab[m]}　<b class="t">教師</b> ${vlab[t]}`;
  }
  const m0 = vm(), key = m0.key;
  const mod = bilinear(`${key}_${state.mode}`, lng, lat), tea = bilinear(`${key}_teacher`, lng, lat);
  const f = (x) => Number.isFinite(x) ? x.toFixed(m0.digits) : null;
  const iceTxt = (x) => x > ICE_MIN_M ? `${f(x)} m` : "氷なし";
  const mv = state.v === "ice" ? iceTxt(mod) : `${f(mod)} ${m0.unit}`;
  const tv = f(tea) == null ? "教師なし" : state.v === "ice" ? iceTxt(tea) : `${f(tea)} ${m0.unit}`;
  const dv = f(tea) == null ? "" : `　差 ${mod - tea >= 0 ? "+" : ""}${f(mod - tea)}`;
  return `${pos}<br><b class="m">${tag}</b> ${mv}　<b class="t">教師</b> ${tv}${dv}`;
}

// ---------------------------------------------------------------- scene
const el = document.getElementById("globe");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
el.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 30);
{
  const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(22.5)) * Math.min(1, innerWidth / innerHeight));
  const d = 1.08 / Math.sin(half);
  camera.position.set(0, 0.25 * d, 0.97 * d);
}
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false; controls.minDistance = 1.2; controls.maxDistance = 9; controls.rotateSpeed = 0.5;
// geometry only: every pixel derives lng/lat from its own direction, so the
// mesh carries no UVs and needs no antimeridian split
const geom = buildCubeSphere(127, { metresAt: () => 0, radiusForMetres: () => 1 });
const uniforms = {
  bedT: { value: null }, nrmT: { value: null }, fM: { value: null }, fT: { value: null },
  hM: { value: null }, hT: { value: null }, vM: { value: null }, vT: { value: null },
  rampT: { value: null }, palT: { value: null },
  stage: { value: 0 }, src: { value: 0 }, rampRow: { value: 0 }, nRamps: { value: RAMP_ROWS.length },
  lo: { value: 0 }, hi: { value: 1 }, logScale: { value: false }, lightDir: { value: new THREE.Vector3(0, 0, 1) },
};
const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms });
const globe = new THREE.Mesh(geom, material);
globe.visible = false;
scene.add(globe);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// light from the upper left of the view, 38 degrees off the line of sight
// (the main app's choice): relief reads the same way wherever you look
const LIGHT_OFF = THREE.MathUtils.degToRad(38);
const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
function updateLight() {
  _v.copy(camera.position).normalize();
  _r.setFromMatrixColumn(camera.matrixWorld, 0); _u.setFromMatrixColumn(camera.matrixWorld, 1);
  uniforms.lightDir.value.copy(_v).multiplyScalar(Math.cos(LIGHT_OFF))
    .addScaledVector(_u.sub(_r).normalize(), Math.sin(LIGHT_OFF)).normalize();
}

const ray = new THREE.Raycaster();
function centre() {
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const d = ray.ray.direction, o = ray.ray.origin;
  const b = o.dot(d), c = o.dot(o) - 1, disc = b * b - c;
  if (disc < 0) return null;
  const p = o.clone().addScaledVector(d, -b - Math.sqrt(disc));
  return directionToLngLat(p.x, p.y, p.z);
}
let lastReadout = "";
function updateReadout() {
  const c = centre();
  const html = c ? readoutText(c.lng, c.lat) : "中央: 地球の外";
  if (html !== lastReadout) { document.getElementById("readout").innerHTML = html; lastReadout = html; }
}

let frame = 0, applied = 0, pending = false;
renderer.setAnimationLoop(() => {
  controls.update();
  camera.updateMatrixWorld();
  updateLight();
  renderer.render(scene, camera);
  if (pending) { pending = false; applied++; }
  if (ready && (frame++ % 6 === 0)) updateReadout();
});

// ---------------------------------------------------------------- controls
const STAGE = { bed: 0, sea: 1, t2m: 2, hum: 2, precip: 2, ice: 3, veg: 4 };
function apply() {
  const u = uniforms;
  u.stage.value = STAGE[state.v];
  u.src.value = { model: 0, teacher: 1, diff: 2 }[state.src];
  if (isClimate()) {
    const key = vm().key, sc = scale();
    u.fM.value = T[`${key}_${state.mode}`]; u.fT.value = T[`${key}_teacher`];
    u.rampRow.value = RAMP_ROWS.indexOf(sc.ramp); u.lo.value = sc.lo; u.hi.value = sc.hi; u.logScale.value = sc.log;
  } else {
    u.fM.value = u.fT.value = T.T_fit;          // unused, but every sampler must be bound
  }
  u.hM.value = T[`H_${state.mode}`]; u.hT.value = T.H_teacher;
  u.vM.value = T[`veg_${state.mode}`]; u.vT.value = T.veg_teacher;
  legend();
  pending = true;
}
function sync() {
  for (const b of document.querySelectorAll("button[data-v]")) b.classList.toggle("on", b.dataset.v === state.v);
  for (const b of document.querySelectorAll("button[data-src]")) b.classList.toggle("on", b.dataset.src === state.src);
  for (const b of document.querySelectorAll("button[data-mode]")) b.classList.toggle("on", b.dataset.mode === state.mode);
  const input = state.v === "bed" || state.v === "sea";
  document.getElementById("srcRow").classList.toggle("off", input);
  document.getElementById("modeRow").classList.toggle("off", input);
  lastReadout = "";
  apply();
  updateReadout();
}
for (const b of document.querySelectorAll("button[data-v]")) b.onclick = () => { state.v = b.dataset.v; sync(); };
for (const b of document.querySelectorAll("button[data-src]")) b.onclick = () => { state.src = b.dataset.src; sync(); };
for (const b of document.querySelectorAll("button[data-mode]")) b.onclick = () => { state.mode = b.dataset.mode; sync(); };
document.getElementById("noteBtn").onclick = (e) => {
  const n = document.getElementById("note"); n.hidden = !n.hidden; e.target.classList.toggle("on", !n.hidden);
};

load().then(() => {
  buildTextures();
  uniforms.bedT.value = T.bed; uniforms.nrmT.value = T.normal;
  uniforms.rampT.value = T.ramp; uniforms.palT.value = T.pal;
  globe.visible = true;
  ready = true;
  sync();
  document.getElementById("loading").remove();
  window.__akReady = true;
  window.__akPaints = () => applied;
  // test hook: look at (lng, lat) from distance r (default: the current one)
  window.__look = (lng, lat, dist) => {
    const d = lngLatToDirection(lng, lat), r = dist || camera.position.length();
    camera.position.set(d.x * r, d.y * r, d.z * r); controls.update();
  };
}).catch((e) => { document.getElementById("loading").textContent = "読み込み失敗: " + e; });
