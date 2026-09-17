// Stage 2 temperature bias, re-measured against the MAIN teacher.
//
// Read-only. temperature.js, climate.js, evaporative-cooling.js and every
// Climate v1 parameter are unchanged, and nothing is fitted.
//
// Main teacher      A = Berkeley Earth Land+Ocean (observational over land)
// Independent check B = NCEP/NCAR R1 air.2m (a reanalysis, i.e. a model)
//
// The earlier Stage 2 diagnosis used B. Its numbers are kept and printed
// beside A's as the independent check, never as the baseline. See
// docs/climate-v1-temperature-teacher-audit.md for why A is the main one.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { loadNcepOracleWind } from "./ncep_oracle_wind.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import { buildClimateV1Preview, PREVIEW_GRID } from "../js/climate-v1/preview.js";
import { EVAPORATIVE_COOLING_PREVIEW_C } from "../js/climate-v1/evaporative-cooling.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai"), TD = path.join(WORLD, "teacher");
const W = PREVIEW_GRID.width, H = PREVIEW_GRID.height;

const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));
const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
const off = config.terrain.encoding.offsetMetres;
const metres = new Int16Array(png.width * png.height);
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - off;
const sets = resolveClimateSets(config);
const params = { ...sets.sets.find((s) => s.id === sets.defaultId).values, ...CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION };
const terrainField = buildTerrainField({
  elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0,
  oceanMask: loadOceanMask(config, REPO), waterSurfaceMask: loadWaterSurfaceMask(config, REPO),
});

// --- the model, off and on, on the observed wind -----------------------------
// The cooling is driven by the model's own moisture, and with the frozen
// Stage 4 wind the model puts 0.0 g/kg over the Amazon, so the cooling has
// nothing to act on there. The observed wind is the condition in which the
// hypothesis can be judged at all; the model-wind case is printed too.
const oracleWind = loadNcepOracleWind({ teacherDir: TD, width: W, height: H, quiet: true });
const run = (cooling, wind) => buildClimateV1Preview({
  terrainField, body: config.body, params, oracleWind: wind,
  evaporativeCooling: cooling ? { evaporativeCoolingC: EVAPORATIVE_COOLING_PREVIEW_C } : {},
});
const offObs = run(false, oracleWind), onObs = run(true, oracleWind);
const offMdl = run(false, null), onMdl = run(true, null);

// --- teachers ---------------------------------------------------------------
const tSum = JSON.parse(readFileSync(path.join(TD, "temperature-summary.json"), "utf8"));
const hSum = JSON.parse(readFileSync(path.join(TD, "humidity-summary.json"), "utf8"));
const aGrid = tSum.grid;
const aRaw = new Float32Array((() => { const b = readFileSync(path.join(TD, aGrid.valuesFile)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); })());
const aLats = Array.from({ length: aGrid.height }, (_, j) => 90 - (j + 0.5) * (180 / aGrid.height));
const aLons = Array.from({ length: aGrid.width }, (_, i) => -180 + (i + 0.5) * (360 / aGrid.width));
const bSpec = hSum.grids.airTemperatureC;
const bRaw = parseTeacherGrid(readFileSync(path.join(TD, bSpec.file)), bSpec).values;
const qSpec = hSum.grids.specificHumidityKgPerKg;
const qRaw = parseTeacherGrid(readFileSync(path.join(TD, qSpec.file)), qSpec).values;
const gLats = bSpec.latitudes, gLons = bSpec.longitudes.map((l) => (l > 180 ? l - 360 : l));
const nearest = (axis, v, wrap) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < axis.length; i++) { let d = Math.abs(axis[i] - v); if (wrap) d = Math.min(d, 360 - d); if (d < bd) { bd = d; best = i; } }
  return best;
};

// Teacher A's own land-cover classes, as a surface-wetness proxy that owes
// nothing to either temperature product: 2 = vegetation, 3 = arid.
const teacherClassPng = readPng(path.join(TD, "present-classes.png"));

