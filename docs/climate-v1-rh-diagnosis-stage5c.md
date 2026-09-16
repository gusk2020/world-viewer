# Stage 5C diagnosis — why the model's land relative humidity is so low

Diagnosis only. Nothing fitted, no mechanism added, no model changed. The
teacher's own RH is built from the teacher's own q, T and p through the **same
Stage 5A formulas** the model uses, so the two sides differ only in inputs.
Wind is the NCEP 850 hPa oracle, so nothing here depends on the frozen Stage 4
wind.

## Verdict: B, with C in the wet tropics

The question was whether RHcrit ≈ 0.5 is physical (A), or whether Stage 5B is
simply drying the land too much (B), or whether temperature/q_sat is the cause
(C), or transport/q (D).

**A is refuted.** On tropical land — the only place an annual-mean ratio is
trustworthy (see below) — the teacher's RH is p50 **0.750**, p75 0.886, p90
0.967, mean 0.692. The model is p50 0.409, p75 0.623, mean 0.400. The real
atmosphere is not at 0.5 where it is humid; the model is.

## 1. Land RH distributions (area-weighted p10/p25/p50/p75/p90)

| | p10 | p25 | p50 | p75 | p90 |
| --- | --- | --- | --- | --- | --- |
| model, NCEP oracle wind | 0.000 | 0.000 | 0.180 | 0.577 | 0.803 |
| model, Stage 4 wind | 0.001 | 0.062 | 0.329 | 0.670 | 0.894 |
| teacher | 0.484 | 0.793 | 1.175 | 1.562 | 2.360 |
| **tropical land, teacher** | 0.280 | 0.517 | **0.750** | 0.886 | 0.967 |
| **tropical land, model** | 0.042 | 0.170 | **0.409** | 0.623 | 0.719 |

**The model produces exactly zero humidity over more than a quarter of the
land** (p25 = 0.000). Reality never does — the teacher's driest decile is 0.48.
That is a structural fact about Stage 5B, not a tuning error.

## 2. How far the teacher's annual-mean ratio can be trusted

`q_sat` is convex in temperature, so `q_sat(mean T) < mean(q_sat(T))`: wherever
the season swings, `q / q_sat(mean T)` is inflated and can exceed 1, which no
instantaneous RH can. Measured: it exceeds 1 over **35.6% of land** and 8.8% of
ocean. Both sides of every comparison here are computed the same way, so the
*gap* is fair everywhere — but the teacher's **absolute** value is only
meaningful where the seasonal swing is small, which is why the tropical rows
above carry the verdict.

## 3. Decomposition: ln(RH_m/RH_t) = ln(q_m/q_t) − ln(qsat_m/qsat_t)

| bin | ln RH | ln q | −ln qsat | q share | qsat share |
| --- | --- | --- | --- | --- | --- |
| dry (teacher RH<0.4), 12.1% of land | −0.686 | −0.755 | +0.069 | 92% | 8% |
| middling (0.4–0.6), 12.0% | −0.934 | −0.950 | +0.016 | 98% | 2% |
| humid (≥0.6), 75.9% | −1.248 | −1.152 | −0.096 | 92% | 8% |
| **ALL LAND** | **−1.131** | **−1.072** | −0.059 | **95%** | 5% |

Globally the gap is **95% a water deficit**: land-mean q is **4.58 g/kg against
the teacher's 7.81** — the model holds 41% less water over land. `q_sat` is
slightly *too large* (12.20 vs 11.22), so it cannot be the main cause.

**But per region the answer flips in the wet tropics:**

| region | ln RH | q share | qsat share | T model | T teacher |
| --- | --- | --- | --- | --- | --- |
| **Amazon** | −0.609 | 40% | **60%** | **30.9** | **24.7** |
| **Indonesia** | −0.252 | 44% | **56%** | 28.9 | 26.5 |
| Europe | −0.382 | 71% | 29% | 4.7 | 8.6 |
| Sahara | −0.794 | 97% | 3% | 22.8 | 23.2 |
| Australia | −0.897 | 98% | 2% | 23.8 | 23.5 |
| India | −0.793 | 96% | 4% | 25.2 | 25.6 |
| Baikal | −2.512 | 95% | 5% | −0.8 | −2.2 |
| Caspian | −0.378 | 97% | 3% | 13.5 | 13.8 |
| Patagonia | +0.047 | 64% | 36% | 6.8 | 6.0 |

The Amazon is **+6.2 °C too warm**, which inflates its q_sat from 19.59 to
28.25 g/kg (+44%) and by itself accounts for 60% of its RH deficit. Indonesia
is +2.4 °C, 56%. Global land temperature bias is only +1.22 °C and global
pressure bias +1.5 hPa (Stage 5A already measured that as small), so this is a
**wet-tropics temperature problem, not a global one**.

## 4. tau cannot produce the teacher's distribution either

A sweep (not a fit — nothing is chosen from it):

| tau (d) | p10 | p25 | p50 | p75 | p90 | mean RH | land>0.7 | land>0.8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 0.000 | 0.000 | 0.064 | 0.406 | 0.698 | 0.259 | 9.2% | 5.0% |
| 8 (shipped) | 0.000 | 0.000 | 0.180 | 0.577 | 0.803 | 0.353 | 17.3% | 9.0% |
| 16 | 0.000 | 0.000 | 0.317 | 0.698 | 0.874 | 0.441 | 27.7% | 14.7% |
| 32 | 0.000 | 0.000 | 0.424 | 0.774 | 0.922 | 0.507 | 39.5% | 22.8% |
| 64 | 0.000 | 0.000 | 0.503 | 0.828 | 0.957 | 0.550 | 47.9% | 29.8% |
| 128 | 0.000 | 0.000 | 0.551 | 0.848 | 0.974 | 0.574 | 51.6% | 33.5% |
| teacher | 0.484 | 0.793 | 1.175 | 1.562 | 2.360 | 0.955 | | |

Sixteen times the residence time moves the median from 0.18 to 0.55 and leaves
**p10 and p25 at exactly zero**. The dry tail is not a tau problem: it is the
absence of any moisture source away from open water.

## 5. Can RHcrit = 0.5 be accepted?

**No.** It is not a statement about condensation physics; it is the threshold
at which a hypothesis about condensation starts intersecting a humidity field
that is uniformly too dry. Fitting it would tune one model's error against
another's.

## 6. Can Stage 5C proceed to a fit?

**No — NOT_READY.** Two things come first, in this order:

1. **The dry tail.** A quarter of the land at q = 0 exactly. Nothing about
   recycling, and no value of tau, changes that; it is the transport model
   having no source anywhere but open water. This is also exactly what would
   make a recycling term look useful for the wrong reason.
2. **The wet-tropics warm bias.** +6.2 °C in the Amazon and +2.4 °C in
   Indonesia, inflating q_sat by 44% and 15%. That belongs to Stage 2's
   temperature field, not to any humidity stage, and it is the larger half of
   the Amazon's RH deficit — the very region Stage 5C exists to fix.

Stage 5C-alpha stays where it is: implemented, off by default
(`landRecyclingFraction = 0`, bit-identical to Stage 5B), conditionally
identified, and not fitted.
