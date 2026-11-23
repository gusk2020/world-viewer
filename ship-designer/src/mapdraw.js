// Paints the unwrapped ship surface onto any 2D canvas context. Used by the 2D view (screen) and by the 3D view
// (cylinder texture), so both always show the same islands, borders, cities and interference.
(function (root) {
  "use strict";
  const COLORS = { sea: "#0d415d", land: "#4e9877", landEdge: "#ccebd7", schematic: "#7fae8f", border: "#f5e7a1", city: "#ffd27a", capital: "#ffffff", overlap: "rgba(255,70,70,0.62)", symbol: "#9be3bd" };

  /** T maps ship km to canvas px: px = x*T.sx + T.ox, py = y*T.sy + T.oy. win = {low, high, south, north} in ship km. */
  function paintMap(ctx, lay, inter, T, win, opt) {
    const w = lay.frame.w;
    const px = (x) => x * T.sx + T.ox, py = (y) => y * T.sy + T.oy;
    const kRange = (lx, rx) => [Math.ceil((win.low - rx) / w), Math.floor((win.high - lx) / w)];
    const scale = Math.abs(T.sx);
    // land
    const symbols = [];
    for (const s of lay.islands) {
      if (s.bb.ty < win.south || s.bb.by > win.north) continue;
      const [k0, k1] = kRange(s.bb.lx, s.bb.rx);
      const tiny = Math.max(s.bb.rx - s.bb.lx, s.bb.ty - s.bb.by) * scale < (opt.symbolPx || 4);
      for (let k = k0; k <= k1; k++) {
        const dx = k * w;
        ctx.beginPath();
        for (let i = 0; i < s.ring.length; i++) { const q = s.ring[i], X = px(q[0] + dx), Y = py(q[1]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
        ctx.closePath();
        if (opt.landFill !== false || s.source === "schematic" || s.areaKm2 < 0.6) { ctx.fillStyle = s.source === "schematic" ? COLORS.schematic : COLORS.land; ctx.fill(); }
        if (!tiny) { ctx.strokeStyle = COLORS.landEdge; ctx.lineWidth = opt.edgePx || 1; ctx.stroke(); }
        else if (opt.symbols) symbols.push([px(s.c[0] + dx), py(s.c[1])]);
      }
    }
    // interference: the real overlapping land, painted as a surface
    if (opt.interference) {
      ctx.fillStyle = COLORS.overlap;
      for (const o of inter) {
        let lx = Infinity, rx = -Infinity; for (const r of o.rects) { if (r[0] < lx) lx = r[0]; if (r[1] > rx) rx = r[1]; }
        const [k0, k1] = kRange(lx, rx);
        for (let k = k0; k <= k1; k++) for (const r of o.rects) {
          const X0 = px(r[0] + k * w), X1 = px(r[1] + k * w), Y0 = py(r[3]), Y1 = py(r[2]);
          ctx.fillRect(X0, Y0, Math.max(X1 - X0, opt.minOverlapPx || 0), Math.max(Y1 - Y0, 0.6));
        }
      }
    }
    // prefecture borders
    if (opt.borders) {
      ctx.strokeStyle = COLORS.border; ctx.lineWidth = opt.borderPx || 0.8; ctx.setLineDash(opt.borderDash || []);
      for (const b of lay.borders) {
        if (!b.bb) { let lx = Infinity, rx = -Infinity; for (const q of b.line) { if (q[0] < lx) lx = q[0]; if (q[0] > rx) rx = q[0]; } b.bb = [lx, rx]; }
        const [k0, k1] = kRange(b.bb[0], b.bb[1]);
        for (let k = k0; k <= k1; k++) { ctx.beginPath(); b.line.forEach((q, i) => { const X = px(q[0] + k * w), Y = py(q[1]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.stroke(); }
      }
      ctx.setLineDash([]);
    }
    // symbols for islets too small to see (display only: never used for interference)
    if (opt.symbols) { ctx.fillStyle = COLORS.symbol; for (const [X, Y] of symbols) { ctx.beginPath(); ctx.arc(X, Y, opt.symbolR || 2.2, 0, Math.PI * 2); ctx.fill(); } }
    const copiesOf = (x, fn) => { const [k0, k1] = kRange(x, x); for (let k = k0; k <= k1; k++) fn(x + k * w); };
    // prefecture names
    if (opt.prefNames) {
      ctx.font = `${opt.prefFont || 11}px system-ui,sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = 3; ctx.strokeStyle = "#06222fcc"; ctx.fillStyle = "#fff6d6";
      for (const p of lay.prefectures) { if (p.pos[1] < win.south || p.pos[1] > win.north) continue; copiesOf(p.pos[0], (x) => { const X = px(x), Y = py(p.pos[1]); ctx.strokeText(p.name, X, Y); ctx.fillText(p.name, X, Y); }); }
    }
    if (opt.cities) {
      ctx.font = `${opt.cityFont || 10}px system-ui,sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineWidth = 3; ctx.strokeStyle = "#06222fcc";
      for (const c of lay.cities) {
        if (c.pos[1] < win.south || c.pos[1] > win.north) continue;
        copiesOf(c.pos[0], (x) => {
          const X = px(x), Y = py(c.pos[1]);
          ctx.fillStyle = c.kind === "capital" ? COLORS.capital : COLORS.city; ctx.beginPath(); ctx.arc(X, Y, c.kind === "capital" ? 2.4 : 1.8, 0, Math.PI * 2); ctx.fill();
          if (opt.cityNames) { ctx.strokeText(c.name, X + 4, Y); ctx.fillText(c.name, X + 4, Y); }
        });
      }
    }
  }
  root.ShipDraw = { paintMap, COLORS };
})(typeof window !== "undefined" ? window : globalThis);
