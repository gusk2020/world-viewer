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
 *   isSea                    sourceElevationMetres < seaLevelMetres.
 *
 * Takes the already-decoded `{ width, height, metres }` grid
 * (js/elevation.js's decodeElevationGrid output) rather than re-parsing a
 * PNG, so this has zero cost beyond one pass over an array that already
 * exists in memory, and re-running it on a new seaLevelMetres (the sea-level
 * slider) is cheap enough to do on every change.
 */
export function buildTerrainField({
  elevationGrid, seaLevelMetres,
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
  const isSea = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const source = metres[i];
    relativeElevationMetres[i] = source - seaLevelMetres;
    isSea[i] = source < seaLevelMetres ? 1 : 0;
  }
  return {
    width, height, seaLevelMetres,
    sourceElevationMetres: metres,
    relativeElevationMetres,
    isSea,
    terrainState,
    terrainSourceLabel,
  };
}

/** One cell's four quantities, by flat index. For spot checks and tests --
 * the hot paths in temperature.js read the typed arrays directly. */
export function sampleTerrainCell(field, index) {
  return {
    sourceElevationMetres: field.sourceElevationMetres[index],
    seaLevelMetres: field.seaLevelMetres,
    relativeElevationMetres: field.relativeElevationMetres[index],
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
