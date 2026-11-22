// Pixel 7 emulation (Android Chrome equivalent). Run: THREE_DIR=<folder with three@0.128.0 "package"> node tests/e2e/mobile.e2e.cjs
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
    assert.equal(saves[0].name, "改名テスト"); assert.equal(saves[0].ship.centerXKm, -7.726051000488052); assert.equal(saves[0].schemaVersion, 10);
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
  await step("コンソールエラーなし", async () => { assert.deepEqual(errors, []); });

  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  const ng = results.filter((r) => r[0] !== "ok").length; console.log(`${results.length - ng}/${results.length} passed`); process.exit(ng ? 1 : 0);
})();
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`); }
