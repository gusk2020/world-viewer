// The calendar, and the harmonic analysis of a twelve-month series.
//
// **This is the only place in the project that knows what a month is.**
// `js/climate-v1/season.js` runs on `orbitalPhase`, whose 0 is the ascending
// equinox on any world, and must stay that way. Berkeley Earth's teacher is
// on the Gregorian calendar. This module joins the two, and it is shared by
// `validate_seasonal_temperature.mjs` and `search_seasonal_temperature.mjs`
// so the measurement and the search cannot drift apart -- the same rule that
// keeps `classifyPoint` shared between the painter and the scorer.
import { SEASON_PARAMETERS } from "../js/climate-v1/season.js";

/**
 * Earth's real orbit, as a CALIBRATION CONDITION of these tools only.
 *
 * Physical facts about the body, never fitted (the calibration audit lists
 * Earth's tilt, eccentricity and periapsis among the values that may never
 * be fitted). Supplied here rather than written into the world's config
 * because the config's job is what the app draws, and the app still draws
 * the circular orbit the user has already confirmed.
 *
 * Fitting a real Earth to a circular model would push the hemispheric
 * asymmetry that the periapsis direction really causes into
 * `seasonalDampingWPerM2K` or a heat capacity -- a compensating error of
 * exactly the kind docs/climate-v1-calibration-audit.md exists to prevent.
 */
export const EARTH_CALIBRATION_ORBIT = {
  axialTiltDegrees: 23.44,
  orbitalEccentricity: 0.0167,
  periapsisLongitudeDeg: 283,
};

/**
 * The March (ascending) equinox as a day of year, counting Jan 1 00:00 as 0.
 * Mean instant over 1991-2020 is about March 20.35 UTC:
 *   31 (Jan) + 28.2425 (Feb, the tropical-year average) + 19.35 = 78.59.
 *
 * This constant lands on the reported phase BIAS one for one -- the model's
 * peak is fixed to the equinox while the teacher's twelve numbers are not --
 * so a 1-day error moves every phase bias by 1 day. Measured, not argued;
 * see docs/climate-v1-seasonal-temperature-baseline.md.
 */
export const MARCH_EQUINOX_DAY_OF_YEAR = 78.59;

