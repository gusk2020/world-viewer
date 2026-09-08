// Colouring a body by height, the way a physical relief globe does it:
// deep water dark blue, shallow water light blue, then the coast, lowland,
// upland and finally bare rock and snow. Used for worlds that have no
// surface photograph -- Mars and the Moon arrive as elevation and nothing
// else -- while Earth keeps its satellite imagery.
//
// The whole ramp is a 1-D texture and the mesh's `u` coordinate *is* the
// vertex's height. That has one property worth the whole design: the colour
// scale is defined relative to the virtual sea, and moving the sea is then
// a pure shift along `u`, i.e. one texture-offset assignment per slider
// step. Recolouring 8 million texture pixels, or 400k vertex colours, on
// every frame of a slider drag would be far too slow on a phone; this
// costs nothing at all, so newly drained ground turns green the instant it
// is exposed instead of staying blue (which is exactly the complaint the
// Earth version had to be fixed for).
//
// Because `u` carries height rather than longitude, these worlds never need
// the antimeridian seam split or the polar low-pass that an
// equirectangular photograph forces on Earth -- there is no wrapped image
// to tear or oversample.
import * as THREE from "three";

const RAMP_WIDTH = 1024;

// `stops` is [metresRelativeToSeaLevel, [r, g, b]], low to high, and lives
// in each world's config.json so a body's palette can be tuned to its own
// elevation range without touching code. Earth's own numbers are useless
// for Mars, whose relief spans nearly 30 km.
export function buildHypsometricRamp(stops) {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error("display.hypsometric.stops needs at least two entries");
  }
  const minMetres = stops[0][0];
  const maxMetres = stops[stops.length - 1][0];
  const spanMetres = maxMetres - minMetres;
  if (!(spanMetres > 0)) {
    throw new Error("display.hypsometric.stops must increase in metres");
  }

  const data = new Uint8Array(RAMP_WIDTH * 4);
  let hi = 1;
  for (let i = 0; i < RAMP_WIDTH; i++) {
    const metres = minMetres + ((i + 0.5) / RAMP_WIDTH) * spanMetres;
    while (hi < stops.length - 1 && stops[hi][0] < metres) hi++;
    const [m0, c0] = stops[hi - 1];
    const [m1, c1] = stops[hi];
    const k = m1 === m0 ? 0 : Math.min(1, Math.max(0, (metres - m0) / (m1 - m0)));
    data[i * 4] = c0[0] + (c1[0] - c0[0]) * k;
    data[i * 4 + 1] = c0[1] + (c1[1] - c0[1]) * k;
    data[i * 4 + 2] = c0[2] + (c1[2] - c0[2]) * k;
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, RAMP_WIDTH, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Heights outside the ramp clamp to its ends rather than wrapping round
  // to the opposite colour -- past the deepest stop stays deep blue, past
  // the highest stays white. That matters because the sea-level offset
  // deliberately pushes coordinates out of [0, 1].
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return {
    texture,
    // Height -> ramp coordinate, with the sea at 0 m. The sea's own
    // position is applied separately as a texture offset, so this is fixed
    // for the life of the mesh.
    uForMetres: (metres) => (metres - minMetres) / spanMetres,
    // Shifting the whole scale down by the sea level is the same as sliding
    // the ramp along u, which is why the slider is free.
    offsetForSeaLevel: (seaLevelMetres) => -seaLevelMetres / spanMetres,
    minMetres,
    maxMetres,
  };
}
