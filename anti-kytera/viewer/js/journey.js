// Great Journey (グレートジャーニー) mode, first version: a stochastic
// least-time spread of a foraging people over one body's fixed environment.
// No three.js, no DOM -- the same code runs in the browser and in node
// (tools/journey_report.mjs), so the reported runs are the runs the phone
// draws. JOURNEY.md explains the model, the sources and the assumptions.
//
// Inputs are the stage fields at the chosen conditions (stage-respond.js
// output): bedrock 0.25 deg, temperature/precipitation/humidity 2 deg, land
// ice / vegetation / sea ice 0.5 deg, plus the finer display terrain to keep
// islands and straits the 0.5-deg grid would lose. Nothing reads a place
// name, a longitude or which body this is; the only body fact used is its
// radius, so distances are real kilometres on that body.
//
// Output, per 0.5-deg cell: first arrival (years from departure), settlement
// start and settlement end (end is always Infinity in this version -- the
// slot exists so abandonment can be added without changing the format), and
// the parent it was reached from, aggregated into ~1000-year direction arrows.

export const GRID_W = 720, GRID_H = 360;          // 0.5 deg, south-first rows
export const NEVER = 1e9;                          // "not reached" in the float arrays
export const ARROW_YEARS = 1000;                   // one arrow set per this many years
export const ARROW_BIN_DEG = 6;                    // arrows aggregate moves over 6 x 6 deg bins

// Model constants (JOURNEY.md, "独自の仮定"). Constant ability: no learning,
// no cold or sea adaptation in this version.
export const JOURNEY_PARAMS = {
  speedKmPerYear: 0.9,         // walking front speed on good ground (Fisher-Skellam style wave, 0.4-1 km/yr range)
  coastSpeedBoost: 0.6,        // up to +60% within ~60 km of the sea (coastal corridors)
  roughnessM: 400,             // speed halves at this relief std (m) within a cell
  settleHabitability: 0.3,     // a cell can be settled at or above this
  hardshipBudgetKm: 700,       // km of fully hostile land a party can cross between habitable cells
  seaBudgetKm: 120,            // longest open-water hop between land cells (short crossings only)
  permanentSeaIce: 0.97,       // sea-ice share of the year at or above which it is walkable all year
  settleDelayYears: 150,       // median time from first arrival to settlement
  randomSpread: 0.5,           // sigma of the lognormal factor on each step's travel time
  maxYears: 200000,
};

// Productivity of each vegetation class for foragers (0-1): a judgement from
// the ethnographic record's broad pattern (open, game-rich grassland and
// mosaics high; closed rainforest and boreal forest lower; desert and polar
// barrens lowest). Codes are the R&F classes + 10 used by the stages.
const VEG_PRODUCTIVITY = {
  11: 0.75, 12: 0.85, 13: 0.8, 14: 0.6, 15: 0.8, 16: 0.45, 17: 0.45, 18: 0.7,
  19: 1.0, 20: 0.9, 21: 0.7, 22: 0.5, 23: 0.35, 24: 0.08, 25: 0.03,
};
const ICE_MIN_M = 10;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rowLat = (j, h) => ((j + 0.5) / h - 0.5) * Math.PI;

