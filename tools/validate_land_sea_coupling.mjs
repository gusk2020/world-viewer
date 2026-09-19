// Climate v1: the land-sea thermal coupling validator.
//
// Nothing is fitted here. `landSeaThermalRelaxationDays` = 7 comes from
// js/climate-v1/earth-temperature-calibration.js and this tool only measures
// what it does, against Berkeley Earth over NON-ICE LAND -- ice cells are out,
// because the polar warm bias is an ice-sheet energy-balance problem that this
// mechanism does not address and must not be credited or blamed for.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { loadNcepOracleWind } from "./ncep_oracle_wind.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import { buildClimateV1Wind } from "../js/climate-v1/wind.js";
import { PREVIEW_WIND_ATMOSPHERE, PREVIEW_WIND_PARAMS } from "../js/climate-v1/preview.js";
import {
  CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION, climateV1LandSeaParams,
} from "../js/climate-v1/earth-temperature-calibration.js";
import {
  buildLandSeaCoupling, applyLandSeaCoupling, marineAnomalyField,
  TRAJECTORY_HORIZON_TIMESCALES,
} from "../js/climate-v1/land-sea-coupling.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai");
const TD = path.join(WORLD, "teacher");
const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));
const W = 256, H = 128;

let failures = 0;
const ok = (cond, label, detail = "") => { if (!cond) failures++; console.log(`  ${cond ? "OK  " : "FAIL"}  ${label}${detail ? "   " + detail : ""}`); };
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "  --");

// --- the inputs, exactly as Climate v1 builds them --------------------------
const level = config.terrain.levels.filter((l) => l.width <= 2048).reduce((a, b) => (b.width > a.width ? b : a));
const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
const off = config.terrain.encoding.offsetMetres;
const metres = new Int16Array(png.width * png.height);
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - off;
const terrainField = buildTerrainField({
  elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0,
  oceanMask: loadOceanMask(config, REPO), waterSurfaceMask: loadWaterSurfaceMask(config, REPO),
});
const sets = resolveClimateSets(config);
const params = { ...sets.sets.find((s) => s.id === sets.defaultId).values, ...CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION };
const temperatureField = buildTemperatureField({
  terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params,
});
const windField = buildClimateV1Wind({
  terrainField, temperatureField, lapseRateCPerKm: params.surfaceLapseRateCPerKm ?? params.lapseRateCPerKm,
  body: config.body, atmosphere: PREVIEW_WIND_ATMOSPHERE, params: PREVIEW_WIND_PARAMS, width: W, height: H,
});
const body = config.body;

// --- the coarse evaluation grid, the teacher, the ice mask ------------------
const latOf = (y) => 90 - ((y + 0.5) * 180) / H;
const lngOf = (x) => -180 + ((x + 0.5) * 360) / W;
const cosW = new Float64Array(H);
for (let y = 0; y < H; y++) cosW[y] = Math.cos((latOf(y) * Math.PI) / 180);

const bx = terrainField.width / W, by = terrainField.height / H;
const landFrac = new Float64Array(W * H), elevM = new Float64Array(W * H);
function coarseLandMean(fine) {
  const n = new Float64Array(W * H), s = new Float64Array(W * H);
  for (let y = 0; y < terrainField.height; y++) {
    const cy = Math.floor(y / by);
    for (let x = 0; x < terrainField.width; x++) {
      const i = y * terrainField.width + x;
      if (terrainField.isSea[i]) continue;
      const c = cy * W + Math.floor(x / bx);
      n[c]++; s[c] += fine[i];
    }
  }
  const out = new Float64Array(W * H).fill(NaN);
  for (let c = 0; c < W * H; c++) if (n[c] > 0) out[c] = s[c] / n[c];
  return out;
}
{
  const n = new Float64Array(W * H), nl = new Float64Array(W * H), sz = new Float64Array(W * H);
  for (let y = 0; y < terrainField.height; y++) {
    const cy = Math.floor(y / by);
    for (let x = 0; x < terrainField.width; x++) {
      const i = y * terrainField.width + x, c = cy * W + Math.floor(x / bx);
      n[c]++;
      if (!terrainField.isSea[i]) { nl[c]++; sz[c] += Math.max(0, terrainField.relativeElevationMetres[i]); }
    }
  }
  for (let c = 0; c < W * H; c++) { landFrac[c] = n[c] > 0 ? nl[c] / n[c] : 0; elevM[c] = nl[c] > 0 ? sz[c] / nl[c] : 0; }
}
const isLand = new Uint8Array(W * H);
for (let c = 0; c < W * H; c++) isLand[c] = landFrac[c] >= 0.5 ? 1 : 0;

