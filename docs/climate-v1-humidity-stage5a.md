# Climate v1 Stage 5A — the thermodynamic foundation of humidity

Stage 5A of the Climate v1 redesign (terrain → land/sea → temperature →
wind → **humidity capacity** → transport → …). It adds one module,
`js/climate-v1/humidity.js`, and nothing else in the app changes: Climate
v0.8 is untouched, `worlds/kasoku-sekai/config.json` is byte-identical, and
nothing here is wired to the UI.

---

## 1. What this stage is, and what it is not

**This is the single most important thing to understand before reading any
number below.**

Stage 5A computes **saturation specific humidity** — how much water vapour
air *could* hold at a given temperature and pressure. That is a **capacity**,
not a state. It is a property of thermodynamics, not of a climate.

It is therefore **not a model of the real humidity distribution**, and must
not be treated as one. The humidity the air actually carries depends on
where water evaporates, how the wind carries it, and where it rains out.
None of those exist in this stage. They arrive in Stage 5B.

The consequence for validation is precise, and it is why the numbers in
§6 should not be read as a score:

> Comparing this module's `q_sat` against a `q_sat` recomputed from a
> reanalysis's own (T, p) tests **the formula, the units, the grid, the
> temperature input and the pressure approximation**. It does not measure
> climate-model skill, because there is no climate process in it to have
> skill.

Any claim about reproducing real specific humidity or relative humidity
belongs to Stage 5B or later. Stage 5A's job is to make sure that when
Stage 5B starts moving moisture around, the ceiling it is moving it under
is the right ceiling.

---

## 2. Free parameters: none

Deliberately, and this is a design decision rather than a happy accident.

Every number in the module is either a physical constant supplied by the
caller, a property of water, or a field an earlier stage already produced.
There is no knob.

That has a consequence worth stating plainly: **a validation failure in
this stage cannot be fitted away.** It has to be a real error in the
formula, the units, the grid or an input field. This project's own history
is the argument for doing it this way — four separate stages have now
recorded a search finding whatever the objective permitted, and the fix
belonging in the setup rather than in the numbers. A stage with no numbers
to move cannot have that failure mode.

---

## 3. The equations

For each cell:

```
z        = 0                        for sea cells (they are the reference surface)
         = relativeElevationMetres  for land cells, SIGNED and not clamped

T_s(K)   = annualMeanTemperatureC + 273.15
T_sl(K)  = T_s + lapseRateCPerKm · z/1000      ← inverts the temperature stage's own lapse term
T_layer  = (T_sl + T_s)/2

p        = p0 · exp(−g·z / (R_d·T_layer))                 [hPa]
e_s      = 6.112 · exp(17.67·T_c/(T_c+243.5))             [hPa, over liquid water]
ε        = R_d/R_v
q_sat    = ε·e_s / (p − (1−ε)·e_s)                        [kg/kg]
```

