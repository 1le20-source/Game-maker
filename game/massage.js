// Serenity Hands — massage realism:
//  - the towel on the table is real cloth (BS.Textiles.Cloth): it drops onto
//    the client, drapes over the body and off the table's sides with folds,
//    shifts and wrinkles under your hands, and settles when you stop
//  - flesh gives where you press: a soft dent under the hand that follows it
//    and springs back when you let go (written into the soft-tissue texels
//    human.js reads in the skinning shader, so oil and redness follow too)
// Loaded after the main game script, so it extends the game's functions.
(function () {
  'use strict';
  const g = window;
  const TX = () => g.BS && BS.Textiles;
  const V = () => new THREE.Vector3();
  const _a = V(), _b = V(), _c = V(), _p = V(), _n = V(), _w = V();

  // ------------------------------------------------------------ the towel
  const T = { on: false };
  const showSheet = (h, on) => { if (h && h.sheet) { h.sheet.material.visible = on; for (const c of h.sheet.children) c.material.visible = on; } };
  function disposeTowel() {
    if (T.mesh) { R3.scene.remove(T.mesh); T.skin.dispose(); TX().disposeMaterial(T.mesh.material); showSheet(T.h, true); }
    T.on = false; T.mesh = T.skin = T.cl = null;
  }
  function towelSpec() {
    let t = null;
    try { t = (studioTextiles() || {}).towel; } catch (e) { /* no Clothes Studio design */ }
    return Object.assign({ type: 'terry', color: '#f6f2ea', color2: '#e8dfcf', pattern: 'solid', scale: 1 }, (t && (t.spec || t)) || {});
  }
  // the padded table top (0.62 to 0.76 m) and the floor; the body itself is
  // a height map of its real skin (below), so curves never poke through
  function colliders(h, tb) {
    const X = TX();
    return [
      X.makeCollider('box', { cx: (tb.x + tb.w / 2) * U, cy: 0.69, cz: (tb.y + tb.h / 2) * U, hx: tb.w / 2 * U, hy: 0.07, hz: tb.h / 2 * U, r: 0.02, yaw: 0 }),
      X.makeCollider('plane', { nx: 0, ny: 1, nz: 0, d: 0 }),
    ];
  }
  // highest skin point per 2 cm cell over the towel's area, from the skinned
  // collider mesh the massage already keeps up to date
  const HM = { cell: 0.02 };
  function buildHeights(h) {
    const col = h.collider;
    if (!col) return false;
    const pos = col.geometry.attributes.position.array, ix3 = col.geometry.index.array, m = col.matrixWorld.elements;
    const { x0, z0, nx, nz, cell } = HM, H = HM.h;
    // world positions of the skin, then every triangle rasterised (top surface wins)
    const n = pos.length / 3;
    if (!HM.w || HM.w.length !== pos.length) HM.w = new Float32Array(pos.length);
    const W = HM.w;
    for (let i = 0; i < n; i++) {
      const lx = pos[i * 3], ly = pos[i * 3 + 1], lz = pos[i * 3 + 2];
      W[i * 3] = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
      W[i * 3 + 1] = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
      W[i * 3 + 2] = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
    }
    H.fill(-1);
    const xMax = x0 + nx * cell, zMax = z0 + nz * cell;
    for (let t = 0; t < ix3.length; t += 3) {
      const a = ix3[t] * 3, b = ix3[t + 1] * 3, c = ix3[t + 2] * 3;
      const ax = W[a], az = W[a + 2], bx = W[b], bz = W[b + 2], cx = W[c], cz = W[c + 2];
      const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz);
      if (maxX < x0 || minX > xMax || maxZ < z0 || minZ > zMax) continue;
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-10) continue;
      const i0 = Math.max(0, Math.floor((minX - x0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.ceil((maxX - x0) / cell - 0.5));
      const j0 = Math.max(0, Math.floor((minZ - z0) / cell - 0.5)), j1 = Math.min(nz - 1, Math.ceil((maxZ - z0) / cell - 0.5));
      const ay = W[a + 1], by = W[b + 1], cy = W[c + 1];
      for (let j = j0; j <= j1; j++) {
        const pz = z0 + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + (i + 0.5) * cell;
          const wa = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, wb = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, wc = 1 - wa - wb;
          if (wa < -0.02 || wb < -0.02 || wc < -0.02) continue;
          const y = wa * ay + wb * by + wc * cy, k = j * nx + i;
          if (y > H[k]) H[k] = y;
        }
      }
    }
    return true;
  }
  function heightAt(x, z) {
    const { x0, z0, nx, nz, cell } = HM, H = HM.h;
    const fx = (x - x0) / cell - 0.5, fz = (z - z0) / cell - 0.5, ix = Math.floor(fx), iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= nx - 1 || iz >= nz - 1) return -1;
    const k = iz * nx + ix, a = H[k], b = H[k + 1], c = H[k + nx], d = H[k + nx + 1];
    // at the body's edge use the highest neighbour so the cloth wraps over, not into, the side
    if (a < 0 || b < 0 || c < 0 || d < 0) return Math.max(a, b, c, d);
    const tx = fx - ix, tz = fz - iz;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  function bodyCollide(cl) {
    const p = cl.p, q = cl.q, r = cl.radius + 0.004, fr = cl.friction;
    for (let i = 0; i < cl.n; i++) {
      const k = i * 3, hgt = heightAt(p[k], p[k + 2]);
      if (hgt < 0 || p[k + 1] >= hgt + r) continue;
      // only lift what is above the body's lowest third, so hanging edges stay free
      if (p[k + 1] < hgt - 0.12) continue;
      p[k + 1] = hgt + r; q[k + 1] = p[k + 1]; // resting on the skin: no bounce
      q[k] += (p[k] - q[k]) * fr; q[k + 2] += (p[k + 2] - q[k + 2]) * fr;
    }
  }
  function buildTowel(h, tb, supine) {
    disposeTowel();
    const X = TX();
    if (!X || !h || !h.isBS || !h.bs || !R3) return;
    // the same stretch of body the old sheet covered: waist (or chest) to the knees
    const headX = (tb.x + 22) * U, rootX = headX + h.yHeadC - 0.02, z = (tb.y + tb.h / 2) * U;
    const top = supine ? h.ySh - 0.03 * h.H : h.yWaist - 0.02 * h.H, bot = h.yKnee - 0.03 * h.H;
    const x1 = rootX - top - 0.03, x2 = rootX - bot + 0.05, L = x2 - x1;
    const Wd = 2 * (Math.max(h.P, h.S * 0.9) + 0.05) + 0.5;
    const spec = towelSpec(), ph = X.phys(spec.type), hi = !/(Android|iPhone|iPad|Mobile)/i.test(navigator.userAgent);
    const [nx, ny] = X.gridSize(L, Wd, hi ? 700 : 420, 0.03);
    const n = nx * ny, cl = new X.Cloth(n), idx = new Int32Array(n);
    // the body height map over the towel's area (plus a margin)
    HM.x0 = x1 - 0.15; HM.z0 = z - Wd / 2 - 0.15; HM.nx = Math.ceil((L + 0.3) / HM.cell); HM.nz = Math.ceil((Wd + 0.3) / HM.cell);
    HM.h = new Float32Array(HM.nx * HM.nz);
    if (h.collider) { h.collider.updateMatrixWorld(true); buildHeights(h); }
    if (g.__towelDebug) { let mx = -1; for (const v of HM.h) mx = Math.max(mx, v); g.__towelDebug.push({ hmMax: mx, roll: !!M3.roll, rootY: h.root.position.y }); }
    // laid flat just above the body, a little domed, so it settles onto the
    // skin and over the table's edges without being stretched
    let hmMax = 0.8;
    for (const v of HM.h) if (v > hmMax) hmMax = v;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, u = (i / (nx - 1)) * L, v = (j / (ny - 1)) * Wd;
      idx[k] = k; cl.flat[k * 2] = u; cl.flat[k * 2 + 1] = v; cl.gu[k] = i; cl.gv[k] = j;
      const dz = v - Wd / 2;
      cl.p[k * 3] = x1 + u; cl.p[k * 3 + 1] = hmMax + 0.03 - dz * dz * 0.2; cl.p[k * 3 + 2] = z + dz;
    }
    // thick terry: folds softly instead of crumpling
    X.addGridConstraints(cl, nx, ny, idx, Object.assign({}, ph, { bend: Math.max(0.5, ph.bend) }), 0);
    cl.setTris(X.gridTris(nx, ny));
    cl.substeps = hi ? 6 : 5;
    cl.gsm = ph.gsm; cl.friction = Math.max(0.7, ph.fr); cl.radius = 0.006;
    T.tb = tb; T.h = h;
    cl.colliders = colliders(h, tb);
    cl.compress = 0.6; cl.damping = 2.5;
    cl.finalize();
    const collide = cl._collide.bind(cl);
    cl._collide = (measure) => { const mv = collide(measure); bodyCollide(cl); return mv; };
    // settle it before anyone sees it
    for (let s = 0; s < 70; s++) cl.step(1 / 60);
    const skin = new X.GridSkin({ nx, ny, idx, W: L, H: Wd, refine: hi ? 2 : 1, thick: Math.max(0.003, ph.t), mirrorU: false });
    const mat = X.material(spec, { space: 'uv', side: THREE.FrontSide });
    X.addTextileDetail(mat, {
      uSize: { value: new THREE.Vector2(L, Wd) }, uHem: { value: new THREE.Vector4(0.008, 0.012, 0.0012, 1) },
      uBand: { value: new THREE.Vector4(0.06, 0.1, 0.5, 1) }, uBandColor: { value: new THREE.Color(spec.color2 || '#e8dfcf') }, uThread: { value: new THREE.Color(spec.color).multiplyScalar(0.85) },
    });
    const mesh = new THREE.Mesh(skin.geo, mat);
    mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.userData = { sheet: true, human: h };
    R3.scene.add(mesh);
    skin.update(cl.p);
    Object.assign(T, { on: true, cl, skin, mesh, hand: null, wakeT: 0 });
    // the old half-tube stays for hit-testing the draped area, unseen
    if (h.sheet) { h.sheet.material.visible = false; for (const c of h.sheet.children) c.material.visible = false; }
  }
  function updateTowel(dt) {
    if (T.on && M3.roll) { disposeTowel(); return; }
    if (!T.on || !M3.h || M3.h !== T.h) return;
    const cl = T.cl, X = TX();
    // the body moves a little (breathing, shifting): refresh its height map now and then
    const t0 = performance.now();
    T.hmT = (T.hmT || 0) - dt;
    if (T.hmT <= 0 && T.h.collider) { T.hmT = 0.1; buildHeights(T.h); }
    cl.colliders = colliders(T.h, T.tb);
    // your hand: pushes the towel where it presses, and drags it along a stroke
    const hit = M3.hit && ptr.down ? M3.hit.point : null;
    if (hit) {
      cl.colliders.push(X.makeCollider('sphere', { cx: hit.x, cy: hit.y + 0.02, cz: hit.z, r: 0.05 }));
      if (T.hand) {
        const dx = hit.x - T.hand.x, dz = hit.z - T.hand.z, d2 = dx * dx + dz * dz;
        if (d2 > 1e-8 && d2 < 0.01) {
          const p = cl.p;
          for (let i = 0; i < cl.n; i++) {
            const k = i * 3, ex = p[k] - hit.x, ey = p[k + 1] - hit.y, ez = p[k + 2] - hit.z, r2 = ex * ex + ey * ey + ez * ez;
            if (r2 > 0.012) continue;
            const f = 0.45 * (1 - r2 / 0.012);
            p[k] += dx * f; p[k + 2] += dz * f;
          }
        }
      }
      T.hand = hit.clone();
      cl.wake();
    } else T.hand = null;
    // a living body keeps the cloth from going perfectly still
    T.wakeT -= dt;
    if (T.wakeT <= 0) { T.wakeT = 1.2; cl.wake(); }
    if (cl.step(Math.min(dt, 1 / 30))) T.skin.update(cl.p);
    T.cost = (T.cost || 0) * 0.9 + (performance.now() - t0) * 0.1;
  }
  g.towelCost = () => T.cost;
  Object.defineProperty(g, '__towel', { get: () => T, configurable: true });
  g.__heightAt = (x, z) => (HM.h ? heightAt(x, z) : -1);

  // ------------------------------------------------------- flesh gives
  // one dent: centre and press direction in the body's rest space
  const D = { depth: 0, goal: 0, ok: false, p: V(), n: V(), h: null };
  function restOfHit(h, hit) {
    const col = h.collider;
    if (!col || hit.object !== col || !hit.face) return false;
    const pos = col.geometry.attributes.position.array, verts = col.userData.verts, f = hit.face;
    _a.fromArray(pos, f.a * 3); _b.fromArray(pos, f.b * 3); _c.fromArray(pos, f.c * 3);
    // barycentric weights of the hit point
    const v0 = V().subVectors(_b, _a), v1 = V().subVectors(_c, _a), v2 = V().subVectors(hit.point, _a);
    const d00 = v0.dot(v0), d01 = v0.dot(v1), d11 = v1.dot(v1), d20 = v2.dot(v0), d21 = v2.dot(v1), den = d00 * d11 - d01 * d01 || 1;
    const wb = (d11 * d20 - d01 * d21) / den, wc = (d00 * d21 - d01 * d20) / den, wa = 1 - wb - wc;
    const bs = h.bs;
    bs.baseRest(verts[f.a], _a); bs.baseRest(verts[f.b], _b); bs.baseRest(verts[f.c], _c);
    D.p.set(0, 0, 0).addScaledVector(_a, wa).addScaledVector(_b, wb).addScaledVector(_c, wc);
    // outward normal of the rest triangle; the press goes the other way
    _n.subVectors(_b, _a).cross(_w.subVectors(_c, _a)).normalize();
    D.n.copy(_n).negate();
    return true;
  }
  function writeDent(h) {
    const L = BS.SOFT_LAYOUT, sk = h && h.bs && h.bs.skeleton;
    if (!L || !sk || !sk.boneTexture) return;
    if (g.BS.SoftBody && BS.SoftBody.dent) { BS.SoftBody.dent(h.bs, D.p, 0.05, D.depth); return; }
    const M = sk.boneMatrices;
    if (M.length < (L.base + L.texels) * 4) return;
    const b = L.base * 4, on = D.depth > 0.0004;
    M[b] = L.magic; M[b + 1] = 0; M[b + 2] = on ? 1 : 0; M[b + 3] = 0;
    if (!on) return;
    const o = (L.base + L.dents) * 4;
    M[o] = D.p.x; M[o + 1] = D.p.y; M[o + 2] = D.p.z; M[o + 3] = 0.05;
    M[o + 4] = D.n.x; M[o + 5] = D.n.y; M[o + 6] = D.n.z; M[o + 7] = D.depth;
    M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = 0; M[o + 11] = 0.22;
  }
  function updateDent(dt) {
    const h = M3.h;
    if (!h || !h.isBS) return;
    const pressing = M3.hit && ptr.down && ptr.inside && ptr.forceZone && ptr.forceZone !== 'towel' && (tool === 'hands' || tool === 'oil') && restOfHit(h, M3.hit);
    D.goal = pressing ? 0.004 + 0.0035 * (pressure || 2) : 0;
    // flesh gives quickly and springs back a little slower
    D.depth += (D.goal - D.depth) * Math.min(1, dt * (D.goal > D.depth ? 14 : 7));
    if (D.depth < 0.0003 && !pressing) D.depth = 0;
    D.h = h;
    writeDent(h);
  }
  function clearDent() { if (D.h) { D.depth = 0; writeDent(D.h); } D.h = null; }

  // ------------------------------------------------------------- hooks
  const baseSheet = g.tableSheet;
  // the towel is built a few frames later, once the client lies in pose and
  // their skin collider is current; the old sheet shows until then
  g.tableSheet = function (h, tb, supine) {
    const out = baseSheet.apply(this, arguments);
    if (h && h.isBS && TX()) { disposeTowel(); T.pending = { h, tb, supine, frames: 3 }; }
    return out;
  };
  function buildPending() {
    const P = T.pending;
    if (!P || M3.h !== P.h || M3.roll) return;
    if (--P.frames > 0 || !P.h.collider) return;
    T.pending = null;
    try { P.h.collider.updateMatrixWorld(true); buildTowel(P.h, P.tb, P.supine); }
    catch (e) { console.warn('towel', e); disposeTowel(); const h = P.h; if (h.sheet) { h.sheet.material.visible = true; for (const c of h.sheet.children) c.material.visible = true; } }
  }
  const baseRender = g.render3DMassage;
  g.render3DMassage = function (dt) {
    try { buildPending(); updateTowel(dt); updateDent(dt); } catch (e) { console.warn('massage realism', e); }
    return baseRender.apply(this, arguments);
  };
  const baseEnd = g.endMassage3D;
  g.endMassage3D = function () {
    clearDent();
    disposeTowel(); T.pending = null;
    const h = M3.h;
    if (h && h.sheet) { h.sheet.material.visible = true; for (const c of h.sheet.children) c.material.visible = true; }
    return baseEnd.apply(this, arguments);
  };
})();
