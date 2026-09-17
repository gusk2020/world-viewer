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
  // within 0.02 m of annual maximum thickness; 24 is within 0.05 m.
  stepsPerYear: 48,
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

  const thickness = new Float64Array(cells);          // the state, metres
  const yearStart = new Float64Array(cells);
  const outPhases = o.outputPhaseCount;
  const thicknessByPhase = new Float32Array(outPhases * cells);
  const fractionByPhase = new Float32Array(outPhases * cells);
  // Which integration step each stored phase comes from. Integrating finer
  // than is stored is deliberate: accuracy is an integration question and
  // size is a storage one.
  const storeAt = new Int32Array(steps).fill(-1);
  for (let k = 0; k < outPhases; k++) storeAt[Math.round((k * steps) / outPhases) % steps] = k;

  let fractionConverged = null;
  let thicknessConverged = null;
  let maxYearBoundaryDifference = Infinity;
  let maxFractionBoundaryDifference = Infinity;

  for (let year = 0; year < o.years; year++) {
    const last = year === o.years - 1;
    yearStart.set(thickness);
    for (let s = 0; s < steps; s++) {
      const store = last ? storeAt[s] : -1;
      for (let y = 0; y < height; y++) {
        const anomaly = rowAnomaly[y * steps + s];
        const row = y * width;
        for (let x = 0; x < width; x++) {
          const i = row + x;
          if (!(seaFraction[i] > 0)) continue;
          const t = seaMeanTemperatureC[i] + anomaly;
          let h = thickness[i];
          // Freezing: the heat has to escape THROUGH the ice, so its own
          // conduction is a resistance in series with the surface exchange --
          // which is why growth slows as the ice thickens (Stefan).
          // Melting: the surface is already at the melting point and absorbs
          // heat directly, so thickness shields nothing. That asymmetry is
          // what lets a cold sea keep multi-year ice while a warm one cannot.
          let flux = t <= p.freezeTemperatureC
            ? (p.freezeTemperatureC - t) / (resistanceOpen + h / p.iceConductivityWPerMK)
            : -p.meltExchangeWPerM2K * (t - p.freezeTemperatureC);
          flux -= p.oceanBasalHeatFluxWPerM2;
          h += (flux / latentPerMetre) * dt;
          if (!(h > 0)) h = 0;
          thickness[i] = h;
          if (store >= 0) {
            const at = store * cells + i;
            thicknessByPhase[at] = h;
            fractionByPhase[at] = Math.min(1, h / p.fullCoverThicknessM);
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

  return {
    phaseCount: outPhases,
    width, height,
    thicknessByPhase,
    fractionByPhase,
    seaFraction,
    meta: {
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
      // in the temperature pipeline reads it.
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

function phaseSlot(cycle, orbitalPhase) {
  const phase = SEASONAL_TIME_AXIS.normalise(orbitalPhase);
  return Math.min(cycle.phaseCount - 1, Math.floor(phase * cycle.phaseCount));
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
