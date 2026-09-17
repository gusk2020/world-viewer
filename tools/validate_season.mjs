// Climate v1's seasonal cycle: the validator.
//
// Nothing here is fitted and nothing is scored against a teacher -- the repo
// carries no seasonal temperature teacher (Berkeley Earth is committed as an
// annual mean only). What this checks is that the mechanism behaves the way
// the physics requires, and that Stage 2's annual field is untouched.
//
// The representative values quoted against the land/sea numbers are the ones
// the design pre-evaluation predicted, not targets to fit.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets, dailyMeanInsolationFactor } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField, latitudeOfRow } from "../js/climate-v1/temperature.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import {
  SEASONAL_TIME_AXIS, SEASON_PARAMETERS, SURFACE_LAND, SURFACE_SEA,
  buildSeasonalTemperatureTable, buildTemperatureFieldAtPhase, heatCapacityJPerM2K,
  sampleSeasonalAnomalyC, sampleTemperatureAtPhase, solvePeriodicResponse,
} from "../js/climate-v1/season.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai");
const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));

let failures = 0;
const ok = (cond, label, detail = "") => {
  if (!cond) failures++;
  console.log(`  ${cond ? "OK  " : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);

const ROWS = 512;
const YEAR_D = SEASON_PARAMETERS.yearLengthDays;
const table = buildSeasonalTemperatureTable({ rows: ROWS, body: config.body });
const rowOf = (deg) => Math.min(ROWS - 1, Math.max(0, Math.round(((90 - deg) / 180) * ROWS - 0.5)));

// One year of the anomaly at a row, at fine phase resolution.
const N = 720;
const series = (row, surface) => {
  const out = new Float64Array(N);
  for (let s = 0; s < N; s++) out[s] = sampleSeasonalAnomalyC(table, row, surface, s / N);
  return out;
};
const amp = (s) => (Math.max(...s) - Math.min(...s)) / 2;
const mean = (s) => s.reduce((a, b) => a + b, 0) / s.length;
const peakDay = (s) => (s.indexOf(Math.max(...s)) * YEAR_D) / s.length;
const SOLSTICE_N = 0.25 * YEAR_D;
const wrapDays = (d) => ((d % YEAR_D) + YEAR_D) % YEAR_D;

console.log("Climate v1 -- seasonal cycle validation\n");
console.log(`body: tilt ${config.body.axialTiltDegrees} deg, year ${YEAR_D} d, S0 ${table.solarConstantWPerM2} W/m2`);
console.log(`lambda ${table.dampingWPerM2K} W/m2/K   C_land ${table.heatCapacityJPerM2K.land.toExponential(2)} (tau ${f1(table.timescaleDays.land)} d)`
  + `   C_sea ${table.heatCapacityJPerM2K.sea.toExponential(2)} (tau ${f1(table.timescaleDays.sea)} d)\n`);

// --- 1. amplitude and lag by latitude ---------------------------------------
console.log("=== 1. seasonal anomaly by latitude (half-amplitude C / peak days after that hemisphere's solstice) ===");
console.log("  lat".padEnd(8) + ["land amp", "land lag", "sea amp", "sea lag", "sea/land", "sea-land"].map((h) => h.padStart(10)).join(""));
const byLat = new Map();
for (const deg of [0, 15, 30, 45, 60, 75, 85, -30, -45, -60]) {
  const r = rowOf(deg);
  const land = series(r, SURFACE_LAND), sea = series(r, SURFACE_SEA);
  const sol = deg >= 0 ? SOLSTICE_N : SOLSTICE_N + YEAR_D / 2;
  const row = {
    landAmp: amp(land), seaAmp: amp(sea),
    landLag: wrapDays(peakDay(land) - sol), seaLag: wrapDays(peakDay(sea) - sol),
    gap: wrapDays(peakDay(sea) - peakDay(land)),
  };
  byLat.set(deg, row);
  console.log(`  ${String(deg).padStart(4)}N`.padEnd(8) + [
    f1(row.landAmp), f1(row.landLag) + "d", f1(row.seaAmp), f1(row.seaLag) + "d",
    f2(row.seaAmp / row.landAmp), f1(row.gap) + "d",
  ].map((v) => v.padStart(10)).join(""));
}
console.log("  (design pre-evaluation: 45N land ~15 C / +25 d, 45N sea ~5 C, sea-land gap ~50 d)\n");

console.log("=== 2. the structural requirements ===");
{
  const n45 = byLat.get(45), n0 = byLat.get(0), n85 = byLat.get(85);
  ok(n45.landAmp > 12 && n45.landAmp < 18, "45N land half-amplitude near 15 C", f1(n45.landAmp));
  ok(n45.landLag > 18 && n45.landLag < 35, "45N land peak lags the solstice by ~25 d", f1(n45.landLag) + " d");
  ok(n45.seaAmp > 3.5 && n45.seaAmp < 6.5, "45N sea half-amplitude near 5 C", f1(n45.seaAmp));
  ok(n45.gap > 35 && n45.gap < 65, "45N sea peaks ~50 d after land", f1(n45.gap) + " d");

  let monotone = true;
  let prev = -Infinity;
  for (const deg of [0, 15, 30, 45, 60, 75, 85]) {
    const a = byLat.get(deg) ? byLat.get(deg).landAmp : amp(series(rowOf(deg), SURFACE_LAND));
    if (a < prev - 1e-9) monotone = false;
    prev = a;
  }
  ok(monotone, "land amplitude grows monotonically with latitude", `0N ${f1(n0.landAmp)} -> 85N ${f1(n85.landAmp)}`);
  ok(n0.landAmp < 2, "the equator's swing is small", f1(n0.landAmp) + " C");

  for (const deg of [30, 45, 60]) {
    const a = byLat.get(deg), b = byLat.get(-deg);
    ok(a.seaAmp < a.landAmp, `${deg}N sea swings less than land`, `${f1(a.seaAmp)} < ${f1(a.landAmp)}`);
    ok(Math.abs(a.landAmp - b.landAmp) < 0.5, `${deg}N and ${deg}S have the same land amplitude`,
      `${f1(a.landAmp)} vs ${f1(b.landAmp)}`);
  }
}

// hemispheric reversal, as a correlation
{
  const a = series(rowOf(45), SURFACE_LAND), b = series(rowOf(-45), SURFACE_LAND);
  let dot = 0, na = 0, nb = 0;
  for (let s = 0; s < N; s++) { dot += a[s] * b[s]; na += a[s] * a[s]; nb += b[s] * b[s]; }
  const corr = dot / Math.sqrt(na * nb);
  ok(corr < -0.98, "45N and 45S are in antiphase", `r = ${corr.toFixed(3)}`);
}

// the equator carries a semi-annual component
{
  const eq = series(rowOf(0), SURFACE_LAND);
  let peaks = 0;
  for (let s = 0; s < N; s++) {
    const a = eq[(s + N - 1) % N], b = eq[s], c = eq[(s + 1) % N];
    if (b > a && b >= c) peaks++;
  }
  const base = ((rowOf(0) * 2 + SURFACE_LAND) * table.harmonics) * 2;
  const h1 = Math.hypot(table.coefficients[base], table.coefficients[base + 1]);
  const h2 = Math.hypot(table.coefficients[base + 2], table.coefficients[base + 3]);
  ok(peaks === 2, "the equator has two maxima a year", `${peaks} maxima`);
  ok(h2 > h1, "and its semi-annual harmonic dominates the annual one", `${f2(h2)} vs ${f2(h1)} C`);
}

// --- 3. the annual mean ------------------------------------------------------
console.log("\n=== 3. the annual mean ===");
{
  let worst = 0;
  for (let y = 0; y < ROWS; y++) {
    for (const surface of [SURFACE_LAND, SURFACE_SEA]) worst = Math.max(worst, Math.abs(mean(series(y, surface))));
  }
  ok(worst < 1e-12, "the seasonal anomaly's annual mean is zero at every row", worst.toExponential(2) + " C");
}

// --- 4. polar night and midnight sun ----------------------------------------
console.log("\n=== 4. polar night, midnight sun, and obliquity ===");
{
  const lat85 = (85 * Math.PI) / 180;
  let dark = 0, midnightSun = 0;
  for (let s = 0; s < N; s++) {
    const dec = SEASONAL_TIME_AXIS.declinationRad(s / N, config.body.axialTiltDegrees);
    const v = dailyMeanInsolationFactor(lat85, dec);
    if (v <= 1e-12) dark++;
    const cosH = Math.min(1, Math.max(-1, -Math.tan(lat85) * Math.tan(dec)));
    if (cosH <= -1) midnightSun++;
  }
  const darkDays = (dark / N) * YEAR_D, sunDays = (midnightSun / N) * YEAR_D;
  ok(darkDays > 120 && darkDays < 190, "85N has a real polar night", f1(darkDays) + " d (real ~161)");
  ok(sunDays > 120 && sunDays < 190, "85N has a real midnight sun", f1(sunDays) + " d");
  ok(Math.abs(darkDays - sunDays) < 1, "and the two are the same length on a circular orbit", "");
}
{
  const amps = [];
  for (const tilt of [0, 10, 23.44, 40, 80]) {
    const t = buildSeasonalTemperatureTable({ rows: 180, body: { ...config.body, axialTiltDegrees: tilt } });
    let a = -Infinity, b = Infinity;
    for (let s = 0; s < N; s++) {
      const v = sampleSeasonalAnomalyC(t, Math.round(((90 - 60) / 180) * 180 - 0.5), SURFACE_LAND, s / N);
      a = Math.max(a, v); b = Math.min(b, v);
    }
    amps.push({ tilt, amp: (a - b) / 2 });
  }
  console.log("  60N land half-amplitude by obliquity: " + amps.map((r) => `${r.tilt} deg -> ${f2(r.amp)} C`).join(",  "));
  ok(amps[0].amp < 1e-6, "a world with no tilt has no season", amps[0].amp.toExponential(2) + " C");
  let growing = true;
  for (let i = 1; i < amps.length; i++) if (amps[i].amp <= amps[i - 1].amp) growing = false;
  ok(growing, "a more tilted world has a bigger season", "");
}

// --- 5. the harmonic truncation ---------------------------------------------
console.log("\n=== 5. the 4-harmonic truncation against a high-resolution reference ===");
{
  // The reference: the same solver kept to 64 harmonics, i.e. essentially the
  // exact periodic solution of the sampled forcing.
  const reference = (latDeg, surface) => {
    const latRad = (latDeg * Math.PI) / 180;
    const samples = 720;
    const forcing = new Float64Array(samples);
    let m = 0;
    for (let s = 0; s < samples; s++) {
      forcing[s] = dailyMeanInsolationFactor(latRad, SEASONAL_TIME_AXIS.declinationRad(s / samples, config.body.axialTiltDegrees));
      m += forcing[s];
    }
    m /= samples;
    for (let s = 0; s < samples; s++) {
      forcing[s] = SEASON_PARAMETERS.shortwaveAbsorbedFraction * table.solarConstantWPerM2 * (forcing[s] - m);
    }
    const { cos, sin } = solvePeriodicResponse({
      forcingWPerM2: forcing,
      heatCapacity: heatCapacityJPerM2K(surface),
      dampingWPerM2K: SEASON_PARAMETERS.seasonalDampingWPerM2K,
      yearSeconds: YEAR_D * 86400,
      harmonics: 64,
    });
    const out = new Float64Array(N);
    for (let s = 0; s < N; s++) {
      let v = 0;
      for (let n = 1; n <= 64; n++) {
        const th = (2 * Math.PI * n * s) / N;
        v += cos[n - 1] * Math.cos(th) + sin[n - 1] * Math.sin(th);
      }
      out[s] = v;
    }
    return out;
  };
  let worst = 0;
  for (const deg of [0, 30, 45, 60, 85, -85]) {
    for (const surface of [SURFACE_LAND, SURFACE_SEA]) {
      const ref = reference(latitudeOfRow(rowOf(deg), ROWS), surface);
      const got = series(rowOf(deg), surface);
      let e = 0;
      for (let s = 0; s < N; s++) e = Math.max(e, Math.abs(got[s] - ref[s]));
      if (surface === SURFACE_LAND) console.log(`  lat ${String(deg).padStart(4)}: land max error ${f2(e)} C, amplitude ${f1(amp(ref))} C`);
      worst = Math.max(worst, e);
    }
  }
  ok(worst < 0.8, "4 harmonics hold the response to well under 1 C", `worst ${f2(worst)} C`);
}

// --- 6. Stage 2 is untouched -------------------------------------------------
console.log("\n=== 6. Stage 2's annual field, and the whole grid at a phase ===");
{
  const levels = config.terrain.levels.filter((l) => l.width <= 2048);
  const level = levels.reduce((a, b) => (b.width > a.width ? b : a));
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
  const before = Float32Array.from(temperatureField.annualMeanTemperatureC);

  const phases = [0, 0.1, 0.25, 0.5, 0.75, 0.9];
  const fields = phases.map((p) => buildTemperatureFieldAtPhase({ temperatureField, terrainField, seasonTable: table, orbitalPhase: p }));
  let touched = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== temperatureField.annualMeanTemperatureC[i]) touched++;
  ok(touched === 0, "sampling a phase never writes to the annual field", `${touched} cells changed`);

  let bad = 0;
  for (const field of fields) for (let i = 0; i < field.length; i++) if (!Number.isFinite(field[i])) bad++;
  ok(bad === 0, "no NaN or Inf at any phase", `${bad} bad cells`);

  // the grid's own annual mean, cell by cell, over a full year
  const steps = 48;
  const sum = new Float64Array(before.length);
  for (let s = 0; s < steps; s++) {
    const field = buildTemperatureFieldAtPhase({ temperatureField, terrainField, seasonTable: table, orbitalPhase: s / steps });
    for (let i = 0; i < field.length; i++) sum[i] += field[i];
  }
  let worstCell = 0;
  for (let i = 0; i < sum.length; i++) worstCell = Math.max(worstCell, Math.abs(sum[i] / steps - before[i]));
  ok(worstCell < 5e-3, "averaging a year of phases returns Stage 2's own field", `worst cell ${worstCell.toExponential(2)} C`);

  // the sampler agrees with the whole-grid builder
  let worstSample = 0;
  for (let k = 0; k < 2000; k++) {
    const i = Math.floor((k / 2000) * before.length);
    const v = sampleTemperatureAtPhase({
      temperatureField, seasonTable: table, index: i, orbitalPhase: 0.25, isSea: Boolean(terrainField.isSea[i]),
    });
    worstSample = Math.max(worstSample, Math.abs(v - fields[2][i]));
  }
  ok(worstSample < 1e-4, "sampleTemperatureAtPhase matches buildTemperatureFieldAtPhase", worstSample.toExponential(2) + " C");

  // what a phase actually looks like on the real grid
  const jan = fields[0], jul = fields[2];
  let landSwing = 0, seaSwing = 0, landN = 0, seaN = 0;
  for (let y = 0; y < temperatureField.height; y++) {
    const lat = latitudeOfRow(y, temperatureField.height);
    if (lat < 35 || lat > 55) continue;
    for (let x = 0; x < temperatureField.width; x++) {
      const i = y * temperatureField.width + x;
      const d = Math.abs(jul[i] - jan[i]);
      if (terrainField.isSea[i]) { seaSwing += d; seaN++; } else { landSwing += d; landN++; }
    }
  }
  console.log(`  35-55N, equinox vs northern solstice: land ${f1(landSwing / landN)} C, sea ${f1(seaSwing / seaN)} C`);

  // Three representative points on the real grid: the phase UI shows the
  // whole globe, but these are the three cells whose behaviour the design
  // predicted, so they are worth reading off the drawn field directly.
  const cellAt = (lng, lat) => {
    const x = Math.min(temperatureField.width - 1, Math.floor(((lng + 180) / 360) * temperatureField.width));
    const y = Math.min(temperatureField.height - 1, Math.floor(((90 - lat) / 180) * temperatureField.height));
    return y * temperatureField.width + x;
  };
  const POINTS = [
    ["45N 陸 (仏)", 5, 45, false], ["45N 海 (北太平洋)", -150, 45, true], ["45S 陸 (チリ)", -71, -45, false],
  ];
  const STEPS = 96;
  console.log("  代表点:");
  for (const [label, lng, lat, wantSea] of POINTS) {
    const i = cellAt(lng, lat);
    const isSea = Boolean(terrainField.isSea[i]);
    let hi = -Infinity, lo = Infinity, hiPhase = 0;
    for (let s = 0; s < STEPS; s++) {
      const v = sampleTemperatureAtPhase({
        temperatureField, seasonTable: table, index: i, orbitalPhase: s / STEPS, isSea,
      });
      if (v > hi) { hi = v; hiPhase = s / STEPS; }
      if (v < lo) lo = v;
    }
    const sol = lat >= 0 ? 0.25 : 0.75;
    const lagDays = wrapDays(hiPhase * YEAR_D - sol * YEAR_D);
    console.log(`    ${label.padEnd(18)} ${isSea ? "海" : "陸"}  年平均 ${f1(temperatureField.annualMeanTemperatureC[i])} C`
      + `  最暖 ${f1(hi)} / 最寒 ${f1(lo)}  半振幅 ${f1((hi - lo) / 2)}  夏至から +${f1(lagDays)} d`);
    ok(isSea === wantSea, `${label} is ${wantSea ? "sea" : "land"} on this grid`, "");
  }
}

// --- 7. cost and size --------------------------------------------------------
console.log("\n=== 7. cost ===");
{
  const t0 = process.hrtime.bigint();
  const runs = 10;
  let t;
  for (let i = 0; i < runs; i++) t = buildSeasonalTemperatureTable({ rows: ROWS, body: config.body });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
  const t1 = process.hrtime.bigint();
  const samples = 200000;
  let acc = 0;
  for (let i = 0; i < samples; i++) acc += sampleSeasonalAnomalyC(table, i % ROWS, i & 1, (i % 97) / 97);
  const perSample = Number(process.hrtime.bigint() - t1) / samples;
  console.log(`  build ${ROWS} rows x 2 surfaces x ${table.harmonics} harmonics: ${ms.toFixed(0)} ms`);
  console.log(`  table size: ${(t.coefficients.byteLength / 1024).toFixed(0)} KB`);
  console.log(`  one anomaly sample: ${perSample.toFixed(0)} ns  (checksum ${acc.toFixed(3)})`);
  ok(t.coefficients.byteLength <= 40 * 1024, "the table fits in the size the design promised", `${(t.coefficients.byteLength / 1024).toFixed(0)} KB`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
