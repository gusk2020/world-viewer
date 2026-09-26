# Climate v1 — status, and the one place to start reading

**Stable as of 2026-09-26.** This is the entry point: what Climate v1 is, what
is in it, what is deliberately not, and which document to open next. Every
section links out rather than copying — the detail lives in the numbered
documents beside this one.

> **"Stable" does not mean Earth is reproduced.** It means the scope written
> down here is closed, measured, and reproducible: nothing in it is half-built,
> no parameter is inert, and a regression suite says so in one command. The
> known errors are in section 8 and they are large.

---

## 1. What Climate v1 is

A **present-Earth diagnostic model**: given a real elevation raster and a
handful of physical constants, it produces an annual-mean temperature field, a
wind, a humidity field, a moisture transport, a seasonal temperature cycle and
a sea-ice state, and compares each against real observational teachers.

It is **not** a world generator. It reads today's ice sheets as an input (via
GEBCO's ice-surface elevation) and has no albedo, no precipitation and no ice
mass balance. The self-forming-ice-sheet track is a separate branch run
separately — see `climate-v1-scope-and-ice-sheet-boundary.md`.

It is also **not** Climate v0.8. V0.8 is the shipped surface-colouring model
(`js/climate.js`) that the phone draws; Climate v1 lives in `js/climate-v1/`
and shares only `js/climate.js`'s insolation and `surfaceAnnualTemperatureC`.
V0.8's 63.4% / 10.2% are **regression guards** for Climate v1 work, never
objectives — no Climate v1 field is read by either score.

## 2. Production — reachable from the app (`index.html` → `js/main.js`)

| Stage | File | State |
| --- | --- | --- |
| Terrain / land-sea mask | `terrain.js` | on |
| Annual temperature (Stage 2) | `temperature.js` (+ `js/climate.js`) | on, **closed** |
| Wind (Stage 4) | `wind.js` | on, **frozen** |
| Humidity, saturation (Stage 5A) | `humidity.js` | on |
| Moisture transport (Stage 5B) | `moisture.js` | on, **closed** |
| Seasonal temperature cycle | `season.js` | on (温度のみ; the UI says so) |
| Orbit: eccentricity, periapsis | `season.js` | on, defaults circular |
| Sea-ice state + latent coupling | `sea-ice-state.js` | on as an overlay, **default off** |
| Observed-wind oracle (diagnostic) | `oracle-wind.js` | on as the 観測風 toggle |
| Orchestration | `preview.js` | on |

Earth's calibration is `earth-temperature-calibration.js` and **never a world
config**: `insolationSensitivityC` 80.68, `oceanModeration` 0.818,
`surfaceLapseRateCPerKm` 5.2, `oceanSeasonalDampingWPerM2K` 10,
`landSeaThermalRelaxationDays` 7 (the last carried by its own accessor and not
wired into the preview — see section 3).

Read next: `climate-v1-redesign.md`, `climate-v1-temperature-validation.md`,
`climate-v1-surface-lapse-rate.md`, `climate-v1-stage2-closed-and-humidity-rebaseline.md`,
`climate-v1-wind-model-stage4.md`, `climate-v1-moisture-stage5b.md`,
`climate-v1-stage5-closed.md`, `climate-v1-seasonal-cycle.md`,
`climate-v1-ocean-damping-split.md`, `climate-v1-sea-ice-state.md`.

## 3. Experimental — built, measured, and OFF by default

Each is one number away from being on, and each defaults to the value that
makes it bit-identical to not existing.

| Experiment | Switch | Default | Where it can be turned on |
| --- | --- | --- | --- |
| Evaporative cooling | `evaporativeCoolingC` | 0 | the app's 蒸発冷却 button |
| Land evapotranspiration | `landEvapotranspirationWeight` | 0 | `moistureOptions.params` |
| Explicit eddy diffusion | `eddyDiffusivityM2PerS` | 0 | `moistureOptions.params` |
| Land-sea thermal coupling | `landSeaThermalRelaxationDays` | 0 | `tools/validate_land_sea_coupling.mjs` only |
| Hadley / Gill tropical wind | `heatingResponseStrength`, `zonalHeatingStrength`, `longitudinalHeatingStrength` | 0 | `tools/validate_tropical_wind.mjs` only |
| Stage 5C-alpha recycling | `landRecyclingFraction` | 0 | `tools/validate_recycling_stage5c_alpha.mjs` only — **rejected**, kept as evidence |

**Land-sea thermal coupling is the one that is finished and still not wired
in**, deliberately: switching it on inside `buildClimateV1Preview` would move
Stage 4's wind and Stage 5's humidity, both of which read the temperature
field. Turning it on is the next round's decision, together with the SST
longitude work. See `climate-v1-land-sea-thermal-coupling.md`.

