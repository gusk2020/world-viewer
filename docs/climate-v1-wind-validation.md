# Climate v1 Stage 3 -- wind field validation

Stage 3 asks one narrow question: **how far off is Climate v0.8's existing
wind field from the real Earth**, measured, not guessed. Nothing about
moisture, rainfall, rivers, lakes, wetlands, snow/ice, vegetation, or a new
pressure/ocean-current model is touched this round -- only terrain, land/sea,
temperature (Stage 0-2, unchanged) and now wind are in scope, and wind stops
here.

## 1. The Stage 2 temperature calibration, kept separate

Stage 2 found a real, genuralising improvement to the temperature field's
accuracy (global MAE 3.09C to about 2.2-2.4C) by calibrating
`insolationSensitivityC` and `oceanModeration` (and, in the three-knob
variant, `polarExtraC`). Per this stage's brief, the two-knob candidate
(`insolationSensitivityC: 80.68, oceanModeration: 0.818`, `polarExtraC`
left at its shipped value) is adopted as **Climate v1's own internal Earth
calibration** -- but it lives only in Climate v1's own code path, never in
`worlds/kasoku-sekai/config.json`, never in Climate v0.8's live default, and
never touching what the app actually draws. `meanTemperatureC` stays the
user's slider, exactly as before.

This document's own wind validation still runs Climate v1's temperature
field with the **default** (uncalibrated) parameters, because the wind
model reads no temperature output at all -- `windField` takes only
`rows, dayLengthHours, rotationDirection, params, subsolarDeg`, so which
temperature calibration is active has no bearing on anything measured here.

## 2. Wind teacher: source, and why NCEP/NCAR Reanalysis 1

| candidate | u/v | resolution | 10m | 850hPa | auth | reachable here | reachable via Actions | license |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **NCEP/NCAR Reanalysis 1** (PSL) | yes | 2.5 deg (pressure), ~1.9 deg Gaussian (surface) | yes | yes (17 levels) | none | no (`403`) | **yes, confirmed** | US federal work, no restriction |
| NCEP/DOE Reanalysis 2 | yes | 2.5 deg | yes | yes | none | untested, expected blocked | expected yes | US federal work |
| ERA5 (Copernicus CDS) | yes | 0.25 deg | yes | yes | **API key required** | no | needs a stored secret | free, CC-style, but the auth step is exactly what this stage avoids forcing |

**Chosen: NCEP/NCAR Reanalysis 1.** Not because it was easiest -- ERA5 is
finer and arguably a better product on paper, but its access model needs a
Copernicus CDS API key stored as a repository secret, the same kind of
authentication hurdle Stage 2 already declined to force through for
temperature. Reanalysis 2 is a real second option (Reanalysis 1's own
documented successor, fixing several known R1 bugs) but was not tried this
round because R1 already answers the question at hand and a second,
near-identical product would not change any conclusion here. Confirmed via
direct `curl -I`: PSL's `downloads.psl.noaa.gov` returns `403` from this
sandbox, matching every other dedicated geodata host this project has ever
used (GEBCO, the planetary DEMs, the Koppen classification) except Berkeley
Earth's plain S3 bucket -- so, same as those, the actual fetch runs from a
GitHub Actions runner (`.github/workflows/build-wind-teacher.yml`).

## 3. 10m vs 850hPa, and which is primary

**Chosen: 850hPa primary, 10m secondary** -- as anticipated, and confirmed
by reading `windField`'s own code before deciding, not by assumption:

- `windField` (`js/climate.js`) is a closed-form Hadley/Ferrel/polar-cell
  idealisation with **no boundary-layer term of any kind** -- no drag
  coefficient, no roughness length, no land/sea friction difference, no
  terrain. It is a description of the *free troposphere's* large-scale
  overturning circulation, which is exactly what 850hPa (roughly 1.5 km up,
  above most surface friction) represents.
