// グレートジャーニー: which arrows are shown, and in what colour -- no three.js,
// no DOM, so node (tools/journey_arrows_report.mjs) checks exactly what the
// phone draws. journey-view.js draws them.
//
// journey.js records one arrow per ~1000-year period per 6x6-degree bin. At
// display time, arrows of the SAME era (colour) that start close together and
// point the same way are shown as one: their land areas add up, their start
// point and direction are area-weighted means, and the merged arrow appears
// when the earliest of them does. Nothing in the journey is deleted; the
// merge is a drawing choice, and every recorded arrow keeps a shown arrow of
// its own era, pointing within MERGE_MAX_TURN_DEG of its direction, whose
// start is at most MERGE_RADIUS_DEG from its own (checked for every member
// whenever a member is added, not only for the newcomer). An arrow in which
// at least KEEP_CROSSING_SHARE of the newly reached cells were reached across
// open water (`water`: cells whose arrival crossed CROSSING_KM or more since
// the last land -- a landing on a new shore) is never merged: it stays
// exactly where the journey recorded it.
import { ARROW_YEARS } from "./journey.js";

export const WIDTH_MIN_DEG = 0.2, WIDTH_MAX_DEG = 1.1;
export const MERGE_RADIUS_DEG = 4.5;       // how far a recorded arrow may sit from the arrow that shows it
export const MERGE_MAX_TURN_DEG = 35;      // how differently they may point
export const KEEP_CROSSING_SHARE = 0.25;   // an arrow with at least this share of its land reached across water is never merged

// ------------------------------------------------------------ eras
// A few equal eras over the journey, on a round step, coloured along an
// ordered dark-to-light ramp (plasma-like; the dark rim keeps the light end
// readable). eras(endYear) -> [{ from, to, rgb }]
const ERA_STEPS = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
const ERA_RAMP = [[0, [13, 8, 135]], [0.1, [65, 4, 157]], [0.2, [106, 0, 168]], [0.3, [143, 13, 164]], [0.4, [177, 42, 144]], [0.5, [204, 71, 120]],
  [0.6, [225, 100, 98]], [0.7, [242, 132, 75]], [0.8, [252, 166, 54]], [0.9, [252, 206, 37]], [1, [240, 249, 33]]];
function rampAt(f) {
  for (let i = 1; i < ERA_RAMP.length; i++) {
    const [f1, c1] = ERA_RAMP[i], [f0, c0] = ERA_RAMP[i - 1];
    if (f <= f1) { const u = (f - f0) / (f1 - f0); return c0.map((x, j) => Math.round(x + (c1[j] - x) * u)); }
  }
  return ERA_RAMP[ERA_RAMP.length - 1][1];
}
export function eras(endYear) {
  const end = Math.max(endYear, ARROW_YEARS);
  const step = ERA_STEPS.find((s) => Math.ceil(end / s) <= 8) || ERA_STEPS[ERA_STEPS.length - 1];
  const n = Math.ceil(end / step), out = [];
  for (let b = 0; b < n; b++) out.push({ from: b * step, to: (b + 1) * step, rgb: rampAt(n > 1 ? b / (n - 1) : 0.5) });
  return out;
}
const eraIndex = (list, years) => Math.min(list.length - 1, Math.floor(years / list[0].to));

