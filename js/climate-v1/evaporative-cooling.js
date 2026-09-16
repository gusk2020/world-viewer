// Climate v1 -- EXPERIMENTAL evaporative cooling over land.
//
// ---------------------------------------------------------------------------
// STATUS: experimental preview. NOT adopted as Stage 2 physics.
//
// `evaporativeCoolingC` defaults to **0**, which makes every function here a
// no-op and leaves Stage 2's temperature field bit-for-bit what it was. The
// app ships with it off, and turning it off again restores the old result
// exactly -- there is no state to unwind.
// ---------------------------------------------------------------------------
//
// WHAT IT IS FOR. Stage 2's land temperature is, in full,
// `seaLevelC(lat) - lapseRate*z/1000`: no ocean moderation, no continentality,
// no surface energy balance. Measured against NCEP 2 m air temperature and
// binned by the TEACHER's own humidity, the resulting land bias runs from
// -0.68 C at 5-8 g/kg to +4.60 C above 16 g/kg, and the same ramp survives
// inside the tropics alone (-1.06 -> +4.62), so it is not a latitude effect.
// Region by region the three worst are the three wettest -- Amazon +6.2,
// Congo +5.3, Indonesia +5.0 -- while every dry region at the same latitudes
// is right to within half a degree. See
// docs/climate-v1-temperature-bias-diagnosis-stage2.md.
//
// The missing physics is that a wet surface spends much of its net radiation
// evaporating water instead of warming the air. This module is the smallest
// expression of that idea which uses **only the model's own state**.
//
// THE FORM, AND WHY THIS ONE.
//
//     dT_i = -evaporativeCoolingC * q_i^2 / (q_i^2 + qHalf^2)      (land only)
//
// where `q_i` is the model's own specific humidity in g/kg. Reasons:
//   - It keys on the model's own moisture, so it is geography-blind by
//     construction: no place name, no latitude, no teacher array is reachable
//     from this file. Move the continents and the cooling moves with them.
//   - It saturates, so a very wet cell cannot be cooled without limit, and it
//     is quadratic at small q, so a desert (2-5 g/kg) is left essentially
//     alone while a rainforest (15-18 g/kg) is not. That contrast is the
//     whole measured signal.
//   - It is applied to LAND ONLY. Sea temperature in this model is a
//     boundary condition set by ocean moderation, and evaporative cooling of
//     the sea surface is already inside the observed sea-surface temperatures
//     that condition represents. Cooling it again would be double counting --
//     which is also why the ocean cannot go cold here however far the
//     strength is pushed.
//
// A psychrometric wet-bulb form was tried first and rejected before shipping:
// the wet-bulb depression is LARGEST over deserts (the Sahara's is about
// 9.8 C against the Amazon's 6.3 C), so every multiplicative version of it
// cools the Sahara hard unless a surface-wetness factor is stacked on top --
// at which point it has more parameters than this and no better behaviour.
//
// THE COUPLING. Cooling lowers q_sat, which lowers the transport cap and the
// moisture, which lowers the cooling. That is a genuine fixed point, and it
// is solved by a few whole-pipeline passes rather than by a time integration:
// each pass recomputes humidity and moisture and then re-derives the
// temperature **from the uncooled base field**, never from the previous
// cooled one, so nothing can compound.

export const EVAPORATIVE_COOLING_PARAMETERS = {
  evaporativeCoolingC: {
    default: 0,
    kind: "empirical",
    search: false,
    min: 0,
    max: 20,
    note:
      "Maximum land cooling in C, approached as the air becomes very moist. 0 is OFF and " +
      "reproduces Stage 2 exactly. NOT fitted: the preview's 9 C was chosen so the wettest " +
      "regions land near their measured bias, and it is a preview value, not a calibration.",
  },
  evaporativeCoolingHalfGPerKg: {
    default: 12,
    kind: "empirical",
    search: false,
    min: 2,
    max: 30,
    note:
      "The specific humidity at which the cooling reaches half its maximum, in g/kg. " +
      "Sets where a desert stops and a rainforest starts on this model's own moisture scale.",
  },
};

/** The preview's ON value for `evaporativeCoolingC`. Kept here so the UI and
 * every tool turn it on to the same number. */
export const EVAPORATIVE_COOLING_PREVIEW_C = 9;

export function resolveEvaporativeCoolingParams(overrides = {}) {
  const values = {};
  for (const [name, spec] of Object.entries(EVAPORATIVE_COOLING_PARAMETERS)) values[name] = spec.default;
  const unknown = [];
  for (const [name, value] of Object.entries(overrides || {})) {
    if (name.startsWith("_")) continue;
    if (!(name in EVAPORATIVE_COOLING_PARAMETERS)) { unknown.push(name); continue; }
    if (!Number.isFinite(value)) throw new Error(`evaporative cooling parameter ${name} must be a finite number`);
    values[name] = value;
  }
  return { values, unknown };
}

/** The cooling at one cell, in C (<= 0). `qGPerKg` is grams per kilogram. */
export function evaporativeCoolingDeltaC(qGPerKg, { evaporativeCoolingC, evaporativeCoolingHalfGPerKg }) {
  if (!(evaporativeCoolingC > 0)) return 0;
  if (!(qGPerKg > 0)) return 0;
  const q2 = qGPerKg * qGPerKg;
  const h2 = evaporativeCoolingHalfGPerKg * evaporativeCoolingHalfGPerKg;
  return -evaporativeCoolingC * (q2 / (q2 + h2));
}

/**
 * A new temperature field with land cells cooled by the moisture field.
 * The input field is never mutated, and at strength 0 the SAME OBJECT is
 * returned, so an "off" run cannot differ even by a Float32 round trip.
 */
export function coolTemperatureField({ temperatureField, moistureField, terrainField, params }) {
  const { values } = resolveEvaporativeCoolingParams(params);
  if (!(values.evaporativeCoolingC > 0)) return temperatureField;

  const { width, height } = temperatureField;
  const mw = moistureField.width, mh = moistureField.height;
  const base = temperatureField.annualMeanTemperatureC;
  const out = new Float32Array(base.length);
  const isSea = terrainField.isSea;
  let maxCooling = 0;
  for (let y = 0; y < height; y++) {
    const my = Math.min(mh - 1, Math.floor((y * mh) / height));
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (isSea[i]) { out[i] = base[i]; continue; }
      const mx = Math.min(mw - 1, Math.floor((x * mw) / width));
      const q = moistureField.specificHumidityKgPerKg[my * mw + mx] * 1000;
      const d = evaporativeCoolingDeltaC(q, values);
      if (d < maxCooling) maxCooling = d;
      out[i] = base[i] + d;
    }
  }
  return { ...temperatureField, annualMeanTemperatureC: out, evaporativeCooling: { ...values, maxCoolingC: maxCooling } };
}
