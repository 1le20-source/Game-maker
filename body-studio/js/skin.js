// Body Studio skin: photoreal skin, eyes, teeth and tongue.
//
// Skin colour is baked per vertex from the params (tone, undertone, age,
// regional blood and melanin, lips, nails, areolae, mouth, blush, makeup)
// into a `color` attribute plus three mask attributes. A patched
// MeshPhysicalMaterial adds what needs pixel detail: pores, fine relief and
// wrinkles as a procedural bump in rest space, freckles, age spots, veins
// and mottling, wrapped colour-shifted diffuse (subsurface scattering) with
// back-light translucency, oily and wet layers, flush and the x-ray shell.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const THREE = window.THREE;

  // ------------------------------------------------------------ GLSL
  const NOISE = `
vec3 skHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}
// gradient noise, roughly -0.7..0.7
float skNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dot(skHash(i), f), dot(skHash(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0)), u.x),
                 mix(dot(skHash(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0)), dot(skHash(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0)), u.x), u.y),
             mix(mix(dot(skHash(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0)), dot(skHash(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0)), u.x),
                 mix(dot(skHash(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0)), dot(skHash(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}
// the same kind of noise with its analytic gradient: (value, d/dx, d/dy, d/dz)
vec4 skNoiseD(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec3 ga = skHash(i), gb = skHash(i + vec3(1.0, 0.0, 0.0)), gc = skHash(i + vec3(0.0, 1.0, 0.0)), gd = skHash(i + vec3(1.0, 1.0, 0.0));
  vec3 ge = skHash(i + vec3(0.0, 0.0, 1.0)), gf = skHash(i + vec3(1.0, 0.0, 1.0)), gg = skHash(i + vec3(0.0, 1.0, 1.0)), gh = skHash(i + vec3(1.0, 1.0, 1.0));
  float va = dot(ga, f), vb = dot(gb, f - vec3(1.0, 0.0, 0.0)), vc = dot(gc, f - vec3(0.0, 1.0, 0.0)), vd = dot(gd, f - vec3(1.0, 1.0, 0.0));
  float ve = dot(ge, f - vec3(0.0, 0.0, 1.0)), vf = dot(gf, f - vec3(1.0, 0.0, 1.0)), vg = dot(gg, f - vec3(0.0, 1.0, 1.0)), vh = dot(gh, f - vec3(1.0, 1.0, 1.0));
  float k1 = vb - va, k2 = vc - va, k3 = ve - va, k4 = va - vb - vc + vd, k5 = va - vc - ve + vg, k6 = va - vb - ve + vf, k7 = -va + vb + vc - vd + ve - vf - vg + vh;
  float v = va + u.x * k1 + u.y * k2 + u.z * k3 + u.x * u.y * k4 + u.y * u.z * k5 + u.z * u.x * k6 + u.x * u.y * u.z * k7;
  vec3 g = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga) + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg)
    + u.z * u.x * (ga - gb - ge + gf) + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
    + du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
  return vec4(v, g);
}`;

  // chunk text with edits applied; warns if three's chunk changed under us
  function chunk(name, edits) {
    let src = THREE.ShaderChunk[name];
    for (const [a, b] of edits) {
      if (!src.includes(a)) console.warn('skin: shader chunk ' + name + ' changed, patch skipped');
      src = src.replace(a, b);
    }
    return src;
  }

  // ---------------------------------------------------- skin material
  const SKIN_UNIFORMS = ['uTime', 'uFlush', 'uWet', 'uXray', 'uPupil', 'uFlushS', 'uWetS', 'uRough', 'uShine', 'uFreckle', 'uVein', 'uAge',
    'uFuzz', 'uDark', 'uMakeup', 'uWrap', 'uScatter', 'uEyeL', 'uEyeR', 'uCanthL', 'uCanthR', 'uMouth', 'uLipZ', 'uFace', 'uEyeRad', 'uDebug'];

  const SKIN_VERT_PARS = `#include <common>
attribute vec3 restPos;
attribute vec4 region;
attribute vec4 region2;
attribute vec4 skinA;
attribute vec4 skinB;
attribute vec4 skinC;
varying vec3 vRest;
varying vec4 vReg;
varying vec4 vReg2;
varying vec4 vSkA;
varying vec4 vSkB;
varying vec4 vSkC;`;

  const SKIN_FRAG_PARS = `#include <common>
uniform float uTime;
uniform float uFlushS;
uniform float uWetS;
uniform float uXray;
uniform float uRough;
uniform float uShine;
uniform float uFreckle;
uniform float uVein;
uniform float uAge;
uniform float uFuzz;
uniform float uDark;
uniform float uMakeup;
uniform vec3 uWrap;
uniform vec3 uScatter;
uniform vec3 uEyeL;
uniform vec3 uEyeR;
uniform vec3 uCanthL;
uniform vec3 uCanthR;
uniform vec3 uMouth;
uniform float uLipZ;
uniform float uFace;
uniform float uEyeRad;
uniform int uDebug;
varying vec3 vRest;
varying vec4 vReg;
varying vec4 vReg2;
varying vec4 vSkA;
varying vec4 vSkB;
varying vec4 vSkC;
float skinSh = 1.0;
float skinThin = 0.0;
vec3 skinN0 = vec3(0.0, 0.0, 1.0);
vec3 skDebug = vec3(0.0);
${NOISE}
// more (b > 0) or less blood under the skin, and more melanin
vec3 skBlood(vec3 c, float b) { return c * pow(vec3(1.0, 0.78, 0.76), vec3(b)); }
vec3 skMel(vec3 c, float m) { return c * pow(vec3(0.72, 0.6, 0.52), vec3(m)); }
// a groove repeating along phase ph (gradient gph); k sets its sharpness
void skGroove(float ph, vec3 gph, float amp, float k, inout float H, inout vec3 G) {
  float fr = fract(ph) - 0.5;
  float e = exp(-fr * fr * k);
  H -= amp * e;
  G += amp * 2.0 * k * fr * e * gph;
}`;

  // wrapped, colour-shifted diffuse: red light travels further under the
  // skin, so the terminator and shadow edges warm up; thin parts glow when lit
  // from behind. Red uses a smoother normal than green and blue.
  const SKIN_DIFFUSE = `
vec3 skinDiffuse(const in IncidentLight L, const in vec3 N, const in vec3 V, const in vec3 albedo) {
  float nl = dot(normalize(N + skinN0), L.direction);
  float nl0 = dot(skinN0, L.direction);
  vec3 w = uWrap;
  vec3 d = clamp((vec3(nl0, nl, nl) + w) / (1.0 + w), 0.0, 1.0);
  float sh = mix(1.0, skinSh, smoothstep(-0.1, 0.3, nl0));
  vec3 sh3 = pow(vec3(sh), vec3(0.7, 0.96, 1.05));
  vec3 lt = normalize(L.direction + N * 0.35);
  float back = skinThin * (0.75 * pow(saturate(dot(V, -lt)), 3.0) + 0.35 * saturate(-nl0));
  return L.color * RECIPROCAL_PI * (d * sh3 * albedo + back * uScatter * sqrt(albedo));
}
`;

  const SKIN_ALBEDO = `#include <color_fragment>
vec3 skP = vRest;
float skFp = max(length(fwidth(skP)), 1e-6); // rest-space size of one pixel (m)
float skCav = 0.0;
// blotchy blood and pigment variation, centimetres across; makeup evens it
float skEven = 1.0 - 0.55 * uMakeup;
float skM1 = skNoise(skP * 31.0) + 0.5 * skNoise(skP * 83.0 + 7.3);
float skM2 = skNoise(skP * 17.0 + 3.1) + 0.5 * skNoise(skP * 140.0 + 1.7);
diffuseColor.rgb = skBlood(diffuseColor.rgb, skM1 * 0.5 * skEven * (1.0 - 0.6 * uDark));
diffuseColor.rgb = skMel(diffuseColor.rgb, skM2 * 0.22 * skEven);
// freckles: clustered spots of two sizes, averaged out once sub-pixel
float skFr = uFreckle * vSkA.y;
if (skFr > 0.004) {
  float cl = smoothstep(-0.3, 0.35, skNoise(skP * 24.0 + 5.0));
  float th = 0.52 - 0.3 * skFr * (0.35 + 0.65 * cl);
  float sp = max(smoothstep(th, th + 0.05, skNoise(skP * 330.0)), 0.8 * smoothstep(th + 0.03, th + 0.08, skNoise(skP * 620.0 + 13.0)));
  sp = mix(0.1 * skFr * (0.35 + 0.65 * cl), sp, 1.0 - smoothstep(0.0006, 0.002, skFp));
  diffuseColor.rgb = skMel(diffuseColor.rgb, sp * (0.55 + 0.8 * skFr) * (0.75 + 0.5 * skNoise(skP * 150.0 + 2.0)));
}
// age spots on sun-exposed skin
float skSpot = smoothstep(0.35, 0.85, uAge) * min(1.0, vSkA.y + 0.25);
if (skSpot > 0.01) {
  float n = skNoise(skP * 95.0 + 31.0) + 0.3 * skNoise(skP * 420.0);
  diffuseColor.rgb = skMel(diffuseColor.rgb, smoothstep(0.36, 0.5, n) * skSpot * 0.8);
}
// veins: a faint blue-green network under thin skin, stretched along the limb
float skV = uVein * vSkA.z * (1.0 - 0.75 * uDark) * (1.0 - 0.4 * uMakeup);
if (skV > 0.004) {
  vec3 ax = vSkC.xyz / max(length(vSkC.xyz), 1e-5);
  vec3 q = skP - ax * dot(skP, ax) * 0.7;
  float vn = skNoise(q * 55.0) + 0.35 * skNoise(q * 140.0 + 4.0);
  float line = (1.0 - smoothstep(0.015, 0.085, abs(vn))) * smoothstep(-0.15, 0.25, skNoise(skP * 18.0 + 9.0));
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.78, 0.88, 1.04), line * skV);
}
// emotional flush and sweat
diffuseColor.rgb = skBlood(diffuseColor.rgb, uFlushS * vSkA.x * 1.7 * (1.0 - 0.45 * uDark));
float skWet = uWetS * clamp(0.3 + 0.7 * vReg.z + 0.3 * vSkA.x, 0.0, 1.0) * smoothstep(-0.35, 0.15, skNoise(skP * 140.0 + 2.0));
diffuseColor.rgb *= 1.0 - 0.12 * skWet;
// the mouth gets darker the deeper it goes
float skMouthO = vReg2.z * (1.0 - exp(-max(uLipZ - skP.z - 0.002, 0.0) / 0.01));
`;

  const SKIN_ROUGH = `#include <roughnessmap_fragment>
roughnessFactor = clamp(uRough + vSkB.x, 0.1, 0.95);
roughnessFactor = mix(roughnessFactor, 0.16, skWet);
`;

  // procedural relief in rest space; gradients are analytic and turned into
  // a screen-space bump, and each layer fades out before it would shimmer
  const SKIN_NORMAL = `#include <normal_fragment_maps>
#if SKIN_Q > 0
{
  float H = 0.0;
  vec3 G = vec3(0.0);
  float rough2 = 0.0;
  float faceK = vReg.z;
  float bare = (1.0 - vReg2.x) * (1.0 - vReg2.z);
  float wA = 0.2 + 0.8 * uAge;
  // pores: shallow pits, most visible on the nose and cheeks
  float ps = mix(0.0011, 0.0008, faceK);
  float pf = 1.0 - smoothstep(ps * 0.3, ps * 0.8, skFp);
  float pd = mix(0.000009, 0.000017, faceK) * (1.0 + 0.6 * uAge) * (1.0 - vReg.x) * bare;
  if (pf > 0.0) {
    vec4 n = skNoiseD(skP / ps);
    float t = clamp((n.x - 0.16) / 0.3, 0.0, 1.0);
    H -= pd * pf * t * t * (3.0 - 2.0 * t);
    G -= pd * pf * (6.0 * t * (1.0 - t) / 0.3) * n.yzw / ps;
  }
  rough2 += (1.0 - pf) * pd / ps * 1.6;
  // fine relief: a network of shallow furrows, coarser on the body
  float fs = mix(0.0026, 0.0017, faceK);
  float ff = 1.0 - smoothstep(fs * 0.2, fs * 0.6, skFp);
  float fa = 0.00002 * (1.0 + 0.8 * uAge) * (1.0 - 0.6 * vReg.x) * bare;
  if (ff > 0.0) {
    vec4 n = skNoiseD(skP / fs + 17.0);
    H += fa * ff * abs(n.x);
    G += fa * ff * sign(n.x) * n.yzw / fs;
  }
  rough2 += (1.0 - ff) * fa / fs * 1.6;
  // soft unevenness
  float mf = 1.0 - smoothstep(0.0012, 0.004, skFp);
  if (mf > 0.0) {
    vec4 n = skNoiseD(skP * 160.0 + 3.0);
    float a = 0.000025 * mf * (1.0 + uAge) * bare;
    H += a * n.x;
    G += a * n.yzw * 160.0;
  }
#if SKIN_Q > 1
  // forehead lines and the frown lines between the brows
  if (vSkB.z > 0.01) {
    vec3 em = 0.5 * (uEyeL + uEyeR);
    float x = skP.x - em.x;
    float sp = 0.0095 * uFace;
    vec4 wn = skNoiseD(skP * 70.0);
    float ph = (skP.y - em.y - 2.5 * x * x / uFace) / sp + 0.55 * wn.x;
    vec3 gph = vec3(-5.0 * x / uFace, 1.0, 0.0) / sp + 0.55 * 70.0 * wn.yzw;
    float brk = smoothstep(-0.25, 0.3, skNoise(vec3(skP.x * 55.0, floor(ph) * 3.1, 2.0)));
    float wf = 1.0 - smoothstep(sp * 0.06, sp * 0.2, skFp);
    skGroove(ph, gph, 0.00022 * vSkB.z * wA * wA * brk * wf, 26.0, H, G);
    float gy = (skP.y - em.y) / uFace;
    float gm = smoothstep(0.004, 0.012, gy) * (1.0 - smoothstep(0.026, 0.038, gy));
    float gx = abs(x) - 0.0052 * uFace;
    float e2 = exp(-gx * gx / 1.6e-6) * gm * vSkB.z * wA * wA * 0.00016 * wf;
    H -= e2;
    G.x += e2 * 2.0 * gx / 1.6e-6 * sign(x);
  }
  // crow's feet fanning from the outer eye corners and arcs under the eyes
  if (vSkB.w > 0.01) {
    for (int s = 0; s < 2; s++) {
      vec3 c = s == 0 ? uCanthL : uCanthR;
      vec3 e = s == 0 ? uEyeL : uEyeR;
      vec3 d = skP - c;
      float lat = d.x * sign(c.x);
      float r = length(d) / uFace;
      float m = smoothstep(0.0, 0.004, lat) * smoothstep(0.002, 0.006, r) * (1.0 - smoothstep(0.013, 0.022, r));
      float wf = 1.0 - smoothstep(0.0003, 0.0009, skFp);
      if (m * wf > 0.0) {
        float hz = max(length(d.xz), 1e-4);
        float th = atan(d.y, hz);
        vec3 gth = vec3(-d.y * d.x / hz, hz, -d.y * d.z / hz) / (hz * hz + d.y * d.y);
        vec4 wn = skNoiseD(skP * 160.0);
        skGroove(th / 0.17 + 0.35 * wn.x, gth / 0.17 + 0.35 * 160.0 * wn.yzw, 0.00011 * m * wf * vSkB.w * wA * wA, 24.0, H, G);
      }
      vec3 d2 = skP - e;
      float r2 = length(d2);
      float rr = (r2 - uEyeRad * 1.3) / (0.0026 * uFace);
      float m2 = smoothstep(-0.25, -0.6, d2.y / r2) * smoothstep(0.0, 0.6, rr) * (1.0 - smoothstep(2.2, 3.6, rr)) * (1.0 - m);
      if (m2 * wf > 0.0) {
        vec4 wn = skNoiseD(skP * 120.0 + 5.0);
        skGroove(rr + 0.3 * wn.x, d2 / (r2 * 0.0026 * uFace) + 0.3 * 120.0 * wn.yzw, 0.00006 * m2 * wf * vSkB.w * wA * wA, 18.0, H, G);
      }
    }
  }
  // fine vertical lines on the lips
  if (vReg.x > 0.05) {
    float ls = 0.0011;
    float lf = 1.0 - smoothstep(ls * 0.15, ls * 0.45, skFp);
    if (lf > 0.0) {
      vec4 wn = skNoiseD(skP * 380.0);
      skGroove((skP.x - uMouth.x) / ls + 0.5 * wn.x, vec3(1.0 / ls, 0.0, 0.0) + 0.5 * 380.0 * wn.yzw, 0.000022 * (0.6 + uAge) * smoothstep(0.3, 0.9, vReg.x) * lf, 10.0, H, G);
    }
  }
  // skin folds across joints: neck rings, knuckles, wrists, elbows, knees
  if (vSkB.y > 0.01) {
    float len = max(length(vSkC.xyz), 1e-4);
    vec3 ax = vSkC.xyz / len;
    float sp = len * 0.01;
    float cf = 1.0 - smoothstep(sp * 0.08, sp * 0.25, skFp);
    if (cf > 0.0) {
      vec4 wn = skNoiseD(skP / (sp * 2.5) + 7.0);
      float wide = smoothstep(0.004, 0.009, sp); // broad soft neck rings vs. fine knuckle creases
      skGroove(dot(skP, ax) / sp + mix(0.4, 0.15, wide) * wn.x, ax / sp + mix(0.4, 0.15, wide) * wn.yzw / (sp * 2.5),
        sp * mix(0.035, 0.012, wide) * vSkB.y * (0.3 + 0.7 * wA) * cf, mix(16.0, 5.0, wide), H, G);
    }
  }
#endif
  vec2 dH = vec2(dot(G, dFdx(skP)), dot(G, dFdy(skP)));
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
  skCav = H;
  // relief too fine to draw still scatters the highlight
  roughnessFactor = min(1.0, sqrt(roughnessFactor * roughnessFactor + rough2 * rough2));
}
#endif
skinN0 = normalize(mix(nonPerturbedNormal, normal, 0.15));
`;

  const SKIN_LAYERS = `#include <lights_physical_fragment>
skinThin = vSkA.w;
#ifdef USE_CLEARCOAT
{
  float oil = saturate(-vSkB.x * 5.0) * (1.0 - vReg.x);
  material.clearcoat = saturate(0.04 + 0.3 * oil * uShine + 0.22 * vReg.x + 0.8 * vReg2.x + 0.9 * vReg2.z + 0.85 * skWet);
  material.clearcoatRoughness = mix(0.34, 0.08, max(skWet, vReg2.x));
}
#endif
#ifdef USE_SHEEN
  material.sheenColor = mix(vec3(1.0), diffuseColor.rgb / max(max3(diffuseColor.rgb), 1e-3), 0.45) * uFuzz * (1.0 - vReg.x) * (1.0 - vReg2.x) * (1.0 - vReg2.z);
  material.sheenRoughness = 0.5;
#endif
`;

  const SKIN_AO = `#include <aomap_fragment>
{
  float ao = vSkC.w * (1.0 - 0.92 * skMouthO) * clamp(1.0 + skCav * 2500.0, 0.6, 1.0);
  float dotNVo = saturate(dot(geometryNormal, geometryViewDir));
  reflectedLight.indirectDiffuse *= ao;
  reflectedLight.indirectSpecular *= computeSpecularOcclusion(dotNVo, ao, material.roughness);
  float aod = mix(1.0, ao, 0.45) * (1.0 - 0.85 * skMouthO);
  reflectedLight.directDiffuse *= aod;
  reflectedLight.directSpecular *= aod;
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect *= ao * ao;
    clearcoatSpecularDirect *= aod;
  #endif
  #ifdef USE_SHEEN
    sheenSpecularIndirect *= ao;
    sheenSpecularDirect *= aod;
  #endif
}
`;

  // x-ray: a faint glassy shell with a cool rim
  const SKIN_XRAY = `#include <opaque_fragment>
if (uXray > 0.001) {
  float ndv = saturate(abs(dot(nonPerturbedNormal, normalize(vViewPosition))));
  float rim = pow(1.0 - ndv, 2.4);
  vec3 ghost = vec3(0.6, 0.78, 1.0) * (0.08 + 1.4 * rim) + gl_FragColor.rgb * 0.25;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, ghost, uXray);
  gl_FragColor.a = mix(1.0, 0.03 + 0.55 * rim, uXray);
}
`;

  const SKIN_DEBUG = `#include <dithering_fragment>
if (uDebug > 0) {
  vec3 dc = vec3(0.0);
  if (uDebug == 1) dc = vec3(vSkA.x);
  else if (uDebug == 2) dc = vec3(vSkA.y);
  else if (uDebug == 3) dc = vec3(vSkA.z);
  else if (uDebug == 4) dc = vec3(vSkA.w);
  else if (uDebug == 5) dc = vec3(0.5 + vSkB.x * 2.0);
  else if (uDebug == 6) dc = vec3(vSkB.y, vSkB.z, vSkB.w);
  else if (uDebug == 7) dc = vec3(vSkC.w);
  else if (uDebug == 8) dc = pow(vColor.rgb, vec3(1.0 / 2.2));
  else if (uDebug == 9) dc = normal * 0.5 + 0.5;
  else if (uDebug == 10) dc = vReg.xyw;
  else if (uDebug == 11) dc = vReg2.xyz;
  else if (uDebug == 12) dc = abs(normalize(vSkC.xyz + 1e-5));
  gl_FragColor = vec4(dc, 1.0);
}
`;
  const DEBUG_MODES = { flush: 1, freckle: 2, vein: 3, thin: 4, rough: 5, wrinkle: 6, ao: 7, albedo: 8, normal: 9, region: 10, region2: 11, axis: 12 };

  BS.makeSkinMaterial = function (human) {
    const n = human.S.nOut, geo = human.bodyGeo;
    const color = new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(0.6), 3);
    geo.setAttribute('color', color);
    geo.setAttribute('skinA', new THREE.Float32BufferAttribute(new Float32Array(n * 4), 4));
    geo.setAttribute('skinB', new THREE.Float32BufferAttribute(new Float32Array(n * 4), 4));
    const c = new Float32Array(n * 4);
    for (let i = 3; i < c.length; i += 4) c[i] = 1;
    geo.setAttribute('skinC', new THREE.Float32BufferAttribute(c, 4));

    const v = (x) => ({ value: x });
    const U = {
      uTime: v(0), uFlush: v(0), uWet: v(0), uXray: v(0), uPupil: v(0.35), uFlushS: v(0), uWetS: v(0),
      uRough: v(0.5), uShine: v(0.4), uFreckle: v(0), uVein: v(0.2), uAge: v(0), uFuzz: v(0.2), uDark: v(0.3), uMakeup: v(0),
      uWrap: v(new THREE.Vector3(0.34, 0.12, 0.08)), uScatter: v(new THREE.Vector3(1.0, 0.28, 0.14)),
      uEyeL: v(new THREE.Vector3()), uEyeR: v(new THREE.Vector3()), uCanthL: v(new THREE.Vector3()), uCanthR: v(new THREE.Vector3()),
      uMouth: v(new THREE.Vector3()), uLipZ: v(0), uFace: v(1), uEyeRad: v(0.0125), uDebug: v(0),
    };
    human.skinUniforms = U;

    const mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.5, metalness: 0, ior: 1.4, clearcoat: 1, clearcoatRoughness: 0.34,
      sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x000000),
    });
    mat.defines = { SKIN_Q: 2 };
    BS.skinned8(mat);
    BS.patch(mat, 'bs-skin', (s) => {
      for (const k of SKIN_UNIFORMS) s.uniforms[k] = U[k];
      s.vertexShader = s.vertexShader
        .replace('#include <common>', SKIN_VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = restPos; vReg = region; vReg2 = region2; vSkA = skinA; vSkB = skinB; vSkC = skinC;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', SKIN_FRAG_PARS)
        .replace('#include <lights_physical_pars_fragment>', SKIN_DIFFUSE + chunk('lights_physical_pars_fragment', [
          ['vec3 irradiance = dotNL * directLight.color;', 'vec3 irradiance = dotNL * directLight.color * skinSh;'],
          ['vec3 ccIrradiance = dotNLcc * directLight.color;', 'vec3 ccIrradiance = dotNLcc * directLight.color * skinSh;'],
          ['reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', 'reflectedLight.directDiffuse += skinDiffuse( directLight, geometryNormal, geometryViewDir, material.diffuseColor );'],
        ]))
        .replace('#include <lights_fragment_begin>', chunk('lights_fragment_begin', [
          ['getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tskinSh = 1.0;'],
          ['directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]', 'skinSh = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]'],
        ]))
        .replace('#include <color_fragment>', SKIN_ALBEDO)
        .replace('#include <roughnessmap_fragment>', SKIN_ROUGH)
        .replace('#include <normal_fragment_maps>', SKIN_NORMAL)
        .replace('#include <lights_physical_fragment>', SKIN_LAYERS)
        .replace('#include <aomap_fragment>', SKIN_AO)
        .replace('#include <opaque_fragment>', SKIN_XRAY)
        .replace('#include <dithering_fragment>', SKIN_DEBUG);
    });
    return mat;
  };

  // ------------------------------------------------- per-vertex baking
  // bone groups for regional masks (anything else is lower trunk)
  const CATS = [
    /^(head|jaw|eye|special0|levator|oris|risorius|temporalis|oculi|orbicularis|tongue)/,
    /^neck/, /^(spine0[12]|breast)/, /^(clavicle|shoulder)/, /^upperarm/, /^lowerarm/, /^(wrist|metacarpal)/, /^finger/,
    /^(upperleg|pelvis\.)/, /^lowerleg/, /^foot/, /^toe/,
  ];
  const NC = CATS.length;
  const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lin = (hex) => new THREE.Color(hex); // three converts sRGB hex to linear

  class SkinBaker {
    constructor(human) {
      this.h = human;
      const n = (this.n = human.S.nOut);
      const D = human.D, { idx, wts } = human.subWeights;
      const map = D.bones.map((b) => CATS.findIndex((re) => re.test(b.name)));
      const W = (this.W = new Float32Array(n * NC));
      for (let i = 0; i < n; i++) for (let k = 0; k < 8; k++) {
        const w = wts[i * 8 + k], c = map[idx[i * 8 + k]];
        if (w && c >= 0) W[i * NC + c] += w;
      }
      // neighbour lists (CSR) for curvature and smoothing
      const tris = human.S.tris, deg = new Uint32Array(n + 1);
      for (let t = 0; t < tris.length; t++) deg[tris[t] + 1] += 2;
      for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
      const nb = new Uint32Array(deg[n]), fill = deg.slice(0, n);
      for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
        const a = tris[t + k], b = tris[t + ((k + 1) % 3)];
        nb[fill[a]++] = b;
        nb[fill[b]++] = a;
      }
      this.nbOff = deg;
      this.nb = nb;
      this.M = new Float32Array(n * 8); // blood, pigment, palm/sole, cheek, liner, shadow, under-eye, exposed
      this.k0 = new Float32Array(n);
      this.k1 = new Float32Array(n);
      this.sig = NaN;
      const g = human.bodyGeo.attributes;
      this.A = g.skinA; this.B = g.skinB; this.C = g.skinC; this.color = g.color;
    }

    // rest-shape fingerprint: geometry masks are only rebuilt when it changes
    signature() {
      const R = this.h.restAttr.array;
      let s = 0;
      for (let i = 0; i < R.length; i += 301) s += R[i] * ((i % 7) + 1);
      return s;
    }

    smoothScalar(src, dst, iters) {
      const { nbOff, nb, n } = this;
      let a = src, b = dst;
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < n; i++) {
          let s = 0;
          const e = nbOff[i + 1];
          for (let k = nbOff[i]; k < e; k++) s += a[nb[k]];
          b[i] = 0.5 * a[i] + 0.5 * s / (e - nbOff[i] || 1);
        }
        const t = a; a = b; b = t;
      }
      if (a !== dst) dst.set(a);
    }

    // landmarks + every mask that depends on the body's shape
    geometry(U) {
      const h = this.h, n = this.n, W = this.W, M = this.M;
      const R = h.restAttr.array, Nr = h.bodyNrm.array;
      const reg = h.bodyGeo.attributes.region.array, reg2 = h.bodyGeo.attributes.region2.array;
      const A = this.A.array, B = this.B.array, C = this.C.array;
      const J = (name, end) => h.joint(name, end);
      const eL = J('eye.L'), eR = J('eye.R');
      const ipd = eL.x - eR.x, fs = ipd / 0.058;
      const eyeY = (eL.y + eR.y) / 2;
      // nose tip, lips and outer eye corners, found on the mesh
      let noseZ = -Infinity, nose = 0, lipZ = -Infinity, lx = 0, ly = 0, lz = 0, ln = 0;
      const canth = [null, null], canX = [0, 0];
      for (let i = 0; i < n; i++) {
        const x = R[i * 3], y = R[i * 3 + 1], z = R[i * 3 + 2];
        if (reg[i * 4 + 2] > 0.5 && Math.abs(x) < 0.15 * ipd && y < eyeY - 0.2 * ipd && y > eyeY - 1.4 * ipd && z > noseZ) { noseZ = z; nose = i; }
        if (reg[i * 4] > 0.5) { lx += x; ly += y; lz += z; ln++; if (z > lipZ) lipZ = z; }
        if (reg[i * 4 + 1] > 0.3 && Math.abs(y - eyeY) < 0.004 * fs) {
          const s = x > 0 ? 0 : 1;
          if (Math.abs(x) > canX[s]) { canX[s] = Math.abs(x); canth[s] = i; }
        }
      }
      const P = (i) => new THREE.Vector3(R[i * 3], R[i * 3 + 1], R[i * 3 + 2]);
      const noseP = P(nose), mouth = new THREE.Vector3(lx / ln, ly / ln, lz / ln);
      const cant = canth.map((i, s) => (i !== null ? P(i) : (s ? eR : eL).clone()));
      const eyeRad = h.eyes ? this.eyeRadius(eL) : 0.0125;
      U.uEyeL.value.copy(eL); U.uEyeR.value.copy(eR);
      U.uCanthL.value.copy(cant[0]); U.uCanthR.value.copy(cant[1]);
      U.uMouth.value.copy(mouth); U.uLipZ.value = lipZ; U.uFace.value = fs; U.uEyeRad.value = eyeRad;
      this.mouth = mouth; this.lipZ = lipZ;

      // limb landmarks per side (0 = left, +X)
      const sides = ['L', 'R'].map((s) => {
        const wr = J('wrist.' + s), mid = J('finger3-1.' + s);
        const along = mid.clone().sub(wr), across = J('finger2-1.' + s).sub(J('finger5-1.' + s));
        const palm = new THREE.Vector3().crossVectors(along, across).normalize();
        if (palm.y > 0) palm.negate(); // A-pose: palms face down and forward
        const knuckles = [];
        for (let f = 2; f <= 5; f++) for (let k = 1; k <= 3; k++) knuckles.push(J(`finger${f}-${k}.${s}`));
        knuckles.push(J('finger1-2.' + s), J('finger1-3.' + s));
        const tips = [];
        for (let f = 1; f <= 5; f++) tips.push(J(`finger${f}-3.${s}`, 'tail'));
        const toes = [];
        for (let f = 1; f <= 5; f++) toes.push(J(`toe${f}-1.${s}`));
        return {
          palm, wrist: wr, knuckles, tips, toes, elbow: J('lowerarm01.' + s), knee: J('lowerleg01.' + s),
          shoulder: J('upperarm01.' + s), temple: J('eye.' + s).add(new THREE.Vector3((s === 'L' ? 1 : -1) * 0.75 * ipd, 0.25 * ipd, -0.5 * ipd)),
          eye: s === 'L' ? eL : eR,
        };
      });
      const neckY = J('neck01').y, chestTop = J('spine01', 'tail').y, chestBot = J('spine02').y;
      const fit = h.fit, main = h.subWeights.idx;
      const g = (d2, r) => Math.exp(-d2 / (r * r));
      const d2 = (x, y, z, p) => (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) + (z - p.z) * (z - p.z);

      for (let i = 0; i < n; i++) {
        const o = i * 3, x = R[o], y = R[o + 1], z = R[o + 2], nx = Nr[o], ny = Nr[o + 1], nz = Nr[o + 2];
        const w = i * NC;
        const head = W[w], neck = W[w + 1], chest = W[w + 2], shoulder = W[w + 3], uarm = W[w + 4], farm = W[w + 5];
        const hand = W[w + 6], finger = W[w + 7], thigh = W[w + 8], shin = W[w + 9], foot = W[w + 10], toe = W[w + 11];
        const lip = reg[i * 4], lid = reg[i * 4 + 1], face = reg[i * 4 + 2], ear = reg[i * 4 + 3];
        const nail = reg2[i * 4], mouthIn = reg2[i * 4 + 2];
        const S = sides[x >= 0 ? 0 : 1], sx = x >= 0 ? 1 : -1;
        const front = Math.max(0, nz);

        // face
        let noseM = 0, cheekM = 0, foreM = 0, eyeM = 0, tzone = 0, chinM = 0, under = 0, liner = 0, shadow = 0, templeM = 0;
        if (head > 0.05) {
          const fy = (y - eyeY) / fs;
          noseM = face * g(d2(x, y, z, noseP), 0.017 * fs);
          // cheek apples, drawn out a little towards the ears
          const cx = (Math.abs(x) - 0.66 * ipd) / fs, cy = fy + 0.032 - 0.25 * cx;
          cheekM = face * g(cx * cx * 0.55 + cy * cy * 1.2, 0.026) * smooth01(0.0, 0.45, nz);
          foreM = face * smooth01(0.006, 0.022, fy) * (1 - smooth01(0.055, 0.085, fy)) * smooth01(0.1, 0.5, nz) * g(x * x, 1.1 * ipd);
          tzone = face * Math.max(foreM * g(x * x, 0.5 * ipd), noseM * 1.1, g(x * x + (y - (mouth.y - 0.035 * fs)) ** 2, 0.016 * fs));
          chinM = face * g(x * x + (y - (mouth.y - 0.04 * fs)) ** 2 + 0.5 * (z - lipZ) ** 2, 0.016 * fs);
          const de = Math.sqrt(d2(x, y, z, S.eye));
          eyeM = face * g(de * de, 0.03 * fs) * (1 - lip);
          // under-eye shadow: a crescent below the lower lid
          under = face * smooth01(eyeRad * 1.05, eyeRad * 1.35, de) * (1 - smooth01(eyeRad * 1.6, eyeRad * 2.1, de)) * smooth01(-0.2, -0.6, (y - S.eye.y) / de) * (1 - lid * 0.5);
          // makeup: liner along the lid margins, shadow on the upper lid
          liner = lid * (1 - smooth01(eyeRad * 1.05, eyeRad * 1.22, de)) * (y > S.eye.y - 0.25 * eyeRad ? 1 : 0.45);
          shadow = Math.max(lid, face * 0.6 * g(de * de, eyeRad * 1.7)) * smooth01(0, 0.5, (y - S.eye.y) / de) * smooth01(eyeRad * 1.02, eyeRad * 1.25, de) * (1 - smooth01(eyeRad * 1.8, eyeRad * 2.3, de));
          templeM = head * g(d2(x, y, z, S.temple), 0.02 * fs) * (1 - ear);
        }
        // limbs
        const handAll = hand + finger;
        const palmDot = nx * S.palm.x + ny * S.palm.y + nz * S.palm.z;
        let knuck = 0, tip = 0, crease = 0, spacing = 1;
        if (handAll > 0.05) {
          for (const k of S.knuckles) knuck = Math.max(knuck, g(d2(x, y, z, k), 0.0075));
          for (const k of S.tips) tip = Math.max(tip, g(d2(x, y, z, k), 0.011));
        }
        const volar = smooth01(-0.1, 0.5, palmDot), dorsal = smooth01(-0.1, 0.5, -palmDot);
        const palmM = handAll * volar;
        const sole = (foot + toe) * smooth01(-0.25, -0.75, ny);
        const kneeD = d2(x, y, z, S.knee), elbowD = d2(x, y, z, S.elbow);
        const kneeM = (thigh + shin) * g(kneeD, 0.075) * smooth01(0.2, 0.75, nz);
        const elbowM = (uarm + farm) * g(elbowD, 0.06) * smooth01(0.0, 0.6, -nz + 0.3 * ny);
        let toeK = 0;
        if (toe + foot > 0.05) for (const k of S.toes) toeK = Math.max(toeK, g(d2(x, y, z, k), 0.012));
        const wristD = d2(x, y, z, S.wrist);
        const armpit = (shoulder + uarm + chest) * g(d2(x, y, z, S.shoulder) , 0.07) * smooth01(0.1, 0.6, -ny);
        const exposed = Math.min(1, head * face + neck * 0.6 + handAll + farm * 0.7 + foot * 0.3);

        // folds across joints: [amplitude, spacing in cm]
        const fold = (amp, cm) => { if (amp > crease) { crease = amp; spacing = cm; } };
        fold(neck * (1 - head) * 0.6 * smooth01(0.2, 0.7, nz), 1.25 * fs);
        fold(knuck * finger * dorsal * 1.0, 0.13);
        fold(knuck * finger * volar * 0.7, 0.09);
        fold(handAll * volar * g(wristD, 0.02) * 0.6, 0.3);
        fold(elbowM * 0.6, 0.32);
        fold(kneeM * 0.35, 0.45);
        fold(toeK * toe * 0.7, 0.12);
        const mb = main[i * 8], ax = fit[mb].y;

        // pigment and blood masks for the colour pass
        const blood = 0.55 * ear + 0.4 * noseM + 0.2 * cheekM + 0.22 * lid + 0.14 * handAll + 0.28 * tip * handAll
          + 0.16 * (foot + toe) + 0.25 * toeK * toe + 0.35 * kneeM + 0.3 * elbowM + 0.4 * knuck * dorsal * handAll + 0.12 * chinM
          + 0.08 * neck * front + 0.05 * exposed;
        const pigment = 0.35 * kneeM + 0.45 * elbowM + 0.6 * knuck * dorsal * handAll + 0.3 * lid + 0.25 * armpit + 0.25 * toeK * toe * (1 - sole);
        M[i * 8] = Math.min(1.2, blood);
        M[i * 8 + 1] = pigment;
        M[i * 8 + 2] = Math.max(palmM * (1 - nail), sole);
        M[i * 8 + 3] = cheekM;
        M[i * 8 + 4] = Math.min(1, liner * 1.3);
        M[i * 8 + 5] = shadow;
        M[i * 8 + 6] = under;
        M[i * 8 + 7] = exposed;

        // shader masks
        const q = i * 4;
        A[q] = Math.min(1, cheekM * 1.1 + 0.8 * ear + 0.7 * noseM + 0.3 * foreM + 0.25 * chinM + 0.45 * neck * front
          + 0.35 * chest * front * smooth01(chestBot, chestTop, y));
        A[q + 1] = Math.min(1, face * (0.3 + 0.7 * Math.max(noseM * 1.3, cheekM * 1.2)) + 0.9 * shoulder + 0.5 * chest * smooth01(chestBot, chestTop, y)
          + 0.6 * uarm + 0.45 * farm * (0.4 + 0.6 * dorsal) + 0.3 * handAll * dorsal);
        A[q + 2] = Math.min(1, farm * volar * 0.9 + handAll * dorsal * 0.7 * (1 - knuck) + uarm * 0.5 * smooth01(0, 0.6, -nx * sx)
          + templeM * 0.7 + foot * smooth01(0.2, 0.7, ny) * 0.5 + chest * front * 0.25 + neck * 0.2 + thigh * 0.15 * smooth01(0, 0.6, -nx * sx));
        A[q + 3] = Math.min(1, ear + 0.6 * finger + 0.2 * hand + 0.3 * toe + 0.6 * noseM * smooth01(0.0, -0.6, ny + 0.3) + 0.4 * lid + 0.15 * lip);
        B[q] = -0.08 * tzone - 0.13 * lip - 0.32 * nail - 0.38 * mouthIn - 0.04 * lid - 0.25 * liner + 0.12 * (elbowM + kneeM) + 0.07 * palmM + 0.12 * sole
          + 0.05 * (1 - face) * (1 - lip);
        B[q + 1] = crease;
        B[q + 2] = foreM;
        B[q + 3] = eyeM;
        C[q] = ax[0] * spacing; C[q + 1] = ax[1] * spacing; C[q + 2] = ax[2] * spacing;
      }
      this.ambientOcclusion(R, Nr, C);
      this.A.needsUpdate = this.B.needsUpdate = this.C.needsUpdate = true;
    }

    // eyeball radius from the eye mesh (sclera layer, rest pose)
    eyeRadius(c) {
      const E = this.h.D.eye, P = this.h.P, g = this.h.ground;
      let s = 0, k = 0;
      for (let v = 0; v < E.nVerts; v += 7) {
        let x = 0, y = 0, z = 0;
        for (let r = 0; r < 3; r++) { const ref = E.refs[v * 3 + r], w = E.w[v * 3 + r]; x += w * P[ref * 3]; y += w * P[ref * 3 + 1]; z += w * P[ref * 3 + 2]; }
        x = (x + E.off[v * 3]) * BS.SCALE; y = (y + E.off[v * 3 + 1]) * BS.SCALE - g; z = (z + E.off[v * 3 + 2]) * BS.SCALE;
        if (x <= 0) continue;
        s += Math.hypot(x - c.x, y - c.y, z - c.z); k++;
      }
      return k ? s / k : 0.0125;
    }

    // cavity occlusion from mesh curvature at two scales: creases, nostrils,
    // ears, between fingers and toes, armpits and folds get darker
    ambientOcclusion(R, Nr, C) {
      const { n, nbOff, nb, k0, k1 } = this;
      for (let i = 0; i < n; i++) {
        let mx = 0, my = 0, mz = 0, el = 0;
        const s = nbOff[i], e = nbOff[i + 1], c = e - s || 1;
        const x = R[i * 3], y = R[i * 3 + 1], z = R[i * 3 + 2];
        for (let k = s; k < e; k++) {
          const j = nb[k] * 3;
          mx += R[j]; my += R[j + 1]; mz += R[j + 2];
          el += Math.hypot(R[j] - x, R[j + 1] - y, R[j + 2] - z);
        }
        const dx = mx / c - x, dy = my / c - y, dz = mz / c - z;
        k0[i] = (dx * Nr[i * 3] + dy * Nr[i * 3 + 1] + dz * Nr[i * 3 + 2]) / (el / c || 1);
      }
      this.smoothScalar(k0, k1, 3);
      const fine = Float32Array.from(k1);
      this.smoothScalar(k1, k0, 14);
      for (let i = 0; i < n; i++) {
        const ao = 1 - 3.2 * Math.max(0, fine[i] - 0.025) - 3.5 * Math.max(0, k0[i] - 0.015);
        C[i * 4 + 3] = Math.max(0.3, Math.min(1, ao));
      }
    }

    // albedo from params + masks (cheap: runs on every param change)
    colors(p, U) {
      const n = this.n, M = this.M, col = this.color.array;
      const reg = this.h.bodyGeo.attributes.region.array, reg2 = this.h.bodyGeo.attributes.region2.array;
      const tones = BS.SKIN_TONES.map(lin);
      const toneAt = (t) => {
        const f = Math.min(0.9999, Math.max(0, t)) * (tones.length - 1), i = Math.floor(f);
        return tones[i].clone().lerp(tones[i + 1], f - i);
      };
      const tone = p.skinTone ?? 0.35, under = p.undertone ?? 0.5, ageN = Math.min(1, Math.max(0, ((p.age ?? 28) - 22) / 60));
      const dark = smooth01(0.25, 0.85, tone), fair = 1 - dark;
      const blush = p.blush ?? 0.25, makeup = p.makeup ?? 0, lipC = p.lipColor ?? 0.35;
      // base albedo: the table is "how skin looks", albedo is a bit deeper
      const base = toneAt(tone).multiplyScalar(0.78);
      const bl0 = 0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b;
      base.lerp(new THREE.Color(bl0, bl0, bl0), 0.25); // lit skin and ACES add saturation back
      const k = (under - 0.5) * 2;
      base.r *= 1 + 0.02 * k; base.g *= 1 - 0.035 * Math.max(0, -k); base.b *= 1 - 0.1 * k;
      base.r *= 1 - 0.05 * ageN; base.b *= 1 - 0.1 * ageN; // sallower with age
      const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      const L = lum(base);
      const palm = toneAt(tone * 0.38).multiplyScalar(0.8);
      palm.g *= 0.92; palm.b *= 0.9;
      // lips: pale pink -> deep rose, scaled to the skin's depth
      const lipRef = lin('#c98a82').lerp(lin('#983848'), lipC);
      const lipCol = lipRef.multiplyScalar(Math.pow(L / 0.36, 0.75)).lerp(base.clone().multiply(new THREE.Color(0.78, 0.55, 0.6)), 0.45 * dark);
      lipCol.lerp(base, 0.25 * ageN).lerp(lin('#9e2c3e').multiplyScalar(0.8 + 0.4 * fair), 0.45 * makeup);
      const areola = base.clone().multiply(new THREE.Color(0.66, 0.46, 0.44)).lerp(lin('#b87a70').multiplyScalar(Math.pow(L / 0.36, 0.8)), 0.3);
      const nailCol = lin('#efc9c0').lerp(base, 0.25).multiplyScalar(0.85);
      const mouthCol = lin('#7c2a30');
      const liner = lin('#231815'), lidShadow = lin('#7d5c50').lerp(base, 0.3);
      const bloodT = [1, 0.74, 0.72], melT = [0.66, 0.55, 0.48];
      const bv = 0.4 + 0.6 * fair; // blood shows less through dark skin
      for (let i = 0; i < n; i++) {
        const m = i * 8;
        let r = base.r, g = base.g, b = base.b;
        const bl = Math.min(1.4, M[m] * bv + (blush * (0.6 + 0.4 * fair) + 0.3 * makeup) * M[m + 3] * 0.9 + M[m + 7] * 0.04 * ageN);
        r *= 1 - bl * (1 - bloodT[0]); g *= 1 - bl * (1 - bloodT[1]); b *= 1 - bl * (1 - bloodT[2]);
        const mel = M[m + 1] * (0.15 + 0.85 * dark) + M[m + 6] * (0.25 + 0.5 * dark) + M[m + 7] * 0.05;
        r *= 1 - mel * (1 - melT[0]); g *= 1 - mel * (1 - melT[1]); b *= 1 - mel * (1 - melT[2]);
        if (M[m + 6] > 0) { const u = M[m + 6] * 0.35 * fair; g *= 1 - 0.05 * u; b *= 1 + 0.08 * u; }
        const pm = M[m + 2] * (0.25 + 0.6 * dark);
        r += (palm.r - r) * pm; g += (palm.g - g) * pm; b += (palm.b - b) * pm;
        const li = smooth01(0.15, 0.85, reg[i * 4]);
        r += (lipCol.r - r) * li; g += (lipCol.g - g) * li; b += (lipCol.b - b) * li;
        const ar = smooth01(0.1, 0.7, reg2[i * 4 + 1]);
        r += (areola.r - r) * ar; g += (areola.g - g) * ar; b += (areola.b - b) * ar;
        const na = smooth01(0.2, 0.8, reg2[i * 4]);
        r += (nailCol.r - r) * na; g += (nailCol.g - g) * na; b += (nailCol.b - b) * na;
        const mo = smooth01(0.0, 0.6, reg2[i * 4 + 2]);
        r += (mouthCol.r - r) * mo; g += (mouthCol.g - g) * mo; b += (mouthCol.b - b) * mo;
        if (makeup > 0) {
          const sh = M[m + 5] * makeup * 0.55;
          r += (lidShadow.r - r) * sh; g += (lidShadow.g - g) * sh; b += (lidShadow.b - b) * sh;
          const ln = M[m + 4] * makeup * 0.9;
          r += (liner.r - r) * ln; g += (liner.g - g) * ln; b += (liner.b - b) * ln;
        }
        col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      }
      this.color.needsUpdate = true;

      U.uDark.value = dark;
      U.uShine.value = p.skinShine ?? 0.4;
      U.uRough.value = 0.64 - 0.22 * (p.skinShine ?? 0.4) + 0.05 * ageN;
      U.uFreckle.value = p.freckles ?? 0;
      U.uVein.value = (p.veins ?? 0.2) * (1 + 0.6 * ageN);
      U.uAge.value = ageN;
      U.uFuzz.value = 0.12 + 0.3 * (p.bodyHair ?? 0.15);
      U.uMakeup.value = makeup;
      // scattering looks warmer and reaches less far through darker skin
      U.uWrap.value.set(0.36 - 0.1 * dark, 0.13 - 0.03 * dark, 0.08 - 0.02 * dark);
      U.uScatter.value.set(1.0, 0.3 + 0.05 * dark, 0.16).multiplyScalar(1.1 - 0.5 * dark);
    }

    update(p, U) {
      const sig = this.signature();
      if (sig !== this.sig) { this.sig = sig; this.geometry(U); }
      this.colors(p, U);
    }
  }

  // ------------------------------------------------------------- eyes
  // MakeHuman's high-poly eye: one texture for both eyes; the iris discs sit
  // at these UVs (measured from the mesh), the cornea shell maps to a small
  // island near (0.93, 0.07) and is drawn as a separate glossy layer.
  const IRIS = { L: [0.2939, 0.2987], R: [0.7052, 0.6999] };
  const IRIS_R = 0.088; // iris radius in UV (the recessed disc ends at 0.067)
  const PUPIL0 = 0.36; // pupil radius the texture is painted for (x iris radius)

  const EYE_PARS = `#include <common>
uniform vec2 uIrisL;
uniform vec2 uIrisR;
uniform float uIrisRad;
uniform float uPupilS;
uniform vec3 uEyeCL;
uniform vec3 uEyeCR;
uniform vec3 uHeadUp;
uniform vec3 uHeadSide;
uniform float uEyeRad;
uniform float uXray;
varying vec3 vEyeW;
// darkening under the lids: the upper lid and lashes shade the eyeball
float eyeAO() {
  vec3 c = distance(vEyeW, uEyeCL) < distance(vEyeW, uEyeCR) ? uEyeCL : uEyeCR;
  vec3 d = (vEyeW - c) / uEyeRad;
  float up = dot(d, uHeadUp), side = abs(dot(d, uHeadSide));
  return (1.0 - 0.7 * smoothstep(0.02, 0.42, up) - 0.3 * smoothstep(0.2, 0.6, -up)) * (1.0 - 0.4 * smoothstep(0.5, 0.92, side));
}`;

  const EYE_MAP = `#ifdef USE_MAP
  vec2 euv = vMapUv;
  vec2 ic = distance(euv, uIrisL) < distance(euv, uIrisR) ? uIrisL : uIrisR;
  vec2 dv = euv - ic;
  float er = length(dv);
  float pr = uIrisRad * mix(0.2, 0.62, uPupilS);
  float p0 = uIrisRad * ${PUPIL0.toFixed(3)};
  if (er < uIrisRad) {
    // the stroma stretches and folds as the pupil opens and closes
    float rr = er <= pr ? 0.0 : p0 + (er - pr) * (uIrisRad - p0) / (uIrisRad - pr);
    euv = ic + dv / max(er, 1e-6) * rr;
  }
  vec4 sampledDiffuseColor = texture2D( map, euv );
  float ruff = exp(-pow((er - pr) / (uIrisRad * 0.035), 2.0));
  sampledDiffuseColor.rgb *= 1.0 - 0.45 * ruff;
  sampledDiffuseColor.rgb = mix(vec3(0.004, 0.003, 0.003), sampledDiffuseColor.rgb, smoothstep(pr - uIrisRad * 0.03, pr + uIrisRad * 0.02, er));
  diffuseColor *= sampledDiffuseColor;
#endif`;

  const EYE_UNIFORMS = ['uIrisL', 'uIrisR', 'uIrisRad', 'uPupilS', 'uEyeCL', 'uEyeCR', 'uHeadUp', 'uHeadSide', 'uEyeRad', 'uXray'];
  function eyeUniforms() {
    return {
      uIrisL: { value: new THREE.Vector2(...IRIS.L) }, uIrisR: { value: new THREE.Vector2(...IRIS.R) }, uIrisRad: { value: IRIS_R },
      uPupilS: { value: 0.35 }, uEyeCL: { value: new THREE.Vector3() }, uEyeCR: { value: new THREE.Vector3() },
      uHeadUp: { value: new THREE.Vector3(0, 1, 0) }, uHeadSide: { value: new THREE.Vector3(1, 0, 0) }, uEyeRad: { value: 0.0125 }, uXray: { value: 0 },
    };
  }
  function eyeVertex(s) {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEyeW;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvEyeW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
  }

  BS.makeEyeMaterial = function () {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const EU = eyeUniforms();
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, ior: 1.4, specularIntensity: 0.5 });
    mat.userData.eye = { canvas, tex, uniforms: EU, key: '' };
    BS.skinned8(mat);
    BS.patch(mat, 'bs-eye', (s) => {
      for (const k of EYE_UNIFORMS) s.uniforms[k] = EU[k];
      eyeVertex(s);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', EYE_PARS)
        .replace('#include <map_fragment>', EYE_MAP)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
{
  float ao = eyeAO();
  reflectedLight.indirectDiffuse *= ao;
  reflectedLight.indirectSpecular *= ao;
  reflectedLight.directDiffuse *= mix(1.0, ao, 0.75);
  reflectedLight.directSpecular *= ao;
}`)
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = mix(1.0, 0.25, uXray);');
    });
    return mat;
  };

  // the cornea and tear film: reflection only, added over the eyeball
  function makeCorneaMaterial(EU) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x000000, roughness: 0.07, ior: 1.376, envMapIntensity: 3.5, transparent: true, depthWrite: false, premultipliedAlpha: true,
    });
    BS.skinned8(mat);
    BS.patch(mat, 'bs-cornea', (s) => {
      for (const k of EYE_UNIFORMS) s.uniforms[k] = EU[k];
      eyeVertex(s);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', EYE_PARS)
        .replace('#include <premultiplied_alpha_fragment>', '')
        .replace('#include <opaque_fragment>', `float cao = eyeAO();
gl_FragColor = vec4( outgoingLight * cao * cao * (1.0 - 0.7 * uXray), 0.0 );`);
    });
    return mat;
  }

  // ---- procedural eye texture (sRGB canvas)
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const h = (a, b, c) => hash(a * 15.73 + b * 71.37 + c * 197.3);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w) * 2 - 1;
  }
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function srgb(hex) { const v = parseInt(hex.slice(1), 16); return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }

  function paintEyes(canvas, cols, age) {
    const S = canvas.width, ctx = canvas.getContext('2d', { willReadFrequently: true });
    const old = Math.min(1, Math.max(0, (age - 45) / 40));
    // sclera: warm white, pinker and veinier towards the corners
    ctx.fillStyle = '#d8c2b8';
    ctx.fillRect(0, 0, S, S);
    const eyes = [[IRIS.L, cols[0], 11], [IRIS.R, cols[1], 29]];
    for (const [[u, v], , seed] of eyes) {
      const cx = u * S, cy = (1 - v) * S;
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.3 * S);
      const white = old > 0 ? `rgb(${236 - 6 * old},${228 - 8 * old},${214 - 26 * old})` : 'rgb(236,229,222)';
      gr.addColorStop(0, white);
      gr.addColorStop(0.42, white);
      gr.addColorStop(0.7, 'rgb(230,212,204)');
      gr.addColorStop(1, 'rgb(214,178,168)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(cx, cy, 0.3 * S, 0, Math.PI * 2); ctx.fill();
      // blood vessels creeping in from the edges
      const rnd = rng(seed * 977);
      ctx.lineCap = 'round';
      const vessel = (x, y, ang, len, wdt, depth) => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < len; k++) {
          ang += (rnd() - 0.5) * 0.6;
          x += Math.cos(ang) * S * 0.006; y += Math.sin(ang) * S * 0.006;
          ctx.lineTo(x, y);
          if (depth < 2 && rnd() < 0.08) vessel(x, y, ang + (rnd() - 0.5) * 1.8, len * 0.5, wdt * 0.6, depth + 1);
          if (Math.hypot(x - cx, y - cy) < S * 0.115) break;
        }
        ctx.lineWidth = wdt;
        ctx.strokeStyle = `rgba(${160 + rnd() * 40 | 0},${40 + rnd() * 25 | 0},${45 + rnd() * 20 | 0},${0.1 + 0.18 * rnd()})`;
        ctx.stroke();
      };
      for (let k = 0; k < 30; k++) {
        const a = (k % 2 ? 0 : Math.PI) + (rnd() - 0.5) * 1.3, r0 = S * (0.22 + 0.06 * rnd());
        vessel(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, a + Math.PI + (rnd() - 0.5) * 0.7, 10 + rnd() * 16, S * (0.0008 + 0.0012 * rnd()), 0);
      }
      // pink caruncle side towards the nose
      const nx = cx + (u < 0.5 ? -1 : 1) * 0.2 * S;
      const pk = ctx.createRadialGradient(nx, cy, 0, nx, cy, 0.09 * S);
      pk.addColorStop(0, 'rgba(214,128,124,0.55)');
      pk.addColorStop(1, 'rgba(214,128,124,0)');
      ctx.fillStyle = pk;
      ctx.fillRect(nx - 0.1 * S, cy - 0.1 * S, 0.2 * S, 0.2 * S);
    }
    // irises, per pixel
    for (const [[u, v], hex, seed] of eyes) {
      const cx = u * S, cy = (1 - v) * S, R = IRIS_R * S, box = Math.ceil(R * 1.2);
      const x0 = Math.floor(cx - box), y0 = Math.floor(cy - box), wpx = box * 2;
      const img = ctx.getImageData(x0, y0, wpx, wpx), d = img.data;
      const base = srgb(hex);
      const lumB = 0.3 * base[0] + 0.59 * base[1] + 0.11 * base[2];
      const light = lumB > 0.3 || base[2] > base[0]; // blue/grey/green irises show more fibre detail
      const fibre = light ? 0.55 : 0.32;
      // pupillary zone: golden-brown halo in lighter eyes, deeper tone in dark ones
      const inner = light ? [0.55, 0.38, 0.18] : base.map((c) => c * 0.7);
      const innerAmt = light ? (base[2] > base[0] ? 0.35 : 0.6) : 0.5;
      const ridge = base.map((c) => Math.min(1, c * 1.35 + 0.12));
      const limbal = base.map((c) => c * 0.22);
      const o = seed * 3.7;
      for (let py = 0; py < wpx; py++) for (let px = 0; px < wpx; px++) {
        const dx = x0 + px + 0.5 - cx, dy = y0 + py + 0.5 - cy;
        const rn = Math.hypot(dx, dy) / R;
        if (rn > 1.18) continue;
        const ca = dx / (rn * R || 1), sa = dy / (rn * R || 1);
        const f1 = vnoise(ca * 34 + o, sa * 34, rn * 3.5);
        const f2 = vnoise(ca * 95 + o, sa * 95, rn * 7);
        const f3 = vnoise(ca * 9 + o, sa * 9, rn * 2.2);
        const coll = 0.56 + 0.06 * vnoise(ca * 4 + o, sa * 4, 1.7);
        let c0 = base[0], c1 = base[1], c2 = base[2];
        // fibres: light radial strands over a darker stroma
        const b = 1 + fibre * (0.75 * f1 + 0.45 * f2) + 0.12 * f3;
        c0 *= b; c1 *= b; c2 *= b;
        const inn = innerAmt * smooth01(coll + 0.05, coll - 0.06, rn);
        c0 += (inner[0] - c0) * inn; c1 += (inner[1] - c1) * inn; c2 += (inner[2] - c2) * inn;
        const rg = Math.exp(-(((rn - coll) / 0.045) ** 2)) * (0.45 + 0.3 * f1);
        c0 += (ridge[0] - c0) * rg; c1 += (ridge[1] - c1) * rg; c2 += (ridge[2] - c2) * rg;
        // crypts just outside the collarette, contraction furrows further out
        const cr = smooth01(0.35, 0.6, vnoise(ca * 13 + o, sa * 13, rn * 6)) * Math.exp(-(((rn - coll - 0.12) / 0.1) ** 2));
        const fur = Math.max(Math.exp(-(((rn - 0.76) / 0.012) ** 2)), Math.exp(-(((rn - 0.86) / 0.01) ** 2))) * smooth01(-0.1, 0.4, f3);
        const dk = 1 - 0.55 * cr - 0.25 * fur;
        c0 *= dk; c1 *= dk; c2 *= dk;
        // dark limbal ring, then a soft blend into the sclera
        const lm = smooth01(0.74, 0.97, rn) * (0.85 - 0.15 * f2);
        c0 += (limbal[0] - c0) * lm; c1 += (limbal[1] - c1) * lm; c2 += (limbal[2] - c2) * lm;
        if (old > 0) { const ar = old * 0.5 * Math.exp(-(((rn - 0.96) / 0.05) ** 2)); c0 += (0.82 - c0) * ar; c1 += (0.8 - c1) * ar; c2 += (0.76 - c2) * ar; }
        if (rn < PUPIL0 * 0.9) { c0 = 0.02; c1 = 0.02; c2 = 0.02; }
        const a = 1 - smooth01(0.98, 1.16, rn);
        const q = (py * wpx + px) * 4;
        d[q] += (Math.min(1, c0) * 255 - d[q]) * a;
        d[q + 1] += (Math.min(1, c1) * 255 - d[q + 1]) * a;
        d[q + 2] += (Math.min(1, c2) * 255 - d[q + 2]) * a;
      }
      ctx.putImageData(img, x0, y0);
    }
  }

  function eyeColors(p) {
    const C = BS.EYE_COLORS;
    const main = p.eyeColorHex || C[p.eyeColor] || C.Brown;
    let second = main;
    const het = p.heterochromia;
    if (typeof het === 'string' && (C[het] || /^#[0-9a-f]{6}$/i.test(het))) second = C[het] || het;
    else if (het) { const [r, , b] = srgb(main); second = b > r ? C.Amber : C.Blue; }
    return [main, second];
  }

  // ---------------------------------------------------- teeth, tongue
  // Both live deep in the mouth: occlusion grows with depth behind the lips
  // so they never glow, and the shadow map adds the lips' shadow.
  function makeMouthMaterial(kind, MU) {
    const teeth = kind === 'teeth';
    const mat = new THREE.MeshPhysicalMaterial(teeth
      ? { color: 0xe9dfcf, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.12, ior: 1.55, sheen: 0.4, sheenColor: new THREE.Color(0xb8c4d8), sheenRoughness: 0.35 }
      : { color: 0xb2585e, roughness: 0.55, clearcoat: 0.75, clearcoatRoughness: 0.22, sheen: 0.6, sheenColor: new THREE.Color(0xf2b8b8), sheenRoughness: 0.45 });
    BS.skinned8(mat);
    BS.patch(mat, 'bs-' + kind, (s) => {
      Object.assign(s.uniforms, MU);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vMouthRest;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMouthRest = position;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uMouthC;
uniform float uLipZ;
uniform float uXray;
varying vec3 vMouthRest;
${NOISE}`)
        .replace('#include <color_fragment>', teeth ? `#include <color_fragment>
{
  // enamel: greyer, more translucent biting edges, warmer towards the gums
  float ey = abs(vMouthRest.y - uMouthC.y);
  diffuseColor.rgb *= mix(vec3(0.86, 0.9, 0.96), vec3(1.0), smoothstep(0.0, 0.004, ey));
  diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.92, 0.8), smoothstep(0.006, 0.012, ey));
  diffuseColor.rgb *= 0.92 + 0.08 * skNoise(vMouthRest * 900.0);
}` : `#include <color_fragment>
diffuseColor.rgb *= 0.88 + 0.12 * skNoise(vMouthRest * 1400.0) + 0.06 * skNoise(vMouthRest * 300.0);`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
{
  float depth = uLipZ - vMouthRest.z;
  float side = abs(vMouthRest.x - uMouthC.x);
  float ao = exp(-max(depth - ${teeth ? '0.004' : '0.006'}, 0.0) / ${teeth ? '0.011' : '0.012'}) * (1.0 - 0.6 * smoothstep(0.012, 0.03, side));
  ao = mix(0.05, 1.0, ao);
  reflectedLight.indirectDiffuse *= ao;
  reflectedLight.indirectSpecular *= ao;
  reflectedLight.directDiffuse *= ao;
  reflectedLight.directSpecular *= ao;
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect *= ao;
    clearcoatSpecularDirect *= ao;
  #endif
  #ifdef USE_SHEEN
    sheenSpecularIndirect *= ao;
    sheenSpecularDirect *= ao;
  #endif
}`)
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = mix(1.0, 0.0, uXray);');
    });
    return mat;
  }

  // ------------------------------------------------------------ module
  class SkinModule {
    constructor(app) {
      const h = (this.human = app.human);
      this.app = app;
      this.U = h.skinUniforms;
      const q = app.query;
      const qual = app.quality === 'low' ? 0 : app.quality === 'medium' ? 1 : 2;
      this.ghost = [];
      if (this.U && h.skinMat.defines && 'SKIN_Q' in h.skinMat.defines) {
        h.skinMat.defines.SKIN_Q = qual;
        if (qual === 0) { h.skinMat.sheen = 0; h.skinMat.clearcoat = 0; }
        h.skinMat.needsUpdate = true;
        this.baker = new SkinBaker(h);
        this.ghost.push(h.skinMat);
      } else {
        this.U = h.skinUniforms = h.skinUniforms || { uFlush: { value: 0 }, uWet: { value: 0 }, uXray: { value: 0 }, uTime: { value: 0 }, uPupil: { value: 0.45 } };
      }
      this._setupEyes(qual);
      // mouth parts
      this.MU = { uMouthC: { value: new THREE.Vector3() }, uLipZ: { value: 0 }, uXray: this.U.uXray };
      for (const [part, kind] of [[h.teeth, 'teeth'], [h.tongue, 'tongue']]) {
        if (!part) continue;
        part.mesh.material = makeMouthMaterial(kind, this.MU);
        part.mesh.receiveShadow = true;
        this.ghost.push(part.mesh.material);
      }
      // dev params: ?xray=1 &flush= &wet= &pupil= &skindebug=flush|freckle|vein|thin|rough|wrinkle|ao|albedo|normal|region|region2|axis
      for (const k of ['xray', 'flush', 'wet', 'pupil']) {
        if (q.get(k) !== null) this.U['u' + k[0].toUpperCase() + k.slice(1)].value = parseFloat(q.get(k)) || 0;
      }
      if (this.U.uDebug && q.get('skindebug')) this.U.uDebug.value = DEBUG_MODES[q.get('skindebug')] || 0;
      if (this.U.uFlushS) { this.U.uFlushS.value = this.U.uFlush.value; this.U.uWetS.value = this.U.uWet.value; }
      this.xray = false;
      this._m = new THREE.Matrix4();
      this._v = new THREE.Vector3();
      this._v2 = new THREE.Vector3();
    }

    _setupEyes(qual) {
      const h = this.human, eyes = h.eyes;
      const mat = h.eyeMat;
      this.eye = mat && mat.userData.eye;
      if (!eyes || !this.eye) return;
      const EU = this.eye.uniforms;
      EU.uXray = this.U.uXray;
      if (qual === 0) { this.eye.canvas.width = this.eye.canvas.height = 512; }
      // split the cornea shell into its own group and material
      const geo = eyes.geometry, uv = geo.attributes.uv.array, nc = uv.length / 2;
      const ball = [], cornea = [];
      for (let t = 0; t < nc; t += 3) (uv[t * 2] > 0.85 && uv[t * 2 + 1] < 0.15 ? cornea : ball).push(t, t + 1, t + 2);
      geo.setIndex(ball.concat(cornea));
      geo.clearGroups();
      geo.addGroup(0, ball.length, 0);
      geo.addGroup(ball.length, cornea.length, 1);
      this.cornea = makeCorneaMaterial(EU);
      eyes.material = [mat, this.cornea];
      eyes.receiveShadow = true;
      this.ghost.push(mat);
      // smooth normals: corners that share a MakeHuman vertex share a normal
      const E = h.D.eye, corner = new Uint32Array(nc);
      for (let i = 0; i < nc; i++) corner[i] = E.tris[i * 2];
      const acc = new Float32Array(E.nVerts * 3);
      const smoothNormals = () => {
        const N = geo.attributes.normal.array;
        acc.fill(0);
        for (let i = 0; i < nc; i++) { const v = corner[i] * 3; acc[v] += N[i * 3]; acc[v + 1] += N[i * 3 + 1]; acc[v + 2] += N[i * 3 + 2]; }
        for (let i = 0; i < nc; i++) {
          const v = corner[i] * 3, l = Math.hypot(acc[v], acc[v + 1], acc[v + 2]) || 1;
          N[i * 3] = acc[v] / l; N[i * 3 + 1] = acc[v + 1] / l; N[i * 3 + 2] = acc[v + 2] / l;
        }
        geo.attributes.normal.needsUpdate = true;
      };
      if (!h._skinEyeHook) { h._skinEyeHook = true; h.addShapeListener(smoothNormals); }
      this.iEye = [h.boneIndex('eye.L'), h.boneIndex('eye.R')];
      this.iHead = h.boneIndex('head');
    }

    onParams(p) {
      if (this.baker) {
        this.baker.update(p, this.U);
        this.MU.uMouthC.value.copy(this.baker.mouth);
        this.MU.uLipZ.value = this.baker.lipZ;
        if (this.eye) this.eye.uniforms.uEyeRad.value = this.U.uEyeRad.value;
      }
      if (this.eye) {
        const cols = eyeColors(p), age = Math.round((p.age ?? 28) / 5) * 5;
        const key = cols.join() + '|' + age;
        if (key !== this.eye.key) {
          this.eye.key = key;
          paintEyes(this.eye.canvas, cols, age);
          this.eye.tex.needsUpdate = true;
        }
      }
    }

    update(dt, t) {
      const U = this.U, h = this.human;
      U.uTime.value = t;
      if (U.uFlushS) {
        U.uFlushS.value += (U.uFlush.value - U.uFlushS.value) * (1 - Math.exp(-dt * 2.5));
        U.uWetS.value += (U.uWet.value - U.uWetS.value) * (1 - Math.exp(-dt * 1.2));
      }
      // x-ray: blend only while it's on, so normal skin stays opaque and sorted
      const xr = U.uXray.value > 0.001;
      if (xr !== this.xray) {
        this.xray = xr;
        for (const m of this.ghost) { m.transparent = xr; m.depthWrite = !xr; m.needsUpdate = true; }
        h.body.castShadow = !xr;
      }
      if (this.eye) {
        const EU = this.eye.uniforms, b = h.bones;
        EU.uEyeCL.value.setFromMatrixPosition(b[this.iEye[0]].matrixWorld);
        EU.uEyeCR.value.setFromMatrixPosition(b[this.iEye[1]].matrixWorld);
        const side = this._v.subVectors(EU.uEyeCL.value, EU.uEyeCR.value).normalize();
        EU.uHeadSide.value.copy(side);
        const e = b[this.iHead].matrixWorld.elements;
        const up = this._v2.set(e[4], e[5], e[6]).normalize();
        EU.uHeadUp.value.copy(up.addScaledVector(side, -up.dot(side)).normalize());
        // pupils follow the requested size with a slow natural unrest (hippus)
        const target = U.uPupil.value + 0.025 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1.3);
        EU.uPupilS.value += (target - EU.uPupilS.value) * (1 - Math.exp(-dt * 4));
      }
    }
  }

  BS.registerModule({ name: 'skin', order: 30, create: (app) => new SkinModule(app) });
})();
