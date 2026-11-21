'use strict';
/*
 * PhaseBreaker browser shell. Renders the grid from the pure core, owns input
 * and screens. Every rule (solidity, shards, shifts, lethal tiles) lives in
 * src/core.js so the page and the node tests always agree.
 */
(function () {
  const Core = window.PBCore;
  const LEVELS = window.PHASE_BREAKER_LEVELS;
  const T = Core.T;
  const $ = (id) => document.getElementById(id);

  const TILE_NAME = {
    [T.EMPTY]: 'floor', [T.WALL]: 'wall', [T.PHASE_A]: 'alpha door',
    [T.PHASE_B]: 'beta door', [T.START]: 'start', [T.GOAL]: 'goal',
    [T.SHARD]: 'shard', [T.GATE]: 'gate', [T.HAZARD]: 'hazard', [T.BIT]: 'bit'
  };
  const GLYPH = {
    [T.SHARD]: '\u25C6', [T.GOAL]: '\u2605', [T.HAZARD]: '\u25B2',
    [T.GATE]: '\u2261', [T.BIT]: '+'
  };

  const dom = {
    levelName: $('level-name'),
    levelCode: $('level-code'),
    phaseTag: $('phase-tag'),
    statShifts: $('stat-shifts'),
    statShards: $('stat-shards'),
    statSteps: $('stat-steps'),
    statDeaths: $('stat-deaths'),
    board: $('board'),
    banner: $('banner'),
    bannerText: $('banner-text'),
    btnBannerNext: $('btn-banner-next'),
    btnBannerRetry: $('btn-banner-retry'),
    levelsRow: $('levels-row'),
    live: $('live'),
    btnShift: $('btn-shift'),
    btnWait: $('btn-wait'),
    btnRestart: $('btn-restart'),
    pad: $('pad')
  };

  let levelIndex = 0;
  let level = null;
  let state = null;
  let best = loadBest();

  function loadBest() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('phasebreaker.v1') || '{}');
      const out = {};
      if (parsed && typeof parsed === 'object') {
        for (const k of Object.keys(parsed)) {
          const v = Number(parsed[k]);
          if (Number.isFinite(v) && v >= 0) out[k] = v;
        }
      }
      return out;
    } catch (err) {
      return {};
    }
  }

  function saveBest() {
    try {
      window.localStorage.setItem('phasebreaker.v1', JSON.stringify(best));
    } catch (err) { /* storage optional */ }
  }

  function announce(msg) {
    dom.live.textContent = msg;
  }

  function startLevel(index) {
    levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    const src = LEVELS[levelIndex];
    level = Core.levelFromRows(src.rows, {
      name: src.name,
      shifts: src.shifts,
      seed: 'level-' + src.id
    });
    state = Core.initialState(level);
    dom.levelName.textContent = 'Level ' + src.id + ', ' + src.name;
    dom.levelCode.textContent = Core.encodeSeedCode(level.seed, levelIndex);
    dom.banner.hidden = true;
    render();
    announce('Level ' + src.id + ', ' + src.name + '. ' + src.intro);
    dom.board.focus({ preventScroll: true });
  }

  function phaseName() {
    return state.phase === Core.PHASE.ALPHA ? 'ALPHA' : 'BETA';
  }

  function render() {
    dom.phaseTag.textContent = phaseName();
    dom.phaseTag.className = 'phase-tag phase-' + phaseName().toLowerCase();
    dom.statShifts.textContent = String(state.shifts);
    dom.statShards.textContent = String(state.shardsLeft);
    dom.statSteps.textContent = String(state.steps);
    dom.statDeaths.textContent = String(state.deaths);
    document.body.classList.toggle('phase-beta', state.phase === Core.PHASE.BETA);

    const frag = document.createDocumentFragment();
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const t = Core.tileAt(level, x, y);
        const cell = document.createElement('div');
        cell.className = 'cell t' + t;
        if (state.phase === Core.PHASE.ALPHA && t === T.PHASE_B) cell.classList.add('ghost');
        if (state.phase === Core.PHASE.BETA && t === T.PHASE_A) cell.classList.add('ghost');
        if (t === T.GATE && state.shardsLeft === 0) cell.classList.add('open');
        if (GLYPH[t]) cell.textContent = GLYPH[t];
        if (x === state.x && y === state.y) cell.classList.add('player');
        cell.setAttribute('role', 'img');
        cell.setAttribute('aria-label', TILE_NAME[t]);
        frag.appendChild(cell);
      }
    }
    dom.board.style.setProperty('--w', String(level.width));
    dom.board.replaceChildren(frag);

    if (state.status !== 'playing' && dom.banner.hidden) {
      dom.banner.hidden = false;
      if (state.status === 'won') {
        const b = best[levelIndex];
        if (b == null || state.steps < b) { best[levelIndex] = state.steps; saveBest(); }
        const record = best[levelIndex] === state.steps ? ' A new best.' : '';
        dom.bannerText.textContent = 'The exit takes you. ' + state.steps + ' steps, ' +
          state.deaths + (state.deaths === 1 ? ' death.' : ' deaths.') + record;
        dom.btnBannerNext.hidden = levelIndex >= LEVELS.length - 1;
      } else {
        dom.bannerText.textContent = 'The floor bites back. ' + state.deaths +
          (state.deaths === 1 ? ' death so far.' : ' deaths so far.');
        dom.btnBannerNext.hidden = true;
      }
    }
    renderLevelsRow();
  }

  function renderLevelsRow() {
    const frag = document.createDocumentFragment();
    LEVELS.forEach((src, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'level-pick' + (i === levelIndex ? ' is-here' : '');
      const bScore = best[i];
      b.textContent = String(src.id) + (bScore != null ? ' \u00B7 ' + bScore : '');
      b.setAttribute('aria-label', 'Level ' + src.id + ', ' + src.name +
        (bScore != null ? ', best ' + bScore + ' steps' : ''));
      b.addEventListener('click', () => startLevel(i));
      frag.appendChild(b);
    });
    dom.levelsRow.replaceChildren(frag);
  }

  function act(kind) {
    if (!state || state.status !== 'playing') return;
    const before = { x: state.x, y: state.y, phase: state.phase, shifts: state.shifts, shards: state.shardsLeft };
    state = Core.applyAction(level, state, kind);
    if (state === undefined) return;
    if (state.x === before.x && state.y === before.y && state.phase === before.phase &&
        state.shifts === before.shifts && state.shards === before.shards &&
        state.status === 'playing') {
      const dir = Core.DIRS.find((d) => d.name === kind);
      if (dir) announce('Blocked. The ' + phaseName().toLowerCase() + ' world holds that wall.');
      else if (kind === 'shift') announce('No shift charges left. A bit tile restores one.');
    } else if (kind === 'shift') {
      announce('Shifted to ' + phaseName() + '. Doors redraw themselves.');
    } else if (state.shardsLeft < before.shards) {
      announce('Shard ' + (state.shardsLeft === 0 ? 'secured, the gate is open.' : 'secured.'));
    } else if (state.shifts > before.shifts) {
      announce('Bit picked up. One extra shift charge.');
    } else if (state.status === 'won') {
      announce('Level clear.');
    } else if (state.status === 'dead') {
      announce('A hazard tile. Level failed, retry to carve a new line.');
    }
    render();
  }

  function restart() {
    if (!level) return;
    state = Core.resetLevel(level);
    dom.banner.hidden = true;
    render();
    announce('Level reset.');
    dom.board.focus({ preventScroll: true });
  }

  dom.board.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === 'ArrowUp') { event.preventDefault(); act('up'); }
    else if (key === 'ArrowDown') { event.preventDefault(); act('down'); }
    else if (key === 'ArrowLeft') { event.preventDefault(); act('left'); }
    else if (key === 'ArrowRight') { event.preventDefault(); act('right'); }
    else if (key === ' ' || key === 'x' || key === 'X') { event.preventDefault(); act('shift'); }
    else if (key === 'w' || key === 'W' || key === '.') { event.preventDefault(); act('wait'); }
    else if (key === 'r' || key === 'R') { event.preventDefault(); restart(); }
  });

  dom.pad.addEventListener('click', (event) => {
    const b = event.target.closest('button[data-move]');
    if (!b) return;
    act(b.dataset.move);
    dom.board.focus({ preventScroll: true });
  });
  dom.btnShift.addEventListener('click', () => { act('shift'); dom.board.focus({ preventScroll: true }); });
  dom.btnWait.addEventListener('click', () => { act('wait'); dom.board.focus({ preventScroll: true }); });
  dom.btnRestart.addEventListener('click', restart);
  dom.btnBannerRetry.addEventListener('click', restart);
  dom.btnBannerNext.addEventListener('click', () => startLevel(levelIndex + 1));

  startLevel(0);
})();
