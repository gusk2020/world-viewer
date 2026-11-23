// 2D design screen + shared state. The 3D view (view3d.js) reads the same state through ShipApp.
(function () {
  "use strict";
  const C = window.ShipCore, $ = (id) => document.getElementById(id);
  const model = C.buildModel(window.SHIP_GEO);
  const canvas = $("map"), ctx = canvas.getContext("2d");
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fmt = (n, d) => (Math.abs(n) >= 100 ? n.toFixed(d === undefined ? 0 : Math.min(d, 1)) : Math.abs(n) >= 10 ? n.toFixed(d === undefined ? 1 : d) : n.toFixed(d === undefined ? 2 : d));

  let state = C.presetState(model, "adopted");
  let presetId = "adopted", customFrom = null; // customFrom: preset name the manual edits started from
  let editOpen = false, tab = "view", tapInfo = null;
  let view = { ridges: false, borders: true, cities: true, interference: true, symbols: true, overhang: true };
  let mode = "cylinder", current = "2d";
  let camera = { x: 0, y: 0, s: 1 };
  let lay = null, inter = [], interKey = "", met = null, dirty3d = true;
  const listeners = [];

  // ------------------------------------------------------------ derived data
  const stateKey = () => JSON.stringify([state.ship, state.terrain]);
  function recompute(withInterference) {
    lay = C.layout(model, state);
    const key = stateKey();
    if (withInterference && key !== interKey) { inter = C.interference(lay); interKey = key; }
    met = C.metrics(model, state, lay, interKey === key ? inter : []);
    dirty3d = true;
  }
  let interTimer = null;
  function changed(opts) {
    opts = opts || {};
    if (opts.custom) markCustom();
    recompute(!opts.fast);
    if (opts.fast) { clearTimeout(interTimer); interTimer = setTimeout(() => { recompute(true); render(); }, 160); }
    render(); if (current !== "2d") syncText();
    listeners.forEach((f) => f());
  }
  function markCustom() { if (presetId !== "custom") { customFrom = (C.presetList().find((p) => p.id === presetId) || {}).name || customFrom; presetId = "custom"; state.sourcePreset = null; } $("preset").value = "custom"; syncPresetLabel(); }

  // ------------------------------------------------------------ 2D drawing
  function p2s(x, y) { return { x: canvas.clientWidth / 2 + (x - camera.x) * camera.s, y: canvas.clientHeight / 2 - (y - camera.y) * camera.s }; }
  function frameRect() { const f = lay.frame, a = p2s(f.x - f.w / 2, f.y + f.h / 2), b = p2s(f.x + f.w / 2, f.y - f.h / 2); return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }; }
  function tick() { const t = 70 / camera.s, p = Math.pow(10, Math.floor(Math.log10(t))); return [1, 2, 5, 10].map((z) => z * p).find((z) => z >= t) || p * 10; }
  let raf = 0;
  function render() { if (current !== "2d") return; if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#0b2435"; ctx.fillRect(0, 0, w, h);
    const f = lay.frame, r = frameRect(), st = tick();
    // grid
    ctx.strokeStyle = "#51748766"; ctx.fillStyle = "#86afbd"; ctx.font = "10px system-ui"; ctx.lineWidth = 0.7; ctx.textAlign = "left";
    const x0 = camera.x - w / (2 * camera.s), x1 = camera.x + w / (2 * camera.s), y0 = camera.y - h / (2 * camera.s), y1 = camera.y + h / (2 * camera.s);
    for (let x = Math.ceil(x0 / st) * st; x <= x1; x += st) { const u = p2s(x, 0); ctx.beginPath(); ctx.moveTo(u.x, 0); ctx.lineTo(u.x, h); ctx.stroke(); ctx.fillText(fmt(x), u.x + 2, h - 5); }
    for (let y = Math.ceil(y0 / st) * st; y <= y1; y += st) { const u = p2s(0, y); ctx.beginPath(); ctx.moveTo(0, u.y); ctx.lineTo(w, u.y); ctx.stroke(); ctx.fillText(fmt(y) + "km", 3, u.y - 4); }
    // the unwrapped map outside the hull, faint (where the land "really" lies before folding)
    const T = { sx: camera.s, ox: w / 2 - camera.x * camera.s, sy: -camera.s, oy: h / 2 + camera.y * camera.s };
    ctx.globalAlpha = 0.2;
    ShipDraw.paintMap(ctx, { ...lay, frame: { ...f, w: 1e9 } }, [], T, { low: x0, high: x1, south: y0, north: y1 }, { symbols: false });
    ctx.globalAlpha = 1;
    // はみ出し（船体の南北端を越えた島）は橙の輪郭で別表示。地形干渉の赤い面とは独立。
    if (view.overhang && met.overhangIslands.length) {
      ctx.strokeStyle = "#ff9d2e"; ctx.lineWidth = 1.6;
      for (const o of met.overhangIslands) { const isl = lay.islands.find((q) => q.id === o.id); if (!isl) continue;
        const k0 = Math.ceil((x0 - isl.bb.rx) / f.w), k1 = Math.floor((x1 - isl.bb.lx) / f.w);
        for (let k = k0; k <= k1; k++) { ctx.beginPath(); isl.ring.forEach((q, i) => { const u = p2s(q[0] + k * f.w, q[1]); if (i) ctx.lineTo(u.x, u.y); else ctx.moveTo(u.x, u.y); }); ctx.closePath(); ctx.stroke(); } }
    }
    // inside the hull: folded onto the circumference
    ctx.fillStyle = ShipDraw.COLORS.sea; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    const showNames = camera.s > 9;
    ShipDraw.paintMap(ctx, lay, inter, T, { low: f.x - f.w / 2, high: f.x + f.w / 2, south: Math.max(y0, f.y - f.h / 2), north: Math.min(y1, f.y + f.h / 2) },
      { borders: view.borders, cities: view.cities, cityNames: view.cities && showNames, interference: view.interference && interKey === stateKey(), symbols: view.symbols, minOverlapPx: 2 });
    ctx.setLineDash([3, 4]); ctx.strokeStyle = "#a5d4e155"; ctx.lineWidth = 0.7;
    for (let x = Math.ceil((f.x - f.w / 2) / st) * st; x <= f.x + f.w / 2; x += st) { const u = p2s(x, 0); ctx.beginPath(); ctx.moveTo(u.x, r.y); ctx.lineTo(u.x, r.y + r.h); ctx.stroke(); }
    ctx.setLineDash([]); ctx.restore();
    drawTerrainMarks(w, h, x0, x1);
    // hull frame + handles
    ctx.strokeStyle = "#ffda92"; ctx.lineWidth = 2.3; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([6, 5]); ctx.strokeStyle = "#ffffffaa"; ctx.lineWidth = 1.2;
    for (const X of [r.x, r.x + r.w]) { ctx.beginPath(); ctx.moveTo(X, r.y); ctx.lineTo(X, r.y + r.h); ctx.stroke(); }
    ctx.setLineDash([]);
    if (mode === "cylinder") for (const [id, x, y] of handles(r)) {
      ctx.beginPath(); ctx.fillStyle = id.length === 2 ? "#ffdc97" : "#a1e6f3";
      if (id.length === 2) ctx.arc(x, y, 9, 0, Math.PI * 2); else { ctx.moveTo(x, y - 10); ctx.lineTo(x + 10, y); ctx.lineTo(x, y + 10); ctx.lineTo(x - 10, y); ctx.closePath(); }
      ctx.fill(); ctx.strokeStyle = "#123e55"; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.fillStyle = "#f3f4eb"; ctx.font = "12px system-ui"; ctx.textAlign = "center";
    ctx.fillText("↑ 船首・北", r.x + r.w / 2, Math.max(16, r.y - 14)); ctx.fillText("↓ 船尾・南", r.x + r.w / 2, Math.min(h - 6, r.y + r.h + 18));
    ctx.font = "10px system-ui"; ctx.fillStyle = "#ffffffbb";
    if (r.h > 120) { ctx.save(); ctx.translate(r.x - 4, r.y + r.h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("西端＝東端に接続", 0, 0); ctx.restore(); }
    syncText();
  }
  function handles(r) { return [["lt", r.x, r.y], ["t", r.x + r.w / 2, r.y], ["rt", r.x + r.w, r.y], ["r", r.x + r.w, r.y + r.h / 2], ["rb", r.x + r.w, r.y + r.h], ["b", r.x + r.w / 2, r.y + r.h], ["lb", r.x, r.y + r.h], ["l", r.x, r.y + r.h / 2]]; }

  // ------------------------------------------------------------ 山脈・富士山（酷道の選び方：一覧から選ぶ／地図で直接タップ）
  let terrainSel = "fuji", ridgesSrc = null;
  const ridgeKm = () => { if (!ridgesSrc) { const h = model.byId.get("honshu"); ridgesSrc = { sw: ShipTerrain.suggestRidge(h.ring, "sw"), ne: ShipTerrain.suggestRidge(h.ring, "ne") }; } return ridgesSrc; };
  const fujiKm = () => model.toKm(ShipTerrain.FUJI.lon, ShipTerrain.FUJI.lat);
  function terrainShapes() { // 船体座標の山脈線と富士山の点
    const sh = lay.shifts.get("honshu"), r = ridgeKm();
    return { sw: r.sw.map((q) => C.shipPoint(q, sh)), ne: r.ne.map((q) => C.shipPoint(q, sh)), fuji: C.shipPoint(fujiKm(), sh) };
  }
  function drawTerrainMarks(w, h, x0, x1) {
    const show = view.ridges || (editOpen && tab === "terrain"); if (!show) return;
    const T = terrainShapes(), W = lay.frame.w, kr = (lx, rx) => [Math.ceil((x0 - rx) / W), Math.floor((x1 - lx) / W)];
    for (const key of ["sw", "ne"]) {
      const pts = T[key], lx = Math.min(...pts.map((q) => q[0])), rx = Math.max(...pts.map((q) => q[0])), sel = terrainSel === key, [k0, k1] = kr(lx, rx);
      for (let k = k0; k <= k1; k++) { ctx.beginPath(); pts.forEach((q, i) => { const u = p2s(q[0] + k * W, q[1]); if (i) ctx.lineTo(u.x, u.y); else ctx.moveTo(u.x, u.y); }); ctx.strokeStyle = sel ? "#ffe066" : "#d79a5a"; ctx.lineWidth = sel ? 4 : 2; ctx.setLineDash(sel ? [] : [6, 4]); ctx.stroke(); ctx.setLineDash([]); }
    }
    const [k0, k1] = kr(T.fuji[0], T.fuji[0]);
    for (let k = k0; k <= k1; k++) { const u = p2s(T.fuji[0] + k * W, T.fuji[1]), sel = terrainSel === "fuji", r = sel ? 11 : 8; ctx.beginPath(); ctx.moveTo(u.x, u.y - r); ctx.lineTo(u.x + r, u.y + r * 0.8); ctx.lineTo(u.x - r, u.y + r * 0.8); ctx.closePath(); ctx.fillStyle = sel ? "#ffe066" : "#ffffffcc"; ctx.fill(); ctx.strokeStyle = "#5a3b12"; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  function pickTerrain(sx, sy) { // 画面座標 → 最も近い山脈線／富士山
    const T = terrainShapes(), W = lay.frame.w, wx = camera.x + (sx - canvas.clientWidth / 2) / camera.s, wy = camera.y - (sy - canvas.clientHeight / 2) / camera.s;
    const px = (d) => d * camera.s; let best = null, bd = 26;
    const kmod = (x, refx) => { const k = Math.round((wx - refx) / W); return x + k * W; };
    const fx = kmod(T.fuji[0], wx); { const d = px(Math.hypot(fx - wx, T.fuji[1] - wy)); if (d < bd) { bd = d; best = "fuji"; } }
    for (const key of ["sw", "ne"]) { const pts = T[key], k = Math.round((wx - pts[0][0]) / W); for (let i = 0; i + 1 < pts.length; i++) { const a = [pts[i][0] + k * W, pts[i][1]], b = [pts[i + 1][0] + k * W, pts[i + 1][1]], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; let t = l2 ? ((wx - a[0]) * dx + (wy - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); const d = px(Math.hypot(a[0] + t * dx - wx, a[1] + t * dy - wy)); if (d < bd) { bd = d; best = key; } } }
    return best;
  }
  const SEL_NAME = { fuji: "富士山", sw: "南西の山脈", ne: "北東の山脈" };
  function setTerrainSel(k) {
    terrainSel = k; for (const b of document.querySelectorAll("[data-sel]")) b.setAttribute("aria-pressed", String(b.dataset.sel === k));
    for (const q of HEIGHT_STEPPERS) if (q.sel) $("row-" + q.id).hidden = q.sel !== k;
    $("terrainSelName").textContent = "選択中：" + SEL_NAME[k]; render();
  }
  for (const b of document.querySelectorAll("[data-sel]")) b.addEventListener("click", () => setTerrainSel(b.dataset.sel));

  // ------------------------------------------------------------ text panels
  function syncText() {
    const m = met, ph = m.physics, s = state.ship;
    const popTxt = s.population >= 10000 ? (s.population / 10000).toLocaleString() + "万人" : s.population + "人";
    const cards = [
      [`${fmt(s.innerDiameterKm)} km`, "居住シリンダー内径 D"], [`${fmt(s.cylinderLengthKm)} km`, "居住シリンダー長 L"],
      [`${s.axisDiameterM} m`, `中心軸の直径（半径 ${s.axisDiameterM / 2} m）`], [popTxt, "人口"],
      [`${fmt(ph.circumferenceKm, 3)} km`, "円周 πD（東西に一周）"], [`${fmt(ph.areaKm2)} km²`, "内面積 πDL"],
      [`${Math.round(ph.density).toLocaleString()} 人/km²`, "平均人口密度（内面全体）"], [`${(s.cylinderLengthKm / s.innerDiameterKm).toFixed(2)} : 1`, "長さ／直径"],
      [`${fmt(m.landNetKm2)} km²`, `陸地（船体内・重複除く）${(m.landShare * 100).toFixed(1)}%`], [`${fmt(m.seaKm2)} km²`, "海面（船体内）"],
      [`${Number.isFinite(m.densityPerLandKm2) ? Math.round(m.densityPerLandKm2).toLocaleString() : "—"} 人/km²`, "陸地あたり人口密度"], [`${(ph.accel).toFixed(2)} m/s²`, `人工重力 ${s.gravityG}G（g=9.80665）`],
      [`${ph.rimSpeedMs.toFixed(1)} m/s`, `3G周速 v=√(3gR)（${(ph.rimSpeedMs * 3.6).toFixed(0)} km/h）`], [`${ph.omegaRadS.toFixed(4)} rad/s`, `角速度 ω=√(3g/R)`],
      [`${ph.rpm.toFixed(3)} rpm`, "回転数"], [`${ph.periodS.toFixed(1)} 秒`, "回転周期（物理値）"],
      [`${fmt(m.overlapKm2, 4)} km²`, `地形干渉 ${m.interferenceCount}か所（面積）`], [`${m.overhangIslands.length}島`, `はみ出し（南最大 ${fmt(m.overhangSouthKm)}km／北最大 ${fmt(m.overhangNorthKm)}km）`],
    ];
    $("metrics").innerHTML = cards.map(([a, b]) => `<div class="metric"><strong>${a}</strong><span>${b}</span></div>`).join("");
    const t = state.terrain, interOk = interKey === stateKey(), nm = (id) => model.byId.get(id).name || id;
    const iTxt = !interOk ? "地形干渉：計算中…" : inter.length ? `地形干渉（赤い面）：${inter.length}か所` : "地形干渉：なし";
    const oh = m.overhangIslands, ohS = oh.filter((o) => o.southKm > 1e-9), ohN = oh.filter((o) => o.northKm > 1e-9);
    const ohTxt = !oh.length ? "船体南北端からのはみ出し：なし" : `船体南北端からのはみ出し（橙）：南 ${ohS.length}島／北 ${ohN.length}島`;
    $("status").innerHTML = `<div class="${inter.length && interOk ? "warning" : "good"}">${iTxt}</div><div class="${oh.length ? "warning" : "good"}">${ohTxt}</div><small>列島 1/${t.japanScaleDenominator}・目盛 ${fmt(tick())}km</small>`;
    const row = (a, b, c) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`, more = (n, k) => (n > k ? `<tr><td colspan="3">ほか ${n - k} 件</td></tr>` : "");
    const I = inter.slice().sort((x, y) => y.areaKm2 - x.areaKm2), O = oh.slice(0, 14);
    $("overList").innerHTML = `<small class="muted">地形干渉の内訳（面積の大きい順）</small><table>${I.slice(0, 10).map((o) => row(nm(o.a), nm(o.b), (o.areaKm2 * 1e6).toFixed(0) + " m²" + (o.k ? "（周回）" : ""))).join("") || row("なし", "", "")}${more(I.length, 10)}</table>` +
      `<small class="muted">はみ出し（距離の大きい順）</small><table>${O.map((o) => row(o.name, o.southKm > 1e-9 ? "南" : "北", fmt(Math.max(o.southKm, o.northKm)) + " km")).join("") || row("なし", "", "")}${more(oh.length, 14)}</table>`;
    const ew = Object.entries(t.islandOffsetsKm), ns = Object.entries(t.islandOffsetsNorthKm || {});
    $("offsetInfo").textContent = (ew.length ? "個別東西補正：" + ew.map(([id, v]) => `${nm(id)} ${v > 0 ? "東" : "西"}へ${Math.abs(v * 1000).toFixed(0)}m`).join("、") : "個別東西補正なし。") + (ns.length ? " 個別南北補正：" + ns.map(([id, v]) => `${nm(id)} ${v > 0 ? "北" : "南"}へ${Math.abs(v).toFixed(2)}km`).join("、") : " 個別南北補正なし。") + "（原島座標は保持）";
    $("legacyNote").textContent = t.ogasawaraCompressionPercent > 0 ? `旧・小笠原追加圧縮 ${t.ogasawaraCompressionPercent}%（硫黄島基準）は保存データの互換のため保持。伊豆・小笠原の島列圧縮が0%の間だけ適用され、島列圧縮を使うと置き換わります（二重圧縮なし）。` : "";
  }
  function syncPresetLabel() { $("presetState").textContent = presetId === "custom" ? `カスタム案${customFrom ? "（" + customFrom + "から変更）" : ""}` : "選択案のまま"; }

  // ------------------------------------------------------------ camera
  function frameFit() { const f = lay.frame; camera.x = f.x; camera.y = f.y; camera.s = clamp(Math.min((canvas.clientWidth - 75) / f.w, (canvas.clientHeight - 80) / f.h), 0.0005, 3000); render(); }
  function viewFit() {
    const f = lay.frame; let x0 = f.x - f.w / 2, x1 = f.x + f.w / 2, y0 = f.y - f.h / 2, y1 = f.y + f.h / 2;
    for (const s of lay.islands) { x0 = Math.min(x0, s.bb.lx); x1 = Math.max(x1, s.bb.rx); y0 = Math.min(y0, s.bb.by); y1 = Math.max(y1, s.bb.ty); }
    camera.x = (x0 + x1) / 2; camera.y = (y0 + y1) / 2; camera.s = clamp(Math.min((canvas.clientWidth - 56) / (x1 - x0), (canvas.clientHeight - 85) / (y1 - y0)), 0.0005, 3000); render();
  }

  // ------------------------------------------------------------ gestures (pointer events; pinch with two fingers)
  const pointers = new Map(); let gesture = null;
  function hitTest(x, y) {
    const r = frameRect(); let best = Infinity, id = null;
    for (const [h, u, v] of handles(r)) { const d = Math.hypot(x - u, y - v); if (d < best) { best = d; id = h; } }
    if (best <= 28) return id;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return "move";
    return "pan";
  }
  const shipFrame = () => ({ x: state.ship.centerXKm, y: state.ship.centerYKm, w: Math.PI * state.ship.innerDiameterKm, h: state.ship.cylinderLengthKm });
  function setFrame(f) { state.ship.centerXKm = f.x; state.ship.centerYKm = f.y; state.ship.innerDiameterKm = f.w / Math.PI; state.ship.cylinderLengthKm = f.h; }
  function begin(p) { gesture = { type: p.hit, start: { ...p }, base: shipFrame(), cam: { ...camera } }; }
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect(), p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    p.hit = mode === "japan" ? "pan" : hitTest(p.x, p.y); pointers.set(e.pointerId, p);
    tapInfo = pointers.size === 1 ? { x: p.x, y: p.y, moved: false } : null;
    if (pointers.size === 1) begin(p);
    else if (pointers.size === 2) {
      const a = [...pointers.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
      gesture = { type: mode === "japan" || !a.some((q) => q.hit !== "pan") ? "view-pinch" : "frame-pinch", dist: d, mid: { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }, base: shipFrame(), cam: { ...camera } };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId); if (!p || !gesture) return; e.preventDefault();
    const rect = canvas.getBoundingClientRect(); p.x = e.clientX - rect.left; p.y = e.clientY - rect.top;
    if (tapInfo && Math.hypot(p.x - tapInfo.x, p.y - tapInfo.y) > 9) tapInfo.moved = true;
    const a = [...pointers.values()], g = gesture;
    if (a.length === 2 && g.dist) {
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, m = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }, q = clamp(d / g.dist, 0.01, 100);
      if (g.type === "frame-pinch") { setFrame({ w: clamp(g.base.w * q, 0.12, 3000), h: clamp(g.base.h * q, 0.12, 3000), x: g.base.x + (m.x - g.mid.x) / g.cam.s, y: g.base.y - (m.y - g.mid.y) / g.cam.s }); changed({ fast: true, custom: true }); }
      else {
        // keep the map point that was under the fingers' midpoint under it
        const W2 = canvas.clientWidth / 2, H2 = canvas.clientHeight / 2, wx = g.cam.x + (g.mid.x - W2) / g.cam.s, wy = g.cam.y - (g.mid.y - H2) / g.cam.s;
        camera.s = clamp(g.cam.s * q, 0.0001, 3000); camera.x = wx - (m.x - W2) / camera.s; camera.y = wy + (m.y - H2) / camera.s; render();
      }
    } else if (a.length === 1 && g.start) {
      const dx = (p.x - g.start.x) / g.cam.s, dy = -(p.y - g.start.y) / g.cam.s;
      if (g.type === "pan") { camera.x = g.cam.x - dx; camera.y = g.cam.y - dy; render(); return; }
      if (g.type === "move") { setFrame({ ...g.base, x: g.base.x + dx, y: g.base.y + dy }); changed({ fast: true, custom: true }); return; }
      // an edge handle changes only its own dimension; a corner changes both — never locked to the old aspect ratio
      let left = g.base.x - g.base.w / 2, right = g.base.x + g.base.w / 2, bottom = g.base.y - g.base.h / 2, top = g.base.y + g.base.h / 2; const min = 0.12;
      if (g.type.includes("l")) left = Math.min(left + dx, right - min);
      if (g.type.includes("r")) right = Math.max(right + dx, left + min);
      if (g.type.includes("t")) top = Math.max(top + dy, bottom + min);
      if (g.type.includes("b")) bottom = Math.min(bottom + dy, top - min);
      setFrame({ x: (left + right) / 2, y: (top + bottom) / 2, w: right - left, h: top - bottom }); changed({ fast: true, custom: true });
    }
  });
  const end = (e) => { if (tapInfo && !tapInfo.moved && e.type === "pointerup" && pointers.size === 1 && editOpen && tab === "terrain") { const k = pickTerrain(tapInfo.x, tapInfo.y); if (k) setTerrainSel(k); } if (e.type !== "pointermove") tapInfo = pointers.size > 1 ? null : tapInfo; pointers.delete(e.pointerId); gesture = null; if (pointers.size === 1) begin([...pointers.values()][0]); syncSteppers(); };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); camera.s = clamp(camera.s * Math.exp(-e.deltaY / 400), 0.0001, 3000); render(); }, { passive: false });

  // ------------------------------------------------------------ steppers (±1 and long-press repeat)
  const popFmt = (v) => (v >= 10000 ? (v / 10000).toLocaleString() + "万人" : v + "人");
  const STEPPERS = [
    { id: "diameter", grp: "hull", label: "居住シリンダー内径 D", get: () => state.ship.innerDiameterKm, set: (v) => { state.ship.innerDiameterKm = v; }, min: 0.1, max: 30, step: 0.01, fmt: (v) => v.toFixed(2) + " km" },
    { id: "length", grp: "hull", label: "居住シリンダー長 L", get: () => state.ship.cylinderLengthKm, set: (v) => { state.ship.cylinderLengthKm = v; }, min: 0.5, max: 300, step: 0.1, fmt: (v) => v.toFixed(2) + " km" },
    { id: "axis", grp: "hull", label: "中心軸の直径（非回転）", get: () => state.ship.axisDiameterM, set: (v) => { state.ship.axisDiameterM = v; }, min: 10, max: 1000, step: 10, fmt: (v) => v + " m（半径 " + v / 2 + " m）" },
    { id: "population", grp: "hull", label: "人口", get: () => state.ship.population, set: (v) => { state.ship.population = v; }, min: 100000, max: 100000000, step: 100000, fmt: popFmt },
    { id: "scale", grp: "common", label: "日本列島の縮尺（分母）", get: () => state.terrain.japanScaleDenominator, set: (v) => { state.terrain.japanScaleDenominator = Math.round(v); }, min: 3, max: 1000, step: 1, fmt: (v) => "1/" + v },
    { id: "tsushima", grp: "tsushima", label: "対馬を南へ（船体km）", get: () => state.terrain.tsushimaSouthKm, set: (v) => { state.terrain.tsushimaSouthKm = +v.toFixed(2); }, min: 0, max: 25, step: 0.1, fmt: (v) => v.toFixed(1) + " km" },
    { id: "island", grp: "kago", label: "琉球・小笠原 共通南北間隔", get: () => state.terrain.ryukyuSpacingPercent, set: (v) => { state.terrain.ryukyuSpacingPercent = Math.round(v); }, min: 10, max: 100, step: 1, fmt: (v) => v + "%" },
  ];
  const ROT_KEYS = ["izu", "ryukyu", "northern"];
  const ROT_STEPPERS = ROT_KEYS.map((k) => ({ id: "rot-" + k, grp: { izu: "izu", ryukyu: "kago", northern: "north" }[k], label: C.ROT_LABEL[k], get: () => state.terrain.rotationsDeg[k], set: (v) => { state.terrain.rotationsDeg[k] = v; }, min: -C.ROT_LIMITS[k], max: C.ROT_LIMITS[k], step: 1, fmt: (v) => (v > 0 ? "+" : "") + v + "°" }));
  const CHAIN_STEPPERS = [{ id: "chainRate", grp: "izu", label: "島と島の間隔の圧縮率", get: () => state.terrain.chainCompression.ratePercent, set: (v) => { state.terrain.chainCompression.ratePercent = v; }, min: 0, max: C.CHAIN_MAX_PERCENT, step: 1, fmt: (v) => v + "%（間隔×" + (1 - v / 100).toFixed(2) + "）" }];
  const HL = (k) => state.terrain.heightLayer[k];
  const denomNow = () => state.terrain.japanScaleDenominator, shipM = (realM) => (realM * 10 / denomNow() * HL("globalScale"));
  const HEIGHT_STEPPERS = [
    { id: "heightGlobal", grp: "height", label: "全地形の高さ倍率（基準＝10/N）", get: () => Math.round(HL("globalScale") * 100), set: (v) => { state.terrain.heightLayer.globalScale = v / 100; }, min: 0, max: 300, step: 5, fmt: (v) => "基準×" + (v / 100).toFixed(2) + (v === 100 ? "（基準）" : v > 100 ? "（+" + (v - 100) + "%）" : "（" + (v - 100) + "%）") },
    { id: "fujiSummit", grp: "sel", sel: "fuji", label: "富士山の頂の高さ（実世界の標高）", get: () => HL("fujiSummitM"), set: (v) => { state.terrain.heightLayer.fujiSummitM = v; }, min: 0, max: 6000, step: 10, fmt: (v) => `${v} m → 船内 ${shipM(v).toFixed(0)} m` },
    { id: "ridgeSw", grp: "sel", sel: "sw", label: "南西の山脈の盛り上げ", get: () => Math.round(HL("ridgeSwScale") * 100), set: (v) => { state.terrain.heightLayer.ridgeSwScale = v / 100; }, min: 0, max: 200, step: 5, fmt: (v) => v + "%" },
    { id: "ridgeNe", grp: "sel", sel: "ne", label: "北東の山脈の盛り上げ", get: () => Math.round(HL("ridgeNeScale") * 100), set: (v) => { state.terrain.heightLayer.ridgeNeScale = v / 100; }, min: 0, max: 200, step: 5, fmt: (v) => v + "%" },
  ];
  const ALL_STEPPERS = [...STEPPERS, ...ROT_STEPPERS, ...CHAIN_STEPPERS, ...HEIGHT_STEPPERS];
  const stepperHtml = (list) => list.map((s) => `<div id="row-${s.id}"><div class="row"><label for="st-${s.id}">${s.label}</label><b id="st-${s.id}-v"></b></div><div class="stepper"><button data-st="${s.id}" data-d="-1" aria-label="${s.label}を減らす">−</button><input id="st-${s.id}" type="range" min="${s.min}" max="${s.max}" step="${s.step}"><button data-st="${s.id}" data-d="1" aria-label="${s.label}を増やす">＋</button></div></div>`).join("");
  function buildSteppers() {
    for (const g of ["hull", "common", "north", "izu", "tsushima", "kago", "height", "sel"]) $("st-grp-" + g).innerHTML = stepperHtml(ALL_STEPPERS.filter((q) => q.grp === g));
    for (const s of ALL_STEPPERS) {
      $("st-" + s.id).addEventListener("input", (e) => apply(s, +e.target.value, true));
      $("st-" + s.id).addEventListener("change", () => changed());
    }
    for (const b of document.querySelectorAll("button[data-st]")) {
      const s = ALL_STEPPERS.find((x) => x.id === b.dataset.st), d = +b.dataset.d; let timer = null, rep = 0;
      const once = () => { rep++; const mult = rep > 25 ? 10 : 1; apply(s, s.get() + d * s.step * mult, true); };
      const stop = () => { if (timer !== null) { clearTimeout(timer); clearInterval(timer); timer = null; changed(); } rep = 0; };
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); stop(); once(); timer = setTimeout(() => { timer = setInterval(once, 80); }, 380); try { b.setPointerCapture(e.pointerId); } catch (_) {} });
      b.addEventListener("pointerup", stop); b.addEventListener("pointercancel", stop); b.addEventListener("lostpointercapture", stop);
      b.addEventListener("click", (e) => { if (e.detail === 0) { once(); changed(); } });
    }
  }
  function apply(s, v, fast) { const q = Math.round(clamp(v, s.min, s.max) / s.step) * s.step; s.set(+q.toFixed(6)); syncSteppers(); changed({ fast, custom: true }); }
  function syncSteppers() { for (const s of ALL_STEPPERS) { $("st-" + s.id).value = s.get(); $(`st-${s.id}-v`).textContent = s.fmt(s.get()); } syncToggles(); syncGeoInfo(); }

  // ------------------------------------------------------------ toggles, presets, modes
  function syncToggles() {
    for (const b of document.querySelectorAll("[data-region]")) b.setAttribute("aria-pressed", String(!state.terrain.hiddenRegions.includes(b.dataset.region)));
    $("chainOshima").setAttribute("aria-pressed", String(state.terrain.chainCompression.mode === "oshima")); $("chainMinami").setAttribute("aria-pressed", String(state.terrain.chainCompression.mode === "minamiiwo"));
    for (const b of document.querySelectorAll("[data-toggle]")) b.setAttribute("aria-pressed", String(!!state.terrain[b.dataset.toggle]));
    for (const b of document.querySelectorAll("[data-view-toggle]")) b.setAttribute("aria-pressed", String(!!view[b.dataset.viewToggle]));
  }
  for (const b of document.querySelectorAll("[data-toggle]")) b.addEventListener("click", () => { state.terrain[b.dataset.toggle] = !state.terrain[b.dataset.toggle]; syncToggles(); changed({ custom: true }); });
  for (const b of document.querySelectorAll("[data-view-toggle]")) b.addEventListener("click", () => { view[b.dataset.viewToggle] = !view[b.dataset.viewToggle]; syncToggles(); dirty3d = true; render(); listeners.forEach((f) => f()); });
  for (const b of document.querySelectorAll("[data-region]")) b.addEventListener("click", () => { const h = state.terrain.hiddenRegions, r = b.dataset.region, i = h.indexOf(r); if (i >= 0) h.splice(i, 1); else h.push(r); syncToggles(); changed({ custom: true }); });
  $("chainOshima").onclick = () => { state.terrain.chainCompression.mode = "oshima"; syncSteppers(); changed({ custom: true }); };
  $("chainMinami").onclick = () => { state.terrain.chainCompression.mode = "minamiiwo"; syncSteppers(); changed({ custom: true }); };
  $("resetHeight").onclick = () => { state.terrain.heightLayer = Object.assign({}, ShipTerrain.DEFAULT_LAYER); syncSteppers(); changed({ custom: true }); $("feedback").textContent = "高さの変更を元に戻しました（元の標高データは変更していません）。"; };
  // 地理補正・地形の説明（現在値を平易に表示）
  function syncGeoInfo() {
    if (!lay) return; const t = state.terrain, nm = (id) => model.byId.get(id).name || id, d = t.japanScaleDenominator;
    $("rotInfo").innerHTML = ROT_KEYS.map((k) => { const r = model.rot[k]; return `${C.ROT_LABEL[k]}：支点＝${r.pivotName}、${t.rotationsDeg[k]}°、対象 ${r.ids.size}島` + (k === "izu" ? "（東京都本土は回転しない）" : k === "ryukyu" ? "（九州本土・種子島・屋久島は回転しない）" : "（北海道本島は回転しない）"); }).join("<br>");
    const cc = t.chainCompression, fixed = cc.mode === "oshima" ? model.chain.first : model.chain.last;
    $("chainInfo").textContent = `対象：${nm(model.chain.first)}〜${nm(model.chain.last)}の島列 ${model.chain.ids.length}島。固定端＝${nm(fixed)}、${cc.mode === "oshima" ? "南の島が伊豆大島へ近づく" : "北の島が南硫黄島へ近づく"}、圧縮率 ${cc.ratePercent}%。適用順：回転 → 従来の琉球・小笠原間隔／硫黄島基準追加圧縮 → 本圧縮（旧い保存データは0%＝二重圧縮なし）。`;
    const chk = ShipTerrain.checkFuji(model, t.heightLayer);
    $("heightIntro").textContent = `基準：水平は実世界の 1/${d}、標高は同じ縮尺の10倍＝実物の ${10}/${d}。富士山 3776m は基準で ${(3776 * 10 / d).toFixed(0)}m。「全地形の高さ倍率」はこの基準からの増減（1.00＝基準）で、山脈・富士山の個別調整とは別の値です。元の標高データは変更せず、補正値として保存します。`;
    $("heightInfo").textContent = `富士山の頂：船内 ${(t.heightLayer.fujiSummitM * 10 / d * t.heightLayer.globalScale).toFixed(0)}m（全体倍率込み）。裾野の範囲は本州内${chk.ok ? "に収まっています" : "に収まっていません（酷道の制約：面積1.2倍の外形が海岸から1km以上内側）"}（海岸まで最小 ${chk.minClearanceKm.toFixed(1)}km）。山脈は酷道と同じ自動提案線（本州の長軸に沿う2本）。富士山の回転は廃止しました。`;
    const AXM = state.ship.axisDiameterM, r = AXM / 2; $("axisInfo").textContent = `中心軸：直径 ${AXM}m（半径 ${r}m）・非回転・軸上照明を搭載する想定。居住内面は半径 ${state.ship.innerDiameterKm / 2}km（内径 ${state.ship.innerDiameterKm}km）で、3Gの周速・角速度は居住内面の半径で計算します。`;
    drawSection();
  }
  function drawSection() {
    const c = $("section2d"), g = c.getContext("2d"), W = c.width, cx = W / 2, R = W * 0.4, k = R / (state.ship.innerDiameterKm / 2), ra = (state.ship.axisDiameterM / 2000) * k;
    g.clearRect(0, 0, W, W); g.fillStyle = "#0b2435"; g.fillRect(0, 0, W, W);
    g.strokeStyle = "#7fd3e6"; g.lineWidth = 2; g.beginPath(); g.arc(cx, cx, R, 0, 7); g.stroke();
    g.fillStyle = "#fff6c8"; g.beginPath(); g.arc(cx, cx, Math.max(ra, 1.5), 0, 7); g.fill(); // 中心軸：同じ縮尺で描く（実寸なので小さい）
    g.fillStyle = "#cfe8ee"; g.font = "11px system-ui"; g.textAlign = "center";
    g.fillText(`居住内面 半径${state.ship.innerDiameterKm / 2}km（内径${state.ship.innerDiameterKm}km）`, cx, cx - R - 8); g.fillText(`中心軸 直径${state.ship.axisDiameterM}m（同縮尺）`, cx, cx + 20);
    g.strokeStyle = "#fff6c8"; g.beginPath(); g.moveTo(cx, cx + 4); g.lineTo(cx, cx + 10); g.stroke();
  }
  // 3D用：標高グリッドは「他の島」を1回、本州は地形変更レイヤーごとに作る
  let demPack = null, gridCache = { others: null, honshu: null, key: "" };
  function terrainPack() {
    if (!demPack) demPack = ShipTerrain.decodeDem(window.SHIP_DEM);
    const layer = ShipTerrain.normalizeLayer(state.terrain.heightLayer), key = JSON.stringify(layer);
    if (!gridCache.others) gridCache.others = ShipTerrain.buildGrids(model, demPack, layer, (i) => i.id !== "honshu").grids;
    if (gridCache.key !== key) { gridCache.honshu = ShipTerrain.buildGrids(model, demPack, layer, (i) => i.id === "honshu"); gridCache.key = key; }
    const grids = new Map(gridCache.others); for (const [k, v] of gridCache.honshu.grids) grids.set(k, v);
    return { grids, layer };
  }
  function heightSampler() { const p = terrainPack(); return ShipTerrain.makeShipSampler(C, lay, p.grids, model, p.layer); }
  const psel = $("preset");
  psel.appendChild(new Option("カスタム案（手動調整中）", "custom"));
  for (const p of C.presetList()) psel.appendChild(new Option(p.name, p.id));
  function applyPreset(id) { state = C.presetState(model, id); presetId = id; customFrom = null; psel.value = id; syncPresetLabel(); syncSteppers(); recompute(true); frameFit(); changed(); $("feedback").textContent = `適用：${state.sourcePreset}（内径 ${fmt(state.ship.innerDiameterKm)}km・長さ ${fmt(state.ship.cylinderLengthKm)}km）`; }
  psel.addEventListener("change", () => { if (psel.value !== "custom") applyPreset(psel.value); });
  function setMode(m) { mode = m; pointers.clear(); gesture = null; $("modeCylinder").setAttribute("aria-pressed", String(m === "cylinder")); $("modeJapan").setAttribute("aria-pressed", String(m === "japan")); $("panel").dataset.mode = m; render(); }
  // 3ボタンは常時表示。3D表示中に操作モードを押したら、そのモードで2Dへ戻る（設定は一切変えない）。
  $("modeCylinder").onclick = () => { setMode("cylinder"); if (current !== "2d") setCurrent("2d"); };
  $("modeJapan").onclick = () => { setMode("japan"); if (current !== "2d") setCurrent("2d"); };
  // 編集メニュー：開閉しても船体案・設定値は変えない。5タブ＋選択タブの内容だけを出し入れする。
  function setEdit(open) { editOpen = open; $("editor").hidden = !open; $("btnEdit").setAttribute("aria-expanded", String(open)); render(); if (window.Ship3D && current !== "2d") Ship3D.resize(); }
  function setTab(t) { tab = t; for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === t)); for (const p of document.querySelectorAll(".tabpane")) p.hidden = p.dataset.pane !== t; $("editBody").scrollTop = 0; if (t === "layout" || t === "terrain") syncSteppers(); if (t === "data") syncText(); render(); }
  $("btnEdit").onclick = () => setEdit(!editOpen);
  for (const b of document.querySelectorAll("#tabs button")) b.addEventListener("click", () => setTab(b.dataset.tab));
  if (window.ResizeObserver) new ResizeObserver(() => { render(); if (window.Ship3D && current !== "2d") Ship3D.resize(); }).observe($("panel"));
  $("fit").onclick = () => (current === "2d" ? viewFit() : window.Ship3D && Ship3D.setView(current));
  $("resetView").onclick = () => (current === "2d" ? frameFit() : window.Ship3D && Ship3D.setView(current));
  $("resetAll").onclick = () => { setMode("cylinder"); applyPreset("adopted"); $("feedback").textContent = "採用基準案に戻しました（保存済みの案は消していません）。"; };
  $("fixRyukyu").onclick = () => {
    const r = C.resolveRyukyu(model, state); state = r.state; markCustom(); syncSteppers(); changed();
    $("feedback").textContent = r.moved.length ? `南西諸島 ${r.moved.length}島を東西に最小移動しました。` : "南西諸島に重なりはありません（補正なし）。";
  };
  $("clearOffsets").onclick = async () => { if (!Object.keys(state.terrain.islandOffsetsKm).length && !Object.keys(state.terrain.islandOffsetsNorthKm).length) return; if (!(await ask("個別の東西・南北補正をすべて消しますか？"))) return; state.terrain.islandOffsetsKm = {}; state.terrain.islandOffsetsNorthKm = {}; changed({ custom: true }); };

  // ------------------------------------------------------------ save / load
  const STORE = "kasoku-ship-designer-v10-saves";
  let stored = [];
  try { const p = JSON.parse(localStorage.getItem(STORE) || "[]"); if (Array.isArray(p)) stored = p; } catch (_) {}
  function persist() { try { localStorage.setItem(STORE, JSON.stringify(stored)); return true; } catch (_) { $("feedback").textContent = "端末内保存が使えません。JSON出力を使ってください。"; return false; } }
  function renderSaved() {
    const old = $("saved").value; $("saved").innerHTML = '<option value="">保存済みの案（選ぶと即反映）</option>';
    stored.forEach((s, i) => $("saved").appendChild(new Option(`${s.name}（${(+s.ship.innerDiameterKm).toFixed(2)}×${(+s.ship.cylinderLengthKm).toFixed(1)}km）`, String(i))));
    $("saved").value = old && stored[+old] ? old : "";
  }
  const snapshot = (name) => { recompute(true); return C.serializeState(Object.assign(C.cloneState(state), { name, createdAt: new Date().toISOString() }), model, { sourcePreset: presetId === "custom" ? `カスタム案（${customFrom || "手動"}）` : state.sourcePreset,
    report: { overhangs: met.overhangIslands.map((o) => ({ id: o.id, name: o.name, southKm: +o.southKm.toFixed(4), northKm: +o.northKm.toFixed(4) })), interference: inter.map((o) => ({ a: o.a, b: o.b, wrap: o.k, areaKm2: +o.areaKm2.toFixed(6) })), interferenceAreaKm2: +met.overlapKm2.toFixed(6), landNetKm2: +met.landNetKm2.toFixed(3) } }); };
  function loadDesign(d, label) { state = C.normalizeState(d, model); presetId = "custom"; customFrom = label || d.name || "読込"; psel.value = "custom"; syncPresetLabel(); syncSteppers(); recompute(true); frameFit(); changed(); }
  $("save").onclick = async () => {
    const name = $("saveName").value.trim(); if (!name) { $("feedback").textContent = "保存名を入力してください。"; return; }
    const i = stored.findIndex((s) => s.name === name);
    if (i >= 0 && !(await ask(`「${name}」は保存済みです。上書きしますか？`, { ok: "上書きする" }))) return;
    const s = snapshot(name); if (i >= 0) stored[i] = s; else stored.push(s);
    if (persist()) { renderSaved(); $("saved").value = String(i >= 0 ? i : stored.length - 1); $("feedback").textContent = `「${name}」を保存しました。`; }
  };
  $("saved").addEventListener("change", () => { const i = $("saved").value; if (i === "" || !stored[+i]) return; try { loadDesign(stored[+i], stored[+i].name); $("saveName").value = stored[+i].name; $("feedback").textContent = `「${stored[+i].name}」を反映しました。`; } catch (e) { $("feedback").textContent = e.message; } });
  $("renameSaved").onclick = async () => {
    const i = $("saved").value; if (i === "" || !stored[+i]) { $("feedback").textContent = "名前を変える案を選んでください。"; return; }
    const nn = ((await ask("新しい名前", { input: stored[+i].name, ok: "変更" })) || "").trim(); if (!nn || nn === stored[+i].name) return;
    if (stored.some((s, k) => k !== +i && s.name === nn)) { $("feedback").textContent = "同じ名前の案があります。別の名前にしてください。"; return; }
    stored[+i].name = nn; if (persist()) { renderSaved(); $("saved").value = i; $("feedback").textContent = `名前を「${nn}」に変更しました。`; }
  };
  $("deleteSaved").onclick = async () => { const i = $("saved").value; if (i === "" || !stored[+i]) return; if (!(await ask(`「${stored[+i].name}」を削除しますか？（出力済みJSONは残ります）`, { ok: "削除する" }))) return; stored.splice(+i, 1); if (persist()) { renderSaved(); $("feedback").textContent = "削除しました。"; } };
  // File save where the browser allows it; the JSON is always also shown with a copy button (some viewers block downloads).
  function download(obj, filename) {
    const text = JSON.stringify(obj, null, 2);
    try { const blob = new Blob([text], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000); } catch (_) {}
    $("jsonOut").value = text; $("jsonBox").hidden = false; $("jsonName").textContent = filename;
  }
  $("copyJson").onclick = async () => { try { await navigator.clipboard.writeText($("jsonOut").value); $("feedback").textContent = "JSONをコピーしました。"; } catch (_) { $("jsonOut").select(); $("feedback").textContent = "全選択しました。長押しでコピーしてください。"; } };
  $("closeJson").onclick = () => { $("jsonBox").hidden = true; };
  /** In-page confirm / prompt (native dialogs are unavailable in some viewers). Resolves true/false, or the text. */
  function ask(message, o) {
    o = o || {};
    return new Promise((resolve) => {
      $("askMsg").textContent = message; const inp = $("askInput"); inp.hidden = o.input === undefined; inp.value = o.input || "";
      $("askOk").textContent = o.ok || "OK"; $("ask").hidden = false; (o.input === undefined ? $("askOk") : inp).focus();
      const done = (v) => { $("ask").hidden = true; $("askOk").onclick = $("askCancel").onclick = null; resolve(v); };
      $("askOk").onclick = () => done(o.input === undefined ? true : inp.value); $("askCancel").onclick = () => done(o.input === undefined ? false : null);
    });
  }
  const today = () => new Date().toISOString().slice(0, 10);
  $("export").onclick = () => { download(snapshot($("saveName").value.trim() || "名称未設定"), `kasoku-ship-${today()}.json`); $("feedback").textContent = "現在の案をJSONで出力しました。"; };
  $("exportAll").onclick = () => { download({ schema: "kasoku-ship-designs", schemaVersion: C.SCHEMA_VERSION, exportedAt: new Date().toISOString(), designs: stored, current: snapshot($("saveName").value.trim() || "現在の案") }, `kasoku-ship-all-${today()}.json`); $("feedback").textContent = `保存済み${stored.length}案と現在の案を出力しました。`; };
  function importBundle(data) {
    const list = data.designs.filter((s) => s && s.ship && s.terrain); let added = 0, renamed = 0;
    for (const s of list) { let name = s.name || "名称未設定"; if (stored.some((t) => t.name === name)) { let n = 2; while (stored.some((t) => t.name === `${name} (${n})`)) n++; name = `${name} (${n})`; renamed++; } stored.push(Object.assign({}, s, { name })); added++; }
    persist(); renderSaved(); return { added, renamed };
  }
  $("load").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if ((data.schema === "kasoku-world-cylinder-designs" || data.schema === "kasoku-ship-designs") && Array.isArray(data.designs)) {
        const r = importBundle(data); if (data.current) loadDesign(data.current, "一括ファイル");
        $("feedback").textContent = `${r.added}案を追加しました${r.renamed ? `（同名${r.renamed}案は番号を付けて別保存、上書きなし）` : ""}。`;
      } else { loadDesign(data, data.name); $("feedback").textContent = `${data.version === 9 ? "旧v9形式" : "設定"}を読み込みました。残すには名前を付けて保存してください。`; }
    } catch (err) { $("feedback").textContent = "読み込み失敗：" + err.message; }
    e.target.value = "";
  });

  // ------------------------------------------------------------ static info
  function prefTable() {
    const d = state.terrain.japanScaleDenominator;
    $("prefTable").innerHTML = `<small class="muted">面積は生成府県境（酷道と同方式）による参考値。船内面積＝実面積÷${d}²。文化・県民性は未設定（次工程）。</small><table><tr><th>府県</th><th>県庁</th><th>実 km²</th><th>船内 km²</th></tr>` +
      model.prefectures.map((p) => `<tr><td>${p.name}</td><td>${p.capital}</td><td>${p.areaKm2.toLocaleString()}</td><td>${(p.areaKm2 / (d * d)).toFixed(2)}</td></tr>`).join("") + "</table>";
  }
  $("prefDetails").addEventListener("toggle", prefTable);
  $("sources").innerHTML = SHIP_GEO.sources.map((s) => `<div>・${s.use}：${s.name}（${s.license}）</div>`).join("") +
    `<div>・府県境：${SHIP_GEO.prefectureBorders.method}。実在の県境ではなく酷道世界の府県（北海道は3県を1つに再統合した47都道府県）。北方領土・竹島の輪郭はNatural Earthの日本側視点データで、領有判断を意味しない。</div><div>・小島${model.islands.filter((s) => s.source === "schematic").length}島は位置のみの模式形（実形状データなし）。沖ノ鳥島も模式形。</div><div>・データ版：${SHIP_GEO.schema} v${SHIP_GEO.version}（${SHIP_GEO.builtAt}）</div>`;

  // ------------------------------------------------------------ view switching (2D / 3D)
  function setCurrent(v) {
    current = v;
    for (const b of document.querySelectorAll("#views button")) b.setAttribute("aria-pressed", String(b.dataset.view === v));
    const is2d = v === "2d";
    canvas.hidden = !is2d; $("view3d").hidden = is2d; $("labels3d").hidden = is2d;
    if (is2d) { if (window.Ship3D) Ship3D.pause(); render(); }
    else if (window.Ship3D) Ship3D.show(v);
    else $("feedback").textContent = "3D表示の部品（three.js）を読み込めませんでした。通信状態を確認してください。2D設計は使えます。";
  }
  for (const b of document.querySelectorAll("#views button")) b.addEventListener("click", () => setCurrent(b.dataset.view));
  window.addEventListener("resize", () => { render(); });

  // public surface for the 3D view and for tests
  window.ShipApp = {
    get terrainSel() { return terrainSel; }, terrainScreen(key) { const T = terrainShapes(), w = lay.frame.w; let q = key === "fuji" ? T.fuji : T[key][Math.floor(T[key].length / 2)]; const x = q[0] + Math.round((camera.x - q[0]) / w) * w, u = p2s(x, q[1]), r = canvas.getBoundingClientRect(); return [r.left + u.x, r.top + u.y]; },
    model, get state() { return state; }, get layout() { return lay; }, get interference() { return inter; }, get metrics() { return met; }, get view() { return view; },
    heightSampler, terrainPack, get dirty3d() { return dirty3d; }, clean3d() { dirty3d = false; }, onChange(f) { listeners.push(f); },
    setState(s) { loadDesign(s, "テスト"); }, applyPreset, setCurrent, get presetId() { return presetId; }, get camera() { return camera; }, get mode() { return mode; },
    frameRect: () => frameRect(), flush() { recompute(true); draw(); },
  };
  const stubBtn = (t, why) => `<button disabled title="${why}">${t}（${why}）</button>`;
  $("stubTerrain").innerHTML = ["海岸線：常に表示", "標高：3Dで表示"].map((t) => `<button disabled style="opacity:1;border-style:solid">${t}</button>`).join("") + stubBtn("河川", "未整備") + stubBtn("湖", "未整備");
  $("stubTraffic").innerHTML = ["高速道路", "一般道路", "新幹線・リニア", "一般鉄道", "計画・工事中・中断", "未成", "廃線・廃道", "建設計画・未成線", "港湾", "空港", "路線番号標識", "都市の丸・都市圏", "路線名の文字"].map((t) => stubBtn(t, "未整備")).join("");
  buildSteppers(); syncSteppers(); setTerrainSel("fuji"); setTab("view"); setMode("cylinder"); renderSaved(); syncPresetLabel(); psel.value = presetId;
  recompute(true);
  requestAnimationFrame(() => { frameFit(); syncText(); });
})();
