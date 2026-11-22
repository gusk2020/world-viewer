// 地形の高さ（pure）。酷道（kudo-fudo-miseisen）の標高生成を移植：GEBCO由来DEM + 内陸ほど高い下限 + fbmの細部 + 山脈（本州・南西/北東の2本）+ 富士山の円錐。
// 実世界の水平距離(km)と標高(m)で作り、船内へは水平も標高も 1/縮尺分母 に縮める（富士山 3776m → 1/40 で 94.4m）。
// 元のDEMは変更しない。高さの変更は terrain.heightLayer（地形変更レイヤー）に別保存する。
//   酷道に無いもの（正直な記録）：酷道の山脈は「描いた線の位置」、富士山は「位置と回転」しか編集できず、高さの編集は存在しない。
//   本版の高さ編集（富士山頂高・山脈の盛り上げ倍率）は新規。酷道から移植したのは、山脈線の自動提案・盛り上げ式・富士の形状と範囲制約。
(function (root) {
  "use strict";
  const FUJI = { lon: 138.7274, lat: 35.3606, summitM: 3776, baseRadiusKm: 20 };
  const DEFAULT_LAYER = { fujiSummitM: 3776, fujiRotDeg: 0, ridgeSwScale: 1, ridgeNeScale: 1, ridgeCapM: 3300 };
  const LAYER_LIMITS = { fujiSummitM: [0, 6000], fujiRotDeg: [-180, 180], ridgeSwScale: [0, 2], ridgeNeScale: [0, 2], ridgeCapM: [500, 6000] };
  const COAST_CLEARANCE_KM = 1, AREA_CHECK_FACTOR = 1.2, SEED = 1;

  // ---- noise (kudo rng.ts) ----
  function hash2(seed, x, y) { let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function valueNoise(seed, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash2(seed, xi, yi), b = hash2(seed, xi + 1, yi), c = hash2(seed, xi, yi + 1), d = hash2(seed, xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(seed, x, y) { let s = 0, amp = 0.5, f = 1, n = 0; for (let i = 0; i < 4; i++) { s += amp * valueNoise(seed + i * 101, x * f, y * f); n += amp; amp *= 0.5; f *= 2; } return s / n; }

  // ---- DEM ----
  function decodeDem(d) {
    const bin = typeof atob === "function" ? Uint8Array.from(atob(d.b64), (c) => c.charCodeAt(0)) : Uint8Array.from(Buffer.from(d.b64, "base64"));
    const dem = new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2);
    if (dem.length !== d.w * d.h) throw new Error("DEM size mismatch");
    return { meta: d, data: dem };
  }
  function sampleDem(D, lon, lat) {
    const m = D.meta, fx = (lon - m.lon0) / m.dLon, fy = (m.lat0 - lat) / m.dLat;
    if (fx < 0 || fy < 0 || fx > m.w - 1 || fy > m.h - 1) return NaN; // outside the crop (沖ノ鳥島・南鳥島)
    const x0 = Math.min(m.w - 2, Math.floor(fx)), y0 = Math.min(m.h - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0, g = (x, y) => D.data[y * m.w + x];
    return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
  }

  // ---- geometry ----
  function principalAxis(p) {
    const n = p.length; let mx = 0, my = 0; for (const q of p) { mx += q[0]; my += q[1]; } mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0; for (const q of p) { const dx = q[0] - mx, dy = q[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const ang = 0.5 * Math.atan2(2 * sxy / n, (sxx - syy) / n); return { c: [mx, my], dir: [Math.cos(ang), Math.sin(ang)] };
  }
  function pointIn(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
  function simplifyLine(pts, tol) {
    if (pts.length < 3) return pts; const a = pts[0], b = pts[pts.length - 1]; let best = -1, bi = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], a, b); if (d > best) { best = d; bi = i; } }
    return best <= tol ? [a, b] : simplifyLine(pts.slice(0, bi + 1), tol).slice(0, -1).concat(simplifyLine(pts.slice(bi), tol));
  }
  /** kudo suggest.ts: a default ridge following the middle of Honshu's width, for one half (sw / ne) of its long axis. */
  function suggestRidge(outline, half) {
    const pa = principalAxis(outline); let dir = pa.dir; if (dir[0] + dir[1] < 0) dir = [-dir[0], -dir[1]]; // points to the north-east end
    let tMin = Infinity, tMax = -Infinity; for (const q of outline) { const t = (q[0] - pa.c[0]) * dir[0] + (q[1] - pa.c[1]) * dir[1]; if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
    const span = tMax - tMin, perp = [-dir[1], dir[0]], pts = [], [a, b] = half === "sw" ? [0.07, 0.45] : [0.55, 0.93];
    for (let k = 0; k <= 12; k++) {
      const along = tMin + (a + ((b - a) * k) / 12) * span, base = [pa.c[0] + dir[0] * along, pa.c[1] + dir[1] * along];
      let best = null, bestAbs = Infinity, run = -1e9; const at = (o) => [base[0] + perp[0] * o, base[1] + perp[1] * o];
      for (let o = -500; o <= 500; o += 3) {
        const p = at(o), inside = pointIn(p[0], p[1], outline);
        if (inside && run === -1e9) run = o;
        if ((!inside || o + 3 > 500) && run !== -1e9) { const mid = (run + (inside ? o : o - 3)) / 2; if (Math.abs(mid) < bestAbs) { bestAbs = Math.abs(mid); best = at(mid); } run = -1e9; }
      }
      if (best) pts.push(best);
    }
    for (let pass = 0; pass < 3; pass++) for (let i = 1; i < pts.length - 1; i++) { const m = [(pts[i - 1][0] + pts[i][0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4]; if (pointIn(m[0], m[1], outline)) pts[i] = m; }
    return simplifyLine(pts, 4);
  }
  function fujiShape(rotDeg) { const a0 = (rotDeg * Math.PI) / 180; return Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * Math.PI * 2, r = FUJI.baseRadiusKm * (1 + 0.1 * Math.sin(3 * (a - a0) + 1) + 0.06 * Math.sin(5 * (a - a0) + 2)); return [Math.cos(a) * r, Math.sin(a) * r]; }); }

  function normalizeLayer(l) {
    const out = Object.assign({}, DEFAULT_LAYER);
    if (l && typeof l === "object") for (const [k, [lo, hi]] of Object.entries(LAYER_LIMITS)) if (l[k] !== undefined && Number.isFinite(Number(l[k]))) out[k] = Math.max(lo, Math.min(hi, Number(l[k])));
    return out;
  }

  // ---- per-island height grids (source plane, real km, real metres) ----
  function chamfer(src, nx, ny, cell) {
    const d = new Float32Array(nx * ny).fill(1e9); for (let k = 0; k < d.length; k++) if (src(k)) d[k] = 0;
    const fw = [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]], bw = [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (const [di, dj, w] of fw) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const v = d[b * nx + a] + w; if (v < d[j * nx + i]) d[j * nx + i] = v; }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) for (const [di, dj, w] of bw) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const v = d[b * nx + a] + w; if (v < d[j * nx + i]) d[j * nx + i] = v; }
    for (let k = 0; k < d.length; k++) d[k] *= cell; return d;
  }
  function buildIslandGrid(model, dem, isl, layer, ridges) {
    const ring = isl.ring, bb = isl.bb, area = isl.areaKm2;
    const cell = Math.max(0.35, Math.min(2.5, Math.sqrt(area) / 14)), pad = cell * 2;
    const x0 = bb.lx - pad, y0 = bb.by - pad, nx = Math.ceil((bb.rx - bb.lx + 2 * pad) / cell) + 1, ny = Math.ceil((bb.ty - bb.by + 2 * pad) / cell) + 1, N = nx * ny;
    const land = new Uint8Array(N);
    for (let j = 0; j < ny; j++) { const y = y0 + (j + 0.5) * cell, xs = []; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const p = ring[a], q = ring[b]; if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0])); } xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)); i <= Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5)); i++) land[j * nx + i] = 1; }
    const inland = chamfer((k) => land[k] === 0, nx, ny, cell);
    let maxInland = 0; for (let k = 0; k < N; k++) if (land[k] && inland[k] > maxInland) maxInland = inland[k];
    const P = model.P, h = new Float32Array(N).fill(NaN), dm = new Float32Array(N).fill(NaN);
    const seed = SEED + (isl.index || 0) * 7;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!land[k]) continue;
      const cx = x0 + (i + 0.5) * cell, cy = y0 + (j + 0.5) * cell, lon = cx / P.kmPerDegLon + P.refLon, lat = cy / P.kmPerDegLat + P.refLat;
      let e = sampleDem(dem, lon, lat); dm[k] = e;
      if (!Number.isFinite(e) || e < 0) e = 0;
      const floor = 2 + 0.4 * inland[k];
      // 小さな島はDEM(約9km解像度)に山がほぼ映らない。島の大きさから決まる低いドームを下限にする（生成値であり実標高ではない）
      const dome = area < 3000 ? Math.min(700, 14 * Math.sqrt(area)) * Math.pow(inland[k] / Math.max(maxInland, 1e-6), 1.2) : 0;
      e = Math.max(e, floor, dome);
      const amp = 35 + 0.07 * e;
      h[k] = Math.max(2, e + (fbm(seed, cx / 28, cy / 28) - 0.5) * 2 * amp);
    }
    if (ridges && isl.id === "honshu") { // kudo: 各セルの山脈近接度 f = max exp(-(d/W)^2)、標高 = min(上限, 標高 + (1100+1100*fbm)*f)
      const W = 18, F = { sw: new Float32Array(N), ne: new Float32Array(N) };
      for (const key of ["sw", "ne"]) {
        const line = ridges[key]; if (!line || line.length < 2) continue;
        for (let sg = 0; sg + 1 < line.length; sg++) {
          const a = line[sg], b = line[sg + 1];
          for (let j = Math.max(0, Math.floor((Math.min(a[1], b[1]) - 3 * W - y0) / cell)); j <= Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1]) + 3 * W - y0) / cell)); j++)
            for (let i = Math.max(0, Math.floor((Math.min(a[0], b[0]) - 3 * W - x0) / cell)); i <= Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0]) + 3 * W - x0) / cell)); i++) {
              const k = j * nx + i; if (!land[k]) continue;
              const f = Math.exp(-((segDist([x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell], a, b) / W) ** 2)); if (f > F[key][k]) F[key][k] = f;
            }
        }
      }
      for (let k = 0; k < N; k++) if (land[k]) {
        const fs = F.sw[k] * layer.ridgeSwScale, fn = F.ne[k] * layer.ridgeNeScale, f = Math.max(fs, fn);
        if (f > 0.01) { const i = k % nx, j = (k / nx) | 0, up = 1100 + 1100 * fbm(seed + 7, (x0 + (i + 0.5) * cell) / 55, (y0 + (j + 0.5) * cell) / 55); h[k] = Math.min(layer.ridgeCapM, h[k] + up * f); }
      }
    }
    if (isl.id === "honshu") { // 富士山
      const c = model.toKm(FUJI.lon, FUJI.lat), a0 = (layer.fujiRotDeg * Math.PI) / 180, r0 = FUJI.baseRadiusKm * 1.25, top = layer.fujiSummitM;
      for (let j = Math.max(0, Math.floor((c[1] - r0 - y0) / cell)); j <= Math.min(ny - 1, Math.ceil((c[1] + r0 - y0) / cell)); j++)
        for (let i = Math.max(0, Math.floor((c[0] - r0 - x0) / cell)); i <= Math.min(nx - 1, Math.ceil((c[0] + r0 - x0) / cell)); i++) {
          const k = j * nx + i; if (!land[k]) continue;
          const dx = x0 + (i + 0.5) * cell - c[0], dy = y0 + (j + 0.5) * cell - c[1], d = Math.hypot(dx, dy), th = Math.atan2(dy, dx) - a0;
          const R = FUJI.baseRadiusKm * (1 + 0.1 * Math.sin(3 * th + 1) + 0.06 * Math.sin(5 * th + 2));
          if (d < R) { const e = 250 + (top - 250) * Math.pow(1 - d / R, 1.5); if (e > h[k]) h[k] = e; }
        }
      const i = Math.floor((c[0] - x0) / cell), j = Math.floor((c[1] - y0) / cell);
      if (i >= 0 && j >= 0 && i < nx && j < ny && land[j * nx + i]) h[j * nx + i] = Math.max(h[j * nx + i], top);
    }
    return { id: isl.id, x0, y0, cell, nx, ny, land, h, dem: dm };
  }
  /** Real-height grids for every island (cached per island by the caller). Honshu depends on the height layer. */
  function buildGrids(model, dem, layerIn, only) {
    const layer = normalizeLayer(layerIn), grids = new Map();
    const honshu = model.byId.get("honshu");
    const ridges = honshu ? { sw: suggestRidge(honshu.ring, "sw"), ne: suggestRidge(honshu.ring, "ne") } : null;
    for (const isl of model.islands) { if (only && !only(isl)) continue; grids.set(isl.id, buildIslandGrid(model, dem, isl, layer, ridges)); }
    return { grids, layer, ridges };
  }
  function gridHeight(g, x, y) { // bilinear over land cells; NaN outside land
    const fx = (x - g.x0) / g.cell - 0.5, fy = (y - g.y0) / g.cell - 0.5, i = Math.floor(fx), j = Math.floor(fy);
    if (i < -1 || j < -1 || i >= g.nx || j >= g.ny) return NaN;
    const tx = fx - i, ty = fy - j; let s = 0, w = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue; const v = g.h[jj * g.nx + ii]; if (Number.isNaN(v)) continue; const ww = (a ? tx : 1 - tx) * (b ? ty : 1 - ty); s += v * ww; w += ww; }
    return w > 0.25 ? s / w : NaN;
  }
  /** 富士山の範囲制約（酷道 featureInside: 面積1.2倍の外形が本州の中に海岸から1km以上離れて収まる） */
  function checkFuji(model, layer) {
    const hon = model.byId.get("honshu"); if (!hon) return { ok: true };
    const c = model.toKm(FUJI.lon, FUJI.lat), k = Math.sqrt(AREA_CHECK_FACTOR), shape = fujiShape(layer ? layer.fujiRotDeg : 0).map((q) => [c[0] + q[0] * k, c[1] + q[1] * k]);
    let inside = true, minClear = Infinity;
    for (const p of shape) { if (!pointIn(p[0], p[1], hon.ring)) inside = false; for (let i = 0, j = hon.ring.length - 1; i < hon.ring.length; j = i++) minClear = Math.min(minClear, segDist(p, hon.ring[j], hon.ring[i])); }
    return { ok: inside && minClear >= COAST_CLEARANCE_KM, inside, minClearanceKm: minClear };
  }
  /** 船体座標(x,y)の地面の高さ（船内m）。島ごとの剛体移動の逆変換で元の標高グリッドを引く。周回コピーも見る。 */
  function makeShipSampler(core, lay, grids, model, layerIn) {
    const f = lay.frame, w = f.w, left = f.x - w / 2, layer = normalizeLayer(layerIn), fc = model ? model.toKm(FUJI.lon, FUJI.lat) : null, a0 = (layer.fujiRotDeg * Math.PI) / 180;
    // 富士山頂は格子(2.5km)の中心に無いので、頂上付近は解析式で直接引く（山頂が正確に summit になる）
    const fujiAt = (q) => { const dx = q[0] - fc[0], dy = q[1] - fc[1], d = Math.hypot(dx, dy); if (d >= FUJI.baseRadiusKm * 1.25) return 0; const th = Math.atan2(dy, dx) - a0, R = FUJI.baseRadiusKm * (1 + 0.1 * Math.sin(3 * th + 1) + 0.06 * Math.sin(5 * th + 2)); return d < R ? 250 + (layer.fujiSummitM - 250) * Math.pow(1 - d / R, 1.5) : 0; };
    const items = lay.islands.map((i) => ({ i, sh: lay.shifts.get(i.id), g: grids.get(i.id) })).filter((q) => q.g);
    return function (x, y) {
      const xw = left + ((((x - left) % w) + w) % w); let best = 0;
      for (const { i, sh, g } of items) {
        if (y < i.bb.by - 0.01 || y > i.bb.ty + 0.01) continue;
        const k0 = Math.ceil((i.bb.lx - 0.01 - xw) / w), k1 = Math.floor((i.bb.rx + 0.01 - xw) / w);
        for (let k = k0; k <= k1; k++) { const q = core.unshipPoint([xw + k * w, y], sh); let hgt = gridHeight(g, q[0], q[1]); if (fc && i.id === "honshu" && Number.isFinite(hgt)) hgt = Math.max(hgt, fujiAt(q)); if (hgt > best) best = hgt / sh.denom; }
      }
      return best;
    };
  }
  const api = { makeShipSampler, FUJI, DEFAULT_LAYER, LAYER_LIMITS, decodeDem, sampleDem, suggestRidge, fujiShape, normalizeLayer, buildGrids, gridHeight, checkFuji, fbm };
  root.ShipTerrain = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
