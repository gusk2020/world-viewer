// Climate v1: land-sea thermal coupling -- the sea's own temperature reaching
// the land downwind of it.
//
// Stage 2's land temperature is `seaLevelC(lat) - lapse * z` and reads no
// ocean at all, so before this module existed an improvement to the sea
// changed **exactly zero land cells**. That is the structural gap this closes:
// it is the part that has to exist before any longitudinal SST structure can
// be seen anywhere a person looks.
//
// What is carried is an ANOMALY, never an absolute temperature
// ------------------------------------------------------------------
// The obvious form -- relax the air toward the surface temperature itself and
// advect that -- was built first and **rejected on measurement**. The Stage 4
// wind has a systematically poleward meridional component in the northern
// hemisphere (+0.4 to +0.65 m/s), so every back trajectory arrives from the
// equatorward side and imports a spurious warm bias: non-ice land MAE went
// 2.43 -> 2.95 C and NE Asia's bias +3.33 -> +5.76 C. The wind's own error was
// being converted straight into a temperature error.
//
// So the quantity relaxed is the departure of the surface from what land at
// that latitude would be on its own:
//
//     A_surface = seaFraction * (T_sea - seaLevelC(lat))     over water
//     A_surface = 0                                          over land
//     dA/dt     = (A_surface - A) / tau        along the back trajectory
//     T_land    = T_stage2 + A
//
// Over land the forcing is zero by definition, so the anomaly simply decays
// inland with no forcing at all -- which is why a continental interior needs
// no distance rule to be left alone -- and a trajectory that wanders
// equatorward can no longer inject anything, because it is not carrying a
// temperature.
//
// `seaLevelC` is the model's own per-latitude sea-level land temperature, the
// same curve `buildTemperatureField` used, so no new input enters here.
//
// **The sea is never modified.** This is a land-only correction, so SST, sea
// ice and the ocean's seasonal cycle are untouched by construction.
//
// An isotropic "oceanicity" alternative (blend toward the nearest ocean by
// exp(-distance)) was also measured and rejected: it scored better globally
// while pushing marine air 2000 km inland and making NE Asia and the eastern
// United States worse -- it cannot tell air that came off the sea from land
// that merely happens to be near it. See
// docs/climate-v1-land-sea-thermal-coupling.md.
import { latitudeOfRow } from "./temperature.js";

/**
 * The one new parameter. `landSeaThermalRelaxationDays` is the timescale on
 * which near-surface air gives up the anomaly it picked up over the sea.
 * EMPIRICAL and an Earth calibration -- not a universal constant. Zero (the
 * default) switches the whole mechanism off, and an off run is bit-identical
 * to this module not existing.
 */
export const LAND_SEA_COUPLING_PARAMETERS = {
  landSeaThermalRelaxationDays: {
    default: 0, kind: "empirical", min: 0, max: 60, search: false,
    note: "How long near-surface air keeps the temperature anomaly it acquired over the sea. 0 = off. Earth's calibrated value is 7 days (see earth-temperature-calibration.js); the global land MAE is flat from 5 to 10 days, so it is a plateau rather than a fitted minimum.",
  },
};

// Numerical settings, NOT parameters -- they set accuracy, not physics, the
// same way `harmonicsForEccentricity` does in season.js.
//
// The kernel is exp(-t/tau), so cutting the trajectory at H timescales
// discards exp(-H) of the total weight: 0.25% at 6. `STEPS_PER_TIMESCALE`
// 12 makes the step tau/12, which at Earth's 7 days and the Stage 4 wind's
// ~2.7 m/s moves a parcel about 136 km -- under one 256-wide cell at mid
// latitudes, so the trajectory is resolved by the grid it samples.
export const TRAJECTORY_HORIZON_TIMESCALES = 6;
export const STEPS_PER_TIMESCALE = 12;
const SECONDS_PER_DAY = 86400;

export function resolveLandSeaCouplingParams(overrides = {}) {
  const values = {};
  const ignored = [];
  for (const [name, spec] of Object.entries(LAND_SEA_COUPLING_PARAMETERS)) values[name] = spec.default;
  for (const [name, value] of Object.entries(overrides || {})) {
    if (name.startsWith("_")) continue;
    if (!(name in LAND_SEA_COUPLING_PARAMETERS)) { ignored.push(name); continue; }
    if (!Number.isFinite(value)) { ignored.push(name); continue; }
    values[name] = value;
  }
  return { values, ignored };
}

