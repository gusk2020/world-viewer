// Climate v1's moisture field -- Stage 5B of the redesigned pipeline
// (terrain -> land/sea -> temperature -> wind -> humidity capacity ->
// **moisture** -> ...). See docs/climate-v1-moisture-stage5b.md.
//
// This is the first stage that produces the ACTUAL specific humidity of the
// air, rather than the capacity Stage 5A computed.
//
// ---------------------------------------------------------------------------
// THE CONTROL THIS HAS TO BEAT, MEASURED BEFORE ANY OF IT WAS WRITTEN
//
// `q = 0.826 * q_sat`, with no transport whatsoever, already scores r = 0.9234
// against the teacher globally and r = 0.9729 over ocean, because q is mostly
// RH times capacity and capacity is mostly temperature. Correlation is also
// completely insensitive to the RH value, since a uniform scaling cannot move
// a correlation.
//
// So a rising global correlation would mean nothing here. What the control
// gets WRONG is the land pattern, and that is the whole target:
//
//     Sahara    +10.70 g/kg too moist
//     Australia  +8.74 too moist
//     Amazon     +4.35 too moist
//     Europe     -2.15 too dry
//
// Stage 5B succeeds only if it dries the subtropical deserts without drying
// the Amazon. Every success criterion was declared against that control
// before this file existed.
//
// ---------------------------------------------------------------------------
// THE EQUATION
//
// A steady state, not a time integration -- the whole pipeline is an annual
// mean, so there is no clock to step:
//
//     u dq/dx + v dq/dy  =  -q/tau  +  K grad^2 q          (away from water)
//     q = surfaceRelativeHumidity * q_sat                  (on water)
//     q <= q_sat(T, p)                                     (everywhere)
//
// solved by upwind Gauss-Seidel sweeps. Every coefficient is positive and the
// diagonal dominates, so it is unconditionally stable and needs no timestep,
// no CFL condition and no tuning to converge.
//
// **The saturation cap IS the orographic mechanism, and it needs no parameter
// of its own.** Stage 2 already applies the lapse rate to elevation and Stage
// 5A already computes pressure there, so `q_sat` at a mountain cell is
// *already* the saturation of air that has been lifted to that height. Air
// carrying 15 g/kg onto a 3000 m plateau meets a cap near 8 g/kg and the
// excess is removed; what continues over the crest is what is left. A
// separate `orographicLiftFraction` was in the design and is deliberately NOT
// here: it would have been a second, empirical copy of a mechanism the
// physics already provides. Removed before screening rather than after.
//
// ---------------------------------------------------------------------------
// WHAT `moistureResidenceDays` IS, AND WHAT IT IS NOT
//
// It is **not** the Hadley circulation's subsidence, and must not be called
// that. A single global tau cannot represent a subtropical high, which is a
// specific latitude band with a specific vertical structure that this
// single-layer annual-mean model has no way to express.
//
// It is a deliberate lumping: **the effective residence time of water vapour
// in the air against every removal process this model does not resolve** --
// condensation, precipitation, and mixing with drier air above. One global
// value, by construction:
//
//   * no per-region tau,
//   * no per-latitude tau,
//   * no term that acts only on one place.
//
// If it is fitted, it is fitted on a training subset of *all* land, and the
// regional numbers (Sahara, Amazon, Australia...) are held out as diagnostics
// so they cannot become the thing being optimised.
//
// ---------------------------------------------------------------------------
// WHY THE REFERENCE SPEED IS A CONSTANT AND NOT A PARAMETER
//
// In the direction-controlled comparisons the wind is normalised to one
// shared speed, so that A and B differ ONLY in direction. That speed cannot
// be fitted, and it also does not need to be: in this equation the advection
// and the sink appear as `|U|/dx` against `1/tau`, so only the product
// `U * tau` -- a length -- is identifiable. Changing the reference speed and
// changing tau are the same change. Fixing the speed and searching tau is
// therefore the complete parameterisation, with nothing hidden in the speed.
export const REFERENCE_TRANSPORT_SPEED_MS = 5;

/** How the wind is fed in. */
export const WIND_MODES = {
  // Direction only, normalised to REFERENCE_TRANSPORT_SPEED_MS. The two
  // direction-controlled runs differ in nothing else, so a difference between
  // them is a difference of wind DIRECTION and cannot be anything else.
  DIRECTION: "direction",
  // The wind's own metres per second, used as given. Only legitimate for a
  // wind that is genuinely in m/s -- Climate v0.8's field is dimensionless and
  // must never be scaled into m/s by a factor fitted to the teacher.
  PHYSICAL: "physical",
};

