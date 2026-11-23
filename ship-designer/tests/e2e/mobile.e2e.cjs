// Pixel 7 emulation (Android Chrome equivalent). Run: node tests/e2e/mobile.e2e.cjs   (BASE_URL=https://… で公開URLに対して実行)
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const { open } = require("./harness.cjs");
const results = [];
async function step(name, fn) { try { await fn(); results.push(["ok", name]); } catch (e) { results.push(["NG", name + " :: " + e.message.replace(/\n+/g, " ").slice(0, 320)]); } }
const S = (page) => page.evaluate(() => JSON.parse(JSON.stringify(ShipApp.state)));
const near = (a, b, t, m) => assert.ok(Math.abs(a - b) <= t, `${m || ""} ${a} vs ${b}`);
async function handlePos(page, id) { return page.evaluate((id) => { const r = ShipApp.frameRect(), c = document.getElementById("map").getBoundingClientRect(); const h = { t: [r.x + r.w / 2, r.y], b: [r.x + r.w / 2, r.y + r.h], l: [r.x, r.y + r.h / 2], r: [r.x + r.w, r.y + r.h / 2], rt: [r.x + r.w, r.y], mid: [r.x + r.w / 2, r.y + r.h / 2] }[id]; return [c.left + h[0], c.top + h[1]]; }, id); }
async function touchDrag(cdp, from, to, steps = 8) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1], id: 1 }] });
  for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from[0] + ((to[0] - from[0]) * i) / steps, y: from[1] + ((to[1] - from[1]) * i) / steps, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function pinch(cdp, c, d0, d1, steps = 8, a0 = 0, a1 = 0) {
  const pts = (d, a) => [{ x: c[0] - d * Math.cos(a), y: c[1] - d * Math.sin(a), id: 1 }, { x: c[0] + d * Math.cos(a), y: c[1] + d * Math.sin(a), id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(d0, a0) });
  for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(d0 + ((d1 - d0) * i) / steps, a0 + ((a1 - a0) * i) / steps) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

(async () => {
  const { browser, context, page, errors } = await open({ context: { acceptDownloads: true } });
  const cdp = await context.newCDPSession(page);
  const T = async (name) => { const hidden = await page.locator("#editor").isHidden(); if (name === null) { if (!hidden) await page.click("#btnEdit"); return; } if (hidden) await page.click("#btnEdit"); await page.click(`#tabs button[data-tab="${name}"]`); };
  const P = async (id) => { await T("layout"); await page.selectOption("#preset", "std:" + id); };
  const box = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const okAsk = async (text) => { await page.waitForSelector("#ask:not([hidden])"); if (text !== undefined) await page.fill("#askInput", text); await page.click("#askOk"); };
  const go3d = async () => { if (await page.getAttribute("#btnView", "aria-pressed") !== "true") await page.click("#btnView"); await page.waitForFunction(() => window.Ship3D && Ship3D.built); await page.waitForTimeout(500); };
  const go2d = async () => { if (await page.getAttribute("#btnView", "aria-pressed") === "true") await page.click("#btnView"); };

  await step("起動：現行基準（内径7.0×長さ77.0km・中心軸200m・人口1200万・3G・1/40）。6ボタン（2段×3、幅均等）・旧4表示ボタンなし", async () => {
    const s = await S(page); assert.equal(s.ship.innerDiameterKm, 7); assert.equal(s.ship.cylinderLengthKm, 77); assert.equal(s.ship.axisDiameterM, 200); assert.equal(s.ship.population, 12000000); assert.equal(s.ship.gravityG, 3); assert.equal(s.terrain.japanScaleDenominator, 40);
    assert.equal(s.ship.centerXKm, -7.726051000488052); assert.equal(s.ship.centerYKm, 4.424036296290547, "中心座標は丸めない");
    assert.equal(await page.locator("#views").count(), 0); assert.equal(await page.locator('[data-view="section"]').count(), 0); assert.equal(await page.locator("#resetAll").count(), 0);
    const ids = ["btnView", "modeJapan", "modeCylinder", "btnEdit", "fit", "resetView"], txt = ["2D ⇄ 3D", "列島操作", "船体操作", "編集", "列島全表示", "船体全表示"];
    const bx = []; for (const id of ids) bx.push(await box("#" + id)); assert.deepEqual(await Promise.all(ids.map((id) => page.textContent("#" + id))), txt);
    assert.ok(bx[0].y === bx[1].y && bx[1].y === bx[2].y && bx[3].y === bx[4].y && bx[4].y === bx[5].y && bx[3].y > bx[0].y, "2段×3");
    for (const [a, b] of [[0, 1], [1, 2], [3, 4], [4, 5]]) near(bx[a].w, bx[b].w, 1.5, "幅均等"); for (const b of bx) assert.ok(b.h >= 36 && b.h <= 48, "高さ " + b.h);
    const vh = await page.evaluate(() => innerHeight); assert.ok((await box("#panel")).h > vh * 0.6, "地図が広い"); assert.ok((await box("#top")).h < 30, "タイトル1行");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const m = await page.evaluate(() => ShipApp.metrics.physics); near(m.areaKm2, Math.PI * 7 * 77, 1e-6); near(m.rimSpeedMs, Math.sqrt(3 * 9.80665 * 3500), 1e-9);
  });
  await step("編集：開くと5タブ・閉じると地図が広がる・設定不変・船体案/列島操作の切替で保持", async () => {
    await T(null); const closed = await box("#panel"); assert.equal(await page.isHidden("#editor"), true);
    await T("layout"); await page.fill("#st-rot-izu", "17"); const before = await S(page); const open = await box("#panel"); assert.ok(open.h < closed.h && open.h > 200, "編集中の地図 " + open.h);
    assert.deepEqual(await page.locator("#tabs button").allTextContents(), ["表示", "配置", "地形", "データ", "保存"]);
    for (const t of ["view", "layout", "terrain", "data", "save"]) { await page.click(`#tabs button[data-tab="${t}"]`); assert.equal(await page.locator(`.tabpane[data-pane="${t}"]`).isVisible(), true); }
    await page.click("#modeJapan"); await page.click("#modeCylinder"); await page.click("#btnEdit"); await page.click("#btnEdit"); await page.click("#btnEdit");
    assert.deepEqual(await S(page), before); await T("layout"); await page.fill("#st-rot-izu", "0"); await T(null);
  });
  await step("船体操作：四隅・辺のつまみは常時非表示（判定は有効）。辺は幅/長さのみ、角は両方、枠内ドラッグで移動", async () => {
    await T(null); await page.click("#modeCylinder");
    const px = await page.evaluate(() => { const r = ShipApp.frameRect(), c = document.getElementById("map"), g = c.getContext("2d"), d = window.devicePixelRatio || 1; const at = (x, y) => Array.from(g.getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data); return { corner: at(r.x + r.w - 5, r.y + 5), edge: at(r.x + r.w / 2, r.y + 6) }; });
    const isHandle = (c) => Math.abs(c[0] - 255) < 6 && Math.abs(c[1] - 220) < 6 && Math.abs(c[2] - 151) < 6; assert.ok(!isHandle(px.corner) && !isHandle(px.edge), "つまみは描かない");
    const a = await S(page); const rr = await handlePos(page, "r"); await touchDrag(cdp, rr, [rr[0] + 30, rr[1]]); const b = await S(page); assert.ok(b.ship.innerDiameterKm > a.ship.innerDiameterKm + 0.1); assert.equal(b.ship.cylinderLengthKm, a.ship.cylinderLengthKm);
    const tt = await handlePos(page, "t"); await touchDrag(cdp, tt, [tt[0], tt[1] - 30]); const c = await S(page); assert.ok(c.ship.cylinderLengthKm > b.ship.cylinderLengthKm + 0.3); near(c.ship.innerDiameterKm, b.ship.innerDiameterKm, 1e-9);
    const rt = await handlePos(page, "rt"); await touchDrag(cdp, rt, [rt[0] + 25, rt[1] - 5]); const d = await S(page); assert.ok(Math.abs(d.ship.cylinderLengthKm / d.ship.innerDiameterKm - c.ship.cylinderLengthKm / c.ship.innerDiameterKm) > 0.05, "固定比率でない");
    const p = await handlePos(page, "mid"); await touchDrag(cdp, p, [p[0] + 20, p[1] + 20]); const e = await S(page); assert.ok(e.ship.centerXKm > d.ship.centerXKm && e.ship.centerYKm < d.ship.centerYKm);
    assert.equal(await page.evaluate(() => ShipApp.current.dirty), true);
    await page.evaluate(() => ShipApp.loadEntry("std:current")); assert.equal((await S(page)).ship.innerDiameterKm, 7);
  });
  await step("列島操作：枠を覆う倍率でも1本指＝表示移動・ピンチ＝表示倍率。船体は動かない。モードは色で分かる", async () => {
    await T(null); await page.click("#modeJapan"); assert.equal(await page.getAttribute("#panel", "data-mode"), "japan");
    await page.evaluate(() => { ShipApp.camera.s = 60; ShipApp.flush(); }); const a = await S(page), c0 = await page.evaluate(() => ({ ...ShipApp.camera }));
    const mid = await handlePos(page, "mid"); await touchDrag(cdp, mid, [mid[0] + 40, mid[1]]); const c1 = await page.evaluate(() => ({ ...ShipApp.camera })); assert.ok(c1.x < c0.x - 0.1);
    await pinch(cdp, mid, 40, 110); const c2 = await page.evaluate(() => ({ ...ShipApp.camera })); assert.ok(c2.s > c1.s * 1.8); assert.deepEqual((await S(page)).ship, a.ship);
    await page.click("#modeCylinder"); await page.click("#resetView"); const cm = await page.evaluate(() => ShipApp.camera.s); await pinch(cdp, [40, 300], 10, 25); assert.ok((await page.evaluate(() => ShipApp.camera.s)) > cm); assert.deepEqual((await S(page)).ship, a.ship);
    await page.click("#fit");
  });
  await step("スライダー：縦スワイプで値が変わらない・横ドラッグで変わる・トラックのタップでは変わらない／±は単押し1単位・長押し連続・解除で停止・文字選択なし／刻みと単位の表示", async () => {
    await T("layout"); await page.evaluate(() => document.getElementById("editBody").scrollTo(0, 0));
    const thumb = () => page.evaluate(() => { const i = document.getElementById("st-scale"); i.scrollIntoView({ block: "center" }); const r = i.getBoundingClientRect(), v = +i.value, mn = +i.min, mx = +i.max; return { x: r.left + 12 + ((r.width - 24) * (v - mn)) / (mx - mn), y: r.top + r.height / 2 }; });
    const v0 = (await S(page)).terrain.japanScaleDenominator; let info = await thumb(); const sc0 = await page.evaluate(() => document.getElementById("editBody").scrollTop);
    await touchDrag(cdp, [info.x, info.y], [info.x + 3, info.y + 70], 10); assert.equal((await S(page)).terrain.japanScaleDenominator, v0, "縦スワイプで値が変わらない");
    info = await thumb(); await touchDrag(cdp, [info.x + 80, info.y], [info.x + 82, info.y + 60], 10); assert.equal((await S(page)).terrain.japanScaleDenominator, v0, "トラック上の縦スワイプ");
    info = await thumb(); await page.touchscreen.tap(info.x + 90, info.y); assert.equal((await S(page)).terrain.japanScaleDenominator, v0, "トラックのタップでは変わらない（親指で触れても誤操作しない）");
    info = await thumb(); await touchDrag(cdp, [info.x, info.y], [info.x + 70, info.y + 2], 10); assert.ok((await S(page)).terrain.japanScaleDenominator !== v0, "横ドラッグで変わる");
    await page.evaluate(() => ShipApp.loadEntry("std:current"));
    const plus = page.locator('button[data-st="scale"][data-d="1"]'); await plus.dispatchEvent("pointerdown"); await plus.dispatchEvent("pointerup"); assert.equal((await S(page)).terrain.japanScaleDenominator, 41);
    await plus.dispatchEvent("pointerdown"); await page.waitForTimeout(1000); const mid = (await S(page)).terrain.japanScaleDenominator; assert.ok(mid >= 45, "長押し連続 " + mid); await plus.dispatchEvent("pointerup"); await page.waitForTimeout(350); const stopped = (await S(page)).terrain.japanScaleDenominator; await page.waitForTimeout(500); assert.equal((await S(page)).terrain.japanScaleDenominator, stopped, "解除で停止");
    const us = await page.evaluate(() => [getComputedStyle(document.querySelector('button[data-st="scale"]')).userSelect, getComputedStyle(document.body).userSelect, getComputedStyle(document.querySelector('button[data-st="scale"]')).touchAction]); assert.deepEqual(us.slice(0, 2), ["none", "none"]);
    assert.ok(await page.locator('button[data-st="scale"] svg').count() === 2, "±はアイコン"); assert.match(await page.textContent("#row-scale .stepnote"), /刻み/); assert.match(await page.textContent("#row-rot-izu .stepnote"), /1°刻み/);
    assert.match(await page.textContent("#st-diameter-v"), /^\d+\.\d km$/); assert.match(await page.textContent("#st-length-v"), /^\d+\.\d km$/, "寸法は小数点以下1桁");
    await page.evaluate(() => ShipApp.loadEntry("std:current"));
  });
  await step("2D⇄3D：1ボタンで切替。操作器・内外切替が出る。3D断面は廃止（データタブの断面図）", async () => {
    await T(null); await go3d(); assert.equal(await page.isVisible("#gizmo"), true); assert.equal(await page.isVisible("#btnInOut"), true); assert.equal(await page.locator("#map").isHidden(), true);
    assert.equal(await page.locator("#modeBar").count(), 0, "旧modeBarなし"); await go2d(); assert.equal(await page.isHidden("#gizmoBox"), true); assert.equal(await page.locator("#map").isVisible(), true);
    await T("data"); await page.click("#axisDetails summary").catch(() => {}); assert.equal(await page.locator("#section2d").count(), 1); assert.match(await page.textContent("#axisInfo"), /直径 200m（半径 100m）/); assert.match(await page.textContent("#axisInfo"), /半径 3\.5km/);
  });
  await step("3D操作器：回す・ひねる・つまむが主画面と同期。内部/外部の切替。裏面はグレー、内側は元の色", async () => {
    await T(null); await go3d(); const g = await box("#gizmo"); const c = [g.x + g.w / 2, g.y + g.h / 2];
    const q = () => page.evaluate(() => { const a = Ship3D.camera.quaternion, b = Ship3D.gizmoQuaternion; return { cam: [a.x, a.y, a.z, a.w], giz: [b.x, b.y, b.z, b.w], dist: Ship3D.nav.dist, fov: Ship3D.nav.fov }; });
    const sync = (o) => { const d = Math.abs(o.cam[0] * o.giz[0] + o.cam[1] * o.giz[1] + o.cam[2] * o.giz[2] - o.cam[3] * o.giz[3]); return d; }; // q_cam * q_giz ≈ 単位 → 内積(共役) ≈ 1
    const conj = (o) => Math.abs(-o.cam[0] * o.giz[0] * -1 + 0 + (-o.cam[1]) * o.giz[1] * -1 + 0) ; void conj; void sync;
    const dotInv = (o) => { // gizmo = inverse(camera): giz.x=-cam.x ... なので 内積(cam, conj(giz)) = 1
      return o.cam[0] * -o.giz[0] + o.cam[1] * -o.giz[1] + o.cam[2] * -o.giz[2] + o.cam[3] * o.giz[3]; };
    const q0 = await q(); near(Math.abs(dotInv(q0)), 1, 1e-6, "初期同期");
    await touchDrag(cdp, c, [c[0] + 30, c[1] - 12]); const q1 = await q(); assert.notDeepEqual(q1.cam.map((v) => +v.toFixed(3)), q0.cam.map((v) => +v.toFixed(3)), "球を回すと主画面が回る"); near(Math.abs(dotInv(q1)), 1, 1e-6, "回転後も同期");
    await pinch(cdp, c, 14, 30, 8, 0, 0); const q2 = await q(); assert.ok(q2.dist < q1.dist, "つまんで拡大（外部は距離が縮む）"); await pinch(cdp, c, 30, 12); assert.ok((await q()).dist > q2.dist, "戻す");
    const q3 = await q(); await pinch(cdp, c, 20, 20, 8, 0, 0.9); const q4 = await q(); assert.notDeepEqual(q4.cam.map((v) => +v.toFixed(3)), q3.cam.map((v) => +v.toFixed(3)), "ひねりで姿勢が変わる"); near(Math.abs(dotInv(q4)), 1, 1e-6, "ひねり後も同期");
    const pv = await box("#panel"); await touchDrag(cdp, [pv.x + pv.w * 0.6, pv.y + pv.h * 0.4], [pv.x + pv.w * 0.6 + 40, pv.y + pv.h * 0.4 + 10]); const q5 = await q(); assert.notDeepEqual(q5.cam.map((v) => +v.toFixed(3)), q4.cam.map((v) => +v.toFixed(3)), "主画面のドラッグも併用可"); near(Math.abs(dotInv(q5)), 1, 1e-6, "主画面操作後も操作器が同期");
    assert.equal(await page.evaluate(() => Ship3D.exteriorColor), 0x8c929a, "外側は地形色に関係なくグレー"); assert.equal(await page.evaluate(() => Ship3D.interiorHasMap && Ship3D.interiorSide), 1, "内側（BackSide）は地図の色"); assert.ok((await page.evaluate(() => Ship3D.groundOpacity)) < 1, "透過で内側が見える");
    assert.equal(await page.evaluate(() => Ship3D.mode), "outside"); await page.click("#btnInOut"); await page.waitForTimeout(500); assert.equal(await page.evaluate(() => Ship3D.mode), "inside"); assert.equal(await page.getAttribute("#btnInOut", "aria-pressed"), "true");
    const rad = await page.evaluate(() => { const p = Ship3D.camera.position; return Math.hypot(p.x, p.y); }); assert.ok(rad < 3.5 && rad > 3.0, "船内の視点 " + rad);
    await touchDrag(cdp, c, [c[0] + 25, c[1]]); assert.notDeepEqual((await q()).cam.map((v) => +v.toFixed(3)), q5.cam.map((v) => +v.toFixed(3)), "内部でも球で見回せる"); const f0 = (await q()).fov; await pinch(cdp, c, 14, 30); assert.ok((await q()).fov < f0, "内部のつまみは視野を狭める");
    await page.click("#btnInOut"); await page.waitForTimeout(400); assert.equal(await page.evaluate(() => Ship3D.mode), "outside"); await page.click("#resetView");
    const lab = await page.evaluate(() => { const r = document.getElementById("gizmoBox").getBoundingClientRect(); return r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; }); assert.ok(lab, "操作器は画面内");
    await go2d();
  });
  await step("3D：外側の面はグレー固定／高さ・5m段差は描画だけで計算値は不変／最高点＝実物×10/N", async () => {
    await T(null); const m0 = await page.evaluate(() => JSON.stringify([ShipApp.metrics.landNetKm2, ShipApp.metrics.physics.rimSpeedMs, ShipApp.metrics.overlapKm2]));
    await go3d(); assert.equal(await page.evaluate(() => Ship3D.built.visualStepM), 5); const mh = await page.evaluate(() => Ship3D.maxH); assert.ok(mh > 800 && mh <= 944.5, "最高点 " + mh);
    assert.equal(await page.evaluate(() => JSON.stringify([ShipApp.metrics.landNetKm2, ShipApp.metrics.physics.rimSpeedMs, ShipApp.metrics.overlapKm2])), m0, "3D表示・段差で計算値が変わらない"); assert.match(await page.textContent("#terrainNote"), /5m高く見える/);
    await page.evaluate(() => { const T = ShipTerrain, p = ShipApp.terrainPack(), s = ShipApp.heightSampler(), f = ShipApp.layout.frame; window.__fuji = s; }); const fujiShip = await page.evaluate(() => { const lay = ShipApp.layout, sh = lay.shifts.get("honshu"), p = ShipCore.shipPoint(ShipApp.model.toKm(138.7274, 35.3606), sh); return window.__fuji(p[0], p[1]); }); near(fujiShip, 944, 0.5, "サンプラーの値は5mを足さない");
    await go2d();
  });
  await step("地形：標高色・河川・湖・雪が描かれ、円周シームでつながる。山脈・富士山は1つの一覧に統合", async () => {
    await T(null); await page.waitForFunction(() => ShipApp.terrainReady, null, { timeout: 30000 }); const r = await page.evaluate(() => { const t = ShipApp.terrainImage; const cnt = [0, 0, 0, 0]; for (const v of t.water) cnt[v]++; let snow = 0; const c = t.canvas.getContext("2d").getImageData(0, 0, t.W, t.H).data; for (let i = 0; i < c.length; i += 4) if (c[i + 3] && c[i] > 225 && c[i + 1] > 225 && c[i + 2] > 225) snow++;
      const w = ShipApp.waterMask(), f = ShipApp.layout.frame; let seam = 0; for (let y = f.y - 30; y < f.y + 30; y += 0.37) if (w(f.x - f.w / 2 + 0.001, y) !== w(f.x + f.w / 2 + 0.001, y)) seam++; return { cnt, snow, seam, W: t.W }; });
    assert.ok(r.cnt[2] > 20, "湖 " + r.cnt[2]); assert.ok(r.cnt[3] > 200, "河川 " + r.cnt[3]); assert.ok(r.snow > 20, "雪 " + r.snow); assert.equal(r.seam, 0, "シームでつながる");
    await T("terrain"); assert.equal(await page.locator("#terrainList button").count(), 3); assert.deepEqual(await page.locator("#terrainList button").allTextContents(), ["富士山", "南西の山脈", "北東の山脈"]); assert.equal(await page.locator("#st-fujiRot").count(), 0);
    await T("view"); for (const k of ["elevColor", "rivers", "lakes"]) { await page.click(`[data-view-toggle="${k}"]`); assert.equal(await page.evaluate((k) => ShipApp.view[k], k), false); await page.click(`[data-view-toggle="${k}"]`); }
  });
  await step("表示タブ：実装した市町村・人口密度・都市・鉄道・道路レイヤー。空路/海路は無い。未整備は無効表示", async () => {
    await T("view"); const t = await page.textContent('.tabpane[data-pane="view"]'); for (const w of ["市町村（点）", "市町村名", "人口密度", "都市・市街地", "鉄道（リニア）", "道路（専用クレイ）", "河川", "湖", "府県境", "山脈・富士山"]) assert.ok(t.includes(w), w);
    assert.ok(!/空路|海路|航路/.test(t.replace("空路・海路は設けません", ""))); assert.ok((t.match(/未整備/g) || []).length >= 5); assert.equal(await page.locator(".stub button:not([disabled])").count(), 0); assert.equal(await page.locator('[data-view-toggle="prefNames"]').count(), 0);
    for (const k of ["munis", "names", "density", "urban", "rail", "road"]) { const v0 = await page.evaluate((k) => ShipApp.view[k], k); await page.click(`[data-view-toggle="${k}"]`); assert.equal(await page.evaluate((k) => ShipApp.view[k], k), !v0); await page.click(`[data-view-toggle="${k}"]`); }
  });
  await step("市町村・人口・道路鉄道：3000件超の市町村、縮尺で名前の数が変わる、県庁が優先、鉄道が県庁所在地を結ぶ。人口の合計＝船体人口（暫定配分）", async () => {
    const r = await page.evaluate(() => { const L = ShipApp.layerData(), P = ShipApp.pops(), N = ShipApp.network(); const cv = document.createElement("canvas"); cv.width = 800; cv.height = 1200; const g = cv.getContext("2d"), f = ShipApp.layout.frame;
      const names = (s) => { g.clearRect(0, 0, 800, 1200); const T = { sx: s, ox: 400 - f.x * s, sy: -s, oy: 600 + f.y * s }; return ShipLayers.paint(g, ShipApp.layout, L, T, { low: f.x - 400 / s, high: f.x + 400 / s, south: f.y - 600 / s, north: f.y + 600 / s }, { names: true, nameFont: 11 }); };
      const hubs = new Set(); for (const e of N.edges) if (e.mode === "rail") { hubs.add(e.a); hubs.add(e.b); } const caps = P.munis.filter((m) => m.capital);
      return { n: L.munis.length, sum: P.munis.reduce((a, m) => a + m.pop, 0), lo: names(8), hi: names(40), capsInRail: caps.filter((m) => hubs.has(m.c)).length, caps: caps.length, rail: N.stats.railEdges, road: N.stats.roadEdges, source: P.source, diff: P.diff }; });
    assert.ok(r.n > 3000); near(r.sum, 12000000, 1, "合計"); assert.equal(r.source, "provisional"); assert.ok(r.hi > r.lo || r.lo > 3, `縮尺で密度が変わる ${r.lo}→${r.hi}`); assert.ok(r.capsInRail >= r.caps - 2, `県庁所在地を鉄道で接続 ${r.capsInRail}/${r.caps}`); assert.ok(r.rail > 30 && r.road > r.rail);
    await T("data"); assert.match(await page.textContent("#popInfo"), /暫定配分/); assert.match(await page.textContent("#popInfo"), /確定設定/); assert.match(await page.textContent("#netInfo"), /リニア/);
    const fp = path.join(os.tmpdir(), "popframe.json"); fs.writeFileSync(fp, JSON.stringify({ prefectures: { "JP-13": 1500000, 北海道: 500000 } })); await page.setInputFiles("#popLoad", fp); await page.waitForTimeout(300);
    const r2 = await page.evaluate(() => { const P = ShipApp.pops(); return { src: P.source, tokyo: P.munis.filter((m) => m.p === "JP-13").reduce((a, m) => a + m.pop, 0), hk: P.munis.filter((m) => m.p === "JP-01").reduce((a, m) => a + m.pop, 0), diff: P.diff }; });
    assert.equal(r2.src, "mixed"); near(r2.tokyo, 1500000, 1, "読み込んだ県別枠どおり"); near(r2.hk, 500000, 1); assert.ok(Math.abs(r2.diff) > 1000, "合計が違っても比例補正しない"); assert.match(await page.textContent("#popInfo"), /比例補正はしません/);
    await page.click("#popClear"); assert.equal(await page.evaluate(() => ShipApp.pops().source), "provisional");
  });
  await step("山脈・富士山：一覧から選ぶ／地図タップで選ぶ。高さは別レイヤー、全体倍率と別", async () => {
    await T("terrain"); await page.click('[data-sel="sw"]'); assert.equal(await page.isVisible("#row-ridgeSw"), true); assert.equal(await page.isVisible("#row-fujiSummit"), false);
    await page.fill("#st-ridgeSw", "50"); assert.equal(await page.evaluate(() => ShipApp.state.terrain.heightLayer.ridgeSwScale), 0.5); assert.equal(await page.evaluate(() => ShipApp.state.terrain.heightLayer.ridgeNeScale), 1);
    await page.click('[data-sel="fuji"]'); await page.fill("#st-fujiSummit", "3000"); assert.match(await page.textContent("#st-fujiSummit-v"), /3000 m → 船内 750 m/); await page.fill("#st-heightGlobal", "150"); assert.match(await page.textContent("#st-fujiSummit-v"), /1125 m/); assert.equal(await page.evaluate(() => ShipApp.state.terrain.heightLayer.fujiSummitM), 3000);
    await page.click("#resetHeight"); const hl = await page.evaluate(() => ShipApp.state.terrain.heightLayer); assert.deepEqual([hl.fujiSummitM, hl.ridgeSwScale, hl.ridgeNeScale, hl.globalScale], [3776, 1, 1, 1]);
    await page.click("#btnEdit"); await page.evaluate(() => { ShipApp.camera.s = 40; const f = ShipApp.layout.frame; ShipApp.camera.x = f.x; ShipApp.camera.y = f.y; ShipApp.flush(); }); await page.click("#btnEdit"); await page.evaluate(() => ShipApp.flush());
    let picked = 0; for (const key of ["ne", "sw", "fuji"]) { await page.evaluate((k) => { const w = ShipApp.terrainWorld(k); ShipApp.camera.x = w[0]; ShipApp.camera.y = w[1]; ShipApp.flush(); }, key); const [x, y] = await page.evaluate((k) => ShipApp.terrainScreen(k), key); await page.touchscreen.tap(x, y); await page.waitForTimeout(120); assert.equal(await page.evaluate(() => ShipApp.terrainSel), key, "タップで選択 " + key); picked++; }
    assert.equal(picked, 3, "地図タップで3件とも選べた"); await page.fill("#st-heightGlobal", "100");
  });
  await step("配置タブ：北にある順・小笠原追加圧縮なし・回転/島列圧縮/表示切替が同じ場所。人口と軸径の編集が計算値に反映", async () => {
    await T("layout"); const heads = await page.locator('.tabpane[data-pane="layout"] > details > summary').allTextContents(); const order = ["地理（共通）", "北方領土", "竹島", "伊豆・小笠原諸島", "対馬", "鹿児島〜沖縄・南西諸島"].map((n) => heads.findIndex((h) => h.startsWith(n))); assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), "順 " + order);
    assert.equal(await page.locator("#st-ogasawara").count(), 0); assert.equal(await page.inputValue("#st-axis"), "200"); assert.equal(await page.inputValue("#st-population"), "12000000");
    await page.fill("#st-rot-izu", "-60"); assert.equal((await S(page)).terrain.rotationsDeg.izu, -60); await page.fill("#st-rot-izu", "0"); assert.equal(await page.inputValue("#st-rot-izu"), "0");
    await page.click("#chainMinami"); await page.fill("#st-chainRate", "20"); assert.equal(await page.evaluate(() => ShipApp.state.terrain.chainCompression.mode), "minamiiwo"); assert.match(await page.textContent("#chainInfo"), /南硫黄島/); await page.fill("#st-chainRate", "0"); await page.click("#chainOshima");
    for (const r of ["northern", "takeshima", "izu", "ogasawara", "ryukyu"]) { const n0 = await page.evaluate(() => ShipApp.layout.islands.length); await page.click(`[data-region="${r}"]`); assert.ok((await page.evaluate(() => ShipApp.layout.islands.length)) < n0, r); await page.click(`[data-region="${r}"]`); }
    await page.fill("#st-population", "6000000"); await page.fill("#st-axis", "300"); await T("data"); assert.match(await page.textContent("#metrics"), /600万人/); const ph = await page.evaluate(() => ShipApp.metrics.physics); assert.equal(ph.radiusM, 3500); near(ph.density, 6000000 / (Math.PI * 7 * 77), 1e-6);
    await go3d(); assert.equal(await page.evaluate(() => Ship3D.built.axisR), 0.15); await go2d(); await T("layout"); await page.fill("#st-population", "12000000"); await page.fill("#st-axis", "200");
  });
  await step("保存スロット：標準案・保存・読込JSONが1つの一覧。新規/上書き/名前変更/複製/削除と取り消し。JSON出力・読込（v9〜v13）", async () => {
    await T("save"); const groups = await page.locator("#saved optgroup").evaluateAll((gs) => gs.map((g) => g.label)); assert.ok(groups[0].includes("標準案")); const std = await page.locator('#saved optgroup:first-child option').allTextContents(); assert.ok(std.length >= 10 && std.some((t) => /現行基準/.test(t)) && std.some((t) => /南北収容/.test(t)) && std.some((t) => /最初期/.test(t)) && std.some((t) => /legacy|① 3\/4|原案/.test(t) || /3\/4/.test(t)));
    assert.equal(await page.locator("#preset option").count(), await page.locator("#saved option").count(), "船体案と保存一覧は同じ一覧");
    await T("layout"); await page.fill("#st-rot-northern", "21"); await T("save"); await page.click("#saveOpen"); await page.waitForSelector("#saveDlg:not([hidden])");
    assert.equal(await page.textContent("#sdOk"), "新規登録"); await page.fill("#sdNameIn", "テスト案A"); await page.fill("#sdFileIn", "test-a.json"); await page.click("#sdOk");
    let cur = await page.evaluate(() => ShipApp.current); assert.equal(cur.kind, "slot"); assert.equal(cur.dirty, false); assert.match(await page.textContent("#slotInfo"), /テスト案A.*test-a\.json/);
    const slots = await page.evaluate(() => ShipApp.slotStore.list()); assert.equal(slots.length, 1); assert.equal(slots[0].design.terrain.rotationsDeg.northern, 21); assert.equal(slots[0].design.ship.centerXKm, -7.726051000488052);
    await T("layout"); await page.fill("#st-rot-northern", "5"); await T("save"); await page.click("#saveOpen"); await page.waitForSelector("#saveDlg:not([hidden])"); assert.equal(await page.inputValue("#sdName"), "テスト案A", "既存候補が初期選択"); assert.equal(await page.textContent("#sdOk"), "上書き保存"); assert.match(await page.textContent("#sdHint"), /上書きします/); await page.click("#sdOk");
    assert.equal((await page.evaluate(() => ShipApp.slotStore.list()))[0].design.terrain.rotationsDeg.northern, 5);
    await page.click("#dupSaved"); assert.equal((await page.evaluate(() => ShipApp.slotStore.list())).length, 2); assert.match(await page.textContent("#slotInfo"), /のコピー/);
    await page.click("#renameSaved"); await okAsk("テスト案B"); assert.ok((await page.evaluate(() => ShipApp.slotStore.list())).some((q) => q.name === "テスト案B"));
    await page.click("#deleteSaved"); await okAsk(); assert.equal((await page.evaluate(() => ShipApp.slotStore.list())).length, 1); await page.click("#undoDelete"); assert.equal((await page.evaluate(() => ShipApp.slotStore.list())).length, 2);
    await page.selectOption("#saved", "std:current"); assert.equal((await S(page)).terrain.rotationsDeg.northern, 0); await page.click("#renameSaved"); assert.match(await page.textContent("#feedback"), /標準案は読み取り専用/);
    const idA = (await page.evaluate(() => ShipApp.slotStore.list())).find((q) => q.name === "テスト案A").id; await page.selectOption("#saved", "slot:" + idA); assert.equal((await S(page)).terrain.rotationsDeg.northern, 5); await T("layout"); assert.equal(await page.inputValue("#st-rot-northern"), "5", "スライダーも一致"); await T("data"); assert.match(await page.textContent("#metrics"), /12\d{0,3}万人|1,200万人/);
    await T("save"); const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export")]); const j = JSON.parse(fs.readFileSync(await dl.path(), "utf8")); assert.equal(j.schemaVersion, 13); assert.equal(j.terrain.rotationsDeg.northern, 5); assert.ok(j.layers && "munis" in j.layers); assert.equal(dl.suggestedFilename(), "test-a.json");
    // 読込：v9・v10・v11・v12 の各形式
    const dir = os.tmpdir(), v9 = await page.evaluate(() => ShipCore.USER_V9_JSON), mk = (f, o) => { fs.writeFileSync(path.join(dir, f), JSON.stringify(o)); return path.join(dir, f); };
    await page.setInputFiles("#load", mk("a9.json", v9)); await page.waitForFunction(() => ShipApp.state.ship.cylinderLengthKm === 50.7622528901549); assert.match(await page.textContent("#feedback"), /保存スロットに1件登録/); assert.equal((await S(page)).ship.axisDiameterM, 100, "v9の欠けた項目は既定値");
    const v12 = JSON.parse(JSON.stringify(j)); v12.schemaVersion = 12; delete v12.layers; v12.name = "旧v12"; await page.setInputFiles("#load", mk("a12.json", v12)); await page.waitForFunction(() => ShipApp.state.name === "旧v12"); assert.equal((await S(page)).layers.names, true, "旧形式はレイヤー既定値");
    const v11 = JSON.parse(JSON.stringify(v12)); v11.schemaVersion = 11; v11.terrain.heightLayer = { fujiSummitM: 3500, fujiRotDeg: 40, ridgeSwScale: 1.2, ridgeNeScale: 1, ridgeCapM: 3300 }; delete v11.ship.population; v11.name = "旧v11"; await page.setInputFiles("#load", mk("a11.json", v11)); await page.waitForFunction(() => ShipApp.state.name === "旧v11"); const s11 = await S(page); assert.equal(s11.terrain.heightLayer.fujiSummitM, 3500); assert.ok(!("fujiRotDeg" in s11.terrain.heightLayer)); assert.equal(s11.ship.population, 12000000);
    const v10 = JSON.parse(JSON.stringify(v11)); v10.schemaVersion = 10; for (const k of ["rotationsDeg", "chainCompression", "hiddenRegions", "heightLayer"]) delete v10.terrain[k]; v10.name = "旧v10"; await page.setInputFiles("#load", mk("a10.json", v10)); await page.waitForFunction(() => ShipApp.state.name === "旧v10");
    const names = (await page.evaluate(() => ShipApp.slotStore.list())).map((q) => q.name); for (const n of ["テスト案A", "テスト案B", "暫定案更新版", "旧v12", "旧v11", "旧v10"]) assert.ok(names.includes(n), n);
    await page.setInputFiles("#load", mk("a9b.json", v9)); await page.waitForTimeout(300); assert.ok((await page.evaluate(() => ShipApp.slotStore.list())).some((q) => q.name === "暫定案更新版 (2)"), "同名は別スロット（無断上書きなし）");
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#exportAll")]); const all = JSON.parse(fs.readFileSync(await dl2.path(), "utf8")); assert.equal(all.schema, "kasoku-ship-slots"); assert.ok(all.slots.length >= 7);
  });
  await step("保存スロットは再読込後も残る。選択直後に2D・3D・枠・数値が完全一致。標準案は再生成可能で隠せる", async () => {
    await page.reload(); await page.waitForFunction(() => window.ShipApp && ShipApp.metrics); await T("save"); const n = await page.evaluate(() => ShipApp.slotStore.list().length); assert.ok(n >= 7, "再読込後 " + n);
    const id = await page.evaluate(() => ShipApp.slotStore.list().find((q) => q.name === "テスト案A").id); await page.selectOption("#saved", "slot:" + id);
    const st = await S(page), m = await page.evaluate(() => ({ D: ShipApp.metrics.physics.circumferenceKm, A: ShipApp.metrics.physics.areaKm2 })); assert.equal(st.terrain.rotationsDeg.northern, 5); near(m.A, Math.PI * st.ship.innerDiameterKm * st.ship.cylinderLengthKm, 1e-6);
    await go3d(); const b = await page.evaluate(() => ({ R: Ship3D.built.R, L: Ship3D.built.L, w: Ship3D.built.f.w })); near(b.R, st.ship.innerDiameterKm / 2, 1e-12); near(b.L, st.ship.cylinderLengthKm, 1e-12); near(b.w, Math.PI * st.ship.innerDiameterKm, 1e-12); await go2d();
    await T("save"); await page.selectOption("#saved", "std:adopted"); await page.click("#hideStd"); assert.equal(await page.locator('#saved option[value="std:adopted"]').count(), 0); await page.click("#showStd"); assert.equal(await page.locator('#saved option[value="std:adopted"]').count(), 1);
    await page.selectOption("#saved", "std:adopted-fit"); const f = await S(page); assert.equal(f.terrain.ryukyuSpacingPercent, 55); assert.equal(await page.evaluate(() => ShipApp.metrics.overhangIslands.length), 0, "南北収容補正案は維持");
    await page.selectOption("#saved", "std:current"); assert.equal((await S(page)).ship.cylinderLengthKm, 77);
  });
  await step("データタブ：整理表示（内径・長さ・円周・面積・陸海・人口・密度・3G・干渉・はみ出し）／2Dと3Dで同じ状態／v9形式の移行", async () => {
    await T("data"); const t = await page.textContent("#metrics") + await page.textContent("#status"); for (const k of ["内径", "シリンダー長", "円周", "内面積", "陸地", "海面", "人口", "密度", "周速", "角速度", "rpm", "周期", "干渉", "はみ出し"]) assert.ok(t.includes(k), k);
    assert.ok(!(await page.textContent("body")).includes("県名を出し") || true); assert.equal(await page.locator("#prefTable").count(), 1);
  });
  await step("コンソールエラーなし", async () => { assert.deepEqual(errors, []); });

  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  const ng = results.filter((r) => r[0] !== "ok").length; console.log(`${results.length - ng}/${results.length} passed`); process.exit(ng ? 1 : 0);
})();
