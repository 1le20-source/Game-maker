// Boot, app object, render loop. See CONTRACT.md for the API modules use.

import * as THREE from 'three';
import { createBus, now, todayKey, timeOfDay, prefersReducedMotion } from './util.js';
import { createSave, defaultState } from './save.js';
import { createStage } from './stage.js';
import { registerRoom } from './room.js';
import { createAvatar } from './avatar.js';
import { createVoice } from './voice.js';
import { createAudio } from './audio.js';
import { createProgress } from './progress.js';
import { createBrain } from './brain.js';
import { createUI } from './ui.js';
import { initPanels } from './panels.js';
import { initTouch } from './touch.js';
import { modules } from './modules.js';

const app = {
  version: 1,
  THREE,
  bus: createBus(),
  state: defaultState(),
  // Not saved. pending: question she asked (offline mind), daysAway, restingEmotion,
  // outfitDesc (wardrobe sets this for the prompt), online.
  runtime: { pending: null, daysAway: 0, restingEmotion: 'neutral', outfitDesc: '', tod: timeOfDay() },
  ready: false,
  modules: {},
};
window.__mira = app;

async function boot() {
  const canvas = document.getElementById('scene');
  app.ui = createUI(app);
  app.save = createSave(app);
  app.progress = createProgress(app);
  app.stage = createStage(app, canvas);
  app.avatar = createAvatar(app);
  app.stage.avatarRoot.add(app.avatar.root);
  app.voice = createVoice(app);
  app.audio = createAudio(app);
  app.brain = createBrain(app);
  registerRoom(app.stage);

  // Start the VRM download right away, in parallel with the save and modules.
  app.ui.setLoading(0, 'Turning on the fairy lights…');
  const vrmLoad = app.avatar.load('assets/mira.vrm', (p, phase) => {
    if (phase === 'parse') app.ui.setLoading(0.97, 'Waking her up…');
    else app.ui.setLoading(p * 0.95, `Getting ready… ${Math.round(p * 100)}%`);
  });
  const connect = app.brain.connect();

  await app.save.init();
  touchStats();
  document.getElementById('app').classList.toggle('reduce-motion', !!app.state.settings.reduceMotion);
  app.ui.init();
  initPanels(app);
  initTouch(app);

  // Feature modules plug in here. One failing module never blocks the app.
  for (const load of modules) {
    try {
      const m = await load();
      const mod = m.default || m;
      if (!mod?.id || typeof mod.init !== 'function') continue;
      await Promise.race([Promise.resolve(mod.init(app)), new Promise((r) => setTimeout(r, 3000))]);
      app.modules[mod.id] = mod;
    } catch (e) { console.error('[module] failed to load', e); }
  }

  const loc = app.stage.sceneMeta(app.state.location) ? app.state.location : 'room';
  await app.stage.setScene(loc, { instant: true });
  app.stage.cameraPreset(app.state.settings.camera || 'upper');
  startLoop();

  try {
    await vrmLoad;
  } catch (e) {
    console.error('[avatar] load failed', e);
    app.ui.setLoading(1, 'She could not load. Check your connection and reload the page.');
    return;
  }
  app.avatar.setEmotion('happy', { hold: 6 });
  app.ui.setLoading(1, 'Ready');
  app.ui.renderHistory();
  app.ui.refreshChips();
  app.ui.computeInsets();
  app.ui.hideLoading();
  app.ready = true;
  app.bus.emit('ready', {});
  // A cloud save that arrives late replaces the state: follow its location.
  app.bus.on('save:loaded', () => {
    if (app.stage.sceneMeta(app.state.location) && app.stage.current !== app.state.location) app.stage.setScene(app.state.location);
  });

  // Sound and voice need a tap first.
  const unlock = () => { app.voice.unlock(); app.audio.unlock(); removeEventListener('pointerdown', unlock, true); removeEventListener('keydown', unlock, true); };
  addEventListener('pointerdown', unlock, true);
  addEventListener('keydown', unlock, true);

  await connect.catch(() => false);
  if (!app.state.onboarded) {
    app.avatar.playGesture('wave');
    await app.ui.onboard();
    app.ui.updateHUD();
    await app.brain.greet({ first: true });
  } else {
    await app.brain.greet();
  }
  app.save.dirty();
}

function touchStats() {
  const st = app.state.stats;
  const t = Date.now();
  if (!st.firstSeen) st.firstSeen = t;
  const today = todayKey();
  if (st.lastDay !== today) {
    const prev = st.lastDay ? new Date(st.lastDay + 'T00:00:00') : null;
    const gap = prev ? Math.round((new Date(today + 'T00:00:00') - prev) / 86400000) : 0;
    app.runtime.daysAway = gap;
    st.streak = gap === 1 ? (st.streak || 0) + 1 : 1;
    st.days = (st.days || 0) + 1;
    st.lastDay = today;
    app.runtime.newDay = true;
  }
  st.lastSeen = t;
}

function startLoop() {
  let last = now();
  let t = 0;
  const frame = () => {
    requestAnimationFrame(frame);
    if (document.visibilityState === 'hidden') { last = now(); return; }
    const n = now();
    const dt = Math.min(0.1, n - last);
    last = n;
    t += dt;
    app.time = t;
    app.bus.emit('tick', { dt, t });
    app.avatar.update(dt, t);
    app.stage.update(dt, t);
    app.stage.render();
  };
  requestAnimationFrame(frame);
  // refresh time of day for prompts once a minute
  setInterval(() => { app.runtime.tod = timeOfDay(); }, 60000);
  if (prefersReducedMotion()) document.getElementById('app').classList.add('reduce-motion');
}

boot().catch((e) => {
  console.error('[boot]', e);
  try { app.ui?.setLoading(1, 'Something went wrong while starting. Reload to try again.'); } catch { /* ignore */ }
});
