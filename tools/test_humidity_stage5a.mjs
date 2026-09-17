// Stage 5A unit tests: the humidity thermodynamics, with no network and no
// teacher data. Everything here is checkable against published reference
// values or against a physical requirement that must hold on any planet.
//
// Run: node tools/test_humidity_stage5a.mjs
//
// These tests exist because Stage 5A has **zero free parameters**: if one
// fails, there is nothing to tune, so the failure is a real error in the
// formula, the units, the grid or an input field. Do not "fix" a failure
// here by loosening a tolerance.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import { resolveClimateSets } from "../js/climate.js";
import { buildTerrainField } from "../js/climate-v1/terrain.js";
import { loadOceanMask, loadWaterSurfaceMask } from "./ocean_mask.mjs";
import { buildTemperatureField } from "../js/climate-v1/temperature.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "../js/climate-v1/earth-temperature-calibration.js";
import {
  buildHumidityField,
  hydrostaticSurfacePressureHPa,
  saturationSpecificHumidity,
  saturationVapourPressureHPa,
  WATER_SATURATION_COEFFICIENTS,
} from "../js/climate-v1/humidity.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Earth's values, supplied HERE by the caller -- deliberately not inside
// js/climate-v1/humidity.js, which must work for any planet.
const EARTH_ATMOSPHERE = {
  seaLevelPressureHPa: 1013.25,
  specificGasConstantJPerKgK: 287.05, // dry air
  vapourGasConstantJPerKgK: 461.52,   // water vapour
};
const EARTH_GRAVITY = 9.80665;

let passed = 0;
let failed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? `  (${detail})` : ""}`);
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}
function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

// ---------------------------------------------------------------------------
console.log("\n1. Saturation vapour pressure against published values");
// Reference e_s over liquid water, from the Smithsonian Meteorological
// Tables / standard textbook values. Magnus is an approximation, so the
// tolerance is the approximation's own documented accuracy, not zero.
const ES_REFERENCE = [
  [-20, 1.2540], [-10, 2.8627], [0, 6.1121], [10, 12.272],
  [20, 23.373], [30, 42.430], [40, 73.750],
];
for (const [tC, expected] of ES_REFERENCE) {
  const got = saturationVapourPressureHPa(tC);
  const relErr = Math.abs(got - expected) / expected;
  check(`e_s(${tC} C) = ${got.toFixed(4)} hPa vs reference ${expected}`, relErr < 0.01,
    `relative error ${(relErr * 100).toFixed(2)}%`);
}

// ---------------------------------------------------------------------------
console.log("\n2. Saturation specific humidity against independent values");
const EPS = EARTH_ATMOSPHERE.specificGasConstantJPerKgK / EARTH_ATMOSPHERE.vapourGasConstantJPerKgK;
check(`epsilon = ${EPS.toFixed(5)} is Earth's ~0.622`, near(EPS, 0.622, 0.002));
// Independent reference: q_sat computed from the reference e_s above, by
// the definition, rather than from our own e_s -- so an error in e_s cannot
// hide behind a matching error here.
const Q_CASES = [[-20, 1013.25], [0, 1013.25], [15, 1013.25], [30, 1013.25], [15, 700], [15, 500]];
for (const [tC, p] of Q_CASES) {
  const esRef = ES_REFERENCE.find(([t]) => t === tC)?.[1];
  const got = saturationSpecificHumidity(saturationVapourPressureHPa(tC), p, EPS) * 1000;
  if (esRef !== undefined) {
    const expected = ((EPS * esRef) / (p - (1 - EPS) * esRef)) * 1000;
    check(`q_sat(${tC} C, ${p} hPa) = ${got.toFixed(3)} g/kg vs ${expected.toFixed(3)} from reference e_s`,
      Math.abs(got - expected) / expected < 0.01);
  } else {
    check(`q_sat(${tC} C, ${p} hPa) = ${got.toFixed(3)} g/kg is finite and positive`, got > 0 && Number.isFinite(got));
  }
}

// ---------------------------------------------------------------------------
console.log("\n3. Monotonicity (must hold on any planet)");
let monotoneT = true;
for (let tC = -50; tC < 50; tC += 1) {
  if (saturationSpecificHumidity(saturationVapourPressureHPa(tC + 1), 1000, EPS) <=
      saturationSpecificHumidity(saturationVapourPressureHPa(tC), 1000, EPS)) monotoneT = false;
}
check("q_sat increases with temperature over -50..50 C", monotoneT);
let monotoneP = true;
for (let p = 300; p < 1100; p += 10) {
  if (saturationSpecificHumidity(saturationVapourPressureHPa(15), p + 10, EPS) >=
      saturationSpecificHumidity(saturationVapourPressureHPa(15), p, EPS)) monotoneP = false;
}
check("q_sat decreases with pressure over 300..1100 hPa", monotoneP);