/** Sea share and sea-only mean temperature of each coarse cell. */
function coarsenSurface(temperatureField, terrainField, width, height) {
  const fineW = temperatureField.width, fineH = temperatureField.height;
  if (fineW % width !== 0 || fineH % height !== 0) {
    throw new Error(`land-sea coupling: coarse grid ${width}x${height} must divide ${fineW}x${fineH}`);
  }
  const bx = fineW / width, by = fineH / height;
  const cells = width * height;
  const seaCount = new Float64Array(cells), seaSum = new Float64Array(cells), total = new Float64Array(cells);
  for (let y = 0; y < fineH; y++) {
    const cy = Math.floor(y / by);
    for (let x = 0; x < fineW; x++) {
      const i = y * fineW + x, c = cy * width + Math.floor(x / bx);
      total[c]++;
      if (terrainField.isSea[i]) { seaCount[c]++; seaSum[c] += temperatureField.annualMeanTemperatureC[i]; }
    }
  }
  const seaFraction = new Float64Array(cells), seaMeanTemperatureC = new Float64Array(cells);
  for (let c = 0; c < cells; c++) {
    seaFraction[c] = total[c] > 0 ? seaCount[c] / total[c] : 0;
    seaMeanTemperatureC[c] = seaCount[c] > 0 ? seaSum[c] / seaCount[c] : NaN;
  }
  return { seaFraction, seaMeanTemperatureC };
}

/**
 * The marine anomaly field on the coarse grid: how much warmer (or cooler)
 * each cell's surface is than land at the same latitude would be, weighted by
 * how much of that cell is actually sea. Zero over dry land by construction.
 *
 * `sstOverride` exists for the validator only, so that a candidate SST field
 * with longitudinal structure can be fed through the same code path. Nothing
 * in the app passes it.
 */
export function marineAnomalyField({ temperatureField, terrainField, width, height, sstOverride = null }) {
  const { seaFraction, seaMeanTemperatureC } = coarsenSurface(temperatureField, terrainField, width, height);
  const cells = width * height;
  const anomaly = new Float64Array(cells);
  const profileRows = temperatureField.profileRows;
  const seaLevelC = temperatureField.seaLevelCByProfileRow;
  for (let y = 0; y < height; y++) {
    const p = Math.min(profileRows - 1, Math.floor((y * profileRows) / height));
    const reference = seaLevelC[p];
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      if (!(seaFraction[c] > 0)) continue;
      const sst = sstOverride ? sstOverride[c] : seaMeanTemperatureC[c];
      if (!Number.isFinite(sst)) continue;
      anomaly[c] = seaFraction[c] * (sst - reference);
    }
  }
  return { anomaly, seaFraction, seaMeanTemperatureC };
}

/**
 * Integrates the relaxation ODE backwards along the wind, once per coarse
 * cell. Returns the land anomaly on that grid (zero everywhere the mechanism
 * is off, and zero on cells with no land in them).
 */
