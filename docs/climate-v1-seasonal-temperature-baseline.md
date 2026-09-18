# Climate v1: the seasonal temperature baseline

Tool: `tools/validate_seasonal_temperature.mjs`. Teacher:
`worlds/kasoku-sekai/teacher/temperature-monthly-mean-c.bin` (Berkeley Earth,
12 x 180 x 360, 1991-2020, CC BY-NC 4.0).

**Nothing was fitted.** `seasonalDampingWPerM2K` is 8, `soilDepthM` is 4,
`mixedLayerDepthM` is 30 and `shortwaveAbsorbedFraction` is 0.70, exactly as
they were. No parameter was searched, no world config was written, no physics
file changed, and the V0.8 guards still read 63.4% / 10.2%. This document is
the measurement the three-parameter calibration will start from.

## 1. How a calendar month becomes an orbital phase

The model's clock is `orbitalPhase`, whose 0 is the ascending equinox on any
world; the teacher's clock is the Gregorian calendar. The validator owns the
one constant that joins them -- the March equinox at **day of year 78.59**
(March 20.35 UTC, the 1991-2020 mean) -- and `js/climate-v1/season.js` still
knows nothing about months.

**A month is an interval, not an instant.** Berkeley Earth's July value is the
mean over July, so the model is averaged over the same interval, with the real
Gregorian month lengths (February 28.2425, so the twelve sum to the tropical
year the season table itself uses). Three routes were compared:

| route | error against the exact integral |
| --- | --- |
| 365 equal-time samples/year, assigned by day | 2.62e-1 C |
| 1461 | 5.85e-2 C |
| 3652 | 2.82e-2 C |
| 14608 | 3.79e-3 C |
| **the exact harmonic integral over each month's interval** | **0 by construction** |

The sampled route converges on the exact one, which is what earns the right to
use the exact one -- and the exact one is what every number below uses, so the
month mean carries no sampling error at all. The mean over each month's own
harmonic interval has a closed form, so this costs nothing.

**The midpoint approximation the brief asked about is worth avoiding**: taking
the model at each month's centre phase instead of averaging over the month is
wrong by up to **0.562 C**.

**The equinox constant lands on the phase bias, one for one**, and that is the
opposite of the reassuring answer, so it was measured rather than argued. The
model's peak is fixed relative to the equinox while the teacher's twelve
numbers do not move, so shifting the equinox date shifts the *difference*:

| equinox day of year | land phase bias | ocean phase bias |
| --- | --- | --- |
| 77.59 (-1 d) | -1.20 d | 4.90 d |
| **78.59 (used)** | **-0.20 d** | **5.90 d** |
| 79.59 (+1 d) | 0.80 d | 6.90 d |

The real instant varies about +/-0.6 d across 1991-2020, so **every phase bias
below carries about +/-0.6 d of calendar uncertainty**. The teacher's own peak
dates are unaffected.

## 2. Earth's real orbit, as a calibration condition only

The season table is built with `axialTiltDegrees` 23.44,
`orbitalEccentricity` **0.0167** and `periapsisLongitudeDeg` **283**, supplied
explicitly by the validator. The world's `config.json` still carries the
circular default and the validator asserts that it does, so the app draws
exactly what the user has already confirmed on their phone.

The reason is a compensating error of precisely the kind
`docs/climate-v1-calibration-audit.md` exists to prevent: the periapsis
direction really does make Earth's southern summer the stronger one (the
seasonal-cycle write-up measures 45N 14.3 C against 45S 16.0 C on the real
orbit, against 15.1 / 15.2 on a circular one). Fitting a real Earth to a
circular model would push that asymmetry into `seasonalDampingWPerM2K` or a
heat capacity, where it does not belong.

## 3. The headline: amplitude is 20% too large, phase is close

First-harmonic half-amplitude in C, area-weighted; phase in days, model minus
teacher, positive = the model peaks late. Phase statistics use only cells
where the **teacher's** own H1 clears 1.0 C, since a phase is meaningless
without a cycle to have one; the coverage is reported beside them.

| | n | teacher amp | model amp | amp bias | amp MAE | phase bias | phase MAE | cover |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 64779 | 4.77 | 5.74 | +0.97 | 2.20 | +4.0 d | 11.6 d | 90% |
| **land** | 22226 | 9.60 | 11.48 | **+1.88** | 3.35 | **-0.2 d** | 8.4 d | 95% |
| **ocean** | 42553 | 2.76 | 3.35 | **+0.59** | 1.72 | **+5.9 d** | 13.0 d | 87% |

21 teacher cells were dropped for a missing month. Nothing was interpolated or
filled.

**The phase is the good news and it is genuinely good**: a land phase bias of
-0.2 d is, within the calendar uncertainty above, exact. The design's whole
claim -- that a one-layer relaxation with a real heat capacity puts the peak in
the right place without anything being fitted to a date -- holds up on the real
globe, not just at the design's own representative points.

