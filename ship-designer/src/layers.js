// 船内の追加レイヤー（市町村・人口密度・都市/市街地・鉄道・道路）。2D画面と3Dテクスチャで共通。
// 計算値（人口・面積）と表示用の記号を混同しない：円の大きさは市町村の面積、色は人口密度。名前は縮尺に応じて密度を変える。
(function (root) {
  "use strict";
  const DENS = [[0, [60, 110, 150]], [100, [80, 150, 170]], [300, [120, 190, 130]], [1000, [235, 215, 90]], [3000, [240, 150, 60]], [8000, [225, 60, 60]], [20000, [150, 20, 90]]];
  const densColor = (d, a) => { let c = DENS[DENS.length - 1][1]; for (let i = 0; i + 1 < DENS.length; i++) if (d <= DENS[i + 1][0]) { const t = Math.max(0, (d - DENS[i][0]) / (DENS[i + 1][0] - DENS[i][0])); const p = DENS[i][1], q = DENS[i + 1][1]; c = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]; break; } return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; };
  const URBAN_DENSITY = 5000; // 市街地の人口密度の目安(人/km²・暫定)。市街地面積＝人口/これ。住宅・商業は1/3都市スケール（記録のみ・面積の表示には掛けない）
  /** data: {munis:[{c,n,k,pos,pop,areaKm2,capital}], net:[{mode,tier,a:[x,y],b:[x,y]}], denom} */
  function paint(ctx, lay, data, T, win, opt) {
    const w = lay.frame.w, scale = Math.abs(T.sx), px = (x) => x * T.sx + T.ox, py = (y) => y * T.sy + T.oy, kr = (lx, rx) => [Math.ceil((win.low - rx) / w), Math.floor((win.high - lx) / w)];
    const inY = (y, m) => y >= win.south - m && y <= win.north + m, denom = data.denom;
    const copies = (x, fn) => { const [k0, k1] = kr(x, x); for (let k = k0; k <= k1; k++) fn(x + k * w); };
    if (opt.density) for (const m of data.munis) { if (!inY(m.pos[1], 1)) continue; const r = Math.sqrt(m.areaKm2 / Math.PI) / denom, d = m.pop / m.areaKm2; copies(m.pos[0], (x) => { ctx.beginPath(); ctx.arc(px(x), py(m.pos[1]), Math.max(1.2, r * scale), 0, Math.PI * 2); ctx.fillStyle = densColor(d, 0.5); ctx.fill(); }); }
    if (opt.urban) for (const m of data.munis) { if (m.k !== "city" && !(m.pop > 80000)) continue; if (!inY(m.pos[1], 1)) continue; const rReal = Math.sqrt(m.pop / URBAN_DENSITY / Math.PI), r = Math.max(rReal / denom, 0.012) * scale; if (r < 1.2) continue;
      copies(m.pos[0], (x) => { ctx.beginPath(); ctx.arc(px(x), py(m.pos[1]), r, 0, Math.PI * 2); ctx.fillStyle = "rgba(235,170,120,0.55)"; ctx.fill(); ctx.beginPath(); ctx.arc(px(x), py(m.pos[1]), Math.max(0.9, r * 0.42), 0, Math.PI * 2); ctx.fillStyle = "rgba(215,80,60,0.85)"; ctx.fill(); }); }
    const drawNet = (modeKey, tiers, col, wid, dash) => { ctx.strokeStyle = col; ctx.lineWidth = wid; ctx.setLineDash(dash || []); ctx.lineCap = "round"; for (const e of data.net) { if (e.mode !== modeKey || !tiers.includes(e.tier)) continue; if (Math.max(e.a[1], e.b[1]) < win.south || Math.min(e.a[1], e.b[1]) > win.north) continue; const lx = Math.min(e.a[0], e.b[0]), rx = Math.max(e.a[0], e.b[0]), [k0, k1] = kr(lx, rx); for (let k = k0; k <= k1; k++) { ctx.beginPath(); ctx.moveTo(px(e.a[0] + k * w), py(e.a[1])); ctx.lineTo(px(e.b[0] + k * w), py(e.b[1])); ctx.stroke(); } } ctx.setLineDash([]); };
    const sw = Math.max(1, Math.min(3.2, scale / 14));
    if (opt.road) { drawNet("road", ["local"], "rgba(250,235,190,0.8)", sw * 0.6); drawNet("road", ["trunk"], "rgba(255,196,64,0.95)", sw * 1.1); }
    if (opt.rail) { drawNet("rail", ["rail"], "rgba(20,10,40,0.7)", sw * 2.0); drawNet("rail", ["rail"], "rgba(190,120,255,0.98)", sw * 1.2); }
    if (opt.munis) { ctx.fillStyle = "rgba(255,255,255,0.85)"; for (const m of data.munis) { if (m.k === "village" && scale < 25) continue; if (!inY(m.pos[1], 1)) continue; copies(m.pos[0], (x) => { ctx.beginPath(); ctx.arc(px(x), py(m.pos[1]), m.capital ? 2.4 : 1.1, 0, Math.PI * 2); ctx.fill(); }); } }
    if (opt.names) { // 縮尺に応じて表示密度を変える：人口の多い順＋県庁を優先し、重なる名前は出さない
      const fs = opt.nameFont || 11, limit = Math.max(8, Math.min(260, Math.round((scale - 2) * 6))), placed = []; ctx.font = `${fs}px system-ui,sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(6,34,47,0.85)";
      const order = data.order || (data.order = data.munis.slice().sort((a, b) => (b.capital - a.capital) || b.pop - a.pop));
      let scanned = 0;
      for (const m of order) { if (placed.length >= limit || scanned++ > 1500) break; if (!inY(m.pos[1], 0.5)) continue; if (scale < 6 && !m.capital && m.pop < 400000) continue;
        const [k0, k1] = kr(m.pos[0], m.pos[0]); for (let k = k0; k <= k1; k++) { const X = px(m.pos[0] + k * w) + 4, Y = py(m.pos[1]), wd = m.n.length * fs * 0.95; if (X < -wd || X > ctx.canvas.width + wd) continue; const rc = [X, Y - fs / 2, X + wd, Y + fs / 2]; if (placed.some((q) => !(rc[2] < q[0] || rc[0] > q[2] || rc[3] < q[1] || rc[1] > q[3]))) continue; placed.push(rc); ctx.font = `${m.capital ? "700 " : ""}${fs}px system-ui,sans-serif`; ctx.strokeText(m.n, X, Y); ctx.fillStyle = m.capital ? "#fff6c8" : "#ffffff"; ctx.fillText(m.n, X, Y); } }
      return placed.length; }
    return 0;
  }
  root.ShipLayers = { paint, densColor, URBAN_DENSITY, DENS };
})(typeof window !== "undefined" ? window : globalThis);
