// dT/dt過速世界 恒星間宇宙船 — 手続き型3Dモデル
// 単位: 1 = 1 km。船の長軸は X、船首は +X。
// SPEC の各値に「既定」(ユーザー設定)か「仮」(可視化のための仮設定)を明記する。
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const SPEC = {
  habitatInnerRadius: 3.5,   // 既定: 居住区内径 7.0 km
  habitatLength: 77.0,       // 既定: 居住区長 77.0 km
  axisRadius: 0.1,           // 既定: 非回転中心軸 直径約200 m
  hullOuterRadius: 3.8,      // 仮: 外殻の厚さを300 mと仮定
  shieldClosedRatio: 1.2,    // 既定: 巡航時シールド径 = 円筒径の120%
  shieldOpenRatio: 1.5,      // 既定: 装甲葉展開時 150%
  shieldDecelRatio: 6.0,     // 既定は5〜7倍。中間の6倍を仮に採用
  shieldLength: 14,          // 仮: 巡航時シールドの長さ
  sternLength: 16,           // 仮: 船尾推進区画の長さ
  gap: 0.8,                  // 仮: 回転部と非回転部の間の隙間
  neckRatio: 0.84,           // 仮: 接続部(構造帯の首)の径 = 外殻径の84%
  ribCount: 40,              // 仮: 縦〜斜めヒダの本数
  bigKnobs: 10,              // 既定: 最後端の最大級コブ 約10個
  activeKnobs: 5,            // 既定: 約半数に推進器
  thrustersPerKnob: 20,      // 既定「約100基」= 5個×20基
  holesPerKnob: 20,          // 建造中・解体中の推進器穴 = 各100個(5個×20)
};

// ---------- 乱数とノイズ(再現性のため固定シード) ----------
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  let r = 0;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
    const wgt = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    r += wgt * hash3(xi + dx, yi + dy, zi + dz);
  }
  return r;
}
function fbm(x, y, z) {
  return 0.55 * noise3(x, y, z) + 0.3 * noise3(x * 2.1, y * 2.1, z * 2.1) + 0.15 * noise3(x * 4.3, y * 4.3, z * 4.3);
}

// スケイル外装の色: 艶のない灰色〜灰緑、局所的にくすんだ褐色、薄い補修痕
const C_GREYGREEN = new THREE.Color(0x6c7468);
const C_GREY = new THREE.Color(0x77787a);
const C_BROWN = new THREE.Color(0x6b6052);
const C_REPAIR = new THREE.Color(0x9a9c94);
function scaleColor(p, out) {
  const n1 = fbm(p.x * 0.35, p.y * 0.35, p.z * 0.35);
  const n2 = fbm(p.x * 1.7 + 11, p.y * 1.7, p.z * 1.7);
  const n3 = noise3(p.x * 6 + 5, p.y * 6, p.z * 6);
  out.copy(C_GREYGREEN).lerp(C_GREY, THREE.MathUtils.clamp((n1 - 0.35) * 2.2, 0, 1));
  const brown = THREE.MathUtils.clamp((n2 - 0.62) * 4, 0, 1);
  out.lerp(C_BROWN, brown * 0.8);
  const repair = THREE.MathUtils.clamp((n3 - 0.8) * 6, 0, 1);
  out.lerp(C_REPAIR, repair * 0.55);
  const speck = (hash3(Math.floor(p.x * 40), Math.floor(p.y * 40), Math.floor(p.z * 40)) - 0.5) * 0.06;
  out.r += speck; out.g += speck; out.b += speck;
  return out;
}

