// Stage 5B validation: the actual specific humidity, against NCEP.
//
// THE PRIMARY VERDICT IS NOT GLOBAL CORRELATION. Measured before any of this
// was built, the no-transport control `q = 0.826 * q_sat` already scores
// r = 0.9234 globally and r = 0.9729 over ocean, because q is mostly RH times
// capacity and capacity is mostly temperature. Correlation is also invariant
// to the RH value. What the control gets wrong is the land pattern, so the
// declared criteria are all about land -- above all, drying the subtropical
// deserts without drying the Amazon.
//
// Over ocean the model is a BOUNDARY CONDITION taken from the teacher, not a
// prediction. Ocean numbers are printed and labelled as such, never as skill.
//
// Three wind conditions, one transport model, one evaluation path:
//   A  direction-controlled Stage 4   direction only, shared reference speed
//   B  direction-controlled v0.8      direction only, THE SAME speed
//   C  physical Stage 4               its own real m/s
// A vs B isolates wind DIRECTION. A vs C isolates Stage 4's wind SPEED.
// Climate v0.8's dimensionless wind is never scaled into m/s by a teacher-fitted
// factor, so there is deliberately no "physical v0.8" case.
//
// Usage: node tools/validate_moisture_stage5b.mjs [--search] [--screen] [--json]
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
import { buildClimateV1Wind } from "../js/climate-v1/wind.js";
import { currentModelWind, nearestModelRow } from "../js/climate-v1/wind-diagnostic.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import { buildMoistureField, WIND_MODES, MOISTURE_PARAMETERS } from "../js/climate-v1/moisture.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai");
const TEACHER = path.join(WORLD, "teacher");
const EARTH_ATMOSPHERE = { seaLevelPressureHPa: 1013.25, specificGasConstantJPerKgK: 287.05, vapourGasConstantJPerKgK: 461.52 };
const EARTH_GRAVITY = 9.80665;
const GRID_W = 256, GRID_H = 128;

// ---------------------------------------------------------------- inputs ---
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
  body: { gravityMs2: EARTH_GRAVITY }, atmosphere: EARTH_ATMOSPHERE,
});

// ----------------------------------------------------------------- winds ---
const stage4 = buildClimateV1Wind({
  terrainField, temperatureField, lapseRateCPerKm: params.lapseRateCPerKm, body: config.body,
  atmosphere: { specificGasConstantJPerKgK: 287, surfacePressureHPa: 1000, levelPressureHPa: 850 },
  params: { thermalResponseStrength: 1, dragTimescaleDays: 0.5, thermalSmoothingKm: 1500 },
  width: GRID_W, height: GRID_H,
});
// Climate v0.8's field on the same grid. Its magnitude is DIMENSIONLESS and is
// used only to get a direction; it is never converted to m/s.
const v08row = currentModelWind({
  rows: 180, dayLengthHours: config.body.dayLengthHours,
  rotationDirection: config.body.rotationDirection, params: shipped, subsolarDeg: 0,
});
const v08 = { width: GRID_W, height: GRID_H, uWindMs: new Float64Array(GRID_W * GRID_H), vWindMs: new Float64Array(GRID_W * GRID_H) };
for (let y = 0; y < GRID_H; y++) {
  const lat = 90 - ((y + 0.5) * 180) / GRID_H;
  const r = nearestModelRow(lat, v08row.rows);
  for (let x = 0; x < GRID_W; x++) { v08.uWindMs[y * GRID_W + x] = v08row.east[r]; v08.vWindMs[y * GRID_W + x] = v08row.north[r]; }
}
const CONDITIONS = [
  { id: "A", label: "direction-controlled Stage 4", wind: stage4, mode: WIND_MODES.DIRECTION },
  { id: "B", label: "direction-controlled v0.8", wind: v08, mode: WIND_MODES.DIRECTION },
  { id: "C", label: "physical Stage 4 (real m/s)", wind: stage4, mode: WIND_MODES.PHYSICAL },
];

// --------------------------------------------------------------- teacher ---
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
const teacherQ = (lat, lng) => {
  const g = TG.specificHumidityKgPerKg;
  return g.values[nearestIn(g.latitudes, lat) * g.width + nearestIn(g.longitudes.map((l) => (l > 180 ? l - 360 : l)), lng, true)];
};

