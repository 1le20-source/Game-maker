// Body Studio UI: header, editor panel and view controls over the 3D view.
//
// Controls edit app.params in place. Edits are coalesced into one apply per
// animation frame: a full re-shape (app.setParams) only when a shape param
// changed, otherwise just the modules' onParams. Undo snapshots are taken
// when a gesture ends ('change'), and the character is autosaved. Controls
// that depend on a module (motion, hair, clothing, anatomy) only appear when
// that module provides what they need.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});

  const K = {
    current: 'bodystudio.current', saves: 'bodystudio.saves', roster: 'bodystudio.roster',
    therapist: 'bodystudio.therapist', wardrobe: 'bodystudio.wardrobe', ui: 'bodystudio.ui',
  };
  // params that change the mesh; everything else only needs the modules' onParams
  const SHAPE = new Set(['gender', 'age', 'muscle', 'weight', 'height', 'heightCm', 'heightScale', 'proportions',
    'african', 'asian', 'caucasian', 'breastSize', 'breastFirmness', 'details']);
  // params nothing renders
  const META = new Set(['name', 'pronouns', 'identity', '_id']);
  const TABS = ['Body', 'Face', 'Skin', 'Hair', 'Eyes', 'Outfit', 'Motion', 'Emotion', 'Inside'];
  const TAB_CAM = { Body: 'body', Face: 'face', Hair: 'upper', Eyes: 'faceFront', Outfit: 'body', Motion: 'body', Emotion: 'upper', Inside: 'body' };
  const VIEWS = [['front', 'Front'], ['side', 'Side'], ['back', 'Back'], ['face', 'Face'], ['full', 'Full body']];
  const HAIR_STYLES = ['bald', 'buzz', 'crew', 'short', 'medium', 'bob', 'long', 'wavy', 'curly', 'afro', 'ponytail', 'bun', 'braid'];
  const BEARDS = ['none', 'stubble', 'short', 'full', 'goatee', 'mustache'];
  const OUTFITS = ['underwear', 'sport', 'casual', 'dress', 'formal', 'scrubs'];
  const OUTFIT_COLORS = ['#1e1e22', '#2d3646', '#3b5c8a', '#2f5a4a', '#6b2d3a', '#a33b2a', '#7a6a9a', '#c9b79c', '#e8e2d6', '#f2efe9'];
  const PRONOUNS = ['she/her', 'he/him', 'they/them', 'she/they', 'he/they', 'xe/xem', 'ze/hir', 'any pronouns'];

  // ------------------------------------------------------------ helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const uid = () => 'bs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const idOf = (x) => (typeof x === 'string' ? x : x.id);
  const labelOf = (x) => (typeof x === 'string' ? cap(x) : x.label || cap(x.id));
  const pct = (v) => Math.round(v * 100) + '%';
  const signed = (v) => (v > 0.005 ? '+' : v < -0.005 ? '−' : '') + Math.round(Math.abs(v) * 100);
  const ftIn = (cm) => { const i = Math.round(cm / 2.54), f = Math.floor(i / 12); return f + '′' + (i - f * 12) + '″'; };
  const slug = (s) => String(s || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
  // standard normal CDF (Abramowitz & Stegun 26.2.17)
  const phi = (z) => {
    const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  };
  const when = (ts) => {
    const d = new Date(ts), now = new Date();
    return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }

  // storage never throws: private mode, quota and disabled storage all fall back
  const store = {
    get(k, d) { try { const s = localStorage.getItem(k); return s == null ? d : JSON.parse(s); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  };

  // ------------------------------------------------------------ icons
  const I = {
    logo: '<circle cx="12" cy="5" r="2.2"/><path d="M8.2 9.4h7.6M12 9.4v5.4M9.4 21l2.6-6.2 2.6 6.2"/><ellipse cx="12" cy="13" rx="10" ry="3.6" class="orbit"/>',
    dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.2" class="fill"/><circle cx="15.5" cy="15.5" r="1.2" class="fill"/><circle cx="12" cy="12" r="1.2" class="fill"/><circle cx="15.5" cy="8.5" r="1.2" class="fill"/><circle cx="8.5" cy="15.5" r="1.2" class="fill"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    people: '<circle cx="9.5" cy="8" r="3.4"/><path d="M3.5 19.5v-1a4.5 4.5 0 0 1 4.5-4.5h3a4.5 4.5 0 0 1 4.5 4.5v1"/><path d="M15.5 4.6a3.4 3.4 0 0 1 0 6.8M18 14.2a4.5 4.5 0 0 1 2.5 4.1v1.2"/>',
    camera: '<path d="M3.5 8.5a2 2 0 0 1 2-2h2.3L9.3 4.5h5.4l1.5 2h2.3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.6"/>',
    play: '<path d="M8 5.2v13.6L19 12z" class="fill"/>',
    chev: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    spin: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 3.8v4.6h-4.6"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 3.8v4.8h4.8"/>',
    down: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
    up: '<path d="M12 15V4m-5 5 5-5 5 5M5 20h14"/>',
    save: '<path d="M6 3.5h12v17l-6-4-6 4z"/>',
    send: '<path d="M4 11.5 20 4l-7.5 16-2.2-6.3z"/><path d="m10.3 13.7 4.2-4.2"/>',
    lotus: '<path d="M12 19.5c-4.6 0-8-2.6-8.5-6.5 3.4-.2 6.6 1.4 8.5 4.2 1.9-2.8 5.1-4.4 8.5-4.2-.5 3.9-3.9 6.5-8.5 6.5z"/><path d="M12 16.8c-1.9-2.4-2.6-5.3-.1-9.8 2.6 4.4 1.9 7.4.1 9.8z"/>',
    panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
    hide: '<path d="m14.5 7-5 5 5 5"/>',
    ext: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
    // tabs
    Body: '<circle cx="12" cy="4.6" r="2.1"/><path d="M6 9.2c4 1.1 8 1.1 12 0M12 9.9v5.3M8.8 21l3.2-5.8 3.2 5.8"/>',
    Face: '<path d="M12 3.5c4.4 0 7 3.4 7 7.6 0 5.3-3.4 9.4-7 9.4s-7-4.1-7-9.4c0-4.2 2.6-7.6 7-7.6z"/><path d="M9.3 11v.6M14.7 11v.6M9.8 15.6c1.3 1 3.1 1 4.4 0"/>',
    Skin: '<path d="M12 3.5c3.2 3.8 5.8 6.9 5.8 10.1a5.8 5.8 0 0 1-11.6 0c0-3.2 2.6-6.3 5.8-10.1z"/><path d="M9.2 14.2a2.9 2.9 0 0 0 2.4 2.7"/>',
    Hair: '<path d="M5.5 14c0-5.6 2.9-9.5 6.5-9.5s6.5 3.9 6.5 9.5c0 3-.8 5.3-1.8 6.5M5.5 14c0 3 .8 5.3 1.8 6.5"/><path d="M8.2 8.6c2.3 2.3 5.6 3 9 2.6"/>',
    Eyes: '<path d="M2.8 12S6.3 6 12 6s9.2 6 9.2 6-3.5 6-9.2 6-9.2-6-9.2-6z"/><circle cx="12" cy="12" r="2.8"/>',
    Outfit: '<path d="M8.5 4 4 6.6l1.7 4 2.3-1V20h8V9.6l2.3 1 1.7-4L15.5 4c-.8 1.5-2 2.3-3.5 2.3S9.3 5.5 8.5 4z"/>',
    Motion: '<circle cx="14.2" cy="4.3" r="1.9"/><path d="m13.2 8.2-2.6 5.7 3.6 2.6.8 4.8M10.6 13.9 7.7 20.5M10.6 9.4l-3.4 2.4M13.2 8.2l2.8 3.2 3.2-.3"/>',
    Emotion: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.1a4.2 4.2 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"/>',
    Inside: '<path d="M12 3.5v17M7.2 7.3c2.4 1.1 7.2 1.1 9.6 0M6.6 11c2.7 1.3 8.1 1.3 10.8 0M7.2 14.7c2.4 1.1 7.2 1.1 9.6 0"/>',
  };
  const icon = (name, cls) => h('span', { class: 'bs-ic' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" focusable="false">' + I[name] + '</svg>' });

  // ------------------------------------------------------------ card art
  const f1 = (v) => Math.round(v * 10) / 10;
  // Catmull-Rom through the points, as cubic Béziers
  function smooth(pts, closed) {
    const n = pts.length, P = (i) => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
    let d = 'M' + f1(pts[0][0]) + ' ' + f1(pts[0][1]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = P(i - 1), b = P(i), c = P(i + 1), e = P(i + 2);
      d += 'C' + f1(b[0] + (c[0] - a[0]) / 6) + ' ' + f1(b[1] + (c[1] - a[1]) / 6) + ' ' + f1(c[0] - (e[0] - b[0]) / 6) + ' ' + f1(c[1] - (e[1] - b[1]) / 6) + ' ' + f1(c[0]) + ' ' + f1(c[1]);
    }
    return d + (closed ? 'Z' : '');
  }
  const mirror = (pts, cx) => pts.slice().reverse().map(([x, y]) => [2 * cx - x, y]);
  const svgArt = (vb, inner) => '<svg viewBox="' + vb + '" aria-hidden="true" focusable="false">' + inner + '</svg>';

  // body-type silhouettes: shoulder, bust, waist, hip, thigh widths
  const FIGURES = {
    none: [0.9, 0.92, 0.9, 0.94, 0.94], hourglass: [0.92, 1.02, 0.74, 1.06, 1], neathourglass: [0.84, 0.9, 0.7, 0.92, 0.88],
    pear: [0.78, 0.82, 0.8, 1.14, 1.08], apple: [0.9, 1.02, 1.14, 0.95, 0.94], rectangle: [0.86, 0.88, 0.94, 0.9, 0.9],
    invtriangle: [1.1, 1.02, 0.84, 0.84, 0.86], column: [0.78, 0.78, 0.78, 0.8, 0.8], diamond: [0.8, 0.92, 1.1, 1, 0.98],
    trapezoid: [1.14, 1.06, 0.92, 0.9, 0.94], mapple: [1, 1.08, 1.22, 1.02, 0.98], mtriangle: [0.84, 0.9, 0.96, 1.1, 1.04],
    mcolumn: [0.84, 0.78, 0.8, 0.8, 0.78], minv: [1.2, 1.1, 0.8, 0.86, 0.94],
  };
  function figureArt(k) {
    const [sh, bu, wa, hi, th] = FIGURES[k] || FIGURES.none, c = 20;
    const left = [[c - 2.3, 14.8], [c - 9.2 * sh, 17.8], [c - 8.2 * bu, 23], [c - 3.6 * (bu + wa), 28.5], [c - 6.6 * wa, 33.5], [c - 8.9 * hi, 41.5],
      [c - 8.2 * th, 48], [c - 5.4 * th, 58.5], [c - 4.7 * th, 63.5], [c - 3, 71.5], [c - 3.6, 74.6], [c - 1.1, 74.6], [c - 1.2, 71], [c - 1.7, 58.5], [c - 0.9, 50]];
    return svgArt('0 0 40 77', '<ellipse cx="20" cy="8.2" rx="3.9" ry="4.8"/><path d="M18.1 11.6h3.8l.5 4h-4.8z"/><path d="' + smooth(left.concat(mirror(left, c)), true) + '"/>');
  }
  // head shapes: top, forehead, cheek, jaw and chin half-widths, chin y
  const HEADS = {
    oval: [6, 10.5, 12, 10, 5, 43], round: [7.5, 12, 13.6, 12, 6.5, 41], square: [8, 12.6, 13, 13.2, 8, 41],
    rectangular: [6.4, 10.4, 10.8, 10.4, 6, 45.5], triangular: [5, 9, 12, 13.6, 7.6, 42], invertedtriangular: [8.6, 13.2, 12.6, 8.8, 3.4, 43],
    diamond: [5, 9.4, 13.6, 9.4, 3.8, 43],
  };
  function headArt(k) {
    const [tw, fw, cw, jw, chw, by] = HEADS[k] || HEADS.oval;
    const left = [[20 - tw, 6.5], [20 - fw, 13], [20 - cw, 24], [20 - jw, 33], [20 - chw, 40]];
    return svgArt('0 0 40 48', '<path d="' + smooth([[20, 4]].concat(left, [[20, by]], mirror(left, 20)), true) + '"/><path class="ink" d="M12.6 22.6h5M22.4 22.6h5M20 24.6v4.4M16.6 33.4q3.4 1.4 6.8 0"/>');
  }
  // hair styles, front view: a back layer, the face, then the front layer
  function capPath(t, hl, side) {
    const rx = 8 + t, ry = 10 + t, dy = (side - 21) / ry, w = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
    return 'M' + f1(22 - w) + ' ' + side + 'A' + rx + ' ' + ry + ' 0 ' + (side > 21 ? 1 : 0) + ' 1 ' + f1(22 + w) + ' ' + side + 'Q22 ' + (2 * hl - side) + ' ' + f1(22 - w) + ' ' + side + 'Z';
  }
  const circles = (list, r) => list.map(([x, y]) => '<circle cx="' + f1(x) + '" cy="' + f1(y) + '" r="' + r + '"/>').join('');
  function hairLayers(id) {
    const P = (d) => '<path d="' + d + '"/>';
    const curlRing = [];
    for (let i = 0; i <= 10; i++) { const a = (200 - i * 22) * Math.PI / 180; curlRing.push([22 + 10.4 * Math.cos(a), 20 - 11.2 * Math.sin(a)]); }
    const afro = [];
    for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; afro.push([22 + 14.4 * Math.cos(a), 18.5 + 13.8 * Math.sin(a)]); }
    const L = {
      bald: { front: '<path class="shine" d="M17.5 13.8q4.5-2.6 9 0"/>' },
      buzz: { front: '<g opacity=".55">' + P(capPath(0.5, 15.4, 19)) + '</g>' },
      crew: { front: P(capPath(1.2, 15.2, 19.5)) },
      short: { front: P(capPath(1.8, 15.8, 21.5)) },
      medium: { back: P('M12 32C10.9 26 10.8 22 11.4 18.6A10.6 11.6 0 0 1 32.6 18.6C33.2 22 33.1 26 32 32Z'), front: P(capPath(2, 16.6, 22)) },
      bob: { back: P('M10.8 33.6C10.3 27 10.3 22 10.9 18.6A11.1 12 0 0 1 33.1 18.6C33.7 22 33.7 27 33.2 33.6Z'), front: P(capPath(1.6, 17.8, 20)) },
      long: { back: P('M10.4 44C9.9 33 9.9 24 10.9 18.6A11.1 12 0 0 1 33.1 18.6C34.1 24 34.1 33 33.6 44Z'), front: P(capPath(1.8, 16, 23)) },
      wavy: { back: P(smooth([[22, 7.8], [13.4, 11.6], [10.6, 18.6], [10, 25], [11.4, 30], [9.8, 35.5], [11.4, 40.5], [10.6, 45], [33.4, 45], [32.6, 40.5], [34.2, 35.5], [32.6, 30], [34, 25], [33.4, 18.6], [30.6, 11.6]], true)), front: P(capPath(1.8, 16.2, 22)) },
      curly: { back: circles(curlRing.concat([[11.6, 28], [12.4, 32.6], [32.4, 28], [31.6, 32.6]]), 3.7), front: circles([[16.6, 12.6], [22, 11.4], [27.4, 12.6]], 3.3) },
      afro: { back: '<circle cx="22" cy="18.5" r="14.4"/>' + circles(afro, 2.6), front: circles([[16.4, 12.4], [22, 11.2], [27.6, 12.4]], 3.2) },
      ponytail: { back: P('M28.6 12.4C37.4 12.4 38.4 22 36.4 30C35.4 34.4 33.6 37.4 31.6 38.6C33.2 31 33 24 29 18.6Z'), front: P(capPath(1.5, 15.8, 20.5)) },
      bun: { back: '<circle cx="22" cy="8.4" r="5"/>', front: P(capPath(1.4, 15.6, 20.5)) },
      braid: { front: P(capPath(1.5, 15.8, 21)) + '<g class="braid">' + [[30.2, 26.6], [31, 30.6], [31.5, 34.6], [31.6, 38.6], [31.4, 42.4]].map(([x, y]) => '<ellipse cx="' + x + '" cy="' + y + '" rx="2.3" ry="2.5"/>').join('') + '</g>' },
    };
    return L[id] || L.short;
  }
  function hairArt(id) {
    const L = hairLayers(id);
    return svgArt('0 0 44 44', '<path class="shoulders" d="M4 44.5C5 37.6 12 35 22 35s17 2.6 18 9.5z"/><path class="skin2" d="M18.6 27h6.8v8.6h-6.8z"/>' +
      '<g class="hair">' + (L.back || '') + '</g><ellipse class="skin" cx="22" cy="21" rx="8" ry="10"/><g class="hair">' + (L.front || '') + '</g>');
  }
  // makeup looks: shadow colour and opacity, liner (0 none, 1 thin, 2 wing, 3 graphic), lip colour
  const LOOKS = {
    none: [null, 0, 0, '#c58a80'], natural: ['#b99482', 0.45, 0, '#c98378'], everyday: ['#a77c68', 0.6, 1, '#b86468'],
    'soft glam': ['#c08e78', 0.75, 1, '#c27677'], glam: ['#7a4a3a', 0.85, 2, '#9e3442'], 'smoky eye': ['#2f2b30', 0.9, 1, '#b07870'],
    'bold lip': ['#c2a596', 0.35, 1, '#b3162c'], 'graphic liner': [null, 0, 3, '#c07a74'], editorial: ['#3d6fb0', 0.85, 2, '#7d2556'],
  };
  function makeupArt(style) {
    const [sh, sa, liner, lip] = LOOKS[style] || LOOKS.none;
    let s = '';
    if (sh) s += '<path d="M5.5 14.5C9 4.6 35 4.6 38.5 14.5C33 9.8 11 9.8 5.5 14.5Z" fill="' + sh + '" opacity="' + sa + '"/>';
    s += '<path class="sclera" d="M8 15C14 7.8 30 7.8 36 15C30 21.6 14 21.6 8 15Z"/><circle cx="22" cy="14.4" r="4.6" class="iris"/><circle cx="22" cy="14.4" r="1.9" class="pupil"/>';
    if (liner) s += '<path class="liner" d="M8 15C14 7.8 30 7.8 36 15' + (liner >= 2 ? 'L' + (liner === 3 ? '42 8.6' : '40.4 10.6') : '') + '" stroke-width="' + (liner === 3 ? 1.9 : 1.3) + '"/>';
    s += '<path d="M12.5 29.2C16.4 25 19.6 26.4 22 27.4C24.4 26.4 27.6 25 31.5 29.2C27.2 34.8 16.8 34.8 12.5 29.2Z" fill="' + lip + '"/><path class="ink" d="M12.5 29.2C17 30.4 27 30.4 31.5 29.2"/>';
    return svgArt('0 0 44 38', s);
  }
  // outfit pictograms in the outfit's two colours
  const OUTFIT_ART = {
    underwear: '<path class="c1" d="M11.5 8.5C13.6 15.4 20 15.6 22 11.2C24 15.6 30.4 15.4 32.5 8.5L33.4 13.2C30.4 19.6 25 18.8 22 15.6C19 18.8 13.6 19.6 10.6 13.2Z"/><path class="c1 line" d="M13.4 9.6 15.4 3.5M30.6 9.6 28.6 3.5"/><path class="c1" d="M11 26.5h22l-1.8 6.4c-3.6 1.2-6 3.2-6.8 6.6h-6.8c-.8-3.4-3.2-5.4-6.8-6.6z"/>',
    swimwear: '<path class="c1" d="M15 4h2c1 7.6 9 7.6 10 0h2c0 7 2 11.6 1.2 18.6-.4 4.4 1.4 7.6 2.8 11-5 1-8 3.2-9 6.4h-4c-1-3.2-4-5.4-9-6.4 1.4-3.4 3.2-6.6 2.8-11C13 15.6 15 11 15 4z"/>',
    sport: '<path class="c1" d="M15 4h3.2c.8 4 6.8 4 7.6 0H29c0 4 1.4 6.4 3.4 7.4V24H11.6V11.4C13.6 10.4 15 8 15 4z"/><path class="c2" d="M11.6 25.6h20.8l1.2 12.8h-8.2L22 31l-3.4 7.4h-8.2z"/>',
    casual: '<path class="c1" d="M15.4 4 8 8.2l3 6.2 3.2-1.6V24h15.6V12.8l3.2 1.6 3-6.2L28.6 4c-1.2 2.6-3.6 3.6-6.6 3.6S16.6 6.6 15.4 4z"/><path class="jeans" d="M14.4 25.6h15.2l1.6 18h-6.4L22 31.8l-2.8 11.8h-6.4z"/>',
    dress: '<path class="c1" d="M17 3h2.2c.6 3 5 3 5.6 0H27l-.4 6.2c2 1.2 2.8 3 2.8 5.6l-1.2 3.2c3.4 7.2 6 14.6 7 23H8.8c1-8.4 3.6-15.8 7-23l-1.2-3.2c0-2.6.8-4.4 2.8-5.6z"/><path class="c2" d="M15.4 17.4h13.2v2.4H15.4z"/>',
    formal: '<path class="c2" d="M17.4 4h9.2L22 13z"/><path class="c1" d="M16 4 9 7.6V27h11.6V12L22 15l1.4-3v15H35V7.6L28 4l-6 9.4z"/><path class="tie" d="M21 11.4h2l.8 9-1.8 2-1.8-2z"/><path class="c1" d="M13.6 28.4h16.8l1.2 15.2h-6.4L22 33.4l-3.2 10.2h-6.4z"/>',
    scrubs: '<path class="c1" d="M15.2 4 8.6 7.8l2.2 6.6 3-1.2V26h16.4V13.2l3 1.2 2.2-6.6L28.8 4C27.4 7.6 25 10.4 22 10.4S16.6 7.6 15.2 4z"/><path class="c1 dim" d="M14.4 27.2h15.2l1.2 16.4h-6.2L22 32.6l-2.6 11h-6.2z"/>',
  };
  const outfitArt = (id) => svgArt('0 0 44 44', OUTFIT_ART[id] || '<path class="c1 line" d="M22 9.5a2.6 2.6 0 1 1 2.6 2.6c-1.6 0-2.6 1-2.6 2.6v1.4L6 27.6h32L22 16"/>');

  // ------------------------------------------------------------ the studio
  class Studio {
    constructor(app, root) {
      this.app = app;
      this.root = root;
      this.q = app.query || new URLSearchParams(location.search);
      this.dev = this.q.has('t');
      this.syncers = [];
      this.derived = [];
      this.panes = {};
      this.level = -1;
      this.raf = 0;
      this.n = 0;
      this.flushFn = () => { this.raf = 0; this.flush(); };
      this.prefs = Object.assign({ tab: 'Body', collapsed: false, sheet: 'half', randId: '' }, store.get(K.ui, null));
      this.mq = window.matchMedia('(max-width: 720px)');
      this.phone = this.mq.matches;

      this.restore();
      this.build();
      this.hist = [JSON.stringify(app.params)];
      this.hi = 0;
      this.updateUndo();
      app.on('params', () => this.refreshDerived());
      this.refreshDerived();
      this.bindGlobal();
      this.openTab(TABS.includes(this.q.get('tab')) ? this.q.get('tab') : TABS.includes(this.prefs.tab) ? this.prefs.tab : 'Body');
      this.setSheet(this.q.get('sheet') || this.prefs.sheet, true);
      this.setCollapsed(this.q.get('panel') === '0' || (!this.q.has('panel') && this.prefs.collapsed), true);
      this.layoutView();
      const menu = this.q.get('menu');
      if (menu && this.menus[menu]) this.menus[menu]();
      if (this.dev) this.redraw();
    }

    // ---------------------------------------------------- params plumbing
    get p() { return this.app.params; }
    get(path) { return path.startsWith('details.') ? (this.p.details || {})[path.slice(8)] : this.p[path]; }
    set(path, v) {
      const p = this.p;
      if (path.startsWith('details.')) {
        const k = path.slice(8);
        p.details = p.details || {};
        if (Math.abs(v) < 0.005) delete p.details[k]; else p.details[k] = v;
        this.queue(2);
        return;
      }
      p[path] = v;
      this.queue(SHAPE.has(path) ? 2 : META.has(path) ? 0 : 1);
    }
    // 0 metadata only, 1 appearance (modules' onParams), 2 re-shape
    queue(level) {
      if (level > this.level) this.level = level;
      if (!this.raf) this.raf = requestAnimationFrame(this.flushFn);
    }
    flush() {
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
      const lvl = this.level, app = this.app;
      if (lvl < 0) return;
      this.level = -1;
      if (lvl === 2) app.setParams(app.params);
      else if (lvl === 1) {
        for (const m of app.moduleList) if (m.onParams) { try { m.onParams(app.params); } catch (e) { console.error(e); } }
        for (const fn of app.listeners.params) fn(app.params);
      }
      this.saveSoon();
      if (this.dev) this.redraw();
    }
    // load a whole character (undo, presets, slots, import)
    load(p) {
      const merged = Object.assign(BS.defaultParams(), p);
      merged.details = Object.assign({}, p.details);
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.level = -1;
      this.app.setParams(merged);
      if (this.syncers) this.syncAll();
      this.saveSoon();
      if (this.dev) this.redraw();
    }
    // a new character from a preset, Randomize or import
    adopt(p, keepId) {
      p = JSON.parse(JSON.stringify(p));
      if (!keepId || !p._id) p._id = uid();
      this.load(p);
      this.applyWardrobe(true);
      this.commit();
    }
    restore() {
      const q = this.q;
      if (!q.has('preset') && !q.has('p')) {
        const saved = store.get(K.current, null);
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) this.load(saved);
      }
      if (!this.p._id) this.p._id = uid();
      this.applyWardrobe(true);
    }
    saveSoon() {
      clearTimeout(this.saveT);
      this.saveT = setTimeout(() => this.saveNow(), 600);
    }
    saveNow() { clearTimeout(this.saveT); this.flush(); store.set(K.current, this.p); }
    syncAll() { for (const fn of this.syncers) fn(); this.refreshDerived(); }
    refreshDerived() { for (const fn of this.derived) fn(); }
    redraw() {
      const app = this.app;
      app.tick(0);
      app.orbit.update(1);
      app.orbit.snap();
      app.render();
    }

    // ---------------------------------------------------- history
    commit() {
      this.flush();
      const s = JSON.stringify(this.p);
      if (s === this.hist[this.hi]) return;
      this.hist.length = this.hi + 1;
      this.hist.push(s);
      if (this.hist.length > 120) this.hist.shift();
      this.hi = this.hist.length - 1;
      this.updateUndo();
    }
    undo() { this.commit(); if (this.hi > 0) { this.hi--; this.load(JSON.parse(this.hist[this.hi])); this.updateUndo(); } }
    redo() { this.commit(); if (this.hi < this.hist.length - 1) { this.hi++; this.load(JSON.parse(this.hist[this.hi])); this.updateUndo(); } }
    updateUndo() {
      if (!this.undoBtns) return;
      for (const b of this.undoBtns) b.disabled = this.hi <= 0;
      for (const b of this.redoBtns) b.disabled = this.hi >= this.hist.length - 1;
    }

    // ---------------------------------------------------- body numbers
    metrics() {
      const p = this.p, cm = p.heightCm || BS.heightCm(this.app.D, p);
      // a BMI-like estimate: the weight slider spans about BMI 15-33, muscle adds lean mass
      const bmi = 24 + ((p.weight ?? 0.5) - 0.5) * 18 + ((p.muscle ?? 0.5) - 0.5) * 3;
      const g = p.gender ?? 0.5, hs = BS.HEIGHT_STATS;
      const mean = BS.expectedHeight(g), sd = hs.female[1] + (hs.male[1] - hs.female[1]) * g;
      return { cm, bmi, kg: bmi * (cm / 100) * (cm / 100), mean, pctile: clamp(Math.round(phi((cm - mean) / sd) * 100), 1, 99) };
    }
    summary() {
      const p = this.p, m = this.metrics(), id = BS.IDENTITIES[p.identity];
      return [id ? id.label : null, p.pronouns, Math.round(p.age) + ' y', Math.round(m.cm) + ' cm', Math.round(m.kg) + ' kg'].filter(Boolean).join(' · ');
    }

    // ---------------------------------------------------- building blocks
    slider(o) {
      const id = 'bs-r' + (++this.n), min = o.min ?? 0, max = o.max ?? 1, step = o.step ?? 0.01, def = o.def ?? 0;
      const read = o.get || (() => this.get(o.path) ?? def);
      const write = o.set || ((v) => this.set(o.path, v));
      const fmt = o.fmt || (min < 0 ? signed : pct);
      const input = h('input', { type: 'range', id, min, max, step, class: o.track ? 'tracked' : null });
      if (o.track) input.style.setProperty('--track', o.track);
      const out = h('output', { class: 'bs-val', for: id });
      const head = h('div', { class: 'bs-slider-head', title: 'Double-click to reset' }, h('label', { for: id, text: o.label }), out);
      const range = h('div', { class: 'bs-range' }, input);
      const row = h('div', { class: 'bs-slider' + (o.cls ? ' ' + o.cls : '') }, head, range);
      if (o.ends) row.append(h('div', { class: 'bs-ends', 'aria-hidden': 'true' }, h('span', { text: o.ends[0] }), h('span', { text: o.ends[1] })));
      const z = min < 0 && max > 0 ? -min / (max - min) : 0;
      const paint = (v) => {
        const t = (v - min) / (max - min);
        input.style.setProperty('--a', Math.min(t, z));
        input.style.setProperty('--b', Math.max(t, z));
        const s = fmt(v);
        out.textContent = s;
        input.setAttribute('aria-valuetext', s);
      };
      input.addEventListener('input', () => { const v = +input.value; write(v); paint(v); if (o.after) o.after(v); });
      input.addEventListener('change', () => this.commit());
      head.addEventListener('dblclick', () => { write(def); sync(); if (o.after) o.after(def); this.commit(); });
      const sync = () => { input.value = read(); paint(+input.value); };
      this.syncers.push(sync);
      sync();
      row.input = input;
      row.sync = sync;
      return row;
    }
    // a row of toggle cards; o.items [{id, label, art?, swatch?}]
    cards(o) {
      const wrap = h('div', { class: 'bs-cards ' + (o.cls || ''), role: 'group', 'aria-label': o.label });
      const btns = o.items.map((it) => {
        const b = h('button', { type: 'button', class: 'bs-card', 'aria-pressed': 'false', title: it.title || it.label },
          it.art ? h('span', { class: 'art', html: it.art }) : null,
          it.swatch ? h('span', { class: 'sw', style: '--c:' + it.swatch }) : null,
          it.emoji ? h('span', { class: 'emo', text: it.emoji }) : null,
          o.noLabel ? h('span', { class: 'sr-only', text: it.label }) : h('span', { class: 'lbl', text: it.label }));
        b.dataset.id = it.id;
        b.addEventListener('click', () => { o.pick(it.id, b); sync(); if (!o.noCommit) this.commit(); });
        wrap.append(b);
        return b;
      });
      const sync = () => { const v = String(o.get()); for (const b of btns) b.setAttribute('aria-pressed', String(b.dataset.id === v)); };
      this.syncers.push(sync);
      sync();
      wrap.sync = sync;
      return wrap;
    }
    // colour picker; with o.def null it can fall back to "style default"
    color(o) {
      const id = 'bs-c' + (++this.n);
      const input = h('input', { type: 'color', id });
      const reset = o.nullable ? h('button', { type: 'button', class: 'bs-mini', text: o.nullLabel || 'Default', title: 'Use the default colour' }) : null;
      const row = h('div', { class: 'bs-color' }, h('label', { for: id, text: o.label }), h('span', { class: 'bs-color-pick' }, input, reset));
      input.addEventListener('input', () => { o.set(input.value); row.classList.remove('is-null'); });
      input.addEventListener('change', () => this.commit());
      if (reset) reset.addEventListener('click', () => { o.set(null); sync(); this.commit(); });
      const sync = () => { const v = o.get(); input.value = v || o.fallback(); row.classList.toggle('is-null', !v && !!o.nullable); };
      this.syncers.push(sync);
      sync();
      return row;
    }
    toggle(o) {
      const input = h('input', { type: 'checkbox', role: 'switch' });
      const row = h('label', { class: 'bs-switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', { class: 'txt' }, h('b', { text: o.label }), o.hint ? h('small', { text: o.hint }) : null));
      input.addEventListener('change', () => { o.set(input.checked); if (o.commit) this.commit(); });
      const sync = () => { input.checked = !!o.get(); };
      this.syncers.push(sync);
      sync();
      return row;
    }
    // a titled block; collapsible ones get a chevron, a change badge and a reset
    section(parent, title, o = {}) {
      const body = h('div', { class: 'bs-sec-body', id: 'bs-sec' + (++this.n) });
      const sec = h('section', { class: 'bs-sec' + (o.collapsible ? ' collapsible' : '') + (o.cls ? ' ' + o.cls : '') });
      if (o.collapsible) {
        const badge = h('span', { class: 'bs-badge' });
        const btn = h('button', { type: 'button', class: 'bs-sec-toggle', 'aria-expanded': String(!!o.open), 'aria-controls': body.id }, h('span', { class: 'ttl', text: title }), badge, icon('chev', 'chev'));
        btn.addEventListener('click', () => { const on = btn.getAttribute('aria-expanded') !== 'true'; btn.setAttribute('aria-expanded', String(on)); body.hidden = !on; });
        body.hidden = !o.open;
        const head = h('header', { class: 'bs-sec-head' }, btn);
        if (o.reset) head.append(this.resetBtn(title, o.reset));
        sec.append(head);
        if (o.count) this.derived.push(() => { const n = o.count(); badge.textContent = n ? String(n) : ''; badge.title = n ? n + ' changed' : ''; });
      } else if (title) {
        const head = h('header', { class: 'bs-sec-head' }, h('h3', { text: title }));
        if (o.reset) head.append(this.resetBtn(title, o.reset));
        sec.append(head);
      }
      sec.append(body);
      parent.append(sec);
      return body;
    }
    resetBtn(title, fn) {
      return h('button', { type: 'button', class: 'bs-icon-btn sm', title: 'Reset ' + title.toLowerCase(), 'aria-label': 'Reset ' + title, onclick: () => { fn(); this.syncAll(); this.commit(); } }, icon('reset'));
    }
    note(parent, text, cls) { const el = h('p', { class: 'bs-note' + (cls ? ' ' + cls : ''), text }); parent.append(el); return el; }
    missing(el, text) { this.note(el, text, 'empty'); }
    // detail sliders of one BS.DETAILS group
    detailGroup(parent, group, o = {}) {
      const defs = BS.DETAILS.filter((d) => d.group === group && !(o.skip && o.skip(d)));
      if (!defs.length) return;
      const keys = defs.map((d) => d.key);
      const body = this.section(parent, o.title || group, {
        collapsible: true, open: o.open,
        count: () => keys.filter((k) => Math.abs((this.p.details || {})[k] || 0) > 0.005).length,
        reset: () => { for (const k of keys) delete this.p.details[k]; this.queue(2); },
      });
      for (const d of defs) {
        body.append(this.slider({ path: 'details.' + d.key, label: d.label, min: d.neg ? -1 : 0, max: 1, def: 0 }));
      }
    }
    // exclusive "family" of details (shape-*, head-*) shown as cards plus an amount slider
    familyCards(parent, prefix, items, art, label) {
      const keys = items.map((it) => prefix + it.id);
      const active = () => {
        let best = 'none', bv = 0.005;
        for (const k of keys) { const v = (this.p.details || {})[k] || 0; if (v > bv) { bv = v; best = k.slice(prefix.length); } }
        return best;
      };
      const amount = this.slider({
        label: 'Amount', def: 0.6,
        get: () => { const a = active(); return a === 'none' ? 0 : this.p.details[prefix + a]; },
        set: (v) => { const a = active(); if (a !== 'none') this.set('details.' + prefix + a, Math.max(0.01, v)); },
      });
      const cards = this.cards({
        label, cls: 'figs', get: active,
        items: [{ id: 'none', label: 'Natural', art: art('none') }].concat(items.map((it) => ({ id: it.id, label: it.label, art: art(it.id) }))),
        pick: (id) => {
          const cur = active(), v = cur !== 'none' ? this.p.details[prefix + cur] : 0.6;
          for (const k of keys) delete this.p.details[k];
          if (id !== 'none' && id !== cur) this.p.details[prefix + id] = v;
          this.queue(2);
          amount.sync();
        },
      });
      const a2 = () => { amount.classList.toggle('is-off', active() === 'none'); };
      this.derived.push(a2);
      parent.append(cards, amount);
    }

    // ---------------------------------------------------- layout
    build() {
      const root = this.root;
      root.classList.add('bs-ui');
      root.textContent = '';
      this.menus = {};
      this.undoBtns = [];
      this.redoBtns = [];
      root.append(this.buildTop(), this.buildPanel(), this.buildView());
      this.toasts = h('div', { class: 'bs-toasts', role: 'status', 'aria-live': 'polite' });
      this.hint = h('div', { class: 'bs-hint', text: 'drag to rotate · scroll/pinch to zoom' });
      this.reopen = h('button', { type: 'button', class: 'bs-reopen', 'aria-label': 'Show the editor panel', onclick: () => this.setCollapsed(false) }, icon('panel'), h('span', { text: 'Edit' }));
      this.info = h('div', { class: 'bs-info', role: 'dialog', 'aria-live': 'polite', hidden: true });
      this.fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
      this.fileIn.addEventListener('change', () => this.importFile());
      root.append(this.toasts, this.hint, this.reopen, this.info, this.fileIn);
    }

    buildTop() {
      const name = h('input', { type: 'text', class: 'bs-name-in', maxlength: '40', placeholder: 'Name', 'aria-label': 'Character name', autocomplete: 'off', spellcheck: 'false' });
      name.addEventListener('input', () => this.set('name', name.value));
      name.addEventListener('change', () => this.commit());
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
      this.syncers.push(() => { if (document.activeElement !== name) name.value = this.p.name || ''; });
      name.value = this.p.name || '';

      const btn = (ic, label, fn, cls, title) => h('button', { type: 'button', class: 'bs-btn' + (cls ? ' ' + cls : ''), title: title || label, 'aria-label': label, onclick: fn }, icon(ic), h('span', { class: 'lbl', text: label }));
      const iconBtn = (ic, label, fn, cls) => h('button', { type: 'button', class: 'bs-icon-btn' + (cls ? ' ' + cls : ''), title: label, 'aria-label': label, onclick: fn }, icon(ic));

      const undo = iconBtn('undo', 'Undo (Ctrl+Z)', () => this.undo()), redo = iconBtn('redo', 'Redo (Ctrl+Shift+Z)', () => this.redo());
      this.undoBtns.push(undo);
      this.redoBtns.push(redo);
      const idSel = this.identitySelect();
      const presets = h('button', { type: 'button', class: 'bs-btn menu-btn', title: 'Presets' }, h('span', { class: 'lbl', text: 'Presets' }), icon('chev', 'trail'));
      const chars = btn('save', 'Characters', null, 'menu-btn collapse-lbl');
      const game = btn('lotus', 'Serenity Hands', null, 'menu-btn accent-outline collapse-lbl');
      chars.append(icon('chev', 'trail'));
      game.append(icon('chev', 'trail'));
      const more = iconBtn('menu', 'More', null, 'phone-only');
      this.menus.presets = this.popover(presets, 'Presets', (el) => this.renderPresets(el));
      this.menus.characters = this.popover(chars, 'Characters', (el) => { this.renderCharacters(el); this.renderRoster(el); });
      this.menus.game = this.popover(game, 'Serenity Hands', (el) => { this.renderGame(el); this.renderRoster(el); });
      this.menus.more = this.popover(more, 'Menu', (el) => this.renderMore(el));

      const rand = btn('dice', 'Randomize', () => this.randomize(), 'primary', 'Randomize (R)');
      const randPhone = iconBtn('dice', 'Randomize (R)', () => this.randomize(), 'phone-only');
      const shot = iconBtn('camera', 'Screenshot', () => this.screenshot(), 'desk-only');

      return h('header', { class: 'bs-top' },
        h('div', { class: 'bs-brand' }, h('span', { class: 'bs-logo', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24">' + I.logo + '</svg>' }), h('span', { class: 'bs-word' }, 'Body ', h('b', { text: 'Studio' }))),
        h('div', { class: 'bs-name' }, name),
        h('div', { class: 'bs-tools' },
          h('div', { class: 'bs-group desk-only' }, presets, rand, idSel),
          h('div', { class: 'bs-group' }, randPhone, undo, redo),
          h('div', { class: 'bs-group desk-only' }, chars, shot, game),
          more));
    }
    identitySelect() {
      const sel = h('select', { class: 'bs-select', 'aria-label': 'Randomize as', title: 'Randomize as' },
        h('option', { value: '', text: 'Anyone' }),
        Object.keys(BS.IDENTITIES).map((k) => h('option', { value: k, text: BS.IDENTITIES[k].label })));
      sel.value = this.prefs.randId || '';
      sel.addEventListener('change', () => { this.prefs.randId = sel.value; this.savePrefs(); for (const s of document.querySelectorAll('.bs-randid')) s.value = sel.value; });
      sel.classList.add('bs-randid');
      return sel;
    }

    buildPanel() {
      const tabs = h('div', { class: 'bs-tabs', role: 'tablist', 'aria-label': 'Editor sections', 'aria-orientation': this.phone ? 'horizontal' : 'vertical' });
      const panes = h('div', { class: 'bs-panes' });
      for (const name of TABS) {
        const b = h('button', { type: 'button', role: 'tab', class: 'bs-tab', id: 'bs-tab-' + name, 'aria-controls': 'bs-pane-' + name, 'aria-selected': 'false', tabindex: '-1' }, icon(name), h('span', { text: name }));
        b.addEventListener('click', () => this.openTab(name, true));
        const pane = h('div', { class: 'bs-pane', role: 'tabpanel', id: 'bs-pane-' + name, 'aria-labelledby': 'bs-tab-' + name, hidden: true, tabindex: '-1' });
        this.panes[name] = { btn: b, el: pane, built: false };
        tabs.append(b);
        panes.append(pane);
      }
      tabs.addEventListener('keydown', (e) => {
        const i = TABS.indexOf(this.tab);
        const next = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        let j = next ? (i + next + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
        if (j < 0) return;
        e.preventDefault();
        this.openTab(TABS[j], true);
        this.panes[TABS[j]].btn.focus();
      });
      this.handle = h('button', { type: 'button', class: 'bs-handle', 'aria-label': 'Resize the editor (drag, or tap to toggle)' }, h('span'));
      this.bindSheet(this.handle);
      const hide = h('button', { type: 'button', class: 'bs-icon-btn sm bs-hide', title: 'Hide panel', 'aria-label': 'Hide the editor panel', onclick: () => this.setCollapsed(true) }, icon('hide'));
      this.panel = h('aside', { class: 'bs-panel', 'aria-label': 'Character editor' }, this.handle, tabs, panes, hide);
      return this.panel;
    }

    buildView() {
      const views = h('div', { class: 'bs-seg', role: 'group', 'aria-label': 'Camera' });
      VIEWS.forEach(([id, label], i) => views.append(h('button', { type: 'button', class: 'bs-seg-btn', title: label + ' (' + (i + 1) + ')', onclick: () => this.view(id) }, label)));
      this.spinBtn = h('button', { type: 'button', class: 'bs-seg-btn spin', 'aria-pressed': 'false', title: '360° auto-spin (Space)', onclick: () => this.toggleSpin() }, icon('spin'), h('span', { text: '360°' }));
      const q = h('select', { class: 'bs-select sm', 'aria-label': 'Render quality', title: 'Render quality (reloads)' },
        ['high', 'medium', 'low'].map((v) => h('option', { value: v, text: cap(v) + ' quality' })));
      q.value = this.app.quality;
      q.addEventListener('change', () => this.setQuality(q.value));
      return h('div', { class: 'bs-view' }, views, this.spinBtn, h('span', { class: 'desk-only' }, q));
    }

    // ---------------------------------------------------- tabs
    openTab(name, user) {
      const pane = this.panes[name];
      if (!pane) return;
      for (const n of TABS) {
        const t = this.panes[n], on = n === name;
        t.btn.setAttribute('aria-selected', String(on));
        t.btn.tabIndex = on ? 0 : -1;
        t.el.hidden = !on;
      }
      if (!pane.built) {
        pane.built = true;
        const head = h('div', { class: 'bs-pane-head' }, h('h2', { text: name }), h('p', { class: 'bs-summary' }));
        const sum = head.lastChild;
        this.derived.push(() => { sum.textContent = this.summary(); });
        sum.textContent = this.summary();
        pane.el.append(head);
        const body = h('div', { class: 'bs-pane-body' });
        pane.el.append(body);
        this['pane' + name](body);
      }
      this.tab = name;
      this.prefs.tab = name;
      this.savePrefs();
      this.hideInfo();
      if (pane.onShow) pane.onShow();
      if (user) {
        if (TAB_CAM[name] && !this.app.orbit.autoRotate) this.app.focus(TAB_CAM[name]);
        if (this.phone && this.sheet === 'peek') this.setSheet('half');
        pane.btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (this.dev) this.redraw();
      }
    }

    paneBody(el) {
      // identity: independent of the body; picking one only offers a starting point
      const idBody = this.section(el, 'Identity');
      const ids = Object.keys(BS.IDENTITIES);
      const nudge = h('div', { class: 'bs-nudge', hidden: true });
      idBody.append(this.cards({
        label: 'Gender identity', cls: 'chips cols3', get: () => this.p.identity,
        items: ids.map((k) => ({ id: k, label: BS.IDENTITIES[k].label })),
        pick: (k) => {
          const prev = BS.IDENTITIES[this.p.identity], id = BS.IDENTITIES[k];
          if (!this.p.pronouns || (prev && this.p.pronouns === prev.pronouns)) this.p.pronouns = id.pronouns;
          this.set('identity', k);
          this.syncAll();
          this.offerNudge(nudge, k);
        },
      }));
      const pid = 'bs-pr' + (++this.n);
      const pron = h('input', { type: 'text', id: pid, class: 'bs-text', list: pid + 'l', maxlength: '32', autocomplete: 'off' });
      pron.addEventListener('input', () => this.set('pronouns', pron.value));
      pron.addEventListener('change', () => this.commit());
      this.syncers.push(() => { if (document.activeElement !== pron) pron.value = this.p.pronouns || ''; });
      pron.value = this.p.pronouns || '';
      idBody.append(h('div', { class: 'bs-field' }, h('label', { for: pid, text: 'Pronouns' }), pron, h('datalist', { id: pid + 'l' }, PRONOUNS.map((v) => h('option', { value: v })))), nudge);
      this.note(idBody, 'Identity never limits the body — every slider stays open to everyone.');

      const b = this.section(el, 'Body');
      const gtxt = (v) => (v < 0.06 ? 'Female' : v < 0.3 ? 'Mostly female' : v < 0.45 ? 'Leaning female' : v <= 0.55 ? 'In between' : v < 0.7 ? 'Leaning male' : v < 0.94 ? 'Mostly male' : 'Male');
      b.append(this.slider({ path: 'gender', label: 'Body', def: 0.5, fmt: gtxt, ends: ['Female', 'Male'], cls: 'gender' }));
      b.append(this.slider({ path: 'age', label: 'Age', min: 18, max: 90, step: 1, def: 28, fmt: (v) => Math.round(v) + ' years' }));
      // height in cm, with the realistic average for this body as a tick
      const hs = BS.HEIGHT_STATS;
      const height = this.slider({
        path: 'heightCm', label: 'Height', min: hs.min, max: hs.max, step: 1, def: 170,
        get: () => Math.round(this.metrics().cm),
        fmt: (v) => Math.round(v) + ' cm · ' + ftIn(v),
      });
      const mark = h('span', { class: 'bs-mark', title: 'Average height for this body' });
      height.querySelector('.bs-range').append(mark);
      const hnote = h('p', { class: 'bs-note tight' });
      height.append(hnote);
      b.append(height);
      this.derived.push(() => {
        const m = this.metrics(), g = this.p.gender ?? 0.5;
        mark.style.setProperty('--t', (m.mean - hs.min) / (hs.max - hs.min));
        const who = g < 0.3 ? 'women' : g > 0.7 ? 'men' : 'adults of this build';
        hnote.textContent = 'Average for this body ' + Math.round(m.mean) + ' cm · taller than ' + m.pctile + '% of ' + who;
      });
      const weight = this.slider({ path: 'weight', label: 'Weight', def: 0.5, ends: ['Slim', 'Heavy'], fmt: () => { const m = this.metrics(); return Math.round(m.kg) + ' kg · ' + Math.round(m.kg * 2.2046) + ' lb'; } });
      const wnote = h('p', { class: 'bs-note tight' });
      weight.append(wnote);
      b.append(weight);
      this.derived.push(() => { weight.sync(); wnote.textContent = 'BMI ' + this.metrics().bmi.toFixed(1) + ' (estimated from height and build)'; });
      b.append(this.slider({ path: 'details.waist', label: 'Waist', min: -1, max: 1, def: 0, ends: ['Narrow', 'Wide'], cls: 'prominent' }));
      b.append(this.slider({ path: 'muscle', label: 'Muscle', def: 0.5, ends: ['Soft', 'Muscular'], after: () => weight.sync() }));
      b.append(this.slider({ path: 'proportions', label: 'Proportions', def: 0.5, ends: ['Uncommon', 'Classic'] }));

      const shapes = BS.DETAILS.filter((d) => d.group === 'Body type').map((d) => ({ id: d.key.slice(6), label: d.label }));
      this.familyCards(this.section(el, 'Body type'), 'shape-', shapes, figureArt, 'Body type');

      // ancestry: three sliders that always sum to one
      const anc = this.section(el, 'Ancestry mix');
      const AK = [['african', 'African'], ['asian', 'Asian'], ['caucasian', 'European']];
      const bar = h('div', { class: 'bs-mix', 'aria-hidden': 'true' }, AK.map(([k]) => h('span', { class: 'mix-' + k })));
      anc.append(bar);
      const rows = AK.map(([k, label]) => this.slider({
        label, def: 1 / 3, get: () => this.p[k] ?? 1 / 3,
        set: (v) => {
          const p = this.p, others = AK.map((a) => a[0]).filter((o) => o !== k), sum = others.reduce((s, o) => s + (p[o] || 0), 0);
          for (const o of others) p[o] = sum > 1e-4 ? (p[o] || 0) / sum * (1 - v) : (1 - v) / 2;
          p[k] = v;
          this.queue(2);
          for (const r of rows) if (r.input !== document.activeElement) r.sync();
          paintBar();
        },
      }));
      const paintBar = () => AK.forEach(([k], i) => { bar.children[i].style.flexGrow = Math.max(0.001, this.p[k] || 0); });
      this.derived.push(paintBar);
      anc.append(...rows);
      this.note(anc, 'Shapes the face and body the way MakeHuman’s scanned populations do. Skin colour is set separately.');

      const chest = this.section(el, 'Chest');
      chest.append(this.slider({ path: 'breastSize', label: 'Breast size', def: 0.5, ends: ['Small', 'Large'] }));
      chest.append(this.slider({ path: 'breastFirmness', label: 'Breast firmness', def: 0.5, ends: ['Soft', 'Firm'] }));

      this.note(el, 'Fine detail', 'kicker');
      for (const g of BS.BODY_GROUPS) if (g !== 'Body type') this.detailGroup(el, g, { skip: (d) => d.key === 'waist' });
    }
    offerNudge(box, k) {
      const id = BS.IDENTITIES[k], p = this.p, [lo, hi] = id.gender;
      box.textContent = '';
      if (p.gender >= lo - 0.02 && p.gender <= hi + 0.02) { box.hidden = true; return; }
      box.hidden = false;
      box.append(h('p', { text: 'Start from a typical body for a ' + id.label.toLowerCase() + '? You can still change everything.' }),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'bs-btn primary sm', text: 'Nudge body', onclick: () => {
            const g0 = p.gender, g1 = (lo + hi) / 2, cm = this.metrics().cm;
            p.heightCm = Math.round(clamp(BS.expectedHeight(g1) + (cm - BS.expectedHeight(g0)), BS.HEIGHT_STATS.min, BS.HEIGHT_STATS.max));
            this.set('gender', g1);
            box.hidden = true;
            this.syncAll();
            this.commit();
          } }),
          h('button', { type: 'button', class: 'bs-btn ghost sm', text: 'Keep my body', onclick: () => { box.hidden = true; } })));
    }

    paneFace(el) {
      const heads = BS.DETAILS.filter((d) => d.group === 'Head shape' && d.key.startsWith('head-')).map((d) => ({ id: d.key.slice(5), label: d.label }));
      this.familyCards(this.section(el, 'Face shape'), 'head-', heads, headArt, 'Face shape');
      BS.FACE_GROUPS.forEach((g, i) => this.detailGroup(el, g, { open: i === 0, title: g === 'Head shape' ? 'Head' : g, skip: (d) => d.key.startsWith('head-') }));
    }

    paneSkin(el) {
      const tones = BS.SKIN_TONES, n = tones.length - 1;
      const s = this.section(el, 'Skin tone');
      s.append(this.cards({
        label: 'Skin tone', cls: 'swatches tones', noLabel: true,
        get: () => String(Math.round((this.p.skinTone ?? 0.35) * n) / n),
        items: tones.map((c, i) => ({ id: String(i / n), label: 'Tone ' + (i + 1), swatch: c })),
        pick: (id) => this.set('skinTone', +id),
      }));
      s.append(this.slider({ path: 'skinTone', label: 'Tone', def: 0.35, track: 'linear-gradient(90deg,' + tones.join(',') + ')', fmt: (v) => (v < 0.2 ? 'Very light' : v < 0.4 ? 'Light' : v < 0.6 ? 'Medium' : v < 0.8 ? 'Dark' : 'Very dark') }));
      s.append(this.slider({ path: 'undertone', label: 'Undertone', def: 0.5, ends: ['Cool', 'Warm'], track: 'linear-gradient(90deg,#d9a3a6,#d8b39a 50%,#d9b56f)', fmt: (v) => (v < 0.35 ? 'Cool' : v > 0.65 ? 'Warm' : 'Neutral') }));
      const marks = this.section(el, 'Marks & texture');
      for (const [k, label, def] of [['freckles', 'Freckles', 0], ['moles', 'Moles & beauty marks', 0], ['vitiligo', 'Vitiligo', 0], ['stretchMarks', 'Stretch marks', 0], ['tanLines', 'Tan lines', 0], ['veins', 'Visible veins', 0.2], ['bodyHair', 'Body hair', 0.15]]) {
        marks.append(this.slider({ path: k, label, def }));
      }
      const col = this.section(el, 'Colour & finish');
      col.append(this.slider({ path: 'blush', label: 'Natural flush', def: 0.25 }));
      col.append(this.slider({ path: 'skinShine', label: 'Shine', def: 0.4, ends: ['Matte', 'Dewy'] }));
      col.append(this.slider({ path: 'lipColor', label: 'Lip colour', def: 0.35, track: 'linear-gradient(90deg,#d9a796,#c27a74,#a3474f,#6e2a33)', ends: ['Pale', 'Deep'] }));

      const mk = this.section(el, 'Makeup');
      mk.append(this.cards({
        label: 'Makeup style', cls: 'looks', get: () => this.p.makeupStyle || 'none',
        items: BS.MAKEUP_STYLES.map((st) => ({ id: st, label: st === 'none' ? 'Bare face' : cap(st), art: makeupArt(st) })),
        pick: (st) => {
          const p = this.p;
          if (st === 'none') p.makeup = 0; else if (!p.makeup) p.makeup = 0.6;
          this.set('makeupStyle', st);
          this.syncAll();
        },
      }));
      mk.append(this.slider({ path: 'makeup', label: 'Intensity', def: 0.6 }));
      const look = () => LOOKS[this.p.makeupStyle] || LOOKS.none;
      mk.append(this.color({ label: 'Lipstick', nullable: true, nullLabel: 'Style', get: () => this.p.lipstick, set: (v) => this.set('lipstick', v), fallback: () => look()[3] }));
      mk.append(this.color({ label: 'Eyeshadow', nullable: true, nullLabel: 'Style', get: () => this.p.eyeshadow, set: (v) => this.set('eyeshadow', v), fallback: () => look()[0] || '#a77c68' }));
      mk.append(this.color({ label: 'Nail colour', nullable: true, nullLabel: 'Style', get: () => this.p.nailColor, set: (v) => this.set('nailColor', v), fallback: () => '#d7a59a' }));
    }

    paneHair(el) {
      const hair = this.app.modules.hair;
      const styles = (hair && hair.styles) || HAIR_STYLES;
      const s = this.section(el, 'Style');
      const grid = this.cards({
        label: 'Hair style', cls: 'hairs', get: () => this.p.hairStyle,
        items: styles.map((x) => ({ id: idOf(x), label: labelOf(x), art: hairArt(idOf(x)) })),
        pick: (id) => this.set('hairStyle', id),
      });
      s.append(grid);
      const paintArt = () => {
        const p = this.p, tones = BS.SKIN_TONES;
        grid.style.setProperty('--hair', p.hairColorHex || BS.HAIR_COLORS[p.hairColor] || '#3a2a20');
        grid.style.setProperty('--skin', tones[Math.round(clamp(p.skinTone ?? 0.35, 0, 1) * (tones.length - 1))]);
      };
      this.derived.push(paintArt);
      paintArt();
      s.append(this.slider({ path: 'hairLength', label: 'Length', def: 0.5, ends: ['Shorter', 'Longer'] }));
      s.append(this.slider({ path: 'hairVolume', label: 'Volume', def: 0.5, ends: ['Flat', 'Full'] }));
      s.append(this.slider({ path: 'curl', label: 'Curl', def: 0.15, ends: ['Straight', 'Coily'] }));

      const c = this.section(el, 'Colour');
      c.append(this.cards({
        label: 'Hair colour', cls: 'swatches hairc', noLabel: true,
        get: () => (this.p.hairColorHex ? '' : this.p.hairColor),
        items: Object.keys(BS.HAIR_COLORS).map((k) => ({ id: k, label: k, swatch: BS.HAIR_COLORS[k] })),
        pick: (k) => { this.p.hairColorHex = null; this.set('hairColor', k); this.syncAll(); },
      }));
      c.append(this.color({ label: 'Custom colour', nullable: true, nullLabel: 'Palette', get: () => this.p.hairColorHex, set: (v) => { this.set('hairColorHex', v); this.refreshDerived(); }, fallback: () => BS.HAIR_COLORS[this.p.hairColor] || '#3a2a20' }));

      const f = this.section(el, 'Brows, lashes & facial hair');
      if (hair && hair.brows) f.append(this.cards({ label: 'Eyebrow style', cls: 'chips', get: () => this.p.browStyle, items: hair.brows.map((x) => ({ id: idOf(x), label: labelOf(x) })), pick: (id) => this.set('browStyle', id) }));
      f.append(this.slider({ path: 'browThickness', label: 'Brow thickness', def: 0.5, ends: ['Fine', 'Bold'] }));
      f.append(this.slider({ path: 'lashLength', label: 'Lash length', def: 0.5 }));
      const beards = (hair && hair.beards) || BEARDS;
      f.append(h('p', { class: 'bs-label', text: 'Facial hair' }), this.cards({ label: 'Facial hair', cls: 'chips', get: () => this.p.beard || 'none', items: beards.map((x) => ({ id: idOf(x), label: idOf(x) === 'none' ? 'None' : labelOf(x) })), pick: (id) => this.set('beard', id) }));
    }

    paneEyes(el) {
      const s = this.section(el, 'Iris colour');
      s.append(this.cards({
        label: 'Eye colour', cls: 'swatches irises',
        get: () => (this.p.eyeColorHex ? '' : this.p.eyeColor),
        items: Object.keys(BS.EYE_COLORS).map((k) => ({ id: k, label: k, swatch: BS.EYE_COLORS[k] })),
        pick: (k) => { this.p.eyeColorHex = null; this.set('eyeColor', k); this.syncAll(); },
      }));
      s.append(this.color({ label: 'Custom colour', nullable: true, nullLabel: 'Palette', get: () => this.p.eyeColorHex, set: (v) => this.set('eyeColorHex', v), fallback: () => BS.EYE_COLORS[this.p.eyeColor] || '#6b4425' }));
      s.append(this.toggle({ label: 'Heterochromia', hint: 'Each eye a different colour', get: () => this.p.heterochromia, set: (v) => this.set('heterochromia', v), commit: true }));
    }

    paneOutfit(el) {
      const cl = this.app.modules.clothing;
      const s = this.section(el, 'Outfit');
      if (cl) {
        const grid = this.cards({
          label: 'Outfit', cls: 'outfits', get: () => this.p.outfit,
          items: (cl.outfits || OUTFITS).map((x) => ({ id: idOf(x), label: labelOf(x), art: outfitArt(idOf(x)) })),
          pick: (id) => this.set('outfit', id),
        });
        s.append(grid);
        const paint = () => { grid.style.setProperty('--c1', this.p.outfitColor || '#2d3646'); grid.style.setProperty('--c2', this.p.outfitColor2 || '#d9d4cc'); };
        this.derived.push(paint);
        paint();
      } else this.missing(s, 'Clothing isn’t loaded, so outfits can’t be shown right now.');
      this.note(s, 'Underwear is always the minimum — Body Studio never shows anyone nude.');
      const c = this.section(el, 'Colours');
      for (const [k, label] of [['outfitColor', 'Main colour'], ['outfitColor2', 'Accent colour']]) {
        c.append(this.cards({ label, cls: 'swatches small', noLabel: true, get: () => this.p[k], items: OUTFIT_COLORS.map((x) => ({ id: x, label: x, swatch: x })), pick: (x) => { this.set(k, x); this.refreshDerived(); } }));
        c.append(this.color({ label, get: () => this.p[k], set: (v) => { this.set(k, v); this.refreshDerived(); }, fallback: () => '#2d3646' }));
      }
      const w = this.section(el, 'Clothes Studio');
      const list = h('div', { class: 'bs-wardrobe' });
      w.append(list);
      const paintW = () => {
        const wd = this.p.wardrobe;
        list.textContent = '';
        if (!wd || !Object.keys(wd).length) { list.append(h('p', { class: 'bs-note', text: 'Pick fabrics, patterns and colours for each piece, or design blankets, towels and mats for the spa.' })); return; }
        for (const part in wd) {
          const sp = wd[part] || {};
          list.append(h('div', { class: 'bs-piece' }, h('span', { class: 'dot', style: 'background:' + (sp.color || '#888') }), h('b', { text: cap(part) }), h('span', { text: [sp.type, sp.pattern && sp.pattern !== 'solid' ? sp.pattern : null].filter(Boolean).join(' · ') })));
        }
        list.append(h('button', { type: 'button', class: 'bs-btn ghost sm', text: 'Use plain outfit colours', onclick: () => { delete this.p.wardrobe; this.queue(1); this.commit(); paintW(); } }));
      };
      this.derived.push(paintW);
      paintW();
      const link = h('a', { class: 'bs-btn primary wide', href: 'clothes.html?id=' + encodeURIComponent(this.p._id || ''), target: '_blank', rel: 'noopener' }, icon('ext'), h('span', { text: 'Design in Clothes Studio' }));
      link.addEventListener('click', () => { this.saveNow(); link.href = 'clothes.html?id=' + encodeURIComponent(this.p._id || ''); });
      w.append(link);
    }

    paneMotion(el) {
      const m = this.app.modules.motion;
      if (!m || !m.actions || !m.setAction) return this.missing(el, 'Motion isn’t loaded, so the person can’t move right now.');
      const groups = [];
      for (const a of m.actions) { let g = groups.find((x) => x.name === a.group); if (!g) groups.push(g = { name: a.group, list: [] }); g.list.push(a); }
      const grids = [];
      for (const g of groups) {
        const s = this.section(el, g.name || 'Actions');
        const grid = this.cards({ label: g.name, cls: 'chips', noCommit: true, get: () => m.want || (m.state && m.state.action), items: g.list.map((a) => ({ id: a.id, label: a.label })), pick: (id) => { m.setAction(id); for (const x of grids) x.sync(); } });
        grids.push(grid);
        s.append(grid);
      }
      const ctl = this.section(el, 'Playback');
      if ('speed' in m) ctl.append(this.slider({ label: 'Speed', min: 0.25, max: 2, step: 0.05, def: 1, get: () => m.speed, set: (v) => { m.speed = v; }, fmt: (v) => v.toFixed(2) + '×' }));
      if (m.setTalking) ctl.append(this.toggle({ label: 'Talk', hint: 'Lip movement, gestures and breathing of speech', get: () => m.talking, set: (v) => m.setTalking(v) }));
      if (m.setLookAtCamera) ctl.append(this.toggle({ label: 'Look at camera', hint: 'Eyes and head follow you as you orbit', get: () => m.lookAt, set: (v) => m.setLookAtCamera(v) }));
      if ('paused' in m) ctl.append(this.toggle({ label: 'Pause', hint: 'Freeze the motion', get: () => m.paused, set: (v) => { m.paused = v; } }));
      this.panes.Motion.onShow = () => { for (const x of grids) x.sync(); };
    }

    paneEmotion(el) {
      const m = this.app.modules.motion;
      if (!m || !m.emotions || !m.setEmotion) return this.missing(el, 'Motion isn’t loaded, so emotions can’t be shown right now.');
      const st = () => m.state || {};
      this.emoAmt = st().emotionAmount || 0.8;
      const s = this.section(el, 'Feeling');
      const grid = this.cards({
        label: 'Emotion', cls: 'emotions', noCommit: true, get: () => st().emotion || 'neutral',
        items: m.emotions.map((e) => ({ id: e.id, label: e.label, emoji: e.emoji })),
        pick: (id) => { m.setEmotion(id, this.emoAmt); amount.sync(); },
      });
      s.append(grid);
      const amount = this.slider({
        label: 'Intensity', def: 0.8, get: () => this.emoAmt,
        set: (v) => { this.emoAmt = v; const e = st().emotion; if (e && e !== 'neutral') m.setEmotion(e, v); },
      });
      s.append(amount);
      this.note(s, 'Emotions move the face, posture, breathing and colour together.');
      this.panes.Emotion.onShow = () => grid.sync();
    }

    paneInside(el) {
      const a = this.app.modules.anatomy;
      if (!a) return this.missing(el, 'The anatomy layers aren’t loaded right now.');
      this.missing(el, 'Anatomy controls will appear here.');
    }

    // ---------------------------------------------------- menus
    popover(btn, title, render) {
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      const open = () => {
        if (this.pop && this.pop.btn === btn) return this.closePop();
        this.closePop();
        const el = h('div', { class: 'bs-pop', role: 'dialog', 'aria-label': title, tabindex: '-1' });
        render(el);
        this.root.append(el);
        const r = btn.getBoundingClientRect(), w = el.offsetWidth;
        if (!this.phone) {
          el.style.top = Math.round(r.bottom + 8) + 'px';
          el.style.left = Math.round(clamp(r.right - w, 8, window.innerWidth - w - 8)) + 'px';
        }
        btn.setAttribute('aria-expanded', 'true');
        this.pop = { el, btn };
        el.focus({ preventScroll: true });
      };
      btn.addEventListener('click', open);
      return open;
    }
    closePop(refocus) {
      if (!this.pop) return;
      this.pop.btn.setAttribute('aria-expanded', 'false');
      this.pop.el.remove();
      if (refocus) this.pop.btn.focus();
      this.pop = null;
    }
    refreshPop() {
      if (!this.pop) return;
      const { btn } = this.pop;
      this.closePop();
      btn.click();
    }
    renderPresets(el) {
      el.append(h('h3', { text: 'Start from a preset' }));
      const grid = h('div', { class: 'bs-preset-grid' });
      for (const name in BS.PRESETS) {
        const p = BS.PRESETS[name], id = BS.IDENTITIES[p.identity];
        grid.append(h('button', { type: 'button', class: 'bs-preset', onclick: () => { this.adopt(BS.PRESETS[name]); this.closePop(); this.toast('Preset: ' + name + ' — meet ' + p.name); } },
          h('b', { text: name }), h('span', { text: [p.name, id && id.label, p.heightCm && p.heightCm + ' cm'].filter(Boolean).join(' · ') })));
      }
      el.append(grid);
    }
    renderCharacters(el) {
      const saves = store.get(K.saves, []);
      const list = Array.isArray(saves) ? saves : [];
      const name = this.p.name || 'Unnamed';
      const exists = list.some((s) => s.id === this.p._id);
      el.append(h('h3', { text: 'Saved characters' }),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'bs-btn primary', onclick: () => this.saveSlot() }, icon('save'), h('span', { text: exists ? 'Update “' + name + '”' : 'Save “' + name + '”' })),
          exists ? h('button', { type: 'button', class: 'bs-btn ghost', text: 'Save as copy', onclick: () => this.saveSlot(true) }) : null));
      const ul = h('ul', { class: 'bs-slots' });
      if (!list.length) ul.append(h('li', { class: 'empty', text: 'Nothing saved yet. Saved characters stay in this browser.' }));
      for (const s of list.slice().sort((a, b) => b.ts - a.ts)) {
        ul.append(h('li', { class: s.id === this.p._id ? 'current' : null },
          h('button', { type: 'button', class: 'slot-load', title: 'Load ' + s.name, onclick: () => { this.adopt(s.params, true); this.closePop(); this.toast('Loaded ' + s.name); } },
            s.thumb ? h('img', { src: s.thumb, alt: '', width: '42', height: '56' }) : h('span', { class: 'thumb' }),
            h('span', { class: 'meta' }, h('b', { text: s.name }), h('small', { text: when(s.ts) }))),
          h('button', { type: 'button', class: 'bs-icon-btn sm', title: 'Delete ' + s.name, 'aria-label': 'Delete ' + s.name, onclick: () => { store.set(K.saves, list.filter((x) => x !== s)); this.toast('Deleted ' + s.name); this.refreshPop(); } }, icon('trash'))));
      }
      el.append(ul, h('h3', { text: 'File' }),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'bs-btn ghost', onclick: () => this.exportFile() }, icon('down'), h('span', { text: 'Export JSON' })),
          h('button', { type: 'button', class: 'bs-btn ghost', onclick: () => this.fileIn.click() }, icon('up'), h('span', { text: 'Import JSON' }))));
    }
    renderGame(el) {
      const name = this.p.name || 'This character';
      el.append(h('h3', { text: 'Serenity Hands' }),
        h('a', { class: 'bs-btn primary wide', href: '../index.html', onclick: () => this.saveNow() }, icon('play'), h('span', { text: 'Play Serenity Hands' })),
        h('button', { type: 'button', class: 'bs-action', onclick: () => this.sendToGame() }, icon('send'), h('span', {}, h('b', { text: 'Send to Serenity Hands' }), h('small', { text: name + ' will visit the spa as a client' }))),
        h('button', { type: 'button', class: 'bs-action', onclick: () => this.playAsTherapist() }, icon('lotus'), h('span', {}, h('b', { text: 'Play as my therapist' }), h('small', { text: 'You’ll look like ' + name + ' in the game' }))));
    }
    renderRoster(el) {
      const roster = this.roster(), th = store.get(K.therapist, null);
      el.append(h('h3', { text: 'In the game' }));
      const ul = h('ul', { class: 'bs-slots compact' });
      if (th && th.params) {
        ul.append(h('li', {}, h('span', { class: 'meta' }, h('b', { text: (th.name || 'Your character') }), h('small', { text: 'You play as them' })),
          h('button', { type: 'button', class: 'bs-icon-btn sm', title: 'Stop playing as ' + th.name, 'aria-label': 'Stop playing as ' + th.name, onclick: () => { store.del(K.therapist); this.refreshPop(); } }, icon('trash'))));
      }
      for (const r of roster) {
        ul.append(h('li', {}, h('span', { class: 'meta' }, h('b', { text: r.name }), h('small', { text: 'Client · sent ' + when(r.ts) })),
          h('button', { type: 'button', class: 'bs-icon-btn sm', title: 'Remove ' + r.name + ' from the game', 'aria-label': 'Remove ' + r.name + ' from the game', onclick: () => { store.set(K.roster, this.roster().filter((x) => x.id !== r.id)); this.toast(r.name + ' won’t visit the spa any more'); this.refreshPop(); } }, icon('trash'))));
      }
      if (!ul.children.length) ul.append(h('li', { class: 'empty', text: 'No one from Body Studio is in the game yet.' }));
      el.append(ul);
    }
    renderMore(el) {
      this.renderPresets(el);
      const sel = this.identitySelect();
      el.append(h('div', { class: 'bs-field' }, h('label', { text: 'Randomize as' }), sel));
      this.renderGame(el);
      this.renderCharacters(el);
      this.renderRoster(el);
      const q = h('select', { class: 'bs-select', 'aria-label': 'Render quality' }, ['high', 'medium', 'low'].map((v) => h('option', { value: v, text: cap(v) })));
      q.value = this.app.quality;
      q.addEventListener('change', () => this.setQuality(q.value));
      el.append(h('h3', { text: 'View' }), h('div', { class: 'row' }, h('button', { type: 'button', class: 'bs-btn ghost', onclick: () => { this.closePop(); this.screenshot(); } }, icon('camera'), h('span', { text: 'Screenshot' })), h('label', { class: 'bs-field inline' }, h('span', { text: 'Quality' }), q)));
    }

    // ---------------------------------------------------- characters
    randomize() {
      const id = this.prefs.randId;
      const p = BS.randomPerson(Math.random, id ? { identity: id } : {});
      this.adopt(p);
      const m = this.metrics(), idl = BS.IDENTITIES[p.identity];
      this.toast('Meet ' + p.name + ' — ' + [idl && idl.label.toLowerCase(), p.age, Math.round(m.cm) + ' cm'].filter(Boolean).join(', '));
    }
    // render without the panel offset, optionally from a camera preset
    capture(viewName) {
      const app = this.app, o = app.orbit, cam = app.camera;
      const saved = { yaw: o.yaw, pitch: o.pitch, dist: o.dist, target: o.target.clone(), gy: o.goal.yaw, gp: o.goal.pitch, gd: o.goal.dist, gt: o.goal.target.clone(), view: app.view };
      cam.clearViewOffset();
      if (viewName) app.focus(viewName, true);
      const url = app.screenshot();
      Object.assign(o, { yaw: saved.yaw, pitch: saved.pitch, dist: saved.dist });
      o.target.copy(saved.target);
      Object.assign(o.goal, { yaw: saved.gy, pitch: saved.gp, dist: saved.gd });
      o.goal.target.copy(saved.gt);
      o.apply();
      app.view = saved.view;
      this.layoutView();
      if (this.dev) app.render();
      return url;
    }
    // the canvas is transparent: composite it over the studio backdrop
    composite(url, w, h, crop, cb) {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.save();
        g.translate(w / 2, h * 0.38);
        g.scale(w * 1.2, h * 0.9);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, '#4a4b50'); gr.addColorStop(0.45, '#2b2d33'); gr.addColorStop(1, '#16171b');
        g.fillStyle = gr;
        g.fillRect(-1, -1, 2, 2);
        g.restore();
        const sw = img.width, sh = img.height;
        if (crop) { const cw = Math.min(sw, sh * w / h); g.drawImage(img, (sw - cw) / 2, 0, cw, sh, 0, 0, w, h); } else g.drawImage(img, 0, 0, w, h);
        cb(c);
      };
      img.src = url;
    }
    screenshot() {
      const url = this.capture(), cv = this.app.renderer.domElement;
      this.composite(url, cv.width, cv.height, false, (c) => {
        this.download(c.toDataURL('image/png'), slug(this.p.name) + '-body-studio.png');
        this.toast('Screenshot saved');
      });
    }
    saveSlot(copy) {
      this.commit();
      if (copy) this.p._id = uid();
      const p = JSON.parse(JSON.stringify(this.p)), name = p.name || 'Unnamed';
      this.composite(this.capture('upper'), 96, 128, true, (c) => {
        let thumb = '';
        try { thumb = c.toDataURL('image/jpeg', 0.82); } catch (e) { /* tainted or unsupported: no thumbnail */ }
        const list = (store.get(K.saves, []) || []).filter((s) => s && s.id !== p._id);
        list.unshift({ id: p._id, name, ts: Date.now(), thumb, params: p });
        let ok = store.set(K.saves, list.slice(0, 40));
        if (!ok) ok = store.set(K.saves, list.slice(0, 40).map((s, i) => (i ? Object.assign({}, s, { thumb: '' }) : s)));
        this.toast(ok ? 'Saved ' + name : 'Couldn’t save — this browser blocks storage. Use Export instead.');
        this.refreshPop();
      });
    }
    exportFile() {
      this.commit();
      const data = { format: 'body-studio-character', version: 1, name: this.p.name, params: this.p };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      this.download(url, slug(this.p.name) + '.bodystudio.json');
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    importFile() {
      const f = this.fileIn.files && this.fileIn.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const d = JSON.parse(rd.result), p = d && d.params ? d.params : d;
          if (!p || typeof p !== 'object' || (p.gender === undefined && !p.details)) throw new Error('not a character');
          this.adopt(p, true);
          this.closePop();
          this.toast('Imported ' + (p.name || 'character'));
        } catch (e) { this.toast('That file isn’t a Body Studio character.'); }
        this.fileIn.value = '';
      };
      rd.readAsText(f);
    }
    download(href, name) {
      const a = h('a', { href, download: name });
      document.body.append(a);
      a.click();
      a.remove();
    }
    roster() { const r = store.get(K.roster, []); return Array.isArray(r) ? r.filter((x) => x && x.id) : []; }
    sendToGame() {
      this.commit();
      const p = JSON.parse(JSON.stringify(this.p)), name = p.name || 'Your character';
      const list = this.roster().filter((r) => r.id !== p._id);
      list.push({ id: p._id, name, params: p, ts: Date.now() });
      this.toast(store.set(K.roster, list) ? name + ' will visit the spa as a client' : 'Couldn’t reach the game — storage is blocked in this browser.');
      this.refreshPop();
    }
    playAsTherapist() {
      this.commit();
      const name = this.p.name || 'your character';
      const ok = store.set(K.therapist, { name, params: JSON.parse(JSON.stringify(this.p)), ts: Date.now() });
      this.toast(ok ? 'Next time you open Serenity Hands, you’ll be ' + name + '.' : 'Couldn’t reach the game — storage is blocked in this browser.');
      this.refreshPop();
    }
    // the Clothes Studio writes { characterId: wardrobe } back for us
    applyWardrobe(silent) {
      const map = store.get(K.wardrobe, null), p = this.p;
      const w = map && typeof map === 'object' && p._id ? map[p._id] : null;
      if (!w || JSON.stringify(w) === JSON.stringify(p.wardrobe || null)) return;
      p.wardrobe = w;
      this.queue(1);
      if (!silent) { this.commit(); this.refreshDerived(); this.toast('Wardrobe from Clothes Studio applied'); }
    }

    // ---------------------------------------------------- view
    view(id) {
      const app = this.app;
      if (id === 'full') { const yaw = app.orbit.goal.yaw; app.focus('body'); app.orbit.goal.yaw = yaw; } else app.focus(id);
      if (this.dev) this.redraw();
    }
    toggleSpin(on) {
      const o = this.app.orbit;
      o.autoRotate = on === undefined ? !o.autoRotate : on;
      this.spinBtn.setAttribute('aria-pressed', String(o.autoRotate));
    }
    setQuality(v) {
      this.saveNow();
      const u = new URL(location.href);
      u.searchParams.set('quality', v);
      location.href = u.toString();
    }
    // keep the person centred in the part of the screen the UI leaves free
    layoutView() {
      const app = this.app, cam = app.camera, W = app.container.clientWidth || window.innerWidth, H = app.container.clientHeight || window.innerHeight;
      let x0 = 0, x1 = W, y1 = H;
      const y0 = this.phone ? this.top().bottom + 34 : this.top().bottom;
      if (this.phone) y1 = H - this.sheetPx();
      else if (!this.collapsed) x0 = this.panel.getBoundingClientRect().right + 8;
      const fw = Math.max(80, x1 - x0), fh = Math.max(80, y1 - y0);
      const k = (fh / H) * Math.min(1, fw / (0.72 * fh));
      cam.setViewOffset(W * k, H * k, W * k / 2 - (x0 + x1) / 2, H * k / 2 - (y0 + y1) / 2, W, H);
      this.hint.style.left = (x0 + x1) / 2 + 'px';
      if (this.phone) this.hint.style.bottom = (H - y1 + 10) + 'px';
      else this.hint.style.bottom = '';
    }
    top() { return this.root.querySelector('.bs-top').getBoundingClientRect(); }
    animateLayout(ms) {
      const t0 = performance.now();
      const step = () => { this.layoutView(); if (performance.now() - t0 < ms) requestAnimationFrame(step); };
      step();
    }
    setCollapsed(on, instant) {
      this.collapsed = !!on && !this.phone;
      this.root.classList.toggle('collapsed', this.collapsed);
      this.prefs.collapsed = this.collapsed;
      if (!instant) { this.savePrefs(); this.animateLayout(360); if (this.collapsed) this.reopen.focus(); }
      else this.layoutView();
    }

    // ---------------------------------------------------- phone bottom sheet
    sheetPx() {
      if (!this.phone) return 0;
      if (this.dragPx) return this.dragPx;
      const H = window.innerHeight;
      return this.sheet === 'peek' ? this.peekPx() : this.sheet === 'full' ? H - this.top().bottom - 8 : Math.round(H * 0.46);
    }
    peekPx() { return this.handle.offsetHeight + this.panel.querySelector('.bs-tabs').offsetHeight + 10; }
    setSheet(state, instant) {
      this.sheet = ['peek', 'half', 'full'].includes(state) ? state : 'half';
      this.prefs.sheet = this.sheet;
      if (!this.phone) return;
      this.panel.style.height = this.sheetPx() + 'px';
      this.root.dataset.sheet = this.sheet;
      if (!instant) { this.savePrefs(); this.animateLayout(320); } else this.layoutView();
    }
    bindSheet(handle) {
      let y0 = 0, h0 = 0, moved = false, id = null;
      handle.addEventListener('pointerdown', (e) => {
        if (!this.phone) return;
        id = e.pointerId;
        handle.setPointerCapture(id);
        y0 = e.clientY; h0 = this.sheetPx(); moved = false;
        this.panel.classList.add('dragging');
      });
      handle.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        const d = y0 - e.clientY;
        if (Math.abs(d) > 4) moved = true;
        if (!moved) return;
        this.dragPx = clamp(h0 + d, this.peekPx(), window.innerHeight - this.top().bottom - 8);
        this.panel.style.height = this.dragPx + 'px';
        this.layoutView();
      });
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        this.panel.classList.remove('dragging');
        const px = this.dragPx;
        this.dragPx = 0;
        if (!moved) { this.setSheet(this.sheet === 'peek' ? 'half' : this.sheet === 'half' ? 'full' : 'peek'); return; }
        const H = window.innerHeight, snaps = [['peek', this.peekPx()], ['half', H * 0.46], ['full', H - this.top().bottom - 8]];
        snaps.sort((a, b) => Math.abs(a[1] - px) - Math.abs(b[1] - px));
        this.setSheet(snaps[0][0]);
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
      handle.addEventListener('keydown', (e) => {
        const order = ['peek', 'half', 'full'], i = order.indexOf(this.sheet);
        if (e.key === 'ArrowUp') { e.preventDefault(); this.setSheet(order[Math.min(2, i + 1)]); }
        if (e.key === 'ArrowDown') { e.preventDefault(); this.setSheet(order[Math.max(0, i - 1)]); }
      });
    }

    // ---------------------------------------------------- global events
    bindGlobal() {
      const app = this.app;
      window.addEventListener('resize', () => {
        const was = this.phone;
        this.phone = this.mq.matches;
        if (was !== this.phone) {
          this.panel.style.height = '';
          this.closePop();
          if (this.phone) { this.root.classList.remove('collapsed'); this.collapsed = false; this.setSheet(this.sheet, true); }
          this.panel.querySelector('.bs-tabs').setAttribute('aria-orientation', this.phone ? 'horizontal' : 'vertical');
        }
        if (this.phone) this.panel.style.height = this.sheetPx() + 'px';
        this.layoutView();
      });
      window.addEventListener('keydown', (e) => this.onKey(e));
      document.addEventListener('pointerdown', (e) => {
        if (this.pop && !this.pop.el.contains(e.target) && !this.pop.btn.contains(e.target)) this.closePop();
      }, true);
      // first drag on the canvas retires the hint
      const cv = app.renderer.domElement;
      cv.addEventListener('pointerdown', () => { this.hint.classList.add('gone'); }, { once: true });
      setTimeout(() => this.hint.classList.add('gone'), 9000);
      // Clothes Studio writes the wardrobe in another tab
      window.addEventListener('storage', (e) => { if (e.key === K.wardrobe) this.applyWardrobe(); });
      window.addEventListener('focus', () => this.applyWardrobe());
      window.addEventListener('pagehide', () => this.saveNow());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.saveNow(); else this.applyWardrobe(); });
    }
    onKey(e) {
      const t = e.target, tag = t.tagName || '';
      const typing = (tag === 'INPUT' && !/^(range|checkbox|radio|button|color)$/.test(t.type)) || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
      if (e.key === 'Escape') {
        if (this.pop) { this.closePop(true); e.preventDefault(); } else this.hideInfo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (typing || (k !== 'z' && k !== 'y')) return;
        e.preventDefault();
        if (k === 'y' || e.shiftKey) this.redo(); else this.undo();
        return;
      }
      if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); this.randomize(); }
      else if (e.key === ' ' && !/^(BUTTON|A|INPUT|SUMMARY)$/.test(tag)) { e.preventDefault(); this.toggleSpin(); }
      else if (e.key >= '1' && e.key <= '5' && tag !== 'INPUT') { e.preventDefault(); this.view(VIEWS[+e.key - 1][0]); }
    }
    hideInfo() { if (this.info) this.info.hidden = true; }
    toast(msg) {
      const t = h('div', { class: 'bs-toast', text: msg });
      this.toasts.append(t);
      while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
      setTimeout(() => t.classList.add('out'), 3200);
      setTimeout(() => t.remove(), 3700);
    }
    savePrefs() { store.set(K.ui, this.prefs); }
  }

  BS.UI = function (app, root) {
    const ui = new Studio(app, root);
    app.ui = ui;
    return ui;
  };
})();
