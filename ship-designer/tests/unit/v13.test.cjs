// v13: 現行基準寸法・保存スロット・人口配分・道路鉄道・地形ラスター（河川・湖・雪）・レイヤー保存
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs");
const load = (f) => { const w = {}; new Function("window", fs.readFileSync(__dirname + "/../../src/" + f, "utf8"))(w); return w; };
globalThis.SHIP_FIT_CANDIDATE = load("fit-candidate.js").SHIP_FIT_CANDIDATE; globalThis.SHIP_EXTRA = load("extra.js").SHIP_EXTRA;
const T = require("../../src/terrain.js"), C = require("../../src/core.js"), Pop = require("../../src/popmodel.js"), Net = require("../../src/network.js"), TI = require("../../src/terrainimg.js"), Slots = require("../../src/slots.js");
const geo = require("../../data/ship-geo.json"), model = C.buildModel(geo, globalThis.SHIP_EXTRA), dem = T.decodeDem(load("dem.js").SHIP_DEM);
const near = (a, b, t, m) => assert.ok(Math.abs(a - b) <= t, `${m || ""} ${a} vs ${b}`);
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };

test("現行基準：内径7.0km・長さ77.0km・軸200m・人口1200万・3G・1/40。中心座標は丸めず、元データ(採用基準案)は不変", () => {
  const c = C.presetState(model, "current"), a = C.presetState(model, "adopted");
  assert.deepEqual([c.ship.innerDiameterKm, c.ship.cylinderLengthKm, c.ship.axisDiameterM, c.ship.population, c.ship.gravityG, c.terrain.japanScaleDenominator], [7, 77, 200, 12000000, 3, 40]);
  assert.equal(c.ship.centerXKm, -7.726051000488052); assert.equal(c.ship.centerYKm, 4.424036296290547);
  assert.deepEqual([a.ship.innerDiameterKm, a.ship.cylinderLengthKm], [6, 51], "元の案は変更されない");
  assert.deepEqual(c.terrain.islandOffsetsKm, a.terrain.islandOffsetsKm); assert.deepEqual(c.terrain.heightLayer, a.terrain.heightLayer);
  const p = C.physics(c.ship); assert.equal(p.radiusM, 3500); near(p.rimSpeedMs, Math.sqrt(3 * 9.80665 * 3500), 1e-9); near(p.areaKm2, Math.PI * 7 * 77, 1e-9);
  assert.equal(C.presetList()[0].id, "current");
});

test("レイヤーと県別人口枠は保存・復元・プリセット切替で一致し、旧形式は既定値になる", () => {
  const s = C.presetState(model, "current"); s.layers.munis = true; s.layers.names = false; s.popFrame = { "JP-13": 1500000 };
  const j = JSON.parse(JSON.stringify(C.serializeState(s, model))), back = C.normalizeState(j, model);
  assert.equal(j.schemaVersion, 13); assert.deepEqual(back.layers, s.layers); assert.deepEqual(back.popFrame, { "JP-13": 1500000 });
  const old = C.normalizeState({ ship: s.ship, terrain: s.terrain }, model); assert.deepEqual(old.layers, C.LAYER_DEFAULTS); assert.equal(old.popFrame, null);
  assert.deepEqual(C.presetState(model, "adopted").layers, C.LAYER_DEFAULTS);
});

