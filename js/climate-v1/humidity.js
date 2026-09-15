// Climate v1's humidity thermodynamics -- stage 5A of the redesigned
// pipeline (terrain -> land/sea -> temperature -> wind -> **humidity
// capacity** -> transport -> ...). See docs/climate-v1-humidity-stage5a.md
// for the design comparison, the measured validation and the limits.
//
// ---------------------------------------------------------------------------
// WHAT THIS STAGE IS, AND WHAT IT IS NOT
//
// This module computes **saturation** specific humidity: the amount of
// water vapour a parcel of air *could* hold at a given temperature and
// pressure. It is a capacity, not a state.
//
// It is therefore **not a model of the real humidity distribution**, and
// nothing here should be read as one. The actual humidity of the air
// depends on where water evaporates, how the wind carries it, and where it
// rains out -- none of which exist in this stage. Those arrive in Stage 5B.
//
// The consequence for validation matters enough to state here rather than
// only in the document: comparing this module's q_sat against a q_sat
// recomputed from a reanalysis's own (T, p) tests **the formula, the units,
// the grid, the temperature input and the pressure approximation**. It does
// not measure climate-model skill, because there is no climate process in
// it to have skill. Any claim about reproducing real specific or relative
// humidity belongs to Stage 5B or later.
//
// ---------------------------------------------------------------------------
// FREE PARAMETERS: NONE.
//
// Deliberately. Every number below is either a physical constant supplied
// by the caller, a property of water, or a field an earlier stage already
// produced. There is no knob to turn, which means a validation failure
// here cannot be fitted away -- it has to be a real error in the formula,
// the units, the grid or an input field. That is the whole point of doing
// the thermodynamics before the transport.
//
// ---------------------------------------------------------------------------
// THE PHYSICS
//
// 1. Surface pressure, from the hydrostatic (barometric) relation:
//
//        p(z) = p0 * exp( -g * z / (R_d * T_layer) )
//
//    with T_layer the mean temperature of the air column between sea level
//    and the ground, in kelvin. Unlike Stage 4's geopotential formulation,
//    **gravity does not cancel here**, so `gravityMs2` is a genuinely
//    required input and is taken from the caller with no default.
//
//    The column's sea-level temperature is recovered by inverting the
//    temperature stage's own lapse-rate term exactly:
//
//        T_sealevel = T_surface + lapseRateCPerKm * z / 1000
//
//    so this pressure field and the temperature field it came from cannot
//    disagree about what the lapse rate is.
//
//    **Elevation is signed on land.** Ground below sea level (the Dead Sea
//    shore, the Turfan depression, the Qattara and Danakil depressions) is
//    genuinely under more atmosphere than sea level is, and really does sit
//    at more than p0. Clamping z at zero would have quietly made that
//    impossible. Sea cells take z = 0 exactly by definition -- they *are*
//    the reference surface -- so p = p0 there with no approximation error
//    at all. Note the temperature stage already uses the signed elevation
//    in the same way (js/climate.js's surfaceAnnualTemperatureC applies the
//    lapse rate to the signed value, so below-sea-level land is warmer),
//    which is what makes the inversion above exact rather than merely
//    plausible.
//
// 2. Saturation vapour pressure, from the Magnus/Tetens form:
//
//        e_s(T) = 6.112 hPa * exp( 17.67 * T / (T + 243.5) )   [T in Celsius]
//
//    These three coefficients describe **water**, not Earth -- they are a
//    property of the condensible substance and would be the same on any
//    planet whose air holds water vapour. They are exported as a named
//    constant rather than buried as literals so that this is visible.
//
//    This is the saturation vapour pressure **over liquid water**, used at
//    every temperature including below freezing. Over ice, saturation is
//    lower: the ice/water ratio is 0.95 at -5 C, 0.91 at -10 C, 0.82 at
//    -20 C and 0.68 at -40 C. So this module reads systematically high in
//    very cold places, by a known and predictable amount. Stated in advance
//    and measured rather than hidden; see the document.
//
// 3. Saturation specific humidity, from the definition:
//
//        q_sat = eps * e_s / (p - (1 - eps) * e_s)      [kg/kg]
//        eps   = R_d / R_v
//
//    `eps` is built from the caller's own two gas constants rather than
//    hardcoded at Earth's 0.622, so an atmosphere with a different
//    composition gets its own value.
//
// ---------------------------------------------------------------------------
// NOT IN THIS MODULE, ON PURPOSE
//
// No evaporation rate, no moisture source, no wind, no transport, no
// condensation, no UI. Earlier drafts of this stage carried a
// `seaSurfaceEvaporationRate = q_sat * efficiency` term; it was removed
// rather than renamed, because a real bulk evaporation rate is
// rho * C_E * |U| * (q_sat - q_air) in kg/m^2/s and needs both a wind speed
// and an air-side humidity, neither of which exists yet. Naming a quantity
// after units it does not have is exactly the mistake this pipeline exists
// to avoid.

