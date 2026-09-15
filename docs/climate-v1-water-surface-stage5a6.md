# Climate v1 Stage 5A.6 — water surface, and where the atmosphere sits

Stage 5A.5 fixed one conflation (below sea level ≠ ocean) and left another:
`isSea` was doing duty both as "the world's ocean" and as "water". The
Caspian is the case that breaks it — below sea level, not ocean, and
unmistakably water — and Lake Baikal showed the second half of the problem,
a surface pressure of **1163.7 hPa** computed as if the atmosphere sat on
the lake bed.

This stage separates three questions and adds the surface height the
atmosphere actually meets. **`isSea` is unchanged** — verified bit-identical
— so nothing earlier moves.

---

## 1. The classification

| field | question | Stage |
| --- | --- | --- |
| `isBelowSeaLevel` | is this ground under the sea's level? | 5A.5 |
| `isSea` | is this the world's **ocean**? | 5A.5, unchanged |
| `isWaterSurface` | is there **water** here — ocean *or* lake? | **new** |
| `surfaceElevationMetres` | where does the atmosphere meet the surface? | **new** |
| `relativeSurfaceElevationMetres` | the same, relative to sea level | **new** |

`isWaterSurface` is a strict superset of `isSea` (asserted over the whole
grid). Stage 5B's evaporation source should key off `isWaterSurface`.

`surfaceElevationMetres` is:
- **sea level, exactly**, over ocean — verified for all 1,378,437 cells;
- **the lake's own surface level** over a lake;
- **`sourceElevationMetres`, unchanged and signed**, on land — verified for
  all 712,450 dry-land cells, so the Jordan valley keeps its −29 m and
  Danakil its −108 m.

---

## 2. What the existing assets can and cannot distinguish, measured globally

The brief asked for the complementarity to be re-verified on全球 data rather
than taken from the earlier spot checks. It holds, and here are the numbers.

