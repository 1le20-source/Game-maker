// Body Studio fabric engine: procedural cloth materials (weave/knit relief,
// yarn colour, prints and sheen) for garments on the body and for home and spa
// textiles. Everything is computed in the shader from cloth coordinates in
// meters, so threads keep their real size on any mesh and fade out smoothly
// when they get smaller than a pixel. One shader program serves every fabric
// type and pattern (they are uniforms), per space ('uv' / 'restPos' / garment).
//
//   BS.Fabric.material(spec, opts) -> MeshPhysicalMaterial
//     spec: { type, color, color2, pattern, scale, roughness?, sheen?, thread? }
//     opts: { skinned, space: 'uv' | 'restPos', repeat | size: [w, h] meters
//             spanned by uv 0..1 (default [1, 1]), side, garment }
//   BS.Fabric.update(material, spec)
//   BS.Fabric.TYPES, BS.Fabric.PATTERNS: [{ id, label, ... }]
//   BS.Fabric.spec(spec): spec with every field filled in
//
// Garment mode (opts.garment, used by clothing.js) reads cloth coordinates
// from the geometry: aCloth = (cos a, sin a, C, v) where u = a / 2pi * C is
// the arc length around the body part (wrap-safe) and v the length along it,
// and aWarp = the rest-space direction of the warp threads. clothing.js adds
// seams, hems and construction details through the '// @garment' hooks.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const THREE = window.THREE;

  // weave kinds understood by the shader
  const W = { plain: 0, twill: 1, satin: 2, jersey: 3, rib: 4, terry: 5, pile: 6, leather: 7, lace: 8, rubber: 9 };
  // density = threads (or stitches, loops, grain cells) per meter; bump =
  // relief strength; slub = yarn irregularity; fuzz = fibre haze; weft =
  // how white the weft yarn is (denim); crush = pile direction mottling.
  // gsm, stretch, stiffness and thickness are physical hints for cloth sims.
  const T = (id, label, o) => Object.assign({ id, label, slub: 0.2, fuzz: 0.2, weft: 0, crush: 0, sheenRough: 0.6, spec: 0.4 }, o);
  const TYPES = [
    T('cotton', 'Cotton', { weave: W.plain, density: 3400, bump: 0.5, slub: 0.25, fuzz: 0.3, rough: 0.8, sheen: 0.3, sheenRough: 0.7, gsm: 140, stretch: 0.05, stiffness: 0.35, thickness: 0.0004 }),
    T('jersey', 'Jersey knit', { weave: W.jersey, density: 1500, bump: 0.55, slub: 0.15, fuzz: 0.35, rough: 0.86, sheen: 0.35, sheenRough: 0.75, gsm: 170, stretch: 0.45, stiffness: 0.15, thickness: 0.0006 }),
    T('denim', 'Denim', { weave: W.twill, density: 2300, bump: 0.8, slub: 0.7, fuzz: 0.25, weft: 0.72, rough: 0.82, sheen: 0.2, sheenRough: 0.8, gsm: 400, stretch: 0.08, stiffness: 0.75, thickness: 0.0011 }),
    T('linen', 'Linen', { weave: W.plain, density: 1900, bump: 0.65, slub: 1.0, fuzz: 0.15, rough: 0.76, sheen: 0.2, sheenRough: 0.6, gsm: 160, stretch: 0.02, stiffness: 0.6, thickness: 0.0005 }),
    T('silk', 'Silk', { weave: W.plain, density: 9000, bump: 0.15, slub: 0.35, fuzz: 0.05, rough: 0.34, sheen: 0.7, sheenRough: 0.35, spec: 0.6, gsm: 60, stretch: 0.05, stiffness: 0.1, thickness: 0.0002 }),
    T('satin', 'Satin', { weave: W.satin, density: 7000, bump: 0.12, slub: 0.1, fuzz: 0.03, rough: 0.24, sheen: 0.55, sheenRough: 0.3, spec: 0.75, gsm: 110, stretch: 0.03, stiffness: 0.2, thickness: 0.0003 }),
    T('wool', 'Wool', { weave: W.twill, density: 1700, bump: 0.45, slub: 0.35, fuzz: 0.7, rough: 0.92, sheen: 0.45, sheenRough: 0.9, gsm: 280, stretch: 0.08, stiffness: 0.5, thickness: 0.0012 }),
    T('knit', 'Chunky knit', { weave: W.rib, density: 420, bump: 1.0, slub: 0.3, fuzz: 0.55, rough: 0.95, sheen: 0.35, sheenRough: 0.9, gsm: 450, stretch: 0.5, stiffness: 0.25, thickness: 0.004 }),
    T('fleece', 'Fleece', { weave: W.pile, density: 900, bump: 0.35, slub: 0.1, fuzz: 0.9, rough: 1, sheen: 0.6, sheenRough: 1, gsm: 260, stretch: 0.25, stiffness: 0.3, thickness: 0.003 }),
    T('terry', 'Terry towelling', { weave: W.terry, density: 420, bump: 1.0, slub: 0.2, fuzz: 0.7, rough: 1, sheen: 0.4, sheenRough: 1, gsm: 500, stretch: 0.1, stiffness: 0.35, thickness: 0.005 }),
    T('leather', 'Leather', { weave: W.leather, density: 700, bump: 0.45, slub: 0.3, fuzz: 0, rough: 0.42, sheen: 0.05, sheenRough: 0.5, spec: 0.55, gsm: 1100, stretch: 0.02, stiffness: 0.9, thickness: 0.0015 }),
    T('lace', 'Lace', { weave: W.lace, density: 260, bump: 0.7, slub: 0.05, fuzz: 0.1, rough: 0.7, sheen: 0.35, sheenRough: 0.5, gsm: 90, stretch: 0.2, stiffness: 0.15, thickness: 0.0006 }),
    T('nylon', 'Nylon', { weave: W.plain, density: 8000, bump: 0.12, slub: 0.05, fuzz: 0.02, rough: 0.42, sheen: 0.3, sheenRough: 0.4, spec: 0.6, gsm: 70, stretch: 0.1, stiffness: 0.2, thickness: 0.0002 }),
    T('spandex', 'Spandex', { weave: W.jersey, density: 5200, bump: 0.18, slub: 0.05, fuzz: 0.02, rough: 0.38, sheen: 0.35, sheenRough: 0.4, spec: 0.6, gsm: 200, stretch: 0.9, stiffness: 0.1, thickness: 0.0005 }),
    T('canvas', 'Canvas', { weave: W.plain, density: 1100, bump: 0.85, slub: 0.45, fuzz: 0.2, rough: 0.86, sheen: 0.15, sheenRough: 0.8, gsm: 450, stretch: 0.02, stiffness: 0.85, thickness: 0.0012 }),
    T('velvet', 'Velvet', { weave: W.pile, density: 6000, bump: 0.12, slub: 0.05, fuzz: 0.3, crush: 0.6, rough: 0.8, sheen: 1.0, sheenRough: 0.42, spec: 0.3, gsm: 300, stretch: 0.05, stiffness: 0.4, thickness: 0.0018 }),
    T('microfiber', 'Microfiber', { weave: W.pile, density: 9000, bump: 0.08, slub: 0.05, fuzz: 0.25, crush: 0.15, rough: 0.68, sheen: 0.5, sheenRough: 0.55, gsm: 180, stretch: 0.15, stiffness: 0.2, thickness: 0.0008 }),
    T('rubber', 'Rubber (mats)', { weave: W.rubber, density: 220, bump: 0.5, slub: 0.05, fuzz: 0, rough: 0.72, sheen: 0.02, sheenRough: 0.5, spec: 0.35, gsm: 1800, stretch: 0.3, stiffness: 0.7, thickness: 0.005 }),
  ];
  // size = repeat in meters at scale 1
  const PATTERNS = [
    { id: 'solid', label: 'Solid', size: 0 }, { id: 'stripes', label: 'Stripes', size: 0.025 },
    { id: 'pinstripe', label: 'Pinstripe', size: 0.012 }, { id: 'plaid', label: 'Plaid', size: 0.08 },
    { id: 'gingham', label: 'Gingham', size: 0.012 }, { id: 'dots', label: 'Polka dots', size: 0.022 },
    { id: 'floral', label: 'Floral', size: 0.07 }, { id: 'camo', label: 'Camo', size: 0.18 },
    { id: 'herringbone', label: 'Herringbone', size: 0.012 }, { id: 'heather', label: 'Heather', size: 0.01 },
    { id: 'chevron', label: 'Chevron', size: 0.04 }, { id: 'paisley', label: 'Paisley', size: 0.09 },
  ];
  const typeById = {}, patIndex = {};
  TYPES.forEach((t) => (typeById[t.id] = t));
  PATTERNS.forEach((p, i) => (patIndex[p.id] = i));

  // ------------------------------------------------------------- shaders
  const NOISE = /* glsl */ `
float fbH(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float fbN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(fbH(i), fbH(i + vec2(1, 0)), f.x), mix(fbH(i + vec2(0, 1)), fbH(i + vec2(1, 1)), f.x), f.y); }
float fbFbm(vec2 p) { return fbN(p) * .5 + fbN(p * 2.03 + 17.1) * .3 + fbN(p * 4.07 + 31.7) * .2; }
vec3 fbVor(vec2 p) {
  vec2 i = floor(p), f = fract(p); float d1 = 8., d2 = 8., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), o = vec2(fbH(i + g), fbH(i + g + 19.7));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = fbH(i + g + 7.3); } else if (d < d2) d2 = d;
  }
  return vec3(d1, d2, id);
}
// antialiased band of width w (0..1 of the period) centred on each half period
float fbBand(float x, float w) {
  float aa = fwidth(x) * .75 + 1e-4, d = abs(fract(x) - .5);
  float m = 1. - smoothstep(w * .5 - aa, w * .5 + aa, d);
  return mix(m, w, smoothstep(w * .6, w * 2., aa));
}
float fbDisc(float d, float r) { float aa = fwidth(d) * .75 + 1e-4; return 1. - smoothstep(r - aa, r + aa, d); }
`;

  const FRAG_PARS = /* glsl */ `
uniform vec3 fabColor;
uniform vec3 fabColor2;
uniform vec3 fabThread;
uniform vec4 fabWeave;   // kind, threads per meter, relief, slub
uniform vec4 fabLook;    // fuzz, weft whiteness, crush, pattern id
uniform vec4 fabMisc;    // pattern size (m), opacity, lining (lace holes), 0
varying vec4 vFab;
#ifdef FAB_REST
varying vec3 vFabN;
#endif
#ifdef FAB_GARMENT
varying vec3 vFabWarp;
// @garment-fragment-pars
#endif
${NOISE}
// weave relief (0..1) at thread coordinates t; warp = 1 where a warp yarn is on top
float fbWeave(vec2 t, float kind, out float warp) {
  vec2 c = floor(t), f = fract(t);
  float pu = 1. - (2. * f.x - 1.) * (2. * f.x - 1.), pv = 1. - (2. * f.y - 1.) * (2. * f.y - 1.);
  warp = .5;
  if (kind < .5) { // plain
    warp = mod(c.x + c.y, 2.);
    return mix(pv * (.5 + .5 * sin(3.1416 * f.x)), pu * (.5 + .5 * sin(3.1416 * f.y)), warp);
  }
  if (kind < 1.5) { // 3/1 right-hand twill: diagonal ribs
    warp = step(.5, mod(c.x - c.y, 4.));
    return mix(pv * .55, .25 + .75 * pu, warp);
  }
  if (kind < 2.5) { // 5-harness satin: long smooth warp floats
    warp = step(.5, mod(c.x * 2. + c.y, 5.));
    return mix(pv * .5, .7 + .3 * pu, warp);
  }
  if (kind < 4.5) { // jersey / rib knit: columns of V-shaped loops
    vec2 g = vec2(t.x, t.y * 1.35); vec2 cc = floor(g), ff = fract(g);
    float x = ff.x - .5;
    float leg = abs(abs(x) - (.06 + .3 * ff.y));
    float h = (1. - smoothstep(.0, .2, leg)) * (.55 + .45 * sin(3.1416 * ff.y));
    if (kind > 3.5) h *= mod(cc.x, 4.) < 1.5 ? 1. : .3 + .2 * sin(6.2832 * ff.y);
    warp = 1.;
    return h;
  }
  if (kind < 5.5) { // terry loops
    vec3 v = fbVor(t);
    warp = v.z;
    return (1. - smoothstep(.0, .55, v.x)) * (.6 + .4 * v.z);
  }
  if (kind < 6.5) { // pile: dense fibre tips
    warp = fbH(c);
    return fbN(t) * .6 + fbN(t * 2.7 + 9.) * .4;
  }
  if (kind < 7.5) { // leather grain: raised cells, creased borders, pores
    vec3 v = fbVor(t);
    warp = v.z;
    float pore = step(.93, fbH(floor(t * 5.))) * .35;
    return smoothstep(.0, .18, v.y - v.x) * (.85 + .15 * fbN(t * 3.)) - pore;
  }
  if (kind < 8.5) { // lace: diamond net
    float n = max(abs(fract(t.x + t.y) - .5), abs(fract(t.x - t.y) - .5));
    warp = 1.;
    return smoothstep(.36, .46, n);
  }
  // rubber mat: staggered round nubs
  vec2 g = vec2(t.x + .5 * mod(floor(t.y), 2.), t.y);
  warp = 1.;
  return smoothstep(.34, .24, length(fract(g) - .5)) * .8 + fbN(t * 9.) * .2;
}

// printed or yarn-dyed pattern; q = cloth coordinates in meters
vec3 fbPattern(vec2 q, vec3 c1, vec3 c2) {
  float id = fabLook.w;
  if (id < .5) return c1;
  vec2 p = q / max(fabMisc.x, 1e-4);
  if (id < 1.5) return mix(c1, c2, fbBand(p.y, .5));                                   // stripes
  if (id < 2.5) return mix(c1, c2, fbBand(p.x, .07));                                  // pinstripe
  if (id < 3.5) {                                                                      // plaid (tartan)
    float a1 = fbBand(p.x, .36), b1 = fbBand(p.y, .36), a2 = fbBand(p.x + .5, .05), b2 = fbBand(p.y + .5, .05);
    float a3 = fbBand(p.x * 2. + .25, .12), b3 = fbBand(p.y * 2. + .25, .12);
    vec3 c = mix(c1, c2, (a1 + b1) * .5);
    c = mix(c, c2 * .55, a1 * b1 * .55);
    c = mix(c, mix(c1, c2, .5) * .8, (a3 + b3) * .25 * (1. - a1) * (1. - b1));
    return mix(c, mix(c2, vec3(1.), .6), max(a2, b2) * .85);
  }
  if (id < 4.5) return mix(c1, c2, (fbBand(p.x, .5) + fbBand(p.y, .5)) * .5);          // gingham
  if (id < 5.5) {                                                                      // polka dots
    vec2 g = vec2(p.x + .5 * mod(floor(p.y), 2.), p.y);
    return mix(c1, c2, fbDisc(length(fract(g) - .5), .27));
  }
  if (id < 6.5) {                                                                      // floral
    vec3 c = c1;
    for (int k = 0; k < 2; k++) {
      vec2 g = p + float(k) * vec2(.5, .37), cell = floor(g);
      vec2 d = fract(g) - .5 - (vec2(fbH(cell), fbH(cell + 3.1)) - .5) * .3;
      float rot = fbH(cell + 7.7) * 6.2832, R = .2 + .08 * fbH(cell + 1.3), r = length(d), a = atan(d.y, d.x) + rot;
      vec2 ld = d - vec2(cos(rot + 1.), sin(rot + 1.)) * R * 1.25;
      float leaf = fbDisc(length(ld * vec2(1., 2.4)), R * .55);
      c = mix(c, mix(c1, vec3(.22, .38, .2), .65), leaf);
      float petal = fbDisc(r / (.55 + .45 * abs(cos(2.5 * a))), R);
      c = mix(c, c2 * (.8 + .4 * r / R), petal);
      c = mix(c, mix(c2, vec3(.95, .78, .3), .7), fbDisc(r, R * .22));
    }
    return c;
  }
  if (id < 7.5) {                                                                      // camo
    vec3 c = c1;
    c = mix(c, c2, smoothstep(.52, .55, fbFbm(p * 2.)));
    c = mix(c, mix(c1, c2, .5) * .55, smoothstep(.56, .59, fbFbm(p * 2.4 + 5.3)));
    return mix(c, c1 * .32, smoothstep(.6, .63, fbFbm(p * 3.1 + 11.7)));
  }
  if (id < 8.5) {                                                                      // herringbone
    float dir = mod(floor(p.x), 2.) * 2. - 1.;
    return mix(c1, c2, fbBand(p.y * 3. + fract(p.x) * 3. * dir, .5) * .85);
  }
  if (id < 9.5) {                                                                      // heather
    float f = step(.78, fbH(floor(q * vec2(2600., 700.)))) * (1. - smoothstep(.0003, .0012, length(fwidth(q))));
    return mix(mix(c1, c2, .2), c2, f) * (.94 + .12 * fbN(q * vec2(900., 120.)));
  }
  if (id < 10.5) return mix(c1, c2, fbBand(p.y + abs(fract(p.x) - .5), .5));           // chevron
  // paisley
  vec2 g = p + vec2(.5 * mod(floor(p.y), 2.), 0.), cell = floor(g);
  vec2 d = fract(g) - .5;
  float rot = (fbH(cell) - .5) * 1.2; d = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * d;
  d.x += d.y * d.y * 1.6 - .05;
  float sd = length(d + vec2(0., .06)) - .2 + max(0., d.y) * .55;
  vec3 c = mix(c1, mix(c1, c2, .35), fbDisc(sd, 0.));
  c = mix(c, c2, fbBand(sd * 14., .3) * step(sd, 0.) );
  c = mix(c, c2, fbDisc(length(d + vec2(0., .1)), .05));
  return mix(c, mix(c2, vec3(1.), .5), fbDisc(abs(sd - .03), .008));
}
`;

  const FRAG_MAIN = /* glsl */ `
// ---- fabric: cloth coordinates (meters) for this fragment
#if defined(FAB_GARMENT)
  float fU = atan(vFab.y, vFab.x) * vFab.z * .159155;
  vec2 fP = vec2(fU, vFab.w);
  vec2 fPm = vec2(abs(fU), vFab.w);     // mirrored about the centre line: prints meet at seams
#elif defined(FAB_REST)
  vec3 fN = normalize(vFabN), fA = abs(fN);
  vec2 fP = fA.x > fA.z ? vec2(vFab.z * sign(fN.x), vFab.y) : vec2(-vFab.x * sign(fN.z), vFab.y);
  vec2 fPm = fP;
#else
  vec2 fP = vFab.xy;
  vec2 fPm = fP;
#endif
  float fFade = 1., fWear = 0., fHd = 0., fAO = 1.;
#ifdef FAB_GARMENT
  // @garment-pre
#endif
  float fKind = fabWeave.x, fDen = fabWeave.y;
  vec2 fT = fP * fDen;
  vec2 fW = fwidth(fP) * fDen;
  float fVis = (1. - smoothstep(.3, .75, max(fW.x, fW.y))) * fFade;   // threads resolvable on screen?
  float fFine = 1. - smoothstep(.0004, .0016, length(fwidth(fP)));     // sub-mm detail resolvable?
  float fWarp;
  float fH = fbWeave(fT, fKind, fWarp);
  float e = .2, fw2;
  vec2 fG = vec2(fbWeave(fT + vec2(e, 0.), fKind, fw2) - fH, fbWeave(fT + vec2(0., e), fKind, fw2) - fH) / e;
  fG *= fabWeave.z * .22 * fVis;
  // yarn colour: slub streaks along the warp, weft yarn colour (denim), fibre haze
  vec3 fBase = fbPattern(fPm, fabColor, fabColor2);
  if (fFade < 1.) fBase = mix(mix(fabColor, fabColor2, fabLook.w > .5 ? .3 : 0.), fBase, fFade);
  float slubW = fbN(vec2(fP.x * 700., fP.y * 22.)) - .5, slubF = fbN(vec2(fP.x * 22., fP.y * 700.)) - .5;
  float slubM = fbN(vec2(fP.x * 160., fP.y * 6.)) - .5;
  vec3 fWeftCol = mix(fBase, vec3(.78, .78, .76), fabLook.y);
  float avgWarp = fKind < .5 ? .5 : fKind < 1.5 ? .7 : fKind < 2.5 ? .8 : 1.;
  vec3 fCol = mix(mix(fWeftCol, fBase, avgWarp), mix(fWeftCol, fBase, fWarp), fVis);
  fCol *= 1. + fabWeave.w * (slubM * .22 + mix(slubF, slubW, fWarp) * .25 * fFine);
  fCol *= mix(1., .62 + .38 * clamp(fH, 0., 1.), fVis * min(1., fabWeave.z));   // shade between yarns
  float fFuzz = fbH(floor(fP * 4000.)) * fFine;
  fCol = mix(fCol, fCol * 1.25 + .02, fabLook.x * .25 * fFuzz);
  if (fabLook.z > 0.) fCol *= 1. + (fbFbm(fP * 22.) - .5) * fabLook.z * .6;        // crushed pile
  float fRough = 1. + (fbN(fP * 40.) - .5) * .15;
  // worn yarn: lighter, fuzzier (denim fades toward its white weft)
  if (fWear > 0.) {
    float wn = fbFbm(fP * vec2(60., 14.));
    fCol = mix(fCol, mix(fCol, fWeftCol, .55) * 1.08 + .015, clamp(fWear * (.55 + wn), 0., 1.) * (.25 + .75 * fabLook.y));
  }
#ifdef FAB_GARMENT
  // @garment-fragment
#endif
  if (fKind > 7.5 && fKind < 8.5) { // lace: holes show the lining (garment) or are cut out
    float lace = max(fH, smoothstep(.5, .56, fbFbm(fP * 45.)));
#ifdef FAB_GARMENT
    fCol = mix(mix(fabColor2, fCol, .25) * .8, fCol, lace);
#else
    if (lace < .5) discard;
#endif
  }
  diffuseColor.rgb = fCol;
  diffuseColor.a *= fabMisc.y;
`;

  const VERT_PARS = /* glsl */ `
varying vec4 vFab;
#ifdef FAB_REST
attribute vec3 restPos;
varying vec3 vFabN;
#endif
#ifdef FAB_GARMENT
attribute vec4 aCloth;
attribute vec3 aWarp;
varying vec3 vFabWarp;
// @garment-vertex-pars
#endif
#ifndef FAB_GARMENT
#ifndef FAB_REST
uniform vec2 fabSize;
#endif
#endif
`;

  function makeMaterial(spec, opts = {}) {
    const mode = opts.garment ? 'garment' : opts.space === 'restPos' ? 'rest' : 'uv';
    const size = opts.size || opts.repeat || [1, 1];
    const U = {
      fabColor: { value: new THREE.Color() }, fabColor2: { value: new THREE.Color() }, fabThread: { value: new THREE.Color() },
      fabWeave: { value: new THREE.Vector4() }, fabLook: { value: new THREE.Vector4() }, fabMisc: { value: new THREE.Vector4(0, 1, 0, 0) },
      fabSize: { value: new THREE.Vector2(size[0], size[1]) },
    };
    const mat = new THREE.MeshPhysicalMaterial({ side: opts.side !== undefined ? opts.side : THREE.DoubleSide, sheen: 0.3, sheenRoughness: 0.6, sheenColor: new THREE.Color(1, 1, 1) });
    mat.defines = Object.assign(mat.defines || {}, mode === 'garment' ? { FAB_GARMENT: '' } : mode === 'rest' ? { FAB_REST: '' } : {});
    mat.userData.fabric = { U, mode, spec: null };
    BS.patch(mat, 'fabric-' + mode, (s) => {
      Object.assign(s.uniforms, U);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
#if defined(FAB_GARMENT)
  vFab = aCloth;
  vec3 fabWarpObj = aWarp;
  #ifdef USE_SKINNING
  fabWarpObj = (skinMatrix * vec4(aWarp, 0.)).xyz;
  #endif
  vFabWarp = normalMatrix * fabWarpObj;
  // @garment-vertex
#elif defined(FAB_REST)
  vFab = vec4(restPos, 0.);
  vFabN = normal;
#else
  vFab = vec4(uv * fabSize, 0., 0.);
#endif`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_MAIN)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * fRough, .05, 1.);')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
#ifdef FAB_GARMENT
  vec3 fB = normalize(vFabWarp - normal * dot(vFabWarp, normal)) * faceDirection;
  vec3 fTn = cross(fB, normal);
#else
  vec3 dp1 = dFdx(-vViewPosition), dp2 = dFdy(-vViewPosition);
  vec2 du1 = dFdx(fP), du2 = dFdy(fP);
  vec3 p2 = cross(dp2, normal), p1 = cross(normal, dp1);
  vec3 fTn = p2 * du1.x + p1 * du2.x, fB = p2 * du1.y + p1 * du2.y;
  float inv = inversesqrt(max(max(dot(fTn, fTn), dot(fB, fB)), 1e-20));
  fTn *= inv; fB *= inv;
#endif
  normal = normalize(normal - fG.x * fTn - fG.y * fB);
  // construction detail relief in meters (seams, hems, pockets, buttons): surface-gradient bump
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  if (abs(det) > 1e-12) normal = normalize(normal - clamp((dFdx(fHd) * r1 + dFdy(fHd) * r2) / det, vec3(-2.), vec3(2.)));
}`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= fAO;
reflectedLight.directDiffuse *= mix(1., fAO, .6);
reflectedLight.indirectSpecular *= fAO;
#ifdef DOUBLE_SIDED
if (!gl_FrontFacing) { reflectedLight.directDiffuse *= .45; reflectedLight.indirectDiffuse *= .6; reflectedLight.directSpecular *= .3; }
#endif`);
    });
    if (opts.skinned) BS.skinned8(mat);
    update(mat, spec);
    return mat;
  }

  const _c = new THREE.Color();
  const DEFAULT = { type: 'cotton', color: '#d9d4cc', color2: '#2d3646', pattern: 'solid', scale: 1 };
  function fullSpec(spec) {
    const s = Object.assign({}, DEFAULT, spec || {});
    if (!typeById[s.type]) s.type = 'cotton';
    if (patIndex[s.pattern] === undefined) s.pattern = 'solid';
    s.scale = Math.max(0.1, Math.min(10, +s.scale || 1));
    return s;
  }
  function colorOf(c, out) {
    try { return out.set(c === undefined || c === null ? '#888888' : c); } catch (e) { return out.set('#888888'); }
  }

  function update(mat, spec) {
    const F = mat.userData.fabric;
    if (!F) return mat;
    const s = fullSpec(spec), t = typeById[s.type], U = F.U;
    F.spec = s;
    colorOf(s.color, U.fabColor.value);
    colorOf(s.color2, U.fabColor2.value);
    // stitching thread: given, or a slightly contrasting shade of the cloth
    if (s.thread) colorOf(s.thread, U.fabThread.value);
    else U.fabThread.value.copy(U.fabColor.value).multiplyScalar(U.fabColor.value.getHSL({}).l > 0.35 ? 0.72 : 1.6);
    U.fabWeave.value.set(t.weave, t.density, t.bump, t.slub);
    U.fabLook.value.set(t.fuzz, t.weft, t.crush, patIndex[s.pattern]);
    U.fabMisc.value.x = PATTERNS[patIndex[s.pattern]].size * s.scale;
    mat.roughness = s.roughness !== undefined ? +s.roughness : t.rough;
    mat.metalness = 0;
    mat.specularIntensity = t.spec;
    mat.sheen = Math.max(0.01, s.sheen !== undefined ? +s.sheen : t.sheen);
    mat.sheenRoughness = t.sheenRough;
    // sheen takes the cloth's own colour, lifted toward white
    mat.sheenColor.copy(U.fabColor.value).lerp(_c.setRGB(1, 1, 1), 0.35);
    mat.color.setRGB(1, 1, 1);
    return mat;
  }

  BS.Fabric = {
    TYPES, PATTERNS, WEAVES: W,
    material: makeMaterial,
    update,
    spec: fullSpec,
    type: (id) => typeById[id] || typeById.cotton,
    setOpacity(mat, a) {
      const F = mat.userData.fabric;
      if (!F) return;
      F.U.fabMisc.value.y = a;
      const tr = a < 0.999;
      if (mat.transparent !== tr) { mat.transparent = tr; mat.needsUpdate = true; }
      mat.depthWrite = a > 0.5;
    },
  };
})();
