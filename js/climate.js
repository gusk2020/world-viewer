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
// Stage 1 used only: global mean temperature, latitude, altitude, axial tilt,
// land-or-sea, and distance from the sea.
//
// Stage 2 adds the body's spin. Rotation rate and direction set the Coriolis
// deflection, which turns the overturning cells' equatorward and poleward flow
// into the trades, the westerlies and the polar easterlies; the same cells put
// rising air over the equator and the polar front and sinking air over the
// subtropics and the poles, which is where the deserts come from; and moisture
// is carried inland *by that wind*, losing water wherever the ground rises
// under it, which is what makes a windward coast wet and its lee dry.

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
// A note on the bounds, because several of them are doing real work. A search
// will always find the degenerate solution if its bounds permit one, and this
// one has now twice tried to satisfy the numbers by switching off the very
// mechanism it was given: first by turning continentality off, then by
// zeroing the subsidence belts and flattening every gradient into a step. A
// parameter that exists to express a required effect may come out weak, but
// it may not come out absent, so those are floored. That is not rigging the
// answer -- it is saying what the parameter means.
// `search` says whether the automatic parameter search may move a term, and
// within what range. It is here rather than in the search tool because it is
// part of what a parameter *means*, and because three separate rounds have now
// shown that a search will find any degenerate solution the setup permits:
//
//   search: false        -- never moved. Either a fact about the world (a lapse
//                           rate, the freezing point of seawater), a number the
//                           user drives themselves (the mean temperature), or a
//                           term nothing in the objective can see, which means
//                           the search would be fitting noise: a colour, or --
//                           for cellRotationExponent -- a rotation rate that on
//                           Earth is by definition the reference.
//   search: { min, max } -- moved, but inside a narrower range than the model
//                           itself allows. Only evaporationHalfC needs this, and
//                           the reason is measured: this model's seas run about
//                           -3 to +25 C, so a half-point outside that saturates
//                           the term at one end and it stops doing anything at
//                           all. That is exactly what happened before -- the fit
//                           parked it at -19.7 and the whole mechanism was inert
//                           while being credited for an improvement it had not
//                           caused.
//   (absent)             -- moved, over the parameter's own min..max.
export const CLIMATE_PARAMETERS = {
  meanTemperatureC: {
    value: 14, kind: "physical", min: -60, max: 60, search: false,
    note: "Global mean surface temperature. Earth today is about 14 C.",
  },
  lapseRateCPerKm: {
    value: 6.5, kind: "physical", min: 0, max: 12, search: false,
    note: "How fast air cools with height. Earth's average is 6.5 C/km.",
  },
  freezeTemperatureC: {
    value: 0, kind: "physical", min: -40, max: 20, search: false,
    note: "Where snow lies on land. Fresh water freezes at 0 C.",
  },
  seaIceTemperatureC: {
    value: -1.8, kind: "physical", min: -40, max: 10, search: false,
    note: "Where sea ice forms. Salt water freezes near -1.8 C.",
  },

  insolationSensitivityC: {
    value: 65, kind: "empirical", min: 55, max: 85,
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
      "insolation. Kept to a narrow range on purpose, like the term above: " +
      "given a wide one the " +
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
    note:
      "How far moisture reaches inland without help from the wind, as an " +
      "e-folding distance. Since Stage 2 this is only the still-air part; " +
      "`stillAirMoisture` says how much of the total it is allowed to be.",
  },
  evaporationHalfC: {
    value: 10, kind: "empirical", min: -20, max: 35,
    search: { min: -3, max: 25 },
    note:
      "Sea-surface temperature at which a sea gives up half as much moisture " +
      "as a warm one. Evaporation really does depend steeply on temperature, " +
      "and leaving it out was a visible fault rather than a refinement: with " +
      "every sea equally wet, the only way to get moisture into North " +
      "America was to lower the vegetation threshold worldwide, which turned " +
      "the whole globe too green -- and the only way to keep the globe honest " +
      "was to leave the continent bare. A warm Gulf of Mexico and a cold " +
      "South Atlantic settle both at once.",
  },
  evaporationWidthC: {
    value: 15, kind: "empirical", min: 3, max: 40,
    note: "How sharply that falls away as a sea gets colder.",
  },
  stillAirMoisture: {
    value: 0.35, kind: "empirical", min: 0, max: 1,
    note:
      "How much moisture reaches inland with no help from the prevailing " +
      "wind. Not a fudge for its own sake: a single annual-mean wind cannot " +
      "represent monsoon reversals, storm tracks or ordinary diffusion, and " +
      "with this at 0 the lee of every continent goes to bare rock. At 1 the " +
      "model falls back to Stage 1's behaviour.",
  },

  coriolisStrength: {
    value: 4, kind: "empirical", min: 1, max: 12, search: false,
    note:
      "How far the spin turns the cells' north-south flow toward the " +
      "east-west. It enters as an angle -- the flow is rotated right in the " +
      "northern hemisphere and left in the southern, by up to a quarter turn " +
      "-- which is the part that is real: the turn grows with the rotation " +
      "rate and with latitude, and it reverses when the rotation direction " +
      "does. The constant in front is a fudge, because this model has no " +
      "momentum budget to derive one from. Turning the flow rather than " +
      "adding a sideways component to it matters more than it looks: at low " +
      "latitudes a proportional term leaves the trades blowing almost due " +
      "equatorward, which starves the Amazon of the Atlantic moisture that " +
      "in fact reaches it from the east. Set once from the observed direction " +
      "of Earth's trades -- about 70 degrees off meridional at 15 degrees " +
      "latitude, which is what 4 gives -- and then left out of the automatic " +
      "search, because a land-cover objective cannot see which way the wind " +
      "blows and, given the freedom, drives this straight to its lower bound " +
      "and turns the trades and the westerlies off altogether.",
  },
  circulationCellEdgeDeg: {
    value: 30, kind: "empirical", min: 10, max: 90,
    note:
      "Latitude of the first cell boundary on a body spinning once per " +
      "reference day. Earth's Hadley cell ends near 30 degrees, which puts " +
      "the subtropical deserts there and the polar front near 60.",
  },
  cellRotationExponent: {
    value: 0.33, kind: "empirical", min: 0, max: 1, search: false,
    note:
      "How much a slower spin widens the cells. At 0 the cell structure is " +
      "fixed whatever the day length; positive, and a slow rotator collapses " +
      "toward a single cell per hemisphere, which is what Venus and Titan " +
      "actually do. Set to 1/3, which is what the standard scaling for the " +
      "width of a Hadley cell gives, and then left out of the automatic " +
      "search -- Earth's spin is the reference, so this term has *no effect " +
      "whatsoever* on an objective measured on Earth, and a search allowed " +
      "to move it is fitting noise. It matters only for another body.",
  },
  advectionRangeKm: {
    value: 2500, kind: "empirical", min: 100, max: 8000,
    note:
      "How far moisture rides the wind before rain takes it out, as an " +
      "e-folding distance along the flow.",
  },
  orographicRiseM: {
    value: 900, kind: "empirical", min: 100, max: 2500,
    note:
      "Height of ascent that removes about 63% of an air mass's moisture. " +
      "This is the windward-wet / lee-dry mechanism: the climb strips the " +
      "water out on the way up and the lee inherits what is left.",
  },
  subtropicalDryStrength: {
    value: 0.85, kind: "empirical", min: 0.25, max: 1,
    note:
      "How completely sinking air dries the ground beneath it. Where the " +
      "cells descend -- the subtropics, and the poles -- this is what makes " +
      "the Sahara, Arabia and Australia. Stage 1 placed that belt by hand at " +
      "a fitted latitude; it now comes out of the cell structure, so it moves " +
      "on its own when the spin changes.",
  },
  convergenceWetBonus: {
    value: 0.4, kind: "empirical", min: 0.1, max: 2,
    note:
      "Extra moisture where the cells make air rise: the equatorial belt and " +
      "the polar front. Without it the ITCZ is only as wet as the wind that " +
      "reaches it, and at the equator that wind is by construction nearly nil.",
  },

  vegetationWarmthC: {
    value: 3, kind: "empirical", min: -12, max: 25,
    note:
      "Temperature at which plant cover is half of what moisture allows. " +
      "Bounded to a range a plant could mean something in: given a wider one " +
      "the search parks it below -25 C, where the term is always satisfied " +
      "and stops discriminating at all -- and since bare ground is coloured " +
      "by this same warmth, that also paints the Arctic's gravel as sand.",
  },
  vegetationWarmthWidthC: {
    value: 8, kind: "empirical", min: 3, max: 15, search: false,
    note:
      "How gradually plant cover fades out as it gets colder. Not searched, " +
      "and for the same reason as the three widths below it: see the note on " +
      "snowBlendC.",
  },
  vegetationMoistureHalf: {
    value: 0.34, kind: "empirical", min: 0, max: 1,
    note: "Moisture at which plant cover is half of what warmth allows.",
  },
  vegetationMoistureWidth: {
    value: 0.22, kind: "empirical", min: 0.01, max: 1, search: false,
    note:
      "How gradually plant cover fades out as it gets drier. Not searched: " +
      "see snowBlendC. Its bounds used to read 0.15 to 0.35, which were the " +
      "*search*'s bounds written into the model's own range -- and the value " +
      "that actually shipped, 0.568, sits outside them, because it predates " +
      "the cap and nothing clamps. The range here is now what the model will " +
      "genuinely accept, and how wide the ramp should be is a judgement about " +
      "how the globe looks, not something the score can decide.",
  },

  sandTemperatureC: {
    value: 10, kind: "empirical", min: -20, max: 40, search: false,
    note:
      "Temperature at which bare ground is half sand, half rock. A hot desert " +
      "is sand; a cold one is rock and gravel. This used to be read off the " +
      "vegetation threshold, which coupled a colour to a land-cover boundary: " +
      "the search then pushed that threshold to its cold bound to free up the " +
      "moisture term, and every polar gravel field turned to sand. Nothing in " +
      "the objective can see a colour, so this is deliberately not searched.",
  },
  sandWidthC: {
    value: 10, kind: "empirical", min: 2, max: 25, search: false,
    note: "How gradually bare ground turns from rock to sand as it warms.",
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
    value: 4, kind: "empirical", min: 1.5, max: 20, search: false,
    note:
      "Width of the snow line, so it is a gradient rather than a hard edge. " +
      "**Not searched, and this was learned the hard way in Stage 7.** The " +
      "teacher data says one class per pixel, so a sharp boundary always " +
      "scores at least as well as a soft one through it -- a soft edge can " +
      "only ever be partly right. Given the freedom, the search drove all " +
      "four gradient widths to their floors at once and bought about a third " +
      "of its total gain that way, producing exactly the hard snow line, hard " +
      "ice edge and hard desert margin the user ruled out in the first " +
      "sentence of this whole feature. Nothing in the objective can see " +
      "softness, so this belongs with the colour parameters: chosen by eye, " +
      "left alone by the search.",
  },
  seaIceBlendC: {
    value: 2.5, kind: "empirical", min: 1, max: 20, search: false,
    note: "Width of the sea-ice edge. Not searched: see snowBlendC.",
  },
  seaDepthShadingM: {
    value: 4000, kind: "empirical", min: 100, max: 12000, search: false,
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

// A world can carry several **named parameter sets** rather than one. Each set
// says only what differs from the world's own base overrides, which are
// themselves only what differs from the schema defaults -- so a set that
// changes one number is one line, and the twenty fitted values stay written
// down in exactly one place.
//
// That layering is also what makes the two compatibility rules useful rather
// than theoretical: a set saved before a parameter existed takes the default
// through the base, and one still naming a retired parameter is reported and
// skipped. Both are resolved per set, so one bad set cannot spoil the others.
export function resolveClimateSets(worldConfig = {}) {
  const base = worldConfig.climate || {};
  const spec = worldConfig.climateSets || {};
  const list = Array.isArray(spec.list) && spec.list.length
    ? spec.list
    : [{ id: "default", label: "標準" }];

  const sets = list.map((entry, index) => {
    const id = typeof entry.id === "string" && entry.id ? entry.id : `set${index}`;
    const resolved = resolveClimateParams({ ...base, ...(entry.params || {}) });
    return {
      id,
      label: typeof entry.label === "string" && entry.label ? entry.label : id,
      note: typeof entry.note === "string" ? entry.note : "",
      ...resolved,
    };
  });

  const defaultId = sets.some((set) => set.id === spec.default) ? spec.default : sets[0].id;
  return { sets, defaultId };
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

const COARSE_WIDTH = 512;

// Earth's sidereal day. Every spin in this model is measured against it, so
// Earth comes out at exactly 1 and nothing has to be special-cased for it.
export const REFERENCE_DAY_HOURS = 23.9345;

// How many times the moisture field is swept. Each sweep carries moisture at
// least one grid step along the wind, and because the sweeps alternate
// direction in place they usually carry it much further. Measured against a
// certainly-converged 128-sweep run over Earth: 32 sweeps still differ by up
// to 0.018, 48 are identical to five decimals, and 64 costs 16 ms more than 48
// out of about 700. So this is 48's answer with a margin, for a world whose
// geography needs longer. Not a parameter: a convergence setting, not a
// property of any world.
const ADVECTION_SWEEPS = 64;

// A parcel is never sampled more than this many cells away in longitude, which
// only ever bites within a degree or two of a pole, where a grid step east is
// a few hundred metres on the ground and the offset would otherwise run right
// around the world.
const MAX_OFFSET_CELLS = 6;

function smoothstep(edge0, edge1, x) {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// The prevailing wind, per latitude row. Three things come out of the same
// two lines, which is the reason for doing it this way rather than painting
// wind belts on by hand:
//
//   * The overturning cells give a north-south flow that is equatorward in the
//     tropics, poleward in mid-latitudes and equatorward again near the poles.
//   * Coriolis turns that flow sideways -- right in the northern hemisphere,
//     left in the southern -- by an angle that grows with latitude and with
//     the spin, up to a quarter turn. So it is nearly nil at the equator and
//     nearly complete in mid-latitudes, and it *reverses* when the rotation
//     direction does, which is exactly what the user asked for. On Earth it
//     produces easterly trades, westerlies and polar easterlies without any
//     of the three being written down.
//   * Where the flow converges the air rises and it rains; where it diverges
//     the air sinks and the ground dries. The subtropical deserts and the
//     polar deserts are the same fact seen twice.
//
// The cells also widen as the spin slows, by a fitted exponent: far enough and
// a hemisphere ends up with a single cell reaching the pole, as Venus and
// Titan do.
export function windField(rows, dayLengthHours, rotationDirection, params) {
  const direction = rotationDirection >= 0 ? 1 : -1;
  const spin = (direction * REFERENCE_DAY_HOURS) / Math.max(Math.abs(dayLengthHours), 1e-3);
  const cellEdgeDeg = Math.min(
    90,
    params.circulationCellEdgeDeg / Math.max(Math.abs(spin), 1e-3) ** params.cellRotationExponent
  );

  const east = new Float64Array(rows);
  const north = new Float64Array(rows);
  const convergence = new Float64Array(rows);
  for (let y = 0; y < rows; y++) {
    const latDeg = (0.5 - (y + 0.5) / rows) * 180;
    const latRad = (latDeg * Math.PI) / 180;
    const phase = (Math.PI * latDeg) / cellEdgeDeg;
    const flow = -Math.sin(phase);
    // The cells' flow, turned by the spin. A quarter turn is the limit: that
    // is flow entirely along the parallels, which is what a fast rotator's
    // mid-latitudes really do. tanh keeps it inside that limit and makes the
    // turn grow smoothly with latitude and with the rotation rate.
    const turn = (Math.PI / 2) * Math.tanh(params.coriolisStrength * spin * Math.sin(latRad));
    east[y] = flow * Math.sin(turn);
    north[y] = flow * Math.cos(turn);
    convergence[y] = Math.cos(phase);
  }
  return { rows, spin, cellEdgeDeg, east, north, convergence };
}

// How much moisture a sea gives up, per latitude row. A sea's temperature is
// the moderated profile `classifyPoint` already uses for open water, so this
// costs nothing beyond the smoothstep.
function evaporationByRow(seaLevelC, profileRows, rows, params) {
  const out = new Float64Array(rows);
  for (let y = 0; y < rows; y++) {
    const t = seaLevelC[Math.min(profileRows - 1, Math.floor((y * profileRows) / rows))];
    const temperature =
      params.meanTemperatureC + params.oceanModeration * (t - params.meanTemperatureC);
    out[y] = smoothstep(
      params.evaporationHalfC - params.evaporationWidthC,
      params.evaporationHalfC + params.evaporationWidthC,
      temperature
    );
  }
  return out;
}

// The moisture that reaches inland with no help from the prevailing wind.
// This used to be a plain exponential in the distance to the *nearest* sea,
// which cannot tell a warm sea from a cold one. It is now that same sweep with
// the source value carried along: each sea cell starts at its own evaporation
// and every land cell keeps the best any neighbour can deliver after the
// journey.
//
// The step costs are weighted because a step in longitude is a different
// distance on the ground at every latitude -- treating the grid as square
// would make polar continents look far wider than they are -- and longitude
// wraps, so the sweeps run twice: one pass cannot carry a value the whole way
// round the globe.
function stillAirField(isSea, width, height, radiusMetres, evaporation, params) {
  const field = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) if (isSea[row + x]) field[row + x] = evaporation[y];
  }

  const stepY = (Math.PI * radiusMetres) / height / 1000;
  const decay = params.moistureDecayKm;
  const stepX = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const lat = (0.5 - (y + 0.5) / height) * Math.PI;
    stepX[y] = ((2 * Math.PI * radiusMetres) / width / 1000) * Math.max(Math.cos(lat), 1e-3);
  }
  const relax = (i, j, cost) => {
    const candidate = field[j] * Math.exp(-cost / decay);
    if (candidate > field[i]) field[i] = candidate;
  };

  for (let sweep = 0; sweep < 2; sweep++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const dx = stepX[y];
      const diag = Math.hypot(dx, stepY);
      for (let x = 0; x < width; x++) {
        const i = row + x;
        if (isSea[i]) continue;
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
        if (isSea[i]) continue;
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
  return field;
}

// Moisture carried inland by that wind.
//
// Each sea cell holds the field at its own evaporation; every land cell takes
// what its *upwind* neighbour has, minus what the journey costs and minus what
// any climb takes out of it. Sweeping that rule to convergence is what produces the wet
// windward coast and the dry lee, and it is why this is an iteration rather
// than a formula in the distance to the sea.
//
// It is cheap because the wind depends only on latitude: the upwind offset,
// its bilinear weights and the along-flow decay are all constant across a row,
// and the climb out of the upwind cell never changes at all. So everything is
// worked out once into a per-cell transmission factor and each sweep is four
// reads and three multiplies.
function moistureField({
  isSea, landHeight, width, height, radiusMetres, wind, evaporation, still, params,
}) {
  const stepYKm = (Math.PI * radiusMetres) / height / 1000;
  const decay = Math.exp(-stepYKm / params.advectionRangeKm);

  const rowA = new Int32Array(height);
  const rowB = new Int32Array(height);
  const offX = new Int32Array(height);
  const fx = new Float64Array(height);
  const fy = new Float64Array(height);
  const moving = new Uint8Array(height);

  for (let y = 0; y < height; y++) {
    const latRad = (0.5 - (y + 0.5) / height) * Math.PI;
    const stepXKm =
      ((2 * Math.PI * radiusMetres) / width / 1000) * Math.max(Math.cos(latRad), 1e-3);
    const speed = Math.hypot(wind.east[y], wind.north[y]);
    if (!(speed > 1e-6)) {
      // Dead calm -- at the equator, at a cell boundary, or on a body with no
      // spin worth the name. Nothing is carried; the still-air term below is
      // all such a row gets.
      moving[y] = 0;
      rowA[y] = y * width;
      rowB[y] = y * width;
      continue;
    }
    moving[y] = 1;
    // Upwind is one meridional grid step *against* the flow.
    let dx = (-(wind.east[y] / speed) * stepYKm) / stepXKm;
    dx = Math.min(MAX_OFFSET_CELLS, Math.max(-MAX_OFFSET_CELLS, dx));
    const dy = wind.north[y] / speed; // y grows southward, so poleward flow reads back equatorward
    const ix = Math.floor(dx);
    const iy = Math.floor(dy);
    offX[y] = ix;
    fx[y] = dx - ix;
    fy[y] = dy - iy;
    rowA[y] = Math.min(height - 1, Math.max(0, y + iy)) * width;
    rowB[y] = Math.min(height - 1, Math.max(0, y + iy + 1)) * width;
  }

  // The upwind sample. Everything except `x` is constant across a row, so the
  // callers below hoist the row's five values out of their inner loop and pass
  // them in; this ran 8.4 million times with five typed-array reads of its own
  // before that. The arithmetic is unchanged, so the result is bit-identical.
  const sampleRow = (field, a, b, ox, tx, ty, x) => {
    const xa = (((x + ox) % width) + width) % width;
    const xb = (xa + 1) % width;
    const top = field[a + xa] * (1 - tx) + field[a + xb] * tx;
    const bottom = field[b + xa] * (1 - tx) + field[b + xb] * tx;
    return top * (1 - ty) + bottom * ty;
  };

  // What survives one step: the along-flow decay, times the cost of any climb
  // out of the upwind cell. Heights are measured above sea level and clamped
  // there, so arriving from open water is not read as a several-kilometre
  // ascent out of the seabed.
  const transmission = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    if (!moving[y]) continue;
    const row = y * width;
    const a = rowA[y], b = rowB[y], ox = offX[y], tx = fx[y], ty = fy[y];
    for (let x = 0; x < width; x++) {
      const rise = Math.max(0, landHeight[row + x] - sampleRow(landHeight, a, b, ox, tx, ty, x));
      transmission[row + x] = decay * Math.exp(-rise / params.orographicRiseM);
    }
  }

  const moisture = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) moisture[row + x] = isSea[row + x] ? evaporation[y] : 0;
  }

  // In place, alternating direction, so each sweep propagates a long way with
  // the flow instead of only one cell.
  for (let sweep = 0; sweep < ADVECTION_SWEEPS; sweep++) {
    const back = sweep % 2 === 1;
    for (let k = 0; k < height; k++) {
      const y = back ? height - 1 - k : k;
      // A row the wind does not reach has a transmission of zero everywhere,
      // so it can be skipped outright rather than multiplied by nothing.
      if (!moving[y]) continue;
      const row = y * width;
      const a = rowA[y], b = rowB[y], ox = offX[y], tx = fx[y], ty = fy[y];
      for (let j = 0; j < width; j++) {
        const x = back ? width - 1 - j : j;
        const i = row + x;
        if (isSea[i]) continue;
        const carried = transmission[i] * sampleRow(moisture, a, b, ox, tx, ty, x);
        if (carried > moisture[i]) moisture[i] = Math.min(1, carried);
      }
    }
  }

  // Then the two things the wind alone cannot deliver: the moisture that gets
  // inland without it, and the cells' own rising and sinking air.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    // windField is always built at this grid's own height, so the row index
    // is the row -- no rescaling, and no chance of an off-by-one in one.
    const convergence = wind.convergence[y];
    const belt =
      (1 - params.subtropicalDryStrength * Math.max(0, -convergence)) *
      (1 + params.convergenceWetBonus * Math.max(0, convergence));
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const wind_ = moisture[i];
      const total =
        wind_ + params.stillAirMoisture * params.coastalMoisture * still[i] * (1 - wind_);
      moisture[i] = Math.min(1, Math.max(0, total * belt));
    }
  }
  return moisture;
}