- 10m wind is the real *surface* wind, dominated by exactly the physics
  `windField` has none of -- friction, coastlines, terrain-channelled flow.
  Comparing a frictionless analytic model against a friction-dominated
  observation would blame the model for a mechanism it was never designed
  to have.
- Confirmed after the fact, not just argued: the teacher data itself shows
  850hPa windier than 10m everywhere measured (global mean resultant speed
  4.88 m/s vs 3.19 m/s, both well within the sanity bounds
  `tools/build_wind_teacher.py` checks), consistent with surface friction
  slowing the near-ground wind relative to the free troposphere -- the
  physical picture 850hPa-as-primary rests on.

## 4. Climatology period

**Target: 1991-2020**, matching the temperature teacher. **What was
actually used: PSL's documented 1981-2010 long-term-mean (ltm) base
period**, for both levels -- a real, honestly-recorded compromise, not a
silent substitution:

- The first attempt fetched the *full* 1948-present monthly-mean record (to
  compute an exact 1991-2020 climatology, the same method
  `tools/build_temperature_teacher.py` uses). The 850hPa file carries all 17
  pressure levels, not just 850, and the request timed out (`HTTP 504`) at
  PSL's own gateway before finishing.
- Switching to PSL's own pre-computed `.mon.ltm.nc` files (already a
  12-calendar-month climatology at every level, no per-level waste) fixed
  the reliability problem, but those files carry PSL's own documented
  1981-2010 base period, not 1991-2020 -- confirmed via PSL's published
  description of the product (the file's own global attributes state only
  a processing-history string, "Created .../doMonthLTMNC4", not the
  reference years).
- **What this does and does not affect**: a 10-year shift in a 30-year wind
  climatology's base period changes almost nothing about the large-scale
  circulation this stage measures -- Earth's trade winds, westerlies and
  general circulation strength are far more stable decade-to-decade than,
  say, sea ice extent. Nothing in this document's conclusions depends on
  the exact 10-year window.

## 5. Grid, vector convention, and the missing-below-ground mask

- **850hPa**: 144x73 (2.5 degree), reoriented to this project's row0=north/
  col0=-180 convention (checked, not assumed: the source file's own
  latitude ran 90 to -90 already; longitude ran 0..357.5 and was rewrapped).
- **10m**: 192x94 (~1.875 degree Gaussian grid), same reorientation.
- **u**: eastward component, positive = blowing *toward* the east.
  **v**: northward component, positive = blowing *toward* the north. This
  is the standard meteorological *vector* convention -- **not** the
  compass "wind direction" convention ("a north wind" blows *from* the
  north, *toward* the south). See section 15 for why this distinction was
  checked with a synthetic test rather than assumed correct.
- **The 850hPa below-ground mask -- a real finding, not an assumption
  confirmed true.** A pressure surface at 850hPa sits underground over
  high terrain (Tibet, the Andes, the Rockies, Greenland/Antarctica's
  interiors). The plan was to trust the source file's own missing values
  for this, the way the full monthly-mean record does -- but the
  pre-computed `.ltm.nc` file does **not** carry that missing value; it
  reports a number at every grid point regardless of the real surface's
  height (caught by this project's own sanity check failing outright: "no
  missing-below-ground cells found at 850hPa", rather than by reading
  documentation first). Fixed by fetching the same product's surface-
  pressure ltm climatology and masking any 850hPa cell whose annual-mean
  surface pressure is below 850hPa: **1128 of 10512 cells (10.7%)**, a
  plausible fraction for Earth's elevated terrain. A second real bug
  surfaced building this mask: the first attempt divided the raw pressure
  values by 100 assuming Pascals, which (since the file's raw values were
  already in hPa) produced ~10 hPa everywhere and marked **all 10512/10512
  cells** below ground -- caught by a `ZeroDivisionError` in the following
  step, then fixed by checking the raw value's own plausible range (hPa vs
  Pa) rather than trusting a units convention that turned out to be
  inconsistent across NCEP's own products. Masked cells are never
  interpolated or filled.

## 6. Annual mean vs. scalar mean speed