// ---------------------------------------------------------------------------
console.log("\n4. Hydrostatic pressure");
const pAt = (z, tC) => hydrostaticSurfacePressureHPa({
  elevationMetres: z, surfaceTemperatureC: tC, lapseRateCPerKm: 6.5,
  seaLevelPressureHPa: EARTH_ATMOSPHERE.seaLevelPressureHPa,
  gravityMs2: EARTH_GRAVITY,
  specificGasConstantJPerKgK: EARTH_ATMOSPHERE.specificGasConstantJPerKgK,
});
check(`p(z=0) = ${pAt(0, 15).toFixed(6)} hPa is exactly p0`, pAt(0, 15) === EARTH_ATMOSPHERE.seaLevelPressureHPa);
let monotoneZ = true;
for (let z = -500; z < 6000; z += 100) if (pAt(z + 100, 15) >= pAt(z, 15)) monotoneZ = false;
check("p decreases monotonically with elevation over -500..6000 m", monotoneZ);
const p5500 = pAt(5500, -20);
check(`p(5500 m) = ${p5500.toFixed(1)} hPa is roughly half of p0`, p5500 > 450 && p5500 < 570);

// --- the correction this stage was asked for -------------------------------
console.log("\n5. Below-sea-level land must give p > p0 (Stage 5A correction 2)");
// Real places, real depths: the Dead Sea shore (-430 m), Turfan (-154 m),
// the Qattara depression (-133 m) and Danakil (-125 m).
for (const [label, z] of [["Dead Sea shore", -430], ["Turfan depression", -154], ["Qattara", -133], ["Danakil", -125]]) {
  const p = pAt(z, 25);
  check(`${label} (${z} m): p = ${p.toFixed(2)} hPa > p0`, p > EARTH_ATMOSPHERE.seaLevelPressureHPa,
    `+${(p - EARTH_ATMOSPHERE.seaLevelPressureHPa).toFixed(2)} hPa`);
}
// And the consequence that actually matters downstream: more pressure at
// the same temperature means a lower saturation capacity.
const qSea = saturationSpecificHumidity(saturationVapourPressureHPa(25), pAt(0, 25), EPS);
const qDead = saturationSpecificHumidity(saturationVapourPressureHPa(25), pAt(-430, 25), EPS);
check(`q_sat at -430 m (${(qDead * 1000).toFixed(3)} g/kg) < at sea level (${(qSea * 1000).toFixed(3)} g/kg)`, qDead < qSea,
  `${(((qDead / qSea) - 1) * 100).toFixed(2)}%`);

// ---------------------------------------------------------------------------
console.log("\n6. Required inputs throw rather than defaulting");
const dummyTerrain = { width: 2, height: 1, isSea: new Uint8Array([1, 0]), relativeElevationMetres: new Float32Array([0, 100]), seaLevelMetres: 0 };
const dummyTemp = { width: 2, height: 1, annualMeanTemperatureC: new Float32Array([15, 10]) };
const base = { terrainField: dummyTerrain, temperatureField: dummyTemp, lapseRateCPerKm: 6.5, body: { gravityMs2: EARTH_GRAVITY }, atmosphere: EARTH_ATMOSPHERE };
function throws(fn) { try { fn(); return false; } catch { return true; } }
check("missing gravityMs2 throws", throws(() => buildHumidityField({ ...base, body: {} })));
check("missing vapourGasConstantJPerKgK throws",
  throws(() => buildHumidityField({ ...base, atmosphere: { ...EARTH_ATMOSPHERE, vapourGasConstantJPerKgK: undefined } })));
check("missing seaLevelPressureHPa throws",
  throws(() => buildHumidityField({ ...base, atmosphere: { ...EARTH_ATMOSPHERE, seaLevelPressureHPa: undefined } })));
check("missing lapseRateCPerKm throws", throws(() => buildHumidityField({ ...base, lapseRateCPerKm: undefined })));
check("mismatched grids throw",
  throws(() => buildHumidityField({ ...base, temperatureField: { width: 4, height: 1, annualMeanTemperatureC: new Float32Array(4) } })));
check("a valid call does not throw", !throws(() => buildHumidityField(base)));

