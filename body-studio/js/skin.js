// Body Studio skin: photoreal skin, eyes, teeth and tongue.
//
// Skin colour is baked per vertex from the params (tone, undertone, age,
// regional blood and melanin, lips, nails, areolae, mouth, blush, tan lines
// and the soft parts of makeup) into a `color` attribute plus four mask
// attributes. A patched MeshPhysicalMaterial adds what needs pixel detail:
// pores, fine relief and wrinkles as a procedural bump in rest space,
// freckles, moles, vitiligo, stretch marks, age spots, veins, eye makeup
// drawn along the fitted lash lines, wrapped colour-shifted diffuse
// (subsurface scattering) with back-light translucency, oily, glossy and wet
// layers, flush and the x-ray shell.
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
    'uFuzz', 'uDark', 'uWrap', 'uScatter', 'uEyeL', 'uEyeR', 'uCanthL', 'uCanthR', 'uMouth', 'uLipZ', 'uFace', 'uEyeRad', 'uDebug',
    'uMoles', 'uBeauty', 'uVitiligo', 'uVitCol', 'uBase', 'uStretch', 'uFound', 'uLip', 'uNail', 'uHiLite',
    'uMkA', 'uMkB', 'uMkC', 'uMkLid', 'uMkCrease', 'uMkLiner', 'uMkHi', 'uMkO', 'uMkX', 'uMkY', 'uLidFit'];

  const SKIN_VERT_PARS = `#include <common>
attribute vec3 restPos;
attribute vec4 region;
attribute vec4 region2;
attribute vec4 skinA;
attribute vec4 skinB;
attribute vec4 skinC;
attribute vec4 skinD;
varying vec3 vRest;
varying vec4 vReg;
varying vec4 vReg2;
varying vec4 vSkA;
varying vec4 vSkB;
varying vec4 vSkC;
varying vec4 vSkD;`;

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
uniform float uMoles;
uniform vec4 uBeauty;
uniform float uVitiligo;
uniform vec3 uVitCol;
uniform vec3 uBase;
uniform float uStretch;
uniform vec2 uFound; // foundation: coverage, finish (-1 matte .. 1 dewy)
uniform vec2 uLip; // lip product: coverage, gloss
uniform float uNail; // nail polish
uniform float uHiLite; // highlighter shimmer
uniform vec4 uMkA; // eyeshadow, liner, wing length, lower liner
uniform vec4 uMkB; // mascara, smoky, lid shimmer, liner thickness
uniform vec4 uMkC; // shadow spread, outer-corner depth, inner-corner highlight, bare lash line
uniform vec3 uMkLid;
uniform vec3 uMkCrease;
uniform vec3 uMkLiner;
uniform vec3 uMkHi;
uniform vec3 uMkO; // left eye frame (the right eye mirrors it): origin at the inner corner,
uniform vec3 uMkX; // u along the eye (outer corner = 1), v up, both in eye widths
uniform vec3 uMkY;
uniform vec4 uLidFit; // lash lines: v = u(1-u)(x + y u) above, -u(1-u)(z + w u) below
varying vec3 vRest;
varying vec4 vReg;
varying vec4 vReg2;
varying vec4 vSkA;
varying vec4 vSkB;
varying vec4 vSkC;
varying vec4 vSkD;
float skinSh = 1.0;
float skinThin = 0.0;
vec3 skinN0 = vec3(0.0, 0.0, 1.0);
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
}
// eye-frame coordinates of a rest-space point
vec2 skEyeUV(vec3 p) {
  vec3 q = vec3(abs(p.x), p.yz) - uMkO;
  return vec2(dot(q, uMkX), dot(q, uMkY));
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
float skGloss = 0.0; // shimmer and gloss from products
float skStM = 0.0; // stretch marks (smoother, slightly sunken)
float skStPh = 0.0;
float skStA = 0.0;
vec3 skStG = vec3(0.0);
vec4 skMole = vec4(0.0); // the mole under this pixel: centre, radius
float skMoleUp = 0.0;
// blotchy blood and pigment variation, centimetres across; foundation evens it
float skEven = 1.0 - 0.6 * uFound.x * vReg.z;
float skM1 = skNoise(skP * 31.0) + 0.5 * skNoise(skP * 83.0 + 7.3);
float skM2 = skNoise(skP * 17.0 + 3.1) + 0.5 * skNoise(skP * 140.0 + 1.7);
diffuseColor.rgb = skBlood(diffuseColor.rgb, skM1 * 0.5 * skEven * (1.0 - 0.6 * uDark));
diffuseColor.rgb = skMel(diffuseColor.rgb, skM2 * (0.22 + 0.1 * uDark) * skEven);
// freckles: clustered spots of two sizes, averaged out once sub-pixel
float skFr = uFreckle * vSkA.y;
if (skFr > 0.004) {
  float cl = smoothstep(-0.3, 0.35, skNoise(skP * 24.0 + 5.0));
  float th = 0.52 - 0.3 * skFr * (0.35 + 0.65 * cl);
  float sp = max(smoothstep(th, th + 0.05, skNoise(skP * 330.0)), 0.8 * smoothstep(th + 0.03, th + 0.08, skNoise(skP * 620.0 + 13.0)));
  sp = mix(0.1 * skFr * (0.35 + 0.65 * cl), sp, 1.0 - smoothstep(0.0006, 0.002, skFp));
  diffuseColor.rgb = skMel(diffuseColor.rgb, sp * (0.55 + 0.8 * skFr) * (0.75 + 0.5 * skNoise(skP * 150.0 + 2.0)) * (1.0 - 0.45 * uFound.x * vReg.z));
}
// age spots: a few flat tan patches on sun-exposed skin
float skSpot = smoothstep(0.45, 0.95, uAge) * vSkA.y;
if (skSpot > 0.01) {
  float n = skNoise(skP * 70.0 + 31.0) + 0.25 * skNoise(skP * 300.0);
  diffuseColor.rgb = skMel(diffuseColor.rgb, smoothstep(0.42, 0.52, n) * skSpot * 0.45 * (1.0 - 0.5 * uFound.x * vReg.z));
}
// veins: a faint blue-green network under thin skin, stretched along the limb
float skV = uVein * vSkA.z * (1.0 - 0.75 * uDark) * (1.0 - 0.5 * uFound.x * vReg.z);
if (skV > 0.004) {
  vec3 ax = vSkC.xyz / max(length(vSkC.xyz), 1e-5);
  vec3 q = skP - ax * dot(skP, ax) * 0.7;
  float vn = skNoise(q * 55.0) + 0.35 * skNoise(q * 140.0 + 4.0);
  float line = (1.0 - smoothstep(0.015, 0.085, abs(vn))) * smoothstep(-0.15, 0.25, skNoise(skP * 18.0 + 9.0));
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.78, 0.88, 1.04), line * skV);
}
// vitiligo: depigmented patches with irregular, crisp borders, mostly
// symmetric, favouring the eyes, mouth, fingers and joints
if (uVitiligo > 0.004) {
  vec3 vp = vec3(abs(skP.x), skP.yz);
  float n = skNoise(vp * 5.5) + 0.5 * skNoise(vp * 14.0 + 3.0) + 0.25 * skNoise(vp * 37.0 + 7.0) + 0.12 * skNoise(vp * 105.0 + 1.0);
  float pref = clamp(0.3 + 1.1 * vReg.y + 0.8 * vReg.x + 0.6 * vSkA.w + 0.4 * vSkB.y + 0.25 * vReg.z, 0.0, 1.4);
  float th = 0.5 - 0.8 * uVitiligo * pref;
  float aa = fwidth(n) + 0.012;
  float m = smoothstep(th - aa, th + aa, n);
  float rim = smoothstep(th - 0.1, th - aa, n) * (1.0 - m);
  vec3 vc = uVitCol * mix(vec3(1.0), clamp(diffuseColor.rgb / uBase, vec3(0.45), vec3(1.6)), 0.5);
  diffuseColor.rgb = mix(skMel(diffuseColor.rgb, 0.3 * rim), vc, m);
}
// moles: sparse brown spots, some raised, plus an optional beauty mark
if (uMoles > 0.004) {
  vec3 ci = floor(skP / 0.012);
  vec3 h1 = skHash(ci + 41.0) * 0.5 + 0.5;
  vec3 h2 = skHash(ci + 7.0) * 0.5 + 0.5;
  float dens = uMoles * (0.3 + 0.7 * vSkA.y) * 0.035 * (1.0 - vReg.x) * (1.0 - vReg2.x) * (1.0 - vReg2.z);
  if (h2.x < dens) { skMole = vec4((ci + 0.25 + 0.5 * h1) * 0.012, mix(0.0006, 0.002, h2.y * h2.y)); skMoleUp = step(0.6, h2.z); }
  if (uBeauty.w > 0.0 && distance(skP, uBeauty.xyz) < uBeauty.w * 1.6) { skMole = uBeauty; skMoleUp = 0.4; }
  if (skMole.w > 0.0) {
    vec3 dm = skP - skMole.xyz;
    float d = length(dm) / skMole.w + 0.12 * skNoise(dm * 2600.0);
    float aa = skFp / skMole.w;
    float m = (1.0 - smoothstep(0.85 - aa, 1.0 + aa, d)) * min(1.0, 1.0 / (aa * aa + 0.01));
    float tone = mix(1.5, 2.8, fract(h1.z * 13.7)) * (0.7 + 0.3 * uMoles);
    diffuseColor.rgb = skMel(skBlood(diffuseColor.rgb, 0.4 * m * skMoleUp), m * tone * (1.0 - 0.3 * d * d) * (1.0 - 0.5 * skMoleUp));
  }
}
// stretch marks: fine broken lines across the direction the skin stretched;
// older ones silvery and paler than the skin, fresher ones pink-lilac
float skSt = uStretch * length(vSkD.xyz);
if (skSt > 0.01) {
  vec3 ac = vSkD.xyz / length(vSkD.xyz);
  float sp = 0.0065;
  vec4 wn = skNoiseD(skP * 22.0);
  float ph = dot(skP, ac) / sp + 1.4 * wn.x;
  vec3 gph = ac / sp + 1.4 * 22.0 * wn.yzw;
  vec3 hs = skHash(vec3(floor(ph), 3.7, 1.3)) * 0.5 + 0.5;
  float fr = abs(fract(ph) - 0.5);
  float aa = fwidth(ph);
  float w = 0.05 + 0.14 * hs.x;
  float seg = smoothstep(0.0, 0.25, skNoise(skP * 45.0 + hs * 9.0) + 0.3 * hs.y - 0.08) * smoothstep(0.0, 0.35, skSt - 0.3 * hs.z);
  float sub = smoothstep(0.3, 1.0, aa); // finer than a pixel: show the average
  skStM = mix(1.0 - smoothstep(w - aa * 0.5, w + aa * 0.5, fr), 2.0 * w, sub) * seg;
  vec3 st = diffuseColor.rgb * mix(vec3(1.22, 1.16, 1.2), vec3(1.08, 0.88, 1.02), 0.4 * hs.y) + 0.01;
  diffuseColor.rgb = mix(diffuseColor.rgb, st, 0.85 * skStM);
  skStPh = ph; skStG = gph; skStA = (1.0 - sub) * seg;
}
// eye makeup along the fitted lash lines: shadow, liner with its wing,
// smudged lower line, mascara at the lash roots
{
  vec2 euv = skEyeUV(skP);
  float u = euv.x, v = euv.y;
  if (u > -0.5 && u < 1.7 && v > -0.8 && v < 1.0) {
    float aa = max(fwidth(v), 0.0015);
    float uc = clamp(u, 0.0, 1.0);
    float ext = max(u - 1.0, 0.0);
    float up = uc * (1.0 - uc) * (uLidFit.x + uLidFit.y * uc) + 0.3 * ext;
    float lo = -uc * (1.0 - uc) * (uLidFit.z + uLidFit.w * uc) + 0.3 * ext;
    float dU = v - up, dL = lo - v;
    float lat = smoothstep(-0.06, 0.12, u) * (1.0 - smoothstep(1.05, 1.4, u));
    float inside = 1.0 - step(1.0, u);
    vec3 c = diffuseColor.rgb;
    float sp = uMkC.x;
    // lid colour, densest at the lash line and blended up past the crease
    float lid = smoothstep(-0.01, 0.02, dU) * (1.0 - smoothstep(0.3 * sp, sp, dU)) * lat;
    // a deeper shade worked into the outer corner and the crease
    float ov = smoothstep(0.4, 1.0, u) * smoothstep(-0.01, 0.03, dU) * (1.0 - smoothstep(0.15 * sp, 0.75 * sp, dU - 0.15 * ext)) * lat;
    // smoky: smudged under the lower lashes
    float sm = smoothstep(-0.01, 0.015, dL) * (1.0 - smoothstep(0.02, 0.03 + 0.14 * sp, dL)) * smoothstep(0.1, 0.55, u) * lat;
    c = mix(c, uMkLid, uMkA.x * 0.85 * lid);
    c = mix(c, uMkCrease, uMkA.x * uMkC.y * ov);
    c = mix(c, mix(uMkLid, uMkCrease, 0.6), uMkB.y * 0.8 * sm);
    c = mix(c, uMkHi, uMkC.z * 0.6 * (1.0 - smoothstep(0.02, 0.13, length(vec2(u - 0.02, v * 1.4)))));
    // liner: thin at the inner corner, thicker outwards, flicking into a wing
    float th = uMkB.w * (0.008 + 0.032 * smoothstep(0.05, 1.0, u));
    float band = smoothstep(-aa, aa, dU + 0.006) * (1.0 - smoothstep(th - aa, th + aa, dU)) * smoothstep(0.02, 0.14, u) * inside;
    float wl = uMkA.z * 0.3;
    float wing = 0.0;
    if (wl > 0.004 && u > 0.7) {
      vec2 tip = vec2(1.0 + wl, 0.55 * wl + 0.01);
      float u0 = 0.7;
      float top0 = u0 * (1.0 - u0) * (uLidFit.x + uLidFit.y * u0) + uMkB.w * (0.008 + 0.032 * smoothstep(0.05, 1.0, u0));
      float topE = mix(top0, tip.y, clamp((u - u0) / (tip.x - u0), 0.0, 1.0));
      float botE = u < 1.0 ? up - 0.006 : (u - 1.0) / wl * (tip.y - 0.01);
      wing = smoothstep(-aa, aa, topE - v) * smoothstep(-aa, aa, v - botE) * smoothstep(-aa, aa, tip.x - u);
    }
    float soft = mix(aa, 0.02, uMkB.y);
    float th2 = 0.006 + 0.01 * u;
    float low = smoothstep(-soft, soft, dL + 0.004) * (1.0 - smoothstep(th2 - soft, th2 + soft, dL)) * smoothstep(0.25, 0.6, u) * (1.0 - smoothstep(0.96, 1.03, u));
    c = mix(c, uMkLiner, 0.92 * max(max(band, wing) * uMkA.y, low * uMkA.w));
    // lash roots: dark on everyone, darker with mascara
    float lash = smoothstep(-aa, aa, dU + 0.008) * (1.0 - smoothstep(0.0, 0.012 + aa, dU)) * smoothstep(0.04, 0.16, u) * inside;
    lash = max(lash, 0.45 * smoothstep(-aa, aa, dL + 0.004) * (1.0 - smoothstep(0.0, 0.007 + aa, dL)) * smoothstep(0.2, 0.5, u) * inside);
    c = mix(c, uMkLiner * 0.5, max(uMkC.w, uMkB.x) * 0.75 * lash);
    diffuseColor.rgb = c;
    skGloss = uMkB.z * uMkA.x * max(lid, ov);
  }
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
// foundation finish on the face: powdery matte to dewy
roughnessFactor += uFound.x * vReg.z * (0.01 - 0.09 * uFound.y);
// lip products: matte to high gloss; polished nails; shimmer
roughnessFactor = mix(roughnessFactor, mix(0.62, 0.2, uLip.y), uLip.x * smoothstep(0.2, 0.6, vReg.x));
roughnessFactor = mix(roughnessFactor, 0.17, uNail * vReg2.x);
roughnessFactor = mix(roughnessFactor, 0.3, max(skGloss, uHiLite * vSkD.w));
roughnessFactor = mix(roughnessFactor, 0.32, 0.6 * skStM);
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
  float pd = mix(0.000009, 0.000017, faceK) * (1.0 + 0.6 * uAge) * (1.0 - vReg.x) * bare * (1.0 - 0.4 * uFound.x * faceK);
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
  float fa = 0.000016 * (1.0 + 0.8 * uAge) * (1.0 - 0.6 * vReg.x) * bare;
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
    float a = 0.000022 * mf * (1.0 + uAge) * bare;
    H += a * n.x;
    G += a * n.yzw * 160.0;
  }
  // raised moles and the shallow furrows of stretch marks
  if (skMole.w > 0.0 && skMoleUp > 0.0) {
    vec3 dm = skP - skMole.xyz;
    float r2 = dot(dm, dm) / (skMole.w * skMole.w);
    if (r2 < 1.0) {
      float a = skMole.w * 0.14 * skMoleUp, t = 1.0 - r2;
      H += a * t * t;
      G -= a * 4.0 * t * dm / (skMole.w * skMole.w);
    }
  }
  if (skStA > 0.0) skGroove(skStPh, skStG, 0.00002 * skStA, 40.0, H, G);
