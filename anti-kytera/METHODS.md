# Anti-KyTerra — methods, sources and licences (first implementation)

Scope of this first stage, exactly as specified: present Earth conditions are
held fixed; the climate is computed on the **ice-free** restored bedrock; ice
sheets grow from **zero** ice under that climate (one-way coupling); the
result is compared with present Earth on a phone globe. Nothing here is taken
from Climate v1 (`js/climate.js`); its lessons were read, its code was not
reused. The only existing app code used is `js/cubeSphere.js` /
`js/geoConvert.js` for drawing the globe.

## Causal chain and units

```
GEBCO ice surface s_obs, sub-ice bed b_obs            (m)
  -> grounded ice H_obs, restored ice-free bed b_free (m)   [bedrock.py]
  -> land mask (b_free > 0), 2-deg mean land elevation z_c   [setup_world.py]
  -> climate: monthly sea-level-equivalent T_sl (C), precip P (kg m-2 s-1),
     winds, evaporation                                       [climate.py]
  -> ice grid (polar stereographic, 60 km, one per hemisphere):
     T(s) = T_sl - lapse_surf * z_c - 6.5 K/km * (s - z_c)
     P(s) = P_c exp(-0.07 * 6.5e-3 * (s - z_c))
     lapse_surf: 6.5 K/km in the first run (E1), 4.5 K/km after the one fix (E2)
  -> accumulation, PDD melt, refreezing -> SMB (m ice / yr)    [icesheet.py]
  -> SIA flux divergence -> dH/dt (m/yr); flotation calving; ELRA bed (3 kyr)
  -> run to practical convergence                              [run_ice.py]
```

The local elevation response (lapse rate on the evolving ice surface, and the
precipitation reduction with colder air) is re-evaluated as the surface
changes (every 50 model years). The global climate is **not** recomputed with
the ice sheet; albedo and topography of the ice sheet do not reach the
atmosphere. This is the first-stage one-way coupling the specification asks
for.

## Components and where each method comes from

| component | method | source of the method | changes made here |
| --- | --- | --- | --- |
| bedrock restoration | Airy local isostasy: b_free = b + (rho_i/rho_m) H_grounded; grounded/floating split by hydrostatics | textbook (e.g. Turcotte & Schubert, *Geodynamics*) | `flexure` variant smooths the load (120 km Gaussian) to bracket lithospheric rigidity; `none` keeps today's bed |
| energy | seasonal 2-D EBM, linear OLR, diffusion of moist static energy | North & Coakley (1979); Budyko (1969); Hwang & Frierson (2010) | planetary albedo depends on insolation-weighted zenith angle instead of a latitude fit; implicit solve on the sphere |
| sea ice | thermodynamic layer, conduction k(T_f - T)/h, top melt, basal growth | Wagner & Eisenman (2015) | simplified: no ocean heat flux under ice |
| land snow (climate) | snow bucket, melt limited by energy so the surface cannot warm past 0 C while snow remains, snow albedo | standard GCM land schemes (Manabe 1969 style) | perennial snow on ice-free land does change albedo (capped at 1 m w.e.) |
| winds | damped-geostrophic boundary layer driven by (a) zonal-mean pressure cells, (b) thermal lows/highs p' ~ -T' | Lindzen & Nigam (1987) | zonal-mean cell amplitudes and the Hadley edge are global coefficients (observed Earth values); the edges follow the model's own thermal equator |
| moisture | steady advection-diffusion of column vapour; bulk evaporation; condensation above critical column RH; bucket soil moisture | UVic ESCM EMBM (Fanning & Weaver 1996; Weaver et al. 2001); Manabe (1969) | + storm-track precipitation ∝ Eady growth rate 0.31 g|dT/dy|/(N T); + subsidence suppression / ascent enhancement ∝ exp(-div/div_ref); + upslope orographic sink |
| SMB | PDD with normally distributed daily T (Calov & Greve 2005 closed form); DDF snow 3, ice 8 mm/(K d); refreeze 60 % | PISM defaults (`pism.io` PDD scheme) | snow fraction from the same normal distribution |
| ice flow | shallow-ice approximation, Glen n = 3, A = 1e-16 Pa^-3 a^-1, isothermal, no sliding; Mahaffy staggered scheme | EISMINT I (Huybrechts et al. 1996) | stereographic map factor: dH/dt = M + k^2 div_p(D grad_p s) |
| flux limiter | donor-cell positivity-preserving limiter on the SIA volume fluxes | standard FV practice (cf. Jarosch et al. 2013 on SIA mass conservation) | added after the first run exposed a 5 % budget error |
| near-surface lapse (the one fix) | column T -> land surface T with one global near-surface lapse rate | observed 4-5 K/km (Minder et al. 2010); value estimated by `estimate_surface_lapse.py` over all ice-free land | see RESULTS.md section 3 |
| marine margin | ice over a marine bed calves when thinner than flotation; no ice shelves | common simple-model choice | — |
| bed response | ELRA, tau = 3 kyr | Le Meur & Huybrechts (1996) | — |

