// Scores a world's climate colouring against its teacher data, and prints the
// four agreement numbers the user asked for -- 植生 / 乾燥地 / 雪氷 / 海氷 --
// plus a total.
//
// It runs the real js/climate.js on the real committed rasters, so the thing
// scored here is the thing the app draws. Nothing looks at a picture.
//
// Usage:
//   node tools/score_climate.mjs [worlds/kasoku-sekai] [options]
//     --temperature <C>   score at this mean temperature instead of the set's
//     --step <n>          sample every nth pixel (default 1, the whole raster)
//     --regions <n>       list the n worst regions (default 8)
//     --json              print machine-readable JSON instead of a table
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import {
  computeClimate,
  resolveClimateSets,
  scoreAgainstTeacher,
  SCORED_CLASSES,
} from "../js/climate.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { world: "worlds/kasoku-sekai", step: 1, regions: 8, json: false, temperature: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--step") out.step = Number(argv[++i]);
    else if (a === "--regions") out.regions = Number(argv[++i]);
    else if (a === "--temperature") out.temperature = Number(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else out.world = a;
  }
  return out;
}

// Config paths are the browser's, i.e. relative to the repo root.
const repoPath = (url) => path.join(REPO, url.replace(/^\.\//, ""));

function loadElevation(config) {
  const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
  const png = readPng(repoPath(level.url));
  if (png.channels !== 3) throw new Error("elevation level is not an RGB PNG");
  const offset = config.terrain.encoding.offsetMetres;
  const metres = new Int16Array(png.width * png.height);
  for (let i = 0; i < metres.length; i++) {
    metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;
  }
  return { width: png.width, height: png.height, metres };
}

function loadTeacher(config) {
  const spec = config.teacher;
  if (!spec) throw new Error("this world has no teacher data (see tools/build_teacher.py)");
  const era = spec.eras.find((e) => e.id === spec.default) || spec.eras[0];
  const png = readPng(repoPath(era.map));
  if (png.channels !== 1) throw new Error("teacher map is not a paletted PNG");
  return { era, width: png.width, height: png.height, data: png.data };
}

const percent = (value) => (value === null ? "  -  " : `${(value * 100).toFixed(1)}%`);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const worldDir = path.join(REPO, args.world);
  const config = JSON.parse(readFileSync(path.join(worldDir, "config.json"), "utf8"));

  const sets = resolveClimateSets(config);
  const set = sets.sets.find((s) => s.id === sets.defaultId);
  const params = args.temperature === null
    ? set.values
    : { ...set.values, meanTemperatureC: args.temperature };

  const elevation = loadElevation(config);
  const teacher = loadTeacher(config);
  const climate = computeClimate({
    elevation,
    seaLevelMetres: 0,
    axialTiltDegrees: config.body.axialTiltDegrees,
    radiusMetres: config.body.radiusMetres,
    dayLengthHours: config.body.dayLengthHours,
    rotationDirection: config.body.rotationDirection,
    params,
  });
  const result = scoreAgainstTeacher({
    elevation, climate, teacher, seaLevelMetres: 0, params, step: args.step,
  });

  if (args.json) {
    console.log(JSON.stringify({
      world: config.id, era: teacher.era.id, set: set.id,
      meanTemperatureC: params.meanTemperatureC, ...result,
    }, null, 1));
    return;
  }

  console.log(`${config.name} — 教師データ「${teacher.era.label}」, 気候「${set.label}」, 平均気温 ${params.meanTemperatureC}°C`);
  console.log("");
  // teacher/model are each class's share of the whole globe, so the two
  // columns say whether the model paints too much or too little of it --
  // which IoU alone cannot tell you.
  const globe = Object.values(result.classes).reduce((a, c) => a + c.teacherArea, 0)
    / (result.classes.vegetation.teacherArea > 0 ? 1 : 1);
  const total = result.totalWeight || globe;
  console.log("  class      一致度(IoU)  再現率  適合率  teacher  model");
  for (const spec of SCORED_CLASSES) {
    const c = result.classes[spec.key];
    console.log(
      `  ${spec.label.padEnd(4, "　")}      ${percent(c.iou).padStart(6)}  ` +
      `${percent(c.recall).padStart(6)}  ${percent(c.precision).padStart(6)}  ` +
      `${percent(c.teacherArea / total).padStart(7)}  ${percent(c.modelArea / total).padStart(6)}`
    );
  }
  console.log("");
  console.log(`  総合 (4クラス平均 IoU)    ${percent(result.meanIou)}`);
  console.log(`  陸地の一致率              ${percent(result.landAccuracy)}`);
  console.log(`  地域ばらつき (${result.regionCount} cells)   ${percent(1 - result.regionPenalty)}`);
  console.log(`  探索用スコア (低いほど良い) ${result.score.toFixed(4)}`);

  if (args.regions > 0) {
    const worst = [...result.regions].sort((a, b) => a.softIou - b.softIou).slice(0, args.regions);
    console.log("");
    console.log(`  worst ${worst.length} regions:`);
    for (const r of worst) {
      console.log(
        `    lat ${String(r.lat - 15).padStart(4)}..${String(r.lat).padStart(3)}  ` +
        `lng ${String(r.lng).padStart(5)}..${String(r.lng + 30).padStart(4)}  ` +
        `${percent(r.softIou).padStart(6)}  (${(r.land * 100).toFixed(1)}% of land)`
      );
    }
  }
}

main()
