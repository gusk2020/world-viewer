// Stage 5B.1 -- DIAGNOSIS ONLY. No new mechanism, and js/climate-v1/moisture.js
// is NOT modified: every case here is produced by changing the solver's
// INPUTS, never its code.
//
// Stage 5B failed 3/10 of its declared criteria. The write-up named missing
// land evapotranspiration as the cause; that is a hypothesis, not a finding.
// This separates four candidates:
//
//   A. the wind field is bad
//   B. there is no land evapotranspiration / moisture recycling
//   C. the transport solver itself is bad
//   D. annual-mean and resolution limits
//
// The decisive instrument is an ORACLE test: feed the unchanged solver the
// real observed wind. If the Amazon stays dry on a perfect wind, the wind is
// not the cause.
//
// Judgement rules were fixed BEFORE running (see the brief), and are echoed at
// the end so the verdict cannot be chosen after the fact.
//
// Usage: node tools/diagnose_moisture_stage5b1.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import { buildHumidityField, saturationSpecificHumidity, saturationVapourPressureHPa } from "../js/climate-v1/humidity.js";
import { buildClimateV1Wind } from "../js/climate-v1/wind.js";
import { currentModelWind, nearestModelRow } from "../js/climate-v1/wind-diagnostic.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import { parseWindGrid } from "../js/climate-v1/wind-teacher.js";
import { buildMoistureField, WIND_MODES, MOISTURE_PARAMETERS } from "../js/climate-v1/moisture.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai");
const TEACHER = path.join(WORLD, "teacher");
const ATM = { seaLevelPressureHPa: 1013.25, specificGasConstantJPerKgK: 287.05, vapourGasConstantJPerKgK: 461.52 };
const EPS = ATM.specificGasConstantJPerKgK / ATM.vapourGasConstantJPerKgK;
const G = 9.80665, W = 256, H = 128;
// The Stage 5B fit, used UNCHANGED for every case. D and E get no special values.
const FIT = { moistureResidenceDays: 8, eddyDiffusivityM2PerS: 3e6 };

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
const sampleTeacher = (g, lat, lng) => g.values[nearestIn(g.latitudes, lat) * g.width + nearestIn(g.longitudes.map((l) => (l > 180 ? l - 360 : l)), lng, true)];
const teacherQ = (lat, lng) => sampleTeacher(TG.specificHumidityKgPerKg, lat, lng);

// ------------------------------------------------------- the NCEP winds -----
// Regridded to 256x128 BY COORDINATE, using each source grid's own axes.
// The 10 m wind is on NCEP's T62 Gaussian grid (192x94) whose rows are NOT
// evenly spaced; its axes are borrowed from the humidity teacher's 2 m fields,
// which come from the same surface_gauss product family on the same grid. The
// dimensions are asserted rather than assumed.
const wsum = JSON.parse(readFileSync(path.join(TEACHER, "wind-summary.json"), "utf8"));
function ncepWind(levelKey, label) {
  const spec = wsum.grids[levelKey];
  const u = parseWindGrid(readFileSync(path.join(TEACHER, spec.files.u)), spec).values;
  const v = parseWindGrid(readFileSync(path.join(TEACHER, spec.files.v)), spec).values;
  let lats, lons;
  if (spec.width === 144 && spec.height === 73) {
    lats = Array.from({ length: 73 }, (_, j) => 90 - j * 2.5);
    lons = Array.from({ length: 144 }, (_, i) => -180 + i * 2.5);
  } else if (spec.width === TG.specificHumidityKgPerKg.width && spec.height === TG.specificHumidityKgPerKg.height) {
    lats = TG.specificHumidityKgPerKg.latitudes;
    lons = TG.specificHumidityKgPerKg.longitudes.map((l) => (l > 180 ? l - 360 : l));
  } else {
    throw new Error(`no axes known for ${levelKey} at ${spec.width}x${spec.height}`);
  }
  const uu = new Float64Array(W * H), vv = new Float64Array(W * H);
  let masked = 0;
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) * 180) / H;
    const j = nearestIn(lats, lat);
    for (let x = 0; x < W; x++) {
      const lng = -180 + ((x + 0.5) * 360) / W;
      const i = j * spec.width + nearestIn(lons, lng, true);
      if (!Number.isFinite(u[i]) || !Number.isFinite(v[i])) { masked++; continue; } // below ground at 850 hPa -> calm
      uu[y * W + x] = u[i]; vv[y * W + x] = v[i];
    }
  }
  console.log(`  ${label}: ${spec.width}x${spec.height} -> ${W}x${H}, ${masked} cells masked (treated as calm)`);
  return { width: W, height: H, uWindMs: uu, vWindMs: vv };
}

