// Body Studio anatomy: medical-atlas layers fitted to the current body.
// Muscles (an écorché shell of the body itself), a modelled skeleton, organs,
// vessels and nerves all follow the rig, so they move with every pose. The
// skin can turn to x-ray or off, a clipping plane opens the body, and every
// structure can be picked for a one-line fact.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const THREE = window.THREE;
  const V3 = THREE.Vector3;
  const { sqrt, abs, min, max, PI } = Math;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const mix = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const HIDDEN = 30; // render layer the camera never sees

  // ------------------------------------------------- signed distance kit
  function smin(a, b, k) { const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; }
  function smax(a, b, k) { const h = max(k - abs(a - b), 0) / k; return max(a, b) + h * h * k * 0.25; }
  function sph(x, y, z, c, r) { const dx = x - c[0], dy = y - c[1], dz = z - c[2]; return sqrt(dx * dx + dy * dy + dz * dz) - r; }
  function ell(x, y, z, c, r) {
    const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
    const k0 = sqrt(px * px + py * py + pz * pz);
    const k1 = sqrt((px * px) / (r[0] * r[0]) + (py * py) / (r[1] * r[1]) + (pz * pz) / (r[2] * r[2]));
    return k1 < 1e-9 ? -min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
  }
  // round cone from a (radius ra) to b (radius rb)
  function cone(x, y, z, a, b, ra, rb) {
    const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const h = clamp((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz), 0, 1);
    const dx = px - bx * h, dy = py - by * h, dz = pz - bz * h;
    return sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
  }
  // polyline of round cones, points [x, y, z, r]
  function chain(x, y, z, pts) {
    let d = 1e9;
    for (let i = 0; i < pts.length - 1; i++) d = min(d, cone(x, y, z, pts[i], pts[i + 1], pts[i][3], pts[i + 1][3]));
    return d;
  }
  // unsigned distance to a triangle (for thin plates: tri(...) - thickness)
  function tri(x, y, z, a, b, c) {
    const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
    const cbx = c[0] - b[0], cby = c[1] - b[1], cbz = c[2] - b[2];
    const acx = a[0] - c[0], acy = a[1] - c[1], acz = a[2] - c[2];
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const pbx = x - b[0], pby = y - b[1], pbz = z - b[2];
    const pcx = x - c[0], pcy = y - c[1], pcz = z - c[2];
    const nx = bay * acz - baz * acy, ny = baz * acx - bax * acz, nz = bax * acy - bay * acx;
    const sg = (ux, uy, uz, px, py, pz) => ((uy * nz - uz * ny) * px + (uz * nx - ux * nz) * py + (ux * ny - uy * nx) * pz >= 0 ? 1 : -1);
    if (sg(bax, bay, baz, pax, pay, paz) + sg(cbx, cby, cbz, pbx, pby, pbz) + sg(acx, acy, acz, pcx, pcy, pcz) < 2) {
      const e = (ux, uy, uz, px, py, pz) => {
        const h = clamp((ux * px + uy * py + uz * pz) / (ux * ux + uy * uy + uz * uz), 0, 1);
        const dx = ux * h - px, dy = uy * h - py, dz = uz * h - pz;
        return dx * dx + dy * dy + dz * dz;
      };
      return sqrt(min(e(bax, bay, baz, pax, pay, paz), e(cbx, cby, cbz, pbx, pby, pbz), e(acx, acy, acz, pcx, pcy, pcz)));
    }
    const d = nx * pax + ny * pay + nz * paz;
    return sqrt((d * d) / (nx * nx + ny * ny + nz * nz));
  }
  // elliptic cylinder along y with rounded rims
  function disc(x, y, z, c, rx, rz, hh, round) {
    const px = (x - c[0]) / rx, pz = (z - c[2]) / rz;
    const e = (sqrt(px * px + pz * pz) - 1) * min(rx, rz) + round;
    const dy = abs(y - c[1]) - hh + round;
    return min(max(e, dy), 0) + sqrt(max(e, 0) ** 2 + max(dy, 0) ** 2) - round;
  }

  // Surface nets over a distance function f(x, y, z) inside [lo, hi] with
  // cell size h. A coarse pass skips space far from the surface. Normals come
  // from the field's gradient and a cheap ambient-occlusion term darkens folds.
  function polygonize(f, lo, hi, h) {
    const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
    const C = 4, cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1;
    const G = new Float32Array(cx * cy * cz);
    for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) G[i + cx * (j + cy * k)] = f(lo[0] + i * C * h, lo[1] + j * C * h, lo[2] + k * C * h);
    const band = C * h * 2;
    const F = new Float32Array(nx * ny * nz);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const g = G[Math.round(i / C) + cx * (Math.round(j / C) + cy * Math.round(k / C))];
      F[i + nx * (j + ny * k)] = abs(g) > band ? g : f(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
    }
    const id = (i, j, k) => i + nx * (j + ny * k);
    const cell = new Int32Array(nx * ny * nz).fill(-1);
    const P = [];
    const val = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) { val[c] = F[id(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2))]; if (val[c] < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, m = 0;
      for (let c = 0; c < 8; c++) for (const d of [1, 2, 4]) {
        if (c & d) continue;
        const c2 = c | d, a = val[c], b = val[c2];
        if ((a < 0) === (b < 0)) continue;
        const t = a / (a - b);
        sx += (c & 1) + (d === 1 ? t : 0); sy += ((c >> 1) & 1) + (d === 2 ? t : 0); sz += (c >> 2) + (d === 4 ? t : 0);
        m++;
      }
      cell[id(i, j, k)] = P.length / 3;
      P.push(lo[0] + (i + sx / m) * h, lo[1] + (j + sy / m) * h, lo[2] + (k + sz / m) * h);
    }
    const I = [];
    const quad = (a, b, c, d, flip) => { if (flip) I.push(a, d, c, a, c, b); else I.push(a, b, c, a, c, d); };
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = F[id(i, j, k)], b = F[id(i + 1, j, k)];
      if ((a < 0) !== (b < 0)) quad(cell[id(i, j - 1, k - 1)], cell[id(i, j, k - 1)], cell[id(i, j, k)], cell[id(i, j - 1, k)], a >= 0);
    }
    for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const a = F[id(i, j, k)], b = F[id(i, j + 1, k)];
      if ((a < 0) !== (b < 0)) quad(cell[id(i - 1, j, k - 1)], cell[id(i - 1, j, k)], cell[id(i, j, k)], cell[id(i, j, k - 1)], a >= 0);
    }
    for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const a = F[id(i, j, k)], b = F[id(i, j, k + 1)];
      if ((a < 0) !== (b < 0)) quad(cell[id(i - 1, j - 1, k)], cell[id(i, j - 1, k)], cell[id(i, j, k)], cell[id(i - 1, j, k)], a >= 0);
    }
    const n = P.length / 3, pos = new Float32Array(P), nrm = new Float32Array(n * 3), ao = new Float32Array(n);
    const e = h * 0.5, sd = h * 1.5;
    for (let v = 0; v < n; v++) {
      let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      let gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
      const l = sqrt(gx * gx + gy * gy + gz * gz) || 1;
      gx /= l; gy /= l; gz /= l;
      const d0 = f(x, y, z); // one Newton step onto the surface
      x -= gx * d0; y -= gy * d0; z -= gz * d0;
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      nrm[v * 3] = gx; nrm[v * 3 + 1] = gy; nrm[v * 3 + 2] = gz;
      let occ = 0;
      for (let s = 1; s <= 3; s++) occ += (s * sd - f(x + gx * s * sd, y + gy * s * sd, z + gz * s * sd)) / (s * sd) / (1 << s);
      ao[v] = clamp(1 - occ * 1.6, 0.35, 1);
    }
    return { pos, nrm, ao, idx: I };
  }

  // ------------------------------------------------------- mesh builders
  // Tube along a path. rad(i) gives a radius or [r across `side`, r other];
  // side(i) optionally orients elliptic sections. Rings share vertices.
  function tube(pts, rad, opts = {}) {
    const seg = opts.seg || 8, n = pts.length;
    const pos = [], nrm = [], idx = [], ring = [];
    const T = [], N = [], Bn = [];
    const t = new V3(), nn = new V3(), bb = new V3();
    for (let i = 0; i < n; i++) T.push(new V3().subVectors(pts[min(i + 1, n - 1)], pts[max(i - 1, 0)]).normalize());
    let prev = opts.side ? opts.side(0).clone() : new V3(0, 0, 1);
    if (abs(prev.dot(T[0])) > 0.95) prev.set(1, 0, 0);
    for (let i = 0; i < n; i++) {
      t.copy(T[i]);
      nn.copy(opts.side ? opts.side(i) : prev);
      nn.addScaledVector(t, -nn.dot(t));
      if (nn.lengthSq() < 1e-10) nn.copy(prev).addScaledVector(t, -prev.dot(t));
      nn.normalize();
      bb.crossVectors(t, nn);
      N.push(nn.clone()); Bn.push(bb.clone());
      prev.copy(nn);
    }
    const p = new V3(), q = new V3();
    for (let i = 0; i < n; i++) {
      const r = rad(i), r1 = Array.isArray(r) ? r[0] : r, r2 = Array.isArray(r) ? r[1] : r;
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * PI * 2, c = Math.cos(a), s = Math.sin(a);
        p.copy(pts[i]).addScaledVector(N[i], c * r1).addScaledVector(Bn[i], s * r2);
        q.copy(N[i]).multiplyScalar(c / r1).addScaledVector(Bn[i], s / r2).normalize();
        pos.push(p.x, p.y, p.z); nrm.push(q.x, q.y, q.z); ring.push(i);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = b + seg, d = a + seg;
      idx.push(a, b, c, a, c, d);
    }
    if (opts.caps !== false) {
      for (const end of [0, n - 1]) {
        const c = pos.length / 3, s = end ? 1 : -1;
        pos.push(pts[end].x, pts[end].y, pts[end].z); nrm.push(T[end].x * s, T[end].y * s, T[end].z * s); ring.push(end);
        for (let j = 0; j < seg; j++) {
          const a = end * seg + j, b = end * seg + ((j + 1) % seg);
          if (end) idx.push(c, a, b); else idx.push(c, b, a);
        }
      }
    }
    return { pos, nrm, idx, ring, N, B: Bn, T };
  }
  // smooth path through control points (centripetal Catmull-Rom), evenly spaced
  function path(ctrl, step) {
    if (ctrl.length < 2) return ctrl;
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const n = max(2, Math.ceil(curve.getLength() / step) + 1);
    return curve.getSpacedPoints(n - 1);
  }
  function ellipsoid(rx, ry, rz, ws, hs) {
    const g = new THREE.SphereGeometry(1, ws, hs);
    g.scale(rx, ry, rz);
    g.computeVertexNormals();
    const out = { pos: g.attributes.position.array, nrm: g.attributes.normal.array, idx: g.index.array };
    g.dispose();
    return out;
  }
  // frame matrix: origin o, axes x, y, z (any lengths)
  function frame(o, x, y, z) { return new THREE.Matrix4().makeBasis(x, y, z).setPosition(o); }
  // least-squares affine map taking points src[i] to dst[i] (>= 4 points)
  function fitAffine(src, dst) {
    const A = Array.from({ length: 4 }, () => new Float64Array(4)), R = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
    for (let k = 0; k < src.length; k++) {
      const r = [src[k].x, src[k].y, src[k].z, 1], d = [dst[k].x, dst[k].y, dst[k].z];
      for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) A[i][j] += r[i] * r[j]; for (let c = 0; c < 3; c++) R[c][i] += r[i] * d[c]; }
    }
    for (let i = 0; i < 4; i++) A[i][i] += 1e-9;
    const sol = R.map((b) => solve4(A.map((r) => Float64Array.from(r)), Float64Array.from(b)));
    return new THREE.Matrix4().set(...sol[0], ...sol[1], ...sol[2], 0, 0, 0, 1);
  }
  function solve4(A, b) {
    for (let c = 0; c < 4; c++) {
      let p = c;
      for (let r = c + 1; r < 4; r++) if (abs(A[r][c]) > abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = c + 1; r < 4; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const x = [0, 0, 0, 0];
    for (let r = 3; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < 4; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
    return x;
  }

  // Geometry under construction. Every vertex gets a colour (AO baked in),
  // a part id for picking/highlighting and 8 skin weights.
  class Geo {
    constructor() { this.P = []; this.N = []; this.C = []; this.ID = []; this.SI = []; this.SW = []; this.X = []; this.I = []; }
    // skin: a bone index (rigid) or fn(vertex, ring) -> {idx, wts}; extra: fn(vertex, ring) -> number
    add(sh, m, col, id, skin, extra) {
      const base = this.P.length / 3, n = sh.pos.length / 3;
      const nm = new THREE.Matrix3().getNormalMatrix(m), flip = m.determinant() < 0;
      const v = new V3(), q = new V3();
      for (let i = 0; i < n; i++) {
        v.set(sh.pos[i * 3], sh.pos[i * 3 + 1], sh.pos[i * 3 + 2]).applyMatrix4(m);
        q.set(sh.nrm[i * 3], sh.nrm[i * 3 + 1], sh.nrm[i * 3 + 2]).applyMatrix3(nm).normalize();
        this.P.push(v.x, v.y, v.z); this.N.push(q.x, q.y, q.z);
        const ao = sh.ao ? sh.ao[i] : 1, c = typeof col === 'function' ? col(i, sh.ring && sh.ring[i]) : col;
        this.C.push(c.r * ao, c.g * ao, c.b * ao);
        this.ID.push(id);
        if (typeof skin === 'number') { this.SI.push(skin, 0, 0, 0, 0, 0, 0, 0); this.SW.push(1, 0, 0, 0, 0, 0, 0, 0); }
        else { const w = skin(i, sh.ring && sh.ring[i]); for (let k = 0; k < 8; k++) { this.SI.push(w.idx[k]); this.SW.push(w.wts[k]); } }
        this.X.push(extra ? extra(i, sh.ring && sh.ring[i]) : 0);
      }
      const I = sh.idx;
      for (let i = 0; i < I.length; i += 3) {
        if (flip) this.I.push(base + I[i], base + I[i + 2], base + I[i + 1]);
        else this.I.push(base + I[i], base + I[i + 1], base + I[i + 2]);
      }
    }
    get count() { return this.P.length / 3; }
    build() {
      const g = new THREE.BufferGeometry(), n = this.count;
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
      g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.ID, 1));
      g.setAttribute('aExtra', new THREE.Float32BufferAttribute(this.X, 1));
      BS.setSkinAttributes(g, this.SI, this.SW, n);
      g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
      g.computeBoundingSphere();
      return g;
    }
  }
  // bake a shape into a plain (unskinned) geometry, transformed by m
  function shapeGeometry(sh, m) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(sh.pos), nrm = new Float32Array(sh.nrm);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    if (sh.ao) {
      const c = new Float32Array(pos.length);
      for (let i = 0; i < sh.ao.length; i++) c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = sh.ao[i];
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    const n = pos.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(sh.idx, 1) : new THREE.Uint16BufferAttribute(sh.idx, 1));
    if (m) g.applyMatrix4(m);
    if (m && m.determinant() < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
    return g;
  }

  // ------------------------------------------------- measuring the body
  // Everything inside is fitted to the current body: the rest-pose skin is
  // sampled into lookup tables (front/back height maps and a polar contour
  // of the trunk) that bones, organs and vessels are placed against.
  function boneGroups(D) {
    return D.bones.map((b) => {
      const n = b.name;
      if (/^(shoulder|upperarm|lowerarm|wrist|finger|metacarpal)/.test(n)) return 2;
      if (/^(upperleg|lowerleg|foot|toe)/.test(n)) return 3;
      if (/^breast/.test(n)) return 4;
      if (/^(spine|pelvis|root|clavicle|neck)/.test(n)) return 0;
      return 1;
    });
  }
  const NA = 36; // angular bins of the trunk contour

  class Body {
    constructor(human, p) {
      this.h = human;
      const D = human.D, a = human.restAttr.array, n = a.length / 3, W = human.subWeights;
      const grp = (this.grp = boneGroups(D));
      let top = 0;
      for (let i = 0; i < n; i++) top = max(top, a[i * 3 + 1]);
      this.top = top;
      this.s = top / 1.75;
      this.g = p.gender ?? 0.5; this.w = p.weight ?? 0.5; this.m = p.muscle ?? 0.5; this.age = p.age ?? 30;
      this.fat = this.s * (0.004 + 0.02 * Math.pow(this.w, 1.5) + 0.004 * (1 - this.g));
      const cls = (this.cls = new Uint8Array(n)), bw = (this.bw = new Float32Array(n));
      for (let i = 0; i < n; i++) {
        cls[i] = grp[W.idx[i * 8]];
        let b = 0;
        for (let k = 0; k < 8; k++) if (grp[W.idx[i * 8 + k]] === 4) b += W.wts[i * 8 + k];
        bw[i] = b;
      }
      // trunk height maps over x, y (1 cm cells), breasts left out so the
      // chest wall shows; holes are filled along each row
      const NX = (this.NX = 65), NY = (this.NY = Math.ceil(top / 0.01) + 2);
      const Fm = (this.Fm = new Float32Array(NX * NY).fill(-9)), Bm = (this.Bm = new Float32Array(NX * NY).fill(9));
      const hw = (this.hw = new Float32Array(NY));
      for (let i = 0; i < n; i++) {
        const c = cls[i];
        if (c === 2 || c === 3 || bw[i] > 0.25) continue;
        const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
        const ix = Math.round((x + 0.32) / 0.01), iy = Math.round(y / 0.01);
        if (ix < 0 || ix >= NX || iy < 0 || iy >= NY) continue;
        const k = iy * NX + ix;
        if (z > Fm[k]) Fm[k] = z;
        if (z < Bm[k]) Bm[k] = z;
        if (c === 0 && abs(x) > hw[iy]) hw[iy] = abs(x);
      }
      for (const [M, bad] of [[Fm, -9], [Bm, 9]]) for (let iy = 0; iy < NY; iy++) {
        let last = -1;
        for (let ix = 0; ix < NX; ix++) {
          const k = iy * NX + ix;
          if (M[k] === bad) continue;
          if (last >= 0 && ix - last > 1) for (let j = last + 1; j < ix; j++) M[iy * NX + j] = mix(M[iy * NX + last], M[k], (j - last) / (ix - last));
          last = ix;
        }
      }
      // polar contour of the trunk around its midline centre
      const R = (this.R = new Float32Array(NY * NA));
      const zc = (this.zc = new Float32Array(NY));
      for (let iy = 0; iy < NY; iy++) zc[iy] = (this._map(Fm, 0, iy, -9) + this._map(Bm, 0, iy, 9)) / 2;
      for (let i = 0; i < n; i++) {
        if (cls[i] !== 0 || bw[i] > 0.25) continue;
        const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
        const iy = Math.round(y / 0.01);
        if (iy < 0 || iy >= NY) continue;
        const dz = z - zc[iy], ang = Math.atan2(x, dz);
        const k = iy * NA + ((Math.round(((ang + PI) / (2 * PI)) * NA) % NA + NA) % NA);
        R[k] = max(R[k], sqrt(x * x + dz * dz));
      }
      for (let iy = 0; iy < NY; iy++) {
        const row = R.subarray(iy * NA, iy * NA + NA);
        const ok = [];
        for (let k = 0; k < NA; k++) if (row[k] > 0) ok.push(k);
        if (!ok.length) continue;
        for (let k = 0; k < NA; k++) {
          if (row[k] > 0) continue;
          let lo = ok[0], hi = ok[0];
          for (const o of ok) { if (((k - o + NA) % NA) <= ((k - lo + NA) % NA)) lo = o; if (((o - k + NA) % NA) <= ((hi - k + NA) % NA)) hi = o; }
          const dl = (k - lo + NA) % NA, dh = (hi - k + NA) % NA;
          row[k] = dl + dh ? mix(row[lo], row[hi], dl / (dl + dh)) : row[lo];
        }
      }
    }
    _map(M, ix, iy, bad) {
      iy = clamp(iy, 0, this.NY - 1);
      const c = Math.round(ix);
      for (let d = 0; d < 20; d++) for (const s of [1, -1]) {
        const j = c + d * s;
        if (j >= 0 && j < this.NX && M[iy * this.NX + j] !== bad) return M[iy * this.NX + j];
      }
      return bad === -9 ? 0.1 : -0.1;
    }
    // trunk skin z in front of / behind (x, y)
    front(x, y) { const fy = y / 0.01, iy = Math.floor(fy), t = fy - iy, ix = (x + 0.32) / 0.01; return mix(this._map(this.Fm, ix, iy, -9), this._map(this.Fm, ix, iy + 1, -9), t); }
    back(x, y) { const fy = y / 0.01, iy = Math.floor(fy), t = fy - iy, ix = (x + 0.32) / 0.01; return mix(this._map(this.Bm, ix, iy, 9), this._map(this.Bm, ix, iy + 1, 9), t); }
    halfW(y) { const iy = clamp(Math.round(y / 0.01), 0, this.NY - 1); return this.hw[iy] || 0.12 * this.s; }
    // trunk skin point at height y in direction ang (0 = front, +PI/2 = left)
    rim(y, ang, inset, out) {
      const fy = clamp(y / 0.01, 0, this.NY - 1.001), iy = Math.floor(fy), ty = fy - iy;
      const fa = (((ang + PI) / (2 * PI)) * NA + NA) % NA, ia = Math.floor(fa), ta = fa - ia, ib = (ia + 1) % NA;
      const R = this.R;
      const r0 = mix(R[iy * NA + ia], R[iy * NA + ib], ta), r1 = mix(R[(iy + 1) * NA + ia], R[(iy + 1) * NA + ib], ta);
      const r = max(0.01, mix(r0, r1, ty) - inset);
      const zc = mix(this.zc[iy], this.zc[iy + 1], ty);
      return (out || new V3()).set(Math.sin(ang) * r, y, zc + Math.cos(ang) * r);
    }
    J(name, end = 'head') { return this.h.joint(name, end); }
    bone(name) { return this.h.boneIndex(name); }
    // rig bone of the spine that carries height y
    spineBone(y) {
      for (const nm of ['head', 'neck03', 'neck02', 'neck01', 'spine01', 'spine02', 'spine03', 'spine04']) if (y >= this.J(nm).y) return this.bone(nm);
      return this.bone('spine05');
    }
  }

  // ------------------------------------------------------------ materials
  const NOISE = `
float aHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float aNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(aHash(i), aHash(i + vec3(1, 0, 0)), f.x), mix(aHash(i + vec3(0, 1, 0)), aHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(aHash(i + vec3(0, 0, 1)), aHash(i + vec3(1, 0, 1)), f.x), mix(aHash(i + vec3(0, 1, 1)), aHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float aFbm(vec3 p) { return 0.5 * aNoise(p) + 0.27 * aNoise(p * 2.03 + 7.1) + 0.14 * aNoise(p * 4.1 + 3.3) + 0.09 * aNoise(p * 8.3 + 1.7); }
// bump the shading normal by a height h (meters) using screen derivatives
vec3 aBump(vec3 n, vec3 pos, float h) {
  vec3 dx = dFdx(pos), dy = dFdy(pos);
  vec3 r1 = cross(dy, n), r2 = cross(n, dx);
  float det = dot(dx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}`;
  const U = () => ({
    uHi: { value: -1 }, uHiCol: { value: new THREE.Color(0x40d8ff) }, uCut: { value: new THREE.Color(0.5, 0.2, 0.15) },
    uTime: { value: 0 }, uPulse: { value: 0 }, uFade: { value: 1 },
  });
  // shared patch: position-based detail, highlight by part id, flat cut faces
  function anatomyMaterial(params, opt) {
    const mat = BS.skinned8(new THREE.MeshPhysicalMaterial(params));
    const u = (mat.userData.u = Object.assign(U(), opt.uniforms || {}));
    mat.userData.cutColor = opt.cut;
    if (opt.cut) u.uCut.value.set(opt.cut);
    BS.patch(mat, 'anat-' + opt.key, (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float aPart;
attribute float aExtra;
varying vec3 vAP;
varying float vPart;
varying float vExtra;
${opt.vertDecl || ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vAP = position; vPart = aPart; vExtra = aExtra;
${opt.vert || ''}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uHi; uniform vec3 uHiCol; uniform vec3 uCut; uniform float uTime; uniform float uPulse; uniform float uFade;
varying vec3 vAP; varying float vPart; varying float vExtra;
${NOISE}
${opt.fragDecl || ''}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
${opt.color || ''}
float hiK = 1.0 - step(0.5, abs(vPart - uHi));`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
${opt.normal || ''}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${opt.emissive || ''}
totalEmissiveRadiance += uHiCol * hiK * 0.35;`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
if (hiK > 0.5) gl_FragColor.rgb = mix(gl_FragColor.rgb, uHiCol, 0.25);
if (!gl_FrontFacing) gl_FragColor.rgb = uCut * (0.82 + 0.3 * aNoise(vAP * 600.0));
gl_FragColor.a *= uFade;`);
    });
    return mat;
  }

  const COL = {
    bone: new THREE.Color('#e6dcc4'), cart: new THREE.Color('#bfd0d4'), disc: new THREE.Color('#d8e2e0'),
    artery: new THREE.Color('#b3201c'), vein: new THREE.Color('#2b4697'), nerve: new THREE.Color('#e9cf6a'),
  };

  // ------------------------------------------------------------ the catalog
  // one-line facts for everything that can be picked
  const FACTS = {
    Skull: ['skeleton', '22 bones fused at sutures protect the brain and shape the face.'],
    Mandible: ['skeleton', 'The lower jaw — the only skull bone that moves, hinged at the temporomandibular joints.'],
    'Cervical vertebrae': ['skeleton', 'Seven neck vertebrae; C1 (atlas) nods the head, C2 (axis) lets it turn.'],
    'Thoracic vertebrae': ['skeleton', 'Twelve vertebrae, each carrying a pair of ribs.'],
    'Lumbar vertebrae': ['skeleton', 'Five large vertebrae that carry most of the upper body’s weight.'],
    'Intervertebral discs': ['skeleton', 'Fibrocartilage cushions — about a quarter of the spine’s length.'],
    Sacrum: ['skeleton', 'Five vertebrae fused into one wedge that locks the spine into the pelvis.'],
    Coccyx: ['skeleton', 'The tailbone: three to five tiny fused vertebrae.'],
    Ribs: ['skeleton', 'Twelve pairs; the top seven reach the sternum through costal cartilage.'],
    'Costal cartilage': ['skeleton', 'Flexible cartilage that lets the ribcage expand with each breath.'],
    Sternum: ['skeleton', 'The breastbone: manubrium, body and xiphoid process.'],
    Clavicle: ['skeleton', 'The collarbone — the only bony strut between arm and trunk, and the most often broken.'],
    Scapula: ['skeleton', 'The shoulder blade glides over the ribs on muscle, with no joint to the spine.'],
    Humerus: ['skeleton', 'Upper-arm bone; its ball sits in a shallow socket for a huge range of motion.'],
    Radius: ['skeleton', 'Thumb-side forearm bone; it rolls around the ulna to turn the palm over.'],
    Ulna: ['skeleton', 'Little-finger-side forearm bone; its olecranon is the point of the elbow.'],
    'Carpal bones': ['skeleton', 'Eight pebble-like wrist bones in two rows.'],
    Metacarpals: ['skeleton', 'Five long bones of the palm; their heads are the knuckles.'],
    'Phalanges (hand)': ['skeleton', 'Fourteen finger bones: three per finger, two in the thumb.'],
    Pelvis: ['skeleton', 'Two hip bones and the sacrum form a ring that carries the trunk onto the legs.'],
    Femur: ['skeleton', 'The thigh bone — the longest and strongest bone, about a quarter of body height.'],
    Patella: ['skeleton', 'The kneecap, a bone grown inside the quadriceps tendon.'],
    Tibia: ['skeleton', 'The shin bone carries the body’s weight to the ankle.'],
    Fibula: ['skeleton', 'Thin outer leg bone; it anchors muscles and forms the outer ankle.'],
    'Tarsal bones': ['skeleton', 'Seven ankle bones; the calcaneus forms the heel.'],
    Metatarsals: ['skeleton', 'Five bones forming the arches of the foot.'],
    'Phalanges (foot)': ['skeleton', 'Fourteen toe bones: two in the big toe, three in the others.'],
    Teeth: ['skeleton', 'Enamel is the hardest substance in the body.'],
    Muscles: ['muscles', 'Over 600 skeletal muscles, about a third of body mass, pull on bones through tendons.'],
  };

  // ============================================================ skeleton
  // Prefabs are modelled once as distance fields in their own frame (meters,
  // x lateral for the left side, y up, z forward) and placed per body.
  const PREFABS = {};
  function prefab(key, res, build) {
    const k = key + '@' + res;
    if (!PREFABS[k]) { const [f, lo, hi] = build(); PREFABS[k] = polygonize(f, lo, hi, res); }
    return PREFABS[k];
  }

  // vertebra: body centre at the origin, y up the spine, z forward
  function vertebraSDF(type) {
    const T = {
      C: { bw: 0.0095, bd: 0.0078, bh: 0.0062, ped: 0.012, lam: 0.021, sp: [0, -0.006, -0.034, 0.0035], tp: 0.024, tpz: -0.006 },
      T: { bw: 0.0135, bd: 0.0125, bh: 0.0095, ped: 0.022, lam: 0.03, sp: [0, -0.026, -0.058, 0.0028], tp: 0.032, tpz: -0.03 },
      L: { bw: 0.022, bd: 0.016, bh: 0.0125, ped: 0.026, lam: 0.034, sp: [0, -0.006, -0.062, 0.0055], tp: 0.042, tpz: -0.024 },
    }[type === 'A' ? 'C' : type];
    const sx = type === 'L' ? 0.011 : type === 'T' ? 0.0085 : 0.009;
    return [(x, y, z) => {
      let d;
      if (type === 'A') { // atlas: a ring with heavy lateral masses
        const rx = sqrt(x * x * 1.1 + (z + 0.008) * (z + 0.008)) - 0.0145;
        d = sqrt(rx * rx + y * y * 2.2) - 0.0034;
        d = smin(d, ell(x, y, z, [0.0135, 0, -0.004], [0.006, 0.0055, 0.008]), 0.004);
        d = smin(d, ell(x, y, z, [-0.0135, 0, -0.004], [0.006, 0.0055, 0.008]), 0.004);
        d = smin(d, cone(x, y, z, [0.014, 0, -0.006], [0.031, -0.002, -0.009], 0.0045, 0.0035), 0.003);
        d = smin(d, cone(x, y, z, [-0.014, 0, -0.006], [-0.031, -0.002, -0.009], 0.0045, 0.0035), 0.003);
        return d;
      }
      const waist = 1 - 0.1 * (1 - (y / T.bh) ** 2);
      d = disc(x / waist, y, z / waist, [0, 0, 0], T.bw, T.bd, T.bh, 0.002) * waist;
      for (const s of [1, -1]) {
        d = smin(d, cone(x, y, z, [s * T.bw * 0.55, 0.001, -T.bd * 0.75], [s * sx, 0.001, -T.ped], 0.0032, 0.003), 0.003);
        d = smin(d, cone(x, y, z, [s * sx, 0, -T.ped], [0, -0.001, -T.lam], 0.003, 0.0035), 0.003);
        d = smin(d, cone(x, y, z, [s * sx, 0.002, -T.ped - 0.002], [s * T.tp, type === 'T' ? 0.004 : 0.0, T.tpz], 0.0035, type === 'L' ? 0.0022 : 0.003), 0.003);
        d = smin(d, cone(x, y, z, [s * sx, 0.002, -T.ped], [s * sx, T.bh + 0.004, -T.ped + 0.001], 0.003, 0.0026), 0.002);
        d = smin(d, cone(x, y, z, [s * sx * 0.85, -0.002, -T.lam + 0.004], [s * sx * 0.85, -T.bh - 0.004, -T.lam + 0.002], 0.0028, 0.0024), 0.002);
        if (type === 'C') d = smin(d, cone(x, y, z, [s * sx, 0.004, -T.ped], [s * sx, -0.005, -T.ped], 0.0042, 0.0042), 0.002);
      }
      if (type === 'L') d = smin(d, chain(x, y, z, [[0, 0, -T.lam, 0.004], [0, -0.003, -0.05, 0.0045], [0, -0.005, T.sp[2], 0.004]]) - 0.0, 0.004);
      else d = smin(d, cone(x, y, z, [0, -0.001, -T.lam], [T.sp[0], T.sp[1], T.sp[2]], 0.0035, T.sp[3]), 0.003);
      if (type === 'L') d = smin(d, ell(x, y, z, [0, -0.005, -0.055], [0.0035, 0.009, 0.01]), 0.004);
      return d;
    }, [-0.05, -0.04, -0.075], [0.05, 0.03, 0.03]];
  }

  // a long-bone section: tube with a radius profile, ends swollen
  function boneTube(a, b, r0, r1, seg, flat) {
    const pts = [], rs = [], n = 7;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      pts.push(new V3().lerpVectors(a, b, t));
      const bulge = 1 + 0.42 * (sstep(0.32, 0, t) + sstep(0.68, 1, t));
      rs.push(mix(r0, r1, t) * bulge);
    }
    const ends = 0.6 * min(r0, r1);
    pts[0] = pts[0].clone().lerp(pts[1], 0.0); pts[n - 1] = pts[n - 1].clone();
    const sh = tube(pts, (i) => (flat ? [rs[i] * flat, rs[i]] : rs[i]), { seg });
    // round the ends with the cap centres pushed outwards
    const nv = sh.pos.length / 3;
    const dir = new V3().subVectors(b, a).normalize();
    sh.pos[(nv - 2) * 3] -= dir.x * ends; sh.pos[(nv - 2) * 3 + 1] -= dir.y * ends; sh.pos[(nv - 2) * 3 + 2] -= dir.z * ends;
    sh.pos[(nv - 1) * 3] += dir.x * ends; sh.pos[(nv - 1) * 3 + 1] += dir.y * ends; sh.pos[(nv - 1) * 3 + 2] += dir.z * ends;
    return sh;
  }

  function buildSkeleton(A, B) {
    const geo = new Geo(), s = B.s, q = A.quality, proxies = [];
    const ID = (name) => A.partId(name, 'skeleton');
    const prox = (name, bone, a, b, r) => proxies.push({ name, bone, a: a.clone(), b: b.clone(), r });
    const res = q === 'high' ? 1 : q === 'medium' ? 1.35 : 1.8; // prefab cell scale
    const seg = q === 'low' ? 6 : 8;
    const tf = s * (0.94 + 0.1 * B.g); // bone thickness factor

    // ---- spine: levels from the skull base to the sacral promontory
    const hipL = B.J('upperleg01.L'), hipR = B.J('upperleg01.R');
    const hipY = (hipL.y + hipR.y) / 2;
    const yS1 = hipY + 0.075 * s;
    const yC1 = B.J('jaw').y - 0.03 * s;
    const notchY = B.J('clavicle.L').y + 0.012 * s;
    const yT1 = notchY + 0.045 * s;
    const yL1 = yT1 - (yT1 - yS1) * 0.61;
    const fatB = B.fat * 0.8;
    const depth = (y) => {
      // back skin to vertebral body centre
      if (y > yT1 + 0.01 * s) return fatB * 0.6 + (0.03 + 0.038) * s;
      if (y > yL1) return fatB + (0.012 + 0.06) * s;
      return fatB + (0.025 + 0.058) * s;
    };
    const colZ = (y) => {
      let z = 0, wsum = 0;
      for (let k = -3; k <= 3; k++) { const yy = y + k * 0.01, w = 1 - abs(k) / 4; z += (B.back(0, yy) + depth(yy)) * w; wsum += w; }
      return min(z / wsum, B.front(0, y) - 0.035 * s);
    };
    const levels = [];
    const region = (name, y0, y1, ws, type, discK) => {
      const tot = ws.reduce((a, b) => a + b, 0);
      let y = y0;
      ws.forEach((w, i) => {
        const hgt = ((y0 - y1) * w) / tot;
        levels.push({ name: name + (i + 1), type: i === 0 && name === 'C' ? 'A' : type, y: y - hgt / 2, h: hgt * (1 - discK), gap: hgt * discK, k: i });
        y -= hgt;
      });
    };
    region('C', yC1 + 0.006 * s, yT1, [1.1, 1.5, 1.2, 1.2, 1.25, 1.3, 1.4], 'C', 0.22);
    region('T', yT1, yL1, [1.9, 2.0, 2.05, 2.1, 2.15, 2.2, 2.25, 2.35, 2.45, 2.55, 2.65, 2.75], 'T', 0.2);
    region('L', yL1, yS1, [3.4, 3.55, 3.6, 3.6, 3.5], 'L', 0.26);
    const PRE = {
      C: prefab('vertC', 0.0011 * res, () => vertebraSDF('C')), A: prefab('vertA', 0.0011 * res, () => vertebraSDF('A')),
      T: prefab('vertT', 0.0013 * res, () => vertebraSDF('T')), L: prefab('vertL', 0.0015 * res, () => vertebraSDF('L')),
    };
    const NH = { C: 0.0124, A: 0.0124, T: 0.019, L: 0.025 };
    const tan = new V3(), zAx = new V3(), xAx = new V3(1, 0, 0);
    const vName = { C: 'Cervical vertebrae', A: 'Cervical vertebrae', T: 'Thoracic vertebrae', L: 'Lumbar vertebrae' };
    for (const L of levels) {
      L.z = colZ(L.y);
      L.c = new V3(0, L.y, L.z);
    }
    levels.forEach((L, i) => {
      const up = levels[max(0, i - 1)].c, dn = levels[min(levels.length - 1, i + 1)].c;
      tan.subVectors(up, dn).normalize();
      zAx.crossVectors(xAx, tan).normalize();
      const k = L.h / NH[L.type];
      const wk = L.type === 'T' ? mix(0.9, 1.25, L.k / 11) : L.type === 'L' ? mix(0.92, 1.05, L.k / 4) : L.type === 'C' ? mix(0.95, 1.2, L.k / 6) : 1;
      const sc = tf * wk;
      const m = frame(L.c, xAx.clone().multiplyScalar(sc), tan.clone().multiplyScalar(clamp(k, 0.7, 1.5) * tf), zAx.clone().multiplyScalar(sc));
      L.m = m; L.tan = tan.clone(); L.fw = zAx.clone(); L.sc = sc;
      L.bone = B.spineBone(L.y);
      geo.add(PRE[L.type], m, COL.bone, ID(vName[L.type]), L.bone);
      prox(vName[L.type], L.bone, new V3(0, L.y, L.z - 0.02 * s), new V3(0, L.y, L.z + 0.005 * s), 0.02 * sc / s + 0.006);
      // disc below
      if (L.type !== 'A' && i < levels.length - 1) {
        const nxt = levels[i + 1], dc = new V3().lerpVectors(L.c, nxt.c, 0.5);
        const T = { C: [0.0095, 0.0078], T: [0.0135, 0.0125], L: [0.022, 0.016] }[L.type];
        const d = ellipsoid(T[0] * sc * 0.97, L.gap * 0.62, T[1] * sc * 0.97, seg + 4, 4);
        geo.add(d, frame(dc, xAx, tan, zAx), COL.disc, ID('Intervertebral discs'), L.bone);
      }
    });
    const lv = (nm) => levels.find((L) => L.name === nm);

    // ---- sacrum and coccyx
    const L5 = lv('L5');
    const s1 = new V3(0, yS1 - L5.gap * 0.5, L5.z - 0.004 * s);
    const sacrum = prefab('sacrum', 0.0016 * res, () => [(x, y, z) => {
      let d = disc(x, y, z, [0, -0.011, 0], 0.024, 0.016, 0.011, 0.003);
      for (const sx of [1, -1]) d = smin(d, ell(x, y, z, [sx * 0.03, -0.018, -0.012], [0.024, 0.017, 0.017]), 0.008);
      const spine = [[0, -0.02, -0.006, 0], [0, -0.05, -0.02, 0], [0, -0.078, -0.03, 0], [0, -0.1, -0.03, 0]];
      const wid = [0.046, 0.034, 0.022, 0.011];
      for (let i = 0; i < 4; i++) d = smin(d, ell(x, y, z, spine[i], [wid[i], 0.017, 0.012 - i * 0.0015]), 0.012);
      d = smin(d, chain(x, y, z, [[0, -0.02, -0.024, 0.003], [0, -0.07, -0.042, 0.0025]]), 0.004);
      for (let i = 0; i < 4; i++) for (const sx of [1, -1]) d = smax(d, -sph(x, y, z, [sx * (0.015 - i * 0.002), -0.03 - i * 0.02, spine[i][2] + 0.012], 0.0042), 0.002);
      for (let i = 0; i < 4; i++) d = smin(d, sph(x, y, z, [0, -0.112 - i * 0.009, -0.026 + i * 0.005], 0.0055 - i * 0.0009), 0.003);
      return d;
    }, [-0.08, -0.16, -0.07], [0.08, 0.02, 0.04]]);
    const pelvisBone = B.bone('spine05');
    const sacK = s * (0.95 + 0.12 * (1 - B.g));
    geo.add(sacrum, frame(s1, new V3(sacK, 0, 0), new V3(0, s, 0), new V3(0, 0, s)), COL.bone, ID('Sacrum'), pelvisBone);
    prox('Sacrum', pelvisBone, s1.clone().add(new V3(0, -0.02 * s, -0.01 * s)), s1.clone().add(new V3(0, -0.09 * s, -0.03 * s)), 0.03 * s);

    // ---- ribcage: ribs follow the inner chest wall at their own height
    const ribs = [];
    const inset = (ang) => {
      const a = abs(ang);
      const muscle = a < 0.6 ? 0.008 + 0.01 * B.m : a < 2.2 ? 0.012 + 0.006 * B.m : mix(0.014, 0.034, sstep(2.2, 2.9, a));
      return (B.fat * (a > 2.4 ? 0.8 : 1) + muscle * s) + 0.004 * s;
    };
    const tLv = (k) => lv('T' + k);
    const xiphY = notchY - 0.165 * s;
    const sternZ = (y) => B.front(0, y) - B.fat * 0.55 - 0.007 * s;
    const sternum = [];
    for (let i = 0; i <= 10; i++) { const y = mix(notchY - 0.004 * s, xiphY, i / 10); sternum.push(new V3(0, y, sternZ(y))); }
    const sternAt = (t) => { const f = t * 10, i = Math.min(9, Math.floor(f)); return new V3().lerpVectors(sternum[i], sternum[i + 1], f - i); };
    const ribFront = [0.03, 0.12, 0.25, 0.37, 0.49, 0.6, 0.72]; // where cartilages meet the sternum
    const spineB = (y) => B.spineBone(y);
    for (let k = 1; k <= 12; k++) {
      const v = tLv(k), side = [];
      const yH = v.y + v.h * 0.35;
      const drop = s * (0.022 + 0.0075 * min(k, 8));
      const endAng = [0.5, 0.62, 0.66, 0.68, 0.7, 0.72, 0.74, 0.86, 0.98, 1.1, 1.45, 1.75][k - 1];
      for (const sd of [1, -1]) {
        const ctrl = [];
        const bw = 0.0135 * v.sc / s * s;
        ctrl.push(new V3(sd * (bw + 0.004 * s), yH, v.z - 0.004 * s));
        ctrl.push(new V3(sd * (bw + 0.016 * s), yH + 0.002 * s, v.z - 0.016 * s));
        const nA = 9;
        for (let i = 0; i <= nA; i++) {
          const u = i / nA, ang = sd * mix(2.65, endAng, u);
          const y = yH - drop * sstep(0, 1, u * 0.9 + 0.1) - 0.006 * s;
          const p = B.rim(y, ang, inset(ang));
          if (u < 0.2) p.z = min(p.z, v.z - 0.02 * s);
          ctrl.push(p);
        }
        // a rib never reaches further forward than the sternum line allows
        for (const p of ctrl) p.z = min(p.z, sternZ(p.y) + 0.005 * s);
        const pts = path(ctrl, 0.008 * s);
        const nP = pts.length;
        const rib = tube(pts, (i) => {
          const u = i / (nP - 1);
          const hgt = (0.0045 + 0.0025 * sstep(0, 0.4, u)) * s * (k === 1 ? 1.3 : k > 10 ? 0.8 : 1);
          return [0.0024 * s + 0.001 * s * (1 - u), hgt];
        }, { seg, side: (i) => new V3(pts[i].x, 0, pts[i].z - v.z).normalize() });
        const bone = spineB(yH);
        geo.add(rib, new THREE.Matrix4(), COL.bone, ID('Ribs'), bone);
        prox('Ribs', bone, pts[Math.floor(nP * 0.3)], pts[Math.floor(nP * 0.75)], 0.012 * s);
        side.push(pts);
        // costal cartilage
        if (k <= 10) {
          const end = pts[nP - 1], prevEnd = pts[nP - 3];
          let target;
          if (k <= 7) { const st = sternAt(ribFront[k - 1]); target = new V3(sd * 0.012 * s * (k === 1 ? 1.6 : 1), st.y, st.z - 0.004 * s); }
          else { const up = ribs[k - 2][sd > 0 ? 0 : 1]; target = up.cart[Math.floor(up.cart.length * 0.55)].clone(); }
          const dir = new V3().subVectors(end, prevEnd).normalize();
          const mid = end.clone().addScaledVector(dir, 0.02 * s);
          mid.y = mix(mid.y, target.y, 0.2);
          const cc = path([end, mid, target], 0.006 * s);
          for (const p of cc) p.z = min(p.z, sternZ(p.y) + 0.004 * s);
          const cart = tube(cc, () => [0.0028 * s, 0.0045 * s], { seg, side: (i) => new V3(cc[i].x, 0, cc[i].z - v.z).normalize() });
          geo.add(cart, new THREE.Matrix4(), COL.cart, ID('Costal cartilage'), bone);
          side[side.length - 1].cart = cc;
          side.cart = side.cart || [];
          side[sd > 0 ? 'cartL' : 'cartR'] = cc;
        }
      }
      ribs.push([{ cart: side.cartL || [] }, { cart: side.cartR || [] }]);
    }
    // sternum: manubrium, body, xiphoid
    const sb = B.spineBone(mix(notchY, xiphY, 0.5));
    const stPts = path(sternum, 0.006 * s);
    const nS = stPts.length;
    const st = tube(stPts, (i) => {
      const u = i / (nS - 1);
      const w = u < 0.28 ? mix(0.026, 0.014, sstep(0.08, 0.28, u)) : u < 0.86 ? 0.014 + 0.004 * Math.sin(((u - 0.28) / 0.58) * PI) : mix(0.012, 0.004, sstep(0.86, 1, u));
      return [w * s, (u < 0.28 ? 0.0055 : 0.0045) * s];
    }, { seg: seg + 2, side: () => new V3(1, 0, 0) });
    geo.add(st, new THREE.Matrix4(), COL.bone, ID('Sternum'), sb);
    prox('Sternum', sb, sternum[0], sternum[10], 0.02 * s);

    // ---- shoulder girdle
    for (const sd of [1, -1]) {
      const S = sd > 0 ? '.L' : '.R';
      const sh = B.J('upperarm01' + S);
      const acro = new V3(sh.x - sd * 0.004 * s, sh.y + 0.032 * s, sh.z - 0.004 * s);
      const sc0 = new V3(sd * 0.022 * s, notchY, sternZ(notchY) - 0.006 * s);
      const ctrl = [sc0];
      for (const [t, dz] of [[0.3, 0.012], [0.62, 0.002], [0.85, -0.01]]) {
        const p = new V3().lerpVectors(sc0, acro, t);
        p.y += 0.008 * s * Math.sin(t * PI);
        p.z = min(p.z + dz * s, B.front(p.x, p.y) - B.fat * 0.4 - 0.007 * s);
        ctrl.push(p);
      }
      ctrl.push(acro);
      const cp = path(ctrl, 0.006 * s), nC = cp.length;
      const cl = tube(cp, (i) => { const u = i / (nC - 1); return [mix(0.0075, 0.0045, u) * tf, mix(0.0065, 0.0075, u) * tf]; }, { seg, side: () => new V3(0, 1, 0) });
      const cb = B.bone('clavicle' + S);
      geo.add(cl, new THREE.Matrix4(), COL.bone, ID('Clavicle'), cb);
      prox('Clavicle', cb, sc0, acro, 0.01 * s);
      // scapula: a plate on the back of the ribcage from T2 to T7
      const sa = new V3(sd * 0.072 * s, lv('T2').y, 0), ia = new V3(sd * 0.085 * s, lv('T7').y, 0), rt = new V3(sd * 0.078 * s, lv('T3').y - 0.01 * s, 0);
      for (const p of [sa, ia, rt]) p.z = B.back(p.x, p.y) + B.fat * 0.8 + 0.016 * s;
      const glen = sh.clone().add(new V3(-sd * 0.022 * s, 0, -0.006 * s));
      const scap = prefab('scapula', 0.0018 * res, scapulaSDF);
      const mS = fitAffine([new V3(-0.022, 0, -0.004), new V3(-0.088, 0.055, -0.057), new V3(-0.078, -0.12, -0.062), new V3(-0.083, 0.02, -0.06)].map((p) => p.clone().setX(p.x * sd)),
        [glen.clone().add(new V3(sd * 0.0, 0, 0)), sa, ia, rt]);
      // scapula prefab is the left one; mirror for the right by flipping x in canonical space
      const mirror = new THREE.Matrix4().makeScale(sd, 1, 1);
      const sb2 = B.bone('shoulder01' + S);
      geo.add(scap, mS.clone().multiply(mirror), COL.bone, ID('Scapula'), sb2);
      prox('Scapula', sb2, sa.clone().lerp(glen, 0.5), ia, 0.035 * s);
    }

    // ---- skull and mandible, fitted to the head by landmarks
    {
      const eL = B.J('eye.L'), eR = B.J('eye.R'), H = B.headInfo;
      const src = [new V3(0.03, 0, 0), new V3(-0.03, 0, 0), new V3(0, 0.104, -0.06), new V3(0, 0.02, -0.174), new V3(0.068, 0.03, -0.075), new V3(-0.068, 0.03, -0.075), new V3(0, -0.053, 0.019), new V3(0, -0.126, -0.004)];
      const dst = [eL, eR, H.vertex, H.occiput, H.euryL, H.euryR, H.incisor, H.menton];
      const m = fitAffine(src, dst);
      const skull = prefab('skull', 0.0018 * res, skullSDF);
      const hb = B.bone('head');
      geo.add(skull, m, COL.bone, ID('Skull'), hb);
      const mand = prefab('mandible', 0.0016 * res, mandibleSDF);
      const jb = B.bone('jaw');
      geo.add(mand, m, COL.bone, ID('Mandible'), jb);
      const c = new V3(0, 0.035, -0.075).applyMatrix4(m);
      prox('Skull', hb, c.clone().add(new V3(0, 0, 0.03 * s)), c.clone().add(new V3(0, 0, -0.03 * s)), 0.075 * s);
      prox('Mandible', jb, new V3(0, -0.1, -0.03).applyMatrix4(m), new V3(0, -0.115, 0.0).applyMatrix4(m), 0.03 * s);
      B.skullM = m;
    }

    // ---- pelvis (hip bones), legs and feet
    const bwPel = 1 + 0.1 * (1 - B.g);
    for (const sd of [1, -1]) {
      const S = sd > 0 ? '.L' : '.R';
      const hip = B.J('upperleg01' + S), knee = B.J('lowerleg01' + S), ankle = B.J('foot' + S);
      const fr = B.fat;
      const asisY = hip.y + 0.072 * s, asisX = hip.x + sd * 0.022 * s * bwPel;
      const asis = new V3(asisX, asisY, B.front(asisX, asisY) - fr * 0.7 - 0.012 * s);
      const crestY = hip.y + 0.115 * s, crest = new V3(sd * (B.halfW(crestY) - fr - 0.014 * s), crestY, hip.z - 0.012 * s);
      const psis = new V3(sd * 0.04 * s, hip.y + 0.078 * s, 0); psis.z = B.back(psis.x, psis.y) + fr * 0.7 + 0.012 * s;
      const symY = hip.y - 0.028 * s, sym = new V3(sd * 0.006 * s, symY, B.front(0, symY) - fr - 0.02 * s);
      const isch = new V3(sd * 0.055 * s * bwPel, hip.y - 0.078 * s, hip.z - 0.035 * s);
      const src = [new V3(0, 0, 0), new V3(0.03, 0.075, 0.045), new V3(0.055, 0.115, -0.01), new V3(-0.04, 0.078, -0.085), new V3(-0.079, -0.028, 0.045), new V3(-0.03, -0.078, -0.035)];
      const m = fitAffine(src.map((p) => p.clone().setX(p.x * sd)), [hip, asis, crest, psis, sym, isch]);
      const hipBone = prefab('hipbone', 0.0019 * res, hipSDF);
      geo.add(hipBone, m.clone().multiply(new THREE.Matrix4().makeScale(sd, 1, 1)), COL.bone, ID('Pelvis'), pelvisBone);
      prox('Pelvis', pelvisBone, hip.clone().lerp(crest, 0.6), hip.clone().lerp(sym, 0.6), 0.045 * s);

      // femur, patella, tibia, fibula (prefabs in their own bone frame)
      const ant = new V3(0, 0, 1);
      const longBone = (key, sdf, a, b, refLen, name, bone, thick) => {
        const y = new V3().subVectors(a, b), len = y.length(); y.normalize();
        const z = ant.clone().addScaledVector(y, -ant.dot(y)).normalize();
        const x = new V3().crossVectors(y, z).multiplyScalar(sd);
        const k = len / refLen, t = tf * (thick || 1);
        const mm = frame(a, x.multiplyScalar(t), y.multiplyScalar(k), z.multiplyScalar(t));
        geo.add(prefab(key, 0.0017 * res, sdf), mm, COL.bone, ID(name), bone);
        prox(name, bone, a, b, 0.022 * t / s * s);
        return mm;
      };
      const ul = B.bone('upperleg02' + S), ll = B.bone('lowerleg01' + S), ll2 = B.bone('lowerleg02' + S);
      const fm = longBone('femur', femurSDF, hip, knee, 0.43, 'Femur', ul);
      // patella sits on the front of the knee under the skin
      const pat = new V3(0, -0.405, 0.038).applyMatrix4(fm);
      geo.add(ellipsoid(0.021 * tf, 0.024 * tf, 0.009 * tf, seg + 4, seg), frame(pat, new V3(1, 0, 0), new V3(0, 1, 0), new V3(0, 0, 1)), COL.bone, ID('Patella'), ll);
      prox('Patella', ll, pat, pat, 0.025 * s);
      const tm = longBone('tibia', tibiaSDF, knee, ankle, 0.40, 'Tibia', ll2);
      longBone('fibula', fibulaSDF, knee, ankle, 0.40, 'Fibula', ll2);
      void tm;
      buildFoot(B, geo, sd, S, ID, prox, tf, seg);
    }

    // ---- arms and hands
    for (const sd of [1, -1]) {
      const S = sd > 0 ? '.L' : '.R';
      const sh = B.J('upperarm01' + S), el = B.J('lowerarm01' + S), wr = B.J('wrist' + S);
      const ant = new V3(0, 0, 1);
      const place = (key, sdf, a, b, refLen, name, bone, antV) => {
        const y = new V3().subVectors(a, b), len = y.length(); y.normalize();
        const av = antV || ant;
        const z = av.clone().addScaledVector(y, -av.dot(y)).normalize();
        const x = new V3().crossVectors(y, z).multiplyScalar(sd);
        const mm = frame(a, x.multiplyScalar(tf), y.multiplyScalar(len / refLen), z.multiplyScalar(tf));
        geo.add(prefab(key, 0.0015 * res, sdf), mm, COL.bone, ID(name), bone);
        prox(name, bone, a, b, 0.016 * tf);
      };
      place('humerus', humerusSDF, sh, el, 0.3, 'Humerus', B.bone('upperarm02' + S));
      // forearm: palms face down-forward in the rest pose, so "anterior" of
      // the forearm (flexor side) points down and forward
      const fa = new V3(0, -0.6, 0.8).normalize();
      place('ulna', ulnaSDF, el, wr, 0.26, 'Ulna', B.bone('lowerarm02' + S), fa);
      place('radius', radiusSDF, el, wr, 0.26, 'Radius', B.bone('lowerarm02' + S), fa);
      buildHand(B, geo, sd, S, ID, prox, tf, seg);
    }
    return { geo: geo.build(), proxies };
  }

  // hand: carpals in two rows, then metacarpals and phalanges along the rig
  function buildHand(B, geo, sd, S, ID, prox, tf, seg) {
    const wr = B.J('wrist' + S), wt = B.J('wrist' + S, 'tail');
    const wb = B.bone('wrist' + S);
    const thumb = B.J('finger1-1' + S), pinky = B.J('metacarpal4' + S);
    const across = new V3().subVectors(thumb, pinky).normalize();
    const along = new V3().subVectors(wt, wr).normalize();
    const palm = new V3().crossVectors(along, across).normalize();
    const carp = (t, u, r) => {
      const c = wr.clone().lerp(wt, t).addScaledVector(across, u * tf);
      geo.add(ellipsoid(r[0] * tf, r[1] * tf, r[2] * tf, seg, seg - 2), frame(c, across, along, palm), COL.bone, ID('Carpal bones'), wb);
    };
    for (const [u, r] of [[0.011, [0.0068, 0.0058, 0.0055]], [0.0, [0.0058, 0.0056, 0.0058]], [-0.011, [0.0055, 0.005, 0.005]]]) carp(0.15, u, r);
    for (const [u, r] of [[0.015, [0.0058, 0.0055, 0.0055]], [0.004, [0.0048, 0.0052, 0.005]], [-0.005, [0.0058, 0.0068, 0.0062]], [-0.015, [0.0058, 0.0062, 0.0058]]]) carp(0.72, u, r);
    prox('Carpal bones', wb, wr, wt, 0.018 * tf);
    const phal = (a, b, r0, r1, name, bone) => {
      const len = a.distanceTo(b), g = 0.0012 * tf;
      const d = new V3().subVectors(b, a).normalize();
      const p0 = a.clone().addScaledVector(d, g), p1 = b.clone().addScaledVector(d, -g);
      if (len < 3 * g) return;
      geo.add(boneTube(p0, p1, r0 * tf, r1 * tf, seg - 2, 0.85), new THREE.Matrix4(), COL.bone, ID(name), bone);
      prox(name, bone, p0, p1, r0 * tf * 1.6);
    };
    for (let f = 1; f <= 4; f++) {
      const mc = B.bone('metacarpal' + f + S);
      phal(B.J('metacarpal' + f + S), B.J('metacarpal' + f + S, 'tail'), 0.0042, 0.0042, 'Metacarpals', mc);
      for (let k = 1; k <= 3; k++) {
        const nm = 'finger' + (f + 1) + '-' + k + S;
        const r = [0.0042, 0.0034, 0.0029][k - 1];
        phal(B.J(nm), B.J(nm, 'tail'), r, r * 0.8, 'Phalanges (hand)', B.bone(nm));
      }
    }
    phal(B.J('finger1-1' + S), B.J('finger1-1' + S, 'tail'), 0.0048, 0.0044, 'Metacarpals', B.bone('finger1-1' + S));
    phal(B.J('finger1-2' + S), B.J('finger1-2' + S, 'tail'), 0.0045, 0.0036, 'Phalanges (hand)', B.bone('finger1-2' + S));
    phal(B.J('finger1-3' + S), B.J('finger1-3' + S, 'tail'), 0.0036, 0.0026, 'Phalanges (hand)', B.bone('finger1-3' + S));
  }

  // foot: talus and calcaneus under the ankle, a row of small tarsals, then
  // metatarsals and toe phalanges along the rig
  function buildFoot(B, geo, sd, S, ID, prox, tf, seg) {
    const an = B.J('foot' + S), fb = B.bone('foot' + S);
    const toeH = [1, 2, 3, 4, 5].map((k) => B.J('toe' + k + '-1' + S));
    const ball = toeH.reduce((a, b) => a.add(b), new V3()).multiplyScalar(0.2);
    const fwd = new V3(ball.x - an.x, 0, ball.z - an.z).normalize();
    const up = new V3(0, 1, 0), lat = new V3().crossVectors(up, fwd).multiplyScalar(sd).normalize();
    const P = (f, u, l) => an.clone().addScaledVector(fwd, f * tf).addScaledVector(up, u * tf).addScaledVector(lat, l * tf);
    const fr = frame(new V3(), lat, up, fwd);
    const blob = (c, r, name) => { geo.add(ellipsoid(r[0] * tf, r[1] * tf, r[2] * tf, seg, seg - 2), fr.clone().setPosition(c), COL.bone, ID(name), fb); };
    blob(P(0.008, -0.012, 0), [0.016, 0.012, 0.022], 'Tarsal bones'); // talus
    const heel = P(-0.045, -0.042, 0.004);
    geo.add(boneTube(P(0.03, -0.044, 0.008), heel, 0.012 * tf, 0.016 * tf, seg, 1.15), new THREE.Matrix4(), COL.bone, ID('Tarsal bones'), fb); // calcaneus
    blob(P(0.043, -0.022, -0.013), [0.012, 0.01, 0.008], 'Tarsal bones'); // navicular
    blob(P(0.05, -0.036, 0.016), [0.011, 0.01, 0.014], 'Tarsal bones'); // cuboid
    for (const l of [-0.02, -0.008, 0.004]) blob(P(0.064, -0.028, l), [0.0055, 0.01, 0.009], 'Tarsal bones'); // cuneiforms
    prox('Tarsal bones', fb, heel, P(0.05, -0.03, 0), 0.025 * tf);
    const bases = [P(0.075, -0.026, -0.02), P(0.077, -0.028, -0.008), P(0.074, -0.03, 0.004), P(0.07, -0.034, 0.015), P(0.064, -0.038, 0.025)];
    const phal = (a, b, r0, r1, name, bone) => {
      const d = new V3().subVectors(b, a), len = d.length();
      if (len < 0.004) return;
      d.normalize();
      const g = 0.0012 * tf;
      geo.add(boneTube(a.clone().addScaledVector(d, g), b.clone().addScaledVector(d, -g), r0 * tf, r1 * tf, seg - 2, 0.9), new THREE.Matrix4(), COL.bone, ID(name), bone);
      prox(name, bone, a, b, r0 * tf * 1.6);
    };
    for (let k = 1; k <= 5; k++) {
      const head = toeH[k - 1].clone().add(new V3(0, -0.006 * tf, 0));
      phal(bases[k - 1], head, k === 1 ? 0.0075 : 0.0045, k === 1 ? 0.0065 : 0.0038, 'Metatarsals', fb);
      for (let j = 1; j <= (k === 1 ? 2 : 3); j++) {
        const nm = 'toe' + k + '-' + j + S;
        const r = (k === 1 ? 0.0068 : 0.0038) * [1, 0.85, 0.75][j - 1];
        phal(B.J(nm).add(new V3(0, -0.004 * tf, 0)), B.J(nm, 'tail').add(new V3(0, -0.004 * tf, 0)), r, r * 0.8, 'Phalanges (foot)', B.bone(nm));
      }
    }
  }

  // ---- prefab distance fields (left side; x lateral, y up, z forward)
  function scapulaSDF() {
    const SA = [-0.088, 0.055, -0.057], IA = [-0.078, -0.12, -0.062], N = [-0.026, -0.006, -0.016], SB = [-0.04, 0.036, -0.026], LB = [-0.04, -0.065, -0.03];
    return [(x, y, z) => {
      let d = tri(x, y, z, SA, IA, N) - 0.0022;
      d = smin(d, tri(x, y, z, SA, N, SB) - 0.0022, 0.004);
      d = smin(d, tri(x, y, z, IA, LB, N) - 0.0022, 0.004);
      d = smin(d, chain(x, y, z, [[...SA, 0.003], [-0.09, -0.03, -0.062, 0.003], [...IA, 0.004]]), 0.004);
      d = smin(d, chain(x, y, z, [[...N, 0.007], [...LB, 0.005], [...IA, 0.004]]), 0.005);
      d = smin(d, chain(x, y, z, [[...SB, 0.0025], [...SA, 0.003]]), 0.003);
      // spine of the scapula rising into the acromion
      d = smin(d, chain(x, y, z, [[-0.086, 0.022, -0.064, 0.003], [-0.055, 0.03, -0.066, 0.0045], [-0.025, 0.036, -0.05, 0.0055], [-0.002, 0.038, -0.025, 0.006], [0.012, 0.034, 0.0, 0.0055]]), 0.006);
      d = smin(d, ell(x, y, z, [0.006, 0.034, -0.01], [0.012, 0.0045, 0.018]), 0.004);
      d = smin(d, chain(x, y, z, [[-0.028, 0.018, -0.012, 0.005], [-0.022, 0.03, 0.01, 0.0045], [-0.008, 0.022, 0.03, 0.004]]), 0.005);
      // glenoid cup facing the humeral head
      let g = ell(x, y, z, [-0.024, 0, -0.005], [0.008, 0.019, 0.013]);
      g = smax(g, -sph(x, y, z, [0.004, 0, 0.0], 0.0245), 0.002);
      d = smin(d, g, 0.005);
      return d;
    }, [-0.11, -0.14, -0.09], [0.035, 0.065, 0.05]];
  }
  function skullSDF() {
    return [(x, y, z) => {
      // cranial vault
      let d = ell(x, y, z, [0, 0.032, -0.08], [0.069, 0.073, 0.095]);
      d = smin(d, ell(x, y, z, [0, 0.036, -0.03], [0.058, 0.066, 0.05]), 0.02);
      d = smax(d, -(y + 0.045 - 0.25 * max(0, z + 0.03)), 0.02);
      for (const s of [1, -1]) d = smax(d, -ell(x, y, z, [s * 0.087, -0.008, -0.035], [0.024, 0.034, 0.04]), 0.012);
      // face: brow, zygoma, maxilla, nasal bones
      let f = ell(x, y, z, [0, -0.028, -0.006], [0.052, 0.042, 0.03]);
      f = smin(f, chain(x, y, z, [[-0.046, 0.014, -0.004, 0.0065], [-0.02, 0.019, 0.01, 0.0075], [0, 0.017, 0.014, 0.0075], [0.02, 0.019, 0.01, 0.0075], [0.046, 0.014, -0.004, 0.0065]]), 0.008);
      for (const s of [1, -1]) {
        f = smin(f, ell(x, y, z, [s * 0.048, -0.028, -0.002], [0.013, 0.014, 0.012]), 0.008);
        f = smin(f, cone(x, y, z, [s * 0.055, -0.03, -0.012], [s * 0.066, -0.028, -0.055], 0.005, 0.0042), 0.006);
        f = smin(f, cone(x, y, z, [s * 0.058, -0.04, -0.075], [s * 0.054, -0.06, -0.071], 0.009, 0.005), 0.006);
      }
      f = smin(f, ell(x, y, z, [0, -0.052, 0.002], [0.032, 0.026, 0.026]), 0.012);
      f = smin(f, cone(x, y, z, [0, -0.002, 0.013], [0, -0.022, 0.024], 0.0055, 0.004), 0.004);
      d = smin(d, f, 0.016);
      // orbits, nasal aperture, ear canals
      for (const s of [1, -1]) {
        d = smax(d, -ell(x, y, z, [s * 0.031, 0.0, 0.016], [0.0185, 0.0175, 0.022]), 0.004);
        d = smax(d, -sph(x, y, z, [s * 0.067, -0.033, -0.058], 0.0045), 0.002);
      }
      d = smax(d, -ell(x, y, z, [0, -0.034, 0.028], [0.0105, 0.0165, 0.016]), 0.004);
      // foramen magnum
      d = smax(d, -ell(x, y, z, [0, -0.045, -0.075], [0.014, 0.012, 0.017]), 0.004);
      return d;
    }, [-0.09, -0.09, -0.19], [0.09, 0.12, 0.05]];
  }
  function mandibleSDF() {
    return [(x, y, z) => {
      let d = 1e9;
      for (const s of [1, -1]) {
        // body along the jaw line, ramus up to the condyle and coronoid
        d = min(d, chain(x, y, z, [[s * 0.048, -0.098, -0.058, 0.0055], [s * 0.043, -0.104, -0.03, 0.0062], [s * 0.032, -0.108, -0.005, 0.0065], [s * 0.017, -0.11, 0.012, 0.0068], [0, -0.112, 0.018, 0.0072]]));
        d = smin(d, tri(x, y, z, [s * 0.049, -0.048, -0.064], [s * 0.046, -0.098, -0.062], [s * 0.044, -0.098, -0.035]) - 0.0024, 0.004);
        d = smin(d, tri(x, y, z, [s * 0.049, -0.048, -0.064], [s * 0.044, -0.098, -0.035], [s * 0.045, -0.05, -0.036]) - 0.0024, 0.004);
        d = smin(d, ell(x, y, z, [s * 0.05, -0.04, -0.065], [0.0095, 0.0055, 0.0055]), 0.004);
        // alveolar ridge holding the lower teeth
        d = smin(d, chain(x, y, z, [[s * 0.03, -0.094, -0.004, 0.004], [s * 0.017, -0.096, 0.012, 0.0045], [0, -0.096, 0.018, 0.0045]]), 0.006);
      }
      d = smin(d, ell(x, y, z, [0, -0.118, 0.016], [0.012, 0.008, 0.007]), 0.006);
      return d;
    }, [-0.07, -0.135, -0.08], [0.07, -0.025, 0.035]];
  }
  function hipSDF() {
    // canonical left hip bone, origin at the acetabulum centre
    const crest = [[0.03, 0.075, 0.045], [0.05, 0.1, 0.02], [0.055, 0.115, -0.012], [0.038, 0.117, -0.045], [0.004, 0.1, -0.072], [-0.04, 0.078, -0.085]];
    const base = [[0.012, 0.03, 0.025], [0.006, 0.032, 0.0], [-0.008, 0.032, -0.025], [-0.022, 0.03, -0.045], [-0.035, 0.035, -0.062], [-0.045, 0.05, -0.078]];
    const mid = crest.map((c, i) => [mix(c[0], base[i][0], 0.45) + 0.01, mix(c[1], base[i][1], 0.45), mix(c[2], base[i][2], 0.45)]);
    return [(x, y, z) => {
      let d = sph(x, y, z, [0.003, 0, 0], 0.031);
      d = smax(d, -sph(x, y, z, [0.017, -0.002, 0.004], 0.025), 0.003);
      for (let i = 0; i < 5; i++) {
        d = smin(d, tri(x, y, z, crest[i], crest[i + 1], mid[i]) - 0.0028, 0.005);
        d = smin(d, tri(x, y, z, crest[i + 1], mid[i + 1], mid[i]) - 0.0028, 0.005);
        d = smin(d, tri(x, y, z, mid[i], mid[i + 1], base[i]) - 0.0035, 0.005);
        d = smin(d, tri(x, y, z, mid[i + 1], base[i + 1], base[i]) - 0.0035, 0.005);
      }
      d = smin(d, chain(x, y, z, crest.map((c, i) => [...c, i === 0 ? 0.0065 : 0.0048])), 0.004);
      d = smin(d, cone(x, y, z, [0.0, 0.015, -0.005], [-0.03, 0.045, -0.06], 0.015, 0.012), 0.01);
      d = smin(d, ell(x, y, z, [-0.042, 0.06, -0.07], [0.008, 0.026, 0.017]), 0.008);
      // pubis and ischium around the obturator foramen
      d = smin(d, chain(x, y, z, [[-0.008, -0.004, 0.018, 0.009], [-0.05, -0.015, 0.038, 0.0068], [-0.074, -0.022, 0.045, 0.0075]]), 0.006);
      d = smin(d, ell(x, y, z, [-0.075, -0.034, 0.043], [0.0075, 0.02, 0.0105]), 0.005);
      d = smin(d, chain(x, y, z, [[-0.072, -0.048, 0.038, 0.006], [-0.055, -0.068, 0.012, 0.0055], [-0.036, -0.08, -0.022, 0.0075]]), 0.005);
      d = smin(d, chain(x, y, z, [[-0.008, -0.02, -0.02, 0.012], [-0.028, -0.07, -0.034, 0.011]]), 0.008);
      d = smin(d, ell(x, y, z, [-0.03, -0.078, -0.035], [0.012, 0.016, 0.014]), 0.006);
      d = smin(d, cone(x, y, z, [-0.024, -0.03, -0.038], [-0.036, -0.036, -0.05], 0.005, 0.0022), 0.004);
      return d;
    }, [-0.1, -0.11, -0.11], [0.08, 0.135, 0.07]];
  }
  function femurSDF() {
    return [(x, y, z) => {
      let d = sph(x, y, z, [0, 0, 0], 0.0235);
      d = smin(d, cone(x, y, z, [0.006, -0.004, 0], [0.042, -0.032, -0.004], 0.0145, 0.016), 0.006);
      d = smin(d, ell(x, y, z, [0.055, -0.03, -0.008], [0.014, 0.024, 0.016]), 0.008);
      d = smin(d, sph(x, y, z, [0.026, -0.074, -0.014], 0.008), 0.008);
      d = smin(d, chain(x, y, z, [[0.046, -0.05, -0.004, 0.0165], [0.03, -0.2, 0.004, 0.0135], [0.012, -0.34, 0.002, 0.0145], [0.003, -0.395, -0.004, 0.022]]), 0.012);
      d = smin(d, ell(x, y, z, [-0.021, -0.425, -0.008], [0.016, 0.024, 0.028]), 0.008);
      d = smin(d, ell(x, y, z, [0.022, -0.424, -0.006], [0.017, 0.023, 0.027]), 0.008);
      d = smin(d, ell(x, y, z, [0, -0.412, 0.012], [0.025, 0.02, 0.012]), 0.008);
      d = smax(d, -ell(x, y, z, [0, -0.446, -0.012], [0.0075, 0.014, 0.02]), 0.004);
      return d;
    }, [-0.05, -0.47, -0.05], [0.085, 0.035, 0.045]];
  }
  function tibiaSDF() {
    return [(x, y, z) => {
      let d = ell(x, y, z, [-0.018, -0.03, -0.004], [0.021, 0.012, 0.025]);
      d = smin(d, ell(x, y, z, [0.02, -0.031, -0.006], [0.02, 0.012, 0.023]), 0.006);
      d = smin(d, chain(x, y, z, [[0, -0.036, -0.004, 0.026], [0, -0.09, 0.002, 0.017], [-0.003, -0.25, 0.0, 0.0125], [-0.004, -0.36, 0.0, 0.0145], [-0.004, -0.386, 0.0, 0.02]]), 0.014);
      d = smin(d, ell(x, y, z, [0.002, -0.068, 0.022], [0.01, 0.016, 0.007]), 0.008);
      d = smin(d, cone(x, y, z, [-0.017, -0.385, 0.0], [-0.02, -0.41, -0.002], 0.0095, 0.006), 0.005);
      return d;
    }, [-0.06, -0.43, -0.045], [0.06, 0.0, 0.045]];
  }
  function fibulaSDF() {
    return [(x, y, z) => {
      let d = sph(x, y, z, [0.03, -0.052, -0.016], 0.0095);
      d = smin(d, chain(x, y, z, [[0.03, -0.055, -0.016, 0.006], [0.029, -0.2, -0.012, 0.0055], [0.027, -0.37, -0.01, 0.0065]]), 0.006);
      d = smin(d, cone(x, y, z, [0.027, -0.37, -0.01], [0.025, -0.422, -0.012], 0.0095, 0.006), 0.006);
      return d;
    }, [0.008, -0.44, -0.035], [0.05, -0.03, 0.01]];
  }
  function humerusSDF() {
    return [(x, y, z) => {
      let d = sph(x, y, z, [-0.004, 0, -0.004], 0.022);
      d = smin(d, ell(x, y, z, [0.017, -0.008, 0.004], [0.011, 0.015, 0.012]), 0.006);
      d = smin(d, sph(x, y, z, [0.002, -0.012, 0.016], 0.007), 0.006);
      d = smin(d, chain(x, y, z, [[0.006, -0.03, 0.002, 0.0155], [0.002, -0.15, 0.0, 0.0115], [0, -0.255, -0.002, 0.0135]]), 0.012);
      d = smin(d, ell(x, y, z, [0, -0.28, -0.003], [0.027, 0.011, 0.012]), 0.008);
      d = smin(d, sph(x, y, z, [-0.029, -0.284, -0.005], 0.0075), 0.006);
      d = smin(d, ell(x, y, z, [-0.008, -0.297, 0.002], [0.012, 0.011, 0.011]), 0.004);
      d = smin(d, sph(x, y, z, [0.013, -0.295, 0.006], 0.0088), 0.004);
      return d;
    }, [-0.045, -0.32, -0.035], [0.04, 0.03, 0.035]];
  }
  function ulnaSDF() {
    return [(x, y, z) => {
      let d = ell(x, y, z, [-0.008, 0.012, -0.014], [0.0095, 0.017, 0.0105]);
      d = smax(d, -sph(x, y, z, [-0.008, 0.0, 0.006], 0.0115), 0.003);
      d = smin(d, ell(x, y, z, [-0.008, -0.012, 0.006], [0.007, 0.007, 0.007]), 0.005);
      d = smin(d, chain(x, y, z, [[-0.009, -0.016, -0.006, 0.0095], [-0.012, -0.15, -0.006, 0.007], [-0.014, -0.248, -0.006, 0.0058]]), 0.008);
      d = smin(d, sph(x, y, z, [-0.014, -0.255, -0.006], 0.0078), 0.004);
      d = smin(d, sph(x, y, z, [-0.017, -0.266, -0.01], 0.0032), 0.003);
      return d;
    }, [-0.035, -0.285, -0.035], [0.015, 0.04, 0.025]];
  }
  function radiusSDF() {
    return [(x, y, z) => {
      let d = disc(x, y, z, [0.012, -0.011, 0.004], 0.0108, 0.0108, 0.0052, 0.002);
      d = smin(d, chain(x, y, z, [[0.012, -0.018, 0.004, 0.0065], [0.013, -0.055, 0.006, 0.0078], [0.016, -0.2, 0.008, 0.009], [0.015, -0.245, 0.006, 0.012]]), 0.008);
      d = smin(d, ell(x, y, z, [0.015, -0.252, 0.006], [0.016, 0.0095, 0.011]), 0.005);
      d = smin(d, sph(x, y, z, [0.028, -0.262, 0.006], 0.004), 0.004);
      return d;
    }, [-0.01, -0.28, -0.02], [0.05, 0.01, 0.03]];
  }

  // =============================================================== muscles
  // An écorché shell: the body mesh itself, pushed inward by the local
  // thickness of skin and fat, shaded as striated muscle with tendons.
  function muscleAttributes(B, human) {
    const a = human.restAttr.array, nr = human.bodyNrm.array, n = a.length / 3, W = human.subWeights, fit = human.fit;
    const f1 = new Float32Array(n * 4), f2 = new Float32Array(n * 4);
    const D = human.D, cls = B.cls, s = B.s;
    const names = D.bones.map((b) => b.name);
    const isHand = names.map((nm) => /^(finger|metacarpal|wrist)/.test(nm));
    const isFoot = names.map((nm) => /^(toe|foot)/.test(nm));
    const dir = fit.map((f) => new V3(f.tail[0] - f.head[0], f.tail[1] - f.head[1], f.tail[2] - f.head[2]).normalize());
    const shL = B.J('upperarm01.L'), shR = B.J('upperarm01.R');
    const v = new V3(), nn = new V3(), fd = new V3(), tmp = new V3();
    const yNip = B.J('breast.L', 'tail').y, yNav = (B.J('spine03').y + B.J('spine04').y) / 2, yClav = B.J('clavicle.L').y;
    for (let i = 0; i < n; i++) {
      v.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
      nn.set(nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2]);
      fd.set(0, 0, 0);
      for (let k = 0; k < 4; k++) { const w = W.wts[i * 8 + k]; if (w) fd.addScaledVector(dir[W.idx[i * 8 + k]], w * (fd.dot(dir[W.idx[i * 8 + k]]) < 0 ? -1 : 1)); }
      const b0 = W.idx[i * 8], c = cls[i];
      let off = B.fat, tendon = 0;
      if (c === 0 || c === 4) {
        const front = v.z > B.zc[clamp(Math.round(v.y / 0.01), 0, B.NY - 1)];
        // chest: fibres fan toward the shoulder; abdomen: vertical; back: toward the armpit
        if (front && v.y > yNip - 0.06 * s && v.y < yClav && abs(v.x) > 0.02 * s) fd.subVectors(v.x > 0 ? shL : shR, v).normalize();
        else if (!front && v.y > yNav && v.y < yNip && abs(v.x) > 0.06 * s) fd.subVectors(v.x > 0 ? shL : shR, v).normalize();
        else if (front && v.y < yNip - 0.06 * s && abs(v.x) > 0.075 * s) fd.set(-Math.sign(v.x) * 0.6, 0.8, 0.1).normalize();
        if (front && v.y < yNip - 0.03 * s && v.y > yNav - 0.1 * s) { off *= 1 + 0.9 * B.w; tendon = max(tendon, sstep(0.012 * s, 0.004 * s, abs(v.x))); }
        if (!front && v.y < yNav + 0.03 * s && v.y > yNav - 0.12 * s) tendon = max(tendon, 0.75 * sstep(0.09 * s, 0.04 * s, abs(v.x)));
        off += B.bw[i] * (0.012 + 0.05 * (B.h.params?.breastSize ?? 0.5)) * s * sstep(0.0, 0.6, B.bw[i]);
      } else if (c === 1) { off = 0.003 * s; if (v.y > B.J('head').y + 0.09 * s) tendon = 0.85; }
      else if (isHand[b0] || isFoot[b0]) { off = 0.0018 * s; tendon = 0.55; }
      else if (c === 2) off *= 0.6;
      else if (c === 3) off *= 0.85 + 0.3 * (1 - B.g);
      // tendons around joints: wrist, ankle (Achilles), knee, elbow
      const near = (nm, r) => { const j = B.J(nm); return sstep(r, r * 0.4, tmp.subVectors(v, j).length()); };
      for (const S of ['.L', '.R']) {
        tendon = max(tendon, 0.8 * near('wrist' + S, 0.05 * s), 0.85 * near('foot' + S, 0.07 * s), 0.6 * near('lowerleg01' + S, 0.055 * s));
      }
      fd.addScaledVector(nn, -fd.dot(nn));
      if (fd.lengthSq() < 1e-8) fd.set(0, 1, 0);
      fd.normalize();
      f1[i * 4] = fd.x; f1[i * 4 + 1] = fd.y; f1[i * 4 + 2] = fd.z; f1[i * 4 + 3] = tendon;
      f2[i * 4] = min(off, 0.035 * s); f2[i * 4 + 1] = 1; f2[i * 4 + 2] = 0; f2[i * 4 + 3] = 0;
    }
    return { f1, f2 };
  }

  function muscleMaterial() {
    return anatomyMaterial({ color: 0xffffff, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.32, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.9, 0.35, 0.3) }, {
      key: 'muscle', cut: '#7a1d17',
      vertDecl: 'attribute vec4 aMus; attribute vec4 aMus2; varying vec4 vMus; varying vec4 vMus2;',
      vert: 'transformed -= normal * aMus2.x; vMus = aMus; vMus2 = aMus2;',
      fragDecl: `varying vec4 vMus; varying vec4 vMus2;
float mFib, mGroove, mTendon;
void muscleField(vec3 p, vec3 F) {
  float along = dot(p, F);
  vec3 across = p - F * along;
  mFib = aNoise(across * 1400.0 + F * along * 30.0) * 0.6 + aNoise(across * 520.0 + F * along * 12.0) * 0.4;
  vec3 q = across * 26.0 + F * along * 7.0;
  float c = aNoise(q) * 0.65 + aNoise(q * 2.1 + 5.0) * 0.35;
  mGroove = smoothstep(0.08, 0.0, abs(c - 0.5)) * vMus2.y;
  mTendon = clamp(vMus.w + smoothstep(0.55, 0.9, aNoise(p * 9.0 + F * along * 4.0)) * 0.0, 0.0, 1.0);
}`,
      color: `muscleField(vAP, normalize(vMus.xyz + 1e-5));
vec3 mRed = mix(vec3(0.20, 0.025, 0.02), vec3(0.50, 0.075, 0.055), mFib);
mRed *= 1.0 - 0.55 * mGroove;
vec3 mTen = mix(vec3(0.62, 0.58, 0.55), vec3(0.85, 0.83, 0.8), mFib);
diffuseColor.rgb = mix(mRed, mTen, smoothstep(0.35, 0.75, mTendon));`,
      normal: 'normal = aBump(normal, -vViewPosition, -0.0016 * mGroove + 0.00012 * mFib);',
    });
  }

  // =============================================================== module
  const LAYERS = ['skin', 'muscles', 'skeleton', 'organs', 'vessels', 'nerves'];
  const PRESETS = {
    'Skin only': { skin: 'on', muscles: 'off', skeleton: 'off', organs: 'off', vessels: 'off', nerves: 'off' },
    'X-ray skeleton': { skin: 'xray', muscles: 'off', skeleton: 'on', organs: 'off', vessels: 'off', nerves: 'off' },
    Organs: { skin: 'xray', muscles: 'off', skeleton: 'on', organs: 'on', vessels: 'off', nerves: 'off' },
    Muscles: { skin: 'off', muscles: 'on', skeleton: 'off', organs: 'off', vessels: 'off', nerves: 'off' },
    Circulation: { skin: 'xray', muscles: 'off', skeleton: 'on', organs: 'off', vessels: 'on', nerves: 'off' },
    'Nervous system': { skin: 'xray', muscles: 'off', skeleton: 'on', organs: 'off', vessels: 'off', nerves: 'on' },
    Everything: { skin: 'xray', muscles: 'off', skeleton: 'on', organs: 'on', vessels: 'on', nerves: 'on' },
  };

  class Anatomy {
    constructor(app) {
      this.app = app;
      this.human = app.human;
      this.quality = app.quality || 'high';
      this.state = { skin: 'on', muscles: 'off', skeleton: 'off', organs: 'off', vessels: 'off', nerves: 'off' };
      this.presets = PRESETS;
      this.names = [];
      this.ids = {};
      this.built = {};
      this.dirty = {};
      this.objects = {};
      this.proxies = [];
      this.xray = 0;
      this.cutValue = null;
      this.cutAxis = 'z';
      this.plane = new THREE.Plane(new V3(0, 0, -1), 0);
      this.planes = [this.plane];
      this.hi = null;
      this.mats = [];
      this.ray = new THREE.Raycaster();
      this._a = new V3(); this._b = new V3(); this._c = new V3();
      this.hidden = new Map();
      // dev params: ?layers=skeleton,organs,xray&cut=0.5
      const q = app.query;
      if (q && q.get('layers')) {
        const set = {};
        for (const k of q.get('layers').split(',')) {
          if (k === 'xray') set.skin = 'xray';
          else if (k === 'noskin') set.skin = 'off';
          else if (LAYERS.includes(k)) set[k] = 'on';
        }
        this._pending = set;
      }
      if (q && q.get('cutaxis')) this.cutAxis = q.get('cutaxis');
      if (q && q.get('cut') !== null && q.get('cut') !== undefined && q.get('cut') !== '') this.cutValue = clamp(parseFloat(q.get('cut')) || 0, 0, 1);
      this.catalog = Object.keys(FACTS).map((name) => ({ name, system: FACTS[name][0], info: FACTS[name][1] }));
    }

    get layers() { return Object.assign({}, this.state); }

    partId(name, system) {
      if (this.ids[name] === undefined) { this.ids[name] = this.names.length; this.names.push({ name, system }); }
      return this.ids[name];
    }

    setLayers(obj) {
      for (const k in obj) if (LAYERS.includes(k)) this.state[k] = obj[k] === true ? 'on' : obj[k] === false ? 'off' : obj[k];
      this._sync();
      return this.layers;
    }
    setCut(v) { this.cutValue = v === null || v === undefined ? null : clamp(+v, 0, 1); this._applyClip(); }
    setCutAxis(a) { if (a === 'x' || a === 'y' || a === 'z') this.cutAxis = a; this._applyClip(); }

    onParams(p) {
      this.params = p;
      this.body = null;
      for (const k of ['muscles', 'skeleton', 'organs', 'vessels', 'nerves']) this.dirty[k] = true;
      if (this._pending) { Object.assign(this.state, this._pending); this._pending = null; }
      this._sync();
    }

    _body() {
      if (!this.body) {
        this.body = new Body(this.human, this.params || this.app.params);
        this.body.headInfo = this._headInfo(this.body);
      }
      return this.body;
    }

    // head landmarks from the skin: crown, back, sides, teeth and chin
    _headInfo(B) {
      const h = this.human, a = h.restAttr.array, n = a.length / 3, cls = B.cls, D = h.D;
      const ears = h.bodyGeo.attributes.region.array;
      const eye = B.J('eye.L').add(B.J('eye.R')).multiplyScalar(0.5);
      let top = new V3(0, -1, 0), back = new V3(0, 0, 9), chin = new V3(0, 9, 0), wl = 0;
      for (let i = 0; i < n; i++) {
        if (cls[i] !== 1 || ears[i * 4 + 3] > 0.1) continue;
        const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
        if (y > top.y) top.set(x, y, z);
        if (z < back.z && y > eye.y - 0.04) back.set(x, y, z);
        if (y < chin.y && z > eye.z - 0.04 && abs(x) < 0.01) chin.set(x, y, z);
        if (abs(y - eye.y - 0.03 * B.s) < 0.006 && abs(x) > wl) wl = abs(x);
      }
      let tz = -9, ty = -9;
      const fv = D.groups['helper-upper-teeth'].fv, P = h.P;
      for (let k = 0; k < fv.length; k++) { tz = max(tz, P[fv[k] * 3 + 2] * BS.SCALE); ty = max(ty, P[fv[k] * 3 + 1] * BS.SCALE - h.ground); }
      const sc = 0.006 * B.s;
      return {
        vertex: new V3(0, top.y - sc, top.z), occiput: new V3(0, back.y, back.z + sc),
        euryL: new V3(wl - sc * 1.2, eye.y + 0.03 * B.s, eye.z - 0.105 * B.s), euryR: new V3(-wl + sc * 1.2, eye.y + 0.03 * B.s, eye.z - 0.105 * B.s),
        incisor: new V3(0, ty, tz), menton: new V3(0, chin.y + 0.007 * B.s, chin.z - 0.015 * B.s),
      };
    }

    _sync() {
      const st = this.state;
      for (const k of ['muscles', 'skeleton', 'organs', 'vessels', 'nerves']) {
        const on = st[k] === 'on';
        if (on && (this.dirty[k] || !this.built[k])) this._build(k);
        const o = this.objects[k];
        if (o) for (const m of o) m.visible = on;
      }
      this._skin();
      this._applyClip();
    }

    _build(k) {
      const t0 = performance.now();
      this._clear(k);
      const B = this._body(), h = this.human;
      const list = (this.objects[k] = []);
      this.proxies = this.proxies.filter((p) => p.layer !== k);
      if (k === 'skeleton') {
        const { geo, proxies } = buildSkeleton(this, B);
        const mat = this.boneMat || (this.boneMat = this._track(boneMaterial()));
        const mesh = new THREE.SkinnedMesh(geo, mat);
        mesh.name = 'anatomy-skeleton';
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.customDepthMaterial = BS.skinned8(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
        mesh.bind(h.skeleton, new THREE.Matrix4());
        h.group.add(mesh);
        list.push(mesh);
        for (const p of proxies) p.layer = k;
        this.proxies.push(...proxies);
      } else if (k === 'muscles') {
        const { f1, f2 } = muscleAttributes(B, h);
        const geo = h.bodyGeo;
        geo.setAttribute('aMus', new THREE.Float32BufferAttribute(f1, 4));
        geo.setAttribute('aMus2', new THREE.Float32BufferAttribute(f2, 4));
        if (!geo.attributes.aPart) {
          const n = f1.length / 4;
          geo.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(this.partId('Muscles', 'muscles')), 1));
          geo.setAttribute('aExtra', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
        }
        const mat = this.muscleMat || (this.muscleMat = this._track(muscleMaterial()));
        const mesh = new THREE.SkinnedMesh(geo, mat);
        mesh.name = 'anatomy-muscles';
        mesh.frustumCulled = false;
        mesh.bind(h.skeleton, new THREE.Matrix4());
        h.group.add(mesh);
        list.push(mesh);
      }
      this.built[k] = true;
      this.dirty[k] = false;
      this.buildMs = this.buildMs || {};
      this.buildMs[k] = Math.round(performance.now() - t0);
    }

    _track(m) { this.mats.push(m); return m; }

    _clear(k) {
      for (const o of this.objects[k] || []) {
        if (o.parent) o.parent.remove(o);
        if (o.geometry && o.geometry !== this.human.bodyGeo) o.geometry.dispose();
      }
      this.objects[k] = [];
      this.built[k] = false;
    }

    // skin: on, x-ray (ghost shell; clothes fade, hair hides) or off
    _skin() {
      const h = this.human, mode = this.state.skin;
      this.xrayGoal = mode === 'xray' ? 1 : 0;
      h.body.layers.set(mode === 'off' ? HIDDEN : 0);
      const cl = this.app.modules.clothing;
      if (cl && cl.setOpacity) { try { cl.setOpacity(mode === 'on' ? 1 : 0.3); } catch (e) { /* clothing may still be loading */ } }
      this._hair(mode === 'on');
    }
    _hair(show) {
      const hairMod = this.app.modules.hair;
      const roots = [];
      if (hairMod && (hairMod.group || hairMod.root)) roots.push(hairMod.group || hairMod.root);
      else this.human.group.traverse((o) => { if (/hair|brow|beard|lash/i.test(o.name) && o !== this.human.body) roots.push(o); });
      for (const o of roots) {
        if (!show && !this.hidden.has(o)) { this.hidden.set(o, o.visible); o.visible = false; }
        if (show && this.hidden.has(o)) { o.visible = this.hidden.get(o); this.hidden.delete(o); }
      }
    }

    // cut plane through body, clothes and every anatomy layer
    _applyClip() {
      const on = this.cutValue !== null;
      if (on) {
        const h = this.human, r = h.rootOffset, top = this._body().top, v = this.cutValue;
        if (this.cutAxis === 'x') this.plane.set(new V3(-1, 0, 0), r.x + mix(0.36, -0.36, v));
        else if (this.cutAxis === 'y') this.plane.set(new V3(0, -1, 0), mix(top + 0.01, 0, v));
        else this.plane.set(new V3(0, 0, -1), r.z + mix(0.24, -0.2, v));
      }
      const planes = on ? this.planes : null;
      this.human.group.traverse((o) => {
        if (!o.material) return;
        for (const m of [].concat(o.material)) if (m.clippingPlanes !== planes) { m.clippingPlanes = planes; m.clipShadows = false; }
      });
      if (on && this.state.skin === 'on') this._ensureCap(true);
      else this._ensureCap(false);
    }
    // the cut face of the skin: back faces drawn as flat subcutaneous tissue
    _ensureCap(show) {
      const h = this.human;
      if (show && !this.cap) {
        const mat = this._track(BS.skinned8(new THREE.MeshBasicMaterial({ color: 0xd9b48f, side: THREE.BackSide })));
        BS.patch(mat, 'anat-cap', (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb *= 0.92;');
        });
        mat.clippingPlanes = this.planes;
        const cap = (this.cap = new THREE.SkinnedMesh(h.bodyGeo, mat));
        cap.name = 'anatomy-cap';
        cap.frustumCulled = false;
        cap.bind(h.skeleton, new THREE.Matrix4());
        h.group.add(cap);
      }
      if (this.cap) {
        this.cap.visible = show;
        if (this.cap.geometry !== h.bodyGeo) this.cap.geometry = h.bodyGeo;
      }
    }

    update(dt, t) {
      const h = this.human;
      // x-ray fade
      if (abs(this.xray - this.xrayGoal) > 1e-3) {
        this.xray += (this.xrayGoal - this.xray) * (1 - Math.exp(-dt * 6));
        if (abs(this.xray - this.xrayGoal) < 0.01) this.xray = this.xrayGoal;
        if (h.skinUniforms && h.skinUniforms.uXray) h.skinUniforms.uXray.value = this.xray;
        else if (h.skinMat) {
          const m = h.skinMat, tr = this.xray > 0.001;
          if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; }
          m.opacity = 1 - 0.85 * this.xray;
        }
      }
      for (const m of this.mats) if (m.userData.u) { m.userData.u.uTime.value = t; m.userData.u.uHi.value = this.hiId ?? -1; }
      if (this.cutValue !== null && this.cutAxis !== 'y') {
        const r = h.rootOffset, v = this.cutValue;
        this.plane.constant = this.cutAxis === 'x' ? r.x + mix(0.36, -0.36, v) : r.z + mix(0.24, -0.2, v);
      }
    }

    // pick the structure under a pointer (normalized device coords)
    pick(ndcX, ndcY) {
      const h = this.human;
      this.ray.setFromCamera({ x: ndcX, y: ndcY }, this.app.camera);
      const o = this.ray.ray.origin, d = this.ray.ray.direction;
      let best = null, bt = Infinity;
      const a = this._a, b = this._b;
      for (const p of this.proxies) {
        if (this.state[p.layer] !== 'on') continue;
        const M = h.boneMats[p.bone];
        a.copy(p.a).applyMatrix4(M); b.copy(p.b).applyMatrix4(M);
        const t = rayCapsule(o, d, a, b, p.r);
        if (t >= 0 && t < bt) { bt = t; best = p; }
      }
      if (!best && this.state.muscles === 'on' && this.state.skin !== 'on') best = { name: 'Muscles' };
      if (!best) return null;
      const f = FACTS[best.name] || ['', ''];
      return { name: best.name, system: f[0], info: f[1] };
    }
    highlight(name) {
      this.hiName = name || null;
      this.hiId = name && this.ids[name] !== undefined ? this.ids[name] : -1;
    }

    dispose() {
      for (const k of Object.keys(this.objects)) this._clear(k);
      if (this.cap) { this.cap.parent && this.cap.parent.remove(this.cap); this.cap = null; }
      const geo = this.human.bodyGeo;
      for (const k of ['aMus', 'aMus2', 'aPart', 'aExtra']) if (geo.attributes[k]) geo.deleteAttribute(k);
      for (const m of this.mats) m.dispose();
      this.human.group.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) if (m.clippingPlanes) m.clippingPlanes = null; });
      this.human.body.layers.set(0);
      this._hair(true);
      if (this.human.skinUniforms && this.human.skinUniforms.uXray) this.human.skinUniforms.uXray.value = 0;
    }
  }

  function boneMaterial() {
    return anatomyMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.5 }, {
      key: 'bone', cut: '#8a4a3a',
      color: `float bPore = aFbm(vAP * 900.0);
float bTone = aFbm(vAP * 60.0);
diffuseColor.rgb *= mix(0.86, 1.04, bTone) * mix(0.92, 1.0, bPore);`,
      normal: 'normal = aBump(normal, -vViewPosition, 0.00006 * aFbm(vAP * 1500.0) + 0.00012 * bPore);',
    });
  }

  // nearest hit of a ray with a capsule (segment a-b, radius r); -1 if none
  function rayCapsule(o, d, a, b, r) {
    const ba = _rc1.subVectors(b, a), oa = _rc2.subVectors(o, a);
    const baba = ba.dot(ba), bard = ba.dot(d), baoa = ba.dot(oa), rdoa = d.dot(oa), oaoa = oa.dot(oa);
    const A = baba - bard * bard;
    if (A > 1e-12) {
      const Bq = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
      const h = Bq * Bq - A * C;
      if (h >= 0) {
        const t = (-Bq - sqrt(h)) / A, y = baoa + t * bard;
        if (y > 0 && y < baba) return t;
        const oc = y <= 0 ? oa : _rc3.subVectors(o, b);
        const bb = d.dot(oc), c = oc.dot(oc) - r * r, hh = bb * bb - c;
        if (hh > 0) return -bb - sqrt(hh);
      }
      return -1;
    }
    const bb = d.dot(oa), c = oaoa - r * r, hh = bb * bb - c;
    return hh > 0 ? -bb - sqrt(hh) : -1;
  }
  const _rc1 = new V3(), _rc2 = new V3(), _rc3 = new V3();

  BS.Anatomy = Anatomy;
  BS.registerModule({ name: 'anatomy', order: 20, create: (app) => new Anatomy(app) });
})();
