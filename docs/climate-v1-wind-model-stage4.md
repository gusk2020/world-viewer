# Climate v1 Stage 4 -- a new wind model, built and measured

Stage 3 measured Climate v0.8's wind field against NCEP/NCAR Reanalysis 1
and found almost no skill at predicting where the wind is strong (speed
correlation **0.154**), with the errors concentrated in three separately
diagnosed places. Stage 4's job was not to tune that model but to build a
different one, from physical causes that generalise, and to find out
whether it explains more.

**Verdict up front: not adopted as Climate v1's wind model.** Globally the
new model's speed correlation is 0.154 -> **0.166**, which is not the clear
rise Stage 4's own success bar required. But the global number hides a
large, physically coherent split that is the real result of this stage:

| | old | new | |
| --- | --- | --- | --- |
| **extratropics** (abs(lat) >= 30) speed correlation | 0.026 | **0.329** | clears the 0.3 bar |
| **extratropics** direction mean error | 59.8 deg | **37.4 deg** | |
| **tropics** (abs(lat) < 30) speed correlation | 0.260 | **-0.122** | |
| **tropics** direction mean error | 51.1 deg | **118.3 deg** | backwards |

The new mechanism works where its central assumption holds and fails where
that assumption is known to be false, in the direction the assumption
predicts. Both halves of that sentence were predicted before the Earth
comparison was run, and both were then measured. Sections 9-11 give the
numbers; section 14 says what it would take to fix the failing half.

## 1. Candidates compared

| | A. wind from the temperature gradient directly | B. temperature -> geopotential -> linear balance | C. linear shallow-water / primitive equations | D. keep tuning the old three-cell model |
| --- | --- | --- | --- | --- |
| physical meaning | weak: a temperature gradient is not a force. Thermal wind relates it to the *vertical shear* of the geostrophic wind, not to the wind itself | sound: the hypsometric relation is exact, and the steady linear balance is the standard boundary-layer/Rayleigh-drag reduction of the momentum equations | soundest: actually solves the dynamics | none: the cells are prescribed by latitude, not derived |
| generalises off Earth | yes but meaningless | yes -- needs only radius, rotation, gas constant | yes | no: hemisphere-symmetric by construction |
| inputs needed | temperature | temperature, radius, rotation rate, gas constant | the above plus a time integration and initial state | latitude |
| free parameters | 1-2 | **3** | many (viscosity, damping, timestep, resolution, spin-up) | 3 already fitted, plus whatever is added |
| equator | fine with drag | **fine**: f -> 0 leaves r^2 in the denominator, never zero | fine | fine |
| poles | 1/cos(lat) metric needs care | same, and handled | same | fine |
| recomputable on a Pixel 7a | trivially | **yes: 37 ms for a global field, no iteration** | no: an iterative solver on a phone, per slider change | trivially |
| comparable to the 850 hPa teacher | only in direction | **yes, in real m/s** | yes | only after fitting a scale K |
| extends to seasons | yes | **yes: feed it a season's temperature field** | yes | partly |
| connects to moisture transport later | needs a unit | **yes: real m/s** | yes | needs a unit |

**Chosen: B.** C is the physically strongest option and was rejected on
cost and honesty: an iterative primitive-equation solver is a far larger
piece of machinery than this project can validate in one stage, it needs
parameters (damping, viscosity, spin-up) that would be fitted rather than
derived, and it cannot be recomputed interactively on a phone. A is
rejected because it has no mechanism -- it would be a differently-shaped
curve fit. D is what this stage exists not to do.

## 2. The model

### 2.1 Temperature to geopotential (the hypsometric relation)

The thickness of the layer between two pressure surfaces is set by the mean
temperature of the air in it:

```
Phi(p_level) - Phi(p_surface) = R_d * T_layer * ln(p_surface / p_level)
```

A warm column is a thick column, so at a *fixed pressure level above the
surface* a warm column puts that level higher: a geopotential **high**.
This is the opposite of the familiar surface thermal low, and it is the
correct sign at 850 hPa.

Taking the surface geopotential anomaly as zero (see 2.4) and removing the
global area-weighted mean, the model's field is