## 4. The global amplitude number hides the real error, which is hemispheric

| band | n | teacher | model | amp bias | phase bias |
| --- | --- | --- | --- | --- | --- |
| 0-30 NH land | 3132 | 5.08 | 5.05 | **-0.03** | +4.3 d |
| 0-30 NH ocean | 7668 | 1.46 | 1.35 | -0.12 | +3.8 d |
| 0-30 SH land | 2493 | 3.60 | 6.31 | +2.71 | +4.5 d |
| 0-30 SH ocean | 8307 | 1.69 | 2.07 | +0.38 | -0.6 d |
| **30-60 NH land** | 5522 | 13.34 | 13.97 | **+0.63** | -5.1 d |
| 30-60 NH ocean | 5278 | 4.63 | 4.37 | -0.26 | +3.3 d |
| **30-60 SH land** | 555 | 5.68 | 13.39 | **+7.72** | -3.9 d |
| 30-60 SH ocean | 10245 | 2.08 | 5.02 | +2.94 | +5.0 d |
| 60-90 NH land | 3895 | 18.70 | 18.96 | **+0.26** | -7.2 d |
| **60-90 NH ocean** | 6905 | 11.31 | 6.44 | **-4.87** | **+23.6 d** |
| **60-90 SH land** | 6629 | 11.63 | 20.90 | **+9.27** | +10.0 d |
| 60-90 SH ocean | 4150 | 5.44 | 6.45 | +1.01 | **+32.7 d** |

Read across the northern hemisphere's land and the current parameters are
already right: **-0.03 / +0.63 / +0.26 C across the three bands.** The +1.88 C
global land bias is not a global bias at all. It is two specific failures, and
neither is a parameter that has been mis-set.

### 4a. Maritime land gets a continental swing

Every land cell is given the same heat capacity, so land surrounded by ocean is
modelled as if it were the middle of a continent. The southern hemisphere at
30-60 is almost all ocean, and its 555 land cells are Patagonia, New Zealand
and Tasmania -- maritime every one. Model 13.39 C against a teacher's 5.68.

The representative points state it as sharply as it can be stated:

| | teacher half-amp | model half-amp | ratio | phase diff |
| --- | --- | --- | --- | --- |
| 60N land (Siberia) | 21.71 | 17.87 | **0.80** | -0.2 d |
| 45N land (France) | 7.29 | 14.36 | **1.95** | -7.8 d |
| 45S land (Chile) | 5.14 | 15.91 | **3.18** | +0.3 d |

Siberia is **under**-amplified while Chile is over-amplified by more than
three times, and the three points differ by a factor of four in the direction
they pull. **No single value of `soilDepthM` or `seasonalDampingWPerM2K` can
satisfy them**, because what separates them is not a parameter -- it is that
the model has no notion of how maritime a piece of land is. France at 7.29 C
and Siberia at 21.71 C sit in the same latitude band on the same continent.

That is the same missing mechanism Stage 2 already has parked: there is no
longitudinal structure in the sea temperature, no ocean heat transport, and
nothing that lets a westerly bring an ocean's heat capacity ashore.

### 4b. The Arctic Ocean is given 30 m of water it does not have

60-90N ocean is the largest single amplitude error on the globe -- model 6.44
against a teacher's 11.31, and **23.6 days late** -- and 60-90S ocean is
32.7 days late. Both are ice-covered for much of the year, and sea ice is
thermally thin: the real surface there responds far faster and harder than a
30 m mixed layer can. Meanwhile 30-60N ocean is nearly perfect at -0.26 C.

So `mixedLayerDepthM` is being asked to be right for the North Pacific and for
the Arctic at once, and it cannot be. Note the direction: the Arctic wants a
**thinner** layer while the global ocean bias (+0.59) wants a thicker one.

`js/climate-v1/sea-ice-state.js` already computes a sea-ice thickness and
fraction around the year and deliberately does not feed back into temperature
(`meta.feedsBackIntoTemperature` is false). This measurement is the concrete
case for eventually letting it -- as a heat capacity, before any albedo.

### 4c. The continental interior of Asia is under-amplified

NE Asia 45-75N land: model 17.37 against a teacher's **21.87**, bias -4.50 --
the opposite sign to everything in 4a. Pulled together with Chile's +10.8 C,
these two are why a single land heat capacity cannot work.

## 5. The tropics: the semi-annual cycle is structurally right

