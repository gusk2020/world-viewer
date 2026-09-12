// Climate v1's wind model -- stage 4 of the redesigned pipeline
// (terrain -> land/sea -> temperature -> wind -> ...; see
// docs/climate-v1-wind-model-stage4.md for the candidate comparison, the
// physics, and the measured verdict).
//
// This is a *new* model, built beside Climate v0.8's `windField` rather
// than replacing it. Climate v0.8's version is a closed-form
// Hadley/Ferrel/polar-cell idealisation that depends on latitude alone and
// carries no real units; Stage 3 measured it against NCEP/NCAR Reanalysis 1
// and found a speed correlation of 0.154, i.e. almost no skill at
// predicting where the wind is strong.
//
// What this model does instead, in one line: **turn the temperature field
// into a geopotential field, and let the pressure-gradient force, the
// Coriolis force and a linear drag decide the wind.**
//
// ---------------------------------------------------------------------------
// THE PHYSICS, AND WHAT IS BEING APPROXIMATED
//
// 1. Geopotential from temperature, via the hypsometric relation.
//
//    The thickness of an atmospheric layer between two pressure surfaces
//    depends on the mean temperature of the air in it:
//
//        Phi(p_level) - Phi(p_surface) = R_d * T_layer * ln(p_surface / p_level)
//
//    where Phi = g*z is geopotential [m^2/s^2] and R_d is the specific gas
//    constant of the atmosphere [J/(kg K)]. A warm column is a thick
//    column, so at a *fixed pressure level above the surface* a warm column
//    puts that level physically higher -- a geopotential high. This is the
//    opposite of the familiar surface "thermal low", and it is the correct
//    sign for a level like 850 hPa.
//
//    **Note that gravity does not appear.** Working in geopotential
//    (m^2/s^2) rather than geopotential height (m) cancels g exactly, which
//    is why this model needs no gravity value and none was added to the
//    world config.
//
//    **The assumption this rests on, stated plainly**: the surface
//    geopotential anomaly is taken as zero, i.e. surface pressure is
//    assumed horizontally uniform. That is false on the real Earth -- the
//    subtropical highs and the equatorial trough are exactly the surface
//    mass redistribution this assumption throws away, and they are produced
//    by the Hadley circulation, which a temperature field alone cannot
//    derive. So this model should be expected to represent the
//    thermally-driven part of the flow (the equator-to-pole gradient that
//    drives the mid-latitude westerlies) and *not* the overturning-driven
//    part (the trade winds' subtropical ridge). Measured consequences are
//    in the Stage 4 document; they are not hidden here.
//
// 2. Wind from geopotential, via a linear steady momentum balance.
//
//        r*u - f*v = -dPhi/dx
//        f*u + r*v = -dPhi/dy
//
//    i.e. pressure-gradient force, balanced by Coriolis and a linear
//    (Rayleigh) drag. Solved exactly:
//
//        u = -(r*Phi_x + f*Phi_y) / (r^2 + f^2)
//        v =  (f*Phi_x - r*Phi_y) / (r^2 + f^2)
//
//    with f = 2*Omega*sin(latitude) and Omega signed by the body's own
//    rotation direction. Two properties matter:
//      - As r -> 0 this reduces to exact geostrophic balance
//        (u = -Phi_y/f), so mid-latitudes behave correctly.
//      - At the equator f = 0 and the denominator is r^2, not zero, so the
//        flow becomes finite down-gradient motion instead of a singularity.
//        No special-casing of the equator anywhere in this file.
//    Nothing distinguishes the hemispheres by hand: f changes sign on its
//    own, and a temperature field that is colder toward both poles produces
//    westerlies in both, for the right reason.
//
// 3. Smoothing, as physics rather than as a blur.
//
//    Climate v1's temperature field is piecewise constant in longitude:
//    after reducing to sea level it takes exactly two values at each
//    latitude, one for land and one for sea (measured, see the Stage 4
//    document). Its raw gradient is therefore a set of spikes at
//    coastlines. The real atmosphere does not respond to a coastline as a
//    step -- it homogenises surface thermal contrasts over roughly a
//    Rossby radius. `thermalSmoothingKm` is that length, in kilometres on
//    the ground, applied with the sphere's own metric (a zonal degree is
//    shorter near the poles, and the kernel widens there accordingly).
//
// ---------------------------------------------------------------------------
// SEASONS, AND LATER STAGES
//
// The core takes *a* temperature field, not "the annual mean" -- feeding it
// a warm-season or cold-season temperature field returns that season's
// wind, which is how a later stage can produce DJF/JJA winds without
// touching this file. Outputs are real m/s, so a later moisture stage can
// multiply wind by humidity to get transport without any unit conversion
// step. Neither is done here.

