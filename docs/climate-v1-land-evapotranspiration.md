# Climate v1: experimental land evapotranspiration

**Status: implemented, OFF by default.** `landEvapotranspirationWeight` is 0, so
the shipped model is exactly Stage 5B. Tool: `tools/validate_land_et.mjs`.
Diagnosis it came from: the inverse source/sink audit (below).

## 1. The equation

    ET = availability(RH) * k_ET * max(q_sat - q, 0)
    k_ET = 1 / tau_ET,  tau_ET = 4.6 days
    RH = q / q_sat
    availability = smoothstep(centre - halfWidth, centre + halfWidth, RH)
                   [centre 0.5, halfWidth 0.25]

`tau_ET` is **derived, not fitted**: the bulk aerodynamic rate
`rho * C_E * |U| / M_column` with rho = 1.2 kg/m^3, C_E = 1.3e-3, |U| = 4 m/s and
a 2500 kg/m^2 vapour-bearing column is 2.5e-6 /s, i.e. 4.6 days. No teacher was
consulted for it.

**The ramp's 0.25 / 0.75 are EMPIRICAL AND PROVISIONAL and must not be quoted as
physical constants.** They stand in for soil moisture, which this model does not
carry because it has no precipitation to recharge it. They were chosen for one
measured reason, in section 4.

Four parameters, all `search: false`: the weight (a switch, 0 or 1), the
timescale, and the ramp's centre and half-width.

## 2. Why it exists: the inverse diagnosis

Holding the *teacher's own* q field steady under this very operator, with the
observed 850 hPa wind, needs a local land source over **83% of land**, averaging
+0.89 g/kg/day. The wet tropics need about five times what deserts need
(アマゾン +2.75, コンゴ +2.31, インドネシア +2.39 against サハラ +0.46,
オーストラリア +0.60, シベリア +0.41). And of the 1.08 g/kg/day the tau sink
removes over land, advection supplies only 0.20 — **82% has to come from a local
source**. The water-surface boundary was audited first and is not the problem
(global sea bias +0.41 g/kg, mid-latitudes exactly 0.00); a uniform tau was
audited too and cannot work (at 24 days サハラ and オーストラリア overshoot
while コンゴ is still at 63% of the teacher).

## 3. It is not a tau relabel, and that is the point

Substituting into the steady state:

    (a + b + 1/tau + k*phi) q = A_in + k*phi*q_sat

The denominator gains `k*phi`, which alone would be a shorter tau -- but the
**numerator gains `k*phi*q_sat`, a term not proportional to q**, so no constant
`tau_eff` can reproduce it. `phi` depends on q, so the equation is nonlinear as
well. Both limits are exact: `phi -> 0` is Stage 5B, `phi -> 1` is plain bulk
evaporation.

Stage 5C-alpha's `f*q/tau` was *exactly* `(a + b + (1-f)/tau) q = A_in`, which is
why it was rejected. **Measured here rather than only argued**: sweeping
`moistureResidenceDays` from 8 to 40 days cannot reproduce the ET-on field --
the closest is tau = 25.5 days, still 0.722 g/kg RMS away.

## 4. Why the ramp is steep, which was the whole design decision

Availability is not optional and a gentle ramp is not safe. Measured, all with
k_ET derived as above:

| availability | サハラ (teacher 4.67) | 豪州 (7.00) | wet/dry source ratio |
| --- | --- | --- | --- |
| 1 (plain bulk) | 4.59 | 7.04 | **1.05x** |
| RH | 8.59 | 10.22 | 1.94x |
| smoothstep(0.05, 0.60) | 9.78 | 14.17 | 1.90x |
| supply-limited | 10.11 | 11.36 | 1.80x |
| **smoothstep(0.25, 0.75)** | **3.93** | **7.31** | **5.17x** |

Plain bulk evaporation looks good in q but supplies the Sahara **3.17 g/kg/day**
of evaporation, which a desert has no water to provide -- the saturation deficit
is *largest* over deserts, the same trap the evaporative-cooling wet-bulb form
hit. Gentle availability ramps are a positive feedback: at the strength needed to
fix the wet tropics they also let deserts run away. Only a steep ramp holds both.

A bucket was also tested and rejected under this round's no-precipitation rule:
recharging it from the solver's own condensation diagnostic gives a source that
is **identically zero** over land, because the q <= q_sat cap never binds there.

## 5. What it does, measured (oracle wind, evaporative cooling off)

**OFF reproduces Stage 5B exactly**: land mean 5.081 g/kg, bias -2.73, RMSE 4.60,
アマゾン 15.04, コンゴ 4.44, サハラ 2.89, and the Amazon still exactly 0.00 under
the model's own Stage 4 wind. The diagnostic arrays are `null` and
`meta.landEvapotranspirationApplied` is false, so the term is skipped rather than
run with a zero coefficient.

**ON**: land mean **5.081 -> 7.164** (teacher 7.806), bias -2.73 -> **-0.64**,
RMSE 4.60 -> 3.47.