// ------------------------------------------------------------ environment
// fields: { bed, T_fit, P_fit, E_fit, H_fit, veg_fit, seaice } (meta on each),
// fine: optional { width, height, metres } north-first display terrain.
export function buildEnvironment({ fields: F, radiusMetres, seaLevel, fine = null, params = JOURNEY_PARAMS }) {
  const W = GRID_W, H = GRID_H, N = W * H, R = radiusMetres / 1000;
  const bed = F.bed, BW = bed.meta.w, fb = BW / W;             // 2 bedrock cells per grid cell
  const T2 = F.T_fit, W2 = T2.meta.w, H2 = T2.meta.h;
  const up = (a, j, i) => {                                     // 2-deg -> 0.5-deg, bilinear on centres
    const fy = (j + 0.5) / H * H2 - 0.5, fx = (i + 0.5) / W * W2 - 0.5;
    const y0 = Math.max(0, Math.min(H2 - 1, Math.floor(fy))), y1 = Math.min(H2 - 1, y0 + 1), wy = Math.max(0, Math.min(1, fy - y0));
    let x0 = Math.floor(fx); const wx = fx - x0; x0 = (x0 + W2) % W2; const x1 = (x0 + 1) % W2;
    return (a[y0 * W2 + x0] * (1 - wx) + a[y0 * W2 + x1] * wx) * (1 - wy) + (a[y1 * W2 + x0] * (1 - wx) + a[y1 * W2 + x1] * wx) * wy;
  };
  const land = new Uint8Array(N), ice = new Uint8Array(N), permIce = new Uint8Array(N);
  const zMean = new Float32Array(N), rough = new Float32Array(N);
  const habit = new Float32Array(N), speed = new Float32Array(N), coastKm = new Float32Array(N);
  const T = new Float32Array(N), P = new Float32Array(N);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    let n = 0, s = 0, s2 = 0, sl = 0;
    for (let b = 0; b < fb; b++) for (let a = 0; a < fb; a++) {
      const z = bed[(j * fb + b) * BW + i * fb + a];
      s += z; s2 += z * z; if (z >= seaLevel) { n++; sl += z; }
    }
    const m = fb * fb;
    zMean[k] = n ? sl / n : s / m;
    rough[k] = Math.sqrt(Math.max(0, s2 / m - (s / m) ** 2));
    land[k] = n > 0 ? 1 : 0;
    ice[k] = F.H_fit[k] > ICE_MIN_M ? 1 : 0;
    T[k] = up(T2, j, i); P[k] = up(F.P_fit, j, i);
  }
  // Islands and straits finer than 0.25 deg: any display-terrain pixel above
  // the sea inside the cell keeps it land (an island to land on).
  if (fine) {
    const { width: fw, height: fh, metres } = fine;
    for (let y = 0; y < fh; y++) {
      const j = Math.min(H - 1, Math.floor((1 - (y + 0.5) / fh) * H));   // fine grid is north-first
      for (let x = 0; x < fw; x++) {
        if (metres[y * fw + x] < seaLevel) continue;
        const k = j * W + Math.min(W - 1, Math.floor((x + 0.5) / fw * W));
        if (!land[k]) { land[k] = 1; zMean[k] = Math.max(seaLevel, 0); }
      }
    }
  }
  for (let k = 0; k < N; k++) if (!land[k] && F.seaice[k] >= params.permanentSeaIce) permIce[k] = 1;
  // relief between neighbouring cells also counts as rough ground
  const rough2 = new Float32Array(N);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i; if (!land[k]) continue;
    let d = 0, c = 0;
    for (const [dj, di] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const jj = j + dj; if (jj < 0 || jj >= H) continue;
      const kk = jj * W + (i + di + W) % W; if (!land[kk]) continue;
      d += Math.abs(zMean[kk] - zMean[k]); c++;
    }
    rough2[k] = Math.hypot(rough[k], c ? d / c / 2 : 0);
  }
  // km to the nearest sea cell over land (two-pass chamfer, longitude wraps)
  const dy = Math.PI * R / H, dxRow = new Float64Array(H);
  for (let j = 0; j < H; j++) dxRow[j] = Math.max(Math.cos(rowLat(j, H)), 0.01) * 2 * Math.PI * R / W;
  for (let k = 0; k < N; k++) coastKm[k] = land[k] ? 1e7 : 0;
  const relax = (k, jj, ii, w) => { if (jj < 0 || jj >= H) return; const o = coastKm[jj * W + ((ii + W) % W)] + w; if (o < coastKm[k]) coastKm[k] = o; };
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i, dg = Math.hypot(dxRow[j], dy); relax(k, j, i - 1, dxRow[j]); relax(k, j - 1, i, dy); relax(k, j - 1, i - 1, dg); relax(k, j - 1, i + 1, dg); }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) { const k = j * W + i, dg = Math.hypot(dxRow[j], dy); relax(k, j, i + 1, dxRow[j]); relax(k, j + 1, i, dy); relax(k, j + 1, i + 1, dg); relax(k, j + 1, i - 1, dg); }
  }
  // habitability and walking speed
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (!land[k]) { speed[k] = params.speedKmPerYear * (1 + params.coastSpeedBoost); continue; }
    if (ice[k]) continue;                                           // land ice: neither habitable nor passable
    const veg = VEG_PRODUCTIVITY[F.veg_fit[k]] ?? 0.4;
    const thermal = smooth(-12, 0, T[k]);                           // cold limit without cold adaptation
    const arid = smooth(80, 350, P[k]);                             // water
    const humid = 0.7 + 0.3 * smooth(3, 10, F.E_fit ? up(F.E_fit, j, i) : 10);
    const alt = 1 - smooth(2500, 4500, zMean[k]);                   // high plateaus
    const coast = Math.exp(-coastKm[k] / 80);                       // coastal and marine foods
    habit[k] = Math.min(1, Math.max(0, veg * (0.5 + 0.5 * arid) * thermal * alt * humid + 0.25 * coast * thermal * alt));
    speed[k] = params.speedKmPerYear * (0.4 + 0.6 * habit[k]) / (1 + rough2[k] / params.roughnessM)
      * (1 + params.coastSpeedBoost * Math.exp(-coastKm[k] / 60));
  }
  // size (cells) of each connected patch of settleable land, so a start is
  // never moved onto a speck from which nobody could go anywhere
  const patch = new Int32Array(N);
  const ok = (k) => land[k] && !ice[k] && habit[k] >= params.settleHabitability;
  const stack = new Int32Array(N), members = new Int32Array(N);
  for (let k0 = 0; k0 < N; k0++) {
    if (patch[k0] || !ok(k0)) continue;
    let sp = 0, n = 0; stack[sp++] = k0; patch[k0] = -1;
    while (sp) {
      const k = stack[--sp]; members[n++] = k;
      const j = Math.floor(k / W), i = k - j * W;
      for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= H) continue;
        for (let di = -1; di <= 1; di++) { const kk = jj * W + (i + di + W) % W; if (!patch[kk] && ok(kk)) { patch[kk] = -1; stack[sp++] = kk; } } }
    }
    for (let m = 0; m < n; m++) patch[members[m]] = n;
  }
  return { W, H, R, seaLevel, land, ice, permIce, habit, speed, coastKm, T, P, zMean, rough: rough2, dxRow, dy, patch, params };
}

