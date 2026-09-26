// Climate v1's golden reference: one command that prints every headline
// number the stable version is defined by, and fails if any of them moved.
//
// This exists because Climate v1 is closed, not finished. The next session
// will change something, and the question it will need answered in seconds is
// "what moved?" -- not "do twenty validators still say OK". Each validator
// checks its own stage in depth; this checks the small set of numbers that
// together identify the model, in one place, against a committed file.
//
// Nothing here fits, searches or tunes anything. Run it with `--write` to
// re-record the golden file, and only after deliberately changing the model.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import { buildClimateV1Preview, PREVIEW_GRID } from "../js/climate-v1/preview.js";
import {
  CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION, climateV1SeasonParams, climateV1LandSeaParams,
} from "../js/climate-v1/earth-temperature-calibration.js";
import {
  SEASON_PARAMETERS, SURFACE_LAND, SURFACE_SEA, buildSeasonalTemperatureTable, sampleSeasonalAnomalyC,
} from "../js/climate-v1/season.js";
import { buildSeaIceCycle } from "../js/climate-v1/sea-ice-state.js";
import { applyLandSeaCoupling } from "../js/climate-v1/land-sea-coupling.js";
import { buildClimateV1Wind } from "../js/climate-v1/wind.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai");
const GOLDEN = path.join(WORLD, "climate-v1-golden.json");
const write = process.argv.includes("--write");
const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));

// A stable digest of a numeric field, rounded so that a rebuild on another
// machine cannot fail on the last bit of a float.
function digest(array, decimals = 4) {
  let h = 2166136261 >>> 0;
  const scale = 10 ** decimals;
  for (let i = 0; i < array.length; i++) {
    const v = Math.round(array[i] * scale) | 0;
    h ^= v & 0xff; h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 8) & 0xff; h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 16) & 0xff; h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
const timed = (fn) => { const t = process.hrtime.bigint(); const v = fn(); return [v, Number(process.hrtime.bigint() - t) / 1e6]; };

// --- the inputs, exactly as the app builds them -----------------------------
const level = config.terrain.levels.filter((l) => l.width <= 2048).reduce((a, b) => (b.width > a.width ? b : a));
const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
const off = config.terrain.encoding.offsetMetres;
const metres = new Int16Array(png.width * png.height);
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - off;
const [terrainField, msTerrain] = timed(() => buildTerrainField({
  elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0,
  oceanMask: loadOceanMask(config, REPO), waterSurfaceMask: loadWaterSurfaceMask(config, REPO),
}));
const sets = resolveClimateSets(config);
const params = { ...sets.sets.find((s) => s.id === sets.defaultId).values, ...CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION };
const [temperatureField, msTemp] = timed(() => buildTemperatureField({
  terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params,
}));

const mean = (a, pick) => { let n = 0, s = 0;
  for (let i = 0; i < a.length; i++) { if (pick && !pick(i)) continue; n++; s += a[i]; } return n ? s / n : NaN; };
const isSea = (i) => terrainField.isSea[i];
const isLand = (i) => !terrainField.isSea[i];

// --- the seasonal table and the sea-ice cycle -------------------------------
const seasonParams = climateV1SeasonParams(SEASON_PARAMETERS);
const [seasonTable, msSeason] = timed(() => buildSeasonalTemperatureTable({
  rows: 256, body: config.body, params: seasonParams,
}));
const rowOfLat = (lat) => Math.min(seasonTable.rows - 1, Math.floor(((90 - lat) / 180) * seasonTable.rows));
function halfAmplitude(row, surface) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 360; k++) {
    const v = sampleSeasonalAnomalyC(seasonTable, row, surface, k / 360);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return (hi - lo) / 2;
}
const [iceCycle, msIce] = timed(() => buildSeaIceCycle({ temperatureField, terrainField, seasonTable }));
const iceArea = (() => {
  const { width: W, height: H, phaseCount: P, fractionByPhase, seaFraction, thicknessByPhase } = iceCycle;
  const cells = W * H, cosW = new Float64Array(H);
  for (let y = 0; y < H; y++) cosW[y] = Math.cos((((90 - ((y + 0.5) * 180) / H)) * Math.PI) / 180);
  let total = 0; for (let y = 0; y < H; y++) total += cosW[y] * W;
  const areas = [];
  for (let k = 0; k < P; k++) { let s = 0;
    for (let c = 0; c < cells; c++) s += cosW[Math.floor(c / W)] * fractionByPhase[k * cells + c] * seaFraction[c];
    areas.push((s / total) * 100); }
  let per = 0;
  for (let c = 0; c < cells; c++) { let all = true;
    for (let k = 0; k < P; k++) if (!(thicknessByPhase[k * cells + c] > 0)) { all = false; break; }
    if (all) per += cosW[Math.floor(c / W)] * seaFraction[c]; }
  let worstResidual = 0;
  if (iceCycle.energyResidualWPerM2) {
    for (let c = 0; c < cells; c++) worstResidual = Math.max(worstResidual, Math.abs(iceCycle.energyResidualWPerM2[c]));
  }
  return { max: Math.max(...areas), min: Math.min(...areas), perennial: (per / total) * 100, worstResidual };
})();

