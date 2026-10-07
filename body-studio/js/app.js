// Body Studio app shell: renderer, camera with 360° orbit, render loop and the
// module system that skin, motion, hair, clothing and anatomy plug into.
//
// A module file registers itself with BS.registerModule({ name, order, create(app) }).
// create() returns an object with any of:
//   onParams(params)   after every body/appearance change (human already re-shaped)
//   update(dt, t)      every frame, in ascending `order` (motion 0, hair 10,
//                      clothing 15, anatomy 20, skin 30); app.human.applyPose()
//                      runs right after the motion module
//   dispose()
// The instance is stored at app.modules[name].
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const THREE = window.THREE;
  BS.moduleDefs = BS.moduleDefs || [];
  BS.registerModule = (def) => BS.moduleDefs.push(def);

  class OrbitRig {
    // spherical orbit around a target: drag to spin a full 360°, wheel/pinch
    // to zoom, right-drag or two fingers to pan, with gentle damping
    constructor(camera, dom) {
      this.camera = camera;
      this.dom = dom;
      this.target = new THREE.Vector3(0, 1, 0);
      this.yaw = 0; this.pitch = 0.05; this.dist = 3.6;
      this.goal = { yaw: 0, pitch: 0.05, dist: 3.6, target: this.target.clone() };
      this.autoRotate = false;
      this.autoSpeed = 0.35;
      this.enabled = true;
      this.minDist = 0.25; this.maxDist = 9;
      const ptrs = new Map();
      let lastPinch = 0, mode = null, last = null;
      const rect = () => dom.getBoundingClientRect();
      dom.addEventListener('pointerdown', (e) => {
        if (!this.enabled) return;
        dom.setPointerCapture(e.pointerId);
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        mode = e.button === 2 || e.shiftKey ? 'pan' : 'rotate';
        last = { x: e.clientX, y: e.clientY };
        if (ptrs.size === 2) { mode = 'pinch'; lastPinch = this._pinch(ptrs); }
        this.userActive = true;
      });
      dom.addEventListener('pointermove', (e) => {
        if (!ptrs.has(e.pointerId)) return;
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const h = rect().height || 1;
        if (mode === 'pinch' && ptrs.size >= 2) {
          const d = this._pinch(ptrs);
          if (lastPinch) this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * (lastPinch / d), this.minDist, this.maxDist);
          lastPinch = d;
          const c = this._center(ptrs);
          if (last) this._pan((c.x - last.x) / h, (c.y - last.y) / h);
          last = c;
          return;
        }
        const dx = (e.clientX - last.x) / h, dy = (e.clientY - last.y) / h;
        last = { x: e.clientX, y: e.clientY };
        if (mode === 'pan') this._pan(dx, dy);
        else { this.goal.yaw -= dx * 4.2; this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dy * 3, -1.35, 1.35); }
      });
      const up = (e) => {
        ptrs.delete(e.pointerId);
        if (ptrs.size < 2) lastPinch = 0;
        if (ptrs.size === 1) { const p = [...ptrs.values()][0]; last = { x: p.x, y: p.y }; mode = 'rotate'; }
        if (!ptrs.size) { mode = null; this.userActive = false; }
      };
      dom.addEventListener('pointerup', up);
      dom.addEventListener('pointercancel', up);
      dom.addEventListener('contextmenu', (e) => e.preventDefault());
      dom.addEventListener('wheel', (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * Math.exp(e.deltaY * 0.0012), this.minDist, this.maxDist);
      }, { passive: false });
    }
    _pinch(p) { const [a, b] = [...p.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }
    _center(p) { const [a, b] = [...p.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    _pan(dx, dy) {
      const s = this.goal.dist * 0.9;
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.goal.target.addScaledVector(right, -dx * s);
      this.goal.target.y = THREE.MathUtils.clamp(this.goal.target.y + dy * s, 0.05, 2.3);
    }
    // move the view to a framing; instant=true skips the glide
    frame(target, dist, yaw, pitch, instant) {
      this.goal.target.copy(target);
      this.goal.dist = dist;
      if (yaw !== undefined) {
        // take the short way round so a preset never spins the long way
        let d = (yaw - this.goal.yaw) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        this.goal.yaw += d;
      }
      if (pitch !== undefined) this.goal.pitch = pitch;
      if (instant) this.snap();
    }
    snap() { this.yaw = this.goal.yaw; this.pitch = this.goal.pitch; this.dist = this.goal.dist; this.target.copy(this.goal.target); this.apply(); }
    update(dt) {
      if (this.autoRotate && !this.userActive) this.goal.yaw += this.autoSpeed * dt;
      const k = 1 - Math.exp(-dt * 9);
      this.yaw += (this.goal.yaw - this.yaw) * k;
      this.pitch += (this.goal.pitch - this.pitch) * k;
      this.dist += (this.goal.dist - this.dist) * k;
      this.target.lerp(this.goal.target, k);
      this.apply();
    }
    apply() {
      const c = Math.cos(this.pitch);
      this.camera.position.set(
        this.target.x + Math.sin(this.yaw) * c * this.dist,
        this.target.y + Math.sin(this.pitch) * this.dist,
        this.target.z + Math.cos(this.yaw) * c * this.dist);
      this.camera.lookAt(this.target);
    }
  }
  BS.OrbitRig = OrbitRig;

  class App {
    constructor(container, opts = {}) {
      this.container = container;
      this.opts = opts;
      this.modules = {};
      this.moduleList = [];
      this.time = 0;
      this.paused = false;
      this.listeners = { params: [], frame: [] };
    }

    async init(params) {
      const q = this.query = new URLSearchParams(location.search);
      this.quality = q.get('quality') || this.opts.quality || (/(Android|iPhone|iPad|Mobile)/i.test(navigator.userAgent) ? 'medium' : 'high');
      const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.localClippingEnabled = true;
      this.container.appendChild(renderer.domElement);
      renderer.domElement.className = 'bs-canvas';

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(28, 1, 0.03, 60);
      this.orbit = new OrbitRig(this.camera, renderer.domElement);

      this.D = await BS.loadData();
      this.human = new BS.Human(this.D);
      this.scene.add(this.human.group);
      if (BS.buildStage) this.stage = BS.buildStage(this);

      // ?only=hair,skin starts just those modules (handy when testing one)
      const only = q.get('only') ? q.get('only').split(',') : null;
      for (const def of BS.moduleDefs.slice().sort((a, b) => (a.order || 0) - (b.order || 0))) {
        if (only && !only.includes(def.name)) continue;
        try {
          const inst = def.create(this);
          inst._order = def.order || 0;
          this.modules[def.name] = inst;
          this.moduleList.push(inst);
        } catch (e) {
          console.error('module ' + def.name + ' failed to start', e);
        }
      }

      this.params = Object.assign(BS.defaultParams(), params || {});
      if (q.get('preset') && BS.PRESETS[q.get('preset')]) this.params = JSON.parse(JSON.stringify(BS.PRESETS[q.get('preset')]));
      if (q.get('p')) Object.assign(this.params, JSON.parse(q.get('p')));
      this.setParams(this.params);
      this.focus(q.get('cam') || 'body', true);

      window.addEventListener('resize', () => this.resize());
      this.resize();
      this.clock = new THREE.Clock();
      if (q.get('t') !== null) this._devStep(parseFloat(q.get('t')) || 0, parseInt(q.get('frames') || '1', 10));
      else this._loop();
      return this;
    }

    // re-shape the body and push appearance to every module
    setParams(p) {
      this.params = p;
      this.human.setParams(p);
      for (const m of this.moduleList) if (m.onParams) {
        try { m.onParams(p); } catch (e) { console.error(e); }
      }
      for (const fn of this.listeners.params) fn(p);
    }
    on(evt, fn) { (this.listeners[evt] || (this.listeners[evt] = [])).push(fn); }

    resize() {
      const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.renderer.domElement.style.width = w + 'px';
      this.renderer.domElement.style.height = h + 'px';
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    // camera presets, all relative to the current body so they fit any height
    focus(name, instant) {
      const h = this.human;
      const eyeY = (h.joint('eye.L', 'head').y + h.joint('eye.R', 'head').y) / 2, top = h.joint('head', 'tail').y;
      const height = top + 0.04;
      const narrow = this.camera.aspect < 0.8 ? 1.35 : 1;
      const root = new THREE.Vector3(h.rootOffset.x, 0, h.rootOffset.z);
      const T = (y) => new THREE.Vector3(root.x, y, root.z);
      const presets = {
        body: [T(height * 0.52), height * 2.15 * narrow, 0, 0.04],
        front: [T(height * 0.52), height * 2.15 * narrow, 0, 0.04],
        back: [T(height * 0.52), height * 2.15 * narrow, Math.PI, 0.04],
        side: [T(height * 0.52), height * 2.15 * narrow, Math.PI / 2, 0.04],
        upper: [T(height * 0.75), height * 1.05 * narrow, 0.25, 0.04],
        face: [T(eyeY - 0.03), 0.62 * narrow, 0.18, 0.02],
        faceFront: [T(eyeY - 0.03), 0.55 * narrow, 0, 0.0],
        faceSide: [T(eyeY - 0.03), 0.6 * narrow, Math.PI / 2, 0.0],
        torso: [T(height * 0.62), height * 0.95 * narrow, 0.3, 0.05],
        legs: [T(height * 0.28), height * 1.25 * narrow, 0.35, 0.0],
        hands: [T(height * 0.48), height * 0.9 * narrow, 0.7, 0.1],
        feet: [T(0.12), 0.9 * narrow, 0.5, 0.35],
      };
      const p = presets[name] || presets.body;
      this.orbit.frame(p[0], p[1], p[2], p[3], instant);
      this.view = name;
    }

    tick(dt) {
      this.time += dt;
      const t = this.time;
      let posed = false;
      for (const m of this.moduleList) {
        if (!posed && m._order > 0) { this.human.applyPose(); posed = true; }
        if (m.update) {
          try { m.update(dt, t); } catch (e) { if (!m._warned) { console.error(e); m._warned = true; } }
        }
      }
      if (!posed) this.human.applyPose();
      for (const fn of this.listeners.frame) fn(dt, t);
    }

    render() {
      this.renderer.render(this.scene, this.camera);
    }

    _loop() {
      const step = () => {
        this._raf = requestAnimationFrame(step);
        const dt = Math.min(0.05, this.clock.getDelta());
        if (!this.paused) this.tick(dt);
        this.orbit.update(dt);
        this.render();
      };
      step();
    }

    // deterministic stepping for screenshots: ?t=seconds&frames=n
    _devStep(seconds, frames) {
      const dt = 1 / 60;
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) this.tick(dt);
      this.tick(dt);
      this.orbit.update(1);
      this.orbit.snap();
      for (let i = 0; i < Math.max(1, frames); i++) this.render();
      window.done = true;
    }

    screenshot() { this.render(); return this.renderer.domElement.toDataURL('image/png'); }
  }
  BS.App = App;
})();
