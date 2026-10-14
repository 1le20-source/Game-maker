// Procedural sound: small UI effects and a quiet lo-fi loop, all WebAudio.
// Nothing plays until unlock() runs inside a user gesture.

export function createAudio(app) {
  let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let musicOn = false, schedTimer = 0, nextBarTime = 0, bar = 0;

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch { return false; }
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.5; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function tone(freq, t, dur, { type = 'sine', gain = 0.2, attack = 0.005, bus = sfxBus, glide, filter } = {}) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur * 0.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
    node.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(t, dur, { gain = 0.1, freq = 2000, q = 0.8, type = 'bandpass', bus = sfxBus } = {}) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  const SFX = {
    tap: (t) => tone(880, t, 0.06, { gain: 0.08, glide: 700 }),
    send: (t) => { tone(520, t, 0.09, { gain: 0.09 }); tone(780, t + 0.05, 0.12, { gain: 0.08 }); },
    receive: (t) => { tone(660, t, 0.12, { gain: 0.09, type: 'triangle' }); tone(990, t + 0.06, 0.16, { gain: 0.05 }); },
    open: (t) => noise(t, 0.16, { gain: 0.05, freq: 1800, q: 0.6 }),
    close: (t) => noise(t, 0.12, { gain: 0.04, freq: 1200, q: 0.6 }),
    heart: (t) => [1046.5, 1318.5, 1568].forEach((f, i) => tone(f, t + i * 0.07, 0.5, { gain: 0.07, type: 'triangle' })),
    level: (t) => [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, t + i * 0.08, 0.7, { gain: 0.06, type: 'triangle' })),
    coin: (t) => { tone(988, t, 0.07, { gain: 0.06, type: 'square', filter: 3000 }); tone(1319, t + 0.07, 0.25, { gain: 0.06, type: 'square', filter: 3000 }); },
    oops: (t) => { tone(440, t, 0.12, { gain: 0.08, type: 'triangle' }); tone(330, t + 0.1, 0.2, { gain: 0.08, type: 'triangle' }); },
    pat: (t) => noise(t, 0.09, { gain: 0.05, freq: 900, q: 1.5 }),
    gift: (t) => { noise(t, 0.25, { gain: 0.05, freq: 3000, q: 0.5 }); [880, 1108.7, 1318.5].forEach((f, i) => tone(f, t + 0.1 + i * 0.06, 0.45, { gain: 0.06, type: 'triangle' })); },
  };

  // ---- lo-fi loop: Fmaj7 - Em7 - Dm7 - Cmaj7 at 70 bpm ----------------------
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
  const BEAT = 60 / 70;

  function keys(n, t, dur, vel) {
    const f = midi(n);
    tone(f, t, dur, { type: 'sine', gain: 0.05 * vel, attack: 0.02, bus: musicBus, filter: 1600 });
    tone(f * 2.005, t, dur * 0.6, { type: 'triangle', gain: 0.012 * vel, attack: 0.01, bus: musicBus, filter: 2200 });
  }
  function scheduleBar(t) {
    const ch = CHORDS[bar % CHORDS.length];
    // pad chord with a lazy strum
    ch.forEach((n, i) => keys(n + 12, t + i * 0.03, BEAT * 3.6, 0.9));
    // bass
    tone(midi(ch[0] - 12), t, BEAT * 1.8, { gain: 0.07, attack: 0.02, bus: musicBus, filter: 400 });
    tone(midi(ch[0] - 12), t + BEAT * 2.5, BEAT * 1.2, { gain: 0.05, attack: 0.02, bus: musicBus, filter: 400 });
    // little melody on some bars
    if (bar % 2 === 1) {
      const mel = [ch[3] + 12, ch[2] + 12, ch[1] + 24];
      mel.forEach((n, i) => keys(n, t + BEAT * (1.5 + i * 0.75), BEAT * 0.9, 0.6));
    }
    // soft kick + brushed hats
    for (let b = 0; b < 4; b++) {
      const bt = t + b * BEAT;
      if (b === 0 || b === 2) tone(70, bt, 0.25, { gain: 0.09, glide: 40, bus: musicBus });
      noise(bt + BEAT * 0.5, 0.05, { gain: 0.012, freq: 7000, q: 0.7, type: 'highpass', bus: musicBus });
      if (b === 1 || b === 3) noise(bt, 0.12, { gain: 0.02, freq: 1800, q: 0.9, bus: musicBus });
    }
    // vinyl crackle
    for (let i = 0; i < 6; i++) noise(t + Math.random() * BEAT * 4, 0.01, { gain: 0.02, freq: 4000, q: 2, bus: musicBus });
    bar++;
  }
  function scheduler() {
    if (!ctx || !musicOn) return;
    while (nextBarTime < ctx.currentTime + 1.2) { scheduleBar(nextBarTime); nextBarTime += BEAT * 4; }
  }

  const audio = {
    get ready() { return !!ctx; },
    unlock() {
      if (!init()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      audio.applySettings();
    },
    play(name) {
      if (!ctx || !app.state.settings?.sfx) return;
      const fn = SFX[name];
      if (fn) { try { fn(ctx.currentTime + 0.005); } catch { /* ignore */ } }
    },
    registerSfx(name, fn) { SFX[name] = (t) => fn(ctx, t, { tone, noise, bus: sfxBus }); },
    applySettings() {
      if (!ctx) return;
      const s = app.state.settings || {};
      const want = !!s.music && document.visibilityState !== 'hidden';
      const vol = 0.55 * (s.musicVolume ?? 0.5);
      musicBus.gain.setTargetAtTime(want ? vol : 0, ctx.currentTime, 0.4);
      if (want && !musicOn) {
        musicOn = true;
        nextBarTime = ctx.currentTime + 0.15;
        scheduler();
        schedTimer = setInterval(scheduler, 300);
      } else if (!want && musicOn) {
        musicOn = false;
        clearInterval(schedTimer);
      }
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.visibilityState === 'hidden') ctx.suspend?.().catch(() => {});
    else ctx.resume?.().catch(() => {});
    audio.applySettings();
  });
  return audio;
}