// Evaluation points: every transport-grid cell, tagged once.
const latOf = (y) => 90 - ((y + 0.5) * 180) / GRID_H;
const lngOf = (x) => -180 + ((x + 0.5) * 360) / GRID_W;
const waterFrac = (() => {
  const bx = terrainField.width / GRID_W, by = terrainField.height / GRID_H;
  const out = new Float64Array(GRID_W * GRID_H);
  for (let y = 0; y < terrainField.height; y++) for (let x = 0; x < terrainField.width; x++)
    out[Math.floor(y / by) * GRID_W + Math.floor(x / bx)] += terrainField.isWaterSurface[y * terrainField.width + x];
  for (let i = 0; i < out.length; i++) out[i] /= bx * by;
  return out;
})();
const POINTS = [];
for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
  const lat = latOf(y), lng = lngOf(x);
  const t = teacherQ(lat, lng);
  if (!Number.isFinite(t)) continue;
  POINTS.push({ i: y * GRID_W + x, lat, lng, teacher: t * 1000, w: Math.cos((lat * Math.PI) / 180),
    isLand: waterFrac[y * GRID_W + x] < 0.5, train: (x + y) % 2 === 0 });
}

function stats(rows) {
  let sw = 0, sa = 0, sb = 0;
  for (const [a, b, w] of rows) { sw += w; sa += w * a; sb += w * b; }
  if (!sw) return null;
  const ma = sa / sw, mb = sb / sw;
  let saa = 0, sbb = 0, sab = 0, sae = 0;
  for (const [a, b, w] of rows) { saa += w * (a - ma) ** 2; sbb += w * (b - mb) ** 2; sab += w * (a - ma) * (b - mb); sae += w * Math.abs(a - b); }
  return { r: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN, mae: sae / sw, bias: ma - mb, model: ma, teacher: mb, n: rows.length };
}
const fmt = (s) => (s ? `r=${s.r.toFixed(4)}  MAE=${s.mae.toFixed(2)}  bias=${s.bias >= 0 ? "+" : ""}${s.bias.toFixed(2)}  (model ${s.model.toFixed(2)} vs teacher ${s.teacher.toFixed(2)}, n=${s.n})` : "no data");

const REGIONS = {
  Amazon: [-70, -55, -8, 2], Sahara: [-8, 28, 18, 28], India: [73, 88, 10, 28], Europe: [0, 30, 45, 58],
  Indonesia: [100, 130, -8, 6], Australia: [120, 145, -30, -18], Patagonia: [-73, -67, -52, -40],
  Antarctica: [-180, 180, -90, -70], Caspian: [47, 55, 37, 47], Baikal: [103, 110, 51, 56],
};
function regionMeans(field) {
  const out = {};
  for (const [name, [l0, l1, a0, a1]] of Object.entries(REGIONS)) {
    let sm = 0, st = 0, sw = 0;
    for (const p of POINTS) {
      if (p.lat < a0 || p.lat > a1 || p.lng < l0 || p.lng > l1) continue;
      sm += p.w * field.specificHumidityKgPerKg[p.i] * 1000; st += p.w * p.teacher; sw += p.w;
    }
    if (sw > 0) out[name] = { model: sm / sw, teacher: st / sw, err: (sm - st) / sw };
  }
  return out;
}
function spearman(regions) {
  const names = Object.keys(regions);
  const rank = (key) => {
    const sorted = [...names].sort((a, b) => regions[a][key] - regions[b][key]);
    const r = {}; sorted.forEach((n, i) => (r[n] = i)); return r;
  };
  const rm = rank("model"), rt = rank("teacher");
  const N = names.length;
  let d2 = 0; for (const n of names) d2 += (rm[n] - rt[n]) ** 2;
  return 1 - (6 * d2) / (N * (N * N - 1));
}
const run = (cond, overrides) => buildMoistureField({
  terrainField, temperatureField, humidityField, wind: cond.wind, windMode: cond.mode,
  body: config.body, params: overrides,
});
const rowsFor = (field, sel) => POINTS.filter(sel).map((p) => [field.specificHumidityKgPerKg[p.i] * 1000, p.teacher, p.w]);
// The objective: land only, training half only, and NOTHING regional in it.
const objective = (field) => {
  const s = stats(rowsFor(field, (p) => p.isLand && p.train));
  return s ? s.mae : Infinity;
};