```
Phi'(x,y) = thermalResponseStrength * R_d * ln(p_s/p_lev) * (T'(x,y) - mean T')     [m^2/s^2]
```

**Gravity does not appear.** Working in geopotential (m^2/s^2) rather than
geopotential height (m) cancels `g` exactly, which is why no gravity value
was added to the world config -- the question in the brief turned out not to
need answering.

### 2.2 Geopotential to wind (steady linear balance)

```
r*u - f*v = -dPhi/dx
f*u + r*v = -dPhi/dy
```

solved exactly as

```
u = -(r*Phi_x + f*Phi_y) / (r^2 + f^2)        [m/s, eastward positive]
v =  (f*Phi_x - r*Phi_y) / (r^2 + f^2)        [m/s, northward positive]
speed = sqrt(u^2 + v^2)                       [m/s]
```

with `f = 2*Omega*sin(lat)` and `Omega = rotationDirection * 2*pi /
dayLengthHours`, both read from the world definition. As `r -> 0` this is
exact geostrophic balance; at the equator `f = 0` leaves `r^2` in the
denominator, so the flow becomes finite down-gradient motion rather than a
singularity. **Nothing in the file distinguishes the hemispheres**: `f`
changes sign by itself.

Gradients use the sphere's metric (`1/(a cos(lat)) dPhi/dlambda` and
`1/a dPhi/dphi`), with `cos(lat)` floored at its half-cell-from-the-pole
value -- past that the columns have converged and a zonal derivative has no
meaning.

### 2.3 Units

| symbol | quantity | unit |
| --- | --- | --- |
| `uWindMs`, `vWindMs`, `windSpeedMs` | wind | m/s |
| `geopotentialAnomalyM2S2` | geopotential anomaly | m^2/s^2 (**not** Pa, **not** m) |
| `reducedTemperatureC`, `smoothedTemperatureC` | temperature | degrees C |
| `f`, `r` | Coriolis parameter, drag rate | s^-1 |
| `R_d` | specific gas constant | J/(kg K) |

`geopotentialAnomalyM2S2` and both temperature fields are returned as
named, inspectable arrays, not internal temporaries.

### 2.4 What is being approximated, stated plainly