console.log("Stage 5B.1 -- failure diagnosis. No mechanism added; moisture.js unchanged.\n");
console.log("regridding the observed winds by coordinate:");
const ncep850 = ncepWind("level850hPa", "NCEP 850 hPa");
const ncep10m = ncepWind("level10m", "NCEP 10 m");

const stage4 = buildClimateV1Wind({
  terrainField, temperatureField, lapseRateCPerKm: params.lapseRateCPerKm, body: config.body,
  atmosphere: { specificGasConstantJPerKgK: 287, surfacePressureHPa: 1000, levelPressureHPa: 850 },
  params: { thermalResponseStrength: 1, dragTimescaleDays: 0.5, thermalSmoothingKm: 1500 }, width: W, height: H,
});
const v08row = currentModelWind({ rows: 180, dayLengthHours: config.body.dayLengthHours, rotationDirection: config.body.rotationDirection, params: shipped, subsolarDeg: 0 });
const v08 = { width: W, height: H, uWindMs: new Float64Array(W * H), vWindMs: new Float64Array(W * H) };
for (let y = 0; y < H; y++) {
  const r = nearestModelRow(90 - ((y + 0.5) * 180) / H, v08row.rows);
  for (let x = 0; x < W; x++) { v08.uWindMs[y * W + x] = v08row.east[r]; v08.vWindMs[y * W + x] = v08row.north[r]; }
}

// --------------------------------------------------------------- scoring ---
const bx = terrainField.width / W, by = terrainField.height / H;
const waterFrac = new Float64Array(W * H);
for (let y = 0; y < terrainField.height; y++) for (let x = 0; x < terrainField.width; x++)
  waterFrac[Math.floor(y / by) * W + Math.floor(x / bx)] += terrainField.isWaterSurface[y * terrainField.width + x];
for (let i = 0; i < waterFrac.length; i++) waterFrac[i] /= bx * by;
const POINTS = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const lat = 90 - ((y + 0.5) * 180) / H, lng = -180 + ((x + 0.5) * 360) / W;
  const t = teacherQ(lat, lng);
  if (!Number.isFinite(t)) continue;
  POINTS.push({ i: y * W + x, lat, lng, teacher: t * 1000, w: Math.cos((lat * Math.PI) / 180), isLand: waterFrac[y * W + x] < 0.5 });
}
function stats(rows) {
  let sw = 0, sa = 0, sb = 0;
  for (const [a, b, w] of rows) { sw += w; sa += w * a; sb += w * b; }
  const ma = sa / sw, mb = sb / sw;
  let saa = 0, sbb = 0, sab = 0, sae = 0;
  for (const [a, b, w] of rows) { saa += w * (a - ma) ** 2; sbb += w * (b - mb) ** 2; sab += w * (a - ma) * (b - mb); sae += w * Math.abs(a - b); }
  return { r: sab / Math.sqrt(saa * sbb), mae: sae / sw, bias: ma - mb };
}
const REGIONS = { Amazon: [-70, -55, -8, 2], Sahara: [-8, 28, 18, 28], Australia: [120, 145, -30, -18], Indonesia: [100, 130, -8, 6], Europe: [0, 30, 45, 58] };
function regionMean(f, name) {
  const [l0, l1, a0, a1] = REGIONS[name];
  let sm = 0, st = 0, sw = 0;
  for (const p of POINTS) { if (p.lat < a0 || p.lat > a1 || p.lng < l0 || p.lng > l1) continue; sm += p.w * f.specificHumidityKgPerKg[p.i] * 1000; st += p.w * p.teacher; sw += p.w; }
  return { model: sm / sw, teacher: st / sw };
}
const run = (wind, mode, hf = humidityField, extra = {}) => buildMoistureField({
  terrainField, temperatureField, humidityField: hf, wind, windMode: mode, body: config.body,
  params: { ...FIT, ...extra }, maxSweeps: 4000,
});
function report(id, label, f) {
  const land = stats(POINTS.filter((p) => p.isLand).map((p) => [f.specificHumidityKgPerKg[p.i] * 1000, p.teacher, p.w]));
  const am = regionMean(f, "Amazon"), sa = regionMean(f, "Sahara"), au = regionMean(f, "Australia");
  console.log(`${id.padEnd(30)} r=${land.r.toFixed(3)}  MAE=${land.mae.toFixed(2)}  bias=${land.bias >= 0 ? "+" : ""}${land.bias.toFixed(2)}  ` +
    `Amazon ${am.model.toFixed(1)}  Sahara ${sa.model.toFixed(1)}  Australia ${au.model.toFixed(1)}  ratio ${(am.model / sa.model).toFixed(2)}`);
  return { land, amazon: am.model, sahara: sa.model, ratio: am.model / sa.model };
}

