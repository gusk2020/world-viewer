// Stage 5B unit tests: the moisture transport, with no network and no teacher.
// Run: node tools/test_moisture_stage5b.mjs
import { buildMoistureField, resolveMoistureParams, WIND_MODES, REFERENCE_TRANSPORT_SPEED_MS, MOISTURE_PARAMETERS }
  from "../js/climate-v1/moisture.js";

let passed = 0, failed = 0; const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { passed++; console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`); }
  else { failed++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
};
const EARTH = { radiusMetres: 6371000 };

// A synthetic world: an ocean strip on the left, land to the right, uniform
// temperature so q_sat is flat and only transport can create structure.
function world({ W = 32, H = 16, oceanCols = 4, qsat = 20e-3, elev = 0 } = {}) {
  const n = W * H;
  const isWaterSurface = new Uint8Array(n), isSea = new Uint8Array(n);
  const surfaceElevationMetres = new Float32Array(n).fill(elev);
  for (let y = 0; y < H; y++) for (let x = 0; x < oceanCols; x++) { isWaterSurface[y * W + x] = 1; isSea[y * W + x] = 1; }
  return {
    terrainField: { width: W, height: H, isWaterSurface, isSea, surfaceElevationMetres,
      relativeElevationMetres: surfaceElevationMetres, sourceElevationMetres: surfaceElevationMetres, seaLevelMetres: 0 },
    temperatureField: { width: W, height: H, annualMeanTemperatureC: new Float32Array(n).fill(25) },
    humidityField: { width: W, height: H, saturationSpecificHumidityKgPerKg: new Float32Array(n).fill(qsat),
      surfacePressureHPa: new Float32Array(n).fill(1013.25) },
    W, H, n,
  };
}
const uniformWind = (n, u, v) => ({ uWindMs: new Float64Array(n).fill(u), vWindMs: new Float64Array(n).fill(v) });
const run = (w, u, v, extra = {}) => buildMoistureField({
  terrainField: w.terrainField, temperatureField: w.temperatureField, humidityField: w.humidityField,
  wind: { width: w.W, height: w.H, ...uniformWind(w.n, u, v) }, body: EARTH, ...extra,
});

console.log("\n1. Parameter schema");
{
  const { values, unknown } = resolveMoistureParams({ moistureResidenceDays: 5, _note: "ignored", bogus: 1 });
  check("an override is applied", values.moistureResidenceDays === 5);
  check("a leading-underscore note is ignored", !("_note" in values));
  check("an unknown parameter is reported, not thrown", unknown.includes("bogus"));
  check("a missing parameter takes its default", values.surfaceRelativeHumidity === 0.826);
  let threw = false; try { resolveMoistureParams({ moistureResidenceDays: "x" }); } catch { threw = true; }
  check("a non-numeric value throws", threw);
  check("surfaceRelativeHumidity is NOT searchable (it is measured from the teacher)",
    MOISTURE_PARAMETERS.surfaceRelativeHumidity.search === false);
}

console.log("\n2. The water boundary condition");
{
  const w = world();
  const f = run(w, 5, 0);
  const rh = MOISTURE_PARAMETERS.surfaceRelativeHumidity.default;
  let ok = true;
  for (let i = 0; i < w.n; i++) if (f.isSource[i] && Math.abs(f.specificHumidityKgPerKg[i] - rh * 20e-3) > 1e-9) ok = false;
  check(`every water cell is held at RH=${rh} of q_sat`, ok);
  check("water cells report RH equal to that value", Math.abs(f.relativeHumidity[0] - rh) < 1e-6);
}

console.log("\n3. Transport direction follows the wind");
{
  const w = world();
  const east = run(w, 5, 0);   // blowing eastward: moisture goes inland
  const west = run(w, -5, 0);  // blowing westward: moisture leaves the domain
  const probe = 8 * w.W + 10;  // well inland
  check(`eastward wind carries moisture inland (${(east.specificHumidityKgPerKg[probe] * 1000).toFixed(2)} g/kg)`,
    east.specificHumidityKgPerKg[probe] > 1e-4);
  check(`westward wind leaves the interior dry (${(west.specificHumidityKgPerKg[probe] * 1000).toFixed(3)} g/kg)`,
    west.specificHumidityKgPerKg[probe] < east.specificHumidityKgPerKg[probe] / 5);
  check("reversing the wind changes the answer", east.specificHumidityKgPerKg[probe] !== west.specificHumidityKgPerKg[probe]);
}

console.log("\n4. Moisture decreases away from the source");
{
  // Longitude WRAPS, so this cannot be asserted all the way to the last
  // column: past about three quarters of the way round, the cells are
  // approaching the ocean again from behind and q correctly rises. The pole
  // rows are excluded for the same reason in the other direction -- dx
  // shrinks with cos(lat), so the top rows are strongly mixed zonally.
  // Asserting monotonicity across the wrap would have been asserting
  // something a periodic domain forbids.
  const f = run(world(), 5, 0, { params: { moistureResidenceDays: 30 } });
  const W = 32; let monotone = true, ratio = 0;
  for (let y = 4; y < 12; y++) {
    for (let x = 5; x < 20; x++) {
      if (f.specificHumidityKgPerKg[y * W + x + 1] > f.specificHumidityKgPerKg[y * W + x] + 1e-15) monotone = false;
    }
  }
  ratio = f.specificHumidityKgPerKg[8 * W + 5] / f.specificHumidityKgPerKg[8 * W + 19];
  check("q falls monotonically downwind of the coast, away from the wrap", monotone,
    `coast/interior ratio ${ratio.toFixed(2)}`);
  check("  ...and the decay is substantial, not a rounding artefact", ratio > 2);
}

console.log("\n5. A world with no water is dry everywhere");
{
  const w = world({ oceanCols: 0 });
  const f = run(w, 5, 0);
  let maxQ = 0; for (let i = 0; i < w.n; i++) maxQ = Math.max(maxQ, f.specificHumidityKgPerKg[i]);
  check(`no water surface anywhere gives q = 0 (max ${maxQ.toExponential(2)})`, maxQ === 0);
  check("  ...and no condensation is invented", f.condensationKgPerKg.every((v) => v === 0));
}

console.log("\n6. An all-water world sits at the boundary value");
{
  const w = world({ oceanCols: 32 });
  const f = run(w, 5, 0);
  const want = MOISTURE_PARAMETERS.surfaceRelativeHumidity.default * 20e-3;
  check("every cell equals RH0 * q_sat", f.specificHumidityKgPerKg.every((v) => Math.abs(v - want) < 1e-9));
}

console.log("\n7. Relative humidity never exceeds 1");
{
  const w = world();
  const f = run(w, 5, 0, { params: { moistureResidenceDays: 30, eddyDiffusivityM2PerS: 3e6 } });
  let over = 0; for (let i = 0; i < w.n; i++) if (f.relativeHumidity[i] > 1 + 1e-6) over++;
  check(`even at the most generous settings, 0 cells exceed saturation (${over})`, over === 0);
}

console.log("\n8. The saturation cap is the orographic mechanism");
{
  // Same world twice, but the second has a cold, low-capacity ridge inland.
  const flat = world();
  const ridge = world();
  const W = ridge.W;
  for (let y = 0; y < ridge.H; y++) for (let x = 10; x <= 12; x++) {
    ridge.humidityField.saturationSpecificHumidityKgPerKg[y * W + x] = 4e-3; // a mountain's low q_sat
  }
  // A long residence time so that moisture actually reaches the lee in this
  // deliberately coarse synthetic world (32 cells around an Earth-sized
  // planet is 1250 km per cell); otherwise both sides are zero and the
  // comparison would pass without testing anything.
  const opts = { params: { moistureResidenceDays: 30 } };
  const a = run(flat, 5, 0, opts), b = run(ridge, 5, 0, opts);
  const lee = 8 * W + 16;
  check(`the lee of the ridge is drier than the same place without it ` +
    `(${(b.specificHumidityKgPerKg[lee] * 1000).toFixed(2)} vs ${(a.specificHumidityKgPerKg[lee] * 1000).toFixed(2)} g/kg)`,
    b.specificHumidityKgPerKg[lee] < a.specificHumidityKgPerKg[lee]);
  let crestCondensation = 0;
  for (let y = 0; y < ridge.H; y++) for (let x = 10; x <= 12; x++) crestCondensation += b.condensationKgPerKg[y * W + x];
  check(`condensation is recorded on the ridge (${(crestCondensation * 1000).toFixed(2)} g/kg summed)`, crestCondensation > 0);
  check("  ...and it is a diagnostic, never named precipitation",
    b.meta.note.includes("NOT a precipitation rate") && !("precipitation" in b));
}

console.log("\n9. Direction mode ignores wind speed; physical mode does not");
{
  const w = world();
  const slow = run(w, 1, 0), fast = run(w, 20, 0);
  const probe = 8 * w.W + 10;
  check("direction mode gives the same answer for 1 m/s and 20 m/s",
    Math.abs(slow.specificHumidityKgPerKg[probe] - fast.specificHumidityKgPerKg[probe]) < 1e-12);
  check(`  ...because both are normalised to ${REFERENCE_TRANSPORT_SPEED_MS} m/s`,
    slow.meta.referenceTransportSpeedMs === REFERENCE_TRANSPORT_SPEED_MS);
  const pSlow = run(w, 1, 0, { windMode: WIND_MODES.PHYSICAL });
  const pFast = run(w, 20, 0, { windMode: WIND_MODES.PHYSICAL });
  check("physical mode does distinguish them",
    pSlow.specificHumidityKgPerKg[probe] !== pFast.specificHumidityKgPerKg[probe]);
  check("  ...and reports no reference speed", pSlow.meta.referenceTransportSpeedMs === null);
}

console.log("\n10. A calm cell still works");
{
  const f = run(world(), 0, 0);
  check("zero wind produces a finite field (diffusion and the sink still act)",
    f.specificHumidityKgPerKg.every((v) => Number.isFinite(v) && v >= 0));
}

console.log("\n11. Determinism and convergence");
{
  const w = world();
  const a = run(w, 3, 2), b = run(w, 3, 2);
  let same = true; for (let i = 0; i < w.n; i++) if (a.specificHumidityKgPerKg[i] !== b.specificHumidityKgPerKg[i]) same = false;
  check("two runs are bit-identical", same);
  const more = run(w, 3, 2, { maxSweeps: 8000 });
  let maxDiff = 0; for (let i = 0; i < w.n; i++) maxDiff = Math.max(maxDiff, Math.abs(a.specificHumidityKgPerKg[i] - more.specificHumidityKgPerKg[i]));
  check(`quadrupling the sweep cap changes nothing (max ${maxDiff.toExponential(2)} kg/kg)`, maxDiff < 1e-6);
  check("the run reports convergence", a.meta.converged);
}

console.log("\n12. Required inputs throw; a different planet works");
{
  const w = world();
  const bad = (o) => { try { run(w, 5, 0, o); return false; } catch { return true; } };
  check("a missing body throws", (() => { try {
    buildMoistureField({ terrainField: w.terrainField, temperatureField: w.temperatureField,
      humidityField: w.humidityField, wind: { width: w.W, height: w.H, ...uniformWind(w.n, 5, 0) } });
    return false; } catch { return true; } })());
  check("an unknown wind mode throws", bad({ windMode: "sideways" }));
  const mars = buildMoistureField({ terrainField: w.terrainField, temperatureField: w.temperatureField,
    humidityField: w.humidityField, wind: { width: w.W, height: w.H, ...uniformWind(w.n, 5, 0) },
    body: { radiusMetres: 3389500 } });
  check("a Mars-sized planet produces a finite field", mars.specificHumidityKgPerKg.every(Number.isFinite));
  check("  ...and a different answer from Earth's, because the grid is physically smaller",
    mars.specificHumidityKgPerKg[8 * w.W + 10] !== run(w, 5, 0).specificHumidityKgPerKg[8 * w.W + 10]);
}


// --- experimental land evapotranspiration ------------------------------------
{
  const MP = MOISTURE_PARAMETERS, rmp = resolveMoistureParams;
  const w = world();
  const bmf = (extra) => run(w, 6, 0, { windMode: WIND_MODES.PHYSICAL, ...extra });
  check("ET weight defaults to 0 (off)", MP.landEvapotranspirationWeight.default === 0);
  check("ET timescale is marked physical", MP.evapotranspirationTimescaleDays.kind === "physical");
  check("ET ramp centre is marked empirical", MP.evapotranspirationAvailabilityCentre.kind === "empirical");
  check("ET ramp half-width is marked empirical", MP.evapotranspirationAvailabilityHalfWidth.kind === "empirical");
  check("no ET parameter is searchable", [
    "landEvapotranspirationWeight", "evapotranspirationTimescaleDays",
    "evapotranspirationAvailabilityCentre", "evapotranspirationAvailabilityHalfWidth",
  ].every((k) => MP[k].search === false));
  const { values } = rmp({});
  check("ET defaults resolve", values.landEvapotranspirationWeight === 0 && values.evapotranspirationTimescaleDays === 4.6);

  const off = bmf({});
  const offAgain = bmf({ params: { landEvapotranspirationWeight: 0 } });
  let identical = off.specificHumidityKgPerKg.length === offAgain.specificHumidityKgPerKg.length;
  for (let i = 0; identical && i < off.specificHumidityKgPerKg.length; i++) {
    if (off.specificHumidityKgPerKg[i] !== offAgain.specificHumidityKgPerKg[i]) identical = false;
  }
  check("weight 0 is bit-identical to no ET at all", identical);
  check("ET diagnostics are null while off", off.evapotranspirationKgPerKgPerS === null);
  check("meta reports the term off", off.meta.landEvapotranspirationApplied === false);

  const on = bmf({ params: { landEvapotranspirationWeight: 1 } });
  check("ET on reports itself", on.meta.landEvapotranspirationApplied === true);
  check("ET on exposes its own source", on.evapotranspirationKgPerKgPerS instanceof Float32Array);
  check("ET on exposes its availability", on.evapotranspirationAvailability instanceof Float32Array);
  let finite = true, nonNegative = true, withinCap = true;
  for (let i = 0; i < on.specificHumidityKgPerKg.length; i++) {
    const v = on.specificHumidityKgPerKg[i];
    if (!Number.isFinite(v)) finite = false;
    if (v < 0) nonNegative = false;
    if (v > on.saturationSpecificHumidityKgPerKg[i] + 1e-12) withinCap = false;
    const a = on.evapotranspirationAvailability[i];
    if (!(a >= 0 && a <= 1)) finite = false;
  }
  check("ET on produces no NaN or Inf", finite);
  check("ET on keeps q non-negative", nonNegative);
  check("ET on never exceeds saturation", withinCap);
  check("ET on converged", on.meta.converged === true);
  let wetter = 0;
  for (let i = 0; i < on.specificHumidityKgPerKg.length; i++) {
    if (on.specificHumidityKgPerKg[i] > off.specificHumidityKgPerKg[i] + 1e-12) wetter++;
  }
  check("ET on adds moisture somewhere", wetter > 0);
  let ok = true;
  try { bmf({ params: { landEvapotranspirationWeight: 1, evapotranspirationAvailabilityHalfWidth: 0 } }); ok = false; }
  catch { /* expected */ }
  check("a zero-width ramp is rejected rather than dividing by zero", ok);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  " + f)); process.exit(1); }
