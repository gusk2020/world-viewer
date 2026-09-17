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
