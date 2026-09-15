// Stage 5A.6 tests: three separated questions, and where the atmosphere sits.
//
//   isBelowSeaLevel  is this ground under the sea's level?
//   isSea            is this the world's OCEAN?            (Stage 5A.5, unchanged)
//   isWaterSurface   is there WATER here -- ocean or lake?  (new)
//   surfaceElevationMetres  where the atmosphere meets the surface: the sea
//                    surface over ocean, the LAKE surface over a lake, the
//                    signed ground elsewhere. Never a lake bed.
//
// Run: node tools/test_water_surface_stage5a6.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { buildTerrainField, sampleTerrainAt } from "../js/climate-v1/terrain.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0; const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed++; console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
};

const config = JSON.parse(readFileSync(path.join(REPO, "worlds/kasoku-sekai/config.json"), "utf8"));
const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
const offset = config.terrain.encoding.offsetMetres;
const metres = new Int16Array(png.width * png.height);
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;
const elevationGrid = { width: png.width, height: png.height, metres };
const oceanMask = loadOceanMask(config, REPO);
const waterSurfaceMask = loadWaterSurfaceMask(config, REPO);

console.log("\n1. Both masks come from repo assets, no external dataset");
check(`ocean mask ${oceanMask.width}x${oceanMask.height} from ${oceanMask.source}`, Boolean(oceanMask));
check(`water mask ${waterSurfaceMask.width}x${waterSurfaceMask.height} from ${waterSurfaceMask.source}`,
  Boolean(waterSurfaceMask));

const t0 = Date.now();
const field = buildTerrainField({ elevationGrid, seaLevelMetres: 0, oceanMask, waterSurfaceMask });
const buildMs = Date.now() - t0;

console.log("\n2. The completion criteria, exactly as specified");
for (const [name, lng, lat, wantSea, wantWater] of [
  ["Pacific", -160, 0, true, true],
  ["Arctic Ocean", 0, 88, true, true],
  ["Black Sea", 34, 43, true, true],
  ["Caspian Sea", 51, 42, false, true],
  ["Lake Baikal", 108, 53.5, false, true],
  ["Jordan valley (dry, below sea level)", 35.55, 32.2, false, false],
]) {
  const c = sampleTerrainAt(field, lng, lat);
  check(`${name}: isSea=${c.isSea} isWaterSurface=${c.isWaterSurface}`,
    c.isSea === wantSea && c.isWaterSurface === wantWater, `want ${wantSea}/${wantWater}`);
}

console.log("\n3. isWaterSurface is a strict superset of isSea");
{
  let violations = 0, lakes = 0;
  for (let i = 0; i < field.isSea.length; i++) {
    if (field.isSea[i] && !field.isWaterSurface[i]) violations++;
    if (!field.isSea[i] && field.isWaterSurface[i]) lakes++;
  }
  check(`every sea cell is a water surface (${violations} violations)`, violations === 0);
  check(`${lakes} water cells are not ocean, in ${field.lakeCount} lake bodies`, lakes > 0);
}

console.log("\n4. The atmosphere never sits on a lake bed");
for (const [name, lng, lat, trueLevel, tol] of [
  ["Caspian Sea", 51, 42, -28, 40],
  ["Lake Baikal", 108, 53.5, 456, 40],
  ["Lake Superior", -87.5, 47.6, 183, 60],
  ["Lake Titicaca", -69.4, -15.8, 3812, 60],
  ["Lake Victoria", 33, -1, 1135, 60],
]) {
  const c = sampleTerrainAt(field, lng, lat);
  const err = c.surfaceElevationMetres - trueLevel;
  check(`${name}: surface ${c.surfaceElevationMetres.toFixed(0)} m vs true ${trueLevel} m (raster says ${c.sourceElevationMetres.toFixed(0)})`,
    Math.abs(err) <= tol, `error ${err >= 0 ? "+" : ""}${err.toFixed(0)} m`);
  check(`  ...and it is above the raster's bed reading`, c.surfaceElevationMetres > c.sourceElevationMetres);
}

