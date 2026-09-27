// Anti-KyTerra staged globe: 1 bedrock only -> 2 sea at 0 m -> 3 temperature
// -> 4 humidity -> 5 precipitation -> 6 land ice. For stages 3-6 the model,
// the teacher (same variable/unit/period/grid) and their difference, in two
// clearly separated modes: 地球適合 (fitted on all of Earth) and 地域保留
// (each 60-degree longitude sector predicted by models that never saw it).
// All numbers come from results/display.json + results/fields.bin.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildCubeSphere } from "../js/cubeSphere.js";
import { directionToLngLat } from "../js/geoConvert.js";

const TEX_W = 2048, TEX_H = 1024;
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

function ramp(name, x) {
  const r = RAMPS[name];
  x = Math.min(1, Math.max(0, x));
  for (let i = 1; i < r.length; i++) if (x <= r[i][0]) {
    const t = (x - r[i - 1][0]) / (r[i][0] - r[i - 1][0]);
    return [0, 1, 2].map((k) => r[i - 1][k + 1] + t * (r[i][k + 1] - r[i - 1][k + 1]));
  }
  return r[r.length - 1].slice(1);
}

const state = { v: "bed", src: "model", mode: "fit" };
let meta, fields = {}, ready = false, shade;

async function load() {
  meta = await (await fetch("./results/display.json")).json();
  const buf = await loadBin();
  for (const [name, f] of Object.entries(meta.fields)) {
    const C = f.dtype === "i16" ? Int16Array : Float32Array;
    fields[name] = new C(buf, f.offset, f.w * f.h);
  }
  buildShade();
}
async function loadBin() { return (await fetch("./results/fields.bin")).arrayBuffer(); }

function sample(name, lng, lat) {
  const f = meta.fields[name], a = fields[name];
  const fy = (lat + 90) / 180 * f.h - 0.5, fx = (lng + 180) / 360 * f.w - 0.5;
  const y0 = Math.max(0, Math.min(f.h - 1, Math.floor(fy))), y1 = Math.min(f.h - 1, y0 + 1);
  const wy = Math.max(0, Math.min(1, fy - y0));
  let x0 = Math.floor(fx); const wx = fx - x0;
  x0 = ((x0 % f.w) + f.w) % f.w; const x1 = (x0 + 1) % f.w;
  const v = [a[y0 * f.w + x0], a[y0 * f.w + x1], a[y1 * f.w + x0], a[y1 * f.w + x1]];
  const w = [(1 - wx) * (1 - wy), wx * (1 - wy), (1 - wx) * wy, wx * wy];
  let s = 0, sw = 0;
  for (let i = 0; i < 4; i++) if (Number.isFinite(v[i])) { s += v[i] * w[i]; sw += w[i]; }
  return sw > 0 ? s / sw : NaN;
}

// hill shading from the bed itself (light from the north-west), per bed cell
function buildShade() {
  const f = meta.fields.bed, a = fields.bed, W = f.w, H = f.h;
  shade = new Float32Array(W * H);
  const R = 6.371e6, dy = Math.PI * R / H;
  for (let j = 0; j < H; j++) {
    const lat = (j + 0.5) / H * Math.PI - Math.PI / 2;
    const dx = Math.max(Math.cos(lat), 0.02) * 2 * Math.PI * R / W;
    for (let i = 0; i < W; i++) {
      const e = a[j * W + (i + 1) % W], wv = a[j * W + (i - 1 + W) % W];
      const n = a[Math.min(H - 1, j + 1) * W + i], s = a[Math.max(0, j - 1) * W + i];
      const gx = (e - wv) / (2 * dx) * 25, gy = (n - s) / (2 * dy) * 25;
      const nz = 1 / Math.sqrt(1 + gx * gx + gy * gy);
      const lx = -0.5, ly = 0.5, lz = 0.707;
      shade[j * W + i] = Math.max(0.35, Math.min(1.25, (-gx * lx - gy * ly + lz) * nz / lz));
    }
  }
}
function shadeAt(lng, lat) {
  const f = meta.fields.bed;
  const y = Math.min(f.h - 1, Math.max(0, Math.floor((lat + 90) / 180 * f.h)));
  const x = Math.min(f.w - 1, Math.max(0, Math.floor((lng + 180) / 360 * f.w)));
  return shade[y * f.w + x];
}

