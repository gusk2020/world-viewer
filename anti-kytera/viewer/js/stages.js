// Anti-KyTerra's seven stages (PR #14) for the v1s-style viewer.
// Pure display: it reads the committed results of PR #12 (../results/) and of
// the vegetation layer (../veg/results/) and never estimates anything.
//
// The colouring is PR #14's: every pixel computes its own lng/lat from its 3D
// direction (or, on the 2D map, from its Mercator position) and reads the data
// grids directly, so there is no painted map texture to crowd at the poles.
// Continuous fields are drawn from a copy averaged over an equal footprint
// poleward of 60 degrees (polarFootprint); the centre readout always reads the
// committed arrays themselves.
//
// What is new here, and only this:
//  - the 3D colour goes into v1s's own Lambert material (v1s's light, v1s's
//    geometry relief, on a mesh shaped by the Anti-KyTerra bedrock);
//  - the same colour function draws the 2D map (Web Mercator, per pixel);
//  - the sea surface can move: where it disagrees with the estimates (which
//    are for today's conditions and a 0 m sea) the sea surface wins.
import * as THREE from "three";

export const ICE_MIN_M = 10;          // the hand-off ice mask threshold
const POLAR_AVERAGE_LAT = 60;         // polarFootprint's window exceeds one cell poleward of this
const RAMPS = {
  rock: [[0, 58, 52, 50], [0.40, 104, 92, 80], [0.57, 150, 136, 108], [0.62, 128, 140, 96], [0.72, 150, 128, 88],
         [0.85, 120, 100, 84], [1, 236, 232, 226]],
  sea: [[0, 12, 26, 70], [0.6, 22, 70, 140], [1, 90, 170, 215]],
  temp: [[0, 40, 20, 120], [0.25, 60, 110, 220], [0.45, 190, 225, 245], [0.55, 250, 245, 200],
         [0.75, 245, 150, 60], [1, 150, 20, 30]],
  hum: [[0, 245, 238, 220], [0.3, 190, 220, 170], [0.6, 60, 170, 170], [1, 20, 50, 130]],
  precip: [[0, 150, 90, 40], [0.15, 225, 200, 130], [0.35, 235, 240, 200], [0.55, 110, 200, 120],
           [0.8, 30, 120, 170], [1, 40, 30, 120]],
  ice: [[0, 235, 245, 255], [0.3, 150, 200, 240], [0.7, 50, 110, 200], [1, 20, 30, 110]],
  diff: [[0, 30, 60, 170], [0.5, 245, 245, 245], [1, 180, 30, 30]],
};
const RAMP_ROWS = Object.keys(RAMPS);
const BED_LO = -8000, BED_HI = 6000;
export const AGREE = { same: [70, 170, 90], veg: [215, 70, 60], ice: [120, 150, 220], none: [90, 90, 90], sea: [20, 40, 70] };
const EXPOSED = [150, 140, 125];      // seabed above a lowered sea: no vegetation estimate exists there
const WATER = [47, 111, 168];          // v1s's sea colour (0x2f6fa8), for the 2D map
export const STAGES = ["bed", "sea", "t2m", "hum", "precip", "ice", "veg"];
const STAGE_ID = { bed: 0, sea: 1, t2m: 2, hum: 2, precip: 2, ice: 3, veg: 4 };
export const MODE_JA = { fit: "地球適合", holdout: "地域保留" };

export function ramp(name, x) {
  const r = RAMPS[name];
  x = Math.min(1, Math.max(0, x));
  for (let i = 1; i < r.length; i++) if (x <= r[i][0]) {
    const t = (x - r[i - 1][0]) / (r[i][0] - r[i - 1][0]);
    return [0, 1, 2].map((k) => r[i - 1][k + 1] + t * (r[i][k + 1] - r[i - 1][k + 1]));
  }
  return r[r.length - 1].slice(1);
}
export const seaColour = (z) => ramp("sea", 1 - Math.min(1, -z / 6000));