export const MOISTURE_PARAMETERS = {
  surfaceRelativeHumidity: {
    default: 0.826,
    kind: "empirical",
    search: false,
    min: 0.5,
    max: 1.0,
    note:
      "Relative humidity held at a water surface. MEASURED, not fitted: the teacher's " +
      "own specific humidity divided by this model's q_sat comes to 0.826 over ocean, and " +
      "is between 0.73 and 0.85 in almost every latitude band. Because this is a boundary " +
      "condition taken FROM the teacher, agreement over ocean is not a prediction and is " +
      "never reported as skill.",
  },
  moistureResidenceDays: {
    default: 3,
    kind: "empirical",
    search: true,
    min: 0.25,
    max: 30,
    note:
      "Effective residence time of water vapour against the removal processes this model " +
      "does not resolve (condensation, precipitation, mixing with drier air aloft). NOT the " +
      "Hadley subsidence -- one global value cannot represent a subtropical high. Global, " +
      "never per-region or per-latitude.",
  },
  eddyDiffusivityM2PerS: {
    default: 2e5,
    kind: "physical",
    search: true,
    min: 1e4,
    max: 3e6,
    note:
      "Horizontal eddy diffusivity: transport by everything the annual-mean wind averages " +
      "away, chiefly mid-latitude storms. Values of 1e5-1e6 m^2/s are the standard range " +
      "for large-scale atmospheric eddy mixing.",
  },
};

export function resolveMoistureParams(overrides = {}) {
  const values = {};
  const unknown = [];
  for (const [name, spec] of Object.entries(MOISTURE_PARAMETERS)) values[name] = spec.default;
  for (const [name, value] of Object.entries(overrides)) {
    if (name.startsWith("_")) continue;
    if (!(name in MOISTURE_PARAMETERS)) { unknown.push(name); continue; }
    if (!Number.isFinite(value)) throw new Error(`moisture parameter ${name} must be a finite number`);
    values[name] = value;
  }
  return { values, unknown };
}

/** Block-average a fine grid down to the transport grid. */
function coarsen(fine, fineW, fineH, W, H) {
  if (fineW % W !== 0 || fineH % H !== 0) {
    throw new Error(`transport grid ${W}x${H} must divide the source grid ${fineW}x${fineH}`);
  }
  const bx = fineW / W, by = fineH / H;
  const out = new Float64Array(W * H);
  for (let y = 0; y < fineH; y++) {
    const cy = Math.floor(y / by);
    for (let x = 0; x < fineW; x++) {
      out[cy * W + Math.floor(x / bx)] += fine[y * fineW + x];
    }
  }
  const per = bx * by;
  for (let i = 0; i < out.length; i++) out[i] /= per;
  return out;
}

/**
 * Build the moisture field.
 *
 * `wind` is { width, height, uWindMs, vWindMs } on the transport grid.
 * `windMode` is one of WIND_MODES.
 */