Built and kept distinct, per the task's own explicit warning against
conflating them:

- **annualMeanU / annualMeanV**: the plain time-mean of each *component*,
  computed by `tools/build_wind_teacher.py` as the mean of the 12
  calendar-month climatological values. A monsoon-style reversal (opposite
  signs in different months) cancels toward zero here.
- **annualResultantSpeed** = `sqrt(annualMeanU^2 + annualMeanV^2)` -- the
  speed of the already-averaged vector.
- **meanScalarSpeed**: `sqrt(u^2+v^2)` computed **per calendar month
  first**, then averaged. By the triangle inequality this is always
  `>= annualResultantSpeed`; measured on the real teacher data, the gap is
  small at both levels (850hPa: 4.88 to 5.34 m/s, +0.46; 10m: 3.19 to
  3.56 m/s, +0.37) -- meaning the annual-mean *vector* wind is already a
  fairly honest summary of the real wind's typical strength at these two
  levels, globally. This global smallness does not mean it is small
  everywhere; a genuine monsoon coast would show a much larger gap, which
  DJF/JJA composites (built, not analysed this round) could confirm in a
  future stage.
- **Climate v0.8's own model has no equivalent distinction to make.**
  `windField` computes one annual snapshot directly from a formula; there
  is no intra-annual time series inside the model to average over. So
  "annualMeanU/V" and "meanScalarSpeed" only differ for the *teacher*; the
  *model* side of every comparison in this document uses the one number
  `windField` produces.

## 7. Baseline metrics

`tools/validate_wind_v1.mjs` builds Climate v0.8's dimensionless annual wind
(`currentModelWind`, shipped default parameters, `subsolarDeg=0`, i.e. no
season), fits one diagnostic scale K per level by least squares
(`fitSpeedScaleK`, minimising `sum(w*(K*modelSpeed-teacherSpeed)^2)`,
`w = cos(latitude)`), and compares.

**Direction-only (K-independent), 850hPa**: mean **56.5 deg**, median
**29.5 deg**, speed-weighted **37.3 deg** (n=8617, 767 near-calm teacher
cells excluded below 1 m/s). The gap between mean and median matters: a
median well under the mean says most cells are reasonably close while a
smaller number are very wrong (a directionally-*random* comparison would
average close to 90 degrees, so this sits meaningfully better than random
but far from good).

**Speed, with the fitted scale K applied**:

| | 850hPa (K=6.545) | 10m (K=4.254) |
| --- | --- | --- |
| bias | -0.72 m/s | -0.48 m/s |
| speed MAE | 2.86 m/s | 2.13 m/s |
| speed RMSE | 3.85 m/s | 2.66 m/s |
| u RMSE | 5.04 m/s | 3.20 m/s |
| v RMSE | 1.92 m/s | 1.88 m/s |
| vector RMSE | 4.99 m/s | 3.36 m/s |
| speed correlation | **0.154** | **0.141** |

**The speed correlation is the headline number here, and it is weak at
both levels.** A model whose speed pattern actually tracked reality would
show a correlation well above these. u RMSE consistently exceeds v RMSE at
both levels -- the model's *east-west* speed pattern is where most of the
error concentrates, not its north-south component.

## 8. Latitude bands (850hPa)

| band | u RMSE | v RMSE | speed MAE | direction mean |
| --- | --- | --- | --- | --- |
| 90-60N | 5.65 | 1.26 | 2.50 | **119.8 deg** |
| 60-30N | 2.97 | 1.48 | 2.16 | 30.3 deg |
| 30-0N | 3.65 | 2.42 | 2.27 | 59.8 deg |
| 0-30S | 2.61 | 2.46 | 1.83 | 42.1 deg |
| 30-60S | 7.05 | 1.01 | 5.56 | 19.9 deg |
| 60-90S | 7.60 | 2.61 | 2.80 | **102.3 deg** |

