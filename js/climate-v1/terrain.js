// Climate v1's terrain field -- the first stage of the redesigned pipeline
// (terrain -> land/sea -> temperature -> wind -> ...; see
// docs/climate-v1-redesign.md for the whole chain and why it is being built
// this way).
//
// This is deliberately the simplest file in climate-v1: it reads the same
// decoded elevation grid the app already has (js/elevation.js's
// decodeElevationGrid, which Climate v0.8's own computeGeography also
// consumes) and turns it into a small set of named, independently
// inspectable per-cell quantities. Nothing here knows about temperature,
// wind, moisture, or any teacher data -- if a future change needs a term to
// depend on terrain, it reads this field, not the raw elevation raster
// again.
//
// **Physical, not visual.** `verticalExaggeration` (js/globe3d.js) inflates
// the *displayed* relief so a planet does not render as a featureless ball;
// none of that belongs here. Every metre in this file is what the source
// data says, or a plain subtraction of two such metres. Climate v1 must
// never read a exaggerated/displayed radius for a physical calculation, and
// nothing in this file is capable of producing one.

/**
 * What kind of surface a terrain source actually measures. Not a claim
 * about which one is "correct" -- ice-surface, bedrock and a deglaciated
 * equilibrium are three different, all-legitimate questions to ask about a
 * planet, and today's committed data can only answer the first.
 */
export const TERRAIN_STATES = {
  // GEBCO_2026's own definition: the elevation of whatever is on top --
  // rock, sea, or ice. Over Antarctica and Greenland this is the *ice
  // surface*, not the bedrock underneath. This is the only state this
  // project has real committed data for.
  ICE_SURFACE: "ice-surface",
  // The rock surface an ice sheet would leave behind if it vanished with
  // nothing else changing. Reserved name only -- no bedrock dataset is
  // fetched or referenced anywhere in this codebase yet.
  BEDROCK: "bedrock",
  // A bedrock surface additionally allowed to rebound under the removed
  // ice's weight (glacial isostatic adjustment). Reserved name only.
  // **Explicitly out of scope**: computing this requires a real GIA model
  // (mantle viscosity, ice-load history, a solver), and "just lift the rock
  // where the ice was" is not a substitute for one -- it would be inventing
  // a number with no physical basis, which this project's own standing rule
  // (real data over a plausible-looking fake) rules out. Do not implement
  // this by approximation.
  DEGLACIATED_EQUILIBRIUM: "deglaciated-equilibrium",
};

/**
 * Builds the terrain field: for every cell of the source elevation grid,
 * the four quantities Climate v1's later stages are allowed to read.
 *
 *   sourceElevationMetres    the raw grid value, untouched.
 *   seaLevelMetres           the scalar sea level this field was built
 *                            against. Physically the same number at every
 *                            cell, so it is stored once rather than
 *                            duplicated across the whole grid; sampleCell()
 *                            below still hands it back per cell so the
 *                            interface matches the four-quantity contract
 *                            exactly.
 *   relativeElevationMetres  sourceElevationMetres - seaLevelMetres. This,
 *                            never the absolute elevation, is what a lapse-
 *                            rate temperature correction must use -- see
 *                            js/climate-v1/temperature.js.
 *   isBelowSeaLevel          sourceElevationMetres < seaLevelMetres. Kept
 *                            separately because it is NOT the same question
 *                            as isSea -- see below.
 *   isSea                    below sea level AND connected to the world's
 *                            ocean. See THE LAND/SEA RULE below.
 *
 * ---------------------------------------------------------------------------
 * THE LAND/SEA RULE, AND WHY IT IS NOT JUST AN ELEVATION TEST
 *
 * This used to be `isSea = sourceElevationMetres < seaLevelMetres`, and that
 * is wrong in a way that matters: **dry land below sea level exists.** The
 * Jordan valley, the Danakil depression, the Turfan and Qattara depressions
 * and the whole Dead Sea basin are endorheic -- below sea level, and not
 * ocean. A pure elevation test calls all of them ocean, which makes them
 * false evaporation sources the moment anything reads `isSea` as "water to
 * evaporate from" (Stage 5B does exactly that), and gives them an ocean's
 * temperature moderation today.
 *
 * The replacement is topological rather than a different number:
 *
 *   a cell is sea if it is below sea level AND connected, through other
 *   below-sea-level cells, to somewhere already known to be ocean.
 *
 * "Known to be ocean" is three things, in order of how much they assume:
 *   1. the pole rows -- on any world, the top and bottom of the map;
 *   2. the deepest cell on the whole grid, so a world whose poles are dry
 *      land still finds its ocean;
 *   3. every cell an independent `oceanMask` calls ocean, if one is given.
 *
 * Longitude wraps, so the flood fill crosses the antimeridian; latitude
 * does not.
 *
 * **Why (3) is needed and is not redundant.** At this grid's ~20 km cells a
 * strait narrower than one cell does not exist, so connectivity alone
 * severs real ocean: measured on the committed raster, the Black Sea, the
 * Sea of Azov, the Sea of Marmara and Lake Maracaibo all come out
 * disconnected, because the Bosphorus, the Kerch strait and the Tablazo
 * strait are each a few kilometres wide. An independent statement of where
 * the ocean is repairs exactly those and nothing else.
 *
 * **It is used as a seed, not as a vote.** An earlier version asked whether
 * a majority of each disconnected body was ocean in the mask, and that
 * fails: at 0.5 degrees the mask calls the Sea of Azov 44% ocean, the Sea
 * of Marmara 29% and Lake Maracaibo 19%, so a majority rule would call all
 * three land. Seeding has no threshold at all -- one ocean cell anywhere in
 * a body is enough -- and it cannot produce a false positive here, because
 * measured across all 358 below-sea-level bodies on the committed raster
 * the ones that are not ocean contain **exactly zero** mask-ocean cells.
 * There is no number in the middle to tune.
 *
 * **The mask is optional and only ever adds sea.** A world without one (and
 * every world today except Earth) falls back to connectivity alone, which
 * is still strictly better than the elevation test. Nothing here can turn a
 * cell at or above sea level into sea, so open coastlines are exactly where
 * the elevation data puts them, and `sourceElevationMetres` is untouched.
 *
 * **Lakes are land here, deliberately.** The Caspian, Lake Baikal and the
 * Dead Sea itself come out land, because `isSea` means "the world's ocean"
 * -- which is what sea level physically defines and what the temperature
 * stage's ocean moderation assumes. A lake is a real moisture source and
 * this pipeline has no concept of one; inventing lakes here would be a
 * feature, not a bug fix. Recorded as a known gap rather than guessed at.
 *
 * Takes the already-decoded `{ width, height, metres }` grid
 * (js/elevation.js's decodeElevationGrid output) rather than re-parsing a
 * PNG, so this has zero cost beyond one pass over an array that already
 * exists in memory, and re-running it on a new seaLevelMetres (the sea-level
 * slider) is cheap enough to do on every change.
 */
