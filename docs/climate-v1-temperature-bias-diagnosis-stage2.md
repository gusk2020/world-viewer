# Stage 2 diagnosis — what makes the model's wet tropics too warm

Diagnosis only. `temperature.js` and `climate.js` are unchanged and nothing is
fitted. Teacher: NCEP 2 m air temperature. Tool:
`tools/diagnose_temperature_bias_stage2.mjs`.

## The decomposition is exhaustive, not a survey

The model's land temperature is one line (`surfaceAnnualTemperatureC`):

```
land: T = seaLevelC(lat) - lapseRateCPerKm * z/1000
sea:  T = meanC + oceanModeration * (seaLevelC(lat) - meanC)
```

Over land there is **no ocean moderation, no continentality, and no surface
energy balance of any kind**. Only two terms exist, so listing them is a
complete account.

## 1. It is not a global offset

Global bias: **land +1.22 °C, sea +1.30 °C**. The model's overall level is
close to right; the error is in its *distribution*.

## 2. It is a function of how wet the place is — measured against the teacher's own q

Land bias binned by the **teacher's** specific humidity (independent data,
not the model's own moisture):

| teacher q (g/kg) | land bias | area | mean \|lat\| | mean z |
| --- | --- | --- | --- | --- |
| 0–2 | +6.44 | 11.1% | 76.0° | 1893 m |
| 2–5 | −0.97 | 27.2% | 50.2° | 877 m |
| 5–8 | −0.68 | 24.3% | 37.9° | 624 m |
| 8–12 | +0.74 | 13.5% | 23.6° | 665 m |
| 12–16 | +2.49 | 12.9% | 15.1° | 544 m |
| **16–30** | **+4.60** | 11.1% | 6.7° | 277 m |

**Holding latitude nearly fixed — tropical land only (|lat| < 23.5°) — the
same monotonic ramp survives**: q 5–8 → **−1.06**, 8–12 → +0.44, 12–16 →
+2.57, 16–30 → **+4.62**. So it is not a latitude effect in disguise.

(The 0–2 bin is Antarctica, Greenland and Tibet: polar, high, and a separate
problem from this one.)

## 3. It is not continentality, and not the lapse rate

Distance to open water: bias 0.88 (0–2 cells) → 1.24 → 1.76 → 0.84 — weak and
non-monotonic. Elevation: −0.05 to +1.71 across every band below 3000 m, and
only +4.15 above 3000 m, which is the same polar/Tibet population as above.
Neither term explains the tropical signal.

## 4. Per region, term by term

| region | seaLevelC | −lapse·z | model T | teacher T | bias | z | teacher q |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Amazon** | 31.7 | −0.8 | 30.9 | 24.7 | **+6.2** | 119 m | 19.0 |
| **Congo** | 31.7 | −3.2 | 28.5 | 23.2 | **+5.3** | 494 m | 17.6 |
| **Indonesia** | 31.7 | −1.5 | 29.7 | 24.7 | **+5.0** | 238 m | 19.0 |
| Sahara | 26.0 | −3.4 | 22.8 | 23.2 | −0.4 | 525 m | 4.7 |
| Australia | 26.1 | −2.1 | 23.8 | 23.4 | +0.4 | 317 m | 7.0 |
| India | 26.9 | −2.5 | 24.5 | 24.7 | −0.2 | 387 m | 12.5 |
| Europe | 6.2 | −2.0 | 4.8 | 8.3 | −3.5 | 305 m | 6.8 |
| Caspian | 14.1 | −3.0 | 11.6 | 12.5 | −0.9 | 465 m | 6.3 |
| Baikal | 3.3 | −5.2 | −1.0 | −2.1 | +1.1 | 798 m | 4.8 |

The three worst are the three wettest, and every dry region at the same
latitudes is within half a degree. **Congo confirms it is not a South America
artefact.**

## 5. A latitude-only change cannot fix it

In the 8°S–2°N band: land bias **+4.97 °C**, the Amazon box **+6.21 °C**, and
the **sea in the same band only +1.98 °C**. Any change to `seaLevelC(lat)`
moves land and sea together, so making the Amazon right would push that band's
ocean about 3 °C too cold. The 1.24 °C between the band and the Amazon box is
longitudinal and no zonal profile can reach it at all.

## 6. Main cause

**The absence of evaporative cooling — there is no land surface energy balance
in the model at all.** Real wet tropical land is held near the wet-bulb
temperature by evapotranspiration; this model hands every land cell the
sea-level zonal temperature minus a lapse rate, so wet land runs ~5 °C hot
while dry land at the same latitude is right to within half a degree. The
secondary term is the zonal profile itself, ~+1.3 to +1.9 °C too warm in the
tropics (visible in the sea bias, which has no land terms at all).

## 7. Should Stage 2 be fixed, and what would it buy?

It is the correct next target: it is real missing physics, it is measurable
against independent data, and it needs no region, latitude or teacher lookup —
a wet-bulb-style cooling keyed on the model's own moisture would be
geography-blind by construction.

**But be exact about what it buys.** Cooling the Amazon lowers its `q_sat`,
which raises its RH — that is 60% of the Amazon's *RH* deficit. It does
**not** raise its `q`: the 3.94 g/kg absolute humidity gap is untouched. And
it introduces a coupling (temperature → q_sat → moisture → temperature) that
the pipeline has so far kept strictly one-way, which is a design decision, not
a detail.
