// Persistence: one private document per viewer in the artifact db
// (data/users/<id>/save) when the runtime offers db + user, mirrored to
// localStorage. Writes are debounced, sequential and skipped when nothing changed.

import { safeStorage } from './util.js';

const LS_KEY = 'miras-room/save/v1';
const DEBOUNCE_MS = 1500;

export const LIMITS = { turns: 24, log: 80, memories: 40, journal: 120 };

export function defaultState() {
  return {
    v: 1,
    savedAt: 0,
    onboarded: false,
    player: { name: '' },
    her: { name: 'Mira', style: 'sweet' },
    affection: { points: 0, level: 0 },
    coins: 40,
    unlocks: [],
    outfit: 'default',
    location: 'room',
    emotion: 'happy',
    settings: {
      voice: true,
      voiceName: '',
      pitch: 1.12,
      rate: 1.0,
      music: true,
      musicVolume: 0.5,
      sfx: true,
      thoughtful: false,
      camera: 'upper',
      reduceMotion: false,
    },
    memories: [], // [{t, text}]
    turns: [], // recent Claude turns [{role, content}]
    log: [], // visible chat history [{t, from: 'her'|'you'|'system', text}]
    journal: [], // moments [{t, kind, text}]
    stats: { messages: 0, firstSeen: 0, lastSeen: 0, days: 0, lastDay: '', streak: 0, coinsToday: 0, coinsDay: '' },
    cooldowns: {}, // per-key timestamps (touch affection etc.)
    mods: {}, // per-module saved data, see app.save.data(id)
  };
}

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

// Merge `src` over `base`: objects merge recursively, everything else replaces.
function merge(base, src) {
  if (!isPlainObject(src)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(src)) {
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = merge(base[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

function trim(state) {
  for (const [k, n] of Object.entries(LIMITS)) {
    if (Array.isArray(state[k]) && state[k].length > n) state[k] = state[k].slice(-n);
  }
  return state;
}

export function createSave(app) {
  const ls = safeStorage();
  let docRef = null;
  let cloud = false;
  let lastJSON = '';
  let writing = null;
  let queued = false;
  let timer = 0;

  const save = {
    get mode() { return cloud ? 'cloud' : 'local'; },

    // Load local state right away, then try the db (bounded by `waitMs`).
    // A newer cloud save that arrives later replaces the state in place and
    // emits 'save:loaded'.
    async init(waitMs = 4000) {
      let local = null;
      try { local = JSON.parse(ls.get(LS_KEY) || 'null'); } catch { local = null; }
      replaceState(app.state, merge(defaultState(), local || {}));

      const cloudLoad = connectCloud().then((remote) => {
        if (remote && (remote.savedAt || 0) > (app.state.savedAt || 0)) {
          replaceState(app.state, merge(defaultState(), remote));
          lastJSON = JSON.stringify(app.state);
          return true;
        }
        return false;
      }).catch((e) => { console.warn('[save] cloud load failed', e?.code || e); return false; });

      let settled = false;
      const adopted = await Promise.race([
        cloudLoad.then((r) => { settled = true; return r; }),
        new Promise((r) => setTimeout(() => r(null), waitMs)),
      ]);
      if (!settled) {
        // Cloud answered late: adopt it if newer and tell the app.
        cloudLoad.then((took) => { if (took) app.bus.emit('save:loaded', { source: 'cloud' }); });
      }
      return adopted ? 'cloud' : 'local';
    },

    // Mark state changed; writes after a short pause.
    dirty() {
      clearTimeout(timer);
      timer = setTimeout(() => save.flush(), DEBOUNCE_MS);
    },

    async flush() {
      clearTimeout(timer);
      if (writing) { queued = true; return writing; }
      trim(app.state);
      const snapshot = { ...app.state, savedAt: app.state.savedAt };
      const body = JSON.stringify({ ...snapshot, savedAt: 0 });
      if (body === lastJSON) return;
      app.state.savedAt = Date.now();
      const full = JSON.stringify(app.state);
      ls.set(LS_KEY, full);
      lastJSON = body;
      writing = (async () => {
        if (cloud && docRef) {
          try {
            await docRef.set(JSON.parse(full));
          } catch (e) {
            const code = e?.code;
            if (code === 'unavailable') {
              await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
              try { await docRef.set(JSON.parse(full)); } catch (e2) { console.warn('[save] retry failed', e2?.code); }
            } else {
              // invalid_argument (view-only), revoked, quota: keep local only.
              console.warn('[save] cloud write disabled:', code);
              cloud = false;
            }
          }
        }
        app.bus.emit('save', { mode: save.mode });
      })();
      try { await writing; } finally {
        writing = null;
        if (queued) { queued = false; save.dirty(); }
      }
    },

    // Per-module persistent object, created from `defaults` on first use.
    data(moduleId, defaults = {}) {
      const mods = app.state.mods || (app.state.mods = {});
      if (!isPlainObject(mods[moduleId])) mods[moduleId] = structuredClone(defaults);
      else mods[moduleId] = merge(structuredClone(defaults), mods[moduleId]);
      return mods[moduleId];
    },

    async reset() {
      replaceState(app.state, defaultState());
      lastJSON = '';
      ls.remove(LS_KEY);
      if (cloud && docRef) { try { await docRef.delete(); } catch { /* ignore */ } }
      app.bus.emit('save:loaded', { source: 'reset' });
    },

    exportJSON() {
      return JSON.stringify({ app: "Mira's Room", exportedAt: new Date().toISOString(), save: app.state }, null, 2);
    },
  };

  async function connectCloud() {
    const C = window.claude;
    if (!C || typeof C.use !== 'function') return null;
    const [db, user] = await Promise.all([
      Promise.resolve(C.use('db')).catch(() => null),
      Promise.resolve(C.use('user')).catch(() => null),
    ]);
    if (!db || !user) return null;
    const uid = await user.id();
    if (!uid) return null;
    docRef = db.doc('data/users/' + uid + '/save');
    cloud = true;
    const snap = await docRef.get();
    return snap.exists ? snap.data() : null;
  }

  // Flush on tab hide so progress survives a closed tab.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save.flush(); });
  addEventListener('pagehide', () => save.flush());

  return save;
}

function replaceState(target, next) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, structuredClone(next));
}
