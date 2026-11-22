// Builds ship-designer/data/ship-geo.json, src/data.js and src/dem.js (v11).
// Usage: node tools/build_data.mjs <ne_10m_admin_0_countries.geojson> <ne_10m_populated_places_simple.geojson> <kudo japan.json> <kudo japan-dem.bin>
// Sources (see docs/DATA.md):
//   Natural Earth 1:10m admin_0 countries, JAPAN-perspective file (ne_10m_admin_0_countries_jpn, public domain) — coastlines of every island,
//   including 北方領土4島 and 竹島. (Which country a polygon belongs to is NOT decided here; see docs/DATA.md.)
//   kudo-fudo-miseisen src/data/japan.json — the 49 prefecture definitions (ids, names, capitals, weights) and city list
//   kudo-fudo-miseisen public/japan-dem.bin — GEBCO_2026 crop used as slope cost for the prefecture borders
//   Natural Earth populated places (public domain) — real coordinates of capitals and cities
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const [neCountries, nePlaces, kudoJson, kudoDem] = process.argv.slice(2);
if (!kudoDem) { console.error("usage: node tools/build_data.mjs <countries> <places> <kudo japan.json> <kudo dem.bin>"); process.exit(1); }

// The v9 design ledger's plane. Kept bit-for-bit so saved centre coordinates keep their meaning.
const REF_LON = 135, REF_LAT = 35, KX = 111.32 * Math.cos(35 * Math.PI / 180), KY = 111.12;
const toKm = ([lon, lat]) => [(lon - REF_LON) * KX, (lat - REF_LAT) * KY];
const toGeo = ([x, y]) => [+(x / KX + REF_LON).toFixed(4), +(y / KY + REF_LAT).toFixed(4)];
const r4 = (v) => +v.toFixed(4);

function ringArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; }
function ringCentroid(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const f = p[j][0] * p[i][1] - p[i][0] * p[j][1]; a += f; cx += (p[j][0] + p[i][0]) * f; cy += (p[j][1] + p[i][1]) * f; }
  if (Math.abs(a) < 1e-12) return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  return [cx / (3 * a), cy / (3 * a)];
}
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
  let best = -1, bi = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L; if (d > best) { best = d; bi = i; } }
  if (best <= tol) return [a, b];
  return dp(pts.slice(0, bi + 1), tol).slice(0, -1).concat(dp(pts.slice(bi), tol));
}
function simplifyRing(r, tol) {
  if (r.length <= 10) return r;
  let m = 0, md = -1; for (let i = 0; i < r.length; i++) { const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > md) { md = d; m = i; } }
  const s = dp(r.slice(0, m + 1), tol).slice(0, -1).concat(dp(r.slice(m).concat([r[0]]), tol).slice(0, -1));
  return s.length >= 4 ? s : r;
}
function pointInRing(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

// ---------------------------------------------------------------- coastlines
const G = JSON.parse(fs.readFileSync(neCountries, "utf8"));
const jp = G.features.find((f) => f.properties.ADM0_A3 === "JPN").geometry;
const nePolys = (jp.type === "MultiPolygon" ? jp.coordinates : [jp.coordinates]).map((pl) => pl[0]);

// Island names (approximate centres; used only to attach a name to the nearest Natural Earth polygon).
const NAMES = [
  ["本州", 137.15, 36.35, "honshu"], ["北海道", 142.6, 43.17, "hokkaido"], ["九州", 130.61, 32.71, "kyushu"], ["四国", 133.33, 33.58, "shikoku"], ["沖縄本島", 127.98, 26.52, "okinawa"],
  ["佐渡島", 138.38, 38.04], ["奄美大島", 129.45, 28.33], ["淡路島", 134.86, 34.39], ["天草下島", 130.06, 32.36], ["屋久島", 130.51, 30.35], ["対馬（上島）", 129.37, 34.49], ["種子島", 130.97, 30.57],
  ["福江島", 128.73, 32.68], ["対馬（下島）", 129.26, 34.22], ["島後", 133.31, 36.24], ["西表島", 123.78, 24.35], ["徳之島", 128.95, 27.78], ["利尻島", 141.23, 45.17], ["天草上島", 130.33, 32.46],
  ["石垣島", 124.2, 24.46], ["中通島", 129.08, 32.98], ["平戸島", 129.46, 33.28], ["小豆島", 134.28, 34.49], ["奥尻島", 139.47, 42.16], ["周防大島", 132.33, 33.89], ["壱岐島", 129.72, 33.78],
  ["宮古島", 125.33, 24.8], ["礼文島", 141.02, 45.4], ["伊豆大島", 139.42, 34.74], ["上甑島", 129.74, 31.71], ["八丈島", 139.81, 33.1], ["沖永良部島", 128.61, 27.4], ["加計呂麻島", 129.27, 28.12],
  ["倉橋島", 132.53, 34.13], ["大三島", 133.0, 34.24], ["長島", 130.15, 32.17], ["久米島", 126.77, 26.34], ["島前（西ノ島ほか）", 133.03, 36.08], ["能登島", 136.98, 37.14], ["三宅島", 139.53, 34.07],
  ["喜界島", 130.0, 28.33], ["下甑島", 129.88, 31.85], ["大崎上島", 133.05, 34.16], ["若松島", 128.87, 32.81], ["口永良部島", 130.2, 30.46], ["伯方島", 132.89, 34.24], ["国後島付近（根室）", 145.31, 43.56],
  ["中之島", 129.88, 29.86], ["奈留島", 129.0, 32.89], ["大矢野島", 130.43, 32.59], ["伊良部島", 125.18, 24.83], ["父島", 142.21, 27.08], ["兄島", 142.19, 27.12], ["弟島", 142.17, 27.165], ["母島", 142.16, 26.67], ["西表島（再）", 123.78, 24.35],
  ["硫黄島", 141.33, 24.77], ["北大東島", 131.3, 25.95], ["南大東島", 131.25, 25.85], ["与那国島", 122.98, 24.46], ["新島", 139.27, 34.37], ["宇久島", 129.11, 33.27], ["倉橋島", 132.53, 34.13],
  ["沖縄・伊江島", 127.79, 26.72], ["伊平屋島", 127.97, 27.06], ["与論島", 128.42, 27.04], ["渡嘉敷島", 127.36, 26.19], ["粟国島", 127.23, 26.59], ["多良間島", 124.7, 24.66], ["鳥島（伊豆諸島）", 140.31, 30.48],
  ["南鳥島", 153.97, 24.29], ["南硫黄島", 141.46, 24.22], ["北硫黄島", 141.29, 25.43], ["青ヶ島", 139.76, 32.45], ["聟島", 142.14, 27.72], ["西之島", 140.87, 27.24], ["媒島", 142.19, 27.61], ["須美寿島", 140.04, 31.44],
  ["御蔵島", 139.6, 33.88], ["神津島", 139.14, 34.21], ["諏訪之瀬島", 129.73, 29.64], ["悪石島", 129.6, 29.46], ["魚釣島", 123.53, 25.77], ["宝島", 129.2, 29.14], ["小宝島", 129.33, 29.22], ["口之島", 129.93, 29.96],
  ["渡島大島", 139.36, 41.51], ["択捉島", 147.75, 45.03], ["国後島", 145.94, 44.13], ["色丹島", 146.78, 43.79], ["志発島（歯舞群島）", 146.16, 43.51], ["竹島", 131.86, 37.24], ["焼尻・天売", 141.3, 44.4], ["隠岐・島後", 133.31, 36.24],
];
const islands = [];
const usedNames = new Set();
for (const ring of nePolys) {
  const km = ring.slice(0, -1).map(toKm);
  if (ringArea(km) < 0) km.reverse();
  const area = ringArea(km);
  const c = ringCentroid(km), [clon, clat] = toGeo(c);
  let best = null, bd = Infinity;
  for (const n of NAMES) { if (usedNames.has(n[0])) continue; const d = Math.hypot((n[1] - clon) * Math.cos(clat * Math.PI / 180), n[2] - clat); if (d < bd) { bd = d; best = n; } }
  let name = null, id = null;
  if (best && bd < (area > 5000 ? 1.0 : 0.09) && !islands.some((t) => t.name === best[0])) { name = best[0]; id = best[3] || null; usedNames.add(best[0]); }
  const simp = simplifyRing(km, area > 1000 ? 0.35 : 0.15);
  islands.push({ id: id || `ne${Math.round(clon * 100)}_${Math.round(clat * 100)}`, name, source: "naturalearth", areaKmReal: area, ring: simp, c });
}
// Catalog of small islands v9 drew schematically. Natural Earth covers most of them already; only the rest stay schematic.
const CATALOG = [["口永良部島",130.18,30.46],["口之島",129.93,29.96],["中之島",129.86,29.84],["諏訪之瀬島",129.62,29.63],["平島",129.52,29.68],["悪石島",129.59,29.46],["小宝島",129.33,29.22],["宝島",129.2,29.14],["横当島",128.97,28.79],["喜界島",130.0,28.32],["加計呂麻島",129.24,28.13],["請島",129.24,28.04],["与路島",129.16,28.04],["沖永良部島",128.56,27.36],["与論島",128.41,27.05],["伊平屋島",127.97,27.04],["伊是名島",127.94,26.93],["伊江島",127.79,26.72],["久米島",126.75,26.34],["渡名喜島",127.35,26.37],["粟国島",127.23,26.59],["座間味島",127.3,26.23],["渡嘉敷島",127.35,26.18],["北大東島",131.3,25.95],["南大東島",131.25,25.83],["多良間島",124.7,24.65],["伊良部島",125.17,24.82],["下地島",125.14,24.82],["池間島",125.28,24.93],["来間島",125.25,24.72],["石垣島",124.17,24.34],["西表島",123.84,24.34],["竹富島",124.09,24.33],["小浜島",123.98,24.34],["黒島",124.01,24.23],["波照間島",123.78,24.06],["与那国島",123.0,24.46],["鳩間島",123.82,24.47],["新城島",124.0,24.18],["水納島",124.68,24.75],["兄島",142.19,27.12],["弟島",142.17,27.15],["南島",142.16,27.04],["向島",142.23,27.04],["姉島",142.16,26.59],["妹島",142.19,26.55],["嫁島",142.15,27.59],["聟島北小島",142.16,27.73],["媒島",142.22,27.62],["孀婦岩",140.34,29.8],["東島",142.25,27.11],["伊豆大島",139.36,34.75],["利島",139.28,34.52],["新島",139.26,34.37],["式根島",139.22,34.32],["神津島",139.15,34.21],["三宅島",139.53,34.08],["御蔵島",139.6,33.87],["八丈島",139.79,33.11],["八丈小島",139.69,33.12],["青ヶ島",139.77,32.46],["ベヨネース列岩",139.92,31.89],["須美寿島",140.05,31.45],["鳥島（伊豆諸島）",140.3,30.48]];
for (const [name, lon, lat] of CATALOG) {
  if (islands.some((s) => s.name === name)) continue;
  const [x, y] = toKm([lon, lat]);
  // Already present as a real polygon (inside it, or a real polygon centred within ~4 km)?
  const covered = islands.some((s) => pointInRing(x, y, s.ring) || Math.hypot(s.c[0] - x, s.c[1] - y) < 4);
  const named = islands.find((s) => !s.name && (pointInRing(x, y, s.ring) || Math.hypot(s.c[0] - x, s.c[1] - y) < 4));
  if (named) { named.name = name; continue; }
  if (covered) continue;
  // A small schematic islet (km, source scale), flagged as such. The catalog's coordinates are approximate, so an islet
  // that would sit on a real coastline is shrunk until it does not, or dropped: it must never create a fake overlap.
  let ring = null;
  for (let rad = 0.35; rad >= 0.08 && !ring; rad /= 2) {
    const r = []; for (let k = 0; k < 10; k++) { const a = (k * 2 * Math.PI) / 10; r.push([x + rad * Math.cos(a), y + rad * 0.8 * Math.sin(a)]); }
    const clash = islands.some((s) => r.some((q) => pointInRing(q[0], q[1], s.ring)) || s.ring.some((q) => pointInRing(q[0], q[1], r)));
    if (!clash) ring = r;
  }
  if (!ring) continue;
  islands.push({ id: `sc${Math.round(lon * 100)}_${Math.round(lat * 100)}`, name, source: "schematic", areaKmReal: ringArea(ring), ring, c: [x, y] });
}
// 沖ノ鳥島: not in Natural Earth at this scale. Real dry land is a few square metres; drawn as a tiny schematic reef.
{
  const [x, y] = toKm([136.08, 20.42]); const ring = []; for (let k = 0; k < 10; k++) { const a = (k * 2 * Math.PI) / 10; ring.push([x + 0.5 * Math.cos(a), y + 0.35 * Math.sin(a)]); }
  islands.push({ id: "okinotori", name: "沖ノ鳥島", source: "schematic", areaKmReal: ringArea(ring), ring, c: [x, y] });
}
// 歯舞群島: Natural Earth (10m) carries only one polygon (志発島). The other members are added as separate schematic islets
// at approximate positions (flagged position:"approximate") so the group is never collapsed into a single island.
for (const [name, lon, lat] of [["水晶島（歯舞群島）", 146.0, 43.43], ["勇留島（歯舞群島）", 146.09, 43.46], ["秋勇留島（歯舞群島）", 146.13, 43.45], ["多楽島（歯舞群島）", 146.35, 43.55]]) {
  const [x, y] = toKm([lon, lat]); let ring = null;
  for (let rad = 0.9; rad >= 0.15 && !ring; rad /= 1.6) { const r = []; for (let k = 0; k < 10; k++) { const a = (k * 2 * Math.PI) / 10; r.push([x + rad * Math.cos(a), y + rad * 0.8 * Math.sin(a)]); } if (!islands.some((t) => r.some((q) => pointInRing(q[0], q[1], t.ring)) || t.ring.some((q) => pointInRing(q[0], q[1], r)))) ring = r; }
  if (ring) islands.push({ id: "habomai_" + Math.round(lon * 100), name, source: "schematic", position: "approximate", areaKmReal: ringArea(ring), ring, c: [x, y] });
}
{ const seen = new Map(); for (const s of islands) { const n = seen.get(s.id) || 0; seen.set(s.id, n + 1); if (n) s.id += "_" + (n + 1); } }
const mt = islands.find((s) => s.name === "南鳥島"); if (mt) mt.id = "minamitori";
const iwo = islands.find((s) => s.name === "硫黄島"); if (iwo) iwo.id = "iwo";
for (const [nm, id] of [["伊豆大島", "izuoshima"], ["屋久島", "yakushima"], ["南硫黄島", "minamiiwo"], ["択捉島", "etorofu"], ["国後島", "kunashiri"], ["色丹島", "shikotan"], ["志発島（歯舞群島）", "shibotsu"], ["竹島", "takeshima"]]) { const t = islands.find((q) => q.name === nm); if (t) t.id = id; else throw new Error("missing island " + nm); }

// Groups decide which adjustments an island takes. Pure coordinate rules — no per-island hand placement.
for (const s of islands) {
  const [lon, lat] = toGeo(s.c);
  if (s.id === "okinotori" || s.id === "minamitori" || lon > 150) s.group = "bird"; // 南鳥島は Natural Earth で2ポリゴン（lon>150 はどちらも鳥島群）
  else if (lon >= 139.9 && lat < 30.0) s.group = "oga";
  else if (lon > 138.9 && lon < 140.5 && lat >= 30.0 && lat < 34.9) s.group = "izu";
  else if (lat < 31.0 && lon < 132) s.group = "ryu";
  else if (lon > 129.1 && lon < 129.6 && lat > 34.0 && lat < 34.8) s.group = "tsushima";
  else if (lon > 145.8 && lon < 149.5 && lat > 43.0 && lat < 46.0) s.group = "north";
  else if (lon > 131.5 && lon < 132.2 && lat > 37.0 && lat < 37.5) s.group = "take";
  else s.group = "main";
}

// Display / rotation regions (separate from the legacy `group`, which only drives the v9/v10 spacing rules).
for (const s of islands) {
  s.region = { ryu: "ryukyu", oga: "ogasawara", izu: "izu", bird: s.id === "okinotori" ? "okinotori" : "minamitori", north: "northern", take: "takeshima" }[s.group] || "main";
  if (!s.name && s.region === "minamitori") s.name = "南鳥島（付属ポリゴン）"; // Natural Earth は南鳥島を2ポリゴンで収録
  if (s.name === "孀婦岩") s.region = "izu"; // 孀婦岩 is part of the Izu chain (Tokyo), though its longitude puts it in the legacy "oga" spacing group
}
// ---------------------------------------------------------------- prefectures (kudo-fudo-miseisen definitions)
const K = JSON.parse(fs.readFileSync(kudoJson, "utf8"));
const kudoToGeo = (p) => [p[0] / K.proj.kmPerDegLon + K.proj.lon0, p[1] / K.proj.kmPerDegLat + K.proj.lat0];
const P = JSON.parse(fs.readFileSync(nePlaces, "utf8")).features.map((f) => f.properties).filter((p) => p.adm0_a3 === "JPN");
const placeByAscii = new Map(P.map((p) => [p.nameascii, p]));
// Capitals Natural Earth does not carry: widely published city-hall coordinates, typed in by hand.
const MANUAL = { "さいたま市": [139.6455, 35.8617], "千葉市": [140.1063, 35.6073], "佐賀市": [130.2988, 33.2494], "山口市": [131.4714, 34.1859], "奈良市": [135.8048, 34.6851], "根室市": [145.5828, 43.3306], "札幌市": [141.3545, 43.0621], "函館市": [140.7288, 41.7688], "那覇市": [127.6809, 26.2124] };
const CAPITAL_ASCII = { "青森市":"Aomori","盛岡市":"Morioka","仙台市":"Sendai","秋田市":"Akita","山形市":"Yamagata","福島市":"Fukushima","水戸市":"Mito","宇都宮市":"Utsunomiya","前橋市":"Maebashi","東京":"Tokyo","横浜市":"Yokohama","新潟市":"Niigata","富山市":"Toyama","金沢市":"Kanazawa","福井市":"Fukui","甲府市":"Kofu","長野市":"Nagano","岐阜市":"Gifu","静岡市":"Shizuoka","名古屋市":"Nagoya","津市":"Tsu","大津市":"Otsu","京都市":"Kyoto","大阪市":"Osaka","神戸市":"Kobe","和歌山市":"Wakayama","鳥取市":"Tottori","松江市":"Matsue","岡山市":"Okayama","広島市":"Hiroshima","徳島市":"Tokushima","高松市":"Takamatsu","松山市":"Matsuyama","高知市":"Kochi","福岡市":"Fukuoka","長崎市":"Nagasaki","熊本市":"Kumamoto","大分市":"Oita","宮崎市":"Miyazaki","鹿児島市":"Kagoshima" };
const capitalGeo = (name, fallback) => {
  if (MANUAL[name]) return { geo: MANUAL[name], how: "manual" };
  const a = CAPITAL_ASCII[name], p = a && placeByAscii.get(a);
  if (p) return { geo: [p.longitude, p.latitude], how: "naturalearth" };
  return { geo: fallback, how: "kudo" };
};
const legacyPrefectures = K.prefectures.map((p) => ({ id: p.id, name: p.name, capital: p.capital, island: p.island, weight: p.weight, capitalGeo: capitalGeo(p.capital, kudoToGeo(p.seed)).geo.map(r4) }));
const HK_LEGACY = ["HK-SAP", "HK-HAK", "HK-NEM"];
// 変換規則 (docs/PREFECTURE_CONVERSION.md): 酷道の49府県 → 船内の47都道府県。元の49件は legacyPrefectures にそのまま残す。
const prefectures = [];
for (const p of K.prefectures) {
  if (HK_LEGACY.includes(p.id)) continue;
  const cap = capitalGeo(p.capital, kudoToGeo(p.seed));
  prefectures.push({ id: p.id, name: p.id === "JP-13" ? "東京都" : p.name, legacyName: p.id === "JP-13" ? p.name : undefined, capital: p.capital, island: p.island, weight: p.weight, capitalGeo: cap.geo.map(r4), capitalSource: cap.how });
}
const hkW = K.prefectures.filter((p) => HK_LEGACY.includes(p.id)).reduce((a, p) => a + p.weight, 0);
prefectures.push({ id: "JP-01", name: "北海道", capital: "札幌市", island: "hokkaido", weight: hkW, capitalGeo: MANUAL["札幌市"].map(r4), capitalSource: "manual", mergedFrom: HK_LEGACY });
const meanW = legacyPrefectures.reduce((a, p) => a + p.weight, 0) / legacyPrefectures.length; // 49件基準の平均を維持 → 他県の境界は v10 と同一

// Weighted Dijkstra over a 2.5 km grid — kudo-fudo-miseisen's algorithm (src/core/terrain.ts), reduced to what
// exists on an undeformed map: slope cost from GEBCO and the per-prefecture weight. No rivers or user ridges.
const demBuf = fs.readFileSync(kudoDem); const dem = new Int16Array(demBuf.buffer.slice(demBuf.byteOffset, demBuf.byteOffset + demBuf.byteLength));
fs.writeFileSync(path.join(ROOT, "src/dem.js"), "// Generated by tools/build_data.mjs — GEBCO_2026 crop (kudo-fudo-miseisen japan-dem.bin), Int16 metres, row-major, base64.\nwindow.SHIP_DEM = " + JSON.stringify({ ...K.dem, b64: demBuf.toString("base64") }) + ";\n");
const D = K.dem;
function demAt(lon, lat) {
  const fx = (lon - D.lon0) / D.dLon, fy = (D.lat0 - lat) / D.dLat;
  const x0 = Math.max(0, Math.min(D.w - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(D.h - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0)), g = (x, y) => dem[y * D.w + x];
  return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
}
const MAIN = ["honshu", "hokkaido", "kyushu", "shikoku", "okinawa"];
const mainIsl = MAIN.map((id) => islands.find((s) => s.id === id));
const CELL = 2.5;
let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
for (const s of mainIsl) for (const q of s.ring) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); by0 = Math.min(by0, q[1]); by1 = Math.max(by1, q[1]); }
bx0 -= CELL; by0 -= CELL;
const nx = Math.ceil((bx1 - bx0) / CELL) + 2, ny = Math.ceil((by1 - by0) / CELL) + 2, N = nx * ny;
const isl = new Uint8Array(N);
const cxOf = (i) => bx0 + (i + 0.5) * CELL, cyOf = (j) => by0 + (j + 0.5) * CELL;
mainIsl.forEach((s, n) => {
  let ymin = Infinity, ymax = -Infinity; for (const q of s.ring) { ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]); }
  for (let j = Math.max(0, Math.floor((ymin - by0) / CELL)); j < Math.min(ny, Math.ceil((ymax - by0) / CELL) + 1); j++) {
    const y = cyOf(j), xs = [];
    for (let k = 0, m = s.ring.length; k < m; k++) { const a = s.ring[k], b = s.ring[(k + 1) % m]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil((xs[k] - bx0) / CELL - 0.5)); i <= Math.min(nx - 1, Math.floor((xs[k + 1] - bx0) / CELL - 0.5)); i++) isl[j * nx + i] = n + 1;
  }
});
const elev = new Float32Array(N);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (isl[j * nx + i]) { const [lon, lat] = toGeo([cxOf(i), cyOf(j)]); elev[j * nx + i] = Math.max(0, demAt(lon, lat)); }
const cost = new Float32Array(N);
for (let k = 0; k < N; k++) if (isl[k]) {
  const i = k % nx, j = (k / nx) | 0;
  const ex = (elev[j * nx + Math.min(nx - 1, i + 1)] - elev[j * nx + Math.max(0, i - 1)]) / (2 * CELL * 1000);
  const ey = (elev[Math.min(ny - 1, j + 1) * nx + i] - elev[Math.max(0, j - 1) * nx + i]) / (2 * CELL * 1000);
  cost[k] = 1 + 25 * Math.hypot(ex, ey);
}
const pref = new Uint8Array(N), dist = new Float64Array(N).fill(Infinity);
const mult = prefectures.map((p) => Math.pow(meanW / p.weight, 0.7));
// binary heap
const hk = [], hv = [];
const push = (k, v) => { hk.push(k); hv.push(v); let i = hk.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } };
const pop = () => { const k = hk[0], v = hv[0], lk = hk.pop(), lv = hv.pop(); if (hk.length) { hk[0] = lk; hv[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hk.length && hk[l] < hk[m]) m = l; if (r < hk.length && hk[r] < hk[m]) m = r; if (m === i) break; [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } } return [k, v]; };
prefectures.forEach((p, n) => {
  const want = MAIN.indexOf(p.island) + 1; const [x, y] = toKm(p.capitalGeo);
  let best = -1, bd = Infinity;
  for (let k = 0; k < N; k++) if (isl[k] === want) { const d = Math.hypot(cxOf(k % nx) - x, cyOf((k / nx) | 0) - y); if (d < bd) { bd = d; best = k; } }
  if (best < 0) throw new Error("no land for " + p.name);
  if (pref[best]) throw new Error("seed collision " + p.name);
  pref[best] = n + 1; dist[best] = 0; push(0, best);
});
const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]];
while (hk.length) {
  const [d, c] = pop(); if (d > dist[c]) continue;
  const lab = pref[c], i = c % nx, j = (c / nx) | 0;
  for (const [di, dj, w] of N8) {
    const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
    const n = b * nx + a; if (isl[n] !== isl[c]) continue;
    const nd = d + w * cost[n] * mult[lab - 1];
    if (nd < dist[n]) { dist[n] = nd; pref[n] = lab; push(nd, n); }
  }
}
// Cells cut off from every capital by a 1-cell-wide neck (a raster artefact) take the nearest prefecture on the same island.
for (let k = 0; k < N; k++) if (isl[k] && !pref[k]) {
  let best = 0, bd = Infinity;
  for (let n = 0; n < N; n++) if (isl[n] === isl[k] && pref[n] && dist[n] < Infinity) { const d = Math.hypot((n % nx) - (k % nx), ((n / nx) | 0) - ((k / nx) | 0)); if (d < bd) { bd = d; best = pref[n]; } }
  pref[k] = best;
}
const cells = new Int32Array(prefectures.length + 1);
for (let k = 0; k < N; k++) if (isl[k]) cells[pref[k]]++;
if (cells[0]) throw new Error(cells[0] + " land cells without a prefecture");
// Border edges between grid cells of different prefectures, chained into polylines.
const edges = new Map(); // vertex key -> list of neighbour keys
const vkey = (i, j) => j * (nx + 1) + i;
const addEdge = (a, b) => { (edges.get(a) || edges.set(a, []).get(a)).push(b); (edges.get(b) || edges.set(b, []).get(b)).push(a); };
const edgeIsland = new Map();
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const k = j * nx + i; if (!isl[k]) continue;
  if (i + 1 < nx && isl[k + 1] === isl[k] && pref[k] !== pref[k + 1]) { addEdge(vkey(i + 1, j), vkey(i + 1, j + 1)); edgeIsland.set(vkey(i + 1, j) + ":" + vkey(i + 1, j + 1), isl[k]); }
  if (j + 1 < ny && isl[k + nx] === isl[k] && pref[k] !== pref[k + nx]) { addEdge(vkey(i, j + 1), vkey(i + 1, j + 1)); edgeIsland.set(vkey(i, j + 1) + ":" + vkey(i + 1, j + 1), isl[k]); }
}
const vxy = (v) => [bx0 + (v % (nx + 1)) * CELL, by0 + Math.floor(v / (nx + 1)) * CELL];
const usedE = new Set(), ek = (a, b) => (a < b ? a + "," + b : b + "," + a);
const chains = [];
const walk = (start, next) => {
  const pts = [start, next]; usedE.add(ek(start, next)); let prev = start, cur = next;
  while (edges.get(cur).length === 2) {
    const nb = edges.get(cur).find((v) => v !== prev && !usedE.has(ek(cur, v)));
    if (nb === undefined) break;
    usedE.add(ek(cur, nb)); pts.push(nb); prev = cur; cur = nb;
  }
  return pts;
};
for (const [v, nbs] of edges) if (nbs.length !== 2) for (const n of nbs) if (!usedE.has(ek(v, n))) chains.push(walk(v, n));
for (const [v, nbs] of edges) for (const n of nbs) if (!usedE.has(ek(v, n))) chains.push(walk(v, n));
const islandOfVertexChain = (c) => { for (let t = 0; t + 1 < c.length; t++) { const a = Math.min(c[t], c[t + 1]), b = Math.max(c[t], c[t + 1]); const m = edgeIsland.get(a + ":" + b); if (m) return MAIN[m - 1]; } return "honshu"; };
const borders = chains.map((c) => ({ island: islandOfVertexChain(c), line: dp(c.map(vxy), 1.2).map(toGeo) }));

