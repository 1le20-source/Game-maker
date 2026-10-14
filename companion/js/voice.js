// Voice output through speechSynthesis. Picks a natural English female voice
// when one exists, unlocks on the first tap, and reports start/boundary/end so
// the avatar can sync her mouth.

const FEMALE = /samantha|ava|allison|susan|zoe|nicky|karen|moira|tessa|fiona|serena|kate|victoria|zira|aria|jenny|sonia|libby|michelle|emma|ashley|amber|sara|natasha|clara|hazel|joanna|salli|kendra|kimberly|ivy|female|google us english|google uk english female|catherine|matilda|olivia|ellie|lily/i;
const MALE = /daniel|alex\b|fred|tom\b|david|mark\b|guy\b|aaron|arthur|rishi|male\b|ryan|eric|christopher|roger|brian|andrew|steffan|thomas|oliver|gordon|lee\b|james|george|william|reed|rocko|grandpa|eddy|ralph|albert|junior|bruce/i;
const QUALITY = /natural|neural|premium|enhanced|online/i;

export function createVoice(app) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  let voices = [];
  let unlocked = false;
  const keep = new Set(); // utterances must stay referenced until they end (Chrome GC bug)

  function loadVoices() {
    try { voices = synth?.getVoices() || []; } catch { voices = []; }
  }
  if (synth) {
    loadVoices();
    try { synth.addEventListener?.('voiceschanged', loadVoices); } catch { /* ignore */ }
  }

  function score(v) {
    let s = 0;
    const lang = (v.lang || '').toLowerCase();
    if (lang.startsWith('en')) s += 10; else return -100;
    if (/en[-_](us|gb|au|ca|ie|nz)/.test(lang)) s += 2;
    if (FEMALE.test(v.name)) s += 20;
    if (MALE.test(v.name) && !/female/i.test(v.name)) s -= 30;
    if (QUALITY.test(v.name)) s += 8;
    if (v.localService) s += 1;
    return s;
  }

  const voice = {
    get available() { return !!synth && typeof SpeechSynthesisUtterance !== 'undefined'; },
    get unlocked() { return unlocked; },
    enabled() { return voice.available && unlocked && !!app.state.settings?.voice; },

    // Call from the first user gesture. Speaks a silent utterance (iOS needs it).
    unlock() {
      if (unlocked || !voice.available) return;
      unlocked = true;
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        synth.speak(u);
      } catch { /* ignore */ }
      loadVoices();
    },

    listVoices() {
      loadVoices();
      return voices.filter((v) => (v.lang || '').toLowerCase().startsWith('en'))
        .sort((a, b) => score(b) - score(a))
        .map((v) => ({ name: v.name, lang: v.lang, female: FEMALE.test(v.name) && !MALE.test(v.name) }));
    },

    pick() {
      loadVoices();
      const wanted = app.state.settings?.voiceName;
      if (wanted) { const v = voices.find((x) => x.name === wanted); if (v) return v; }
      let best = null, bs = -Infinity;
      for (const v of voices) { const s = score(v); if (s > bs) { bs = s; best = v; } }
      return bs > 0 ? best : null;
    },

    // Speak one chunk. cb: {onStart, onBoundary(charIndex), onEnd, onFail}
    speak(text, cb = {}) {
      if (!voice.enabled()) { cb.onFail?.(); return null; }
      const u = new SpeechSynthesisUtterance(text);
      const v = voice.pick();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
      const s = app.state.settings || {};
      u.pitch = Math.min(2, Math.max(0.5, s.pitch ?? 1.12));
      u.rate = Math.min(1.6, Math.max(0.6, s.rate ?? 1));
      u.volume = 1;
      let started = false, done = false;
      const finish = (failed) => {
        if (done) return;
        done = true;
        keep.delete(u);
        clearTimeout(startTimer); clearTimeout(watchdog);
        // Never started: let the caller run its silent timeline instead.
        if (failed && !started) { cb.onFail?.(); return; }
        cb.onEnd?.();
      };
      u.onstart = () => { started = true; cb.onStart?.(); };
      u.onboundary = (e) => { if (e.name === 'word' || e.name === undefined) cb.onBoundary?.(e.charIndex); };
      u.onend = () => finish(false);
      u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') console.warn('[voice]', e.error); finish(true); };
      keep.add(u);
      // If speech never starts (no voices, blocked), fall back to the silent timeline.
      const startTimer = setTimeout(() => { if (!started) { try { synth.cancel(); } catch { /* ignore */ } cb.onFail?.(); done = true; keep.delete(u); } }, 2500);
      // Some engines never fire `end`.
      const watchdog = setTimeout(() => finish(false), 4000 + text.length * 120);
      try { synth.speak(u); } catch { finish(true); }
      return u;
    },

    cancel() { try { synth?.cancel(); } catch { /* ignore */ } },
  };
  return voice;
}
