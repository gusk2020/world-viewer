// Climate v1: the seasonal temperature validator.
//
// The first thing in this project to read the monthly Berkeley Earth teacher
// (worlds/kasoku-sekai/teacher/temperature-monthly-mean-c.bin, 12x180x360).
// It measures what the CURRENT seasonal parameters already get right and by
// how much they are wrong. **Nothing here is fitted.** No parameter is
// searched, no value is written back, and no physics file is touched -- this
// exists so that the three-parameter calibration that comes next starts from
// a measurement instead of a guess.
//
// Four design decisions worth reading before the numbers:
//
// 1. **A calendar month is an interval, not an instant.** Berkeley Earth's
//    value for July is the mean over July, so the model is averaged over the
//    same interval rather than sampled at its midpoint. The month lengths are
//    the real Gregorian ones, so July gets 31 days of weight and February
//    28.2425. The midpoint approximation is measured too, and reported.
//
// 2. **The calendar lives here and nowhere else.** The model's clock is
//    `orbitalPhase`, whose 0 is the ascending equinox on any world. This file
//    holds the one number that ties that to Earth's calendar (the March
//    equinox's day of year) and converts; `js/climate-v1/season.js` still
//    knows nothing about months, and must not.
//
// 3. **Earth's real orbit is used for calibration, and only here.** e = 0.0167
//    and a periapsis longitude of 283 degrees are supplied explicitly to the
//    season table, because fitting a real Earth to a circular-orbit model
//    would push the hemispheric asymmetry that the periapsis direction really
//    causes into `seasonalDampingWPerM2K` or a heat capacity -- a compensating
//    error of exactly the kind docs/climate-v1-calibration-audit.md exists to
//    prevent. **The world's config is NOT changed** (it still carries the
//    circular default), and this file asserts that.
//
// 4. **The seasonal anomaly is separated from the annual mean.** Stage 2's
//    annual field has its own known biases, and they are closed. Each side's
//    own twelve-month mean is removed before anything seasonal is compared,
//    so a seasonal parameter can never be asked to absorb an annual error.
//    The absolute monthly error is reported as well, clearly separated.
//
// Usage: node tools/validate_seasonal_temperature.mjs [--json]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField, sampleTerrainAt } from "../js/climate-v1/terrain.js";
import { buildTemperatureField, sampleTemperatureAt } from "../js/climate-v1/temperature.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import {
  SEASON_PARAMETERS, SURFACE_LAND, SURFACE_SEA,
  buildSeasonalTemperatureTable, harmonicsForEccentricity, dampingWPerM2KForSurface,
} from "../js/climate-v1/season.js";
import {
  EARTH_CALIBRATION_ORBIT, MARCH_EQUINOX_DAY_OF_YEAR, MONTH_NAMES, MONTH_DAYS,
  monthIntervals as buildMonthIntervals, monthMeanWeights, modelMonthAnomalies,
  buildHarmonicOperator, harmonicsOf, wrapPhase, calendarHelpers,
} from "./seasonal_calendar.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai");
const TD = path.join(WORLD, "teacher");
const asJson = process.argv.slice(2).includes("--json");

// ---------------------------------------------------------------------------
// 1. Earth's real orbit, the calendar constant and the month lengths all live
// in tools/seasonal_calendar.mjs, shared with the grid search so the two
// cannot drift apart. Read that file for why each is what it is.

// ---------------------------------------------------------------------------
const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));
const YEAR_D = Number.isFinite(config.body.yearLengthDays)
  ? config.body.yearLengthDays : SEASON_PARAMETERS.yearLengthDays;

