// Stage 5A / 5B re-baseline after surfaceLapseRateCPerKm = 5.2. READ-ONLY.
// Nothing is fitted; no physics file is touched. Evaporative cooling stays OFF.
// Teachers: NCEP throughout (q, 2 m T, surface pressure) -- Berkeley Earth is
// Stage 2's temperature teacher only and is never mixed into a ratio here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { readPng } = await import(path.join(REPO, "tools/png.mjs"));
const { loadOceanMask, loadWaterSurfaceMask } = await import(path.join(REPO, "tools/ocean_mask.mjs"));
const { resolveClimateSets } = await import(path.join(REPO, "js/climate.js"));
const { buildTerrainField } = await import(path.join(REPO, "js/climate-v1/terrain.js"));
const { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION: CAL } = await import(path.join(REPO, "js/climate-v1/earth-temperature-calibration.js"));
const { parseTeacherGrid } = await import(path.join(REPO, "js/climate-v1/humidity-teacher.js"));
const { saturationVapourPressureHPa, saturationSpecificHumidity } = await import(path.join(REPO, "js/climate-v1/humidity.js"));
const { buildClimateV1Preview, PREVIEW_GRID, PREVIEW_ATMOSPHERE } = await import(path.join(REPO, "js/climate-v1/preview.js"));
const { loadNcepOracleWind } = await import(path.join(REPO, "tools/ncep_oracle_wind.mjs"));
const WORLD = path.join(REPO, "worlds", "kasoku-sekai"), TD = path.join(WORLD, "teacher");
const W = PREVIEW_GRID.width, H = PREVIEW_GRID.height;
const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));
const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
const off = config.terrain.encoding.offsetMetres;
const metres = new Int16Array(png.width * png.height);
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - off;
const sets = resolveClimateSets(config);
const now = { ...sets.sets.find((s) => s.id === sets.defaultId).values, ...CAL };
const before = { ...now, surfaceLapseRateCPerKm: now.lapseRateCPerKm };   // the 6.5 state
const tf = buildTerrainField({ elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0,
  oceanMask: loadOceanMask(config, REPO), waterSurfaceMask: loadWaterSurfaceMask(config, REPO) });
const oracle = loadNcepOracleWind({ teacherDir: TD, width: W, height: H, quiet: true });
const R = {
  oldModel: buildClimateV1Preview({ terrainField: tf, body: config.body, params: before }),
  oldOracle: buildClimateV1Preview({ terrainField: tf, body: config.body, params: before, oracleWind: oracle }),
  newModel: buildClimateV1Preview({ terrainField: tf, body: config.body, params: now }),
  newOracle: buildClimateV1Preview({ terrainField: tf, body: config.body, params: now, oracleWind: oracle }),
};

// --- teachers, all NCEP -------------------------------------------------------
const hSum = JSON.parse(readFileSync(path.join(TD, "humidity-summary.json"), "utf8"));
const G = {};
for (const [k, spec] of Object.entries(hSum.grids)) G[k] = { spec, v: parseTeacherGrid(readFileSync(path.join(TD, spec.file)), spec).values };
const pick = (k, lat, lng) => { const { spec, v } = G[k];
  const lats = spec.latitudes, lons = spec.longitudes.map((l) => (l > 180 ? l - 360 : l));
  let j = 0, bd = Infinity; for (let i = 0; i < lats.length; i++) { const d = Math.abs(lats[i] - lat); if (d < bd) { bd = d; j = i; } }
  let i2 = 0; bd = Infinity; for (let i = 0; i < lons.length; i++) { let d = Math.abs(lons[i] - lng); d = Math.min(d, 360 - d); if (d < bd) { bd = d; i2 = i; } }
  return v[j * spec.width + i2]; };

// --- everything on the 256x128 transport grid ---------------------------------
const coarsen = (fine, fw, fh) => { const bx = fw / W, by = fh / H, o = new Float64Array(W * H);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) o[Math.floor(y / by) * W + Math.floor(x / bx)] += fine[y * fw + x];
  for (let i = 0; i < o.length; i++) o[i] /= bx * by; return o; };
