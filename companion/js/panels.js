// Core sheets: Gifts, Journal, Settings, plus first-run onboarding.

import { el, pickFresh, todayKey } from './util.js';
import { icon } from './icons.js';
import { STYLES } from './offline.js';

export const GIFTS = [
  { id: 'cocoa', name: 'Hot cocoa', price: 8, aff: 2, hue: '#b07a52', glyph: 'leaf', line: 'With tiny marshmallows!' },
  { id: 'toy', name: 'Toy mouse for Mochi', price: 10, aff: 2, hue: '#c9c2d8', glyph: 'star', line: 'Mochi is going to lose her mind.' },
  { id: 'stickers', name: 'Glow-in-the-dark stars', price: 15, aff: 3, hue: '#9fb8ff', glyph: 'sparkle', line: 'I am covering my ceiling with these tonight!' },
  { id: 'daifuku', name: 'Strawberry daifuku', price: 12, aff: 3, hue: '#f3a6b6', glyph: 'heart', line: 'My weakness. How did you know?' },
  { id: 'sketchbook', name: 'Linen sketchbook', price: 20, aff: 4, hue: '#5b7fb8', glyph: 'book', fav: true, line: 'The paper is so nice. I almost don\'t want to draw in it. Almost.' },
  { id: 'flowers', name: 'Cosmos bouquet', price: 25, aff: 4, hue: '#ff9fb5', glyph: 'leaf', minLevel: 2, line: 'They are beautiful. I am putting them by the window.' },
  { id: 'starchart', name: 'Star chart poster', price: 30, aff: 5, hue: '#3f5ea8', glyph: 'star', fav: true, line: 'Lyra is right there! This is going over my bed.' },
  { id: 'cartridge', name: 'Retro game cartridge', price: 35, aff: 5, hue: '#8a8aa6', glyph: 'pad', fav: true, line: 'No way, this one is rare! Two-player tonight?' },
  { id: 'tickets', name: 'Old-movie night tickets', price: 40, aff: 6, hue: '#c98f72', glyph: 'sparkle', minLevel: 3, line: 'A classic double feature? It is a date. A movie date. You know what I mean.' },
  { id: 'pendant', name: 'Crescent moon pendant', price: 80, aff: 10, hue: '#e8c26a', glyph: 'moon', minLevel: 5, line: 'I will wear it every day. Thank you. Really.' },
];

