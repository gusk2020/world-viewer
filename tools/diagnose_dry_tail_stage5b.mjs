// Stage 5B diagnosis: why does more than a quarter of the land come out with
// (near-)zero specific humidity, even under the NCEP 850 hPa oracle wind?
//
// Diagnosis only. No model is changed, nothing is fitted, and no new moisture
// source is added. Every case below is one factor changed at a time, through
// arguments buildMoistureField already accepts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import { buildHumidityField } from "../js/climate-v1/humidity.js";
import { parseWindGrid } from "../js/climate-v1/wind-teacher.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import { buildMoistureField, WIND_MODES } from "../js/climate-v1/moisture.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai"), TEACHER = path.join(WORLD, "teacher");
const ATM = { seaLevelPressureHPa: 1013.25, specificGasConstantJPerKgK: 287.05, vapourGasConstantJPerKgK: 461.52 };
const G = 9.80665;

const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));
const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
const offset = config.terrain.encoding.offsetMetres;
const metres = new Int16Array(png.width * png.height);
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;
const sets = resolveClimateSets(config);
const shipped = sets.sets.find((s) => s.id === sets.defaultId).values;
const params = { ...shipped, ...CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION };
const terrainField = buildTerrainField({
  elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0,
  oceanMask: loadOceanMask(config, REPO), waterSurfaceMask: loadWaterSurfaceMask(config, REPO),
});
const temperatureField = buildTemperatureField({ terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params });
const humidityField = buildHumidityField({
  terrainField, temperatureField, lapseRateCPerKm: params.surfaceLapseRateCPerKm ?? params.lapseRateCPerKm,
  body: { gravityMs2: G }, atmosphere: ATM,
});

const nearestIn = (axis, v, wrap) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < axis.length; i++) { let d = Math.abs(axis[i] - v); if (wrap) d = Math.min(d, 360 - d); if (d < bd) { bd = d; best = i; } }
  return best;
};
const wsum = JSON.parse(readFileSync(path.join(TEACHER, "wind-summary.json"), "utf8"));
const wspec = wsum.grids.level850hPa;
const tu = parseWindGrid(readFileSync(path.join(TEACHER, wspec.files.u)), wspec).values;
const tv = parseWindGrid(readFileSync(path.join(TEACHER, wspec.files.v)), wspec).values;
// The teacher's below-ground cells at 850 hPa. How they are regridded is one
// of the things under test, so both choices are built.
function oracleAt(W, H, maskedAs) {
  const u = new Float64Array(W * H), v = new Float64Array(W * H), masked = new Uint8Array(W * H);
  let n = 0;
  for (let y = 0; y < H; y++) {
    const j = nearestIn(wspec.latitudes, 90 - ((y + 0.5) * 180) / H);
    for (let x = 0; x < W; x++) {
      const i = j * wspec.width + nearestIn(wspec.longitudes, -180 + ((x + 0.5) * 360) / W, true);
      const k = y * W + x;
      if (!Number.isFinite(tu[i]) || !Number.isFinite(tv[i])) {
        masked[k] = 1; n++;
        if (maskedAs === "nearestValid") { // search outward on the same row
          for (let d = 1; d < wspec.width / 2; d++) {
            const a = j * wspec.width + ((nearestIn(wspec.longitudes, -180 + ((x + 0.5) * 360) / W, true) + d) % wspec.width);
            const b = j * wspec.width + ((nearestIn(wspec.longitudes, -180 + ((x + 0.5) * 360) / W, true) - d + wspec.width) % wspec.width);
            if (Number.isFinite(tu[a]) && Number.isFinite(tv[a])) { u[k] = tu[a]; v[k] = tv[a]; break; }
            if (Number.isFinite(tu[b]) && Number.isFinite(tv[b])) { u[k] = tu[b]; v[k] = tv[b]; break; }
          }
        }
        continue;
      }
      u[k] = tu[i]; v[k] = tv[i];
    }
  }
  return { width: W, height: H, uWindMs: u, vWindMs: v, masked, maskedCount: n };
}

const W = 256, H = 128;
const oracle = oracleAt(W, H, "calm");
const oracleFilled = oracleAt(W, H, "nearestValid");

