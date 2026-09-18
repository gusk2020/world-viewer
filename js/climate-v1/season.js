// Climate v1's seasonal cycle -- the first time anything in this project
// carries a time axis rather than one annual mean.
//
// What this module does, and nothing else:
//
//     T(lat, lng, phase) = T_annual(lat, lng) + deltaT(lat, surfaceType, phase)
//
// `T_annual` is Stage 2's field, used exactly as it is; nothing here can
// change it, because this file never writes to a temperature field and the
// annual term is simply added back at sample time. `deltaT` has an annual
// mean of **exactly zero by construction** -- it is a sum of harmonics with
// no constant term -- so switching the season on cannot move the annual mean
// of anything, and every existing stage that reads only the annual field is
// bit-for-bit unaffected.
//
// **This is not V0.8's season and must never be confused with it.** V0.8
// (`seasonalSensitivityC`, `seaSeasonalDamping` in js/climate.js) computes
// two states -- a warm season and a cold season -- as an instantaneous linear
// response to the solstice insolation anomaly, with no heat capacity, no time
// derivative and therefore no phase lag; each latitude takes the max and min
// of the two solstices, so that field is a composite of two different
// calendar moments rather than the state of the surface at any one time. It
// is a drawing correction. This module integrates a real relaxation equation
// around a continuous orbit. Neither parameter from V0.8 is read here, and
// neither should ever be.
//
// **The orbit.** The body's own `orbitalEccentricity` and
// `periapsisLongitudeDeg` are read here and nowhere else in the project. They
// scale the incident flux by (a/r)^2 and make the solar longitude advance
// unevenly through the year, which is what produces a hemispheric asymmetry:
// whichever hemisphere has its summer near periapsis gets the stronger one.
// Both are physical inputs, neither is fitted, and both default to the
// circular case. `orbitalPhase` stays equally spaced IN TIME on any orbit --
// the true anomaly is never used as the clock -- so this module and the
// sea-ice state integrator keep sharing one axis with a constant step.
//
// **One limitation this module cannot fix, stated rather than hidden**: the
// orbit-mean insolation itself rises as 1/sqrt(1-e^2) with eccentricity
// (+15.5% at e = 0.5), and Stage 2's annual-mean temperature field does not
// read the eccentricity at all. So on a high-e world the seasonal departure
// is eccentricity-aware while the annual mean it is added to is not. The
// table reports the factor as `orbit.meanInsolationScale` so nobody has to
// rediscover it.
//
// **`oceanModeration` is a different question too.** That term (Stage 2)
// compresses the *annual-mean* sea temperature toward the global mean and
// stands in for meridional ocean heat transport. The sea's behaviour here --
// a smaller seasonal swing arriving later in the year -- comes from its heat
// capacity alone. The two are never mixed.
import { dailyMeanInsolationFactor } from "../climate.js";
import { latitudeOfRow } from "./temperature.js";

/**
 * The one place the time axis is defined. A future forward integrator (once
 * soil water, snow or sea ice carry state from one phase to the next) replaces
 * `solvePeriodicResponse` below and reads its step size from here; nothing
 * else about the axis should need to move.
 *
 * `orbitalPhase` runs [0, 1) over one orbit, so no body's calendar -- least of
 * all Earth's months -- is hardcoded anywhere in the model. Phase 0 is the
 * ascending equinox (declination 0, heading north), so phase 0.25 is the
 * northern-hemisphere solstice on any world.
 */
export const SEASONAL_TIME_AXIS = {
  normalise(orbitalPhase) {
    const p = orbitalPhase % 1;
    return p < 0 ? p + 1 : p;
  },
  /**
   * Solar declination at one orbital phase on a CIRCULAR orbit, for an
   * obliquity in degrees. Kept for the e = 0 case and as the validator's
   * independent re-derivation of it; an eccentric orbit goes through
   * `declinationFromSolarLongitudeRad` below, because on such an orbit the
   * solar longitude is no longer proportional to time.
   */
  declinationRad(orbitalPhase, axialTiltDegrees) {
    const tilt = (axialTiltDegrees * Math.PI) / 180;
    return Math.asin(Math.sin(tilt) * Math.sin(2 * Math.PI * orbitalPhase));
  },
  /**
   * Solar declination from the solar longitude measured out of the ascending
   * equinox. The same relation the circular case uses -- the eccentricity
   * changes how fast the solar longitude advances, never this geometry.
   */
  declinationFromSolarLongitudeRad(solarLongitudeRad, axialTiltDegrees) {
    const tilt = (axialTiltDegrees * Math.PI) / 180;
    return Math.asin(Math.sin(tilt) * Math.sin(solarLongitudeRad));
  },
  /** How many phases the forcing is sampled at when the table is built. */
  defaultPhaseSamples: 360,
  /** How many phases a caller stepping through a year would normally use. */
  defaultPhaseCount: 24,
};

