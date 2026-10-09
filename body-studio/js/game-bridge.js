// Body Studio people for Serenity Hands.
//
// BS.Game.make(spec) returns an object shaped like the game's own drawn human
// (root, j.* joints, pelvis/spine, landmark heights, emote sprite, …) but
// rendered as a realistic Body Studio body. The game keeps posing its simple
// joint rig exactly as before; just before each render the rig's rotations
// are retargeted onto MakeHuman's skeleton, faces get MakeHuman expressions,
// and skin / hair / clothing modules run per person.
(function () {
  'use strict';
  const BS = window.BS;
  const THREE = window.THREE;
  const G = (BS.Game = { ready: false, failed: false, humans: new Set(), maxSmooth: 5 });

  // ------------------------------------------------------------- loading
  G.init = function () {
    if (!G.loading) {
      G.loading = BS.loadData().then((D) => { G.D = D; G.ready = true; return D; })
        .catch((e) => { console.warn('Body Studio people unavailable, keeping drawn people', e); G.failed = true; });
    }
    return G.loading;
  };

  // ------------------------------------------------------------- helpers
  function rng(seed) {
    let a = (Math.floor(Math.abs(seed) * 1e6) ^ 0x9e3779b9) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lum = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
  // where a hex skin colour sits on Body Studio's tone scale (0 fair … 1 deep)
  function toneOf(hex) {
    const L = lum(hex), T = BS.SKIN_TONES.map(lum);
    if (L >= T[0]) return 0;
    for (let i = 0; i < T.length - 1; i++) if (L <= T[i] && L >= T[i + 1]) return (i + (T[i] - L) / (T[i] - T[i + 1] || 1)) / (T.length - 1);
    return 1;
  }
  // nearest Body Studio hair colour name for a hex (or keep the hex)
  const HAIR_MAP = { short: 'short', undercut: 'buzz', bob: 'bob', ponytail: 'ponytail', long: 'long', twintails: 'ponytail', buns: 'bun' };

  const GENDER = { woman: [0, 0.08], transwoman: [0.12, 0.28], femboy: [0.6, 0.72], transman: [0.72, 0.88], man: [0.9, 1], nonbinary: [0.32, 0.68], genderfluid: [0.3, 0.7] };
  const BUILD = {
    slim: [0.3, 0.45, 0], average: [0.5, 0.5, 0], athletic: [0.42, 0.82, 0], curvy: [0.66, 0.42, 0], plus: [0.95, 0.4, 0],
    muscular: [0.55, 1, 0], petite: [0.42, 0.45, -0.15], tall: [0.48, 0.55, 0.15], stocky: [0.72, 0.68, -0.08],
  };
  const OUTFIT = { scrubs: 'scrubs', polo: 'casual', linen: 'formal', tee: 'casual', blouse: 'casual', hoodie: 'casual', sweater: 'casual', tank: 'sport', dress: 'dress' };
  const FACE_KEYS = ['nosewidth', 'noselength', 'nosedepth', 'nosebridge', 'nosetip', 'nostrils', 'mouthwidth', 'upperlip', 'lowerlip', 'cupidsbow',
    'jawwidth', 'jawline', 'chinheight', 'chinprominent', 'cheekbones', 'cheekvolume', 'eyesize', 'eyespacing', 'eyetilt', 'browheight', 'forehead', 'earsize'];

  // Body Studio parameters for a game person. Characters made in Body Studio
  // carry their exact parameters (body.bsParams); everyone else is derived
  // from the game's own description, seeded so a person always looks the same.
  G.paramsFor = function (sp) {
    const b = (sp.faceSrc && sp.faceSrc.body) || {};
    const outfitFrom = (p) => {
      if (sp.kind === 'table') return p;
      const top = sp.top || 'tee', bottom = sp.bottom || 'pants';
      p.outfit = sp.top === 'tank' && bottom === 'shorts' ? 'sport' : bottom === 'skirt' && top !== 'dress' ? 'dress' : OUTFIT[top] || 'casual';
      if (sp.topCol) p.outfitColor = sp.topCol;
      if (sp.botCol) p.outfitColor2 = sp.botCol;
      return p;
    };
    if (b.bsParams) {
      const p = Object.assign(BS.defaultParams(), JSON.parse(JSON.stringify(b.bsParams)));
      // at work, cast members wear the spa's uniform (staff) or the guard's
      if (sp.kind === 'staff') Object.assign(p, { outfit: 'scrubs', outfitColor: sp.topCol || '#2d6a6e', outfitColor2: sp.botCol || '#24494c' });
      else if (sp.kind === 'guard') Object.assign(p, { outfit: 'formal', outfitColor: sp.topCol || '#1f2a44', outfitColor2: sp.botCol || '#1f2a44' });
      return p;
    }
    const seed = (sp.faceSrc && sp.faceSrc.seed) || 0;
    const r = rng(seed * 7.31 + (sp.kind === 'me' ? 3 : 0) + 0.5);
    const p = BS.defaultParams();
    const id = b.idKey || (b.masc ? 'man' : 'woman');
    const gr = GENDER[id] || GENDER.woman;
    p.gender = gr[0] + (gr[1] - gr[0]) * r();
    const bd = BUILD[b.build] || (sp.kind === 'me' ? [0.45, sp.muscle ? 0.75 : 0.55, 0] : BUILD.average);
    const soft = b.soft ?? sp.soft ?? 0.3;
    p.weight = clamp(bd[0] + (soft - 0.35) * 0.3 + (r() - 0.5) * 0.1, 0.05, 1);
    p.muscle = clamp(bd[1] + (b.muscle || sp.muscle ? 0.08 : 0) + (r() - 0.5) * 0.1, 0, 1);
    p.age = clamp(b.age || 28 + Math.round(r() * 10), 18, 90);
    p.proportions = 0.35 + r() * 0.4;
    const fem = p.gender < 0.5;
    // the game's own height for this person, solved exactly (realistic by sex)
    p.heightCm = Math.round(((sp.H || BS.expectedHeight(p.gender) / 100) + bd[2] * 0.03) * 100);
    p.identity = { woman: 'woman', man: 'man', transwoman: 'transwoman', transman: 'transman', femboy: 'man', nonbinary: 'nonbinary', genderfluid: 'genderfluid' }[id] || (fem ? 'woman' : 'man');
    p.pronouns = (BS.IDENTITIES[p.identity] || {}).pronouns || 'they/them';
    p.breastSize = fem ? clamp(0.32 + r() * 0.55 + (p.weight - 0.5) * 0.3, 0.25, 0.95) : 0.5;
    p.breastFirmness = clamp(0.55 - (p.age - 30) / 80 + (r() - 0.5) * 0.2, 0.1, 0.65);
    const tone = toneOf((b.skin && b.skin.base) || sp.skin || '#d6a27a');
    p.skinTone = clamp(tone + (r() - 0.5) * 0.04, 0, 1);
    p.undertone = 0.35 + r() * 0.4;
    // ancestry mix leans with skin tone, never fully determined by it
    const af = clamp(tone * 1.1 - 0.25 + (r() - 0.5) * 0.5, 0, 1), as = clamp(r() * (1 - af), 0, 1);
    p.african = af; p.asian = as; p.caucasian = Math.max(0.05, 1 - af - as);
    p.freckles = b.freckles && b.freckles.length ? 0.45 : 0;
    p.blush = fem ? 0.3 : 0.15;
    p.hairStyle = HAIR_MAP[b.hair || sp.hair] || 'short';
    if (p.hairStyle === 'long') {
      // long hair worn many ways
      const x = r();
      p.hairStyle = af > 0.55 && x < 0.35 ? (x < 0.12 ? 'afro' : 'curly') : x < 0.45 ? 'long' : x < 0.7 ? 'wavy' : x < 0.82 ? 'braid' : x < 0.92 ? 'ponytail' : 'curly';
    }
    p.hairLength = 0.35 + r() * 0.5;
    p.hairVolume = 0.35 + r() * 0.4;
    p.hairColorHex = b.hairColor || sp.hairColor || null;
    p.eyeColorHex = b.eye || sp.eye || null;
    p.beard = b.stubble ? 'stubble' : !fem && id === 'man' && r() < 0.15 ? 'short' : 'none';
    p.lashLength = fem ? 0.55 + r() * 0.3 : 0.4;
    // about half of feminine clients wear some makeup, a few others too
    const femStyle = fem || id === 'femboy';
    p.makeupStyle = femStyle && r() < 0.55 ? ['natural', 'everyday', 'everyday', 'soft glam', 'bold lip', 'smoky eye'][Math.floor(r() * 6)] : r() < 0.05 ? 'natural' : 'none';
    p.makeup = p.makeupStyle === 'none' ? 0 : 0.5 + r() * 0.3;
    p.moles = r() * 0.5;
    p.bodyHair = fem ? 0 : 0.1 + r() * 0.3;
    p.details = {};
    for (const k of FACE_KEYS) if (r() < 0.6) p.details[k] = Math.round((r() - 0.5) * 0.7 * 100) / 100;
    // a face "look" on top of the individual features, most people get one
    const looks = femStyle ? ['cute', 'doll', 'glam', 'girlnextdoor', 'model', 'exotic', 'soft', 'pretty', 'pretty', 'cute'] : ['rugged', 'prettyboy', 'rugged'];
    if (BS.LOOKS && r() < 0.8) {
      const look = BS.LOOKS[looks[Math.floor(r() * looks.length)]] || {}, k = 0.6 + r() * 0.4;
      for (const key in look) p.details[key] = Math.round(((p.details[key] || 0) * 0.35 + look[key] * k) * 100) / 100;
    }
    if (p.details.eyesize > 0.2) p.details.eyesize = 0.2;
    // figure: every body differs in bust, waist, hips, butt, stomach, thighs
    const v = (a, b) => Math.round((a + (b - a) * r()) * 100) / 100;
    if (fem) {
      Object.assign(p.details, { glutes: v(-0.15, 0.8), hips: v(-0.1, 0.5), waist: v(-0.45, 0.1) + (p.weight - 0.5) * 0.4, belly: clamp(v(-0.35, 0.1) + (p.weight - 0.5) * 0.5, -0.4, 0.2), thighs: v(-0.15, 0.45) });
      const shape = r();
      if (shape < 0.35) p.details['shape-hourglass'] = v(0.3, 0.8);
      else if (shape < 0.5) p.details['shape-pear'] = v(0.3, 0.7);
      else if (shape < 0.6) p.details['shape-neathourglass'] = v(0.3, 0.7);
    } else {
      Object.assign(p.details, { shoulders: v(-0.1, 0.45), vshape: v(-0.1, 0.5), pecs: v(-0.1, 0.45), glutes: v(-0.1, 0.4), belly: clamp(v(-0.3, 0.1) + (p.weight - 0.5) * 0.6, -0.35, 0.3) });
    }
    if (b.build === 'curvy') { p.details.hips = Math.max(p.details.hips || 0, 0.35); p.details.glutes = Math.max(p.details.glutes || 0, 0.45); p.details['shape-hourglass'] = 0.6; }
    p.name = b.name || '';
    return outfitFrom(p);
  };

  // ------------------------------------------------------------- faces
  // the game's expressions as MakeHuman face pose units
  const EXPR = {
    neutral: {},
    happy: { MouthLeftPullUp: 0.7, MouthRightPullUp: 0.7, LeftCheekUp: 0.45, RightCheekUp: 0.45, LeftLowerLidUp: 0.2, RightLowerLidUp: 0.2 },
    bliss: { LeftUpperLidClosed: 0.85, RightUpperLidClosed: 0.85, MouthLeftPullUp: 0.35, MouthRightPullUp: 0.35, LeftInnerBrowUp: 0.15, RightInnerBrowUp: 0.15 },
    annoyed: { LeftBrowDown: 0.65, RightBrowDown: 0.65, lowerLipUp: 0.3, MouthLeftPullDown: 0.3, MouthRightPullDown: 0.3, NoseWrinkler: 0.15 },
    wince: { LeftBrowDown: 0.45, RightBrowDown: 0.45, LeftInnerBrowUp: 0.5, RightInnerBrowUp: 0.5, NoseWrinkler: 0.5, LeftLowerLidUp: 0.6, RightLowerLidUp: 0.6, LeftUpperLidClosed: 0.4, RightUpperLidClosed: 0.4, UpperLipUp: 0.35, MouthLeftPullSide: 0.5, MouthRightPullSide: 0.5, JawDrop: 0.08 },
    laugh: { MouthLeftPullUp: 1, MouthRightPullUp: 1, LeftCheekUp: 0.8, RightCheekUp: 0.8, JawDrop: 0.45, LeftLowerLidUp: 0.5, RightLowerLidUp: 0.5, LeftUpperLidClosed: 0.35, RightUpperLidClosed: 0.35, LeftInnerBrowUp: 0.2, RightInnerBrowUp: 0.2 },
    surprised: { LeftOuterBrowUp: 1, RightOuterBrowUp: 1, LeftInnerBrowUp: 0.8, RightInnerBrowUp: 0.8, LeftUpperLidOpen: 0.8, RightUpperLidOpen: 0.8, JawDrop: 0.45, LipsKiss: 0.1 },
  };
  G.EXPR = EXPR;

  // ------------------------------------------------------------- the rig
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

  // landmark heights and half-widths of the rest body, in game meters
  function measure(h) {
    const bs = h.bs, k = h.scale, J = (n, w = 'head') => bs.joint(n, w);
    const yHip = J('upperleg01.L').y, yKnee = J('lowerleg01.L').y, yAnk = J('foot.L').y;
    const yWaist = J('spine03').y, yChest = J('breast.L').y, ySh = J('upperarm01.L').y + 0.025;
    const yChin = J('jaw', 'tail').y, top = J('head', 'tail').y, yHeadC = (yChin + top) / 2 + 0.01;
    // half-widths from body vertices that belong to the trunk (no arms)
    const D = bs.D, P = bs.P, armish = new Set();
    D.bones.forEach((b, i) => { if (/^(clavicle|shoulder|upperarm|lowerarm|wrist|finger|metacarpal)/.test(b.name)) armish.add(i); });
    const width = (y0, y1) => {
      let m = 0;
      const fv = D.groups.body.fv;
      for (let q = 0; q < fv.length; q += 7) {
        const v = fv[q];
        if (armish.has(D.skinIdx[v * 8])) continue;
        const y = P[v * 3 + 1] * BS.SCALE - bs.ground;
        if (y >= y0 && y <= y1) m = Math.max(m, Math.abs(P[v * 3] * BS.SCALE));
      }
      return m;
    };
    const lm = {
      H: top + 0.01, yHip, yKnee, yAnk, yWaist, yChest, ySh, yChin, yHeadC, headR: (top - yChin) / 2,
      S: Math.max(0.12, J('upperarm01.L').x + 0.04), W: width(yWaist - 0.02, yWaist + 0.02) || 0.13, P: width(yHip - 0.08, yHip) || 0.17,
      neckR: width(J('neck02').y - 0.01, J('neck02').y + 0.01) || 0.055,
    };
    for (const key in lm) h[key] = lm[key] * k;
    h.yHeadC = lm.yHeadC * k;
  }

  // how far the arms swing out from the A-pose to hang clear of the hips,
  // and the stance of the legs, as rest-world aim rotations per side
  function aims(h) {
    const bs = h.bs, A = (h.aim = {});
    for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
      const sh = bs.joint('upperarm01.' + L), el = bs.joint('lowerarm01.' + L);
      const armLen = sh.distanceTo(el) + el.distanceTo(bs.joint('wrist.' + L));
      const clear = (h.P / h.scale) + 0.05 - Math.abs(sh.x);
      const ang = clamp(Math.atan2(Math.max(0, clear), armLen) + 0.06, 0.06, 0.4);
      const dir = new THREE.Vector3(s * Math.sin(ang), -Math.cos(ang), 0.04);
      A['arm' + L] = new THREE.Quaternion().setFromUnitVectors(_v.subVectors(el, sh).normalize(), dir.normalize());
      const hp = bs.joint('upperleg01.' + L), kn = bs.joint('lowerleg01.' + L);
      const ld = _v.subVectors(kn, hp).normalize();
      A['leg' + L] = new THREE.Quaternion().setFromUnitVectors(ld, _v2.set(ld.x * 0.45, -1, 0).normalize());
      A['armInv' + L] = A['arm' + L].clone().invert();
      A['legInv' + L] = A['leg' + L].clone().invert();
    }
  }

  // the game's joint rig, mirroring buildHuman: never rendered, only posed
  function makeRig(h) {
    const H = h.H, J = (h.j = {});
    const pelvis = (h.pelvis = new THREE.Group());
    pelvis.position.y = h.yHip;
    const spine = (h.spine = new THREE.Group());
    spine.position.y = h.yWaist - h.yHip;
    pelvis.add(spine);
    const tY = (v) => v - h.yWaist;
    J.head = new THREE.Group();
    J.head.position.set(0, tY(h.yChin), 0);
    spine.add(J.head);
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R';
      const sh = (J['sh' + L] = new THREE.Group());
      sh.position.set(s * h.S * 0.86, tY(h.ySh) - 0.028 * H, -0.005 * H);
      sh.userData.rest = sh.position.clone();
      spine.add(sh);
      J['el' + L] = new THREE.Group(); sh.add(J['el' + L]);
      J['wr' + L] = new THREE.Group(); J['el' + L].add(J['wr' + L]);
      J['fg' + L] = new THREE.Group(); J['wr' + L].add(J['fg' + L]);
      J['tips' + L] = [0, 1, 2, 3].map(() => new THREE.Group());
      J['hip' + L] = new THREE.Group(); pelvis.add(J['hip' + L]);
      J['kn' + L] = new THREE.Group(); J['hip' + L].add(J['kn' + L]);
      J['an' + L] = new THREE.Group(); J['kn' + L].add(J['an' + L]);
    }
    h.chest = new THREE.Object3D();
    h.shirt = new THREE.Object3D();
  }

  const BONES = {};
  function boneIdx(bs) {
    if (BONES.ready) return BONES;
    const I = (n) => bs.boneIndex(n);
    Object.assign(BONES, {
      root: I('root'), spine: ['spine04', 'spine03', 'spine02', 'spine01'].map(I), neck: ['neck01', 'neck02', 'neck03'].map(I), head: I('head'),
      clav: { L: I('clavicle.L'), R: I('clavicle.R') }, ua: { L: I('upperarm01.L'), R: I('upperarm01.R') }, fa: { L: I('lowerarm01.L'), R: I('lowerarm01.R') },
      wr: { L: I('wrist.L'), R: I('wrist.R') }, ul: { L: I('upperleg01.L'), R: I('upperleg01.R') }, ll: { L: I('lowerleg01.L'), R: I('lowerleg01.R') },
      ft: { L: I('foot.L'), R: I('foot.R') },
      fingers: { L: [], R: [] }, thumb: { L: [], R: [] }, ready: true,
    });
    for (const L of ['L', 'R']) {
      for (let f = 2; f <= 5; f++) BONES.fingers[L].push([1, 2, 3].map((k) => I(`finger${f}-${k}.${L}`)));
      BONES.thumb[L] = [1, 2, 3].map((k) => I(`finger1-${k}.${L}`));
    }
    return BONES;
  }

  // pose[i] = increment q about rest-world axes (see human.worldAxisQuat)
  function inc(bs, i, q) {
    const r = bs.restGlobalQuat[i];
    bs.pose[i].copy(r).invert().multiply(q).multiply(r);
  }
  // a joint's Euler rotation as a quaternion (from a small reused pool)
  const POOL = Array.from({ length: 8 }, () => new THREE.Quaternion());
  let poolI = 0;
  const qOf = (o) => POOL[poolI++ & 7].setFromEuler(o.rotation);

  function retarget(h) {
    const bs = h.bs, B = boneIdx(bs), J = h.j, A = h.aim, k = h.scale;
    bs.resetPose();
    // pelvis: position relative to its rest, rotation moves legs and spine
    bs.rootOffset.set(h.pelvis.position.x / k, (h.pelvis.position.y - h.yHip) / k + (h.sitLift || 0), h.pelvis.position.z / k);
    inc(bs, B.root, qOf(h.pelvis));
    // spine: the waist bend spread over four vertebrae, plus a breath
    const qs = qOf(h.spine);
    _q2.identity().slerp(qs, 0.25);
    for (const i of B.spine) inc(bs, i, _q2);
    const br = h.chest.scale.z - 1;
    if (br) bs.pose[B.spine[3]].multiply(bs.worldAxisQuat(B.spine[3], AX.x, -br * 1.2, _q3));
    // head turn shared by the neck
    const qh = qOf(J.head);
    const shares = [0.15, 0.15, 0.2, 0.5];
    B.neck.concat([B.head]).forEach((i, n) => inc(bs, i, _q2.identity().slerp(qh, shares[n])));
    for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
      const side = s > 0 ? 'L' : 'R';
      // shoulders shrug with the joint's height offset
      const sh = J['sh' + L], dy = (sh.position.y - sh.userData.rest.y) / k;
      if (dy) inc(bs, B.clav[side], _q2.setFromAxisAngle(AX.z, s * dy / 0.12));
      // arm: hang from the A-pose, then the game's shoulder rotation
      _q.copy(qOf(sh)).multiply(A['arm' + side]);
      inc(bs, B.ua[side], _q);
      _q.copy(A['armInv' + side]).multiply(qOf(J['el' + L])).multiply(A['arm' + side]);
      inc(bs, B.fa[side], _q);
      _q.copy(A['armInv' + side]).multiply(qOf(J['wr' + L])).multiply(A['arm' + side]);
      inc(bs, B.wr[side], _q);
      // fingers curl about their own hinge axis (MakeHuman's local X)
      const c1 = J['fg' + L].rotation.x, c2 = J['tips' + L][0] ? J['tips' + L][0].rotation.x : 0.18;
      for (const f of B.fingers[side]) {
        bs.pose[f[0]].setFromAxisAngle(AX.x, c1 * 0.9);
        bs.pose[f[1]].setFromAxisAngle(AX.x, c2 * 1.1);
        bs.pose[f[2]].setFromAxisAngle(AX.x, c2 * 0.8);
      }
      bs.pose[B.thumb[side][1]].setFromAxisAngle(AX.x, c2 * 0.5);
      // legs: stand straight-ish, then the game's hip / knee / ankle
      _q.copy(qOf(J['hip' + L])).multiply(A['leg' + side]);
      inc(bs, B.ul[side], _q);
      _q.copy(A['legInv' + side]).multiply(qOf(J['kn' + L])).multiply(A['leg' + side]);
      inc(bs, B.ll[side], _q);
      _q.copy(A['legInv' + side]).multiply(qOf(J['an' + L])).multiply(A['leg' + side]);
      inc(bs, B.ft[side], _q);
    }
    face(h);
    bs.bones[B.head].scale.setScalar(h.headHidden ? 1e-3 : 1);
    bs.applyPose();
  }

  // expression + blinks + glances + talking, on MakeHuman's facial rig
  function face(h) {
    const t = performance.now() / 1000, seed = h.seed;
    const w = Object.assign({}, EXPR[h.expr] || EXPR.neutral);
    // natural blinks, sometimes doubled
    const per = 3.6 + (seed % 1.7), ph = (t + seed * 3.1) % per;
    let blink = ph < 0.16 ? Math.sin((ph / 0.16) * Math.PI) : ph > 0.5 && ph < 0.62 && seed % 1 > 0.6 ? Math.sin(((ph - 0.5) / 0.12) * Math.PI) : 0;
    blink = Math.max(blink, h.expr === 'bliss' ? 0.85 : 0);
    // relaxed lids rest a little over the iris unless the expression opens them
    for (const s of ['Left', 'Right']) {
      const open = Math.min(1, w[s + 'UpperLidOpen'] || 0);
      w[s + 'UpperLidClosed'] = Math.max((w[s + 'UpperLidClosed'] || 0) + 0.2 * (1 - open), blink);
      w[s + 'LowerLidUp'] = (w[s + 'LowerLidUp'] || 0) + 0.12 * (1 - open);
    }
    // small eye glances
    const g = Math.sin(t * 0.37 + seed) * 0.5 + Math.sin(t * 1.7 + seed * 2) * 0.15;
    const gq = Math.round(g * 3) / 3;
    if (gq > 0) { w.LeftEyeturnLeft = gq * 0.5; w.RightEyeturnLeft = gq * 0.5; } else if (gq < 0) { w.LeftEyeturnRight = -gq * 0.5; w.RightEyeturnRight = -gq * 0.5; }
    if (h.talking) {
      const a = Math.max(0, Math.sin(t * 11 + seed)) * 0.55 + Math.max(0, Math.sin(t * 6.3)) * 0.2;
      w.JawDrop = (w.JawDrop || 0) + a * 0.5;
      w.LipsKiss = Math.max(0, Math.sin(t * 4.1 + seed)) * 0.25;
      w.UpperLipUp = (w.UpperLipUp || 0) + a * 0.2;
    }
    h.faceUnits = BS.blendFaceUnits(G.D, w, h.faceUnits);
    for (const i in h.faceUnits) h.bs.pose[i].multiply(h.faceUnits[i]);
  }

  // ------------------------------------------------------------- modules
  // skin, hair and clothing run per person against a small stand-in "app"
  function hostModules(h) {
    for (const m of h.modules || []) if (m.dispose) try { m.dispose(); } catch (e) { /* ignore */ }
    h.modules = [];
    const app = (h.app = {
      human: h.bs, D: G.D, scene: h.root, camera: G.camera || new THREE.PerspectiveCamera(), renderer: G.renderer,
      params: h.params, quality: h.bs.smooth ? 'medium' : 'low', query: new URLSearchParams(''), modules: {}, listeners: {},
      on(evt, fn) { (this.listeners[evt] || (this.listeners[evt] = [])).push(fn); }, orbit: { target: new THREE.Vector3(), autoRotate: false },
      focus() {}, time: 0, game: true,
    });
    for (const name of ['skin', 'hair', 'clothing']) {
      const def = BS.moduleDefs.find((d) => d.name === name);
      if (!def) continue;
      try {
        const inst = def.create(app);
        app.modules[name] = inst;
        h.modules.push(inst);
        if (inst.onParams) inst.onParams(h.params);
      } catch (e) { console.warn('Body Studio ' + name + ' failed for a game person', e); }
    }
  }

  function setParams(h, p) {
    h.params = p;
    h.bs.setParams(p);
    if (h.app) h.app.params = p;
    for (const m of h.modules || []) if (m.onParams) try { m.onParams(p); } catch (e) { console.warn(e); }
  }

  // ------------------------------------------------------------- make
  G.make = function (sp, opts = {}) {
    const bs = new BS.Human(G.D, { smooth: !!opts.smooth });
    const h = {
      bs, sp, parts: [], clothes: { top: [], bottom: [], low: [], shoes: [] }, walkAmt: 0, angle: null, faceT: -1, lastExpr: '',
      expr: 'neutral', talking: false, seed: (sp.faceSrc && sp.faceSrc.seed) || Math.random() * 10, lastSync: 0, modules: [],
      kind: sp.kind || '', isBS: true,
    };
    h.root = new THREE.Group();
    h.root.add(bs.group);
    const p = (h.baseParams = G.paramsFor(sp));
    h.params = p;
    bs.setParams(p);
    // heights are solved exactly in cm (BS.setHeightCm), so no stretching
    h.scale = 1;
    bs.group.scale.setScalar(h.scale);
    measure(h);
    aims(h);
    makeRig(h);
    bs.addShapeListener(() => { measure(h); aims(h); });
    hostModules(h);
    // the game's skin material is cloned per zone for massage tints; ours
    // tints in the shader instead (see tint())
    h.skin = new THREE.MeshLambertMaterial({ color: sp.skin || '#d6a27a' });
    h.face = { c: null, g: null, t: { needsUpdate: false } };
    h.headShape = { set visible(v) { h.headHidden = !v; }, get visible() { return !h.headHidden; } };
    // emote bubble above the head, as the drawn people have
    const ec = document.createElement('canvas');
    ec.width = ec.height = 128;
    const et = new THREE.CanvasTexture(ec);
    const emote = new THREE.Sprite(new THREE.SpriteMaterial({ map: et, transparent: true, depthTest: false }));
    emote.scale.set(0.34, 0.34, 1);
    emote.position.y = h.H + 0.24;
    emote.visible = false;
    h.root.add(emote);
    h.emote = { s: emote, c: ec, g: ec.getContext('2d'), t: et, type: '' };
    zones(h);
    G.humans.add(h);
    return h;
  };

  G.dispose = function (h) {
    for (const m of h.modules || []) if (m.dispose) try { m.dispose(); } catch (e) { /* ignore */ }
    h.bs.dispose();
    h.emote.t.dispose();
    h.emote.s.material.dispose();
    if (h.root.parent) h.root.parent.remove(h.root);
    if (h.collider) h.collider.geometry.dispose();
    G.humans.delete(h);
  };

  G.setSmooth = function (h, smooth) {
    if (h.bs.smooth === smooth) return;
    h.bs.setSmooth(smooth);
    zones(h);
    hostModules(h);
  };

  G.face = function (h, expr, talking) { h.expr = expr || 'neutral'; h.talking = !!talking; };

  // table dress: underwear (with a top for anyone who'd wear one) under the towel
  G.tableDress = function (h, on) {
    if (!!h.onTable === on) return;
    h.onTable = on;
    const p = Object.assign({}, h.baseParams, on ? { outfit: 'underwear', outfitColor: '#e9e4dc', outfitColor2: '#e9e4dc' } : {});
    h.params = p;
    if (h.app) h.app.params = p;
    for (const m of h.modules) if (m.onParams) try { m.onParams(p); } catch (e) { console.warn(e); }
  };

  // ------------------------------------------------------------- zones
  // every vertex belongs to one massage zone (by its strongest bone); the
  // game hit-tests a CPU-skinned copy of the base mesh and reads the zone
  const ZONES = ['head', 'neck', 'torso', 'armB', 'armT', 'handB', 'handT', 'thigh', 'calfB', 'calfT', 'footB', 'footT'];
  G.ZONES = ZONES;
  function zoneOfBone(name) {
    const side = /\.L$/.test(name) ? 'B' : 'T';
    if (/^neck/.test(name)) return ['neck', ''];
    if (/^(head|jaw|eye|tongue|levator|oris|risorius|temporalis|oculi|orbicularis|special)/.test(name)) return ['head', ''];
    if (/^(shoulder|upperarm)/.test(name)) return ['arm' + side, 'ua'];
    if (/^lowerarm/.test(name)) return ['arm' + side, 'fa'];
    if (/^(wrist|metacarpal|finger)/.test(name)) return ['hand' + side, 'hand'];
    if (/^upperleg/.test(name)) return ['thigh', 'th'];
    if (/^lowerleg/.test(name)) return ['calf' + side, 'sh'];
    if (/^(foot|toe)/.test(name)) return ['foot' + side, 'foot'];
    return ['torso', ''];
  }
  function zones(h) {
    const bs = h.bs, D = G.D;
    if (!G.boneZone) G.boneZone = D.bones.map((b) => zoneOfBone(b.name));
    // smoothed (or base) body vertices: zone id attribute for the tint shader
    const n = bs.S.nOut, z = new Float32Array(n), sw = bs.subWeights;
    for (let i = 0; i < n; i++) z[i] = ZONES.indexOf(G.boneZone[sw.idx[i * 8]][0]);
    bs.bodyGeo.setAttribute('zoneId', new THREE.Float32BufferAttribute(z, 1));
    if (!bs.skinMat.userData.zonePatched) {
      bs.skinMat.userData.zonePatched = true;
      const U = (bs.skinMat.userData.zoneU = { uZoneColor: { value: ZONES.map(() => new THREE.Vector4(0, 0, 0, 0)) }, uZoneGlow: { value: ZONES.map(() => new THREE.Vector3()) } });
      BS.patch(bs.skinMat, 'zones', (s) => {
        Object.assign(s.uniforms, U);
        s.vertexShader = s.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float zoneId;\nuniform vec4 uZoneColor[12];\nuniform vec3 uZoneGlow[12];\nvarying vec4 vZoneColor;\nvarying vec3 vZoneGlow;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ int zi = int(zoneId + 0.5); vZoneColor = uZoneColor[zi]; vZoneGlow = uZoneGlow[zi]; }');
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec4 vZoneColor;\nvarying vec3 vZoneGlow;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vZoneColor.rgb, vZoneColor.a);')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vZoneGlow;');
      });
      bs.skinMat.needsUpdate = true;
    }
  }
  // massage tints: redness (colour + amount) and the tension view glow per zone
  G.tint = function (h, zone, color, amount, glow) {
    const U = h.bs.skinMat.userData.zoneU;
    if (!U) return;
    const i = ZONES.indexOf(zone);
    const list = zone === 'torso' ? [i] : [i];
    for (const zi of list) {
      if (zi < 0) continue;
      U.uZoneColor.value[zi].set(color.r, color.g, color.b, amount);
      if (glow) U.uZoneGlow.value[zi].set(glow.r, glow.g, glow.b);
      else U.uZoneGlow.value[zi].set(0, 0, 0);
    }
  };
  G.clearTint = function (h) {
    const U = h.bs.skinMat.userData.zoneU;
    if (!U) return;
    for (const v of U.uZoneColor.value) v.set(0, 0, 0, 0);
    for (const v of U.uZoneGlow.value) v.set(0, 0, 0);
  };

  // CPU-skinned base mesh for ray hits (only while someone needs it)
  G.collider = function (h) {
    const bs = h.bs, D = G.D, fv = D.groups.body.fv;
    if (!h.collider) {
      const verts = [...new Set(fv)];
      const map = new Map(verts.map((v, i) => [v, i]));
      const idx = new Uint32Array((fv.length / 4) * 6);
      for (let f = 0; f < fv.length / 4; f++) {
        const a = map.get(fv[f * 4]), b = map.get(fv[f * 4 + 1]), c = map.get(fv[f * 4 + 2]), d = map.get(fv[f * 4 + 3]);
        idx.set([a, b, c, a, c, d], f * 6);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(verts.length * 3), 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const zoneOfTri = new Uint8Array(idx.length / 3);
      for (let t = 0; t < zoneOfTri.length; t++) zoneOfTri[t] = D.skinIdx[verts[idx[t * 3]] * 8];
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
      mesh.userData = { bsCollider: true, human: h, verts, triBone: zoneOfTri };
      h.collider = mesh;
      h.parts = [mesh];
    }
    const pos = h.collider.geometry.attributes.position, verts = h.collider.userData.verts;
    for (let i = 0; i < verts.length; i++) {
      bs.baseVertex(verts[i], _v);
      pos.array[i * 3] = _v.x; pos.array[i * 3 + 1] = _v.y; pos.array[i * 3 + 2] = _v.z;
    }
    pos.needsUpdate = true;
    h.collider.geometry.computeBoundingSphere();
    h.collider.geometry.computeBoundingBox();
    return h.collider;
  };

  // what a collider hit touched: zone, limb segment, side and how far along
  G.hitInfo = function (h, hit) {
    const bone = h.collider.userData.triBone[hit.faceIndex];
    const [zone, seg] = G.boneZone[bone];
    const name = G.D.bones[bone].name, side = /\.L$/.test(name) ? 'L' : 'R';
    const info = { zone, seg, s: side === 'L' ? 1 : -1, limb: !!seg && seg !== 'th', t: 0 };
    if (info.limb) {
      const ends = { ua: ['upperarm01', 'lowerarm01'], fa: ['lowerarm01', 'wrist'], hand: ['wrist', 'finger3-3'], sh: ['lowerleg01', 'foot'], foot: ['foot', 'toe3-1'] }[seg];
      const a = h.bs.bones[h.bs.boneIndex(ends[0] + '.' + side)].getWorldPosition(_v);
      const b = h.bs.bones[h.bs.boneIndex(ends[1] + '.' + side)].getWorldPosition(_v2);
      const ab = b.sub(a), l2 = ab.lengthSq() || 1;
      info.t = clamp(_v2.copy(hit.point).sub(a).dot(ab) / l2, 0, 1);
    }
    return info;
  };

  // ------------------------------------------------------------- per frame
  // runs before every render of a scene that holds Body Studio people
  G.sync = function (h, cam) {
    const now = performance.now();
    if (now - h.lastSync < 6) return;
    const dt = Math.min(0.1, (now - (h.lastSync || now)) / 1000);
    h.lastSync = now;
    h.root.updateMatrixWorld(true);
    retarget(h);
    if (h.app) { h.app.time += dt; if (cam) h.app.camera = cam; }
    for (const m of h.modules) if (m.update) try { m.update(dt, h.app.time); } catch (e) { if (!m._warned) { m._warned = true; console.warn(e); } }
    if (h.needsCollider) G.collider(h);
  };

  function inScene(o, scene) { for (let p = o; p; p = p.parent) if (p === scene) return true; return false; }
  G.wrapRenderer = function (r) {
    if (r._bsWrapped) return r;
    r._bsWrapped = true;
    const render = r.render.bind(r);
    r.render = (scene, camera) => {
      if (G.ready) {
        G.renderer = r;
        const cp = camera.getWorldPosition(_v2);
        for (const h of G.humans) {
          if (!h.root.visible || !inScene(h.root, scene)) continue;
          G.sync(h, camera);
          // detail by distance: smooth bodies up close, a budget of a few
          const d = h.root.getWorldPosition(_v).distanceTo(cp);
          h.camDist = d;
        }
        G.lod(cp);
      }
      render(scene, camera);
    };
    return r;
  };

  // promote the nearest people to the smoothed mesh, one switch per frame
  G.lod = function () {
    const list = [...G.humans].filter((h) => h.root.visible && h.camDist !== undefined);
    list.sort((a, b) => (a.forceSmooth ? -1 : 0) - (b.forceSmooth ? -1 : 0) || a.camDist - b.camDist);
    let smooth = 0;
    for (const h of list) {
      const want = h.forceSmooth || (smooth < G.maxSmooth && h.camDist < (h.bs.smooth ? 4.2 : 3.6));
      if (want) smooth++;
      if (want !== h.bs.smooth) { G.setSmooth(h, want); return; }
    }
  };
})();