// Small islands join the prefecture of the nearest main-island land cell, with real-world overrides where nearest is wrong.
function nearestPref(x, y) { let best = 0, bd = Infinity; for (let k = 0; k < N; k++) if (isl[k]) { const d = Math.hypot(cxOf(k % nx) - x, cyOf((k / nx) | 0) - y); if (d < bd) { bd = d; best = pref[k]; } } return prefectures[best - 1].id; }
for (const s of islands) {
  const mi = MAIN.indexOf(s.id);
  if (mi >= 0) { s.pref = null; continue; } // split between several prefectures, see raster
  const [lon, lat] = toGeo(s.c);
  if (s.group === "izu" || s.group === "oga" || s.group === "bird") s.pref = "JP-13";
  else if (s.group === "north") s.pref = "JP-01";
  else if (s.group === "take") s.pref = "JP-32";
  else if (s.group === "ryu") s.pref = (lat > 26.95 && lon > 128.3) || lat > 28.0 ? "JP-46" : "JP-47";
  else if (s.group === "tsushima" || (lon < 130.0 && lat > 32.5 && lat < 34.0 && (s.name || "").match(/壱岐|福江|中通|奈留|若松|宇久/))) s.pref = "JP-42";
  else if (s.name === "淡路島") s.pref = "JP-28";
  else s.pref = nearestPref(s.c[0], s.c[1]);
}
// Per-prefecture label point and area (real km² on the v9 plane; ship km² = /denominator²).
const sumX = new Float64Array(prefectures.length + 1), sumY = new Float64Array(prefectures.length + 1);
for (let k = 0; k < N; k++) if (isl[k]) { sumX[pref[k]] += cxOf(k % nx); sumY[pref[k]] += cyOf((k / nx) | 0); }
prefectures.forEach((p, n) => {
  const mx = sumX[n + 1] / cells[n + 1], my = sumY[n + 1] / cells[n + 1];
  let best = -1, bd = Infinity; for (let k = 0; k < N; k++) if (pref[k] === n + 1) { const d = Math.hypot(cxOf(k % nx) - mx, cyOf((k / nx) | 0) - my); if (d < bd) { bd = d; best = k; } }
  p.labelGeo = toGeo([cxOf(best % nx), cyOf((best / nx) | 0)]);
  p.mainLandAreaKm2 = Math.round(cells[n + 1] * CELL * CELL);
  p.islandAreaKm2 = Math.round(islands.filter((s) => s.pref === p.id).reduce((a, s) => a + s.areaKmReal, 0));
  p.areaKm2 = p.mainLandAreaKm2 + p.islandAreaKm2;
  p.culture = null; // 受け皿のみ。文化・県民性は次の企画工程で決める。
});