**Gravity does not cancel here, unlike Stage 4.** Stage 4 worked in
geopotential (m²/s²) rather than geopotential height (m), which cancelled
`g` exactly and is why no gravity value was ever needed. The barometric
relation keeps it, so `gravityMs2` is a genuinely new required input. It is
passed in by the caller with **no default**, exactly as Stage 4 passes
`atmosphere`, so that no Earth constant lives inside the module —
confirmed by a test that runs the same function with Mars's gravity and
CO₂ gas constant and gets a visibly different scale height (11.5 km against
Earth's 8.4 km).

`config.json` was deliberately **not** changed to carry `body.gravityMs2`.
The tools supply it explicitly. Promoting it into the world configs is a
one-line change for whenever a second body actually needs climate, and
doing it now would break the byte-identical guarantee for no present gain.

The Magnus/Tetens coefficients describe **water**, not Earth — they would be
the same on any planet whose air holds water vapour. They are exported as a
named constant (`WATER_SATURATION_COEFFICIENTS`, with its Bolton (1980)
reference attached) rather than buried as literals, so that the distinction
between "a property of the condensible substance" and "an Earth-specific
number" is visible in the code rather than only here.

---

## 4. The pressure approximation, and why this one

Four options were compared before any code was written. The deciding
measurements are from the committed terrain raster, so they are about this
project's actual data rather than about geography in general:
**44.2% of land lies above 500 m, 25.7% above 1000 m, 10.7% above 2000 m**
(cosine-weighted).

| option | q_sat error vs the hydrostatic answer | verdict |
| --- | --- | --- |
| fixed 1013.25 hPa everywhere | −12.5% at 1000 m, −27.2% at 2000 m, −44.7% at 3000 m, −64.2% at 4000 m | ✗ wrong for a quarter of all land |
| a fixed pressure *level* (e.g. 850 hPa) | +15% at sea level | ✗ a surface quantity evaluated on a pressure surface is a category error |
| a standard-atmosphere table | — | ✗ embeds a fixed Earth temperature profile; invalid on any other planet |
| **hydrostatic with a layer-mean temperature** | — | **✓ adopted** |

The adopted form uses the pipeline's *own* temperature field to set the
column temperature, so the pressure field and the temperature field cannot
disagree about what the lapse rate is.

The table above is point samples. Measured instead over **the whole real
land surface** (cosine-weighted, every land cell of the committed raster),
choosing a fixed 1013.25 hPa instead of the hydrostatic pressure would
misstate `q_sat` by:

- **8.73%** mean relative error
- **0.697 g/kg** mean absolute error
- **−54.3%** at the worst cell

against a land-mean `q_sat` of 12.264 g/kg and a land-mean pressure of
925.13 hPa. That is the real cost of the cheap option on this project's own
data, and it is why the cheap option was not taken.

### Signed elevation on land

`z` is **not** clamped at zero. Ground below sea level genuinely sits under
more atmosphere than sea level does and really is at more than p0, and
clamping would have made that impossible to express. Measured, at 25 °C:

| place | elevation | p | Δ from p0 |
| --- | --- | --- | --- |
| Dead Sea shore | −430 m | 1064.67 hPa | +51.42 |
| Turfan depression | −154 m | 1031.32 hPa | +18.07 |
| Qattara depression | −133 m | 1028.83 hPa | +15.58 |
| Danakil depression | −125 m | 1027.89 hPa | +14.64 |

and the downstream consequence that actually matters: at the Dead Sea's
depth and the same temperature, `q_sat` is **4.88% lower** than at sea
level, because there is more air for the same vapour to sit in.

This also turned out to be *more* consistent than expected rather than
merely more realistic. The shipped temperature formula in `js/climate.js`
already applies the lapse rate to the **signed** elevation
(`seaLevelC − lapseRateCPerKm · relativeElevationMetres/1000`, no clamp), so
below-sea-level land is already treated as warmer. Using the signed value
here makes the sea-level-temperature inversion in §3 **exact** rather than
approximate. Clamping would have introduced a disagreement between two
stages that currently have none.

Sea cells take `z = 0` exactly — not the seabed's depth. The sea surface
*is* the reference surface, so `p = p0` there with no approximation error at
all. Verified: all 1,382,232 sea cells return exactly `p0`.

### A limitation this uncovered, in the terrain stage rather than this one

The whole-Earth test initially asserted that some land cells would come out
above p0, and **it failed: there are zero.**

The cause is not in Stage 5A. Climate v1's land/sea mask is a plain
elevation threshold (`isSea = source < seaLevelMetres`, in
`js/climate-v1/terrain.js`), so *by construction* a cell below sea level is
classified as sea and dry land below sea level cannot exist anywhere on the
raster. The Dead Sea shore, Turfan, Qattara and Danakil are endorheic
basins — dry land that happens to lie below sea level — and telling them
apart from ocean needs a real land mask, which the terrain stage does not
have.

Nothing was adjusted to make the assertion pass. The test now asserts the
state that actually holds (0 such cells), and a separate end-to-end test
injects a −430 m land cell through `buildHumidityField` itself and confirms
it gets p = 1064.67 hPa and a correspondingly reduced `q_sat`. So the
capability is present and proven; it is the terrain stage that cannot yet
express the input. Recorded in §8 as an open item.

---

## 5. Known approximations, predicted in advance

Stated before measuring, and then checked, so that they are documented
rather than discovered later:

- **Saturation over liquid water at all temperatures.** Over ice,
  saturation is lower. Measured ratio e_s(ice)/e_s(water): **0.906 at
  −10 °C, 0.821 at −20 °C, 0.678 at −40 °C** — so `q_sat` reads
  systematically high in very cold places, by a known and predictable
  amount. Left as-is: a mixed-phase switch is a real modelling choice with
  its own threshold, and Stage 5A has no business introducing a threshold
  when it has no other parameters.
- **Annual-mean temperature in.** `q_sat` is convex in T, so by Jensen's
  inequality a `q_sat` built from the annual-mean temperature is **lower**
  than the annual mean of `q_sat`. The error grows with seasonal range, so
  it is largest in continental interiors and at high latitudes. This is a
  property of the input, not of this module, and it will matter to Stage 5B.
- **Layer-mean temperature with a constant lapse rate.** Inversions and
  very high terrain are approximated.
- **Dry-air gas constant.** The virtual-temperature effect of water vapour
  on air density is neglected, worth roughly 0.2% in the deep tropics.

---

## 6. Unit tests

`node tools/test_humidity_stage5a.mjs` — no network, no teacher data.
**46 checks, 46 passing.**

| group | what it establishes |
| --- | --- |
| 1 | e_s against published table values at −20…+40 °C, within Magnus's own 1% accuracy |
| 2 | q_sat against values computed independently from the *reference* e_s, so a bug in e_s cannot hide behind a matching bug here; ε = 0.62197 |
| 3 | q_sat rises with T and falls with p, monotonically, over the full range |
| 4 | p(0) is *exactly* p0; p falls monotonically from −500 to 6000 m; p(5500 m) = 506.6 hPa ≈ p0/2 |
| 5 | **below-sea-level land gives p > p0** at four real depths, and a correspondingly lower q_sat |
| 6 | every required input throws rather than silently defaulting (gravity, both gas constants, p0, lapse rate, grid mismatch) |
| 7 | a sea cell over a 4000 m-deep seabed still gets exactly p0 |
| 8 | an isothermal uniform-elevation world gives one pressure everywhere — no latitude dependence has crept in |
| 9 | Mars's g and R_d produce a different, sane scale height — nothing Earth-specific is embedded |
| 10 | the predicted ice-phase bias matches the documented values to three decimals |
| 11 | the whole 2048×1024 Earth field: all finite, p 463.4–1013.3 hPa, q_sat 0.194–29.49 g/kg, all sea cells exactly p0, built in ~200 ms |
| 12 | end-to-end through `buildHumidityField`: an injected −430 m land cell gets p > p0 |

### The validation harness was itself verified first

`tools/validate_humidity_stage5a.mjs` takes a `--teacher <dir>` so it can be
fed a **synthetic** teacher built by pushing the model's own field onto a
2.5° grid. An identity teacher must come back as bias ≈ 0 and r = 1;
anything else would be a bug in the regridding or the statistics rather
than in the physics. It does:

| check | result |
| --- | --- |
| pressure, global | bias **+0.003 hPa**, r **1.0000** |
| pressure, every elevation band | bias ≤ 0.006 hPa, r ≥ 0.9996 |
| q_sat, and both one-input-substituted variants (identity teacher) | bias ≤ 0.02 g/kg, r ≥ 0.9999 |
| implied RH, with humidity injected at 75% of capacity | **0.750** in every region |

The 0.003 hPa residual is the two regridders' slightly different
nearest-node rounding, which is the right size for that and nothing else.
So when the real teacher arrives, a non-zero number will mean something.

This matters because of a lesson this project has now learned twice — the
V0.7.1 graticule probe and the world-switch regression check both reported
"no effect" while measuring nothing at all. **When a measurement says
something surprising, suspect the measurement first**, and the cheapest way
to do that is to check it against an answer you already know.

---

## 7. Regression: nothing earlier moved

`git diff` against the Stage 4 commit is **empty** for `js/climate.js`,
`worlds/kasoku-sekai/config.json`, `js/main.js`, `js/globe3d.js`, and every
existing `js/climate-v1/` module.

Re-run after the change:

- `tools/validate_temperature_v1.mjs` — same regional biases, and
  "determinism (rebuild twice, compare byte for byte): OK"
- `tools/validate_wind_v1.mjs` — same zonal bands and named regions
- `tools/validate_wind_model_stage4.mjs --quick` — **"Stage 3 baseline
  reproduction: OK"**, "synthetic physics tests: OK", old-model r = 0.154
  exactly as documented

---

## 6.5. Real-data validation, and what it actually says

Success criteria were declared **before** measuring, as this project does.
Here is how they came out, stated straight rather than re-drawn to fit:

| criterion, declared in advance | result | verdict |
| --- | --- | --- |
| pressure \|bias\| < 5 hPa globally | **+2.66 hPa** | **pass** |
| pressure MAE < 10 hPa above 1000 m | 14.6–19.3 hPa | **missed** |
| q_sat vs teacher-recomputed: r > 0.98 | 0.9661 | **missed** |
| q_sat MAE < 1 g/kg | 1.663 g/kg | **missed** |
| implied RH over ocean in 0.6–0.95 | 0.807 open, 0.778 tropical | **pass** |

Three criteria missed. The decomposition says exactly why, and the answer is
not "the pressure approximation is bad":

```
model q_sat      bias=+0.981 g/kg  MAE=1.663  r=0.9661
our T, their p   bias=+0.978 g/kg  MAE=1.670  r=0.9657   <- reproduces the whole error
their T, our p   bias=-0.012 g/kg  MAE=0.083  r=0.9999   <- our pressure is essentially exact
```

**Substituting our pressure into the teacher's own temperature reproduces
the teacher's q_sat to r = 0.9999 and 0.083 g/kg.** Substituting our
temperature reproduces the entire error. So the **error that our pressure
contributes to q_sat is very small**, and the q_sat miss is **inherited from
Stage 2's temperature field**, whose known regional biases (Tibet −6.1 °C,
Greenland −7.9 °C, Europe −5.2 °C) are already documented.

