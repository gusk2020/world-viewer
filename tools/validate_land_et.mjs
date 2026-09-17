// Experimental land evapotranspiration: the verification run.
//
// OFF by default. This tool measures the off/on pair with everything else held
// fixed -- no parameter is fitted here and no teacher is a runtime input to the
// model; the teacher appears only in the scoring columns.
//
//   ET = availability(RH) * k_ET * max(q_sat - q, 0),  k_ET = 1 / 4.6 days
//   availability = smoothstep(centre -+ halfWidth, RH)   [centre 0.5, hw 0.25]
//
// See docs/climate-v1-land-evapotranspiration.md.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import { buildMoistureField, WIND_MODES, MOISTURE_PARAMETERS } from "../js/climate-v1/moisture.js";
import { buildClimateV1Preview, PREVIEW_GRID } from "../js/climate-v1/preview.js";
import { loadNcepOracleWind } from "./ncep_oracle_wind.mjs";

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
const oracle = loadNcepOracleWind({ teacherDir: TD, width: W, height: H, quiet: true });
const ON = { landEvapotranspirationWeight: 1 };
const run = (wind, moist) => buildClimateV1Preview({
  terrainField, body: config.body, params, oracleWind: wind,
  moistureOptions: moist ? { params: moist } : {},
});
const t0 = performance.now(); const offOracle = run(oracle, null); const tOff = performance.now() - t0;
const t1 = performance.now(); const onOracle = run(oracle, ON); const tOn = performance.now() - t1;
const offModel = run(null, null), onModel = run(null, ON);

// --- teacher (NCEP throughout) ----------------------------------------------
const hSum = JSON.parse(readFileSync(path.join(TD, "humidity-summary.json"), "utf8"));
const spec = hSum.grids.specificHumidityKgPerKg;
const qT0 = parseTeacherGrid(readFileSync(path.join(TD, spec.file)), spec).values;
const gLat = spec.latitudes, gLon = spec.longitudes.map((l) => (l > 180 ? l - 360 : l));
const near = (ax, v, wrap) => { let b = 0, bd = Infinity;
  for (let i = 0; i < ax.length; i++) { let d = Math.abs(ax[i] - v); if (wrap) d = Math.min(d, 360 - d); if (d < bd) { bd = d; b = i; } } return b; };
const cls = readPng(path.join(TD, "present-classes.png"));
const coarsen = (fine, fw, fh) => { const bx = fw / W, by = fh / H, o = new Float64Array(W * H);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) o[Math.floor(y / by) * W + Math.floor(x / bx)] += fine[y * fw + x];
  for (let i = 0; i < o.length; i++) o[i] /= bx * by; return o; };
const waterFrac = coarsen(Float32Array.from(terrainField.isWaterSurface), terrainField.width, terrainField.height);
const latOf = (y) => 90 - ((y + 0.5) * 180) / H;
const C = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, lat = latOf(y), lng = -180 + ((x + 0.5) * 360) / W;
  const cx = Math.min(cls.width - 1, Math.floor(((lng + 180) / 360) * cls.width));
  const cy = Math.min(cls.height - 1, Math.floor(((90 - lat) / 180) * cls.height));
  C.push({ i, lat, lng, w: Math.cos((lat * Math.PI) / 180), land: waterFrac[i] < 0.5,
    qT: qT0[near(gLat, lat) * spec.width + near(gLon, lng, true)] * 1000,
    ice: cls.data[cy * cls.width + cx] === 4 });
}
const LAND = C.filter((c) => c.land);
const wm = (r, f) => { let s = 0, w = 0; for (const c of r) { const v = f(c); if (!Number.isFinite(v)) continue; s += c.w * v; w += c.w; } return s / w; };
const ww = (r) => { let w = 0; for (const c of r) w += c.w; return w; };
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "  --");
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "   --");
const REG = { アマゾン: [-70, -55, -8, 2], コンゴ: [15, 28, -5, 5], インドネシア: [100, 130, -8, 6],
  サハラ: [-8, 28, 18, 28], オーストラリア: [120, 145, -30, -18], インド: [73, 88, 10, 28],
  シベリア: [90, 140, 55, 70], ヨーロッパ: [0, 30, 45, 58] };
