// v2 stage drawing: the colours and the one colour function that both views
// use. 3D (v1s's Lambert material on the bedrock mesh) and 2D (Web Mercator,
// per pixel) run the SAME GLSL below -- akColour() and akCoast() -- with the
// SAME uniforms object, so the palette, the sea/land line at the current sea
// level, the ice edge and the vegetation classes cannot differ between them.
// Differences between the views are only what each view adds on top: in 3D
// v1s's light and sea sphere, in 2D a flat relief shading and the water tint.
import * as THREE from "three";
import { ICE_MIN_M } from "./stage-data.js";

export const RAMPS = {
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
export const BED_LO = -8000, BED_HI = 6000;
export const AGREE = { same: [70, 170, 90], veg: [215, 70, 60], ice: [120, 150, 220], none: [90, 90, 90], sea: [20, 40, 70] };
export const EXPOSED = [150, 140, 125];      // seabed above a lowered sea: no vegetation estimate exists there
export const SNOW = [212, 214, 222];         // seasonal snow (drawn by its share of the year)
export const SEA_ICE = [150, 198, 224];      // sea ice (the same); land ice keeps the vegetation palette's white
export const SIMPLE_VEG = [
  { codes: [11, 12, 13, 14, 15, 16, 17, 18], ja: "森林", rgb: [36, 122, 65] },
  { codes: [19, 20], ja: "サバンナ・草原", rgb: [100, 170, 70] },
  { codes: [21, 22], ja: "低木地", rgb: [135, 155, 78] },
  { codes: [23], ja: "ツンドラ", rgb: [154, 180, 122] },
  { codes: [24, 25], ja: "砂漠・極地荒原", rgb: [218, 196, 145] },
];
export const simpleVeg = (code) => SIMPLE_VEG.find((g) => g.codes.includes(code));
const WATER = [47, 111, 168];          // v1s's sea colour (0x2f6fa8), for the 2D map
const STAGE_ID = { bed: 0, sea: 1, t2m: 2, hum: 2, precip: 2, ice: 3, veg: 4 };

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

// The colour scale of the selected climate stage (from display.json), shared
// with the legend.
export function colourScale(S, state) {
  const m = S.vars[state.v];
  if (state.src === "diff") return { ramp: "diff", lo: -m.diffRange, hi: m.diffRange, log: false };
  return { ramp: m.ramp, lo: m.lo, hi: m.hi, log: !!m.log };
}

export function createStageDraw(ctx) {
  const { S, F, D, vcol, state, isClimate, vm, scale } = ctx;
  // ------------------------------------------------ textures
  const T = {};
  function floatTex(arr, w, h) {
    const t = new THREE.DataTexture(arr, w, h, THREE.RedFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
  for (const k of Object.keys(S.fields)) T[k] = floatTex(D[k], D[k].meta.w, D[k].meta.h);
  for (const k of ["snow", "seaice"]) T[k] = floatTex(D[k], D[k].meta.w, D[k].meta.h);   // stage-respond.js
  for (const k of ["veg_fit", "veg_holdout", "veg_teacher"]) {
    const t = new THREE.DataTexture(F[k], F[k].meta.w, F[k].meta.h, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
    T[k] = t;
  }
  T.normal = (() => {   // object-space relief normals, for the flat 2D map only
    const f = D.bed.meta, a = D.bed, W = f.w, H = f.h, R = S.bodyRadiusMetres || 6.371e6, RELIEF = 25;
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
    for (const [code, rgb] of Object.entries(vcol)) pal.set([...(state.vegStyle === "simple" ? simpleVeg(Number(code))?.rgb || rgb : rgb), 255], Number(code) * 4);
    T.pal = new THREE.DataTexture(pal, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    T.pal.minFilter = T.pal.magFilter = THREE.NearestFilter; T.pal.generateMipmaps = false; T.pal.needsUpdate = true;
  }

  // Shared uniform objects: the 3D material and the 2D renderer read the same ones.
  const U = {
    akBed: { value: T.bed }, akNrm: { value: T.normal }, akFM: { value: T.T_fit }, akFT: { value: T.T_teacher },
    akHM: { value: T.H_fit }, akHT: { value: T.H_teacher }, akVM: { value: T.veg_fit }, akVT: { value: T.veg_teacher },
    akSN: { value: T.snow }, akSI: { value: T.seaice },
    akRamp: { value: T.ramp }, akPal: { value: T.pal },
    akStage: { value: 0 }, akSrc: { value: 0 }, akRampRow: { value: 0 }, akNRamps: { value: RAMP_ROWS.length },
    akLo: { value: 0 }, akHi: { value: 1 }, akLog: { value: false }, akSeaLevel: { value: 0 }, akVegSimple: { value: false },
    akBedLo: { value: ctx.bedRange[0] }, akBedHi: { value: ctx.bedRange[1] },
  };

  const GLSL = /* glsl */`
uniform sampler2D akBed, akNrm, akFM, akFT, akHM, akHT, akVM, akVT, akRamp, akPal, akSN, akSI;
uniform int akStage, akSrc, akRampRow, akNRamps;
uniform float akLo, akHi, akSeaLevel;
uniform bool akLog, akVegSimple;
uniform float akBedLo, akBedHi;   // the relief colour range: Earth -8000..6000, each other body its own
const float AK_ICE_MIN = ${ICE_MIN_M.toFixed(1)};
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
int akVegGroup(int c) {
  if (c >= 11 && c <= 18) return 11;
  if (c == 19 || c == 20) return 19;
  if (c == 21 || c == 22) return 21;
  if (c == 23) return 23;
  if (c == 24 || c == 25) return 24;
  return c;
}
vec3 akRampC(int row, float x) {
  return texture(akRamp, vec2((clamp(x, 0.0, 1.0) * 255.0 + 0.5) / 256.0, (float(row) + 0.5) / float(akNRamps))).rgb * 255.0;
}
vec3 akRock(float z) { return akRampC(AK_ROCK, (z - akBedLo) / (akBedHi - akBedLo)); }
vec3 akSeaC(float depth) { return akRampC(AK_SEA, 1.0 - min(1.0, -depth / 6000.0)); }
float akNorm(float x) {
  if (akLog) { float l0 = log(max(akLo, 1e-6)); return (log(max(x, akLo)) - l0) / (log(akHi) - l0); }
  return (x - akLo) / (akHi - akLo);
}
// ice > sea (at the current sea level) > vegetation
int akVeg(sampler2D h, sampler2D v, vec2 ll, float z) {
  if (akBil(h, ll) > AK_ICE_MIN) return 1;
  if (z < akSeaLevel) return 0;
  int c = akCls(v, ll);
  return c == 0 ? 255 : c;
}
// seasonal snow over land and sea ice over the sea, by their share of the year
vec3 akSnow(vec3 c, vec2 ll) { return mix(c, vec3(${SNOW.join(",")}), 0.85 * clamp(akBil(akSN, ll), 0.0, 1.0)); }
vec3 akSeaIce(vec3 c, vec2 ll) { return mix(c, vec3(${SEA_ICE.join(",")}), 0.9 * clamp(akBil(akSI, ll), 0.0, 1.0)); }
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
      if (t == 255) return vec3(${AGREE.none.join(",")});
      if ((akVegSimple ? akVegGroup(m) == akVegGroup(t) : m == t)) return vec3(${AGREE.same.join(",")});
      return (m == 1 || t == 1) ? vec3(${AGREE.ice.join(",")}) : vec3(${AGREE.veg.join(",")});
    }
    int k = akSrc == 1 ? akVeg(akHT, akVT, ll, z) : akVeg(akHM, akVM, ll, z);
    relief = sea ? 0.0 : 0.2;
    if (k == 0) return akSrc == 0 ? akSeaIce(akSeaC(z - akSeaLevel), ll) : akSeaC(z - akSeaLevel);
    vec3 v = texelFetch(akPal, ivec2(k, 0), 0).rgb * 255.0;
    return akSrc == 0 && k != 1 ? akSnow(v, ll) : v;
  }
  float m = akBil(akFM, ll), t = akBil(akFT, ll);
  float x = akSrc == 2 ? m - t : akSrc == 0 ? m : t;
  if (akStage == 3) {
    bool show = akSrc == 2 ? abs(x) >= 1.0 : x > AK_ICE_MIN;
    if (show) { relief = 0.15; return akRampC(akRampRow, akNorm(x)); }
    if (akSrc != 0) return sea ? akSeaC(z - akSeaLevel) * 0.8 : akRock(z) * 0.85;
    return sea ? akSeaIce(akSeaC(z - akSeaLevel) * 0.8, ll) : akSnow(akRock(z) * 0.85, ll);
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

  // Earth's input terrain carries today's ice surface. Colour that same
  // geometry solely by its height, with the same rock ramp as the 2D view.
  function createElevationMaterial(metresToRadius) {
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vAkPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAkPos = position;");
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vAkPos;\n" + GLSL)
        .replace("#include <map_fragment>", `#include <map_fragment>
        float z = (length(vAkPos) - 1.0) / ${metresToRadius.toExponential(12)};
        vec3 c = akRock(z) / 255.0;
        diffuseColor.rgb = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));`);
    };
    m.customProgramCacheKey = () => "anti-kytera-elevation";
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
  if (akMode == 0 || akMode == 2) { // photo or elevation-only, both on the input terrain
    z = akBil(akElev, ll);
    if (akMode == 2) c = akRock(z);
    else {
      vec3 lin = texture(akPhoto, vec2((lng + 180.0) / 360.0, (lat + 90.0) / 180.0)).rgb;
      c = mix(lin * 12.92, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, lin)) * 255.0;
    }
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
  function renderMercator(renderer, extent, w, h, { photo, elevationColor, photoTexture, elevation }) {
    U2.akExtent.value.set(extent[0], extent[1], extent[2], extent[3]);
    U2.akMode.value = elevationColor ? 2 : photo ? 0 : 1;
    U2.akOpacity.value = state.opacity;
    if (photo || elevationColor) {
      if (!elevTex || elevTex.userData.src !== elevation.metres) {
        if (elevTex) elevTex.dispose();
        // elevation.js keeps row 0 at the NORTH pole; every stage grid (and
        // akBil) is south-first, so the rows are flipped once here. (PR #15
        // uploaded it unflipped, which put the 2D 標準 water tint upside down.)
        const { width: w0, height: h0, metres } = elevation;
        const flipped = new Float32Array(w0 * h0);
        for (let y = 0; y < h0; y++) flipped.set(metres.subarray((h0 - 1 - y) * w0, (h0 - y) * w0), y * w0);
        elevTex = floatTex(flipped, w0, h0);
        elevTex.userData.src = metres;
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
    U.akVegSimple.value = state.vegStyle === "simple";
    const pal = T.pal.image.data;
    for (const [code, rgb] of Object.entries(vcol)) pal.set([...(state.vegStyle === "simple" ? simpleVeg(Number(code))?.rgb || rgb : rgb), 255], Number(code) * 4);
    T.pal.needsUpdate = true;
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

  // After the condition responder rewrote the fields in place: re-upload them.
  function refreshFields() {
    for (const k of ["T_fit", "E_fit", "P_fit", "H_fit", "veg_fit", "snow", "seaice"]) T[k].needsUpdate = true;
  }

  return { createMaterial, createElevationMaterial, renderMercator, apply, refreshFields };
}