/**
 * The seasonal model's own constants. Every one of them is **empirical or
 * representative, not a universal constant**, and each says so -- the same
 * discipline js/climate.js applies to its own parameter schema.
 *
 * All of them are intended to be replaceable per planet and per surface once
 * there is a second body with a season worth drawing; none of them may ever
 * become a per-region lookup.
 */
export const SEASON_PARAMETERS = {
  // The local damping of a surface temperature anomaly: how many W/m2 leave
  // when the surface runs 1 K warm, counting radiation, sensible and latent
  // flux and transport together. EMPIRICAL REPRESENTATIVE VALUE, not a
  // physical constant -- it is far larger than the global radiative feedback
  // (~2 W/m2/K) because that one describes the whole planet's balance, not
  // one patch of ground. 8 reproduces the observed mid-latitude land swing
  // and its lag; see docs/climate-v1-seasonal-cycle.md.
  seasonalDampingWPerM2K: 8,

  // Heat capacity, as an atmospheric column plus whatever ground or water
  // takes part in the annual cycle. The two depths are REPRESENTATIVE
  // PHYSICAL VALUES (the annual damping depth in soil is a few metres; a
  // mid-latitude mixed layer is tens of metres), not measurements of any
  // particular place, and not universal constants.
  atmosphericColumnHeatCapacityJPerM2K: 1.0e7,
  soilDepthM: 4,
  soilVolumetricHeatCapacityJPerM3K: 2.2e6,
  mixedLayerDepthM: 30,
  waterVolumetricHeatCapacityJPerM3K: 4.0e6,

  // The share of incident starlight the surface-plus-atmosphere column keeps.
  // A single scalar, deliberately: there is no albedo map here, no snow/ice
  // feedback and no geography of any kind. REPRESENTATIVE VALUE.
  shortwaveAbsorbedFraction: 0.70,

  // Earth's values, used only as defaults when a world's config does not
  // carry its own. Both belong to the body, not to the model.
  solarConstantWPerM2: 1361,
  yearLengthDays: 365.2422,

  // How many harmonics of the year the table keeps, ON A CIRCULAR ORBIT.
  // Four is measured: it holds the response to about 0.5 C everywhere,
  // including the sharply non-sinusoidal polar forcing, at 32 KB for 512
  // rows. An eccentric orbit needs more, and `harmonicsForEccentricity`
  // works out how many -- a numerical-accuracy setting, not a fitted one.
  harmonics: 4,
};

/**
 * The largest eccentricity this module will accept.
 *
 * Not a taste limit and not a clamp: above it the harmonic representation
 * stops being able to hold the forcing. Measured against a 96-harmonic
 * reference, the smallest harmonic count that keeps the truncation error at
 * the level the circular case already has (0.506 C, worst over all rows) runs
 * 4 / 6 / 8 / 12 / 20 harmonics at e = 0 / 0.0167 / 0.3 / 0.5 / 0.6, then 32
 * at e = 0.7 and beyond 48 at e = 0.8 -- the periapsis passage becomes a spike
 * too narrow in time for any affordable number of harmonics.
 *
 * An orbit past this is REFUSED rather than quietly clamped, because a
 * silently reduced eccentricity would draw a plausible season for a planet
 * nobody asked for.
 */
export const SEASON_SUPPORTED_MAX_ECCENTRICITY = 0.6;

/**
 * How many harmonics of the year the table needs at a given eccentricity.
 *
 * **This is a numerical-accuracy setting, not a fitted parameter.** It is
 * chosen so the truncation error stays at the level the circular case already
 * has, which is the only honest bar available: e = 0 with four harmonics is
 * the picture the user has looked at and accepted. The exponent comes from
 * how the periapsis passage narrows in time (roughly (1-e)^1.5), rounded up
 * with two harmonics of margin against the measured requirement.
 *
 * e = 0 returns exactly 4, so a circular orbit is bit-for-bit what it was
 * before this module knew what an orbit was.
 */