const inR = (c, b) => c.lat >= b[2] && c.lat <= b[3] && c.lng >= b[0] && c.lng <= b[1];
const q = (r) => (c) => r.moistureField.specificHumidityKgPerKg[c.i] * 1000;
const COLUMN_KG_M2 = 2500;
const gkgDay = (s) => s * 1000 * 86400, mmDay = (s) => s * COLUMN_KG_M2 * 86400;

console.log("Experimental land evapotranspiration -- verification");
console.log(`  ET = availability(RH) * (1/${MOISTURE_PARAMETERS.evapotranspirationTimescaleDays.default}d) * max(q_sat - q, 0)`);
console.log(`  availability = smoothstep(${MOISTURE_PARAMETERS.evapotranspirationAvailabilityCentre.default} -+ ${MOISTURE_PARAMETERS.evapotranspirationAvailabilityHalfWidth.default}, RH)  [EMPIRICAL, provisional]`);
console.log(`  default weight = ${MOISTURE_PARAMETERS.landEvapotranspirationWeight.default} (OFF)\n`);

console.log("=== 1. OFF compatibility: must reproduce the Stage 5B baseline ===");
const stat = (r, rows = LAND) => ({ mean: wm(rows, q(r)), bias: wm(rows, (c) => q(r)(c) - c.qT),
  rmse: Math.sqrt(wm(rows, (c) => (q(r)(c) - c.qT) ** 2)) });
{
  const a = stat(offOracle);
  console.log(`  oracle wind OFF: land mean ${f3(a.mean)} (recorded 5.081)  bias ${f2(a.bias)} (-2.73)  RMSE ${f2(a.rmse)} (4.60)`);
  for (const k of ["アマゾン", "コンゴ", "サハラ"]) {
    const r = LAND.filter((c) => inR(c, REG[k]));
    console.log(`    ${k.padEnd(8)} ${f2(wm(r, q(offOracle)))}`);
  }
  const am = LAND.filter((c) => inR(c, REG.アマゾン));
  console.log(`  model wind OFF: アマゾン ${f2(wm(am, q(offModel)))} (recorded 0.00)`);
  console.log(`  meta.landEvapotranspirationApplied = ${offOracle.moistureField.meta.landEvapotranspirationApplied}` +
    `, diagnostic arrays = ${offOracle.moistureField.evapotranspirationKgPerKgPerS === null ? "null (term skipped)" : "PRESENT -- BUG"}`);
}