const coarsen = (fine, fw, fh, w, h) => {
  const bx = fw / w, by = fh / h, out = new Float64Array(w * h);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) out[Math.floor(y / by) * w + Math.floor(x / bx)] += fine[y * fw + x];
  for (let i = 0; i < out.length; i++) out[i] /= bx * by;
  return out;
};
const waterFrac = coarsen(Float32Array.from(terrainField.isWaterSurface), terrainField.width, terrainField.height, W, H);
const isLand = (i) => waterFrac[i] < 0.5;
const latOf = (y, h = H) => 90 - ((y + 0.5) * 180) / h;
const lngOf = (x, w = W) => -180 + ((x + 0.5) * 360) / w;
const wt = new Float64Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) wt[y * W + x] = Math.cos((latOf(y) * Math.PI) / 180);
let landW = 0; for (let i = 0; i < W * H; i++) if (isLand(i)) landW += wt[i];

const BASE = { terrainField, temperatureField, humidityField, body: config.body, maxSweeps: 4000, windMode: WIND_MODES.PHYSICAL };
const run = (opts = {}) => buildMoistureField({ ...BASE, wind: oracle, ...opts });

console.log("Stage 5B dry-tail diagnosis. NCEP 850 hPa oracle wind. Nothing changed, nothing fitted.\n");

const ref = run();
const q = ref.specificHumidityKgPerKg;

// === 1. is it really zero? =================================================
console.log("=== 1. how zero is 'zero'? (land area by q, area-weighted) ===");
const bands = [["exactly 0 (float32)", (v) => v === 0], ["< 1e-12", (v) => v > 0 && v < 1e-12],
  ["< 1e-6 (0.001 g/kg)", (v) => v >= 1e-12 && v < 1e-6], ["< 1e-4 (0.1 g/kg)", (v) => v >= 1e-6 && v < 1e-4],
  ["< 1e-3 (1 g/kg)", (v) => v >= 1e-4 && v < 1e-3], [">= 1 g/kg", (v) => v >= 1e-3]];
for (const [label, sel] of bands) {
  let w = 0; for (let i = 0; i < W * H; i++) if (isLand(i) && sel(q[i])) w += wt[i];
  console.log(`  ${label.padEnd(22)} ${((100 * w) / landW).toFixed(2).padStart(6)}%`);
}
// float32 flush: internal double was positive but the stored float32 is 0
console.log("  (the stored field is float32; a double below ~1.4e-45 flushes to exactly 0)");

const ZERO = (i) => q[i] < 1e-6; // "dry tail" = below 0.001 g/kg
let zeroW = 0; for (let i = 0; i < W * H; i++) if (isLand(i) && ZERO(i)) zeroW += wt[i];
console.log(`  DRY TAIL (q < 0.001 g/kg): ${((100 * zeroW) / landW).toFixed(1)}% of land area\n`);

// === 2. where is it? =======================================================
console.log("=== 2. geography of the dry tail ===");
{
  const byLat = new Map();
  for (let y = 0; y < H; y++) {
    const band = Math.floor((latOf(y) + 90) / 15);
    for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!isLand(i)) continue;
      const e = byLat.get(band) || { land: 0, dry: 0 };
      e.land += wt[i]; if (ZERO(i)) e.dry += wt[i]; byLat.set(band, e);
    }
  }
  const rows = [...byLat.entries()].sort((a, b) => b[0] - a[0]);
  console.log("  by latitude band:  " + rows.map(([b, e]) => `${(b * 15 - 90)}..${(b * 15 - 75)}: ${((100 * e.dry) / e.land).toFixed(0)}%`).join("  "));
  const REGIONS = { Amazon: [-70, -55, -8, 2], Sahara: [-8, 28, 18, 28], Australia: [120, 145, -30, -18],
    India: [73, 88, 10, 28], Europe: [0, 30, 45, 58], Indonesia: [100, 130, -8, 6],
    Patagonia: [-73, -67, -52, -40], Baikal: [103, 110, 51, 56], Caspian: [47, 55, 37, 47],
    Tibet: [80, 100, 28, 38], Greenland: [-50, -25, 62, 82], Antarctica: [-180, 180, -90, -70], Congo: [15, 28, -5, 5] };
  const parts = [];
  for (const [name, [l0, l1, a0, a1]] of Object.entries(REGIONS)) {
    let land = 0, dry = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!isLand(i)) continue;
      if (latOf(y) < a0 || latOf(y) > a1 || lngOf(x) < l0 || lngOf(x) > l1) continue;
      land += wt[i]; if (ZERO(i)) dry += wt[i];
    }
    if (land > 0) parts.push(`${name} ${((100 * dry) / land).toFixed(0)}%`);
  }
  console.log("  by region:  " + parts.join("   "));
}