console.log("\n5. Ocean surface is exactly sea level; dry land keeps its signed ground");
{
  let seaExact = 0, seaCells = 0, landExact = 0, landCells = 0;
  for (let i = 0; i < field.isSea.length; i++) {
    if (field.isSea[i]) { seaCells++; if (field.surfaceElevationMetres[i] === field.seaLevelMetres) seaExact++; }
    else if (!field.isWaterSurface[i]) {
      landCells++;
      if (field.surfaceElevationMetres[i] === field.sourceElevationMetres[i]) landExact++;
    }
  }
  check(`all ${seaCells} ocean cells sit exactly at sea level`, seaExact === seaCells);
  check(`all ${landCells} dry-land cells keep sourceElevationMetres unchanged`, landExact === landCells);
  const jv = sampleTerrainAt(field, 35.55, 32.2);
  check(`the dry Jordan valley keeps its signed ${jv.surfaceElevationMetres.toFixed(0)} m`,
    jv.surfaceElevationMetres === jv.sourceElevationMetres && jv.surfaceElevationMetres < 0);
  const dk = sampleTerrainAt(field, 40.5, 14.2);
  check(`Danakil keeps its signed ${dk.surfaceElevationMetres.toFixed(0)} m`,
    dk.surfaceElevationMetres === dk.sourceElevationMetres && dk.surfaceElevationMetres < 0);
}

console.log("\n6. The four existing fields are untouched in meaning");
{
  let relOk = true, belowOk = true;
  for (let i = 0; i < field.isSea.length; i++) {
    if (Math.abs(field.relativeElevationMetres[i] - (field.sourceElevationMetres[i] - 0)) > 1e-3) relOk = false;
    if ((field.isBelowSeaLevel[i] === 1) !== (field.sourceElevationMetres[i] < 0)) belowOk = false;
  }
  check("relativeElevationMetres still = source - seaLevel", relOk);
  check("isBelowSeaLevel still = the plain elevation test", belowOk);
  const noWater = buildTerrainField({ elevationGrid, seaLevelMetres: 0, oceanMask });
  let same = true;
  for (let i = 0; i < field.isSea.length; i++) if (field.isSea[i] !== noWater.isSea[i]) same = false;
  check("isSea is bit-identical with and without the water mask (Stage 5A.5 untouched)", same);
}

console.log("\n7. Sea level can move without the rule breaking");
for (const sl of [-6000, -2000, -120, 0, 200]) {
  const f = buildTerrainField({ elevationGrid, seaLevelMetres: sl, oceanMask, waterSurfaceMask });
  let bad = 0, seaBad = 0;
  for (let i = 0; i < f.isSea.length; i++) {
    if (f.isSea[i] && !f.isWaterSurface[i]) bad++;
    if (f.isSea[i] && f.surfaceElevationMetres[i] !== sl) seaBad++;
  }
  check(`sea level ${sl} m: superset holds (${bad}), ocean surface = sea level (${seaBad}), ${f.lakeCount} lakes`,
    bad === 0 && seaBad === 0);
}

console.log("\n8. Degrades cleanly, and is not Earth-specific");
{
  const f = buildTerrainField({ elevationGrid, seaLevelMetres: 0, oceanMask });
  check("a world with no water mask still builds", f.waterSurfaceMaskApplied === false && f.lakeCount === 0);
  let same = true;
  for (let i = 0; i < f.isSea.length; i++) if (f.isWaterSurface[i] !== f.isSea[i]) same = false;
  check("  ...and water surface falls back to exactly the ocean", same);

  const W = 24, H = 12;
  const land = new Int16Array(W * H).fill(600);
  for (let x = 0; x < W; x++) land[x] = -2000;           // a polar ocean to seed from
  for (const i of [5 * W + 12, 5 * W + 13, 6 * W + 12]) land[i] = 200; // a shallow inland basin
  const isWater = new Uint8Array(W * H);
  for (const i of [5 * W + 12, 5 * W + 13, 6 * W + 12]) isWater[i] = 1; // ...that holds a lake
  const f2 = buildTerrainField({
    elevationGrid: { width: W, height: H, metres: land }, seaLevelMetres: 0,
    waterSurfaceMask: { width: W, height: H, isWater },
  });
  check("a synthetic world's inland lake is water but not sea",
    f2.isWaterSurface[5 * W + 12] === 1 && f2.isSea[5 * W + 12] === 0);
  check("  ...and its surface is the shore level, not the basin floor",
    f2.surfaceElevationMetres[5 * W + 12] === 600, `${f2.surfaceElevationMetres[5 * W + 12]} m`);
  check("  ...while the polar ocean is sea at sea level",
    f2.isSea[3] === 1 && f2.surfaceElevationMetres[3] === 0);
}
console.log(`  note  built ${field.width}x${field.height} in ${buildMs} ms, ${field.lakeCount} lake bodies`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  " + f)); process.exit(1); }