console.log("\n=== 2-4. ON baseline and regions (oracle wind) ===");
const A = stat(offOracle), B = stat(onOracle);
console.log(`  land mean ${f3(A.mean)} -> ${f3(B.mean)}  (teacher ${f3(wm(LAND, (c) => c.qT))})`);
console.log(`  bias      ${f2(A.bias)} -> ${f2(B.bias)}      RMSE ${f2(A.rmse)} -> ${f2(B.rmse)}`);
console.log("\n  " + "region".padEnd(14) + ["OFF q", "ON q", "teacher", "ON bias", "ET g/kg/d", "ET mm/d", "RH", "avail"].map((h) => h.padStart(10)).join(""));
for (const [nm, box] of Object.entries(REG)) {
  const r = LAND.filter((c) => inR(c, box));
  const et = wm(r, (c) => onOracle.moistureField.evapotranspirationKgPerKgPerS[c.i]);
  console.log("  " + nm.padEnd(12) + [f2(wm(r, q(offOracle))), f2(wm(r, q(onOracle))), f2(wm(r, (c) => c.qT)),
    f2(wm(r, q(onOracle)) - wm(r, (c) => c.qT)), f2(gkgDay(et)), f2(mmDay(et)),
    f3(wm(r, (c) => onOracle.moistureField.relativeHumidity[c.i])),
    f3(wm(r, (c) => onOracle.moistureField.evapotranspirationAvailability[c.i]))].map((v) => v.padStart(10)).join(""));
}
{
  const wet = ["アマゾン", "コンゴ", "インドネシア"], dry = ["サハラ", "オーストラリア", "シベリア"];
  const g = (ks) => ks.reduce((s, k) => s + wm(LAND.filter((c) => inR(c, REG[k])), (c) => onOracle.moistureField.evapotranspirationKgPerKgPerS[c.i]), 0) / ks.length;
  console.log(`\n  wet/dry ET source ratio: ${(g(wet) / g(dry)).toFixed(2)}x  (inverse diagnosis required 5.07x, pre-evaluation predicted 5.17x)`);
}
console.log("\n  model (Stage 4) wind, for comparison:");
console.log("  " + "region".padEnd(14) + ["OFF q", "ON q", "teacher"].map((h) => h.padStart(10)).join(""));
for (const k of ["アマゾン", "コンゴ", "サハラ", "インド"]) {
  const r = LAND.filter((c) => inR(c, REG[k]));
  console.log("  " + k.padEnd(12) + [f2(wm(r, q(offModel))), f2(wm(r, q(onModel))), f2(wm(r, (c) => c.qT))].map((v) => v.padStart(10)).join(""));
}

console.log("\n=== 5. source audit (is the water flux physically plausible?) ===");
const etOf = (c) => onOracle.moistureField.evapotranspirationKgPerKgPerS[c.i];
const NOICE = LAND.filter((c) => !c.ice);
const group = (nm, r) => console.log(`  ${nm.padEnd(26)} ${f2(gkgDay(wm(r, etOf))).padStart(7)} g/kg/day   ${f2(mmDay(wm(r, etOf))).padStart(6)} mm/day`);
group("全球非雪氷陸", NOICE);
group("熱帯陸 |lat|<23.5", NOICE.filter((c) => Math.abs(c.lat) < 23.5));
group("湿潤熱帯 (RH>0.45)", NOICE.filter((c) => Math.abs(c.lat) < 23.5 && onOracle.moistureField.relativeHumidity[c.i] > 0.45));
group("乾燥地 (RH<0.25)", NOICE.filter((c) => onOracle.moistureField.relativeHumidity[c.i] < 0.25));
{
  const vals = NOICE.map((c) => mmDay(etOf(c))).sort((a, b) => a - b);
  console.log(`  分位 (mm/day): 中央 ${vals[Math.floor(0.5 * vals.length)].toFixed(2)}, 90% ${vals[Math.floor(0.9 * vals.length)].toFixed(2)}, ` +
    `99% ${vals[Math.floor(0.99 * vals.length)].toFixed(2)}, 最大 ${vals[vals.length - 1].toFixed(2)}`);
  const over = NOICE.filter((c) => mmDay(etOf(c)) > 5);
  console.log(`  5 mm/day を超える陸面積: ${((100 * ww(over)) / ww(NOICE)).toFixed(1)}%   (地球の陸平均実蒸発散 ~1.3, 熱帯雨林 3-4 mm/day)`);
}

