# Climate v1 Stage 5B — moisture transport

The first stage that produces the air's **actual** specific humidity rather
than Stage 5A's capacity. It did not meet its declared criteria, and this
document says so plainly and explains why.

---

## 1. The control, measured before anything was built

`q = 0.826 × q_sat`, with no transport at all, already scores **r = 0.9234
globally** and **r = 0.9729 over ocean**, because q is mostly RH times
capacity and capacity is mostly temperature. Correlation is also completely
insensitive to the RH value, since a uniform scaling cannot move a
correlation.

So a rising global correlation would have meant nothing. What the control
gets wrong is the **land pattern**, and that was made the whole target:

| region | control | teacher | control error |
| --- | --- | --- | --- |
| Sahara | 15.19 | 4.67 | **+10.52** |
| Australia | 15.75 | 7.08 | **+8.67** |
| Amazon | 23.33 | 18.97 | +4.36 |
| Europe | 4.55 | 6.77 | −2.22 |

Finding this *before* implementing is the Stage 7.5 lesson applied in
advance: there, a latitude lookup table was discovered to match the whole
model only after a quarter-million search trials.

---

## 2. The equation

A steady state — the pipeline is an annual mean, so there is no clock:

```
u ∂q/∂x + v ∂q/∂y = −q/τ + K∇²q        (away from water)
q = surfaceRelativeHumidity · q_sat     (on water)
q ≤ q_sat(T, p)                         (everywhere)
```

solved by alternating-direction upwind Gauss–Seidel. Every coefficient is
positive and the diagonal dominates, so it is unconditionally stable, needs
no timestep and no CFL condition. Longitude wraps; latitude does not.
Measured: **~1560 sweeps, 230–290 ms** for 256×128.

**The saturation cap is the orographic mechanism and needs no parameter.**
Stage 2 already applies the lapse rate to elevation and Stage 5A already
computes pressure there, so `q_sat` at a mountain cell *is* the saturation of
air lifted to that height. The designed `orographicLiftFraction` was
therefore **deleted before screening**, not after: it would have been a
second, empirical copy of a mechanism the physics already provides, and the
brief was explicit about not carrying "a physical 1.0" and "a searched
empirical" for the same thing. Verified in the tests: a synthetic ridge
leaves its lee at 2.32 g/kg against 5.08 g/kg without it.

### What `moistureResidenceDays` is not

It is **not** the Hadley circulation's subsidence and is never called that. A
single global τ cannot represent a subtropical high. It is a deliberate
lumping: *the effective residence time of water vapour against every removal
process this model does not resolve* — condensation, precipitation, mixing
with drier air aloft. One global value; no per-region, per-latitude or
per-place variant exists or may be added.

### Why the reference speed is a constant

In the direction-controlled comparisons the wind is normalised to one shared
speed so A and B differ **only** in direction. That speed is not fitted and
does not need to be: advection enters as `|U|/dx` against `1/τ`, so only the
product `U·τ` — a length — is identifiable. Fixing the speed and searching τ
is the complete parameterisation, with nothing hidden in the speed.

---

## 3. Parameters

| name | kind | searched | value |
| --- | --- | --- | --- |
| `surfaceRelativeHumidity` | empirical | **no** | **0.826, measured** |
| `moistureResidenceDays` | empirical | yes | 8 |
| `eddyDiffusivityM2PerS` | physical | yes | 3×10⁶ (**at its upper bound**) |
| `REFERENCE_TRANSPORT_SPEED_MS` | constant | no | 5 |

`surfaceRelativeHumidity` is the teacher's own q divided by this model's
q_sat over ocean. **Because it is a boundary condition taken from the
teacher, agreement over ocean is not a prediction and is never reported as
skill.**

Screening (each swept alone over its full range, condition A): τ moves the
objective by **2.70 g/kg** and K by **2.09 g/kg**. Neither is inert, so
nothing was deleted at this step.

