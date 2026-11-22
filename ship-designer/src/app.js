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
  let view = { borders: true, prefNames: true, cities: true, interference: true, symbols: true };
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
    render();
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
    // inside the hull: folded onto the circumference
    ctx.fillStyle = ShipDraw.COLORS.sea; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    const showNames = camera.s > 9;
    ShipDraw.paintMap(ctx, lay, inter, T, { low: f.x - f.w / 2, high: f.x + f.w / 2, south: Math.max(y0, f.y - f.h / 2), north: Math.min(y1, f.y + f.h / 2) },
      { borders: view.borders, prefNames: view.prefNames && camera.s > 5, cities: view.cities, cityNames: view.cities && showNames, interference: view.interference && interKey === stateKey(), symbols: view.symbols, minOverlapPx: 2 });
    ctx.setLineDash([3, 4]); ctx.strokeStyle = "#a5d4e155"; ctx.lineWidth = 0.7;
    for (let x = Math.ceil((f.x - f.w / 2) / st) * st; x <= f.x + f.w / 2; x += st) { const u = p2s(x, 0); ctx.beginPath(); ctx.moveTo(u.x, r.y); ctx.lineTo(u.x, r.y + r.h); ctx.stroke(); }
    ctx.setLineDash([]); ctx.restore();
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

  // ------------------------------------------------------------ text panels
  function syncText() {
    const m = met, ph = m.physics, s = state.ship;
    const cards = [
      [`${fmt(s.innerDiameterKm)} km`, "船体内径 D"], [`${fmt(s.cylinderLengthKm)} km`, "居住シリンダー長 L"],
      [`${fmt(ph.circumferenceKm, 3)} km`, "円周 πD（東西に一周）"], [`${fmt(ph.areaKm2)} km²`, "内面積 πDL"],
      [`${Math.round(ph.density).toLocaleString()} 人/km²`, "平均人口密度（1,200万人・内面全体）"], [`${(s.cylinderLengthKm / s.innerDiameterKm).toFixed(2)} : 1`, "長さ／直径"],
      [`${ph.rimSpeedMs.toFixed(1)} m/s`, `居住面周速 v=√(3gR)（${(ph.rimSpeedMs * 3.6).toFixed(0)} km/h）`], [`${ph.omegaRadS.toFixed(4)} rad/s`, `角速度 ω=√(3g/R)（${ph.rpm.toFixed(3)} rpm）`],
      [`${ph.periodS.toFixed(1)} 秒`, "回転周期（物理値）"], [`${(ph.accel).toFixed(2)} m/s²`, `人工重力 ${s.gravityG}G（g=9.80665）`],
      [`${fmt(m.landNetKm2)} km²`, `陸地（船体内・重複除く）${(m.landShare * 100).toFixed(1)}%`], [`${fmt(m.seaKm2)} km²`, "海面（船体内）"],
      [`${fmt(m.overlapKm2, 4)} km²`, `地形干渉 ${m.interferenceCount}か所`], [`${Number.isFinite(m.densityPerLandKm2) ? Math.round(m.densityPerLandKm2).toLocaleString() : "—"} 人/km²`, "陸地あたり人口密度"],
    ];
    $("metrics").innerHTML = cards.map(([a, b]) => `<div class="metric"><strong>${a}</strong><span>${b}</span></div>`).join("");
    const t = state.terrain;
    const interOk = interKey === stateKey();
    const ryu = inter.filter((o) => model.byId.get(o.a).group === "ryu" || model.byId.get(o.b).group === "ryu").length;
    const iTxt = !interOk ? "干渉を計算中…" : inter.length ? `地形干渉：赤い面が実際に重なった陸地（${inter.length}か所・南西諸島${ryu}か所）。` : "地形干渉：なし。";
    $("status").innerHTML = `<span class="${inter.length && interOk ? "warning" : "good"}">${iTxt}</span> 南北のはみ出し：北 ${fmt(m.overhangNorthKm)} km ／ 南 ${fmt(m.overhangSouthKm)} km。` +
      `<br><small>列島 1/${t.japanScaleDenominator}・南方離島間隔 ${t.ryukyuSpacingPercent}%・対馬 南へ${t.tsushimaSouthKm}km・小笠原圧縮 ${t.ogasawaraCompressionPercent}%（硫黄島基準）・目盛 ${fmt(tick())}km</small>`;
    const n = Object.keys(t.islandOffsetsKm).length;
    $("offsetInfo").textContent = n ? `個別東西補正 ${n}島：` + Object.entries(t.islandOffsetsKm).map(([id, v]) => `${model.byId.get(id).name || id} ${v > 0 ? "東" : "西"}へ${Math.abs(v * 1000).toFixed(0)}m`).join("、") : "個別東西補正なし（原島座標のまま）。";
    $("operationHelp").textContent = mode === "japan" ? "日本列島操作：1本指＝表示移動、ピンチ＝拡大縮小（枠内でも）" : "シリンダー操作：枠内ドラッグ＝移動、●◆＝変形、ピンチ（枠上）＝枠の拡縮";
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
    if (pointers.size === 1) begin(p);
    else if (pointers.size === 2) {
      const a = [...pointers.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
      gesture = { type: mode === "japan" || !a.some((q) => q.hit !== "pan") ? "view-pinch" : "frame-pinch", dist: d, mid: { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }, base: shipFrame(), cam: { ...camera } };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId); if (!p || !gesture) return; e.preventDefault();
    const rect = canvas.getBoundingClientRect(); p.x = e.clientX - rect.left; p.y = e.clientY - rect.top;
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
  const end = (e) => { pointers.delete(e.pointerId); gesture = null; if (pointers.size === 1) begin([...pointers.values()][0]); syncSteppers(); };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); camera.s = clamp(camera.s * Math.exp(-e.deltaY / 400), 0.0001, 3000); render(); }, { passive: false });

  // ------------------------------------------------------------ steppers (±1 and long-press repeat)
  const STEPPERS = [
    { id: "diameter", label: "船体内径 D", get: () => state.ship.innerDiameterKm, set: (v) => { state.ship.innerDiameterKm = v; }, min: 0.1, max: 30, step: 0.01, fmt: (v) => v.toFixed(2) + " km" },
    { id: "length", label: "居住シリンダー長 L", get: () => state.ship.cylinderLengthKm, set: (v) => { state.ship.cylinderLengthKm = v; }, min: 0.5, max: 300, step: 0.1, fmt: (v) => v.toFixed(2) + " km" },
    { id: "scale", label: "日本列島の縮尺（分母）", get: () => state.terrain.japanScaleDenominator, set: (v) => { state.terrain.japanScaleDenominator = Math.round(v); }, min: 3, max: 1000, step: 1, fmt: (v) => "1/" + v },
    { id: "island", label: "琉球・小笠原 共通南北間隔", get: () => state.terrain.ryukyuSpacingPercent, set: (v) => { state.terrain.ryukyuSpacingPercent = Math.round(v); }, min: 10, max: 100, step: 1, fmt: (v) => v + "%" },
    { id: "tsushima", label: "対馬を南へ（船体km）", get: () => state.terrain.tsushimaSouthKm, set: (v) => { state.terrain.tsushimaSouthKm = +v.toFixed(2); }, min: 0, max: 25, step: 0.1, fmt: (v) => v.toFixed(1) + " km" },
    { id: "ogasawara", label: "小笠原 追加圧縮（硫黄島固定）", get: () => state.terrain.ogasawaraCompressionPercent, set: (v) => { state.terrain.ogasawaraCompressionPercent = Math.round(v); }, min: 0, max: 100, step: 1, fmt: (v) => v + "%" },
  ];
  function buildSteppers() {
    $("steppers").innerHTML = STEPPERS.map((s) => `<div class="row"><label for="st-${s.id}">${s.label}</label><b id="st-${s.id}-v"></b></div><div class="stepper"><button data-st="${s.id}" data-d="-1" aria-label="${s.label}を減らす">−</button><input id="st-${s.id}" type="range" min="${s.min}" max="${s.max}" step="${s.step}"><button data-st="${s.id}" data-d="1" aria-label="${s.label}を増やす">＋</button></div>`).join("");
    for (const s of STEPPERS) {
      $("st-" + s.id).addEventListener("input", (e) => apply(s, +e.target.value, true));
      $("st-" + s.id).addEventListener("change", () => changed());
    }
    for (const b of document.querySelectorAll("button[data-st]")) {
      const s = STEPPERS.find((x) => x.id === b.dataset.st), d = +b.dataset.d; let timer = null, rep = 0;
      const once = () => { rep++; const mult = rep > 25 ? 10 : 1; apply(s, s.get() + d * s.step * mult, true); };
      const stop = () => { if (timer !== null) { clearTimeout(timer); clearInterval(timer); timer = null; changed(); } rep = 0; };
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); stop(); once(); timer = setTimeout(() => { timer = setInterval(once, 80); }, 380); try { b.setPointerCapture(e.pointerId); } catch (_) {} });
      b.addEventListener("pointerup", stop); b.addEventListener("pointercancel", stop); b.addEventListener("lostpointercapture", stop);
      b.addEventListener("click", (e) => { if (e.detail === 0) { once(); changed(); } });
    }
  }
  function apply(s, v, fast) { const q = Math.round(clamp(v, s.min, s.max) / s.step) * s.step; s.set(+q.toFixed(6)); syncSteppers(); changed({ fast, custom: true }); }
  function syncSteppers() { for (const s of STEPPERS) { $("st-" + s.id).value = s.get(); $(`st-${s.id}-v`).textContent = s.fmt(s.get()); } syncToggles(); }

  // ------------------------------------------------------------ toggles, presets, modes
  function syncToggles() {
    for (const b of document.querySelectorAll("[data-toggle]")) b.setAttribute("aria-pressed", String(!!state.terrain[b.dataset.toggle]));
    for (const b of document.querySelectorAll("[data-view-toggle]")) b.setAttribute("aria-pressed", String(!!view[b.dataset.viewToggle]));
  }
  for (const b of document.querySelectorAll("[data-toggle]")) b.addEventListener("click", () => { state.terrain[b.dataset.toggle] = !state.terrain[b.dataset.toggle]; syncToggles(); changed({ custom: true }); });
  for (const b of document.querySelectorAll("[data-view-toggle]")) b.addEventListener("click", () => { view[b.dataset.viewToggle] = !view[b.dataset.viewToggle]; syncToggles(); dirty3d = true; render(); listeners.forEach((f) => f()); });
  const psel = $("preset");
  psel.appendChild(new Option("カスタム案（手動調整中）", "custom"));
  for (const p of C.presetList()) psel.appendChild(new Option(p.name, p.id));
  function applyPreset(id) { state = C.presetState(model, id); presetId = id; customFrom = null; psel.value = id; syncPresetLabel(); syncSteppers(); recompute(true); frameFit(); changed(); $("feedback").textContent = `適用：${state.sourcePreset}（内径 ${fmt(state.ship.innerDiameterKm)}km・長さ ${fmt(state.ship.cylinderLengthKm)}km）`; }
  psel.addEventListener("change", () => { if (psel.value !== "custom") applyPreset(psel.value); });
  function setMode(m) { mode = m; pointers.clear(); gesture = null; $("modeCylinder").setAttribute("aria-pressed", String(m === "cylinder")); $("modeJapan").setAttribute("aria-pressed", String(m === "japan")); $("modeHint").textContent = m === "japan" ? "地図表示だけを動かします（船体枠は動きません）。枠が画面いっぱいでも使えます。" : "枠内ドラッグで船体を移動。辺の◆は幅か長さだけ、角の●は両方を変えます。"; render(); }
  $("modeCylinder").onclick = () => setMode("cylinder"); $("modeJapan").onclick = () => setMode("japan");
  $("fit").onclick = () => (current === "2d" ? viewFit() : window.Ship3D && Ship3D.setView(current));
  $("resetView").onclick = () => (current === "2d" ? frameFit() : window.Ship3D && Ship3D.setView(current));
  $("resetAll").onclick = () => { setMode("cylinder"); applyPreset("adopted"); $("feedback").textContent = "採用基準案に戻しました（保存済みの案は消していません）。"; };
  $("fixRyukyu").onclick = () => {
    const r = C.resolveRyukyu(model, state); state = r.state; markCustom(); syncSteppers(); changed();
    $("feedback").textContent = r.moved.length ? `南西諸島 ${r.moved.length}島を東西に最小移動しました。` : "南西諸島に重なりはありません（補正なし）。";
  };
  $("clearOffsets").onclick = async () => { if (!Object.keys(state.terrain.islandOffsetsKm).length) return; if (!(await ask("個別の東西補正をすべて消しますか？"))) return; state.terrain.islandOffsetsKm = {}; changed({ custom: true }); };

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
  const snapshot = (name) => C.serializeState(Object.assign(C.cloneState(state), { name, createdAt: new Date().toISOString() }), model, { sourcePreset: presetId === "custom" ? `カスタム案（${customFrom || "手動"}）` : state.sourcePreset });
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
    `<div>・府県境：${SHIP_GEO.prefectureBorders.method}。実在の県境ではなく酷道世界の49府県。</div><div>・小島${model.islands.filter((s) => s.source === "schematic").length}島は位置のみの模式形（実形状データなし）。沖ノ鳥島も模式形。</div><div>・データ版：${SHIP_GEO.schema} v${SHIP_GEO.version}（${SHIP_GEO.builtAt}）</div>`;

  // ------------------------------------------------------------ view switching (2D / 3D)
  function setCurrent(v) {
    current = v;
    for (const b of document.querySelectorAll("#views button")) b.setAttribute("aria-pressed", String(b.dataset.view === v));
    const is2d = v === "2d";
    canvas.hidden = !is2d; $("view3d").hidden = is2d; $("labels3d").hidden = is2d; $("layerRow").hidden = !is2d; $("spinRow").hidden = is2d; $("tip").hidden = !is2d;
    if (is2d) { if (window.Ship3D) Ship3D.pause(); render(); }
    else if (window.Ship3D) Ship3D.show(v);
    else $("feedback").textContent = "3D表示の部品（three.js）を読み込めませんでした。通信状態を確認してください。2D設計は使えます。";
  }
  for (const b of document.querySelectorAll("#views button")) b.addEventListener("click", () => setCurrent(b.dataset.view));
  window.addEventListener("resize", () => { render(); });

  // public surface for the 3D view and for tests
  window.ShipApp = {
    model, get state() { return state; }, get layout() { return lay; }, get interference() { return inter; }, get metrics() { return met; }, get view() { return view; },
    get dirty3d() { return dirty3d; }, clean3d() { dirty3d = false; }, onChange(f) { listeners.push(f); },
    setState(s) { loadDesign(s, "テスト"); }, applyPreset, setCurrent, get presetId() { return presetId; }, get camera() { return camera; }, get mode() { return mode; },
    frameRect: () => frameRect(), flush() { recompute(true); draw(); },
  };
  buildSteppers(); syncSteppers(); setMode("cylinder"); renderSaved(); syncPresetLabel(); psel.value = presetId;
  recompute(true);
  requestAnimationFrame(() => { frameFit(); syncText(); });
})();
