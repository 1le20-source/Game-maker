// Serenity Hands — relationships and everyday life:
//  - 💔 breaking up (either way) or 🗑️ deleting a number takes them out of
//    your phone: they vanish from 💞 People (exes won't give it back easily)
//  - 💼 dating your staff: ask an employee out, steal a kiss at work, invite
//    them over; a breakup with an employee can end with them quitting
//  - 💬 texting your contacts, 🎂 birthdays (gifts count double), 📸 a memory
//    album of the moments you shared
//  - ☀️ the mansion in daylight when you're home during the day
// Loaded after the main game script and game/home.js.
(function () {
  'use strict';
  const g = window, $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ contacts
  const baseHas = g.hasNumber;
  g.hasNumber = (p) => !!p && !p.deleted && p.status !== 'ex' && baseHas(p);
  const contacts = () => Object.values(S.people || {}).filter(hasNumber).sort((a, b) => b.aff - a.aff); // same order as the People list

  // memories: a short line for each moment you shared
  function remember(p, what) {
    if (!p) return;
    p.memories = p.memories || [];
    p.memories.push({ day: S.day, what });
    if (p.memories.length > 40) p.memories.shift();
  }
  g.rememberMoment = remember;

  // birthdays: everyone has one day in each 30-day month
  const bdayOf = (p) => (p.bday = p.bday || 1 + Math.floor(((p.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 7) % 30));
  const isBirthday = (p) => p && (S.day % 30 || 30) === bdayOf(p);

  // ------------------------------------------------- People list additions
  const baseShowPeople = g.showPeople;
  g.showPeople = function (back) {
    const out = baseShowPeople.apply(this, arguments);
    try {
      const list = contacts();
      const intro = document.querySelector('#modal > p');
      if (intro) intro.textContent = 'Your contacts: people who gave you their number. Great sessions, texts, gifts and dates build affection; at 45+ you can ask them out. Break up or delete a number and they\'re gone from your phone.';
      document.querySelectorAll('#modal canvas[data-pp]').forEach((cv) => {
        const i = +cv.dataset.pp, p = list[i], card = cv.closest('.item');
        if (!p || !card) return;
        const t = card.querySelector('.t');
        if (t && isBirthday(p)) t.insertAdjacentHTML('beforeend', ' <span title="Birthday today">🎂</span>');
        if (t && p.staffId && (S.staff || []).some((s) => s.id === p.staffId)) t.insertAdjacentHTML('beforeend', ' <span class="pron">· works for you</span>');
        const row = card.querySelector('div[style*="flex-wrap"]');
        if (!row) return;
        const add = (label, fn, cls) => { const b = document.createElement('button'); b.innerHTML = label; if (cls) b.className = cls; b.onclick = () => { initAudio(); fn(p, back); }; row.appendChild(b); return b; };
        const tb = add('💬 Text', textMenu);
        if (p.textDay === S.day) { tb.disabled = true; tb.title = 'You already texted today'; }
        if ((p.memories || []).length) add(`📸 Memories (${p.memories.length})`, showMemories);
        add('🗑️ Delete number', deleteNumber);
        if (isBirthday(p)) card.insertAdjacentHTML('beforeend', '<div class="d">🎂 It\'s their birthday today — a gift counts double!</div>');
      });
      // birthday gifts count double
      document.querySelectorAll('#modal [data-gift]').forEach((b) => {
        const p = list[+b.dataset.gift], orig = b.onclick;
        if (!p || !orig) return;
        b.onclick = function () {
          const before = p.aff;
          orig.apply(this, arguments);
          if (isBirthday(p) && p.aff > before) { p.aff = Math.min(100, p.aff + (p.aff - before)); remember(p, '🎂 You gave them a birthday present'); saveGame(); toast(`🎂 ${p.c.name}: “You remembered my birthday?!” (double affection)`); showPeople(back); }
        };
      });
    } catch (e) { console.warn('people', e); }
    return out;
  };

  function deleteNumber(p, back) {
    showModal(`<h2>🗑️ Delete ${esc(p.c.name)}'s number?</h2><p>They'll disappear from your phone and 💞 People. If they come back to the spa, you could ask again — but they might not be as keen.</p>`,
      [['Delete', () => { p.deleted = true; p.number = false; if (['dating', ...COMMITTED].includes(p.status)) { p.status = 'ex'; p.livesIn = false; } p.aff = Math.max(0, p.aff - 15); saveGame(); toast(`🗑️ ${p.c.name} is gone from your phone.`); showPeople(back); }, 'danger'], ['Keep it', () => showPeople(back), '']]);
  }

  // texting: one conversation a day, the reply comes after a moment
  const TEXTS = [
    ['☀️ “Good morning! Hope your day is amazing.”', 2, ['Good morning to you too ☀️ You just made my day.', 'Aww, morning! ☺️', 'Morning! Coffee first, then I\'ll be amazing 😂']],
    ['💭 “Thinking about you.”', 3, ['…I was literally just thinking about you too 💕', 'Stop, you\'re making me blush 🙈', 'Same 😊']],
    ['😂 Send a funny meme', 2, ['HAHAHA I\'m crying 😂😂', 'Why is this so accurate 💀', 'Okay that\'s going in the group chat.']],
    ['📅 “Want to hang out this week?”', 2, ['Yes!! When? 😊', 'I\'d love that. Text me a time?', 'Only if you\'re buying the coffee ☕😉']],
  ];
  function textMenu(p, back) {
    showModal(`<h2>💬 Text ${esc(p.c.name)}</h2><p>${isBirthday(p) ? '🎂 It\'s their birthday today!' : 'Pick a message.'}</p>`,
      TEXTS.map(([label, aff, replies]) => [label, () => {
        p.textDay = S.day; const happy = !p.upset && p.aff >= 20;
        p.aff = Math.min(100, p.aff + (happy ? aff : 0)); saveGame();
        hideModal(); state = state === 'modal' ? 'world' : state;
        if (back && state !== 'world') back();
        setTimeout(() => { chime(); toast(`📱 ${p.c.name}: ${happy ? pick(replies) : pick(['k.', 'Busy right now.', '👍'])}`); }, 1500 + Math.random() * 2500);
      }, '']).concat([['← Back', () => showPeople(back), '']]));
  }
  function showMemories(p, back) {
    const m = (p.memories || []).slice().reverse();
    showModal(`<h2>📸 You and ${esc(p.c.name)}</h2><div class="rows" style="max-height:50vh;overflow:auto">${m.map((x) => `<div class="row"><span>${esc(x.what)}</span><b>Day ${x.day}</b></div>`).join('')}</div>`, [['← Back', () => showPeople(back), 'primary']]);
  }

  // remember the moments: date activities, kisses, nights together, goodnights
  const ACT_MEM = { movie: '🍿 Watched a movie together', games: '🎮 Played video games', billiards: '🎱 Shot pool', cook: '🍳 Cooked dinner together', dinner: '🕯️ Candlelit dinner', piano: '🎹 You played the piano for them', library: '📚 Browsed the library', paint: '🎨 Painted together', gym: '🏋️ Worked out together', dance: '💃 Danced on the terrace', stars: '✨ Stargazed by the fire pit', cat: '🐱 Played with Mochi', bar: '🍸 Drinks at the home bar' };
  const baseEndActivity = g.endActivity;
  g.endActivity = function (A, key, e) { try { remember(S.people[e.pid], ACT_MEM[key] || A.label); } catch (_) { /* best effort */ } return baseEndActivity.apply(this, arguments); };
  const baseDlg = g.dlg;
  // a few lines say what just happened; catch them for the album
  const MOMENTS = [[/\*clink\*/, '🍷 A toast together'], [/\*blushes\*/, '😘 A kiss on the cheek']];
  g.dlg = function (name, text) {
    try {
      const p = Object.values(S.people || {}).find((q) => q.c && q.c.name === name);
      if (p && typeof text === 'string') for (const [re, what] of MOMENTS) if (re.test(text) && !(p.memories || []).some((x) => x.what === what)) remember(p, what);
    } catch (_) { /* best effort */ }
    return baseDlg.apply(this, arguments);
  };
  Object.assign(g.dlg, baseDlg);

  // ------------------------------------------------------- dating staff
  const idKeyOf = (c) => c.idKey || Object.keys(IDS).find((k) => IDS[k].label === c.idLabel) || (c.body && c.body.masc ? 'man' : 'woman');
  function personForStaff(s) {
    S.people = S.people || {};
    let p = Object.values(S.people).find((q) => q.staffId === s.id);
    if (p) return p;
    const ids = TOPICS.map((t) => t.id).sort(() => Math.random() - 0.5), idKey = idKeyOf(s.c), c = JSON.parse(JSON.stringify(s.c));
    Object.assign(c, { idKey, subj: (IDS[idKey] || IDS.woman).subj, pref: 2, favScent: 'lavender', ticklish: false, hairOil: false, chatty: true });
    try { c.look = Object.assign(lookFor(c), { mood: '' }); } catch (_) { c.look = { mood: '' }; }
    const id = 'st' + s.id;
    p = S.people[id] = { id, aff: 30, status: 'friend', visits: 0, dates: 0, likes: ids.slice(0, 2), dislike: ids[2], giftDay: 0, lastDay: S.day, c, staffId: s.id, number: true };
    return p;
  }
  const committedElsewhere = (p) => Object.values(S.people || {}).some((q) => q !== p && isCommitted(q) && !q.open);
  const baseStaffMenu = g.staffMenu;
  g.staffMenu = function (st) {
    const s = st.s, extra = [];
    const p = Object.values(S.people || {}).find((q) => q.staffId === s.id && hasNumber(q));
    const romantic = p && ['dating', ...COMMITTED].includes(p.status);
    if (!romantic && s.askDay !== S.day) extra.push(['💕 Ask them out', () => askOut(st)]);
    if (romantic) {
      if (s.kissDay !== S.day) extra.push(['😘 Steal a quick kiss in the break room', () => workKiss(st, p)]);
      if (!(S.homeDate && S.homeDate.day === S.day)) extra.push(['🏰 Ask them over tonight', () => { inviteHome(p, () => { hideModal(); state = 'world'; }); }]);
    }
    if (!extra.length) return baseStaffMenu.apply(this, arguments);
    const d = g.dlg;
    const wrap = function (name, text, choices) { g.dlg = d; if (choices && choices.length) { const last = choices.pop(); choices.push(...extra, last); } return d(name, text, choices); };
    Object.assign(wrap, d);
    g.dlg = wrap;
    try { return baseStaffMenu.apply(this, arguments); } finally { g.dlg = d; }
  };
  function askOut(st) {
    const s = st.s, name = s.c.name;
    s.askDay = S.day;
    const p = personForStaff(s), taken = committedElsewhere(p);
    const chance = 0.3 + morale(s) * 0.35 + (p.aff - 30) / 100 + (taken ? -0.35 : 0);
    if (Math.random() < chance) {
      p.status = 'dating'; p.aff = Math.max(p.aff, 50); p.number = true; p.deleted = false; s.morale = Math.min(1, morale(s) + 0.1);
      remember(p, '💼 You asked them out at work'); saveGame(); setEmote(st, 'heart', 3); chime();
      dlg(name, pick(['Wait… really? Yes! I mean — yes. I\'ve kind of had a crush on you since my first day. 💕', 'Ha… I was hoping you\'d ask. Yes. But we keep it professional on the clock, boss. 😉', 'Okay, yes! Just… let\'s not tell the others yet? 🙈']), null);
    } else {
      s.morale = Math.max(0, morale(s) - 0.05); saveGame(); setEmote(st, 'sweat', 2.5);
      dlg(name, taken ? 'Aren\'t you seeing someone? I don\'t want to get in the middle of that.' : pick(['Oh! Um… I\'m flattered, but I think we should keep things professional.', 'That\'s sweet, but I like working here too much to make it weird. Friends?']), null);
    }
  }
  function workKiss(st, p) {
    const s = st.s; s.kissDay = S.day;
    p.aff = Math.min(100, p.aff + 3); setEmote(st, 'heart', 3); chime();
    const seen = Math.random() < 0.2 && (S.staff || []).length > 1;
    if (seen) for (const o of S.staff) if (o !== s) o.morale = Math.max(0, morale(o) - 0.04);
    saveGame();
    dlg(s.c.name, pick(['*quick kiss* …Okay, back to work, boss. 💕', 'Mm. You\'re trouble, you know that? 😘', '*smiles* Someone could walk in…']), null);
    if (seen) setTimeout(() => toast('👀 Somebody from the team saw that… the others are a little awkward today.'), 1600);
  }
  // after a breakup with an employee, they may not want to stay
  const baseStartDay = g.startDayWorld;
  g.startDayWorld = function () {
    try {
      for (const p of Object.values(S.people || {})) {
        if (!p.staffId || p.status !== 'ex' || p.quitChecked) continue;
        p.quitChecked = true;
        const i = (S.staff || []).findIndex((s) => s.id === p.staffId);
        if (i >= 0 && Math.random() < 0.6) { const s = S.staff[i]; S.staff.splice(i, 1); setTimeout(() => toast(`💼 ${s.c.name} handed in their notice after the breakup.`), 2500); }
        else if (i >= 0) { S.staff[i].morale = Math.max(0, morale(S.staff[i]) - 0.3); }
      }
    } catch (e) { console.warn(e); }
    return baseStartDay.apply(this, arguments);
  };

  // birthdays: a reminder when the day starts
  const baseStart2 = g.startDayWorld;
  g.startDayWorld = function () {
    const out = baseStart2.apply(this, arguments);
    try { const b = contacts().find(isBirthday); if (b) setTimeout(() => toast(`🎂 It's ${b.c.name}'s birthday today! A text or a gift would mean a lot.`), 4200); } catch (_) { /* fine */ }
    return out;
  };

  // ---------------------------------------------------- the mansion by day
  const SKY = { lights: null };
  function findSky() {
    if (!R3 || !R3.homeScene) return null;
    if (SKY.scene === R3.homeScene) return SKY;
    Object.assign(SKY, { scene: R3.homeScene, hemi: null, moon: null, stars: null, moonM: null, night: null });
    R3.homeScene.traverse((o) => {
      if (o.isHemisphereLight && !SKY.hemi) SKY.hemi = o;
      else if (o.isDirectionalLight && !SKY.moon) SKY.moon = o;
      else if (o.isPoints && !SKY.stars) SKY.stars = o;
      else if (o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry' && o.position.y > 25 && !SKY.moonM) SKY.moonM = o;
    });
    const sc = R3.homeScene;
    SKY.night = { bg: sc.background && sc.background.clone(), fog: sc.fog && sc.fog.color.clone(), hemiI: SKY.hemi && SKY.hemi.intensity, hemiC: SKY.hemi && SKY.hemi.color.clone(), moonI: SKY.moon && SKY.moon.intensity, moonC: SKY.moon && SKY.moon.color.clone(), moonP: SKY.moon && SKY.moon.position.clone() };
    return SKY;
  }
  function applySky(day) {
    const K = findSky();
    if (!K || K.day === day) return;
    K.day = day;
    const sc = K.scene, N = K.night;
    if (day) {
      sc.background = new THREE.Color('#9cc9ef'); if (sc.fog) sc.fog.color.set('#bcd8f0');
      if (K.hemi) { K.hemi.intensity = 1.05; K.hemi.color.set('#dcebff'); }
      if (K.moon) { K.moon.intensity = 1.5; K.moon.color.set('#fff0d8'); K.moon.position.set(12, 26, 8); }
    } else {
      if (N.bg) sc.background = N.bg.clone(); if (sc.fog && N.fog) sc.fog.color.copy(N.fog);
      if (K.hemi) { K.hemi.intensity = N.hemiI; K.hemi.color.copy(N.hemiC); }
      if (K.moon) { K.moon.intensity = N.moonI; K.moon.color.copy(N.moonC); K.moon.position.copy(N.moonP); }
    }
    if (K.stars) K.stars.visible = !day;
    if (K.moonM) K.moonM.visible = !day;
  }
  setInterval(() => {
    try {
      if (!R3 || !R3.homeScene) return;
      const day = world.loc === 'home' && ((S.away && S.away.day === S.day) || S.morningOf === S.day);
      applySky(!!day);
    } catch (_) { /* scene not ready */ }
  }, 500);
})();