**Read that r = 0.9999 for what it is.** It is a correlation between two
*q_sat* fields, not between two pressure fields — it says the pressure term
contributes almost none of the q_sat error, which is a weaker and different
claim than "the pressure field is accurate to r = 0.9999". The direct
pressure comparison is §6.5's first table and is far less flattering:
**r = 0.9814 globally, MAE 8.34 hPa**, with the error decomposed below. Both
numbers are real; they answer different questions, and only the second one
is about pressure itself.

That is precisely what the one-input-at-a-time substitution was built to
distinguish, and it is why the criteria were written per-input rather than
as a single score.

### The pressure MAE, decomposed

The criterion "MAE < 10 hPa above 1000 m" was naive, and the reason is worth
recording rather than papering over:

- **Over open ocean the model's pressure is a constant 1013.25 hPa by
  construction.** The real annual-mean ocean has a standard deviation of
  **10.09 hPa** and a range of 946–1086 hPa — the subtropical highs and the
  polar lows. A model with no surface mass redistribution cannot produce any
  of that. This is the **same missing mechanism Stage 4 named for the wind**
  (it assumes the surface geopotential anomaly is zero), showing up in a
  second place, which is a useful corroboration rather than a new problem.
- **Over land the dominant term is the two datasets disagreeing about where
  the ground is.** NCEP's surface pressure sits on its own T62 model
  orography (~200 km); ours is GEBCO at ~20 km. Inverting NCEP's pressure
  back to the elevation it implies and comparing with our own: mean
  difference **123 m**, rms **199 m**, correlation **0.9823**. At roughly
  0.105 hPa/m that rms is of order **21 hPa** — the same size as the
  observed land MAE of 14.6–19.3 hPa.