function vmeta() { return meta.vars[state.v]; }
function names() {
  const vm = vmeta();
  return { model: `${vm.key}_${state.mode}`, teacher: `${vm.key}_teacher` };
}
function scale() {
  const vm = vmeta();
  if (state.src === "diff") return { ramp: "diff", lo: -vm.diffRange, hi: vm.diffRange, log: false };
  return { ramp: vm.ramp, lo: vm.lo, hi: vm.hi, log: !!vm.log };
}
function norm(sc, x) {
  if (sc.log) { const l = (v) => Math.log10(Math.max(v, sc.lo)); return (l(x) - l(sc.lo)) / (l(sc.hi) - l(sc.lo)); }
  return (x - sc.lo) / (sc.hi - sc.lo);
}
function rockColour(z) { return ramp("rock", (z - BED_LO) / (BED_HI - BED_LO)); }
function seaColour(z) { return ramp("sea", 1 - Math.min(1, -z / 6000)); }

const canvas = document.createElement("canvas");
canvas.width = TEX_W; canvas.height = TEX_H;
const ctx = canvas.getContext("2d");

function paint() {
  const img = ctx.createImageData(TEX_W, TEX_H);
  const climate = state.v !== "bed" && state.v !== "sea";
  const vm = climate ? vmeta() : null, sc = climate ? scale() : null, nm = climate ? names() : null;
  for (let py = 0; py < TEX_H; py++) {
    const lat = 90 - (py + 0.5) / TEX_H * 180;
    for (let px = 0; px < TEX_W; px++) {
      const lng = (px + 0.5) / TEX_W * 360 - 180;
      const z = sample("bed", lng, lat), sh = shadeAt(lng, lat), sea = z < 0;
      let c;
      if (state.v === "bed") c = rockColour(z).map((v) => v * sh);
      else if (state.v === "sea") c = sea ? seaColour(z) : rockColour(z).map((v) => v * sh);
      else if (state.v === "ice") {
        const x = state.src === "diff" ? sample(nm.model, lng, lat) - sample(nm.teacher, lng, lat)
          : sample(state.src === "model" ? nm.model : nm.teacher, lng, lat);
        const show = state.src === "diff" ? Math.abs(x) >= 1 : x > 1;
        if (show) c = ramp(sc.ramp, norm(sc, x)).map((v) => v * (0.85 + 0.15 * sh));
        else c = sea ? seaColour(z).map((v) => v * 0.8) : rockColour(z).map((v) => v * sh * 0.85);
      } else {
        const x = state.src === "diff" ? sample(nm.model, lng, lat) - sample(nm.teacher, lng, lat)
          : sample(state.src === "model" ? nm.model : nm.teacher, lng, lat);
        c = Number.isFinite(x) ? ramp(sc.ramp, norm(sc, x)) : [60, 60, 60];
        if (!sea) c = c.map((v) => v * (0.8 + 0.2 * sh));
      }
      // coastline at the fixed 0 m boundary (not drawn on the bedrock-only stage)
      if (state.v !== "bed") {
        const e = sample("bed", lng + 0.2, lat) < 0, n = sample("bed", lng, lat + 0.2) < 0;
        if (e !== sea || n !== sea) c = c.map((v) => v * 0.35);
      }
      const o = (py * TEX_W + px) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  texture.needsUpdate = true;
  legendAndText();
}

function fmt(x) { return Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(Math.abs(x) >= 10 ? 0 : 1); }
function legendAndText() {
  const bar = document.getElementById("bar"), bc = bar.getContext("2d");
  let rp, lo, hi, unit;
  if (state.v === "bed" || state.v === "sea") { rp = "rock"; lo = BED_LO; hi = BED_HI; unit = "m"; }
  else { const sc = scale(); rp = sc.ramp; lo = sc.lo; hi = sc.hi; unit = vmeta().unit; }
  for (let i = 0; i < 256; i++) {
    const c = state.v === "sea" && i < 146 ? seaColour(BED_LO + (i / 255) * (BED_HI - BED_LO)) : ramp(rp, i / 255);
    bc.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; bc.fillRect(i, 0, 1, 1);
  }
  document.getElementById("lo").textContent = fmt(lo);
  document.getElementById("hi").textContent = fmt(hi);
  document.getElementById("unit").textContent = unit;
  const st = meta.stages[state.v];
  let note = st ? st.note : "";
  if (!st) {
    note = (state.src === "teacher" ? vmeta().teacherNote : state.src === "model" ? vmeta().modelNote : "差 = モデル − 教師。") +
      " " + (state.mode === "fit" ? meta.modeNote.fit : meta.modeNote.holdout);
    document.getElementById("score").textContent = (state.mode === "fit" ? "地球適合 " : "地域保留 ") + vmeta().score[state.mode];
  } else document.getElementById("score").textContent = st.score || "";
  document.getElementById("note").textContent = note;
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
function updateReadout() {
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const d = ray.ray.direction, o = ray.ray.origin;
  const b = o.dot(d), c = o.dot(o) - 1, disc = b * b - c;
  const out = document.getElementById("readout");
  if (disc < 0) { out.textContent = "中央: –"; return; }
  const p = o.clone().addScaledVector(d, -b - Math.sqrt(disc));
  const { lng, lat } = directionToLngLat(p.x, p.y, p.z);
  const z = sample("bed", lng, lat);
  const pos = `${lat.toFixed(1)}°, ${lng.toFixed(1)}°`;
  if (state.v === "bed" || state.v === "sea") {
    out.textContent = `中央 ${pos}  岩盤 ${z.toFixed(0)} m${state.v === "sea" ? (z < 0 ? "（海）" : "（陸）") : ""}`;
    return;
  }
  const vm = vmeta(), nm = names();
  const m = sample(nm.model, lng, lat), t = sample(nm.teacher, lng, lat);
  const f = (x) => Number.isFinite(x) ? x.toFixed(vm.digits) : "–";
  out.textContent = `中央 ${pos}  モデル ${f(m)} / 教師 ${f(t)} / 差 ${f(m - t)} ${vm.unit}`;
}

let frame = 0;
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  if (ready && (frame++ % 6 === 0)) updateReadout();
});

for (const b of document.querySelectorAll("button[data-var]")) b.onclick = () => { state.v = b.dataset.var; sync(); };
for (const b of document.querySelectorAll("button[data-src]")) b.onclick = () => { state.src = b.dataset.src; sync(); };
for (const b of document.querySelectorAll("button[data-mode]")) b.onclick = () => { state.mode = b.dataset.mode; sync(); };
function sync(repaint = true) {
  for (const b of document.querySelectorAll("button[data-var]")) b.classList.toggle("on", b.dataset.var === state.v);
  for (const b of document.querySelectorAll("button[data-src]")) b.classList.toggle("on", b.dataset.src === state.src);
  for (const b of document.querySelectorAll("button[data-mode]")) b.classList.toggle("on", b.dataset.mode === state.mode);
  const input = state.v === "bed" || state.v === "sea";
  document.getElementById("srcRow").hidden = input;
  document.getElementById("modeRow").hidden = input;
  if (repaint) requestAnimationFrame(() => paint());
}

load().then(() => {
  for (const b of document.querySelectorAll("button[data-var]")) {
    const has = b.dataset.var === "bed" || b.dataset.var === "sea" || meta.vars[b.dataset.var];
    b.disabled = !has; if (!has) b.style.opacity = 0.35;
  }
  ready = true;
  paint();
  sync(false);
  document.getElementById("loading").remove();
  window.__akReady = true;
}).catch((e) => { document.getElementById("loading").textContent = "読み込み失敗: " + e; });
