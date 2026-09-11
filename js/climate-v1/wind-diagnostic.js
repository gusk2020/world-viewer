// Climate v1's wind diagnostic foundation -- stage 4 of the redesigned
// pipeline, and the last stage built this round (see
// docs/climate-v1-redesign.md). This is deliberately **not** a new wind
// model: it exists to (a) say precisely, from the code, what Climate v0.8's
// existing wind field actually computes, and (b) give a real, runnable way
// to compare it against Earth wind data once a teacher grid is available.
// Nothing here changes what the app draws.
//
// -----------------------------------------------------------------------
// What Climate v0.8's wind field actually is (read from js/climate.js's
// windField, not guessed):
//
//   east[y] = flow * sin(turn)      north[y] = flow * cos(turn)
//   flow = -sin(phase),  phase = pi * (latDeg - subsolarDeg) / cellEdgeDeg
//   turn = (pi/2) * tanh(coriolisStrength * spin * sin(latRad))
//
// `flow` is bounded to [-1, 1] by construction (it is a sine), and
// sin(turn)^2 + cos(turn)^2 = 1, so sqrt(east^2 + north^2) = |flow| <= 1
// always. There is no calibration constant anywhere in this formula that
// converts it to metres per second -- **this field is dimensionless and
// direction-plus-relative-strength only, not a physical wind speed.**
//
// It is also a function of latitude alone (windField takes `rows`, not a
// width x height grid): every column at a given latitude gets the same
// east/north value from this function. The longitude-dependent ITCZ
// mechanism (itczShiftByColumn) changes which of two precomputed wind
// fields a given column's moisture sweep uses (a per-column *choice*
// between the row's own direction and its reverse), but it does not alter
// the two dimensionless vectors being chosen between, nor does it produce a
// genuinely 2-D wind grid anywhere the app keeps.
//
// Confirmed directly in moistureField (js/climate.js): `speed =
// Math.hypot(eastV, northV)` is computed and used for exactly two things --
// a dead-calm check (`speed > 1e-6`) and normalising the direction
// (`eastV / speed`, `northV / speed`) before taking one fixed-size upwind
// grid step. The magnitude of the wind is **never** used to scale how far
// or how much moisture is carried; only the direction survives past that
// normalisation. So today's model already treats "how far moisture travels"
// as a separate question from "which way the wind blows" -- it just has no
// real wind-speed number feeding either one yet.
// -----------------------------------------------------------------------
import { windField, REFERENCE_DAY_HOURS } from "../climate.js";

/**
 * The current model's wind, exposed for inspection exactly as
 * computeClimate consumes it -- one (east, north) pair per latitude row,
 * explicitly labelled as dimensionless. Does not touch or duplicate
 * windField's formula; this is a thin, clearly-labelled wrapper around it.
 */
export function currentModelWind({ rows, dayLengthHours, rotationDirection, params, subsolarDeg = 0 }) {
  const field = windField(rows, dayLengthHours, rotationDirection, params, subsolarDeg);
  return {
    rows: field.rows,
    east: field.east,
    north: field.north,
    magnitude: Float64Array.from(field.east, (_, i) => Math.hypot(field.east[i], field.north[i])),
    units: "dimensionless (0..1); NOT metres per second",
    varyByLongitude: false,
  };
}

function latitudeDegOfRow(y, rows) {
  return (0.5 - (y + 0.5) / rows) * 180;
}

/** The model row nearest a given latitude, at a given row count -- the one
 * mapping every "sample the model at this teacher cell's latitude" lookup
 * in this file goes through, exported so tools/validate_wind_v1.mjs's own
 * scale-K fit uses the exact same row a later compareWindToTeacher call
 * will use for that cell, rather than a second, potentially-drifting
 * version of the same arithmetic. */
export function nearestModelRow(latDeg, rows) {
  return Math.min(rows - 1, Math.max(0, Math.round(((0.5 - latDeg / 180) * rows) - 0.5)));
}

/**
 * Direction, in the usual meteorological "from" convention is deliberately
 * NOT computed here -- this project has no wind-rose display and adding one
 * would be new UI this round explicitly does not need. `directionErrorDeg`
 * below works directly in u/v space instead.
 */
