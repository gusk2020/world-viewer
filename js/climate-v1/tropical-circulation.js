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
  // NO uniform cooling term. An earlier version subtracted the area mean of
  // the heating so that Q summed to zero globally. That term was applied at
  // EVERY latitude, so it forced the mid-latitudes directly rather than
  // leaving them to be reached by adjustment -- measured as the mid-latitude
  // collapse in docs/climate-v1-wind-negative-results.md. It is also
  // unnecessary: the `r*Phi` term in the Helmholtz operator below is already
  // a damping that balances the forcing, so no separate sink is needed for
  // the problem to be well posed.
  const positive = new Float64Array(height);
  for (let y = 0; y < height; y++) positive[y] = Math.max(0, zonalMeanT[y] - globalMeanT);
  const Q = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    Q[y] = params.heatingResponseStrength * atmosphere.specificGasConstantJPerKgK *
      positive[y] * REFERENCE_DAMPING_PER_SECOND;
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

// ---------------------------------------------------------------------------
// THE 2-D RESPONSE
//
// The axisymmetric solve above fails for a reason it measured itself: with
// d/dx = 0 there is no equatorial wave trapping, so the mass adjustment
// reaches every latitude and the amplitude the tropics need wrecks the
// mid-latitudes. Trapping is a property of the response to ZONALLY STRUCTURED
// heating -- which is what this adds.
//
// Same three equations, now solved on the full grid:
//
//     r*u - f*v = -dPhi/dx      f*u + r*v = -dPhi/dy
//     r*Phi + c^2 * div(u) = -Q
//
// The first two are Stage 4's own balance, reused exactly. Substituting them
// into the third leaves one elliptic problem for Phi, solved by under-relaxed
// alternating-direction sweeps: at each pass Phi is pushed toward
// (-Q - c^2*div(u(Phi)))/r. Deterministic, no timestep.
//
// Q is split so the two halves can be switched independently and measured
// apart -- the whole point of this stage:
//
//     Q_zonal        the zonal mean, localised heating with spread cooling
//     Q_longitudinal the departure of each cell from its OWN latitude's mean
//
// Q_longitudinal is by construction zero in the zonal mean at every latitude,
// so it adds no zonally symmetric forcing at all: it can only redistribute.

export const GILL_PARAMETERS = {
  equivalentDepthMetres: HADLEY_PARAMETERS.equivalentDepthMetres,
  zonalHeatingStrength: {
    default: 0, kind: "empirical", search: true, min: 0, max: 4,
    note: "Amplitude of the zonal-mean (Hadley) part of Q. 0 disables it.",
  },
  longitudinalHeatingStrength: {
    default: 0, kind: "empirical", search: true, min: 0, max: 4,
    note: "Amplitude of the longitudinal (Walker) part of Q -- each cell's departure from " +
      "its own latitude's mean. Zero in the zonal mean by construction, so it redistributes " +
      "rather than forcing a symmetric cell. 0 disables it.",
  },
};