The search ran on **land, training half only, with no regional term in the
objective**, so Sahara/Amazon/Australia remain independent diagnostics.
K landing exactly on its upper bound is reported rather than hidden: it means
the fit wants more mixing than the bound allows, which is itself a finding
(see §6).

---

## 4. A / B / C

One transport model, one evaluation path, three wind conditions. Climate
v0.8's field is dimensionless, so it is used for **direction only** and is
never scaled into m/s by a teacher-fitted factor — there is deliberately no
"physical v0.8" case.

| | land r | land MAE | land bias | Amazon/Sahara | Spearman |
| --- | --- | --- | --- | --- | --- |
| control (no transport) | **0.8754** | 3.21 | +2.27 | 1.54 | — |
| **A** direction Stage 4 | 0.7938 | 2.62 | +0.39 | 0.93 | 0.709 |
| **B** direction v0.8 | **0.8401** | **2.36** | **+0.31** | **1.26** | **0.794** |
| **C** physical Stage 4 | 0.8173 | 2.49 | +0.34 | 1.10 | 0.794 |

- **A vs B (direction alone, speed identical): B is better** — land MAE 2.36
  against 2.62, r 0.840 against 0.794. Climate v0.8's zonal trade-wind
  structure moves moisture onto continents where Stage 4's nearly
  meridional tropical flow does not. This was **predicted in advance** from
  Stage 3/4's direction errors (tropics: v0.8 51.1°, Stage 4 125.9°).
