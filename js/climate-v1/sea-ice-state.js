// Climate v1's sea ice -- the first thing in this project that carries state
// from one orbital phase to the next.
//
// Everything before this asked a question about one moment: "is it cold enough
// here, now?". Sea ice cannot be answered that way. Ice that formed last winter
// is still there in spring, ice that survived a summer is thicker next year,
// and ice on a warm sea is gone regardless of how cold one night was. So this
// module integrates a real state variable around the year and keeps it.
//
// **It is a diagnosis, not a feedback.** Nothing here writes to a temperature
// field, and no albedo term reads it: Stage 2's annual field and the seasonal
// anomaly are exactly what they were, and switching this module on cannot move
// them by a single Float32. Albedo feedback is a later stage, deliberately.
//
// **The latent coupling, and which temperature is which.** The flux between
// the air and the ice appears in BOTH budgets now: the air pays for the ice it
// melts and is paid the latent heat the ice releases when it freezes. Before
// that, the melt energy came from nowhere and the freezing energy went nowhere
// -- measured at 1.1 to 2.0 W/m2 in every ice-bearing cell. Two things make it
// work and must not be muddled:
//
//   * The temperature this module integrates over ice is the **near-surface
//     air temperature**, not the ice surface and not the water. Berkeley
//     Earth's own Arctic ocean cells run -26 C in winter and +3 C in summer,
//     which no sea-surface temperature can do (water under ice sits at the
//     freezing point), so that is what the teacher measures and what this is.
//     It is therefore NEVER clipped at the freezing point. What the phase
//     change constrains is the exchange: while ice is melting the air is tied
//     to a surface held at the melting point by a 15 W/m2/K exchange, which
//     holds the summer down without any clipping; in winter the ice's own
//     conduction makes that same tie weak (about 0.95 W/m2/K under 2 m of
//     ice), so the cold season is left alone. The asymmetry was already in the
//     flux law -- all that was missing was the air paying for it.
//   * Crossing h = 0 spends only the energy that melts the ice that is there,
//     and returns the rest to the water. Clamping the thickness at zero and
//     discarding the difference was worth tens of MJ/m2 a year in every
//     seasonal-ice cell.
//
// No new parameter was added for any of this, and none may be: the freezing
// point, both exchange coefficients, the conductivity, the latent heat and the
// basal flux each appear exactly once, in the role they already had.
//
// **Not V0.8's `seaIceYearBudget`.** That evaluates one closed year at a time
// from the two seasons, so last year's ice cannot reach this year -- it has no
// memory, and no thickness. The ideas carried over are the physical freezing
// point and the perennial/seasonal distinction; the mechanism is new.
//
// **The known limits of what feeds this, which must never be tuned away here.**
// The sea temperature this reads has no longitudinal structure (it is exactly
// f(latitude)), no ocean currents and no AMOC, and its seasonal cycle lags the
// real one by about 72 days because of the 30 m mixed layer the season module
// uses. The consequences are visible and are *upstream* errors: the 60-70
// degree band freezes right the way round, and the ice cycle peaks two to
// three months late. Fixing those by moving a sea-ice parameter would hide an
// input error inside this model, so it is not done.
import { SEASONAL_TIME_AXIS, SURFACE_SEA, sampleSeasonalAnomalyC } from "./season.js";

/**
 * The model's own constants. `kind` says what each one is, the same discipline
 * js/climate.js applies to its parameter schema: a `physical` number is a
 * property of water or ice, an `empirical` one is a stand-in this model needs
 * and does not claim to have measured.
 */
