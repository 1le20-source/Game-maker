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
  pair('Torso', 'shoulders', 'Shoulder width', 'measure', 'measure-shoulder-dist');
  pair('Torso', 'vshape', 'V-shape', 'torso', 'torso-vshape');
  pair('Torso', 'chest', 'Chest', 'measure', 'measure-bust-circ');
  pair('Torso', 'underbust', 'Rib cage', 'measure', 'measure-underbust-circ');
  pair('Torso', 'pecs', 'Pecs', 'torso', 'torso-muscle-pectoral');
  pair('Torso', 'lats', 'Back muscles', 'torso', 'torso-muscle-dorsi');
  pair('Torso', 'waist', 'Waist', 'measure', 'measure-waist-circ');
  pair('Torso', 'belly', 'Belly', 'stomach', 'stomach-pregnant');
  pair('Hips & legs', 'hips', 'Hips', 'measure', 'measure-hips-circ');
  pair('Hips & legs', 'hipwidth', 'Hip width', 'hip', 'hip-scale-horiz');
  pair('Hips & legs', 'waistline', 'Waist height', 'hip', 'hip-waist', 'down', 'up');
  pair('Hips & legs', 'glutes', 'Glutes', 'buttocks', 'buttocks-volume');
  pair('Hips & legs', 'pelvis', 'Pelvis tone', 'pelvis', 'pelvis-tone');
  pair('Hips & legs', 'thighs', 'Thighs', 'measure', 'measure-thigh-circ');
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
  BS.BODY_GROUPS = ['Body type', 'Torso', 'Chest', 'Hips & legs', 'Arms', 'Neck'];
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

  BS.defaultParams = function () {
    return {
      name: 'New person',
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
    'Woman': P({ name: 'Maya', gender: 0, breastSize: 0.55, hairStyle: 'long', hairColor: 'Chestnut', eyeColor: 'Hazel', skinTone: 0.32, outfitColor: '#3a2f3f', lipColor: 0.5, lashLength: 0.7, details: { mouthwidth: -0.1, upperlip: 0.25, lowerlip: 0.2, jawwidth: -0.2 } }),
    'Man': P({ name: 'Leo', gender: 1, muscle: 0.6, hairStyle: 'short', hairColor: 'Dark brown', eyeColor: 'Brown', skinTone: 0.4, beard: 'stubble', bodyHair: 0.45, details: { jawwidth: 0.25, browridge: 0.2 } }),
    'Androgynous': P({ name: 'Rowan', gender: 0.5, hairStyle: 'bob', hairColor: 'Platinum', eyeColor: 'Grey', skinTone: 0.12, details: { cheekbones: 0.3 } }),
    'Athlete': P({ name: 'Jordan', gender: 0.85, muscle: 0.95, weight: 0.45, height: 0.7, hairStyle: 'buzz', hairColor: 'Jet black', african: 0.85, asian: 0.05, caucasian: 0.1, skinTone: 0.78, eyeColor: 'Dark brown', outfit: 'sport', outfitColor: '#1f2a44', details: { shoulders: 0.4, vshape: 0.5, pecs: 0.4 } }),
    'Curvy': P({ name: 'Ana', gender: 0.05, weight: 0.75, muscle: 0.35, breastSize: 0.75, hairStyle: 'curly', hairColor: 'Soft black', skinTone: 0.55, eyeColor: 'Dark brown', african: 0.4, caucasian: 0.4, asian: 0.2, details: { 'shape-hourglass': 0.7, hips: 0.4, glutes: 0.4 } }),
    'Plus-size': P({ name: 'Sam', gender: 0.75, weight: 1, muscle: 0.4, hairStyle: 'short', hairColor: 'Brown', skinTone: 0.3, beard: 'full', details: { belly: 0.4, doublechin: 0.4 } }),
    'Elder': P({ name: 'Ruth', gender: 0.1, age: 78, weight: 0.55, muscle: 0.25, breastFirmness: 0.15, hairStyle: 'bun', hairColor: 'White', skinTone: 0.2, eyeColor: 'Light blue', asian: 0.1, caucasian: 0.8, african: 0.1, outfit: 'casual', outfitColor: '#6d5a6e' }),
    'East Asian': P({ name: 'Mei', gender: 0.08, asian: 0.95, caucasian: 0.03, african: 0.02, skinTone: 0.22, undertone: 0.6, hairStyle: 'long', hairColor: 'Jet black', eyeColor: 'Dark brown', height: 0.4, details: { epicanthus: 0.4, eyefold: -0.3 } }),
  };
})();