#if SKIN_Q > 1
  // forehead lines and the frown lines between the brows
  if (vSkB.z > 0.01) {
    vec3 em = 0.5 * (uEyeL + uEyeR);
    float x = skP.x - em.x;
    float sp = 0.0095 * uFace;
    vec4 wn = skNoiseD(skP * 60.0);
    float ph = (skP.y - em.y - 2.5 * x * x / uFace) / sp + 0.4 * wn.x;
    vec3 gph = vec3(-5.0 * x / uFace, 1.0, 0.0) / sp + 0.4 * 60.0 * wn.yzw;
    float brk = smoothstep(-0.3, 0.35, skNoise(vec3(skP.x * 45.0, floor(ph) * 3.1, 2.0)));
    float wf = 1.0 - smoothstep(sp * 0.06, sp * 0.2, skFp);
    skGroove(ph, gph, 0.00013 * vSkB.z * wA * wA * brk * wf, 14.0, H, G);
    float gy = (skP.y - em.y) / uFace;
    float gm = smoothstep(0.004, 0.012, gy) * (1.0 - smoothstep(0.024, 0.034, gy));
    float gx = abs(x) - 0.0055 * uFace;
    float e2 = exp(-gx * gx / 2.5e-6) * gm * vSkB.z * wA * wA * 0.00009 * wf;
    H -= e2;
    G.x += e2 * 2.0 * gx / 2.5e-6 * sign(x);
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
        skGroove(th / 0.17 + 0.35 * wn.x, gth / 0.17 + 0.35 * 160.0 * wn.yzw, 0.00009 * m * wf * vSkB.w * wA * wA, 20.0, H, G);
      }
      vec3 d2 = skP - e;
      float r2 = length(d2);
      float rr = (r2 - uEyeRad * 1.3) / (0.0026 * uFace);
      float m2 = smoothstep(-0.25, -0.6, d2.y / r2) * smoothstep(0.0, 0.6, rr) * (1.0 - smoothstep(2.2, 3.6, rr)) * (1.0 - m);
      if (m2 * wf > 0.0) {
        vec4 wn = skNoiseD(skP * 120.0 + 5.0);
        skGroove(rr + 0.3 * wn.x, d2 / (r2 * 0.0026 * uFace) + 0.3 * 120.0 * wn.yzw, 0.00005 * m2 * wf * vSkB.w * wA * wA, 18.0, H, G);
      }
    }
  }
  // fine vertical lines on the lips
  if (vReg.x > 0.05) {
    float ls = 0.0011;
    float lf = 1.0 - smoothstep(ls * 0.15, ls * 0.45, skFp);
    if (lf > 0.0) {
      vec4 wn = skNoiseD(skP * 380.0);
      skGroove((skP.x - uMouth.x) / ls + 0.5 * wn.x, vec3(1.0 / ls, 0.0, 0.0) + 0.5 * 380.0 * wn.yzw, 0.000018 * (0.6 + uAge) * smoothstep(0.3, 0.9, vReg.x) * lf * (1.0 - 0.6 * uLip.x), 10.0, H, G);
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
  float oil = saturate(-vSkB.x * 5.0) * (1.0 - vReg.x) * (1.0 - uFound.x * vReg.z * saturate(0.6 - 0.6 * uFound.y));
  float lipC = mix(0.22, uLip.y, uLip.x) * vReg.x;
  material.clearcoat = saturate(0.04 + 0.3 * oil * uShine + lipC + vReg2.x * (0.65 + 0.35 * uNail) + 0.9 * vReg2.z + 0.85 * skWet + 0.45 * skGloss + 0.3 * uHiLite * vSkD.w);
  material.clearcoatRoughness = mix(0.34, 0.06, max(max(skWet, vReg2.x), max(uLip.x * uLip.y * vReg.x, skGloss)));
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
  else if (uDebug == 13) dc = abs(vSkD.xyz);
  else if (uDebug == 14) dc = vec3(vSkD.w);
  else if (uDebug == 15) {
    vec2 e = skEyeUV(vRest);
    float uc = clamp(e.x, 0.0, 1.0);
    float up = uc * (1.0 - uc) * (uLidFit.x + uLidFit.y * uc), lo = -uc * (1.0 - uc) * (uLidFit.z + uLidFit.w * uc);
    vec2 g = abs(fract(e * 10.0) - 0.5);
    dc = vec3(0.25) + 0.25 * step(0.45, max(g.x, g.y));
    dc = mix(dc, vec3(1.0, 0.2, 0.1), 1.0 - smoothstep(0.0, 0.008, abs(e.y - up)));
    dc = mix(dc, vec3(0.1, 0.4, 1.0), 1.0 - smoothstep(0.0, 0.008, abs(e.y - lo)));
  }
  gl_FragColor = vec4(dc, 1.0);
}
`;
  const DEBUG_MODES = { flush: 1, freckle: 2, vein: 3, thin: 4, rough: 5, wrinkle: 6, ao: 7, albedo: 8, normal: 9, region: 10, region2: 11, axis: 12,
    stretch: 13, hilite: 14, eyeframe: 15 };

  // the per-vertex attributes this material reads, (re)attached to whatever
  // body geometry the human currently has (a game swaps it for detail levels)
  const ATTRS = [['color', 3], ['skinA', 4], ['skinB', 4], ['skinC', 4], ['skinD', 4]];
  function attachAttributes(human) {
    const geo = human.bodyGeo, n = human.S.nOut;
    for (const [name, size] of ATTRS) {
      const a = geo.attributes[name];
      if (a && a.count === n) continue;
      const arr = new Float32Array(n * size);
      if (name === 'color') arr.fill(0.6);
      if (name === 'skinC') for (let i = 3; i < arr.length; i += 4) arr[i] = 1;
      geo.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));
    }
    return geo;
  }

  BS.makeSkinMaterial = function (human) {
    attachAttributes(human);
    const v = (x) => ({ value: x });
    const V3 = () => v(new THREE.Vector3());
    const U = {
      uTime: v(0), uFlush: v(0), uWet: v(0), uXray: v(0), uPupil: v(0.35), uFlushS: v(0), uWetS: v(0),
      uRough: v(0.5), uShine: v(0.4), uFreckle: v(0), uVein: v(0.2), uAge: v(0), uFuzz: v(0.2), uDark: v(0.3),
      uWrap: v(new THREE.Vector3(0.34, 0.12, 0.08)), uScatter: v(new THREE.Vector3(1.0, 0.28, 0.14)),
      uEyeL: V3(), uEyeR: V3(), uCanthL: V3(), uCanthR: V3(), uMouth: V3(), uLipZ: v(0), uFace: v(1), uEyeRad: v(0.0125), uDebug: v(0),
      uMoles: v(0), uBeauty: v(new THREE.Vector4()), uVitiligo: v(0), uVitCol: V3(), uBase: v(new THREE.Vector3(0.5, 0.35, 0.28)), uStretch: v(0),
      uFound: v(new THREE.Vector2()), uLip: v(new THREE.Vector2(0, 0.5)), uNail: v(0), uHiLite: v(0),
      uMkA: v(new THREE.Vector4()), uMkB: v(new THREE.Vector4()), uMkC: v(new THREE.Vector4(0.3, 0, 0, 0.35)),
      uMkLid: V3(), uMkCrease: V3(), uMkLiner: v(new THREE.Vector3(0.02, 0.012, 0.01)), uMkHi: V3(),
      uMkO: v(new THREE.Vector3(0, -10, 0)), uMkX: V3(), uMkY: V3(), uLidFit: v(new THREE.Vector4()),
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
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = restPos; vReg = region; vReg2 = region2; vSkA = skinA; vSkB = skinB; vSkC = skinC; vSkD = skinD;');
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

  // ------------------------------------------------- colour helpers
  const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const lin = (hex) => new THREE.Color(hex); // three converts sRGB hex to linear
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const TONES = BS.SKIN_TONES.map(lin);
  const toneAt = (t) => {
    const f = Math.min(0.9999, Math.max(0, t)) * (TONES.length - 1), i = Math.floor(f);
    return TONES[i].clone().lerp(TONES[i + 1], f - i);
  };
  // base albedo: the table is "how skin looks", albedo is a bit deeper; lit
  // skin and ACES add saturation back, but deep skin keeps its richness
  function skinBase(tone, under, ageN) {
    const dark = smooth01(0.25, 0.85, tone);
    const c = toneAt(tone).multiplyScalar(0.78 + 0.06 * dark);
    const l = lum(c);
    c.lerp(new THREE.Color(l, l, l), 0.25 - 0.17 * dark);
    const k = (under - 0.5) * 2;
    c.r *= 1 + 0.02 * k; c.g *= 1 - 0.035 * Math.max(0, -k); c.b *= 1 - 0.1 * k;
    c.r *= 1 - 0.05 * ageN; c.b *= 1 - 0.1 * ageN; // sallower with age
    return c;
  }
  // natural lips: pale pink to deep rose, scaled to the skin's depth
  function naturalLip(base, lipC, ageN) {
    const L = lum(base), dark = smooth01(0.03, 0.2, 0.25 - L);
    const c = lin('#c98a82').lerp(lin('#983848'), lipC).multiplyScalar(Math.pow(L / 0.36, 0.75));
    c.lerp(base.clone().multiply(new THREE.Color(0.78, 0.55, 0.6)), 0.45 * dark);
    return c.lerp(base, 0.25 * ageN);
  }
  const REF = skinBase(0.3, 0.5, 0);
  const REF_LIP = naturalLip(REF, 0.35, 0);

  // Makeup looks (params.makeupStyle). Amounts are at full intensity
  // (params.makeup scales them); colours are swatches as they'd look on a
  // light-medium skin. `...Op` is how opaque a product is: sheer ones take
  // the wearer's own depth, opaque ones keep their colour on any skin.
  const LOOKS = {
    natural: { found: 0.35, conceal: 0.45, finish: 0.3, blush: 0.3, blushCol: '#e3968a', contour: 0.1, highlight: 0.2,
      shadow: 0.3, lid: '#c09a86', crease: '#93705f', shadowOp: 0.15, spread: 0.85, outerV: 0.25,
      mascara: 0.65, lip: 0.35, lipCol: '#c9837c', lipOp: 0.15, gloss: 0.75, nail: 0.45, nailCol: '#efcfc6', nailOp: 0.4 },
    everyday: { found: 0.5, conceal: 0.6, blush: 0.35, blushCol: '#dc8679', contour: 0.2, highlight: 0.25,
      shadow: 0.45, lid: '#ad8471', crease: '#7a5546', shadowOp: 0.25, spread: 0.95, outerV: 0.45,
      liner: 0.55, linerCol: '#2b1d18', thick: 0.45, wing: 0.15, mascara: 0.9,
      lip: 0.55, lipCol: '#b8636b', lipOp: 0.45, gloss: 0.45, lipLiner: 0.2, nail: 0.7, nailCol: '#c98189' },
    'soft glam': { found: 0.7, conceal: 0.75, finish: 0.2, blush: 0.45, blushCol: '#df8471', lift: 0.35, contour: 0.4, highlight: 0.5, glow: 1,
      shadow: 0.8, lid: '#b47c5f', crease: '#6b4030', shadowOp: 0.45, spread: 1.1, outerV: 0.65, shimmer: 0.55, inner: 0.5, innerCol: '#f1d8bf',
      liner: 0.7, linerCol: '#1e1512', thick: 0.6, wing: 0.45, lower: 0.25, mascara: 1,
      lip: 0.7, lipCol: '#ab5d63', lipOp: 0.55, gloss: 0.55, lipLiner: 0.45, nail: 0.85, nailCol: '#b26f78' },
    glam: { found: 0.85, conceal: 0.85, finish: -0.5, blush: 0.45, blushCol: '#cf6c5f', lift: 0.5, contour: 0.6, highlight: 0.65, glow: 1,
      shadow: 0.95, lid: '#a35c35', crease: '#45261b', shadowOp: 0.7, spread: 1.25, outerV: 0.85, shimmer: 0.75, inner: 0.7, innerCol: '#f4dcb8',
      liner: 0.95, linerCol: '#0e0b0b', thick: 0.8, wing: 0.7, lower: 0.35, mascara: 1,
      lip: 0.9, lipCol: '#8f1d2b', lipOp: 0.9, gloss: 0.12, lipLiner: 0.7, nail: 1, nailCol: '#8c1522' },
    'smoky eye': { found: 0.65, conceal: 0.75, finish: -0.2, blush: 0.25, blushCol: '#c98174', contour: 0.35, highlight: 0.3,
      shadow: 1, lid: '#4d4649', crease: '#211d20', shadowOp: 0.8, spread: 1.3, outerV: 0.7, smoky: 1, shimmer: 0.25,
      liner: 0.8, linerCol: '#0d0b0c', thick: 0.6, wing: 0.2, lower: 0.85, mascara: 1,
      lip: 0.45, lipCol: '#b47b74', nude: true, gloss: 0.4, nail: 0.9, nailCol: '#2b2326' },
    'bold lip': { found: 0.7, conceal: 0.7, finish: -0.3, blush: 0.2, blushCol: '#d38a7c', contour: 0.25, highlight: 0.3,
      shadow: 0.2, lid: '#b39181', crease: '#8a6858', shadowOp: 0.2, spread: 0.8, outerV: 0.3,
      liner: 0.6, linerCol: '#100c0c', thick: 0.5, wing: 0.35, mascara: 0.95,
      lip: 1, lipCol: '#b3121f', lipOp: 0.95, gloss: 0.08, lipLiner: 0.9, nail: 1, nailCol: '#a3121c' },
    'graphic liner': { found: 0.55, conceal: 0.6, finish: -0.2, blush: 0.2, blushCol: '#d68c80', contour: 0.2, highlight: 0.25,
      shadow: 0.15, lid: '#c4a090', crease: '#8f6f62', shadowOp: 0.15, spread: 0.7, outerV: 0.2,
      liner: 1, linerCol: '#070607', thick: 1, wing: 1, mascara: 1,
      lip: 0.45, lipCol: '#b8807a', nude: true, gloss: 0.25, nail: 0.9, nailCol: '#121012' },
    editorial: { found: 0.75, conceal: 0.7, finish: 0.8, blush: 0.55, blushCol: '#c25a6e', lift: 1, contour: 0.45, highlight: 0.75, glow: 1,
      shadow: 1, lid: '#2f5bc2', crease: '#1c2a6b', shadowOp: 0.9, spread: 1.5, outerV: 0.6, shimmer: 0.85, inner: 0.6, innerCol: '#e8f0ff',
      liner: 0.8, linerCol: '#070607', thick: 0.75, wing: 0.9, lower: 0.5, mascara: 1,
      lip: 0.9, lipCol: '#7c1f4a', lipOp: 0.85, gloss: 0.9, lipLiner: 0.5, nail: 1, nailCol: '#2f5bc2' },
  };
  BS.MAKEUP_LOOKS = LOOKS;
  const HEX = /^#[0-9a-f]{6}$/i;

  // resolve params into product amounts and linear colours for this skin
  function makeupLook(p, base, lipNat) {
    const name = p.makeupStyle ?? ((p.makeup || 0) > 0 ? 'everyday' : 'none');
    const st = LOOKS[name];
    const k = clamp01(p.makeup ?? 0.6);
    const c = st ? Math.pow(k, 0.6) : 0;
    // a sheer product deepens with the skin; an opaque one keeps its colour
    const tint = (hex, op, ref = REF, skin = base) => { const a = lin(hex); return skin.clone().multiply(a).multiply(new THREE.Color(1 / ref.r, 1 / ref.g, 1 / ref.b)).lerp(a, op); };
    // nails are not face makeup: a chosen polish shows even with no look
    const nailHex = HEX.test(p.nailColor || '') ? p.nailColor : st && st.nail ? st.nailCol : null;
    const nail = nailHex ? (HEX.test(p.nailColor || '') && !st ? 1 : Math.max(0.6, st.nail || 0) * c) : 0;
    const out = { nail, nailT: nailHex ? tint(nailHex, (st && !HEX.test(p.nailColor || '') && st.nailOp) || 0.95) : null };
    if (!st || c <= 0) return Object.assign(out, { face: false });
    const g = (key, d = 0) => st[key] ?? d;
    const lidHex = HEX.test(p.eyeshadow || '') ? p.eyeshadow : g('lid', '#b89482');
    const lidT = tint(lidHex, HEX.test(p.eyeshadow || '') ? 0.85 : g('shadowOp', 0.3));
    let creaseT = tint(g('crease', '#8f6b5c'), Math.max(0.3, g('shadowOp', 0.3)));
    if (HEX.test(p.eyeshadow || '')) creaseT = lidT.clone().multiplyScalar(0.45).lerp(new THREE.Color(lum(lidT) * 0.45, lum(lidT) * 0.45, lum(lidT) * 0.45), 0.25);
    const lipHex = HEX.test(p.lipstick || '') ? p.lipstick : g('lipCol', '#c47a72');
    let lipT;
    if (st.nude && !HEX.test(p.lipstick || '')) { const a = lin(lipHex); lipT = lipNat.clone().lerp(a.multiplyScalar(lum(lipNat) / lum(a)), 0.7); }
    else lipT = tint(lipHex, HEX.test(p.lipstick || '') ? 0.9 : g('lipOp', 0.5), REF_LIP, lipNat);
    return Object.assign(out, {
      face: true, k, c,
      found: g('found') * c, conceal: g('conceal') * c, finish: g('finish'),
      blush: g('blush') * c, blushT: tint(g('blushCol', '#d98a7f'), 0.15), lift: g('lift'),
      contour: g('contour') * c, highlight: g('highlight') * c, glow: g('glow'),
      shadow: g('shadow') * c, lidT, creaseT, spread: g('spread', 1), outerV: g('outerV'), smoky: g('smoky') * c, shimmer: g('shimmer'),
      inner: g('inner') * c, innerT: tint(g('innerCol', '#efd6c0'), 0.5),
      liner: g('liner') * c, linerT: lin(g('linerCol', '#1a1414')), thick: g('thick', 0.5) * (0.6 + 0.4 * k), wing: g('wing'), lower: g('lower') * c,
      mascara: g('mascara') * c,
      lip: (HEX.test(p.lipstick || '') ? Math.max(0.8, g('lip')) : g('lip')) * c, lipT, gloss: g('gloss', 0.5), lipLiner: g('lipLiner') * c,
    });
  }

  // ------------------------------------------------- per-vertex baking
  // bone groups for regional masks (anything else is lower trunk)
  const CATS = [
    /^(head|jaw|eye|special0|levator|oris|risorius|temporalis|oculi|orbicularis|tongue)/,
    /^neck/, /^(spine0[12]|breast)/, /^(clavicle|shoulder)/, /^upperarm/, /^lowerarm/, /^(wrist|metacarpal)/, /^finger/,
    /^(upperleg|pelvis\.)/, /^lowerleg/, /^foot/, /^toe/,
  ];
  const NC = CATS.length;
  // baked masks per vertex: blood, pigment, palm/sole, cheek (blush), contour,
  // highlight, under-eye, exposed, high blush, bikini, trunks, face makeup
  const MC = 12;
  const _f = new THREE.Vector3(), _ex = new THREE.Vector3(), _ey = new THREE.Vector3();

  class SkinBaker {
    constructor(human) {
      this.h = human;
      this.geo = attachAttributes(human);
      const n = (this.n = human.S.nOut);
      const D = human.D, { idx, wts } = human.subWeights;
      const map = D.bones.map((b) => CATS.findIndex((re) => re.test(b.name)));
      const breast = [human.boneIndex('breast.L'), human.boneIndex('breast.R')];
      const W = (this.W = new Float32Array(n * NC));
      const BW = (this.BW = new Float32Array(n));
      for (let i = 0; i < n; i++) for (let k = 0; k < 8; k++) {
        const w = wts[i * 8 + k], b = idx[i * 8 + k], c = map[b];
        if (w && c >= 0) W[i * NC + c] += w;
        if (w && (b === breast[0] || b === breast[1])) BW[i] += w;
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
      this.M = new Float32Array(n * MC);
      this.k0 = new Float32Array(n);
      this.k1 = new Float32Array(n);
      this.sig = NaN;
      const g = this.geo.attributes;
      this.A = g.skinA; this.B = g.skinB; this.C = g.skinC; this.Dm = g.skinD; this.color = g.color;
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
      const h = this.h, n = this.n, W = this.W, M = this.M, BW = this.BW;
      const R = h.restAttr.array, Nr = h.bodyNrm.array;
      const reg = this.geo.attributes.region.array, reg2 = this.geo.attributes.region2.array;
      const A = this.A.array, B = this.B.array, C = this.C.array, Dd = this.Dm.array;
      const J = (name, end) => h.joint(name, end);
      const eL = J('eye.L'), eR = J('eye.R');
      const ipd = eL.x - eR.x, fs = ipd / 0.058;
      const eyeY = (eL.y + eR.y) / 2;
      // nose tip, lips, outer eye corners and nipples, found on the mesh
      let noseZ = -Infinity, nose = 0, lipZ = -Infinity, lx = 0, ly = 0, lz = 0, ln = 0, lipTop = -Infinity;
      const canth = [null, null], canX = [0, 0], nip = [new THREE.Vector3(), new THREE.Vector3()], nipN = [0, 0];
      for (let i = 0; i < n; i++) {
        const x = R[i * 3], y = R[i * 3 + 1], z = R[i * 3 + 2];
        if (reg[i * 4 + 2] > 0.5 && Math.abs(x) < 0.15 * ipd && y < eyeY - 0.2 * ipd && y > eyeY - 1.4 * ipd && z > noseZ) { noseZ = z; nose = i; }
        if (reg[i * 4] > 0.5) { lx += x; ly += y; lz += z; ln++; if (z > lipZ) lipZ = z; if (Math.abs(x) < 0.004) lipTop = Math.max(lipTop, y); }
        if (reg[i * 4 + 1] > 0.3 && Math.abs(y - eyeY) < 0.004 * fs) {
          const s = x > 0 ? 0 : 1;
          if (Math.abs(x) > canX[s]) { canX[s] = Math.abs(x); canth[s] = i; }
        }
        if (reg2[i * 4 + 1] > 0.5) { const s = x >= 0 ? 0 : 1; nip[s].x += x; nip[s].y += y; nip[s].z += z; nipN[s]++; }
      }
      const P = (i) => new THREE.Vector3(R[i * 3], R[i * 3 + 1], R[i * 3 + 2]);
      const noseP = P(nose), mouth = new THREE.Vector3(lx / ln, ly / ln, lz / ln);
      const cant = canth.map((i, s) => (i !== null ? P(i) : (s ? eR : eL).clone()));
      const eyeRad = this.eyeRadius(eL);
      U.uEyeL.value.copy(eL); U.uEyeR.value.copy(eR);
      U.uCanthL.value.copy(cant[0]); U.uCanthR.value.copy(cant[1]);
      U.uMouth.value.copy(mouth); U.uLipZ.value = lipZ; U.uFace.value = fs; U.uEyeRad.value = eyeRad;
      this.mouth = mouth; this.lipZ = lipZ;
      this.fitLids(U, eL, eyeRad);
      ['L', 'R'].forEach((s, k) => { if (nipN[k]) nip[k].multiplyScalar(1 / nipN[k]); else nip[k].copy(J('breast.' + s, 'tail')); });

      // limb landmarks per side (0 = left, +X)
      const sides = ['L', 'R'].map((s, k) => {
        const wr = J('wrist.' + s), mid = J('finger3-1.' + s);
        const along = mid.clone().sub(wr), across = J('finger2-1.' + s).sub(J('finger5-1.' + s));
        const palm = new THREE.Vector3().crossVectors(along, across).normalize();
        if (palm.y > 0) palm.negate(); // A-pose: palms face down and forward
        const knuckles = [];
        for (let f = 2; f <= 5; f++) for (let j = 1; j <= 3; j++) knuckles.push(J(`finger${f}-${j}.${s}`));
        knuckles.push(J('finger1-2.' + s), J('finger1-3.' + s));
        const tips = [];
        for (let f = 1; f <= 5; f++) tips.push(J(`finger${f}-3.${s}`, 'tail'));
        const toes = [];
        for (let f = 1; f <= 5; f++) toes.push(J(`toe${f}-1.${s}`));
        return {
          palm, wrist: wr, knuckles, tips, toes, elbow: J('lowerarm01.' + s), knee: J('lowerleg01.' + s),
          shoulder: J('upperarm01.' + s), temple: J('eye.' + s).add(new THREE.Vector3((s === 'L' ? 1 : -1) * 0.75 * ipd, 0.25 * ipd, -0.5 * ipd)),
          eye: s === 'L' ? eL : eR, nip: nip[k],
        };
      });
      const chestTop = J('spine01', 'tail').y, chestBot = J('spine02').y;
      // trunk landmarks for tan lines and stretch marks
      const hs = J('head', 'tail').y / 1.7, hip = J('upperleg01.L');
      const navel = new THREE.Vector3(0, 0.4 * J('spine04').y + 0.6 * J('spine03').y, 0);
      let crotch = hip.y;
      for (let i = 0; i < n; i++) {
        const y = R[i * 3 + 1];
        if (Math.abs(R[i * 3]) < 0.008 && y < crotch && y > hip.y - 0.25 * hs && W[i * NC + 6] + W[i * NC + 7] < 0.01) crotch = y;
      }
      const topY = hip.y + 0.045 * hs, hipHalf = hip.x + 0.07 * hs, underY = nip[0].y - 0.055 * hs, strapX = 0.85 * Math.abs(nip[0].x);
      const mY = (mouth.y - eyeY) / fs, lipTopY = (Math.max(lipTop, mouth.y) - eyeY) / fs;
      const fit = h.fit, main = h.subWeights.idx;
      const g = (d2, r) => Math.exp(-d2 / (r * r));
      const d2 = (x, y, z, p) => (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) + (z - p.z) * (z - p.z);
      // gaussian falloff from a segment (face units)
      const seg = (X, Y, ax, ay, bx, by, r) => {
        const vx = bx - ax, vy = by - ay, t = clamp01(((X - ax) * vx + (Y - ay) * vy) / (vx * vx + vy * vy));
        const dx = X - ax - vx * t, dy = Y - ay - vy * t;
        return Math.exp(-(dx * dx + dy * dy) / (r * r));
      };
      const band = (v, a, b, e) => smooth01(a - e, a + e, v) * (1 - smooth01(b - e, b + e, v));
      let beauty = -1, beautyD = Infinity;

      for (let i = 0; i < n; i++) {
        const o = i * 3, x = R[o], y = R[o + 1], z = R[o + 2], nx = Nr[o], ny = Nr[o + 1], nz = Nr[o + 2];
        const w = i * NC;
        const head = W[w], neck = W[w + 1], chest = W[w + 2], shoulder = W[w + 3], uarm = W[w + 4], farm = W[w + 5];
        const hand = W[w + 6], finger = W[w + 7], thigh = W[w + 8], shin = W[w + 9], foot = W[w + 10], toe = W[w + 11];
        const lowTrunk = Math.max(0, 1 - head - neck - chest - shoulder - uarm - farm - hand - finger - thigh - shin - foot - toe);
        const lip = reg[i * 4], lid = reg[i * 4 + 1], face = reg[i * 4 + 2], ear = reg[i * 4 + 3];
        const nail = reg2[i * 4], mouthIn = reg2[i * 4 + 2];
        const S = sides[x >= 0 ? 0 : 1], sx = x >= 0 ? 1 : -1;
        const front = Math.max(0, nz);

        // face
        let noseM = 0, cheekM = 0, foreM = 0, eyeM = 0, tzone = 0, chinM = 0, under = 0, templeM = 0;
        let contour = 0, hilite = 0, blushHi = 0, faceMk = 0;
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
          templeM = head * g(d2(x, y, z, S.temple), 0.02 * fs) * (1 - ear);
          // makeup zones in face units: X out from the midline, Y up from the eyes
          const X = Math.abs(x) / fs, Y = fy, side = smooth01(0.15, 0.55, Math.abs(nx)), facing = smooth01(0.1, 0.5, nz);
          faceMk = Math.max(face, head * (1 - ear) * smooth01(-0.3, 0.2, nz) * 0.7, neck * front * 0.4) * (1 - lip) * (1 - mouthIn);
          contour = faceMk * Math.min(1,
            seg(X, Y, 0.066, 0.42 * mY, 0.042, 0.72 * mY, 0.0085) * side // under the cheekbone
            + 0.7 * head * smooth01(-0.15, -0.6, ny) * smooth01(mY - 0.06, mY - 0.03, Y) * (1 - smooth01(0.6, 0.85, nz)) // jawline
            + 0.6 * g((X - 0.011) ** 2, 0.0035) * band(Y, 0.55 * mY, -0.004, 0.006) * (1 - smooth01(0.85, 0.97, nz)) // sides of the nose
            + 0.55 * smooth01(0.048, 0.066, X) * smooth01(-0.005, 0.02, Y) * (1 - ear)); // temples
          hilite = faceMk * facing * Math.min(1,
            seg(X, Y, 0.03, 0.4 * mY, 0.056, 0.27 * mY, 0.0075) // cheekbones
            + 0.8 * g(X * X, 0.0035) * band(Y, 0.6 * mY, -0.01, 0.006) * smooth01(0.7, 0.95, nz) // nose bridge
            + 0.6 * seg(X, Y, 0.022, 0.017, 0.045, 0.013, 0.006) // brow bone
            + 0.9 * g(X * X + (Y - lipTopY - 0.003) ** 2, 0.004) // cupid's bow
            + 0.5 * g(X * X + (Y - (mY - 0.035)) ** 2, 0.008)); // chin
          blushHi = faceMk * facing * seg(X, Y, 0.042, 0.5 * mY, 0.066, 0.05 * mY, 0.011);
          // beauty mark: above the left corner of the mouth
          const bd = (x - 0.021 * fs) ** 2 + (y - mouth.y - 0.017 * fs) ** 2;
          if (face > 0.5 && nz > 0.4 && bd < beautyD) { beautyD = bd; beauty = i; }
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
        const armpit = (shoulder + uarm + chest) * g(d2(x, y, z, S.shoulder), 0.07) * smooth01(0.1, 0.6, -ny);
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

        // swimwear cover for tan lines: bikini (cups, band, straps, briefs) or trunks
        let bikini = 0, trunks = 0;
        const trunkish = Math.max(0, 1 - head - handAll - farm - 0.8 * uarm - shin - foot - toe);
        if (trunkish > 0.2) {
          const e = 0.005;
          const cup = ((x - S.nip.x) / (0.07 * hs)) ** 2 + ((y - S.nip.y - 0.008 * hs) / (0.062 * hs)) ** 2;
          const cupM = (1 - smooth01(0.75, 1.05, cup)) * smooth01(-0.3, 0.1, nz);
          const bandM = band(y, underY - 0.006, underY + 0.012, e) * (chest + lowTrunk);
          const strapM = (1 - smooth01(0.005, 0.005 + e, Math.abs(Math.abs(x) - strapX))) * smooth01(underY, underY + 0.02, y) * (1 - neck) * (chest + shoulder);
          const t = Math.min(1, Math.abs(x) / hipHalf);
          const legF = crotch + (topY - 0.035 * hs - crotch) * Math.pow(t, 1.6), legB = crotch - 0.02 * hs + (topY - 0.09 * hs - crotch) * Math.pow(t, 1.2);
          const leg = legB + (legF - legB) * smooth01(-0.3, 0.3, nz);
          const briefs = smooth01(leg - e, leg + e, y) * (1 - smooth01(topY - e, topY + e, y));
          bikini = trunkish * Math.max(cupM, bandM, strapM, briefs);
          trunks = trunkish * band(y, hip.y - 0.17 * hs, topY, e) * (1 - chest);
        }
        // stretch marks: around the hips and outer thighs, fanning out from the
        // navel on the lower belly and from the nipple on the breasts
        let st = 0, axx = 0, axy = 0, axz = 0;
        {
          const hipM = (thigh + lowTrunk) * band(y, crotch - 0.13 * hs, topY + 0.04 * hs, 0.03 * hs) * Math.max(smooth01(0.2, 0.65, Math.abs(nx)), 0.8 * smooth01(0.0, -0.5, nz)) * (1 - handAll);
          if (hipM > 0.01) { st = hipM; axx = -nx * ny; axy = 1 - ny * ny; axz = -nz * ny; }
          const bellyM = lowTrunk * smooth01(0.25, 0.6, nz) * band(y, hip.y, navel.y + 0.01, 0.02 * hs) * smooth01(0.02, 0.06, Math.abs(x));
          if (bellyM > st) { st = bellyM; const rx = x - navel.x, ry = y - navel.y; axx = ny * 0 - nz * ry; axy = nz * rx; axz = nx * ry - ny * rx; }
          const dn = Math.sqrt(d2(x, y, z, S.nip));
          const brM = Math.min(1, BW[i] * 1.5) * band(dn, 0.035 * hs, 0.1 * hs, 0.012 * hs) * smooth01(-0.2, 0.3, nz);
          if (brM > st) { st = brM; const rx = x - S.nip.x, ry = y - S.nip.y, rz = z - S.nip.z; axx = ny * rz - nz * ry; axy = nz * rx - nx * rz; axz = nx * ry - ny * rx; }
          const l = Math.hypot(axx, axy, axz) || 1;
          st = Math.min(1, st) / l;
        }

        // pigment and blood masks for the colour pass
        const blood = 0.55 * ear + 0.4 * noseM + 0.2 * cheekM + 0.22 * lid + 0.14 * handAll + 0.28 * tip * handAll
          + 0.16 * (foot + toe) + 0.25 * toeK * toe + 0.35 * kneeM + 0.3 * elbowM + 0.4 * knuck * dorsal * handAll + 0.12 * chinM
          + 0.08 * neck * front + 0.05 * exposed;
        const pigment = 0.35 * kneeM + 0.45 * elbowM + 0.6 * knuck * dorsal * handAll + 0.3 * lid + 0.25 * armpit + 0.25 * toeK * toe * (1 - sole);
        const m = i * MC;
        M[m] = Math.min(1.2, blood);
        M[m + 1] = pigment;
        M[m + 2] = Math.max(palmM * (1 - nail), sole);
        M[m + 3] = cheekM;
        M[m + 4] = contour;
        M[m + 5] = hilite;
        M[m + 6] = under;
        M[m + 7] = exposed;
        M[m + 8] = blushHi;
        M[m + 9] = bikini;
        M[m + 10] = trunks;
        M[m + 11] = faceMk;

        // shader masks
        const q = i * 4;
        A[q] = Math.min(1, cheekM * 1.1 + 0.8 * ear + 0.7 * noseM + 0.3 * foreM + 0.25 * chinM + 0.45 * neck * front
          + 0.35 * chest * front * smooth01(chestBot, chestTop, y));
        A[q + 1] = Math.min(1, face * (0.3 + 0.7 * Math.max(noseM * 1.3, cheekM * 1.2)) + 0.9 * shoulder + 0.5 * chest * smooth01(chestBot, chestTop, y)
          + 0.6 * uarm + 0.45 * farm * (0.4 + 0.6 * dorsal) + 0.3 * handAll * dorsal);
        A[q + 2] = Math.min(1, farm * volar * 0.9 + handAll * dorsal * 0.7 * (1 - knuck) + uarm * 0.5 * smooth01(0, 0.6, -nx * sx)
          + templeM * 0.7 + foot * smooth01(0.2, 0.7, ny) * 0.5 + chest * front * 0.25 + neck * 0.2 + thigh * 0.15 * smooth01(0, 0.6, -nx * sx));
        A[q + 3] = Math.min(1, ear + 0.6 * finger + 0.2 * hand + 0.3 * toe + 0.6 * noseM * smooth01(0.0, -0.6, ny + 0.3) + 0.4 * lid + 0.15 * lip);
        B[q] = -0.08 * tzone - 0.13 * lip - 0.32 * nail - 0.38 * mouthIn - 0.04 * lid + 0.12 * (elbowM + kneeM) + 0.07 * palmM + 0.12 * sole
          + 0.05 * (1 - face) * (1 - lip);
        B[q + 1] = crease;
        B[q + 2] = foreM;
        B[q + 3] = eyeM;
        C[q] = ax[0] * spacing; C[q + 1] = ax[1] * spacing; C[q + 2] = ax[2] * spacing;
        Dd[q] = axx * st; Dd[q + 1] = axy * st; Dd[q + 2] = axz * st; Dd[q + 3] = hilite;
      }
      this.beauty = beauty >= 0 ? P(beauty) : null;
      this.ambientOcclusion(R, Nr, C);
      this.A.needsUpdate = this.B.needsUpdate = this.C.needsUpdate = this.Dm.needsUpdate = true;
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

    // The eye opening as seen from the front (the nearest skin in front of
    // the eyeball in each direction), with its corners and two lash-line
    // curves fitted to it: makeup is drawn in this frame.
    fitLids(U, eL, rad) {
      const R = this.h.restAttr.array, W = this.W, n = this.n;
      const f = _f.set(0.3, 0, 1).normalize(), ex = _ex.set(1, 0, 0).addScaledVector(f, -f.x).normalize(), ey = _ey.crossVectors(f, ex);
      const NB = 96, best = new Float32Array(NB).fill(Infinity), pa = new Float32Array(NB), pb = new Float32Array(NB);
      const lim = (1.8 * rad) ** 2;
      for (let i = 0; i < n; i++) {
        if (W[i * NC] < 0.5) continue;
        const dx = R[i * 3] - eL.x, dy = R[i * 3 + 1] - eL.y, dz = R[i * 3 + 2] - eL.z;
        const a = dx * ex.x + dy * ex.y + dz * ex.z, b = dx * ey.x + dy * ey.y + dz * ey.z, c = dx * f.x + dy * f.y + dz * f.z;
        const r2 = a * a + b * b;
        if (r2 > lim || c < Math.sqrt(Math.max(0, rad * rad - r2)) - 0.0004) continue; // behind the eyeball: hidden
        const k = Math.floor((Math.atan2(b, a) / (2 * Math.PI) + 0.5) * NB) % NB;
        if (r2 < best[k]) { best[k] = r2; pa[k] = a; pb[k] = b; }
      }
      let ia = -1, oa = -1;
      for (let k = 0; k < NB; k++) if (best[k] < Infinity) { if (ia < 0 || pa[k] < pa[ia]) ia = k; if (oa < 0 || pa[k] > pa[oa]) oa = k; }
      if (ia < 0 || oa === ia) return;
      const ix = pa[ia], iy = pb[ia], wx = pa[oa] - ix, wy = pb[oa] - iy, Wd = Math.hypot(wx, wy), cx = wx / Wd, cy = wy / Wd;
      // v = u(1-u)(c0 + c1 u) by least squares, for each lid
      const S = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
      for (let k = 0; k < NB; k++) {
        if (best[k] === Infinity) continue;
        const qa = pa[k] - ix, qb = pb[k] - iy, u = (qa * cx + qb * cy) / Wd, v = (qb * cx - qa * cy) / Wd;
        if (u < 0.03 || u > 0.97) continue;
        const s = S[v >= 0 ? 0 : 1], p0 = u * (1 - u), p1 = p0 * u, y = Math.abs(v);
        s[0] += p0 * p0; s[1] += p0 * p1; s[2] += p1 * p1; s[3] += p0 * y; s[4] += p1 * y;
      }
      const solve = (s) => { const det = s[0] * s[2] - s[1] * s[1]; return Math.abs(det) < 1e-12 ? [0.6, 0] : [(s[3] * s[2] - s[4] * s[1]) / det, (s[0] * s[4] - s[1] * s[3]) / det]; };
      const up = solve(S[0]), lo = solve(S[1]);
      U.uMkO.value.copy(eL).addScaledVector(ex, ix).addScaledVector(ey, iy);
      U.uMkX.value.set(0, 0, 0).addScaledVector(ex, cx / Wd).addScaledVector(ey, cy / Wd);
      U.uMkY.value.set(0, 0, 0).addScaledVector(ey, cx / Wd).addScaledVector(ex, -cy / Wd);
      U.uLidFit.value.set(up[0], up[1], lo[0], lo[1]);
      this.lidWidth = Wd;
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
      const reg = this.geo.attributes.region.array, reg2 = this.geo.attributes.region2.array;
      const tone = clamp01(p.skinTone ?? 0.35), under = p.undertone ?? 0.5, ageN = clamp01(((p.age ?? 28) - 22) / 60);
      const dark = smooth01(0.25, 0.85, tone), fair = 1 - dark;
      const blush = p.blush ?? 0.25, lipC = p.lipColor ?? 0.35;
      const base = skinBase(tone, under, ageN);
      const L = lum(base);
      const palm = toneAt(tone * 0.38).multiplyScalar(0.8);
      palm.g *= 0.92; palm.b *= 0.9;
      const lipCol = naturalLip(base, lipC, ageN);
      const areola = base.clone().multiply(new THREE.Color(0.66, 0.46, 0.44)).lerp(lin('#b87a70').multiplyScalar(Math.pow(L / 0.36, 0.8)), 0.3);
      const nailCol = lin('#efc9c0').lerp(base, 0.25).multiplyScalar(0.85);
      const mouthCol = lin('#7c2a30');
      const mk = makeupLook(p, base, lipCol), F = mk.face ? mk : null;
      const bloodT = [1, 0.74, 0.72], melT = [0.66, 0.55, 0.48];
      const bv = 0.4 + 0.6 * fair; // blood shows less through dark skin
      const tan = clamp01(p.tanLines ?? 0), fem = 1 - smooth01(0.35, 0.65, p.gender ?? 0.5);
      // products as [target r, g, b] for the inner loop
      const blushT = F && F.blushT, lipT = F && F.lipT, nailT = mk.nailT;
      const lipDeep = F ? F.lipT.clone().multiplyScalar(0.62) : null;
      for (let i = 0; i < n; i++) {
        const m = i * MC;
        let r = base.r, g = base.g, b = base.b;
        // foundation hides the person's own redness and shadows on the face
        const fd = F ? F.found * M[m + 11] : 0;
        const bl = Math.min(1.4, M[m] * bv * (1 - 0.55 * fd) + blush * (0.6 + 0.4 * fair) * M[m + 3] * 0.9 * (1 - 0.7 * fd) + M[m + 7] * 0.04 * ageN);
        r *= 1 - bl * (1 - bloodT[0]); g *= 1 - bl * (1 - bloodT[1]); b *= 1 - bl * (1 - bloodT[2]);
        const conceal = F ? 1 - 0.8 * F.conceal * M[m + 11] : 1;
        const mel = M[m + 1] * (0.15 + 0.85 * dark) * (1 - 0.5 * fd) + M[m + 6] * (0.25 + 0.5 * dark) * conceal + M[m + 7] * 0.05;
        r *= 1 - mel * (1 - melT[0]); g *= 1 - mel * (1 - melT[1]); b *= 1 - mel * (1 - melT[2]);
        if (M[m + 6] > 0) { const u = M[m + 6] * 0.35 * fair * conceal; g *= 1 - 0.05 * u; b *= 1 + 0.08 * u; }
        const pm = M[m + 2] * (0.25 + 0.6 * dark);
        r += (palm.r - r) * pm; g += (palm.g - g) * pm; b += (palm.b - b) * pm;
        // tan lines: what a swimsuit covered stays paler
        if (tan > 0) {
          const cv = tan * (M[m + 9] * fem + M[m + 10] * (1 - fem));
          r *= 1 + 0.17 * cv; g *= 1 + 0.24 * cv; b *= 1 + 0.3 * cv;
        }
        if (F) {
          r += (base.r * 1.01 - r) * 0.45 * fd; g += (base.g * 1.01 - g) * 0.45 * fd; b += (base.b * 1.01 - b) * 0.45 * fd;
          const ct = F.contour * M[m + 4];
          r *= 1 - 0.2 * ct; g *= 1 - 0.27 * ct; b *= 1 - 0.29 * ct;
          const hl = F.highlight * M[m + 5];
          r *= 1 + 0.1 * hl; g *= 1 + 0.09 * hl; b *= 1 + 0.07 * hl;
          const bm = F.blush * 0.7 * (M[m + 3] * (1 - F.lift) + M[m + 8] * F.lift);
          r += (blushT.r * r / base.r - r) * bm; g += (blushT.g * g / base.g - g) * bm; b += (blushT.b * b / base.b - b) * bm;
        }
        const li = smooth01(0.15, 0.85, reg[i * 4]);
        r += (lipCol.r - r) * li; g += (lipCol.g - g) * li; b += (lipCol.b - b) * li;
        if (F && F.lip > 0) {
          // lipstick has a crisper edge than the lips' own colour, and a liner traces it
          const lr = reg[i * 4], lc = smooth01(0.3, 0.6, lr) * F.lip * 0.95;
          r += (lipT.r - r) * lc; g += (lipT.g - g) * lc; b += (lipT.b - b) * lc;
          const ll = F.lipLiner * 0.45 * smooth01(0.25, 0.4, lr) * (1 - smooth01(0.48, 0.7, lr));
          r += (lipDeep.r - r) * ll; g += (lipDeep.g - g) * ll; b += (lipDeep.b - b) * ll;
        }
        const ar = smooth01(0.1, 0.7, reg2[i * 4 + 1]);
        r += (areola.r - r) * ar; g += (areola.g - g) * ar; b += (areola.b - b) * ar;
        const na = smooth01(0.2, 0.8, reg2[i * 4]);
        r += (nailCol.r - r) * na; g += (nailCol.g - g) * na; b += (nailCol.b - b) * na;
        if (mk.nail > 0) {
          const pc = smooth01(0.35, 0.75, reg2[i * 4]) * mk.nail * 0.97;
          r += (nailT.r - r) * pc; g += (nailT.g - g) * pc; b += (nailT.b - b) * pc;
        }
        const mo = smooth01(0.0, 0.6, reg2[i * 4 + 2]);
        r += (mouthCol.r - r) * mo; g += (mouthCol.g - g) * mo; b += (mouthCol.b - b) * mo;
        col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      }
      this.color.needsUpdate = true;

      U.uDark.value = dark;
      U.uShine.value = p.skinShine ?? 0.4;
      U.uRough.value = 0.64 - 0.22 * (p.skinShine ?? 0.4) + 0.05 * ageN - 0.04 * dark;
      U.uFreckle.value = p.freckles ?? 0;
      U.uVein.value = (p.veins ?? 0.2) * (1 + 0.6 * ageN);
      U.uAge.value = ageN;
      U.uFuzz.value = 0.12 + 0.3 * (p.bodyHair ?? 0.15);
      // scattering looks warmer and reaches less far through darker skin
      U.uWrap.value.set(0.36 - 0.1 * dark, 0.13 - 0.03 * dark, 0.08 - 0.02 * dark);
      U.uScatter.value.set(1.0, 0.3 + 0.05 * dark, 0.16).multiplyScalar(1.1 - 0.45 * dark);
      // variety
      U.uBase.value.set(base.r, base.g, base.b);
      const moles = clamp01(p.moles ?? 0);
      U.uMoles.value = moles;
      if (this.beauty && moles > 0.3) U.uBeauty.value.set(this.beauty.x, this.beauty.y, this.beauty.z, 0.0011 + 0.0004 * moles);
      else U.uBeauty.value.w = 0;
      U.uVitiligo.value = clamp01(p.vitiligo ?? 0);
      const vit = skinBase(0, under, ageN).multiply(new THREE.Color(1.02, 0.95, 0.95));
      U.uVitCol.value.set(vit.r, vit.g, vit.b);
      U.uStretch.value = clamp01(p.stretchMarks ?? 0);
      // makeup
      U.uNail.value = mk.nail;
      U.uFound.value.set(F ? F.found : 0, F ? F.finish : 0);
      U.uLip.value.set(F ? F.lip : 0, F ? F.gloss : 0.5);
      U.uHiLite.value = F ? F.highlight * F.glow : 0;
      U.uMkA.value.set(F ? F.shadow : 0, F ? F.liner : 0, F ? F.wing : 0, F ? F.lower : 0);
      U.uMkB.value.set(F ? F.mascara : 0, F ? F.smoky : 0, F ? F.shimmer : 0, F ? F.thick : 0);
      U.uMkC.value.set(0.3 * (F ? F.spread : 1), F ? F.outerV : 0, F ? F.inner : 0, 0.35);
      const set3 = (u, c) => u.value.set(c.r, c.g, c.b);
      if (F) { set3(U.uMkLid, F.lidT); set3(U.uMkCrease, F.creaseT); set3(U.uMkLiner, F.linerT); set3(U.uMkHi, F.innerT); }
      else U.uMkLiner.value.set(0.022, 0.012, 0.009);
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
  function eyeTexture(size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { canvas, tex };
  }

  BS.makeEyeMaterial = function () {
    const { canvas, tex } = eyeTexture(1024);
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
    if (typeof het === 'string' && (C[het] || HEX.test(het))) second = C[het] || het;
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

  // ------------------------------------------------------------- module
  class SkinModule {
    constructor(app) {
      const h = (this.human = app.human);
      this.app = app;
      this.U = h.skinUniforms;
      const q = app.query || new URLSearchParams('');
      const qual = (this.qual = app.quality === 'low' ? 0 : app.quality === 'medium' ? 1 : 2);
      this.ghost = [];
      this.own = []; // materials this instance made (freed in dispose)
      const ours = this.U && h.skinMat.defines && 'SKIN_Q' in h.skinMat.defines;
      if (ours) {
        h.skinMat.defines.SKIN_Q = qual;
        h.skinMat.sheen = qual ? 1 : 0;
        h.skinMat.clearcoat = qual ? 1 : 0;
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
        const old = part.mesh.material;
        part.mesh.material = makeMouthMaterial(kind, this.MU);
        if (!old.userData.bsSkin) old.dispose(); // human.js's plain stand-in
        part.mesh.material.userData.bsSkin = true;
        part.mesh.receiveShadow = true;
        this.ghost.push(part.mesh.material);
        this.own.push(part.mesh.material);
      }
      // dev params: ?xray=1 &flush= &wet= &pupil= &skindebug=flush|freckle|vein|thin|rough|wrinkle|ao|albedo|normal|region|region2|axis|stretch|hilite|eyeframe
      for (const k of ['xray', 'flush', 'wet', 'pupil']) {
        if (q.get(k) !== null) this.U['u' + k[0].toUpperCase() + k.slice(1)].value = parseFloat(q.get(k)) || 0;
      }
      if (this.U.uDebug && q.get('skindebug')) this.U.uDebug.value = DEBUG_MODES[q.get('skindebug')] || 0;
      if (this.U.uFlushS) { this.U.uFlushS.value = this.U.uFlush.value; this.U.uWetS.value = this.U.uWet.value; }
      this.xray = false;
      this._v = new THREE.Vector3();
      this._v2 = new THREE.Vector3();
    }

    _setupEyes(qual) {
      const h = this.human, eyes = h.eyes;
      const mat = h.eyeMat;
      const eye = (this.eye = mat && mat.userData.eye);
      if (!eyes || !eye) return;
      const EU = eye.uniforms;
      EU.uXray = this.U.uXray;
      // a distant game person gets a smaller eye texture
      const size = qual === 0 ? 512 : 1024;
      if (eye.canvas.width !== size) {
        eye.tex.dispose();
        Object.assign(eye, eyeTexture(size), { key: '' });
        mat.map = eye.tex;
      }
      // split the cornea shell into its own group and material
      const geo = eyes.geometry, uv = geo.attributes.uv.array, nc = uv.length / 2;
      if (!geo.groups.length) {
        const ball = [], cornea = [];
        for (let t = 0; t < nc; t += 3) (uv[t * 2] > 0.85 && uv[t * 2 + 1] < 0.15 ? cornea : ball).push(t, t + 1, t + 2);
        geo.setIndex(ball.concat(cornea));
        geo.addGroup(0, ball.length, 0);
        geo.addGroup(ball.length, cornea.length, 1);
      }
      this.cornea = makeCorneaMaterial(EU);
      this.own.push(this.cornea);
      eyes.material = [mat, this.cornea];
      eyes.receiveShadow = true;
      this.ghost.push(mat);
      // smooth normals: corners that share a MakeHuman vertex share a normal
      if (!h._skinEyeHook) {
        h._skinEyeHook = true;
        const E = h.D.eye, corner = new Uint32Array(nc);
        for (let i = 0; i < nc; i++) corner[i] = E.tris[i * 2];
        const acc = new Float32Array(E.nVerts * 3);
        h.addShapeListener(() => {
          const N = geo.attributes.normal.array;
          acc.fill(0);
          for (let i = 0; i < nc; i++) { const v = corner[i] * 3; acc[v] += N[i * 3]; acc[v + 1] += N[i * 3 + 1]; acc[v + 2] += N[i * 3 + 2]; }
          for (let i = 0; i < nc; i++) {
            const v = corner[i] * 3, l = Math.hypot(acc[v], acc[v + 1], acc[v + 2]) || 1;
            N[i * 3] = acc[v] / l; N[i * 3 + 1] = acc[v + 1] / l; N[i * 3 + 2] = acc[v + 2] / l;
          }
          geo.attributes.normal.needsUpdate = true;
        });
      }
      this.iEye = [h.boneIndex('eye.L'), h.boneIndex('eye.R')];
      this.iHead = h.boneIndex('head');
    }

    onParams(p) {
      const h = this.human;
      if (this.baker) {
        // the human may have swapped its body geometry (detail level)
        if (this.baker.geo !== h.bodyGeo || this.baker.n !== h.S.nOut) this.baker = new SkinBaker(h);
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

    dispose() {
      const h = this.human;
      if (this.xray) { for (const m of this.ghost) { m.transparent = false; m.depthWrite = true; m.needsUpdate = true; } h.body.castShadow = true; }
      if (this.eye && h.eyes) h.eyes.material = h.eyeMat;
      for (const m of this.own) m.dispose();
      this.own.length = 0;
      this.baker = null;
    }
  }

  BS.registerModule({ name: 'skin', order: 30, create: (app) => new SkinModule(app) });
})();
