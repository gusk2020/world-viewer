// Pixel 7 emulation (Android Chrome equivalent). Run: node tests/e2e/mobile.e2e.cjs   (BASE_URL=https://… で公開URLに対して実行)
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const { open } = require("./harness.cjs");
const results = [];
async function step(name, fn) { try { await fn(); results.push(["ok", name]); } catch (e) { results.push(["NG", name + " :: " + e.message.split("\n")[0]]); } }
const S = (page) => page.evaluate(() => JSON.parse(JSON.stringify(ShipApp.state)));
async function handlePos(page, id) { return page.evaluate((id) => { const r = ShipApp.frameRect(), c = document.getElementById("map").getBoundingClientRect(); const h = { t: [r.x + r.w / 2, r.y], b: [r.x + r.w / 2, r.y + r.h], l: [r.x, r.y + r.h / 2], r: [r.x + r.w, r.y + r.h / 2], rt: [r.x + r.w, r.y], mid: [r.x + r.w / 2, r.y + r.h / 2] }[id]; return [c.left + h[0], c.top + h[1]]; }, id); }
async function touchDrag(cdp, from, to, steps = 8) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1], id: 1 }] });
  for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from[0] + ((to[0] - from[0]) * i) / steps, y: from[1] + ((to[1] - from[1]) * i) / steps, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function pinch(cdp, c, d0, d1, steps = 8) {
  const pts = (d) => [{ x: c[0] - d, y: c[1], id: 1 }, { x: c[0] + d, y: c[1], id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(d0 + ((d1 - d0) * i) / steps) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

(async () => {
  const { browser, context, page, errors } = await open({ context: { acceptDownloads: true } });
  const cdp = await context.newCDPSession(page);
  const okAsk = async (text) => { await page.waitForSelector("#ask:not([hidden])"); if (text !== undefined) await page.fill("#askInput", text); await page.click("#askOk"); };

  await step("起動時は採用基準案（6.00km × 51.0km、3G、密度12,483人/km²）", async () => {
    const s = await S(page); assert.equal(s.ship.innerDiameterKm, 6); assert.equal(s.ship.cylinderLengthKm, 51); assert.equal(s.ship.centerXKm, -7.726051000488052);
    const t = await page.textContent("#metrics"); assert.match(t, /6\.00 km/); assert.match(t, /51\.0 km/); assert.match(t, /12,483/); assert.match(t, /297\.1 m\/s/); assert.match(t, /0\.946 rpm/);
    assert.equal(await page.inputValue("#preset"), "adopted");
  });
  await step("初期値で南西諸島の干渉0、その他の干渉は表示・記録", async () => { const t = await page.textContent("#status"); assert.match(t, /南西諸島0か所/); });
  await step("ページの横スクロールが出ない", async () => { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); });

  await step("右辺◆ドラッグは内径だけ、上辺◆は長さだけ変わる", async () => {
    const a = await S(page); await touchDrag(cdp, await handlePos(page, "r"), (await handlePos(page, "r")).map((v, i) => v + (i ? 0 : 30)));
    const b = await S(page); assert.ok(b.ship.innerDiameterKm > a.ship.innerDiameterKm + 0.1); assert.equal(b.ship.cylinderLengthKm, a.ship.cylinderLengthKm);
    await touchDrag(cdp, await handlePos(page, "t"), (await handlePos(page, "t")).map((v, i) => v - (i ? 30 : 0)));
    const c = await S(page); assert.ok(c.ship.cylinderLengthKm > b.ship.cylinderLengthKm + 0.5); near(c.ship.innerDiameterKm, b.ship.innerDiameterKm);
    assert.equal(await page.inputValue("#preset"), "custom"); assert.match(await page.textContent("#presetState"), /カスタム案/);
  });
  await step("角●ドラッグは縦横とも変わる（固定比率にならない）", async () => {
    const a = await S(page); const p = await handlePos(page, "rt"); await touchDrag(cdp, p, [p[0] + 25, p[1] - 5]);
    const b = await S(page); const ra = a.ship.cylinderLengthKm / a.ship.innerDiameterKm, rb = b.ship.cylinderLengthKm / b.ship.innerDiameterKm;
    assert.ok(Math.abs(ra - rb) > 0.05);
  });
  await step("枠内ドラッグで船体が移動", async () => { const a = await S(page); const p = await handlePos(page, "mid"); await touchDrag(cdp, p, [p[0] + 20, p[1] + 20]); const b = await S(page); assert.ok(b.ship.centerXKm > a.ship.centerXKm && b.ship.centerYKm < a.ship.centerYKm); });

  await step("採用基準案に戻す", async () => { await page.click("#resetAll"); const s = await S(page); assert.equal(s.ship.innerDiameterKm, 6); assert.equal(await page.inputValue("#preset"), "adopted"); });

  await step("日本列島モード：枠を覆う倍率でも1本指＝表示移動・ピンチ＝拡大、船体は動かない", async () => {
    await page.click("#modeJapan");
    await page.evaluate(() => { ShipApp.camera.s = 60; ShipApp.flush(); });
    const a = await S(page), c0 = await page.evaluate(() => ({ ...ShipApp.camera }));
    const mid = await handlePos(page, "mid"); await touchDrag(cdp, mid, [mid[0] + 40, mid[1]]);
    const c1 = await page.evaluate(() => ({ ...ShipApp.camera })); assert.ok(c1.x < c0.x - 0.1);
    await pinch(cdp, mid, 40, 110); const c2 = await page.evaluate(() => ({ ...ShipApp.camera })); assert.ok(c2.s > c1.s * 1.8);
    assert.deepEqual((await S(page)).ship, a.ship);
    await page.click("#modeCylinder");
  });
  await step("シリンダーモード：枠外ピンチは表示倍率", async () => {
    await page.click("#resetView"); const c0 = await page.evaluate(() => ShipApp.camera.s); const a = await S(page);
    const box = await page.locator("#map").boundingBox(); await pinch(cdp, [box.x + 30, box.y + 60], 10, 25);
    assert.ok((await page.evaluate(() => ShipApp.camera.s)) > c0); assert.deepEqual((await S(page)).ship, a.ship);
  });

  await step("±ボタン：1回押しで1目盛、長押しで連続", async () => {
    await page.click("#resetAll");
    const plus = page.locator('button[data-st="scale"][data-d="1"]');
    await plus.dispatchEvent("pointerdown"); await plus.dispatchEvent("pointerup");
    assert.equal((await S(page)).terrain.japanScaleDenominator, 41);
    await plus.dispatchEvent("pointerdown"); await page.waitForTimeout(900); await plus.dispatchEvent("pointerup");
    const v = (await S(page)).terrain.japanScaleDenominator; assert.ok(v >= 45, "long press reached " + v);
    assert.match(await page.textContent("#st-scale-v"), new RegExp("1/" + v));
  });

  await step("比較案の選択で枠・数値・スライダーが同期", async () => {
    await page.selectOption("#preset", "legacy-2");
    const s = await S(page); assert.equal(s.ship.innerDiameterKm, 4); assert.equal(s.ship.cylinderLengthKm, 38.5);
    assert.match(await page.textContent("#metrics"), /4\.00 km/); assert.equal(await page.inputValue("#st-diameter"), "4");
    await page.selectOption("#preset", "initial-third"); assert.equal((await S(page)).terrain.japanScaleDenominator, 3);
    await page.selectOption("#preset", "adopted");
  });

  await step("沖ノ鳥島・南鳥島は別々に切替", async () => {
    await page.click('[data-toggle="showOkinotori"]');
    const s = await S(page); assert.equal(s.terrain.showOkinotori, false); assert.equal(s.terrain.showMinamitori, true);
    await page.click('[data-toggle="showOkinotori"]');
  });

  await step("名前付き保存・上書き確認・名前変更・再読込後も残る", async () => {
    await page.selectOption("#preset", "adopted");
    await page.fill("#saveName", "テスト案A"); await page.click("#save");
    await page.fill("#saveName", "テスト案A"); await page.click("#save"); await okAsk(); // overwrite → in-page confirm
    let n = await page.evaluate(() => JSON.parse(localStorage.getItem("kasoku-ship-designer-v10-saves")).length); assert.equal(n, 1);
    await page.selectOption("#saved", "0"); await page.click("#renameSaved"); await okAsk("改名テスト"); await page.waitForTimeout(100);
    await page.reload(); await page.waitForFunction(() => window.ShipApp && ShipApp.metrics);
    const saves = await page.evaluate(() => JSON.parse(localStorage.getItem("kasoku-ship-designer-v10-saves")));
    assert.equal(saves[0].name, "改名テスト"); assert.equal(saves[0].ship.centerXKm, -7.726051000488052); assert.equal(saves[0].schemaVersion, 11);
  });

  await step("JSON出力の内容が画面の値と一致", async () => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
    const j = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    assert.equal(j.ship.innerDiameterKm, 6); assert.equal(j.terrain.japanScaleDenominator, 40); assert.ok(Math.abs(j.gravity.rimSpeedMs - 297.0856) < 1e-3); assert.ok(j.geoData && j.terrain.islandOffsetsKm);
    assert.deepEqual(JSON.parse(await page.inputValue("#jsonOut")), j); // the copy box shows the same JSON
  });
  await step("旧v9 JSON（利用者の保存ファイル）を読み込める", async () => {
    const f = path.join(os.tmpdir(), "v9-test.json");
    fs.writeFileSync(f, JSON.stringify(await page.evaluate(() => ShipCore.USER_V9_JSON)));
    await page.setInputFiles("#load", f);
    await page.waitForFunction(() => ShipApp.state.ship.cylinderLengthKm === 50.7622528901549);
    assert.match(await page.textContent("#feedback"), /旧v9形式/);
  });

  await step("2D→3D→2Dで状態が一致（同じ寸法・同じ地図）", async () => {
    await page.selectOption("#preset", "adopted");
    const before = await S(page);
    for (const v of ["overview", "section", "inside"]) {
      await page.click(`#views button[data-view=${v}]`); await page.waitForFunction(() => window.Ship3D && Ship3D.built);
      await page.waitForTimeout(400);
      const b = await page.evaluate(() => ({ R: Ship3D.built.R, L: Ship3D.built.L, w: Ship3D.built.f.w, tex: Ship3D.texture.width }));
      assert.equal(b.R, 3); assert.equal(b.L, 51); assert.ok(Math.abs(b.w - Math.PI * 6) < 1e-12);
    }
    await page.click('#views button[data-view="2d"]'); assert.deepEqual(await S(page), before);
  });
  await step("自転表示は見かけの速度、物理値は別表示", async () => {
    await page.click('#views button[data-view="overview"]'); await page.waitForTimeout(300);
    assert.match(await page.textContent("#spinNote"), /0\.946 rpm.*20倍速（見かけ）/);
    await page.click('#views button[data-view="2d"]');
  });
  await step("候補案：はみ出しなし／採用基準案は元のまま／2D・保存JSON・3Dが一致", async () => {
    await page.selectOption("#preset", "adopted");
    const a = await S(page); assert.equal(a.terrain.ryukyuSpacingPercent, 90);
    assert.match(await page.textContent("#status"), /南 49島/);
    await page.selectOption("#preset", "adopted-fit");
    const b = await S(page);
    assert.equal(b.ship.innerDiameterKm, 6); assert.equal(b.ship.cylinderLengthKm, 51); assert.equal(b.ship.population, 12000000); assert.equal(b.terrain.japanScaleDenominator, 40);
    assert.ok(b.ship.centerYKm < a.ship.centerYKm); assert.equal(b.ship.centerXKm, a.ship.centerXKm);
    assert.match(await page.textContent("#status"), /はみ出し：なし/); assert.match(await page.textContent("#status"), /地形干渉/);
    assert.match(await page.textContent("#offsetInfo"), /沖ノ鳥島 北へ/);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
    const j = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    assert.equal(j.ship.centerYKm, b.ship.centerYKm); assert.equal(j.terrain.ryukyuSpacingPercent, b.terrain.ryukyuSpacingPercent); assert.deepEqual(j.report.overhangs, []);
    assert.ok(j.terrain.islandOffsetsNorthKm.okinotori > 0);
    await page.click('#views button[data-view="section"]'); await page.waitForFunction(() => Ship3D.built); await page.waitForTimeout(300);
    const t3 = await page.evaluate(() => ({ L: Ship3D.built.L, y: Ship3D.built.f.y, sp: ShipApp.state.terrain.ryukyuSpacingPercent }));
    assert.equal(t3.L, 51); assert.equal(t3.y, b.ship.centerYKm); assert.equal(t3.sp, b.terrain.ryukyuSpacingPercent);
    await page.click('#views button[data-view="2d"]');
    await page.click('[data-toggle="showOkinotori"]'); assert.equal((await S(page)).terrain.showMinamitori, true); await page.click('[data-toggle="showOkinotori"]');
    await page.selectOption("#preset", "adopted"); assert.deepEqual((await S(page)).ship, a.ship); // 元に戻せる
  });
  await step("v11 メニュー：県名の表示切替が無い／県境・都市の切替は残る／47都道府県の表", async () => {
    assert.equal(await page.locator('[data-view-toggle="prefNames"]').count(), 0);
    assert.ok(!(await page.textContent("main")).includes("県名")  || /県名を出しません/.test(await page.textContent("#prefDetails summary")));
    assert.equal(await page.locator('[data-view-toggle="borders"]').count(), 1); assert.equal(await page.locator('[data-view-toggle="cities"]').count(), 1);
    await page.evaluate(() => { document.getElementById("prefDetails").open = true; });
    assert.equal(await page.locator("#prefTable tr").count(), 48); assert.match(await page.textContent("#prefTable"), /東京都/); assert.ok(!/東京府/.test(await page.textContent("#prefTable"))); assert.match(await page.textContent("#prefTable"), /北海道/);
    assert.ok(!/札幌県|函館県|根室県/.test(await page.textContent("#prefTable")));
  });
  await step("3地域の回転スライダー：独立・正負・±1・長押し・0で復帰・本土は不動", async () => {
    await page.selectOption("#preset", "adopted");
    const hon0 = await page.evaluate(() => JSON.stringify(ShipApp.layout.islands.find((i) => i.id === "honshu").ring));
    const rot = () => page.evaluate(() => ({ ...ShipApp.state.terrain.rotationsDeg }));
    const plus = (k) => page.locator(`button[data-st="rot-${k}"][data-d="1"]`), minus = (k) => page.locator(`button[data-st="rot-${k}"][data-d="-1"]`);
    await plus("izu").dispatchEvent("pointerdown"); await plus("izu").dispatchEvent("pointerup"); assert.deepEqual(await rot(), { izu: 1, ryukyu: 0, northern: 0 });
    await minus("ryukyu").dispatchEvent("pointerdown"); await minus("ryukyu").dispatchEvent("pointerup"); assert.deepEqual(await rot(), { izu: 1, ryukyu: -1, northern: 0 });
    await plus("northern").dispatchEvent("pointerdown"); await page.waitForTimeout(1000); await plus("northern").dispatchEvent("pointerup");
    const r = await rot(); assert.ok(r.northern >= 6, "長押し連続 " + r.northern); assert.equal(r.izu, 1); assert.equal(r.ryukyu, -1);
    await page.fill("#st-rot-izu", "-30"); assert.equal((await rot()).izu, -30); assert.match(await page.textContent("#st-rot-izu-v"), /-30°/);
    assert.equal(await page.evaluate(() => JSON.stringify(ShipApp.layout.islands.find((i) => i.id === "honshu").ring)), hon0, "本州は回転しない");
    await page.fill("#st-rot-izu", "0"); await page.fill("#st-rot-ryukyu", "0"); await page.fill("#st-rot-northern", "0");
    assert.deepEqual(await rot(), { izu: 0, ryukyu: 0, northern: 0 });
    assert.equal(await page.evaluate(() => ShipApp.metrics.overhangIslands.length), 49, "0°で採用基準案と同じはみ出し");
    assert.match(await page.textContent("#rotInfo"), /伊豆大島の中心/); assert.match(await page.textContent("#rotInfo"), /屋久島の中心/); assert.match(await page.textContent("#rotInfo"), /納沙布岬/);
  });
  await step("回転後に干渉とはみ出しが再計算され、赤い面・橙の表示は維持", async () => {
    const before = await page.evaluate(() => ({ i: ShipApp.interference.length, o: ShipApp.metrics.overhangIslands.map((x) => x.id + x.southKm.toFixed(2)).join() }));
    await page.fill("#st-rot-ryukyu", "25"); await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ i: ShipApp.interference.length, o: ShipApp.metrics.overhangIslands.map((x) => x.id + x.southKm.toFixed(2)).join() }));
    assert.notEqual(after.o, before.o); assert.match(await page.textContent("#status"), /はみ出し/); assert.match(await page.textContent("#status"), /地形干渉/);
    await page.fill("#st-rot-ryukyu", "0");
  });
  await step("島列圧縮：2方向・固定端の表示・±長押し・0%で無効", async () => {
    await page.selectOption("#preset", "adopted");
    const pos = (id) => page.evaluate((id) => ShipApp.layout.islands.find((i) => i.id === id).c, id);
    const o0 = await pos("izuoshima"), m0 = await pos("minamiiwo");
    await page.locator('button[data-st="chainRate"][data-d="1"]').dispatchEvent("pointerdown"); await page.waitForTimeout(900); await page.locator('button[data-st="chainRate"][data-d="1"]').dispatchEvent("pointerup");
    const rate = await page.evaluate(() => ShipApp.state.terrain.chainCompression.ratePercent); assert.ok(rate >= 4, "rate " + rate);
    assert.deepEqual(await pos("izuoshima"), o0, "伊豆大島を固定"); assert.notDeepEqual(await pos("minamiiwo"), m0);
    assert.match(await page.textContent("#chainInfo"), /固定端＝伊豆大島/); assert.match(await page.textContent("#chainInfo"), /適用順/);
    await page.click("#chainMinami"); assert.deepEqual(await pos("minamiiwo"), m0, "南硫黄島を固定"); assert.notDeepEqual(await pos("izuoshima"), o0);
    assert.match(await page.textContent("#chainInfo"), /固定端＝南硫黄島/); assert.equal(await page.evaluate(() => ShipApp.state.terrain.chainCompression.mode), "minamiiwo");
    await page.fill("#st-chainRate", "0"); assert.deepEqual(await pos("izuoshima"), o0); assert.deepEqual(await pos("minamiiwo"), m0);
    await page.click("#chainOshima");
  });
  await step("地域の表示切替（北方領土・竹島・伊豆・琉球・小笠原）", async () => {
    const n = () => page.evaluate(() => ShipApp.layout.islands.length);
    const n0 = await n();
    for (const r of ["northern", "takeshima", "izu", "ogasawara", "ryukyu"]) { await page.click(`[data-region="${r}"]`); assert.ok((await n()) < n0, r); assert.ok(await page.evaluate((r) => ShipApp.state.terrain.hiddenRegions.includes(r), r)); await page.click(`[data-region="${r}"]`); assert.equal(await n(), n0); }
    assert.equal(await page.evaluate(() => ShipApp.layout.islands.filter((i) => i.region === "northern").length), 8);
  });
  await step("3D地形：標高が1/40で反映され、地形変更レイヤー（富士山）が2D設定と連動", async () => {
    await page.selectOption("#preset", "adopted");
    await page.click('#views button[data-view="overview"]'); await page.waitForFunction(() => Ship3D.built); await page.waitForTimeout(600);
    const h0 = await page.evaluate(() => Ship3D.maxH); assert.ok(h0 > 60 && h0 <= 94.5, "最高点 " + h0);
    assert.match(await page.textContent("#terrainNote"), /1\/40/);
    await page.click('#views button[data-view="2d"]');
    const plus = page.locator('button[data-st="fujiSummit"][data-d="-1"]');
    for (let i = 0; i < 100; i++) await plus.dispatchEvent("click", { detail: 0 }).catch(() => {});
    const summit = await page.evaluate(() => ShipApp.state.terrain.heightLayer.fujiSummitM); assert.ok(summit < 3776, "富士山の頂 " + summit);
    await page.click('#views button[data-view="overview"]'); await page.waitForTimeout(800);
    const h1 = await page.evaluate(() => Ship3D.maxH); assert.ok(h1 < h0, "3Dに反映 " + h0 + " → " + h1);
    await page.click('#views button[data-view="2d"]'); await page.click("#resetHeight");
    assert.equal(await page.evaluate(() => ShipApp.state.terrain.heightLayer.fujiSummitM), 3776);
  });
  await step("3D：見通し（透過）・視点の高さ・視線（前方/真上）・断面・中心軸 直径100m", async () => {
    await page.click('#views button[data-view="overview"]'); await page.waitForFunction(() => Ship3D.built); await page.waitForTimeout(400);
    const op0 = await page.evaluate(() => Ship3D.groundOpacity); await page.click("#seeThru3d"); await page.waitForTimeout(500); const op1 = await page.evaluate(() => Ship3D.groundOpacity); assert.ok(op1 < op0, "透過で地面が薄くなる"); await page.click("#seeThru3d");
    assert.equal(await page.evaluate(() => Ship3D.built.axisR), 0.05); // 半径50m
    await page.click('#views button[data-view="section"]'); await page.waitForTimeout(500); assert.equal(await page.evaluate(() => Ship3D.built.axisR), 0.05);
    await page.click('#views button[data-view="inside"]'); await page.waitForTimeout(600); assert.equal(await page.evaluate(() => Ship3D.built.axisR), 0.05);
    assert.ok(await page.isVisible("#insideCtl"));
    const radial = () => page.evaluate(() => { const p = Ship3D.camera.position; return Math.hypot(p.x, p.y); });
    const r150 = await radial(); await page.fill("#eyeH", "1500"); const r1500 = await radial(); assert.ok(r1500 < r150 - 1.0, `視点を上げると軸に近づく ${r150} → ${r1500}`);
    near2(r150, 3 - 0.15 - (await page.evaluate(() => 0)), 0.2);
    await page.locator('button[data-eye="1"]').dispatchEvent("pointerdown"); await page.locator('button[data-eye="1"]').dispatchEvent("pointerup"); assert.equal(await page.evaluate(() => Ship3D.eyeH), 1501);
    const dirAhead = await page.evaluate(() => { const c = Ship3D.camera, d = new c.position.constructor(); c.getWorldDirection(d); return [d.x, d.y, d.z]; });
    await page.click('[data-look="up"]'); const dirUp = await page.evaluate(() => { const c = Ship3D.camera, d = new c.position.constructor(); c.getWorldDirection(d); return [d.x, d.y, d.z]; });
    assert.notDeepEqual(dirAhead.map((v) => +v.toFixed(2)), dirUp.map((v) => +v.toFixed(2))); await page.click('[data-look="ahead"]');
    await page.click('#views button[data-view="2d"]');
    assert.match(await page.textContent("#axisInfo"), /直径 100m（半径 50m）/); assert.match(await page.textContent("#axisInfo"), /半径 3km/);
  });
  await step("船体案の切替が回転・圧縮・高さを含めて同期（採用基準案／南北収容補正案）", async () => {
    await page.fill("#st-rot-izu", "15"); await page.fill("#st-chainRate", "20");
    await page.selectOption("#preset", "adopted-fit"); const f = await S(page);
    assert.equal(f.terrain.rotationsDeg.izu, 0); assert.equal(f.terrain.chainCompression.ratePercent, 0); assert.equal(f.terrain.ryukyuSpacingPercent, 55); assert.equal(await page.inputValue("#st-rot-izu"), "0");
    assert.equal(await page.evaluate(() => ShipApp.metrics.overhangIslands.length), 0);
    await page.selectOption("#preset", "adopted"); assert.equal((await S(page)).terrain.ryukyuSpacingPercent, 90);
  });
  await step("保存JSONに回転角・圧縮率・高さレイヤーが含まれ、読み込みで復元", async () => {
    await page.fill("#st-rot-northern", "12"); await page.fill("#st-chainRate", "15"); await page.click("#chainMinami");
    await page.fill("#saveName", "v11テスト"); await page.click("#save");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export")]); const j = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    assert.equal(j.schemaVersion, 11); assert.equal(j.regionRotations.northern.angleDeg, 12); assert.equal(j.chainCompression.ratePercent, 15); assert.equal(j.chainCompression.fixedIslandId, "minamiiwo"); assert.equal(j.terrain.heightLayer.fujiSummitM, 3776); assert.equal(j.ship.axisDiameterM, 100);
    await page.selectOption("#preset", "adopted");
    const idx = await page.evaluate(() => JSON.parse(localStorage.getItem("kasoku-ship-designer-v10-saves")).findIndex((s) => s.name === "v11テスト")); await page.selectOption("#saved", String(idx));
    const s = await S(page); assert.equal(s.terrain.rotationsDeg.northern, 12); assert.equal(s.terrain.chainCompression.ratePercent, 15); assert.equal(s.terrain.chainCompression.mode, "minamiiwo");
    await page.selectOption("#preset", "adopted");
  });
  await step("コンソールエラーなし", async () => { assert.deepEqual(errors, []); });

  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  const ng = results.filter((r) => r[0] !== "ok").length; console.log(`${results.length - ng}/${results.length} passed`); process.exit(ng ? 1 : 0);
})();
function near2(a, b, tol) { assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`); }
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`); }
