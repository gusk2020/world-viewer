# Climate v1's scope, and where the ice sheets come from

**Audit only. No physics file changed, no parameter moved, nothing fitted.**
This document exists because of one question from the user, and the question
was a good one:

> 現在の地球の氷床が最初からある前提で計算しているなら、本来は氷床なし、
> または最小初期氷から計算を始め、結果として現在に近い南極・グリーンランド
> 氷床が自己形成されるモデルにするべきではないか

The short answer is: **yes, that is the right shape for a world generator, and
it is not what Climate v1 is.** Climate v1 is a *present-Earth diagnostic*
model, it always was, and this document says so explicitly so that nobody —
including a future session — mistakes it for an equilibrium world generator.

It also draws the boundary, because the two tracks are now formally split:

| track | branch | what it answers |
| --- | --- | --- |
| **Present-Earth diagnostic** (this one) | `climate-v1-redesign` | given today's Earth — its coastlines, its ice-surface topography — how well can a small model reproduce today's temperature, wind, humidity and sea ice? |
| **Equilibrium world generator** (separate) | `climate-equilibrium-prototype` | given bedrock and a star, what climate and what ice sheets does a world settle into? |

**This conversation and this branch do not implement the second track.** What
follows is the inventory and the physics it may inherit.

## 1. What is prescribed, and what the model makes for itself

Measured by reading the code, not from memory: **no file under `js/` reads an
ice map of any kind.** `worlds/kasoku-sekai/teacher/present-classes.png` is
opened only by the scoring tools and by the app's own 教師 display button.

| quantity | prescribed or generated | where it enters |
| --- | --- | --- |
| **terrain elevation** | **prescribed, and it is the ice sheet** | `terrain.source` = GEBCO_2026 **ice surface elevation**. Over Antarctica and Greenland this is the top of the ice. |
| **land / sea mask** | **prescribed** | the same ice-surface raster plus the committed water-surface mask. Floating ice shelves therefore count as land. |
| sea level | prescribed (a scalar, 0 m) | the user's own slider, currently hidden |
| land ice / snow class (V0.8) | **generated** — temperature × moisture | `classifyPoint` in `js/climate.js`; 80.0% IoU against the mapped-ice teacher |
| sea ice (Climate v1) | **generated** — a real thickness state integrated round the year | `js/climate-v1/sea-ice-state.js` |
| **albedo** | **does not exist** | there is no albedo map anywhere. `shortwaveAbsorbedFraction` (0.70) is a single global scalar in `js/climate-v1/season.js`. |
| present-day ice distribution | **validation only** | Natural Earth 1:10m glaciated areas + Antarctic ice shelves, in Teacher A |

So the ice sheets enter this model in **exactly one physically meaningful
place: the elevation field**, and they do so because GEBCO's ice-surface grid
is the only global topography this project has ever committed.

## 2. The terrain is the ice surface, and bedrock is reachable

`js/climate-v1/terrain.js` already names the three states and refuses to fake
the third:

* `TERRAIN_STATES.ICE_SURFACE` — what is committed and what everything uses.
* `TERRAIN_STATES.BEDROCK` — a reserved name. **No bedrock dataset is fetched
  or referenced anywhere in this repository.** It is, however, immediately
  available: CEDA serves `sub_ice_topography_bathymetry/` from the *same
  directory* as the ice-surface grid this project already downloads, so
  `.github/workflows/build-terrain.yml` could produce it with a changed URL
  and a changed `filePrefix`, and nothing else.
* `TERRAIN_STATES.DEGLACIATED_EQUILIBRIUM` — bedrock plus isostatic rebound.
  Explicitly out of scope and **must not be approximated**: it needs a real
  GIA model, and "lift the rock where the ice was" is inventing a number.

## 3. How much of the polar climate is the ice sheet's own height

This is the measurement that decides the priority, and it points the opposite
way from the intuition that prompted the question.

Over the committed raster, area-weighted over land cells:

| region | mean ice-surface elevation | share above 2000 m | cooling from the surface lapse rate (5.2 °C/km) |
| --- | --- | --- | --- |
| Antarctica (< −65°) | **1967 m** | 54% | **10.2 °C** |
| Greenland | **1483 m** | 38% | 7.7 °C |
| Tibet (for scale) | 3586 m | 76% | 18.6 °C |

So the model is already handed about **10 °C of Antarctic cooling for free**,
purely because the elevation it reads is the top of a 2 km ice sheet.

**And Antarctica is still +10.5 °C too warm** against Berkeley Earth
(`docs/climate-v1-surface-lapse-rate.md`). Ice cells are 11.3% of land and
30.9% of the global land temperature error; excluding them takes the land MAE
from 3.19 to 2.49 (`docs/climate-v1-stage2-closed-and-humidity-rebaseline.md`).

Two consequences, both worth stating plainly:

1. **The polar error is not caused by prescribing the ice sheet.** It is
   caused by the ice sheet's *energy balance* being absent — there is no
   albedo, and no surface energy budget for the model to put one in.
2. **Swapping to bedrock today would make it worse, not better**: Antarctica
   would lose most of that 10.2 °C of elevation cooling and its warm bias
   would roughly double. A bedrock run is only meaningful *after* an albedo
   and a surface energy balance exist.

The one relevant experiment already on record: inside a minimal
Budyko-Sellers balance an ice albedo moves Antarctica **−8.0 °C** but
Greenland **−9.2 °C**, i.e. it trades one for the other rather than fixing
both. That is a measured negative result the equilibrium track inherits.

## 4. Why sea ice is not a precedent for land ice

`sea-ice-state.js` does generate its ice from temperature alone, carries a
real thickness state around the year, and (since the latent-heat coupling)
conserves energy to 1.2e-13 W/m². It is tempting to read that as "so land ice
is the same job". It is not:

| | sea ice | land ice |
| --- | --- | --- |
| source | freezing of the water already there | **snowfall** |
| sink | melting at the surface and the base | melt, and flow to the margin |
| state | thickness, on water at a fixed freezing point | thickness, **on rock whose height it then changes** |
| timescale | a year; the fraction converges in 2–5 years | 10³–10⁴ years |
| feedback onto climate | not yet (`feedsBackIntoTemperature: false`) | elevation **and** albedo, both first-order |

The sea-ice module is a good template for *how* to carry state (a periodic
steady state found by iteration, an energy budget that closes, a validator
that reports convergence rather than assuming it). It is not a template for
the physics.

## 5. The minimum land-ice model, and the one thing that blocks it

    dh/dt = accumulation − ablation − ∇·(D ∇h)

Seven pieces are needed: accumulation, ablation, a surface mass balance,
thickness, the elevation feedback, the albedo feedback, and a spreading term.
**Six of them could be written today. The seventh cannot**, and this is the
hard finding:

**Climate v1 has no precipitation.** `docs/climate-v1-stage5-closed.md`
records why, measured rather than assumed: every precipitation proxy built
from the model's own atmosphere inherits the Stage 4 wind's zeros — moisture
convergence gives **0.00 mm/day over the Amazon and the Congo**, the
saturation-excess proxy is identically zero over all land, and the τ-sink
proxy is an exact relabel of `(1−f)/τ`. Without precipitation there is no
accumulation term, and an ice-sheet model whose accumulation is invented is
not a model.

So the prerequisite chain for the equilibrium track is, in order:

1. **bedrock topography** (a URL change in an existing workflow),
2. **a surface energy balance with albedo** (the missing physics behind the
   polar bias, and the thing that makes an ice-free start meaningful),
3. **precipitation**, which is blocked on the moisture-carrying capacity of
   the Stage 4 wind — itself frozen with its own negative results in
   `docs/climate-v1-wind-negative-results.md`,
4. surface mass balance → thickness → the two feedbacks → spreading.

## 6. Initial conditions, and an honest prediction

