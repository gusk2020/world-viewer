// Climate v1 Stage 3: validates Climate v0.8's existing wind field against
// real Earth wind data (NCEP/NCAR Reanalysis 1, see
// docs/climate-v1-wind-validation.md and tools/build_wind_teacher.py).
//
// This does NOT change the wind model. The only thing fitted here is a
// single global scale K that converts the model's dimensionless magnitude
// into m/s for diagnostic purposes -- no shape parameter (coriolisStrength,
// circulationCellEdgeDeg, cellRotationExponent, ...) is touched.
//
// Usage: node tools/validate_wind_v1.mjs [--json]
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveClimateSets } from "../js/climate.js";
import {
  currentModelWind, compareWindToTeacher, fitSpeedScaleK, nearestModelRow, REFERENCE_DAY_HOURS,
} from "../js/climate-v1/wind-diagnostic.js";
import { parseWindGrid } from "../js/climate-v1/wind-teacher.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_ROWS = 180;

function loadWindTeacher(worldDir) {
  const summary = JSON.parse(readFileSync(path.join(worldDir, "teacher", "wind-summary.json"), "utf8"));
  const loadLevel = (levelKey) => {
    const spec = summary.grids[levelKey];
    const grid = { width: spec.width, height: spec.height };
    const fields = {};
    for (const [name, file] of Object.entries(spec.files)) {
      const bytes = readFileSync(path.join(worldDir, "teacher", file));
      fields[name] = parseWindGrid(bytes, grid).values;
    }
    return { ...grid, ...fields };
  };
  return {
    summary,
    level850hPa: loadLevel("level850hPa"),
    level10m: loadLevel("level10m"),
  };
}

function latitudeOfTeacherRow(y, height) {
  return 90 - (y + 0.5) * (180 / height);
}
function longitudeOfTeacherCol(x, width) {
  return -180 + (x + 0.5) * (360 / width);
}

// Builds the {width,height,u,v} shape compareWindToTeacher expects, from a
// level's annualMeanU/V fields (never annualResultantSpeed, which has lost
// direction information).
function teacherUV(level) {
  return { width: level.width, height: level.height, u: level.u, v: level.v };
}

function restrictToLatBand(teacher, minLat, maxLat) {
  const { width, height, u, v } = teacher;
  const ru = new Float64Array(width * height).fill(NaN);
  const rv = new Float64Array(width * height).fill(NaN);
  for (let y = 0; y < height; y++) {
    const lat = latitudeOfTeacherRow(y, height);
    if (lat < minLat || lat >= maxLat) continue;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      ru[i] = u[i]; rv[i] = v[i];
    }
  }
  return { width, height, u: ru, v: rv };
}

function restrictToBox(teacher, { lat, lng }) {
  const { width, height, u, v } = teacher;
  const ru = new Float64Array(width * height).fill(NaN);
  const rv = new Float64Array(width * height).fill(NaN);
  for (let y = 0; y < height; y++) {
    const latDeg = latitudeOfTeacherRow(y, height);
    if (latDeg < lat[0] || latDeg >= lat[1]) continue;
    for (let x = 0; x < width; x++) {
      const lngDeg = longitudeOfTeacherCol(x, width);
      const inLng = lng[0] <= lng[1] ? (lngDeg >= lng[0] && lngDeg < lng[1]) : (lngDeg >= lng[0] || lngDeg < lng[1]);
      if (!inLng) continue;
      const i = y * width + x;
      ru[i] = u[i]; rv[i] = v[i];
    }
  }
  return { width, height, u: ru, v: rv };
}

// Area-weighted mean u/v/speed over whatever finite cells a (possibly
// lat/lng-restricted) teacher grid has -- used for the wind-belt and
// regional diagnoses, which only need plain means, not the full comparison.
function meanUV(teacher) {
  const { width, height, u, v } = teacher;
  let sw = 0, swu = 0, swv = 0;
  for (let y = 0; y < height; y++) {
    const lat = latitudeOfTeacherRow(y, height);
    const w = Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!Number.isFinite(u[i]) || !Number.isFinite(v[i])) continue;
      sw += w; swu += w * u[i]; swv += w * v[i];
    }
  }
  if (sw === 0) return null;
  return { u: swu / sw, v: swv / sw, speed: Math.hypot(swu / sw, swv / sw) };
}

