// Audit: this repo has TWO annual-mean surface temperature fields and they
// disagree. Which is Climate v1's temperature teacher, and why do they differ?
//
// Read-only. Nothing is fitted, no teacher file is written, and no model is
// changed.
//
//   A  worlds/<w>/teacher/temperature-annual-mean-c.bin
//      Berkeley Earth Land+Ocean, 1x1 degree, 1991-2020 absolute climatology.
//      Built by tools/build_temperature_teacher.py. What the app's 気温教師
//      button draws.
//   B  worlds/<w>/teacher/humidity-airTemperatureC.bin
//      NCEP/NCAR Reanalysis 1 air.2m long-term mean, T62 Gaussian 192x94,
//      1981-2010. Shipped as an input to the humidity teacher, and what the
//      Stage 2 bias diagnosis compared the model against.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai"), TD = path.join(WORLD, "teacher");
const W = 256, H = 128;

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
const temperatureField = buildTemperatureField({ terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params });

const tSum = JSON.parse(readFileSync(path.join(TD, "temperature-summary.json"), "utf8"));
const hSum = JSON.parse(readFileSync(path.join(TD, "humidity-summary.json"), "utf8"));
const aGrid = tSum.grid;
const aRaw = new Float32Array((() => { const b = readFileSync(path.join(TD, aGrid.valuesFile)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); })());
const aLats = Array.from({ length: aGrid.height }, (_, j) => 90 - (j + 0.5) * (180 / aGrid.height));
const aLons = Array.from({ length: aGrid.width }, (_, i) => -180 + (i + 0.5) * (360 / aGrid.width));
const bSpec = hSum.grids.airTemperatureC;
const bRaw = parseTeacherGrid(readFileSync(path.join(TD, bSpec.file)), bSpec).values;
const bLats = bSpec.latitudes, bLons = bSpec.longitudes.map((l) => (l > 180 ? l - 360 : l));

const nearest = (axis, v, wrap) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < axis.length; i++) { let d = Math.abs(axis[i] - v); if (wrap) d = Math.min(d, 360 - d); if (d < bd) { bd = d; best = i; } }
  return best;
};
const sampleA = (lat, lng) => aRaw[nearest(aLats, lat) * aGrid.width + nearest(aLons, lng, true)];
const sampleB = (lat, lng) => bRaw[nearest(bLats, lat) * bSpec.width + nearest(bLons, lng, true)];

// Model + elevation on the comparison grid, so the same cells are used for all.
const coarsen = (fine, fw, fh) => {
  const bx = fw / W, by = fh / H, out = new Float64Array(W * H);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) out[Math.floor(y / by) * W + Math.floor(x / bx)] += fine[y * fw + x];
  for (let i = 0; i < out.length; i++) out[i] /= bx * by;
  return out;
};
const mT = coarsen(temperatureField.annualMeanTemperatureC, temperatureField.width, temperatureField.height);
const mZ = coarsen(terrainField.relativeSurfaceElevationMetres || terrainField.relativeElevationMetres, terrainField.width, terrainField.height);
const water = coarsen(Float32Array.from(terrainField.isWaterSurface), terrainField.width, terrainField.height);

const P = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, lat = 90 - ((y + 0.5) * 180) / H, lng = -180 + ((x + 0.5) * 360) / W;
  P.push({ i, lat, lng, w: Math.cos((lat * Math.PI) / 180), isLand: water[i] < 0.5,
    a: sampleA(lat, lng), b: sampleB(lat, lng), m: mT[i], z: mZ[i] });
}
const LAND = P.filter((p) => p.isLand);
const wm = (rows, f) => { let s = 0, w = 0; for (const p of rows) { const v = f(p); if (!Number.isFinite(v)) continue; s += p.w * v; w += p.w; } return w > 0 ? s / w : NaN; };

console.log("Temperature teacher audit. Read-only: nothing fitted, no teacher file written, no model changed.\n");
console.log("=== 1. what each one is ===");
console.log(`  A  ${aGrid.width}x${aGrid.height} (${aGrid.resolutionDeg} deg), ${aGrid.units}, ${aGrid.missingValue} missing, ${tSum.missingCells} missing cells`);
console.log(`     product   : ${tSum.source.product}`);
console.log(`     variable  : ${tSum.source.variable}`);
console.log(`     period    : ${tSum.climatology.referencePeriod} (baseline ${tSum.climatology.baselinePeriod})`);
console.log(`     row0/col0 : ${aGrid.row0} / ${aGrid.col0}`);
console.log(`  B  ${bSpec.width}x${bSpec.height} (T62 Gaussian), ${bSpec.units}, hadMissing=${bSpec.source.hadMissing}`);
console.log(`     product   : NCEP/NCAR Reanalysis 1, air.2m monthly long-term mean`);
console.log(`     period    : ${bSpec.source.period.split("(")[0].trim()}`);
console.log(`     row0      : lat ${bLats[0]} (Gaussian, not evenly spaced), col0 lng ${bLons[0]}`);

