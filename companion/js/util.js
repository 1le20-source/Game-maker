// Small shared helpers. No dependencies.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent smoothing: move `a` toward `b` with rate `k` per second.
export const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const now = () => performance.now() / 1000;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pick from a list while avoiding the last few picks for the same key.
const recentPicks = new Map();
export function pickFresh(key, arr) {
  if (!arr || !arr.length) return undefined;
  if (arr.length === 1) return arr[0];
  const recent = recentPicks.get(key) || [];
  const pool = arr.filter((x) => !recent.includes(x));
  const choice = pick(pool.length ? pool : arr);
  recent.push(choice);
  while (recent.length > Math.min(4, arr.length - 1)) recent.shift();
  recentPicks.set(key, recent);
  return choice;
}

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

// Tiny event bus. on() returns an unsubscribe function.
export function createBus() {
  const map = new Map();
  const bus = {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt)?.delete(fn);
    },
    once(evt, fn) {
      const off = bus.on(evt, (d) => { off(); fn(d); });
      return off;
    },
    off(evt, fn) { map.get(evt)?.delete(fn); },
    emit(evt, data) {
      const set = map.get(evt);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(data); } catch (e) { console.warn('[bus]', evt, e); }
      }
    },
  };
  return bus;
}

// DOM builder: el('div.cls#id', {attrs}, children...)
export function el(spec, attrs, ...children) {
  const m = spec.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const node = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') node.classList.add(part.slice(1));
      else node.id = part.slice(1);
    }
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== 'string') node[k] = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function timeOfDay(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function safeStorage() {
  return {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    remove(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
}

export const prefersReducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// Simple deterministic PRNG for procedural textures.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
