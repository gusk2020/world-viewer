// Climate v1's sea ice: the validator.
//
// Nothing is fitted here. The repo's only sea-ice teacher is Teacher A's
// annual snapshot from a satellite photograph (class 1, 1.0% of the globe),
// so what can honestly be checked against it is whether ice exists in both
// hemispheres, roughly where perennial and seasonal ice sit, and the order of
// magnitude of the area. The seasonal maximum, minimum and phase are NOT
// checkable against anything in this repository and are not claimed to be.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import {
  CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION, climateV1SeasonParams,
} from "../js/climate-v1/earth-temperature-calibration.js";
import {
  SEASON_PARAMETERS, buildSeasonalTemperatureTable, sampleSeasonalAnomalyC, SURFACE_SEA,
} from "../js/climate-v1/season.js";
import {
  SEA_ICE_DEFAULTS, buildSeaIceCycle, resolveSeaIceParameters,
  sampleSeaIceFraction, sampleSeaIceThicknessM,
} from "../js/climate-v1/sea-ice-state.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(REPO, "worlds", "kasoku-sekai");
const config = JSON.parse(readFileSync(path.join(WORLD, "config.json"), "utf8"));

let failures = 0;
const ok = (cond, label, detail = "") => {
  if (!cond) failures++;
  console.log(`  ${cond ? "OK  " : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "  --");

// --- the inputs, exactly as the app builds them -----------------------------
const level = config.terrain.levels.filter((l) => l.width <= 2048).reduce((a, b) => (b.width > a.width ? b : a));
const png = readPng(path.join(REPO, level.url.replace(/^\.\//, "")));
const off = config.terrain.encoding.offsetMetres;
const metres = new Int16Array(png.width * png.height);
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - off;
const terrainField = buildTerrainField({
  elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0,
  oceanMask: loadOceanMask(config, REPO), waterSurfaceMask: loadWaterSurfaceMask(config, REPO),
});
const sets = resolveClimateSets(config);
const params = { ...sets.sets.find((s) => s.id === sets.defaultId).values, ...CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION };
const temperatureField = buildTemperatureField({
  terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params,
});
const seasonParams = climateV1SeasonParams(SEASON_PARAMETERS);
const seasonTable = buildSeasonalTemperatureTable({ rows: 256, body: config.body, params: seasonParams });

const W = SEA_ICE_DEFAULTS.gridWidth, H = SEA_ICE_DEFAULTS.gridHeight;
const latOf = (y) => 90 - ((y + 0.5) * 180) / H;
const cellAt = (lng, lat) => {
  const x = Math.min(W - 1, Math.floor(((lng + 180) / 360) * W));
  const y = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
  return y * W + x;
};
const PLACES = [
  ["北極点付近 88N", 0, 88], ["北極海 80N", 150, 80], ["ベーリング 62N", -175, 62],
  ["南極海 70S", 0, -70], ["南極海 62S", 60, -62], ["中緯度 40N", -150, 40], ["熱帯 10N", -140, 10],
];
// The same sea-only area average the module itself does, so an assertion can
// ask what temperature a cell actually saw.
let coarseSeaTemperatureCache = null;
function coarseSeaTemperature(index) {
  if (!coarseSeaTemperatureCache) {
    const total = new Float64Array(W * H), sum = new Float64Array(W * H);
    const bx = temperatureField.width / W, by = temperatureField.height / H;
    for (let y = 0; y < temperatureField.height; y++) {
      const cy = Math.min(H - 1, Math.floor(y / by));
      for (let x = 0; x < temperatureField.width; x++) {
        const i = y * temperatureField.width + x;
        if (!terrainField.isSea[i]) continue;
        const c = cy * W + Math.min(W - 1, Math.floor(x / bx));
        total[c] += 1; sum[c] += temperatureField.annualMeanTemperatureC[i];
      }
    }
    coarseSeaTemperatureCache = new Float64Array(W * H);
    for (let c = 0; c < W * H; c++) coarseSeaTemperatureCache[c] = total[c] > 0 ? sum[c] / total[c] : NaN;
  }
  return coarseSeaTemperatureCache[index];
}

const seriesAt = (cycle, index) => {
  const out = [];
  for (let k = 0; k < cycle.phaseCount; k++) out.push(cycle.thicknessByPhase[k * W * H + index]);
  return out;
};
const fractionSeries = (cycle, index) => {
  const out = [];
  for (let k = 0; k < cycle.phaseCount; k++) out.push(cycle.fractionByPhase[k * W * H + index]);
  return out;
};

console.log("Climate v1 -- sea-ice state validation\n");
const p = resolveSeaIceParameters({});
console.log(`freeze ${p.freezeTemperatureC} C, k_ice ${p.iceConductivityWPerMK}, lambda ${p.surfaceExchangeWPerM2K}, `
  + `F_w ${p.oceanBasalHeatFluxWPerM2} W/m2 (literature, not fitted), hFull ${p.fullCoverThicknessM} m (empirical)`);

const t0 = process.hrtime.bigint();
const cycle = buildSeaIceCycle({ temperatureField, terrainField, seasonTable });
const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`grid ${W}x${H}, ${cycle.meta.stepsPerYear} steps/year, ${cycle.meta.yearsUsed} years, `
  + `${cycle.phaseCount} stored phases -- ${buildMs.toFixed(0)} ms\n`);

// --- 1. the representative places -------------------------------------------
console.log("=== 1. 代表海域 (最終年) ===");
console.log("  " + "地点".padEnd(16) + ["年最大 m", "年最小 m", "最大f", "最小f", "最大の位相", "最小の位相"].map((h) => h.padStart(11)).join(""));
const place = {};
for (const [name, lng, lat] of PLACES) {
  const i = cellAt(lng, lat);
  if (!(cycle.seaFraction[i] > 0)) { console.log("  " + name.padEnd(16) + "  (陸)"); continue; }
  const h = seriesAt(cycle, i), f = fractionSeries(cycle, i);
  const hi = Math.max(...h), lo = Math.min(...h);
  place[name] = { i, h, f, hi, lo };
  console.log("  " + name.padEnd(16) + [
    f2(hi), f2(lo), f2(Math.max(...f)), f2(Math.min(...f)),
    (h.indexOf(hi) / cycle.phaseCount).toFixed(2), (h.indexOf(lo) / cycle.phaseCount).toFixed(2),
  ].map((v) => v.padStart(11)).join(""));
}
console.log("  (位相 0=春分, 0.25=北半球の夏至, 0.5=秋分, 0.75=冬至)\n");

console.log("=== 2. 成功条件 ===");
{
  const arctic = place["北極海 80N"], bering = place["ベーリング 62N"], south = place["南極海 70S"];
  const warm = place["中緯度 40N"], tropics = place["熱帯 10N"];
  ok(arctic.lo > 0.5, "極域に多年氷が残る (80N の年最小)", f2(arctic.lo) + " m");
  ok(Math.min(...place["北極点付近 88N"].f) === 1, "88N は年中 fraction 1", "");
  ok(bering.hi > 0.1 && bering.lo === 0, "季節海氷は冬に育ち夏にゼロへ戻る (62N)", `${f2(bering.hi)} -> ${f2(bering.lo)} m`);
  ok(warm.hi === 0 && tropics.hi === 0, "暖かい海は常時ゼロ (40N / 10N)", "");
  // Growth while the sea is below freezing, loss while it is above -- stated
  // against the cell's OWN temperature cycle rather than against the
  // calendar, because the sea temperature feeding this lags the real one by
  // about 72 days (the season module's 30 m mixed layer) and a
  // calendar-anchored assertion would be testing that upstream lag, not this
  // model. See the note in section 7.
  const seaTempAt = (index, phase) => {
    const y = Math.floor(index / W);
    const tableRow = Math.min(seasonTable.rows - 1, Math.floor((y * seasonTable.rows) / H));
    return coarseSeaTemperature(index) + sampleSeasonalAnomalyC(seasonTable, tableRow, SURFACE_SEA, phase);
  };
  for (const name of ["ベーリング 62N", "南極海 70S"]) {
    const rec = place[name];
    let growsWhenCold = true, losesWhenWarm = true;
    for (let k = 0; k < cycle.phaseCount; k++) {
      const phase = k / cycle.phaseCount;
      const prev = rec.h[(k + cycle.phaseCount - 1) % cycle.phaseCount];
      const t = seaTempAt(rec.i, phase);
      const change = rec.h[k] - prev;
      // A step that is already at zero thickness cannot lose any more, and a
      // step straddling the crossing can do either; only the clear cases are
      // asserted.
      if (t < p.freezeTemperatureC - 1 && change < -1e-6) growsWhenCold = false;
      if (t > p.freezeTemperatureC + 1 && change > 1e-6) losesWhenWarm = false;
    }
    ok(growsWhenCold, `${name}: 海面が凍結点より低い位相では厚さが減らない`, "");
    ok(losesWhenWarm, `${name}: 海面が凍結点より高い位相では厚さが増えない`, "");
  }
  // Both hemispheres' seasonal-ice zones, half a year apart
  const nSeasonal = place["ベーリング 62N"], sSeasonal = place["南極海 62S"];
  if (nSeasonal && sSeasonal) {
    const nMax = nSeasonal.h.indexOf(nSeasonal.hi) / cycle.phaseCount;
    const sMax = sSeasonal.h.indexOf(sSeasonal.hi) / cycle.phaseCount;
    const apart = Math.abs(((sMax - nMax + 1.5) % 1) - 0.5);
    ok(apart > 0.3, "季節海氷の最大は南北で半年ずれる", `北 ${nMax.toFixed(2)} / 南 ${sMax.toFixed(2)} (差 ${apart.toFixed(2)} 年)`);
  }
  // The perennial cell's own numbers, reported rather than asserted: at
  // F_w = 2 its within-year swing is smaller than the spin-up trend it still
  // carries after five years, so the PHASE of its maximum is not a meaningful
  // quantity until the thickness has converged, which takes decades.
  console.log(`  参考: 80N の年内振幅 ${f2(arctic.hi - arctic.lo)} m に対し、5年目の年境界差は `
    + `${f2(cycle.meta.maxYearBoundaryDifference)} m -- 多年氷域の「最大の位相」は厚さが収束するまで意味を持たない`);
  // hard invariants over the whole table
  let bad = 0, negative = 0, outside = 0;
  for (let k = 0; k < cycle.phaseCount * W * H; k++) {
    const h = cycle.thicknessByPhase[k], f = cycle.fractionByPhase[k];
    if (!Number.isFinite(h) || !Number.isFinite(f)) bad++;
    if (h < 0) negative++;
    if (f < 0 || f > 1) outside++;
  }
  ok(bad === 0, "NaN / Inf なし", `${bad}`);
  ok(negative === 0, "厚さ >= 0", `${negative}`);
  ok(outside === 0, "fraction は [0,1]", `${outside}`);
  // lakes must not freeze: isSea excludes them by construction
  const caspian = cellAt(51, 42), superior = cellAt(-87, 47);
  ok(!(cycle.seaFraction[caspian] > 0.5), "カスピ海は海として扱われない", "");
  ok(!(cycle.seaFraction[superior] > 0.5), "五大湖は海として扱われない", "");
  // the samplers agree with the tables
  const idx = arctic.i;
  ok(Math.abs(sampleSeaIceThicknessM(cycle, idx, 0.25) - arctic.h[Math.floor(0.25 * cycle.phaseCount)]) < 1e-6,
    "sampleSeaIceThicknessM がテーブルと一致", "");
  ok(Math.abs(sampleSeaIceFraction(cycle, idx, 0.75) - arctic.f[Math.floor(0.75 * cycle.phaseCount)]) < 1e-6,
    "sampleSeaIceFraction がテーブルと一致", "");
}

// --- 3. spin-up -------------------------------------------------------------
console.log("\n=== 3. spin-up (収束は fraction と thickness で別々に記録) ===");
console.log("  " + "years".padStart(6) + ["最大厚差 m", "最大f差", "f収束", "厚さ収束", "80N 最大厚"].map((h) => h.padStart(12)).join(""));
for (const years of [1, 2, 3, 5, 10, 20]) {
  const c = buildSeaIceCycle({ temperatureField, terrainField, seasonTable, options: { years } });
  const arctic = seriesAt(c, cellAt(150, 80));
  console.log("  " + String(years).padStart(6) + [
    c.meta.maxYearBoundaryDifference.toExponential(1), c.meta.maxFractionBoundaryDifference.toExponential(1),
    String(c.meta.fractionConverged ?? "-"), String(c.meta.thicknessConverged ?? "-"), f2(Math.max(...arctic)),
  ].map((v) => v.padStart(12)).join(""));
}
{
  const a = buildSeaIceCycle({ temperatureField, terrainField, seasonTable });
  const b = buildSeaIceCycle({ temperatureField, terrainField, seasonTable });
  let same = true;
  for (let k = 0; k < a.thicknessByPhase.length; k++) if (a.thicknessByPhase[k] !== b.thicknessByPhase[k]) { same = false; break; }
  ok(same, "同じ入力から同じ結果 (再現性)", "");
}

// --- 4. time step -----------------------------------------------------------
console.log("\n=== 4. 時間刻み (8760 step を参照解として、20年 spin-up) ===");
{
  const ref = buildSeaIceCycle({ temperatureField, terrainField, seasonTable, options: { stepsPerYear: 8760, years: 20 } });
  const probes = [["北極海 80N", cellAt(150, 80)], ["ベーリング 62N", cellAt(-175, 62)], ["南極海 70S", cellAt(0, -70)]];
  const refMax = probes.map(([, i]) => Math.max(...seriesAt(ref, i)));
  let worst = 0;
  for (const steps of [24, 48, 96]) {
    const c = buildSeaIceCycle({ temperatureField, terrainField, seasonTable, options: { stepsPerYear: steps, years: 20 } });
    const parts = probes.map(([name, i], k) => {
      const d = Math.max(...seriesAt(c, i)) - refMax[k];
      if (steps === 48) worst = Math.max(worst, Math.abs(d));
      return `${name} ${f2(Math.max(...seriesAt(c, i)))} (${d >= 0 ? "+" : ""}${d.toFixed(3)})`;
    });
    console.log(`  ${String(steps).padStart(4)} step: ` + parts.join("  "));
  }
  console.log("  参照(8760): " + probes.map(([name], k) => `${name} ${f2(refMax[k])}`).join("  "));
  ok(worst <= 0.03, "48 step は参照解の年最大厚を ±0.02 m 程度で再現", `最大差 ${worst.toFixed(3)} m`);
}

// --- 5. obliquity -----------------------------------------------------------
console.log("\n=== 5. 軸傾斜 ===");
{
  const rows = [];
  for (const tilt of [0, 10, config.body.axialTiltDegrees, 40]) {
    const table = buildSeasonalTemperatureTable({
      rows: 256, body: { ...config.body, axialTiltDegrees: tilt }, params: seasonParams,
    });
    const c = buildSeaIceCycle({ temperatureField, terrainField, seasonTable: table, options: { years: 20 } });
    const swing = (i) => { const h = seriesAt(c, i); return Math.max(...h) - Math.min(...h); };
    rows.push({ tilt, north: swing(cellAt(150, 80)), south: swing(cellAt(0, -70)) });
    console.log(`  傾斜 ${String(tilt).padStart(5)} 度: 80N 年振幅 ${f2(rows.at(-1).north)} m / 70S 年振幅 ${f2(rows.at(-1).south)} m`);
  }
  ok(rows[0].north < rows[2].north && rows[0].south < rows[2].south,
    "軸傾斜 0 では季節振幅が縮む", `80N ${f2(rows[0].north)} < ${f2(rows[2].north)}`);
}

// --- 6. F_w sensitivity (a test, not a fit) ---------------------------------
console.log("\n=== 6. F_w 感度 (2 が既定。3/4 は感度試験であり採用しない) ===");
console.log("  " + "F_w".padStart(5) + ["88N", "80N", "62N", "70S", "f収束", "厚さ収束"].map((h) => h.padStart(13)).join(""));
for (const Fw of [2, 3, 4]) {
  const c = buildSeaIceCycle({
    temperatureField, terrainField, seasonTable,
    params: { oceanBasalHeatFluxWPerM2: Fw }, options: { years: 20 },
  });
  const cellText = (lng, lat) => {
    const h = seriesAt(c, cellAt(lng, lat));
    return `${f2(Math.max(...h))}/${f2(Math.min(...h))}`.padStart(13);
  };
  console.log("  " + String(Fw).padStart(5) + cellText(0, 88) + cellText(150, 80) + cellText(-175, 62) + cellText(0, -70)
    + String(c.meta.fractionConverged ?? "-").padStart(13) + String(c.meta.thicknessConverged ?? "-").padStart(13));
}
console.log("  (年最大厚/年最小厚 m)");

// --- 7. the teacher, within what it can honestly say ------------------------
console.log("\n=== 7. 教師Aとの限定比較 (通年スナップショットのみ。季節位相は検証不可) ===");
{
  // The teacher map is a PALETTED png: one class index per pixel, which
  // png.mjs hands back as a single channel. (Matching it by colour reads 0%
  // everywhere -- worth knowing, since it looks like a model failure.)
  const cls = readPng(path.join(WORLD, "teacher", "present-classes.png"));
  const seaIceClass = config.teacher.classes.indexOf("seaIce");
  let teacherIce = 0, teacherArea = 0;
  for (let y = 0; y < cls.height; y++) {
    const w = Math.cos(((90 - ((y + 0.5) * 180) / cls.height) * Math.PI) / 180);
    for (let x = 0; x < cls.width; x++) {
      teacherArea += w;
      if (cls.data[y * cls.width + x] === seaIceClass) teacherIce += w;
    }
  }
  const full = buildSeaIceCycle({ temperatureField, terrainField, seasonTable, options: { years: 20 } });
  let area = 0, maxN = 0, maxS = 0, minN = 0, minS = 0, perennial = 0;
  for (let y = 0; y < H; y++) {
    const w = Math.cos((latOf(y) * Math.PI) / 180);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      area += w;
      if (!(full.seaFraction[i] > 0)) continue;
      const f = fractionSeries(full, i);
      const hi = Math.max(...f), lo = Math.min(...f);
      const share = w * full.seaFraction[i];
      if (latOf(y) > 0) { maxN += share * hi; minN += share * lo; } else { maxS += share * hi; minS += share * lo; }
      perennial += share * lo;
    }
  }
  const pc = (v) => ((100 * v) / area).toFixed(2) + "%";
  console.log(`  モデル: 年最大 ${pc(maxN + maxS)} (北 ${pc(maxN)} / 南 ${pc(maxS)})`);
  console.log(`          年最小 ${pc(minN + minS)} (北 ${pc(minN)} / 南 ${pc(minS)})  多年氷 ${pc(perennial)}`);
  console.log(`  教師A (通年スナップショット, 写真由来): ${((100 * teacherIce) / teacherArea).toFixed(2)}%`);
  ok(maxN > 0 && maxS > 0, "南北両半球に海氷が存在する", "");
  ok(perennial > 0 && perennial < maxN + maxS, "多年氷と季節氷の両方がある", "");
  console.log("  注: 60-70度帯が経度方向に過剰凍結するのは上流のSSTに経度構造が無いため。"
    + "季節位相が2-3か月遅いのは海の混合層(30m)の位相遅れ。どちらも海氷パラメータで補正しない。");
}

// --- 8. cost ----------------------------------------------------------------
console.log("\n=== 8. 計算量とメモリ ===");
for (const [years, steps] of [[5, 24], [5, 48], [10, 48], [20, 48]]) {
  const t = process.hrtime.bigint();
  const c = buildSeaIceCycle({ temperatureField, terrainField, seasonTable, options: { years, steps: undefined, stepsPerYear: steps } });
  console.log(`  ${String(years).padStart(2)}年 x ${String(steps).padStart(3)} step: ${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(0)} ms`
    + `   テーブル ${((c.thicknessByPhase.byteLength + c.fractionByPhase.byteLength) / 1024 / 1024).toFixed(1)} MB`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
