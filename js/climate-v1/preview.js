// Climate v1's "touchable preview": the whole pipeline in one call, with the
// experimental evaporative cooling switchable on or off.
//
// This is the first Climate v1 module the app itself imports. Everything it
// runs already existed and is unchanged; this file only wires the stages
// together and solves the one loop the cooling introduces.
//
// AT `evaporativeCoolingC = 0` IT IS EXACTLY STAGE 2 + 5A + 5B. The cooling
// pass returns the same object it was given, so not even a Float32 round trip
// happens, and the loop stops after one iteration because there is nothing to
// converge.
import { buildTemperatureField } from "./temperature.js";
import { buildHumidityField } from "./humidity.js";
import { buildClimateV1Wind } from "./wind.js";
import { buildMoistureField, WIND_MODES } from "./moisture.js";
import { coolTemperatureField, resolveEvaporativeCoolingParams } from "./evaporative-cooling.js";

export const PREVIEW_GRID = { width: 256, height: 128 };
export const PREVIEW_ATMOSPHERE = {
  seaLevelPressureHPa: 1013.25,
  specificGasConstantJPerKgK: 287.05,
  vapourGasConstantJPerKgK: 461.52,
};
export const PREVIEW_WIND_ATMOSPHERE = {
  specificGasConstantJPerKgK: 287,
  surfacePressureHPa: 1000,
  levelPressureHPa: 850,
};
export const PREVIEW_WIND_PARAMS = {
  thermalResponseStrength: 1, dragTimescaleDays: 0.5, thermalSmoothingKm: 1500,
};

/**
 * Runs terrain -> temperature -> humidity -> wind -> moisture, iterating only
 * when the cooling is on.
 *
 * The wind is built ONCE, from the uncooled temperature field, and reused
 * across passes. That is a deliberate preview simplification and it is stated
 * rather than hidden: recomputing the pressure-gradient wind every pass would
 * roughly double the cost for a field that a few degrees of tropical land
 * cooling barely moves, and the wind model is frozen anyway.
 */
export function buildClimateV1Preview({
  terrainField, body, params, gravityMs2 = 9.80665,
  evaporativeCooling = {},
  // An observed-wind oracle, for the preview's 観測風 option. When absent the
  // model's own frozen Stage 4 wind is built and used, which is the
  // production path. The oracle is a DIAGNOSTIC and never the wind model.
  oracleWind = null,
  grid = PREVIEW_GRID,
  maxPasses = 6,
  convergenceC = 0.05,
  moistureOptions = {},
}) {
  const { values: cooling } = resolveEvaporativeCoolingParams(evaporativeCooling);
  const on = cooling.evaporativeCoolingC > 0;

  const baseTemperature = buildTemperatureField({
    terrainField, axialTiltDegrees: body.axialTiltDegrees, params,
  });
  const wind = oracleWind || buildClimateV1Wind({
    terrainField, temperatureField: baseTemperature, lapseRateCPerKm: params.lapseRateCPerKm,
    body, atmosphere: PREVIEW_WIND_ATMOSPHERE, params: PREVIEW_WIND_PARAMS,
    width: grid.width, height: grid.height,
  });

  let temperatureField = baseTemperature;
  let humidityField = null, moistureField = null;
  let passes = 0, residualC = 0;
  for (let pass = 0; pass < (on ? maxPasses : 1); pass++) {
    humidityField = buildHumidityField({
      terrainField, temperatureField, lapseRateCPerKm: params.lapseRateCPerKm,
      body: { gravityMs2 }, atmosphere: PREVIEW_ATMOSPHERE,
    });
    moistureField = buildMoistureField({
      terrainField, temperatureField, humidityField, wind,
      windMode: WIND_MODES.PHYSICAL, body, ...moistureOptions,
    });
    passes = pass + 1;
    if (!on) break;
    // Always re-derived from the UNCOOLED base, so nothing compounds.
    const next = coolTemperatureField({ temperatureField: baseTemperature, moistureField, terrainField, params: cooling });
    residualC = 0;
    const a = next.annualMeanTemperatureC, b = temperatureField.annualMeanTemperatureC;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > residualC) residualC = d;
    }
    temperatureField = next;
    if (residualC < convergenceC) break;
  }

  return {
    terrainField, baseTemperature, temperatureField, humidityField, moistureField, wind,
    windSource: oracleWind ? "observed" : "model",
    evaporativeCooling: { ...cooling, on, passes, residualC, converged: !on || residualC < convergenceC },
  };
}