export function buildLandSeaCoupling({
  temperatureField, terrainField, windField, body, params = {},
  width = null, height = null, sstOverride = null,
}) {
  if (!temperatureField || !terrainField || !windField) {
    throw new Error("buildLandSeaCoupling requires temperatureField, terrainField and windField");
  }
  // The body's radius turns a trajectory's seconds into grid cells, so it is
  // required rather than defaulted -- an Earth radius silently applied to
  // Mars would give a trajectory three times too short with nothing to show
  // for it. Same reasoning as globe3d.js throwing on a missing display number.
  if (!Number.isFinite(body?.radiusMetres)) {
    throw new Error("buildLandSeaCoupling requires body.radiusMetres");
  }
  const { values, ignored } = resolveLandSeaCouplingParams(params);
  const W = width ?? windField.width, H = height ?? windField.height;
  if (W !== windField.width || H !== windField.height) {
    throw new Error(`land-sea coupling: the wind is ${windField.width}x${windField.height}, not ${W}x${H}`);
  }
  const cells = W * H;
  const tauDays = values.landSeaThermalRelaxationDays;
  const { anomaly: surfaceAnomaly, seaFraction } = marineAnomalyField({
    temperatureField, terrainField, width: W, height: H, sstOverride,
  });
  const landAnomalyC = new Float64Array(cells);

  const meta = {
    applied: tauDays > 0, relaxationDays: tauDays, width: W, height: H, ignored,
    horizonTimescales: TRAJECTORY_HORIZON_TIMESCALES, stepsPerTimescale: STEPS_PER_TIMESCALE,
    discardedWeight: Math.exp(-TRAJECTORY_HORIZON_TIMESCALES),
    trajectoriesLeftGrid: 0,
  };
  if (!(tauDays > 0)) return { width: W, height: H, landAnomalyC, surfaceAnomaly, seaFraction, meta };

  // Geometry of one grid step, in metres.
  const metresPerDegree = (body.radiusMetres * Math.PI) / 180;
  const dLatM = (180 / H) * metresPerDegree;
  const dLonM = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    dLonM[y] = (360 / W) * metresPerDegree * Math.cos((latitudeOfRow(y, H) * Math.PI) / 180);
  }
  const u = windField.uWindMs, v = windField.vWindMs;

  const tau = tauDays * SECONDS_PER_DAY;
  const dt = tau / STEPS_PER_TIMESCALE;
  const steps = TRAJECTORY_HORIZON_TIMESCALES * STEPS_PER_TIMESCALE;
  // The ODE's own weights: (dt/tau) * exp(-t/tau), which sum to 1 - exp(-H).
  // They are NOT renormalised -- an air mass that has been over land the whole
  // horizon must come out at zero anomaly, and renormalising would instead
  // return the mean of whatever it did pass over.
  const weight = new Float64Array(steps + 1);
  for (let k = 0; k <= steps; k++) weight[k] = (dt / tau) * Math.exp(-(k * dt) / tau);

  for (let c0 = 0; c0 < cells; c0++) {
    if (seaFraction[c0] >= 1) continue;           // nothing but sea here: not a land cell
    let fx = (c0 % W) + 0.5, fy = Math.floor(c0 / W) + 0.5;
    let acc = 0;
    for (let k = 0; k <= steps; k++) {
      // Nearest cell, with longitude wrapping and the row clamped. The row
      // cannot actually be out of range here: the loop breaks the moment a
      // trajectory leaves the grid at a pole.
      const yi = Math.min(H - 1, Math.max(0, Math.floor(fy)));
      const xi = ((Math.floor(fx) % W) + W) % W;
      const ci = yi * W + xi;
      acc += weight[k] * surfaceAnomaly[ci];
      if (k === steps) break;
      // Step backwards along the flow. A calm cell simply stays put, which is
      // the right behaviour rather than a special case: the parcel goes on
      // relaxing toward the surface it is sitting on.
      const du = dLonM[yi];
      fx -= du > 1 ? (u[ci] * dt) / du : 0;       // a polar row is vanishingly
      fy += (v[ci] * dt) / dLatM;                 // narrow; do not divide by it
      if (fy < 0 || fy >= H) { meta.trajectoriesLeftGrid++; break; }
    }
    landAnomalyC[c0] = acc;
  }
  return { width: W, height: H, landAnomalyC, surfaceAnomaly, seaFraction, meta };
}

/**
 * The same, applied: a temperature field whose LAND cells carry the marine
 * anomaly. With the mechanism off this returns the field it was given, by
 * identity -- not a copy -- so an off run cannot differ even by a Float32
 * round trip.
 */
export function applyLandSeaCoupling({
  temperatureField, terrainField, windField, body, params = {},
  width = null, height = null, sstOverride = null,
}) {
  const coupling = buildLandSeaCoupling({
    temperatureField, terrainField, windField, body, params, width, height, sstOverride,
  });
  if (!coupling.meta.applied) return { temperatureField, coupling };

  const fineW = temperatureField.width, fineH = temperatureField.height;
  const bx = fineW / coupling.width, by = fineH / coupling.height;
  const out = new Float32Array(temperatureField.annualMeanTemperatureC);
  for (let y = 0; y < fineH; y++) {
    const cy = Math.floor(y / by);
    for (let x = 0; x < fineW; x++) {
      const i = y * fineW + x;
      if (terrainField.isSea[i]) continue;        // the sea is never modified
      out[i] += coupling.landAnomalyC[cy * coupling.width + Math.floor(x / bx)];
    }
  }
  return {
    temperatureField: { ...temperatureField, annualMeanTemperatureC: out, landSeaCoupling: coupling.meta },
    coupling,
  };
}
