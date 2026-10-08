// Body Studio stage: photo-studio lighting, reflections and floor.
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});
  const THREE = window.THREE;

  // a small softbox studio rendered into a PMREM environment map: gives skin,
  // eyes and fabric believable reflections without any image files
  function studioEnvironment(renderer) {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0x1a1c20 }));
    env.add(room);
    const panel = (w, h, color, intensity, pos) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
      m.position.set(...pos);
      m.lookAt(0, 1.2, 0);
      env.add(m);
    };
    panel(6, 6, 0xfff1e0, 2.4, [-6, 6, 7]); // key softbox
    panel(5, 7, 0xe6efff, 1.0, [8, 3, 4]); // fill
    panel(3, 9, 0xffffff, 2.0, [-7, 4, -6]); // rim left
    panel(3, 9, 0xffffff, 1.6, [7, 4, -6]); // rim right
    panel(14, 3, 0xffffff, 0.6, [0, 12, 0]); // ceiling strip
    const floor = new THREE.Mesh(new THREE.CircleGeometry(20, 32), new THREE.MeshBasicMaterial({ color: 0x3a3632 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    env.add(floor);
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(env, 0.04);
    pm.dispose();
    return rt.texture;
  }

  function radialTexture(stops, size = 256) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  BS.studioEnvironment = studioEnvironment;
  BS.radialTexture = radialTexture;

  BS.buildStage = function (app) {
    const { scene, renderer, human } = app;
    scene.environment = studioEnvironment(renderer);
    scene.background = null; // the page's CSS gradient shows through

    const stage = { lights: {} };
    const L = stage.lights;
    L.hemi = new THREE.HemisphereLight(0xe8eefc, 0x3b3530, 0.35);
    scene.add(L.hemi);

    const key = (L.key = new THREE.DirectionalLight(0xfff0e2, 2.4));
    key.position.set(-1.6, 3.2, 2.6);
    key.castShadow = true;
    const hi = app.quality === 'high';
    key.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
    const sc = key.shadow.camera;
    sc.left = -1.1; sc.right = 1.1; sc.top = 2.3; sc.bottom = -0.3; sc.near = 0.5; sc.far = 9;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.012;
    key.shadow.radius = 4;
    key.target.position.set(0, 0.95, 0);
    scene.add(key, key.target);

    L.fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
    L.fill.position.set(2.5, 1.6, 2.2);
    scene.add(L.fill);
    L.rimL = new THREE.DirectionalLight(0xffffff, 1.5);
    L.rimL.position.set(-2.4, 2.2, -2.6);
    scene.add(L.rimL);
    L.rimR = new THREE.DirectionalLight(0xfff6ee, 1.15);
    L.rimR.position.set(2.6, 2.0, -2.2);
    scene.add(L.rimR);

    // floor: a soft pool of light that fades into the backdrop, plus a
    // shadow catcher and a contact shadow under the feet
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.2, 64), new THREE.MeshBasicMaterial({
      map: radialTexture([[0, 'rgba(120,112,104,0.55)'], [0.55, 'rgba(70,66,64,0.35)'], [1, 'rgba(40,40,44,0)']]), transparent: true, depthWrite: false,
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.renderOrder = -2;
    scene.add(floor);
    const catcher = new THREE.Mesh(new THREE.CircleGeometry(2.6, 64), new THREE.ShadowMaterial({ opacity: 0.32, depthWrite: false }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = 0.001;
    catcher.receiveShadow = true;
    catcher.renderOrder = -1;
    scene.add(catcher);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: radialTexture([[0, 'rgba(0,0,0,0.55)'], [0.45, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false,
    }));
    contact.rotation.x = -Math.PI / 2;
    contact.scale.set(0.75, 0.55, 1);
    contact.position.y = 0.002;
    contact.renderOrder = -1;
    scene.add(contact);
    stage.floor = floor;
    stage.contact = contact;

    // keep the key light's shadow frustum and the contact shadow on the body
    app.on('frame', () => {
      const r = human.rootOffset;
      key.target.position.set(r.x, 0.95, r.z);
      key.position.set(r.x - 1.6, 3.2, r.z + 2.6);
      contact.position.x = r.x;
      contact.position.z = r.z;
    });
    return stage;
  };
})();
