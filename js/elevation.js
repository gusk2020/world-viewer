// Reading the world's elevation data. Nothing here knows how the globe is
// drawn, which body it belongs to, or what the heights will be used for --
// it turns an encoded raster into "metres at this lng/lat" and stops there.
// Both the terrain mesh and the seabed colouring sample through it, which
// is what keeps the two from drifting apart.

// Elevation arrives as a PNG carrying real metres, not a brightness ramp:
// each pixel's red and green channels are the high and low byte of an
// unsigned 16-bit value, and metres = (R*256 + G) - offsetMetres. PNG
// because it is lossless -- a JPEG would corrupt the byte packing -- and
// two 8-bit channels because a canvas always hands back 8-bit samples, so
// a genuine 16-bit greyscale PNG would silently lose its low byte on read.
// The encoding parameters live in the world's config.json rather than here,
// so this code stays independent of any one world's data.
//
// Decoded once into an Int16Array of plain metres rather than kept as the
// raw RGBA the canvas returns: half the memory (4 MB instead of 8 for the
// level actually loaded) and no unpacking arithmetic in the two hot loops
// that read it -- the 393k-vertex mesh build and the 8.4M-pixel seabed
// pass. Int16 covers any real planetary relief with room to spare; Earth's
// own range is about -10.9 km to +8.8 km.
export function decodeElevationGrid(image, encoding) {
  if (encoding.type !== "rg16-metres") {
    throw new Error(`unsupported elevation encoding: ${encoding.type}`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

  const metres = new Int16Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < metres.length; i++, p += 4) {
    metres[i] = data[p] * 256 + data[p + 1] - encoding.offsetMetres;
  }
  return { metres, width: canvas.width, height: canvas.height };
}

// The pipeline emits several sizes of the same global grid. Downloading the
// widest would be wasted bytes on a phone: a mesh can only express detail
// down to its own vertex spacing, so a grid much wider than that carries
// information no vertex can ever show. Take the finest level that is still
// worth its download and leave the wider ones in place for when a future
// version subdivides the mesh further (or loads a high-detail patch for one
// region, which is what the planned REMA / ArcticDEM polar data will need).
export function pickElevationLevel(levels, usefulWidth) {
  const affordable = levels.filter((level) => level.width <= usefulWidth);
  const candidates = affordable.length > 0 ? affordable : levels;
  return candidates.reduce((best, level) => (level.width > best.width ? level : best));
}

// Bilinear, wrapping in longitude and clamping in latitude, in fractional
// grid coordinates. Sampling at a higher resolution than the consumer and
// interpolating keeps single-pixel noise from showing up as spurious bumps
// in the mesh, and puts the 0 m contour *between* cells rather than on a
// cell boundary -- which is what stops the seabed colouring from painting
// the grid's own ~20 km cells as visible staircase blocks along a drained
// coastline.
export function sampleGridMetres(grid, fx, fy) {
  const { metres, width, height } = grid;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  const xa = ((x0 % width) + width) % width;
  const xb = (((x0 + 1) % width) + width) % width;
  const rowA = Math.min(height - 1, Math.max(0, y0)) * width;
  const rowB = Math.min(height - 1, Math.max(0, y0 + 1)) * width;

  const top = metres[rowA + xa] * (1 - tx) + metres[rowA + xb] * tx;
  const bottom = metres[rowB + xa] * (1 - tx) + metres[rowB + xb] * tx;
  return top * (1 - ty) + bottom * ty;
}

// The same sample, addressed the way the rest of the app thinks: degrees.
// The raster is equirectangular with row 0 at the north pole and column 0
// at -180.
export function sampleMetres(grid, lng, lat) {
  return sampleGridMetres(
    grid,
    ((lng + 180) / 360) * grid.width - 0.5,
    ((90 - lat) / 180) * grid.height - 0.5
  );
}