// Everything about a world that the search cannot change: where the land is
// and how high it stands above the sea in force. Split out because a parameter
// fit runs the model thousands of times over one fixed geography, and reading
// the full-resolution raster down to the coarse grid does not need repeating.
export function computeGeography({ elevation, seaLevelMetres, radiusMetres }) {
  const width = COARSE_WIDTH;
  const height = width / 2;

  const isSea = new Uint8Array(width * height);
  const landHeight = new Float32Array(width * height);
  const xScale = Math.max(1, Math.round(elevation.width / width));
  const yScale = Math.max(1, Math.round(elevation.height / height));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Averaged over the block this cell covers rather than sampled at its
      // centre. A point sample of a 20 km raster can land in a valley and miss
      // a whole mountain range, and a range that is not in the coarse grid
      // casts no rain shadow -- which is most of what Stage 2 is for.
      let total = 0;
      let count = 0;
      for (let sy = 0; sy < yScale; sy++) {
        const row = Math.min(elevation.height - 1, y * yScale + sy) * elevation.width;
        for (let sx = 0; sx < xScale; sx++) {
          total += elevation.metres[row + Math.min(elevation.width - 1, x * xScale + sx)];
          count++;
        }
      }
      const metres = total / count;
      isSea[y * width + x] = metres < seaLevelMetres ? 1 : 0;
      landHeight[y * width + x] = Math.max(0, metres - seaLevelMetres);
    }
  }

  return { width, height, isSea, landHeight, radiusMetres };
}

