// Stage 5C-alpha: the identification test for the RH-dependent recycling
// HYPOTHESIS. Not a fit. No parameter is searched here, and nothing is
// compared against the humidity teacher in order to CHOOSE anything.
//
// The question is narrow and was declared before the run: can plain Stage 5B,
// with nothing changed but its single global `moistureResidenceDays`,
// reproduce what the recycling hypothesis produces? If it can, the hypothesis
// is a relabelling of tau and Stage 5C stops.
//
// Wind is the NCEP 850 hPa ORACLE, so that nothing here can be hiding a
// defect in the frozen Stage 4 wind model.
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
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import { loadNcepOracleWind } from "./ncep_oracle_wind.mjs";
import { buildMoistureField, WIND_MODES } from "../js/climate-v1/moisture.js";
import { buildRecycledMoistureField } from "../js/climate-v1/recycling.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai"), TEACHER = path.join(WORLD, "teacher");
const ATM = { seaLevelPressureHPa: 1013.25, specificGasConstantJPerKgK: 287.05, vapourGasConstantJPerKgK: 461.52 };
const G = 9.80665, W = 256, H = 128;

// ------------------------------------------------------------------ inputs --
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

// ----------------------------------------------------------------- teacher --
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

// ------------------------------------------------------- NCEP oracle wind ---
// Below-ground 850 hPa cells are harmonically filled, never treated as calm.
// See tools/ncep_oracle_wind.mjs for why, and
// docs/climate-v1-dry-tail-diagnosis-stage5b.md for what the old treatment
// cost. Every number in this file after 2026-09 uses the filled wind.
const oracle = loadNcepOracleWind({ teacherDir: TEACHER, width: W, height: H });

// ------------------------------------------------------------ eval points ---
const waterFrac = (() => {
  const bx = terrainField.width / W, by = terrainField.height / H;
  const out = new Float64Array(W * H);
  for (let y = 0; y < terrainField.height; y++) for (let x = 0; x < terrainField.width; x++)
    out[Math.floor(y / by) * W + Math.floor(x / bx)] += terrainField.isWaterSurface[y * terrainField.width + x];
  for (let i = 0; i < out.length; i++) out[i] /= bx * by;
  return out;
})();
const POINTS = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const lat = 90 - ((y + 0.5) * 180) / H, lng = -180 + ((x + 0.5) * 360) / W;
  const t = teacherQ(lat, lng);
  if (!Number.isFinite(t)) continue;
  POINTS.push({ i: y * W + x, lat, lng, teacher: t * 1000, w: Math.cos((lat * Math.PI) / 180), isLand: waterFrac[y * W + x] < 0.5 });
}
const LAND = POINTS.filter((p) => p.isLand);
const REGIONS = {
  Amazon: [-70, -55, -8, 2], Sahara: [-8, 28, 18, 28], Australia: [120, 145, -30, -18],
  India: [73, 88, 10, 28], Europe: [0, 30, 45, 58], Indonesia: [100, 130, -8, 6],
  Patagonia: [-73, -67, -52, -40], Caspian: [47, 55, 37, 47], Baikal: [103, 110, 51, 56],
};
const g = (f, i) => f.specificHumidityKgPerKg[i] * 1000;
function regionMean(field, name) {
  const [l0, l1, a0, a1] = REGIONS[name];
  let sm = 0, st = 0, sw = 0;
  for (const p of POINTS) {
    if (p.lat < a0 || p.lat > a1 || p.lng < l0 || p.lng > l1) continue;
    sm += p.w * g(field, p.i); st += p.w * p.teacher; sw += p.w;
  }
  return { model: sm / sw, teacher: st / sw };
}
const landMean = (f) => { let s = 0, w = 0; for (const p of LAND) { s += p.w * g(f, p.i); w += p.w; } return s / w; };
function landStats(a, b) { // a, b both fields -> agreement BETWEEN THEM over land
  let sw = 0, sa = 0, sb = 0;
  for (const p of LAND) { sw += p.w; sa += p.w * g(a, p.i); sb += p.w * g(b, p.i); }
  const ma = sa / sw, mb = sb / sw;
  let qa = 0, qb = 0, qab = 0, se = 0;
  for (const p of LAND) {
    const da = g(a, p.i) - ma, db = g(b, p.i) - mb;
    qa += p.w * da * da; qb += p.w * db * db; qab += p.w * da * db;
    se += p.w * (g(a, p.i) - g(b, p.i)) ** 2;
  }
  return { r: qab / Math.sqrt(qa * qb), rmse: Math.sqrt(se / sw) };
}
function vsTeacher(f) {
  let sw = 0, se = 0, sb = 0;
  for (const p of LAND) { sw += p.w; se += p.w * (g(f, p.i) - p.teacher) ** 2; sb += p.w * (g(f, p.i) - p.teacher); }
  return { rmse: Math.sqrt(se / sw), bias: sb / sw };
}
const hash = (f) => { let h = 0x811c9dc5; const b = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };

const BASE = { terrainField, temperatureField, humidityField, wind: oracle, windMode: WIND_MODES.PHYSICAL, body: config.body, maxSweeps: 4000 };
const plain = (tauDays) => buildMoistureField({ ...BASE, params: tauDays === null ? {} : { moistureResidenceDays: tauDays } });

console.log("Stage 5C-alpha -- identification test for the RH-dependent recycling hypothesis.");
console.log("phi(RH) approximates the recyclable CONDENSING share of Stage 5B's lumped removal.");
console.log("It is not precipitation, not soil moisture, not vegetation, not a reservoir.");
console.log("Wind: NCEP 850 hPa oracle (physical). No parameter is fitted in this run.\n");

// === 0. regression: f = 0 must be bit-identical to Stage 5B =================
const stage5b = plain(null);
const off = buildRecycledMoistureField({ ...BASE, recycling: { landRecyclingFraction: 0 } });
const zeroArray = buildMoistureField({ ...BASE, landSourceKgPerKgPerS: new Float64Array(W * H) });
console.log("=== 0. regression ===");
console.log(`  Stage 5B                      q hash ${hash(stage5b.specificHumidityKgPerKg)}  RH hash ${hash(stage5b.relativeHumidity)}`);
console.log(`  recycling f=0                 q hash ${hash(off.specificHumidityKgPerKg)}  RH hash ${hash(off.relativeHumidity)}`);
console.log(`  explicit all-zero land source q hash ${hash(zeroArray.specificHumidityKgPerKg)}  RH hash ${hash(zeroArray.relativeHumidity)}`);
const bitIdentical = hash(stage5b.specificHumidityKgPerKg) === hash(off.specificHumidityKgPerKg)
  && hash(stage5b.relativeHumidity) === hash(off.relativeHumidity)
  && hash(stage5b.specificHumidityKgPerKg) === hash(zeroArray.specificHumidityKgPerKg);
console.log(`  ${bitIdentical ? "PASS" : "FAIL"}  f=0 is bit-identical to Stage 5B\n`);