Read next: `climate-v1-evaporative-cooling-preview.md`,
`climate-v1-land-evapotranspiration.md`, `climate-v1-land-sea-thermal-coupling.md`.

## 4. Parked — diagnosed, measured, not built

None of these is "impossible"; each has a measurement saying what blocks it.

| Parked | The blocker, measured | Document |
| --- | --- | --- |
| SST longitudinal structure | no geometry-general predictor found; 1/W has the wrong sign (r = −0.08 at 50–65N), the gyre dipole explains only 17% | see the SST section of `climate-v1-land-sea-thermal-coupling.md` |
| Ocean heat transport / AMOC | Stage 4's stress curl correlates +0.003 with NCEP's; Sverdrup transport 15–40× too weak, wrong sign in the N. Atlantic | `climate-v1-stage2-closed-and-humidity-rebaseline.md` |
| Sea-ice heat-capacity feedback | works, but at a correct amplitude it destroys every multi-year ice cell; blocked on the ice-area error upstream | `climate-v1-sea-ice-state.md` |
| Antarctic / Greenland energy balance | +10.5 °C Antarctic bias; ice albedo moves it −8.0 °C but Greenland −9.2 °C | `climate-v1-surface-lapse-rate.md` |
| Precipitation | every proxy inherits the Stage 4 wind's zeros (0.00 mm/day over the Amazon and the Congo) | `climate-v1-stage5-closed.md` |
| Soil water (bucket) | in an annual-mean steady state a bucket is P/PET rewritten; the coupled solver stops converging | `climate-v1-stage5-closed.md` |
| Tropical wind (Hadley / Gill) | strengths default to 0; validator-only | `climate-v1-wind-negative-results.md` |
| Land-ice self-generation | needs bedrock → albedo → precipitation → mass balance, in that order | `climate-v1-scope-and-ice-sheet-boundary.md` |

## 5. Rejected — negative results, kept on purpose

**Do not re-attempt any of these without reading its document first.** They
cost whole rounds and the evidence is the most valuable thing in the project.

- **Two-layer ocean** — degenerate with a one-layer ocean at a larger λ
  (`climate-v1-ocean-damping-split.md`).
- **The soil bucket** — `climate-v1-stage5-closed.md`.
- **Absolute-temperature upwind advection** for land-sea coupling — converts
  the wind's meridional bias into a temperature bias one for one
  (`climate-v1-land-sea-thermal-coupling.md`).
- **Isotropic oceanicity** — scores better, pushes marine air 2000 km inland
  (same document).
- **A `mixingEfficiency` parameter** — exactly degenerate with
  `oceanModeration` (same document).
- **Wet-bulb evaporative cooling** — the depression is largest over deserts
  (`climate-v1-evaporative-cooling-preview.md`).
- **Stage 5C-alpha recycling** — exactly a relabelled `(1−f)/τ`
  (`climate-v1-recycling-stage5c-alpha.md`).
- **Basin-width (1/W) SST and Stage-4-wind-driven Ekman SST** — refuted by
  direct correlation against the teacher.
- **Wind re-fits** — `climate-v1-wind-negative-results.md`.

## 6. Parameters — the reachability audit

Every Climate v1 parameter was perturbed and the production output hashed.
**There are no inert parameters.** Two cases are unreachable by design and are
stated rather than fixed:

- **`lapseRateCPerKm` (free-air, 6.5) is never read in Climate v1**, because
  `surfaceLapseRateCPerKm` (5.2) is always set and
  `effectiveSurfaceLapseRateCPerKm` prefers it. It remains the fallback for
  parameter sets saved before 5.2 existed. Correct, not dead.
- **`SEASON_PARAMETERS.harmonics` is a module constant, not a `params` key.**
  `harmonicsForEccentricity` reads it directly and
  `buildSeasonalTemperatureTable` takes its own `harmonics` argument, so
  `params: { harmonics: 8 }` is silently ignored. Now stated in the code.

Two naming hazards found and documented rather than renamed:

- **`evapotranspirationTimescaleDays` exists twice** — `moisture.js` 4.6 days
  `physical`, `recycling.js` 5 days `empirical`. Different modules, separate
  resolvers, so they cannot collide at run time; never copy a value across.
- **Two schema shapes**: `season/moisture/evaporative-cooling/recycling/
  land-sea` use `{ default, … }`, while `wind/sea-ice/tropical-circulation`
  use `{ value, … }`. Each module's own resolver reads its own key correctly.
  A wide rename was judged more risk than value during a stabilization round.

What may and may not be fitted is a separate document and still binding:
`climate-v1-calibration-audit.md`.

## 7. Teachers

