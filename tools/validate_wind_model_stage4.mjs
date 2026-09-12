// Climate v1 Stage 4: does the new pressure-gradient wind model explain
// more of the real Earth's wind than Climate v0.8's latitude-only one?
//
// Runs, in order:
//   1. Stage 3's old-model baseline, asserted to reproduce its published
//      numbers (if it does not, nothing below is trustworthy and the run
//      stops).
//   2. Synthetic-world tests of the new model's physics, before it is
//      allowed anywhere near Earth data.
//   3. A small grid search of the new model's three parameters on one half
//      of a geographic checkerboard, scored on VECTOR RMSE -- deliberately
//      not on speed correlation, which is the headline success metric and
//      is therefore kept as something the fit never saw.
//   4. The same metrics for both models, side by side, on the held-out
//      half and on the whole globe, plus latitude bands and the three
//      regions Stage 3 singled out.
//
// Usage: node tools/validate_wind_model_stage4.mjs [--json] [--quick]
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import { parseWindGrid } from "../js/climate-v1/wind-teacher.js";
import {
  currentModelWind, compareWindToTeacher, compareWindFieldToTeacher, fitSpeedScaleK, nearestModelRow,
} from "../js/climate-v1/wind-diagnostic.js";
import { buildClimateV1Wind, buildWindFromTemperature } from "../js/climate-v1/wind.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OLD_MODEL_ROWS = 180;
const WIND_GRID = { width: 256, height: 128 };

// The two pressure surfaces the hypsometric relation is taken between, and
// the gas. Earth values, kept HERE (in the Earth-specific tool) rather than
// in js/climate-v1/wind.js, which requires them as inputs and has no
// defaults -- see that file's header.
const EARTH_ATMOSPHERE = {
  specificGasConstantJPerKgK: 287, // dry air
  surfacePressureHPa: 1000,
  levelPressureHPa: 850, // matches the teacher's primary level
};

// ---------------------------------------------------------------------------
// Loading
function loadElevation(config) {
  const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
  const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
  const offset = config.terrain.encoding.offsetMetres;
  const metres = new Int16Array(png.width * png.height);
  for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;
  return { width: png.width, height: png.height, metres };
}

function loadWindTeacher(worldDir) {
  const summary = JSON.parse(readFileSync(path.join(worldDir, "teacher", "wind-summary.json"), "utf8"));
  const loadLevel = (key) => {
    const spec = summary.grids[key];
    const out = { width: spec.width, height: spec.height };
    for (const [name, file] of Object.entries(spec.files)) {
      out[name] = parseWindGrid(readFileSync(path.join(worldDir, "teacher", file)), spec).values;
    }
    return out;
  };
  return { summary, level850hPa: loadLevel("level850hPa"), level10m: loadLevel("level10m") };
}

const teacherUV = (level) => ({ width: level.width, height: level.height, u: level.u, v: level.v });
const latOfRow = (y, h) => 90 - (y + 0.5) * (180 / h);
const lngOfCol = (x, w) => -180 + (x + 0.5) * (360 / w);

function restrict(teacher, keep) {
  const { width, height, u, v } = teacher;
  const ru = new Float64Array(width * height).fill(NaN);
  const rv = new Float64Array(width * height).fill(NaN);
  for (let y = 0; y < height; y++) {
    const lat = latOfRow(y, height);
    for (let x = 0; x < width; x++) {
      if (!keep(lngOfCol(x, width), lat, x, y)) continue;
      const i = y * width + x;
      ru[i] = u[i]; rv[i] = v[i];
    }
  }
  return { width, height, u: ru, v: rv };
}

const LAT_BANDS = [
  { label: "90-60N", min: 60, max: 90 },
  { label: "60-30N", min: 30, max: 60 },
  { label: "30-0N", min: 0, max: 30 },
  { label: "0-30S", min: -30, max: 0 },
  { label: "30-60S", min: -60, max: -30 },
  { label: "60-90S", min: -90, max: -60 },
];

const REGIONS = [
  { label: "Southern Ocean", lng: [-180, 180], lat: [-60, -40] },
  { label: "tropical Pacific", lng: [-170, -120], lat: [-5, 5] },
  { label: "north polar", lng: [-180, 180], lat: [70, 90] },
  { label: "south polar", lng: [-180, 180], lat: [-90, -70] },
  { label: "North Atlantic", lng: [-60, -10], lat: [30, 50] },
];

