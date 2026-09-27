// Anti-KyTerra integrated globe: 1 bedrock -> 2 sea at 0 m -> 3 temperature
// -> 4 humidity -> 5 precipitation -> 6 land ice -> 7 all-year potential
// natural vegetation, on one globe. Pure viewer: it only reads the committed
// results of PR #12 (results/display.json + fields.bin) and of the vegetation
// layer (veg/results/veg_display.json + veg_fields.bin). No estimation here.
// 地球適合 and 地域保留 are never mixed: every model value shown or read out is
// the one for the selected mode.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildCubeSphere } from "../../js/cubeSphere.js";
import { directionToLngLat, lngLatToDirection } from "../../js/geoConvert.js";

const TEX_W = 2048, TEX_H = 1024;
const ICE_MIN_M = 10;          // same threshold as the hand-off ice mask
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
const BED_LO = -8000, BED_HI = 6000;
const AGREE = { same: [70, 170, 90], veg: [215, 70, 60], ice: [120, 150, 220], none: [90, 90, 90], sea: [20, 40, 70] };

const state = { v: "bed", src: "model", mode: "fit" };
let S, V, F = {}, shade, ready = false;
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
  buildShade();
}

// ---------------------------------------------------------------- sampling
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
const bed = (lng, lat) => cell("bed", lng, lat);

// Vegetation stage: ice > sea > vegetation (codes: 1 ice, 0 sea, 11-25 veg, 255 no teacher class)
function vegComposite(which, lng, lat) {
  if (cell(`H_${which}`, lng, lat) > ICE_MIN_M) return 1;
  if (bed(lng, lat) < 0) return 0;
  return cell(`veg_${which}`, lng, lat) || 255;
}

function buildShade() {
  const f = F.bed.meta, a = F.bed, W = f.w, H = f.h;
  shade = new Float32Array(W * H);
  const R = 6.371e6, dy = Math.PI * R / H;
  for (let j = 0; j < H; j++) {
    const lat = (j + 0.5) / H * Math.PI - Math.PI / 2;
    const dx = Math.max(Math.cos(lat), 0.02) * 2 * Math.PI * R / W;
    for (let i = 0; i < W; i++) {
      const gx = (a[j * W + (i + 1) % W] - a[j * W + (i - 1 + W) % W]) / (2 * dx) * 25;
      const gy = (a[Math.min(H - 1, j + 1) * W + i] - a[Math.max(0, j - 1) * W + i]) / (2 * dy) * 25;
      const nz = 1 / Math.sqrt(1 + gx * gx + gy * gy);
      shade[j * W + i] = Math.max(0.35, Math.min(1.25, (0.5 * gx - 0.5 * gy + 0.707) * nz / 0.707));
    }
  }
}
const shadeAt = (lng, lat) => {
  const f = F.bed.meta;
  const y = Math.min(f.h - 1, Math.max(0, Math.floor((lat + 90) / 180 * f.h)));
  const x = ((Math.floor((lng + 180) / 360 * f.w) % f.w) + f.w) % f.w;
  return shade[y * f.w + x];
};

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
function norm(sc, x) {
  if (sc.log) { const l = (v) => Math.log10(Math.max(v, sc.lo)); return (l(x) - l(sc.lo)) / (l(sc.hi) - l(sc.lo)); }
  return (x - sc.lo) / (sc.hi - sc.lo);
}
const rockColour = (z) => ramp("rock", (z - BED_LO) / (BED_HI - BED_LO));
const seaColour = (z) => ramp("sea", 1 - Math.min(1, -z / 6000));

// ---------------------------------------------------------------- painting
const canvas = document.createElement("canvas");
canvas.width = TEX_W; canvas.height = TEX_H;
const ctx = canvas.getContext("2d");