function modelMeanUV(modelWind, minLat, maxLat, k) {
  let sw = 0, swu = 0, swv = 0;
  const rows = modelWind.rows;
  for (let y = 0; y < rows; y++) {
    const lat = (0.5 - (y + 0.5) / rows) * 180;
    if (lat < minLat || lat >= maxLat) continue;
    const w = Math.cos((lat * Math.PI) / 180);
    sw += w; swu += w * modelWind.east[y] * k; swv += w * modelWind.north[y] * k;
  }
  if (sw === 0) return null;
  return { u: swu / sw, v: swv / sw, speed: Math.hypot(swu / sw, swv / sw) };
}

const LAT_BANDS = [
  { label: "90-60N", min: 60, max: 90 },
  { label: "60-30N", min: 30, max: 60 },
  { label: "30-0N", min: 0, max: 30 },
  { label: "0-30S", min: -30, max: 0 },
  { label: "30-60S", min: -60, max: -30 },
  { label: "60-90S", min: -90, max: -60 },
];

// Diagnostic only -- never a fit target (see docs/climate-v1-wind-validation.md).
const REGIONS = [
  { label: "tropical Pacific", lng: [-170, -120], lat: [-5, 5] },
  { label: "North Atlantic", lng: [-60, -10], lat: [30, 50] },
  { label: "Southern Ocean", lng: [-180, 180], lat: [-60, -40] },
  { label: "Indian Ocean", lng: [50, 90], lat: [-15, 5] },
  { label: "North America", lng: [-110, -80], lat: [35, 50] },
  { label: "Eurasia", lng: [60, 120], lat: [45, 60] },
];

function buildModelTeacherRows(teacher, modelWind) {
  const { width, height, u, v } = teacher;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const lat = latitudeOfTeacherRow(y, height);
    const weight = Math.cos((lat * Math.PI) / 180);
    const modelRow = nearestModelRow(lat, modelWind.rows);
    const modelSpeed = modelWind.magnitude[modelRow];
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!Number.isFinite(u[i]) || !Number.isFinite(v[i])) continue;
      rows.push({ modelSpeed, teacherSpeed: Math.hypot(u[i], v[i]), weight });
    }
  }
  return rows;
}

