// Everything that happens to the globe's colour texture: preparing the
// source photograph once at load, and repainting the parts of it that lie
// below the datum in a depth ramp. It works on plain pixel buffers and
// knows nothing about three.js, the camera, or the sea sphere.

import { sampleGridMetres } from "./elevation.js";

// Two fixes to the source photo, both applied once at load rather than
// per frame: a gamma lift and a polar low-pass (see below for each).
// Returns a canvas, so the caller can upload it as a texture and later
// repaint it in place.
export function prepareSurfaceTexture(image, gamma) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Forests etc. measured very dark in the source imagery (RGB ~30-60/255
  // for rainforest against ~240 for desert) -- confirmed baked into the
  // photo itself, not a lighting artifact on top of it. A gamma curve below
  // 1 lifts shadows far more than highlights (black stays black, white
  // stays white), so it fixes the dark greens without blowing out deserts,
  // ice and cloud. Per the user's explicit "リアルさより分かりやすさ"
  // direction. Through a 256-entry table rather than a Math.pow per pixel.
  const lut = new Uint8ClampedArray(256);
  for (let level = 0; level < 256; level++) {
    lut[level] = Math.round(255 * Math.pow(level / 255, gamma));
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }

  lowPassPolarRows(data, canvas.width, canvas.height);

  context.putImageData(imageData, 0, 0);
  return canvas;
}