export const SEA_ICE_PARAMETERS = {
  // Seawater freezes below fresh water because of its salt. -1.8 C is the
  // standard figure for about 34 psu. PHYSICAL, and the seam for a future
  // salinity or planet parameter: it is the only place salt enters, so
  // `freezeTemperatureC = f(salinity)` replaces this one line.
  freezeTemperatureC: { value: -1.8, kind: "physical" },

  // Ice. All three are textbook values for sea ice near its melting point.
  iceDensityKgPerM3: { value: 917, kind: "physical" },
  latentHeatFusionJPerKg: { value: 3.34e5, kind: "physical" },
  iceConductivityWPerMK: { value: 2.03, kind: "physical" },

  // How fast the surface exchanges heat with the air, per degree. EMPIRICAL:
  // it plays the role season.js's own damping plays, but it is a different
  // quantity (that one damps a temperature anomaly over a whole column; this
  // one drives a phase change at one interface) and the two are deliberately
  // not shared.
  surfaceExchangeWPerM2K: { value: 15, kind: "empirical" },
  meltExchangeWPerM2K: { value: 15, kind: "empirical" },

  // Heat the ocean delivers to the underside of the ice all year round. This
  // is the standard closure -- without it nothing stops a cold sea growing ice
  // for ever, and the measured thickness diverges (11 m and still rising after
  // 40 years). 2 W/m2 is Maykut & Untersteiner's Arctic figure and is used
  // BECAUSE it is the literature value: the sea temperature feeding this model
  // has known upstream errors, and fitting this number to match observed ice
  // thickness would absorb those errors into a sea-ice parameter. 3 and 4 are
  // measured in the validator as a sensitivity test and are not adopted.
  oceanBasalHeatFluxWPerM2: { value: 2, kind: "physical" },

  // Thickness at which a cell is counted as fully covered. EMPIRICAL AND
  // PROVISIONAL -- a real ice-fraction model needs the floe-scale processes
  // (ridging, leads, export) this model does not have, and this stands in for
  // all of them. Not to be quoted as a physical constant.
  fullCoverThicknessM: { value: 0.3, kind: "empirical" },
};

/** Defaults resolved by name, so a caller overrides only what it means to. */
export function resolveSeaIceParameters(overrides = {}) {
  const out = {};
  for (const [name, spec] of Object.entries(SEA_ICE_PARAMETERS)) {
    const given = overrides[name];
    out[name] = Number.isFinite(given) ? given : spec.value;
  }
  return out;
}

export const SEA_ICE_DEFAULTS = {
  // Steps the year is integrated in. 48 reproduces an 8760-step reference to
  // within 0.02 m of annual maximum thickness and 24 is within 0.05 m -- but
  // the melt season is the part that needs resolving once the latent coupling
  // below is on, and the share of the globe that keeps ice all year is
  // measurably step-sensitive (0.37 / 0.67 / 0.83 / 1.02 % at 24 / 48 / 96 /
  // 365 steps). 96 is where that stops moving fast for what it costs.
  stepsPerYear: 96,

  // Whether the air pays for the ice it melts. See `latentCoupling` below --
  // this is an energy-conservation fix, not an option to taste, and it is on.
  // The uncoupled path is kept only so a validator can measure the difference.
  latentCoupling: true,
  // Phases kept in the returned tables. Fewer than the integration uses,
  // because what is stored is for drawing and the integration is not.
  outputPhaseCount: 24,
  // Years of spin-up. Five is enough for the ice *fraction* everywhere
  // measured; perennial thickness genuinely needs decades and is reported
  // rather than waited for.
  years: 5,
  // The grid the state lives on. Coarse on purpose: the sea temperature this
  // reads is a function of latitude alone, so a finer grid would carry no
  // information the input does not have, and the cost is linear in cells.
  gridWidth: 256,
  gridHeight: 128,
  // Keep the integrated air temperature at every stored phase. Off by
  // default: 3 MB for something only a validator reads.
  keepAirTemperature: false,
  // Where the spin-up starts. The default is an ice-free ocean at its own
  // annual mean; a validator uses this to show that a frozen or a hot start
  // reaches the same periodic solution, i.e. that the coupling is not
  // bistable. Never a physical input.
  startThicknessM: 0,
  startAirOffsetC: 0,
  // Year-boundary differences below these count as a periodic steady state.
  thicknessToleranceM: 0.01,
  fractionTolerance: 0.01,
};

const SECONDS_PER_DAY = 86400;

/**
 * Integrates one orbit of sea ice to its periodic steady state.
 *
 * Reads `temperatureField.annualMeanTemperatureC` and the season table; writes
 * to neither. Only the world's ocean is integrated -- `terrainField.isSea`
 * excludes lakes by construction, and lake ice is a separate question this
 * model has no right to answer.
 */
