// node tools/journey_report.mjs [body] [lng lat] [seeds...]
//
// Runs the viewer's own Great Journey model (anti-kytera/viewer/js/journey.js)
// on a body's stage fields at the journey's default conditions (sea -120 m,
// 8 C), exactly as the phone does, and prints for Earth the first arrival in
// broad comparison regions. The regions are used ONLY here, to evaluate a
// finished run; the model never sees them.
import fs from "node:fs";
import { readPng } from "./png.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const V = ROOT + "anti-kytera/viewer/";
const { polarFootprint } = await import(V + "js/stage-data.js");
const { createResponder, BASE_MEAN_C } = await import(V + "js/stage-respond.js");
const J = await import(process.env.JOURNEY_MODULE || V + "js/journey.js");
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
  ["アフリカ東部", 30, 45, -10, 12], ["アラビア", 40, 58, 13, 30], ["南アジア", 68, 90, 8, 28],
  ["スンダ", 95, 120, -8, 8], ["サフル", 125, 155, -45, 0], ["欧州", -10, 30, 38, 60],
  ["北アジア", 60, 140, 50, 70], ["ベーリンジア", 160, 200, 58, 72], ["北米", -125, -70, 30, 55], ["南米", -80, -35, -40, 5],
];
for (const seed of seeds) {
  t0 = Date.now();
  const jn = J.runJourney(env, start.cell, seed);
  if (process.env.ARROWS) { const by = {}; for (const a of jn.arrows) { by[a.m] = by[a.m] || [0, 0]; by[a.m][0]++; by[a.m][1] = Math.max(by[a.m][1], a.n); } console.log(JSON.stringify(by)); }
  const ms = Date.now() - t0;
  let land = 0, reached = 0, settled = 0;
  for (let k = 0; k < env.W * env.H; k++) if (J.settleable(env, k)) { land++; if (jn.arrival[k] < J.NEVER) reached++; if (jn.settleStart[k] < J.NEVER) settled++; }
  const out = [`seed ${seed}: ${ms} ms, end ${Math.round(jn.endYear)} yr, settleable land reached ${(100 * reached / land).toFixed(1)}%, arrows ${jn.arrows.length}`];
  if (earth) for (const [name, a, b, c, d] of REGIONS) {
    const times = [];
    let n = 0;
    for (let k = 0; k < env.W * env.H; k++) {
      if (!J.settleable(env, k)) continue;
      const p = J.cellCentre(k), L = p.lng < a ? p.lng + 360 : p.lng;
      if (L < a || L > b || p.lat < c || p.lat > d) continue;
      n++; if (jn.arrival[k] < J.NEVER) times.push(jn.arrival[k]);
    }
    times.sort((x, y) => x - y);
    const first = times.length ? Math.round(times[0] / 100) * 100 : null;
    out.push(`  ${name}: ${first == null ? "未到達" : `初到達 ${first} 年`}（定住可能セルの ${n ? (100 * times.length / n).toFixed(0) : "-"}% に到達）`);
  }
  console.log(out.join("\n"));
}

// TRACE=1: print the route (every ~1500 km) to the first cell reached in each region
if (process.env.TRACE && earth) {
  const jn = J.runJourney(env, start.cell, seeds[0]);
  for (const [name, a, b, c, d] of REGIONS) {
    let best = -1;
    for (let k = 0; k < env.W * env.H; k++) {
      if (!J.settleable(env, k) || jn.arrival[k] >= J.NEVER) continue;
      const p = J.cellCentre(k), L = p.lng < a ? p.lng + 360 : p.lng;
      if (L < a || L > b || p.lat < c || p.lat > d) continue;
      if (best < 0 || jn.arrival[k] < jn.arrival[best]) best = k;
    }
    if (best < 0) continue;
    const pts = [];
    for (let k = best, n = 0; k >= 0 && n < 5000; k = jn.parent[k], n++) if (n % 25 === 0 || jn.parent[k] < 0) { const p = J.cellCentre(k); pts.push(`${p.lat.toFixed(0)},${p.lng.toFixed(0)}`); }
    console.log(name, pts.reverse().join(" > "));
  }
}

