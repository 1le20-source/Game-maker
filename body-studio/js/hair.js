// Body Studio hair: scalp hair, eyebrows, eyelashes, facial hair and fine
// body hair, all made of individual strands.
//
// Every hair is a thin ribbon expanded towards the camera in the vertex
// shader and shaded Kajiya-Kay style (two shifted specular lobes, root
// darkening, lighter tips, per-strand colour jitter, darker deep inside the
// volume). Styles are groomed procedurally on the real scalp: clump centres
// grow from the skin under gravity and the style's flow, kept out of the body
// by a voxel signed-distance field, and thousands of child strands follow
// their clump. Long hair swings: guide strands run a small verlet simulation
// driven by the head bone, and their deviation from the rigid pose reaches
// the GPU through a float texture. Brows, lashes, beards and body hair are
// skinned to the face and body bones so they follow expressions, blinks and
// speech.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const THREE = window.THREE;

  const STYLES = [
    { id: 'bald', label: 'Bald' }, { id: 'buzz', label: 'Buzz cut' }, { id: 'crew', label: 'Side part' },
    { id: 'short', label: 'Short' }, { id: 'medium', label: 'Shaggy' }, { id: 'bob', label: 'Bob' },
    { id: 'long', label: 'Long' }, { id: 'wavy', label: 'Long wavy' }, { id: 'curly', label: 'Curly' },
    { id: 'afro', label: 'Afro' }, { id: 'ponytail', label: 'Ponytail' }, { id: 'bun', label: 'Bun' },
    { id: 'braid', label: 'Braid' },
  ];
  const BEARDS = [
    { id: 'none', label: 'None' }, { id: 'stubble', label: 'Stubble' }, { id: 'short', label: 'Short beard' },
    { id: 'full', label: 'Full beard' }, { id: 'goatee', label: 'Goatee' }, { id: 'mustache', label: 'Mustache' },
  ];
  const BROWS = [
    { id: 'natural', label: 'Natural' }, { id: 'thin', label: 'Thin' }, { id: 'thick', label: 'Thick' },
    { id: 'arched', label: 'Arched' }, { id: 'straight', label: 'Straight' }, { id: 'none', label: 'None' },
  ];
  // strand budget per quality level, relative to 'high'
  const QUALITY = { high: 1, medium: 0.45, low: 0.1 };
  const DYED = { 'Pastel pink': 1, 'Blue': 1, 'Green': 1, 'Violet': 1 };

  // ---------------------------------------------------------------- utils
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // piecewise-linear table lookup, tab = [[x, y], ...] ascending in x
  function table(tab, x) {
    if (x <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) {
      if (x <= tab[i][0]) { const a = tab[i - 1], b = tab[i]; return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]); }
    }
    return tab[tab.length - 1][1];
  }
  const V = () => new THREE.Vector3();

  // ------------------------------------------------- signed distance field
  // Distance to the rest-pose body surface on a voxel grid (negative
  // inside). Grooming pushes every strand point out to a chosen offset, so
  // hair never sinks into the skin, eyes, ears, neck or shoulders.
  class BodySDF {
    constructor(pos, tris, lo, hi, h) {
      const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
      const nxy = nx * ny, N = nxy * nz;
      Object.assign(this, { lo, h, nx, ny, nz, nxy });
      const surf = new Uint8Array(N);
      const ih = 1 / h, m0 = lo[0] - h, m1 = lo[1] - h, m2 = lo[2] - h, M0 = hi[0] + h, M1 = hi[1] + h, M2 = hi[2] + h;
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
        const ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[b], by = pos[b + 1], bz = pos[b + 2], cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
        if ((ax < m0 && bx < m0 && cx < m0) || (ax > M0 && bx > M0 && cx > M0) || (ay < m1 && by < m1 && cy < m1) ||
          (ay > M1 && by > M1 && cy > M1) || (az < m2 && bz < m2 && cz < m2) || (az > M2 && bz > M2 && cz > M2)) continue;
        const e2 = Math.max((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2, (cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2, (ax - cx) ** 2 + (ay - cy) ** 2 + (az - cz) ** 2);
        const m = Math.max(1, Math.ceil(Math.sqrt(e2) / (h * 0.6)));
        for (let i = 0; i <= m; i++) for (let j = 0; j <= m - i; j++) {
          const u = i / m, v = j / m, w = 1 - u - v;
          const gx = Math.round((ax * w + bx * u + cx * v - lo[0]) * ih), gy = Math.round((ay * w + by * u + cy * v - lo[1]) * ih), gz = Math.round((az * w + bz * u + cz * v - lo[2]) * ih);
          if (gx >= 0 && gy >= 0 && gz >= 0 && gx < nx && gy < ny && gz < nz) surf[gx + gy * nx + gz * nxy] = 1;
        }
      }
      // dilate once so the flood fill can't leak in through the eye openings
      const dil = surf.slice();
      for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1, i = 1 + y * nx + z * nxy; x < nx - 1; x++, i++) {
        if (surf[i]) dil[i - 1] = dil[i + 1] = dil[i - nx] = dil[i + nx] = dil[i - nxy] = dil[i + nxy] = 1;
      }
      // flood the outside from the top face (above the head is always air;
      // other faces may cut through the neck, torso or arms)
      const out = new Uint8Array(N), q = new Int32Array(N);
      let qh = 0, qt = 0;
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
        const i = x + (ny - 1) * nx + z * nxy;
        if (!dil[i]) { out[i] = 1; q[qt++] = i; }
      }
      while (qh < qt) {
        const i = q[qh++], x = i % nx, y = ((i / nx) | 0) % ny, z = (i / nxy) | 0;
        let j;
        if (x > 0 && !dil[(j = i - 1)] && !out[j]) { out[j] = 1; q[qt++] = j; }
        if (x < nx - 1 && !dil[(j = i + 1)] && !out[j]) { out[j] = 1; q[qt++] = j; }
        if (y > 0 && !dil[(j = i - nx)] && !out[j]) { out[j] = 1; q[qt++] = j; }
        if (y < ny - 1 && !dil[(j = i + nx)] && !out[j]) { out[j] = 1; q[qt++] = j; }
        if (z > 0 && !dil[(j = i - nxy)] && !out[j]) { out[j] = 1; q[qt++] = j; }
        if (z < nz - 1 && !dil[(j = i + nxy)] && !out[j]) { out[j] = 1; q[qt++] = j; }
      }
      // undo the dilation wherever it touches the outside
      qt = 0;
      for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1, i = 1 + y * nx + z * nxy; x < nx - 1; x++, i++) {
        if (dil[i] && !surf[i] && (out[i - 1] || out[i + 1] || out[i - nx] || out[i + nx] || out[i - nxy] || out[i + nxy])) q[qt++] = i;
      }
      for (let k = 0; k < qt; k++) out[q[k]] = 1;
      // chamfer distances to the other side, both directions at once
      const dO = new Float32Array(N), dI = new Float32Array(N);
      for (let i = 0; i < N; i++) { dO[i] = out[i] ? 64 : 0; dI[i] = out[i] ? 0 : 8; }
      chamfer2(dO, dI, nx, ny, nz);
      const d = (this.d = new Float32Array(N));
      for (let i = 0; i < N; i++) d[i] = out[i] ? (dO[i] - 0.5) * h : -(dI[i] - 0.5) * h;
    }
    // trilinear distance; writes the outward gradient into g when given.
    // Outside the box the field reports "far away".
    dist(x, y, z, g) {
      const fx = (x - this.lo[0]) / this.h, fy = (y - this.lo[1]) / this.h, fz = (z - this.lo[2]) / this.h;
      if (!(fx >= 0 && fy >= 0 && fz >= 0 && fx < this.nx - 1 && fy < this.ny - 1 && fz < this.nz - 1)) { if (g) g.set(0, 0, 0); return 1; }
      const ix = fx | 0, iy = fy | 0, iz = fz | 0, tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const nx = this.nx, nxy = this.nxy, d = this.d, i = ix + iy * nx + iz * nxy;
      const c000 = d[i], c100 = d[i + 1], c010 = d[i + nx], c110 = d[i + 1 + nx];
      const c001 = d[i + nxy], c101 = d[i + 1 + nxy], c011 = d[i + nx + nxy], c111 = d[i + 1 + nx + nxy];
      const c00 = c000 + (c100 - c000) * tx, c10 = c010 + (c110 - c010) * tx, c01 = c001 + (c101 - c001) * tx, c11 = c011 + (c111 - c011) * tx;
      const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
      if (g) {
        const gx = ((c100 - c000) * (1 - ty) + (c110 - c010) * ty) * (1 - tz) + ((c101 - c001) * (1 - ty) + (c111 - c011) * ty) * tz;
        const gy = (c10 - c00) * (1 - tz) + (c11 - c01) * tz, gz = c1 - c0;
        const l = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (l > 1e-9) g.set(gx / l, gy / l, gz / l); else g.set(0, 0, 0);
      }
      return c0 + (c1 - c0) * tz;
    }
  }
  // the fine head field first, then the coarser body field
  class Field {
    constructor(list) { this.list = list; }
    dist(x, y, z, g) {
      for (const f of this.list) { const d = f.dist(x, y, z, g); if (d !== 1) return d; }
      return 1;
    }
    // push p out to at least `off` from the skin; returns the distance
    push(p, off) {
      for (let it = 0; it < 3; it++) {
        const d = this.dist(p.x, p.y, p.z, _g);
        if (d >= off) return d;
        p.addScaledVector(_g, off - d);
      }
      return off;
    }
  }
  const _g = V();
  // two-pass 3x3x3 chamfer distance (in voxels) for two fields at once
  function chamfer2(a, b, nx, ny, nz) {
    const nxy = nx * ny, offs = new Int32Array(13), wts = new Float32Array(13);
    let K = 0;
    for (let dz = -1; dz <= 0; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dz === 0 && (dy > 0 || (dy === 0 && dx >= 0))) continue;
      offs[K] = dx + dy * nx + dz * nxy;
      wts[K++] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1, i = 1 + y * nx + z * nxy; x < nx - 1; x++, i++) {
      let ma = a[i], mb = b[i];
      for (let k = 0; k < 13; k++) {
        const j = i + offs[k], w = wts[k];
        const ca = a[j] + w, cb = b[j] + w;
        if (ca < ma) ma = ca;
        if (cb < mb) mb = cb;
      }
      a[i] = ma; b[i] = mb;
    }
    for (let z = nz - 2; z >= 1; z--) for (let y = ny - 2; y >= 1; y--) for (let x = nx - 2, i = x + y * nx + z * nxy; x >= 1; x--, i--) {
      let ma = a[i], mb = b[i];
      for (let k = 0; k < 13; k++) {
        const j = i - offs[k], w = wts[k];
        const ca = a[j] + w, cb = b[j] + w;
        if (ca < ma) ma = ca;
        if (cb < mb) mb = cb;
      }
      a[i] = ma; b[i] = mb;
    }
  }


  // --------------------------------------------------------- head frame
  // Landmarks measured on the rest mesh: the cranium as an ellipsoid (centre
  // C, radii R), eyes, ears, mouth, chin and shoulders.
  function headFrame(human) {
    const a = human.restAttr.array, n = human.S.nOut, M = human.masks;
    const eL = human.joint('eye.L'), eR = human.joint('eye.R');
    const E = new THREE.Vector3((eL.x + eR.x) / 2, (eL.y + eR.y) / 2, (eL.z + eR.z) / 2);
    let top = -1e9;
    for (let i = 0; i < n; i++) { const y = a[i * 3 + 1]; if (y > top && Math.abs(a[i * 3]) < 0.04 && y > E.y) top = y; }
    const cy = E.y + 0.19 * (top - E.y);
    let back = 1e9, front = -1e9;
    const ear = [V(), V()], ec = [0, 0], lip = V();
    let lc = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      if (M[i * 8 + 3] > 0.5) { const s = x > 0 ? 0 : 1; ear[s].x += x; ear[s].y += y; ear[s].z += z; ec[s]++; continue; }
      if (M[i * 8] > 0.5) { lip.x += x; lip.y += y; lip.z += z; lc++; }
      if (Math.abs(y - cy) < 0.012) {
        if (Math.abs(x) < 0.03 && z < back) back = z;
        if (Math.abs(x) < 0.008 && z > front) front = z;
      }
    }
    let wid = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      if (M[i * 8 + 3] > 0.05 || y < cy - 0.02 || y > cy + 0.015 || z > E.z - 0.03 || z < back - 0.01) continue;
      wid = Math.max(wid, Math.abs(x));
    }
    ear[0].multiplyScalar(1 / Math.max(1, ec[0]));
    ear[1].multiplyScalar(1 / Math.max(1, ec[1]));
    lip.multiplyScalar(1 / Math.max(1, lc));
    const C = new THREE.Vector3(0, cy, (front + back) / 2), R = new THREE.Vector3(wid, top - cy, (front - back) / 2);
    const chin = human.joint('jaw', 'tail');
    const sh = human.joint('clavicle.L', 'tail');
    return { E, C, R, top, back, front, earL: ear[0], earR: ear[1], lip, chin, shoulderY: sh.y, shoulderX: sh.x, eyeL: eL, eyeR: eR };
  }

  // ---------------------------------------------------------- sampling
  // area-weighted random points on the rest body, density ∝ mask (one value
  // per smoothed vertex). Also returns each point's nearest vertex.
  function sampleSurface(human, mask, count, rand) {
    const a = human.restAttr.array, nr = human.bodyNrm.array, tris = human.S.tris;
    const list = [], cdf = [];
    let acc = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
      const m = (mask[i0] + mask[i1] + mask[i2]) / 3;
      if (!(m > 0.002)) continue;
      const ux = a[i1 * 3] - a[i0 * 3], uy = a[i1 * 3 + 1] - a[i0 * 3 + 1], uz = a[i1 * 3 + 2] - a[i0 * 3 + 2];
      const vx = a[i2 * 3] - a[i0 * 3], vy = a[i2 * 3 + 1] - a[i0 * 3 + 1], vz = a[i2 * 3 + 2] - a[i0 * 3 + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      acc += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz) * m;
      list.push(t);
      cdf.push(acc);
    }
    if (!acc || !count) return null;
    const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), vtx = new Int32Array(count), m = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = ((i + rand()) / count) * acc;
      let lo = 0, hi = cdf.length - 1;
      while (lo < hi) { const md = (lo + hi) >> 1; if (cdf[md] < r) lo = md + 1; else hi = md; }
      const t = list[lo], i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
      let u = rand(), v = rand();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;
      let nx = 0, ny = 0, nz = 0;
      for (let c = 0; c < 3; c++) {
        pos[i * 3 + c] = a[i0 * 3 + c] * w + a[i1 * 3 + c] * u + a[i2 * 3 + c] * v;
        const nn = nr[i0 * 3 + c] * w + nr[i1 * 3 + c] * u + nr[i2 * 3 + c] * v;
        if (c === 0) nx = nn; else if (c === 1) ny = nn; else nz = nn;
      }
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
      vtx[i] = w >= u && w >= v ? i0 : u >= v ? i1 : i2;
      m[i] = mask[i0] * w + mask[i1] * u + mask[i2] * v;
    }
    // shuffle so any prefix still covers the whole region
    for (let i = count - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      for (let c = 0; c < 3; c++) {
        let tmp = pos[i * 3 + c]; pos[i * 3 + c] = pos[j * 3 + c]; pos[j * 3 + c] = tmp;
        tmp = nrm[i * 3 + c]; nrm[i * 3 + c] = nrm[j * 3 + c]; nrm[j * 3 + c] = tmp;
      }
      let tv = vtx[i]; vtx[i] = vtx[j]; vtx[j] = tv;
      tv = m[i]; m[i] = m[j]; m[j] = tv;
    }
    return { pos, nrm, vtx, m, count };
  }

  // tiny spatial hash for nearest-root queries
  class Hash {
    constructor(pos, n, cell) {
      this.cell = cell; this.map = new Map(); this.pos = pos;
      for (let i = 0; i < n; i++) {
        const k = this.key(Math.floor(pos[i * 3] / cell), Math.floor(pos[i * 3 + 1] / cell), Math.floor(pos[i * 3 + 2] / cell));
        let b = this.map.get(k);
        if (!b) this.map.set(k, (b = []));
        b.push(i);
      }
    }
    key(x, y, z) { return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); }
    // nearest index accepted by ok(i), searching a growing neighbourhood
    nearest(x, y, z, ok) {
      const c = this.cell, cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c), P = this.pos;
      let best = -1, bd = Infinity;
      for (let r = 1; r <= 4 && best < 0; r++) {
        for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
          const b = this.map.get(this.key(cx + dx, cy + dy, cz + dz));
          if (!b) continue;
          for (const i of b) {
            if (ok && !ok(i)) continue;
            const d = (P[i * 3] - x) ** 2 + (P[i * 3 + 1] - y) ** 2 + (P[i * 3 + 2] - z) ** 2;
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      return best;
    }
  }

  // ------------------------------------------------------------ batches
  // A set of strands with `np` points each, kept as centre lines and turned
  // into two-sided ribbons (2 vertices per point) for the GPU.
  class Batch {
    constructor(ns, np, opts = {}) {
      this.ns = ns; this.np = np; this.n = 0; this.opts = opts;
      const N = ns * np;
      this.P = new Float32Array(N * 3); // rest centre line
      this.N = new Float32Array(N * 3); // outward "volume" normal
      this.O = new Float32Array(N); // 0 deep inside the hair .. 1 outer surface
      this.U = new Float32Array(N); // 0 root .. 1 tip
      this.R = new Float32Array(ns * 2); // per strand: random, width scale
      if (opts.dev) { this.DU = new Float32Array(N); this.G = new Uint16Array(ns * 3); this.GW = new Float32Array(ns * 3); }
      if (opts.skin) { this.SI = new Uint8Array(ns * 4); this.SW = new Float32Array(ns * 4); }
    }
    geometry() {
      const { n, np } = this, nv = n * np * 2;
      const pos = new Float32Array(nv * 3), tan = new Int8Array(nv * 4), nrm = new Int8Array(nv * 4), uu = new Uint16Array(nv * 4);
      const P = this.P;
      let gi, gw, si, sw;
      if (this.opts.dev) { gi = new Uint16Array(nv * 4); gw = new Uint8Array(nv * 4); }
      if (this.opts.skin) { si = new Uint8Array(nv * 4); sw = new Uint8Array(nv * 4); }
      for (let s = 0; s < n; s++) {
        for (let k = 0; k < np; k++) {
          const i = s * np + k, a = k > 0 ? i - 1 : i, b = k < np - 1 ? i + 1 : i;
          let tx = P[b * 3] - P[a * 3], ty = P[b * 3 + 1] - P[a * 3 + 1], tz = P[b * 3 + 2] - P[a * 3 + 2];
          const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
          tx /= tl; ty /= tl; tz /= tl;
          for (let side = 0; side < 2; side++) {
            const v = i * 2 + side;
            pos[v * 3] = P[i * 3]; pos[v * 3 + 1] = P[i * 3 + 1]; pos[v * 3 + 2] = P[i * 3 + 2];
            tan[v * 4] = tx * 127; tan[v * 4 + 1] = ty * 127; tan[v * 4 + 2] = tz * 127; tan[v * 4 + 3] = side ? 127 : -127;
            nrm[v * 4] = this.N[i * 3] * 127; nrm[v * 4 + 1] = this.N[i * 3 + 1] * 127; nrm[v * 4 + 2] = this.N[i * 3 + 2] * 127;
            nrm[v * 4 + 3] = clamp(this.O[i], 0, 1) * 127;
            uu[v * 4] = clamp(this.U[i], 0, 1) * 65535;
            uu[v * 4 + 1] = this.R[s * 2] * 65535;
            uu[v * 4 + 2] = this.DU ? clamp(this.DU[i], 0, 1) * 65535 : 0;
            uu[v * 4 + 3] = clamp(this.R[s * 2 + 1] * 0.5, 0, 1) * 65535;
            if (gi) for (let c = 0; c < 3; c++) { gi[v * 4 + c] = this.G[s * 3 + c]; gw[v * 4 + c] = Math.round(this.GW[s * 3 + c] * 255); }
            if (si) for (let c = 0; c < 4; c++) { si[v * 4 + c] = this.SI[s * 4 + c]; sw[v * 4 + c] = Math.round(this.SW[s * 4 + c] * 255); }
          }
        }
      }
      const idx = new Uint32Array(n * (np - 1) * 6);
      let q = 0;
      for (let s = 0; s < n; s++) for (let k = 0; k < np - 1; k++) {
        const a = (s * np + k) * 2;
        idx[q++] = a; idx[q++] = a + 1; idx[q++] = a + 2;
        idx[q++] = a + 2; idx[q++] = a + 1; idx[q++] = a + 3;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aTan', new THREE.BufferAttribute(tan, 4, true));
      geo.setAttribute('aNrm', new THREE.BufferAttribute(nrm, 4, true));
      geo.setAttribute('aU', new THREE.BufferAttribute(uu, 4, true));
      if (gi) { geo.setAttribute('aGuide', new THREE.BufferAttribute(gi, 4)); geo.setAttribute('aGW', new THREE.BufferAttribute(gw, 4, true)); }
      if (si) { geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, true)); }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2);
      return geo;
    }
  }

  // 4 strongest bones of smoothed-body vertex v (for skinned strands)
  function vertexBones(human, v, si, sw, o) {
    const idx = human.subWeights.idx, wts = human.subWeights.wts;
    let tot = 0;
    for (let k = 0; k < 4; k++) { si[o + k] = idx[v * 8 + k]; sw[o + k] = wts[v * 8 + k]; tot += wts[v * 8 + k]; }
    for (let k = 0; k < 4; k++) sw[o + k] /= tot || 1;
  }
  function baseBones(D, v, si, sw, o) {
    const pairs = [];
    for (let k = 0; k < 8; k++) if (D.skinW[v * 8 + k]) pairs.push([D.skinIdx[v * 8 + k], D.skinW[v * 8 + k]]);
    pairs.sort((x, y) => y[1] - x[1]);
    let tot = 0;
    for (let k = 0; k < 4; k++) { const p = pairs[k]; si[o + k] = p ? p[0] : 0; sw[o + k] = p ? p[1] : 0; tot += sw[o + k]; }
    for (let k = 0; k < 4; k++) sw[o + k] /= tot || 1;
  }

  // ------------------------------------------------------------- shaders
  const VERT = `
uniform mat4 uHead;
uniform vec2 uRes;
uniform float uWidth;
uniform float uMinPx;
attribute vec4 aTan;
attribute vec4 aNrm;
attribute vec4 aU;
#ifdef USE_DEV
uniform sampler2D uDev;
uniform vec2 uDevSize;
attribute vec4 aGuide;
attribute vec4 aGW;
vec4 devTexel(float g, float k) { return texture2D(uDev, vec2((k + 0.5) / uDevSize.x, (g + 0.5) / uDevSize.y)); }
#endif
varying vec3 vT;
varying vec3 vN;
varying vec3 vV;
varying vec4 vI;
varying float vA;
#include <skinning_pars_vertex>
void main() {
  vec3 transformed = position;
  vec3 objectNormal = aTan.xyz;
  vec3 outN = aNrm.xyz;
#ifdef USE_SKINNING
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  outN = (skinMatrix * vec4(outN, 0.0)).xyz;
#else
  transformed = (uHead * vec4(position, 1.0)).xyz;
  objectNormal = mat3(uHead) * objectNormal;
  outN = mat3(uHead) * outN;
#endif
#ifdef USE_DEV
  {
    float x = aU.z * (uDevSize.x - 1.0);
    float k = min(floor(x), uDevSize.x - 2.0), f = x - k;
    vec4 a0 = devTexel(aGuide.x, k), b0 = devTexel(aGuide.x, k + 1.0);
    vec4 a1 = devTexel(aGuide.y, k), b1 = devTexel(aGuide.y, k + 1.0);
    vec4 a2 = devTexel(aGuide.z, k), b2 = devTexel(aGuide.z, k + 1.0);
    transformed += aGW.x * mix(a0.xyz, b0.xyz, f) + aGW.y * mix(a1.xyz, b1.xyz, f) + aGW.z * mix(a2.xyz, b2.xyz, f);
    objectNormal = normalize(objectNormal + (b0.xyz - a0.xyz) / max(a0.w, 1e-4));
  }
#endif
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vec3 T = normalize(mat3(modelViewMatrix) * objectNormal);
  vec3 Vd = normalize(-mv.xyz);
  vec3 side = cross(T, Vd);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
  float u = aU.x;
  float w = uWidth * aU.w * 2.0 * (1.0 - 0.8 * smoothstep(0.6, 1.0, u));
  float px = 2.0 * -mv.z / (projectionMatrix[1][1] * uRes.y);
  float wd = max(w, px * uMinPx);
  vA = clamp(sqrt(w / wd) * 1.4, 0.0, 1.0);
  mv.xyz += side * (aTan.w * 0.5 * wd);
  gl_Position = projectionMatrix * mv;
  vT = T;
  vN = normalize(mat3(modelViewMatrix) * outN);
  vV = Vd;
  vI = vec4(u, aU.y, aNrm.w, 0.0);
}`;

  const FRAG = `
#include <common>
#include <lights_pars_begin>
uniform vec3 uColor;
uniform vec3 uTip;
uniform vec3 uGreyCol;
uniform float uGrey;
uniform float uRootDark;
uniform float uJitter;
uniform vec3 uSpec;
uniform vec2 uShift;
uniform vec2 uExp;
uniform float uAmbient;
uniform float uAlpha;
varying vec3 vT;
varying vec3 vN;
varying vec3 vV;
varying vec4 vI;
varying float vA;
void main() {
  vec3 T = normalize(vT), V = normalize(vV);
  vec3 N = vN - T * dot(vN, T);
  N = length(N) > 1e-4 ? normalize(N) : V;
  float u = vI.x, r = vI.y, occ = vI.z;
  vec3 base = uColor * (1.0 + (r - 0.5) * uJitter);
  base *= mix(uRootDark, 1.0, smoothstep(0.0, 0.3, u));
  base = mix(base, uTip, smoothstep(0.45, 1.0, u));
  float g = step(fract(r * 13.731 + 0.17), uGrey);
  base = mix(base, uGreyCol * (0.8 + 0.4 * fract(r * 7.31)), g);
  float shade = mix(0.28, 1.0, occ);
  float glint = 0.6 + 0.8 * fract(r * 3.97);
  vec3 col = vec3(0.0);
#if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    vec3 L = directionalLights[i].direction;
    vec3 lc = directionalLights[i].color;
    float nl = dot(N, L);
    float vis = smoothstep(-0.45, 0.55, nl) * shade;
    float tl = dot(T, L);
    float kd = sqrt(max(0.0, 1.0 - tl * tl));
    col += lc * base * (0.55 * kd + 0.45 * max(nl, 0.0)) * vis * 0.3;
    vec3 H = normalize(L + V);
    float t1 = dot(normalize(T + N * uShift.x), H);
    float t2 = dot(normalize(T + N * uShift.y), H);
    float s1 = pow(max(0.0, 1.0 - t1 * t1), uExp.x) * smoothstep(-1.0, 0.0, t1);
    float s2 = pow(max(0.0, 1.0 - t2 * t2), uExp.y) * smoothstep(-1.0, 0.0, t2);
    col += lc * vis * (uSpec.x * s1 + uSpec.y * s2 * glint * base / max(max(base.r, base.g), max(base.b, 0.02)) * (0.3 + base));
  }
#endif
  vec3 amb = ambientLightColor;
#if NUM_HEMI_LIGHTS > 0
  for (int i = 0; i < NUM_HEMI_LIGHTS; i++) amb += getHemisphereLightIrradiance(hemisphereLights[i], N);
#endif
  col += base * (amb * 0.36 + uAmbient) * shade;
  gl_FragColor = vec4(col, vA * uAlpha * (1.0 - 0.7 * smoothstep(0.8, 1.0, u)));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

  function strandMaterial(defines) {
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {
      uHead: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1200, 900) }, uWidth: { value: 0.00008 }, uMinPx: { value: 1.0 },
      uColor: { value: new THREE.Color(0.1, 0.06, 0.04) }, uTip: { value: new THREE.Color(0.14, 0.09, 0.06) }, uGreyCol: { value: new THREE.Color(0.6, 0.6, 0.58) },
      uGrey: { value: 0 }, uRootDark: { value: 0.75 }, uJitter: { value: 0.35 }, uSpec: { value: new THREE.Vector2(0.14, 0.3) },
      uShift: { value: new THREE.Vector2(-0.12, 0.1) }, uExp: { value: new THREE.Vector2(120, 28) }, uAmbient: { value: 0.12 }, uAlpha: { value: 1 },
      uDevSize: { value: new THREE.Vector2(1, 1) },
    }]);
    uniforms.uDev = { value: null };
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, lights: true, defines: defines || {}, side: THREE.DoubleSide });
    mat.alphaToCoverage = true;
    return mat;
  }

  // ------------------------------------------------------------- colours
  const lin = (hex) => new THREE.Color(hex);
  function hairColors(p) {
    const hex = p.hairColorHex || BS.HAIR_COLORS[p.hairColor] || '#2f1f15';
    const c = lin(hex);
    const hsl = {};
    c.getHSL(hsl);
    const tip = new THREE.Color().setHSL(hsl.h, hsl.s * 0.9, Math.min(0.92, hsl.l * 1.25 + 0.03));
    // brows and lashes keep a natural shade when the hair is dyed or grey
    const natural = !p.hairColorHex && (DYED[p.hairColor] || p.hairColor === 'Platinum') ? lin('#3a2a1e') : c.clone();
    const browHex = p.hairColor === 'White' || p.hairColor === 'Grey' ? '#8d8984' : null;
    const brow = browHex ? lin(browHex) : natural.clone().multiplyScalar(0.8);
    return { base: c, tip, brow, lash: natural.clone().multiplyScalar(0.25).lerp(lin('#0d0907'), 0.78) };
  }
  // fraction of grey strands for an age (on top of the chosen colour)
  const greyAt = (age, from) => clamp((age - from) / 38, 0, 1) ** 1.3 * 0.9;

  // ------------------------------------------------------------- groom
  // q-space: positions relative to the cranium ellipsoid (unit sphere)
  function qOf(F, x, y, z, out) { return out.set((x - F.C.x) / F.R.x, (y - F.C.y) / F.R.y, (z - F.C.z) / F.R.z); }

  // scalp density 0..1 at a rest position: natural hairline with temples,
  // sideburns, the margin around the ears and the nape
  function scalpMask(F, x, y, z, ear, recede) {
    const qx = (x - F.C.x) / F.R.x, qy = (y - F.C.y) / F.R.y, qz = (z - F.C.z) / F.R.z;
    const az = (Math.atan2(Math.abs(qx), qz) * 180) / Math.PI;
    const r = recede || 0;
    const line = table([[0, 0.5 + 0.12 * r], [20, 0.49 + 0.18 * r], [33, 0.44 + 0.32 * r], [45, 0.34 + 0.3 * r], [55, 0.2 + 0.2 * r], [62, 0.0 + 0.1 * r], [67, -0.35],
      [71, -0.52], [79, -0.52], [82, -0.08], [102, -0.08], [108, -0.5], [117, -0.95], [132, -1.15], [180, -1.28]], az);
    const wob = 0.025 * Math.sin(az * 0.31) + 0.015 * Math.sin(az * 0.97 + 1.3);
    let m = smooth(line - 0.02, line + 0.09, qy + wob);
    m *= 1 - smooth(0.02, 0.25, ear);
    // nothing on the face side of the temples or below the jaw line
    if (qy < -1.6) m = 0;
    return m;
  }

  function tangentOf(nx, ny, nz, dx, dy, dz, out) {
    const d = dx * nx + dy * ny + dz * nz;
    out.set(dx - nx * d, dy - ny * d, dz - nz * d);
    const l = out.length();
    return l > 1e-6 ? out.multiplyScalar(1 / l) : out.set(0, -1, 0);
  }

  // style recipes. Lengths in metres, scaled by hairLength around 0.5
  function recipe(style, p, F) {
    const Ls = 0.55 + 0.9 * clamp(p.hairLength ?? 0.5, 0, 1);
    const vol = 0.5 + clamp(p.hairVolume ?? 0.5, 0, 1);
    const curl = clamp(p.curl ?? 0.15, 0, 1);
    const S = F.R.y / 0.088; // head size
    const base = { n: 16000, segs: 12, lift: 0.3, grav: 0, shell: 0.006 * vol, rise: 0.25, clump: 0.35, clumpN: 26, frizz: 0.15, part: null, width: 1, hug: 1, reach: 'head', cap: 0.85,
      wave: curl > 0.25 ? { amp: 0.004 * curl * vol, wl: 0.07 - 0.03 * curl, ell: 0.4 } : null, physics: 0, len: () => 0.1, cut: null, flow: 'part' };
    switch (style) {
      case 'buzz': return Object.assign(base, { n: 42000, segs: 2, lift: 0.55, shell: 0.0015, rise: 1, clump: 0, frizz: 0.3, width: 0.9, wave: null, flow: 'back',
        len: () => (0.0045 + 0.004 * clamp(p.hairLength ?? 0.5, 0, 1)) * S });
      case 'crew': return Object.assign(base, { n: 30000, segs: 6, lift: 0.22, grav: 3, shell: 0.006 * vol, part: 0.42, clump: 0.3, flow: 'part',
        len: (q) => mix(0.016, 0.06, smooth(-0.15, 0.55, q.y)) * Ls * S });
      case 'short': return Object.assign(base, { n: 30000, segs: 6, lift: 0.32, grav: 4, shell: 0.008 * vol, clump: 0.5, frizz: 0.35, flow: 'messy',
        len: (q) => mix(0.018, 0.065, smooth(-0.2, 0.55, q.y)) * Ls * S });
      case 'medium': return Object.assign(base, { reach: 'body', n: 20000, segs: 12, lift: 0.22, grav: 16, shell: 0.009 * vol, part: 0.22, clump: 0.55, frizz: 0.3, flow: 'fringe', physics: 0.6,
        len: (q) => mix(0.11, 0.16, smooth(-0.5, 0.5, q.y)) * Ls * S, cut: 'fringe' });
      case 'bob': return Object.assign(base, { reach: 'body', n: 20000, segs: 14, lift: 0.18, grav: 22, shell: 0.008 * vol, part: 0.28, clump: 0.4, flow: 'part', physics: 0.5, bobCurl: true,
        drop: (clamp(p.hairLength ?? 0.5, 0, 1) - 0.5) * 0.09, len: () => 0.3 * S, cut: 'bob' });
      case 'long': return Object.assign(base, { reach: 'body', n: 17000, segs: 22, lift: 0.15, grav: 26, shell: 0.008 * vol, part: 0.04, clump: 0.5, flow: 'part', physics: 1,
        len: (q) => (0.42 + 0.06 * (1 - Math.abs(q.x))) * Ls * S });
      case 'wavy': return Object.assign(base, { reach: 'body', n: 15000, segs: 30, lift: 0.2, grav: 22, shell: 0.011 * vol, part: 0.1, clump: 0.6, flow: 'part', physics: 1,
        wave: { amp: (0.01 + 0.008 * curl) * vol, wl: 0.085 - 0.03 * curl, ell: 0.45 }, len: (q) => (0.4 + 0.05 * (1 - Math.abs(q.x))) * Ls * S });
      case 'curly': return Object.assign(base, { reach: 'body', n: 12000, segs: 34, lift: 0.4, grav: 10, shell: 0.02 * vol, part: 0.1, clump: 0.75, clumpN: 30, frizz: 0.5, flow: 'part', physics: 0.6,
        wave: { amp: (0.006 + 0.004 * curl) * vol, wl: 0.032 - 0.012 * curl, ell: 1 }, len: (q) => mix(0.17, 0.22, smooth(-0.5, 0.6, q.y)) * Ls * S });
      case 'afro': return Object.assign(base, { n: 22000, segs: 12, lift: 0.9, grav: 0.4, shell: 0.004, clump: 0.25, clumpN: 12, frizz: 1.6, flow: 'radial', wave: null, kink: 0.9, hug: 0,
        afro: (0.05 + 0.05 * clamp(p.hairLength ?? 0.5, 0, 1)) * vol * S, len: () => 0.16 * vol * S, cut: 'afro' });
      // gathered styles: strands slide over the scalp to a tie, then form a
      // tail, a coiled bun or a three-strand braid
      case 'ponytail': return Object.assign(base, { reach: 'body', n: 16000, segs: 28, lift: 0, shell: 0.003, clump: 0.88, clumpN: 30, frizz: 0.06, cap: 0.95, wave: null,
        gather: { kind: 'tail', tie: tieAt(F, 0.2, 0.012), r: 0.019 * vol * S, tail: (0.2 + 0.28 * clamp(p.hairLength ?? 0.5, 0, 1)) * S, curl } });
      case 'bun': return Object.assign(base, { reach: 'head', n: 16000, segs: 26, lift: 0, shell: 0.003, clump: 0.9, clumpN: 30, frizz: 0.05, cap: 0.95, wave: null,
        gather: { kind: 'bun', tie: tieAt(F, 0.62, 0.01), r: (0.026 + 0.012 * vol) * S } });
      case 'braid': return Object.assign(base, { reach: 'body', n: 15000, segs: 34, lift: 0, shell: 0.003, clump: 0.9, clumpN: 30, frizz: 0.05, cap: 0.95, wave: null,
        gather: { kind: 'braid', tie: tieAt(F, -0.15, 0.012), r: 0.014 * vol * S, tail: (0.22 + 0.3 * clamp(p.hairLength ?? 0.5, 0, 1)) * S } });
      default: return null;
    }
  }
  // a point on the back of the cranium ellipsoid at height qy (q-space), lifted off it
  function tieAt(F, qy, lift) {
    const qz = -Math.sqrt(Math.max(0.05, 1 - qy * qy));
    const p = new THREE.Vector3(F.C.x, F.C.y + qy * F.R.y, F.C.z + qz * F.R.z);
    const out = new THREE.Vector3(0, qy / F.R.y, qz / F.R.z).normalize();
    return { p: p.addScaledVector(out, lift), out };
  }

  // initial growth direction at a root, for the style's flow field
  function flowDir(R, F, q, nrm, rnd, out) {
    const nx = nrm.x, ny = nrm.y, nz = nrm.z;
    let dx = 0, dy = -1, dz = -0.2;
    const top = smooth(0.15, 0.6, q.y), frontness = smooth(0.2, 0.8, q.z);
    if (R.flow === 'back') { dx = q.x * 0.3; dy = -0.4; dz = -1; }
    else if (R.flow === 'radial') return out.set(nx, ny, nz);
    else if (R.flow === 'messy') {
      // textured short hair: forward and up at the front, back at the crown
      dx = (rnd() - 0.5) * 0.8 + q.x * 0.6; dy = mix(-0.6, 0.15, top); dz = mix(-1, 0.7, frontness * top);
    } else {
      const side = q.x - (R.part ?? 0);
      const sgn = Math.abs(side) < 0.02 ? (rnd() < 0.5 ? -1 : 1) : Math.sign(side);
      // away from the part across the top, down the sides and back
      dx = sgn * mix(0.25, 1, top); dy = mix(-1, -0.15, top); dz = mix(-0.5, -0.35, top);
      if (R.flow === 'fringe' && frontness > 0.3 && q.y > 0.15) { dx = sgn * 0.45; dy = -0.2; dz = 1; }
    }
    tangentOf(nx, ny, nz, dx, dy, dz, out);
    const lift = R.lift * (0.8 + 0.4 * rnd());
    return out.multiplyScalar(1 - lift).addScaledVector(nrm, lift).normalize();
  }

  // the hair "cap": a thin hair-coloured layer on the scalp so the skin
  // doesn't shine through between strands, fading out at the hairline
  const CAP_VERT = `
