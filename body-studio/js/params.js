// Body Studio parameters: every slider, its MakeHuman targets, defaults and presets.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});

  // Detail sliders run -1..1: negative applies `neg` targets, positive `pos`.
  // A `pos`-only slider runs 0..1. Left/right targets move together.
  const LR = (dir, name) => ['l', 'r'].map((s) => `${dir}/${s}-${name}`);
  const D = [];
  const add = (group, key, label, neg, pos) => D.push({ group, key, label, neg, pos });
  const pair = (group, key, label, dir, base, a = 'decr', b = 'incr') =>
    add(group, key, label, [`${dir}/${base}-${a}`], [`${dir}/${base}-${b}`]);
  const pairLR = (group, key, label, dir, base, a = 'decr', b = 'incr') =>
    add(group, key, label, LR(dir, `${base}-${a}`), LR(dir, `${base}-${b}`));

  // body
  // shaped procedurally by js/shape.js (no MakeHuman targets): their own
  // group, the first one under the Body tab's "Fine detail"
  add('Curves & shape', 'breastround', 'Breast shape (teardrop to round)', [], []);
  add('Curves & shape', 'breastsupport', 'Breast support (natural to lifted)', [], []);
  add('Curves & shape', 'breastside', 'Breast side fullness', [], []);
  add('Curves & shape', 'buttround', 'Butt roundness', [], []);
  add('Curves & shape', 'buttlift', 'Butt lift', [], []);
  add('Curves & shape', 'hipcurve', 'Hip curve (hip dips to smooth)', [], []);
  pair('Torso', 'shoulders', 'Shoulder width', 'measure', 'measure-shoulder-dist');
  pair('Torso', 'vshape', 'V-shape', 'torso', 'torso-vshape');
  pair('Figure', 'chest', 'Bust', 'measure', 'measure-bust-circ');
  pair('Torso', 'underbust', 'Rib cage', 'measure', 'measure-underbust-circ');
  pair('Torso', 'pecs', 'Pecs', 'torso', 'torso-muscle-pectoral');
  pair('Torso', 'lats', 'Back muscles', 'torso', 'torso-muscle-dorsi');
  pair('Figure', 'waist', 'Waist', 'measure', 'measure-waist-circ');
  pair('Figure', 'belly', 'Stomach', 'stomach', 'stomach-pregnant');
  pair('Figure', 'hips', 'Hips', 'measure', 'measure-hips-circ');
  pair('Hips & legs', 'hipwidth', 'Hip width', 'hip', 'hip-scale-horiz');
  pair('Hips & legs', 'waistline', 'Waist height', 'hip', 'hip-waist', 'down', 'up');
  pair('Figure', 'glutes', 'Butt', 'buttocks', 'buttocks-volume');
  pair('Hips & legs', 'pelvis', 'Pelvis tone', 'pelvis', 'pelvis-tone');
  pair('Figure', 'thighs', 'Thighs', 'measure', 'measure-thigh-circ');
  pairLR('Hips & legs', 'thighfat', 'Thigh fat', 'armslegs', 'upperleg-fat');
  pairLR('Hips & legs', 'thighmuscle', 'Thigh muscle', 'armslegs', 'upperleg-muscle');
  pair('Hips & legs', 'calves', 'Calves', 'measure', 'measure-calf-circ');
  pairLR('Hips & legs', 'calfmuscle', 'Calf muscle', 'armslegs', 'lowerleg-muscle');
  pair('Hips & legs', 'upperleglen', 'Thigh length', 'measure', 'measure-upperleg-height');
  pair('Hips & legs', 'lowerleglen', 'Shin length', 'measure', 'measure-lowerleg-height');
  pairLR('Hips & legs', 'feet', 'Foot size', 'armslegs', 'foot-scale');
  pair('Arms', 'biceps', 'Upper arm size', 'measure', 'measure-upperarm-circ');
  pairLR('Arms', 'armmuscle', 'Arm muscle', 'armslegs', 'upperarm-muscle');
  pairLR('Arms', 'armfat', 'Arm fat', 'armslegs', 'upperarm-fat');
  pairLR('Arms', 'forearm', 'Forearm muscle', 'armslegs', 'lowerarm-muscle');
  pair('Arms', 'upperarmlen', 'Upper arm length', 'measure', 'measure-upperarm-length');
  pair('Arms', 'forearmlen', 'Forearm length', 'measure', 'measure-lowerarm-length');
  pairLR('Arms', 'hands', 'Hand size', 'armslegs', 'hand-scale');
  pair('Chest', 'breastpos', 'Breast height', 'breast', 'breast-trans', 'down', 'up');
  pair('Chest', 'breastdist', 'Breast spacing', 'breast', 'breast-dist');
  pair('Chest', 'breastpoint', 'Breast projection', 'breast', 'breast-point');
  pair('Chest', 'breastvol', 'Breast fullness', 'breast', 'breast-volume-vert', 'down', 'up');
  pair('Chest', 'nipplesize', 'Nipple size', 'breast', 'nipple-size');
  pair('Neck', 'neckthick', 'Neck thickness', 'measure', 'measure-neck-circ');
  pair('Neck', 'necklen', 'Neck length', 'measure', 'measure-neck-height');
  pair('Neck', 'doublechin', 'Double chin', 'neck', 'neck-double');
  // body type silhouettes
  const shapes = [
    ['hourglass', 'Hourglass', 'fem-full-hourglass'], ['neathourglass', 'Slim hourglass', 'fem-neat-hourglass'],
    ['pear', 'Pear', 'fem-triangle'], ['apple', 'Apple', 'fem-apple'], ['rectangle', 'Rectangle', 'fem-rectangle'],
    ['invtriangle', 'Inverted triangle', 'fem-invert-triangle'], ['column', 'Lean column', 'fem-lean-column'],
    ['diamond', 'Diamond', 'fem-diamond'], ['trapezoid', 'Trapezoid (broad)', 'man-trapezoid'],
    ['mapple', 'Barrel', 'man-apple'], ['mtriangle', 'Wide hips', 'man-triangle'],
    ['mcolumn', 'Lanky', 'man-lean-column'], ['minv', 'Athletic V', 'man-invert-triangle'],
  ];
  for (const [k, l, t] of shapes) add('Body type', 'shape-' + k, l, null, ['bodyshapes/bodyshapes-elvs-' + t]);

  // face
  for (const [k, l] of [['oval', 'Oval'], ['round', 'Round'], ['square', 'Square'], ['rectangular', 'Long'], ['triangular', 'Triangular'], ['invertedtriangular', 'Heart'], ['diamond', 'Diamond']])
    add('Head shape', 'head-' + k, l, null, ['head/head-' + k]);
  pair('Head shape', 'headfat', 'Face fullness', 'head', 'head-fat');
  pair('Head shape', 'headage', 'Face age', 'head', 'head-age');
  pair('Head shape', 'forehead', 'Forehead height', 'forehead', 'forehead-scale-vert');
  pair('Head shape', 'foreheadslope', 'Forehead slope', 'forehead', 'forehead-trans', 'backward', 'forward');
  pair('Head shape', 'temples', 'Temples', 'forehead', 'forehead-temple');
  pair('Brows', 'browheight', 'Brow height', 'eyebrows', 'eyebrows-trans', 'down', 'up');
  pair('Brows', 'browangle', 'Brow angle', 'eyebrows', 'eyebrows-angle', 'down', 'up');
  pair('Brows', 'browridge', 'Brow ridge', 'eyebrows', 'eyebrows-trans', 'backward', 'forward');
  pairLR('Eyes', 'eyesize', 'Eye size', 'eyes', 'eye-scale');
  pairLR('Eyes', 'eyeopen', 'Eye opening', 'eyes', 'eye-height2');
  pairLR('Eyes', 'eyespacing', 'Eye spacing', 'eyes', 'eye-trans', 'in', 'out');
  pairLR('Eyes', 'eyeheight', 'Eye height', 'eyes', 'eye-trans', 'down', 'up');
  pairLR('Eyes', 'eyetilt', 'Eye tilt', 'eyes', 'eye-corner1', 'down', 'up');
  pairLR('Eyes', 'eyefold', 'Eyelid fold', 'eyes', 'eye-eyefold', 'down', 'up');
  pairLR('Eyes', 'epicanthus', 'Epicanthic fold', 'eyes', 'eye-epicanthus', 'in', 'out');
  pairLR('Eyes', 'eyebags', 'Eye bags', 'eyes', 'eye-bag');
  pairLR('Eyes', 'eyedepth', 'Eye depth', 'eyes', 'eye-push1', 'in', 'out');
  pair('Nose', 'nosewidth', 'Nose width', 'nose', 'nose-scale-horiz');
  pair('Nose', 'noselength', 'Nose length', 'nose', 'nose-scale-vert');
  pair('Nose', 'nosedepth', 'Nose projection', 'nose', 'nose-scale-depth');
  pair('Nose', 'nosebridge', 'Bridge width', 'nose', 'nose-width1');
  pair('Nose', 'nosehump', 'Nose hump', 'nose', 'nose-hump');
  pair('Nose', 'nosecurve', 'Nose curve', 'nose', 'nose-curve', 'concave', 'convex');
  pair('Nose', 'nosetip', 'Tip angle', 'nose', 'nose-point', 'down', 'up');
  pair('Nose', 'nosetipwidth', 'Tip width', 'nose', 'nose-point-width');
  pair('Nose', 'nostrils', 'Nostril width', 'nose', 'nose-nostrils-width');
  pair('Nose', 'noseflare', 'Nostril flare', 'nose', 'nose-flaring');
  pair('Nose', 'nosevolume', 'Nose size', 'nose', 'nose-volume');
  pair('Mouth', 'mouthwidth', 'Mouth width', 'mouth', 'mouth-scale-horiz');
  pair('Mouth', 'upperlip', 'Upper lip fullness', 'mouth', 'mouth-upperlip-volume');
  pair('Mouth', 'lowerlip', 'Lower lip fullness', 'mouth', 'mouth-lowerlip-volume');
  pair('Mouth', 'upperlipheight', 'Upper lip height', 'mouth', 'mouth-upperlip-height');
  pair('Mouth', 'lowerlipheight', 'Lower lip height', 'mouth', 'mouth-lowerlip-height');
  pair('Mouth', 'cupidsbow', "Cupid's bow", 'mouth', 'mouth-cupidsbow');
  pair('Mouth', 'mouthcorners', 'Mouth corners', 'mouth', 'mouth-angles', 'down', 'up');
  pair('Mouth', 'mouthpos', 'Mouth height', 'mouth', 'mouth-trans', 'down', 'up');
  pair('Mouth', 'mouthdepth', 'Mouth projection', 'mouth', 'mouth-trans', 'backward', 'forward');
  pair('Mouth', 'philtrum', 'Philtrum', 'mouth', 'mouth-philtrum-volume');
  pair('Mouth', 'dimples', 'Dimples', 'mouth', 'mouth-dimples', 'in', 'out');
  pair('Mouth', 'laughlines', 'Laugh lines', 'mouth', 'mouth-laugh-lines', 'in', 'out');
  pair('Jaw & chin', 'jawwidth', 'Jaw width', 'chin', 'chin-width');
  pair('Jaw & chin', 'jawline', 'Jaw angle', 'chin', 'chin-bones');
  pair('Jaw & chin', 'chinheight', 'Chin height', 'chin', 'chin-height');
  pair('Jaw & chin', 'chinprominent', 'Chin projection', 'chin', 'chin-prominent');
  pair('Jaw & chin', 'prognathism', 'Underbite', 'chin', 'chin-prognathism');
  pair('Jaw & chin', 'chincleft', 'Chin cleft', 'chin', 'chin-cleft');
  add('Jaw & chin', 'chinpoint', 'Pointed chin', null, ['chin/chin-triangle']);
  pairLR('Cheeks', 'cheekbones', 'Cheekbones', 'cheek', 'cheek-bones');
  pairLR('Cheeks', 'cheekvolume', 'Cheek fullness', 'cheek', 'cheek-volume');
  pairLR('Cheeks', 'cheekinner', 'Inner cheeks', 'cheek', 'cheek-inner');
  pairLR('Cheeks', 'cheekheight', 'Cheek height', 'cheek', 'cheek-trans', 'down', 'up');
  pairLR('Ears', 'earsize', 'Ear size', 'ears', 'ear-scale');
  pairLR('Ears', 'earwing', 'Ears sticking out', 'ears', 'ear-wing');
  pairLR('Ears', 'earlobe', 'Earlobes', 'ears', 'ear-lobe');
  pairLR('Ears', 'earheight', 'Ear height', 'ears', 'ear-trans', 'down', 'up');
  add('Ears', 'earpointed', 'Pointed ears', null, LR('ears', 'ear-shape-pointed'));
  add('Ears', 'earround', 'Round ears', null, LR('ears', 'ear-shape-round'));
  BS.DETAILS = D;
  BS.BODY_GROUPS = ['Body type', 'Curves & shape', 'Figure', 'Torso', 'Chest', 'Hips & legs', 'Arms', 'Neck'];
  BS.FACE_GROUPS = ['Head shape', 'Eyes', 'Brows', 'Nose', 'Mouth', 'Jaw & chin', 'Cheeks', 'Ears'];

  BS.SKIN_TONES = ['#f8dcca', '#efc6ab', '#e2b08f', '#d29a78', '#bd8463', '#a26d4f', '#85563c', '#6a412c', '#4f2f21', '#3a2219'];
  BS.HAIR_COLORS = {
    'Jet black': '#0b0908', 'Soft black': '#1c1512', 'Dark brown': '#2f1f15', 'Brown': '#4d3220', 'Chestnut': '#6a3d22',
    'Auburn': '#7a2f17', 'Copper red': '#a3461f', 'Light brown': '#80603f', 'Dark blonde': '#a1824f', 'Golden blonde': '#c9a465',
    'Platinum': '#e6dccb', 'Grey': '#9c9a96', 'White': '#e9e7e2', 'Pastel pink': '#e3a3b5', 'Blue': '#2b4f9c', 'Green': '#2d7a52', 'Violet': '#5e3a8c',
  };
  BS.EYE_COLORS = {
    'Dark brown': '#3b2414', 'Brown': '#6b4425', 'Hazel': '#8a6a35', 'Amber': '#b07a2a', 'Green': '#5e7d43',
    'Grey-green': '#6e8070', 'Blue': '#4f7fae', 'Light blue': '#8fb2d0', 'Grey': '#8a9298', 'Violet': '#6f5a8f',
  };

  // Gender identity is independent of the body: it sets pronouns and the
  // starting point of Randomize, never limits what the body can be.
  BS.IDENTITIES = {
    woman: { label: 'Woman', pronouns: 'she/her', gender: [0, 0.08] },
    man: { label: 'Man', pronouns: 'he/him', gender: [0.92, 1] },
    transwoman: { label: 'Trans woman', pronouns: 'she/her', gender: [0.08, 0.3] },
    transman: { label: 'Trans man', pronouns: 'he/him', gender: [0.7, 0.9] },
    nonbinary: { label: 'Non-binary', pronouns: 'they/them', gender: [0.3, 0.7] },
    genderfluid: { label: 'Genderfluid', pronouns: 'they/them', gender: [0.25, 0.75] },
    agender: { label: 'Agender', pronouns: 'they/them', gender: [0.35, 0.65] },
    intersex: { label: 'Intersex', pronouns: 'they/them', gender: [0.3, 0.7] },
    twospirit: { label: 'Two-Spirit', pronouns: 'they/them', gender: [0.2, 0.8] },
  };
  // adult standing height in cm (mean, sd) at gender 0 and gender 1;
  // anything between blends, so women average shorter than men
  BS.HEIGHT_STATS = { female: [163, 7], male: [177, 7.5], min: 135, max: 215 };
  BS.expectedHeight = (gender) => BS.HEIGHT_STATS.female[0] + (BS.HEIGHT_STATS.male[0] - BS.HEIGHT_STATS.female[0]) * gender;
  BS.MAKEUP_STYLES = ['none', 'natural', 'everyday', 'soft glam', 'glam', 'smoky eye', 'bold lip', 'graphic liner', 'editorial'];

  // A plausible, diverse adult: correlated traits drawn from real-world
  // distributions (height by sex, BMI, ageing, ancestry and pigmentation).
  BS.randomPerson = function (rand = Math.random, opts = {}) {
    const R = rand, pick = (a) => a[Math.floor(R() * a.length)];
    const normal = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const wpick = (o) => { let t = 0; for (const k in o) t += o[k]; let r = R() * t; for (const k in o) { r -= o[k]; if (r <= 0) return k; } return Object.keys(o)[0]; };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const p = BS.defaultParams();
    p.identity = opts.identity || wpick({ woman: 44, man: 44, transwoman: 2, transman: 2, nonbinary: 4, genderfluid: 1.5, agender: 1, intersex: 1, twospirit: 0.5 });
    const id = BS.IDENTITIES[p.identity];
    p.pronouns = id.pronouns;
    p.gender = id.gender[0] + (id.gender[1] - id.gender[0]) * R();
    p.age = Math.round(clamp(18 + Math.abs(normal()) * 22 + R() * 6, 18, 90));
    // ancestry mix: mostly one, often mixed
    const main = wpick({ african: 1, asian: 1, caucasian: 1 }), mix = R() < 0.35 ? 0.25 + R() * 0.35 : R() * 0.12;
    const others = ['african', 'asian', 'caucasian'].filter((k) => k !== main), second = pick(others);
    p.african = p.asian = p.caucasian = 0;
    p[main] = 1 - mix; p[second] = mix;
    // pigmentation follows ancestry, with real overlap
    const toneBase = { african: 0.74, asian: 0.3, caucasian: 0.12 };
    p.skinTone = clamp(toneBase.african * p.african + toneBase.asian * p.asian + toneBase.caucasian * p.caucasian + normal() * 0.08, 0, 1);
    p.undertone = clamp(0.5 + normal() * 0.2 + (p.asian - 0.3) * 0.2, 0, 1);
    p.freckles = p.skinTone < 0.25 && R() < 0.3 ? 0.2 + R() * 0.6 : 0;
    // body: BMI-like weight, muscle falls with age, height by sex then age
    const bmi = clamp(25.5 + normal() * 4.5 + (p.age - 40) * 0.05, 17, 45);
    p.weight = clamp(0.5 + (bmi - 24) / 18, 0.05, 1);
    p.muscle = clamp(0.45 + p.gender * 0.15 + normal() * 0.18 - Math.max(0, p.age - 45) * 0.006, 0, 1);
    p.proportions = clamp(0.5 + normal() * 0.15, 0, 1);
    const fem = 1 - p.gender, hs = BS.HEIGHT_STATS;
    p.heightCm = Math.round(clamp(BS.expectedHeight(p.gender) + normal() * (hs.female[1] * fem + hs.male[1] * p.gender) - Math.max(0, p.age - 60) * 0.15, 140, 205));
    p.breastSize = fem > 0.5 ? clamp(0.45 + normal() * 0.15 + (p.weight - 0.5) * 0.4, 0.15, 0.95) : 0.5;
    p.breastFirmness = clamp(0.55 - Math.max(0, p.age - 30) / 90 + normal() * 0.1, 0.05, 0.7);
    p.details = {};
    const dk = BS.DETAILS.filter((d) => !/^shape-|^head-/.test(d.key));
    for (const d of dk) if (R() < 0.35) p.details[d.key] = Math.round(clamp(normal() * 0.28, -0.8, 0.8) * 100) / 100;
    // waist and silhouette vary independently of weight
    p.details.waist = Math.round(clamp(normal() * 0.3 + (p.weight - 0.5) * 0.5, -0.9, 0.9) * 100) / 100;
    const shapes = fem > 0.5 ? ['hourglass', 'neathourglass', 'pear', 'apple', 'rectangle', 'invtriangle', 'column', 'diamond'] : ['trapezoid', 'mapple', 'mtriangle', 'mcolumn', 'minv', 'rectangle'];
    if (R() < 0.6) p.details['shape-' + pick(shapes)] = Math.round((0.2 + R() * 0.5) * 100) / 100;
    if (R() < 0.5) p.details['head-' + pick(['oval', 'round', 'square', 'rectangular', 'triangular', 'invertedtriangular', 'diamond'])] = Math.round((0.2 + R() * 0.5) * 100) / 100;
    // hair, eyes, brows: by ancestry and age
    const darkHair = p.african + p.asian > 0.6 || R() < 0.45;
    const natural = darkHair ? wpick({ 'Jet black': 3, 'Soft black': 3, 'Dark brown': 3, 'Brown': 1 })
      : wpick({ 'Dark brown': 3, 'Brown': 3, 'Light brown': 2, 'Dark blonde': 2, 'Golden blonde': 1.2, 'Platinum': 0.3, 'Auburn': 0.7, 'Copper red': 0.5, 'Chestnut': 1.5 });
    const grey = p.age > 38 ? clamp((p.age - 38) / 35 + normal() * 0.15, 0, 1) : 0;
    p.hairColor = grey > 0.85 ? 'White' : grey > 0.55 ? 'Grey' : R() < 0.06 ? pick(['Pastel pink', 'Blue', 'Green', 'Violet', 'Platinum']) : natural;
    p.hairColorHex = null;
    p.eyeColor = p.african + p.asian > 0.6 ? wpick({ 'Dark brown': 6, 'Brown': 3, 'Hazel': 0.5 })
      : wpick({ 'Brown': 3, 'Dark brown': 1.5, 'Hazel': 1.5, 'Green': 1, 'Grey-green': 0.6, 'Blue': 2, 'Light blue': 0.8, 'Grey': 0.5, 'Amber': 0.3 });
    const femStyle = p.identity === 'woman' || p.identity === 'transwoman' || (p.gender < 0.4 && R() < 0.8);
    p.hairStyle = femStyle ? wpick({ long: 4, wavy: 3, bob: 2, ponytail: 2, bun: 1.5, curly: p.african > 0.5 ? 3 : 1, afro: p.african > 0.5 ? 2 : 0, braid: 1, short: 1, medium: 2 })
      : wpick({ short: 5, crew: 3, buzz: 2, medium: 2, bald: p.age > 35 ? 2 : 0.3, curly: p.african > 0.5 ? 2 : 0.5, afro: p.african > 0.5 ? 1 : 0, long: 0.6, ponytail: 0.4 });
    p.hairLength = Math.round(R() * 100) / 100;
    p.curl = clamp((p.african > 0.5 ? 0.7 : 0.15) + normal() * 0.2, 0, 1);
    p.beard = p.gender > 0.7 && R() < 0.55 ? wpick({ stubble: 4, short: 3, full: 2, goatee: 1, mustache: 1 }) : 'none';
    p.bodyHair = clamp(p.gender * 0.35 + normal() * 0.12, 0, 1);
    p.browThickness = clamp(0.45 + p.gender * 0.2 + normal() * 0.15, 0, 1);
    p.lashLength = clamp(0.5 + fem * 0.15 + normal() * 0.12, 0, 1);
    p.makeupStyle = femStyle && R() < 0.55 ? pick(['natural', 'everyday', 'everyday', 'soft glam', 'glam', 'smoky eye', 'bold lip']) : R() < 0.06 ? pick(['natural', 'graphic liner', 'editorial']) : 'none';
    p.makeup = p.makeupStyle === 'none' ? 0 : 0.6;
    p.lipColor = clamp(0.35 + normal() * 0.12, 0, 1);
    p.blush = clamp(0.25 + normal() * 0.1, 0, 1);
    p.outfit = pick(['casual', 'casual', 'sport', 'formal', 'dress', 'underwear']);
    if (p.outfit === 'dress' && !femStyle && R() < 0.8) p.outfit = 'casual';
    p.outfitColor = pick(['#2d3646', '#6b2d3a', '#2f5a4a', '#c9b79c', '#1e1e22', '#7a6a9a', '#a33b2a', '#e8e2d6', '#3b5c8a']);
    p.outfitColor2 = pick(['#d9d4cc', '#22252c', '#46546b', '#8a7356', '#f2efe9']);
    p.name = pick(['Ama', 'Kofi', 'Mei', 'Hiro', 'Lena', 'Mateo', 'Priya', 'Arjun', 'Sofia', 'Noah', 'Zara', 'Omar', 'Ines', 'Lars', 'Yuki', 'Kai', 'Ayo', 'Sasha', 'River', 'Elif', 'Tariq', 'Nia', 'Mila', 'Jonas', 'Leilani', 'Rafael', 'Ana', 'Wei', 'Imani', 'Finn']);
    return p;
  };

  // Face looks: combinations of the face sliders, each within normal human
  // variation. Used by presets, by Randomize and by the game's clients.
  BS.LOOKS = {
    cute: { eyesize: 0.16, eyespacing: 0.08, mouthwidth: -0.15, upperlip: -0.1, lowerlip: -0.05, nosewidth: -0.25, nosevolume: -0.3, noselength: -0.15, nosetip: 0.25, chinheight: -0.2, jawwidth: -0.3, cheekvolume: 0.08, 'head-round': 0.15, browheight: 0.1, breastpoint: -0.3 },
    doll: { eyesize: 0.22, eyespacing: 0.12, mouthwidth: -0.22, upperlip: 0, lowerlip: 0, cupidsbow: 0.3, nosevolume: -0.4, nosewidth: -0.3, nosetip: 0.3, chinheight: -0.25, jawwidth: -0.35, cheekvolume: 0.12, 'head-round': 0.2, breastpoint: -0.3 },
    glam: { cheekbones: 0.55, cheekinner: -0.25, jawline: 0.25, eyetilt: 0.3, eyesize: 0.06, upperlip: 0.05, lowerlip: 0.08, cupidsbow: 0.35, nosewidth: -0.3, nosebridge: -0.25, nosetip: 0.15, chinprominent: 0.15, 'head-oval': 0.45, browangle: 0.25, breastpoint: -0.3 },
    girlnextdoor: { eyesize: 0.08, upperlip: -0.15, lowerlip: -0.1, nosewidth: -0.12, nosetip: 0.12, cheekvolume: 0.15, 'head-oval': 0.35, dimples: 0.35, breastpoint: -0.3 },
    model: { cheekbones: 0.6, cheekinner: -0.35, jawline: 0.35, jawwidth: 0.05, eyetilt: 0.2, upperlip: 0, lowerlip: 0.05, nosewidth: -0.2, nosebridge: -0.2, chinprominent: 0.2, 'head-diamond': 0.35, forehead: 0.1, breastpoint: -0.3 },
    exotic: { eyetilt: 0.35, epicanthus: 0.2, eyesize: 0.05, cheekbones: 0.45, upperlip: 0.05, lowerlip: 0.05, nosewidth: -0.1, 'head-invertedtriangular': 0.35, breastpoint: -0.3 },
    soft: { cheekvolume: 0.15, headfat: 0.08, eyesize: 0.08, upperlip: -0.1, lowerlip: -0.05, jawline: -0.25, chinheight: -0.1, 'head-round': 0.15, breastpoint: -0.3 },
    pretty: { eyesize: 0.1, cheekbones: 0.3, upperlip: -0.1, lowerlip: -0.08, nosewidth: -0.2, nosetip: 0.15, jawwidth: -0.15, 'head-oval': 0.4, eyetilt: 0.15, breastpoint: -0.3 },
    rugged: { jawwidth: 0.45, jawline: 0.45, browridge: 0.4, chinprominent: 0.3, cheekbones: 0.25, nosewidth: 0.15, nosebridge: 0.2, 'head-square': 0.45, mouthwidth: 0.1 },
    prettyboy: { jawline: 0.2, cheekbones: 0.35, eyesize: 0.06, upperlip: -0.15, lowerlip: -0.1, nosewidth: -0.15, chinheight: -0.05, 'head-oval': 0.4 },
  };

  BS.defaultParams = function () {
    return {
      name: 'New person', identity: 'nonbinary', pronouns: 'they/them', heightCm: null, heightScale: 1,
      makeupStyle: 'none', lipstick: null, eyeshadow: null, nailColor: null,
      gender: 0.5, age: 28, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5,
      african: 0.33, asian: 0.33, caucasian: 0.34,
      breastSize: 0.5, breastFirmness: 0.5,
      details: {},
      skinTone: 0.35, undertone: 0.5, freckles: 0.0, blush: 0.25, skinShine: 0.4, bodyHair: 0.15, veins: 0.2,
      lipColor: 0.35, makeup: 0,
      eyeColor: 'Brown', eyeColorHex: null, heterochromia: false,
      hairStyle: 'short', hairColor: 'Dark brown', hairColorHex: null, hairLength: 0.5, hairVolume: 0.5, curl: 0.15,
      browStyle: 'natural', browThickness: 0.5, beard: 'none', lashLength: 0.5,
      outfit: 'underwear', outfitColor: '#2d3646', outfitColor2: '#d9d4cc',
    };
  };

  const P = (o) => Object.assign(BS.defaultParams(), o);
  BS.PRESETS = {
    'Woman': P({ name: 'Maya', identity: 'woman', pronouns: 'she/her', heightCm: 165, gender: 0, breastSize: 0.55, hairStyle: 'long', hairColor: 'Chestnut', eyeColor: 'Hazel', skinTone: 0.32, outfitColor: '#3a2f3f', lipColor: 0.5, lashLength: 0.7, details: { mouthwidth: -0.1, upperlip: -0.15, lowerlip: -0.1, jawwidth: -0.2 } }),
    'Man': P({ name: 'Leo', identity: 'man', pronouns: 'he/him', heightCm: 179, gender: 1, muscle: 0.6, hairStyle: 'short', hairColor: 'Dark brown', eyeColor: 'Brown', skinTone: 0.4, beard: 'stubble', bodyHair: 0.45, details: { jawwidth: 0.25, browridge: 0.2 } }),
    'Androgynous': P({ name: 'Rowan', identity: 'nonbinary', pronouns: 'they/them', heightCm: 170, gender: 0.5, hairStyle: 'bob', hairColor: 'Platinum', eyeColor: 'Grey', skinTone: 0.12, details: { cheekbones: 0.3 } }),
    'Athlete': P({ name: 'Jordan', identity: 'man', pronouns: 'he/him', heightCm: 188, gender: 0.95, muscle: 0.95, weight: 0.45, height: 0.7, hairStyle: 'buzz', hairColor: 'Jet black', african: 0.85, asian: 0.05, caucasian: 0.1, skinTone: 0.78, eyeColor: 'Dark brown', outfit: 'sport', outfitColor: '#1f2a44', details: { shoulders: 0.4, vshape: 0.5, pecs: 0.4 } }),
    'Curvy': P({ name: 'Ana', identity: 'woman', pronouns: 'she/her', heightCm: 160, gender: 0.03, weight: 0.75, muscle: 0.35, breastSize: 0.75, hairStyle: 'curly', hairColor: 'Soft black', skinTone: 0.55, eyeColor: 'Dark brown', african: 0.4, caucasian: 0.4, asian: 0.2, details: { 'shape-hourglass': 0.7, hips: 0.4, glutes: 0.4, hipcurve: 0.4, breastround: -0.2 } }),
    'Plus-size': P({ name: 'Sam', identity: 'man', pronouns: 'he/him', heightCm: 175, gender: 0.95, weight: 1, muscle: 0.4, hairStyle: 'short', hairColor: 'Brown', skinTone: 0.3, beard: 'full', details: { belly: 0.4, doublechin: 0.4 } }),
    'Elder': P({ name: 'Ruth', identity: 'woman', pronouns: 'she/her', heightCm: 158, gender: 0.03, age: 78, weight: 0.55, muscle: 0.25, breastFirmness: 0.15, hairStyle: 'bun', hairColor: 'White', skinTone: 0.2, eyeColor: 'Light blue', asian: 0.1, caucasian: 0.8, african: 0.1, outfit: 'casual', outfitColor: '#6d5a6e' }),
    'Trans woman': P({ name: 'Lyra', identity: 'transwoman', pronouns: 'she/her', heightCm: 172, gender: 0.18, breastSize: 0.55, hairStyle: 'long', hairColor: 'Auburn', eyeColor: 'Green', skinTone: 0.15, lashLength: 0.7, makeupStyle: 'everyday', makeup: 0.6, outfit: 'dress', outfitColor: '#5e3a5a' }),
    'Trans man': P({ name: 'Elliot', identity: 'transman', pronouns: 'he/him', heightCm: 168, gender: 0.8, muscle: 0.62, hairStyle: 'crew', hairColor: 'Brown', eyeColor: 'Hazel', skinTone: 0.42, beard: 'stubble', outfit: 'casual', outfitColor: '#2f5a4a' }),
    'Cute': P({ name: 'Lily', identity: 'woman', pronouns: 'she/her', heightCm: 158, gender: 0.02, age: 23, weight: 0.45, muscle: 0.4, breastSize: 0.6, breastFirmness: 0.6, skinTone: 0.12, undertone: 0.55, freckles: 0.25, hairStyle: 'ponytail', hairColor: 'Golden blonde', eyeColor: 'Blue', lashLength: 0.8, makeupStyle: 'natural', makeup: 0.55, blush: 0.45, outfit: 'casual', outfitColor: '#e7a5b8', outfitColor2: '#3b5c8a', details: Object.assign({}, BS.LOOKS.cute, { waist: -0.25, hips: 0.15, glutes: 0.2 }) }),
    'Glam': P({ name: 'Valentina', identity: 'woman', pronouns: 'she/her', heightCm: 170, gender: 0.0, age: 27, weight: 0.5, muscle: 0.45, breastSize: 0.72, breastFirmness: 0.6, skinTone: 0.38, undertone: 0.6, hairStyle: 'wavy', hairColor: 'Dark brown', eyeColor: 'Hazel', lashLength: 0.9, makeupStyle: 'glam', makeup: 0.8, outfit: 'dress', outfitColor: '#7a1f2b', details: Object.assign({}, BS.LOOKS.glam, { 'shape-hourglass': 0.6, waist: -0.4, hips: 0.35, glutes: 0.45, breastround: 0.1, hipcurve: 0.3 }) }),
    'Girl next door': P({ name: 'Emma', identity: 'woman', pronouns: 'she/her', heightCm: 164, gender: 0.03, age: 25, weight: 0.5, breastSize: 0.55, skinTone: 0.15, freckles: 0.35, hairStyle: 'long', hairColor: 'Light brown', eyeColor: 'Green', lashLength: 0.7, makeupStyle: 'natural', makeup: 0.4, outfit: 'casual', outfitColor: '#d9c6a5', details: Object.assign({}, BS.LOOKS.girlnextdoor, { waist: -0.15 }) }),
    'Sporty': P({ name: 'Kayla', identity: 'woman', pronouns: 'she/her', heightCm: 168, gender: 0.03, age: 26, weight: 0.42, muscle: 0.78, breastSize: 0.5, breastFirmness: 0.6, skinTone: 0.55, hairStyle: 'ponytail', hairColor: 'Soft black', eyeColor: 'Brown', makeupStyle: 'none', outfit: 'sport', outfitColor: '#1f2a44', outfitColor2: '#2b2d33', african: 0.6, caucasian: 0.3, asian: 0.1, details: Object.assign({}, BS.LOOKS.pretty, { glutes: 0.55, thighs: 0.25, waist: -0.35, belly: -0.3, calfmuscle: 0.3, buttlift: 0.4, buttround: 0.2, breastsupport: 0.4 }) }),
    'Thick': P({ name: 'Jasmine', identity: 'woman', pronouns: 'she/her', heightCm: 162, gender: 0.02, age: 29, weight: 0.72, muscle: 0.42, breastSize: 0.8, breastFirmness: 0.6, skinTone: 0.68, undertone: 0.6, hairStyle: 'curly', hairColor: 'Soft black', curl: 0.8, eyeColor: 'Dark brown', lashLength: 0.85, makeupStyle: 'soft glam', makeup: 0.7, outfit: 'dress', outfitColor: '#2f5a4a', african: 0.8, caucasian: 0.15, asian: 0.05, details: Object.assign({}, BS.LOOKS.soft, { 'shape-hourglass': 0.75, hips: 0.6, glutes: 0.8, thighs: 0.45, waist: -0.2, belly: 0.1, buttround: 0.3, hipcurve: 0.5, breastside: 0.2 }) }),
    'Petite': P({ name: 'Yuna', identity: 'woman', pronouns: 'she/her', heightCm: 151, gender: 0.02, age: 24, weight: 0.38, muscle: 0.38, breastSize: 0.38, skinTone: 0.2, undertone: 0.6, hairStyle: 'bob', hairColor: 'Jet black', eyeColor: 'Dark brown', makeupStyle: 'everyday', makeup: 0.55, outfit: 'casual', outfitColor: '#f2d0d8', asian: 0.9, caucasian: 0.1, african: 0, details: Object.assign({}, BS.LOOKS.doll, { waist: -0.2 }) }),
    'Model': P({ name: 'Nadia', identity: 'woman', pronouns: 'she/her', heightCm: 180, gender: 0.02, age: 24, weight: 0.36, muscle: 0.45, proportions: 0.9, breastSize: 0.48, skinTone: 0.3, hairStyle: 'long', hairColor: 'Platinum', eyeColor: 'Grey-green', lashLength: 0.85, makeupStyle: 'editorial', makeup: 0.7, outfit: 'formal', outfitColor: '#e8e2d6', outfitColor2: '#1e1e22', details: Object.assign({}, BS.LOOKS.model, { upperleglen: 0.3, lowerleglen: 0.2, waist: -0.35, belly: -0.3 }) }),
    'Bombshell': P({ name: 'Sofia', identity: 'woman', pronouns: 'she/her', heightCm: 166, gender: 0.0, age: 28, weight: 0.58, muscle: 0.5, breastSize: 0.8, breastFirmness: 0.6, skinTone: 0.28, undertone: 0.65, hairStyle: 'wavy', hairColor: 'Auburn', eyeColor: 'Amber', lashLength: 0.95, makeupStyle: 'bold lip', makeup: 0.8, outfit: 'swim', outfitColor: '#a33b2a', details: Object.assign({}, BS.LOOKS.exotic, { 'shape-hourglass': 0.85, waist: -0.5, hips: 0.5, glutes: 0.6, breastround: 0.1, buttround: 0.3, hipcurve: 0.35 }) }),
    'Pretty boy': P({ name: 'Theo', identity: 'man', pronouns: 'he/him', heightCm: 178, gender: 0.9, age: 24, weight: 0.42, muscle: 0.6, hairStyle: 'medium', hairColor: 'Light brown', eyeColor: 'Blue', skinTone: 0.12, outfit: 'casual', outfitColor: '#e8e2d6', details: Object.assign({}, BS.LOOKS.prettyboy, { vshape: 0.3, belly: -0.3 }) }),
    'Rugged': P({ name: 'Marcus', identity: 'man', pronouns: 'he/him', heightCm: 185, gender: 1, age: 34, weight: 0.58, muscle: 0.82, hairStyle: 'crew', hairColor: 'Dark brown', eyeColor: 'Brown', skinTone: 0.45, beard: 'short', bodyHair: 0.5, outfit: 'formal', outfitColor: '#3b5c8a', details: Object.assign({}, BS.LOOKS.rugged, { shoulders: 0.4, vshape: 0.45, pecs: 0.4, glutes: 0.3 }) }),
    'East Asian': P({ name: 'Mei', identity: 'woman', pronouns: 'she/her', heightCm: 158, gender: 0.03, asian: 0.95, caucasian: 0.03, african: 0.02, skinTone: 0.22, undertone: 0.6, hairStyle: 'long', hairColor: 'Jet black', eyeColor: 'Dark brown', height: 0.4, details: { epicanthus: 0.4, eyefold: -0.3 } }),
  };
})();
