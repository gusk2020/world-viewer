# Climate v1 Stage 5A.5 — the land/sea rule

One change, to one rule, in one file. Stage 5A discovered that Climate v1
could not represent dry land below sea level; this fixes that before Stage 5B
starts reading `isSea` as "water to evaporate from", which would have made the
Dead Sea basin a phantom ocean in the middle of a desert.

Nothing else changes: `sourceElevationMetres` is untouched, the app does not
import `js/climate-v1/` at all, and `worlds/kasoku-sekai/config.json` is
byte-identical. **No new data was downloaded and no new file was committed.**

---

## 1. The old rule, and exactly what was wrong with it

```js
isSea[i] = sourceElevationMetres[i] < seaLevelMetres;   // the whole rule
```

Dry land below sea level exists. The Jordan valley, the Danakil depression,
the Turfan and Qattara depressions and the whole Dead Sea basin are
**endorheic** — below sea level, and not ocean. The old rule called every one
of them ocean.

Two consequences, one already live and one waiting:

- **today**: they get an ocean's temperature moderation in
  `js/climate.js`'s `surfaceAnnualTemperatureC`;
- **in Stage 5B**: they become evaporation sources, putting an ocean's worth
  of moisture into the driest places on the planet.

---

## 2. What was considered, in the order the brief asked for

### Reuse existing data — chosen

**The rule is topological, not another number:**

> a cell is sea if it is below sea level **and connected**, through other
> below-sea-level cells, to somewhere already known to be ocean.

"Known to be ocean" is three seeds, in order of how much they assume:

1. the pole rows — on any world, the top and bottom of the map;
2. the deepest cell on the whole grid, so a world whose poles are dry land
   still finds its ocean;
3. every cell an independent ocean mask calls ocean, when one exists.

Longitude wraps, so the fill crosses the antimeridian; latitude does not.
This needs no data beyond the elevation raster Climate v1 already reads.

### Reconstruct from existing world assets — also used, for seed (3)

Connectivity **alone is not enough**, and the failure is specific rather than
theoretical. At ~20 km cells a strait narrower than one cell does not exist,
so real ocean gets severed. Measured on the committed raster, connectivity
alone puts four genuine ocean bodies on the wrong side:

| body | cells | why it is severed |
| --- | --- | --- |
| Black Sea | 1510 | the Bosphorus, ~1 km wide |
| Sea of Azov | 149 | the Kerch strait, ~4 km |
| Sea of Marmara | 31 | Bosphorus and Dardanelles |
| Lake Maracaibo | 32 | the Tablazo strait |

Seed (3) repairs exactly those, and it comes from an asset **the repo already
has**: Teacher B's Köppen-Geiger map
(`worlds/kasoku-sekai/teacher/koppen-structure.png`, from Beck et al. 2018,
CC BY 4.0). That map covers land only, so its no-data value states where the
ocean is — and it owes **nothing to elevation**, which is the whole point,
since the rule it repairs is itself an elevation test. `tools/ocean_mask.mjs`
reads it; nothing was downloaded and nothing new was committed.

### A new land/sea mask file — not needed

Never reached. The priority order in the brief resolved at step two.

### Rejected: an area threshold

An obvious-looking fix is "a disconnected body bigger than N cells is
ocean". It cannot work: the Black Sea (1510 cells) and the Caspian (2502
cells) are the same size and opposite answers. Measured, not assumed.

---

## 3. The mask is a seed, not a vote — and that mattered

The first version asked whether a **majority** of each disconnected body was
ocean in the mask. That fails, because at 0.5° the mask's coastline is coarse:

| body | mask says ocean | majority rule | truth |
| --- | --- | --- | --- |
| Black Sea | 82.1% | sea | sea |
| Sea of Azov | 44.3% | **land** | sea |
| Sea of Marmara | 29.0% | **land** | sea |
| Lake Maracaibo | 18.8% | **land** | sea |

Three of four wrong. Seeding instead has **no threshold at all** — one mask
ocean cell anywhere in a body is enough — and it cannot produce a false
positive here: measured across **all 358** below-sea-level bodies on the
committed raster, the ones that are not ocean contain **exactly zero** mask
ocean cells. The distribution is 345 bodies at exactly 0.0% and ten at
≥82%, with nothing in between to tune.

---

## 4. What actually changed

- **3795 cells reclassified sea → land**, 0.19% of the globe.
- **0 cells reclassified land → sea.** The rule cannot promote a cell at or
  above sea level, so every open coastline is exactly where the elevation
  data puts it.