// === 3. distance to water, and whether the upwind chain reaches one =========
console.log("\n=== 3. distance to water, and the upwind chain ===");
{
  // chamfer-ish BFS in cells from any source cell
  const dist = new Int32Array(W * H).fill(-1);
  const queue = [];
  for (let i = 0; i < W * H; i++) if (ref.isSource[i]) { dist[i] = 0; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], y = (i / W) | 0, x = i % W;
    const nb = [y * W + ((x + 1) % W), y * W + ((x + W - 1) % W)];
    if (y > 0) nb.push(i - W);
    if (y < H - 1) nb.push(i + W);
    for (const j of nb) if (dist[j] < 0) { dist[j] = dist[i] + 1; queue.push(j); }
  }
  const hist = (sel) => {
    const out = [0, 0, 0, 0, 0];
    let w = 0;
    for (let i = 0; i < W * H; i++) {
      if (!isLand(i) || !sel(i)) continue;
      const d = dist[i]; w += wt[i];
      out[d <= 2 ? 0 : d <= 5 ? 1 : d <= 10 ? 2 : d <= 20 ? 3 : 4] += wt[i];
    }
    return out.map((v) => ((100 * v) / w).toFixed(0) + "%");
  };
  console.log("  cells from water:      <=2    3-5   6-10  11-20    >20");
  console.log("  dry-tail land:       " + hist(ZERO).map((s) => s.padStart(6)).join(" "));
  console.log("  moist land:          " + hist((i) => !ZERO(i)).map((s) => s.padStart(6)).join(" "));

  // follow the dominant upwind direction and see whether a source is reached
  const u = oracle.uWindMs, v = oracle.vWindMs;
  let reach = 0, calmStop = 0, lost = 0, total = 0, calmSelf = 0;
  const CALM = 1e-9;
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!isLand(i0) || !ZERO(i0)) continue;
    total += wt[i0];
    if (Math.abs(u[i0]) < CALM && Math.abs(v[i0]) < CALM) { calmSelf += wt[i0]; continue; }
    let i = i0, hit = false, stoppedCalm = false;
    for (let step = 0; step < 400; step++) {
      const y = (i / W) | 0, x = i % W;
      const uu = u[i], vv = v[i];
      if (Math.abs(uu) < CALM && Math.abs(vv) < CALM) { stoppedCalm = true; break; }
      const dxm = (2 * Math.PI * config.body.radiusMetres * Math.max(Math.cos((latOf(y) * Math.PI) / 180), 0.0087)) / W;
      const dym = (Math.PI * config.body.radiusMetres) / H;
      i = Math.abs(uu) / dxm >= Math.abs(vv) / dym
        ? y * W + (uu >= 0 ? (x + W - 1) % W : (x + 1) % W)
        : (vv >= 0 ? Math.min(H - 1, y + 1) : Math.max(0, y - 1)) * W + x;
      if (ref.isSource[i]) { hit = true; break; }
    }
    if (hit) reach += wt[i0]; else if (stoppedCalm) calmStop += wt[i0]; else lost += wt[i0];
  }
  console.log(`  of the dry tail: ${((100 * calmSelf) / total).toFixed(1)}% is itself calm, ` +
    `${((100 * calmStop) / total).toFixed(1)}% traces upwind into a calm cell, ` +
    `${((100 * reach) / total).toFixed(1)}% DOES reach open water upwind, ${((100 * lost) / total).toFixed(1)}% neither in 400 steps`);
  let mW = 0, mDry = 0;
  for (let i = 0; i < W * H; i++) if (isLand(i) && oracle.masked[i]) { mW += wt[i]; if (ZERO(i)) mDry += wt[i]; }
  console.log(`  NCEP below-ground cells regridded as CALM: ${oracle.maskedCount} cells, ${((100 * mW) / landW).toFixed(1)}% of land area, ${((100 * mDry) / mW).toFixed(0)}% of them dry`);
}

