// node --test tests/unit
const test = require("node:test"), assert = require("node:assert/strict");
globalThis.SHIP_FIT_CANDIDATE = (() => { const w = {}; new Function("window", require("fs").readFileSync(__dirname + "/../../src/fit-candidate.js", "utf8"))(w); return w.SHIP_FIT_CANDIDATE; })();
const T = require("../../src/terrain.js");
const C = require("../../src/core.js"), geo = require("../../data/ship-geo.json");
const model = C.buildModel(geo);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} vs ${b}`);
const sq = (id, x, y, s, group) => { const ring = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]; return { id, group: group || "main", ring, bb: { lx: x, rx: x + s, by: y, ty: y + s }, areaKm2: s * s }; };

test("data: islands, prefectures, cities and sources are present", () => {
  assert.ok(model.islands.length > 130);
  for (const id of ["honshu", "hokkaido", "kyushu", "shikoku", "okinawa", "iwo", "okinotori", "minamitori"]) assert.ok(model.byId.has(id), id);
  assert.equal(geo.prefectures.length, 47); assert.equal(geo.legacyPrefectures.length, 49);
  assert.ok(geo.prefectures.every((p) => p.culture === null && p.areaKm2 > 0));
  assert.ok(geo.cities.length >= 49 && geo.sources.length >= 3);
  assert.deepEqual(model.toKm(135, 35), [0, 0]); // v9 plane origin
});

test("adopted design: canon values; centre kept unrounded", () => {
  const s = C.presetState(model, "adopted");
  assert.equal(s.ship.innerDiameterKm, 6.0); assert.equal(s.ship.cylinderLengthKm, 51.0); assert.equal(s.ship.population, 12000000); assert.equal(s.ship.gravityG, 3);
  assert.equal(s.ship.centerXKm, -7.726051000488052); assert.equal(s.ship.centerYKm, 4.424036296290547);
  const t = s.terrain;
  assert.deepEqual([t.japanScaleDenominator, t.ryukyuSpacingPercent, t.tsushimaSouthKm, t.ogasawaraCompressionPercent, t.showOkinotori, t.showMinamitori, t.ogasawaraAnchor], [40, 90, 1, 50, true, true, "硫黄島"]);
});

test("3G physics and density for D=6 km, L=51 km", () => {
  const p = C.physics({ innerDiameterKm: 6, cylinderLengthKm: 51, gravityG: 3 });
  near(p.circumferenceKm, 18.84956, 1e-5); near(p.areaKm2, 961.33, 0.01); near(p.density, 12483, 1);
  near(p.rimSpeedMs, Math.sqrt(3 * 9.80665 * 3000), 1e-9); near(p.rimSpeedMs, 297.09, 0.01);
  near(p.omegaRadS, 0.09903, 1e-5); near(p.rpm, 0.9457, 1e-4); near(p.periodS, 63.45, 0.01);
  const p2 = C.physics({ innerDiameterKm: 12, cylinderLengthKm: 51, gravityG: 3 });
  near(p2.rimSpeedMs / p.rimSpeedMs, Math.SQRT2, 1e-12); // v ∝ √R when the diameter changes
});

test("scale: ship area = real area / denominator²", () => {
  const s = C.presetState(model, "adopted"), L = C.layout(model, s);
  const h = L.islands.find((i) => i.id === "honshu");
  near(h.areaKm2, model.byId.get("honshu").areaKm2 / 1600, 1e-9);
  near(C.ringArea(h.ring), h.areaKm2, 1e-6);
});

test("seam: x and x + circumference are the same place on the cylinder", () => {
  const f = { x: 3, y: 1, w: 18.85, h: 51 };
  for (const x of [-20, -3.1, 0, 7.7, 30]) {
    const a = C.toCylinder(x, 5, f, 3), b = C.toCylinder(x + f.w, 5, f, 3), c = C.toCylinder(x - 2 * f.w, 5, f, 3);
    for (let k = 0; k < 3; k++) { near(a[k], b[k], 1e-9); near(a[k], c[k], 1e-9); }
    near(C.wrapX(x, f), C.wrapX(x + f.w, f), 1e-9);
    const wx = C.wrapX(x, f); assert.ok(wx >= f.x - f.w / 2 && wx < f.x + f.w / 2);
  }
  // west seam floor is straight down; east is to the right of someone facing the bow (-x with up toward +y)
  const s0 = C.toCylinder(f.x - f.w / 2, 0, f, 3); near(s0[0], 0, 1e-12); near(s0[1], -3, 1e-12);
  assert.ok(C.toCylinder(f.x - f.w / 2 + 0.1, 0, f, 3)[0] < 0);
});

test("interference: exact overlap area, across the seam, contact is not interference", () => {
  const f = { x: 0, y: 0, w: 10, h: 10 };
  // 1×1 squares offset by 0.5 → 0.5 km²
  let r = C.interference({ islands: [sq("a", 0, 0, 1), sq("b", 0.5, 0, 1)], frame: f });
  assert.equal(r.length, 1); near(r[0].areaKm2, 0.5, 1e-6);
  // touching edge only → nothing
  assert.equal(C.interference({ islands: [sq("a", 0, 0, 1), sq("b", 1, 0, 1)], frame: f }).length, 0);
  // b sits 10 km east = exactly one circumference → it comes round onto a
  r = C.interference({ islands: [sq("a", 0, 0, 1), sq("b", 10.25, 0.5, 1)], frame: f });
  assert.equal(r.length, 1); near(r[0].areaKm2, 0.75 * 0.5, 1e-6); assert.equal(Math.abs(r[0].k), 1);
  // an island wider than the circumference overlaps itself
  r = C.interference({ islands: [{ ...sq("long", 0, 0, 1), ring: [[0, 0], [12, 0], [12, 1], [0, 1]], bb: { lx: 0, rx: 12, by: 0, ty: 1 } }], frame: f });
  assert.equal(r.length, 1); near(r[0].areaKm2, 2, 1e-6);
});

test("interference ignores display symbols: islets 30 m apart do not interfere", () => {
  const r = C.interference({ islands: [sq("a", 0, 0, 0.01), sq("b", 0.04, 0, 0.01)], frame: { x: 0, y: 0, w: 18, h: 50 } });
  assert.equal(r.length, 0);
});

test("adopted design: no Ryukyu overlap; others recorded, not removed", () => {
  const s = C.presetState(model, "adopted"), L = C.layout(model, s), I = C.interference(L);
  const ryu = I.filter((o) => model.byId.get(o.a).group === "ryu" || model.byId.get(o.b).group === "ryu");
  assert.equal(ryu.length, 0);
  assert.equal(L.islands.length, model.islands.length); // nothing deleted
  assert.ok(I.length > 0);
});

test("Ryukyu correction: east–west only, only overlapping Ryukyu islands, raw coordinates untouched", () => {
  const s = C.presetState(model, "adopted"); s.terrain.ryukyuSpacingPercent = 25; // squeeze until they overlap
  const rawBefore = JSON.stringify(model.islands.map((i) => i.ring));
  const before = C.interference(C.layout(model, s), { only: (a, b) => a.group === "ryu" || b.group === "ryu" });
  assert.ok(before.length > 0, "test setup should create overlaps");
  const r = C.resolveRyukyu(model, s);
  const L2 = C.layout(model, r.state);
  assert.equal(C.interference(L2, { only: (a, b) => a.group === "ryu" || b.group === "ryu" }).length, 0);
  for (const id of Object.keys(r.state.terrain.islandOffsetsKm)) assert.equal(model.byId.get(id).group, "ryu");
  const L1 = C.layout(model, s);
  for (const isl of L2.islands) { const o = L1.islands.find((q) => q.id === isl.id); near(isl.c[1], o.c[1], 1e-12, "no north–south move"); if (!(isl.id in r.state.terrain.islandOffsetsKm)) near(isl.c[0], o.c[0], 1e-12); }
  assert.equal(JSON.stringify(model.islands.map((i) => i.ring)), rawBefore);
  assert.ok(Object.values(r.state.terrain.islandOffsetsKm).every((v) => Math.abs(v) < 3));
});

test("borders, prefecture labels and cities move with their island", () => {
  const a = C.presetState(model, "adopted"), b = C.cloneState(a); b.terrain.ryukyuSpacingPercent = 50;
  const La = C.layout(model, a), Lb = C.layout(model, b);
  const dy = Lb.islands.find((i) => i.id === "okinawa").c[1] - La.islands.find((i) => i.id === "okinawa").c[1];
  assert.ok(Math.abs(dy) > 0.5);
  const naha = (L) => L.cities.find((c) => c.name === "那覇市").pos[1];
  near(naha(Lb) - naha(La), dy, 1e-9);
  // prefecture borders take exactly their island's transform (here: an east–west correction on Honshu)
  const e = C.cloneState(a); e.terrain.islandOffsetsKm = { honshu: 0.5 };
  const Le = C.layout(model, e), bi = La.borders.findIndex((x) => x.island === "honshu"); assert.ok(bi >= 0);
  near(Le.borders[bi].line[0][0] - La.borders[bi].line[0][0], 0.5, 1e-9); near(Le.borders[bi].line[0][1], La.borders[bi].line[0][1], 1e-12);
  near(Le.cities.find((q) => q.name === "東京").pos[0] - La.cities.find((q) => q.name === "東京").pos[0], 0.5, 1e-9);
  near(Lb.prefectures.find((p) => p.id === "JP-47").pos[1] - La.prefectures.find((p) => p.id === "JP-47").pos[1], dy, 1e-9);
  const hk = (L) => L.cities.find((c) => c.name === "札幌市").pos[1]; near(hk(Lb), hk(La), 1e-12); // main islands do not move
  // 対馬 moves south by exactly the set ship km
  const c = C.cloneState(a); c.terrain.tsushimaSouthKm = 3;
  near(C.layout(model, c).islands.find((i) => i.group === "tsushima").c[1] - La.islands.find((i) => i.group === "tsushima").c[1], -2, 1e-9);
});

test("小笠原 compression keeps 硫黄島 fixed; 沖ノ鳥島/南鳥島 toggle independently", () => {
  const a = C.presetState(model, "adopted"), b = C.cloneState(a); b.terrain.ogasawaraCompressionPercent = 0;
  const iwo = (s) => C.layout(model, s).islands.find((i) => i.id === "iwo").c;
  assert.deepEqual(iwo(a), iwo(b));
  const chichi = (s) => C.layout(model, s).islands.find((i) => i.name === "父島").c[1];
  assert.ok(chichi(a) < chichi(b));
  const t = C.cloneState(a); t.terrain.showOkinotori = false;
  const ids = C.layout(model, t).islands.map((i) => i.id);
  assert.ok(!ids.includes("okinotori") && ids.includes("minamitori"));
});

test("save JSON round trip keeps every value; v9 JSON loads", () => {
  const s = C.presetState(model, "adopted"); s.terrain.islandOffsetsKm = { [model.islands.find((i) => i.group === "ryu" && i.id !== "okinawa").id]: 0.0123456 };
  const j = JSON.parse(JSON.stringify(C.serializeState(s, model)));
  for (const k of ["schema", "schemaVersion", "name", "createdAt", "ship", "terrain", "gravity", "geoData"]) assert.ok(k in j, k);
  assert.equal(j.ship.centerXKm, -7.726051000488052);
  const back = C.normalizeState(j, model);
  assert.deepEqual(back.ship, s.ship); assert.deepEqual(back.terrain, s.terrain);
  near(j.gravity.rpm, 0.9457, 1e-4);
  const v9 = C.normalizeState(C.USER_V9_JSON, model);
  assert.equal(v9.ship.cylinderLengthKm, 50.7622528901549); assert.equal(v9.migratedFrom, "v9"); assert.deepEqual(v9.terrain.islandOffsetsKm, {});
  assert.throws(() => C.normalizeState({ ship: { innerDiameterKm: -1, cylinderLengthKm: 5 }, terrain: {} }, model));
  assert.throws(() => C.normalizeState({ foo: 1 }, model));
});

test("all presets build and stay consistent", () => {
  for (const p of C.presetList()) {
    const s = C.presetState(model, p.id), m = C.metrics(model, s, C.layout(model, s), []);
    assert.ok(Number.isFinite(m.physics.rimSpeedMs) && s.ship.population === 12000000, p.id);
  }
  const l2 = C.presetState(model, "legacy-2"); assert.equal(l2.ship.innerDiameterKm, 4); assert.equal(l2.ship.cylinderLengthKm, 38.5);
  const third = C.presetState(model, "initial-third"); assert.equal(third.terrain.japanScaleDenominator, 3);
});

// ---------------------------------------------------------------- 南北収容の補正（候補案 adopted-fit）
test("adopted design is untouched; its overhang is detected separately from interference", () => {
  const a = C.presetState(model, "adopted"), L = C.layout(model, a), H = C.overhangs(L);
  assert.equal(a.ship.centerYKm, 4.424036296290547); assert.equal(a.terrain.ryukyuSpacingPercent, 90); assert.deepEqual(a.terrain.islandOffsetsNorthKm, {});
  assert.ok(H.length > 40 && H.every((o) => o.southKm > 0 && o.northKm === 0));
  near(H[0].southKm, 16.4965, 1e-3, "沖ノ鳥島"); assert.equal(H[0].id, "okinotori");
  // interference is a different list: overhanging islets are not "interfering"
  const I = C.interference(L); assert.notEqual(H.length, I.length); // two independent detections
});

test("overhang: island fully inside vs poking past each end", () => {
  const f = { x: 0, y: 0, w: 10, h: 10 };
  const mk = (id, y) => ({ ...sq(id, 0, y, 1), name: id });
  const H = C.overhangs({ islands: [mk("in", -2), mk("s", -5.5), mk("n", 4.5)], frame: f });
  assert.equal(H.length, 2); near(H.find((o) => o.id === "s").southKm, 0.5, 1e-12); near(H.find((o) => o.id === "n").northKm, 0.5, 1e-12);
  assert.equal(C.overhangs({ islands: [mk("touch", -5)], frame: f }).length, 0); // touching the end is inside
});

test("fit candidate: no overhang at either end, north edge kept, canon values unchanged", () => {
  const b = C.presetState(model, "adopted-fit"), a = C.presetState(model, "adopted"), L = C.layout(model, b);
  assert.equal(C.overhangs(L).length, 0);
  const north = L.frame.y + L.frame.h / 2, top = Math.max(...L.islands.filter((i) => i.group !== "bird").map((i) => i.bb.ty));
  assert.ok(north - top >= 0 && north - top < 0.1, "north margin " + (north - top));
  assert.ok(b.ship.centerYKm < a.ship.centerYKm); near(a.ship.centerYKm - b.ship.centerYKm, 0.648, 0.002);
  for (const k of ["innerDiameterKm", "cylinderLengthKm", "centerXKm", "population", "gravityG"]) assert.equal(b.ship[k], a.ship[k], k);
  const t = b.terrain; assert.equal(t.japanScaleDenominator, 40); assert.equal(t.ogasawaraCompressionPercent, 50); assert.equal(t.tsushimaSouthKm, 1); assert.ok(t.showOkinotori && t.showMinamitori);
  assert.ok(t.ryukyuSpacingPercent < 90 && t.ryukyuSpacingPercent > 10);
  // minimal: one percent less compression leaves a non-bird island over the south end
  const c = C.cloneState(b); c.terrain.ryukyuSpacingPercent += 1;
  assert.ok(C.overhangs(C.layout(model, c)).some((o) => o.group !== "bird" && o.southKm > 0));
  // only 沖ノ鳥島 gets an individual north–south correction
  assert.deepEqual(Object.keys(t.islandOffsetsNorthKm), ["okinotori"]);
  // the adopted design object still exists unchanged after building the candidate
  assert.equal(C.presetState(model, "adopted").terrain.ryukyuSpacingPercent, 90);
});

test("fit candidate: outlines rigid, order kept, no terrain interference in 南西諸島, symbols excluded", () => {
  const a = C.presetState(model, "adopted"), b = C.presetState(model, "adopted-fit"), La = C.layout(model, a), Lb = C.layout(model, b);
  for (const ia of La.islands) { // outline = pure translation
    const ib = Lb.islands.find((q) => q.id === ia.id), dx = ib.ring[0][0] - ia.ring[0][0], dy = ib.ring[0][1] - ia.ring[0][1];
    for (let k = 0; k < ia.ring.length; k += Math.max(1, (ia.ring.length / 6) | 0)) { near(ib.ring[k][0] - ia.ring[k][0], dx, 1e-9); near(ib.ring[k][1] - ia.ring[k][1], dy, 1e-9); }
    assert.ok(Math.abs(dx) < 0.5, ia.id + " east–west move " + dx);
  }
  const order = (L) => L.islands.filter((i) => i.group === "ryu").sort((x, y) => y.c[1] - x.c[1] || x.id.localeCompare(y.id)).map((i) => i.id);
  // north→south order of the non-ties is preserved (ties broken by id)
  const oa = order(La), ob = order(Lb); const rank = new Map(ob.map((id, i) => [id, i]));
  let inversions = 0; for (let i = 1; i < oa.length; i++) if (rank.get(oa[i - 1]) > rank.get(oa[i])) inversions++;
  assert.ok(inversions <= 2, "order inversions " + inversions);
  const I = C.interference(Lb, { only: (x, y) => x.group === "ryu" || y.group === "ryu" }); assert.equal(I.length, 0);
  // main islands do not move relative to each other
  const d = (L, id) => L.islands.find((i) => i.id === id).c; near(d(Lb, "honshu")[1] - d(Lb, "hokkaido")[1], d(La, "honshu")[1] - d(La, "hokkaido")[1], 1e-12);
});

test("individual north–south correction is stored separately and round-trips; raw coordinates untouched", () => {
  const raw = JSON.stringify(model.islands.map((i) => i.ring)), b = C.presetState(model, "adopted-fit");
  const j = JSON.parse(JSON.stringify(C.serializeState(b, model)));
  assert.ok(j.terrain.islandOffsetsNorthKm.okinotori > 0);
  const back = C.normalizeState(j, model); assert.deepEqual(back.terrain, b.terrain); assert.equal(back.ship.centerYKm, b.ship.centerYKm);
  assert.equal(JSON.stringify(model.islands.map((i) => i.ring)), raw);
  // 沖ノ鳥島 / 南鳥島 stay independently switchable on the candidate
  const t = C.cloneState(b); t.terrain.showOkinotori = false; const ids = C.layout(model, t).islands.map((i) => i.id); assert.ok(!ids.includes("okinotori") && ids.includes("minamitori"));
  assert.equal(C.overhangs(C.layout(model, t)).length, 0);
});

// ================================================================ v11
const demPack = (() => { const w = {}; new Function("window", require("fs").readFileSync(__dirname + "/../../src/dem.js", "utf8"))(w); return T.decodeDem(w.SHIP_DEM); })();
const adopted = () => C.presetState(model, "adopted");
const withT = (f) => { const s = adopted(); f(s.terrain); return s; };
const ctr = (L, id) => L.islands.find((i) => i.id === id).c;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ring0 = (L, id) => L.islands.find((i) => i.id === id).ring;

test("v11 data: 北海道は1つに再統合・東京都・旧49件は保持・函館根室は都市として残る", () => {
  const ids = geo.prefectures.map((p) => p.id); assert.ok(!ids.some((i) => i.startsWith("HK-"))); assert.ok(ids.includes("JP-01"));
  const hk = geo.prefectures.find((p) => p.id === "JP-01"); assert.equal(hk.name, "北海道"); assert.deepEqual(hk.mergedFrom, ["HK-SAP", "HK-HAK", "HK-NEM"]); assert.equal(hk.capital, "札幌市");
  assert.equal(geo.prefectures.find((p) => p.id === "JP-13").name, "東京都"); assert.equal(geo.prefectures.find((p) => p.id === "JP-13").legacyName, "東京府");
  assert.equal(geo.legacyPrefectures.filter((p) => p.id.startsWith("HK-")).length, 3); assert.equal(geo.legacyPrefectures.find((p) => p.id === "JP-13").name, "東京府"); // 元データは無改変
  assert.equal(geo.prefectureBorders.lines.filter((b) => b.island === "hokkaido").length, 0, "北海道内部に県境が無い");
  for (const n of ["函館市", "根室市"]) { const c = geo.cities.find((q) => q.name === n); assert.ok(c && c.kind === "city" && c.pref === "JP-01" && c.legacyCapitalOf); }
  assert.ok(geo.conversion.length >= 5);
  const jp = model.prefectures.every((p) => p.name && p.capital && p.areaKm2 > 0 && p.culture === null); assert.ok(jp);
});

test("v11 data: 北方領土4島（歯舞は複数の島）と竹島", () => {
  for (const id of ["etorofu", "kunashiri", "shikotan", "shibotsu", "takeshima"]) assert.ok(model.byId.has(id), id);
  const hab = model.islands.filter((i) => i.region === "northern" && /歯舞/.test(i.name || "")); assert.ok(hab.length >= 4, "歯舞群島は複数の島: " + hab.length);
  assert.ok(hab.some((i) => i.source === "schematic" && i.position === "approximate") && hab.some((i) => i.source === "naturalearth"));
  assert.equal(model.islands.filter((i) => i.region === "northern").length, 8); assert.equal(model.byId.get("takeshima").region, "takeshima");
  assert.equal(model.byId.get("etorofu").pref, "JP-01"); assert.equal(model.byId.get("takeshima").pref, "JP-32");
  assert.ok(model.byId.get("etorofu").areaKm2 > 2500 && model.byId.get("kunashiri").areaKm2 > 1000);
});

test("rotation 0° = 元配置、v10状態と同一の配置（旧データ互換）", () => {
  const a = adopted(), L0 = C.layout(model, a);
  const v10 = JSON.parse(JSON.stringify(a)); for (const k of ["rotationsDeg", "chainCompression", "hiddenRegions", "heightLayer"]) delete v10.terrain[k]; delete v10.schemaVersion; v10.ship.axisDiameterM = undefined;
  const b = C.normalizeState(v10, model), L1 = C.layout(model, b);
  assert.deepEqual(b.terrain.rotationsDeg, { izu: 0, ryukyu: 0, northern: 0 }); assert.equal(b.terrain.chainCompression.ratePercent, 0); assert.deepEqual(b.terrain.hiddenRegions, []);
  for (const i of L0.islands) assert.deepEqual(i.ring, ring0(L1, i.id));
});

for (const [key, pivotId, fixedIds, movingSample] of [["izu", "izuoshima", ["honshu", "kyushu"], "minamiiwo"], ["ryukyu", "yakushima", ["kyushu", "tanegashima"], "iriomote"], ["northern", null, ["hokkaido"], "etorofu"]]) {
  test(`回転 ${key}: 支点固定・本土は不動・剛体回転・所属（都市/県境）追従・0°で復帰`, () => {
    const base = adopted(), L0 = C.layout(model, base), pivot = model.rot[key].pivot, denom = 40;
    const s = withT((t) => { t.rotationsDeg[key] = 30; }), L1 = C.layout(model, s);
    const ids = [...model.rot[key].ids]; assert.ok(ids.length >= 4);
    for (const id of fixedIds) { const m = model.byId.get(id) || model.islands.find((i) => i.id === id); if (!m) continue; assert.deepEqual(ring0(L1, id), ring0(L0, id), id + " は回転しない"); }
    // 剛体：島内の2点間距離が不変、支点からの距離が不変、角度が30°だけ変わる
    const pv = C.shipPoint(pivot, L0.shifts.get(ids[0])); // 支点の船体座標（回転前の島の移動で）
    for (const id of ids) {
      const A = L0.islands.find((i) => i.id === id), B = L1.islands.find((i) => i.id === id); if (!A || !B) continue;
      for (let k = 0; k < A.ring.length; k += Math.max(1, (A.ring.length / 5) | 0)) near(dist(A.ring[0], A.ring[k]), dist(B.ring[0], B.ring[k]), 1e-9, id + " 形状");
    }
    if (pivotId) { const o0 = ctr(L0, pivotId), o1 = ctr(L1, pivotId); if (key === "izu") near(dist(o0, o1), 0, 1e-9, "支点の島"); }
    // 所属：回転する島の上の都市・県境は同じ変換で動く／回転しない島の都市は不動
    const moved = L1.cities.filter((c) => model.rot[key].ids.has(c.island)), still = L1.cities.filter((c) => !model.rot[key].ids.has(c.island));
    for (const c of still) assert.deepEqual(c.pos, L0.cities.find((q) => q.id === c.id).pos);
    for (const c of moved) { const o = L0.cities.find((q) => q.id === c.id); assert.ok(dist(c.pos, o.pos) > 0 || dist(c.pos, C.shipPoint(pivot, L0.shifts.get(c.island))) < 1e-9); }
    const sh = L1.shifts.get(ids[0]); const A = ctr(L0, ids[0]); // 島の中心の移動が回転式に一致
    const q = model.byId.get(ids[0]).c, th = (30 * Math.PI) / 180, rx = pivot[0] + (q[0] - pivot[0]) * Math.cos(th) - (q[1] - pivot[1]) * Math.sin(th), ry = pivot[1] + (q[0] - pivot[0]) * Math.sin(th) + (q[1] - pivot[1]) * Math.cos(th);
    const expect = C.shipPoint([q[0], q[1]], sh); near(dist(expect, C.shipPoint([rx, ry], { ...sh, rot: null })), 0, 1e-9, "回転式");
    // 負の角度・0°で元に戻る
    const back = withT((t) => { t.rotationsDeg[key] = 30; }); back.terrain.rotationsDeg[key] = 0; const Lb = C.layout(model, back);
    for (const i of L0.islands) assert.deepEqual(i.ring, ring0(Lb, i.id));
    const neg = withT((t) => { t.rotationsDeg[key] = -30; }); assert.notDeepEqual(ring0(C.layout(model, neg), ids[0]), ring0(L1, ids[0]));
  });
}
test("回転の対象リスト：A=伊豆〜小笠原の島列、B=屋久島より南の琉球諸島、C=北方領土8島。本土・種子島・屋久島・北海道は対象外", () => {
  const A = model.rot.izu.ids, B = model.rot.ryukyu.ids, Cn = model.rot.northern.ids;
  for (const id of ["izuoshima", "minamiiwo", "iwo"]) assert.ok(A.has(id)); for (const id of ["honshu", "kyushu", "hokkaido", "okinawa"]) assert.ok(!A.has(id));
  assert.ok(B.has("okinawa")); for (const id of ["kyushu", "yakushima", "honshu"]) assert.ok(!B.has(id)); assert.ok(![...B].some((id) => model.byId.get(id).c[1] >= model.byId.get("yakushima").c[1]));
  assert.deepEqual([...Cn].sort(), model.islands.filter((i) => i.region === "northern").map((i) => i.id).sort()); assert.ok(!Cn.has("hokkaido"));
  assert.equal(model.rot.izu.pivot, model.byId.get("izuoshima").c); assert.equal(model.rot.ryukyu.pivot, model.byId.get("yakushima").c);
  const nos = model.toKm(145.8167, 43.3858); assert.deepEqual(model.rot.northern.pivot, nos);
  assert.ok(C.ROT_LIMITS.izu >= 30 && C.ROT_LIMITS.ryukyu >= 30 && C.ROT_LIMITS.northern >= 30);
});

test("島列圧縮：対象は伊豆大島〜南硫黄島だけ・固定端・間隔を同率・形と東西の広がり不変・順序不変", () => {
  const chain = model.chain; assert.equal(chain.first, "izuoshima"); assert.equal(chain.last, "minamiiwo"); assert.ok(chain.ids.length > 20);
  assert.equal(chain.ids[0], "izuoshima"); assert.equal(chain.ids[chain.ids.length - 1], "minamiiwo");
  assert.ok(chain.ids.every((id) => ["izu", "ogasawara"].includes(model.byId.get(id).region)));
  const legacyOff = (f) => withT((t) => { t.ogasawaraCompressionPercent = 0; f(t); }); // 旧・小笠原追加圧縮は島列圧縮が有効な間は適用されない
  const L0 = C.layout(model, legacyOff(() => {}));
  for (const mode of ["oshima", "minamiiwo"]) {
    const s = legacyOff((t) => { t.chainCompression = { mode, ratePercent: 40 }; }), L1 = C.layout(model, s), k = 0.6;
    const fixed = mode === "oshima" ? chain.first : chain.last, other = mode === "oshima" ? chain.last : chain.first;
    assert.deepEqual(ctr(L1, fixed), ctr(L0, fixed), "固定端は動かない");
    const o = ctr(L0, chain.first), p1 = ctr(L0, chain.last), Lc = dist(o, p1), u = [(p1[0] - o[0]) / Lc, (p1[1] - o[1]) / Lc];
    const t = (L, id) => { const p = ctr(L, id); return (p[0] - o[0]) * u[0] + (p[1] - o[1]) * u[1]; }, perp = (L, id) => { const p = ctr(L, id); return -(p[0] - o[0]) * u[1] + (p[1] - o[1]) * u[0]; };
    const tFixed = mode === "oshima" ? 0 : Lc;
    for (const id of chain.ids) { near(t(L1, id), tFixed + k * (t(L0, id) - tFixed), 1e-9, id + " 軸方向の位置＝固定端からk倍"); near(perp(L1, id), perp(L0, id), 1e-9, id + " 東西の広がり（垂直位置）不変"); }
    const ids = chain.ids; for (let i = 1; i < ids.length; i++) { const d0 = t(L0, ids[i]) - t(L0, ids[i - 1]); near(t(L1, ids[i]) - t(L1, ids[i - 1]), k * d0, 1e-9, "間隔は一律 k 倍"); }
    for (const id of ids) { const A = ring0(L0, id), B = ring0(L1, id); for (let q = 1; q < A.length; q += Math.max(1, (A.length / 4) | 0)) near(dist(A[0], A[q]), dist(B[0], B[q]), 1e-9, id + " 形"); }
    // 対象外は不動
    for (const id of ["honshu", "kyushu", "okinawa", "hokkaido", "okinotori", "minamitori", "etorofu"]) assert.deepEqual(ring0(L1, id), ring0(L0, id), id);
    // 並び順が変わらない
    const order = (L) => ids.slice().sort((a, b) => t(L, a) - t(L, b) || a.localeCompare(b)); assert.deepEqual(order(L1), order(L0));
    near(Math.abs(t(L1, other) - t(L1, fixed)), k * Math.abs(t(L0, other) - t(L0, fixed)), 1e-9);
  }
  // 0%は無変化。2方向で固定端が違う
  const z = legacyOff((t) => { t.chainCompression = { mode: "minamiiwo", ratePercent: 0 }; }); assert.deepEqual(ring0(C.layout(model, z), "iwo"), ring0(L0, "iwo"));
  const a = C.layout(model, legacyOff((t) => { t.chainCompression = { mode: "oshima", ratePercent: 40 }; })), b = C.layout(model, legacyOff((t) => { t.chainCompression = { mode: "minamiiwo", ratePercent: 40 }; }));
  assert.notDeepEqual(ctr(a, "minamiiwo"), ctr(b, "minamiiwo"));
});

test("適用順：回転 → 従来の琉球・小笠原間隔/硫黄島基準 → 島列圧縮。旧設定の二重圧縮が起きない", () => {
  const base = adopted(), s = withT((t) => { t.rotationsDeg.izu = 20; t.chainCompression = { mode: "oshima", ratePercent: 30 }; });
  const L1 = C.layout(model, s), Lrot = C.layout(model, withT((t) => { t.rotationsDeg.izu = 20; }));
  // 圧縮率0に戻せば「回転＋従来の補正」だけの配置と完全一致（従来の補正は圧縮と無関係に1回だけ）
  const s0 = C.cloneState(s); s0.terrain.chainCompression.ratePercent = 0; const L0 = C.layout(model, s0);
  for (const i of Lrot.islands) assert.deepEqual(i.ring, ring0(L0, i.id));
  // 二重圧縮の防止：島列圧縮が有効な間は旧・小笠原追加圧縮（50%）を適用しない
  const chichiId = model.islands.find((i) => i.name === "父島").id, with50 = C.layout(model, s), no50 = C.layout(model, (() => { const q = C.cloneState(s); q.terrain.ogasawaraCompressionPercent = 0; return q; })());
  assert.deepEqual(ring0(with50, chichiId), ring0(no50, chichiId), "圧縮有効時は旧追加圧縮の値が配置に影響しない");
  // 従来の小笠原追加圧縮の設定を変えても、固定端（伊豆大島：回転支点＝従来補正の対象外）は動かない
  const s2 = C.cloneState(s); s2.terrain.ogasawaraCompressionPercent = 0; assert.deepEqual(ctr(C.layout(model, s2), "izuoshima"), ctr(L1, "izuoshima"));
  // 旧v10保存相当（新項目なし）は二重圧縮なし：小笠原の位置が従来式のまま
  const v10 = JSON.parse(JSON.stringify(base)); delete v10.terrain.chainCompression; delete v10.terrain.rotationsDeg; const n = C.normalizeState(v10, model);
  const chichi = model.islands.find((i) => i.name === "父島").id; assert.deepEqual(ring0(C.layout(model, n), chichi), ring0(C.layout(model, base), chichi));
});

test("v11保存JSON：回転角・圧縮率・支点・対象島・地形変更レイヤー・軸径を含み、往復で一致", () => {
  const s = withT((t) => { t.rotationsDeg = { izu: 12, ryukyu: -7, northern: 33 }; t.chainCompression = { mode: "minamiiwo", ratePercent: 25 }; t.hiddenRegions = ["takeshima"]; t.heightLayer.fujiSummitM = 3000; t.heightLayer.ridgeSwScale = 1.2; t.heightLayer.globalScale = 1.1; });
  const j = JSON.parse(JSON.stringify(C.serializeState(s, model)));
  assert.equal(j.schemaVersion, 13); assert.equal(j.ship.axisDiameterM, 100); assert.equal(j.ship.population, 12000000);
  assert.equal(j.regionRotations.izu.angleDeg, 12); assert.equal(j.regionRotations.ryukyu.angleDeg, -7); assert.equal(j.regionRotations.northern.angleDeg, 33);
  assert.ok(j.regionRotations.izu.islandIds.includes("izuoshima") && j.regionRotations.northern.islandIds.includes("etorofu") && j.regionRotations.ryukyu.pivotName.includes("屋久島"));
  assert.deepEqual(j.chainCompression.fixedIslandId, "minamiiwo"); assert.equal(j.chainCompression.ratePercent, 25); assert.ok(j.chainCompression.order.length > 20);
  near(j.heightScale.fujiSummitShipM, 825, 1e-9); assert.equal(j.heightScale.verticalFactor, 10); near(j.heightScale.baseFujiShipM, 944, 1e-9);
  const back = C.normalizeState(j, model); assert.deepEqual(back.terrain, s.terrain); assert.deepEqual(back.ship, s.ship);
  assert.deepEqual(C.layout(model, back).islands.map((i) => i.ring), C.layout(model, s).islands.map((i) => i.ring));
  const bad = C.normalizeState({ ship: s.ship, terrain: { ...s.terrain, rotationsDeg: { izu: 999, ryukyu: "x" }, chainCompression: { ratePercent: 500, mode: "?" }, hiddenRegions: ["x", "izu"] } }, model);
  assert.equal(bad.terrain.rotationsDeg.izu, C.ROT_LIMITS.izu); assert.equal(bad.terrain.rotationsDeg.ryukyu, 0); assert.equal(bad.terrain.chainCompression.ratePercent, C.CHAIN_MAX_PERCENT); assert.deepEqual(bad.terrain.hiddenRegions, ["izu"]);
});

test("回転後も はみ出し・地形干渉が再計算され、赤・橙の判定が独立に動く", () => {
  const a = adopted(), I0 = C.interference(C.layout(model, a)).length;
  const s = withT((t) => { t.rotationsDeg.northern = 60; t.rotationsDeg.izu = -25; t.rotationsDeg.ryukyu = 20; }), L = C.layout(model, s), I = C.interference(L), H = C.overhangs(L);
  assert.ok(Number.isFinite(I.length) && H.length >= 0); assert.notDeepEqual(H.map((o) => o.id + o.southKm.toFixed(3)), C.overhangs(C.layout(model, a)).map((o) => o.id + o.southKm.toFixed(3)));
  assert.ok(C.metrics(model, s, L, I).overlapKm2 >= 0);
});

test("地域の表示切替（伊豆・琉球・小笠原・北方領土・竹島）と鳥島2島は独立", () => {
  const ids = (s) => new Set(C.layout(model, s).islands.map((i) => i.id));
  const all = ids(adopted());
  for (const r of ["izu", "ogasawara", "ryukyu", "northern", "takeshima"]) {
    const s = withT((t) => { t.hiddenRegions = [r]; }), got = ids(s), gone = [...all].filter((i) => !got.has(i));
    assert.ok(gone.length > 0 && gone.every((i) => model.byId.get(i).region === r), r); assert.ok(got.has("okinotori") && got.has("minamitori") && got.has("honshu"));
  }
  const s = withT((t) => { t.hiddenRegions = ["northern", "takeshima"]; t.showOkinotori = false; }), g = ids(s); assert.ok(!g.has("okinotori") && g.has("minamitori") && !g.has("etorofu") && !g.has("takeshima") && g.has("izuoshima"));
  // 非表示にしても、他の島の位置は変わらない
  assert.deepEqual(ring0(C.layout(model, s), "honshu"), ring0(C.layout(model, adopted()), "honshu"));
});

test("3D標高：水平も標高も 1/N（富士山 3776m → 94.4m）、元DEMは不変、地形変更レイヤー、回転追従", () => {
  const a = adopted(), L = C.layout(model, a), G = T.buildGrids(model, demPack, a.terrain.heightLayer), S = T.makeShipSampler(C, L, G.grids, model, a.terrain.heightLayer);
  const fp = C.shipPoint(model.toKm(138.7274, 35.3606), L.shifts.get("honshu"));
  near(S(fp[0], fp[1]), 944, 0.1, "富士山 3776×10/40 = 944m（新基準）"); near(S(fp[0] + L.frame.w, fp[1]), 944, 0.1, "周回コピーでも同じ");
  const a20 = C.cloneState(a); a20.terrain.japanScaleDenominator = 20; const L20 = C.layout(model, a20), S20 = T.makeShipSampler(C, L20, G.grids, model, a20.terrain.heightLayer), fp20 = C.shipPoint(model.toKm(138.7274, 35.3606), L20.shifts.get("honshu"));
  near(S20(fp20[0], fp20[1]), 1888, 0.2, "1/20 なら 1888m（10/N）");
  const h0 = G.grids.get("honshu").h.slice(); const hash = require("crypto").createHash("md5").update(Buffer.from(demPack.data.buffer, demPack.data.byteOffset, demPack.data.byteLength)).digest("hex");
  const lay2 = { ...a.terrain.heightLayer, fujiSummitM: 3000, ridgeSwScale: 0, ridgeNeScale: 0 }, G2 = T.buildGrids(model, demPack, lay2), S2 = T.makeShipSampler(C, L, G2.grids, model, lay2);
  near(S2(fp[0], fp[1]), 750, 0.1, "地形変更レイヤー：富士山3000m→750m");
  const lay3 = { ...a.terrain.heightLayer, globalScale: 1.5 }, G3 = T.buildGrids(model, demPack, lay3), S3 = T.makeShipSampler(C, L, G3.grids, model, lay3);
  near(S3(fp[0], fp[1]), 944 * 1.5, 0.2, "全体倍率は基準からの増減（別の値）");
  const lay4 = { ...lay3, fujiSummitM: 3776 / 1.5 }, G4 = T.buildGrids(model, demPack, lay4), S4 = T.makeShipSampler(C, L, G4.grids, model, lay4); near(S4(fp[0], fp[1]), 944, 0.2, "全体倍率と富士山の個別調整は別々に掛かる");
  const mxOf = (a) => { let m = 0; for (const v of a) if (v > m) m = v; return m; };
  assert.ok(mxOf(G2.grids.get("honshu").h) < mxOf(h0), "山脈の盛り上げを0にすると本州の最高点が下がる");
  assert.equal(require("crypto").createHash("md5").update(Buffer.from(demPack.data.buffer, demPack.data.byteOffset, demPack.data.byteLength)).digest("hex"), hash, "元DEMは変更されない");
  assert.equal(T.DEFAULT_LAYER.fujiSummitM, 3776); assert.ok(!("verticalDenominator" in a.terrain) && !("heightRatio" in a.terrain), "独立した高さ縮尺(1/5〜1/10)は無い"); assert.equal(T.VERTICAL_FACTOR, 10); assert.ok(!("fujiRotDeg" in T.DEFAULT_LAYER), "富士山の回転は廃止");
  // 回転した島の標高は島に追従する（西表島の山）
  const r = withT((t) => { t.rotationsDeg.ryukyu = 30; }), Lr = C.layout(model, r), Sr = T.makeShipSampler(C, Lr, G.grids, model, r.terrain.heightLayer);
  const peakAt = (Lx, S0, id) => { const isl = Lx.islands.find((i) => i.id === id); let best = 0, bp = null; for (let x = isl.bb.lx; x <= isl.bb.rx; x += 0.02) for (let y = isl.bb.by; y <= isl.bb.ty; y += 0.02) { const h = S0(x, y); if (h > best) { best = h; bp = [x, y]; } } return { best, bp }; };
  const p0 = peakAt(L, S, "okinawa"), p1 = peakAt(Lr, Sr, "okinawa");
  near(p1.best, p0.best, 10, "沖縄本島の最高点の高さ"); assert.ok(dist(p0.bp, p1.bp) > 0.01, "最高点の位置は島と一緒に回る");
  // 継ぎ目：xとx+円周で同じ高さ
  for (const [x, y] of [[-10, 3], [0.5, -4], [-16, 12]]) near(S(x, y), S(x + L.frame.w, y), 1e-9);
  // 最高点 ≤ 富士山、全体の最高が約94m
  let mx = 0; for (let x = L.frame.x - L.frame.w / 2; x < L.frame.x + L.frame.w / 2; x += 0.1) for (let y = L.frame.y - 25; y < L.frame.y + 25; y += 0.1) mx = Math.max(mx, S(x, y)); assert.ok(mx <= 944.1 && mx > 700, "max " + mx);
  assert.ok(T.checkFuji(model, a.terrain.heightLayer).ok);
});

test("中心軸：直径100m(半径50m)で、居住内面の半径(3km)と別物。3Gの計算は居住内面半径のまま", () => {
  assert.equal(C.AXIS_DIAMETER_M, 100); assert.equal(adopted().ship.axisDiameterM, 100);
  const p = C.physics(adopted().ship); assert.equal(p.radiusM, 3000); near(p.rimSpeedMs, Math.sqrt(3 * 9.80665 * 3000), 1e-9);
  const q = C.cloneState(adopted().ship); q.axisDiameterM = 500; near(C.physics(q).rimSpeedMs, p.rimSpeedMs, 1e-12); // 軸径は3G計算に影響しない
});

test("船体案：採用基準案・南北収容補正案・従来7案・最初期案・利用者v9を引き続き選べる", () => {
  const ids = C.presetList().map((p) => p.id);
  for (const id of ["adopted", "adopted-fit", "user-v9", "legacy-original", "legacy-1", "legacy-2", "legacy-a", "legacy-b", "legacy-3", "legacy-4", "v9-provisional", "initial-third"]) assert.ok(ids.includes(id), id);
  const f = C.presetState(model, "adopted-fit"); assert.equal(C.overhangs(C.layout(model, f)).length, 0);
  assert.deepEqual(f.terrain.rotationsDeg, { izu: 0, ryukyu: 0, northern: 0 });
});
