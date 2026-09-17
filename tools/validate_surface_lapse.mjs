// Climate v1's surface lapse rate: the before/after measurement.
//
// Read-only with respect to every parameter -- it runs the real pipeline twice,
// once with `surfaceLapseRateCPerKm` forced back to the free-air rate (the
// "before" state) and once as shipped, and scores both against the main
// teacher (Berkeley Earth) and the independent check (NCEP 2 m).
//
// Nothing here is fitted. 5.2 was adopted from a measurement of the teacher's
// own surface lapse rate (5.27 C/km over ice-free land) and not re-fitted; see
// docs/climate-v1-surface-lapse-rate.md.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import { buildClimateV1Preview, PREVIEW_GRID } from "../js/climate-v1/preview.js";

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
const before = { ...params, surfaceLapseRateCPerKm: params.lapseRateCPerKm };
const terrainField = buildTerrainField({
  elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0,
  oceanMask: loadOceanMask(config, REPO), waterSurfaceMask: loadWaterSurfaceMask(config, REPO),
});
const runA = buildClimateV1Preview({ terrainField, body: config.body, params: before });
const runB = buildClimateV1Preview({ terrainField, body: config.body, params });

// --- teachers ---------------------------------------------------------------
const tSum = JSON.parse(readFileSync(path.join(TD, "temperature-summary.json"), "utf8"));
const hSum = JSON.parse(readFileSync(path.join(TD, "humidity-summary.json"), "utf8"));
const aG = tSum.grid;
const aBuf = readFileSync(path.join(TD, aG.valuesFile));
const aRaw = new Float32Array(aBuf.buffer.slice(aBuf.byteOffset, aBuf.byteOffset + aBuf.byteLength));
const bSpec = hSum.grids.airTemperatureC;
const bRaw = parseTeacherGrid(readFileSync(path.join(TD, bSpec.file)), bSpec).values;
const gLat = bSpec.latitudes, gLon = bSpec.longitudes.map((l) => (l > 180 ? l - 360 : l));
const nearest = (axis, v, wrap) => { let b = 0, bd = Infinity;
  for (let i = 0; i < axis.length; i++) { let d = Math.abs(axis[i] - v); if (wrap) d = Math.min(d, 360 - d); if (d < bd) { bd = d; b = i; } } return b; };
const cls = readPng(path.join(TD, "present-classes.png"));

const coarsen = (fine, fw, fh) => { const bx = fw / W, by = fh / H, o = new Float64Array(W * H);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) o[Math.floor(y / by) * W + Math.floor(x / bx)] += fine[y * fw + x];
  for (let i = 0; i < o.length; i++) o[i] /= bx * by; return o; };
const water = coarsen(Float32Array.from(terrainField.isWaterSurface), terrainField.width, terrainField.height);
const zC = coarsen(terrainField.relativeSurfaceElevationMetres, terrainField.width, terrainField.height);
const tOf = (r) => coarsen(r.temperatureField.annualMeanTemperatureC, r.temperatureField.width, r.temperatureField.height);
const TA = tOf(runA), TB = tOf(runB);

const C = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, lat = 90 - ((y + 0.5) * 180) / H, lng = -180 + ((x + 0.5) * 360) / W;
  const j = Math.min(aG.height - 1, Math.max(0, Math.round((90 - lat) / (180 / aG.height) - 0.5)));
  const ii = Math.min(aG.width - 1, Math.max(0, Math.round((lng + 180) / (360 / aG.width) - 0.5)));
  const cx = Math.min(cls.width - 1, Math.floor(((lng + 180) / 360) * cls.width));
  const cy = Math.min(cls.height - 1, Math.floor(((90 - lat) / 180) * cls.height));
  C.push({ i, lat, lng, w: Math.cos((lat * Math.PI) / 180), land: water[i] < 0.5, z: Math.max(0, zC[i]),
    a: aRaw[j * aG.width + ii], b: bRaw[nearest(gLat, lat) * bSpec.width + nearest(gLon, lng, true)],
    ice: cls.data[cy * cls.width + cx] === 4, A: TA[i], B: TB[i] });
}
const LAND = C.filter((c) => c.land && Number.isFinite(c.a));
const ALL = C.filter((c) => Number.isFinite(c.a));
const wm = (rows, f) => { let s = 0, w = 0; for (const c of rows) { const v = f(c); if (!Number.isFinite(v)) continue; s += c.w * v; w += c.w; } return s / w; };
const mabs = (rows, k) => { let s = 0, w = 0; for (const c of rows) { s += c.w * Math.abs(c[k] - c.a); w += c.w; } return s / w; };
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "  --");

console.log("Climate v1 surface lapse rate: 6.5 (free air) -> 5.2 C/km (surface)");
console.log(`  lapseRateCPerKm        = ${params.lapseRateCPerKm} (unchanged, free air)`);
console.log(`  surfaceLapseRateCPerKm = ${params.surfaceLapseRateCPerKm} (new, ground height only)\n`);
console.log("bias = model - teacher (C). A = Berkeley Earth (main), B = NCEP 2 m (independent check).\n");

console.log("=== regions (land) ===");
const REGIONS = { チベット: [80, 100, 28, 38], ヒマラヤ周辺: [72, 95, 25, 35], ロッキー: [-120, -105, 35, 50],
  アンデス: [-78, -66, -40, -10], エチオピア高地: [35, 42, 5, 14], グリーンランド: [-50, -25, 62, 82],
  南極: [-180, 180, -90, -70], ヨーロッパ: [0, 30, 45, 58], アマゾン: [-70, -55, -8, 2],
  コンゴ: [15, 28, -5, 5], インドネシア: [100, 130, -8, 6], サハラ: [-8, 28, 18, 28] };