export const cellOf = (lng, lat) => {
  const j = Math.min(GRID_H - 1, Math.max(0, Math.floor((lat + 90) / 180 * GRID_H)));
  const i = ((Math.floor((lng + 180) / 360 * GRID_W) % GRID_W) + GRID_W) % GRID_W;
  return j * GRID_W + i;
};
export const cellCentre = (k) => ({ lng: -180 + ((k % GRID_W) + 0.5) * 360 / GRID_W, lat: -90 + (Math.floor(k / GRID_W) + 0.5) * 180 / GRID_H });
export const settleable = (env, k) => env.land[k] && !env.ice[k] && env.habit[k] >= env.params.settleHabitability;

function greatCircleKm(R, a, b) {
  const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180, dl = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const DIRS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
function bearingWord(a, b) {
  const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180, dl = (b.lng - a.lng) * Math.PI / 180;
  const brg = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  return DIRS[((Math.round(brg / (Math.PI / 4)) % 8) + 8) % 8];
}

// The start: the tapped point if it can be settled, else the nearest cell
// that can (reported with its distance and direction), else null.
// A start needs a patch of settleable land of at least this share of all of
// it (and 30 cells), so it is never moved onto a speck nobody can leave.
export const MIN_START_PATCH_SHARE = 0.02;
export function resolveStart(env, lng, lat, maxKm = 2500) {
  const k0 = cellOf(lng, lat);
  let total = 0;
  for (let k = 0; k < env.W * env.H; k++) if (settleable(env, k)) total++;
  const minPatch = Math.max(30, MIN_START_PATCH_SHARE * total);
  const usable = (k) => settleable(env, k) && env.patch[k] >= minPatch;
  if (usable(k0)) return { cell: k0, ...cellCentre(k0), movedKm: 0, reason: null };
  const reason = !env.land[k0] ? (env.permIce[k0] ? "通年の海氷" : "海") : env.ice[k0] ? "陸氷"
    : settleable(env, k0) ? "小さな島・孤立した土地" : "定住に向かない土地";
  const at = { lng, lat };
  let best = -1, bestKm = Infinity;
  for (let k = 0; k < env.W * env.H; k++) {
    if (!usable(k)) continue;
    const d = greatCircleKm(env.R, at, cellCentre(k));
    if (d < bestKm) { bestKm = d; best = k; }
  }
  if (best < 0 || bestKm > maxKm) return { cell: -1, reason, movedKm: null };
  const c = cellCentre(best);
  return { cell: best, ...c, movedKm: bestKm, direction: bearingWord(at, c), reason };
}

// ------------------------------------------------------------ randomness
// mulberry32: a small, well-known 32-bit generator; the same seed gives the
// same journey on every run of the same browser.
export function makeRandom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    const u = Math.max(next(), 1e-12), v = next(), r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { next, normal };
}
export const newSeed = () => (Math.floor(Math.random() * 900000) + 100000);

