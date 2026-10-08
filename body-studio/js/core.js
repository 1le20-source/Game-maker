// Body Studio core: decodes the MakeHuman data, morphs the base mesh, smooths
// it with Catmull-Clark subdivision and fits MakeHuman's 163-bone skeleton.
// Everything here is plain math on typed arrays; three.js objects are built
// in human.js.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  BS.SCALE = 0.1; // MakeHuman works in decimeters

  // ---------------------------------------------------------------- data
  BS.loadData = async function () {
    const { meta, bin } = window.BODY_DATA;
    const raw = atob(bin);
    const gz = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) gz[i] = raw.charCodeAt(i);
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser is too old for Body Studio (no DecompressionStream).');
    const buf = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const T = { float32: Float32Array, uint16: Uint16Array, uint8: Uint8Array, int16: Int16Array };
    const get = (name) => {
      const [off, n, dt] = meta.sections[name];
      return new T[dt](buf, off, n);
    };
    const D = { meta, nV: meta.nVerts, base: get('coords'), uvs: get('uvs'), masks: get('masks'), maskNames: meta.masks };
    D.groups = {};
    for (const g in meta.groups) D.groups[g] = { fv: get('f:' + g), ft: get('ft:' + g), n: meta.groups[g] };
    D.skinIdx = get('skin:idx');
    D.skinW = get('skin:w');
    D.bones = meta.bones;
    D.joints = meta.joints;
    D.boneIndex = {};
    meta.bones.forEach((b, i) => (D.boneIndex[b.name] = i));
    D.faceUnits = meta.faceUnits;
    D.bodyUnits = meta.bodyUnits;

    // morph targets: delta-coded indices + int16 split into byte planes
    const tIdx = get('t:idx'), lo = get('t:lo'), hi = get('t:hi');
    D.targets = {};
    let p = 0;
    for (const [name, n, scale] of meta.targets) {
      const idx = new Uint16Array(n);
      const d = new Float32Array(n * 3);
      let acc = 0;
      for (let i = 0; i < n; i++) {
        acc += tIdx[p + i];
        idx[i] = acc;
      }
      const q = p * 3;
      for (let i = 0; i < n * 3; i++) {
        const v = ((hi[q + i] << 8) | lo[q + i]) << 16 >> 16;
        d[i] = v * scale;
      }
      D.targets[name] = { idx, d };
      p += n;
    }
    D.eye = Object.assign({}, meta.eye, {
      refs: get('eye:refs'), w: get('eye:w'), off: get('eye:off'), uv: get('eye:uv'), tris: get('eye:tris'),
    });
    return D;
  };

  // ------------------------------------------------------------ morphing
  // Body parameters follow MakeHuman's macro system (gender/age/muscle/weight
  // blend 36 scanned-shape targets; height, proportions, ethnicity and breast
  // shape add more) plus the detail sliders defined in BS.DETAILS.
  BS.ageValue = (years) => (years < 25 ? 0.5 : 0.5 + (years - 25) / 130);
  const tri = (v) => {
    // MakeHuman's min / average / max split of a 0..1 slider
    const max = Math.max(0, v * 2 - 1), min = Math.max(0, 1 - v * 2);
    return { min, average: 1 - max - min, max };
  };
  const tri2 = (v) => {
    const max = Math.max(0, v * 2 - 1), min = Math.max(0, 1 - v * 2);
    return { min, average: max > min ? 1 - max : 1 - min, max };
  };

  BS.targetWeights = function (p) {
    const out = [];
    const g = { female: 1 - p.gender, male: p.gender };
    const age = BS.ageValue(p.age);
    const old = Math.max(0, age * 2 - 1);
    const a = { young: 1 - old, old };
    const m = tri(p.muscle), w = tri(p.weight);
    for (const gk in g) for (const ak in a) {
      const ga = g[gk] * a[ak];
      if (ga < 1e-4) continue;
      for (const mk in m) for (const wk in w) {
        const v = ga * m[mk] * w[wk];
        if (v > 1e-4) out.push([`macrodetails/universal-${gk}-${ak}-${mk}muscle-${wk}weight`, v]);
      }
      const eth = { african: p.african, asian: p.asian, caucasian: p.caucasian };
      const et = eth.african + eth.asian + eth.caucasian || 1;
      for (const ek in eth) if (eth[ek] > 1e-4) out.push([`macrodetails/${ek}-${gk}-${ak}`, (ga * eth[ek]) / et]);
      const h = tri2(p.height);
      if (h.min > 1e-4) out.push([`macrodetails/height/${gk}-${ak}-averagemuscle-averageweight-minheight`, ga * h.min]);
      if (h.max > 1e-4) out.push([`macrodetails/height/${gk}-${ak}-averagemuscle-averageweight-maxheight`, ga * h.max]);
      const pr = tri2(p.proportions);
      if (pr.min > 1e-4) out.push([`macrodetails/proportions/${gk}-${ak}-averagemuscle-averageweight-uncommonproportions`, ga * pr.min]);
      if (pr.max > 1e-4) out.push([`macrodetails/proportions/${gk}-${ak}-averagemuscle-averageweight-idealproportions`, ga * pr.max]);
    }
    // breast shape applies to any gender (MakeHuman gates it on "female")
    const c = tri2(p.breastSize), f = tri2(p.breastFirmness);
    for (const ak in a) for (const ck in c) for (const fk in f) {
      if (ck === 'average' && fk === 'average') continue;
      const v = a[ak] * c[ck] * f[fk];
      if (v > 1e-4) out.push([`breast/female-${ak}-averagemuscle-averageweight-${ck}cup-${fk}firmness`, v]);
    }
    for (const def of BS.DETAILS) {
      const v = (p.details && p.details[def.key]) || 0;
      if (Math.abs(v) < 1e-3) continue;
      const list = v < 0 ? def.neg : def.pos;
      if (list) for (const t of list) out.push([t, Math.abs(v)]);
    }
    return out;
  };

  BS.morph = function (D, p, out) {
    const P = out || new Float32Array(D.base.length);
    P.set(D.base);
    for (const [name, w] of BS.targetWeights(p)) {
      const t = D.targets[name];
      if (!t) continue;
      const { idx, d } = t;
      for (let i = 0, n = idx.length; i < n; i++) {
        const o = idx[i] * 3, q = i * 3;
        P[o] += d[q] * w;
        P[o + 1] += d[q + 1] * w;
        P[o + 2] += d[q + 2] * w;
      }
    }
    return P;
  };

  // ------------------------------------------- Catmull-Clark subdivision
  // Built once as linear stencils (new vertex = weighted sum of base
  // vertices), so re-smoothing after every slider move is one sparse pass.
  BS.buildSubdivision = function (D, fv) {
    const nF = fv.length / 4;
    const used = new Int32Array(D.nV).fill(-1);
    const vlist = [];
    for (let i = 0; i < fv.length; i++) if (used[fv[i]] < 0) { used[fv[i]] = vlist.length; vlist.push(fv[i]); }
    const nV = vlist.length;
    // edges
    const emap = new Map();
    const edges = []; // [a, b, f0, f1]
    const faceEdges = new Int32Array(nF * 4);
    for (let f = 0; f < nF; f++) for (let k = 0; k < 4; k++) {
      const a = fv[f * 4 + k], b = fv[f * 4 + ((k + 1) & 3)];
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let e = emap.get(key);
      if (e === undefined) { e = edges.length; emap.set(key, e); edges.push([a, b, f, -1, 0]); }
      else if (edges[e][3] < 0) edges[e][3] = f;
      else edges[e][4] = 1; // non-manifold: treat like a boundary
      faceEdges[f * 4 + k] = e;
    }
    const nE = edges.length;
    const isBoundary = (e) => edges[e][3] < 0 || edges[e][4];
    const vFaces = Array.from({ length: nV }, () => []);
    const vEdges = Array.from({ length: nV }, () => []);
    for (let f = 0; f < nF; f++) for (let k = 0; k < 4; k++) vFaces[used[fv[f * 4 + k]]].push(f);
    for (let e = 0; e < nE; e++) { vEdges[used[edges[e][0]]].push(e); vEdges[used[edges[e][1]]].push(e); }

    // sparse stencils
    const nOut = nV + nE + nF;
    const st = new Array(nOut);
    const add = (m, v, w) => m.set(v, (m.get(v) || 0) + w);
    const faceSt = (f) => { const m = new Map(); for (let k = 0; k < 4; k++) add(m, fv[f * 4 + k], 0.25); return m; };
    for (let f = 0; f < nF; f++) st[nV + nE + f] = faceSt(f);
    for (let e = 0; e < nE; e++) {
      const [a, b, f0, f1] = edges[e];
      const m = new Map();
      if (isBoundary(e)) { add(m, a, 0.5); add(m, b, 0.5); }
      else {
        add(m, a, 0.25); add(m, b, 0.25);
        for (const f of [f0, f1]) for (let k = 0; k < 4; k++) add(m, fv[f * 4 + k], 1 / 16);
      }
      st[nV + e] = m;
    }
    for (let i = 0; i < nV; i++) {
      const v = vlist[i];
      const m = new Map();
      const bEdges = vEdges[i].filter(isBoundary);
      if (bEdges.length) {
        if (bEdges.length === 2) {
          add(m, v, 0.75);
          for (const e of bEdges) add(m, edges[e][0] === v ? edges[e][1] : edges[e][0], 0.125);
        } else add(m, v, 1);
      } else {
        const n = vEdges[i].length;
        // (F + 2R + (n-3)P) / n with F = mean face point, R = mean edge midpoint
        for (const f of vFaces[i]) for (let k = 0; k < 4; k++) add(m, fv[f * 4 + k], 0.25 / vFaces[i].length / n);
        for (const e of vEdges[i]) { add(m, edges[e][0], 1 / n / n); add(m, edges[e][1], 1 / n / n); }
        add(m, v, (n - 3) / n);
      }
      st[i] = m;
    }
    let total = 0;
    for (const m of st) total += m.size;
    const off = new Int32Array(nOut + 1), src = new Uint16Array(total), wt = new Float32Array(total);
    let q = 0;
    for (let i = 0; i < nOut; i++) {
      off[i] = q;
      for (const [v, w] of st[i]) { src[q] = v; wt[q] = w; q++; }
    }
    off[nOut] = q;

    // new faces: every quad splits in four around its face point
    const tris = new Uint32Array(nF * 4 * 6);
    let t = 0;
    for (let f = 0; f < nF; f++) {
      const fp = nV + nE + f;
      for (let k = 0; k < 4; k++) {
        const c = used[fv[f * 4 + k]];
        const eN = nV + faceEdges[f * 4 + k];
        const eP = nV + faceEdges[f * 4 + ((k + 3) & 3)];
        tris[t++] = c; tris[t++] = eN; tris[t++] = fp;
        tris[t++] = c; tris[t++] = fp; tris[t++] = eP;
      }
    }
    return { nOut, off, src, wt, tris, vlist, nBaseUsed: nV };
  };

  // same structure as buildSubdivision but without smoothing: the base mesh
  // as-is (quads split in two), for distant people
  BS.identityStencil = function (D, fv) {
    const used = new Int32Array(D.nV).fill(-1);
    const vlist = [];
    for (let i = 0; i < fv.length; i++) if (used[fv[i]] < 0) { used[fv[i]] = vlist.length; vlist.push(fv[i]); }
    const nOut = vlist.length;
    const off = new Int32Array(nOut + 1), src = new Uint16Array(nOut), wt = new Float32Array(nOut).fill(1);
    for (let i = 0; i < nOut; i++) { off[i] = i; src[i] = vlist[i]; }
    off[nOut] = nOut;
    const nF = fv.length / 4, tris = new Uint32Array(nF * 6);
    for (let f = 0; f < nF; f++) {
      const a = used[fv[f * 4]], b = used[fv[f * 4 + 1]], c = used[fv[f * 4 + 2]], d = used[fv[f * 4 + 3]];
      tris.set([a, b, c, a, c, d], f * 6);
    }
    return { nOut, off, src, wt, tris, vlist, nBaseUsed: nOut };
  };

  // apply stencils to any per-vertex data with `dim` channels
  BS.applyStencil = function (S, data, dim, out) {
    const r = out || new Float32Array(S.nOut * dim);
    const { off, src, wt } = S;
    for (let i = 0; i < S.nOut; i++) {
      for (let c = 0; c < dim; c++) {
        let s = 0;
        for (let k = off[i]; k < off[i + 1]; k++) s += wt[k] * data[src[k] * dim + c];
        r[i * dim + c] = s;
      }
    }
    return r;
  };
  BS.applyStencil3 = function (S, P, out) {
    const r = out || new Float32Array(S.nOut * 3);
    const { off, src, wt } = S;
    for (let i = 0; i < S.nOut; i++) {
      let x = 0, y = 0, z = 0;
      for (let k = off[i], e = off[i + 1]; k < e; k++) {
        const w = wt[k], s = src[k] * 3;
        x += w * P[s]; y += w * P[s + 1]; z += w * P[s + 2];
      }
      r[i * 3] = x; r[i * 3 + 1] = y; r[i * 3 + 2] = z;
    }
    return r;
  };

  // skin weights through the stencils, keeping the 8 strongest bones
  BS.subdivideWeights = function (S, D) {
    const idx = new Uint16Array(S.nOut * 8), wts = new Float32Array(S.nOut * 8);
    const acc = new Map();
    for (let i = 0; i < S.nOut; i++) {
      acc.clear();
      for (let k = S.off[i]; k < S.off[i + 1]; k++) {
        const v = S.src[k], w = S.wt[k];
        for (let j = 0; j < 8; j++) {
          const bw = D.skinW[v * 8 + j];
          if (!bw) continue;
          const b = D.skinIdx[v * 8 + j];
          acc.set(b, (acc.get(b) || 0) + (w * bw) / 65535);
        }
      }
      const arr = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 8);
      let tot = 0;
      for (const [, w] of arr) tot += w;
      arr.forEach(([b, w], j) => { idx[i * 8 + j] = b; wts[i * 8 + j] = w / tot; });
    }
    return { idx, wts };
  };

  BS.computeNormals = function (P, tris, out) {
    const N = out || new Float32Array(P.length);
    N.fill(0);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
      N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
      N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
    }
    for (let i = 0; i < N.length; i += 3) {
      const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
      N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
    }
    return N;
  };

  // ------------------------------------------------------------ skeleton
  // Joint = mean of its helper vertices; bone frame per MakeHuman's
  // skeleton.getMatrix: Y along the bone, X from the roll-plane normal.
  BS.fitSkeleton = function (D, P, toWorld) {
    const J = D.joints.map((vs) => {
      let x = 0, y = 0, z = 0;
      for (const v of vs) { x += P[v * 3]; y += P[v * 3 + 1]; z += P[v * 3 + 2]; }
      return toWorld([x / vs.length, y / vs.length, z / vs.length]);
    });
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    return D.bones.map((b) => {
      const head = J[b.head], tail = J[b.tail];
      let n = [0, 0, 0], cnt = 0;
      for (const [j1, j2, j3] of b.planes) {
        const pv = norm(sub(J[j2], J[j1])), yv = norm(sub(J[j3], J[j2]));
        const c = cross(yv, pv);
        if (Math.hypot(c[0], c[1], c[2]) > 1e-6) { const cn = norm(c); n[0] += cn[0]; n[1] += cn[1]; n[2] += cn[2]; cnt++; }
      }
      n = cnt ? norm(n) : [0, 1, 0];
      const y = norm(sub(tail, head));
      let z = cross(n, y);
      if (Math.hypot(z[0], z[1], z[2]) < 1e-6) z = cross([1, 0, 0], y);
      z = norm(z);
      const x = norm(cross(y, z));
      return { head, tail, x, y, z, length: Math.hypot(...sub(tail, head)) };
    });
  };
})();