// --- everything on one grid --------------------------------------------------
const coarsen = (fine, fw, fh) => {
  const bx = fw / W, by = fh / H, out = new Float64Array(W * H);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) out[Math.floor(y / by) * W + Math.floor(x / bx)] += fine[y * fw + x];
  for (let i = 0; i < out.length; i++) out[i] /= bx * by;
  return out;
};
const tf = offObs.temperatureField;
const mZ = coarsen(terrainField.relativeSurfaceElevationMetres || terrainField.relativeElevationMetres, terrainField.width, terrainField.height);
const water = coarsen(Float32Array.from(terrainField.isWaterSurface), terrainField.width, terrainField.height);
const coarseT = (field) => coarsen(field.temperatureField.annualMeanTemperatureC, field.temperatureField.width, field.temperatureField.height);
const mOffObs = coarseT(offObs), mOnObs = coarseT(onObs), mOffMdl = coarseT(offMdl), mOnMdl = coarseT(onMdl);

// distance to open water, in coarse cells
const dist = new Int32Array(W * H).fill(-1);
{
  const q = [];
  for (let i = 0; i < W * H; i++) if (water[i] >= 0.5) { dist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], y = (i / W) | 0, x = i % W;
    const nb = [y * W + ((x + 1) % W), y * W + ((x + W - 1) % W)];
    if (y > 0) nb.push(i - W);
    if (y < H - 1) nb.push(i + W);
    for (const j of nb) if (dist[j] < 0) { dist[j] = dist[i] + 1; q.push(j); }
  }
}

const P = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, lat = 90 - ((y + 0.5) * 180) / H, lng = -180 + ((x + 0.5) * 360) / W;
  const cx = Math.min(teacherClassPng.width - 1, Math.floor(((lng + 180) / 360) * teacherClassPng.width));
  const cy = Math.min(teacherClassPng.height - 1, Math.floor(((90 - lat) / 180) * teacherClassPng.height));
  P.push({
    i, lat, lng, w: Math.cos((lat * Math.PI) / 180), isLand: water[i] < 0.5, z: mZ[i], d: dist[i],
    a: aRaw[nearest(aLats, lat) * aGrid.width + nearest(aLons, lng, true)],
    b: bRaw[nearest(gLats, lat) * bSpec.width + nearest(gLons, lng, true)],
    qT: qRaw[nearest(gLats, lat) * qSpec.width + nearest(gLons, lng, true)] * 1000,
    qM: offObs.moistureField.specificHumidityKgPerKg[i] * 1000,
    qMdl: offMdl.moistureField.specificHumidityKgPerKg[i] * 1000,
    cls: teacherClassPng.data[cy * teacherClassPng.width + cx],
    mOff: mOffObs[i], mOn: mOnObs[i], mOffMdl: mOffMdl[i], mOnMdl: mOnMdl[i],
  });
}
const LAND = P.filter((p) => p.isLand && Number.isFinite(p.a));
const wm = (rows, f) => { let s = 0, w = 0; for (const p of rows) { const v = f(p); if (!Number.isFinite(v)) continue; s += p.w * v; w += p.w; } return w > 0 ? s / w : NaN; };
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "  --");
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "  --");

console.log("Stage 2 temperature bias against the MAIN teacher (Berkeley Earth).");
console.log("Read-only: temperature.js, climate.js, evaporative-cooling.js and every parameter unchanged.");
console.log("NCEP 2 m is printed beside it as the independent check, never as the baseline.\n");

console.log("=== 1. baseline: model minus teacher, by band ===");
console.log(`${"band".padEnd(20)} ${"model".padStart(7)} ${"A Berk".padStart(7)} ${"bias A".padStart(7)} ${"B NCEP".padStart(7)} ${"bias B".padStart(7)} ${"area%".padStart(6)}`);
const BANDS = [
  ["全球", () => true], ["全球陸", (p) => p.isLand], ["全球海", (p) => !p.isLand],
  ["熱帯陸 |lat|<23.5", (p) => p.isLand && Math.abs(p.lat) < 23.5],
  ["中緯度陸 23.5-60", (p) => p.isLand && Math.abs(p.lat) >= 23.5 && Math.abs(p.lat) < 60],
  ["高緯度陸 >=60", (p) => p.isLand && Math.abs(p.lat) >= 60],
];
let totalW = 0; for (const p of P) if (Number.isFinite(p.a)) totalW += p.w;
for (const [label, sel] of BANDS) {
  const rows = P.filter((p) => Number.isFinite(p.a) && sel(p));
  let w = 0; for (const p of rows) w += p.w;
  console.log(`${label.padEnd(18)} ${f1(wm(rows, (p) => p.mOff)).padStart(8)} ${f1(wm(rows, (p) => p.a)).padStart(7)} ${f1(wm(rows, (p) => p.mOff - p.a)).padStart(7)} ${f1(wm(rows, (p) => p.b)).padStart(7)} ${f1(wm(rows, (p) => p.mOff - p.b)).padStart(7)} ${((100 * w) / totalW).toFixed(1).padStart(6)}`);
}