| group | n | T H1 | M H1 | T H2 | M H2 | T H2/H1 | M H2/H1 | T ph2 | M ph2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0-30 land | 5625 | 4.42 | 5.61 | 0.95 | 0.93 | 0.447 | 0.408 | 35.8 d | 23.4 d |
| 0-30 ocean | 15975 | 1.58 | 1.72 | 0.28 | 0.19 | 0.351 | 0.302 | 66.9 d | 42.5 d |
| **0-10 land** | 1690 | 0.92 | 2.06 | 0.57 | 1.06 | **0.902** | **0.984** | 35.0 d | 23.5 d |
| 0-10 ocean | 5510 | 0.92 | 0.66 | 0.34 | 0.22 | 0.688 | 0.676 | 49.5 d | 42.9 d |
| 30-60 land | 6077 | 12.54 | 13.91 | 0.98 | 0.45 | 0.079 | 0.035 | 90.1 d | 52.9 d |

**The model produces the equatorial double peak, and gets its relative size
almost exactly right**: within 10 degrees of the equator the teacher's H2/H1 is
0.902 and the model's 0.984, and over the equatorial ocean 0.688 against 0.676.
The semi-annual cycle falls out of the insolation geometry -- the sun crosses
the equator twice -- and the harmonic solver carries it through with the right
gain. This was predicted at design time from a synthetic row; it is now
confirmed on the real Earth.

Two caveats worth keeping. Within 10 degrees of the equator the model's H1 is
**2.06 against 0.92** -- more than twice too large, the same over-amplification
as 4a in a place where the absolute numbers are small. And the semi-annual
peak arrives about 12 days early over land at every latitude band, which is a
lag error rather than a gain error.

The Congo representative point is a reminder to read the amplitude floor: its
teacher H1 is 0.58 C, so its 126.8-day phase difference is not meaningful and
the validator says so in as many words.

## 6. The split a calibration would use, as a baseline

| split | n | teacher amp | model amp | amp bias | amp MAE | phase bias | phase MAE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| checkerboard (x+y even) | 32390 | 4.77 | 5.74 | 0.97 | 2.20 | +4.0 d | 11.6 d |
| checkerboard (x+y odd) | 32389 | 4.77 | 5.74 | 0.97 | 2.20 | +3.9 d | 11.6 d |
| ice excluded | 53536 | 4.40 | 5.22 | 0.82 | 1.91 | +3.5 d | 11.4 d |
| ice cells only | 11243 | 12.86 | 17.17 | 4.31 | 8.59 | +13.0 d | 15.2 d |
| Antarctica (<60S land) | 6629 | 11.63 | 20.90 | 9.27 | 9.27 | +10.0 d | 10.2 d |
| Greenland | 799 | 14.53 | 19.59 | 5.06 | 5.08 | -8.9 d | 8.9 d |
| N Atlantic/Europe 45-75N | 2100 | 8.88 | 13.14 | 4.26 | 4.63 | -0.7 d | 8.5 d |
| NE Asia 45-75N land | 1890 | 21.87 | 17.37 | -4.50 | 4.91 | -2.6 d | 3.1 d |
| \|lat\| 0-30 | 21600 | 2.32 | 2.73 | 0.41 | 0.92 | +2.1 d | 13.9 d |
| \|lat\| 30-60 | 21600 | 5.65 | 7.35 | 1.70 | 2.73 | +1.8 d | 6.4 d |
| \|lat\| 60-90 | 21579 | 11.53 | 12.58 | 1.05 | 5.51 | +15.2 d | 19.4 d |

**The geographic checkerboard is free**: its two halves differ by **0.000 C of
amplitude MAE and 0.002 C of amplitude bias**. So it is a clean hold-out --
splitting the cells costs no information at all, and any gap that opens after a
fit is over-fitting and nothing else.

**The latitude-band hold-out is a real test**, since the three bands differ by
six times in amplitude MAE. **The ice split matters more than expected**: ice
is 17% of the cells and carries an amplitude MAE of 8.59 C against 1.91 C
elsewhere, so every figure has to be reported both ways or the ice will decide
the answer. The three parked regions (Antarctica, Greenland, the North
Atlantic side) are among the worst on the globe here too, as they are for the
annual field.

## 7. The absolute error, kept separate

Not a seasonal calibration metric. Reported because a seasonal parameter must
never be allowed to absorb Stage 2's annual bias, so the numbers are printed
apart from each other and both sides have their own twelve-month mean removed
before anything seasonal is compared.

| group | n | annual bias | monthly MAE | anomaly MAE | anomaly RMSE |
| --- | --- | --- | --- | --- | --- |
| all | 64779 | +0.89 | 2.84 | 1.71 | 1.93 |
| land | 22226 | +1.14 | 4.02 | 2.58 | 2.93 |
| ocean | 42553 | +0.79 | 2.35 | 1.34 | 1.51 |
| land, ice excluded | 14770 | +0.43 | 3.24 | 2.14 | 2.44 |

