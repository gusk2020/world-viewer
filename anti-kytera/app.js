// Anti-KyTerra comparison globe. Shows, for three variables, the model field,
// the teacher field on the SAME grid/units/period, and their difference.
// All numbers come from results/display.json + results/fields.bin, written
// by model/export_display.py. Nothing here computes climate.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildCubeSphere } from "../js/cubeSphere.js";
import { directionToLngLat } from "../js/geoConvert.js";

const TEX_W = 2048, TEX_H = 1024;

// colour ramps: [value(0..1), r, g, b]
const RAMPS = {
  temp: [[0, 40, 20, 120], [0.25, 60, 110, 220], [0.45, 190, 225, 245], [0.55, 250, 245, 200],
         [0.75, 245, 150, 60], [1, 150, 20, 30]],
  precip: [[0, 150, 90, 40], [0.15, 225, 200, 130], [0.35, 235, 240, 200], [0.55, 110, 200, 120],
           [0.8, 30, 120, 170], [1, 40, 30, 120]],
  ice: [[0, 235, 245, 255], [0.3, 150, 200, 240], [0.7, 50, 110, 200], [1, 20, 30, 110]],
  diff: [[0, 30, 60, 170], [0.5, 245, 245, 245], [1, 180, 30, 30]],
};

function ramp(name, x) {
  const r = RAMPS[name];
  x = Math.min(1, Math.max(0, x));
  for (let i = 1; i < r.length; i++) {
    if (x <= r[i][0]) {
      const t = (x - r[i - 1][0]) / (r[i][0] - r[i - 1][0]);
      return [0, 1, 2].map((k) => r[i - 1][k + 1] + t * (r[i][k + 1] - r[i - 1][k + 1]));
    }
  }
  return r[r.length - 1].slice(1);
}

const state = { v: "t2m", src: "model", run: null };
let meta, fields = {}, ready = false;

async function load() {
  meta = await (await fetch("./results/display.json")).json();
  const buf = await (await fetch("./results/fields.bin")).arrayBuffer();
  for (const [name, f] of Object.entries(meta.fields)) {
    fields[name] = new Float32Array(buf, f.offset, f.w * f.h);
  }
}

// bilinear sample of a south-first, -180-start field; NaN-aware
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

function nearest(name, lng, lat) {
  const f = meta.fields[name];
  const y = Math.min(f.h - 1, Math.max(0, Math.floor((lat + 90) / 180 * f.h)));
  const x = Math.min(f.w - 1, Math.max(0, Math.floor((lng + 180) / 360 * f.w)));
  return fields[name][y * f.w + x];
}

function tName(vm) { return vm.teacherPerRun ? vm.teacher + state.run : vm.teacher; }

function valueAt(lng, lat) {
  const vm = meta.vars[state.v];
  const m = sample(vm.model + state.run, lng, lat), t = sample(tName(vm), lng, lat);
  return { m, t, d: m - t };
}

function currentScale() {
  const vm = meta.vars[state.v];
  if (state.src === "diff") return { ramp: "diff", lo: -vm.diffRange, hi: vm.diffRange, log: false };
  return { ramp: vm.ramp, lo: vm.lo, hi: vm.hi, log: !!vm.log };
}

function norm(sc, x) {
  if (sc.log) {
    const l = (v) => Math.log10(Math.max(v, sc.lo));
    return (l(x) - l(sc.lo)) / (l(sc.hi) - l(sc.lo));
  }
  return (x - sc.lo) / (sc.hi - sc.lo);
}

const canvas = document.createElement("canvas");
canvas.width = TEX_W; canvas.height = TEX_H;
const ctx = canvas.getContext("2d");

