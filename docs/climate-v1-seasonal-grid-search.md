# Climate v1: the first coarse grid search over the seasonal parameters

Tool: `tools/search_seasonal_temperature.mjs`. Shared calendar and harmonic
code: `tools/seasonal_calendar.mjs`. Candidates:
`worlds/kasoku-sekai/seasonal-candidates.json`.

**Nothing is adopted.** `seasonalDampingWPerM2K` is still 8, `soilDepthM` 4
and `mixedLayerDepthM` 30. No world config changed, no physics file changed,
V0.8 still reads 63.4% / 10.2%, and every Climate v1 suite passes.

## 1. The setup

Three free variables and nothing else, per the calibration audit's first
group. Fixed: `shortwaveAbsorbedFraction` 0.70 (exactly degenerate with
lambda), Earth's tilt 23.44 / e 0.0167 / periapsis 283 (physical facts,
supplied as a calibration condition of the tool, never written to the config),
Stage 2, Stage 4, Stage 5 and every sea-ice parameter.

| | values |
| --- | --- |
| `seasonalDampingWPerM2K` | 5, 6, 7, 8, 9, 10, 12 W/m²/K |
| `soilDepthM` | 1, 2, 4, 6, 8 m |
| `mixedLayerDepthM` | 10, 20, 30, 40, 50, 75 m |

**210 evaluations**, the current values among them, in **5 seconds**.

Seasonal anomalies only: each side has its own twelve-month mean removed, so
Stage 2's annual bias can never be absorbed into a seasonal parameter. The fit
set excludes ice cells, Antarctica, Greenland and the North Atlantic / Europe
block — 13,558 of 64,779 cells — which are then reported as validation for
every candidate. Calibration is the checkerboard's even half (25,593 cells),
hold-out the odd half (25,628).

**The forcing does not depend on any of the three variables**, so its Fourier
coefficients are computed once and each candidate is a handful of multiplies.
That is an optimisation, so it is **checked rather than trusted**: at three
probe points spanning the grid it reproduces `buildSeasonalTemperatureTable`'s
own month means to **exactly 0.0e+0 C**.

## 2. The baseline

| set | land amp bias | land amp MAE | land ph bias | land ph MAE | ocean amp bias | ocean amp MAE | ocean ph bias | ocean ph MAE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| calibration | +0.72 | 2.48 | −0.7 d | 8.3 d | +0.72 | 1.60 | +5.3 d | 12.7 d |
| hold-out | +0.73 | 2.49 | −0.7 d | 8.3 d | +0.72 | 1.60 | +5.3 d | 12.7 d |

The two halves agree to **0.01 C and 0.0 days**, which is the baseline
document's finding restated: the checkerboard split costs nothing, so any gap
that opens after a fit is over-fitting and nothing else.

Note how much the exclusions do: the global land amplitude bias is +1.88 C,
but over the workable domain it is **+0.72**, and the MAE 3.35 → 2.48. Most of
the land error really is in the parked regions.

## 3. The result: 55 non-dominated candidates, **0 admissible**

The four objectives, never summed, are the calibration set's land amplitude
MAE, land phase MAE, ocean amplitude MAE and ocean phase MAE. 55 of the 210
are Pareto-optimal. **Not one of them satisfies the adoption conditions**
(improve calibration somewhere, worsen it nowhere, do not worsen the hold-out,
keep the tropical H2/H1, and do not wreck a parked region).

The baseline is itself on the front, and the reason nothing beats it is worth
stating precisely rather than as a verdict:

**`seasonalDampingWPerM2K` = 8 is already the minimum.** At the baseline
depths, the calibration land amplitude MAE over lambda is

| lambda | 5 | 6 | 7 | **8** | 9 | 10 | 12 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| land amp MAE | 4.85 | 3.50 | 2.73 | **2.48** | 2.55 | 2.76 | 3.29 |
| land amp bias | +4.80 | +3.17 | +1.83 | **+0.72** | −0.20 | −0.98 | −2.20 |

One minimum, and it lands on the value that was already there. The search was
not told what lambda is, and 8 was adopted before any seasonal teacher existed
— so this is the same kind of self-validation Stage 6 found when the whole
model's agreement peaked at Earth's own 14 °C.

**`soilDepthM` = 4 is also already the minimum**, at lambda 8:

| soilDepthM | 1 | 2 | **4** | 6 | 8 |
| --- | --- | --- | --- | --- | --- |
| land amp MAE | 2.555 | 2.521 | **2.479** | 2.482 | 2.539 |
| land phase MAE | 12.64 | 10.76 | **8.34** | 8.84 | 11.27 |

## 4. Why the ocean cannot be fixed: one heat capacity, two requirements

`mixedLayerDepthM` is the only variable with real room to move, and it moves
the ocean's amplitude and its phase in **opposite directions, monotonically**:

