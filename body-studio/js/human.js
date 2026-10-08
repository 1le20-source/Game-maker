// Body Studio human: turns the morphed MakeHuman mesh into a skinned three.js
// character (smoothed skin, eyes, teeth, tongue, lashes) on the default rig.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const THREE = window.THREE;

  // ---- 8-bone skinning: MakeHuman's face rig needs more than three's 4
  const SKIN8_PARS = `#include <skinning_pars_vertex>
#ifdef USE_SKINNING
attribute vec4 skinIndex2;
attribute vec4 skinWeight2;
#endif`;
  const SKIN8_BASE = `#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
	mat4 boneMatX2 = getBoneMatrix( skinIndex2.x );
	mat4 boneMatY2 = getBoneMatrix( skinIndex2.y );
	mat4 boneMatZ2 = getBoneMatrix( skinIndex2.z );
	mat4 boneMatW2 = getBoneMatrix( skinIndex2.w );
	mat4 skinMatrix8 = skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ + skinWeight.w * boneMatW
		+ skinWeight2.x * boneMatX2 + skinWeight2.y * boneMatY2 + skinWeight2.z * boneMatZ2 + skinWeight2.w * boneMatW2;
#endif`;
  const SKIN8_NORMAL = `#ifdef USE_SKINNING
	mat4 skinMatrix = bindMatrixInverse * skinMatrix8 * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`;
  const SKIN8_VERTEX = `#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	transformed = ( bindMatrixInverse * ( skinMatrix8 * skinVertex ) ).xyz;
#endif`;
  BS.skin8 = function (src) {
    return src
      .replace('#include <skinning_pars_vertex>', SKIN8_PARS)
      .replace('#include <skinbase_vertex>', SKIN8_BASE)
      .replace('#include <skinnormal_vertex>', SKIN8_NORMAL)
      .replace('#include <skinning_vertex>', SKIN8_VERTEX);
  };
  // chain an onBeforeCompile hook so several features can patch one material
  BS.patch = function (mat, key, fn) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (shader, renderer) {
      if (prev) prev.call(this, shader, renderer);
      fn(shader, renderer);
    };
    const prevKey = mat.customProgramCacheKey;
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|' + key; };
    return mat;
  };
  BS.skinned8 = (mat) => BS.patch(mat, 'skin8', (s) => { s.vertexShader = BS.skin8(s.vertexShader); });
  BS.depthMaterials = function (mesh) {
    // shadows need the same 8-bone skinning or faces would flicker
    mesh.customDepthMaterial = BS.skinned8(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    mesh.customDistanceMaterial = BS.skinned8(new THREE.MeshDistanceMaterial());
  };

  function setSkinAttributes(geo, idx, wts, n) {
    const i1 = new Uint16Array(n * 4), i2 = new Uint16Array(n * 4), w1 = new Float32Array(n * 4), w2 = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) for (let k = 0; k < 4; k++) {
      i1[v * 4 + k] = idx[v * 8 + k]; w1[v * 4 + k] = wts[v * 8 + k];
      i2[v * 4 + k] = idx[v * 8 + 4 + k]; w2[v * 4 + k] = wts[v * 8 + 4 + k];
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(i1, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w1, 4));
    geo.setAttribute('skinIndex2', new THREE.Uint16BufferAttribute(i2, 4));
    geo.setAttribute('skinWeight2', new THREE.Float32BufferAttribute(w2, 4));
  }
  BS.setSkinAttributes = setSkinAttributes;

  // Mesh data every human shares (topology, skin weights, region masks): built
  // once per detail level and reused, so a crowd costs only positions.
  // smooth = Catmull-Clark (54k vertices); otherwise the MakeHuman base
  // mesh (13k vertices), for distant people in a game.
  const SHARED = {};
  function sharedBody(D, smooth) {
    const key = smooth ? 'smooth' : 'base';
    if (SHARED[key]) return SHARED[key];
    const S = smooth ? BS.buildSubdivision(D, D.groups.body.fv) : BS.identityStencil(D, D.groups.body.fv);
    const sw = BS.subdivideWeights(S, D);
    const maskF = new Float32Array(D.nV * 8);
    for (let i = 0; i < maskF.length; i++) maskF[i] = D.masks[i] / 255;
    const M = BS.applyStencil(S, maskF, 8), n = S.nOut;
    // regions: lips, eyelids, face, ears | nails (fingers+toes), areola, mouth inside
    const reg1 = new Float32Array(n * 4), reg2 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      reg1[i * 4] = M[i * 8]; reg1[i * 4 + 1] = M[i * 8 + 1]; reg1[i * 4 + 2] = M[i * 8 + 2]; reg1[i * 4 + 3] = M[i * 8 + 3];
      reg2[i * 4] = Math.max(M[i * 8 + 4], M[i * 8 + 5]); reg2[i * 4 + 1] = M[i * 8 + 6]; reg2[i * 4 + 2] = M[i * 8 + 7];
    }
    const tmp = new THREE.BufferGeometry();
    setSkinAttributes(tmp, sw.idx, sw.wts, n);
    const attrs = {
      skinIndex: tmp.attributes.skinIndex, skinWeight: tmp.attributes.skinWeight,
      skinIndex2: tmp.attributes.skinIndex2, skinWeight2: tmp.attributes.skinWeight2,
      region: new THREE.Float32BufferAttribute(reg1, 4), region2: new THREE.Float32BufferAttribute(reg2, 4),
    };
    return (SHARED[key] = { S, sw, masks: M, attrs, index: new THREE.BufferAttribute(S.tris, 1) });
  }

  // free one human's body buffers without touching the shared ones (other
  // humans still draw with those)
  function releaseBodyGeometry(geo) {
    for (const k of ['skinIndex', 'skinWeight', 'skinIndex2', 'skinWeight2', 'region', 'region2']) geo.deleteAttribute(k);
    geo.setIndex(null);
    geo.dispose();
  }

  class Human {
    // opts.smooth (default true): see sharedBody
    constructor(D, opts = {}) {
      this.D = D;
      this.opts = opts;
      this.group = new THREE.Group();
      this.P = new Float32Array(D.base.length); // morphed base mesh (dm)
      this.ground = 0;
      this._buildBodyGeometry(opts.smooth !== false);

      // skeleton
      this.bones = D.bones.map((b) => { const o = new THREE.Bone(); o.name = b.name; return o; });
      D.bones.forEach((b, i) => { if (b.parent >= 0) this.bones[b.parent].add(this.bones[i]); });
      this.rootBones = this.bones.filter((_, i) => D.bones[i].parent < 0);
      this.skeleton = new THREE.Skeleton(this.bones);
      this.restQuat = this.bones.map(() => new THREE.Quaternion());
      this.restPos = this.bones.map(() => new THREE.Vector3());
      this.restGlobal = this.bones.map(() => new THREE.Matrix4());
      this.restGlobalQuat = this.bones.map(() => new THREE.Quaternion());
      this.pose = this.bones.map(() => new THREE.Quaternion());
      this.boneMats = this.bones.map(() => new THREE.Matrix4());
      this.rootOffset = new THREE.Vector3();

      this.skinMat = BS.makeSkinMaterial ? BS.makeSkinMaterial(this) : BS.skinned8(new THREE.MeshStandardMaterial({ color: 0xd8a888, roughness: 0.5 }));
      const body = (this.body = new THREE.SkinnedMesh(this.bodyGeo, this.skinMat));
      body.name = 'skin';
      body.frustumCulled = false;
      body.castShadow = body.receiveShadow = true;
      BS.depthMaterials(body);
      this.rootBones.forEach((b) => body.add(b));
      body.bind(this.skeleton, new THREE.Matrix4());
      this.group.add(body);

      this.shapeListeners = [];
      this.parts = [];
      this._buildHelpers();
      this._buildEyes();
    }

    _buildBodyGeometry(smooth) {
      const sh = sharedBody(this.D, smooth);
      this.smooth = smooth;
      this.S = sh.S;
      this.subWeights = sh.sw;
      this.masks = sh.masks;
      const n = sh.S.nOut;
      const geo = (this.bodyGeo = new THREE.BufferGeometry());
      this.bodyPos = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
      this.bodyNrm = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
      this.restAttr = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
      geo.setAttribute('position', this.bodyPos);
      geo.setAttribute('normal', this.bodyNrm);
      geo.setAttribute('restPos', this.restAttr);
      for (const k in sh.attrs) geo.setAttribute(k, sh.attrs[k]);
      geo.setIndex(sh.index);
    }

    // switch detail level; bodyGeo, S, subWeights and masks are replaced, so
    // anything built on them must be rebuilt (the shape listeners run again)
    setSmooth(smooth) {
      if (smooth === this.smooth) return;
      const old = this.bodyGeo;
      this._buildBodyGeometry(smooth);
      this.body.geometry = this.bodyGeo;
      releaseBodyGeometry(old);
      if (this.params) this.setParams(this.params);
    }

    dispose() {
      this.group.traverse((o) => {
        if (o.geometry && o.geometry !== this.bodyGeo) o.geometry.dispose();
        if (o.material) for (const m of [].concat(o.material)) { if (m.map) m.map.dispose(); m.dispose(); }
      });
      releaseBodyGeometry(this.bodyGeo);
      if (this.skeleton.boneTexture) this.skeleton.dispose();
      if (this.group.parent) this.group.parent.remove(this.group);
    }

    // helper groups rendered as-is (not smoothed): teeth, tongue, lashes
    _helperMesh(names, mat, name) {
      const D = this.D;
      const verts = new Map(), list = [];
      const idx = [];
      for (const g of names) {
        const fv = D.groups[g].fv;
        for (let f = 0; f < fv.length / 4; f++) {
          const q = [0, 1, 2, 3].map((k) => {
            const v = fv[f * 4 + k];
            if (!verts.has(v)) { verts.set(v, list.length); list.push(v); }
            return verts.get(v);
          });
          idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
        }
      }
      const geo = new THREE.BufferGeometry();
      const n = list.length;
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      geo.setIndex(idx);
      const si = new Uint16Array(n * 8), sw = new Float32Array(n * 8);
      list.forEach((v, i) => { for (let k = 0; k < 8; k++) { si[i * 8 + k] = D.skinIdx[v * 8 + k]; sw[i * 8 + k] = D.skinW[v * 8 + k] / 65535; } });
      setSkinAttributes(geo, si, sw, n);
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.bind(this.skeleton, new THREE.Matrix4());
      this.group.add(mesh);
      const part = { mesh, list, tris: new Uint32Array(idx) };
      this.parts.push(part);
      return part;
    }

    _buildHelpers() {
      const teethMat = BS.skinned8(new THREE.MeshPhysicalMaterial({ color: 0xf2ece0, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.3, sheenColor: new THREE.Color(0xffffff) }));
      const tongueMat = BS.skinned8(new THREE.MeshPhysicalMaterial({ color: 0xb85a5e, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
      this.teeth = this._helperMesh(['helper-upper-teeth', 'helper-lower-teeth'], teethMat, 'teeth');
      this.tongue = this._helperMesh(['helper-tongue'], tongueMat, 'tongue');
    }

    _buildEyes() {
      const E = this.D.eye;
      const n = E.nVerts;
      const geo = new THREE.BufferGeometry();
      // un-index so every corner keeps its own UV
      const tc = E.tris.length / 2;
      const pos = new Float32Array(tc * 3), uv = new Float32Array(tc * 2);
      for (let i = 0; i < tc; i++) {
        const t = E.tris[i * 2 + 1];
        uv[i * 2] = E.uv[t * 2]; uv[i * 2 + 1] = E.uv[t * 2 + 1];
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      // skin weights from the reference body vertices
      const si = new Uint16Array(tc * 8), sw = new Float32Array(tc * 8);
      const vw = [];
      for (let v = 0; v < n; v++) {
        const acc = new Map();
        for (let r = 0; r < 3; r++) {
          const ref = E.refs[v * 3 + r], w = E.w[v * 3 + r];
          for (let k = 0; k < 8; k++) {
            const bw = this.D.skinW[ref * 8 + k];
            if (bw) { const b = this.D.skinIdx[ref * 8 + k]; acc.set(b, (acc.get(b) || 0) + (w * bw) / 65535); }
          }
        }
        const arr = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 8);
        const tot = arr.reduce((s, x) => s + x[1], 0) || 1;
        vw.push(arr.map(([b, w]) => [b, w / tot]));
      }
      for (let i = 0; i < tc; i++) {
        const v = E.tris[i * 2];
        vw[v].forEach(([b, w], k) => { si[i * 8 + k] = b; sw[i * 8 + k] = w; });
      }
      setSkinAttributes(geo, si, sw, tc);
      this.eyeMat = BS.makeEyeMaterial ? BS.makeEyeMaterial() : BS.skinned8(new THREE.MeshStandardMaterial({ color: 0xffffff }));
      const mesh = (this.eyes = new THREE.SkinnedMesh(geo, this.eyeMat));
      mesh.name = 'eyes';
      mesh.frustumCulled = false;
      mesh.bind(this.skeleton, new THREE.Matrix4());
      this.group.add(mesh);
    }

    toWorld(v) { return [v[0] * BS.SCALE, v[1] * BS.SCALE - this.ground, v[2] * BS.SCALE]; }

    setParams(p) {
      this.params = p;
      const D = this.D, P = BS.morph(D, p, this.P);
      // stand on y = 0
      let minY = Infinity;
      const fv = D.groups.body.fv;
      for (let i = 0; i < fv.length; i++) minY = Math.min(minY, P[fv[i] * 3 + 1]);
      this.ground = minY * BS.SCALE;
      const S = this.S;
      const sp = BS.applyStencil3(S, P, this.bodyPos.array);
      for (let i = 0; i < sp.length; i += 3) { sp[i] *= BS.SCALE; sp[i + 1] = sp[i + 1] * BS.SCALE - this.ground; sp[i + 2] *= BS.SCALE; }
      BS.computeNormals(sp, S.tris, this.bodyNrm.array);
      this.restAttr.array.set(sp);
      this.bodyPos.needsUpdate = this.bodyNrm.needsUpdate = this.restAttr.needsUpdate = true;
      this.bodyGeo.computeBoundingSphere();
      for (const part of this.parts) {
        const pa = part.mesh.geometry.attributes.position;
        part.list.forEach((v, i) => { pa.array[i * 3] = P[v * 3] * BS.SCALE; pa.array[i * 3 + 1] = P[v * 3 + 1] * BS.SCALE - this.ground; pa.array[i * 3 + 2] = P[v * 3 + 2] * BS.SCALE; });
        BS.computeNormals(pa.array, part.tris, part.mesh.geometry.attributes.normal.array);
        pa.needsUpdate = part.mesh.geometry.attributes.normal.needsUpdate = true;
      }
      this._fitEyes(P);
      this._fitSkeleton(P);
      for (const fn of this.shapeListeners) fn(this, P);
    }

    // fn(human, morphedBaseDm) runs after every shape change (skeleton refit done)
    addShapeListener(fn) { this.shapeListeners.push(fn); }

    _fitEyes(P) {
      const E = this.D.eye;
      const sc = {};
      ['x', 'y', 'z'].forEach((a, ai) => { const [v1, v2, den] = E.scales[a]; sc[a] = Math.abs(P[v1 * 3 + ai] - P[v2 * 3 + ai]) / den; });
      const n = E.nVerts, co = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let r = 0; r < 3; r++) s += E.w[v * 3 + r] * P[E.refs[v * 3 + r] * 3 + c];
          co[v * 3 + c] = s + E.off[v * 3 + c] * sc['xyz'[c]];
        }
      }
      const pos = this.eyes.geometry.attributes.position;
      const tc = E.tris.length / 2;
      for (let i = 0; i < tc; i++) {
        const v = E.tris[i * 2];
        pos.array[i * 3] = co[v * 3] * BS.SCALE;
        pos.array[i * 3 + 1] = co[v * 3 + 1] * BS.SCALE - this.ground;
        pos.array[i * 3 + 2] = co[v * 3 + 2] * BS.SCALE;
      }
      pos.needsUpdate = true;
      this.eyes.geometry.computeVertexNormals();
    }

    _fitSkeleton(P) {
      const fit = (this.fit = BS.fitSkeleton(this.D, P, (v) => this.toWorld(v)));
      const m = new THREE.Matrix4(), inv = new THREE.Matrix4(), s = new THREE.Vector3();
      fit.forEach((b, i) => {
        const g = this.restGlobal[i];
        g.set(b.x[0], b.y[0], b.z[0], b.head[0], b.x[1], b.y[1], b.z[1], b.head[1], b.x[2], b.y[2], b.z[2], b.head[2], 0, 0, 0, 1);
        this.restGlobalQuat[i].setFromRotationMatrix(g);
        const par = this.D.bones[i].parent;
        if (par >= 0) m.copy(inv.copy(this.restGlobal[par]).invert()).multiply(g);
        else m.copy(g);
        m.decompose(this.restPos[i], this.restQuat[i], s);
      });
      // inverse bind matrices from the rest frames in the human's own space, so
      // re-shaping works wherever the group sits (a game moves and scales it)
      this.bones.forEach((b, i) => {
        b.position.copy(this.restPos[i]); b.quaternion.copy(this.restQuat[i]); b.scale.set(1, 1, 1);
        this.skeleton.boneInverses[i].copy(this.restGlobal[i]).invert();
      });
      this.applyPose();
    }

    // pose: per-bone local rotations in MakeHuman's convention (matPose)
    applyPose() {
      this.bones.forEach((b, i) => {
        b.quaternion.copy(this.restQuat[i]).multiply(this.pose[i]);
        b.position.copy(this.restPos[i]);
      });
      for (const r of this.rootBones) r.position.add(this.rootOffset);
      this.group.updateMatrixWorld(true);
      const inv = this.skeleton.boneInverses;
      for (let i = 0; i < this.bones.length; i++) this.boneMats[i].multiplyMatrices(this.bones[i].matrixWorld, inv[i]);
    }

    // CPU skinning, matching the GPU: rest position (world, meters) + 8
    // bone indices/weights -> posed world position. Handy for anything that
    // must sit on the moving skin (hair roots, labels, clothing pins).
    skinPoint(rest, idx, wts, out, offset = 0) {
      out = out || new THREE.Vector3();
      const x = rest.x, y = rest.y, z = rest.z;
      let ox = 0, oy = 0, oz = 0;
      for (let k = 0; k < 8; k++) {
        const w = wts[offset + k];
        if (!w) continue;
        const e = this.boneMats[idx[offset + k]].elements;
        ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
      return out.set(ox, oy, oz);
    }
    // posed world position of smoothed-body vertex i
    bodyVertex(i, out) {
      const a = this.restAttr.array;
      _v3.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
      return this.skinPoint(_v3, this.subWeights.idx, this.subWeights.wts, out, i * 8);
    }
    // posed world position of MakeHuman base-mesh vertex v (any group,
    // including helpers such as eyelashes or teeth)
    baseVertex(v, out) {
      const P = this.P, D = this.D;
      _v3.set(P[v * 3] * BS.SCALE, P[v * 3 + 1] * BS.SCALE - this.ground, P[v * 3 + 2] * BS.SCALE);
      for (let k = 0; k < 8; k++) { _bi[k] = D.skinIdx[v * 8 + k]; _bw[k] = D.skinW[v * 8 + k] / 65535; }
      return this.skinPoint(_v3, _bi, _bw, out);
    }
    // rest-pose (unposed) world position of base-mesh vertex v
    baseRest(v, out) {
      const P = this.P;
      return (out || new THREE.Vector3()).set(P[v * 3] * BS.SCALE, P[v * 3 + 1] * BS.SCALE - this.ground, P[v * 3 + 2] * BS.SCALE);
    }

    resetPose() { for (const q of this.pose) q.identity(); this.rootOffset.set(0, 0, 0); }

    // Local pose rotation equal to turning bone i by `angle` about `axis`,
    // where axis is given in the rest-pose world frame (+X = character's left,
    // +Y up, +Z forward). Children follow, and the rotation composes with the
    // parent's pose, so "lift the arm forward" means the same on every body.
    worldAxisQuat(i, axis, angle, out) {
      const r = this.restGlobalQuat[i];
      _q.setFromAxisAngle(_v.copy(axis).normalize(), angle);
      return (out || new THREE.Quaternion()).copy(r).invert().multiply(_q).multiply(r);
    }
    // Local pose rotation that swings bone i's rest direction (head->tail) to
    // `dir` (rest world frame), e.g. to hang the arms down from the A-pose.
    aimQuat(i, dir, out) {
      const f = this.fit[i];
      _v.set(f.tail[0] - f.head[0], f.tail[1] - f.head[1], f.tail[2] - f.head[2]).normalize();
      _q.setFromUnitVectors(_v, _v2.copy(dir).normalize());
      const r = this.restGlobalQuat[i];
      return (out || new THREE.Quaternion()).copy(r).invert().multiply(_q).multiply(r);
    }
    // multiply a local pose rotation onto bone i (by name or index)
    rotate(bone, q) { const i = typeof bone === 'number' ? bone : this.boneIndex(bone); if (i !== undefined) this.pose[i].multiply(q); }

    boneIndex(name) { return this.D.boneIndex[name]; }
    joint(name, which = 'head') { const f = this.fit[this.boneIndex(name)]; return new THREE.Vector3(...f[which]); }
  }
  const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _bi = new Uint16Array(8), _bw = new Float32Array(8);
  BS.Human = Human;

  // MakeHuman face pose units: each unit is a set of local bone rotations;
  // a blend slerps each from identity by its weight and multiplies them
  // (animation.PoseUnit.getBlendedPose). Returns {boneIndex: Quaternion}.
  const _u = new THREE.Quaternion(), _id = new THREE.Quaternion();
  BS.blendFaceUnits = function (D, weights, out) {
    const res = out || {};
    for (const k in res) res[k].identity();
    for (const name in weights) {
      const w = weights[name];
      const unit = D.faceUnits[name];
      if (!unit || Math.abs(w) < 1e-3) continue;
      for (const bi in unit) {
        const q = unit[bi];
        _u.set(q[0], q[1], q[2], q[3]);
        if (w < 0) _u.invert();
        _u.copy(_id.identity().slerp(_u, Math.min(1.5, Math.abs(w))));
        (res[bi] || (res[bi] = new THREE.Quaternion())).premultiply(_u);
      }
    }
    return res;
  };
})();
