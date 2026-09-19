# Climate v1: land-sea thermal coupling

Code: `js/climate-v1/land-sea-coupling.js`.
Validator: `tools/validate_land_sea_coupling.mjs`.
Earth's one calibrated number: `CLIMATE_V1_EARTH_LAND_SEA_CALIBRATION` in
`js/climate-v1/earth-temperature-calibration.js`.

## 1. The structural gap this closes

Stage 2's land temperature is

    T_land = seaLevelC(lat) - surfaceLapseRate * z

and reads no ocean field of any kind. The SST longitude pre-evaluation
measured the consequence directly: an ocean-only SST correction of any size
changes **exactly 0 land cells, worst |dT| 0.00e+0 C**. So improving the North
Atlantic could never move Europe, and every SST result was invisible anywhere
a person looks.

This module is the missing link, and it is deliberately built *before* any SST
longitude structure, because without it that work has nowhere to land.

## 2. What is carried: an anomaly, never an absolute temperature

    A_surface = seaFraction * (T_sea - seaLevelC(lat))     over water
    A_surface = 0                                          over dry land
    dA/dt     = (A_surface - A) / tau                      along the back trajectory
    T_land    = T_stage2 + A

`seaLevelC` is the model's own per-latitude sea-level land temperature -- the
same curve `buildTemperatureField` already used -- so no new input enters.

**The obvious form was built first and rejected on measurement.** Relaxing the
air toward the *surface temperature itself* and advecting that is what the
design brief's equation says literally, and it fails: the Stage 4 wind has a
systematically poleward meridional component in the northern hemisphere (+0.4
to +0.65 m/s), so every back trajectory arrives from the equatorward side and
imports a warm bias that has nothing to do with the sea. Non-ice land MAE went
**2.43 -> 2.95 C** and NE Asia's bias **+3.33 -> +5.76 C** at tau = 8 d. The
wind's error was being converted one-for-one into a temperature error.

The anomaly form removes that channel structurally: over land the forcing is
zero, so a trajectory that wanders equatorward carries nothing, and an air
mass that has been over land for the whole horizon comes out at exactly zero.

Two consequences worth stating, because both were requirements and neither
needed a rule:

- **A continental interior is left alone by construction.** Mean |anomaly| by
  distance from the sea: **1.46 / 0.83 / 0.43 / 0.13 / 0.02 C** at 0-250 /
  250-500 / 500-1000 / 1000-2000 / 2000-4000 km. There is no distance test
  anywhere in the model; that is the exponential decaying over unforced land.
- **The sea is never modified.** Every ocean cell is unchanged (0 changed,
  worst |dT| 0.00e+0), so SST, sea ice and the ocean's seasonal cycle are
  untouched.

## 3. The isotropic alternative, and why it is not adopted

