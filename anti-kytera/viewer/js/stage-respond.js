// v2 condition response: what the seven stages become when the sea level or
// the mean temperature moves away from the base (sea 0 m, 14 C).
//
// A deliberately simple, body-agnostic chain on top of each body's adopted
// base fields -- no place or body names, the same rules everywhere. The
// constants live in rules/response_rules.json (tools/build_response_rules.py);
// RESPONSE.md explains them.
//
//   sea      land = bedrock >= the chosen sea level (per pixel)
//   T        base + dT x (1 + 0.8 (sin^2 lat - 1/3))   (polar amplification)
//   E        base x exp(0.064 dT_local)  (fixed relative humidity)  x coast
//   P        base x exp(0.02 dT)                                    x coast
//            coast = exp(-(d_new - d_base) / 1000 km), d = distance to the
//            nearest sea on the 2-degree grid, clamped to 0.25..2.5
//   ice      glaciers from the warmest month: summer = T + range/2, the range
//            from the solstice insolation contrast (obliquity, latitude) and
//            the distance to the sea. Ice forms where the new summer is below
//            what a glacier survives (4 C at 500 mm/yr, +1.5 C per doubling)
//            and 3 C below the cell's own base summer; adopted ice melts in
//            the mirror case. Grounded ice a higher sea would float (depth >
//            0.9 x thickness, and not already so at the base) is removed.
//   snow     share of the year below -2 C on ice-free land, x min(1, P/200)
//   sea ice  share of the year the air over the sea is below -5 C
//   veg      a cell keeps its adopted class until the table's share for it at
//            the new climate drops below half its base share, then takes the
//            new climate's top class
//   exposed  seabed that a lower sea turns into land takes the rules' answers
//            directly (there is no base value to keep)
//
// At the base conditions the adopted arrays are restored bit for bit, so the
// approved picture cannot drift; only snow and sea ice (which have no adopted
// value) are computed there.
import { polarFootprint, ICE_MIN_M } from "./stage-data.js";

export const BASE_MEAN_C = 14;   // the mean temperature every adopted estimate was made for (with a 0 m sea)