/**
 * The angle, in degrees, between the modelled wind and the down-gradient
 * direction (-grad Phi), at the row nearest `lat` and at that row's
 * steepest-gradient column. 0 = flow straight down the gradient (drag
 * dominated), 90 = flow along the contours (geostrophic). Uses the same
 * spherical metric the model itself uses, so it is a real diagnosis of the
 * balance rather than a re-derivation with a different convention.
 */
function angleToDownGradientDeg(field, width, height, radiusMetres, lat) {
  const y = Math.min(height - 1, Math.max(0, Math.round(((90 - lat) / 180) * height - 0.5)));
  const latRad = (latOfRow(y, height) * Math.PI) / 180;
  const dxM = radiusMetres * Math.max(Math.cos(latRad), 1e-6) * ((2 * Math.PI) / width);
  const dyM = radiusMetres * (Math.PI / height);
  const phi = field.geopotentialAnomalyM2S2;
  const row = y * width;
  const rowN = Math.max(0, y - 1) * width;
  const rowS = Math.min(height - 1, y + 1) * width;
  let bestMag = -Infinity, bestAngle = 0;
  for (let x = 0; x < width; x++) {
    const phiX = (phi[row + ((x + 1) % width)] - phi[row + ((x - 1 + width) % width)]) / (2 * dxM);
    const phiY = (phi[rowN + x] - phi[rowS + x]) / (2 * dyM);
    const mag = Math.hypot(phiX, phiY);
    if (mag <= bestMag) continue;
    bestMag = mag;
    const gx = -phiX, gy = -phiY;
    const u = field.uWindMs[row + x], v = field.vWindMs[row + x];
    const denom = Math.hypot(u, v) * Math.hypot(gx, gy);
    const cos = denom > 0 ? (u * gx + v * gy) / denom : 1;
    bestAngle = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  }
  return bestAngle;
}