An isotropic "oceanicity" -- blend toward the nearest ocean by
`exp(-distance/L)` -- scores *better* globally (MAE 2.19 at L = 1000 km
against the directional form's 2.31) and is still rejected, because it cannot
tell air that came off the sea from land that merely happens to be near it:

| | baseline | directional (tau 7 d) | isotropic (L 1000 km) |
| --- | --- | --- | --- |
| NE Asia bias | +3.33 | **+3.34** | +4.06 |
| N. America east bias | +3.29 | **+3.10** | +3.62 |
| mean anomaly 1000-2000 km inland | -- | **0.13 C** | 0.54 C |
| mean anomaly 2000-4000 km inland | -- | **0.02 C** | 0.18 C |

NE Asia's upwind fetch is several thousand kilometres of Siberia, so the
directional form correctly does nothing there; the isotropic form warms it
because the Pacific and the Arctic are close by. Its global gain is bought by
pushing marine air 2000 km inland, which is the thing the mechanism exists not
to do.

## 4. The one parameter

`landSeaThermalRelaxationDays`, **empirical, an Earth calibration, not a
universal constant**, default **0** (off). Earth's value is **7 days**.

It is a plateau, not a minimum -- global non-ice land MAE:

| tau (d) | 2 | 5 | 7 | 10 | 20 |
| --- | --- | --- | --- | --- | --- |
| MAE | 2.35 | 2.32 | **2.31** | 2.32 | 2.34 |
| Europe bias | -5.14 | -4.97 | **-4.96** | -5.02 | -5.41 |

**`mixingEfficiency` was considered and is forbidden**, on an algebraic
reason rather than a preference: the marine anomaly is identically

    A_ocean = (1 - oceanModeration) * (meanTemperatureC - seaLevelC)

so a mixing efficiency multiplying it is **exactly degenerate with
`oceanModeration`** over land. Measured, mu = 1 was best at every pairing
tried (tau 6 / mu 1 -> 2.31; tau 12 / mu 0.5 -> 2.32; tau 24 / mu 0.25 ->
2.36). One parameter, and `oceanModeration` is not re-fitted.

## 5. Numerical settings, which are not parameters

`TRAJECTORY_HORIZON_TIMESCALES = 6` and `STEPS_PER_TIMESCALE = 12`. The kernel
is `exp(-t/tau)`, so cutting at 6 timescales discards `exp(-6)` = **0.25%** of
the total weight -- a stated, bounded truncation rather than a distance rule.
The step is tau/12, which at 7 days and the Stage 4 wind's ~2.7 m/s moves a
parcel about 136 km, under one cell of a 256-wide grid at mid latitudes.

Edge cases are explicit: longitude wraps; a trajectory that leaves the grid at
a pole stops there and is counted (**85 of 32768** at Earth's settings); a calm
cell simply stays put and goes on relaxing toward the surface under it, which
is the ODE's own behaviour rather than a special case (a windless world
produces a finite field, worst |anomaly| 5.4 C, and no trajectory leaves the
grid). `body.radiusMetres` is **required and throws if absent** -- an Earth
radius silently applied to Mars would shorten every trajectory threefold.

## 6. What it buys, on Berkeley Earth over non-ice land

7459 cells, area-weighted. Ice cells are excluded because the polar warm bias
is an ice-sheet energy-balance problem this mechanism does not address.

| | baseline | tau = 7 d |
| --- | --- | --- |
| global MAE | 2.47 | **2.31** |
| global bias | +0.41 | **+0.13** |
| Europe | -5.62 | **-4.96** |
| NE Asia | +3.30 | +3.32 |
| N. America east | +3.27 | +3.09 |
| N. America west | -1.99 | -1.64 |
| South America | +2.03 | +1.65 |
| Australia | +2.23 | +0.96 |
| tropical interior | +2.47 | +2.40 |

Elevation bands, MAE (the surface lapse rate stays 5.2 C/km and is not
re-fitted): 0-200 m **2.93 -> 2.56**, 200-500 2.34 -> 2.26, 500-1000 2.39 ->
2.32, 1000-2000 2.24 -> 2.12, 2000 m+ 1.85 -> 1.88. Every band's bias moves
toward zero and none loses more than 0.05 C. The marine anomaly and the lapse
term are independent additive terms, so the ordering question is moot --
they commute -- and the physically natural reading is the one the code
already encodes: the lapse is local, the anomaly is advected.

**Europe gains only 0.66 C of its 5.62**, and the reason is upstream rather
than in this mechanism: with a latitude-only SST the marine anomaly is just
**+4.24 C at 60-70N** (and +0.88 at 40-50N, -3.19 in the tropics, +2.47 at
55-65S). There is no more warmth in the model's sea to carry.

## 7. The Stage 4 wind's limits, measured and not hidden

The wind model is **frozen** and was not re-fitted; it is used only as a rough
"which way does the air come from". Its error is reported by running the same
coupling on NCEP's observed 850 hPa wind as a diagnostic:

| | model wind | observed wind |
| --- | --- | --- |
| global MAE | 2.31 | **2.10** |
| Europe | -4.96 | -4.94 |
| NE Asia | +3.32 | +3.52 |
| N. America east | +3.09 | +3.09 |
| tropical interior | +2.40 | **+1.34** |
| South America | +1.65 | **+0.72** |

So: **usable in mid latitudes** (the three mid-latitude regions agree to under
0.4 C), **weak in the tropics**, because the Stage 4 field has no trade winds
at all -- at Sao Paulo it gives u = +2.80 m/s where NCEP gives -1.18. The
entire model/observed gap is tropical. That is a statement about the wind
stage, not a reason to reopen it.

## 8. The chain to SST longitude structure, confirmed

With the same coupling, fed the SST pre-evaluation's upper-bound diagnostic
(a per-latitude longitudinal harmonic fit of the teacher's own sea field,
zero row mean, **not** a model and not implemented anywhere):

| | baseline | + coupling | + coupling + longitudinal SST |
| --- | --- | --- | --- |
| Europe bias | -5.62 | -4.96 | **-3.20** |
| global land MAE | 2.47 | 2.31 | **2.23** |

So the causal chain **SST longitude -> marine air -> land temperature** is
connected and carries about **1.8 C** into Europe. That is the return on this
stage, and it is the reason to re-evaluate candidate C (the gyre east-west
dipole) next. The remaining -3.2 C is the North Atlantic's *net* heat
transport, which the SST round measured as a non-zero-mean problem that
redistribution cannot reach.

## 9. Scope

Annual mean only. No seasonal land-sea coupling: seasonal amplitude and phase
are untouched. Not wired into the preview pipeline, so nothing the app draws
changes -- see CLAUDE.md for why switching it on is a separate, deliberate
step (it would move Stage 4's wind and Stage 5's humidity, both of which read
the temperature field).
