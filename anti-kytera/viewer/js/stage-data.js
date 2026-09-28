// v2 stage data: loading, the two copies of every field, and the ice/sea/
// vegetation judgement. No drawing and no DOM here.
//
// Loads the committed results of PR #12 (results/display.json + fields.bin:
// bed, temperature, humidity, precipitation, ice thickness, each fit /
// holdout / teacher) and of the vegetation layer (veg/results/: 15 classes,
// fit / holdout / teacher). Nothing is estimated here.
//
// Two copies, kept apart on purpose:
//   F  the committed arrays exactly as stored -- the centre readout reads
//      these (元データ値);
//   D  drawing copies of the continuous fields, averaged east-west over an
//      equal footprint poleward of 60 degrees (polarFootprint) -- 3D and 2D
//      both draw from these, never the readout.
// Vegetation classes exist only in F and are never averaged.
//
// The ice > sea > vegetation judgement is written twice, once here in JS and
// once in GLSL (stage-draw.js, akVeg): drawnComposite() is the shader's twin
// (used to say when the screen and the raw cell disagree), rawComposite() is
// the cell definition at a given sea level (the readout).
export const ICE_MIN_M = 10;          // the hand-off ice mask threshold
export const POLAR_AVERAGE_LAT = 60;         // polarFootprint's window exceeds one cell poleward of this
export const MODE_JA = { fit: "地球適合", holdout: "地域保留" };

export function polarFootprint(a, w, h, out = new Float32Array(w * h)) {
  const pre = new Float64Array(w + 1);
  for (let j = 0; j < h; j++) {
    const lat = ((j + 0.5) / h - 0.5) * Math.PI;
    const half = Math.min((w >> 1) - 1, Math.max(0, Math.round((1 / Math.max(Math.cos(lat), 1e-6) - 1) / 2)));
    const row = j * w;
    if (half === 0) { for (let i = 0; i < w; i++) out[row + i] = a[row + i]; continue; }
    for (let i = 0; i < w; i++) pre[i + 1] = pre[i] + a[row + i];
    const n = 2 * half + 1, total = pre[w];
    for (let i = 0; i < w; i++) {
      const lo = i - half, hi = i + half + 1;
      let sum;
      if (lo < 0) sum = pre[hi] + total - pre[w + lo];
      else if (hi > w) sum = pre[w] - pre[lo] + pre[hi - w];
      else sum = pre[hi] - pre[lo];
      out[row + i] = sum / n;
    }
  }
  return out;
}

export async function loadBin(path) { return (await fetch(path)).arrayBuffer(); }

export async function loadStageData(base, planetary = false) {
  const results = planetary ? `${base}stages/` : `${base}results/`;
  const vegetation = planetary ? `${base}stages/` : `${base}veg/results/`;
  const [S, V] = await Promise.all([
    fetch(`${results}display.json`).then((r) => { if (!r.ok) throw Error(`Missing stage data: ${r.url}`); return r.json(); }),
    fetch(`${vegetation}veg_display.json`).then((r) => { if (!r.ok) throw Error(`Missing vegetation data: ${r.url}`); return r.json(); }),
  ]);
  const [sb, vb] = await Promise.all([loadBin(`${results}fields.bin`), loadBin(`${vegetation}veg_fields.bin`)]);
  const F = {}, D = {};   // F: committed arrays as stored (readout); D: drawing copies
  const view = (meta, buf, keys) => {
    for (const k of keys) {
      const f = meta.fields[k];
      F[k] = new ({ i16: Int16Array, u8: Uint8Array, f32: Float32Array }[f.dtype])(buf, f.offset, f.w * f.h);
      F[k].meta = f;
    }
  };
  view(S, sb, Object.keys(S.fields));
  view(V, vb, ["veg_fit", "veg_holdout", "veg_teacher"]);
  for (const k of Object.keys(S.fields)) { const m = F[k].meta; D[k] = polarFootprint(F[k], m.w, m.h); D[k].meta = m; }
  const vcol = {}, vlab = {};
  for (const c of V.classes) { vcol[c.code] = c.rgb; vlab[c.code] = c.ja; }
  for (const [k, s2] of Object.entries(V.special)) { vcol[k] = s2.rgb; vlab[k] = s2.ja; }
  function cell(name, lng, lat, src = F) {
    const f = src[name].meta;
    const y = Math.min(f.h - 1, Math.max(0, Math.floor((lat + 90) / 180 * f.h)));
    const x = ((Math.floor((lng + 180) / 360 * f.w) % f.w) + f.w) % f.w;
    return src[name][y * f.w + x];
  }
  function bilinear(name, lng, lat, src = D) {
    const f = src[name].meta, a = src[name];
    const fy = (lat + 90) / 180 * f.h - 0.5, fx = (lng + 180) / 360 * f.w - 0.5;
    const y0 = Math.max(0, Math.min(f.h - 1, Math.floor(fy))), y1 = Math.min(f.h - 1, y0 + 1);
    const wy = Math.max(0, Math.min(1, fy - y0));
    let x0 = Math.floor(fx); const wx = fx - x0;
    x0 = ((x0 % f.w) + f.w) % f.w; const x1 = (x0 + 1) % f.w;
    return (a[y0 * f.w + x0] * (1 - wx) + a[y0 * f.w + x1] * wx) * (1 - wy) +
           (a[y1 * f.w + x0] * (1 - wx) + a[y1 * f.w + x1] * wx) * wy;
  }
  // drawn: what the screen paints at the given sea level (the shader's twin);
  // raw: what the committed cells say at 0 m. Order: ice > sea > vegetation.
  function drawnComposite(which, lng, lat, seaLevel) {
    if (bilinear(`H_${which}`, lng, lat) > ICE_MIN_M) return 1;
    const z = bilinear("bed", lng, lat);
    if (z < seaLevel) return 0;                            // seabed a lower sea exposes carries its own estimate
    return cell(`veg_${which}`, lng, lat) || 255;
  }
  function rawComposite(which, lng, lat, seaLevel = 0) {
    if (cell(`H_${which}`, lng, lat) > ICE_MIN_M) return 1;
    if (cell("bed", lng, lat) < seaLevel) return 0;
    return cell(`veg_${which}`, lng, lat) || 255;
  }
  return { S, V, F, D, vcol, vlab, cell, bilinear, drawnComposite, rawComposite, hasTeacher: !planetary };
}
