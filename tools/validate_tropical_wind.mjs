// Stage 5C-wind: does an axisymmetric Hadley surface-pressure term fix the
// tropical wind WITHOUT damaging Stage 4's mid-latitude result?
//
// Criteria were declared before implementation and are not adjusted here.
// NCEP is a diagnostic teacher only and is never an input to the model.
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
import { buildHadleyCirculation, buildGillCirculation } from "../js/climate-v1/tropical-circulation.js";
import { parseWindGrid } from "../js/climate-v1/wind-teacher.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import { buildMoistureField, WIND_MODES } from "../js/climate-v1/moisture.js";
import { scoreWindBands, formatWindBandTable, WIND_LATITUDE_BANDS } from "../js/climate-v1/wind-diagnostic.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai"), TD = path.join(WORLD, "teacher");
const W = 256, HH = 128, G = 9.80665;
const ATM = { seaLevelPressureHPa: 1013.25, specificGasConstantJPerKgK: 287.05, vapourGasConstantJPerKgK: 461.52 };
const WIND_ATM = { specificGasConstantJPerKgK: 287, surfacePressureHPa: 1000, levelPressureHPa: 850 };
const WIND_PARAMS = { thermalResponseStrength: 1, dragTimescaleDays: 0.5, thermalSmoothingKm: 1500 };

const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));
const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
const off = config.terrain.encoding.offsetMetres;
const metres = new Int16Array(png.width * png.height);
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - off;
const sets = resolveClimateSets(config);
const shipped = sets.sets.find((s) => s.id === sets.defaultId).values;
const params = { ...shipped, ...CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION };
const terrainField = buildTerrainField({ elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0,
  oceanMask: loadOceanMask(config, REPO), waterSurfaceMask: loadWaterSurfaceMask(config, REPO) });
const temperatureField = buildTemperatureField({ terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params });
const humidityField = buildHumidityField({ terrainField, temperatureField, lapseRateCPerKm: params.lapseRateCPerKm,
  body: { gravityMs2: G }, atmosphere: ATM });

const makeWind = (sg) => buildClimateV1Wind({ terrainField, temperatureField, lapseRateCPerKm: params.lapseRateCPerKm,
  body: config.body, atmosphere: WIND_ATM, params: WIND_PARAMS, surfaceGeopotentialByRow: sg, width: W, height: HH });
// Solved on the WIND grid's rows, not the fine temperature grid's.
const coarseTemp = (() => {
  const by = temperatureField.height / HH, bx = temperatureField.width / W;
  const arr = new Float64Array(W * HH);
  for (let y = 0; y < temperatureField.height; y++) for (let x = 0; x < temperatureField.width; x++)
    arr[Math.floor(y / by) * W + Math.floor(x / bx)] += temperatureField.annualMeanTemperatureC[y * temperatureField.width + x];
  for (let i = 0; i < arr.length; i++) arr[i] /= bx * by;
  return { width: W, height: HH, annualMeanTemperatureC: arr };
})();
const hadley = (o) => buildHadleyCirculation({ temperatureField: coarseTemp, body: config.body,
  atmosphere: { specificGasConstantJPerKgK: 287, gravityMs2: G }, dragTimescaleDays: WIND_PARAMS.dragTimescaleDays, params: o });

// ---- teacher wind ----------------------------------------------------------
const wsum = JSON.parse(readFileSync(path.join(TD, "wind-summary.json"), "utf8"));
const spec = wsum.grids.level850hPa;
const tu = parseWindGrid(readFileSync(path.join(TD, spec.files.u)), spec).values;
const tv = parseWindGrid(readFileSync(path.join(TD, spec.files.v)), spec).values;
const tLat = (j) => spec.latitudes[j], tLng = (i) => spec.longitudes[i];
// The teacher, carrying its own axes so the shared metric core never has to
// assume a cell-centred grid. There is no local compare() any more: every
// number below comes from js/climate-v1/wind-diagnostic.js, the same code
// validate_wind_model_stage4.mjs scores with.
const teacher = { width: spec.width, height: spec.height, u: tu, v: tv,
  latitudes: spec.latitudes, longitudes: spec.longitudes };
const score = (wind) => scoreWindBands({ modelField: wind, teacher });