The mid-latitude westerlies bands (60-30N, 30-60S) have the *best*
direction agreement (20-30 degrees) but 30-60S also has the *worst* speed
MAE (5.56 m/s) -- right direction, badly wrong strength (see section 9).
Both polar bands (90-60N, 60-90S) have direction errors **over 100
degrees** -- close to backwards, not merely inaccurate.

## 9. Major wind belts: direction and relative strength

| band (idealised belt) | teacher u,v (m/s) | model u,v (K-scaled, m/s) | sign of u matches |
| --- | --- | --- | --- |
| 90-60N (polar easterlies) | +1.16, -0.10 | -4.70, -0.01 | **no** |
| 60-30N (westerlies) | +4.13, +0.16 | +4.03, +0.07 | yes |
| 30-0N (NH trades) | -2.48, +0.03 | -3.36, -1.74 | yes |
| 0-30S (SH trades) | -3.00, +0.14 | -3.36, +1.74 | yes |
| 30-60S (westerlies) | +9.16, -0.06 | +4.03, -0.07 | yes |
| 60-90S (polar easterlies) | +1.76, +0.41 | -4.70, +0.01 | **no** |

Read together with section 8, three separate findings, not one:

1. **The mid-latitude westerlies (both hemispheres) are directionally
   right and roughly the right order of magnitude in the north, but the
   Southern Hemisphere westerlies are real-world famous for being far
   stronger than the Northern Hemisphere's** (the "roaring forties/
   fifties" -- fewer continents to disrupt the flow). The teacher shows
   exactly that asymmetry (+9.16 vs +4.13 m/s); the model, whose formula
   has no hemisphere-distinguishing term at all, gives the **same**
   magnitude in both hemispheres (4.03 m/s) by construction. This is the
   wind-side counterpart of the hemispherically-asymmetric polar error
   Stage 2 found in temperature -- a structural limit of any
   latitude-only-symmetric formula, not a mis-set number.
2. **The trades are directionally right, but the model's north-south
   (v) component is dramatically overstated relative to reality**: the
   teacher's annual-mean v near the equator is close to zero (+0.03 to
   +0.14), while the model gives +-1.74. This is section 6's monsoon-
   cancellation point from the *opposite* direction: the real *annual
   mean* trades are almost purely zonal (their seasonal north-south
   swings mostly cancel), while `windField`'s analytic formula has a
   built-in meridional component (`flow*cos(turn)`) that an annual
   snapshot from a formula has no mechanism to cancel the way a real
   30-year average of real months does.
3. **Both polar bands get the direction backwards.** Real 850hPa flow near
   both poles is shaped by the polar vortex and storm tracks in a way a
   three-idealised-cell model does not represent -- and unlike findings 1
   and 2, this is not simply "right shape, wrong magnitude," it is the
   wrong sign entirely.

## 10. Named regions (diagnostic only, never a fit target)

| region | teacher u,v,speed | model u,v,speed (K-scaled) |
| --- | --- | --- |
| tropical Pacific | -8.27, +0.11, 8.28 | -0.60, -0.00, 0.60 |
| North Atlantic | +5.71, +0.65, 5.75 | +4.96, +0.10, 4.96 |
| Southern Ocean | +11.33, -0.05, 11.33 | +4.06, -0.04, 4.06 |
| Indian Ocean | -1.63, +0.72, 1.78 | -2.50, +1.56, 2.95 |
| North America | +4.58, -0.17, 4.58 | +5.82, +0.09, 5.82 |
| Eurasia | +4.14, -0.24, 4.15 | +3.08, +0.02, 3.08 |

North Atlantic, North America and Eurasia (all mid-latitude westerlies)
show the closest agreement of the six -- consistent with section 9's
finding 1. **The tropical Pacific is the worst by far**: real trade winds
there average 8.3 m/s, while the model's `flow = -sin(phase)` term is
close to zero within a few degrees of the equator by construction
(`phase` is small there for any reasonable `circulationCellEdgeDeg`), so
the model gives almost no wind at all in a region that is, in reality, one
of Earth's most reliably windy. The Southern Ocean shows the same
underestimate as the 30-60S band above, for the reason already given.

