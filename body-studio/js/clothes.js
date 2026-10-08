// Body Studio — Clothes Studio (clothes.html). Two rooms:
//
//   Wardrobe    dress a Body Studio character piece by piece (fabric, print,
//               colours, print size) on the real body. The wardrobe goes back
//               to Body Studio, and with the character into Serenity Hands.
//   Home & Spa  massage-table sheets, bath towels, blankets, throws, bed
//               sheets and mats. Cloth is simulated (BS.Textiles.Cloth) on a
//               massage table, a bed or a towel rail; drag it to move it. Mats
//               roll and unroll. The table sheet, towel and blanket can dress
//               the rooms in Serenity Hands.
//
// Storage: bodystudio.wardrobe { characterId: { slot: spec } } (read by ui.js),
//          bodystudio.textiles { tableSheet | towel | blanket: { spec } } (read by the game).
// Dev: ?mode=home&item=towel&t=4 simulates 4 s, renders and sets window.done;
//      ?mode=wardrobe&preset=Cute&t=0 does the same for the wardrobe.
(function () {
  'use strict';
  const BS = window.BS, THREE = window.THREE, TX = BS.Textiles;
  const K = {
    current: 'bodystudio.current', saves: 'bodystudio.saves', roster: 'bodystudio.roster', therapist: 'bodystudio.therapist',
    wardrobe: 'bodystudio.wardrobe', textiles: 'bodystudio.textiles', last: 'bodystudio.clothes',
  };
  const store = TX.store;
  const q = new URLSearchParams(location.search);
  const DEV_T = q.get('t') !== null ? parseFloat(q.get('t')) || 0 : null;
  const QUALITY = q.get('quality') || (/(Android|iPhone|iPad|Mobile)/i.test(navigator.userAgent) ? 'medium' : 'high');
  const uid = () => 'bs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
    return el;
  }
  // centre the 3D view in the space the side panel leaves free
  function frameAround(camera, w, hh) {
    const panel = window.innerWidth > 760 ? 376 + 24 : 0;
    camera.aspect = (w + panel) / hh;
    if (panel) camera.setViewOffset(w + panel, hh, panel, 0, w, hh); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  const section = (title, ...kids) => h('section', { class: 'cs-sec' }, h('h3', { text: title }), ...kids);

  const COLORS = ['#f6f3ee', '#e9e2d4', '#d9c6a5', '#c9b79c', '#8a7462', '#4a3628', '#1e1e22', '#3a3d45', '#2d3646', '#3b5c8a', '#8fb0d4',
    '#2f5a4a', '#8fb59a', '#6b2d3a', '#a33b2a', '#d9774f', '#e3b04b', '#e7a5b8', '#f2d0d8', '#7a6a9a', '#b9a7d6'];

  // ------------------------------------------------------- fabric editor
  // One editor for garments and textiles: fabric, print, colours, print size.
  // get() returns the spec being edited; set(patch) changes it.
  function fabricEditor(get, set, opts = {}) {
    const el = h('div', { class: 'cs-editor' });
    const paints = [];
    const doSet = (patch) => { set(patch); el.paint(); };
    const field = (label, body) => h('div', { class: 'cs-field' }, h('div', { class: 'cs-label', text: label }), body);
    const chips = (items, key, label) => {
      const row = h('div', { class: 'cs-chips', role: 'group', 'aria-label': label });
      for (const it of items) row.append(h('button', { type: 'button', class: 'cs-chip', 'data-id': it.id, text: it.label, onclick: () => doSet({ [key]: it.id }) }));
      paints.push(() => { for (const b of row.children) b.setAttribute('aria-pressed', String(b.dataset.id === String(get()[key]))); });
      return row;
    };
    const colour = (key, label) => {
      const row = h('div', { class: 'cs-swatches', role: 'group', 'aria-label': label });
      for (const c of COLORS) row.append(h('button', { type: 'button', class: 'cs-sw', 'data-c': c, title: c, 'aria-label': label + ' ' + c, style: 'background:' + c, onclick: () => doSet({ [key]: c }) }));
      const pick = h('input', { type: 'color', class: 'cs-pick', title: 'Any colour', 'aria-label': label + ': any colour', oninput: (e) => doSet({ [key]: e.target.value }) });
      row.append(pick);
      paints.push(() => {
        const v = String(get()[key] || '#888888').toLowerCase();
        if (/^#[0-9a-f]{6}$/.test(v)) pick.value = v;
        for (const b of row.querySelectorAll('.cs-sw')) b.setAttribute('aria-pressed', String(b.dataset.c === v));
      });
      return row;
    };
    const types = TX.fabricTypes().filter((t) => !opts.types || opts.types.includes(t.id));
    if (types.length > 1) el.append(field('Fabric', chips(types, 'type', 'Fabric')));
    if (!opts.noPrint) el.append(field('Print', chips(TX.fabricPatterns(), 'pattern', 'Print')));
    el.append(field('Colour', colour('color', 'Colour')));
    const second = field('Second colour', colour('color2', 'Second colour'));
    const range = h('input', { type: 'range', min: '0.4', max: '2.5', step: '0.05', 'aria-label': 'Print size', oninput: (e) => doSet({ scale: parseFloat(e.target.value) }) });
    const size = field('Print size', range);
    if (!opts.noPrint) el.append(second, size);
    paints.push(() => {
      const s = get(), solid = !s.pattern || s.pattern === 'solid';
      second.hidden = solid; size.hidden = solid;
      range.value = String(s.scale || 1);
    });
    el.paint = () => paints.forEach((f) => f());
    el.paint();
    return el;
  }

  // ------------------------------------------------------------ wardrobe
  const OUTFITS = [['underwear', 'Underwear'], ['swim', 'Swimwear'], ['sport', 'Sportswear'], ['casual', 'T-shirt & jeans'], ['dress', 'Dress'], ['formal', 'Shirt & trousers'], ['scrubs', 'Scrubs']];
  // the pieces each outfit is made of (clothing.js reads p.wardrobe[slot])
  function slotsFor(p) {
    const fem = BS.needsTop ? BS.needsTop(p) : p.gender < 0.5;
    switch (p.outfit) {
      case 'underwear': return [['underwear', 'Underwear']];
      case 'swim': return fem ? [['top', 'Swimsuit']] : [['bottom', 'Swim shorts']];
      case 'sport': return [['top', fem ? 'Sports bra' : 'Tank top'], ['bottom', 'Shorts'], ['shoes', 'Trainers']];
      case 'dress': return [['top', 'Dress'], ['bottom', 'Skirt'], ['shoes', 'Shoes']];
      case 'formal': return [['top', 'Shirt'], ['bottom', 'Trousers'], ['shoes', 'Shoes']];
      case 'scrubs': return [['top', 'Scrub top'], ['bottom', 'Scrub trousers'], ['shoes', 'Clogs']];
      default: return [['top', 'T-shirt'], ['bottom', 'Jeans'], ['shoes', 'Trainers']];
    }
  }
  const DEFAULT_TYPE = {
    underwear: { underwear: 'microfiber' }, swim: { top: 'spandex', bottom: 'nylon' }, sport: { top: 'spandex', bottom: 'nylon', shoes: 'canvas' },
    casual: { top: 'jersey', bottom: 'denim', shoes: 'canvas' }, dress: { top: 'satin', bottom: 'satin', shoes: 'leather' },
    formal: { top: 'cotton', bottom: 'wool', shoes: 'leather' }, scrubs: { top: 'cotton', bottom: 'cotton', shoes: 'rubber' },
  };
  // the spec a piece is drawn with right now
  function specFor(p, slot) {
    const w = (p.wardrobe || {})[slot];
    const c2 = p.outfit === 'dress' ? p.outfitColor : p.outfitColor2 && p.outfitColor2 !== '#d9d4cc' ? p.outfitColor2 : '#2f4466';
    const base = {
      type: (DEFAULT_TYPE[p.outfit] || {})[slot] || 'cotton', pattern: 'solid', scale: 1, color2: '#f2efe9',
      color: slot === 'bottom' ? c2 : slot === 'shoes' ? '#eceae6' : p.outfitColor || '#3a2f3f',
    };
    if (!w && p.outfit === 'dress' && slot === 'bottom' && p.wardrobe && p.wardrobe.top) return Object.assign(base, p.wardrobe.top);
    return Object.assign(base, w || {});
  }
  // characters to dress: Body Studio's current one, its saves, then presets
  function characters() {
    const out = [], seen = new Set();
    const cur = store.get(K.current, null);
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) { out.push({ id: cur._id || 'current', name: (cur.name || 'Your character') + ' (current)', params: cur, current: true }); seen.add(cur._id || 'current'); }
    for (const s of store.get(K.saves, []) || []) if (s && s.params && !seen.has(s.id)) { out.push({ id: s.id, name: s.name || 'Unnamed', params: s.params, saved: true }); seen.add(s.id); }
    for (const name of ['Woman', 'Man', 'Cute', 'Glam', 'Girl next door', 'Curvy', 'Sporty', 'Thick', 'Model', 'Pretty boy', 'Rugged', 'Androgynous']) {
      if (BS.PRESETS && BS.PRESETS[name]) out.push({ id: 'preset:' + name, name: name + ' (preset)', params: BS.PRESETS[name], preset: true });
    }
    return out;
  }

  class Wardrobe {
    constructor(studio) { this.studio = studio; this.slot = null; }

    async open() {
      const S = this.studio;
      if (this.app) { this.stage.hidden = false; this.app.hidden = false; this.app.resize(); this.panel(); return; }
      this.stage = h('div', { class: 'cs-stage' });
      S.root.prepend(this.stage);
      this.chars = characters();
      const want = q.get('preset') ? 'preset:' + q.get('preset') : q.get('id');
      this.char = this.chars.find((c) => c.id === want) || this.chars[0];
      this.p = Object.assign(BS.defaultParams(), clone(this.char.params));
      if (this.p.outfit === 'underwear' && !this.char.current && !this.char.saved) this.p.outfit = 'casual';
      S.busy('Building ' + (this.p.name || 'your character') + '…');
      const app = (this.app = new BS.App(this.stage, { quality: QUALITY }));
      await app.init(this.p);
      const resize = app.resize.bind(app);
      app.resize = () => { resize(); const r = app.renderer.domElement; frameAround(app.camera, r.clientWidth, r.clientHeight); };
      app.resize();
      this.p = app.params;
      app.focus('body', true);
      S.busy(null);
      this.panel();
    }
    close() { if (this.app) { this.app.hidden = true; this.stage.hidden = true; } }

    load(c) {
      this.char = c;
      this.p = Object.assign(BS.defaultParams(), clone(c.params));
      this.slot = null;
      this.app.setParams(this.p);
      this.panel();
    }
    // re-dress only: the body shape is unchanged, so skip the morph
    redress() {
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => {
        const app = this.app, c = app.modules.clothing;
        app.params = this.p;
        if (c) c.build(this.p);
        else app.setParams(this.p);
      });
    }

    panel() {
      const S = this.studio, el = S.panel, p = this.p;
      el.textContent = '';
      const who = h('select', { class: 'cs-select', 'aria-label': 'Character', onchange: (e) => this.load(this.chars[+e.target.value]) });
      this.chars.forEach((c, i) => who.append(h('option', { value: String(i), text: c.name, selected: c === this.char })));
      el.append(section('Character', who, h('p', { class: 'cs-note', text: 'Everyone keeps at least their underwear on. Make characters in Body Studio; they show up here.' })));

      const outfits = h('div', { class: 'cs-chips' });
      for (const [id, label] of OUTFITS) outfits.append(h('button', { type: 'button', class: 'cs-chip', 'aria-pressed': String(p.outfit === id), text: label, onclick: () => { p.outfit = id; this.slot = null; this.redress(); this.panel(); } }));
      el.append(section('Outfit', outfits));

      const slots = slotsFor(p);
      if (!slots.some(([s]) => s === this.slot)) this.slot = slots[0][0];
      const tabs = h('div', { class: 'cs-tabs', role: 'tablist' });
      for (const [id, label] of slots) tabs.append(h('button', { type: 'button', role: 'tab', class: 'cs-tab', 'aria-selected': String(id === this.slot), text: label, onclick: () => { this.slot = id; this.panel(); } }));
      const slot = this.slot;
      const editor = fabricEditor(() => specFor(p, slot), (patch) => {
        p.wardrobe = Object.assign({}, p.wardrobe || {});
        p.wardrobe[slot] = Object.assign(specFor(p, slot), patch);
        this.redress();
      }, { types: slot === 'shoes' ? ['canvas', 'leather', 'rubber', 'velvet', 'denim'] : TX.fabricTypes().map((t) => t.id).filter((t) => t !== 'rubber') });
      const reset = h('button', { type: 'button', class: 'bs-btn ghost sm', text: 'Reset this piece', onclick: () => { if (p.wardrobe) { delete p.wardrobe[slot]; if (!Object.keys(p.wardrobe).length) delete p.wardrobe; } this.redress(); this.panel(); } });
      el.append(section('Pieces', tabs, editor, reset));

      const views = h('div', { class: 'cs-row' });
      for (const [v, label] of [['body', 'Front'], ['side', 'Side'], ['back', 'Back'], ['upper', 'Close'], ['legs', 'Legs']]) views.append(h('button', { type: 'button', class: 'bs-btn ghost sm', text: label, onclick: () => this.app.focus(v) }));
      el.append(section('View', views));

      const save = h('button', { type: 'button', class: 'bs-btn primary wide', text: this.char.preset ? 'Save as a new character' : 'Save wardrobe to ' + (p.name || 'character'), onclick: () => this.save() });
      el.append(h('div', { class: 'cs-actions' }, save, h('a', { class: 'bs-btn ghost wide', href: 'index.html', text: 'Back to Body Studio' })));
    }

    save() {
      const S = this.studio, p = this.p, c = this.char;
      // presets are templates: dressing one makes a new saved character
      if (c.preset) {
        const np = clone(p);
        np._id = uid();
        np.name = np.name || 'New character';
        const list = (store.get(K.saves, []) || []).filter(Boolean);
        list.unshift({ id: np._id, name: np.name, ts: Date.now(), thumb: '', params: np });
        const ok = store.set(K.saves, list.slice(0, 40));
        if (ok) { this.chars = characters(); this.char = this.chars.find((x) => x.id === np._id) || this.char; this.p = Object.assign(BS.defaultParams(), clone(np)); this.panel(); }
        S.toast(ok ? 'Saved ' + np.name + ' with this wardrobe. Load them in Body Studio.' : 'This browser blocks storage, so nothing could be saved.');
        return;
      }
      let id = c.id;
      if (id === 'current') { id = uid(); p._id = id; }
      const map = store.get(K.wardrobe, {}) || {};
      if (p.wardrobe) map[id] = p.wardrobe; else delete map[id];
      let ok = store.set(K.wardrobe, map);
      // keep every copy of this character in step: Body Studio's current
      // one, its saves, and the ones sent to Serenity Hands
      const sync = (params) => { if (params && (params._id === id || (c.current && !params._id))) { params._id = id; params.outfit = p.outfit; if (p.wardrobe) params.wardrobe = clone(p.wardrobe); else delete params.wardrobe; return true; } return false; };
      const cur = store.get(K.current, null);
      if (cur && sync(cur)) ok = store.set(K.current, cur) && ok;
      const saves = store.get(K.saves, []) || [];
      if (saves.some((s) => s && sync(s.params))) store.set(K.saves, saves);
      const roster = store.get(K.roster, null);
      if (Array.isArray(roster) && roster.some((r) => r && sync(r.params))) store.set(K.roster, roster);
      const th = store.get(K.therapist, null);
      if (th && sync(th.params)) store.set(K.therapist, th);
      c.params = clone(p);
      S.toast(ok ? 'Wardrobe saved. Body Studio and Serenity Hands will use it.' : 'This browser blocks storage, so nothing could be saved.');
    }
  }

  // --------------------------------------------------------- home & spa
  const CLOTH_TYPES = ['cotton', 'linen', 'jersey', 'microfiber', 'satin', 'silk', 'terry', 'fleece', 'knit', 'wool', 'velvet', 'denim', 'lace'];
  const ITEMS = [
    { id: 'tableSheet', label: 'Massage table sheet', room: 'table', W: 1.0, H: 2.2, hem: [0.012, 0.02], spec: { type: 'cotton', color: '#f6f3ee' }, game: 'tableSheet', gameNote: 'the sheets on the spa’s massage tables' },
    { id: 'towel', label: 'Bath towel', room: 'rail', W: 0.7, H: 1.3, hem: [0.008, 0.012], band: [0.07, 0.11], spec: { type: 'terry', color: '#f2efe9' }, game: 'towel', gameNote: 'the towels clients lie under' },
    { id: 'blanket', label: 'Blanket', room: 'bed', W: 1.5, H: 1.9, hem: [0.02, 0.02], spec: { type: 'fleece', color: '#3a4f7a' }, game: 'blanket', gameNote: 'the blanket on the mansion bed' },
    { id: 'throw', label: 'Knitted throw', room: 'bed', W: 1.2, H: 1.5, hem: [0, 0], spec: { type: 'knit', color: '#c9b79c' } },
    { id: 'bedSheet', label: 'Bed sheet', room: 'bed', W: 2.1, H: 2.6, hem: [0.01, 0.04], spec: { type: 'cotton', color: '#e9e2d4' } },
    { id: 'yogaMat', label: 'Yoga mat', room: 'floor', mat: [1.83, 0.61, 0.005], spec: { type: 'rubber', color: '#7a6a9a' }, types: ['rubber'] },
    { id: 'massageMat', label: 'Massage mat', room: 'floor', mat: [1.95, 0.8, 0.04], spec: { type: 'canvas', color: '#2f5a4a' }, types: ['canvas', 'cotton', 'linen', 'microfiber', 'leather', 'velvet'] },
  ];

  function woodTexture() {
    const c = TX.canvas2d(512, 512), g = c.getContext('2d'), r = TX.rng(7);
    for (let i = 0; i < 8; i++) {
      const base = [118 + r() * 24, 84 + r() * 16, 58 + r() * 12];
      g.fillStyle = TX.css(base);
      g.fillRect(0, i * 64, 512, 64);
      for (let k = 0; k < 90; k++) {
        g.strokeStyle = TX.css(TX.mixRgb(base, [60, 40, 28], r() * 0.35), 0.35);
        g.lineWidth = 0.5 + r() * 1.5;
        const y = i * 64 + r() * 64;
        g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(170, y + (r() - 0.5) * 6, 340, y + (r() - 0.5) * 6, 512, y + (r() - 0.5) * 4); g.stroke();
      }
      g.fillStyle = 'rgba(30,18,10,0.55)';
      g.fillRect(0, i * 64, 512, 1.5);
      g.fillRect(((i * 197) % 512), i * 64, 1.5, 64);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    t.anisotropy = 4;
    return t;
  }

  // a room for each kind of textile: props, colliders, where a piece starts
  // (place(u, v) for flat coordinates centred on the piece) and the camera
  function buildRoom(kind) {
    const g = new THREE.Group(), cols = [];
    const std = (color, rough = 0.6, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough }, extra));
    const box = (w, hh, d, mat, x, y, z, r) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      if (r !== undefined) cols.push(TX.makeCollider('box', { cx: x, cy: y, cz: z, hx: w / 2, hy: hh / 2, hz: d / 2, r, yaw: 0 }));
      return m;
    };
    const cyl = (r, len, mat, x, y, z, rotZ) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20), mat);
      m.position.set(x, y, z);
      if (rotZ) m.rotation.z = rotZ;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return m;
    };
    cols.push(TX.makeCollider('plane', { nx: 0, ny: 1, nz: 0, d: 0 }));
    const wood = std('#ffffff', 0.7, { map: woodTexture() });
    const room = { group: g, colliders: cols };
    if (kind === 'table') {
      const leather = std('#3d5c58', 0.5), frame = std('#6b4a35', 0.55);
      box(0.68, 0.1, 1.86, leather, 0, 0.74, 0, 0.035);
      box(0.62, 0.05, 1.8, frame, 0, 0.665, 0);
      for (const x of [-0.27, 0.27]) for (const z of [-0.8, 0.8]) cyl(0.025, 0.64, frame, x, 0.32, z);
      const cradle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.045, 16, 32, Math.PI * 1.6), leather);
      cradle.rotation.set(-Math.PI / 2, 0, Math.PI * 0.7);
      cradle.position.set(0, 0.76, -1.08);
      cradle.castShadow = true;
      g.add(cradle);
      room.place = (u, v) => [u, 0.86, v];
      room.cam = [new THREE.Vector3(0, 0.62, 0), 3.4, 0.75, 0.38];
    } else if (kind === 'bed') {
      const frame = std('#5a3a28', 0.55), mattress = std('#efe9df', 0.85), pillowM = std('#f4f0e8', 0.9);
      box(1.7, 0.18, 2.12, frame, 0, 0.16, 0, 0.02);
      box(1.6, 0.24, 2.0, mattress, 0, 0.37, 0, 0.07);
      box(1.76, 0.9, 0.08, frame, 0, 0.6, -1.08, 0.02);
      for (const x of [-0.4, 0.4]) {
        const pl = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12), pillowM);
        pl.scale.set(0.62, 0.16, 0.36);
        pl.position.set(x, 0.55, -0.78);
        pl.castShadow = pl.receiveShadow = true;
        g.add(pl);
        cols.push(TX.makeCollider('box', { cx: x, cy: 0.54, cz: -0.78, hx: 0.29, hy: 0.06, hz: 0.16, r: 0.05, yaw: 0 }));
      }
      // a sheet covers the whole bed; a blanket or throw lands across the foot
      room.place = (u, v, item) => {
        if (item.W > 1.8) return [u, 0.62, v + 0.08];
        const a = 0.35, x = u * Math.cos(a) - v * Math.sin(a), z = u * Math.sin(a) + v * Math.cos(a);
        return [x + 0.15, 0.78, z + 0.42];
      };
      room.cam = [new THREE.Vector3(0, 0.4, 0.1), 4.4, 0.65, 0.42];
    } else if (kind === 'rail') {
      const metal = std('#c8c4bc', 0.25, { metalness: 0.9 }), tiles = std('#e8e4dc', 0.45);
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.6), tiles);
      wall.position.set(0, 1.3, -0.02);
      wall.receiveShadow = true;
      g.add(wall);
      cols.push(TX.makeCollider('plane', { nx: 0, ny: 0, nz: 1, d: 0 }));
      const RY = 1.2, RZ = 0.13, RR = 0.016;
      cyl(RR, 0.92, metal, 0, RY, RZ, Math.PI / 2);
      for (const x of [-0.46, 0.46]) { cyl(0.012, RZ, metal, x, RY, RZ / 2).rotation.x = Math.PI / 2; cyl(0.03, 0.012, metal, x, RY, 0.004).rotation.x = Math.PI / 2; }
      cols.push(TX.makeCollider('capsule', { ax: -0.5, ay: RY, az: RZ, bx: 0.5, by: RY, bz: RZ, r: RR }));
      // hung over the rail: the front half in front, the back half behind
      room.place = (u, v) => {
        const s = v, top = RY + RR + 0.008;
        if (Math.abs(s) < 0.02) return [u, top, RZ + s];
        return s > 0 ? [u, top - (s - 0.02), RZ + 0.03] : [u, top + (s + 0.02), RZ - 0.03];
      };
      room.cam = [new THREE.Vector3(0, 0.9, 0.1), 2.6, 0.45, 0.12];
    } else {
      room.place = (u, v) => [u, 0.3, v];
      room.cam = [new THREE.Vector3(0, 0.05, 0), 3.0, 0.6, 0.55];
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), wood);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);
    if (kind !== 'rail') {
      const back = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.2), std('#d9d2c6', 0.9));
      back.position.set(0, 1.6, -2.2);
      back.receiveShadow = true;
      g.add(back);
    }
    return room;
  }

  class Home {
    constructor(studio) {
      this.studio = studio;
      const last = store.get(K.last, {}) || {};
      this.designs = Object.assign({}, last.designs || {});
      this.item = ITEMS.find((i) => i.id === (q.get('item') || last.item)) || ITEMS[0];
      this.wind = false;
    }
    spec() { return Object.assign({ pattern: 'solid', scale: 1, color2: '#f2efe9' }, this.item.spec, this.designs[this.item.id] || {}); }
    remember() { store.set(K.last, { item: this.item.id, designs: this.designs }); }

    open() {
      if (!this.renderer) this.init();
      this.stage.hidden = false;
      this.active = true;
      this.resize();
      this.panel();
      if (DEV_T === null) this.loop();
    }
    close() { this.active = false; if (this.stage) this.stage.hidden = true; cancelAnimationFrame(this.raf); }

    init() {
      const S = this.studio;
      this.stage = h('div', { class: 'cs-stage cs-home' });
      S.root.prepend(this.stage);
      const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY === 'high' ? 2 : 1.5));
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.domElement.className = 'bs-canvas';
      this.stage.append(r.domElement);
      const scene = (this.scene = new THREE.Scene());
      scene.background = new THREE.Color('#2a2b30');
      if (BS.studioEnvironment) { scene.environment = BS.studioEnvironment(r); }
      scene.add(new THREE.HemisphereLight(0xf2f0ea, 0x4a3b30, 0.45));
      const key = new THREE.DirectionalLight(0xfff0e2, 2.2);
      key.position.set(-2.2, 4.2, 2.6);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: 0.5, far: 12 });
      key.shadow.bias = -0.0003; key.shadow.normalBias = 0.01; key.shadow.radius = 4;
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
      fill.position.set(3, 2, 2.5);
      scene.add(fill);
      this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 40);
      this.orbit = new BS.OrbitRig(this.camera, r.domElement);
      this.orbit.minDist = 0.6; this.orbit.maxDist = 8;
      this.clock = new THREE.Clock();
      this.ray = new THREE.Raycaster();
      this.grabPlane = new THREE.Plane();
      // drag the cloth (the camera turns when you drag anywhere else)
      const dom = r.domElement, ndc = new THREE.Vector2(), hit = new THREE.Vector3();
      const toRay = (e) => { const b = dom.getBoundingClientRect(); ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1); this.ray.setFromCamera(ndc, this.camera); };
      dom.addEventListener('pointerdown', (e) => {
        if (!this.cloth || e.button !== 0) return;
        toRay(e);
        const hits = this.ray.intersectObject(this.mesh, false);
        if (!hits.length) return;
        e.stopImmediatePropagation();
        dom.setPointerCapture(e.pointerId);
        const pt = hits[0].point;
        this.grabPlane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()).negate(), pt);
        this.cloth.cl.grabStart(pt, 0.07);
        this.grabbing = e.pointerId;
      }, { capture: true });
      dom.addEventListener('pointermove', (e) => {
        if (this.grabbing !== e.pointerId) return;
        e.stopImmediatePropagation();
        toRay(e);
        if (this.ray.ray.intersectPlane(this.grabPlane, hit)) { hit.y = Math.max(hit.y, 0.02); this.cloth.cl.grabMove(hit); }
      }, { capture: true });
      const end = (e) => { if (this.grabbing !== e.pointerId) return; this.grabbing = null; if (this.cloth) this.cloth.cl.grabEnd(); };
      dom.addEventListener('pointerup', end, { capture: true });
      dom.addEventListener('pointercancel', end, { capture: true });
      window.addEventListener('resize', () => this.active && this.resize());
      this.build();
    }
    resize() {
      const w = this.stage.clientWidth || window.innerWidth, hh = this.stage.clientHeight || window.innerHeight;
      this.renderer.setSize(w, hh, false);
      this.renderer.domElement.style.width = w + 'px';
      this.renderer.domElement.style.height = hh + 'px';
      frameAround(this.camera, w, hh);
    }

    // (re)build the room and the piece for the current item
    build() {
      const item = this.item, spec = this.spec();
      if (!this.room || this.roomKind !== item.room) {
        if (this.room) { this.scene.remove(this.room.group); this.room.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
        this.room = buildRoom(item.room);
        this.roomKind = item.room;
        this.scene.add(this.room.group);
        const c = this.room.cam;
        this.orbit.frame(c[0], c[1], c[2], c[3], true);
        this.orbit.snap();
      }
      this.clearPiece();
      if (item.mat) this.buildMat(item, spec); else this.buildCloth(item, spec);
    }
    clearPiece() {
      if (this.mesh) { this.scene.remove(this.mesh); const m = this.mesh.material; (Array.isArray(m) ? m : [m]).forEach((x) => TX.disposeMaterial(x)); }
      if (this.skin) this.skin.dispose();
      if (this.rollMat) this.rollMat.dispose();
      this.mesh = this.skin = this.cloth = this.rollMat = null;
    }
    buildCloth(item, spec) {
      const ph = TX.phys(spec.type);
      const [nx, ny] = TX.gridSize(item.W, item.H, QUALITY === 'high' ? 2600 : 1300, 0.02);
      const n = nx * ny, cl = new TX.Cloth(n), idx = new Int32Array(n);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i, u = (i / (nx - 1)) * item.W, v = (j / (ny - 1)) * item.H;
        idx[k] = k;
        cl.flat[k * 2] = u; cl.flat[k * 2 + 1] = v; cl.gu[k] = i; cl.gv[k] = j;
        const P = this.room.place(u - item.W / 2, v - item.H / 2, item);
        cl.p[k * 3] = P[0]; cl.p[k * 3 + 1] = P[1]; cl.p[k * 3 + 2] = P[2];
      }
      TX.addGridConstraints(cl, nx, ny, idx, ph, 0);
      cl.setTris(TX.gridTris(nx, ny));
      cl.gsm = ph.gsm; cl.friction = ph.fr;
      cl.radius = Math.max(0.004, ph.t * 0.6 + 0.003);
      cl.colliders = this.room.colliders;
      cl.windAmt = this.wind ? 2.5 : 0;
      cl.finalize();
      this.cloth = { cl, nx, ny };
      this.skin = new TX.GridSkin({ nx, ny, idx, W: item.W, H: item.H, refine: QUALITY === 'high' ? 2 : 1, thick: Math.max(0.0015, ph.t), mirrorU: false });
      const mat = TX.material(spec, { space: 'uv', side: THREE.FrontSide });
      const band = item.band || [0, 0];
      const U = {
        uSize: { value: new THREE.Vector2(item.W, item.H) },
        uHem: { value: new THREE.Vector4(item.hem ? item.hem[0] : 0.01, item.hem ? item.hem[1] : 0.01, 0.0012, item.hem && item.hem[0] ? 1 : 0) },
        uBand: { value: new THREE.Vector4(band[0], band[1], 0.55, band[1] > 0 ? 1 : 0) },
        uBandColor: { value: new THREE.Color(spec.color2 || '#d9d2c6') },
        uThread: { value: new THREE.Color(spec.color).multiplyScalar(0.8) },
      };
      TX.addTextileDetail(mat, U);
      this.detail = U;
      this.mesh = new THREE.Mesh(this.skin.geo, mat);
      this.mesh.castShadow = this.mesh.receiveShadow = true;
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
      this.skin.update(cl.p);
    }
    buildMat(item, spec) {
      const [L, Wd, t] = item.mat;
      this.rollMat = new TX.RollMat(L, Wd, t, { segments: QUALITY === 'high' ? 160 : 90, roll: 0 });
      const top = TX.material(spec, { space: 'uv', side: THREE.FrontSide });
      const edge = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color).multiplyScalar(0.7), roughness: 0.8 });
      this.mesh = new THREE.Mesh(this.rollMat.geo, [top, edge]);
      this.mesh.castShadow = this.mesh.receiveShadow = true;
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
    }
    // restyle in place when only the look changes; re-drop when the physics do
    setSpec(patch) {
      const before = this.spec();
      this.designs[this.item.id] = Object.assign(before, patch);
      this.remember();
      const s = this.spec();
      if (patch.type && patch.type !== before.type) return this.build();
      const mats = this.mesh ? (Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material]) : [];
      if (BS.Fabric && BS.Fabric.update && mats[0] && mats[0].userData.fabric) BS.Fabric.update(mats[0], s);
      else return this.build();
      if (mats[1]) mats[1].color.set(s.color).multiplyScalar(0.7);
      if (this.detail) { this.detail.uBandColor.value.set(s.color2 || '#d9d2c6'); this.detail.uThread.value.set(s.color).multiplyScalar(0.8); }
    }

    frame(dt) {
      if (this.cloth) {
        const cl = this.cloth.cl;
        if (cl.step(1 / 60)) this.skin.update(cl.p);
      }
      if (this.rollMat) this.rollMat.update(dt);
      this.orbit.update(dt);
      this.renderer.render(this.scene, this.camera);
    }
    loop() {
      cancelAnimationFrame(this.raf);
      const step = () => {
        if (!this.active) return;
        this.raf = requestAnimationFrame(step);
        this.frame(Math.min(0.05, this.clock.getDelta()));
      };
      step();
    }
    devRun(seconds) {
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        if (this.cloth) this.cloth.cl.step(1 / 60);
        if (this.rollMat) this.rollMat.update(1 / 60);
      }
      if (this.cloth) this.skin.update(this.cloth.cl.p);
      this.orbit.update(1); this.orbit.snap();
      this.renderer.render(this.scene, this.camera);
    }

    panel() {
      const S = this.studio, el = S.panel, item = this.item;
      el.textContent = '';
      const list = h('div', { class: 'cs-items' });
      for (const it of ITEMS) list.append(h('button', { type: 'button', class: 'cs-item', 'aria-pressed': String(it === item), onclick: () => { this.item = it; this.remember(); this.build(); this.panel(); } },
        h('span', { class: 'dot', style: 'background:' + (Object.assign({}, it.spec, this.designs[it.id] || {}).color) }), h('span', { text: it.label })));
      el.append(section('Textiles', list));
      const editor = fabricEditor(() => this.spec(), (patch) => this.setSpec(patch), { types: item.types || CLOTH_TYPES, noPrint: item.id === 'yogaMat' });
      el.append(section(item.label, editor));
      const row = h('div', { class: 'cs-row' });
      if (item.mat) {
        row.append(h('button', { type: 'button', class: 'bs-btn ghost sm', text: 'Roll up', onclick: () => { this.rollMat.goal = 1; } }));
        row.append(h('button', { type: 'button', class: 'bs-btn ghost sm', text: 'Unroll', onclick: () => { this.rollMat.goal = 0; } }));
      } else {
        row.append(h('button', { type: 'button', class: 'bs-btn ghost sm', text: 'Drop again', onclick: () => this.build() }));
        const wind = h('button', { type: 'button', class: 'bs-btn ghost sm', 'aria-pressed': String(this.wind), text: 'Breeze', onclick: () => { this.wind = !this.wind; wind.setAttribute('aria-pressed', String(this.wind)); if (this.cloth) { this.cloth.cl.windAmt = this.wind ? 2.5 : 0; this.cloth.cl.wake(); } } });
        row.append(wind);
      }
      el.append(section('Play', row, h('p', { class: 'cs-note', text: item.mat ? 'Mats are foam: they roll up and lie flat.' : 'Drag the cloth to pick it up and drop it. Drag anywhere else to turn the room.' })));
      if (item.game) {
        const used = (store.get(K.textiles, {}) || {})[item.game];
        el.append(h('div', { class: 'cs-actions' },
          h('button', { type: 'button', class: 'bs-btn primary wide', text: 'Use in Serenity Hands', onclick: () => {
            const map = store.get(K.textiles, {}) || {};
            map[item.game] = { spec: this.spec(), label: item.label, ts: Date.now() };
            S.toast(store.set(K.textiles, map) ? 'Serenity Hands will use this for ' + item.gameNote + '.' : 'This browser blocks storage, so nothing could be saved.');
            this.panel();
          } }),
          used ? h('p', { class: 'cs-note', text: 'Serenity Hands uses a design of yours for ' + item.gameNote + '.' }) : null));
      }
    }
  }

  // --------------------------------------------------------------- shell
  class Studio {
    constructor(root) {
      this.root = root;
      this.top = h('header', { class: 'cs-top glass' },
        h('a', { class: 'cs-brand', href: 'index.html', title: 'Back to Body Studio' }, h('b', { text: 'Clothes Studio' }), h('span', { text: 'Body Studio' })));
      this.modes = h('div', { class: 'cs-modes', role: 'tablist', 'aria-label': 'Room' });
      for (const [id, label] of [['wardrobe', 'Wardrobe'], ['home', 'Home & Spa']]) this.modes.append(h('button', { type: 'button', role: 'tab', 'data-mode': id, text: label, onclick: () => this.go(id) }));
      this.top.append(this.modes);
      this.panel = h('div', { class: 'cs-panel glass' });
      this.toastEl = h('div', { class: 'cs-toast', role: 'status', 'aria-live': 'polite' });
      this.busyEl = h('div', { class: 'cs-busy', hidden: true }, h('div', { class: 'spinner' }), h('p'));
      root.append(this.top, this.panel, this.toastEl, this.busyEl);
      this.wardrobe = new Wardrobe(this);
      this.home = new Home(this);
    }
    async go(mode) {
      if (this.mode === mode) return;
      this.mode = mode;
      for (const b of this.modes.children) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
      const last = store.get(K.last, {}) || {};
      last.mode = mode;
      store.set(K.last, Object.assign(store.get(K.last, {}) || {}, { mode }));
      if (mode === 'home') { this.wardrobe.close(); this.home.open(); } else { this.home.close(); await this.wardrobe.open(); }
    }
    toast(msg) {
      this.toastEl.textContent = msg;
      this.toastEl.classList.add('on');
      clearTimeout(this.toastT);
      this.toastT = setTimeout(() => this.toastEl.classList.remove('on'), 3200);
    }
    busy(msg) { this.busyEl.hidden = !msg; if (msg) this.busyEl.querySelector('p').textContent = msg; }
  }

  BS.ClothesStudio = { Studio, ITEMS, specFor, slotsFor };
  BS.Textiles.boot = async function (root) {
    const S = new Studio(root);
    window.studio = S;
    const mode = q.get('mode') || (q.get('id') ? 'wardrobe' : (store.get(K.last, {}) || {}).mode) || 'wardrobe';
    try {
      await S.go(mode === 'home' ? 'home' : 'wardrobe');
      if (DEV_T !== null && S.mode === 'home') S.home.devRun(DEV_T);
    } catch (e) {
      console.error(e);
      S.busy('Clothes Studio could not start: ' + e.message);
      window.err = String((e && e.stack) || e);
    }
    window.csReady = true;
    window.done = true;
    return S;
  };
})();