export function buildSeaIceCycle({
  temperatureField, terrainField, seasonTable, params = {}, options = {},
}) {
  if (!temperatureField || !terrainField || !seasonTable) {
    throw new Error("buildSeaIceCycle requires temperatureField, terrainField and seasonTable");
  }
  const p = resolveSeaIceParameters(params);
  const o = { ...SEA_ICE_DEFAULTS, ...options };
  const width = o.gridWidth, height = o.gridHeight;
  const cells = width * height;
  const yearSeconds = (seasonTable.yearLengthDays || 365.2422) * SECONDS_PER_DAY;

  // --- the forcing, on this module's own grid ------------------------------
  // Each cell keeps the mean temperature of the *sea* inside it and what share
  // of it is sea, so a coastal cell is neither ignored nor treated as open
  // ocean. Cells with no sea at all are left out of the integration entirely.
  const { seaFraction, seaMeanTemperatureC } = coarsenSea(temperatureField, terrainField, width, height);

  const steps = o.stepsPerYear;
  const dt = yearSeconds / steps;
  const latentPerMetre = p.iceDensityKgPerM3 * p.latentHeatFusionJPerKg;   // J/m2 per metre of ice
  const resistanceOpen = 1 / p.surfaceExchangeWPerM2K;                      // m2K/W
  const coupled = o.latentCoupling !== false;

  // The seasonal anomaly depends only on the row and the phase, so it is a
  // (rows x steps) table rather than a per-cell lookup -- the same reason the
  // season module stores harmonics per row.
  const rowAnomaly = new Float64Array(height * steps);
  for (let y = 0; y < height; y++) {
    const tableRow = Math.min(seasonTable.rows - 1, Math.floor((y * seasonTable.rows) / height));
    for (let s = 0; s < steps; s++) {
      rowAnomaly[y * steps + s] = sampleSeasonalAnomalyC(seasonTable, tableRow, SURFACE_SEA, s / steps);
    }
  }
  // With the latent coupling on the air temperature stops being a lookup and
  // becomes a state of this module, so what it needs is the FORCING rather
  // than the answer. That is recovered from the season table itself -- see
  // `rowForcingFromSeasonTable` -- so no new input, no new parameter, and no
  // second copy of the insolation geometry enters here.
  const lambda = Number.isFinite(seasonTable.oceanDampingWPerM2K)
    ? seasonTable.oceanDampingWPerM2K : seasonTable.dampingWPerM2K;
  const heatCapacity = seasonTable.heatCapacityJPerM2K.sea;
  const rowForcing = coupled
    ? rowForcingFromSeasonTable({ seasonTable, height, steps, lambda, heatCapacity, yearSeconds })
    : null;

  const thickness = new Float64Array(cells);          // the state, metres
  const yearStart = new Float64Array(cells);
  // The air / mixed-layer temperature, the second state the coupling needs.
  const airC = coupled ? new Float64Array(cells) : null;
  for (let i = 0; i < cells; i++) {
    if (!(seaFraction[i] > 0)) continue;
    if (coupled) airC[i] = seaMeanTemperatureC[i] + o.startAirOffsetC;
    if (o.startThicknessM > 0) thickness[i] = o.startThicknessM;
  }
  // Per-cell diagnostics for the final year. Cheap (three Float32 grids) and
  // the only way the energy budget can be checked cell by cell.
  const energyResidualWPerM2 = coupled ? new Float32Array(cells) : null;
  const meltEnergyJPerM2 = coupled ? new Float32Array(cells) : null;
  const freezeEnergyJPerM2 = coupled ? new Float32Array(cells) : null;
  const airMinC = coupled ? new Float32Array(cells) : null;
  const airMaxC = coupled ? new Float32Array(cells) : null;
  const outPhases = o.outputPhaseCount;
  const thicknessByPhase = new Float32Array(outPhases * cells);
  const fractionByPhase = new Float32Array(outPhases * cells);
  // Which integration step each stored phase comes from. Integrating finer
  // than is stored is deliberate: accuracy is an integration question and
  // size is a storage one.
  const storeAt = new Int32Array(steps).fill(-1);
  for (let k = 0; k < outPhases; k++) storeAt[Math.round((k * steps) / outPhases) % steps] = k;
  // The air temperature at each stored phase. Off by default -- it is another
  // 3 MB and only a validator wants it; the app reads the season table.
  const airByPhase = coupled && o.keepAirTemperature ? new Float32Array(outPhases * cells) : null;

  let fractionConverged = null;
  let thicknessConverged = null;
  let maxYearBoundaryDifference = Infinity;
  let maxFractionBoundaryDifference = Infinity;

  for (let year = 0; year < o.years; year++) {
    const last = year === o.years - 1;
    yearStart.set(thickness);
    if (last && coupled) {
      energyResidualWPerM2.fill(0); meltEnergyJPerM2.fill(0); freezeEnergyJPerM2.fill(0);
      airMinC.fill(Infinity); airMaxC.fill(-Infinity);
    }
    for (let s = 0; s < steps; s++) {
      const store = last ? storeAt[s] : -1;
      for (let y = 0; y < height; y++) {
        const anomaly = rowAnomaly[y * steps + s];
        const forcing = coupled ? rowForcing[y * steps + s] : 0;
        const row = y * width;
        for (let x = 0; x < width; x++) {
          const i = row + x;
          if (!(seaFraction[i] > 0)) continue;
          // WHICH temperature this is matters and is written down in the
          // module header: over ice it is the near-surface AIR temperature,
          // not the ice surface and not the water. It is free to sit far below
          // the freezing point in winter and a little above it in summer; what
          // the phase change constrains is the exchange, never this number.
          const t = coupled ? airC[i] : seaMeanTemperatureC[i] + anomaly;
          const h = thickness[i];
          // Freezing: the heat has to escape THROUGH the ice, so its own
          // conduction is a resistance in series with the surface exchange --
          // which is why growth slows as the ice thickens (Stefan).
          // Melting: the surface is already at the melting point and absorbs
          // heat directly, so thickness shields nothing. That asymmetry is
          // what lets a cold sea keep multi-year ice while a warm one cannot.
          //
          // `flux` is positive when heat leaves the ice/ocean surface for the
          // air, which is exactly when ice grows: the latent heat of freezing
          // has to go somewhere, and it goes up.
          //
          // The two `coupled ?` guards below exist so the uncoupled path stays
          // BIT-IDENTICAL to what this module shipped, while the coupled one
          // is physical: with the air paying, melting nothing and a basal flux
          // arriving under ice that is not there would hand every ice-free sea
          // cell a standing 2 W/m2 of free heat.
          const flux = t <= p.freezeTemperatureC
            ? (p.freezeTemperatureC - t) / (resistanceOpen + h / p.iceConductivityWPerMK)
            : (!coupled || h > 0 ? -p.meltExchangeWPerM2K * (t - p.freezeTemperatureC) : 0);
          // The ocean's own heat only reaches the underside of ice that exists.
          const basal = !coupled || h > 0 ? p.oceanBasalHeatFluxWPerM2 : 0;
          let dh = ((flux - basal) * dt) / latentPerMetre;
          // Crossing h = 0: spend only what melts the ice that is actually
          // there and hand the rest back to the water. Clamping to zero and
          // walking away destroys real energy -- measured at tens of MJ/m2 a
          // year in every seasonal-ice cell.
          let returned = 0;
          if (h + dh < 0) { returned = -(h + dh) * latentPerMetre; dh = -h; }
          const hNext = h + dh;
          thickness[i] = hNext > 0 ? hNext : 0;
          if (coupled) {
            // The air pays for the melt and is paid for the freeze: the same
            // `flux`, once, with the opposite sign. This is the whole fix.
            const air = forcing - lambda * (t - seaMeanTemperatureC[i]) + flux + returned / dt;
            const next = t + (dt / heatCapacity) * air;
            if (last) {
              // (what came in) - (what was stored). The latent term carries a
              // minus because freezing RELEASES energy: the enthalpy of the
              // ice-water system falls as the ice grows.
              const into = (forcing - lambda * (t - seaMeanTemperatureC[i]) + basal) * dt;
              const stored = heatCapacity * (next - t) - latentPerMetre * dh;
              energyResidualWPerM2[i] += (into - stored) / (steps * dt);
              if (flux > 0) freezeEnergyJPerM2[i] += flux * dt; else meltEnergyJPerM2[i] += -flux * dt;
              if (t < airMinC[i]) airMinC[i] = t;
              if (t > airMaxC[i]) airMaxC[i] = t;
            }
            airC[i] = next;
          }
          if (store >= 0) {
            const at = store * cells + i;
            thicknessByPhase[at] = thickness[i];
            fractionByPhase[at] = Math.min(1, thickness[i] / p.fullCoverThicknessM);
            if (airByPhase) airByPhase[at] = t;
          }
        }
      }
    }
    // How far this year ended from where it began: the periodic-steady-state
    // test. Fraction and thickness are recorded separately on purpose -- the
    // fraction settles in a few years where perennial thickness takes decades,
    // and a run that has one but not the other is a useful result, not a
    // failure.
    let dH = 0, dF = 0;
    for (let i = 0; i < cells; i++) {
      if (!(seaFraction[i] > 0)) continue;
      const diff = Math.abs(thickness[i] - yearStart[i]);
      if (diff > dH) dH = diff;
      const df = Math.abs(
        Math.min(1, thickness[i] / p.fullCoverThicknessM) - Math.min(1, yearStart[i] / p.fullCoverThicknessM),
      );
      if (df > dF) dF = df;
    }
    maxYearBoundaryDifference = dH;
    maxFractionBoundaryDifference = dF;
    if (fractionConverged === null && dF <= o.fractionTolerance) fractionConverged = year + 1;
    if (thicknessConverged === null && dH <= o.thicknessToleranceM) thicknessConverged = year + 1;
  }

  let worstResidual = 0, sumResidual = 0, residualCells = 0;
  if (coupled) {
    for (let i = 0; i < cells; i++) {
      if (!(seaFraction[i] > 0)) continue;
      const r = Math.abs(energyResidualWPerM2[i]);
      if (r > worstResidual) worstResidual = r;
      sumResidual += r; residualCells++;
      if (!Number.isFinite(airMinC[i])) { airMinC[i] = NaN; airMaxC[i] = NaN; }
    }
  }

  return {
    phaseCount: outPhases,
    width, height,
    thicknessByPhase,
    fractionByPhase,
    seaFraction,
    // Final-year diagnostics, null when the coupling is off. `airMinC`/
    // `airMaxC` are that cell's own near-surface air temperature over the
    // year -- the state this module now integrates, which is NOT what the app
    // draws (that is still the season table's analytic anomaly).
    energyResidualWPerM2, meltEnergyJPerM2, freezeEnergyJPerM2, airMinC, airMaxC, airByPhase,
    meta: {
      latentCoupling: coupled,
      energy: coupled ? {
        maxAbsResidualWPerM2: worstResidual,
        meanAbsResidualWPerM2: residualCells > 0 ? sumResidual / residualCells : 0,
      } : null,
      stepsPerYear: steps,
      yearsUsed: o.years,
      fractionConverged,
      thicknessConverged,
      maxYearBoundaryDifference,
      maxFractionBoundaryDifference,
      params: p,
      yearLengthDays: seasonTable.yearLengthDays,
      axialTiltDegrees: seasonTable.axialTiltDegrees,
      // Said here so a caller cannot forget it: this is a diagnosis. Nothing
      // in the temperature pipeline reads it. The latent coupling added in
      // 2026-09 conserves energy INSIDE this module -- the air temperature it
      // integrates is its own state and is never written back to the season
      // table, so the globe still draws exactly what it drew.
      feedsBackIntoTemperature: false,
    },
  };
}

