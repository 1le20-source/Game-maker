// Serenity Hands — home life and the business from home:
//  - 🏠 Go home any time (alone or with someone you're seeing) and 🚗 drive
//    back to the spa; the day keeps going and your therapists run the spa
//    while you're away
//  - 💻 Spa dashboard: today's clients and earnings, staff, upgrades,
//    closing early — from the mansion or the spa
//  - 📱 Contacts: only people who gave you their number can be dated
//  - Date nights: 💋 make out, 🌙 spend the night together (fade to black),
//    waking up together and breakfast
// Loaded after the main game script, so it extends the game's globals.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const g = window;

  // ------------------------------------------------------------- contacts
  // Older saves: anyone you were already more than a regular with keeps
  // their number.
  g.hasNumber = (p) => !!p && (p.number || p.status !== 'acquaintance' || (p.dates || 0) > 0);
  const contactsToSee = () => Object.values(S.people || {}).filter((p) => hasNumber(p) && p.status !== 'ex' && !p.upset && (['dating', ...COMMITTED].includes(p.status) || p.aff >= 45));

  // after a session: ask for their number (they can say no)
  const baseResults = g.showResults;
  g.showResults = function (res) {
    const out = baseResults.apply(this, arguments);
    try {
      const c = ses && ses.c, p = c && personOfC(c), box = document.querySelector('#modal .btns');
      if (p && box && !hasNumber(p)) {
        const b = document.createElement('button');
        b.textContent = '📱 Ask for their number';
        b.onclick = () => {
          initAudio();
          const ok = Math.random() < (res.stars >= 4.5 ? 0.85 : res.stars >= 4 ? 0.7 : res.stars >= 3 ? 0.35 : 0.08) + (c.chatty ? 0.1 : 0);
          if (ok) { p.number = true; p.aff = Math.max(p.aff, 20); saveGame(); chime(); b.textContent = `📱 ${c.name} put their number in your phone 💕`; }
          else b.textContent = `${c.name}: “Haha… maybe next time.”`;
          b.disabled = true;
        };
        box.insertBefore(b, box.firstChild);
      }
    } catch (e) { console.warn(e); }
    return out;
  };

  // ---------------------------------------------------- the day while away
  const away = () => (S.away && S.away.day === S.day ? S.away : null);
  const therapists = () => (S.staff || []).filter((s) => s.role === 'therapist');
  const remaining = () => Math.max(0, todayTotal() - S.clientNo);
  const estPrice = () => Math.round(80 * (0.8 + rep() * 0.07) * (S.owned.decor ? 1.15 : 1) * (S.owned.cert ? 1.2 : 1) * (S.owned.gold ? 1.25 : 1) * ((S.staff || []).length >= 3 ? 1.1 : 1));
  function someClient() {
    const C = g.BS && BS.CAST && BS.CAST.length ? BS.CAST : null;
    if (C && Math.random() < 0.8) return pick(C).name;
    return pick(IDS[pick(Object.keys(IDS))].names);
  }
  // one client seen by one of your therapists, as at the spa
  function staffServes(A) {
    const th = therapists(), s = th[(A.i++) % th.length], sk = s.skill;
    const stars = clamp(Math.round((2.3 + sk * 2.7 + rand(-0.5, 0.5) * (1 - sk * 0.8)) * 2) / 2, 1, 5);
    const fee = estPrice(), tip = stars >= 4 ? Math.round(fee * (0.08 + (stars - 4) * 0.12) * tipMult()) : 0, name = someClient();
    S.money += fee + tip; S.clientNo++; S.ratings.push(stars); if (S.ratings.length > 50) S.ratings.shift();
    S.stats.clients++; S.stats.earned += fee + tip;
    S.dayLog.push({ name, stars, total: fee + tip, by: s.c.name });
    gainSkill({ s }, 0.03);
    A.served++; A.earned += fee + tip;
    return { s, name, stars, total: fee + tip };
  }
  function awayTick(dt) {
    const A = away();
    if (!A || A.closed) return;
    if (!therapists().length) return;
    if (remaining() <= 0) {
      A.closed = true; saveGame();
      toast(`🏁 Your team closed the spa for today: ${A.served} client${A.served === 1 ? '' : 's'}, $${A.earned} while you were away.`);
      return;
    }
    A.next -= dt * Math.min(therapists().length, 4);
    if (A.next > 0) return;
    A.next = rand(16, 26);
    const r = staffServes(A);
    saveGame();
    if (!dlg.current) toast(`📱 Spa: ${r.s.c.name} finished with ${r.name} — ${r.stars}★ · +$${r.total}`);
  }
  // the rest of today, all at once (going to bed, or closing early)
  function settleToday(close) {
    const A = away() || { served: 0, earned: 0, i: 0 };
    if (therapists().length && !close) { let n = 0; while (remaining() > 0 && n++ < 30) staffServes(A); }
    else if (remaining() > 0) { S.todayTotal = S.clientNo || -1; }
    A.closed = true;
    saveGame();
    return A;
  }

  // ------------------------------------------------------------- go home
  function goHomeMenu() {
    if (world.loc !== 'spa' || view !== 'world') return;
    if (state !== 'world') { if (ses) toast('Finish the massage first.'); return; }
    if (typeof robber === 'function' && robber()) { toast('🚨 Deal with the robber first!'); return; }
    const th = therapists().length, rem = remaining(), live = liveInPartner();
    const opts = [['🏠 Go home alone', () => leaveSpa(null), 'primary']];
    for (const p of contactsToSee().slice(0, 4)) if (!live || live.id === p.id) opts.push([`💕 Go home with ${esc(p.c.name)}`, () => leaveSpa(p), '']);
    opts.push(['Stay at the spa', () => { hideModal(); state = 'world'; }, '']);
    state = 'modal';
    showModal(`<h2>🏠 Go home now?</h2>
      <p>${rem ? `${rem} more client${rem === 1 ? '' : 's'} due today. ` + (th ? `Your ${th} therapist${th === 1 ? '' : 's'} will look after them while you're away — check in from the 💻 Spa dashboard at home.` : `You have no therapists yet, so the spa closes early and anyone waiting goes home.`) : 'Everyone has been seen today.'}</p>
      <p>You can drive back to the spa whenever you like.</p>`, opts);
  }
  function leaveSpa(p) {
    hideModal();
    const th = therapists().length;
    if (!th) {
      for (const e of ents) {
        if (e.robber || ['leaving', 'gone'].includes(e.state)) continue;
        S.clientNo++; S.dayLog.push({ name: e.c.name, stars: 0, total: e.c.paid || 0, left: true });
      }
      if (remaining() > 0) S.todayTotal = S.clientNo || -1; // the rest of today's bookings are cancelled
    }
    S.away = { day: S.day, served: 0, earned: 0, next: 10, i: 0 };
    saveGame();
    goHome();
    if (p) setTimeout(() => {
      if (world.loc !== 'home' || homeDate()) return;
      world.dateArriveT = 2.5; world.dateArrivePid = p.id; S.homeNight = S.day; S.homeDate = null;
      toast(`💕 ${p.c.name} is coming home with you.`);
    }, 900);
  }
  const baseLeaveHome = g.leaveHome;
  g.leaveHome = function (how) {
    if (homeDate() || world.dateArriveT > 0) return baseLeaveHome.apply(this, arguments);
    const A = away();
    if (A && how === 'bed') { closeOpenDay(() => { hideModal(); baseLeaveHome('bed'); }); return; }
    if (A && how === 'car') {
      S.away = null; S.morningOf = 0; saveGame();
      baseLeaveHome('car');
      setTimeout(() => toast(`🚗 Back at the spa — Day ${S.day} continues.${A.served ? ` Your team saw ${A.served} client${A.served === 1 ? '' : 's'} ($${A.earned}).` : ''}`), 700);
      return;
    }
    S.morningOf = 0;
    return baseLeaveHome.apply(this, arguments);
  };
  // close today's books (staff finish the day or the spa closes), then continue
  function closeOpenDay(then) {
    settleToday(false);
    S.away = null;
    const base = g.showModal;
    g.showModal = function (html) { g.showModal = base; return base(html.replace('🌙 End of Day', '🌙 The spa closed for Day'), [['☀️ Good morning →', then, 'primary']]); };
    try { showDayEnd(); } finally { g.showModal = base; }
  }

  // ------------------------------------------------------ spa dashboard
  function showDashboard(back) {
    back = back || (() => { hideModal(); state = 'world'; });
    state = 'modal';
    const A = away(), th = therapists(), log = S.dayLog || [], earned = log.reduce((a, b) => a + b.total, 0), rem = remaining();
    const btns = [['👥 Staff & hiring', () => showStaff(() => showDashboard(back)), ''], ['🛍️ Spa upgrades', () => showShop(() => showDashboard(back)), '']];
    if (A && rem) btns.push(['🔒 Close the spa for today', () => { settleToday(true); toast('🔒 You closed the spa for today. Remaining bookings were moved.'); showDashboard(back); }, '']);
    btns.push(['Close', back, 'primary']);
    showModal(`<h2>💻 Spa dashboard</h2>
      <div class="rows">
        <div class="row"><span>Day</span><b>${S.day}${A ? ' · you\'re at home' : world.loc === 'home' ? ' · closed for the night' : ''}</b></div>
        <div class="row"><span>Clients today</span><b>${S.clientNo} of ${Math.max(S.clientNo, todayTotal())}${rem && A ? (th.length ? ' · team at work' : ' · closed') : ''}</b></div>
        <div class="row"><span>Earned today</span><b>$${earned}</b></div>
        ${A ? `<div class="row"><span>While you were away</span><b>${A.served} client${A.served === 1 ? '' : 's'} · $${A.earned}</b></div>` : ''}
        <div class="row"><span>Balance</span><b>$${S.money}</b></div>
        <div class="row"><span>Reputation</span><b>⭐ ${rep().toFixed(2)}</b></div>
        <div class="row"><span>Therapists</span><b>${th.length ? th.map((s) => `${esc(s.c.name)} (Lv ${levelOf(s)})`).join(', ') : 'none yet — hire some to keep the spa open without you'}</b></div>
      </div>
      <h3 style="margin:12px 0 4px">Today's clients</h3>
      <div class="rows" style="max-height:28vh;overflow:auto">${log.slice(-10).reverse().map((l) => `<div class="row"><span>${esc(l.name)}${l.by ? ` <span style="color:var(--muted)">(${esc(l.by)})</span>` : ''} ${l.left ? '<span style="color:var(--muted)">left</span>' : starStr(l.stars)}</span><b>$${l.total}</b></div>`).join('') || '<div class="row"><span>No clients yet today.</span></div>'}</div>`, btns);
  }
  g.showSpaDashboard = showDashboard;

  // ------------------------------------------------------- HUD buttons
  function addButtons() {
    const tools = $('worldTools');
    if (!tools || $('bGoHome')) return;
    const go = document.createElement('button');
    go.id = 'bGoHome';
    go.onclick = () => { initAudio(); if (world.loc === 'home') { if (state === 'world') leaveHome('car'); } else goHomeMenu(); };
    const dash = document.createElement('button');
    dash.id = 'bDash'; dash.textContent = '💻 Spa';
    dash.title = 'Spa dashboard: run the business from anywhere';
    dash.onclick = () => { initAudio(); if (state === 'world') showDashboard(); };
    tools.insertBefore(dash, tools.firstChild.nextSibling);
    tools.insertBefore(go, dash);
  }
  function refreshButtons() {
    const go = $('bGoHome');
    if (!go) return;
    const home = world.loc === 'home';
    const label = home ? '🚗 Back to the spa' : '🏠 Go home';
    if (go.textContent !== label) go.textContent = label;
    go.classList.toggle('primary', !home && remaining() === 0);
  }
  addButtons();
  setInterval(refreshButtons, 400);

  // --------------------------------------------------- mansion additions
  const baseHI = g.homeInteractables;
  g.homeInteractables = function () {
    const list = baseHI.apply(this, arguments);
    const A = away();
    for (const it of list) {
      if (/Drive to the spa/.test(it.label)) it.label = A ? `🚗 Drive back to the spa (Day ${S.day} continues)` : S.morningOf === S.day ? `🚗 Drive to the spa (open Day ${S.day})` : it.label;
      if (/Sleep until morning/.test(it.label) && A) it.label = `🛏️ Go to bed (close the spa for Day ${S.day})`;
    }
    if (!world.scene && !(homeDate() && homeDate().state === 'follow')) list.push({ x: 1840, y: 770, spot: { x: 1800, y: 880 }, label: '💻 Spa dashboard (run the spa from home)', act: () => showDashboard() });
    return list;
  };
  const baseUpdateHome = g.updateHome;
  g.updateHome = function (dt) { baseUpdateHome.apply(this, arguments); awayTick(dt); };
  let lastUI = 0;
  const baseHomeUI = g.refreshHomeUI;
  g.refreshHomeUI = function () {
    baseHomeUI.apply(this, arguments);
    const now = performance.now();
    if (now - lastUI < 250) return;
    lastUI = now;
    const A = away(), e = homeDate();
    if (A) {
      $('dayStat').textContent = `☀️ Day ${S.day} · at home`;
      if (!e && !(world.dateArriveT > 0)) $('objective').innerHTML = `You're home in the middle of Day ${S.day}. ${therapists().length ? `Your team is running the spa (${S.clientNo} of ${Math.max(S.clientNo, todayTotal())} clients so far).` : 'The spa is closed for the rest of today.'} Check it on the <b>💻 Spa</b> dashboard, 📱 invite someone over, or <b>🚗 drive back</b> any time.`;
    } else if (S.morningOf === S.day) {
      $('dayStat').textContent = `☀️ Morning of Day ${S.day}`;
      if (!e) $('objective').innerHTML = `Good morning! Have a look around, then <b>🚗 drive to the spa</b> to open Day ${S.day}.`;
    }
  };

  // ------------------------------------------------------- date nights
  const romanticP = (p) => p && ['dating', ...COMMITTED].includes(p.status);
  const baseDateMenu = g.dateMenu;
  g.dateMenu = function (e) {
    const p = S.people[e.pid], info = world.dateInfo;
    if (!p || !info) return baseDateMenu.apply(this, arguments);
    info.free = info.free || {};
    const extra = [];
    if (!info.free.makeout && (romanticP(p) || p.aff >= 70)) extra.push(['💋 Kiss on the lips', () => makeOut(e, p)]);
    if (!info.stay && !e.live && (romanticP(p) || p.aff >= 70) && info.done.length >= 1) extra.push(['🌙 Ask them to stay the night', () => askStay(e, p)]);
    if (!info.stay && e.live) extra.push(['🌙 Head to bed together', () => stayNight(e, p)]);
    if (!extra.length) return baseDateMenu.apply(this, arguments);
    const d = g.dlg;
    const wrap = function (name, text, choices) {
      g.dlg = d;
      if (choices && choices.length) { const last = choices.pop(); choices.push(...extra, last); }
      return d(name, text, choices);
    };
    Object.assign(wrap, d);
    g.dlg = wrap;
    try { return baseDateMenu.apply(this, arguments); } finally { g.dlg = d; }
  };
  function faceEachOther(e, gap) {
    const a = Math.atan2(e.y - player.y, e.x - player.x);
    const x = player.x + Math.cos(a) * gap, y = player.y + Math.sin(a) * gap;
    if (isFree(x, y, 12)) { e.x = x; e.y = y; }
    e.ang = a + Math.PI; fp.yaw = a;
  }
  function blush(color, ms) {
    const f = $('fade'); f.style.background = color; f.classList.add('on');
    setTimeout(() => { f.classList.remove('on'); setTimeout(() => (f.style.background = ''), 450); }, ms);
  }
  function makeOut(e, p) {
    const info = world.dateInfo;
    if (p.upset || p.aff < 55) {
      e.expr = 'neutral'; setEmote(e, 'dots', 2);
      dlg(e.c.name, pick(['Mm… slow down a little? Let\'s just enjoy tonight. 😊', 'Not yet… but ask me again sometime. 💕', 'I like you, I do. I just want to take it slow.']), null);
      return;
    }
    info.free.makeout = 1; info.gained += 5;
    if (g.rememberMoment && !(p.memories || []).some((x) => /first kiss/.test(x.what))) g.rememberMoment(p, '💋 Your first kiss');
    e.state = 'date'; e.pose = 'kiss'; e.expr = 'bliss'; e.path = null;
    faceEachOther(e, 40); fp.pitch = pitchToFace(e) - 0.04;
    setEmote(e, 'heart', 4); chime();
    blush('#ff9fc2', 1300);
    setTimeout(() => dlg(e.c.name, pick(['…Wow. 💕', '*smiles against your lips* I\'ve wanted to do that all night.', '…Okay. You\'re a really good kisser, you know that?', 'Mm… stay right here a second longer.']),
      [['💕', () => { e.state = 'follow'; e.pose = null; e.expr = 'happy'; }]]), 1900);
  }
  function askStay(e, p) {
    const info = world.dateInfo, yes = !p.upset && (isCommitted(p) || (p.status === 'dating' && p.aff >= 65) || p.aff >= 85) && info.gained >= 3;
    if (!yes) {
      e.expr = 'neutral';
      dlg(e.c.name, pick(['Not tonight… I want to take things slow. But tonight was lovely. 💕', 'Ask me again another night? I had a really nice time.', 'I\'d better not… early start tomorrow. Rain check? 😊']), [['Of course. 💕', null]]);
      info.stay = 'no';
      return;
    }
    e.expr = 'bliss'; setEmote(e, 'heart', 3);
    dlg(e.c.name, pick(['…I\'d love to stay. 💕', 'Yeah. I don\'t want tonight to end either.', 'I was hoping you\'d ask.']), [['🌙 Head upstairs together', () => stayNight(e, p)]]);
  }
  function stayNight(e, p) {
    const info = world.dateInfo;
    info.stay = true;
    world.scene = { key: 'night' }; state = 'modal'; keys.clear();
    const f = $('fade'); f.style.background = '#05060a'; f.classList.add('on');
    const gained = clamp(info.gained + 6, -20, 30);
    p.dates++; p.aff = clamp(p.aff + gained, 0, 100); p.nights = (p.nights || 0) + 1;
    if (p.status === 'friend' || p.status === 'acquaintance') p.status = 'dating';
    S.homeNight = S.day; if (g.rememberMoment) g.rememberMoment(p, '🌙 Spent the night together'); saveGame();
    setTimeout(() => {
      const morning = () => wakeUpTogether(e, p, gained);
      showModal(`<h2>🌙 Goodnight</h2><p>You head upstairs together with ${esc(p.c.name)}, and the night is yours.</p>`, [['☀️ Morning →', () => {
        if (away()) closeOpenDay(morning); else morning();
      }, 'primary']]);
    }, 900);
  }
  function wakeUpTogether(e, p, gained) {
    hideModal();
    S.morningOf = S.day; saveGame();
    const B = HOME.SPOT.bed;
    Object.assign(player, { x: B.x, y: B.y, pose: '', path: null });
    Object.assign(e, { state: 'date', x: B.x + 70, y: B.y + 10, pose: 'stand', expr: 'bliss', path: null });
    if (!isFree(e.x, e.y, 12)) { const s = openSpotNear(B.x, B.y, 70, 0); if (s) { e.x = s.x; e.y = s.y; } }
    faceEachOther(e, Math.max(85, dist(player.x, player.y, e.x, e.y))); fp.pitch = pitchToFace(e);
    state = 'world';
    const f = $('fade'); setTimeout(() => { f.classList.remove('on'); setTimeout(() => (f.style.background = ''), 600); }, 200);
    toast(`💞 ${p.c.name}: affection ${gained >= 0 ? '+' : ''}${gained} → ${p.aff}/100 · ${STATUS_LABEL[p.status]}`);
    const after = (bonus, line) => () => {
      p.aff = clamp(p.aff + bonus, 0, 100); saveGame();
      dlg(e.c.name, line, [[e.live ? 'Have a good day. 💕' : 'Text me later? 💕', () => {
        world.scene = null; world.dateInfo = null;
        if (e.live) { e.state = 'gone'; return; }
        e.state = 'homeLeave'; e.pose = null; e.path = null; setEmote(e, 'heart', 4);
        e.tasks = [{ x: HOME.SPOT.porch.x, y: HOME.SPOT.porch.y }, { x: HOME.SPOT.gate.x, y: HOME.SPOT.gate.y - 5 }];
      }]]);
    };
    setTimeout(() => dlg(e.c.name, pick(['Good morning… ☀️ Did you sleep okay?', '*yawns* Morning, you. 💕', 'Hey, sleepyhead. Morning.']), [
      ['🥞 Make pancakes together', after(4, 'Pancakes and you? Best morning ever. 🥞')],
      ['☕ Bring them coffee in bed', after(3, 'You remembered how I take it. Okay, you\'re a keeper. ☕')],
      ['😴 Five more minutes…', after(2, '*snuggles back in* …Fine. Five. Then breakfast. 😴')],
    ]), 900);
  }
  g.homeStayNight = stayNight;

  // ------------------------------------------------------------ help text
  try {
    const helpAdd = '<li><b>Your life, your schedule:</b> press <b>🏠 Go home</b> any time (alone or with someone you\'re seeing) and <b>🚗 Back to the spa</b> to return — your therapists keep the spa running while you\'re away, and the <b>💻 Spa</b> dashboard lets you manage it from anywhere. Ask clients for their <b>📱 number</b> after a great massage; only your contacts can be dated. On date nights you can kiss and invite them to stay the night.</li>';
    const baseHelp = g.showHelp;
    if (typeof baseHelp === 'function') g.showHelp = function () { const r = baseHelp.apply(this, arguments); const ul = document.querySelector('#modal ul'); if (ul) ul.insertAdjacentHTML('beforeend', helpAdd); return r; };
  } catch (e) { /* no help screen */ }
})();