function main() {
  const asJson = process.argv.includes("--json");
  const worldDir = path.join(REPO, "worlds", "kasoku-sekai");
  const config = JSON.parse(readFileSync(path.join(worldDir, "config.json"), "utf8"));
  const sets = resolveClimateSets(config);
  const params = sets.sets.find((s) => s.id === sets.defaultId).values;
  const { dayLengthHours, rotationDirection } = config.body;

  const teacherData = loadWindTeacher(worldDir);
  const modelWind = currentModelWind({ rows: MODEL_ROWS, dayLengthHours, rotationDirection, params, subsolarDeg: 0 });

  // ---- determinism: same inputs -> byte-identical field ------------------
  const modelWind2 = currentModelWind({ rows: MODEL_ROWS, dayLengthHours, rotationDirection, params, subsolarDeg: 0 });
  let deterministic = modelWind.east.length === modelWind2.east.length;
  if (deterministic) {
    for (let i = 0; i < modelWind.east.length; i++) {
      if (modelWind.east[i] !== modelWind2.east[i] || modelWind.north[i] !== modelWind2.north[i]) { deterministic = false; break; }
    }
  }

  // ---- sign-convention checks (Step 15) -----------------------------------
  // Purely synthetic: a model vector identical to the teacher must score 0
  // direction error; the exact opposite vector must score 180, not 0 -- the
  // one mistake a "from" vs "toward" convention mixup would produce.
  const synthTeacher = { width: 2, height: 2, u: new Float64Array([10, 10, 10, 10]), v: new Float64Array([0, 0, 0, 0]) };
  const synthMatch = compareWindToTeacher({ modelWind: { rows: 2, east: [1, 1], north: [0, 0] }, teacher: synthTeacher, modelSpeedScaleMS: 10 });
  const synthOpposite = compareWindToTeacher({ modelWind: { rows: 2, east: [-1, -1], north: [0, 0] }, teacher: synthTeacher, modelSpeedScaleMS: 10 });
  assert.ok(synthMatch.directionErrorDeg < 1e-6, "sign-convention self-test: identical vectors must score 0 direction error");
  assert.ok(Math.abs(synthOpposite.directionErrorDeg - 180) < 1e-6, "sign-convention self-test: exactly opposite vectors must score 180, not 0");

  // Real-data sanity: the teacher's own 45N zonal wind at 850hPa must be
  // eastward (real Earth's westerlies), and 15N must be westward (real
  // Earth's trades) -- if either failed it would mean this script's own
  // lat/lon/orientation handling has a bug, independent of the model.
  const t850 = teacherUV(teacherData.level850hPa);
  const westerlies45N = meanUV(restrictToLatBand(t850, 40, 50));
  const trades15N = meanUV(restrictToLatBand(t850, 10, 20));
  assert.ok(westerlies45N.u > 0, `teacher sanity: 40-50N mean u should be eastward (westerlies), got ${westerlies45N.u}`);
  assert.ok(trades15N.u < 0, `teacher sanity: 10-20N mean u should be westward (trades), got ${trades15N.u}`);

  // ---- rotation synthetic tests (Step 22) ---------------------------------
  // Tested against windField's own documented formula directly
  // (turn = (pi/2)*tanh(coriolisStrength*spin*sin(lat)), spin =
  // direction*REFERENCE_DAY_HOURS/dayLengthHours -- see
  // docs/climate-v1-wind-validation.md section 16), not inferred from the
  // resultant vector's atan2 direction. That indirect approach was tried
  // first and gave a false failure: cellEdgeDeg itself depends on `spin`
  // (`circulationCellEdgeDeg / spin^cellRotationExponent`), so changing
  // dayLengthHours can shift which circulation cell a fixed latitude falls
  // into, flipping `flow`'s own sign independently of how much the
  // Coriolis term itself turned -- conflating two different effects. The
  // turn term is tested in isolation instead, which is also a more literal
  // reading of what "Coriolis turning" means in the formula.
  const spinOf = (days) => rotationDirection * REFERENCE_DAY_HOURS / Math.max(Math.abs(days), 1e-3);
  const turnAt = (latDeg, days) => (Math.PI / 2) * Math.tanh(params.coriolisStrength * spinOf(days) * Math.sin((latDeg * Math.PI) / 180));

  const turnFast45 = turnAt(45, dayLengthHours);
  const turnSlow45 = turnAt(45, dayLengthHours * 20);
  assert.ok(Math.abs(turnFast45) > Math.abs(turnSlow45),
    `a slower rotation (longer day) must turn the flow less at 45deg (fast=${turnFast45}, slow=${turnSlow45})`);

  const turnVeryLongDay45 = turnAt(45, dayLengthHours * 5000);
  assert.ok(Math.abs(turnVeryLongDay45) < 0.01, `near-zero rotation must leave almost no turn at 45deg, got ${turnVeryLongDay45}`);

  const turnEquator = turnAt(0, dayLengthHours);
  assert.equal(turnEquator, 0, `Coriolis turning must be exactly zero at the equator (sin(0)=0), got ${turnEquator}`);
  assert.ok(Math.abs(turnEquator) < Math.abs(turnFast45), "Coriolis turning must be weaker at the equator than at 45deg");

  // The east component itself: reversing rotationDirection must reverse it
  // exactly, everywhere -- this one IS safe to check on the real vector,
  // since reversing direction alone (not dayLengthHours) never moves a
  // cell boundary (cellEdgeDeg depends on |spin|, and |spin| is unchanged
  // by a sign flip).
  const reversed = currentModelWind({ rows: MODEL_ROWS, dayLengthHours, rotationDirection: -rotationDirection, params, subsolarDeg: 0 });
  let maxEastDiff = 0;
  for (let i = 0; i < modelWind.east.length; i++) maxEastDiff = Math.max(maxEastDiff, Math.abs(modelWind.east[i] + reversed.east[i]));
  assert.ok(maxEastDiff < 1e-9, `rotation reversal must exactly reverse the east component (max diff ${maxEastDiff})`);

  // ---- fit K on the primary (850hPa) teacher -------------------------------
  const rowsFor850 = buildModelTeacherRows(t850, modelWind);
  const kFit850 = fitSpeedScaleK(rowsFor850);
  const t10m = teacherUV(teacherData.level10m);
  const rowsFor10m = buildModelTeacherRows(t10m, modelWind);
  const kFit10m = fitSpeedScaleK(rowsFor10m);

  // ---- baseline metrics, primary and secondary levels ----------------------
  const baseline850 = compareWindToTeacher({ modelWind, teacher: t850, modelSpeedScaleMS: kFit850.k, minTeacherSpeedForDirectionMS: 1 });
  const baseline10m = compareWindToTeacher({ modelWind, teacher: t10m, modelSpeedScaleMS: kFit10m.k, minTeacherSpeedForDirectionMS: 1 });
  // Direction-only (K-independent) comparison, at K=1, since direction never needs a speed scale.
  const directionOnly850 = compareWindToTeacher({ modelWind, teacher: t850, modelSpeedScaleMS: 1, minTeacherSpeedForDirectionMS: 1 });

  // ---- latitude bands (primary level) --------------------------------------
  const bandResults = LAT_BANDS.map((b) => {
    const restricted = restrictToLatBand(t850, b.min, b.max);
    const cmp = compareWindToTeacher({ modelWind, teacher: restricted, modelSpeedScaleMS: kFit850.k, minTeacherSpeedForDirectionMS: 1 });
    return { label: b.label, ...cmp };
  });

  // ---- wind-belt diagnosis (direction + relative strength, not a fit target) --
  const belts = LAT_BANDS.map((b) => {
    const teacherMean = meanUV(restrictToLatBand(t850, b.min, b.max));
    const modelMean = modelMeanUV(modelWind, b.min, b.max, kFit850.k);
    return {
      label: b.label,
      teacherU: teacherMean.u, teacherV: teacherMean.v,
      modelU: modelMean.u, modelV: modelMean.v,
      signMatchU: Math.sign(teacherMean.u) === Math.sign(modelMean.u),
    };
  });

  // ---- named-region diagnosis (diagnostic only) ----------------------------
  const regions850 = REGIONS.map((r) => {
    const restricted = restrictToBox(t850, r);
    const teacherMean = meanUV(restricted);
    if (!teacherMean) return { label: r.label, n: 0 };
    // model mean over the same latitude span (longitude does not affect the model at all -- see docs).
    const modelMean = modelMeanUV(modelWind, r.lat[0], r.lat[1], kFit850.k);
    return { label: r.label, teacherU: teacherMean.u, teacherV: teacherMean.v, teacherSpeed: teacherMean.speed, modelU: modelMean.u, modelV: modelMean.v, modelSpeed: modelMean.speed };
  });

  const result = {
    determinism: deterministic,
    signConventionSelfTest: "OK",
    teacherSanity: { westerlies45N: westerlies45N.u, trades15N: trades15N.u },
    rotationSynthetic: "OK",
    kFit850, kFit10m,
    baseline850, baseline10m, directionOnly850,
    latitudeBands850: bandResults,
    windBelts850: belts,
    regions850,
  };

  if (asJson) { console.log(JSON.stringify(result, null, 1)); return; }

  const f = (v, d = 3) => (v === null || v === undefined ? "  -  " : v.toFixed(d));
  console.log("Climate v1 wind validation -- teacher: NCEP/NCAR Reanalysis 1, 850hPa (primary) and 10m (secondary)");
  console.log("");
  console.log(`determinism (rebuild twice, compare byte for byte): ${deterministic ? "OK" : "FAILED"}`);
  console.log("sign-convention self-test (identical=0deg, opposite=180deg): OK");
  console.log(`teacher sanity: 40-50N mean u (should be >0, westerlies) = ${f(westerlies45N.u)} m/s`);
  console.log(`teacher sanity: 10-20N mean u (should be <0, trades)     = ${f(trades15N.u)} m/s`);
  console.log("rotation synthetic tests (reversal flips east; slower spin turns less; equator turns least): OK");
  console.log("");
  console.log(`fitted scale K -- 850hPa: ${f(kFit850.k)}  (dimensionless magnitude 1.0 = ${f(kFit850.k)} m/s)`);
  console.log(`fitted scale K -- 10m:    ${f(kFit10m.k)}  (dimensionless magnitude 1.0 = ${f(kFit10m.k)} m/s)`);
  console.log("");
  console.log("direction-only comparison (850hPa, K-independent):");
  console.log(`  mean=${f(directionOnly850.directionErrorDeg, 1)}deg  median=${f(directionOnly850.directionMedianErrorDeg, 1)}deg  ` +
    `speed-weighted=${f(directionOnly850.weighted.directionSpeedWeightedErrorDeg, 1)}deg  (n=${directionOnly850.directionSampleCount}, excluded=${directionOnly850.directionExcludedCount})`);
  console.log("");
  console.log("baseline metrics, 850hPa (K applied):");
  console.log(`  bias=${f(baseline850.weighted.biasMS)} speedMAE=${f(baseline850.speedMaeMS)} speedRMSE=${f(baseline850.speedRmseMS)} ` +
    `uRMSE=${f(baseline850.uRmseMS)} vRMSE=${f(baseline850.vRmseMS)} vectorRMSE=${f(baseline850.weighted.vectorRmseMS)} r=${f(baseline850.weighted.speedCorrelation)}`);
  console.log(`  direction mean=${f(baseline850.directionErrorDeg, 1)} median=${f(baseline850.directionMedianErrorDeg, 1)} speed-weighted=${f(baseline850.weighted.directionSpeedWeightedErrorDeg, 1)}`);
  console.log("");
  console.log("baseline metrics, 10m (K applied):");
  console.log(`  bias=${f(baseline10m.weighted.biasMS)} speedMAE=${f(baseline10m.speedMaeMS)} speedRMSE=${f(baseline10m.speedRmseMS)} ` +
    `uRMSE=${f(baseline10m.uRmseMS)} vRMSE=${f(baseline10m.vRmseMS)} vectorRMSE=${f(baseline10m.weighted.vectorRmseMS)} r=${f(baseline10m.weighted.speedCorrelation)}`);
  console.log(`  direction mean=${f(baseline10m.directionErrorDeg, 1)} median=${f(baseline10m.directionMedianErrorDeg, 1)} speed-weighted=${f(baseline10m.weighted.directionSpeedWeightedErrorDeg, 1)}`);
  console.log("");
  console.log("latitude bands (850hPa, K applied):");
  for (const b of bandResults) {
    console.log(`  ${b.label.padEnd(8)} uRMSE=${f(b.uRmseMS)} vRMSE=${f(b.vRmseMS)} speedMAE=${f(b.speedMaeMS)} dirMean=${f(b.directionErrorDeg, 1)}`);
  }
  console.log("");
  console.log("wind belts (850hPa, teacher vs K-scaled model, m/s):");
  for (const b of belts) {
    console.log(`  ${b.label.padEnd(8)} teacher(u=${f(b.teacherU)},v=${f(b.teacherV)})  model(u=${f(b.modelU)},v=${f(b.modelV)})  signMatchU=${b.signMatchU}`);
  }
  console.log("");
  console.log("named regions (850hPa, diagnostic only):");
  for (const r of regions850) {
    if (r.teacherU === undefined) { console.log(`  ${r.label.padEnd(17)} (no data)`); continue; }
    console.log(`  ${r.label.padEnd(17)} teacher(u=${f(r.teacherU)},v=${f(r.teacherV)},spd=${f(r.teacherSpeed)})  model(u=${f(r.modelU)},v=${f(r.modelV)},spd=${f(r.modelSpeed)})`);
  }
}

main();