So the land error is mostly an orography-definition difference and the sea
error is entirely missing dynamics. Neither is the barometric relation being
wrong, and the "their T, our p" line proves that independently.

### One more diagnostic worth keeping

Implied RH over all land has a 95th percentile of **1.951** — physically
impossible, since RH cannot exceed 1. That is not a bug in the ratio: it is
the model's temperature being too cold over high terrain, which makes
`q_sat_model` too small and the ratio blow up. It points at the temperature
stage from a third independent direction, agreeing with the decomposition
above and with Stage 2's own documented regional biases.

Both checkerboard halves agree to three decimals (MAE 8.27 vs 8.39 hPa),
which is what should happen when nothing was fitted to either.

---

## 7.5. The teacher, and three bugs it found

**Source**: NCEP/NCAR Reanalysis 1 (NOAA/OAR/ESRL PSL), annual mean of the
12-month long-term-mean climatology. US federal government work, no reuse
restriction. Three fields: surface pressure (`pres.sfc`), near-surface air
temperature (`air.2m` on the Gaussian grid, falling back to `air.sig995`),
and near-surface specific humidity (`shum.2m`).

Every URL is tried from a candidate list and **the one that worked is
recorded in the summary**; nothing here is asserted from memory. That
matters because the first probe round returned HTTP 504 for *every* URL
including a known-good control that Stage 3 had fetched successfully —
which proves the probe was measuring PSL's availability, not which files
exist. PSL's gateway fails in bursts lasting minutes; across four real runs
one fetched everything first try, one needed three attempts per field, and
one never got surface pressure at all in eight tries. The download cache is
therefore persisted between runs so attempts accumulate.

Three bugs came out of this, and **none of them was found by reasoning** —
each was caught by a check or by reading a log, and none was fixable by
loosening a threshold:

1. **NCEP stores near-surface specific humidity in grams per kg, not
   kg/kg.** The builder assumed kg/kg, so the first build came back with a
   peak of 20.55 where kg/kg would be 0.02, and two sanity checks failed.
   Fixed with a magnitude-based conversion — the same discipline the
   pressure field already used, because Stage 3 was bitten by trusting a
   units convention over the data and this was that trap in a new place.

