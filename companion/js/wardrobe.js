// Wardrobe module: outfits. Stub: colourways of her oversized tee (tints the
// Tops material). Real outfit meshes can replace this later through the same
// state.outfit / 'outfit' event / runtime.outfitDesc contract.

const OUTFITS = [
  { id: 'default', name: 'Oversized white tee', tee: '#ffffff', desc: 'an oversized white tee, black shorts and sneakers' },
  { id: 'midnight', name: 'Midnight tee', tee: '#4a5a8c', desc: 'an oversized midnight-blue tee, black shorts and sneakers' },
  { id: 'sakura', name: 'Sakura tee', tee: '#ffc4cf', desc: 'an oversized soft pink tee, black shorts and sneakers', minLevel: 1 },
  { id: 'sage', name: 'Sage tee', tee: '#b7d1b0', desc: 'an oversized sage-green tee, black shorts and sneakers', minLevel: 2 },
  { id: 'lilac', name: 'Lilac tee', tee: '#d8c6ff', desc: 'an oversized lilac tee, black shorts and sneakers', minLevel: 2 },
  { id: 'butter', name: 'Butter tee', tee: '#ffe3a1', desc: 'an oversized butter-yellow tee, black shorts and sneakers', minLevel: 3 },
];

export default {
  id: 'wardrobe',
  init(app) {
    const { ui, progress, brain, bus } = app;
    let base = null; // original material colours

    function apply(id) {
      const o = OUTFITS.find((x) => x.id === id) || OUTFITS[0];
      app.runtime.outfitDesc = o.desc;
      if (!app.avatar.ready) return o;
      const mats = app.avatar.findMaterials('Tops');
      if (!base) base = mats.map((m) => ({ m, c: m.color?.clone(), s: m.shadeColorFactor?.clone() }));
      for (const { m, c, s } of base) {
        if (c) m.color.copy(c).multiply(new app.THREE.Color(o.tee));
        if (s) m.shadeColorFactor.copy(s).multiply(new app.THREE.Color(o.tee));
      }
      return o;
    }

    function wear(id) {
      const o = OUTFITS.find((x) => x.id === id);
      if (!o) return;
      if (progress.level() < (o.minLevel || 0)) { ui.toast(`Unlocks at ${progress.levelName(o.minLevel)}.`, { icon: 'lock' }); return; }
      const prev = app.state.outfit;
      app.state.outfit = o.id;
      apply(o.id);
      app.avatar.playGesture('tilt');
      app.avatar.setEmotion('happy', { hold: 5 });
      app.save.dirty();
      if (prev !== o.id) bus.emit('outfit', { id: o.id, prev });
    }

    bus.on('ready', () => apply(app.state.outfit));
    bus.on('save:loaded', () => apply(app.state.outfit));
    apply(app.state.outfit);

    ui.registerDockButton({ id: 'wardrobe', label: 'Wardrobe', icon: 'hanger', order: 10, onClick: () => ui.openSheet('wardrobe', 'Wardrobe', (body) => {
      body.append(Object.assign(document.createElement('p'), { className: 'sheet-lead', textContent: 'Pick what she wears today.' }));
      const grid = document.createElement('div');
      grid.className = 'outfit-grid';
      for (const o of OUTFITS) {
        const locked = progress.level() < (o.minLevel || 0);
        const on = app.state.outfit === o.id;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'outfit' + (on ? ' on' : '') + (locked ? ' locked' : '');
        b.disabled = locked;
        b.setAttribute('aria-pressed', String(on));
        b.innerHTML = `<span class="outfit-swatch" style="--tee:${o.tee}">${locked ? ui.icon('lock', 18) : on ? ui.icon('check', 18) : ''}</span><strong></strong><small></small>`;
        b.querySelector('strong').textContent = o.name;
        b.querySelector('small').textContent = locked ? `Unlocks at ${progress.levelName(o.minLevel)}` : on ? 'Wearing' : 'Tap to wear';
        b.addEventListener('click', () => { wear(o.id); ui.closeSheet(); });
        grid.append(b);
      }
      body.append(grid);
    }) });

    brain.registerSuggestion('wear', {
      hint: `wear:<outfit> to suggest an outfit (${OUTFITS.map((o) => o.id).join(', ')})`,
      label: (id) => { const o = OUTFITS.find((x) => x.id === id); return o && app.state.outfit !== id ? `Try the ${o.name.toLowerCase()}` : null; },
      run: (id) => wear(id),
    });
  },
};