// === 1. the hypothesis at a few pre-set physical values =====================
// Deliberately NOT a search: three points inside the declared physical ranges.
// Six points spanning the DECLARED range of each parameter -- a structure
// probe, not a search: no objective is minimised and nothing is chosen from
// the teacher. RHcrit is swept across its whole declared 0.5-0.95 range
// because identifiability turns out to depend on it, which is itself the
// result.
const PRESETS = [
  { f: 0.3, rh: 0.8, et: 5 },
  { f: 0.5, rh: 0.8, et: 5 },
  { f: 0.5, rh: 0.7, et: 5 },
  { f: 0.5, rh: 0.6, et: 5 },
  { f: 0.5, rh: 0.5, et: 5 },
  { f: 0.8, rh: 0.5, et: 5 },
];
const tAmazon = regionMean(stage5b, "Amazon").teacher, tSahara = regionMean(stage5b, "Sahara").teacher;
console.log("=== 1. recycling runs (pre-set values, no fit) ===");
console.log(`${"case".padEnd(24)} ${"Amazon".padStart(7)} ${"Sahara".padStart(7)} ${"Austral".padStart(8)} ${"ratio".padStart(6)} ${"landMean".padStart(9)} ${"E/removal".padStart(10)} ${"outer".padStart(6)}`);
const line = (label, f, extra = "") => {
  const am = regionMean(f, "Amazon").model, sa = regionMean(f, "Sahara").model, au = regionMean(f, "Australia").model;
  console.log(`${label.padEnd(24)} ${am.toFixed(2).padStart(7)} ${sa.toFixed(2).padStart(7)} ${au.toFixed(2).padStart(8)} ${(am / sa).toFixed(2).padStart(6)} ${landMean(f).toFixed(3).padStart(9)} ${extra}`);
  return { am, sa, au, ratio: am / sa, mean: landMean(f) };
};
const baseRow = line("Stage 5B (tau=8)", stage5b, `${"--".padStart(10)} ${"--".padStart(6)}`);
const runs = [];
for (const p of PRESETS) {
  const field = buildRecycledMoistureField({ ...BASE, recycling: { landRecyclingFraction: p.f, recyclingHumidityThreshold: p.rh, evapotranspirationTimescaleDays: p.et } });
  const b = field.recycling.budget;
  const row = line(`f=${p.f} RHc=${p.rh} tEt=${p.et}`, field, `${b.sourceOverRemoval.toFixed(3).padStart(10)} ${String(field.recycling.outerPasses).padStart(6)}`);
  runs.push({ p, field, row });
  if (b.sourceOverRemoval > p.f + 1e-9) throw new Error("water created: E/removal exceeded f");
  if (!field.recycling.outerConverged) console.log(`    WARNING: outer loop not converged (residual ${field.recycling.outerResidual.toExponential(2)})`);
  let bad = 0;
  for (let i = 0; i < W * H; i++) if (!Number.isFinite(field.specificHumidityKgPerKg[i])) bad++;
  if (bad) throw new Error(`${bad} non-finite cells`);
}
console.log(`${"TEACHER".padEnd(24)} ${tAmazon.toFixed(2).padStart(7)} ${tSahara.toFixed(2).padStart(7)} ${regionMean(stage5b, "Australia").teacher.toFixed(2).padStart(8)} ${(tAmazon / tSahara).toFixed(2).padStart(6)}\n`);

// === 1b. WHY the threshold decides everything ==============================
// The hypothesis can only act where the model's own air is near saturation.
// How much land is that? A property of Stage 5B's field, not of the
// hypothesis, and measured rather than assumed.
{
  const qs = stage5b.saturationSpecificHumidityKgPerKg;
  const vals = [];
  for (const p of LAND) if (qs[p.i] > 0) vals.push(stage5b.specificHumidityKgPerKg[p.i] / qs[p.i]);
  vals.sort((a, b) => a - b);
  const pct = (q) => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))].toFixed(3);
  console.log("=== 1b. the model's own land relative humidity ===");
  console.log("  percentiles: " + [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99].map((q) => `p${q * 100}=${pct(q)}`).join("  "));
  const parts = [];
  for (const t of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    let s2 = 0, w2 = 0;
    for (const p of LAND) { w2 += p.w; if (qs[p.i] > 0 && stage5b.specificHumidityKgPerKg[p.i] / qs[p.i] > t) s2 += p.w; }
    parts.push(`>${t}: ${((100 * s2) / w2).toFixed(1)}%`);
  }
  console.log("  land area above a threshold -- " + parts.join("   "));
  console.log("");
}

