// The observed-wind oracle, as pure functions so node tools and the browser
// share one implementation.
//
// **Diagnostic only.** This is real Earth wind (NCEP/NCAR Reanalysis 1) and is
// never the production wind model: Climate v1's own wind is js/climate-v1/
// wind.js, which works on any world. The preview offers it side by side with
// the model's own so that the difference can be seen rather than argued about.
//
// NCEP marks a 850 hPa cell missing where 850 hPa is **below ground**. Those
// cells must not be read as calm -- in the moisture solver the advection
// coefficients are |u|/dx and |v|/dy, so a calm cell with no diffusion has
// exactly zero moisture and hands zero to everything downwind. They are filled
// by harmonic (Laplace) extension: no free parameter, and the maximum
// principle forbids the fill inventing a jet, a reversal or a calm that the
// surrounding observed field does not already imply. See
// docs/climate-v1-oracle-wind-fix.md.

/** Solves grad^2 f = 0 over the masked cells, with the unmasked ones as fixed
 * boundary values. Longitude wraps; the pole rows stand in for their own
 * missing neighbour, which is a no-flux edge rather than an invented value. */
export function harmonicFill(values, width, height, masked, { maxIterations = 20000, tolerance = 1e-7 } = {}) {
  const out = Float64Array.from(values);
  let sum = 0, n = 0;
  for (let i = 0; i < out.length; i++) if (!masked[i]) { sum += out[i]; n++; }
  if (n === 0) throw new Error("harmonicFill: every cell is masked");
  const seed = sum / n;
  for (let i = 0; i < out.length; i++) if (masked[i]) out[i] = seed;

  let iterations = 0, residual = Infinity;
  for (let it = 0; it < maxIterations; it++) {
    residual = 0;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const north = y === 0 ? row : row - width;
      const south = y === height - 1 ? row : row + width;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        if (!masked[i]) continue;
        const next = (out[row + ((x + 1) % width)] + out[row + ((x + width - 1) % width)] +
          out[north + x] + out[south + x]) / 4;
        const d = Math.abs(next - out[i]);
        if (d > residual) residual = d;
        out[i] = next;
      }
    }
    iterations = it + 1;
    if (residual < tolerance) break;
  }
  return { values: out, iterations, residual };
}

const nearestIn = (axis, v, wrap) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < axis.length; i++) { let d = Math.abs(axis[i] - v); if (wrap) d = Math.min(d, 360 - d); if (d < bd) { bd = d; best = i; } }
  return best;
};

/**
 * Fills the below-ground cells and regrids by coordinate onto a
 * width x height model grid. `u`/`v` may contain NaN, which is what marks a
 * missing cell; `latitudes`/`longitudes` are the source grid's own axes.
 */
export function buildOracleWind({ u, v, width: sw, height: sh, latitudes, longitudes, targetWidth: width, targetHeight: height }) {
  if (!latitudes || latitudes.length !== sh || !longitudes || longitudes.length !== sw) {
    throw new Error(`buildOracleWind needs the source grid's own axes for ${sw}x${sh}`);
  }
  const lons = Array.from(longitudes, (l) => (l > 180 ? l - 360 : l));
  const masked = new Uint8Array(sw * sh);
  let maskedCount = 0;
  for (let i = 0; i < masked.length; i++) {
    if (!Number.isFinite(u[i]) || !Number.isFinite(v[i])) { masked[i] = 1; maskedCount++; }
  }
  const fu = maskedCount > 0 ? harmonicFill(u, sw, sh, masked) : { values: Float64Array.from(u), iterations: 0, residual: 0 };
  const fv = maskedCount > 0 ? harmonicFill(v, sw, sh, masked) : { values: Float64Array.from(v), iterations: 0, residual: 0 };

  const uu = new Float64Array(width * height), vv = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const j = nearestIn(latitudes, 90 - ((y + 0.5) * 180) / height);
    for (let x = 0; x < width; x++) {
      const i = j * sw + nearestIn(lons, -180 + ((x + 0.5) * 360) / width, true);
      const k = y * width + x;
      uu[k] = fu.values[i]; vv[k] = fv.values[i];
    }
  }
  return { width, height, uWindMs: uu, vWindMs: vv, maskedCount, fillIterations: Math.max(fu.iterations, fv.iterations), fillResidual: Math.max(fu.residual, fv.residual) };
}
