# Climate v1: sea ice as a state carried around the year

The first thing in this project that remembers anything from one orbital phase
to the next. Files: `js/climate-v1/sea-ice-state.js`,
`tools/validate_sea_ice_state.mjs`. **Nothing in the shipped pipeline imports
it**, no UI changed, and it cannot touch the temperature field.

## Why a state at all

Every earlier sea-ice rule in this project asked a question about one moment --
"is it cold enough here, now?" -- and V0.8's `seaIceYearBudget` asks it about
one closed year. Neither can answer the question sea ice actually poses: ice
that formed last winter is still there in spring, ice that survived a summer is
thicker the next year, and ice on a warm sea is gone whatever one cold night
did. So this integrates a real state variable and keeps it.

## The state is thickness, and the fraction is diagnosed

`seaIceThicknessM >= 0` is the state; `fraction = min(1, h / fullCoverThickness)`
with `fullCoverThicknessM = 0.3` is diagnosed from it. **`0.3` is empirical and
provisional** -- a real fraction needs floe-scale processes (ridging, leads,
export) this model does not have.

A fraction-only state was measured and rejected before choosing: it **saturates**.
Driven by the same forcing, an area-fraction state reads 1.00 at its annual
maximum in both the central Arctic and the Bering Sea, so it cannot tell 4.8 m
of multi-year ice from 0.7 m of first-year ice. Thickness is the conserved
quantity (it *is* the latent heat), so it carries the memory; the fraction is
what a future albedo term will read, and it comes free.

## The equations

    T_f = -1.8 C                                   physical (seawater, ~34 psu)
    freeze (T <= T_f):  F = (T_f - T) / (1/lambda + h/k_ice)     Stefan, series resistance
    melt   (T >  T_f):  F = -lambda_melt * (T - T_f)             surface, not shielded
    both:               F -= F_w
    dh/dt = F / (rho_ice * L_f),   h = max(0, h)

**The asymmetry is the whole design.** Freezing heat has to escape *through* the
ice, so the ice's own conduction is a resistance in series with the surface
exchange and growth slows as it thickens; melting happens at a surface already
at the melting point, so thickness shields nothing. That is what lets a cold sea
accumulate multi-year ice while a warm one cannot hold any.

**`F_w`, the ocean's basal heat flux, is the closure.** Without it nothing stops
a cold sea growing ice for ever -- measured, the central Arctic reaches **11 m
and is still rising after 40 years**. The default is **2 W/m2, Maykut &
Untersteiner's Arctic figure, adopted because it is the literature value**. 3
and 4 W/m2 bring the thickness closer to the observed 2-3 m, and are
deliberately *not* adopted: the sea temperature feeding this model has known
upstream errors, and fitting F_w to observed thickness would absorb those errors
into a sea-ice parameter. They are measured as a sensitivity test only.

Parameters: five `physical` (T_f, rho_ice, L_f, k_ice, F_w) and three
`empirical` (surface exchange, melt exchange, full-cover thickness).

## Numbers, all measured

Grid 256x128 (coarse on purpose: the sea temperature is a function of latitude
alone, so a finer grid carries no information the input has), 48 steps/year,
5 years, 24 stored phases.

| | annual max | annual min | max fraction | min fraction |
| --- | --- | --- | --- | --- |
| 88N | 3.26 m | 3.00 m | 1.00 | 1.00 |
| 80N | 2.81 | 2.62 | 1.00 | 1.00 |
| Bering 62N | 0.71 | **0.00** | 1.00 | 0.00 |
| Southern Ocean 70S | 1.25 | 0.37 | 1.00 | 1.00 |
| Southern Ocean 62S | 0.71 | **0.00** | 1.00 | 0.00 |
| 40N / 10N | 0.00 | 0.00 | 0.00 | 0.00 |

Perennial ice where it is always cold, seasonal ice that goes to exactly zero
each summer, and nothing at all on a warm sea. The seasonal-ice maxima are
**0.50 of a year apart** between 62N and 62S.

**Time step.** Against an 8760-step reference (20 years): 24 steps is within
0.036 m of annual maximum thickness, **48 within 0.017 m**, 96 within 0.009 m.
48 is the default.

**Spin-up, and the two convergences are different questions.**

