// Body Studio — Clothes Studio. Home and spa textiles with real cloth physics
// (blankets, throws, bath towels, massage-table sheets, face-cradle covers,
// yoga and massage mats, pillows, bed sheets) and a garment designer that
// saves wardrobes for Body Studio characters and textiles for Serenity Hands.
//
// BS.Textiles
//   material(spec, opts)        fabric material (BS.Fabric when present, else a procedural fallback)
//   Cloth                       position-based cloth solver (structural/shear/bend, substeps,
//                               drag + wind, sphere/capsule/box/plane colliders, friction,
//                               optional self-collision, volume for pillows, grab/drop)
//   ITEMS, SCENES               catalogue of textiles and room vignettes
//   Studio                      the 3D textile studio (renderer, orbit, drag, swatches)
//   boot()                      builds clothes.html
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const THREE = window.THREE;

  // ------------------------------------------------------------ helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash3(x, y, s) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // tileable value noise with integer period p
  function tnoise(x, y, p, s) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const m = (a) => ((a % p) + p) % p;
    const a = hash3(m(xi), m(yi), s), b = hash3(m(xi + 1), m(yi), s), c = hash3(m(xi), m(yi + 1), s), d = hash3(m(xi + 1), m(yi + 1), s);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, y, p, oct, s) {
    let sum = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < oct; o++) { sum += amp * tnoise(x, y, p, s + o * 17); norm += amp; x *= 2; y *= 2; p *= 2; amp *= 0.5; }
    return sum / norm;
  }
  const hexRgb = (h) => { const c = new THREE.Color(h || '#888888'); return [c.r * 255, c.g * 255, c.b * 255]; };
  const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const store = {
    get(k, fb) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const canvas2d = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; };

  // ------------------------------------------------------- fabric types
  const FABRICS = [
    ['cotton', 'Cotton'], ['jersey', 'Jersey'], ['denim', 'Denim'], ['linen', 'Linen'], ['silk', 'Silk'], ['satin', 'Satin'],
    ['wool', 'Wool'], ['knit', 'Knit'], ['fleece', 'Fleece'], ['terry', 'Terry'], ['leather', 'Leather'], ['lace', 'Lace'],
    ['nylon', 'Nylon'], ['spandex', 'Spandex'], ['canvas', 'Canvas'], ['velvet', 'Velvet'], ['microfiber', 'Microfiber'], ['rubber', 'Rubber'],
  ].map(([id, label]) => ({ id, label }));
  const PATTERNS = [
    ['solid', 'Solid'], ['stripes', 'Stripes'], ['pinstripe', 'Pinstripe'], ['plaid', 'Plaid'], ['gingham', 'Gingham'], ['dots', 'Dots'],
    ['floral', 'Floral'], ['camo', 'Camo'], ['herringbone', 'Herringbone'], ['heather', 'Heather'], ['chevron', 'Chevron'], ['paisley', 'Paisley'],
  ].map(([id, label]) => ({ id, label }));
  const listOr = (l, fb) => (Array.isArray(l) && l.length ? l.map((x) => (typeof x === 'string' ? { id: x, label: x[0].toUpperCase() + x.slice(1) } : x)) : fb);
  const fabricTypes = () => listOr(BS.Fabric && BS.Fabric.TYPES, FABRICS);
  const fabricPatterns = () => listOr(BS.Fabric && BS.Fabric.PATTERNS, PATTERNS);

  // physical behaviour per fabric: areal mass (kg/m²), bending (0..1 per
  // frame), friction, default thickness (m), plus fallback shading values
  const PHYS = {
    cotton: { gsm: 0.16, bend: 0.1, fr: 0.5, t: 0.0012, rough: 0.9, sheen: 0.35, ns: 0.55, tile: 0.006 },
    jersey: { gsm: 0.17, bend: 0.04, fr: 0.5, t: 0.0012, rough: 0.9, sheen: 0.4, ns: 0.55, tile: 0.007 },
    denim: { gsm: 0.4, bend: 0.32, fr: 0.5, t: 0.0018, rough: 0.92, sheen: 0.1, ns: 0.9, tile: 0.008 },
    linen: { gsm: 0.19, bend: 0.24, fr: 0.45, t: 0.0014, rough: 0.92, sheen: 0.15, ns: 0.85, tile: 0.01 },
    silk: { gsm: 0.06, bend: 0.015, fr: 0.12, t: 0.0006, rough: 0.34, sheen: 0.9, ns: 0.12, tile: 0.003 },
    satin: { gsm: 0.12, bend: 0.03, fr: 0.12, t: 0.0008, rough: 0.3, sheen: 1, ns: 0.15, tile: 0.004 },
    wool: { gsm: 0.42, bend: 0.22, fr: 0.65, t: 0.005, rough: 0.96, sheen: 0.6, ns: 0.85, tile: 0.014 },
    knit: { gsm: 0.55, bend: 0.12, fr: 0.65, t: 0.008, rough: 0.96, sheen: 0.55, ns: 1.4, tile: 0.032 },
    fleece: { gsm: 0.3, bend: 0.1, fr: 0.65, t: 0.006, rough: 1, sheen: 0.85, ns: 0.4, tile: 0.02 },
    terry: { gsm: 0.55, bend: 0.22, fr: 0.8, t: 0.005, rough: 1, sheen: 0.7, ns: 1.25, tile: 0.014 },
    leather: { gsm: 0.9, bend: 0.6, fr: 0.5, t: 0.0015, rough: 0.5, sheen: 0, ns: 0.45, tile: 0.05 },
    lace: { gsm: 0.07, bend: 0.02, fr: 0.3, t: 0.0008, rough: 0.8, sheen: 0.3, ns: 0.6, tile: 0.03 },
    nylon: { gsm: 0.07, bend: 0.03, fr: 0.2, t: 0.0005, rough: 0.45, sheen: 0.3, ns: 0.2, tile: 0.003 },
    spandex: { gsm: 0.2, bend: 0.03, fr: 0.4, t: 0.0008, rough: 0.5, sheen: 0.4, ns: 0.3, tile: 0.004 },
    canvas: { gsm: 0.38, bend: 0.45, fr: 0.55, t: 0.0018, rough: 0.95, sheen: 0.05, ns: 1, tile: 0.012 },
    velvet: { gsm: 0.34, bend: 0.12, fr: 0.55, t: 0.0022, rough: 0.85, sheen: 1, ns: 0.2, tile: 0.01 },
    microfiber: { gsm: 0.22, bend: 0.06, fr: 0.5, t: 0.0018, rough: 0.82, sheen: 0.75, ns: 0.25, tile: 0.01 },
    rubber: { gsm: 1.8, bend: 0.9, fr: 0.9, t: 0.005, rough: 0.75, sheen: 0, ns: 0.6, tile: 0.02 },
  };
  const phys = (type) => PHYS[type] || PHYS.cotton;

  // ------------------------------------------- fallback fabric textures
  // Used while fabric.js is unavailable: a weave height field per type
  // (normal + cavity maps, tiled at thread scale) and a pattern colour tile.
  const WS = 128;
  function weaveHeight(type) {
    const H = new Float32Array(WS * WS), R = rng(type.length * 977 + type.charCodeAt(0) * 31);
    const field = (fn) => { for (let y = 0; y < WS; y++) for (let x = 0; x < WS; x++) H[y * WS + x] = fn(x / WS, y / WS); };
    const yarn = (f) => Math.sqrt(Math.max(0, Math.sin(Math.PI * f)));
    const weave = (N, up, slub) => (u, v) => {
      const X = u * N, Y = v * N, i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy = Y - j;
      const sw = slub ? 0.7 + 0.6 * tnoise(i * 3, v * 8, 8 * N, 5) : 1, sf = slub ? 0.7 + 0.6 * tnoise(j * 3, u * 8, 8 * N, 9) : 1;
      return up(i, j) ? yarn(fx) * (0.55 + 0.45 * Math.sin(Math.PI * fy)) * sw : yarn(fy) * (0.55 + 0.45 * Math.sin(Math.PI * fx)) * sf;
    };
    const knitF = (cols, rows) => (u, v) => {
      const X = u * cols, Y = v * rows, fx = X - Math.floor(X), fy = Y - Math.floor(Y);
      const leg = (d) => (d < 1 ? Math.sqrt(1 - d * d) : 0);
      const l = leg(Math.abs(fx - (0.29 + 0.19 * fy)) / 0.21), r = leg(Math.abs(fx - (0.71 - 0.19 * fy)) / 0.21);
      return Math.max(l, r) * Math.pow(Math.sin(Math.PI * fy), 0.3);
    };
    const bumps = (count, r0, r1, base) => {
      for (let n = 0; n < count; n++) {
        const cx = R() * WS, cy = R() * WS, r = (r0 + R() * (r1 - r0)) * WS, hgt = 0.6 + R() * 0.4;
        for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          const d = Math.hypot(x - cx, y - cy) / r;
          if (d >= 1) continue;
          const k = ((y + WS) % WS) * WS + ((x + WS) % WS);
          H[k] = Math.max(H[k], base + hgt * Math.sqrt(1 - d * d));
        }
      }
    };
    switch (type) {
      case 'denim': case 'wool': field(weave(12, (i, j) => (((i - j) % 4) + 4) % 4 < 3, false)); break;
      case 'satin': field(weave(20, (i, j) => (i * 2 + j) % 5 !== 0, false)); break;
      case 'silk': case 'nylon': field(weave(24, (i, j) => (i + j) & 1, false)); break;
      case 'linen': field(weave(10, (i, j) => (i + j) & 1, true)); break;
      case 'canvas': field(weave(8, (i, j) => (i + j) & 1, true)); break;
      case 'jersey': case 'spandex': field(knitF(10, 13)); break;
      case 'knit': field(knitF(4, 5)); break;
      case 'terry': field((u, v) => 0.25 * weave(16, (i, j) => (i + j) & 1)(u, v)); bumps(900, 0.018, 0.034, 0.2); break;
      case 'fleece': field((u, v) => fbm(u * 8, v * 8, 8, 4, 3)); break;
      case 'velvet': case 'microfiber': field((u, v) => 0.6 * fbm(u * 32, v * 32, 32, 3, 4) + 0.4 * tnoise(u * 64, v * 4, 64, 6)); break;
      case 'leather': {
        const pts = []; for (let i = 0; i < 70; i++) pts.push([R(), R()]);
        field((u, v) => {
          let d1 = 9, d2 = 9;
          for (const [px, py] of pts) {
            let dx = Math.abs(u - px), dy = Math.abs(v - py); dx = Math.min(dx, 1 - dx); dy = Math.min(dy, 1 - dy);
            const d = dx * dx + dy * dy;
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          return sstep(0, 0.012, Math.sqrt(d2) - Math.sqrt(d1)) * 0.8 + 0.2 * tnoise(u * 64, v * 64, 64, 2);
        });
        break;
      }
      case 'lace': field((u, v) => {
        // hexagonal net with a flower motif
        const X = u * 6, Y = v * 6 * 0.866 * 2;
        const gx = X - Math.round(X), gy = (Y / 1.732) - Math.round(Y / 1.732);
        const net = Math.max(0, 1 - Math.min(Math.abs(gx), Math.abs(gy), Math.abs(gx - gy * 0.5)) * 14);
        const cx = u - 0.5, cy = v - 0.5, rr = Math.hypot(cx, cy), a = Math.atan2(cy, cx);
        const petal = rr < 0.32 ? sstep(0.05, 0, Math.abs(rr - 0.22 - 0.06 * Math.cos(a * 6))) : 0;
        return Math.max(net, petal, rr < 0.06 ? 1 : 0);
      }); break;
      case 'rubber': field((u, v) => {
        const X = u * 16, Y = v * 16, i = Math.floor(X), j = Math.floor(Y);
        const fx = X - i - 0.5 - ((j & 1) ? 0.5 : 0), fy = Y - j - 0.5;
        const d = Math.hypot(fx - Math.round(fx), fy);
        return 0.25 * tnoise(u * 32, v * 32, 32, 7) + (d < 0.32 ? Math.sqrt(1 - (d / 0.32) ** 2) : 0) * 0.75;
      }); break;
      default: field(weave(12, (i, j) => (i + j) & 1, false));
    }
    // fibre fuzz on the yarns
    const fuzz = { terry: 0.12, fleece: 0.1, wool: 0.12, knit: 0.06, velvet: 0, cotton: 0.05, linen: 0.06, canvas: 0.05 }[type] ?? 0.03;
    if (fuzz) for (let i = 0; i < H.length; i++) H[i] += (R() - 0.5) * fuzz;
    return H;
  }
  const weaveCache = {};
  function weaveTextures(type) {
    if (weaveCache[type]) return weaveCache[type];
    const H = weaveHeight(type), n = new Uint8Array(WS * WS * 4), ao = new Uint8Array(WS * WS * 4);
    const h = (x, y) => H[((y + WS) % WS) * WS + ((x + WS) % WS)];
    let alpha = null;
    if (type === 'lace') alpha = new Uint8Array(WS * WS * 4);
    for (let y = 0; y < WS; y++) for (let x = 0; x < WS; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
      let nx = -dx * 1.4, ny = -dy * 1.4, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const k = (y * WS + x) * 4;
      n[k] = (nx * 0.5 + 0.5) * 255; n[k + 1] = (ny * 0.5 + 0.5) * 255; n[k + 2] = (nz * 0.5 + 0.5) * 255; n[k + 3] = 255;
      const a = clamp(0.3 + 0.75 * h(x, y), 0, 1) * 255;
      ao[k] = ao[k + 1] = ao[k + 2] = a; ao[k + 3] = 255;
      if (alpha) { const v = h(x, y) > 0.35 ? 255 : 0; alpha[k] = alpha[k + 1] = alpha[k + 2] = v; alpha[k + 3] = 255; }
    }
    const tex = (data) => {
      const t = new THREE.DataTexture(data, WS, WS, THREE.RGBAFormat);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 8;
      const r = 1 / phys(type).tile;
      t.repeat.set(r, r);
      t.needsUpdate = true;
      return t;
    };
    return (weaveCache[type] = { normal: tex(n), ao: tex(ao), alpha: alpha && tex(alpha) });
  }

  // pattern tiles: physical size (m) of one tile at scale 1
  const PATTERN_TILE = { solid: 0.3, stripes: 0.16, pinstripe: 0.08, plaid: 0.3, gingham: 0.06, dots: 0.12, floral: 0.3, camo: 0.6, herringbone: 0.05, heather: 0.12, chevron: 0.2, paisley: 0.3 };
  function paintPattern(g, S, pattern, col1, col2, seed) {
    const c1 = hexRgb(col1), c2 = hexRgb(col2 || col1), R = rng(seed || 7);
    const dark = mixRgb(c1, [0, 0, 0], 0.35), light = mixRgb(c1, [255, 255, 255], 0.5);
    g.fillStyle = css(c1); g.fillRect(0, 0, S, S);
    const wrapDraw = (x, y, r, fn) => {
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        if (x + ox + r < 0 || x + ox - r > S || y + oy + r < 0 || y + oy - r > S) continue;
        g.save(); g.translate(x + ox, y + oy); fn(); g.restore();
      }
    };
    const pixels = (fn) => {
      const img = g.getImageData(0, 0, S, S), d = img.data;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = (y * S + x) * 4, c = fn(x / S, y / S); d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; }
      g.putImageData(img, 0, 0);
    };
    switch (pattern) {
      case 'stripes': g.fillStyle = css(c2); for (let i = 0; i < 4; i++) g.fillRect(0, i * S / 4, S, S / 9); break;
      case 'pinstripe': g.fillStyle = css(c2); for (let i = 0; i < 8; i++) g.fillRect(i * S / 8, 0, Math.max(1, S / 160), S); break;
      case 'plaid': {
        const bands = [[0, 0.22, c2, 0.55], [0.3, 0.06, dark, 0.5], [0.5, 0.18, c2, 0.4], [0.74, 0.015, light, 0.8], [0.86, 0.06, dark, 0.45]];
        for (const [o, w, c, a] of bands) { g.fillStyle = css(c, a); g.fillRect(o * S, 0, w * S, S); g.fillRect(0, o * S, S, w * S); }
        // twill texture of the woven check
        g.globalAlpha = 0.08; g.strokeStyle = '#000';
        for (let i = -S; i < S; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke(); }
        g.globalAlpha = 1;
        break;
      }
      case 'gingham': g.fillStyle = css(c2, 0.5); for (let i = 0; i < 4; i++) { g.fillRect(i * S / 4, 0, S / 8, S); g.fillRect(0, i * S / 4, S, S / 8); } break;
      case 'dots': g.fillStyle = css(c2); for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const x = (i + (j & 1) * 0.5 + 0.25) * S / 4, y = (j + 0.5) * S / 4;
        wrapDraw(x, y, S / 18, () => { g.beginPath(); g.arc(0, 0, S / 20, 0, Math.PI * 2); g.fill(); });
      } break;
      case 'floral': {
        const leaf = mixRgb(c2, [60, 90, 50], 0.55);
        for (let n = 0; n < 14; n++) {
          const x = R() * S, y = R() * S, r = S * (0.035 + R() * 0.03), rot = R() * 6;
          wrapDraw(x, y, r * 3, () => {
            g.rotate(rot);
            g.fillStyle = css(leaf, 0.9);
            for (const a of [0.6, 2.9]) { g.save(); g.rotate(a); g.beginPath(); g.ellipse(r * 1.7, 0, r * 0.95, r * 0.38, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
            g.fillStyle = css(c2);
            for (let k = 0; k < 5; k++) { g.save(); g.rotate(k * 1.2566); g.beginPath(); g.ellipse(r * 0.75, 0, r * 0.75, r * 0.45, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
            g.fillStyle = css(mixRgb(c2, [250, 220, 120], 0.6)); g.beginPath(); g.arc(0, 0, r * 0.3, 0, Math.PI * 2); g.fill();
          });
        }
        break;
      }
      case 'camo': {
        const cols = [c1, c2, mixRgb(c1, c2, 0.5), dark];
        pixels((u, v) => {
          let k = 0;
          for (let l = 1; l < 4; l++) if (fbm(u * 4 + l * 1.7, v * 4, 4, 3, 40 + l * 9) > 0.55) k = l;
          return cols[k];
        });
        break;
      }
      case 'herringbone': {
        g.strokeStyle = css(c2, 0.55); g.lineWidth = S / 64;
        for (let col = 0; col < 8; col++) {
          const x0 = col * S / 8, dir = col & 1 ? 1 : -1;
          g.save(); g.beginPath(); g.rect(x0, 0, S / 8, S); g.clip();
          for (let y = -S / 4; y < S + S / 4; y += S / 24) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + S / 8, y + dir * S / 8); g.stroke(); }
          g.restore();
        }
        break;
      }
      case 'heather': pixels((u, v) => {
        const r = hash3(u * S, v * S, 3), streak = tnoise(u * 64, v * 4, 64, 8);
        return r > 0.93 ? light : mixRgb(c1, c2, clamp(streak * 0.8 + (r - 0.5) * 0.6, 0, 1));
      }); break;
      case 'chevron': {
        g.fillStyle = css(c2);
        for (let k = 0; k < 4; k++) {
          const y = k * S / 4;
          g.beginPath();
          for (let i = 0; i <= 4; i++) g.lineTo(i * S / 4, y + (i & 1 ? S / 8 : 0));
          for (let i = 4; i >= 0; i--) g.lineTo(i * S / 4, y + S / 10 + (i & 1 ? S / 8 : 0));
          g.fill();
        }
        break;
      }
      case 'paisley': {
        for (let n = 0; n < 9; n++) {
          const x = R() * S, y = R() * S, r = S * (0.05 + R() * 0.03), rot = R() * 6;
          wrapDraw(x, y, r * 2.5, () => {
            g.rotate(rot);
            const drop = (s) => { g.beginPath(); g.arc(0, 0, r * s, Math.PI * 0.5, Math.PI * 2.1); g.quadraticCurveTo(r * s * 1.6, -r * s * 1.6, r * s * 2.2, -r * s * 0.4); g.quadraticCurveTo(r * s * 0.9, r * s * 1.1, 0, r * s); g.fill(); };
            g.fillStyle = css(c2); drop(1);
            g.fillStyle = css(c1); drop(0.62);
            g.fillStyle = css(dark); drop(0.3);
          });
        }
        break;
      }
      default: break;
    }
    // subtle dye variation so plain cloth never looks flat
    const img = g.getImageData(0, 0, S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const k = (y * S + x) * 4, f = 1 + (fbm(x / S * 6, y / S * 6, 6, 3, 11) - 0.5) * 0.08;
      d[k] = clamp(d[k] * f, 0, 255); d[k + 1] = clamp(d[k + 1] * f, 0, 255); d[k + 2] = clamp(d[k + 2] * f, 0, 255);
    }
    g.putImageData(img, 0, 0);
  }
  function patternTexture(spec) {
    const S = 512, c = canvas2d(S);
    paintPattern(c.getContext('2d'), S, spec.pattern || 'solid', spec.color, spec.color2, 5);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    const r = 1 / ((PATTERN_TILE[spec.pattern] || 0.3) * (spec.scale || 1));
    t.repeat.set(r, r);
    return t;
  }

  function fallbackMaterial(spec) {
    const type = PHYS[spec.type] ? spec.type : 'cotton', ph = PHYS[type], w = weaveTextures(type);
    const col = new THREE.Color(spec.color || '#cccccc');
    const params = {
      color: 0xffffff, map: patternTexture(spec), normalMap: w.normal, normalScale: new THREE.Vector2(ph.ns, ph.ns),
      aoMap: w.ao, aoMapIntensity: 0.9, roughness: spec.roughness ?? ph.rough, metalness: 0,
      sheen: spec.sheen ?? ph.sheen, sheenRoughness: type === 'velvet' ? 0.3 : type === 'satin' || type === 'silk' ? 0.25 : 0.55,
      sheenColor: col.clone().lerp(new THREE.Color(1, 1, 1), type === 'velvet' ? 0.25 : 0.55), side: THREE.DoubleSide,
    };
    if (type === 'satin' || type === 'silk') Object.assign(params, { anisotropy: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.35 });
    if (type === 'leather') Object.assign(params, { clearcoat: 0.25, clearcoatRoughness: 0.45 });
    if (type === 'lace') Object.assign(params, { alphaMap: w.alpha, alphaTest: 0.5 });
    const m = new THREE.MeshPhysicalMaterial(params);
    m.userData.fallback = true;
    return m;
  }

  // the studio's fabric material: BS.Fabric when it is available
  function material(spec, opts = {}) {
    let m = null;
    if (BS.Fabric && typeof BS.Fabric.material === 'function') {
      try { m = BS.Fabric.material(spec, Object.assign({ space: 'uv' }, opts)); } catch (e) { console.warn('BS.Fabric.material failed, using fallback', e); m = null; }
    }
    if (!m) {
      m = fallbackMaterial(spec);
      if (opts.skinned) BS.skinned8(m);
    }
    return m;
  }
  function disposeMaterial(m) {
    if (!m) return;
    for (const k of ['map', 'alphaMap']) if (m[k] && m.userData.fallback && k === 'map') m[k].dispose();
    m.dispose();
  }

  // Hem, stitching, woven borders and fold shading for flat textiles. UVs
  // are in meters; uSize is the flat size of the piece.
  function addTextileDetail(mat, U) {
    if (!mat.isMeshStandardMaterial) return mat;
    mat.vertexColors = true;
    BS.patch(mat, 'textile-detail', (shader) => {
      if (shader.vertexShader.indexOf('#include <uv_vertex>') < 0 || shader.fragmentShader.indexOf('#include <map_fragment>') < 0) return;
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCloth;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCloth = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vCloth;
uniform vec2 uSize;
uniform vec4 uHem;      // hem width on the long sides, on the ends, hem shading, stitch on
uniform vec4 uBand;     // woven border: start, end (m from the ends), strength, on
uniform vec3 uBandColor;
uniform vec3 uThread;
float clothStitch(float d, float along) {
  float w = fwidth(d) * 0.8 + 0.0003;
  float line = 1.0 - smoothstep(w, w * 2.2, abs(d));
  float f = fract(along / 0.0042);
  return line * smoothstep(0.1, 0.25, f) * (1.0 - smoothstep(0.7, 0.85, f));
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  float dU = min(vCloth.x, uSize.x - vCloth.x), dV = min(vCloth.y, uSize.y - vCloth.y);
  float band = uBand.w * step(uBand.x, dV) * step(dV, uBand.y);
  float bandEdge = uBand.w * (exp(-pow((dV - uBand.x) / 0.0025, 2.0)) + exp(-pow((dV - uBand.y) / 0.0025, 2.0)));
  diffuseColor.rgb = mix(diffuseColor.rgb, uBandColor, band * uBand.z);
  diffuseColor.rgb *= 1.0 - 0.18 * bandEdge;
  float inHemU = 1.0 - step(uHem.x, dU), inHemV = 1.0 - step(uHem.y, dV);
  float hemLine = exp(-pow((dU - uHem.x) / 0.0018, 2.0)) * step(0.0001, uHem.x) + exp(-pow((dV - uHem.y) / 0.0018, 2.0)) * step(0.0001, uHem.y);
  diffuseColor.rgb *= 1.0 - uHem.z * (0.22 * hemLine + 0.05 * max(inHemU, inHemV));
  float st = uHem.w * (clothStitch(dU - uHem.x * 0.55, vCloth.y) * step(0.0001, uHem.x) * (1.0 - inHemV * (1.0 - inHemU))
    + clothStitch(dV - uHem.y * 0.55, vCloth.x) * step(0.0001, uHem.y));
  diffuseColor.rgb = mix(diffuseColor.rgb, uThread, clamp(st, 0.0, 1.0) * 0.85);
}`);
    });
    return mat;
  }

  // ------------------------------------------------------------ colliders
  // Static collision shapes in world space; each pushes a point (with a
  // radius) out and reports the contact normal in _hit.
  const _hit = { x: 0, y: 0, z: 0 };
  function makeCollider(type, o) {
    const c = Object.assign({ type }, o);
    if (type === 'box') {
      c.cos = Math.cos(c.yaw || 0); c.sin = Math.sin(c.yaw || 0);
      c.bound = Math.hypot(c.hx, c.hy, c.hz) + 0.05;
    } else if (type === 'capsule') {
      c.abx = c.bx - c.ax; c.aby = c.by - c.ay; c.abz = c.bz - c.az;
      c.ab2 = c.abx * c.abx + c.aby * c.aby + c.abz * c.abz || 1;
      c.cx = (c.ax + c.bx) / 2; c.cy = (c.ay + c.by) / 2; c.cz = (c.az + c.bz) / 2;
      c.bound = Math.sqrt(c.ab2) / 2 + c.r + 0.05;
    } else if (type === 'sphere') c.bound = c.r + 0.05;
    return c;
  }
  // returns true on contact (p modified in place at offset k)
  function pushOut(c, p, k, rad) {
    const x = p[k], y = p[k + 1], z = p[k + 2];
    if (c.type === 'plane') {
      const d = x * c.nx + y * c.ny + z * c.nz - c.d - rad;
      if (d >= 0) return false;
      p[k] -= c.nx * d; p[k + 1] -= c.ny * d; p[k + 2] -= c.nz * d;
      _hit.x = c.nx; _hit.y = c.ny; _hit.z = c.nz;
      return true;
    }
    if (c.type === 'sphere' || c.type === 'capsule') {
      let cx = c.cx, cy = c.cy, cz = c.cz;
      const bx = x - cx, by = y - cy, bz = z - cz;
      if (bx * bx + by * by + bz * bz > (c.bound + rad) * (c.bound + rad)) return false;
      if (c.type === 'capsule') {
        const t = clamp(((x - c.ax) * c.abx + (y - c.ay) * c.aby + (z - c.az) * c.abz) / c.ab2, 0, 1);
        cx = c.ax + c.abx * t; cy = c.ay + c.aby * t; cz = c.az + c.abz * t;
      }
      const dx = x - cx, dy = y - cy, dz = z - cz, R = c.r + rad, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= R * R) return false;
      const d = Math.sqrt(d2) || 1e-6, s = R / d;
      p[k] = cx + dx * s; p[k + 1] = cy + dy * s; p[k + 2] = cz + dz * s;
      _hit.x = dx / d; _hit.y = dy / d; _hit.z = dz / d;
      return true;
    }
    // rounded box, rotated about Y
    const ox = x - c.cx, oy = y - c.cy, oz = z - c.cz;
    if (ox * ox + oy * oy + oz * oz > (c.bound + rad) * (c.bound + rad)) return false;
    const lx = ox * c.cos - oz * c.sin, lz = ox * c.sin + oz * c.cos, ly = oy;
    const r = c.r || 0, ix = c.hx - r, iy = c.hy - r, iz = c.hz - r;
    const qx = clamp(lx, -ix, ix), qy = clamp(ly, -iy, iy), qz = clamp(lz, -iz, iz);
    let dx = lx - qx, dy = ly - qy, dz = lz - qz;
    const d2 = dx * dx + dy * dy + dz * dz, R = r + rad;
    let nx, ny, nz, px, py, pz;
    if (d2 > 1e-12) {
      if (d2 >= R * R) return false;
      const d = Math.sqrt(d2);
      nx = dx / d; ny = dy / d; nz = dz / d;
      px = qx + nx * R; py = qy + ny * R; pz = qz + nz * R;
    } else {
      // inside the core: leave through the nearest face
      const ex = ix - Math.abs(lx), ey = iy - Math.abs(ly), ez = iz - Math.abs(lz);
      nx = ny = nz = 0; px = lx; py = ly; pz = lz;
      if (ey <= ex && ey <= ez) { ny = ly < 0 ? -1 : 1; py = ny * (iy + R); }
      else if (ex <= ez) { nx = lx < 0 ? -1 : 1; px = nx * (ix + R); }
      else { nz = lz < 0 ? -1 : 1; pz = nz * (iz + R); }
    }
    // back to world
    p[k] = c.cx + px * c.cos + pz * c.sin; p[k + 1] = c.cy + py; p[k + 2] = c.cz - px * c.sin + pz * c.cos;
    _hit.x = nx * c.cos + nz * c.sin; _hit.y = ny; _hit.z = -nx * c.sin + nz * c.cos;
    return true;
  }

  // ---------------------------------------------------------- cloth solver
  // Position-based dynamics with small substeps (one Gauss-Seidel sweep each,
  // alternating direction): stiff, stable and cheap. Distance constraints
  // resist stretch fully but compression only partly, so cloth buckles
  // into folds the way real fabric does.
  class Cloth {
    constructor(n) {
      this.n = n;
      this.p = new Float32Array(n * 3);
      this.q = new Float32Array(n * 3);
      this.w = new Float32Array(n).fill(1);
      this.w0 = new Float32Array(n).fill(1);
      this.acc = new Float32Array(n * 3);
      this.nrm = new Float32Array(n * 3);
      this.flat = new Float32Array(n * 2); // flat (sewing pattern) coordinates, m
      this.gu = new Int16Array(n); this.gv = new Int16Array(n); this.panel = new Uint8Array(n);
      this.list = [];
      this.colliders = [];
      this.tris = null;
      this.substeps = 10;
      this.damping = 0.8;
      this.friction = 0.5;
      this.radius = 0.004;
      this.compress = 0.35;
      this.cd = 1.3;
      this.gsm = 0.2;
      this.gravity = -9.81;
      this.wind = new THREE.Vector3(1, 0, 0.4).normalize();
      this.windAmt = 0;
      this.time = 0;
      this.self = false;
      this.selfDist = 0.01;
      this.vol = null;
      this.stack = null;
      this.grabbed = null;
      this.sleeping = false;
      this.still = 0;
    }
    dist(a, b) { const p = this.p; return Math.hypot(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]); }
    flatDist(a, b) { const f = this.flat; return Math.hypot(f[b * 2] - f[a * 2], f[b * 2 + 1] - f[a * 2 + 1]); }
    // kind: 0 stretch, 1 shear, 2 bend; k = stiffness per frame
    add(a, b, k, kind, rest) { this.list.push(a, b, rest ?? this.flatDist(a, b), k, kind); }
    finalize() {
      const L = this.list, m = L.length / 5, S = this.substeps;
      this.ca = new Int32Array(m); this.cb = new Int32Array(m); this.cr = new Float32Array(m); this.ck = new Float32Array(m); this.cc = new Float32Array(m);
      for (let i = 0; i < m; i++) {
        this.ca[i] = L[i * 5]; this.cb[i] = L[i * 5 + 1]; this.cr[i] = L[i * 5 + 2];
        const k = L[i * 5 + 3];
        this.ck[i] = k >= 1 ? 1 : 1 - Math.pow(1 - k, 1 / S);
        this.cc[i] = L[i * 5 + 4] === 2 ? 1 : this.compress; // compression response
      }
      this.list = null;
      this.q.set(this.p);
      if (this.self) this._initSelf();
    }
    setTris(tris) { this.tris = tris; }
    // folded stacks: breakable spacers between layers
    setStack(a, b, rest) {
      this.stack = { a: Int32Array.from(a), b: Int32Array.from(b), r: Float32Array.from(rest), on: new Uint8Array(a.length).fill(1) };
    }
    // pillows: keep the enclosed volume near v0
    setVolume(v0, k) { this.vol = { v0, k, g: new Float32Array(this.n * 3) }; }
    volume() {
      const t = this.tris, p = this.p;
      let V = 0;
      for (let i = 0; i < t.length; i += 3) {
        const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
        V += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
      }
      return V / 6;
    }
    wake() { this.sleeping = false; this.still = 0; }

    computeNormals() {
      const t = this.tris, p = this.p, N = this.nrm;
      N.fill(0);
      for (let i = 0; i < t.length; i += 3) {
        const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; N[b] += nx; N[b + 1] += ny; N[b + 2] += nz; N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
      }
      for (let i = 0; i < N.length; i += 3) {
        const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
        N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
      }
    }

    // air drag (mostly along the normal, so cloth floats as it falls) and wind
    forces(h) {
      const n = this.n, p = this.p, q = this.q, N = this.nrm, a = this.acc, kd = this.cd / this.gsm, t = this.time;
      const wa = this.windAmt, W = this.wind;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        let rx = (p[k] - q[k]) / h, ry = (p[k + 1] - q[k + 1]) / h, rz = (p[k + 2] - q[k + 2]) / h;
        if (wa) {
          const g = wa * (0.55 + 0.45 * Math.sin(t * 1.3 + p[k] * 2.3 + p[k + 1] * 1.1) * Math.sin(t * 0.73 + p[k + 2] * 1.9)) * (0.8 + 0.2 * Math.sin(t * 5.1 + i * 0.37));
          rx -= W.x * g; ry -= W.y * g; rz -= W.z * g;
        }
        const vn = rx * N[k] + ry * N[k + 1] + rz * N[k + 2];
        a[k] = -kd * (vn * N[k] + rx * 0.04); a[k + 1] = -kd * (vn * N[k + 1] + ry * 0.04); a[k + 2] = -kd * (vn * N[k + 2] + rz * 0.04);
      }
    }

    step(dt) {
      if (this.sleeping) return false;
      const S = this.substeps, h = dt / S, h2 = h * h, n = this.n, p = this.p, q = this.q, w = this.w, a = this.acc;
      this.time += dt;
      if (this.tris) { this.computeNormals(); this.forces(h); }
      const damp = Math.max(0, 1 - this.damping * h), g = this.gravity;
      let maxMove = 0;
      for (let s = 0; s < S; s++) {
        for (let i = 0; i < n; i++) {
          const k = i * 3;
          if (w[i] === 0) continue;
          const vx = (p[k] - q[k]) * damp, vy = (p[k + 1] - q[k + 1]) * damp, vz = (p[k + 2] - q[k + 2]) * damp;
          q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
          p[k] += vx + a[k] * h2; p[k + 1] += vy + (a[k + 1] + g) * h2; p[k + 2] += vz + a[k + 2] * h2;
        }
        this._solve(s & 1);
        if (this.stack) this._solveStack();
        if (this.vol) this._solveVolume();
        maxMove = this._collide(s === S - 1);
      }
      if (this.self) this._selfCollide();
      // fall asleep once everything is still, wake on any interaction
      if (maxMove < 0.00004 * h * 60 && !this.grabbed && !this.windAmt) { if ((this.still += dt) > 1.2) this.sleeping = true; } else this.still = 0;
      return true;
    }

    _solve(rev) {
      const p = this.p, w = this.w, A = this.ca, B = this.cb, R = this.cr, K = this.ck, C = this.cc, m = A.length;
      for (let it = 0; it < m; it++) {
        const c = rev ? m - 1 - it : it;
        const a = A[c], b = B[c], wa = w[a], wb = w[b], ws = wa + wb;
        if (ws === 0) continue;
        const ia = a * 3, ib = b * 3;
        const dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-9) continue;
        const r = R[c];
        let s = ((d - r) / (d * ws)) * K[c];
        if (d < r) s *= C[c];
        p[ia] += dx * s * wa; p[ia + 1] += dy * s * wa; p[ia + 2] += dz * s * wa;
        p[ib] -= dx * s * wb; p[ib + 1] -= dy * s * wb; p[ib + 2] -= dz * s * wb;
      }
    }
    _solveStack() {
      const st = this.stack, p = this.p, w = this.w;
      for (let c = 0; c < st.a.length; c++) {
        if (!st.on[c]) continue;
        const a = st.a[c], b = st.b[c], wa = w[a], wb = w[b], ws = wa + wb;
        if (ws === 0) continue;
        const ia = a * 3, ib = b * 3;
        const dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz), r = st.r[c];
        if (d > r * 4 + 0.03) { st.on[c] = 0; continue; } // pulled apart: the fold opens
        if (d < 1e-9) continue;
        const s = ((d - r) / (d * ws)) * 0.5;
        p[ia] += dx * s * wa; p[ia + 1] += dy * s * wa; p[ia + 2] += dz * s * wa;
        p[ib] -= dx * s * wb; p[ib + 1] -= dy * s * wb; p[ib + 2] -= dz * s * wb;
      }
    }
    _solveVolume() {
      const t = this.tris, p = this.p, w = this.w, G = this.vol.g;
      G.fill(0);
      let V = 0;
      for (let i = 0; i < t.length; i += 3) {
        const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
        const ax = p[a], ay = p[a + 1], az = p[a + 2], bx = p[b], by = p[b + 1], bz = p[b + 2], cx = p[c], cy = p[c + 1], cz = p[c + 2];
        V += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
        G[a] += by * cz - bz * cy; G[a + 1] += bz * cx - bx * cz; G[a + 2] += bx * cy - by * cx;
        G[b] += cy * az - cz * ay; G[b + 1] += cz * ax - cx * az; G[b + 2] += cx * ay - cy * ax;
        G[c] += ay * bz - az * by; G[c + 1] += az * bx - ax * bz; G[c + 2] += ax * by - ay * bx;
      }
      V /= 6;
      let den = 0;
      for (let i = 0; i < this.n; i++) { const k = i * 3; den += w[i] * (G[k] * G[k] + G[k + 1] * G[k + 1] + G[k + 2] * G[k + 2]) / 36; }
      if (den < 1e-12) return;
      const s = (-(V - this.vol.v0) / den) * this.vol.k / 6;
      for (let i = 0; i < this.n; i++) { const k = i * 3, wi = w[i] * s; p[k] += G[k] * wi; p[k + 1] += G[k + 1] * wi; p[k + 2] += G[k + 2] * wi; }
    }
    _collide(measure) {
      const n = this.n, p = this.p, q = this.q, w = this.w, cols = this.colliders, nc = cols.length, rad = this.radius, fr = this.friction;
      let maxMove = 0;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        if (w[i] !== 0) for (let c = 0; c < nc; c++) {
          if (!pushOut(cols[c], p, k, rad)) continue;
          // friction: remove part of the tangential motion
          const vx = p[k] - q[k], vy = p[k + 1] - q[k + 1], vz = p[k + 2] - q[k + 2];
          const vn = vx * _hit.x + vy * _hit.y + vz * _hit.z;
          q[k] += (vx - vn * _hit.x) * fr; q[k + 1] += (vy - vn * _hit.y) * fr; q[k + 2] += (vz - vn * _hit.z) * fr;
        }
        if (measure) {
          const dx = p[k] - q[k], dy = p[k + 1] - q[k + 1], dz = p[k + 2] - q[k + 2], m = dx * dx + dy * dy + dz * dz;
          if (m > maxMove) maxMove = m;
        }
      }
      return Math.sqrt(maxMove);
    }
    // self-collision on a hashed grid; particles near each other in the
    // sewing pattern are skipped (they are already held by constraints)
    _initSelf() {
      const T = 1 << Math.ceil(Math.log2(this.n * 2));
      this.hashHead = new Int32Array(T); this.hashNext = new Int32Array(this.n); this.hashMask = T - 1;
    }
    _selfCollide() {
      const p = this.p, w = this.w, n = this.n, D = this.selfDist, inv = 1 / D, head = this.hashHead, next = this.hashNext, M = this.hashMask;
      const gu = this.gu, gv = this.gv, pan = this.panel;
      const cell = (x, y, z) => ((Math.imul(x, 92837111) ^ Math.imul(y, 689287499) ^ Math.imul(z, 283923481)) >>> 0) & M;
      head.fill(-1);
      for (let i = 0; i < n; i++) {
        const k = i * 3, h = cell(Math.floor(p[k] * inv), Math.floor(p[k + 1] * inv), Math.floor(p[k + 2] * inv));
        next[i] = head[h]; head[h] = i;
      }
      const D2 = D * D;
      for (let i = 0; i < n; i++) {
        const k = i * 3, cx = Math.floor(p[k] * inv), cy = Math.floor(p[k + 1] * inv), cz = Math.floor(p[k + 2] * inv);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
          for (let j = head[cell(cx + ox, cy + oy, cz + oz)]; j >= 0; j = next[j]) {
            if (j <= i) continue;
            if (pan[i] === pan[j] && Math.abs(gu[i] - gu[j]) <= 2 && Math.abs(gv[i] - gv[j]) <= 2) continue;
            const kj = j * 3, dx = p[kj] - p[k], dy = p[kj + 1] - p[k + 1], dz = p[kj + 2] - p[k + 2], d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= D2 || d2 < 1e-12) continue;
            const ws = w[i] + w[j];
            if (!ws) continue;
            const d = Math.sqrt(d2), s = (D - d) / (d * ws);
            p[k] -= dx * s * w[i]; p[k + 1] -= dy * s * w[i]; p[k + 2] -= dz * s * w[i];
            p[kj] += dx * s * w[j]; p[kj + 1] += dy * s * w[j]; p[kj + 2] += dz * s * w[j];
          }
        }
      }
    }

    // pinch: grab every particle within `radius` of a point
    grabStart(pt, radius) {
      const p = this.p, idx = [], off = [];
      for (let i = 0; i < this.n; i++) {
        const k = i * 3, dx = p[k] - pt.x, dy = p[k + 1] - pt.y, dz = p[k + 2] - pt.z;
        if (dx * dx + dy * dy + dz * dz < radius * radius) { idx.push(i); off.push(dx * 0.5, dy * 0.5, dz * 0.5); this.w[i] = 0; }
      }
      this.grabbed = idx.length ? { idx, off } : null;
      this.wake();
      return !!this.grabbed;
    }
    grabMove(pt) {
      const g = this.grabbed;
      if (!g) return;
      const p = this.p;
      for (let j = 0; j < g.idx.length; j++) {
        const k = g.idx[j] * 3;
        p[k] = pt.x + g.off[j * 3]; p[k + 1] = pt.y + g.off[j * 3 + 1]; p[k + 2] = pt.z + g.off[j * 3 + 2];
      }
      this.wake();
    }
    grabEnd() {
      if (!this.grabbed) return;
      for (const i of this.grabbed.idx) this.w[i] = this.w0[i];
      this.grabbed = null;
      this.wake();
    }
  }

  // ------------------------------------------------------ cloth builders
  // A rectangular piece W x H (m) as an nx x ny particle grid. Particle
  // (i, j) has flat coordinates (i*dx, j*dy); i runs along the width.
  function gridSize(W, H, maxP, minDx) {
    const dx = Math.max(minDx, Math.sqrt((W * H) / maxP));
    return [Math.max(4, Math.round(W / dx) + 1), Math.max(4, Math.round(H / dx) + 1)];
  }
  function gridTris(nx, ny, idx) {
    const t = new Uint32Array((nx - 1) * (ny - 1) * 6), I = idx || ((i) => i);
    let o = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = I[j * nx + i] ?? j * nx + i, b = I[j * nx + i + 1] ?? j * nx + i + 1, c = I[(j + 1) * nx + i] ?? (j + 1) * nx + i, d = I[(j + 1) * nx + i + 1] ?? (j + 1) * nx + i + 1;
      t[o++] = a; t[o++] = c; t[o++] = b; t[o++] = b; t[o++] = c; t[o++] = d;
    }
    return t;
  }
  function addGridConstraints(cl, nx, ny, idx, ph, elastic) {
    const I = (i, j) => idx[j * nx + i];
    const kb = ph.bend;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const edgeRow = j === 0 || j === ny - 1, edgeCol = i === 0 || i === nx - 1;
      if (i < nx - 1) cl.add(I(i, j), I(i + 1, j), 1, 0, elastic && edgeRow ? cl.flatDist(I(i, j), I(i + 1, j)) * elastic : undefined);
      if (j < ny - 1) cl.add(I(i, j), I(i, j + 1), 1, 0, elastic && edgeCol ? cl.flatDist(I(i, j), I(i, j + 1)) * elastic : undefined);
      if (i < nx - 1 && j < ny - 1) { cl.add(I(i, j), I(i + 1, j + 1), 0.8, 1); cl.add(I(i + 1, j), I(i, j + 1), 0.8, 1); }
      if (i < nx - 2) cl.add(I(i, j), I(i + 2, j), kb, 2);
      if (j < ny - 2) cl.add(I(i, j), I(i, j + 2), kb, 2);
    }
  }
  // Folding: reflect the flat pattern about fold lines, stacking layers.
  // Returns per-particle planar position and layer rank.
  function foldLayout(cl, folds) {
    const n = cl.n, X = new Float32Array(n), Y = new Float32Array(n), key = new Float64Array(n);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) { X[i] = cl.flat[i * 2]; Y[i] = cl.flat[i * 2 + 1]; x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]); }
    let L = 1;
    for (const f of folds) {
      const A = f.axis === 'x' ? X : Y, lo = f.axis === 'x' ? x0 : y0, hi = f.axis === 'x' ? x1 : y1;
      const c = lo + (hi - lo) * f.at, high = f.side > 0;
      for (let i = 0; i < n; i++) if (high ? A[i] > c + 1e-6 : A[i] < c - 1e-6) { A[i] = 2 * c - A[i]; key[i] = 2 * L - 1 - key[i]; }
      const nlo = high ? Math.min(lo, 2 * c - hi) : c, nhi = high ? c : Math.max(hi, 2 * c - lo);
      if (f.axis === 'x') { x0 = nlo; x1 = nhi; } else { y0 = nlo; y1 = nhi; }
      L *= 2;
    }
    const keys = [...new Set(key)].sort((a, b) => a - b), rank = new Uint8Array(n);
    for (let i = 0; i < n; i++) rank[i] = keys.indexOf(key[i]);
    return { X, Y, rank, layers: keys.length, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }
  // spacers between stacked layers so a folded towel keeps its folds until pulled
  function stackSpacers(cl, lay, dx, gap) {
    const a = [], b = [], r = [];
    const byRank = [];
    for (let i = 0; i < cl.n; i++) (byRank[lay.rank[i]] || (byRank[lay.rank[i]] = [])).push(i);
    for (let rk = 1; rk < byRank.length; rk++) {
      const below = byRank[rk - 1] || [];
      for (const i of byRank[rk] || []) {
        let best = -1, bd = dx * 0.75;
        for (const j of below) { const d = Math.hypot(lay.X[i] - lay.X[j], lay.Y[i] - lay.Y[j]); if (d < bd) { bd = d; best = j; } }
        if (best >= 0) { a.push(best); b.push(i); r.push(gap); }
      }
    }
    if (a.length) cl.setStack(a, b, r);
  }

  // ------------------------------------------------- cloth render skin
  // Draws a grid cloth with real thickness: front and back surfaces offset
  // along the normal plus an edge band, refined 2x with the 4-point
  // interpolating scheme on 'high' for smooth silhouettes. Vertex colours
  // carry fold occlusion from the simulated curvature.
  function fourPt(a, b, c, d, hasA, hasD) {
    if (!hasA) a = 2 * b - c;
    if (!hasD) d = 2 * c - b;
    return (-a + 9 * b + 9 * c - d) / 16;
  }
  class GridSkin {
    constructor(opts) {
      const { nx, ny, idx, W, H, refine, thick, mirrorU } = opts;
      Object.assign(this, { nx, ny, idx, W, H, f: refine, thick, solid: thick > 0 });
      const FX = (this.FX = (nx - 1) * refine + 1), FY = (this.FY = (ny - 1) * refine + 1), NF = FX * FY;
      this.src = new Float32Array(nx * ny * 3);
      this.P = new Float32Array(NF * 3);
      this.N = new Float32Array(NF * 3);
      this.AO = new Float32Array(NF);
      // boundary loop of the fine grid (counter-clockwise from above)
      const ring = [];
      for (let i = 0; i < FX; i++) ring.push([i, 0, i, 1]);
      for (let j = 1; j < FY; j++) ring.push([FX - 1, j, FX - 2, j]);
      for (let i = FX - 2; i >= 0; i--) ring.push([i, FY - 1, i, FY - 2]);
      for (let j = FY - 2; j >= 1; j--) ring.push([0, j, 1, j]);
      this.ring = ring.map(([i, j, ii, jj]) => [j * FX + i, jj * FX + ii]);
      const B = this.ring.length, nv = this.solid ? NF * 2 + B * 2 : NF;
      const geo = (this.geo = new THREE.BufferGeometry());
      this.pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
      this.nor = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
      this.col = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
      for (const a of [this.pos, this.nor, this.col]) a.setUsage(THREE.DynamicDrawUsage);
      const uv = new Float32Array(nv * 2);
      for (let j = 0; j < FY; j++) for (let i = 0; i < FX; i++) {
        const v = j * FX + i, u = (i / (FX - 1)) * W;
        uv[v * 2] = mirrorU ? W - u : u; uv[v * 2 + 1] = (j / (FY - 1)) * H;
      }
      if (this.solid) {
        uv.copyWithin(NF * 2, 0, NF * 2);
        for (let k = 0; k < B; k++) for (const s of [0, 1]) { const v = NF * 2 + k * 2 + s, o = this.ring[k][0]; uv[v * 2] = uv[o * 2]; uv[v * 2 + 1] = uv[o * 2 + 1]; }
      }
      geo.setAttribute('position', this.pos);
      geo.setAttribute('normal', this.nor);
      geo.setAttribute('color', this.col);
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const ix = [];
      for (let j = 0; j < FY - 1; j++) for (let i = 0; i < FX - 1; i++) {
        const a = j * FX + i, b = a + 1, c = a + FX, d = c + 1;
        ix.push(a, c, b, b, c, d);
        if (this.solid) ix.push(NF + a, NF + b, NF + c, NF + b, NF + d, NF + c);
      }
      if (this.solid) for (let k = 0; k < B; k++) {
        const k2 = (k + 1) % B, fa = NF * 2 + k * 2, fb = NF * 2 + k2 * 2;
        ix.push(fa, fb, fa + 1, fb, fb + 1, fa + 1);
      }
      geo.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(ix, 1) : new THREE.Uint16BufferAttribute(ix, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    }
    // gather the simulated grid and refine it
    sample(p) {
      const { nx, ny, idx, src, P, FX } = this;
      for (let g = 0; g < nx * ny; g++) { const k = idx[g] * 3; src[g * 3] = p[k]; src[g * 3 + 1] = p[k + 1]; src[g * 3 + 2] = p[k + 2]; }
      if (this.f === 1) { P.set(src); return; }
      for (let j = 0; j < ny; j++) {
        const fr = 2 * j * FX;
        for (let i = 0; i < nx; i++) for (let c = 0; c < 3; c++) P[(fr + 2 * i) * 3 + c] = src[(j * nx + i) * 3 + c];
        for (let i = 0; i < nx - 1; i++) for (let c = 0; c < 3; c++) {
          const s = (ii) => src[(j * nx + clamp(ii, 0, nx - 1)) * 3 + c];
          P[(fr + 2 * i + 1) * 3 + c] = fourPt(s(i - 1), s(i), s(i + 1), s(i + 2), i > 0, i + 2 < nx);
        }
      }
      for (let j = 0; j < ny - 1; j++) for (let x = 0; x < FX; x++) for (let c = 0; c < 3; c++) {
        const s = (jj) => P[(2 * clamp(jj, 0, ny - 1) * FX + x) * 3 + c];
        P[((2 * j + 1) * FX + x) * 3 + c] = fourPt(s(j - 1), s(j), s(j + 1), s(j + 2), j > 0, j + 2 < ny);
      }
    }
    // normals by central differences, fold occlusion by curvature
    shade() {
      const { P, N, AO, FX, FY } = this;
      const sp = this.W / (FX - 1);
      for (let j = 0; j < FY; j++) for (let i = 0; i < FX; i++) {
        const v = j * FX + i, l = (j * FX + Math.max(0, i - 1)) * 3, r = (j * FX + Math.min(FX - 1, i + 1)) * 3;
        const d = (Math.max(0, j - 1) * FX + i) * 3, u = (Math.min(FY - 1, j + 1) * FX + i) * 3;
        const ax = P[r] - P[l], ay = P[r + 1] - P[l + 1], az = P[r + 2] - P[l + 2];
        const bx = P[u] - P[d], by = P[u + 1] - P[d + 1], bz = P[u + 2] - P[d + 2];
        let nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        N[v * 3] = nx; N[v * 3 + 1] = ny; N[v * 3 + 2] = nz;
        const k = v * 3, lx = (P[l] + P[r] + P[d] + P[u]) / 4 - P[k], ly = (P[l + 1] + P[r + 1] + P[d + 1] + P[u + 1]) / 4 - P[k + 1], lz = (P[l + 2] + P[r + 2] + P[d + 2] + P[u + 2]) / 4 - P[k + 2];
        AO[v] = (lx * nx + ly * ny + lz * nz) / sp;
      }
    }
    update(p) {
      this.sample(p);
      this.shade();
      const { P, N, AO, FX, FY, solid } = this, NF = FX * FY, pos = this.pos.array, nor = this.nor.array, col = this.col.array;
      const t2 = this.thick / 2;
      for (let v = 0; v < NF; v++) {
        const k = v * 3, c = AO[v];
        const front = 1 - clamp(c * 2.2, 0, 0.5), back = 1 - clamp(-c * 2.2, 0, 0.5);
        pos[k] = P[k] + N[k] * t2; pos[k + 1] = P[k + 1] + N[k + 1] * t2; pos[k + 2] = P[k + 2] + N[k + 2] * t2;
        nor[k] = N[k]; nor[k + 1] = N[k + 1]; nor[k + 2] = N[k + 2];
        col[k] = col[k + 1] = col[k + 2] = front;
        if (solid) {
          const b = (NF + v) * 3;
          pos[b] = P[k] - N[k] * t2; pos[b + 1] = P[k + 1] - N[k + 1] * t2; pos[b + 2] = P[k + 2] - N[k + 2] * t2;
          nor[b] = -N[k]; nor[b + 1] = -N[k + 1]; nor[b + 2] = -N[k + 2];
          col[b] = col[b + 1] = col[b + 2] = back;
        }
      }
      if (solid) {
        const ring = this.ring, B = ring.length;
        for (let e = 0; e < B; e++) {
          const [o, inn] = ring[e], k = o * 3, ki = inn * 3, f = (NF * 2 + e * 2) * 3;
          let ox = P[k] - P[ki], oy = P[k + 1] - P[ki + 1], oz = P[k + 2] - P[ki + 2];
          const dn = ox * N[k] + oy * N[k + 1] + oz * N[k + 2];
          ox -= dn * N[k]; oy -= dn * N[k + 1]; oz -= dn * N[k + 2];
          const l = Math.hypot(ox, oy, oz) || 1;
          for (let s = 0; s < 2; s++) {
            const src = (s ? NF + o : o) * 3, dst = f + s * 3;
            pos[dst] = pos[src]; pos[dst + 1] = pos[src + 1]; pos[dst + 2] = pos[src + 2];
            nor[dst] = ox / l; nor[dst + 1] = oy / l; nor[dst + 2] = oz / l;
            col[dst] = col[dst + 1] = col[dst + 2] = 0.82;
          }
        }
      }
      this.pos.needsUpdate = this.nor.needsUpdate = this.col.needsUpdate = true;
    }
    dispose() { this.geo.dispose(); }
  }

  // Fringe on the ends of a throw: short twisted yarn tassels, each a tiny
  // verlet rope hanging from the hem, drawn as camera-facing ribbons.
  class Fringe {
    constructor(skin, opts) {
      this.skin = skin;
      const { FX, FY } = skin;
      const count = Math.max(4, Math.round(skin.W / opts.spacing));
      this.segs = opts.segs; this.seg = opts.length / opts.segs; this.width = opts.width;
      this.roots = [];
      for (const j of [0, FY - 1]) for (let c = 0; c < count; c++) {
        const i = Math.round(((c + 0.5) / count) * (FX - 1));
        this.roots.push([j * FX + i, (j === 0 ? 1 : FY - 2) * FX + i]);
      }
      const R = this.roots.length, S = this.segs + 1;
      this.p = new Float32Array(R * S * 3); this.q = new Float32Array(R * S * 3);
      this.dir = new Float32Array(R * 3);
      const nv = R * S * 2, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), ix = [];
      for (let r = 0; r < R; r++) for (let s = 0; s < S; s++) {
        const v = (r * S + s) * 2;
        uv[v * 2] = 0; uv[v * 2 + 1] = s / this.segs; uv[v * 2 + 2] = 1; uv[v * 2 + 3] = s / this.segs;
        if (s < this.segs) ix.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
      const geo = (this.geo = new THREE.BufferGeometry());
      this.pos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
      this.nor = new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', this.pos); geo.setAttribute('normal', this.nor); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(ix);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
      this.init = false;
    }
    _root(r, out) {
      const P = this.skin.P, [o, inn] = this.roots[r], k = o * 3, ki = inn * 3;
      let dx = P[k] - P[ki], dy = P[k + 1] - P[ki + 1], dz = P[k + 2] - P[ki + 2];
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      out[0] = P[k] + dx * 0.002; out[1] = P[k + 1] + dy * 0.002; out[2] = P[k + 2] + dz * 0.002;
      this.dir[r * 3] = dx; this.dir[r * 3 + 1] = dy; this.dir[r * 3 + 2] = dz;
    }
    update(dt, colliders, cam) {
      const S = this.segs + 1, p = this.p, q = this.q, seg = this.seg, R = this.roots.length, root = [0, 0, 0];
      const sub = 3, h = dt / sub, g = -9.81 * h * h;
      for (let r = 0; r < R; r++) {
        this._root(r, root);
        const b = r * S * 3, dx = this.dir[r * 3], dy = this.dir[r * 3 + 1], dz = this.dir[r * 3 + 2];
        if (!this.init) for (let s = 0; s < S; s++) {
          const k = b + s * 3;
          p[k] = q[k] = root[0] + dx * seg * s; p[k + 1] = q[k + 1] = root[1] + dy * seg * s - 0.001 * s; p[k + 2] = q[k + 2] = root[2] + dz * seg * s;
        }
        for (let it = 0; it < sub; it++) {
          p[b] = q[b] = root[0]; p[b + 1] = q[b + 1] = root[1]; p[b + 2] = q[b + 2] = root[2];
          for (let s = 1; s < S; s++) {
            const k = b + s * 3;
            const vx = (p[k] - q[k]) * 0.985, vy = (p[k + 1] - q[k + 1]) * 0.985, vz = (p[k + 2] - q[k + 2]) * 0.985;
            q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
            p[k] += vx; p[k + 1] += vy + g; p[k + 2] += vz;
          }
          // yarn stiffness: the first segment leaves the hem straight out
          const k1 = b + 3;
          p[k1] += (root[0] + dx * seg - p[k1]) * 0.5; p[k1 + 1] += (root[1] + dy * seg - p[k1 + 1]) * 0.5; p[k1 + 2] += (root[2] + dz * seg - p[k1 + 2]) * 0.5;
          for (let pass = 0; pass < 2; pass++) for (let s = 1; s < S; s++) {
            const ka = b + (s - 1) * 3, kb = b + s * 3;
            const ex = p[kb] - p[ka], ey = p[kb + 1] - p[ka + 1], ez = p[kb + 2] - p[ka + 2], d = Math.hypot(ex, ey, ez) || 1e-6;
            const c = (d - seg) / d, wa = s === 1 ? 0 : 0.5, wb = s === 1 ? 1 : 0.5;
            p[ka] += ex * c * wa; p[ka + 1] += ey * c * wa; p[ka + 2] += ez * c * wa;
            p[kb] -= ex * c * wb; p[kb + 1] -= ey * c * wb; p[kb + 2] -= ez * c * wb;
          }
          for (let s = 2; s < S; s++) for (const c of colliders) if (pushOut(c, p, b + s * 3, 0.0015)) {
            const k = b + s * 3;
            q[k] += (p[k] - q[k]) * 0.6; q[k + 1] += (p[k + 1] - q[k + 1]) * 0.6; q[k + 2] += (p[k + 2] - q[k + 2]) * 0.6;
          }
        }
      }
      this.init = true;
      this.draw(cam);
    }
    draw(cam) {
      const S = this.segs + 1, p = this.p, pos = this.pos.array, nor = this.nor.array, hw = this.width / 2, R = this.roots.length;
      const cx = cam.x, cy = cam.y, cz = cam.z;
      for (let r = 0; r < R; r++) for (let s = 0; s < S; s++) {
        const k = (r * S + s) * 3, ka = (r * S + Math.max(0, s - 1)) * 3, kb = (r * S + Math.min(S - 1, s + 1)) * 3;
        const tx = p[kb] - p[ka], ty = p[kb + 1] - p[ka + 1], tz = p[kb + 2] - p[ka + 2];
        const vx = cx - p[k], vy = cy - p[k + 1], vz = cz - p[k + 2];
        let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
        const l = Math.hypot(sx, sy, sz) || 1;
        // tassels taper a little towards the tip
        const w = hw * (1 - 0.35 * (s / this.segs)) / l;
        sx *= w; sy *= w; sz *= w;
        const v = (r * S + s) * 2 * 3, vl = Math.hypot(vx, vy, vz) || 1;
        pos[v] = p[k] - sx; pos[v + 1] = p[k + 1] - sy; pos[v + 2] = p[k + 2] - sz;
        pos[v + 3] = p[k] + sx; pos[v + 4] = p[k + 1] + sy; pos[v + 5] = p[k + 2] + sz;
        nor[v] = nor[v + 3] = vx / vl; nor[v + 1] = nor[v + 4] = vy / vl; nor[v + 2] = nor[v + 5] = vz / vl;
      }
      this.pos.needsUpdate = this.nor.needsUpdate = true;
    }
    dispose() { this.geo.dispose(); }
  }

  // Piping: a corded tube sewn into a pillow's seam.
  class Piping {
    constructor(ring, radius, sides) {
      this.ring = ring; this.r = radius; this.sides = sides;
      const R = ring.length, nv = R * sides, ix = [];
      for (let k = 0; k < R; k++) for (let s = 0; s < sides; s++) {
        const a = k * sides + s, b = k * sides + ((s + 1) % sides), c = ((k + 1) % R) * sides + s, d = ((k + 1) % R) * sides + ((s + 1) % sides);
        ix.push(a, c, b, b, c, d);
      }
      const geo = (this.geo = new THREE.BufferGeometry());
      this.pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
      this.nor = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const uv = new Float32Array(nv * 2);
      let L = 0;
      for (let k = 0; k < R; k++) for (let s = 0; s < sides; s++) { uv[(k * sides + s) * 2] = k * 0.008; uv[(k * sides + s) * 2 + 1] = (s / sides) * 0.03; }
      geo.setAttribute('position', this.pos); geo.setAttribute('normal', this.nor); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(ix);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
      this.L = L;
    }
    update(p, centre) {
      const R = this.ring.length, S = this.sides, pos = this.pos.array, nor = this.nor.array, r = this.r;
      for (let k = 0; k < R; k++) {
        const a = this.ring[(k + R - 1) % R] * 3, b = this.ring[(k + 1) % R] * 3, o = this.ring[k] * 3;
        let tx = p[b] - p[a], ty = p[b + 1] - p[a + 1], tz = p[b + 2] - p[a + 2];
        let l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
        // outward reference from the pillow's centre
        let ox = p[o] - centre.x, oy = p[o + 1] - centre.y, oz = p[o + 2] - centre.z;
        const d = ox * tx + oy * ty + oz * tz; ox -= d * tx; oy -= d * ty; oz -= d * tz;
        l = Math.hypot(ox, oy, oz) || 1; ox /= l; oy /= l; oz /= l;
        const bx = ty * oz - tz * oy, by = tz * ox - tx * oz, bz = tx * oy - ty * ox;
        for (let s = 0; s < S; s++) {
          const ang = (s / S) * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
          const nx = ox * c + bx * sn, ny = oy * c + by * sn, nz = oz * c + bz * sn, v = (k * S + s) * 3;
          pos[v] = p[o] + nx * r + ox * r * 0.4; pos[v + 1] = p[o + 1] + ny * r + oy * r * 0.4; pos[v + 2] = p[o + 2] + nz * r + oz * r * 0.4;
          nor[v] = nx; nor[v + 1] = ny; nor[v + 2] = nz;
        }
      }
      this.pos.needsUpdate = this.nor.needsUpdate = true;
    }
    dispose() { this.geo.dispose(); }
  }

  // ------------------------------------------------------------- mat
  // Yoga and massage mats are foam, not cloth: an analytic roll along an
  // Archimedean spiral (one thickness per turn), animated between flat and rolled.
  class RollMat {
    constructor(L, Wd, t, opts) {
      Object.assign(this, { L, Wd, t, roll: opts.roll || 0, goal: opts.roll || 0, core: Math.max(0.025, t * 4) });
      const NL = (this.NL = opts.segments), NW = (this.NW = 8);
      this.line = new Float32Array((NL + 1) * 4); // x, y, normal x, normal y per station
      // vertex layout: top, bottom, two side walls, two end caps
      const top = (NL + 1) * (NW + 1), side = (NL + 1) * 2, cap = (NW + 1) * 2, nv = top * 2 + side * 2 + cap * 2;
      const geo = (this.geo = new THREE.BufferGeometry());
      this.pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
      this.nor = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const uv = new Float32Array(nv * 2), ixA = [], ixB = [];
      const S = (i) => (i / NL) * L, Z = (j) => (j / NW - 0.5) * Wd;
      let v = 0;
      this.off = {};
      for (const face of ['top', 'bottom']) {
        this.off[face] = v;
        for (let i = 0; i <= NL; i++) for (let j = 0; j <= NW; j++, v++) { uv[v * 2] = S(i); uv[v * 2 + 1] = Z(j) + Wd / 2; }
        const o = this.off[face];
        for (let i = 0; i < NL; i++) for (let j = 0; j < NW; j++) {
          const a = o + i * (NW + 1) + j, b = a + 1, c = a + NW + 1, d = c + 1;
          if (face === 'top') ixA.push(a, b, c, b, d, c); else ixA.push(a, c, b, b, c, d);
        }
      }
      for (const sgn of [-1, 1]) {
        this.off['side' + sgn] = v;
        for (let i = 0; i <= NL; i++) for (let s = 0; s < 2; s++, v++) { uv[v * 2] = S(i); uv[v * 2 + 1] = s * t; }
        const o = this.off['side' + sgn];
        for (let i = 0; i < NL; i++) {
          const a = o + i * 2, b = a + 1, c = a + 2, d = a + 3;
          if (sgn > 0) ixB.push(a, b, c, b, d, c); else ixB.push(a, c, b, b, c, d);
        }
      }
      for (const end of [0, 1]) {
        this.off['cap' + end] = v;
        for (let j = 0; j <= NW; j++) for (let s = 0; s < 2; s++, v++) { uv[v * 2] = Z(j); uv[v * 2 + 1] = s * t; }
        const o = this.off['cap' + end];
        for (let j = 0; j < NW; j++) {
          const a = o + j * 2, b = a + 1, c = a + 2, d = a + 3;
          if (end) ixB.push(a, c, b, b, c, d); else ixB.push(a, b, c, b, d, c);
        }
      }
      geo.setAttribute('position', this.pos); geo.setAttribute('normal', this.nor); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex([...ixA, ...ixB]);
      geo.addGroup(0, ixA.length, 0);
      geo.addGroup(ixA.length, ixB.length, 1);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5);
      this.build();
    }
    // centreline of the mat for the current roll fraction
    centre() {
      const { L, t, NL, line } = this, R0 = this.core, ell = clamp(this.roll, 0, 1) * L, xr = L - ell, a = t / (4 * Math.PI);
      const thMax = ell > 1e-5 ? (-R0 + Math.sqrt(R0 * R0 + 4 * a * ell)) / (2 * a) : 0;
      const Rout = R0 + (t * thMax) / (2 * Math.PI), cy = t / 2 + Rout;
      for (let i = 0; i <= NL; i++) {
        const s = (i / NL) * L, k = i * 4;
        if (s <= xr) { line[k] = s; line[k + 1] = t / 2; line[k + 2] = 0; line[k + 3] = 1; continue; }
        const inner = ell - (s - xr), th = (-R0 + Math.sqrt(R0 * R0 + 4 * a * Math.max(0, inner))) / (2 * a), psi = thMax - th, r = R0 + (t * th) / (2 * Math.PI);
        line[k] = xr + r * Math.sin(psi); line[k + 1] = cy - r * Math.cos(psi);
        line[k + 2] = -Math.sin(psi); line[k + 3] = Math.cos(psi);
      }
      this.radius = Rout;
    }
    build() {
      this.centre();
      const { NL, NW, line, Wd, t, L } = this, pos = this.pos.array, nor = this.nor.array, h = t / 2;
      const put = (v, x, y, z, nx, ny, nz) => { pos[v * 3] = x - L / 2; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z; nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz; };
      for (let i = 0; i <= NL; i++) {
        const k = i * 4, x = line[k], y = line[k + 1], nx = line[k + 2], ny = line[k + 3];
        // tangent of the centreline for the side walls
        for (let j = 0; j <= NW; j++) {
          const z = (j / NW - 0.5) * Wd;
          put(this.off.top + i * (NW + 1) + j, x + nx * h, y + ny * h, z, nx, ny, 0);
          put(this.off.bottom + i * (NW + 1) + j, x - nx * h, y - ny * h, z, -nx, -ny, 0);
        }
        for (const sgn of [-1, 1]) for (let s = 0; s < 2; s++) {
          const o = s ? h : -h;
          put(this.off['side' + sgn] + i * 2 + s, x + nx * o, y + ny * o, (sgn * Wd) / 2, 0, 0, sgn);
        }
      }
      for (const end of [0, 1]) {
        const i = end ? NL : 0, k = i * 4, x = line[k], y = line[k + 1], nx = line[k + 2], ny = line[k + 3];
        const ia = end ? NL - 1 : 1, ka = ia * 4;
        let tx = x - line[ka], ty = y - line[ka + 1];
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        for (let j = 0; j <= NW; j++) for (let s = 0; s < 2; s++) {
          const o = s ? h : -h;
          put(this.off['cap' + end] + j * 2 + s, x + nx * o, y + ny * o, (j / NW - 0.5) * Wd, tx, ty, 0);
        }
      }
      this.pos.needsUpdate = this.nor.needsUpdate = true;
    }
    update(dt) {
      if (Math.abs(this.goal - this.roll) < 1e-4) return false;
      const speed = 0.55 / Math.max(0.5, this.L / 1.8);
      this.roll += clamp(this.goal - this.roll, -speed * dt, speed * dt);
      this.build();
      return true;
    }
    dispose() { this.geo.dispose(); }
  }

  BS.Textiles = Object.assign(BS.Textiles || {}, {
    material, fallbackMaterial, addTextileDetail, paintPattern, fabricTypes, fabricPatterns, PHYS, phys, Cloth, GridSkin, Fringe, Piping, RollMat,
    makeCollider, pushOut, gridSize, gridTris, addGridConstraints, foldLayout, stackSpacers, store, rng, clamp, lerp, sstep, hexRgb, mixRgb, css, canvas2d, fbm, tnoise,
    FABRICS, PATTERNS, PATTERN_TILE, disposeMaterial,
  });
})();
