# Climate v1 Stage 5B.1 — separating Stage 5B's failure

Diagnosis only. **No mechanism was added and `js/climate-v1/moisture.js` was
not modified** — every case here is produced by changing the solver's
*inputs*, never its code. Stage 5B's failing result stands unchanged.

Stage 5B's write-up said "the model has no land moisture source, and that is
the whole story." **That was an overclaim, and this round disproves it.**

---

## 1. A / B / C / D / E — identical solver, RH, τ, diffusion and cap

The Stage 5B fit (τ = 8 d, K = 3×10⁶, RH₀ = 0.826) used for every case. D and
E were given no special parameters. Observed winds regridded to 256×128 by
coordinate; the 850 hPa field's below-ground cells (3333) are treated as calm.

| case | land r | land MAE | bias | Amazon | Sahara | Australia | Amazon/Sahara |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **teacher** | | | | **19.0** | **4.7** | **7.1** | **4.06** |
| A direction Stage 4 | 0.794 | 2.62 | +0.39 | 10.7 | 11.5 | 14.0 | 0.93 |
| B direction v0.8 | 0.840 | 2.36 | +0.31 | 12.1 | 9.6 | 13.1 | 1.26 |
| C physical Stage 4 | 0.817 | 2.49 | +0.34 | 11.5 | 10.4 | 13.6 | 1.10 |
| **D direction NCEP 850** | 0.863 | **2.27** | +0.51 | 14.6 | 9.6 | 13.4 | 1.52 |
| **D physical NCEP 850** | 0.860 | 2.30 | +0.47 | **15.0** | 9.6 | 13.3 | **1.57** |
| E direction NCEP 10 m | **0.867** | 2.29 | +0.61 | 14.1 | 10.0 | 12.8 | 1.41 |
| E physical NCEP 10 m | 0.840 | 2.38 | +0.32 | 12.1 | 9.7 | 13.0 | 1.25 |

The real wind moves the Amazon from 10.7 to 15.0 — **a little over half the
way to the teacher** — and barely moves the Sahara at all.

---

## 2. Amazon transects — where the moisture is lost

`q` (g/kg), wind direction and speed, and the split between advective and
diffusive supply, at 4°S and 10°S:

**A, Stage 4 direction, 4°S**

| | 38°W | 46°W | 54°W | 62°W | 70°W |
| --- | --- | --- | --- | --- | --- |
| q | 21.4* | 17.8 | 12.0 | 10.3 | 10.9 |
| advective share | 7% | 6% | 7% | 7% | 8% |
| diffusive share | **93%** | **94%** | **93%** | **93%** | **92%** |

**D, NCEP 850 physical, 4°S**

| | 38°W | 46°W | 54°W | 62°W | 70°W |
| --- | --- | --- | --- | --- | --- |
| q | 21.4* | 19.9 | 17.5 | 15.0 | 13.6 |
| wind speed | 9.2 | 8.3 | 8.3 | 7.7 | 5.7 m/s |
| advective share | 13% | 10% | 12% | 12% | 9% |
| diffusive share | **87%** | **90%** | **88%** | **88%** | **91%** |

**The transport is not advective. At the fitted diffusivity, 87–96% of the
moisture arriving anywhere comes from diffusion.** The whole A/B/C/D/E wind
comparison was therefore run in a regime where the wind is a minority
contributor — which is why every condition landed so close together.

The saturation cap removes **nothing** anywhere on these transects (0.000 at
every point): there is no mountain between the Atlantic and the Amazon, and
the cap is correctly silent.

---

## 3. One factor at a time

Cap cases are built by altering the input `q_sat` on **non-source cells only**,
so the water boundary condition is bit-identical and `moisture.js` is untouched.

| base: D NCEP 850 physical | land r | MAE | bias | Amazon | Sahara | Australia | ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| unchanged | 0.860 | 2.30 | +0.47 | 15.0 | 9.6 | 13.3 | 1.57 |
| τ = 1000 days | 0.860 | 2.65 | +1.59 | 18.9 | 13.6 | 15.4 | 1.39 |
| **diffusion = 0** | 0.724 | 3.82 | −3.23 | **15.0** | **2.9** | **4.5** | **5.22** |
| q_sat cap disabled | 0.865 | 2.33 | +1.12 | 15.7 | 9.7 | 13.3 | 1.63 |
| orographic part of cap off | 0.865 | 2.34 | +1.11 | 15.7 | 9.7 | 13.3 | 1.63 |

With Stage 4's wind instead, `diffusion = 0` gives **Amazon 0.0** — diffusion
had been standing in for a wind that does not blow the right way.

