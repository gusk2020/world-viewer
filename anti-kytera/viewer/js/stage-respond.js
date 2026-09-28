// v2 condition response: what the seven stages become when the sea level or
// the mean temperature moves away from the base (sea 0 m, 14 C).
//
// A deliberately simple, body-agnostic chain on top of each body's adopted
// base fields -- no place or body names, the same rules everywhere:
//
//   sea      land = bedrock >= the chosen sea level (as before, per pixel)
//   T        base + (mean temperature - 14)
//   E        base x exp(0.064 dT)  (fixed relative humidity)  x coast factor
//   P        base x exp(0.02 dT)                               x coast factor
//            coast factor = exp(-(d_new - d_base) / 1000 km), d = distance
//            to the nearest sea on the 2-degree grid, clamped to 0.25..2.5
//   ice      the Earth-learnt table (rules/response_rules.json) gives the
//            share of land carrying ice in a (T, P) climate; ice melts where
//            that share falls below 0.5 by more than 0.2 from the base, and
//            forms where it rises past 0.5 by more than 0.2
//   veg      the same table gives each class's share; a cell keeps its
//            adopted class until its share at the new climate drops below
//            half its base share, then takes the new climate's top class
//   exposed  seabed that a lower sea turns into land takes the tables'
//            answers directly (there is no base value to keep)
//   floating grounded ice that a higher sea would float (depth > 0.9 x
//            thickness, and not already so at the base) is removed
//
// At the base conditions nothing is computed and the adopted arrays are
// restored bit for bit, so the approved picture cannot drift.
import { polarFootprint, ICE_MIN_M } from "./stage-data.js";

