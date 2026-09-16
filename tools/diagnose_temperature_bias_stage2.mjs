// Stage 2 diagnosis: which term makes the model's wet tropics too warm?
//
// Diagnosis only. temperature.js and climate.js are NOT modified and nothing
// is fitted. The teacher is NCEP's 2 m air temperature, compared on the
// transport grid by coordinate.
//
// The model's land temperature is, in full (js/climate.js
// surfaceAnnualTemperatureC):
//     land: T = seaLevelC(lat) - lapseRateCPerKm * z/1000
//     sea:  T = meanC + oceanModeration * (seaLevelC(lat) - meanC)
// so over land there is NO ocean moderation, NO continentality, and NO
// surface energy balance of any kind. Every land term is in that one line,
// which is what makes this decomposition exhaustive rather than a survey.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets, temperatureProfile } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai"), TEACHER = path.join(WORLD, "teacher");
const W = 256, H = 128;

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
const profile = temperatureProfile(config.body.axialTiltDegrees, params);

const hsum = JSON.parse(readFileSync(path.join(TEACHER, "humidity-summary.json"), "utf8"));
const TG = {};
for (const [n, s] of Object.entries(hsum.grids)) TG[n] = { ...parseTeacherGrid(readFileSync(path.join(TEACHER, s.file)), s), latitudes: s.latitudes, longitudes: s.longitudes };
const nearestIn = (axis, v, wrap) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < axis.length; i++) { let d = Math.abs(axis[i] - v); if (wrap) d = Math.min(d, 360 - d); if (d < bd) { bd = d; best = i; } }
  return best;
};
const sampleT = (name, lat, lng) => {
  const g = TG[name];
  return g.values[nearestIn(g.latitudes, lat) * g.width + nearestIn(g.longitudes.map((l) => (l > 180 ? l - 360 : l)), lng, true)];
};

const coarsen = (fine, fw, fh) => {
  const bx = fw / W, by = fh / H, out = new Float64Array(W * H);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) out[Math.floor(y / by) * W + Math.floor(x / bx)] += fine[y * fw + x];
  for (let i = 0; i < out.length; i++) out[i] /= bx * by;
  return out;
};
const fw = terrainField.width, fh = terrainField.height;
const mT = coarsen(temperatureField.annualMeanTemperatureC, temperatureField.width, temperatureField.height);
const mZ = coarsen(terrainField.relativeSurfaceElevationMetres || terrainField.relativeElevationMetres, fw, fh);
const waterFrac = coarsen(Float32Array.from(terrainField.isWaterSurface), fw, fh);
const latOf = (y) => 90 - ((y + 0.5) * 180) / H;
const lngOf = (x) => -180 + ((x + 0.5) * 360) / W;
const seaLevelCAt = (y) => profile.seaLevelC[Math.min(profile.profileRows - 1, Math.floor((y / H) * profile.profileRows))];

// distance to open water, in coarse cells (for the maritime-moderation test)
const dist = new Int32Array(W * H).fill(-1);
{
  const q = [];
  for (let i = 0; i < W * H; i++) if (waterFrac[i] >= 0.5) { dist[i] = 0; q.push(i); }
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
  const i = y * W + x, lat = latOf(y), lng = lngOf(x);
  const tT = sampleT("airTemperatureC", lat, lng), qT = sampleT("specificHumidityKgPerKg", lat, lng);
  if (!Number.isFinite(tT)) continue;
  P.push({ i, lat, lng, w: Math.cos((lat * Math.PI) / 180), isLand: waterFrac[i] < 0.5,
    tM: mT[i], tT, qT: qT * 1000, z: mZ[i], sl: seaLevelCAt(y), d: dist[i] });
}
const LAND = P.filter((p) => p.isLand), SEA = P.filter((p) => !p.isLand);
const wm = (rows, f) => { let s = 0, w = 0; for (const p of rows) { const v = f(p); if (!Number.isFinite(v)) continue; s += p.w * v; w += p.w; } return w > 0 ? s / w : NaN; };

console.log("Stage 2 temperature-bias diagnosis. temperature.js unchanged, nothing fitted.");
console.log("Model land T = seaLevelC(lat) - lapse*z/1000; model sea T = mean + oceanModeration*(seaLevelC - mean).");
console.log(`params: meanTemperatureC=${params.meanTemperatureC}  insolationSensitivityC=${params.insolationSensitivityC}  oceanModeration=${params.oceanModeration}  lapseRateCPerKm=${params.lapseRateCPerKm}\n`);

