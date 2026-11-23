// v13: 湖と市町村のデータを src/extra.js（window.SHIP_EXTRA）に作る。
// 入力（酷道 gusk2020/kudo-fudo-miseisen、branch claude/s43-overhaul の src/data/）：lakes.json（OSM, ODbL）, gazetteer2000.json（国土数値情報 N03 2000-10-01 の市町村の名称・代表点・面積）
// Usage: node tools/build_extra.mjs <lakes.json> <gazetteer2000.json>
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url), HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "..");
const [lakesF, gazF, townsF] = process.argv.slice(2); if (!gazF) { console.error("usage: node tools/build_extra.mjs <lakes.json> <gazetteer2000.json>"); process.exit(1); }
require("../src/terrain.js"); const C = require("../src/core.js"), geo = require("../data/ship-geo.json"); const model = C.buildModel(geo);
const lakesRaw = JSON.parse(fs.readFileSync(lakesF, "utf8")), gaz = JSON.parse(fs.readFileSync(gazF, "utf8"));
const prefByName = new Map(model.prefectures.map((p) => [p.name, p.id]));
const islandOf = (lon, lat) => { const [x, y] = model.toKm(lon, lat); let hit = model.islands.filter((s) => C.pointInRing(x, y, s.ring)).sort((a, b) => b.areaKm2 - a.areaKm2); if (hit.length) return hit[hit.length - 1].id; let best = null, bd = Infinity; for (const s of model.islands) for (const q of s.ring) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = s.id; } } return bd < 30 ? best : null; };
// 簡略化（Douglas-Peucker, 度）
const dp = (p, t) => { if (p.length < 3) return p; const a = p[0], b = p[p.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9; let best = -1, bi = 0; for (let i = 1; i < p.length - 1; i++) { const d = Math.abs((p[i][0] - a[0]) * dy - (p[i][1] - a[1]) * dx) / L; if (d > best) { best = d; bi = i; } } return best <= t ? [a, b] : dp(p.slice(0, bi + 1), t).slice(0, -1).concat(dp(p.slice(bi), t)); };
const lakes = [];
for (const l of lakesRaw.lakes) {
  if (l.kind === "island") continue;
  const ring = l.outer.map(([x, y]) => [x / 1e4, y / 1e4]), s = ring.length > 12 ? dp(ring.slice(0, -1), 0.0015).concat([ring[0]]) : ring;
  const cx = s.reduce((a, q) => a + q[0], 0) / s.length, cy = s.reduce((a, q) => a + q[1], 0) / s.length;
  lakes.push({ name: l.name, kind: l.kind, km2: l.km2, ring: s.map((q) => [+q[0].toFixed(4), +q[1].toFixed(4)]), island: islandOf(cx, cy) });
}
// 区は所属する市に合算（面積合計・面積加重の代表点）。町・村・市はそのまま。
const items = gaz.items.map(([code, pref, name, county, sub, lon, lat, area]) => ({ code, pref, name, county, lon, lat, area })), merged = [];
const cityAgg = new Map(), SAITAMA = new Set(["浦和市", "大宮市", "与野市"]);
for (const r of items) {
  if (SAITAMA.has(r.name)) { const key = "埼玉県/さいたま市"; const a = cityAgg.get(key) || { code: "11100", pref: "埼玉県", name: "さいたま市", lon: 0, lat: 0, area: 0 }; a.lon += r.lon * r.area; a.lat += r.lat * r.area; a.area += r.area; cityAgg.set(key, a); }
  else if (r.name.endsWith("区")) { if (!r.county) r.county = r.pref === "東京都" ? "東京特別区部" : r.name; const key = r.pref + "/" + r.county; const a = cityAgg.get(key) || { code: r.code.slice(0, 3) + "00", pref: r.pref, name: r.county, lon: 0, lat: 0, area: 0 }; a.lon += r.lon * r.area; a.lat += r.lat * r.area; a.area += r.area; cityAgg.set(key, a); }
  else if (/[市町村]$/.test(r.name)) merged.push(r);
}
for (const a of cityAgg.values()) merged.push({ ...a, lon: a.lon / a.area, lat: a.lat / a.area, area: +a.area.toFixed(1) });
// 沖縄県は酷道の2000年データに無い。酷道の towns.json（実在の町の名称と概略位置・概算人口）に沖縄があれば使い、無ければ県庁（那覇市）だけを入れる。
const okiTowns = townsF ? JSON.parse(fs.readFileSync(townsF, "utf8")).towns.filter((t) => t.island === "okinawa") : [];
if (!merged.some((r) => r.pref === "沖縄県")) { for (const t of okiTowns) merged.push({ code: t.id, pref: "沖縄県", name: t.name, lon: t.lon, lat: t.lat, area: 50 }); if (!okiTowns.some((t) => t.name === "那覇市")) merged.push({ code: "47201", pref: "沖縄県", name: "那覇市", lon: 127.6809, lat: 26.2124, area: 39.2 }); }
const munis = [];
for (const r of merged) { const pid = prefByName.get(r.pref); if (!pid) continue; const isl = islandOf(r.lon, r.lat); munis.push({ c: r.code, p: pid, n: r.name, k: (r.name.endsWith("市") || r.name.endsWith("特別区部")) ? "city" : r.name.endsWith("町") ? "town" : "village", g: [+r.lon.toFixed(4), +r.lat.toFixed(4)], a: +(+r.area).toFixed(1), i: isl }); }
// 人口の手掛かり（暫定）：酷道 towns.json の概算人口 + Natural Earth の都市人口（大都市圏の値は過大なので上限4M）。東京特別区部は850万人を手入力の概算とする。
const popHints = {}; const NEc = geo.cities.filter((c) => c.pop);
for (const c of NEc) popHints[c.name] = Math.min(c.pop, 4000000);
if (townsF) for (const t of JSON.parse(fs.readFileSync(townsF, "utf8")).towns) popHints[t.name] = t.pop;
popHints["東京特別区部"] = 8500000;
const out = { version: 1, popHints, builtAt: new Date().toISOString().slice(0, 10), lakes, munis,
  sources: [{ name: "OpenStreetMap contributors（酷道 lakes.json 経由）", license: "ODbL 1.0（出典表示）", use: "湖の輪郭" }, { name: "国土数値情報 行政区域データ N03 v2.2（2000-10-01、国土交通省。酷道 gazetteer2000.json 経由）", license: "公共データ利用規約(PDL1.0)", use: "市町村の名称・代表点・面積（区は所属市に合算）" }] };
fs.writeFileSync(path.join(ROOT, "src/extra.js"), "// Generated by tools/build_extra.mjs — do not edit by hand.\nwindow.SHIP_EXTRA=" + JSON.stringify(out) + ";\n");
const noIsl = munis.filter((m) => !m.i).length; console.log(`lakes ${lakes.length} (noIsland ${lakes.filter((l) => !l.island).length}), munis ${munis.length} (noIsland ${noIsl}), size ${(fs.statSync(path.join(ROOT, "src/extra.js")).size / 1024) | 0}KB`);
console.log(Object.entries(munis.reduce((m, x) => ((m[x.k] = (m[x.k] || 0) + 1), m), {})), model.byId.get("honshu") ? "" : "");