export function harmonicsForEccentricity(eccentricity) {
  if (!(eccentricity > 0)) return SEASON_PARAMETERS.harmonics;
  return Math.min(48, Math.ceil(4 / Math.pow(1 - eccentricity, 1.6)) + 2);
}

/**
 * Kepler's equation, `M = E - e sin E`, solved for the eccentric anomaly.
 *
 * `M` is folded into [-pi, pi) first, which puts periapsis at the middle of
 * the range where Newton is best conditioned; the starter is Danby's, exact
 * at e = 0. Measured to converge to 1e-13 in at most 3 iterations at Earth's
 * eccentricity, 4 at e = 0.3 and 5 at e = 0.5.
 *
 * e = 0 returns M unchanged without iterating at all -- the circular case
 * never touches this solver's arithmetic.
 */
export function solveEccentricAnomaly(meanAnomaly, eccentricity, { tolerance = 1e-13, maxIterations = 30 } = {}) {
  let M = meanAnomaly % (2 * Math.PI);
  if (M >= Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  if (!(eccentricity > 0)) return { eccentricAnomaly: M, iterations: 0 };
  let E = M + (eccentricity * Math.sin(M)) / (1 - Math.sin(M + eccentricity) + Math.sin(M));
  if (!Number.isFinite(E)) E = M;
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const step = (E - eccentricity * Math.sin(E) - M) / (1 - eccentricity * Math.cos(E));
    E -= step;
    if (Math.abs(step) < tolerance) break;
  }
  return { eccentricAnomaly: E, iterations: iterations + 1 };
}

/** True anomaly from the eccentric anomaly. */
export function trueAnomalyFromEccentric(eccentricAnomaly, eccentricity) {
  return 2 * Math.atan2(
    Math.sqrt(1 + eccentricity) * Math.sin(eccentricAnomaly / 2),
    Math.sqrt(1 - eccentricity) * Math.cos(eccentricAnomaly / 2),
  );
}

/**
 * Mean anomaly from the true anomaly -- the direction that needs no solver,
 * and the one that fixes where phase 0 sits.
 */
export function meanAnomalyFromTrueAnomaly(trueAnomaly, eccentricity) {
  const E = 2 * Math.atan2(
    Math.sqrt(1 - eccentricity) * Math.sin(trueAnomaly / 2),
    Math.sqrt(1 + eccentricity) * Math.cos(trueAnomaly / 2),
  );
  return E - eccentricity * Math.sin(E);
}

/**
 * One orbit, sampled at phases that are equally spaced **in time**.
 *
 * That is the load-bearing property of this whole module and the reason the
 * true anomaly is never used as the clock: the phase axis is shared with the
 * sea-ice state integrator, whose step is a constant `yearSeconds / steps`,
 * and it is what makes the plain arithmetic mean of the sampled forcing equal
 * its true time mean (hence an annual anomaly of exactly zero).
 *
 * `periapsisLongitudeDeg` is the angle from the ascending (northward) equinox
 * to periapsis, measured along the orbit in the direction of motion -- the
 * standard palaeoclimate convention. Earth today is about 283 degrees, Mars
 * about 251. No calendar, no month and no place name is reachable from here.
 *
 * Phase 0 stays the ascending equinox at every eccentricity: the equinox is
 * the point whose true anomaly is `-periapsisLongitude`, so the mean-anomaly
 * offset `M0` is read off that directly.
 *
 * Kepler is solved once per **phase**, never per latitude and never per cell,
 * because both outputs depend on the phase alone.
 */