console.log("\n=== 2. the same places, same cells ===");
const REGIONS = { アマゾン: [-70, -55, -8, 2], コンゴ: [15, 28, -5, 5], インドネシア: [100, 130, -8, 6],
  サハラ: [-8, 28, 18, 28], オーストラリア: [120, 145, -30, -18], インド: [73, 88, 10, 28],
  ヨーロッパ: [0, 30, 45, 58], グリーンランド: [-50, -25, 62, 82], チベット: [80, 100, 28, 38] };
console.log(`${"region".padEnd(14)} ${"A Berkeley".padStart(11)} ${"B NCEP2m".padStart(9)} ${"A-B".padStart(6)} ${"model".padStart(7)} ${"m-A".padStart(6)} ${"m-B".padStart(6)} ${"z (m)".padStart(7)}`);
for (const [name, [l0, l1, a0, a1]] of Object.entries(REGIONS)) {
  const rows = LAND.filter((p) => p.lat >= a0 && p.lat <= a1 && p.lng >= l0 && p.lng <= l1);
  if (!rows.length) continue;
  const A = wm(rows, (p) => p.a), B = wm(rows, (p) => p.b), M = wm(rows, (p) => p.m);
  console.log(`${name.padEnd(12)} ${A.toFixed(1).padStart(12)} ${B.toFixed(1).padStart(9)} ${(A - B).toFixed(1).padStart(6)} ${M.toFixed(1).padStart(7)} ${(M - A).toFixed(1).padStart(6)} ${(M - B).toFixed(1).padStart(6)} ${wm(rows, (p) => p.z).toFixed(0).padStart(7)}`);
}
{
  const A = wm(LAND, (p) => p.a), B = wm(LAND, (p) => p.b), M = wm(LAND, (p) => p.m);
  console.log(`${"全球陸平均".padEnd(12)} ${A.toFixed(1).padStart(12)} ${B.toFixed(1).padStart(9)} ${(A - B).toFixed(1).padStart(6)} ${M.toFixed(1).padStart(7)} ${(M - A).toFixed(1).padStart(6)} ${(M - B).toFixed(1).padStart(6)}`);
  const SEA = P.filter((p) => !p.isLand);
  const sA = wm(SEA, (p) => p.a), sB = wm(SEA, (p) => p.b);
  console.log(`${"全球海平均".padEnd(12)} ${sA.toFixed(1).padStart(12)} ${sB.toFixed(1).padStart(9)} ${(sA - sB).toFixed(1).padStart(6)}`);
  console.log(`  summary files' own global means: A ${tSum.globalMeanC} C (land ${tSum.landMeanC_BerkeleyMask}, sea ${tSum.seaMeanC_BerkeleyMask})`);
}

console.log("\n=== 3. where the two disagree, and with what ===");
{
  const bins = [["|A-B| < 0.5", (d) => d < 0.5], ["0.5-1", (d) => d >= 0.5 && d < 1], ["1-2", (d) => d >= 1 && d < 2],
    ["2-4", (d) => d >= 2 && d < 4], ["> 4", (d) => d >= 4]];
  let lw = 0; for (const p of LAND) lw += p.w;
  for (const [label, sel] of bins) {
    const rows = LAND.filter((p) => Number.isFinite(p.a) && Number.isFinite(p.b) && sel(Math.abs(p.a - p.b)));
    let w = 0; for (const p of rows) w += p.w;
    console.log(`  land with ${label.padEnd(12)} ${((100 * w) / lw).toFixed(1).padStart(5)}%   mean z ${wm(rows, (p) => p.z).toFixed(0).padStart(5)} m   mean |lat| ${wm(rows, (p) => Math.abs(p.lat)).toFixed(0)}`);
  }
  console.log("  A-B by elevation band (land):");
  for (const [a, b] of [[-500, 200], [200, 600], [600, 1200], [1200, 2500], [2500, 9000]]) {
    const rows = LAND.filter((p) => p.z >= a && p.z < b);
    if (!rows.length) continue;
    console.log(`    ${`${a}-${b} m`.padEnd(12)} A-B = ${wm(rows, (p) => p.a - p.b).toFixed(2).padStart(6)}`);
  }
  console.log("  A-B by latitude band (land):");
  for (let bnd = 8; bnd >= -9; bnd--) {
    const rows = LAND.filter((p) => Math.floor(p.lat / 10) === bnd);
    if (rows.length < 5) continue;
    process.stdout.write(`    ${`${bnd * 10}..${bnd * 10 + 10}`.padStart(9)}: ${wm(rows, (p) => p.a - p.b).toFixed(2).padStart(6)}`);
    if ((bnd % 3) === 0) process.stdout.write("\n");
  }
  process.stdout.write("\n");
}

