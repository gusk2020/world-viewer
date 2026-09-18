// Climate v1: the first coarse grid search over the seasonal parameters.
//
// Three free variables and nothing else, per
// docs/climate-v1-calibration-audit.md's first group:
//   seasonalDampingWPerM2K (lambda), soilDepthM, mixedLayerDepthM
// `shortwaveAbsorbedFraction` stays at 0.70 (exactly degenerate with lambda),
// Earth's tilt / eccentricity / periapsis are physical facts, and Stage 2,
// Stage 4, Stage 5 and every sea-ice parameter are untouched.
//
// **It compares seasonal anomalies only.** Each side has its own twelve-month
// mean removed before anything is measured, so Stage 2's annual bias -- which
// is closed, and has known structural causes -- can never be absorbed into a
// seasonal parameter.
//
// **The fit set excludes the known structural errors**: ice cells, Antarctica,
// Greenland and the North Atlantic / Europe block. Those are the regions the
// project has already diagnosed and parked, and letting three parameters chase
// them is exactly the compensating error this search exists to avoid. They are
// measured and reported for every candidate, and a candidate that wrecks one
// is rejected -- but improving one is never a reason to adopt.
//
// Nothing is written to any world's config. Usage:
//   node tools/search_seasonal_temperature.mjs [--json] [--include-antarctica]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets, dailyMeanInsolationFactor } from "../js/climate.js";
import { buildTerrainField, sampleTerrainAt } from "../js/climate-v1/terrain.js";
import { buildTemperatureField, sampleTemperatureAt, latitudeOfRow } from "../js/climate-v1/temperature.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import {
  SEASONAL_TIME_AXIS, SEASON_PARAMETERS, SURFACE_LAND, SURFACE_SEA,
  buildSeasonalTemperatureTable, harmonicsForEccentricity, heatCapacityJPerM2K, sampleOrbit,
} from "../js/climate-v1/season.js";
import {
  EARTH_CALIBRATION_ORBIT, MONTH_NAMES,
  monthIntervals, monthMeanWeights, buildHarmonicOperator, harmonicsOf, wrapPhase, calendarHelpers,
} from "./seasonal_calendar.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai");
const TD = path.join(WORLD, "teacher");
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
// The compensating-error probe: let every parked structural error back into
// the fit and see whether the preferred lambda moves. NOTE that
// `--include-antarctica` alone would be VACUOUS -- Antarctica is essentially
// all ice class, so the ice exclusion already removes it. The flag therefore
// re-admits ice, Antarctica, Greenland and the North Atlantic block together,
// which is the only version of this question that can answer anything.
const includeParked = argv.includes("--include-parked") || argv.includes("--include-antarctica");

const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));
const YEAR_D = Number.isFinite(config.body.yearLengthDays)
  ? config.body.yearLengthDays : SEASON_PARAMETERS.yearLengthDays;
const MONTHS = monthIntervals(YEAR_D);
const HARM_P = buildHarmonicOperator(MONTHS.map((m) => m.centreWrapped));
const { phaseToDays, phaseToDayOfYear, dayOfYearLabel } = calendarHelpers(YEAR_D);
const ROWS = 512;
const calibrationBody = { ...config.body, ...EARTH_CALIBRATION_ORBIT };

const out = [];
const say = (s = "") => { out.push(s); if (!asJson) console.log(s); };
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "  --");
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "  --");
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "  --");
const pad = (v, n = 8) => String(v).padStart(n);

// ---------------------------------------------------------------------------
// THE SEARCH GRID. Coarse on purpose, and it contains the current values.
const GRID = {
  seasonalDampingWPerM2K: [5, 6, 7, 8, 9, 10, 12],
  soilDepthM: [1, 2, 4, 6, 8],
  mixedLayerDepthM: [10, 20, 30, 40, 50, 75],
};
const BASELINE = {
  seasonalDampingWPerM2K: SEASON_PARAMETERS.seasonalDampingWPerM2K,
  soilDepthM: SEASON_PARAMETERS.soilDepthM,
  mixedLayerDepthM: SEASON_PARAMETERS.mixedLayerDepthM,
};