// zonal wind over the tropical Atlantic feeding the Amazon
function amazonZonal(wind) {
  let s = 0, n = 0;
  for (let y = 0; y < HH; y++) {
    const lat = 90 - ((y + 0.5) * 180) / HH; if (lat > 0 || lat < -15) continue;
    for (let x = 0; x < W; x++) {
      const lng = -180 + ((x + 0.5) * 360) / W; if (lng < -50 || lng > -20) continue;
      s += wind.uWindMs[y * W + x]; n++;
    }
  }
  return s / n;
}
// Stage 5B moisture, UNCHANGED, at the fixed baseline (tau=8 d, explicit K=0)
const hsum = JSON.parse(readFileSync(path.join(TD, "humidity-summary.json"), "utf8"));
const TG = {};
for (const [n, s] of Object.entries(hsum.grids)) TG[n] = { ...parseTeacherGrid(readFileSync(path.join(TD, s.file)), s), latitudes: s.latitudes, longitudes: s.longitudes };
const nearIn = (ax, v, wrap) => { let b = 0, bd = Infinity; for (let i = 0; i < ax.length; i++) { let d = Math.abs(ax[i] - v); if (wrap) d = Math.min(d, 360 - d); if (d < bd) { bd = d; b = i; } } return b; };
function amazonQ(wind) {
  const f = buildMoistureField({ terrainField, temperatureField, humidityField, wind, windMode: WIND_MODES.PHYSICAL, body: config.body, maxSweeps: 4000 });
  let sm = 0, st = 0, sw = 0;
  const g = TG.specificHumidityKgPerKg;
  for (let y = 0; y < HH; y++) {
    const lat = 90 - ((y + 0.5) * 180) / HH; if (lat < -8 || lat > 2) continue;
    for (let x = 0; x < W; x++) {
      const lng = -180 + ((x + 0.5) * 360) / W; if (lng < -70 || lng > -55) continue;
      const t = g.values[nearIn(g.latitudes, lat) * g.width + nearIn(g.longitudes.map((l) => (l > 180 ? l - 360 : l)), lng, true)];
      if (!Number.isFinite(t)) continue;
      const w = Math.cos((lat * Math.PI) / 180);
      sm += w * f.specificHumidityKgPerKg[y * W + x] * 1000; st += w * t * 1000; sw += w;
    }
  }
  return { model: sm / sw, teacher: st / sw };
}

console.log("Stage 5C-wind -- axisymmetric Hadley surface pressure. NCEP = diagnostic teacher only.\n");
const gill = (o) => buildGillCirculation({ temperatureField: coarseTemp, body: config.body,
  atmosphere: { specificGasConstantJPerKgK: 287, gravityMs2: G }, dragTimescaleDays: WIND_PARAMS.dragTimescaleDays, params: o });