- **A vs C (adding Stage 4's own speed): C is better than A** — 2.49 against
  2.62. Stage 4's real m/s field, weak as it is (mean 2.02 m/s), carries
  more information than its direction alone.
- **Transport improves bias and MAE but makes correlation worse.** Every
  condition beats the control on MAE (3.21) and bias (+2.27), and every
  condition is *below* the control on r (0.8754). Transport removes the
  uniform wet bias and adds spatial error.

---

## 5. Declared criteria: 3 / 10, in all three conditions

Set before implementation and **not adjusted afterwards**.

| criterion | control | A | B | C | |
| --- | --- | --- | --- | --- | --- |
| land r ≥ 0.90 | 0.8754 | 0.794 | 0.840 | 0.817 | **FAIL** |
| land MAE ≤ 2.2 | 3.21 | 2.62 | 2.36 | 2.49 | **FAIL** |
| land \|bias\| ≤ 0.8 | 2.27 | 0.39 | 0.31 | 0.34 | PASS |
| Sahara err ≤ +4.0 | +10.52 | +6.79 | +4.94 | +5.76 | **FAIL** |
| Australia err ≤ +4.0 | +8.67 | +6.96 | +6.05 | +6.56 | **FAIL** |
| Amazon \|err\| ≤ 4.0 | +4.36 | −8.29 | −6.83 | −7.50 | **FAIL** |
| Amazon/Sahara ≥ 2.5 | 1.54 | 0.93 | 1.26 | 1.10 | **FAIL** |
| Spearman ≥ 0.80 | — | 0.709 | 0.794 | 0.794 | **FAIL** |
| RH > 1.05 in 0 cells | — | 0 | 0 | 0 | PASS |
| 0 NaN / Infinity | — | 0 | 0 | 0 | PASS |

Nothing was rescued with a threshold change or a regional coefficient.

---

## 6. Why it failed, diagnosed rather than guessed

> **CORRECTED BY STAGE 5B.1.** The claim below that a missing land moisture
> source is "the whole story" is an overclaim and was disproved by the oracle
> test in `docs/climate-v1-moisture-diagnosis-stage5b1.md`. With the real
> observed wind and a physically ordinary diffusivity, the Sahara comes out at
> 4.5 g/kg against the teacher's 4.7 and Australia at 6.7 against 7.1 — no
> recycling required. What survives is a ~21% Amazon deficit. Two further
> errors in the reasoning below: the transect was run at the DEFAULT
> diffusivity rather than the fitted one (at the fitted value the Amazon does
> receive moisture), and holding tau fixed while concluding about the source
> skipped the two terms that actually dominate. The section is kept unchanged
> as the record of what was believed at the time.

**The model has no land moisture source, and that is the whole story.**

A transect along 4°S from the Atlantic into the Amazon, at three residence
times spanning a factor of ten:

| | 34°W | 38°W | 42°W | 46°W | 50°W | 54°W | 58°W | 62°W |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| τ = 3 d | 20.0* | 21.4* | 10.6 | 3.0 | 0.3 | 0.0 | 0.0 | 0.0 |
| τ = 10 d | 20.0* | 21.4* | 11.9 | 3.5 | 0.3 | 0.0 | 0.0 | 0.0 |
| τ = 30 d | 20.0* | 21.4* | 12.4 | 3.7 | 0.4 | 0.0 | 0.0 | 0.0 |

(* = water source cell.)

**The three curves are the same.** A tenfold change in the residence time —
a decay length from 432 km to 12,960 km — moves the interior by nothing.
So the sink is not what dries the continent: **the advection path is.** Air
reaching the Amazon interior has been over land for thousands of kilometres,
and over land this model has no source at all. Roughly half the Amazon's
real moisture is recycled by the forest, and none of that exists here.

That also explains the shape of every failure at once:

- the deserts are still too moist (the τ that would dry them also dries
  everything else, so the fit compromises);
- the Amazon is far too dry (−6.8 to −8.3), the opposite failure;
- so the Amazon/Sahara **contrast** — the one number that captures the whole
  task — goes the *wrong way*, from the control's 1.54 to 0.93–1.26 against
  the teacher's 4.06;
- and correlation falls below the control, because the control's error is a
  uniform offset while this model's is structured.

The searched diffusivity pinning to its upper bound is the same finding from
another direction: the fit is asking for more mixing to spread ocean moisture
inland, because the real inland source is missing.

**A single global τ cannot make the Sahara dry and the Amazon wet.** This was
predicted in the design and is now measured. The fix is a mechanism — land
evapotranspiration, which would put a moisture source on vegetated land — and
not a parameter. It was deliberately **not** added here, because adding it on
discovering the failure is exactly the rescue the brief forbids.

---

## 7. Tests and regression

`node tools/test_moisture_stage5b.mjs` — **32 checks, 32 passing**: the
parameter schema, the water boundary condition, transport direction, downwind
decay, a world with no water (q ≡ 0 exactly), an all-water world, RH ≤ 1 at
the most generous settings, the orographic cap with a synthetic ridge,
direction mode being genuinely speed-blind, a calm cell, bit-identical reruns,
convergence under a 4× sweep cap, required-input errors, and a Mars-sized
planet.

Two tests were wrong on the first run and were corrected rather than the model:
one asserted monotonic decay across the **longitude wrap**, which a periodic
domain forbids (past three quarters of the way round, cells approach the ocean
again from behind); the other compared a ridge's lee at settings where both
sides were zero, so it would have passed without testing anything.

Regression: every Stage 2/3/4/5A/5A.5/5A.6 validator run before and after and
diffed. **Every difference is a timing line.** Stage 5B is purely additive —
no existing file was modified.

---

## 8. Known approximations carried in, not fixed here

Stage 2's regional temperature errors; Stage 4's tropical wind (direction
error 125.9°); the water-surface mask's image-derived origin; the 57 cells
with a non-ocean surface below −200 m; lakes still not moderating temperature
(+2.05 °C); an annual mean that cannot express a monsoon; and now the one
this stage measured — **q is mostly temperature, so a global correlation is
not evidence of anything here.**

`condensationKgPerKg` is an internal diagnostic. It is not a precipitation
rate, is not in kg/m²/s, and is not exported as precipitation.