console.log("\n=== 2. by region (land only) ===");
const REGIONS = { アマゾン: [-70, -55, -8, 2], コンゴ: [15, 28, -5, 5], インドネシア: [100, 130, -8, 6],
  サハラ: [-8, 28, 18, 28], オーストラリア: [120, 145, -30, -18], インド: [73, 88, 10, 28],
  ヨーロッパ: [0, 30, 45, 58], チベット: [80, 100, 28, 38], グリーンランド: [-50, -25, 62, 82],
  南極: [-180, 180, -90, -70], シベリア: [90, 140, 55, 70], 北米内陸: [-110, -95, 40, 55] };
const inR = (p, box) => p.lat >= box[2] && p.lat <= box[3] && p.lng >= box[0] && p.lng <= box[1];
console.log(`${"region".padEnd(14)} ${"model".padStart(7)} ${"A Berk".padStart(7)} ${"bias A".padStart(7)} ${"bias B".padStart(7)} ${"z (m)".padStart(7)} ${"teach q".padStart(8)}`);
for (const [name, box] of Object.entries(REGIONS)) {
  const rows = LAND.filter((p) => inR(p, box));
  if (!rows.length) continue;
  console.log(`${name.padEnd(12)} ${f1(wm(rows, (p) => p.mOff)).padStart(8)} ${f1(wm(rows, (p) => p.a)).padStart(7)} ${f1(wm(rows, (p) => p.mOff - p.a)).padStart(7)} ${f1(wm(rows, (p) => p.mOff - p.b)).padStart(7)} ${wm(rows, (p) => p.z).toFixed(0).padStart(7)} ${f1(wm(rows, (p) => p.qT)).padStart(8)}`);
}

console.log("\n=== 3. what the bias tracks (land, bias against A) ===");
let lw = 0; for (const p of LAND) lw += p.w;
const binTable = (label, key, bins, extra) => {
  console.log(`  by ${label}:`);
  for (const [a, b] of bins) {
    const rows = LAND.filter((p) => key(p) >= a && key(p) < b);
    if (rows.length < 10) continue;
    let w = 0; for (const p of rows) w += p.w;
    console.log(`    ${`${a}-${b}`.padEnd(12)} bias ${f2(wm(rows, (p) => p.mOff - p.a)).padStart(6)}   area ${((100 * w) / lw).toFixed(1).padStart(5)}%${extra ? "   " + extra(rows) : ""}`);
  }
};
binTable("latitude |lat|", (p) => Math.abs(p.lat), [[0, 15], [15, 30], [30, 45], [45, 60], [60, 75], [75, 90]]);
binTable("elevation (m)", (p) => p.z, [[-500, 200], [200, 600], [600, 1200], [1200, 2500], [2500, 9000]]);
binTable("cells to open water", (p) => p.d, [[0, 3], [3, 6], [6, 11], [11, 21], [21, 99]]);
binTable("MODEL q (g/kg)", (p) => p.qM, [[0, 2], [2, 5], [5, 8], [8, 12], [12, 16], [16, 30]]);
binTable("TEACHER q (g/kg)", (p) => p.qT, [[0, 2], [2, 5], [5, 8], [8, 12], [12, 16], [16, 30]]);
{
  console.log("  by land/sea: sea bias " + f2(wm(P.filter((p) => !p.isLand && Number.isFinite(p.a)), (p) => p.mOff - p.a)) +
    "   land bias " + f2(wm(LAND, (p) => p.mOff - p.a)));
  console.log("  by the TEACHER's own land cover (a wetness proxy owing nothing to either temperature product):");
  for (const [name, code] of [["植生", 2], ["乾燥地", 3], ["雪氷", 4]]) {
    const rows = LAND.filter((p) => p.cls === code);
    if (rows.length < 10) continue;
    let w = 0; for (const p of rows) w += p.w;
    console.log(`    ${name.padEnd(8)} bias ${f2(wm(rows, (p) => p.mOff - p.a)).padStart(6)}   area ${((100 * w) / lw).toFixed(1).padStart(5)}%   teacher q ${f1(wm(rows, (p) => p.qT))}`);
  }
}