const inR = (c, x) => c.lat >= x[2] && c.lat <= x[3] && c.lng >= x[0] && c.lng <= x[1];
console.log("region".padEnd(16) + ["before A", "after A", "delta", "before B", "after B", "z (m)"].map((h) => h.padStart(10)).join(""));
for (const [n, box] of Object.entries(REGIONS)) {
  const rows = LAND.filter((c) => inR(c, box));
  if (!rows.length) continue;
  const ba = wm(rows, (c) => c.A - c.a), aa = wm(rows, (c) => c.B - c.a);
  console.log(n.padEnd(14) + [f2(ba), f2(aa), f2(aa - ba), f2(wm(rows, (c) => c.A - c.b)), f2(wm(rows, (c) => c.B - c.b)),
    wm(rows, (c) => c.z).toFixed(0)].map((v) => v.padStart(10)).join(""));
}

console.log("\n=== elevation bands (land) ===");
console.log("band".padEnd(16) + ["before A", "after A", "delta", "area%"].map((h) => h.padStart(10)).join(""));
let lw = 0; for (const c of LAND) lw += c.w;
for (const [lo, hi, label] of [[0, 500, "0-500m"], [500, 1500, "500-1500m"], [1500, 3000, "1500-3000m"], [3000, 9999, "3000m+"]]) {
  const rows = LAND.filter((c) => c.z >= lo && c.z < hi);
  if (!rows.length) continue;
  let w = 0; for (const c of rows) w += c.w;
  const ba = wm(rows, (c) => c.A - c.a), aa = wm(rows, (c) => c.B - c.a);
  console.log(label.padEnd(14) + [f2(ba), f2(aa), f2(aa - ba), ((100 * w) / lw).toFixed(1)].map((v) => v.padStart(10)).join(""));
}

console.log("\n=== aggregates ===");
const GROUPS = [["全球", ALL], ["全球陸", LAND], ["全球海", ALL.filter((c) => !c.land)],
  ["氷床除外陸", LAND.filter((c) => !c.ice)], ["氷床除外 z>500m", LAND.filter((c) => !c.ice && c.z > 500)]];
console.log("group".padEnd(18) + ["before A", "after A", "delta"].map((h) => h.padStart(10)).join(""));
for (const [n, rows] of GROUPS) {
  const ba = wm(rows, (c) => c.A - c.a), aa = wm(rows, (c) => c.B - c.a);
  console.log(n.padEnd(16) + [f2(ba), f2(aa), f2(aa - ba)].map((v) => v.padStart(10)).join(""));
}
console.log("\nmean |bias| against A:");
for (const [n, rows] of [["全球陸", LAND], ["氷床除外陸", LAND.filter((c) => !c.ice)],
  ["氷床除外 z>500m", LAND.filter((c) => !c.ice && c.z > 500)], ["平地 z<500m", LAND.filter((c) => c.z < 500)]])
  console.log(`  ${n.padEnd(16)} ${mabs(rows, "A").toFixed(2)} -> ${mabs(rows, "B").toFixed(2)}`);

console.log("\n=== guardrails ===");
{
  const fw = terrainField.width, fh = terrainField.height;
  const a = runA.temperatureField.annualMeanTemperatureC, b = runB.temperatureField.annualMeanTemperatureC;
  let seaMax = 0, zeroMax = 0, seaN = 0, zeroN = 0, bad = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(b[i])) bad++;
    if (terrainField.isSea[i]) { seaN++; seaMax = Math.max(seaMax, Math.abs(a[i] - b[i])); }
    else if (terrainField.relativeElevationMetres[i] === 0) { zeroN++; zeroMax = Math.max(zeroMax, Math.abs(a[i] - b[i])); }
  }
  console.log(`  sea cells unchanged:          max |delta| ${seaMax.toExponential(1)} C over ${seaN} cells`);
  console.log(`  land at exactly 0 m unchanged: max |delta| ${zeroMax.toExponential(1)} C over ${zeroN} cells`);
  console.log(`  non-finite temperatures:      ${bad}`);
  // the elevation term itself, read straight off the field
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    if (terrainField.isSea[i]) continue;
    const z = terrainField.relativeElevationMetres[i] / 1000;
    worst = Math.max(worst, Math.abs((b[i] - a[i]) - (params.lapseRateCPerKm - params.surfaceLapseRateCPerKm) * z));
  }
  console.log(`  land delta equals (6.5-5.2)*z: max residual ${worst.toExponential(1)} C  (grid ${fw}x${fh})`);
}
{
  const q = (r) => { let s = 0, n = 0; for (const v of r.moistureField.specificHumidityKgPerKg) { s += v; n++; } return (1000 * s) / n; };
  const sp = (r) => { let s = 0, n = 0; for (let i = 0; i < r.wind.windSpeedMs.length; i++) { s += r.wind.windSpeedMs[i]; n++; } return s / n; };
  const pr = (r) => { let s = 0, n = 0; for (const v of r.humidityField.surfacePressureHPa) { s += v; n++; } return s / n; };
  console.log(`  downstream (changed only through the temperature input):`);
  console.log(`    mean surface pressure ${pr(runA).toFixed(3)} -> ${pr(runB).toFixed(3)} hPa`);
  console.log(`    mean wind speed       ${sp(runA).toFixed(4)} -> ${sp(runB).toFixed(4)} m/s`);
  console.log(`    mean specific humidity ${q(runA).toFixed(4)} -> ${q(runB).toFixed(4)} g/kg`);
}
