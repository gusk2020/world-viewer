// 道路・鉄道の新規設計（pure）。酷道の線形はコピーしない。県庁所在地・市町村・人口・地形（陸地内）から決める。
//   鉄道＝リニア（電動・非接触）、道路＝専用クレイ＋非接触・局部磁場グリップ（電動、摩擦車輪なし）。船内の通常交通は道路と鉄道のみ（空路・海路なし）。
//   島をまたぐ連絡は未設計（将来拡張：島間連絡、地表以外の工業施設・非回転区画との連絡）。
//   座標は島ごとの元の平面(source km)。島は剛体移動するので、回転・圧縮・円周の折り返しは描画側が島の変換で処理する（円筒周期境界はそこで連続）。
(function (root) {
  "use strict";
  const PARAMS = { railMinPop: 250000, roadHubsPerPref: 8, trunkDemandQuantile: 0.7 };
  const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function pointIn(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  const onLand = (ring, a, b) => { for (const t of [0.15, 0.3, 0.5, 0.7, 0.85]) if (!pointIn(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ring)) return false; return true; };
  /** Prim MST + 近傍リンク。nodes: [{id,pos,pop,island}]。陸地内を通る線だけを採用。 */
  function connect(nodes, ring, extraNearest) {
    const n = nodes.length, edges = [], seen = new Set(), key = (i, j) => (i < j ? i + "-" + j : j + "-" + i);
    if (n < 2) return edges;
    const add = (i, j) => { const k = key(i, j); if (seen.has(k)) return false; seen.add(k); edges.push([i, j]); return true; };
    // 近傍(最大10)だけを候補にして陸地内判定する（全組合せの判定は重い）
    const cand = nodes.map((a, i) => nodes.map((b, j) => [D(a.pos, b.pos), j]).filter((q) => q[1] !== i).sort((x, y) => x[0] - y[0]).slice(0, 10).filter(([, j]) => onLand(ring, a.pos, nodes[j].pos)));
    const adj = nodes.map(() => new Map()); cand.forEach((l, i) => l.forEach(([d, j]) => { adj[i].set(j, d); adj[j].set(i, d); }));
    const comp = new Array(n).fill(-1); let nc = 0;
    for (let s0 = 0; s0 < n; s0++) { if (comp[s0] >= 0) continue; // Prim をつながった成分ごとに
      comp[s0] = nc; const inT = new Set([s0]), best = new Map(), from = new Map(); for (const [v, d] of adj[s0]) { best.set(v, d); from.set(v, s0); }
      while (best.size) { let u = -1, bd = Infinity; for (const [v, d] of best) if (d < bd) { bd = d; u = v; } best.delete(u); inT.add(u); comp[u] = nc; add(u, from.get(u)); for (const [v, d] of adj[u]) if (!inT.has(v) && (!best.has(v) || d < best.get(v))) { best.set(v, d); from.set(v, u); } }
      nc++; }
    if (nc > 1) { // 成分どうしは最短の組を（陸地内かは問わず）つなぐ＝島内の孤立点を残さない
      const reps = []; for (let c = 0; c < nc; c++) reps.push(nodes.map((_, i) => i).filter((i) => comp[i] === c));
      for (let c = 1; c < nc; c++) { let bi = -1, bj = -1, bd = Infinity; for (const i of reps[c]) for (let j = 0; j < n; j++) if (comp[j] < c) { const d = D(nodes[i].pos, nodes[j].pos); if (d < bd) { bd = d; bi = i; bj = j; } } if (bi >= 0) { add(bi, bj); for (const i of reps[c]) comp[i] = comp[bj]; } } }
    cand.forEach((l, i) => l.slice(0, extraNearest).forEach(([, j]) => add(i, j)));
    return edges;
  }
  /** pops: ShipPop.compute の結果。戻り値 {edges:[{mode,tier,a,b,pa,pb,lenKm,demand,island}], nodes} */
  function design(model, pops, params) {
    const P = Object.assign({}, PARAMS, params || {}), prefs = new Map(model.prefectures.map((p) => [p.id, p]));
    const nodes = [], byIsland = new Map();
    // 拠点：県庁所在地（各県の最大都市＝拠点都市ブースト対象）と大都市
    const hubs = new Map();
    for (const m of pops.munis) if (m.i && m.k !== "village") { const sel = m.capital || m.pop >= P.railMinPop; if (sel) hubs.set(m.c, m); }
    const perPref = new Map(); for (const m of pops.munis) { if (!m.i) continue; (perPref.get(m.p) || perPref.set(m.p, []).get(m.p)).push(m); }
    const roadHubs = new Map(hubs); for (const [, l] of perPref) for (const m of l.sort((a, b) => b.pop - a.pop).slice(0, P.roadHubsPerPref)) roadHubs.set(m.c, m);
    const mk = (m, set) => ({ id: m.c, name: m.n, island: m.i, pos: model.toKm(m.g[0], m.g[1]), pop: m.pop, pref: m.p, hub: hubs.has(m.c) });
    const edges = [];
    const groups = (set) => { const g = new Map(); for (const m of set.values()) { if (!g.has(m.i)) g.set(m.i, []); g.get(m.i).push(mk(m)); } return g; };
    for (const [mode, set, near] of [["rail", hubs, 1], ["road", roadHubs, 2]]) {
      for (const [isl, list] of groups(set)) {
        const ring = model.byId.get(isl).ring, es = connect(list, ring, near);
        for (const [i, j] of es) { const a = list[i], b = list[j], len = D(a.pos, b.pos), demand = (a.pop * b.pop) / (len * len + 1); edges.push({ mode, island: isl, a: a.id, b: b.id, pa: a.pos, pb: b.pos, lenKm: len, demand, hubEdge: a.hub && b.hub }); }
      }
    }
    const roadD = edges.filter((e) => e.mode === "road").map((e) => e.demand).sort((x, y) => x - y), cut = roadD[Math.floor(roadD.length * P.trunkDemandQuantile)] || 0;
    for (const e of edges) e.tier = e.mode === "rail" ? "rail" : e.hubEdge || e.demand >= cut ? "trunk" : "local";
    const stat = (f) => edges.filter(f).reduce((s, e) => s + e.lenKm, 0);
    return { edges, params: P, stats: { railKm: stat((e) => e.mode === "rail"), trunkKm: stat((e) => e.tier === "trunk"), localKm: stat((e) => e.tier === "local"), railEdges: edges.filter((e) => e.mode === "rail").length, roadEdges: edges.filter((e) => e.mode === "road").length, hubs: hubs.size, roadHubs: roadHubs.size } };
  }
  const api = { PARAMS, design, connect }; root.ShipNet = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