// ---------------------------------------------------------------------------
// The fast path: the forcing does not depend on any of the three variables.
//
// `solvePeriodicResponse` divides the forcing's Fourier coefficients by lambda
// and applies a gain and a lag that depend only on tau = C/lambda. So the DFT
// of the forcing -- by far the expensive part, 360 samples x 512 rows x H
// harmonics -- is computed ONCE and every candidate is a handful of multiplies.
//
// This is an optimisation, so it is CHECKED against the real
// `buildSeasonalTemperatureTable` rather than trusted; see below.
function precomputeForcing({ rows, body, params = SEASON_PARAMETERS, phaseSamples = 360, harmonics }) {
  const eccentricity = Number.isFinite(body.orbitalEccentricity) ? body.orbitalEccentricity : 0;
  const periapsisLongitudeDeg = Number.isFinite(body.periapsisLongitudeDeg) ? body.periapsisLongitudeDeg : 0;
  const orbit = sampleOrbit({ samples: phaseSamples, eccentricity, periapsisLongitudeDeg });
  const tilt = body.axialTiltDegrees;
  const solarConstant = Number.isFinite(body.solarConstantWPerM2)
    ? body.solarConstantWPerM2 : params.solarConstantWPerM2;
  const forcing = new Float64Array(phaseSamples);
  // aRaw/bRaw[row * harmonics + (n-1)] -- the coefficients BEFORE dividing by
  // lambda, exactly as solvePeriodicResponse forms them.
  const aRaw = new Float64Array(rows * harmonics);
  const bRaw = new Float64Array(rows * harmonics);
  const cosT = new Float64Array(phaseSamples * harmonics);
  const sinT = new Float64Array(phaseSamples * harmonics);
  for (let s = 0; s < phaseSamples; s++) {
    for (let n = 1; n <= harmonics; n++) {
      const th = (2 * Math.PI * n * s) / phaseSamples;
      cosT[s * harmonics + n - 1] = Math.cos(th);
      sinT[s * harmonics + n - 1] = Math.sin(th);
    }
  }
  for (let y = 0; y < rows; y++) {
    const latRad = (latitudeOfRow(y, rows) * Math.PI) / 180;
    let mean = 0;
    for (let s = 0; s < phaseSamples; s++) {
      const dec = SEASONAL_TIME_AXIS.declinationFromSolarLongitudeRad(orbit.solarLongitudeRad[s], tilt);
      forcing[s] = orbit.distanceFactor[s] * dailyMeanInsolationFactor(latRad, dec);
      mean += forcing[s];
    }
    mean /= phaseSamples;
    for (let s = 0; s < phaseSamples; s++) {
      forcing[s] = params.shortwaveAbsorbedFraction * solarConstant * (forcing[s] - mean);
    }
    for (let n = 1; n <= harmonics; n++) {
      let a = 0, b = 0;
      for (let s = 0; s < phaseSamples; s++) {
        a += forcing[s] * cosT[s * harmonics + n - 1];
        b += forcing[s] * sinT[s * harmonics + n - 1];
      }
      aRaw[y * harmonics + n - 1] = (2 * a) / phaseSamples;
      bRaw[y * harmonics + n - 1] = (2 * b) / phaseSamples;
    }
  }
  const yearDays = Number.isFinite(body.yearLengthDays) ? body.yearLengthDays : params.yearLengthDays;
  return { rows, harmonics, aRaw, bRaw, omega: (2 * Math.PI) / (yearDays * 86400) };
}

/** The month-mean seasonal anomalies for one (lambda, C_land, C_sea), straight
 * from the precomputed forcing. Same index as `modelMonthAnomalies`:
 * `(row * 2 + surface) * 12 + month`. */
function anomaliesFor(pre, weights, lambda, capacities) {
  const { rows, harmonics: H, aRaw, bRaw, omega } = pre;
  const { wCos, wSin } = weights;
  const anomalies = new Float64Array(rows * 2 * 12);
  for (let y = 0; y < rows; y++) {
    for (let surface = 0; surface < 2; surface++) {
      const tau = capacities[surface] / lambda;
      const base = (y * 2 + surface) * 12;
      for (let n = 1; n <= H; n++) {
        const a = aRaw[y * H + n - 1] / lambda;
        const b = bRaw[y * H + n - 1] / lambda;
        const k = n * omega * tau;
        const gain = 1 / (1 + k * k);
        // Float32, because the real table stores Float32 coefficients and the
        // grid must not quietly be more precise than the model it stands for.
        const c = Math.fround(gain * (a - k * b));
        const s = Math.fround(gain * (b + k * a));
        for (let m = 0; m < 12; m++) {
          anomalies[base + m] += c * wCos[m * H + n - 1] + s * wSin[m * H + n - 1];
        }
      }
    }
  }
  return anomalies;
}

// ---------------------------------------------------------------------------
// Load the model's annual field and the teachers, once.
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
const monthlySummary = JSON.parse(readFileSync(path.join(TD, "temperature-monthly-summary.json"), "utf8"));
const TW = monthlySummary.grid.width, TH = monthlySummary.grid.height;
const mb = readFileSync(path.join(TD, monthlySummary.grid.valuesFile));
const teacherMonthly = new Float32Array(mb.buffer.slice(mb.byteOffset, mb.byteOffset + mb.byteLength));
const classes = readPng(path.join(TD, "present-classes.png"));

// ---------------------------------------------------------------------------
// The cell list. The teacher's own harmonics are computed once and never again.
const REGIONS = {
  antarctica: (c) => c.lat < -60 && !c.isSea,
  greenland: (c) => c.lat >= 59 && c.lat <= 84 && c.lng >= -73 && c.lng <= -12 && !c.isSea,
  northAtlanticEurope: (c) => c.lat >= 45 && c.lat <= 75 && c.lng >= -10 && c.lng <= 60,
  neAsia: (c) => c.lat >= 45 && c.lat <= 75 && c.lng >= 90 && c.lng <= 180 && !c.isSea,
  arcticOcean: (c) => c.lat >= 60 && c.isSea,
  midLatOcean: (c) => Math.abs(c.lat) >= 30 && Math.abs(c.lat) < 60 && c.isSea,
};
const PHASE_AMPLITUDE_FLOOR_C = 1.0;

const cells = [];
let teacherMissing = 0;
const seriesT = new Float64Array(12);
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
    let meanT = 0;
    for (let m = 0; m < 12; m++) meanT += seriesT[m];
    meanT /= 12;
    const anomT = new Float64Array(12);
    for (let m = 0; m < 12; m++) anomT[m] = seriesT[m] - meanT;
    const cx = Math.min(classes.width - 1, Math.floor(((lng + 180) / 360) * classes.width));
    const cy = Math.min(classes.height - 1, Math.floor(((90 - lat) / 180) * classes.height));
    const cls = classes.data[cy * classes.width + cx];
    const cell = {
      x, y, lng, lat, isSea: terrain.isSea,
      rs: tableRow * 2 + surface,
      weight: Math.cos((lat * Math.PI) / 180),
      t: harmonicsOf(HARM_P, anomT),
      ice: cls === 4 || cls === 1,
      even: (x + y) % 2 === 0,
    };
    cell.region = Object.fromEntries(Object.entries(REGIONS).map(([k, f]) => [k, f(cell)]));
    // Eligible for the FIT. Everything else is validation only.
    cell.eligible = includeParked || (!cell.ice
      && !cell.region.antarctica
      && !cell.region.greenland
      && !cell.region.northAtlanticEurope);
    cell.phaseUsable = cell.t.h1 >= PHASE_AMPLITUDE_FLOOR_C;
    cells.push(cell);
  }
}

