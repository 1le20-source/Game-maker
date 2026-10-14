// The VRM character: loading, procedural idle, expressions, gestures, look-at,
// lip sync and touch hit-testing.
//
// Pose pipeline each frame:
//   1. base pose + idle layers (breathing, weight shift, sway) as Euler offsets
//   2. look-at head turn, talking beats, gesture `add` offsets
//   3. Euler -> quaternion on the normalized bones
//   4. gesture `set` targets and arm IK (`reach`) slerped in by weight
//   5. expressions (emotion blend, blink, visemes), then vrm.update(dt)

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { clamp, damp, rand, pick, smoothstep, prefersReducedMotion } from './util.js';

const VRM_BYTES = 10776032; // used when the server sends no content-length

// Emotion name -> expression weights (+ special keys handled here).
export const EMOTIONS = {
  neutral: {},
  happy: { happy: 0.72 },
  sad: { sad: 0.68 },
  angry: { angry: 0.55 },
  surprised: { surprised: 0.7 },
  relaxed: { relaxed: 0.7 },
  shy: { happy: 0.3, relaxed: 0.32, _blush: 1, _headPitch: 0.1, _gazeDown: 1 },
  excited: { happy: 1.0, surprised: 0.12, _bounce: 1 },
  sleepy: { relaxed: 0.5, _lids: 0.38, _slow: 1 },
};
const EXPR_KEYS = ['happy', 'sad', 'angry', 'surprised', 'relaxed'];
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

const ORDER = (b) => (/UpperArm|LowerArm|Hand$/.test(b) ? 'ZYX' : /^(hips|spine|chest|upperChest|neck|head)$/.test(b) ? 'YXZ' : 'XYZ');
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'];
const SEGS = ['Proximal', 'Intermediate', 'Distal'];

// Relaxed standing pose (normalized bone Euler angles, radians).
function basePose(P) {
  P.spine = [0.02, 0, 0];
  P.chest = [-0.02, 0, 0];
  P.upperChest = [0, 0, 0];
  P.neck = [0.03, 0, 0];
  P.head = [0.02, 0, 0];
  P.leftShoulder = [0, 0, -0.05];
  P.rightShoulder = [0, 0, 0.05];
  P.leftUpperArm = [0.1, -0.12, -1.18];
  P.rightUpperArm = [0.1, 0.12, 1.18];
  P.leftLowerArm = [0, -0.32, 0];
  P.rightLowerArm = [0, 0.32, 0];
  P.leftHand = [0, -0.08, -0.08];
  P.rightHand = [0, 0.08, 0.08];
  for (const f of FINGERS) {
    SEGS.forEach((s, i) => {
      const c = [0.22, 0.3, 0.22][i] + (f === 'Little' ? 0.1 : 0);
      P['left' + f + s] = [0, 0, -c];
      P['right' + f + s] = [0, 0, c];
    });
  }
  P.leftThumbProximal = [0, -0.25, 0.1];
  P.rightThumbProximal = [0, 0.25, -0.1];
  P.leftUpperLeg = [0, 0, 0.015];
  P.rightUpperLeg = [0, 0, -0.015];
  P.leftLowerLeg = [0.02, 0, 0];
  P.rightLowerLeg = [0.02, 0, 0];
}