const HOURS_TO_SECONDS = 3600;
const DAYS_TO_SECONDS = 86400;

/**
 * The model's free parameters. Three, deliberately -- see
 * docs/climate-v1-wind-model-stage4.md for why none of these is allowed to
 * multiply into a fourth.
 */
export const WIND_PARAMETERS = {
  thermalResponseStrength: {
    value: 1, kind: "empirical", min: 0.1, max: 8,
    note:
      "How strongly a temperature anomaly becomes a geopotential anomaly, " +
      "as a multiple of the plain surface-to-level hypsometric thickness. " +
      "1.0 is the textbook single-layer value. It is above 1 in practice " +
      "because a surface temperature anomaly does not stop at the level " +
      "being modelled -- it extends through the troposphere, so the real " +
      "geopotential response is deeper than one layer's thickness -- and " +
      "because the surface pressure anomaly this model sets to zero " +
      "partly opposes it. Degenerate with the gas constant and the " +
      "pressure ratio for a single body: only their product is " +
      "identifiable from one planet's data.",
  },
  dragTimescaleDays: {
    value: 2, kind: "empirical", min: 0.25, max: 20,
    note:
      "The Rayleigh drag timescale, 1/r. Sets how far the flow turns away " +
      "from geostrophic toward down-gradient: negligible where |f| >> r " +
      "(mid-latitudes), total at the equator where f = 0. Also the only " +
      "thing keeping the equatorial wind finite, which is why it may not " +
      "be zero.",
  },
  thermalSmoothingKm: {
    value: 1000, kind: "empirical", min: 100, max: 4000,
    note:
      "The length over which the atmosphere is taken to homogenise surface " +
      "thermal contrasts before they become a pressure gradient -- a " +
      "Rossby-radius-like scale, in kilometres on the ground, not a pixel " +
      "count. Without it the land/sea steps in the temperature field " +
      "become one-cell spikes in the geopotential gradient.",
  },
};

