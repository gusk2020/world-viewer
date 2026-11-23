// 地形のラスター画像（pure）。船体の展開図（円周方向に周期境界）と同じ範囲を、標高色・陰影・雪・湖・河川で塗る。
// 色は「実標高」で決める（高さ倍率の影響を受けない）。河川の表示幅は視認用で、実地形の寸法とは別。標高の計算値は一切変えない。
(function (root) {
  "use strict";
  // 酷道系の標高色（海抜 → RGB）。雪は 2400m から白へ。暫定（現実の雪線・熱収支ではない）。
  const STOPS = [[0, [150, 184, 106]], [150, [163, 191, 110]], [500, [196, 193, 120]], [1000, [190, 163, 110]], [1600, [165, 138, 100]], [2300, [150, 125, 100]], [2600, [205, 205, 208]], [3100, [246, 248, 251]]];
  const WATER = { lake: [58, 128, 200], river: [70, 140, 212] };
  function colorOf(h, shade) {
    let c = STOPS[STOPS.length - 1][1];
    for (let i = 0; i + 1 < STOPS.length; i++) { const a = STOPS[i], b = STOPS[i + 1]; if (h <= b[0]) { const t = Math.max(0, (h - a[0]) / (b[0] - a[0])); c = [a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t]; break; } }
    return [Math.min(255, c[0] * shade), Math.min(255, c[1] * shade), Math.min(255, c[2] * shade)];
  }
  function fillPoly(mask, W, H, ring, ppk, left, top, val) {
    const px = ring.map((q) => [(q[0] - left) * ppk, (top - q[1]) * ppk]); let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity; for (const q of px) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); }
    for (let k = Math.ceil((-x1) / W); k <= Math.floor((W - x0) / W); k++) { // 円周の折り返しコピー
      for (let j = Math.max(0, Math.floor(y0)); j <= Math.min(H - 1, Math.ceil(y1)); j++) { const y = j + 0.5, xs = []; for (let a = 0, b = px.length - 1; a < px.length; b = a++) { const p = px[a], q = px[b]; if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]) + k * W); } xs.sort((u, v) => u - v);
        for (let m = 0; m + 1 < xs.length; m += 2) for (let i = Math.max(0, Math.ceil(xs[m] - 0.5)); i <= Math.min(W - 1, Math.floor(xs[m + 1] - 0.5)); i++) mask[j * W + i] = val; } }
  }
  function line(mask, W, H, ax, ay, bx, by, val, wid) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 1.5)); const r = wid / 2;
    for (let s = 0; s <= n; s++) { const x = ax + ((bx - ax) * s) / n, y = ay + ((by - ay) * s) / n; for (let dj = -Math.ceil(r); dj <= Math.ceil(r); dj++) for (let di = -Math.ceil(r); di <= Math.ceil(r); di++) { if (di * di + dj * dj > r * r + 0.25) continue; const j = Math.floor(y) + dj; if (j < 0 || j >= H) continue; const i = (((Math.floor(x) + di) % W) + W) % W; if (mask[j * W + i] !== 2) mask[j * W + i] = val; } }
  }
  /** opt: {ppk, rowsPerTick?, onProgress?}. layer: 正規化済みの高さレイヤー。rivers: Map(島id→[[x1,y1,x2,y2,level]...]) */
  function setup(core, T, model, lay, grids, layer, rivers, opt) {
    const f = lay.frame, ppk = opt.ppk, W = Math.max(8, Math.ceil(f.w * ppk)), H = Math.max(8, Math.ceil(f.h * ppk)), left = f.x - f.w / 2, top = f.y + f.h / 2;
    const S = T.makeShipSampler(core, lay, grids, model, layer, true), real = new Float32Array(W * H), water = new Uint8Array(W * H);
    return { W, H, ppk, left, top, f, S, real, water, rgba: new Uint8ClampedArray(W * H * 4), denom: model && lay.shifts ? [...lay.shifts.values()][0].denom : 40, lay, rivers, core };
  }
  function rowRange(st, j0, j1) { for (let j = j0; j < j1; j++) { const y = st.top - (j + 0.5) / st.ppk; for (let i = 0; i < st.W; i++) { const x = st.left + (i + 0.5) / st.ppk, h = st.S(x, y); st.real[j * st.W + i] = h; st.water[j * st.W + i] = h > 0 ? 0 : 1; } } }
  function finish(st) {
    const { W, H, ppk, left, top, lay, real, water } = st;
    for (const lk of lay.lakes || []) fillPoly(water, W, H, lk.ring, ppk, left, top, 2);
    for (const [id, segs] of st.rivers || []) { const sh = lay.shifts.get(id); if (!sh || !lay.islands.some((i) => i.id === id)) continue; for (const sg of segs) { const a = st.core.shipPoint([sg[0], sg[1]], sh), b = st.core.shipPoint([sg[2], sg[3]], sh), ax = (a[0] - left) * ppk, ay = (top - a[1]) * ppk, bx = (b[0] - left) * ppk, by = (top - b[1]) * ppk; for (const k of [-1, 0, 1]) line(water, W, H, ax + k * W, ay, bx + k * W, by, 3, sg[4] === 2 ? 1.8 : 1.1); } }
    const kx = (1 / ppk) * st.denom * 1000; // 1ピクセルの実水平距離(m)
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, o = k * 4, wv = water[k];
      if (wv === 1) { st.rgba[o + 3] = 0; continue; }
      if (wv === 2 || wv === 3) { const c = wv === 2 ? WATER.lake : WATER.river; st.rgba[o] = c[0]; st.rgba[o + 1] = c[1]; st.rgba[o + 2] = c[2]; st.rgba[o + 3] = 255; continue; }
      const h = real[k], hl = real[j * W + ((i + W - 1) % W)], hr = real[j * W + ((i + 1) % W)], hu = j > 0 ? real[k - W] : h, hd = j < H - 1 ? real[k + W] : h;
      const dzdx = (hr - hl) / (2 * kx), dzdy = (hd - hu) / (2 * kx), shade = Math.max(0.62, Math.min(1.35, 1 + 1.6 * (-(dzdx) * 0.7 + -(dzdy) * -0.7) * 0.5));
      const c = colorOf(h, shade); st.rgba[o] = c[0]; st.rgba[o + 1] = c[1]; st.rgba[o + 2] = c[2]; st.rgba[o + 3] = 255;
    }
    return { W, H, ppk, rgba: st.rgba, water, real, frame: st.f };
  }
  function renderSync(core, T, model, lay, grids, layer, rivers, opt) { const st = setup(core, T, model, lay, grids, layer, rivers, opt); rowRange(st, 0, st.H); return finish(st); }
  /** 画面を止めないよう少しずつ計算する。cancel() で中止。 */
  function renderAsync(core, T, model, lay, grids, layer, rivers, opt, done) {
    const st = setup(core, T, model, lay, grids, layer, rivers, opt); let j = 0, dead = false; const per = opt.rowsPerTick || 40;
    const tick = () => { if (dead) return; rowRange(st, j, Math.min(st.H, j + per)); j += per; if (j < st.H) setTimeout(tick, 0); else done(finish(st)); };
    setTimeout(tick, 0); return { cancel() { dead = true; } };
  }
  const api = { colorOf, STOPS, WATER, renderSync, renderAsync, fillPoly }; root.ShipTerrainImg = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