console.log("\n=== 4. the Amazon, cell by cell ===");
{
  const rows = LAND.filter((p) => p.lat >= -8 && p.lat <= 2 && p.lng >= -70 && p.lng <= -55);
  const all = P.filter((p) => p.lat >= -8 && p.lat <= 2 && p.lng >= -70 && p.lng <= -55);
  console.log(`  land cells ${rows.length} of ${all.length} in the box`);
  console.log(`  land only : A ${wm(rows, (p) => p.a).toFixed(2)}  B ${wm(rows, (p) => p.b).toFixed(2)}  model ${wm(rows, (p) => p.m).toFixed(2)}`);
  console.log(`  all cells : A ${wm(all, (p) => p.a).toFixed(2)}  B ${wm(all, (p) => p.b).toFixed(2)}`);
  const sorted = [...rows].sort((x, y) => (y.a - y.b) - (x.a - x.b));
  console.log(`  biggest A-B in the box: ${sorted.slice(0, 3).map((p) => `${p.lat.toFixed(1)},${p.lng.toFixed(1)} ${(p.a - p.b).toFixed(1)}`).join("  ")}`);
  console.log(`  smallest:               ${sorted.slice(-3).map((p) => `${p.lat.toFixed(1)},${p.lng.toFixed(1)} ${(p.a - p.b).toFixed(1)}`).join("  ")}`);
}

console.log("\n=== 5. is the A-B gap associated with how wet the place is? ===");
{
  // The teacher's own specific humidity, on the same cells. If the gap tracks
  // moisture, that points at the land-surface/evaporation behaviour of the
  // reanalysis rather than at either field being wrong everywhere.
  const qSpec = hSum.grids.specificHumidityKgPerKg;
  const qRaw = parseTeacherGrid(readFileSync(path.join(TD, qSpec.file)), qSpec).values;
  const qLats = qSpec.latitudes, qLons = qSpec.longitudes.map((l) => (l > 180 ? l - 360 : l));
  for (const p of LAND) p.q = qRaw[nearest(qLats, p.lat) * qSpec.width + nearest(qLons, p.lng, true)] * 1000;
  console.log(`${"teacher q (g/kg)".padEnd(18)} ${"A-B".padStart(7)} ${"area%".padStart(7)} ${"mean |lat|".padStart(11)}`);
  let lw = 0; for (const p of LAND) lw += p.w;
  for (const [a, b] of [[0, 2], [2, 5], [5, 8], [8, 12], [12, 16], [16, 30]]) {
    const rows = LAND.filter((p) => p.q >= a && p.q < b);
    if (!rows.length) continue;
    let w = 0; for (const p of rows) w += p.w;
    console.log(`${`${a}-${b}`.padEnd(18)} ${wm(rows, (x) => x.a - x.b).toFixed(2).padStart(7)} ${((100 * w) / lw).toFixed(1).padStart(6)}% ${wm(rows, (x) => Math.abs(x.lat)).toFixed(0).padStart(11)}`);
  }
  const trop = LAND.filter((p) => Math.abs(p.lat) < 23.5);
  console.log("  tropical land only, so this is not a latitude effect:");
  for (const [a, b] of [[2, 5], [5, 8], [8, 12], [12, 16], [16, 30]]) {
    const rows = trop.filter((p) => p.q >= a && p.q < b);
    if (rows.length < 20) continue;
    console.log(`    q ${`${a}-${b}`.padEnd(8)} A-B = ${wm(rows, (x) => x.a - x.b).toFixed(2).padStart(6)}`);
  }
}