/** Ice thickness in metres at one cell index and one orbital phase. */
export function sampleSeaIceThicknessM(cycle, index, orbitalPhase) {
  return cycle.thicknessByPhase[phaseSlot(cycle, orbitalPhase) * cycle.width * cycle.height + index];
}

/** Ice fraction (0-1) at one cell index and one orbital phase. */
export function sampleSeaIceFraction(cycle, index, orbitalPhase) {
  return cycle.fractionByPhase[phaseSlot(cycle, orbitalPhase) * cycle.width * cycle.height + index];
}

/**
 * The whole ice-fraction grid at one orbital phase, as a view into the stored
 * table rather than a copy. A drawing caller wants every cell at one instant,
 * which is the transpose of what sampleSeaIceFraction answers, and the phase
 * slot arithmetic lives in exactly one place either way.
 */
export function seaIceFractionSlice(cycle, orbitalPhase) {
  const cells = cycle.width * cycle.height;
  const slot = phaseSlot(cycle, orbitalPhase);
  return cycle.fractionByPhase.subarray(slot * cells, (slot + 1) * cells);
}

function phaseSlot(cycle, orbitalPhase) {
  const phase = SEASONAL_TIME_AXIS.normalise(orbitalPhase);
  return Math.min(cycle.phaseCount - 1, Math.floor(phase * cycle.phaseCount));
}