The annual identity holds on both sides: the teacher's twelve months average
back to its committed annual field to **9.54e-6 C**, and the model's
month-length-weighted twelve average back to Stage 2's own field to
**2.30e-5 C** -- which is the seasonal anomaly's zero annual mean, confirmed
on the real grid rather than on a synthetic row. (The *equal*-weight mean
differs by up to 0.089 C; that is the month-length effect, not an error, and it
is why each side's own equal-weight mean is what gets removed.) Stage 2's field
is byte-identical before and after the whole validation run.

## 8. Are the three parameters identifiable? Yes, and one is weak

One at a time, +/-10%, everything else held:

| variant | land amp | d | land phase | d | ocean amp | d | ocean phase | d |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current (8 / 4 m / 30 m) | 11.48 | | -0.2 d | | 3.35 | | +5.9 d | |
| lambda -10% (7.20) | 12.50 | **+1.02** | +2.2 d | +2.4 | 3.38 | +0.03 | +7.6 d | +1.7 |
| lambda +10% (8.80) | 10.60 | **-0.88** | -2.3 d | -2.1 | 3.32 | -0.03 | +4.3 d | -1.6 |
| soilDepth -10% (3.60) | 11.58 | +0.10 | -1.3 d | **-1.1** | 3.35 | 0.00 | +5.9 d | 0.0 |
| soilDepth +10% (4.40) | 11.38 | -0.10 | +0.8 d | **+1.0** | 3.35 | 0.00 | +5.9 d | 0.0 |
| mixedLayer -10% (27 m) | 11.48 | **0.00** | -0.2 d | 0.0 | 3.66 | **+0.31** | +4.2 d | -1.7 |
| mixedLayer +10% (33 m) | 11.48 | **0.00** | -0.2 d | 0.0 | 3.09 | **-0.26** | +7.3 d | +1.4 |

**`mixedLayerDepthM` is perfectly separated**: it moves the ocean and leaves
the land at 0.00 exactly, because the two surfaces share no term but lambda.

**`seasonalDampingWPerM2K` and `soilDepthM` are separated by *which* land
quantity they move.** Lambda moves land amplitude **ten times** more than
soilDepth does (1.02 against 0.10) while moving land phase only about twice as
much (2.4 d against 1.1 d). So amplitude identifies lambda and the phase
residual then identifies soilDepth -- which is exactly the calibration audit's
prediction ("fitting amplitude and phase together identifies lambda and C
separately; either alone does not"), now with numbers on it.

**Why lambda barely touches the ocean, which is the physics and not a
coincidence.** The gain is `1/sqrt(1+k^2)` with `k = omega*tau` and
`tau = C/lambda`, so the amplitude is `(F/lambda)/sqrt(1+k^2)`. The sea's
tau is **188 days**, giving k = 3.2, so it is deep in the `k >> 1` regime where
the amplitude tends to `F/(omega*C)` -- **lambda cancels out entirely**. The
land's tau is **27 days**, k = 0.47, which is the regime where lambda
dominates. The ocean's seasonal amplitude is set by its heat capacity alone and
the land's mostly by its damping, and that is why the three separate.

**`soilDepthM` is the weak one, and the reason is a parameter that is not
among the three.** `atmosphericColumnHeatCapacityJPerM2K` (1.0e7, fixed) is
**53% of C_land** but only **8% of C_sea**, so a 10% change in `soilDepthM`
moves C_land by only 4.7% while 10% of `mixedLayerDepthM` moves C_sea by 9.2%.
Land phase MAE is 8.4 d and soilDepth buys 1.05 d per 10%, so it would need to
move by tens of percent to matter. Worth knowing before a grid search reports
that `soilDepthM` "wants" a large value: it is a weak lever, not a strong
finding.

## 9. Verdict

**READY** for the three-variable grid search, with what it can and cannot buy
stated in advance.

What a search over lambda / soilDepthM / mixedLayerDepthM **can** fix:
the global land amplitude bias (+1.88 C) and the global ocean one (+0.59 C),
and a degree or two of the ocean's +5.9 d phase lag. The land phase bias is
already -0.2 d and there is nothing there to win.

What it **cannot** fix, because these are structural and were measured that
way here: maritime land (Chile 3.18x over while Siberia is 0.80x under, four
times apart in the direction they pull), the Arctic Ocean's amplitude and
23.6-day lag, and the equatorial over-amplification. A search will trade these
against each other, and the largest single risk is that the SH land error
(9.3 C over 6629 Antarctic cells) drags lambda upward and makes Siberia and NE
Asia worse -- which is why every figure must be reported with ice in and ice
out, and why Antarctica, Greenland and the North Atlantic side stay excluded
from the fit and used only for evaluation.

Adoption conditions were fixed before the search, per the audit: the annual
identity must still hold, the checkerboard hold-out must not open a gap, no
latitude band may get worse, and the reported metrics stay four separate
numbers (land/ocean x amplitude/phase) rather than one score.