| mixed layer | Arctic amp MAE | Arctic ph bias | 30–60 ocean MAE | calib ocean amp MAE | calib ocean ph bias | calib ocean ph MAE |
| --- | --- | --- | --- | --- | --- | --- |
| 10 m | **4.96** | **+1.6 d** | 7.25 | 4.53 | −16.6 d | 20.8 d |
| 20 m | 5.82 | +16.6 d | 3.88 | 2.42 | **−1.7 d** | **12.1 d** |
| **30 m** | 6.77 | +23.6 d | 2.45 | 1.60 | +5.3 d | 12.7 d |
| 40 m | 7.44 | +27.5 d | 1.79 | 1.29 | +9.2 d | 14.5 d |
| 50 m | 7.91 | +30.0 d | **1.53** | **1.26** | +11.7 d | 16.0 d |
| 75 m | 8.66 | +33.5 d | 1.53 | 1.45 | +15.2 d | 18.4 d |

The amplitude wants **50 m**; the phase wants **20 m**. A single layer cannot
give both, and 30 m is already sitting between them. Going to 50 m buys
0.34 C of amplitude MAE and costs 3.3 days of phase — which is why every
deep-layer front point is rejected.

The same table answers the second compensating-error question directly: **a
shallower layer fixes the Arctic and breaks the mid-latitudes.** At 10 m the
Arctic's phase bias collapses from +23.6 d to +1.6 d and its amplitude MAE
from 6.77 to 4.96 — a large, real improvement in the worst region on the
globe — while the 30–60 ocean goes 2.45 → **7.25** and the calibration ocean
amplitude MAE 1.60 → 4.53. That is not a parameter to be tuned; it is the
Arctic needing a *different* heat capacity from the North Pacific, which is
the sea-ice feedback the baseline document already identified.

## 5. lambda and soilDepthM are confounded in amplitude and separated by phase

The audit predicted this and the grid now shows it as a picture. Land
amplitude MAE, rows = lambda, columns = `soilDepthM`:

| | 1 m | 2 m | 4 m | 6 m | 8 m |
| --- | --- | --- | --- | --- | --- |
| 5 W | 6.527 | 5.976 | 4.849 | 3.862 | 3.116 |
| 6 W | 4.408 | 4.104 | 3.504 | 2.988 | 2.635 |
| 7 W | 3.135 | 2.994 | 2.734 | 2.547 | **2.476** |
| 8 W | 2.555 | 2.521 | **2.479** | 2.482 | 2.539 |
| 9 W | **2.489** | 2.502 | 2.546 | 2.620 | 2.724 |
| 10 W | 2.661 | 2.688 | 2.759 | 2.850 | 2.961 |
| 12 W | 3.198 | 3.225 | 3.291 | 3.372 | 3.466 |

There is a **ridge**: (7, 8 m) scores 2.476, (8, 4 m) 2.479 and (9, 1 m)
2.489 — three points indistinguishable in amplitude at very different
timescales (τ_land 45.6 / 27.2 / 15.7 days). Land phase MAE breaks the tie
outright:

| | 1 m | 2 m | 4 m | 6 m | 8 m |
| --- | --- | --- | --- | --- | --- |
| 7 W | 11.12 | 9.36 | **8.32** | 10.59 | 14.00 |
| 8 W | 12.64 | 10.76 | **8.34** | 8.84 | 11.27 |
| 9 W | 13.93 | 12.09 | 9.21 | **8.21** | 9.47 |

(7, 8 m) costs **14.00 days** against (8, 4 m)'s 8.34 for the same amplitude.
So the calibration audit's claim — "fitting amplitude and phase together
identifies lambda and C separately; either alone does not" — is now a measured
fact rather than an argument, and it is what makes `soilDepthM` identifiable
at all: across 1–8 m the amplitude MAE moves only **0.075 C** while the phase
MAE moves **4.30 days**.

## 6. The compensating error, caught in the act

The first version of this probe was **vacuous and saying so matters**:
`--include-antarctica` changed nothing, because Antarctica is essentially all
ice class and the ice exclusion already removed it. The working probe
re-admits ice, Antarctica, Greenland and the North Atlantic block together.

- Across the grid, lambda correlates with Antarctica's amplitude MAE at
  **r = −0.924**: Antarctica's error falls monotonically (17.93 at lambda 5 to
  **3.25** at lambda 12), so it pulls lambda **up**.
- NE Asia pulls the other way: its amplitude bias runs +2.69 at lambda 5 to
  −4.50 at 8 and **−9.66** at 12, so it pulls **down**.
- With the parked regions excluded the calibration land amplitude MAE is
  smallest at **lambda = 8**. With them admitted it is smallest at
  **lambda = 10**.

**That two-value shift is the compensating error, measured.** Letting the
parked structural errors into the objective moves lambda by 25%, buying a
lower Antarctic number with a NE Asian bias 3 C worse. The exclusion is doing
exactly the job it was specified to do.

## 7. Representative candidates

Not "the best" — the front has no best. Each is rejected, and for a stated
reason.