console.log("=== 1. the zonal profile itself: model sea-level curve vs the teacher's own zonal means ===");
console.log(`${"band".padEnd(10)} ${"seaLevelC".padStart(10)} ${"teach sea".padStart(10)} ${"teach land".padStart(11)} ${"model sea".padStart(10)} ${"model land".padStart(11)} ${"sea bias".padStart(9)} ${"land bias".padStart(10)}`);
for (let b = 8; b >= -9; b--) {
  const sel = (p) => Math.floor(p.lat / 10) === b;
  const ls = P.filter(sel), lsL = ls.filter((p) => p.isLand), lsS = ls.filter((p) => !p.isLand);
  if (ls.length === 0) continue;
  const f = (v) => (Number.isFinite(v) ? v.toFixed(1) : "  --");
  console.log(`${`${b * 10}..${b * 10 + 10}`.padEnd(10)} ${f(wm(ls, (p) => p.sl)).padStart(10)} ${f(wm(lsS, (p) => p.tT)).padStart(10)} ${f(wm(lsL, (p) => p.tT)).padStart(11)} ` +
    `${f(wm(lsS, (p) => p.tM)).padStart(10)} ${f(wm(lsL, (p) => p.tM)).padStart(11)} ${f(wm(lsS, (p) => p.tM - p.tT)).padStart(9)} ${f(wm(lsL, (p) => p.tM - p.tT)).padStart(10)}`);
}
console.log(`  global: sea bias ${wm(SEA, (p) => p.tM - p.tT).toFixed(2)}  land bias ${wm(LAND, (p) => p.tM - p.tT).toFixed(2)}  all ${wm(P, (p) => p.tM - p.tT).toFixed(2)}`);

console.log("\n=== 2. per region: the model's land temperature, term by term ===");
console.log("  (model T = seaLevelC - lapse*z/1000; there are no other land terms)");
const REGIONS = { Amazon: [-70, -55, -8, 2], Indonesia: [100, 130, -8, 6], Congo: [15, 28, -5, 5],
  Sahara: [-8, 28, 18, 28], Australia: [120, 145, -30, -18], India: [73, 88, 10, 28],
  Europe: [0, 30, 45, 58], Patagonia: [-73, -67, -52, -40], Baikal: [103, 110, 51, 56], Caspian: [47, 55, 37, 47] };
console.log(`${"region".padEnd(11)} ${"seaLevelC".padStart(10)} ${"-lapse*z".padStart(9)} ${"model T".padStart(8)} ${"teach T".padStart(8)} ${"bias".padStart(7)} ${"z (m)".padStart(7)} ${"teach q".padStart(8)} ${"cells to sea".padStart(13)}`);
for (const [name, [l0, l1, a0, a1]] of Object.entries(REGIONS)) {
  const rows = LAND.filter((p) => p.lat >= a0 && p.lat <= a1 && p.lng >= l0 && p.lng <= l1);
  if (!rows.length) continue;
  const sl = wm(rows, (p) => p.sl), lz = wm(rows, (p) => -params.lapseRateCPerKm * (p.z / 1000));
  console.log(`${name.padEnd(11)} ${sl.toFixed(1).padStart(10)} ${lz.toFixed(1).padStart(9)} ${wm(rows, (p) => p.tM).toFixed(1).padStart(8)} ${wm(rows, (p) => p.tT).toFixed(1).padStart(8)} ` +
    `${wm(rows, (p) => p.tM - p.tT).toFixed(1).padStart(7)} ${wm(rows, (p) => p.z).toFixed(0).padStart(7)} ${wm(rows, (p) => p.qT).toFixed(1).padStart(8)} ${wm(rows, (p) => p.d).toFixed(1).padStart(13)}`);
}