// ---------------------------------------------------------------------------
// Synthetic-world physics tests. These run before any Earth comparison: a
// model that fails them is wrong regardless of how it scores.
function syntheticTests() {
  const width = 64, height = 32;
  const body = { radiusMetres: 6.0e6, dayLengthHours: 24, rotationDirection: 1 };
  const atmosphere = EARTH_ATMOSPHERE;
  const params = { thermalResponseStrength: 1, dragTimescaleDays: 2, thermalSmoothingKm: 500 };
  const make = (fn) => {
    const t = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) t[y * width + x] = fn(lngOfCol(x, width), latOfRow(y, height));
    }
    return t;
  };
  const results = {};

  // A. Uniform temperature -> no gradient -> no wind.
  {
    const w = buildWindFromTemperature({ temperatureC: make(() => 15), width, height, body, atmosphere, params });
    let maxSpeed = 0;
    for (const s of w.windSpeedMs) maxSpeed = Math.max(maxSpeed, s);
    assert.ok(maxSpeed < 1e-9, `uniform world must produce no wind, got ${maxSpeed} m/s`);
    results.uniformMaxSpeedMs = maxSpeed;
  }

  // B. Zonal-only temperature gradient (a function of longitude alone).
  //    Phi_y is then exactly zero, so the balance reduces to
  //    u = -r*Phi_x/(r^2+f^2), v = f*Phi_x/(r^2+f^2). The physically
  //    meaningful statement is about the ANGLE between the wind and the
  //    down-gradient direction: 0 where drag dominates (|f| << r, near the
  //    equator) and 90 where rotation dominates (|f| >> r). It must rise
  //    monotonically away from the equator.
  //
  //    Note this is asserted as a *trend*, not as "0 degrees at the
  //    equator": with cell-centre rows no row sits exactly on the equator,
  //    so the nearest one has a small but real f, and at the latitude where
  //    |f| happens to equal r the correct answer is 45 degrees, not 0. The
  //    first version of this test asserted the latter and failed the model
  //    for being right.
  {
    const w = buildWindFromTemperature({
      temperatureC: make((lng) => 15 + 10 * Math.cos((lng * Math.PI) / 180)),
      width, height, body, atmosphere, params,
    });
    const angles = [0, 10, 30, 60].map((lat) => ({ lat, deg: angleToDownGradientDeg(w, width, height, body.radiusMetres, lat) }));
    for (let i = 1; i < angles.length; i++) {
      assert.ok(angles[i].deg > angles[i - 1].deg,
        `zonal-gradient world: the wind must turn further from the gradient with latitude ` +
        `(${angles[i - 1].lat}deg: ${angles[i - 1].deg.toFixed(1)}, ${angles[i].lat}deg: ${angles[i].deg.toFixed(1)})`);
    }
    assert.ok(angles[angles.length - 1].deg > 80,
      `zonal-gradient world: the flow must be near-geostrophic at 60 degrees, got ${angles[angles.length - 1].deg.toFixed(1)}deg`);
    results.zonalGradient = { angleByLatitudeDeg: angles };
  }

  // C. Meridional-only gradient, warm equator / cold poles: the real Earth's
  //    dominant structure. Must give westerlies in BOTH hemispheres, with no
  //    hemisphere-specific term anywhere in the model.
  {
    const w = buildWindFromTemperature({
      temperatureC: make((lng, lat) => 30 * Math.cos((lat * Math.PI) / 180)),
      width, height, body, atmosphere, params,
    });
    const meanU = (latMin, latMax) => {
      let sw = 0, su = 0;
      for (let y = 0; y < height; y++) {
        const lat = latOfRow(y, height);
        if (lat < latMin || lat >= latMax) continue;
        const cw = Math.cos((lat * Math.PI) / 180);
        for (let x = 0; x < width; x++) { sw += cw; su += cw * w.uWindMs[y * width + x]; }
      }
      return su / sw;
    };
    const north = meanU(30, 60), south = meanU(-60, -30);
    assert.ok(north > 0, `warm-equator world must give northern westerlies, got u=${north}`);
    assert.ok(south > 0, `warm-equator world must give southern westerlies, got u=${south}`);
    results.meridionalGradient = { northernMidLatitudeU: north, southernMidLatitudeU: south };
  }

  // D/E/F. Rotation: reversal flips the zonal deflection; a faster spin is
  //    more geostrophic; no spin at all is pure down-gradient flow.
  {
    const temperatureC = make((lng, lat) => 30 * Math.cos((lat * Math.PI) / 180));
    const zonalAt45 = (spin, dayHours = 24) => {
      const w = buildWindFromTemperature({
        temperatureC, width, height,
        body: { ...body, rotationDirection: spin, dayLengthHours: dayHours },
        atmosphere, params,
      });
      let sw = 0, su = 0;
      for (let y = 0; y < height; y++) {
        const lat = latOfRow(y, height);
        if (lat < 30 || lat >= 60) continue;
        const cw = Math.cos((lat * Math.PI) / 180);
        for (let x = 0; x < width; x++) { sw += cw; su += cw * w.uWindMs[y * width + x]; }
      }
      return su / sw;
    };
    const prograde = zonalAt45(1);
    const retrograde = zonalAt45(-1);
    assert.ok(Math.abs(prograde + retrograde) < 1e-9,
      `reversing rotation must exactly reverse the zonal deflection (${prograde} vs ${retrograde})`);

    // "More geostrophic" measured properly: the angle between the wind and
    // the down-gradient direction. 0 = pure down-gradient, 90 = geostrophic.
    const angleToGradient = (dayHours) => angleToDownGradientDeg(
      buildWindFromTemperature({
        temperatureC, width, height, body: { ...body, dayLengthHours: dayHours }, atmosphere, params,
      }),
      width, height, body.radiusMetres, 45
    );
    const fastSpin = angleToGradient(6);     // 4x Earth-like rate
    const earthish = angleToGradient(24);
    const almostNoSpin = angleToGradient(24 * 400);
    assert.ok(fastSpin > earthish, `a faster spin must be more geostrophic (${fastSpin} vs ${earthish} deg)`);
    assert.ok(almostNoSpin < 5, `with almost no rotation the flow must follow the gradient, got ${almostNoSpin} deg off`);
    results.rotation = { progradeU: prograde, retrogradeU: retrograde, angleFastSpinDeg: fastSpin, angleEarthlikeDeg: earthish, angleNoSpinDeg: almostNoSpin };
  }

  // G. The equator must not be a singularity: f = 0 there exactly.
  {
    const w = buildWindFromTemperature({
      temperatureC: make((lng, lat) => 30 * Math.cos((lat * Math.PI) / 180) + 5 * Math.cos((lng * Math.PI) / 180)),
      width, height, body, atmosphere, params,
    });
    let maxSpeed = 0, nonFinite = 0;
    for (const s of w.windSpeedMs) { if (!Number.isFinite(s)) nonFinite++; else maxSpeed = Math.max(maxSpeed, s); }
    assert.equal(nonFinite, 0, "no cell may be NaN or infinite");
    assert.ok(maxSpeed < 200, `no cell may blow up, got ${maxSpeed} m/s`);
    results.equatorFinite = { nonFinite, maxSpeedMs: maxSpeed };
  }

  return results;
}