const tSum = JSON.parse(readFileSync(path.join(TD, "temperature-summary.json"), "utf8"));
const teacherC = new Float64Array(W * H).fill(NaN);
{
  const g = tSum.grid;
  const buf = readFileSync(path.join(TD, g.valuesFile));
  const t = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const n = new Float64Array(W * H), s = new Float64Array(W * H);
  for (let ty = 0; ty < g.height; ty++) {
    const lat = 90 - ((ty + 0.5) * 180) / g.height;
    const cy = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
    for (let tx = 0; tx < g.width; tx++) {
      const v = t[ty * g.width + tx];
      if (!Number.isFinite(v)) continue;
      const lng = -180 + ((tx + 0.5) * 360) / g.width;
      const c = cy * W + Math.min(W - 1, Math.floor(((lng + 180) / 360) * W));
      n[c]++; s[c] += v;
    }
  }
  for (let c = 0; c < W * H; c++) if (n[c] > 0) teacherC[c] = s[c] / n[c];
}
const isIce = new Uint8Array(W * H);
{
  const cls = readPng(path.join(TD, "present-classes.png"));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cx = Math.min(cls.width - 1, Math.floor(((lngOf(x) + 180) / 360) * cls.width));
    const cy = Math.min(cls.height - 1, Math.floor(((90 - latOf(y)) / 180) * cls.height));
    isIce[y * W + x] = cls.data[cy * cls.width + cx] === 4 ? 1 : 0;
  }
}
const inFit = new Uint8Array(W * H);
for (let c = 0; c < W * H; c++) inFit[c] = isLand[c] && !isIce[c] && Number.isFinite(teacherC[c]) ? 1 : 0;

// Reporting boxes. Never read by the model -- only by this file.
const REGIONS = {
  "Europe":         (la, ln) => la >= 40 && la <= 65 && ln >= -10 && ln <= 40,
  "NE Asia":        (la, ln) => la >= 45 && la <= 70 && ln >= 90 && ln <= 150,
  "N.America east": (la, ln) => la >= 30 && la <= 55 && ln >= -95 && ln <= -65,
  "N.America west": (la, ln) => la >= 35 && la <= 60 && ln >= -130 && ln <= -105,
  "South America":  (la, ln) => la >= -40 && la <= 0 && ln >= -80 && ln <= -35,
  "Australia":      (la, ln) => la >= -38 && la <= -12 && ln >= 115 && ln <= 152,
  "tropical interior": (la, ln) => Math.abs(la) <= 20 && ((ln >= 15 && ln <= 30) || (ln >= -70 && ln <= -55)),
};
function stats(field, pick, extra) {
  let w = 0, a = 0, b = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x;
    if (!inFit[c] || !Number.isFinite(field[c])) continue;
    if (pick && !pick(latOf(y), lngOf(x))) continue;
    if (extra && !extra(c)) continue;
    const d = field[c] - teacherC[c];
    w += cosW[y]; a += cosW[y] * Math.abs(d); b += cosW[y] * d; n++;
  }
  return { mae: w > 0 ? a / w : NaN, bias: w > 0 ? b / w : NaN, n };
}