// ---------------------------------------------------------------------------
// Metrics. Never collapsed into one number.
function measure(rows, model) {
  const g = { land: null, ocean: null };
  for (const [key, want] of [["land", false], ["ocean", true]]) {
    let n = 0, sw = 0, sBias = 0, sAbs = 0, sTeacher = 0, sModel = 0;
    let pw = 0, px = 0, py = 0, pAbs = 0, pn = 0;
    for (const c of rows) {
      if (c.isSea !== want) continue;
      const m = model[c.rs];
      n++; sw += c.weight;
      sBias += c.weight * (m.h1 - c.t.h1);
      sAbs += c.weight * Math.abs(m.h1 - c.t.h1);
      sTeacher += c.weight * c.t.h1;
      sModel += c.weight * m.h1;
      if (!c.phaseUsable) continue;
      const d = wrapPhase(m.p1 - c.t.p1);
      pn++; pw += c.weight;
      px += c.weight * Math.cos(2 * Math.PI * d);
      py += c.weight * Math.sin(2 * Math.PI * d);
      pAbs += c.weight * Math.abs(phaseToDays(d));
    }
    g[key] = sw > 0 ? {
      n, teacherAmp: sTeacher / sw, modelAmp: sModel / sw,
      ampBias: sBias / sw, ampMae: sAbs / sw,
      phaseBias: pw > 0 ? phaseToDays(Math.atan2(py, px) / (2 * Math.PI)) : NaN,
      phaseMae: pw > 0 ? pAbs / pw : NaN,
      phaseN: pn,
    } : null;
  }
  return g;
}
function measureGroup(rows, model) {
  let n = 0, sw = 0, sBias = 0, sAbs = 0;
  let pw = 0, px = 0, py = 0, pAbs = 0;
  for (const c of rows) {
    const m = model[c.rs];
    n++; sw += c.weight;
    sBias += c.weight * (m.h1 - c.t.h1);
    sAbs += c.weight * Math.abs(m.h1 - c.t.h1);
    if (!c.phaseUsable) continue;
    const d = wrapPhase(m.p1 - c.t.p1);
    pw += c.weight;
    px += c.weight * Math.cos(2 * Math.PI * d);
    py += c.weight * Math.sin(2 * Math.PI * d);
    pAbs += c.weight * Math.abs(phaseToDays(d));
  }
  if (sw === 0) return null;
  return {
    n, ampBias: sBias / sw, ampMae: sAbs / sw,
    phaseBias: pw > 0 ? phaseToDays(Math.atan2(py, px) / (2 * Math.PI)) : NaN,
    phaseMae: pw > 0 ? pAbs / pw : NaN,
  };
}
function tropics(rows, model) {
  let sw = 0, th1 = 0, mh1 = 0, th2 = 0, mh2 = 0, tr = 0, mr = 0, px = 0, py = 0, pw = 0;
  for (const c of rows) {
    const m = model[c.rs];
    sw += c.weight;
    th1 += c.weight * c.t.h1; mh1 += c.weight * m.h1;
    th2 += c.weight * c.t.h2; mh2 += c.weight * m.h2;
    tr += c.weight * (c.t.ratio ?? 0); mr += c.weight * (m.ratio ?? 0);
    const d = wrapPhase(m.p2 - c.t.p2) ;
    pw += c.weight; px += c.weight * Math.cos(4 * Math.PI * d); py += c.weight * Math.sin(4 * Math.PI * d);
  }
  return {
    teacherH1: th1 / sw, modelH1: mh1 / sw, teacherH2: th2 / sw, modelH2: mh2 / sw,
    teacherRatio: tr / sw, modelRatio: mr / sw,
    phase2Days: pw > 0 ? phaseToDays(Math.atan2(py, px) / (4 * Math.PI)) : NaN,
  };
}