// The fields that vary smoothly -- the wind, how far inland a point is, how
// much moisture reaches it -- are worked out on a coarse grid, because
// computing them per texture pixel would be sixteen times the work for a
// result that is genuinely smooth. Altitude and the land/sea line are read at
// full resolution instead, since both are sharp and both matter to the eye.
export function computeClimate({
  elevation, seaLevelMetres, axialTiltDegrees, radiusMetres,
  dayLengthHours, rotationDirection, params, geography,
}) {
  const geo = geography || computeGeography({ elevation, seaLevelMetres, radiusMetres });
  const profile = temperatureProfile(axialTiltDegrees, params);
  const evaporation = evaporationByRow(
    profile.seaLevelC, profile.profileRows, geo.height, params
  );
  const still = stillAirField(
    geo.isSea, geo.width, geo.height, geo.radiusMetres, evaporation, params
  );
  const wind = windField(geo.height, dayLengthHours, rotationDirection, params);
  const moisture = moistureField({
    isSea: geo.isSea, landHeight: geo.landHeight,
    width: geo.width, height: geo.height, radiusMetres: geo.radiusMetres,
    wind, evaporation, still, params,
  });

  return {
    width: geo.width, height: geo.height, moisture, wind, evaporation, still,
    ...profile,
  };
}