// ================================================================= 1. A-E ===
console.log("\n=== 1. A / B / C / D / E -- identical solver, RH, tau, diffusion, cap ===");
console.log(`    (tau=${FIT.moistureResidenceDays} d, K=${FIT.eddyDiffusivityM2PerS.toExponential(0)}, RH0=${MOISTURE_PARAMETERS.surfaceRelativeHumidity.default})`);
const teacherAmazon = regionMean({ specificHumidityKgPerKg: new Float32Array(W * H) }, "Amazon").teacher;
const teacherSahara = regionMean({ specificHumidityKgPerKg: new Float32Array(W * H) }, "Sahara").teacher;
console.log(`${"TEACHER".padEnd(30)} ${" ".repeat(34)}Amazon ${teacherAmazon.toFixed(1)}  Sahara ${teacherSahara.toFixed(1)}  ` +
  `Australia ${regionMean({ specificHumidityKgPerKg: new Float32Array(W * H) }, "Australia").teacher.toFixed(1)}  ratio ${(teacherAmazon / teacherSahara).toFixed(2)}`);
const CASES = [
  ["A direction Stage 4", stage4, WIND_MODES.DIRECTION],
  ["B direction v0.8", v08, WIND_MODES.DIRECTION],
  ["C physical Stage 4", stage4, WIND_MODES.PHYSICAL],
  ["D direction NCEP 850", ncep850, WIND_MODES.DIRECTION],
  ["D physical NCEP 850", ncep850, WIND_MODES.PHYSICAL],
  ["E direction NCEP 10 m", ncep10m, WIND_MODES.DIRECTION],
  ["E physical NCEP 10 m", ncep10m, WIND_MODES.PHYSICAL],
];
const R = {};
for (const [label, wind, mode] of CASES) R[label] = report(label, label, run(wind, mode));

// ======================================================== 2. transects ======
console.log("\n=== 2. Amazon transects: where the moisture is lost ===");
function transect(label, wind, mode, lat) {
  const f = run(wind, mode);
  const y = Math.floor(((90 - lat) / 180) * H);
  const dy = (Math.PI * config.body.radiusMetres) / H;
  const rowLat = 90 - ((y + 0.5) * 180) / H;
  const dx = (2 * Math.PI * config.body.radiusMetres * Math.max(Math.cos((89.5 * Math.PI) / 180), Math.cos((rowLat * Math.PI) / 180))) / W;
  const tau = FIT.moistureResidenceDays * 86400, K = FIT.eddyDiffusivityM2PerS;
  console.log(`\n  ${label}, ${lat}S  (q g/kg | wind dir/speed | advective% diffusive% | cap removal)`);
  for (const lng of [-38, -46, -54, -62, -70]) {
    const x = Math.floor(((lng + 180) / 360) * W), i = y * W + x;
    let u = wind.uWindMs[i], v = wind.vWindMs[i];
    const rawSpeed = Math.hypot(u, v);
    if (mode === WIND_MODES.DIRECTION && rawSpeed > 0) { u = (u / rawSpeed) * 5; v = (v / rawSpeed) * 5; }
    const east = y * W + (x === W - 1 ? 0 : x + 1), west = y * W + (x === 0 ? W - 1 : x - 1);
    const north = y === 0 ? i : i - W, south = y === H - 1 ? i : i + W;
    const a = Math.abs(u) / dx, b = Math.abs(v) / dy, dxx = K / (dx * dx), dyy = K / (dy * dy);
    const q = f.specificHumidityKgPerKg;
    const adv = a * q[u >= 0 ? west : east] + b * q[v >= 0 ? south : north];
    const dif = dxx * (q[east] + q[west]) + dyy * (q[north] + q[south]);
    const tot = adv + dif;
    const dirDeg = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
    console.log(`    ${String(lng).padStart(4)}W  q=${(q[i] * 1000).toFixed(2).padStart(6)}${f.isSource[i] ? "*" : " "} ` +
      `dir=${dirDeg.toFixed(0).padStart(3)}deg spd=${rawSpeed.toFixed(1).padStart(5)} m/s  ` +
      `adv=${tot > 0 ? ((adv / tot) * 100).toFixed(0).padStart(3) : " --"}% dif=${tot > 0 ? ((dif / tot) * 100).toFixed(0).padStart(3) : " --"}%  ` +
      `cap removed ${(f.condensationKgPerKg[i] * 1000).toFixed(3)}`);
  }
}
for (const lat of [-4, -10]) {
  transect("A Stage 4 (direction)", stage4, WIND_MODES.DIRECTION, lat);
  transect("D NCEP 850 (physical)", ncep850, WIND_MODES.PHYSICAL, lat);
}

