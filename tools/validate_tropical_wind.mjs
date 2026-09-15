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
import { buildHadleyCirculation } from "../js/climate-v1/tropical-circulation.js";
import { parseWindGrid } from "../js/climate-v1/wind-teacher.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import { buildMoistureField, WIND_MODES } from "../js/climate-v1/moisture.js";

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
const tLat = (j) => 90 - j * 2.5, tLng = (i) => -180 + i * 2.5;
function compare(wind, latMin, latMax) {
  let sw = 0, sdir = 0, sa = 0, sb = 0, rows = [], svec = 0;
  for (let j = 0; j < spec.height; j++) {
    const lat = tLat(j); if (Math.abs(lat) < latMin || Math.abs(lat) > latMax) continue;
    const w = Math.cos((lat * Math.PI) / 180);
    const y = Math.min(HH - 1, Math.max(0, Math.floor(((90 - lat) / 180) * HH)));
    for (let i = 0; i < spec.width; i++) {
      const k = j * spec.width + i; if (!Number.isFinite(tu[k])) continue;
      const x = Math.min(W - 1, Math.max(0, Math.floor(((tLng(i) + 180) / 360) * W)));
      const mu = wind.uWindMs[y * W + x], mv = wind.vWindMs[y * W + x];
      const tm = Math.hypot(tu[k], tv[k]), mm = Math.hypot(mu, mv);
      if (tm > 1 && mm > 1e-6) {
        const c = Math.min(1, Math.max(-1, (mu * tu[k] + mv * tv[k]) / (tm * mm)));
        sdir += w * (Math.acos(c) * 180) / Math.PI; sw += w;
      }
      rows.push([mm, tm, w]); sa += w * mm; sb += w * tm;
      svec += w * ((mu - tu[k]) ** 2 + (mv - tv[k]) ** 2);
    }
  }
  let tw = 0; for (const [, , w] of rows) tw += w;
  const ma = sa / tw, mb = sb / tw;
  let saa = 0, sbb = 0, sab = 0;
  for (const [a, b, w] of rows) { saa += w * (a - ma) ** 2; sbb += w * (b - mb) ** 2; sab += w * (a - ma) * (b - mb); }
  return { dir: sdir / sw, r: sab / Math.sqrt(saa * sbb), vecRmse: Math.sqrt(svec / tw) };
}
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
const CASES = [["Stage 4 (unchanged)", null]];
for (const H of [100, 250, 500]) for (const A of [0.5, 1, 2]) CASES.push([`+Hadley H=${H} A=${A}`, hadley({ equivalentDepthMetres: H, heatingResponseStrength: A }).surfaceGeopotentialM2S2]);
console.log(`${"case".padEnd(24)} ${"trop dir".padStart(9)} ${"midlat dir".padStart(11)} ${"midlat r".padStart(9)} ${"glob vecRMSE".padStart(13)} ${"Amazon u".padStart(9)}`);
const out = {};
for (const [label, sg] of CASES) {
  const wind = makeWind(sg);
  const tr = compare(wind, 0, 30), ml = compare(wind, 30, 60), gl = compare(wind, 0, 90);
  out[label] = { wind, tr, ml, gl, u: amazonZonal(wind) };
  console.log(`${label.padEnd(24)} ${tr.dir.toFixed(1).padStart(9)} ${ml.dir.toFixed(1).padStart(11)} ${ml.r.toFixed(3).padStart(9)} ${gl.vecRmse.toFixed(3).padStart(13)} ${out[label].u.toFixed(2).padStart(9)}`);
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
const base = out["Stage 4 (unchanged)"];
let best = null;
for (const [label, v] of Object.entries(out)) {
  if (label.startsWith("Stage 4")) continue;
  if (v.u < 0 && (best === null || v.tr.dir < out[best].tr.dir)) best = label;
}
if (!best) { console.log("  no case produced an easterly Amazon zonal wind"); }
else {
  const b = out[best];
  const aq = amazonQ(b.wind), bq = amazonQ(base.wind);
  const C = [
    ["tropical direction error <= 70 deg (Stage 4: 125.9)", b.tr.dir <= 70, b.tr.dir.toFixed(1)],
    ["Amazon-box zonal wind easterly (u < 0)", b.u < 0, b.u.toFixed(2)],
    ["mid-latitude direction error <= 38 deg (Stage 4: 35.3)", b.ml.dir <= 38, b.ml.dir.toFixed(1)],
    ["mid-latitude speed r >= 0.30 (Stage 4: 0.334)", b.ml.r >= 0.30, b.ml.r.toFixed(3)],
    ["global vector RMSE not worse than Stage 4", b.gl.vecRmse <= base.gl.vecRmse, `${b.gl.vecRmse.toFixed(3)} vs ${base.gl.vecRmse.toFixed(3)}`],
    ["Amazon q >= 8 g/kg with Stage 5B unchanged (Stage 4: 0.0)", aq.model >= 8, `${aq.model.toFixed(2)} (Stage 4 gives ${bq.model.toFixed(2)}, teacher ${aq.teacher.toFixed(2)})`],
  ];
  console.log(`  best case: ${best}`);
  let pass = 0;
  for (const [n, ok, val] of C) { if (ok) pass++; console.log(`    ${ok ? "PASS" : "FAIL"}  ${n}  [${val}]`); }
  console.log(`    ${pass}/${C.length}`);
}