let failures = 0;
const out = [];
const say = (s = "") => { out.push(s); if (!asJson) console.log(s); };
const ok = (cond, label, detail = "") => {
  if (!cond) failures++;
  say(`  ${cond ? "OK  " : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "  --");
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "  --");
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "  --");
const pad = (v, n = 9) => String(v).padStart(n);

// ---------------------------------------------------------------------------
// 2. Month intervals on the model's own [0,1) phase axis. Phase 0 is the
// ascending equinox, so a day of year maps to a phase by subtracting the
// equinox's own day and dividing by the year.
const monthIntervals = (equinoxDay = MARCH_EQUINOX_DAY_OF_YEAR) => buildMonthIntervals(YEAR_D, equinoxDay);
const MONTHS = monthIntervals();

// ---------------------------------------------------------------------------
// 3. The season table, at Earth's real orbit.
const ROWS = 512;
const calibrationBody = { ...config.body, ...EARTH_CALIBRATION_ORBIT };
const table = buildSeasonalTemperatureTable({ rows: ROWS, body: calibrationBody });

// The month mean of the seasonal anomaly, per (row, surface).
//
// Two routes, deliberately: a fine equal-time sampling of the year with each
// sample assigned to the month its day falls in (what the brief asks for, and
// what a validator with no closed form would have to do), and the exact
// analytic integral of each harmonic over each month's interval. The gap
// between them is what says whether the sampling is fine enough -- measured,
// not assumed.
const PHASE_SAMPLES = 3652; // ~10 per day
function monthMeansBySampling(samples = PHASE_SAMPLES) {
  const H = table.harmonics;
  // Precompute the basis once; the inner loop is then multiply-add only.
  const cosT = new Float64Array(samples * H);
  const sinT = new Float64Array(samples * H);
  const monthOf = new Int8Array(samples);
  const counts = new Float64Array(12);
  const bounds = MONTHS.map((mi) => mi);
  for (let s = 0; s < samples; s++) {
    const phase = (s + 0.5) / samples;              // [0,1), equal in TIME
    for (let n = 1; n <= H; n++) {
      const th = 2 * Math.PI * n * phase;
      cosT[s * H + n - 1] = Math.cos(th);
      sinT[s * H + n - 1] = Math.sin(th);
    }
    // Which calendar month this phase falls in. Phase 0 is the equinox, so
    // the day of year is equinoxDay + phase*year, folded into the year.
    const day = ((MARCH_EQUINOX_DAY_OF_YEAR + phase * YEAR_D) % YEAR_D + YEAR_D) % YEAR_D;
    let m = 0, acc = 0;
    for (; m < 12; m++) { acc += MONTH_DAYS[m]; if (day < acc) break; }
    monthOf[s] = Math.min(11, m);
    counts[monthOf[s]] += 1;
  }
  void bounds;
  const means = new Float64Array(ROWS * 2 * 12);
  for (let y = 0; y < ROWS; y++) {
    for (let surface = 0; surface < 2; surface++) {
      const base = ((y * 2 + surface) * H) * 2;
      const acc = new Float64Array(12);
      for (let s = 0; s < samples; s++) {
        let v = 0;
        for (let n = 0; n < H; n++) {
          v += table.coefficients[base + n * 2] * cosT[s * H + n]
             + table.coefficients[base + n * 2 + 1] * sinT[s * H + n];
        }
        acc[monthOf[s]] += v;
      }
      for (let m = 0; m < 12; m++) means[(y * 2 + surface) * 12 + m] = acc[m] / counts[m];
    }
  }
  return { means, counts };
}

// The exact mean of each harmonic over each month's interval, from the shared
// module -- this is what every number below is built on.
function monthMeansAnalytic() {
  return modelMonthAnomalies(table, MONTHS);
}

// The midpoint approximation the brief asks to measure against.
function monthMeansMidpoint() {
  const H = table.harmonics;
  const means = new Float64Array(ROWS * 2 * 12);
  for (let y = 0; y < ROWS; y++) {
    for (let surface = 0; surface < 2; surface++) {
      const base = ((y * 2 + surface) * H) * 2;
      for (let m = 0; m < 12; m++) {
        const p = MONTHS[m].centrePhase;
        let v = 0;
        for (let n = 1; n <= H; n++) {
          const th = 2 * Math.PI * n * p;
          v += table.coefficients[base + (n - 1) * 2] * Math.cos(th)
             + table.coefficients[base + (n - 1) * 2 + 1] * Math.sin(th);
        }
        means[(y * 2 + surface) * 12 + m] = v;
      }
    }
  }
  return means;
}

// ---------------------------------------------------------------------------
// 4. Harmonic analysis of a twelve-value series.
//
// Least squares at the months' OWN centre phases rather than at twelve
// equally spaced points, because the months are not equally spaced. The same
// operator is applied to the teacher and to the model, so nothing in the
// comparison depends on this choice being the only defensible one.
const HARM_P = buildHarmonicOperator(MONTHS.map((m) => m.centreWrapped));

const harmonics = (series) => harmonicsOf(HARM_P, series);

// Circular helpers, all in days, from the shared module.
const { phaseToDays, phaseToDayOfYear, dayOfYearLabel } = calendarHelpers(YEAR_D);

// ---------------------------------------------------------------------------
// 5. The model's annual field (Stage 2, current parameters, untouched).
function loadElevation() {
  const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
  const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
  const off = config.terrain.encoding.offsetMetres;
  const metres = new Int16Array(png.width * png.height);
  for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - off;
  return { width: png.width, height: png.height, metres };
}
const sets = resolveClimateSets(config);
const params = { ...sets.sets.find((s) => s.id === sets.defaultId).values, ...CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION };
const terrainField = buildTerrainField({
  elevationGrid: loadElevation(), seaLevelMetres: 0,
  oceanMask: loadOceanMask(config, REPO), waterSurfaceMask: loadWaterSurfaceMask(config, REPO),
});
const temperatureField = buildTemperatureField({
  terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params,
});

// ---------------------------------------------------------------------------
// 6. The teachers.
const monthlySummary = JSON.parse(readFileSync(path.join(TD, "temperature-monthly-summary.json"), "utf8"));
const annualSummary = JSON.parse(readFileSync(path.join(TD, "temperature-summary.json"), "utf8"));
const TW = monthlySummary.grid.width, TH = monthlySummary.grid.height;
const monthlyBytes = readFileSync(path.join(TD, monthlySummary.grid.valuesFile));
const teacherMonthly = new Float32Array(
  monthlyBytes.buffer.slice(monthlyBytes.byteOffset, monthlyBytes.byteOffset + monthlyBytes.byteLength));
const annualBytes = readFileSync(path.join(TD, annualSummary.grid.valuesFile));
const teacherAnnual = new Float32Array(
  annualBytes.buffer.slice(annualBytes.byteOffset, annualBytes.byteOffset + annualBytes.byteLength));
const classes = readPng(path.join(TD, "present-classes.png"));

say("Climate v1 -- seasonal temperature validation (Berkeley Earth monthly)\n");
say(`teacher: ${monthlySummary.grid.shape.join("x")} ${monthlySummary.grid.dtype}, `
  + `${monthlySummary.climatology.referencePeriod}, ${monthlySummary.source.product}`);
say(`model:   Stage 2 annual ${temperatureField.width}x${temperatureField.height} + season table ${ROWS} rows, `
  + `${table.harmonics} harmonics`);
say(`orbit (validator only): tilt ${EARTH_CALIBRATION_ORBIT.axialTiltDegrees} deg, `
  + `e ${EARTH_CALIBRATION_ORBIT.orbitalEccentricity}, periapsis ${EARTH_CALIBRATION_ORBIT.periapsisLongitudeDeg} deg, `
  + `year ${YEAR_D} d`);
say(`season parameters (unchanged): lambda ${SEASON_PARAMETERS.seasonalDampingWPerM2K} W/m2/K, `
  + `soil ${SEASON_PARAMETERS.soilDepthM} m, mixed layer ${SEASON_PARAMETERS.mixedLayerDepthM} m, `
  + `absorbed ${SEASON_PARAMETERS.shortwaveAbsorbedFraction}`);
say("");

// --- 0. the world config is NOT changed --------------------------------------
say("=== 0. the world's config still carries the circular orbit ===");
ok(!Number.isFinite(config.body.orbitalEccentricity) || config.body.orbitalEccentricity === 0,
  "config.body.orbitalEccentricity is absent or 0",
  `is ${config.body.orbitalEccentricity ?? "absent"}`);
ok(!Number.isFinite(config.body.periapsisLongitudeDeg) || config.body.periapsisLongitudeDeg === 0,
  "config.body.periapsisLongitudeDeg is absent or 0",
  `is ${config.body.periapsisLongitudeDeg ?? "absent"}`);
ok(table.orbitalEccentricity === EARTH_CALIBRATION_ORBIT.orbitalEccentricity,
  "the calibration table really used e = 0.0167", `table says ${table.orbitalEccentricity}`);
ok(table.harmonics === harmonicsForEccentricity(EARTH_CALIBRATION_ORBIT.orbitalEccentricity),
  "harmonic count derived from e", `${table.harmonics}`);
say("");

// --- 1. the calendar mapping -------------------------------------------------
say("=== 1. calendar month <-> orbitalPhase ===");
say(`  phase 0 = ascending (March) equinox = day of year ${MARCH_EQUINOX_DAY_OF_YEAR} (March 20.35 UTC, 1991-2020 mean)`);
say("  month    days   start phase   end phase   centre phase   centre day-of-year");
for (const m of MONTHS) {
  say(`  ${m.name}   ${pad(f2(m.days), 6)}   ${pad(f4(m.startPhase), 11)} ${pad(f4(m.endPhase), 11)}`
    + `   ${pad(f4(m.centreWrapped), 12)}   ${pad(dayOfYearLabel(phaseToDayOfYear(m.centreWrapped)), 18)}`);
}
function f4(v) { return v.toFixed(4); }
say("");

const analytic = monthMeansAnalytic();
const midpoint = monthMeansMidpoint();
let maxMidGap = 0;
for (let i = 0; i < analytic.length; i++) maxMidGap = Math.max(maxMidGap, Math.abs(midpoint[i] - analytic[i]));

say("=== 2. month-mean integration ===");
say("  the brief's route is a fine equal-time sampling of the year with each sample assigned to the");
say("  month its day falls in. Its only error is that a month boundary falls between two samples, so");
say("  it is measured against the EXACT integral of each harmonic over each month's own interval");
say("  rather than against a threshold picked by hand -- and the exact one is then what gets used.");
say("  " + "samples/year".padEnd(16) + pad("hours apart", 13) + pad("max |diff| C", 15));
const convergence = [];
let maxSampleGap = 0;
for (const n of [365, 1461, 3652, 14608]) {
  const s2 = monthMeansBySampling(n);
  let gap = 0;
  for (let i = 0; i < analytic.length; i++) gap = Math.max(gap, Math.abs(s2.means[i] - analytic[i]));
  convergence.push({ samples: n, maxGapC: gap });
  if (n === PHASE_SAMPLES) maxSampleGap = gap;
  say("  " + String(n).padEnd(16) + pad((YEAR_D / n * 24).toFixed(2), 13) + pad(gap.toExponential(2), 15));
}
ok(convergence.every((c, i) => i === 0 || c.maxGapC < convergence[i - 1].maxGapC),
  "the sampled month mean converges on the exact integral as the sampling is refined");
ok(convergence[convergence.length - 1].maxGapC < convergence[0].maxGapC / 10,
  "and by more than a factor of ten across the range tried",
  `${convergence[0].maxGapC.toExponential(1)} -> ${convergence[convergence.length - 1].maxGapC.toExponential(1)} C`);
say(`  -> the EXACT integral is used everywhere below, so the month mean carries no sampling error at all.`);
say(`  midpoint single-point approximation vs the true month mean: max |diff| ${f3(maxMidGap)} C`);
say(`  (that is the error the brief asked to measure; it is large enough that the interval mean is worth it)`);
say("");
// The exact integral is what gets used: it has no sampling error at all and
// the check above is what earns the right to say so.
const MODEL_MONTH_ANOMALY = analytic;

// --- 3. the sample set -------------------------------------------------------
// One sample per teacher cell centre, the same correspondence
// tools/validate_temperature_v1.mjs already uses: the teacher's 1-degree grid
// is much coarser than the model's, so the model is point-sampled (nearest
// cell, no interpolation) at each teacher cell's own centre. Teacher NaN
// cells are dropped, never filled.
const seriesT = new Float64Array(12), seriesM = new Float64Array(12);
const cells = [];
let teacherMissing = 0;
for (let y = 0; y < TH; y++) {
  const lat = 90 - (y + 0.5) * (180 / TH);
  const tableRow = Math.min(ROWS - 1, Math.max(0, Math.floor(((90 - lat) / 180) * ROWS)));
  for (let x = 0; x < TW; x++) {
    const lng = -180 + (x + 0.5) * (360 / TW);
    const i = y * TW + x;
    let missing = false;
    for (let m = 0; m < 12; m++) {
      const v = teacherMonthly[m * TW * TH + i];
      if (!Number.isFinite(v)) { missing = true; break; }
      seriesT[m] = v;
    }
    if (missing) { teacherMissing++; continue; }
    const terrain = sampleTerrainAt(terrainField, lng, lat);
    const surface = terrain.isSea ? SURFACE_SEA : SURFACE_LAND;
    const annualModel = sampleTemperatureAt(temperatureField, lng, lat);
    const rs = (tableRow * 2 + surface) * 12;
    let meanT = 0, meanM = 0;
    for (let m = 0; m < 12; m++) {
      seriesM[m] = annualModel + MODEL_MONTH_ANOMALY[rs + m];
      meanT += seriesT[m]; meanM += seriesM[m];
    }
    meanT /= 12; meanM /= 12;
    const anomT = new Float64Array(12), anomM = new Float64Array(12);
    for (let m = 0; m < 12; m++) { anomT[m] = seriesT[m] - meanT; anomM[m] = seriesM[m] - meanM; }
    const cx = Math.min(classes.width - 1, Math.floor(((lng + 180) / 360) * classes.width));
    const cy = Math.min(classes.height - 1, Math.floor(((90 - lat) / 180) * classes.height));
    const cls = classes.data[cy * classes.width + cx];
    cells.push({
      x, y, i, lng, lat, tableRow, rs, isSea: terrain.isSea,
      weight: Math.cos((lat * Math.PI) / 180),
      teacherAnnual: teacherAnnual[i], teacherMean12: meanT, modelAnnual: annualModel, modelMean12: meanM,
      t: harmonics(anomT), m: harmonics(anomM),
      absBias: meanM - meanT,
      monthlyAbsMae: (() => { let s = 0; for (let k = 0; k < 12; k++) s += Math.abs(seriesM[k] - seriesT[k]); return s / 12; })(),
      anomMae: (() => { let s = 0; for (let k = 0; k < 12; k++) s += Math.abs(anomM[k] - anomT[k]); return s / 12; })(),
      anomRmse: (() => { let s = 0; for (let k = 0; k < 12; k++) s += (anomM[k] - anomT[k]) ** 2; return Math.sqrt(s / 12); })(),
      ice: cls === 4 || cls === 1,
      seriesT: Float64Array.from(seriesT), seriesM: Float64Array.from(seriesM),
    });
  }
}
say(`=== 3. sample set ===`);
say(`  ${cells.length} teacher cells used, ${teacherMissing} dropped for a missing month (no interpolation, no fill)`);
say(`  land ${cells.filter((c) => !c.isSea).length}   ocean ${cells.filter((c) => c.isSea).length}   (existing terrain/sea mask, no new classification)`);
say("");

// ---------------------------------------------------------------------------
// Weighted and circular statistics.
const wmean = (rows, f) => {
  let sw = 0, s = 0;
  for (const r of rows) { const v = f(r); if (!Number.isFinite(v)) continue; sw += r.weight; s += r.weight * v; }
  return sw > 0 ? s / sw : NaN;
};
// Phase is meaningless where there is no cycle to have a phase, so phase
// statistics are taken only where the TEACHER's own first harmonic clears
// this. Reported rather than hidden: the coverage is printed beside them.
const PHASE_AMPLITUDE_FLOOR_C = 1.0;
const phaseRows = (rows) => rows.filter((r) => r.t.h1 >= PHASE_AMPLITUDE_FLOOR_C);
function circularStats(rows) {
  const use = phaseRows(rows);
  if (use.length === 0) return { n: 0, biasDays: NaN, maeDays: NaN, coverage: 0, resultant: NaN };
  let sw = 0, sx = 0, sy = 0, sa = 0;
  for (const r of use) {
    const d = wrapPhase(r.m.p1 - r.t.p1);
    sw += r.weight;
    sx += r.weight * Math.cos(2 * Math.PI * d);
    sy += r.weight * Math.sin(2 * Math.PI * d);
    sa += r.weight * Math.abs(phaseToDays(d));
  }
  return {
    n: use.length,
    biasDays: phaseToDays(Math.atan2(sy, sx) / (2 * Math.PI)),
    maeDays: sa / sw,
    resultant: Math.hypot(sx, sy) / sw,
    coverage: use.length / Math.max(1, rows.length),
  };
}
function ampStats(rows) {
  return {
    n: rows.length,
    teacher: wmean(rows, (r) => r.t.h1),
    model: wmean(rows, (r) => r.m.h1),
    bias: wmean(rows, (r) => r.m.h1 - r.t.h1),
    mae: wmean(rows, (r) => Math.abs(r.m.h1 - r.t.h1)),
    rmse: Math.sqrt(wmean(rows, (r) => (r.m.h1 - r.t.h1) ** 2)),
    ratio: wmean(rows, (r) => r.m.h1) / wmean(rows, (r) => r.t.h1),
  };
}
function report(label, rows) {
  if (rows.length === 0) { say(`  ${label.padEnd(26)} (no cells)`); return null; }
  const a = ampStats(rows), p = circularStats(rows);
  say(`  ${label.padEnd(26)}${pad(rows.length, 7)}${pad(f2(a.teacher), 9)}${pad(f2(a.model), 9)}`
    + `${pad(f2(a.bias), 9)}${pad(f2(a.mae), 8)}${pad(f1(p.biasDays), 10)}${pad(f1(p.maeDays), 9)}`
    + `${pad((p.coverage * 100).toFixed(0) + "%", 7)}`);
  return { label, ...a, phase: p };
}
const HEAD = "  " + "group".padEnd(26) + pad("n", 7) + pad("T amp", 9) + pad("M amp", 9)
  + pad("amp bias", 9) + pad("amp MAE", 8) + pad("ph bias", 10) + pad("ph MAE", 9) + pad("cover", 7);

const land = cells.filter((c) => !c.isSea);
const ocean = cells.filter((c) => c.isSea);

// --- 4. headline -------------------------------------------------------------
say("=== 4. first-harmonic amplitude (half-amplitude, C) and phase (days, model - teacher) ===");
say("  amplitude bias > 0 = the model's seasonal swing is too large; phase bias > 0 = the model peaks late");
say(`  phase statistics use only cells where the teacher's own H1 >= ${PHASE_AMPLITUDE_FLOOR_C} C ("cover")`);
say(HEAD);
const headline = {
  all: report("all", cells),
  land: report("land", land),
  ocean: report("ocean", ocean),
};
say("");

// --- 5. latitude bands x hemisphere x surface --------------------------------
say("=== 5. by latitude band, hemisphere and surface ===");
say(HEAD);
const bands = [[0, 30], [30, 60], [60, 90]];
const byBand = [];
for (const [lo, hi] of bands) {
  for (const hemi of ["NH", "SH"]) {
    for (const [sLabel, filter] of [["land", (c) => !c.isSea], ["ocean", (c) => c.isSea]]) {
      const rows = cells.filter((c) => {
        const a = Math.abs(c.lat);
        return a >= lo && a < hi && (hemi === "NH" ? c.lat >= 0 : c.lat < 0) && filter(c);
      });
      const r = report(`${lo}-${hi} ${hemi} ${sLabel}`, rows);
      if (r) byBand.push(r);
    }
  }
}
say("");

// --- 6. the tropics: the second harmonic -------------------------------------
say("=== 6. tropics: the second (semi-annual) harmonic ===");
say("  " + "group".padEnd(22) + pad("n", 7) + pad("T H1", 8) + pad("M H1", 8) + pad("T H2", 8) + pad("M H2", 8)
  + pad("T H2/H1", 9) + pad("M H2/H1", 9) + pad("T ph2", 8) + pad("M ph2", 8));
const h2Rows = [];
for (const [label, rows] of [
  ["0-30 land", cells.filter((c) => Math.abs(c.lat) < 30 && !c.isSea)],
  ["0-30 ocean", cells.filter((c) => Math.abs(c.lat) < 30 && c.isSea)],
  ["0-10 land", cells.filter((c) => Math.abs(c.lat) < 10 && !c.isSea)],
  ["0-10 ocean", cells.filter((c) => Math.abs(c.lat) < 10 && c.isSea)],
  ["30-60 land", cells.filter((c) => Math.abs(c.lat) >= 30 && Math.abs(c.lat) < 60 && !c.isSea)],
]) {
  if (rows.length === 0) continue;
  const r = {
    label, n: rows.length,
    th1: wmean(rows, (c) => c.t.h1), mh1: wmean(rows, (c) => c.m.h1),
    th2: wmean(rows, (c) => c.t.h2), mh2: wmean(rows, (c) => c.m.h2),
    tRatio: wmean(rows, (c) => c.t.ratio), mRatio: wmean(rows, (c) => c.m.ratio),
    tPh2: wmean(rows, (c) => phaseToDays(c.t.p2)), mPh2: wmean(rows, (c) => phaseToDays(c.m.p2)),
  };
  h2Rows.push(r);
  say("  " + label.padEnd(22) + pad(r.n, 7) + pad(f2(r.th1), 8) + pad(f2(r.mh1), 8) + pad(f2(r.th2), 8)
    + pad(f2(r.mh2), 8) + pad(f3(r.tRatio), 9) + pad(f3(r.mRatio), 9)
    + pad(f1(r.tPh2) + "d", 8) + pad(f1(r.mPh2) + "d", 8));
}
say("  (ph2 = days after the March equinox of the semi-annual peak, defined modulo half a year)");
say("");

// --- 7. representative points ------------------------------------------------
say("=== 7. representative points (the monthly teacher's own sanity-check points) ===");
const POINTS = [
  ["45N land (France)", 5.0, 45.5],
  ["45N ocean (N Pacific)", -170.0, 45.5],
  ["equatorial land (Congo)", 20.0, 0.5],
  ["60N land (Siberia)", 100.0, 60.5],
  ["45S land (Chile)", -71.0, -45.5],
];
const pointRows = [];
for (const [label, lng, lat] of POINTS) {
  const x = Math.min(TW - 1, Math.max(0, Math.floor(((lng + 180) / 360) * TW)));
  const y = Math.min(TH - 1, Math.max(0, Math.floor(((90 - lat) / 180) * TH)));
  const c = cells.find((k) => k.x === x && k.y === y);
  if (!c) { say(`  ${label}: no usable cell`); continue; }
  const peakMonth = (s) => MONTH_NAMES[s.indexOf(Math.max(...s))];
  const half = (s) => (Math.max(...s) - Math.min(...s)) / 2;
  const dPhase = phaseToDays(wrapPhase(c.m.p1 - c.t.p1));
  say(`  ${label}  (${c.isSea ? "model says ocean" : "model says land"})`);
  say(`    teacher  min ${pad(f1(Math.min(...c.seriesT)), 7)}  max ${pad(f1(Math.max(...c.seriesT)), 7)}`
    + `  half-amp ${pad(f2(half(Array.from(c.seriesT))), 6)}  peak ${peakMonth(Array.from(c.seriesT))}`
    + `  H1 ${f2(c.t.h1)} peaking ${dayOfYearLabel(phaseToDayOfYear(c.t.p1))}`);
  say(`    model    min ${pad(f1(Math.min(...c.seriesM)), 7)}  max ${pad(f1(Math.max(...c.seriesM)), 7)}`
    + `  half-amp ${pad(f2(half(Array.from(c.seriesM))), 6)}  peak ${peakMonth(Array.from(c.seriesM))}`
    + `  H1 ${f2(c.m.h1)} peaking ${dayOfYearLabel(phaseToDayOfYear(c.m.p1))}`);
  const weakPhase = c.t.h1 < PHASE_AMPLITUDE_FLOOR_C;
  say(`    H1 amplitude ratio model/teacher ${f2(c.m.h1 / c.t.h1)}   harmonic phase difference ${f1(dPhase)} d`
    + `${weakPhase ? " (NOT MEANINGFUL: teacher H1 below the " + PHASE_AMPLITUDE_FLOOR_C + " C floor)" : ""}`
    + `   annual bias ${f2(c.absBias)} C`);
  say(`    teacher months  ${Array.from(c.seriesT).map((v) => v.toFixed(1).padStart(6)).join("")}`);
  say(`    model   months  ${Array.from(c.seriesM).map((v) => v.toFixed(1).padStart(6)).join("")}`);
  pointRows.push({
    label, lng, lat, isSea: c.isSea,
    teacher: { min: Math.min(...c.seriesT), max: Math.max(...c.seriesT), half: half(Array.from(c.seriesT)), h1: c.t.h1, peak: peakMonth(Array.from(c.seriesT)) },
    model: { min: Math.min(...c.seriesM), max: Math.max(...c.seriesM), half: half(Array.from(c.seriesM)), h1: c.m.h1, peak: peakMonth(Array.from(c.seriesM)) },
    phaseDiffDays: dPhase, phaseMeaningful: !weakPhase, annualBiasC: c.absBias,
  });
}
say("");

// --- 8. calibration side vs hold-out side ------------------------------------
say("=== 8. the split that a calibration would use, measured as a baseline only ===");
say("  nothing is fitted here; this is the difference the two halves already show");
say(HEAD);
const splits = {
  checkerA: report("checkerboard (x+y even)", cells.filter((c) => (c.x + c.y) % 2 === 0)),
  checkerB: report("checkerboard (x+y odd)", cells.filter((c) => (c.x + c.y) % 2 === 1)),
  iceIn: report("ice included (all cells)", cells),
  iceOut: report("ice excluded", cells.filter((c) => !c.ice)),
  iceOnly: report("ice cells only", cells.filter((c) => c.ice)),
  antarctica: report("Antarctica (<60S land)", cells.filter((c) => c.lat < -60 && !c.isSea)),
  greenland: report("Greenland", cells.filter((c) => c.lat >= 59 && c.lat <= 84 && c.lng >= -73 && c.lng <= -12 && !c.isSea)),
  natlantic: report("N Atlantic/Europe 45-75N", cells.filter((c) => c.lat >= 45 && c.lat <= 75 && c.lng >= -10 && c.lng <= 60)),
  neAsia: report("NE Asia 45-75N", cells.filter((c) => c.lat >= 45 && c.lat <= 75 && c.lng >= 90 && c.lng <= 180 && !c.isSea)),
};
for (const [lo, hi] of bands) {
  splits[`band${lo}_${hi}_out`] = report(`hold out |lat| ${lo}-${hi}`, cells.filter((c) => Math.abs(c.lat) >= lo && Math.abs(c.lat) < hi));
}
const ckA = ampStats(cells.filter((c) => (c.x + c.y) % 2 === 0));
const ckB = ampStats(cells.filter((c) => (c.x + c.y) % 2 === 1));
say(`  checkerboard halves differ by ${f3(Math.abs(ckA.mae - ckB.mae))} C of amplitude MAE `
  + `and ${f3(Math.abs(ckA.bias - ckB.bias))} C of amplitude bias`);
say("");

// --- 9. the annual identity --------------------------------------------------
say("=== 9. the annual mean is untouched ===");
{
  // Teacher: the equal-weight mean of the twelve months IS the committed
  // annual field (that is what build_temperature_teacher.py enforces).
  let worstT = 0;
  for (const c of cells) worstT = Math.max(worstT, Math.abs(c.teacherMean12 - c.teacherAnnual));
  ok(worstT < 1e-3, "teacher: mean of 12 months = the annual teacher", `max |diff| ${worstT.toExponential(2)} C`);

  // Model: the length-weighted mean of the twelve month means must return
  // Stage 2's annual value exactly, because the seasonal anomaly's own annual
  // mean is zero by construction. The equal-weight mean does not, and the gap
  // is the month-length effect -- reported so nobody mistakes it for a bug.
  let worstWeighted = 0, worstEqual = 0;
  const totalDays = MONTH_DAYS.reduce((a, b) => a + b, 0);
  for (const c of cells) {
    let w = 0;
    for (let m = 0; m < 12; m++) w += MONTH_DAYS[m] * c.seriesM[m];
    w /= totalDays;
    worstWeighted = Math.max(worstWeighted, Math.abs(w - c.modelAnnual));
    worstEqual = Math.max(worstEqual, Math.abs(c.modelMean12 - c.modelAnnual));
  }
  ok(worstWeighted < 1e-3, "model: month-length-weighted mean of 12 months = Stage 2's annual field",
    `max |diff| ${worstWeighted.toExponential(2)} C`);
  say(`  (the equal-weight mean differs by up to ${f3(worstEqual)} C -- the month-length effect, not an error;`);
  say(`   both sides have their own equal-weight 12-month mean removed before anything seasonal is compared)`);

  // And Stage 2's field itself is not written to by anything above.
  let h = 2166136261 >>> 0;
  const a = temperatureField.annualMeanTemperatureC;
  for (let i = 0; i < a.length; i += 7) { h ^= Math.round(a[i] * 1000) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
  const rebuilt = buildTemperatureField({ terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params });
  let h2 = 2166136261 >>> 0;
  const b = rebuilt.annualMeanTemperatureC;
  for (let i = 0; i < b.length; i += 7) { h2 ^= Math.round(b[i] * 1000) >>> 0; h2 = Math.imul(h2, 16777619) >>> 0; }
  ok(h === h2, "Stage 2's annual field is unchanged by this validator", `hash ${h.toString(16)}`);
}
say("");

// --- 10. absolute monthly error, kept separate -------------------------------
say("=== 10. absolute monthly temperature error (NOT a seasonal calibration metric) ===");
say("  reported because it is asked for; the seasonal numbers above have each side's own annual mean removed");
say("  " + "group".padEnd(20) + pad("n", 8) + pad("ann bias", 10) + pad("mon MAE", 10) + pad("anom MAE", 10) + pad("anom RMSE", 11));
const absRows = [];
for (const [label, rows] of [["all", cells], ["land", land], ["ocean", ocean],
  ["land, ice excluded", land.filter((c) => !c.ice)]]) {
  const r = {
    label, n: rows.length,
    annualBias: wmean(rows, (c) => c.absBias),
    monthlyMae: wmean(rows, (c) => c.monthlyAbsMae),
    anomMae: wmean(rows, (c) => c.anomMae),
    anomRmse: wmean(rows, (c) => c.anomRmse),
  };
  absRows.push(r);
  say("  " + label.padEnd(20) + pad(r.n, 8) + pad(f2(r.annualBias), 10) + pad(f2(r.monthlyMae), 10)
    + pad(f2(r.anomMae), 10) + pad(f2(r.anomRmse), 11));
}
say("");

// --- 11. one-at-a-time sensitivity of the three calibratable parameters ------
// NOT a search and not a fit: each parameter is moved +/-10% on its own and
// the effect on the four headline numbers is measured, to establish whether
// the three are identifiable from this teacher at all.
say("=== 11. +/-10% one-at-a-time sensitivity (diagnostic only -- nothing is fitted) ===");
function metricsFor(seasonParams) {
  const t = buildSeasonalTemperatureTable({ rows: ROWS, body: calibrationBody, params: seasonParams });
  const H = t.harmonics;
  const { wCos, wSin } = monthMeanWeights(MONTHS, H);
  const cache = new Map();
  const harmOf = (rs2) => {
    let v = cache.get(rs2);
    if (v) return v;
    const base = rs2 * H * 2;
    const s = new Float64Array(12);
    for (let m = 0; m < 12; m++) {
      let acc = 0;
      for (let n = 0; n < H; n++) {
        acc += t.coefficients[base + n * 2] * wCos[m * H + n] + t.coefficients[base + n * 2 + 1] * wSin[m * H + n];
      }
      s[m] = acc;
    }
    let mean = 0; for (let m = 0; m < 12; m++) mean += s[m]; mean /= 12;
    for (let m = 0; m < 12; m++) s[m] -= mean;
    v = harmonics(s);
    cache.set(rs2, v);
    return v;
  };
  const mk = (rows) => {
    const withH = rows.map((c) => ({ ...c, m: harmOf(c.rs / 12) }));
    const a = ampStats(withH), p = circularStats(withH);
    return { amp: a.model, ampBias: a.bias, ampMae: a.mae, phaseBias: p.biasDays, phaseMae: p.maeDays };
  };
  return { land: mk(land), ocean: mk(ocean), timescaleDays: t.timescaleDays };
}
const base = metricsFor(SEASON_PARAMETERS);
say("  " + "variant".padEnd(26) + pad("land amp", 10) + pad("d amp", 8) + pad("land ph", 9) + pad("d ph", 8)
  + pad("sea amp", 10) + pad("d amp", 8) + pad("sea ph", 9) + pad("d ph", 8));
const sensitivity = [];
const showVariant = (label, mm) => {
  const r = {
    label,
    landAmp: mm.land.amp, dLandAmp: mm.land.amp - base.land.amp,
    landPhase: mm.land.phaseBias, dLandPhase: mm.land.phaseBias - base.land.phaseBias,
    seaAmp: mm.ocean.amp, dSeaAmp: mm.ocean.amp - base.ocean.amp,
    seaPhase: mm.ocean.phaseBias, dSeaPhase: mm.ocean.phaseBias - base.ocean.phaseBias,
    landAmpMae: mm.land.ampMae, seaAmpMae: mm.ocean.ampMae,
    landPhaseMae: mm.land.phaseMae, seaPhaseMae: mm.ocean.phaseMae,
    tauLandDays: mm.timescaleDays.land, tauSeaDays: mm.timescaleDays.sea,
  };
  sensitivity.push(r);
  say("  " + label.padEnd(26) + pad(f2(r.landAmp), 10) + pad(f2(r.dLandAmp), 8) + pad(f1(r.landPhase), 9)
    + pad(f1(r.dLandPhase), 8) + pad(f2(r.seaAmp), 10) + pad(f2(r.dSeaAmp), 8) + pad(f1(r.seaPhase), 9)
    + pad(f1(r.dSeaPhase), 8));
};
showVariant("current (lambda 8/4m/30m)", base);
for (const [key, label] of [["seasonalDampingWPerM2K", "lambda"], ["soilDepthM", "soilDepth"], ["mixedLayerDepthM", "mixedLayer"]]) {
  for (const sign of [-0.1, +0.1]) {
    const p = { ...SEASON_PARAMETERS, [key]: SEASON_PARAMETERS[key] * (1 + sign) };
    showVariant(`${label} ${sign > 0 ? "+" : "-"}10%  (${f2(p[key])})`, metricsFor(p));
  }
}
say("  amplitudes are area-weighted model H1 half-amplitudes (C); phases are the model-minus-teacher bias in days");
say("");
say("  why the three separate, and where one of them is weak:");
say("  " + "variant".padEnd(26) + pad("tau land (d)", 14) + pad("tau sea (d)", 14));
for (const r of sensitivity) say("  " + r.label.padEnd(26) + pad(f1(r.tauLandDays), 14) + pad(f1(r.tauSeaDays), 14));
{
  const air = SEASON_PARAMETERS.atmosphericColumnHeatCapacityJPerM2K;
  const cLand = table.heatCapacityJPerM2K.land, cSea = table.heatCapacityJPerM2K.sea;
  say(`  the atmospheric column (${air.toExponential(1)} J/m2/K, FIXED and not among the three) is `
    + `${(100 * air / cLand).toFixed(0)}% of C_land and only ${(100 * air / cSea).toFixed(0)}% of C_sea.`);
  say(`  so a 10% change in soilDepthM moves C_land by only ${(100 * 0.1 * (cLand - air) / cLand).toFixed(1)}%, `
    + `while 10% of mixedLayerDepthM moves C_sea by ${(100 * 0.1 * (cSea - air) / cSea).toFixed(1)}% -- `
    + `which is why soilDepthM is the weakest of the three.`);
}
say("");

// --- 11b. the land/ocean damping split ---------------------------------------
//
// `oceanSeasonalDampingWPerM2K` is null by default, meaning "use the land
// value", so everything above this point is unaffected. What follows checks
// that claim rather than asserting it, then measures the Earth candidate.
say("=== 11b. the land/ocean seasonal-damping split ===");
const OCEAN_LAMBDA_CANDIDATE = 10;
let oceanSplit = null;
{
  // (a) the default is bit-identical to the parameter not existing.
  const plain = buildSeasonalTemperatureTable({ rows: ROWS, body: calibrationBody });
  const explicit = buildSeasonalTemperatureTable({
    rows: ROWS, body: calibrationBody,
    params: { ...SEASON_PARAMETERS, oceanSeasonalDampingWPerM2K: SEASON_PARAMETERS.seasonalDampingWPerM2K },
  });
  let differing = 0;
  for (let i = 0; i < plain.coefficients.length; i++) {
    if (plain.coefficients[i] !== explicit.coefficients[i]) differing++;
  }
  ok(differing === 0, "default (null) === explicitly setting the ocean lambda to the land lambda",
    `${differing} of ${plain.coefficients.length} coefficients differ`);
  ok(dampingWPerM2KForSurface(SURFACE_SEA, SEASON_PARAMETERS) === SEASON_PARAMETERS.seasonalDampingWPerM2K,
    "an unsplit world resolves the ocean lambda to the land lambda",
    `${dampingWPerM2KForSurface(SURFACE_SEA, SEASON_PARAMETERS)} W/m2/K`);
  ok(plain.dampingWPerM2K === SEASON_PARAMETERS.seasonalDampingWPerM2K
    && plain.oceanDampingWPerM2K === SEASON_PARAMETERS.seasonalDampingWPerM2K,
    "the table still reports the land lambda where it always did");

  // (b) splitting it leaves EVERY land coefficient untouched.
  const split = buildSeasonalTemperatureTable({
    rows: ROWS, body: calibrationBody,
    params: { ...SEASON_PARAMETERS, oceanSeasonalDampingWPerM2K: OCEAN_LAMBDA_CANDIDATE },
  });
  let landDiff = 0, seaDiff = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let surface = 0; surface < 2; surface++) {
      for (let n = 0; n < plain.harmonics; n++) {
        const at = ((y * 2 + surface) * plain.harmonics + n) * 2;
        for (const off of [0, 1]) {
          if (plain.coefficients[at + off] !== split.coefficients[at + off]) {
            if (surface === SURFACE_LAND) landDiff++; else seaDiff++;
          }
        }
      }
    }
  }
  ok(landDiff === 0, `lambda_ocean ${OCEAN_LAMBDA_CANDIDATE} changes ZERO land coefficients`,
    `${landDiff} land / ${seaDiff} sea`);
  ok(seaDiff > 0, "and it does change the sea's", `${seaDiff} sea coefficients differ`);

  // (c) the Earth candidate, on the same cells as everything above.
  const modelFor = (oceanLambda) => {
    const t = buildSeasonalTemperatureTable({
      rows: ROWS, body: calibrationBody,
      params: { ...SEASON_PARAMETERS, oceanSeasonalDampingWPerM2K: oceanLambda },
    });
    const an = modelMonthAnomalies(t, MONTHS);
    const out = new Array(ROWS * 2);
    for (let rs = 0; rs < ROWS * 2; rs++) out[rs] = harmonicsOf(HARM_P, an, rs * 12);
    return { table: t, at: (c) => out[c.rs / 12] };
  };
  const scoreWith = (rows, m) => {
    let sw = 0, bias = 0, mae = 0, pw = 0, px = 0, py = 0, pabs = 0;
    for (const c of rows) {
      const h = m.at(c); sw += c.weight;
      bias += c.weight * (h.h1 - c.t.h1); mae += c.weight * Math.abs(h.h1 - c.t.h1);
      if (c.t.h1 < PHASE_AMPLITUDE_FLOOR_C) continue;
      const d = wrapPhase(h.p1 - c.t.p1);
      pw += c.weight; px += c.weight * Math.cos(2 * Math.PI * d); py += c.weight * Math.sin(2 * Math.PI * d);
      pabs += c.weight * Math.abs(phaseToDays(d));
    }
    return { ampBias: bias / sw, ampMae: mae / sw,
      phaseBias: pw > 0 ? phaseToDays(Math.atan2(py, px) / (2 * Math.PI)) : NaN,
      phaseMae: pw > 0 ? pabs / pw : NaN };
  };
  const OCEAN_GROUPS = {
    "all ocean": ocean,
    // The grid search's own fit set, so the pre-evaluation's figures are
    // directly comparable: ice cells and the parked North Atlantic block out.
    "fit set (calib)": ocean.filter((c) => !c.ice && !(c.lat >= 45 && c.lat <= 75 && c.lng >= -10 && c.lng <= 60) && (c.x + c.y) % 2 === 0),
    "fit set (hold-out)": ocean.filter((c) => !c.ice && !(c.lat >= 45 && c.lat <= 75 && c.lng >= -10 && c.lng <= 60) && (c.x + c.y) % 2 === 1),
    "0-30 ocean": ocean.filter((c) => Math.abs(c.lat) < 30),
    "30-60 N ocean": ocean.filter((c) => c.lat >= 30 && c.lat < 60),
    "30-60 S ocean": ocean.filter((c) => c.lat <= -30 && c.lat > -60),
    "60-90 N (Arctic)": ocean.filter((c) => c.lat >= 60),
    "60-90 S (Southern)": ocean.filter((c) => c.lat <= -60),
    "N Atlantic/Europe": ocean.filter((c) => c.lat >= 45 && c.lat <= 75 && c.lng >= -10 && c.lng <= 60),
  };
  const base8 = modelFor(SEASON_PARAMETERS.seasonalDampingWPerM2K);
  const cand10 = modelFor(OCEAN_LAMBDA_CANDIDATE);
  say(`  tau sea ${f1(base8.table.timescaleDays.sea)} d at lambda_ocean 8 -> `
    + `${f1(cand10.table.timescaleDays.sea)} d at ${OCEAN_LAMBDA_CANDIDATE}; `
    + `tau land unchanged at ${f1(base8.table.timescaleDays.land)} d`);
  say("  " + "group".padEnd(21) + pad("n", 7) + pad("ampMAE 8", 10) + pad("-> 10", 9)
    + pad("phbias 8", 10) + pad("-> 10", 9) + pad("phMAE 8", 10) + pad("-> 10", 9));
  const splitRows = [];
  for (const [label, rows] of Object.entries(OCEAN_GROUPS)) {
    if (!rows.length) continue;
    const a = scoreWith(rows, base8), b = scoreWith(rows, cand10);
    splitRows.push({ label, n: rows.length, base: a, candidate: b });
    say("  " + label.padEnd(21) + pad(rows.length, 7) + pad(f2(a.ampMae), 10) + pad(f2(b.ampMae), 9)
      + pad(f1(a.phaseBias) + "d", 10) + pad(f1(b.phaseBias) + "d", 9)
      + pad(f1(a.phaseMae) + "d", 10) + pad(f1(b.phaseMae) + "d", 9));
  }
  const landA = scoreWith(land, base8), landB = scoreWith(land, cand10);
  ok(landA.ampMae === landB.ampMae && landA.phaseMae === landB.phaseMae && landA.phaseBias === landB.phaseBias,
    "land amplitude MAE, phase MAE and phase bias are EXACTLY unchanged",
    `${f2(landA.ampMae)} / ${f1(landA.phaseMae)} d / ${f1(landA.phaseBias)} d`);

  // (d) is 10 an isolated lucky point? A plain sweep, NOT a search.
  say("  sensitivity (no search -- only: is 10 isolated?):");
  say("  " + "lambda_ocean".padEnd(16) + pad("amp MAE", 10) + pad("amp bias", 11)
    + pad("ph bias", 10) + pad("ph MAE", 10) + pad("tau sea", 10));
  const sweep = [];
  for (const L of [8, 9, 10, 11, 12]) {
    const m = modelFor(L), r = scoreWith(ocean, m);
    sweep.push({ lambda: L, ...r, tauSeaDays: m.table.timescaleDays.sea });
    say("  " + String(L).padEnd(16) + pad(f2(r.ampMae), 10) + pad(f2(r.ampBias), 11)
      + pad(f1(r.phaseBias) + "d", 10) + pad(f1(r.phaseMae) + "d", 10)
      + pad(f1(m.table.timescaleDays.sea) + "d", 10));
  }
  const tropicalRatio = (m) => {
    const rows = ocean.filter((c) => Math.abs(c.lat) < 30);
    let sw = 0, t = 0, mm = 0;
    for (const c of rows) { sw += c.weight; t += c.weight * (c.t.ratio ?? 0); mm += c.weight * (m.at(c).ratio ?? 0); }
    return { teacher: t / sw, model: mm / sw };
  };
  const r8 = tropicalRatio(base8), r10 = tropicalRatio(cand10);
  say(`  tropical ocean H2/H1: teacher ${f3(r8.teacher)}, lambda_ocean 8 ${f3(r8.model)}, `
    + `${OCEAN_LAMBDA_CANDIDATE} ${f3(r10.model)}`);
  oceanSplit = { candidate: OCEAN_LAMBDA_CANDIDATE, groups: splitRows, sweep,
    land: { base: landA, candidate: landB }, tropicalRatio: { base: r8, candidate: r10 },
    tauSeaDays: { base: base8.table.timescaleDays.sea, candidate: cand10.table.timescaleDays.sea } };
}
say("");

// --- 12. the equinox-date sensitivity, measured rather than argued ----------
//
// The March equinox's day of year is the ONE constant tying the model's clock
// to Earth's calendar, and it is worth being exact about what it moves. The
// model's peak is fixed relative to the equinox, so shifting where the equinox
// sits in the calendar shifts the model's peak DATE with it; the teacher's
// twelve numbers do not move at all. So this constant lands directly on the
// reported phase BIAS -- the opposite of the reassuring version -- and the
// only honest thing to do is measure it.
say("=== 12. sensitivity to the calendar link ===");
function phaseBiasAtEquinox(equinoxDay) {
  const months = monthIntervals(equinoxDay);
  const P = buildHarmonicOperator(months.map((m) => m.centreWrapped));
  const H = table.harmonics;
  const { wCos, wSin } = monthMeanWeights(months, H);
  const fit = (series, op) => {
    const c = new Float64Array(3);
    for (let i = 0; i < 3; i++) { let v = 0; for (let m = 0; m < 12; m++) v += op[i][m] * series[m]; c[i] = v; }
    return { h1: Math.hypot(c[1], c[2]), p1: (((Math.atan2(c[2], c[1]) / (2 * Math.PI)) % 1) + 1) % 1 };
  };
  const modelCache = new Map();
  const modelFit = (rs2) => {
    let v = modelCache.get(rs2);
    if (v) return v;
    const base = rs2 * H * 2, s = new Float64Array(12);
    for (let m = 0; m < 12; m++) {
      let acc = 0;
      for (let n = 0; n < H; n++) {
        acc += table.coefficients[base + n * 2] * wCos[m * H + n] + table.coefficients[base + n * 2 + 1] * wSin[m * H + n];
      }
      s[m] = acc;
    }
    v = fit(s, P);
    modelCache.set(rs2, v);
    return v;
  };
  const group = (rows) => {
    let sw = 0, sx = 0, sy = 0;
    for (const c of rows) {
      const t = fit(c.seriesT, P);
      if (t.h1 < PHASE_AMPLITUDE_FLOOR_C) continue;
      const d = wrapPhase(modelFit(c.rs / 12).p1 - t.p1);
      sw += c.weight; sx += c.weight * Math.cos(2 * Math.PI * d); sy += c.weight * Math.sin(2 * Math.PI * d);
    }
    void sw;
    return phaseToDays(Math.atan2(sy, sx) / (2 * Math.PI));
  };
  return { land: group(land), ocean: group(ocean) };
}
const eqBase = phaseBiasAtEquinox(MARCH_EQUINOX_DAY_OF_YEAR);
const eqMinus = phaseBiasAtEquinox(MARCH_EQUINOX_DAY_OF_YEAR - 1);
const eqPlus = phaseBiasAtEquinox(MARCH_EQUINOX_DAY_OF_YEAR + 1);
say("  " + "equinox day of year".padEnd(24) + pad("land phase bias", 18) + pad("ocean phase bias", 18));
for (const [label, v] of [[`${(MARCH_EQUINOX_DAY_OF_YEAR - 1).toFixed(2)} (-1 d)`, eqMinus],
  [`${MARCH_EQUINOX_DAY_OF_YEAR.toFixed(2)} (used)`, eqBase], [`${(MARCH_EQUINOX_DAY_OF_YEAR + 1).toFixed(2)} (+1 d)`, eqPlus]]) {
  say("  " + label.padEnd(24) + pad(f2(v.land) + " d", 18) + pad(f2(v.ocean) + " d", 18));
}
const eqSensLand = (eqPlus.land - eqMinus.land) / 2, eqSensOcean = (eqPlus.ocean - eqMinus.ocean) / 2;
say(`  -> a 1-day error in the equinox date moves the phase bias by ${f2(eqSensLand)} d (land) / ${f2(eqSensOcean)} d (ocean),`);
say(`     i.e. one for one. The real instant varies about +/-0.6 d across 1991-2020, so every phase bias`);
say(`     below carries about +/-0.6 d of calendar uncertainty. The teacher's own peak DATES are unaffected.`);
const equinoxSensitivity = { land: eqSensLand, ocean: eqSensOcean, minus: eqMinus, base: eqBase, plus: eqPlus };
say("");

// --- 13. summary -------------------------------------------------------------
say("=== 13. summary ===");
say(`  land   H1 amplitude teacher ${f2(headline.land.teacher)} C, model ${f2(headline.land.model)} C `
  + `(ratio ${f2(headline.land.ratio)}), bias ${f2(headline.land.bias)} C, MAE ${f2(headline.land.mae)} C`);
say(`  ocean  H1 amplitude teacher ${f2(headline.ocean.teacher)} C, model ${f2(headline.ocean.model)} C `
  + `(ratio ${f2(headline.ocean.ratio)}), bias ${f2(headline.ocean.bias)} C, MAE ${f2(headline.ocean.mae)} C`);
say(`  land   H1 phase bias ${f1(headline.land.phase.biasDays)} d, MAE ${f1(headline.land.phase.maeDays)} d`);
say(`  ocean  H1 phase bias ${f1(headline.ocean.phase.biasDays)} d, MAE ${f1(headline.ocean.phase.maeDays)} d`);
say("");
say(failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`);

if (asJson) {
  console.log(JSON.stringify({
    orbit: EARTH_CALIBRATION_ORBIT, equinoxDayOfYear: MARCH_EQUINOX_DAY_OF_YEAR,
    months: MONTHS, integration: { samples: PHASE_SAMPLES, convergence, maxSamplingGapC: maxSampleGap, maxMidpointGapC: maxMidGap },
    equinoxSensitivity, oceanSplit,
    cells: cells.length, teacherMissing,
    headline, byBand, secondHarmonic: h2Rows, points: pointRows, splits, absolute: absRows, sensitivity,
    failures,
  }, null, 2));
}
process.exit(failures === 0 ? 0 : 1);