// 位置以外の属性を捨て、索引なしにそろえてから結合する
function mergeAll(parts) {
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
    return n;
  });
  return mergeVertices(mergeGeometries(clean, false), 1e-4);
}
function finish(geo) {
  geo.computeVertexNormals();
  return geo;
}
function colorize(geo, fn = scaleColor) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    fn(p, c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
function solidColor(geo, hex) {
  const c = new THREE.Color(hex);
  return colorize(geo, (p, out) => {
    out.copy(c);
    const s = (hash3(Math.floor(p.x * 30), Math.floor(p.y * 30), Math.floor(p.z * 30)) - 0.5) * 0.05;
    out.r += s; out.g += s; out.b += s;
    return out;
  });
}

// 格子状の曲面 (u: 周方向, v: 長手方向) を作る
function gridSurface(nu, nv, fn, closedU = false) {
  const pos = [], idx = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      fn(i / nu, j / nv, p);
      pos.push(p.x, p.y, p.z);
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

// ---------- 円筒外郭 ----------

// ---------- 材質 ----------
// 側面(外殻・コブ): 灰緑のスケイル / シールド: やや白銀寄りのざらついた面
// 推進器: 漆黒の重金属 / 稼働中推進器の内部: 核融合パルスの発光
const C_SILVER = new THREE.Color(0xb3b7b4);
const C_SILVER_DARK = new THREE.Color(0x8e928f);
const C_SILVER_LIGHT = new THREE.Color(0xcfd1cc);
function silverColor(p, out) {
  const n1 = fbm(p.x * 0.5 + 3, p.y * 0.5, p.z * 0.5);
  const n2 = noise3(p.x * 5 + 7, p.y * 5, p.z * 5);
  out.copy(C_SILVER).lerp(C_SILVER_DARK, THREE.MathUtils.clamp((0.45 - n1) * 2.5, 0, 1));
  out.lerp(C_SILVER_LIGHT, THREE.MathUtils.clamp((n2 - 0.75) * 4, 0, 1) * 0.6);
  const speck = (hash3(Math.floor(p.x * 60), Math.floor(p.y * 60), Math.floor(p.z * 60)) - 0.5) * 0.12;
  out.r += speck; out.g += speck; out.b += speck;
  return out;
}
export function makeMaterials() {
  return {
    hull: new THREE.MeshStandardMaterial({ name: 'scale_hull', vertexColors: true, roughness: 0.95, metalness: 0.03, side: THREE.DoubleSide }),
    shield: new THREE.MeshStandardMaterial({ name: 'shield_silver_rough', vertexColors: true, roughness: 0.62, metalness: 0.35, side: THREE.DoubleSide }),
    thruster: new THREE.MeshStandardMaterial({ name: 'thruster_black_heavy_metal', color: 0x0a0a0c, roughness: 0.32, metalness: 0.9, side: THREE.DoubleSide }),
    glow: new THREE.MeshStandardMaterial({ name: 'fusion_glow', color: 0x000000, emissive: 0xbfe6ff, emissiveIntensity: 3.0, side: THREE.DoubleSide }),
    hole: new THREE.MeshStandardMaterial({ name: 'thruster_hole', color: 0x030303, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide }),
  };
}

// ---------- 円筒外郭 ----------
const L = SPEC.habitatLength, R = SPEC.hullOuterRadius;
const X_BOW_END = L / 2, X_STERN_END = -L / 2;
const NECK_R = R * SPEC.neckRatio;
// 軽いくびれと節(仮: 不規則な6か所)
const NODES = [-27.5, -14.2, -2.8, 9.6, 20.4, 31.1];
function twistAt(x) { return 0.012 * x + 0.18 * Math.sin(x * 0.075); }
function hullRadius(x, theta) {
  let r = R;
  for (const n of NODES) {
    const d = (x - n) / 0.9; r -= 0.16 * Math.exp(-d * d);
    const d2 = (x - n - 1.4) / 0.55; r += 0.06 * Math.exp(-d2 * d2);
  }
  const th = theta + twistAt(x);
  const c = Math.abs(Math.cos(SPEC.ribCount * th / 2));
  r += 0.07 * Math.pow(c, 6) - 0.02;
  r += 0.025 * (fbm(x * 0.6, Math.cos(theta) * 3, Math.sin(theta) * 3) - 0.5);
  return r;
}
function buildHull() {
  const geo = gridSurface(200, 260, (u, v, p) => {
    const theta = u * Math.PI * 2;
    const x = X_STERN_END + v * L;
    const r = hullRadius(x, theta);
    p.set(x, r * Math.cos(theta), r * Math.sin(theta));
  });
  return colorize(finish(mergeAll([geo])));
}

// ---------- 構造帯(円筒端と船首・船尾をつなぐ太い接続部) ----------
// dir = +1: 船首側, -1: 船尾側。外殻端の帯(溝つき)→ 回転部/非回転部の継ぎ目 → 太い首
function collarRadius(t) {
  // t: 外殻端からの距離(km)。負は外殻側
  if (t < -0.35) {
    const groove = Math.pow(Math.abs(Math.cos((t * Math.PI) / 0.38)), 10);
    return R * 1.035 - 0.055 * groove;            // 溝つきの構造帯
  }
  if (t < 0) return R * 0.97;                       // 継ぎ目(軸受けの隙間)
  const ring = Math.pow(Math.abs(Math.cos((t * Math.PI) / 0.45)), 14);
  const taper = THREE.MathUtils.lerp(R * 0.95, NECK_R, Math.min(1, t / 0.6));
  return taper + 0.09 * ring;                       // 首(数本の環)
}
function buildCollar(xHullEnd, dir, length) {
  const t0 = -2.6, t1 = length;
  const geo = gridSurface(160, 90, (u, v, p) => {
    const th = u * Math.PI * 2;
    const t = t0 + v * (t1 - t0);
    const r = collarRadius(t) + 0.012 * (noise3(Math.cos(th) * 20, Math.sin(th) * 20, t * 6) - 0.5);
    p.set(xHullEnd + dir * t, r * Math.cos(th), r * Math.sin(th));
  });
  return colorize(finish(mergeAll([geo])));
}

// ---------- 可動トゲ(センシング) ----------
function buildSpines() {
  const rand = rng(7);
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  for (let k = 0; k < SPEC.ribCount; k++) {
    const th0 = (2 * Math.PI * k) / SPEC.ribCount;
    for (let x = X_STERN_END + 3.0 + rand() * 1.5; x < X_BOW_END - 3.0; x += 1.3 + rand() * 1.0) {
      if (NODES.some((n) => Math.abs(x - n) < 0.7)) continue;
      const theta = th0 - twistAt(x);
      const r = hullRadius(x, theta);
      const retracted = rand() < 0.25;
      const len = retracted ? 0.06 + rand() * 0.06 : 0.18 + rand() * 0.34;
      const cone = new THREE.ConeGeometry(0.03 + rand() * 0.015, len, 5, 1);
      cone.translate(0, len / 2, 0);
      const dir = new THREE.Vector3((rand() - 0.5) * 0.5, Math.cos(theta) + (rand() - 0.5) * 0.25, Math.sin(theta) + (rand() - 0.5) * 0.25).normalize();
      q.setFromUnitVectors(up, dir);
      m.compose(new THREE.Vector3(x, r * Math.cos(theta), r * Math.sin(theta)), q, new THREE.Vector3(1, 1, 1));
      cone.applyMatrix4(m);
      parts.push(cone);
      const base = new THREE.SphereGeometry(0.07, 5, 3);
      base.scale(1, 0.45, 1);
      base.applyMatrix4(m);
      parts.push(base);
    }
  }
  return solidColor(finish(mergeAll(parts)), 0x8f9189);
}

// ---------- 船首シールド ----------
const X_SHIELD_BASE = X_BOW_END + SPEC.gap;
const BUD_BASE = NECK_R / (R * SPEC.shieldClosedRatio); // 後端は首の太さから立ち上がる
function budProfile(s) {
  if (s < 0.12) return BUD_BASE + (1 - BUD_BASE) * Math.pow(Math.sin((s / 0.12) * Math.PI / 2), 0.6);
  const t = (s - 0.12) / 0.88;
  return Math.pow(Math.max(0, 1 - Math.pow(t, 1.8)), 0.55);
}
function budSurface(Rs, Ls, x0) {
  return (s, th) => {
    const r = Rs * budProfile(s);
    const p = new THREE.Vector3(x0 + s * Ls, r * Math.cos(th), r * Math.sin(th));
    const ds = 0.002;
    const slope = (Rs * budProfile(Math.min(1, s + ds)) - r) / (ds * Ls);
    const normal = new THREE.Vector3(-slope, Math.cos(th), Math.sin(th)).normalize();
    return { p, normal };
  };
}
function armorLeaf(surface, thc, dth, sc, ds, lift, frontNarrow = 0.35) {
  return gridSurface(6, 4, (a, b, p) => {
    const w = 1 - frontNarrow * b;
    const th = thc + (a - 0.5) * dth * w;
    const s = sc - ds / 2 + b * ds;
    const base = surface(s, th);
    const h = lift(b) + 0.09 * Math.sin(Math.PI * a);
    p.set(base.p.x + base.normal.x * h, base.p.y + base.normal.y * h, base.p.z + base.normal.z * h);
  });
}
export function buildBudShield(openness, includeCore = true) {
  // openness: 0 = 閉じた砲弾型(120%), 1 = 装甲葉展開(150%)
  // 展開時は葉の位置・幅・起き上がりを乱数でばらつかせつつ、
  // 周方向・前後方向とも必ず重なる幅にして、前方から見て隙間ができないようにする
  const rand = rng(4242);
  // 装甲葉の厚み・起き上がり分(約0.3 km)を差し引き、外形がちょうど既定の径になるようにする
  const Rs = R * SPEC.shieldClosedRatio - 0.3, Ls = SPEC.shieldLength;
  const parts = [];
  const core = gridSurface(64, 60, (u, v, p) => {
    const th = u * Math.PI * 2, s = v;
    const r = Rs * 0.72 * budProfile(s);
    p.set(X_SHIELD_BASE + s * Ls * 0.92, r * Math.cos(th), r * Math.sin(th));
  });
  if (includeCore) parts.push(core);
  // 先端の頂部装甲(小さな多層ドーム)。前方から見た中心の隙間をふさぐ
  for (const [k, sc0] of [[0, 0.9], [1, 0.94]]) {
    parts.push(gridSurface(24, 8, (u, v, p) => {
      const th = u * Math.PI * 2 + k * 0.4;
      const s = sc0 + v * (1 - sc0);
      const r = (Rs * budProfile(s) + 0.12 - k * 0.04) * (1 - 0.15 * v);
      p.set(X_SHIELD_BASE + s * Ls + 0.12 - k * 0.05, r * Math.cos(th), r * Math.sin(th));
    }));
  }
  const layers = [
    { scale: 1.0, rows: 13, w: 1.45, rot: 0 },
    { scale: 0.87, rows: 11, w: 1.35, rot: 0.21 },
  ];
  const maxExtra = R * (SPEC.shieldOpenRatio - SPEC.shieldClosedRatio);
  layers.forEach((Ly, li) => {
    const surf = budSurface(Rs * Ly.scale, Ls * (li === 0 ? 1 : 0.95), X_SHIELD_BASE);
    for (let m = 0; m < Ly.rows; m++) {
      const sc = 0.07 + (m + 0.5) * (0.9 / Ly.rows);
      const rr = Rs * Ly.scale * budProfile(sc);
      const n = Math.max(5, Math.round((2 * Math.PI * rr) / Ly.w));
      const dth = (2 * Math.PI) / n;
      const rowPhase = openness ? rand() * dth : (m % 2) * dth / 2 + m * 0.13;
      for (let i = 0; i < n; i++) {
        const jitter = openness * (rand() - 0.5) * 0.35 * dth;
        const thc = i * dth + rowPhase + Ly.rot + jitter;
        const liftScale = 1 + openness * (rand() - 0.5) * 0.5;
        const openLift = openness * (li === 0 ? 1 : 0.6) * maxExtra * 0.8 * liftScale * Math.pow(budProfile(sc), 1.2);
        const lift = (b) => 0.05 + (0.22 + openLift) * Math.pow(1 - b, 1.6);
        // 幅は常に 1.3 倍以上(ずれ ±0.175 を足しても隣と重なる)
        const widthFactor = 1.3 + openness * (0.12 + rand() * 0.2);
        const dsFactor = 1.65 + openness * rand() * 0.3;
        parts.push(armorLeaf(surf, thc, dth * widthFactor, sc, (0.9 / Ly.rows) * dsFactor, lift));
      }
    }
  });
  return colorize(finish(mergeAll(parts)), silverColor);
}

// 減速時: 船首シールドを円筒径の約6倍の傘状に増設(仮の形状)
const DECEL = { Rc: R * SPEC.shieldDecelRatio, hc: 7.5, x0: X_SHIELD_BASE + 1.5 };
function decelCapX(r) {
  const t = r / DECEL.Rc;
  return DECEL.x0 + DECEL.hc * Math.pow(Math.max(0, 1 - t * t), 0.75) - 1.6 * Math.pow(t, 6);
}
function buildDecelShield() {
  const { Rc } = DECEL;
  const surface = (s, th) => {
    const r = s * Rc;
    const p = new THREE.Vector3(decelCapX(r), r * Math.cos(th), r * Math.sin(th));
    const dr = 0.05;
    const slope = (decelCapX(r + dr) - decelCapX(r)) / dr;
    const normal = new THREE.Vector3(1, -slope * Math.cos(th), -slope * Math.sin(th)).normalize();
    return { p, normal };
  };
  const parts = [];
  const under = gridSurface(160, 40, (u, v, p) => {
    const th = u * Math.PI * 2, r = Math.max(NECK_R, v * Rc * 0.985);
    const gill = 0.12 * Math.pow(Math.abs(Math.cos(80 * th)), 4) * v;
    p.set(decelCapX(r) - 0.9 - gill, r * Math.cos(th), r * Math.sin(th));
  });
  parts.push(under);
  // 傘の付け根(首から傘の下面へ)
  const stem = gridSurface(64, 12, (u, v, p) => {
    const th = u * Math.PI * 2;
    const x = X_SHIELD_BASE - 0.2 + v * (decelCapX(NECK_R) - 0.9 - X_SHIELD_BASE + 0.2);
    const r = NECK_R * (1 + 0.25 * v * v);
    p.set(x, r * Math.cos(th), r * Math.sin(th));
  });
  parts.push(stem);
  const rows = 15;
  for (let m = 0; m < rows; m++) {
    const sc = 0.06 + (m + 0.5) * (0.94 / rows);
    const rr = sc * Rc;
    const n = Math.max(6, Math.round((2 * Math.PI * rr) / 2.4));
    const dth = (2 * Math.PI) / n;
    for (let i = 0; i < n; i++) {
      const thc = i * dth + (m % 2) * dth / 2;
      parts.push(gridSurface(6, 4, (a, b, p) => {
        const th = thc + (a - 0.5) * dth * 1.25;
        const s = sc - (0.94 / rows) * 0.8 + b * (0.94 / rows) * 1.6;
        const base = surface(Math.min(1, s), th);
        const h = 0.06 + 0.35 * b + 0.1 * Math.sin(Math.PI * a);
        p.set(base.p.x + base.normal.x * h, base.p.y + base.normal.y * h, base.p.z + base.normal.z * h);
      }));
    }
  }
  return colorize(finish(mergeAll(parts)), silverColor);
}

// ---------- 推進コブ群(幾何学的配置) ----------
function knobGeometry(r, seed) {
  const g = new THREE.SphereGeometry(r, 26, 18);
  const pos = g.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const k = 1 + 0.03 * (fbm(p.x / r * 1.5 + seed, p.y / r * 1.5, p.z / r * 1.5) - 0.5);
    p.multiplyScalar(k);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  return g;
}
// 球面上の、軸 axis のまわりに 1 + 6 + 13 の同心環で 20 方向を並べる
function ringDirections(axis, count, spreadDeg) {
  const a = axis.clone().normalize();
  const tmp = Math.abs(a.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(a, tmp).normalize();
  const v = new THREE.Vector3().crossVectors(a, u);
  const rings = count === 20 ? [[1, 0], [6, 0.5], [13, 1]] : [[1, 0], [count - 1, 1]];
  const out = [];
  for (const [n, f] of rings) {
    const polar = THREE.MathUtils.degToRad(spreadDeg * f);
    for (let i = 0; i < n; i++) {
      const az = (2 * Math.PI * i) / n + (n === 6 ? 0 : Math.PI / 13);
      out.push(a.clone().multiplyScalar(Math.cos(polar))
        .add(u.clone().multiplyScalar(Math.sin(polar) * Math.cos(az)))
        .add(v.clone().multiplyScalar(Math.sin(polar) * Math.sin(az))));
    }
  }
  return out;
}
// 稼働中の推進器: 円錐形のノズル(漆黒) + 内部の核融合パルス発光
function activeThrusters(center, r, axis) {
  const nozzles = [], glows = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const d of ringDirections(axis, SPEC.thrustersPerKnob, 50)) {
    const len = 0.5, throat = 0.07, exit = 0.24;
    const cone = new THREE.CylinderGeometry(exit, throat, len, 18, 1, true); // +Y が出口
    cone.translate(0, len / 2, 0);
    const disk = new THREE.CircleGeometry(throat * 1.25, 14);
    disk.rotateX(-Math.PI / 2);
    disk.translate(0, 0.06, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, d);
    const m = new THREE.Matrix4().compose(center.clone().add(d.clone().multiplyScalar(r * 0.96)), q, new THREE.Vector3(1, 1, 1));
    cone.applyMatrix4(m); disk.applyMatrix4(m);
    nozzles.push(cone); glows.push(disk);
  }
  return { nozzles, glows };
}
// 建造中・解体中の推進器: 穴だけ(黒い開口 + 細い縁)
function thrusterHoles(center, r, axis) {
  const holes = [], rims = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const d of ringDirections(axis, SPEC.holesPerKnob, 52)) {
    const disk = new THREE.CircleGeometry(0.085, 12);
    disk.rotateX(-Math.PI / 2);
    const rim = new THREE.RingGeometry(0.085, 0.12, 14);
    rim.rotateX(-Math.PI / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(up, d);
    const m = new THREE.Matrix4().compose(center.clone().add(d.clone().multiplyScalar(r * 1.004)), q, new THREE.Vector3(1, 1, 1));
    disk.applyMatrix4(m); rim.applyMatrix4(m);
    holes.push(disk); rims.push(rim);
  }
  return { holes, rims };
}
// xFront: 区画の前端(首の端), dir: -1 = 船尾へ向かって伸びる, +1 = 船首前方へ
function buildPropulsionCluster({ xFront, length, dir, active, holes }) {
  const knobParts = [], nozzleParts = [], glowParts = [], holeParts = [], rimParts = [];
  const xAt = (t) => xFront + dir * t * length;
  const trunkR = (t) => THREE.MathUtils.lerp(NECK_R, 2.6, t);
  // 幹
  knobParts.push(gridSurface(64, 30, (u, v, p) => {
    const th = u * Math.PI * 2;
    const t = v * 0.94;
    const r = trunkR(t) * (v > 0.9 ? Math.sqrt(Math.max(0, 1 - ((v - 0.9) / 0.1) ** 2)) * 0.85 + 0.15 : 1);
    p.set(xAt(t), r * Math.cos(th), r * Math.sin(th));
  }));
  // 中小のコブ: 前方ほど小さい 5 段の環。段ごとに半ピッチずらす
  const rings = [
    { t: 0.06, r: 0.42, n: 18 },
    { t: 0.17, r: 0.58, n: 16 },
    { t: 0.29, r: 0.76, n: 14 },
    { t: 0.42, r: 0.95, n: 12 },
    { t: 0.56, r: 1.15, n: 10 },
  ];
  rings.forEach((g, k) => {
    for (let i = 0; i < g.n; i++) {
      const ang = (2 * Math.PI * i) / g.n + (k % 2) * Math.PI / g.n;
      const rad = trunkR(g.t) + g.r * 0.35;
      const c = new THREE.Vector3(xAt(g.t), rad * Math.cos(ang), rad * Math.sin(ang));
      const kg = knobGeometry(g.r, k * 31 + i); kg.translate(c.x, c.y, c.z); knobParts.push(kg);
    }
  });
  // 最後端の最大級コブ 10 個(正十角形の環)。1 つおきの 5 個が稼働中
  const N = SPEC.bigKnobs, bigR = 1.85, ringR = 3.6;
  const xBig = xAt(1) - dir * bigR * 0.9;
  for (let i = 0; i < N; i++) {
    const ang = (2 * Math.PI * i) / N;
    const c = new THREE.Vector3(xBig, ringR * Math.cos(ang), ringR * Math.sin(ang));
    const kg = knobGeometry(bigR, 100 + i); kg.translate(c.x, c.y, c.z); knobParts.push(kg);
    const isActive = i % 2 === 0;
    const radial = new THREE.Vector3(0, Math.cos(ang), Math.sin(ang));
    if (isActive && active) {
      const axis = new THREE.Vector3(dir, 0, 0).add(radial.clone().multiplyScalar(0.25));
      const t = activeThrusters(c, bigR, axis);
      nozzleParts.push(...t.nozzles); glowParts.push(...t.glows);
    }
    if (isActive && holes) {
      // 稼働中コブの前方に、建造中(外寄り)と解体中(内寄り)の小さめのコブ
      for (const [side, label] of [[-1, 'build'], [1, 'dismantle']]) {
        const a2 = ang + side * 0.24;
        const r2 = 1.05;
        const c2 = new THREE.Vector3(xBig - dir * 2.75, (ringR + 0.55) * Math.cos(a2), (ringR + 0.55) * Math.sin(a2));
        const kg2 = knobGeometry(r2, 300 + i * 2 + side); kg2.translate(c2.x, c2.y, c2.z); knobParts.push(kg2);
        const rad2 = new THREE.Vector3(0, Math.cos(a2), Math.sin(a2));
        const axis2 = new THREE.Vector3(dir, 0, 0).add(rad2.multiplyScalar(0.6));
        const h = thrusterHoles(c2, r2, axis2);
        holeParts.push(...h.holes); rimParts.push(...h.rims);
      }
    }
  }
  const out = {
    knobs: colorize(finish(mergeAll(knobParts))),
    activeCount: glowParts.length,
    holeCount: holeParts.length,
  };
  if (nozzleParts.length) {
    out.nozzles = finish(mergeAll(nozzleParts));
    out.glows = finish(mergeAll(glowParts));
  }
  if (holeParts.length) {
    out.holes = finish(mergeAll(holeParts));
    out.rims = finish(mergeAll(rimParts));
  }
  return out;
}

// ---------- 組み立て ----------
// mode: 'cruise' (巡航・閉じた砲弾型), 'open' (装甲葉展開), 'decel' (減速時の最大展開)
export function buildShip(mode = 'cruise') {
  const M = makeMaterials();
  const group = new THREE.Group();
  group.name = `dTdt_ship_${mode}`;
  const add = (geo, name, mat) => {
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    group.add(mesh);
  };
  const addCluster = (c, prefix) => {
    add(c.knobs, `${prefix}_knobs`, M.hull);
    add(c.nozzles, `${prefix}_thrusters_active`, M.thruster);
    add(c.glows, `${prefix}_fusion_glow`, M.glow);
    add(c.holes, `${prefix}_thruster_holes`, M.hole);
    add(c.rims, `${prefix}_thruster_hole_rims`, M.thruster);
  };
  add(buildHull(), 'hull_rotating_cylinder', M.hull);
  add(buildSpines(), 'sensor_spines', M.hull);
  add(buildCollar(X_BOW_END, 1, SPEC.gap + 0.6), 'bow_structural_band', M.hull);
  const sternNeck = SPEC.gap + 0.6;
  add(buildCollar(X_STERN_END, -1, sternNeck), 'stern_structural_band', M.hull);
  const xSternFront = X_STERN_END - sternNeck + 0.1;
  const stern = buildPropulsionCluster({
    xFront: xSternFront, length: SPEC.sternLength, dir: -1,
    active: mode !== 'decel', holes: true,
  });
  addCluster(stern, 'stern');
  let bowTip, active = stern.activeCount;
  if (mode === 'decel') {
    add(buildDecelShield(), 'bow_shield_decel', M.shield);
    // 仮: 減速時は稼働中の推進コブ群を傘の前面へ移設し、推進器を前向きにする
    const front = buildPropulsionCluster({
      xFront: decelCapX(0) - 0.3, length: 9, dir: 1, active: true, holes: false,
    });
    addCluster(front, 'bow_relocated');
    active = front.activeCount;
    bowTip = decelCapX(0) + 9;
  } else {
    add(buildBudShield(mode === 'open' ? 1 : 0), mode === 'open' ? 'bow_shield_open' : 'bow_shield_closed', M.shield);
    bowTip = X_SHIELD_BASE + SPEC.shieldLength;
  }
  const sternEnd = xSternFront - SPEC.sternLength;
  group.userData = {
    mode,
    lengthKm: bowTip - sternEnd,
    activeThrusters: active,
    holes: stern.holeCount,
    activeLocation: mode === 'decel' ? 'bow' : 'stern',
  };
  return group;
}
