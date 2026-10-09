// Serenity Hands — keep it smooth: watches the frame time and steps the
// render resolution and the number of full-detail (smoothed) people up or
// down so the game stays fluid on any device. Phones start a step lower.
// window.setGraphics('auto' | 'high' | 'balanced' | 'low') overrides it.
(function () {
  'use strict';
  const g = window;
  const DPR = window.devicePixelRatio || 1, MOBILE = /(Android|iPhone|iPad|Mobile)/i.test(navigator.userAgent);
  // resolution scale and how many people get the full smoothed body
  const LEVELS = [
    { pr: Math.min(1.5, DPR), smooth: 5 },
    { pr: Math.min(1.0, DPR), smooth: 3 },
    { pr: Math.min(0.8, DPR), smooth: 2 },
    { pr: Math.min(0.65, DPR), smooth: 1 },
  ];
  const P = { mode: 'auto', level: MOBILE ? 1 : 0, times: [], last: 0, good: 0 };
  try { const m = localStorage.getItem('sh_graphics'); if (m) P.mode = m; } catch (_) { /* storage blocked */ }
  function apply() {
    const L = LEVELS[P.level];
    if (g.BS && BS.Game) BS.Game.maxSmooth = L.smooth;
    if (typeof R3 !== 'undefined' && R3 && R3.renderer && Math.abs(R3.renderer.getPixelRatio() - L.pr) > 0.01) {
      R3.renderer.setPixelRatio(L.pr);
      try { resize3D(); } catch (_) { /* not ready */ }
    }
  }
  g.setGraphics = function (mode) {
    P.mode = mode;
    if (mode === 'high') P.level = 0; else if (mode === 'balanced') P.level = 1; else if (mode === 'low') P.level = 3;
    try { localStorage.setItem('sh_graphics', mode); } catch (_) { /* storage blocked */ }
    apply();
  };
  if (P.mode !== 'auto') g.setGraphics(P.mode);
  function tick(t) {
    requestAnimationFrame(tick);
    if (document.hidden) { P.last = 0; return; }
    if (P.last) P.times.push(t - P.last);
    P.last = t;
    if (P.times.length < 90) return; // judge ~1.5 s at a time
    const s = P.times.sort((a, b) => a - b), slow = s[Math.floor(s.length * 0.75)];
    P.times.length = 0;
    if (P.mode !== 'auto') return;
    if (slow > 26 && P.level < LEVELS.length - 1) { P.level++; P.good = 0; apply(); }
    else if (slow < 14 && P.level > 0) { if (++P.good >= 3) { P.level--; P.good = 0; apply(); } }
    else P.good = 0;
  }
  requestAnimationFrame(tick);
  setTimeout(apply, 1500);
  // a graphics choice in the pause menu
  const basePause = g.pause;
  if (typeof basePause === 'function') g.pause = function () {
    const out = basePause.apply(this, arguments);
    try {
      const m = document.getElementById('modal');
      if (!m || m.querySelector('.gfx')) return out;
      const row = document.createElement('div');
      row.className = 'gfx'; row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0';
      row.innerHTML = '<b style="margin-right:4px">🎮 Graphics</b>';
      for (const [k, label] of [['auto', 'Auto (smooth)'], ['high', 'High'], ['balanced', 'Balanced'], ['low', 'Low (fastest)']]) {
        const b = document.createElement('button');
        b.textContent = label; if (P.mode === k) b.className = 'primary';
        b.onclick = () => { g.setGraphics(k); row.querySelectorAll('button').forEach((x) => x.classList.toggle('primary', x === b)); };
        row.appendChild(b);
      }
      m.insertBefore(row, m.querySelector('.btns'));
    } catch (_) { /* menu changed */ }
    return out;
  };
  g.graphicsLevel = () => ({ mode: P.mode, level: P.level, ...LEVELS[P.level] });
})();
