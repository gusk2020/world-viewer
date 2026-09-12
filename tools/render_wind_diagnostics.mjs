// Renders the Stage 4 wind comparison as diagnostic PNGs: the teacher, the
// old model, the new model, and each model's direction error, on the same
// grid and the same colour scale.
//
// **Diagnostic only -- nothing here is wired to the app's UI.** The images
// exist so the Stage 4 document's numbers can be looked at rather than only
// read, and so a future stage can see at a glance which regions moved.
//
// Writes its own PNGs rather than depending on a library: node's zlib is
// all an 8-bit RGB PNG actually needs, and this project has no build step
// to hang a dependency on.
//
// Usage: node tools/render_wind_diagnostics.mjs [outputDir]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import { parseWindGrid } from "../js/climate-v1/wind-teacher.js";
import { currentModelWind, fitSpeedScaleK, nearestModelRow } from "../js/climate-v1/wind-diagnostic.js";
import { buildClimateV1Wind } from "../js/climate-v1/wind.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCALE = 3; // pixels per teacher cell, so the 144x73 grid is legible

// --- minimal PNG writer -----------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crcInput = Buffer.concat([Buffer.from(type, "ascii"), data]);
  out.writeUInt32BE(crc32(crcInput), 8 + data.length);
  return out;
}
function writePng(filePath, width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  }
  writeFileSync(filePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

// --- colour ramps -----------------------------------------------------------
// Speed: a plain dark-to-bright ramp, same scale for every speed image so
// the three are directly comparable by eye.
function speedColour(v, maxV) {
  if (!Number.isFinite(v)) return [60, 60, 66]; // masked (below ground at 850 hPa)
  const t = Math.min(1, Math.max(0, v / maxV));
  return [Math.round(255 * Math.min(1, t * 1.6)), Math.round(255 * Math.min(1, Math.max(0, t * 1.6 - 0.4))), Math.round(255 * Math.min(1, Math.max(0, t * 1.6 - 0.9)))];
}
// Direction error: 0 deg green, 90 deg yellow, 180 deg red -- so "pointing
// the wrong way" is visually distinct from "somewhat off".
function directionColour(deg) {
  if (!Number.isFinite(deg)) return [60, 60, 66];
  const t = Math.min(1, Math.max(0, deg / 180));
  return t < 0.5
    ? [Math.round(510 * t), 180, 60]
    : [255, Math.round(180 - 240 * (t - 0.5)), 60];
}

function render(outPath, width, height, valueAt, colour) {
  const w = width * SCALE, h = height * SCALE;
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = colour(valueAt(Math.floor(x / SCALE), Math.floor(y / SCALE)));
      const i = (y * w + x) * 3;
      rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
    }
  }
  writePng(outPath, w, h, rgb);
  return outPath;
}

