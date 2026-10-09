// Body Studio — procedural shape corrections on top of MakeHuman's morph
// targets: natural breast shape and support, and other body refinements.
// core.js calls BS.shapeCorrect(D, p, P) inside BS.morph after the targets are
// applied and before heightScale; P is the base-mesh position array (D.base units).
//
// MakeHuman's breast targets give conical breasts that point sideways when
// firm and fold oddly when soft. Here every breast is reshaped in a frame of its
// own (apex, chest wall, lateral and up directions): rounded into a dome with a
// fuller lower pole, aimed forward, given gravity by firmness, age and size, and
// the gentle lift and closeness of the bra or top everyone wears. Everything is
// a smooth field over static per-vertex coordinates, so after Catmull-Clark the
// skin stays smooth, and it costs a few vector ops per vertex per morph.
// ?noshape=1 turns it off for before/after comparisons.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const OFF = typeof location !== 'undefined' && /[?&]noshape=1/.test(location.search || '');

  // breast footprint on the base mesh around the apex (dm): reach toward the
  // armpit, the sternum, the collarbone and below the fold
  const FOOT = { lat: 0.75, med: 0.85, up: 1.0, down: 1.25 };

  // ------------------------------------------------------------ static data
  function prep(D) {
    if (D._shape) return D._shape;
    const B = D.base, fv = D.groups.body.fv;
    const inBody = new Uint8Array(D.nV);
    for (let i = 0; i < fv.length; i++) inBody[fv[i]] = 1;
    const ai = D.maskNames.indexOf('aureolae');
    const sides = [1, -1].map((s) => {
      // apex: the areola's weighted centre on the base mesh
      let ax = 0, ay = 0, az = 0, aw = 0;
      const ar = [], arW = [];
      for (let v = 0; v < D.nV; v++) {
        const w = inBody[v] ? D.masks[v * 8 + ai] / 255 : 0;
        if (w < 0.05 || B[v * 3] * s <= 0) continue;
        ar.push(v); arW.push(w);
        ax += B[v * 3] * w; ay += B[v * 3 + 1] * w; az += B[v * 3 + 2] * w; aw += w;
      }
      ax /= aw; ay /= aw; az /= aw;
      // footprint coordinates: u = lateral (+ toward the armpit), w = up
      const idx = [], U = [], W = [], R = [], ring = [];
      for (let v = 0; v < D.nV; v++) {
        if (!inBody[v] || B[v * 3 + 2] < 0.15) continue;
        const u = B[v * 3] * s - ax * s, w = B[v * 3 + 1] - ay;
        const ru = u / (u > 0 ? FOOT.lat : FOOT.med), rw = w / (w > 0 ? FOOT.up : FOOT.down);
        const r = Math.sqrt(ru * ru + rw * rw);
        if (r < 1.35) { idx.push(v); U.push(u); W.push(w); R.push(r); }
        if (r > 1.25 && r < 1.6) ring.push(v);
      }
      return { s, apex0: [ax, ay, az], ar: Int32Array.from(ar), arW: Float32Array.from(arW), idx: Int32Array.from(idx), U: Float32Array.from(U), W: Float32Array.from(W), R: Float32Array.from(R), ring: Int32Array.from(ring) };
    });
    // quads touching either breast region, for per-morph normals
    const mark = new Uint8Array(D.nV);
    for (const sd of sides) for (const v of sd.idx) mark[v] = 1;
    const quads = [];
    for (let f = 0; f < fv.length; f += 4) if (mark[fv[f]] || mark[fv[f + 1]] || mark[fv[f + 2]] || mark[fv[f + 3]]) quads.push(fv[f], fv[f + 1], fv[f + 2], fv[f + 3]);
    const S = { sides, quads: Int32Array.from(quads), N: new Float32Array(D.nV * 3), mark };
    return (D._shape = S);
  }

  // vertex normals of the region (area-weighted quad normals)
  function regionNormals(S, P) {
    const N = S.N, q = S.quads;
    for (const sd of S.sides) for (const v of sd.idx) { N[v * 3] = 0; N[v * 3 + 1] = 0; N[v * 3 + 2] = 0; }
    for (let f = 0; f < q.length; f += 4) {
      const a = q[f] * 3, b = q[f + 1] * 3, c = q[f + 2] * 3, d = q[f + 3] * 3;
      // cross of the diagonals
      const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
      const vx = P[d] - P[b], vy = P[d + 1] - P[b + 1], vz = P[d + 2] - P[b + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const o of [a, b, c, d]) { N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; }
    }
    for (const sd of S.sides) for (const v of sd.idx) {
      const o = v * 3, l = Math.hypot(N[o], N[o + 1], N[o + 2]) || 1;
      N[o] /= l; N[o + 1] /= l; N[o + 2] /= l;
    }
    return N;
  }

  // how much of a breast this body has, 0 (male chest) .. 1: MakeHuman's
  // macros grow breasts with the female weight, so follow the gender slider
  function breastWeight(p) {
    return smooth(0.22, 0.8, 1 - (p.gender ?? 0.5));
  }

  // ------------------------------------------------------------ breasts
  function breasts(S, D, p, P) {
    const F = breastWeight(p);
    if (F < 0.01) return;
    const N = regionNormals(S, P);
    const size = clamp(p.breastSize ?? 0.5, 0, 1), firm = clamp(p.breastFirmness ?? 0.5, 0, 1);
    const age = p.age ?? 28, ageK = smooth(30, 75, age);
    const support = clamp(p.breastSupport ?? 0.5, 0, 1);
    const info = (BS.shapeInfo = { sides: [] });
    for (const sd of S.sides) {
      const s = sd.s;
      // current apex and its normal
      let ax = 0, ay = 0, az = 0, nx = 0, ny = 0, nz = 0, aw = 0;
      for (let i = 0; i < sd.ar.length; i++) {
        const v = sd.ar[i], w = sd.arW[i];
        ax += P[v * 3] * w; ay += P[v * 3 + 1] * w; az += P[v * 3 + 2] * w;
        nx += N[v * 3] * w; ny += N[v * 3 + 1] * w; nz += N[v * 3 + 2] * w; aw += w;
      }
      ax /= aw; ay /= aw; az /= aw;
      // chest reference: the ring around the footprint
      let cx = 0, cy = 0, cz = 0;
      for (const v of sd.ring) { cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; }
      cx /= sd.ring.length; cy /= sd.ring.length; cz /= sd.ring.length;
      // projection of the breast in front of a flat chest (dm)
      const H = Math.max(0, az - cz - 0.38);
      const sc = F * (0.12 + H);
      info.sides.push({ apex: [ax, ay, az], ring: [cx, cy, cz], H, sc, n: [nx / aw, ny / aw, nz / aw] });

      // gravity: softer, older and heavier breasts sit lower; a bra lifts
      const sag = (0.15 + 0.5 * (1 - firm) + 0.35 * ageK) * (0.4 + 0.8 * size) * (1 - 0.55 * support);
      const lift = 0.12 * support;
      const toward = 0.08 * support;
      const kRoundUp = 0.10, kRoundLow = 0.28, kLow = 0.18;
      for (let i = 0; i < sd.idx.length; i++) {
        const v = sd.idx[i], r = sd.R[i], u = sd.U[i], w = sd.W[i];
        const o = v * 3;
        // dome: fill the cone's flanks, more below the nipple than above
        const q = clamp(r / 1.15, 0, 1), bump = 16 * q * q * (1 - q) * (1 - q);
        const low = smooth(0.05, -0.55, w);
        const qL = clamp(r / 1.05, 0, 1), bumpL = 6.75 * qL * qL * (1 - qL);
        const out = sc * (bump * (kRoundUp + (kRoundLow - kRoundUp) * low) + kLow * low * bumpL * (1 - qL) * 2);
        // the mound moves as a whole: down with gravity, up and in with support
        const mw = smooth(1.25, 0.15, r);
        const dy = sc * (lift - 0.22 * sag) * mw;
        const dx = -s * sc * toward * mw;
        P[o] += N[o] * out + dx;
        P[o + 1] += N[o + 1] * out + dy;
        P[o + 2] += N[o + 2] * out;
      }
    }
  }

  BS.shapeCorrect = function (D, p, P) {
    if (OFF) return;
    const S = prep(D);
    breasts(S, D, p, P);
  };
})();