## 11. Sign-convention check (Step 15)

Two independent checks, both passing:

- **Synthetic**: a model vector identical to a synthetic teacher scores
  exactly 0 degrees of direction error; the exact opposite vector scores
  exactly 180, not 0 -- the specific failure mode a "from" vs "toward"
  convention mixup would produce, since it would silently flip every
  comparison by 180 degrees without ever raising an error.
- **Real-data sanity**: the teacher's own 40-50N mean u is positive
  (+4.90 m/s, i.e. eastward -- the real westerlies), and its 10-20N mean u
  is negative (-3.51 m/s, i.e. westward -- the real trades). Both match
  known Earth climatology, confirming this project's own lat/lon/
  orientation handling (section 5) has no sign or axis bug independent of
  anything the model does.

## 12. Current model equation decomposition (Step 16)

From `windField` (`js/climate.js`) directly:

```
phase = pi * (latDeg - subsolarDeg) / cellEdgeDeg
flow = -sin(phase)                                    -- north-south overturning
turn = (pi/2) * tanh(coriolisStrength * spin * sin(latRad))   -- Coriolis deflection
east = flow * sin(turn)
north = flow * cos(turn)
spin = rotationDirection * REFERENCE_DAY_HOURS / dayLengthHours
cellEdgeDeg = min(90, circulationCellEdgeDeg / |spin|^cellRotationExponent)
```

- **`flow`** decides the *overturning* direction and relative strength: it
  is what makes a latitude either part of the rising branch (wet, weak
  zonal wind) or the equatorward/poleward branch (the actual trade/
  westerly/polar-easterly wind), and it is a pure function of how far the
  latitude sits from the belt's own zonal position, scaled by the cell
  width `cellEdgeDeg`.
- **`turn`** decides how much of that overturning flow gets rotated into
  an east-west wind by the planet's spin. It is exactly zero at the
  equator (`sin(0)=0`), saturates toward a quarter-turn (flow entirely
  zonal) at high `|spin*sin(lat)|`, and its sign follows both the
  rotation direction and the hemisphere.
- **`cellEdgeDeg`** (and therefore where each belt actually sits) depends
  on `|spin|`, i.e. on the rotation rate -- a slower rotator gets wider
  cells. This is a real, previously-established mechanism (Stage 7 of
  Climate v0.8), and it is why testing "does a slower rotation turn the
  flow less" needed care: the first version of that test inferred the
  turn angle from the resultant vector's own direction at a *fixed*
  latitude, and got a false failure, because changing `dayLengthHours`
  also moves the cell boundary and can flip which cell that fixed
  latitude falls into -- conflating a genuine turn-strength change with an
  unrelated cell-membership change. Fixed by testing the `turn` formula
  directly (see section 17 below and `tools/validate_wind_v1.mjs`).
- **`seasonal / ITCZ shift`**: `windField` itself takes a `subsolarDeg`
  argument that shifts `phase`'s reference latitude, and
  `itczShiftByColumn` (used only in `moistureField`, not in the wind field
  Stage 3 compares) additionally makes that shift vary by longitude. This
  document's comparison uses `subsolarDeg=0` throughout (the annual-mean
  case), so neither mechanism is exercised here; both remain untouched.

## 13. Answers to the diagnostic questions

**A. Is direction alone reasonably good?** Only partially. Mean error 56.5
degrees, median 29.5 -- distinctly better than a random direction (~90
degrees) but far from a close match, and badly wrong (over 100 degrees) at
both poles specifically.

**B. Is the latitude distribution of speed right?** No -- speed
correlation is weak at both levels (0.154 at 850hPa, 0.141 at 10m). The
model gets the broad *sign* pattern of the three-cell structure mostly
right (section 9) but not the *relative strength* pattern across
latitudes or hemispheres.

