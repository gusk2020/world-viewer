# Climate v1 Stage 2 -- temperature field validation

Stage 0-1 built `js/climate-v1/temperature.js` but never checked it against
anything real. Climate v0.8's whole history is fitting to the *final*
vegetation picture; this stage asks a narrower, more honest question first:
**how close is the temperature field itself to the real Earth**, independent
of everything downstream. Nothing about wind, moisture, snow/ice, vegetation,
or Teacher A/B is touched this round.

## 1. Why Berkeley Earth, over the alternatives

| candidate | global coverage | land | ocean | resolution | climatology | fetch | auth | license |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Berkeley Earth Land+Ocean** | yes | station-based near-surface air temp | SST, air-temperature-equivalent | native 1x1 degree, monthly, 1850-2024 | build any period from baseline+anomaly | **direct HTTP GET from this sandbox, confirmed** (a plain public S3 object, not a dedicated geodata host) | none | CC BY-NC 4.0 |
| ERA5 (Copernicus CDS) | yes | 2m air temp | SST-driven | 0.25 degree | any | needs the CDS API | **API key required** | free, but the auth step is exactly what the task says not to force through |
| NOAA/NCEP Reanalysis 1 | yes | 2m/skin/sigma-level air temp | boundary SST (from a separate product) | 2.5 degree (T62) | 1981-2010 `.ltm` files exist | blocked here (`403`), expected reachable from a GitHub Actions runner per this project's own established pattern (GEBCO, Köppen) | none | US federal work, effectively public domain |
| NASA GISTEMP | yes | station-based | ERSST-blended | 2x2 degree | anomaly-only, no absolute climatology shipped | blocked here (`403`) | none | public domain |

**Chosen: Berkeley Earth**, and not simply because it was the one host this
sandbox could reach directly (that would be "take what's easy," which the
task explicitly rules out) -- it also wins on two substantive points:

1. **It is the only candidate whose land and ocean values are already one
   physically-matched field**, not two products stitched together (see
   section 3). NOAA/NCEP's ocean boundary values come from a different
   product than its land air temperature; GISTEMP is anomaly-only.
2. **It is directly reachable, verified by a real GET, not assumed** --
   `curl -I` against
   `https://berkeley-earth-temperature.s3.amazonaws.com/Global/Gridded/Land_and_Ocean_LatLong1.nc`
   returned `200 OK`, `Content-Length: 454568996`, `Last-Modified: 2025-01-10`.
   Every other candidate above returned `403 Forbidden` from this session.

NCEP/NCAR Reanalysis 1 remains a reasonable second choice for a future round
that wants a reanalysis-family product instead of a station-blend, fetched
the way GEBCO and the Köppen teacher were (a GitHub Actions runner). ERA5 is
not ruled out forever, but needs a CDS API key stored as a repository secret
before it can be automated -- a real authentication step, which is exactly
the case the task says to route around rather than force.

**License compliance**: Berkeley Earth's data is Creative Commons BY-NC 4.0
-- attribution required, non-commercial use only. This repository commits
only a small derived grid (259 KB, not the 434 MB source file), with the
product, variable, resolution, and reference period stated in
`worlds/kasoku-sekai/teacher/temperature-summary.json`, which is exactly what
a CC BY-NC 4.0 derivative is asked to state. This project is a personal,
non-commercial hobby app; re-confirm licensing before any commercial use.

## 2. What was actually fetched

`Land_and_Ocean_LatLong1.nc`, Berkeley Earth's native 1x1 degree monthly
grid, downloaded directly (no GitHub Actions round-trip needed for this
one file, since it is reachable from here). Inspected with `netCDF4` before
using it -- not assumed:

- `climatology(month=12, lat=180, lon=360)`: "Air Surface Temperature
  Climatology (Jan 1951 - Dec 1980)" -- Berkeley Earth's own fixed absolute
  baseline.
- `temperature(time=2100, lat=180, lon=360)`: monthly anomaly from the same
  baseline, January 1850 through December 2024.