export function createAvatar(app) {
  const root = new THREE.Group();
  root.name = 'avatar';
  const reduced = () => prefersReducedMotion() || app.state.settings?.reduceMotion;

  let vrm = null;
  let bones = {}; // name -> normalized node
  const restPos = {}; // name -> Vector3 in avatar root space (T-pose)
  let armLen = { left: [0.22, 0.215], right: [0.22, 0.215] };
  const gestures = new Map();
  const idles = new Map(); // name -> weight
  let active = []; // running gestures [{name, def, t, speed, loop, weight, out, resolve}]
  const P = {}; // working pose (Euler triples)
  const Q = new THREE.Quaternion(), E = new THREE.Euler();

  // expression state
  const exprCur = {}; const exprTarget = {};
  [...EXPR_KEYS, ...VISEMES, 'blink', 'blinkLeft', 'blinkRight'].forEach((k) => { exprCur[k] = 0; exprTarget[k] = 0; });
  let emotion = 'neutral', emotionUntil = 0, emotionIntensity = 1;
  let blush = 0, blushMeshes = [];
  let special = { _headPitch: 0, _gazeDown: 0, _bounce: 0, _lids: 0, _slow: 0, _blush: 0 };

  // blink
  let blinkT = -1, nextBlink = 2, doubleBlink = false;
  // look
  const lookObj = new THREE.Object3D();
  let lookMode = 'camera', lookPoint = new THREE.Vector3(), lookUntil = 0;
  let saccade = new THREE.Vector3(), nextSaccade = 0;
  let glanceUntil = 0, nextGlance = 8, glanceDir = new THREE.Vector3();
  let headYaw = 0, headPitch = 0;
  // idle
  let weightShift = 0, weightGoal = 0, nextWeight = 3;
  let nextFidget = 18, lastInteract = 0;
  // speech
  const speech = { queue: [], cur: null, energy: 0 };
  let clock = 0;

  const shadow = makeShadow();
  root.add(shadow);

  const avatar = {
    root,
    get vrm() { return vrm; },
    get ready() { return !!vrm; },
    get emotion() { return emotion; },
    get speaking() { return !!speech.cur || speech.queue.length > 0; },
    EMOTIONS,

    async load(url, onProgress) {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await new Promise((resolve, reject) => {
        loader.load(url, resolve, (e) => onProgress?.(Math.min(1, e.loaded / (e.total || VRM_BYTES))), reject);
      });
      onProgress?.(1, 'parse');
      const v = gltf.userData.vrm;
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.combineMorphs(v);
      VRMUtils.rotateVRM0(v);
      v.scene.traverse((o) => {
        o.frustumCulled = false;
        if (o.isSkinnedMesh) {
          o.geometry.computeBoundingSphere();
          o.boundingSphere = o.geometry.boundingSphere.clone();
          o.boundingSphere.radius *= 1.6;
        }
      });
      vrm = v;
      root.add(v.scene);
      for (const name of Object.keys(v.humanoid.humanBones)) bones[name] = v.humanoid.getNormalizedBoneNode(name);
      // rest positions (T-pose) in avatar space
      v.scene.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
      for (const [name, node] of Object.entries(bones)) if (node) restPos[name] = node.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      for (const side of ['left', 'right']) {
        const lo = bones[side + 'LowerArm'], ha = bones[side + 'Hand'];
        if (lo && ha) armLen[side] = [lo.position.length(), ha.position.length()];
      }
      v.lookAt.target = lookObj;
      v.lookAt.autoUpdate = true;
      app.stage.scene.add(lookObj);
      try { buildBlush(); } catch (e) { console.warn('[avatar] blush skipped', e); }
      // Settle springs and constraints in the standing pose so the tee
      // sleeves hang down instead of keeping their T-pose shape.
      avatar.update(0, 0, true);
      avatar.resetPhysics();
      return v;
    },

    resetPhysics() {
      if (!vrm) return;
      root.updateMatrixWorld(true);
      composePose(1 / 60);
      vrm.update(1 / 60);
      vrm.springBoneManager?.reset();
      for (let i = 0; i < 90; i++) vrm.update(1 / 60);
    },

    // ---- emotions ----
    setEmotion(name, { intensity = 1, hold = 10 } = {}) {
      if (!EMOTIONS[name]) name = 'neutral';
      emotion = name;
      emotionIntensity = clamp(intensity, 0, 1.2);
      emotionUntil = clock + hold;
      app.bus.emit('emotion', { name, intensity: emotionIntensity });
    },

    // ---- gestures ----
    registerGesture(name, def) { gestures.set(name, { fadeIn: 0.25, fadeOut: 0.35, ...def }); },
    hasGesture(name) { return gestures.has(name); },
    gestureNames({ promptOnly = false } = {}) {
      return [...gestures.entries()].filter(([, d]) => !promptOnly || d.hint).map(([n, d]) => (promptOnly ? `${n} (${d.hint})` : n));
    },
    playGesture(name, { speed = 1, loop = false, weight = 1 } = {}) {
      const def = gestures.get(name);
      if (!def) return Promise.resolve(false);
      for (const g of active) if (!g.out) g.out = Math.min(g.t + 0.2, g.def.duration);
      return new Promise((resolve) => {
        active.push({ name, def, t: 0, speed, loop: loop || !!def.loop, weight, out: 0, resolve });
        app.bus.emit('gesture', { name });
      });
    },
    stopGesture(name) {
      for (const g of active) if (!name || g.name === name) { g.loop = false; g.out = g.t; }
    },
    get gesture() { return active.find((g) => !g.out)?.name || null; },
    registerIdle(name, weight = 1) { idles.set(name, weight); },

    // ---- look ----
    // target: 'camera' | THREE.Vector3 (world) | null (back to camera)
    lookAt(target, { hold = 2.5 } = {}) {
      if (!target || target === 'camera') { lookMode = 'camera'; return; }
      lookMode = 'point';
      lookPoint.copy(target);
      lookUntil = clock + hold;
    },

    // ---- speech + lip sync ----
    speak(text, { voice } = {}) {
      text = String(text || '').trim();
      if (!text) return Promise.resolve();
      return new Promise((resolve) => {
        speech.queue.push({ text, voice: voice ?? true, resolve });
        if (!speech.cur) nextUtterance();
      });
    },
    stopSpeaking() {
      for (const q of speech.queue) q.resolve();
      speech.queue.length = 0;
      if (speech.cur) { const r = speech.cur.resolve; speech.cur = null; r(); }
      app.voice?.cancel();
      app.bus.emit('speak:end', {});
    },

    // ---- queries ----
    bone(name) { return bones[name] || null; },
    rawBone(name) { return vrm?.humanoid.getRawBoneNode(name) || null; },
    restPosition(name) { return restPos[name]?.clone() || null; },
    worldPosition(name, out = new THREE.Vector3()) { const n = bones[name]; return n ? n.getWorldPosition(out) : out.copy(root.position); },
    findMaterials(substr) {
      const out = new Set();
      vrm?.scene.traverse((o) => {
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) if (!substr || m.name.includes(substr)) out.add(m);
      });
      return [...out];
    },
    noteInteraction() { lastInteract = clock; },

    // Touch hit test -> {zone, point, bone, object} or null.
    // zones: head, cheek, hand, shoulder (allowed) / personal (anything else)
    hitTest(x, y) {
      if (!vrm) return null;
      const hits = app.stage.raycast(x, y, [vrm.scene]).filter((h) => h.object.visible && !h.object.userData.noHit);
      if (!hits.length) return null;
      const h = hits[0];
      const p = h.point;
      const matName = (Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex || 0] : h.object.material)?.name || '';
      const wp = (n) => avatar.worldPosition(n, new THREE.Vector3());
      const head = wp('head'), neck = wp('neck');
      const eyeY = bones.leftEye ? wp('leftEye').y : head.y + 0.06;
      const local = root.worldToLocal(p.clone());
      const headLocal = root.worldToLocal(head.clone());
      let best = null, bestD = Infinity;
      for (const n of ['head', 'neck', 'upperChest', 'chest', 'spine', 'hips', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot']) {
        if (!bones[n]) continue;
        let d = p.distanceTo(wp(n));
        if (/Hand$/.test(n)) d -= 0.04; // hands are small, give them a little pull
        if (d < bestD) { bestD = d; best = n; }
      }
      let zone = 'personal';
      const isHair = /HAIR/i.test(matName);
      if (isHair && p.y > neck.y + 0.02) zone = 'head';
      else if (best === 'head') {
        if (p.y > eyeY + 0.01 || isHair) zone = 'head';
        else zone = Math.abs(local.x - headLocal.x) > 0.022 ? 'cheek' : 'cheek';
      } else if (/Hand$/.test(best) || (/LowerArm$/.test(best) && p.distanceTo(wp(best.replace('LowerArm', 'Hand'))) < 0.1)) zone = 'hand';
      else if (/Shoulder$|UpperArm$|LowerArm$/.test(best) && p.y > wp('spine').y) zone = 'shoulder';
      const side = local.x >= 0 ? 'left' : 'right';
      return { zone, side, point: p, bone: best, object: h.object, material: matName };
    },

    // ---- frame ----
    update(dt, t, settleOnly = false) {
      clock = t;
      if (!vrm) return;
      if (!settleOnly) {
        stepBlink(dt);
        stepLook(dt);
        stepIdle(dt);
        stepSpeech(dt);
      }
      composePose(dt);
      stepExpressions(dt);
      if (!settleOnly) vrm.update(Math.min(dt, 1 / 20));
      shadow.position.x = damp(shadow.position.x, (bones.hips?.position.x || 0) * 0.5, 4, dt || 0.016);
    },

    debug: {
      pose: P,
      setClockGesture(name, time) {
        const def = gestures.get(name);
        if (!def) return false;
        active = [{ name, def, t: time, speed: 0, loop: true, weight: 1, out: 0, resolve() {} }];
        return true;
      },
      clearGestures() { active = []; },
    },
  };

  // ======================================================================
  function stepBlink(dt) {
    nextBlink -= dt;
    if (blinkT < 0 && nextBlink <= 0) { blinkT = 0; doubleBlink = Math.random() < 0.18; }
    let b = 0;
    if (blinkT >= 0) {
      blinkT += dt;
      const close = 0.07, hold = 0.04, open = 0.13;
      if (blinkT < close) b = blinkT / close;
      else if (blinkT < close + hold) b = 1;
      else if (blinkT < close + hold + open) b = 1 - (blinkT - close - hold) / open;
      else {
        blinkT = -1;
        if (doubleBlink) { doubleBlink = false; nextBlink = 0.12; }
        else nextBlink = rand(2.2, 5.5) * (special._slow ? 0.7 : 1);
      }
    }
    exprTarget.blink = Math.max(b, special._lids * 0.9);
  }

  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  function stepLook(dt) {
    const cam = app.stage.camera;
    nextSaccade -= dt;
    if (nextSaccade <= 0) {
      nextSaccade = rand(0.4, 2.4);
      saccade.set(rand(-0.035, 0.035), rand(-0.02, 0.025), 0);
    }
    nextGlance -= dt;
    if (nextGlance <= 0 && lookMode === 'camera' && !avatar.speaking && clock - lastInteract > 4) {
      nextGlance = rand(9, 20);
      glanceUntil = clock + rand(0.8, 1.8);
      glanceDir.set(pick([-1, 1]) * rand(0.6, 1.2), rand(-0.3, 0.25), 0);
    }
    if (lookMode === 'point' && clock > lookUntil) lookMode = 'camera';
    const target = tmpV;
    if (lookMode === 'point') target.copy(lookPoint);
    else target.copy(cam.position);
    // gaze aversion when shy / glancing
    const headW = avatar.worldPosition('head', tmpV2);
    if (clock < glanceUntil) target.add(new THREE.Vector3(glanceDir.x, glanceDir.y, 0).applyQuaternion(cam.quaternion).multiplyScalar(headW.distanceTo(target) * 0.5));
    if (special._gazeDown > 0.01) target.y -= special._gazeDown * 0.5 * headW.distanceTo(target) * 0.35;
    target.add(saccade);
    lookObj.position.copy(target);
    // head follows partially (in avatar space)
    const l = root.worldToLocal(target.clone());
    const h = root.worldToLocal(headW.clone());
    const d = l.sub(h);
    const yaw = clamp(Math.atan2(d.x, Math.max(0.05, d.z)), -0.75, 0.75);
    const pitch = clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.35, 0.4);
    headYaw = damp(headYaw, yaw, 3.2, dt);
    headPitch = damp(headPitch, pitch, 3.2, dt);
  }

  function stepIdle(dt) {
    nextWeight -= dt;
    if (nextWeight <= 0) { nextWeight = rand(4, 9); weightGoal = pick([-1, -0.6, 0.6, 1]) * rand(0.6, 1); }
    weightShift = damp(weightShift, weightGoal, 0.9, dt);
    nextFidget -= dt;
    if (nextFidget <= 0) {
      nextFidget = rand(14, 30);
      if (!active.length && !avatar.speaking && clock - lastInteract > 6 && idles.size && !reduced()) {
        let total = 0; for (const w of idles.values()) total += w;
        let r = Math.random() * total;
        for (const [n, w] of idles) { r -= w; if (r <= 0) { avatar.playGesture(n); break; } }
      }
    }
    if (emotion !== 'neutral' && clock > emotionUntil) {
      emotion = app.runtime?.restingEmotion || 'neutral';
      emotionUntil = clock + 9999;
      app.bus.emit('emotion', { name: emotion, intensity: 1, resting: true });
    }
  }

  // ---- speech ----
  function nextUtterance() {
    const item = speech.queue.shift();
    if (!item) { speech.cur = null; app.bus.emit('speak:end', {}); return; }
    const timeline = buildTimeline(item.text, app.state.settings?.rate || 1);
    speech.cur = { ...item, timeline, t: 0, idx: 0, synced: false, live: false, ended: false };
    app.bus.emit('speak:start', { text: item.text });
    const cur = speech.cur;
    const finish = () => {
      if (speech.cur !== cur) return;
      cur.ended = true;
      cur.resolve();
      speech.cur = null;
      setTimeout(nextUtterance, 90);
    };
    cur.finish = finish;
    const useVoice = item.voice && app.voice?.enabled();
    if (useVoice) {
      app.voice.speak(item.text, {
        onStart() { cur.live = true; cur.t = 0; },
        onBoundary(charIndex) {
          const w = timeline.words.find((x) => charIndex >= x.i && charIndex < x.i + x.len + 1) || timeline.words.find((x) => x.i >= charIndex);
          if (w) { cur.t = w.t; cur.synced = true; }
        },
        onEnd: finish,
        onFail() { cur.live = false; cur.fallback = true; },
      });
    } else {
      cur.fallback = true;
    }
  }

  function stepSpeech(dt) {
    const cur = speech.cur;
    for (const k of VISEMES) exprTarget[k] = 0;
    if (!cur) { speech.energy = damp(speech.energy, 0, 6, dt); return; }
    const tl = cur.timeline;
    if (cur.fallback || cur.live) cur.t += dt;
    if (cur.fallback && cur.t > tl.duration + 0.1) { cur.finish(); return; }
    // live voice outlasting the estimate: keep babbling softly until onEnd
    let t = cur.t;
    if (cur.live && t > tl.duration) t = tl.duration * 0.5 + ((t - tl.duration) % (tl.duration * 0.5 || 1));
    while (cur.idx > 0 && tl.segs[cur.idx].t > t) cur.idx--;
    while (cur.idx < tl.segs.length - 1 && tl.segs[cur.idx + 1].t <= t) cur.idx++;
    const s = tl.segs[cur.idx];
    let energy = 0;
    if (s && s.v && t < s.t + s.d) {
      const k = Math.sin(clamp((t - s.t) / s.d, 0, 1) * Math.PI) * 0.4 + 0.6;
      exprTarget[s.v] = s.w * k;
      energy = s.w;
    }
    speech.energy = damp(speech.energy, energy, 10, dt);
  }

  // ---- expressions ----
  function stepExpressions(dt) {
    const em = EMOTIONS[emotion] || {};
    const talking = speech.cur ? 0.55 : 1;
    for (const k of EXPR_KEYS) exprTarget[k] = (em[k] || 0) * emotionIntensity * (k === 'happy' || k === 'surprised' ? talking : 1);
    for (const k of Object.keys(special)) special[k] = damp(special[k], (em[k] || 0) * emotionIntensity, 3, dt || 0.016);
    // gesture expression contributions (max)
    for (const g of active) for (const [k, v] of Object.entries(g.ctx?.exprs || {})) {
      if (k === '_blush') special._blush = Math.max(special._blush, v);
      else exprTarget[k] = Math.max(exprTarget[k] || 0, v);
    }
    if (!dt) { for (const k of Object.keys(exprCur)) exprCur[k] = exprTarget[k] || 0; }
    const em_ = vrm.expressionManager;
    for (const k of Object.keys(exprCur)) {
      const rate = VISEMES.includes(k) ? 22 : k === 'blink' ? 40 : 5;
      exprCur[k] = damp(exprCur[k], exprTarget[k] || 0, rate, dt || 0.016);
      em_?.setValue(k, exprCur[k]);
    }
    blush = damp(blush, special._blush, 3, dt || 0.016);
    for (const m of blushMeshes) { m.material.opacity = blush * 0.85; m.visible = blush > 0.02; }
  }

  // ---- pose ----
  const quats = {};
  function composePose(dt) {
    for (const k of Object.keys(P)) delete P[k];
    basePose(P);
    const add = (b, x, y, z) => { const p = P[b] || (P[b] = [0, 0, 0]); p[0] += x; p[1] += y; p[2] += z; };
    const r = reduced() ? 0.35 : 1;
    const slow = special._slow ? 0.7 : 1;

    // breathing
    const br = Math.sin(clock * 1.55 * slow);
    add('chest', -0.012 * br * r, 0, 0);
    add('upperChest', -0.01 * br * r, 0, 0);
    add('leftShoulder', 0, 0, 0.012 * br * r);
    add('rightShoulder', 0, 0, -0.012 * br * r);
    add('leftUpperArm', 0, 0, -0.012 * br * r);
    add('rightUpperArm', 0, 0, 0.012 * br * r);
    // weight shift + sway (hips roll, legs counter-rotate, spine counters)
    const w = weightShift * r;
    const sway = Math.sin(clock * 0.45) * 0.012 * r;
    add('hips', 0, w * 0.04, w * 0.035 + sway);
    add('leftUpperLeg', 0, 0, -w * 0.035 - sway);
    add('rightUpperLeg', 0, 0, -w * 0.035 - sway);
    add(w > 0 ? 'rightLowerLeg' : 'leftLowerLeg', Math.abs(w) * 0.09, 0, 0);
    add(w > 0 ? 'rightUpperLeg' : 'leftUpperLeg', -Math.abs(w) * 0.045, 0, 0);
    add('spine', 0, -w * 0.02, -w * 0.03 - sway * 0.6);
    add('neck', 0, 0, w * 0.015);
    add('head', Math.sin(clock * 0.7) * 0.008 * r, Math.sin(clock * 0.31) * 0.02 * r, Math.sin(clock * 0.53) * 0.015 * r);
    // excited bounce
    if (special._bounce > 0.01) add('spine', 0, 0, Math.sin(clock * 7) * 0.02 * special._bounce * r);
    // look-at head turn
    add('neck', headPitch * 0.35, headYaw * 0.35, 0);
    add('head', headPitch * 0.45 + special._headPitch, headYaw * 0.45, special._headPitch * 0.4);
    // talking beats
    const e = speech.energy;
    if (e > 0.01) {
      add('head', e * 0.035 * Math.sin(clock * 9.5), e * 0.02 * Math.sin(clock * 3.1), 0);
      add('upperChest', e * 0.01 * Math.sin(clock * 4.2), 0, 0);
    }

    // gestures: run, collect add/set/reach
    const sets = [];
    const reaches = [];
    let rootOff = [0, 0, 0];
    const finished = [];
    for (const g of active) {
      g.t += (dt || 0) * g.speed;
      const dur = g.def.duration;
      if (g.loop && !g.out && g.t > dur) g.t %= dur;
      let env = Math.min(1, smoothstep(0, g.def.fadeIn, g.t));
      const outStart = g.out || (g.loop ? Infinity : dur - g.def.fadeOut);
      const outLen = g.out ? 0.25 : g.def.fadeOut;
      if (g.t > outStart) env *= 1 - smoothstep(outStart, outStart + outLen, g.t);
      if ((g.out && g.t >= g.out + 0.25) || (!g.loop && !g.out && g.t >= dur)) { finished.push(g); continue; }
      env *= g.weight;
      const ctx = makeCtx(env, sets, reaches, rootOff, add);
      g.ctx = ctx;
      try { g.def.run(ctx, Math.min(g.t, dur), Math.min(1, g.t / dur)); } catch (err) { console.warn('[gesture]', g.name, err); finished.push(g); }
    }
    if (finished.length) {
      active = active.filter((g) => !finished.includes(g));
      for (const g of finished) g.resolve(true);
    }

    // write Euler pose
    for (const [b, v] of Object.entries(P)) {
      const n = bones[b];
      if (!n) continue;
      E.set(v[0], v[1], v[2], ORDER(b));
      n.quaternion.setFromEuler(E);
    }
    for (const s of sets) {
      const n = bones[s.b];
      if (!n) continue;
      E.set(s.x, s.y, s.z, ORDER(s.b));
      Q.setFromEuler(E);
      n.quaternion.slerp(Q, clamp(s.w, 0, 1));
    }
    if (reaches.length) {
      root.updateMatrixWorld(true);
      for (const rq of reaches) solveArm(rq);
    }
    // root offset (step back, hops)
    const ro = vrm.scene.position;
    ro.set(rootOff[0], rootOff[1], rootOff[2]);
    shadow.position.z = rootOff[2];
    shadow.material.opacity = 0.42 - Math.max(0, rootOff[1]) * 1.5;
  }

  function makeCtx(env, sets, reaches, rootOff, add) {
    return {
      env,
      exprs: {},
      add(b, x = 0, y = 0, z = 0) { add(b, x * env, y * env, z * env); },
      set(b, x = 0, y = 0, z = 0, w = 1) { sets.push({ b, x, y, z, w: w * env }); },
      expr(name, v) { this.exprs[name] = Math.max(this.exprs[name] || 0, v * env); },
      blush(v) { this.exprs._blush = Math.max(this.exprs._blush || 0, v * env); },
      root(x = 0, y = 0, z = 0) { rootOff[0] += x * env; rootOff[1] += y * env; rootOff[2] += z * env; },
      // Hand to a point (avatar space metres, origin at her feet, +z toward camera).
      reach(side, x, y, z, w = 1, pole) { reaches.push({ side, target: new THREE.Vector3(x, y, z), w: w * env, pole }); },
      // Rest position of a bone in avatar space, plus an offset.
      at(b, ox = 0, oy = 0, oz = 0) { const p = restPos[b] || new THREE.Vector3(); return [p.x + ox, p.y + oy, p.z + oz]; },
      // Piecewise smooth keyframes: key(t, [[t0, v0], [t1, v1], ...])
      key(t, frames) {
        if (t <= frames[0][0]) return frames[0][1];
        for (let i = 1; i < frames.length; i++) {
          if (t <= frames[i][0]) {
            const [t0, v0] = frames[i - 1], [t1, v1] = frames[i];
            return v0 + (v1 - v0) * smoothstep(t0, t1, t);
          }
        }
        return frames[frames.length - 1][1];
      },
    };
  }

  // Two-bone IK for one arm. Target is in avatar space.
  const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3();
  const _m = new THREE.Matrix4(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _ql = new THREE.Quaternion();
  function solveArm({ side, target, w, pole }) {
    const up = bones[side + 'UpperArm'], lo = bones[side + 'LowerArm'];
    if (!up || !lo || w <= 0.001) return;
    const sgn = side === 'left' ? 1 : -1;
    const [L1, L2] = armLen[side];
    up.parent.updateWorldMatrix(true, false);
    up.getWorldPosition(_S);
    _T.copy(target);
    root.localToWorld(_T);
    const toT = _v.subVectors(_T, _S);
    let a = toT.length();
    a = clamp(a, Math.abs(L1 - L2) + 0.01, (L1 + L2) * 0.995);
    _u.copy(toT).normalize();
    // pole: elbows out, down and back by default (avatar space -> world)
    const pl = new THREE.Vector3(...(pole || [sgn * 0.6, -0.5, -0.5])).transformDirection(root.matrixWorld);
    const perp = pl.sub(_u.clone().multiplyScalar(pl.dot(_u)));
    if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
    perp.normalize();
    const cosA = clamp((L1 * L1 + a * a - L2 * L2) / (2 * L1 * a), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _E.copy(_S).addScaledVector(_u, L1 * cosA).addScaledVector(perp, L1 * sinA);
    const T2 = _S.clone().addScaledVector(_u, a);
    const d1 = _E.clone().sub(_S).normalize();
    const d2 = T2.clone().sub(_E).normalize();
    let n = new THREE.Vector3().crossVectors(d1, d2);
    if (n.lengthSq() < 1e-8) n.set(0, sgn > 0 ? -1 : 1, 0).transformDirection(root.matrixWorld); else n.normalize();
    // local axes: left arm X->d1, Y->-n ; right arm X->-d1, Y->n
    const X1 = d1.clone().multiplyScalar(sgn), Y = n.clone().multiplyScalar(-sgn);
    const Z1 = new THREE.Vector3().crossVectors(X1, Y);
    _m.makeBasis(X1, Y, Z1);
    _qw.setFromRotationMatrix(_m);
    up.parent.getWorldQuaternion(_qp);
    _ql.copy(_qp).invert().multiply(_qw);
    up.quaternion.slerp(_ql, clamp(w, 0, 1));
    const X2 = d2.clone().multiplyScalar(sgn);
    const Z2 = new THREE.Vector3().crossVectors(X2, Y);
    _m.makeBasis(X2, Y, Z2);
    const qf = new THREE.Quaternion().setFromRotationMatrix(_m);
    const qUpW = _qp.clone().multiply(up.quaternion);
    const qfl = qUpW.invert().multiply(qf);
    lo.quaternion.slerp(qfl, clamp(w, 0, 1));
  }

  // ---- blush decals on the cheeks ----
  function buildBlush() {
    const face = [];
    vrm.scene.traverse((o) => { if (o.isMesh && (Array.isArray(o.material) ? o.material : [o.material]).some((m) => /Face_00_SKIN|FACE|SKIN/i.test(m.name || ''))) face.push(o); });
    const headRaw = vrm.humanoid.getRawBoneNode('head');
    if (!headRaw || !face.length) return;
    vrm.scene.updateMatrixWorld(true);
    const headW = headRaw.getWorldPosition(new THREE.Vector3());
    const eyeY = bones.leftEye ? bones.leftEye.getWorldPosition(new THREE.Vector3()).y : headW.y + 0.06;
    const c = document.createElement('canvas'); c.width = 128; c.height = 80;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 40, 4, 64, 40, 60);
    gr.addColorStop(0, 'rgba(255,110,130,0.75)'); gr.addColorStop(1, 'rgba(255,110,130,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(64, 40, 62, 38, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(235,80,100,0.55)'; g.lineWidth = 4; g.lineCap = 'round';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(40 + i * 18, 52); g.lineTo(54 + i * 18, 28); g.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const rc = new THREE.Raycaster();
    for (const sx of [1, -1]) {
      const origin = new THREE.Vector3(headW.x + sx * 0.036, eyeY - 0.03, headW.z + 0.5);
      rc.set(origin, new THREE.Vector3(0, 0, -1));
      const hit = rc.intersectObjects(face, false)[0];
      if (!hit) continue;
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 0, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.025), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4 }));
      m.userData.noHit = true;
      m.renderOrder = 5;
      const pos = hit.point.clone().addScaledVector(n, 0.003);
      m.position.copy(pos);
      m.lookAt(pos.clone().add(n));
      headRaw.attach(m);
      m.visible = false;
      blushMeshes.push(m);
    }
  }

  function makeShadow() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(10,8,20,0.9)'); gr.addColorStop(0.5, 'rgba(10,8,20,0.45)'); gr.addColorStop(1, 'rgba(10,8,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.55), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.42 }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.006;
    m.renderOrder = 1;
    m.userData.noHit = true;
    return m;
  }

  registerCoreGestures(avatar);
  return avatar;
}