const out = { control: null, conditions: {} };
console.log("Climate v1 Stage 5B -- specific humidity against NCEP/NCAR R1");
console.log("PRIMARY VERDICT IS LAND, NOT GLOBAL CORRELATION. Ocean is a boundary");
console.log("condition taken from the teacher and is never reported as skill.\n");

// ------------------------------------------------- the declared control ---
{
  const RH0 = MOISTURE_PARAMETERS.surfaceRelativeHumidity.default;
  const bx = terrainField.width / GRID_W, by = terrainField.height / GRID_H;
  const qs = new Float64Array(GRID_W * GRID_H);
  for (let y = 0; y < terrainField.height; y++) for (let x = 0; x < terrainField.width; x++)
    qs[Math.floor(y / by) * GRID_W + Math.floor(x / bx)] += humidityField.saturationSpecificHumidityKgPerKg[y * terrainField.width + x];
  for (let i = 0; i < qs.length; i++) qs[i] /= bx * by;
  const ctl = { specificHumidityKgPerKg: qs.map((v) => v * RH0) };
  const land = stats(rowsFor(ctl, (p) => p.isLand));
  const glob = stats(rowsFor(ctl, () => true));
  out.control = { land, global: glob, regions: regionMeans(ctl) };
  console.log(`CONTROL  q = ${RH0} * q_sat, no transport`);
  console.log(`  global ${fmt(glob)}`);
  console.log(`  land   ${fmt(land)}`);
}

// ------------------------------------------------------------ screening ---
if (process.argv.includes("--screen")) {
  console.log("\nSCREENING: each searchable parameter swept alone, condition A");
  for (const [name, spec] of Object.entries(MOISTURE_PARAMETERS)) {
    if (!spec.search) continue;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k <= 6; k++) {
      const v = spec.min * Math.pow(spec.max / spec.min, k / 6);
      const s = objective(run(CONDITIONS[0], { [name]: v }));
      lo = Math.min(lo, s); hi = Math.max(hi, s);
    }
    console.log(`  ${name.padEnd(24)} objective swing ${(hi - lo).toFixed(4)} g/kg  (${lo.toFixed(3)} .. ${hi.toFixed(3)})`);
  }
}

// -------------------------------------------------------------- the fit ---
// Searched on condition A's land TRAINING half only. No regional term.
let best = {};
if (process.argv.includes("--search")) {
  console.log("\nSEARCH: land training half only, no regional term in the objective");
  let bestScore = Infinity;
  for (const tau of [0.5, 1, 2, 3, 5, 8, 12, 20]) {
    for (const K of [1e4, 5e4, 2e5, 6e5, 1.5e6, 3e6]) {
      const s = objective(run(CONDITIONS[0], { moistureResidenceDays: tau, eddyDiffusivityM2PerS: K }));
      if (s < bestScore) { bestScore = s; best = { moistureResidenceDays: tau, eddyDiffusivityM2PerS: K }; }
    }
  }
  console.log(`  best on training land: ${JSON.stringify(best)}  MAE=${bestScore.toFixed(3)} g/kg`);
}
out.params = best;

// ------------------------------------------------------- A / B / C runs ---
const results = {};
for (const cond of CONDITIONS) {
  const t0 = Date.now();
  const field = run(cond, best);
  const ms = Date.now() - t0;
  const landAll = stats(rowsFor(field, (p) => p.isLand));
  const landHold = stats(rowsFor(field, (p) => p.isLand && !p.train));
  const ocean = stats(rowsFor(field, (p) => !p.isLand));
  const glob = stats(rowsFor(field, () => true));
  const regions = regionMeans(field);
  let nonFinite = 0, over = 0;
  for (let i = 0; i < field.specificHumidityKgPerKg.length; i++) {
    if (!Number.isFinite(field.specificHumidityKgPerKg[i])) nonFinite++;
    if (field.relativeHumidity[i] > 1.05) over++;
  }
  results[cond.id] = { cond, field, landAll, landHold, ocean, glob, regions, nonFinite, over, ms,
    spearman: spearman(regions), ratio: regions.Amazon.model / regions.Sahara.model };
  out.conditions[cond.id] = { label: cond.label, land: landAll, landHeldOut: landHold, ocean, global: glob,
    regions, nonFinite, rhOver105: over, sweeps: field.meta.sweeps, converged: field.meta.converged,
    spearman: results[cond.id].spearman, amazonSaharaRatio: results[cond.id].ratio };
}