// Sea-level temperature per latitude, as a function only of insolation. Kept
// separate from computeClimate, and computed at a finer row spacing than the
// coarse grid, because the paint pass reads it per texture row.
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

// Where one texture column lands in the coarse grid. The painter walks two
// million pixels and this depends only on x, so it is worked out once per
// column instead of once per pixel -- a floor and two modulos each time,
// which is most of what the inner loop was doing.
function coarseColumns(textureWidth, coarseWidth) {
  const a = new Int32Array(textureWidth);
  const b = new Int32Array(textureWidth);
  const t = new Float64Array(textureWidth);
  const scale = coarseWidth / textureWidth;
  for (let x = 0; x < textureWidth; x++) {
    const fx = (x + 0.5) * scale - 0.5;
    const x0 = Math.floor(fx);
    t[x] = fx - x0;
    a[x] = ((x0 % coarseWidth) + coarseWidth) % coarseWidth;
    b[x] = (((x0 + 1) % coarseWidth) + coarseWidth) % coarseWidth;
  }
  return { a, b, t };
}

// One point's climate, written into `out` as
// [vegetation, snow, seaIce, sand, isSea]. Extracted so that the painter
// and the scorer cannot drift apart: a search that optimises one formula
// while the globe draws another would be worse than no search at all.
export const SURFACE_VEGETATION = 0;
export const SURFACE_SNOW = 1;
export const SURFACE_SEA_ICE = 2;
export const SURFACE_SAND = 3;
export const SURFACE_IS_SEA = 4;

