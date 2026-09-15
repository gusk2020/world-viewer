// Loads a world's independent ocean mask for js/climate-v1/terrain.js.
//
// Climate v1's land/sea rule floods the ocean through below-sea-level cells
// from everywhere already known to be ocean. At ~20 km cells a strait
// narrower than one cell does not exist, so connectivity alone severs the
// Black Sea, the Sea of Azov, the Sea of Marmara and Lake Maracaibo from the
// world ocean. This mask repairs exactly those, by seeding the flood.
//
// **It reuses an asset the repo already has**: Teacher B's Koppen-Geiger map
// (worlds/<world>/teacher/koppen-structure.png, built from Beck et al. 2018,
// CC BY 4.0). That map covers land only, so its no-data value is a statement
// of where the ocean is that owes **nothing to elevation** -- which is the
// whole point, since the rule it repairs is itself an elevation test. No new
// data is downloaded and no new file is committed.
//
// Every Climate v1 tool must load it the same way, or two tools would
// disagree about whether the Black Sea is ocean. That is why this is one
// shared function and not four lines copied into each tool.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { readPng } from "./png.mjs";

// Beck's map is paletted and readPng hands back palette indices, so this is
// the index of "no data", not a colour. Teacher B's builder writes the eight
// climate classes as 0..7 and leaves 255 for everywhere it has no land.
const KOPPEN_NO_DATA_INDEX = 255;

/**
 * @param {object} config  the world's config.json
 * @param {string} repoRoot
 * @returns {{width:number,height:number,isOcean:Uint8Array,source:string}|null}
 *          null when the world has no such map, in which case
 *          buildTerrainField falls back to connectivity alone.
 */
export function loadOceanMask(config, repoRoot) {
  const mapUrl = config?.teacherStructure?.map;
  if (!mapUrl) return null;
  const file = path.join(repoRoot, mapUrl.replace(/^\.\//, ""));
  if (!existsSync(file)) return null;

  const png = readPng(file);
  if (png.channels !== 1) {
    throw new Error(`expected a paletted ocean-mask source, got ${png.channels} channels from ${mapUrl}`);
  }
  const isOcean = new Uint8Array(png.width * png.height);
  for (let i = 0; i < isOcean.length; i++) {
    isOcean[i] = png.data[i] === KOPPEN_NO_DATA_INDEX ? 1 : 0;
  }
  return { width: png.width, height: png.height, isOcean, source: mapUrl };
}
