# Wind metric audit — why the same wind scored +0.33 and −0.29

Audit only. **No wind model, no humidity model and no success criterion was
changed.** One Stage 4 wind field (`thermalResponseStrength` 1,
`dragTimescaleDays` 0.5, `thermalSmoothingKm` 1500, 256×128) was pushed
through both metric paths and every intermediate printed.

## 1. The cause: the latitude band, and nothing else

| | n | mean model | mean teacher | var model | var teacher | cov | r |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \|lat\| 30–60 | 3608 | 2.656 | 6.551 | 0.044 | 15.287 | **−0.241** | **−0.294** |
| \|lat\| 30–90 | 6121 | 2.412 | 5.899 | 0.315 | 14.931 | **+0.547** | **+0.252** |
| \|lat\| 60–90 | 2801 | 1.621 | 3.992 | 0.295 | 8.262 | +0.906 | +0.580 |

`validate_wind_model_stage4.mjs` calls its extratropics **\|lat\| ≥ 30**;
`validate_tropical_wind.mjs` calls its mid-latitudes **30 ≤ \|lat\| ≤ 60**. The
60–90 band alone correlates at **+0.58** and carries a quarter of the weight,
so including it flips the covariance from −0.24 to +0.55. That is the whole
difference.

Every other axis was checked and is **not** a cause:

- **correlation formula** — one-pass `E[x²]−E[x]²` (Stage 4) and two-pass
  centred (tropical) agree to four decimals: −0.2943 / −0.2943, 0.2523 / 0.2523.
- **area weighting** — both are `cos(lat)`, identically.
- **scalar vs vector** — both correlate scalar speed `hypot(u,v)`.
- **missing values** — both skip non-finite cells; u and v are missing on
  **exactly the same 1128 cells** (below-ground at 850 hPa), so the two
  validators' differing tests (`u` only vs `u` and `v`) select the same cells.
- **annual mean / grid / regrid** — both read the same `wind-850hpa-u/v-ms.bin`
  at 144×73 and sample the model by nearest cell on the same 256×128 grid.
- **land/sea mask** — neither applies one.
- **half-cell longitude shift** — removing it moves r by 0.0001 (0.2523 → 0.2522).
- **latitude convention** — Stage 4 assumes cell-centred rows
  (`90 − 2.5·(j+0.5)·73/72`); the NCEP axis is node-centred (`90 − 2.5j`). This
  is a **real defect**, worth up to 1.23° at the poles and 0° at the equator.
  It accounts for the residual 0.328 vs 0.252 at 30–90 and −0.253 vs −0.294 at
  30–60 — a second-order effect, not the cause.

## 2. The correct definition — and why neither number should be a criterion

Correct choices: the teacher's **own node latitudes/longitudes** (Stage 4's
half-cell assumption is wrong and should be fixed), `cos(lat)` weighting, both
u and v required finite, scalar-speed correlation, nearest-cell model sampling.

But the deeper finding is that **a scalar-speed correlation is a bad criterion
for this model at either band**, and the intermediates say so plainly:

| band | sd model | sd teacher | raw r | r with each 10° band's own mean removed |
| --- | --- | --- | --- | --- |
| 30–60 | 0.210 | 3.910 | −0.294 | −0.190 |
| 30–90 | 0.562 | 3.864 | +0.252 | **+0.055** |
| 0–90 | 0.655 | 3.344 | +0.157 | **+0.017** |

The model's mid-latitude speed is **near-constant** (σ = 0.21 m/s against the
teacher's 3.91). Remove the zonal-mean profile and the +0.25 collapses to
**+0.055**: Stage 4's headline extratropical correlation is almost entirely the
model's speed falling off toward the pole across a 30–90 span, not skill at
placing fast and slow winds. The zonal means show why the 30–60 sign is
negative — the model peaks at 30–40° (2.79 m/s) while the teacher peaks at
50–60° (8.27 m/s):

| \|lat\| | 0–10 | 10–20 | 20–30 | 30–40 | 40–50 | 50–60 | 60–70 | 70–80 | 80–90 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| model | 1.28 | 2.38 | 2.71 | 2.79 | 2.74 | 2.48 | 1.96 | 1.24 | 0.60 |
| teacher | 3.99 | 4.52 | 2.98 | 4.12 | 7.84 | 8.27 | 4.90 | 2.57 | 2.51 |

