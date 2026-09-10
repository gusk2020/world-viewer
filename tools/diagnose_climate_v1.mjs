// Climate v1 diagnostic + self-test tool (Stage 0-1: terrain, land/sea,
// temperature, and the wind diagnostic foundation only -- see
// docs/climate-v1-redesign.md). Not a search, not a calibration: this
// proves the new intermediate fields behave correctly and reports what the
// existing wind field actually is, against real committed Earth data.
//
//   node tools/diagnose_climate_v1.mjs [worlds/kasoku-sekai]
//
// Exits non-zero if any assertion fails.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

import { readPng } from "./png.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField, sampleTerrainCell, sampleTerrainAt, TERRAIN_STATES } from "../js/climate-v1/terrain.js";
import { buildTemperatureField, sampleTemperatureAt } from "../js/climate-v1/temperature.js";
import { currentModelWind, compareWindToTeacher } from "../js/climate-v1/wind-diagnostic.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoPath = (p) => path.join(REPO, p.replace(/^\.\//, ""));
const worldDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(REPO, "worlds/kasoku-sekai");

function loadElevationGrid(config) {
  const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
  const png = readPng(repoPath(level.url));
  const offset = config.terrain.encoding.offsetMetres;
  const metres = new Int16Array(png.width * png.height);
  for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;
  return { width: png.width, height: png.height, metres };
}

const config = JSON.parse(readFileSync(path.join(worldDir, "config.json"), "utf8"));
const elevationGrid = loadElevationGrid(config);
const sets = resolveClimateSets(config);
const baseParams = (sets.sets.find((s) => s.id === sets.defaultId) || sets.sets[0]).values;

console.log(`world: ${config.id}  elevation grid: ${elevationGrid.width}x${elevationGrid.height}`);
console.log(`terrain.source (from config.json): "${config.terrain.source}"`);
console.log("");

// ---------------------------------------------------------------------------
// Step 3/4: terrain field at several sea levels. Land/sea and relative
// elevation must never produce a logically inconsistent result, and the
// terrain state must say plainly that this is ice-surface data.
// ---------------------------------------------------------------------------
console.log("=== Terrain field at several sea levels ===");
const seaLevels = [0, 200, -1000, -6000];
const everest = { lng: 86.925, lat: 27.988, label: "Everest area" };
const marianas = { lng: 142.2, lat: 11.35, label: "Mariana Trench" };
const arcticSea = { lng: 0, lat: 85, label: "Arctic Ocean (near pole)" };

for (const seaLevelMetres of seaLevels) {
  const terrain = buildTerrainField({ elevationGrid, seaLevelMetres });
  assert.equal(terrain.terrainState, TERRAIN_STATES.ICE_SURFACE, "default terrain state must be ice-surface");

  // Internal consistency, over the whole grid: isSea must agree exactly with
  // sourceElevationMetres < seaLevelMetres, and relativeElevationMetres must
  // be exactly source - seaLevel, for every cell -- not just the ones this
  // script happens to sample.
  let seaCount = 0, landCount = 0;
  for (let i = 0; i < terrain.sourceElevationMetres.length; i++) {
    const src = terrain.sourceElevationMetres[i];
    const rel = terrain.relativeElevationMetres[i];
    const sea = terrain.isSea[i];
    assert.ok(Math.abs(rel - (src - seaLevelMetres)) < 1e-3, `relativeElevation mismatch at cell ${i}`);
    assert.equal(sea === 1, src < seaLevelMetres, `isSea mismatch at cell ${i}`);
    if (sea) seaCount++; else landCount++;
  }
  const landFraction = landCount / (landCount + seaCount);

  const e = sampleTerrainAt(terrain, everest.lng, everest.lat);
  const m = sampleTerrainAt(terrain, marianas.lng, marianas.lat);
  console.log(
    `  seaLevel=${String(seaLevelMetres).padStart(6)}m  land=${(landFraction * 100).toFixed(1)}%  ` +
    `Everest: src=${e.sourceElevationMetres} rel=${e.relativeElevationMetres.toFixed(0)} isSea=${e.isSea}  ` +
    `Marianas: src=${m.sourceElevationMetres} rel=${m.relativeElevationMetres.toFixed(0)} isSea=${m.isSea}`
  );
  // Everest must never be sea, Marianas must never be land, at any sea level
  // in this test range -- if either flips, something is broken, not just
  // "a lot of land is now underwater".
  assert.equal(e.isSea, false, `Everest must not be sea at seaLevel=${seaLevelMetres}`);
  assert.equal(m.isSea, true, `Marianas must not be land at seaLevel=${seaLevelMetres}`);
}
console.log("  OK: land/sea and relativeElevation are internally consistent at every tested sea level.\n");