export function classifyPoint(out, metres, seaLevelMetres, seaLevelC, moisture, params) {
  out[SURFACE_VEGETATION] = 0;
  out[SURFACE_SNOW] = 0;
  out[SURFACE_SEA_ICE] = 0;
  out[SURFACE_SAND] = 0;

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
  out[SURFACE_SAND] = smoothstep(
    params.sandTemperatureC - params.sandWidthC,
    params.sandTemperatureC + params.sandWidthC,
    temperature
  );
  out[SURFACE_VEGETATION] = warmth * wet;

  const snowLine = params.freezeTemperatureC + params.permanentSnowOffsetC;
  out[SURFACE_SNOW] = 1 - smoothstep(
    snowLine - params.snowBlendC, snowLine + params.snowBlendC, temperature
  );
  return out;
}

// ---------------------------------------------------------------------------
// Scoring against the teacher data (Stage 6)
//
// The user asked for four agreement numbers -- 植生 / 乾燥地 / 雪氷 / 海氷 --
// and a total, worked out by a program rather than by looking at pictures.
//
// The measure per class is **intersection over union**, which is the standard
// way two land-cover maps are compared and the right one here for a reason
// that matters: it weights every class equally. Land ice is a ninth of the
// land and sea ice a seventieth of the sea, so a plain pixel-accuracy score
// barely notices either -- a model that painted no ice at all would still
// score well. IoU cannot be fooled that way: a class the model never produces
// scores zero for that class.
//
// Two versions of each number come out, and they answer different questions:
//
//   hard  -- the model's colours resolved to one class per pixel, exactly the
//            way the painter resolves them. This is what gets reported,
//            because it is what the eye sees.
//   soft  -- the same thing computed from the model's own memberships, which
//            move continuously as a parameter moves. This is what the search
//            in the next stage optimises, because a hard label only changes
//            when a pixel flips and gives the search almost nothing to follow.
//
// Everything is area-weighted by cos(latitude): an equirectangular grid gives
// a polar cell the same number of pixels as an equatorial one while it covers
// a fraction of the ground, and without the weight Antarctica would count for
// several times what it is.
// ---------------------------------------------------------------------------

