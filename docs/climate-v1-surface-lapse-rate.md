# Climate v1: a surface lapse rate, separate from the free-air one

**Status: implemented.** `surfaceLapseRateCPerKm` is a new parameter; Climate v1
sets it to 5.2 C/km. `lapseRateCPerKm` stays at 6.5 and was not touched.
Climate v0.8's painted output and both its teacher scores are byte-identical.

Tool: `tools/validate_surface_lapse.mjs`. Diagnosis it came from:
`docs/climate-v1-temperature-bias-berkeley.md`.

## 1. Why 6.5 was the wrong quantity, not a wrong number

6.5 C/km is the **free-atmosphere** standard lapse rate (ICAO). It describes an
air column. Stage 2 was applying it to a different question entirely: how much
colder is the *ground* when the ground is higher. Elevated terrain is heated by
the sun at its own level, so surface air over it is not free air at that
altitude, and the two quantities differ.

Measured from the main teacher (Berkeley Earth), with latitude removed by the
model's own sea-level curve, over ice-free land:

| sample | observed surface lapse |
| --- | --- |
| all ice-free land | **5.27 C/km** |
| z 500-1500 m | 5.08 |
| z 1500-3000 m | 5.26 |
| z 3000 m+ | 5.17 |

It is flat above 500 m, flat across latitude (5.07-5.65 in four bands) and flat
across temperature (4.82 at -6.5 C, 5.80 at +21.4 C). That is the signature of a
single constant, not of a fit.

Below 500 m the same regression returns 7.78, but that is not a lapse rate at
all -- it is the maritime/continental contrast. Europe at 305 m would "require"
-11.4 C/km, which is the tell.

**5.2 was adopted, not re-fitted.** No teacher was optimised against in this
change.

## 2. Two rates, and why they must never be merged

| parameter | value | meaning | used by |
| --- | --- | --- | --- |
| `lapseRateCPerKm` | 6.5 | the **free-air** rate: a property of an air column | Climate v0.8's painter, anything thickness/geopotential/hydrostatic that is genuinely about free air |
| `surfaceLapseRateCPerKm` | 6.5 default, **5.2** in Climate v1 | the **surface** rate: how surface air temperature falls as the ground rises | `surfaceAnnualTemperatureC`'s land branch, and nothing else |

The schema default is the free-air value, so every parameter set saved before
this parameter existed -- Climate v0.8's included -- means exactly what it
always meant. Opting in is deliberate: Climate v1 does it in
`js/climate-v1/earth-temperature-calibration.js`.

`effectiveSurfaceLapseRateCPerKm(params)` in `js/climate.js` is the single place
that resolves which rate applies, for the same reason `classifyPoint` is shared
between the painter and the scorer.

## 3. One thing the brief assumed that the code did not do

The brief's premise was that `lapseRateCPerKm` is used by `humidity.js` for
pressure and by `wind.js` for thickness, i.e. as a free-air rate, and should
keep 6.5 there. **Read directly, those two call sites are not free-air uses.**
Both *invert Stage 2's own elevation term* to recover a sea-level temperature:

    humidity.js:  T_sealevel = T_surface + rate * z / 1000
    wind.js:      reduceToSeaLevel adds rate * max(0, z) back on

An inversion has to use the rate the forward step used. Handing it 6.5 while
Stage 2 applied 5.2 would recover a sea-level temperature wrong by
(6.5 - 5.2) * z -- about **+5.8 C over Tibet** -- and would have changed the wind
field for no physical reason.

So `preview.js` (and every Climate v1 tool that builds these stages directly)
now passes `params.surfaceLapseRateCPerKm ?? params.lapseRateCPerKm` to that
argument. The argument keeps its name: it still means "the rate this column was
built with". The separation the brief asked for is intact -- `lapseRateCPerKm`
itself is unchanged and still means the free-air rate.

**The measurement confirms the choice.** With the matching rate the sea-level
reduction cancels exactly, so the wind is unchanged to within Float32 rounding:
max |delta u| **0.0023 m/s**, mean 7e-5, and mean wind speed identical to four
decimals. The residual comes from Float32 and from the 3795 land cells below sea
level where the reduction is clamped at 0.

## 4. What it moved

bias = model - teacher, cos(lat)-weighted, on the 256x128 comparison grid.
A = Berkeley Earth (main), B = NCEP 2 m (independent check).

| region | before A | after A | delta | before B | after B | mean z |
| --- | --- | --- | --- | --- | --- | --- |
| チベット | -5.92 | **-0.17** | +5.75 | -2.00 | +3.75 | 4425 m |
| ヒマラヤ周辺 | -4.65 | **-1.02** | +3.62 | -1.29 | +2.33 | 2787 m |
| ロッキー | -3.29 | **-1.16** | +2.12 | -3.29 | -1.17 | 1631 m |
| グリーンランド | -6.40 | -3.62 | +2.78 | -5.05 | -2.27 | 2139 m |
| アンデス | -0.78 | +1.85 | +2.63 | +2.60 | +5.23 | 2027 m |
| エチオピア高地 | -0.88 | +1.02 | +1.91 | +1.16 | +3.07 | 1466 m |
| 南極 | +7.79 | **+10.48** | +2.69 | +8.99 | +11.68 | 2068 m |
| ヨーロッパ | -5.57 | -5.17 | +0.40 | -3.52 | -3.12 | 305 m |
| サハラ | -1.25 | -0.57 | +0.68 | -0.38 | +0.30 | 525 m |
| コンゴ | +2.29 | +2.93 | +0.64 | +5.33 | +5.97 | 494 m |
| インドネシア | +1.73 | +2.04 | +0.31 | +5.01 | +5.32 | 238 m |
| アマゾン | +2.91 | +3.07 | +0.15 | +6.21 | +6.36 | 119 m |

