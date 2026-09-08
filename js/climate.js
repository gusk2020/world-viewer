// A deliberately small climate model, used to paint a planet's surface in a
// way that *looks* plausible rather than one that is scientifically defensible.
// The user's own framing: "科学的に厳密な気候シミュレーションを目的として
// いません ... 見た人が自然だと感じる リアルっぽい惑星表面を作る".
//
// So real physics and frank fudge factors sit side by side here, and every
// parameter says which it is. `kind: "physical"` means the number means
// something outside this app and has a defensible real value (a lapse rate,
// the freezing point of seawater). `kind: "empirical"` means it exists only
// because it makes the picture look right, and the automatic search is free
// to move it anywhere in its range. Keeping the distinction visible is what
// stops the second kind from quietly being mistaken for the first.
//
// Stage 1 uses only: global mean temperature, latitude, altitude, axial tilt,
// land-or-sea, and distance from the sea. Wind, rotation and orographic
// rain shadow are Stage 2 and are deliberately absent.

// ---------------------------------------------------------------------------
// Parameters
//
// The schema lives here rather than in a world's config so that there is one
// place that knows what a parameter means and what range it may take. A world
// (or a saved parameter set) carries only overrides by name. That makes the
// two compatibility rules the user asked for fall out for free: a set missing
// a newer parameter gets the default, and a set still carrying a retired one
// is ignored rather than being an error.
// ---------------------------------------------------------------------------
export const CLIMATE_PARAMETERS = {
  meanTemperatureC: {
    value: 14, kind: "physical", min: -60, max: 60,
    note: "Global mean surface temperature. Earth today is about 14 C.",
  },
  lapseRateCPerKm: {
    value: 6.5, kind: "physical", min: 0, max: 12,
    note: "How fast air cools with height. Earth's average is 6.5 C/km.",
  },
  freezeTemperatureC: {
    value: 0, kind: "physical", min: -40, max: 20,
    note: "Where snow lies on land. Fresh water freezes at 0 C.",
  },
  seaIceTemperatureC: {
    value: -1.8, kind: "physical", min: -40, max: 10,
    note: "Where sea ice forms. Salt water freezes near -1.8 C.",
  },

  insolationSensitivityC: {
    value: 65, kind: "empirical", min: 0, max: 160,
    note:
      "Degrees of equator-to-pole contrast per unit of normalised annual " +
      "insolation. Fitted by least squares against Earth's real zonal-mean " +
      "temperatures, which put it near 67; it stands in for everything a " +
      "one-line model leaves out, above all the ice-albedo feedback.",
  },
  polarExtraC: {
    value: 0, kind: "empirical", min: -12, max: 12,
    note:
      "Extra cooling (negative) or warming toward the poles, on top of " +
      "insolation. Kept to a narrow range on purpose: given a wide one the " +
      "search turns it into a second contrast term fighting the first, which " +
      "fits the numbers while meaning nothing.",
  },
  oceanModeration: {
    value: 0.75, kind: "empirical", min: 0, max: 1,
    note:
      "How much of the latitude temperature swing the sea keeps. Water's heat " +
      "capacity flattens the profile, so 1 is 'sea behaves exactly like land' " +
      "and 0 is 'every sea is at the global mean'.",
  },

  coastalMoisture: {
    value: 1, kind: "empirical", min: 0, max: 1,
    note: "Moisture available right at the shore, before any inland decay.",
  },
  moistureDecayKm: {
    value: 900, kind: "empirical", min: 50, max: 6000,
    note: "How far inland moisture carries, as an e-folding distance.",
  },
  subtropicalDryLatitudeDeg: {
    value: 25, kind: "empirical", min: 0, max: 60,
    note:
      "Centre of the dry belt that makes the Sahara, Arabia and Australia dry. " +
      "Stage 2's Hadley-cell and trade-wind model should replace this with " +
      "something mechanistic; until then it is a latitude band and nothing more.",
  },
  subtropicalDryWidthDeg: {
    value: 13, kind: "empirical", min: 2, max: 40,
    note: "Half-width of that dry belt.",
  },
  subtropicalDryStrength: {
    value: 0.85, kind: "empirical", min: 0, max: 1,
    note: "How completely the dry belt removes moisture at its centre.",
  },

  vegetationWarmthC: {
    value: 3, kind: "empirical", min: -30, max: 40,
    note: "Temperature at which plant cover is half of what moisture allows.",
  },
  vegetationWarmthWidthC: {
    value: 8, kind: "empirical", min: 3, max: 30,
    note: "How gradually plant cover fades out as it gets colder.",
  },
  vegetationMoistureHalf: {
    value: 0.34, kind: "empirical", min: 0, max: 1,
    note: "Moisture at which plant cover is half of what warmth allows.",
  },
  vegetationMoistureWidth: {
    value: 0.22, kind: "empirical", min: 0.08, max: 1,
    note:
      "How gradually plant cover fades out as it gets drier. Floored well " +
      "above zero because the user asked for natural gradients and the search " +
      "will otherwise collapse this into a hard desert/forest edge.",
  },

  permanentSnowOffsetC: {
    value: -9, kind: "empirical", min: -30, max: 5,
    note:
      "How far below freezing the *annual mean* has to sit before snow lies " +
      "all year. Without it the model paints everywhere averaging under 0 C " +
      "solid white -- which put all of Siberia under permanent ice, since its " +
      "annual mean really is about -5 C. Summer melts it; an annual-mean " +
      "model cannot know that, so this stands in for the seasonal cycle.",
  },
  snowBlendC: {
    value: 4, kind: "empirical", min: 1.5, max: 20,
    note: "Width of the snow line, so it is a gradient rather than a hard edge.",
  },
  seaIceBlendC: {
    value: 2.5, kind: "empirical", min: 1, max: 20,
    note: "Width of the sea-ice edge.",
  },
  seaDepthShadingM: {
    value: 4000, kind: "empirical", min: 100, max: 12000,
    note: "Depth at which the sea reaches its darkest colour.",
  },
};

