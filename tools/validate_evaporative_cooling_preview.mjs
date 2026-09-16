// Experimental evaporative cooling: does it do what it is supposed to, and
// does OFF still reproduce Stage 2 exactly?
//
// This is a preview check, not an adoption test. Nothing is fitted here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { parseTeacherGrid } from "../js/climate-v1/humidity-teacher.js";
import { buildClimateV1Preview, PREVIEW_GRID } from "../js/climate-v1/preview.js";
import { EVAPORATIVE_COOLING_PREVIEW_C } from "../js/climate-v1/evaporative-cooling.js";
import { loadNcepOracleWind } from "./ncep_oracle_wind.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai"), TEACHER = path.join(WORLD, "teacher");
const W = PREVIEW_GRID.width, H = PREVIEW_GRID.height;

const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));
const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
const offset = config.terrain.encoding.offsetMetres;
const metres = new Int16Array(png.width * png.height);
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;
const sets = resolveClimateSets(config);
const params = { ...sets.sets.find((s) => s.id === sets.defaultId).values,
  insolationSensitivityC: 80.68, oceanModeration: 0.818 };
const terrainField = buildTerrainField({
  elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0,
  oceanMask: loadOceanMask(config, REPO), waterSurfaceMask: loadWaterSurfaceMask(config, REPO),
});

const hsum = JSON.parse(readFileSync(path.join(TEACHER, "humidity-summary.json"), "utf8"));
const TG = {};
for (const [n, s] of Object.entries(hsum.grids)) TG[n] = { ...parseTeacherGrid(readFileSync(path.join(TEACHER, s.file)), s), latitudes: s.latitudes, longitudes: s.longitudes };
const nearestIn = (axis, v, wrap) => { let b = 0, bd = Infinity; for (let i = 0; i < axis.length; i++) { let d = Math.abs(axis[i] - v); if (wrap) d = Math.min(d, 360 - d); if (d < bd) { bd = d; b = i; } } return b; };
const sampleT = (name, lat, lng) => { const g = TG[name]; return g.values[nearestIn(g.latitudes, lat) * g.width + nearestIn(g.longitudes.map((l) => (l > 180 ? l - 360 : l)), lng, true)]; };

const WIND = process.argv.includes("--observed")
  ? loadNcepOracleWind({ teacherDir: TEACHER, width: W, height: H, quiet: true })
  : null;
const t0 = Date.now();
const off = buildClimateV1Preview({ terrainField, body: config.body, params, oracleWind: WIND });
const offMs = Date.now() - t0;
const t1 = Date.now();
const on = buildClimateV1Preview({ terrainField, body: config.body, params, oracleWind: WIND,
  evaporativeCooling: { evaporativeCoolingC: EVAPORATIVE_COOLING_PREVIEW_C } });
const onMs = Date.now() - t1;
console.log(`wind: ${off.windSource === "observed" ? "NCEP 850 hPa observed (diagnostic)" : "Climate v1 Stage 4 model wind (production)"}\n`);

const hash = (f) => { let h = 0x811c9dc5; const b = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };

console.log("Experimental evaporative cooling -- preview check. Nothing fitted; production default is OFF.\n");
console.log("=== regression: OFF must be Stage 2 ===");
console.log(`  base temperature hash   ${hash(off.baseTemperature.annualMeanTemperatureC)}`);
console.log(`  OFF  temperature hash   ${hash(off.temperatureField.annualMeanTemperatureC)}`);
console.log(`  OFF is the same object as the base: ${off.temperatureField === off.baseTemperature}`);
console.log(`  OFF moisture hash       ${hash(off.moistureField.specificHumidityKgPerKg)}`);
console.log(`  passes OFF ${off.evaporativeCooling.passes}, ON ${on.evaporativeCooling.passes}, ` +
  `ON residual ${on.evaporativeCooling.residualC.toFixed(4)} C, converged ${on.evaporativeCooling.converged}`);

let bad = 0;
for (const f of [on.temperatureField.annualMeanTemperatureC, on.moistureField.specificHumidityKgPerKg, on.humidityField.saturationSpecificHumidityKgPerKg]) {
  for (let i = 0; i < f.length; i++) if (!Number.isFinite(f[i])) bad++;
}
console.log(`  non-finite cells in the ON run: ${bad}`);

// region means on the fine grid for temperature, coarse for humidity
const fw = terrainField.width, fh = terrainField.height;
const latF = (y) => 90 - ((y + 0.5) * 180) / fh, lngF = (x) => -180 + ((x + 0.5) * 360) / fw;
const REGIONS = { アマゾン: [-70, -55, -8, 2], コンゴ: [15, 28, -5, 5], インドネシア: [100, 130, -8, 6],
  サハラ: [-8, 28, 18, 28], オーストラリア: [120, 145, -30, -18], インド: [73, 88, 10, 28],
  ヨーロッパ: [0, 30, 45, 58], 海洋全体: null };
function regionStats(preview, name) {
  const box = REGIONS[name];
  let sT = 0, wT = 0, sQ = 0, wQ = 0, sTeach = 0;
  for (let y = 0; y < fh; y++) {
    const lat = latF(y), w = Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < fw; x++) {
      const i = y * fw + x;
      const sea = Boolean(terrainField.isSea[i]);
      if (box === null) { if (!sea) continue; } else {
        if (sea) continue;
        if (lat < box[2] || lat > box[3] || lngF(x) < box[0] || lngF(x) > box[1]) continue;
      }
      sT += w * preview.temperatureField.annualMeanTemperatureC[i]; wT += w;
    }
  }
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) * 180) / H, w = Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < W; x++) {
      const lng = -180 + ((x + 0.5) * 360) / W;
      if (box !== null && (lat < box[2] || lat > box[3] || lng < box[0] || lng > box[1])) continue;
      const t = sampleT("airTemperatureC", lat, lng);
      sQ += w * preview.moistureField.specificHumidityKgPerKg[y * W + x] * 1000; wQ += w;
      if (Number.isFinite(t)) sTeach += w * t;
    }
  }
  return { t: sT / wT, q: sQ / wQ, teach: sTeach / wQ };
}
console.log("\n=== regions: OFF vs ON (temperature over land only; 海洋全体 is every sea cell) ===");
console.log(`${"region".padEnd(14)} ${"T OFF".padStart(7)} ${"T ON".padStart(7)} ${"dT".padStart(6)} ${"teacher".padStart(8)} ${"bias OFF".padStart(9)} ${"bias ON".padStart(8)} ${"q OFF".padStart(7)} ${"q ON".padStart(7)}`);
for (const name of Object.keys(REGIONS)) {
  const a = regionStats(off, name), b = regionStats(on, name);
  console.log(`${name.padEnd(12)} ${a.t.toFixed(1).padStart(8)} ${b.t.toFixed(1).padStart(7)} ${(b.t - a.t).toFixed(1).padStart(6)} ${a.teach.toFixed(1).padStart(8)} ` +
    `${(a.t - a.teach).toFixed(1).padStart(9)} ${(b.t - b.teach).toFixed(1).padStart(8)} ${a.q.toFixed(1).padStart(7)} ${b.q.toFixed(1).padStart(7)}`);
}
console.log(`\ntiming (node, one process): OFF ${offMs} ms, ON ${onMs} ms (${on.evaporativeCooling.passes} passes)`);
