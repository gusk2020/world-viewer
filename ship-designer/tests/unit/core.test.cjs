// node --test tests/unit
const test = require("node:test"), assert = require("node:assert/strict");
const C = require("../../src/core.js"), geo = require("../../data/ship-geo.json");
const model = C.buildModel(geo);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} vs ${b}`);
const sq = (id, x, y, s, group) => { const ring = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]; return { id, group: group || "main", ring, bb: { lx: x, rx: x + s, by: y, ty: y + s }, areaKm2: s * s }; };

test("data: islands, prefectures, cities and sources are present", () => {
  assert.ok(model.islands.length > 130);
  for (const id of ["honshu", "hokkaido", "kyushu", "shikoku", "okinawa", "iwo", "okinotori", "minamitori"]) assert.ok(model.byId.has(id), id);
  assert.equal(geo.prefectures.length, 49);
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
