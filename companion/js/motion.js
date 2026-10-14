// Motion module: extra gestures and idle fidgets. Stub with two gestures and
// one idle. Add dances, poses and reactions here via app.avatar.registerGesture.

export default {
  id: 'motion',
  init(app) {
    const A = app.avatar;

    A.registerGesture('bow', {
      duration: 2.0,
      hint: 'polite little bow',
      run(g, t) {
        const k = g.key(t, [[0, 0], [0.5, 1], [1.2, 1], [1.8, 0]]);
        g.add('spine', 0.25 * k, 0, 0);
        g.add('chest', 0.12 * k, 0, 0);
        g.add('head', 0.15 * k, 0, 0);
        const [x, y, z] = g.at('hips', 0, 0.02, 0.12);
        g.reach('left', x + 0.03, y, z, 0.8 * k);
        g.reach('right', x - 0.03, y, z, 0.8 * k);
        g.expr('happy', 0.5);
      },
    });

    A.registerGesture('cheer', {
      duration: 2.0,
      hint: 'both arms up, yay',
      run(g, t) {
        const [lx, ly, lz] = g.at('leftShoulder', 0.22, 0.42, 0.05);
        const [rx, ry, rz] = g.at('rightShoulder', -0.22, 0.42, 0.05);
        const pump = Math.sin(t * 9) * 0.04;
        g.reach('left', lx, ly + pump, lz, 1, [1, 0, -0.4]);
        g.reach('right', rx, ry + pump, rz, 1, [-1, 0, -0.4]);
        g.root(0, Math.max(0, Math.sin(t * 9)) * 0.02, 0);
        g.expr('happy', 1);
      },
    });

    A.registerGesture('stretch', {
      duration: 3.4,
      run(g, t) {
        const k = g.key(t, [[0, 0], [0.9, 1], [2.4, 1], [3.4, 0]]);
        const [x, y, z] = g.at('head', 0, 0.32, 0.02);
        g.reach('left', x + 0.06, y, z, k, [1, 0, -0.5]);
        g.reach('right', x - 0.06, y, z, k, [-1, 0, -0.5]);
        g.add('spine', -0.06 * k, 0, 0);
        g.add('head', -0.1 * k, 0, 0);
        g.expr('blink', 0.9 * k);
        g.expr('relaxed', 0.6);
      },
    });
    A.registerIdle('stretch', 0.6);
  },
};
