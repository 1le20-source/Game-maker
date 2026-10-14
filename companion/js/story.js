// Story module: daily rhythm and little events. Stub: daily visit bonus,
// streak moments, level-up reactions, and a "today" topic fed to both minds.

import { todayKey } from './util.js';

// [for the prompt, how she tells it]
const TOPICS = [
  ['The café started a seasonal maple latte today and she drew a leaf on every cup.', 'We started a maple latte at the café today. I drew a little leaf on every single cup.'],
  ['Mochi knocked a pencil cup off the desk at 3am and looked proud of it.', 'Mochi knocked my pencil cup off the desk at 3am. She looked so proud of herself.'],
  ['She finally finished a sketch of the city skyline from her window.', 'I finally finished my sketch of the skyline from my window!'],
  ['A regular at the café, an old man, brought her a jar of homemade plum jam.', 'One of my regulars at the café brought me homemade plum jam. Old people are the sweetest.'],
  ['She found a scratched copy of an old platformer at a flea market for one coin.', 'I found an old platformer cartridge at a flea market for one coin. It still works!'],
  ['Clear skies tonight; she wants to find Vega with her telescope.', 'The sky is clear tonight, so I want to find Vega with my telescope later.'],
  ['She tried a new curry recipe and it came out a little too spicy.', 'I tried a new curry recipe and, um, it was a little too spicy. My tongue is still recovering.'],
  ['Her illustration teacher praised her colours in class today.', 'My illustration teacher said she liked my colours today. I am still smiling about it.'],
  ['It rained on her walk home and she had to share an umbrella with a stranger.', 'It rained on my way home and a stranger shared their umbrella with me. Little kindnesses!'],
  ['She rewatched a black-and-white musical and cried at the ending again.', 'I rewatched an old black-and-white musical and cried at the ending. Again.'],
];

export default {
  id: 'story',
  init(app) {
    const { bus, progress, ui, brain } = app;
    const data = () => app.save.data('story', { bonusDay: '' });
    const today = () => TOPICS[Math.abs(hash(todayKey())) % TOPICS.length];

    brain.addPromptSection('story', () => `Something from your day you could bring up if it fits: ${today()[0]}`);
    brain.registerIntent({
      id: 'whatsNew', priority: 34,
      test: (c) => /\b(what'?s new|anything new|how was (your|ur) day|what did you do today|tell me about your day)\b/.test(c.lower),
      reply: () => ({ emo: 'happy', act: 'tilt', aff: 1, text: today()[1] + ' How was yours?' }),
    });

    bus.on('ready', () => {
      const d = data();
      if (d.bonusDay === todayKey()) return;
      d.bonusDay = todayKey();
      const streak = app.state.stats.streak || 1;
      const bonus = 10 + Math.min(20, streak * 2);
      progress.addCoins(bonus, 'daily');
      setTimeout(() => ui.toast(`Daily visit: +${bonus} coins${streak > 1 ? ` (streak ${streak})` : ''}`, { icon: 'coin', ms: 3200 }), 1800);
      if ([3, 7, 14, 30, 100].includes(streak)) progress.addMoment('streak', `${streak} days in a row with ${app.state.her.name}.`);
      app.save.dirty();
    });

    bus.on('affection', (d) => {
      if (!d.leveledUp) return;
      setTimeout(() => app.avatar.playGesture(d.level >= 5 ? 'shy' : 'bounce'), 600);
    });
  },
};

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
