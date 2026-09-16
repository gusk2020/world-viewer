# Experimental evaporative cooling — a touchable Climate v1 preview

**Status: experimental preview, not adopted.** `evaporativeCoolingC` defaults to
**0**, the app opens with the preview off, and switching it off again restores
the old result exactly — the cooling pass returns the *same object* it was
given, so not even a Float32 round trip happens.

## 1. The cooling

```
dT_i = -evaporativeCoolingC * q_i^2 / (q_i^2 + qHalf^2)        (land only)
```

`q_i` is the model's own specific humidity in g/kg. Three properties earn the
form:

- **Geography-blind by construction.** No place name, no latitude, no teacher
  array is reachable from `js/climate-v1/evaporative-cooling.js`. Move the
  continents and the cooling moves with them.
- **Saturating and quadratic at small q**, so a desert at 2–5 g/kg is left
  alone while a rainforest at 15–18 g/kg is not. That contrast is the entire
  measured signal (see `docs/climate-v1-temperature-bias-diagnosis-stage2.md`).
- **Land only.** Sea temperature here is a boundary condition from ocean
  moderation, and real evaporative cooling is already inside the observed sea
  surface temperatures it stands for. Cooling it again would double-count —
  which is also why the ocean cannot go cold however far the strength is
  pushed.

**A psychrometric wet-bulb form was built first and rejected**: the wet-bulb
depression is *largest* over deserts (the Sahara's ≈9.8 °C against the
Amazon's ≈6.3 °C), so every multiplicative version of it cools the Sahara hard
unless a surface-wetness factor is stacked on top — more parameters, no better
behaviour.

**The coupling** (cooling → lower q_sat → lower cap → lower q → less cooling)
is a genuine fixed point, solved by a few whole-pipeline passes. Each pass
re-derives the temperature **from the uncooled base field**, never from the
previous cooled one, so nothing compounds. It converges in 5 passes to under
0.05 °C.

## 2. Free parameters — two, neither fitted

| | meaning | default |
| --- | --- | --- |
| `evaporativeCoolingC` | maximum land cooling in °C as the air becomes very moist | **0 (OFF)**; the preview's ON value is 9 |
| `evaporativeCoolingHalfGPerKg` | where the cooling reaches half its maximum, on the model's own moisture scale | 12 |

Neither was searched. 9 °C was chosen so the wettest regions land near their
measured bias, and it is a preview value, not a calibration.

## 3. What it does, with the observed wind

| region | T OFF | T ON | ΔT | teacher | bias OFF | bias ON |
| --- | --- | --- | --- | --- | --- | --- |
| **アマゾン** | 30.9 | **25.9** | −5.0 | 24.7 | +6.2 | **+1.2** |
| **インドネシア** | 30.0 | **25.5** | −4.5 | 26.5 | +3.5 | −1.0 |
| コンゴ | 28.7 | 27.8 | −0.9 | 23.2 | +5.5 | +4.6 |
| サハラ | 22.9 | 22.3 | −0.6 | 23.2 | −0.3 | −0.9 |
| オーストラリア | 23.8 | 22.6 | −1.2 | 23.5 | +0.3 | −0.9 |
| インド | 24.7 | 22.4 | −2.3 | 25.6 | −0.9 | **−3.2** |
| ヨーロッパ | 4.7 | 4.0 | −0.7 | 8.6 | −3.9 | −4.6 |
| **海洋全体** | 17.9 | **17.9** | **0.0** | 14.2 | +3.7 | +3.7 |

Zero non-finite cells; converged; the ocean is untouched by construction.

**Two honest failures.** インド is over-cooled (−0.9 → −3.2) because this model
gives it 10 g/kg and the form cannot tell a monsoon from a rainforest.
コンゴ barely moves, because Stage 5B only delivers 4.4 g/kg there — the
cooling is right and the moisture is missing.

## 4. The wind toggle, and why it is there

With the **frozen Stage 4 model wind** the preview gives アマゾン **0.0 g/kg**
— that is Stage 5B's known failure, not a new one — so the cooling does
nothing there at all. With the **observed wind** アマゾン has 15.0 g/kg and
cools by 5 °C. Rather than hide that, the preview offers both and lets it be
seen on the phone. The observed wind is labelled 観測風 and is a **diagnostic
teacher only**; the production wind model is unchanged and still frozen.

## 5. Preview resolution

Climate v1 runs on a **halved (1024×512) height raster** in the app, area
averaged the way the terrain pipeline builds its own coarser levels. The
transport grid is 256×128 either way, so nothing visible is lost, and it is
what makes the preview usable on a phone. Every command-line tool still runs
at the full 2048×1024.

## 6. Turning it off

Press 切 on the v1 row, or any 地表 button. `evaporativeCoolingC` back to 0 is
the whole revert; nothing else in the app reads this module.
