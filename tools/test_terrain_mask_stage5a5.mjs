// Stage 5A.5 tests: the land/sea rule.
//
// The rule under test: a cell is sea if it is BELOW SEA LEVEL and CONNECTED,
// through other below-sea-level cells, to somewhere known to be ocean (the
// pole rows, the deepest cell, or an independent ocean mask).
//
// The bug this replaces: `isSea = elevation < seaLevel`, which called every
// endorheic basin on Earth ocean -- and would have made the Dead Sea basin a
// false evaporation source the moment Stage 5B reads isSea as "water".
//
// Run: node tools/test_terrain_mask_stage5a5.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import { loadOceanMask } from "./ocean_mask.mjs";
import { buildTerrainField, sampleTerrainAt } from "../js/climate-v1/terrain.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
}

// --- Earth ------------------------------------------------------------------
const config = JSON.parse(readFileSync(path.join(REPO, "worlds/kasoku-sekai/config.json"), "utf8"));
const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
const offset = config.terrain.encoding.offsetMetres;
const metres = new Int16Array(png.width * png.height);
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;
const elevationGrid = { width: png.width, height: png.height, metres };
const oceanMask = loadOceanMask(config, REPO);

console.log("\n1. The ocean mask loads from an asset the repo already has");
check(`mask is ${oceanMask.width}x${oceanMask.height} from ${oceanMask.source}`, Boolean(oceanMask));
check("the mask owes nothing to elevation (it is Teacher B's Koppen no-data)",
  oceanMask.source.includes("koppen"));

const t0 = Date.now();
const field = buildTerrainField({ elevationGrid, seaLevelMetres: 0, oceanMask });
const buildMs = Date.now() - t0;

console.log("\n2. Dry land below sea level is LAND (the bug this fixes)");
// Endorheic: below sea level, not connected to any ocean.
for (const [name, lng, lat] of [
  ["Jordan valley", 35.55, 32.2],
  ["Dead Sea basin", 35.5, 31.5],
  ["Danakil depression", 40.5, 14.2],
]) {
  const c = sampleTerrainAt(field, lng, lat);
  check(`${name}: ${c.relativeElevationMetres.toFixed(0)} m, below sea level but LAND`,
    c.isBelowSeaLevel && !c.isSea);
}

console.log("\n3. Real ocean below sea level is still SEA");
for (const [name, lng, lat] of [
  ["mid-Pacific", -160, 0], ["Mariana Trench", 142.2, 11.35], ["Mediterranean", 18, 35],
  ["Red Sea", 38, 20], ["Persian Gulf", 51, 27], ["Baltic", 19, 58],
  ["Hudson Bay", -85, 60], ["Arctic Ocean", 0, 88], ["Gulf of Mexico", -90, 25],
]) {
  const c = sampleTerrainAt(field, lng, lat);
  check(`${name} is SEA`, c.isSea, `${c.relativeElevationMetres.toFixed(0)} m`);
}

console.log("\n4. Ocean behind a strait narrower than one cell is still SEA");
// These are exactly the bodies connectivity ALONE severs: the Bosphorus, the
// Kerch strait and the Tablazo strait are each a few km across, well under
// this grid's ~20 km cell. They are the reason the mask exists.
for (const [name, lng, lat] of [
  ["Black Sea", 34, 43], ["Sea of Azov", 36.7, 46.1],
  ["Sea of Marmara", 28.2, 40.7], ["Lake Maracaibo", -71.5, 9.7],
]) {
  check(`${name} is SEA`, sampleTerrainAt(field, lng, lat).isSea);
}

console.log("\n5. Ordinary land is unaffected");
for (const [name, lng, lat] of [
  ["Sahara", 10, 23], ["Amazon", -60, -3], ["Tibet", 88, 32],
  ["Antarctica interior", 0, -82], ["Greenland interior", -42, 72],
]) {
  const c = sampleTerrainAt(field, lng, lat);
  check(`${name} is LAND`, !c.isSea && !c.isBelowSeaLevel);
}

console.log("\n6. The change is small, and only ever sea -> land");
{
  const oldRule = field.isBelowSeaLevel;
  let toLand = 0, toSea = 0, wOld = 0, wNew = 0, wAll = 0;
  const { width: W, height: H } = field;
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) * 180) / H;
    const w = Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      wAll += w;
      if (oldRule[i]) wOld += w;
      if (field.isSea[i]) wNew += w;
      if (oldRule[i] && !field.isSea[i]) toLand++;
      if (!oldRule[i] && field.isSea[i]) toSea++;
    }
  }
  check(`nothing at or above sea level became sea (${toSea} cells)`, toSea === 0);
  check(`${toLand} cells reclassified sea -> land`, toLand > 0);
  const oldPct = (wOld / wAll) * 100, newPct = (wNew / wAll) * 100;
  check(`sea fraction ${oldPct.toFixed(3)}% -> ${newPct.toFixed(3)}%, a change under 0.5 points`,
    oldPct - newPct > 0 && oldPct - newPct < 0.5);
  console.log(`  note  built ${W}x${H} in ${buildMs} ms`);
}

