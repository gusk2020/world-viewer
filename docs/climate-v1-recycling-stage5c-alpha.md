# Stage 5C-alpha — the RH-dependent recycling hypothesis, and its identification test

No parameter was fitted. The wind model, the humidity model and Stage 5B's
transport equation are unchanged, and `js/climate.js` (what the app draws) was
not touched. Verification runs on the **NCEP 850 hPa oracle wind**, so nothing
here can be hiding a defect in the frozen Stage 4 wind.

## What the hypothesis is, and what it is not

`phi(RH)` is **a hypothesis approximating the recyclable, condensing share of
Stage 5B's lumped removal term**. It is not precipitation, not soil moisture,
not vegetation, and not a land water reservoir. Nothing here is in kg/m²/s and
nothing integrates a store over time.

```
phi_i = smoothstep(RHcrit, RHcrit + 0.15, q_i / qsat_i)
E_i   = min( f * phi_i * q_i / tau ,  (RH0*qsat_i - q_i)+ / tau_et )
```

The physical statement: removal close to saturation is mostly condensation
(reaches the surface, can evaporate again); removal far from saturation is
mostly mixing with drier air aloft (never reaches the ground).

## Why the plain version was rejected first, in algebra

Returning a constant fraction of a term linear in `q` only rescales it:

```
-q/tau + f*(q/tau) = -(1-f)*q/tau      =>  tau_eff = tau/(1-f)
```

So the recyclable share had to depend on something other than q's amplitude.
`phi(RH)` makes `tau_eff = tau/(1 - f*phi_i)` vary across the map with the
model's own humidity, which no single tau can reproduce — **in principle**.
Whether it does so *measurably* is what this stage tests.

Two structural bounds, neither tuned: supply (`E <= f *` what the removal
took, so no water is created) and demand (`E <=` what the air can still hold
below `RH0*qsat`, so a hot dry cell evaporates nothing). The outer iteration's
gain is at most `f < 1`, so it cannot diverge.

## The test, declared before the run

Scan plain Stage 5B's `tau'` for the value whose global land mean matches the
recycling run's, then ask whether the **pattern** still differs.
Identifiable iff, at that `tau'`: |Δ(Amazon/Sahara)| ≥ 0.20 **and** land RMSE
between the two fields ≥ 0.30 g/kg **and** their land correlation < 0.999.

## Result — identifiable, but only in the bottom of the parameter's range

| f | RHcrit | E/removal | Amazon | Sahara | ratio | best tau' | Δratio | RMSE | r | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | Stage 5B | — | 15.03 | 2.88 | 5.22 | 8.0 | — | — | — | baseline |
| 0.3 | 0.8 | **0.000** | 15.03 | 2.88 | 5.22 | 8.0 | 0.000 | 0.001 | 1.0000 | not identified |
| 0.5 | 0.8 | **0.000** | 15.03 | 2.88 | 5.22 | 8.0 | 0.000 | 0.001 | 1.0000 | not identified |
| 0.5 | 0.7 | 0.014 | 15.10 | 2.89 | 5.23 | 8.0 | 0.010 | 0.044 | 1.0000 | not identified |
| 0.5 | 0.6 | 0.076 | 15.62 | 2.91 | 5.37 | 8.5 | 0.267 | 0.173 | 0.9997 | not identified |
| 0.5 | **0.5** | 0.159 | **16.66** | 2.95 | 5.65 | 9.5 | 0.737 | 0.315 | 0.9987 | **IDENTIFIABLE** |
| 0.8 | **0.5** | 0.183 | 17.06 | 2.96 | 5.76 | 10.0 | 0.927 | 0.362 | 0.9982 | **IDENTIFIABLE** |
| | teacher | | 18.97 | 4.67 | 4.06 | | | | | |

**The cause of the split is measured, not guessed.** Stage 5B's own land
relative humidity is: p50 = 0.180, p75 = 0.577, p90 = 0.803. Land area above
0.8 is **9.0%**, above 0.7 **17.3%**, above 0.5 **34.6%**. A critical humidity
anywhere in the standard 0.7–0.95 range therefore leaves the mechanism with
almost no land to act on, and it is inert — the fourth inert term this project
has recorded (after `evaporationHalfC`, `advectionRangeKm` and
`monsoonStrength`).

**The discrimination is real where it acts.** At f = 0.5, RHcrit = 0.5 the
Amazon gains **+1.63 g/kg** while the Sahara gains **+0.07**; the tau' that
matches the same global land mean gains **+0.82 in the Amazon and +0.34 in the
Sahara**. That is exactly the wet/dry separation a single tau cannot give, and
it is the first mechanism in this pipeline to produce it. Global land bias
improves −3.23 → −2.92 g/kg and land RMSE 5.10 → 4.96.

## Honest limits

- **Identifiability sits at the edge of the declared range.** RHcrit = 0.5 is
  the bottom bound, and at 0.6 the test already fails (RMSE 0.173 < 0.30).
  Whether 0.5 still deserves the name "critical humidity" is arguable; it is
  reported as the condition for identifiability, not as a chosen value.
- **The margin is thin**: r = 0.9987 against a threshold of 0.999.
- **Amazon is not solved.** 15.03 → 16.66 closes 41% of the 3.94 g/kg gap at
  the identifiable point; the teacher is 18.97.
- **Sahara and Australia are still too dry, not too wet.** Recycling moves
  both slightly in the right direction (2.88 → 2.95, 4.46 → 4.89).
- Baikal (0.67 against 4.73) and Europe (3.66 against 6.77) are untouched by
  this mechanism and remain the largest regional errors.

## Budget and stability, checked every run

`E/removal` never exceeded `f` (the tool throws if it does). The outer loop
converged in 4–28 passes at every point. Zero non-finite cells.

## Regression

`landRecyclingFraction = 0` is **bit-identical** to Stage 5B: the q and RH
hashes match `buildMoistureField`'s own output exactly, and so does an
explicit all-zero source array. Stage 5B's own validator, the Stage 0-1
diagnosis and all 160 unit tests pass unchanged.

`moisture.js` gained one optional argument (`landSourceKgPerKgPerS`, null by
default) which enters the same numerator as advection and diffusion. Its
equation is otherwise untouched.

## Next decision

The identification test passes, so a parameter search is *permissible* — but
the result says the more useful question first is why the model's land air is
so far from saturation that a standard critical humidity has nothing to act
on. **No fit was run**, per the brief.