export function resolveWindParams(overrides = {}) {
  const values = {};
  for (const [name, spec] of Object.entries(WIND_PARAMETERS)) values[name] = spec.value;
  for (const [name, value] of Object.entries(overrides)) {
    if (!(name in WIND_PARAMETERS)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    values[name] = value;
  }
  return values;
}

function latitudeDegOfRow(y, height) {
  return (0.5 - (y + 0.5) / height) * 180;
}

/**
 * A Gaussian smoothing with a real length scale on a sphere. Separable:
 * along longitude first (where a cell's ground width shrinks as cos(lat),
 * so the kernel spans more cells near the poles), then along latitude
 * (where every cell is the same height).
 *
 * Where the required zonal kernel would span more than half the globe the
 * row is replaced by its own zonal mean, which is that kernel's exact
 * limit and avoids a pointlessly large convolution near the poles.
 */
export function smoothOnSphere(field, width, height, radiusMetres, scaleKm) {
  const scaleM = scaleKm * 1000;
  if (!(scaleM > 0)) return Float64Array.from(field);
  const out = new Float64Array(width * height);
  const tmp = new Float64Array(width * height);

  const dLambda = (2 * Math.PI) / width;
  const dPhi = Math.PI / height;

  // -- zonal pass -----------------------------------------------------------
  for (let y = 0; y < height; y++) {
    const latRad = (latitudeDegOfRow(y, height) * Math.PI) / 180;
    const cosLat = Math.max(Math.cos(latRad), 1e-6);
    const cellWidthM = radiusMetres * cosLat * dLambda;
    const sigmaCells = scaleM / cellWidthM;
    const row = y * width;
    const radius = Math.ceil(3 * sigmaCells);
    if (radius >= width / 2) {
      // Kernel wider than the circle: its limit is the zonal mean.
      let sum = 0;
      for (let x = 0; x < width; x++) sum += field[row + x];
      const mean = sum / width;
      for (let x = 0; x < width; x++) tmp[row + x] = mean;
      continue;
    }
    const kernel = new Float64Array(radius * 2 + 1);
    let norm = 0;
    for (let k = -radius; k <= radius; k++) {
      const w = Math.exp(-(k * k) / (2 * sigmaCells * sigmaCells));
      kernel[k + radius] = w;
      norm += w;
    }
    for (let k = 0; k < kernel.length; k++) kernel[k] /= norm;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = ((x + k) % width + width) % width;
        acc += kernel[k + radius] * field[row + xx];
      }
      tmp[row + x] = acc;
    }
  }

  // -- meridional pass ------------------------------------------------------
  const cellHeightM = radiusMetres * dPhi;
  const sigmaRows = scaleM / cellHeightM;
  const radiusY = Math.min(height - 1, Math.ceil(3 * sigmaRows));
  const kernelY = new Float64Array(radiusY * 2 + 1);
  let normY = 0;
  for (let k = -radiusY; k <= radiusY; k++) {
    const w = Math.exp(-(k * k) / (2 * sigmaRows * sigmaRows));
    kernelY[k + radiusY] = w;
    normY += w;
  }
  for (let k = 0; k < kernelY.length; k++) kernelY[k] /= normY;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radiusY; k <= radiusY; k++) {
        // Replicate at the poles: there is no row beyond them to borrow.
        const yy = Math.min(height - 1, Math.max(0, y + k));
        acc += kernelY[k + radiusY] * tmp[yy * width + x];
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

/**
 * The model itself, in its most general form: a temperature field in, a
 * wind field out. Knows nothing about Earth, about terrain, or about which
 * season it is being handed.
 *
 * `temperatureC`: Float64Array(width*height), already reduced to a common
 *   reference level (see buildClimateV1Wind below for why that matters).
 * `body`: { radiusMetres, dayLengthHours, rotationDirection } -- read from
 *   the world definition, never hardcoded.
 * `atmosphere`: { specificGasConstantJPerKgK, surfacePressureHPa,
 *   levelPressureHPa } -- the gas and the two pressure surfaces the
 *   hypsometric relation is taken between. Required, not defaulted: a
 *   silent Earth default here is exactly the kind of hidden constant this
 *   redesign exists to avoid.
 */
export function buildWindFromTemperature({
  temperatureC, width, height, body, atmosphere, params,
}) {
  const { radiusMetres, dayLengthHours, rotationDirection } = body || {};
  if (!Number.isFinite(radiusMetres) || !Number.isFinite(dayLengthHours) || !Number.isFinite(rotationDirection)) {
    throw new Error("buildWindFromTemperature requires body { radiusMetres, dayLengthHours, rotationDirection }");
  }
  const { specificGasConstantJPerKgK: gasR, surfacePressureHPa: pSurface, levelPressureHPa: pLevel } = atmosphere || {};
  if (!Number.isFinite(gasR) || !Number.isFinite(pSurface) || !Number.isFinite(pLevel) || !(pSurface > pLevel)) {
    throw new Error(
      "buildWindFromTemperature requires atmosphere { specificGasConstantJPerKgK, surfacePressureHPa, levelPressureHPa } with surface > level"
    );
  }
  const p = resolveWindParams(params);

  // -- 1. smooth the temperature field over a real length ---------------------
  const smoothedTemperatureC = smoothOnSphere(temperatureC, width, height, radiusMetres, p.thermalSmoothingKm);

  // -- 2. geopotential anomaly, hypsometric ----------------------------------
  // Only the *anomaly* drives a gradient, so the global area-weighted mean
  // is removed; adding any constant to Phi changes no wind.
  let weightSum = 0;
  let weightedT = 0;
  for (let y = 0; y < height; y++) {
    const w = Math.cos((latitudeDegOfRow(y, height) * Math.PI) / 180);
    for (let x = 0; x < width; x++) { weightSum += w; weightedT += w * smoothedTemperatureC[y * width + x]; }
  }
  const meanT = weightedT / weightSum;
  const hypsometricCoefficient = gasR * Math.log(pSurface / pLevel) * p.thermalResponseStrength;
  const geopotentialAnomalyM2S2 = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    geopotentialAnomalyM2S2[i] = hypsometricCoefficient * (smoothedTemperatureC[i] - meanT);
  }

  // -- 3. gradients on the sphere -------------------------------------------
  const dLambda = (2 * Math.PI) / width;
  const dPhi = Math.PI / height;
  const dyM = radiusMetres * dPhi;
  // The zonal metric 1/cos(lat) diverges at the pole. Floored at the value
  // for half a cell away from it, which is the finest zonal separation this
  // grid can actually represent -- beyond that the columns have converged
  // and a zonal derivative has no meaning.
  const minCos = Math.cos(((90 - (0.5 * 180) / height) * Math.PI) / 180);

  const uWindMs = new Float64Array(width * height);
  const vWindMs = new Float64Array(width * height);
  const windSpeedMs = new Float64Array(width * height);

  const omega = (rotationDirection >= 0 ? 1 : -1) * (2 * Math.PI) / (Math.abs(dayLengthHours) * HOURS_TO_SECONDS);
  const r = 1 / (p.dragTimescaleDays * DAYS_TO_SECONDS);

  for (let y = 0; y < height; y++) {
    const latDeg = latitudeDegOfRow(y, height);
    const latRad = (latDeg * Math.PI) / 180;
    const cosLat = Math.max(Math.cos(latRad), minCos);
    const dxM = radiusMetres * cosLat * dLambda;
    const f = 2 * omega * Math.sin(latRad);
    const denom = r * r + f * f;
    const rowNorth = Math.max(0, y - 1) * width;
    const rowSouth = Math.min(height - 1, y + 1) * width;
    // One-sided at the poles, centred everywhere else.
    const dyScale = 1 / ((Math.min(height - 1, y + 1) - Math.max(0, y - 1)) * dyM);
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const xEast = (x + 1) % width;
      const xWest = (x - 1 + width) % width;
      const phiX = (geopotentialAnomalyM2S2[row + xEast] - geopotentialAnomalyM2S2[row + xWest]) / (2 * dxM);
      // y here is the northward coordinate, so the north neighbour is the
      // *lower* row index -- getting this backwards would mirror every wind.
      const phiY = (geopotentialAnomalyM2S2[rowNorth + x] - geopotentialAnomalyM2S2[rowSouth + x]) * dyScale;
      const u = -(r * phiX + f * phiY) / denom;
      const v = (f * phiX - r * phiY) / denom;
      uWindMs[row + x] = u;
      vWindMs[row + x] = v;
      windSpeedMs[row + x] = Math.hypot(u, v);
    }
  }

  return {
    width, height,
    uWindMs, vWindMs, windSpeedMs,
    // Kept as named, inspectable fields rather than internal temporaries --
    // the units are in the names because this is a geopotential anomaly in
    // m^2/s^2, NOT a pressure in Pa and not a height in m.
    geopotentialAnomalyM2S2,
    smoothedTemperatureC,
    meta: {
      params: p,
      hypsometricCoefficient,
      coriolisParameterAtPole: 2 * omega,
      dragRatePerSecond: r,
      globalMeanTemperatureC: meanT,
      units: { u: "m/s eastward", v: "m/s northward", speed: "m/s", geopotentialAnomaly: "m^2/s^2" },
    },
  };
}