/** Real Gregorian month lengths, February carrying the average 28.2425 so
 * the twelve sum to the tropical year the season table itself uses. */
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_DAYS = [31, 28.2425, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_DAYS_TOTAL = MONTH_DAYS.reduce((a, b) => a + b, 0);

/**
 * Each calendar month as an INTERVAL on the model's [0,1) phase axis.
 *
 * A month is an interval, not an instant: Berkeley Earth's July value is the
 * mean over July, so the model has to be averaged over the same window. The
 * widths differ because the month lengths do.
 */
export function monthIntervals(yearDays, equinoxDay = MARCH_EQUINOX_DAY_OF_YEAR) {
  const intervals = [];
  let day = 0;
  for (let m = 0; m < 12; m++) {
    const start = (day - equinoxDay) / yearDays;
    const end = (day + MONTH_DAYS[m] - equinoxDay) / yearDays;
    intervals.push({
      month: m, name: MONTH_NAMES[m], days: MONTH_DAYS[m],
      startPhase: start, endPhase: end, centrePhase: (start + end) / 2,
      centreWrapped: ((((start + end) / 2) % 1) + 1) % 1,
    });
    day += MONTH_DAYS[m];
  }
  return intervals;
}

/**
 * The EXACT mean of each harmonic over each month's own interval:
 *   mean of cos(2 pi n p) = [sin(2 pi n p1) - sin(2 pi n p0)] / (2 pi n (p1-p0))
 *   mean of sin(2 pi n p) = [cos(2 pi n p0) - cos(2 pi n p1)] / (2 pi n (p1-p0))
 * so a month mean carries no sampling error at all. The validator measures a
 * fine equal-time sampling against this and watches it converge.
 */
export function monthMeanWeights(months, harmonics) {
  const wCos = new Float64Array(12 * harmonics);
  const wSin = new Float64Array(12 * harmonics);
  for (let m = 0; m < 12; m++) {
    const { startPhase: p0, endPhase: p1 } = months[m];
    for (let n = 1; n <= harmonics; n++) {
      const k = 2 * Math.PI * n, d = k * (p1 - p0);
      wCos[m * harmonics + n - 1] = (Math.sin(k * p1) - Math.sin(k * p0)) / d;
      wSin[m * harmonics + n - 1] = (Math.cos(k * p0) - Math.cos(k * p1)) / d;
    }
  }
  return { wCos, wSin };
}

/**
 * Every (row, surface)'s twelve month-mean seasonal anomalies, from a season
 * table's harmonic coefficients. Indexed `(row * 2 + surface) * 12 + month`.
 *
 * This is the whole reason a grid search over the seasonal parameters is
 * cheap: the anomaly has no longitude, so one table gives 2 x rows series
 * rather than one per cell.
 */
export function modelMonthAnomalies(table, months) {
  const H = table.harmonics;
  const { wCos, wSin } = monthMeanWeights(months, H);
  const out = new Float64Array(table.rows * 2 * 12);
  for (let rs = 0; rs < table.rows * 2; rs++) {
    const base = rs * H * 2;
    for (let m = 0; m < 12; m++) {
      let v = 0;
      for (let n = 0; n < H; n++) {
        v += table.coefficients[base + n * 2] * wCos[m * H + n]
           + table.coefficients[base + n * 2 + 1] * wSin[m * H + n];
      }
      out[rs * 12 + m] = v;
    }
  }
  return out;
}

/**
 * The least-squares operator for a mean plus two annual harmonics, evaluated
 * at the months' OWN centre phases rather than at twelve equally spaced
 * points, because the months are not equally spaced.
 *
 * The SAME operator is applied to the teacher and to the model, so nothing in
 * any comparison depends on this choice being the only defensible one.
 * Returns a 5 x 12 matrix.
 */
export function buildHarmonicOperator(centres) {
  const rows = centres.length, cols = 5;
  const X = centres.map((p) => [
    1, Math.cos(2 * Math.PI * p), Math.sin(2 * Math.PI * p),
    Math.cos(4 * Math.PI * p), Math.sin(4 * Math.PI * p),
  ]);
  const A = Array.from({ length: cols }, () => new Float64Array(cols));
  for (let i = 0; i < cols; i++) for (let j = 0; j < cols; j++) {
    let s = 0; for (let r = 0; r < rows; r++) s += X[r][i] * X[r][j]; A[i][j] = s;
  }
  const I = Array.from({ length: cols }, (_, i) =>
    Float64Array.from({ length: cols }, (_, j) => (i === j ? 1 : 0)));
  for (let c = 0; c < cols; c++) {
    let piv = c;
    for (let r = c + 1; r < cols; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [I[c], I[piv]] = [I[piv], I[c]];
    const d = A[c][c];
    for (let j = 0; j < cols; j++) { A[c][j] /= d; I[c][j] /= d; }
    for (let r = 0; r < cols; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (f === 0) continue;
      for (let j = 0; j < cols; j++) { A[r][j] -= f * A[c][j]; I[r][j] -= f * I[c][j]; }
    }
  }
  const P = Array.from({ length: cols }, () => new Float64Array(rows));
  for (let i = 0; i < cols; i++) for (let r = 0; r < rows; r++) {
    let s = 0; for (let j = 0; j < cols; j++) s += I[i][j] * X[r][j]; P[i][r] = s;
  }
  return P;
}

/** Amplitude and peak phase of the first two annual harmonics of a
 * twelve-value series, through the operator above. `offset` lets a caller
 * pass a flat array plus a base index instead of slicing. */
export function harmonicsOf(P, series, offset = 0) {
  const c = new Float64Array(5);
  for (let i = 0; i < 5; i++) {
    let s = 0;
    for (let m = 0; m < 12; m++) s += P[i][m] * series[offset + m];
    c[i] = s;
  }
  const a1 = c[1], b1 = c[2], a2 = c[3], b2 = c[4];
  return {
    mean: c[0],
    h1: Math.hypot(a1, b1),
    h2: Math.hypot(a2, b2),
    // A cos t + B sin t peaks where t = atan2(B, A).
    p1: (((Math.atan2(b1, a1) / (2 * Math.PI)) % 1) + 1) % 1,
    // The second harmonic has two peaks half a year apart, so its phase is
    // only defined modulo half a year.
    p2: (((Math.atan2(b2, a2) / (4 * Math.PI)) % 0.5) + 0.5) % 0.5,
    ratio: Math.hypot(a1, b1) > 0 ? Math.hypot(a2, b2) / Math.hypot(a1, b1) : null,
  };
}

/** A phase difference folded into (-0.5, 0.5]. */
export const wrapPhase = (d) => ((d % 1) + 1.5) % 1 - 0.5;

export function calendarHelpers(yearDays, equinoxDay = MARCH_EQUINOX_DAY_OF_YEAR) {
  const phaseToDays = (p) => p * yearDays;
  const phaseToDayOfYear = (p) => (((equinoxDay + p * yearDays) % yearDays) + yearDays) % yearDays;
  const dayOfYearLabel = (doy) => {
    let d = doy, m = 0;
    while (m < 12 && d >= MONTH_DAYS[m]) { d -= MONTH_DAYS[m]; m++; }
    return `${MONTH_NAMES[Math.min(11, m)]} ${(d + 1).toFixed(0)}`;
  };
  return { phaseToDays, phaseToDayOfYear, dayOfYearLabel };
}

export const DEFAULT_YEAR_DAYS = SEASON_PARAMETERS.yearLengthDays;