// Text -> viseme timeline. Words carry their char index so speech boundary
// events can resync the playhead.
export function buildTimeline(text, rate = 1) {
  const cps = 13.5 * rate;
  const unit = 1 / cps;
  const segs = [{ t: 0, d: 0, v: null, w: 0 }];
  const words = [];
  const VOW = { a: 'aa', e: 'ee', i: 'ih', o: 'oh', u: 'ou', y: 'ih', w: 'ou' };
  let t = 0;
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    const word = m[0];
    words.push({ i: m.index, len: word.length, t });
    let prevVowel = false;
    for (const ch of word.toLowerCase()) {
      if (VOW[ch] && !(ch === 'y' && !prevVowel && word.length > 1 && ch === word[0])) {
        if (!prevVowel) { const d = unit * 1.5; segs.push({ t, d, v: VOW[ch], w: ch === 'a' || ch === 'o' ? 0.85 : 0.65 }); t += d; }
        else t += unit * 0.5;
        prevVowel = true;
      } else if ('mbp'.includes(ch)) { segs.push({ t, d: unit * 0.8, v: null, w: 0 }); t += unit * 0.8; prevVowel = false; }
      else if (/[a-z0-9]/.test(ch)) { t += unit * 0.6; prevVowel = false; }
      else if (/[,;:]/.test(ch)) { segs.push({ t, d: 0.16, v: null, w: 0 }); t += 0.16; }
      else if (/[.!?…]/.test(ch)) { segs.push({ t, d: 0.28, v: null, w: 0 }); t += 0.28; }
    }
    t += unit * 0.6;
  }
  segs.push({ t, d: 0.1, v: null, w: 0 });
  return { segs, words, duration: t };
}