console.log("\n=== 4. the key question: does the moisture association survive on A? ===");
console.log("  tropical land only (|lat| < 23.5), so latitude is nearly held fixed:");
console.log(`${"    teacher q".padEnd(16)} ${"bias A".padStart(7)} ${"bias B".padStart(7)} ${"A-B".padStart(6)} ${"area%".padStart(7)} ${"mean z".padStart(7)}`);
const TROP = LAND.filter((p) => Math.abs(p.lat) < 23.5);
let tw = 0; for (const p of TROP) tw += p.w;
for (const [a, b] of [[0, 2], [2, 5], [5, 8], [8, 12], [12, 16], [16, 30]]) {
  const rows = TROP.filter((p) => p.qT >= a && p.qT < b);
  if (rows.length < 10) continue;
  let w = 0; for (const p of rows) w += p.w;
  console.log(`    ${`${a}-${b}`.padEnd(12)} ${f2(wm(rows, (p) => p.mOff - p.a)).padStart(7)} ${f2(wm(rows, (p) => p.mOff - p.b)).padStart(7)} ${f2(wm(rows, (p) => p.a - p.b)).padStart(6)} ${((100 * w) / tw).toFixed(1).padStart(6)}% ${wm(rows, (p) => p.z).toFixed(0).padStart(7)}`);
}

console.log("\n=== 5. evaporative cooling OFF -> ON, scored against A ===");
console.log("  (unchanged code, unchanged parameters -- only the teacher it is judged by)");
console.log(`${"region".padEnd(14)} ${"OFF".padStart(6)} ${"ON".padStart(6)} ${"dT".padStart(6)} ${"A".padStart(6)} ${"bias OFF".padStart(9)} ${"bias ON".padStart(8)} ${"|bias|".padStart(8)}`);
const PREVIEW_REGIONS = ["アマゾン", "コンゴ", "インドネシア", "サハラ", "オーストラリア", "インド"];
for (const name of PREVIEW_REGIONS) {
  const rows = LAND.filter((p) => inR(p, REGIONS[name]));
  const A = wm(rows, (p) => p.a), o = wm(rows, (p) => p.mOff), n = wm(rows, (p) => p.mOn);
  const better = Math.abs(n - A) < Math.abs(o - A) ? "改善" : "悪化";
  console.log(`${name.padEnd(12)} ${f1(o).padStart(7)} ${f1(n).padStart(6)} ${f1(n - o).padStart(6)} ${f1(A).padStart(6)} ${f1(o - A).padStart(9)} ${f1(n - A).padStart(8)} ${better.padStart(6)}`);
}
{
  const o = wm(LAND, (p) => p.mOff - p.a), n = wm(LAND, (p) => p.mOn - p.a);
  let so = 0, sn = 0, w = 0;
  for (const p of LAND) { so += p.w * Math.abs(p.mOff - p.a); sn += p.w * Math.abs(p.mOn - p.a); w += p.w; }
  console.log(`${"全球陸".padEnd(12)} ${"".padStart(7)} ${"".padStart(6)} ${"".padStart(6)} ${"".padStart(6)} ${f1(o).padStart(9)} ${f1(n).padStart(8)}`);
  console.log(`  global land mean |bias| against A: OFF ${(so / w).toFixed(2)} -> ON ${(sn / w).toFixed(2)} C`);
}
console.log("\n  with the model's OWN (frozen Stage 4) wind, for comparison:");
console.log(`${"  region".padEnd(14)} ${"OFF".padStart(6)} ${"ON".padStart(6)} ${"dT".padStart(6)} ${"bias ON".padStart(8)} ${"model q".padStart(8)}`);
for (const name of PREVIEW_REGIONS) {
  const rows = LAND.filter((p) => inR(p, REGIONS[name]));
  const A = wm(rows, (p) => p.a);
  console.log(`  ${name.padEnd(12)} ${f1(wm(rows, (p) => p.mOffMdl)).padStart(6)} ${f1(wm(rows, (p) => p.mOnMdl)).padStart(6)} ${f1(wm(rows, (p) => p.mOnMdl - p.mOffMdl)).padStart(6)} ${f1(wm(rows, (p) => p.mOnMdl) - A).padStart(8)} ${f1(wm(rows, (p) => p.qMdl)).padStart(8)}`);
}
