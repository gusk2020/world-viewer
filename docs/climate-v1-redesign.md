# Climate v1 redesign — Stage 0-1

## Why move on from Climate v0.8

Climate v0.8 (`js/climate.js`, still fully intact and unmodified in spirit —
see "What changed in `js/climate.js`" below) was built and tuned the whole way
by one method: fit `classifyPoint`'s final vegetation/snow/ice colour output
against Teacher A, then later Teacher B, and search or hand-adjust parameters
until the picture agreed. That method found real, useful things (the rain
shadow, the longitude-dependent ITCZ, the snow/sea-ice year-budgets) — but
`docs/climate-model-diagnosis-after-stage7_5.md` also showed its ceiling: a
latitude-only lookup table scores within half a point of the fitted model,
because nothing in the pipeline is ever checked against reality *before* it
reaches the final picture. A wind field can be wrong in a way the vegetation
score cannot see (Stage 7.5's rain shadow was measurably correct and the
search still turned related terms off, because nothing rewarded it directly).

Climate v1 is the same physical ideas, restructured so each stage produces a
named, independently-inspectable field *before* anything downstream touches
it — so a future round can ask "is the temperature field right?" or "is the
wind field right?" against real Earth data, separately from asking "is the
final picture green in the right places?". This is a foundation-and-
measurement round, not a rendering-improvement round: nothing the user sees
on their phone changes this round (see "What did not change" below).

## The pipeline, and where this round stops

```
terrain -> land/sea -> temperature -> wind -> moisture -> hydrology
        -> snow/ice -> vegetation -> rendering
```

Each stage is meant to be its own field, held in memory, comparable against
independent real-world data, and used as the *only* input the next stage is
allowed to read (never reaching back into the raw source data or a later
stage's output). This round (Stage 0-1) implements:

- **terrain** — `js/climate-v1/terrain.js`
- **land/sea** — folded into terrain's `isSea` field (splitting it out as a
  separate module would be one boolean array with no logic of its own; not
  worth a fifth file yet)
- **temperature** — `js/climate-v1/temperature.js`
- **wind** — a *diagnostic foundation* only: `js/climate-v1/wind-diagnostic.js`
  exposes and documents Climate v0.8's existing wind field and provides a
  real (not stubbed) comparison function, but implements no new wind model.

**Moisture, hydrology, snow/ice, vegetation and rendering are untouched this
round**, per the user's explicit instruction. Climate v0.8's own
`js/climate.js` pipeline (which still does all of this, fit directly to the
final image) continues to run exactly as before and is what the shipped app
still uses for its actual output.

## Where the code lives

`js/climate-v1/` is a new, separate directory. Nothing in it is imported by
`js/main.js`, `js/globe3d.js`, or any other file that affects what the app
draws — it exists only to be run by `tools/diagnose_climate_v1.mjs` (and by
any future browser-side diagnostic view) for inspection. `js/climate.js`
itself only changed by one small, verified-bit-identical extraction (below);
its own pipeline, its exports, and everything the app renders are unchanged.

- `js/climate-v1/terrain.js` — `TERRAIN_STATES`, `buildTerrainField`,
  `sampleTerrainCell`, `sampleTerrainAt`.
- `js/climate-v1/temperature.js` — `buildTemperatureField`,
  `sampleTemperatureCell`, `sampleTemperatureAt`, `latitudeOfRow`.
- `js/climate-v1/wind-diagnostic.js` — `currentModelWind`,
  `compareWindToTeacher`, re-exports `REFERENCE_DAY_HOURS`.
- `tools/diagnose_climate_v1.mjs` — a CLI script that builds all of the
  above against the real committed Earth data and asserts the properties
  this document and the task spec require, printing the results.

### What changed in `js/climate.js`

One extraction, nothing else. `classifyPoint` computed a point's annual-mean
temperature inline, in two places (a sea branch and a land branch), using the
same formula shape. That formula is now its own exported function,
`surfaceAnnualTemperatureC({ isSea, seaLevelC, relativeElevationMetres, params })`,
and `classifyPoint`'s two call sites call it instead of repeating the
arithmetic. This is the *only* edit made to the file — no formula changed,
no parameter changed, no behaviour changed.

