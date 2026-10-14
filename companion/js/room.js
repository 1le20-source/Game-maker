// Her room: the default scene. Procedural, stylised and cheap: a few dozen
// meshes, canvas textures, one warm point light, glow done with additive points.
//
// Layout (she stands at the origin facing +z, the camera looks from +z):
//   back wall z = -1.9 with the window (city + moon), fairy lights above
//   left: desk with lamp, laptop and shelves      right: bed with a sleeping cat
//   telescope by the window, rug under her, CRT + console by the left wall.

import { mulberry32 } from './util.js';

const W = 5.0, H = 2.7, BACK = -1.9, FRONT = 2.6;
const WIN = { x: 0.15, y: 1.56, w: 1.5, h: 1.22 };

export function registerRoom(stage) {
  stage.registerScene('room', buildRoom, { name: 'Her room', desc: 'Lamp on, fairy lights, the city outside.' });
}

function buildRoom({ THREE, toonMaterial, canvasTexture, app }) {
  const g = new THREE.Group();
  g.name = 'room';
  const anims = [];
  const reduced = () => app.state.settings?.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;

  const add = (mesh, x = 0, y = 0, z = 0, parent = g) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const cyl = (rt, rb, h, mat, seg = 20) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  const ball = (r, mat, ws = 16, hs = 12) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat);

  // ---- textures ---------------------------------------------------------
  const wallTex = canvasTexture(512, 1024, (c, w, h) => {
    // upper wall: deep night blue with soft stripes and tiny stars
    c.fillStyle = '#3a4468'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 64) { c.fillStyle = 'rgba(255,255,255,0.035)'; c.fillRect(x + 20, 0, 24, h); }
    const rnd = mulberry32(7);
    c.fillStyle = 'rgba(255,236,200,0.16)';
    for (let i = 0; i < 40; i++) {
      const x = rnd() * w, y = rnd() * h * 0.6;
      c.beginPath(); c.arc(x, y, 2 + rnd() * 2, 0, Math.PI * 2); c.fill();
    }
    // wainscot (lower third)
    const wy = h * (1 - 0.95 / H);
    c.fillStyle = '#2c3352'; c.fillRect(0, wy, w, h - wy);
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 3;
    for (let x = 0; x < w; x += 128) c.strokeRect(x + 14, wy + 30, 100, h - wy - 70);
    c.fillStyle = '#d8cdb8'; c.fillRect(0, wy - 8, w, 12); // chair rail
    c.fillStyle = '#1d2238'; c.fillRect(0, h - 26, w, 26); // skirting
    // fake ambient occlusion top and bottom
    let gr = c.createLinearGradient(0, 0, 0, 120); gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr; c.fillRect(0, 0, w, 120);
    gr = c.createLinearGradient(0, h - 140, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = gr; c.fillRect(0, h - 140, w, 140);
  });
  wallTex.wrapS = THREE.RepeatWrapping;

  const floorTex = canvasTexture(512, 512, (c, w, h) => {
    const rnd = mulberry32(3);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 200;
      while (x < w) {
        const len = 160 + rnd() * 200;
        const tone = 0.85 + rnd() * 0.25;
        c.fillStyle = `rgb(${(150 * tone) | 0},${(98 * tone) | 0},${(62 * tone) | 0})`;
        c.fillRect(x, r * (h / rows), len, h / rows);
        // grain
        c.strokeStyle = 'rgba(70,40,20,0.18)'; c.lineWidth = 1;
        for (let k = 0; k < 5; k++) {
          const yy = r * (h / rows) + 6 + rnd() * (h / rows - 12);
          c.beginPath(); c.moveTo(x + 4, yy); c.bezierCurveTo(x + len * 0.3, yy + 3, x + len * 0.6, yy - 3, x + len - 4, yy); c.stroke();
        }
        c.fillStyle = 'rgba(40,22,10,0.55)'; c.fillRect(x, r * (h / rows), 2, h / rows);
        x += len;
      }
      c.fillStyle = 'rgba(40,22,10,0.5)'; c.fillRect(0, r * (h / rows), w, 2);
    }
  }, { repeat: [3, 3] });

  // ---- shell ------------------------------------------------------------
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  const wallPiece = (x0, x1, y0, y1, z, rotY = 0, uOff = 0) => {
    const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      uv.setXY(i, (uOff + x0 + u * (x1 - x0)) / 1.25, (y0 + v * (y1 - y0)) / H);
    }
    const m = new THREE.Mesh(geo, wallMat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
    m.rotation.y = rotY;
    return m;
  };
  const wl = WIN.x - WIN.w / 2, wr = WIN.x + WIN.w / 2, wb = WIN.y - WIN.h / 2, wt = WIN.y + WIN.h / 2;
  g.add(wallPiece(-W / 2, wl, 0, H, BACK), wallPiece(wr, W / 2, 0, H, BACK), wallPiece(wl, wr, 0, wb, BACK), wallPiece(wl, wr, wt, H, BACK));
  // side walls: build along x then rotate into place
  const side = (x, rot) => {
    const m = wallPiece(BACK, FRONT, 0, H, 0, 0, 3);
    m.rotation.y = rot;
    m.position.set(x, H / 2, (BACK + FRONT) / 2);
    g.add(m);
  };
  side(-W / 2, Math.PI / 2);
  side(W / 2, -Math.PI / 2);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, FRONT - BACK + 2), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  add(floor, 0, 0, (BACK + FRONT + 2) / 2);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, FRONT - BACK), new THREE.MeshBasicMaterial({ color: '#171a2c' }));
  ceiling.rotation.x = Math.PI / 2;
  add(ceiling, 0, H, (BACK + FRONT) / 2);

  // ---- window + city ----------------------------------------------------
  const skyTex = canvasTexture(1024, 640, drawCity);
  // 1.2 m behind the wall so it parallaxes against the frame when orbiting
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.6), new THREE.MeshBasicMaterial({ map: skyTex, toneMapped: false }));
  add(sky, WIN.x, 1.7, BACK - 1.2);
  const frameMat = toonMaterial('#e9e2d4');
  const fw = 0.07;
  add(box(WIN.w + fw * 2, fw, 0.12, frameMat), WIN.x, wt + fw / 2, BACK);
  add(box(WIN.w + fw * 2, fw, 0.12, frameMat), WIN.x, wb - fw / 2, BACK);
  add(box(fw, WIN.h, 0.12, frameMat), wl - fw / 2, WIN.y, BACK);
  add(box(fw, WIN.h, 0.12, frameMat), wr + fw / 2, WIN.y, BACK);
  add(box(0.035, WIN.h, 0.05, frameMat), WIN.x, WIN.y, BACK);
  add(box(WIN.w, 0.035, 0.05, frameMat), WIN.x, WIN.y + 0.12, BACK);
  add(box(WIN.w + 0.3, 0.05, 0.24, frameMat), WIN.x, wb - 0.07, BACK + 0.1); // sill
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(WIN.w, WIN.h), new THREE.MeshBasicMaterial({ color: '#9fc0ff', transparent: true, opacity: 0.06, depthWrite: false }));
  add(glass, WIN.x, WIN.y, BACK - 0.01);
  // moon glow over the window area
  const moonGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.4), new THREE.MeshBasicMaterial({ map: radialTex(canvasTexture, [170, 200, 255], 0.25), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  add(moonGlow, WIN.x + 0.3, WIN.y + 0.2, BACK + 0.02);

  // curtains: wavy planes on both sides, tied back
  const curtainTex = canvasTexture(256, 512, (c, w, h) => {
    c.fillStyle = '#8f6478'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      const gr = c.createLinearGradient(x, 0, x + 32, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0.18)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(0,0,0,0.18)');
      c.fillStyle = gr; c.fillRect(x, 0, 32, h);
    }
    c.fillStyle = 'rgba(255,230,210,0.35)'; c.fillRect(0, h - 26, w, 8);
  });
  const curtainMat = toonMaterial('#ffffff', { map: curtainTex, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(0.42, 1.75, 18, 8);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const pinch = 1 - 0.45 * Math.exp(-((y + 0.25) ** 2) / 0.02); // tie-back
      p.setX(i, x * pinch);
      p.setZ(i, Math.sin(x * 38) * 0.03 * pinch);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, curtainMat);
    add(m, s < 0 ? wl - 0.2 : wr + 0.2, wt - 0.82, BACK + 0.12);
  }
  const rod = cyl(0.015, 0.015, WIN.w + 1.0, toonMaterial('#c9a46a'), 8);
  rod.rotation.z = Math.PI / 2;
  add(rod, WIN.x, wt + 0.1, BACK + 0.13);

  // ---- fairy lights -------------------------------------------------------
  const bulbs = [];
  const swag = (x0, x1, y, sag, n, loops, z) => {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const segT = (t * loops) % 1;
      bulbs.push(new THREE.Vector3(x, y - Math.sin(segT * Math.PI) * sag, z));
    }
  };
  swag(-2.4, 2.4, 2.55, 0.22, 34, 3, BACK + 0.06);
  swag(wl - 0.25, wr + 0.25, wt + 0.06, 0.3, 26, 2, BACK + 0.16);
  const bulbGeo = new THREE.BufferGeometry().setFromPoints(bulbs);
  const bulbColors = new Float32Array(bulbs.length * 3);
  const baseCols = bulbs.map((_, i) => new THREE.Color(['#ffd27a', '#ffb3a1', '#fff1c4', '#ffc46b'][i % 4]));
  baseCols.forEach((c, i) => c.toArray(bulbColors, i * 3));
  bulbGeo.setAttribute('color', new THREE.BufferAttribute(bulbColors, 3));
  const glowTex = radialTex(canvasTexture, [255, 255, 255], 1);
  const glow = new THREE.Points(bulbGeo, new THREE.PointsMaterial({ size: 0.16, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.85 }));
  const cores = new THREE.Points(bulbGeo, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, toneMapped: false }));
  g.add(glow, cores);
  // wire: one line per strand (35 + 27 points)
  for (const [a, b] of [[0, 35], [35, bulbs.length]]) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(bulbs.slice(a, b)), new THREE.LineBasicMaterial({ color: '#1a1d2b' })));
  anims.push((dt, t) => {
    if (reduced()) return;
    for (let i = 0; i < bulbs.length; i++) {
      const k = 0.72 + 0.28 * Math.sin(t * (0.9 + (i % 5) * 0.23) + i * 1.7);
      bulbColors[i * 3] = baseCols[i].r * k;
      bulbColors[i * 3 + 1] = baseCols[i].g * k;
      bulbColors[i * 3 + 2] = baseCols[i].b * k;
    }
    bulbGeo.attributes.color.needsUpdate = true;
  });

  // ---- desk corner (left) -------------------------------------------------
  const wood = toonMaterial('#9a6a45');
  const woodDark = toonMaterial('#6e4a32');
  const desk = new THREE.Group();
  add(box(1.35, 0.045, 0.62, wood), 0, 0.74, 0, desk);
  add(box(0.04, 0.72, 0.58, woodDark), -0.63, 0.36, 0, desk);
  add(box(0.42, 0.62, 0.56, woodDark), 0.44, 0.36, 0, desk); // drawers
  add(box(0.36, 0.012, 0.01, toonMaterial('#d9c7a4')), 0.44, 0.52, 0.285, desk);
  add(box(0.36, 0.012, 0.01, toonMaterial('#d9c7a4')), 0.44, 0.3, 0.285, desk);
  desk.position.set(-1.62, 0, BACK + 0.36);
  g.add(desk);

  // laptop with a sketch on screen (she studies illustration)
  const screenTex = canvasTexture(256, 160, (c, w, h) => {
    c.fillStyle = '#f4efe6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2b2f45'; c.fillRect(0, 0, w, 14); c.fillRect(0, 14, 22, h);
    c.fillStyle = '#ff9f6b'; c.fillRect(5, 22, 12, 12); c.fillStyle = '#7fb7ff'; c.fillRect(5, 40, 12, 12);
    c.strokeStyle = '#3a3346'; c.lineWidth = 3; c.lineCap = 'round';
    // a cat doodle
    c.beginPath(); c.ellipse(140, 100, 46, 34, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(108, 80); c.lineTo(112, 52); c.lineTo(128, 70); c.moveTo(152, 70); c.lineTo(168, 52); c.lineTo(172, 80); c.stroke();
    c.beginPath(); c.arc(126, 96, 3, 0, 7); c.arc(154, 96, 3, 0, 7); c.fill();
    c.beginPath(); c.moveTo(186, 112); c.quadraticCurveTo(222, 120, 214, 80); c.stroke();
  });
  const laptop = new THREE.Group();
  add(box(0.36, 0.015, 0.25, toonMaterial('#b8bdc9')), 0, 0, 0, laptop);
  const lid = new THREE.Group();
  add(box(0.36, 0.24, 0.012, toonMaterial('#b8bdc9')), 0, 0.12, 0, lid);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.21), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  add(scr, 0, 0.12, 0.007, lid);
  lid.position.set(0, 0.008, -0.12);
  lid.rotation.x = -0.28;
  laptop.add(lid);
  laptop.position.set(-1.45, 0.77, BACK + 0.38);
  laptop.rotation.y = 0.35;
  g.add(laptop);

  // lamp + warm light
  const lamp = new THREE.Group();
  const lampMat = toonMaterial('#e8c26a');
  add(cyl(0.07, 0.08, 0.025, lampMat), 0, 0, 0, lamp);
  const arm = cyl(0.012, 0.012, 0.42, lampMat, 8); arm.rotation.z = 0.35; add(arm, 0.07, 0.2, 0, lamp);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.13, 20, 1, true), toonMaterial('#f0d17a', { side: THREE.DoubleSide }));
  shade.rotation.z = -0.5; add(shade, 0.16, 0.42, 0, lamp);
  const bulb = ball(0.035, new THREE.MeshBasicMaterial({ color: '#fff3c8', toneMapped: false }));
  add(bulb, 0.18, 0.38, 0, lamp);
  lamp.position.set(-2.05, 0.765, BACK + 0.3);
  g.add(lamp);
  const lampLight = new THREE.PointLight('#ffb15e', 5.5, 5.5, 1.5);
  lampLight.position.set(-1.85, 1.15, BACK + 0.38);
  g.add(lampLight);
  const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffbf73', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, toneMapped: false }));
  lampGlow.scale.set(0.7, 0.7, 1);
  add(lampGlow, -1.88, 1.14, BACK + 0.32);

  // mug + sketchbook
  add(cyl(0.035, 0.032, 0.085, toonMaterial('#e7eef5')), -1.12, 0.807, BACK + 0.5);
  const sketch = box(0.24, 0.012, 0.32, toonMaterial('#2d3d5c')); sketch.rotation.y = -0.25;
  add(sketch, -1.95, 0.77, BACK + 0.55);

  // chair
  const chair = new THREE.Group();
  const chairMat = toonMaterial('#e6dccb');
  add(cyl(0.21, 0.21, 0.05, chairMat), 0, 0.46, 0, chair);
  add(cyl(0.025, 0.025, 0.44, toonMaterial('#55596b'), 8), 0, 0.23, 0, chair);
  add(box(0.36, 0.3, 0.04, chairMat), 0, 0.72, 0.2, chair);
  chair.position.set(-1.55, 0, BACK + 1.05);
  chair.rotation.y = 0.5;
  g.add(chair);

  // shelves with books
  const shelfMat = toonMaterial('#c89a6a');
  const rnd = mulberry32(11);
  const bookCols = ['#d8665a', '#5b7fb8', '#e2b65b', '#6aa384', '#9a6bb0', '#e8e0d0', '#3f4a6b', '#c77b9e'];
  for (const sy of [1.42, 1.8]) {
    add(box(1.25, 0.03, 0.22, shelfMat), -1.62, sy, BACK + 0.11);
    let x = -2.18;
    while (x < -1.2) {
      const bw = 0.025 + rnd() * 0.035, bh = 0.17 + rnd() * 0.1;
      if (rnd() < 0.12) { x += 0.08; continue; }
      const b = box(bw, bh, 0.15, toonMaterial(bookCols[(rnd() * bookCols.length) | 0]));
      if (rnd() < 0.15) b.rotation.z = 0.25;
      add(b, x + bw / 2, sy + 0.015 + bh / 2, BACK + 0.12);
      x += bw + 0.004;
    }
  }
  // little succulent on the top shelf
  add(cyl(0.05, 0.04, 0.07, toonMaterial('#e9e2d4')), -1.12, 1.85, BACK + 0.12);
  for (let i = 0; i < 6; i++) {
    const leaf = ball(0.03, toonMaterial('#7fb48a'), 8, 6);
    leaf.scale.set(0.6, 1.3, 0.6);
    leaf.position.set(-1.12 + Math.cos(i) * 0.03, 1.91, BACK + 0.12 + Math.sin(i) * 0.03);
    leaf.rotation.set(Math.sin(i) * 0.5, 0, Math.cos(i) * 0.5);
    g.add(leaf);
  }

  // ---- telescope by the window (she loves stargazing) ------------------------
  const scope = new THREE.Group();
  const metal = toonMaterial('#3c4256');
  for (let i = 0; i < 3; i++) {
    const leg = cyl(0.01, 0.012, 1.05, metal, 6);
    const a = (i / 3) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 0.14, 0.5, Math.sin(a) * 0.14);
    leg.rotation.set(Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28);
    scope.add(leg);
  }
  const tube = cyl(0.045, 0.06, 0.62, toonMaterial('#e9e2d4'));
  tube.rotation.set(-1.0, 0, 0.35);
  add(tube, 0, 1.08, -0.05, scope);
  scope.position.set(1.32, 0, BACK + 0.5);
  scope.rotation.y = -0.3;
  g.add(scope);

  // ---- floor plant ---------------------------------------------------------
  const plant = new THREE.Group();
  add(cyl(0.13, 0.1, 0.26, toonMaterial('#d9cdb6')), 0, 0.13, 0, plant);
  const leafMat = toonMaterial('#4f8f63');
  for (let i = 0; i < 9; i++) {
    const leaf = ball(0.08, leafMat, 10, 8);
    leaf.scale.set(0.55, 2.4, 0.18);
    const a = i * 2.4;
    leaf.position.set(Math.cos(a) * 0.08, 0.42 + (i % 3) * 0.08, Math.sin(a) * 0.08);
    leaf.rotation.set(Math.sin(a) * 0.6, a, Math.cos(a) * 0.6);
    plant.add(leaf);
  }
  plant.position.set(-0.78, 0, BACK + 0.32);
  g.add(plant);

  // ---- bed (right) --------------------------------------------------------
  const bed = new THREE.Group();
  add(box(1.05, 0.28, 2.0, wood), 0, 0.14, 0, bed);
  add(box(1.0, 0.16, 1.95, toonMaterial('#f1ebe0')), 0, 0.36, 0, bed);
  const quiltTex = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#8fb8b0'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 8; i++) { c.fillRect(i * 32, 0, 12, h); c.fillRect(0, i * 32, w, 12); }
  }, { repeat: [2, 3] });
  add(box(1.08, 0.06, 1.35, toonMaterial('#ffffff', { map: quiltTex })), 0, 0.46, 0.33, bed);
  const pillowMat = toonMaterial('#fbf6ee');
  for (const px of [-0.24, 0.24]) {
    const p = ball(0.2, pillowMat, 16, 10); p.scale.set(1.15, 0.35, 0.7);
    add(p, px, 0.5, -0.78, bed);
  }
  add(box(1.08, 0.85, 0.06, woodDark), 0, 0.42, -1.0, bed); // headboard
  // sleeping cat (orange loaf)
  const cat = new THREE.Group();
  const fur = toonMaterial('#e59a52');
  const body = ball(0.13, fur); body.scale.set(1.25, 0.72, 0.95); add(body, 0, 0.09, 0, cat);
  const head = ball(0.075, fur); add(head, 0.15, 0.1, 0.06, cat);
  for (const ez of [0.02, 0.1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.05, 8), fur);
    add(ear, 0.17, 0.17, ez, cat);
  }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 6, 16, Math.PI * 1.1), fur);
  tail.rotation.x = Math.PI / 2; add(tail, 0, 0.04, 0.02, cat);
  cat.position.set(-0.12, 0.49, 0.45);
  cat.rotation.y = 0.6;
  bed.add(cat);
  anims.push((dt, t) => { if (!reduced()) body.scale.y = 0.72 + Math.sin(t * 1.6) * 0.025; });
  bed.position.set(W / 2 - 0.56, 0, BACK + 1.03);
  g.add(bed);

  // ---- rug ----------------------------------------------------------------
  const rugTex = canvasTexture(512, 512, (c, w, h) => {
    const cols = ['#e7dcc6', '#6f97a0', '#e7dcc6', '#c98f72', '#e7dcc6', '#4f6f86'];
    for (let i = 0; i < 14; i++) {
      c.beginPath(); c.arc(w / 2, h / 2, w / 2 - i * 17, 0, Math.PI * 2);
      c.fillStyle = cols[i % cols.length]; c.fill();
    }
    c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = 2;
    for (let i = 0; i < 14; i++) { c.beginPath(); c.arc(w / 2, h / 2, w / 2 - i * 17, 0, Math.PI * 2); c.stroke(); }
  });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.05, 48), new THREE.MeshLambertMaterial({ map: rugTex }));
  rug.rotation.x = -Math.PI / 2;
  add(rug, 0, 0.004, 0.1);

  // ---- retro corner: CRT + console on a cabinet (left wall) -------------------
  const crtTex = canvasTexture(128, 96, (c, w, h) => {
    c.fillStyle = '#5ec2ff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff'; for (let i = 0; i < 4; i++) c.fillRect(10 + i * 30, 14 + (i % 2) * 6, 16, 6);
    c.fillStyle = '#3bb34a'; c.fillRect(0, 70, w, 26);
    c.fillStyle = '#9a5b2e'; c.fillRect(0, 78, w, 18);
    c.fillStyle = '#e4402f'; c.fillRect(30, 56, 10, 14); c.fillStyle = '#ffd2a1'; c.fillRect(31, 50, 8, 7);
    c.fillStyle = '#f2c230'; c.fillRect(80, 40, 10, 10);
    c.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  }, { filter: false });
  const retro = new THREE.Group();
  add(box(0.8, 0.5, 0.42, woodDark), 0, 0.25, 0, retro);
  add(box(0.46, 0.38, 0.4, toonMaterial('#d7d2c4')), 0, 0.69, -0.01, retro);
  const crtScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.26), new THREE.MeshBasicMaterial({ map: crtTex, toneMapped: false }));
  add(crtScreen, 0, 0.7, 0.191, retro);
  add(box(0.22, 0.05, 0.16, toonMaterial('#6f6f86')), 0.05, 0.525, 0.12, retro);
  retro.position.set(-W / 2 + 0.25, 0, 0.75);
  retro.rotation.y = Math.PI / 2;
  g.add(retro);

  // ---- wall art -------------------------------------------------------------
  const poster = canvasTexture(256, 384, (c, w, h) => {
    c.fillStyle = '#1f2a44'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2d39b'; c.beginPath(); c.arc(w * 0.62, h * 0.32, 56, 0, 7); c.fill();
    c.fillStyle = '#1f2a44'; c.beginPath(); c.arc(w * 0.68, h * 0.29, 50, 0, 7); c.fill();
    c.fillStyle = '#c98f72'; c.fillRect(0, h * 0.62, w, h * 0.38);
    c.fillStyle = '#f4ead8'; c.font = 'bold 30px Georgia, serif'; c.textAlign = 'center';
    c.fillText('THE MOON', w / 2, h * 0.76); c.fillText('FERRY', w / 2, h * 0.85);
    c.font = '15px Georgia, serif'; c.fillText('a picture in technicolor · 1952', w / 2, h * 0.93);
  });
  const posterMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.75), new THREE.MeshLambertMaterial({ map: poster }));
  posterMesh.rotation.y = Math.PI / 2;
  add(posterMesh, -W / 2 + 0.01, 1.65, -0.45);
  const starMap = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#0f1630'; c.fillRect(0, 0, w, h);
    const r = mulberry32(5);
    c.fillStyle = '#f4ead8';
    const pts = [];
    for (let i = 0; i < 26; i++) { const x = 20 + r() * (w - 40), y = 20 + r() * (h - 40); pts.push([x, y]); c.beginPath(); c.arc(x, y, 1 + r() * 2.2, 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(244,234,216,0.45)'; c.beginPath();
    for (let i = 0; i < 6; i++) { c.lineTo(pts[i][0], pts[i][1]); }
    c.stroke();
    c.strokeStyle = '#c9a46a'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
  });
  const starMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), new THREE.MeshLambertMaterial({ map: starMap }));
  starMesh.rotation.y = -Math.PI / 2;
  add(starMesh, W / 2 - 0.01, 1.62, BACK + 1.1);

  // ---- shooting star (every so often) ------------------------------------------
  const streak = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.014), new THREE.MeshBasicMaterial({ map: streakTex(canvasTexture), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  streak.visible = false;
  add(streak, 0, 0, BACK - 1.15);
  let nextStar = 6 + Math.random() * 10, starT = -1;
  anims.push((dt) => {
    if (reduced()) return;
    nextStar -= dt;
    if (nextStar <= 0 && starT < 0) { starT = 0; streak.visible = true; }
    if (starT >= 0) {
      starT += dt;
      const k = starT / 0.9;
      streak.position.set(WIN.x - 0.9 + k * 1.8, 2.55 - k * 0.6, BACK - 1.15);
      streak.rotation.z = -0.36;
      streak.material.opacity = Math.sin(Math.min(1, k) * Math.PI);
      if (k >= 1) { starT = -1; streak.visible = false; nextStar = 18 + Math.random() * 25; }
    }
  });

  // ---- lights ---------------------------------------------------------------
  const hemi = new THREE.HemisphereLight('#9fb2ff', '#5a3d2c', 1.25);
  const key = new THREE.DirectionalLight('#fff0dc', 1.9);
  key.position.set(-1.6, 2.8, 3.2);
  const rim = new THREE.DirectionalLight('#a9c1ff', 1.3);
  rim.position.set(1.4, 2.6, -3.0);
  g.add(hemi, key, rim, key.target, rim.target);
  key.target.position.set(0, 1.1, 0);
  rim.target.position.set(0, 1.1, 0);

  return {
    group: g,
    spawn: { x: 0, y: 0, z: 0, rotY: 0 },
    background: '#0b0e1c',
    camera: { azimuth: 0 },
    update(dt, t) { for (const a of anims) a(dt, t); },
  };
}

// The night city seen through the window.
function drawCity(c, w, h) {
  const gr = c.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#060919');
  gr.addColorStop(0.4, '#101a3c');
  gr.addColorStop(0.66, '#2a3460');
  gr.addColorStop(0.8, '#6b5a72');
  gr.addColorStop(1, '#3a2f3f');
  c.fillStyle = gr; c.fillRect(0, 0, w, h);
  const r = mulberry32(42);
  for (let i = 0; i < 260; i++) {
    const x = r() * w, y = r() * h * 0.66, s = r() < 0.08 ? 2.2 : 1.2;
    c.fillStyle = `rgba(255,250,235,${0.35 + r() * 0.6})`;
    c.fillRect(x, y, s, s);
  }
  // moon with halo
  const mx = w * 0.555, my = h * 0.41;
  const halo = c.createRadialGradient(mx, my, 8, mx, my, 80);
  halo.addColorStop(0, 'rgba(255,244,214,0.55)'); halo.addColorStop(1, 'rgba(255,244,214,0)');
  c.fillStyle = halo; c.fillRect(mx - 90, my - 90, 180, 180);
  c.fillStyle = '#fff6dc'; c.beginPath(); c.arc(mx, my, 21, 0, 7); c.fill();
  c.fillStyle = 'rgba(214,200,170,0.5)';
  for (const [dx, dy, rr] of [[-6, -4, 4.5], [6, 5, 3], [3, -9, 2.5], [-3, 9, 2]]) { c.beginPath(); c.arc(mx + dx, my + dy, rr, 0, 7); c.fill(); }
  // skyline layers
  const layer = (base, minH, maxH, col, winCol, density) => {
    let x = -10;
    while (x < w) {
      const bw = 24 + r() * 60, bh = minH + r() * (maxH - minH);
      c.fillStyle = col; c.fillRect(x, base - bh, bw, bh + 4);
      if (r() < 0.25) { c.fillRect(x + bw / 2 - 2, base - bh - 18, 3, 18); c.fillStyle = '#ff5a5a'; c.fillRect(x + bw / 2 - 3, base - bh - 20, 5, 4); }
      for (let wy = base - bh + 8; wy < base - 6; wy += 10) {
        for (let wx = x + 5; wx < x + bw - 6; wx += 9) {
          if (r() < density) { c.fillStyle = r() < 0.75 ? winCol : '#bfe1ff'; c.globalAlpha = 0.55 + r() * 0.45; c.fillRect(wx, wy, 4, 5); c.globalAlpha = 1; }
        }
      }
      x += bw + r() * 6;
    }
  };
  layer(h * 0.8, 30, 110, '#252b4d', '#f6c977', 0.16);
  layer(h * 0.9, 50, 170, '#141831', '#ffd38a', 0.26);
  c.fillStyle = '#0d1020'; c.fillRect(0, h * 0.9, w, h * 0.1);
}

function radialTex(canvasTexture, [r, g, b], a) {
  return canvasTexture(128, 128, (c, w, h) => {
    const gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},${a})`);
    gr.addColorStop(0.25, `rgba(${r},${g},${b},${a * 0.45})`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
  });
}

function streakTex(canvasTexture) {
  return canvasTexture(256, 8, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.85, 'rgba(220,235,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
  });
}
