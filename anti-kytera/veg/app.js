// Anti-KyTerra vegetation preview: one map of the representative (all-year)
// potential natural vegetation, drawn as ice > sea > vegetation over the
// PR #12 bedrock. Model (地球適合 / 地域保留, kept apart), the vegetation
// teacher, or where the two agree. Data: results/veg_display.json + veg_fields.bin.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildCubeSphere } from "../../js/cubeSphere.js";
import { directionToLngLat, lngLatToDirection } from "../../js/geoConvert.js";

const TEX_W = 2048, TEX_H = 1024;
const state = { src: "model", mode: "fit" };
let meta, F = {}, shade, ready = false, colour = {}, label = {};

async function loadBin() { return (await fetch("./results/veg_fields.bin")).arrayBuffer(); }
async function load() {
  meta = await (await fetch("./results/veg_display.json")).json();
  const buf = await loadBin();
  for (const [k, f] of Object.entries(meta.fields))
    F[k] = new (f.dtype === "i16" ? Int16Array : Uint8Array)(buf, f.offset, f.w * f.h);
  for (const c of meta.classes) { colour[c.code] = c.rgb; label[c.code] = c.ja; }
  for (const [k, s] of Object.entries(meta.special)) { colour[k] = s.rgb; label[k] = s.ja; }
  buildShade();
}

function cellIndex(name, lng, lat) {
  const f = meta.fields[name];
  const y = Math.min(f.h - 1, Math.max(0, Math.floor((lat + 90) / 180 * f.h)));
  const x = ((Math.floor((lng + 180) / 360 * f.w) % f.w) + f.w) % f.w;
  return y * f.w + x;
}
const at = (name, lng, lat) => F[name][cellIndex(name, lng, lat)];

function buildShade() {
  const f = meta.fields.bed, a = F.bed, W = f.w, H = f.h;
  shade = new Float32Array(W * H);
  const R = 6.371e6, dy = Math.PI * R / H;
  for (let j = 0; j < H; j++) {
    const lat = (j + 0.5) / H * Math.PI - Math.PI / 2;
    const dx = Math.max(Math.cos(lat), 0.02) * 2 * Math.PI * R / W;
    for (let i = 0; i < W; i++) {
      const gx = (a[j * W + (i + 1) % W] - a[j * W + (i - 1 + W) % W]) / (2 * dx) * 10;
      const gy = (a[Math.min(H - 1, j + 1) * W + i] - a[Math.max(0, j - 1) * W + i]) / (2 * dy) * 10;
      const nz = 1 / Math.sqrt(1 + gx * gx + gy * gy);
      shade[j * W + i] = Math.max(0.72, Math.min(1.12, (0.5 * gx - 0.5 * gy + 0.707) * nz / 0.707));
    }
  }
}

// The composite class at a point: ice > sea > vegetation (see DRAW_ORDER).
function composite(which, lng, lat) {
  if (at(`ice_${which}`, lng, lat)) return 1;
  if (at("bed", lng, lat) < 0) return 0;
  const v = at(`veg_${which}`, lng, lat);
  return v || 255;
}

const canvas = document.createElement("canvas");
canvas.width = TEX_W; canvas.height = TEX_H;
const ctx = canvas.getContext("2d");