function paint() {
  const vm = meta.vars[state.v];
  const sc = currentScale();
  const img = ctx.createImageData(TEX_W, TEX_H);
  const name = state.src === "model" ? vm.model + state.run : tName(vm);
  const isIce = state.v === "ice";
  for (let py = 0; py < TEX_H; py++) {
    const lat = 90 - (py + 0.5) / TEX_H * 180;
    for (let px = 0; px < TEX_W; px++) {
      const lng = (px + 0.5) / TEX_W * 360 - 180;
      const land = nearest("land", lng, lat) > 0.5;
      let x;
      if (state.src === "diff") {
        const a = sample(vm.model + state.run, lng, lat), b = sample(tName(vm), lng, lat);
        x = a - b;
      } else {
        x = sample(name, lng, lat);
      }
      let c;
      if (isIce && state.src !== "diff" && !(x > 1)) {
        c = land ? [120, 110, 95] : [28, 44, 70];
      } else if (isIce && state.src === "diff" && Math.abs(x) < 1) {
        c = land ? [120, 110, 95] : [28, 44, 70];
      } else if (!Number.isFinite(x)) {
        c = [60, 60, 60];
      } else {
        c = ramp(sc.ramp, norm(sc, x));
      }
      // coastline: darken land/sea transitions
      const e = nearest("land", lng + 0.25, lat) > 0.5, n = nearest("land", lng, lat + 0.25) > 0.5;
      const k = (e !== land || n !== land) ? 0.35 : (land || isIce ? 1 : 0.88);
      const o = (py * TEX_W + px) * 4;
      img.data[o] = c[0] * k; img.data[o + 1] = c[1] * k; img.data[o + 2] = c[2] * k; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  texture.needsUpdate = true;
  // legend
  const bar = document.getElementById("bar"), bc = bar.getContext("2d");
  for (let i = 0; i < 256; i++) {
    const c = ramp(sc.ramp, i / 255);
    bc.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; bc.fillRect(i, 0, 1, 1);
  }
  document.getElementById("lo").textContent = fmt(sc.lo);
  document.getElementById("hi").textContent = fmt(sc.hi);
  document.getElementById("unit").textContent = vm.unit;
  document.getElementById("note").textContent =
    (state.src === "teacher" ? vm.teacherNote : state.src === "model" ? vm.modelNote : "差 = モデル − 教師。") + " " + meta.caveat;
}

function fmt(x) { return Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(Math.abs(x) >= 10 ? 0 : 1); }

// ---------------------------------------------------------------- scene
const el = document.getElementById("globe");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
el.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 30);
// start far enough that the whole globe fits the narrower screen dimension
{
  const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(22.5)) * Math.min(1, innerWidth / innerHeight));
  const d = 1.08 / Math.sin(half);
  camera.position.set(0, 0.25 * d, 0.97 * d);
}
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false; controls.minDistance = 1.2; controls.maxDistance = 9;
controls.rotateSpeed = 0.5;
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
  const t = -b - Math.sqrt(disc);
  const p = o.clone().addScaledVector(d, t);
  const { lng, lat } = directionToLngLat(p.x, p.y, p.z);
  const v = valueAt(lng, lat), vm = meta.vars[state.v];
  const f = (x) => Number.isFinite(x) ? x.toFixed(vm.digits) : "–";
  out.textContent = `中央 ${lat.toFixed(1)}°, ${lng.toFixed(1)}°  モデル ${f(v.m)} / 教師 ${f(v.t)} / 差 ${f(v.d)} ${vm.unit}`;
}

let frame = 0;
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  if (ready && (frame++ % 6 === 0)) updateReadout();
});

for (const b of document.querySelectorAll("button[data-var]")) {
  b.onclick = () => { state.v = b.dataset.var; sync(); };
}
for (const b of document.querySelectorAll("button[data-src]")) {
  b.onclick = () => { state.src = b.dataset.src; sync(); };
}
function buildRunButtons() {
  const row = document.getElementById("runs");
  for (const r of meta.runs) {
    const b = document.createElement("button");
    b.dataset.run = r.key; b.textContent = r.label;
    b.onclick = () => { state.run = r.key; sync(); };
    row.appendChild(b);
  }
  state.run = meta.default || meta.runs[meta.runs.length - 1].key;
}
function sync(repaint = true) {
  for (const b of document.querySelectorAll("button[data-var]")) b.classList.toggle("on", b.dataset.var === state.v);
  for (const b of document.querySelectorAll("button[data-src]")) b.classList.toggle("on", b.dataset.src === state.src);
  for (const b of document.querySelectorAll("button[data-run]")) b.classList.toggle("on", b.dataset.run === state.run);
  if (repaint) requestAnimationFrame(() => paint());
}

load().then(() => {
  buildRunButtons();
  ready = true;
  paint();
  sync(false);
  document.getElementById("loading").remove();
  window.__akReady = true;
}).catch((e) => { document.getElementById("loading").textContent = "読み込み失敗: " + e; });