| elevation band | before | after | delta | area |
| --- | --- | --- | --- | --- |
| 0-500 m | +0.12 | +0.43 | +0.30 | 55.2% |
| 500-1500 m | -0.48 | +0.68 | +1.16 | 30.2% |
| 1500-3000 m | +1.12 | +3.88 | +2.76 | 9.8% |
| 3000 m+ | +2.92 | +7.87 | +4.95 | 4.8% |

| mean \|bias\| vs A | before | after |
| --- | --- | --- |
| 氷床除外 z>500 m | 2.54 | **2.35** |
| 氷床除外陸 | 2.52 | **2.49** |
| 平地 z<500 m | 2.59 | 2.67 |
| 全球陸 | 3.05 | 3.19 |

Every figure reproduces the pre-evaluation in
`docs/climate-v1-temperature-bias-berkeley.md` to the second decimal.

**The global land figure gets worse, and that was expected and accepted before
the change.** It is dominated by Antarctica, which is too warm for a reason
this change does not address (see below) and which any reduction of the lapse
rate makes worse. The honest measure of this change is ice-free land above
500 m: **2.54 -> 2.35**.

## 5. Guardrails, measured

- **Sea temperature exactly unchanged**: max |delta| 0.0 C over 1,378,437 sea
  cells. The sea branch never reads a lapse rate.
- **Land at exactly 0 m exactly unchanged**: max |delta| 0.0 C over 624 cells.
- **The land change is exactly the elevation term**: |delta - (6.5-5.2)*z| has a
  maximum residual of 3.6e-6 C over the whole 2048x1024 grid, i.e. Float32
  rounding. Nothing else moved.
- **No NaN or Inf.**
- **Climate v0.8 byte-identical**: `tools/score_climate.mjs` and
  `tools/score_koppen.mjs` both print output identical to before the change
  (Teacher A total 63.4%, Teacher B total 10.2%).
- **Tests**: `test_terrain_mask_stage5a5` 44, `test_water_surface_stage5a6` 37,
  `test_humidity_stage5a` 47, `test_moisture_stage5b` 32 -- all pass.
  `diagnose_climate_v1` and `validate_temperature_v1` pass unchanged (both run
  on the V0.8 parameter set, which does not carry the new parameter).

### Downstream, which changes only through the temperature input

Stage 4 and 5 formulas are untouched; they see a different Stage 2 field.

| | before | after | max cell |
| --- | --- | --- | --- |
| mean wind speed | 2.0187 | 2.0187 m/s | 0.0023 m/s |
| mean surface pressure | 970.346 | 970.545 hPa | 5.35 hPa |
| mean specific humidity | 7.3946 | 7.4263 g/kg | 2.95 g/kg |

The pressure and humidity changes are real and correct: the air column over
high ground is now warmer, so it thins less and holds more vapour. The wind is
unchanged for the reason in section 3.

## 6. Held over -- not solved, and not declared unsolvable

Each of these was diagnosed, measured, and parked because the simple model
cannot presently express it. None is closed.

- **南極 +10.5 C too warm.** Needs surface albedo, which needs a surface energy
  balance Stage 2 does not have. Measured: inside a minimal Budyko-Sellers
  balance, ice albedo moves 南極 by -8.0 C and グリーンランド by -9.2 C, so
  albedo alone trades one for the other.
- **グリーンランド -3.6 C too cold (residual).** Its *internal* lapse rate is
  already 6.64 C/km, so this is an offset, not a slope. At the same latitude and
  elevation the teacher puts グリーンランド 13.8 C warmer than 南極; no function
  of (latitude, elevation, surface type) can produce that.
- **ヨーロッパ -5.2 C too cold.** Maritime warmth that land cells never receive.
- **海温の経度構造.** The model's sea temperature is exactly f(latitude) --
  verified: 0.0 C spread within every one of 961 sea rows at 2048x1024.
- **海流 / AMOC.** The Stage 4 wind cannot drive an ocean: wind-stress curl
  correlates +0.003 globally with NCEP's, and Sverdrup transport comes out
  15-40x too weak with the wrong sign in the North Atlantic.
- **海洋性熱伝達.** The right form is known (upwind-advected sea temperature,
  which separates グリーンランド from 南極 by 5x) but it has no longitudinal SST
  structure to read.
- **雪氷アルベド.** As above, and the model's own ice diagnosis covers 11.2% of
  the globe against the teacher's 3.3%, so it would act on the wrong area.

`surfaceLapseRateCPerKm` and `lapseRateCPerKm` are different physical
quantities and are not to be merged in future.
