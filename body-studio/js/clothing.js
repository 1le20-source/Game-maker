// Body Studio clothing: garments fitted to any body, with real fabric.
//
// Most garments are shells of the body itself: they share the body mesh's
// vertices and skinning (so they move exactly with it), are pushed out along
// the normal by the fabric's thickness plus any ease, and are cut by a
// per-vertex signed coverage value (meters) so necklines, sleeves and leg
// openings get clean hem lines. Skirts hang from the hips as their own tube.
// Fabric shading comes from BS.Fabric (fabric.js) in rest space.
//
// Underwear is the minimum outfit: anyone whose chest calls for it always
// gets a bra or a top.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const THREE = window.THREE;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

  const OUTFITS = [
    { id: 'underwear', label: 'Underwear' }, { id: 'swim', label: 'Swimwear' }, { id: 'sport', label: 'Sportswear' },
    { id: 'casual', label: 'T-shirt & jeans' }, { id: 'dress', label: 'Dress' }, { id: 'formal', label: 'Shirt & trousers' },
    { id: 'scrubs', label: 'Scrubs' },
  ];

  // bone name -> body part
  function partOf(name) {
    const side = /\.L$/.test(name) ? 1 : /\.R$/.test(name) ? -1 : 0;
    let k = 'torso';
    if (/^(neck)/.test(name)) k = 'neck';
    else if (/^(head|jaw|eye|tongue|levator|oris|risorius|temporalis|oculi|orbicularis|special)/.test(name)) k = 'head';
    else if (/^breast/.test(name)) k = 'breast';
    else if (/^clavicle/.test(name)) k = 'clavicle';
    else if (/^shoulder/.test(name)) k = 'shoulder';
    else if (/^upperarm/.test(name)) k = 'uarm';
    else if (/^lowerarm/.test(name)) k = 'farm';
    else if (/^(wrist|metacarpal|finger)/.test(name)) k = 'hand';
    else if (/^upperleg/.test(name)) k = 'thigh';
    else if (/^lowerleg/.test(name)) k = 'shin';
    else if (/^(foot|toe)/.test(name)) k = 'foot';
    return { k, side };
  }

  // does this person wear a bra/top with their underwear? (never optional
  // when the chest calls for it)
  function needsTop(p) {
    const fem = ['woman', 'transwoman'].includes(p.identity);
    // MakeHuman's breast shapes fade out only near the male end of the
    // gender slider, so anyone short of it wears a top
    return fem || p.gender < 0.72 || (p.breastSize > 0.55 && p.gender < 0.9);
  }

  // ------------------------------------------------------------ garments
  // Each returns { cov(i) -> signed meters (>0 = covered), ease(i) -> extra
  // offset in meters, thick, fabric, slot }.
  function garments(ctx, p) {
    const G = [];
    const { pos, part, L, t } = ctx;
    const y = (i) => pos[i * 3 + 1], x = (i) => pos[i * 3], z = (i) => pos[i * 3 + 2];
    const trunk = (k) => k === 'torso' || k === 'breast' || k === 'clavicle';
    const wear = (slot, base) => {
      const w = (p.wardrobe && p.wardrobe[slot]) || {};
      return Object.assign({}, base, w);
    };
    const c1 = p.outfitColor || '#2d3646', c2 = p.outfitColor2 || '#d9d4cc';
    const fem = needsTop(p);

    // --- pieces
    const briefs = (style, fabric) => ({
      slot: 'underwear', thick: 0.0022, fabric,
      cov(i) {
        const k = part[i].k;
        if (trunk(k)) return L.lowWaistY - y(i);
        if (k === 'thigh') {
          if (style === 'boxer') return y(i) - (L.crotchY - 0.13 * L.H / 1.7);
          // high-cut leg opening: crotch on the inside, up toward the hip outside
          const out = smooth(L.innerX, L.hipHalfW, Math.abs(x(i)));
          return y(i) - (L.crotchY - 0.012 + out * (L.hipY + 0.012 - L.crotchY) * (style === 'bikini' ? 0.95 : 0.75));
        }
        return -1;
      },
      ease: () => 0,
    });
    const bra = (kind, fabric) => ({
      slot: 'underwear', thick: kind === 'sports' ? 0.0035 : 0.0026, fabric, tent: kind === 'sports' ? 6 : 4, slope: 0.35,
      cov(i) {
        const k = part[i].k, body = trunk(k);
        // band and cups on the torso only (the 'shoulder' part reaches down
        // the inner arm); straps may run over the shoulder and clavicle
        if (!(body || k === 'shoulder' || k === 'neck')) return -0.02;
        const yy = y(i), xx = Math.abs(x(i)), front = z(i) > L.chestZ0;
        const sports = kind === 'sports';
        const bandH = sports ? 0.05 : 0.016;
        let s = -0.02;
        if (body) {
          // band all the way round, just under the bust
          s = bandH / 2 - Math.abs(yy - (L.bandY + bandH / 2));
          if (front) {
            // cups: round over the top of the breast; below the nipple the
            // inner edge slopes in to a centre gore, the outer edge drops to the band
            const r = L.cupR, cy = L.nippleY - r * 0.12, dx = xx - L.nippleX * 0.97, dy = yy - cy;
            const cup = dy > 0 ? r - Math.hypot(dx * 1.05, dy) : Math.min(r * 1.02 - dx, r * 1.02 + dx - dy * 0.9, yy - L.bandY + 0.006);
            const topLine = (sports ? L.nippleY + r * 1.1 : L.nippleY + r * (kind === 'swim' ? 0.75 : 0.62)) - yy;
            const gore = Math.min(L.bandY + r * 0.55 - yy - xx * 0.6, yy - L.bandY + 0.006);
            s = Math.max(s, Math.min(cup, topLine), gore);
            if (sports) s = Math.max(s, Math.min(topLine - xx * 0.15, yy - L.bandY + 0.01, L.nippleX + r - xx));
          } else if (sports) {
            // racerback
            s = Math.max(s, Math.min(L.bandY + bandH + 0.02 - yy, 0.07 - xx), Math.min(0.03 - Math.abs(xx - 0.035 + (yy - L.bandY) * 0.12), L.shoulderY + 0.02 - yy));
          }
        }
        // straps: from the top of each cup over the shoulder and down the back to the band
        const y0 = front ? L.nippleY : L.bandY;
        if (yy > y0 - 0.02 && !(sports && !front)) {
          const tt = clamp((yy - y0) / (L.shoulderY - y0), 0, 1), x0 = L.nippleX * (front ? 0.9 : 0.8);
          const sx = x0 + (L.strapTopX - x0) * tt;
          s = Math.max(s, (sports ? 0.018 : 0.0065) - Math.abs(xx - sx));
        }
        return s;
      },
      ease: () => 0,
    });
    const top = (cfg, fabric) => ({
      slot: 'top', thick: cfg.thick || 0.0035, fabric, tent: 10, slope: 0.22,
      cov(i) {
        const k = part[i].k, yy = y(i), xx = Math.abs(x(i)), front = z(i) > L.chestZ0;
        // neckline: crew / scoop / v; and the hem
        let neckY = L.neckBaseY - 0.012;
        if (front) {
          if (cfg.neck === 'v') neckY -= Math.max(0, 0.13 - xx * 1.9);
          else if (cfg.neck === 'scoop') neckY -= (cfg.sleeveless ? 0.13 : 0.07) * (1 - smooth(0.0, L.strapTopX * 1.05, xx)) + 0.02;
          else neckY -= 0.022 * (1 - smooth(0.02, 0.08, xx));
        } else if (cfg.neck === 'scoop' && cfg.sleeveless) neckY -= 0.06 * (1 - smooth(0.0, L.strapTopX * 1.05, xx));
        const hem = yy - (cfg.hemY !== undefined ? cfg.hemY : L.hipY + 0.055);
        if (trunk(k) || k === 'neck') {
          let s = Math.min(neckY - yy, hem);
          // sleeveless: armholes cut out beside the straps; the neckline
          // shapes the front between them
          if (cfg.sleeveless) {
            const outer = L.strapTopX * 1.05 + (cfg.strapW || 0.022);
            s = Math.min(s, Math.max(L.underarmY - yy, outer - xx));
          }
          return s;
        }
        if (cfg.sleeveless && (k === 'shoulder' || k === 'uarm')) {
          const outer = L.strapTopX * 1.05 + (cfg.strapW || 0.022);
          return Math.min(neckY - yy, hem, k === 'uarm' ? outer - xx : Math.max(L.underarmY - yy, outer - xx));
        }
        if (k === 'shoulder') return neckY - yy + 0.2;
        if (cfg.sleeveless) return -0.05;
        if (k === 'uarm') return (cfg.sleeve - t[i]) * L.uarmLen;
        if (k === 'farm') return cfg.sleeve > 1 ? (cfg.sleeve - 1 - t[i]) * L.farmLen : -1;
        return -1;
      },
      // tops hang over the waistband of whatever is worn below
      ease: (i) => (part[i].k === 'torso' && y(i) < L.waistY + 0.03 ? 0.006 : 0) + (cfg.loose || 0),
    });
    const bottoms = (cfg, fabric) => ({
      slot: 'bottom', thick: cfg.thick || 0.004, fabric, tent: 12, slope: 0.24,
      cov(i) {
        const k = part[i].k, yy = y(i);
        if (trunk(k)) return (cfg.riseY !== undefined ? cfg.riseY : L.waistY - 0.015) - yy;
        if (k === 'thigh') return cfg.endY !== undefined ? yy - cfg.endY : 1;
        if (k === 'shin') return cfg.endY !== undefined ? yy - cfg.endY : yy - (L.ankleY + 0.035);
        return -1;
      },
      ease: (i) => {
        const k = part[i].k;
        // trousers bridge the crotch with a seam instead of following the body into it
        const yy = y(i), xx = Math.abs(x(i));
        const crotch = (cfg.thick || 0.004) * 2.2 * (1 - smooth(0.0, 0.08, Math.abs(yy - (L.crotchY + 0.015)))) * (1 - smooth(0.02, 0.075, xx));
        return crotch + (k === 'shin' ? cfg.looseShin || 0 : k === 'thigh' ? cfg.looseThigh || 0 : 0);
      },
    });
    const shoes = (cfg, fabric) => ({
      slot: 'shoes', thick: cfg.thick || 0.006, fabric,
      cov(i) {
        const k = part[i].k, yy = y(i);
        if (k === 'foot') return cfg.low ? Math.min(1, L.ankleY - 0.012 - yy + 0.02 * smooth(0, 0.08, z(i) - L.ankleZ)) : 1;
        if (k === 'shin') return (cfg.high ? L.ankleY + 0.05 : L.ankleY + 0.01) - yy;
        return -1;
      },
      ease: (i) => (y(i) < 0.022 ? 0.006 : 0),
    });
    const sole = (cfg, fabric) => ({
      slot: 'shoes', thick: (cfg.thick || 0.006) + 0.004, fabric,
      cov(i) { return part[i].k === 'foot' ? (cfg.soleH || 0.022) - y(i) : -1; },
      ease: () => 0,
    });
    const onePiece = (fabric) => ({
      slot: 'top', thick: 0.0025, fabric,
      cov(i) {
        const k = part[i].k, yy = y(i), xx = Math.abs(x(i)), front = z(i) > L.chestZ0;
        if (k === 'thigh') return briefs('bikini').cov(i);
        if (!(trunk(k) || k === 'shoulder')) return -1;
        let s = (front ? L.nippleY + 0.06 - xx * 0.2 : L.bandY + 0.02) - yy;
        s = Math.max(s, bra('swim').cov(i));
        return s;
      },
      ease: () => 0,
    });

    // --- outfits
    const U = { type: 'microfiber', color: c1, pattern: 'solid', scale: 1 };
    const id = p.outfit || 'underwear';
    // outfits defined in other files (js/swimwear.js): BS.OUTFIT_BUILDERS[id](kit) -> garment list
    const ext = BS.OUTFIT_BUILDERS && BS.OUTFIT_BUILDERS[id];
    if (ext) {
      const kit = { p, ctx, L, part, pos, x, y, z, trunk, wear, fem, c1, c2, U, smooth, clamp, briefs, bra, top, bottoms, shoes, sole, onePiece };
      return G.concat(ext(kit) || []);
    }
    if (id === 'underwear') {
      G.push(briefs(fem ? 'briefs' : 'boxer', wear('underwear', Object.assign({}, U, { type: fem ? 'microfiber' : 'jersey' }))));
      if (fem) G.push(bra('bra', wear('underwear', Object.assign({}, U, { type: 'microfiber' }))));
    } else if (id === 'swim') {
      const sw = wear('top', { type: 'spandex', color: c1, pattern: 'solid' });
      if (fem) G.push(onePiece(sw));
      else G.push(bottoms({ riseY: L.lowWaistY + 0.02, endY: L.crotchY - 0.13, looseThigh: 0.012, thick: 0.003 }, wear('bottom', { type: 'nylon', color: c1, pattern: 'solid' })));
    } else if (id === 'sport') {
      if (fem) G.push(bra('sports', wear('top', { type: 'spandex', color: c1 })));
      else G.push(top({ sleeveless: true, neck: 'scoop', loose: 0.004 }, wear('top', { type: 'jersey', color: c1 })));
      G.push(bottoms({ riseY: L.waistY - 0.03, endY: L.kneeY + 0.09, looseThigh: 0.01, thick: 0.003 }, wear('bottom', { type: 'nylon', color: c2 })));
      G.push(shoes({}, wear('shoes', { type: 'canvas', color: '#eceae6' })), sole({}, { type: 'rubber', color: '#f4f2ee' }));
    } else if (id === 'casual') {
      G.push(top({ neck: 'crew', sleeve: 0.45, loose: 0.003 }, wear('top', { type: 'jersey', color: c1 })));
      G.push(bottoms({ looseShin: 0.022, looseThigh: 0.01, thick: 0.005 }, wear('bottom', { type: 'denim', color: c2 === '#d9d4cc' ? '#2f4466' : c2 })));
      G.push(shoes({}, wear('shoes', { type: 'canvas', color: '#f1efea' })), sole({}, { type: 'rubber', color: '#f7f6f2' }));
    } else if (id === 'dress') {
      G.push(top({ neck: 'scoop', sleeveless: true, strapW: 0.028, hemY: L.hipY - 0.01, thick: 0.003 }, wear('top', { type: 'satin', color: c1 })));
      G.push(briefs('briefs', U));
      G.push(shoes({ low: true, thick: 0.004 }, wear('shoes', { type: 'leather', color: '#2a1f1c' })), sole({ soleH: 0.012, thick: 0.004 }, { type: 'leather', color: '#1a1412' }));
    } else if (id === 'formal') {
      G.push(top({ neck: 'crew', sleeve: 1.97, thick: 0.004, loose: 0.004 }, wear('top', { type: 'cotton', color: c1 })));
      G.push(bottoms({ looseShin: 0.026, looseThigh: 0.014, thick: 0.005 }, wear('bottom', { type: 'wool', color: c2 === '#d9d4cc' ? '#2b2d33' : c2 })));
      G.push(shoes({ low: true }, wear('shoes', { type: 'leather', color: '#1d1714' })), sole({}, { type: 'leather', color: '#120e0c' }));
    } else if (id === 'scrubs') {
      G.push(top({ neck: 'v', sleeve: 0.5, hemY: L.hipY - 0.07, loose: 0.009, thick: 0.004 }, wear('top', { type: 'cotton', color: c1 })));
      G.push(bottoms({ looseShin: 0.03, looseThigh: 0.018, thick: 0.004 }, wear('bottom', { type: 'cotton', color: c1 })));
      G.push(shoes({}, wear('shoes', { type: 'rubber', color: '#e8e8ea' })), sole({}, { type: 'rubber', color: '#d0d0d4' }));
    }
    return G;
  }

  // landmarks of the current rest body (human-local meters)
  function landmarks(h, pos, part) {
    const J = (n, w = 'head') => h.joint(n, w);
    const L = {};
    L.H = J('head', 'tail').y;
    L.hipY = J('upperleg01.L').y; L.kneeY = J('lowerleg01.L').y; L.ankleY = J('foot.L').y; L.ankleZ = J('foot.L').z;
    L.waistY = J('spine03').y; L.lowWaistY = L.hipY + 0.45 * (L.waistY - L.hipY);
    L.neckBaseY = J('neck01').y; L.shoulderY = J('upperarm01.L').y + 0.03;
    const bt = J('breast.L', 'tail'), bh = J('breast.L');
    L.nippleY = bt.y; L.nippleX = Math.abs(bt.x); L.chestZ0 = (bh.z + J('spine02').z) / 2;
    const bs = h.params.breastSize || 0.5;
    L.cupR = 0.055 + 0.05 * clamp(bs - 0.3, 0, 0.7);
    L.bandY = bt.y - L.cupR * 1.05;
    L.strapTopX = Math.abs(J('clavicle.L', 'tail').x) * 0.62;
    L.armholeX = Math.abs(J('upperarm01.L').x) - 0.035;
    L.underarmY = J('upperarm01.L').y - 0.06;
    L.uarmLen = J('upperarm01.L').distanceTo(J('lowerarm01.L'));
    L.farmLen = J('lowerarm01.L').distanceTo(J('wrist.L'));
    // crotch: lowest trunk point near the midline; hip width at the hip joint
    let crotch = L.hipY, hw = 0, inner = 0.02;
    for (let i = 0; i < part.length; i++) {
      const k = part[i].k, yy = pos[i * 3 + 1], xx = Math.abs(pos[i * 3]);
      if ((k === 'torso') && xx < 0.03) crotch = Math.min(crotch, yy);
      if ((k === 'torso' || k === 'thigh') && Math.abs(yy - L.hipY) < 0.02) hw = Math.max(hw, xx);
    }
    L.crotchY = crotch; L.hipHalfW = hw || 0.17; L.innerX = inner;
    return L;
  }

  // ------------------------------------------------------------ module
  class Clothing {
    constructor(app) {
      this.app = app;
      this.human = app.human;
      this.group = new THREE.Group();
      this.group.name = 'clothing';
      this.human.group.add(this.group);
      this.meshes = [];
      this.opacity = 1;
      this.visible = true;
      this.outfits = OUTFITS;
    }

    _ctx() {
      const h = this.human, D = h.D, n = h.S.nOut;
      if (!this._part || this._part.length !== n || this._geo !== h.bodyGeo) {
        const parts = D.bones.map((b) => partOf(b.name));
        this._part = new Array(n);
        this.wBreast = new Float32Array(n);
        const idx = h.subWeights.idx, w = h.subWeights.wts;
        const bL = h.boneIndex('breast.L'), bR = h.boneIndex('breast.R');
        for (let i = 0; i < n; i++) {
          this._part[i] = parts[idx[i * 8]];
          let s = 0;
          for (let k = 0; k < 8; k++) if (idx[i * 8 + k] === bL || idx[i * 8 + k] === bR) s += w[i * 8 + k];
          this.wBreast[i] = s;
        }
        this._geo = h.bodyGeo;
      }
      const pos = h.restAttr.array, part = this._part;
      // position along the arm for sleeves (0 at the shoulder, 1 at the elbow)
      const t = this._t && this._t.length === n ? this._t : (this._t = new Float32Array(n));
      const seg = {};
      for (const s of ['L', 'R']) {
        seg['uarm' + s] = [h.joint('upperarm01.' + s), h.joint('lowerarm01.' + s)];
        seg['farm' + s] = [h.joint('lowerarm01.' + s), h.joint('wrist.' + s)];
      }
      const v = new THREE.Vector3(), d = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const k = part[i].k;
        if (k !== 'uarm' && k !== 'farm') continue;
        const [a, b] = seg[k + (part[i].side > 0 ? 'L' : 'R')];
        d.subVectors(b, a);
        v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).sub(a);
        t[i] = clamp(v.dot(d) / d.lengthSq(), -0.2, 1.2);
      }
      return { pos, part, t, wBreast: this.wBreast, L: landmarks(h, pos, part) };
    }

    _clear() {
      for (const m of this.meshes) {
        this.group.remove(m);
        m.geometry.dispose();
        m.material.dispose();
        if (m.customDepthMaterial) m.customDepthMaterial.dispose();
        if (m.customDistanceMaterial) m.customDistanceMaterial.dispose();
      }
      this.meshes = [];
    }

    // Real cloth bridges hollows and skims small bumps instead of following
    // every contour: lift each covered vertex to the "tent" spanned by its
    // neighbours (how far they rise above its tangent plane, minus a slope
    // set by cloth tension), then smooth the lift.
    _adjacency() {
      const h = this.human;
      if (this._adj && this._adjGeo === h.bodyGeo) return this._adj;
      const n = h.S.nOut, tris = h.S.tris, sets = Array.from({ length: n }, () => new Set());
      for (let f = 0; f < tris.length; f += 3) {
        const a = tris[f], b = tris[f + 1], c = tris[f + 2];
        sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
      }
      const off = new Int32Array(n + 1), nb = [];
      for (let i = 0; i < n; i++) { off[i] = nb.length; for (const j of sets[i]) nb.push(j); }
      off[n] = nb.length;
      this._adjGeo = h.bodyGeo;
      return (this._adj = { off, nb: Int32Array.from(nb) });
    }
    _tent(cov, iters, slope) {
      const h = this.human, n = h.S.nOut, P = h.restAttr.array, N = h.bodyNrm.array, { off, nb } = this._adjacency();
      let t = new Float32Array(n), t2 = new Float32Array(n);
      const live = (i) => cov[i * 2] > -0.03;
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < n; i++) {
          if (!live(i)) { t2[i] = 0; continue; }
          let m = t[i];
          const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
          for (let k = off[i]; k < off[i + 1]; k++) {
            const j = nb[k];
            if (!live(j)) continue;
            const dx = P[j * 3] - px, dy = P[j * 3 + 1] - py, dz = P[j * 3 + 2] - pz;
            const rise = dx * nx + dy * ny + dz * nz + t[j] + cov[j * 2 + 1] - cov[i * 2 + 1] - slope * Math.hypot(dx, dy, dz);
            if (rise > m) m = rise;
          }
          t2[i] = Math.min(m, 0.04);
        }
        [t, t2] = [t2, t];
      }
      // soften the lift so the fabric reads as one smooth surface
      for (let it = 0; it < 3; it++) {
        for (let i = 0; i < n; i++) {
          let sum = t[i], c = 1;
          for (let k = off[i]; k < off[i + 1]; k++) { sum += t[nb[k]]; c++; }
          t2[i] = Math.max(t[i] * 0.5, sum / c);
        }
        [t, t2] = [t2, t];
      }
      return t;
    }

    // per-vertex lift that turns each nipple into part of a smooth dome: the
    // height of the bump above a smoothed chest, filled in around it and
    // faded out across the breast
    _chestLift() {
      const h = this.human;
      if (this._lift && this._liftGeo === h.restAttr && this._liftVer === h.restAttr.version) return this._lift;
      const n = h.S.nOut, P = h.restAttr.array, N = h.bodyNrm.array, reg = h.bodyGeo.attributes.region2;
      if (!reg) return null;
      const A = reg.array, { off, nb } = this._adjacency();
      // the two areolae: weighted centres and their reach
      const c = [[0, 0, 0, 0], [0, 0, 0, 0]];
      for (let i = 0; i < n; i++) {
        const m = A[i * 4 + 1];
        if (m < 0.05) continue;
        const k = P[i * 3] > 0 ? 0 : 1;
        c[k][0] += P[i * 3] * m; c[k][1] += P[i * 3 + 1] * m; c[k][2] += P[i * 3 + 2] * m; c[k][3] += m;
      }
      if (!c[0][3] || !c[1][3]) return null;
      for (const q of c) { q[0] /= q[3]; q[1] /= q[3]; q[2] /= q[3]; }
      const near = (i) => {
        let best = 1;
        for (const q of c) best = Math.min(best, Math.hypot(P[i * 3] - q[0], P[i * 3 + 1] - q[1], P[i * 3 + 2] - q[2]));
        return best;
      };
      const R0 = 0.03, R1 = 0.085;
      const idx = [];
      const r = new Float32Array(n).fill(1);
      for (let i = 0; i < n; i++) { const d = near(i); if (d < R1) { r[i] = d; idx.push(i); } }
      // smooth the chest around the nipples (pinned outside)
      let S = Float32Array.from(P), T = Float32Array.from(P);
      for (let it = 0; it < 32; it++) {
        for (const i of idx) {
          if (r[i] > R0 * 1.5) continue;
          let x = 0, y = 0, z = 0, k = 0;
          for (let e = off[i]; e < off[i + 1]; e++) { const j = nb[e] * 3; x += S[j]; y += S[j + 1]; z += S[j + 2]; k++; }
          if (k) { T[i * 3] = x / k; T[i * 3 + 1] = y / k; T[i * 3 + 2] = z / k; }
        }
        [S, T] = [T, S];
      }
      // a bell-shaped dome over the smoothed chest, just tall enough to clear
      // the nipple: the cloth takes whichever is higher, dome or skin
      const d = new Float32Array(n), w = new Float32Array(n);
      let H = 0;
      for (const i of idx) {
        const v = (P[i * 3] - S[i * 3]) * N[i * 3] + (P[i * 3 + 1] - S[i * 3 + 1]) * N[i * 3 + 1] + (P[i * 3 + 2] - S[i * 3 + 2]) * N[i * 3 + 2];
        d[i] = Math.max(0, v);
        w[i] = 1 - smooth(0, R1, r[i]);
        if (r[i] < R0 * 1.5 && w[i] > 0.05) H = Math.max(H, d[i] / w[i]);
      }
      H = Math.min(H + 0.0006, 0.025);
      const lift = new Float32Array(n);
      for (const i of idx) lift[i] = Math.max(0, w[i] * H - d[i]);
      this._liftGeo = h.restAttr; this._liftVer = h.restAttr.version;
      return (this._lift = lift);
    }

    // normals of the garment's own surface (the body pushed out by the ease),
    // so it shades like smooth cloth rather than like the skin under it
    _shellNormals(cov, thick, iters) {
      const h = this.human, n = h.S.nOut, P = h.restAttr.array, tris = h.S.tris;
      const N0 = this._smoothNormals(2), Q = new Float32Array(n * 3), acc = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const e = thick + cov[i * 2 + 1];
        Q[i * 3] = P[i * 3] + N0[i * 3] * e; Q[i * 3 + 1] = P[i * 3 + 1] + N0[i * 3 + 1] * e; Q[i * 3 + 2] = P[i * 3 + 2] + N0[i * 3 + 2] * e;
      }
      for (let f = 0; f < tris.length; f += 3) {
        const a = tris[f] * 3, b = tris[f + 1] * 3, c = tris[f + 2] * 3;
        const ux = Q[b] - Q[a], uy = Q[b + 1] - Q[a + 1], uz = Q[b + 2] - Q[a + 2];
        const vx = Q[c] - Q[a], vy = Q[c + 1] - Q[a + 1], vz = Q[c + 2] - Q[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const k of [a, b, c]) { acc[k] += nx; acc[k + 1] += ny; acc[k + 2] += nz; }
      }
      for (let i = 0; i < n * 3; i += 3) {
        const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]);
        if (l > 1e-12 && acc[i] * N0[i] + acc[i + 1] * N0[i + 1] + acc[i + 2] * N0[i + 2] > 0) { acc[i] /= l; acc[i + 1] /= l; acc[i + 2] /= l; }
        else { acc[i] = N0[i]; acc[i + 1] = N0[i + 1]; acc[i + 2] = N0[i + 2]; }
      }
      return this._smoothNormals(iters, acc);
    }

    _smoothNormals(iters, from) {
      const h = this.human, n = h.S.nOut, { off, nb } = this._adjacency();
      let a = Float32Array.from(from || h.bodyNrm.array), b = new Float32Array(n * 3);
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < n; i++) {
          let x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
          for (let k = off[i]; k < off[i + 1]; k++) { const j = nb[k] * 3; x += a[j]; y += a[j + 1]; z += a[j + 2]; }
          const l = Math.hypot(x, y, z) || 1;
          b[i * 3] = x / l; b[i * 3 + 1] = y / l; b[i * 3 + 2] = z / l;
        }
        [a, b] = [b, a];
      }
      return a;
    }

    _shell(g, ctx) {
      const h = this.human, geo0 = h.bodyGeo, n = h.S.nOut;
      const cov = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { cov[i * 2] = g.cov(i); cov[i * 2 + 1] = g.ease(i); }
      // cloth over the chest bridges the nipples in one smooth curve, the way a
      // bra or a top shapes the breast, instead of following every bump
      if (g.slot === 'top' || g.slot === 'underwear') {
        const lift = this._chestLift();
        if (lift) for (let i = 0; i < n; i++) cov[i * 2 + 1] += lift[i];
      }
      const tent = this._tent(cov, Math.max(1, Math.round((g.tent !== undefined ? g.tent : 6) * (h.smooth ? 1 : 0.5))), g.slope !== undefined ? g.slope : 0.3);
      for (let i = 0; i < n; i++) cov[i * 2 + 1] += tent[i];
      const tris = h.S.tris, keep = [];
      for (let f = 0; f < tris.length; f += 3) {
        const a = tris[f], b = tris[f + 1], c = tris[f + 2];
        if (cov[a * 2] > 0 || cov[b * 2] > 0 || cov[c * 2] > 0) keep.push(a, b, c);
      }
      if (!keep.length) return null;
      const geo = new THREE.BufferGeometry();
      for (const k of ['position', 'restPos', 'skinIndex', 'skinWeight', 'skinIndex2', 'skinWeight2']) geo.setAttribute(k, geo0.attributes[k]);
      // fabric shades like cloth over a soft form, not like skin
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(this._shellNormals(cov, g.thick, g.slot === 'shoes' ? 2 : g.slot === 'top' ? 6 : 4), 3));
      geo.setAttribute('aCov', new THREE.Float32BufferAttribute(cov, 2));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1));
      const mat = this._material(g.fabric, g.thick, true);
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.bind(h.skeleton, new THREE.Matrix4());
      mesh.renderOrder = g.slot === 'underwear' ? 1 : 2;
      BS.depthMaterials(mesh);
      return mesh;
    }

    _material(spec, thick, shell) {
      const mat = BS.Fabric && BS.Fabric.material
        ? BS.Fabric.material(spec, { skinned: true, space: 'restPos', side: THREE.FrontSide })
        : BS.skinned8(new THREE.MeshPhysicalMaterial({ color: spec.color, roughness: 0.8, sheen: 0.4 }));
      const U = { uThick: { value: thick } };
      mat.userData.garment = U;
      BS.patch(mat, shell ? 'garment-shell' : 'garment-free', (s) => {
        Object.assign(s.uniforms, U);
        if (!shell) return;
        s.vertexShader = s.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec2 aCov;\nvarying float vCov;\nuniform float uThick;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * (uThick + aCov.y);\nvCov = aCov.x;');
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vCov;')
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vCov < 0.0) discard;');
      });
      return mat;
    }

    // a skirt hanging from the hips to just above the knee, flaring a little;
    // weights blend from the pelvis into each thigh so it follows the stride
    _skirt(spec, ctx) {
      const h = this.human, L = ctx.L, pos = ctx.pos, part = ctx.part;
      const top = L.hipY + 0.035, hem = L.kneeY + 0.05, rings = 16, seg = 64;
      const cx = 0, cz = h.joint('upperleg01.L').z;
      const ys = [], R = [];
      for (let r = 0; r <= rings; r++) ys.push(top + (hem - top) * (r / rings));
      // body radius per angle at each ring height (trunk + thighs)
      for (let r = 0; r <= rings; r++) {
        const row = new Float32Array(seg);
        for (let i = 0; i < part.length; i++) {
          const k = part[i].k;
          if (k !== 'torso' && k !== 'thigh') continue;
          if (Math.abs(pos[i * 3 + 1] - ys[r]) > 0.02) continue;
          const dx = pos[i * 3] - cx, dz = pos[i * 3 + 2] - cz;
          const a = Math.atan2(dz, dx), b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * seg) % seg;
          row[b] = Math.max(row[b], Math.hypot(dx, dz));
        }
        // a skirt spans the gaps between the legs: take a smoothed hull
        const out = new Float32Array(seg);
        let mx = 0;
        for (let b = 0; b < seg; b++) mx = Math.max(mx, row[b]);
        for (let b = 0; b < seg; b++) {
          let m = 0;
          for (let o = -6; o <= 6; o++) m = Math.max(m, row[(b + o + seg) % seg] * (1 - Math.abs(o) * 0.012));
          out[b] = Math.max(m, mx * 0.82);
        }
        R.push(out);
      }
      const n = (rings + 1) * seg;
      const P = new Float32Array(n * 3), idx8 = new Uint16Array(n * 8), w8 = new Float32Array(n * 8);
      const root = h.boneIndex('root'), uL = h.boneIndex('upperleg01.L'), uR = h.boneIndex('upperleg01.R');
      for (let r = 0; r <= rings; r++) {
        const f = r / rings, ease = 0.006 + f * f * 0.06;
        for (let b = 0; b < seg; b++) {
          // smooth the hull around the ring
          let rr = 0;
          for (let o = -2; o <= 2; o++) rr += R[r][(b + o + seg) % seg];
          rr = rr / 5 + ease;
          const a = ((b + 0.5) / seg) * 2 * Math.PI - Math.PI;
          const i = r * seg + b;
          P[i * 3] = cx + Math.cos(a) * rr; P[i * 3 + 1] = ys[r]; P[i * 3 + 2] = cz + Math.sin(a) * rr;
          const sideL = Math.max(0, Math.cos(a)), sideR = Math.max(0, -Math.cos(a)), leg = f * 0.65;
          idx8[i * 8] = root; w8[i * 8] = 1 - leg;
          idx8[i * 8 + 1] = uL; w8[i * 8 + 1] = leg * sideL / (sideL + sideR || 1);
          idx8[i * 8 + 2] = uR; w8[i * 8 + 2] = leg * sideR / (sideL + sideR || 1);
        }
      }
      const index = [];
      for (let r = 0; r < rings; r++) for (let b = 0; b < seg; b++) {
        const a0 = r * seg + b, a1 = r * seg + ((b + 1) % seg), b0 = a0 + seg, b1 = a1 + seg;
        index.push(a0, b0, a1, a1, b0, b1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('restPos', new THREE.Float32BufferAttribute(P.slice(), 3));
      geo.setIndex(index);
      geo.computeVertexNormals();
      BS.setSkinAttributes(geo, idx8, w8, n);
      const mat = this._material(spec, 0, false);
      mat.side = THREE.DoubleSide;
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.frustumCulled = false;
      // a tube shadowing its own inside reads as a dark band; it still shades the legs
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.bind(h.skeleton, new THREE.Matrix4());
      BS.depthMaterials(mesh);
      return mesh;
    }

    build(p) {
      this._clear();
      const ctx = this._ctx();
      for (const g of garments(ctx, p)) {
        const m = this._shell(g, ctx);
        if (m) { m.name = 'garment-' + g.slot; this.meshes.push(m); this.group.add(m); }
      }
      // free-standing pieces from other files (ties, bows, straps): BS.OUTFIT_EXTRAS[id](ctx, this, p) -> Object3D[]
      const extra = BS.OUTFIT_EXTRAS && BS.OUTFIT_EXTRAS[p.outfit];
      if (extra) for (const m of extra(ctx, this, p) || []) { if (!m) continue; m.name = m.name || 'garment-extra'; this.meshes.push(m); this.group.add(m); }
      if (p.outfit === 'dress') {
        const w = (p.wardrobe && p.wardrobe.bottom) || (p.wardrobe && p.wardrobe.top) || {};
        const m = this._skirt(Object.assign({ type: 'satin', color: p.outfitColor || '#5e3a5a', pattern: 'solid' }, w), ctx);
        m.name = 'garment-skirt';
        this.meshes.push(m);
        this.group.add(m);
      }
      this.setOpacity(this.opacity);
    }

    onParams(p) { this.build(p); }

    setOpacity(a) {
      this.opacity = a;
      for (const m of this.meshes) {
        m.visible = this.visible && a > 0.01;
        if (BS.Fabric && BS.Fabric.setOpacity) BS.Fabric.setOpacity(m.material, a);
        else { m.material.transparent = a < 0.999; m.material.opacity = a; }
      }
    }

    setVisible(v) { this.visible = v; this.setOpacity(this.opacity); }

    dispose() {
      this._clear();
      if (this.group.parent) this.group.parent.remove(this.group);
    }
  }

  BS.CLOTHING_OUTFITS = OUTFITS;
  BS.needsTop = needsTop;
  BS.registerModule({ name: 'clothing', order: 15, create: (app) => new Clothing(app) });
})();