// ------------------------------------------------------------ the journey
// A stochastic least-time spread (first-passage percolation): every step to
// a neighbouring cell takes distance / speed, times a lognormal factor from
// the seeded generator. Walking resets its hardship and sea budgets in any
// habitable cell; hostile land spends the hardship budget, open water the
// sea budget, and permanent sea ice the hardship budget. Land ice is closed.
export function runJourney(env, startCell, seed) {
  const { W, H, R, land, ice, permIce, habit, speed, dxRow, dy, params } = env;
  const N = W * H, rnd = makeRandom(seed);
  const Hs = params.settleHabitability, Bh = params.hardshipBudgetKm, Bs = params.seaBudgetKm;
  const best = new Float64Array(N).fill(NEVER);                  // float64 while searching (float32 rounding would lose pops)
  const arrival = new Float32Array(N).fill(NEVER), settleStart = new Float32Array(N).fill(NEVER);
  const settleEnd = new Float32Array(N).fill(NEVER);          // abandonment: reserved, never set yet
  const parent = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const procH = new Float32Array(N).fill(-1), procS = new Float32Array(N).fill(-1);
  const relabels = new Uint8Array(N);
  // binary heap of labels (time, cell, hardship left, sea left)
  let cap = 1 << 16, size = 0;
  let hT = new Float64Array(cap), hC = new Int32Array(cap), hH = new Float32Array(cap), hS = new Float32Array(cap), hP = new Int32Array(cap);
  function push(t, c, h, s, p) {
    if (size === cap) {
      cap *= 2;
      const g = (A, B) => { const n = new B(cap); n.set(A); return n; };
      hT = g(hT, Float64Array); hC = g(hC, Int32Array); hH = g(hH, Float32Array); hS = g(hS, Float32Array); hP = g(hP, Int32Array);
    }
    let i = size++;
    while (i > 0) {
      const q = (i - 1) >> 1; if (hT[q] <= t) break;
      hT[i] = hT[q]; hC[i] = hC[q]; hH[i] = hH[q]; hS[i] = hS[q]; hP[i] = hP[q]; i = q;
    }
    hT[i] = t; hC[i] = c; hH[i] = h; hS[i] = s; hP[i] = p;
  }
  const top = { t: 0, c: 0, h: 0, s: 0, p: 0 };
  function pop() {
    top.t = hT[0]; top.c = hC[0]; top.h = hH[0]; top.s = hS[0]; top.p = hP[0];
    const t = hT[--size], c = hC[size], h = hH[size], s = hS[size], p = hP[size];
    let i = 0;
    for (;;) {
      let m = 2 * i + 1; if (m >= size) break;
      if (m + 1 < size && hT[m + 1] < hT[m]) m++;
      if (hT[m] >= t) break;
      hT[i] = hT[m]; hC[i] = hC[m]; hH[i] = hH[m]; hS[i] = hS[m]; hP[i] = hP[m]; i = m;
    }
    hT[i] = t; hC[i] = c; hH[i] = h; hS[i] = s; hP[i] = p;
  }
  const good = (k) => land[k] && !ice[k] && habit[k] >= Hs;
  const arrows = new Map();       // key: millennium * nBins + bin
  const nbx = Math.round(360 / ARROW_BIN_DEG), nby = Math.round(180 / ARROW_BIN_DEG), nBins = nbx * nby;
  function recordMove(from, to, t) {
    const a = cellCentre(from), b = cellCentre(to);
    let dl = b.lng - a.lng; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    const ex = dl * Math.cos(a.lat * Math.PI / 180), ny = b.lat - a.lat, len = Math.hypot(ex, ny) || 1;
    const bin = Math.min(nby - 1, Math.floor((a.lat + 90) / ARROW_BIN_DEG)) * nbx + Math.min(nbx - 1, Math.floor((a.lng + 180) / ARROW_BIN_DEG));
    const key = Math.floor(t / ARROW_YEARS) * nBins + bin;
    let r = arrows.get(key);
    if (!r) { r = { m: Math.floor(t / ARROW_YEARS), n: 0, ex: 0, ny: 0, x: 0, y: 0, z: 0 }; arrows.set(key, r); }
    const cl = Math.cos(a.lat * Math.PI / 180);
    r.n++; r.ex += ex / len; r.ny += ny / len;
    r.x += cl * Math.cos(a.lng * Math.PI / 180); r.y += Math.sin(a.lat * Math.PI / 180); r.z += cl * Math.sin(a.lng * Math.PI / 180);
  }

  best[startCell] = 0;
  push(0, startCell, Bh, Bs, -1);
  let lastT = 0, reachedLand = 0;
  while (size > 0) {
    pop();
    const { t, c, p } = top;
    let { h, s } = top;
    if (t > params.maxYears) break;
    const first = !done[c] && t <= best[c];
    if (!first && !(h > procH[c] + 50 || s > procS[c] + 20)) continue;   // stale, and no better budget
    if (first) {
      done[c] = 1; arrival[c] = t; lastT = t;
      if (land[c]) reachedLand++;
      if (p >= 0) { parent[c] = p; recordMove(p, c, t); }
      if (good(c)) settleStart[c] = t + params.settleDelayYears * Math.exp(params.randomSpread * rnd.normal());
    }
    if (good(c)) { h = Bh; s = Bs; }
    procH[c] = Math.max(procH[c], h); procS[c] = Math.max(procS[c], s);
    const j = Math.floor(c / W), i = c - j * W;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj; if (jj < 0 || jj >= H) continue;
      for (let di = -1; di <= 1; di++) {
        if (!dj && !di) continue;
        const k = jj * W + (i + di + W) % W;
        if (land[k] && ice[k]) continue;                              // land ice is closed
        const dx = (dxRow[j] + dxRow[jj]) / 2 * Math.abs(di), dist = Math.hypot(dx, dy * Math.abs(dj));
        let h2 = h, s2 = s, v;
        if (land[k]) {
          s2 = Bs;
          if (!good(k)) h2 -= dist * (1 - habit[k] / Hs);
          v = speed[k];
        } else if (permIce[k]) {
          h2 -= dist; v = params.speedKmPerYear * 0.6;
        } else {
          s2 -= dist; v = speed[k];
        }
        if (h2 < 0 || s2 < 0 || !(v > 0)) continue;
        const t2 = t + dist / v * Math.exp(params.randomSpread * rnd.normal() - params.randomSpread ** 2 / 2);
        if (t2 < best[k] && !done[k]) { best[k] = t2; push(t2, k, h2, s2, c); }
        else if ((h2 > procH[k] + 50 || s2 > procS[k] + 20) && relabels[k] < 3) { relabels[k]++; push(t2, k, h2, s2, c); }
      }
    }
  }
  // arrows: mean start point and mean direction per (millennium, bin)
  const list = [];
  for (const r of arrows.values()) {
    const mag = Math.hypot(r.ex, r.ny) / r.n;
    if (mag < 0.35) continue;                                   // moves in all directions: no clear arrow
    const l = Math.hypot(r.x, r.y, r.z);
    list.push({ m: r.m, n: r.n, lng: Math.atan2(r.z, r.x) * 180 / Math.PI, lat: Math.asin(r.y / l) * 180 / Math.PI,
      east: r.ex / r.n / mag, north: r.ny / r.n / mag });
  }
  list.sort((a, b) => a.m - b.m || b.n - a.n);
  return { seed, startCell, arrival, settleStart, settleEnd, parent, arrows: list, endYear: lastT, reachedLand };
}

// The state of one cell at a time t (years from departure).
export function cellState(journey, env, k, t) {
  if (env.land[k] && env.ice[k]) return { state: "ice" };
  const a = journey.arrival[k];
  if (!(a <= t)) return { state: "none" };
  const s = journey.settleStart[k];
  if (s <= t && t < journey.settleEnd[k]) return { state: "settled", arrival: a, settle: s };
  return { state: "passed", arrival: a };
}