// ---------------------------------------------------------------- cities
const CITY_JA = { Kawasaki: "川崎市", Kawagoe: "川越市", Hachioji: "八王子市", Kitakyushu: "北九州市", Hamamatsu: "浜松市", Iwaki: "いわき市", Asahikawa: "旭川市", Koriyama: "郡山市", Shimonoseki: "下関市", Hachinohe: "八戸市", Sasebo: "佐世保市", Matsumoto: "松本市", Kushiro: "釧路市", Kure: "呉市", Nagaoka: "長岡市", Hirosaki: "弘前市", Tomakomai: "苫小牧市", Obihiro: "帯広市", Takaoka: "高岡市", Muroran: "室蘭市", Otaru: "小樽市", Kitami: "北見市" };
const cities = [];
for (const p of prefectures) cities.push({ id: "city.cap." + p.id, name: p.capital, kind: "capital", pref: p.id, geo: p.capitalGeo, source: p.capitalSource });
for (const lp of legacyPrefectures.filter((q) => HK_LEGACY.includes(q.id))) if (lp.capital !== "札幌市") cities.push({ id: "city.legacycap." + lp.id, name: lp.capital, kind: "city", pref: "JP-01", geo: lp.capitalGeo, source: "manual", legacyCapitalOf: lp.id });
for (const pl of P) {
  const ja = CITY_JA[pl.nameascii]; if (!ja) continue;
  cities.push({ id: "city.ne." + pl.ne_id, name: ja, kind: "city", pref: null, geo: [r4(pl.longitude), r4(pl.latitude)], source: "naturalearth", pop: pl.pop_max });
}
// Attach each city to the island polygon it stands on (nearest if it sits on a simplified coastline).
for (const c of cities) {
  const [x, y] = toKm(c.geo);
  let s = islands.find((t) => pointInRing(x, y, t.ring));
  if (!s) { let bd = Infinity; for (const t of islands) for (const q of t.ring) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; s = t; } } }
  c.island = s.id;
  if (!c.pref) {
    const i = Math.floor((x - bx0) / CELL), j = Math.floor((y - by0) / CELL), k = j * nx + i;
    c.pref = i >= 0 && j >= 0 && i < nx && j < ny && pref[k] ? prefectures[pref[k] - 1].id : s.pref || nearestPref(x, y);
  }
}