**Verified bit-identical**, both ways:

- `scratchpad/itcz/hashfields.mjs`'s field hashes match exactly before and
  after, at both the default parameters and the real-season override set
  used throughout the Stage 7.5/ITCZ/snow-budget work.
- `node tools/score_climate.mjs` reports the same total, **63.4%**, matching
  every prior document that quotes this number.

The reason for extracting it rather than having `js/climate-v1/temperature.js`
re-derive the same arithmetic: two independent copies of "how a point's
temperature depends on relative elevation and sea/land" is exactly the kind
of duplication this project has been bitten by before (the bilinear elevation
sampler existed twice before the V0.6 cleanup, and the two seabed-ramp copies
in `paintBareRock`/`paintClimate` before Stage 3) — if they were ever edited
independently they would silently disagree about the same physical quantity.
Importing the one function Climate v0.8 already trusts means Climate v1's
temperature field is provably the same calculation, not a lookalike.

## Terrain and sea level

`buildTerrainField({ elevationGrid, seaLevelMetres, terrainState, terrainSourceLabel })`
takes the already-decoded elevation grid (`js/elevation.js`'s
`decodeElevationGrid` output — the same grid `js/climate.js`'s
`computeGeography` already reads) and produces, per cell:

| field | meaning |
| --- | --- |
| `sourceElevationMetres` | the raw grid value, untouched |
| `seaLevelMetres` | the scalar sea level this field was built against (one number, not duplicated per cell in memory — `sampleTerrainCell` still returns it per cell so the four-quantity contract holds at the API level) |
| `relativeElevationMetres` | `sourceElevationMetres - seaLevelMetres` |
| `isSea` | `sourceElevationMetres < seaLevelMetres` |

This is the field every later stage reads. **`verticalExaggeration`
(`js/globe3d.js`) never appears here or anywhere downstream of it** — that
constant only inflates the *displayed* mesh radius so relief is visible on
screen; every metre in Climate v1 is what the source data says, or a plain
subtraction of two such metres.

Rebuilding at a new sea level is a single pass over the grid (no PNG
re-decode), so it is cheap enough to do on every slider change, matching how
`js/globe3d.js` already treats sea level as a live parameter rather than a
load-time constant.

**Tested at four sea levels** (0m, +200m, −1000m, −6000m) by
`tools/diagnose_climate_v1.mjs`, over the *entire* 2048×1024 grid, not spot
checks: every cell's `relativeElevationMetres` exactly equals
`sourceElevationMetres - seaLevelMetres` and every cell's `isSea` exactly
equals `sourceElevationMetres < seaLevelMetres`. Land fraction moves the
expected direction and magnitude with sea level (34.1% at 0m, 25.6% at
+200m, 44.1% at −1000m, 99.5% at −6000m — consistent with the land fractions
already recorded for the same slider in `js/globe3d.js`'s own V0.6 notes).
Everest is confirmed never sea and the Mariana Trench never land at any of
the four levels.

## What the current Earth terrain data actually represents

Confirmed directly from `worlds/kasoku-sekai/config.json`'s own
`terrain.source` field, which already recorded this:

> `"GEBCO_2026 Grid (ice surface elevation), 15 arc-second, via CEDA"`

This means: **over Antarctica and Greenland, the committed elevation is the
top of the ice sheet, not the rock underneath.** Nothing in Climate v1
strips or alters that — `TERRAIN_STATES.ICE_SURFACE` names it explicitly and
is the only state this project has real data for, and `buildTerrainField`
defaults to it and carries the label through into the returned field
(`terrainState`, `terrainSourceLabel`) so any later stage or test can see
which surface a given field was built from without guessing.

Two further states are named, deliberately with no implementation:

- `TERRAIN_STATES.BEDROCK` — the rock surface under today's ice. No
  dataset is fetched or referenced anywhere in this codebase for it yet.
- `TERRAIN_STATES.DEGLACIATED_EQUILIBRIUM` — a bedrock surface additionally
  allowed to rebound under the removed ice's own weight (glacial isostatic
  adjustment, GIA). **Explicitly out of scope this round, and not
  approximated.** A real GIA computation needs a mantle-viscosity model,
  an ice-load history, and a solver; "lift the rock where the ice used to
  be" is not a substitute — it would be inventing a number with no physical
  basis, which contradicts this project's standing "real data over a
  plausible-looking fake" rule (the same rule that has driven every
  elevation/bathymetry decision since V0.6). These two names exist purely so
  a future round has an agreed vocabulary to slot real data into, without
  Climate v1's terrain contract needing to change shape.