export function createResponder(data, rules, radiusMetres, obliquityDeg = 23.44) {
  const { F, D } = data;
  const KEYS = ["T_fit", "E_fit", "P_fit", "H_fit"];
  const base = {};
  for (const k of [...KEYS, "veg_fit"]) {
    base[k] = F[k];                                   // the committed view, never written
    const copy = F[k].slice(); copy.meta = F[k].meta; F[k] = copy;   // what the screen and readout use
  }
  const bed = F.bed, BW = bed.meta.w;                               // 1440 x 720, south-first
  const W2 = base.T_fit.meta.w, H2 = base.T_fit.meta.h;              // 180 x 90
  const WH = base.H_fit.meta.w, HH = base.H_fit.meta.h;              // 720 x 360
  const f2 = BW / W2, fh = BW / WH;
  const { tBins, pBins, vegClass, vegShare, physics } = rules;
  const NV = rules.vegCodes.length, VEG_MARGIN = 0.05;
  const L = physics.coastScaleKm * 1000, [mLo, mHi] = physics.moistureFactorRange;
  const rowLat = (j, h) => ((j + 0.5) / h - 0.5) * Math.PI;   // latitude (rad) of row j of a south-first grid

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
    for (let j = 0; j < H2; j++) dx[j] = Math.max(Math.cos(rowLat(j, H2)), 0.02) * 2 * Math.PI * radiusMetres / W2;
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

  // ---- the cryosphere: seasonal range, glaciation, snow and sea ice -------
  // All from quantities every body has: latitude, obliquity, distance to the
  // sea, annual temperature and precipitation. See RESPONSE.md.
  const C = rules.cryo;
  const obl = (Math.min(obliquityDeg, 180 - obliquityDeg) * Math.PI) / 180;
  function insolationRange(latRad) {       // |summer - winter solstice| daily-mean top-of-atmosphere insolation, W/m2
    const Q = (dec) => {
      const h0 = Math.acos(Math.max(-1, Math.min(1, -Math.tan(latRad) * Math.tan(dec))));
      return (1361 / Math.PI) * (h0 * Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.sin(h0));
    };
    return Math.abs(Q(obl) - Q(-obl));
  }
  const dQh = Float64Array.from({ length: HH }, (_, j) => insolationRange(rowLat(j, HH)));
  // Polar amplification of a mean-temperature change: its area mean is exactly dT.
  const amp2 = Float64Array.from({ length: H2 }, (_, j) => 1 + C.polarAmplification * (Math.sin(rowLat(j, H2)) ** 2 - 1 / 3));
  // warmest-minus-coldest-month range: stronger over land far from the sea
  const landRange = (dQ, d) => C.rangePerWm2 * dQ * (C.rangeCoastShare + (1 - C.rangeCoastShare) * (1 - Math.exp(-d / (C.rangeCoastKm * 1000))));
  const seaRange = (dQ) => C.rangeSeaPerWm2 * dQ;
  // share of a sinusoidal year spent below a temperature
  const coldShare = (T, range, thr) => range < 0.5 ? (T < thr ? 1 : 0)
    : Math.acos(Math.max(-1, Math.min(1, (T - thr) / (range / 2)))) / Math.PI;
  // the warmest month a glacier can survive, warmer where snowfall is heavier
  const glacierSummer = (P) => C.glacierSummerC + C.glacierPerDoublingC * Math.log2(Math.max(P, 10) / 500);
  const glacierThickness = (excess) => Math.min(C.glacierMaxM, C.glacierMinM + C.glacierPerDegreeM * Math.max(0, excess));
  for (const k of ["snow", "seaice"]) {
    const a = new Float32Array(WH * HH); a.meta = { w: WH, h: HH, dtype: "f32" }; F[k] = a;
    const b = new Float32Array(WH * HH); b.meta = a.meta; D[k] = b;
  }

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
  // Recompute every stage for the given conditions; returns what changed.
  function update(sea, dT) {
    const t0 = performance.now();
    current = { sea, dT };
    let landShare = null;
    const moved = !(sea === 0 && dT === 0);
    if (!moved) for (const k of [...KEYS, "veg_fit"]) F[k].set(base[k]);
    const L1 = moved ? land2(sea) : null;
    const d1 = !moved || sea === 0 ? d0 : seaDistance(L1);
    if (moved) {
      const cP = Math.exp(physics.precipPerK * dT);
      for (let k = 0; k < W2 * H2; k++) {
        const m = Math.min(mHi, Math.max(mLo, Math.exp(-(d1[k] - d0[k]) / L)));
        const dTk = dT * amp2[Math.floor(k / W2)];
        F.T_fit[k] = base.T_fit[k] + dTk;
        F.E_fit[k] = base.E_fit[k] * Math.exp(physics.humidityPerK * dTk) * m;
        F.P_fit[k] = base.P_fit[k] * cP * m;
      }
    }
    for (let j = 0; j < HH; j++) for (let i = 0; i < WH; i++) {
      const k = j * WH + i, z = bedH[k], land1 = z >= sea, exposed = land1 && z < 0;
      const T1 = up(F.T_fit, j, i), P1 = up(F.P_fit, j, i), dist1 = up(d1, j, i);
      let h1 = base.H_fit[k];
      if (moved) {
        const T0 = up(base.T_fit, j, i), P0 = up(base.P_fit, j, i);
        const a0 = tIdx(T0) * pBins.n + pIdx(P0), a1 = tIdx(T1) * pBins.n + pIdx(P1);
        const h0 = base.H_fit[k];
        // Glaciers from the warmest month: ice forms where the new summer is
        // colder than a glacier survives AND clearly colder than this cell's
        // own base summer; adopted ice melts in the mirror case.
        const Ts0 = T0 + landRange(dQh[j], up(d0, j, i)) / 2, Ts1 = T1 + landRange(dQh[j], dist1) / 2;
        const g1 = glacierSummer(P1), wet = P1 >= C.glacierMinPrecipMm;
        if (exposed) h1 = wet && Ts1 < g1 ? glacierThickness(g1 - Ts1) : 0;
        else if (h0 > ICE_MIN_M && Ts1 > Math.max(g1, Ts0 + C.glacierMarginC)) h1 = 0;                  // melts
        else if (land1 && h0 <= ICE_MIN_M && wet) {
          const thr = Math.min(g1, Ts0 - C.glacierMarginC);
          if (Ts1 < thr) h1 = glacierThickness(thr - Ts1);                                               // forms
        }
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
      // Seasonal snow on ice-free land and sea ice on open sea, as the share
      // of a sinusoidal year spent below snowAirC (sea: below seaIceAirC).
      F.snow[k] = land1 && h1 <= ICE_MIN_M
        ? coldShare(T1, landRange(dQh[j], dist1), C.snowAirC) * Math.min(1, P1 / C.snowPrecipMm) : 0;
      F.seaice[k] = land1 ? 0 : coldShare(T1, seaRange(dQh[j]), C.seaIceAirC);
    }
    if (moved) {
      let a = 0, al = 0;
      for (let j = 0; j < H2; j++) { const w = Math.cos(rowLat(j, H2)); for (let i = 0; i < W2; i++) { a += w; if (L1[j * W2 + i]) al += w; } }
      landShare = al / a;
    }
    for (const k of [...KEYS, "snow", "seaice"]) polarFootprint(F[k], F[k].meta.w, F[k].meta.h, D[k]);
    return { ms: performance.now() - t0, landShare };
  }
  update(0, 0);   // the base's own snow and sea ice
  return { update, atBase: () => current.sea === 0 && current.dT === 0, conditions: () => current };
}

// the rules, fetched once and shared by every body (tables flattened)
let rulesPromise = null;
export function loadRules(url) {
  return (rulesPromise ??= fetch(url).then((r) => { if (!r.ok) throw Error(`Missing ${r.url}`); return r.json(); })
    .then((r) => ({ ...r, vegClass: r.vegClass.flat(), vegShare: r.vegShare.flat(2) }))
    .catch((e) => { rulesPromise = null; throw e; }));
}