## 3. Recomputed Stage 4 baseline

On the unified metric (node latitudes, cos-weighted, both components finite):

| band | direction error | speed r | vector RMSE |
| --- | --- | --- | --- |
| \|lat\| < 30 | 124.7° | −0.121 | — |
| 30 ≤ \|lat\| ≤ 60 | 20.2° | −0.291 | — |
| \|lat\| ≥ 30 | 28.3° | **+0.265** | — |
| global | — | +0.157 | 5.681 |

Previously published: +0.328 (|lat| ≥ 30, cell-centred latitudes) and −0.294
(30–60). Both are reproduced exactly; neither was an arithmetic error.

## 4. The Hadley/Gill rejection does not change — it is confirmed more strongly

Same wind builds, scored on both bands:

| case | trop dir | dir 30–60 | dir ≥30 | r 30–60 | r ≥30 | global vec RMSE |
| --- | --- | --- | --- | --- | --- | --- |
| Stage 4 baseline | 124.7° | 20.2° | 28.3° | −0.291 | **+0.265** | 5.681 |
| Hadley A=2 H=100 | 57.3° | 78.4° | 74.5° | −0.450 | **−0.259** | 10.205 |
| Gill z=2 H=100 | 57.2° | 78.4° | 74.5° | −0.450 | −0.259 | 10.219 |
| Gill l=2 H=100 | 121.9° | 37.8° | 41.0° | −0.428 | −0.353 | 10.624 |
| Gill z=2 l=2 H=100 | 58.2° | 93.7° | 85.5° | −0.561 | −0.435 | 13.215 |

On the wider band the damage is larger, not smaller: the correlation changes
sign (+0.265 → −0.259), the direction error nearly triples, and the global
vector RMSE still doubles. The freeze stands.

## 5. Unifying the validators

Yes — and it is a small change. `compareSamplerToTeacher` in
`js/climate-v1/wind-diagnostic.js` is already the shared core and is already
correct on formula, weighting and masking. Two things are needed, and neither
is done here:

1. teach the teacher grid its own latitude/longitude axes instead of assuming
   cell centres (the summary file currently stores no axes for the wind grids —
   the builder has them);
2. delete the bespoke `compare()` in `tools/validate_tropical_wind.mjs` and call
   the shared core with a band restriction.

Both change reported numbers, so they need your go-ahead first.

## 6. READY / NOT_READY

**READY** — the discrepancy is fully explained and neither validator is
arithmetically wrong. The one thing the audit did *not* leave intact is
confidence in the criterion itself: the mid-latitude speed correlation is
computed against a model field with 5% of the teacher's variance, and 78% of
its positive value at 30–90 is the zonal-mean profile rather than pattern
skill. Recommend replacing or supplementing it before it gates another stage.

---

# Follow-up — the unified validator

The wind model and its parameters are **unchanged**; only how it is measured
changed. One metric core now serves every wind tool.

## What was unified

- **`compareSamplerToTeacher`** (`js/climate-v1/wind-diagnostic.js`) is the
  only implementation. `validate_tropical_wind.mjs`'s private `compare()` is
  deleted.
- **The teacher's own axes.** `wind-summary.json` now publishes
  `latitudes`/`longitudes` per grid, and `build_wind_teacher.py` writes them,
  so nothing downstream guesses whether the grid is node- or cell-centred.
  Verified from the data, not assumed: **row 0's speed is constant across all
  144 columns to 0.54%** while row 1 varies by 25%, and row 0's `u` is a pure
  wavenumber-1 in longitude with amplitude equal to the full speed — the
  signature of one physical vector at the pole. Row 0 *is* the pole.
  The 10 m grid's T62 Gaussian axes are the ones the humidity teacher already
  publishes for the identical NCEP grid.
- **Genuinely nearest-cell sampling.** `floor` is "nearest" only when the
  sampled coordinate is a cell centre, which a node-centred axis is not.
- **cos(lat) weighting, both components required finite, explicit bands.**

## The five measures, reported separately

| | measure | what it can and cannot see |
| --- | --- | --- |
| A | direction error (cos-weighted) | direction only, blind to speed |
| B | vector RMSE | everything at once, but says nothing about which part failed |
| C | scalar speed correlation | **conflates a matching zonal profile with local skill** |
| D | zonal-mean speed RMSE (m/s) | the profile alone; no credit for anything within a row |
| E | anomaly correlation, each row's own zonal mean removed | within-row placement only; a perfect profile earns nothing |