export function sampleOrbit({ samples, eccentricity = 0, periapsisLongitudeDeg = 0 }) {
  if (!Number.isFinite(eccentricity) || eccentricity < 0) {
    throw new Error("sampleOrbit requires a non-negative orbitalEccentricity");
  }
  if (eccentricity > SEASON_SUPPORTED_MAX_ECCENTRICITY) {
    throw new Error(
      `orbitalEccentricity ${eccentricity} is not supported: the seasonal model holds `
      + `0 <= e <= ${SEASON_SUPPORTED_MAX_ECCENTRICITY}. Above that the periapsis forcing is `
      + `too sharp in time for the harmonic table, and clamping it silently would draw a `
      + `season for a different planet.`,
    );
  }
  const solarLongitudeRad = new Float64Array(samples);
  const distanceFactor = new Float64Array(samples);
  // The circular case bypasses the solver entirely, so it is identical to the
  // version with no orbit layer by construction rather than to within
  // rounding: the atan2 round trip is never taken.
  if (!(eccentricity > 0)) {
    distanceFactor.fill(1);
    for (let s = 0; s < samples; s++) solarLongitudeRad[s] = 2 * Math.PI * (s / samples);
    return {
      solarLongitudeRad, distanceFactor, eccentricity: 0,
      periapsisLongitudeDeg, worstIterations: 0, meanIterations: 0,
    };
  }
  const varpi = (periapsisLongitudeDeg * Math.PI) / 180;
  const meanAnomalyAtPhaseZero = meanAnomalyFromTrueAnomaly(-varpi, eccentricity);
  let worstIterations = 0;
  let totalIterations = 0;
  for (let s = 0; s < samples; s++) {
    const M = meanAnomalyAtPhaseZero + 2 * Math.PI * (s / samples);
    const { eccentricAnomaly, iterations } = solveEccentricAnomaly(M, eccentricity);
    if (iterations > worstIterations) worstIterations = iterations;
    totalIterations += iterations;
    solarLongitudeRad[s] = trueAnomalyFromEccentric(eccentricAnomaly, eccentricity) + varpi;
    // (a/r)^2, the inverse-square scaling of the incident flux. r/a is
    // 1 - e cos E, which is why the eccentric anomaly is kept rather than
    // recomputed from the true anomaly.
    const rOverA = 1 - eccentricity * Math.cos(eccentricAnomaly);
    distanceFactor[s] = 1 / (rOverA * rOverA);
  }
  return {
    solarLongitudeRad, distanceFactor, eccentricity, periapsisLongitudeDeg,
    worstIterations, meanIterations: totalIterations / samples,
  };
}

export const SURFACE_LAND = 0;
export const SURFACE_SEA = 1;

/**
 * The heat capacity of one square metre of a surface type, in J/m2/K.
 *
 * Exported as its own function on purpose: when a later stage gives snow,
 * soil water or sea ice real state, heat capacity stops being a property of
 * "land or sea" and becomes a per-cell array. That change replaces this
 * function's callers, not the solver.
 */
export function heatCapacityJPerM2K(surfaceType, params = SEASON_PARAMETERS) {
  const air = params.atmosphericColumnHeatCapacityJPerM2K;
  return surfaceType === SURFACE_SEA
    ? air + params.mixedLayerDepthM * params.waterVolumetricHeatCapacityJPerM3K
    : air + params.soilDepthM * params.soilVolumetricHeatCapacityJPerM3K;
}

/**
 * The seasonal solver, as a pure function of one year of forcing.
 *
 * Solves `C dT'/dt = F(t) - lambda T'` for its periodic steady state, one
 * harmonic at a time. For `F = a cos(n w t) + b sin(n w t)` the answer is
 * exact:
 *
 *     k = n w tau,  tau = C / lambda,  g = 1 / (1 + k^2)
 *     A = g (a/lambda - k b/lambda),  B = g (b/lambda + k a/lambda)
 *
 * so the amplitude is divided by sqrt(1 + k^2) and the peak arrives
 * `atan(k) / (n w)` later -- gain and lag both from the geometry, neither
 * fitted. No time stepping runs, here or at sample time.
 *
 * The returned coefficients carry **no constant term**, which is what makes
 * the annual mean of the seasonal anomaly exactly zero.
 *
 * @param forcingWPerM2 one orbit of forcing, equally spaced, mean removed by
 *   the caller (any mean left in it is simply ignored: n starts at 1).
 */
export function solvePeriodicResponse({
  forcingWPerM2, heatCapacity, dampingWPerM2K, yearSeconds, harmonics,
}) {
  const samples = forcingWPerM2.length;
  const tau = heatCapacity / dampingWPerM2K;
  const omega = (2 * Math.PI) / yearSeconds;
  const cos = new Float64Array(harmonics);
  const sin = new Float64Array(harmonics);
  for (let n = 1; n <= harmonics; n++) {
    let a = 0;
    let b = 0;
    for (let s = 0; s < samples; s++) {
      const theta = (2 * Math.PI * n * s) / samples;
      a += forcingWPerM2[s] * Math.cos(theta);
      b += forcingWPerM2[s] * Math.sin(theta);
    }
    a = (2 * a) / (samples * dampingWPerM2K);
    b = (2 * b) / (samples * dampingWPerM2K);
    const k = n * omega * tau;
    const gain = 1 / (1 + k * k);
    cos[n - 1] = gain * (a - k * b);
    sin[n - 1] = gain * (b + k * a);
  }
  return { cos, sin };
}

