// Climate v1's own Earth temperature calibration, found in Stage 2 and
// adopted from Stage 4 onward for everything Climate v1 computes.
//
// **This is Climate v1 internal state and nothing else.** It is deliberately
// NOT in worlds/kasoku-sekai/config.json, NOT in Climate v0.8's `climate`
// block, and NOT read by anything the app draws -- Climate v0.8 keeps its
// own shipped parameters exactly as the user has already approved them on
// their phone. See docs/climate-v1-temperature-validation.md sections 11-12
// for how these two numbers were found (a small grid search on one half of
// a geographic checkerboard, verified on the held-out half) and what they
// bought: global temperature MAE 3.09 C -> 2.24 C, with every latitude band
// improving and none getting worse.
//
// `polarExtraC` is deliberately absent: the three-knob variant that also
// moved it scored marginally better globally but made one mid-latitude band
// slightly worse, and this two-knob set is the one with no regression
// anywhere. `meanTemperatureC` is absent because it is the user's own
// slider, not something to calibrate away.
export const CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION = {
  insolationSensitivityC: 80.68,
  oceanModeration: 0.818,
  // The effective *surface* lapse rate, separate from the free-air
  // `lapseRateCPerKm` (6.5), which is left exactly as it was.
  //
  // This is NOT a third calibration knob of the same kind as the two above:
  // 6.5 C/km is the free-atmosphere standard lapse rate and was never the
  // right quantity for "how much colder is the ground when it is higher".
  // Measured from Berkeley Earth over ice-free land, with latitude removed by
  // the model's own sea-level curve, the surface rate is 5.27 C/km and is flat
  // above 500 m, flat across latitude and flat across temperature -- so it
  // behaves like the single constant it is, not like a fit. 5.2 is adopted;
  // it was not re-fitted against the teacher. See
  // docs/climate-v1-surface-lapse-rate.md.
  surfaceLapseRateCPerKm: 5.2,
};

// The seasonal damping over water, separate from `seasonalDampingWPerM2K`
// (8) which stays the land value. EMPIRICAL, and an Earth calibration --
// not a universal planetary constant. lambda is dF/dT, and over water the
// latent term responds far more strongly than over land (unlimited supply,
// Clausius-Clapeyron), so lambda_ocean > lambda_land is a statement about
// surfaces rather than a fudge.
//
// What it buys, honestly, on the grid search's own fit set: ocean amplitude
// MAE 1.60 -> 1.56 C (2.5%), ocean phase MAE 12.7 -> 11.8 d (7%), and the
// real effect -- ocean phase bias +5.3 -> +1.3 d. The land side is exactly
// unchanged. See docs/climate-v1-ocean-damping-split.md.
export const CLIMATE_V1_EARTH_SEASON_CALIBRATION = {
  oceanSeasonalDampingWPerM2K: 10,
};

// The season module takes its own parameter object, so -- unlike the three
// values above, which are spread into the *climate* params on their way to
// `buildTemperatureField` -- an ocean damping written here would never reach
// `buildSeasonalTemperatureTable` on its own. This is the one place that
// carries it across; call it with `SEASON_PARAMETERS` wherever Climate v1
// builds Earth's season table. (The season module is deliberately not
// imported here: this file must stay a leaf that anything can read.)
export function climateV1SeasonParams(seasonParameters) {
  return { ...seasonParameters, ...CLIMATE_V1_EARTH_SEASON_CALIBRATION };
}
