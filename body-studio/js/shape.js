// Body Studio — procedural shape corrections on top of MakeHuman's morph
// targets: natural breast shape and support, round glutes with a soft
// gluteal fold, and a smooth waist-hip-thigh line.
// core.js calls BS.shapeCorrect(D, p, P) inside BS.morph after the targets are
// applied and before heightScale; P is the base-mesh position array (D.base
// units, decimeters). ?noshape=1 turns it off for before/after comparisons.
//
// Breasts. MakeHuman's breast targets are cones: a straight upper slope and a
// short straight lower slope meeting in a point at the nipple. Each breast is
// measured against its own chest wall (a smooth surface fitted through a ring
// of skin around it), giving every vertex a height fraction t (0 at the chest
// wall, 1 at the areola). Remapping t through a dome profile turns the cone
// into a rounded breast without needing to know its size: the lower pole gets
// a full convex curve down to a soft inframammary fold, the upper pole stays a
// gentle slope that only rounds near the top, the side fills out toward the
// armpit, and the tip becomes a smooth dome with the areola on it instead of
// a point. Gravity (softness, age, size) then moves the mound down a little
// and a bra's support (everyone wears one or a top) lifts and centres it.
// The cleavage never closes past the midline.
//
// Glutes. A rounder, fuller buttock (scaled by the Butt detail, body fat and
// the female macro) with its mass sitting in the lower half, a gluteal fold
// under it that deepens with fat and softness, and a smooth hip-to-thigh line.
//
// Everything is a smooth field over static per-vertex coordinates cached on
// D (computed once), so after Catmull-Clark the skin stays smooth and a morph
// costs a few vector ops per vertex. Nothing moves the crown or the soles, so
// the height solver (which never calls this) stays exact, and the breast bone's
// tail joint is a body vertex at the nipple, so the skeleton follows.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const OFF = typeof location !== 'undefined' && /[?&]noshape=1/.test(location.search || '');
  const det = (p, k) => clamp((p.details && p.details[k]) || 0, -1, 1);

  // breast footprint on the base mesh around the apex (dm): reach toward the
  // armpit, the sternum, the collarbone and below the fold; skin more than
  // `backOff` behind the apex counts toward the distance (the torso's side)
  const FOOT = { lat: 0.8, med: 0.72, up: 1.05, down: 0.95, back: 0.55, backOff: 0.3 };
  const ARM = /^(shoulder|upperarm|lowerarm|wrist|finger|metacarpal|thumb)/;

  // ------------------------------------------------------------ static data
  function prep(D) {
    if (D._shape) return D._shape;
    const B = D.base, fv = D.groups.body.fv, nV = D.nV;
    const inBody = new Uint8Array(nV);
    for (let i = 0; i < fv.length; i++) inBody[fv[i]] = 1;
    // how much of each vertex follows the arm
    const armBone = D.bones.map((b) => ARM.test(b.name));
    const armW = new Float32Array(nV);
    for (let v = 0; v < nV; v++) {
      let a = 0, s = 0;
      for (let k = 0; k < 8; k++) { const w = D.skinW[v * 8 + k]; s += w; if (armBone[D.skinIdx[v * 8 + k]]) a += w; }
      armW[v] = s ? a / s : 0;
    }
    const ai = D.maskNames.indexOf('aureolae');
    const sides = [1, -1].map((s) => {
      // apex: the areola's weighted centre on the base mesh
      let ax = 0, ay = 0, az = 0, aw = 0;
      const ar = [], arW = [];
      for (let v = 0; v < nV; v++) {
        const w = inBody[v] ? D.masks[v * 8 + ai] / 255 : 0;
        if (w < 0.05 || B[v * 3] * s <= 0 || B[v * 3 + 2] < 0) continue;
        ar.push(v); arW.push(w);
        ax += B[v * 3] * w; ay += B[v * 3 + 1] * w; az += B[v * 3 + 2] * w; aw += w;
      }
      ax /= aw; ay /= aw; az /= aw;
      // footprint: normalized radius R and direction (DU lateral+, DW up+)
      const idx = [], R = [], DU = [], DW = [], ringIdx = [], ringR = [];
      let rA = 0;
      for (let v = 0; v < nV; v++) {
        if (!inBody[v] || B[v * 3 + 2] < -0.2) continue;
        const u = B[v * 3] * s - ax * s, w = B[v * 3 + 1] - ay, dz = Math.max(0, az - B[v * 3 + 2] - FOOT.backOff);
        const ru = u / (u > 0 ? FOOT.lat : FOOT.med), rw = w / (w > 0 ? FOOT.up : FOOT.down), rz = dz / FOOT.back;
        const r = Math.sqrt(ru * ru + rw * rw + rz * rz);
        const keep = 1 - smooth(0.25, 0.6, armW[v]);
        if (r < 1.2 && keep > 0 && B[v * 3] * s > -0.02) {
          const l = Math.hypot(ru, rw) || 1;
          idx.push(v); R.push(r / keep); DU.push(ru / l); DW.push(rw / l);
        }
        if (r > 1.05 && r < 1.75 && armW[v] < 0.2 && B[v * 3] * s > -0.1) { ringIdx.push(v); ringR.push(r); }
        if (D.masks[v * 8 + ai] > 128 && B[v * 3] * s > 0) rA = Math.max(rA, r);
      }
      return {
        s, apex0: [ax, ay, az], ar: Int32Array.from(ar), arW: Float32Array.from(arW), rA,
        idx: Int32Array.from(idx), R: Float32Array.from(R), DU: Float32Array.from(DU), DW: Float32Array.from(DW),
        ringIdx: Int32Array.from(ringIdx), ringR: Float32Array.from(ringR),
        // per-morph scratch
        T: new Float32Array(idx.length),
      };
    });
    const S = { sides, glutes: prepGlutes(D, inBody) };
    return (D._shape = S);
  }

  // how much of a breast this body has, 0 (male chest) .. 1: MakeHuman's
  // macros grow breasts with the female weight, so follow the gender slider
  function breastWeight(p) {
    return smooth(0.22, 0.8, 1 - (p.gender ?? 0.5));
  }

  // smallest eigenvector of a symmetric 3x3 (power iteration on tr*I - C)
  function planeNormal(C, guess) {
    const tr = C[0] + C[4] + C[8];
    let n = guess.slice();
    for (let it = 0; it < 40; it++) {
      const x = tr * n[0] - (C[0] * n[0] + C[1] * n[1] + C[2] * n[2]);
      const y = tr * n[1] - (C[3] * n[0] + C[4] * n[1] + C[5] * n[2]);
      const z = tr * n[2] - (C[6] * n[0] + C[7] * n[1] + C[8] * n[2]);
      const l = Math.hypot(x, y, z) || 1;
      n = [x / l, y / l, z / l];
    }
    return n;
  }
  // least squares h = q0 + q1 a + q2 b + q3 a² + q4 b² + q5 ab (gently
  // regularized toward a plane), solved by Gaussian elimination
  function fitQuad(A, Bc, Hh, n) {
    const M = new Float64Array(36), y = new Float64Array(6), f = new Float64Array(6);
    for (let i = 0; i < n; i++) {
      const a = A[i], b = Bc[i];
      f[0] = 1; f[1] = a; f[2] = b; f[3] = a * a; f[4] = b * b; f[5] = a * b;
      for (let r = 0; r < 6; r++) { y[r] += f[r] * Hh[i]; for (let c = 0; c < 6; c++) M[r * 6 + c] += f[r] * f[c]; }
    }
    for (let r = 3; r < 6; r++) M[r * 6 + r] += 0.05 * n;
    for (let r = 1; r < 3; r++) M[r * 6 + r] += 1e-3 * n;
    for (let c = 0; c < 6; c++) {
      let piv = c;
      for (let r = c + 1; r < 6; r++) if (Math.abs(M[r * 6 + c]) > Math.abs(M[piv * 6 + c])) piv = r;
      if (piv !== c) { for (let k = 0; k < 6; k++) { const t = M[c * 6 + k]; M[c * 6 + k] = M[piv * 6 + k]; M[piv * 6 + k] = t; } const t = y[c]; y[c] = y[piv]; y[piv] = t; }
      const d = M[c * 6 + c] || 1e-9;
      for (let r = c + 1; r < 6; r++) {
        const k = M[r * 6 + c] / d;
        if (!k) continue;
        for (let j = c; j < 6; j++) M[r * 6 + j] -= k * M[c * 6 + j];
        y[r] -= k * y[c];
      }
    }
    const q = new Float64Array(6);
    for (let r = 5; r >= 0; r--) { let s = y[r]; for (let j = r + 1; j < 6; j++) s -= M[r * 6 + j] * q[j]; q[r] = s / (M[r * 6 + r] || 1e-9); }
    return q;
  }

  // dome profile: G(t) = sqrt(t(2-t)) - t lifts a straight cone slope onto a
  // quarter circle; 0 at the chest wall and at the apex, where f = t + kG has
  // slope 1 - k (k <= 1 keeps the surface from folding over)
  const domeG = (t) => Math.sqrt(t * (2 - t)) - t;

  // ------------------------------------------------------------ breasts
  const _A = new Float64Array(512), _B = new Float64Array(512), _H = new Float64Array(512);
  function breasts(S, D, p, P) {
    const F = breastWeight(p);
    BS.shapeInfo = { sides: [] };
    if (F < 0.01) return;
    const size = clamp(p.breastSize ?? 0.5, 0, 1), firm = clamp(p.breastFirmness ?? 0.5, 0, 1);
    const age = p.age ?? 28, ageK = smooth(30, 75, age);
    // support: 0 none .. 0.5 an everyday bra .. 1 a firm lift; the Chest
    // "Support" detail moves it, p.breastSupport overrides
    const support = clamp(p.breastSupport ?? 0.5 + 0.5 * det(p, 'breastsupport'), 0, 1);
    const roundK = det(p, 'breastround'), sideK = det(p, 'breastside');
    const fat = clamp(p.weight ?? 0.5, 0, 1);
    for (const sd of S.sides) {
      const s = sd.s;
      // current apex (areola centre)
      let ax = 0, ay = 0, az = 0, aw = 0;
      for (let i = 0; i < sd.ar.length; i++) {
        const v = sd.ar[i], w = sd.arW[i];
        ax += P[v * 3] * w; ay += P[v * 3 + 1] * w; az += P[v * 3 + 2] * w; aw += w;
      }
      ax /= aw; ay /= aw; az /= aw;
      // chest wall: plane + quadratic through the ring of skin around the breast
      // (bigger breasts spread wider, so the ring moves out with size)
      const r0 = 1.12 + 0.18 * size, r1 = r0 + 0.38;
      let cx = 0, cy = 0, cz = 0, cn = 0;
      for (let i = 0; i < sd.ringIdx.length; i++) {
        if (sd.ringR[i] < r0 || sd.ringR[i] > r1) continue;
        const v = sd.ringIdx[i] * 3;
        cx += P[v]; cy += P[v + 1]; cz += P[v + 2]; cn++;
      }
      if (cn < 12) continue;
      cx /= cn; cy /= cn; cz /= cn;
      const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < sd.ringIdx.length; i++) {
        if (sd.ringR[i] < r0 || sd.ringR[i] > r1) continue;
        const v = sd.ringIdx[i] * 3, d = [P[v] - cx, P[v + 1] - cy, P[v + 2] - cz];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a * 3 + b] += d[a] * d[b];
      }
      let n = planeNormal(C, [0.25 * s, -0.1, 1]);
      if ((ax - cx) * n[0] + (ay - cy) * n[1] + (az - cz) * n[2] < 0) n = [-n[0], -n[1], -n[2]];
      // breasts point forward and only slightly out (about 20 degrees at most)
      if (n[0] * s > 0.34) { n[0] = 0.34 * s; const l = Math.hypot(n[1], n[2]) / Math.sqrt(1 - 0.34 * 0.34); n[1] /= l; n[2] /= l; }
      // in-plane axes: e1 lateral (toward the armpit), e2 up
      let e1 = [s - n[0] * n[0] * s, -n[1] * n[0] * s, -n[2] * n[0] * s];
      let l = Math.hypot(e1[0], e1[1], e1[2]); e1 = [e1[0] / l, e1[1] / l, e1[2] / l];
      let e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
      if (e2[1] < 0) e2 = [-e2[0], -e2[1], -e2[2]];
      let m = 0;
      for (let i = 0; i < sd.ringIdx.length && m < 512; i++) {
        if (sd.ringR[i] < r0 || sd.ringR[i] > r1) continue;
        const v = sd.ringIdx[i] * 3, dx = P[v] - cx, dy = P[v + 1] - cy, dz = P[v + 2] - cz;
        _A[m] = dx * e1[0] + dy * e1[1] + dz * e1[2];
        _B[m] = dx * e2[0] + dy * e2[1] + dz * e2[2];
        _H[m] = dx * n[0] + dy * n[1] + dz * n[2];
        m++;
      }
      const q = fitQuad(_A, _B, _H, m);
      const wall = (a, b) => q[0] + q[1] * a + q[2] * b + q[3] * a * a + q[4] * b * b + q[5] * a * b;
      const hOf = (x, y, z) => {
        const dx = x - cx, dy = y - cy, dz = z - cz;
        return dx * n[0] + dy * n[1] + dz * n[2] - wall(dx * e1[0] + dy * e1[1] + dz * e1[2], dx * e2[0] + dy * e2[1] + dz * e2[2]);
      };
      const H = hOf(ax, ay, az);
      BS.shapeInfo.sides.push({ apex: [ax, ay, az], n, H, ring: [cx, cy, cz], ringN: m });
      if (H < 0.04) continue;

      // ---- shape parameters
      // roundness of the dome by direction: the lower pole fills out most,
      // the upper pole stays a slope (fuller with youth, firmness, support)
      const young = 1 - ageK;
      const kLow = F * clamp(0.62 + 0.18 * size + 0.12 * roundK, 0, 0.95);
      const kUp = F * clamp(0.12 + 0.18 * firm * young + 0.2 * support - 0.1 * ageK + 0.25 * roundK, 0, 0.8);
      const kLat = F * clamp(0.45 + 0.15 * size + 0.2 * sideK + 0.1 * fat, 0, 0.9);
      const kMed = F * clamp(0.32 + 0.12 * support + 0.1 * roundK, 0, 0.8);
      const kTip = F * clamp(0.88 + 0.06 * roundK, 0, 0.97);
      // side fullness: the lateral flank also swells toward the armpit
      const side = F * (0.08 + 0.08 * size + 0.12 * sideK);
      // gravity (fraction of the breast's projection) and support
      const sag = F * (0.06 + 0.16 * (1 - firm) + 0.14 * ageK) * (0.5 + 0.8 * size) * (1 - 0.6 * support);
      const lift = F * 0.1 * support * (0.6 + 0.4 * size);
      const toward = F * 0.05 * support;
      const tN = 0.95; // base of the nipple in t

      // ---- per vertex
      const T = sd.T;
      for (let i = 0; i < sd.idx.length; i++) {
        const o = sd.idx[i] * 3;
        T[i] = hOf(P[o], P[o + 1], P[o + 2]) / H;
      }
      for (let i = 0; i < sd.idx.length; i++) {
        const o = sd.idx[i] * 3, r = sd.R[i], du = sd.DU[i], dw = sd.DW[i];
        const fade = smooth(1.18, 0.8, r);
        if (fade <= 0) continue;
        const t = T[i];
        if (t <= 0) continue;
        // direction blend (common value near the apex)
        const wLow = smooth(0.05, -0.75, dw), wUp = smooth(-0.05, 0.75, dw), wLat = smooth(-0.1, 0.7, du), wMed = smooth(0.1, -0.7, du);
        const ws = wLow + wUp + wLat + wMed + 1e-6;
        const near = smooth(0.05, 0.45, r);
        let k = (kLow * wLow + kUp * wUp + kLat * wLat + kMed * wMed) / ws;
        // every direction rounds into the same smooth dome near the top
        const t0 = 0.45 + 0.25 * (wUp / ws);
        k += (kTip - k) * smooth(t0, 0.95, Math.min(t, 1));
        // soft start at the chest wall except under the breast (the fold)
        const lowN = (wLow / ws) * near;
        const base = lowN * smooth(0, 0.18, t) + (1 - lowN) * smooth(0, 0.5, t);
        // dome up to the nipple's base (tN); the nipple keeps its own relief on top
        // (scaled down, so it reads as a soft point under fabric, not a peg)
        const g = t < tN ? tN * domeG(t / tN) * base : -(t - tN) * 0.7 / Math.max(k, 0.05);
        const out = k * g * H * fade;
        // lateral swelling, strongest mid-flank
        const sw = side * H * fade * (wLat / ws) * near * 4 * t * (1 - Math.min(t, 1));
        // gravity and support move the mound as a whole, the base stays
        const mound = smooth(0, 0.9, Math.min(t, 1)) * fade;
        const dy = H * (lift - sag) * mound;
        const dx = -s * H * toward * mound;
        const x0 = P[o] * s;
        P[o] += n[0] * out + e1[0] * sw + dx;
        P[o + 1] += n[1] * out + e1[1] * sw + dy;
        P[o + 2] += n[2] * out + e1[2] * sw;
        // the cleavage never closes past the midline
        if (P[o] * s < 0.03 && x0 >= 0.03) P[o] = 0.03 * s;
      }
    }
  }

  // ------------------------------------------------------------ glutes
  // Static coordinates around each buttock on the base mesh: U lateral (+
  // toward the hip), W up, both ~1 at the edge; the gluteal fold runs along
  // W = foldW(U), level under the buttock and rising toward the hip.
  const GL = { cx: 0.72, cy: 0.25, lat: 0.62, med: 0.6, up: 1.0, down: 0.8 };
  const foldW = (u) => -0.98 + 0.3 * Math.max(0, u) * Math.max(0, u) + 0.05 * Math.min(0, u);
  function prepGlutes(D, inBody) {
    const B = D.base, idx = [], U = [], W = [], K = [];
    for (let v = 0; v < D.nV; v++) {
      if (!inBody[v]) continue;
      const x = B[v * 3], y = B[v * 3 + 1], z = B[v * 3 + 2], ax = Math.abs(x);
      const back = smooth(-0.05, -0.4, z);
      if (back <= 0 || y < -2.2 || y > 1.9 || ax > 2.0) continue;
      const u = (ax - GL.cx) / (ax > GL.cx ? GL.lat : GL.med), w = (y - GL.cy) / (y > GL.cy ? GL.up : GL.down);
      if (u * u + w * w > 2.6) continue;
      // keep the cleft between the buttocks as it is
      const cleft = smooth(0.03, 0.28, ax);
      idx.push(v); U.push(u); W.push(w); K.push(back * cleft * (x < 0 ? -1 : 1));
    }
    return { idx: Int32Array.from(idx), U: Float32Array.from(U), W: Float32Array.from(W), K: Float32Array.from(K) };
  }
  function glutes(S, D, p, P) {
    const G = S.glutes;
    if (!G) return;
    const fem = smooth(0.15, 0.85, 1 - (p.gender ?? 0.5)), fat = clamp(p.weight ?? 0.5, 0, 1), mus = clamp(p.muscle ?? 0.5, 0, 1);
    const gl = det(p, 'glutes'), lift = det(p, 'buttlift'), round = det(p, 'buttround');
    const ageK = smooth(35, 80, p.age ?? 28);
    // overall size of the buttock's correction scales with the body (dm)
    const scale = 0.85 + 0.3 * fat + 0.15 * fem;
    // fuller and rounder, the mass sitting in the lower half
    const full = scale * clamp(0.05 + 0.05 * fem + 0.05 * gl + 0.04 * (fat - 0.5) + 0.03 * mus + 0.05 * round, 0, 0.22);
    // where the fullest point sits (W): lower with age and softness, higher with lift
    const peakW = -0.28 + 0.22 * lift - 0.15 * ageK;
    // the fold under the buttock: deeper with fat, softness and size, softer with lift
    const fold = scale * clamp((0.035 + 0.05 * fat + 0.025 * fem + 0.03 * ageK + 0.02 * Math.max(0, gl) - 0.015 * mus) * (1 - 0.35 * lift), 0, 0.14);
    // a lifted buttock is also slightly shorter and tucks the fold up
    const sagY = scale * (0.03 * ageK + 0.015 * fat - 0.03 * lift);
    for (let i = 0; i < G.idx.length; i++) {
      const o = G.idx[i] * 3, u = G.U[i], w = G.W[i], k = G.K[i], kk = Math.abs(k);
      // fullness: a soft dome over the buttock, peak below centre
      const wu = w - peakW, ru = u * u + (wu * wu) / (wu > 0 ? 1.25 * 1.25 : 0.85 * 0.85);
      const dome = ru < 1 ? (1 - ru) * (1 - ru) : 0;
      // the fold: the underside bulges back and down over it, the skin just
      // below it (top of the thigh) tucks in a little
      const fd = w - foldW(u);
      const along = smooth(1.05, 0.55, u) * smooth(-1.05, -0.6, u);
      const over = along * Math.max(0, 1 - ((fd - 0.24) / 0.3) ** 2);
      const under = along * Math.max(0, 1 - ((fd + 0.1) / 0.22) ** 2);
      const dz = -full * dome - fold * (0.55 * over - 0.45 * under);
      const dy = -sagY * dome - fold * 0.35 * over;
      P[o + 1] += dy * kk;
      P[o + 2] += dz * kk;
    }
  }

  BS.shapeCorrect = function (D, p, P) {
    if (OFF) return;
    const S = prep(D);
    breasts(S, D, p, P);
    glutes(S, D, p, P);
  };
})();
