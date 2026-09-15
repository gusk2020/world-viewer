// Stage 5A real-data validation.
//
// ---------------------------------------------------------------------------
// WHAT THIS DOES AND DOES NOT MEASURE -- read this before reading a number.
//
// Stage 5A computes SATURATION specific humidity: the water-vapour capacity
// of air at a given temperature and pressure. It is a capacity, not a
// state, and there is no evaporation, transport or rain-out in it.
//
// So this script is NOT a climate-model score. Comparing our q_sat against
// a q_sat recomputed from the reanalysis's own (T, p) tests the FORMULA,
// the UNITS, the GRID, the TEMPERATURE INPUT and the PRESSURE
// APPROXIMATION -- five things that can be wrong in ways a picture would
// not show. Whether the model reproduces the real humidity distribution is
// a Stage 5B question and is deliberately not asked here.
//
// The one number here that does involve real humidity -- implied relative
// humidity, q_teacher / q_sat_model -- is a plausibility check on the
// denominator, not a skill score for the numerator.
//
// Stage 5A has zero free parameters, so nothing here can be tuned. A
// failure is a real error.
//
// Usage: node tools/validate_humidity_stage5a.mjs [--json]
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import {
  buildHumidityField,
  saturationSpecificHumidity,
  saturationVapourPressureHPa,
} from "../js/climate-v1/humidity.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai");
const TEACHER_DIR = path.join(WORLD, "teacher");

// Earth's constants live HERE, in the caller, never in js/climate-v1/humidity.js.
const EARTH_ATMOSPHERE = {
  seaLevelPressureHPa: 1013.25,
  specificGasConstantJPerKgK: 287.05,
  vapourGasConstantJPerKgK: 461.52,
};
const EARTH_GRAVITY = 9.80665;
const EPS = EARTH_ATMOSPHERE.specificGasConstantJPerKgK / EARTH_ATMOSPHERE.vapourGasConstantJPerKgK;

// --- weighted statistics ----------------------------------------------------
function stats(pairs) {
  let sw = 0, sa = 0, sb = 0;
  for (const [a, b, w] of pairs) { sw += w; sa += w * a; sb += w * b; }
  if (sw === 0) return null;
  const ma = sa / sw, mb = sb / sw;
  let sae = 0, sse = 0, saa = 0, sbb = 0, sab = 0;
  for (const [a, b, w] of pairs) {
    sae += w * Math.abs(a - b);
    sse += w * (a - b) * (a - b);
    saa += w * (a - ma) * (a - ma);
    sbb += w * (b - mb) * (b - mb);
    sab += w * (a - ma) * (b - mb);
  }
  return {
    n: pairs.length,
    modelMean: ma, teacherMean: mb,
    bias: ma - mb,
    mae: sae / sw,
    rmse: Math.sqrt(sse / sw),
    correlation: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN,
  };
}
const fmt = (s, unit) => s
  ? `bias=${s.bias >= 0 ? "+" : ""}${s.bias.toFixed(3)}${unit}  MAE=${s.mae.toFixed(3)}${unit}  RMSE=${s.rmse.toFixed(3)}${unit}  r=${s.correlation.toFixed(4)}  (model ${s.modelMean.toFixed(2)} vs teacher ${s.teacherMean.toFixed(2)}, n=${s.n})`
  : "no data";

// --- teacher ---------------------------------------------------------------
const summaryPath = path.join(TEACHER_DIR, "humidity-summary.json");
if (!existsSync(summaryPath)) {
  console.error(`missing ${path.relative(REPO, summaryPath)}`);
  console.error("Run the 'Build humidity teacher' workflow from the Actions tab first --");
  console.error("this sandbox's egress proxy blocks downloads.psl.noaa.gov, so the data can only be fetched on a runner.");
  process.exit(2);
}
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const grids = {};
for (const [name, spec] of Object.entries(summary.grids)) {
  grids[name] = {
    ...parseTeacherGrid(readFileSync(path.join(TEACHER_DIR, spec.file)), spec),
    latitudes: spec.latitudes,
    longitudes: spec.longitudes,
    units: spec.units,
  };
}

// --- model ------------------------------------------------------------------
const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));
const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
const offset = config.terrain.encoding.offsetMetres;
const metres = new Int16Array(png.width * png.height);
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;

const sets = resolveClimateSets(config);
const shipped = sets.sets.find((s) => s.id === sets.defaultId).values;
const params = { ...shipped, ...CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION };
const terrainField = buildTerrainField({ elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0 });
const temperatureField = buildTemperatureField({ terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params });
const humidityField = buildHumidityField({
  terrainField, temperatureField, lapseRateCPerKm: params.lapseRateCPerKm,
  body: { gravityMs2: EARTH_GRAVITY }, atmosphere: EARTH_ATMOSPHERE,
});