/**
 * The seasonal FORCING each row saw, recovered from the season table's own
 * answer -- exactly, and with nothing new to get wrong.
 *
 * `solvePeriodicResponse` turns a forcing harmonic (A, B) into a response
 * (cos, sin) by dividing by lambda and applying gain `1/(1+k^2)` and lag
 * `atan(k)`, with `k = n omega C / lambda`. That map is invertible:
 *
 *     a = cos + k sin,   b = sin - k cos,   (A, B) = lambda (a, b)
 *
 * so this module can integrate its own air temperature without a second copy
 * of the insolation geometry, the orbit or the absorbed fraction. If the
 * season module ever changes how it solves, this inverse changes with it --
 * which is the point of deriving it from the table rather than rebuilding it.
 *
 * The check that it is right is in tools/validate_sea_ice_state.mjs: with the
 * ice removed, integrating this forcing reproduces the table's own anomaly.
 */
function rowForcingFromSeasonTable({ seasonTable, height, steps, lambda, heatCapacity, yearSeconds }) {
  const H = seasonTable.harmonics;
  const omega = (2 * Math.PI) / yearSeconds;
  const tau = heatCapacity / lambda;
  const out = new Float64Array(height * steps);
  const A = new Float64Array(H), B = new Float64Array(H);
  for (let y = 0; y < height; y++) {
    const tableRow = Math.min(seasonTable.rows - 1, Math.floor((y * seasonTable.rows) / height));
    const base = (tableRow * 2 + 1) * H * 2;    // surface 1 = SURFACE_SEA
    for (let n = 1; n <= H; n++) {
      const c = seasonTable.coefficients[base + (n - 1) * 2];
      const d = seasonTable.coefficients[base + (n - 1) * 2 + 1];
      const k = n * omega * tau;
      A[n - 1] = lambda * (c + k * d);
      B[n - 1] = lambda * (d - k * c);
    }
    for (let s = 0; s < steps; s++) {
      const phase = s / steps;
      let sum = 0;
      for (let n = 1; n <= H; n++) {
        const theta = 2 * Math.PI * n * phase;
        sum += A[n - 1] * Math.cos(theta) + B[n - 1] * Math.sin(theta);
      }
      out[y * steps + s] = sum;
    }
  }
  return out;
}