function pixel(lng, lat) {
  const z = bed(lng, lat), sh = shadeAt(lng, lat), sea = z < 0;
  const v = state.v;
  if (v === "bed") return rockColour(z).map((c) => c * sh);
  if (v === "sea") return sea ? seaColour(z) : rockColour(z).map((c) => c * sh);
  if (v === "veg") {
    if (state.src === "diff") {
      const m = vegComposite(state.mode, lng, lat), t = vegComposite("teacher", lng, lat);
      if (m === 0 && t === 0) return AGREE.sea;
      if (t === 255) return AGREE.none;
      const c = m === t ? AGREE.same : (m === 1 || t === 1) ? AGREE.ice : AGREE.veg;
      return sea ? c : c.map((x) => x * (0.85 + 0.15 * sh));
    }
    const k = vegComposite(state.src === "teacher" ? "teacher" : state.mode, lng, lat);
    if (k === 0) return seaColour(z);
    return vcol[k].map((x) => x * (0.8 + 0.2 * sh));
  }
  const key = vm().key, sc = scale();
  const mod = bilinear(`${key}_${state.mode}`, lng, lat), tea = bilinear(`${key}_teacher`, lng, lat);
  const x = state.src === "diff" ? mod - tea : state.src === "model" ? mod : tea;
  if (v === "ice") {
    const show = state.src === "diff" ? Math.abs(x) >= 1 : x > 1;
    if (show) return ramp(sc.ramp, norm(sc, x)).map((c) => c * (0.85 + 0.15 * sh));
    return sea ? seaColour(z).map((c) => c * 0.8) : rockColour(z).map((c) => c * sh * 0.85);
  }
  const c = ramp(sc.ramp, norm(sc, x));
  return sea ? c : c.map((q) => q * (0.8 + 0.2 * sh));
}

function paint() {
  const img = ctx.createImageData(TEX_W, TEX_H), d = img.data;
  for (let py = 0; py < TEX_H; py++) {
    const lat = 90 - (py + 0.5) / TEX_H * 180;
    for (let px = 0; px < TEX_W; px++) {
      const lng = (px + 0.5) / TEX_W * 360 - 180;
      let c = pixel(lng, lat);
      if (state.v !== "bed") {       // coastline at the fixed 0 m boundary
        const sea = bed(lng, lat) < 0;
        if ((bed(lng + 0.2, lat) < 0) !== sea || (bed(lng, lat + 0.2) < 0) !== sea) c = c.map((q) => q * 0.35);
      }
      const o = (py * TEX_W + px) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  texture.needsUpdate = true;
  legend();
  paints++;
}

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
const texture = new THREE.CanvasTexture(canvas);
texture.wrapS = THREE.RepeatWrapping;
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
const geom = buildCubeSphere(127, {
  metresAt: () => 0, radiusForMetres: () => 1,
  uAt: (lng) => (lng + 180) / 360, vAt: (lng, lat) => (lat + 90) / 180, splitSeam: true,
});
scene.add(new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ map: texture })));
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

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

let frame = 0;
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  if (ready && (frame++ % 6 === 0)) updateReadout();
});

// ---------------------------------------------------------------- controls
let painting = 0, paints = 0;
function sync() {
  for (const b of document.querySelectorAll("button[data-v]")) b.classList.toggle("on", b.dataset.v === state.v);
  for (const b of document.querySelectorAll("button[data-src]")) b.classList.toggle("on", b.dataset.src === state.src);
  for (const b of document.querySelectorAll("button[data-mode]")) b.classList.toggle("on", b.dataset.mode === state.mode);
  const input = state.v === "bed" || state.v === "sea";
  document.getElementById("srcRow").classList.toggle("off", input);
  document.getElementById("modeRow").classList.toggle("off", input);
  lastReadout = "";
  const token = ++painting;
  // let the pressed button paint before the full repaint blocks the thread
  requestAnimationFrame(() => requestAnimationFrame(() => { if (token === painting) { paint(); updateReadout(); } }));
}
for (const b of document.querySelectorAll("button[data-v]")) b.onclick = () => { state.v = b.dataset.v; sync(); };
for (const b of document.querySelectorAll("button[data-src]")) b.onclick = () => { state.src = b.dataset.src; sync(); };
for (const b of document.querySelectorAll("button[data-mode]")) b.onclick = () => { state.mode = b.dataset.mode; sync(); };
document.getElementById("noteBtn").onclick = (e) => {
  const n = document.getElementById("note"); n.hidden = !n.hidden; e.target.classList.toggle("on", !n.hidden);
};

load().then(() => {
  ready = true;
  sync();
  document.getElementById("loading").remove();
  window.__akReady = true;
  window.__akPaints = () => paints;
  // test hook: look at (lng, lat) from the current distance
  window.__look = (lng, lat) => {
    const d = lngLatToDirection(lng, lat), r = camera.position.length();
    camera.position.set(d.x * r, d.y * r, d.z * r); controls.update();
  };
}).catch((e) => { document.getElementById("loading").textContent = "読み込み失敗: " + e; });