/**
 * Magnus/Tetens coefficients for saturation vapour pressure over liquid
 * water. A property of water, not of any planet. The form and these
 * coefficients follow Bolton (1980); they are accurate to better than 0.3%
 * over roughly -35..+35 C, which covers every surface temperature this
 * pipeline produces.
 */
export const WATER_SATURATION_COEFFICIENTS = {
  referencePressureHPa: 6.112,
  scale: 17.67,
  offsetC: 243.5,
  phase: "liquid water",
  reference: "Bolton (1980), Mon. Wea. Rev. 108, 1046-1053",
};

/**
 * Saturation vapour pressure over liquid water, in hPa.
 * @param {number} temperatureC
 * @param {object} [coefficients] defaults to water
 */
export function saturationVapourPressureHPa(temperatureC, coefficients = WATER_SATURATION_COEFFICIENTS) {
  const { referencePressureHPa, scale, offsetC } = coefficients;
  return referencePressureHPa * Math.exp((scale * temperatureC) / (temperatureC + offsetC));
}

/**
 * Saturation specific humidity, in kg/kg.
 *
 * @param {number} saturationVapourHPa  e_s, in hPa
 * @param {number} pressureHPa          ambient pressure, in hPa (same unit as e_s -- the
 *                                      ratio is unit-free only if both agree)
 * @param {number} epsilon              R_d / R_v
 */
export function saturationSpecificHumidity(saturationVapourHPa, pressureHPa, epsilon) {
  return (epsilon * saturationVapourHPa) / (pressureHPa - (1 - epsilon) * saturationVapourHPa);
}

/**
 * Surface pressure from the hydrostatic relation, in hPa.
 *
 * `elevationMetres` is signed and used as given: this function does not
 * clamp it, so below-sea-level ground correctly returns more than
 * `seaLevelPressureHPa`.
 */
export function hydrostaticSurfacePressureHPa({
  elevationMetres,
  surfaceTemperatureC,
  lapseRateCPerKm,
  seaLevelPressureHPa,
  gravityMs2,
  specificGasConstantJPerKgK,
}) {
  // Invert the temperature stage's own lapse term to recover the column's
  // sea-level temperature, then use the column mean. For z = 0 this is
  // exactly the surface temperature and the exponent is exactly 0.
  const sealevelTemperatureC = surfaceTemperatureC + (lapseRateCPerKm * elevationMetres) / 1000;
  const layerTemperatureK = KELVIN_OFFSET + (sealevelTemperatureC + surfaceTemperatureC) / 2;
  return (
    seaLevelPressureHPa *
    Math.exp((-gravityMs2 * elevationMetres) / (specificGasConstantJPerKgK * layerTemperatureK))
  );
}

const KELVIN_OFFSET = 273.15;

/**
 * Build the Stage 5A humidity-capacity field over a whole world.
 *
 * Requires, with no defaults so that no Earth constant can hide in this
 * module:
 *   body        { gravityMs2 }
 *   atmosphere  { seaLevelPressureHPa, specificGasConstantJPerKgK,
 *                 vapourGasConstantJPerKgK }
 *
 * Returns Float32 grids on the terrain field's own resolution:
 *   surfacePressureHPa
 *   saturationVapourPressureHPa
 *   saturationSpecificHumidityKgPerKg
 */
