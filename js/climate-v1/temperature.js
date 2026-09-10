// Climate v1's temperature field -- stage 3 of the redesigned pipeline
// (terrain -> land/sea -> temperature -> wind -> ...; see
// docs/climate-v1-redesign.md).
//
// Every number here comes from two functions already exported by the
// existing, shipped climate model (js/climate.js): `temperatureProfile`
// (the annual-mean sea-level temperature by latitude, from insolation
// alone) and `surfaceAnnualTemperatureC` (the lapse-rate/ocean-moderation
// step that turns a latitude's sea-level temperature into one point's
// surface temperature). Both are imported, not re-derived -- the whole
// point of this file is that Climate v1's temperature field is provably the
// same calculation Climate v0.8's painter already trusts, applied to an
// explicit terrain field instead of computed as a side effect of painting.
//
// **What must never happen here, by construction**: neither
// `temperatureProfile` nor `surfaceAnnualTemperatureC` takes vegetation,
// moisture, snow/ice state, or any teacher data as an input -- their
// signatures are latitude/tilt/params and isSea/seaLevelC/
// relativeElevationMetres/params respectively. There is no vegetation array,
// no moisture array, and no teacher array reachable from this file, so a
// future edit cannot accidentally wire one in without visibly changing this
// module's imports.
import { temperatureProfile, surfaceAnnualTemperatureC } from "../climate.js";

/**
 * Builds the annual-mean temperature field over a terrain field's own grid.
 *
 * Inputs, matching exactly what the task spec names: `params.meanTemperatureC`
 * (global mean), latitude (implicit in each row via the terrain field's own
 * row-to-degrees mapping), `axialTiltDegrees`, `relativeElevationMetres` and
 * `isSea` (both read from the terrain field, never recomputed here).
 *
 * The per-latitude sea-level temperature (`temperatureProfile`) is computed
 * on its own coarser row count (512, same as Climate v0.8) and mapped onto
 * the terrain field's rows by nearest coarse row -- the same mapping
 * `computeClimate`/`scoreAgainstTeacher` already use elsewhere in this
 * codebase, so a terrain field at any resolution lines up the same way the
 * existing model already does.
 */
export function buildTemperatureField({ terrainField, axialTiltDegrees, params }) {
  if (!terrainField) throw new Error("buildTemperatureField requires a terrain field");
  if (!Number.isFinite(axialTiltDegrees)) throw new Error("buildTemperatureField requires a finite axialTiltDegrees");

  const { width, height, isSea, relativeElevationMetres } = terrainField;
  const profile = temperatureProfile(axialTiltDegrees, params);
  const rowScale = profile.profileRows / height;

  const annualMeanTemperatureC = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const p = Math.min(profile.profileRows - 1, Math.floor(y * rowScale));
    const seaLevelC = profile.seaLevelC[p];
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const i = rowOffset + x;
      annualMeanTemperatureC[i] = surfaceAnnualTemperatureC({
        isSea: Boolean(isSea[i]),
        seaLevelC,
        relativeElevationMetres: relativeElevationMetres[i],
        params,
      });
    }
  }

  return {
    width, height, axialTiltDegrees,
    annualMeanTemperatureC,
    // Kept alongside the field: the per-latitude curve this grid was built
    // from, for anything that wants to inspect or re-plot it without
    // rebuilding (e.g. a teacher comparison averaged by latitude band).
    seaLevelCByProfileRow: profile.seaLevelC,
    profileRows: profile.profileRows,
    // The terrain field this was built against, so a caller can confirm
    // (e.g. in a test) which sea level this temperature field is
    // consistent with, without threading a second parameter everywhere.
    seaLevelMetres: terrainField.seaLevelMetres,
  };
}

function latitudeOfRow(y, height) {
  return (0.5 - (y + 0.5) / height) * 180;
}

/** One cell's annual mean temperature, by flat index. */
export function sampleTemperatureCell(field, index) {
  return field.annualMeanTemperatureC[index];
}

/** The same lookup by longitude/latitude, nearest-neighbour (see terrain.js
 * for why this layer does not interpolate). */
export function sampleTemperatureAt(field, lng, lat) {
  const x = Math.min(field.width - 1, Math.max(0, Math.floor(((lng + 180) / 360) * field.width)));
  const y = Math.min(field.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * field.height)));
  return sampleTemperatureCell(field, y * field.width + x);
}

export { latitudeOfRow };
