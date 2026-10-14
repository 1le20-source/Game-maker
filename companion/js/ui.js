// DOM UI: HUD, chat log, chips, composer, dock, bottom sheets, dialogs,
// toasts and the loading screen. Feature modules use the public methods
// (openSheet, registerDockButton, toast, addChip, showChoice, showInput).

import { el, pick, prefersReducedMotion, sleep, debounce } from './util.js';
import { icon } from './icons.js';

export const MOODS = {
  happy: 'cheerful', sad: 'a little blue', angry: 'pouty', surprised: 'surprised', relaxed: 'relaxed',
  shy: 'flustered', neutral: 'content', excited: 'excited', sleepy: 'sleepy',
};

const DEFAULT_CHIPS = [
  'How was your day?', 'Tell me about yourself', "Let's play a game", 'Tell me a joke',
  'What are you drawing?', 'Show me the stars', 'How is Mochi?', 'What should I cook tonight?',
  'Recommend me an old movie', 'I had a long day',
];

export function createUI(app) {
  const $ = (id) => document.getElementById(id);
  const root = $('app');
  const logEl = $('log');
  const chipsEl = $('chips');
  const form = $('composer');
  const input = $('msg');
  const sendBtn = $('sendBtn');
  const voiceBtn = $('voiceBtn');
  const dockEl = $('dock');
  const toastsEl = $('toasts');
  const sheetLayer = $('sheetLayer');
  const dialogLayer = $('dialogLayer');
  const dockButtons = [];
  let busy = false;
  let sheet = null; // {id, el, close}
  const reduced = () => prefersReducedMotion() || app.state.settings?.reduceMotion;

  const ui = {
    icon,

    init() {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (busy) {
          app.brain.stop();
          if (!text) return;
          input.value = '';
          const go = () => (app.brain.busy ? setTimeout(go, 60) : app.brain.send(text));
          setTimeout(go, 60);
          return;
        }
        if (!text) { input.focus(); return; }
        input.value = '';
        app.audio.play('send');
        app.brain.send(text);
      });
      voiceBtn.addEventListener('click', () => {
        const s = app.state.settings;
        s.voice = !s.voice;
        if (!s.voice) app.voice.cancel();
        ui.updateVoiceBtn();
        ui.toast(s.voice ? 'Voice on' : 'Voice off', { icon: s.voice ? 'speaker' : 'speakerOff', ms: 1400 });
        app.save.dirty();
      });
      $('camBtn').addEventListener('click', () => {
        const order = ['full', 'upper', 'face'];
        const next = order[(order.indexOf(app.stage.presetName()) + 1) % 3];
        app.stage.cameraPreset(next);
        app.state.settings.camera = next;
        app.save.dirty();
        ui.toast({ full: 'Full body', upper: 'Upper body', face: 'Close-up' }[next], { icon: 'camera', ms: 1200 });
      });
      $('heartBtn').addEventListener('click', () => app.ui.openJournal?.());
      $('coinBtn').addEventListener('click', () => app.ui.openGifts?.());
      $('logToggle').addEventListener('click', () => {
        const collapsed = root.classList.toggle('chat-collapsed');
        $('logToggle').setAttribute('aria-expanded', String(!collapsed));
        $('logToggle').innerHTML = icon(collapsed ? 'chevronUp' : 'chevronDown', 18);
        ui.computeInsets();
      });
      // Tapping send must not blur the input (keeps the phone keyboard open).
      for (const b of [sendBtn, voiceBtn]) b.addEventListener('pointerdown', (e) => { if (document.activeElement === input) e.preventDefault(); });
      // On touch screens a focused input means the keyboard is up: tuck the dock away.
      const coarse = matchMedia('(pointer: coarse)');
      input.addEventListener('focus', () => { if (coarse.matches) root.classList.add('typing'); });
      input.addEventListener('blur', () => setTimeout(() => root.classList.remove('typing'), 120));

      // Keep the composer above the on-screen keyboard.
      const vv = window.visualViewport;
      if (vv) {
        const onVV = () => {
          const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
          root.style.setProperty('--kb', kb > 60 ? kb + 'px' : '0px');
        };
        vv.addEventListener('resize', onVV);
        vv.addEventListener('scroll', onVV);
      }
      addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { if (dialogLayer.childElementCount) return; if (sheet) ui.closeSheet(); }
      });

      app.bus.on('emotion', () => ui.updateHUD());
      app.bus.on('affection', (d) => {
        ui.updateHUD();
        if (d.delta > 0) pulseHeart();
        if (d.leveledUp) {
          app.audio.play('level');
          ui.toast(`${app.state.her.name} now sees you as: ${d.levelName}`, { icon: 'heart', ms: 3600, tone: 'rose' });
        } else if (d.delta > 0) app.audio.play('heart');
      });
      app.bus.on('coins', (d) => { ui.updateHUD(); if (d.delta > 0 && d.reason !== 'chat') app.audio.play('coin'); });
      app.bus.on('profile', () => ui.updateHUD());
      app.bus.on('save:loaded', () => { ui.updateHUD(); ui.renderHistory(); });
      const ro = new ResizeObserver(debounce(() => ui.computeInsets(), 60));
      ro.observe(root);
      ro.observe($('chat'));
      ui.updateHUD();
      ui.updateVoiceBtn();
    },

    updateHUD() {
      const S = app.state;
      $('herName').textContent = S.her.name || 'Mira';
      input.placeholder = `Say something to ${S.her.name || 'Mira'}…`;
      const emo = app.avatar?.emotion || 'neutral';
      $('moodText').textContent = MOODS[emo] || 'content';
      $('mood').dataset.mood = emo;
      $('coinCount').textContent = S.coins;
      const lvl = app.progress.level();
      $('levelName').textContent = app.progress.levelName(lvl);
      $('levelNum').textContent = 'Lv ' + lvl;
      const p = app.progress.levelProgress();
      $('heartFill').setAttribute('y', String(24 - 24 * (0.12 + p * 0.88)));
      $('heartBtn').setAttribute('aria-label', `Affection: ${app.progress.levelName(lvl)}, level ${lvl}. Open journal`);
      $('coinBtn').setAttribute('aria-label', `${S.coins} coins. Open gifts`);
    },

    updateVoiceBtn() {
      const on = !!app.state.settings.voice;
      voiceBtn.innerHTML = icon(on ? 'speaker' : 'speakerOff', 20);
      voiceBtn.setAttribute('aria-pressed', String(on));
      voiceBtn.setAttribute('aria-label', on ? 'Voice on. Tap to mute' : 'Voice off. Tap to unmute');
    },

    // ---- chat --------------------------------------------------------------
    // from: 'her' | 'you' | 'system'. Returns a handle for streaming.
    addMessage(from, text = '', { pending = false, thinking = false, history = false } = {}) {
      const bubble = el('div.bubble');
      const row = el('div.msg.' + from + (history ? '.history' : ''), bubble);
      if (from === 'her') row.prepend(el('span.who', { text: app.state.her.name }));
      const dots = () => el('span.dots', { 'aria-label': thinking ? 'thinking' : 'typing' }, thinking ? el('span.think', { text: 'thinking' }) : null, el('i'), el('i'), el('i'));
      if (pending) { bubble.append(dots()); row.classList.add('pending'); }
      else bubble.textContent = text;
      logEl.append(row);
      while (logEl.childElementCount > 60) logEl.firstElementChild.remove();
      scrollLog();
      if (from === 'you' || from === 'system') { if (!history) app.state.log.push({ t: Date.now(), from, text }); }
      let stopTyping = false;
      return {
        el: row,
        set(t) { row.classList.remove('pending'); bubble.textContent = t; scrollLog(); },
        async type(t) {
          row.classList.remove('pending');
          if (reduced() || !t) { bubble.textContent = t; scrollLog(); return; }
          bubble.textContent = '';
          const words = t.split(/(\s+)/);
          let shown = '';
          for (const w of words) {
            if (stopTyping) break;
            shown += w;
            bubble.textContent = shown;
            if (w.trim()) { scrollLog(); await sleep(Math.min(90, 18 + w.length * 11)); }
          }
          bubble.textContent = t;
          scrollLog();
        },
        done() { row.classList.remove('pending'); },
        reset() { row.classList.add('pending'); bubble.replaceChildren(dots()); },
        remove() { stopTyping = true; row.remove(); },
      };
    },

    addSystemCard(kind) {
      const card = kind === 'crisis'
        ? el('div.card.crisis', { role: 'note' },
          el('strong', { text: 'You matter, and help is available right now.' }),
          el('p', { text: 'If you are thinking about hurting yourself, please contact your local emergency number or a crisis line, or tell someone you trust. In the US, call or text 988 (Suicide & Crisis Lifeline). In the UK and Ireland, Samaritans: 116 123. Elsewhere, findahelpline.com lists free local lines.' }))
        : el('div.card', { role: 'note' }, el('strong', { text: kind.title || '' }), el('p', { text: kind.text || '' }));
      logEl.append(el('div.msg.system', card));
      scrollLog();
    },

    renderHistory() {
      logEl.replaceChildren();
      const items = (app.state.log || []).slice(-8);
      for (const m of items) {
        if (m.from === 'system') continue;
        ui.addMessage(m.from, m.text, { history: true });
      }
      if (items.length) logEl.append(el('div.divider', el('span', { text: 'earlier' })));
    },

    setBusy(b) {
      busy = b;
      sendBtn.innerHTML = icon(b ? 'stop' : 'send', 20);
      sendBtn.setAttribute('aria-label', b ? 'Stop her reply' : 'Send');
      sendBtn.classList.toggle('stop', b);
    },

    // ---- chips --------------------------------------------------------------
    // Chips are quick replies: {label, text} sends text, {label, run} runs a function.
    setChips(list) {
      chipsEl.replaceChildren();
      for (const c of list.slice(0, 5)) ui.addChip(c);
    },
    addChip(label, action) {
      const c = typeof label === 'object' ? label : { label, ...(typeof action === 'function' ? { run: action } : { text: action || label }) };
      const b = el('button.chip' + (c.run ? '.action' : ''), { type: 'button' }, c.run ? el('span.chip-ico', { html: icon('sparkle', 14) }) : null, c.label);
      b.addEventListener('click', () => {
        app.audio.play('tap');
        if (c.run) c.run(); else if (!busy) app.brain.send(c.text);
        if (!c.keep) b.remove();
      });
      if (c.run) chipsEl.prepend(b); else chipsEl.append(b);
      return b;
    },
    refreshChips(suggestion) {
      const pool = DEFAULT_CHIPS.filter((t) => !app.state.log.slice(-12).some((m) => m.text === t));
      const picks = [];
      while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      const list = picks.map((t) => ({ label: t, text: t }));
      if (suggestion) list.unshift(suggestion);
      ui.setChips(list);
    },

    // ---- dock + sheets ----------------------------------------------------------
    registerDockButton({ id, label, icon: ic = 'sparkle', order = 50, onClick }) {
      const b = el('button.dock-btn', { type: 'button', 'data-id': id, 'aria-label': label }, el('span.dock-ico', { html: icon(ic, 22) }), el('span.dock-label', { text: label }));
      b.addEventListener('click', () => { app.audio.play('tap'); onClick?.(); });
      dockButtons.push({ id, order, b });
      dockButtons.sort((a, c) => a.order - c.order);
      dockEl.replaceChildren(...dockButtons.map((x) => x.b));
      return b;
    },

    // renderFn(body, sheet) fills the sheet. Returns {el, body, close(), setTitle()}.
    openSheet(id, title, renderFn) {
      if (sheet) ui.closeSheet(true);
      const body = el('div.sheet-body');
      const titleEl = el('h2.sheet-title', { id: 'sheetTitle', text: title });
      const closeBtn = el('button.icon-btn.sheet-close', { type: 'button', 'aria-label': 'Close', html: icon('close', 20) });
      const panel = el('section.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheetTitle', 'data-sheet': id },
        el('div.sheet-grip', { 'aria-hidden': 'true' }),
        el('header.sheet-head', titleEl, closeBtn), body);
      const scrim = el('div.scrim');
      scrim.addEventListener('click', () => ui.closeSheet());
      closeBtn.addEventListener('click', () => ui.closeSheet());
      sheetLayer.replaceChildren(scrim, panel);
      sheetLayer.hidden = false;
      requestAnimationFrame(() => sheetLayer.classList.add('open'));
      for (const d of dockButtons) d.b.classList.toggle('active', d.id === id);
      const handle = { id, el: panel, body, close: () => ui.closeSheet(), setTitle: (t) => { titleEl.textContent = t; }, onClose: null };
      sheet = handle;
      try { renderFn?.(body, handle); } catch (e) { console.error('[ui] sheet render', id, e); body.append(el('p.muted', { text: 'This page could not open. Try again in a moment.' })); }
      app.audio.play('open');
      app.bus.emit('sheet:open', { id });
      setTimeout(() => (panel.querySelector('[autofocus]') || closeBtn).focus({ preventScroll: true }), 50);
      return handle;
    },
    closeSheet(immediate = false) {
      if (!sheet) return;
      const s = sheet;
      sheet = null;
      try { s.onClose?.(); } catch (e) { console.warn(e); }
      for (const d of dockButtons) d.b.classList.remove('active');
      sheetLayer.classList.remove('open');
      app.audio.play('close');
      app.bus.emit('sheet:close', { id: s.id });
      const done = () => { if (!sheet) { sheetLayer.hidden = true; sheetLayer.replaceChildren(); } };
      if (immediate || reduced()) done(); else setTimeout(done, 260);
    },
    get sheetOpen() { return sheet?.id || null; },

    // ---- dialogs ---------------------------------------------------------------------
    // options: [{label, value, primary?, danger?}] -> Promise(value | null)
    showChoice({ title, text = '', options = [{ label: 'OK', value: true, primary: true }] }) {
      return new Promise((resolve) => {
        const box = el('div.dialog', { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlgTitle' },
          el('h3#dlgTitle', { text: title }), text ? el('p', { text }) : null);
        const row = el('div.dialog-actions');
        const close = (v) => { wrap.remove(); resolve(v); };
        for (const o of options) {
          const b = el('button.btn' + (o.primary ? '.primary' : '') + (o.danger ? '.danger' : ''), { type: 'button', text: o.label });
          b.addEventListener('click', () => close(o.value));
          row.append(b);
        }
        box.append(row);
        const wrap = el('div.dialog-wrap', el('div.scrim'), box);
        wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } });
        dialogLayer.append(wrap);
        (row.querySelector('.primary') || row.firstElementChild)?.focus();
      });
    },
    // -> Promise(string | null)
    showInput({ title, text = '', value = '', placeholder = '', maxLength = 24, okLabel = 'Save' }) {
      return new Promise((resolve) => {
        const inp = el('input.field', { type: 'text', id: 'dlgInput', value, placeholder, maxlength: String(maxLength), autocomplete: 'off' });
        const box = el('form.dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlgTitle' },
          el('h3#dlgTitle', { text: title }), text ? el('p', { text }) : null, inp,
          el('div.dialog-actions', el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }), el('button.btn.primary', { type: 'submit', text: okLabel })));
        const close = (v) => { wrap.remove(); resolve(v); };
        box.addEventListener('submit', (e) => { e.preventDefault(); close(inp.value.trim() || null); });
        const wrap = el('div.dialog-wrap', el('div.scrim'), box);
        wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } });
        dialogLayer.append(wrap);
        inp.focus();
        inp.select();
      });
    },

    // ---- toasts -------------------------------------------------------------------------
    toast(text, { icon: ic = 'sparkle', ms = 2600, tone = '' } = {}) {
      const t = el('div.toast' + (tone ? '.' + tone : ''), { role: 'status' }, el('span.toast-ico', { html: icon(ic, 16) }), el('span', { text }));
      toastsEl.append(t);
      while (toastsEl.childElementCount > 3) toastsEl.firstElementChild.remove();
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
    },

    // ---- loading ---------------------------------------------------------------------------
    setLoading(p, label) {
      p = Math.max(0, Math.min(1, p));
      $('loadBar').style.setProperty('--p', String(p));
      const bulbs = $('loadBar').querySelectorAll('i');
      bulbs.forEach((b, i) => b.classList.toggle('on', i < Math.round(p * bulbs.length)));
      if (label) $('loadLabel').textContent = label;
    },
    hideLoading() {
      const l = $('loading');
      l.classList.add('done');
      setTimeout(() => { l.hidden = true; }, reduced() ? 0 : 700);
    },

    // Screen area covered by UI -> stage insets so she stays in view.
    computeInsets() {
      const r = $('scene').getBoundingClientRect();
      const hud = $('hud').getBoundingClientRect();
      const chat = $('chat').getBoundingClientRect();
      const wide = root.classList.contains('wide');
      if (wide) {
        app.stage.setInsets({ top: hud.bottom - r.top, right: r.right - chat.left + 8, bottom: 0, left: 0 });
      } else {
        const chips = $('chips').getBoundingClientRect();
        const collapsed = root.classList.contains('chat-collapsed');
        const below = r.bottom - chips.top;
        app.stage.setInsets({ top: hud.bottom - r.top, right: 0, bottom: below + (collapsed ? 0 : r.height * 0.12), left: 0 });
      }
    },
  };

  function scrollLog() { logEl.scrollTop = logEl.scrollHeight; }
  function pulseHeart() {
    const h = $('heartBtn');
    h.classList.remove('pulse');
    void h.offsetWidth;
    h.classList.add('pulse');
  }

  // Wide layout switch
  const mq = matchMedia('(min-width: 900px) and (min-aspect-ratio: 1/1)');
  const applyWide = () => { root.classList.toggle('wide', mq.matches); ui.computeInsets?.(); };
  mq.addEventListener?.('change', applyWide);
  root.classList.toggle('wide', mq.matches);

  ui.pickChipText = () => pick(DEFAULT_CHIPS);
  return ui;
}