| candidate | why it is on the front | what it costs |
| --- | --- | --- |
| **8 / 4 / 30** (baseline) | on the front already | — |
| 8 / 4 / 50 | ocean amp MAE 1.60 → **1.26**, land untouched | ocean phase MAE 12.7 → 16.0; Arctic MAE 6.77 → 7.91 |
| 9 / 6 / 30 | land phase MAE 8.3 → 8.2, ocean 1.60 → 1.58 and 12.7 → 12.1; Antarctica 9.27 → **6.62**, Greenland 5.08 → 3.14 | land amp MAE 2.48 → **2.62**; NE Asia MAE 4.91 → **6.87** |
| 7 / 4 / 20 | ocean phase MAE 12.7 → 11.8; Arctic 6.77 → 5.76 | land amp MAE 2.48 → 2.73; ocean amp MAE 1.60 → **2.49**; mid-lat ocean 2.45 → 4.00 |
| 5 / 1 / 50 | ocean amp MAE → 1.26, mid-lat ocean 2.45 → **1.54** | land amp MAE 2.48 → **6.53**; Antarctica 9.27 → **21.58** |

**9 / 6 / 30 is the interesting one and the clearest trap.** It improves three
of the four objectives and halves Greenland's error, and it is still rejected:
land amplitude MAE gets worse and NE Asia's gets 40% worse. It is lambda being
dragged up by exactly the structural errors section 6 identified — the
compensating error arriving through a candidate rather than through a fit.

## 8. Latitude bands (amplitude MAE)

| band | teacher amp | baseline | 9/6/30 | 8/4/50 | 5/1/50 |
| --- | --- | --- | --- | --- | --- |
| 0–30 NH land | 5.08 | **1.18** | 1.35 | 1.18 | 2.96 |
| 0–30 SH land | 3.60 | 2.71 | **1.93** | 2.71 | 6.42 |
| 30–60 NH land | 13.34 | **2.95** | 3.24 | 2.95 | 8.86 |
| 30–60 SH land | 5.68 | 7.72 | **6.02** | 7.72 | 15.61 |
| 30–60 NH ocean | 4.63 | **1.52** | 1.52 | 1.79* | 1.99 |
| 60–90 NH land | 18.70 | **4.01** | 4.51 | 4.01 | 11.43 |
| 60–90 NH ocean | 11.31 | 6.77 | 6.80 | 7.44* | 7.88 |
| 60–90 SH land | 11.63 | 9.27 | **6.62** | 9.27 | 21.58 |

\* from the mixed-layer table in section 4.

Every candidate that helps the southern hemisphere's land hurts the northern
hemisphere's, and the northern bands are where the baseline is already right.

## 9. The tropics survive, and that is a constraint that bit

Within 10° of the equator the teacher's H2/H1 is **0.902**. The baseline gives
**0.984**; 9/6/30 gives 0.958 and 5/1/50 gives 0.974, but 7/8/20 gives 0.834
and 6/8/50 moves it far enough to be rejected on that ground alone. The
semi-annual structure is a real constraint on this grid, not a free rider.

## 10. Verdict

**NOT_READY to adopt any parameter set. Stay at lambda 8 / soil 4 m / mixed
layer 30 m.** Three independent reasons:

1. **Both land parameters are already at their own minima.** The search
   confirms the shipped values rather than improving on them.
2. **The only headroom is the ocean's amplitude, and a single layer cannot
   take it** without giving back more in phase. The amplitude wants 50 m, the
   phase wants 20 m, and 30 m is between them.
3. **Every candidate that looks better is lambda absorbing a parked structural
   error.** Section 6 measures that directly: admitting those regions moves the
   preferred lambda from 8 to 10.

**A finer grid is not the next step.** The Pareto front spans the entire range
of lambda and `soilDepthM`, which means those variables are trading against
each other rather than being pinned — refining between 8 and 9, or between 4
and 6 m, would buy a different trade rather than a better answer. The most a
local refinement could find is the mixed layer between 20 and 40 m, and its
value is bounded by the table in section 4: about 0.3 C of amplitude against
about 2 days of phase, both smaller than the errors the structural problems
already carry.

What would actually move these numbers is what the baseline document named,
and it is mechanism rather than parameter: a heat capacity that differs
between maritime and continental land, and one that differs between ice-covered
and open ocean. `js/climate-v1/sea-ice-state.js` already computes the thickness
the second of those needs and deliberately does not feed it back.

## Afterword (2026-09-18)

The three variables stayed at **8 / 4 m / 30 m** and still do. What moved
instead was the assumption behind this whole grid: λ was being asked to serve
land and ocean at once. Splitting it and adopting **λ_ocean = 10** is recorded
in `docs/climate-v1-ocean-damping-split.md` §11 — the land side of every number
in this document is unchanged by it, and the ocean phase bias it was fighting
falls from +5.3 to +1.3 days on this same fit set.
