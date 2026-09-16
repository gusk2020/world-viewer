// Stage 5C diagnosis: is the model's low land relative humidity a property of
// recycling physics, or is Stage 5B simply drying the land too much?
//
// Diagnosis only. Nothing is fitted, no mechanism is added, and no file this
// tool reads is modified. The teacher's own RH is built from the teacher's own
// q, T and p through the SAME Stage 5A formulas the model uses, so the two
// sides differ only in their inputs, never in their definition of RH.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import { buildHumidityField, saturationVapourPressureHPa, saturationSpecificHumidity } from "../js/climate-v1/humidity.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import { parseWindGrid } from "../js/climate-v1/wind-teacher.js";
import { buildClimateV1Wind } from "../js/climate-v1/wind.js";
import { buildMoistureField, WIND_MODES } from "../js/climate-v1/moisture.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai"), TEACHER = path.join(WORLD, "teacher");
const ATM = { seaLevelPressureHPa: 1013.25, specificGasConstantJPerKgK: 287.05, vapourGasConstantJPerKgK: 461.52 };
const EPS = ATM.specificGasConstantJPerKgK / ATM.vapourGasConstantJPerKgK;
const G = 9.80665, W = 256, H = 128;

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
  terrainField, temperatureField, lapseRateCPerKm: params.lapseRateCPerKm,
  body: { gravityMs2: G }, atmosphere: ATM,
});

// ---------------------------------------------------------------- teacher ---
const hsum = JSON.parse(readFileSync(path.join(TEACHER, "humidity-summary.json"), "utf8"));
const TG = {};
for (const [name, spec] of Object.entries(hsum.grids)) {
  TG[name] = { ...parseTeacherGrid(readFileSync(path.join(TEACHER, spec.file)), spec), latitudes: spec.latitudes, longitudes: spec.longitudes };
}
const nearestIn = (axis, v, wrap) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < axis.length; i++) { let d = Math.abs(axis[i] - v); if (wrap) d = Math.min(d, 360 - d); if (d < bd) { bd = d; best = i; } }
  return best;
};
const sampleT = (name, lat, lng) => {
  const g = TG[name];
  return g.values[nearestIn(g.latitudes, lat) * g.width + nearestIn(g.longitudes.map((l) => (l > 180 ? l - 360 : l)), lng, true)];
};

// ------------------------------------------------------------------ winds ---
const wsum = JSON.parse(readFileSync(path.join(TEACHER, "wind-summary.json"), "utf8"));
const spec850 = wsum.grids.level850hPa;
const tu = parseWindGrid(readFileSync(path.join(TEACHER, spec850.files.u)), spec850).values;
const tv = parseWindGrid(readFileSync(path.join(TEACHER, spec850.files.v)), spec850).values;
const oracle = { width: W, height: H, uWindMs: new Float64Array(W * H), vWindMs: new Float64Array(W * H) };
for (let y = 0; y < H; y++) {
  const j = nearestIn(spec850.latitudes, 90 - ((y + 0.5) * 180) / H);
  for (let x = 0; x < W; x++) {
    const i = j * spec850.width + nearestIn(spec850.longitudes, -180 + ((x + 0.5) * 360) / W, true);
    if (!Number.isFinite(tu[i]) || !Number.isFinite(tv[i])) continue;
    oracle.uWindMs[y * W + x] = tu[i]; oracle.vWindMs[y * W + x] = tv[i];
  }
}
const stage4 = buildClimateV1Wind({
  terrainField, temperatureField, lapseRateCPerKm: params.lapseRateCPerKm, body: config.body,
  atmosphere: { specificGasConstantJPerKgK: 287, surfacePressureHPa: 1000, levelPressureHPa: 850 },
  params: { thermalResponseStrength: 1, dragTimescaleDays: 0.5, thermalSmoothingKm: 1500 },
  width: W, height: H,
});