// ---------------------------------------------------------------------------
console.log("\n7. Sea cells take the reference surface exactly");
{
  // A sea cell whose raster elevation is -4000 m must still get p = p0:
  // the sea surface is the reference, not the seabed.
  const terrain = { width: 1, height: 1, isSea: new Uint8Array([1]), relativeElevationMetres: new Float32Array([-4000]), seaLevelMetres: 0 };
  const temp = { width: 1, height: 1, annualMeanTemperatureC: new Float32Array([20]) };
  const f = buildHumidityField({ ...base, terrainField: terrain, temperatureField: temp });
  check(`deep-ocean cell p = ${f.surfacePressureHPa[0].toFixed(4)} hPa is exactly p0`,
    f.surfacePressureHPa[0] === EARTH_ATMOSPHERE.seaLevelPressureHPa);
}

// ---------------------------------------------------------------------------
console.log("\n8. No latitude dependence sneaks in (isothermal world)");
{
  const W = 8, H = 4;
  const isSea = new Uint8Array(W * H);
  const elev = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) elev[i] = 1000; // uniform plateau, all land
  const temp = new Float32Array(W * H).fill(10);
  const f = buildHumidityField({
    ...base,
    terrainField: { width: W, height: H, isSea, relativeElevationMetres: elev, seaLevelMetres: 0 },
    temperatureField: { width: W, height: H, annualMeanTemperatureC: temp },
  });
  let spread = 0;
  for (let i = 1; i < W * H; i++) spread = Math.max(spread, Math.abs(f.surfacePressureHPa[i] - f.surfacePressureHPa[0]));
  check(`uniform T and z give one pressure everywhere (spread ${spread.toExponential(2)} hPa)`, spread === 0);
}

// ---------------------------------------------------------------------------
console.log("\n9. Generality: a different planet gets different, sane numbers");
{
  // Mars-like: g = 3.72, CO2 atmosphere (R_d = 188.9), p0 = 6.1 hPa.
  // Nothing Earth-specific may be embedded in the module, so this must run
  // and must produce a scale height visibly different from Earth's.
  const marsAtm = { seaLevelPressureHPa: 6.1, specificGasConstantJPerKgK: 188.9, vapourGasConstantJPerKgK: 461.52 };
  const pMars = (z) => hydrostaticSurfacePressureHPa({
    elevationMetres: z, surfaceTemperatureC: -60, lapseRateCPerKm: 2.5,
    seaLevelPressureHPa: marsAtm.seaLevelPressureHPa, gravityMs2: 3.72,
    specificGasConstantJPerKgK: marsAtm.specificGasConstantJPerKgK,
  });
  const hMars = -10000 / Math.log(pMars(10000) / marsAtm.seaLevelPressureHPa);
  const hEarth = -10000 / Math.log(pAt(10000, -20) / EARTH_ATMOSPHERE.seaLevelPressureHPa);
  check(`Mars scale height ${(hMars / 1000).toFixed(1)} km differs from Earth's ${(hEarth / 1000).toFixed(1)} km`,
    Math.abs(hMars - hEarth) > 2000);
  check(`Mars epsilon differs from Earth's`, Math.abs(marsAtm.specificGasConstantJPerKgK / marsAtm.vapourGasConstantJPerKgK - EPS) > 0.1);
}

// ---------------------------------------------------------------------------
console.log("\n10. The predicted ice-phase bias, stated in advance");
{
  // e_s over ice (Magnus form for ice) vs over water, as documented in the
  // module header. Confirming the *predicted* size is how a known
  // approximation gets documented rather than discovered later.
  const esIce = (tC) => 6.112 * Math.exp((22.46 * tC) / (tC + 272.62));
  for (const [tC, expected] of [[-10, 0.906], [-20, 0.821], [-40, 0.678]]) {
    const ratio = esIce(tC) / saturationVapourPressureHPa(tC);
    check(`e_s(ice)/e_s(water) at ${tC} C = ${ratio.toFixed(3)} matches the documented ${expected}`,
      near(ratio, expected, 0.01));
  }
}

