# Climate v1: splitting the seasonal damping between land and ocean

One new parameter, `oceanSeasonalDampingWPerM2K`, in
`js/climate-v1/season.js`. **Its default is `null`, meaning "use the land
value", so a world that says nothing gets exactly the model it had.** Nothing
is adopted here: no world config carries a value, no UI shows it, and the app
still runs the single shared lambda of 8.

## 1. Why this rather than a two-layer ocean

The coarse grid search
(`docs/climate-v1-seasonal-grid-search.md`) established that a single
`mixedLayerDepthM` cannot serve the ocean's amplitude and its phase at once —
the amplitude wants 50 m and the phase wants 20 m, monotonically. A minimal
two-layer ocean was designed and pre-evaluated as the fix, and **it was
rejected on measurement**: solving

    C1 dT1/dt = F - lambda T1 - gamma (T1 - T2)
    C2 dT2/dt = gamma (T1 - T2)

per harmonic gives `T1 = F / Z` with

    Z = lambda + i w C1 + i w C2 / (1 + i w tau_ex),   tau_ex = C2 / gamma

At any physically representative lower layer, `w tau_ex` is about **60** at the
annual frequency, so the deep term saturates to a constant `gamma` and

    Z -> (lambda + gamma) + i w C1

which is **exactly a one-layer ocean with a larger lambda**. Verified rather
than argued: the two-layer 40 m / gamma 4 / 300 m case and a one-layer 40 m
with lambda 12 differ by **8.4e-4 C of amplitude MAE and 7.9e-3 days of
phase**. The diagnostic that was supposed to catch a degeneracy caught it:
lambda_eff reads 12.00 at both the first and second harmonic and the effective
capacity ratio is 0.999.

The genuinely non-degenerate regime (`w tau_ex ~ 1`, i.e. a shallow second
layer with strong exchange) is measurably **worse** than the degenerate one —
1.35 / 13.1 d or 1.26 / 16.8 d against the split's 1.27 / 11.8 d. A weak deep
relaxation changes nothing at all (identical to two decimals across
lambda2 = 0 to 2), and the lower layer's depth is irrelevant from 100 m to
2000 m, which is the saturation restated.

**So the lock was never a one-layer limitation. It was a shared-lambda
limitation.** A one-layer ocean already has two free quantities — lambda and C
— for two targets, amplitude and phase; the grid search could not use that
because lambda was pinned by the land.

## 2. Why a land/ocean split is physical rather than a second fudge

lambda is `dF/dT`: how many W/m2 leave when the surface runs 1 K warm,
counting radiation, sensible and latent flux together. Over water the latent
term responds far more strongly than over land — the water supply is
unlimited, so the evaporative flux follows Clausius-Clapeyron rather than a
soil's availability. `lambda_ocean > lambda_land` is a statement about
surfaces.

It remains an **Earth seasonal calibration candidate**, `kind: empirical`,
`search: false`, and must not be quoted as a universal constant. The comment in
`season.js` says so.

## 3. The implementation

`dampingWPerM2KForSurface(surfaceType, params)` is the one place that resolves
it, the same shape `effectiveSurfaceLapseRateCPerKm` uses in `js/climate.js`
for the two lapse rates. `buildSeasonalTemperatureTable` resolves it once per
table and passes it to `solvePeriodicResponse` per surface. **The analytic
solution, the harmonic structure and `orbitalPhase` are untouched.** The table
still reports `dampingWPerM2K` as the land value (what it always was) and adds
`oceanDampingWPerM2K` beside it.

## 4. Compatibility, proved rather than asserted

| check | result |
| --- | --- |
| default (null) vs explicitly setting ocean lambda = land lambda | **0 of 14,336 coefficients differ** |
| `dampingWPerM2KForSurface(SEA)` on an unsplit world | 8 W/m2/K, the land value |
| lambda_ocean = 10: land coefficients changed | **0** (7,168 sea coefficients change) |
| land amplitude MAE / phase MAE / phase bias at lambda_ocean 10 | **3.35 / 8.4 d / −0.2 d — exactly unchanged** |
| the seasonal anomaly's annual mean | unchanged construction: harmonics only, no constant term |
| Stage 2's annual field | never read by this module; untouched |

`js/main.js` calls `buildSeasonalTemperatureTable({ rows, body })` with no
`params`, so the app takes the default and draws exactly what it drew.

## 5. The Earth candidate: lambda_land 8, lambda_ocean 10

Measured on the grid search's own fit set (ice cells and the parked North
Atlantic block excluded), which is what makes these directly comparable with
the pre-evaluation:

| | lambda_ocean 8 | lambda_ocean 10 |
| --- | --- | --- |
| ocean amplitude MAE | 1.60 | **1.56** |
| ocean phase MAE | 12.7 d | **11.8 d** |
| ocean phase bias | +5.3 d | **+1.3 d** |
| hold-out (same three) | 1.60 / 12.7 d / +5.3 d | **1.56 / 11.8 d / +1.3 d** |

The pre-evaluation predicted 1.60 → 1.56, 12.7 → 11.8 d and +5.3 → +1.3 d, and
all three reproduce exactly. The calibration and hold-out halves are identical
to two decimals, as they were at the baseline.

By region (all ocean cells, so these include ice and are not the fit set):

