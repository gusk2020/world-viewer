# Expanded viewing layers (draft)

## Earth-derived colouring on the Moon and Mars

- Inputs: existing v1s terrain PNGs, `worlds/moon/terrain/lola118_ldem_2048x1024.png` (LOLA, datum 1,737,400 m sphere) and `worlds/mars/terrain/mola463_areoid_2048x1024.png` (MOLA areoid). RG bytes are decoded with each config's `offsetMetres`, then flipped from north-first to south-first; no new height offsets.
- `anti-kytera/stat/predict_planet.py` uses the same Earth training data and the same model, features, export grids and one global threshold used for Mercury and Venus. No lunar or Martian regional climate adjustment. The predicted climate is a fictional Earth-like dressing, not the observed environment. Source data and methods for this model remain in `anti-kytera/viewer/worlds/PLANETARY_V2.md` and the Earth results documents.
- The app assumes Earth composition, Earth-equivalent solar flux, gravity 1 g and no radiation. It uses obliquity and rotation direction in predictors; sidereal day and orbit periods are kept as metadata only. Moon 27.3217 days and Mars 686.98 days orbit periods are approximate constants.
- No teacher for these bodies. No Earth fit/holdout metric is shown as a planetary score.

## Viewing images

The four `photo.jpg` files are 2048×1024 or smaller copies of the [Solar System Scope planetary texture pack](https://www.solarsystemscope.com/textures/). Credit: Solar System Scope / INOVE, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Original direct URLs are recorded in each world's `config.json`. No image pixels are used as terrain or model inputs.

These are *composite, colour-adjusted viewing images*, not untouched photographs. The Venus surface is radar-derived and artificially coloured; it is not a visible-light photo of the cloud-covered planet. The distributor notes that unmapped gaps can contain fictional terrain and that colours are enhanced. This caveat applies to the image layer only. Do not infer DEM detail from a viewing image. The other four data layers remain separate from it.

## Display choices

- `標高色` colours Earth's existing input terrain (including the present ice surface) by measured height on the same 3D shape, independently of the Anti-KyTerra ice-free `岩盤` layer. The 2D map uses the identical rock colour ramp.
- `植生` retains the 15-class model and teacher bytes unchanged. `簡略5区分` groups the existing codes only when drawing: forests 11–18, savanna/grassland 19–20, shrubs 21–22, tundra 23, deserts/polar barrens 24–25. Every vegetated group is green. Ice and ocean still override vegetation. The centre readout on Earth also retains the original class name in parentheses. The simpler category's accuracy is not inferred from the old 15-class score.
- A grouped direct selector replaces cycling through every body: planets Earth/Mars/Mercury/Venus, satellite Moon. It does not alter the simulation.

The mean-temperature slider still does not recompute classification. Moving sea level changes the displayed water surface, with a visible warning that the 0 m prediction is fixed.
