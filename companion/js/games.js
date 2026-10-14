// Games module: mini-games with her. Stub with rock-paper-scissors, best of three.
// Claude is called once per finished match (a player action), never per round.

const HANDS = [
  { id: 'rock', label: 'Rock', beats: 'scissors' },
  { id: 'paper', label: 'Paper', beats: 'rock' },
  { id: 'scissors', label: 'Scissors', beats: 'paper' },
];

export default {
  id: 'games',
  init(app) {
    const { ui, brain, progress, avatar } = app;
    const data = () => app.save.data('games', { rps: { played: 0, won: 0 } });

    function openRps() {
      const score = { you: 0, her: 0, round: 0 };
      ui.openSheet('play', 'Rock, paper, scissors', (body, sheet) => {
        const status = document.createElement('p');
        status.className = 'sheet-lead rps-status';
        status.textContent = `Best of three. ${app.state.her.name} is cracking her knuckles.`;
        const board = document.createElement('div');
        board.className = 'rps-score';
        const row = document.createElement('div');
        row.className = 'rps-row';
        const drawScore = () => { board.innerHTML = `<span>You <b>${score.you}</b></span><span>${app.state.her.name} <b>${score.her}</b></span>`; };
        drawScore();
        for (const h of HANDS) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'rps-btn';
          b.innerHTML = `${glyph(h.id)}<span>${h.label}</span>`;
          b.addEventListener('click', () => play(h));
          row.append(b);
        }
        body.append(board, row, status);

        async function play(h) {
          if (score.you >= 2 || score.her >= 2) return;
          app.audio.play('tap');
          const herHand = HANDS[Math.floor(Math.random() * 3)];
          score.round++;
          let msg;
          if (herHand.id === h.id) { msg = `You both threw ${h.label.toLowerCase()}. Again!`; avatar.playGesture('think'); }
          else if (h.beats === herHand.id) { score.you++; msg = `${h.label} beats ${herHand.label.toLowerCase()}. Your point!`; avatar.setEmotion('surprised', { hold: 2 }); avatar.playGesture('shake'); }
          else { score.her++; msg = `${herHand.label} beats ${h.label.toLowerCase()}. Her point!`; avatar.setEmotion('excited', { hold: 3 }); avatar.playGesture('bounce'); }
          status.textContent = msg;
          drawScore();
          if (score.you >= 2 || score.her >= 2) {
            const won = score.you > score.her;
            const d = data();
            d.rps.played++;
            if (won) d.rps.won++;
            progress.addCoins(won ? 6 : 3, 'game');
            progress.addAffection(1, 'game');
            app.save.dirty();
            status.textContent = won ? 'You win the match! +6 coins' : `${app.state.her.name} wins the match. +3 coins`;
            setTimeout(() => sheet.close(), 900);
            await brain.event(`You just played rock-paper-scissors with ${app.state.player.name || 'your friend'}, best of three. ${won ? 'They won' : 'You won'} ${Math.max(score.you, score.her)}-${Math.min(score.you, score.her)}. React in character. Use aff 0.`, {
              offline: () => (won
                ? { emo: 'angry', act: 'shake', text: 'No fair! Rematch later. I am going to practise on Mochi.' }
                : { emo: 'excited', act: 'bounce', text: 'Victory! You make the tea. Two sugars, please.' }),
            });
          }
        }
      });
    }

    ui.registerDockButton({ id: 'play', label: 'Play', icon: 'pad', order: 30, onClick: openRps });
    brain.registerSuggestion('play', {
      hint: 'play:rps to suggest rock-paper-scissors',
      label: (id) => (id === 'rps' || !id ? 'Play rock-paper-scissors' : null),
      run: () => openRps(),
    });
  },
};

function glyph(id) {
  const p = {
    rock: '<path d="M7 10.5c0-1.4 1-2.5 2.3-2.5.7 0 1.2.3 1.6.7.3-.8 1.1-1.3 2-1.3.8 0 1.5.4 1.8 1.1.4-.3.9-.5 1.4-.5 1.3 0 2.3 1 2.3 2.4v4.1c0 3-2.4 5.5-5.5 5.5h-1.4C9.3 20 7 17.7 7 14.9z"/>',
    paper: '<path d="M8 20.5V7.2a1.4 1.4 0 0 1 2.8 0V12V4.9a1.4 1.4 0 0 1 2.8 0V12V5.6a1.4 1.4 0 0 1 2.8 0V12.5V8.2a1.4 1.4 0 0 1 2.8 0v7.3c0 2.8-2.2 5-5 5z"/><path d="M8 13.5 6.3 11.8a1.4 1.4 0 0 0-2 2L8 17.5"/>',
    scissors: '<circle cx="6.5" cy="17.5" r="2.6"/><circle cx="17.5" cy="17.5" r="2.6"/><path d="M8.3 15.6 15 4.5M15.7 15.6 9 4.5"/>',
  }[id];
  return `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
