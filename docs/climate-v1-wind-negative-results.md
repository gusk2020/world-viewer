# Climate v1 — what the wind model has been proved *not* to be

Kept so these are not retried. Nothing here is deleted when it fails.

## Stage 4 (the production wind)

Thermal geopotential from the hypsometric relation, plus a linear
momentum balance `u = −(r·Φx + f·Φy)/(f²+r²)`.

**Strengths.** Mid-latitudes are its good half: direction error 35.3°, speed
r = 0.334, and it beats Climate v0.8 clearly in the extratropics. Finite at
the equator by construction. No Earth-specific correction anywhere.

**Weakness, and its single cause.** It assumes the **surface** geopotential
anomaly is zero — uniform surface pressure. The real annual-mean ocean varies
with a standard deviation of **10.09 hPa**; Stage 4 varies by nothing. So it
has no equatorial trough, no subtropical ridges, and therefore no trade
winds: tropical direction error **125.9°**, and the zonal wind over the
tropical Atlantic comes out **+1.51 m/s westerly** where the observed is
**−6.45 easterly**.

## Two attempts to supply that surface field — both 3/6, both rejected

| | tropical dir | mid-lat dir | mid-lat r | vector RMSE | Amazon u |
| --- | --- | --- | --- | --- | --- |
| Stage 4 baseline | 119.0° | 20.2° | −0.294 | 5.691 | +1.51 |
| Hadley, axisymmetric | 62.9° | 77.6° | −0.455 | 10.106 | −3.69 |
| 2-D Gill, zonal only | 62.9° | 77.6° | −0.455 | 10.106 | −3.69 |
| 2-D Gill, longitudinal only | 117.1° | 37.3° | −0.432 | 10.657 | +0.14 |
| 2-D Gill, both | 63.8° | 90.4° | −0.564 | 13.161 | −5.07 |

(This validator's mid-latitude metric differs from
`validate_wind_model_stage4.mjs`'s — 20.2°/−0.294 against 35.3°/0.334 for the
same wind — so compare within the table.)

Both pass the same three criteria (tropical direction, easterly Amazon wind,
Amazon humidity) and fail the same three (mid-latitude direction, mid-latitude
speed correlation, global vector RMSE). **Tropics improve, mid-latitudes
collapse**, at every amplitude and equivalent depth tried.

**The Walker component does not rescue it.** Longitudinal heating alone does
nothing for the tropics (117° against a 119° baseline) and never makes an
easterly; both together are worse than zonal alone outside the tropics. The
design's claim — that zonal structure would confine the response by the
equatorial Rossby radius — is refuted.

## Why, precisely

The Rossby radius confines the **wave response** (c/f ≈ 500 km at 45°). It
does not confine the **forcing**. The spread cooling that balances the
localised heating is applied at every latitude, so the mid-latitudes are
forced directly rather than reached by adjustment. Zonal structure cannot
help: it is zero in the zonal mean by construction, so it never touches the
symmetric part.

## The moisture chain these winds feed

| wind | Amazon specific humidity |
| --- | --- |
| Stage 4 | **0.00 g/kg** |
| Stage 4 + Hadley (best) | **8.62** |
| NCEP 850 oracle | **15.03** |
| teacher | **18.97** |

So wind improvement is worth about 8.6 g/kg of the 19, the remaining gap to
the oracle another 6.4, and a residual **3.94 g/kg (20.8%)** survives even a
perfect wind. Only that last number is evidence for land recycling.

## Why explicit moisture diffusion is K = 0

First-order upwind already carries an implicit diffusion of |u|·dx/2 —
measured **3.41×10⁵ m²/s** area-mean with the observed wind on this grid —
which is already mid-band for the 1–5×10⁵ usually quoted for large-scale
horizontal eddy mixing. Explicit diffusion would double-count it. The
K = 3×10⁶ that Stage 5B's search chose is an order of magnitude above any
published value, was selected only because it minimised land MAE, and
flattened the Amazon/Sahara contrast from 5.22 to 1.57 against a teacher of
4.06. **Choosing K by land MAE is forbidden.**

## Still held back

Land evapotranspiration / moisture recycling (Stage 5C). Justified by the
20.8% residual above, but not first: the production wind delivers 0.00 g/kg
to the Amazon, so recycling built on it would be credited to the wrong
mechanism.

## Defaults

Everything above ships **off**: `heatingResponseStrength`,
`zonalHeatingStrength` and `longitudinalHeatingStrength` all default to 0, so
Stage 4 is returned bit-identical and the Stage 3 baseline still reproduces.
