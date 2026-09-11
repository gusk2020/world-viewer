// Loads and samples Climate v1's Earth wind teacher -- see
// docs/climate-v1-wind-validation.md and tools/build_wind_teacher.py for
// what this data is, where it comes from, and the 850hPa topographic mask.
//
// Same shape as js/climate-v1/temperature-teacher.js: takes raw bytes in
// (Node reads them with `fs`, a browser would `fetch().arrayBuffer()`), and
// stays ignorant of where those bytes came from.
//
// Each level (850hPa, 10m) carries eight plain Float32LE grids, one per
// field named in tools/build_wind_teacher.py's `FIELDS`: u, v,
// annualResultantSpeed, meanScalarSpeed, djfU, djfV, jjaU, jjaV -- all in
// m/s except where noted. See worlds/kasoku-sekai/teacher/wind-summary.json
// for exactly which file backs which field.

/** `bytes`: raw little-endian Float32 bytes for one field. `width`/`height`
 * come from wind-summary.json's `grids.<level>` block. */
export function parseWindGrid(bytes, { width, height }) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("parseWindGrid requires a finite width and height");
  }
  const expectedBytes = width * height * 4;
  const buffer = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`wind teacher grid size mismatch: expected ${expectedBytes} bytes for ${width}x${height}, got ${buffer.byteLength}`);
  }
  return { width, height, values: new Float32Array(buffer) };
}

/**
 * Builds one level's full teacher (u, v, annualResultantSpeed,
 * meanScalarSpeed) from a map of field name -> raw bytes, matching
 * wind-summary.json's `grids.<level>.files` keys.
 */
export function buildWindLevelTeacher(fieldBytes, { width, height }) {
  const fields = {};
  for (const [name, bytes] of Object.entries(fieldBytes)) {
    fields[name] = parseWindGrid(bytes, { width, height }).values;
  }
  return { width, height, ...fields };
}

/** One cell's value by flat index, honestly reporting a missing (below-
 * ground, at 850hPa) cell as null rather than 0 or NaN a caller might
 * silently average in. */
export function sampleWindCell(level, field, index) {
  const v = level[field][index];
  return Number.isFinite(v) ? v : null;
}

/** Nearest-neighbour lookup by longitude/latitude, matching this app's
 * row0=north/col0=-180 convention. Diagnostic/spot-check use; the bulk
 * comparison in tools/validate_wind_v1.mjs samples the model at the
 * teacher's own (coarser) cell centres instead, for the same reason
 * validate_temperature_v1.mjs does. */
export function sampleWindAt(level, field, lng, lat) {
  const x = Math.min(level.width - 1, Math.max(0, Math.floor(((lng + 180) / 360) * level.width)));
  const y = Math.min(level.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * level.height)));
  return sampleWindCell(level, field, y * level.width + x);
}