export function buildMoistureField({
  terrainField,
  temperatureField,
  humidityField,
  wind,
  windMode = WIND_MODES.DIRECTION,
  body,
  params: overrides = {},
  // Measured: the answer is stable to four significant figures by 200 sweeps,
  // and the residual falls to 1e-7 kg/kg (1e-4 g/kg) by around 400. A tighter
  // threshold than that is chasing Float64 accumulation noise, not physics --
  // the first version asked for 1e-9 and reported "not converged" at 8000
  // sweeps while the field had not moved since sweep 200.
  maxSweeps = 2000,
  convergenceKgPerKg = 1e-7,
}) {
  if (!terrainField || !temperatureField || !humidityField) {
    throw new Error("buildMoistureField requires terrainField, temperatureField and humidityField");
  }
  if (!wind || !wind.uWindMs || !wind.vWindMs) {
    throw new Error("buildMoistureField requires wind { width, height, uWindMs, vWindMs }");
  }
  if (!body || !Number.isFinite(body.radiusMetres)) {
    throw new Error("buildMoistureField requires body { radiusMetres }");
  }
  if (windMode !== WIND_MODES.DIRECTION && windMode !== WIND_MODES.PHYSICAL) {
    throw new Error(`unknown wind mode ${windMode}`);
  }
  const { values: params, unknown } = resolveMoistureParams(overrides);

  const W = wind.width, H = wind.height;
  const fineW = terrainField.width, fineH = terrainField.height;
  const qSat = coarsen(humidityField.saturationSpecificHumidityKgPerKg, fineW, fineH, W, H);
  const waterFraction = coarsen(Float32Array.from(terrainField.isWaterSurface), fineW, fineH, W, H);

  const n = W * H;
  const isSource = new Uint8Array(n);
  const q = new Float64Array(n);
  const cap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cap[i] = qSat[i];
    // A coarse cell counts as a source when it is mostly water. Coastal cells
    // that are half land are ordinary cells fed by their neighbours, which is
    // what they physically are.
    isSource[i] = waterFraction[i] >= 0.5 ? 1 : 0;
    q[i] = isSource[i] ? params.surfaceRelativeHumidity * qSat[i] : 0;
  }

  const R = body.radiusMetres;
  const dy = (Math.PI * R) / H;
  const tauSeconds = params.moistureResidenceDays * 86400;
  const K = params.eddyDiffusivityM2PerS;

  // Per-row geometry. cos(lat) is floored so the zonal cell width cannot go to
  // zero at the pole rows and produce an infinite advection coefficient; the
  // floor is a numerical guard on the grid, not a physical statement.
  const MIN_COS = Math.cos((89.5 * Math.PI) / 180);
  const dxOfRow = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) * 180) / H;
    dxOfRow[y] = (2 * Math.PI * R * Math.max(MIN_COS, Math.cos((lat * Math.PI) / 180))) / W;
  }

  // Wind, in the form the sweep wants.
  const uu = new Float64Array(n), vv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let u = wind.uWindMs[i], v = wind.vWindMs[i];
    if (!Number.isFinite(u) || !Number.isFinite(v)) { u = 0; v = 0; }
    if (windMode === WIND_MODES.DIRECTION) {
      const m = Math.hypot(u, v);
      // A cell with no wind at all keeps no wind: diffusion and the sink still
      // act there. Climate v0.8's field is exactly zero on its cell boundaries,
      // and inventing a direction for those rows would be inventing data.
      if (m > 0) { u = (u / m) * REFERENCE_TRANSPORT_SPEED_MS; v = (v / m) * REFERENCE_TRANSPORT_SPEED_MS; }
      else { u = 0; v = 0; }
    }
    uu[i] = u; vv[i] = v;
  }

  // Alternating-direction Gauss-Seidel. Sweeping both ways each round stops
  // the answer depending on which corner the sweep starts from, which is what
  // makes the result deterministic rather than merely reproducible.
  let sweeps = 0, residual = Infinity;
  for (; sweeps < maxSweeps; sweeps++) {
    residual = 0;
    const forward = sweeps % 2 === 0;
    for (let yi = 0; yi < H; yi++) {
      const y = forward ? yi : H - 1 - yi;
      const dx = dxOfRow[y];
      const row = y * W;
      for (let xi = 0; xi < W; xi++) {
        const x = forward ? xi : W - 1 - xi;
        const i = row + x;
        if (isSource[i]) continue;

        const east = row + (x === W - 1 ? 0 : x + 1);
        const west = row + (x === 0 ? W - 1 : x - 1);
        const north = y === 0 ? i : i - W;
        const south = y === H - 1 ? i : i + W;

        const a = Math.abs(uu[i]) / dx;                 // zonal advection
        const b = Math.abs(vv[i]) / dy;                 // meridional advection
        const upX = uu[i] >= 0 ? west : east;           // u > 0 blows eastward
        const upY = vv[i] >= 0 ? south : north;         // v > 0 blows northward
        const dxx = K / (dx * dx), dyy = K / (dy * dy);

        const numerator =
          a * q[upX] + b * q[upY] +
          dxx * (q[east] + q[west]) + dyy * (q[north] + q[south]);
        const denominator = a + b + 1 / tauSeconds + 2 * dxx + 2 * dyy;
        let next = numerator / denominator;
        if (next > cap[i]) next = cap[i];
        if (!(next >= 0)) next = 0;

        const delta = Math.abs(next - q[i]);
        if (delta > residual) residual = delta;
        q[i] = next;
      }
    }
    if (residual < convergenceKgPerKg) { sweeps++; break; }
  }

  // Condensation: what the cap removed, relative to what the transport would
  // otherwise have delivered. A DIAGNOSTIC ONLY -- it is not a precipitation
  // rate, it is not in kg/m^2/s, and it must not be called precipitation or
  // exported as one. It exists so that a future stage can see whether the
  // orographic mechanism is doing anything, which a humidity field alone
  // cannot show.
  const condensation = new Float64Array(n);
  for (let y = 0; y < H; y++) {
    const dx = dxOfRow[y], row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      if (isSource[i]) continue;
      const east = row + (x === W - 1 ? 0 : x + 1);
      const west = row + (x === 0 ? W - 1 : x - 1);
      const north = y === 0 ? i : i - W;
      const south = y === H - 1 ? i : i + W;
      const a = Math.abs(uu[i]) / dx, b = Math.abs(vv[i]) / dy;
      const upX = uu[i] >= 0 ? west : east;
      const upY = vv[i] >= 0 ? south : north;
      const dxx = K / (dx * dx), dyy = K / (dy * dy);
      const unconstrained =
        (a * q[upX] + b * q[upY] + dxx * (q[east] + q[west]) + dyy * (q[north] + q[south])) /
        (a + b + 1 / tauSeconds + 2 * dxx + 2 * dyy);
      condensation[i] = Math.max(0, unconstrained - cap[i]);
    }
  }

  const specificHumidityKgPerKg = new Float32Array(n);
  const relativeHumidity = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    specificHumidityKgPerKg[i] = q[i];
    relativeHumidity[i] = qSat[i] > 0 ? q[i] / qSat[i] : 0;
  }

  return {
    width: W, height: H,
    specificHumidityKgPerKg,
    relativeHumidity,
    condensationKgPerKg: Float32Array.from(condensation),
    saturationSpecificHumidityKgPerKg: Float32Array.from(qSat),
    isSource,
    meta: {
      stage: "5B",
      windMode,
      referenceTransportSpeedMs: windMode === WIND_MODES.DIRECTION ? REFERENCE_TRANSPORT_SPEED_MS : null,
      sweeps, residual,
      converged: residual < convergenceKgPerKg,
      params,
      unknownParameters: unknown,
      note: "condensationKgPerKg is an internal diagnostic and is NOT a precipitation rate.",
    },
  };
}