// NOTE ON `r`. One value, `dragTimescaleDays`, is used BOTH as the momentum
// drag in the balance and as the damping coefficient in the Helmholtz
// operator. That is the standard linear formulation, but they are physically
// different rates and nothing here has established that they should be equal.
// Deliberately NOT separated into two parameters this round.
export function buildGillCirculation({
  temperatureField, body, atmosphere, dragTimescaleDays,
  params: overrides = {}, maxSweeps = 3000, relaxation = 0.2, convergence = 1e-4,
}) {
  const p = {};
  const unknown = [];
  for (const [k, spec] of Object.entries(GILL_PARAMETERS)) p[k] = spec.default;
  for (const [k, v] of Object.entries(overrides)) {
    if (k.startsWith("_")) continue;
    if (!(k in GILL_PARAMETERS)) { unknown.push(k); continue; }
    if (!Number.isFinite(v)) throw new Error(`Gill parameter ${k} must be finite`);
    p[k] = v;
  }
  const { width, height, annualMeanTemperatureC: T } = temperatureField;
  const a = body.radiusMetres;
  const omega = ((2 * Math.PI) / (body.dayLengthHours * 3600)) * Math.sign(body.rotationDirection || 1);
  const r = 1 / (dragTimescaleDays * 86400);
  const c2 = atmosphere.gravityMs2 * p.equivalentDepthMetres;
  const Rd = atmosphere.specificGasConstantJPerKgK;
  const n = width * height;

  const latRad = new Float64Array(height), cosLat = new Float64Array(height), f = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    latRad[y] = ((90 - ((y + 0.5) * 180) / height) * Math.PI) / 180;
    cosLat[y] = Math.max(Math.cos((89.5 * Math.PI) / 180), Math.cos(latRad[y]));
    f[y] = 2 * omega * Math.sin(latRad[y]);
  }
  // --- Q, split into its two parts ------------------------------------------
  const zonalMean = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0; for (let x = 0; x < width; x++) s += T[y * width + x];
    zonalMean[y] = s / width;
  }
  let gw = 0, gs = 0;
  for (let y = 0; y < height; y++) { gw += cosLat[y]; gs += cosLat[y] * zonalMean[y]; }
  const globalMean = gs / gw;
  // NO uniform cooling term -- see the note in buildHadleyCirculation.
  const positive = new Float64Array(height);
  for (let y = 0; y < height; y++) positive[y] = Math.max(0, zonalMean[y] - globalMean);
  const Q = new Float64Array(n);
  const scale = Rd * REFERENCE_DAMPING_PER_SECOND;
  for (let y = 0; y < height; y++) {
    const qz = p.zonalHeatingStrength * positive[y];
    for (let x = 0; x < width; x++) {
      const ql = p.longitudinalHeatingStrength * (T[y * width + x] - zonalMean[y]);
      Q[y * width + x] = scale * (qz + ql);
    }
  }

  // --- solve ----------------------------------------------------------------
  // Substituting the balance into the mass equation, the cross derivatives
  // cancel and what is left is a Helmholtz problem:
  //
  //     r*Phi - c^2 * div( (r/(f^2+r^2)) grad Phi ) = -Q
  //
  // which is diffusion-like and diagonally dominant, so Gauss-Seidel
  // converges. A first attempt iterated Phi toward (-Q - c^2*div(u))/r with
  // the Laplacian on the EXPLICIT side; that is anti-diffusive and every case
  // returned NaN. The operator has to be inverted, not evaluated.
  const Phi = new Float64Array(n), u = new Float64Array(n), v = new Float64Array(n);
  const dPhiRad = Math.PI / height, dLam = (2 * Math.PI) / width;
  const idx = (y, x) => y * width + (x < 0 ? x + width : x >= width ? x - width : x);
  const kOf = (y) => r / (f[y] * f[y] + r * r);
  const kHalf = (yA, yB) => 0.5 * (kOf(yA) + kOf(yB));
  let sweeps = 0, residual = Infinity;
  for (; sweeps < maxSweeps; sweeps++) {
    residual = 0;
    const forward = sweeps % 2 === 0;
    for (let yi = 0; yi < height; yi++) {
      const y = forward ? yi : height - 1 - yi;
      const dxM = a * cosLat[y] * dLam, dyM = a * dPhiRad;
      const kx = c2 * kOf(y) / (dxM * dxM);
      const kN = y > 0 ? (c2 * kHalf(y, y - 1) * Math.cos(latRad[y] - dPhiRad / 2)) / (dyM * dyM * cosLat[y]) : 0;
      const kS = y < height - 1 ? (c2 * kHalf(y, y + 1) * Math.cos(latRad[y] + dPhiRad / 2)) / (dyM * dyM * cosLat[y]) : 0;
      for (let xi = 0; xi < width; xi++) {
        const x = forward ? xi : width - 1 - xi;
        const i = y * width + x;
        const num = -Q[i] + kx * (Phi[idx(y, x + 1)] + Phi[idx(y, x - 1)]) +
          (y > 0 ? kN * Phi[idx(y - 1, x)] : 0) + (y < height - 1 ? kS * Phi[idx(y + 1, x)] : 0);
        const den = r + 2 * kx + kN + kS;
        const next = num / den;
        residual = Math.max(residual, Math.abs(next - Phi[i]));
        Phi[i] = next;
      }
    }
    if (residual < convergence) { sweeps++; break; }
  }
  // the balance wind this mass field implies (diagnostic)
  for (let y = 0; y < height; y++) {
    const dxM = a * cosLat[y] * dLam, dyM = a * dPhiRad;
    const denom = f[y] * f[y] + r * r;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const px = (Phi[idx(y, x + 1)] - Phi[idx(y, x - 1)]) / (2 * dxM);
      const north = y > 0 ? Phi[idx(y - 1, x)] : Phi[i], south = y < height - 1 ? Phi[idx(y + 1, x)] : Phi[i];
      const rows = (y > 0 ? 1 : 0) + (y < height - 1 ? 1 : 0);
      const py = (north - south) / (rows * dyM);
      u[i] = -(r * px + f[y] * py) / denom;
      v[i] = (f[y] * px - r * py) / denom;
    }
  }
  // only the gradient matters; drop the floating offset
  let sw = 0, sp = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { sw += cosLat[y]; sp += cosLat[y] * Phi[y * width + x]; }
  const mean = sp / sw;
  for (let i = 0; i < n; i++) Phi[i] -= mean;

  return { width, height, surfaceGeopotentialM2S2: Phi, uMs: u, vMs: v,
    meta: { stage: "5C-wind 2D", sweeps, residual, converged: residual < convergence,
      gravityWaveSpeedMs: Math.sqrt(c2), params: p, unknownParameters: unknown } };
}