// ------------------------------------------------------------ merging
const D2R = Math.PI / 180;
const unit = (lng, lat) => [Math.cos(lat * D2R) * Math.cos(lng * D2R), Math.sin(lat * D2R), Math.cos(lat * D2R) * Math.sin(lng * D2R)];
const angleDeg = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) / D2R;
// an arrow's direction as a 3D tangent vector at its start, so directions at
// different places can be averaged and compared
function tangent(a) {
  const la = a.lat * D2R, lo = a.lng * D2R;
  const east = [-Math.sin(lo), 0, Math.cos(lo)], north = [-Math.sin(la) * Math.cos(lo), Math.cos(la), -Math.sin(la) * Math.sin(lo)];
  return [0, 1, 2].map((i) => a.east * east[i] + a.north * north[i]);
}
function summarise(c) {                              // cluster -> one arrow in the journey.js arrow format
  const [x, y, z] = c.p, l = Math.hypot(x, y, z) || 1, lat = Math.asin(y / l) / D2R, lng = Math.atan2(z, x) / D2R;
  const la = lat * D2R, lo = lng * D2R;
  const east = [-Math.sin(lo), 0, Math.cos(lo)], north = [-Math.sin(la) * Math.cos(lo), Math.cos(la), -Math.sin(la) * Math.sin(lo)];
  const e = c.d[0] * east[0] + c.d[1] * east[1] + c.d[2] * east[2], nn = c.d[0] * north[0] + c.d[1] * north[1] + c.d[2] * north[2];
  const L = Math.hypot(e, nn) || 1;
  return { m: c.m, n: c.n, area: c.area, lng, lat, east: e / L, north: nn / L, members: c.members.length };
}
// raw: journey.arrows; list: eras(). Returns merged arrows (same format, plus
// `members`), largest first within each era.
export function mergeArrows(raw, list, radiusDeg = MERGE_RADIUS_DEG, maxTurnDeg = MERGE_MAX_TURN_DEG, keepShare = KEEP_CROSSING_SHARE) {
  const byEra = new Map();
  for (const a of raw) {
    const k = eraIndex(list, a.m * ARROW_YEARS + ARROW_YEARS / 2);
    if (!byEra.has(k)) byEra.set(k, []);
    byEra.get(k).push(a);
  }
  const out = [];
  for (const group of byEra.values()) {
    group.sort((a, b) => b.area - a.area);           // big arrows seed the clusters
    const clusters = [];
    for (const a of group) {
      const u = unit(a.lng, a.lat), t = tangent(a);
      let joined = false;
      if (a.water > 0 && a.water >= keepShare * a.n) { out.push({ ...a, members: 1 }); continue; }   // mostly arrivals over water: keep it as recorded
      for (const c of clusters) {
        const s = summarise(c), cu = unit(s.lng, s.lat);
        if (angleDeg(u, cu) > radiusDeg || angleDeg(t, c.d) > maxTurnDeg) continue;
        // try it: the new centre and direction must still be within reach of every member
        const w = a.area, p = c.p.map((v, i) => v + w * u[i]), d = c.d.map((v, i) => v + w * t[i]);
        const pl = Math.hypot(...p), dl = Math.hypot(...d);
        if (!(dl > 0)) continue;
        const pu = p.map((v) => v / pl), du = d.map((v) => v / dl);
        if (c.members.concat([[u, t]]).some(([mu, mt]) => angleDeg(mu, pu) > radiusDeg || angleDeg(mt, du) > maxTurnDeg)) continue;
        c.p = p; c.d = d; c.area += w; c.n += a.n; c.m = Math.min(c.m, a.m); c.members.push([u, t]);
        joined = true; break;
      }
      if (!joined) clusters.push({ p: u.map((v) => v * a.area), d: t.map((v) => v * a.area), area: a.area, n: a.n, m: a.m, members: [[u, t]] });
    }
    for (const c of clusters) out.push(summarise(c));
  }
  return out;
}

// Every arrow to draw for a journey, oldest first (so the newest draw on
// top), with its width (degrees, relative to the thickest shown), era colour
// and the time it appears. merge=false shows each recorded arrow on its own.
export function journeyArrows(journey, { merge = true } = {}) {
  if (!journey) return [];
  const list = eras(journey.endYear);
  const shown = merge ? mergeArrows(journey.arrows, list) : journey.arrows.map((a) => ({ ...a, members: 1 }));
  const aMax = shown.reduce((m, a) => Math.max(m, a.area), 1);
  return shown.map((a) => ({
    ...a,
    appears: a.m * ARROW_YEARS,
    width: WIDTH_MIN_DEG + (WIDTH_MAX_DEG - WIDTH_MIN_DEG) * Math.sqrt(a.area / aMax),
    rgb: list[eraIndex(list, a.m * ARROW_YEARS + ARROW_YEARS / 2)].rgb,
  })).sort((x, y) => x.m - y.m || x.area - y.area);
}
// the largest land area of any shown arrow (km2): the thickest arrow
export const maxShownArea = (arrows) => arrows.reduce((m, a) => Math.max(m, a.area), 0);
// how many of those (a prefix) are on screen at time t
export function shownCount(arrows, t) {
  let lo = 0, hi = arrows.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arrows[m].appears <= t) lo = m + 1; else hi = m; }
  return lo;
}
