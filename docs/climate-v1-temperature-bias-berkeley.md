# Stage 2 temperature bias, re-measured against the main teacher

Read-only. `temperature.js`, `climate.js`, `evaporative-cooling.js` and every
Climate v1 parameter are unchanged, and nothing is fitted. Tool:
`tools/diagnose_temperature_bias_berkeley.mjs`.

**Main teacher: Berkeley Earth (A).** NCEP 2 m (B) is printed beside every
figure as the independent check. **The earlier NCEP-based numbers
(アマゾン +6.2, コンゴ +5.3, インドネシア +5.0) are retained as NCEP独立検証値
and are no longer the baseline.**

## 1. The new baseline

| band | model | A Berkeley | **bias vs A** | bias vs B | area |
| --- | --- | --- | --- | --- | --- |
| 全球 | 15.5 | 14.9 | **+0.6** | +1.3 | 100% |
| 全球陸 | 9.5 | 9.3 | **+0.2** | +1.2 | 28.9% |
| 全球海 | 17.9 | 17.1 | **+0.8** | +1.3 | 71.1% |
| 熱帯陸 (<23.5°) | 26.0 | 25.2 | **+0.8** | +2.3 | 9.9% |
| 中緯度陸 (23.5–60°) | 9.4 | 10.2 | **−0.8** | −0.1 | 13.1% |
| 高緯度陸 (≥60°) | −17.7 | −19.1 | **+1.4** | +2.4 | 5.9% |

**Globally the model is right.** The whole story is regional, and the signs
are mixed.

## 2. By region

| region | model | A | **bias A** | bias B (check) | z |
| --- | --- | --- | --- | --- | --- |
| **南極** | −26.6 | −34.4 | **+7.8** | +9.0 | 2068 m |
| **グリーンランド** | −24.6 | −18.2 | **−6.4** | −5.1 | 2139 m |
| **チベット** | −8.1 | −2.2 | **−5.9** | −2.0 | 4425 m |
| **ヨーロッパ** | 4.8 | 10.4 | **−5.6** | −3.5 | 305 m |
| アマゾン | 30.9 | 28.0 | **+2.9** | +6.2 | 119 m |
| コンゴ | 28.5 | 26.2 | **+2.3** | +5.3 | 494 m |
| インドネシア | 29.7 | 28.0 | **+1.7** | +5.0 | 238 m |
| シベリア | −7.7 | −9.3 | +1.6 | +0.2 | 528 m |
| オーストラリア | 23.8 | 22.5 | +1.3 | +0.4 | 317 m |
| サハラ | 22.8 | 24.1 | −1.3 | −0.4 | 525 m |
| インド | 24.5 | 25.8 | −1.3 | −0.2 | 387 m |
| 北米内陸 | 4.4 | 4.7 | −0.3 | −0.7 | 841 m |

**The four largest errors are no longer the wet tropics.** They are the two
ice sheets — in **opposite directions** — plus Tibet and Europe.

## 3. What the bias tracks

| by | pattern |
| --- | --- |
| latitude | 0–15 **+1.38**, 15–30 −0.37, 30–45 −0.89, 45–60 −0.84, 60–75 −1.02, **75–90 +6.16** |
| elevation | flat to 2500 m (−0.50 … +0.21), then **2500 m+ +3.61** |
| continentality | −0.34 / +0.25 / +0.83 / −0.13 — no trend |
| land vs sea | land +0.17, sea +0.77 |
| **teacher land cover** | **植生 −0.18, 乾燥地 −0.58, 雪氷 +4.68** |
| model q | +0.60 / −1.43 / −0.26 / +0.57 / +0.83 / **+1.71** |
| teacher q | **+5.26** (0–2) / −1.80 / −1.07 / +0.27 / +0.81 / **+1.76** |

The 0–2 g/kg bin and the 雪氷 class are the same population — polar ice —
and that is now the dominant signal.

## 4. Does the moisture association survive? Partly, at half the size

