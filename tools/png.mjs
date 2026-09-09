// A minimal PNG reader, so the scoring tools can read the repo's own rasters
// in node without a dependency. Node ships zlib, and every PNG this project
// commits is 8-bit and non-interlaced: the terrain levels are RGB (the
// R*256+G metres encoding) and the teacher maps are paletted class indices.
// Anything else is refused rather than guessed at.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function readPng(path) {
  const buf = readFileSync(path);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${path}: not a PNG`);

  let offset = 8;
  let width = 0, height = 0, depth = 0, colour = -1, interlace = 0;
  let palette = null;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (depth !== 8 || interlace !== 0 || !(colour in CHANNELS)) {
    throw new Error(`${path}: expected an 8-bit non-interlaced PNG, got depth ${depth} colour ${colour} interlace ${interlace}`);
  }

  const channels = CHANNELS[colour];
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(stride * height);
  let previous = new Uint8Array(stride);
  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read++];
    const line = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = raw[read + x];
      switch (filter) {
        case 0: break;
        case 1: value += left; break;
        case 2: value += up; break;
        case 3: value += (left + up) >> 1; break;
        case 4: {
          // Paeth: whichever of the three neighbours the linear estimate is
          // closest to.
          const estimate = left + up - upLeft;
          const dLeft = Math.abs(estimate - left);
          const dUp = Math.abs(estimate - up);
          const dUpLeft = Math.abs(estimate - upLeft);
          value += dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
          break;
        }
        default: throw new Error(`${path}: unknown row filter ${filter}`);
      }
      line[x] = value & 255;
    }
    out.set(line, y * stride);
    previous = line;
    read += stride;
  }
  return { width, height, channels, colour, palette, data: out };
}
