// 二集団（試作）: a minimal two-population model -- Homo sapiens and
// Neanderthals -- on the same fixed environment as the Great Journey
// (journey.js's buildEnvironment at the sliders' conditions). No three.js,
// no DOM: the page's worker and node (tools/twopop_report.mjs) run the same
// code. TWOPOP.md explains the model, its hypotheses and its limits.
//
// Each population has its own, independent parameters (TWOPOP_PARAMS):
//   movement     dispersal (km2 per generation) and the longest sea crossing
//   tolerance    a cold-limit shift (deg C) on the shared habitability
//   growth       density at carrying capacity, growth per generation, and an
//                Allee threshold (how hard a thin population is to maintain)
// and the two meet through two independent processes:
//   competition  Lotka-Volterra crowding of each by the other (alpha)
//   hybridisation contact between them makes hybrids, who join the sapiens
//                group and carry half Neanderthal ancestry; the Neanderthal
//                group loses those members (absorption)
// Two statements are NOT built in as facts; each is a switch (HYPOTHESES):
//   weakLanguage  "旧人は言語が弱い": when on, Neanderthals get a lower
//                 carrying capacity and are more crowded by sapiens
//   and "交雑だけで消滅": the "hybrid" condition turns competition off, so
//                 absorption is the only thing that can remove Neanderthals.
// Nothing reads a place name, a longitude or the body: only the grid, the
// environment and each population's parameters. Where each population STARTS
// is input data (twopop/initial_sites_earth.json), kept apart from the rules.
//
// Grid: 1 degree (360 x 180, south-first rows), built from the journey's
// 0.5-degree cells: land area, each population's capacity (people), and
// links between cells -- land steps and sea crossings measured on bedrock
// exactly as the journey measures them. One step = one generation.

import { greatCircleKmExport as gcKm } from "./journey.js";