// The parameters the automatic search may move, with the range it may move
// each one over. Derived from the schema rather than listed again, so adding a
// parameter puts it in the search unless it says otherwise.
export function searchableParameters() {
  const out = [];
  for (const [name, spec] of Object.entries(CLIMATE_PARAMETERS)) {
    if (spec.search === false) continue;
    const range = spec.search && typeof spec.search === "object" ? spec.search : {};
    out.push({
      name,
      min: range.min !== undefined ? range.min : spec.min,
      max: range.max !== undefined ? range.max : spec.max,
      value: spec.value,
      kind: spec.kind,
    });
  }
  return out;
}

// The teacher's class numbers. They are the bytes in the committed teacher
// PNG, and tools/build_teacher.py writes them.
export const TEACHER_SEA = 0;
export const TEACHER_SEA_ICE = 1;
export const TEACHER_VEGETATION = 2;
export const TEACHER_ARID = 3;
export const TEACHER_LAND_ICE = 4;

// Scored classes, in the order the user listed them. Sea itself is not one of
// them: where the sea is comes from the elevation raster, which the teacher
// and the model read from the same file, so they agree by construction and
// scoring it would only inflate every total.
export const SCORED_CLASSES = [
  { key: "vegetation", label: "植生", teacher: TEACHER_VEGETATION },
  { key: "arid", label: "乾燥地", teacher: TEACHER_ARID },
  { key: "landIce", label: "雪氷", teacher: TEACHER_LAND_ICE },
  { key: "seaIce", label: "海氷", teacher: TEACHER_SEA_ICE },
];

// Regions: a plain 15x30 degree grid, kept from the Stage 3 repair of the
// hand-drawn boxes that missed Indochina entirely. Every cell holding a real
// amount of land is scored, so no part of the world is invisible to the
// objective because nobody thought to draw a box round it.
const REGION_LAT_STEP = 15;
const REGION_LNG_STEP = 30;
const REGION_MIN_LAND_FRACTION = 0.001;

// How much the region term counts next to the global one. Half: the global
// agreement is the headline, and the region term exists to stop one continent
// being paid for by another, not to become the score itself.
const REGION_WEIGHT = 0.5;

// The model's memberships resolved to one class, matching what paintClimate
// actually draws: it blends all the way to snow at 1, and dry grass is the
// halfway point of the vegetation ramp.
function hardClass(surface) {
  if (surface[SURFACE_IS_SEA]) {
    return surface[SURFACE_SEA_ICE] > 0.5 ? TEACHER_SEA_ICE : TEACHER_SEA;
  }
  if (surface[SURFACE_SNOW] > 0.5) return TEACHER_LAND_ICE;
  return surface[SURFACE_VEGETATION] > 0.5 ? TEACHER_VEGETATION : TEACHER_ARID;
}

// The model's soft membership of each scored class. Snow is taken out of the
// vegetation and bare shares first, the same order the painter mixes them in,
// so the four always sum to at most one.
function softMemberships(surface, out) {
  if (surface[SURFACE_IS_SEA]) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = surface[SURFACE_SEA_ICE];
    return;
  }
  const snow = surface[SURFACE_SNOW];
  out[0] = (1 - snow) * surface[SURFACE_VEGETATION];
  out[1] = (1 - snow) * (1 - surface[SURFACE_VEGETATION]);
  out[2] = snow;
  out[3] = 0;
}

