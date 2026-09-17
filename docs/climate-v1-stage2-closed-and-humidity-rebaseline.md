# Stage 2 closed, and Stage 5A/5B re-baselined on the 5.2 temperature field

Two things in one round, both diagnosis only. No physics file changed:
`temperature.js`, `humidity.js`, `moisture.js`, `wind.js` and
`evaporative-cooling.js` are untouched, nothing was fitted, and the
experimental evaporative cooling stays OFF by default.

Tools: `tools/rebaseline_humidity.mjs` (this round),
`tools/validate_surface_lapse.mjs` (the 5.2 change itself).

## 1. Stage 2 is closed for now

**Closed means: as far as the current simple model and its existing inputs can
go. It does not mean Earth's temperature is reproduced.** `surfaceLapseRateCPerKm`
stays at 5.2.

The residual stock-take that justified closing it (against Berkeley Earth,
cos-lat weighted):

| | mean bias | mean \|bias\| | land area |
| --- | --- | --- | --- |
| 全球陸 | +1.20 | 3.19 | 100% |
| 雪氷セル除外 | +0.42 | **2.49** | 88.7% |
| 非雪氷陸 かつ 保留3地域除外 | +0.55 | **2.42** | 86.4% |
| さらに高緯度3ブロックも除外 | +0.79 | **2.03** | 73.0% |

**The 1500 m+ positive bias is Antarctica, not high ground.** In the
1500-3000 m band Antarctica contributes +4.04 of the band's +3.88 mean; in the
3000 m+ band, +7.80 of +7.87. Remove ice cells and those bands read **+0.27
(MAE 2.22)** and **+0.29 (MAE 1.69)** -- 3000 m+ is then the *best* elevation
band there is. Ice cells are 11.3% of land and 30.9% of the land MAE;
Antarctica alone is 9.3% of the area and 28.7% of the MAE.

**No general variable is left to explain the rest.** Over the workable domain
(non-ice land, held-over regions excluded, 86.4% of land, MAE 2.42):

| variable | r | R² |
| --- | --- | --- |
| coast distance | +0.044 | **0.002** |
| elevation | +0.001 | **0.000** |
| \|latitude\| | −0.362 | 0.131 |
| model temperature | +0.350 | 0.123 |
| seasonal amplitude | −0.351 | 0.123 |
| teacher q | +0.303 | 0.092 |
| model q | +0.215 | 0.046 |

Elevation at R² = 0.000 is the statement that 5.2 finished that job.
Continentality is dead at 0.002 **and its sign reverses** -- inland minus
coastal is +1.44 at 35-66N and −1.57 in the subtropics, so one coefficient
cannot serve both. The top three are the same variable (latitude) wearing
three hats, and `polarExtraC` / `insolationSensitivityC` already carry it. All
six fitted jointly give R² = 0.143; perfectly removing them is an upper bound
of MAE 2.42 → 2.08.

The largest coherent errors left are the parked ones, and bigger than the old
boxes said: 北大西洋側 45-75N/10W-60E is **−6.25** (12.7% of the workable
error on 4.9% of the area), its 60-75N part **−9.84**; 北東アジア 40-60N is
**+4.52** (9.5%), the opposite sign at the same latitude.

**Held over, to resume when the model hierarchy goes up** -- none of these is
"unsolvable", each was measured and parked:

- 南極・グリーンランド等の氷床放射
- 北大西洋側の海洋熱輸送
- SST の経度構造
- 海流 / AMOC
- 雪氷アルベドの本格的なエネルギー収支

## 2. What 5.2 did to Stage 5A

All teachers here are NCEP (q, 2 m temperature, surface pressure). Berkeley
Earth is Stage 2's temperature teacher and is never mixed into a ratio.

| land mean | 6.5 | 5.2 | Δ | teacher |
| --- | --- | --- | --- | --- |
| surface pressure hPa | 925.38 | 925.70 | +0.33 | 923.91 |
| … above 1500 m | 725.97 | **727.65** | +1.68 | **732.55** |
| q_sat g/kg | 12.20 | 12.75 | +0.56 | 11.22 |
| … above 1500 m | 4.18 | 5.15 | +0.97 | 4.52 |
| … tropical land | 22.67 | 23.55 | +0.88 | 19.71 |
| surface temperature °C | 9.50 | 10.53 | +1.03 | 8.28 |

**Pressure moved toward the teacher at altitude** (6.6 hPa low → 4.9 hPa low),
which is the expected consequence of a warmer column thinning less.
**q_sat moved away**, land bias +0.98 → +1.53 g/kg, because the model's land is
now warmer. By band, the q_sat bias goes 1.60 → 1.87 (0-500 m), 0.50 → 1.37
(500-1500), −0.34 → +0.54 (1500-3000), −0.33 → +0.83 (3000 m+): it was
slightly low at altitude and is now slightly high. The driver is Stage 2's
+2.25 °C warm bias against *NCEP* land, not 5.2 itself.

## 3. Stage 5B, new baseline (land, g/kg)

| | land mean q | bias | RMSE | q<0.001 | exact 0 | model RH |
| --- | --- | --- | --- | --- | --- | --- |
| 6.5 / model wind | 4.055 | −3.75 | 6.97 | 8.6% | 5.2% | 0.413 |
| **5.2 / model wind** | **4.179** | **−3.63** | **6.93** | 8.6% | 5.2% | 0.402 |
| 6.5 / oracle wind | 5.047 | −2.76 | 4.61 | 6.2% | 0.0% | 0.406 |
| **5.2 / oracle wind** | **5.081** | **−2.73** | **4.60** | 6.2% | 0.0% | 0.392 |