| region | OFF q | ON q | teacher | ON bias | ET g/kg/d | ET mm/d | RH | avail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| アマゾン | 15.04 | **19.28** | 18.97 | +0.31 | 1.88 | 4.69 | 0.677 | 0.938 |
| コンゴ | 4.44 | 13.28 | 17.55 | -4.27 | 1.40 | 3.49 | 0.498 | 0.549 |
| インドネシア | 12.12 | **17.67** | 19.04 | -1.38 | 1.72 | 4.29 | 0.648 | 0.873 |
| サハラ | 2.89 | **3.93** | 4.67 | -0.74 | 0.19 | 0.48 | 0.205 | 0.089 |
| オーストラリア | 4.38 | **7.31** | 7.00 | +0.31 | 0.63 | 1.57 | 0.354 | 0.346 |
| インド | 6.79 | 8.90 | 12.46 | -3.56 | 0.76 | 1.91 | 0.407 | 0.465 |
| シベリア | 0.59 | 1.53 | 3.65 | -2.12 | 0.14 | 0.36 | 0.630 | 0.799 |
| ヨーロッパ | 3.56 | 4.28 | 6.76 | -2.48 | 0.28 | 0.69 | 0.760 | 0.938 |

**wet/dry ET source ratio 5.17x**, against the 5.07x the inverse diagnosis
required and the 5.17x the pre-evaluation predicted.

## 6. The water flux is physically plausible, which the inverse residual was not

mm/day uses an explicitly stated 2500 kg/m^2 column and is an order-of-magnitude
conversion only.

| | g/kg/day | mm/day |
| --- | --- | --- |
| 全球非雪氷陸 | 0.64 | **1.59** |
| 熱帯陸 | 1.16 | 2.89 |
| 湿潤熱帯 (RH > 0.45) | 1.42 | **3.55** |
| 乾燥地 (RH < 0.25) | 0.00 | **0.00** |

Quantiles: median 0.60, 90% 3.77, 99% 4.79, **max 5.02 mm/day**, and **0.0% of
land above 5 mm/day**. Earth's real land-mean evapotranspiration is about
1.3 mm/day and tropical rainforest 3-4. The inverse residual, by contrast, ran to
52 mm/day at its maximum -- the mechanism is better behaved than the target it
was designed against, which is what the annual-mean inflation predicted.

## 7. Sensitivity (robustness only -- nothing here was chosen by RMSE)

| case | land mean | bias | RMSE | アマゾン | コンゴ | サハラ | 豪州 | wet/dry |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ramp 0.20-0.70 | 7.612 | -0.19 | 3.11 | 19.41 | 16.24 | 4.68 | 8.24 | 4.06x |
| **ramp 0.25-0.75** | 7.164 | -0.64 | 3.47 | 19.28 | 13.28 | 3.93 | 7.31 | **5.17x** |
| ramp 0.30-0.80 | 6.715 | -1.09 | 3.82 | 18.94 | 8.76 | 3.48 | 6.55 | 5.67x |
| tau_ET 3 d | 8.441 | +0.64 | 3.49 | 20.90 | 19.09 | 5.28 | 9.90 | 3.66x |
| **tau_ET 4.6 d** | 7.164 | -0.64 | 3.47 | 19.28 | 13.28 | 3.93 | 7.31 | 5.17x |
| tau_ET 7 d | 6.296 | -1.51 | 3.90 | 17.92 | 7.36 | 3.43 | 6.02 | 5.50x |

The structure survives everywhere: wet/dry stays 3.7-5.7x, the Sahara stays at or
below the teacher in every case, and nothing diverges. **コンゴ is the sensitive
one** (8.76 to 19.09 across these six cases) because it sits on the ramp's steep
part -- that is the honest cost of choosing a steep ramp.

Note that ramp 0.20-0.70 has a *better* RMSE (3.11) and a worse wet/dry ratio
(4.06x). RMSE was deliberately not the selection criterion.

## 8. Solver behaviour

Semi-implicit inside the existing sweep, not an outer loop: the source splits
into a numerator term `k*phi*q_sat` and a denominator term `k*phi`, with `phi`
read from the q the sweep is holding at that moment. So a cell can never be
pushed past saturation and q can never go negative, by construction.

Converges in **117 sweeps** at the default tolerance (residual 9.8e-8); at a
1e-9 tolerance and 8000-sweep cap it takes 147 and the two answers differ by at
most 9.7e-7 kg/kg. **Zero NaN, zero negative values, zero cells above
saturation.** The pre-evaluation's separate check found the same fixed point from
a bone-dry start, a saturated start and the current field, to 0.0000 g/kg -- a
unique solution with no bistability despite the ramp's positive feedback.

Cost: the whole pipeline is **165 ms off, 181 ms on** (256x128 transport,
2048x1024 terrain) -- about 10%.

## 9. What is still wrong

- **コンゴ -4.27, インド -3.56, ヨーロッパ -2.48, シベリア -2.12.** The term
  fixes the level and the wet/dry contrast, not the placement. This was predicted:
  no existing variable explained more than 11% of the inverse residual cell by
  cell.
- **It cannot rescue the model's own Stage 4 wind.** Under that wind the Amazon
  and Congo sit at exactly 0.00 g/kg, so RH is 0, availability is 0 and ET
  supplies nothing -- the mechanism needs some moisture to bootstrap. Worse, the
  same wind leaves the Sahara at 4.77 g/kg, which is enough to open the ramp, so
  ET pushes it to **12.54 against a teacher of 4.67**. **With the production wind
  this term makes the Sahara much worse.** That alone is why it ships off.
- **tau = 8 days was not re-derived.** The existing sink was fitted in a world
  with no land source; now that one exists, tau is due a fresh look. That is a
  separate stage, deliberately not done here.

## 10. Not done this round

No UI. `landEvapotranspirationWeight` is an internal parameter only; nothing on
the phone changed and no world config carries it. Climate v0.8 is untouched
(`score_climate.mjs` 63.4%, `score_koppen.mjs` 10.2%, both identical).