- `land_mask(lat=180, lon=360)`: land fraction 0-1, Berkeley Earth's own
  (used only as an independent cross-check in the summary JSON -- the
  model/teacher comparison itself uses Climate v1's own `isSea`, from the
  same GEBCO raster the globe's shape already uses, so the comparison is
  fair to what the model itself believes is land or sea).

## 3. Matching physical quantities: land vs. sea

This mattered enough to check directly rather than assume one variable would
do. Berkeley Earth's own documented convention: the `temperature`/
`climatology` variable is **not** raw station data over land pasted onto raw
SST over the ocean -- land cells are near-surface (~2 m) air temperature
from station records, and ocean cells are sea-surface temperature converted
to an **air-temperature-equivalent** basis, specifically so the two halves
of the map are physically comparable at the coastline. That is a closer
match to what `surfaceAnnualTemperatureC` computes (one continuous "surface
temperature" field, with the land and sea branches using different physical
processes to reach it) than a hand-merge of a separate land product and a
separate raw-SST product would have been. **No land/sea split was forced
this round** -- Berkeley Earth's own file already made that physical choice,
and this validation reuses it as-is rather than re-deriving a different one.

## 4. Climatology period

**1991-2020**, a standard, current 30-year normal, built by Berkeley Earth's
own documented method: their fixed absolute baseline (Jan 1951 - Dec 1980,
shipped in the same file) plus the mean monthly anomaly over Jan 1991 - Dec
2020 (from the same file's anomaly time series). This is not an attempt to
land near the model's 14 C slider default -- the teacher's own global mean
was measured first, independent of that number (see below), and it did not
need to be steered toward it.

## 5. Baseline: Climate v1's temperature field vs. the teacher

Built with `tools/validate_temperature_v1.mjs`, sampling the model's
temperature field (full elevation resolution, sea level 0 m, the world's
shipped default climate parameters) at each of the teacher's 64,779 finite
1-degree cells, area-weighted by cos(latitude).

**Global**: bias **-0.279 C**, MAE **3.089 C**, RMSE **3.880 C**, r **0.963**.
A strong overall correlation with real Earth temperature, for a model whose
temperature term was never fitted to temperature -- it was fitted, back in
Stage 1/7, to the *vegetation* picture.

**Land vs. sea**:

| | bias | MAE | RMSE | r | n |
| --- | --- | --- | --- | --- | --- |
| land | -0.052 | 3.337 | 4.409 | 0.972 | 22107 |
| sea | -0.373 | 2.987 | 3.639 | 0.974 | 42672 |

Land's bias is nearly zero (warm and cold errors cancel on average); the
sea runs very slightly cold. Both correlate strongly.

**Latitude bands**:

| band | bias | MAE | RMSE | r |
| --- | --- | --- | --- | --- |
| 90-60N | -0.884 | 5.744 | 6.742 | 0.569 |
| 60-30N | -0.875 | 3.001 | 3.717 | 0.891 |
| 30-0N | -2.060 | 2.872 | 3.204 | 0.718 |
| 0-30S | -1.018 | 2.438 | 2.757 | 0.709 |
| 30-60S | +1.954 | 2.405 | 3.133 | 0.944 |
| 60-90S | +5.271 | 5.788 | 6.936 | 0.961 |

**A real, honest, hemispherically-asymmetric finding**: the Arctic band runs
too cold (bias -0.884) while the Antarctic band runs markedly too warm
(bias +5.271) -- opposite signs at the two poles. `polarExtraC`
(`sin^2(latitude)`) cannot distinguish hemisphere, so this asymmetry cannot
be a pure artefact of that term alone; it reflects a real physical
difference (Antarctica is a much higher, larger, more centrally-placed ice
sheet than the Arctic's mostly-ocean cap) that a purely-latitude model has
no way to see. See section 7's regional numbers and section 9's regression
for more on this.

**Altitude bands (land only)**:

| band | bias | MAE | RMSE | n |
| --- | --- | --- | --- | --- |
| 0-500m | +0.130 | 3.084 | 3.953 | 10348 |
| 500-1500m | -0.488 | 2.523 | 3.429 | 5325 |
| 1500-3000m | -0.535 | 4.632 | 5.678 | 4396 |
| 3000m+ | +1.468 | 8.326 | 9.036 | 2038 |

The highest band (3000m+, mostly the Tibetan Plateau, the Andes, and the
Antarctic/Greenland ice-sheet interiors) has by far the largest error --
expected, since this is also where the ice-surface-vs-bedrock question
(section 8) and the sharpest real microclimate effects (katabatic winds,
persistent temperature inversions over ice) live, none of which a
latitude+elevation-only model can represent.

## 6. Determinism

`tools/validate_temperature_v1.mjs` rebuilds the terrain and temperature
fields a second time from the same inputs and compares every cell of
`annualMeanTemperatureC` byte for byte against the first build. **OK** --
identical on every run. This is the "did the cascade really happen, not just
look like it" proof the task requires, applied here to reproducibility
rather than to sea-level: the same physical inputs must always produce the
same field, with no hidden state.

## 7. Regional diagnosis (not a calibration target)

| region | teacher C | model C | bias | n |
| --- | --- | --- | --- | --- |
| Sahara | 24.2 | 24.0 | -0.2 | 600 |
| Amazon | 28.1 | 31.5 | +3.4 | 240 |
| Europe | 11.6 | 6.5 | -5.2 | 800 |
| Siberia | -6.4 | -7.8 | -1.4 | 1200 |
| Tibet | -1.9 | -7.9 | -6.1 | 200 |
| Himalaya | 9.6 | 4.8 | -4.8 | 80 |
| India | 27.0 | 25.0 | -2.0 | 255 |
| East Asia | 16.2 | 16.7 | +0.5 | 440 |
| North America | 10.5 | 11.4 | +0.9 | 600 |
| Greenland | -18.4 | -26.3 | -7.9 | 300 |
| Antarctica | -21.8 | -16.0 | +5.8 | 9000 |
| tropical Pacific | 26.4 | 24.6 | -1.8 | 500 |

The two largest errors are the two polar ice sheets, in **opposite
directions** -- Greenland 7.9 C too cold, Antarctica 5.8 C too warm -- the
same asymmetry the latitude-band table already showed, now localised to the
two places actually causing it rather than smeared across a whole
hemisphere's band average. Europe, Tibet and the Himalaya are all too cold
by several degrees; the Amazon is a few degrees too warm. Sahara, East Asia,
North America, and India are all within about 2 C.

These boxes are diagnostic only -- nothing in `tools/validate_temperature_v1.mjs`
uses them as a fitting objective, per the task's explicit rule against
place-by-place correction.

## 8. The ice-surface terrain question, and why it does not bias this comparison

Earth's committed terrain is GEBCO_2026's **ice-surface** elevation (see
`docs/climate-v1-redesign.md`) -- over Greenland and Antarctica, the
elevation used is the top of the ice, not the bedrock underneath. This is
not a bug for a *temperature* comparison, and it is worth being precise
about why: the lapse-rate correction asks "how high is the surface actually
exposed to the atmosphere," and for an ice sheet, that surface **is** the
ice surface -- bedrock elevation would be the physically wrong quantity to
use here, not the right one. So this validation's use of ice-surface terrain
for the lapse-rate correction over Greenland and Antarctica is correct, not
a compromise.

What ice-surface terrain does **not** capture, and what may still be
contributing to Greenland/Antarctica's large errors, is everything a real
ice sheet's surface energy balance does that a plain lapse rate cannot: a
persistent temperature inversion (the near-surface air over an ice sheet is
often *colder* than a simple lapse-rate extrapolation from sea level would
predict, because the ice surface radiates heat away efficiently under clear
polar skies), katabatic drainage winds, and the sheer areal extent and
centrality of the Antarctic plateau versus the Arctic's mostly-ocean cap.
None of these are terrain-data problems; they are real physical processes a
model with only latitude, tilt, elevation, and land/sea has no way to
represent. Flagged here as the honest limit of what this stage's inputs can
explain, not something to patch with an ice-specific correction (which
would be exactly the "それっぽい補正" the task rules out).

## 9. Parameter-term decomposition

`surfaceAnnualTemperatureC`'s formula splits cleanly into named, additive
terms (see `js/climate.js`'s `temperatureProfile`):

- **land**: `meanTemperatureC + insolationSensitivityC*anomaly(lat) + polarExtraC*sin^2(lat) - lapseRateCPerKm*(relativeElevationMetres/1000)`
- **sea**: `meanTemperatureC + oceanModeration*(insolationSensitivityC*anomaly(lat) + polarExtraC*sin^2(lat))`

`tools/validate_temperature_v1.mjs` reconstructs these terms independently
(reusing the real exported `annualInsolationByLatitude`, not a second copy
of the normalisation arithmetic) and **asserts** the reconstruction matches
`temperatureProfile`'s own output at seven latitudes before trusting it for
anything -- so this decomposition cannot silently drift from what the model
actually computes.

A weighted least-squares regression of the residual (model - teacher)
against these terms' own latitude-shape (excluding `meanTemperatureC`,
which has no shape to regress against) gives:

```
residual = a0 + a1*insolationAnomaly + a2*sin^2(lat) + a3*elevationKm(land) + a4*isSea
a0 (offset)          = -1.447
a1 (insolation slope) = -1.292
a2 (polar)            = +4.251
a3 (lapse, land)      = -0.420
a4 (sea)              = -0.215
R^2 of this decomposition against the residual = 0.156
```

Read carefully, not at face value: `a2`'s large positive coefficient says
the residual trends warmer as `sin^2(lat)` grows -- but `sin^2(lat)` is the
same value at +75 and -75 degrees, while the actual residual has *opposite
signs* at the two poles (section 5). A single linear coefficient against a
hemisphere-blind term necessarily averages those two opposite signs
together, so `a2` alone cannot be read as "polarExtraC is simply too weak or
too strong" -- it is evidence that *something* correlates with high
latitude, not evidence of which direction to move a hemisphere-symmetric
knob. The R^2 of 0.156 is itself informative: these four physical terms
explain only about 16% of the residual's own variance, meaning most of the
remaining error is **not** a smooth function of latitude/elevation/land-sea
at all -- it is the kind of place-specific structure (a real ice sheet's
energy balance, a specific mountain range's microclimate) no amount of
recalibrating these particular knobs can reach.

## 10. Diagnosis before calibrating

Per the task's own ordering: diagnose first, decide whether calibration is
warranted, calibrate only if it clearly is.

- **(A) global offset**: small (-0.279 C bias globally). Not the main
  source of error.
- **(B) latitude gradient**: real. The tropics run 1-2 C too cold and the
  southern mid-latitudes run about 2 C too warm -- a shape the flat
  `insolationSensitivityC` term does not fully capture.
- **(C) altitude correction**: contributes at the highest band (3000m+,
  MAE 8.3 C) but the regression's small `a3` coefficient (-0.420) says it is
  not the dominant explanation even there -- the 3000m+ band's error is
  more plausibly the same ice-sheet/microclimate effects from section 8
  than a wrong lapse rate.
- **(D) land/sea difference**: small (land bias -0.05, sea bias -0.37;
  `a4` = -0.215). Not a major source.
- **(E) polar**: real, but **hemispherically asymmetric** -- a genuine
  structural limit for any model whose only latitude-dependent terms are
  symmetric in latitude (`anomaly(lat)` and `sin^2(lat)` both are). This is
  the single largest identified error concentration (Greenland -7.9,
  Antarctica +5.8).
- **(F) other**: the R^2 = 0.156 finding above -- roughly 84% of the
  residual's variance is not explained by any of these four terms' own
  latitude/elevation shape, meaning much of what remains is genuinely
  place-specific rather than a mis-set global slope.

**Conclusion**: the baseline correlates strongly with reality (r = 0.963)
and is not badly broken, but there is a real, measurable, and partially
structural latitude-shape error worth quantifying with a small calibration
-- not because the baseline is bad, but because sections 11-12 below show a
genuine, side-effect-checked improvement is available cheaply.

## 11-12. Calibration: two variants, measured, neither deployed

Exactly the three knobs the task names as candidates
(`insolationSensitivityC`, `polarExtraC`, `oceanModeration`) were tried,
never `lapseRateCPerKm` (kept at the physical 6.5 C/km) and never
`meanTemperatureC` (the user's slider; its gap from the teacher's own global
mean is reported as bias, not closed by moving it). A single-parameter sweep
was run for each knob first, then a **small brute-force grid search** over
the chosen combination (13 steps per axis for two knobs, 9 for three --
169 or 729 evaluations, each a full field rebuild, a few tens of seconds
total). Both variants ran on a geographic checkerboard split of the
teacher's own cells (`(x+y) even` = calibration half, `odd` = validation
half), and every number below is reported on **both halves separately** so
an improvement that only helped the cells it was chosen on would be visible
as such.

**A real search-method mistake, corrected before trusting any result from
it.** The first implementation used a greedy coordinate descent (optimise
one knob, then the next, repeat). It found `insolationSensitivityC=91.29,
oceanModeration=0.718` (two-knob) and, when `polarExtraC` was also
searched, pushed it to `12` -- the schema's own ceiling. That three-knob
result looked like a structural dead end: it improved the global MAE but
made the **Arctic band's MAE worse** (5.735 -> 6.071), exactly the kind of
"fixes Antarctica by breaking the Arctic" trade-off section 9's asymmetry
discussion would predict from a hemisphere-blind term pushed to its limit.
Before writing that up as a genuine finding, the search itself was
re-examined: `insolationSensitivityC` and `oceanModeration` both shape the
same equator-to-pole contrast (one directly, one by how much of it the sea
keeps), so a greedy, order-dependent search over two interacting knobs is
not reliable, and it was replaced with a full grid search over the same
ranges. **The grid search found a different, better point, and the "pushed
to the ceiling" story evaporated**: `polarExtraC`'s true optimum in the
three-knob search is `7.38` -- *lower* than the shipped `10.76`, not at any
boundary. This is recorded here because it is the same lesson this project
keeps relearning (Stage 1, Stage 2, Stage 7 of Climate v0.8 all hit some
version of "a search artefact looked like a real structural limit until it
was checked") -- and this time it was caught before being reported as a
conclusion rather than after.

### Two-knob (insolationSensitivityC + oceanModeration; polarExtraC frozen)

Candidate: `insolationSensitivityC = 80.68` (from 84.92), `oceanModeration
= 0.818` (from 0.568).

| | before MAE | after MAE |
| --- | --- | --- |
| calibration half | 3.091 | 2.241 |
| validation half | 3.087 | 2.237 |

Improves **every** latitude band on the held-out validation half, with no
exception:

| band | before | after |
| --- | --- | --- |
| 90-60N | 5.735 | 4.343 |
| 60-30N | 3.004 | 2.826 |
| 30-0N | 2.867 | 1.406 |
| 0-30S | 2.437 | 1.656 |
| 30-60S | 2.405 | 1.968 |
| 60-90S | 5.784 | 4.532 |

The near-identical calibration/validation numbers (2.241 vs 2.237) show
this is a genuine, generalising improvement, not overfitting to the
calibration half's specific cells.

### Three-knob (also searches polarExtraC)

Candidate: `insolationSensitivityC = 72.19`, `polarExtraC = 7.38` (from
10.76), `oceanModeration = 0.868`.

| | before MAE | after MAE |
| --- | --- | --- |
| calibration half | 3.091 | 2.170 |
| validation half | 3.087 | 2.170 |

| band | before | after |
| --- | --- | --- |
| 90-60N | 5.735 | 4.243 |
| 60-30N | 3.004 | 3.023 (**+0.019, essentially noise**) |
| 30-0N | 2.867 | 1.574 |
| 0-30S | 2.437 | 1.393 |
| 30-60S | 2.405 | 1.513 |
| 60-90S | 5.784 | 4.698 |

A slightly better global result than the two-knob variant, at the cost of a
0.019 C (0.6%) MAE increase in exactly one band -- within the noise of how
arbitrary the 30-degree band edges and the checkerboard split are. Neither
variant is a clean strict improvement over the other on every individual
band; both are clear, substantial, side-effect-checked improvements over the
shipped baseline (27-30% lower global MAE).

**Neither candidate is applied to `worlds/kasoku-sekai/config.json`.**
Changing Climate v0.8's shipped default is explicitly out of scope this
round -- both are recorded here as measured findings for whoever next
revisits Climate v0.8's own fitted parameters (or a later Climate v1 stage
that does propagate a calibration forward) to start from, not as something
this round adopts.

## 13. What is still wrong, honestly

- **The Arctic/Antarctic asymmetry (section 5, 7, 9)** is the largest single
  finding and is not something either calibration variant fully resolves --
  both still leave the poles as the two worst-performing bands even after
  improvement. A hemisphere-symmetric model has a real, structural ceiling
  here that no amount of recalibrating these three knobs can cross; the
  next real step would be a term that can distinguish "large polar ice
  sheet on land" from "small polar ice cap mostly on ocean," which is a
  land/sea-*aware* polar correction, not currently in the model at all
  (`polarExtraC` today makes no distinction).
- **Tibet, the Himalaya, and Europe run several degrees too cold**; the
  Amazon runs a few degrees too warm. These sit inside the 84% of residual
  variance section 9's regression could not explain by latitude/elevation/
  land-sea alone -- real, place-specific structure this model's inputs
  (terrain, latitude, tilt, land/sea, one global mean) cannot represent by
  construction, not a mis-set number.
- **R^2 = 0.156** for the four-term decomposition is itself the headline
  number to remember: even a perfect recalibration of every searchable
  knob in this formula could only ever address a small fraction of the
  total error, because most of the error is not a smooth function of the
  quantities this formula has access to.

## 14. Climate v1 temperature field: final definition for this round

Unchanged from Stage 0-1, and reaffirmed here after validation:

```
buildTemperatureField({ terrainField, axialTiltDegrees, params })
  -> { width, height, annualMeanTemperatureC, seaLevelCByProfileRow, profileRows, seaLevelMetres }
```

- **Inputs**: `params.meanTemperatureC` (global mean, the user's slider),
  latitude (via each row's position and `axialTiltDegrees`),
  `terrainField.relativeElevationMetres`, `terrainField.isSea`. Nothing
  else -- confirmed again this round: no vegetation, moisture, snow/ice,
  or teacher array is reachable from `js/climate-v1/temperature.js`.
- **Formula**: `surfaceAnnualTemperatureC` (`js/climate.js`), unchanged
  from Stage 0-1, validated but not recalibrated this round.
- **Validated performance** (Earth, sea level 0m, shipped default
  parameters): global bias -0.28 C, MAE 3.09 C, RMSE 3.88 C, r = 0.963.
- **Known, quantified limits**: a hemispherically-asymmetric polar error
  (section 5/7/9) and a large unexplained-by-latitude residual (R^2 = 0.156,
  section 9) that any future refinement of this formula should be measured
  against, using this same teacher and this same script.
- **Not changed this round**: the shipped Climate v0.8 default
  (`worlds/kasoku-sekai/config.json`'s `climate` block) is untouched. Two
  calibration candidates are recorded (section 11-12) for a future round to
  consider deploying, or not.

## 15. Regenerating the teacher

`tools/build_temperature_teacher.py` (needs `numpy` and `netCDF4`) rebuilds
`worlds/kasoku-sekai/teacher/temperature-annual-mean-c.bin` and
`temperature-summary.json` from a fresh download of the source file, or from
a local copy via `--source`. `.github/workflows/build-temperature-teacher.yml`
runs it from the Actions tab, for the usual reason: the project's owner only
has a phone.
