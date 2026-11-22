// 過速世界 恒星間船 居住シリンダー設計 — pure logic (no DOM). Shared by the 2D view, the 3D view and the tests.
// Coordinate chain, each step separate:
//   geographic (lon,lat) -> source plane km (v9 plane) -> island adjustment (spacing / 対馬 / 小笠原 / 個別東西補正)
//   -> ship plane km (x east, y north = bow) -> 2D unwrap (x periodic with the circumference) -> 3D cylinder surface.
(function (root) {
  "use strict";
  const G0 = 9.80665;
  const POPULATION = 12000000;
  const SCHEMA_VERSION = 10;
  const ANCHOR_LAT = 31; // v9: the shared south-island spacing pulls toward 31°N
  const ADJUST_GROUPS = new Set(["ryu", "oga", "bird"]);

  // ------------------------------------------------------------------ geometry helpers
  function ringArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; }
  function ringCentroid(p) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const f = p[j][0] * p[i][1] - p[i][0] * p[j][1]; a += f; cx += (p[j][0] + p[i][0]) * f; cy += (p[j][1] + p[i][1]) * f; }
    if (Math.abs(a) < 1e-12) return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
    return [cx / (3 * a), cy / (3 * a)];
  }
  function bbox(p) { let lx = Infinity, rx = -Infinity, by = Infinity, ty = -Infinity; for (const q of p) { if (q[0] < lx) lx = q[0]; if (q[0] > rx) rx = q[0]; if (q[1] < by) by = q[1]; if (q[1] > ty) ty = q[1]; } return { lx, rx, by, ty }; }
  function pointInRing(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  /** x-intervals where a horizontal line at y is inside the ring (even-odd). */
  function rowIntervals(r, y, dx) {
    const xs = [];
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]) + dx); }
    xs.sort((p, q) => p - q);
    const out = []; for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
    return out;
  }
  function intersectIntervals(A, B) {
    const out = []; let i = 0, j = 0;
    while (i < A.length && j < B.length) { const lo = Math.max(A[i][0], B[j][0]), hi = Math.min(A[i][1], B[j][1]); if (hi > lo) out.push([lo, hi]); if (A[i][1] < B[j][1]) i++; else j++; }
    return out;
  }
  /** Area of a ring clipped to the band y0..y1 (Sutherland–Hodgman against a convex band: exact for any subject ring). */
  function bandArea(r, y0, y1) {
    const clip = (pts, keep, cut) => { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], ka = keep(a), kb = keep(b); if (ka) out.push(a); if (ka !== kb) { const t = (cut - a[1]) / (b[1] - a[1]); out.push([a[0] + t * (b[0] - a[0]), cut]); } } return out; };
    let p = clip(r, (q) => q[1] >= y0, y0); if (p.length < 3) return 0;
    p = clip(p, (q) => q[1] <= y1, y1); if (p.length < 3) return 0;
    return Math.abs(ringArea(p));
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ------------------------------------------------------------------ model (source plane, computed once)
  function buildModel(geo) {
    const P = geo.plane;
    const toKm = (lon, lat) => [(lon - P.refLon) * P.kmPerDegLon, (lat - P.refLat) * P.kmPerDegLat];
    const islands = geo.islands.map((s, index) => {
      const ring = s.ring.map(([lo, la]) => toKm(lo, la));
      const c = ringCentroid(ring);
      return { index, id: s.id, name: s.name, group: s.group, source: s.source, pref: s.pref, ring, c, areaKm2: Math.abs(ringArea(ring)), bb: bbox(ring) };
    });
    const byId = new Map(islands.map((s) => [s.id, s]));
    const borders = geo.prefectureBorders.lines.map((b) => ({ island: b.island, line: b.line.map(([lo, la]) => toKm(lo, la)) }));
    const cities = geo.cities.map((c) => ({ ...c, km: toKm(c.geo[0], c.geo[1]) }));
    const prefectures = geo.prefectures.map((p) => ({ ...p, labelKm: toKm(p.labelGeo[0], p.labelGeo[1]), labelIsland: p.island }));
    const anchorY = (ANCHOR_LAT - P.refLat) * P.kmPerDegLat;
    const mainLand = islands.filter((s) => s.group !== "bird");
    return { geo, P, toKm, islands, byId, borders, cities, prefectures, anchorY, iwo: byId.get("iwo"), mainLand, dataVersion: { schema: geo.schema, version: geo.version, builtAt: geo.builtAt } };
  }

  // ------------------------------------------------------------------ design state
  function defaultTerrain() {
    return { japanScaleDenominator: 40, ryukyuSpacingPercent: 90, tsushimaSouthKm: 1, ogasawaraCompressionPercent: 50, showOkinotori: true, showMinamitori: true,
      ogasawaraAnchor: "硫黄島", southIslandSharedSpacing: true, orientation: "true north toward bow", islandOffsetsKm: {} };
  }
  function cloneState(s) { return JSON.parse(JSON.stringify(s)); }

  /** Accepts a v9 or v10 design JSON and returns a validated v10 state. Throws a Japanese message on bad input. */
  function normalizeState(s, model) {
    if (!s || typeof s !== "object" || !s.ship || !s.terrain) throw new Error("船体設定の形式ではありません");
    const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(name + "が数値ではありません"); return n; };
    const D = num(s.ship.innerDiameterKm, "内径"), L = num(s.ship.cylinderLengthKm, "シリンダー長");
    if (D <= 0 || L <= 0) throw new Error("船体寸法は正の値が必要です");
    const t = s.terrain, d = defaultTerrain();
    const pickNum = (v, def, lo, hi) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? def : clamp(Number(v), lo, hi));
    const offsets = {};
    if (t.islandOffsetsKm && typeof t.islandOffsetsKm === "object") for (const [k, v] of Object.entries(t.islandOffsetsKm)) if (Number.isFinite(Number(v)) && (!model || model.byId.has(k))) offsets[k] = Number(v);
    return {
      schemaVersion: SCHEMA_VERSION,
      name: typeof s.name === "string" ? s.name : "名称未設定",
      createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString(),
      migratedFrom: s.version === 9 || s.schemaVersion === undefined ? "v9" : undefined,
      ship: {
        innerDiameterKm: D, cylinderLengthKm: L,
        centerXKm: Number.isFinite(Number(s.ship.centerXKm)) ? Number(s.ship.centerXKm) : 0,
        centerYKm: Number.isFinite(Number(s.ship.centerYKm)) ? Number(s.ship.centerYKm) : 0,
        population: POPULATION, // 正史固定
        gravityG: pickNum(s.ship.gravityG, 3, 0.1, 10),
      },
      terrain: {
        japanScaleDenominator: Math.round(pickNum(t.japanScaleDenominator, d.japanScaleDenominator, 3, 1000)),
        ryukyuSpacingPercent: Math.round(pickNum(t.ryukyuSpacingPercent, 100, 10, 100)),
        tsushimaSouthKm: pickNum(t.tsushimaSouthKm, 0, 0, 25),
        ogasawaraCompressionPercent: Math.round(pickNum(t.ogasawaraCompressionPercent, 0, 0, 100)),
        showOkinotori: !!t.showOkinotori, showMinamitori: !!t.showMinamitori,
        ogasawaraAnchor: "硫黄島", southIslandSharedSpacing: true, orientation: "true north toward bow",
        islandOffsetsKm: offsets,
      },
      sourcePreset: typeof s.sourcePreset === "string" ? s.sourcePreset : null,
    };
  }

  /** The JSON written on save/export. Coordinates are never rounded. */
  function serializeState(state, model, extra) {
    const s = cloneState(state);
    const ph = physics(state.ship);
    return Object.assign({
      schema: "kasoku-ship-design", schemaVersion: SCHEMA_VERSION, name: s.name, createdAt: s.createdAt || new Date().toISOString(),
      ship: Object.assign(s.ship, { circumferenceKm: Math.PI * s.ship.innerDiameterKm }),
      terrain: s.terrain,
      gravity: { targetG: s.ship.gravityG, g0: G0, radiusM: ph.radiusM, rimSpeedMs: ph.rimSpeedMs, omegaRadS: ph.omegaRadS, rpm: ph.rpm, periodS: ph.periodS },
      geoData: model ? model.dataVersion : null,
      sourcePreset: s.sourcePreset,
    }, extra || {});
  }

  // ------------------------------------------------------------------ physics
  function physics(ship) {
    const radiusM = (ship.innerDiameterKm / 2) * 1000, a = (ship.gravityG ?? 3) * G0;
    const omegaRadS = Math.sqrt(a / radiusM), rimSpeedMs = Math.sqrt(a * radiusM), rpm = (omegaRadS * 60) / (2 * Math.PI), periodS = (2 * Math.PI) / omegaRadS;
    const areaKm2 = Math.PI * ship.innerDiameterKm * ship.cylinderLengthKm;
    return { radiusM, accel: a, omegaRadS, rimSpeedMs, rpm, periodS, areaKm2, circumferenceKm: Math.PI * ship.innerDiameterKm, density: POPULATION / areaKm2 };
  }

  // ------------------------------------------------------------------ island adjustment
  function isVisible(s, terrain) { if (s.id === "okinotori") return !!terrain.showOkinotori; if (s.id === "minamitori") return !!terrain.showMinamitori; return true; }
  /** Per-island offsets in ship km: {ox, oy}. Ship point = source km / denominator + offset. */
  function islandShift(model, s, terrain) {
    const denom = terrain.japanScaleDenominator, sp = terrain.ryukyuSpacingPercent / 100;
    let yshift = 0; const cy = s.c[1];
    if (ADJUST_GROUPS.has(s.group)) yshift = (model.anchorY - cy) * (1 - sp);
    if (s.group === "tsushima") yshift -= terrain.tsushimaSouthKm * denom; // ship km -> source km
    if (s.group === "oga" && model.iwo && s !== model.iwo) {
      const iwoY = model.anchorY + (model.iwo.c[1] - model.anchorY) * sp, yy = cy + yshift;
      if (yy > iwoY) yshift += (iwoY - yy) * terrain.ogasawaraCompressionPercent / 100;
    }
    const ox = (terrain.islandOffsetsKm && terrain.islandOffsetsKm[s.id]) || 0;
    return { ox, oy: yshift / denom, denom };
  }
  const shipPoint = (q, sh) => [q[0] / sh.denom + sh.ox, q[1] / sh.denom + sh.oy];

  /** Everything placed in ship coordinates (unwrapped, not yet folded onto the circumference). */
  function layout(model, state) {
    const t = state.terrain, shifts = new Map();
    const islands = [];
    for (const s of model.islands) {
      const sh = islandShift(model, s, t); shifts.set(s.id, sh);
      if (!isVisible(s, t)) continue;
      const ring = s.ring.map((q) => shipPoint(q, sh));
      islands.push({ id: s.id, name: s.name, group: s.group, source: s.source, pref: s.pref, ring, bb: bbox(ring), c: shipPoint(s.c, sh), areaKm2: s.areaKm2 / (sh.denom * sh.denom), small: s.areaKm2 < 60 });
    }
    const borders = model.borders.map((b) => { const sh = shifts.get(b.island); return { island: b.island, line: b.line.map((q) => shipPoint(q, sh)) }; });
    const cities = model.cities.filter((c) => shifts.has(c.island) && isVisible(model.byId.get(c.island), t)).map((c) => ({ id: c.id, name: c.name, kind: c.kind, pref: c.pref, island: c.island, pos: shipPoint(c.km, shifts.get(c.island)) }));
    const denom = t.japanScaleDenominator;
    const prefectures = model.prefectures.map((p) => { const sh = shifts.get(p.island); return { id: p.id, name: p.name, capital: p.capital, pos: shipPoint(p.labelKm, sh), areaShipKm2: p.areaKm2 / (denom * denom), areaRealKm2: p.areaKm2, culture: p.culture }; });
    return { islands, borders, cities, prefectures, shifts, frame: frameOf(state) };
  }
  function frameOf(state) { const s = state.ship; return { x: s.centerXKm, y: s.centerYKm, w: Math.PI * s.innerDiameterKm, h: s.cylinderLengthKm }; }
  /** Fold x into the frame's circumference window [left, left+w). */
  function wrapX(x, frame) { const left = frame.x - frame.w / 2; return ((((x - left) % frame.w) + frame.w) % frame.w) + left; }

  // ------------------------------------------------------------------ interference (physical land overlap, not symbols)
  const ROWS = 160;
  function pairOverlap(A, B, dx, rows) {
    const y0 = Math.max(A.bb.by, B.bb.by), y1 = Math.min(A.bb.ty, B.bb.ty);
    if (y1 <= y0) return null;
    const n = rows || ROWS, dy = (y1 - y0) / n; let area = 0; const rects = [];
    for (let r = 0; r < n; r++) {
      const y = y0 + (r + 0.5) * dy;
      const I = intersectIntervals(rowIntervals(A.ring, y, 0), rowIntervals(B.ring, y, dx));
      for (const [lo, hi] of I) { area += (hi - lo) * dy; rects.push([lo, hi, y - dy / 2, y + dy / 2]); }
    }
    return area > 1e-7 ? { area, rects } : null;
  }
  function shiftsBetween(A, B, w) {
    const out = []; if (!(w > 0)) return out;
    const k0 = Math.ceil((A.bb.lx - B.bb.rx) / w), k1 = Math.floor((A.bb.rx - B.bb.lx) / w);
    for (let k = Math.max(-200, k0); k <= Math.min(200, k1); k++) out.push(k);
    return out;
  }
  /** All overlapping land between islands, including copies brought round the circumference. */
  function interference(lay, opts) {
    const L = lay.islands, w = lay.frame.w, res = [];
    const only = opts && opts.only;
    for (let i = 0; i < L.length; i++) for (let j = i; j < L.length; j++) {
      const A = L[i], B = L[j];
      if (only && !only(A, B)) continue;
      if (A.bb.by >= B.bb.ty || B.bb.by >= A.bb.ty) continue;
      for (const k of shiftsBetween(A, B, w)) {
        if (i === j && k <= 0) continue;
        const dx = k * w;
        if (A.bb.lx >= B.bb.rx + dx || A.bb.rx <= B.bb.lx + dx) continue;
        const o = pairOverlap(A, B, dx, opts && opts.rows);
        if (o) res.push({ a: A.id, b: B.id, k, areaKm2: o.area, rects: o.rects });
      }
    }
    return res;
  }
  /** Overlaps of one island against everything else (used while searching for a correction). */
  function islandConflicts(lay, id) {
    const A = lay.islands.find((s) => s.id === id); if (!A) return [];
    return interference({ islands: [A, ...lay.islands.filter((s) => s.id !== id)], frame: lay.frame }, { only: (a, b) => a === A || b === A, rows: 60 });
  }

  // ------------------------------------------------------------------ 南西諸島の重なり解消（東西方向のみ・最小移動）
  const MARGIN_KM = 0.004;
  function resolveRyukyu(model, state, log) {
    const st = cloneState(state); st.terrain.islandOffsetsKm = Object.assign({}, st.terrain.islandOffsetsKm);
    const touched = new Set();
    for (let iter = 0; iter < 120; iter++) {
      const lay = layout(model, st);
      const bad = interference(lay, { only: (a, b) => a.group === "ryu" || b.group === "ryu", rows: 60 });
      if (!bad.length) break;
      // move the smaller ryu island of the first remaining conflict
      bad.sort((p, q) => q.areaKm2 - p.areaKm2);
      const c = bad[0], A = lay.islands.find((s) => s.id === c.a), B = lay.islands.find((s) => s.id === c.b);
      const cand = [A, B].filter((s) => s.group === "ryu").sort((p, q) => p.areaKm2 - q.areaKm2);
      let moved = false;
      for (const mover of cand) {
        const base = st.terrain.islandOffsetsKm[mover.id] || 0;
        const ok = (dx) => { const s2 = cloneState(st); s2.terrain.islandOffsetsKm[mover.id] = base + dx; return islandConflicts(layout(model, s2), mover.id).length === 0; };
        let best = null;
        for (const dir of [1, -1]) {
          let lo = 0, hi = null;
          for (let step = 0.01; step <= lay.frame.w / 2; step *= 1.35) { if (ok(dir * step)) { hi = step; break; } lo = step; }
          if (hi === null) continue;
          for (let b = 0; b < 18; b++) { const mid = (lo + hi) / 2; if (ok(dir * mid)) hi = mid; else lo = mid; }
          const v = dir * (hi + MARGIN_KM);
          if (best === null || Math.abs(v) < Math.abs(best)) best = v;
        }
        if (best !== null && ok(best)) { st.terrain.islandOffsetsKm[mover.id] = +(base + best).toFixed(5); touched.add(mover.id); moved = true; if (log) log(mover.name || mover.id, best); break; }
      }
      if (!moved) break;
    }
    return { state: st, moved: [...touched] };
  }

  // ------------------------------------------------------------------ metrics
  function metrics(model, state, lay, inter) {
    const ph = physics(state.ship), f = lay.frame, south = f.y - f.h / 2, north = f.y + f.h / 2;
    let landInFrame = 0, landTotal = 0, ymin = Infinity, ymax = -Infinity;
    for (const s of lay.islands) { landTotal += s.areaKm2; landInFrame += bandArea(s.ring, south, north); ymin = Math.min(ymin, s.bb.by); ymax = Math.max(ymax, s.bb.ty); }
    const overlap = inter.reduce((a, o) => a + o.areaKm2, 0);
    const landNet = Math.max(0, landInFrame - overlap);
    return {
      physics: ph, landTotalKm2: landTotal, landInFrameKm2: landInFrame, overlapKm2: overlap, landNetKm2: landNet,
      seaKm2: Math.max(0, ph.areaKm2 - landNet), landShare: landNet / ph.areaKm2,
      densityPerLandKm2: landNet > 0 ? POPULATION / landNet : Infinity,
      overhangNorthKm: Math.max(0, ymax - north), overhangSouthKm: Math.max(0, south - ymin), interferenceCount: inter.length,
    };
  }

  // ------------------------------------------------------------------ presets
  const LEGACY = [
    { id: "legacy-original", name: "原案｜8km × 77km", d: 8, l: 77 },
    { id: "legacy-1", name: "① 3/4｜6km × 57.75km", d: 6, l: 57.75 },
    { id: "legacy-2", name: "② 1/2｜4km × 38.5km", d: 4, l: 38.5 },
    { id: "legacy-a", name: "中間A 2/5｜3.2km × 30.8km", d: 3.2, l: 30.8 },
    { id: "legacy-b", name: "中間B 1/3｜2.67km × 25.67km", d: 8 / 3, l: 77 / 3 },
    { id: "legacy-3", name: "③ 1/5｜1.6km × 15.4km", d: 1.6, l: 15.4 },
    { id: "legacy-4", name: "④ 1/10｜0.8km × 7.7km", d: 0.8, l: 7.7 },
  ];
  /** The user's own adjusted design (kasoku-cylinder-2026-11-22.json), verbatim. */
  const USER_V9_JSON = { version: 9, name: "暫定案更新版", createdAt: "2026-11-22T16:19:47.148Z",
    ship: { innerDiameterKm: 6, cylinderLengthKm: 50.7622528901549, circumferenceKm: 18.84955592153876, centerXKm: -7.726051000488052, centerYKm: 4.424036296290547, population: 12000000 },
    terrain: { japanScaleDenominator: 40, ryukyuSpacingPercent: 90, tsushimaSouthKm: 1, ogasawaraCompressionPercent: 50, showOkinotori: true, showMinamitori: true, ogasawaraAnchor: "硫黄島", southIslandSharedSpacing: true, orientation: "true north toward bow" }, sourcePreset: null };
  // 南西諸島の東西補正（tools/fit_ryukyu.mjs が算出。採用基準案の初期値）
  const ADOPTED_OFFSETS = (root.SHIP_ADOPTED_OFFSETS) || {};

  function landBounds(model, terrain) {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    const t = Object.assign({}, terrain, { islandOffsetsKm: {} });
    for (const s of model.mainLand) { const sh = islandShift(model, s, t); for (const q of s.ring) { const p = shipPoint(q, sh); xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]); ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); } }
    return { xmin, xmax, ymin, ymax, w: xmax - xmin, h: ymax - ymin, cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2 };
  }
  function presetList() {
    return [
      { id: "adopted", name: "★採用基準案｜6.0km × 51.0km・1/40" },
      { id: "user-v9", name: "利用者調整 原値（2026-11-22 JSON）" },
      ...LEGACY.map((p) => ({ id: p.id, name: p.name })),
      { id: "v9-provisional", name: "v9 暫定決定｜7.2km × 60.8km" },
      { id: "initial-third", name: "最初期｜列島1/3が収まる船体" },
    ];
  }
  function presetState(model, id) {
    const base = (ship, terrain, name) => normalizeState({ name, ship, terrain, sourcePreset: name }, model);
    const nm = (presetList().find((p) => p.id === id) || {}).name || id;
    if (id === "adopted") {
      const s = normalizeState(USER_V9_JSON, model);
      s.ship.innerDiameterKm = 6.0; s.ship.cylinderLengthKm = 51.0; // 表示・初期設定のみ丸める。中心座標は原値のまま。
      s.terrain.islandOffsetsKm = Object.assign({}, ADOPTED_OFFSETS);
      s.name = "採用基準案"; s.sourcePreset = nm; s.migratedFrom = undefined; return s;
    }
    if (id === "user-v9") { const s = normalizeState(USER_V9_JSON, model); s.sourcePreset = nm; return s; }
    const t0 = { japanScaleDenominator: 3, ryukyuSpacingPercent: 100, tsushimaSouthKm: 0, ogasawaraCompressionPercent: 0, showOkinotori: false, showMinamitori: false };
    if (id === "initial-third") { const b = landBounds(model, t0); return base({ innerDiameterKm: (b.w * 1.02) / Math.PI, cylinderLengthKm: b.h * 1.02, centerXKm: b.cx, centerYKm: b.cy }, t0, nm); }
    if (id === "v9-provisional") { const t = Object.assign({}, t0, { japanScaleDenominator: 33, ryukyuSpacingPercent: 33 }); const b = landBounds(model, t); return base({ innerDiameterKm: 7.2, cylinderLengthKm: 60.8, centerXKm: b.cx, centerYKm: b.cy }, t, nm); }
    const L = LEGACY.find((p) => p.id === id);
    if (!L) throw new Error("不明な案: " + id);
    const h1 = landBounds(model, Object.assign({}, t0, { japanScaleDenominator: 1 })).h;
    const t = Object.assign({}, t0, { japanScaleDenominator: clamp(Math.ceil(h1 / L.l), 3, 1000) });
    const b = landBounds(model, t);
    return base({ innerDiameterKm: L.d, cylinderLengthKm: L.l, centerXKm: b.cx, centerYKm: b.cy }, t, nm);
  }

  // ------------------------------------------------------------------ 3D mapping (cylinder inner surface)
  /** Ship point -> 3D. Axis = z (north/bow = +z), floor of the west seam at -y. East turns toward -x so that, standing on the
   *  inner surface facing the bow (up = toward the axis), east is on your right — the map is not mirrored from inside. */
  function toCylinder(x, y, frame, radius, inset) {
    const left = frame.x - frame.w / 2, th = ((x - left) / frame.w) * 2 * Math.PI, r = radius - (inset || 0);
    return [-r * Math.sin(th), -r * Math.cos(th), y - frame.y];
  }

  const api = { G0, POPULATION, SCHEMA_VERSION, buildModel, defaultTerrain, normalizeState, serializeState, physics, layout, wrapX, interference, islandConflicts, resolveRyukyu, metrics,
    presetList, presetState, landBounds, toCylinder, frameOf, USER_V9_JSON, ringArea, bandArea, pointInRing, pairOverlap, isVisible, cloneState };
  root.ShipCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