// ------------------------------------------------------------ eval points ---
const coarsen = (fine, fw, fh) => {
  const bx = fw / W, by = fh / H, out = new Float64Array(W * H);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) out[Math.floor(y / by) * W + Math.floor(x / bx)] += fine[y * fw + x];
  for (let i = 0; i < out.length; i++) out[i] /= bx * by;
  return out;
};
const fw = terrainField.width, fh = terrainField.height;
const modelQSat = coarsen(humidityField.saturationSpecificHumidityKgPerKg, fw, fh);
const modelP = coarsen(humidityField.surfacePressureHPa, fw, fh);
const modelT = coarsen(temperatureField.annualMeanTemperatureC, temperatureField.width, temperatureField.height);
const waterFrac = coarsen(Float32Array.from(terrainField.isWaterSurface), fw, fh);

const POINTS = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const lat = 90 - ((y + 0.5) * 180) / H, lng = -180 + ((x + 0.5) * 360) / W;
  const qT = sampleT("specificHumidityKgPerKg", lat, lng);
  const tT = sampleT("airTemperatureC", lat, lng);
  const pT = sampleT("surfacePressureHPa", lat, lng);
  if (!Number.isFinite(qT) || !Number.isFinite(tT) || !Number.isFinite(pT)) continue;
  // The teacher's own RH, from the teacher's own q, T and p, through the same
  // Stage 5A formulas. Never the model's q_sat under a teacher q.
  const qSatT = saturationSpecificHumidity(saturationVapourPressureHPa(tT), pT, EPS);
  POINTS.push({
    i, lat, lng, w: Math.cos((lat * Math.PI) / 180), isLand: waterFrac[i] < 0.5,
    qT, tT, pT, qSatT, rhT: qSatT > 0 ? qT / qSatT : NaN,
    qSatM: modelQSat[i], tM: modelT[i], pM: modelP[i],
  });
}
const LAND = POINTS.filter((p) => p.isLand && Number.isFinite(p.rhT));

