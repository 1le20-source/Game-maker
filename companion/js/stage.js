// Renderer, camera rig, scene registry and pointer routing.
//
// Camera framing is one continuous value: 0 = full body, 1 = upper body,
// 2 = face. Presets set it; pinch and wheel move it smoothly in between.
// Insets (CSS px covered by UI) shift the projection so she stays centred in
// the visible part of the screen.

import * as THREE from 'three';
import { clamp, damp, lerp, prefersReducedMotion } from './util.js';

export const PRESETS = { full: 0, upper: 1, face: 2 };
// Framing keyframes: [target height above floor (m), visible height (m), min width (m)]
const FRAMES = [
  [0.84, 1.95, 0.9],
  [1.23, 0.88, 0.52],
  [1.43, 0.42, 0.34],
];

const sharedGradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([110, 175, 225, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

// Cel-shaded material used for props so they sit with the anime character.
export function toonMaterial(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: sharedGradient, ...opts });
}

// Canvas-drawn texture. draw(ctx, w, h) paints it.
export function canvasTexture(w, h, draw, { repeat, srgb = true, filter = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  if (!filter) { t.magFilter = THREE.NearestFilter; }
  t.anisotropy = 4;
  return t;
}

export function createStage(app, canvas) {
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__MIRA_TEST__ });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const maxDPR = Math.min(window.devicePixelRatio || 1, isTouch ? 1.75 : 2);
  let dpr = maxDPR;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0d1020');
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 80);

  const locationRoot = new THREE.Group();
  locationRoot.name = 'location';
  const avatarRoot = new THREE.Group();
  avatarRoot.name = 'avatarRoot';
  scene.add(locationRoot, avatarRoot);

  const scenes = new Map(); // id -> {builder, meta}
  let current = null; // {id, built}
  const focus = new THREE.Vector3(); // floor point the camera frames (avatar spawn)

  const rig = {
    framing: 1, framingGoal: 1,
    az: 0, azGoal: 0,
    el: 0.04, elGoal: 0.04,
    target: new THREE.Vector3(0, 1.2, 0),
    dist: 3,
  };
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  let width = 1, height = 1;
  const reduced = () => prefersReducedMotion() || app.state.settings?.reduceMotion;

  function resize() {
    width = canvas.clientWidth || innerWidth;
    height = canvas.clientHeight || innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    applyViewOffset();
    camera.updateProjectionMatrix();
  }

  function applyViewOffset() {
    const ox = (insets.right - insets.left) / 2;
    const oy = (insets.bottom - insets.top) / 2;
    if (Math.abs(ox) < 0.5 && Math.abs(oy) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(width, height, ox, oy, width, height);
  }

  function frameAt(f) {
    const i = clamp(Math.floor(f), 0, FRAMES.length - 2);
    const t = clamp(f - i, -0.25, 1.25);
    const a = FRAMES[i], b = FRAMES[i + 1];
    return [lerp(a[0], b[0], t), Math.exp(lerp(Math.log(a[1]), Math.log(b[1]), t)), lerp(a[2], b[2], t)];
  }

  function updateCamera(dt) {
    const k = reduced() ? 40 : 6;
    rig.framing = damp(rig.framing, rig.framingGoal, k, dt);
    rig.az = damp(rig.az, rig.azGoal, k, dt);
    rig.el = damp(rig.el, rig.elGoal, k, dt);
    const [ty, visH, minW] = frameAt(rig.framing);
    const freeH = Math.max(120, height - insets.top - insets.bottom);
    const freeW = Math.max(120, width - insets.left - insets.right);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dH = visH / (2 * tanV * (freeH / height));
    const dW = minW / (2 * tanV * camera.aspect * (freeW / width));
    const d = Math.max(dH, dW);
    rig.dist = damp(rig.dist, d, reduced() ? 40 : 8, dt);
    rig.target.set(focus.x, focus.y + ty, focus.z);
    const ce = Math.cos(rig.el);
    camera.position.set(
      rig.target.x + Math.sin(rig.az) * ce * rig.dist,
      rig.target.y + Math.sin(rig.el) * rig.dist,
      rig.target.z + Math.cos(rig.az) * ce * rig.dist,
    );
    camera.lookAt(rig.target);
  }

  // Adaptive resolution: drop pixel ratio when frames are slow.
  let slowTime = 0, fastTime = 0;
  function adapt(dt) {
    if (window.__MIRA_TEST__) return;
    if (dt > 1 / 38) { slowTime += dt; fastTime = 0; } else { fastTime += dt; slowTime = Math.max(0, slowTime - dt * 0.5); }
    if (slowTime > 2.5 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); slowTime = 0; resize(); }
    if (fastTime > 12 && dpr < maxDPR) { dpr = Math.min(maxDPR, dpr + 0.25); fastTime = 0; resize(); }
  }

  const fadeEl = document.getElementById('fade');

  const stage = {
    THREE, renderer, scene, camera, locationRoot, avatarRoot, focus,
    toonMaterial, canvasTexture,
    get current() { return current?.id || null; },
    get framing() { return rig.framing; },
    get azimuth() { return rig.az; },

    registerScene(id, builder, meta = {}) {
      scenes.set(id, { builder, meta: { id, name: meta.name || id, desc: meta.desc || '', minLevel: meta.minLevel || 0, ...meta } });
    },
    listScenes() { return [...scenes.values()].map((s) => s.meta); },
    sceneMeta(id) { return scenes.get(id)?.meta || null; },

    async setScene(id, { instant = false } = {}) {
      const entry = scenes.get(id);
      if (!entry) { console.warn('[stage] unknown scene', id); return false; }
      const prev = current?.id || null;
      const doFade = !instant && fadeEl && !reduced();
      if (doFade) { fadeEl.classList.add('on'); await new Promise((r) => setTimeout(r, 380)); }
      if (current) {
        try { current.built.dispose?.(); } catch (e) { console.warn(e); }
        locationRoot.remove(current.built.group);
        disposeTree(current.built.group);
      }
      let built;
      try {
        built = await entry.builder({ THREE, app, stage, toonMaterial, canvasTexture });
      } catch (e) {
        console.error('[stage] scene build failed', id, e);
        if (doFade) fadeEl.classList.remove('on');
        return false;
      }
      current = { id, built };
      locationRoot.add(built.group);
      scene.background = new THREE.Color(built.background || '#0d1020');
      scene.fog = built.fog || null;
      const sp = built.spawn || {};
      focus.set(sp.x || 0, sp.y || 0, sp.z || 0);
      avatarRoot.position.copy(focus);
      avatarRoot.rotation.y = sp.rotY || 0;
      rig.azGoal = rig.az = (built.camera?.azimuth ?? 0) + (sp.rotY || 0);
      app.avatar?.resetPhysics?.();
      app.state.location = id;
      app.save?.dirty();
      if (prev !== id) app.bus.emit('location', { id, prev });
      if (doFade) { await new Promise((r) => setTimeout(r, 60)); fadeEl.classList.remove('on'); }
      return true;
    },

    cameraPreset(name) {
      if (name in PRESETS) rig.framingGoal = PRESETS[name];
      rig.azGoal = (current?.built?.camera?.azimuth ?? 0) + avatarRoot.rotation.y;
      rig.elGoal = 0.04;
      app.bus.emit('camera', { preset: name });
    },
    // Nearest preset name for the current framing.
    presetName() {
      const f = rig.framingGoal;
      return f < 0.5 ? 'full' : f < 1.5 ? 'upper' : 'face';
    },
    zoomBy(delta) { rig.framingGoal = clamp(rig.framingGoal + delta, -0.2, 2.2); },
    orbitBy(dx, dy) {
      const base = (current?.built?.camera?.azimuth ?? 0) + avatarRoot.rotation.y;
      rig.azGoal = clamp(rig.azGoal - dx * 0.006, base - 0.85, base + 0.85);
      rig.elGoal = clamp(rig.elGoal + dy * 0.004, -0.12, 0.42);
    },
    setInsets(next) {
      Object.assign(insets, next);
      applyViewOffset();
      camera.updateProjectionMatrix();
    },
    getInsets() { return { ...insets }; },

    // World point under a screen position at the depth of `atPoint`.
    screenToWorld(clientX, clientY, atPoint) {
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, camera);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), atPoint);
      const out = new THREE.Vector3();
      return rc.ray.intersectPlane(plane, out) ? out : atPoint.clone();
    },
    raycast(clientX, clientY, objects, recursive = true) {
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, camera);
      return rc.intersectObjects(objects, recursive);
    },
    // Screen position (client px) of a world point.
    toScreen(v) {
      const p = v.clone().project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height, visible: p.z < 1 };
    },

    update(dt, t) {
      adapt(dt);
      updateCamera(dt);
      try { current?.built?.update?.(dt, t); } catch (e) { console.warn('[stage] scene update', e); }
    },
    render() { renderer.render(scene, camera); },
    resize,
  };

  // ---- pointer routing -------------------------------------------------
  // Emits on app.bus:
  //   'pointer:down' {x, y, id, claim()}  call claim() to own this gesture (no orbit)
  //   'pointer:move' {x, y, dx, dy, claimed}
  //   'pointer:up'   {x, y, claimed, dragged}
  //   'tap'          {x, y}  short press without drag
  const pointers = new Map();
  let gesture = null; // {id, x0, y0, t0, dragged, claimed, lastX, lastY}
  let pinch = null;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), f0: rig.framingGoal };
      gesture = null;
      return;
    }
    if (pointers.size > 2) return;
    gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, t0: performance.now(), dragged: false, claimed: false };
    const g = gesture;
    app.bus.emit('pointer:down', { x: e.clientX, y: e.clientY, id: e.pointerId, claim: () => { g.claimed = true; } });
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      rig.framingGoal = clamp(pinch.f0 + Math.log(d / Math.max(20, pinch.d0)) * 1.6, -0.2, 2.2);
      return;
    }
    if (!gesture || gesture.id !== e.pointerId) {
      if (e.pointerType === 'mouse') app.bus.emit('pointer:hover', { x: e.clientX, y: e.clientY });
      return;
    }
    const dx = e.clientX - gesture.lastX, dy = e.clientY - gesture.lastY;
    gesture.lastX = e.clientX; gesture.lastY = e.clientY;
    if (!gesture.dragged && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > 7) gesture.dragged = true;
    if (gesture.dragged && !gesture.claimed) stage.orbitBy(dx, dy);
    app.bus.emit('pointer:move', { x: e.clientX, y: e.clientY, dx, dy, claimed: gesture.claimed });
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!gesture || gesture.id !== e.pointerId) return;
    const g = gesture;
    gesture = null;
    app.bus.emit('pointer:up', { x: e.clientX, y: e.clientY, claimed: g.claimed, dragged: g.dragged });
    if (!g.dragged && e.type === 'pointerup' && performance.now() - g.t0 < 450) app.bus.emit('tap', { x: e.clientX, y: e.clientY });
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    stage.zoomBy(-e.deltaY * 0.0016);
  }, { passive: false });
  canvas.addEventListener('dblclick', () => stage.cameraPreset(stage.presetName()));

  addEventListener('resize', resize);
  resize();
  return stage;
}

export function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && v.isTexture && v !== sharedGradient) v.dispose();
      m.dispose();
    }
  });
}