// ROUTES=n: for seeds 1..n, which way the first cell of each region was reached
// (the route's first point past 25 degrees of latitude from the start region)
if (process.env.ROUTES && earth) {
  const n = Number(process.env.ROUTES), tally = {};
  for (let seed = 1; seed <= n; seed++) {
    const jn = J.runJourney(env, start.cell, seed);
    for (const [name, a, b, c, d] of REGIONS.filter((r) => r[0] === "欧州" || r[0] === "北アジア")) {
      let best = -1;
      for (let k = 0; k < env.W * env.H; k++) {
        if (!J.settleable(env, k) || jn.arrival[k] >= J.NEVER) continue;
        const p = J.cellCentre(k), L = p.lng < a ? p.lng + 360 : p.lng;
        if (L < a || L > b || p.lat < c || p.lat > d) continue;
        if (best < 0 || jn.arrival[k] < jn.arrival[best]) best = k;
      }
      // where the route crossed 28 N (north of the Sahara belt)
      let cross = null;
      for (let k = best; k >= 0; k = jn.parent[k]) { const p = J.cellCentre(k); if (p.lat >= 28) cross = p; else break; }
      const way = !cross ? "?" : cross.lng < -2 ? "大西洋岸→ジブラルタル" : cross.lng < 25 ? "サハラ中央" : "ナイル・紅海→レバント/アラビア";
      tally[`${name}: ${way}`] = (tally[`${name}: ${way}`] || 0) + 1;
    }
  }
  console.log(tally);
}


// CHECK=1: strait checkpoints. For each, the smallest single open-water hop
// (km) with which the model can get from side A to side B inside the box.
// The boxes and points are test inputs only; the model never sees them.
if (process.env.CHECK) {
  const CHECKS = earth ? [
    ["ジブラルタル", [-5.8, 35.3], [-5.8, 36.9], [-8, -3.5, 34.5, 37.8]],
    ["紅海南端（バブ・エル・マンデブ）", [42.8, 12.0], [44.0, 13.4], [41.5, 45.5, 11.0, 14.5]],
    ["スンダ→サフル", [114.5, -8.2], [131.0, -12.5], [113, 150, -16, 4]],
    ["ベーリング陸橋", [-178, 64.5], [-160, 66], [175, 205, 60, 70]],
  ] : [];
  const HOPS = [0, 10, 20, 30, 40, 60, 80, 100, 120, 150, 200, 300];
  const inBox = (k, [a, b, c, d]) => { const p = J.cellCentre(k), L = p.lng < a ? p.lng + 360 : p.lng; return L >= a && L <= b && p.lat >= c && p.lat <= d; };
  for (const [name, A, B, box] of CHECKS) {
    const ka = J.cellOf(A[0], A[1]), kb = J.cellOf(B[0], B[1]);
    let need = null;
    for (const hop of HOPS) {
      // label-correcting search on remaining water budget, land (with land) resets it
      const best = new Float32Array(env.W * env.H).fill(-1), q = [[ka, hop]];
      best[ka] = hop;
      while (q.length) {
        const [k, s] = q.pop();
        for (const [kk, water, blocked] of J.neighbourSteps(env, k)) {
          if (blocked || !inBox(kk, box)) continue;
          let s2 = s - water;
          if (s2 < 0) continue;
          if (env.land[kk]) s2 = hop;
          if (s2 > best[kk]) { best[kk] = s2; q.push([kk, s2]); }
        }
      }
      if (best[kb] >= 0) { need = hop; break; }
    }
    console.log(`  ${name}: 陸A ${env.land[ka] ? "陸" : "海"}・陸B ${env.land[kb] ? "陸" : "海"}、渡るのに要る1回の最大渡海 ${need == null ? "300 km超" : need + " km 以下"}`);
  }
}

// MAPBOX=lng0,lng1,lat0,lat1: print a character map of the cells (. sea, # land, I land ice, ~ permanent sea ice, o settleable)
if (process.env.MAPBOX) {
  const [a, b, c, d] = process.env.MAPBOX.split(",").map(Number);
  for (let lat = d; lat >= c; lat -= 0.5) {
    let row = `${lat.toFixed(1).padStart(6)} `;
    for (let lng = a; lng <= b; lng += 0.5) {
      const k = J.cellOf(((lng + 540) % 360) - 180 + 0.01, lat + 0.01);
      row += !env.land[k] ? (env.permIce[k] ? "~" : ".") : env.ice[k] ? "I" : J.settleable(env, k) ? "o" : "#";
    }
    console.log(row);
  }
}