**Connectivity** (Stage 5A.5's ocean rule) and the **photograph's water
detector** fail in opposite directions:

| | share of globe |
| --- | --- |
| photograph says water | 69.84% |
| connectivity says ocean | 70.68% |
| both | 69.30% |
| ocean but photograph misses it | **1.38%** |
| photograph says water outside the ocean | **0.54%** |

**Where the photograph misses ocean, by latitude** — the ice failure,
quantified rather than assumed:

| band | share of that band's ocean missed |
| --- | --- |
| 66–90 °N | **47.0%** |
| 45–66 °N | 0.2% |
| 23–45 °N | 0.3% |
| −23–23 | 0.2% |
| −45–−23 | 0.1% |
| −66–−45 | 0.1% |
| −90–−66 °S | 2.5% |

Outside the polar regions the photograph agrees with connectivity to within
0.3%. The Arctic is where it collapses, exactly as predicted, because that
ocean is white.

### The false-positive measurement the brief asked for, before any union

Of the 11,764 cells the photograph calls water outside the ocean, the
question is how many are genuinely water. Two independent tests:

**Test 1 — the depression test.** A real lake sits in a basin, so its
surface must be lower than the ring of cells around it. Of the **1098**
inland water bodies, **1028 (93.6%)** sit below their shore ring, median
29 m below. Shading artefacts would have no reason to do that.

**Test 2 — identify the highest ones.** The clearest false-positive
signature would be "water" on high terrain. There are 47 such cells above
2000 m, and every cluster is a real lake:

| cluster | elevation | what it is |
| --- | --- | --- |
| 15 cells, −15.8 °N 69.5 °W | 3824 m | Lake Titicaca (3812 m) |
| 11 cells, 36.9 °N 100.2 °E | 3197 m | Qinghai Lake (3205 m) |
| 4 cells, 31.8 °N 89.0 °E | 4555 m | Tibetan lakes |
| 2 cells, 39.1 °N −120.1 °E | 2032 m | Lake Tahoe (1897 m) |
| 1 cell, 44.4 °N −110.3 °E | 2401 m | Yellowstone Lake (2357 m) |

So the detector's apparent false positives are not false. **No measured
false-positive population was found that needed suppressing**, which is why
a union is safe here — established by measurement first, as asked.

**Coastal fringe is excluded anyway.** 5499 of the 11,764 belong to bodies
that touch the ocean: mixed cells the photograph sees as part sea because
they straddle a coastline. Those are dropped rather than called lakes —
their water is already represented by the ocean cells beside them, and
keeping them would lay a band of pseudo-lake at positive elevations along
every shoreline. That leaves **6265 lake cells in 783 bodies**, 0.29% of the
globe.

### Frozen sea

Handled by construction: sea ice is ocean, and ocean comes from
connectivity, which does not look at colour. The Arctic Ocean is
`isSea = true, isWaterSurface = true` despite the photograph showing white.

---

## 3. Lake surface height, without naming a single lake

**First, what the raster is not.** It is tempting to read the lake's
elevation out of the terrain raster. That does not work, and the reason is
worth recording: the terrain pipeline area-averages ~20 km cells, so a lake
cell is a **blend of bed and surrounding land**. Lake Tanganyika reads
1099 m where its surface is 773 m; the Dead Sea reads −199 m where its
surface is −430 m; Baikal reads −121 m against a surface of +456 m. The
raster is neither the surface nor the bed.

**The estimator.** The water's edge is at the water's level by definition,
so the shore measures it directly: for each lake body, take the **10th
percentile of the elevations of the cells ringing it**. The 10th percentile
rather than the minimum because one mixed or outlet cell drags the minimum
down; rather than the median because the ring climbs away from the shore.

Compared against ten real lakes spanning −28 m to 3812 m:

| statistic | median \|error\| | RMS | worst |
| --- | --- | --- | --- |
| ring minimum | 10.0 m | 53.3 m | 150 m |
| **ring 10th percentile** | **10.9 m** | **15.2 m** | **27 m** |
| ring 25th percentile | 20.9 m | 53.2 m | 140 m |
| ring median | 41.0 m | 106.7 m | 278 m |

Per lake, with the estimator that shipped:

| lake | estimated | true | error | raster said |
| --- | --- | --- | --- | --- |
| Caspian Sea | −33 m | −28 m | **−5 m** | −435 m |
| Lake Baikal | 456 m | 456 m | **0 m** | −121 m |
| Lake Superior | 200 m | 183 m | +17 m | 21 m |
| Lake Titicaca | 3828 m | 3812 m | +16 m | 3814 m |
| Lake Victoria | 1151 m | 1135 m | +16 m | 1133 m |

**No lake is named anywhere in the code.** The estimator reads a body's own
shore and nothing else; the names above appear only in this document and in
the test's expectations.

---

## 4. The pressure this was really about

`js/climate-v1/humidity.js` now takes `relativeSurfaceElevationMetres`
instead of its old `isSea ? 0 : relativeElevationMetres`, which both removes
the sea special case and stops a lake's pressure being computed at its bed:

| | before | after | at |
| --- | --- | --- | --- |
| Lake Baikal | **1163.7 hPa** | **958.2 hPa** | 456 m |
| Caspian Sea | ~1140 hPa | 1017.2 hPa | −33 m |
| Dead Sea basin (dry) | 1053.7 hPa | 1051.2 hPa | ~−400 m |
| Jordan valley (dry) | 1016.7 hPa | 1016.7 hPa | −29 m |
| open ocean | 1013.25 hPa | 1013.25 hPa | sea level |

Globally the maximum falls from 1163.7 to 1118.2 hPa and the count of cells
above p0 from 3795 to 3380.

---

## 5. What is still wrong, honestly

**57 cells** have a non-ocean surface below −200 m, and they are the
residual of the same narrow-strait limit Stage 5A.5 documented: fjords and
marine basins whose connecting channel is narrower than one 20 km cell, which
the 0.5° ocean mask cannot see either. The deepest is a single cell at
127.9 °E 0.6 °S (−888 m) and it drives the 1118.2 hPa maximum. Three of the
57 are a lake whose shore ring caught an adjacent deep trough and so got too
low a level. No machinery was added for 57 cells out of 2.1 million; a finer
ocean mask would fix all of them at once.

**Lakes still do not moderate temperature.** `js/climate.js`'s
`surfaceAnnualTemperatureC` keys off `isSea`, so a lake is thermally land.
Changing that would move Stage 2/3/4 and is a modelling decision, not a
structural one — left deliberately, and it is why Stage 2's output is
byte-identical.

---

## 6. Tests and regression

`node tools/test_water_surface_stage5a6.mjs` — **37 checks, 37 passing**,
covering the six completion criteria verbatim, the superset property over
the whole grid, lake levels against five known lakes, ocean-surface-equals-
sea-level for every ocean cell, land keeping its signed ground, sea levels
from −6000 m to +200 m, graceful degradation with no mask, and a synthetic
world with an inland lake.

| stage | result |
| --- | --- |
| Stage 2 temperature | **byte-identical** |
| Stage 3 wind | **byte-identical** |
| Stage 4 wind model | identical except one timing line |
| Stage 5A.5 land/sea | 44/44, identical except one timing line |
| Stage 5A humidity | **improved**: global pressure MAE 8.340 → 8.326, bias +2.692 → +2.662, land <500 m r 0.7917 → 0.7988 |
| Stage 5A unit tests | 47/47 (two printed values moved: max pressure and the above-p0 count) |

`isSea` was checked bit-identical with and without the water mask, which is
the formal statement that Stage 5A.5 is undisturbed.

---

## 7. Data

**No new external dataset.** Two masks, both derived from assets already in
the repo:

- **ocean** — Teacher B's Köppen map's no-data value (Beck et al. 2018),
  already committed for Stage 5A.5;
- **water surface** — `worlds/kasoku-sekai/masks/water-surface.png`, 24.7 KB,
  built by `tools/build_water_mask.py` from this world's own committed
  photograph and elevation raster, offline, using `js/surface.js`'s own
  blue-ratio detector so the two cannot drift apart.

The second is a new *file* but not new *data*. It exists only because the
photograph is a JPEG and this project has no dependency that could decode one
in node.
