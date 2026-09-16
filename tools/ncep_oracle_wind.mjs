// The NCEP oracle wind, loaded once and correctly.
//
// WHY THIS FILE EXISTS. NCEP/NCAR Reanalysis 1 marks a 850 hPa cell as
// missing where 850 hPa is **below ground** -- Tibet, Greenland, Antarctica,
// the Andes, the Rockies. Every diagnostic tool in this project used to
// regrid those cells as `u = v = 0`, which is not what "missing" means: it
// says the air there is dead still. In the Stage 5B transport solver the
// advection coefficients are |u|/dx and |v|/dy, so a genuinely calm cell with
// K = 0 has EXACTLY ZERO moisture as its solution, and hands zero to
// everything downwind. Measured, that one line of regridding produced 16.5%
// of land at q < 0.001 g/kg -- Tibet 100%, Greenland 90%, Antarctica 77% --
// and corrupted every oracle-wind number from Stage 5B.1 onward. See
// docs/climate-v1-dry-tail-diagnosis-stage5b.md.
//
// THE FILL, AND WHY THIS ONE. Masked cells are filled by **harmonic
// (Laplace) extension**: solve grad^2 u = 0 inside the masked region with the
// surrounding valid cells as Dirichlet boundary values, u and v separately,
// **on the teacher's own 144x73 grid before any regridding**. Reasons:
//   - It has no free parameter and no tunable shape, so nothing here can be
//     fitted to anything.
//   - The maximum principle guarantees the filled values lie between the
//     surrounding real ones: the fill cannot invent a jet, a reversal or a
//     calm that the observed field around the hole does not already imply.
//   - It is purely local and geography-blind -- the same operator runs over
//     Tibet, Greenland and a one-cell hole in the Andes, with no region ever
//     named.
// Rejected alternatives: nearest valid cell (picks a direction arbitrarily
// and leaves a discontinuity at the hole's edge); the zonal mean at that
// latitude (a latitude lookup table, the exact shape this project forbids);
// substituting the Stage 4 model wind (mixing the model into its own oracle).
//
// The plain 5-point Laplacian on grid indices is used rather than a
// cos(latitude)-weighted one. For a hole-filling operator the metric only
// changes how the interior is blended, never the boundary values it is
// blended between, and the weighted version would add arithmetic without
// changing what the fill is allowed to produce.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWindGrid } from "../js/climate-v1/wind-teacher.js";
import { buildOracleWind } from "../js/climate-v1/oracle-wind.js";

const nearestIn = (axis, v, wrap) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < axis.length; i++) { let d = Math.abs(axis[i] - v); if (wrap) d = Math.min(d, 360 - d); if (d < bd) { bd = d; best = i; } }
  return best;
};

/**
 * Loads one NCEP wind level, fills its below-ground cells harmonically, and
 * regrids it by coordinate onto a width x height model grid.
 *
 * `axes` supplies latitudes/longitudes when the summary does not carry them
 * (the 10 m level's T62 Gaussian rows come from the humidity teacher's own
 * fields on the same grid).
 */
export function loadNcepOracleWind({ teacherDir, levelKey = "level850hPa", width, height, axes = null, quiet = false }) {
  const summary = JSON.parse(readFileSync(path.join(teacherDir, "wind-summary.json"), "utf8"));
  const spec = summary.grids[levelKey];
  const u = parseWindGrid(readFileSync(path.join(teacherDir, spec.files.u)), spec).values;
  const v = parseWindGrid(readFileSync(path.join(teacherDir, spec.files.v)), spec).values;
  const lats = axes ? axes.latitudes : spec.latitudes;
  const lons = (axes ? axes.longitudes : spec.longitudes).map((l) => (l > 180 ? l - 360 : l));
  if (!lats || lats.length !== spec.height || !lons || lons.length !== spec.width) {
    throw new Error(`loadNcepOracleWind: no usable axes for ${levelKey} at ${spec.width}x${spec.height}`);
  }

  const built = buildOracleWind({
    u, v, width: spec.width, height: spec.height, latitudes: lats, longitudes: lons,
    targetWidth: width, targetHeight: height,
  });
  const wasMasked = new Uint8Array(width * height);
  {
    const m = new Uint8Array(spec.width * spec.height);
    for (let i = 0; i < m.length; i++) m[i] = Number.isFinite(u[i]) && Number.isFinite(v[i]) ? 0 : 1;
    for (let y = 0; y < height; y++) {
      const j = nearestIn(lats, 90 - ((y + 0.5) * 180) / height);
      for (let x = 0; x < width; x++) wasMasked[y * width + x] = m[j * spec.width + nearestIn(lons, -180 + ((x + 0.5) * 360) / width, true)];
    }
  }
  const { uWindMs: uu, vWindMs: vv, maskedCount } = built;
  if (!quiet) {
    console.log(`  ${levelKey}: ${spec.width}x${spec.height} -> ${width}x${height}, ` +
      `${maskedCount} below-ground cells harmonically filled ` +
      `(${built.fillIterations} iterations, residual ${built.fillResidual.toExponential(1)})`);
  }
  return { width, height, uWindMs: uu, vWindMs: vv, wasMasked, maskedCount, spec };
}