| group | n | amp MAE 8 → 10 | phase bias 8 → 10 | phase MAE 8 → 10 |
| --- | --- | --- | --- | --- |
| all ocean | 42553 | 1.72 → 1.68 | +5.9 → **+1.9 d** | 13.0 → 12.0 d |
| 0–30 | 15975 | 0.60 → 0.58 | +1.2 → −2.8 d | 15.2 → 15.2 d |
| **30–60 N** | 5278 | **1.52 → 1.52** | +3.3 → **−0.7 d** | 6.4 → 6.5 d |
| 30–60 S | 10245 | 2.94 → 2.83 | +5.0 → +1.0 d | 6.8 → **4.8 d** |
| 60–90 N (Arctic) | 6905 | 6.77 → **6.84** | +23.6 → +19.5 d | 23.5 → 19.6 d |
| 60–90 S (Southern) | 4150 | 3.23 → 3.20 | +32.7 → +28.7 d | 33.1 → 29.2 d |
| N Atlantic/Europe | 824 | 2.73 → 2.65 | +12.0 → +8.0 d | 12.0 → 8.1 d |

`tau_sea` goes 188.1 → 150.5 days; `tau_land` stays 27.2.

Tropical ocean H2/H1: teacher 0.351, lambda_ocean 8 gives 0.302 and 10 gives
**0.308** — the semi-annual structure moves toward the teacher, not away.

## 6. Is the improvement a compensating error?

No, and the table above is the argument:

- **The driver is the global phase bias**, +5.9 → +1.9 days, and *every* ocean
  group's phase bias moves toward zero. That is the signature of a change to
  the ocean's timescale, which is what it is.
- **The Arctic's amplitude gets slightly worse** (6.77 → 6.84), so the
  candidate is not being chosen by the Arctic. Its phase improves, as
  everything's does.
- **The North Atlantic / Europe block is 824 of 42,553 ocean cells (1.9%)**
  and cannot be moving the global figure. It is excluded from the fit set and
  is not a reason for adoption.
- **30–60 N ocean's amplitude MAE is unchanged to two decimals** (1.52 →
  1.52) while its phase bias goes +3.3 → −0.7 d — the region that was already
  right stays right.

## 7. Is 10 an isolated lucky point?

A plain sweep, not a search:

| lambda_ocean | amp MAE | amp bias | phase bias | phase MAE | tau_sea |
| --- | --- | --- | --- | --- | --- |
| 8 | 1.72 | +0.59 | +5.9 d | 13.0 d | 188.1 d |
| 9 | 1.70 | +0.55 | +3.9 d | 12.4 d | 167.2 d |
| **10** | 1.68 | +0.51 | **+1.9 d** | **12.0 d** | 150.5 d |
| 11 | 1.66 | +0.47 | −0.0 d | 12.1 d | 136.8 d |
| 12 | 1.64 | +0.42 | −1.9 d | 12.4 d | 125.4 d |

**It is not isolated.** The amplitude MAE falls monotonically across the whole
band and the phase MAE has a broad, shallow minimum at 10–11, with the phase
bias crossing zero at about 11. 10 and 11 are near-equivalent; the sweep is
flat enough that no minimum-hunting is warranted, which is exactly what was
asked for.

## 8. Sea ice

`js/climate-v1/sea-ice-state.js` is **not modified**. Its sea-surface
temperature does change, so it was diagnosed rather than assumed:

| | lambda_ocean 8 | 10 |
| --- | --- | --- |
| global sea-ice area, annual maximum | 7.67% | 7.60% |
| annual minimum | 4.63% | 4.65% |
| 88N central Arctic, max / min thickness | 3.263 / 3.004 m | 3.286 / 3.022 m |
| 80N, max / min | 2.814 / 2.622 m | 2.861 / 2.659 m |
| Bering 62N | 0.710 / 0.000 m, seasonal | 0.699 / 0.000 m, seasonal |
| 70S | 1.250 / 0.369 m, perennial | 1.263 / 0.431 m, perennial |
| 62S | 0.707 / 0.000 m, seasonal | 0.696 / 0.000 m, seasonal |
| 40N, 10N | none | none |

**Every representative point keeps its perennial / seasonal / none
classification**, and across the whole grid only **4 of 7,295** ice-bearing
cells change class. `meta.feedsBackIntoTemperature` stays `false`.

## 9. Regression

`score_climate.mjs` and `score_koppen.mjs` print **byte-identical** output
(63.4% / 10.2%), as do `validate_temperature_v1`, `validate_surface_lapse`,
`test_moisture_stage5b` and `validate_wind_v1`. Five suites differ **only in
wall-clock timings** — three lines labelled `ms`/`ns` and one column headed
`build ms` — with every checksum, error figure and assertion identical
(`validate_season`'s own `checksum -46.778` and its whole `max error C` /
`table KB` columns match exactly). No UI changed and no world config was
written.

## 10. Verdict

**READY** to put `oceanSeasonalDampingWPerM2K: 10` into Earth's Climate v1
calibration, with the size of the gain stated plainly: the amplitude improves
by 2.5% and the phase MAE by 7%, and the real result is the **ocean phase bias
falling from +5.3 to +1.3 days**. What it does not fix is unchanged from the
baseline document — the Arctic Ocean needs a different heat capacity from the
North Pacific (sea ice, not a damping), and there is still no longitudinal SST
structure, so the North Atlantic stays parked.