function paint() {
  const img = ctx.createImageData(TEX_W, TEX_H), d = img.data;
  const which = state.src === "teacher" ? "teacher" : state.mode;
  for (let py = 0; py < TEX_H; py++) {
    const lat = 90 - (py + 0.5) / TEX_H * 180;
    for (let px = 0; px < TEX_W; px++) {
      const lng = (px + 0.5) / TEX_W * 360 - 180;
      const bi = cellIndex("bed", lng, lat), z = F.bed[bi], sea = z < 0;
      let c;
      if (state.src === "diff") {
        const m = composite(state.mode, lng, lat), t = composite("teacher", lng, lat);
        if (m === 0 && t === 0) c = [20, 40, 70];
        else if (t === 255) c = [90, 90, 90];
        else if (m === t) c = [70, 170, 90];
        else if (m === 1 || t === 1) c = [120, 150, 220];      // ice disagreement
        else c = [215, 70, 60];
      } else {
        const k = composite(which, lng, lat);
        c = colour[k];
        if (k === 0) c = c.map((v, i) => v * (0.55 + 0.45 * Math.max(0, 1 + z / 6000)) + (i === 2 ? 20 : 0));
      }
      const s = sea ? 1 : shade[bi];
      // coastline at the fixed 0 m boundary
      const e = at("bed", lng + 0.2, lat) < 0, n = at("bed", lng, lat + 0.2) < 0;
      const k = (e !== sea || n !== sea) ? 0.45 : 1;
      const o = (py * TEX_W + px) * 4;
      d[o] = c[0] * s * k; d[o + 1] = c[1] * s * k; d[o + 2] = c[2] * s * k; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  texture.needsUpdate = true;
  texts();
}

const pct = (x) => (x * 100).toFixed(0) + "%";
function texts() {
  const sc = meta.scores[state.mode];
  const mode = state.mode === "fit" ? "地球適合" : "地域保留";
  document.getElementById("score").textContent = state.src === "teacher"
    ? "教師：Ramankutty & Foley 潜在自然植生（0.5°）"
    : `${mode}：一致 ${pct(sc.accuracy)}・κ ${sc.kappa.toFixed(2)}・大区分 ${pct(sc.group)}（陸の教師セル、面積重み）`;
  const L = document.getElementById("legend");
  L.innerHTML = "";
  const item = (rgb, text, n) => {
    const div = document.createElement("div");
    div.innerHTML = `<i style="background:rgb(${rgb.join(",")})"></i><span>${text}</span>` + (n != null ? `<span class="n">${n}</span>` : "");
    L.appendChild(div);
  };
  if (state.src === "diff") {
    item([70, 170, 90], "一致"); item([215, 70, 60], "植生が不一致"); item([120, 150, 220], "氷の有無が不一致");
    item([90, 90, 90], "教師なし"); item([20, 40, 70], "海");
  } else {
    for (const c of meta.classes) {
      const iou = sc.iou[String(c.code)];
      item(c.rgb, c.ja, state.src === "model" && iou != null ? Math.round(iou * 100) : null);
    }
    item(meta.special["1"].rgb, "陸氷"); item(meta.special["0"].rgb, "海");
    if (state.src === "teacher") item(meta.special["255"].rgb, "教師なし");
  }
  const notes = {
    model: "モデル：年平均の気温・降水・水蒸気圧（PR #12 の推定値）と岩盤地形の特徴だけから、代表的な自然植生を分類。数字は種類ごとの一致度（IoU, %）。",
    teacher: "教師：Ramankutty & Foley (1999) 潜在自然植生。人の土地利用がない場合の植生。南極は教師に分類がない。",
    diff: "一致：モデルと教師を、氷＞海＞植生の順で重ねた最終表示どうしで比較。",
  };
  document.getElementById("note").textContent = notes[state.src] +
    (state.src !== "teacher" ? (state.mode === "fit" ? " 地球適合＝地球全体で学習し同じ地球に当てはめた値（ほぼ一致して当然）。" :
      " 地域保留＝経度60°の6帯ごとに、その帯を学習から外して予測（気候入力も地域保留版）。") : "") +
    " 限界：入力が年平均だけなので、季節性（常緑と落葉、季節林と多雨林、雨季の有無）は直接は区別できない。氷は PR #12 の推定（教師表示では GEBCO 氷厚 >10 m）。";
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
  camera.position.set(0.5 * d, 0.3 * d, 0.8 * d);
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
  const m = composite(state.mode, lng, lat), t = composite("teacher", lng, lat);
  out.textContent = `中央 ${lat.toFixed(1)}°, ${lng.toFixed(1)}°  モデル ${label[m]} / 教師 ${label[t]}`;
}

let frame = 0;
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  if (ready && (frame++ % 6 === 0)) updateReadout();
});

for (const b of document.querySelectorAll("button[data-src]")) b.onclick = () => { state.src = b.dataset.src; sync(); };
for (const b of document.querySelectorAll("button[data-mode]")) b.onclick = () => { state.mode = b.dataset.mode; sync(); };
document.getElementById("legendBtn").onclick = (e) => {
  const L = document.getElementById("legend"); L.hidden = !L.hidden; e.target.classList.toggle("on", !L.hidden);
};
document.getElementById("noteBtn").onclick = (e) => {
  const N = document.getElementById("note"); N.hidden = !N.hidden; e.target.classList.toggle("on", !N.hidden);
};
function sync() {
  for (const b of document.querySelectorAll("button[data-src]")) b.classList.toggle("on", b.dataset.src === state.src);
  for (const b of document.querySelectorAll("button[data-mode]")) b.classList.toggle("on", b.dataset.mode === state.mode);
  document.getElementById("modeRow").style.opacity = state.src === "teacher" ? 0.4 : 1;
  requestAnimationFrame(() => paint());
}

load().then(() => {
  ready = true;
  paint();
  document.getElementById("loading").remove();
  window.__akReady = true;
  // test hook: look at (lng, lat) from the current distance
  window.__look = (lng, lat) => {
    const d = lngLatToDirection(lng, lat), r = camera.position.length();
    camera.position.set(d.x * r, d.y * r, d.z * r); controls.update();
  };
}).catch((e) => { document.getElementById("loading").textContent = "読み込み失敗: " + e; });