// Colours are parameters too -- the search will want to move them -- but they
// live apart because they are plainly display choices, not model terms.
export const CLIMATE_PALETTE = {
  rock: [116, 112, 106],
  sand: [206, 184, 138],
  dryGrass: [166, 165, 104],
  vegetation: [74, 116, 62],
  snow: [246, 248, 250],
  shallowSea: [64, 118, 168],
  deepSea: [18, 44, 86],
};

// Merges a world's (or a saved set's) overrides over the defaults. Unknown
// names are collected and returned rather than thrown: a parameter set saved
// before a term was retired must still load.
export function resolveClimateParams(overrides = {}) {
  const values = {};
  for (const [name, spec] of Object.entries(CLIMATE_PARAMETERS)) {
    values[name] = spec.value;
  }
  const palette = {};
  for (const [name, rgb] of Object.entries(CLIMATE_PALETTE)) {
    palette[name] = rgb.slice();
  }

  const ignored = [];
  for (const [name, value] of Object.entries(overrides)) {
    // A leading underscore marks a human note rather than a parameter, so a
    // saved set can carry its own description without tripping the check.
    if (name === "palette" || name.startsWith("_")) continue;
    if (!(name in CLIMATE_PARAMETERS)) {
      ignored.push(name);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) values[name] = value;
  }
  for (const [name, rgb] of Object.entries(overrides.palette || {})) {
    if (!(name in CLIMATE_PALETTE)) {
      ignored.push(`palette.${name}`);
      continue;
    }
    if (Array.isArray(rgb) && rgb.length === 3) palette[name] = rgb.slice();
  }
  return { values, palette, ignored };
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

// Annual-mean insolation by latitude, integrated numerically rather than
// approximated by the usual second-Legendre fit. The integral is a few
// thousand evaluations -- nothing on any device -- and it means any obliquity
// works without a second formula: Earth's 23.4, Mars's 25.2 and the Moon's
// 6.7 all come out of the same code, and so would a world tilted 80 degrees.
export function annualInsolationByLatitude(latitudesRad, tiltDegrees, steps = 180) {
  const tilt = (tiltDegrees * Math.PI) / 180;
  const out = new Float64Array(latitudesRad.length);
  for (let i = 0; i < latitudesRad.length; i++) {
    const lat = latitudesRad[i];
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    let total = 0;
    for (let s = 0; s < steps; s++) {
      // Orbital longitude around one year; eccentricity is ignored.
      const declination = Math.asin(Math.sin(tilt) * Math.sin((2 * Math.PI * s) / steps));
      const sinDec = Math.sin(declination);
      const cosDec = Math.cos(declination);
      // Hour angle of sunrise, clamped into permanent night or permanent day.
      const cosH = Math.min(1, Math.max(-1, -Math.tan(lat) * Math.tan(declination)));
      const h = Math.acos(cosH);
      total += (h * sinLat * sinDec + cosLat * cosDec * Math.sin(h)) / Math.PI;
    }
    out[i] = total / steps;
  }
  return out;
}

// Distance from every land cell to the nearest sea, in kilometres, by a
// two-pass weighted chamfer transform. Weighted because a step in longitude is
// a different distance on the ground at every latitude -- treating the grid as
// square would make polar continents look far wider than they are. Longitude
// wraps, so the passes run twice: one sweep cannot carry a distance the whole
// way around the globe.
function distanceToSeaKm(isSea, width, height, radiusMetres) {
  const distance = new Float32Array(width * height);
  distance.fill(Infinity);
  for (let i = 0; i < distance.length; i++) if (isSea[i]) distance[i] = 0;

  const stepY = (Math.PI * radiusMetres) / height / 1000;
  const stepX = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const lat = ((0.5 - (y + 0.5) / height) * Math.PI);
    stepX[y] = ((2 * Math.PI * radiusMetres) / width / 1000) * Math.max(Math.cos(lat), 1e-3);
  }

  const relax = (i, j, cost) => {
    const candidate = distance[j] + cost;
    if (candidate < distance[i]) distance[i] = candidate;
  };

  for (let sweep = 0; sweep < 2; sweep++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const dx = stepX[y];
      const diag = Math.hypot(dx, stepY);
      for (let x = 0; x < width; x++) {
        const i = row + x;
        relax(i, row + ((x - 1 + width) % width), dx);
        if (y > 0) {
          const up = row - width;
          relax(i, up + x, stepY);
          relax(i, up + ((x - 1 + width) % width), diag);
          relax(i, up + ((x + 1) % width), diag);
        }
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      const row = y * width;
      const dx = stepX[y];
      const diag = Math.hypot(dx, stepY);
      for (let x = width - 1; x >= 0; x--) {
        const i = row + x;
        relax(i, row + ((x + 1) % width), dx);
        if (y < height - 1) {
          const down = row + width;
          relax(i, down + x, stepY);
          relax(i, down + ((x - 1 + width) % width), diag);
          relax(i, down + ((x + 1) % width), diag);
        }
      }
    }
  }
  return distance;
}