/**
 * The Climate v1 wrapper: takes the terrain and temperature fields Stage
 * 0-2 already build, and produces the wind field at a coarser grid.
 *
 * Two choices here are physics, not tuning, and both are stated in the
 * Stage 4 document:
 *
 * - **Temperature is reduced to sea level before it becomes geopotential.**
 *   A mountain's surface is cold because it is high, not because the air
 *   column above it is cold; feeding raw surface temperature in would put
 *   a deep spurious geopotential low over every plateau. Reducing by the
 *   same lapse rate the temperature field itself used is the standard
 *   sea-level reduction, and it is exact here (it returns the latitude's
 *   own sea-level temperature over land).
 * - **The wind is computed on a coarse grid.** Large-scale balanced flow
 *   has no business being computed at 20 km resolution, the teacher is
 *   2.5 degrees, and block-averaging the fine field to get there gives
 *   coastal cells a real land/sea mixture rather than a hard edge.
 */
export function buildClimateV1Wind({
  terrainField, temperatureField, temperatureArray = null,
  lapseRateCPerKm, body, atmosphere, params,
  width = 256, height = 128, reduceToSeaLevel = true,
}) {
  if (!terrainField || !temperatureField) throw new Error("buildClimateV1Wind requires terrainField and temperatureField");
  if (!Number.isFinite(lapseRateCPerKm)) throw new Error("buildClimateV1Wind requires lapseRateCPerKm");
  const fineW = terrainField.width;
  const fineH = terrainField.height;
  if (fineW % width !== 0 || fineH % height !== 0) {
    throw new Error(`coarse grid ${width}x${height} must divide the fine grid ${fineW}x${fineH}`);
  }
  const source = temperatureArray || temperatureField.annualMeanTemperatureC;

  const blockX = fineW / width;
  const blockY = fineH / height;
  const coarse = new Float64Array(width * height);
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      let sum = 0;
      for (let by = 0; by < blockY; by++) {
        const fy = cy * blockY + by;
        for (let bx = 0; bx < blockX; bx++) {
          const fi = fy * fineW + (cx * blockX + bx);
          const t = source[fi];
          sum += reduceToSeaLevel
            ? t + lapseRateCPerKm * Math.max(0, terrainField.relativeElevationMetres[fi]) / 1000
            : t;
        }
      }
      coarse[cy * width + cx] = sum / (blockX * blockY);
    }
  }

  const field = buildWindFromTemperature({ temperatureC: coarse, width, height, body, atmosphere, params });
  field.reducedTemperatureC = coarse;
  field.meta.reduceToSeaLevel = reduceToSeaLevel;
  return field;
}
