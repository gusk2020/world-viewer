# The NCEP 850 hPa oracle-wind fix, and what it changed

## 1. The fix

NCEP/NCAR Reanalysis 1 marks a 850 hPa cell **missing where 850 hPa is below
ground** — Tibet, Greenland, Antarctica, the Andes, the Rockies. Every
diagnostic tool here regridded those 1128 cells as `u = v = 0`. That is not
what "missing" means, and in the Stage 5B solver (`a = |u|/dx`, `b = |v|/dy`,
`K = 0`) a genuinely calm cell has **exactly zero** moisture as its solution
and hands zero to everything downwind.

They are now filled by **harmonic (Laplace) extension** — solve `∇²u = 0`
inside the masked region with the surrounding valid cells as Dirichlet
boundary values, `u` and `v` separately, on the teacher's own 144×73 grid
before any regridding. `tools/ncep_oracle_wind.mjs` is the single
implementation; every oracle-wind tool now imports it.

**Why this method:**
- No free parameter and no tunable shape, so nothing here can be fitted to
  anything.
- The **maximum principle** guarantees filled values lie between the
  surrounding real ones: the fill cannot invent a jet, a reversal or a calm
  the observed field around the hole does not already imply. Confirmed — the
  filled field's maximum speed is 16.42 m/s, in range, and it contains **zero
  calm cells**.
- Purely local and geography-blind: the same operator runs over Tibet,
  Greenland and a one-cell hole, with no region ever named.

**Rejected:** nearest valid cell (picks a direction arbitrarily, leaves a
discontinuity at the hole's edge); the zonal mean at that latitude (a latitude
lookup table, the shape this project forbids); substituting the Stage 4 wind
(mixing the model into its own oracle). Convergence: 992 iterations for u and
921 for v, residual 1e-7 m/s.

## 2. What changed, and what did not

| | contaminated | corrected |
| --- | --- | --- |
| land mean q (g/kg) | 4.577 | **5.047** |
| land q < 0.001 g/kg | 16.5% | **~0%** (no calm cells remain) |
| land RH p10/p25/p50/p75/p90 | 0.000 / 0.000 / 0.180 / 0.577 / 0.803 | **0.000 / 0.005 / 0.281 / 0.624 / 0.821** |
| land RMSE vs teacher (g/kg) | 5.10 | **4.61** |
| land bias vs teacher | −3.23 | **−2.76** |
| Amazon | 15.03 | 15.03 |
| Sahara | 2.88 | 2.88 |
| Australia | 4.46 | 4.46 |
| Amazon/Sahara | 5.22 | 5.22 |
| India / Caspian / Baikal | 10.31 / 6.09 / 0.67 | 10.33 / 6.58 / 0.79 |

**Amazon, Sahara, Australia and their ratio do not move at all**, because
850 hPa is never below ground there — exactly as the dry-tail diagnosis
predicted (those regions had a 0% dry tail). The gain is in the high, cold
places the mask covers, and in the global land aggregate.

**Stage 5B.1's conclusions are unchanged.** With the oracle wind and
diffusion off: Amazon 15.0, Sahara 2.9, Australia 4.5, ratio 5.22 — identical
to the contaminated run, so "even a perfect wind leaves a 3.94 g/kg Amazon
deficit, and the deserts need no recycling" still stands.

**Stage 5C-alpha's identification verdict is unchanged**: the same 2 of 6
probed points are identifiable, both at RHcrit = 0.5. Its own numbers moved
only in the third decimal (RMSE 0.315 → 0.332, r 0.9987 → 0.9985).

**`eddyDiffusivityM2PerS` stays 0** as the production default. `K = 1e3` and
above remain diagnostic cases only.

## 3. What is still wrong

The land RH distribution is better but still far below the teacher's, and the
regions Stage 5C exists for are untouched. The next lever is Stage 2's
temperature — see `docs/climate-v1-temperature-bias-diagnosis-stage2.md`.