// ---------------------------------------------------------------- data
function polarFootprint(a, w, h) {
  const out = new Float32Array(w * h), pre = new Float64Array(w + 1);
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

export async function loadStages(base) {
  const [S, V] = await Promise.all([
    fetch(`${base}results/display.json`).then((r) => r.json()),
    fetch(`${base}veg/results/veg_display.json`).then((r) => r.json()),
  ]);
  const [sb, vb] = await Promise.all([loadBin(`${base}results/fields.bin`), loadBin(`${base}veg/results/veg_fields.bin`)]);
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
  return makeStages(S, V, F, D, vcol, vlab);
}

function makeStages(S, V, F, D, vcol, vlab) {
  const state = { v: "bed", src: "model", mode: "fit", seaLevel: 0, opacity: 0.4 };

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
  // drawn*: what the screen paints (the shader's twin); raw*: what the data
  // says at 0 m. Order: ice > sea > vegetation.
  function drawnComposite(which, lng, lat) {
    if (bilinear(`H_${which}`, lng, lat) > ICE_MIN_M) return 1;
    const z = bilinear("bed", lng, lat);
    if (z < state.seaLevel) return 0;
    if (z < 0) return -1;                                  // exposed seabed
    return cell(`veg_${which}`, lng, lat) || 255;
  }
  function rawComposite(which, lng, lat) {
    if (cell(`H_${which}`, lng, lat) > ICE_MIN_M) return 1;
    if (cell("bed", lng, lat) < 0) return 0;
    return cell(`veg_${which}`, lng, lat) || 255;
  }
  const isClimate = () => ["t2m", "hum", "precip", "ice"].includes(state.v);
  const vm = () => S.vars[state.v];
  function scale() {
    const m = vm();
    if (state.src === "diff") return { ramp: "diff", lo: -m.diffRange, hi: m.diffRange, log: false };
    return { ramp: m.ramp, lo: m.lo, hi: m.hi, log: !!m.log };
  }

  // ------------------------------------------------ textures
  const T = {};
  function floatTex(arr, w, h) {
    const t = new THREE.DataTexture(arr, w, h, THREE.RedFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
  for (const k of Object.keys(S.fields)) T[k] = floatTex(D[k], D[k].meta.w, D[k].meta.h);
  for (const k of ["veg_fit", "veg_holdout", "veg_teacher"]) {
    const t = new THREE.DataTexture(F[k], F[k].meta.w, F[k].meta.h, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
    T[k] = t;
  }
  T.normal = (() => {   // object-space relief normals, for the flat 2D map only
    const f = D.bed.meta, a = D.bed, W = f.w, H = f.h, R = 6.371e6, RELIEF = 25;
    const out = new Uint8Array(W * H * 4), dy = Math.PI * R / H;
    for (let j = 0; j < H; j++) {
      const lat = (j + 0.5) / H * Math.PI - Math.PI / 2, cl = Math.cos(lat), sl = Math.sin(lat);
      const k = Math.min(W >> 2, Math.max(1, Math.round(1 / Math.max(cl, 1e-6))));
      const dx = cl * 2 * Math.PI * R / W * k;
      const jn = Math.min(H - 1, j + 1), js = Math.max(0, j - 1);
      for (let i = 0; i < W; i++) {
        const gx = (a[j * W + (i + k) % W] - a[j * W + (i - k + W) % W]) / (2 * dx) * RELIEF;
        const gy = (a[jn * W + i] - a[js * W + i]) / ((jn - js) * dy) * RELIEF;
        const phi = ((i + 0.5) / W) * 2 * Math.PI, cp = Math.cos(phi), sp = Math.sin(phi);
        let x = -cp * cl - gx * sp - gy * cp * sl, y = sl - gy * cl, z = sp * cl - gx * cp + gy * sp * sl;
        const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
        const o = (j * W + i) * 4;
        out[o] = Math.round((x * 0.5 + 0.5) * 255); out[o + 1] = Math.round((y * 0.5 + 0.5) * 255);
        out[o + 2] = Math.round((z * 0.5 + 0.5) * 255); out[o + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true;
    return t;
  })();
  {
    const rp = new Uint8Array(256 * RAMP_ROWS.length * 4);
    RAMP_ROWS.forEach((name, r) => {
      for (let i = 0; i < 256; i++) {
        const c = ramp(name, i / 255), o = (r * 256 + i) * 4;
        rp[o] = Math.round(c[0]); rp[o + 1] = Math.round(c[1]); rp[o + 2] = Math.round(c[2]); rp[o + 3] = 255;
      }
    });
    T.ramp = new THREE.DataTexture(rp, 256, RAMP_ROWS.length, THREE.RGBAFormat, THREE.UnsignedByteType);
    T.ramp.minFilter = T.ramp.magFilter = THREE.LinearFilter; T.ramp.generateMipmaps = false; T.ramp.needsUpdate = true;
    const pal = new Uint8Array(256 * 4);
    for (const [code, rgb] of Object.entries(vcol)) pal.set([...rgb, 255], Number(code) * 4);
    T.pal = new THREE.DataTexture(pal, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    T.pal.minFilter = T.pal.magFilter = THREE.NearestFilter; T.pal.generateMipmaps = false; T.pal.needsUpdate = true;
  }

  // Shared uniform objects: the 3D material and the 2D renderer read the same ones.
  const U = {
    akBed: { value: T.bed }, akNrm: { value: T.normal }, akFM: { value: T.T_fit }, akFT: { value: T.T_teacher },
    akHM: { value: T.H_fit }, akHT: { value: T.H_teacher }, akVM: { value: T.veg_fit }, akVT: { value: T.veg_teacher },
    akRamp: { value: T.ramp }, akPal: { value: T.pal },
    akStage: { value: 0 }, akSrc: { value: 0 }, akRampRow: { value: 0 }, akNRamps: { value: RAMP_ROWS.length },
    akLo: { value: 0 }, akHi: { value: 1 }, akLog: { value: false }, akSeaLevel: { value: 0 },
  };

  const GLSL = /* glsl */`
uniform sampler2D akBed, akNrm, akFM, akFT, akHM, akHT, akVM, akVT, akRamp, akPal;
uniform int akStage, akSrc, akRampRow, akNRamps;
uniform float akLo, akHi, akSeaLevel;
uniform bool akLog;
const float AK_BED_LO = ${BED_LO.toFixed(1)}, AK_BED_HI = ${BED_HI.toFixed(1)}, AK_ICE_MIN = ${ICE_MIN_M.toFixed(1)};
const int AK_ROCK = ${RAMP_ROWS.indexOf("rock")}, AK_SEA = ${RAMP_ROWS.indexOf("sea")};
float akBil(sampler2D t, vec2 ll) {
  ivec2 sz = textureSize(t, 0);
  float fx = (ll.x + 180.0) / 360.0 * float(sz.x) - 0.5, fy = (ll.y + 90.0) / 180.0 * float(sz.y) - 0.5;
  int y0 = clamp(int(floor(fy)), 0, sz.y - 1), y1 = min(y0 + 1, sz.y - 1);
  float wy = clamp(fy - float(y0), 0.0, 1.0);
  float fx0 = floor(fx), wx = fx - fx0;
  int x0 = int(mod(fx0, float(sz.x))), x1 = (x0 + 1) % sz.x;
  float a = mix(texelFetch(t, ivec2(x0, y0), 0).r, texelFetch(t, ivec2(x1, y0), 0).r, wx);
  float b = mix(texelFetch(t, ivec2(x0, y1), 0).r, texelFetch(t, ivec2(x1, y1), 0).r, wx);
  return mix(a, b, wy);
}
int akCls(sampler2D t, vec2 ll) {
  ivec2 sz = textureSize(t, 0);
  int x = int(mod(floor((ll.x + 180.0) / 360.0 * float(sz.x)), float(sz.x)));
  int y = clamp(int(floor((ll.y + 90.0) / 180.0 * float(sz.y))), 0, sz.y - 1);
  return int(texelFetch(t, ivec2(x, y), 0).r * 255.0 + 0.5);
}
vec3 akRampC(int row, float x) {
  return texture(akRamp, vec2((clamp(x, 0.0, 1.0) * 255.0 + 0.5) / 256.0, (float(row) + 0.5) / float(akNRamps))).rgb * 255.0;
}
vec3 akRock(float z) { return akRampC(AK_ROCK, (z - AK_BED_LO) / (AK_BED_HI - AK_BED_LO)); }
vec3 akSeaC(float depth) { return akRampC(AK_SEA, 1.0 - min(1.0, -depth / 6000.0)); }
float akNorm(float x) {
  if (akLog) { float l0 = log(max(akLo, 1e-6)); return (log(max(x, akLo)) - l0) / (log(akHi) - l0); }
  return (x - akLo) / (akHi - akLo);
}
// ice > sea (at the current sea level) > vegetation; -1 = seabed exposed by a lowered sea
int akVeg(sampler2D h, sampler2D v, vec2 ll, float z) {
  if (akBil(h, ll) > AK_ICE_MIN) return 1;
  if (z < akSeaLevel) return 0;
  if (z < 0.0) return -1;
  int c = akCls(v, ll);
  return c == 0 ? 255 : c;
}
vec2 akLngLat(vec3 p) {
  vec3 d = normalize(p);
  float lat = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float phi = atan(d.z, -d.x);
  if (phi < 0.0) phi += 6.283185307179586;
  return vec2(degrees(phi) - 180.0, lat);
}
// sRGB 0-255. relief: how strongly relief shading may modulate it on the flat map.
vec3 akColour(vec2 ll, float z, out float relief) {
  bool sea = z < akSeaLevel;
  relief = sea ? 0.0 : 1.0;
  if (akStage == 0) { relief = 1.0; return akRock(z); }
  if (akStage == 1) return sea ? akSeaC(z - akSeaLevel) : akRock(z);
  if (akStage == 4) {
    if (akSrc == 2) {
      int m = akVeg(akHM, akVM, ll, z), t = akVeg(akHT, akVT, ll, z);
      relief = sea ? 0.0 : 0.15;
      if (m == 0 && t == 0) return vec3(${AGREE.sea.join(",")});
      if (m == -1) return vec3(${EXPOSED.join(",")});
      if (t == 255) return vec3(${AGREE.none.join(",")});
      if (m == t) return vec3(${AGREE.same.join(",")});
      return (m == 1 || t == 1) ? vec3(${AGREE.ice.join(",")}) : vec3(${AGREE.veg.join(",")});
    }
    int k = akSrc == 1 ? akVeg(akHT, akVT, ll, z) : akVeg(akHM, akVM, ll, z);
    relief = sea ? 0.0 : 0.2;
    if (k == 0) return akSeaC(z - akSeaLevel);
    if (k == -1) return vec3(${EXPOSED.join(",")});
    return texelFetch(akPal, ivec2(k, 0), 0).rgb * 255.0;
  }
  float m = akBil(akFM, ll), t = akBil(akFT, ll);
  float x = akSrc == 2 ? m - t : akSrc == 0 ? m : t;
  if (akStage == 3) {
    bool show = akSrc == 2 ? abs(x) >= 1.0 : x > AK_ICE_MIN;
    if (show) { relief = 0.15; return akRampC(akRampRow, akNorm(x)); }
    return sea ? akSeaC(z - akSeaLevel) * 0.8 : akRock(z) * 0.85;
  }
  relief = sea ? 0.0 : 0.2;
  return akRampC(akRampRow, akNorm(x));
}
float akCoast(float z) {      // the sea-level contour, about one screen pixel wide
  if (akStage == 0) return 1.0;
  float w = max(fwidth(z), 1e-3);
  return mix(0.35, 1.0, smoothstep(0.6, 1.4, abs(z - akSeaLevel) / w));
}
`;

  // ------------------------------------------------ 3D: v1s's Lambert material, colour per pixel
  function createMaterial() {
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vAkPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAkPos = position;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vAkPos;\n" + GLSL)
        .replace("#include <map_fragment>", `#include <map_fragment>
  {
    vec2 ll = akLngLat(vAkPos);
    float z = akBil(akBed, ll), relief;
    vec3 c = akColour(ll, z, relief) * akCoast(z) / 255.0;
    // sRGB -> linear, so v1s's light and output conversion treat it like the photo
    diffuseColor.rgb = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }`);
    };
    m.customProgramCacheKey = () => "anti-kytera-stage";
    return m;
  }

  // ------------------------------------------------ 2D: the same colour, per pixel in Web Mercator
  const MERC_R = 6378137;
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const U2 = {
    ...U,
    akExtent: { value: new THREE.Vector4() }, akMode: { value: 0 }, akOpacity: { value: 0.4 },
    akPhoto: { value: null }, akElev: { value: null },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: U2,
    vertexShader: "out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `precision highp float; precision highp int;
in vec2 vUv;
uniform vec4 akExtent; uniform int akMode; uniform float akOpacity;
uniform sampler2D akPhoto, akElev;
${GLSL}
void main() {
  float mx = mix(akExtent.x, akExtent.z, vUv.x), my = mix(akExtent.y, akExtent.w, vUv.y);
  float lng = mod(degrees(mx / ${MERC_R}.0) + 180.0, 360.0) - 180.0;
  float lat = degrees(atan(sinh(my / ${MERC_R}.0)));
  vec2 ll = vec2(lng, lat);
  vec3 c; float z;
  if (akMode == 0) {        // 標準: v1s's photo, water where the GEBCO surface is below the sea
    z = akBil(akElev, ll);
    vec3 lin = texture(akPhoto, vec2((lng + 180.0) / 360.0, (lat + 90.0) / 180.0)).rgb;   // sRGB texture, decoded
    c = mix(lin * 12.92, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, lin)) * 255.0;
    if (z < akSeaLevel) c = mix(c, vec3(${WATER.join(",")}), akOpacity);
  } else {
    z = akBil(akBed, ll);
    float relief;
    c = akColour(ll, z, relief);
    // relief shading, light from the upper left of the map
    vec3 d = vec3(-cos(radians(lng + 180.0)) * cos(radians(lat)), sin(radians(lat)), sin(radians(lng + 180.0)) * cos(radians(lat)));
    vec3 e = vec3(sin(radians(lng + 180.0)), 0.0, cos(radians(lng + 180.0)));
    vec3 n = cross(d, e);
    vec3 L = normalize(0.707 * d + 0.5 * (n - e));
    vec3 N = normalize(texture(akNrm, vec2((lng + 180.0) / 360.0, (lat + 90.0) / 180.0)).xyz * 2.0 - 1.0);
    float sh = clamp(1.0 + (dot(N, L) - dot(d, L)) / 0.707, 0.35, 1.25);
    c *= mix(1.0, sh, relief);
    if (akStage != 0 && z < akSeaLevel) c = mix(c, vec3(${WATER.join(",")}), akOpacity);
    c *= akCoast(z);
  }
  gl_FragColor = vec4(clamp(c, 0.0, 255.0) / 255.0, 1.0);
}`,
  }));
  quad.frustumCulled = false;
  quadScene.add(quad);
  let rt = null, pixels = null, elevTex = null;
  // extent: EPSG:3857 [minx, miny, maxx, maxy]; returns a canvas of size w x h
  function renderMercator(renderer, extent, w, h, { photo, photoTexture, elevation }) {
    U2.akExtent.value.set(extent[0], extent[1], extent[2], extent[3]);
    U2.akMode.value = photo ? 0 : 1;
    U2.akOpacity.value = state.opacity;
    if (photo) {
      if (!elevTex || elevTex.image.data.length !== elevation.metres.length) {
        if (elevTex) elevTex.dispose();
        elevTex = floatTex(Float32Array.from(elevation.metres), elevation.width, elevation.height);
      }
      U2.akPhoto.value = photoTexture; U2.akElev.value = elevTex;
    } else { U2.akPhoto.value = T.ramp; U2.akElev.value = T.bed; }
    if (!rt || rt.width !== w || rt.height !== h) {
      if (rt) rt.dispose();
      rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
      pixels = new Uint8Array(w * h * 4);
    }
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(quadScene, quadCam);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
    renderer.setRenderTarget(prev);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // ------------------------------------------------ state -> uniforms
  function apply() {
    U.akStage.value = STAGE_ID[state.v];
    U.akSrc.value = { model: 0, teacher: 1, diff: 2 }[state.src];
    U.akSeaLevel.value = state.seaLevel;
    if (isClimate()) {
      const key = vm().key, sc = scale();
      U.akFM.value = T[`${key}_${state.mode}`]; U.akFT.value = T[`${key}_teacher`];
      U.akRampRow.value = RAMP_ROWS.indexOf(sc.ramp); U.akLo.value = sc.lo; U.akHi.value = sc.hi; U.akLog.value = sc.log;
    }
    U.akHM.value = T[`H_${state.mode}`]; U.akHT.value = T.H_teacher;
    U.akVM.value = T[`veg_${state.mode}`]; U.akVT.value = T.veg_teacher;
  }

  // ------------------------------------------------ legend and notes
  const pct = (x) => (x * 100).toFixed(0) + "%";
  function legend() {
    const veg = state.v === "veg";
    const out = { bar: null, classes: null, score: "", note: "" };
    if (veg) {
      const items = [];
      const sc = V.scores[state.mode];
      if (state.src === "diff") {
        items.push([AGREE.same, "一致"], [AGREE.veg, "植生が不一致"], [AGREE.ice, "氷の有無が不一致"],
          [AGREE.none, "教師なし"], [AGREE.sea, "海"]);
      } else {
        for (const c of V.classes) {
          const iou = sc.iou[String(c.code)];
          items.push([c.rgb, c.ja, state.src === "model" && iou != null ? Math.round(iou * 100) : null]);
        }
        items.push([vcol[1], "陸氷"], [seaColour(-3000), "海"]);
        if (state.src === "teacher") items.push([vcol[255], "教師なし"]);
      }
      if (state.seaLevel < 0) items.push([EXPOSED, "干上がった海底（推定なし）"]);
      out.classes = items;
      out.score = `${MODE_JA[state.mode]}：15区分 一致 ${pct(sc.accuracy)}・κ ${sc.kappa.toFixed(2)}・大区分 ${pct(sc.group)}`;
      out.note = {
        model: "モデル：年平均の気温・降水・水蒸気圧（3〜5段階と同じ推定値）と岩盤地形から分類した、通年の代表的な自然植生。数字は種類ごとの一致度（%）。",
        teacher: "教師：Ramankutty & Foley (1999) 潜在自然植生（人の土地利用が無い場合）。南極は教師に区分が無い。",
        diff: "差：モデルと教師を、氷＞海＞植生の順に重ねた最終表示どうしで比べた一致・不一致。",
      }[state.src] + " 重ね順は 氷＞海＞植生。限界：年平均だけなので季節性（常緑/落葉、雨季の有無）は区別できない。";
    } else {
      let rp, lo, hi, unit;
      if (!isClimate()) { rp = "rock"; lo = BED_LO; hi = BED_HI; unit = "m"; }
      else { const sc = scale(); rp = sc.ramp; lo = sc.lo; hi = sc.hi; unit = vm().unit; }
      const colours = [];
      for (let i = 0; i < 256; i++) colours.push(state.v === "sea" && i < 146 ? seaColour(BED_LO + (i / 255) * (BED_HI - BED_LO)) : ramp(rp, i / 255));
      out.bar = { colours, lo, hi, unit: unit + (state.src === "diff" && isClimate() ? "（差）" : "") };
      if (!isClimate()) { out.score = S.stages[state.v].score; out.note = S.stages[state.v].note; }
      else {
        out.score = `${MODE_JA[state.mode]}：${vm().score[state.mode]}`;
        out.note = (state.src === "teacher" ? vm().teacherNote : state.src === "model" ? vm().modelNote : "差 = モデル − 教師。") +
          " " + S.modeNote[state.mode];
      }
    }
    if (isClimate() || veg) out.note += " 地球適合＝見たことのある場所への当てはめ（ほぼ一致して当然）。実力の目安は地域保留。";
    out.note += " 画面の色：緯度60°より極側は、極付近の細いセルの筋を抑えるため東西に平均した値で描く（描画だけ）。" +
      "海岸線・氷の縁は隣のセルとの間を補間した線。中央の数値は常に平均前の元データのセルの値。" +
      " 形は Anti-KyTerra の岩盤（GEBCO_2026 氷床下地形）、光と海面は v1s と同じ。";
    return out;
  }

  // ------------------------------------------------ the centre readout: raw data values
  const SEA_JA = (z) => (z < 0 ? "海" : "陸");
  function readout(lng, lat) {
    const pos = `中央 ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(1)}°${lng >= 0 ? "E" : "W"}`;
    const polar = Math.abs(lat) >= POLAR_AVERAGE_LAT ? "（この緯度の画面の色は東西平均）" : "";
    const head = `${pos}　<span class="k">元データ値</span>${polar}`;
    const z = cell("bed", lng, lat);
    const tag = `モデル（${MODE_JA[state.mode]}）`;
    const warn = (drawn, raw) => drawn === raw ? "" :
      `<br><span class="w">※画面の塗りは「${drawn}」、元データのセルは「${raw}」（境界付近の補間・平均による差）</span>`;
    // the moved sea surface wins over the 0 m estimates
    const sl = state.seaLevel;
    const seaNote = sl !== 0 && ((z < sl) !== (z < 0))
      ? `<br><span class="w">※海面 ${sl > 0 ? "+" : ""}${sl} m ではここは${z < sl ? "海" : "陸（干上がった海底）"}。塗り分けの推定は海面0 mのまま</span>` : "";
    if (state.v === "bed" || state.v === "sea") {
      const what = state.v === "sea" ? `・${SEA_JA(z)}（海面0 m）` : "";
      const drawnSea = bilinear("bed", lng, lat) < 0, rawSea = z < 0;
      const w = state.v === "sea" && sl === 0 ? warn(drawnSea ? "海" : "陸", rawSea ? "海" : "陸") : "";
      return `${head}<br><b class="m">入力</b> 岩盤 ${z.toFixed(0)} m${what}　<b class="t">教師</b> なし（入力データの段階）${w}${state.v === "sea" ? seaNote : ""}`;
    }
    if (state.v === "veg") {
      const m = rawComposite(state.mode, lng, lat), t = rawComposite("teacher", lng, lat);
      const shown = state.src === "teacher" ? "teacher" : state.mode;
      let w = "";
      if (sl === 0) {
        const dc = (c) => (c === -1 ? "干上がった海底" : vlab[c]);
        w = state.src === "diff"
          ? (drawnComposite(state.mode, lng, lat) !== m || drawnComposite("teacher", lng, lat) !== t
            ? `<br><span class="w">※この地点の画面の塗りは、境界付近の補間・平均で元データのセルと異なる</span>` : "")
          : warn(dc(drawnComposite(shown, lng, lat)), vlab[shown === "teacher" ? t : m]);
      }
      return `${head}<br><b class="m">${tag}</b> ${vlab[m]}　<b class="t">教師</b> ${vlab[t]}${w}${seaNote}`;
    }
    const m0 = vm(), key = m0.key;
    const mod = cell(`${key}_${state.mode}`, lng, lat), tea = cell(`${key}_teacher`, lng, lat);
    const f = (x) => Number.isFinite(x) ? x.toFixed(m0.digits) : null;
    const iceTxt = (x) => x > ICE_MIN_M ? `${f(x)} m` : "氷なし";
    const mv = state.v === "ice" ? iceTxt(mod) : `${f(mod)} ${m0.unit}`;
    const tv = f(tea) == null ? "教師なし" : state.v === "ice" ? iceTxt(tea) : `${f(tea)} ${m0.unit}`;
    const dv = f(tea) == null ? "" : `　差 ${mod - tea >= 0 ? "+" : ""}${f(mod - tea)}`;
    let w = "";
    if (state.v === "ice" && state.src !== "diff") {
      const which = state.src === "teacher" ? "teacher" : state.mode;
      const ice = (x) => (x > ICE_MIN_M ? "氷" : "氷なし");
      w = warn(ice(bilinear(`H_${which}`, lng, lat)), ice(which === "teacher" ? tea : mod));
    }
    return `${head}<br><b class="m">${tag}</b> ${mv}　<b class="t">教師</b> ${tv}${dv}${w}${seaNote}`;
  }

  return {
    state, apply, legend, readout, createMaterial, renderMercator, isClimate,
    bedMetresAt: (lng, lat) => bilinear("bed", lng, lat),
    rawBed: (lng, lat) => cell("bed", lng, lat),
  };
}
