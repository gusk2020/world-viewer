# Climate v1: the calibration audit

What may be optimised to reproduce Earth, what may not, and what no amount of
optimising will reach. Written before any Earth calibration is attempted, so
that the answer to "why is this number what it is" can never become "the
search chose it".

Nothing was fitted, searched or changed to produce this document. Values are
read out of the code, not recalled.

## 1. Parameter inventory

Classes: **A** physical constant · **B** physically constrained
representative value · **C** empirical · **D** numerical · **E** UI/display ·
**F** obsolete/frozen.

### Stage 2 — annual temperature (`js/climate.js`, overridden by `js/climate-v1/earth-temperature-calibration.js`)

| Parameter | Value | Class | Acts on | Calibrate? |
| --- | --- | --- | --- | --- |
| `insolationSensitivityC` | 80.68 (v1) | C | equator-to-pole gradient | already calibrated; Stage 2 closed |
| `oceanModeration` | 0.818 (v1) | C | flattening of the sea's annual mean | already calibrated; Stage 2 closed |
| `polarExtraC` | schema default, **not** in v1's set | C | polar correction | 2nd group only, singly |
| `surfaceLapseRateCPerKm` | 5.2 | **B** | surface temperature vs ground height | **fixed** — measured (5.27), not fitted |
| `lapseRateCPerKm` | 6.5 | **A** | free-air column; inverted for pressure | **frozen** |
| `meanTemperatureC` | user's slider | **E** | global offset | never — it is the user's control |

### Stage 4 — wind (`js/climate-v1/wind.js`) — **frozen**

| `thermalResponseStrength` 1 · `dragTimescaleDays` 2 · `thermalSmoothingKm` 1000 | C | wind direction and speed | **frozen** |

`heatingResponseStrength`, `zonalHeatingStrength`, `longitudinalHeatingStrength`
all default 0 — **F**, see `docs/climate-v1-wind-negative-results.md`.

### Stage 5 — humidity and moisture (`humidity.js`, `moisture.js`)

| Parameter | Value | Class | Calibrate? |
| --- | --- | --- | --- |
| Magnus coefficients 6.112 / 17.67 / 243.5 | — | **A** | **never** |
| `surfaceRelativeHumidity` | 0.826 | C | Stage 5 closed; degenerate with the Stage 2 bias |
| `moistureResidenceDays` | 8 | C | Stage 5 closed; degenerate with ET |
| `eddyDiffusivityM2PerS` | 0 | A | fixed at 0, measured |
| `landEvapotranspirationWeight` | 0 (OFF) | C | not until the wind delivers moisture |
| `evapotranspirationTimescaleDays` | 4.6 | **B** | fixed — derived from the bulk formula |
| availability ramp centre / half-width | 0.5 / 0.25 | C | **empirical and provisional**, not physical constants |

### Season (`js/climate-v1/season.js`)

| Parameter | Value | Class | Note |
| --- | --- | --- | --- |
| `seasonalDampingWPerM2K` | 8 | C | **the only free number in the seasonal model** |
| `soilDepthM` / `soilVolumetricHeatCapacityJPerM3K` | 4 / 2.2e6 | B | sets `C_land` |
| `mixedLayerDepthM` / `waterVolumetricHeatCapacityJPerM3K` | 30 / 4.0e6 | B | sets `C_sea` |
| `shortwaveAbsorbedFraction` | 0.70 | B | **fixed** — exactly degenerate with λ (§6) |
| `solarConstantWPerM2` / `yearLengthDays` | 1361 / 365.2422 | A | never |
| `harmonics`, `defaultPhaseSamples` | derived / 360 | D | accuracy settings, not fits |

### Orbit

`orbitalEccentricity`, `periapsisLongitudeDeg`, `body.axialTiltDegrees` — **A**.
Physical facts about the body. Earth's 0.0167 / 283 / 23.44 are **never fitted**.

### Sea ice (`js/climate-v1/sea-ice-state.js`)

| `freezeTemperatureC` −1.8 · `iceDensityKgPerM3` 917 · `latentHeatFusionJPerKg` 3.34e5 · `iceConductivityWPerMK` 2.03 | **A** | **never** |
| `oceanBasalHeatFluxWPerM2` 2 | A (literature) | **never** — the user's own explicit ruling |
| `surfaceExchangeWPerM2K` 15 · `meltExchangeWPerM2K` 15 | C | 2nd group |
| `fullCoverThicknessM` 0.3 | C | **never against the area teacher** (§6) |

### Numerical (D)

`stepsPerYear` 48 · `outputPhaseCount` 24 · `years` 5 · grid 256×128 ·
`thicknessToleranceM` / `fractionTolerance` 0.01. Accuracy and cost, never
fitted to a teacher.

## 2. Structural limitations, and whether a search can reach them

