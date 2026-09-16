// Climate v1 Stage 5C-alpha -- the RH-dependent recycling HYPOTHESIS, and an
// identification test for it. See docs/climate-v1-recycling-stage5c-alpha.md.
//
// ---------------------------------------------------------------------------
// WHAT THIS IS NOT
//
// `phi(RH)` below is **a hypothesis that the recyclable, condensing share of
// Stage 5B's removal term can be approximated by relative humidity**. It is
// not a precipitation rate, not a soil-moisture model, not a vegetation
// model, and not a land water reservoir. Nothing here is in kg/m^2/s, nothing
// integrates a store over time, and no quantity here may be reported as
// rainfall. The whole point of the stage is to find out whether the
// hypothesis is even *distinguishable* from changing Stage 5B's tau.
//
// ---------------------------------------------------------------------------
// WHY THE OBVIOUS VERSION IS WORTHLESS, AND WHY THIS ONE MIGHT NOT BE
//
// Returning a fixed fraction f of Stage 5B's removal is algebraically a
// relabelling of tau and nothing else:
//
//     -q/tau + f*(q/tau) = -(1-f)*q/tau      =>  tau_eff = tau/(1-f)
//
// A constant fraction of a term that is linear in q can only ever rescale
// that term. So the recyclable share must depend on something other than q's
// amplitude. The physical statement made here is:
//
//   removal close to saturation is mostly condensation -- water that reaches
//   the surface and can evaporate again;
//   removal far from saturation is mostly mixing with drier air aloft --
//   water that leaves the layer without ever reaching the ground.
//
//     phi_i = smoothstep(RHcrit, RHcrit + WIDTH, q_i / qsat_i)
//     E_i   = min( f * phi_i * q_i / tau ,  (RH0*qsat_i - q_i)+ / tau_et )
//
// which makes tau_eff = tau / (1 - f*phi_i) vary across the map with the
// model's own humidity -- 1/(1-f) times longer in a rainforest than in a
// desert. No single tau can do that. Whether the difference is large enough
// to matter is exactly what the identification test measures; the algebra
// above only says it is not identically zero.
//
// Two bounds, both structural rather than tuned:
//   - supply: E <= f * (what the removal took), so no water is created;
//   - demand: E <= what the air can still hold below RH0*qsat, so a hot dry
//     cell with nothing to evaporate evaporates nothing.
// The outer iteration's gain is therefore at most f < 1 and its amplification
// is bounded by 1/(1-f): it cannot diverge.
// ---------------------------------------------------------------------------
import { buildMoistureField } from "./moisture.js";

/** Fixed, not a parameter: the width of the transition in RH. A blend width
 * has never moved a resolved result in this project (Stage 7 recorded the
 * same for four other widths), and leaving it free would invite fitting the
 * shape of a hypothesis that has not yet earned one. */
export const RECYCLING_TRANSITION_WIDTH = 0.15;

export const RECYCLING_PARAMETERS = {
  landRecyclingFraction: {
    default: 0,
    kind: "empirical",
    search: true,
    min: 0,
    max: 0.9,
    note:
      "Share of the condensing part of the removal that returns to the air over land. " +
      "0 reproduces Stage 5B exactly. Bounded below 1 by the water budget itself: at 1 " +
      "the land would return everything it received and the outer iteration would not " +
      "contract. NOT fitted to the humidity teacher in Stage 5C-alpha.",
  },
  recyclingHumidityThreshold: {
    default: 0.8,
    kind: "empirical",
    search: true,
    min: 0.5,
    max: 0.95,
    note:
      "Relative humidity above which the removal is assumed to be mostly condensation " +
      "rather than mixing with drier air aloft. The critical-humidity idea is standard in " +
      "large-scale condensation closures; the range is taken from that, not from any " +
      "teacher comparison.",
  },
  evapotranspirationTimescaleDays: {
    default: 5,
    kind: "empirical",
    search: true,
    min: 0.5,
    max: 30,
    note:
      "Time for a wet surface to bring the layer above it back toward RH0*qsat. Sets the " +
      "DEMAND ceiling only -- it can never increase E above what the supply term allows. " +
      "Range from boundary-layer moistening timescales.",
  },
};

function resolveRecyclingParams(overrides = {}) {
  const values = {};
  for (const [name, spec] of Object.entries(RECYCLING_PARAMETERS)) values[name] = spec.default;
  const unknown = [];
  for (const [name, value] of Object.entries(overrides || {})) {
    if (name.startsWith("_")) continue;
    if (!(name in RECYCLING_PARAMETERS)) { unknown.push(name); continue; }
    if (!Number.isFinite(value)) throw new Error(`recycling parameter ${name} must be a finite number`);
    values[name] = value;
  }
  return { values, unknown };
}