// An equirectangular image gives every latitude the same pixel width, but
// the circle it wraps around shrinks by cos(latitude) -- so near the poles
// the image carries far more longitudinal detail than the globe can
// physically hold, roughly 1/cos(lat) times too much. Rendered, that
// surplus detail is what smears into faint radial streaks around a pole.
//
// Averaging each row over a 1/cos(lat)-wide window discards exactly the
// information that was never really there, which is ordinary correct
// anti-aliasing for this projection rather than a cover-up: this is a
// property of the *photo*, and it was verified to be the only remaining
// cause here by rendering the pole with the texture removed entirely and
// finding a perfectly smooth surface. The mesh itself has no pole (see
// cubeSphere.js) and needs no smoothing of any kind.
//
// A circular running sum keeps this O(width) per row no matter how wide
// the window grows, which matters because the window reaches most of the
// image width in the last row or two.
function lowPassPolarRows(data, width, height) {
  const row = new Float32Array(width);

  for (let y = 0; y < height; y++) {
    const latitude = (0.5 - (y + 0.5) / height) * Math.PI;
    const window = Math.round(1 / Math.max(Math.cos(latitude), 1e-6));
    if (window <= 1) continue;

    const radius = Math.min(window >> 1, width >> 1);
    if (radius < 1) continue;

    const span = 2 * radius + 1;
    const base = y * width * 4;

    for (let channel = 0; channel < 3; channel++) {
      for (let x = 0; x < width; x++) {
        row[x] = data[base + x * 4 + channel];
      }

      let sum = 0;
      for (let d = -radius; d <= radius; d++) {
        sum += row[((d % width) + width) % width];
      }

      for (let x = 0; x < width; x++) {
        data[base + x * 4 + channel] = Math.round(sum / span);
        sum -= row[(((x - radius) % width) + width) % width];
        sum += row[(((x + radius + 1) % width) + width) % width];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Seabed colouring
//
// Repaints everything below the datum in a depth ramp, so draining the
// water actually reveals *ground* rather than the blue the satellite photo
// painted there. Turning the water off alone was never going to work: the
// seabed's blue lives in the photograph, not in the water.
//
// Only the colour is invented -- it is a function of real measured depth,
// and the shape and shading stay entirely real. There is no photograph of
// the seabed to be faithful to.
// ---------------------------------------------------------------------------

// Colour stops as [depthFraction, [r, g, b]], shallow first. Absent from
// this table (and so left as the original photograph) is the "photo"
// option, which is the default and costs nothing at load.
export const SEABED_RAMPS = {
  brown: [
    [0, [216, 194, 146]],
    [0.35, [166, 132, 86]],
    [1, [74, 52, 32]],
  ],
  grey: [
    [0, [190, 186, 178]],
    [0.35, [138, 134, 128]],
    [1, [58, 56, 54]],
  ],
  land: [
    [0, [126, 148, 88]],
    [0.35, [140, 126, 82]],
    [1, [92, 72, 50]],
  ],
};

export function rampLut(stops) {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let hi = 1;
    while (hi < stops.length - 1 && stops[hi][0] < t) hi++;
    const [t0, c0] = stops[hi - 1];
    const [t1, c1] = stops[hi];
    const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    lut[i * 3] = c0[0] + (c1[0] - c0[0]) * k;
    lut[i * 3 + 1] = c0[1] + (c1[1] - c0[1]) * k;
    lut[i * 3 + 2] = c0[2] + (c1[2] - c0[2]) * k;
  }
  return lut;
}

// Deciding what to repaint, once. The result is one byte per texture
// pixel: 0 means "leave the photograph alone", anything else is a ramp
// index plus one. It depends only on the elevation grid and the photo,
// never on the chosen colour, so it survives every style switch and makes
// those switches cheap -- about 60 ms each instead of repeating this work.
//
// The colour texture and the elevation grid are both equirectangular with
// the same orientation, so pixels map onto each other by plain index
// scaling. Depth comes through the shared bilinear sampler in elevation.js,
// which is what puts the 0 m contour between grid cells instead of on a
// cell boundary; nearest-neighbour would paint the grid's own ~20 km cells
// as visible staircase blocks along every drained coastline.
//
// An earlier version also faded the ramp in over the shallowest 60 m. It
// did nothing for the staircase and instead left a blue rim of leftover
// photograph hugging every drained coast (reported from the phone, then
// reproduced and isolated by rendering with and without it). **Never blend
// the seabed back toward the photograph**: the photo's shallow water is
// bright cyan, so any blending toward it paints water onto ground.
export function buildSeabedPlan(photo, width, height, elevation, deepestMetres) {
  const plan = new Uint8Array(width * height);
  const shadeScale = 255 / deepestMetres;
  const xScale = elevation.width / width;
  const yScale = elevation.height / height;

  for (let y = 0; y < height; y++) {
    const fy = (y + 0.5) * yScale - 0.5;
    let i = y * width;
    for (let x = 0; x < width; x++, i++) {
      const metres = sampleGridMetres(elevation, (x + 0.5) * xScale - 0.5, fy);
      if (metres >= 0) continue;
      // Ramp index 0-254 (255 is left free so 0 can mean "not painted";
      // the two deepest steps differ by well under one RGB unit).
      plan[i] = 1 + Math.min(254, (-metres * shadeScale) | 0);
    }
  }

  growSeabedOverWater(plan, photo, width, height);
  return plan;
}

// A pixel the elevation grid calls dry but the photograph plainly shows as
// open water still gets repainted. That is what was left of the blue rim
// after the fade was removed: the elevation data's 0 m contour and the
// satellite photo's own coastline disagree by about a pixel, and every
// disagreement left a speck of leftover sea colour stranded on the drained
// shore -- clearly visible around Japan, the Indonesian islands and the
// Baltic in the user's screenshots.
//
// Measured rather than assumed. Resampling the pass from the committed
// 4096x2048 elevation level removed only 4% of those specks, so this is a
// disagreement between two datasets, not a resolution shortfall -- worth
// knowing, because it also means there is no bigger download that would
// fix it.
//
// Two guards keep this from repainting things that are not sea:
//   - The water test is a blue *ratio*, not a blue difference. Measured
//     across the actual texture, open water sits at 0.55-0.76 while snow
//     and ice sit at 0.00-0.09 and every land cover is negative, so the
//     0.30 threshold has an enormous margin and leaves the ice caps alone.
//   - Growth spreads outward from genuinely submerged pixels and stops
//     after a few steps, so it cleans a shoreline without wandering up
//     rivers into inland lakes. Unbounded, it drains the Great Lakes
//     through the St. Lawrence; three steps gets 91% of the specks and
//     goes nowhere near them.
const SEABED_RIM_PASSES = 3;
const WATER_BLUE_RATIO = 0.3;

function growSeabedOverWater(plan, photo, width, height) {
  const looksLikeWater = (i) => {
    const p = i * 4;
    const r = photo[p];
    const g = photo[p + 1];
    const b = photo[p + 2];
    return b > g && b - r > b * WATER_BLUE_RATIO;
  };

  // Seed with the submerged pixels that actually touch dry ground; the
  // open ocean's interior has nothing to spread into.
  let frontier = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!plan[i]) continue;
      const left = x === 0 ? i + width - 1 : i - 1;
      const right = x === width - 1 ? i - width + 1 : i + 1;
      if (
        !plan[left] ||
        !plan[right] ||
        (y > 0 && !plan[i - width]) ||
        (y < height - 1 && !plan[i + width])
      ) {
        frontier.push(i);
      }
    }
  }

  for (let pass = 0; pass < SEABED_RIM_PASSES && frontier.length; pass++) {
    const next = [];
    for (const i of frontier) {
      const x = i % width;
      const y = (i - x) / width;
      const neighbours = [
        x === 0 ? i + width - 1 : i - 1,
        x === width - 1 ? i - width + 1 : i + 1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || plan[n] || !looksLikeWater(n)) continue;
        plan[n] = 1; // shallowest step: these pixels sit right at 0 m.
        next.push(n);
      }
    }
    frontier = next;
  }
}

export function paintSeabed(data, plan, lut) {
  for (let i = 0, out = 0; i < plan.length; i++, out += 4) {
    const step = plan[i];
    if (!step) continue;
    const shade = (step - 1) * 3;
    data[out] = lut[shade];
    data[out + 1] = lut[shade + 1];
    data[out + 2] = lut[shade + 2];
  }
}