const COARSE_WIDTH = 512;

function smoothstep(edge0, edge1, x) {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// The fields that vary smoothly -- how far inland a point is, and the
// sea-level temperature at its latitude -- are worked out on a coarse grid,
// because computing them per texture pixel would be sixteen times the work for
// a result that is genuinely smooth. Altitude and the land/sea line are read
// at full resolution instead, since both are sharp and both matter to the eye.
export function computeClimate({ elevation, seaLevelMetres, axialTiltDegrees, radiusMetres, params }) {
  const width = COARSE_WIDTH;
  const height = width / 2;

  const isSea = new Uint8Array(width * height);
  const xScale = elevation.width / width;
  const yScale = elevation.height / height;
  for (let y = 0; y < height; y++) {
    const sourceRow = Math.min(elevation.height - 1, Math.floor((y + 0.5) * yScale)) * elevation.width;
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(elevation.width - 1, Math.floor((x + 0.5) * xScale));
      isSea[y * width + x] = elevation.metres[sourceRow + sourceX] < seaLevelMetres ? 1 : 0;
    }
  }

  const distanceKm = distanceToSeaKm(isSea, width, height, radiusMetres);

  return { width, height, distanceKm, ...temperatureProfile(axialTiltDegrees, params) };
}

// Sea-level temperature per latitude, as a function only of insolation. Kept
// separate from computeClimate so the paint pass can evaluate it at its own
// (finer) row spacing without redoing the distance transform.
export function temperatureProfile(axialTiltDegrees, params, rows = 512) {
  const latitudes = new Float64Array(rows);
  for (let y = 0; y < rows; y++) latitudes[y] = (0.5 - (y + 0.5) / rows) * Math.PI;

  const insolation = annualInsolationByLatitude(latitudes, axialTiltDegrees);
  let weighted = 0;
  let weight = 0;
  for (let y = 0; y < rows; y++) {
    const w = Math.cos(latitudes[y]);
    weighted += insolation[y] * w;
    weight += w;
  }
  const mean = weighted / weight;

  const seaLevelC = new Float32Array(rows);
  for (let y = 0; y < rows; y++) {
    const anomaly = mean > 0 ? insolation[y] / mean - 1 : 0;
    const polar = Math.sin(latitudes[y]) ** 2;
    seaLevelC[y] =
      params.meanTemperatureC +
      params.insolationSensitivityC * anomaly +
      params.polarExtraC * polar;
  }
  return { profileRows: rows, seaLevelC, latitudes };
}