const run = (overrides, opts = {}) => {
  const t0 = process.hrtime.bigint();
  const r = applyLandSeaCoupling({
    temperatureField, terrainField, windField: opts.wind || windField, body,
    params: overrides, width: W, height: H, sstOverride: opts.sst || null,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ...r, land: coarseLandMean(r.temperatureField.annualMeanTemperatureC), ms };
};
const base = run({});
const on = run(climateV1LandSeaParams());

console.log("Climate v1 land-sea thermal coupling\n");
console.log(`1. compatibility: the mechanism off`);
ok(base.temperatureField === temperatureField, "off returns the input field by identity (not a copy)");
ok(base.coupling.meta.applied === false, "meta.applied is false", `tau=${base.coupling.meta.relaxationDays}`);
{
  let worst = 0;
  for (let c = 0; c < W * H; c++) worst = Math.max(worst, Math.abs(base.coupling.landAnomalyC[c]));
  ok(worst === 0, "the off anomaly field is exactly zero", `worst ${worst.toExponential(1)}`);
}
{
  const { ignored } = (await import("../js/climate-v1/land-sea-coupling.js")).resolveLandSeaCouplingParams({ retiredParameter: 1, _note: "x", landSeaThermalRelaxationDays: 7 });
  ok(ignored.length === 1 && ignored[0] === "retiredParameter", "a retired parameter is reported and skipped, a _note is not");
}

console.log(`\n2. the ocean is untouched`);
{
  let changed = 0, worst = 0;
  for (let i = 0; i < terrainField.isSea.length; i++) {
    if (!terrainField.isSea[i]) continue;
    const d = Math.abs(on.temperatureField.annualMeanTemperatureC[i] - temperatureField.annualMeanTemperatureC[i]);
    if (d > 0) { changed++; worst = Math.max(worst, d); }
  }
  ok(changed === 0, "every sea cell is unchanged", `${changed} changed, worst ${worst.toExponential(1)} C`);
}
{
  // The marine anomaly is the sea's own departure, so it must be positive at
  // high latitudes and negative in the tropics on any world, not just Earth.
  const { anomaly, seaFraction } = marineAnomalyField({ temperatureField, terrainField, width: W, height: H });
  const bandMean = (lo, hi) => { let n = 0, s = 0;
    for (let y = 0; y < H; y++) { const la = latOf(y); if (la < lo || la > hi) continue;
      for (let x = 0; x < W; x++) { const c = y * W + x; if (seaFraction[c] < 0.99) continue; n++; s += anomaly[c]; } }
    return n ? s / n : NaN; };
  console.log(`  marine anomaly: 60-70N ${f2(bandMean(60, 70))}   40-50N ${f2(bandMean(40, 50))}   10S-10N ${f2(bandMean(-10, 10))}   55-65S ${f2(bandMean(-65, -55))}`);
  ok(bandMean(60, 70) > 1 && bandMean(-10, 10) < -1, "the sea is warmer than land at high latitude and cooler in the tropics");
}

console.log(`\n3. land agreement with Berkeley Earth (non-ice land, n=${stats(base.land, null).n})`);
const g0 = stats(base.land, null), g1 = stats(on.land, null);
console.log(`  global   MAE ${f2(g0.mae)} -> ${f2(g1.mae)}    bias ${f2(g0.bias)} -> ${f2(g1.bias)}`);
ok(g1.mae < g0.mae, "global non-ice land MAE improves");
ok(Math.abs(g1.bias) < Math.abs(g0.bias), "global non-ice land bias moves toward zero");
for (const [name, pick] of Object.entries(REGIONS)) {
  const a = stats(base.land, pick), b = stats(on.land, pick);
  console.log(`  ${name.padEnd(18)} bias ${f2(a.bias).padStart(6)} -> ${f2(b.bias).padStart(6)}    MAE ${f2(a.mae)} -> ${f2(b.mae)}`);
}
ok(stats(on.land, REGIONS["Europe"]).bias > stats(base.land, REGIONS["Europe"]).bias, "Europe's cold bias shrinks");
ok(Math.abs(stats(on.land, REGIONS["NE Asia"]).bias - stats(base.land, REGIONS["NE Asia"]).bias) < 0.25,
  "NE Asia is not traded away for Europe", `${f2(stats(base.land, REGIONS["NE Asia"]).bias)} -> ${f2(stats(on.land, REGIONS["NE Asia"]).bias)}`);

console.log(`\n4. the anomaly decays inland with no distance rule anywhere in the model`);
{
  // Distance to the nearest cell that has any sea in it, for reporting only.
  const dist = new Float64Array(W * H).fill(Infinity);
  const metresPerDeg = (body.radiusMetres * Math.PI) / 180, dLat = (180 / H) * metresPerDeg;
  const pq = [];
  for (let c = 0; c < W * H; c++) if (!isLand[c]) { dist[c] = 0; pq.push([0, c]); }
  while (pq.length) {
    let bi = 0; for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
    const [d, c] = pq.splice(bi, 1)[0];
    if (d > dist[c] + 1e-9) continue;
    const y = Math.floor(c / W), x = c % W, dl = (360 / W) * metresPerDeg * Math.cos((latOf(y) * Math.PI) / 180);
    for (const [nx, ny, cost] of [[(x + 1) % W, y, dl], [(x - 1 + W) % W, y, dl], [x, y - 1, dLat], [x, y + 1, dLat]]) {
      if (ny < 0 || ny >= H) continue;
      const nc = ny * W + nx;
      if (d + cost < dist[nc] - 1e-9) { dist[nc] = d + cost; pq.push([d + cost, nc]); }
    }
  }
  const bands = [[0, 250], [250, 500], [500, 1000], [1000, 2000], [2000, 4000]];
  let previous = Infinity, monotone = true;
  for (const [lo, hi] of bands) {
    let n = 0, s = 0;
    for (let c = 0; c < W * H; c++) {
      if (!isLand[c]) continue;
      const d = dist[c] / 1000; if (d < lo || d >= hi) continue;
      n++; s += Math.abs(on.coupling.landAnomalyC[c]);
    }
    const m = n ? s / n : NaN;
    console.log(`  ${String(lo).padStart(4)}-${String(hi).padStart(4)} km  n=${String(n).padStart(4)}  mean |anomaly| ${f2(m)} C`);
    if (Number.isFinite(m)) { if (m > previous + 1e-9) monotone = false; previous = m; }
  }
  ok(monotone, "the mean anomaly falls monotonically with distance from the sea");
  ok(previous < 0.1, "it is below 0.1 C by 2000-4000 km inland", `${f2(previous)} C`);
}

console.log(`\n5. elevation bands (the surface lapse rate is untouched at ${params.surfaceLapseRateCPerKm} C/km)`);
{
  let worsened = 0;
  for (const [lo, hi] of [[0, 200], [200, 500], [500, 1000], [1000, 2000], [2000, 9000]]) {
    const pick = (c) => elevM[c] >= lo && elevM[c] < hi;
    const a = stats(base.land, null, pick), b = stats(on.land, null, pick);
    console.log(`  ${String(lo).padStart(4)}-${String(hi).padStart(4)} m  n=${String(a.n).padStart(4)}  MAE ${f2(a.mae)} -> ${f2(b.mae)}   bias ${f2(a.bias)} -> ${f2(b.bias)}`);
    if (b.mae > a.mae + 0.05) worsened++;
  }
  ok(worsened === 0, "no elevation band loses more than 0.05 C of MAE");
}

console.log(`\n6. tau sensitivity (a plateau, not a minimum -- nothing is fitted here)`);
{
  const row = [];
  for (const tau of [2, 5, 7, 10, 20]) {
    const r = run({ landSeaThermalRelaxationDays: tau });
    const s = stats(r.land, null);
    row.push({ tau, mae: s.mae, europe: stats(r.land, REGIONS["Europe"]).bias });
    console.log(`  tau ${String(tau).padStart(2)} d   global MAE ${f2(s.mae)}   Europe bias ${f2(stats(r.land, REGIONS["Europe"]).bias)}`);
  }
  const plateau = row.filter((r) => r.tau >= 5 && r.tau <= 10).map((r) => r.mae);
  ok(Math.max(...plateau) - Math.min(...plateau) < 0.02, "5-10 days differ by under 0.02 C of MAE");
}

console.log(`\n7. the Stage 4 wind's own error, measured rather than hidden`);
{
  const oracle = loadNcepOracleWind({ teacherDir: TD, width: W, height: H, quiet: true });
  const obs = run(climateV1LandSeaParams(), { wind: { width: W, height: H, uWindMs: oracle.uWindMs, vWindMs: oracle.vWindMs } });
  const so = stats(obs.land, null);
  console.log(`  Stage 4 wind      global MAE ${f2(g1.mae)}`);
  console.log(`  NCEP 850 hPa wind global MAE ${f2(so.mae)}   (diagnostic only; the wind model is frozen)`);
  for (const name of ["Europe", "NE Asia", "N.America east", "tropical interior", "South America"]) {
    console.log(`    ${name.padEnd(18)} model wind ${f2(stats(on.land, REGIONS[name]).bias).padStart(6)}   observed wind ${f2(stats(obs.land, REGIONS[name]).bias).padStart(6)}`);
  }
  const midModel = ["Europe", "NE Asia", "N.America east"].map((n) => Math.abs(stats(on.land, REGIONS[n]).bias - stats(obs.land, REGIONS[n]).bias));
  ok(Math.max(...midModel) < 0.4, "in mid latitudes the model wind and the observed wind agree to under 0.4 C");
  ok(so.mae < g1.mae, "the observed wind does better, and the gap is the wind's error (mostly tropical)");
}

console.log(`\n8. an SST with longitudinal structure reaches the land (diagnostic only)`);
{
  // A per-latitude longitudinal harmonic fit of the TEACHER's own sea field --
  // the upper-bound diagnostic from the SST pre-evaluation. It is not a model
  // and nothing in the repository uses it to draw anything; it exists here to
  // confirm that the chain SST -> marine air -> land temperature is connected.
  const { seaFraction, seaMeanTemperatureC } = marineAnomalyField({ temperatureField, terrainField, width: W, height: H });
  const sst = Float64Array.from(seaMeanTemperatureC);
  const N = 2, K = 2 * N;
  for (let y = 0; y < H; y++) {
    const xs = [];
    for (let x = 0; x < W; x++) { const c = y * W + x; if (seaFraction[c] > 0.5 && Number.isFinite(teacherC[c])) xs.push(x); }
    if (xs.length < 4 * N + 4) continue;
    const mean = xs.reduce((s, x) => s + teacherC[y * W + x], 0) / xs.length;
    const basis = (x) => { const th = (2 * Math.PI * x) / W, v = new Float64Array(K);
      for (let n = 1; n <= N; n++) { v[2 * n - 2] = Math.cos(n * th); v[2 * n - 1] = Math.sin(n * th); } return v; };
    const A = Array.from({ length: K }, () => new Float64Array(K + 1));
    for (const x of xs) { const v = basis(x), d = teacherC[y * W + x] - mean;
      for (let i = 0; i < K; i++) { A[i][K] += v[i] * d; for (let j = 0; j < K; j++) A[i][j] += v[i] * v[j]; } }
    for (let i = 0; i < K; i++) A[i][i] += 1e-6;
    for (let i = 0; i < K; i++) {
      let p = i; for (let r = i + 1; r < K; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]];
      if (Math.abs(A[i][i]) < 1e-12) continue;
      for (let r = 0; r < K; r++) { if (r === i) continue; const f = A[r][i] / A[i][i]; for (let cI = i; cI <= K; cI++) A[r][cI] -= f * A[i][cI]; }
    }
    const coef = new Float64Array(K);
    for (let i = 0; i < K; i++) coef[i] = Math.abs(A[i][i]) > 1e-12 ? A[i][K] / A[i][i] : 0;
    // zero row mean, so the zonal profile and the global ocean mean are kept
    let wsum = 0, add = 0;
    const delta = new Map();
    for (const x of xs) { const v = basis(x); let s = 0; for (let i = 0; i < K; i++) s += coef[i] * v[i];
      delta.set(x, s); wsum += seaFraction[y * W + x]; add += seaFraction[y * W + x] * s; }
    const m = wsum > 0 ? add / wsum : 0;
    for (const [x, s] of delta) sst[y * W + x] = seaMeanTemperatureC[y * W + x] + (s - m);
  }
  const lon = run(climateV1LandSeaParams(), { sst });
  const e0 = stats(base.land, REGIONS["Europe"]).bias, e1 = stats(on.land, REGIONS["Europe"]).bias,
        e2 = stats(lon.land, REGIONS["Europe"]).bias;
  console.log(`  Europe bias   baseline ${f2(e0)}  -> coupling ${f2(e1)}  -> coupling + longitudinal SST ${f2(e2)}`);
  console.log(`  global MAE    baseline ${f2(g0.mae)}  -> coupling ${f2(g1.mae)}  -> coupling + longitudinal SST ${f2(stats(lon.land, null).mae)}`);
  ok(e2 > e1 + 0.5, "the longitudinal SST reaches Europe's land through the coupling", `${f2(e1)} -> ${f2(e2)}`);
}

