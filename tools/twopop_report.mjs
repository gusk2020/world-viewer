// node tools/twopop_report.mjs [condition ...]   (compete | hybrid | both; default all three)
//
// Runs the two-population prototype (anti-kytera/viewer/js/twopop.js) on
// Earth's stage fields at fixed conditions (SEA, TEMP; default -80 m, 10 C),
// with and without the weak-language hypothesis, and prints each run's
// measures against twopop/observations.json. FIT=1 calibrates each
// condition's hybridisation rate to the one "fit" observation (F1) and
// writes twopop/fitted.json; the "independent" observations are only checked.
import fs from "node:fs";
import { readPng } from "./png.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const V = ROOT + "anti-kytera/viewer/";
const { polarFootprint } = await import(V + "js/stage-data.js");
const { createResponder, BASE_MEAN_C } = await import(V + "js/stage-respond.js");
const J = await import(process.env.JOURNEY_MODULE || V + "js/journey.js");
globalThis.performance ??= { now: () => Date.now() };

const body = "earth";
const CONDS = process.argv.slice(2).length ? process.argv.slice(2) : ["compete", "hybrid", "both"];
const SEA = Number(process.env.SEA ?? -80), TEMP = Number(process.env.TEMP ?? 10);

const earth = body === "earth";
const base = earth ? ROOT + "anti-kytera/" : `${V}worlds/${body}/stages/`;
const read = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const S = JSON.parse(fs.readFileSync(earth ? base + "results/display.json" : base + "display.json"));
const Vd = JSON.parse(fs.readFileSync(earth ? base + "veg/results/veg_display.json" : base + "veg_display.json"));
const sab = read(earth ? base + "results/fields.bin" : base + "fields.bin"), vab = read(earth ? base + "veg/results/veg_fields.bin" : base + "veg_fields.bin");
const F = {}, D = {};
for (const [meta, buf, keys] of [[S, sab, Object.keys(S.fields)], [Vd, vab, ["veg_fit", "veg_teacher"]]])
  for (const k of keys) { const f = meta.fields[k]; F[k] = new ({ i16: Int16Array, u8: Uint8Array, f32: Float32Array }[f.dtype])(buf, f.offset, f.w * f.h); F[k].meta = f; }
for (const k of Object.keys(S.fields)) { const m = F[k].meta; D[k] = polarFootprint(F[k], m.w, m.h); D[k].meta = m; }
const config = JSON.parse(fs.readFileSync(`${V}worlds/${earth ? "kasoku-sekai" : body}/config.json`));
const r = JSON.parse(fs.readFileSync(V + "rules/response_rules.json"));
const rules = { ...r, vegClass: r.vegClass.flat(), vegShare: r.vegShare.flat(2) };
const radius = S.bodyRadiusMetres || 6.371e6;
const resp = createResponder({ F, D }, rules, radius, config.body.axialTiltDegrees ?? 23.44);
const step = SEA < 0 ? config.display.seaLevel.downStepMetres : config.display.seaLevel.upStepMetres;
const sea = Math.round(SEA / step) * step;
resp.update(sea, TEMP - BASE_MEAN_C);

// the terrain that decides land and water: the body's declared bedrock
// (Earth: sub-ice), else the display level the globe loads (2048 wide).
// FINE=display forces the display terrain (how PR #23 did it).
const level = config.terrain.journeyBedrock && process.env.FINE !== "display" ? config.terrain.journeyBedrock
  : config.terrain.levels.filter((l) => l.width <= 2048).reduce((a, b) => (b.width > a.width ? b : a));
const png = readPng(new URL(level.url, "file://" + V).pathname);
const metres = new Float32Array(png.width * png.height), off = config.terrain.encoding.offsetMetres;
for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * png.channels] * 256 + png.data[i * png.channels + 1] - off;