// ---------------------------------------------------------------------------
// Step 5: temperature field. The lapse-rate correction must use *relative*
// elevation, so raising sea level (which does not move the mountain) must
// change that cell's temperature exactly as much as lowering its relative
// elevation by the same amount would -- and must NOT silently key off the
// absolute elevation instead.
// ---------------------------------------------------------------------------
console.log("=== Temperature field: relative- vs absolute-elevation check ===");
{
  const seaLevelA = 0;
  const seaLevelB = -1000; // sea level 1000 m lower -> Everest's relative elevation 1000 m higher
  const terrainA = buildTerrainField({ elevationGrid, seaLevelMetres: seaLevelA });
  const terrainB = buildTerrainField({ elevationGrid, seaLevelMetres: seaLevelB });
  const tempA = buildTemperatureField({ terrainField: terrainA, axialTiltDegrees: config.body.axialTiltDegrees, params: baseParams });
  const tempB = buildTemperatureField({ terrainField: terrainB, axialTiltDegrees: config.body.axialTiltDegrees, params: baseParams });

  const cA = sampleTerrainAt(terrainA, everest.lng, everest.lat);
  const cB = sampleTerrainAt(terrainB, everest.lng, everest.lat);
  const relDeltaM = cB.relativeElevationMetres - cA.relativeElevationMetres;
  assert.ok(Math.abs(relDeltaM - 1000) < 1, "expected relative elevation to rise by ~1000 m when sea level drops 1000 m");

  const tA = sampleTemperatureAt(tempA, everest.lng, everest.lat);
  const tB = sampleTemperatureAt(tempB, everest.lng, everest.lat);
  const expectedDeltaC = -baseParams.lapseRateCPerKm * (relDeltaM / 1000);
  const actualDeltaC = tB - tA;
  console.log(`  Everest: seaLevel ${seaLevelA}m -> T=${tA.toFixed(2)}C ; seaLevel ${seaLevelB}m -> T=${tB.toFixed(2)}C`);
  console.log(`  relative elevation rose by ${relDeltaM.toFixed(0)}m; expected deltaT=${expectedDeltaC.toFixed(3)}C, actual=${actualDeltaC.toFixed(3)}C`);
  assert.ok(Math.abs(actualDeltaC - expectedDeltaC) < 1e-3,
    "temperature did not follow the lapse-rate correction on RELATIVE elevation as expected");

  // The negative control: the source (absolute) elevation is untouched
  // between A and B, so if the code were mistakenly keying off absolute
  // elevation the temperature would not have moved at all.
  assert.equal(cA.sourceElevationMetres, cB.sourceElevationMetres, "source elevation must be unchanged by a sea-level change");
  assert.ok(Math.abs(actualDeltaC) > 1, "temperature must actually respond to the sea-level change (it would not if absolute elevation were used)");
  console.log("  OK: the lapse correction tracks relativeElevationMetres, and moves when sea level moves even though absolute elevation does not.\n");
}

// A land cell and a sea cell, so the isSea branch (ocean moderation, no
// lapse) is exercised too, not just the land branch.
{
  const terrain = buildTerrainField({ elevationGrid, seaLevelMetres: 0 });
  const temp = buildTemperatureField({ terrainField: terrain, axialTiltDegrees: config.body.axialTiltDegrees, params: baseParams });
  const land = sampleTerrainAt(terrain, everest.lng, everest.lat);
  const sea = sampleTerrainAt(terrain, arcticSea.lng, arcticSea.lat);
  assert.equal(land.isSea, false);
  assert.equal(sea.isSea, true);
  console.log(`=== Sample points at seaLevel=0m ===`);
  console.log(`  land (${everest.label}): rel=${land.relativeElevationMetres.toFixed(0)}m  T=${sampleTemperatureAt(temp, everest.lng, everest.lat).toFixed(2)}C`);
  console.log(`  sea  (${arcticSea.label}): rel=${sea.relativeElevationMetres.toFixed(0)}m  T=${sampleTemperatureAt(temp, arcticSea.lng, arcticSea.lat).toFixed(2)}C\n`);
}

