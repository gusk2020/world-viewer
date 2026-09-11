// Loads and samples Climate v1's Earth temperature teacher -- see
// docs/climate-v1-temperature-validation.md and
// tools/build_temperature_teacher.py for what this data is and where it
// comes from. Deliberately tiny and dependency-free: the teacher is a plain
// Float32LE grid (worlds/kasoku-sekai/teacher/temperature-annual-mean-c.bin),
// so parsing it is one typed-array view, not a format decoder.
//
// This module takes bytes in, not a file path or a URL -- Node reads the
// bytes with `fs`, a browser would `fetch().arrayBuffer()`, and this file
// stays ignorant of either, the same separation js/elevation.js keeps
// between "decode this raster" and "get the bytes from somewhere".

/**
 * `bytes`: an ArrayBuffer (or a Node Buffer, which IS a view over one) holding
 * the raw little-endian Float32 grid. `width`/`height` come from the
 * summary JSON alongside it (temperature-summary.json's `grid` block) --
 * not re-derived here, so a mismatched pair fails loudly instead of
 * mis-parsing.
 */
export function parseTemperatureTeacher(bytes, { width, height }) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("parseTemperatureTeacher requires a finite width and height");
  }
  const expectedBytes = width * height * 4;
  const buffer = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `temperature teacher grid size mismatch: expected ${expectedBytes} bytes for ${width}x${height}, got ${buffer.byteLength}`
    );
  }
  const annualMeanC = new Float32Array(buffer);
  return { width, height, annualMeanC };
}

/** One cell's value by flat index, honestly reporting a missing cell as null
 * rather than as a silent 0 or NaN a caller might average into a mean. */
export function sampleTeacherCell(field, index) {
  const v = field.annualMeanC[index];
  return Number.isFinite(v) ? v : null;
}

/** Nearest-neighbour lookup by longitude/latitude, matching the same
 * row0=north/col0=-180 convention every other grid in this app uses. This
 * teacher's own native resolution (1 degree) is coarser than a nearest
 * lookup needs to worry about interpolating -- the model side of any
 * comparison already resamples onto this grid's own cell centres (see
 * tools/validate_temperature_v1.mjs), so this function exists for spot
 * checks, not for the bulk comparison loop. */
export function sampleTeacherAt(field, lng, lat) {
  const x = Math.min(field.width - 1, Math.max(0, Math.floor(((lng + 180) / 360) * field.width)));
  const y = Math.min(field.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * field.height)));
  return sampleTeacherCell(field, y * field.width + x);
}