2. **The teacher's grids are not all the same shape.** Surface pressure
   arrives on NCEP's 144×73 regular grid; the 2 m fields arrive on its
   192×94 **Gaussian** grid. The validator was indexing all three with one
   shared flat index, which would have silently compared the wrong cells.
   Every teacher grid is now sampled through its own axes, and the tool
   prints each grid's shape so a mismatch is visible rather than silent.
   **The synthetic-teacher check could not have caught this**, because it
   built every grid at the same shape — so it now builds humidity at 192×94
   on purpose. A harness test proves the harness against the case it was
   given, not against the case the real data turns out to be.

3. **Assumed uniform, cell-centred spacing — three times over.** A Gaussian
   grid's rows are not evenly spaced and its first row sits at 88.542°, not
   90° or 89.04°. The sampling formula was right often enough to look
   correct and wrong where it mattered (it put the Antarctic check at
   −80.95° instead of −82.85°), and the summary's longitude array was off by
   half a cell on both grids, because `reorient()` swaps the halves of a
   0–360 axis so the result starts at exactly −180. All three now use the
   axes the data actually carries.

Which temperature file wins is **not stable between runs** — the first build
fell back to `air.sig995` (144×73) because `air.2m` was timing out, the
second got `air.2m` (192×94). That is precisely why bug 2 mattered and why
the grid shape is read from the data rather than assumed.

Every check now prints the value it measured, so a failure says what the
data *is* rather than only that it displeased a threshold — which is what
left the first failure needing a guess to interpret.

---

## 8. Open items

1. ~~**Below-sea-level land cannot occur** (§4).~~ **Fixed in Stage 5A.5** —
   the land/sea rule is now topological (below sea level *and* connected to
   the ocean) rather than a bare elevation test, so the Dead Sea basin, the
   Jordan valley and Danakil are land and do get p > p0. See
   `docs/climate-v1-land-sea-stage5a5.md`. The §4 text below is kept as the
   record of how the limitation was found.
2. **The ice-phase bias is documented but not corrected** (§5).
3. **The Jensen bias from using an annual-mean temperature** (§5) will
   matter more once Stage 5B moves moisture, since transport is driven by
   gradients.
4. `body.gravityMs2` lives in the tools rather than in the world configs
   (§3).
5. **The model has no sea-level pressure variation at all** (§6.5). Over
   open ocean it is a constant where the real field varies by 10 hPa
   standard deviation. Fixing it needs the surface mass redistribution
   Stage 4 already identified as its own missing mechanism — it is the same
   gap, not a second one, and it is a stage of its own rather than a
   parameter.
6. **The q_sat error is Stage 2's temperature, not Stage 5A** (§6.5).
   Nothing in this stage can improve it; improving the temperature field
   would, and the implied-RH-above-1 diagnostic gives a new, independent
   handle on where that field is worst.

---

## 9. Stage 5B, and the two decisions it inherits

Neither is implemented here; both were settled before implementation so
that Stage 5B does not rediscover them.

**The evaporation term was removed, not renamed.** An earlier draft carried
`seaSurfaceEvaporationRate = q_sat × efficiency` described as kg/m²/s. It is
not one. A real bulk evaporation rate is
`E = ρ · C_E · |U| · (q_sat − q_air)`, which needs both a wind speed and an
air-side humidity — neither of which exists in Stage 5A. So the term is
gone rather than renamed: naming a quantity after units it does not have is
the exact failure this pipeline exists to avoid. Stage 5B can either build
the real bulk formula (it will have both inputs) or use an explicitly
dimensionless `moistureSourcePotential`.

**No wind switch at 30°, and no smooth latitude blend either.** Hard-
switching between the Stage 4 wind and Climate v0.8's at a chosen latitude
is rejected for the discontinuity; a smooth blend in latitude is rejected
too, because a hand-placed latitude threshold is a latitude lookup table and
Stage 4's standing rule forbids exactly that. The only blend weight the
dynamics themselves produce is `f²/(f²+r²)`, which is already inside Stage
4's solution — but measured, its crossover sits at **2.3° for τ = 2 days and
9.1° for τ = 0.5 days**, nowhere near the 10–30° band where Stage 4 actually
fails, so it would not rescue anything. Stage 5B should instead be run
**twice, once under each wind field**, and both results reported. The real
fix is the Hadley/Gill mass redistribution already named in the Stage 4
document, and that is its own stage.
