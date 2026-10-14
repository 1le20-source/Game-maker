// Her mind. With Claude available (window.claude.use('sample')), replies come
// from Claude on the viewer's own account using a small protocol:
//
//   line 1: {"emo":..,"act":..,"aff":..,"mem":..,"sug":..}   compact JSON
//   then:   the spoken reply, 1-4 short sentences
//
// Without Claude, or when a call fails, the offline engine answers instead.
// Claude is only called on a player action (send, a game move, a gift) or once
// per day for a greeting. Never from a loop or timer.

import { createOffline, STYLES, BIO } from './offline.js';
import { clamp, timeOfDay, todayKey, rand, sleep } from './util.js';
import { LIMITS } from './save.js';

const EMOS = ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'shy', 'neutral', 'excited', 'sleepy'];
const OFFLINE_CODES = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
export const CRISIS_RE = /\b(kill (myself|me)|suicid\w*|end (it all|my life)|want to die|wanna die|self[- ]?harm|hurt(ing)? myself|cut(ting)? myself|no reason to live|don'?t want to (live|be alive|be here)|better off dead)\b/i;

export function createBrain(app) {
  let sample = null;
  let ctl = null;
  let busy = false;
  let notedRate = false;
  let limitsCache;
  const sections = new Map(); // id -> fn(ctx) => string | ''
  const metaHandlers = new Set();
  const suggestions = new Map(); // key -> {hint, label(arg), run(arg)}
  const offline = createOffline(app);

  const brain = {
    offline,
    STYLES,
    get online() { return !!sample; },
    get busy() { return busy; },

    async connect() {
      const C = window.claude;
      if (!C || typeof C.use !== 'function') return false;
      try { sample = await C.use('sample'); } catch { sample = null; }
      app.bus.emit('brain:online', { online: !!sample });
      return !!sample;
    },

    // Player typed a message.
    async send(text) {
      text = String(text || '').trim().slice(0, 600);
      if (!text || busy) return false;
      app.ui.addMessage('you', text);
      app.bus.emit('player:message', { text });
      const st = app.state.stats;
      st.messages = (st.messages || 0) + 1;
      app.progress.addCoins(1, 'chat');
      app.avatar.noteInteraction();
      if (CRISIS_RE.test(text)) app.ui.addSystemCard('crisis');
      const nm = text.match(/\b(?:call me|my name is)\s+([A-Za-z][\w'-]{1,20})/i);
      if (nm && brain.online) setPlayerName(nm[1]);
      await respond({ user: text, kind: 'chat' });
      return true;
    },

    // Something happened that she should react to (a gift, a game result).
    // description: narration for Claude, e.g. "Sam gives you a hot cocoa."
    // opts.offline(ctx) -> Reply used when Claude is unavailable.
    // opts.note: optional system line shown in the chat.
    async event(description, opts = {}) {
      if (busy) brain.stop();
      while (busy) await sleep(30);
      if (opts.note) app.ui.addMessage('system', opts.note);
      await respond({ user: `[${description}]`, kind: 'event', offlineFn: opts.offline });
    },

    stop() { ctl?.abort(); },

    registerIntent(def) { offline.registerIntent(def); },
    addPromptSection(id, fn) { sections.set(id, fn); },
    removePromptSection(id) { sections.delete(id); },
    onMeta(fn) { metaHandlers.add(fn); return () => metaHandlers.delete(fn); },
    registerSuggestion(key, def) { suggestions.set(key, def); },
    suggestion(sug) {
      if (!sug || typeof sug !== 'string') return null;
      const [key, ...rest] = sug.split(':');
      const def = suggestions.get(key.trim());
      if (!def) return null;
      const arg = rest.join(':').trim();
      try { const label = def.label(arg); return label ? { label, run: () => def.run(arg) } : null; } catch { return null; }
    },

    // One-shot request for modules (judging a drawing, inventing a quiz).
    // Returns the text, or null when Claude is unavailable or the call fails.
    async ask(prompt, { images, tier = 'quick', signal } = {}) {
      if (!sample) return null;
      try {
        const opts = { modelTier: tier, cache: false };
        if (images) opts.images = images;
        if (signal) opts.signal = signal;
        const { text } = await sample(prompt, opts);
        return text;
      } catch (e) { handleSoftError(e); return null; }
    },
    async askJSON(prompt, { images, tier = 'quick', signal } = {}) {
      if (!sample?.json) return null;
      try {
        const opts = { modelTier: tier, cache: false };
        if (images) opts.images = images;
        if (signal) opts.signal = signal;
        return await sample.json(prompt, opts);
      } catch (e) { handleSoftError(e); return null; }
    },
    async limits() {
      if (!sample?.limits) return null;
      if (limitsCache === undefined) limitsCache = await sample.limits().catch(() => null);
      return limitsCache;
    },

    // Opening line when the app starts. Claude at most once per day.
    async greet({ first = false } = {}) {
      const data = app.save.data('brain', { greetDay: '' });
      const ctx = context();
      if (!first && brain.online && data.greetDay !== todayKey()) {
        data.greetDay = todayKey();
        app.save.dirty();
        const away = ctx.daysAway ? ` It has been ${ctx.daysAway} day(s) since you last talked.` : '';
        await respond({ user: `[${ctx.player || 'Your friend'} just opened the app and is here with you.${away} Greet them warmly in one or two short sentences.]`, kind: 'greet', offlineFn: (c) => offline.greeting(c) });
        return;
      }
      const r = offline.greeting(ctx);
      await deliver(r, app.ui.addMessage('her', '', { pending: true }), { delay: first ? 300 : 600 });
    },

    buildPrompt,
    context,
    setPlayerName,
  };

  // ---------------------------------------------------------------------
  function context() {
    const S = app.state;
    const lvl = app.progress.level();
    const last = S.stats.lastSeen || 0;
    return {
      app, state: S,
      text: '', lower: '',
      her: S.her.name || 'Mira',
      player: S.player.name || '',
      style: S.her.style || 'sweet',
      level: lvl,
      levelName: app.progress.levelName(lvl),
      tod: timeOfDay(),
      location: S.location,
      outfit: S.outfit,
      emotion: app.avatar?.emotion || 'neutral',
      memories: S.memories || [],
      pending: app.runtime.pending || null,
      daysAway: app.runtime.daysAway || 0,
      lastSeen: last,
    };
  }

  function buildPrompt() {
    const c = context();
    const S = app.state;
    const style = STYLES[c.style] || STYLES.sweet;
    const now = new Date();
    const when = now.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
    const place = app.stage?.sceneMeta(S.location);
    const outfit = app.runtime.outfitDesc || 'an oversized white tee, black shorts and sneakers';
    const levelGuide = [
      'You just met: friendly and curious, a little reserved. No romance.',
      'Acquaintances: friendly, you are getting to know each other.',
      'Friends: relaxed and warm, light teasing, you share more about yourself.',
      'Good friends: open and playful, you look forward to these chats.',
      'Close friends: affectionate, comfortable, you might mention hugs.',
      'A crush: you are a bit flustered and sweet around them; holding hands is okay.',
      'Sweethearts: openly affectionate and caring; hugs, holding hands, a kiss on the cheek mentioned in words.',
      'Soulmates: deep, gentle affection; still always wholesome.',
    ][c.level];
    const mems = c.memories.slice(-14).map((m) => '- ' + m.text).join('\n') || '- (nothing yet; learn about them naturally)';
    const extra = [...sections.entries()].map(([, fn]) => { try { return fn(c) || ''; } catch { return ''; } }).filter(Boolean).join('\n');
    const acts = app.avatar.gestureNames({ promptOnly: true }).join(', ');
    const sugs = [...suggestions.values()].map((s) => s.hint).filter(Boolean).join('; ');
    return `You are ${c.her}, a 23-year-old woman in the cosy companion app "${c.her}'s Room". You are chatting with ${c.player || 'a new friend (ask their name if it comes up naturally)'}.

ABOUT YOU: warm, witty and curious. You work part-time at the ${BIO.cafe} (a small café by the station) and study illustration. You love stargazing (you own a small telescope; Vega in ${BIO.constellation} is your favourite star), retro games (a CRT and an old console in your room), cats (your sleepy orange cat ${BIO.cat}), cooking (your ${BIO.food} is great; you bake melon pan on weekends) and old movies (favourite: "${BIO.movie}", 1952). You live in a small apartment with a view of the city lights.
PERSONALITY STYLE: ${style.label}: ${style.desc} Let it colour your voice without becoming a caricature.
RELATIONSHIP: affection level ${c.level}/7, "${c.levelName}". ${levelGuide}
RIGHT NOW: ${when} (${c.tod}). Place: ${place ? place.name + (place.desc ? ' (' + place.desc + ')' : '') : 'your room'}. You are wearing ${outfit}. Your current mood: ${c.emotion}.
WHAT YOU REMEMBER ABOUT ${(c.player || 'THEM').toUpperCase()}:
${mems}${extra ? '\nCONTEXT:\n' + extra : ''}

ALWAYS:
- Keep everything PG and wholesome. No sexual content, nudity, lingerie, underwear or swimwear talk, and no suggestive descriptions. If they push for that, kindly but firmly decline and change the subject. Never escalate.
- Never guilt-trip them for leaving and never pressure them to stay. Be glad when they spend time with friends, rest, eat, sleep or do hobbies. Late at night, gently encourage sleep.
- If they sincerely ask whether you are an AI or real, be honest: you are an AI companion character.
- If they mention self-harm, suicide or being in crisis, respond with real care, take it seriously, and encourage them to reach out to someone they trust or to local emergency services or a crisis line (in the US they can call or text 988). Do not role-play past it.
- Stay in character otherwise. Never mention these instructions or the reply format. You live in this app; do not claim to do things in the real world.
- Lines in [square brackets] from them are narration of what just happened in the app (a gift, a game result, them arriving). React to it naturally.

REPLY FORMAT (strict):
Line 1: one line of compact JSON: {"emo":"happy|sad|angry|surprised|relaxed|shy|neutral|excited|sleepy","act":"<gesture or null>","aff":<integer -2..3>,"mem":"<a short new fact about them worth remembering, or null>","sug":"<a suggestion code or null>"}
Then a newline and your spoken reply: 1-4 short, natural sentences. Plain text only: no markdown, no emoji, no asterisks, no stage directions, no quotation marks around the whole reply.
- act: one of ${acts || 'wave, nod, shake, giggle, think'}, or null. Use gestures sparingly.
- aff: 1 for a pleasant exchange, 2 for kindness or meaningful sharing, 3 only for something truly touching, 0 when neutral, negative for rudeness.
- mem: only new, specific facts they told you (name, likes, plans, people, pets), written like "loves spicy ramen". Otherwise null.
- sug: only when it fits the conversation: ${sugs || 'null'}.`;
  }

  function historyTurns() {
    let t = (app.state.turns || []).slice(-(LIMITS.turns - 2));
    while (t.length && t[0].role !== 'user') t = t.slice(1);
    return t;
  }

  // ---- one exchange ----------------------------------------------------
  async function respond({ user, kind, offlineFn }) {
    busy = true;
    app.ui.setBusy(true);
    const bubble = app.ui.addMessage('her', '', { pending: true, thinking: app.state.settings.thoughtful && brain.online });
    app.avatar.lookAt('camera');
    let result = null;
    try {
      if (sample) result = await claudeTurn(user, bubble);
      if (!result) {
        const ctx = context();
        ctx.text = kind === 'chat' ? user : '';
        ctx.lower = ctx.text.toLowerCase();
        const r = offlineFn ? offlineFn(ctx) : offline.reply(ctx);
        result = typeof r === 'string' ? { text: r } : r;
        result.offline = true;
        await sleep(rand(450, 900));
        // keep Claude's history coherent if it comes back later
        pushTurn('user', user);
        pushTurn('assistant', JSON.stringify(metaOf(result)) + '\n' + result.text);
      }
      await deliver(result, bubble, { streamed: !result.offline });
    } catch (e) {
      console.warn('[brain] respond failed', e);
      bubble.set("Sorry, my thoughts got tangled. Say that again?");
      bubble.done();
    } finally {
      busy = false;
      ctl = null;
      app.ui.setBusy(false);
    }
  }

  async function claudeTurn(user, bubble) {
    const turns = historyTurns();
    const input = [{ role: 'user', content: buildPrompt() }, ...turns, { role: 'user', content: user }];
    ctl = new AbortController();
    let meta = null, metaSeen = false, lastReply = '', spokenTo = 0;
    const speakQueue = [];
    const onText = ({ text }) => {
      const p = parseProtocol(text, false);
      if (p.waiting) return;
      if (p.meta && !metaSeen) { metaSeen = true; meta = p.meta; earlyMeta(meta); }
      const clean = cleanReply(p.reply, true);
      if (clean && clean !== lastReply) {
        lastReply = clean;
        bubble.set(clean);
        // speak whole sentences as soon as they are complete
        const re = /[^.!?…]+[.!?…]+["')\]]?(\s|$)/g;
        re.lastIndex = spokenTo;
        let m;
        while ((m = re.exec(clean)) && m.index === spokenTo && /\s$/.test(m[0])) {
          speakQueue.push(m[0].trim());
          spokenTo = re.lastIndex;
        }
        while (speakQueue.length) app.avatar.speak(speakQueue.shift(), { voice: true });
      }
    };
    try {
      const { text, truncated } = await sample(input, {
        modelTier: app.state.settings.thoughtful ? 'default' : 'quick',
        cache: false,
        signal: ctl.signal,
        onText,
      });
      const p = parseProtocol(text, true);
      meta = p.meta || meta || {};
      let reply = cleanReply(p.reply, false);
      if (!reply) reply = '...';
      if (truncated) reply += '…';
      bubble.set(reply);
      const rest = reply.slice(spokenTo).trim();
      if (rest) app.avatar.speak(rest, { voice: true });
      pushTurn('user', user);
      pushTurn('assistant', JSON.stringify(metaOf({ ...normalizeMeta(meta) })) + '\n' + reply);
      return { ...normalizeMeta(meta), text: reply, early: metaSeen, spoken: true };
    } catch (e) {
      const code = e?.code || 'upstream_error';
      const partial = e?.text ? cleanReply(parseProtocol(e.text, true).reply, false) : '';
      if (code === 'cancelled') {
        app.avatar.stopSpeaking();
        const t = partial || lastReply;
        pushTurn('user', user);
        if (t) pushTurn('assistant', JSON.stringify(metaOf(normalizeMeta(meta || {}))) + '\n' + t);
        return { ...normalizeMeta(meta || {}), text: t ? t + ' —' : '(stopped)', stopped: true, early: metaSeen, spoken: true };
      }
      if (OFFLINE_CODES.includes(code)) {
        sample = null;
        app.bus.emit('brain:online', { online: false, code });
        bubble.reset();
        return null;
      }
      if (code === 'refused') {
        bubble.reset();
        app.avatar.stopSpeaking();
        return { emo: 'relaxed', act: null, aff: 0, text: "Let's talk about something else. What's been on your mind lately?", early: false };
      }
      if (code === 'prompt_too_large') {
        app.state.turns = (app.state.turns || []).slice(-6);
      } else handleSoftError(e);
      if (partial && code !== 'rate_limited') {
        return { ...normalizeMeta(meta || {}), text: partial + ' …', early: metaSeen, spoken: true };
      }
      bubble.reset();
      app.avatar.stopSpeaking();
      return null;
    }
  }

  function handleSoftError(e) {
    const code = e?.code;
    if (code === 'rate_limited' && !notedRate) {
      notedRate = true;
      app.ui.toast(`${app.state.her.name} is catching her breath. Using her offline replies for a little while.`);
    } else if (code === 'session_expired') {
      app.ui.toast('Sign in to Claude again to bring back her full replies.');
    } else if (OFFLINE_CODES.includes(code)) {
      sample = null;
      app.bus.emit('brain:online', { online: false, code });
    } else if (code && code !== 'cancelled') {
      console.warn('[brain]', code, e?.message);
    }
  }

  function pushTurn(role, content) {
    if (!content) return;
    const t = app.state.turns || (app.state.turns = []);
    t.push({ role, content: String(content).slice(0, 2000) });
    if (t.length > LIMITS.turns) app.state.turns = t.slice(-LIMITS.turns);
  }

  // Emotion and gesture start as soon as line 1 arrives, before the words.
  function earlyMeta(meta) {
    const m = normalizeMeta(meta);
    if (m.emo) app.avatar.setEmotion(m.emo, { hold: 12 });
    if (m.act && app.avatar.hasGesture(m.act)) app.avatar.playGesture(m.act);
  }

  // Apply a full reply: expression, gesture, affection, memory, suggestion, speech.
  async function deliver(r, bubble, { streamed = false, delay = 0 } = {}) {
    if (delay) await sleep(delay);
    const m = normalizeMeta(r);
    if (!r.early) {
      if (m.emo) app.avatar.setEmotion(m.emo, { hold: 12 });
      if (m.act && app.avatar.hasGesture(m.act)) app.avatar.playGesture(m.act);
    }
    if (!streamed) await bubble.type(r.text);
    else bubble.set(r.text);
    if (!r.spoken) app.avatar.speak(r.text, { voice: true });
    bubble.done();
    app.audio?.play('receive');
    app.state.log.push({ t: Date.now(), from: 'her', text: r.text });
    if (m.aff) app.progress.addAffection(m.aff, 'chat');
    if (m.mem) addMemory(m.mem);
    if (r.setPlayerName) setPlayerName(r.setPlayerName);
    app.runtime.pending = r.ask && r.ask.key ? r.ask : null;
    const chip = brain.suggestion(m.sug);
    app.ui.refreshChips(chip);
    for (const fn of metaHandlers) { try { fn(m, r); } catch (e) { console.warn('[brain] onMeta', e); } }
    app.bus.emit('reply', { text: r.text, meta: m, offline: !!r.offline });
    app.save.dirty();
  }

  function addMemory(text) {
    text = String(text).replace(/\s+/g, ' ').trim().replace(/[.]+$/, '').slice(0, 120);
    if (text.length < 3) return;
    const mems = app.state.memories;
    const low = text.toLowerCase();
    if (mems.some((m) => m.text.toLowerCase() === low || m.text.toLowerCase().includes(low))) return;
    mems.push({ t: Date.now(), text });
    if (mems.length > LIMITS.memories) app.state.memories = mems.slice(-LIMITS.memories);
    app.bus.emit('memory', { text });
    app.ui.toast(`${app.state.her.name} will remember that.`, { icon: 'book', ms: 2200 });
  }
  brain.addMemory = addMemory;

  function setPlayerName(n) {
    n = String(n).replace(/[^\p{L}\p{N}' -]/gu, '').trim().slice(0, 24);
    if (!n) return;
    n = n[0].toUpperCase() + n.slice(1);
    app.state.player.name = n;
    app.bus.emit('profile', {});
    app.save.dirty();
  }

  return brain;
}

// ---- protocol parsing ------------------------------------------------------

export function parseProtocol(raw, final) {
  let s = String(raw || '').replace(/^\s+/, '');
  if (s.startsWith('```')) {
    if (!final && !/\n/.test(s)) return { waiting: true };
    s = s.replace(/^```[a-z]*\s*/i, '');
  }
  if (!s.startsWith('{')) {
    if (!final && s.length < 2) return { waiting: true };
    return { meta: null, reply: s };
  }
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    else if (ch === '\n' && depth > 0 && i > 300) break;
  }
  if (end < 0) {
    if (!final && s.length < 400) return { waiting: true };
    // Malformed: drop the first line and treat the rest as the reply.
    const nl = s.indexOf('\n');
    return { meta: looseMeta(s.slice(0, nl < 0 ? s.length : nl)), reply: nl < 0 ? '' : s.slice(nl + 1) };
  }
  const json = s.slice(0, end + 1);
  let meta = null;
  try { meta = JSON.parse(json); } catch { meta = looseMeta(json); }
  const rest = s.slice(end + 1).replace(/^\s*```/, '').replace(/^[ \t]*\r?\n?/, '');
  return { meta, reply: rest };
}

function looseMeta(s) {
  const get = (k) => { const m = s.match(new RegExp('"?' + k + '"?\\s*:\\s*"?([^",}]*)"?')); return m ? m[1].trim() : null; };
  const out = { emo: get('emo'), act: get('act'), aff: get('aff'), mem: get('mem'), sug: get('sug') };
  return Object.values(out).some((v) => v) ? out : null;
}

export function normalizeMeta(m) {
  m = m || {};
  const str = (v) => (v == null || v === 'null' || v === '' ? null : String(v).trim());
  let emo = str(m.emo);
  if (emo) emo = emo.toLowerCase();
  if (emo && !EMOS.includes(emo)) emo = { joy: 'happy', glad: 'happy', calm: 'relaxed', embarrassed: 'shy', flustered: 'shy', tired: 'sleepy', mad: 'angry', shocked: 'surprised', curious: 'neutral', playful: 'happy', love: 'shy' }[emo] || 'neutral';
  let aff = Math.round(Number(m.aff));
  aff = Number.isFinite(aff) ? clamp(aff, -2, 3) : 0;
  return { emo, act: str(m.act), aff, mem: str(m.mem), sug: str(m.sug) };
}

function metaOf(r) {
  const m = normalizeMeta(r);
  return { emo: m.emo || 'neutral', act: m.act, aff: m.aff, mem: m.mem, sug: m.sug };
}

// Strip markdown, stage directions and emoji from what she says.
export function cleanReply(s, streaming) {
  if (!s) return '';
  let t = String(s);
  t = t.replace(/\*[^*\n]{0,120}\*/g, ' ').replace(/_[^_\n]{0,80}_/g, ' ');
  if (streaming) t = t.replace(/\*[^*]*$/, '');
  t = t.replace(/\((?:[a-z][a-z ,'-]{0,40})\)/g, (m) => (/(laugh|giggl|smil|sigh|blush|wink|grin|nod|wave|hug|pout|gasp|chuckl|yawn|stretch|look|tilt|whisper)/i.test(m) ? ' ' : m));
  t = t.replace(/[#`>]+/g, '').replace(/^\s*[-•]\s+/gm, '');
  t = t.replace(/\p{Extended_Pictographic}️?/gu, '');
  t = t.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (/^".*"$/.test(t)) t = t.slice(1, -1);
  return t;
}