const params = process.env.PARAMS ? { ...J.JOURNEY_PARAMS, ...JSON.parse(process.env.PARAMS) } : J.JOURNEY_PARAMS;
const TP = await import(V + "js/twopop.js"), EV = await import(V + "js/twopop-eval.js");
let t0 = Date.now();
const env = J.buildEnvironment({ fields: F, radiusMetres: radius, seaLevel: sea, fine: { width: png.width, height: png.height, metres }, params });
const tEnv = Date.now() - t0; t0 = Date.now();
// TP='{"neanderthal":{"coldShiftC":0}}': override the prototype's own parameters (sensitivity runs)
const over = process.env.TP ? JSON.parse(process.env.TP) : {};
const tpParams = { ...TP.TWOPOP_PARAMS, ...over, sapiens: { ...TP.TWOPOP_PARAMS.sapiens, ...over.sapiens }, neanderthal: { ...TP.TWOPOP_PARAMS.neanderthal, ...over.neanderthal } };
const grid = TP.buildTwoPopGrid(env, tpParams);
console.log(`earth sea ${sea} m, ${TEMP} C: environment ${tEnv} ms, 1-degree grid ${Date.now() - t0} ms, ${grid.la.length} links`);
const sites = JSON.parse(fs.readFileSync(V + "twopop/initial_sites_earth.json"));
const obs = JSON.parse(fs.readFileSync(V + "twopop/observations.json"));
const fittedPath = V + "twopop/fitted.json", fittedOut = process.env.FITTED_OUT || fittedPath;   // FITTED_OUT: write a sensitivity fit elsewhere
const fitted = fs.existsSync(fittedPath) ? JSON.parse(fs.readFileSync(fittedPath)) : {};
const pct = (x) => (isFinite(x) ? (100 * x).toFixed(2) + "%" : String(x));
function run(condition, weakLanguage, h) {
  const ev = EV.makeEvaluator(obs), t = Date.now();
  const r = TP.runTwoPop(grid, { condition, weakLanguage, hybridization: h, sites, observe: ev.observe }, tpParams);
  return { r, ms: Date.now() - t, ev: ev.summary() };
}
// F1 calibration: the hybridisation rate that gives the fit target (log bisection)
function fit(condition, weakLanguage) {
  if (!TP.CONDITIONS[condition].hybrid) return { h: 0, note: "交雑なし（合わせる量がない）" };
  const target = obs.fit[0].target;
  let lo = Math.log(1e-6), hi = Math.log(0.5), best = null;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2, x = run(condition, weakLanguage, Math.exp(mid)).ev.measures.nonAfricanAncestryEnd;
    best = { h: Math.exp(mid), value: x };
    if (!isFinite(x) || x < target) lo = mid; else hi = mid;
  }
  return best;
}
const out = {};
for (const condition of CONDS) for (const weakLanguage of [false, true]) {
  const key = `${condition}${weakLanguage ? "+weakLanguage" : ""}`;
  let h = fitted[key]?.h;
  if (process.env.FIT) { const f = fit(condition, weakLanguage); h = f.h; out[key] = f; }
  const { r, ms, ev } = run(condition, weakLanguage, h);
  const m = ev.measures;
  console.log(`\n== ${key}  h=${r.hybridization ? r.hybridization.toExponential(2) : 0}  run ${ms} ms, ${r.frames.length} frames`);
  console.log(`   non-African ${pct(m.nonAfricanAncestryEnd)} | Neanderthals left ${pct(m.neanderthalShareEnd)} (gone at ${m.neanderthalGoneYear ?? "-"} yr) | Europe overlap ${m.europeOverlapYears} yr | sub-Saharan ${pct(m.subSaharanAncestryEnd)} | region ratio ${isFinite(m.nonAfricanRegionRatio) ? m.nonAfricanRegionRatio.toFixed(2) : m.nonAfricanRegionRatio} | early/end Europe ${isFinite(m.europeEarlyToEndRatio) ? m.europeEarlyToEndRatio.toFixed(2) : m.europeEarlyToEndRatio}`);
  console.log("   regions " + Object.entries(m.regionAncestry).map(([k, v]) => `${k} ${pct(v)}`).join(", "));
  console.log("   " + ev.checks.map((c) => `${c.id}${c.kind === "fit" ? "(合わせ込み)" : ""}:${c.pass == null ? "–" : c.pass ? "○" : "×"}`).join(" "));
  const tot = ev.series.filter((_, i) => i % 20 === 0).map((s) => `${s.t / 1000}k:S${(s.S / 1e3).toFixed(0)}k/N${(s.N / 1e3).toFixed(1)}k/${pct(s.anc)}`).join(" ");
  console.log("   " + tot);
}
if (process.env.FIT) {
  fs.writeFileSync(fittedOut, JSON.stringify({ _what: "各条件の交雑率（1世代あたり、接触量あたり）。F1（非アフリカ集団 約2.2%）に合わせた値。tools/twopop_report.mjs を FIT=1 で実行すると作り直す。", conditions: { sea: SEA, tempC: TEMP }, ...out }, null, 1));
  console.log("wrote", fittedOut);
}