console.log("\n=== 3. is the land bias explained by how WET the place is? (teacher's own q, independent) ===");
console.log("  the hypothesis: real wet land is cooled by evaporation, and this model has no such term");
console.log(`${"teacher q (g/kg)".padEnd(18)} ${"land bias".padStart(10)} ${"n area%".padStart(9)} ${"mean lat".padStart(9)} ${"mean z".padStart(8)}`);
const QB = [[0, 2], [2, 5], [5, 8], [8, 12], [12, 16], [16, 30]];
let lw = 0; for (const p of LAND) lw += p.w;
for (const [a, b] of QB) {
  const rows = LAND.filter((p) => p.qT >= a && p.qT < b);
  if (!rows.length) continue;
  let w = 0; for (const p of rows) w += p.w;
  console.log(`${`${a}-${b}`.padEnd(18)} ${wm(rows, (p) => p.tM - p.tT).toFixed(2).padStart(10)} ${((100 * w) / lw).toFixed(1).padStart(8)}% ${wm(rows, (p) => Math.abs(p.lat)).toFixed(1).padStart(9)} ${wm(rows, (p) => p.z).toFixed(0).padStart(8)}`);
}
// the same, holding latitude roughly fixed, so "wet" is not just "tropical"
console.log("  within the tropics only (|lat| < 23.5), so this is not just a latitude effect:");
const TROP = LAND.filter((p) => Math.abs(p.lat) < 23.5);
for (const [a, b] of QB) {
  const rows = TROP.filter((p) => p.qT >= a && p.qT < b);
  if (rows.length < 20) continue;
  console.log(`    q ${`${a}-${b}`.padEnd(8)} bias ${wm(rows, (p) => p.tM - p.tT).toFixed(2).padStart(6)}  mean z ${wm(rows, (p) => p.z).toFixed(0).padStart(5)} m`);
}

console.log("\n=== 4. is it continentality? (distance to open water, land only) ===");
console.log(`${"cells to sea".padEnd(14)} ${"land bias".padStart(10)} ${"area%".padStart(7)} ${"mean lat".padStart(9)}`);
for (const [a, b] of [[0, 2], [3, 5], [6, 10], [11, 20], [21, 99]]) {
  const rows = LAND.filter((p) => p.d >= a && p.d <= b);
  if (!rows.length) continue;
  let w = 0; for (const p of rows) w += p.w;
  console.log(`${`${a}-${b}`.padEnd(14)} ${wm(rows, (p) => p.tM - p.tT).toFixed(2).padStart(10)} ${((100 * w) / lw).toFixed(1).padStart(6)}% ${wm(rows, (p) => Math.abs(p.lat)).toFixed(1).padStart(9)}`);
}

console.log("\n=== 5. is it the lapse rate / elevation? (land only) ===");
console.log(`${"elevation (m)".padEnd(14)} ${"land bias".padStart(10)} ${"area%".padStart(7)}`);
for (const [a, b] of [[-500, 100], [100, 300], [300, 700], [700, 1500], [1500, 3000], [3000, 9000]]) {
  const rows = LAND.filter((p) => p.z >= a && p.z < b);
  if (!rows.length) continue;
  let w = 0; for (const p of rows) w += p.w;
  console.log(`${`${a}-${b}`.padEnd(14)} ${wm(rows, (p) => p.tM - p.tT).toFixed(2).padStart(10)} ${((100 * w) / lw).toFixed(1).padStart(6)}%`);
}

console.log("\n=== 6. how much of the Amazon's bias could any ZONAL change reach? ===");
{
  const amazon = LAND.filter((p) => p.lat >= -8 && p.lat <= 2 && p.lng >= -70 && p.lng <= -55);
  const sameBand = LAND.filter((p) => p.lat >= -8 && p.lat <= 2);
  const sameBandSea = SEA.filter((p) => p.lat >= -8 && p.lat <= 2);
  const bAm = wm(amazon, (p) => p.tM - p.tT), bBand = wm(sameBand, (p) => p.tM - p.tT), bSea = wm(sameBandSea, (p) => p.tM - p.tT);
  console.log(`  8S-2N land bias overall ${bBand.toFixed(2)} C; the Amazon box alone ${bAm.toFixed(2)} C; the SEA in the same band ${bSea.toFixed(2)} C`);
  console.log(`  -> a zonal (latitude-only) correction can remove at most ${bBand.toFixed(2)} C of the Amazon's ${bAm.toFixed(2)} C;`);
  console.log(`     the remaining ${(bAm - bBand).toFixed(2)} C is longitudinal and no change to the profile can reach it.`);
  const other = sameBand.filter((p) => !(p.lng >= -70 && p.lng <= -55));
  console.log(`  same band, land OUTSIDE the Amazon box: bias ${wm(other, (p) => p.tM - p.tT).toFixed(2)} C, teacher q ${wm(other, (p) => p.qT).toFixed(1)} g/kg vs the Amazon's ${wm(amazon, (p) => p.qT).toFixed(1)}`);
}