console.log("\n=== A / B / C ===");
for (const id of ["A", "B", "C"]) {
  const r = results[id];
  console.log(`\n${id}. ${r.cond.label}   [${r.field.meta.sweeps} sweeps, converged=${r.field.meta.converged}, ${r.ms} ms]`);
  console.log(`   LAND (all)      ${fmt(r.landAll)}`);
  console.log(`   LAND (held out) ${fmt(r.landHold)}`);
  console.log(`   ocean (boundary condition, NOT skill)  ${fmt(r.ocean)}`);
  console.log(`   global (not the verdict)               ${fmt(r.glob)}`);
  console.log(`   Amazon/Sahara ratio ${r.ratio.toFixed(2)}   region Spearman ${r.spearman.toFixed(3)}   RH>1.05: ${r.over}   non-finite: ${r.nonFinite}`);
}

console.log("\n=== the two comparisons the design asked for ===");
console.log(`  A vs B  (wind DIRECTION, speed identical): land MAE ${results.A.landAll.mae.toFixed(3)} vs ${results.B.landAll.mae.toFixed(3)} g/kg`);
console.log(`  A vs C  (adding Stage 4's own wind SPEED): land MAE ${results.A.landAll.mae.toFixed(3)} vs ${results.C.landAll.mae.toFixed(3)} g/kg`);

console.log("\n=== ten-region diagnostic (held out of the objective) ===");
console.log(`${"region".padEnd(12)} ${"teacher".padStart(8)} ${"control".padStart(8)} ${"A".padStart(8)} ${"B".padStart(8)} ${"C".padStart(8)}`);
for (const name of Object.keys(REGIONS)) {
  const t = results.A.regions[name];
  if (!t) continue;
  console.log(`${name.padEnd(12)} ${t.teacher.toFixed(2).padStart(8)} ${out.control.regions[name].model.toFixed(2).padStart(8)} ` +
    `${results.A.regions[name].model.toFixed(2).padStart(8)} ${results.B.regions[name].model.toFixed(2).padStart(8)} ${results.C.regions[name].model.toFixed(2).padStart(8)}`);
}

console.log("\n=== DECLARED SUCCESS CRITERIA (set before implementation) ===");
const CRITERIA = [
  ["land r >= 0.90 (control 0.8745)", (r) => r.landAll.r >= 0.90, (r) => r.landAll.r.toFixed(4)],
  ["land MAE <= 2.2 g/kg (control 2.66)", (r) => r.landAll.mae <= 2.2, (r) => r.landAll.mae.toFixed(2)],
  ["land |bias| <= 0.8 g/kg (control 1.35)", (r) => Math.abs(r.landAll.bias) <= 0.8, (r) => r.landAll.bias.toFixed(2)],
  ["Sahara error <= +4.0 g/kg (control +10.70)", (r) => r.regions.Sahara.err <= 4.0, (r) => r.regions.Sahara.err.toFixed(2)],
  ["Australia error <= +4.0 g/kg (control +8.74)", (r) => r.regions.Australia.err <= 4.0, (r) => r.regions.Australia.err.toFixed(2)],
  ["Amazon |error| <= 4.0 g/kg (control +4.35)", (r) => Math.abs(r.regions.Amazon.err) <= 4.0, (r) => r.regions.Amazon.err.toFixed(2)],
  ["Amazon/Sahara ratio >= 2.5 (control 1.52, teacher 4.09)", (r) => r.ratio >= 2.5, (r) => r.ratio.toFixed(2)],
  ["region Spearman >= 0.80", (r) => r.spearman >= 0.80, (r) => r.spearman.toFixed(3)],
  ["RH > 1.05 in 0 cells", (r) => r.over === 0, (r) => String(r.over)],
  ["0 NaN / Infinity", (r) => r.nonFinite === 0, (r) => String(r.nonFinite)],
];
for (const id of ["A", "B", "C"]) {
  const r = results[id];
  let pass = 0;
  console.log(`\n  condition ${id}:`);
  for (const [name, test, show] of CRITERIA) {
    const ok = test(r); if (ok) pass++;
    console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}  [${show(r)}]`);
  }
  console.log(`    ${pass}/${CRITERIA.length} criteria met`);
  out.conditions[id].criteriaMet = pass;
}
if (process.argv.includes("--json")) console.log("\n" + JSON.stringify(out, null, 1));
