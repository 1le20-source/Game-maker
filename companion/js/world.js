// World module: places to go together and the Places sheet. Stub with one
// extra scene (the rooftop). Register more scenes with app.stage.registerScene.

export default {
  id: 'world',
  init(app) {
    const { stage, ui, brain, progress } = app;

    stage.registerScene('rooftop', buildRooftop, { name: 'Rooftop', desc: 'Her building’s roof: city lights, open sky, a bench.', minLevel: 1 });

    const label = (id) => stage.sceneMeta(id)?.name || id;
    const go = async (id) => {
      const meta = stage.sceneMeta(id);
      if (!meta) return;
      if (progress.level() < (meta.minLevel || 0)) { ui.toast(`Unlocks at ${progress.levelName(meta.minLevel)}.`, { icon: 'lock' }); return; }
      ui.closeSheet();
      await stage.setScene(id);
      if (progress.unlock('place:' + id)) progress.addMoment('place', `You went to the ${meta.name.toLowerCase()} with ${app.state.her.name}.`);
    };

    ui.registerDockButton({ id: 'places', label: 'Places', icon: 'pin', order: 20, onClick: () => ui.openSheet('places', 'Places', (body) => {
      body.append(Object.assign(document.createElement('p'), { className: 'sheet-lead', textContent: 'Where should you two hang out?' }));
      const list = document.createElement('div');
      list.className = 'place-list';
      for (const m of stage.listScenes()) {
        const locked = progress.level() < (m.minLevel || 0);
        const here = stage.current === m.id;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'place' + (here ? ' here' : '') + (locked ? ' locked' : '');
        b.disabled = locked || here;
        b.innerHTML = `<span class="place-ico">${ui.icon(locked ? 'lock' : m.id === 'room' ? 'moon' : 'star', 20)}</span><span class="place-text"><strong></strong><small></small></span><span class="place-tag"></span>`;
        b.querySelector('strong').textContent = m.name;
        b.querySelector('small').textContent = locked ? `Unlocks at ${progress.levelName(m.minLevel)}` : m.desc;
        b.querySelector('.place-tag').textContent = here ? 'Here' : '';
        b.addEventListener('click', () => go(m.id));
        list.append(b);
      }
      body.append(list);
    }) });

    brain.registerSuggestion('go', {
      hint: `go:<place> to suggest going somewhere (places: ${stage.listScenes().map((s) => s.id).join(', ')})`,
      label: (id) => (stage.sceneMeta(id) && stage.current !== id ? `Go to the ${label(id).toLowerCase()}` : null),
      run: (id) => go(id),
    });
  },
};

function buildRooftop({ THREE, toonMaterial, canvasTexture }) {
  const g = new THREE.Group();
  // sky dome
  const sky = canvasTexture(512, 512, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#05081a'); gr.addColorStop(0.6, '#142250'); gr.addColorStop(1, '#5a4a66');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(255,250,235,${Math.random() * 0.8})`; c.fillRect(Math.random() * w, Math.random() * h * 0.7, 1.2, 1.2); }
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, toneMapped: false }));
  g.add(dome);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(1.4, 32), new THREE.MeshBasicMaterial({ color: '#fff4d6', toneMapped: false }));
  moon.position.set(8, 14, -30); moon.lookAt(0, 1, 0); g.add(moon);
  // roof floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshLambertMaterial({ color: '#4b4f63' }));
  floor.rotation.x = -Math.PI / 2; g.add(floor);
  // railing
  const rail = toonMaterial('#c9cbd6');
  for (let x = -4; x <= 4; x += 0.5) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.0, 0.04), rail); p.position.set(x, 0.5, -2.2); g.add(p); }
  const top = new THREE.Mesh(new THREE.BoxGeometry(8.1, 0.06, 0.08), rail); top.position.set(0, 1.0, -2.2); g.add(top);
  // city glow below
  const city = canvasTexture(1024, 256, (c, w, h) => {
    c.fillStyle = '#0b0e1d'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { c.fillStyle = Math.random() < 0.8 ? '#ffcf7a' : '#a8d4ff'; c.globalAlpha = Math.random(); c.fillRect(Math.random() * w, h * 0.2 + Math.random() * h * 0.8, 2, 2); }
  });
  const cityPlane = new THREE.Mesh(new THREE.PlaneGeometry(60, 15), new THREE.MeshBasicMaterial({ map: city, toneMapped: false }));
  cityPlane.position.set(0, -2, -18); g.add(cityPlane);
  // bench + string lights
  const wood = toonMaterial('#8a5a3c');
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.4), wood); bench.position.set(1.6, 0.45, -1.2); g.add(bench);
  const lights = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; lights.push(new THREE.Vector3(-4 + t * 8, 2.4 - Math.sin(t * Math.PI) * 0.4, -2.0)); }
  const pts = new THREE.Points(new THREE.BufferGeometry().setFromPoints(lights), new THREE.PointsMaterial({ color: '#ffd27a', size: 0.06, toneMapped: false }));
  g.add(pts);
  g.add(new THREE.HemisphereLight('#8ea4ff', '#3a2e3a', 1.3));
  const key = new THREE.DirectionalLight('#ffe6c8', 1.6); key.position.set(-1.5, 2.5, 3); g.add(key, key.target); key.target.position.set(0, 1, 0);
  const rim = new THREE.DirectionalLight('#9fb8ff', 1.4); rim.position.set(2, 3, -3); g.add(rim, rim.target); rim.target.position.set(0, 1, 0);
  return { group: g, spawn: { x: 0, y: 0, z: 0, rotY: 0 }, background: '#070a18', camera: { azimuth: 0 } };
}
