// Loader for Stage 5A's humidity teacher: Earth's real annual-mean surface
// pressure, near-surface air temperature and near-surface humidity, for
// Climate v1's humidity thermodynamics to be *validated* against -- never
// fitted to. Stage 5A has no free parameters to fit with, which is what
// makes that promise structural rather than a matter of discipline.
//
// Takes raw bytes rather than a path or a URL, same as the temperature and
// wind teachers, so that node reads them from disk and a browser could read
// them from a fetch with no branch in here.
//
// The on-disk format is identical to the wind teacher's -- a plain
// Float32Array in row-major order, row 0 = north -- so the single
// implementation is reused rather than copied. This project has one
// standing lesson about a sampler that existed twice and could have drifted
// (see CLAUDE.md, the V0.6 cleanup pass); one parser is the same principle.
import { parseWindGrid } from "./wind-teacher.js";

/**
 * Parse one teacher grid from raw bytes.
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{width: number, height: number}} spec from humidity-summary.json
 */
export function parseTeacherGrid(bytes, spec) {
  return parseWindGrid(bytes, spec);
}

/**
 * Nearest-cell sample from a teacher grid. Deliberately nearest rather than
 * interpolated: the project's standing rule is not to present data as finer
 * than it is.
 */
export function sampleTeacherGrid(grid, lng, lat) {
  const x = Math.min(grid.width - 1, Math.max(0, Math.floor(((lng + 180) / 360) * grid.width)));
  const y = Math.min(grid.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * grid.height)));
  return grid.values[y * grid.width + x];
}