export function createResponder(data, rules, radiusMetres) {
  const { F, D } = data;
  const KEYS = ["T_fit", "E_fit", "P_fit", "H_fit"];
  const base = {};
  for (const k of [...KEYS, "veg_fit"]) {
    base[k] = F[k];                                   // the committed view, never written
    const copy = F[k].slice(); copy.meta = F[k].meta; F[k] = copy;   // what the screen and readout use
  }
  const bed = F.bed, BW = bed.meta.w, BH = bed.meta.h;              // 1440 x 720, south-first
  const W2 = base.T_fit.meta.w, H2 = base.T_fit.meta.h;              // 180 x 90
  const WH = base.H_fit.meta.w, HH = base.H_fit.meta.h;              // 720 x 360
  const f2 = BW / W2, fh = BW / WH;
  const { tBins, pBins, iceShare, iceThicknessM, vegClass, vegShare, physics } = rules;
  const NV = rules.vegCodes.length, ICE_MARGIN = 0.2, VEG_MARGIN = 0.05;
  const L = physics.coastScaleKm * 1000, [mLo, mHi] = physics.moistureFactorRange;

  // bedrock averaged onto the 0.5-degree grid (ice and vegetation cells)
  const bedH = new Float32Array(WH * HH);
  for (let j = 0; j < HH; j++) for (let i = 0; i < WH; i++) {
    let s = 0;
    for (let b = 0; b < fh; b++) for (let a = 0; a < fh; a++) s += bed[(j * fh + b) * BW + i * fh + a];
    bedH[j * WH + i] = s / (fh * fh);
  }
  function land2(sea) {                      // 2-degree cell is land if at least half its bedrock is above the sea
    const out = new Uint8Array(W2 * H2), half = (f2 * f2) / 2;
    for (let j = 0; j < H2; j++) for (let i = 0; i < W2; i++) {
      let n = 0;
      for (let b = 0; b < f2; b++) { const row = (j * f2 + b) * BW + i * f2; for (let a = 0; a < f2; a++) if (bed[row + a] >= sea) n++; }
      out[j * W2 + i] = n >= half ? 1 : 0;
    }
    return out;
  }
  function seaDistance(land) {               // metres to the nearest sea cell; chamfer with east-west wrap
    const d = new Float64Array(W2 * H2), dy = Math.PI * radiusMetres / H2;
    const dx = new Float64Array(H2);
    for (let j = 0; j < H2; j++) dx[j] = Math.max(Math.cos(((j + 0.5) / H2 - 0.5) * Math.PI), 0.02) * 2 * Math.PI * radiusMetres / W2;
    for (let k = 0; k < d.length; k++) d[k] = land[k] ? Infinity : 0;
    const relax = (j, i, jj, ii, w) => { if (jj < 0 || jj >= H2) return; const o = d[jj * W2 + ((ii + W2) % W2)] + w; if (o < d[j * W2 + i]) d[j * W2 + i] = o; };
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < H2; j++) for (let i = 0; i < W2; i++) {
        const dg = Math.hypot(dx[j], dy);
        relax(j, i, j, i - 1, dx[j]); relax(j, i, j - 1, i, dy); relax(j, i, j - 1, i - 1, dg); relax(j, i, j - 1, i + 1, dg);
      }
      for (let j = H2 - 1; j >= 0; j--) for (let i = W2 - 1; i >= 0; i--) {
        const dg = Math.hypot(dx[j], dy);
        relax(j, i, j, i + 1, dx[j]); relax(j, i, j + 1, i, dy); relax(j, i, j + 1, i + 1, dg); relax(j, i, j + 1, i - 1, dg);
      }
    }
    for (let k = 0; k < d.length; k++) if (!Number.isFinite(d[k])) d[k] = 2e7;   // no sea at all
    return d;
  }
  const d0 = seaDistance(land2(0));

  // bilinear 2-degree -> 0.5-degree cell centre (same convention as the shader)
  function up(a, j, i) {
    const fy = (j + 0.5) / HH * H2 - 0.5, fx = (i + 0.5) / WH * W2 - 0.5;
    const y0 = Math.max(0, Math.min(H2 - 1, Math.floor(fy))), y1 = Math.min(H2 - 1, y0 + 1), wy = Math.max(0, Math.min(1, fy - y0));
    let x0 = Math.floor(fx); const wx = fx - x0; x0 = (x0 + W2) % W2; const x1 = (x0 + 1) % W2;
    return (a[y0 * W2 + x0] * (1 - wx) + a[y0 * W2 + x1] * wx) * (1 - wy) + (a[y1 * W2 + x0] * (1 - wx) + a[y1 * W2 + x1] * wx) * wy;
  }
  const tIdx = (t) => Math.max(0, Math.min(tBins.n - 1, Math.floor((t - tBins.lo) / tBins.step)));
  const pIdx = (p) => Math.max(0, Math.min(pBins.n - 1, Math.floor((Math.log10(Math.max(p, 10)) - pBins.log10lo) / pBins.step)));

  let current = { sea: 0, dT: 0 };
  function restore() {
    for (const k of [...KEYS, "veg_fit"]) F[k].set(base[k]);
  }
  // Recompute every stage for the given conditions; returns what changed.
  function update(sea, dT) {
    const t0 = performance.now();
    current = { sea, dT };
    let landShare = null;
    if (sea === 0 && dT === 0) restore();
    else {
      const L1 = land2(sea), d1 = sea === 0 ? d0 : seaDistance(L1);
      const cE = Math.exp(physics.humidityPerK * dT), cP = Math.exp(physics.precipPerK * dT);
      for (let k = 0; k < W2 * H2; k++) {
        const m = Math.min(mHi, Math.max(mLo, Math.exp(-(d1[k] - d0[k]) / L)));
        F.T_fit[k] = base.T_fit[k] + dT;
        F.E_fit[k] = base.E_fit[k] * cE * m;
        F.P_fit[k] = base.P_fit[k] * cP * m;
      }
      for (let j = 0; j < HH; j++) for (let i = 0; i < WH; i++) {
        const k = j * WH + i, z = bedH[k], land1 = z >= sea, exposed = land1 && z < 0;
        const T0 = up(base.T_fit, j, i), T1 = T0 + dT, P0 = up(base.P_fit, j, i), P1 = up(F.P_fit, j, i);
        const a0 = tIdx(T0) * pBins.n + pIdx(P0), a1 = tIdx(T1) * pBins.n + pIdx(P1);
        const s0 = iceShare[a0], s1 = iceShare[a1], h0 = base.H_fit[k];
        let h1 = h0;
        if (exposed) h1 = s1 >= 0.5 ? iceThicknessM[a1] : 0;
        else if (h0 > ICE_MIN_M && s1 < 0.5 && s0 - s1 > ICE_MARGIN) h1 = 0;                        // melts
        else if (land1 && h0 <= ICE_MIN_M && s1 >= 0.5 && s1 - s0 > ICE_MARGIN) h1 = iceThicknessM[a1]; // forms
        // Grounded ice that the new sea would float (water depth above 0.9 of
        // its thickness, and not already so at the base sea) is lost.
        if (h1 > ICE_MIN_M && sea - z > 0.9 * h1 && -z <= 0.9 * h0) h1 = 0;
        F.H_fit[k] = h1;
        const v0 = base.veg_fit[k];
        let v1 = v0;
        if (land1) {
          if (exposed || v0 < 11 || v0 > 25) v1 = vegClass[a1];
          else {
            // keep the adopted class until the new climate clearly stops supporting it
            const p0 = vegShare[a0 * NV + v0 - 11], p1 = vegShare[a1 * NV + v0 - 11];
            if (vegClass[a1] !== v0 && p1 < 0.5 * p0 && p0 - p1 > VEG_MARGIN) v1 = vegClass[a1];
          }
        }
        F.veg_fit[k] = v1;
      }
      let a = 0, al = 0;
      for (let j = 0; j < H2; j++) { const w = Math.cos(((j + 0.5) / H2 - 0.5) * Math.PI); for (let i = 0; i < W2; i++) { a += w; if (L1[j * W2 + i]) al += w; } }
      landShare = al / a;
    }
    for (const k of KEYS) polarFootprint(F[k], F[k].meta.w, F[k].meta.h, D[k]);
    return { ms: performance.now() - t0, landShare };
  }
  return { update, atBase: () => current.sea === 0 && current.dT === 0, conditions: () => current, ICE_MIN_M };
}

// the flattened lookup tables, fetched once and shared by every body
let rulesPromise = null;
export function loadRules(url) {
  return (rulesPromise ??= fetch(url).then((r) => { if (!r.ok) throw Error(`Missing ${r.url}`); return r.json(); })
    .then((r) => ({ ...r, iceShare: r.iceShare.flat(), iceThicknessM: r.iceThicknessM.flat(), vegClass: r.vegClass.flat(), vegShare: r.vegShare.flat(2) }))
    .catch((e) => { rulesPromise = null; throw e; }));
}