Of the three candidates — ice-free, a tiny seed, and nucleation from perennial
snow — **none is expected to grow an Antarctic ice sheet with today's
physics**, and the reason is arithmetic rather than opinion: on bedrock the
model loses the 10.2 °C of elevation cooling measured above while already
carrying a +10.5 °C warm bias there. Nothing would nucleate.

**This is a prediction, not a measurement** — it has not been run, because no
bedrock raster exists in this repository to run it on. It is stated so the
equilibrium track can falsify it cheaply as its first experiment.

## 7. Equilibrium, and what it would cost

The ice sheet's real timescale does not have to be simulated. The precedent is
already here: the sea-ice heat-capacity re-evaluation reached a self-consistent
(temperature ↔ ice) periodic solution in **14 outer iterations** from an
ice-free, a frozen and a hot start, all landing on the same solution
(max |Δh| 0.002 m). An accelerated equilibrium for an ice sheet — surface mass
balance → thickness → elevation → climate, iterated to a fixed point — is the
same shape and cheaper per iteration, since it needs no sub-annual time step.
At 256×128 that is seconds at world-build time, and it must never run on a
slider drag.

## 8. What the present-day ice map becomes

Today `present-classes.png`'s `landIce` is a **teacher** already — nothing in
the model reads it. But it cannot honestly be called a hold-out while the
*elevation* the model reads is the same ice sheet: the input and the teacher
describe the same object, which is a circularity in the evaluation even though
it is not one in the code.

That circularity is broken by exactly one change, and only in the other track:
**run on bedrock**. Then `landIce` becomes a real validation target — model:
bedrock → predicted ice; teacher: observed ice.

## 9. What the equilibrium track inherits, and what it must not

**Inherit (verified, and independent of which topography is used):**

* the seasonal response with a real heat capacity, its analytic per-harmonic
  solution, and the orbital machinery (`js/climate-v1/season.js`) — including
  that the land phase bias is −0.2 d, i.e. right;
* the sea-ice thickness model, its latent-heat coupling and its energy closure
  (`docs/climate-v1-sea-ice-state.md`);
* the measured **surface** lapse rate, 5.2 °C/km, and the fact that it is
  distinct from the free-air 6.5 (`docs/climate-v1-surface-lapse-rate.md`);
* every negative result: the two-layer ocean's degeneracy, the bucket's
  non-adoption, the wind's negative results, the precipitation proxies' zeros,
  and the ice-albedo trade between Antarctica and Greenland. These cost weeks
  and are the most valuable thing here.

**Do not inherit:**

* **any parameter fitted against the ice-surface topography in polar cells.**
  `insolationSensitivityC` (80.68) and `polarExtraC` were fitted globally on
  this DEM; the seasonal parameters were fitted with ice cells and the three
  parked regions *excluded*, which is the safer half but still an Earth
  calibration;
* `oceanSeasonalDampingWPerM2K` = 10 and `surfaceLapseRateCPerKm` = 5.2 as
  *universal* constants — both are explicitly Earth calibrations;
* the assumption that land ice can be diagnosed from an annual mean. V0.8's
  land-ice class scores 80% IoU **on a DEM that already contains the ice**.

## 10. Effect on this branch's existing work, if bedrock ever lands here

It would not be a restart. Measured by what reads elevation: the ocean-side
work (λ_ocean, the seasonal ocean, sea ice, SST) does not read land elevation
at all and is unaffected. Stage 2's `insolationSensitivityC` / `polarExtraC`
are global fits and would need re-checking, but **ice cells are already
excluded from the seasonal fit**, which limits the damage. Humidity and wind
read elevation and would change over the poles only. In short: **a polar
replacement, not a rebuild.**

## 11. Verdict for this branch

Climate v1 continues as a **present-Earth diagnostic model**, and the next step
here remains the one the sea-ice re-evaluation identified: the sea surface has
no longitudinal structure, which is upstream of the overstated sea-ice area,
which is what currently blocks adopting the sea-ice heat-capacity feedback.
Ice-sheet self-generation is not this branch's work.