Tropical land only, so latitude is nearly held fixed:

| teacher q (g/kg) | 2–5 | 5–8 | 8–12 | 12–16 | 16–30 | **span** |
| --- | --- | --- | --- | --- | --- | --- |
| **bias vs A** | −0.72 | −0.42 | +0.12 | +0.84 | **+1.77** | **+2.49** |
| bias vs B | −0.38 | −1.06 | +0.44 | +2.57 | **+4.62** | +5.00 |
| A − B | +0.34 | −0.64 | +0.32 | +1.74 | +2.85 | |

**The ramp is monotonic on A too, so the association is real — but it is
2.0× smaller**, and half of it is "too cold where dry" rather than "too warm
where wet". Outside the tropical binning it nearly disappears: the teacher's
own land-cover proxy separates 植生 from 乾燥地 by only **0.40 °C**.

## 5. The evaporative-cooling preview, judged on A

Unchanged code, unchanged parameters (`evaporativeCoolingC` = 9 when on),
observed wind:

| region | OFF | ON | ΔT | A | bias OFF | **bias ON** | |
| --- | --- | --- | --- | --- | --- | --- | --- |
| アマゾン | 30.9 | 26.0 | −4.9 | 28.0 | +2.9 | **−2.0** | overshoots |
| インドネシア | 29.7 | 26.3 | −3.4 | 28.0 | +1.7 | **−1.7** | overshoots |
| コンゴ | 28.5 | 27.6 | −1.0 | 26.2 | +2.3 | +1.3 | improves |
| オーストラリア | 23.8 | 22.7 | −1.1 | 22.5 | +1.3 | +0.2 | improves |
| サハラ | 22.8 | 22.2 | −0.6 | 24.1 | −1.3 | −1.9 | worse |
| インド | 24.5 | 22.4 | −2.1 | 25.8 | −1.3 | **−3.4** | worse |

**Global land mean |bias| against A: 3.05 → 3.53 °C — it gets worse.**

With the model's **own** (frozen Stage 4) wind it does nothing at all in the
two regions it was built for: アマゾン and コンゴ both hold 0.0 g/kg, so ΔT is
exactly 0.0, while インド is driven to −5.0.

## 6. Verdict on the hypothesis

**Removed from the formal Stage 2 adoption candidates**, per the standing
rule that a weakened selective justification disqualifies it. Four reasons:

1. The target it was built to remove has halved: +1.7…+2.9 °C, not +5…+6.2.
2. At its preview strength it overshoots the two wettest regions to nearly
   equal magnitude on the other side, and **worsens the global land error**.
3. The wetness proxy that owes nothing to either temperature product (the
   teacher's own land cover) sees a 植生/乾燥地 difference of only 0.40 °C.
4. On the production wind it cannot act where it was aimed at all.

A weaker strength would put アマゾン near zero — but a re-tuned coefficient is
not a restored justification, and choosing one against A would be fitting the
mechanism to the teacher rather than deriving it. **The preview itself is
unchanged and stays available, off by default**, as instructed.

## 7. The physics to fix next

The two ice sheets, in opposite directions, which one zonal profile plus one
constant lapse rate cannot produce:

- **南極 +7.8 °C too warm.** The model has **no albedo at all**, so nothing
  makes an ice sheet colder than bare ground at the same latitude and height,
  and its insolation profile is hemispherically symmetric while the real
  southern polar region is far colder than the northern.
- **グリーンランド −6.4 and チベット −5.9 too cold.** Both are high and both
  are given the full 6.5 °C/km. Over an ice sheet the real effective lapse is
  roughly half that, because of the persistent surface inversion; Berkeley's
  Greenland mean implies about 3 °C/km.

Both candidates are keyed to the model's **own** snow/ice state and elevation,
so both would be geography-blind by construction. **ヨーロッパ −5.6** is a
third, separate one: maritime moderation over land, which this model gives
only to sea cells.

Stage 2 itself is unchanged.