const CASES = [["Stage 4 (baseline)", null]];
// The axisymmetric Hadley response, kept so all three rejected families are
// re-scored by the unified validator in one run.
for (const [H, a] of [[100, 2], [250, 2]]) {
  CASES.push([`Hadley A=${a} H=${H}`, hadley({ equivalentDepthMetres: H, heatingResponseStrength: a }).surfaceGeopotentialM2S2]);
}
// A = zonal only, B = longitudinal only, C = both. Same solver, same depth.
for (const H of [100, 250]) {
  for (const [tag, z, l] of [["A z", 1, 0], ["A z", 2, 0], ["B l", 0, 1], ["B l", 0, 2], ["C both", 1, 1], ["C both", 1, 2], ["C both", 2, 2]]) {
    CASES.push([`${tag}=${z}/${l} H=${H}`, gill({ equivalentDepthMetres: H, zonalHeatingStrength: z, longitudinalHeatingStrength: l }).surfaceGeopotentialM2S2]);
  }
}
console.log(`${"case".padEnd(20)} ${"tropDir".padStart(8)} ${"midDir".padStart(7)} ${"extDir".padStart(7)} ${"mid r".padStart(7)} ${"ext r".padStart(7)} ${"mid anom r".padStart(11)} ${"vecRMSE".padStart(8)} ${"Amazon u".padStart(9)}`);
const out = {};
for (const [label, sg] of CASES) {
  const wind = makeWind(sg);
  const b = score(wind);
  out[label] = { wind, b, tr: b.tropics, ml: b.midlatitude, ex: b.extratropics, gl: b.global, u: amazonZonal(wind) };
  const w = (k, m, d = 3) => b[k].weighted[m].toFixed(d);
  console.log(`${label.padEnd(20)} ${w("tropics", "directionMeanErrorDeg", 1).padStart(8)} ${w("midlatitude", "directionMeanErrorDeg", 1).padStart(7)} ${w("extratropics", "directionMeanErrorDeg", 1).padStart(7)} ${w("midlatitude", "speedCorrelation").padStart(7)} ${w("extratropics", "speedCorrelation").padStart(7)} ${w("midlatitude", "anomalySpeedCorrelation").padStart(11)} ${w("global", "vectorRmseMS").padStart(8)} ${out[label].u.toFixed(2).padStart(9)}`);
}
console.log("\n(teacher zonal wind over the same Atlantic box, for reference)");
{
  let s = 0, n = 0;
  for (let j = 0; j < spec.height; j++) { const lat = tLat(j); if (lat > 0 || lat < -15) continue;
    for (let i = 0; i < spec.width; i++) { const lng = tLng(i); if (lng < -50 || lng > -20) continue;
      const k = j * spec.width + i; if (Number.isFinite(tu[k])) { s += tu[k]; n++; } } }
  console.log(`  NCEP 850 u = ${(s / n).toFixed(2)} m/s (easterly if negative)`);
}
console.log("\n=== declared criteria, best Hadley case vs Stage 4 ===");
const base = out["Stage 4 (baseline)"];
let best = null;
for (const [label, v] of Object.entries(out)) {
  if (label.startsWith("Stage 4")) continue;
  const d = (x) => x.tr.weighted.directionMeanErrorDeg;
  if (v.u < 0 && (best === null || d(v) < d(out[best]))) best = label;
}
if (!best) { console.log("  no case produced an easterly Amazon zonal wind"); }
else {
  const b = out[best];
  const aq = amazonQ(b.wind), bq = amazonQ(base.wind);
  const D = (r) => r.weighted.directionMeanErrorDeg, R = (r) => r.weighted.speedCorrelation;
  const C = [
    [`tropical direction error <= 70 deg (Stage 4: ${D(base.tr).toFixed(1)})`, D(b.tr) <= 70, D(b.tr).toFixed(1)],
    ["Amazon-box zonal wind easterly (u < 0)", b.u < 0, b.u.toFixed(2)],
    // Measured on the SAME band as the baseline it is compared with. The
    // earlier thresholds (38 deg, r >= 0.30) came from the Stage 4 validator's
    // |lat|>=30 numbers while being tested at 30-60 -- two different bands.
    [`midlat (30-60) direction error not worse than Stage 4 (${D(base.ml).toFixed(1)})`, D(b.ml) <= D(base.ml), D(b.ml).toFixed(1)],
    [`midlat (30-60) speed r not worse than Stage 4 (${R(base.ml).toFixed(3)})`, R(b.ml) >= R(base.ml), R(b.ml).toFixed(3)],
    [`extratropics (>=30) speed r not worse than Stage 4 (${R(base.ex).toFixed(3)})`, R(b.ex) >= R(base.ex), R(b.ex).toFixed(3)],
    ["global vector RMSE not worse than Stage 4", b.gl.weighted.vectorRmseMS <= base.gl.weighted.vectorRmseMS, `${b.gl.weighted.vectorRmseMS.toFixed(3)} vs ${base.gl.weighted.vectorRmseMS.toFixed(3)}`],
    ["Amazon q >= 8 g/kg with Stage 5B unchanged (Stage 4: 0.0)", aq.model >= 8, `${aq.model.toFixed(2)} (Stage 4 gives ${bq.model.toFixed(2)}, teacher ${aq.teacher.toFixed(2)})`],
  ];
  console.log(`  best case: ${best}`);
  console.log("\n  full band table -- Stage 4 baseline:");
  console.log(formatWindBandTable(base.b, { indent: "    " }));
  console.log(`\n  full band table -- ${best}:`);
  console.log(formatWindBandTable(b.b, { indent: "    " }));
  console.log("");
  let pass = 0;
  for (const [n, ok, val] of C) { if (ok) pass++; console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}  [${val}]`); }
  console.log(`    ${pass}/${C.length}`);
}
