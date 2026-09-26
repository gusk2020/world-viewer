# Climate v1 — the round-by-round notes, archived from CLAUDE.md

These sections were written one development round at a time and lived in
`CLAUDE.md` until the 2026-09-26 stabilization pass moved them here, verbatim
and unedited, to keep `CLAUDE.md` down to the rules a session must follow.

**Nothing was deleted.** Start from `docs/climate-v1-status.md`, which indexes
all of it; come here for the full reasoning behind a particular round,
including every measurement and every wrong turn.

---

## Two temperature teachers, and which one is the teacher

Full audit: `docs/climate-v1-temperature-teacher-audit.md`. Tool:
`tools/audit_temperature_teachers.mjs`. Nothing was fitted and Stage 2 is
unchanged.

**A = `temperature-annual-mean-c.bin`** is Berkeley Earth Land+Ocean, 1x1
degree, 1991-2020, and its land values are **station observations**.
**B = `humidity-airTemperatureC.bin`** is NCEP/NCAR Reanalysis 1's `air.2m`,
T62 Gaussian, 1981-2010, and it is a **model** field.

**主Teacher is A**, because Climate v1's temperature stage is a model and must
not be scored against another model where an observational product exists. **B
is the independent verification teacher** — and B is *mandatory*, not optional,
wherever temperature is combined with the NCEP humidity teacher (RH, q_sat,
saturation deficit), because those are ratios of two fields and mixing
products with a 3 C tropical offset makes the ratio meaningless.

**Why they differ by ~3 C in the Amazon, measured rather than assumed.** The
gap is not constant (within the Amazon box it runs -1.3 to +5.2 cell by cell)
and it **tracks moisture**: over tropical land only, A-B goes -0.64 at 5-8
g/kg to **+2.85 above 16 g/kg**. The decade of period difference is worth a
few tenths, i.e. about a third of the +1.0 C global land gap and none of the
tropical one.

**This changes the Stage 2 bias materially.** Measured against A instead of B:
アマゾン +6.2 -> **+2.9**, コンゴ +5.3 -> +2.3, インドネシア +5.0 -> +1.7,
global land +1.2 -> **+0.2**, while ヨーロッパ -3.5 -> **-5.6**, チベット
-2.0 -> **-5.9** and グリーンランド -5.1 -> **-6.4**. The wet-tropics warm
bias survives at half the size, three large cold biases appear beside it, and
**the moisture association behind the evaporative-cooling hypothesis must be
re-derived on A** — it was measured against the field that is itself coldest
exactly where the land is wettest.

## Climate v1: a surface lapse rate, separate from the free-air one

Full write-up: `docs/climate-v1-surface-lapse-rate.md`. Tool:
`tools/validate_surface_lapse.mjs`.

**Two rates now, and they must never be merged.** `lapseRateCPerKm` (6.5) is the
**free-air** standard lapse rate -- a property of an air column. The new
`surfaceLapseRateCPerKm` is the **surface** rate: how fast surface air
temperature falls as the *ground* rises, which is smaller because elevated
ground is heated by the sun at its own level. Stage 2 had been applying the
free-air number to the surface question. The schema default is 6.5 so every set
saved before this means what it always meant; **Climate v1 sets 5.2**, in
`js/climate-v1/earth-temperature-calibration.js`.
`effectiveSurfaceLapseRateCPerKm(params)` in `js/climate.js` is the one place
that resolves which applies.

**5.2 was adopted, not fitted.** Measured from Berkeley Earth over ice-free
land, with latitude removed by the model's own sea-level curve, the observed
surface rate is **5.27 C/km** and is flat above 500 m (5.08 / 5.26 / 5.17 by
band), flat across latitude and flat across temperature. Below 500 m the same
regression returns 7.78, which is the maritime/continental contrast rather than
a lapse rate -- Europe at 305 m would "require" -11.4 C/km, which is the tell.

**One premise in the brief was wrong, and reading the code settled it.**
`humidity.js`'s pressure and `wind.js`'s sea-level reduction are *not* free-air
uses: both **invert Stage 2's own elevation term**. An inversion must use the
rate the forward step used, so `preview.js` and the Climate v1 tools pass
`params.surfaceLapseRateCPerKm ?? params.lapseRateCPerKm` there. Handing them
6.5 while Stage 2 applied 5.2 would recover a sea-level temperature wrong by
+5.8 C over Tibet. The measurement confirms it: with the matching rate the
reduction cancels and **the wind is unchanged** (max |du| 0.0023 m/s, mean speed
identical to four decimals; the residual is Float32 plus 3795 below-sea-level
land cells where the reduction clamps at 0).

**What it moved** (bias = model - Berkeley Earth): チベット **-5.92 -> -0.17**,
ヒマラヤ周辺 -4.65 -> -1.02, ロッキー -3.29 -> -1.16, グリーンランド -6.40 ->
-3.62, アンデス -0.78 -> +1.85, 南極 +7.79 -> **+10.48**, ヨーロッパ -5.57 ->
-5.17, 平地 (0-500 m) +0.12 -> +0.43. Mean |bias| on **ice-free land above
500 m: 2.54 -> 2.35**; on global land 3.05 -> 3.19, which is worse and was
expected and accepted in advance -- that figure is dominated by Antarctica,
whose warm bias any reduction of the lapse rate makes worse and which this
change does not address.

**Guardrails, measured**: sea temperature exactly unchanged (max |delta| 0.0 C
over 1,378,437 cells); land at exactly 0 m exactly unchanged; the land change
equals (6.5-5.2)*z to a maximum residual of 3.6e-6 C over the whole 2048x1024
grid; no NaN; **Climate v0.8 byte-identical** (`score_climate.mjs` and
`score_koppen.mjs` print output identical to before -- 63.4% and 10.2%); all
160 unit-test assertions pass. Downstream, pressure and humidity change only
through the temperature input (mean 970.346 -> 970.545 hPa, 7.3946 -> 7.4263
g/kg), which is correct -- a warmer column over high ground thins less and holds
more vapour.

`classifyStructurePoint` carried its own copy of the lapse line and now calls
`surfaceAnnualTemperatureC`, so the two cannot drift; identical today.

