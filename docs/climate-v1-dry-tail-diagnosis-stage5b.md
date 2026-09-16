# Stage 5B diagnosis — the land q = 0 dry tail

Diagnosis only. No model changed, nothing fitted, no moisture source added.
Every case is one factor changed at a time through arguments
`buildMoistureField` already accepts. Tool:
`tools/diagnose_dry_tail_stage5b.mjs`.

## Correction to the previous round

The Stage 5C RH diagnosis reported "exactly zero humidity over more than a
quarter of the land". That came from an RH percentile printed to three
decimals, which lumps everything below 0.0005 together. Measured directly, the
land area with **q < 0.001 g/kg is 16.5%** under the oracle wind (16.2%
exactly zero), and **8.6% under the shipped Stage 4 wind** (5.2% exactly zero).
Smaller than stated, and — see below — mostly not where it matters.

## 1. Main cause: two of them, and the larger one is my own harness

**Under the NCEP oracle wind, 92.6% of the dry tail is a cell that is itself
exactly calm, and every one of those is a cell NCEP marks as below ground at
850 hPa.** The regridder in the diagnostic tools writes those cells as
`u = v = 0`. In the solver `a = |u|/dx` and `b = |v|/dy`, so with `K = 0` the
numerator is exactly 0 and the cell's solution is exactly 0 — and it then feeds
0 to everything downwind of it, which is the remaining 7.4%.

Geography confirms it outright: **Tibet 100%, Greenland 90%, Antarctica 77%**
dry, against **Amazon 0%, Sahara 0%, Australia 0%, Europe 0%, Congo 0%,
Indonesia 0%, Baikal 0%, Patagonia 0%**. Those are the 850 hPa below-ground
regions exactly.

Filling those cells from the nearest valid wind on the same row instead of
calm: dry tail **16.5% → 5.8%**, exactly-zero **16.2% → 0.8%**, land mean q
4.577 → 5.066 g/kg.

**The residue is a real model property.** The Stage 4 wind has **no calm cells
at all** and still leaves 8.6% dry / 5.2% exactly zero. With `K = 0` the only
path moisture has is advection from a water cell, so any land cell whose
upwind trajectory never reaches water has exactly zero as its *true* solution.

## 2. Numerical or physical?

**Numerical/structural, not physical.** One factor at a time, oracle wind:

| case | dry tail | exactly 0 | land mean q |
| --- | --- | --- | --- |
| reference (tau = 8 d, K = 0) | 16.5% | 16.2% | 4.577 |
| tau = 10⁶ d (sink effectively off) | 16.4% | 16.2% | 8.355 |
| cap off (qsat ×1000) | 16.2% | 16.2% | — |
| uniform land source 1e-12 /s | 16.3% | **0.0%** | 4.577 |
| **K = 1e3 m²/s** | 10.2% | **0.0%** | 4.598 |
| K = 1e4 m²/s | 4.8% | 0.0% | 4.758 |
| K = 1e5 m²/s | 0.4% | 0.0% | 5.519 |
| **masked wind filled, not calm** | **5.8%** | 0.8% | 5.066 |
| resolution 128×64 | 16.8% | 16.7% | 4.326 |
| resolution 512×256 | 17.1% | 16.2% | 4.732 |
| 200 vs 8000 sweeps | max \|Δq\| = **0** | | converged in 27 sweeps |

So it is **not** tau, **not** the saturation cap, **not** resolution, **not**
convergence, and **not** initial-value dependence (the tiny uniform source
removes every exact zero without moving the mean, confirming zero is the
system's true solution there, not an attractor the solver fell into).

It is (a) the below-ground mask written as calm, and (b) `K = 0` leaving a
calm or advectively-isolated cell with no path to any source.

Supporting number: the discrete per-cell retention `a/(a+1/tau)` over land is
p50 = 0.936, p75 = 0.970 — but **p25 and p10 are 0.000**, i.e. a quarter of
land cells retain nothing at all from upwind. That is the calm-cell population,
not a gradual decay.

## 3. Minimal fix candidates

1. **Harness (free, no model change).** Stop regridding NCEP's below-ground
   850 hPa cells as calm in the diagnostic tools. They are not calm; they are
   unobserved. This is a bug in tooling I wrote, and it has been corrupting
   every oracle-wind number in Stages 5B.1, 5B.2, 5C-alpha and 5C.
2. **Model: `eddyDiffusivityM2PerS` default 0 → a small positive value.**
   Stage 5B.2 already measured the **implicit** numerical diffusion of the
   first-order upwind scheme at **3.41×10⁵ m²/s**. An explicit `K = 1e3` is
   **0.3% of diffusion the scheme already carries**, so it is not a new
   mechanism — it only makes a path exist where the wind is zero, which is
   exactly where the implicit term (`K_num = |u|·dx/2`) also vanishes. It
   removes every exact zero while moving the land mean by **+0.5%**
   (4.577 → 4.598).

Both are one-line changes. Neither is a fit and neither adds a source.

## 4. What fixing it would change

- The oracle-wind diagnostics become trustworthy: land mean q 4.577 → ~5.07,
  which closes about 15% of the gap to the teacher's 7.81 g/kg *without any
  new physics* — purely by not treating unobserved wind as still air.
- Exact zeros disappear, so an RH-dependent term (Stage 5C-alpha's `phi`) is no
  longer evaluated against a field containing impossible values.
- **It will not help the regions Stage 5C exists for.** Amazon, Sahara,
  Australia, Europe, India and Indonesia have a 0–3% dry tail. Their humidity
  deficit is untouched by this.

## 5. Order of work

The harness fix should come first because it is free and because it silently
degrades every oracle-wind measurement already recorded. The `K` default is a
real change to Stage 5B's shipped output and is the user's call.

Neither should displace **Stage 2's wet-tropics warm bias** (+6.2 °C in the
Amazon, 60% of that region's RH deficit): the dry tail and the Amazon deficit
are disjoint problems, and the Amazon one is the larger lever for what Stage
5C was aiming at.