/**
 * Builds the seasonal anomaly table for one body.
 *
 * The table is indexed by **row and surface type only** -- the anomaly has no
 * longitude, because at this stage heat capacity depends on nothing but
 * land-or-sea. That is what makes it 32 KB instead of a third dimension, and
 * it is exactly the assumption that stops holding when state memory arrives;
 * `heatCapacityJPerM2K` above is where that will be noticed.
 */
export function buildSeasonalTemperatureTable({
  rows, body, params = SEASON_PARAMETERS, phaseSamples = SEASONAL_TIME_AXIS.defaultPhaseSamples,
  harmonics: harmonicsOverride = null,
}) {
  if (!Number.isFinite(rows) || rows < 1) throw new Error("buildSeasonalTemperatureTable requires a row count");
  if (!body || !Number.isFinite(body.axialTiltDegrees)) {
    throw new Error("buildSeasonalTemperatureTable requires body.axialTiltDegrees");
  }
  // The orbit. Both numbers are PHYSICAL INPUTS belonging to the body, never
  // fitted to anything; both default to the circular case a world's config
  // carried before they existed.
  const eccentricity = Number.isFinite(body.orbitalEccentricity) ? body.orbitalEccentricity : 0;
  const periapsisLongitudeDeg = Number.isFinite(body.periapsisLongitudeDeg) ? body.periapsisLongitudeDeg : 0;
  const orbit = sampleOrbit({ samples: phaseSamples, eccentricity, periapsisLongitudeDeg });
  const harmonics = Number.isFinite(harmonicsOverride)
    ? harmonicsOverride : harmonicsForEccentricity(eccentricity);
  const tilt = body.axialTiltDegrees;
  const solarConstant = Number.isFinite(body.solarConstantWPerM2)
    ? body.solarConstantWPerM2
    : params.solarConstantWPerM2;
  const yearDays = Number.isFinite(body.yearLengthDays) ? body.yearLengthDays : params.yearLengthDays;
  const yearSeconds = yearDays * 86400;
  const capacities = [heatCapacityJPerM2K(SURFACE_LAND, params), heatCapacityJPerM2K(SURFACE_SEA, params)];

  // coefficients[((row * 2 + surface) * harmonics + n) * 2 + (0 cos | 1 sin)]
  const coefficients = new Float32Array(rows * 2 * harmonics * 2);
  const forcing = new Float64Array(phaseSamples);

  for (let y = 0; y < rows; y++) {
    const latRad = (latitudeOfRow(y, rows) * Math.PI) / 180;
    let mean = 0;
    for (let s = 0; s < phaseSamples; s++) {
      // The only place the orbit enters: the declination follows the solar
      // longitude the orbit actually reached at this phase (which advances
      // unevenly when e > 0), and the incident flux is scaled by (a/r)^2.
      const dec = SEASONAL_TIME_AXIS.declinationFromSolarLongitudeRad(orbit.solarLongitudeRad[s], tilt);
      forcing[s] = orbit.distanceFactor[s] * dailyMeanInsolationFactor(latRad, dec);
      mean += forcing[s];
    }
    // The phases are equally spaced IN TIME, so this arithmetic mean is the
    // true orbit-mean insolation at this latitude -- which is what makes the
    // departure below have an annual mean of exactly zero on any orbit.
    mean /= phaseSamples;
    // Absorbed forcing as a departure from this latitude's own annual mean,
    // in real W/m2. Stage 2's `insolationSensitivityC` is deliberately NOT
    // used: that is a regression coefficient for the annual-mean pole-to-
    // equator contrast, carrying feedbacks and meridional transport that have
    // nothing to do with how fast one place warms up in its own summer.
    for (let s = 0; s < phaseSamples; s++) {
      forcing[s] = params.shortwaveAbsorbedFraction * solarConstant * (forcing[s] - mean);
    }
    for (let surface = 0; surface < 2; surface++) {
      const { cos, sin } = solvePeriodicResponse({
        forcingWPerM2: forcing,
        heatCapacity: capacities[surface],
        dampingWPerM2K: params.seasonalDampingWPerM2K,
        yearSeconds,
        harmonics,
      });
      for (let n = 0; n < harmonics; n++) {
        const at = ((y * 2 + surface) * harmonics + n) * 2;
        coefficients[at] = cos[n];
        coefficients[at + 1] = sin[n];
      }
    }
  }

  return {
    rows, harmonics, coefficients,
    axialTiltDegrees: tilt, solarConstantWPerM2: solarConstant, yearLengthDays: yearDays,
    orbitalEccentricity: eccentricity,
    periapsisLongitudeDeg,
    // The orbit's own diagnostics, so a caller can report what it got rather
    // than re-deriving it. `meanInsolationScale` is the exact time mean of
    // (a/r)^2, 1/sqrt(1-e^2) -- the factor by which the ANNUAL-MEAN
    // insolation rises with eccentricity, and which Stage 2's annual-mean
    // temperature field does NOT know about. See the note at the head of
    // docs/climate-v1-seasonal-cycle.md: on a high-e world the seasonal
    // departure is eccentricity-aware and the annual mean is not.
    orbit: {
      meanInsolationScale: 1 / Math.sqrt(1 - eccentricity * eccentricity),
      worstNewtonIterations: orbit.worstIterations,
      meanNewtonIterations: orbit.meanIterations,
    },
    heatCapacityJPerM2K: { land: capacities[SURFACE_LAND], sea: capacities[SURFACE_SEA] },
    dampingWPerM2K: params.seasonalDampingWPerM2K,
    timescaleDays: {
      land: capacities[SURFACE_LAND] / params.seasonalDampingWPerM2K / 86400,
      sea: capacities[SURFACE_SEA] / params.seasonalDampingWPerM2K / 86400,
    },
  };
}