const water = coarsen(Float32Array.from(tf.isWaterSurface), tf.width, tf.height);
const zC = coarsen(tf.relativeSurfaceElevationMetres, tf.width, tf.height);
const fieldC = {};
for (const [k, r] of Object.entries(R)) fieldC[k] = {
  T: coarsen(r.temperatureField.annualMeanTemperatureC, r.temperatureField.width, r.temperatureField.height),
  P: coarsen(r.humidityField.surfacePressureHPa, r.humidityField.width, r.humidityField.height),
  QS: coarsen(r.humidityField.saturationSpecificHumidityKgPerKg, r.humidityField.width, r.humidityField.height),
  q: r.moistureField.specificHumidityKgPerKg, rh: r.moistureField.relativeHumidity,
  qsT: r.moistureField.saturationSpecificHumidityKgPerKg,
};
const EPS = PREVIEW_ATMOSPHERE.specificGasConstantJPerKgK / PREVIEW_ATMOSPHERE.vapourGasConstantJPerKgK;
const latOf = (y) => 90 - ((y + 0.5) * 180) / H;
const C = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, lat = latOf(y), lng = -180 + ((x + 0.5) * 360) / W;
  const tT = pick("airTemperatureC", lat, lng), tP = pick("surfacePressureHPa", lat, lng);
  const tQ = pick("specificHumidityKgPerKg", lat, lng) * 1000;
  const tQS = saturationSpecificHumidity(saturationVapourPressureHPa(tT), tP, EPS) * 1000;
  C.push({ i, lat, lng, w: Math.cos((lat * Math.PI) / 180), land: water[i] < 0.5, z: Math.max(0, zC[i]),
    tT, tP, tQ, tQS, tRH: tQS > 0 ? tQ / tQS : NaN });
}
const LAND = C.filter((c) => c.land);
const wm = (r, f) => { let s = 0, w = 0; for (const c of r) { const v = f(c); if (!Number.isFinite(v)) continue; s += c.w * v; w += c.w; } return s / w; };
const ww = (r) => { let w = 0; for (const c of r) w += c.w; return w; };
const rmse = (r, f) => Math.sqrt(wm(r, (c) => f(c) ** 2));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "  --");
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "   --");
const qOf = (k, c) => fieldC[k].q[c.i] * 1000;
const qsOf = (k, c) => fieldC[k].QS[c.i] * 1000;

console.log("Stage 5A / 5B re-baseline after surfaceLapseRateCPerKm = 5.2");
console.log("Teachers: NCEP q + NCEP 2 m T + NCEP surface pressure (never mixed with Berkeley Earth).");
console.log("Evaporative cooling OFF. No physics file changed.\n");

console.log("=== 2. Stage 5A: what 5.2 moved (land, cos-lat weighted) ===");
console.log("  " + "量".padEnd(28) + "6.5".padStart(10) + "5.2".padStart(10) + "差".padStart(9) + "Teacher".padStart(10));
const A5 = [
  ["表面気圧 hPa (陸)", (k) => wm(LAND, (c) => fieldC[k].P[c.i]), wm(LAND, (c) => c.tP)],
  ["  うち z>1500m", (k) => wm(LAND.filter((c) => c.z > 1500), (c) => fieldC[k].P[c.i]), wm(LAND.filter((c) => c.z > 1500), (c) => c.tP)],
  ["q_sat g/kg (陸)", (k) => wm(LAND, (c) => qsOf(k, c)), wm(LAND, (c) => c.tQS)],
  ["  うち z>1500m", (k) => wm(LAND.filter((c) => c.z > 1500), (c) => qsOf(k, c)), wm(LAND.filter((c) => c.z > 1500), (c) => c.tQS)],
  ["  熱帯陸 |lat|<23.5", (k) => wm(LAND.filter((c) => Math.abs(c.lat) < 23.5), (c) => qsOf(k, c)), wm(LAND.filter((c) => Math.abs(c.lat) < 23.5), (c) => c.tQS)],
  ["地表温度 C (陸)", (k) => wm(LAND, (c) => fieldC[k].T[c.i]), wm(LAND, (c) => c.tT)],
];
for (const [n, f, t] of A5) { const a = f("oldOracle"), b = f("newOracle");
  console.log("  " + n.padEnd(26) + f2(a).padStart(10) + f2(b).padStart(10) + f2(b - a).padStart(9) + f2(t).padStart(10)); }
console.log("\n  q_sat bias (model - teacher), by elevation band:");
for (const [lo, hi, n] of [[0, 500, "0-500m"], [500, 1500, "500-1500m"], [1500, 3000, "1500-3000m"], [3000, 9999, "3000m+"]]) {
  const r = LAND.filter((c) => c.z >= lo && c.z < hi);
  console.log(`    ${n.padEnd(12)} 6.5 ${f2(wm(r, (c) => qsOf("oldOracle", c) - c.tQS)).padStart(7)}   5.2 ${f2(wm(r, (c) => qsOf("newOracle", c) - c.tQS)).padStart(7)}   面積 ${((100 * ww(r)) / ww(LAND)).toFixed(1)}%`);
}

