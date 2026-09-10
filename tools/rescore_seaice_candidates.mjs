// Re-scores a merged Pareto front from tools/search_climate_seaice.mjs at
// full resolution (step 1), because the search itself runs at step 2 for
// speed and that is not the number to make a final decision from.
//
// This does not touch the climate model, the search space, or the hard
// constraints -- it reads the constraints the search itself saved in its own
// checkpoints (so there is exactly one definition of "valid", not a second
// copy that could drift from the first) and applies them to the step-1
// numbers instead of the step-2 ones a candidate was found under.
//
//   node tools/rescore_seaice_candidates.mjs <merged-front.json> <constraints-source.json> <out.json>
//
// Output: every candidate re-scored at step 1, marked valid/invalid against
// the step-1 numbers, plus a **rebuilt** Pareto front (dominance on the
// step-1 Teacher A / Teacher B values, crowding-distance thinned, both
// extremes always kept) -- because a front built from step-2 scores is not
// guaranteed to still be a front once the real numbers are in.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import {
  computeClimate,
  computeGeography,
  resolveClimateSets,
  scoreAgainstTeacher,
  scoreAgainstStructureTeacher,
} from "../js/climate.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoPath = (url) => path.join(REPO, url.replace(/^\.\//, ""));

// The eight named places the sea-ice and land-snow rounds both used, plus
// the Sahel box the snow round added (docs/snow-ice-balance-experiment.md's
// own fourway.mjs). Evaluation points only, nothing the model reads.
const PLACES = [
  ["インドシナ", 100, 110, 10, 20],
  ["華中・華南", 105, 120, 22, 32],
  ["インド", 72, 86, 15, 28],
  ["米中西部", -102, -90, 36, 46],
  ["パタゴニア風下", -72, -66, -50, -42],
  ["サハラ", 0, 25, 18, 28],
  ["ヒマラヤ・チベット", 80, 95, 28, 36],
  ["サヘル", -15, 25, 10, 17],
];

function loadWorld(worldDir) {
  const config = JSON.parse(readFileSync(path.join(worldDir, "config.json"), "utf8"));
  // Full resolution: the widest committed level <= 2048, same selection rule
  // pickElevationLevel uses in the app, just made explicit here.
  const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
  const png = readPng(repoPath(level.url));
  const offset = config.terrain.encoding.offsetMetres;
  const metres = new Int16Array(png.width * png.height);
  for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;
  const elevation = { width: png.width, height: png.height, metres };

  const eraSpec = config.teacher;
  const era = eraSpec.eras.find((e) => e.id === eraSpec.default) || eraSpec.eras[0];
  const teacherAMap = readPng(repoPath(era.map));
  const teacherA = { width: teacherAMap.width, height: teacherAMap.height, data: teacherAMap.data };

  const teacherBMap = readPng(repoPath(config.teacherStructure.map));
  const teacherB = { width: teacherBMap.width, height: teacherBMap.height, data: teacherBMap.data };

  const geography = computeGeography({ elevation, seaLevelMetres: 0, radiusMetres: config.body.radiusMetres });
  const sets = resolveClimateSets(config);
  const base = sets.sets.find((s) => s.id === sets.defaultId) || sets.sets[0];
  return { config, elevation, teacherA, teacherB, geography, base };
}

function longitudinalShare(climate, geography) {
  const cw = climate.width, ch = climate.height;
  let within = 0, total = 0, gm = 0, gw = 0;
  const rows = [];
  for (let y = 0; y < ch; y++) {
    const lat = (0.5 - (y + 0.5) / ch) * 180;
    const w = Math.cos((lat * Math.PI) / 180);
    if (w <= 0) continue;
    const vals = [];
    for (let x = 0; x < cw; x++) if (!geography.isSea[y * cw + x]) vals.push(climate.moisture[y * cw + x]);
    if (vals.length < 8) continue;
    rows.push({ w, vals });
    for (const v of vals) { gm += w * v; gw += w; }
  }
  gm /= gw;
  for (const r of rows) {
    let m = 0; for (const v of r.vals) m += v; m /= r.vals.length;
    for (const v of r.vals) { total += r.w * (v - gm) ** 2; within += r.w * (v - m) ** 2; }
  }
  return total > 0 ? within / total : 0;
}