The surface geopotential anomaly is taken as **zero** -- surface pressure is
assumed horizontally uniform. On the real Earth this is false, and the
falsehood is not random: the subtropical highs and the equatorial trough
are exactly the surface mass redistribution being discarded, and they are
produced by the Hadley circulation, which a temperature field alone cannot
derive. The model should therefore be expected to represent the
thermally-driven flow (the equator-to-pole gradient that drives the
mid-latitude westerlies) and **not** the overturning-driven flow (the
trades' subtropical ridge). Section 10 is that prediction, measured.

### 2.5 Two structural choices that are physics, not tuning

**Temperature is reduced to sea level before it becomes geopotential.** A
mountain's surface is cold because it is high; feeding raw surface
temperature in would put a deep spurious geopotential low over every
plateau. Reducing by the same lapse rate the temperature field itself used
is the standard reduction and is exact here.

Measured sensitivity, reported rather than hidden: **not** reducing scores
*better* (extratropical correlation 0.329 -> **0.482**, global 0.166 ->
0.178). The reduced version is still what ships, for a reason that is not
about the score: over a 3 km plateau there is no 1000-850 hPa layer at all
-- it is underground, which is why the teacher masks those cells -- so raw
surface temperature there is not "more correct", it is a different kind of
wrong. The unreduced variant's advantage comes specifically from deeper
cold domes over Antarctica and Greenland sharpening the circumpolar
gradient, and with one planet's data there is no way to separate "real
cold-dome physics" from "a compensating error that happens to help".
Deciding it properly needs either a second planet or a teacher at a level
that is not underground (500 hPa). **The stage's verdict does not depend on
this choice**: the extratropical result clears its bar either way.

**The wind is computed on a coarse grid** (256x128). Large-scale balanced
flow has no business being computed at 20 km resolution, the teacher is
2.5 degrees, and block-averaging the fine temperature field to get there
gives coastal cells a real land/sea mixture instead of a hard edge.

### 2.6 Smoothing, as a length rather than a blur

Measured first, then designed around: after sea-level reduction the Climate
v1 temperature field takes **exactly two values at each latitude** -- one
for land, one for sea, differing by 1.5-3.3 K. It has no other longitudinal
structure at all. Its raw gradient is therefore a set of spikes at
coastlines.

`thermalSmoothingKm` is the length over which the atmosphere is taken to
homogenise surface thermal contrasts before they become a pressure
gradient, in kilometres on the ground, applied with the sphere's own metric
(the zonal kernel widens as `1/cos(lat)`, and where it would span more than
half the globe the row is replaced by its zonal mean, which is that
kernel's exact limit).

## 3. Parameters

Three, all `empirical`, all with a physical reading:

| parameter | fitted value | range searched | meaning |
| --- | --- | --- | --- |
| `thermalResponseStrength` | 1.0 | 1-5 | geopotential response as a multiple of plain single-layer thickness. Degenerate with `R_d` and the pressure ratio for a single body -- only the product is identifiable from one planet |
| `dragTimescaleDays` | 0.5 | 0.25-8 | Rayleigh drag timescale `1/r`; sets how far the flow turns from geostrophic toward down-gradient, and is the only thing keeping the equatorial wind finite |
| `thermalSmoothingKm` | 1500 | 500-2000 | the homogenisation length of section 2.6 |

Physical constants come from the world definition (`radiusMetres`,
`dayLengthHours`, `rotationDirection`); the gas constant and the two
pressure surfaces are **required inputs with no defaults** in
`js/climate-v1/wind.js`, supplied by the Earth-specific tool, so no Earth
constant is embedded in the model.

## 4. Fitting method

A **140-trial grid search** over the three parameters, on one half of a
geographic checkerboard (`(x+y)` even), scored on **vector RMSE**.

Speed correlation was deliberately *not* the objective, for two reasons.
It is the headline success criterion, so letting the fit chase it would
make any improvement in it circular; and it is scale-invariant, so
`thermalResponseStrength` cannot move it at all -- which means the reported
correlation is a property of the *pattern* the physics produces, not of any
amplitude that was fitted.

**Calibration and validation agree to three decimal places** (correlation
0.166 vs 0.165; direction 67.7 vs 67.8 deg; vector RMSE 5.682 vs 5.680).
Nothing here is overfitted -- with three parameters and ~9,000 scored cells
it could hardly be.

Note what the fit chose: `thermalResponseStrength = 1.0`, the **bottom** of
its range. An RMSE objective shrinks a model toward zero when its pattern
is poorly correlated with the truth, so a fit that pins the amplitude at
its minimum is itself evidence that the pattern, not the scale, is what is
wrong.

## 5. Synthetic-world tests

Run before any Earth comparison; a model failing these is wrong regardless
of how it scores.

| test | result |
| --- | --- |
| uniform temperature, flat world | max speed **1.5e-14 m/s** (i.e. zero) |
| zonal-only temperature gradient: angle between wind and down-gradient direction, by latitude | 0 deg: **51.0**, 10 deg: **74.8**, 30 deg: **85.6**, 60 deg: **87.3** -- rises monotonically from drag-dominated to geostrophic |
| meridional-only gradient, warm equator | northern mid-latitude u = **+1.589**, southern **+1.589** -- westerlies in both hemispheres, from one formula with no hemisphere term |
| reverse `rotationDirection` | +1.589 -> **-1.589**, exactly |
| faster spin | angle to down-gradient **89.2 deg** (4x Earth rate) vs **86.6 deg** (Earth-like): more geostrophic |
| rotation -> 0 | **2.4 deg** from the gradient: flow follows the pressure gradient |
| equator, f = 0 exactly | **0** non-finite cells, max speed 4.4 m/s: no singularity |

One of these tests was itself wrong first and is recorded because the
correction matters: the zonal-gradient test originally asserted "essentially
down-gradient flow at the equator". With cell-centre rows no row sits
exactly on the equator, so the nearest one has a small but real `f`, and at
the latitude where `abs(f) = r` the correct answer is 45 degrees, not 0. The
test was failing the model for being right, and was replaced by the
monotonic-trend assertion above.

## 6. Old baseline, reproduced

Asserted at the top of every run, and reproducing Stage 3 exactly:
K = 6.545, direction mean 56.5 deg, median 29.5 deg, speed correlation
0.154, speed MAE 2.863, u RMSE 5.035, v RMSE 1.924. The metric code was
refactored this stage so that the old (row-based) and new (2-D) models are
scored by literally the same function; these numbers are the proof that the
refactor changed nothing.

## 7. Whole-globe comparison, 850 hPa

| | speed r | dir mean | dir median | dir speed-wtd | bias | speed MAE | speed RMSE | u RMSE | v RMSE | vector RMSE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| old (Climate v0.8) | 0.154 | 56.5 | 29.5 | 37.3 | -0.719 | 2.863 | 3.851 | 5.035 | 1.924 | 4.991 |
| new (default params) | 0.042 | 69.2 | 33.9 | 66.3 | -2.084 | 2.857 | 4.041 | 5.434 | 1.704 | 6.085 |
| new (calibrated) | **0.166** | 67.7 | 38.4 | 63.0 | -2.595 | 2.979 | 4.209 | 5.144 | **1.708** | 5.681 |

Globally the new model is **not** better: correlation is essentially
unchanged, direction error is worse, vector RMSE is worse. Only `v` RMSE
improves.

## 8. Tropics vs extratropics -- the actual result

| | speed r | dir mean | dir median | dir speed-wtd | speed MAE | u RMSE | vector RMSE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tropics, old | 0.260 | 51.1 | 38.0 | 45.8 | 2.057 | 3.189 | 4.052 |
| tropics, new | **-0.122** | **118.3** | 134.8 | 127.2 | 2.106 | 5.433 | 5.773 |
| extratropics, old | 0.026 | 59.8 | 19.5 | 31.5 | 3.349 | 5.876 | 5.866 |
| extratropics, new | **0.329** | **37.4** | **15.9** | **19.7** | 3.506 | **4.961** | **5.576** |

Outside the tropics the new model clears Stage 4's own "clear new
explanatory power" bar (correlation >= 0.3) from a starting point of
essentially zero skill, cuts the mean direction error by 22 degrees, and
cuts the speed-weighted direction error from 31.5 to 19.7 degrees. Inside
the tropics it is worse than useless: a mean direction error above 90
degrees means the modelled wind points, on average, the wrong way.

The tropics carry about half the cos-weighted area, which is why the global
number in section 7 sits where it does.

## 9. Latitude bands

| band | old r | new r | old dir | new dir | old vec RMSE | new vec RMSE |
| --- | --- | --- | --- | --- | --- | --- |
| 90-60N | -0.069 | **0.439** | 119.8 | **57.3** | 6.542 | **2.112** |
| 60-30N | 0.247 | -0.097 | 30.3 | **24.4** | 3.253 | 3.385 |
| 30-0N | 0.171 | -0.073 | 59.8 | 111.7 | 4.414 | 5.657 |
| 0-30S | 0.375 | -0.207 | 42.1 | 125.2 | 3.618 | 5.896 |
| 30-60S | 0.102 | -0.391 | 19.9 | **13.3** | 6.645 | 7.667 |
| 60-90S | -0.414 | **0.177** | 102.3 | **80.0** | 8.483 | **5.498** |

Zonal-mean `u`, which shows the sign errors directly:

| band | teacher | old | new |
| --- | --- | --- | --- |
| 90-60N | +1.159 | **-4.774** (wrong sign) | **+1.258** |
| 60-30N | +4.134 | +4.013 | +2.607 |
| 30-0N | -2.475 | -3.107 | **+1.677** (wrong sign) |
| 0-30S | -2.999 | -3.334 | **+1.849** (wrong sign) |
| 30-60S | +9.159 | +4.077 | +2.552 |
| 60-90S | +1.762 | **-4.926** (wrong sign) | **+1.876** |

**Stage 3's worst finding is fixed.** Both polar bands had the sign of the
zonal wind backwards in the old model; the new model gets both right, and
at close to the right magnitude (+1.258 vs +1.159, +1.876 vs +1.762). That
is the clearest single piece of new explanatory power in this stage, and it
comes from nothing but the temperature field and the balance -- there is no
polar term anywhere.

**And a new sign error is introduced**, in both tropical bands, exactly as
section 2.4 predicted.

## 10. The three regions Stage 3 singled out

Area-weighted means, m/s:

| region | teacher | old | new |
| --- | --- | --- | --- |
| Southern Ocean (40-60S) | u=+11.33, speed 11.38 | u=+3.86, speed 4.20 | u=+2.50, speed **2.56** |
| tropical Pacific (5S-5N, 170-120W) | u=-8.27, speed 8.31 | u=-0.77, speed 2.03 | u=**+0.30**, speed 0.82 |
| north polar (70-90N) | u=+0.71, speed 1.61 | u=**-4.73**, speed 4.86 | u=**+0.77**, speed 0.79 |
| south polar (70-90S) | u=-2.04, speed 4.23 | u=-5.56, speed 5.56 | u=+1.42, speed 1.44 |
| North Atlantic (30-50N) | u=+5.71, speed 6.13 | u=+5.14, speed 5.14 | u=+2.62, speed 2.72 |

**Southern Ocean: not fixed, and made worse** (2.56 m/s against a real
11.38). **Tropical Pacific: not fixed, and made worse** -- the trades are
not merely too weak now, they blow the wrong way. **North polar: fixed**,
in both sign and magnitude.

### Why the hemispheric asymmetry is absent, measured

Stage 4 asked specifically whether the new model could produce the Southern
Ocean's much stronger westerlies without any hemisphere parameter. It
cannot, and the reason is not in the wind model:

- Real SH/NH ratio of the 30-60 zonal-mean westerly: **2.216**.
- Ratio the new model produces: 2.552/2.607 = **0.979** (essentially symmetric).
- Ratio of the 30->60 temperature gradient *in Climate v1's own temperature
  field*: north 22.54 K, south 20.36 K -- **0.904**, i.e. the field's
  southern gradient is if anything slightly *weaker*.

The wind model is faithfully transmitting the temperature field it was
given. **The missing asymmetry is a temperature-stage limitation, not a
wind-stage one**: Climate v1's temperature field has no ice-albedo
feedback, no ocean heat transport, and (after sea-level reduction) no
elevation signal, so Antarctica is not the sharp cold dome that in reality
sets up the circumpolar westerly. No wind model can recover an asymmetry
that is not in its input.

## 11. Tropical Pacific: why it got worse

Old model: 2.03 m/s against a real 8.31 -- far too weak. New model: 0.82
m/s and pointing the wrong way.

The cause is measured, not guessed, and is two separate things:

1. **No zonal temperature structure to work with.** Climate v1's
   temperature field is a function of (latitude, land/sea) only. The
   tropical Pacific is entirely ocean, so across the whole basin the
   reduced temperature is *exactly constant*. Zero zonal temperature
   gradient means zero zonal geopotential gradient means no Walker-type
   circulation is even representable. The real Pacific trades are driven by
   an SST gradient this project's temperature model does not have.
2. **The uniform-surface-pressure assumption.** With `Phi` peaking at the
   warm equator instead of at the subtropical ridge, the meridional
   geopotential gradient in the subtropics has the opposite sign to
   reality, so geostrophy returns westerlies where the trades belong --
   `+1.677` against a real `-2.475`.

## 12. 10 m (secondary)

| | speed r | dir mean | speed MAE | vector RMSE |
| --- | --- | --- | --- | --- |
| old | 0.141 | 57.7 | 2.125 | 3.357 |
| new | 0.090 | 87.6 | **2.002** | 4.701 |

As expected and as allowed by the brief: the new model contains no surface
friction, so it has no business matching the 10 m wind, and a weaker result
here is not counted against it.

## 12.5 Diagnostic images

Generated by `tools/render_wind_diagnostics.mjs` into `docs/images/`, on the
teacher's own 144x73 grid. **Not wired to the app's UI.** The three speed
images share a 0-15 m/s scale so they can be compared directly; grey is the
below-ground mask.

| file | shows |
| --- | --- |
| `stage4-wind-teacher-speed.png` | NCEP/NCAR 850 hPa speed: the Southern Ocean jet, both storm tracks, the trades |
| `stage4-wind-old-speed.png` | Climate v0.8: flat zonal bands, no longitudinal structure at all |
| `stage4-wind-new-speed.png` | the new model: two faint mid-latitude bands, systematically far too weak |
| `stage4-wind-old-direction-error.png` | green 0 deg -> yellow 90 -> red 180 |
| `stage4-wind-new-direction-error.png` | same scale; the tropical band is the red one |

The speed pair makes the section 10 numbers visible at a glance: the
teacher's brightest feature by far is the Southern Ocean jet, and neither
model produces anything like it.

## 13. Performance

**36.9 ms** for a 256x128 global wind field (32,768 cells), producing
1.25 MB of output arrays (u, v, speed, geopotential anomaly, smoothed
temperature, all Float64). **No iterative solver**: the balance is solved
in closed form, one pass, so there are no iterations to bound and no
convergence criterion to state. The only loop with a variable cost is the
smoothing kernel, which is bounded by construction (half the globe).

That is comfortably inside what a Pixel 7a could recompute on a slider
change, though nothing is wired to the UI this stage.

## 14. Limitations, and what would actually fix the failing half

- **The surface-pressure assumption is the binding constraint.** Everything
  that fails -- the tropics' sign, the trades, the subtropical ridge --
  follows from setting the surface geopotential anomaly to zero. Fixing it
  means representing the Hadley/Walker mass redistribution, which is a
  circulation, not a temperature field. The minimal honest version is
  probably a Gill/Matsuno-type response to a heating field (heating where
  the surface is warm and moist, producing low-level convergence), which is
  a real, general mechanism rather than an Earth correction -- but it is a
  second model, not a parameter, and it was deliberately not added here.
  Adding it as a tunable blend against the thickness term would have been
  exactly the "rescue by parameter" this stage forbade: both terms are
  functions of the same temperature field with opposite signs, so their
  ratio would have been pure Earth fitting.
- **The temperature field is the other constraint.** Section 10 shows the
  hemispheric asymmetry cannot appear until the temperature stage has one,
  and section 11 shows the trades cannot appear until the ocean has zonal
  structure. Both are upstream of wind.
- **The sea-level-reduction choice is unresolved** (section 2.5); settling
  it needs a second planet or a 500 hPa teacher.
- **No surface friction, no land/sea drag, no terrain blocking**, per the
  brief. The 10 m comparison is correspondingly weak.
- **Seasons untested.** The model takes a temperature field, so feeding it
  warm- and cold-season fields would give DJF/JJA winds against the teacher
  grids Stage 3 already built, but that was out of scope here.

## 15. Verdict

**Not adopted as Climate v1's wind model.** The stated bar was a clear rise
in global speed correlation from 0.154, ideally past 0.3; the new model
reaches 0.166, which is not that. It is not rescued by adding parameters,
and the fit pinning `thermalResponseStrength` at the bottom of its range
says the problem is the pattern rather than the scale.

**Kept in the repository as a validated Climate v1 wind candidate for the
extratropics**, because three things it did are real and were verified on
held-out data:

1. Extratropical speed correlation 0.026 -> **0.329**, above the bar.
2. Extratropical direction error 59.8 -> **37.4 degrees**, and
   speed-weighted 31.5 -> **19.7 degrees**.
3. **Both polar zonal-wind sign errors fixed** -- Stage 3's single worst
   finding -- with no polar term in the model.

Nothing is wired to Climate v0.8, to the app's UI, to surface rendering, or
to moisture. `js/climate.js` is unchanged; Climate v0.8's shipped
parameters, default climate set and rendered output are all exactly as the
user last approved them.
