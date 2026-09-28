// 二集団（試作）の評価: turns a run into the numbers compared with the
// observations in twopop/observations.json. The regions there are used ONLY
// here, after the fact; runTwoPop never sees them. "fit" observations are the
// ones a condition's hybridisation rate is calibrated to; "independent" ones
// are only ever checked.
import { TP_W, TP_H, tpCentre } from "./twopop.js";

export function regionMasks(obs) {
  const M = TP_W * TP_H, out = {};
  for (const [name, boxes] of Object.entries(obs.regions)) {
    if (name.startsWith("_")) continue;
    const m = new Uint8Array(M);
    for (let c = 0; c < M; c++) {
      const { lng, lat } = tpCentre(c);
      for (const [a, b, lo, hi] of boxes) { const L = lng < a ? lng + 360 : lng; if (L >= a && L <= b && lat >= lo && lat <= hi) m[c] = 1; }
    }
    out[name] = m;
  }
  return out;
}

// An observer to pass to runTwoPop, and a summary when the run is done.
export function makeEvaluator(obs) {
  const R = regionMasks(obs), series = [];
  const observe = (t, { S, Q, N, cells }) => {
    const row = { t, S: 0, N: 0, reg: {} };
    for (const name of Object.keys(R)) row.reg[name] = { S: 0, Q: 0, N: 0 };
    for (const c of cells) {
      row.S += S[c]; row.N += N[c];
      for (const name in R) if (R[name][c]) { const r = row.reg[name]; r.S += S[c]; r.Q += Q[c]; r.N += N[c]; }
    }
    // non-African = everything outside the Africa boxes
    let s = 0, q = 0; for (const c of cells) if (!R.africa[c]) { s += S[c]; q += Q[c]; }
    row.nonAfrica = { S: s, Q: q };
    series.push(row);
  };
  function summary() {
    const last = series[series.length - 1], anc = (r) => (r.S > 0 ? r.Q / r.S : NaN);
    const maxN = Math.max(...series.map((r) => r.N));
    // Europe: sapiens present = at least 5% of its final number there; Neanderthals present = at least 5% of their largest number there
    const eS = Math.max(...series.map((r) => r.reg.europe.S)), eN = Math.max(...series.map((r) => r.reg.europe.N));
    const both = series.filter((r) => r.reg.europe.S >= 0.05 * eS && r.reg.europe.N >= 0.05 * eN);
    const step = series.length > 1 ? series[1].t - series[0].t : 0;
    const early = Math.max(0, ...both.map((r) => anc(r.reg.europe)).filter((x) => isFinite(x)));
    const regionAnc = ["europe", "southAsia", "eastAsia", "sahul", "americas"].map((k) => [k, anc(last.reg[k])]).filter(([, v]) => isFinite(v));
    const vals = regionAnc.map(([, v]) => v);
    const m = {
      nonAfricanAncestryEnd: anc(last.nonAfrica),
      neanderthalShareEnd: maxN > 0 ? last.N / maxN : 0,
      europeOverlapYears: both.length * step,
      subSaharanAncestryEnd: anc(last.reg.subSaharan),
      // regions without any ancestry at all cannot be compared (NaN = not judged)
      nonAfricanRegionRatio: vals.length > 1 && Math.min(...vals) > 0 ? Math.max(...vals) / Math.min(...vals) : (vals.some((v) => v > 0) ? Infinity : NaN),
      europeEarlyToEndRatio: anc(last.reg.europe) > 0 ? early / anc(last.reg.europe) : (early > 0 ? Infinity : NaN),
      regionAncestry: Object.fromEntries(regionAnc),
      neanderthalGoneYear: (() => { const r = series.find((x) => x.t > 0 && maxN > 0 && x.N <= 0.01 * maxN); return r ? r.t : null; })(),
    };
    const checks = [];
    for (const o of obs.fit) { const v = m[o.measure]; checks.push({ ...o, kind: "fit", value: v, pass: v >= o.range[0] && v <= o.range[1] }); }
    for (const o of obs.independent) {
      const v = m[o.measure];
      let pass;
      if (o.sameOrder) pass = v >= o.sameOrder[0] && v <= o.sameOrder[1];
      else if (o.max != null) pass = v <= o.max;
      else pass = v >= o.min;
      if (Number.isNaN(v)) pass = null;                     // cannot be judged in this run
      else if (!isFinite(v)) pass = o.min != null;           // an infinite ratio passes a minimum, fails a maximum
      checks.push({ ...o, kind: "independent", value: v, pass });
    }
    return { measures: m, checks, series: series.map((r) => ({ t: r.t, S: r.S, N: r.N, anc: anc(r.nonAfrica) })) };
  }
  return { observe, summary };
}