// Bilinear sample of the coarse moisture grid at a texture pixel, and the
// painter's own classifyPoint, so a place's "vegetated %" here means exactly
// what the globe would paint there -- same method lab.mjs's placeStats used.
function placeStats(world, climate, params, lng0, lng1, lat0, lat1) {
  const { elevation: { width: W, height: H, metres }, teacherA } = world;
  const cw = climate.width, ch = climate.height;
  let veg = 0, land = 0, tveg = 0, tland = 0;
  const surface = new Float64Array(5);
  const rowScale = climate.profileRows / H;
  const coarseY = ch / H;
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    if (lat < lat0 || lat > lat1) continue;
    const pr = Math.min(climate.profileRows - 1, Math.floor(y * rowScale));
    const seaC = climate.seaLevelC[pr], wD = climate.warmDeltaC[pr], cD = climate.coldDeltaC[pr];
    const fy = (y + 0.5) * coarseY - 0.5, y0 = Math.floor(fy), ty = fy - y0;
    const ya = Math.min(ch - 1, Math.max(0, y0)) * cw, yb = Math.min(ch - 1, Math.max(0, y0 + 1)) * cw;
    const trow = Math.min(teacherA.height - 1, Math.floor((y * teacherA.height) / H)) * teacherA.width;
    for (let x = 0; x < W; x++) {
      const lng = -180 + ((x + 0.5) / W) * 360;
      if (lng < lng0 || lng > lng1) continue;
      const m = metres[y * W + x];
      if (m < 0) continue;
      const fx = ((x + 0.5) / W) * cw - 0.5, x0 = Math.floor(fx), tx = fx - x0;
      const xa = ((x0 % cw) + cw) % cw, xb = (((x0 + 1) % cw) + cw) % cw;
      const bil = (f) => (f[ya + xa] * (1 - tx) + f[ya + xb] * tx) * (1 - ty)
        + (f[yb + xa] * (1 - tx) + f[yb + xb] * tx) * ty;
      const moisture = bil(climate.moisture);
      const { classifyPoint, SURFACE_SNOW, SURFACE_VEGETATION } = classifyMod;
      classifyPoint(surface, m, 0, seaC, wD, cD, moisture, params);
      land++;
      if (!(surface[SURFACE_SNOW] > 0.5) && surface[SURFACE_VEGETATION] > 0.5) veg++;
      const tcol = Math.min(teacherA.width - 1, Math.floor((x * teacherA.width) / W));
      const t = teacherA.data[trow + tcol];
      if (t >= 2) { tland++; if (t === 2) tveg++; }
    }
  }
  return { model: land ? veg / land : 0, teacher: tland ? tveg / tland : 0 };
}

import * as classifyMod from "../js/climate.js";

const dominates = (x, y) => (x.a >= y.a && x.b >= y.b) && (x.a > y.a || x.b > y.b);

function dropMostCrowded(front) {
  const idx = front.map((_, i) => i).sort((i, j) => front[i].a - front[j].a);
  let worst = -1, worstDistance = Infinity;
  for (let k = 1; k < idx.length - 1; k++) {
    const prev = front[idx[k - 1]], next = front[idx[k + 1]];
    const distance = (next.a - prev.a) + (prev.b - next.b);
    if (distance < worstDistance) { worstDistance = distance; worst = idx[k]; }
  }
  if (worst >= 0) front.splice(worst, 1);
}