function bilinearCoarse(field, width, height, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = ((x0 % width) + width) % width;
  const xb = (((x0 + 1) % width) + width) % width;
  const ya = Math.min(height - 1, Math.max(0, y0)) * width;
  const yb = Math.min(height - 1, Math.max(0, y0 + 1)) * width;
  const top = field[ya + xa] * (1 - tx) + field[ya + xb] * tx;
  const bottom = field[yb + xa] * (1 - tx) + field[yb + xb] * tx;
  return top * (1 - ty) + bottom * ty;
}

// One point's climate, written into `out` as
// [vegetation, snow, seaIce, warmth, isSea]. Extracted so that the painter
// and the scorer cannot drift apart: a search that optimises one formula
// while the globe draws another would be worse than no search at all.
export const SURFACE_VEGETATION = 0;
export const SURFACE_SNOW = 1;
export const SURFACE_SEA_ICE = 2;
export const SURFACE_WARMTH = 3;
export const SURFACE_IS_SEA = 4;

export function classifyPoint(out, metres, seaLevelMetres, seaLevelC, dryBelt, distanceKm, params) {
  out[SURFACE_VEGETATION] = 0;
  out[SURFACE_SNOW] = 0;
  out[SURFACE_SEA_ICE] = 0;
  out[SURFACE_WARMTH] = 0;

  if (metres < seaLevelMetres) {
    out[SURFACE_IS_SEA] = 1;
    const temperature =
      params.meanTemperatureC + params.oceanModeration * (seaLevelC - params.meanTemperatureC);
    out[SURFACE_SEA_ICE] = 1 - smoothstep(
      params.seaIceTemperatureC - params.seaIceBlendC,
      params.seaIceTemperatureC + params.seaIceBlendC,
      temperature
    );
    return out;
  }

  out[SURFACE_IS_SEA] = 0;
  const temperature = seaLevelC - params.lapseRateCPerKm * ((metres - seaLevelMetres) / 1000);
  const moisture =
    params.coastalMoisture * Math.exp(-distanceKm / params.moistureDecayKm) * (1 - dryBelt);

  const warmth = smoothstep(
    params.vegetationWarmthC - params.vegetationWarmthWidthC,
    params.vegetationWarmthC + params.vegetationWarmthWidthC,
    temperature
  );
  const wet = smoothstep(
    params.vegetationMoistureHalf - params.vegetationMoistureWidth,
    params.vegetationMoistureHalf + params.vegetationMoistureWidth,
    moisture
  );
  out[SURFACE_WARMTH] = warmth;
  out[SURFACE_VEGETATION] = warmth * wet;

  const snowLine = params.freezeTemperatureC + params.permanentSnowOffsetC;
  out[SURFACE_SNOW] = 1 - smoothstep(
    snowLine - params.snowBlendC, snowLine + params.snowBlendC, temperature
  );
  return out;
}