// Subsets, built once.
const S = {
  fit: cells.filter((c) => c.eligible && c.even),
  hold: cells.filter((c) => c.eligible && !c.even),
  eligibleAll: cells.filter((c) => c.eligible),
  all: cells,
  tropicsLand: cells.filter((c) => Math.abs(c.lat) < 30 && !c.isSea),
  tropicsOcean: cells.filter((c) => Math.abs(c.lat) < 30 && c.isSea),
  deepTropicsLand: cells.filter((c) => Math.abs(c.lat) < 10 && !c.isSea),
};
for (const key of Object.keys(REGIONS)) S[key] = cells.filter((c) => c.region[key]);
const BANDS = [];
for (const [lo, hi] of [[0, 30], [30, 60], [60, 90]]) {
  for (const hemi of ["NH", "SH"]) {
    for (const [sl, want] of [["land", false], ["ocean", true]]) {
      BANDS.push({
        label: `${lo}-${hi} ${hemi} ${sl}`,
        rows: cells.filter((c) => {
          const a = Math.abs(c.lat);
          return a >= lo && a < hi && (hemi === "NH" ? c.lat >= 0 : c.lat < 0) && c.isSea === want;
        }),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluate one candidate.
const HARMONICS = harmonicsForEccentricity(EARTH_CALIBRATION_ORBIT.orbitalEccentricity);
const PRE = precomputeForcing({ rows: ROWS, body: calibrationBody, harmonics: HARMONICS });
const WEIGHTS = monthMeanWeights(MONTHS, HARMONICS);

function evaluate(candidate) {
  const capacities = [
    heatCapacityJPerM2K(SURFACE_LAND, { ...SEASON_PARAMETERS, ...candidate }),
    heatCapacityJPerM2K(SURFACE_SEA, { ...SEASON_PARAMETERS, ...candidate }),
  ];
  const anomalies = anomaliesFor(PRE, WEIGHTS, candidate.seasonalDampingWPerM2K, capacities);
  const model = new Array(ROWS * 2);
  for (let rs = 0; rs < ROWS * 2; rs++) model[rs] = harmonicsOf(HARM_P, anomalies, rs * 12);
  const fit = measure(S.fit, model);
  const hold = measure(S.hold, model);
  const regions = {};
  for (const key of Object.keys(REGIONS)) regions[key] = measureGroup(S[key], model);
  return {
    ...candidate,
    tauLandDays: capacities[0] / candidate.seasonalDampingWPerM2K / 86400,
    tauSeaDays: capacities[1] / candidate.seasonalDampingWPerM2K / 86400,
    fit, hold,
    all: measure(S.eligibleAll, model),
    global: measure(S.all, model),
    bands: BANDS.map((b) => ({ label: b.label, ...measureGroup(b.rows, model) })),
    regions,
    tropics: {
      land: tropics(S.tropicsLand, model),
      ocean: tropics(S.tropicsOcean, model),
      deepLand: tropics(S.deepTropicsLand, model),
    },
    objectives: [fit.land.ampMae, fit.land.phaseMae, fit.ocean.ampMae, fit.ocean.phaseMae],
  };
}

// ---------------------------------------------------------------------------
say("Climate v1 -- coarse grid search over the seasonal parameters\n");
say(`teacher: Berkeley Earth monthly, ${monthlySummary.grid.shape.join("x")}, ${monthlySummary.climatology.referencePeriod}`);
say(`orbit (calibration condition, not fitted): tilt ${EARTH_CALIBRATION_ORBIT.axialTiltDegrees}, `
  + `e ${EARTH_CALIBRATION_ORBIT.orbitalEccentricity}, periapsis ${EARTH_CALIBRATION_ORBIT.periapsisLongitudeDeg}`);
say(`fixed: shortwaveAbsorbedFraction ${SEASON_PARAMETERS.shortwaveAbsorbedFraction}, `
  + `atmospheric column ${SEASON_PARAMETERS.atmosphericColumnHeatCapacityJPerM2K.toExponential(1)} J/m2/K, `
  + `Stage 2/4/5 and every sea-ice parameter`);
say("");

// --- the fast path is checked, not trusted ----------------------------------
say("=== 0. the fast path reproduces the real season table ===");
{
  let worst = 0;
  for (const probe of [BASELINE,
    { seasonalDampingWPerM2K: 5, soilDepthM: 1, mixedLayerDepthM: 75 },
    { seasonalDampingWPerM2K: 12, soilDepthM: 8, mixedLayerDepthM: 10 }]) {
    const real = buildSeasonalTemperatureTable({
      rows: ROWS, body: calibrationBody, params: { ...SEASON_PARAMETERS, ...probe },
    });
    // The real table's own month means, via the shared exact integral.
    const { wCos, wSin } = WEIGHTS;
    const H = real.harmonics;
    const capacities = [
      heatCapacityJPerM2K(SURFACE_LAND, { ...SEASON_PARAMETERS, ...probe }),
      heatCapacityJPerM2K(SURFACE_SEA, { ...SEASON_PARAMETERS, ...probe }),
    ];
    const fast = anomaliesFor(PRE, WEIGHTS, probe.seasonalDampingWPerM2K, capacities);
    for (let rs = 0; rs < ROWS * 2; rs++) {
      for (let m = 0; m < 12; m++) {
        let v = 0;
        for (let n = 0; n < H; n++) {
          v += real.coefficients[rs * H * 2 + n * 2] * wCos[m * H + n]
             + real.coefficients[rs * H * 2 + n * 2 + 1] * wSin[m * H + n];
        }
        worst = Math.max(worst, Math.abs(v - fast[rs * 12 + m]));
      }
    }
  }
  const okFast = worst < 1e-9;
  say(`  ${okFast ? "OK  " : "FAIL"}  identical to buildSeasonalTemperatureTable at 3 probe points   max |diff| ${worst.toExponential(2)} C`);
  if (!okFast) { console.error("fast path does not reproduce the real table -- refusing to search"); process.exit(1); }
}
say("");

// --- 1. the grid -------------------------------------------------------------
const candidates = [];
for (const lam of GRID.seasonalDampingWPerM2K) {
  for (const soil of GRID.soilDepthM) {
    for (const mix of GRID.mixedLayerDepthM) {
      candidates.push(evaluate({ seasonalDampingWPerM2K: lam, soilDepthM: soil, mixedLayerDepthM: mix }));
    }
  }
}
const base = candidates.find((c) =>
  c.seasonalDampingWPerM2K === BASELINE.seasonalDampingWPerM2K
  && c.soilDepthM === BASELINE.soilDepthM
  && c.mixedLayerDepthM === BASELINE.mixedLayerDepthM);

say("=== 1. search range and cost ===");
say(`  lambda            ${GRID.seasonalDampingWPerM2K.join(", ")}  W/m2/K`);
say(`  soilDepthM        ${GRID.soilDepthM.join(", ")}  m`);
say(`  mixedLayerDepthM  ${GRID.mixedLayerDepthM.join(", ")}  m`);
say(`  ${candidates.length} combinations, the current values (${BASELINE.seasonalDampingWPerM2K} / `
  + `${BASELINE.soilDepthM} / ${BASELINE.mixedLayerDepthM}) among them`);
say(`  cells: ${cells.length} total, ${S.fit.length} calibration, ${S.hold.length} hold-out, `
  + `${cells.length - S.eligibleAll.length} excluded from the fit `
  + (includeParked ? "(NONE -- --include-parked is on, this is the compensating-error probe)"
    : "(ice / Antarctica / Greenland / N Atlantic-Europe)"));
say("");

// --- 2. baseline -------------------------------------------------------------
const showSet = (label, g) => {
  say(`  ${label.padEnd(14)}${pad(g.land.n, 7)}${pad(f2(g.land.ampBias), 10)}${pad(f2(g.land.ampMae), 9)}`
    + `${pad(f1(g.land.phaseBias), 10)}${pad(f1(g.land.phaseMae), 9)}`
    + `${pad(g.ocean.n, 8)}${pad(f2(g.ocean.ampBias), 10)}${pad(f2(g.ocean.ampMae), 9)}`
    + `${pad(f1(g.ocean.phaseBias), 10)}${pad(f1(g.ocean.phaseMae), 9)}`);
};
const SET_HEAD = "  " + "set".padEnd(14) + pad("land n", 7) + pad("amp bias", 10) + pad("amp MAE", 9)
  + pad("ph bias", 10) + pad("ph MAE", 9) + pad("ocean n", 8) + pad("amp bias", 10) + pad("amp MAE", 9)
  + pad("ph bias", 10) + pad("ph MAE", 9);
say("=== 2. the baseline (lambda 8 / soil 4 m / mixed layer 30 m), nothing fitted ===");
say(SET_HEAD);
showSet("calibration", base.fit);
showSet("hold-out", base.hold);
showSet("both halves", base.all);
showSet("global (all)", base.global);
say(`  tau land ${f1(base.tauLandDays)} d, tau sea ${f1(base.tauSeaDays)} d`);
say("");

// --- 3. Pareto front ---------------------------------------------------------
// Four objectives on the CALIBRATION set, never summed: land amplitude MAE,
// land phase MAE, ocean amplitude MAE, ocean phase MAE.
const dominates = (a, b) => {
  let better = false;
  for (let i = 0; i < 4; i++) {
    if (a.objectives[i] > b.objectives[i] + 1e-12) return false;
    if (a.objectives[i] < b.objectives[i] - 1e-12) better = true;
  }
  return better;
};
const front = candidates.filter((c) => !candidates.some((o) => dominates(o, c)));

// The hard conditions the brief sets, checked per candidate.
const AMP_TOL = 0.02;   // C, on an amplitude MAE
const PH_TOL = 0.2;     // days, on a phase MAE
const REGION_TOL = 1.0; // C, how much a parked region may worsen
const admissible = (c) => {
  const reasons = [];
  // calibration must improve somewhere and worsen nowhere
  let improved = false;
  for (let i = 0; i < 4; i++) {
    const tol = i % 2 === 0 ? AMP_TOL : PH_TOL;
    if (c.objectives[i] > base.objectives[i] + tol) reasons.push(`calibration objective ${i} worse`);
    if (c.objectives[i] < base.objectives[i] - tol) improved = true;
  }
  if (!improved) reasons.push("no calibration improvement");
  // hold-out must improve or stay put
  const hb = [base.hold.land.ampMae, base.hold.land.phaseMae, base.hold.ocean.ampMae, base.hold.ocean.phaseMae];
  const hc = [c.hold.land.ampMae, c.hold.land.phaseMae, c.hold.ocean.ampMae, c.hold.ocean.phaseMae];
  for (let i = 0; i < 4; i++) {
    const tol = i % 2 === 0 ? AMP_TOL : PH_TOL;
    if (hc[i] > hb[i] + tol) reasons.push(`hold-out objective ${i} worse`);
  }
  // the parked structural regions may not be wrecked
  for (const key of Object.keys(REGIONS)) {
    if (c.regions[key].ampMae > base.regions[key].ampMae + REGION_TOL) reasons.push(`${key} much worse`);
  }
  // the tropical semi-annual structure must survive
  if (Math.abs(c.tropics.deepLand.modelRatio - base.tropics.deepLand.modelRatio) > 0.15) {
    reasons.push("deep-tropics H2/H1 moved");
  }
  return reasons;
};
for (const c of candidates) c.rejections = admissible(c);
const admissibleFront = front.filter((c) => c.rejections.length === 0);

say("=== 3. Pareto front on the calibration set (4 objectives, never summed) ===");
say(`  ${front.length} of ${candidates.length} candidates are non-dominated; `
  + `${admissibleFront.length} of those also pass the hold-out and structural conditions`);
say(`  baseline objectives: land amp MAE ${f2(base.objectives[0])}, land ph MAE ${f1(base.objectives[1])}, `
  + `ocean amp MAE ${f2(base.objectives[2])}, ocean ph MAE ${f1(base.objectives[3])}`);
const FRONT_HEAD = "  " + "lambda soil mixed".padEnd(20) + pad("Lamp", 7) + pad("Lph", 7) + pad("Oamp", 7)
  + pad("Oph", 7) + pad("tauL", 7) + pad("tauS", 7) + "  status";
say(FRONT_HEAD);
const label = (c) => `${c.seasonalDampingWPerM2K} / ${c.soilDepthM} / ${c.mixedLayerDepthM}`;
for (const c of front.slice().sort((a, b) =>
  (a.objectives[0] + a.objectives[2]) - (b.objectives[0] + b.objectives[2]))) {
  say("  " + label(c).padEnd(20) + pad(f2(c.objectives[0]), 7) + pad(f1(c.objectives[1]), 7)
    + pad(f2(c.objectives[2]), 7) + pad(f1(c.objectives[3]), 7)
    + pad(f1(c.tauLandDays), 7) + pad(f1(c.tauSeaDays), 7)
    + "  " + (c.rejections.length === 0 ? "admissible" : c.rejections.join("; ")));
}
say("");

// --- 4. representative candidates -------------------------------------------
// Not "the best" -- the front has no best. One at each corner plus the most
// balanced, so the shape of the trade-off is visible.
const pick = (name, chooser) => {
  const pool = admissibleFront.length ? admissibleFront : front;
  const c = chooser(pool);
  return c ? { name, c } : null;
};
const norm = (c, i) => c.objectives[i] / base.objectives[i];
const reps = [
  pick("best land amplitude", (p) => p.slice().sort((a, b) => a.objectives[0] - b.objectives[0])[0]),
  pick("best ocean amplitude", (p) => p.slice().sort((a, b) => a.objectives[2] - b.objectives[2])[0]),
  pick("best land phase", (p) => p.slice().sort((a, b) => a.objectives[1] - b.objectives[1])[0]),
  pick("best ocean phase", (p) => p.slice().sort((a, b) => a.objectives[3] - b.objectives[3])[0]),
  pick("most balanced", (p) => p.slice().sort((a, b) =>
    Math.max(norm(a, 0), norm(a, 1), norm(a, 2), norm(a, 3)) - Math.max(norm(b, 0), norm(b, 1), norm(b, 2), norm(b, 3)))[0]),
].filter(Boolean);
const seen = new Set();
const representatives = [];
for (const r of reps) {
  const k = label(r.c);
  if (seen.has(k)) { representatives.find((x) => label(x.c) === k).name += ` + ${r.name}`; continue; }
  seen.add(k); representatives.push(r);
}

say("=== 4. representative candidates (the front has no single best) ===");
for (const { name, c } of representatives) {
  say(`  --- ${label(c)}   (${name})   tau land ${f1(c.tauLandDays)} d, tau sea ${f1(c.tauSeaDays)} d`);
  say(SET_HEAD);
  showSet("  calibration", c.fit);
  showSet("  hold-out", c.hold);
  say(`     vs baseline, calibration: land amp MAE ${f2(base.fit.land.ampMae)} -> ${f2(c.fit.land.ampMae)}, `
    + `land ph MAE ${f1(base.fit.land.phaseMae)} -> ${f1(c.fit.land.phaseMae)}, `
    + `ocean amp MAE ${f2(base.fit.ocean.ampMae)} -> ${f2(c.fit.ocean.ampMae)}, `
    + `ocean ph MAE ${f1(base.fit.ocean.phaseMae)} -> ${f1(c.fit.ocean.phaseMae)}`);
  say(`     vs baseline, hold-out:    land amp MAE ${f2(base.hold.land.ampMae)} -> ${f2(c.hold.land.ampMae)}, `
    + `land ph MAE ${f1(base.hold.land.phaseMae)} -> ${f1(c.hold.land.phaseMae)}, `
    + `ocean amp MAE ${f2(base.hold.ocean.ampMae)} -> ${f2(c.hold.ocean.ampMae)}, `
    + `ocean ph MAE ${f1(base.hold.ocean.phaseMae)} -> ${f1(c.hold.ocean.phaseMae)}`);
  say(`     deep tropics (|lat|<10 land) H1 ${f2(c.tropics.deepLand.modelH1)} (teacher ${f2(c.tropics.deepLand.teacherH1)}), `
    + `H2/H1 ${f3(c.tropics.deepLand.modelRatio)} (teacher ${f3(c.tropics.deepLand.teacherRatio)})`);
  say("     structural regions (amplitude MAE, baseline -> candidate):");
  for (const key of Object.keys(REGIONS)) {
    say(`       ${key.padEnd(22)} ${f2(base.regions[key].ampMae)} -> ${f2(c.regions[key].ampMae)}   `
      + `phase bias ${f1(base.regions[key].phaseBias)} -> ${f1(c.regions[key].phaseBias)} d`);
  }
  say("");
}

// --- 5. band-by-band for the representatives --------------------------------
say("=== 5. latitude band x hemisphere x surface (amplitude MAE) ===");
say("  " + "band".padEnd(22) + pad("teacher", 9) + pad("base", 8)
  + representatives.map((r) => pad(label(r.c), 14)).join(""));
for (let b = 0; b < BANDS.length; b++) {
  const t = BANDS[b].rows.reduce((a, c) => a + c.weight * c.t.h1, 0) / BANDS[b].rows.reduce((a, c) => a + c.weight, 0);
  say("  " + BANDS[b].label.padEnd(22) + pad(f2(t), 9) + pad(f2(base.bands[b].ampMae), 8)
    + representatives.map((r) => pad(f2(r.c.bands[b].ampMae), 14)).join(""));
}
say("");

// --- 6. identifiability, from the grid itself --------------------------------
say("=== 6. is soilDepthM actually identified by this grid? ===");
{
  // Land metrics cannot depend on mixedLayerDepthM at all -- a land cell only
  // ever reads the LAND heat capacity -- so this is checked rather than
  // assumed, and the sweep then sits at the baseline depth.
  let landIndependent = 0;
  for (const c of candidates) {
    const ref = candidates.find((k) => k.seasonalDampingWPerM2K === c.seasonalDampingWPerM2K
      && k.soilDepthM === c.soilDepthM && k.mixedLayerDepthM === BASELINE.mixedLayerDepthM);
    landIndependent = Math.max(landIndependent, Math.abs(c.fit.land.ampMae - ref.fit.land.ampMae));
  }
  say(`  land metrics are independent of mixedLayerDepthM: max |diff| ${landIndependent.toExponential(1)} C `
    + `over all ${candidates.length} candidates (as they must be -- a land cell reads only C_land)`);
  const landAt = (lam, soil) => candidates.find((k) => k.seasonalDampingWPerM2K === lam
    && k.soilDepthM === soil && k.mixedLayerDepthM === BASELINE.mixedLayerDepthM);
  // The whole lambda x soilDepth plane, both land objectives, because they are
  // what separates the two -- an amplitude alone cannot.
  for (const [title, get] of [["land amplitude MAE (C)", (c) => f3(c.fit.land.ampMae)],
    ["land phase MAE (days)", (c) => f2(c.fit.land.phaseMae)]]) {
    say(`  ${title}, rows = lambda, columns = soilDepthM:`);
    say("    " + "".padEnd(8) + GRID.soilDepthM.map((v) => pad(v + " m", 9)).join(""));
    for (const lam of GRID.seasonalDampingWPerM2K) {
      say("    " + (lam + " W").padEnd(8) + GRID.soilDepthM.map((soil) => pad(get(landAt(lam, soil)), 9)).join(""));
    }
  }
  const bestPair = landAt(BASELINE.seasonalDampingWPerM2K, BASELINE.soilDepthM);
  say(`  holding lambda ${bestPair.seasonalDampingWPerM2K} (the baseline) and mixed layer ${bestPair.mixedLayerDepthM}:`);
  say("  " + "soilDepthM".padEnd(14) + pad("land amp MAE", 14) + pad("land ph MAE", 13) + pad("tau land", 10));
  const sweep = [];
  for (const soil of GRID.soilDepthM) {
    const c = candidates.find((k) => k.seasonalDampingWPerM2K === bestPair.seasonalDampingWPerM2K
      && k.mixedLayerDepthM === bestPair.mixedLayerDepthM && k.soilDepthM === soil);
    sweep.push({ soil, ampMae: c.fit.land.ampMae, phaseMae: c.fit.land.phaseMae, tau: c.tauLandDays });
    say("  " + String(soil).padEnd(14) + pad(f3(c.fit.land.ampMae), 14) + pad(f2(c.fit.land.phaseMae), 13)
      + pad(f1(c.tauLandDays), 10));
  }
  const ampSpread = Math.max(...sweep.map((s) => s.ampMae)) - Math.min(...sweep.map((s) => s.ampMae));
  const phSpread = Math.max(...sweep.map((s) => s.phaseMae)) - Math.min(...sweep.map((s) => s.phaseMae));
  say(`  across the whole 1-8 m range: land amplitude MAE moves ${f3(ampSpread)} C, land phase MAE ${f2(phSpread)} d`);
  // how often does the front pin soilDepth?
  const soils = [...new Set(front.map((c) => c.soilDepthM))].sort((a, b) => a - b);
  say(`  soilDepthM values appearing on the Pareto front: ${soils.join(", ")}`);
}
say("");

// --- 7. compensating-error probes -------------------------------------------
say("=== 7. compensating-error probes ===");
{
  // (a) does lambda track Antarctica's error across the grid?
  const lamOf = (c) => c.seasonalDampingWPerM2K;
  const corr = (xs, ys) => {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let cxy = 0, vx = 0, vy = 0;
    for (let i = 0; i < xs.length; i++) { cxy += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; vy += (ys[i] - my) ** 2; }
    return cxy / Math.sqrt(vx * vy);
  };
  const r = corr(candidates.map(lamOf), candidates.map((c) => c.regions.antarctica.ampMae));
  say(`  (a) lambda vs Antarctica amplitude MAE across the grid: r = ${f3(r)}`);
  const lamSweep = GRID.seasonalDampingWPerM2K.map((lam) => candidates.find((k) =>
    k.seasonalDampingWPerM2K === lam && k.soilDepthM === BASELINE.soilDepthM
    && k.mixedLayerDepthM === BASELINE.mixedLayerDepthM));
  const bestLam = lamSweep.slice().sort((a, b) => a.fit.land.ampMae - b.fit.land.ampMae)[0].seasonalDampingWPerM2K;
  say(`      this run's fit set ${includeParked ? "INCLUDES" : "EXCLUDES"} the parked regions, and at the baseline `
    + `depths its land amplitude MAE is smallest at lambda = ${bestLam}.`);
  say(`      Antarctica's own error falls monotonically as lambda rises, so it pulls lambda UP; NE Asia's bias `
    + `worsens monotonically as lambda rises, so it pulls DOWN. Both are in table (c).`);
  if (!includeParked) say(`      Re-run with --include-parked to admit ice, Antarctica, Greenland and the North Atlantic block.`);
  // (b) mixed layer: the Arctic against the mid-latitude ocean
  say(`  (b) mixed layer: the Arctic Ocean against the 30-60 ocean it must not break`);
  say("  " + "mixedLayer".padEnd(12) + pad("Arctic MAE", 12) + pad("Arctic ph", 12)
    + pad("30-60 MAE", 12) + pad("calib amp", 11) + pad("calib ph bias", 15) + pad("calib ph MAE", 14));
  for (const mix of GRID.mixedLayerDepthM) {
    const c = candidates.find((k) => k.seasonalDampingWPerM2K === BASELINE.seasonalDampingWPerM2K
      && k.soilDepthM === BASELINE.soilDepthM && k.mixedLayerDepthM === mix);
    say("  " + String(mix).padEnd(12) + pad(f2(c.regions.arcticOcean.ampMae), 12)
      + pad(f1(c.regions.arcticOcean.phaseBias) + "d", 12)
      + pad(f2(c.regions.midLatOcean.ampMae), 12) + pad(f2(c.fit.ocean.ampMae), 11)
      + pad(f1(c.fit.ocean.phaseBias) + "d", 15) + pad(f1(c.fit.ocean.phaseMae) + "d", 14));
  }
  say("      the ocean's amplitude wants a DEEPER layer and its phase wants a SHALLOWER one, monotonically.");
  say("      One heat capacity cannot give both: that is the single-layer ocean, not a mis-set number.");
  // (c) lambda sweep at the baseline depths
  say(`  (c) lambda at the baseline depths (soil 4 m, mixed 30 m)`);
  say("  " + "lambda".padEnd(20) + pad("calib land MAE", 16) + pad("calib land bias", 17)
    + pad("Antarctica MAE", 16) + pad("NE Asia bias", 15));
  for (const lam of GRID.seasonalDampingWPerM2K) {
    const c = candidates.find((k) => k.seasonalDampingWPerM2K === lam
      && k.soilDepthM === BASELINE.soilDepthM && k.mixedLayerDepthM === BASELINE.mixedLayerDepthM);
    say("  " + String(lam).padEnd(20) + pad(f2(c.fit.land.ampMae), 16) + pad(f2(c.fit.land.ampBias), 17)
      + pad(f2(c.regions.antarctica.ampMae), 16) + pad(f2(c.regions.neAsia.ampBias), 15));
  }
}
say("");

// --- 8. where to refine ------------------------------------------------------
say("=== 8. where a finer grid would go ===");
{
  const pool = admissibleFront.length ? admissibleFront : front;
  const poolName = admissibleFront.length ? "admissible front" : "Pareto front (nothing is admissible)";
  const on = (key) => [...new Set(pool.map((c) => c[key]))].sort((a, b) => a - b);
  say(`  values appearing on the ${poolName}:`);
  say(`    lambda            ${on("seasonalDampingWPerM2K").join(", ") || "(none)"}`);
  say(`    soilDepthM        ${on("soilDepthM").join(", ") || "(none)"}`);
  say(`    mixedLayerDepthM  ${on("mixedLayerDepthM").join(", ") || "(none)"}`);
  say(`  A front spanning the whole range of a variable means that variable is trading against the`);
  say(`  others rather than being pinned -- so refining it would buy a different trade, not a better one.`);
  for (const [key, grid] of Object.entries(GRID)) {
    const vals = on(key);
    if (!vals.length) continue;
    const atEdge = vals.includes(grid[0]) || vals.includes(grid[grid.length - 1]);
    if (atEdge) say(`  NOTE: ${key} reaches this grid's edge (${vals[0]}..${vals[vals.length - 1]} of ${grid[0]}..${grid[grid.length - 1]}).`);
  }
}
say("");

const payload = {
  _note: "Coarse grid search over Climate v1's three seasonal parameters. NOTHING IS ADOPTED. "
    + "Seasonal anomalies only; ice, Antarctica, Greenland and the North Atlantic/Europe block are "
    + "excluded from the fit and reported as validation. See docs/climate-v1-seasonal-grid-search.md.",
  grid: GRID, baselineValues: BASELINE, orbit: EARTH_CALIBRATION_ORBIT,
  includeParked, evaluations: candidates.length,
  cells: { total: cells.length, calibration: S.fit.length, holdOut: S.hold.length, teacherMissing },
  baseline: {
    values: BASELINE, tauLandDays: base.tauLandDays, tauSeaDays: base.tauSeaDays,
    calibration: base.fit, holdOut: base.hold, regions: base.regions, tropics: base.tropics,
  },
  paretoFront: front.map((c) => ({
    values: {
      seasonalDampingWPerM2K: c.seasonalDampingWPerM2K,
      soilDepthM: c.soilDepthM, mixedLayerDepthM: c.mixedLayerDepthM,
    },
    tauLandDays: c.tauLandDays, tauSeaDays: c.tauSeaDays,
    objectivesCalibration: {
      landAmpMae: c.objectives[0], landPhaseMae: c.objectives[1],
      oceanAmpMae: c.objectives[2], oceanPhaseMae: c.objectives[3],
    },
    holdOut: {
      landAmpMae: c.hold.land.ampMae, landPhaseMae: c.hold.land.phaseMae,
      oceanAmpMae: c.hold.ocean.ampMae, oceanPhaseMae: c.hold.ocean.phaseMae,
    },
    regionAmpMae: Object.fromEntries(Object.entries(c.regions).map(([k, v]) => [k, v.ampMae])),
    deepTropicsRatio: c.tropics.deepLand.modelRatio,
    rejectedBecause: c.rejections,
  })),
  admissibleFront: admissibleFront.map((c) => label(c)),
  representatives: representatives.map((r) => ({ name: r.name, values: {
    seasonalDampingWPerM2K: r.c.seasonalDampingWPerM2K, soilDepthM: r.c.soilDepthM, mixedLayerDepthM: r.c.mixedLayerDepthM,
  } })),
};
if (!includeParked) {
  writeFileSync(path.join(WORLD, "seasonal-candidates.json"), JSON.stringify(payload, null, 2) + "\n");
  say(`wrote worlds/kasoku-sekai/seasonal-candidates.json (candidates only -- nothing is adopted)`);
}
if (asJson) console.log(JSON.stringify(payload, null, 2));
