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

  for (let y = 0; y < height; y++) {
    const latDeg = latitudeDegOfRow(y, height);
    const modelRow = Math.min(modelWind.rows - 1, Math.max(0, Math.round(((0.5 - latDeg / 180) * modelWind.rows) - 0.5)));
    const modelEastMS = modelWind.east[modelRow] * modelSpeedScaleMS;
    const modelNorthMS = modelWind.north[modelRow] * modelSpeedScaleMS;
    const modelSpeedMS = Math.hypot(modelEastMS, modelNorthMS);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const tU = teacherU[i];
      const tV = teacherV[i];
      if (!Number.isFinite(tU) || !Number.isFinite(tV)) continue; // e.g. a land mask on an ocean-only product
      const teacherSpeedMS = Math.hypot(tU, tV);

      n++;
      const speedErr = modelSpeedMS - teacherSpeedMS;
      sumAbsSpeedErr += Math.abs(speedErr);
      sumSqSpeedErr += speedErr * speedErr;
      sumSqUErr += (modelEastMS - tU) ** 2;
      sumSqVErr += (modelNorthMS - tV) ** 2;

      if (teacherSpeedMS >= minTeacherSpeedForDirectionMS) {
        const angle = angleBetweenDeg(modelEastMS, modelNorthMS, tU, tV);
        if (angle !== null) { dirCount++; sumDirErr += angle; }
      }
    }
  }

  if (n === 0) return null;
  return {
    n,
    speedMaeMS: sumAbsSpeedErr / n,
    speedRmseMS: Math.sqrt(sumSqSpeedErr / n),
    uRmseMS: Math.sqrt(sumSqUErr / n),
    vRmseMS: Math.sqrt(sumSqVErr / n),
    directionErrorDeg: dirCount > 0 ? sumDirErr / dirCount : null,
    directionSampleCount: dirCount,
    directionExcludedCount: n - dirCount,
    minTeacherSpeedForDirectionMS,
    modelSpeedScaleMS,
  };
}

export { REFERENCE_DAY_HOURS };
