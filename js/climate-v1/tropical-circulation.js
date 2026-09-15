// Climate v1's Hadley-cell surface pressure -- the term Stage 4 assumed away.
//
// Stage 4 solves a momentum balance from a geopotential built by the
// hypsometric relation, and states its own assumption plainly: the SURFACE
// geopotential anomaly is taken as zero, i.e. surface pressure is uniform.
// That is exactly the equatorial trough and the subtropical ridges thrown
// away, and it is why Stage 4's tropical wind is 125.9 degrees off and why
// Stage 5B's transport, given that wind, delivers 0.0 g/kg to the Amazon.
// The real annual-mean ocean surface pressure varies with a standard
// deviation of 10.09 hPa; Stage 4's varies by nothing.
//
// This file supplies the missing mass field, and nothing else.
//
// ---------------------------------------------------------------------------
// AXISYMMETRIC, NOT A 2-D GILL SOLVER -- AND WHY THAT IS NOT A SIMPLIFICATION
//
// The heating Q here is the ZONAL MEAN only (see below), so every zonal
// derivative in the shallow-water system is identically zero. Writing the
// full Matsuno-Gill problem and then feeding it a zonally symmetric forcing
// produces exactly the same answer as the 1-D problem, at far greater cost,
// and leaves an asymmetric-Q input sitting there inviting a Walker response
// that this stage is explicitly not doing. So the 1-D form is adopted on the
// merits, not as an approximation of the 2-D one.
//
// With d/dx = 0 the linear damped system
//
//     r*u - f*v = -dPhi/dx = 0
//     f*u + r*v = -dPhi/dy
//     r*Phi + c^2 * div(u) = -Q
//
// gives, from the first two (the same balance Stage 4 already solves),
//
//     u = -f * Phi_y / (f^2 + r^2)          v = -r * Phi_y / (f^2 + r^2)
//
// and substituting into the third leaves one linear second-order ODE in
// latitude for Phi, which is solved exactly by a tridiagonal sweep. No
// iteration, no timestep, no tuning.
//
// **This is not a latitude lookup table.** Nothing is tabulated: Phi is
// solved from the world's own temperature field, so a different tilt, a
// different rotation rate or different geography produces a different
// profile. The test suite checks exactly that.
//
// ---------------------------------------------------------------------------
// WHY THE TRADE WINDS COME OUT, WITH NO TRADE-WIND TERM
//
// Heating at the equator drives ascent, low-level convergence and a pressure
// LOW there, with highs on either side. Poleward of the equator Phi therefore
// rises with latitude, so dPhi/dy > 0; with f > 0 in the north,
// u = -f*Phi_y/(f^2+r^2) is negative -- an easterly. The trades are what the
// mass field implies, not something written down.

export const HADLEY_PARAMETERS = {
  equivalentDepthMetres: {
    default: 250,
    kind: "physical",
    search: true,
    min: 30,
    max: 800,
    note:
      "Equivalent depth H of the shallow-water layer; c = sqrt(g*H) is the gravity-wave " +
      "speed that sets how far the mass response spreads from the heating. H = 250 m gives " +
      "c = 50 m/s, the standard first baroclinic mode of the troposphere. Bounded to a range " +
      "quoted in the literature, NOT to whatever fits a teacher.",
  },
  heatingResponseStrength: {
    default: 0,
    kind: "empirical",
    search: true,
    min: 0,
    max: 4,
    note:
      "Amplitude of the diabatic heating inferred from the temperature field. " +
      "DEFAULTS TO 0: the term is off, so Stage 4 is returned bit-identical. It is off " +
      "because at the amplitude the tropics need it wrecks the mid-latitudes -- see " +
      "docs/climate-v1-hadley-surface-pressure.md.",
  },
};

export function resolveHadleyParams(overrides = {}) {
  const values = {};
  const unknown = [];
  for (const [name, spec] of Object.entries(HADLEY_PARAMETERS)) values[name] = spec.default;
  for (const [name, value] of Object.entries(overrides)) {
    if (name.startsWith("_")) continue;
    if (!(name in HADLEY_PARAMETERS)) { unknown.push(name); continue; }
    if (!Number.isFinite(value)) throw new Error(`Hadley parameter ${name} must be finite`);
    values[name] = value;
  }
  return { values, unknown };
}

