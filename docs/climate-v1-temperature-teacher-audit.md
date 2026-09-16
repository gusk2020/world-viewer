# Two temperature teachers — audit

Read-only. Nothing fitted, no teacher file written, no model changed. Tool:
`tools/audit_temperature_teachers.mjs`.

## 1. What each one is

| | **A** `temperature-annual-mean-c.bin` | **B** `humidity-airTemperatureC.bin` |
| --- | --- | --- |
| product | **Berkeley Earth** Land+Ocean gridded temperature | **NCEP/NCAR Reanalysis 1**, `air.2m` monthly LTM |
| kind | **observational** — land cells are ~2 m air temperature from *station* data; ocean cells are SST on an air-temperature-equivalent basis | **model reanalysis** — a forecast model's own 2 m field, constrained by assimilated observations |
| period | **1991–2020** (absolute = Berkeley's 1951–1980 baseline + mean anomaly over the period) | **1981–2010** |
| grid | 360×180, regular 1°, cell-centred (row 0 = 89.5 N, col 0 = −179.5) | 192×94, **T62 Gaussian** (row 0 = 88.542 N, unevenly spaced) |
| missing | NaN, **21 cells** | none |
| land/sea | one blended field, no mask; land/sea comes from the elevation raster on our side | one field, no mask |
| built by | `tools/build_temperature_teacher.py` | `tools/build_humidity_teacher.py`, as an input to the humidity teacher |
| licence | CC BY-NC 4.0 (attribution, non-commercial) | public domain (NOAA PSL) |

Both are resampled the same way for this comparison — nearest cell by
coordinate onto one 256×128 grid, cos(lat)-weighted — so the numbers below
differ only because the fields differ.

## 2. The same places, the same cells

| region | A Berkeley | B NCEP 2 m | A−B | model | m−A | m−B |
| --- | --- | --- | --- | --- | --- | --- |
| **アマゾン** | 28.0 | 24.7 | **+3.3** | 30.9 | **+2.9** | +6.2 |
| **コンゴ** | 26.2 | 23.2 | **+3.0** | 28.5 | +2.3 | +5.3 |
| **インドネシア** | 28.0 | 24.7 | **+3.3** | 29.7 | +1.7 | +5.0 |
| サハラ | 24.1 | 23.2 | +0.9 | 22.8 | −1.3 | −0.4 |
| オーストラリア | 22.5 | 23.4 | −1.0 | 23.8 | +1.3 | +0.4 |
| インド | 25.8 | 24.7 | +1.1 | 24.5 | −1.3 | −0.2 |
| ヨーロッパ | 10.4 | 8.3 | +2.1 | 4.8 | **−5.6** | −3.5 |
| グリーンランド | −18.2 | −19.6 | +1.3 | −24.6 | **−6.4** | −5.1 |
| チベット | −2.2 | −6.1 | **+3.9** | −8.1 | **−5.9** | −2.0 |
| **全球陸平均** | **9.3** | **8.3** | **+1.0** | 9.5 | **+0.2** | +1.2 |
| 全球海平均 | 17.1 | 16.6 | +0.5 | | | |

## 3. Why about 3 °C in the Amazon

**It is not a constant offset and not a regridding artefact.** Within the
Amazon box alone the gap runs from −1.3 to **+5.2 °C** cell by cell, and
globally only 15.6% of land agrees to within 0.5 °C while 12.5% differs by
more than 4.

**It tracks moisture, measured.** Binned by the teacher's own specific
humidity, over **tropical land only** (so latitude is held nearly fixed):

| teacher q (g/kg) | 2–5 | 5–8 | 8–12 | 12–16 | **16–30** |
| --- | --- | --- | --- | --- | --- |
| A−B (°C) | +0.34 | −0.64 | +0.32 | +1.74 | **+2.85** |

So the two products agree over dry tropical land and diverge steadily as the
land gets wetter, reaching ~3 °C over rainforest. That is the signature of a
**reanalysis land-surface/evaporation behaviour**, not of a difference in
definition: NCEP/NCAR R1's 2 m temperature is a model field whose known
weakness is exactly the tropical-forest surface energy balance, while
Berkeley's tropical land values come from stations.

**The period explains only a small part.** A is 1991–2020 and B 1981–2010, a
decade later; over land that is worth a few tenths of a degree, which is
roughly a third of the **+1.0 °C global land** gap and nothing like the
**+3.3 °C** in the Amazon.

**Two things this audit does not claim.** It does not establish from this
repository's data which product is closer to reality in any one place — only
that they differ, and how that difference is structured. And the "reanalysis
land-surface" reading is the products' documented natures, not something
measured here.

## 4. Roles

**主Teacher（年平均地表気温）= A, Berkeley Earth.** Reasons, in order:

1. Climate v1's temperature stage is a *model*, and it must not be scored
   against another model's output when an observational product is available.
   B is a reanalysis; A's land values are station observations.
2. A is what `build_temperature_teacher.py` exists to produce and what its own
   note says it is for.
3. It is an absolute climatology with a documented baseline, and it covers the
   whole surface with one consistent convention.

**独立検証Teacher = B, NCEP 2 m.** Keeping it is not a courtesy: a second,
independently produced field is how a teacher's own error gets caught, and
this audit is the example.

**One rule that is not optional.** Wherever temperature is combined with the
**NCEP humidity** teacher — relative humidity, q_sat, the saturation deficit —
**B must be used, not A.** Those are ratios of two fields, and mixing two
products with a 3 °C tropical offset would make the ratio meaningless. The
Stage 5C RH diagnosis already used B throughout, which was right, and should
stay that way.

## 5. What this does to the Stage 2 bias

The Stage 2 warm-bias diagnosis
(`docs/climate-v1-temperature-bias-diagnosis-stage2.md`) used **B**. On **A**
it is materially smaller, and the shape of the problem changes:

| | against B (as published) | against A (main teacher) |
| --- | --- | --- |
| アマゾン | +6.2 | **+2.9** |
| コンゴ | +5.3 | +2.3 |
| インドネシア | +5.0 | +1.7 |
| 全球陸平均 | +1.2 | **+0.2** |
| ヨーロッパ | −3.5 | **−5.6** |
| チベット | −2.0 | **−5.9** |
| グリーンランド | −5.1 | **−6.4** |

The wet-tropics warm bias is **roughly halved and still real**, while three
large **cold** biases (ヨーロッパ, チベット, グリーンランド) grow and become
comparable in size. **The measured association between the bias and moisture
must be re-derived on A before any Stage 2 change**: that association was
measured against the field which is itself coldest exactly where the land is
wettest, so part of what looked like a model error is the teacher's.

Stage 2 itself is unchanged, as instructed.