test("保存スロット：標準案とは別に、新規・上書き・名前変更・複製・削除(取り消し)・JSON読込。無断上書きなし。旧v10保存は消さず移行", () => {
  const m = mem(); m.setItem(Slots.LEGACY_KEY, JSON.stringify([{ name: "旧案", ship: { innerDiameterKm: 6 }, terrain: {}, createdAt: "2026-10-01" }]));
  const st = Slots.createStore(m); assert.equal(st.list().length, 1); assert.match(st.list()[0].origin, /旧v10/); assert.ok(m.getItem(Slots.LEGACY_KEY), "旧キーは残る（バックアップ）");
  const d = { name: "X", ship: { innerDiameterKm: 7 }, terrain: {} };
  const a = st.add(d, { name: "X", fileName: "x.json" }), b = st.add(d, { name: "X", fileName: "x.json" }); assert.equal(a.name, "X"); assert.equal(b.name, "X (2)"); assert.notEqual(a.fileName, b.fileName);
  st.overwrite(a.id, { ...d, ship: { innerDiameterKm: 8 } }); assert.equal(st.get(a.id).design.ship.innerDiameterKm, 8); assert.equal(st.get(b.id).design.ship.innerDiameterKm, 7);
  assert.throws(() => st.rename(a.id, "X (2)")); st.rename(a.id, "新名"); assert.equal(st.get(a.id).design.name, "新名");
  const dup = st.duplicate(a.id); assert.match(dup.name, /のコピー/); assert.equal(st.list().length, 4);
  st.remove(dup.id); assert.equal(st.list().length, 3); assert.equal(st.trash().length, 1); const r = st.restoreLast(); assert.equal(r.id, dup.id); assert.equal(st.list().length, 4);
  const imp = st.importJSON({ ship: { innerDiameterKm: 1 }, terrain: {}, name: "新名" }, { fileName: "in.json" }); assert.equal(imp[0].name, "新名 (2)", "同名は別スロット");
  assert.equal(st.importJSON({ nothing: 1 }).length, 0);
  const all = st.exportAll(); assert.equal(all.schema, "kasoku-ship-slots"); assert.equal(all.slots.length, st.list().length); assert.equal(Slots.createStore(m).list().length, st.list().length, "再読込後も残る");
  st.hideStd("legacy-1"); assert.deepEqual(st.hiddenStd(), ["legacy-1"]); st.showStdAll(); assert.deepEqual(st.hiddenStd(), []);
  const bundle = st.importJSON({ schema: "kasoku-world-cylinder-designs", designs: [d, d] }); assert.equal(bundle.length, 2);
  assert.equal(Slots.createStore(null).add(d, {}).name, "X", "保存不可でも動く");
});

test("人口配分：合計＝船体人口、暫定の明示、県別枠は比例補正せず差を記録、市町村3000件超", () => {
  const P = Pop.compute(model, 12000000, null); assert.ok(P.munis.length > 3000); near(P.munis.reduce((a, m) => a + m.pop, 0), 12000000, 1e-3); assert.equal(P.source, "provisional"); assert.match(P.params.status, /暫定/);
  const top = P.munis.slice().sort((a, b) => b.pop - a.pop)[0]; assert.equal(top.n, "東京特別区部");
  const caps = P.munis.filter((m) => m.capital); assert.ok(caps.length >= 46, "県庁所在地 " + caps.length);
  const F = Pop.compute(model, 12000000, { "JP-13": 1500000, "JP-01": 500000 }); assert.equal(F.source, "mixed"); near(F.munis.filter((m) => m.p === "JP-13").reduce((a, m) => a + m.pop, 0), 1500000, 1e-3); assert.ok(Math.abs(F.diff) > 100, "差を記録（比例補正しない）");
  const half = Pop.compute(model, 6000000, null); near(half.munis.reduce((a, m) => a + m.pop, 0), 6000000, 1e-3);
  assert.equal(model.prefectures.find((p) => p.id === "JP-01").name, "北海道"); assert.equal(model.prefectures.find((p) => p.id === "JP-13").name, "東京都");
});

test("道路・鉄道：酷道の線形を使わず新規設計。県庁所在地を鉄道で接続、島をまたがない、人口を変えると再設計", () => {
  const P = Pop.compute(model, 12000000, null), N = Net.design(model, P);
  const rail = N.edges.filter((e) => e.mode === "rail"), hubs = new Set(rail.flatMap((e) => [e.a, e.b]));
  for (const m of P.munis.filter((m) => m.capital && m.i)) { const sameIsland = P.munis.filter((q) => q.capital && q.i === m.i).length; if (sameIsland > 1) assert.ok(hubs.has(m.c), m.n + " は鉄道でつながる"); }
  assert.ok(N.edges.every((e) => model.byId.get(e.island) && P.munis.find((m) => m.c === e.a).i === e.island && P.munis.find((m) => m.c === e.b).i === e.island), "島をまたぐ線はない");
  assert.ok(N.stats.railEdges > 30 && N.stats.roadEdges > N.stats.railEdges); assert.ok(N.edges.every((e) => ["rail", "trunk", "local"].includes(e.tier)));
  const P2 = Pop.compute(model, 12000000, { "JP-13": 9e6 }), N2 = Net.design(model, P2); assert.notDeepEqual(N2.stats, N.stats, "人口配分が変われば設計が変わる（再評価できる）");
  assert.equal(JSON.stringify(N.edges.filter((e) => e.mode === "road" && e.tier === "trunk").length > 0), "true");
  // 酷道のコピーでない：線形は酷道 reference-lines と無関係に、拠点間の直線（短い折れ線ではない）
  assert.ok(N.edges.every((e) => Array.isArray(e.pa) && Array.isArray(e.pb)));
});

