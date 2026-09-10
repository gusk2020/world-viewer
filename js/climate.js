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

  seasonalSensitivityC: {
    value: 45, kind: "empirical", min: 0, max: 120,
    note:
      "Degrees a latitude departs from its own annual mean at the solstices, " +
      "per unit of seasonal insolation anomaly. Stage 7.5-A: the annual mean " +
      "alone cannot say whether snow survives the summer or whether a monsoon " +
      "reverses, and both turned out to matter more than any parameter did. " +
      "At 0 every downstream formula reduces exactly to the annual model.",
  },
  seaSeasonalDamping: {
    value: 0.25, kind: "empirical", min: 0, max: 1,
    note:
      "How much of that seasonal swing the sea keeps. Water's heat capacity " +
      "is enormous next to a rock surface, so a coast swings far less than an " +
      "interior -- and the *difference* between the two is what drives a " +
      "monsoon, so this one number does double duty.",
  },
  itczFollowFraction: {
    value: 0.6, kind: "empirical", min: 0, max: 1.5,
    note:
      "How far the circulation cells follow the sub-solar latitude into the " +
      "summer hemisphere, as a fraction of the axial tilt. Stage 7.5-B: this " +
      "is the seasonal part of the *wind*, and it is what puts a rain belt " +
      "over land that the annual-mean position never reaches. Derived from " +
      "the tilt rather than set in degrees, so it means the same thing on a " +
      "body tilted 6 degrees and one tilted 80.",
  },
  monsoonStrength: {
    value: 1.2, kind: "empirical", min: 0, max: 4,
    note:
      "How strongly the land/sea heating contrast pulls moist air inland in " +
      "the warm season -- and pushes it back out in the cold one. Scaled by " +
      "each row's own seasonal swing and by how much less the sea swings, so " +
      "it is nil at the equator, nil on a world with no tilt, and nil if the " +
      "sea and the land respond alike.",
  },
  // ---- Longitude-dependent ITCZ (this experiment) -------------------------
  //
  // Everything above this point makes the atmosphere a function of latitude
  // alone: at a given latitude the whole planet gets the same cell structure,
  // the same wind and the same rain belt. The diagnosis after Stage 7.5
  // measured what that costs -- a table that memorises the teacher by
  // latitude alone scores 62.86% where the whole model scores 63.37%, and
  // 70.6% of what the teacher varies by within one latitude band is variation
  // this model cannot express at all.
  //
  // These four give the rain belt a longitude, from one general principle and
  // no geography: **the belt is drawn toward the warmer surface, and land
  // changes temperature with the seasons far more than sea does.** So a
  // longitude backed by a lot of seasonally-swinging land pulls the belt into
  // its own summer hemisphere and pushes it away in winter; a longitude that
  // is all ocean does neither and keeps the zonal answer. Longitude itself is
  // never an input -- only what happens to be at that longitude.
  itczLandPullDeg: {
    value: 0, kind: "empirical", min: 0, max: 30,
    note:
      "How far, in degrees of latitude, a longitude entirely backed by " +
      "seasonally swinging land pulls the rain belt toward its own summer " +
      "hemisphere. 0 switches the whole mechanism off and reproduces the " +
      "purely zonal model exactly, which is the default so that every set " +
      "saved before this existed keeps drawing what it always drew.",
  },
  itczPullRangeDeg: {
    value: 30, kind: "empirical", min: 5, max: 60,
    note:
      "How far from the belt's zonal position land is still felt, as the " +
      "half-width of a Gaussian window in degrees of latitude. Wide enough " +
      "and a whole continent counts; narrow enough and only the coast does.",
  },
  itczSmoothDeg: {
    value: 20, kind: "empirical", min: 2, max: 60,
    note:
      "How far the belt's displacement is smoothed along longitude. The " +
      "atmosphere cannot put a step in the rain belt at a coastline, and a " +
      "raw land count does exactly that, so this is a physical smoothing " +
      "rather than a cosmetic one. Wraps at the antimeridian.",
  },
  itczElevationPullM: {
    value: 6000, kind: "empirical", min: 1000, max: 40000,
    note:
      "How much high ground adds to that pull, as the height at which land " +
      "counts double. Thin air over a plateau heats and cools faster than " +
      "the lowland beside it, so a high continent swings the belt further. " +
      "At the top of its range this is effectively off.",
  },

  // ---- Snow and ice as a year's budget (this experiment) ------------------
  //
  // The snow rule above this asks one question of one moment: is the warmest
  // season above a threshold. Measured, that is why a physically real season
  // destroys the ice -- the fitted threshold sits at -11.8 C, which only ever
  // meant "cold enough given that this model has almost no summer", and
  // raising seasonalSensitivityC to 25 lifts the warm season by 10-24 C and
  // walks every ice sheet straight over it (land-ice agreement 79.3% -> 8.8%,
  // and the model keeps only 0.29% of the globe iced against the teacher's
  // 3.33%).
  //
  // These four ask a year instead: snow falls while the surface is below
  // freezing and there is moisture to fall, melt removes it in proportion to
  // how far and how long the year runs above freezing, and permanent ice is
  // what is left over. Both halves come from the same two seasons already
  // computed, integrated analytically over a sinusoidal year -- so a short
  // fierce summer removes far less than a long mild one, which is exactly the
  // saturation a single warm-season snapshot cannot express.
  snowBalanceWeight: {
    value: 0, kind: "empirical", min: 0, max: 1,
    note:
      "How much of the snow decision comes from the year's budget rather than " +
      "the warm-season threshold above. 0 is the threshold alone and " +
      "reproduces the shipped model exactly, which is the default so that " +
      "every set saved before this keeps drawing what it drew.",
  },
  snowMeltDegreeDay: {
    value: 0.06, kind: "empirical", min: 0, max: 1,
    note:
      "How much snow one degree of year-mean warmth above freezing removes, " +
      "against an accumulation of 1 for a year spent wholly frozen and wholly " +
      "moist. The degree-day factor of a real mass balance, in this model's " +
      "own arbitrary snow units rather than millimetres.",
  },
  snowBalanceRequiredM: {
    value: 0.1, kind: "empirical", min: -0.5, max: 1,
    note:
      "How much net accumulation a place needs before it holds ice all year. " +
      "Above zero because a real surface also loses snow to wind and to " +
      "sublimation, neither of which this model has, and because one grid " +
      "cell 20 km across is not glaciated the moment its average balance " +
      "turns positive.",
  },
  snowBalanceWidth: {
    value: 0.15, kind: "empirical", min: 0.02, max: 1, search: false,
    note:
      "How softly that crossing is made, in the same snow units. The ice edge " +
      "is a gradient on the ground and the user asked for gradients rather " +
      "than steps, so this is floored well above zero -- and kept out of the " +
      "search for the reason Stage 7 recorded for the other blend widths: a " +
      "class resolved to one label per pixel flips exactly at the centre of " +
      "the ramp whatever its width, so the reported score is measurably, " +
      "identically blind to this (0.05 and 0.50 give the same figure to every " +
      "decimal). A search given it would be fitting noise, and what it would " +
      "actually control -- how hard the ice edge looks -- nothing scores.",
  },

  // ---- Sea ice as a year's budget (this experiment) ------------------------
  //
  // The rule above this asks the same single-moment question the old land
  // snow rule did, just of the sea instead: is the warm season above a
  // threshold. Measured, it fails the identical way -- at seasonalSensitivityC
  // = 25 the warm-season sea-surface temperature at the Arctic Ocean's centre
  // rises to +2.3 C, past the threshold everywhere on Earth, and sea ice goes
  // to exactly 0% (from an already-fitted 53.7% IoU at the shipped season).
  //
  // This asks a year instead, the same way land snow now does -- ice forms
  // while the sea is below its own freezing point and melts in proportion to
  // how far and how long the year runs above it -- but it is not land snow's
  // formula reused: sea ice needs no moisture term, because seawater below
  // freezing simply freezes, with no supply to run short of the way snowfall
  // can. See seaIceYearBudget for the shared geometry and what each caller
  // does differently with it.
  seaIceBalanceWeight: {
    value: 0, kind: "empirical", min: 0, max: 1,
    note:
      "How much of the sea-ice decision comes from the year's budget rather " +
      "than the warm-season threshold above. 0 is the threshold alone and " +
      "reproduces the shipped model exactly, which is the default so that " +
      "every set saved before this keeps drawing what it drew.",
  },
  seaIceMeltDegreeDay: {
    value: 0.12, kind: "empirical", min: 0, max: 1,
    note:
      "How much sea ice one degree of year-mean warmth above the sea's " +
      "freezing point removes, against an accumulation of 1 for a year spent " +
      "wholly below freezing. Not the same number as snowMeltDegreeDay -- the " +
      "two balances are in different units -- even though it plays the same " +
      "role in the same formula shape.",
  },
  seaIceBalanceRequired: {
    value: 0.27, kind: "empirical", min: -0.5, max: 1,
    note:
      "How much net freezing a stretch of sea needs before ice survives on it " +
      "all year (perennial ice). Above zero for the same reason as the land " +
      "value: a real ice pack also loses mass to currents, ridging and export " +
      "this model has none of, and a 20 km cell is not permanently iced the " +
      "moment its average balance turns positive.",
  },
  seaIceBalanceWidth: {
    value: 0.15, kind: "empirical", min: 0.02, max: 1, search: false,
    note:
      "How softly that crossing is made. Kept out of the search for the same " +
      "reason as snowBalanceWidth: a class resolved to one label per pixel " +
      "flips at the centre of the ramp whatever its width, so the reported " +
      "score cannot see this, only how hard the ice edge looks.",
  },

  growingSeasonWeight: {
    value: 0.7, kind: "empirical", min: 0, max: 1,
    note:
      "How much plant cover depends on the warm season's moisture rather " +
      "than the cold season's. A monsoon climate is wet in one season and dry " +
      "in the other, and it is the wet one that grows the forest; at 0.5 this " +
      "is a plain annual average again.",
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
  orographicLiftM: {
    value: 700, kind: "empirical", min: 100, max: 4000,
    note:
      "Height of ascent that gives a windward slope its full extra rain. " +
      "Stage 7.5-C: the sweep's climb term already removes moisture going up " +
      "a mountain, but nothing was *adding* it to the slope that forced the " +
      "air up in the first place, which is half of what a rain shadow is.",
  },
  rainShadowM: {
    value: 1200, kind: "empirical", min: 100, max: 5000,
    note:
      "Height of an upwind barrier that dries the ground behind it by about " +
      "63%. Measured by walking a fixed distance upwind and taking the " +
      "highest ground on the way, so it works for any range on any world -- " +
      "the Andes, a fictional cordillera, or nothing at all.",
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

  snowSummerMeltC: {
    value: 2, kind: "empirical", min: -15, max: 15,
    note:
      "How far above freezing the *warm season* mean may sit and still leave " +
      "snow lying all year. Stage 7.5-D, and it **replaces** " +
      "`permanentSnowOffsetC`, which was an annual-mean fudge standing in for " +
      "exactly this: with no seasons, everywhere averaging below zero painted " +
      "solid white, which put all of Siberia under permanent ice. Now the " +
      "question is asked directly -- does the melt season melt it -- which is " +
      "what actually decides a snow line, and it is why a 5000 m plateau can " +
      "hold ice at a latitude where the lowland is forest. A set still naming " +
      "the old parameter loads: it is reported and skipped.",
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

// The two seasons, as the daily-mean insolation at each solstice.
//
// Stage 7.5-A. The user asked for "at least a warm season and a cold season",
// with the seasonal swing growing with latitude and with the axial tilt, and
// explicitly said a full insolation calculation was not required. It is done
// properly anyway, because the annual version already exists here and running
// it at two orbital positions instead of averaging over the year costs the
// same few thousand evaluations. Doing it from the geometry rather than from a
// fitted "seasons are bigger at high latitudes" curve is what makes it work
// unchanged on a world tilted 80 degrees, or on the Moon at 6.7.
//
// Each latitude gets its *own* warm and cold season -- the maximum and minimum
// of the two solstices -- so the northern and southern hemispheres are warm at
// opposite times, as they should be. The fields this produces are therefore a
// composite of two moments in the year rather than one; that is deliberate and
// it is exactly what "what is the growing season like here" needs.
//
// `orbit` is the seam for eccentricity later: a real orbit varies the distance
// to the star, so each solstice's insolation would be scaled by 1/r². With a
// circular orbit both scales are 1 and this reduces to the geometry alone.
export function seasonalInsolationByLatitude(
  latitudesRad, tiltDegrees, orbit = { eccentricity: 0, perihelionDeg: 90 }
) {
  const tilt = (tiltDegrees * Math.PI) / 180;
  const warm = new Float64Array(latitudesRad.length);
  const cold = new Float64Array(latitudesRad.length);
  const eccentricity = orbit && Number.isFinite(orbit.eccentricity) ? orbit.eccentricity : 0;
  const perihelion = ((orbit && orbit.perihelionDeg) || 0) * (Math.PI / 180);

  // Daily-mean insolation at one declination, the same formula the annual
  // integral uses one step at a time.
  const daily = (lat, declination, scale) => {
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinDec = Math.sin(declination);
    const cosDec = Math.cos(declination);
    const cosH = Math.min(1, Math.max(-1, -Math.tan(lat) * Math.tan(declination)));
    const h = Math.acos(cosH);
    return (scale * (h * sinLat * sinDec + cosLat * cosDec * Math.sin(h))) / Math.PI;
  };

  // Inverse-square distance at each solstice. Zero eccentricity gives 1 and 1.
  const distanceScale = (lambda) => {
    const r = (1 - eccentricity * eccentricity) / (1 + eccentricity * Math.cos(lambda - perihelion));
    return 1 / (r * r);
  };
  const scaleNorth = distanceScale(Math.PI / 2);
  const scaleSouth = distanceScale((3 * Math.PI) / 2);

  for (let i = 0; i < latitudesRad.length; i++) {
    const lat = latitudesRad[i];
    const a = daily(lat, tilt, scaleNorth);
    const b = daily(lat, -tilt, scaleSouth);
    warm[i] = Math.max(a, b);
    cold[i] = Math.min(a, b);
  }
  return { warm, cold };
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
export function windField(rows, dayLengthHours, rotationDirection, params, subsolarDeg = 0) {
  const direction = rotationDirection >= 0 ? 1 : -1;
  const spin = (direction * REFERENCE_DAY_HOURS) / Math.max(Math.abs(dayLengthHours), 1e-3);
  const cellEdgeDeg = Math.min(
    90,
    params.circulationCellEdgeDeg / Math.max(Math.abs(spin), 1e-3) ** params.cellRotationExponent
  );

  const east = new Float64Array(rows);
  const north = new Float64Array(rows);
  const convergence = new Float64Array(rows);
  // How far this row sits from the belt's own zonal position, in degrees.
  // Carried out so the longitude term can displace it per column without
  // having to re-derive the sub-solar latitude, and so that a displacement of
  // zero reproduces this function's own numbers exactly.
  const offsetDeg = new Float64Array(rows);
  for (let y = 0; y < rows; y++) {
    const latDeg = (0.5 - (y + 0.5) / rows) * 180;
    const latRad = (latDeg * Math.PI) / 180;
    // Stage 7.5-B. The whole cell structure hangs off the sub-solar latitude,
    // so giving it a season shifts the rising branch into the summer
    // hemisphere and takes the sinking branch with it. A hemisphere's own
    // summer therefore has its rain belt further poleward than the annual
    // mean ever puts it -- which is the largest single reason an annual-mean
    // model cannot make a monsoon. Zero reproduces the annual field exactly.
    offsetDeg[y] = latDeg - subsolarDeg;
    const phase = (Math.PI * (latDeg - subsolarDeg)) / cellEdgeDeg;
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
  return { rows, spin, cellEdgeDeg, east, north, convergence, offsetDeg };
}

// A circular Gaussian blur along longitude. Separate because the belt's
// displacement has to be continuous across the antimeridian -- the globe has
// no edge there, and a filter that treated the array as a line would leave a
// seam down the Pacific exactly like the texture one the cube-sphere had to
// fix.
function smoothCircular(values, width, sigmaColumns) {
  const sigma = Math.max(0.5, sigmaColumns);
  const radius = Math.min(Math.floor(width / 2), Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let total = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + radius] = w;
    total += w;
  }
  const out = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      sum += kernel[k + radius] * values[(((x + k) % width) + width) % width];
    }
    out[x] = sum / total;
  }
  return out;
}

// The seasonal swing this mechanism is measured against, in degrees. It is a
// unit, not a fitted number: the displacement is expressed as a fraction of
// "a thoroughly seasonal surface", and this says how large that is. Same role
// REFERENCE_DAY_HOURS plays for the spin, and picked the same way -- from a
// real mid-latitude land swing, so Earth lands in the middle of the curve
// rather than at either end of it.
const ITCZ_SEASON_REFERENCE_C = 20;

/**
 * How far the rain belt is displaced from its zonal position, per longitude.
 *
 * One principle, applied without any knowledge of where anything is: **the
 * belt is drawn toward the warmer surface, and only land changes temperature
 * with the seasons.** So for each column, weigh the land near the belt --
 * more heavily the closer it is, the more that latitude's own temperature
 * swings through the year, and the higher it stands -- and pull the belt that
 * many degrees into whichever hemisphere is having its summer.
 *
 * Three properties fall out of writing it this way rather than as a table:
 *
 *   * A longitude with no land does not move at all, so an ocean world, and
 *     the mid-Pacific, keep the zonal answer.
 *   * A world with no axial tilt has no seasonal swing anywhere, so the whole
 *     term is zero and the model reduces exactly to what it was.
 *   * Nothing here reads a longitude, a coordinate range or a place. Move the
 *     continents and the belt moves with them.
 */
export function itczShiftByColumn({
  isSea, landHeight, width, height, lat0Deg, seasonSign, seasonWeight, maxSwingC, params,
}) {
  const out = new Float64Array(width);
  const amplitude = params.itczLandPullDeg;
  if (!(amplitude > 0)) return out; // switched off: exactly the zonal model

  // How seasonal this world is at all, saturating -- a world that swings 40 C
  // is not twice the monsoon of one that swings 20.
  const season = Math.tanh(Math.max(0, maxSwingC) / ITCZ_SEASON_REFERENCE_C);
  if (!(season > 0)) return out;

  const range = Math.max(1, params.itczPullRangeDeg);
  const rowWeight = new Float64Array(height);
  let norm = 0;
  for (let y = 0; y < height; y++) {
    const latDeg = (0.5 - (y + 0.5) / height) * 180;
    const d = (latDeg - lat0Deg) / range;
    if (Math.abs(d) > 3) continue; // outside the window the weight is under 1e-4
    const near = Math.exp(-d * d);
    // Multiplied by this row's own share of the seasonal swing, so tropical
    // land -- which barely has a season -- pulls far less than the
    // mid-latitude interior that actually drives a monsoon. The same weight
    // is what the total is divided by, so what comes out is the *land
    // fraction* of the window that can actually heat and cool: 1 for a
    // longitude backed entirely by seasonal land, 0 for open ocean. How
    // seasonal the world is at all is already carried by `season` above, and
    // counting it twice is what made the first version of this term far too
    // weak to measure.
    rowWeight[y] = near * (seasonWeight ? seasonWeight[y] : 0);
    norm += rowWeight[y];
  }
  if (!(norm > 0)) return out;

  const raw = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    const w = rowWeight[y];
    if (!(w > 0)) continue;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (isSea[row + x]) continue;
      raw[x] += w * (1 + landHeight[row + x] / params.itczElevationPullM);
    }
  }
  for (let x = 0; x < width; x++) raw[x] = Math.min(2, raw[x] / norm);

  const smooth = smoothCircular(raw, width, (params.itczSmoothDeg * width) / 360);
  const scale = amplitude * season * (seasonSign >= 0 ? 1 : -1);
  for (let x = 0; x < width; x++) out[x] = scale * smooth[x];
  return out;
}