export const TP_W = 360, TP_H = 180;
export const TWOPOP_PARAMS = {
  generationYears: 25,
  maxYears: 60000,
  frameYears: 500,
  hostileLossPerGen: 0.5,          // share lost per generation where a population cannot live
  sapiens: {
    dispersalKm2: 520,             // per generation; with growth 0.3 a Fisher front of ~25 km/generation (~1 km/yr)
    seaHopKm: 180,                 // longest open-water crossing (the journey's)
    coldShiftC: 0,                 // cold limit as the journey (-12..0 C annual mean)
    densityPerKm2: 0.04,           // at carrying capacity on the best land
    growthPerGen: 0.3,
    allee: 0.05,                   // below ~this share of capacity a group grows slowly (harder to maintain)
    radiusKm: 1500,                // initial area around the listed sites (over land), an assumption
  },
  neanderthal: {
    dispersalKm2: 520,
    seaHopKm: 40,                  // assumption: short crossings only
    coldShiftC: -3,                // assumption: tolerates 3 C colder annual means
    densityPerKm2: 0.04,
    growthPerGen: 0.3,
    allee: 0.05,
    radiusKm: 500,
  },
  competitionOnSapiens: 1.0,       // alpha: how much one Neanderthal crowds sapiens, relative to one sapiens
  competitionOnNeanderthal: 1.0,   // alpha: how much one sapiens crowds Neanderthals
  hybridization: 0.002,            // hybrids per generation per unit of contact (P_S*P_N/(P_S+P_N)); fitted per condition
};
export const HYPOTHESES = {
  weakLanguage: { neanderthalCapacity: 0.7, neanderthalCrowding: 1.4 },   // applied only when switched on
};
export const CONDITIONS = {
  compete: { competition: true, hybrid: false },
  hybrid: { competition: false, hybrid: true },
  both: { competition: true, hybrid: true },
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const D2R = Math.PI / 180;
export const tpCell = (lng, lat) => {
  const j = Math.min(TP_H - 1, Math.max(0, Math.floor(lat + 90)));
  const i = ((Math.floor(lng + 180) % TP_W) + TP_W) % TP_W;
  return j * TP_W + i;
};
export const tpCentre = (c) => ({ lng: -180 + (c % TP_W) + 0.5, lat: -90 + Math.floor(c / TP_W) + 0.5 });

// ------------------------------------------------------------ the 1-degree grid
// env: journey.js buildEnvironment output. Returns land area (km2), each
// population's capacity (people) and the links (cell pairs, water km, length).
export function buildTwoPopGrid(env, params = TWOPOP_PARAMS) {
  const { W, H, R, land, ice, landFrac, T, habitBase, stepLen, stepWater, coastKm } = env;
  const N = W * H, M = TP_W * TP_H;
  const area = new Float64Array(M), capS = new Float64Array(M), capN = new Float64Array(M);
  const cellArea = (j) => R * R * (2 * Math.PI / W) * (Math.sin(((j + 1) / H - 0.5) * Math.PI) - Math.sin((j / H - 0.5) * Math.PI));
  const up = (k) => { const j = Math.floor(k / W), i = k - j * W; return (j >> 1) * TP_W + (i >> 1); };
  const kd = (p, t, b) => Math.min(1, smooth(-12 + p.coldShiftC, p.coldShiftC, t) * b) * p.densityPerKm2;
  for (let k = 0; k < N; k++) {
    if (!land[k]) continue;
    const a = cellArea(Math.floor(k / W)) * landFrac[k], c = up(k);
    area[c] += a;
    if (ice[k]) continue;                                  // ice: land but nobody lives there
    capS[c] += a * kd(params.sapiens, T[k], habitBase[k]);
    capN[c] += a * kd(params.neanderthal, T[k], habitBase[k]);
  }
  // links: the least water between any two 0.5-degree land cells in
  // different 1-degree cells, over one step or a chain of sea cells
  const maxHop = Math.max(params.sapiens.seaHopKm, params.neanderthal.seaHopKm);
  const link = new Map();                                  // key a*M+b (a<b) -> water km
  const note = (ka, kb, water) => {
    const a = up(ka), b = up(kb); if (a === b) return;
    const key = a < b ? a * M + b : b * M + a, old = link.get(key);
    if (old === undefined || water < old) link.set(key, water);
  };
  const FWD = [[0, 1], [1, 1], [1, 0], [1, -1]];
  const FWD_INDEX = new Int8Array(9).fill(-1);             // (dj+1)*3 + di+1 -> forward direction, or -1
  FWD.forEach(([a, b], d) => { FWD_INDEX[(a + 1) * 3 + b + 1] = d; });
  const dist = new Float32Array(N).fill(Infinity), touched = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (!land[k]) continue;
    for (let d = 0; d < 4; d++) {                          // direct land-land steps (their own water measured on bedrock)
      const jj = j + FWD[d][0]; if (jj < 0 || jj >= H) continue;
      const kk = jj * W + (i + FWD[d][1] + W) % W;
      if (land[kk] && stepWater[d * N + k] <= maxHop) note(k, kk, stepWater[d * N + k]);
    }
    // chains of sea cells from this land cell: a small Dijkstra on open
    // water, bounded by the whole length of the sea path (water and sea
    // ice) so a frozen ocean cannot make it search forever
    if (coastKm[k] > maxHop) continue;
    let frontier = [[k, 0, 0]]; touched.length = 0;
    while (frontier.length) {
      let bi = 0; for (let x = 1; x < frontier.length; x++) if (frontier[x][2] < frontier[bi][2]) bi = x;
      const [c, dc, pc] = frontier[bi]; frontier[bi] = frontier[frontier.length - 1]; frontier.pop();
      const cj = Math.floor(c / W), ci = c - cj * W;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!dj && !di) continue;
        const jj = cj + dj; if (jj < 0 || jj >= H) continue;
        const kk = jj * W + (ci + di + W) % W;
        const fd = FWD_INDEX[(dj + 1) * 3 + di + 1], at = fd >= 0 ? c : kk, e = (fd >= 0 ? fd : FWD_INDEX[(1 - dj) * 3 + 1 - di]) * N + at;
        const nd = dc + stepWater[e], np = pc + stepLen[e];
        if (np > maxHop) continue;
        if (land[kk]) { if (c !== k) note(k, kk, nd); continue; }   // landed after sea cells
        if (np < dist[kk]) { if (dist[kk] === Infinity) touched.push(kk); dist[kk] = np; frontier.push([kk, nd, np]); }
      }
    }
    for (const t of touched) dist[t] = Infinity;
  }
  const n = link.size, la = new Int32Array(n), lb = new Int32Array(n), water = new Float32Array(n), len = new Float32Array(n), adj = new Uint8Array(n);
  let q = 0;
  for (const [key, w] of link) {
    const a = Math.floor(key / M), b = key - a * M;
    la[q] = a; lb[q] = b; water[q] = w; len[q] = Math.max(20, gcKm(R, tpCentre(a), tpCentre(b)));
    const ja = Math.floor(a / TP_W), jb = Math.floor(b / TP_W); let di = Math.abs((a % TP_W) - (b % TP_W)); if (di > TP_W / 2) di = TP_W - di;
    adj[q] = Math.abs(ja - jb) <= 1 && di <= 1 ? (ja === jb || di === 0 ? 1 : 2) : 3;   // 1 cardinal, 2 diagonal, 3 farther (sea hop)
    q++;
  }
  // A sea hop between two places that land already joins by a short path
  // (at most 3x the hop, and 600 km) adds nothing but work: drop it.
  const landNbr = new Map();
  for (let x = 0; x < n; x++) if (water[x] === 0 && adj[x] < 3) {
    (landNbr.get(la[x]) || landNbr.set(la[x], []).get(la[x])).push([lb[x], len[x]]);
    (landNbr.get(lb[x]) || landNbr.set(lb[x], []).get(lb[x])).push([la[x], len[x]]);
  }
  const keep = new Uint8Array(n).fill(1), dd = new Map();
  for (let x = 0; x < n; x++) {
    if (adj[x] < 3 && water[x] === 0) continue;
    const bound = Math.min(600, 3 * len[x]), target = lb[x];
    dd.clear(); dd.set(la[x], 0);
    const fr = [[la[x], 0]]; let found = false;
    while (fr.length && !found) {
      let bi = 0; for (let y = 1; y < fr.length; y++) if (fr[y][1] < fr[bi][1]) bi = y;
      const [c, dc] = fr[bi]; fr[bi] = fr[fr.length - 1]; fr.pop();
      if (c === target) { found = true; break; }
      for (const [cc, l] of landNbr.get(c) || []) { const nd = dc + l; if (nd <= bound && nd < (dd.get(cc) ?? Infinity)) { dd.set(cc, nd); fr.push([cc, nd]); } }
    }
    if (found) keep[x] = 0;
  }
  const idx = []; for (let x = 0; x < n; x++) if (keep[x]) idx.push(x);
  const pick = (A, T) => T.from(idx.map((x) => A[x]));
  return { area, capS, capN, la: pick(la, Int32Array), lb: pick(lb, Int32Array), water: pick(water, Float32Array), len: pick(len, Float32Array), adj: pick(adj, Uint8Array), R };
}