console.log("\n=== 3. Stage 5B new baseline (land, q in g/kg) ===");
console.log("  " + "条件".padEnd(24) + "land mean".padStart(10) + "bias".padStart(9) + "RMSE".padStart(9) + "q<0.001".padStart(9) + "exact 0".padStart(9) + "RH".padStart(8));
for (const [n, k] of [["6.5 / 現行風", "oldModel"], ["5.2 / 現行風", "newModel"], ["6.5 / oracle風", "oldOracle"], ["5.2 / oracle風", "newOracle"]]) {
  const m = wm(LAND, (c) => qOf(k, c)), b = wm(LAND, (c) => qOf(k, c) - c.tQ), e = rmse(LAND, (c) => qOf(k, c) - c.tQ);
  const lo = (100 * ww(LAND.filter((c) => qOf(k, c) < 0.001))) / ww(LAND);
  const z0 = (100 * ww(LAND.filter((c) => qOf(k, c) === 0))) / ww(LAND);
  console.log("  " + n.padEnd(22) + f3(m).padStart(10) + f2(b).padStart(9) + f2(e).padStart(9) + lo.toFixed(1).padStart(8) + "%" + z0.toFixed(1).padStart(8) + "%" + f3(wm(LAND, (c) => fieldC[k].rh[c.i])).padStart(8));
}
console.log(`  Teacher land mean q ${f3(wm(LAND, (c) => c.tQ))} g/kg,  teacher RH ${f3(wm(LAND, (c) => c.tRH))}`);
console.log("\n  dry tail: land area below each q threshold (%), 5.2 state");
console.log("  " + "しきい値".padEnd(12) + "現行風".padStart(9) + "oracle風".padStart(10) + "Teacher".padStart(10));
for (const th of [0.001, 0.1, 0.5, 1, 2, 3, 5]) {
  const p = (k) => (100 * ww(LAND.filter((c) => qOf(k, c) < th))) / ww(LAND);
  console.log("  " + `< ${th}`.padEnd(10) + p("newModel").toFixed(1).padStart(9) + p("newOracle").toFixed(1).padStart(10) +
    ((100 * ww(LAND.filter((c) => c.tQ < th))) / ww(LAND)).toFixed(1).padStart(10));
}

console.log("\n=== 4-5. 地域別 q (g/kg) ===");
const REG = { アマゾン: [-70, -55, -8, 2], コンゴ: [15, 28, -5, 5], インドネシア: [100, 130, -8, 6],
  サハラ: [-8, 28, 18, 28], オーストラリア: [120, 145, -30, -18], インド: [73, 88, 10, 28],
  ヨーロッパ: [0, 30, 45, 58], シベリア: [90, 140, 55, 70] };
const inR = (c, b) => c.lat >= b[2] && c.lat <= b[3] && c.lng >= b[0] && c.lng <= b[1];
console.log("  " + "地域".padEnd(14) + ["6.5現行", "5.2現行", "6.5oracle", "5.2oracle", "Teacher", "q_sat 5.2", "RH 5.2o"].map((h) => h.padStart(10)).join(""));
for (const [n, box] of Object.entries(REG)) {
  const r = LAND.filter((c) => inR(c, box));
  console.log("  " + n.padEnd(12) + [wm(r, (c) => qOf("oldModel", c)), wm(r, (c) => qOf("newModel", c)),
    wm(r, (c) => qOf("oldOracle", c)), wm(r, (c) => qOf("newOracle", c)), wm(r, (c) => c.tQ),
    wm(r, (c) => qsOf("newOracle", c))].map((v) => f2(v).padStart(10)).join("") +
    f3(wm(r, (c) => fieldC.newOracle.rh[c.i])).padStart(10));
}
{ const am = LAND.filter((c) => inR(c, REG.アマゾン)), sa = LAND.filter((c) => inR(c, REG.サハラ));
  const ra = (k) => wm(am, (c) => qOf(k, c)) / wm(sa, (c) => qOf(k, c));
  console.log(`\n  アマゾン/サハラ比: 6.5 oracle ${f2(ra("oldOracle"))}  ->  5.2 oracle ${f2(ra("newOracle"))}   (旧記録値 5.22)`); }