| Limitation | Reachable by parameter search? |
| --- | --- |
| No longitudinal SST structure (sea temperature is exactly f(latitude): 0.0 °C spread within every one of 961 sea rows) | **No.** Zero variance cannot be created by a coefficient |
| No AMOC / ocean heat transport | **No.** `oceanModeration` is already its stand-in |
| Stage 4 wind's moisture transport (Amazon and Congo at exactly 0.00 g/kg) | **Effectively no.** Exact zero leaves nothing to multiply |
| No precipitation, no soil water | **No** — structural |
| Annual-mean steady-state humidity | **No** — structural |
| Stage 2's annual mean does not read eccentricity | **No** — Stage 2 never sees `e` |
| Sea-ice area 9.19% against the teacher's 1.00% | **Apparently yes, really no.** `fullCoverThicknessM` lowers the number while absorbing the SST error |
| One-layer seasonal ocean | **Partly.** Amplitude is reachable via λ and C; the ~72-day lag is the single layer itself |
| 南極 +10.5 / グリーンランド −3.6 (opposite signs at the same kind of place) | **No.** Needs a surface energy balance; ice albedo was measured to trade one for the other |
| ヨーロッパ −5.2 | **No** — maritime heat transport |

## 3. Teachers, and what each is for

| Data | Role |
| --- | --- |
| Berkeley Earth annual mean (`temperature-annual-mean-c.bin`) | **calibration (primary)** — observations |
| NCEP 2 m air temperature | **validation only** — it is a model field |
| NCEP specific humidity, surface pressure | calibration for humidity only; never mixed with Berkeley Earth inside one ratio |
| NCEP wind 10 m / 850 hPa, annual | validation only (Stage 4 frozen) |
| **NCEP wind DJF / JJA (U, V)** | **committed but read by no validator** — a **半年差・季節振幅の参考診断** only. Two solstice-season means give the seasonal *amplitude* and the hemispheric contrast; they cannot constrain the seasonal *phase*, because two points half a year apart fit any lag as well as any other. Not a seasonal hold-out. |
| Teacher A (`present-classes.png`) | reference only — v0.8, largely photograph-derived |
| Teacher B (Köppen) | reference only |
| Sea-ice snapshot | reference only — annual, no season, no phase |

| **Berkeley Earth monthly climatology** (`temperature-monthly-mean-c.bin`) | **calibration (primary) for the seasonal cycle** — the twelve months whose mean *is* the annual teacher above |
| NCEP `air.2m` monthly | validation only — a model field, and never the thing the seasonal parameters are fitted to |

**The gap this audit found has since been closed.** It read, when written:
"there is **no seasonal temperature teacher** — Berkeley Earth is committed as
an annual mean only, so `seasonalDampingWPerM2K` and the two heat capacities
cannot currently be calibrated against anything at all." The monthly
climatology was already being computed inside
`tools/build_temperature_teacher.py` and discarded; it is now committed beside
the annual field, with twelve months per cell and a phase convention of
`(monthIndex + 0.5) / 12`. Amplitude **and** phase are therefore both
observable, which is what separates λ from C (section 1). Nothing has been
fitted to it — that is the next round's decision, not this one's.

## 4. Hold-out design

Detection of over-fitting, never a route to regional coefficients.

1. **Geographic checkerboard** `(x+y)` even/odd — the project's existing
   precedent (Stage 2, Stage 4, Stage 5A; both halves agreed to three decimals).
2. **Latitude-band hold-out** — fit with one 30° band removed, score on it.
3. **Ice cells in / out** — ice is 11.3% of land and 30.9% of the error, so
   every figure is reported both ways.
4. **The three parked regions** (南極, グリーンランド, 北大西洋側) are excluded
   from every fit and used only for evaluation.

## 5. Metrics — never collapsed into one score

Computable today: annual temperature bias / MAE / RMSE; by elevation band
(0–500 / 500–1500 / 1500–3000 / 3000+, with and without ice); tropical land
temperature; humidity bias / RMSE; wet/dry contrast (アマゾン ÷ サハラ);
wind direction and speed; sea-ice area to an order of magnitude.

Computable now that the monthly teacher is committed: **seasonal amplitude and
seasonal phase**, per cell and per latitude band, on land and sea separately.

Still needs a teacher that does not exist: **the sea-ice seasonal state**
(the committed snapshot is annual, with no maximum, minimum or phase).

Temperature and humidity are known not to improve together, so they are held
as a 2-objective Pareto front rather than summed.

## 6. Compensating errors — the pairs to keep apart