### The sweep that explains everything

Only K moves; base D NCEP 850 physical:

| K (m²/s) | land r | land MAE | bias | Amazon | Sahara | Australia | ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **teacher** | | | | **19.0** | **4.7** | **7.1** | **4.06** |
| 0 | 0.724 | 3.82 | −3.23 | 15.0 | 2.9 | 4.5 | 5.22 |
| 5×10⁴ | 0.787 | 3.27 | −2.62 | 15.0 | 3.5 | 5.1 | 4.26 |
| **2×10⁵** | 0.821 | 2.75 | −1.85 | 14.9 | **4.5** | **6.7** | **3.29** |
| 6×10⁵ | 0.846 | 2.41 | −0.96 | 14.7 | 5.8 | 9.3 | 2.52 |
| 3×10⁶ (the fit) | 0.860 | 2.30 | +0.47 | 15.0 | 9.6 | 13.3 | 1.57 |

At a physically ordinary K = 2×10⁵ with the real wind, **the Sahara comes out
at 4.5 against the teacher's 4.7 and Australia at 6.7 against 7.1** — very
nearly exact. The Amazon sits at 14.9 against 19.0 **at every K**.

**Land MAE and the declared pattern criteria point in opposite directions.**
MAE is best at K = 3×10⁶ (2.30), where the Amazon/Sahara contrast is worst
(1.57); the contrast is best at low K, where MAE is worst. The Stage 5B search
minimised land MAE and therefore chose, correctly by its own objective, the
parameter that destroys the thing the criteria were about. The diffusivity
pinning to its upper bound was the visible symptom.

---

## 4. Verdict against the rules fixed before the run

All four cases fire in part, which is itself the honest answer — this was not
one cause.

- **Case 2 (wind is a main cause): supported.** The observed wind moves the
  Amazon 10.7 → 15.0, over half the remaining gap, and lifts land r from 0.794
  to 0.860. Stage 4's tropical wind is genuinely a major contributor.
- **Case 3 (the solver is a problem): supported, and this was the surprise.**
  Removing one term alone — diffusion — moves the Sahara 9.6 → 2.9 and
  Australia 13.3 → 4.5, and turns the Amazon/Sahara contrast from 1.57 to
  5.22 against a teacher value of 4.06. Not the solver's *form*, but the
  *parameter its objective selected*.
- **Case 1 (recycling): supported, but much smaller than Stage 5B claimed.**
  A residual stands: **the Amazon is 14.7–15.0 against the teacher's 19.0 at
  every diffusivity and with a perfect wind** — about 21% short, and nothing
  in the wind or the numerics closes it. That residual is consistent with
  missing land recycling, which is a real process in that basin.
- **Case 4 (850 hPa vs 10 m): real but secondary.** Physical 850 hPa gives
  Amazon 15.0 against 10 m's 12.1; direction-only they are 14.6 and 14.1.
  A difference worth knowing, not a difference that decides anything.

### The correction to Stage 5B's write-up

Stage 5B concluded that missing evapotranspiration was "the whole story",
resting on a transect where a tenfold change in τ moved nothing. The τ part of
that was right. The conclusion drawn from it was wrong in two ways:

1. That transect was run at the **default** K = 2×10⁵, not the fitted
   K = 3×10⁶. At the fitted value the Amazon does receive moisture (10.3 at
   62°W, not 0.0). "Moisture dies four cells inland" described one diffusivity,
   not the model.
2. Holding τ fixed while concluding about the *source* skipped the two terms
   that actually dominate — the wind and the diffusivity. Both turn out to
   matter more than the missing source does, for the deserts entirely and for
   the Amazon by more than half.

---

## 5. Should land evapotranspiration be the next stage?

**Not first.** It is supported, but it is the smallest of the three effects
and the most expensive to build:

- the **deserts** need no recycling at all — real wind plus a physical
  diffusivity puts them within 0.2–0.4 g/kg of the teacher;
- the **Amazon** needs about 4 g/kg, ~21%, that nothing else supplies;
- and the model currently cannot use a better wind anyway, because Stage 4's
  own field is what condition A measures.

Two cheaper things come first, in this order: **the objective that selects the
transport parameters** (it demonstrably selects against the declared criteria),
and **the wind model** (worth ~4.3 g/kg in the Amazon on its own). Building
recycling on top of a wind that blows the wrong way in the tropics would
attribute the improvement to the wrong mechanism — the failure mode this
project has recorded four times already.

Nothing about vegetation, evapotranspiration, soil moisture or precipitation
recycling was implemented, and no Teacher A/B vegetation information was used
as a moisture source.
