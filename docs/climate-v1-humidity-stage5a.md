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

## 8. Open items

1. **Below-sea-level land cannot occur** (§4). It needs a real land mask in
   the terrain stage, which is a Stage 0-1 change and out of scope here. The
   humidity side is ready for it.
2. **The ice-phase bias is documented but not corrected** (§5).
3. **The Jensen bias from using an annual-mean temperature** (§5) will
   matter more once Stage 5B moves moisture, since transport is driven by
   gradients.
4. `body.gravityMs2` lives in the tools rather than in the world configs
   (§3).

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