- Sea fraction 70.872% → 70.680%.
- Build cost 40 ms for 2048×1024 — still cheap enough to re-run whenever sea
  level moves, which the docstring promises.

`isBelowSeaLevel` is now exported alongside `isSea`, because they are
genuinely different questions and Stage 5B will want both.

---

## 5. The one real cost: lakes are land now

`isSea` means **the world's ocean** — which is what sea level physically
defines and what the temperature stage's ocean moderation assumes. So the
Caspian (2502 cells), Lake Baikal (75) and the Dead Sea itself come out
land, and this is worth stating plainly rather than burying:

- **The Dead Sea basin becoming land is the fix that was asked for.**
- **The Caspian becoming land is a cost.** It is a genuine 371,000 km²
  evaporation source, and Stage 5B will no longer see it. Before this change
  it was (accidentally) counted; now it is (deliberately) not.

The direction is the conservative one — a missing moisture source distorts a
moisture model less than a phantom ocean in a desert — but it is a real
trade, and it is the user's call if they want it the other way.

**No existing asset can separate a lake from an endorheic basin.** Beck's map
classifies the Caspian as arid land, and Teacher A's sea class is itself
elevation-derived. Doing better needs a lake dataset, which is a feature, not
a bug fix, and was not invented here.

**A side effect of the same decision, measured**: a lake bed treated as land
gets a surface pressure computed as if air filled the lake. The deepest case
is Lake Baikal's floor (107.8°E 53.2°N, −1138 m) at **1163.7 hPa**; the
Caspian reaches 1139.9 hPa. Genuinely dry below-sea-level land tops out
around **1053.7 hPa** in the Dead Sea basin, which is physically right. In
total 3795 cells sit above p0, 481 above 1050 hPa and 6 above 1150 hPa.

---

## 6. Tests

`node tools/test_terrain_mask_stage5a5.mjs` — **44 checks, 44 passing.**

| group | what it establishes |
| --- | --- |
| 1 | the mask loads from an asset the repo already has, and is not elevation-derived |
| 2 | the Jordan valley, Dead Sea basin and Danakil are below sea level **and land** |
| 3 | nine real ocean bodies are still sea, including the ice-covered Arctic |
| 4 | the four narrow-strait bodies are still sea |
| 5 | ordinary land (Sahara, Amazon, Tibet, Antarctica, Greenland) is untouched |
| 6 | 3795 cells moved sea → land and **0** moved land → sea |
| 7 | sea level from −6000 m to +200 m: sea never exceeds the below-sea-level area, and rises monotonically |
| 8 | a world with **no** mask still works — the open ocean is sea, basins are land, and the Black Sea degrades to land visibly rather than silently |
| 9 | synthetic worlds: all-land, all-ocean, a world with dry poles (found via the deepest-cell seed), an isolated inland basin, and an ocean spanning the antimeridian |

Group 9 is what shows the rule is not Earth-specific: none of it reads a
place name, a latitude range or Earth's geography.

---

## 7. Regression

Every Stage 2/3/4/5A validator was run on the pre-change commit and again
after, and the outputs diffed.

| stage | result |
| --- | --- |
| Stage 3 wind | **byte-identical** (the old model is latitude-only and never reads `isSea`) |
| Stage 4 wind model | fourth-decimal only; **"Stage 3 baseline reproduction: OK"** and "synthetic physics tests: OK" both still pass |
| Stage 2 temperature | overall MAE **3.089 → 3.090**; land MAE **3.337 → 3.330 (better)**; sea 2.987 → 2.990; land cells 22107 → 22226; determinism OK |
| Stage 5A humidity | pressure bias 2.664 → 2.692 hPa, MAE 8.328 → 8.340; the decomposition line "their T, our p → r = 0.9999" unchanged |
| Stage 5A unit tests | 47 passing (two assertions updated — see below) |

**Two Stage 5A assertions were changed, and only because they encoded the
bug.** One read "Climate v1's mask yields no below-sea-level land today
(0 cells above p0)" — written in Stage 5A to record the limitation honestly,
and now false because the limitation is gone. It asserts the corrected state,
plus a new check that the Dead Sea basin is specifically among the cells that
now get p > p0. The other was a pressure upper bound of 1080 hPa, raised to
1200 with the lake-bed explanation attached (§5).

Nothing was loosened to make a failing test pass: both bounds describe a
state that changed for a known, documented reason.