// cells reachable over land (water 0 links) within radiusKm of the sites
function seedCells(grid, sites, radiusKm) {
  const { la, lb, water, len } = grid, M = TP_W * TP_H;
  const nbr = new Map();
  for (let q = 0; q < la.length; q++) if (water[q] === 0) {
    (nbr.get(la[q]) || nbr.set(la[q], []).get(la[q])).push([lb[q], len[q]]);
    (nbr.get(lb[q]) || nbr.set(lb[q], []).get(lb[q])).push([la[q], len[q]]);
  }
  const d = new Float64Array(M).fill(Infinity), out = new Uint8Array(M);
  for (const s of sites) {
    const c0 = tpCell(s.lng, s.lat); if (grid.area[c0] <= 0) continue;
    const fr = [[c0, 0]]; d[c0] = 0;
    while (fr.length) {
      fr.sort((a, b) => a[1] - b[1]); const [c, dc] = fr.shift(); out[c] = 1;
      for (const [cc, l] of nbr.get(c) || []) { const nd = dc + l; if (nd <= radiusKm && nd < d[cc]) { d[cc] = nd; fr.push([cc, nd]); } }
    }
  }
  return out;
}

// ------------------------------------------------------------ the run
// opts: { condition: "compete"|"hybrid"|"both", weakLanguage: bool,
//         hybridization (override), sites: initial_sites json,
//         observe(t, state) called every frame (evaluation hooks) }
// Returns frames (Uint8 per 1-degree cell: sapiens and Neanderthal density
// relative to their best-land density, and Neanderthal ancestry in sapiens
// 0-10% -> 0-255), frame times, and totals.
export function runTwoPop(grid, opts, params = TWOPOP_PARAMS) {
  const cond = CONDITIONS[opts.condition] || CONDITIONS.both;
  const M = TP_W * TP_H, { area, la, lb, water, len, adj } = grid;
  const pS = params.sapiens, pN = params.neanderthal;
  const lang = opts.weakLanguage ? HYPOTHESES.weakLanguage : { neanderthalCapacity: 1, neanderthalCrowding: 1 };
  const capS = grid.capS, capN = grid.capN.map((c) => c * lang.neanderthalCapacity);
  const aSN = cond.competition ? params.competitionOnSapiens : 0;
  const aNS = cond.competition ? params.competitionOnNeanderthal * lang.neanderthalCrowding : 0;
  const h = cond.hybrid ? (opts.hybridization ?? params.hybridization) : 0;
  // only cells with land take part
  const cells = []; for (let c = 0; c < M; c++) if (area[c] > 0) cells.push(c);
  // per-population link conductances (people per generation per unit density difference), capped for stability
  function conductance(p) {
    const g = new Float64Array(la.length), sum = new Float64Array(M);
    for (let q = 0; q < la.length; q++) {
      if (water[q] > p.seaHopKm) continue;
      const wt = adj[q] === 1 ? 1 : 0.5;
      g[q] = p.dispersalKm2 * wt / (len[q] * len[q]) * Math.min(area[la[q]], area[lb[q]]);
      sum[la[q]] += g[q] / area[la[q]]; sum[lb[q]] += g[q] / area[lb[q]];
    }
    for (let q = 0; q < la.length; q++) {                   // no cell may send away more than 45% in one generation
      const s = Math.max(sum[la[q]], sum[lb[q]]);
      if (s > 0.45) g[q] *= 0.45 / s;
    }
    return g;
  }
  const gS = conductance(pS), gN = conductance(pN);
  const S = new Float64Array(M), Q = new Float64Array(M), Nn = new Float64Array(M);
  const seedS = seedCells(grid, opts.sites.sapiens.sites, pS.radiusKm), seedN = seedCells(grid, opts.sites.neanderthal.sites, pN.radiusKm);
  for (const c of cells) { if (seedS[c]) S[c] = 0.5 * capS[c]; if (seedN[c]) Nn[c] = 0.5 * capN[c]; }
  const dS = new Float64Array(M), dQ = new Float64Array(M), dN = new Float64Array(M);
  const uS = new Float64Array(M), uQ = new Float64Array(M), uN = new Float64Array(M), invA = new Float64Array(M);
  for (const c of cells) invA[c] = 1 / area[c];
  // links in typed arrays, one pass per population, skipping unusable ones
  const listFor = (g) => { const idx = []; for (let q = 0; q < g.length; q++) if (g[q] > 0) idx.push(q); return Int32Array.from(idx); };
  const qS = listFor(gS), qN = listFor(gN);
  const gen = params.generationYears, steps = Math.round(params.maxYears / gen), every = Math.round(params.frameYears / gen);
  const frames = [], times = [], totals = [];
  const snap = (t) => {
    const f = new Uint8Array(3 * M);
    for (const c of cells) {
      const a = area[c];
      f[c] = Math.min(255, Math.round(S[c] / a / pS.densityPerKm2 * 255));
      f[M + c] = Math.min(255, Math.round(Nn[c] / a / pN.densityPerKm2 * 255));
      f[2 * M + c] = S[c] > 1e-6 ? Math.min(255, Math.round(Q[c] / S[c] * 2550)) : 0;
    }
    frames.push(f); times.push(t);
    let ts = 0, tq = 0, tn = 0; for (const c of cells) { ts += S[c]; tq += Q[c]; tn += Nn[c]; }
    totals.push({ t, sapiens: ts, neanderthal: tn, ancestry: ts > 0 ? tq / ts : 0 });
    opts.observe?.(t, { S, Q, N: Nn, area, cells });
  };
  snap(0);
  const loss = params.hostileLossPerGen, TINY = 1e-3;
  for (let step = 1; step <= steps; step++) {
    // dispersal (density differences across each usable link)
    dS.fill(0); dQ.fill(0); dN.fill(0);
    for (const c of cells) { uS[c] = S[c] * invA[c]; uQ[c] = Q[c] * invA[c]; uN[c] = Nn[c] * invA[c]; }
    for (let x = 0; x < qS.length; x++) {
      const q = qS[x], a = la[q], b = lb[q], d = uS[a] - uS[b];
      if (d === 0 && uS[a] === 0) continue;                 // both empty
      const g = gS[q], f = g * d, fq = g * (uQ[a] - uQ[b]);
      dS[a] -= f; dS[b] += f; dQ[a] -= fq; dQ[b] += fq;
    }
    for (let x = 0; x < qN.length; x++) {
      const q = qN[x], a = la[q], b = lb[q], d = uN[a] - uN[b];
      if (d === 0 && uN[a] === 0) continue;
      const f = gN[q] * d; dN[a] -= f; dN[b] += f;
    }
    for (const c of cells) {
      let s = Math.max(0, S[c] + dS[c]), qq = Math.max(0, Q[c] + dQ[c]), n = Math.max(0, Nn[c] + dN[c]);
      // growth, crowding and loss where they cannot live
      const s0 = s;
      if (capS[c] > 1e-9) { const f = s / (s + pS.allee * capS[c] + 1e-12); s += pS.growthPerGen * s * f * (1 - (s + aSN * n) / capS[c]); }
      else s *= 1 - loss;
      if (capN[c] > 1e-9) { const f = n / (n + pN.allee * capN[c] + 1e-12); n += pN.growthPerGen * n * f * (1 - (n + aNS * s0) / capN[c]); }
      else n *= 1 - loss;
      s = Math.max(0, s); n = Math.max(0, n);
      qq = s0 > 0 ? qq * s / s0 : 0;                        // births and deaths carry the parents' ancestry
      // hybridisation: hybrids join the sapiens group with half Neanderthal ancestry
      if (h > 0 && s > 0 && n > 0) { const hy = Math.min(n, h * s * n / (s + n)); n -= hy; s += hy; qq += 0.5 * hy; }
      if (s < TINY) { s = 0; qq = 0; } if (n < TINY) n = 0;
      S[c] = s; Q[c] = Math.min(qq, s); Nn[c] = n;
    }
    if (step % every === 0) snap(step * gen);
  }
  return { frames, times, totals, M, hybridization: h, condition: opts.condition, weakLanguage: !!opts.weakLanguage };
}
