// Affection, coins, unlocks and journal moments. No decay: affection only
// moves when something happens, and it never drops below zero.

import { todayKey, clamp } from './util.js';

export const LEVELS = [
  { at: 0, name: 'Just met' },
  { at: 15, name: 'Acquaintance' },
  { at: 45, name: 'Friend' },
  { at: 100, name: 'Good friend' },
  { at: 180, name: 'Close friend' },
  { at: 290, name: 'Crush' },
  { at: 430, name: 'Sweetheart' },
  { at: 620, name: 'Soulmate' },
];

const DAILY_CHAT_COINS = 30;

export function createProgress(app) {
  const S = () => app.state;

  const progress = {
    LEVELS,
    get points() { return S().affection.points; },
    get coins() { return S().coins; },

    level(points = S().affection.points) {
      let l = 0;
      for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i].at) l = i;
      return l;
    },
    levelName(l = progress.level()) { return LEVELS[l]?.name || ''; },
    // 0..1 progress inside the current level
    levelProgress() {
      const p = S().affection.points, l = progress.level(p);
      const a = LEVELS[l].at, b = LEVELS[l + 1]?.at;
      return b ? clamp((p - a) / (b - a), 0, 1) : 1;
    },

    addAffection(delta, reason = '') {
      delta = Math.round(clamp(Number(delta) || 0, -5, 10));
      if (!delta) return { points: S().affection.points, level: progress.level(), delta: 0 };
      const before = progress.level();
      S().affection.points = Math.max(0, S().affection.points + delta);
      const after = progress.level();
      S().affection.level = after;
      const leveledUp = after > before;
      app.bus.emit('affection', { points: S().affection.points, delta, level: after, levelName: progress.levelName(after), leveledUp, reason });
      if (leveledUp) {
        progress.unlock('level:' + after);
        progress.addMoment('level', `${app.state.her.name} now thinks of you as: ${progress.levelName(after)}.`);
        progress.addCoins(10 * after, 'level');
      }
      app.save.dirty();
      return { points: S().affection.points, level: after, delta, leveledUp };
    },

    addCoins(n, reason = '') {
      n = Math.round(Number(n) || 0);
      if (!n) return S().coins;
      if (reason === 'chat') {
        const st = S().stats;
        if (st.coinsDay !== todayKey()) { st.coinsDay = todayKey(); st.coinsToday = 0; }
        if (st.coinsToday >= DAILY_CHAT_COINS) return S().coins;
        st.coinsToday += n;
      }
      S().coins = Math.max(0, S().coins + n);
      app.bus.emit('coins', { coins: S().coins, delta: n, reason });
      app.save.dirty();
      return S().coins;
    },
    spendCoins(n) {
      if (S().coins < n) return false;
      S().coins -= n;
      app.bus.emit('coins', { coins: S().coins, delta: -n, reason: 'spend' });
      app.save.dirty();
      return true;
    },

    unlock(id) {
      if (progress.isUnlocked(id)) return false;
      S().unlocks.push(id);
      app.bus.emit('unlock', { id });
      app.save.dirty();
      return true;
    },
    isUnlocked(id) { return S().unlocks.includes(id); },

    addMoment(kind, text) {
      S().journal.push({ t: Date.now(), kind, text });
      app.bus.emit('moment', { kind, text });
      app.save.dirty();
    },

    // True at most once per `ms` for a key (touch rewards etc.).
    cooldown(key, ms) {
      const c = S().cooldowns || (S().cooldowns = {});
      const now = Date.now();
      if (c[key] && now - c[key] < ms) return false;
      c[key] = now;
      return true;
    },
  };
  return progress;
}