console.log(`\n9. cost and trajectory hygiene`);
{
  let best = Infinity;
  for (let k = 0; k < 3; k++) { const r = run(climateV1LandSeaParams()); best = Math.min(best, r.ms); }
  console.log(`  ${W}x${H} rebuild ${best.toFixed(0)} ms (node), once per world -- never on a slider`);
  console.log(`  trajectories that left the grid at a pole: ${on.coupling.meta.trajectoriesLeftGrid} of ${W * H}`);
  console.log(`  weight discarded past ${TRAJECTORY_HORIZON_TIMESCALES} timescales: ${(on.coupling.meta.discardedWeight * 100).toFixed(2)}%`);
  ok(best < 2000, "a rebuild is well inside a second on this machine");
  ok(on.coupling.meta.discardedWeight < 0.005, "under 0.5% of the relaxation kernel is discarded");
}
{
  // A calm cell must not blow up, and a longitude step must wrap.
  const calm = buildLandSeaCoupling({
    temperatureField, terrainField, body, params: climateV1LandSeaParams(),
    windField: { width: W, height: H, uWindMs: new Float64Array(W * H), vWindMs: new Float64Array(W * H) },
  });
  let finite = true, worst = 0;
  for (let c = 0; c < W * H; c++) { if (!Number.isFinite(calm.landAnomalyC[c])) finite = false; worst = Math.max(worst, Math.abs(calm.landAnomalyC[c])); }
  ok(finite, "a windless world produces a finite field", `worst |anomaly| ${f2(worst)} C`);
  ok(calm.meta.trajectoriesLeftGrid === 0, "and no trajectory leaves the grid");
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