export function buildHumidityField({
  terrainField,
  temperatureField,
  lapseRateCPerKm,
  body,
  atmosphere,
  saturationCoefficients = WATER_SATURATION_COEFFICIENTS,
}) {
  if (!terrainField) throw new Error("buildHumidityField requires a terrain field");
  if (!temperatureField) throw new Error("buildHumidityField requires a temperature field");
  if (!Number.isFinite(lapseRateCPerKm)) throw new Error("buildHumidityField requires a finite lapseRateCPerKm");
  if (!body || !Number.isFinite(body.gravityMs2)) {
    throw new Error("buildHumidityField requires body { gravityMs2 } -- gravity does not cancel in the pressure relation and has no default here");
  }
  if (
    !atmosphere ||
    !Number.isFinite(atmosphere.seaLevelPressureHPa) ||
    !Number.isFinite(atmosphere.specificGasConstantJPerKgK) ||
    !Number.isFinite(atmosphere.vapourGasConstantJPerKgK)
  ) {
    throw new Error(
      "buildHumidityField requires atmosphere { seaLevelPressureHPa, specificGasConstantJPerKgK, vapourGasConstantJPerKgK }"
    );
  }

  const { width, height, isSea, relativeElevationMetres } = terrainField;
  if (temperatureField.width !== width || temperatureField.height !== height) {
    throw new Error(
      `temperature field ${temperatureField.width}x${temperatureField.height} does not match terrain field ${width}x${height}`
    );
  }

  const { seaLevelPressureHPa, specificGasConstantJPerKgK, vapourGasConstantJPerKgK } = atmosphere;
  const { gravityMs2 } = body;
  const epsilon = specificGasConstantJPerKgK / vapourGasConstantJPerKgK;
  const temperatureC = temperatureField.annualMeanTemperatureC;

  const count = width * height;
  const surfacePressureHPa = new Float32Array(count);
  const vapourPressureHPa = new Float32Array(count);
  const specificHumidity = new Float32Array(count);

  // Where the atmosphere actually meets the surface. Stage 5A.6's
  // relativeSurfaceElevationMetres answers this directly -- 0 over ocean,
  // the lake's own level over a lake, the signed ground elevation on land --
  // which retires the sea special case below AND stops a lake's pressure
  // being computed at its bed. Before that field existed, Lake Baikal's
  // cells came out at 1163.7 hPa, as if a kilometre of extra atmosphere
  // filled the basin. Older terrain fields without it fall back to the sea
  // special case, which is exactly what this code used to do.
  const relativeSurface = terrainField.relativeSurfaceElevationMetres;

  for (let i = 0; i < count; i++) {
    const z = relativeSurface ? relativeSurface[i] : (isSea[i] ? 0 : relativeElevationMetres[i]);
    const tC = temperatureC[i];
    const p = hydrostaticSurfacePressureHPa({
      elevationMetres: z,
      surfaceTemperatureC: tC,
      lapseRateCPerKm,
      seaLevelPressureHPa,
      gravityMs2,
      specificGasConstantJPerKgK,
    });
    const es = saturationVapourPressureHPa(tC, saturationCoefficients);
    surfacePressureHPa[i] = p;
    vapourPressureHPa[i] = es;
    specificHumidity[i] = saturationSpecificHumidity(es, p, epsilon);
  }

  return {
    width,
    height,
    surfacePressureHPa,
    saturationVapourPressureHPa: vapourPressureHPa,
    saturationSpecificHumidityKgPerKg: specificHumidity,
    meta: {
      stage: "5A",
      quantity: "saturation (capacity), not actual humidity",
      epsilon,
      gravityMs2,
      seaLevelPressureHPa,
      specificGasConstantJPerKgK,
      vapourGasConstantJPerKgK,
      lapseRateCPerKm,
      saturationPhase: saturationCoefficients.phase,
      saturationReference: saturationCoefficients.reference,
      elevationHandling: "signed on land, exactly 0 on sea",
      freeParameters: 0,
    },
  };
}

export function sampleHumidityCell(field, index) {
  return {
    surfacePressureHPa: field.surfacePressureHPa[index],
    saturationVapourPressureHPa: field.saturationVapourPressureHPa[index],
    saturationSpecificHumidityKgPerKg: field.saturationSpecificHumidityKgPerKg[index],
  };
}

export function sampleHumidityAt(field, lng, lat) {
  const x = Math.min(field.width - 1, Math.max(0, Math.floor(((lng + 180) / 360) * field.width)));
  const y = Math.min(field.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * field.height)));
  return sampleHumidityCell(field, y * field.width + x);
}