| Absorber | Error it would hide |
| --- | --- |
| `shortwaveAbsorbedFraction` ↔ `seasonalDampingWPerM2K` | **Exactly degenerate** (amplitude ∝ F/λ). Fix 0.70, move λ only |
| `insolationSensitivityC` ↔ `polarExtraC` | The same gradient written twice. Never both free |
| `insolationSensitivityC` ↔ missing meridional transport | Unbounded it parks near 30; the 55–85 independent determination is the guard |
| `oceanModeration` | **Already the absorber** for ocean heat transport — never read as a physical value |
| `landEvapotranspirationWeight` ↔ Stage 4 wind error | On the model wind it drives サハラ to 12.54 g/kg against a teacher of 4.67 |
| `moistureResidenceDays` ↔ ET | τ = 8 was fitted in a world with no land source |
| `surfaceRelativeHumidity` ↔ Stage 2 warm bias | q = RH · q_sat, so RH swallows the temperature error |
| `fullCoverThicknessM` ↔ SST error | The only thickness→area conversion; fitting it to the area teacher hides everything upstream |
| `oceanBasalHeatFluxWPerM2` ↔ SST error | Already ruled out by the user |
| `thermalResponseStrength` ↔ R × pressure ratio | The code states only their product is identifiable from one planet — a generality risk, not just a fit risk |

**Separability worth knowing**: for the seasonal model the response gain is
`1/sqrt(1+k²)` and the lag `atan(k)/(nω)` with `k = nωC/λ`. The **lag depends
only on τ = C/λ**, while the **amplitude carries an extra 1/λ**. So fitting
amplitude *and* phase together identifies λ and C separately; fitting either
alone does not.

## 7. The first group — three parameters, and no more

`seasonalDampingWPerM2K`, `soilDepthM` (→ `C_land`), `mixedLayerDepthM`
(→ `C_sea`).

Chosen because the seasonal anomaly's annual mean is **exactly zero by
construction**, so moving these cannot damage Stage 2's annual field — the
one part of the model the user has already accepted. Identification is clean
per §6, and four observables (land/sea × amplitude/phase) constrain three
unknowns.

**Second group, later and singly**: `polarExtraC` (±12; a three-knob variant
was already measured to make one mid-latitude band worse), sea ice's two
exchange coefficients.

**Not in any group**: everything in Stage 4, Stage 5's closed settings, the ET
group (the wind comes first), `fullCoverThicknessM`.

20–30 variables are never searched at once.

## 8. Search method

Coarse **3-D grid → hold-out check → local refinement**. One evaluation is a
season-table build (33–125 ms) plus scoring, well under a second, so a grid
over three parameters is fully reproducible and auditable. Bayesian
optimisation is declined at this size: its acquisition function is one more
thing that can be wrong, for no gain.

(The full Stage 2 + wind + humidity problem costs 2–3 s per evaluation and
would need the evolutionary search — which is exactly the thing not being done.)

## 9. What optimisation can and cannot buy

**Can**: the seasonal amplitude and phase, which are currently uncalibrated
against anything — the only real headroom. A quantitative expectation is
deliberately **not** stated here, because with no seasonal teacher any number
would be a guess.

**Ceiling already measured elsewhere**: Stage 2's residual has R² 0.000 on
elevation and 0.002 on coast distance; all six candidate predictors together
bound it at MAE 2.42 → 2.08, i.e. about 0.3 °C.

**Cannot**: the polar bias pair, European maritime warmth, SST longitudinal
structure, AMOC, the Amazon/Congo zeros, precipitation, soil water, the
9× sea-ice area, high-e annual means. **Wind, humidity and sea ice will not
reach realism through parameter optimisation** — what is missing in each is a
mechanism, not a number.

## 10. Adoption conditions, fixed in advance

- the calibration metrics improve;
- **every** hold-out improves or is unchanged;
- the value stays inside its *independently determined* range, not merely the
  schema's min/max;
- no frozen stage is reopened;
- no pair from §6 becomes newly degenerate;
- Pixel 7a cost does not regress;
- e = 0, the Moon and Mars still behave (generality is not traded for Earth);
- Climate v0.8 still prints 63.4% / 10.2%.

## 11. What V0.8's 63.4% / 10.2% are, and are not

63.4% is the mean IoU of v0.8's four painted land-cover classes against
Teacher A (largely the satellite photograph); 10.2% is Teacher B's eight
Köppen classes. **Neither reads any Climate v1 field.** They are regression
guards — they must not move — and never Climate v1's objective.

## See also

- `docs/climate-v1-temperature-validation.md` — Stage 2's own calibration and checkerboard
- `docs/climate-v1-stage2-closed-and-humidity-rebaseline.md` — why Stage 2 is closed, and the parked list
- `docs/climate-v1-wind-negative-results.md` — why Stage 4 is frozen
- `docs/climate-v1-stage5-closed.md` — Stage 5's production baseline and the bucket rejection
- `docs/climate-v1-surface-lapse-rate.md` — why 5.2 is adopted rather than fitted
- `docs/climate-v1-seasonal-cycle.md` — the seasonal model and its orbit
- `docs/climate-v1-sea-ice-state.md` — the sea-ice state and its upstream limits