// The dry belt is a function of latitude alone, so callers evaluate it once
// per row rather than per pixel.
export function dryBeltAt(latDeg, params) {
  return (
    params.subtropicalDryStrength *
    Math.exp(
      -(((Math.abs(latDeg) - params.subtropicalDryLatitudeDeg) / params.subtropicalDryWidthDeg) ** 2)
    )
  );
}

function mix(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

// Writes the finished surface into an RGBA buffer the size of the elevation
// raster. One pass, no intermediate full-resolution fields: at 2048x1024 that
// is two million pixels, and holding a temperature and a moisture array beside
// the image would cost 17 MB for numbers each used exactly once.
export function paintClimate(data, elevation, climate, seaLevelMetres, params, palette) {
  const { width, height } = elevation;
  const rowScale = climate.profileRows / height;
  const coarseX = climate.width / width;
  const coarseY = climate.height / height;

  const ground = [0, 0, 0];
  const bare = [0, 0, 0];
  const colour = [0, 0, 0];
  const surface = new Float64Array(5);

  for (let y = 0; y < height; y++) {
    const latDeg = 90 - ((y + 0.5) / height) * 180;
    const seaLevelC = climate.seaLevelC[Math.min(climate.profileRows - 1, Math.floor(y * rowScale))];
    const dryBelt = dryBeltAt(latDeg, params);
    const fy = (y + 0.5) * coarseY - 0.5;
    let i = y * width;
    let out = i * 4;

    for (let x = 0; x < width; x++, i++, out += 4) {
      const metres = elevation.metres[i];
      const distanceKm = bilinearCoarse(
        climate.distanceKm, climate.width, climate.height,
        (x + 0.5) * coarseX - 0.5, fy
      );
      classifyPoint(surface, metres, seaLevelMetres, seaLevelC, dryBelt, distanceKm, params);

      if (surface[SURFACE_IS_SEA]) {
        mix(colour, palette.shallowSea, palette.deepSea,
            smoothstep(0, params.seaDepthShadingM, seaLevelMetres - metres));
        mix(colour, colour, palette.snow, surface[SURFACE_SEA_ICE]);
      } else {
        // What bare ground looks like depends on how warm it is, not on how
        // dry it is: a hot desert is sand, a cold one is bare rock and gravel.
        // Keying this off moisture instead painted the Sahara grey.
        mix(bare, palette.rock, palette.sand, surface[SURFACE_WARMTH]);
        const vegetation = surface[SURFACE_VEGETATION];
        if (vegetation < 0.5) {
          mix(ground, bare, palette.dryGrass, vegetation * 2);
        } else {
          mix(ground, palette.dryGrass, palette.vegetation, (vegetation - 0.5) * 2);
        }
        mix(colour, ground, palette.snow, surface[SURFACE_SNOW]);
      }

      data[out] = colour[0];
      data[out + 1] = colour[1];
      data[out + 2] = colour[2];
      data[out + 3] = 255;
    }
  }
}

// The bare-rock starting point the user asked the flow to begin from: no
// climate at all, just the body's own shape under a uniform stone colour, with
// the sea left to the sea sphere.
export function paintBareRock(data, elevation, seaLevelMetres, palette) {
  const rock = palette.rock;
  for (let i = 0, out = 0; i < elevation.metres.length; i++, out += 4) {
    const metres = elevation.metres[i];
    if (metres < seaLevelMetres) {
      const t = smoothstep(0, 4000, seaLevelMetres - metres);
      data[out] = palette.shallowSea[0] + (palette.deepSea[0] - palette.shallowSea[0]) * t;
      data[out + 1] = palette.shallowSea[1] + (palette.deepSea[1] - palette.shallowSea[1]) * t;
      data[out + 2] = palette.shallowSea[2] + (palette.deepSea[2] - palette.shallowSea[2]) * t;
    } else {
      // A touch of height shading so the relief still reads as relief.
      const shade = 0.82 + 0.28 * smoothstep(0, 5000, metres - seaLevelMetres);
      data[out] = Math.min(255, rock[0] * shade);
      data[out + 1] = Math.min(255, rock[1] * shade);
      data[out + 2] = Math.min(255, rock[2] * shade);
    }
    data[out + 3] = 255;
  }
}