// --- fine -> teacher grid ---------------------------------------------------
// Each fine cell is assigned to the teacher node nearest to it and averaged
// with a cos(lat) weight. Two deliberate choices:
//   * the model is averaged DOWN to the teacher, never the teacher
//     interpolated UP -- the project's standing rule against presenting data
//     as finer than it is.
//   * q_sat is computed at full resolution and THEN averaged, not computed
//     from an averaged temperature. q_sat is convex in T, so those differ,
//     and averaging the answer is the right order.
function nearestIndex(sortedish, value) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < sortedish.length; i++) {
    const d = Math.abs(sortedish[i] - value);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
function averageToTeacher(fine, grid, mask) {
  const W = grid.width, H = grid.height;
  const sum = new Float64Array(W * H), wsum = new Float64Array(W * H);
  const fw = humidityField.width, fh = humidityField.height;
  // Precompute the row/column mapping once -- it depends only on the grids.
  const rowMap = new Int32Array(fh), colMap = new Int32Array(fw);
  for (let y = 0; y < fh; y++) rowMap[y] = nearestIndex(grid.latitudes, 90 - ((y + 0.5) * 180) / fh);
  for (let x = 0; x < fw; x++) {
    let lng = -180 + ((x + 0.5) * 360) / fw;
    colMap[x] = nearestIndex(grid.longitudes.map((l) => (l > 180 ? l - 360 : l)), lng);
  }
  for (let y = 0; y < fh; y++) {
    const lat = 90 - ((y + 0.5) * 180) / fh;
    const w = Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < fw; x++) {
      const i = y * fw + x;
      if (mask && !mask(i)) continue;
      const t = rowMap[y] * W + colMap[x];
      sum[t] += w * fine[i];
      wsum[t] += w;
    }
  }
  const out = new Float32Array(W * H).fill(NaN);
  for (let t = 0; t < W * H; t++) if (wsum[t] > 0) out[t] = sum[t] / wsum[t];
  return out;
}

const teacherGridSpec = grids.surfacePressureHPa;
const modelP = averageToTeacher(humidityField.surfacePressureHPa, teacherGridSpec);
const modelQ = averageToTeacher(humidityField.saturationSpecificHumidityKgPerKg, teacherGridSpec);
const modelT = averageToTeacher(temperatureField.annualMeanTemperatureC, teacherGridSpec);
const modelElev = averageToTeacher(terrainField.relativeElevationMetres, teacherGridSpec);
const seaFraction = averageToTeacher(Float32Array.from(terrainField.isSea), teacherGridSpec);

const W = teacherGridSpec.width, H = teacherGridSpec.height;
const latOf = (t) => teacherGridSpec.latitudes[Math.floor(t / W)];
const lngOf = (t) => { const l = teacherGridSpec.longitudes[t % W]; return l > 180 ? l - 360 : l; };
const weightOf = (t) => Math.cos((latOf(t) * Math.PI) / 180);

const out = { stage: "5A", note: "validates formula/units/grid/inputs, not climate skill" };
console.log("Climate v1 Stage 5A -- humidity thermodynamics against real Earth data");
console.log(`teacher: ${summary.source.product}`);
console.log(`grid: ${W}x${H}\n`);
console.log("NOTE: q_sat is a CAPACITY, not the real humidity. These numbers test the");
console.log("      formula, units, grid, temperature input and pressure approximation.");
console.log("      Real humidity skill is a Stage 5B question and is not asked here.\n");

// === 1. pressure ============================================================
console.log("1. Surface pressure: model vs NCEP (the one genuinely new approximation)");
const pPairs = [], pByBand = new Map();
for (let t = 0; t < W * H; t++) {
  const tp = grids.surfacePressureHPa.values[t];
  if (!Number.isFinite(tp) || !Number.isFinite(modelP[t])) continue;
  const w = weightOf(t);
  pPairs.push([modelP[t], tp, w]);
  const z = modelElev[t];
  const band = seaFraction[t] > 0.5 ? "sea" : z < 500 ? "land <500m" : z < 1000 ? "land 500-1000m" : z < 2000 ? "land 1-2km" : z < 3000 ? "land 2-3km" : "land >3km";
  if (!pByBand.has(band)) pByBand.set(band, []);
  pByBand.get(band).push([modelP[t], tp, w]);
}
console.log(`  global           ${fmt(stats(pPairs), " hPa")}`);
for (const band of ["sea", "land <500m", "land 500-1000m", "land 1-2km", "land 2-3km", "land >3km"]) {
  if (pByBand.has(band)) console.log(`  ${band.padEnd(16)} ${fmt(stats(pByBand.get(band)), " hPa")}`);
}
out.pressure = { global: stats(pPairs), byBand: Object.fromEntries([...pByBand].map(([k, v]) => [k, stats(v)])) };