## Temperature field

`buildTemperatureField({ terrainField, axialTiltDegrees, params })` builds
one `annualMeanTemperatureC` value per terrain cell, using only:

- `params.meanTemperatureC` (the global mean — the same slider value the
  app already exposes)
- latitude, implicit via each row's position and `axialTiltDegrees`
  (`temperatureProfile`, imported unmodified from `js/climate.js`, is the
  same annual-mean-insolation-by-latitude curve the shipped model already
  uses for Earth, Mars and the Moon alike)
- `relativeElevationMetres` and `isSea`, both read from the terrain field,
  never recomputed

via `surfaceAnnualTemperatureC` (see above): sea cells sit at
`meanTemperatureC + oceanModeration*(seaLevelC - meanTemperatureC)`; land
cells sit at `seaLevelC - lapseRateCPerKm*(relativeElevationMetres/1000)`.

**Nothing about vegetation, moisture, snow/ice or teacher data is reachable
from this file** — `surfaceAnnualTemperatureC`'s signature is
`{ isSea, seaLevelC, relativeElevationMetres, params }`, and
`js/climate-v1/temperature.js` imports nothing else from `js/climate.js`. A
future edit that tried to wire in a correction from a later stage would have
to change this file's imports to do it, which makes such a change visible
rather than silent.

**The relative-elevation requirement, asserted rather than assumed.**
`tools/diagnose_climate_v1.mjs` builds two terrain+temperature field pairs
for the same world — sea level 0m and sea level −1000m — and checks, at
Everest:

```
seaLevel    0m -> T = -16.28C
seaLevel -1000m -> T = -22.78C
relative elevation rose by 1000m; expected deltaT = -6.500C, actual = -6.500C
```

`-6.5 C` is `lapseRateCPerKm` at the shipped default, and it matches exactly.
The script additionally, explicitly, checks the negative control: Everest's
`sourceElevationMetres` is identical (6227m) at both sea levels, while its
temperature moved by 6.5C — proving the correction tracks *relative*
elevation (which changed, because sea level changed) rather than *absolute*
elevation (which did not). This is the specific "does the cascade actually
happen, not just look like it happened" assertion the task calls for; see
"Testing" below for why this is a real, not a hollow, test.

## Wind: what Climate v0.8's field actually is (from the code, not guessed)

Read directly out of `windField` in `js/climate.js`:

```
east[y] = flow * sin(turn)      north[y] = flow * cos(turn)
flow = -sin(phase),  phase = pi * (latDeg - subsolarDeg) / cellEdgeDeg
turn = (pi/2) * tanh(coriolisStrength * spin * sin(latRad))
```

- **It is dimensionless.** `flow` is a sine, so it is bounded to `[-1, 1]`
  by construction; `sin(turn)^2 + cos(turn)^2 = 1`; so
  `sqrt(east^2 + north^2) = |flow| <= 1` always. There is no calibration
  constant anywhere in this formula that converts it to metres per second.
  Confirmed numerically by `tools/diagnose_climate_v1.mjs`'s printed
  magnitudes at seven latitudes — every one is at or under 1.000.
