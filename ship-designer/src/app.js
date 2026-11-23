// 2D design screen + shared state. The 3D view (view3d.js) reads the same state through ShipApp.
(function () {
  "use strict";
  const C = window.ShipCore, $ = (id) => document.getElementById(id);
  const model = C.buildModel(window.SHIP_GEO, window.SHIP_EXTRA);
  const canvas = $("map"), ctx = canvas.getContext("2d");
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fmt = (n, d) => (Math.abs(n) >= 100 ? n.toFixed(d === undefined ? 0 : Math.min(d, 1)) : Math.abs(n) >= 10 ? n.toFixed(d === undefined ? 1 : d) : n.toFixed(d === undefined ? 2 : d));

  let state = C.presetState(model, "current");
  let presetId = "current", customFrom = null; // customFrom: preset name the manual edits started from
  let editOpen = false, tab = "view", tapInfo = null;
  // 表示レイヤーは船体案と一緒に保存・復元されるので state.layers を直接読み書きする
  const view = new Proxy({}, { get: (_, k) => state.layers[k], set: (_, k, v) => { state.layers[k] = v; return true; } });
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
    render(); syncText(); scheduleTerrain();
    listeners.forEach((f) => f());
  }

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
    const tOk = terrainReady(); if (tOk) { ctx.imageSmoothingEnabled = true; ctx.drawImage(terrainImg.canvas, r.x, r.y, r.w, r.h); } else scheduleTerrain();
    const winH = { low: f.x - f.w / 2, high: f.x + f.w / 2, south: Math.max(y0, f.y - f.h / 2), north: Math.min(y1, f.y + f.h / 2) };
    ShipDraw.paintMap(ctx, lay, inter, T, winH,
      { landFill: !tOk, borders: view.borders, cities: view.cities, cityNames: view.cities && !view.names && camera.s > 9, interference: view.interference && interKey === stateKey(), symbols: view.symbols, minOverlapPx: 2 });
    ShipLayers.paint(ctx, lay, layerData(), T, winH, layerOpts(11));
    ctx.setLineDash([3, 4]); ctx.strokeStyle = "#a5d4e155"; ctx.lineWidth = 0.7;
    for (let x = Math.ceil((f.x - f.w / 2) / st) * st; x <= f.x + f.w / 2; x += st) { const u = p2s(x, 0); ctx.beginPath(); ctx.moveTo(u.x, r.y); ctx.lineTo(u.x, r.y + r.h); ctx.stroke(); }
    ctx.setLineDash([]); ctx.restore();
    drawTerrainMarks(w, h, x0, x1);
    // hull frame + handles
    ctx.strokeStyle = "#ffda92"; ctx.lineWidth = 2.3; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([6, 5]); ctx.strokeStyle = "#ffffffaa"; ctx.lineWidth = 1.2;
    for (const X of [r.x, r.x + r.w]) { ctx.beginPath(); ctx.moveTo(X, r.y); ctx.lineTo(X, r.y + r.h); ctx.stroke(); }
    ctx.setLineDash([]);
    // 四隅・辺中央のつまみは常時は描かない（タッチ判定だけ残す）。使用中のつまみだけ微弱に強調する。
    if (gesture && gesture.type && gesture.type.length <= 2 && gesture.type !== "move" && gesture.type !== "pan") { const h = handles(r).find((q) => q[0] === gesture.type); if (h) { ctx.beginPath(); ctx.arc(h[1], h[2], 16, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,220,151,0.22)"; ctx.fill(); ctx.strokeStyle = "rgba(255,236,190,0.6)"; ctx.lineWidth = 1.5; ctx.stroke(); } }
    ctx.fillStyle = "#f3f4eb"; ctx.font = "12px system-ui"; ctx.textAlign = "center";
    ctx.fillText("↑ 船首・北", r.x + r.w / 2, Math.max(16, r.y - 14)); ctx.fillText("↓ 船尾・南", r.x + r.w / 2, Math.min(h - 6, r.y + r.h + 18));
    ctx.font = "10px system-ui"; ctx.fillStyle = "#ffffffbb";
    if (r.h > 120) { ctx.save(); ctx.translate(r.x - 4, r.y + r.h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("西端＝東端に接続", 0, 0); ctx.restore(); }
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
  function terrainSelSync() { setTerrainSel(terrainSel); }
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
    const pp = pops(), nt = network(), top = pp.munis.slice().sort((a, b) => b.pop - a.pop).slice(0, 8), pf = [...pp.prefFrame].sort((a, b) => b[1] - a[1]).slice(0, 5), pn = (id) => model.prefectures.find((q) => q.id === id).name;
    $("popInfo").innerHTML = `<div><b>${pp.source === "provisional" ? "暫定配分" : pp.source === "imported" ? "読み込んだ県別人口枠" : "一部のみ読込（残りは暫定）"}</b>：${pp.params.status}</div><div>県別枠の合計 ${(pp.frameTotal / 10000).toLocaleString(undefined, { maximumFractionDigits: 0 })}万人／船体人口 ${(state.ship.population / 10000).toLocaleString()}万人／差 ${(pp.diff / 10000).toFixed(1)}万人（比例補正はしません）</div><div>県内配分＝市町村の面積×可住面積比×種別係数×拠点都市ブースト（暫定値）。確定設定の県別人口枠のJSONを読み込むと置き換わります。</div>`;
    $("popTop").innerHTML = `<table>${pf.map(([id, v]) => `<tr><td>${pn(id)}</td><td></td><td>${(v / 10000).toFixed(0)}万人</td></tr>`).join("")}${top.map((m) => `<tr><td>${m.n}</td><td>${pn(m.p)}</td><td>${(m.pop / 10000).toFixed(0)}万人</td></tr>`).join("")}</table>`;
    $("netInfo").innerHTML = `鉄道（リニア）：${nt.stats.railEdges}区間・実距離${nt.stats.railKm.toFixed(0)}km（船内 ${(nt.stats.railKm / t.japanScaleDenominator).toFixed(1)}km）／道路：${nt.stats.roadEdges}区間（幹線 ${nt.stats.trunkKm.toFixed(0)}km・地方 ${nt.stats.localKm.toFixed(0)}km）／拠点 ${nt.stats.hubs}（県庁＋大都市）。人口配分を変えると自動で再設計されます。`;
    $("legacyNote").textContent = t.ogasawaraCompressionPercent > 0 ? `旧・小笠原追加圧縮 ${t.ogasawaraCompressionPercent}%（硫黄島基準）は保存データの互換のため保持。伊豆・小笠原の島列圧縮が0%の間だけ適用され、島列圧縮を使うと置き換わります（二重圧縮なし）。` : "";
  }

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
    { id: "diameter", grp: "hull", label: "居住シリンダー内径 D", get: () => state.ship.innerDiameterKm, set: (v) => { state.ship.innerDiameterKm = v; }, min: 0.5, max: 30, step: 0.1, note: "0.1km刻み", fmt: (v) => v.toFixed(1) + " km" },
    { id: "length", grp: "hull", label: "居住シリンダー長 L", get: () => state.ship.cylinderLengthKm, set: (v) => { state.ship.cylinderLengthKm = v; }, min: 0.5, max: 300, step: 0.1, note: "0.1km刻み", fmt: (v) => v.toFixed(1) + " km" },
    { id: "axis", grp: "hull", label: "中心軸の直径（非回転）", get: () => state.ship.axisDiameterM, set: (v) => { state.ship.axisDiameterM = v; }, min: 10, max: 1000, step: 10, note: "10m刻み", fmt: (v) => v + " m（半径 " + v / 2 + " m）" },
    { id: "population", grp: "hull", label: "人口", get: () => state.ship.population, set: (v) => { state.ship.population = v; }, min: 100000, max: 100000000, step: 100000, note: "10万人刻み", fmt: popFmt },
    { id: "scale", grp: "common", label: "日本列島の縮尺（分母）", get: () => state.terrain.japanScaleDenominator, set: (v) => { state.terrain.japanScaleDenominator = Math.round(v); }, min: 3, max: 1000, step: 1, note: "分母を1刻み", fmt: (v) => "1/" + v },
    { id: "tsushima", grp: "tsushima", label: "対馬を南へ（船体km）", get: () => state.terrain.tsushimaSouthKm, set: (v) => { state.terrain.tsushimaSouthKm = +v.toFixed(2); }, min: 0, max: 25, step: 0.1, note: "0.1km刻み", fmt: (v) => v.toFixed(1) + " km" },
    { id: "island", grp: "kago", label: "琉球・小笠原 共通南北間隔", get: () => state.terrain.ryukyuSpacingPercent, set: (v) => { state.terrain.ryukyuSpacingPercent = Math.round(v); }, min: 10, max: 100, step: 1, note: "1%刻み", fmt: (v) => v + "%" },
  ];
  const ROT_KEYS = ["izu", "ryukyu", "northern"];
  const ROT_STEPPERS = ROT_KEYS.map((k) => ({ id: "rot-" + k, grp: { izu: "izu", ryukyu: "kago", northern: "north" }[k], label: C.ROT_LABEL[k], get: () => state.terrain.rotationsDeg[k], set: (v) => { state.terrain.rotationsDeg[k] = v; }, min: -C.ROT_LIMITS[k], max: C.ROT_LIMITS[k], step: 1, note: "1°刻み", fmt: (v) => (v > 0 ? "+" : "") + v + "°" }));
  const CHAIN_STEPPERS = [{ id: "chainRate", grp: "izu", label: "島と島の間隔の圧縮率", get: () => state.terrain.chainCompression.ratePercent, set: (v) => { state.terrain.chainCompression.ratePercent = v; }, min: 0, max: C.CHAIN_MAX_PERCENT, step: 1, note: "1%刻み", fmt: (v) => v + "%（間隔×" + (1 - v / 100).toFixed(2) + "）" }];
  const HL = (k) => state.terrain.heightLayer[k];
  const denomNow = () => state.terrain.japanScaleDenominator, shipM = (realM) => (realM * 10 / denomNow() * HL("globalScale"));
  const HEIGHT_STEPPERS = [
    { id: "heightGlobal", grp: "height", label: "全地形の高さ倍率（基準＝10/N）", get: () => Math.round(HL("globalScale") * 100), set: (v) => { state.terrain.heightLayer.globalScale = v / 100; }, min: 0, max: 300, step: 5, note: "5%刻み", fmt: (v) => "基準×" + (v / 100).toFixed(2) + (v === 100 ? "（基準）" : v > 100 ? "（+" + (v - 100) + "%）" : "（" + (v - 100) + "%）") },
    { id: "fujiSummit", grp: "sel", sel: "fuji", label: "富士山の頂の高さ（実世界の標高）", get: () => HL("fujiSummitM"), set: (v) => { state.terrain.heightLayer.fujiSummitM = v; }, min: 0, max: 6000, step: 10, note: "10m刻み", fmt: (v) => `${v} m → 船内 ${shipM(v).toFixed(0)} m` },
    { id: "ridgeSw", grp: "sel", sel: "sw", label: "南西の山脈の盛り上げ", get: () => Math.round(HL("ridgeSwScale") * 100), set: (v) => { state.terrain.heightLayer.ridgeSwScale = v / 100; }, min: 0, max: 200, step: 5, note: "5%刻み", fmt: (v) => v + "%" },
    { id: "ridgeNe", grp: "sel", sel: "ne", label: "北東の山脈の盛り上げ", get: () => Math.round(HL("ridgeNeScale") * 100), set: (v) => { state.terrain.heightLayer.ridgeNeScale = v / 100; }, min: 0, max: 200, step: 5, note: "5%刻み", fmt: (v) => v + "%" },
  ];
  const ALL_STEPPERS = [...STEPPERS, ...ROT_STEPPERS, ...CHAIN_STEPPERS, ...HEIGHT_STEPPERS];
  const MINUS = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>', PLUS = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14M12 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
  const stepperHtml = (list) => list.map((s) => `<div id="row-${s.id}"><div class="row"><label for="st-${s.id}">${s.label}<span class="stepnote">${s.note || ""}</span></label><b id="st-${s.id}-v"></b></div><div class="stepper"><button type="button" data-st="${s.id}" data-d="-1" aria-label="${s.label}を減らす">${MINUS}</button><input id="st-${s.id}" type="range" min="${s.min}" max="${s.max}" step="${s.step}"><button type="button" data-st="${s.id}" data-d="1" aria-label="${s.label}を増やす">${PLUS}</button></div></div>`).join("");
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
  for (const b of document.querySelectorAll("[data-view-toggle]")) b.addEventListener("click", () => { view[b.dataset.viewToggle] = !view[b.dataset.viewToggle]; syncToggles(); dirty3d = true; scheduleTerrain(); render(); listeners.forEach((f) => f()); });
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
  const riversOf = (grids) => { const m = new Map(); for (const [id, g] of grids) if (model.byId.get(id).areaKm2 > 1000) m.set(id, ShipTerrain.buildRivers(g)); return m; };
  function terrainPack() {
    if (!demPack) demPack = ShipTerrain.decodeDem(window.SHIP_DEM);
    const layer = ShipTerrain.normalizeLayer(state.terrain.heightLayer), key = JSON.stringify(layer);
    if (!gridCache.others) { gridCache.others = ShipTerrain.buildGrids(model, demPack, layer, (i) => i.id !== "honshu").grids; gridCache.othersRivers = riversOf(gridCache.others); }
    if (gridCache.key !== key) { gridCache.honshu = ShipTerrain.buildGrids(model, demPack, layer, (i) => i.id === "honshu"); gridCache.honshuRivers = riversOf(gridCache.honshu.grids); gridCache.key = key; }
    const grids = new Map(gridCache.others); for (const [k, v] of gridCache.honshu.grids) grids.set(k, v);
    return { grids, layer, rivers: new Map([...gridCache.othersRivers, ...gridCache.honshuRivers]) };
  }
  function heightSampler() { const p = terrainPack(); return ShipTerrain.makeShipSampler(C, lay, p.grids, model, p.layer); }

  // ------------------------------------------------------------ 人口・道路鉄道・追加レイヤーのデータ
  let popCache = { key: "", v: null, byCode: null }, netCache = { key: "", v: null }, ldCache = { lay: null, key: "", v: null };
  const popKey = () => state.ship.population + "|" + JSON.stringify(state.popFrame || null);
  function pops() { const k = popKey(); if (popCache.key !== k) { const v = ShipPop.compute(model, state.ship.population, state.popFrame); popCache = { key: k, v, byCode: new Map(v.munis.map((m) => [m.c, m])) }; } return popCache.v; }
  function network() { const p = pops(), k = popKey(); if (netCache.key !== k) netCache = { key: k, v: ShipNet.design(model, p) }; return netCache.v; }
  function layerData() {
    const k = popKey(); if (ldCache.lay === lay && ldCache.key === k) return ldCache.v; pops();
    const vis = new Set(lay.islands.map((i) => i.id));
    const munis = lay.munis.map((m) => { const q = popCache.byCode.get(m.c); return { c: m.c, n: m.n, k: m.k, pos: m.pos, pop: q.pop, areaKm2: q.a, capital: q.capital }; });
    const net = network().edges.filter((e) => vis.has(e.island)).map((e) => { const sh = lay.shifts.get(e.island); return { mode: e.mode, tier: e.tier, a: C.shipPoint(e.pa, sh), b: C.shipPoint(e.pb, sh) }; });
    const v = { munis, net, denom: state.terrain.japanScaleDenominator }; ldCache = { lay, key: k, v }; return v;
  }
  const layerOpts = (fs) => ({ density: view.density, urban: view.urban, rail: view.rail, road: view.road, munis: view.munis, names: view.names, nameFont: fs });

  // ------------------------------------------------------------ 地形ラスター（標高色・陰影・雪・湖・河川）。2Dと3Dで共用。非同期に少しずつ計算
  let terrainImg = { key: "", pendingKey: "", canvas: null, water: null, job: null, timer: null };
  function terrainKey() { const t = state.terrain, hl = t.heightLayer; return JSON.stringify([state.ship.innerDiameterKm, state.ship.cylinderLengthKm, state.ship.centerXKm, state.ship.centerYKm, { ...t, heightLayer: [hl.fujiSummitM, hl.ridgeSwScale, hl.ridgeNeScale, hl.ridgeCapM] }, view.elevColor, view.rivers, view.lakes]); }
  const terrainReady = () => !!(view.elevColor && terrainImg.canvas && terrainImg.key === terrainKey());
  function scheduleTerrain() {
    if (!view.elevColor) return; const k = terrainKey(); if (terrainImg.key === k || terrainImg.pendingKey === k) return;
    clearTimeout(terrainImg.timer); terrainImg.timer = setTimeout(() => startTerrain(k), 350);
  }
  function startTerrain(k) {
    if (terrainImg.job) terrainImg.job.cancel(); terrainImg.pendingKey = k;
    const p = terrainPack(), f = lay.frame, ppk = Math.min(24, Math.sqrt(6e5 / (f.w * f.h))), layR = { ...lay, lakes: view.lakes ? lay.lakes : [] };
    terrainImg.job = ShipTerrainImg.renderAsync(C, ShipTerrain, model, layR, p.grids, p.layer, view.rivers ? p.rivers : new Map(), { ppk, rowsPerTick: 30 }, (res) => {
      terrainImg.pendingKey = ""; if (k !== terrainKey()) { scheduleTerrain(); return; }
      const c = document.createElement("canvas"); c.width = res.W; c.height = res.H; c.getContext("2d").putImageData(new ImageData(res.rgba, res.W, res.H), 0, 0);
      terrainImg = { key: k, pendingKey: "", canvas: c, water: res.water, W: res.W, H: res.H, ppk: res.ppk, left: f.x - f.w / 2, top: f.y + f.h / 2, frame: f, job: null, timer: null };
      render(); dirty3d = true; listeners.forEach((fn) => fn());
    });
  }
  function waterMask() { if (!terrainReady()) return null; const t = terrainImg, w = t.frame.w; return (x, y) => { const xw = t.left + ((((x - t.left) % w) + w) % w), i = Math.min(t.W - 1, Math.floor((xw - t.left) * t.ppk)), j = Math.floor((t.top - y) * t.ppk); return j < 0 || j >= t.H ? 1 : t.water[j * t.W + i]; }; }
  function paintTexture(g, TW, TH, hiQ) {
    const f = lay.frame, tOk = terrainReady(); g.fillStyle = ShipDraw.COLORS.sea; g.fillRect(0, 0, TW, TH);
    if (tOk) { g.imageSmoothingEnabled = true; g.drawImage(terrainImg.canvas, 0, 0, TW, TH); } else scheduleTerrain();
    const sx = TW / f.w, sy = -TH / f.h, left = f.x - f.w / 2, top = f.y + f.h / 2, T = { sx, ox: -left * sx, sy, oy: -top * sy }, win = { low: left, high: left + f.w, south: f.y - f.h / 2, north: top };
    ShipDraw.paintMap(g, lay, inter, T, win, { landFill: !tOk, borders: view.borders, cities: view.cities, cityNames: view.cities && !view.names && hiQ, cityFont: Math.round(TW / 90), interference: view.interference, symbols: view.symbols, symbolPx: 3, symbolR: 2, borderPx: TW / 900, edgePx: TW / 1200, minOverlapPx: 2 });
    ShipLayers.paint(g, lay, layerData(), T, win, layerOpts(Math.round(TW / 85)));
    g.strokeStyle = "rgba(255,230,150,0.35)"; g.lineWidth = 1; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo((k * TW) / 4, 0); g.lineTo((k * TW) / 4, TH); g.stroke(); }
  }
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
  $("fit").onclick = () => (current === "2d" ? viewFit() : window.Ship3D && Ship3D.resetView());
  $("resetView").onclick = () => (current === "2d" ? frameFit() : window.Ship3D && Ship3D.resetView());
  $("fixRyukyu").onclick = () => {
    const r = C.resolveRyukyu(model, state); state = r.state; markCustom(); syncSteppers(); changed();
    $("feedback").textContent = r.moved.length ? `南西諸島 ${r.moved.length}島を東西に最小移動しました。` : "南西諸島に重なりはありません（補正なし）。";
  };
  $("clearOffsets").onclick = async () => { if (!Object.keys(state.terrain.islandOffsetsKm).length && !Object.keys(state.terrain.islandOffsetsNorthKm).length) return; if (!(await ask("個別の東西・南北補正をすべて消しますか？"))) return; state.terrain.islandOffsetsKm = {}; state.terrain.islandOffsetsNorthKm = {}; changed({ custom: true }); };

  // ------------------------------------------------------------ 保存スロット（標準案・名前付き保存・JSON読込を1つの一覧に統一）
  let store; try { store = ShipSlots.createStore(window.localStorage); } catch (_) { store = ShipSlots.createStore(null); }
  let cur = { kind: "std", id: "current" }, dirty = false;
  const curKey = () => cur.kind + ":" + cur.id, stdName = (id) => (C.presetList().find((p) => p.id === id) || {}).name || id;
  const entryName = () => (cur.kind === "std" ? stdName(cur.id) : (store.get(cur.id) || {}).name || "（削除されたスロット）");
  const dimTxt = (d) => `${(+d.ship.innerDiameterKm).toFixed(1)}×${(+d.ship.cylinderLengthKm).toFixed(1)}km`;
  function markCustom() { dirty = true; presetId = "custom"; syncPresetLabel(); }
  function syncPresetLabel() { $("presetState").textContent = dirty ? "変更あり（未保存）" : "保存どおり"; $("slotState").textContent = dirty ? "変更あり（未保存）" : "保存どおり"; }
  function renderSlots() {
    const std = C.presetList().filter((p) => !store.hiddenStd().includes(p.id)), slots = store.list();
    for (const sel of [$("preset"), $("saved")]) {
      sel.innerHTML = ""; const g1 = document.createElement("optgroup"); g1.label = "標準案（読み取り専用の原本）"; for (const p of std) g1.appendChild(new Option(p.name, "std:" + p.id)); sel.appendChild(g1);
      const g2 = document.createElement("optgroup"); g2.label = `保存スロット（${slots.length}件）`; for (const q of slots) g2.appendChild(new Option(`${q.name}（${dimTxt(q.design)}）`, "slot:" + q.id)); if (slots.length) sel.appendChild(g2);
      if (![...sel.options].some((o) => o.value === curKey())) sel.appendChild(new Option(entryName() + "（現在）", curKey())); sel.value = curKey();
    }
    const q = cur.kind === "slot" ? store.get(cur.id) : null;
    $("slotInfo").innerHTML = (q ? `選択中：保存スロット「${q.name}」／ファイル名 ${q.fileName}／保存 ${q.savedAt.slice(0, 16).replace("T", " ")}／元：${q.origin}` : `選択中：標準案「${stdName(cur.id)}」（読み取り専用の原本。変更したら「保存…」で保存スロットへ）`) + (store.writable ? "" : "<br>このブラウザでは保存スロットを書き込めません。JSON出力で外部に保存してください。") + ` ／ごみ箱 ${store.trash().length}件`;
    syncPresetLabel();
  }
  function snapshot(name) { recompute(true); return C.serializeState(Object.assign(C.cloneState(state), { name: name || entryName(), createdAt: new Date().toISOString() }), model, { sourcePreset: dirty ? `変更あり（元：${entryName()}）` : state.sourcePreset,
    report: { overhangs: met.overhangIslands.map((o) => ({ id: o.id, name: o.name, southKm: +o.southKm.toFixed(4), northKm: +o.northKm.toFixed(4) })), interference: inter.map((o) => ({ a: o.a, b: o.b, wrap: o.k, areaKm2: +o.areaKm2.toFixed(6) })), interferenceAreaKm2: +met.overlapKm2.toFixed(6), landNetKm2: +met.landNetKm2.toFixed(3) } }); }
  /** 状態を丸ごと差し替える。2D・3D・枠・補正・スライダー・計算値・レイヤーを同時に更新（古い値を残さない）。 */
  function installState(ns, entry, note) {
    state = ns; cur = entry; dirty = false; presetId = curKey(); terrainSelSync(); syncSteppers(); recompute(true); frameFit(); changed(); renderSlots();
    if (note) $("feedback").textContent = note;
  }
  function loadEntry(value) {
    const i = value.indexOf(":"), kind = value.slice(0, i), id = value.slice(i + 1);
    try {
      if (kind === "std") { const st = C.presetState(model, id); installState(st, { kind, id }, `適用：${stdName(id)}（内径 ${fmt(st.ship.innerDiameterKm)}km・長さ ${fmt(st.ship.cylinderLengthKm)}km）`); }
      else { const q = store.get(id); if (!q) throw new Error("スロットが見つかりません"); const st = C.normalizeState(q.design, model); st.sourcePreset = st.sourcePreset || q.origin; installState(st, { kind, id }, `保存スロット「${q.name}」を呼び出しました${st.migratedFrom ? "（" + st.migratedFrom + " から移行：欠けた項目は既定値）" : ""}。`); }
    } catch (e) { $("feedback").textContent = e.message; renderSlots(); }
  }
  function applyPreset(id) { loadEntry("std:" + id); }
  function loadDesign(d, label) { const st = C.normalizeState(d, model); installState(st, { kind: "std", id: cur.id }, null); dirty = true; presetId = "custom"; customFrom = label || d.name || "読込"; syncPresetLabel(); }
  for (const sel of [$("preset"), $("saved")]) sel.addEventListener("change", () => loadEntry(sel.value));
  // --- 保存ダイアログ：表示名・ファイル名を「新規」または既存候補から選ぶ
  function openSaveDialog() {
    return new Promise((resolve) => {
      const slots = store.list(), sn = $("sdName"), sf = $("sdFile"), ni = $("sdNameIn"), fi = $("sdFileIn"), ok = $("sdOk"), hint = $("sdHint");
      const fill = (sel, vals) => { sel.innerHTML = ""; sel.appendChild(new Option("新規（自由に名付ける）", "")); for (const v of vals) sel.appendChild(new Option(v, v)); };
      fill(sn, slots.map((q) => q.name)); fill(sf, slots.map((q) => q.fileName));
      const base = cur.kind === "slot" ? store.get(cur.id) : null; sn.value = base ? base.name : ""; sf.value = base ? base.fileName : "";
      ni.value = base ? "" : store.uniqueName(entryName() + " 改"); fi.value = store.defaultFileName(ni.value || entryName());
      const sync = () => { ni.hidden = sn.value !== ""; fi.hidden = sf.value !== ""; const ow = sn.value !== ""; ok.textContent = ow ? "上書き保存" : "新規登録"; hint.textContent = ow ? `「${sn.value}」を上書きします（以前の内容は戻せません。必要ならJSON出力でバックアップ）。` : "新しいスロットとして登録します（既存の案は変わりません）。"; hint.className = ow ? "warning" : "muted"; };
      sn.onchange = () => { if (sn.value === "") { fi.value = store.defaultFileName(ni.value || "design"); } else { const q = slots.find((x) => x.name === sn.value); sf.value = q ? q.fileName : ""; } sync(); }; sf.onchange = sync; ni.oninput = () => { if (sf.value === "") fi.value = store.defaultFileName(ni.value); };
      sync(); $("saveDlg").hidden = false; ni.focus();
      const done = (v) => { $("saveDlg").hidden = true; ok.onclick = $("sdCancel").onclick = null; resolve(v); };
      ok.onclick = () => { const ow = sn.value !== ""; const name = ow ? sn.value : ni.value.trim(); if (!name) { hint.textContent = "表示名を入力してください。"; return; } const file = sf.value !== "" ? sf.value : (fi.value.trim() || store.defaultFileName(name)); done({ overwrite: ow, id: ow ? (slots.find((q) => q.name === sn.value) || {}).id : null, name, fileName: file.endsWith(".json") ? file : file + ".json" }); };
      $("sdCancel").onclick = () => done(null);
    });
  }
  $("saveOpen").onclick = async () => {
    const r = await openSaveDialog(); if (!r) return; recompute(true);
    try {
      let q; if (r.overwrite && r.id) q = store.overwrite(r.id, snapshot(r.name), { name: r.name, fileName: r.fileName }); else q = store.add(snapshot(r.name), { name: r.name, fileName: r.fileName, origin: cur.kind === "std" ? "標準案から保存：" + stdName(cur.id) : "新規保存" });
      cur = { kind: "slot", id: q.id }; dirty = false; presetId = curKey(); renderSlots(); $("feedback").textContent = store.writable ? `保存スロット「${q.name}」に${r.overwrite ? "上書き保存" : "新規登録"}しました（ファイル名 ${q.fileName}）。端末に残すには「JSON出力」。` : "このブラウザでは保存スロットに書き込めませんでした。JSON出力を使ってください。";
    } catch (e) { $("feedback").textContent = e.message; }
  };
  $("dupSaved").onclick = () => { try { const q = store.add(snapshot(entryName() + " のコピー"), { name: entryName() + " のコピー", origin: (cur.kind === "std" ? "標準案から複製：" : "複製：") + entryName() }); cur = { kind: "slot", id: q.id }; dirty = false; renderSlots(); $("feedback").textContent = `「${q.name}」として複製しました。`; } catch (e) { $("feedback").textContent = e.message; } };
  $("renameSaved").onclick = async () => {
    if (cur.kind !== "slot") { $("feedback").textContent = "標準案は読み取り専用です。「複製」か「保存…」でスロットにしてから名前を変えられます。"; return; }
    const q = store.get(cur.id); const nn = ((await ask(`「${q.name}」の新しい表示名`, { input: q.name, ok: "変更" })) || "").trim(); if (!nn || nn === q.name) return;
    try { store.rename(q.id, nn); renderSlots(); $("feedback").textContent = `名前を「${nn}」に変更しました。`; } catch (e) { $("feedback").textContent = e.message; }
  };
  $("deleteSaved").onclick = async () => {
    if (cur.kind !== "slot") { $("feedback").textContent = "標準案は削除できません（読み取り専用の原本）。不要なら「選択中の標準案を一覧から隠す」。"; return; }
    const q = store.get(cur.id); if (!(await ask(`保存スロット「${q.name}」（${q.fileName}）を削除しますか？\n「削除を取り消す」で戻せます。`, { ok: "削除する" }))) return;
    store.remove(q.id); cur = { kind: "std", id: "current" }; installState(C.presetState(model, "current"), cur, `「${q.name}」を削除しました（ごみ箱。取り消せます）。`);
  };
  $("undoDelete").onclick = () => { const q = store.restoreLast(); $("feedback").textContent = q ? `「${q.name}」を戻しました。` : "取り消せる削除はありません。"; renderSlots(); };
  $("hideStd").onclick = () => { if (cur.kind !== "std") { $("feedback").textContent = "標準案を選んでから押してください。"; return; } if (dirty) { $("feedback").textContent = "未保存の変更があります。「保存…」してから隠してください。"; return; } const left = C.presetList().filter((p) => !store.hiddenStd().includes(p.id) && p.id !== cur.id); if (!left.length) { $("feedback").textContent = "標準案は最低1件残します。"; return; } const id = cur.id; store.hideStd(id); loadEntry("std:" + (left.find((p) => p.id === "current") || left[0]).id); $("feedback").textContent = `標準案「${stdName(id)}」を一覧から隠しました（原本は消えず、「隠した標準案を戻す」で戻せます）。`; };
  $("showStd").onclick = () => { store.showStdAll(); renderSlots(); $("feedback").textContent = "隠した標準案を戻しました。"; };
  // ファイル書き出し：Artifactなど保存が使えない環境でも、必ずコピー欄にも出す
  function download(obj, filename) {
    const text = JSON.stringify(obj, null, 2);
    try { const blob = new Blob([text], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000); } catch (_) {}
    $("jsonOut").value = text; $("jsonBox").hidden = false; $("jsonName").textContent = filename;
  }
  $("copyJson").onclick = async () => { try { await navigator.clipboard.writeText($("jsonOut").value); $("feedback").textContent = "JSONをコピーしました。"; } catch (_) { $("jsonOut").select(); $("feedback").textContent = "全選択しました。長押しでコピーしてください。"; } };
  $("closeJson").onclick = () => { $("jsonBox").hidden = true; };
  function ask(message, o) {
    o = o || {};
    return new Promise((resolve) => {
      $("askMsg").textContent = message; const inp = $("askInput"); inp.hidden = o.input === undefined; inp.value = o.input || "";
      $("askOk").textContent = o.ok || "OK"; $("ask").hidden = false; (o.input === undefined ? $("askOk") : inp).focus();
      const done = (v) => { $("ask").hidden = true; $("askOk").onclick = $("askCancel").onclick = null; resolve(v); };
      $("askOk").onclick = () => done(o.input === undefined ? true : inp.value); $("askCancel").onclick = () => done(o.input === undefined ? false : null);
    });
  }
  const currentFileName = () => (cur.kind === "slot" && store.get(cur.id) ? store.get(cur.id).fileName : store.defaultFileName(entryName()));
  $("export").onclick = () => { download(snapshot(entryName()), currentFileName()); $("feedback").textContent = "現在の案をJSONファイルとして書き出しました（保存スロットとは別。端末へのバックアップ）。"; };
  $("exportAll").onclick = () => { download(store.exportAll(), `kasoku-ship-slots-${new Date().toISOString().slice(0, 10)}.json`); $("feedback").textContent = `保存スロット${store.list().length}件をまとめてJSONに書き出しました。`; };
  $("load").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text()), added = store.importJSON(data, { fileName: f.name }); if (!added.length) throw new Error("船体案のJSONとして読めませんでした");
      const q = added[0], st = C.normalizeState(q.design, model); installState(st, { kind: "slot", id: q.id }, null);
      $("feedback").textContent = `JSONを読み込み、保存スロットに${added.length}件登録しました（${added.map((x) => x.name).join("、")}）。${st.migratedFrom ? st.migratedFrom + " の形式から移行し、欠けた項目は既定値にしました。" : ""}`;
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
    if (v !== "2d") v = "3d"; current = v; const is2d = v === "2d";
    $("btnView").setAttribute("aria-pressed", String(!is2d)); canvas.hidden = !is2d; $("view3d").hidden = is2d; $("labels3d").hidden = is2d; $("gizmoBox").hidden = is2d;
    if (is2d) { if (window.Ship3D) Ship3D.pause(); render(); }
    else if (window.Ship3D) Ship3D.show();
    else $("feedback").textContent = "3D表示の部品（three.js）を読み込めませんでした。通信状態を確認してください。2D設計は使えます。";
  }
  $("btnView").onclick = () => setCurrent(current === "2d" ? "3d" : "2d");
  window.addEventListener("resize", () => { render(); });

  // public surface for the 3D view and for tests
  window.ShipApp = {
    get terrainSel() { return terrainSel; }, terrainScreen(key) { const T = terrainShapes(), w = lay.frame.w; let q = key === "fuji" ? T.fuji : T[key][Math.floor(T[key].length / 2)]; const x = q[0] + Math.round((camera.x - q[0]) / w) * w, u = p2s(x, q[1]), r = canvas.getBoundingClientRect(); return [r.left + u.x, r.top + u.y]; },
    terrainWorld(key) { const T = terrainShapes(), w = lay.frame.w; const q = key === "fuji" ? T.fuji : T[key][Math.floor(T[key].length / 2)]; return [q[0] + Math.round((camera.x - q[0]) / w) * w, q[1]]; },
    model, get state() { return state; }, get layout() { return lay; }, get interference() { return inter; }, get metrics() { return met; }, get view() { return view; },
    heightSampler, terrainPack, paintTexture, waterMask, pops, network, layerData, get terrainReady() { return terrainReady(); }, get terrainImage() { return terrainImg; }, get dirty3d() { return dirty3d; }, clean3d() { dirty3d = false; }, onChange(f) { listeners.push(f); },
    setState(s) { loadDesign(s, "テスト"); }, applyPreset, setCurrent, get presetId() { return presetId; }, get slotStore() { return store; }, get current() { return { ...cur, dirty }; }, loadEntry, renderSlots, get camera() { return camera; }, get mode() { return mode; },
    frameRect: () => frameRect(), flush() { recompute(true); draw(); },
  };
  const stubBtn = (t, why) => `<button disabled title="${why}">${t}（${why}）</button>`;
    $("stubTraffic").innerHTML = ["廃線・廃道", "建設計画・未成線", "港湾", "空港", "路線番号標識", "路線名の文字"].map((t) => stubBtn(t, "未整備")).join("");
  // 県別人口枠の読込（確定設定の人口枠）。合計が船体人口と違っても比例補正せず、差を表示する
  function parsePopFrame(o) { const out = {}, byName = new Map(model.prefectures.map((p) => [p.name, p.id])), put = (k, v) => { const id = model.prefectures.some((p) => p.id === k) ? k : byName.get(k); if (id && Number.isFinite(Number(v))) out[id] = Number(v); };
    const src = o && o.prefectures ? o.prefectures : o; if (Array.isArray(src)) for (const r of src) put(r.id || r.name || r.pref, r.population ?? r.pop ?? r.persons); else if (src && typeof src === "object") for (const [k, v] of Object.entries(src)) put(k, typeof v === "object" ? (v.population ?? v.pop) : v); return out; }
  $("popLoad").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { const fr = parsePopFrame(JSON.parse(await f.text())), n = Object.keys(fr).length; if (!n) throw new Error("県ID（JP-01…）または県名と人口の組が見つかりません"); state.popFrame = fr; markCustom(); changed(); $("feedback").textContent = `県別人口枠を${n}件読み込みました（47県中）。`; } catch (err) { $("feedback").textContent = "人口枠の読み込み失敗：" + err.message; } e.target.value = ""; });
  $("popClear").onclick = () => { state.popFrame = null; markCustom(); changed(); $("feedback").textContent = "暫定配分に戻しました。"; };
  buildSteppers(); syncSteppers(); setTerrainSel("fuji"); setTab("view"); setMode("cylinder"); renderSlots();
  recompute(true);
  requestAnimationFrame(() => { frameFit(); syncText(); });
})();