export function buildTerrainField({
  elevationGrid, seaLevelMetres, oceanMask = null,
  terrainState = TERRAIN_STATES.ICE_SURFACE, terrainSourceLabel = "",
}) {
  if (!elevationGrid || !elevationGrid.metres) {
    throw new Error("buildTerrainField requires a decoded elevation grid ({ width, height, metres })");
  }
  if (!Number.isFinite(seaLevelMetres)) {
    throw new Error("buildTerrainField requires a finite seaLevelMetres");
  }
  const { width, height, metres } = elevationGrid;
  const n = width * height;
  const relativeElevationMetres = new Float32Array(n);
  const isBelowSeaLevel = new Uint8Array(n);
  let deepest = 0;
  for (let i = 0; i < n; i++) {
    const source = metres[i];
    relativeElevationMetres[i] = source - seaLevelMetres;
    isBelowSeaLevel[i] = source < seaLevelMetres ? 1 : 0;
    if (source < metres[deepest]) deepest = i;
  }

  const isSea = floodOceanFrom(isBelowSeaLevel, width, height, deepest, oceanMask);

  return {
    width, height, seaLevelMetres,
    sourceElevationMetres: metres,
    relativeElevationMetres,
    isBelowSeaLevel,
    isSea,
    oceanMaskApplied: Boolean(oceanMask),
    terrainState,
    terrainSourceLabel,
  };
}

/**
 * Flood the ocean outward from everywhere already known to be ocean, through
 * below-sea-level cells only. Longitude wraps; latitude does not.
 *
 * An explicit typed-array stack rather than recursion or a plain array: the
 * whole grid can be one connected body (Earth's ocean is 1.38 million of the
 * 2.1 million cells), so the worst case has to be a real data structure.
 */
function floodOceanFrom(isBelowSeaLevel, width, height, deepestIndex, oceanMask) {
  const n = width * height;
  const isSea = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;

  const push = (i) => {
    if (isBelowSeaLevel[i] && !isSea[i]) {
      isSea[i] = 1;
      stack[top++] = i;
    }
  };

  // 1. the pole rows, 2. the deepest cell.
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  push(deepestIndex);

  // 3. every cell an independent ocean mask calls ocean. Sampled
  // nearest-neighbour, because the mask may be coarser than the elevation
  // grid (Earth's is 720x360 against 2048x1024) and this is a seed, not a
  // measurement -- no interpolation would mean anything here.
  if (oceanMask) {
    const { width: mw, height: mh, isOcean } = oceanMask;
    if (!mw || !mh || !isOcean) {
      throw new Error("buildTerrainField's oceanMask needs { width, height, isOcean }");
    }
    for (let y = 0; y < height; y++) {
      const my = Math.min(mh - 1, Math.floor((y * mh) / height));
      const row = y * width;
      const mRow = my * mw;
      for (let x = 0; x < width; x++) {
        const mx = Math.min(mw - 1, Math.floor((x * mw) / width));
        if (isOcean[mRow + mx]) push(row + x);
      }
    }
  }

  while (top > 0) {
    const i = stack[--top];
    const x = i % width;
    const y = (i - x) / width;
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
    push(x === 0 ? i + width - 1 : i - 1);
    push(x === width - 1 ? i - width + 1 : i + 1);
  }
  return isSea;
}

/** One cell's four quantities, by flat index. For spot checks and tests --
 * the hot paths in temperature.js read the typed arrays directly. */
export function sampleTerrainCell(field, index) {
  return {
    sourceElevationMetres: field.sourceElevationMetres[index],
    seaLevelMetres: field.seaLevelMetres,
    relativeElevationMetres: field.relativeElevationMetres[index],
    isBelowSeaLevel: Boolean(field.isBelowSeaLevel[index]),
    isSea: Boolean(field.isSea[index]),
  };
}

/** The same lookup by longitude/latitude, nearest-neighbour (this field is
 * for inspection and for feeding the next stage, not for display -- no
 * bilinear smoothing is needed at this layer). `lng`/`lat` in degrees,
 * matching the rest of the app's convention (row 0 = north pole, column 0
 * = -180 degrees). */
export function sampleTerrainAt(field, lng, lat) {
  const x = Math.min(field.width - 1, Math.max(0, Math.floor(((lng + 180) / 360) * field.width)));
  const y = Math.min(field.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * field.height)));
  return sampleTerrainCell(field, y * field.width + x);
}