function iou(intersection, union) {
  return union > 0 ? intersection / union : null;
}

/**
 * Compare a painted climate against a world's teacher data.
 *
 * `teacher` is { width, height, data } of class bytes; it does not have to
 * match the elevation raster's size, though today it does.
 *
 * `step` samples every nth pixel in both directions. The classes are areas,
 * so a quarter of the pixels gives the same fractions to well under a
 * percentage point while costing a quarter of the time -- which is what makes
 * this affordable on a phone during a repaint.
 */
export function scoreAgainstTeacher({
  elevation, climate, teacher, seaLevelMetres, params, step = 1,
}) {
  const { width, height } = elevation;
  const rowScale = climate.profileRows / height;
  const coarseY = climate.height / height;
  const column = coarseColumns(width, climate.width);
  const field = climate.moisture;
  const teacherScaleX = teacher.width / width;
  const teacherScaleY = teacher.height / height;

  const n = SCORED_CLASSES.length;
  const hardHit = new Float64Array(n);
  const hardModel = new Float64Array(n);
  const hardTeacher = new Float64Array(n);
  const softHit = new Float64Array(n);
  const softUnion = new Float64Array(n);
  let landWeight = 0;
  let landCorrect = 0;
  let totalWeight = 0;

  const latRows = Math.ceil(180 / REGION_LAT_STEP);
  const lngColumns = Math.ceil(360 / REGION_LNG_STEP);
  const cells = latRows * lngColumns;
  const cellHit = new Float64Array(cells * n);
  const cellUnion = new Float64Array(cells * n);
  const cellLand = new Float64Array(cells);

  const surface = new Float64Array(5);
  const soft = new Float64Array(n);

  for (let y = 0; y < height; y += step) {
    const latDeg = 90 - ((y + 0.5) / height) * 180;
    const w = Math.cos((latDeg * Math.PI) / 180);
    if (w <= 0) continue;
    const seaLevelC = climate.seaLevelC[Math.min(climate.profileRows - 1, Math.floor(y * rowScale))];
    const fy = (y + 0.5) * coarseY - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const ya = Math.min(climate.height - 1, Math.max(0, y0)) * climate.width;
    const yb = Math.min(climate.height - 1, Math.max(0, y0 + 1)) * climate.width;
    const row = y * width;
    const teacherRow = Math.min(teacher.height - 1, Math.floor(y * teacherScaleY)) * teacher.width;
    const cellRow = Math.min(latRows - 1, Math.floor((90 - latDeg) / REGION_LAT_STEP)) * lngColumns;

    for (let x = 0; x < width; x += step) {
      const metres = elevation.metres[row + x];
      let moisture = 0;
      if (metres >= seaLevelMetres) {
        const xa = column.a[x];
        const xb = column.b[x];
        const tx = column.t[x];
        const top = field[ya + xa] * (1 - tx) + field[ya + xb] * tx;
        const bottom = field[yb + xa] * (1 - tx) + field[yb + xb] * tx;
        moisture = top * (1 - ty) + bottom * ty;
      }
      classifyPoint(surface, metres, seaLevelMetres, seaLevelC, moisture, params);

      const want = teacher.data[teacherRow + Math.min(teacher.width - 1, Math.floor(x * teacherScaleX))];
      const got = hardClass(surface);
      softMemberships(surface, soft);
      const cell = cellRow + Math.min(lngColumns - 1, Math.floor((x / width) * lngColumns));
      totalWeight += w;
      const isLand = metres >= seaLevelMetres;
      if (isLand) {
        landWeight += w;
        if (got === want) landCorrect += w;
        cellLand[cell] += w;
      }

      for (let k = 0; k < n; k++) {
        const teacherIs = want === SCORED_CLASSES[k].teacher ? 1 : 0;
        const modelIs = got === SCORED_CLASSES[k].teacher ? 1 : 0;
        hardTeacher[k] += w * teacherIs;
        hardModel[k] += w * modelIs;
        hardHit[k] += w * teacherIs * modelIs;
        // Soft IoU: the product is the overlap, and inclusion-exclusion gives
        // the union, so both reduce to the hard numbers when the memberships
        // are already 0 or 1.
        const p = soft[k];
        const hit = w * p * teacherIs;
        const union = w * (p + teacherIs - p * teacherIs);
        softHit[k] += hit;
        softUnion[k] += union;
        cellHit[cell * n + k] += hit;
        cellUnion[cell * n + k] += union;
      }
    }
  }

  const classes = {};
  let hardTotal = 0;
  let softTotal = 0;
  let counted = 0;
  for (let k = 0; k < n; k++) {
    const spec = SCORED_CLASSES[k];
    const hard = iou(hardHit[k], hardModel[k] + hardTeacher[k] - hardHit[k]);
    const softScore = iou(softHit[k], softUnion[k]);
    classes[spec.key] = {
      label: spec.label,
      iou: hard,
      softIou: softScore,
      // Of the teacher's own area for this class, how much the model found.
      recall: hardTeacher[k] > 0 ? hardHit[k] / hardTeacher[k] : null,
      // Of what the model called this class, how much the teacher agrees with.
      precision: hardModel[k] > 0 ? hardHit[k] / hardModel[k] : null,
      teacherArea: hardTeacher[k],
      modelArea: hardModel[k],
    };
    if (hard !== null) {
      hardTotal += hard;
      softTotal += softScore;
      counted++;
    }
  }

  const regions = [];
  let regionPenalty = 0;
  let regionCount = 0;
  const totalLand = cellLand.reduce((a, b) => a + b, 0);
  for (let cell = 0; cell < cells; cell++) {
    if (cellLand[cell] < totalLand * REGION_MIN_LAND_FRACTION) continue;
    let sum = 0;
    let used = 0;
    for (let k = 0; k < n; k++) {
      if (cellUnion[cell * n + k] <= 0) continue;
      sum += cellHit[cell * n + k] / cellUnion[cell * n + k];
      used++;
    }
    const value = used ? sum / used : 0;
    regionPenalty += 1 - value;
    regionCount++;
    const latIndex = Math.floor(cell / lngColumns);
    const lngIndex = cell % lngColumns;
    regions.push({
      lat: 90 - latIndex * REGION_LAT_STEP,
      lng: -180 + lngIndex * REGION_LNG_STEP,
      softIou: value,
      land: cellLand[cell] / totalLand,
    });
  }
  regionPenalty = regionCount ? regionPenalty / regionCount : 0;

  const meanIou = counted ? hardTotal / counted : 0;
  const meanSoftIou = counted ? softTotal / counted : 0;
  return {
    classes,
    meanIou,
    meanSoftIou,
    landAccuracy: landWeight > 0 ? landCorrect / landWeight : 0,
    totalWeight,
    regions,
    regionPenalty,
    regionCount,
    // Lower is better, and this is the number the automatic search minimises.
    score: 1 - meanSoftIou + REGION_WEIGHT * regionPenalty,
  };
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
  const coarseY = climate.height / height;
  const column = coarseColumns(width, climate.width);
  const field = climate.moisture;

  const ground = [0, 0, 0];
  const bare = [0, 0, 0];
  const colour = [0, 0, 0];
  const surface = new Float64Array(5);

  for (let y = 0; y < height; y++) {
    const seaLevelC = climate.seaLevelC[Math.min(climate.profileRows - 1, Math.floor(y * rowScale))];
    // The row's two coarse rows and the weight between them: constant across
    // the whole row, so they come out of the inner loop too.
    const fy = (y + 0.5) * coarseY - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const ya = Math.min(climate.height - 1, Math.max(0, y0)) * climate.width;
    const yb = Math.min(climate.height - 1, Math.max(0, y0 + 1)) * climate.width;
    let i = y * width;
    let out = i * 4;

    for (let x = 0; x < width; x++, i++, out += 4) {
      const metres = elevation.metres[i];
      // Sea pixels never read the moisture -- `classifyPoint` returns before
      // it -- and on Earth they are seven pixels in ten, so the sample is not
      // taken for them at all.
      let moisture = 0;
      if (metres >= seaLevelMetres) {
        const xa = column.a[x];
        const xb = column.b[x];
        const tx = column.t[x];
        const top = field[ya + xa] * (1 - tx) + field[ya + xb] * tx;
        const bottom = field[yb + xa] * (1 - tx) + field[yb + xb] * tx;
        moisture = top * (1 - ty) + bottom * ty;
      }
      classifyPoint(surface, metres, seaLevelMetres, seaLevelC, moisture, params);

      if (surface[SURFACE_IS_SEA]) {
        mix(colour, palette.shallowSea, palette.deepSea,
            smoothstep(0, params.seaDepthShadingM, seaLevelMetres - metres));
        mix(colour, colour, palette.snow, surface[SURFACE_SEA_ICE]);
      } else {
        // What bare ground looks like depends on how warm it is, not on how
        // dry it is: a hot desert is sand, a cold one is bare rock and gravel.
        // Keying this off moisture instead painted the Sahara grey.
        mix(bare, palette.rock, palette.sand, surface[SURFACE_SAND]);
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

// How much height it takes for bare rock to reach its lightest shade. Only
// the 岩 mode uses it, and nothing in the objective can see it, so it is a
// constant here rather than a parameter nobody would ever fit.
const ROCK_SHADE_HEIGHT_M = 5000;

// The bare-rock starting point the user asked the flow to begin from: no
// climate at all, just the body's own shape under a uniform stone colour, with
// the sea left to the sea sphere.
//
// It takes `params` only for the depth the sea ramp bottoms out at. That used
// to be a `4000` written out here while `paintClimate` read
// `seaDepthShadingM` -- two places deciding the same thing, which is the
// duplication class that caused a real bug in V0.6 (see the cleanup pass).
// They agree today because the parameter sits at its default; they would have
// silently disagreed the moment anyone fitted it.
export function paintBareRock(data, elevation, seaLevelMetres, params, palette) {
  const rock = palette.rock;
  for (let i = 0, out = 0; i < elevation.metres.length; i++, out += 4) {
    const metres = elevation.metres[i];
    if (metres < seaLevelMetres) {
      const t = smoothstep(0, params.seaDepthShadingM, seaLevelMetres - metres);
      data[out] = palette.shallowSea[0] + (palette.deepSea[0] - palette.shallowSea[0]) * t;
      data[out + 1] = palette.shallowSea[1] + (palette.deepSea[1] - palette.shallowSea[1]) * t;
      data[out + 2] = palette.shallowSea[2] + (palette.deepSea[2] - palette.shallowSea[2]) * t;
    } else {
      // A touch of height shading so the relief still reads as relief.
      const shade = 0.82 + 0.28 * smoothstep(0, ROCK_SHADE_HEIGHT_M, metres - seaLevelMetres);
      data[out] = Math.min(255, rock[0] * shade);
      data[out + 1] = Math.min(255, rock[1] * shade);
      data[out + 2] = Math.min(255, rock[2] * shade);
    }
    data[out + 3] = 255;
  }
}