// ---------------------------------------------------------------- output (geographic coordinates; the app does every projection)
const out = {
  schema: "kasoku-ship-geo", version: 1, builtAt: new Date().toISOString().slice(0, 10),
  plane: { refLon: REF_LON, refLat: REF_LAT, kmPerDegLon: KX, kmPerDegLat: KY, note: "v9 設計台帳と同一の正距円筒平面（中心座標の互換のため）" },
  sources: [
    { name: "Natural Earth 1:10m admin_0 countries (JPN)", license: "Public domain", url: "https://www.naturalearthdata.com/", use: "全島の海岸線" },
    { name: "Natural Earth 1:10m populated places", license: "Public domain", url: "https://www.naturalearthdata.com/", use: "都市・県庁所在地の座標" },
    { name: "Natural Earth 1:10m admin_0 countries, Japan-perspective (JPN)", license: "Public domain", url: "https://www.naturalearthdata.com/", use: "北方領土・竹島を含む島の輪郭（領有の判断を意味しない）" },
    { name: "kudo-fudo-miseisen src/data/japan.json (commit 69221ca)", license: "利用者自身のリポジトリ", url: "https://github.com/gusk2020/kudo-fudo-miseisen", use: "49府県の定義（ID・名称・県庁・重み）・都市リスト" },
    { name: "GEBCO_2026 (kudo-fudo-miseisen public/japan-dem.bin)", license: "GEBCO terms, attribution: GEBCO Compilation Group", url: "https://www.gebco.net/", use: "府県境生成の傾斜コスト" },
  ],
  islands: islands.map((s) => ({ id: s.id, name: s.name, group: s.group, region: s.region, source: s.source, position: s.position, pref: s.pref, ring: s.ring.map(toGeo) })),
  legacyPrefectures,
  conversion: ["酷道の49府県を元データとして legacyPrefectures に全件保持（削除・改変なし）", "北海道3県（札幌・函館・根室）を JP-01「北海道」1件に再統合。県庁は札幌市。重みは3県の合計。内部境界は生成しない（海岸線・都市・標高は無変更）", "函館市・根室市は県庁ではなく通常の都市として残す（legacyCapitalOf で元の県を記録）", "JP-13 の名称を「東京府」から「東京都」へ戻す（IDは JP-13 のまま、旧名は legacyName）", "他の45府県は酷道と同じ重み・同じ平均重み(49件基準)で境界を再生成。v10 と同一の境界になる", "北方領土4島は JP-01、竹島は JP-32 に行政区分上は紐付けるが、これは日本側の行政区分データであり、実世界の国際的立場を設定上の結論として確定するものではない"],
  prefectures,
  prefectureBorders: { method: "kudo-fudo-miseisen 方式の重み付き Dijkstra（2.5km格子、傾斜コストのみ、変形なし）", cellKm: CELL, lines: borders },
  cities,
};
fs.writeFileSync(path.join(ROOT, "data/ship-geo.json"), JSON.stringify(out));
fs.writeFileSync(path.join(ROOT, "src/data.js"), "// Generated by tools/build_data.mjs — do not edit by hand.\nwindow.SHIP_GEO=" + JSON.stringify(out) + ";\n");
const pts = out.islands.reduce((a, s) => a + s.ring.length, 0);
console.log(`islands ${out.islands.length} (schematic ${out.islands.filter((s) => s.source === "schematic").length}), points ${pts}, borders ${borders.length} (${borders.reduce((a, b) => a + b.line.length, 0)} pts), cities ${cities.length}, prefs ${prefectures.length}`);
console.log("groups", Object.entries(out.islands.reduce((m, s) => ((m[s.group] = (m[s.group] || 0) + 1), m), {})));
console.log("unnamed", out.islands.filter((s) => !s.name).length);
console.log(prefectures.map((p) => `${p.name}:${p.areaKm2}`).join(" "));