// ---------------------------------------------------------------------------
function main() {
  const asJson = process.argv.includes("--json");
  const quick = process.argv.includes("--quick");
  const worldDir = path.join(REPO, "worlds", "kasoku-sekai");
  const config = JSON.parse(readFileSync(path.join(worldDir, "config.json"), "utf8"));
  const sets = resolveClimateSets(config);
  const shipped = sets.sets.find((s) => s.id === sets.defaultId).values;
  // Climate v1's own Earth temperature calibration -- internal to Climate v1,
  // never written to the world config or to Climate v0.8's default.
  const params = { ...shipped, ...CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION };

  const elevation = loadElevation(config);
  const teacherData = loadWindTeacher(worldDir);
  const t850 = teacherUV(teacherData.level850hPa);
  const t10m = teacherUV(teacherData.level10m);

  // === 1. Stage 3 baseline, asserted to reproduce ============================
  const oldWind = currentModelWind({
    rows: OLD_MODEL_ROWS, dayLengthHours: config.body.dayLengthHours,
    rotationDirection: config.body.rotationDirection, params: shipped, subsolarDeg: 0,
  });
  const kRows = [];
  for (let y = 0; y < t850.height; y++) {
    const lat = latOfRow(y, t850.height);
    const weight = Math.cos((lat * Math.PI) / 180);
    const modelSpeed = oldWind.magnitude[nearestModelRow(lat, oldWind.rows)];
    for (let x = 0; x < t850.width; x++) {
      const i = y * t850.width + x;
      if (!Number.isFinite(t850.u[i]) || !Number.isFinite(t850.v[i])) continue;
      kRows.push({ modelSpeed, teacherSpeed: Math.hypot(t850.u[i], t850.v[i]), weight });
    }
  }
  const k850 = fitSpeedScaleK(kRows).k;
  const oldBaseline = compareWindToTeacher({ modelWind: oldWind, teacher: t850, modelSpeedScaleMS: k850 });
  const near = (got, want, tol, what) =>
    assert.ok(Math.abs(got - want) <= tol, `Stage 3 baseline did not reproduce: ${what} = ${got}, expected ~${want}`);
  near(k850, 6.545, 0.01, "K");
  near(oldBaseline.directionErrorDeg, 56.5, 0.2, "direction mean");
  near(oldBaseline.directionMedianErrorDeg, 29.5, 0.2, "direction median");
  near(oldBaseline.weighted.speedCorrelation, 0.154, 0.005, "speed correlation");
  near(oldBaseline.speedMaeMS, 2.863, 0.01, "speed MAE");
  near(oldBaseline.uRmseMS, 5.035, 0.01, "u RMSE");
  near(oldBaseline.vRmseMS, 1.924, 0.01, "v RMSE");
  // The old model needs its own K per level, since it has no real units.
  const fitKFor = (teacher) => {
    const rows = [];
    for (let y = 0; y < teacher.height; y++) {
      const lat = latOfRow(y, teacher.height);
      const weight = Math.cos((lat * Math.PI) / 180);
      const modelSpeed = oldWind.magnitude[nearestModelRow(lat, oldWind.rows)];
      for (let x = 0; x < teacher.width; x++) {
        const i = y * teacher.width + x;
        if (!Number.isFinite(teacher.u[i]) || !Number.isFinite(teacher.v[i])) continue;
        rows.push({ modelSpeed, teacherSpeed: Math.hypot(teacher.u[i], teacher.v[i]), weight });
      }
    }
    return fitSpeedScaleK(rows).k;
  };
  const oldBaseline10m = compareWindToTeacher({
    modelWind: oldWind, teacher: t10m, modelSpeedScaleMS: fitKFor(t10m),
  });

  // === 2. Synthetic physics tests ===========================================
  const synthetic = syntheticTests();

  // === 3. Build the Climate v1 temperature field once ========================
  const terrainField = buildTerrainField({ elevationGrid: elevation, seaLevelMetres: 0 });
  const temperatureField = buildTemperatureField({
    terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params,
  });

  const buildNew = (windParams, opts = {}) => buildClimateV1Wind({
    terrainField, temperatureField, lapseRateCPerKm: params.lapseRateCPerKm,
    body: config.body, atmosphere: EARTH_ATMOSPHERE, params: windParams,
    ...WIND_GRID, ...opts,
  });

  // Performance, measured on a real build.
  const perfStart = process.hrtime.bigint();
  const perfField = buildNew({ thermalResponseStrength: 2, dragTimescaleDays: 2, thermalSmoothingKm: 1000 });
  const perfMs = Number(process.hrtime.bigint() - perfStart) / 1e6;
  const fieldBytes = (perfField.uWindMs.length * 8) * 5; // u, v, speed, Phi, smoothed T

  // === 4. Small grid search, calibration half only ===========================
  // Scored on VECTOR RMSE. Speed correlation is deliberately NOT the
  // objective -- it is the headline success criterion, so letting the fit
  // chase it would make any improvement in it circular. It is also
  // scale-invariant, so `thermalResponseStrength` cannot move it at all.
  const isCalib = (lng, lat, x, y) => (x + y) % 2 === 0;
  const calibTeacher = restrict(t850, isCalib);
  const validTeacher = restrict(t850, (lng, lat, x, y) => !isCalib(lng, lat, x, y));

  const grid = quick
    ? { strength: [2, 3], drag: [1, 2], smooth: [1000, 2000] }
    : {
      strength: [1, 1.5, 2, 2.5, 3, 4, 5],
      drag: [0.5, 1, 2, 4, 8],
      smooth: [500, 1000, 1500, 2000],
    };
  let best = null;
  let trials = 0;
  for (const thermalResponseStrength of grid.strength) {
    for (const dragTimescaleDays of grid.drag) {
      for (const thermalSmoothingKm of grid.smooth) {
        const wp = { thermalResponseStrength, dragTimescaleDays, thermalSmoothingKm };
        const field = buildNew(wp);
        const score = compareWindFieldToTeacher({ modelField: field, teacher: calibTeacher });
        trials++;
        if (!best || score.weighted.vectorRmseMS < best.score.weighted.vectorRmseMS) {
          best = { params: wp, score };
        }
      }
    }
  }

  const bestField = buildNew(best.params);
  const newWhole = compareWindFieldToTeacher({ modelField: bestField, teacher: t850 });
  const newCalib = compareWindFieldToTeacher({ modelField: bestField, teacher: calibTeacher });
  const newValid = compareWindFieldToTeacher({ modelField: bestField, teacher: validTeacher });
  const oldCalib = compareWindToTeacher({ modelWind: oldWind, teacher: calibTeacher, modelSpeedScaleMS: k850 });
  const oldValid = compareWindToTeacher({ modelWind: oldWind, teacher: validTeacher, modelSpeedScaleMS: k850 });
  const new10m = compareWindFieldToTeacher({ modelField: bestField, teacher: t10m });

  // Default (uncalibrated) parameters, for the record: how much of the
  // result is the physics and how much is the three-number fit.
  const defaultField = buildNew({});
  const newDefault = compareWindFieldToTeacher({ modelField: defaultField, teacher: t850 });

  // === 5. Latitude bands and regions, both models ============================
  const bandRows = LAT_BANDS.map((b) => {
    const sub = restrict(t850, (lng, lat) => lat >= b.min && lat < b.max);
    return {
      label: b.label,
      old: compareWindToTeacher({ modelWind: oldWind, teacher: sub, modelSpeedScaleMS: k850 }),
      new: compareWindFieldToTeacher({ modelField: bestField, teacher: sub }),
    };
  });

  const meanUV = (teacher, sampler) => {
    let sw = 0, tu = 0, tv = 0, ts = 0, mu = 0, mv = 0, ms = 0;
    for (let y = 0; y < teacher.height; y++) {
      const lat = latOfRow(y, teacher.height);
      const w = Math.cos((lat * Math.PI) / 180);
      for (let x = 0; x < teacher.width; x++) {
        const i = y * teacher.width + x;
        if (!Number.isFinite(teacher.u[i]) || !Number.isFinite(teacher.v[i])) continue;
        const [mU, mV] = sampler(lngOfCol(x, teacher.width), lat);
        sw += w;
        tu += w * teacher.u[i]; tv += w * teacher.v[i]; ts += w * Math.hypot(teacher.u[i], teacher.v[i]);
        mu += w * mU; mv += w * mV; ms += w * Math.hypot(mU, mV);
      }
    }
    if (sw === 0) return null;
    return {
      teacherU: tu / sw, teacherV: tv / sw, teacherSpeed: ts / sw,
      modelU: mu / sw, modelV: mv / sw, modelSpeed: ms / sw,
    };
  };
  const oldSampler = (lng, lat) => {
    const row = nearestModelRow(lat, oldWind.rows);
    return [oldWind.east[row] * k850, oldWind.north[row] * k850];
  };
  const newSampler = (lng, lat) => {
    const mx = Math.min(bestField.width - 1, Math.max(0, Math.floor(((lng + 180) / 360) * bestField.width)));
    const my = Math.min(bestField.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * bestField.height)));
    const i = my * bestField.width + mx;
    return [bestField.uWindMs[i], bestField.vWindMs[i]];
  };
  // The verdict hinges on a split the whole-globe number hides: the new
  // model's assumption (uniform surface pressure) is defensible outside the
  // tropics and demonstrably false inside them, so score the two separately.
  // A diagnostic slice, not a fit target -- nothing was tuned per region.
  const tropicsTeacher = restrict(t850, (lng, lat) => Math.abs(lat) < 30);
  const extratropicsTeacher = restrict(t850, (lng, lat) => Math.abs(lat) >= 30);
  const splits = {
    tropics: {
      old: compareWindToTeacher({ modelWind: oldWind, teacher: tropicsTeacher, modelSpeedScaleMS: k850 }),
      new: compareWindFieldToTeacher({ modelField: bestField, teacher: tropicsTeacher }),
    },
    extratropics: {
      old: compareWindToTeacher({ modelWind: oldWind, teacher: extratropicsTeacher, modelSpeedScaleMS: k850 }),
      new: compareWindFieldToTeacher({ modelField: bestField, teacher: extratropicsTeacher }),
    },
  };

  const regionRows = REGIONS.map((r) => {
    const sub = restrict(t850, (lng, lat) => {
      if (lat < r.lat[0] || lat >= r.lat[1]) return false;
      return r.lng[0] <= r.lng[1] ? (lng >= r.lng[0] && lng < r.lng[1]) : (lng >= r.lng[0] || lng < r.lng[1]);
    });
    return { label: r.label, old: meanUV(sub, oldSampler), new: meanUV(sub, newSampler) };
  });

  // Zonal-mean u per band: the direct test of whether the new model
  // reproduces Earth's hemispheric asymmetry (a far stronger Southern
  // Ocean westerly than its northern counterpart) without any parameter
  // that knows which hemisphere it is in.
  const zonalRows = LAT_BANDS.map((b) => {
    const sub = restrict(t850, (lng, lat) => lat >= b.min && lat < b.max);
    return { label: b.label, old: meanUV(sub, oldSampler), new: meanUV(sub, newSampler) };
  });

  const result = {
    oldBaseline850: oldBaseline, oldBaseline10m,
    synthetic, splits, zonalMeanU: zonalRows,
    search: { trials, bestParams: best.params, grid },
    newWhole, newCalib, newValid, new10m, newDefault,
    oldCalib, oldValid,
    bands: bandRows, regions: regionRows,
    performance: { buildMs: perfMs, gridWidth: WIND_GRID.width, gridHeight: WIND_GRID.height, fieldBytes },
  };

  if (asJson) { console.log(JSON.stringify(result, null, 1)); return; }

  const f = (v, d = 3) => (v === null || v === undefined ? "  -  " : v.toFixed(d));
  const line = (label, m) =>
    `  ${label.padEnd(22)} r=${f(m.weighted.speedCorrelation)}  dirMean=${f(m.directionErrorDeg, 1)}  ` +
    `dirMed=${f(m.directionMedianErrorDeg, 1)}  dirSW=${f(m.weighted.directionSpeedWeightedErrorDeg, 1)}  ` +
    `bias=${f(m.weighted.biasMS)}  spdMAE=${f(m.speedMaeMS)}  spdRMSE=${f(m.speedRmseMS)}  ` +
    `uRMSE=${f(m.uRmseMS)}  vRMSE=${f(m.vRmseMS)}  vecRMSE=${f(m.weighted.vectorRmseMS)}`;

  console.log("Climate v1 Stage 4 -- new pressure-gradient wind model vs Climate v0.8's latitude-only one");
  console.log("teacher: NCEP/NCAR Reanalysis 1, 850 hPa (primary), 1981-2010");
  console.log("");
  console.log("Stage 3 baseline reproduction: OK (K, direction, correlation, MAE, u/v RMSE all within tolerance)");
  console.log("synthetic physics tests: OK");
  console.log(`  uniform world max speed        ${synthetic.uniformMaxSpeedMs.toExponential(2)} m/s`);
  console.log(`  zonal-gradient world  angle to down-gradient by lat: ${synthetic.zonalGradient.angleByLatitudeDeg.map((a) => `${a.lat}deg:${a.deg.toFixed(1)}`).join("  ")}`);
  console.log(`  warm-equator world    N mid u=${f(synthetic.meridionalGradient.northernMidLatitudeU)}  S mid u=${f(synthetic.meridionalGradient.southernMidLatitudeU)} (westerlies both)`);
  console.log(`  rotation reversal              ${f(synthetic.rotation.progradeU)} -> ${f(synthetic.rotation.retrogradeU)}`);
  console.log(`  angle to down-gradient: fast spin ${f(synthetic.rotation.angleFastSpinDeg, 1)}deg, Earth-like ${f(synthetic.rotation.angleEarthlikeDeg, 1)}deg, no spin ${f(synthetic.rotation.angleNoSpinDeg, 1)}deg`);
  console.log(`  equator finite: ${synthetic.equatorFinite.nonFinite} non-finite cells, max ${f(synthetic.equatorFinite.maxSpeedMs, 1)} m/s`);
  console.log("");
  console.log(`grid search: ${trials} trials on the calibration half, scored on vector RMSE`);
  console.log(`  best: ${JSON.stringify(best.params)}`);
  console.log("");
  console.log("850 hPa, whole globe:");
  console.log(line("old (Climate v0.8)", oldBaseline));
  console.log(line("new (defaults)", newDefault));
  console.log(line("new (calibrated)", newWhole));
  console.log("");
  console.log("850 hPa, calibration vs validation half:");
  console.log(line("old  calibration", oldCalib));
  console.log(line("old  validation", oldValid));
  console.log(line("new  calibration", newCalib));
  console.log(line("new  validation", newValid));
  console.log("");
  console.log("10 m (secondary):");
  console.log(line("old", oldBaseline10m));
  console.log(line("new", new10m));
  console.log("");
  console.log("tropics (|lat|<30) vs extratropics (|lat|>=30), 850 hPa:");
  console.log(line("  tropics     old", splits.tropics.old));
  console.log(line("  tropics     new", splits.tropics.new));
  console.log(line("  extratrop.  old", splits.extratropics.old));
  console.log(line("  extratrop.  new", splits.extratropics.new));
  console.log("");
  console.log("zonal-mean u by band (m/s) -- the hemisphere-asymmetry test:");
  for (const z of zonalRows) {
    console.log(`  ${z.label.padEnd(8)} teacher=${f(z.old.teacherU)}  old=${f(z.old.modelU)}  new=${f(z.new.modelU)}`);
  }
  console.log("");
  console.log("latitude bands (850 hPa):");
  for (const b of bandRows) {
    console.log(`  ${b.label}`);
    console.log(line("    old", b.old));
    console.log(line("    new", b.new));
  }
  console.log("");
  console.log("regions (850 hPa, teacher vs model mean, m/s):");
  for (const r of regionRows) {
    if (!r.old || !r.new) { console.log(`  ${r.label.padEnd(18)} (no data)`); continue; }
    console.log(`  ${r.label.padEnd(18)} teacher u=${f(r.old.teacherU)} v=${f(r.old.teacherV)} spd=${f(r.old.teacherSpeed)}`);
    console.log(`  ${"".padEnd(18)} old     u=${f(r.old.modelU)} v=${f(r.old.modelV)} spd=${f(r.old.modelSpeed)}`);
    console.log(`  ${"".padEnd(18)} new     u=${f(r.new.modelU)} v=${f(r.new.modelV)} spd=${f(r.new.modelSpeed)}`);
  }
  console.log("");
  console.log(`performance: ${f(perfMs, 1)} ms for a ${WIND_GRID.width}x${WIND_GRID.height} global field, ${(fieldBytes / 1024 / 1024).toFixed(2)} MB of output arrays`);
}

main();
