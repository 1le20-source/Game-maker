// Touch reactions. Allowed: head pat, cheek poke, hand hold, shoulder tap.
// Anything else: she steps back and asks for personal space.
// Reactions are local (no Claude call) so taps stay instant.

import * as THREE from 'three';
import { pickFresh } from './util.js';

const LINES = {
  head: {
    sweet: ['Ehehe. That feels nice.', 'Mm, head pats are the best.', "You're going to make me sleepy."],
    playful: ['Oh? Am I a good girl? Heh, keep going.', "Careful, I'll start purring like Mochi.", 'Pat accepted. Do it again.'],
    tsundere: ["H-hey! Don't mess up my hair! ...Okay, one more.", "I'm not a cat, you know. ...Don't stop.", 'Hmph. Fine. That is... nice.'],
    chill: ['Mm. Nice.', "That's relaxing. Thanks.", 'Okay, that is very calming.'],
    goth: ['A gentle touch beneath the moon. How rare.', 'You may continue. I permit it.', 'My dark heart melts a little.'],
  },
  cheek: {
    sweet: ['Hehe, that tickles!', 'Boop! Hey!', 'My cheek is not a button, silly.'],
    playful: ['Boop back! Ha, missed.', 'Did you just poke me? Rude. Do it again.', 'Hey! I will poke you back, you know.'],
    tsundere: ["D-don't poke me!", 'W-what was that for?!', "Hmph. My cheek isn't a toy."],
    chill: ['Heh. Boop.', 'Hey. Hi.', 'Was that a poke? Cute.'],
    goth: ['You dare poke the moon princess?', 'A poke? How whimsical.', 'Touch my cheek again and I shall... blush. Ugh.'],
  },
  handLow: {
    any: ['Oh! Um, hi. That is a handshake, right?', 'Ah, my hand? Okay, a little high five then.', 'Heh, your hands are warm.'],
    tsundere: ['W-what are you doing with my hand?! ...It is fine, I guess.'],
  },
  handHigh: {
    any: ['Holding hands? Okay. I like this.', 'Your hand fits mine perfectly. Weird, right?', "Let's stay like this for a second."],
    tsundere: ["I-it's only because your hand looked cold!"],
    goth: ['Our hands entwined beneath the moon. Very gothic. Very nice.'],
  },
  shoulder: {
    any: ['Hm? Oh, hi!', 'Yes? I am all ears.', 'You called?'],
    tsundere: ['What? I was listening. Mostly.'],
    goth: ['You summoned me?'],
  },
  personal: {
    any: ['Hey, personal space!', 'Whoa, hands where I can see them, please.', 'Okay, let us keep it friendly. Personal space!', "Hey! That's not okay. Let's keep it friendly."],
    tsundere: ['W-what do you think you are doing?! Personal space!'],
    goth: ['Back, foul creature! Personal space, please.'],
  },
  personalAgain: {
    any: ['I said personal space. Let us keep it friendly, okay? Head pats are fine.', 'Not cool. Try a head pat or a high five instead.'],
  },
};

export function initTouch(app) {
  const { bus } = app;
  let pat = null; // {lastX, lastY, dist, flips, dir, done}
  let lastLine = 0;
  let lastPersonal = -Infinity;
  const headPos = new THREE.Vector3();

  const style = () => app.state.her.style || 'sweet';
  const line = (key) => {
    const pools = LINES[key];
    return pickFresh('touch:' + key + style(), pools[style()] || pools.any || pools.sweet);
  };

  function say(text) {
    const now = performance.now();
    if (now - lastLine < 3500) return;
    lastLine = now;
    const b = app.ui.addMessage('her', '', { pending: false });
    b.set(text);
    app.state.log.push({ t: Date.now(), from: 'her', text });
    app.avatar.speak(text, { voice: true });
  }

  function reward(zone, amount = 1) {
    if (app.progress.cooldown('touch:' + zone, 90 * 1000)) app.progress.addAffection(amount, 'touch:' + zone);
  }

  function react(hit) {
    if (!hit) return;
    app.avatar.noteInteraction();
    app.avatar.lookAt('camera');
    const lvl = app.progress.level();
    bus.emit('touch', { zone: hit.zone, side: hit.side, point: hit.point });
    switch (hit.zone) {
      case 'head':
        app.avatar.playGesture('pat');
        app.avatar.setEmotion(lvl >= 2 ? 'happy' : 'shy', { hold: 6 });
        app.audio.play('pat');
        reward('head');
        say(line('head'));
        break;
      case 'cheek':
        app.avatar.playGesture('poke');
        app.avatar.setEmotion('surprised', { hold: 1.2 });
        setTimeout(() => app.avatar.setEmotion(style() === 'tsundere' ? 'angry' : 'happy', { hold: 5, intensity: 0.7 }), 900);
        reward('cheek');
        say(line('cheek'));
        break;
      case 'hand':
        app.avatar.playGesture('handhold');
        app.avatar.setEmotion('shy', { hold: 6 });
        reward('hand', lvl >= 3 ? 2 : 1);
        say(line(lvl >= 3 ? 'handHigh' : 'handLow'));
        break;
      case 'shoulder':
        app.avatar.playGesture('tapped');
        app.avatar.setEmotion('happy', { hold: 4, intensity: 0.7 });
        reward('shoulder');
        say(line('shoulder'));
        break;
      default: {
        const again = performance.now() - lastPersonal < 60000;
        lastPersonal = performance.now();
        app.avatar.playGesture('stepBack');
        app.avatar.setEmotion('angry', { hold: 5, intensity: again ? 0.8 : 0.5 });
        app.audio.play('oops');
        lastLine = 0;
        say(line(again ? 'personalAgain' : 'personal'));
      }
    }
  }

  bus.on('pointer:down', (e) => {
    if (!app.avatar.ready) return;
    const hit = app.avatar.hitTest(e.x, e.y);
    if (hit && hit.zone === 'head') {
      e.claim();
      pat = { lastX: e.x, lastY: e.y, dist: 0, flips: 0, dir: 0, done: false };
    }
    lookAtFinger(e.x, e.y);
  });
  bus.on('pointer:move', (e) => {
    if (pat) {
      const dx = e.x - pat.lastX;
      pat.dist += Math.abs(dx) + Math.abs(e.y - pat.lastY);
      const d = Math.sign(dx);
      if (d && pat.dir && d !== pat.dir) pat.flips++;
      if (d) pat.dir = d;
      pat.lastX = e.x; pat.lastY = e.y;
      if (!pat.done && (pat.flips >= 2 || pat.dist > 140)) {
        pat.done = true;
        react({ zone: 'head' });
      }
      return;
    }
    lookAtFinger(e.x, e.y);
  });
  bus.on('pointer:up', () => { pat = null; });
  bus.on('tap', (e) => {
    if (!app.avatar.ready) return;
    const hit = app.avatar.hitTest(e.x, e.y);
    if (hit) react(hit);
  });
  bus.on('pointer:hover', (e) => {
    // desktop: she glances at the cursor now and then
    if (Math.random() < 0.04) lookAtFinger(e.x, e.y, 1.2);
  });

  function lookAtFinger(x, y, hold = 1.8) {
    if (!app.avatar.ready) return;
    app.avatar.worldPosition('head', headPos);
    const p = app.stage.screenToWorld(x, y, headPos);
    // pull the point toward the camera so she looks at "you", not through you
    p.lerp(app.stage.camera.position, 0.55);
    app.avatar.lookAt(p, { hold });
  }

  return { react };
}
