// node tools/journey_arrows_report.mjs [body] [lng lat] [seeds...]
//
// The arrows the phone draws for a journey (anti-kytera/viewer/js/journey-arrows.js):
// how many are recorded and how many are shown after merging, and whether
// the merge loses anything -- every recorded arrow must keep a shown arrow of
// its own era close by and pointing the same way, and every broad region the
// journey reaches (Earth; evaluation only, the model never sees them) must
// still have a shown arrow starting in it from its first-arrival era.
// Environment as tools/journey_report.mjs (SEA, TEMP, PARAMS). RADIUS/TURN
// override the merge limits for a sweep.
import fs from "node:fs";
import { readPng } from "./png.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const V = ROOT + "anti-kytera/viewer/";
const { polarFootprint } = await import(V + "js/stage-data.js");
const { createResponder, BASE_MEAN_C } = await import(V + "js/stage-respond.js");
const J = await import(process.env.JOURNEY_MODULE || V + "js/journey.js");
const A = await import(V + "js/journey-arrows.js");
globalThis.performance ??= { now: () => Date.now() };

const body = process.argv[2] || "earth";
const lng = Number(process.argv[3] ?? -5), lat = Number(process.argv[4] ?? 12);
const seeds = process.argv.slice(5).map(Number);
if (!seeds.length) seeds.push(123456);
const SEA = Number(process.env.SEA ?? -120), TEMP = Number(process.env.TEMP ?? 8);

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

let t0 = Date.now();
// PARAMS='{"seaBudgetKm":150}': override model constants for a comparison run
const params = process.env.PARAMS ? { ...J.JOURNEY_PARAMS, ...JSON.parse(process.env.PARAMS) } : J.JOURNEY_PARAMS;
const env = J.buildEnvironment({ fields: F, radiusMetres: radius, seaLevel: sea, fine: { width: png.width, height: png.height, metres }, params });
console.log(`${body} sea ${sea} m, ${TEMP} C: environment ${Date.now() - t0} ms; settleable land cells ${env.land.reduce((n, x, k) => n + (J.settleable(env, k) ? 1 : 0), 0)}`);
const start = J.resolveStart(env, lng, lat);
console.log("start", JSON.stringify(start));
if (start.cell < 0) process.exit(0);

const REGIONS = [   // evaluation only: [name, lngMin, lngMax, latMin, latMax]
  ["アラビア", 40, 58, 13, 30], ["南アジア", 68, 90, 8, 28], ["スンダ", 95, 120, -8, 8], ["サフル", 125, 155, -45, 0],
  ["欧州", -10, 30, 38, 60], ["北アジア", 60, 140, 50, 70], ["ベーリンジア", 160, 200, 58, 72], ["北米", -125, -70, 30, 55], ["南米", -80, -35, -40, 5],
  ["日本列島", 129, 146, 30, 46], ["マダガスカル", 43, 51, -26, -12], ["ブリテン", -6, 2, 50, 59],
];
const inBox = (lng, lat, [a, b, c, d], pad = 0) => { const L = lng < a - pad ? lng + 360 : lng; return L >= a - pad && L <= b + pad && lat >= c - pad && lat <= d + pad; };
const R = Number(process.env.RADIUS ?? A.MERGE_RADIUS_DEG), TURN = Number(process.env.TURN ?? A.MERGE_MAX_TURN_DEG);
const D2R = Math.PI / 180, unit = (lng, lat) => [Math.cos(lat * D2R) * Math.cos(lng * D2R), Math.sin(lat * D2R), Math.cos(lat * D2R) * Math.sin(lng * D2R)];
const ang = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) / D2R;
// direction as a 3D tangent at the arrow's start (the same measure the merge uses)
const tangent = (a) => { const la = a.lat * D2R, lo = a.lng * D2R; const e = [-Math.sin(lo), 0, Math.cos(lo)], n = [-Math.sin(la) * Math.cos(lo), Math.cos(la), -Math.sin(la) * Math.sin(lo)]; return [0, 1, 2].map((i) => a.east * e[i] + a.north * n[i]); };
for (const seed of seeds) {
  const jn = J.runJourney(env, start.cell, seed);
  const list = A.eras(jn.endYear), era = (m) => Math.min(list.length - 1, Math.floor((m * J.ARROW_YEARS + J.ARROW_YEARS / 2) / list[0].to));
  const t0 = performance.now();
  const KEEP = Number(process.env.KEEP ?? A.KEEP_CROSSING_SHARE);
  const shown = (process.env.RADIUS || process.env.TURN || process.env.KEEP) ? A.mergeArrows(jn.arrows, list, R, TURN, KEEP) : A.journeyArrows(jn);
  const ms = performance.now() - t0;
  // every recorded arrow: nearest shown arrow of the same era, and how far it points away
  let worstD = 0, worstT = 0, uncovered = 0;
  for (const a of jn.arrows) {
    const u = unit(a.lng, a.lat); let best = null;
    for (const s of shown) {
      if (era(s.m) !== era(a.m)) continue;
      const d = ang(u, unit(s.lng, s.lat)), t = ang(tangent(a), tangent(s));
      if (d <= R + 0.05 && t <= TURN + 3 && (!best || d < best.d)) best = { d, t };
    }
    if (!best) uncovered++; else { worstD = Math.max(worstD, best.d); worstT = Math.max(worstT, best.t); }
  }
  // arrows that include landings across water: a shown arrow of the same era within 1.5 deg?
  let crossN = 0, crossNear = 0;
  for (const a of jn.arrows) {
    if (!(a.water > 0)) continue; crossN++;
    const u = unit(a.lng, a.lat);
    if (shown.some((s) => era(s.m) === era(a.m) && ang(u, unit(s.lng, s.lat)) <= 1.5)) crossNear++;
  }
  const out = [`seed ${seed}: recorded ${jn.arrows.length}, shown ${shown.length} (${(100 * shown.length / jn.arrows.length).toFixed(0)}%), merge ${ms.toFixed(0)} ms; ` +
    `recorded arrows without a shown arrow of their era nearby: ${uncovered}; farthest ${worstD.toFixed(1)} deg, most turned ${worstT.toFixed(0)} deg; arrows with sea landings ${crossN}, of which a shown arrow within 1.5 deg: ${crossNear}`];
  if (earth) {
    const miss = [];
    for (const [name, a, b, c, d] of REGIONS) {
      let first = Infinity;
      for (let k = 0; k < env.W * env.H; k++) { if (!env.land[k] || jn.arrival[k] >= J.NEVER) continue; const p = J.cellCentre(k); if (inBox(p.lng, p.lat, [a, b, c, d])) first = Math.min(first, jn.arrival[k]); }
      if (!isFinite(first)) { miss.push(`${name}:未到達`); continue; }
      const e = era(Math.floor(first / J.ARROW_YEARS));
      const recHas = jn.arrows.some((x) => era(x.m) === e && inBox(x.lng, x.lat, [a, b, c, d], 3));
      const showHas = shown.some((x) => era(x.m) === e && inBox(x.lng, x.lat, [a, b, c, d], 3));
      miss.push(`${name}:${recHas ? (showHas ? "○" : "×消えた") : "（記録にもなし）"}`);
    }
    out.push("  初到達の時代の矢印（領域±3°）: " + miss.join(" "));
  }
  console.log(out.join("\n"));
}