/**
 * The sea's own share of each coarse cell, and the mean temperature of that
 * sea. Area-averaged rather than point-sampled for the same reason the climate
 * model area-averages its elevation: a point sample of a coastline is a coin
 * toss.
 */
function coarsenSea(temperatureField, terrainField, width, height) {
  const { width: fw, height: fh, annualMeanTemperatureC } = temperatureField;
  const seaFraction = new Float32Array(width * height);
  const seaMeanTemperatureC = new Float32Array(width * height);
  const total = new Float64Array(width * height);
  const seaCount = new Float64Array(width * height);
  const sum = new Float64Array(width * height);
  const bx = fw / width, by = fh / height;
  for (let y = 0; y < fh; y++) {
    const cy = Math.min(height - 1, Math.floor(y / by));
    for (let x = 0; x < fw; x++) {
      const i = y * fw + x;
      const c = cy * width + Math.min(width - 1, Math.floor(x / bx));
      total[c] += 1;
      if (terrainField.isSea[i]) {
        seaCount[c] += 1;
        sum[c] += annualMeanTemperatureC[i];
      }
    }
  }
  for (let c = 0; c < width * height; c++) {
    seaFraction[c] = total[c] > 0 ? seaCount[c] / total[c] : 0;
    seaMeanTemperatureC[c] = seaCount[c] > 0 ? sum[c] / seaCount[c] : NaN;
  }
  return { seaFraction, seaMeanTemperatureC };
}