// === 2. q_sat, and where its error comes from ===============================
console.log("\n2. q_sat vs q_sat recomputed from the teacher's own (T, p)");
console.log("   Not a skill score: this isolates whether our T and our p give the right ceiling.");
const haveTeacherT = Boolean(grids.airTemperatureC);
if (!haveTeacherT) {
  console.log("   SKIPPED: the teacher carries no near-surface air temperature grid.");
} else {
  const qsatFrom = (tC, p) => saturationSpecificHumidity(saturationVapourPressureHPa(tC), p, EPS) * 1000;
  const all = [], onlyT = [], onlyP = [];
  for (let t = 0; t < W * H; t++) {
    const tt = grids.airTemperatureC.values[t], tp = grids.surfacePressureHPa.values[t];
    if (!Number.isFinite(tt) || !Number.isFinite(tp) || !Number.isFinite(modelQ[t])) continue;
    const w = weightOf(t);
    const reference = qsatFrom(tt, tp);
    all.push([modelQ[t] * 1000, reference, w]);
    // substitute one input at a time: which of T and p carries the error
    onlyT.push([qsatFrom(modelT[t], tp), reference, w]);   // our T, teacher p
    onlyP.push([qsatFrom(tt, modelP[t]), reference, w]);   // teacher T, our p
  }
  console.log(`  model q_sat      ${fmt(stats(all), " g/kg")}`);
  console.log(`  our T, their p   ${fmt(stats(onlyT), " g/kg")}`);
  console.log(`  their T, our p   ${fmt(stats(onlyP), " g/kg")}`);
  console.log("  -> the larger of the last two is where the error actually lives.");
  out.qsat = { model: stats(all), temperatureOnly: stats(onlyT), pressureOnly: stats(onlyP) };
}

// === 3. implied relative humidity ===========================================
console.log("\n3. Implied RH = q_teacher / q_sat_model (a plausibility check on the denominator)");
if (!grids.specificHumidityKgPerKg) {
  console.log("   SKIPPED: the teacher carries no near-surface specific humidity grid.");
} else {
  const regions = {
    "open ocean": (lat, lng, t) => seaFraction[t] > 0.9 && Math.abs(lat) < 60,
    "tropical ocean": (lat, lng, t) => seaFraction[t] > 0.9 && Math.abs(lat) < 20,
    "Sahara": (lat, lng) => lat > 18 && lat < 28 && lng > -8 && lng < 28,
    "Amazon": (lat, lng) => lat > -8 && lat < 2 && lng > -70 && lng < -55,
    "all land": (lat, lng, t) => seaFraction[t] < 0.1,
  };
  const acc = Object.fromEntries(Object.keys(regions).map((k) => [k, []]));
  for (let t = 0; t < W * H; t++) {
    const q = grids.specificHumidityKgPerKg.values[t];
    if (!Number.isFinite(q) || !Number.isFinite(modelQ[t]) || modelQ[t] <= 0) continue;
    const rh = q / modelQ[t];
    const lat = latOf(t), lng = lngOf(t), w = weightOf(t);
    for (const [name, test] of Object.entries(regions)) if (test(lat, lng, t)) acc[name].push([rh, w]);
  }
  for (const [name, rows] of Object.entries(acc)) {
    if (!rows.length) { console.log(`  ${name.padEnd(16)} no data`); continue; }
    let sw = 0, s = 0;
    for (const [v, w] of rows) { sw += w; s += w * v; }
    const mean = s / sw;
    const sorted = rows.map(([v]) => v).sort((a, b) => a - b);
    const p05 = sorted[Math.floor(sorted.length * 0.05)], p95 = sorted[Math.floor(sorted.length * 0.95)];
    console.log(`  ${name.padEnd(16)} mean RH=${mean.toFixed(3)}  5-95%=${p05.toFixed(3)}..${p95.toFixed(3)}  (n=${rows.length})`);
    out.impliedRH = out.impliedRH || {};
    out.impliedRH[name] = { mean, p05, p95, n: rows.length };
  }
  console.log("  -> physically RH must sit in 0..1; ocean near 0.7-0.85 and desert well below are the signs of a sane denominator.");
}

// === 4. checkerboard halves =================================================
console.log("\n4. Calibration/validation halves (reported for comparability only --");
console.log("   Stage 5A has no free parameters, so nothing was fitted to either half)");
const halves = [[], []];
for (let t = 0; t < W * H; t++) {
  const tp = grids.surfacePressureHPa.values[t];
  if (!Number.isFinite(tp) || !Number.isFinite(modelP[t])) continue;
  halves[((t % W) + Math.floor(t / W)) % 2].push([modelP[t], tp, weightOf(t)]);
}
console.log(`  pressure, half A ${fmt(stats(halves[0]), " hPa")}`);
console.log(`  pressure, half B ${fmt(stats(halves[1]), " hPa")}`);

if (process.argv.includes("--json")) console.log("\n" + JSON.stringify(out, null, 2));