function smoothstep(edge0, edge1, x) {
  if (!(edge1 > edge0)) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Runs Stage 5B's transport to a fixed point with the RH-dependent surface
 * source switched on. `moistureOptions` is passed straight through to
 * buildMoistureField, so the transport model itself is untouched.
 *
 * At landRecyclingFraction = 0 this returns buildMoistureField's own result
 * with no source array at all, so the output is bit-identical to Stage 5B.
 */
export function buildRecycledMoistureField({
  terrainField, temperatureField, humidityField, wind, windMode, body,
  params: moistureOverrides = {},
  recycling: recyclingOverrides = {},
  maxOuterPasses = 30,
  outerConvergenceKgPerKg = 1e-7,
  ...moistureOptions
}) {
  const { values: rec, unknown } = resolveRecyclingParams(recyclingOverrides);
  const base = { terrainField, temperatureField, humidityField, wind, windMode, body, params: moistureOverrides, ...moistureOptions };

  let field = buildMoistureField({ ...base });
  if (!(rec.landRecyclingFraction > 0)) {
    return { ...field, recycling: { ...rec, unknownParameters: unknown, outerPasses: 0, applied: false } };
  }

  const n = field.width * field.height;
  const qSat = field.saturationSpecificHumidityKgPerKg;
  const isSource = field.isSource;
  const tauSeconds = field.meta.params.moistureResidenceDays * 86400;
  const rh0 = field.meta.params.surfaceRelativeHumidity;
  const tauEtSeconds = rec.evapotranspirationTimescaleDays * 86400;
  const edge0 = rec.recyclingHumidityThreshold;
  const edge1 = edge0 + RECYCLING_TRANSITION_WIDTH;

  const source = new Float64Array(n);
  let outerPasses = 0, outerResidual = Infinity;
  let previous = Float32Array.from(field.specificHumidityKgPerKg);

  for (let pass = 0; pass < maxOuterPasses; pass++) {
    const q = field.specificHumidityKgPerKg;
    for (let i = 0; i < n; i++) {
      if (isSource[i] || !(qSat[i] > 0)) { source[i] = 0; continue; }
      const phi = smoothstep(edge0, edge1, q[i] / qSat[i]);
      const supply = rec.landRecyclingFraction * phi * (q[i] / tauSeconds);
      const demand = Math.max(0, rh0 * qSat[i] - q[i]) / tauEtSeconds;
      source[i] = Math.min(supply, demand);
    }
    field = buildMoistureField({ ...base, landSourceKgPerKgPerS: source });
    outerPasses = pass + 1;
    outerResidual = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(field.specificHumidityKgPerKg[i] - previous[i]);
      if (d > outerResidual) outerResidual = d;
    }
    previous = Float32Array.from(field.specificHumidityKgPerKg);
    if (outerResidual < outerConvergenceKgPerKg) break;
  }

  // Water budget, for the report. `removal` is Stage 5B's own sink, which is
  // NOT precipitation -- it is the lumped removal the hypothesis splits.
  let totalRemoval = 0, totalSource = 0, supplyLimited = 0, demandLimited = 0, landCells = 0;
  for (let i = 0; i < n; i++) {
    if (isSource[i]) continue;
    landCells++;
    totalRemoval += field.specificHumidityKgPerKg[i] / tauSeconds;
    totalSource += source[i];
    const phi = qSat[i] > 0 ? smoothstep(edge0, edge1, field.specificHumidityKgPerKg[i] / qSat[i]) : 0;
    const supply = rec.landRecyclingFraction * phi * (field.specificHumidityKgPerKg[i] / tauSeconds);
    const demand = Math.max(0, rh0 * qSat[i] - field.specificHumidityKgPerKg[i]) / tauEtSeconds;
    if (supply <= demand) supplyLimited++; else demandLimited++;
  }

  return {
    ...field,
    landSourceKgPerKgPerS: source,
    recycling: {
      ...rec,
      transitionWidth: RECYCLING_TRANSITION_WIDTH,
      unknownParameters: unknown,
      applied: true,
      outerPasses,
      outerResidual,
      outerConverged: outerResidual < outerConvergenceKgPerKg,
      budget: {
        landCells,
        totalRemovalPerS: totalRemoval,
        totalSourcePerS: totalSource,
        // Must be <= landRecyclingFraction by construction. A value above it
        // would mean water was created and is a bug, not a result.
        sourceOverRemoval: totalRemoval > 0 ? totalSource / totalRemoval : 0,
        supplyLimitedCells: supplyLimited,
        demandLimitedCells: demandLimited,
      },
      note:
        "phi(RH) is a HYPOTHESIS approximating the recyclable condensing share of Stage 5B's " +
        "lumped removal. Not precipitation, not soil moisture, not vegetation, not a reservoir.",
    },
  };
}