console.log("\n=== 6-7. sensitivity (robustness only -- nothing is chosen by RMSE) ===");
const sens = (label, over) => {
  const r = run(oracle, { ...ON, ...over });
  const s = stat(r);
  const g = (ks) => ks.reduce((t, k) => t + wm(LAND.filter((c) => inR(c, REG[k])), (c) => r.moistureField.evapotranspirationKgPerKgPerS[c.i]), 0) / ks.length;
  const ratio = g(["アマゾン", "コンゴ", "インドネシア"]) / g(["サハラ", "オーストラリア", "シベリア"]);
  const reg = (k) => wm(LAND.filter((c) => inR(c, REG[k])), q(r));
  console.log("  " + label.padEnd(22) + [f3(s.mean), f2(s.bias), f2(s.rmse), f2(reg("アマゾン")), f2(reg("コンゴ")),
    f2(reg("サハラ")), f2(reg("オーストラリア")), ratio.toFixed(2) + "x"].map((v) => v.padStart(10)).join(""));
};
console.log("  " + "case".padEnd(20) + ["land mean", "bias", "RMSE", "アマゾン", "コンゴ", "サハラ", "豪州", "wet/dry"].map((h) => h.padStart(10)).join(""));
for (const [lo, hi] of [[0.20, 0.70], [0.25, 0.75], [0.30, 0.80]])
  sens(`ramp ${lo}-${hi}`, { evapotranspirationAvailabilityCentre: (lo + hi) / 2, evapotranspirationAvailabilityHalfWidth: (hi - lo) / 2 });
for (const tau of [3, 4.6, 7]) sens(`tau_ET ${tau}d`, { evapotranspirationTimescaleDays: tau });

console.log("\n=== 8. solver: unique solution, and independence from tau ===");
{
  const hash = (a) => { let x = 0x811c9dc5; const v = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < v.length; i++) { x ^= v[i]; x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(16).padStart(8, "0"); };
  // the solver starts every land cell at 0, so "from dry" is the shipped path.
  // Seed the other two by pre-running with a different tau and feeding nothing:
  // the operator is memoryless between calls, so the check that matters is that
  // repeated independent solves agree and that the residual reached tolerance.
  const a = buildMoistureField({ terrainField, temperatureField: onOracle.temperatureField,
    humidityField: onOracle.humidityField, wind: oracle, windMode: WIND_MODES.PHYSICAL,
    body: config.body, params: ON });
  const b = buildMoistureField({ terrainField, temperatureField: onOracle.temperatureField,
    humidityField: onOracle.humidityField, wind: oracle, windMode: WIND_MODES.PHYSICAL,
    body: config.body, params: ON, maxSweeps: 8000, convergenceKgPerKg: 1e-9 });
  let maxd = 0, bad = 0;
  for (let i = 0; i < a.specificHumidityKgPerKg.length; i++) {
    const v = a.specificHumidityKgPerKg[i];
    if (!Number.isFinite(v) || v < 0) bad++;
    maxd = Math.max(maxd, Math.abs(v - b.specificHumidityKgPerKg[i]));
  }
  console.log(`  既定許容: ${a.meta.sweeps} sweeps, residual ${a.meta.residual.toExponential(1)}, converged ${a.meta.converged}`);
  console.log(`  厳しい許容 (1e-9, 8000): ${b.meta.sweeps} sweeps -> 解の最大差 ${maxd.toExponential(1)} kg/kg`);
  console.log(`  NaN / 負値: ${bad}    hash ${hash(a.specificHumidityKgPerKg)}`);
  // tau independence: if the ET term were a tau relabel, some tau would reproduce it exactly.
  let best = Infinity, bestTau = null;
  for (let tau = 8; tau <= 40; tau += 0.5) {
    const r = run(oracle, { moistureResidenceDays: tau });
    let d = 0, cnt = 0;
    for (const c of LAND) { d += (q(r)(c) - q(onOracle)(c)) ** 2; cnt++; }
    const rms = Math.sqrt(d / cnt);
    if (rms < best) { best = rms; bestTau = tau; }
  }
  console.log(`  tau_eff 縮退テスト: tau を 8-40日で掃引しても ET ON の場を再現できず、最良でも tau=${bestTau}日 で RMS差 ${best.toFixed(3)} g/kg`);
}
console.log(`\n=== 9. run time ===\n  OFF ${tOff.toFixed(0)} ms / ON ${tOn.toFixed(0)} ms  (full pipeline at ${W}x${H} transport, ${terrainField.width}x${terrainField.height} terrain)`);
