# Climate v1 Stage 5B.2 — the reference transport model

> **Correction (oracle-wind harness fix).** Every NCEP 850 hPa oracle number
> in this document was computed with the teacher's below-ground cells regridded
> as `u = v = 0`, i.e. as dead calm. They are not calm, they are unobserved,
> and in the Stage 5B solver a calm cell with `K = 0` has exactly zero moisture
> as its solution. Those cells are now filled by harmonic (Laplace) extension
> — see `tools/ncep_oracle_wind.mjs` and
> `docs/climate-v1-dry-tail-diagnosis-stage5b.md`. The old numbers are kept
> here as the record; the recomputed ones are in
> `docs/climate-v1-oracle-wind-fix.md`.


Fixes the transport model's baseline form. No vegetation, evapotranspiration
or soil moisture was implemented.

## The diffusivity, chosen without the teacher

`eddyDiffusivityM2PerS` is now **0**, `search: false`.

**Numerical-diffusion overlap.** First-order upwind carries an implicit
diffusion of |u|·dx/2. Measured on this grid: **area-mean 3.41×10⁵ m²/s**
with the observed 850 hPa wind (max 9.58×10⁵), 1.89×10⁵ with Stage 4's. The
scheme is therefore *already* diffusing at 3.4×10⁵.

**Independent physical range.** Large-scale horizontal eddy mixing of
moisture is usually quoted at 1×10⁵–5×10⁵ m²/s. The implicit 3.4×10⁵ sits in
the middle of that band, so explicit diffusion would double-count the same
physics. Effective K ≈ 3.4×10⁵, inside the defensible range, with zero fitted.

**3×10⁶ is rejected.** It is an order of magnitude above any published value
and has no justification independent of the teacher; it was selected purely
because it minimised land MAE, and it flattens the contrast. Per the standing
rule, no independent grounds means no adoption.

`moistureResidenceDays` stays at **8 d**. It came from the same MAE search and
is flagged as such; it is not defended on independent grounds here.

## K candidates, NCEP 850 oracle

| K | land r | MAE | bias | Amazon | Sahara | Australia | ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **teacher** | | | | **19.0** | **4.7** | **7.1** | **4.06** |
| **0 (adopted)** | 0.724 | 3.82 | −3.23 | 15.0 | 2.9 | 4.5 | 5.22 |
| 5×10⁴ | 0.787 | 3.27 | −2.62 | 15.0 | 3.5 | 5.1 | 4.26 |
| 2×10⁵ | 0.821 | 2.75 | −1.85 | 14.9 | 4.5 | 6.7 | 3.29 |
| 6×10⁵ | 0.846 | 2.41 | −0.96 | 14.7 | 5.8 | 9.3 | 2.52 |
| 3×10⁶ (rejected) | 0.860 | 2.30 | +0.47 | 15.0 | 9.6 | 13.3 | 1.57 |

Stated plainly: K = 2×10⁵ would put the deserts nearer the teacher (4.5/6.7
against 4.7/7.1). It is **not** adopted, because choosing it would be fitting
K to those regions — the thing this stage exists to stop. K = 0 leaves the
deserts slightly too dry and the contrast slightly overshooting.

## Winds at the adopted K

| wind | land r | MAE | Amazon | Sahara | Australia | ratio |
| --- | --- | --- | --- | --- | --- | --- |
| NCEP 850 physical (oracle) | 0.724 | 3.82 | 15.0 | 2.9 | 4.5 | 5.22 |
| Stage 4 physical | 0.295 | 4.72 | **0.0** | 4.8 | 9.0 | 0.00 |
| Stage 4 direction | 0.298 | 4.52 | **0.0** | 9.2 | 12.0 | 0.00 |
| v0.8 direction | 0.760 | 2.94 | 8.6 | 6.8 | 8.3 | 1.27 |

**Stage 4's wind cannot transport moisture into the Amazon at all without
explicit diffusion propping it up.** Recorded, not fixed: the wind model is
not being revisited this round. NCEP 850 = diagnostic oracle only; Stage 4 and
v0.8 remain the production candidates.

## The Amazon residual

With the oracle wind and no fitted diffusion: model **15.03** against teacher
**18.97** — a deficit of **3.94 g/kg, 20.8%**, which no wind and no
diffusivity closes. That is the quantified case for considering land moisture
recycling. The deserts need none: Sahara −1.79, Australia −2.61.