**Held over, diagnosed and parked -- none of these is "unsolvable"**: 南極's warm
bias (needs a surface energy balance before albedo means anything; inside a
minimal Budyko-Sellers balance ice albedo moves 南極 -8.0 C but グリーンランド
-9.2 C, trading one for the other), グリーンランド's residual -3.6 (an offset,
not a slope -- its internal rate is already 6.64 C/km, and at the same latitude
and elevation the teacher puts it 13.8 C warmer than 南極), ヨーロッパ -5.2
(maritime warmth land never receives), 海温の経度構造 (the model's sea
temperature is exactly f(latitude): 0.0 C spread within every one of 961 sea
rows), 海流/AMOC (the Stage 4 wind's stress curl correlates +0.003 with NCEP's
and its Sverdrup transport is 15-40x too weak with the wrong sign in the North
Atlantic), 海洋性熱伝達 (the right form is known -- upwind-advected sea
temperature separates グリーンランド from 南極 by 5x -- but there is no
longitudinal SST structure to read), and 雪氷アルベド (also: the model's own ice
diagnosis covers 11.2% of the globe against the teacher's 3.3%).

The experimental evaporative cooling stays out of the formal adoption
candidates, code intact and default OFF, and was not touched by this change.

## Stage 2 is closed, and the humidity baselines were re-measured on it

Full write-up: `docs/climate-v1-stage2-closed-and-humidity-rebaseline.md`.
Tool: `tools/rebaseline_humidity.mjs`. Diagnosis only -- no physics file
changed, nothing fitted, evaporative cooling still OFF by default.

**Stage 2 is closed "as far as the current simple model and its existing
inputs can go". That is not a claim that Earth's temperature is reproduced.**
`surfaceLapseRateCPerKm` stays at 5.2.

Why it was closed, measured against Berkeley Earth: global land MAE 3.19, but
**ice cells are 11.3% of the land and 30.9% of that error** (Antarctica alone
9.3% / 28.7%). Excluding ice gives 2.49; excluding the three held-over regions
too gives **2.42 over 86.4% of land**, and excluding the three high-latitude
blocks as well gives **2.03 over 73%**.

**The 1500 m+ warm bias was Antarctica, not high ground** -- it contributes
+4.04 of the 1500-3000 m band's +3.88 and +7.80 of the 3000 m+ band's +7.87.
Drop ice cells and those bands read +0.27 (MAE 2.22) and **+0.29 (MAE 1.69)**,
making 3000 m+ the *best* elevation band. Read that as the verdict on 5.2.

**Nothing general is left to add.** Over the workable domain the residual's
R² is 0.002 on coast distance and **0.000 on elevation** -- 5.2 finished that
job -- with |latitude| 0.131, model temperature 0.123 and seasonal amplitude
0.123, which are one variable in three costumes and already carried by
`polarExtraC`/`insolationSensitivityC`. Continentality's sign also *reverses*
(inland minus coastal +1.44 at 35-66N, -1.57 in the subtropics), so one
coefficient cannot serve both. All six jointly: R² 0.143, an upper bound of
MAE 2.42 -> 2.08. The largest coherent errors left are the parked ones and
larger than the old boxes said: 北大西洋側 45-75N/10W-60E **-6.25** (12.7% of
the workable error on 4.9% of the area; its 60-75N part **-9.84**), against
北東アジア **+4.52** at the same latitudes with the opposite sign.

**Held over, to resume when the model hierarchy goes up** -- each measured and
parked, none "unsolvable": 氷床放射 (南極/グリーンランド), 北大西洋側の海洋熱輸送,
SST の経度構造, 海流/AMOC, 雪氷アルベドの本格的エネルギー収支.

### The humidity baselines survive 5.2 almost exactly

All teachers NCEP (q, 2 m T, surface pressure); Berkeley Earth is Stage 2's
temperature teacher and is never mixed into a ratio.

| land (g/kg) | 6.5 | 5.2 | recorded |
| --- | --- | --- | --- |
| oracle wind: mean q / bias / RMSE | 5.047 / -2.76 / 4.61 | **5.081 / -2.73 / 4.60** | 5.047 / -2.76 / 4.61 |
| model wind: mean q / bias / RMSE | 4.055 / -3.75 / 6.97 | 4.179 / -3.63 / 6.93 | -- |
| アマゾン (oracle) | 15.03 | **15.04** | 15.03 |
| サハラ (oracle) | 2.88 | **2.89** | 2.88 |
| アマゾン/サハラ ratio | 5.22 | **5.21** | 5.22 |

**The Amazon is still exactly 0.00 g/kg under the model's own Stage 4 wind**,
and the dry tail is unchanged (6.2% of land below 0.001 g/kg under the oracle
wind with **exactly 0% at exact zero**; 5.2% exact zero under the model wind).
One recorded value does not reproduce: オーストラリア measures 4.37 against the
recorded 4.46 -- and it measures 4.37 at the *old* 6.5 state too, so that is a
box definition in the old measurement, not an effect of 5.2.

**Stage 5A did move**: surface pressure above 1500 m went 725.97 -> 727.65 hPa
against the teacher's 732.55, i.e. *toward* it, while q_sat went the other way
(land bias +0.98 -> +1.53 g/kg) because the land is warmer. The driver there is
Stage 2's +2.25 C warm bias against *NCEP* land, not 5.2.

**The error decomposition, re-derived rather than copied.** Using the exact
identity `q_m - q_t = (q_sat,m - q_sat,t)*RH_m + q_sat,t*(RH_m - RH_t)`, and
splitting the second term by swapping only the wind at a fixed temperature
field: **A temperature 0.03-0.13 g/kg, B wind 3.59, C source/sink 3.33**
(mean absolute, oracle-wind RMSE 1.58 / 5.87 / 5.14). So **source/sink >= wind
>> temperature**, and 5.2's own effect on humidity is two orders of magnitude
below either of the others -- half the land moves by under 0.01 g/kg.

**A caveat that keeps resurfacing**: the teacher's land-mean "RH" reads 0.955,
which is not a relative humidity -- it is a mean q over q_sat of a mean T, and
Jensen's inequality puts **35.6% of land above 1.0**, reproducing the earlier
figure exactly. Term A uses q_sat only and is immune; the B/C split passes
through that ratio and is an attribution, not a measurement.

## Climate v1: experimental land evapotranspiration (OFF by default)

Full write-up: `docs/climate-v1-land-evapotranspiration.md`. Tool:
`tools/validate_land_et.mjs`. **`landEvapotranspirationWeight` defaults to 0, so
the shipped model is exactly Stage 5B** -- proved, not assumed: weight 0 is
bit-identical to the term not existing, the diagnostic arrays come back `null`,
and `meta.landEvapotranspirationApplied` is false.

    ET = availability(RH) * k_ET * max(q_sat - q, 0),  k_ET = 1 / 4.6 days
    availability = smoothstep(0.25, 0.75, q / q_sat)

**`tau_ET` is derived, not fitted** (bulk `rho*C_E*|U|/M_column` = 2.5e-6 /s).
**The ramp's 0.25/0.75 are EMPIRICAL AND PROVISIONAL and are not to be quoted as
physical constants** -- they stand in for soil moisture the model cannot carry
without precipitation.

**Why it exists**: an inverse diagnosis (holding the *teacher's* q steady under
this very operator, with the observed wind) needs a local land source over **83%
of land**, five times larger in the wet tropics than in deserts, and shows that
**82% of what the tau sink removes over land cannot have been advected in**. The
water boundary was audited first and is fine (sea bias +0.41 g/kg, mid-latitudes
exactly 0.00); a uniform tau was audited too and fails (at 24 days サハラ and
オーストラリア overshoot while コンゴ is at 63% of the teacher).

**It is not a tau relabel.** Substituting gives
`(a + b + 1/tau + k*phi) q = A_in + k*phi*q_sat` -- the numerator gains a term
not proportional to q, so no constant tau_eff reproduces it. Measured rather than
argued: sweeping `moistureResidenceDays` 8-40 days cannot reach the ET-on field
(closest tau = 25.5 d, still 0.722 g/kg RMS away). Stage 5C-alpha's `f*q/tau` was
*exactly* `(1-f)/tau`, which is why it was rejected.

**The steep ramp is the whole design decision.** Plain bulk evaporation
(availability = 1) gives a lovely q field but feeds the Sahara **3.17 g/kg/day**
of evaporation it has no water for -- the saturation deficit is largest over
deserts, the same trap the evaporative-cooling wet-bulb form hit -- and its
wet/dry source ratio is **1.05x**. Gentle ramps (RH, smoothstep(0.05,0.60),
supply-limited) are a positive feedback and let deserts run away: サハラ reaches
8.6-10.1 against a teacher of 4.67, ratio only 1.8-1.9x. Only the steep ramp
holds both. A bucket was tested too and is dead under a no-precipitation rule:
recharging it from the solver's own condensation diagnostic gives an identically
zero source, because the q <= q_sat cap never binds over land.

**What it does (oracle wind)**: land mean **5.081 -> 7.164** (teacher 7.806),
bias -2.73 -> **-0.64**, RMSE 4.60 -> 3.47. アマゾン 15.04 -> **19.28** (18.97),
インドネシア 12.12 -> 17.67 (19.04), オーストラリア 4.38 -> **7.31** (7.00),
サハラ 2.89 -> **3.93** (4.67, still dry). **wet/dry source ratio 5.17x** against
the 5.07x required. The water flux is plausible where the inverse residual was
not: **1.59 mm/day over non-ice land** (Earth ~1.3), 3.55 in the wet tropics
(rainforest 3-4), **0.00 in deserts**, max 5.02 and **0.0% of land above
5 mm/day** -- the inverse residual peaked at 52.

**Solver**: semi-implicit inside the existing sweep (`k*phi*q_sat` to the
numerator, `k*phi` to the denominator, phi from the q the sweep holds), never an
outer loop. 117 sweeps, residual 9.8e-8; at 1e-9 the answer moves by 9.7e-7
kg/kg. Zero NaN, zero negatives, nothing above saturation. 165 -> 181 ms.
**Corrected afterwards**: the "same fixed point from any start" claim came from
the pre-evaluation's outer-loop harness, which washes the seed out. Measured
with an exact replica of the sweep, the ET equation **is bistable on a small
area** -- 0.1% of land under the model wind (max 6.41 g/kg), 3.5% above
0.01 g/kg and 1.3% above 0.5 g/kg under the oracle wind. ET OFF is unique to
float noise.

**Sensitivity**: ramp 0.20-0.70 / 0.25-0.75 / 0.30-0.80 give wet/dry 4.06 / 5.17
/ 5.67x and tau_ET 3 / 4.6 / 7 d give 3.66 / 5.17 / 5.50x -- the structure holds
throughout and the Sahara never exceeds the teacher. **コンゴ is the sensitive
one** (8.76 to 19.09 across those six), which is the cost of a steep ramp. Note
ramp 0.20-0.70 has a *better* RMSE (3.11) and a worse ratio; RMSE was
deliberately not the criterion.

**Why it ships OFF, and the largest remaining problem**: with the model's own
Stage 4 wind the Amazon and Congo sit at exactly 0.00 g/kg, so RH is 0,
availability is 0 and ET does nothing there -- while the same wind leaves the
Sahara at 4.77, enough to open the ramp, so ET pushes it to **12.54 against a
teacher of 4.67**. The term needs a wind that already delivers moisture. Also
**tau = 8 days was not re-derived**; it was fitted in a world with no land
source, and now one exists. Both are separate stages.

Tests: 50 assertions in `tools/test_moisture_stage5b.mjs` (18 new), all four
Climate v1 suites pass, and Climate v0.8 is untouched (63.4% / 10.2%).

## Stage 5 is closed, and the bucket was measured and rejected

Index and verdict: `docs/climate-v1-stage5-closed.md`. Nothing was implemented
in this round and no physics file changed.

**Production baseline, fixed**: Stage 5B transport, explicit diffusion K = 0,
`moistureResidenceDays` 8, the model's own Stage 4 wind, land ET **OFF**,
evaporative cooling **OFF**. Closed as "complete within the current
annual-mean steady-state model and the current Stage 4 wind" -- *not* a claim
that Earth's humidity is reproduced.

**The bucket (a Manabe-style soil-water reservoir as ET availability) is not
adopted**, on four measurements rather than a judgement:

- **In an annual-mean steady state a bucket has nothing to remember.** W solves
  `beta(W)*k*dq + W/tau_drain = P`, whose left side is monotone in W, so W is a
  deterministic function of (P, PET) -- soil water is P/PET rewritten.
- **Every precipitation proxy built from the model's own atmosphere inherits
  the wind's zeros.** Under the production wind, the Amazon and the Congo get
  **P = 0.00 mm/day** from moisture convergence, the saturation-excess proxy is
  **identically zero over all land** (the q <= q_sat cap never binds), and the
  tau-sink proxy is the same `(1-f)/tau` relabel Stage 5C-alpha already
  rejected. Precipitation as its own stage fails for the same reason, which is
  why it was not started either.
- **The coupled solver stops converging.** ET off, the sweep reaches 1e-13 in
  80/187 passes; with the bucket the residual plateaus at 5.9e-4 (model wind) /
  9.7e-3 (oracle wind) and individual regions oscillate -- Australia's ET swings
  0.34 <-> 2.53 mm/day between 400 and 1600 passes. The oscillation sits exactly
  at the beta knee, i.e. in the semi-arid ground the bucket exists to improve.
  The earlier "Australia P 11.78 mm/day" was this oscillation, not a coastal
  grid artefact.
- **It does not separate deserts from rainforest under the production wind**:
  wet/dry ET ratio **2.05x** against the ~5.07x required (5.36x with the oracle
  wind) -- the same split RH availability showed, one level removed.

Also measured: the land water budget closes per cell exactly (global residual
0.000 / 0.066 mm/day), but **land ET / land P is 0.51-0.56**, i.e. half the rain
over land is water the land itself evaporated -- the feedback that drives the
oscillation. Three new parameters would be needed (Wc 150 mm is the only
literature one; the beta knee and tau_drain are not separable on annual-mean
data).

**The final bottleneck is the moisture-carrying capacity of the Stage 4 wind**,
and Stage 4 stays frozen -- it has its own negative results
(`docs/climate-v1-wind-negative-results.md`) and "fix the wind again for
humidity's sake" is the loop this closure exists to prevent.

## Climate v1: the calibration audit (what may be fitted, and what may not)

Full document: `docs/climate-v1-calibration-audit.md`. Audit only -- nothing
was fitted, searched or changed to produce it, and no parameter moved.

**The three that may be calibrated first, and nothing else**:
`seasonalDampingWPerM2K`, `soilDepthM`, `mixedLayerDepthM`. Chosen because the
seasonal anomaly's annual mean is **exactly zero by construction**, so moving
them cannot damage Stage 2's annual field -- the part the user has already
accepted. `shortwaveAbsorbedFraction` 0.70 stays fixed: amplitude goes as
F/lambda, so 0.70 and lambda are *exactly* degenerate. The lag depends only on
tau = C/lambda while the amplitude carries an extra 1/lambda, so **fitting
amplitude and phase together identifies lambda and C separately; either alone
does not.**

**Never fitted, because they are physical facts**: the seawater freezing point
-1.8, ice density, latent heat, ice conductivity, the Magnus coefficients, the
solar constant, the year length, Kepler's equation, and Earth's own tilt
23.44 / eccentricity 0.0167 / periapsis 283. Also `oceanBasalHeatFluxWPerM2` 2
(the user's own explicit ruling) and `evapotranspirationTimescaleDays` 4.6
(derived, not fitted). `surfaceLapseRateCPerKm` 5.2 was **measured and
adopted** (observed 5.27), so it is fixed rather than free.

**The compensating-error pairs to keep apart** are listed in the doc; the ones
that would do the most damage are `fullCoverThicknessM` against the sea-ice
area teacher (the only thickness-to-area conversion, so it would hide every
upstream SST error), `landEvapotranspirationWeight` against the Stage 4 wind's
error, and `surfaceRelativeHumidity` against Stage 2's warm bias (q = RH *
q_sat).

**V0.8's 63.4% / 10.2% are regression guards, not objectives** -- neither
reads any Climate v1 field.

**The finding that decided the next step**: there was **no seasonal temperature
teacher** in the repo, so those three parameters could not be calibrated
against anything. That gap is now closed -- see the next section -- and the
audit document records the correction. The committed NCEP DJF/JJA wind
teachers still exist and **no validator reads them**; they are a
**半年差・季節振幅の参考診断** and never a seasonal-phase hold-out, because two
means half a year apart fit any phase lag as well as any other.

## The seasonal temperature teacher was already being computed and thrown away

`tools/build_temperature_teacher.py` has always built `absolute_by_month` --
twelve months of Berkeley Earth absolute climatology -- and then collapsed it
to the annual mean it wrote. Keeping it is the entire seasonal teacher:
**`temperature-monthly-mean-c.bin`, (12, 180, 360) float32 LE, 3,110,400
bytes**, plus `temperature-monthly-summary.json`. No second dataset, no second
download, no second licence (CC BY-NC 4.0, carried over verbatim from the
annual summary's own `source` block so the two cannot drift), and the grid,
row orientation, land mask, units and 1991-2020 reference period all match the
annual teacher **by construction** rather than by agreement.

**The one hard condition, enforced before anything is written**: the mean of
the twelve committed float32 months must reproduce the committed annual field,
and both must agree about which cells are missing. `write_monthly()` raises
rather than writing a file that fails either. Measured on the real data:
**max |diff| 9.5e-06 C, mean 8.4e-07 C** over 64,779 cells (float32 rounding on
this range is ~1e-5; the tolerance is 1e-3), missing-cell sets identical, and
the twelve months' global mean is **14.884 C**, the annual teacher's own figure
to three decimals. The annual `.bin` came back byte-identical from the rebuild
-- only its summary's `builtAt` changed.

**Nothing is interpolated and no missing cell is filled**, same policy as the
annual teacher. Missing cells per month run 0-21 (September is the worst, and
its 21 are exactly the annual field's 21, so September's missing set contains
every other month's).

**Phase convention, and it matters**: a monthly mean stands for the **middle**
of its month, so its observation phase is `(monthIndex + 0.5) / 12` --
**January is not phase 0**. The model's own `orbitalPhase` 0 is the ascending
equinox, so aligning the two is a validator's job; the summary states the
convention and does no aligning itself.

What it shows (min / max / half-amplitude / peak month, from the committed
file): 45N land (France) 4.40 / 19.73 / **7.67** / Jul, 45N ocean (N Pacific)
5.25 / 13.56 / **4.16** / **Aug**, equatorial land (Congo) 25.97 / 27.44 / 0.73
/ May, 60N land (Siberia) -29.01 / 14.41 / **21.71** / Jul, 45S land (Chile)
2.57 / 13.95 / 5.69 / **Jan**. Area-weighted, the NH beyond 20 degrees peaks in
August and the SH beyond -20 in January, correlation **-0.992**. Land is far
more seasonal than sea at the same latitude and the sea peaks a month later --
which is the amplitude-and-lag pair that separates lambda from C, and the whole
reason a seasonal teacher was needed.

**Nothing has been fitted to it.** `seasonalDampingWPerM2K`, `soilDepthM` and
`mixedLayerDepthM` are untouched, no validator reads the new file yet, and no
UI shows it. That is the next round's decision.

The existing `.github/workflows/build-temperature-teacher.yml` builds it -- no
new workflow, no secrets, the same 454 MB public Berkeley Earth object -- with
the two new paths added to its commit step. The whole run takes about 25
seconds.

## Climate v1: the seasonal temperature baseline (measured, nothing fitted)

Full write-up: `docs/climate-v1-seasonal-temperature-baseline.md`. Tool:
`tools/validate_seasonal_temperature.mjs`. **No parameter moved**, no world
config was written, no physics file changed, V0.8 still reads 63.4% / 10.2%,
and all existing Climate v1 suites pass.

**A calendar month is an interval, and the calendar lives in the validator.**
Berkeley Earth's July value is the mean over July, so the model is averaged
over the same interval with the real Gregorian month lengths. The mean of each
harmonic over a month's own interval has a closed form, so the exact integral
is what gets used; the sampled route the brief describes was run at 365 / 1461
/ 3652 / 14608 samples a year and converges on it (2.6e-1 -> 3.8e-3 C), which
is what earns the right to use it. **The midpoint single-point approximation
is wrong by up to 0.562 C**, so it is not used. `js/climate-v1/season.js` still
knows nothing about months.

**Earth's real orbit is a calibration condition of the validator only** --
tilt 23.44, e **0.0167**, periapsis **283** -- because fitting a real Earth to
a circular model would push the periapsis-driven hemispheric asymmetry into
`seasonalDampingWPerM2K` or a heat capacity. The world's config still carries
the circular default and the validator asserts that it does.

**The one calendar constant lands on the phase bias, one for one**, which is
the opposite of the reassuring answer and was measured rather than argued: the
model's peak is fixed to the equinox while the teacher's twelve numbers are
not, so a 1-day error in the March equinox date (78.59) moves the phase bias by
exactly 1.0 d. The real instant varies +/-0.6 d over 1991-2020, so every phase
bias carries that much calendar uncertainty.

**The headline.** First-harmonic half-amplitude, area-weighted, over 64,779
teacher cells (21 dropped for a missing month, nothing filled):

| | teacher | model | amp bias | amp MAE | phase bias | phase MAE |
| --- | --- | --- | --- | --- | --- | --- |
| land | 9.60 | 11.48 | **+1.88** | 3.35 | **-0.2 d** | 8.4 d |
| ocean | 2.76 | 3.35 | **+0.59** | 1.72 | **+5.9 d** | 13.0 d |

**The phase is right, and that is a real result**: a land phase bias of -0.2 d
is exact within the calendar uncertainty. A one-layer relaxation with a real
heat capacity puts the peak in the right place with nothing fitted to a date.

**The +1.88 C land amplitude bias is not a global bias.** Northern-hemisphere
land is already right in all three bands -- **-0.03 / +0.63 / +0.26 C** at
0-30 / 30-60 / 60-90N. The error is two specific structural failures:

- **Maritime land gets a continental swing.** Every land cell has the same
  heat capacity, so 30-60S land (555 cells: Patagonia, New Zealand, Tasmania)
  reads 13.39 against a teacher's 5.68, and Antarctica +9.27. The
  representative points settle it: **Siberia 0.80x (under), France 1.95x,
  Chile 3.18x** -- four times apart in the direction they pull, so no single
  `soilDepthM` or lambda can satisfy them. NE Asia is **-4.50** with the
  opposite sign again.
- **The Arctic Ocean is given 30 m of water it does not have.** 60-90N ocean
  is the largest amplitude error on the globe (6.44 against 11.31) and
  **23.6 days late**; 60-90S ocean is 32.7 d late. Both are ice-covered and
  thermally thin, while 30-60N ocean is nearly perfect at -0.26.
  `js/climate-v1/sea-ice-state.js` already has the thickness and deliberately
  does not feed back; this is the concrete case for eventually letting it, as
  a heat capacity before any albedo.

**The tropics work.** Within 10 degrees of the equator the teacher's H2/H1 is
0.902 and the model's **0.984** (ocean 0.688 against 0.676) -- the model
produces the equatorial double peak with the right relative size, falling out
of the insolation geometry with nothing fitted. Its H1 there is still 2.06
against 0.92, and the semi-annual peak arrives ~12 d early over land.

**The hold-out splits, measured as a baseline.** The geographic checkerboard is
**free**: its halves differ by **0.000 C of amplitude MAE and 0.002 C of
bias**, so any gap that opens after a fit is over-fitting and nothing else. The
latitude-band split is a real test (amplitude MAE 0.92 / 2.73 / 5.51 by band).
**Ice matters more than expected** -- 17% of cells carrying an amplitude MAE of
8.59 against 1.91 elsewhere -- so every figure must be reported both ways.

**The three parameters are identifiable, and one is weak.** At +/-10%,
one at a time: `mixedLayerDepthM` moves the ocean and leaves the land at
**0.00 exactly**; lambda moves land amplitude **ten times** more than
`soilDepthM` does (1.02 against 0.10) while moving land phase only twice as
much -- so amplitude identifies lambda and the phase residual then identifies
`soilDepthM`, exactly as the calibration audit predicted.

**Why lambda barely touches the ocean is physics, not luck**: the gain is
`1/sqrt(1+k^2)` with `k = omega*C/lambda`, and the sea's tau of 188 days gives
k = 3.2, deep in the `k >> 1` regime where the amplitude tends to
`F/(omega*C)` and **lambda cancels out**. The land's tau is 27 days (k = 0.47),
the regime lambda dominates.

**`soilDepthM` is the weak lever, and the reason is a parameter that is not
among the three**: `atmosphericColumnHeatCapacityJPerM2K` (1.0e7, fixed) is
**53% of C_land** against only 8% of C_sea, so 10% of `soilDepthM` moves
C_land by 4.7% where 10% of `mixedLayerDepthM` moves C_sea by 9.2%. Worth
knowing before a search reports that `soilDepthM` "wants" a large value.

**Verdict: READY** for the three-variable grid search. It can fix the global
land and ocean amplitude biases and a degree or two of the ocean's lag; it
cannot fix maritime land, the Arctic Ocean, or the equatorial
over-amplification, all of which are structural. The largest risk is that
Antarctica's 9.3 C error over 6629 cells drags lambda upward and makes Siberia
and NE Asia worse -- which is why ice in / ice out must both be reported and
the three parked regions stay out of any fit.

## Climate v1: the first coarse grid search, and why nothing was adopted

Full write-up: `docs/climate-v1-seasonal-grid-search.md`. Tools:
`tools/search_seasonal_temperature.mjs`, plus `tools/seasonal_calendar.mjs`
(the calendar and the harmonic fit, now shared with the validator so the
measurement and the search cannot drift -- the validator's output is
byte-identical after the extraction). Candidates:
`worlds/kasoku-sekai/seasonal-candidates.json`. **Nothing is adopted**: lambda
is still 8, `soilDepthM` 4, `mixedLayerDepthM` 30; no world config or physics
file changed; V0.8 still reads 63.4% / 10.2% and every Climate v1 suite passes.

**210 combinations in 5 seconds**, because the forcing does not depend on any
of the three variables -- its Fourier coefficients are computed once and each
candidate is a handful of multiplies. Checked rather than trusted: at three
probe points it reproduces `buildSeasonalTemperatureTable` to **exactly
0.0e+0 C**.

Seasonal anomalies only; ice, Antarctica, Greenland and the North Atlantic /
Europe block (13,558 of 64,779 cells) are out of the fit and reported as
validation. Calibration is the checkerboard's even half, hold-out the odd
half, and they agree to **0.01 C and 0.0 days** at the baseline.

**55 candidates are Pareto-optimal and exactly 0 are admissible.** The reasons
are three, and each is a measurement:

- **Both land parameters are already at their own minima.** Sweeping lambda at
  the baseline depths gives land amplitude MAE 4.85 / 3.50 / 2.73 / **2.48** /
  2.55 / 2.76 / 3.29 at 5/6/7/8/9/10/12 -- one minimum, landing on the value
  that was already there, with nothing told what lambda is. `soilDepthM` is
  the same: 2.555 / 2.521 / **2.479** / 2.482 / 2.539 at 1/2/4/6/8 m, and its
  phase MAE minimises at 4 m too. Same self-validating pattern as Stage 6's
  agreement peaking at Earth's own 14 C.
- **The ocean's amplitude and its phase want opposite heat capacities.**
  Monotonically: the calibration ocean amplitude MAE wants **50 m** (1.26
  against 30 m's 1.60) while the phase MAE wants **20 m** (12.1 d against
  12.7). 30 m already sits between them, and a single layer cannot give both.
- **Every candidate that looks better is lambda absorbing a parked error.**

**The compensating error, caught in the act.** Lambda correlates with
Antarctica's amplitude MAE at **r = -0.924** (17.93 at lambda 5 falling to
3.25 at 12), so Antarctica pulls lambda **up**; NE Asia's bias runs +2.69 to
**-9.66** over the same range, so it pulls **down**. With the parked regions
excluded the calibration optimum is **lambda = 8**; admitting them moves it to
**lambda = 10**. The exclusion is doing exactly its job. **A first version of
this probe was vacuous and that is worth remembering**: `--include-antarctica`
changed nothing, because Antarctica is essentially all ice class and the ice
exclusion had already removed it -- the flag now re-admits ice, Antarctica,
Greenland and the North Atlantic block together.

**The Arctic/mid-latitude trade, measured.** A 10 m mixed layer collapses the
Arctic's phase bias from +23.6 d to **+1.6 d** and its amplitude MAE from 6.77
to 4.96 -- a large, real gain in the worst region on the globe -- while the
30-60 ocean goes 2.45 -> **7.25**. Not a parameter to tune: the Arctic needs a
*different* heat capacity from the North Pacific.

**lambda and `soilDepthM` are confounded in amplitude and separated by
phase**, which the calibration audit predicted and this grid now shows as a
picture: (7, 8 m), (8, 4 m) and (9, 1 m) score 2.476 / 2.479 / 2.489 on
amplitude at tau_land 45.6 / 27.2 / 15.7 days -- indistinguishable -- while
their phase MAE is 14.00 / **8.34** / 13.93. Across 1-8 m of soil the
amplitude MAE moves 0.075 C and the phase MAE 4.30 d, so phase is the only
handle on it and the pair is identifiable only together.

**The trap candidate worth knowing: 9 / 6 / 30.** It improves three of the
four objectives and halves Greenland's error, and it is still rejected --
land amplitude MAE 2.48 -> 2.62 and NE Asia 4.91 -> **6.87**. That is the
compensating error arriving through a candidate rather than through a fit.

**Verdict: NOT_READY, stay at 8 / 4 m / 30 m, and a finer grid is not the next
step.** The Pareto front spans the whole range of lambda and `soilDepthM`,
which means they are trading against each other rather than being pinned; a
local refinement between 20 and 40 m of mixed layer is bounded at about 0.3 C
of amplitude against about 2 days of phase, smaller than the structural errors
already present. What would move these numbers is mechanism: a heat capacity
that differs between maritime and continental land, and one that differs
between ice-covered and open ocean -- and `js/climate-v1/sea-ice-state.js`
already computes the thickness the second needs.

## Climate v1: the seasonal damping is split between land and ocean

Full write-up: `docs/climate-v1-ocean-damping-split.md`. One new parameter,
`oceanSeasonalDampingWPerM2K` in `js/climate-v1/season.js`, `kind: empirical`,
`search: false`. **Its default is `null` = "use the land value"**, so nothing
about the app changed: no world config carries a value, no UI shows it, and
`js/main.js` builds its season table with no `params` at all.

**A two-layer ocean was designed, pre-evaluated and rejected on measurement**,
and the reason is worth keeping. Per harmonic the two-layer system gives
`Z = lambda + i w C1 + i w C2/(1 + i w tau_ex)` with `tau_ex = C2/gamma`. At
any physically representative lower layer `w tau_ex` is about **60**, so the
deep term saturates to a constant `gamma` and `Z -> (lambda + gamma) + i w C1`
-- **exactly a one-layer ocean with a larger lambda**. Checked rather than
argued: two-layer 40 m / gamma 4 / 300 m and one-layer 40 m at lambda 12
differ by **8.4e-4 C and 7.9e-3 days**, and the degeneracy diagnostic reads
lambda_eff 12.00 at both harmonics with a capacity ratio of 0.999. The
genuinely non-degenerate regime (`w tau_ex ~ 1`) is measurably *worse*, a weak
deep relaxation does nothing at all, and the lower layer's depth is irrelevant
from 100 m to 2000 m.

**So the amplitude/phase lock was never a one-layer limitation -- it was a
shared-lambda limitation.** A one-layer ocean already has two free quantities
(lambda, C) for two targets (amplitude, phase); the grid search could not use
that because lambda was pinned by the land.

**Why the split is physical**: lambda is dF/dT, and over water the latent term
responds far more strongly than over land, because the water supply is
unlimited and the evaporative flux follows Clausius-Clapeyron rather than a
soil's availability. Still an Earth calibration candidate, never a universal
constant.

`dampingWPerM2KForSurface(surfaceType, params)` is the one place that resolves
it -- the same shape `effectiveSurfaceLapseRateCPerKm` uses for the two lapse
rates. The analytic solution, the harmonic structure and `orbitalPhase` are
untouched.

**Compatibility, proved**: default vs explicitly setting ocean = land is **0 of
14,336 coefficients different**; at `lambda_ocean` 10 **zero land coefficients
change** (7,168 sea ones do) and the land's amplitude MAE / phase MAE / phase
bias are **exactly** 3.35 / 8.4 d / -0.2 d either way.

**The Earth candidate, lambda_land 8 / lambda_ocean 10**, on the grid search's
own fit set -- and it reproduces the pre-evaluation exactly:

| | 8 | 10 |
| --- | --- | --- |
| ocean amplitude MAE | 1.60 | **1.56** |
| ocean phase MAE | 12.7 d | **11.8 d** |
| ocean phase bias | +5.3 d | **+1.3 d** |
| hold-out | 1.60 / 12.7 / +5.3 | **1.56 / 11.8 / +1.3** |

**Not a compensating error**: every ocean group's phase bias moves toward zero
(global +5.9 -> **+1.9 d**), which is the signature of a timescale change;
the **Arctic's amplitude gets slightly worse** (6.77 -> 6.84) so it is not
choosing the candidate; the North Atlantic block is 1.9% of ocean cells and
cannot be the driver; and **30-60 N ocean's amplitude is unchanged to two
decimals** (1.52 -> 1.52) while its phase bias goes +3.3 -> -0.7 d. Tropical
ocean H2/H1 moves 0.302 -> **0.308** against a teacher of 0.351, i.e. toward
it. `tau_sea` 188.1 -> 150.5 d, `tau_land` unchanged at 27.2.

**10 is not an isolated point**: sweeping 8/9/10/11/12 the amplitude MAE falls
monotonically (1.72 -> 1.64) and the phase MAE has a broad shallow minimum at
**10-11** (12.0 / 12.1) with the phase bias crossing zero near 11. No
minimum-hunting is warranted.

**Sea ice was diagnosed, not assumed** (`sea-ice-state.js` unmodified): global
annual maximum area 7.67% -> **7.60%**, minimum 4.63% -> 4.65%, every
representative point keeps its perennial/seasonal/none class, and only **4 of
7,295** ice-bearing cells change class anywhere. `feedsBackIntoTemperature`
stays false.

**Regression**: `score_climate` and `score_koppen` byte-identical (63.4% /
10.2%), as are `validate_temperature_v1`, `validate_surface_lapse`,
`test_moisture_stage5b` and `validate_wind_v1`. Five suites differ **only in
wall-clock timings** (three `ms`/`ns` lines and one `build ms` column) with
every checksum and assertion identical.

**Adopted.** `oceanSeasonalDampingWPerM2K: 10` is now Earth's Climate v1
calibration, in `js/climate-v1/earth-temperature-calibration.js` (as
`CLIMATE_V1_EARTH_SEASON_CALIBRATION`) and **never in a world config**. Stated
plainly, that buys 2.5% of amplitude and 7% of phase MAE, and its real result is
the ocean phase bias falling from +5.3 to +1.3 days (globally +5.9 -> +1.9). It
does not fix the Arctic (that needs sea ice as a heat capacity) and creates no
longitudinal SST structure, so the North Atlantic stays parked.

**It was not a one-line change, because that one line would have been inert.**
The three values already in that file are spread into the *climate* params on
their way to `buildTemperatureField`; `buildSeasonalTemperatureTable` takes its
own parameter object and every caller passed none. So
`climateV1SeasonParams(SEASON_PARAMETERS)` is the one place that carries the
calibration across, used by `main.js`'s `ensureSeasonTable`,
`validate_seasonal_temperature.mjs` and `validate_sea_ice_state.mjs`.
`validate_season.mjs` deliberately stays on the module defaults, so it remains
the guard that an unset world is unchanged. This is the fifth time this project
has caught a parameter that could not reach the code path it names.

**Land is exactly unchanged on the drawn field**, not only in the coefficients:
0 of 3,593,575 land-cell comparisons differ across five orbital phases of the
real 2048x1024 grid, worst |dT| over land exactly 0.0 C, while sea moves at most
0.523 C. The browser's annual frame still hashes `1799c75758ce`, panels 41/214
px, no console errors. Sea ice moves within the range already recorded: global
annual maximum 9.19% -> 9.05%, minimum 3.23% -> 3.29%, every representative
point keeping its class, with the fraction's periodic steady state now reached
in 3 years rather than 2.

## Climate v1: land-sea thermal coupling (the sea finally reaches the land)

Full write-up: `docs/climate-v1-land-sea-thermal-coupling.md`. Code:
`js/climate-v1/land-sea-coupling.js`, validator
`tools/validate_land_sea_coupling.mjs`. **Nothing in the shipped pipeline
imports it**, no UI changed, and `landSeaThermalRelaxationDays` defaults to 0.

**The gap it closes, measured first.** Stage 2's land temperature is
`seaLevelC(lat) - lapse*z` and reads no ocean at all, so the SST longitude
pre-evaluation found that an ocean-only correction of any size changes
**exactly 0 land cells** (worst |dT| 0.00e+0 C). Improving the North Atlantic
could never move Europe. This is the missing link, built deliberately *before*
any SST longitude structure.

**What is carried is an anomaly, never an absolute temperature.**

    A_surface = seaFraction * (T_sea - seaLevelC(lat))   over water, 0 over land
    dA/dt = (A_surface - A)/tau   along the back trajectory
    T_land = T_stage2 + A

The literal form in the brief -- relax toward the surface *temperature* and
advect that -- was built first and **failed**: the Stage 4 wind's meridional
component is systematically poleward in the NH (+0.4 to +0.65 m/s), so every
back trajectory arrives from the equatorward side and imports a warm bias.
Non-ice land MAE **2.43 -> 2.95** and NE Asia **+3.33 -> +5.76**. The wind's
error was becoming a temperature error one for one. The anomaly form closes
that channel structurally, and gives the interior decay for free: mean
|anomaly| **1.46 / 0.83 / 0.43 / 0.13 / 0.02 C** at 0-250 / 250-500 /
500-1000 / 1000-2000 / 2000-4000 km from the sea, with **no distance rule
anywhere in the model**.

**Isotropic oceanicity was rejected although it scores better.** MAE 2.19 at
L = 1000 km against the directional form's 2.31 -- but it worsens NE Asia
(+3.33 -> +4.06) and the eastern US (+3.29 -> +3.62) and pushes marine air
2000 km inland (0.54 C where the directional form gives 0.13). It cannot tell
air that came off the sea from land that happens to be near it.

**One parameter, and `mixingEfficiency` is forbidden on algebra rather than
taste**: `A_ocean = (1 - oceanModeration)*(meanTemperatureC - seaLevelC)`
identically, so a mixing efficiency over land is **exactly degenerate with
`oceanModeration`**. `landSeaThermalRelaxationDays` = **7 days**, empirical,
an Earth calibration, and a plateau rather than a minimum (MAE 2.35 / 2.32 /
2.31 / 2.32 / 2.34 at 2 / 5 / 7 / 10 / 20 d). The horizon (6 timescales,
discarding 0.25% of the kernel) and the step (tau/12) are numerical settings,
not parameters -- same status as `harmonicsForEccentricity`.

**What it buys**, non-ice land against Berkeley Earth: global MAE **2.47 ->
2.31**, bias +0.41 -> **+0.13**, Europe **-5.62 -> -4.96**, NE Asia +3.30 ->
**+3.32** (not traded away), N. America east +3.27 -> +3.09, west -1.99 ->
-1.64, South America +2.03 -> +1.65, Australia +2.23 -> **+0.96**, tropical
interior +2.47 -> +2.40. Every elevation band improves or holds (0-200 m
2.93 -> 2.56; 2000 m+ 1.85 -> 1.88) with `surfaceLapseRateCPerKm` untouched
at 5.2. **The ocean is unchanged on every cell**, so SST, sea ice and the
ocean's seasonal cycle cannot have moved.

**Europe gains only 0.66 of its 5.62 C, and the reason is upstream**: with a
latitude-only SST the marine anomaly is only **+4.24 C at 60-70N**. There is
no more warmth in the model's sea to carry. Fed the SST round's upper-bound
diagnostic (a longitudinal harmonic fit of the teacher's sea, zero row mean,
not implemented anywhere), the same coupling takes Europe to **-3.20** and the
global MAE to 2.23 -- so the chain **SST longitude -> marine air -> land** is
connected and worth about 1.8 C to Europe. That is the case for re-evaluating
the gyre east-west dipole next.

**The Stage 4 wind is used only as "which way does the air come from", and its
error is reported rather than hidden.** Running the same coupling on NCEP's
observed 850 hPa wind as a diagnostic gives global MAE 2.10 against 2.31, and
the whole gap is tropical (tropical interior +2.40 vs **+1.34**, South America
+1.65 vs **+0.72**) while the three mid-latitude regions agree to under 0.4 C.
Stage 4 has no trade winds -- at Sao Paulo it gives u = +2.80 m/s where NCEP
gives -1.18. **The wind stage stays frozen and was not re-fitted.**

**Why it is not wired into the preview.** Turning it on inside
`buildClimateV1Preview` would move Stage 4's wind and Stage 5's humidity, both
of which read the temperature field, and this round's regression condition was
that neither changes. So 7 days is carried by its own accessor,
`climateV1LandSeaParams()`, deliberately **not** merged into
`CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION` (whose three values are spread into
the params that reach `buildTemperatureField`, and therefore into wind and
humidity). Same shape as `climateV1SeasonParams`. Wiring it in is the next
round's decision, together with the SST longitude work.

**Regression**: the diff is 26 added lines in one existing file plus two new
files, and nothing under `js/` or `index.html` imports either, so the app is
provably unchanged. V0.8 reads 63.4% / 10.2%, and all seventeen existing
Climate v1 test/validator suites pass with output identical apart from
wall-clock timings.

## Climate v1 is a present-Earth diagnostic model, and the ice sheets are an input

Full audit: `docs/climate-v1-scope-and-ice-sheet-boundary.md`. Audit only --
no physics file changed, nothing fitted, no parameter moved.

**The user asked the right question**: if today's ice sheets are assumed from
the start, shouldn't the model instead begin ice-free and grow Antarctica and
Greenland for itself? Yes -- for a *world generator*. Climate v1 is not one,
and this is now written down so nothing mistakes it for one.

**The tracks are formally split.** This branch (`climate-v1-redesign`) is the
**Present-Earth diagnostic model** and nothing else. The **Equilibrium world
generator** (bedrock -> climate -> self-formed ice sheets) is a separate track
on `climate-equilibrium-prototype`, run by a different AI. **Do not implement
the equilibrium side here.**

**Where the ice sheets actually enter, measured by reading the code**: no file
under `js/` reads an ice map of any kind. They enter in **one** place -- the
**elevation field**, because `terrain.source` is GEBCO_2026's **ice surface**
grid, so Antarctica and Greenland are the top of the ice. The land/sea mask
inherits that (ice shelves count as land). Everything else is either generated
(V0.8's land-ice class from temperature x moisture, 80.0% IoU; Climate v1's
sea ice from temperature) or validation-only (Teacher A's Natural Earth ice).
**There is no albedo anywhere** -- `shortwaveAbsorbedFraction` 0.70 is one
global scalar.

**The measurement that reverses the intuition.** Area-weighted over land:
Antarctica's mean ice-surface elevation is **1967 m** (54% above 2000 m) and
Greenland's **1483 m**, so at the surface lapse rate of 5.2 C/km the model is
handed **10.2 C** and 7.7 C of polar cooling for free, purely because it reads
the top of the ice. **And Antarctica is still +10.5 C too warm.** So the polar
error is the ice sheet's missing *energy balance* (no albedo), not the fact
that its shape is prescribed -- and **swapping to bedrock today would roughly
double that warm bias**, not fix it.

**The blocker for the other track, stated once**: six of the seven pieces of a
minimal `dh/dt = accumulation - ablation - flow` could be written today; the
seventh cannot, because **Climate v1 has no precipitation** and Stage 5's
closure measured why (every proxy inherits the Stage 4 wind's zeros -- 0.00
mm/day over the Amazon and the Congo). The prerequisite order is bedrock ->
surface energy balance with albedo -> precipitation -> mass balance.

**Bedrock is one URL away**: CEDA serves `sub_ice_topography_bathymetry/` from
the same directory as the ice-surface grid `build-terrain.yml` already
downloads. `js/climate-v1/terrain.js` already reserves `TERRAIN_STATES.BEDROCK`
and forbids approximating `DEGLACIATED_EQUILIBRIUM` (that needs a real GIA
model).

**What the other track inherits** is in the document's section 9, and the most
valuable part is the negative results (the two-layer ocean's degeneracy, the
bucket, the wind's, the precipitation proxies' zeros, the ice-albedo trade
that moves Antarctica -8.0 C but Greenland -9.2 C). **What it must not inherit
is any parameter fitted in polar cells on the ice-surface DEM.**

**This branch's next step is unchanged**: the sea surface has no longitudinal
structure, which is upstream of the overstated sea-ice area, which is what
currently blocks adopting the sea-ice heat-capacity feedback.

## Climate v1: the sea-ice heat-capacity feedback, pre-evaluated and NOT built

Diagnosis only -- no code changed in that round. Kept because the numbers
decide the next two stages.

**The question**: the largest seasonal residual on the globe is 60-90N ocean
(model amplitude 6.28 C against the teacher's 11.31, phase +19.5 days). Ice
insulates the mixed layer, so does giving ice-covered cells a smaller effective
heat capacity fix it?

**It works, and at full physical strength it overshoots.** Four candidates were
measured; the zero-parameter physical one (a thin ice slab over a reservoir at
the freezing point, with `k_ice/h` as extra damping) gives 13.48 C and a -32 day
phase, past the teacher in both. What matches is one lumped empirical number,
an effective under-ice mixed-layer depth of about **10 m** (6.28 -> 11.53 C,
phase +19.5 -> -1.0 d), and **that number is a fit to the Arctic**, which is the
compensating-error tell.

**Three findings worth keeping.**
- **It is a redistribution, not a gain.** Whole-ocean amplitude MAE 1.68 ->
  1.69: the Arctic improves and the Southern Ocean degrades by as much.
- **The southern damage is the ice-area error, not the mechanism.** Driving the
  same mechanism with the *teacher's* own ice map puts 60-90S back at MAE 3.22
  against a baseline 3.20 (the model's own phase-mean ice fraction there is
  **0.69 against the teacher's 0.02**).
- **The feedback is stable but it destroyed every multi-year ice cell**: 88N
  3.30/3.03 m -> 1.76/0.00 m, perennial area 3.35% of the globe -> 0.00%.
  Current, cold and warm starts all reached the *same* periodic solution in six
  outer iterations, so this is not bistability -- it is a missing mechanism.

**Verdict: NOT_READY, and the blocker was named**: a melting surface has no
temperature ceiling in this model, so a correct amplitude drives a melt that
nothing pays for. Build the latent coupling first (below), then re-evaluate.
`iceEffectiveMixedLayerDepthM = 10` is **not** an adopted value.

## Climate v1: sea ice pays for its own latent heat

Full write-up: the last section of `docs/climate-v1-sea-ice-state.md`. Code:
`js/climate-v1/sea-ice-state.js`, `tools/validate_sea_ice_state.mjs`. The app's
drawn fields are untouched -- `meta.feedsBackIntoTemperature` is still `false`
and the annual frame still hashes `1799c75758ce`.

**The bug this fixes.** The air-ice flux `Phi` entered the ice's thickness
equation and no other budget, so melting cost the atmosphere nothing and
freezing warmed nothing: **10.19 W/m2 averaged over the 7,295 ice-bearing
cells**, created at one and destroyed at the other. Beside it, clamping `h` at
zero discarded the leftover melting energy. Both are now closed: `Phi` is a
transfer (subtracted from the air, added to the ice, once each), and an `h = 0`
crossing spends only what melts the ice that is there and returns the rest to
the water. **Residual: max 1.22e-13 W/m2 over the whole ocean.**

**No new parameter**, and the six existing constants each appear exactly once.

**Which temperature is which, and why nothing is clipped.** Berkeley Earth's
Arctic ocean cells run **-26.0 C in January and +3.2 C in July at 88N**, which
no sea-surface temperature can do -- water under ice sits at the freezing
point. So the teacher's ocean value there, and this module's own state, are
**near-surface air temperature over sea ice**, and clipping it at the melting
point would be both wrong by definition and the very non-conservation being
fixed. The constraint is on the *exchange*: melting ties the air to a surface
at the melting point through 15 W/m2/K (large beside lambda = 10, so the summer
is held down), while in winter the same tie runs through the ice and is
**0.95 W/m2/K under 2 m** (so the cold season is untouched). That asymmetry was
already in the flux law.

**The forcing is recovered from the season table rather than rebuilt** --
`solvePeriodicResponse`'s map is invertible, so `rowForcingFromSeasonTable`
inverts it. Verified: with the air-ice exchange off, integrating that forcing
reproduces the table's analytic amplitude to **6.96e-3 C**.

**On its own it barely moves anything**, which is the point: ice area max
7.58% -> **7.51%**, min 4.63% -> 4.75%, and every representative point keeps
its perennial/seasonal/none class (88N 3.26/2.99 -> 2.74/2.48 m). **The
uncoupled path is kept and is bit-identical to what shipped** (worst |df| and
|dh| exactly 0), which is what makes that comparison a measurement.

**`stepsPerYear` moved 48 -> 96**: the coupling makes the melt season the
step-sensitive part, and the perennial-ice share reads 3.28 / 3.36 / 3.40 /
3.42 / 3.43 % at 24 / 48 / 96 / 192 / 365 steps against an 8760-step
reference's 3.44%. 96 costs 462 ms against 244 ms in node for a 20-year run.

**Not bistable, measured rather than asserted.** From an ice-free ocean, from
5 m of ice at -20 C and from +20 C, the ice *fraction* never differs by more
than 0.01. The perennial *thickness* differs by 1.21 m at 20 years and that
spread decays **1.206 -> 0.249 -> 0.033 -> 0.001 m at 20 / 60 / 120 / 240
years** -- unconverged, not two solutions.

**Teacher sanity, not a fit**: the model's own air temperature at 88N runs
-15.8 / -1.1 C against -26.0 / +3.2. The amplitude is still too small, which is
the 30 m mixed layer this round deliberately did not touch -- i.e. exactly what
the heat-capacity feedback is for, and it can now be re-evaluated without
losing the multi-year ice.

## Climate v1: the seasonal cycle (the first time axis)

Full write-up: `docs/climate-v1-seasonal-cycle.md`. Files:
`js/climate-v1/season.js`, `tools/validate_season.mjs`. **Nothing in the
shipped pipeline imports it**, no UI changed, and Stage 2's annual field is
untouched.

    T(lat, lng, phase) = T_annual(lat, lng) + deltaT(lat, surfaceType, phase)

**`deltaT`'s annual mean is zero by construction, not by tuning** -- it is a
sum of harmonics with no constant term (worst row 1.45e-14 C; averaging 48
phases of the real grid returns Stage 2's field to 3.6e-7 C per cell). So
turning the season on cannot move the annual mean of anything.

**`orbitalPhase` runs [0,1) over one orbit** and no calendar is hardcoded;
phase 0 is the ascending equinox, 0.25 the northern solstice, on any world.

**One layer, solved analytically**: `C dT'/dt = F(t) - lambda T'`, per harmonic
`k = n*w*tau`, gain `1/sqrt(1+k^2)`, lag `atan(k)/(n*w)` -- amplitude *and*
phase lag both from the geometry, no time stepping anywhere. Forcing is real
W/m2 (`0.70 * S0 * insolation anomaly`); **Stage 2's `insolationSensitivityC`
is deliberately not reused** -- it is an annual-mean regression coefficient
carrying feedbacks and transport, and reusing it puts 45N at a 42 C
half-amplitude against an observed 12-15.

**The constants are representative, not universal**: `lambda` = 8 W/m2/K (the
only free number, empirical), soil 4 m, mixed layer 30 m, absorbed fraction
0.70 -- no albedo map, no ice feedback, no geography of any kind. All are
meant to be replaced per planet and per surface. **`oceanModeration` is a
different question** (annual-mean ocean heat transport) and is never mixed in.

What it gives, with `C_land` 1.88e7 (tau 27 d) and `C_sea` 1.30e8 (tau 188 d):
45N land **15.1 C half-amplitude peaking 25 days after the solstice**, 45N sea
**4.9 C**, sea peaking **48 days after land**; amplitude monotone in latitude
(1.2 at the equator to 21.6 at 85N), +/-45 identical, 45N/45S in antiphase
(r = -1.000), the equator genuinely **semi-annual** (two maxima, second
harmonic 1.14 C against the first's 0.07), 85N polar night and midnight sun
156.7 days each, and **exactly 0.00 C season at tilt 0** rising to 46 C at 80
degrees.

**The anomaly has no longitude**, because heat capacity here depends only on
land-or-sea -- so the table is (row x surface x harmonic): **32 KB** for 512
rows, **44 ms** to build, rebuilt only when the world or its obliquity
changes, ~100 ns per sample, no interpolation. Four harmonics were measured
against a 64-harmonic reference: **0.00 C error at 0/30/45/60 deg, 0.23 C at
+/-85** (24 stored phases would cost 96 KB for a worse 0.66 C). **That
longitude-free assumption is exactly what breaks when state memory arrives**;
`heatCapacityJPerM2K(surfaceType)` is a separate exported function so the
replacement point is visible, and `SEASONAL_TIME_AXIS` is the one place a
future forward integrator reads its axis from.

### Orbital eccentricity and periapsis direction

Two physical inputs on the body -- `orbitalEccentricity` (e) and
`periapsisLongitudeDeg` (the angle from the ascending equinox to periapsis
along the direction of motion; Earth ~283, Mars ~251) -- both defaulting to 0.
Full write-up in `docs/climate-v1-seasonal-cycle.md`.

`sampleOrbit` solves `M = E - e sinE` by Newton once **per phase** (360 per
table build, never per latitude or per cell, because the declination and
(a/r)^2 depend on the phase alone), then the forcing line gains one factor:
`distanceFactor[s] * dailyMeanInsolationFactor(lat, delta)`, with the
declination taken from the solar longitude the orbit actually reached. The
harmonic solver and everything downstream are untouched.

**`orbitalPhase` stays equally spaced in time** -- the true anomaly is never
the clock. That is load-bearing twice over: the sea-ice integrator steps at a
constant `yearSeconds/steps`, and the arithmetic mean of the sampled forcing
is the true time mean only on a uniform-in-time axis, which is what keeps the
anomaly's annual mean at exactly zero (measured 3.2e-14 C on every orbit
tested).

**e = 0 bypasses the solver entirely**, so the circular case is bit-identical
by construction: **0 of 8192 coefficients differ and the sampled anomaly
differs by 0.0 C**, with a non-zero periapsis passed in to prove it is ignored.

**The harmonic count is derived from e, and had to be.** A fixed 4 harmonics
gives 0.5 C error at e = 0 but **17 C at e = 0.5** -- the periapsis passage
becomes a spike narrow in time. Sampling is not the problem (360 phase samples
agree with 1440 to 0.07 C even at e = 0.8). So
`harmonicsForEccentricity(e) = min(48, ceil(4/(1-e)^1.6) + 2)` with e = 0
special-cased to 4 -- **a numerical-accuracy setting, not a fitted
parameter**, and the bar is the accuracy the circular case already delivers
(0.504 C), not an invented budget. Measured: H 4/7/7/8/10/12/15/20 at
e 0/0.0167/0.093/0.2/0.3/0.4/0.5/0.6, error 0.20-0.28 C throughout, 32-160 KB,
33-125 ms.

**e <= 0.6 is supported and above it `sampleOrbit` throws**, never clamps: at
e = 0.7 the requirement is 32 harmonics and at 0.8 it is past 48 with 53 C of
error. A silently reduced eccentricity would draw a plausible season for a
planet nobody asked for.

**Verified against two exact identities** rather than any one step: phase 0 is
the ascending equinox at every e and every periapsis direction (worst
|solar longitude(0)| = 3.8e-15 rad), and the time mean of (a/r)^2 is
1/sqrt(1-e^2) (worst relative error 5.3e-15). Newton needs at most 5
iterations up to e = 0.6.

**The hemispheric asymmetry falls out of the geometry and its sign is set by
the periapsis direction alone** -- nothing fitted, no hemisphere named in the
code. Land half-amplitude at 45N / 45S: circular 15.1 / 15.2, Earth's own
orbit 14.3 / **16.0** (the southern summer stronger, as it really is),
Mars-like 11.1 / **19.8** (its known strong southern bias, unprompted),
e = 0.3 with northern summer at periapsis **34.2** / 3.7, with southern summer
at periapsis 3.6 / **34.3**, with periapsis at an equinox 23.7 / 24.4. At
e = 0.5 the equator reaches 47.6 C because the 1/r^2 term becomes a *global*
annual cycle dominating the tilt contrast -- right, but not what "season"
usually means.

**Two limitations, stated rather than hidden.** The orbit-mean insolation
itself rises as 1/sqrt(1-e^2) (+15.5% at e = 0.5) and **Stage 2's annual-mean
field never reads e**, so a high-e world has an eccentricity-aware seasonal
departure added to an eccentricity-blind annual mean; the factor is reported as
`table.orbit.meanInsolationScale`. And **sea ice's 48 steps/year was only ever
checked on a circular orbit** -- a sharper high-e melt season needs its own
diagnosis. No sea-ice setting was touched.

**The Moon is the trap**: its seasonal insolation follows the Earth-Moon
system's orbit round the Sun, not its own e = 0.055 orbit round the Earth.
Nothing infers an eccentricity from anything, so this is only a warning for a
future settings screen.

**No world's config carries the new fields**, so every world is still circular
and the app draws exactly what it drew. Entering Earth's real 0.0167/283 would
move the picture (45N 15.1 -> 14.3) and that is a content decision for the
planet-settings screen, not something to slip in with the capability.
`ensureSeasonTable` in `main.js` now keys its cache on the orbit as well as the
row count, which is the whole API readiness for that screen.

### The planet settings on the phone

A **軌道** button on the season row opens a separate overlay holding
軸傾斜 / 離心率 / 近日点. Three sliders were deliberately kept OFF the main
screen -- these are set once and looked at, not adjusted while watching the
globe. With the overlay closed the panels are unchanged at **41 px top,
214 px bottom**.

**It only exists where the seasonal model runs** (temperature-model, Earth),
and closes itself on the teacher, on humidity, in 2D and on a world switch --
so **the Moon can never be handed its own geocentric e = 0.055**, which is the
one misconfiguration this control could invite.

**Two kinds of change, and the code knows which is which.** Axial tilt is read
by **Stage 2's own annual-mean field**, so it invalidates the whole Climate v1
preview (wind, humidity, moisture all follow) -- correct physics, the expensive
path. Eccentricity and periapsis are read only by the seasonal module, so they
rebuild the season table and the sea-ice cycle and nothing else. Both measure
2.4-2.7 s in the software renderer because the painter dominates either way.

**Nothing is written to any world's config.** `orbitOverride` starts null and
元に戻す clears it, so the default state is bit-identical: the annual frame is
still `1799c75758ce` and the seasonal frame at phase 0.25 still `9a360f6532e5`,
before the panel is opened and again after a full tour of the sliders plus a
reset. **The phase is never reset** by an orbit change. **The rebuild waits for
the finger**: the readout follows `input`, the model runs on `change`.

**e is capped at 0.60 by the slider's own range**, so `sampleOrbit`'s throw can
never be reached from the UI, and the hint says "0〜0.60まで対応" rather than
clamping silently.

**The warning is shown for any e > 0**, not only a large one, because the
statement is equally true at 0.0167 -- only smaller. It names the real number
(+25.0% orbit-mean insolation at e = 0.6) and repeats that sea-ice thickness is
indicative while its area and timing are stable.

**The thing the warning exists to cover**: at e = 0.3 with periapsis at the
northern summer the readout shows the Sahara at **60.6 C**. Not a bug -- the
seasonal departure is eccentricity-aware while the annual mean it is added to
is not, so at high e the absolute temperatures are meaningless and only the
*pattern* should be read.

Measured from the UI: tilt 0 collapses the Sahara's seasonal swing to **exactly
0.0 C** (baseline 15.1), tilt 40 raises it to **24.4 C**, and periapsis 90 vs
270 at e = 0.3 swaps which hemisphere gets the strong summer, matching the
design's own predictions.

`applyAxis` (the V0.7.1 posture button) deliberately keeps reading the world's
own obliquity rather than the override -- editing a *climate* parameter should
not silently re-pose the globe.

**Not V0.8's season, and the two must never be mixed.** V0.8's
`seasonalSensitivityC` / `seaSeasonalDamping` are an instantaneous response to
the solstice anomaly with no heat capacity and **no phase lag**, and each
latitude takes the max/min of the two solstices, so that field is a composite
of two calendar moments rather than the surface at one time. It is a drawing
correction; neither parameter is read here.

**Regression**: `js/climate.js` gained one exported function
(`dailyMeanInsolationFactor`) and its two insolation functions now call it
instead of each inlining the same formula. Checked rather than assumed --
`score_climate.mjs` and `score_koppen.mjs` print byte-identical output (63.4%
/ 10.2%) and all ten existing Climate v1 test/validator outputs are
byte-identical (178 assertions).

## The seasonal cycle on the phone (temperature only)

One 30 px row in the bottom panel, shown **only while 気温モデル is on**:
`[年間][季節] ◀ [slider] ▶ [再生]`. Write-up:
`docs/climate-v1-seasonal-cycle.md`. Humidity, wind, ET, precipitation, soil
water, snow, sea ice and vegetation are all still annual means, and both the
button's title text and the readout's heading say "気温のみ" so the globe
cannot be read as a fully seasonal model.

**年間 shows Stage 2's own array, not a copy.** The rendered frame after one
and after three 年間↔季節 round trips is byte-identical to the frame from
before the season existed (`1799c75758ce`), and so is the frame after a full
tour of 2D, the Moon, Mars and back.

**The slider is 1440 steps per orbit** (`orbitalPhase = value / 1440`), the
arrows step 1/24 of a year, and 再生 advances the phase from *real elapsed
time* -- one orbit per 12 s, so a slow device plays the year at the right
speed with fewer frames instead of in slow motion (measured: 0.265 of a year
in 3 s). The row hides and playback stops wherever a season would imply
something untrue: the temperature teacher is an annual mean, humidity is not
seasonal here, and the 2D map and the other two bodies have no preview.

**The readout reads the phase it drew.** サハラ 30.5 C at phase 0.25 against
15.4 C at 0.75, while アマゾン goes the other way (29.2 -> 31.2) -- if the four
region numbers had kept reading the annual field they would have contradicted
the picture beside them.

**Moving the phase runs no climate stage: 10-20 ms.** That needed
`showScalarField` fixed first, and the fix is exact rather than an
approximation. It had coloured all two million texture pixels through a
callback; since its sampling is *nearest*, every texture row mapping to the
same field row is byte-for-byte identical, so the colour is now computed once
per **field** cell and each row is filled by typed-array copy. The run bounds
`[ceil(fx*w/fw), ceil((fx+1)*w/fw))` are the exact inverse of the old
`floor(x*fw/w)` (checked over seven size pairs, including a field wider than
the texture) and the rendered frame hashes the same before and after.
**650 ms -> 26 ms**, which the teacher and humidity views get for free.

Frame rate at 412x892 in the software renderer is **2 fps with the photo
surface, in 年間, in 季節 and while playing** -- the same number four times,
i.e. the season costs no frame rate; that 2 is swiftshader drawing a
393k-vertex globe. Panel heights are unchanged (41 px top, 182 px bottom).

Representative points off the real grid: 45N land (France) half-amplitude
**15.1 C** peaking 27 days after the solstice, 45N sea (North Pacific)
**4.9 C** peaking +72 d, 45S land (Chile) 15.2 C -- the design's own
predictions, on real geography.

## Climate v1: sea ice as a state carried around the year

Full write-up: `docs/climate-v1-sea-ice-state.md`. Files:
`js/climate-v1/sea-ice-state.js`, `tools/validate_sea_ice_state.mjs`.
**Nothing in the shipped pipeline imports it**, no UI changed, and
`meta.feedsBackIntoTemperature` is `false` -- albedo feedback is a later stage.

**The state is thickness; the fraction is diagnosed.** A fraction-only state
was measured and rejected first: it **saturates**, reading 1.00 at its maximum
in both the central Arctic and the Bering Sea, so it cannot tell 4.8 m of
multi-year ice from 0.7 m of first-year ice. Thickness is the latent heat, so
it is what remembers; `fraction = min(1, h/0.3 m)` and that 0.3 is
**empirical and provisional** (it stands in for floe-scale processes this model
does not have).

    freeze (T <= -1.8 C): F = (T_f - T) / (1/lambda + h/k_ice)   Stefan, series
    melt   (T >  -1.8 C): F = -lambda_melt * (T - T_f)           surface, unshielded
    both:                 F -= F_w ;  dh/dt = F / (rho_ice L_f)

**The asymmetry is the design**: freezing heat must escape *through* the ice so
growth self-limits, melting happens at a surface already at the melting point
so thickness shields nothing. That is what makes perennial ice possible on a
cold sea and impossible on a warm one.

**F_w is the closure and stays at the literature value.** Without it the
central Arctic reaches **11 m and is still rising after 40 years**. Default
**2 W/m2** (Maykut & Untersteiner's Arctic figure). 3 and 4 W/m2 give a
thickness closer to the observed 2-3 m and are **deliberately not adopted** --
the user's call and the right one: the sea temperature feeding this has known
upstream errors, and fitting F_w to observed thickness would absorb them into a
sea-ice parameter. They are a sensitivity test (88N 5.40 / 4.44 / 3.66 m at
F_w 2 / 3 / 4; seasonal ice barely moves).

Measured, 256x128, 48 steps/year, 5 years: 88N **3.26/3.00 m**, 80N 2.81/2.62,
Bering 62N 0.71/**0.00**, 70S 1.25/0.37, 62S 0.71/0.00, 40N and 10N **0.00**
throughout -- perennial ice where it is always cold, seasonal ice that empties
each summer, nothing on a warm sea, and the two hemispheres' seasonal maxima
**0.50 of a year apart**. 48 steps are within **0.017 m** of an 8760-step
reference (24 within 0.036).

**The two convergences are different questions, and that is reported rather
than hidden.** The *fraction* reaches a periodic steady state in **2 years**;
**perennial thickness has not converged in 20** (80N annual max 1.43 -> 1.95 ->
2.81 -> 4.28 m at 1/2/5/20 years). `meta` carries `yearsUsed`,
`fractionConverged`, `thicknessConverged` and both year-boundary differences,
and an unconverged thickness is a result, not a failure. One consequence: at
F_w = 2 the perennial cells' within-year swing (0.19 m) is *smaller* than the
spin-up trend they still carry at five years (0.29 m), so the **phase** of
their maximum is meaningless until the thickness converges -- the seasonal
zone's phase is not.

**Cost**: 48 ms for 5 years x 48 steps over the whole globe (node), so roughly
0.15-0.5 s on a Pixel 7a, once per world. Tables **6.0 MB** at 24 stored phases
(`outputPhaseCount: 12` halves it).

**Against the teacher, only as far as it can say.** The repo's only sea-ice
teacher is Teacher A's annual photographic snapshot (**1.00% of the globe**),
with no seasonal maximum, minimum or phase. Model annual maximum **9.19%**
(N 3.86 / S 5.33), minimum 3.23% -- both hemispheres, both perennial and
seasonal ice, right order of magnitude, clearly **too large**. The seasonal
maximum, minimum and phase are **not verified** and must not be described as
verified.

**The upstream limits, not to be corrected here**: no longitudinal SST
structure (so the 60-70 band freezes all the way round -- there is no Gulf
Stream), no currents, no AMOC, and the sea's own cycle lags ~72 days (the 30 m
mixed layer), so the ice peaks 2-3 months late. The validator therefore asserts
growth and melt against **each cell's own temperature cycle**, not the
calendar, because a calendar-anchored assertion would be testing that lag
instead of this model.

**One harness trap worth keeping**: `present-classes.png` is a *paletted* PNG
and `tools/png.mjs` returns one class index per pixel. Matching it by RGB
colour reads **0% sea ice everywhere**, which looks exactly like a broken
model.

No common seasonal integrator was built -- one state model is not two. The
(cell, phase, state, tendency) boundaries are kept clean for when land snow
arrives, which needs precipitation first.

### The sea ice on the phone: an experimental overlay, off by default

Connected to the season slider the user had just confirmed, as **option B** --
shown, with the screen saying the extent is overstated, rather than kept off
the phone. Write-up: `docs/climate-v1-sea-ice-state.md`.

**One button in one row** (`[海氷 切 | 入]`), below the season row, and it
exists only while the seasonal temperature is on screen. 年間, 気温教師,
湿度モデル, 湿度教師, 2D, the Moon and Mars all put it away **and switch it
back off**, so nothing carries a stale ON into a view where it would be wrong;
a world load does the same. Measured at 412x892: the bottom group is 182 px
with the ice row absent and **214 px with it**, and the top panel stays at 41.

**The label is the point.** With the ice on, `実験・面積過大` appears beside
the button and its `title` names every cause -- no longitudinal structure in
the sea temperature, no currents, the 60-70 degree band freezing all the way
round, the possible 2-3 month phase lag. The annual maximum really is 9.19% of
the globe against the teacher snapshot's 1.00%, and **that is an upstream error
reported, not a sea-ice parameter to be moved.**

**One clock.** The overlay reads `fractionByPhase` at the *same* `orbitalPhase`
the temperature is drawn from. The ice table stores 24 phases where the
temperature is continuous, so the ice steps in ~15-day increments -- a storage
choice, not a second time axis.

**Off is bit-identical to not existing.** `showScalarField` gained an optional
`overlay`; with none it takes the original code path untouched. Measured in the
browser: 年間 hashes `1799c75758ce`, the same as before the season existed;
turning the ice off returns the seasonal frame to the exact hash it had before
the ice was ever on; and 年間 after the ice had been on is identical again.

**Cost.** The spin-up is **91 ms** in the browser (5 years x 48 steps), once
per world on the first press of 入 -- 2.2 s of wall clock for that first press
including the preview redraw it shares with every other button. A phase change
with the ice on is **19.3 ms**, and playback measures **1.6 fps with the ice on
and 1.6 fps with it off** -- the overlay costs no frame rate; 1.6 is swiftshader
drawing a 393k-vertex globe.

**What it draws** is the fraction times the cell's own sea share, so a
mostly-land coastal cell does not paint ice over the land beside it, blended as
a pale blue-white at alpha `0.82 x fraction` -- separate from the temperature
ramp, zero leaves the pixel untouched, and full cover is deliberately not
opaque. Behaviour at the four seasons, from the note's own readout: the Arctic
holds 3.00-3.14 m all year, Bering seasonal ice runs 0.57 m -> **0.00 m** ->
0.06 m, and the Southern Ocean runs **0.00 m** -> 0.20 -> 0.75 -> 0.93 -- both
hemispheres empty and refill, half a year apart. Their minima do not fall on
the calendar's summer because the sea's own cycle lags ~72 days upstream, which
is the limit above rather than a fault here.

## Climate v1 preview: experimental evaporative cooling (touchable)

The first time the app imports anything from `js/climate-v1/`. Full write-up:
`docs/climate-v1-evaporative-cooling-preview.md`.

**Off by default and reversible in one number.** `evaporativeCoolingC` is 0,
the preview opens off, and the cooling pass returns the *same object* it was
given, so an off run cannot differ even by a Float32 round trip. Nothing in
the 標準 / 岩 / 陸地塗り分け / 教師 colouring calls into it.

**The cooling** is `dT = -evaporativeCoolingC * q^2/(q^2 + qHalf^2)` over land
only, keyed on the model's own specific humidity. Geography-blind by
construction (no place, no latitude, no teacher is reachable from that file),
saturating, and quadratic at small q so a desert is left alone. A psychrometric
wet-bulb form was built first and **rejected**: the wet-bulb depression is
*largest* over deserts (Sahara ~9.8 C against the Amazon's ~6.3 C), so every
multiplicative version of it cools the Sahara hard.

With the observed wind: アマゾン 30.9 -> 25.9 C (bias +6.2 -> +1.2),
インドネシア 30.0 -> 25.5, サハラ -0.6, オーストラリア -1.2, **the ocean exactly
0.0 by construction**. インド is over-cooled (-0.9 -> -3.2) and コンゴ barely
moves because Stage 5B only delivers 4.4 g/kg there.

**The wind toggle exists because of a real finding**: with the frozen Stage 4
wind the model gives アマゾン **0.0 g/kg**, so the cooling can do nothing there.
The preview offers 現行風 / 観測風 side by side rather than hiding that. 観測風 is
a diagnostic teacher only.

**Where the UI went**: the v1 rows are in the *bottom* panel with 天体 and
軸/線, so the top panel stays at **137 px** exactly as before. The bottom group
goes 123 -> 155 px on Earth, 232 px while the preview is on.

**Preview resolution is halved (1024x512)** in the app; every command-line tool
still runs the full 2048x1024. The transport grid is 256x128 either way.

**Two harness traps re-confirmed this round**, both already in this file and
both hit again: copying the production `index.html` over the vendored test
site silently points three.js at jsdelivr (which this sandbox cannot reach),
and the axis readout goes live from inside `initGlobe3D` **before** `loadWorld`
finishes wiring the panel -- wait for a panel row, not the readout. A third:
`pkill -f "node test.mjs"` kills the shell running it, since that shell's own
command line contains the pattern.