| Teacher | File | Used for |
| --- | --- | --- |
| Berkeley Earth annual (**主**) | `temperature-annual-mean-c.bin` | Stage 2's temperature |
| Berkeley Earth monthly | `temperature-monthly-mean-c.bin` | the seasonal amplitude and phase |
| NCEP humidity + 2 m T + pressure | `humidity-*.bin` | Stage 5A/5B; its own 2 m T **must** be used wherever a ratio mixes the two |
| NCEP wind (850 hPa, 10 m) | `wind-*.bin` | the wind diagnostic and the 観測風 oracle |
| Teacher A (V0.8, 4 classes) | `present-classes.png` | the V0.8 regression guard; the only sea-ice teacher |
| Teacher B (Köppen, 8 classes) | `koppen-structure.png` | the V0.8 regression guard |

The two temperature teachers disagree by ~3 °C in the wet tropics and that
disagreement is measured, not assumed: `climate-v1-temperature-teacher-audit.md`.

## 8. Known limitations, stated plainly

1. **No longitudinal SST structure.** The model's sea temperature is exactly
   f(latitude) — 0.0 °C spread within every one of 961 sea rows.
2. **No ocean heat transport, no currents, no AMOC.**
3. **Europe stays ~5 °C too cold** (land bias −5.6 with the coupling off,
   −5.0 with it on), and the rest needs (2).
4. **The Stage 4 wind has no trade winds.** Mid-latitude directions are
   usable; the tropics are not.
5. **Moisture transport is limited by that wind** — the Amazon and the Congo
   receive exactly 0.00 g/kg under it.
6. **No precipitation, and therefore no soil water and no land snow.**
7. **Antarctica is +10.5 °C too warm and Greenland −3.6 °C too cold**; both
   need a surface energy balance with albedo.
8. **Sea-ice extent is overstated** — annual maximum 7.5% of the globe against
   the teacher snapshot's 1.0%, which is upstream error (1) surfacing.
9. **The seasonal preview is temperature only.** Humidity, wind, ET, sea ice
   and vegetation are annual means; the UI says so.
10. **Present-Earth diagnostic model.** No self-formed ice sheets; that is a
    separate track.

## 9. The stable regression suite

One command each; all twenty pass at this commit.

**Golden reference (start here):** `node tools/golden_climate_v1.mjs` — the
headline numbers in one place, checked against
`worlds/kasoku-sekai/climate-v1-golden.json`. Re-record with `--write` **only**
after a deliberate model change, and say in the commit what moved and why.

| Area | Tool |
| --- | --- |
| V0.8 guard (Teacher A / B) | `score_climate.mjs`, `score_koppen.mjs` |
| Terrain and masks | `test_terrain_mask_stage5a5.mjs`, `test_water_surface_stage5a6.mjs` |
| Annual temperature | `validate_temperature_v1.mjs`, `validate_surface_lapse.mjs` |
| Season and orbit | `validate_season.mjs`, `validate_seasonal_temperature.mjs` |
| Wind | `validate_wind_v1.mjs`, `validate_wind_model_stage4.mjs`, `validate_tropical_wind.mjs` |
| Humidity and moisture | `test_humidity_stage5a.mjs`, `validate_humidity_stage5a.mjs`, `test_moisture_stage5b.mjs`, `validate_moisture_stage5b.mjs`, `validate_land_et.mjs` |
| Sea ice + energy conservation | `validate_sea_ice_state.mjs` |
| Experiments (off-by-default proofs) | `validate_evaporative_cooling_preview.mjs`, `validate_recycling_stage5c_alpha.mjs`, `validate_land_sea_coupling.mjs` |

The browser check is `scratchpad/`-based (not committed): load the app, the
annual frame must hash `1799c75758ce`, the seasonal frame at phase 0.25
`1e2a09adcdc7`, panels 41 px top / 214 px bottom with the sea-ice row shown,
and no console errors. (The `9a360f6532e5` recorded for the seasonal frame in
an earlier round is stale: it was re-measured at this commit **and at the
unmodified parent commit** and both give `1e2a09adcdc7`, so the difference
predates the stabilization pass and is a later UI round's layout, not a
physics change.)

## 10. Next development, unordered

Written down so that nothing half-lands in the code:

- **SST longitudinal structure / ocean heat transport** — the one that unblocks
  Europe, the sea-ice area and the heat-capacity feedback at once.
- **A surface energy balance with albedo** — unblocks Antarctica and Greenland.
- **The tropical wind** — unblocks precipitation and land ET.
- **Precipitation** — unblocks soil water and land snow.
- **Equilibrium world generator** — a separate track on a separate branch.

No ranking is claimed. The first two are the ones with the largest measured
errors behind them.

## 11. If you are picking this up again, read these first

1. This file.
2. `climate-v1-calibration-audit.md` — what may and may not be fitted.
3. `climate-v1-scope-and-ice-sheet-boundary.md` — what this model is for.
4. Then the document for whichever stage you are about to touch, from the
   tables above.
5. `CLAUDE.md`'s Climate v1 sections for the project-wide rules and the
   traps that have cost rounds before.