| years | max year-boundary dh | max year-boundary df | fraction converged | thickness converged | 80N max |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.6 m | 1.0 | - | - | 1.43 m |
| 2 | 0.60 | 1.7e-3 | **2** | - | 1.95 |
| 5 | 0.29 | 4.0e-7 | 2 | - | 2.81 |
| 20 | 0.084 | 0.0 | 2 | - | 4.28 |

**The fraction reaches a periodic steady state in two years; perennial
thickness has not converged in twenty.** The default run is five years and
reports both, and a run whose thickness has not converged is a result, not a
failure -- `meta` carries `yearsUsed`, `fractionConverged`,
`thicknessConverged`, `maxYearBoundaryDifference` and
`maxFractionBoundaryDifference` so a caller can see which it has.

One consequence worth stating: at F_w = 2 the perennial cells' **within-year
swing (0.19 m at 80N) is smaller than the spin-up trend they still carry after
five years (0.29 m)**, so the *phase* of their maximum is not a meaningful
quantity until the thickness converges. The seasonal-ice zone's phase is.

**F_w sensitivity** (20 years, annual max / annual min metres):

| F_w | 88N | 80N | 62N | 70S |
| --- | --- | --- | --- | --- |
| **2 (default)** | 5.40 / 5.33 | 4.28 / 4.14 | 0.71 / 0.00 | 1.25 / 0.37 |
| 3 | 4.44 / 4.35 | 3.49 / 3.32 | 0.68 / 0.00 | 1.18 / 0.26 |
| 4 | 3.66 / 3.54 | 2.88 / 2.68 | 0.65 / 0.00 | 1.12 / 0.17 |

Seasonal ice barely moves; only the perennial core does. Not a fit.

**Obliquity.** 80N year swing 0.07 m at tilt 0, 0.14 at Earth's 23.44, 1.57 at
40; 70S 0.04 / 0.88 / 1.36. A world with no tilt has almost no seasonal ice
cycle, as it must.

**Cost and size.** 5 years x 48 steps over the whole globe: **48 ms** in node
(10 years 81 ms, 20 years 168 ms), so roughly 0.15-0.5 s on a Pixel 7a, once
per world. The stored tables are **6.0 MB** at 24 phases (thickness and
fraction, Float32); `outputPhaseCount: 12` halves that, and the integration
step count is independent of it.

## Against the teacher, and only as far as it can honestly say

The repo's only sea-ice teacher is Teacher A's annual snapshot from the Blue
Marble photograph (class 1, **1.00% of the globe**) -- the weakest layer in
that teacher, with no seasonal maximum, minimum or phase. NSIDC's Sea Ice Index
is the known upgrade path and is unreachable from this sandbox.

| | model | teacher |
| --- | --- | --- |
| annual maximum | 9.19% of the globe (N 3.86 / S 5.33) | -- |
| annual minimum / perennial | 3.23% (N 2.35 / S 0.88) | -- |
| annual snapshot | -- | 1.00% |

So: ice exists in both hemispheres, perennial and seasonal ice both appear, and
the area is the right order of magnitude and **too large**. What is *not*
verified, and must not be described as verified: the seasonal maximum, the
seasonal minimum, and the phase.

## The upstream limits, which are not to be corrected here

- **No longitudinal SST structure** -- the sea temperature is exactly
  f(latitude) (0.0 C spread within every sea row), so the 60-70 degree band
  freezes right the way round and the model's extent is far too large. There is
  no Gulf Stream to keep the Norwegian Sea open.
- **No ocean currents and no AMOC.**
- **The sea's own seasonal cycle lags by about 72 days** (the season module's
  30 m mixed layer), so the ice cycle peaks two to three months late: the model's
  Arctic maximum falls near phase 0.2 where the real one is March. The
  validator therefore states growth and melt against **each cell's own
  temperature cycle** rather than against the calendar, because a
  calendar-anchored assertion would be testing that upstream lag rather than
  this model.

Moving a sea-ice parameter to hide any of these would put an input error inside
this model, so none of it is done.

## Deliberately not generalised

There is exactly one state model, so there is no common seasonal integrator --
the boundaries (cell, phase, state, tendency) are kept clean so one can be
extracted when a second arrives (land snow, which needs precipitation first).
And there is no albedo feedback: `meta.feedsBackIntoTemperature` is `false`,
Stage 2 and the seasonal anomaly are untouched, and both V0.8 scorers print
byte-identical output (63.4% / 10.2%).