// === 2. the test: can tau alone reproduce it? ==============================
// For each recycling run, scan tau' in plain Stage 5B for the value whose
// GLOBAL LAND MEAN matches, then ask whether the region pattern also matches.
console.log("=== 2. best matching tau' (global land mean matched, then pattern compared) ===");
const TAUS = [];
for (let t = 8; t <= 40; t += 0.5) TAUS.push(t);
const tauFields = new Map();
for (const t of TAUS) tauFields.set(t, plain(t));
console.log(`${"case".padEnd(24)} ${"tau'".padStart(6)} ${"dMean".padStart(7)} ${"Amazon".padStart(14)} ${"Sahara".padStart(13)} ${"ratio".padStart(13)} ${"r(a,b)".padStart(8)} ${"RMSE".padStart(7)}`);
const verdicts = [];
for (const { p, field, row } of runs) {
  let best = null;
  for (const t of TAUS) {
    const d = Math.abs(landMean(tauFields.get(t)) - row.mean);
    if (best === null || d < best.d) best = { t, d, f: tauFields.get(t) };
  }
  const am = regionMean(best.f, "Amazon").model, sa = regionMean(best.f, "Sahara").model;
  const st = landStats(field, best.f);
  const label = `f=${p.f} RHc=${p.rh} tEt=${p.et}`;
  console.log(`${label.padEnd(24)} ${best.t.toFixed(1).padStart(6)} ${best.d.toFixed(3).padStart(7)} ${`${row.am.toFixed(2)} vs ${am.toFixed(2)}`.padStart(14)} ${`${row.sa.toFixed(2)} vs ${sa.toFixed(2)}`.padStart(13)} ${`${row.ratio.toFixed(2)} vs ${(am / sa).toFixed(2)}`.padStart(13)} ${st.r.toFixed(4).padStart(8)} ${st.rmse.toFixed(3).padStart(7)}`);
  verdicts.push({ label, dRatio: Math.abs(row.ratio - am / sa), r: st.r, rmse: st.rmse, meanMatched: best.d, identifiable: false });
}

// === 3. verdict, by rules declared before the run ===========================
// Identifiable only if, at the tau' that matches the global land mean, the
// recycling field still differs from it in PATTERN.
const RULES = { ratio: 0.20, rmse: 0.30, r: 0.999, meanMatch: 0.05 };
console.log("\n=== 3. verdict (rules declared before the run) ===");
console.log(`  a tau' exists matching the land mean to <= ${RULES.meanMatch} g/kg`);
console.log(`  identifiable if THAT tau' still differs by: |dRatio| >= ${RULES.ratio}  AND  land RMSE >= ${RULES.rmse} g/kg  AND  r < ${RULES.r}`);
let anyIdentifiable = false;
for (const v of verdicts) {
  const matched = v.meanMatched <= RULES.meanMatch;
  const ok = matched && v.dRatio >= RULES.ratio && v.rmse >= RULES.rmse && v.r < RULES.r;
  v.identifiable = ok;
  if (ok) anyIdentifiable = true;
  console.log(`  ${ok ? "IDENTIFIABLE  " : "not identified"}  ${v.label}  dRatio=${v.dRatio.toFixed(3)} RMSE=${v.rmse.toFixed(3)} r=${v.r.toFixed(4)}${matched ? "" : "  (no tau' matched the mean)"}`);
}

// === 4. all regions, for the record (never used to choose anything) =========
console.log("\n=== 4. regions, recycling vs Stage 5B vs teacher (record only, nothing chosen from this) ===");
const shown = runs[runs.length - 2];
console.log(`${"region".padEnd(12)} ${"Stage 5B".padStart(9)} ${shown ? `f=${shown.p.f}`.padStart(9) : ""} ${"teacher".padStart(9)}`);
for (const name of Object.keys(REGIONS)) {
  const b = regionMean(stage5b, name), r = regionMean(shown.field, name);
  console.log(`${name.padEnd(12)} ${b.model.toFixed(2).padStart(9)} ${r.model.toFixed(2).padStart(9)} ${b.teacher.toFixed(2).padStart(9)}`);
}
const vb = vsTeacher(stage5b), vr = vsTeacher(shown.field);
console.log(`${"LAND all".padEnd(12)} ${`${vb.rmse.toFixed(2)}/${vb.bias >= 0 ? "+" : ""}${vb.bias.toFixed(2)}`.padStart(9)} ${`${vr.rmse.toFixed(2)}/${vr.bias >= 0 ? "+" : ""}${vr.bias.toFixed(2)}`.padStart(9)}   (RMSE/bias vs teacher)`);

const identifiedAt = verdicts.filter((v) => v.identifiable).map((v) => v.label);
console.log(`\n${anyIdentifiable && bitIdentical ? "READY" : "NOT_READY"} -- ${anyIdentifiable
  ? `distinguishable from a tau change, but only at ${identifiedAt.length} of ${verdicts.length} probed points: ${identifiedAt.join("; ")}`
  : "indistinguishable from a tau change; Stage 5C stops"}`);