// === 4. one factor at a time ===============================================
console.log("\n=== 4. one factor at a time (dry-tail area and land mean q) ===");
const report = (label, f, w = W, h = H) => {
  const qq = f.specificHumidityKgPerKg;
  let lw = 0, dry = 0, s = 0, exact = 0;
  const wf = w === W ? waterFrac : coarsen(Float32Array.from(terrainField.isWaterSurface), terrainField.width, terrainField.height, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (wf[i] >= 0.5) continue;
    const ww = Math.cos((latOf(y, h) * Math.PI) / 180);
    lw += ww; s += ww * qq[i] * 1000;
    if (qq[i] < 1e-6) dry += ww;
    if (qq[i] === 0) exact += ww;
  }
  console.log(`  ${label.padEnd(34)} dry ${((100 * dry) / lw).toFixed(1).padStart(5)}%   exact0 ${((100 * exact) / lw).toFixed(1).padStart(5)}%   land mean q ${(s / lw).toFixed(3).padStart(7)} g/kg`);
};
report("reference (tau=8, K=0)", ref);
report("tau = 10^6 d (sink effectively off)", run({ params: { moistureResidenceDays: 1e6 } }));
report("K = 1e3 m2/s", run({ params: { eddyDiffusivityM2PerS: 1e3 } }));
report("K = 1e4 m2/s", run({ params: { eddyDiffusivityM2PerS: 1e4 } }));
report("K = 1e5 m2/s", run({ params: { eddyDiffusivityM2PerS: 1e5 } }));
// cap off: a humidity field whose saturation is enormous. Only the CAP uses it
// in the solver, so this isolates the cap without touching temperature.
{
  const huge = { ...humidityField, saturationSpecificHumidityKgPerKg: humidityField.saturationSpecificHumidityKgPerKg.map((v) => v * 1000 + 1) };
  report("cap off (qsat x1000)", buildMoistureField({ ...BASE, wind: oracle, humidityField: huge }));
}
// a uniform tiny land source: tests whether zero is an attractor (it is not --
// the system is linear with a unique solution) and how far a trace of water
// would travel. NOT a proposed mechanism.
{
  const eps = new Float64Array(W * H).fill(1e-12);
  report("uniform land source 1e-12 /s", run({ landSourceKgPerKgPerS: eps }));
}
report("masked wind filled, not calm", run({ wind: oracleFilled }));
for (const [w, h] of [[128, 64], [512, 256]]) {
  const o = oracleAt(w, h, "calm");
  report(`resolution ${w}x${h}`, buildMoistureField({ ...BASE, wind: o }), w, h);
}
// convergence / initial-value dependence
{
  const a = run({ maxSweeps: 200 }), b = run({ maxSweeps: 8000 });
  let maxd = 0;
  for (let i = 0; i < W * H; i++) maxd = Math.max(maxd, Math.abs(a.specificHumidityKgPerKg[i] - b.specificHumidityKgPerKg[i]));
  console.log(`  convergence: 200 vs 8000 sweeps, max |dq| = ${(maxd * 1000).toExponential(2)} g/kg; reference converged=${ref.meta.converged} in ${ref.meta.sweeps} sweeps`);
}

// === 5. the per-cell retention, which is what sets the decay ===============
console.log("\n=== 5. the discrete retention factor a/(a+1/tau) per cell ===");
{
  const tau = 8 * 86400;
  const vals = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!isLand(i)) continue;
    const dxm = (2 * Math.PI * config.body.radiusMetres * Math.max(Math.cos((latOf(y) * Math.PI) / 180), 0.0087)) / W;
    const dym = (Math.PI * config.body.radiusMetres) / H;
    const a = Math.abs(oracle.uWindMs[i]) / dxm + Math.abs(oracle.vWindMs[i]) / dym;
    vals.push(a / (a + 1 / tau));
  }
  vals.sort((a, b) => a - b);
  const p = (f) => vals[Math.min(vals.length - 1, Math.floor(f * vals.length))].toFixed(3);
  console.log(`  land percentiles p10=${p(0.1)} p25=${p(0.25)} p50=${p(0.5)} p75=${p(0.75)} p90=${p(0.9)}`);
  console.log(`  cells needed to fall to 1e-6 at the median retention: ${Math.ceil(Math.log(1e-6) / Math.log(Number(p(0.5))))}`);
  console.log(`  ... at p25: ${Math.ceil(Math.log(1e-6) / Math.log(Number(p(0.25))))} cells   at p10: ${Math.ceil(Math.log(1e-6) / Math.log(Number(p(0.1))))} cells`);
  console.log("  (the continuum decay length is |u|*tau: 3456 km at 5 m/s, 346 km at 0.5 m/s, 0 at calm)");
}