**C. Are the trades/westerlies/polar-easterlies positioned correctly?**
The trades and both hemispheres' westerlies are directionally
recognisable at roughly the expected latitudes. The polar easterlies are
not -- both polar bands score direction errors over 100 degrees, i.e. the
model's flow there points close to the *opposite* of what NCEP/NCAR
Reanalysis 1 shows at 850hPa.

**D. Is the model closer to 10m or 850hPa?** By every metric measured here
(speed correlation, RMSE, direction error), the two levels are close to
each other, with 850hPa direction slightly better and 10m speed error
slightly smaller. Neither is a clearly better match: the model's built-in
lack of friction predicted it should resemble the free troposphere more
than the surface, and while the numbers are close enough that this is not
strongly confirmed either, nothing here contradicts it, and section 3's
physical reasoning (no boundary-layer term in the formula) still stands
independent of which teacher scores marginally closer.

**E. Where is the error concentrated?** Three distinct sources, not one:

- **Hemisphere-symmetric formula vs. a genuinely asymmetric Earth**
  (section 9, finding 1) -- the Southern Ocean's real westerlies are
  roughly twice the model's, because nothing in the formula can
  distinguish "ocean-dominated hemisphere" from "continent-dominated
  hemisphere". Same structural shape as Stage 2's polar-symmetry finding
  in temperature.
- **A missing annual-mean-cancellation mechanism at the equator**
  (section 9, finding 2) -- the model's meridional (v) component near the
  equator is far larger than the real 30-year annual mean, because the
  model has no seasonal cycle to average over and cancel it the way real
  months do.
- **A poor match at the poles specifically** (section 9, finding 3) --
  direction errors over 100 degrees, the only finding here that is a sign
  error rather than a magnitude error, likely reflecting real polar-vortex
  and storm-track structure a three-idealised-cell model was never built
  to represent.

Coriolis turning itself (section 12) is not implicated as an error
source by this diagnosis -- it produces the right qualitative behaviour at
every latitude tested (weak at the equator, strongest at mid-latitudes,
exactly reversing with rotation direction) and the errors found instead
concentrate in `flow`'s own latitude/hemisphere shape and in the
model's lack of anything resembling the real polar circulation.

## 14. What is deliberately NOT done this round

Per the task's explicit stopping point: no `coriolisStrength`,
`circulationCellEdgeDeg`, `cellRotationExponent` or ITCZ parameter was
searched or moved; no continent- or region-specific correction was added;
no pressure field, ocean current, or land/sea drag term was built. The
single scale K is a unit-conversion fit for diagnosis only, applied
identically everywhere, and changes nothing about the model's shape.
Diagnostic PNGs (teacher/model/error maps) were not generated this round --
the numeric report above was judged sufficient for the decision this stage
exists to inform, and building an image-export path was not worth the
added scope for a diagnostic that is not going into the app's UI regardless.

## 15. What this means for a future wind-model stage

Not a design proposal -- a summary of what section 13's diagnosis actually
supports, for whoever designs the next stage to start from:

- A **hemisphere-aware** term (the wind equivalent of Stage 2's
  land/sea-aware polar-temperature suggestion) would address the largest
  single magnitude error found (the Southern Ocean/roaring-forties gap).
- The tropics' meridional overstatement suggests the *annual-mean* wind
  field itself may not be the right level to fit against at all --
  Climate v0.8 already has a seasonal wind mechanism (`subsolarDeg`,
  `itczFollowFraction`) that Stage 2's temperature findings suggest is
  currently tuned toward near-zero seasonality; a seasonally-resolved wind
  comparison (using the DJF/JJA teacher grids already built, not analysed
  this round) is a natural next measurement before any parameter is moved.
- The polar mismatch is the one finding here that does not look like
  "the right idea, wrong number" -- it may need a genuinely different
  mechanism (or an honest scope limit: "this model does not attempt to
  represent polar-vortex-driven flow") rather than a parameter adjustment.

None of this is decided here; Stage 3's job was measurement, and this
section only names what the measurements point toward.