function angleBetweenDeg(eastA, northA, eastB, northB) {
  const magA = Math.hypot(eastA, northA);
  const magB = Math.hypot(eastB, northB);
  if (!(magA > 0) || !(magB > 0)) return null;
  const cos = Math.min(1, Math.max(-1, (eastA * eastB + northA * northB) / (magA * magB)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Compares the current model's (dimensionless) wind against a real teacher
 * wind grid, in the five measures the task asks for: speed MAE, speed RMSE,
 * u RMSE, v RMSE, and mean direction-angle error.
 *
 * **This function does not know or care where `teacher` came from.** It
 * takes `{ width, height, u, v }` in real m/s (row 0 = north pole, column 0
 * = -180 degrees, the same convention every other grid in this app uses)
 * and a `modelSpeedScaleMS` -- an explicit, named "if the model's
 * dimensionless flow of 1.0 meant this many m/s, how would it compare"
 * question. No calibration is chosen or searched for here; the caller
 * supplies whatever scale it wants to test, including 1.0 to compare raw
 * magnitudes. This keeps "the model has no real wind-speed number yet" an
 * honest, visible fact rather than something a default silently papers
 * over.
 *
 * `minTeacherSpeedForDirectionMS`: direction is not a meaningful quantity
 * where the real wind is near calm (a 0.1 m/s wind's "direction" is mostly
 * noise), so teacher cells slower than this are excluded from the direction
 * error rather than folded in and diluting it. See
 * docs/climate-v1-redesign.md for the candidate threshold values considered
 * and why none has been chosen as final yet -- this parameter is a named
 * input, not a hidden constant, precisely so nothing here has quietly
 * pre-decided that question.
 *
 * Returns both **unweighted** metrics (every finite teacher cell counted
 * equally -- kept exactly as Stage 0-1 defined them, so its own self-test
 * stays valid unchanged) and, nested under `weighted`, the same metrics
 * **area-weighted by cos(latitude)** -- the same weighting
 * validate_temperature_v1.mjs uses, since an equirectangular grid otherwise
 * gives a polar cell as much say as an equatorial one while it covers a
 * fraction of the real ground. `weighted` also carries the extra measures
 * Stage 3 needs that Stage 0-1's foundation did not: bias, a speed
 * correlation, the median direction error, and the direction error weighted
 * by the teacher's own wind speed (so a strong, confidently-measured trade
 * wind counts for more than a barely-above-threshold breeze).
 */
export function compareWindToTeacher({
  modelWind, teacher, modelSpeedScaleMS = 1, minTeacherSpeedForDirectionMS = 1,
}) {
  if (!teacher || !teacher.u || !teacher.v) {
    throw new Error("compareWindToTeacher requires a teacher grid { width, height, u, v } in m/s");
  }
  const { width, height, u: teacherU, v: teacherV } = teacher;
  let n = 0;
  let sumAbsSpeedErr = 0;
  let sumSqSpeedErr = 0;
  let sumSqUErr = 0;
  let sumSqVErr = 0;
  let dirCount = 0;
  let sumDirErr = 0;

  let sw = 0;
  let swSpeedErr = 0, swAbsSpeedErr = 0, swSqSpeedErr = 0, swSqUErr = 0, swSqVErr = 0;
  let swModelSpeed = 0, swTeacherSpeed = 0, swModelSpeedSq = 0, swTeacherSpeedSq = 0, swSpeedCov = 0;
  let swDirCount = 0, swDirWeightSum = 0, swSumDirErr = 0, swSumDirWeight = 0, swSumDirWeightedErr = 0;
  const dirErrors = [];

  for (let y = 0; y < height; y++) {
    const latDeg = latitudeDegOfRow(y, height);
    const weight = Math.cos((latDeg * Math.PI) / 180);
    const modelRow = nearestModelRow(latDeg, modelWind.rows);
    const modelEastMS = modelWind.east[modelRow] * modelSpeedScaleMS;
    const modelNorthMS = modelWind.north[modelRow] * modelSpeedScaleMS;
    const modelSpeedMS = Math.hypot(modelEastMS, modelNorthMS);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const tU = teacherU[i];
      const tV = teacherV[i];
      if (!Number.isFinite(tU) || !Number.isFinite(tV)) continue; // e.g. a land mask on an ocean-only product, or below-ground at 850hPa
      const teacherSpeedMS = Math.hypot(tU, tV);

      n++;
      const speedErr = modelSpeedMS - teacherSpeedMS;
      sumAbsSpeedErr += Math.abs(speedErr);
      sumSqSpeedErr += speedErr * speedErr;
      sumSqUErr += (modelEastMS - tU) ** 2;
      sumSqVErr += (modelNorthMS - tV) ** 2;

      sw += weight;
      swSpeedErr += weight * speedErr;
      swAbsSpeedErr += weight * Math.abs(speedErr);
      swSqSpeedErr += weight * speedErr * speedErr;
      swSqUErr += weight * (modelEastMS - tU) ** 2;
      swSqVErr += weight * (modelNorthMS - tV) ** 2;
      swModelSpeed += weight * modelSpeedMS;
      swTeacherSpeed += weight * teacherSpeedMS;
      swModelSpeedSq += weight * modelSpeedMS * modelSpeedMS;
      swTeacherSpeedSq += weight * teacherSpeedMS * teacherSpeedMS;
      swSpeedCov += weight * modelSpeedMS * teacherSpeedMS;

      if (teacherSpeedMS >= minTeacherSpeedForDirectionMS) {
        const angle = angleBetweenDeg(modelEastMS, modelNorthMS, tU, tV);
        if (angle !== null) {
          dirCount++; sumDirErr += angle;
          dirErrors.push(angle);
          swDirCount++; swDirWeightSum += weight; swSumDirErr += weight * angle;
          const speedWeight = weight * teacherSpeedMS;
          swSumDirWeight += speedWeight; swSumDirWeightedErr += speedWeight * angle;
        }
      }
    }
  }

  if (n === 0) return null;

  dirErrors.sort((a, b) => a - b);
  const median = dirErrors.length > 0
    ? (dirErrors.length % 2 === 1
      ? dirErrors[(dirErrors.length - 1) / 2]
      : (dirErrors[dirErrors.length / 2 - 1] + dirErrors[dirErrors.length / 2]) / 2)
    : null;

  const meanModelSpeed = swModelSpeed / sw, meanTeacherSpeed = swTeacherSpeed / sw;
  const varModel = swModelSpeedSq / sw - meanModelSpeed * meanModelSpeed;
  const varTeacher = swTeacherSpeedSq / sw - meanTeacherSpeed * meanTeacherSpeed;
  const cov = swSpeedCov / sw - meanModelSpeed * meanTeacherSpeed;
  const speedCorrelation = varModel > 0 && varTeacher > 0 ? cov / Math.sqrt(varModel * varTeacher) : null;

  return {
    n,
    speedMaeMS: sumAbsSpeedErr / n,
    speedRmseMS: Math.sqrt(sumSqSpeedErr / n),
    uRmseMS: Math.sqrt(sumSqUErr / n),
    vRmseMS: Math.sqrt(sumSqVErr / n),
    directionErrorDeg: dirCount > 0 ? sumDirErr / dirCount : null,
    directionMedianErrorDeg: median,
    directionSampleCount: dirCount,
    directionExcludedCount: n - dirCount,
    minTeacherSpeedForDirectionMS,
    modelSpeedScaleMS,
    weighted: {
      biasMS: swSpeedErr / sw,
      speedMaeMS: swAbsSpeedErr / sw,
      speedRmseMS: Math.sqrt(swSqSpeedErr / sw),
      uRmseMS: Math.sqrt(swSqUErr / sw),
      vRmseMS: Math.sqrt(swSqVErr / sw),
      vectorRmseMS: Math.sqrt((swSqUErr + swSqVErr) / sw),
      speedCorrelation,
      directionMeanErrorDeg: swDirWeightSum > 0 ? swSumDirErr / swDirWeightSum : null,
      directionSpeedWeightedErrorDeg: swSumDirWeight > 0 ? swSumDirWeightedErr / swSumDirWeight : null,
    },
  };
}

/**
 * Fits the single global scale K that best turns the model's dimensionless
 * magnitude into m/s, by ordinary least squares: minimises
 * sum(w * (K*modelSpeed - teacherSpeed)^2), which has the closed form
 * K = sum(w*modelSpeed*teacherSpeed) / sum(w*modelSpeed^2).
 *
 * **This is a unit conversion for diagnosis, not a new wind model.** It
 * changes no shape parameter of `windField` -- not coriolisStrength, not
 * circulationCellEdgeDeg, nothing -- it only asks "if the model's
 * dimensionless flow of 1.0 meant K m/s, how would the resulting speed
 * pattern compare to reality". Stage 3's brief explicitly permits exactly
 * this one number and nothing else to be fitted this round.
 */
export function fitSpeedScaleK(rows) {
  let sw = 0, swmt = 0, swmm = 0;
  for (const { modelSpeed, teacherSpeed, weight = 1 } of rows) {
    if (!Number.isFinite(modelSpeed) || !Number.isFinite(teacherSpeed)) continue;
    sw += weight;
    swmt += weight * modelSpeed * teacherSpeed;
    swmm += weight * modelSpeed * modelSpeed;
  }
  if (swmm <= 0) return null;
  return { k: swmt / swmm, n: sw };
}

/** The model's dimensionless wind, scaled by a single K into m/s -- see
 * fitSpeedScaleK. Labelled explicitly so a caller can never mistake this
 * for a real, independently-derived m/s wind field. */
export function scaledModelWindMs(modelWind, k) {
  return {
    rows: modelWind.rows,
    east: Float64Array.from(modelWind.east, (v) => v * k),
    north: Float64Array.from(modelWind.north, (v) => v * k),
    magnitude: Float64Array.from(modelWind.magnitude, (v) => v * k),
    units: "m/s (diagnostic only -- derived from a single fitted global scale K, not a real wind speed)",
    k,
  };
}

export { REFERENCE_DAY_HOURS };