Teacher land mean q **7.806 g/kg**.

**Every recorded oracle-wind baseline survives.** 5.047 → 5.081 (+0.7%),
RMSE 4.61 → 4.60, bias −2.76 → −2.73. The dry tail is identical: 6.2% of land
below 0.001 g/kg and **exactly 0% at exact zero** under the oracle wind, 5.2%
exact zero under the model wind, both unchanged by 5.2.

Dry-tail distribution at 5.2 (% of land below each threshold):

| threshold | model wind | oracle wind | teacher |
| --- | --- | --- | --- |
| < 0.001 | 8.6 | 6.2 | 0.0 |
| < 0.5 | 25.4 | 19.1 | 4.9 |
| < 1 | 34.4 | 27.0 | 6.8 |
| < 3 | 54.8 | 50.1 | 15.5 |
| < 5 | 66.9 | 61.3 | 38.3 |

## 4. By region (g/kg)

| | 6.5 model | 5.2 model | 6.5 oracle | 5.2 oracle | teacher | q_sat 5.2 | RH 5.2 oracle |
| --- | --- | --- | --- | --- | --- | --- | --- |
| アマゾン | **0.00** | **0.00** | 15.03 | **15.04** | 18.97 | 28.50 | 0.527 |
| コンゴ | 0.00 | 0.00 | 4.44 | 4.44 | 17.55 | 26.70 | 0.167 |
| インドネシア | 6.33 | 6.36 | 12.09 | 12.12 | 19.04 | 27.32 | 0.445 |
| サハラ | 4.77 | 4.77 | 2.88 | **2.89** | 4.67 | 19.16 | 0.151 |
| オーストラリア | 8.89 | 8.90 | 4.37 | 4.38 | 7.00 | 19.54 | 0.211 |
| インド | 11.24 | 11.26 | 6.78 | 6.79 | 12.46 | 20.75 | 0.310 |
| ヨーロッパ | 3.60 | 3.61 | 3.56 | 3.56 | 6.76 | 5.74 | 0.645 |
| シベリア | 0.28 | 0.28 | 0.59 | 0.59 | 3.65 | 2.47 | 0.260 |

アマゾン/サハラ ratio: **5.22 → 5.21** (recorded value 5.22).

**One recorded value does not reproduce**: オーストラリア is 4.37 at the 6.5
oracle state against the recorded 4.46. Since the 6.5 state reproduces it, the
2% gap is a box-definition difference in the old measurement, not an effect of
5.2. アマゾン 15.03, サハラ 2.88 and the ratio 5.22 all reproduce exactly.

**The Amazon is still exactly 0.00 g/kg under the model's own Stage 4 wind**,
unchanged. That finding stands untouched.

## 5. Error decomposition, re-derived on the 5.2 field

The identity used is exact:
`q_m − q_t = (q_sat,m − q_sat,t)·RH_m + q_sat,t·(RH_m − RH_t)`

| term | model wind | oracle wind |
| --- | --- | --- |
| **A** capacity (temperature / q_sat) | mean +0.22, RMSE 1.05 | mean +0.60, RMSE **1.58** |
| **B+C** filling fraction (transport / source) | mean −3.85, RMSE 7.13 | mean −3.33, RMSE **5.14** |
| total (= q bias) | −3.63, RMSE 6.93 | −2.73, RMSE 4.60 |

Splitting B from C by swapping only the wind at a fixed temperature field:

- **B, wind alone** (model wind → oracle wind at 5.2): mean +0.90, mean abs
  **3.59**, RMSE 5.87.
- **C, what survives the oracle wind**: mean **−3.33**, RMSE 5.14.
- **A, 5.2's own contribution** (6.5 → 5.2): mean abs **0.13** g/kg with the
  model wind, **0.03** with the oracle wind. Half the land (49.6%) moves by
  less than 0.01 g/kg.

So the ranking is **source/sink ≳ wind ≫ temperature**, and the temperature
change is two orders of magnitude below either of the other two.

### A caveat on the teacher's own RH

The teacher's land-mean "RH" comes out at 0.955, which is not a physical
relative humidity: it is a mean q divided by q_sat of a mean T, and Jensen's
inequality on a convex q_sat puts **35.6% of land above 1.0** -- reproducing
the previously recorded figure exactly. Term A uses q_sat only and is immune;
the B/C split passes through this ratio and is therefore an attribution, not a
measurement of real relative humidity. Restricted to the cells where the
teacher ratio is ≤ 1, teacher 0.665 against model 0.390, q bias −3.03.

## 6. What holds and what changed

**Holds**: the oracle-wind baselines (5.047/4.61/−2.76 → 5.081/4.60/−2.73);
the Amazon at exactly 0.00 under the model wind; the Amazon/Sahara ratio 5.22;
the dry tail and the exact-zero fractions; the ranking of error sources; the
Congo's 4.44 g/kg shortfall; Siberia's near-total dryness.

**Changed**: Stage 5A's q_sat is now further from the NCEP teacher (land bias
+0.98 → +1.53 g/kg) while its surface pressure is closer at altitude; the
model's land RH falls 0.406 → 0.392 under the oracle wind, because q barely
moved while capacity rose.

**Not reproduced**: オーストラリア 4.46 (measured 4.37, at both lapse rates).

## 7. Is there a humidity physics fix to make

Not one that this round identified. The dominant term is C -- the moisture
that never arrives even under the observed wind -- and that is the same
source/sink question Stage 5C-alpha already probed and left conditionally
parked, with the added constraint that any recycling mechanism must be
identifiable rather than a τ relabel. Nothing here changes that verdict, and
5.2 did not move it.