// ---------------------------------------------------------------------------
console.log("\n11. Whole-Earth field: shape, finiteness, and physical range");
{
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
  const terrainField = buildTerrainField({ elevationGrid: { width: png.width, height: png.height, metres }, seaLevelMetres: 0, oceanMask: loadOceanMask(config, REPO), waterSurfaceMask: loadWaterSurfaceMask(config, REPO) });
  const temperatureField = buildTemperatureField({ terrainField, axialTiltDegrees: config.body.axialTiltDegrees, params });

  const t0 = Date.now();
  const field = buildHumidityField({
    terrainField, temperatureField, lapseRateCPerKm: params.surfaceLapseRateCPerKm ?? params.lapseRateCPerKm,
    body: { gravityMs2: EARTH_GRAVITY }, atmosphere: EARTH_ATMOSPHERE,
  });
  const ms = Date.now() - t0;

  const n = field.width * field.height;
  let finite = true, pMin = Infinity, pMax = -Infinity, qMin = Infinity, qMax = -Infinity;
  let aboveP0 = 0, seaExact = 0, seaCells = 0;
  for (let i = 0; i < n; i++) {
    const p = field.surfacePressureHPa[i], q = field.saturationSpecificHumidityKgPerKg[i];
    if (!Number.isFinite(p) || !Number.isFinite(q) || q <= 0) finite = false;
    if (p < pMin) pMin = p; if (p > pMax) pMax = p;
    if (q < qMin) qMin = q; if (q > qMax) qMax = q;
    if (p > EARTH_ATMOSPHERE.seaLevelPressureHPa) aboveP0++;
    if (terrainField.isSea[i]) { seaCells++; if (p === EARTH_ATMOSPHERE.seaLevelPressureHPa) seaExact++; }
  }
  check(`every cell finite and q_sat > 0 (${n} cells)`, finite);
  // The upper bound allows for below-sea-level LAND, which Stage 5A.5 made
  // possible. The cells that reach it are lake beds, not dry ground: the
  // maximum is Lake Baikal's floor at -1138 m (107.8E 53.2N), and the
  // Caspian's is 1139.9 hPa. Genuinely dry below-sea-level land tops out
  // around 1054 hPa in the Dead Sea basin. See the lake caveat in
  // docs/climate-v1-humidity-stage5a.md.
  check(`pressure range ${pMin.toFixed(1)}..${pMax.toFixed(1)} hPa is physical`, pMin > 300 && pMax < 1200);
  check(`q_sat range ${(qMin * 1000).toFixed(3)}..${(qMax * 1000).toFixed(2)} g/kg is physical`, qMin * 1000 > 0.001 && qMax * 1000 < 45);
  check(`all ${seaCells} sea cells are exactly p0`, seaExact === seaCells);
  console.log(`  note  built ${field.width}x${field.height} in ${ms} ms`);

  // FIXED IN STAGE 5A.5.
  //
  // This assertion used to read "Climate v1's mask yields no below-sea-level
  // land today (0 cells above p0)" and it was recording a real bug: the
  // land/sea rule was a plain elevation threshold, so every endorheic basin
  // on Earth was classified as ocean and dry land below sea level could not
  // exist. Stage 5A.5 replaced that with a connectivity rule, so it now
  // does exist and this asserts the corrected state.
  check(`below-sea-level land exists and is not clamped (${aboveP0} cells above p0)`, aboveP0 > 0);
  check("the Dead Sea basin is one of them",
    (() => {
      const x = Math.floor(((35.5 + 180) / 360) * field.width);
      const y = Math.floor(((90 - 31.5) / 180) * field.height);
      const i = y * field.width + x;
      return !terrainField.isSea[i] && field.surfacePressureHPa[i] > EARTH_ATMOSPHERE.seaLevelPressureHPa;
    })(),
    "the basin Stage 5A could not represent");
}

// ---------------------------------------------------------------------------
console.log("\n12. End-to-end: an injected below-sea-level land cell gets p > p0");
{
  // Same path as the whole-Earth build -- buildHumidityField, not the bare
  // pressure function -- with one cell marked as dry land at -430 m.
  const W = 3, H = 1;
  const isSea = new Uint8Array([1, 0, 0]);
  const elev = new Float32Array([-4000, -430, 800]);
  const temp = new Float32Array([20, 25, 10]);
  const f = buildHumidityField({
    ...base,
    terrainField: { width: W, height: H, isSea, relativeElevationMetres: elev, seaLevelMetres: 0 },
    temperatureField: { width: W, height: H, annualMeanTemperatureC: temp },
  });
  check(`sea cell over a -4000 m seabed: p = ${f.surfacePressureHPa[0].toFixed(2)} hPa is p0`,
    f.surfacePressureHPa[0] === EARTH_ATMOSPHERE.seaLevelPressureHPa);
  check(`land cell at -430 m: p = ${f.surfacePressureHPa[1].toFixed(2)} hPa > p0`,
    f.surfacePressureHPa[1] > EARTH_ATMOSPHERE.seaLevelPressureHPa,
    `+${(f.surfacePressureHPa[1] - EARTH_ATMOSPHERE.seaLevelPressureHPa).toFixed(2)} hPa`);
  check(`land cell at +800 m: p = ${f.surfacePressureHPa[2].toFixed(2)} hPa < p0`,
    f.surfacePressureHPa[2] < EARTH_ATMOSPHERE.seaLevelPressureHPa);
  check(`the -430 m cell's q_sat is reduced by its higher pressure`,
    f.saturationSpecificHumidityKgPerKg[1] <
      saturationSpecificHumidity(saturationVapourPressureHPa(25), EARTH_ATMOSPHERE.seaLevelPressureHPa, EPS));
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
