# Stage 5C-wind — Hadley surface pressure: a measured negative

Built, measured, **not adopted**. `heatingResponseStrength` defaults to **0**,
so Stage 4 is returned bit-identical and nothing in production changes.

## The model

Stage 4 assumes the surface geopotential anomaly is zero — uniform surface
pressure — which is exactly the equatorial trough and subtropical ridges
thrown away. This adds the missing mass equation:

```
r·Φ + c²·div(u) = −Q
```

With Q the **zonal mean only**, every zonal derivative vanishes and the
Matsuno–Gill problem collapses exactly to a 1-D ODE in latitude, solved by one
tridiagonal sweep. The axisymmetric form was adopted on the merits: identical
answer, far less machinery, and no asymmetric-Q input inviting a Walker
response this stage is not doing.

**Q was mis-specified on the first attempt.** Using the plain temperature
anomaly makes cooling proportional to how cold a latitude is, which forces one
pole-to-equator overturning with no subtropical ridge — measured: easterlies at
*every* latitude, ±45–70 hPa. Corrected to the standard shape for this class of
model: **localised heating (the positive anomaly only), spread cooling**. Where
the heating sits is decided by the planet's temperature field, not a latitude.

## Result — 3 of 6

| | Stage 4 | +Hadley (best, H=100 A=2) |
| --- | --- | --- |
| tropical direction error | 119.0° | **63.0°** ✅ |
| Amazon-box zonal wind | +1.51 (westerly) | **−3.57 easterly** ✅ (teacher −6.45) |
| Amazon q, Stage 5B unchanged | 0.00 | **8.48 g/kg** ✅ (teacher 18.97) |
| mid-latitude direction error | 20.2° | 78.7° ❌ |
| mid-latitude speed r | −0.294 | −0.455 ❌ |
| global vector RMSE | 5.691 | 10.066 ❌ |

The intended mechanism works: an equatorial low, trade-wind easterlies, and
moisture reaching the Amazon for the first time — from mass conservation, with
no trade-wind term written anywhere.

## Why it is not adopted, and the design claim it refutes

The design argued the response would be **confined to the tropics by the
equatorial Rossby radius, so the mid-latitudes would be untouched with no
latitude switch needed**. That is true of the *2-D* Gill response to zonally
structured heating. **It is false for an axisymmetric forcing**: with ∂/∂x = 0
there is no equatorial wave trapping, and the mass adjustment spreads to every
latitude. Measured, the amplitude the tropics need (A = 2) triples the global
vector error; the amplitude the mid-latitudes tolerate (A = 0.5) barely moves
the tropics.

A single global amplitude cannot serve both. Making the amplitude
latitude-dependent would be the latitude lookup table that is forbidden, so
nothing was rescued.

Harness note: this validator's mid-latitude metric differs from
`validate_wind_model_stage4.mjs`'s (20.2°/−0.294 against 35.3°/0.334 for the
same wind), so the comparison above is against its own baseline, not the
published one.

## What would be needed

Zonal structure in Q — i.e. the Walker component — is what confines the
response and makes the trapping argument valid. That is the next stage, and
this result is the argument for it rather than against it.
