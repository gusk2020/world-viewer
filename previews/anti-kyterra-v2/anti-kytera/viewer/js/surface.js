// The 標準 photograph (from v1s's js/surface.js): prepared once at load --
// gamma lift and polar low-pass -- on plain pixel buffers, no three.js.

// Two fixes to the source photo, both applied once at load rather than
// per frame: a gamma lift and a polar low-pass (see below for each).
// Returns a canvas, so the caller can upload it as a texture.
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