// How much moisture a sea gives up, per latitude row. A sea's temperature is
// the moderated profile `classifyPoint` already uses for open water, so this
// costs nothing beyond the smoothstep.
function evaporationByRow(seaLevelC, profileRows, rows, params, seasonDeltaC = null) {
  const out = new Float64Array(rows);
  for (let y = 0; y < rows; y++) {
    const p = Math.min(profileRows - 1, Math.floor((y * profileRows) / rows));
    const t = seaLevelC[p];
    // A warm sea gives up more moisture than a cold one, and a sea is warmer
    // in its own summer -- so the season reaches the moisture supply too, not
    // only the temperature the ground is judged at.
    const season = seasonDeltaC ? params.seaSeasonalDamping * seasonDeltaC[p] : 0;
    const temperature =
      params.meanTemperatureC + params.oceanModeration * (t - params.meanTemperatureC) + season;
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
// How many cells upwind the barrier scan looks. On a 512-wide grid that is
// roughly 6000 km at the equator and less toward the poles -- far enough to
// find a range the air had to cross, short enough that the far side of a
// continent is not blamed for it. A convergence setting, not a world property.
const RAIN_SHADOW_STEPS = 8;

function moistureField({
  isSea, landHeight, width, height, radiusMetres, wind, evaporation, still, params,
  monsoon = 0, seasonWeight = null, shift = null,
}) {
  const stepYKm = (Math.PI * radiusMetres) / height / 1000;

  // Stage 7.5-B. How far moisture rides the wind, per row and per season.
  //
  // **This is attached to the wind-carried moisture on purpose, and the first
  // version had it on the isotropic term instead -- which was the whole
  // difficulty.** Measured then: every setting that lifted Indochina from 30%
  // vegetated toward the teacher's 78% lifted the Sahara from 11% to 88% with
  // it, because an isotropic term reaches a desert exactly as readily as a
  // monsoon coast and latitude alone cannot tell the two apart. What tells
  // them apart is *where the sea is relative to the seasonal wind*, and only
  // the advection sweep knows that. So the warm season's converging air
  // carries moisture further inland and the cold season's subsiding air
  // carries it less far, and a coast whose summer wind comes off a warm sea
  // gets the benefit while a desert whose summer wind comes off a continent
  // does not.
  const rowDecay = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const reach = seasonWeight
      ? Math.max(0.05, 1 + params.monsoonStrength * monsoon * seasonWeight[y])
      : 1;
    rowDecay[y] = Math.exp(-stepYKm / (params.advectionRangeKm * reach));
  }

  const rowA = new Int32Array(height);
  const rowB = new Int32Array(height);
  const offX = new Int32Array(height);
  const fx = new Float64Array(height);
  const fy = new Float64Array(height);
  const moving = new Uint8Array(height);
  // The whole-cell part of the upwind step, kept so the barrier scan below can
  // walk several cells against the wind instead of only sampling one.
  const stepRowY = new Int32Array(height);

  // One row's upwind step, from a wind vector. Written once and called for
  // both the row's own direction and its reverse, because a longitude-shifted
  // belt puts some columns of a row on the other side of it -- which is the
  // wind reversing, and is most of what a monsoon is.
  const fillDirection = (set, y, eastV, northV) => {
    const latRad = (0.5 - (y + 0.5) / height) * Math.PI;
    const stepXKm =
      ((2 * Math.PI * radiusMetres) / width / 1000) * Math.max(Math.cos(latRad), 1e-3);
    const speed = Math.hypot(eastV, northV);
    if (!(speed > 1e-6)) {
      // Dead calm -- at the equator, at a cell boundary, or on a body with no
      // spin worth the name. Nothing is carried; the still-air term below is
      // all such a row gets.
      set.moving[y] = 0;
      set.rowA[y] = y * width;
      set.rowB[y] = y * width;
      return;
    }
    set.moving[y] = 1;
    // Upwind is one meridional grid step *against* the flow.
    let dx = (-(eastV / speed) * stepYKm) / stepXKm;
    dx = Math.min(MAX_OFFSET_CELLS, Math.max(-MAX_OFFSET_CELLS, dx));
    const dy = northV / speed; // y grows southward, so poleward flow reads back equatorward
    const ix = Math.floor(dx);
    const iy = Math.floor(dy);
    set.offX[y] = ix;
    set.stepRowY[y] = iy;
    set.fx[y] = dx - ix;
    set.fy[y] = dy - iy;
    set.rowA[y] = Math.min(height - 1, Math.max(0, y + iy)) * width;
    set.rowB[y] = Math.min(height - 1, Math.max(0, y + iy + 1)) * width;
  };

  const base = { rowA, rowB, offX, fx, fy, moving, stepRowY };
  for (let y = 0; y < height; y++) fillDirection(base, y, wind.east[y], wind.north[y]);

  // The longitude-dependent belt. `shift` says how far the rain belt is
  // displaced at each column (see itczShiftByColumn); everything below is the
  // consequence of that displacement, and with no shift none of it is built
  // and every loop takes exactly the path it took before this existed.
  //
  // Two things follow from moving the belt at one longitude and not another:
  // the rising and sinking air moves with it, and -- where the belt crosses a
  // row -- the low-level flow at that column is now on the other side of it
  // and therefore blows the other way. The second is the one that matters:
  // it is what turns a trade wind blowing off a continent into a wind blowing
  // off the sea, which is a monsoon.
  let sel = null; // per cell: 0 = this row's own direction, 1 = the reverse
  let beltCell = null; // per cell: the local convergence
  let rev = null;
  if (shift) {
    const cellEdge = wind.cellEdgeDeg;
    rev = {
      rowA: new Int32Array(height), rowB: new Int32Array(height),
      offX: new Int32Array(height), fx: new Float64Array(height),
      fy: new Float64Array(height), moving: new Uint8Array(height),
      stepRowY: new Int32Array(height),
    };
    for (let y = 0; y < height; y++) fillDirection(rev, y, -wind.east[y], -wind.north[y]);
    sel = new Uint8Array(width * height);
    beltCell = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      // Northern rows carry their own hemisphere's summer and southern rows
      // theirs, exactly as the wind field itself is assembled in
      // computeClimate -- the two must agree or the belt and the wind would
      // be describing different times of year.
      const shiftRow = y < height / 2 ? shift.north : shift.south;
      const offset = wind.offsetDeg[y];
      const flowBase = -Math.sin((Math.PI * offset) / cellEdge);
      for (let x = 0; x < width; x++) {
        // The displacement is applied to the rising branch and fades to
        // nothing by the cell's own edge, rather than sliding the whole cell
        // bodily poleward.
        //
        // Measured, and this is why it is here: with the whole cell moving,
        // pushing the belt 14 degrees north over Africa took the subsiding
        // branch from 28 to 42 degrees with it and doubled the Sahara's
        // summer moisture (0.275 to 0.570) -- the model wetting the largest
        // desert on the planet, for the same reason Stage 7.5's first
        // monsoon attempt did. A real overturning cell does not work that
        // way: its rising branch migrates a long way with the sun while its
        // poleward edge, set by the rotation, barely moves. Tapering by
        // cos^2 across the cell reproduces that with no new parameter, and
        // the clamp below keeps the map from latitude to phase monotonic
        // (beyond 2*edge/pi the taper would fold two belts into one row).
        const limit = (2 * cellEdge) / Math.PI;
        const raw = Math.max(-limit, Math.min(limit, shiftRow[x]));
        const t = Math.abs(offset) >= cellEdge
          ? 0
          : Math.cos((Math.PI * offset) / (2 * cellEdge)) ** 2;
        const phase = (Math.PI * (offset - raw * t)) / cellEdge;
        beltCell[row + x] = Math.cos(phase);
        sel[row + x] = -Math.sin(phase) * flowBase < 0 ? 1 : 0;
      }
    }
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
    const row = y * width;
    if (!sel) {
      if (!moving[y]) continue;
      const a = rowA[y], b = rowB[y], ox = offX[y], tx = fx[y], ty = fy[y];
      for (let x = 0; x < width; x++) {
        const rise = Math.max(0, landHeight[row + x] - sampleRow(landHeight, a, b, ox, tx, ty, x));
        transmission[row + x] = rowDecay[y] * Math.exp(-rise / params.orographicRiseM);
      }
      continue;
    }
    for (let x = 0; x < width; x++) {
      const set = sel[row + x] ? rev : base;
      if (!set.moving[y]) continue;
      const rise = Math.max(
        0,
        landHeight[row + x]
          - sampleRow(landHeight, set.rowA[y], set.rowB[y], set.offX[y], set.fx[y], set.fy[y], x)
      );
      transmission[row + x] = rowDecay[y] * Math.exp(-rise / params.orographicRiseM);
    }
  }

  // Stage 7.5-C: the terrain the air had to cross to get here.
  //
  // The transmission factor above already takes moisture out of air climbing
  // one cell. What it cannot see is a range the parcel crossed several cells
  // back and has since come down from -- and that descent is most of what a
  // rain shadow is. So this walks a fixed distance upwind, keeps the highest
  // ground on the way, and dries the cell by how far it stands below it. The
  // windward half is the same scan read the other way: ground that rises out
  // of the cell upwind of it is where the air was forced up, and it gets the
  // extra rain that the lee is missing.
  //
  // It is affordable for exactly the reason the sweep is: the wind is constant
  // across a row, so every offset here is a per-row constant and the scan is
  // eight reads per cell rather than a search.
  // The path upwind is the same for every cell in a row that shares its wind
  // direction, so its row and column offsets are worked out once per row per
  // direction rather than per cell.
  const walkPath = (set, y) => {
    const pathRow = new Int32Array(RAIN_SHADOW_STEPS);
    const pathCol = new Int32Array(RAIN_SHADOW_STEPS);
    let cursorY = y;
    let cursorX = 0;
    for (let step = 0; step < RAIN_SHADOW_STEPS; step++) {
      cursorX += set.offX[cursorY];
      cursorY = Math.min(height - 1, Math.max(0, cursorY + set.stepRowY[cursorY]));
      pathRow[step] = cursorY * width;
      pathCol[step] = cursorX;
    }
    return { pathRow, pathCol };
  };

  const relief = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    if (!sel) {
      if (!moving[y]) {
        for (let x = 0; x < width; x++) relief[row + x] = 1;
        continue;
      }
      const a = rowA[y], b = rowB[y], ox = offX[y], tx = fx[y], ty = fy[y];
      const { pathRow, pathCol } = walkPath(base, y);
      for (let x = 0; x < width; x++) {
        const i = row + x;
        if (isSea[i]) { relief[i] = 1; continue; }
        const here = landHeight[i];
        let crest = here;
        for (let step = 0; step < RAIN_SHADOW_STEPS; step++) {
          const px = (((x + pathCol[step]) % width) + width) % width;
          const h = landHeight[pathRow[step] + px];
          if (h > crest) crest = h;
        }
        const barrier = crest - here;
        const lift = Math.max(0, here - sampleRow(landHeight, a, b, ox, tx, ty, x));
        // Behind a range: dried by how far this ground sits below the crest the
        // air crossed. On the slope that forced the air up: wetted by the climb.
        const shadow = Math.exp(-barrier / params.rainShadowM);
        const windward = 2 - Math.exp(-lift / params.orographicLiftM);
        relief[i] = shadow * windward;
      }
      continue;
    }
    // Two possible upwind paths per row now, one per direction; a cell takes
    // the one its own side of the belt puts it on.
    const paths = [walkPath(base, y), walkPath(rev, y)];
    for (let x = 0; x < width; x++) {
      const i = row + x;
      if (isSea[i]) { relief[i] = 1; continue; }
      const which = sel[i];
      const set = which ? rev : base;
      if (!set.moving[y]) { relief[i] = 1; continue; }
      const { pathRow, pathCol } = paths[which];
      const here = landHeight[i];
      let crest = here;
      for (let step = 0; step < RAIN_SHADOW_STEPS; step++) {
        const px = (((x + pathCol[step]) % width) + width) % width;
        const h = landHeight[pathRow[step] + px];
        if (h > crest) crest = h;
      }
      const barrier = crest - here;
      const lift = Math.max(
        0,
        here - sampleRow(landHeight, set.rowA[y], set.rowB[y], set.offX[y], set.fx[y], set.fy[y], x)
      );
      const shadow = Math.exp(-barrier / params.rainShadowM);
      const windward = 2 - Math.exp(-lift / params.orographicLiftM);
      relief[i] = shadow * windward;
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
      const row = y * width;
      if (!sel) {
        if (!moving[y]) continue;
        const a = rowA[y], b = rowB[y], ox = offX[y], tx = fx[y], ty = fy[y];
        for (let j = 0; j < width; j++) {
          const x = back ? width - 1 - j : j;
          const i = row + x;
          if (isSea[i]) continue;
          const carried = transmission[i] * sampleRow(moisture, a, b, ox, tx, ty, x);
          if (carried > moisture[i]) moisture[i] = Math.min(1, carried);
        }
        continue;
      }
      for (let j = 0; j < width; j++) {
        const x = back ? width - 1 - j : j;
        const i = row + x;
        if (isSea[i]) continue;
        const set = sel[i] ? rev : base;
        if (!set.moving[y]) continue;
        const carried = transmission[i]
          * sampleRow(moisture, set.rowA[y], set.rowB[y], set.offX[y], set.fx[y], set.fy[y], x);
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
    // With a longitude-dependent belt the rising and sinking air is no longer
    // the same at every column of a row, so this is worked out per cell from
    // the local convergence instead of once per row.
    const beltAt = (i) => {
      const c = beltCell[i];
      return (1 - params.subtropicalDryStrength * Math.max(0, -c)) *
        (1 + params.convergenceWetBonus * Math.max(0, c));
    };
    // Stage 7.5-B, the other half of the monsoon: the land/sea heating
    // contrast draws air off the sea in the warm season and pushes it back out
    // in the cold one. `monsoon` is that contrast for this row, signed by the
    // season, and it scales the inflow that reaches inland -- so a coast at a
    // strongly seasonal latitude is far wetter in its summer than its winter,
    // and a coast at the equator, or on a world with no tilt, is neither.
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const wind_ = moisture[i];
      const total =
        wind_ + params.stillAirMoisture * params.coastalMoisture * still[i] * (1 - wind_);
      moisture[i] = Math.min(1, Math.max(0, total * (sel ? beltAt(i) : belt) * relief[i]));
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

  // Stage 7.5. Everything below is computed twice -- once for each latitude's
  // own warm season and once for its cold one -- because the two questions
  // this stage exists to answer cannot be asked of an annual mean: does the
  // melt season melt the snow, and does the wind reverse.
  //
  // How much a row swings at all, as a fraction of the largest swing anywhere.
  // It is what scales the monsoon: nil at the equator, nil on a body with no
  // tilt, and nil if the sea responded to the seasons as strongly as the land
  // does. One number, and all three of those fall out of it.
  const seasonWeight = new Float64Array(geo.height);
  let strongest = 0;
  for (let y = 0; y < geo.height; y++) {
    const p = Math.min(profile.profileRows - 1, Math.floor((y * profile.profileRows) / geo.height));
    const swing = (profile.warmDeltaC[p] - profile.coldDeltaC[p]) * (1 - params.seaSeasonalDamping);
    seasonWeight[y] = Math.max(0, swing);
    if (seasonWeight[y] > strongest) strongest = seasonWeight[y];
  }
  if (strongest > 0) for (let y = 0; y < geo.height; y++) seasonWeight[y] /= strongest;

  // The sub-solar latitude follows the sun into whichever hemisphere is having
  // its summer, so a "warm season" field is a composite of the two solstices.
  // Rows are signed by their own hemisphere, which is why one field can carry
  // both -- see seasonalInsolationByLatitude.
  const subsolar = params.itczFollowFraction * axialTiltDegrees;

  const season = (deltaC, sign) => {
    const evaporation = evaporationByRow(
      profile.seaLevelC, profile.profileRows, geo.height, params, deltaC
    );
    const still = stillAirField(
      geo.isSea, geo.width, geo.height, geo.radiusMetres, evaporation, params
    );
    // Northern rows lead with the northern solstice and southern rows with the
    // southern one, so the rain belt moves poleward in each hemisphere's own
    // summer rather than sitting on one side of the equator all year.
    const wind = windField(geo.height, dayLengthHours, rotationDirection, params, sign * subsolar);
    const flipped = windField(geo.height, dayLengthHours, rotationDirection, params, -sign * subsolar);
    for (let y = 0; y < geo.height; y++) {
      if (y < geo.height / 2) continue; // southern rows take the mirrored field
      wind.east[y] = flipped.east[y];
      wind.north[y] = flipped.north[y];
      wind.convergence[y] = flipped.convergence[y];
      wind.offsetDeg[y] = flipped.offsetDeg[y];
    }
    // Where the belt sits at each longitude, once per hemisphere for the same
    // reason the wind is assembled per hemisphere: in this composite field a
    // northern row is in the northern summer while a southern row is in the
    // southern one, and land pulls the belt toward whichever of the two is
    // having it. Zero-cost when the mechanism is off -- itczShiftByColumn
    // returns a zero array and moistureField then takes its original path.
    const shift = params.itczLandPullDeg > 0
      ? {
        north: itczShiftByColumn({
          isSea: geo.isSea, landHeight: geo.landHeight,
          width: geo.width, height: geo.height,
          lat0Deg: sign * subsolar, seasonSign: sign, seasonWeight,
          maxSwingC: strongest, params,
        }),
        south: itczShiftByColumn({
          isSea: geo.isSea, landHeight: geo.landHeight,
          width: geo.width, height: geo.height,
          lat0Deg: -sign * subsolar, seasonSign: sign, seasonWeight,
          maxSwingC: strongest, params,
        }),
      }
      : null;
    const moisture = moistureField({
      isSea: geo.isSea, landHeight: geo.landHeight,
      width: geo.width, height: geo.height, radiusMetres: geo.radiusMetres,
      wind, evaporation, still, params, monsoon: sign, seasonWeight, shift,
    });
    return { evaporation, still, wind, moisture, shift };
  };

  const warm = season(profile.warmDeltaC, 1);
  const cold = season(profile.coldDeltaC, -1);

  // What a plant sees. The warm season carries most of the weight because that
  // is when it grows, and a monsoon climate is exactly a place where the two
  // seasons disagree.
  const w = params.growingSeasonWeight;
  const moisture = new Float32Array(geo.width * geo.height);
  for (let i = 0; i < moisture.length; i++) {
    moisture[i] = w * warm.moisture[i] + (1 - w) * cold.moisture[i];
  }

  return {
    width: geo.width, height: geo.height, moisture,
    wind: warm.wind, evaporation: warm.evaporation, still: warm.still,
    warmMoisture: warm.moisture, coldMoisture: cold.moisture,
    coldWind: cold.wind, seasonWeight, subsolarDeg: subsolar,
    // Kept for inspection: how far the belt was displaced at each longitude,
    // which is the one thing this mechanism produces that nothing else can.
    itczShift: warm.shift, coldItczShift: cold.shift,
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

  // Stage 7.5-A. How far each latitude departs from its own annual mean at the
  // two solstices, in degrees. Kept as a *departure* rather than an absolute
  // temperature for one concrete reason: the sea keeps far less of the swing
  // than the land does, and that difference is per cell, not per row -- so
  // classifyPoint applies `seaSeasonalDamping` to the sea and the full
  // departure to the land, and the land/sea contrast that drives the monsoon
  // falls out of the same two numbers.
  //
  // At seasonalSensitivityC = 0 both departures are zero and every formula
  // downstream reduces exactly to the annual model, which is what makes this
  // change auditable rather than a rewrite.
  const seasons = seasonalInsolationByLatitude(latitudes, axialTiltDegrees);
  const warmDeltaC = new Float32Array(rows);
  const coldDeltaC = new Float32Array(rows);
  for (let y = 0; y < rows; y++) {
    const warmAnomaly = mean > 0 ? (seasons.warm[y] - insolation[y]) / mean : 0;
    const coldAnomaly = mean > 0 ? (seasons.cold[y] - insolation[y]) / mean : 0;
    warmDeltaC[y] = params.seasonalSensitivityC * warmAnomaly;
    coldDeltaC[y] = params.seasonalSensitivityC * coldAnomaly;
  }
  return { profileRows: rows, seaLevelC, warmDeltaC, coldDeltaC, latitudes };
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

export function classifyPoint(
  out, metres, seaLevelMetres, seaLevelC, warmDeltaC, coldDeltaC, moisture, params
) {
  out[SURFACE_VEGETATION] = 0;
  out[SURFACE_SNOW] = 0;
  out[SURFACE_SEA_ICE] = 0;
  out[SURFACE_SAND] = 0;

  if (metres < seaLevelMetres) {
    out[SURFACE_IS_SEA] = 1;
    const annual =
      params.meanTemperatureC + params.oceanModeration * (seaLevelC - params.meanTemperatureC);
    // Sea ice is judged on the *warm* season, because what the teacher's
    // cloud-free composite shows is the ice that survived the melt season, not
    // the far larger area that freezes over each winter. The sea keeps only
    // part of the swing -- that is what seaSeasonalDamping is.
    const warm = annual + params.seaSeasonalDamping * warmDeltaC;
    const threshold = 1 - smoothstep(
      params.seaIceTemperatureC - params.seaIceBlendC,
      params.seaIceTemperatureC + params.seaIceBlendC,
      warm
    );
    // ...and the year's budget, same idea as land snow's: skipped outright
    // when switched off, so the shipped model costs nothing and comes out
    // bit-identical.
    const sw = params.seaIceBalanceWeight;
    if (sw > 0) {
      const cold = annual + params.seaSeasonalDamping * coldDeltaC;
      const { perennial } = seaIceYearBudget(warm, cold, params);
      out[SURFACE_SEA_ICE] = threshold + (perennial - threshold) * sw;
    } else {
      out[SURFACE_SEA_ICE] = threshold;
    }
    return out;
  }

  out[SURFACE_IS_SEA] = 0;
  const annual = seaLevelC - params.lapseRateCPerKm * ((metres - seaLevelMetres) / 1000);
  // Land keeps the whole seasonal swing; the sea above keeps a fraction of it.
  const warm = annual + warmDeltaC;
  // What a plant experiences: weighted toward the warm season, because that is
  // when it grows. The same weight is used for the moisture the caller hands
  // in, so "the growing season" means one thing in both places.
  const growing =
    annual + params.growingSeasonWeight * warmDeltaC
    + (1 - params.growingSeasonWeight) * coldDeltaC;

  const warmth = smoothstep(
    params.vegetationWarmthC - params.vegetationWarmthWidthC,
    params.vegetationWarmthC + params.vegetationWarmthWidthC,
    growing
  );
  const wet = smoothstep(
    params.vegetationMoistureHalf - params.vegetationMoistureWidth,
    params.vegetationMoistureHalf + params.vegetationMoistureWidth,
    moisture
  );
  // The rock/sand split is a colour, and a colour is a property of the place
  // rather than of one season, so it stays on the annual mean.
  out[SURFACE_SAND] = smoothstep(
    params.sandTemperatureC - params.sandWidthC,
    params.sandTemperatureC + params.sandWidthC,
    annual
  );
  out[SURFACE_VEGETATION] = warmth * wet;

  // Stage 7.5-D. Snow lies all year where the melt season fails to melt it --
  // which is a question about the warmest month, not about the average of a
  // year. That is why a 5000 m plateau can hold ice at a latitude whose
  // lowland is forest, and it is why this needed seasons before it could be
  // asked at all.
  const meltPoint = params.freezeTemperatureC + params.snowSummerMeltC;
  const threshold = 1 - smoothstep(
    meltPoint - params.snowBlendC, meltPoint + params.snowBlendC, warm
  );

  // ...and the year's budget, which asks the same question of the whole year
  // rather than of its warmest moment. Skipped outright when switched off, so
  // the shipped model costs nothing for it and comes out bit-identical.
  const w = params.snowBalanceWeight;
  if (w > 0) {
    const cold = annual + coldDeltaC;
    out[SURFACE_SNOW] = threshold + (snowYearBudget(warm, cold, moisture, params) - threshold) * w;
  } else {
    out[SURFACE_SNOW] = threshold;
  }
  return out;
}

/**
 * How much of a sinusoidal year a surface spends below some freezing point,
 * and the year-mean of how far above it the surface stands otherwise.
 *
 * Shared by land snow and sea ice because the *geometry* of a year -- two
 * solstice temperatures standing for the ends of a sinusoid, and a closed
 * form for how much of the cycle sits on each side of a threshold -- is the
 * same question for both. What each does with the two numbers this returns
 * is not: land snow multiplies the frozen share by moisture before it counts
 * as accumulation, because snowfall needs supply; sea ice does not, because
 * seawater below its freezing point simply freezes. That distinction is kept
 * entirely in the two callers, not in here.
 *
 * For T(t) = mean + amplitude*cos(t) the melt term has a closed form, and it
 * saturates the right way by construction: a brief fierce summer contributes
 * a fraction of what a long mild one does, without any cap imposed by hand
 * and without ever breaking "warmer melts more".
 */
function sinusoidalFreezeBudget(warm, cold, freeze) {
  const mean = (warm + cold) / 2;
  const amplitude = (warm - cold) / 2;

  if (!(amplitude > 1e-6)) {
    // No season worth the name: the year is one temperature.
    return {
      frozenShare: mean < freeze ? 1 : 0,
      degreesAboveFreezing: Math.max(0, mean - freeze),
    };
  }
  const u = (freeze - mean) / amplitude;
  if (u >= 1) return { frozenShare: 1, degreesAboveFreezing: 0 };
  if (u <= -1) return { frozenShare: 0, degreesAboveFreezing: mean - freeze };
  // The year crosses freezing twice; phi is how far round the cycle it
  // spends above it.
  const phi = Math.acos(u);
  return {
    frozenShare: 1 - phi / Math.PI,
    degreesAboveFreezing: (amplitude / Math.PI) * (Math.sin(phi) - u * phi),
  };
}

/**
 * How much of a year's snowfall survives its melt season, as 0 to 1.
 *
 * The two seasons this model computes are the ends of a year, not the year
 * itself, so both halves of the budget are integrated over a sinusoid running
 * between them. That is the whole idea: **a year is a duration, and a single
 * warm-season temperature cannot say how long anything lasted.**
 *
 *   accumulation  the share of the year spent below freezing, times the
 *                 moisture available to fall as snow. So a bitterly cold
 *                 desert accumulates little, which is why the driest cold
 *                 places on any world should not silently ice over.
 *   melt          the year-mean of how far the surface stands above freezing.
 *
 * Nothing here reads a latitude, a coordinate or a place -- only the two
 * temperatures and the moisture the model already has for that point, so it
 * works unchanged on a world with no seasons (the amplitude goes to zero and
 * both terms fall back to their annual-mean limits) or on one tilted 80.
 */
export function snowYearBudget(warm, cold, moisture, params) {
  const { frozenShare, degreesAboveFreezing } =
    sinusoidalFreezeBudget(warm, cold, params.freezeTemperatureC);
  const balance =
    frozenShare * moisture - params.snowMeltDegreeDay * degreesAboveFreezing;
  return smoothstep(
    params.snowBalanceRequiredM - params.snowBalanceWidth,
    params.snowBalanceRequiredM + params.snowBalanceWidth,
    balance
  );
}

/**
 * How much sea ice survives a year's melt season, as 0 to 1 -- the sea-water
 * equivalent of snowYearBudget above, and deliberately not the same function
 * with a different threshold. Land snow needs moisture to fall before it can
 * accumulate; sea ice needs none, because seawater below its own freezing
 * point (`seaIceTemperatureC`, physical, about -1.8 C) freezes directly. So
 * the accumulation term here is the frozen share of the year on its own,
 * never multiplied by anything standing in for supply.
 *
 * `seaIceMeltDegreeDay`/`seaIceBalanceRequired`/`seaIceBalanceWidth` are this
 * mechanism's own empirical constants -- not reused from the land-snow ones,
 * because the two budgets are in different units (a snowfall-and-moisture
 * balance is not a freeze-duration balance) and fitting them together would
 * hide which mechanism a future change was actually tuning.
 *
 * Returns both **perennial** ice -- the annual net balance, i.e. ice that
 * does not fully melt and so persists from one year's freeze into the next
 * -- and **seasonal** ice -- the share of the year that ever freezes at all,
 * whether or not it survives the melt. The two are kept distinct because a
 * coast that freezes over every winter and clears every summer (seasonal)
 * and one that never fully opens (perennial) are different places, even
 * though today only `perennial` is painted and scored -- see the module's
 * sea-ice section for why: the teacher's cloud-free composite shows what
 * lasts, not the far larger area that freezes each winter.
 */
export function seaIceYearBudget(warm, cold, params) {
  const { frozenShare, degreesAboveFreezing } =
    sinusoidalFreezeBudget(warm, cold, params.seaIceTemperatureC);
  const balance = frozenShare - params.seaIceMeltDegreeDay * degreesAboveFreezing;
  const perennial = smoothstep(
    params.seaIceBalanceRequired - params.seaIceBalanceWidth,
    params.seaIceBalanceRequired + params.seaIceBalanceWidth,
    balance
  );
  return { perennial, seasonal: frozenShare };
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
//            way the painter resolves them. This is what gets reported, what
//            the phone shows, and -- since Stage 7 -- what the search
//            optimises.
//   soft  -- the same thing computed from the model's own memberships. It was
//            meant to be the search's target, on the reasoning that a hard
//            label only changes when a pixel flips and so gives a search
//            nothing to follow. **Measurement killed that idea**: with the
//            gradient widths held fixed the two disagree in *direction* -- a
//            model that hedges, keeping its memberships near the middle,
//            scores better softly and worse once the colours are resolved.
//            Optimising a surrogate that disagrees with the number being
//            reported is worse than optimising nothing, and the worry behind
//            it was unfounded anyway: at two million pixels a small parameter
//            change flips thousands of them, so the hard score moves smoothly
//            enough for a gradient-free search. It is still computed and
//            reported, as a diagnostic.
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

// How much the region term counts next to the global one.
//
// **It was 0.5, and at that weight it decided the answer rather than guarding
// it.** Two full searches, 40,000 trials each, improved this score by 5% and
// came back with *every one of their twenty best candidates worse than the
// shipped model on the mean IoU* -- the number the user's own specification
// names as the total, and the one the phone displays. A search that makes the
// headline worse while its own score improves is being pointed at the wrong
// quantity.
//
// The term still earns a place, but a small one. Its original job (Stage 2)
// was to stop Africa being twice as green as it should be while Eurasia was
// half, with the two errors cancelling inside one number -- but that
// cancellation was possible because the global measure then was a *mean
// vegetated fraction*. Intersection over union is per pixel: a misplaced pixel
// is counted wherever it is, so the cancellation it was built to prevent
// cannot happen any more. What is left is a guard against a fit that is right
// on the big continents and wrong on the small ones, which is worth 0.15 and
// not worth 0.5.
const REGION_WEIGHT = 0.15;

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
  const cellHardHit = new Float64Array(cells * n);
  const cellHardUnion = new Float64Array(cells * n);
  const cellLand = new Float64Array(cells);

  const surface = new Float64Array(5);
  const soft = new Float64Array(n);

  for (let y = 0; y < height; y += step) {
    const latDeg = 90 - ((y + 0.5) / height) * 180;
    const w = Math.cos((latDeg * Math.PI) / 180);
    if (w <= 0) continue;
    const profileRow = Math.min(climate.profileRows - 1, Math.floor(y * rowScale));
    const seaLevelC = climate.seaLevelC[profileRow];
    const warmDeltaC = climate.warmDeltaC[profileRow];
    const coldDeltaC = climate.coldDeltaC[profileRow];
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
      classifyPoint(
        surface, metres, seaLevelMetres, seaLevelC, warmDeltaC, coldDeltaC, moisture, params
      );

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
        cellHardHit[cell * n + k] += w * teacherIs * modelIs;
        cellHardUnion[cell * n + k] += w * (teacherIs + modelIs - teacherIs * modelIs);
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
  let softRegionPenalty = 0;
  let regionCount = 0;
  const totalLand = cellLand.reduce((a, b) => a + b, 0);
  for (let cell = 0; cell < cells; cell++) {
    if (cellLand[cell] < totalLand * REGION_MIN_LAND_FRACTION) continue;
    let sum = 0;
    let hardSum = 0;
    let used = 0;
    for (let k = 0; k < n; k++) {
      if (cellUnion[cell * n + k] <= 0) continue;
      sum += cellHit[cell * n + k] / cellUnion[cell * n + k];
      hardSum += cellHardUnion[cell * n + k] > 0
        ? cellHardHit[cell * n + k] / cellHardUnion[cell * n + k] : 0;
      used++;
    }
    const value = used ? hardSum / used : 0;
    softRegionPenalty += 1 - (used ? sum / used : 0);
    regionPenalty += 1 - value;
    regionCount++;
    const latIndex = Math.floor(cell / lngColumns);
    const lngIndex = cell % lngColumns;
    regions.push({
      lat: 90 - latIndex * REGION_LAT_STEP,
      lng: -180 + lngIndex * REGION_LNG_STEP,
      iou: value,
      land: cellLand[cell] / totalLand,
    });
  }
  regionPenalty = regionCount ? regionPenalty / regionCount : 0;
  softRegionPenalty = regionCount ? softRegionPenalty / regionCount : 0;

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
    softRegionPenalty,
    regionCount,
    // Lower is better, and this is the number the automatic search minimises.
    // Built from the *hard* figures, so it is one arithmetic step away from
    // the total the user reads: nothing can improve this while making that
    // worse.
    score: 1 - meanIou + REGION_WEIGHT * regionPenalty,
  };
}

// ---------------------------------------------------------------------------
// Teacher B: climate structure (season / monsoon / precipitation seasonality)
//
// Teacher A (above) is an annual snapshot -- one class per pixel, no time
// axis -- so Q1 of the Stage 7.5 diagnosis found it can barely see whether
// seasons, a monsoon reversal, or a wet/dry cycle exist at all: switching the
// monsoon term off moved Teacher A's score by exactly 0.00.
//
// Teacher B exists to see exactly that. It is scored completely separately
// from Teacher A (never combined into one number -- see the diagnosis doc,
// section 10) and it is not a step toward reproducing real Earth on screen;
// it exists so a change to the season/wind/rain-shadow machinery can be
// measured by something other than "the annual map didn't move".
//
// It is a *reduced* Köppen-Geiger structure, not the real 30-class system.
// The real one needs monthly temperature and monthly precipitation in real
// units (mm); this model has neither -- only two seasons (warm/cold) and an
// arbitrary 0-1 moisture proxy, never an absolute depth of rain. Inventing
// monthly millimetres to force a 30-class output would be inventing data in
// the one place this project has always refused to (see build_teacher.py's
// own framing), so instead of that, eight classes are used, each one a
// well-known Köppen *group* boundary applied to what this model actually
// has: two seasons instead of twelve months, and a moisture ratio instead of
// a millimetre count. Both simplifications are named at the threshold they
// replace.
//
// The four temperature thresholds (18C tropical floor, 10C forest/tundra
// line, -3C continental line) are the standard Köppen-Geiger group
// boundaries -- public climatological definitions, unrelated to any one
// project's implementation of them (see Peel, Finlayson & McMahon 2007,
// updated world map of the Koppen-Geiger classification, Hydrol. Earth Syst.
// Sci. 11, 1633-1644). The 1/3 dry-season ratio is the same standard's own
// test for a temperate/continental dry season (driest month under a third of
// the wettest), reused here against the warm/cold *seasons* this model has
// instead of twelve months -- an explicit approximation, not the literal
// month-count rule.
export const STRUCTURE_TROPICAL_HUMID = 0;
export const STRUCTURE_TROPICAL_SEASONAL = 1;
export const STRUCTURE_ARID = 2;
export const STRUCTURE_TEMPERATE_HUMID = 3;
export const STRUCTURE_TEMPERATE_SEASONAL = 4;
export const STRUCTURE_COLD_HUMID = 5;
export const STRUCTURE_COLD_SEASONAL = 6;
export const STRUCTURE_POLAR = 7;

export const STRUCTURE_CLASSES = [
  { key: "tropicalHumid", id: STRUCTURE_TROPICAL_HUMID, label: "熱帯湿潤", koppen: ["Af"] },
  { key: "tropicalSeasonal", id: STRUCTURE_TROPICAL_SEASONAL, label: "熱帯季節性", koppen: ["Am", "Aw"] },
  { key: "arid", id: STRUCTURE_ARID, label: "乾燥", koppen: ["BW", "BS"] },
  { key: "temperateHumid", id: STRUCTURE_TEMPERATE_HUMID, label: "温帯湿潤", koppen: ["Cf"] },
  { key: "temperateSeasonal", id: STRUCTURE_TEMPERATE_SEASONAL, label: "温帯季節性", koppen: ["Cs", "Cw"] },
  { key: "coldHumid", id: STRUCTURE_COLD_HUMID, label: "寒冷湿潤", koppen: ["Df"] },
  { key: "coldSeasonal", id: STRUCTURE_COLD_SEASONAL, label: "寒冷季節性", koppen: ["Ds", "Dw"] },
  { key: "polar", id: STRUCTURE_POLAR, label: "極域", koppen: ["ET", "EF"] },
];

// Standard Köppen-Geiger group boundaries (Peel/Finlayson/McMahon 2007).
const STRUCTURE_TROPICAL_MIN_C = 18; // coldest month >= 18C => group A
const STRUCTURE_WARM_MIN_C = 10; // warmest month >= 10C: below this is group E
const STRUCTURE_CONTINENTAL_MAX_C = -3; // coldest month <= -3C => group D, not C
// The standard's own dry-season test for the C/D groups: driest month under
// a third of the wettest. Applied here to the warm/cold *seasons* this model
// has, not twelve real months -- see the note above.
const STRUCTURE_DRY_SEASON_RATIO = 1 / 3;
// This model has no absolute precipitation, only a 0-1 moisture proxy, so the
// real temperature-scaled aridity index (Peel et al.'s P < 2T, 2T+14, 2T+28
// mm/year test) cannot be evaluated. The threshold below is calibrated
// instead against an external, independent fact -- Peel, Finlayson &
// McMahon (2007), Table 2's own reported global land fraction for Koppen
// group B, 30.2% -- exactly the way V0.5's sea-level baseline was calibrated
// against a real ocean-area fraction: it is picked to reproduce a fact about
// Earth, not to raise this model's own score. 0.3454 is the (warm+cold)/2
// moisture value at which the shipped Stage 7.5 model's own land area
// crosses that 30.2% mark (measured directly from the committed elevation
// raster and the shipped climate parameters); it will drift slightly if
// those parameters are ever refitted, which is a known, disclosed
// imprecision rather than an error -- see the diagnosis doc for why this is
// not the same thing as tuning for agreement.
export const STRUCTURE_ARID_MOISTURE_THRESHOLD = 0.3454;

/**
 * The model's own structural class at one point, from the same fields
 * `classifyPoint` already reads -- no new state, only a different reading of
 * it. Returns null over the sea: Koppen classifies land climate, not ocean.
 */
export function classifyStructurePoint(
  metres, seaLevelMetres, seaLevelC, warmDeltaC, coldDeltaC, warmMoisture, coldMoisture, params
) {
  if (metres < seaLevelMetres) return null;
  const annual = seaLevelC - params.lapseRateCPerKm * ((metres - seaLevelMetres) / 1000);
  const warmT = annual + warmDeltaC;
  const coldT = annual + coldDeltaC;
  const hottest = Math.max(warmT, coldT);
  const coldest = Math.min(warmT, coldT);
  const wettest = Math.max(warmMoisture, coldMoisture);
  const driest = Math.min(warmMoisture, coldMoisture);
  const hasDrySeason = wettest > 0 && driest / wettest < STRUCTURE_DRY_SEASON_RATIO;

  // Aridity overrides every temperature group, exactly as in the real
  // definition (a hot desert and a cold desert are both group B, never A/C/D).
  if ((warmMoisture + coldMoisture) / 2 < STRUCTURE_ARID_MOISTURE_THRESHOLD) {
    return STRUCTURE_ARID;
  }
  if (coldest >= STRUCTURE_TROPICAL_MIN_C) {
    return hasDrySeason ? STRUCTURE_TROPICAL_SEASONAL : STRUCTURE_TROPICAL_HUMID;
  }
  if (hottest < STRUCTURE_WARM_MIN_C) return STRUCTURE_POLAR;
  if (coldest > STRUCTURE_CONTINENTAL_MAX_C) {
    return hasDrySeason ? STRUCTURE_TEMPERATE_SEASONAL : STRUCTURE_TEMPERATE_HUMID;
  }
  return hasDrySeason ? STRUCTURE_COLD_SEASONAL : STRUCTURE_COLD_HUMID;
}

/**
 * Compare the model's structural class against Teacher B (observed
 * Köppen-Geiger structure, reduced to the same eight classes -- see
 * tools/build_koppen_teacher.py). Land only; kept entirely separate from
 * `scoreAgainstTeacher` and never combined into one number with it (see the
 * diagnosis doc, section 10) -- the two answer different questions.
 */
export function scoreAgainstStructureTeacher({
  elevation, climate, teacher, seaLevelMetres, params, step = 1,
}) {
  const { width, height } = elevation;
  const rowScale = climate.profileRows / height;
  const coarseY = climate.height / height;
  const column = coarseColumns(width, climate.width);
  const teacherScaleX = teacher.width / width;
  const teacherScaleY = teacher.height / height;

  const n = STRUCTURE_CLASSES.length;
  const hit = new Float64Array(n);
  const model = new Float64Array(n);
  const truth = new Float64Array(n);
  let landWeight = 0;
  let landCorrect = 0;

  for (let y = 0; y < height; y += step) {
    const latDeg = 90 - ((y + 0.5) / height) * 180;
    const w = Math.cos((latDeg * Math.PI) / 180);
    if (w <= 0) continue;
    const profileRow = Math.min(climate.profileRows - 1, Math.floor(y * rowScale));
    const seaLevelC = climate.seaLevelC[profileRow];
    const warmDeltaC = climate.warmDeltaC[profileRow];
    const coldDeltaC = climate.coldDeltaC[profileRow];
    const fy = (y + 0.5) * coarseY - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const ya = Math.min(climate.height - 1, Math.max(0, y0)) * climate.width;
    const yb = Math.min(climate.height - 1, Math.max(0, y0 + 1)) * climate.width;
    const row = y * width;
    const teacherRow = Math.min(teacher.height - 1, Math.floor(y * teacherScaleY)) * teacher.width;

    for (let x = 0; x < width; x += step) {
      const metres = elevation.metres[row + x];
      if (metres < seaLevelMetres) continue; // land only, both sides

      const xa = column.a[x];
      const xb = column.b[x];
      const tx = column.t[x];
      const warmMoisture =
        climate.warmMoisture[ya + xa] * (1 - tx) + climate.warmMoisture[ya + xb] * tx;
      const warmMoistureB =
        climate.warmMoisture[yb + xa] * (1 - tx) + climate.warmMoisture[yb + xb] * tx;
      const wm = warmMoisture * (1 - ty) + warmMoistureB * ty;
      const coldMoisture =
        climate.coldMoisture[ya + xa] * (1 - tx) + climate.coldMoisture[ya + xb] * tx;
      const coldMoistureB =
        climate.coldMoisture[yb + xa] * (1 - tx) + climate.coldMoisture[yb + xb] * tx;
      const cm = coldMoisture * (1 - ty) + coldMoistureB * ty;

      const got = classifyStructurePoint(
        metres, seaLevelMetres, seaLevelC, warmDeltaC, coldDeltaC, wm, cm, params
      );
      const teacherValue =
        teacher.data[teacherRow + Math.min(teacher.width - 1, Math.floor(x * teacherScaleX))];
      if (teacherValue >= n) continue; // sentinel: Teacher B has no class here (ocean)

      landWeight += w;
      if (got === teacherValue) landCorrect += w;
      truth[teacherValue] += w;
      if (got !== null) model[got] += w;
      if (got === teacherValue) hit[teacherValue] += w;
    }
  }

  const classes = {};
  let total = 0;
  let counted = 0;
  for (let k = 0; k < n; k++) {
    const spec = STRUCTURE_CLASSES[k];
    const value = iou(hit[k], model[k] + truth[k] - hit[k]);
    classes[spec.key] = {
      label: spec.label,
      iou: value,
      recall: truth[k] > 0 ? hit[k] / truth[k] : null,
      precision: model[k] > 0 ? hit[k] / model[k] : null,
      teacherArea: truth[k],
      modelArea: model[k],
    };
    if (value !== null) {
      total += value;
      counted++;
    }
  }

  return {
    classes,
    meanIou: counted ? total / counted : 0,
    landAccuracy: landWeight > 0 ? landCorrect / landWeight : 0,
    landWeight,
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
    const profileRow = Math.min(climate.profileRows - 1, Math.floor(y * rowScale));
    const seaLevelC = climate.seaLevelC[profileRow];
    const warmDeltaC = climate.warmDeltaC[profileRow];
    const coldDeltaC = climate.coldDeltaC[profileRow];
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
      classifyPoint(
        surface, metres, seaLevelMetres, seaLevelC, warmDeltaC, coldDeltaC, moisture, params
      );

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
