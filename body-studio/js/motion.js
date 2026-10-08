// Body Studio motion: rebuilds the whole pose every frame. Bottom up: a
// relaxed standing posture fitted to the body, idle life (breathing, weight
// shifts, blinks, saccades, look-at), the current action (crossfaded), the
// emotion (face units + body language) and talking. Poses are flat channel
// vectors, so actions blend by weighted averaging; arms and legs are then
// solved with two-bone IK in the rest-world frame, which keeps every pose
// fitted to any body shape.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const THREE = window.THREE;
  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  // 0 before a, eases to 1 by b, holds, eases back to 0 between c and d
  const env = (t, a, b, c, d) => sstep(a, b, t) * (1 - sstep(c, d, t));
  const mjerk = (s) => s * s * s * (10 + s * (6 * s - 15)); // minimum-jerk ease
  const wrap = (a) => a - TAU * Math.round(a / TAU);
  function hash(i) {
    let h = Math.imul(i | 0, 374761393) ^ 0x5bd1e995;
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return ((h ^ (h >>> 16)) >>> 0) / 2147483647.5 - 1;
  }
  // smooth value noise in -1..1
  function noise(x) { const i = Math.floor(x), f = x - i; return lerp(hash(i), hash(i + 1), f * f * (3 - 2 * f)); }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const V = () => new THREE.Vector3();
  const QT = () => new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
  const _qx = QT(), _qy = QT(), _qz = QT(), _q1 = QT(), _q2 = QT(), _q3 = QT();
  const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V(), _v5 = V(), _v6 = V(), _v7 = V();
  const _u = V(), _f = V(), _n = V(), _c = V(), _i1 = V(), _i2 = V();
  const _m = new THREE.Matrix4();
  // q = Ry(yaw) Rx(pitch) Rz(roll) about rest-world axes
  function eul(q, pitch, yaw, roll) {
    _qx.setFromAxisAngle(AX, pitch); _qy.setFromAxisAngle(AY, yaw); _qz.setFromAxisAngle(AZ, roll);
    return q.copy(_qy).multiply(_qx).multiply(_qz);
  }
  // rotation whose basis is (a, b, a x b); a and b orthonormal
  function basisQuat(q, a, b) { _c.crossVectors(a, b); _m.makeBasis(a, b, _c); return q.setFromRotationMatrix(_m); }
  // Two-bone IK: root joint s, target t, pole = where the middle joint
  // points, bone lengths a, b. Writes bone directions u, f and hinge axis n.
  function ik2(s, t, pole, a, b, soft, u, f, n) {
    const d = _i1.subVectors(t, s);
    let dist = d.length();
    const max = (a + b) * 0.9995, min = Math.abs(a - b) + 0.01;
    if (dist < 1e-6) d.set(0, -1, 0); else d.divideScalar(dist);
    if (dist > max - soft) dist = max - soft + soft * (1 - Math.exp(-(dist - max + soft) / soft));
    dist = clamp(dist, min, max);
    const p = _i2.copy(pole).addScaledVector(d, -pole.dot(d));
    if (p.lengthSq() < 1e-8) p.set(0, 0, 1).addScaledVector(d, -d.z);
    p.normalize();
    const ca = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1), sa = Math.sqrt(1 - ca * ca);
    u.copy(d).multiplyScalar(ca).addScaledVector(p, sa);
    f.copy(d).multiplyScalar(dist).addScaledVector(u, -a).divideScalar(b).normalize();
    n.crossVectors(p, d);
    return dist;
  }

  // ------------------------------------------------------------ channels
  const GK = ['hipX', 'hipY', 'hipZ', 'pelPitch', 'pelRoll', 'pelYaw', 'bendLo', 'bendHi', 'side', 'twist',
    'neck', 'headPitch', 'headYaw', 'headRoll', 'look', 'eyes', 'ground', 'breath', 'free'];
  // per side; x is side-local (+ = outward), anchors pick the space the
  // wrist target moves with (the remainder is the shoulder)
  const SK = ['shrug', 'fwd', 'ax', 'ay', 'az', 'reach', 'px', 'py', 'pz', 'pron', 'flex', 'dev', 'curl', 'thumb',
    'spread', 'index', 'chest', 'pelvis', 'head', 'world', 'grav', 'fx', 'fy', 'fz', 'fpitch', 'fyaw', 'froll', 'toe',
    'kx', 'ky', 'kz'];
  const C = {}, A = {};
  GK.forEach((k, i) => (C[k] = i));
  const NG = GK.length, NS = SK.length, NCH = NG + 2 * NS;
  SK.forEach((k, i) => (A[k] = i));
  const SIDE = [NG, NG + NS];

  function arm(P, o, x, y, z, reach, k = 1) {
    const l = Math.hypot(x, y, z) || 1;
    P[o + A.ax] = lerp(P[o + A.ax], x / l, k); P[o + A.ay] = lerp(P[o + A.ay], y / l, k);
    P[o + A.az] = lerp(P[o + A.az], z / l, k); P[o + A.reach] = lerp(P[o + A.reach], reach, k);
  }
  function pole(P, o, x, y, z, k = 1) {
    P[o + A.px] = lerp(P[o + A.px], x, k); P[o + A.py] = lerp(P[o + A.py], y, k); P[o + A.pz] = lerp(P[o + A.pz], z, k);
  }
  function hand(P, o, pron, flex, dev, curl, thumb, spread, k = 1) {
    P[o + A.pron] = lerp(P[o + A.pron], pron, k); P[o + A.flex] = lerp(P[o + A.flex], flex, k);
    P[o + A.dev] = lerp(P[o + A.dev], dev, k); P[o + A.curl] = lerp(P[o + A.curl], curl, k);
    P[o + A.thumb] = lerp(P[o + A.thumb], thumb, k); P[o + A.spread] = lerp(P[o + A.spread], spread, k);
  }
  function anchor(P, o, chest, pelvis, head, world, k = 1) {
    P[o + A.chest] = lerp(P[o + A.chest], chest, k); P[o + A.pelvis] = lerp(P[o + A.pelvis], pelvis, k);
    P[o + A.head] = lerp(P[o + A.head], head, k); P[o + A.world] = lerp(P[o + A.world], world, k);
    P[o + A.grav] = lerp(P[o + A.grav], 0, k);
  }
  function mix(P, B, k) { for (let i = 0; i < NCH; i++) P[i] += (B[i] - P[i]) * k; }

  // ------------------------------------------------------------- actions
  // fn(m, P, t) writes the pose for local time t on top of the fitted
  // standing pose already in P. o = SIDE[s]; s = 0 left, 1 right.
  function idle(m, P, t) { m.stand(P, t, 1); m.armLife(P, t, 1); }

  function apose(m, P) { P.set(m.restP); }

  function tpose(m, P) {
    P.set(m.restP);
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s];
      arm(P, o, 1, 0.02, -0.02, 1);
      pole(P, o, 0, 0.3, -1);
      hand(P, o, m.palmDown, 0, 0, 0.05, 0.05, 0.1);
    }
  }

  function loco(m, P) { P.set(m.gaitP); }

  function jump(m, P, t) {
    m.stand(P, t, 0.2);
    const T = 2.6, u = t % T, L = m.lm, ls = m.legScale;
    const vy = 2.3 * Math.sqrt(ls), air = (2 * vy) / 9.81, t0 = 0.82, t1 = t0 + air;
    const crouch = u < t0 ? sstep(0.1, 0.62, u) * (1 - sstep(0.64, t0, u)) : u < t1 ? 0.12 * Math.sin(PI * (u - t0) / air)
      : sstep(t1 - 0.02, t1 + 0.14, u) * 0.85 * (1 - sstep(t1 + 0.2, t1 + 0.75, u));
    const fly = u > t0 && u < t1 ? vy * (u - t0) - 4.905 * (u - t0) * (u - t0) : 0;
    const push = env(u, 0.6, t0, t0 + 0.02, t0 + 0.15); // heels rise through take-off
    P[C.hipY] += -0.26 * ls * crouch + fly + 0.03 * push;
    P[C.hipZ] -= 0.07 * crouch;
    P[C.pelPitch] += 0.42 * crouch;
    P[C.bendLo] += 0.12 * crouch; P[C.bendHi] += 0.12 * crouch;
    P[C.headPitch] -= 0.32 * crouch;
    P[C.look] = 0.7;
    // arms swing back on the way down, up through take-off, forward to land
    const swing = u < 0.62 ? -0.75 * sstep(0.1, 0.6, u) : u < t1 ? lerp(-0.75, 2.6, sstep(0.62, t0 + 0.12, u)) : lerp(2.6, 0.5, sstep(t1 - 0.1, t1 + 0.2, u)) * (1 - sstep(t1 + 0.3, t1 + 0.9, u));
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s];
      m.swingArm(P, o, swing, 0.25 + 0.3 * crouch, 0.12, 1);
      hand(P, o, m.relax.pron, 0, 0, 0.4, 0.3, 0.1);
      P[o + A.grav] = 0;
      const lift = fly > 0 ? Math.max(0, fly - 0.06 * Math.sin(PI * (u - t0) / air)) : 0;
      if (u > t0 - 0.05 && u < t1) {
        // toes leave last and land first
        const tip = sstep(t0 - 0.05, t0 + 0.1, u) * (1 - sstep(t1 - 0.15, t1, u));
        m.footPivot(P, o, s, 0, 0, 0, -0.55 * tip - 0.35 * push * (1 - tip), 1);
        P[o + A.fy] += lift;
      } else m.footPivot(P, o, s, 0, 0, 0, -0.45 * push, 1);
    }
  }

  function wave(m, P, t) {
    m.stand(P, t, 0.6);
    m.armLife(P, t, 1);
    const T = 5, u = t % T, o = SIDE[1], lm = L(m);
    const up = env(u, 0.05, 0.6, 3.5, 4.2), w = env(u, 0.45, 0.75, 3.1, 3.55);
    // the forearm swings side to side about the elbow
    const osc = Math.sin((u - 0.5) * TAU * 2.3) * w;
    anchor(P, o, 1, 0, 0, 0, up);
    m.armTo(P, o, lm.S.x + 0.11 + 0.07 * osc, lm.eyeY - 0.01 - 0.012 * osc * osc, lm.S.z + 0.15, up);
    pole(P, o, 0.7, -1, -0.15, up);
    hand(P, o, m.palmFwd, -0.15 + 0.2 * osc, 0.1 * osc, 0.08, 0.15, 0.3, up);
    P[o + A.grav] *= 1 - up;
    P[C.headRoll] -= 0.04 * up;
    P[C.side] -= 0.03 * up;
    P[o + A.shrug] += 0.03 * up;
  }

  function clap(m, P, t) {
    m.stand(P, t, 0.4);
    const k = sstep(0, 0.45, t), lm = L(m);
    const ph = Math.max(0, t - 0.45) * 2.2;
    const sep = Math.pow(0.5 + 0.5 * Math.cos(ph * TAU), 0.6) * k;
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s];
      m.armTo(P, o, lm.handHalf + 0.012 + 0.09 * sep, lm.chestY - 0.1 + 0.02 * sep, lm.chestZ + 0.14 + 0.02 * sep, k);
      anchor(P, o, 1, 0, 0, 0, k);
      pole(P, o, 1, -0.8, -0.4, k);
      hand(P, o, m.palmIn, -0.15, 0, 0.06, 0.15, 0.05, k);
    }
    P[C.headPitch] += 0.02 * Math.sin(ph * TAU) * k;
  }

  function think(m, P, t) {
    m.stand(P, t, 0.7);
    const k = sstep(0, 0.7, t);
    m.poseChin(P, 1, k);
    m.poseSupport(P, 0, k);
    P[C.headRoll] += 0.07 * k; P[C.headPitch] -= 0.06 * k; P[C.bendHi] += 0.03 * k;
    P[C.look] = 1 - 0.85 * k;
    P[SIDE[1] + A.index] -= 0.6 * k * (0.5 + 0.5 * Math.sin(t * 5.5)) * env(t % 6, 2, 2.3, 3.6, 3.9);
  }

  function crossarms(m, P, t) { m.stand(P, t, 1); m.poseCrossArms(P, sstep(0, 0.6, t)); }

  function hips(m, P, t) {
    m.stand(P, t, 1);
    const k = sstep(0, 0.6, t);
    m.poseHips(P, k);
    P[C.bendHi] -= 0.04 * k;
    P[C.headPitch] -= 0.03 * k;
  }

  function shrug(m, P, t) {
    m.stand(P, t, 0.6);
    const u = t % 3.4, k = env(u, 0.15, 0.55, 1.5, 2.1);
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s];
      P[o + A.shrug] += 0.3 * k;
      arm(P, o, 0.62, -0.62, 0.48, 0.7, k);
      pole(P, o, 0.3, -1, -0.5, k);
      hand(P, o, m.palmUp, -0.2, 0, 0.12, 0.05, 0.4, k);
      P[o + A.grav] *= 1 - k;
    }
    P[C.headRoll] += 0.1 * k; P[C.headPitch] -= 0.04 * k; P[C.neck] -= 0.03 * k;
  }

  function nod(m, P, t) {
    m.stand(P, t, 0.6);
    const u = t % 3.2, k = env(u, 0.05, 0.2, 1.35, 1.7);
    P[C.headPitch] += k * (0.05 + 0.11 * (0.5 - 0.5 * Math.cos(u * TAU * 2.1)));
    P[C.neck] += 0.04 * k;
  }

  function shakeHead(m, P, t) {
    m.stand(P, t, 0.6);
    const u = t % 3.4, k = env(u, 0.05, 0.25, 1.5, 1.9);
    P[C.headYaw] += k * 0.3 * Math.sin(u * TAU * 2.2) * (1 - 0.35 * sstep(0.3, 1.6, u));
    P[C.headPitch] += 0.04 * k;
  }

  const LOOK_YAW = [0, 0, 0.8, 0, 1.6, 1.0, 2.4, 1.0, 3.2, -1.05, 4.0, -1.05, 4.8, -0.3, 5.6, -0.3, 6.4, 0.5, 7.2, 0.5, 8.0, 0, 9.5, 0];
  const LOOK_PITCH = [0, 0, 4.8, 0, 5.6, -0.3, 6.4, -0.2, 7.2, 0.25, 8.0, 0, 9.5, 0];
  function lookAround(m, P, t) {
    m.stand(P, t, 0.8);
    const u = t % 9.5, yaw = kf(LOOK_YAW, u), pitch = kf(LOOK_PITCH, u);
    P[C.headYaw] += yaw * 0.75; P[C.headPitch] += pitch;
    P[C.twist] += yaw * 0.3; P[C.pelYaw] += yaw * 0.08;
    P[C.look] = 0; P[C.eyes] = 0;
  }

  function bow(m, P, t) {
    m.stand(P, t, 0.3);
    const u = t % 5, k = sstep(0.25, 1.35, u) * (1 - sstep(2.1, 3.2, u));
    P[C.pelPitch] += 0.62 * k; P[C.bendLo] += 0.12 * k; P[C.bendHi] += 0.1 * k;
    P[C.hipZ] -= 0.1 * k * m.legScale; P[C.hipY] -= 0.012 * k;
    P[C.neck] += 0.08 * k; P[C.headPitch] += 0.12 * k;
    P[C.look] = 1 - k; P[C.eyes] = 1 - 0.7 * k;
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s];
      anchor(P, o, 0, 1, 0, 0, k);
      m.armTo(P, o, L(m).thighX + 0.005, L(m).hip.y - 0.17, L(m).hip.z + 0.03, k);
      hand(P, o, m.palmIn, 0.05, 0, 0.12, 0.1, 0.02, k);
    }
  }

  function stretch(m, P, t) {
    m.stand(P, t, 0.3);
    const u = t % 7.5, lm = L(m);
    const up = env(u, 0.1, 1.3, 5.2, 6.4), toes = env(u, 0.6, 1.4, 2.0, 2.6);
    const lean = sstep(2.2, 3.1, u) * (1 - sstep(3.4, 4.3, u)) - sstep(3.6, 4.5, u) * (1 - sstep(4.7, 5.4, u));
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s];
      anchor(P, o, 1, 0, 0, 0, up);
      m.armTo(P, o, 0.035, lm.top + 0.16 * up, lm.S.z - 0.01, up);
      pole(P, o, 1, 0.1, -0.2, up);
      hand(P, o, m.palmUp, 0.5, 0, 0.35, 0.3, 0, up);
      P[o + A.shrug] += 0.12 * up;
      m.footPivot(P, o, s, 0, 0, 0, -0.32 * toes, 1);
    }
    P[C.hipY] += 0.02 * toes;
    P[C.side] += 0.28 * lean; P[C.hipX] -= 0.035 * lean;
    P[C.bendHi] -= 0.08 * up; P[C.headPitch] -= 0.12 * up;
    P[C.look] = 1 - up;
  }

  function squats(m, P, t) {
    m.stand(P, t, 0);
    const u = t % 2.8, d = sstep(0.2, 1.3, u) * (1 - sstep(1.45, 2.5, u)), k = sstep(0, 0.5, t), ls = m.legScale;
    P[C.hipY] -= d * 0.4 * ls; P[C.hipZ] -= d * 0.17 * ls;
    P[C.pelPitch] += d * 0.55; P[C.bendLo] += d * 0.08; P[C.bendHi] += d * 0.04;
    P[C.headPitch] -= d * 0.45;
    P[C.look] = 0.5;
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s];
      P[o + A.fx] += 0.06 * k; P[o + A.fyaw] += 0.15 * k; P[o + A.kx] += 0.35 * k;
      arm(P, o, 0.18, -0.1 + 0.1 * d, 1, 0.97, k * (0.4 + 0.6 * d));
      pole(P, o, 0.5, -0.6, -0.4, k);
      hand(P, o, m.palmDown, 0, 0, 0.25, 0.2, 0.05, k);
      P[o + A.grav] *= 1 - k;
    }
  }

  function pushups(m, P, t) {
    const k = sstep(0, 0.6, t);
    const u = t % 2.4, d = sstep(0.15, 1.15, u) * (1 - sstep(1.35, 2.05, u));
    m.plank(P, d);
    P[C.look] = 0; P[C.eyes] = 0.35; P[C.free] = 0;
    if (k < 1) mix(P, m.base, 1 - k);
  }

  function fight(m, P, t) {
    m.stand(P, t, 0);
    const lm = L(m), k = sstep(0, 0.5, t), ls = m.legScale;
    const bob = Math.sin(t * TAU * 1.8) * k;
    // orthodox stance: left foot forward, body turned to the right
    P[C.hipY] -= (0.08 + 0.01 * bob) * ls * k;
    P[C.pelYaw] -= 0.45 * k; P[C.twist] += 0.25 * k; P[C.bendHi] += 0.08 * k; P[C.bendLo] += 0.05 * k;
    P[C.headYaw] += 0.15 * k; P[C.headPitch] += 0.12 * k; P[C.hipZ] -= 0.02 * k;
    const oL = SIDE[0], oR = SIDE[1];
    P[oL + A.fz] += 0.17 * ls * k; P[oL + A.fx] -= 0.03 * k; P[oL + A.fyaw] += 0.15 * k;
    P[oR + A.fz] -= 0.15 * ls * k; P[oR + A.fx] += 0.02 * k; P[oR + A.fyaw] += 0.5 * k;
    m.footPivot(P, oR, 1, P[oR + A.fx], 0, P[oR + A.fz], -0.3 * k, 1);
    // punches: jab, then jab + cross
    const u = t % 3.6;
    const jab = env(u, 0.6, 0.78, 0.82, 1.05) + env(u, 1.7, 1.88, 1.92, 2.12);
    const cross = env(u, 2.1, 2.3, 2.35, 2.62);
    P[C.pelYaw] += 0.35 * cross; P[C.twist] += 0.25 * cross - 0.08 * jab;
    m.footPivot(P, oR, 1, P[oR + A.fx], 0, P[oR + A.fz], -0.3 * k - 0.25 * cross, 1);
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s], ext = s ? cross : jab;
      anchor(P, o, 1, 0, 0, 0, k);
      const gx = s ? 0.0 : 0.05, gy = s ? lm.chinY - 0.03 : lm.chinY + 0.01, gz = lm.chestZ + (s ? 0.12 : 0.22);
      m.armTo(P, o, lerp(gx, -0.02, ext), lerp(gy, lm.S.y + 0.02, ext), lerp(gz, lm.S.z + 0.75 * m.armLen, ext), k);
      pole(P, o, 0.4, -1, -0.2, k);
      hand(P, o, lerp(m.palmIn, m.palmDown, 0.4 + 0.6 * ext), 0.1, 0.1, 1, 0.9, 0, k);
      P[o + A.shrug] += 0.1 * k;
      P[o + A.fwd] += 0.05 * k + 0.12 * ext;
    }
    P[C.look] = 1; P[C.free] = 0;
  }

  function sit(m, P, t) {
    P.set(m.base);
    const lm = L(m), k = 1, ls = m.legScale;
    P[C.ground] = 1; P[C.free] = 0.4;
    P[C.hipY] = lm.sitHip - lm.hip.y; P[C.hipZ] = -0.04;
    P[C.pelPitch] = -0.2; P[C.bendLo] = 0.16; P[C.bendHi] = 0.1; P[C.headPitch] = 0.02;
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s], front = s ? 0.07 : 0;
      P[o + A.fx] = -lm.ankle.x - 0.12 * ls; P[o + A.fy] = 0.015; P[o + A.fz] = 0.26 * ls + front;
      P[o + A.fpitch] = -0.35; P[o + A.fyaw] = -0.7; P[o + A.froll] = 0.75;
      P[o + A.kx] = 1; P[o + A.ky] = 0.5; P[o + A.kz] = 0.4;
      anchor(P, o, 0, 0, 0, 1, k);
      m.armTo(P, o, lm.sitKneeX - 0.04, lm.sitKneeY + 0.08, lm.sitKneeZ - 0.02, k);
      pole(P, o, 0.5, -0.3, -1, k);
      hand(P, o, m.palmDown, 0.25, 0, 0.35, 0.3, 0.05, k);
    }
    P[C.headYaw] += 0.03 * noise(t * 0.3);
  }

  function kneel(m, P, t) {
    P.set(m.base);
    const lm = L(m), ls = m.legScale;
    P[C.ground] = 1; P[C.free] = 0.3;
    P[C.hipY] = lm.kneelHip - lm.hip.y; P[C.hipZ] = -0.02;
    const oL = SIDE[0], oR = SIDE[1];
    // left knee down, toes tucked; right foot planted ahead
    P[oL + A.fx] = -0.02; P[oL + A.fz] = -lm.legB * 0.92 - 0.02; P[oL + A.fy] = lm.toeLen * 0.6;
    P[oL + A.fpitch] = -1.15; P[oL + A.toe] = 1.0;
    P[oR + A.fx] = -0.01; P[oR + A.fz] = lm.legA * 0.95 + 0.04 * ls;
    P[oR + A.kz] = 1; P[oR + A.ky] = 0.2;
    P[C.bendHi] = 0.04; P[C.bendLo] = 0.02;
    anchor(P, oR, 0, 0, 0, 1, 1);
    m.armTo(P, oR, lm.ankle.x + 0.0, lm.legB + lm.ankle.y + 0.04, P[oR + A.fz] + lm.ankle.z + 0.05, 1);
    pole(P, oR, 0.6, -0.4, -1);
    hand(P, oR, m.palmDown, 0.3, 0, 0.35, 0.3, 0);
    anchor(P, oL, 0, 1, 0, 0, 1);
    m.armTo(P, oL, lm.thighX + 0.02, lm.hip.y - 0.12, lm.hip.z + 0.14, 1);
    pole(P, oL, 0.6, -0.3, -1);
    hand(P, oL, m.palmDown, 0.15, 0, 0.3, 0.3, 0);
  }

  // dances ------------------------------------------------------------
  function groove(m, P, t) {
    m.stand(P, t, 0);
    const k = sstep(0, 0.5, t), b = t * (100 / 60), ls = m.legScale;
    const sw = Math.sin(b * PI), bounce = Math.pow(Math.abs(Math.cos(b * PI)), 1.5);
    P[C.hipX] += 0.05 * sw * k; P[C.hipY] -= (0.02 + 0.035 * (1 - bounce)) * ls * k;
    P[C.pelRoll] += 0.09 * sw * k; P[C.side] -= 0.07 * sw * k; P[C.twist] -= 0.12 * sw * k; P[C.pelYaw] += 0.08 * sw * k;
    P[C.bendHi] += 0.04 * k; P[C.headPitch] += 0.06 * (1 - bounce) * k; P[C.headRoll] += 0.06 * sw * k;
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s], sx = s ? -1 : 1;
      const free = clamp(-sw * sx, 0, 1);
      m.footPivot(P, o, s, P[o + A.fx], 0, P[o + A.fz], -0.45 * free * k, 1);
      // bent arms swing across the body with the hips
      const sweep = sw * sx;
      m.armTo(P, o, lerp(L(m).S.x, 0.06 + 0.12 * sweep, k), L(m).chestY - 0.12 - 0.04 * bounce, L(m).chestZ + 0.16, k);
      anchor(P, o, 0.6, 0, 0, 0, k);
      pole(P, o, 0.7, -1, -0.4, k);
      const snap = Math.pow(Math.max(0, Math.cos((b + 0.5) * PI)), 8);
      hand(P, o, m.palmIn, 0.1, 0.1, 0.55 + 0.25 * snap, 0.5 + 0.4 * snap, 0, k);
      P[o + A.shrug] += 0.06 * (1 - bounce) * k;
    }
    P[C.look] = 0.8;
  }

  function party(m, P, t) {
    m.stand(P, t, 0);
    const k = sstep(0, 0.5, t), b = t * (124 / 60), ls = m.legScale;
    const bounce = 0.5 - 0.5 * Math.cos(b * TAU), bar = b % 4;
    P[C.hipY] -= (0.015 + 0.04 * bounce) * ls * k;
    P[C.headPitch] += 0.09 * bounce * k; P[C.neck] += 0.03 * bounce * k; P[C.bendHi] += 0.03 * bounce * k;
    P[C.twist] += 0.12 * Math.sin(b * PI * 0.5) * k; P[C.hipX] += 0.02 * Math.sin(b * PI * 0.5) * k;
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s];
      P[o + A.fx] += 0.05 * k;
      // fist pumps, alternating arms every two beats
      const mine = s ? bar < 2 : bar >= 2;
      const pump = (mine ? 1 : 0.15) * (0.6 + 0.4 * (1 - bounce));
      m.armTo(P, o, L(m).S.x + 0.05, L(m).top + 0.05 - 0.28 * (1 - pump), L(m).S.z + 0.1, k * (0.35 + 0.65 * pump));
      pole(P, o, 1, -0.4, -0.2, k);
      hand(P, o, m.palmFwd, 0, 0, 1, 0.9, 0, k);
      P[o + A.shrug] += 0.1 * pump * k;
      P[o + A.grav] *= 1 - k;
      m.footPivot(P, o, s, P[o + A.fx], 0, P[o + A.fz], -0.25 * bounce * (mine ? 1 : 0.4) * k, 1);
    }
    P[C.look] = 0.8;
  }

  function disco(m, P, t) {
    m.stand(P, t, 0);
    const k = sstep(0, 0.5, t), b = t * (110 / 60), ls = m.legScale;
    const up = 0.5 + 0.5 * Math.cos(b * PI); // point up on odd beats, down across on even
    const sw = Math.sin(b * PI);
    P[C.hipX] += 0.045 * sw * k; P[C.pelRoll] += 0.1 * sw * k; P[C.hipY] -= (0.03 + 0.02 * Math.abs(sw)) * ls * k;
    P[C.side] -= 0.06 * sw * k + 0.05 * (up - 0.5) * k;
    P[C.headYaw] -= 0.25 * (up - 0.4) * k; P[C.headPitch] -= 0.18 * (up - 0.5) * k;
    const oR = SIDE[1];
    m.armTo(P, oR, lerp(-0.08, L(m).S.x + 0.32, up), lerp(L(m).hip.y - 0.05, L(m).top + 0.2, up), L(m).S.z + 0.25, k);
    anchor(P, oR, 0.5, 0, 0, 0, k);
    pole(P, oR, 1, -0.3, -0.3, k);
    hand(P, oR, m.palmDown, 0, 0, 1, 0.85, 0, k);
    P[oR + A.index] -= 1.3 * k;
    m.poseHip(P, 0, k);
    for (let s = 0; s < 2; s++) {
      const o = SIDE[s], sx = s ? -1 : 1;
      m.footPivot(P, o, s, P[o + A.fx], 0, P[o + A.fz], -0.4 * clamp(-sw * sx, 0, 1) * k, 1);
    }
    P[C.look] = 0.5;
  }

  const ACTIONS = [
    { id: 'idle', label: 'Idle', group: 'Basic', fn: idle },
    { id: 'apose', label: 'A-pose (rest)', group: 'Basic', fn: apose, still: 1 },
    { id: 'tpose', label: 'T-pose', group: 'Basic', fn: tpose, still: 1 },
    { id: 'walk', label: 'Walk', group: 'Move', fn: loco, exert: 0.25 },
    { id: 'walkaround', label: 'Walk around', group: 'Move', fn: loco, exert: 0.25 },
    { id: 'run', label: 'Run', group: 'Move', fn: loco, exert: 1 },
    { id: 'jump', label: 'Jump', group: 'Move', fn: jump, exert: 0.6 },
    { id: 'wave', label: 'Wave hello', group: 'Gesture', fn: wave },
    { id: 'clap', label: 'Clap', group: 'Gesture', fn: clap, exert: 0.1 },
    { id: 'think', label: 'Think', group: 'Gesture', fn: think },
    { id: 'crossarms', label: 'Cross arms', group: 'Gesture', fn: crossarms },
    { id: 'hips', label: 'Hands on hips', group: 'Gesture', fn: hips },
    { id: 'shrug', label: 'Shrug', group: 'Gesture', fn: shrug },
    { id: 'nod', label: 'Nod yes', group: 'Gesture', fn: nod },
    { id: 'shake', label: 'Shake head no', group: 'Gesture', fn: shakeHead },
    { id: 'lookaround', label: 'Look around', group: 'Gesture', fn: lookAround },
    { id: 'bow', label: 'Bow', group: 'Gesture', fn: bow },
    { id: 'groove', label: 'Dance: groove', group: 'Dance', fn: groove, exert: 0.5 },
    { id: 'party', label: 'Dance: party', group: 'Dance', fn: party, exert: 0.7 },
    { id: 'disco', label: 'Dance: disco', group: 'Dance', fn: disco, exert: 0.5 },
    { id: 'stretch', label: 'Stretch', group: 'Exercise', fn: stretch, exert: 0.1 },
    { id: 'squats', label: 'Squats', group: 'Exercise', fn: squats, exert: 0.6 },
    { id: 'pushups', label: 'Push-ups', group: 'Exercise', fn: pushups, exert: 0.75 },
    { id: 'fight', label: 'Fighting stance', group: 'Exercise', fn: fight, exert: 0.6 },
    { id: 'sit', label: 'Sit cross-legged', group: 'Rest', fn: sit },
    { id: 'kneel', label: 'Kneel', group: 'Rest', fn: kneel },
  ];
  const HOME = { id: 'walkhome', fn: loco, exert: 0.25 };
  const LOCO = { walk: 1, walkaround: 1, run: 1, walkhome: 1 };
  const L = (m) => m.lm;

  // smooth keyframes [t0, v0, t1, v1, ...]
  function kf(k, t) {
    if (t <= k[0]) return k[1];
    for (let i = 2; i < k.length; i += 2) if (t < k[i]) return lerp(k[i - 1], k[i + 1], sstep(k[i - 2], k[i], t));
    return k[k.length - 1];
  }

  // ------------------------------------------------------------ emotions
  // face: MakeHuman face-unit weights; body: channel offsets (side keys hit
  // both sides); arms(m, P, t): body language when the action leaves the
  // arms free; anim(m, F, t, k): animated face; gaze: { down, away, mul }.
  const EMOTIONS = [
    { id: 'neutral', label: 'Neutral', emoji: '😐' },
    { id: 'happy', label: 'Happy', emoji: '😊',
      face: { MouthLeftPullUp: 0.95, MouthRightPullUp: 0.9, LeftCheekUp: 0.85, RightCheekUp: 0.8, LeftLowerLidUp: 0.32, RightLowerLidUp: 0.3, UpperLipUp: 0.25, lowerLipDown: 0.12, JawDrop: 0.03, LeftOuterBrowUp: 0.12, RightOuterBrowUp: 0.12 },
      body: { bendHi: -0.03, headPitch: -0.03, headRoll: 0.04 }, energy: 1, heart: 6, flush: 0.12, breath: 1.05 },
    { id: 'laughing', label: 'Laughing', emoji: '😂',
      face: { MouthLeftPullUp: 0.95, MouthRightPullUp: 0.95, LeftCheekUp: 0.95, RightCheekUp: 0.9, LeftLowerLidUp: 0.55, RightLowerLidUp: 0.55, LeftUpperLidClosed: 0.28, RightUpperLidClosed: 0.3, UpperLipUp: 0.45, LeftInnerBrowUp: 0.35, RightInnerBrowUp: 0.35, NasolabialDeepener: 0.3 },
      body: { headPitch: -0.06 }, heart: 14, flush: 0.45, breath: 1.2,
      anim(m, F, t, k) { const fit = m.laugh; F.JawDrop += k * (0.12 + fit * (0.12 + 0.1 * Math.sin(t * TAU * 4.6))); F.lowerLipDown += 0.15 * k * fit; },
      arms(m, P, t) { m.poseBelly(P, 0, 1); } },
    { id: 'sad', label: 'Sad', emoji: '😢',
      face: { LeftInnerBrowUp: 1, RightInnerBrowUp: 1, LeftBrowDown: 0.2, RightBrowDown: 0.2, LeftUpperLidClosed: 0.3, RightUpperLidClosed: 0.3, MouthLeftPullDown: 0.8, MouthRightPullDown: 0.8, lowerLipUp: 0.35, MouthLeftPlatysma: 0.2, MouthRightPlatysma: 0.2 },
      body: { bendHi: 0.1, neck: 0.05, headPitch: 0.05, shrug: -0.05, fwd: 0.07, hipY: -0.006, curl: 0.08 }, gaze: { down: 0.16, mul: 0.6 }, heart: -2, breath: 0.85, blink: 0.8, sigh: 1 },
    { id: 'crying', label: 'Crying', emoji: '😭',
      face: { LeftInnerBrowUp: 1.15, RightInnerBrowUp: 1.15, LeftBrowDown: 0.4, RightBrowDown: 0.4, LeftUpperLidClosed: 0.5, RightUpperLidClosed: 0.5, LeftLowerLidUp: 0.5, RightLowerLidUp: 0.5, LeftCheekUp: 0.4, RightCheekUp: 0.4, MouthLeftPullDown: 0.95, MouthRightPullDown: 0.95, MouthLeftPullSide: 0.25, MouthRightPullSide: 0.25, NoseWrinkler: 0.4, MouthLeftPlatysma: 0.5, MouthRightPlatysma: 0.5, UpperLipUp: 0.2 },
      body: { bendHi: 0.12, neck: 0.05, headPitch: 0.06, shrug: 0.02, fwd: 0.08 }, gaze: { down: 0.18, mul: 0.4 }, heart: 10, flush: 0.5, wet: 0.85, breath: 1.1,
      anim(m, F, t, k) { const s = m.sob; F.JawDrop += k * (0.1 + 0.16 * s); F.lowerLipDown += k * (0.2 + 0.12 * noise(t * 9)); F.LeftInnerBrowUp += 0.15 * k * s; F.RightInnerBrowUp += 0.15 * k * s; },
      arms(m, P, t) { m.poseWipe(P, 1, t); } },
    { id: 'angry', label: 'Angry', emoji: '😠',
      face: { LeftBrowDown: 1, RightBrowDown: 1, NoseWrinkler: 0.35, LeftUpperLidOpen: 0.3, RightUpperLidOpen: 0.3, LeftLowerLidUp: 0.45, RightLowerLidUp: 0.45, lowerLipUp: 0.4, MouthLeftPullDown: 0.35, MouthRightPullDown: 0.35, NasolabialDeepener: 0.3, LipsKiss: 0.15 },
      body: { bendHi: 0.05, headPitch: 0.06, shrug: 0.06, fwd: 0.05, hipZ: 0.01 }, heart: 22, flush: 0.55, breath: 1.35, blink: 0.6,
      arms(m, P) { for (let s = 0; s < 2; s++) { P[SIDE[s] + A.curl] = 1; P[SIDE[s] + A.thumb] = 0.9; P[SIDE[s] + A.ax] += 0.07; } } },
    { id: 'furious', label: 'Furious', emoji: '🤬',
      face: { LeftBrowDown: 1.15, RightBrowDown: 1.15, NoseWrinkler: 0.7, LeftUpperLidOpen: 0.45, RightUpperLidOpen: 0.45, LeftLowerLidUp: 0.4, RightLowerLidUp: 0.4, UpperLipUp: 0.6, JawDrop: 0.14, JawDropStretched: 0.15, NasolabialDeepener: 0.6, MouthLeftPullSide: 0.3, MouthRightPullSide: 0.3, MouthLeftPlatysma: 0.5, MouthRightPlatysma: 0.5 },
      body: { bendHi: 0.08, bendLo: 0.03, headPitch: 0.06, neck: 0.03, shrug: 0.12, fwd: 0.1, hipY: -0.015, hipZ: 0.02 }, heart: 38, flush: 0.85, breath: 1.7, blink: 0.4,
      anim(m, F, t, k) { F.JawDrop += 0.05 * k * m.breath; },
      arms(m, P) { for (let s = 0; s < 2; s++) { const o = SIDE[s]; P[o + A.curl] = 1; P[o + A.thumb] = 1; P[o + A.ax] += 0.12; P[o + A.reach] -= 0.1; } } },
    { id: 'surprised', label: 'Surprised', emoji: '😮',
      face: { LeftInnerBrowUp: 0.9, RightInnerBrowUp: 0.9, LeftOuterBrowUp: 0.95, RightOuterBrowUp: 0.95, LeftUpperLidOpen: 0.75, RightUpperLidOpen: 0.75, JawDrop: 0.4, LipsKiss: 0.25, lowerLipDown: 0.15 },
      body: { bendHi: -0.05, headPitch: -0.04, neck: -0.04, shrug: 0.06, hipZ: -0.012 }, heart: 16, breath: 1.3, blink: 0.4,
      arms(m, P) { for (let s = 0; s < 2; s++) { const o = SIDE[s]; P[o + A.reach] -= 0.12; P[o + A.az] += 0.25; P[o + A.spread] += 0.5; P[o + A.curl] = 0.15; } } },
    { id: 'scared', label: 'Scared', emoji: '😨',
      face: { LeftInnerBrowUp: 1, RightInnerBrowUp: 1, LeftOuterBrowUp: 0.35, RightOuterBrowUp: 0.35, LeftBrowDown: 0.3, RightBrowDown: 0.3, LeftUpperLidOpen: 0.85, RightUpperLidOpen: 0.85, MouthLeftPullSide: 0.6, MouthRightPullSide: 0.6, JawDrop: 0.18, lowerLipDown: 0.4, MouthLeftPlatysma: 0.6, MouthRightPlatysma: 0.6 },
      body: { bendHi: 0.1, neck: 0.03, shrug: 0.14, fwd: 0.1, hipY: -0.02, hipZ: -0.025, kx: -0.15 }, gaze: { dart: 1 }, heart: 40, flush: -0.3, breath: 1.8, blink: 1.4, tremble: 1,
      arms(m, P) { m.poseClasp(P, 'chest', 1, true); } },
    { id: 'disgusted', label: 'Disgusted', emoji: '🤢',
      face: { NoseWrinkler: 1, UpperLipUp: 0.7, LeftCheekUp: 0.5, RightCheekUp: 0.25, LeftBrowDown: 0.55, RightBrowDown: 0.45, LeftLowerLidUp: 0.45, RightLowerLidUp: 0.35, MouthLeftPullDown: 0.4, MouthRightPullDown: 0.25, lowerLipDown: 0.25, MouthLeftPlatysma: 0.35 },
      body: { hipZ: -0.02, bendHi: -0.04, headPitch: -0.05, headYaw: 0.12, headRoll: -0.05, neck: -0.06 }, gaze: { away: 0.2, mul: 0.7 }, heart: 4 },
    { id: 'contempt', label: 'Contempt', emoji: '😒',
      face: { MouthLeftPullUp: 0.7, MouthLeftPullSide: 0.5, LeftCheekUp: 0.25, LeftUpperLidClosed: 0.25, RightUpperLidClosed: 0.25, lowerLipUp: 0.2, RightBrowDown: 0.15 },
      body: { headPitch: -0.1, headRoll: -0.05, headYaw: -0.08, bendHi: -0.03 }, gaze: { down: 0.06, mul: 0.8 }, heart: 2,
      arms(m, P) { m.poseCrossArms(P, 1); } },
    { id: 'confused', label: 'Confused', emoji: '😕',
      face: { LeftBrowDown: 0.7, RightOuterBrowUp: 0.7, RightInnerBrowUp: 0.5, MouthRightPullDown: 0.35, MouthMoveLeft: 0.35, lowerLipUp: 0.3, LeftLowerLidUp: 0.3 },
      body: { headRoll: 0.14, headPitch: 0.02, headYaw: -0.05 }, gaze: { away: 0.25, mul: 0.8 }, heart: 4,
      arms(m, P, t) { m.poseScratch(P, 1, t); } },
    { id: 'thinking', label: 'Thinking', emoji: '🤔',
      face: { LeftBrowDown: 0.45, RightBrowDown: 0.25, RightOuterBrowUp: 0.35, lowerLipUp: 0.35, MouthMoveRight: 0.3, MouthRightPullSide: 0.2, LeftLowerLidUp: 0.3, RightLowerLidUp: 0.3 },
      body: { headRoll: 0.06, headPitch: -0.04 }, gaze: { down: -0.3, away: 0.45, mul: 0.25 }, blink: 0.7,
      arms(m, P) { m.poseChin(P, 1, 1); m.poseSupport(P, 0, 1); } },
    { id: 'shy', label: 'Shy', emoji: '☺️',
      face: { MouthLeftPullUp: 0.55, MouthRightPullUp: 0.45, LeftCheekUp: 0.4, RightCheekUp: 0.3, LeftLowerLidUp: 0.3, RightLowerLidUp: 0.3, lowerLipUp: 0.2, LeftInnerBrowUp: 0.4, RightInnerBrowUp: 0.4, LipsKiss: 0.15 },
      body: { headPitch: 0.07, headRoll: 0.1, headYaw: 0.1, neck: 0.03, shrug: 0.05, fwd: 0.06, bendHi: 0.03 }, gaze: { down: 0.16, away: 0.35, mul: 0.6, glance: 1 }, heart: 12, flush: 0.85, blink: 1.2,
      arms(m, P) { m.poseClasp(P, 'low', 1); } },
    { id: 'love', label: 'In love', emoji: '😍',
      face: { MouthLeftPullUp: 0.7, MouthRightPullUp: 0.7, LeftCheekUp: 0.6, RightCheekUp: 0.6, LeftInnerBrowUp: 0.5, RightInnerBrowUp: 0.5, LeftUpperLidClosed: 0.3, RightUpperLidClosed: 0.3, LeftLowerLidUp: 0.3, RightLowerLidUp: 0.3, JawDrop: 0.05 },
      body: { headRoll: 0.12, headPitch: 0.03, bendHi: -0.02 }, heart: 14, flush: 0.6, breath: 0.95, blink: 0.6, sigh: 0.8,
      arms(m, P) { m.poseClasp(P, 'chest', 1); } },
    { id: 'tired', label: 'Tired', emoji: '😴',
      face: { LeftUpperLidClosed: 0.55, RightUpperLidClosed: 0.6, LeftInnerBrowUp: 0.35, RightInnerBrowUp: 0.35, MouthLeftPullDown: 0.25, MouthRightPullDown: 0.25, JawDrop: 0.04 },
      body: { bendHi: 0.08, neck: 0.05, headPitch: 0.04, shrug: -0.05, fwd: 0.05, hipY: -0.008 }, gaze: { down: 0.1, mul: 0.5 }, heart: -6, breath: 0.75, blink: 0.5, sigh: 0.6,
      anim(m, F, t, k) { const y = m.yawn; F.JawDrop += k * 0.7 * y; F.JawDropStretched += k * 0.15 * y; F.LeftUpperLidClosed += k * 0.35 * y; F.RightUpperLidClosed += k * 0.35 * y; F.LeftInnerBrowUp += 0.4 * k * y; F.RightInnerBrowUp += 0.4 * k * y; F.NoseWrinkler += 0.2 * k * y; },
      arms(m, P) { m.poseYawnHand(P, 1); } },
    { id: 'bored', label: 'Bored', emoji: '🥱',
      face: { LeftUpperLidClosed: 0.4, RightUpperLidClosed: 0.38, MouthLeftPullDown: 0.2, MouthRightPullDown: 0.15, MouthMoveLeft: 0.35, lowerLipUp: 0.25, CheeksPump: 0.15 },
      body: { headRoll: -0.1, headPitch: 0.03, bendHi: 0.05, shrug: -0.03 }, gaze: { away: 0.4, mul: 0.4, glance: 1 }, heart: -6, breath: 0.85, blink: 0.7, sigh: 1,
      arms(m, P) { m.poseCrossArms(P, 0.85); } },
    { id: 'proud', label: 'Proud', emoji: '😤',
      face: { MouthLeftPullUp: 0.6, MouthRightPullUp: 0.55, lowerLipUp: 0.4, LeftUpperLidClosed: 0.2, RightUpperLidClosed: 0.2, LeftCheekUp: 0.3, RightCheekUp: 0.3, LipsKiss: 0.1 },
      body: { bendHi: -0.12, bendLo: -0.03, headPitch: -0.1, neck: -0.05, shrug: -0.02, fwd: -0.07 }, gaze: { down: 0.1 }, heart: 4, breath: 0.95,
      arms(m, P) { m.poseHips(P, 1); } },
    { id: 'pain', label: 'In pain', emoji: '😣',
      face: { LeftBrowDown: 0.9, RightBrowDown: 0.9, LeftInnerBrowUp: 0.6, RightInnerBrowUp: 0.6, LeftUpperLidClosed: 0.7, RightUpperLidClosed: 0.7, LeftLowerLidUp: 0.8, RightLowerLidUp: 0.8, NoseWrinkler: 0.7, UpperLipUp: 0.6, MouthLeftPullSide: 0.7, MouthRightPullSide: 0.7, JawDrop: 0.08, LeftCheekUp: 0.6, RightCheekUp: 0.6, NasolabialDeepener: 0.7 },
      body: { bendHi: 0.12, bendLo: 0.06, headPitch: 0.02, shrug: 0.08, fwd: 0.08, hipY: -0.02, hipZ: -0.02 }, gaze: { down: 0.1, mul: 0.5 }, heart: 22, flush: 0.35, wet: 0.3, breath: 1.5, blink: 0.6, tremble: 0.4,
      arms(m, P) { m.poseBelly(P, 0, 1); m.poseBelly(P, 1, 0.6); } },
    { id: 'flirty', label: 'Flirty', emoji: '😏',
      face: { MouthLeftPullUp: 0.85, MouthRightPullUp: 0.4, LeftCheekUp: 0.5, RightCheekUp: 0.25, LeftUpperLidClosed: 0.3, RightUpperLidClosed: 0.28, RightOuterBrowUp: 0.5, RightInnerBrowUp: 0.15, lowerLipUp: 0.1, LeftLowerLidUp: 0.25, RightLowerLidUp: 0.2 },
      body: { headRoll: 0.1, headPitch: 0.05, headYaw: 0.06, bendHi: -0.03, hipX: 0.02, pelRoll: 0.05 }, gaze: { mul: 1 }, heart: 9, flush: 0.35, wink: 1,
      arms(m, P, t) { m.poseHair(P, 1, t); } },
  ];
  const EMO_INDEX = {};
  EMOTIONS.forEach((e, i) => (EMO_INDEX[e.id] = i));
  // emotion body offsets resolved to channel indices
  for (const e of EMOTIONS) {
    e.off = [];
    for (const k in e.body || {}) {
      if (k in C) e.off.push(C[k], e.body[k]);
      else if (k in A) e.off.push(SIDE[0] + A[k], e.body[k], SIDE[1] + A[k], e.body[k]);
    }
  }

  // talking visemes: [JawDrop, LipsKiss, PullSide, UpperLipUp, lowerLipUp, lowerLipBackward]
  const VISEMES = [
    [0.38, 0, 0.05, 0.12, 0, 0], // a
    [0.2, 0, 0.4, 0.1, 0, 0], // e
    [0.1, 0, 0.5, 0.12, 0, 0], // i
    [0.3, 0.5, 0, 0, 0, 0], // o
    [0.1, 0.75, 0, 0, 0, 0], // u / w
    [0, 0.1, 0, 0, 0.35, 0], // m b p
    [0.05, 0, 0.1, 0.18, 0.2, 0.55], // f v
    [0.14, 0, 0.2, 0.05, 0, 0], // t d n s
  ];
  const LID_CLOSE = ['LeftUpperLidClosed', 'RightUpperLidClosed'], LID_OPEN = ['LeftUpperLidOpen', 'RightUpperLidOpen'];
  const LID_LOW = ['LeftLowerLidUp', 'RightLowerLidUp'];
  const VOWELS = [0, 1, 2, 3, 4, 0, 1, 0];
  const CONS = [5, 6, 7, 7, 7, 5];

  // ---------------------------------------------------------------- module
  class Motion {
    constructor(app) {
      this.app = app;
      const h = (this.human = app.human);
      const D = (this.D = app.D);
      const nb = (this.nb = h.bones.length);
      this.par = D.bones.map((b) => b.parent);
      this.Q = []; this.Dq = []; this.H = []; this.rest = []; this.loc = [];
      for (let i = 0; i < nb; i++) { this.Q.push(QT()); this.Dq.push(QT()); this.H.push(V()); this.rest.push(V()); this.loc.push(QT()); }
      const bi = (n) => h.boneIndex(n);
      this.B = {
        root: bi('root'), spine: ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'].map(bi),
        neck: ['neck01', 'neck02', 'neck03'].map(bi), head: bi('head'), jaw: bi('jaw'),
        eye: [bi('eye.L'), bi('eye.R')], lidUp: [bi('orbicularis03.L'), bi('orbicularis03.R')], lidLo: [bi('orbicularis04.L'), bi('orbicularis04.R')],
        breast: [bi('breast.L'), bi('breast.R')],
      };
      this.arm = ['L', 'R'].map((s) => ({
        clav: bi('clavicle.' + s), sh: bi('shoulder01.' + s), ua: bi('upperarm01.' + s), ua2: bi('upperarm02.' + s),
        la: bi('lowerarm01.' + s), la2: bi('lowerarm02.' + s), wr: bi('wrist.' + s),
        fingers: [1, 2, 3, 4, 5].map((f) => [1, 2, 3].map((j) => bi(`finger${f}-${j}.${s}`))),
        meta: [1, 2, 3, 4].map((k) => bi(`metacarpal${k}.${s}`)),
        S: V(), a: 0, b: 0, d0: V(), qU0: QT(), qF0: QT(), flexAx: V(), palmN: V(),
      }));
      this.leg = ['L', 'R'].map((s) => ({
        pel: bi('pelvis.' + s), ul: bi('upperleg01.' + s), ll: bi('lowerleg01.' + s), foot: bi('foot.' + s),
        toes: [1, 2, 3, 4, 5].map((k) => bi(`toe${k}-1.${s}`)),
        a: 0, b: 0, qU0: QT(), qF0: QT(),
      }));
      // vertex sets (skin weights never change): torso/legs without arms, soles
      const armSet = new Set();
      for (const a of this.arm) [a.ua, a.ua2, a.la, a.la2, a.wr, ...a.meta, ...a.fingers.flat()].forEach((b) => armSet.add(b));
      const footSet = new Set();
      for (const l of this.leg) { footSet.add(l.foot); D.bones.forEach((b, i) => { if (/^toe/.test(b.name) && b.name.endsWith(l === this.leg[0] ? '.L' : '.R')) footSet.add(i); }); }
      const used = new Set(D.groups.body.fv);
      const torso = [], feet = [], sparse = [];
      let c = 0;
      for (const v of used) {
        let best = 0, bw = -1;
        for (let k = 0; k < 8; k++) if (D.skinW[v * 8 + k] > bw) { bw = D.skinW[v * 8 + k]; best = D.skinIdx[v * 8 + k]; }
        if (!armSet.has(best)) torso.push(v);
        if (footSet.has(best)) feet.push(v);
        else if (c++ % 9 === 0) sparse.push(v);
      }
      this.torsoVerts = Int32Array.from(torso);
      this.footVerts = Int32Array.from(feet);
      this.sparseVerts = Int32Array.from(sparse);
      this.soles = new Int32Array(feet.length);
      this.nSoles = 0;
      this.prof = new Float32Array(200 * 3); // per cm of height: half width, front, back
      this.profRaw = new Float32Array(200 * 3);

      this.lm = { S: V(), hip: V(), knee: V(), ankle: V(), chin: V() };
      this.relax = {};
      this.base = new Float32Array(NCH);
      this.restP = new Float32Array(NCH);
      this.P = new Float32Array(NCH);
      this.tmp = new Float32Array(NCH);
      this.gaitP = new Float32Array(NCH);
      this.bufs = {};
      for (const a of ACTIONS.concat(HOME)) this.bufs[a.id] = new Float32Array(NCH);
      this.byId = {};
      for (const a of ACTIONS.concat(HOME)) this.byId[a.id] = a;

      // public API
      this.actions = ACTIONS.map(({ id, label, group }) => ({ id, label, group }));
      this.emotions = EMOTIONS.map(({ id, label, emoji }) => ({ id, label, emoji }));
      this.speed = 1;
      this.paused = false;
      this.state = { breath: 0, breathRate: 14, heartRate: 68, heartPhase: 0, emotion: 'neutral', emotionAmount: 0, action: 'idle', talking: false };

      this.time = 0;
      this.want = 'idle';
      this.layers = [];
      this.emo = new Float32Array(EMOTIONS.length);
      this.emoTarget = new Float32Array(EMOTIONS.length);
      this.lookAt = true;
      this.talking = false;
      this.pos = V(); this.heading = 0; this.homing = false; this.turnRate = 0; this.vel = 0;
      this.gait = { phase: 0, on: false, feet: [0, 1].map(() => ({ stance: true, x: 0, z: 0, yaw: 0, lx: 0, lz: 0, lyaw: 0, tx: 0, tz: 0, tyaw: 0, ph: 0 })) };
      this.rand = rng(1234567);
      this.breathPh = 0.3; this.breath = 0; this.breathRate = 14; this.breathAmp = 1; this.sighT = 6; this.sighK = 0;
      this.heartRate = 68; this.heartPh = 0; this.exert = 0; this.sweat = 0;
      this.blinkT = 9; this.nextBlink = 1.2; this.blinkL = 0; this.blinkR = 0; this.doubleBlink = false; this.wink = 0; this.winkT = 5;
      this.sacT = 0.5; this.sacYaw = 0; this.sacPitch = 0;
      this.glanceT = 2; this.glance = 0; this.glanceGoal = 0; this.awayYaw = 0.6;
      this.lookYaw = 0; this.lookPitch = 0; this.eyeYaw = [0, 0]; this.eyePitch = [0, 0]; this.prevHeadYaw = 0; this.eyeLead = 0;
      this.laugh = 0; this.sob = 0; this.yawn = 0; this.yawnT = 6;
      this.talk = { t: 0, syl: 0, sylDur: 0.2, phrase: 2, pause: 0, inPhrase: true, cur: 0, next: 0, amp: 0, stress: 0, gesture: 0, gestureGoal: 0 };
      this.vis = new Float32Array(6);
      this.dt = 0;
      // MakeHuman face units: per bone rotations in the rest-WORLD frame
      // (MakeHuman's skeleton.setPose turns them into bone-local poses)
      this.F = {};
      this.units = {};
      for (const k in D.faceUnits) {
        this.F[k] = 0;
        const u = D.faceUnits[k];
        this.units[k] = Object.keys(u).map((b) => ({ b: +b, q: new THREE.Quaternion().fromArray(u[b]) }));
      }
      this.faceQ = h.bones.map(() => QT());
      this.faceHit = new Uint8Array(nb);
      this.faceList = new Int32Array(nb);
      this.camLocal = V();
      this.gazeTarget = V();

      const q = app.query;
      if (q.get('action') && this.byId[q.get('action')]) this.setAction(q.get('action'), true);
      if (q.get('emotion') && EMO_INDEX[q.get('emotion')] !== undefined) {
        this.setEmotion(q.get('emotion'), q.get('amount') !== null ? parseFloat(q.get('amount')) : 1);
        this.emo.set(this.emoTarget);
      }
      if (q.get('talk') === '1') this.setTalking(true);
    }

    // ------------------------------------------------------------ API
    setAction(id, instant) {
      if (!this.byId[id] || id === 'walkhome') return;
      this.want = id;
      if (instant) { this.layers = [{ a: this.byId[id], t: 0, w: 1 }]; }
    }
    setEmotion(id, amount = 1) {
      const i = EMO_INDEX[id];
      if (i === undefined) return;
      this.emoTarget.fill(0);
      if (i > 0) this.emoTarget[i] = clamp(amount, 0, 1);
      this.state.emotion = id;
      this.state.emotionAmount = i > 0 ? clamp(amount, 0, 1) : 0;
    }
    setTalking(on) { this.talking = !!on; this.state.talking = this.talking; }
    setLookAtCamera(on) { this.lookAt = !!on; }

    // --------------------------------------------------- measurements
    onParams(p) {
      this.params = p;
      this.measure();
    }

    measure() {
      const h = this.human, fit = h.fit, nb = this.nb, R = this.rest;
      for (let i = 0; i < nb; i++) R[i].fromArray(fit[i].head);
      const Pm = h.P, SC = BS.SCALE, g = h.ground;
      const vx = (v) => Pm[v * 3] * SC, vy = (v) => Pm[v * 3 + 1] * SC - g, vz = (v) => Pm[v * 3 + 2] * SC;
      // torso / leg silhouette per centimetre of height
      const pr = this.prof;
      for (let b = 0; b < 200; b++) { pr[b * 3] = 0; pr[b * 3 + 1] = -1; pr[b * 3 + 2] = 1; }
      for (const v of this.torsoVerts) {
        const b = clamp(Math.floor(vy(v) * 100), 0, 199), x = Math.abs(vx(v)), z = vz(v);
        if (x > pr[b * 3]) pr[b * 3] = x;
        if (z > pr[b * 3 + 1]) pr[b * 3 + 1] = z;
        if (z < pr[b * 3 + 2]) pr[b * 3 + 2] = z;
      }
      // the base mesh is sparse per centimetre: dilate over +-2 cm
      const raw = this.profRaw;
      raw.set(pr);
      for (let b = 0; b < 200; b++) {
        for (let j = Math.max(0, b - 2); j <= Math.min(199, b + 2); j++) {
          if (raw[j * 3] > pr[b * 3]) pr[b * 3] = raw[j * 3];
          if (raw[j * 3 + 1] > pr[b * 3 + 1]) pr[b * 3 + 1] = raw[j * 3 + 1];
          if (raw[j * 3 + 2] < pr[b * 3 + 2]) pr[b * 3 + 2] = raw[j * 3 + 2];
        }
      }
      for (let b = 1; b < 200; b++) if (pr[b * 3 + 1] < -0.5) { pr[b * 3] = pr[b * 3 - 3]; pr[b * 3 + 1] = pr[b * 3 - 2]; pr[b * 3 + 2] = pr[b * 3 - 1]; }
      // soles: the lowest foot vertices
      this.nSoles = 0;
      for (const v of this.footVerts) if (vy(v) < 0.03) this.soles[this.nSoles++] = v;

      // arms: rest frames for IK
      for (let s = 0; s < 2; s++) {
        const a = this.arm[s];
        a.S.copy(R[a.ua]);
        const E = R[a.la], W = R[a.wr];
        a.a = E.distanceTo(a.S); a.b = W.distanceTo(E);
        _u.subVectors(E, a.S).normalize(); _f.subVectors(W, E).normalize();
        _n.crossVectors(_u, _f).normalize();
        basisQuat(a.qU0, _u, _n).invert();
        basisQuat(a.qF0, _f, _n).invert();
        a.d0.subVectors(W, a.S).normalize();
        a.f0 = a.f0 || V(); a.f0.copy(_f); a.n0 = a.n0 || V(); a.n0.copy(_n);
        // hand frame: palm normal and wrist flexion axis
        const hd = _v1.subVectors(R[a.fingers[2][0]], W).normalize();
        const kn = _v2.subVectors(R[a.fingers[1][0]], R[a.fingers[4][0]]);
        a.palmN.crossVectors(hd, kn).normalize();
        if (a.palmN.y > 0) a.palmN.negate();
        a.flexAx.crossVectors(hd, a.palmN).normalize();
      }
      // legs
      for (let s = 0; s < 2; s++) {
        const l = this.leg[s];
        const Hh = R[l.ul], K = R[l.ll], Ak = R[l.foot];
        l.a = K.distanceTo(Hh); l.b = Ak.distanceTo(K);
        _u.subVectors(K, Hh).normalize(); _f.subVectors(Ak, K).normalize();
        _n.copy(AX).addScaledVector(_u, -_u.x).normalize();
        basisQuat(l.qU0, _u, _n).invert();
        _n.copy(AX).addScaledVector(_f, -_f.x).normalize();
        basisQuat(l.qF0, _f, _n).invert();
      }
      const lm = this.lm, aL = this.arm[0], lL = this.leg[0], B = this.B;
      lm.S.copy(aL.S);
      lm.hip.copy(R[lL.ul]); lm.knee.copy(R[lL.ll]); lm.ankle.copy(R[lL.foot]);
      lm.legA = lL.a; lm.legB = lL.b;
      this.legLen = lL.a + lL.b;
      this.legScale = this.legLen / 0.8;
      this.armLen = aL.a + aL.b;
      lm.chin.fromArray(fit[B.jaw].tail);
      lm.chinY = lm.chin.y; lm.chinZ = lm.chin.z;
      lm.eyeY = R[B.eye[0]].y; lm.eyeZ = R[B.eye[0]].z;
      lm.top = fit[B.head].tail[1];
      lm.neckY = R[B.neck[0]].y;
      lm.handLen = R[aL.fingers[2][2]].distanceTo(R[aL.wr]) + fit[aL.fingers[2][2]].length;
      lm.handHalf = lm.handLen * 0.11;
      lm.chestY = fit[B.breast[0]].tail[1];
      lm.chestZ = this.front(lm.chestY);
      // waist: narrowest point between the hips and the ribs
      let wy = 0.95, ww = 9;
      for (let y = lm.hip.y + 0.06; y < lm.chestY - 0.08; y += 0.01) { const w = this.halfW(y); if (w < ww) { ww = w; wy = y; } }
      lm.waistY = wy; lm.waistW = ww;
      lm.thighX = this.halfW(lm.hip.y - 0.15);
      // feet
      let heel = 0, ball = 0, toe = 0;
      for (let i = 0; i < this.nSoles; i++) {
        const v = this.soles[i];
        if (vx(v) <= 0) continue;
        const z = vz(v) - lm.ankle.z;
        if (z < heel) heel = z;
        if (z > toe) toe = z;
      }
      ball = (R[lL.toes[0]].z + R[lL.toes[2]].z) * 0.5 - lm.ankle.z;
      lm.heel = heel; lm.ball = ball; lm.toeLen = toe - ball;
      // sitting / kneeling heights
      lm.sitHip = 0.1 * this.legScale + Math.max(0, lm.hip.z - this.back(lm.hip.y - 0.06)) * 0.25;
      lm.kneelHip = lL.a * 0.97 + 0.05;
      lm.sitKneeX = lm.hip.x + lL.a * 0.72; lm.sitKneeY = 0.17 * this.legScale; lm.sitKneeZ = lm.hip.z + lL.a * 0.62;

      this.fitRelaxedArm();
      this.buildBase();
      this.buildRest();
    }
    halfW(y) { return this.prof[clamp(Math.round(y * 100), 0, 199) * 3]; }
    front(y) { return this.prof[clamp(Math.round(y * 100), 0, 199) * 3 + 1]; }
    back(y) { return this.prof[clamp(Math.round(y * 100), 0, 199) * 3 + 2]; }

    // the least abduction that keeps a hanging arm clear of hips and torso
    fitRelaxedArm() {
      const a = this.arm[0], lm = this.lm, S = a.S;
      const bend = 16 * DEG, reach = Math.sqrt(a.a * a.a + a.b * a.b + 2 * a.a * a.b * Math.cos(bend)) / (a.a + a.b);
      const r = reach * (a.a + a.b), fwd = 7 * DEG;
      const poleV = _v3.set(0.45, 0, -1);
      let ab = 4 * DEG;
      for (; ab < 40 * DEG; ab += 0.5 * DEG) {
        _v4.set(Math.sin(ab), -Math.cos(ab) * Math.cos(fwd), Math.cos(ab) * Math.sin(fwd)).multiplyScalar(r).add(S);
        ik2(S, _v4, poleV, a.a, a.b, 0, _u, _f, _n);
        const ex = S.x + _u.x * a.a, ey = S.y + _u.y * a.a;
        const wx = _v4.x, wy = _v4.y;
        const ok = ex > this.halfW(ey) + 0.045 && wx > this.halfW(wy) + 0.035 &&
          wx > this.halfW(wy - lm.handLen * 0.5) + lm.handHalf + 0.012 && wx > this.halfW(wy - lm.handLen * 0.85) + lm.handHalf + 0.01;
        if (ok) break;
      }
      const d = _v4.sub(S).normalize();
      Object.assign(this.relax, { ax: d.x, ay: d.y, az: d.z, reach, px: poleV.x, py: poleV.y, pz: poleV.z, abd: ab });
      this.relax.pron = this.palmIn;
    }

    buildBase() {
      const P = this.base, r = this.relax, lm = this.lm;
      P.fill(0);
      P[C.look] = 1; P[C.eyes] = 1; P[C.breath] = 1; P[C.free] = 1; P[C.hipY] = -0.006;
      for (let s = 0; s < 2; s++) {
        const o = SIDE[s];
        P[o + A.ax] = r.ax; P[o + A.ay] = r.ay; P[o + A.az] = r.az; P[o + A.reach] = r.reach;
        P[o + A.px] = r.px; P[o + A.py] = r.py; P[o + A.pz] = r.pz;
        P[o + A.pron] = r.pron; P[o + A.flex] = 0.12; P[o + A.dev] = -0.05;
        P[o + A.curl] = 0.3; P[o + A.thumb] = 0.25; P[o + A.spread] = 0.05; P[o + A.grav] = 0.6;
        P[o + A.fx] = -Math.min(0.04, Math.max(0, lm.ankle.x - lm.hip.x - 0.035)); P[o + A.fyaw] = 0.12;
        P[o + A.kx] = 0.12; P[o + A.kz] = 1;
      }
    }

    // channels that reproduce MakeHuman's rest pose exactly
    buildRest() {
      const P = this.restP;
      P.fill(0);
      P[C.breath] = 1;
      for (let s = 0; s < 2; s++) {
        const o = SIDE[s], a = this.arm[s], sx = s ? -1 : 1;
        const W = this.rest[a.wr];
        const d = _v1.subVectors(W, a.S), len = d.length();
        d.divideScalar(len);
        P[o + A.ax] = d.x * sx; P[o + A.ay] = d.y; P[o + A.az] = d.z; P[o + A.reach] = len / (a.a + a.b);
        const p = _v2.crossVectors(d, a.n0);
        P[o + A.px] = p.x * sx; P[o + A.py] = p.y; P[o + A.pz] = p.z;
        P[o + A.kz] = 1;
      }
    }

    // ---------------------------------------------------- pose helpers
    stand(P, t, k) {
      // weight rests on one leg for a while, then shifts across
      const w = Math.tanh(2.6 * noise(t * 0.085 + 3.1)) * k;
      P[C.hipX] += w * 0.026 + noise(t * 0.21 + 9) * 0.004 * k;
      P[C.hipZ] += noise(t * 0.17 + 2) * 0.006 * k;
      P[C.pelRoll] += w * 0.055;
      P[C.pelYaw] += w * 0.03;
      P[C.side] -= w * 0.035;
      P[C.headRoll] += w * 0.025;
      for (let s = 0; s < 2; s++) {
        const o = SIDE[s], unload = clamp(s ? w : -w, 0, 1);
        this.footPivot(P, o, s, P[o + A.fx], 0, P[o + A.fz], -0.12 * unload * unload, 1);
        P[o + A.kx] += 0.15 * unload;
      }
    }
    armLife(P, t, k) {
      for (let s = 0; s < 2; s++) {
        const o = SIDE[s], ph = s * 7.3;
        P[o + A.ax] += 0.012 * noise(t * 0.3 + ph) * k;
        P[o + A.az] += 0.02 * noise(t * 0.25 + ph + 3) * k;
        P[o + A.curl] += 0.06 * noise(t * 0.2 + ph + 5) * k;
        P[o + A.flex] += 0.05 * noise(t * 0.22 + ph + 8) * k;
      }
    }

    // foot pose rotating about the heel (pitch > 0, toes up) or the ball
    // (pitch < 0, heel up). x, z: flat-foot ankle offset in side-local
    // channel space; y: lift.
    footPivot(P, o, s, x, y, z, pitch, k) {
      const lm = this.lm, piv = pitch > 0 ? lm.heel : lm.ball, h = lm.ankle.y;
      const c = Math.cos(pitch), sn = Math.sin(pitch);
      const ry = h * c - piv * sn, rz = -h * sn - piv * c;
      P[o + A.fx] = lerp(P[o + A.fx], x, k);
      P[o + A.fy] = lerp(P[o + A.fy], y + ry - h, k);
      P[o + A.fz] = lerp(P[o + A.fz], z + piv + rz, k);
      P[o + A.fpitch] = lerp(P[o + A.fpitch], pitch, k);
      P[o + A.toe] = lerp(P[o + A.toe], Math.max(0, -pitch), k);
    }
    // swing an arm forward (alpha) from the relaxed hang; bend = elbow angle
    swingArm(P, o, alpha, bend, abd, k) {
      const r = this.relax, a = this.arm[0];
      const reach = Math.sqrt(a.a * a.a + a.b * a.b + 2 * a.a * a.b * Math.cos(bend)) / (a.a + a.b);
      const al = alpha + bend * 0.5;
      const c = Math.cos(al), s = Math.sin(al);
      // rotate the hang direction forward about x, then out about z
      let x = r.ax + abd, y = r.ay * c - r.az * s, z = r.ay * s + r.az * c;
      const pc = Math.cos(alpha), ps = Math.sin(alpha);
      arm(P, o, x, y, z, reach, k);
      pole(P, o, r.px, r.py * pc - r.pz * ps, r.py * ps + r.pz * pc, k);
    }
    // aim the wrist at a rest-space point (side-local x)
    armTo(P, o, x, y, z, k = 1) {
      const S = this.lm.S;
      const dx = x - S.x, dy = y - S.y, dz = z - S.z, d = Math.hypot(dx, dy, dz) || 1e-6;
      // reach may exceed 1: a target anchored to a moving body part is only
      // reachable once that part has moved; the IK clamps it then
      arm(P, o, dx, dy, dz, d / this.armLen, k);
    }
    poseHips(P, k) {
      const lm = this.lm, y = lm.waistY + 0.01, x = this.halfW(y) + 0.028;
      for (let s = 0; s < 2; s++) {
        const o = SIDE[s];
        anchor(P, o, 0, 1, 0, 0, k);
        this.armTo(P, o, x, y, (this.front(y) + this.back(y)) * 0.5 - 0.015, k);
        pole(P, o, 1, 0.1, -0.7, k);
        hand(P, o, this.palmIn + 0.3, 0.55, -0.35, 0.3, 0.1, 0, k);
      }
    }
    poseHip(P, s, k) {
      const lm = this.lm, y = lm.waistY + 0.01, x = this.halfW(y) + 0.028, o = SIDE[s];
      anchor(P, o, 0, 1, 0, 0, k);
      this.armTo(P, o, x, y, (this.front(y) + this.back(y)) * 0.5 - 0.015, k);
      pole(P, o, 1, 0.1, -0.7, k);
      hand(P, o, this.palmIn + 0.3, 0.55, -0.35, 0.3, 0.1, 0, k);
    }
    poseCrossArms(P, k) {
      const lm = this.lm, y = lm.chestY - 0.11;
      for (let s = 0; s < 2; s++) {
        const o = SIDE[s];
        anchor(P, o, 1, 0, 0, 0, k);
        this.armTo(P, o, -0.1, y + (s ? 0.035 : 0), this.front(y) + (s ? 0.085 : 0.05), k);
        pole(P, o, 1, -0.5, -0.2, k);
        hand(P, o, this.palmIn, 0.15, 0, 0.35, 0.3, 0, k);
        P[o + A.fwd] += 0.04 * k;
      }
    }
    poseChin(P, s, k) {
      const lm = this.lm, o = SIDE[s];
      anchor(P, o, 0, 0, 1, 0, k);
      this.armTo(P, o, 0.015, lm.chinY - 0.075, lm.chinZ + 0.03, k);
      pole(P, o, 0.2, -1, 0.1, k);
      hand(P, o, this.palmIn, -0.45, 0, 0.7, 0.4, 0, k);
    }
    poseSupport(P, s, k) {
      const lm = this.lm, o = SIDE[s], y = lm.chestY - 0.2;
      anchor(P, o, 1, 0, 0, 0, k);
      this.armTo(P, o, -0.08, y, this.front(y) + 0.06, k);
      pole(P, o, 1, -0.4, -0.3, k);
      hand(P, o, this.palmUp, 0, 0, 0.3, 0.2, 0, k);
    }
    poseClasp(P, where, k, fists) {
      const lm = this.lm, y = where === 'low' ? lm.hip.y - 0.1 : lm.chestY - 0.02;
      const z = where === 'low' ? this.front(lm.hip.y - 0.02) + 0.05 : this.front(y) + 0.06;
      for (let s = 0; s < 2; s++) {
        const o = SIDE[s];
        anchor(P, o, where === 'low' ? 0 : 1, where === 'low' ? 1 : 0, 0, 0, k);
        this.armTo(P, o, lm.handHalf + 0.01, y, z, k);
        pole(P, o, 1, -0.8, -0.5, k);
        hand(P, o, this.palmIn, 0.1, 0, fists ? 0.85 : 0.45, 0.4, 0, k);
      }
    }
    poseBelly(P, s, k) {
      const lm = this.lm, o = SIDE[s], y = lm.waistY - 0.02;
      anchor(P, o, 0, 1, 0, 0, k);
      this.armTo(P, o, 0.04, y, this.front(y) + 0.03, k);
      pole(P, o, 1, -0.6, -0.4, k);
      hand(P, o, this.palmIn + 0.4, 0.2, 0, 0.25, 0.2, 0.05, k);
    }
    poseWipe(P, s, t) {
      const lm = this.lm, o = SIDE[s], u = t % 5, k = env(u, 0.5, 1.0, 2.6, 3.2);
      anchor(P, o, 0, 0, 1, 0, k);
      this.armTo(P, o, 0.03 + 0.01 * Math.sin(t * 7), lm.eyeY - 0.075, lm.eyeZ + 0.05, k);
      pole(P, o, 0.3, -1, -0.1, k);
      hand(P, o, this.palmIn, -0.2, 0, 0.6, 0.3, 0, k);
    }
    poseScratch(P, s, t) {
      const lm = this.lm, o = SIDE[s], u = t % 6, k = env(u, 1, 1.5, 3, 3.6);
      anchor(P, o, 0, 0, 1, 0, k);
      this.armTo(P, o, 0.06, lm.eyeY + 0.03 + 0.01 * Math.sin(t * 14), lm.eyeZ - 0.14, k);
      pole(P, o, 1, 0.3, 0.3, k);
      hand(P, o, this.palmIn, 0.2, 0, 0.45 + 0.2 * Math.sin(t * 14), 0.3, 0, k);
    }
    poseYawnHand(P, s) {
      const lm = this.lm, o = SIDE[s], k = sstep(0.25, 0.6, this.yawn);
      anchor(P, o, 0, 0, 1, 0, k);
      this.armTo(P, o, 0.02, lm.chinY + 0.0, lm.chinZ + 0.07, k);
      pole(P, o, 0.4, -1, -0.1, k);
      hand(P, o, this.palmIn, 0.1, 0, 0.3, 0.2, 0, k);
    }
    poseHair(P, s, t) {
      const lm = this.lm, o = SIDE[s], u = t % 7, k = env(u, 1, 1.6, 3.6, 4.3);
      anchor(P, o, 0, 0, 1, 0, k);
      this.armTo(P, o, 0.1, lm.eyeY - 0.06 + 0.015 * Math.sin(t * 3), lm.eyeZ - 0.12, k);
      pole(P, o, 1, -0.5, 0, k);
      hand(P, o, this.palmIn, 0.1, 0, 0.5, 0.4, 0, k);
    }
    // push-up plank: the straight body pivots about the balls of the feet
    plank(P, d) {
      P.set(this.restP);
      const lm = this.lm, a = this.arm[0];
      const ballZ = lm.ankle.z + lm.ball;
      const rS = Math.hypot(lm.S.y, lm.S.z - ballZ), dS = Math.atan2(lm.S.z - ballZ, lm.S.y);
      const upY = a.a + a.b + 0.03, dnY = Math.max(0.13, this.front(lm.chestY) - lm.S.z + 0.07);
      const sy = lerp(upY, dnY, d);
      const beta = Math.acos(clamp(sy / rS, -1, 1)) - dS;
      // root pivots about the ball line
      const R = this.rest[this.B.root], ry = R.y, rz = R.z - ballZ;
      const c = Math.cos(beta), sn = Math.sin(beta);
      P[C.pelPitch] = beta;
      P[C.hipY] = ry * c - rz * sn - ry;
      P[C.hipZ] = ry * sn + rz * c + ballZ - R.z;
      const hy = lm.ankle.y, hz = lm.ankle.z - ballZ;
      const shZ = rS * Math.sin(beta + dS) + ballZ;
      for (let s = 0; s < 2; s++) {
        const o = SIDE[s];
        P[o + A.fy] = hy * c - hz * sn - hy;
        P[o + A.fz] = hy * sn + hz * c + ballZ - lm.ankle.z;
        P[o + A.fpitch] = -beta; P[o + A.toe] = Math.min(1.3, beta * 0.95);
        P[o + A.kz] = 1;
        anchor(P, o, 0, 0, 0, 1, 1);
        this.armTo(P, o, lm.S.x + 0.06, 0.035, lerp(shZ, rS * Math.sin(Math.acos(clamp(upY / rS, -1, 1))) + ballZ, d) + 0.02);
        pole(P, o, 0.6, 0, -1);
        hand(P, o, this.palmDown, -1.35, 0, 0.08, 0.15, 0.15);
      }
      P[C.headPitch] = -0.25; P[C.breath] = 1;
    }

    // ------------------------------------------------------------ update
    update(dt) {
      dt = this.paused ? 0 : Math.min(dt, 0.1) * this.speed;
      this.dt = dt;
      this.time += dt;
      const t = this.time;
      this.updateLayers(dt);
      this.updateLife(dt, t);
      const P = this.P;
      this.blend(P);
      this.applyEmotion(P, t);
      this.applyLife(P, t);
      this.solve(P);
      this.face(t);
      this.ground(P);
      this.publish();
    }

    updateLayers(dt) {
      // walking back to the middle before starting anything else
      const away = Math.hypot(this.pos.x, this.pos.z) > 0.04 || Math.abs(wrap(this.heading)) > 0.06;
      if (this.want === 'walkaround') this.homing = false;
      else if (away && this.homing === false && this.layerW('walkaround') > 0.01) this.homing = true;
      else if (!away) this.homing = false;
      const id = this.homing ? 'walkhome' : this.want;
      const L = this.layers;
      let top = L[L.length - 1];
      if (!top || top.a.id !== id) {
        const i = L.findIndex((l) => l.a.id === id);
        if (i >= 0) { top = L[i]; L.splice(i, 1); L.push(top); }
        else { top = { a: this.byId[id], t: 0, w: L.length ? 0 : 1 }; L.push(top); }
      }
      const rate = dt / 0.35;
      for (const l of L) { l.t += dt; l.w = l === top ? Math.min(1, l.w + rate) : Math.max(0, l.w - rate); }
      for (let i = L.length - 2; i >= 0; i--) if (L[i].w <= 0) L.splice(i, 1);
      if (L.length > 4) L.splice(0, L.length - 4);
      this.state.action = this.want;

      // locomotion: steer the root and run the gait
      let wl = 0, wRun = 0, wMove = 0;
      for (const l of L) {
        if (!LOCO[l.a.id]) continue;
        wl += l.w;
        if (l.a.id === 'run') wRun += l.w;
        if (l.a.id === 'walkaround' || l.a.id === 'walkhome') wMove += l.w;
      }
      if (wl > 0.001) {
        const style = wRun / wl;
        const vWalk = 1.15 * this.legScale, vRun = 2.7 * this.legScale;
        let v = lerp(vWalk, vRun, style), w = 0;
        if (wMove > 0.001) {
          const st = this.steer(dt, this.homing ? 'home' : 'around', vWalk);
          v = lerp(v, st.v, wMove / wl); w = st.w * wMove / wl;
          this.heading += st.w * dt * wMove;
          this.pos.x += Math.sin(this.heading) * st.v * dt * wMove;
          this.pos.z += Math.cos(this.heading) * st.v * dt * wMove;
        }
        if (!this.gait.on) this.gaitStart();
        this.gaitStep(dt, style, v, w);
        this.gaitWrite(this.gaitP, style, v, w);
      } else this.gait.on = false;
      // settle exactly home once there
      if (!this.homing && this.want !== 'walkaround' && wMove < 0.001) {
        const k = Math.min(1, dt * 3);
        this.pos.multiplyScalar(1 - k);
        this.heading -= wrap(this.heading) * k + (this.heading - wrap(this.heading));
      }
    }
    layerW(id) { let w = 0; for (const l of this.layers) if (l.a.id === id) w += l.w; return w; }

    steer(dt, mode, vWalk) {
      const p = this.pos, out = this._steer || (this._steer = { v: 0, w: 0 });
      let tx, tz, v = vWalk * 0.85;
      if (mode === 'around') {
        const R = 1.1 * Math.sqrt(this.legScale), r = Math.hypot(p.x, p.z);
        const ang = r > 0.25 ? Math.atan2(p.x, p.z) : this.heading - PI / 2;
        tx = Math.sin(ang + 0.75) * R; tz = Math.cos(ang + 0.75) * R;
      } else { tx = 0; tz = 0; }
      const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
      let want = Math.atan2(dx, dz);
      if (mode === 'home') {
        v = vWalk * 0.8 * sstep(0.02, 0.5, dist);
        if (dist < 0.08) want = 0;
      }
      const diff = wrap(want - this.heading);
      out.w = clamp(diff * 2.4, -1.5, 1.5);
      out.v = v * (1 - 0.6 * sstep(0.6, 1.6, Math.abs(diff)));
      return out;
    }

    // --------------------------------------------------------------- gait
    gaitStart() {
      const g = this.gait, lm = this.lm;
      g.on = true; g.phase = 0;
      g.feet.forEach((f, s) => {
        const sx = s ? -1 : 1;
        f.stance = true; f.x = sx * (lm.ankle.x + this.base[SIDE[s] + A.fx]); f.z = lm.ankle.z; f.yaw = sx * 0.1;
      });
    }
    gaitStep(dt, style, v, w) {
      const g = this.gait, lm = this.lm;
      const T = lerp(1.08, 0.7, style) * Math.sqrt(this.legScale), duty = lerp(0.62, 0.37, style);
      g.T = T; g.duty = duty;
      g.phase = (g.phase + dt / T) % 1;
      const width = lerp(Math.max(0.07, lm.hip.x * 0.8), Math.max(0.055, lm.hip.x * 0.6), style);
      const c = Math.cos(-w * dt), sn = Math.sin(-w * dt);
      for (let s = 0; s < 2; s++) {
        const f = g.feet[s], sx = s ? -1 : 1, fp = (g.phase + s * 0.5) % 1;
        f.ph = fp;
        if (fp < duty) {
          if (!f.stance) { f.stance = true; f.x = f.tx; f.z = f.tz; f.yaw = f.tyaw; }
          // the ground carries the planted foot back (and around when turning)
          const x = f.x, z = f.z - lm.ankle.z;
          f.x = x * c + z * sn; f.z = -x * sn + z * c - v * dt + lm.ankle.z; f.yaw -= w * dt;
        } else {
          if (f.stance) { f.stance = false; f.lx = f.x; f.lz = f.z; f.lyaw = f.yaw; }
          const half = v * duty * T * 0.5, turn = w * duty * T * 0.5;
          const nx = sx * width, nz = half + 0.02 * this.legScale;
          const tc = Math.cos(turn), ts = Math.sin(turn);
          f.tx = nx * tc + nz * ts; f.tz = -nx * ts + nz * tc + lm.ankle.z; f.tyaw = sx * lerp(0.12, 0.06, style) + turn;
          const e = mjerk((fp - duty) / (1 - duty));
          f.x = lerp(f.lx, f.tx, e); f.z = lerp(f.lz, f.tz, e); f.yaw = lerp(f.lyaw, f.tyaw, e);
        }
      }
    }
    gaitWrite(P, style, v, w) {
      P.set(this.base);
      const g = this.gait, lm = this.lm, ls = this.legScale, ph = g.phase, duty = g.duty;
      const strike = lerp(0.24, 0.1, style), toeOff = lerp(0.5, 0.75, style);
      const lift = lerp(0.075, 0.2, style) * ls, kick = lerp(0, 0.18, style) * ls;
      for (let s = 0; s < 2; s++) {
        const f = g.feet[s], o = SIDE[s], sx = s ? -1 : 1, fp = f.ph;
        let pitch, y = 0, back = 0;
        if (fp < duty) {
          const sg = fp / duty;
          pitch = sg < 0.15 ? strike * (1 - sg / 0.15) * (1 - sg / 0.15) : sg > 0.55 ? -toeOff * Math.pow((sg - 0.55) / 0.45, 1.6) : 0;
        } else {
          const sw = (fp - duty) / (1 - duty);
          pitch = sw < 0.45 ? lerp(-toeOff, 0.05, sstep(0, 0.45, sw)) : lerp(0.05, strike, sstep(0.45, 1, sw));
          y = lift * Math.pow(Math.sin(PI * Math.pow(sw, 0.8)), 1.3);
          back = kick * Math.sin(PI * Math.min(1, sw * 1.6)) * (1 - sw);
        }
        // flat-foot ankle position in body space, then pivot the foot
        const ax = f.x, az = f.z - back;
        this.footPivot(P, o, s, sx * ax - lm.ankle.x, y, az - lm.ankle.z, pitch, 1);
        if (pitch > 0) P[o + A.toe] = 0;
        // the pivot offset runs along the foot's own heading
        const fz = P[o + A.fz] - (az - lm.ankle.z), yaw = f.yaw;
        P[o + A.fz] = az - lm.ankle.z + fz * Math.cos(yaw);
        P[o + A.fx] += sx * fz * Math.sin(yaw);
        P[o + A.fyaw] = sx * yaw;
        P[o + A.kx] = 0.12 + sx * Math.sin(yaw) * 0.8; P[o + A.kz] = 1;
      }
      // pelvis and spine
      const a = ph * TAU;
      const peak = lerp(0.31, 0.43, style);
      P[C.hipY] = lerp(-0.026, -0.032, style) * ls + lerp(0.012, 0.028, style) * ls * Math.cos(2 * (a - peak * TAU));
      P[C.hipX] = lerp(0.022, 0.008, style) * Math.sin(a - 0.3);
      P[C.hipZ] = lerp(0.01, 0.05, style);
      P[C.pelRoll] = lerp(0.07, 0.05, style) * Math.sin(a);
      P[C.pelYaw] = -lerp(0.1, 0.16, style) * Math.cos(a);
      P[C.twist] = lerp(0.16, 0.28, style) * Math.cos(a);
      P[C.pelPitch] = lerp(0.04, 0.1, style);
      P[C.bendLo] = lerp(0.0, 0.06, style); P[C.bendHi] = lerp(0.03, 0.1, style);
      P[C.side] = 0.25 * w * v / Math.max(0.5, v) + lerp(0.03, 0.02, style) * Math.sin(a);
      P[C.headPitch] = -lerp(0.04, 0.12, style); P[C.headRoll] = -0.5 * P[C.pelRoll];
      P[C.look] = lerp(0.85, 0.5, style); P[C.free] = 0;
      // arms counter-swing
      for (let s = 0; s < 2; s++) {
        const o = SIDE[s], sw = -Math.cos(a - s * PI - 0.25);
        const amp = lerp(0.3, 0.6, style);
        const bend = lerp(0.22, 1.45, style) + lerp(0.25, 0.2, style) * Math.max(0, sw);
        this.swingArm(P, o, amp * sw + lerp(0.02, 0.15, style), bend, lerp(0.02, 0.06, style), 1);
        P[o + A.grav] = 0.3;
        P[o + A.curl] = lerp(0.3, 0.75, style); P[o + A.thumb] = lerp(0.25, 0.6, style);
        P[o + A.pron] = lerp(this.palmIn, this.palmIn + 0.25, style);
      }
    }

    // ---------------------------------------------------------- blending
    blend(P) {
      let tw = 0;
      P.fill(0);
      for (const l of this.layers) {
        if (l.w <= 0) continue;
        const B = this.bufs[l.a.id];
        B.set(this.base);
        l.a.fn(this, B, l.t);
        for (let i = 0; i < NCH; i++) P[i] += B[i] * l.w;
        tw += l.w;
      }
      if (tw > 0) for (let i = 0; i < NCH; i++) P[i] /= tw;
      else P.set(this.base);
    }

    // ------------------------------------------------------ idle life
    updateLife(dt, t) {
      const R = this.rand, E = this.emo;
      // emotion weights glide to their target (~0.4 s)
      const ke = 1 - Math.exp(-dt / 0.13);
      for (let i = 0; i < E.length; i++) E[i] += (this.emoTarget[i] - E[i]) * ke;
      let bRate = 1, bAmp = 0, hr = 0, blinkRate = 1, sigh = 0, flush = 0, wet = 0, energy = 0, tremble = 0, wink = 0;
      for (let i = 1; i < E.length; i++) {
        const e = EMOTIONS[i], k = E[i];
        if (k < 0.001) continue;
        bRate += ((e.breath || 1) - 1) * k; hr += (e.heart || 0) * k; blinkRate += ((e.blink || 1) - 1) * k;
        sigh += (e.sigh || 0) * k; flush += (e.flush || 0) * k; wet += (e.wet || 0) * k; energy += (e.energy || 0) * k;
        tremble += (e.tremble || 0) * k; wink += (e.wink || 0) * k;
      }
      this.energy = energy; this.tremble = tremble;
      // exertion from the action mix builds up and fades slowly
      let ex = 0;
      for (const l of this.layers) ex += (l.a.exert || 0) * l.w;
      this.exert += (ex - this.exert) * (1 - Math.exp(-dt / (ex > this.exert ? 6 : 14)));
      this.sweat = clamp(this.sweat + dt * (this.exert > 0.55 ? 0.01 : -0.004), 0, 0.6);
      // breathing
      const rate = clamp((13 + 26 * this.exert) * bRate, 8, 48);
      this.breathRate += (rate - this.breathRate) * (1 - Math.exp(-dt / 2));
      let sp = this.breathRate / 60;
      this.sighT -= dt;
      if (this.sighT < 0 && this.breathPh < 0.05) { this.sighK = sigh > 0.2 ? 1 : 0; this.sighT = 5 + R() * 6 / Math.max(0.3, sigh); }
      if (this.sighK > 0) sp *= 0.6;
      this.breathPh += sp * dt;
      if (this.breathPh >= 1) { this.breathPh -= 1; this.sighK = 0; }
      const bp = this.breathPh;
      this.breath = sstep(0, 0.4, bp) * (1 - sstep(0.45, 0.92, bp));
      this.breathAmp = (0.6 + 0.6 * this.exert + bAmp) * (1 + 1.3 * this.sighK);
      // heart
      const hrT = clamp(66 + 95 * this.exert + hr, 48, 185);
      this.heartRate += (hrT - this.heartRate) * (1 - Math.exp(-dt / (hrT > this.heartRate ? 3 : 7)));
      this.heartPh = (this.heartPh + this.heartRate / 60 * dt) % 1;
      // laughter fits, sobs and yawns drive animated emotions
      const fitT = t % 2.6;
      this.laugh = env(fitT, 0, 0.15, 1.6, 2.0);
      this.sob = Math.pow(Math.max(0, Math.sin(t * 2.3 + 1.5 * noise(t * 0.7))), 6);
      this.yawnT -= dt;
      if (this.yawnT < 0) { this.yawnT = 9 + R() * 6; }
      const yu = 15 - this.yawnT;
      this.yawn = E[EMO_INDEX.tired] > 0.3 ? env(yu - 9, 0, 1.2, 2.6, 3.6) : 0;
      // blinks: random intervals, sometimes doubled, more on big gaze shifts
      this.nextBlink -= dt;
      this.blinkT += dt;
      if (this.nextBlink <= 0) {
        this.blinkT = 0;
        this.doubleBlink = R() < 0.14;
        this.nextBlink = (this.doubleBlink ? 0.32 : 0) + (1.6 + R() * 4.2) / clamp(blinkRate, 0.3, 3);
      }
      const bt = this.blinkT, slow = 1 + 0.6 * clamp(-blinkRate + 1, 0, 1);
      let b = bt < 0.065 * slow ? sstep(0, 0.065 * slow, bt) : 1 - sstep(0.09 * slow, 0.26 * slow, bt);
      if (this.doubleBlink && bt > 0.3) { const b2 = bt - 0.3; b = Math.max(b, b2 < 0.06 ? sstep(0, 0.06, b2) : 1 - sstep(0.08, 0.24, b2)); }
      this.blink = b;
      // a wink now and then when flirty
      this.winkT -= dt;
      if (this.winkT < 0) this.winkT = 5 + R() * 4;
      this.wink = wink > 0.3 ? env(this.winkT, 0.1, 0.22, 0.45, 0.65) * wink : 0;
      // saccades
      this.sacT -= dt;
      const dart = E[EMO_INDEX.scared];
      if (this.sacT <= 0) {
        this.sacT = (0.35 + R() * 2.2) * (1 - 0.7 * dart);
        const amp = 0.035 + 0.1 * dart;
        this.sacYaw = (R() * 2 - 1) * amp; this.sacPitch = (R() * 2 - 1) * amp * 0.6;
      }
      // glances away and back (shy, bored)
      this.glanceT -= dt;
      if (this.glanceT <= 0) {
        this.glanceGoal = this.glanceGoal > 0.5 ? 0 : 1;
        this.glanceT = this.glanceGoal ? 1 + R() * 2.5 : 0.8 + R() * 2;
        if (this.glanceGoal) this.awayYaw = (R() < 0.5 ? -1 : 1) * (0.4 + R() * 0.4);
      }
      this.glance += (this.glanceGoal - this.glance) * (1 - Math.exp(-dt / 0.25));
      this.flush = clamp(flush + 0.25 * clamp(this.exert - 0.4, 0, 1), 0, 1);
      this.wet = clamp(Math.max(wet, this.sweat), 0, 1);
      this.updateTalk(dt);
    }

    updateTalk(dt) {
      const T = this.talk, R = this.rand, vis = this.vis;
      let goal = 0;
      if (this.talking) {
        T.t += dt;
        if (T.inPhrase) {
          T.syl += dt;
          if (T.syl >= T.sylDur) {
            T.syl = 0;
            T.sylDur = 0.11 + R() * 0.13;
            T.cur = R() < 0.55 ? VOWELS[(R() * VOWELS.length) | 0] : CONS[(R() * CONS.length) | 0];
            T.stress = R() < 0.22 ? 1 : 0;
            T.amp = 0.75 + R() * 0.4 + 0.3 * T.stress;
          }
          T.phrase -= dt;
          if (T.phrase <= 0) { T.inPhrase = false; T.pause = 0.25 + R() * 0.7; T.gestureGoal = R() < 0.6 ? 1 : 0; }
          goal = 1;
        } else {
          T.pause -= dt;
          if (T.pause <= 0) { T.inPhrase = true; T.phrase = 1.2 + R() * 2.6; }
        }
      } else T.gestureGoal = 0;
      const shape = VISEMES[T.cur], k = 1 - Math.exp(-dt / 0.045);
      for (let i = 0; i < 6; i++) vis[i] += ((goal ? shape[i] * T.amp : 0) - vis[i]) * k;
      T.gesture += (T.gestureGoal * (this.talking ? 1 : 0) - T.gesture) * (1 - Math.exp(-dt / 0.5));
    }

    applyEmotion(P, t) {
      const E = this.emo, tmp = this.tmp, free = clamp(P[C.free], 0, 1);
      for (let i = 1; i < E.length; i++) {
        const e = EMOTIONS[i], k = E[i];
        if (k < 0.002) continue;
        const post = k * (0.4 + 0.6 * free);
        for (let j = 0; j < e.off.length; j += 2) P[e.off[j]] += e.off[j + 1] * post;
        if (e.arms && free > 0.01) {
          tmp.set(P);
          e.arms(this, tmp, t);
          const kk = k * free;
          for (let s = 0; s < 2; s++) for (let j = SIDE[s] + A.ax; j < SIDE[s] + A.grav + 1; j++) P[j] += (tmp[j] - P[j]) * kk;
        }
      }
      // happy bounce, fear trembling, laughing and sobbing shoulders
      const en = this.energy * free;
      if (en > 0.01) { P[C.hipY] -= 0.006 * en * (0.5 + 0.5 * Math.sin(t * 5.2)); P[C.headRoll] += 0.03 * en * Math.sin(t * 2.6); }
      const tr = this.tremble;
      if (tr > 0.01) for (let s = 0; s < 2; s++) P[SIDE[s] + A.ax] += 0.006 * tr * noise(t * 22 + s * 9);
      const lk = E[EMO_INDEX.laughing];
      if (lk > 0.01) {
        const j = this.laugh * lk * (0.5 + 0.5 * Math.sin(t * TAU * 4.6));
        P[C.bendHi] += 0.05 * j - 0.04 * lk * this.laugh; P[C.headPitch] -= 0.06 * lk * this.laugh;
        for (let s = 0; s < 2; s++) P[SIDE[s] + A.shrug] += 0.06 * j;
      }
      const ck = E[EMO_INDEX.crying];
      if (ck > 0.01) for (let s = 0; s < 2; s++) P[SIDE[s] + A.shrug] += 0.08 * this.sob * ck;
    }

    applyLife(P, t) {
      // breathing lifts the chest and shoulders; micro head motion
      const b = this.breath * this.breathAmp * P[C.breath];
      P[C.bendHi] -= 0.03 * b; P[C.headPitch] += 0.022 * b;
      for (let s = 0; s < 2; s++) P[SIDE[s] + A.shrug] += 0.018 * b;
      const lw = clamp(P[C.look], 0, 1);
      P[C.headPitch] += 0.012 * noise(t * 0.55 + 1) * (0.5 + 0.5 * lw);
      P[C.headYaw] += 0.018 * noise(t * 0.4 + 7);
      P[C.headRoll] += 0.012 * noise(t * 0.35 + 4);
      // talking: head beats and hand gestures
      const T = this.talk;
      if (this.talking) {
        const beat = T.stress * this.vis[0];
        P[C.headPitch] += 0.035 * beat - 0.01; P[C.headYaw] += 0.03 * noise(t * 1.3 + 2);
        P[C.headRoll] += 0.02 * noise(t * 0.9 + 5);
      }
      const g = T.gesture * clamp(P[C.free], 0, 1);
      if (g > 0.01) {
        const lm = this.lm;
        for (let s = 0; s < 2; s++) {
          const o = SIDE[s], ph = s * 1.7, kk = g * (s ? 1 : 0.65);
          const bob = 0.03 * noise(t * 2.2 + ph) + 0.02 * T.stress * this.vis[0];
          P[o + A.grav] *= 1 - kk;
          const y = lm.waistY + 0.02 + bob, x = lm.S.x + 0.06 + 0.05 * noise(t * 0.7 + ph);
          this.armTo(P, o, x, y, this.front(y) + 0.2, kk);
          pole(P, o, 0.6, -1, -0.5, kk);
          hand(P, o, this.palmUp - 0.4, -0.1, 0, 0.25, 0.15, 0.25, kk);
        }
      }
    }

    // ------------------------------------------------------------- solve
    fk(i) {
      const p = this.par[i], H = this.H, D = this.Dq;
      if (p < 0) { D[i].copy(this.Q[i]); H[i].copy(this.rest[i]).add(this.human.rootOffset); return; }
      D[i].multiplyQuaternions(D[p], this.Q[i]);
      H[i].subVectors(this.rest[i], this.rest[p]).applyQuaternion(D[p]).add(H[p]);
    }
    // world delta of bone i must become `d`: set its local pose from it
    setDelta(i, d) { this.Q[i].copy(this.Dq[this.par[i]]).invert().multiply(d); this.fk(i); }

    solve(P) {
      const h = this.human, Q = this.Q, B = this.B, nb = this.nb;
      for (let i = 0; i < nb; i++) { Q[i].identity(); this.loc[i].identity(); }
      const psi = this.heading;
      eul(Q[B.root], P[C.pelPitch], psi + P[C.pelYaw], P[C.pelRoll]);
      _v1.set(P[C.hipX], P[C.hipY], P[C.hipZ]).applyAxisAngle(AY, psi);
      h.rootOffset.set(this.pos.x + _v1.x, _v1.y, this.pos.z + _v1.z);
      this.fk(B.root);
      // spine
      const bl = P[C.bendLo], bh = P[C.bendHi], sd = -P[C.side], tw = P[C.twist];
      const sp = B.spine;
      this.fk(sp[0]);
      eul(Q[sp[1]], bl * 0.5, tw * 0.15, sd * 0.2); this.fk(sp[1]);
      eul(Q[sp[2]], bl * 0.5, tw * 0.2, sd * 0.25); this.fk(sp[2]);
      eul(Q[sp[3]], bh * 0.45, tw * 0.3, sd * 0.3); this.fk(sp[3]);
      eul(Q[sp[4]], bh * 0.55, tw * 0.35, sd * 0.25); this.fk(sp[4]);
      this.solveHead(P);
      for (let s = 0; s < 2; s++) this.solveArm(P, s);
      for (let s = 0; s < 2; s++) this.solveLeg(P, s);
      for (let s = 0; s < 2; s++) this.solveHand(P, s);
      // to MakeHuman's local pose convention
      for (let i = 0; i < nb; i++) {
        const r = h.restGlobalQuat[i];
        h.pose[i].copy(r).invert().multiply(Q[i]).multiply(r).multiply(this.loc[i]);
      }
    }

    solveHead(P) {
      const Q = this.Q, B = this.B, Dq = this.Dq, H = this.H, dt = this.dt;
      const chest = B.spine[4];
      // gaze target: the camera (or straight ahead), pushed around by mood
      const E = this.emo;
      let down = 0, away = 0, mul = 1, glance = 0;
      for (let i = 1; i < E.length; i++) {
        const g = EMOTIONS[i].gaze, k = E[i];
        if (!g || k < 0.001) continue;
        down += (g.down || 0) * k; away += (g.away || 0) * k; mul += ((g.mul ?? 1) - 1) * k; glance += (g.glance || 0) * k;
      }
      const cam = this.app.camera.position;
      _v1.subVectors(cam, H[B.neck[2]]).applyQuaternion(_q1.copy(Dq[chest]).invert());
      let yaw = Math.atan2(_v1.x, _v1.z), pitch = Math.atan2(-_v1.y, Math.hypot(_v1.x, _v1.z));
      const behind = 1 - sstep(1.75, 2.3, Math.abs(yaw));
      const lw = clamp(P[C.look], 0, 1) * (this.lookAt ? 1 : 0) * behind * clamp(mul, 0, 1.2);
      const awayYaw = away * this.awayYaw * (glance > 0.2 ? this.glance : 1) / 0.6;
      const tyaw = clamp(yaw * 0.72 * lw + awayYaw * 0.8, -1.15, 1.15);
      const tpitch = clamp(pitch * 0.6 * lw + down * 0.7, -0.5, 0.6);
      const kk = 1 - Math.exp(-dt / 0.22);
      this.lookYaw += (tyaw - this.lookYaw) * kk;
      this.lookPitch += (tpitch - this.lookPitch) * kk;
      const hy = P[C.headYaw] + this.lookYaw, hp = P[C.headPitch] + this.lookPitch, hr = -P[C.headRoll], nk = P[C.neck];
      const N = B.neck;
      eul(Q[N[0]], nk * 0.45 + hp * 0.12, hy * 0.18, hr * 0.2); this.fk(N[0]);
      eul(Q[N[1]], nk * 0.35 + hp * 0.18, hy * 0.24, hr * 0.25); this.fk(N[1]);
      eul(Q[N[2]], nk * 0.2 + hp * 0.25, hy * 0.26, hr * 0.25); this.fk(N[2]);
      eul(Q[B.head], hp * 0.45, hy * 0.32, hr * 0.3); this.fk(B.head);
      // eyes lead head turns, then aim at the target (each eye on its own)
      const hv = dt > 0 ? (hy - this.prevHeadYaw) / dt : 0;
      this.prevHeadYaw = hy;
      this.eyeLead += (clamp(hv * 0.12, -0.3, 0.3) - this.eyeLead) * (1 - Math.exp(-dt / 0.08));
      const ew = clamp(P[C.eyes], 0, 1) * (this.lookAt ? 1 : 0) * behind;
      const ke = 1 - Math.exp(-dt / 0.03);
      _q1.copy(Dq[B.head]).invert();
      for (let s = 0; s < 2; s++) {
        const e = B.eye[s];
        this.fk(this.par[this.par[e]]); this.fk(this.par[e]); this.fk(e);
        _v2.subVectors(cam, H[e]).applyQuaternion(_q1);
        const ey = Math.atan2(_v2.x, _v2.z), ep = Math.atan2(-_v2.y, Math.hypot(_v2.x, _v2.z));
        let gy = ey * ew * clamp(mul, 0, 1) + awayYaw * 0.35 + this.eyeLead + this.sacYaw;
        let gp = ep * ew * clamp(mul, 0, 1) + down * 0.5 + this.sacPitch;
        gy = clamp(gy, -0.6, 0.6); gp = clamp(gp, -0.45, 0.5);
        this.eyeYaw[s] += (gy - this.eyeYaw[s]) * ke;
        this.eyePitch[s] += (gp - this.eyePitch[s]) * ke;
        eul(Q[e], this.eyePitch[s], this.eyeYaw[s], 0);
        // lids follow the eye up and down
        const p = this.eyePitch[s];
        eul(Q[B.lidUp[s]], p * (p > 0 ? 0.7 : 0.45), this.eyeYaw[s] * 0.15, 0);
        eul(Q[B.lidLo[s]], p * 0.35, this.eyeYaw[s] * 0.1, 0);
      }
    }

    solveArm(P, s) {
      const a = this.arm[s], o = SIDE[s], sx = s ? -1 : 1, Q = this.Q, Dq = this.Dq, H = this.H;
      const chest = this.B.spine[4];
      // wanted wrist direction drives shoulder girdle motion
      const d = _v1.set(sx * P[o + A.ax], P[o + A.ay], P[o + A.az]);
      if (d.lengthSq() < 1e-6) d.copy(a.d0); else d.normalize();
      const elev = Math.acos(clamp(-d.y, -1, 1));
      const shrug = P[o + A.shrug] + 0.32 * Math.max(0, elev - 1.45), fwd = P[o + A.fwd] + 0.12 * Math.max(0, d.z) * sstep(0.8, 1.6, elev);
      eul(Q[a.clav], 0, -sx * fwd, sx * shrug);
      this.fk(a.clav);
      _q1.setFromUnitVectors(a.d0, d);
      Q[a.sh].identity().slerp(_q1, 0.22);
      this.fk(a.sh);
      this.fk(a.ua);
      const S = H[a.ua];
      // wrist target from the blended anchors
      const len = a.a + a.b;
      const pr = _v2.copy(d).multiplyScalar(P[o + A.reach] * len).add(a.S); // rest space
      let wc = clamp(P[o + A.chest], 0, 1), wp = clamp(P[o + A.pelvis], 0, 1), wh = clamp(P[o + A.head], 0, 1), ww = clamp(P[o + A.world], 0, 1);
      const sum = wc + wp + wh + ww;
      if (sum > 1) { wc /= sum; wp /= sum; wh /= sum; ww /= sum; }
      const wsh = Math.max(0, 1 - wc - wp - wh - ww);
      const T = _v3.set(0, 0, 0);
      if (wsh > 0) {
        _v4.subVectors(pr, a.S);
        _v5.copy(_v4).applyQuaternion(Dq[chest]);
        const g = clamp(P[o + A.grav], 0, 1);
        if (g > 0) { _v6.copy(_v4).applyAxisAngle(AY, this.heading); _v5.lerp(_v6, g); }
        T.addScaledVector(_v5.add(S), wsh);
      }
      if (wc > 0) T.addScaledVector(this.boneSpace(chest, pr, _v4), wc);
      if (wp > 0) T.addScaledVector(this.boneSpace(this.B.spine[0], pr, _v4), wp);
      if (wh > 0) T.addScaledVector(this.boneSpace(this.B.head, pr, _v4), wh);
      if (ww > 0) T.addScaledVector(this.bodySpace(pr, _v4), ww);
      const pl = _v4.set(sx * P[o + A.px], P[o + A.py], P[o + A.pz]).applyQuaternion(Dq[chest]);
      ik2(S, T, pl, a.a, a.b, 0.01 * len, _u, _f, _n);
      basisQuat(_q2, _u, _n).multiply(a.qU0);
      this.setDelta(a.ua, _q2);
      this.fk(a.ua2);
      // forearm: hinge, then pronation spread over the two forearm bones
      basisQuat(_q3, _f, _n).multiply(a.qF0);
      const pron = sx * P[o + A.pron];
      _q1.setFromAxisAngle(_f, pron * 0.35).multiply(_q3);
      this.setDelta(a.la, _q1);
      _q1.setFromAxisAngle(_f, pron).multiply(_q3);
      this.setDelta(a.la2, _q1);
    }

    solveHand(P, s) {
      const a = this.arm[s], o = SIDE[s], sx = s ? -1 : 1, Q = this.Q, loc = this.loc;
      _q1.setFromAxisAngle(a.flexAx, P[o + A.flex]);
      _q2.setFromAxisAngle(a.palmN, sx * P[o + A.dev]);
      Q[a.wr].copy(_q1).multiply(_q2);
      // fingers: curl in local x, more toward the little finger
      const curl = clamp(P[o + A.curl], -0.2, 1.1), sp = P[o + A.spread];
      for (let f = 1; f < 5; f++) {
        const c = clamp(curl * (0.88 + 0.08 * f) + (f === 1 ? P[o + A.index] : 0), -0.25, 1.1);
        const fb = a.fingers[f];
        loc[fb[0]].setFromAxisAngle(AX, c * 1.45);
        _q1.setFromAxisAngle(AZ, sp * (f - 2.4) * -0.12);
        loc[fb[0]].premultiply(_q1);
        loc[fb[1]].setFromAxisAngle(AX, c * 1.65);
        loc[fb[2]].setFromAxisAngle(AX, c * 1.1);
      }
      for (let k = 2; k < 4; k++) loc[a.meta[k]].setFromAxisAngle(AX, curl * 0.08 * (k - 1));
      const th = clamp(P[o + A.thumb], 0, 1.1), tb = a.fingers[0];
      loc[tb[0]].setFromAxisAngle(AX, th * 0.35);
      loc[tb[1]].setFromAxisAngle(AX, th * 0.55);
      loc[tb[2]].setFromAxisAngle(AX, th * 0.75);
    }

    solveLeg(P, s) {
      const l = this.leg[s], o = SIDE[s], sx = s ? -1 : 1, Q = this.Q, H = this.H;
      this.fk(l.pel); this.fk(l.ul);
      const Hh = H[l.ul];
      const R = this.rest;
      const ra = R[l.foot];
      _v2.set(ra.x + sx * P[o + A.fx], ra.y + P[o + A.fy], ra.z + P[o + A.fz]);
      const T = this.bodySpace(_v2, _v3);
      const fyaw = sx * P[o + A.fyaw];
      _v4.set(sx * P[o + A.kx], P[o + A.ky], P[o + A.kz]).applyAxisAngle(AY, this.heading + fyaw * 0.6);
      ik2(Hh, T, _v4, l.a, l.b, 0.012 * (l.a + l.b), _u, _f, _n);
      basisQuat(_q2, _u, _n).multiply(l.qU0);
      this.setDelta(l.ul, _q2);
      this.fk(this.par[l.ll]);
      basisQuat(_q3, _f, _n).multiply(l.qF0);
      this.setDelta(l.ll, _q3);
      this.fk(this.par[l.foot]);
      eul(_q1, -P[o + A.fpitch], this.heading + fyaw, -sx * P[o + A.froll]);
      this.setDelta(l.foot, _q1);
      const toe = P[o + A.toe];
      if (toe) for (const ti of l.toes) Q[ti].setFromAxisAngle(AX, -toe);
    }

    boneSpace(i, p, out) { return out.subVectors(p, this.rest[i]).applyQuaternion(this.Dq[i]).add(this.H[i]); }
    bodySpace(p, out) {
      const piv = this.rest[this.B.root];
      out.set(p.x - piv.x, p.y, p.z - piv.z).applyAxisAngle(AY, this.heading);
      return out.set(out.x + piv.x + this.pos.x, out.y, out.z + piv.z + this.pos.z);
    }

    // --------------------------------------------------------------- face
    face(t) {
      const F = this.F, E = this.emo, h = this.human;
      for (const k in F) F[k] = 0;
      for (let i = 1; i < E.length; i++) {
        const e = EMOTIONS[i], k = E[i];
        if (k < 0.002) continue;
        for (const u in e.face) F[u] += e.face[u] * k;
        if (e.anim) e.anim(this, F, t, k);
      }
      // talking visemes on top of the expression
      const v = this.vis;
      F.JawDrop += v[0]; F.LipsKiss += v[1]; F.MouthLeftPullSide += v[2] * 0.6; F.MouthRightPullSide += v[2] * 0.6;
      F.UpperLipUp += v[3]; F.lowerLipUp += v[4]; F.lowerLipBackward += v[5];
      if (this.talking) {
        const st = this.talk.stress * v[0];
        F.LeftOuterBrowUp += 0.35 * st; F.RightOuterBrowUp += 0.3 * st; F.LeftInnerBrowUp += 0.2 * st; F.RightInnerBrowUp += 0.2 * st;
      }
      // blinks close whatever the lids are doing
      for (let s = 0; s < 2; s++) {
        const w = Math.max(this.blink, s ? 0 : this.wink), c = LID_CLOSE[s], o = LID_OPEN[s];
        F[c] = lerp(F[c], 1.05, w); F[o] *= 1 - w; F[LID_LOW[s]] += 0.15 * w;
      }
      this.blendFace(F);
      const u = h.skinUniforms;
      if (u) {
        if (u.uFlush) u.uFlush.value = this.flush;
        if (u.uWet) u.uWet.value = this.wet;
      }
    }

    // blend face units as MakeHuman's PoseUnit.getBlendedPose (slerp each
    // from rest by its weight, premultiply), then move each bone's world
    // rotation into its local pose frame: local = rest^-1 * world * rest
    blendFace(F) {
      const h = this.human, U = this.units, FQ = this.faceQ, hit = this.faceHit, list = this.faceList;
      let n = 0;
      for (const name in F) {
        const w = F[name];
        if (w < 1e-3 && w > -1e-3) continue;
        const a = Math.min(1.5, Math.abs(w));
        for (const { b, q } of U[name]) {
          if (!hit[b]) { hit[b] = 1; FQ[b].identity(); list[n++] = b; }
          _q1.copy(q);
          if (w < 0) _q1.invert();
          _q2.identity().slerp(_q1, a);
          FQ[b].premultiply(_q2);
        }
      }
      for (let i = 0; i < n; i++) {
        const b = list[i], r = h.restGlobalQuat[b];
        _q1.copy(r).invert().multiply(FQ[b]).multiply(r);
        h.pose[b].multiply(_q1);
        hit[b] = 0;
      }
    }

    // keep the body on the floor: nothing below y = 0, sitting rests on it
    ground(P) {
      const h = this.human;
      h.applyPose();
      let min = Infinity;
      for (let i = 0; i < this.nSoles; i++) { const y = h.baseVertex(this.soles[i], _v7).y; if (y < min) min = y; }
      const g = clamp(P[C.ground], 0, 1);
      if (g > 0.01 || P[C.pelPitch] > 0.5) {
        const sv = this.sparseVerts;
        for (let i = 0; i < sv.length; i++) { const y = h.baseVertex(sv[i], _v7).y; if (y < min) min = y; }
      }
      const dy = g * -min + (1 - g) * Math.max(0, -min);
      if (Math.abs(dy) > 1e-5) h.rootOffset.y += dy;
    }

    publish() {
      const st = this.state;
      st.breath = clamp(this.breath * (0.55 + 0.45 * clamp(this.breathAmp, 0, 1)), 0, 1);
      st.breathRate = this.breathRate;
      st.heartRate = this.heartRate;
      st.heartPhase = this.heartPh;
    }
  }
  // palm orientations, as forearm pronation from the rest pose (tuned by eye)
  Motion.prototype.palmIn = 0.9;
  Motion.prototype.palmDown = 0;
  Motion.prototype.palmUp = 2.4;
  Motion.prototype.palmFwd = 1.6;

  BS.registerModule({ name: 'motion', order: 0, create: (app) => new Motion(app) });
})();