// ============================================ 3. one factor at a time =======
console.log("\n=== 3. One factor at a time (never two together) ===");
// The cap cases are built by changing the INPUT q_sat, so moisture.js is untouched.
// Only NON-source cells are altered, so the water boundary condition is identical.
function humidityWith(transform) {
  const n = terrainField.width * terrainField.height;
  const qs = new Float32Array(humidityField.saturationSpecificHumidityKgPerKg);
  for (let y = 0; y < terrainField.height; y++) for (let x = 0; x < terrainField.width; x++) {
    const i = y * terrainField.width + x;
    if (waterFrac[Math.floor(y / by) * W + Math.floor(x / bx)] >= 0.5) continue; // leave sources alone
    qs[i] = transform(i);
  }
  return { ...humidityField, saturationSpecificHumidityKgPerKg: qs };
}
const NO_CAP = humidityWith(() => 1.0); // 1 kg/kg is unreachable: the cap can never bind
const SEA_LEVEL_CAP = humidityWith((i) => {
  // Keep the thermodynamic cap but remove its ELEVATION dependence, which is
  // what makes it orographic. Sea-level temperature and sea-level pressure.
  const tC = temperatureField.annualMeanTemperatureC[i] + (params.lapseRateCPerKm * terrainField.relativeSurfaceElevationMetres[i]) / 1000;
  return saturationSpecificHumidity(saturationVapourPressureHPa(tC), ATM.seaLevelPressureHPa, EPS);
});
for (const [wLabel, wind, mode] of [["A Stage 4 (direction)", stage4, WIND_MODES.DIRECTION], ["D NCEP 850 (physical)", ncep850, WIND_MODES.PHYSICAL]]) {
  console.log(`\n  base: ${wLabel}`);
  report("    (unchanged)", "", run(wind, mode));
  report("    tau = 1000 days", "", run(wind, mode, humidityField, { moistureResidenceDays: 1000 }));
  report("    diffusion = 0", "", run(wind, mode, humidityField, { eddyDiffusivityM2PerS: 0 }));
  report("    q_sat cap disabled", "", run(wind, mode, NO_CAP));
  report("    orographic part of cap off", "", run(wind, mode, SEA_LEVEL_CAP));
}

// ===================================== 4. the diffusion trade-off ==========
// Still one factor at a time: only K moves. This exists because section 3
// showed the fitted K (3e6, which the Stage 5B search pinned to its upper
// bound) is what destroys the desert/rainforest contrast, while the search
// chose it because it minimises land MAE. The objective and the declared
// criteria disagree, and this measures by how much.
console.log("\n=== 4. Diffusion sweep (one factor), base D NCEP 850 physical ===");
console.log(`${"K (m^2/s)".padEnd(12)} ${"land r".padStart(7)} ${"land MAE".padStart(9)} ${"bias".padStart(7)} ${"Amazon".padStart(7)} ${"Sahara".padStart(7)} ${"Austral".padStart(8)} ${"ratio".padStart(6)}`);
console.log(`${"TEACHER".padEnd(12)} ${"".padStart(7)} ${"".padStart(9)} ${"".padStart(7)} ${teacherAmazon.toFixed(1).padStart(7)} ${teacherSahara.toFixed(1).padStart(7)} ${regionMean({ specificHumidityKgPerKg: new Float32Array(W * H) }, "Australia").teacher.toFixed(1).padStart(8)} ${(teacherAmazon / teacherSahara).toFixed(2).padStart(6)}`);
for (const K of [0, 1e4, 5e4, 2e5, 6e5, 1.5e6, 3e6]) {
  const f = run(ncep850, WIND_MODES.PHYSICAL, humidityField, { eddyDiffusivityM2PerS: K });
  const land = stats(POINTS.filter((p) => p.isLand).map((p) => [f.specificHumidityKgPerKg[p.i] * 1000, p.teacher, p.w]));
  const am = regionMean(f, "Amazon").model, sa = regionMean(f, "Sahara").model, au = regionMean(f, "Australia").model;
  console.log(`${K.toExponential(0).padEnd(12)} ${land.r.toFixed(3).padStart(7)} ${land.mae.toFixed(2).padStart(9)} ${(land.bias >= 0 ? "+" : "") + land.bias.toFixed(2)} ${am.toFixed(1).padStart(7)} ${sa.toFixed(1).padStart(7)} ${au.toFixed(1).padStart(8)} ${(am / sa).toFixed(2).padStart(6)}`);
}

console.log("\n=== judgement rules, fixed before the run ===");
console.log("  Case 1: NCEP wind still leaves the Amazon dry -> wind cannot explain it; recycling is the next candidate.");
console.log("  Case 2: NCEP wind brings the Amazon close to the teacher -> the wind model is the main cause.");
console.log("  Case 3: removing one numerical term alone fixes it -> the solver is the problem.");
console.log("  Case 4: 850 hPa and 10 m differ greatly -> which level represents vapour transport is its own open question.");