function main() {
  const [frontFile, constraintsFile, outFile] = process.argv.slice(2);
  if (!frontFile || !constraintsFile || !outFile) {
    console.error("usage: rescore_seaice_candidates.mjs <front.json> <constraints-source.json> <out.json>");
    process.exit(1);
  }
  const frontDoc = JSON.parse(readFileSync(frontFile, "utf8"));
  const candidates = frontDoc.front || frontDoc.entries || [];
  const C = JSON.parse(readFileSync(constraintsFile, "utf8")).constraints;
  if (!C) throw new Error(`no "constraints" field in ${constraintsFile} -- was it saved by a checkpoint?`);
  console.log(`re-scoring ${candidates.length} candidates at step 1, constraints from ${path.basename(constraintsFile)}`);

  const world = loadWorld(path.join(REPO, "worlds/kasoku-sekai"));
  const body = world.config.body;

  const rescored = [];
  for (const cand of candidates) {
    const params = { ...world.base.values, ...cand.params };
    const climate = computeClimate({
      elevation: world.elevation, seaLevelMetres: 0,
      axialTiltDegrees: body.axialTiltDegrees, radiusMetres: body.radiusMetres,
      dayLengthHours: body.dayLengthHours, rotationDirection: body.rotationDirection,
      params, geography: world.geography,
    });
    const a = scoreAgainstTeacher({ elevation: world.elevation, climate, teacher: world.teacherA, seaLevelMetres: 0, params, step: 1 });
    const b = scoreAgainstStructureTeacher({ elevation: world.elevation, climate, teacher: world.teacherB, seaLevelMetres: 0, params, step: 1 });
    const ca = a.classes;
    const seasonalClasses = {
      tropicalSeasonal: b.classes.tropicalSeasonal?.iou ?? 0,
      temperateSeasonal: b.classes.temperateSeasonal?.iou ?? 0,
      coldSeasonal: b.classes.coldSeasonal?.iou ?? 0,
    };
    const seasonal = seasonalClasses.tropicalSeasonal + seasonalClasses.temperateSeasonal + seasonalClasses.coldSeasonal;
    const iceArea = ca.landIce.modelArea / a.totalWeight;
    const seaIceArea = ca.seaIce.modelArea / a.totalWeight;
    const lon = longitudinalShare(climate, world.geography);
    const region = 1 - a.regionPenalty;

    const places = {};
    for (const [name, lng0, lng1, lat0, lat1] of PLACES) {
      const s = placeStats(world, climate, params, lng0, lng1, lat0, lat1);
      places[name] = { modelVegetatedPct: +(s.model * 100).toFixed(1), teacherVegetatedPct: +(s.teacher * 100).toFixed(1) };
    }

    const valid =
      iceArea >= C.iceAreaMin && iceArea <= C.iceAreaMax && ca.landIce.iou >= C.iceIouMin &&
      seaIceArea >= C.seaIceAreaMin && seaIceArea <= C.seaIceAreaMax && ca.seaIce.iou >= C.seaIceIouMin &&
      seasonal >= C.seasonalMin && lon >= C.lonMin;

    rescored.push({
      params, step2: { a: cand.a, b: cand.b },
      a: a.meanIou, b: b.meanIou,
      teacherA: {
        total: a.meanIou, vegetation: ca.vegetation.iou, arid: ca.arid.iou,
        landIce: ca.landIce.iou, landIceRecall: ca.landIce.recall, landIcePrecision: ca.landIce.precision, landIceArea: iceArea,
        seaIce: ca.seaIce.iou, seaIceRecall: ca.seaIce.recall, seaIcePrecision: ca.seaIce.precision, seaIceArea,
        region,
      },
      teacherB: { total: b.meanIou, classes: Object.fromEntries(Object.entries(b.classes).map(([k, v]) => [k, v.iou])), seasonalClassSum: seasonal },
      longitudinalShare: lon,
      places,
      valid,
    });
  }

  const survivedStep1 = rescored.filter((c) => c.valid);
  console.log(`step-1 valid: ${survivedStep1.length} of ${rescored.length}`);

  // Rebuild the front from the step-1 (a, b) values -- a front is only a
  // front for the numbers it was built from.
  let finalFront = [];
  const byA = [...survivedStep1].sort((x, y) => y.a - x.a);
  for (const c of byA) {
    if (finalFront.some((f) => dominates(f, c))) continue;
    for (let i = finalFront.length - 1; i >= 0; i--) if (dominates(c, finalFront[i])) finalFront.splice(i, 1);
    finalFront.push(c);
  }
  finalFront.sort((x, y) => y.a - x.a);

  writeFileSync(outFile, JSON.stringify({
    source: frontFile, constraintsFrom: constraintsFile,
    totalRescored: rescored.length, validAtStep1: survivedStep1.length,
    rescored, finalFrontStep1: finalFront,
  }, null, 1));
  console.log(`wrote ${outFile}: final step-1 front has ${finalFront.length} members`);
}

main();