export function initPanels(app) {
  const { ui } = app;

  ui.openGifts = () => ui.openSheet('gifts', 'Gifts', renderGifts);
  ui.openJournal = () => ui.openSheet('journal', 'Journal', renderJournal);
  ui.openSettings = () => ui.openSheet('settings', 'Settings', renderSettings);
  ui.registerDockButton({ id: 'gifts', label: 'Gifts', icon: 'gift', order: 40, onClick: ui.openGifts });
  ui.registerDockButton({ id: 'journal', label: 'Journal', icon: 'book', order: 50, onClick: ui.openJournal });
  ui.registerDockButton({ id: 'settings', label: 'Settings', icon: 'gear', order: 60, onClick: ui.openSettings });
  app.brain.registerSuggestion('gift', { hint: 'gift (open the gift shop)', label: () => 'Give her a gift', run: () => ui.openGifts() });

  // ---- Gifts ------------------------------------------------------------------
  function renderGifts(body) {
    const S = app.state;
    const lvl = app.progress.level();
    body.append(el('p.sheet-lead', {}, `You have `, el('strong.coins-inline', { html: icon('coin', 15) + ' ' + S.coins }), ` coins. Earn more by chatting and playing together.`));
    const grid = el('div.gift-grid');
    for (const g of GIFTS) {
      const locked = (g.minLevel || 0) > lvl;
      const afford = S.coins >= g.price;
      const b = el('button.gift' + (locked ? '.locked' : ''), { type: 'button', disabled: locked || !afford, 'aria-label': `${g.name}, ${g.price} coins${locked ? ', locked' : ''}` },
        el('span.gift-swatch', { style: { '--hue': g.hue }, html: icon(locked ? 'lock' : g.glyph, 22) }),
        el('span.gift-name', { text: g.name }),
        el('span.gift-price', { html: locked ? `Unlocks at ${app.progress.levelName(g.minLevel)}` : icon('coin', 13) + ' ' + g.price }));
      b.addEventListener('click', () => give(g));
      grid.append(b);
    }
    body.append(grid);
  }

  async function give(g) {
    if (!app.progress.spendCoins(g.price)) { ui.toast('Not enough coins yet.', { icon: 'coin' }); return; }
    ui.closeSheet();
    app.audio.play('gift');
    const S = app.state;
    const first = app.progress.unlock('gift:' + g.id);
    app.progress.addAffection(g.aff, 'gift');
    app.progress.addMoment('gift', `You gave ${S.her.name} a ${g.name.toLowerCase()}.`);
    app.avatar.playGesture(g.fav ? 'bounce' : 'giggle');
    await app.brain.event(`${S.player.name || 'Your friend'} gives you a gift: ${g.name}.${g.fav ? ' It is exactly your kind of thing.' : ''}${first ? '' : ' They have given you this before.'} React warmly in character. Use aff 0 (the gift already counted).`, {
      note: `You gave ${S.her.name} a ${g.name.toLowerCase()}.`,
      offline: () => ({ emo: g.fav ? 'excited' : 'happy', act: g.fav ? 'bounce' : 'giggle', aff: 0, text: (first ? pickFresh('giftA', ['For me? ', 'Oh! ', 'Wait, really? ']) : pickFresh('giftB', ['Another one? You spoil me. ', 'Again? ', ''])) + g.line }),
    });
  }

  // ---- Journal -------------------------------------------------------------------
  function renderJournal(body, sheet) {
    const tabs = [['memories', 'Memories'], ['moments', 'Moments'], ['us', 'Us']];
    const bar = el('div.tabs', { role: 'tablist' });
    const panel = el('div.tab-panel', { role: 'tabpanel' });
    let current = 'memories';
    const draw = () => {
      for (const b of bar.children) { const on = b.dataset.tab === current; b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on); }
      panel.replaceChildren();
      if (current === 'memories') drawMemories(panel);
      if (current === 'moments') drawMoments(panel);
      if (current === 'us') drawUs(panel);
    };
    for (const [id, label] of tabs) {
      const b = el('button.tab', { type: 'button', role: 'tab', 'data-tab': id, text: label });
      b.addEventListener('click', () => { current = id; draw(); });
      bar.append(b);
    }
    body.append(bar, panel);
    draw();
    sheet.setTitle(`${app.state.her.name}'s journal`);
  }

  function drawMemories(p) {
    const S = app.state;
    p.append(el('p.sheet-lead', { text: `Things ${S.her.name} remembers about you. Remove anything you would rather she forgot.` }));
    if (!S.memories.length) { p.append(el('p.empty', { text: 'Nothing yet. Tell her about your day, your favourite food or your pets.' })); return; }
    const list = el('ul.mem-list');
    [...S.memories].reverse().forEach((m) => {
      const del = el('button.icon-btn.small', { type: 'button', 'aria-label': 'Forget this', html: icon('trash', 16) });
      del.addEventListener('click', () => {
        S.memories = S.memories.filter((x) => x !== m);
        app.save.dirty();
        li.remove();
        ui.toast('Forgotten.', { icon: 'trash', ms: 1400 });
      });
      const li = el('li', el('span', { text: cap(m.text) }), del);
      list.append(li);
    });
    p.append(list);
  }

  function drawMoments(p) {
    const items = [...app.state.journal].reverse().slice(0, 60);
    if (!items.length) { p.append(el('p.empty', { text: 'Your story together starts here. Gifts, milestones and outings will show up on this page.' })); return; }
    const list = el('ol.moments');
    for (const m of items) {
      const d = new Date(m.t);
      list.append(el('li.moment', { 'data-kind': m.kind },
        el('time', { datetime: d.toISOString(), text: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }),
        el('span', { text: m.text })));
    }
    p.append(list);
  }

  function drawUs(p) {
    const S = app.state;
    const lvl = app.progress.level();
    const next = app.progress.LEVELS[lvl + 1];
    const pct = Math.round(app.progress.levelProgress() * 100);
    p.append(
      el('div.us-level',
        el('span.us-heart', { html: icon('heart', 28) }),
        el('div', el('strong', { text: app.progress.levelName(lvl) }), el('span.muted', { text: next ? `${pct}% of the way to ${next.name}` : 'As close as it gets.' }))),
      el('div.meter', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), style: { '--p': pct / 100 } }, el('span')),
      el('dl.stats',
        el('dt', { text: 'Days together' }), el('dd', { text: String(S.stats.days || 1) }),
        el('dt', { text: 'Visit streak' }), el('dd', { text: String(S.stats.streak || 1) }),
        el('dt', { text: 'Messages' }), el('dd', { text: String(S.stats.messages || 0) }),
        el('dt', { text: 'Affection points' }), el('dd', { text: String(S.affection.points) }),
        el('dt', { text: 'Coins' }), el('dd', { text: String(S.coins) }),
        el('dt', { text: 'Memories' }), el('dd', { text: String(S.memories.length) })),
    );
  }

  // ---- Settings --------------------------------------------------------------------
  function renderSettings(body, sheet) {
    const S = app.state, st = S.settings;
    const save = () => { app.save.dirty(); app.bus.emit('settings', { settings: st }); };
    const group = (title, ...rows) => el('section.set-group', el('h3', { text: title }), ...rows);
    const row = (label, control, hint) => el('div.set-row', el('div.set-label', el('span', { text: label }), hint ? el('small', { text: hint }) : null), control);
    const toggle = (id, key, onChange) => {
      const b = el('button.switch', { type: 'button', role: 'switch', id, 'aria-checked': String(!!st[key]) }, el('span'));
      b.addEventListener('click', () => { st[key] = !st[key]; b.setAttribute('aria-checked', String(!!st[key])); onChange?.(st[key]); save(); });
      return b;
    };
    const slider = (id, key, min, max, step, onChange) => {
      const r = el('input.range', { type: 'range', id, min: String(min), max: String(max), step: String(step), value: String(st[key]) });
      r.addEventListener('input', () => { st[key] = Number(r.value); onChange?.(st[key]); save(); });
      return r;
    };
    const textBtn = (text, onClick, cls = '') => { const b = el('button.btn.small' + cls, { type: 'button', text }); b.addEventListener('click', onClick); return b; };

    // Her
    const herName = textBtn(S.her.name, async () => {
      const v = await ui.showInput({ title: 'Her name', text: 'What should she be called?', value: S.her.name, maxLength: 20 });
      if (v) { S.her.name = cleanName(v); herName.textContent = S.her.name; app.bus.emit('profile', {}); save(); sheet.setTitle('Settings'); }
    });
    const you = textBtn(S.player.name || 'Set your name', async () => {
      const v = await ui.showInput({ title: 'Your name', text: `What should ${S.her.name} call you?`, value: S.player.name, maxLength: 24 });
      if (v) { app.brain.setPlayerName(v); you.textContent = S.player.name; }
    });
    const styles = el('div.seg', { role: 'radiogroup', 'aria-label': 'Personality' });
    for (const [id, s] of Object.entries(STYLES)) {
      const b = el('button.seg-btn', { type: 'button', role: 'radio', 'aria-checked': String(S.her.style === id), text: s.label });
      b.addEventListener('click', () => {
        S.her.style = id;
        for (const x of styles.children) x.setAttribute('aria-checked', String(x === b));
        styleNote.textContent = `“${s.sample}”`;
        app.bus.emit('profile', {});
        save();
      });
      styles.append(b);
    }
    const styleNote = el('p.style-note', { text: `“${(STYLES[S.her.style] || STYLES.sweet).sample}”` });

    // Voice
    const voices = app.voice.listVoices();
    const vSel = el('select.field', { id: 'setVoiceName', 'aria-label': 'Voice' });
    vSel.append(el('option', { value: '', text: 'Automatic (best match)' }));
    for (const v of voices) vSel.append(el('option', { value: v.name, text: `${v.name} (${v.lang})`, selected: v.name === st.voiceName }));
    vSel.addEventListener('change', () => { st.voiceName = vSel.value; save(); });
    const test = textBtn('Test voice', () => {
      app.voice.unlock();
      app.audio.unlock();
      app.avatar.speak(`Hi${S.player.name ? ' ' + S.player.name : ''}! This is how I sound.`, { voice: true });
    });

    // Mind
    const online = app.brain.online;
    const mind = el('p.set-status', { 'data-online': String(online) },
      el('span.dot'), online ? 'Her replies come from Claude on your account.' : 'Using her built-in offline replies. Everything still works.');

    // Save
    const exportBtn = textBtn('Export save', async () => {
      const dl = await Promise.resolve(window.claude?.use?.('downloads')).catch(() => null);
      if (!dl) { ui.toast('Export is not available here.', { icon: 'download' }); return; }
      try {
        await dl.save({ filename: `miras-room-save-${todayKey()}.json`, data: app.save.exportJSON() });
        ui.toast('Save exported.', { icon: 'download' });
      } catch (e) { if (e?.code !== 'declined') ui.toast('Export did not go through.', { icon: 'download' }); }
    });
    const resetBtn = textBtn('Start over', async () => {
      const ok = await ui.showChoice({ title: 'Start over?', text: `This erases ${S.her.name}'s memories, your progress and settings. It cannot be undone.`, options: [{ label: 'Cancel', value: false }, { label: 'Erase everything', value: true, danger: true }] });
      if (!ok) return;
      ui.closeSheet();
      await app.save.reset();
      location.reload();
    }, '.danger');

    body.append(
      group('Her',
        row('Name', herName),
        row('Personality', styles),
        styleNote),
      group('You', row('Your name', you)),
      group('Voice',
        row('Speak replies', toggle('setVoice', 'voice', () => ui.updateVoiceBtn()), app.voice.available ? 'Uses your device voices' : 'No voices on this device'),
        row('Voice', vSel),
        row('Pitch', slider('setPitch', 'pitch', 0.7, 1.5, 0.01)),
        row('Speed', slider('setRate', 'rate', 0.7, 1.4, 0.01)),
        el('div.set-actions', test)),
      group('Sound',
        row('Music', toggle('setMusic', 'music', () => app.audio.applySettings()), 'A quiet lo-fi loop'),
        row('Music volume', slider('setMusicVol', 'musicVolume', 0, 1, 0.01, () => app.audio.applySettings())),
        row('Sound effects', toggle('setSfx', 'sfx'))),
      group('Mind',
        mind,
        row('Thoughtful replies', online ? toggle('setThoughtful', 'thoughtful') : el('span.muted', { text: 'Needs Claude' }), 'Slower, deeper answers. Uses more of your Claude usage.')),
      group('Display',
        row('Reduce motion', toggle('setReduce', 'reduceMotion', (v) => document.getElementById('app').classList.toggle('reduce-motion', v)))),
      group('Save',
        el('p.set-status', { 'data-online': String(app.save.mode === 'cloud') }, el('span.dot'), app.save.mode === 'cloud' ? 'Progress is saved to your account for this app.' : 'Progress is saved in this browser.'),
        el('div.set-actions', exportBtn, resetBtn)),
      group('About',
        el('p.about', { text: `${S.her.name} is an AI companion character. When Claude is available on your account her replies come from it; otherwise she uses a built-in script. She is not a person, and she is always happy for you to log off and see friends, eat something, or sleep.` }),
        el('p.about.muted', { text: '3D model: VRM sample by pixiv Inc. (VRM Public License 1.0). Room, music and sounds are generated in your browser.' })),
    );
  }

  // ---- Onboarding --------------------------------------------------------------------
  ui.onboard = () => new Promise((resolve) => {
    const S = app.state;
    const wrap = document.getElementById('onboard');
    const draft = { player: S.player.name || '', style: S.her.style || 'sweet', her: S.her.name || 'Mira' };
    let step = 0;
    const card = el('div.ob-card', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'obTitle' });
    wrap.replaceChildren(el('div.ob-scrim'), card);
    wrap.hidden = false;
    const dots = () => el('div.ob-steps', { 'aria-hidden': 'true' }, [0, 1, 2].map((i) => el('i' + (i === step ? '.on' : ''))));
    const next = () => { step++; draw(); };

    function draw() {
      card.replaceChildren();
      if (step === 0) {
        const inp = el('input.field', { id: 'obName', type: 'text', maxlength: '24', placeholder: 'Your name', value: draft.player, autocomplete: 'off', enterkeyhint: 'next' });
        const f = el('form.ob-form', {},
          el('p.ob-kicker', { text: 'Welcome in' }),
          el('h2#obTitle', { text: 'What should she call you?' }),
          el('p.ob-text', { text: 'She will remember it. You can change it any time in Settings.' }),
          inp,
          el('div.ob-actions', el('button.btn.primary', { type: 'submit', text: 'Continue' })), dots());
        f.addEventListener('submit', (e) => { e.preventDefault(); draft.player = inp.value.trim(); next(); });
        card.append(f);
        setTimeout(() => inp.focus(), 60);
      } else if (step === 1) {
        const list = el('div.ob-styles', { role: 'radiogroup', 'aria-label': 'Personality' });
        for (const [id, s] of Object.entries(STYLES)) {
          const b = el('button.ob-style', { type: 'button', role: 'radio', 'aria-checked': String(draft.style === id) },
            el('strong', { text: s.label }), el('span', { text: s.desc }), el('em', { text: `“${s.sample}”` }));
          b.addEventListener('click', () => {
            draft.style = id;
            for (const x of list.children) x.setAttribute('aria-checked', String(x === b));
            app.audio.play('tap');
          });
          list.append(b);
        }
        card.append(el('p.ob-kicker', { text: 'Her personality' }), el('h2#obTitle', { text: 'How does she talk?' }), list,
          el('div.ob-actions', el('button.btn', { type: 'button', text: 'Back', onclick: () => { step--; draw(); } }), el('button.btn.primary', { type: 'button', text: 'Continue', onclick: next })), dots());
      } else {
        const inp = el('input.field', { id: 'obHer', type: 'text', maxlength: '20', value: draft.her, autocomplete: 'off' });
        const f = el('form.ob-form', {},
          el('p.ob-kicker', { text: 'Last thing' }),
          el('h2#obTitle', { text: 'Her name' }),
          el('p.ob-text', { text: 'She goes by Mira. Keep it, or give her a name of your own.' }),
          inp,
          el('p.ob-note', { text: 'She is an AI companion. With Claude available on your account she answers with it; otherwise she uses a built-in script.' }),
          el('div.ob-actions',
            el('button.btn', { type: 'button', text: 'Keep Mira', onclick: () => { draft.her = 'Mira'; finish(); } }),
            el('button.btn.primary', { type: 'submit', text: 'Say hi' })), dots());
        f.addEventListener('submit', (e) => { e.preventDefault(); draft.her = cleanName(inp.value) || 'Mira'; finish(); });
        card.append(f);
      }
    }
    function finish() {
      if (draft.player) app.brain.setPlayerName(draft.player);
      S.her.style = draft.style;
      S.her.name = draft.her;
      S.onboarded = true;
      app.progress.addMoment('start', `You met ${S.her.name}.`);
      app.bus.emit('profile', {});
      app.save.dirty();
      wrap.classList.add('out');
      setTimeout(() => { wrap.hidden = true; wrap.classList.remove('out'); wrap.replaceChildren(); resolve(); }, 300);
    }
    draw();
  });
}

function cleanName(v) {
  const n = String(v || '').replace(/[^\p{L}\p{N}' -]/gu, '').trim().slice(0, 20);
  return n ? n[0].toUpperCase() + n.slice(1) : '';
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