- **It is a function of latitude alone, not a 2-D grid.** `windField` takes
  `rows`, not `width x height` — every column at a given latitude gets the
  same `(east, north)` pair. The longitude-dependent ITCZ mechanism
  (`itczShiftByColumn`, see `docs/itcz-longitude-experiment.md`) changes
  *which* of two precomputed latitude-only wind fields a column's moisture
  sweep uses (the row's own direction, or its mirror), a per-column choice
  between two fixed vectors — it does not produce or store a genuine 2-D
  wind grid anywhere.
- **Wind magnitude is never used to scale moisture transport.** Confirmed by
  reading every use of `speed` in `moistureField`: `speed = Math.hypot(eastV,
  northV)` is computed and used for exactly two things — a dead-calm check
  (`speed > 1e-6`) and normalising the direction (`eastV/speed`,
  `northV/speed`) before taking one *fixed-size* upwind grid step. How far or
  how much moisture moves per sweep does not depend on `speed`'s value at
  all, only on whether it is above the dead-calm threshold. So the model
  already treats "which way" and "how far" as separate questions — it simply
  has no real wind-speed number feeding either one yet.
- **There is no m/s correspondence anywhere in the codebase.** No constant,
  comment, or downstream calculation ties the `[-1, 1]` range to any real
  physical unit.

`js/climate-v1/wind-diagnostic.js`'s `currentModelWind()` is a thin,
labelled wrapper around this exact function (it imports and calls
`windField`, it does not reimplement it), returning the same arrays plus
`units: "dimensionless (0..1); NOT metres per second"` and
`varyByLongitude: false` so a caller cannot mistake it for more than it is.

### `compareWindToTeacher`: the comparison this round makes possible, not run

A real (not stubbed) function, `compareWindToTeacher({ modelWind, teacher,
modelSpeedScaleMS, minTeacherSpeedForDirectionMS })`, computing exactly the
five measures the task specifies:

- wind speed MAE (m/s)
- wind speed RMSE (m/s)
- u-component RMSE (m/s)
- v-component RMSE (m/s)
- mean direction-angle error (degrees), over teacher cells whose own wind
  speed is at or above `minTeacherSpeedForDirectionMS`

`teacher` is any `{ width, height, u, v }` grid in real m/s — the function
does not know or assume where it came from, so it is ready for whichever
dataset below is actually fetched in a future round. `modelSpeedScaleMS` is
an explicit, named "if the model's dimensionless flow of 1.0 meant this many
m/s" input, defaulting to 1 (i.e. "compare the raw dimensionless number to
real m/s, unscaled") precisely so no calibration is silently assumed by a
default — the model having no real wind-speed number yet stays an honest,
visible fact rather than something a default papers over.

**Direction is excluded below a speed threshold** because a near-calm real
wind's direction is mostly noise: cells where `teacherSpeedMS <
minTeacherSpeedForDirectionMS` are counted in
`directionExcludedCount` and skipped for the angle average, rather than
diluting it. **No specific threshold value is chosen as final this round**,
per the task's explicit instruction not to arbitrarily optimize it yet.
Candidate values worth considering in a future round, for reference:

- **0.5 m/s** — near the low end of what most reanalysis products still
  resolve meaningfully; keeps almost all ocean/land cells.
- **1.0 m/s** (the diagnostic script's default) — a light-air threshold;
  excludes only genuinely calm cells (doldrums, sheltered basins).
- **2-3 m/s** — a stricter cut sometimes used in wind-validation literature
  to avoid instrument/model noise dominating near calm; would exclude more
  of the deep tropics, which is exactly where this app's ITCZ work is most
  interested in getting direction right, so a stricter threshold trades away
  signal in the region this project cares about most.

**Self-tested this round on a synthetic 8x8 grid** (explicitly labelled as
not real data, inside `tools/diagnose_climate_v1.mjs`): a perfect-match case
(all errors zero), a 90-degree rotation case (confirms the angle metric
reports ~90 degrees, not 0 or something degenerate), and a near-calm case
(confirms cells below the threshold are excluded from direction but still
counted in speed/u/v). This proves the comparison function itself is
correct, independent of whether any real teacher grid has been fetched yet.

**No wind "quantity/volume" was created.** Only direction and speed (m/s)
are represented anywhere in `js/climate-v1/`. A future stage may want a
vertically-integrated moisture-transport quantity (wind x atmospheric
moisture, sometimes called IVT in the literature) once a real wind field and
a real moisture field both exist — noted here as a future relationship,
**not implemented, and not even stubbed**, this round.

## Teacher data investigated

### Temperature

Priorities, as given: public/reproducible, GitHub-Actions-fetchable,
no-auth preferred, global, capable of an annual climatology, clear license.

| candidate | reachable from this sandbox | reachable from GitHub Actions (expected, per this project's established pattern) | auth | notes |
| --- | --- | --- | --- | --- |
| **Berkeley Earth** (`Land_and_Ocean_LatLong1.nc`, 1x1 degree monthly, `berkeley-earth-temperature-hr.s3.amazonaws.com`) | **yes — confirmed `200 OK` via direct `curl`** | yes (public S3) | none | The strongest candidate found. A public S3 bucket, not a dedicated geodata host, which is almost certainly *why* it is reachable here where every other candidate is blocked. License text was not able to be confirmed by a keyword grep of the fetched page content this round (no "licen"/"CC BY" string found in what could be retrieved) — **this needs re-confirming from Berkeley Earth's own documentation before final adoption**, stated here honestly rather than assumed. |
| ERA5 (Copernicus CDS) | no — `403 Forbidden` | expected yes, but needs a CDS API key | required (API key) | The task explicitly says not to force-adopt ERA5 if it needs auth that can't be automated. A CDS key *can* be stored as a GitHub Actions secret, so this is not ruled out forever — but it adds a credential-management step Berkeley Earth does not need, so it is not the first choice. |
| NOAA PSL (NCEP/NCAR Reanalysis 1, surface air temp) | no — `403 Forbidden` | expected yes (this project's GEBCO/Köppen/planetary-DEM fetches all used the same "blocked here, fetchable from a runner" pattern) | none | A reasonable second candidate specifically because it is the *same product family* as the wind candidate below — one provenance story for both temperature and wind, if a future round wants that. |
| NASA GISTEMP | no — `403 Forbidden` | expected yes | none | Anomaly-focused (not an absolute climatology) — would need combining with a baseline climatology to get absolute annual-mean temperature, more work than Berkeley Earth's direct field. |
| NCAR RDA | no — `403 Forbidden` | expected yes, some datasets need a free registration | varies | Not pursued further this round; Berkeley Earth already satisfies the no-auth requirement. |
| IRI/LDEO Data Library | no — `403 Forbidden` | untested | none advertised | Not pursued further; redundant with the above once Berkeley Earth was confirmed reachable. |

**Recommendation for a future round**: fetch Berkeley Earth's
`Land_and_Ocean_LatLong1.nc` from a GitHub Actions runner (same pattern as
`build-terrain.yml`/`build-teacher.yml`), average its monthly climatology
fields to an annual mean, and confirm its license terms directly from
Berkeley Earth's own site before committing anything derived from it. Not
done this round — no data was fetched, and this document states that fact
rather than a placeholder number.

### Wind

Priorities: global u/v (not direction alone), a stated altitude/level,
reproducible, ideally GitHub-Actions-fetchable.

| candidate | level(s) | reachable from this sandbox | notes |
| --- | --- | --- | --- |
| **NCEP/NCAR Reanalysis 1** (NOAA PSL) | 10m (`uwnd.10m`/`vwnd.10m`) and multiple pressure levels including 850hPa | no — `403 Forbidden`, same host family as the temperature candidate above | The leading candidate: it is the same product line already established as fetchable from a GitHub Actions runner in this project's own past pattern (though not yet actually probed for this specific dataset — see "next step" below), it publishes both a near-surface (10m) and a lower-troposphere (850hPa) field from one source, and it has a long, well-documented, public-domain-leaning license. |
| ERA5 | 10m and pressure levels | no — `403 Forbidden` | Same auth caveat as the temperature case; not the first choice for the same reason. |

**10m vs 850hPa, and why they answer different questions.** 10m wind is
what a surface station or a simple surface-climate map would show — it is
strongly shaped by local friction (mountains, coastlines, forests) and is
the right level for **(A) a future surface-wind display**, since that is
what "what does the wind do at ground level here" means to someone looking
at a map. 850hPa (roughly 1.5km up) sits above most surface friction and is
closer to the large-scale overturning-cell pattern (`windField`'s own
Hadley/Ferrel/polar-cell shape is a *large-scale*, friction-free
idealisation) — it is the more appropriate level for **(B) a future
moisture-transport model**, since large-scale moisture advection is driven
by the free-tropospheric flow, not by the friction-slowed layer right at the
ground. **Proposal, not implemented**: keep these as two potentially
separate future fields (`surfaceWind` for display, `transportWind` for
moisture) rather than forcing one field to serve both purposes — noted here
for a future round to decide, not decided now.

**Next step, not done this round**: a throwaway GitHub Actions probe
(`curl`/`gdalinfo` or the NetCDF equivalent), the same technique used to
establish the GEBCO/CEDA layout in V0.6 and the planetary-DEM layout in
V0.7, to confirm NCEP/NCAR Reanalysis 1's exact file layout and whether it
is genuinely reachable from a runner before committing to it. Not run this
round because fetching real data is explicitly out of scope for Stage 0-1 —
this section documents the candidate and the reasoning, not a completed
fetch.

## What did not change

Explicitly verified, not assumed:

- `js/climate.js`'s only change is the `surfaceAnnualTemperatureC`
  extraction, confirmed bit-identical (field hashes + `score_climate.mjs`
  total, both above).
- No file under `js/climate-v1/` is imported by `js/main.js`, `js/globe3d.js`,
  `js/map2d.js`, or any other file the shipped app loads — grepped for
  `climate-v1` outside of `js/climate-v1/` and `tools/diagnose_climate_v1.mjs`
  itself; no matches.
- Nothing about vegetation, snow/ice, moisture, hydrology, rivers, lakes,
  wetlands, GIA, ITCZ tuning, or parameter search was touched.
- No parameter search of any kind ran this round.
- Teacher A and Teacher B are unmodified.
- The current default climate set is unmodified.
- No large-scale refactor of `js/climate.js` was performed.

## Testing

`tools/diagnose_climate_v1.mjs` runs entirely in Node against the real
committed `worlds/kasoku-sekai` elevation raster and resolved default
climate parameters (no browser needed for this round's new code, since none
of it touches rendering yet). It:

1. Builds terrain fields at four sea levels and asserts, over the **entire**
   2048x1024 grid at each level (not spot samples), that
   `relativeElevationMetres === sourceElevationMetres - seaLevelMetres` and
   `isSea === (sourceElevationMetres < seaLevelMetres)` for every cell, plus
   point checks that Everest is never sea and the Mariana Trench never land.
2. Builds terrain+temperature fields at sea level 0m and -1000m and asserts
   the lapse-rate delta at Everest matches the expected value to within
   1e-3 C, **and** asserts the negative control that Everest's absolute
   elevation is unchanged between the two runs while its temperature moved
   by more than 1 C — the specific "the cascade actually happened, not just
   the display" proof the task requires. This is a real value assertion on
   the underlying arrays, not a rendered-pixel or visual check, so it is not
   the kind of hollow test ("表示だけ変わる空振りテスト") the task rules out.
3. Prints the current model's dimensionless wind by latitude, for visual
   sanity against the documented formula.
4. Self-tests `compareWindToTeacher` against a synthetic grid (perfect
   match, 90-degree rotation, near-calm exclusion), proving the comparison
   function is correct ahead of any real teacher data.

The full existing-app regression (3D, 2D, Earth/Mars/Moon, the sea-level and
mean-temperature sliders, the Phase E climate comparison buttons, Teacher
A/B, and the no-WebGL-context-leak check) was re-run using the project's
established Playwright harness before committing, since `js/climate.js`
itself changed (even though only by the verified-bit-identical extraction) —
see the commit for the confirmed results.

## Stopping point

Per the task's explicit instruction, this round stops here: a foundation
exists that can build terrain, land/sea, and temperature fields from real
data and inspect them independently, and a real (not stubbed) comparison
function exists for wind — but no wind model design or optimization begins
this round, and no real teacher grid was fetched. The next round should
start from this round's own findings (which datasets are actually reachable
from a GitHub Actions runner, and what the baseline errors are once a real
teacher grid is fetched) rather than guessing at a wind model's shape in
advance.