function main() {
  const outDir = path.resolve(process.argv[2] || path.join(REPO, "docs", "images"));
  mkdirSync(outDir, { recursive: true });
  const worldDir = path.join(REPO, "worlds", "kasoku-sekai");
  const config = JSON.parse(readFileSync(path.join(worldDir, "config.json"), "utf8"));

  const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
  const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
  const offset = config.terrain.encoding.offsetMetres;
  const metres = new Int16Array(png.width * png.height);
  for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;

  const sets = resolveClimateSets(config);
  const shipped = sets.sets.find((s) => s.id === sets.defaultId).values;
  const params = { ...shipped, ...CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION };

  const summary = JSON.parse(readFileSync(path.join(worldDir, "teacher", "wind-summary.json"), "utf8"));
  const spec = summary.grids.level850hPa;
  const g = (f) => parseWindGrid(readFileSync(path.join(worldDir, "teacher", f)), spec).values;
  const teacher = { width: spec.width, height: spec.height, u: g(spec.files.u), v: g(spec.files.v) };

  const terrainField = buildTerrainField({ elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0 });
  const temperatureField = buildTemperatureField({ terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params });
  const newField = buildClimateV1Wind({
    terrainField, temperatureField, lapseRateCPerKm: params.lapseRateCPerKm,
    body: config.body,
    atmosphere: { specificGasConstantJPerKgK: 287, surfacePressureHPa: 1000, levelPressureHPa: 850 },
    params: { thermalResponseStrength: 1, dragTimescaleDays: 0.5, thermalSmoothingKm: 1500 },
    width: 256, height: 128,
  });
  const oldWind = currentModelWind({
    rows: 180, dayLengthHours: config.body.dayLengthHours,
    rotationDirection: config.body.rotationDirection, params: shipped, subsolarDeg: 0,
  });

  const latOf = (y) => 90 - (y + 0.5) * (180 / teacher.height);
  const lngOf = (x) => -180 + (x + 0.5) * (360 / teacher.width);
  const kRows = [];
  for (let y = 0; y < teacher.height; y++) {
    const lat = latOf(y);
    const weight = Math.cos((lat * Math.PI) / 180);
    const modelSpeed = oldWind.magnitude[nearestModelRow(lat, oldWind.rows)];
    for (let x = 0; x < teacher.width; x++) {
      const i = y * teacher.width + x;
      if (!Number.isFinite(teacher.u[i])) continue;
      kRows.push({ modelSpeed, teacherSpeed: Math.hypot(teacher.u[i], teacher.v[i]), weight });
    }
  }
  const k = fitSpeedScaleK(kRows).k;

  const oldAt = (x, y) => {
    const row = nearestModelRow(latOf(y), oldWind.rows);
    return [oldWind.east[row] * k, oldWind.north[row] * k];
  };
  const newAt = (x, y) => {
    const mx = Math.min(newField.width - 1, Math.max(0, Math.floor(((lngOf(x) + 180) / 360) * newField.width)));
    const my = Math.min(newField.height - 1, Math.max(0, Math.floor(((90 - latOf(y)) / 180) * newField.height)));
    const i = my * newField.width + mx;
    return [newField.uWindMs[i], newField.vWindMs[i]];
  };
  const teacherAt = (x, y) => {
    const i = y * teacher.width + x;
    return [teacher.u[i], teacher.v[i]];
  };
  const masked = (x, y) => !Number.isFinite(teacher.u[y * teacher.width + x]);
  const angle = (a, b) => {
    const ma = Math.hypot(a[0], a[1]), mb = Math.hypot(b[0], b[1]);
    if (!(ma > 0) || !(mb > 0)) return NaN;
    const c = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1]) / (ma * mb)));
    return (Math.acos(c) * 180) / Math.PI;
  };

  const MAX_SPEED = 15; // m/s, shared by all three speed images
  const written = [];
  const W = teacher.width, H = teacher.height;
  written.push(render(path.join(outDir, "stage4-wind-teacher-speed.png"), W, H,
    (x, y) => (masked(x, y) ? NaN : Math.hypot(...teacherAt(x, y))), (v) => speedColour(v, MAX_SPEED)));
  written.push(render(path.join(outDir, "stage4-wind-old-speed.png"), W, H,
    (x, y) => (masked(x, y) ? NaN : Math.hypot(...oldAt(x, y))), (v) => speedColour(v, MAX_SPEED)));
  written.push(render(path.join(outDir, "stage4-wind-new-speed.png"), W, H,
    (x, y) => (masked(x, y) ? NaN : Math.hypot(...newAt(x, y))), (v) => speedColour(v, MAX_SPEED)));
  written.push(render(path.join(outDir, "stage4-wind-old-direction-error.png"), W, H,
    (x, y) => (masked(x, y) ? NaN : angle(oldAt(x, y), teacherAt(x, y))), directionColour));
  written.push(render(path.join(outDir, "stage4-wind-new-direction-error.png"), W, H,
    (x, y) => (masked(x, y) ? NaN : angle(newAt(x, y), teacherAt(x, y))), directionColour));

  for (const p of written) console.log(`wrote ${path.relative(REPO, p)}`);
  console.log(`speed images share a 0..${MAX_SPEED} m/s scale; direction error runs green(0) -> yellow(90) -> red(180); grey = masked below ground`);
}

main();
