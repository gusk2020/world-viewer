// Scores the climate model's *structure* -- season, monsoon, wet/dry cycle --
// against Teacher B (worlds/<world>/teacher/koppen-structure.png), completely
// separately from tools/score_climate.mjs's Teacher A (vegetation / arid /
// land ice / sea ice). The two are never combined into one number; see
// docs/climate-model-diagnosis-after-stage7_5.md, section 10, for why.
//
// Usage:
//   node tools/score_koppen.mjs [worlds/kasoku-sekai] [options]
//     --temperature <C>          score at this mean temperature instead
//     --seasonal <C>             override seasonalSensitivityC
//     --pin NAME=VALUE           override any other named parameter (repeatable)
//     --step <n>                 sample every nth pixel (default 1)
//     --json                     print machine-readable JSON instead of a table
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import {
  computeClimate,
  resolveClimateSets,
  scoreAgainstStructureTeacher,
  STRUCTURE_CLASSES,
} from "../js/climate.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoPath = (url) => path.join(REPO, url.replace(/^\.\//, ""));

function parseArgs(argv) {
  const out = { world: "worlds/kasoku-sekai", step: 1, json: false, temperature: null, overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--step") out.step = Number(argv[++i]);
    else if (a === "--temperature") out.temperature = Number(argv[++i]);
    else if (a === "--seasonal") out.overrides.seasonalSensitivityC = Number(argv[++i]);
    else if (a === "--pin") {
      const [name, value] = argv[++i].split("=");
      out.overrides[name] = Number(value);
    } else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else out.world = a;
  }
  return out;
}

function loadElevation(config) {
  const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
  const png = readPng(repoPath(level.url));
  const offset = config.terrain.encoding.offsetMetres;
  const metres = new Int16Array(png.width * png.height);
  for (let i = 0; i < metres.length; i++) {
    metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;
  }
  return { width: png.width, height: png.height, metres };
}

function loadStructureTeacher(config) {
  const spec = config.teacherStructure;
  if (!spec) {
    throw new Error(
      "this world has no Teacher B data (see tools/build_koppen_teacher.py and " +
      ".github/workflows/build-koppen-teacher.yml)"
    );
  }
  const png = readPng(repoPath(spec.map));
  if (png.channels !== 1) throw new Error("Teacher B map is not a paletted PNG");
  return { width: png.width, height: png.height, data: png.data };
}

const percent = (value) => (value === null ? "  -  " : `${(value * 100).toFixed(1)}%`);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const worldDir = path.join(REPO, args.world);
  const config = JSON.parse(readFileSync(path.join(worldDir, "config.json"), "utf8"));

  const sets = resolveClimateSets(config);
  const set = sets.sets.find((s) => s.id === sets.defaultId);
  const params = { ...set.values, ...args.overrides };
  if (args.temperature !== null) params.meanTemperatureC = args.temperature;

  const elevation = loadElevation(config);
  const teacher = loadStructureTeacher(config);
  const climate = computeClimate({
    elevation,
    seaLevelMetres: 0,
    axialTiltDegrees: config.body.axialTiltDegrees,
    radiusMetres: config.body.radiusMetres,
    dayLengthHours: config.body.dayLengthHours,
    rotationDirection: config.body.rotationDirection,
    params,
  });
  const result = scoreAgainstStructureTeacher({
    elevation, climate, teacher, seaLevelMetres: 0, params, step: args.step,
  });

  if (args.json) {
    console.log(JSON.stringify({ world: config.id, overrides: args.overrides, ...result }, null, 1));
    return;
  }

  const overrideText = Object.keys(args.overrides).length
    ? ` (override: ${Object.entries(args.overrides).map(([k, v]) => `${k}=${v}`).join(", ")})`
    : "";
  console.log(`${config.name} — Teacher B（気候構造）${overrideText}`);
  console.log("");
  console.log("  class          一致度(IoU)  再現率  適合率  teacher  model");
  const total = result.landWeight;
  for (const spec of STRUCTURE_CLASSES) {
    const c = result.classes[spec.key];
    console.log(
      `  ${spec.label.padEnd(5, "　")}      ${percent(c.iou).padStart(6)}  ` +
      `${percent(c.recall).padStart(6)}  ${percent(c.precision).padStart(6)}  ` +
      `${percent(c.teacherArea / total).padStart(7)}  ${percent(c.modelArea / total).padStart(6)}`
    );
  }
  console.log("");
  console.log(`  総合 (8クラス平均 IoU)    ${percent(result.meanIou)}`);
  console.log(`  陸地の一致率              ${percent(result.landAccuracy)}`);
}

main();