console.log("\n=== 6. 誤差の再分解 (陸, 5.2温度場) ===");
// q_m - q_t = (qsat_m - qsat_t) * RH_m   +   qsat_t * (RH_m - RH_t)
const capTerm = (k, c) => (qsOf(k, c) - c.tQS) * fieldC[k].rh[c.i];
const rhTerm = (k, c) => c.tQS * (fieldC[k].rh[c.i] - c.tRH);
for (const [n, k] of [["現行風", "newModel"], ["oracle風", "newOracle"]]) {
  console.log(`  ${n}:`);
  console.log(`    A 容量(温度/q_sat)由来   平均 ${f2(wm(LAND, (c) => capTerm(k, c))).padStart(7)}  平均|.| ${f2(wm(LAND, (c) => Math.abs(capTerm(k, c)))).padStart(6)}  RMSE ${f2(rmse(LAND, (c) => capTerm(k, c)))}`);
  console.log(`    B+C 相対湿度(輸送/源)由来 平均 ${f2(wm(LAND, (c) => rhTerm(k, c))).padStart(7)}  平均|.| ${f2(wm(LAND, (c) => Math.abs(rhTerm(k, c)))).padStart(6)}  RMSE ${f2(rmse(LAND, (c) => rhTerm(k, c)))}`);
  console.log(`    合計 (= q bias)          平均 ${f2(wm(LAND, (c) => qOf(k, c) - c.tQ)).padStart(7)}  RMSE ${f2(rmse(LAND, (c) => qOf(k, c) - c.tQ))}`);
}
{ // B alone: what changing ONLY the wind does, at the same temperature field
  const dq = (c) => qOf("newOracle", c) - qOf("newModel", c);
  console.log(`\n  B 風だけの寄与 (5.2固定, 現行風->oracle風): 平均 ${f2(wm(LAND, dq))}  平均|.| ${f2(wm(LAND, (c) => Math.abs(dq(c))))}  RMSE ${f2(rmse(LAND, dq))}`);
  const dT = (c) => qOf("newModel", c) - qOf("oldModel", c);
  const dTo = (c) => qOf("newOracle", c) - qOf("oldOracle", c);
  console.log(`  A 温度だけの寄与 (6.5->5.2): 現行風 平均 ${f2(wm(LAND, dT))} 平均|.| ${f2(wm(LAND, (c) => Math.abs(dT(c))))} / oracle風 平均 ${f2(wm(LAND, dTo))} 平均|.| ${f2(wm(LAND, (c) => Math.abs(dTo(c))))}`);
  console.log(`  C 残余 (oracle風でもなお残るRH誤差): 平均 ${f2(wm(LAND, (c) => rhTerm("newOracle", c)))} RMSE ${f2(rmse(LAND, (c) => rhTerm("newOracle", c)))}`);
}

console.log("\n=== 7. Teacher RH の健全性 (既知の Jensen 効果の再確認) ===");
{
  const over = LAND.filter((c) => c.tRH > 1);
  console.log(`  Teacher q / q_sat(平均T) > 1 の陸面積: ${((100 * ww(over)) / ww(LAND)).toFixed(1)}%  (既知: 35.6%)`);
  console.log(`  → Teacher RH 0.955 は物理的な相対湿度ではなく、月平均qを平均Tの飽和量で割った比。`);
  console.log(`     容量項Aは q_sat だけを使うので影響を受けないが、B+Cの分解はこの比を通る。`);
  const sane = LAND.filter((c) => c.tRH <= 1);
  console.log(`  RH<=1 のセルだけに限った場合: Teacher RH ${f3(wm(sane, (c) => c.tRH))}  model RH (5.2 oracle) ${f3(wm(sane, (c) => fieldC.newOracle.rh[c.i]))}  q bias ${f2(wm(sane, (c) => qOf("newOracle", c) - c.tQ))}`);
}
console.log("\n=== 8. 5.2 が湿度に与えた影響の総量 ===");
{
  const stat = (n, f) => console.log(`  ${n.padEnd(30)} 平均 ${f2(wm(LAND, f)).padStart(7)}  平均|.| ${f2(wm(LAND, (c) => Math.abs(f(c)))).padStart(6)}  最大 ${f2(Math.max(...LAND.map((c) => Math.abs(f(c))))).padStart(7)}`);
  stat("Δ気圧 hPa (陸)", (c) => fieldC.newOracle.P[c.i] - fieldC.oldOracle.P[c.i]);
  stat("Δq_sat g/kg (陸)", (c) => qsOf("newOracle", c) - qsOf("oldOracle", c));
  stat("Δq g/kg (oracle風)", (c) => qOf("newOracle", c) - qOf("oldOracle", c));
  stat("Δq g/kg (現行風)", (c) => qOf("newModel", c) - qOf("oldModel", c));
  const same = LAND.filter((c) => Math.abs(qOf("newModel", c) - qOf("oldModel", c)) < 0.01);
  console.log(`  |Δq| < 0.01 g/kg の陸面積 (現行風): ${((100 * ww(same)) / ww(LAND)).toFixed(1)}%`);
}