uniform mat4 uHead;
attribute float aMask;
varying float vM;
varying vec3 vN;
void main() {
  vec3 p = (uHead * vec4(position + normal * 0.0005, 1.0)).xyz;
  vN = normalize(mat3(modelViewMatrix) * (mat3(uHead) * normal));
  vM = aMask;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
  const CAP_FRAG = `
#include <common>
#include <lights_pars_begin>
uniform vec3 uColor;
uniform float uOpacity;
varying float vM;
varying vec3 vN;
void main() {
  vec3 N = normalize(vN), irr = ambientLightColor;
#if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) irr += directionalLights[i].color * max(dot(N, directionalLights[i].direction), 0.0) * 0.35;
#endif
#if NUM_HEMI_LIGHTS > 0
  for (int i = 0; i < NUM_HEMI_LIGHTS; i++) irr += getHemisphereLightIrradiance(hemisphereLights[i], N) * 0.5;
#endif
  gl_FragColor = vec4(uColor * (irr + 0.1), uOpacity * smoothstep(0.0, 1.0, vM));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
  function capMaterial() {
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {
      uHead: { value: new THREE.Matrix4() }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.85 },
    }]);
    return new THREE.ShaderMaterial({ uniforms, vertexShader: CAP_VERT, fragmentShader: CAP_FRAG, lights: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }

  // ---------------------------------------------------- the module
  class Hair {
    constructor(app) {
      this.app = app;
      this.human = app.human;
      this.styles = STYLES;
      this.beards = BEARDS;
      this.brows = BROWS;
      this.group = new THREE.Group();
      this.group.name = 'hair';
      this.human.group.add(this.group);
      this.quality = app.quality || 'high';
      this.q = QUALITY[this.quality] || 1;
      this.meshes = {};
      this.mats = { scalp: strandMaterial(), face: strandMaterial(), lash: strandMaterial(), cap: capMaterial() };
      this.mats.cap.uniforms.uHead = this.mats.scalp.uniforms.uHead;
      this.headIdx = this.human.boneIndex('head');
      this.invGroup = new THREE.Matrix4();
      this.keys = {};
      this.fields = {};
      this.timers = {};
      // screenshots and the game need the final groom at once; the studio
      // regrooms a moment after a body slider stops moving
      const q = app.query;
      this.sync = !!app.game || !!(q && q.get('t') !== null);
      this.forceStyle = (q && q.get('hair')) || null;
    }

    styleOf(p) { return this.forceStyle || p.hairStyle || 'short'; }

    // ---- params
    onParams(p) {
      this.p = p;
      const human = this.human;
      const F = (this.F = headFrame(human));
      const style = this.styleOf(p);
      // body changes smaller than ~2 mm around the head don't need a regroom
      const shape = [F.C.x, F.C.y, F.C.z, F.R.x, F.R.y, F.R.z, F.shoulderY, F.shoulderX, F.chin.y, F.chin.z].map((v) => Math.round(v * 500)).join(',') + human.smooth;
      const look = [style, p.hairLength, p.hairVolume, p.curl, this.recede(p).toFixed(2), human.bodyGeo.id].join('|');
      if (look + shape !== this.keys.scalp) {
        const fresh = look !== this.keys.look;
        this.keys.scalp = look + shape;
        this.keys.look = look;
        if (fresh || this.sync) this.buildScalp(style, p);
        else this.later('scalp', () => this.buildScalp(this.styleOf(this.p), this.p));
      }
      const browKey = [p.browStyle, p.browThickness, shape].join('|');
      if (browKey !== this.keys.brow) { this.keys.brow = browKey; this.buildBrows(p); }
      const lashKey = [p.lashLength, p.makeupStyle, shape].join('|');
      if (lashKey !== this.keys.lash) { this.keys.lash = lashKey; this.buildLashes(p); }
      this.applyColors(p);
    }

    later(name, fn) {
      clearTimeout(this.timers[name]);
      this.timers[name] = setTimeout(() => { this.F = headFrame(this.human); fn(); }, 220);
    }

    recede(p) {
      if (p.hairline !== undefined && p.hairline !== null) return clamp(p.hairline, 0, 1);
      return clamp(((p.age ?? 30) - 32) / 45, 0, 1) * smooth(0.55, 0.95, p.gender ?? 0.5) * 0.7;
    }

    // voxel distance fields, cached per body shape: 'head' (fine) and
    // 'body' (head, neck, shoulders and back for long hair)
    field(kind) {
      const human = this.human, F = this.F;
      const head = () => {
        const lo = [-(F.R.x + 0.1), F.E.y - 0.17, F.back - 0.08], hi = [F.R.x + 0.1, F.top + 0.05, F.front + 0.07];
        return this.cachedSDF('head', lo, hi, 0.006);
      };
      if (kind === 'head') return new Field([head()]);
      const body = this.cachedSDF('body', [-0.3, F.top - 0.95, -0.24], [0.3, F.top + 0.05, 0.3], 0.01);
      return new Field([head(), body]);
    }
    cachedSDF(name, lo, hi, h) {
      const key = lo.concat(hi).map((v) => v.toFixed(3)).join(',') + this.keys.scalp;
      const c = this.fields[name];
      if (c && c.key === key) return c.sdf;
      const sdf = new BodySDF(this.human.restAttr.array, this.human.S.tris, lo, hi, h);
      this.fields[name] = { key, sdf };
      return sdf;
    }

    setMesh(name, geo, mat, skinned) {
      const old = this.meshes[name];
      if (old) { this.group.remove(old); old.geometry.dispose(); }
      if (!geo) { delete this.meshes[name]; return null; }
      let mesh;
      if (skinned) {
        mesh = new THREE.SkinnedMesh(geo, mat);
        mesh.bind(this.human.skeleton, new THREE.Matrix4());
      } else mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'hair-' + name;
      mesh.frustumCulled = false;
      const u = mat.uniforms;
      if (u.uRes) mesh.onBeforeRender = (renderer) => { renderer.getDrawingBufferSize(u.uRes.value); };
      this.group.add(mesh);
      this.meshes[name] = mesh;
      return mesh;
    }

    // ---- scalp hair
    buildScalp(style, p) {
      const human = this.human, F = this.F;
      const R = recipe(style, p, F);
      if (!R) { this.setMesh('scalp', null); this.setMesh('cap', null); this.stats = null; return; }
      const rand = rng(1234 + STYLES.findIndex((s) => s.id === style) * 101);
      const n = human.S.nOut, a = human.restAttr.array, M = human.masks;
      const recede = this.recede(p);
      const mask = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const y = a[i * 3 + 1];
        if (y < F.E.y - 0.16) continue;
        mask[i] = scalpMask(F, a[i * 3], y, a[i * 3 + 2], M[i * 8 + 3], recede);
      }
      this.buildCap(mask, R);
      const t0 = performance.now();
      const field = (this.fieldNow = this.field(R.reach || 'head'));
      const t1 = performance.now();

      const ns = Math.max(200, Math.round(R.n * this.q)), segs = Math.max(2, Math.round(R.segs * (this.q < 0.3 ? 0.55 : this.q < 0.6 ? 0.8 : 1)));
      const np = segs + 1;
      const K = Math.max(16, Math.round(ns / R.clumpN));
      const CR = sampleSurface(human, mask, K, rand);
      const SR = sampleSurface(human, mask, ns, rand);
      if (!CR || !SR) { this.setMesh('scalp', null); return; }
      // clump centre paths, with each point's distance to the skin and
      // outward direction
      const CP = new Float32Array(K * np * 3), CD = new Float32Array(K * np), CN = new Float32Array(K * np * 3), CL = new Float32Array(K), side = new Int8Array(K);
      const q = V(), nrm = V(), root = V();
      for (let c = 0; c < K; c++) {
        root.fromArray(CR.pos, c * 3); nrm.fromArray(CR.nrm, c * 3);
        qOf(F, root.x, root.y, root.z, q);
        side[c] = R.part === null ? 0 : q.x >= R.part ? 1 : -1;
        CL[c] = this.growPath(R, field, root, nrm, q, rng(c * 7919 + 17), CP, c * np, segs);
        for (let k = 0; k < np; k++) {
          const o = (c * np + k) * 3;
          CD[c * np + k] = field.dist(CP[o], CP[o + 1], CP[o + 2], _g);
          if (_g.lengthSq() < 0.5) _g.set(CP[o] - F.C.x, CP[o + 1] - F.C.y, CP[o + 2] - F.C.z).normalize();
          CN[o] = _g.x; CN[o + 1] = _g.y; CN[o + 2] = _g.z;
        }
      }
      const t2 = performance.now();
      const hash = new Hash(CR.pos, K, clamp(0.25 / Math.sqrt(K), 0.004, 0.03));
      const B = new Batch(ns, np, {});
      const P = B.P, Q = V(), p0 = V(), d = V(), fz = V();
      const shellMax = R.shell + 0.004;
      for (let s = 0; s < ns; s++) {
        root.fromArray(SR.pos, s * 3);
        qOf(F, root.x, root.y, root.z, q);
        const sd = R.part === null ? 0 : q.x >= R.part ? 1 : -1;
        let c = hash.nearest(root.x, root.y, root.z, (i) => side[i] === sd);
        if (c < 0) c = hash.nearest(root.x, root.y, root.z);
        d.set(root.x - CR.pos[c * 3], root.y - CR.pos[c * 3 + 1], root.z - CR.pos[c * 3 + 2]);
        const dl = d.length();
        const lf = 0.8 + 0.2 * Math.sqrt(rand());
        const fzAmt = R.frizz * (rand() < 0.025 ? 4 : 1) * CL[c] * 6;
        fz.set(0, 0, 0);
        const r = rand();
        B.R[s * 2] = r;
        B.R[s * 2 + 1] = 0.7 + 0.6 * rand();
        for (let k = 0; k < np; k++) {
          const t = (k / segs) * lf, x = t * segs, k0 = Math.min(segs - 1, Math.floor(x)), f = x - k0;
          const j0 = c * np + k0, o0 = j0 * 3, o1 = o0 + 3;
          Q.set(mix(CP[o0], CP[o1], f), mix(CP[o0 + 1], CP[o1 + 1], f), mix(CP[o0 + 2], CP[o1 + 2], f));
          const cl = R.clump * smooth(0.05, 1, t);
          if (k > 0) fz.set(fz.x + (rand() - 0.5) * 0.004, fz.y + (rand() - 0.5) * 0.004, fz.z + (rand() - 0.5) * 0.004);
          const fa = fzAmt * t;
          p0.copy(Q).addScaledVector(d, 1 - cl).addScaledVector(fz, fa);
          // only strand points near the skin need the field
          let dist = mix(CD[j0], CD[j0 + 1], f);
          const i = s * np + k;
          if (k > 0 && dist < dl * (1 - cl) + fz.length() * fa + 0.003) {
            dist = field.push(p0, Math.min(0.0006 + k * 0.0012, 0.0012));
            if (_g.lengthSq() < 0.5) _g.fromArray(CN, o0);
            B.N[i * 3] = _g.x; B.N[i * 3 + 1] = _g.y; B.N[i * 3 + 2] = _g.z;
          } else {
            B.N[i * 3] = CN[o0]; B.N[i * 3 + 1] = CN[o0 + 1]; B.N[i * 3 + 2] = CN[o0 + 2];
          }
          P[i * 3] = p0.x; P[i * 3 + 1] = p0.y; P[i * 3 + 2] = p0.z;
          B.U[i] = t;
          B.O[i] = clamp(0.2 + (Math.max(0, dist) / shellMax) * 0.8, 0, 1) * (0.75 + 0.25 * r);
        }
        B.n++;
      }
      const t3 = performance.now();
      const geo = B.geometry();
      this.setMesh('scalp', geo, this.mats.scalp, false);
      this.mats.scalp.uniforms.uWidth.value = (0.00019 * R.width) / Math.sqrt(this.q);
      this.stats = { field: t1 - t0, clumps: t2 - t1, strands: t3 - t2, geometry: performance.now() - t3, strands_n: ns, vertices: ns * np * 2 };
    }

    buildCap(mask, R) {
      const human = this.human, tris = human.S.tris, a = human.restAttr.array, nr = human.bodyNrm.array;
      const map = new Map(), idx = [];
      for (let t = 0; t < tris.length; t += 3) {
        const i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
        if (mask[i0] + mask[i1] + mask[i2] < 0.01) continue;
        for (const v of [i0, i1, i2]) {
          if (!map.has(v)) map.set(v, map.size);
          idx.push(map.get(v));
        }
      }
      const nv = map.size, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), m = new Float32Array(nv);
      for (const [v, i] of map) {
        for (let c = 0; c < 3; c++) { pos[i * 3 + c] = a[v * 3 + c]; nrm[i * 3 + c] = nr[v * 3 + c]; }
        m[i] = mask[v];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geo.setAttribute('aMask', new THREE.BufferAttribute(m, 1));
      geo.setIndex(idx);
      const mesh = this.setMesh('cap', geo, this.mats.cap, false);
      mesh.renderOrder = 1;
      this.mats.cap.uniforms.uOpacity.value = R.cap ?? 0.85;
    }

    // one clump centre: grows from the root, bends under gravity, slides
    // over the head and shoulders, then gets cut and curled. Returns length.
    growPath(R, field, root, nrm, q, rnd, out, o, segs) {
      if (R.gather) return this.gatherPath(R, field, root, nrm, q, rnd, out, o, segs);
      const F = this.F;
      const L = R.len(q) * (0.9 + 0.2 * rnd());
      const seg = L / segs;
      const dir = flowDir(R, F, q, nrm, rnd, V());
      const p = root.clone().addScaledVector(nrm, 0.0004), prev = V(), g = V();
      const shell = R.shell * (0.35 + 0.65 * rnd()) * (0.7 + 0.6 * smooth(-0.6, 0.9, q.y));
      const front = q.z > 0.3;
      out[o * 3] = p.x; out[o * 3 + 1] = p.y; out[o * 3 + 2] = p.z;
      for (let k = 1; k <= segs; k++) {
        const l = k * seg;
        prev.copy(p);
        // hair lies against the head while gravity presses it there, and
        // falls free from the widest part of the skull
        if (R.hug) {
          const dist = field.dist(p.x, p.y, p.z, g);
          const o2 = dir.dot(g);
          if (dist < shell + 0.004 && o2 > 0) dir.addScaledVector(g, -o2 * R.hug * (R.grav > 8 ? smooth(-0.15, 0.2, g.y) : 1));
        }
        // long hair goes in front of or behind the shoulders depending on
        // where it grows
        dir.y -= R.grav * seg * smooth(0, 0.025, l);
        if (R.grav > 15 && p.y < F.chin.y + 0.02) dir.z += (front ? 0.6 : -0.6) * seg * 4;
        if (R.kink) { dir.x += (rnd() - 0.5) * R.kink; dir.y += (rnd() - 0.5) * R.kink; dir.z += (rnd() - 0.5) * R.kink; }
        dir.normalize();
        p.addScaledVector(dir, seg);
        field.push(p, Math.min(shell, 0.0004 + l * R.rise));
        dir.subVectors(p, prev);
        if (dir.lengthSq() > 1e-12) dir.normalize();
        out[(o + k) * 3] = p.x; out[(o + k) * 3 + 1] = p.y; out[(o + k) * 3 + 2] = p.z;
      }
      let len = L;
      if (R.cut) len = this.cutPath(R, out, o, segs, seg, rnd);
      if (R.wave) this.curlPath(R, field, out, o, segs, len, rnd);
      return len;
    }

    // gathered styles: over the scalp to the tie, then the tail / bun / braid
    gatherPath(R, field, root, nrm, q, rnd, out, o, segs) {
      const G = R.gather, F = this.F;
      if (!G.ready) {
        // sit the tie just off the actual head, not the fitted ellipsoid
        field.push(G.tie.p, G.r * 0.6 + 0.006);
        G.ready = true;
      }
      const tie = G.tie.p, outw = G.tie.out;
      const e1 = V().set(1, 0, 0).addScaledVector(outw, -outw.x).normalize(), e2 = V().crossVectors(outw, e1).normalize();
      // the strand keeps its place around the tie: hair from the left stays left
      const rel = V().subVectors(root, tie);
      const a = Math.atan2(rel.dot(e2), rel.dot(e1));
      const rr = Math.sqrt(rnd()), ca = Math.cos(a) * rr, sa = Math.sin(a) * rr;
      const end = V().copy(tie).addScaledVector(e1, ca * G.r).addScaledVector(e2, sa * G.r);
      // pulled smooth over the scalp: along the head's curve, not through it
      const R0 = F.R, C = F.C;
      const u0 = V().set((root.x - C.x) / R0.x, (root.y - C.y) / R0.y, (root.z - C.z) / R0.z);
      const u1 = V().set((end.x - C.x) / R0.x, (end.y - C.y) / R0.y, (end.z - C.z) / R0.z);
      const l0 = u0.length(), l1 = u1.length();
      u0.normalize(); u1.normalize();
      const om = Math.acos(clamp(u0.dot(u1), -1, 1)), so = Math.sin(om);
      const dist = om * (R0.x + R0.y + R0.z) / 3 + 0.01;
      const tailLen = G.kind === 'bun' ? 2 * Math.PI * G.r * 0.75 * 2.2 : G.tail * (0.85 + 0.3 * rnd());
      const n1 = clamp(Math.round(segs * dist / (dist + tailLen)), 2, segs - 3), n2 = segs - n1;
      const p = V(), dir = V(), c = V(), b = V(), u = V();
      out[o * 3] = root.x; out[o * 3 + 1] = root.y; out[o * 3 + 2] = root.z;
      for (let k = 1; k <= n1; k++) {
        const t = k / n1;
        if (so < 1e-4) u.copy(u0);
        else u.copy(u0).multiplyScalar(Math.sin((1 - t) * om) / so).addScaledVector(u1, Math.sin(t * om) / so);
        u.multiplyScalar(mix(l0, l1, t));
        p.set(C.x + u.x * R0.x, C.y + u.y * R0.y, C.z + u.z * R0.z);
        if (k === n1) p.copy(end);
        else field.push(p, 0.0022 + 0.0015 * t);
        out[(o + k) * 3] = p.x; out[(o + k) * 3 + 1] = p.y; out[(o + k) * 3 + 2] = p.z;
      }
      const seg = tailLen / n2;
      c.copy(tie);
      dir.copy(outw).multiplyScalar(0.75).add(V().set(0, -0.5, 0)).normalize();
      // which of the braid's three strands this hair belongs to
      const lobe = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 3) % 3;
      for (let j = 1; j <= n2; j++) {
        const t = j / n2, k = n1 + j;
        if (G.kind === 'bun') {
          // a coil wound against the head, tighter towards its centre
          const th = a + t * 2 * Math.PI * 2.2, rb = G.r * (0.95 - 0.55 * t) + 0.003;
          p.copy(tie).addScaledVector(outw, G.r * (0.15 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.3))))
            .addScaledVector(e1, Math.cos(th) * rb + ca * 0.004).addScaledVector(e2, Math.sin(th) * rb + sa * 0.004);
        } else {
          // the tail's centre falls under gravity and drapes over the back
          dir.y -= 22 * seg * smooth(0, 0.05, j * seg);
          dir.normalize();
          c.addScaledVector(dir, seg);
          field.push(c, G.r * 0.9 + 0.004);
          // cross-section across the tail, not across the tie
          b.crossVectors(dir, e1).normalize();
          p.copy(c);
          if (G.kind === 'braid') {
            const taper = 1 - 0.5 * t * t;
            const ph = (j * seg) / 0.05 * 2 * Math.PI + lobe * (2 * Math.PI / 3);
            const w = G.r * taper;
            p.addScaledVector(e1, Math.sin(ph) * w * 0.85 + ca * w * 0.45).addScaledVector(b, Math.sin(2 * ph) * w * 0.3 + sa * w * 0.45);
          } else {
            const fan = (0.9 + 0.7 * smooth(0, 0.35, t)) * (1 - 0.55 * t * t);
            p.addScaledVector(e1, ca * G.r * fan).addScaledVector(b, sa * G.r * fan * 0.8);
            if (G.curl > 0.3) p.addScaledVector(e1, Math.sin(j * 0.9 + a * 3) * 0.008 * G.curl * t);
          }
          field.push(p, 0.003);
        }
        out[(o + k) * 3] = p.x; out[(o + k) * 3 + 1] = p.y; out[(o + k) * 3 + 2] = p.z;
      }
      return dist + tailLen * 0.2;
    }

    // trims a path where the style's cut line crosses it and resamples it
    // back to segs+1 evenly spaced points
    cutPath(R, out, o, segs, seg, rnd) {
      const F = this.F;
      const jit = (rnd() - 0.5) * 0.012;
      let end = segs * seg;
      for (let k = 1; k <= segs; k++) {
        const x = out[(o + k) * 3], y = out[(o + k) * 3 + 1], z = out[(o + k) * 3 + 2];
        let cut = false;
        if (R.cut === 'bob') cut = y < F.chin.y + 0.006 + 0.035 * clamp((F.E.z - z) / 0.16, 0, 1) - (R.drop || 0) + jit;
        else if (R.cut === 'fringe') cut = z > F.E.z - 0.01 && Math.abs(x) < 0.06 && y < F.E.y + 0.024 + jit;
        else if (R.cut === 'afro') {
          const qx = (x - F.C.x) / (F.R.x + R.afro), qy = (y - F.C.y - R.afro * 0.25) / (F.R.y + R.afro * 0.9), qz = (z - F.C.z + R.afro * 0.15) / (F.R.z + R.afro);
          cut = qx * qx + qy * qy + qz * qz > 1 + jit * 4;
        }
        if (cut) { end = (k - 1) * seg + seg * 0.5; break; }
      }
      if (end >= segs * seg - 1e-6) return end;
      end = Math.max(end, seg * 0.6);
      const tmp = out.slice(o * 3, (o + segs + 1) * 3);
      for (let k = 0; k <= segs; k++) {
        const x = (k / segs) * (end / seg), k0 = Math.min(segs - 1, Math.floor(x)), f = x - k0;
        for (let c = 0; c < 3; c++) out[(o + k) * 3 + c] = mix(tmp[k0 * 3 + c], tmp[(k0 + 1) * 3 + c], f);
      }
      return end;
    }

    // waves and curls: an (elliptical) helix around the path in a
    // parallel-transported frame, growing in from the root
    curlPath(R, field, out, o, segs, len, rnd) {
      const W = R.wave, seg = len / segs, phase = rnd() * Math.PI * 2;
      const wl = W.wl * (0.85 + 0.3 * rnd()), amp = W.amp * (0.7 + 0.6 * rnd());
      const T = V(), N = V(), B = V(), tmp = V(), off = new Float32Array((segs + 1) * 3);
      const F = this.F;
      for (let k = 0; k <= segs; k++) {
        const a = Math.max(0, k - 1), b = Math.min(segs, k + 1);
        T.set(out[(o + b) * 3] - out[(o + a) * 3], out[(o + b) * 3 + 1] - out[(o + a) * 3 + 1], out[(o + b) * 3 + 2] - out[(o + a) * 3 + 2]).normalize();
        if (k === 0) {
          tmp.set(out[o * 3] - F.C.x, out[o * 3 + 1] - F.C.y, out[o * 3 + 2] - F.C.z).normalize();
          N.crossVectors(T, tmp);
          if (N.lengthSq() < 1e-8) N.set(1, 0, 0);
          N.normalize();
        } else N.addScaledVector(T, -N.dot(T)).normalize();
        B.crossVectors(T, N);
        const l = k * seg, th = (l / wl) * Math.PI * 2 + phase;
        const A = amp * smooth(0, 0.05, l) * (1 + 0.3 * (l / len));
        off[k * 3] = A * (Math.cos(th) * N.x + W.ell * Math.sin(th) * B.x);
        off[k * 3 + 1] = A * (Math.cos(th) * N.y + W.ell * Math.sin(th) * B.y);
        off[k * 3 + 2] = A * (Math.cos(th) * N.z + W.ell * Math.sin(th) * B.z);
      }
      for (let k = 1; k <= segs; k++) {
        tmp.set(out[(o + k) * 3] + off[k * 3], out[(o + k) * 3 + 1] + off[k * 3 + 1], out[(o + k) * 3 + 2] + off[k * 3 + 2]);
        field.push(tmp, 0.0012);
        out[(o + k) * 3] = tmp.x; out[(o + k) * 3 + 1] = tmp.y; out[(o + k) * 3 + 2] = tmp.z;
      }
    }

    // ---- eyebrows: short strands on the brow ridge, skinned to the face
    buildBrows(p) {
      const style = p.browStyle || 'natural';
      if (style === 'none') { this.setMesh('brows', null); return; }
      const human = this.human, F = this.F, a = human.restAttr.array, nr = human.bodyNrm.array, n = human.S.nOut;
      const k = Math.abs(F.eyeL.x - F.eyeR.x) / 0.0578; // face scale
      const thick = clamp(p.browThickness ?? 0.5, 0, 1);
      const T = { natural: [0.0085, 0.006], thin: [0.005, 0.003], thick: [0.012, 0.007], arched: [0.008, 0.009], straight: [0.0085, 0.001] }[style] || [0.0085, 0.006];
      const height = (0.6 + 0.8 * thick) * T[0] * k, arch = T[1] * k;
      const ex = F.eyeL.x, ey = F.eyeL.y;
      const xIn = ex - 0.0175 * k, xOut = ex + 0.027 * k;
      // centre line and half height along the brow, v = 0 inner .. 1 tail
      const cy = (v) => ey + 0.0185 * k + arch * Math.sin(Math.PI * Math.min(1, v / 0.68) * 0.5) - (v > 0.68 ? arch * 1.4 * ((v - 0.68) / 0.32) ** 2 : 0);
      const hh = (v) => 0.5 * height * (1 - 0.6 * Math.max(0, v) ** 1.6) * smooth(-0.15, 0.12, v);
      const mask = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const z = a[i * 3 + 2];
        if (z < F.eyeL.z - 0.01 || nr[i * 3 + 2] < 0.15) continue;
        const x = Math.abs(a[i * 3]), y = a[i * 3 + 1];
        if (y < ey || y > ey + 0.05 * k || x > xOut + 0.01 || x < xIn - 0.01) continue;
        const v = (x - xIn) / (xOut - xIn);
        const e = Math.abs(y - cy(v)) / Math.max(1e-4, hh(v));
        mask[i] = smooth(-0.02, 0.06, v) * (1 - smooth(0.96, 1.04, v)) * (1 - smooth(0.75, 1.15, e));
      }
      const rand = rng(777);
      const ns = Math.max(60, Math.round((900 + 900 * thick) * (this.q < 0.3 ? 0.25 : this.q < 0.6 ? 0.6 : 1)));
      const SR = sampleSurface(human, mask, ns, rand);
      if (!SR) { this.setMesh('brows', null); return; }
      const segs = this.q < 0.3 ? 2 : 4, np = segs + 1;
      const B = new Batch(ns, np, { skin: true });
      const root = V(), nrm = V(), up = V(), lat = V(), d = V(), pt = V();
      for (let s = 0; s < ns; s++) {
        root.fromArray(SR.pos, s * 3); nrm.fromArray(SR.nrm, s * 3);
        const sx = Math.sign(root.x) || 1, x = Math.abs(root.x);
        const v = clamp((x - xIn) / (xOut - xIn), 0, 1);
        const rel = clamp((root.y - cy(v)) / Math.max(1e-4, hh(v)), -1, 1); // -1 lower edge .. 1 upper
        // herringbone: inner hairs stand up, lower hairs angle up and out,
        // upper hairs angle down and out, the tail lies flat and outward
        let ang = mix(1.35, 0.55, smooth(0, 0.3, v)) - rel * 0.45 * smooth(0.1, 0.4, v) - 0.35 * smooth(0.65, 1, v);
        ang += (rand() - 0.5) * 0.35;
        tangentOf(nrm.x, nrm.y, nrm.z, 0, 1, 0, up);
        tangentOf(nrm.x, nrm.y, nrm.z, sx, 0, 0, lat);
        d.copy(lat).multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang)).normalize();
        const L = (0.0065 + 0.004 * rand()) * mix(1, 0.6, v) * k * (0.85 + 0.3 * thick);
        const lift = 0.18 + 0.12 * rand();
        for (let j = 0; j < np; j++) {
          const t = j / segs, l = t * L;
          // leave the skin at a shallow angle and curve back onto it
          pt.copy(root).addScaledVector(d, l).addScaledVector(nrm, 0.00025 + l * lift - (l * l) / 0.035);
          const i = s * np + j;
          B.P[i * 3] = pt.x; B.P[i * 3 + 1] = pt.y; B.P[i * 3 + 2] = pt.z;
          B.N[i * 3] = nrm.x; B.N[i * 3 + 1] = nrm.y; B.N[i * 3 + 2] = nrm.z;
          B.U[i] = t;
          B.O[i] = 0.55 + 0.45 * smooth(-1, 1, rel);
        }
        B.R[s * 2] = rand();
        B.R[s * 2 + 1] = 0.7 + 0.6 * rand();
        vertexBones(human, SR.vtx[s], B.SI, B.SW, s * 4);
        B.n++;
      }
      this.setMesh('brows', B.geometry(), this.mats.face, true);
    }

    // ---- eyelashes: grown along MakeHuman's lash helper strips, which sit
    // on the lid margins (upper strip = group 2, lower = group 1)
    buildLashes(p) {
      const human = this.human, D = human.D, F = this.F;
      const len = 0.6 + 0.65 * clamp(p.lashLength ?? 0.5, 0, 1);
      const mascara = p.makeupStyle && p.makeupStyle !== 'none' ? 1 : 0;
      const qs = this.q < 0.3 ? 0.3 : this.q < 0.6 ? 0.6 : 1;
      const parts = [];
      for (const [g, eye, upper] of [['helper-l-eyelashes-2', F.eyeL, 1], ['helper-l-eyelashes-1', F.eyeL, 0], ['helper-r-eyelashes-2', F.eyeR, 1], ['helper-r-eyelashes-1', F.eyeR, 0]]) {
        if (!D.groups[g]) continue;
        const chains = lashChains(human, D.groups[g].fv, eye);
        if (chains.length >= 2) parts.push({ chains, upper, count: Math.round((upper ? 120 : 50) * qs) });
      }
      if (!parts.length) { this.setMesh('lashes', null); return; }
      const segs = this.q < 0.3 ? 3 : 6, np = segs + 1;
      const total = parts.reduce((s, x) => s + x.count, 0);
      const B = new Batch(total, np, { skin: true });
      const rand = rng(4242), pt = V(), A = V(), Bv = V(), tip = V(), root = V(), dir = V(), nrm = V(), side = V();
      for (const part of parts) {
        const { chains, upper } = part, nc = chains.length;
        for (let s = 0; s < part.count; s++) {
          // denser and longer towards the outer half of the lid
          const t = clamp((s + rand()) / part.count, 0.02, 0.98);
          const x = t * (nc - 1), c0 = Math.min(nc - 2, Math.floor(x)), f = x - c0;
          const ch0 = chains[c0], ch1 = chains[c0 + 1];
          const ln = len * (upper ? 1 : 0.55) * mix(0.55, 1, smooth(0, 0.45, t)) * mix(1, 0.7, smooth(0.8, 1, t)) * (0.8 + 0.35 * rand()) * (1 + 0.25 * mascara);
          human.baseRest(ch0[0], A); human.baseRest(ch1[0], Bv);
          root.lerpVectors(A, Bv, f);
          human.baseRest(ch0[ch0.length - 1], A); human.baseRest(ch1[ch1.length - 1], Bv);
          tip.lerpVectors(A, Bv, f);
          const span = tip.distanceTo(root);
          dir.subVectors(tip, root).normalize();
          side.subVectors(Bv, A).normalize();
          nrm.crossVectors(side, dir).normalize();
          if ((upper ? nrm.y : -nrm.y) < 0) nrm.negate();
          const spread = (rand() - 0.5) * 0.35, curlAmt = (upper ? 0.5 : 0.3) * (0.7 + 0.6 * rand()) * (1 + 0.4 * mascara);
          const L = 0.0068 * ln;
          for (let j = 0; j < np; j++) {
            const u = j / segs;
            // along the strip direction, curving away from the eye
            const xj = u * (ch0.length - 1), j0 = Math.min(ch0.length - 2, Math.floor(xj)), fj = xj - j0;
            human.baseRest(ch0[j0], A); human.baseRest(ch0[j0 + 1], Bv); A.lerp(Bv, fj);
            human.baseRest(ch1[j0], tip); human.baseRest(ch1[j0 + 1], Bv); tip.lerp(Bv, fj);
            pt.lerpVectors(A, tip, f).sub(root).multiplyScalar(L / Math.max(span, 1e-4));
            pt.add(root).addScaledVector(side, spread * u * L).addScaledVector(nrm, curlAmt * L * u * u);
            const i = B.n * np + j;
            B.P[i * 3] = pt.x; B.P[i * 3 + 1] = pt.y; B.P[i * 3 + 2] = pt.z;
            B.N[i * 3] = nrm.x; B.N[i * 3 + 1] = nrm.y; B.N[i * 3 + 2] = nrm.z;
            B.U[i] = u;
            B.O[i] = 0.7;
          }
          B.R[B.n * 2] = rand();
          B.R[B.n * 2 + 1] = (1.2 + 0.6 * rand()) * (1 + 0.5 * mascara) * (upper ? 1 : 0.7);
          baseBones(D, ch0[0], B.SI, B.SW, B.n * 4);
          B.n++;
        }
      }
      this.setMesh('lashes', B.geometry(), this.mats.lash, true);
    }

    applyColors(p) {
      const C = hairColors(p), age = p.age ?? 30;
      const set = (mat, base, tip, grey) => {
        const u = mat.uniforms;
        u.uColor.value.copy(base);
        u.uTip.value.copy(tip);
        u.uGrey.value = grey;
      };
      const greyHair = p.hairColor === 'Grey' || p.hairColor === 'White' ? 0 : greyAt(age, 42);
      set(this.mats.scalp, C.base, C.tip, greyHair);
      set(this.mats.face, C.brow, C.brow.clone().multiplyScalar(1.15), greyAt(age, 55) * 0.5);
      set(this.mats.lash, C.lash, C.lash, 0);
      this.mats.cap.uniforms.uColor.value.copy(C.base).multiplyScalar(0.6);
      const ml = this.mats.lash.uniforms;
      ml.uWidth.value = 0.00005;
      ml.uRootDark.value = 1;
      // short facial hair barely shines: a white highlight makes it read grey
      ml.uSpec.value.set(0.03, 0.05);
      this.mats.face.uniforms.uWidth.value = 0.00009;
      this.mats.face.uniforms.uSpec.value.set(0.035, 0.1);
    }

    // ---- per frame
    update() {
      const human = this.human;
      const hm = this.mats.scalp.uniforms.uHead.value;
      this.invGroup.copy(human.group.matrixWorld).invert();
      hm.multiplyMatrices(this.invGroup, human.boneMats[this.headIdx]);
    }

    dispose() {
      for (const k in this.timers) clearTimeout(this.timers[k]);
      for (const k in this.meshes) this.meshes[k].geometry.dispose();
      for (const k in this.mats) this.mats[k].dispose();
      if (this.group.parent) this.group.parent.remove(this.group);
    }
  }

  // lash helper strip -> chains of base vertices from the lid margin out to
  // the lash tips, ordered along the lid
  function lashChains(human, fv, eye) {
    const dist = new Map(), P = V();
    for (let i = 0; i < fv.length; i++) if (!dist.has(fv[i])) dist.set(fv[i], human.baseRest(fv[i], P).distanceTo(eye));
    const next = new Map(), hasPrev = new Set();
    for (let f = 0; f < fv.length; f += 4) {
      const q = [fv[f], fv[f + 1], fv[f + 2], fv[f + 3]], d = q.map((v) => dist.get(v));
      const ra = Math.abs(d[0] - d[1]) + Math.abs(d[2] - d[3]), rb = Math.abs(d[1] - d[2]) + Math.abs(d[3] - d[0]);
      const pairs = ra > rb ? [[0, 1], [3, 2]] : [[1, 2], [0, 3]];
      for (const [x, y] of pairs) {
        const [inner, outer] = d[x] < d[y] ? [q[x], q[y]] : [q[y], q[x]];
        next.set(inner, outer);
        hasPrev.add(outer);
      }
    }
    const chains = [];
    for (const v of next.keys()) {
      if (hasPrev.has(v)) continue;
      const ch = [v];
      let c = v;
      while (next.has(c) && ch.length < 12) { c = next.get(c); ch.push(c); }
      if (ch.length >= 2) chains.push(ch);
    }
    // order along the lid (rest x, mirrored doesn't matter)
    chains.sort((x, y) => human.baseRest(x[0], P).x - human.baseRest(y[0], V()).x);
    const L = Math.min(...chains.map((c) => c.length));
    return chains.map((c) => c.slice(0, L));
  }

  BS.registerModule({ name: 'hair', order: 10, create: (app) => new Hair(app) });
})();