function registerCoreGestures(avatar) {
  const G = (name, def) => avatar.registerGesture(name, def);

  G('wave', {
    duration: 2.4, hint: 'friendly wave hello or bye',
    run(g, t) {
      const [hx, hy, hz] = g.at('head', -0.25, -0.03, 0.12);
      g.reach('right', hx + Math.sin(t * 9) * 0.035, hy, hz, 1, [-0.5, -1, 0.05]);
      g.set('rightHand', -1.3, 0.0, Math.sin(t * 9) * 0.3, 1);
      g.add('head', 0, 0, 0.08);
      g.add('spine', 0, 0, 0.03);
      g.expr('happy', 0.7);
    },
  });

  G('nod', {
    duration: 1.3, fadeIn: 0.1, fadeOut: 0.25, hint: 'nod yes / agree',
    run(g, t) {
      const k = Math.sin(t * 9.5) * Math.max(0, 1 - t / 1.3);
      g.add('head', 0.16 * Math.max(0, k) + 0.04, 0, 0);
      g.add('neck', 0.06 * Math.max(0, k), 0, 0);
    },
  });

  G('shake', {
    duration: 1.4, fadeIn: 0.1, fadeOut: 0.3, hint: 'shake head no',
    run(g, t) {
      const k = Math.sin(t * 11) * Math.max(0, 1 - t / 1.4);
      g.add('head', 0.03, 0.22 * k, 0);
      g.add('neck', 0, 0.08 * k, 0);
    },
  });

  G('giggle', {
    duration: 2.0, hint: 'giggle at something funny',
    run(g, t) {
      const [mx, my, mz] = g.at('head', -0.04, -0.1, 0.1);
      g.reach('right', mx, my, mz, 0.95, [-0.4, -0.8, -0.2]);
      g.set('rightHand', -0.6, 0.2, -0.3, 0.8);
      const bob = Math.abs(Math.sin(t * 13));
      g.add('upperChest', 0.03 * bob, 0, 0);
      g.add('leftShoulder', 0, 0, 0.05 * bob);
      g.add('rightShoulder', 0, 0, -0.05 * bob);
      g.add('head', 0.06, 0, -0.12);
      g.expr('happy', 1);
    },
  });

  G('think', {
    duration: 3.2, hint: 'think it over, hand on chin',
    run(g, t) {
      const [cx, cy, cz] = g.at('head', -0.02, -0.15, 0.09);
      g.reach('right', cx, cy, cz, 1, [-0.3, -1, 0.1]);
      g.set('rightHand', -0.4, 0.25, -0.5, 0.8);
      const [ex, ey, ez] = g.at('rightLowerArm', 0.2, 0.0, 0.1);
      g.reach('left', ex + 0.12, ey - 0.12, ez + 0.08, 0.9, [0.8, -0.4, -0.2]);
      g.add('head', -0.1, 0.18, 0.14);
      g.add('neck', -0.04, 0.06, 0);
      g.expr('relaxed', 0.3);
    },
  });

  // Personal space: steps back, hands up.
  G('stepBack', {
    duration: 2.6, fadeIn: 0.15, fadeOut: 0.9,
    run(g, t) {
      g.root(0, 0, -0.22 * g.key(t, [[0, 0], [0.35, 1]]));
      g.add('spine', -0.08, 0, 0);
      g.add('head', -0.06, 0, 0.05);
      const [lx, ly, lz] = g.at('leftShoulder', 0.1, -0.1, 0.25);
      const [rx, ry, rz] = g.at('rightShoulder', -0.1, -0.1, 0.25);
      g.reach('left', lx, ly, lz, 0.85);
      g.reach('right', rx, ry, rz, 0.85);
      g.set('leftHand', 0, 0, 1.2, 0.8);
      g.set('rightHand', 0, 0, -1.2, 0.8);
      g.expr('surprised', t < 0.8 ? 0.8 : 0.2);
      g.expr('angry', t < 0.8 ? 0 : 0.45);
    },
  });

  // Head pat: lean in, eyes closed.
  G('pat', {
    duration: 2.4,
    run(g) {
      g.add('head', 0.12, 0, 0.1);
      g.add('neck', 0.05, 0, 0);
      g.add('leftShoulder', 0, 0, 0.06);
      g.add('rightShoulder', 0, 0, -0.06);
      g.expr('happy', 0.85);
      g.expr('blink', 0.0);
      g.blush(0.6);
    },
  });

  // Cheek poke: flinch toward the poke, puff.
  G('poke', {
    duration: 1.8, fadeIn: 0.08,
    run(g, t) {
      g.add('head', 0.02, 0, g.key(t, [[0, 0], [0.12, 0.16], [1.0, 0.1]]));
      g.expr('surprised', t < 0.4 ? 0.7 : 0);
      g.expr('angry', t >= 0.4 ? 0.35 : 0);
      g.blush(0.5);
    },
  });

  // Hand hold: offers her hand forward, looks at it shyly.
  G('handhold', {
    duration: 3.2,
    run(g) {
      const [x, y, z] = g.at('leftShoulder', 0.12, -0.38, 0.32);
      g.reach('left', x, y, z, 0.9, [0.6, -0.8, -0.2]);
      g.set('leftHand', 0.6, 0, 0.1, 0.6);
      g.add('head', 0.22, -0.18, 0.06);
      g.expr('happy', 0.45);
      g.blush(0.9);
    },
  });

  // Shoulder tap: turns toward you.
  G('tapped', {
    duration: 1.8, fadeIn: 0.12,
    run(g, t) {
      g.add('spine', 0, g.key(t, [[0, 0], [0.25, 0.12], [1.8, 0.04]]), 0);
      g.add('head', -0.03, g.key(t, [[0, 0], [0.2, 0.25], [1.8, 0.08]]), 0.08);
      g.expr('surprised', t < 0.5 ? 0.6 : 0);
      g.expr('happy', t >= 0.5 ? 0.6 : 0);
    },
  });

  G('bounce', {
    duration: 1.4, hint: 'small excited hop',
    run(g, t) {
      const h = Math.max(0, Math.sin(t * 9));
      g.root(0, h * 0.035, 0);
      g.add('leftUpperArm', 0, 0, 0.25 * h);
      g.add('rightUpperArm', 0, 0, -0.25 * h);
      g.expr('happy', 1);
    },
  });

  G('shy', {
    duration: 3.0, hint: 'flustered, looks away',
    run(g) {
      const [x, y, z] = g.at('hips', 0, 0.02, 0.16);
      g.reach('left', x + 0.02, y, z, 0.8, [0.7, -0.3, -0.4]);
      g.reach('right', x - 0.02, y, z, 0.8, [-0.7, -0.3, -0.4]);
      g.add('head', 0.18, 0.22, 0.1);
      g.expr('happy', 0.35);
      g.blush(1);
    },
  });

  G('shrug', {
    duration: 1.8, hint: 'shrug, who knows',
    run(g) {
      g.add('leftShoulder', 0, 0, 0.18);
      g.add('rightShoulder', 0, 0, -0.18);
      g.add('leftLowerArm', 0, -1.0, 0);
      g.add('rightLowerArm', 0, 1.0, 0);
      g.add('leftUpperArm', 0, 0, 0.2);
      g.add('rightUpperArm', 0, 0, -0.2);
      g.add('head', 0, 0, 0.12);
    },
  });

  G('yawn', {
    duration: 3.0, hint: 'sleepy yawn',
    run(g, t) {
      const [mx, my, mz] = g.at('head', -0.03, -0.085, 0.11);
      g.reach('right', mx, my, mz, 0.9, [-0.4, -0.8, -0.2]);
      g.set('rightHand', -0.9, 0, 0.3, 0.7);
      g.add('head', -0.15, 0, 0);
      g.expr('aa', g.key(t, [[0, 0], [0.6, 0.9], [2.0, 0.9], [2.6, 0]]));
      g.expr('blink', 0.8);
    },
  });

  // Idle fidgets
  G('lookAround', {
    duration: 3.6,
    run(g, t) {
      const yaw = g.key(t, [[0, 0], [0.6, 0.5], [1.8, 0.5], [2.4, -0.2], [3.0, -0.2], [3.6, 0]]);
      g.add('neck', 0, yaw * 0.4, 0);
      g.add('head', -0.03, yaw * 0.5, 0);
      g.add('spine', 0, yaw * 0.15, 0);
    },
  });
  G('tilt', {
    duration: 2.6,
    run(g) { g.add('head', 0.02, 0, 0.16); g.add('neck', 0, 0, 0.05); g.expr('happy', 0.35); },
  });
  avatar.registerIdle('lookAround', 2);
  avatar.registerIdle('tilt', 1);
}