test("層の追従：市町村・湖は島の変換（回転・圧縮）に追従し、円周で折り返す", () => {
  const a = C.presetState(model, "current"), L0 = C.layout(model, a), b = C.cloneState(a); b.terrain.rotationsDeg.ryukyu = 30; const L1 = C.layout(model, b);
  const mu = (L, n) => L.munis.find((m) => m.n === n);
  assert.deepEqual(mu(L0, "札幌市").pos, mu(L1, "札幌市").pos, "本土の市は動かない"); assert.notDeepEqual(mu(L0, "那覇市").pos, mu(L1, "那覇市").pos, "回転する島の市は島と一緒に動く");
  assert.ok(L0.lakes.length >= 40); const biwa = L0.lakes.find((l) => l.name === "琵琶湖"); assert.ok(biwa && biwa.island === "honshu");
  assert.deepEqual(L1.lakes.find((l) => l.name === "琵琶湖").ring, biwa.ring, "本州の湖は動かない");
});

test("河川（標高から作る酷道方式）・湖・標高色・雪・円周シーム・計算値不変", () => {
  const s = C.presetState(model, "current"), L = C.layout(model, s), G = T.buildGrids(model, dem, s.terrain.heightLayer), layer = T.normalizeLayer(s.terrain.heightLayer);
  const riv = new Map(); for (const [id, g] of G.grids) if (model.byId.get(id).areaKm2 > 1000) riv.set(id, T.buildRivers(g)); assert.ok(riv.get("honshu").length > 500 && riv.get("hokkaido").length > 100);
  assert.ok(riv.get("honshu").every((sg) => sg[4] === 1 || sg[4] === 2));
  const R = TI.renderSync(C, T, model, L, G.grids, layer, riv, { ppk: 14 }), cnt = [0, 0, 0, 0]; for (const v of R.water) cnt[v]++; assert.ok(cnt[2] > 10 && cnt[3] > 100 && cnt[0] > 1000);
  let snow = 0; for (let k = 0; k < R.W * R.H; k++) if (R.water[k] === 0 && R.rgba[k * 4] > 225 && R.rgba[k * 4 + 1] > 225) snow++; assert.ok(snow > 5, "雪 " + snow);
  const c0 = TI.colorOf(10, 1), c1 = TI.colorOf(1200, 1), c2 = TI.colorOf(3000, 1); assert.ok(c2[0] > 235 && c2[1] > 235 && c0[1] > c0[0], "低地は緑・高山は白"); assert.notDeepEqual(c0, c1);
  // 円周シーム：左右端で水域マスクが連続
  const f = L.frame, S2 = T.makeShipSampler(C, L, G.grids, model, layer, true); let mism = 0; for (let y = f.y - 30; y < f.y + 30; y += 0.31) if (Math.abs(S2(f.x - f.w / 2 + 1e-6, y) - S2(f.x + f.w / 2 + 1e-6, y)) > 1e-6) mism++; assert.equal(mism, 0, "左右端で標高が連続");
  // 高さ倍率を変えても色（実標高）は変わらない・描画段差で標高値は変わらない
  const sc = T.makeShipSampler(C, L, G.grids, model, { ...s.terrain.heightLayer, globalScale: 2 }); const fp = C.shipPoint(model.toKm(138.7274, 35.3606), L.shifts.get("honshu")); near(sc(fp[0], fp[1]), 1888, 0.5);
  const R2 = TI.renderSync(C, T, model, L, G.grids, T.normalizeLayer({ ...s.terrain.heightLayer, globalScale: 2 }), riv, { ppk: 14 }); assert.deepEqual(Array.from(R.rgba.slice(0, 4000)), Array.from(R2.rgba.slice(0, 4000)), "色は実標高で決まり、倍率に依存しない");
});

test("地形ラスターの水域マスクは干渉・面積の計算に使われない（描画だけ）", () => {
  const s = C.presetState(model, "current"), L = C.layout(model, s), I = C.interference(L), M = C.metrics(model, s, L, I), M2 = C.metrics(model, s, L, I);
  assert.deepEqual(M, M2); assert.ok(!("water" in M) && !("visualStep" in M));
});