const REGIONS = {
  Amazon: [-70, -55, -8, 2], Sahara: [-8, 28, 18, 28], Australia: [120, 145, -30, -18],
  India: [73, 88, 10, 28], Europe: [0, 30, 45, 58], Indonesia: [100, 130, -8, 6],
  Patagonia: [-73, -67, -52, -40], Baikal: [103, 110, 51, 56], Caspian: [47, 55, 37, 47],
};
const inRegion = (p, name) => { const [l0, l1, a0, a1] = REGIONS[name]; return p.lat >= a0 && p.lat <= a1 && p.lng >= l0 && p.lng <= l1; };
const wmean = (rows, f) => { let s = 0, w = 0; for (const p of rows) { const v = f(p); if (!Number.isFinite(v)) continue; s += p.w * v; w += p.w; } return w > 0 ? s / w : NaN; };
function pcts(rows, f) {
  const v = rows.map(f).filter(Number.isFinite).sort((a, b) => a - b);
  return [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
}
const fp = (a) => a.map((x) => x.toFixed(3)).join("  ");

// ------------------------------------------------------------------- runs ---
const BASE = { terrainField, temperatureField, humidityField, body: config.body, maxSweeps: 4000 };
const run = (wind, tauDays) => buildMoistureField({ ...BASE, wind, windMode: WIND_MODES.PHYSICAL, params: tauDays === null ? {} : { moistureResidenceDays: tauDays } });
const oracleRun = run(oracle, null);
const stage4Run = run(stage4, null);
const rhOf = (field) => (p) => (field.saturationSpecificHumidityKgPerKg[p.i] > 0 ? field.specificHumidityKgPerKg[p.i] / field.saturationSpecificHumidityKgPerKg[p.i] : NaN);
const qOf = (field) => (p) => field.specificHumidityKgPerKg[p.i] * 1000;

console.log("Stage 5C diagnosis -- why is the model's land relative humidity so low?");
console.log("Diagnosis only. Nothing fitted, no mechanism added, no model changed.");
console.log("The teacher's RH is built from the teacher's own q, T and p through the same Stage 5A formulas.\n");

console.log("=== 1. land RH distribution (area-weighted percentiles p10/p25/p50/p75/p90) ===");
console.log(`  model, NCEP850 oracle wind   ${fp(pcts(LAND, rhOf(oracleRun)))}`);
console.log(`  model, Stage 4 wind          ${fp(pcts(LAND, rhOf(stage4Run)))}`);
console.log(`  TEACHER                      ${fp(pcts(LAND, (p) => p.rhT))}`);
console.log("  (ocean, for reference -- a boundary condition, not a prediction)");
const OCEAN = POINTS.filter((p) => !p.isLand && Number.isFinite(p.rhT));
console.log(`  model ocean                  ${fp(pcts(OCEAN, rhOf(oracleRun)))}`);
console.log(`  TEACHER ocean                ${fp(pcts(OCEAN, (p) => p.rhT))}`);

console.log("\n=== 2. RH gap, by how wet the TEACHER says the place is ===");
const BINS = [["dry      (teacher RH<0.4)", (p) => p.rhT < 0.4], ["middling (0.4-0.6)", (p) => p.rhT >= 0.4 && p.rhT < 0.6],
  ["humid    (teacher RH>=0.6)", (p) => p.rhT >= 0.6], ["ALL LAND", () => true]];
console.log(`${"bin".padEnd(26)} ${"model RH".padStart(9)} ${"teach RH".padStart(9)} ${"gap".padStart(7)} ${"area%".padStart(7)}`);
let totalW = 0; for (const p of LAND) totalW += p.w;
for (const [label, sel] of BINS) {
  const rows = LAND.filter(sel); let w = 0; for (const p of rows) w += p.w;
  const m = wmean(rows, rhOf(oracleRun)), t = wmean(rows, (p) => p.rhT);
  console.log(`${label.padEnd(26)} ${m.toFixed(3).padStart(9)} ${t.toFixed(3).padStart(9)} ${(m - t).toFixed(3).padStart(7)} ${((100 * w) / totalW).toFixed(1).padStart(7)}`);
}

console.log("\n=== 3. decomposing the RH gap: ln(RH_m/RH_t) = ln(q_m/q_t) - ln(qsat_m/qsat_t) ===");
console.log("  (a negative q term = the model is too dry; a positive qsat term = capacity is overstated)");
console.log(`${"bin".padEnd(26)} ${"ln RH".padStart(8)} ${"ln q".padStart(8)} ${"-ln qsat".padStart(9)} ${"q share".padStart(8)} ${"qsat share".padStart(11)}`);
for (const [label, sel] of BINS) {
  const rows = LAND.filter(sel).filter((p) => p.qT > 1e-9 && p.qSatT > 0 && p.qSatM > 0 && oracleRun.specificHumidityKgPerKg[p.i] > 1e-9);
  const lq = wmean(rows, (p) => Math.log(oracleRun.specificHumidityKgPerKg[p.i] / p.qT));
  const ls = wmean(rows, (p) => -Math.log(p.qSatM / p.qSatT));
  const tot = Math.abs(lq) + Math.abs(ls);
  console.log(`${label.padEnd(26)} ${(lq + ls).toFixed(3).padStart(8)} ${lq.toFixed(3).padStart(8)} ${ls.toFixed(3).padStart(9)} ${((100 * Math.abs(lq)) / tot).toFixed(0).padStart(7)}% ${((100 * Math.abs(ls)) / tot).toFixed(0).padStart(10)}%`);
}

console.log("\n=== 4. the inputs behind q_sat: temperature and pressure, land only ===");
console.log(`${"bin".padEnd(26)} ${"T model".padStart(8)} ${"T teach".padStart(8)} ${"dT".padStart(6)} ${"p model".padStart(8)} ${"p teach".padStart(8)} ${"dp".padStart(6)} ${"qsat m".padStart(7)} ${"qsat t".padStart(7)}`);
for (const [label, sel] of BINS) {
  const rows = LAND.filter(sel);
  const tm = wmean(rows, (p) => p.tM), tt = wmean(rows, (p) => p.tT);
  const pm = wmean(rows, (p) => p.pM), pt = wmean(rows, (p) => p.pT);
  const sm = wmean(rows, (p) => p.qSatM * 1000), st = wmean(rows, (p) => p.qSatT * 1000);
  console.log(`${label.padEnd(26)} ${tm.toFixed(2).padStart(8)} ${tt.toFixed(2).padStart(8)} ${(tm - tt).toFixed(2).padStart(6)} ${pm.toFixed(1).padStart(8)} ${pt.toFixed(1).padStart(8)} ${(pm - pt).toFixed(1).padStart(6)} ${sm.toFixed(2).padStart(7)} ${st.toFixed(2).padStart(7)}`);
}

console.log("\n=== 5. by region (NCEP850 oracle wind) ===");
console.log(`${"region".padEnd(11)} ${"RH m".padStart(6)} ${"RH t".padStart(6)} ${"q m".padStart(6)} ${"q t".padStart(6)} ${"qsat m".padStart(7)} ${"qsat t".padStart(7)} ${"T m".padStart(6)} ${"T t".padStart(6)} ${"p m".padStart(7)} ${"p t".padStart(7)}`);
for (const name of Object.keys(REGIONS)) {
  const rows = POINTS.filter((p) => inRegion(p, name) && Number.isFinite(p.rhT));
  console.log(`${name.padEnd(11)} ${wmean(rows, rhOf(oracleRun)).toFixed(3).padStart(6)} ${wmean(rows, (p) => p.rhT).toFixed(3).padStart(6)} ` +
    `${wmean(rows, qOf(oracleRun)).toFixed(2).padStart(6)} ${wmean(rows, (p) => p.qT * 1000).toFixed(2).padStart(6)} ` +
    `${wmean(rows, (p) => p.qSatM * 1000).toFixed(2).padStart(7)} ${wmean(rows, (p) => p.qSatT * 1000).toFixed(2).padStart(7)} ` +
    `${wmean(rows, (p) => p.tM).toFixed(1).padStart(6)} ${wmean(rows, (p) => p.tT).toFixed(1).padStart(6)} ` +
    `${wmean(rows, (p) => p.pM).toFixed(1).padStart(7)} ${wmean(rows, (p) => p.pT).toFixed(1).padStart(7)}`);
}
const gl = LAND;
console.log(`${"GLOBAL LAND".padEnd(11)} ${wmean(gl, rhOf(oracleRun)).toFixed(3).padStart(6)} ${wmean(gl, (p) => p.rhT).toFixed(3).padStart(6)} ` +
  `${wmean(gl, qOf(oracleRun)).toFixed(2).padStart(6)} ${wmean(gl, (p) => p.qT * 1000).toFixed(2).padStart(6)} ` +
  `${wmean(gl, (p) => p.qSatM * 1000).toFixed(2).padStart(7)} ${wmean(gl, (p) => p.qSatT * 1000).toFixed(2).padStart(7)} ` +
  `${wmean(gl, (p) => p.tM).toFixed(1).padStart(6)} ${wmean(gl, (p) => p.tT).toFixed(1).padStart(6)} ` +
  `${wmean(gl, (p) => p.pM).toFixed(1).padStart(7)} ${wmean(gl, (p) => p.pT).toFixed(1).padStart(7)}`);

console.log("\n=== 5b. the same decomposition, per region ===");
console.log(`${"region".padEnd(11)} ${"ln RH".padStart(7)} ${"ln q".padStart(7)} ${"-ln qsat".padStart(9)} ${"q share".padStart(8)} ${"qsat share".padStart(11)}`);
const decomp = (rows) => {
  const r = rows.filter((p) => p.qT > 1e-9 && p.qSatT > 0 && p.qSatM > 0 && oracleRun.specificHumidityKgPerKg[p.i] > 1e-9);
  const lq = wmean(r, (p) => Math.log(oracleRun.specificHumidityKgPerKg[p.i] / p.qT));
  const ls = wmean(r, (p) => -Math.log(p.qSatM / p.qSatT));
  const tot = Math.abs(lq) + Math.abs(ls);
  return { lq, ls, qShare: (100 * Math.abs(lq)) / tot, sShare: (100 * Math.abs(ls)) / tot };
};
for (const name of Object.keys(REGIONS)) {
  const d = decomp(POINTS.filter((p) => inRegion(p, name) && Number.isFinite(p.rhT)));
  console.log(`${name.padEnd(11)} ${(d.lq + d.ls).toFixed(3).padStart(7)} ${d.lq.toFixed(3).padStart(7)} ${d.ls.toFixed(3).padStart(9)} ${d.qShare.toFixed(0).padStart(7)}% ${d.sShare.toFixed(0).padStart(10)}%`);
}
{
  const d = decomp(LAND);
  console.log(`${"GLOBAL LAND".padEnd(11)} ${(d.lq + d.ls).toFixed(3).padStart(7)} ${d.lq.toFixed(3).padStart(7)} ${d.ls.toFixed(3).padStart(9)} ${d.qShare.toFixed(0).padStart(7)}% ${d.sShare.toFixed(0).padStart(10)}%`);
}

// --- how far can the teacher's ANNUAL-MEAN ratio be trusted? ---------------
// q_sat is convex in temperature, so q_sat(mean T) < mean(q_sat(T)): wherever
// the seasonal temperature range is large, q_teacher / q_sat(T_teacher) is
// biased UPWARD and can exceed 1, which no instantaneous relative humidity
// can. Both sides here are computed the same way, so the comparison is fair,
// but the teacher's absolute value is only trustworthy where the seasonal
// swing is small. Measured rather than asserted:
console.log("\n=== 5c. how far the teacher's annual-mean ratio can be trusted ===");
{
  let over = 0, w = 0;
  for (const p of LAND) { w += p.w; if (p.rhT > 1) over += p.w; }
  let overO = 0, wo = 0;
  for (const p of OCEAN) { wo += p.w; if (p.rhT > 1) overO += p.w; }
  console.log(`  teacher q / qsat(mean T) exceeds 1 over ${((100 * over) / w).toFixed(1)}% of land and ${((100 * overO) / wo).toFixed(1)}% of ocean`);
  console.log("  -> Jensen's inequality on a convex qsat(T); the ratio is inflated where the season swings.");
  const trop = LAND.filter((p) => Math.abs(p.lat) < 23.5);
  console.log(`  tropical land only (|lat|<23.5, smallest seasonal swing): teacher ${wmean(trop, (p) => p.rhT).toFixed(3)}  model ${wmean(trop, rhOf(oracleRun)).toFixed(3)}`);
  console.log(`  tropical land percentiles -- teacher ${fp(pcts(trop, (p) => p.rhT))}`);
  console.log(`  tropical land percentiles -- model   ${fp(pcts(trop, rhOf(oracleRun)))}`);
}

console.log("\n=== 6. does tau move the RH distribution? (a sweep, NOT a fit -- nothing is chosen here) ===");
console.log(`${"tau (d)".padStart(8)} ${"p10".padStart(6)} ${"p25".padStart(6)} ${"p50".padStart(6)} ${"p75".padStart(6)} ${"p90".padStart(6)} ${"mean RH".padStart(8)} ${"land>0.7".padStart(9)} ${"land>0.8".padStart(9)}`);
for (const tau of [4, 8, 16, 32, 64, 128]) {
  const f = run(oracle, tau);
  const rh = rhOf(f);
  let a7 = 0, a8 = 0, w = 0;
  for (const p of LAND) { const v = rh(p); w += p.w; if (v > 0.7) a7 += p.w; if (v > 0.8) a8 += p.w; }
  console.log(`${String(tau).padStart(8)} ${fp(pcts(LAND, rh)).split("  ").map((s) => s.padStart(6)).join(" ")} ${wmean(LAND, rh).toFixed(3).padStart(8)} ${((100 * a7) / w).toFixed(1).padStart(8)}% ${((100 * a8) / w).toFixed(1).padStart(8)}%`);
}
console.log(`${"TEACHER".padStart(8)} ${fp(pcts(LAND, (p) => p.rhT)).split("  ").map((s) => s.padStart(6)).join(" ")} ${wmean(LAND, (p) => p.rhT).toFixed(3).padStart(8)}`);