**C never decides pass/fail on its own.** D and E are the split the audit
showed C was hiding. A latitude-only model has no within-row variance, so E is
reported as `--` for it rather than a meaningless 0.

## The bands

`tropics |lat|<30`, `midlat 30-60`, `high lat 60-90`, `extratrop |lat|>=30`,
`global`. **30–90 is `extratropics`, never "mid-latitude"** — the two were
being conflated, and they score very differently.

## Stage 4 baseline, on the unified metric

| band | A dir | B vecRMSE | C speed r | D zonal RMSE | E anomaly r | n |
| --- | --- | --- | --- | --- | --- | --- |
| tropics <30 | 119.0° | 5.774 | −0.122 | 2.007 | +0.042 | 3534 |
| midlat 30–60 | 20.2° | 5.771 | −0.294 | 5.178 | −0.318 | 3608 |
| high lat 60–90 | 53.4° | 4.263 | +0.580 | 3.077 | −0.285 | 2801 |
| extratrop ≥30 | 27.8° | 5.432 | **+0.252** | 4.732 | −0.306 | 6121 |
| global | 75.0° | 5.691 | +0.157 | 3.665 | −0.030 | 9384 |

Climate v0.8's latitude-only model for comparison: tropics 50.7°/+0.258,
midlat 32.2°/+0.212, high lat 128.2°/−0.284, extratropics 50.0°/+0.096,
global 50.7°/+0.126, E `--` everywhere.

**E is the number worth staring at.** Stage 4's within-row anomaly correlation
is **negative in every extratropical band** (−0.318 at 30–60, −0.306 at ≥30):
once the zonal-mean profile is removed, the model's longitudinal structure is
mildly *anti*-correlated with the real atmosphere's. Its genuine gain over
v0.8 is direction (50.0° → 27.8° in the extratropics), not speed pattern.

## Re-evaluation — the rejections stand

| case | trop dir | mid dir | ext dir | mid r | ext r | mid anom r | global vecRMSE | Amazon u |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Stage 4 baseline | 119.0° | 20.2° | 27.8° | −0.294 | **+0.252** | −0.318 | **5.691** | +1.51 |
| Hadley A=2 H=100 | 63.0° | 78.7° | 74.7° | −0.455 | −0.269 | −0.075 | 10.066 | −3.57 |
| Gill z=2 H=100 | 62.9° | 77.6° | 73.9° | −0.455 | −0.270 | −0.075 | 10.082 | −3.69 |
| Gill l=2 H=100 | 117.1° | 37.3° | 40.5° | −0.432 | −0.339 | −0.359 | 10.657 | +0.14 |
| Gill z=2 l=2 H=100 | 63.8° | 90.4° | 83.0° | −0.564 | −0.423 | −0.337 | 13.151 | −5.07 |

**3 of 7** for the best case, the same three passes and the same failures as
before. The extratropical speed correlation changes sign (+0.252 → −0.270),
the direction error nearly triples and the global vector RMSE still doubles.
Nothing is rescued by the wider band or by the corrected axes.

## One criterion defect fixed in the same pass

The declared criteria compared the tropical validator's **30–60** measurements
against thresholds (38°, r ≥ 0.30) taken from the Stage 4 validator's
**|lat| ≥ 30** numbers — two different bands. They now compare against this
validator's own Stage 4 baseline **on the same band**, and an extratropical
row was added. That is stricter, not looser: 7 criteria instead of 6, and the
verdict is unchanged.

## What is deliberately not unified

`tools/validate_wind_v1.mjs` (Stage 3) and the Stage 3 reproduction block
inside `validate_wind_model_stage4.mjs` still use the legacy cell-centred
convention, because their job is to reproduce published historical numbers.
Re-baselining them would turn a real check into a tautology. The Stage 4
validator prints the corrected value beside the legacy one (`dirMeanU`
unweighted, kept for that assertion; `dirMeanW` area-weighted).

## Retired names and measures

- "mid-latitude" for |lat| ≥ 30 — use **extratropics**.
- A bare scalar speed correlation as a pass/fail criterion — always with D and E.
- Any threshold quoted from a band other than the one being measured.