No external code was copied. PISM (GPL-3) and PlaSim (GPL) were consulted as
documentation of methods only.

## Parameters: physical vs. adjusted global coefficients

All parameters are one number for the whole planet. `climate.py` labels each
`physical` (a measured constant or a standard value) or `global` (an
adjustable coefficient). Nothing depends on a place name or a region. The
coefficients adjusted against the teacher, and against what:

| coefficient | final | adjusted against |
| --- | --- | --- |
| `A_olr` | 199 W/m2 | global-mean temperature |
| `D_mse` | 0.30 W/m2/K | equator-to-pole temperature profile |
| `alb_zenith` | 0.26 | same |
| `K_vap` | 2e6 m2/s | midlatitude precipitation |
| `eddy_eff` | 0.30 | midlatitude precipitation |
| `div_ref` | 1.5e-6 1/s | desert/rain-forest contrast |
| `lapse` (column -> land surface) | 6.5 (E1) -> 4.5 K/km (E2) | elevation dependence of the temperature error over all ice-free land (the one fix) |
| `hadley_edge`, `phi_*` | 28 deg; -100/+400/-1200/0 m2/s2 | observed zonal-mean SLP and Hadley edge (textbook values, not fitted) |

The adjustment was a handful of hand-chosen runs (`calib.py`, 8-10 years
each, recorded in `results/RESULTS.md`), not an automatic search, and the
ice-sheet result was never used as a target. The ice model's parameters are
PISM/EISMINT defaults and were not adjusted at all.

## Data

| data | used for | kind | licence / terms |
| --- | --- | --- | --- |
| GEBCO_2026 grid, ice-surface (`worlds/kasoku-sekai/terrain/`, already in repo) | s_obs | compilation of observations | GEBCO terms: free use with attribution ("GEBCO Compilation Group (2026) GEBCO 2026 Grid") |
| GEBCO_2026 grid, sub-ice topography (`anti-kytera/data/gebco2026_subice_2048x1024.png`, built on a runner by `.github/workflows/anti-kytera-bed.yml`) | b_obs | compilation (BedMachine-based under ice) | same |
| Berkeley Earth Land+Ocean 1x1, monthly (`teacher.py`) | temperature teacher, 1991-2020 | **observational analysis** (stations + HadSST) | CC BY-NC 4.0 (Berkeley Earth). Only a derived 2-degree climatology is committed. |
| GPCP v2.3 monthly CDR (`teacher.py`) | precipitation teacher, 1991-2020 | **observational analysis** (satellite + gauge) | NOAA CDR, open use |

The teacher never enters the model as a field. Observed ice thickness is used
in exactly two places: restoring the ice-free bed, and the final comparison.

## Reproduce

```
pip install numpy scipy netCDF4 numba pillow matplotlib
python3 anti-kytera/model/teacher.py <raw-dir>      # raw-dir: be.nc + gpcp/*.nc from the S3 URLs in teacher_2deg.json
cd anti-kytera/model
python3 pipeline.py E1b_limiter_only --dx 60                      # first run  (~8 min climate + ~15 min ice)
python3 estimate_surface_lapse.py ../runs/E1b_limiter_only/climate.npz
python3 pipeline.py E2_fix --dx 60 --param lapse=0.0045            # after the one fix
python3 pipeline.py E2_S_slab1000 --dx 80 --init-ice 1000 --param lapse=0.0045 --clim-cache ../runs/E2_fix/climate.npz
python3 pipeline.py S_bed_none --bed none --dx 80                  # bedrock sensitivity (also: --bed flexure)
python3 test_halfar.py                                             # SIA vs analytic solution
python3 export_display.py "E1:E1b_limiter_only:初回" "E2:E2_fix:修整後" "S:E2_S_slab1000:参考:初期氷"
```