// ---------------------------------------------------------------------------
// Step 9: what the current model's wind actually is, read from the running
// code -- direction and relative strength by latitude, explicitly labelled
// as dimensionless.
// ---------------------------------------------------------------------------
console.log("=== Current model wind (js/climate.js windField), by latitude ===");
const wind = currentModelWind({
  rows: 180, dayLengthHours: config.body.dayLengthHours,
  rotationDirection: config.body.rotationDirection, params: baseParams,
});
console.log(`  units: ${wind.units}`);
const sampleLats = [75, 45, 15, 0, -15, -45, -75];
for (const lat of sampleLats) {
  const y = Math.round((0.5 - lat / 180) * wind.rows - 0.5);
  const yy = Math.min(wind.rows - 1, Math.max(0, y));
  console.log(`  lat ${String(lat).padStart(4)}: east=${wind.east[yy].toFixed(3).padStart(7)} north=${wind.north[yy].toFixed(3).padStart(7)} |v|=${wind.magnitude[yy].toFixed(3)}`);
}
console.log("");

// ---------------------------------------------------------------------------
// Self-test only: compareWindToTeacher's own correctness, against a small
// SYNTHETIC grid built here (never presented as real Earth data). Confirms
// the comparison math is right and is ready to run the moment a real
// teacher grid exists.
// ---------------------------------------------------------------------------
console.log("=== compareWindToTeacher self-test (synthetic grid, NOT real Earth data) ===");
{
  const W = 8, H = 8;
  const u = new Float64Array(W * H);
  const v = new Float64Array(W * H);
  // A synthetic "teacher": uniform 10 m/s eastward everywhere, so a model
  // scaled to exactly match it should score zero error.
  for (let i = 0; i < W * H; i++) { u[i] = 10; v[i] = 0; }
  const modelWind = { rows: H, east: new Float64Array(H).fill(1), north: new Float64Array(H).fill(0) };
  const perfect = compareWindToTeacher({ modelWind, teacher: { width: W, height: H, u, v }, modelSpeedScaleMS: 10 });
  assert.ok(perfect.speedMaeMS < 1e-9 && perfect.uRmseMS < 1e-9 && perfect.directionErrorDeg < 1e-6,
    "self-test: a model scaled to exactly match a uniform synthetic teacher should score ~zero error");

  // A 90-degree-rotated model against the same teacher should read ~90
  // degrees of direction error and a nonzero speed error only if magnitudes differ.
  const rotated = { rows: H, east: new Float64Array(H).fill(0), north: new Float64Array(H).fill(1) };
  const rotatedResult = compareWindToTeacher({ modelWind: rotated, teacher: { width: W, height: H, u, v }, modelSpeedScaleMS: 10 });
  assert.ok(Math.abs(rotatedResult.directionErrorDeg - 90) < 1e-6, "self-test: a 90-degree-rotated model should score ~90 degrees direction error");

  // Low-speed exclusion: a near-calm teacher cell must not count toward the
  // direction error.
  const calmU = new Float64Array(W * H).fill(0.01);
  const calmV = new Float64Array(W * H).fill(0);
  const calmResult = compareWindToTeacher({
    modelWind, teacher: { width: W, height: H, u: calmU, v: calmV },
    modelSpeedScaleMS: 10, minTeacherSpeedForDirectionMS: 1,
  });
  assert.equal(calmResult.directionSampleCount, 0, "self-test: near-calm teacher cells must be excluded from direction error");
  assert.equal(calmResult.directionExcludedCount, W * H);

  console.log("  OK: compareWindToTeacher's speed/u/v/direction metrics and the low-speed exclusion all behave correctly on a synthetic grid.\n");
}

console.log("=== Real Earth wind/temperature teacher data: NOT fetched this round ===");
console.log("  See docs/climate-v1-redesign.md section 7/8 for the candidates investigated");
console.log("  and which hosts this sandbox could and could not reach directly.");
console.log("");
console.log("ALL CLIMATE V1 STAGE 0-1 CHECKS PASSED");