const REFERENCE_DAMPING_PER_SECOND = 1 / 86400; // one day, so heatingResponseStrength is dimensionless

/**
 * Solve the axisymmetric surface mass response to zonal-mean heating.
 *
 * Returns per-latitude-row arrays: the surface geopotential anomaly that
 * Stage 4's momentum solver is missing, plus the zonal and meridional wind
 * that same balance implies from it (for diagnostics).
 */
export function buildHadleyCirculation({ temperatureField, body, atmosphere, params: overrides = {}, dragTimescaleDays }) {
  if (!temperatureField) throw new Error("buildHadleyCirculation requires a temperature field");
  if (!body || !Number.isFinite(body.radiusMetres) || !Number.isFinite(body.dayLengthHours) || !Number.isFinite(body.rotationDirection)) {
    throw new Error("buildHadleyCirculation requires body { radiusMetres, dayLengthHours, rotationDirection }");
  }
  if (!atmosphere || !Number.isFinite(atmosphere.specificGasConstantJPerKgK) || !Number.isFinite(atmosphere.gravityMs2)) {
    throw new Error("buildHadleyCirculation requires atmosphere { specificGasConstantJPerKgK, gravityMs2 }");
  }
  if (!Number.isFinite(dragTimescaleDays) || dragTimescaleDays <= 0) {
    throw new Error("buildHadleyCirculation requires a positive dragTimescaleDays");
  }
  const { values: params, unknown } = resolveHadleyParams(overrides);

  const { width, height, annualMeanTemperatureC } = temperatureField;
  const a = body.radiusMetres;
  const omega = ((2 * Math.PI) / (body.dayLengthHours * 3600)) * Math.sign(body.rotationDirection || 1);
  const r = 1 / (dragTimescaleDays * 86400);
  const c2 = atmosphere.gravityMs2 * params.equivalentDepthMetres;

  // --- Q: the ZONAL MEAN of the temperature field, and nothing else ---------
  // Any longitudinal structure is deliberately averaged out here. Feeding a
  // longitudinal anomaly into this solver is what would produce a Walker
  // response, which is a later stage; keeping Q strictly zonal is what makes
  // the resulting pressure field zonally symmetric by construction.
  const latRad = new Float64Array(height);
  const zonalMeanT = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    latRad[y] = ((90 - ((y + 0.5) * 180) / height) * Math.PI) / 180;
    let s = 0;
    for (let x = 0; x < width; x++) s += annualMeanTemperatureC[y * width + x];
    zonalMeanT[y] = s / width;
  }
  let wSum = 0, tSum = 0;
  for (let y = 0; y < height; y++) { const w = Math.cos(latRad[y]); wSum += w; tSum += w * zonalMeanT[y]; }
  const globalMeanT = tSum / wSum;

  // Q in m^2/s^3: a temperature anomaly turned into a geopotential anomaly by
  // R_d, then given a rate by a reference damping, so the strength knob is
  // dimensionless and 1.0 means "the obvious scale".
  // LOCALISED HEATING, SPREAD COOLING -- the standard forcing shape for this
  // class of model, and a correction to a first attempt that used the plain
  // temperature anomaly. Diabatic heating in the real tropics is latent heat
  // released in convection: concentrated where the surface is warmest. Radiative
  // cooling is close to uniform. Using the raw anomaly instead makes cooling
  // proportional to how cold a latitude is, which forces a single pole-to-
  // equator overturning with no subtropical ridge -- measured: easterlies at
  // every latitude, which destroys the mid-latitude westerlies.
  //
  // Where the heating sits is decided by the planet's own temperature field,
  // not by a latitude: on a world with no tilt, or a different land layout,
  // the warm region moves and the cell moves with it.
  const positive = new Float64Array(height);
  let heatW = 0, heatS = 0;
  for (let y = 0; y < height; y++) {
    positive[y] = Math.max(0, zonalMeanT[y] - globalMeanT);
    const w = Math.cos(latRad[y]);
    heatW += w; heatS += w * positive[y];
  }
  const uniformCooling = heatS / heatW;
  const Q = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    Q[y] = params.heatingResponseStrength * atmosphere.specificGasConstantJPerKgK *
      (positive[y] - uniformCooling) * REFERENCE_DAMPING_PER_SECOND;
  }

  // --- the ODE -------------------------------------------------------------
  //   r*Phi - c^2 * (1/(a cos p)) d/dp [ cos p * r/(f^2+r^2) * (1/a) dPhi/dp ] = -Q
  // Discretised on the row centres and solved by the Thomas algorithm. The
  // coefficient is evaluated on the half-levels between rows, which keeps the
  // operator self-adjoint and the matrix diagonally dominant.
  const dPhi = Math.PI / height; // radian spacing between row centres
  const lower = new Float64Array(height), diag = new Float64Array(height), upper = new Float64Array(height), rhs = new Float64Array(height);
  const kAtHalf = (yHalf) => {
    const lat = ((90 - ((yHalf + 0.5) * 180) / height) * Math.PI) / 180;
    const f = 2 * omega * Math.sin(lat);
    return (Math.cos(lat) * r) / (f * f + r * r);
  };
  for (let y = 0; y < height; y++) {
    const cosP = Math.cos(latRad[y]);
    const scale = c2 / (a * a * cosP * dPhi * dPhi);
    const kN = y > 0 ? kAtHalf(y - 0.5) : 0;          // no flux through the pole
    const kS = y < height - 1 ? kAtHalf(y + 0.5) : 0;
    lower[y] = -scale * kN;
    upper[y] = -scale * kS;
    diag[y] = r + scale * (kN + kS);
    rhs[y] = -Q[y];
  }
  const cPrime = new Float64Array(height), dPrime = new Float64Array(height);
  cPrime[0] = upper[0] / diag[0];
  dPrime[0] = rhs[0] / diag[0];
  for (let y = 1; y < height; y++) {
    const denom = diag[y] - lower[y] * cPrime[y - 1];
    cPrime[y] = upper[y] / denom;
    dPrime[y] = (rhs[y] - lower[y] * dPrime[y - 1]) / denom;
  }
  const surfaceGeopotentialM2S2 = new Float64Array(height);
  surfaceGeopotentialM2S2[height - 1] = dPrime[height - 1];
  for (let y = height - 2; y >= 0; y--) {
    surfaceGeopotentialM2S2[y] = dPrime[y] - cPrime[y] * surfaceGeopotentialM2S2[y + 1];
  }
  // Remove the global mean: only the gradient does anything, and a floating
  // offset would make the field look different for no physical reason.
  let sw = 0, sp = 0;
  for (let y = 0; y < height; y++) { const w = Math.cos(latRad[y]); sw += w; sp += w * surfaceGeopotentialM2S2[y]; }
  const mean = sp / sw;
  for (let y = 0; y < height; y++) surfaceGeopotentialM2S2[y] -= mean;

  // --- the wind that mass field implies (diagnostic) -----------------------
  const uMs = new Float64Array(height), vMs = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const north = y > 0 ? surfaceGeopotentialM2S2[y - 1] : surfaceGeopotentialM2S2[y];
    const south = y < height - 1 ? surfaceGeopotentialM2S2[y + 1] : surfaceGeopotentialM2S2[y];
    const rows = (y > 0 ? 1 : 0) + (y < height - 1 ? 1 : 0);
    const phiY = (north - south) / (rows * dPhi * a); // north is +y
    const f = 2 * omega * Math.sin(latRad[y]);
    const denom = f * f + r * r;
    uMs[y] = (-f * phiY) / denom;
    vMs[y] = (-r * phiY) / denom;
  }

  return {
    height,
    surfaceGeopotentialM2S2,
    uMs, vMs,
    zonalMeanTemperatureC: zonalMeanT,
    heatingM2S3: Q,
    meta: {
      stage: "5C-wind",
      form: "axisymmetric damped shallow water (zonal-mean heating only)",
      gravityWaveSpeedMs: Math.sqrt(c2),
      dragTimescaleDays, params, unknownParameters: unknown,
      note: "Q is the zonal mean only: no longitudinal heating, so no Walker response.",
    },
  };
}
