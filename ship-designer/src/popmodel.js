// 市町村の人口配分（pure）。確定設定（47都道府県×世界文化雛形の県別人口枠）がこの環境では取得できなかったため、
// 枠が無い間は「暫定」（可住面積に比例）で表示し、枠のJSONが読み込まれたらそれを使う。県別枠の合計が船体人口と違っても比例補正はせず、差を記録する。
//   県内配分 = 市町村の 面積 × 県の可住面積比 × 種別係数 × 拠点都市ブースト。係数は暫定値（置換可能）。
(function (root) {
  "use strict";
  const PARAMS = { kind: { city: 1.0, town: 0.55, village: 0.3 }, capitalBoost: 3.0, status: "暫定（確定設定の県別人口枠は未取得）" };
  const isCapital = (pref, m) => m.n === pref.capital || (pref.capital === "東京" && m.n === "東京特別区部");
  /** frame: null | { [prefId]: persons } */
  function compute(model, totalPop, frame, params) {
    const P = Object.assign({}, PARAMS, params || {}), E = model.munis || [], hints = (model.extra && model.extra.popHints) || {}, prefs = new Map(model.prefectures.map((p) => [p.id, p]));
    const out = E.map((m) => { const pf = prefs.get(m.p), hab = pf && pf.habitableFrac != null ? pf.habitableFrac : 0.6; // 暫定の手掛かり人口がある市は それを重みにし、無い市町村は 面積×可住面積比×種別係数×(基礎密度100人/km²相当)
      const hint = hints[m.n] || (pf && isCapital(pf, m) ? hints[pf.capital] : 0); let w = hint ? hint : m.a * Math.max(hab, 0.05) * (P.kind[m.k] || 0.3) * 100; if (!hint && pf && isCapital(pf, m)) w *= P.capitalBoost; return { ...m, w, capital: !!(pf && isCapital(pf, m)) }; });
    const sumW = new Map(); for (const m of out) sumW.set(m.p, (sumW.get(m.p) || 0) + m.w);
    const allW = [...sumW.values()].reduce((a, b) => a + b, 0);
    const prefFrame = new Map(); let imported = 0;
    for (const p of model.prefectures) { const f = frame && Number.isFinite(frame[p.id]) ? frame[p.id] : null; if (f !== null) imported++; prefFrame.set(p.id, f !== null ? f : (totalPop * (sumW.get(p.id) || 0)) / allW); }
    for (const m of out) { const sw = sumW.get(m.p) || 1; m.pop = prefFrame.get(m.p) * (m.w / sw); m.shipAreaKm2 = 0; }
    const frameTotal = [...prefFrame.values()].reduce((a, b) => a + b, 0);
    return { munis: out, prefFrame, frameTotal, diff: frameTotal - totalPop, source: frame ? (imported === model.prefectures.length ? "imported" : "mixed") : "provisional", params: P, importedCount: imported };
  }
  const api = { PARAMS, compute, isCapital }; root.ShipPop = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