// --- the preview, at the app's own resolution -------------------------------
const [preview, msPreview] = timed(() => buildClimateV1Preview({
  terrainField, body: config.body, params, grid: PREVIEW_GRID,
}));
const wind = preview.wind;
let windSpeedMean = 0;
for (let i = 0; i < wind.windSpeedMs.length; i++) windSpeedMean += wind.windSpeedMs[i];
windSpeedMean /= wind.windSpeedMs.length;

// --- the land-sea coupling, on, as a diagnostic -----------------------------
const couplingWind = buildClimateV1Wind({
  terrainField, temperatureField, lapseRateCPerKm: params.surfaceLapseRateCPerKm ?? params.lapseRateCPerKm,
  body: config.body, atmosphere: { specificGasConstantJPerKgK: 287, surfacePressureHPa: 1000, levelPressureHPa: 850 },
  params: { thermalResponseStrength: 1, dragTimescaleDays: 0.5, thermalSmoothingKm: 1500 },
  width: 256, height: 128,
});
const [coupled, msCoupling] = timed(() => applyLandSeaCoupling({
  temperatureField, terrainField, windField: couplingWind, body: config.body,
  params: climateV1LandSeaParams(), width: 256, height: 128,
}));

// --- V0.8, the regression guard that reads no Climate v1 field --------------
const v08 = (tool, label) => {
  const out = execFileSync("node", [path.join(REPO, "tools", tool)], { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.includes(label));
  return line ? line.trim().replace(/\s+/g, " ") : "(not found)";
};

const now = {
  "v0.8 teacherA": v08("score_climate.mjs", "総合"),
  "v0.8 teacherB": v08("score_koppen.mjs", "総合"),
  "terrain landCells": terrainField.isSea.reduce((a, v) => a + (v ? 0 : 1), 0),
  "stage2 annual digest": digest(temperatureField.annualMeanTemperatureC, 3),
  "stage2 land mean C": +mean(temperatureField.annualMeanTemperatureC, isLand).toFixed(4),
  "stage2 sea mean C": +mean(temperatureField.annualMeanTemperatureC, isSea).toFixed(4),
  "surface lapse C/km": params.surfaceLapseRateCPerKm,
  "season tau_land d": +seasonTable.timescaleDays.land.toFixed(2),
  "season tau_sea d": +seasonTable.timescaleDays.sea.toFixed(2),
  "season 45N land halfAmp C": +halfAmplitude(rowOfLat(45), SURFACE_LAND).toFixed(3),
  "season 45N sea halfAmp C": +halfAmplitude(rowOfLat(45), SURFACE_SEA).toFixed(3),
  "season coefficients digest": digest(seasonTable.coefficients, 5),
  "seaice annual max %": +iceArea.max.toFixed(3),
  "seaice annual min %": +iceArea.min.toFixed(3),
  "seaice perennial %": +iceArea.perennial.toFixed(3),
  "seaice worst energy residual W/m2": Number(iceArea.worstResidual.toExponential(2)),
  "wind mean speed m/s": +windSpeedMean.toFixed(4),
  "wind digest": digest(wind.uWindMs, 4) + "/" + digest(wind.vWindMs, 4),
  "humidity land qsat g/kg": +(mean(preview.humidityField.saturationSpecificHumidityKgPerKg) * 1000).toFixed(4),
  "moisture land q g/kg": +(mean(preview.moistureField.specificHumidityKgPerKg) * 1000).toFixed(4),
  "land-sea coupling tau d": climateV1LandSeaParams().landSeaThermalRelaxationDays,
  "land-sea coupling digest": digest(coupled.coupling.landAnomalyC, 4),
};
const timings = {
  terrain: msTerrain, "stage2 temperature": msTemp, "season table": msSeason,
  "sea ice cycle": msIce, "preview (1024x512)": msPreview, "land-sea coupling": msCoupling,
};

if (write) {
  writeFileSync(GOLDEN, JSON.stringify({
    _note: "Climate v1 stable golden reference. Regenerate with `node tools/golden_climate_v1.mjs --write` ONLY after a deliberate model change, and say in the commit what moved and why.",
    recordedAt: new Date().toISOString().slice(0, 10),
    values: now,
  }, null, 2) + "\n");
  console.log(`wrote ${path.relative(REPO, GOLDEN)}`);
}

const golden = JSON.parse(readFileSync(GOLDEN, "utf8")).values;
let failures = 0;
console.log("Climate v1 golden reference\n");
for (const [k, v] of Object.entries(now)) {
  const g = golden[k];
  const same = String(g) === String(v);
  if (!same) failures++;
  console.log(`  ${same ? "OK  " : "MOVED"}  ${k.padEnd(34)} ${String(v)}${same ? "" : `   (was ${String(g)})`}`);
}
for (const k of Object.keys(golden)) if (!(k in now)) { failures++; console.log(`  GONE  ${k}`); }
console.log("\ntimings (this machine, indicative only -- not asserted)");
for (const [k, v] of Object.entries(timings)) console.log(`  ${k.padEnd(24)} ${v.toFixed(0)} ms`);
console.log(`\n${failures === 0 ? "All golden values match." : `${failures} value(s) MOVED.`}`);
process.exit(failures === 0 ? 0 : 1);