/**
 * The seasonal anomaly in degrees at one row, surface type and orbital phase.
 * Evaluated from the harmonics directly, so any phase is exact and nothing is
 * interpolated between stored samples.
 */
export function sampleSeasonalAnomalyC(table, row, surfaceType, orbitalPhase) {
  const y = Math.min(table.rows - 1, Math.max(0, row | 0));
  const phase = SEASONAL_TIME_AXIS.normalise(orbitalPhase);
  const base = ((y * 2 + (surfaceType === SURFACE_SEA ? 1 : 0)) * table.harmonics) * 2;
  let sum = 0;
  for (let n = 1; n <= table.harmonics; n++) {
    const theta = 2 * Math.PI * n * phase;
    const at = base + (n - 1) * 2;
    sum += table.coefficients[at] * Math.cos(theta) + table.coefficients[at + 1] * Math.sin(theta);
  }
  return sum;
}

/**
 * One cell's surface temperature at one orbital phase: Stage 2's annual mean
 * plus this module's anomaly. The temperature field is read, never written.
 *
 * The season table is built at its own row count, so it maps onto the
 * temperature field's rows the same way Stage 2's own latitude profile does --
 * by nearest row.
 */
export function sampleTemperatureAtPhase({ temperatureField, seasonTable, index, orbitalPhase, isSea }) {
  const width = temperatureField.width;
  const row = Math.floor(index / width);
  const tableRow = Math.min(seasonTable.rows - 1, Math.floor((row * seasonTable.rows) / temperatureField.height));
  const sea = isSea === undefined ? undefined : isSea;
  if (sea === undefined) throw new Error("sampleTemperatureAtPhase requires isSea for the cell");
  return (
    temperatureField.annualMeanTemperatureC[index]
    + sampleSeasonalAnomalyC(seasonTable, tableRow, sea ? SURFACE_SEA : SURFACE_LAND, orbitalPhase)
  );
}

/**
 * The whole grid at one phase. Used by the UI's phase slider and by the
 * validator. It never writes to the annual field, so no caller can damage
 * Stage 2 by forgetting to copy; pass `out` to reuse one buffer across phases,
 * since a player calls this many times a second.
 */
export function buildTemperatureFieldAtPhase({
  temperatureField, terrainField, seasonTable, orbitalPhase, out: reuse = null,
}) {
  const { width, height, annualMeanTemperatureC } = temperatureField;
  const out = reuse && reuse.length === width * height ? reuse : new Float32Array(width * height);
  const rowScale = seasonTable.rows / height;
  for (let y = 0; y < height; y++) {
    const tableRow = Math.min(seasonTable.rows - 1, Math.floor(y * rowScale));
    const land = sampleSeasonalAnomalyC(seasonTable, tableRow, SURFACE_LAND, orbitalPhase);
    const sea = sampleSeasonalAnomalyC(seasonTable, tableRow, SURFACE_SEA, orbitalPhase);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      out[i] = annualMeanTemperatureC[i] + (terrainField.isSea[i] ? sea : land);
    }
  }
  return out;
}