console.log("\n7. Sea level can move without the rule breaking");
{
  let prev = Infinity, monotone = true;
  const rows = [];
  for (const sl of [-6000, -2000, -120, 0, 200]) {
    const f = buildTerrainField({ elevationGrid, seaLevelMetres: sl, oceanMask });
    let sea = 0, below = 0, all = 0;
    for (let y = 0; y < f.height; y++) {
      const w = Math.cos(((90 - ((y + 0.5) * 180) / f.height) * Math.PI) / 180);
      for (let x = 0; x < f.width; x++) {
        const i = y * f.width + x;
        all += w; if (f.isSea[i]) sea += w; if (f.isBelowSeaLevel[i]) below += w;
      }
    }
    const pct = (sea / all) * 100;
    rows.push(`${sl} m -> ${pct.toFixed(2)}% sea`);
    if (pct < prev && prev !== Infinity) monotone = false;
    prev = pct;
    // the rule must never claim more sea than there is water
    check(`sea level ${sl} m: sea (${pct.toFixed(2)}%) never exceeds below-sea-level (${((below / all) * 100).toFixed(2)}%)`,
      sea <= below + 1e-9);
  }
  check("sea fraction rises monotonically with sea level", monotone, rows.join(", "));
  // the endorheic basins must stay land at every sea level that does not reach them
  const drained = buildTerrainField({ elevationGrid, seaLevelMetres: -120, oceanMask });
  check("at -120 m the Jordan valley is land and not below sea level",
    !sampleTerrainAt(drained, 35.55, 32.2).isSea);
}

console.log("\n8. A world with no ocean mask still works (degrades, never breaks)");
{
  const f = buildTerrainField({ elevationGrid, seaLevelMetres: 0 });
  check("builds without a mask", f.isSea.length === elevationGrid.width * elevationGrid.height);
  check("oceanMaskApplied reports false", f.oceanMaskApplied === false);
  check("the open ocean is still sea", sampleTerrainAt(f, -160, 0).isSea);
  check("endorheic basins are still land", !sampleTerrainAt(f, 35.55, 32.2).isSea);
  check("the Black Sea degrades to land without the mask (documented, not silent)",
    !sampleTerrainAt(f, 34, 43).isSea);
}

console.log("\n9. Synthetic worlds: the rule is not Earth-specific");
{
  // (a) an all-land world: no sea anywhere, and no crash
  const W = 32, H = 16;
  const flat = new Int16Array(W * H).fill(500);
  const a = buildTerrainField({ elevationGrid: { width: W, height: H, metres: flat }, seaLevelMetres: 0 });
  check("all-land world has no sea", a.isSea.every((v) => v === 0));

  // (b) an all-ocean world: every cell sea
  const deep = new Int16Array(W * H).fill(-3000);
  const b = buildTerrainField({ elevationGrid: { width: W, height: H, metres: deep }, seaLevelMetres: 0 });
  check("all-ocean world is entirely sea", b.isSea.every((v) => v === 1));

  // (c) a world whose ocean is a mid-latitude band, poles dry: the deepest-cell
  //     seed has to find it, since neither pole row is water.
  const band = new Int16Array(W * H).fill(800);
  for (let y = 6; y < 10; y++) for (let x = 0; x < W; x++) band[y * W + x] = -2000;
  const c = buildTerrainField({ elevationGrid: { width: W, height: H, metres: band }, seaLevelMetres: 0 });
  let bandSea = 0; for (let y = 6; y < 10; y++) for (let x = 0; x < W; x++) if (c.isSea[y * W + x]) bandSea++;
  check("dry-poled world still finds its ocean via the deepest cell", bandSea === 4 * W);

  // (d) an enclosed basin inside a continent stays land, on a world with no mask
  const basin = new Int16Array(W * H).fill(800);
  for (let y = 0; y < 2; y++) for (let x = 0; x < W; x++) basin[y * W + x] = -2000; // polar ocean
  basin[8 * W + 16] = -500; // one isolated below-sea-level cell far inland
  const d = buildTerrainField({ elevationGrid: { width: W, height: H, metres: basin }, seaLevelMetres: 0 });
  check("an isolated below-sea-level cell inland is land", d.isSea[8 * W + 16] === 0);
  check("  ...and it is still reported as below sea level", d.isBelowSeaLevel[8 * W + 16] === 1);

  // (e) longitude wraps: an ocean crossing the antimeridian is one body
  const wrap = new Int16Array(W * H).fill(600);
  for (let x of [0, 1, W - 2, W - 1]) for (let y = 4; y < 8; y++) wrap[y * W + x] = -1000;
  for (let x = 0; x < W; x++) wrap[0 * W + x] = -1000;      // polar sea to seed from
  for (let y = 1; y < 5; y++) wrap[y * W + 0] = -1000;      // a channel down to it
  const e = buildTerrainField({ elevationGrid: { width: W, height: H, metres: wrap }, seaLevelMetres: 0 });
  check("an ocean spanning the antimeridian is one connected body",
    e.isSea[6 * W + (W - 1)] === 1 && e.isSea[6 * W + 0] === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  " + f)); process.exit(1); }
