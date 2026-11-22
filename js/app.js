'use strict';
/*
 * PhaseBreaker browser shell. Renders the grid from the pure core, owns input
 * and screens. Every rule (solidity, shards, shifts, lethal tiles) lives in
 * src/core.js so the page and the node tests always agree.
 *
 * Version 2 adds the run lab: a deterministic recorder with share links and
 * ghost playback, live telemetry, a verified export, a scenario bench, a
 * level designer and an in-page self-test battery. All of it runs on the
 * same zero-dependency pure modules the test suite covers.
 */
(function () {
  const Core = window.PBCore;
  const Replay = window.PBReplay;
  const Tel = window.PBTelemetry;
  const Designer = window.PBDesigner;
  const Audit = window.PBAudit;
  const SelfTest = window.PBSelfTest;
  const LEVELS = window.PHASE_BREAKER_LEVELS;
  const T = Core.T;
  const $ = (id) => document.getElementById(id);

  const TILE_NAME = {
    [T.EMPTY]: 'floor', [T.WALL]: 'wall', [T.PHASE_A]: 'alpha door',
    [T.PHASE_B]: 'beta door', [T.START]: 'start', [T.GOAL]: 'goal',
    [T.SHARD]: 'shard', [T.GATE]: 'gate', [T.HAZARD]: 'hazard', [T.BIT]: 'bit'
  };
  const GLYPH = {
    [T.SHARD]: '◆', [T.GOAL]: '★', [T.HAZARD]: '▲',
    [T.GATE]: '≡', [T.BIT]: '+'
  };
  const PALETTE = ['#', '.', 'A', 'B', 'S', 'G', '*', 'T', '!', '+'];
  const PAL_GLYPH = {
    '#': '■', '.': '·', 'A': 'A', 'B': 'B', 'S': 'S',
    'G': '★', '*': '◆', 'T': '≡', '!': '▲', '+': '+'
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
    pad: $('pad'),
    modeTag: $('mode-tag'),
    teleAlpha: $('tele-alpha'),
    teleBeta: $('tele-beta'),
    teleTurns: $('tele-turns'),
    teleMoves: $('tele-moves'),
    teleBumps: $('tele-bumps'),
    teleVisited: $('tele-visited'),
    teleCombo: $('tele-combo'),
    btnCopyReplay: $('btn-copy-replay'),
    btnWatch: $('btn-watch'),
    btnVerify: $('btn-verify'),
    verifyBadge: $('verify-badge'),
    replayStatus: $('replay-status'),
    ghostControls: $('ghost-controls'),
    ghostPlay: $('ghost-play'),
    ghostBack: $('ghost-back'),
    ghostFwd: $('ghost-fwd'),
    ghostSpeed: $('ghost-speed'),
    ghostExit: $('ghost-exit'),
    ghostScrub: $('ghost-scrub'),
    ghostFrame: $('ghost-frame'),
    btnExportJson: $('btn-export-json'),
    btnExportCsv: $('btn-export-csv'),
    btnCopyFp: $('btn-copy-fp'),
    fpHex: $('fp-hex'),
    benchSeed: $('bench-seed'),
    benchW: $('bench-w'),
    benchH: $('bench-h'),
    benchShifts: $('bench-shifts'),
    benchWalls: $('bench-walls'),
    benchHazards: $('bench-hazards'),
    benchShards: $('bench-shards'),
    benchBits: $('bench-bits'),
    benchDoors: $('bench-doors'),
    benchPreset: $('bench-preset'),
    btnBenchGen: $('btn-bench-gen'),
    btnBenchPlay: $('btn-bench-play'),
    btnBenchShare: $('btn-bench-share'),
    benchPreview: $('bench-preview'),
    benchStatus: $('bench-status'),
    palette: $('palette'),
    designBoard: $('design-board'),
    designW: $('design-w'),
    designH: $('design-h'),
    designShifts: $('design-shifts'),
    btnDesignResize: $('btn-design-resize'),
    designRows: $('design-rows'),
    btnDesignValidate: $('btn-design-validate'),
    btnDesignPlay: $('btn-design-play'),
    btnDesignShare: $('btn-design-share'),
    btnDesignLoad: $('btn-design-load'),
    designStatus: $('design-status'),
    btnSelfTest: $('btn-selftest'),
    selftestSummary: $('selftest-summary'),
    selftestList: $('selftest-list')
  };

  let levelIndex = 0;
  let level = null;
  let state = null;
  let custom = null;            // {rows, shifts, name} when on a custom board
  let best = loadBest();
  const recorder = Replay.makeRecorder();
  const tracker = Tel.makeTracker();
  let lastAudit = null;
  let ghost = null;             // {frames, i, playing, timer, speed, consumed[], shared}
  let paint = '#';
  let design = { rows: [], valid: false };
  let bench = { rows: null, shifts: 0 };

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

  /* ------------------------------------------------------------------ */
  /* Level lifecycle                                                     */
  /* ------------------------------------------------------------------ */

  function buildShipped(index) {
    const src = LEVELS[index];
    return Core.levelFromRows(src.rows, {
      name: src.name, shifts: src.shifts, seed: 'level-' + src.id
    });
  }

  function buildCustom(rows, shifts, name) {
    return Core.levelFromRows(rows, {
      name: name || 'Custom',
      shifts: shifts,
      seed: 'custom-' + Core.hashHex(rows.join('|'))
    });
  }

  function freshBoard() {
    // A pristine level object for replay simulation and verification; the
    // live board keeps its own consumed tiles untouched.
    if (custom) { return buildCustom(custom.rows, custom.shifts, custom.name); }
    return buildShipped(levelIndex);
  }

  function beginRun(lvl, label) {
    stopGhost();
    level = lvl;
    state = Core.initialState(level);
    recorder.reset();
    tracker.reset();
    tracker.start(state);
    lastAudit = null;
    dom.banner.hidden = true;
    dom.modeTag.hidden = true;
    dom.board.classList.remove('replaying');
    dom.levelName.textContent = label;
    dom.levelCode.textContent = custom
      ? 'custom board'
      : Core.encodeSeedCode(level.seed, levelIndex);
    setReplayStatus();
    setFp('(no run yet)');
    render();
    dom.board.focus({ preventScroll: true });
  }

  function startLevel(index) {
    levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    custom = null;
    const src = LEVELS[levelIndex];
    beginRun(buildShipped(levelIndex), 'Level ' + src.id + ', ' + src.name);
    announce('Level ' + src.id + ', ' + src.name + '. ' + src.intro);
  }

  function startCustom(rows, shifts, name) {
    custom = { rows: rows.slice(0), shifts: shifts, name: name || 'Custom' };
    beginRun(buildCustom(custom.rows, custom.shifts, custom.name),
      (custom.name || 'Custom') + ' (custom)');
    announce('Custom board loaded. ' + custom.rows[0].length + ' by ' + custom.rows.length + '.');
  }

  function phaseName() {
    return state.phase === Core.PHASE.ALPHA ? 'ALPHA' : 'BETA';
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function renderStats(s) {
    dom.phaseTag.textContent = s.phase === Core.PHASE.ALPHA ? 'ALPHA' : 'BETA';
    dom.phaseTag.className = 'phase-tag phase-' + dom.phaseTag.textContent.toLowerCase();
    dom.statShifts.textContent = String(s.shifts);
    dom.statShards.textContent = String(s.shardsLeft);
    dom.statSteps.textContent = String(s.steps);
    dom.statDeaths.textContent = String(s.deaths);
    document.body.classList.toggle('phase-beta', s.phase === Core.PHASE.BETA);
  }

  function renderTelemetry() {
    const sum = tracker.summary();
    dom.teleTurns.textContent = String(sum.turns);
    dom.teleMoves.textContent = String(sum.moves);
    dom.teleBumps.textContent = String(sum.bumps);
    dom.teleVisited.textContent = String(sum.visitedCount);
    dom.teleCombo.textContent = String(sum.maxCombo);
    const a = Math.round(sum.alphaShare * 100);
    dom.teleAlpha.style.width = a + '%';
    dom.teleBeta.style.width = (100 - a) + '%';
  }

  // consumed[i] = set of tile codes picked up before frame i, rebuilt when a
  // ghost session starts so the replay board shows shards and bits vanishing
  // in step with the recording.
  function ghostConsumed(frames, lvl) {
    const out = [];
    const gone = new Set();
    out.push(new Set(gone));
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const idx = f.y * lvl.width + f.x;
      const t = lvl.baseGrid ? lvl.baseGrid[idx] : lvl.grid[idx];
      if (t === T.SHARD || t === T.BIT) { gone.add(idx); }
      out.push(new Set(gone));
    }
    return out;
  }

  function renderBoardCells(view) {
    // view: {phase, px, py, ghost, trail, gone} for replay mode, or null for live
    const frag = document.createDocumentFragment();
    const g = view ? (level.baseGrid || level.grid) : level.grid;
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const idx = y * level.width + x;
        let t = g[idx];
        if (view && view.gone && view.gone.has(idx) &&
            (t === T.SHARD || t === T.BIT)) { t = T.EMPTY; }
        const cell = document.createElement('div');
        const phase = view ? view.phase : state.phase;
        cell.className = 'cell t' + t;
        if (phase === Core.PHASE.ALPHA && t === T.PHASE_B) cell.classList.add('ghost');
        if (phase === Core.PHASE.BETA && t === T.PHASE_A) cell.classList.add('ghost');
        if (t === T.GATE && (view ? view.shardsLeft : state.shardsLeft) === 0) cell.classList.add('open');
        if (GLYPH[t]) cell.textContent = GLYPH[t];
        if (view && view.trail && view.trail.has(idx)) cell.classList.add('trail');
        if (x === (view ? view.px : state.x) && y === (view ? view.py : state.y)) {
          cell.classList.add(view ? 'ghostp' : 'player');
        }
        cell.setAttribute('role', 'img');
        cell.setAttribute('aria-label', TILE_NAME[t]);
        frag.appendChild(cell);
      }
    }
    dom.board.style.setProperty('--w', String(level.width));
    dom.board.replaceChildren(frag);
  }

  function render() {
    renderStats(state);
    renderBoardCells(null);
    renderTelemetry();

    if (state.status !== 'playing' && dom.banner.hidden) {
      dom.banner.hidden = false;
      if (state.status === 'won') {
        if (!custom) {
          const b = best[levelIndex];
          if (b == null || state.steps < b) { best[levelIndex] = state.steps; saveBest(); }
        }
        const record = (!custom && best[levelIndex] === state.steps) ? ' A new best.' : '';
        dom.bannerText.textContent = 'The exit takes you. ' + state.steps + ' steps, ' +
          state.deaths + (state.deaths === 1 ? ' death.' : ' deaths.') + record;
        dom.btnBannerNext.hidden = custom || levelIndex >= LEVELS.length - 1;
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
      b.className = 'level-pick' + (i === levelIndex && !custom ? ' is-here' : '');
      const bScore = best[i];
      b.textContent = String(src.id) + (bScore != null ? ' · ' + bScore : '');
      b.setAttribute('aria-label', 'Level ' + src.id + ', ' + src.name +
        (bScore != null ? ', best ' + bScore + ' steps' : ''));
      b.addEventListener('click', () => startLevel(i));
      frag.appendChild(b);
    });
    dom.levelsRow.replaceChildren(frag);
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  function act(kind) {
    if (!state || state.status !== 'playing' || ghost) return;
    const before = state;
    const next = Core.applyAction(level, state, kind);
    if (next === state) { return; }   // free no-op
    state = next;
    recorder.note(kind);
    tracker.note(kind, before, state);
    if (state.x === before.x && state.y === before.y && state.phase === before.phase &&
        state.shifts === before.shifts && state.shardsLeft === before.shards &&
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
    setReplayStatus();
    refreshFingerprint();
    render();
  }

  function restart() {
    if (!level) return;
    beginRun(custom ? buildCustom(custom.rows, custom.shifts, custom.name)
      : buildShipped(levelIndex),
      dom.levelName.textContent);
    announce('Level reset.');
  }

  /* ------------------------------------------------------------------ */
  /* Replay tools                                                        */
  /* ------------------------------------------------------------------ */

  function setReplayStatus(extra) {
    if (extra) { dom.replayStatus.textContent = extra; return; }
    const n = recorder.size();
    dom.replayStatus.textContent = n === 0
      ? 'Recording. Actions land here as you play.'
      : 'Recording. ' + n + (n === 1 ? ' action' : ' actions') + ' captured.';
  }

  function runActions() {
    return recorder.actions();
  }

  function shareHashForRun() {
    const actions = runActions();
    if (custom) {
      const blob = Designer.serializeDesign(custom.rows, { shifts: custom.shifts });
      if (!blob) { return null; }
      const code = Replay.encodeRun({ levelIndex: 0, actions: actions });
      return code ? '#d=' + blob + '~' + code : null;
    }
    return Replay.buildRunHash(levelIndex, actions);
  }

  function copyText(text, okMsg) {
    const done = () => announce(okMsg);
    const nav = window.navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      Promise.resolve(nav.clipboard.writeText(text)).then(done, () => fallbackCopy(text, okMsg));
    } else {
      fallbackCopy(text, okMsg);
    }
  }

  function fallbackCopy(text, okMsg) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      if (typeof ta.select === 'function') { ta.select(); }
      if (document.execCommand) { document.execCommand('copy'); }
      document.body.removeChild(ta);
      announce(okMsg);
    } catch (err) {
      announce('Copy failed. The link is ' + text);
    }
  }

  function copyReplayLink() {
    const h = shareHashForRun();
    if (!h) { announce('Nothing to share yet.'); return; }
    const base = String(window.location.href).split('#')[0];
    copyText(base + h, 'Replay link copied.');
    setReplayStatus('Replay link copied. ' + runActions().length + ' actions inside.');
  }

  function verifyRun() {
    const actions = runActions();
    if (actions.length === 0) {
      showBadge(false, 'Nothing to verify yet');
      return;
    }
    const res = Replay.verify(freshBoard(), actions, {
      digest: Replay.stateDigest(state)
    });
    if (res.ok && res.digest === Replay.stateDigest(state)) {
      showBadge(true, 'Verified identical · ' + res.digest);
      announce('Replay verified. The recording reproduces this run exactly.');
    } else {
      showBadge(false, 'Diverged' + (res.divergence >= 0 ? ' at frame ' + res.divergence : ''));
      announce('Replay diverged. This should be impossible; please file a bug.');
    }
  }

  function showBadge(ok, text) {
    dom.verifyBadge.hidden = false;
    dom.verifyBadge.className = 'badge ' + (ok ? 'ok' : 'bad');
    dom.verifyBadge.textContent = text;
  }

  /* ------------------------------------------------------------------ */
  /* Ghost playback                                                      */
  /* ------------------------------------------------------------------ */

  function startGhost(frames, note) {
    if (!frames || frames.length === 0) { announce('Nothing recorded to replay yet.'); return; }
    ghost = {
      frames: frames,
      i: 0,
      playing: false,
      timer: null,
      speed: 1,
      consumed: ghostConsumed(frames, level),
      trailAll: [startIndexCell()]
    };
    for (const f of frames) { ghost.trailAll.push(f.y * level.width + f.x); }

    dom.modeTag.hidden = false;
    dom.ghostControls.hidden = false;
    dom.banner.hidden = true;
    dom.board.classList.add('replaying');
    dom.ghostScrub.max = String(frames.length - 1);
    dom.ghostPlay.textContent = 'Play';
    if (note) { setReplayStatus(note); }
    ghostTo(0);
    ghostSetPlaying(true);
    announce('Ghost playback. Watch the recorded run frame for frame.');
  }

  function startIndexCell() {
    // The run starts at the level's START tile (or spawn fallback); use the
    // pristine board so it is right even mid-run.
    const g = level.baseGrid || level.grid;
    for (let i = 0; i < g.length; i++) {
      if (g[i] === T.START) { return i; }
    }
    return 0;
  }

  function stopGhost() {
    if (!ghost) { return; }
    if (ghost.timer) { clearTimeout(ghost.timer); }
    ghost = null;
    dom.modeTag.hidden = true;
    dom.ghostControls.hidden = true;
    dom.board.classList.remove('replaying');
  }

  function ghostTo(i) {
    if (!ghost) { return; }
    ghost.i = Math.max(0, Math.min(ghost.frames.length - 1, i));
    const f = ghost.frames[ghost.i];
    const trail = new Set();
    for (let k = 0; k <= ghost.i && k < ghost.trailAll.length; k++) {
      trail.add(ghost.trailAll[k]);
    }
    renderStats(f);
    renderBoardCells({
      phase: f.phase, px: f.x, py: f.y,
      shardsLeft: f.shardsLeft,
      gone: ghost.consumed[ghost.i],
      trail: trail,
      ghost: true
    });
    dom.ghostScrub.value = String(ghost.i);
    dom.ghostFrame.textContent = 'Frame ' + (ghost.i + 1) + ' of ' + ghost.frames.length +
      ' · ' + (f.action || 'start') + ' · ' + f.status;
    if (ghost.i >= ghost.frames.length - 1) { ghostSetPlaying(false); }
  }

  function ghostSetPlaying(on) {
    if (!ghost) { return; }
    ghost.playing = on;
    dom.ghostPlay.textContent = on ? 'Pause' : 'Play';
    if (ghost.timer) { clearTimeout(ghost.timer); ghost.timer = null; }
    if (on) {
      const tick = () => {
        if (!ghost || !ghost.playing) { return; }
        if (ghost.i >= ghost.frames.length - 1) { ghostSetPlaying(false); return; }
        ghostTo(ghost.i + 1);
        ghost.timer = setTimeout(tick, Math.round(320 / ghost.speed));
      };
      ghost.timer = setTimeout(tick, Math.round(320 / ghost.speed));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  function setFp(text) { dom.fpHex.textContent = text; }

  function refreshFingerprint() {
    lastAudit = buildCurrentAudit();
    setFp(lastAudit.fingerprint);
  }

  function buildCurrentAudit() {
    return Audit.buildAudit({
      level: level,
      levelIndex: custom ? -1 : levelIndex,
      levelName: custom ? custom.name : LEVELS[levelIndex].name,
      actions: runActions(),
      final: state,
      telemetry: tracker.summary(),
      now: new Date().toISOString()
    });
  }

  function download(name, mime, text) {
    const a = document.createElement('a');
    a.setAttribute('href', 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text));
    a.setAttribute('download', name);
    if (a.style) { a.style.display = 'none'; }
    document.body.appendChild(a);
    if (typeof a.click === 'function') { a.click(); }
    document.body.removeChild(a);
  }

  function exportJson() {
    refreshFingerprint();
    download('phase-breaker-audit.json', 'application/json',
      Audit.auditJSON(lastAudit));
    announce('Audit JSON downloaded. The fingerprint inside verifies the file.');
  }

  function exportCsv() {
    const rows = tracker.rows();
    if (!rows.length) { announce('No turns recorded yet.'); return; }
    download('phase-breaker-telemetry.csv', 'text/csv', Tel.toCSV(rows));
    announce('Telemetry CSV downloaded. ' + rows.length + ' turns.');
  }

  /* ------------------------------------------------------------------ */
  /* Scenario bench                                                      */
  /* ------------------------------------------------------------------ */

  function benchParams() {
    return {
      seed: dom.benchSeed.value,
      width: Number(dom.benchW.value),
      height: Number(dom.benchH.value),
      shifts: Number(dom.benchShifts.value),
      walls: Number(dom.benchWalls.value) / 100,
      hazards: Number(dom.benchHazards.value) / 100,
      shards: Number(dom.benchShards.value),
      bits: Number(dom.benchBits.value),
      doors: Number(dom.benchDoors.value)
    };
  }

  function renderMini(rows) {
    const frag = document.createDocumentFragment();
    const w = rows[0].length;
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < w; x++) {
        const t = Designer.CHAR_TO_TILE[rows[y][x]];
        const c = document.createElement('div');
        c.className = 'mcell t' + t;
        if (GLYPH[t]) { c.textContent = GLYPH[t]; }
        frag.appendChild(c);
      }
    }
    dom.benchPreview.style.setProperty('grid-template-columns',
      'repeat(' + w + ', 16px)');
    dom.benchPreview.replaceChildren(frag);
  }

  function benchGenerate() {
    const p = benchParams();
    const t0 = Date.now();
    const g = Designer.generate(p);
    bench.rows = g.rows;
    bench.shifts = g.params.shifts;
    renderMini(g.rows);
    dom.btnBenchPlay.disabled = false;
    dom.btnBenchShare.disabled = false;
    const ms = Date.now() - t0;
    dom.benchStatus.textContent =
      (g.fallback ? 'Fallback corridor' : 'Solvable board') +
      ' · ' + g.attempts + (g.attempts === 1 ? ' attempt' : ' attempts') +
      ' · ' + g.solutionStates + ' states verified · ' + ms + ' ms';
    announce('Generated a solvable ' + g.params.width + ' by ' + g.params.height + ' board.');
  }

  function benchShare() {
    if (!bench.rows) { return; }
    const blob = Designer.serializeDesign(bench.rows, { shifts: bench.shifts });
    if (!blob) { announce('This board cannot be shared.'); return; }
    const base = String(window.location.href).split('#')[0];
    copyText(base + '#d=' + blob, 'Board link copied.');
    dom.benchStatus.textContent += ' · link copied';
  }

  /* ------------------------------------------------------------------ */
  /* Level designer                                                      */
  /* ------------------------------------------------------------------ */

  const STARTER_ROWS = [
    '###########',
    '#S..*..A.G#',
    '#..###....#',
    '#.+..B..*.#',
    '###########'
  ];

  function designFromTextarea() {
    const raw = dom.designRows.value.replace(/\r/g, '').split('\n');
    const rows = raw.filter((r) => r.length > 0);
    return rows;
  }

  function renderDesignBoard() {
    const rows = design.rows;
    const frag = document.createDocumentFragment();
    const w = rows.length ? rows[0].length : 0;
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        const t = Designer.CHAR_TO_TILE[ch];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dcell t' + (t === undefined ? 0 : t);
        b.textContent = PAL_GLYPH[ch] || '';
        b.setAttribute('aria-label', 'Cell ' + (x + 1) + ',' + (y + 1) + ' ' + ch);
        ((cx, cy) => {
          b.addEventListener('click', () => paintAt(cx, cy));
        })(x, y);
        frag.appendChild(b);
      }
    }
    dom.designBoard.style.setProperty('grid-template-columns',
      'repeat(' + w + ', 26px)');
    dom.designBoard.replaceChildren(frag);
  }

  function paintAt(x, y) {
    design.rows = Designer.paintCell(design.rows, x, y, paint);
    design.valid = false;
    dom.designRows.value = design.rows.join('\n');
    dom.btnDesignPlay.disabled = true;
    dom.btnDesignShare.disabled = true;
    renderDesignBoard();
    dom.designStatus.textContent = 'Edited. Validate to check the board is winnable.';
  }

  function syncDesignFromText() {
    const rows = designFromTextarea();
    design.rows = rows.length ? rows : [''];
    design.valid = false;
    dom.btnDesignPlay.disabled = true;
    dom.btnDesignShare.disabled = true;
    renderDesignBoard();
  }

  function designResize() {
    const w = Math.max(3, Math.min(Designer.MAX_W, Number(dom.designW.value) || 11));
    const h = Math.max(3, Math.min(Designer.MAX_H, Number(dom.designH.value) || 7));
    design.rows = Designer.resizeRows(design.rows, w, h, '.');
    design.valid = false;
    dom.designRows.value = design.rows.join('\n');
    renderDesignBoard();
    dom.designStatus.textContent = 'Resized to ' + w + ' by ' + h + '.';
  }

  function designValidate() {
    syncDesignFromText();
    const shifts = Math.max(0, Number(dom.designShifts.value) || 0);
    const v = Designer.validateRows(design.rows, { shifts: shifts });
    const parts = [];
    for (const e of v.errors) { parts.push('Fix: ' + e); }
    for (const w of v.warnings) { parts.push('Note: ' + w); }
    if (v.solvable === true) {
      parts.unshift('Solvable in ' + v.solution.length +
        (v.solution.length === 1 ? ' move' : ' moves') + '.');
      design.valid = true;
      dom.btnDesignPlay.disabled = false;
      dom.btnDesignShare.disabled = false;
    } else if (v.solvable === null) {
      parts.unshift('Too large to verify.');
    }
    design.shifts = shifts;
    dom.designStatus.textContent = parts.join(' ');
    announce(v.solvable === true ? 'Board verified solvable.' : 'Board has problems.');
    return v;
  }

  function designShare() {
    const shifts = Math.max(0, Number(dom.designShifts.value) || 0);
    const blob = Designer.serializeDesign(design.rows, { shifts: shifts });
    if (!blob) { announce('This board cannot be shared.'); return; }
    const base = String(window.location.href).split('#')[0];
    copyText(base + '#d=' + blob, 'Board link copied.');
  }

  function buildPalette() {
    const frag = document.createDocumentFragment();
    for (const ch of PALETTE) {
      const t = Designer.CHAR_TO_TILE[ch];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pal t' + t + (ch === paint ? ' is-pick' : '');
      b.textContent = PAL_GLYPH[ch];
      b.setAttribute('aria-label', 'Paint ' + (TILE_NAME[t] || ch));
      b.setAttribute('title', TILE_NAME[t] || ch);
      ((c) => b.addEventListener('click', () => {
        paint = c;
        buildPalette();
      }))(ch);
      frag.appendChild(b);
    }
    dom.palette.replaceChildren(frag);
  }

  function loadDesign(rows, shifts, note) {
    design.rows = rows.slice(0);
    design.valid = false;
    dom.designRows.value = rows.join('\n');
    dom.designW.value = String(rows[0].length);
    dom.designH.value = String(rows.length);
    dom.designShifts.value = String(shifts);
    dom.btnDesignPlay.disabled = true;
    dom.btnDesignShare.disabled = true;
    renderDesignBoard();
    dom.designStatus.textContent = note || 'Loaded. Validate to check the board is winnable.';
  }

  /* ------------------------------------------------------------------ */
  /* Self tests                                                          */
  /* ------------------------------------------------------------------ */

  function runSelfTests() {
    const r = SelfTest.runAll({ levels: LEVELS });
    const frag = document.createDocumentFragment();
    for (const res of r.results) {
      const li = document.createElement('li');
      li.className = res.pass ? 'pass' : 'fail';
      const name = document.createElement('span');
      name.textContent = res.name;
      const det = document.createElement('span');
      det.className = 'st-detail';
      det.textContent = res.detail;
      li.appendChild(name);
      li.appendChild(det);
      frag.appendChild(li);
    }
    dom.selftestList.replaceChildren(frag);
    dom.selftestSummary.textContent = r.failed === 0
      ? r.passed + ' checks passed.'
      : r.passed + ' passed, ' + r.failed + ' FAILED.';
    announce('Self tests done. ' + r.passed + ' of ' + r.results.length + ' passed.');
  }

  /* ------------------------------------------------------------------ */
  /* Share links                                                         */
  /* ------------------------------------------------------------------ */

  function openHash() {
    const h = window.location && window.location.hash;
    const parsed = Replay.parseHash(h);
    if (!parsed) { return false; }
    if (parsed.type === 'run') {
      if (parsed.levelIndex < 0 || parsed.levelIndex >= LEVELS.length) {
        announce('That replay link points at a level that does not exist.');
        return false;
      }
      startLevel(parsed.levelIndex);
      const lvl = freshBoard();
      const sim = Replay.simulate(lvl, parsed.actions);
      level = lvl; // ghost board shows the sim level; restore it to pristine
      state = Core.resetLevel(level);
      startGhost(sim.frames, 'Shared replay. ' + parsed.actions.length + ' actions, verified by checksum.');
      return true;
    }
    if (parsed.type === 'design') {
      const halves = parsed.payload.split('~');
      const d = Designer.parseDesign(halves[0]);
      if (!d) {
        announce('That board link did not verify.');
        return false;
      }
      loadDesign(d.rows, d.shifts, 'Shared board loaded. Validate or play it.');
      if (halves[1]) {
        const run = Replay.decodeRun(halves[1]);
        if (run) {
          custom = { rows: d.rows, shifts: d.shifts, name: 'Shared' };
          beginRun(buildCustom(d.rows, d.shifts, 'Shared'), 'Shared board');
          const lvl = freshBoard();
          const sim = Replay.simulate(lvl, run.actions);
          level = lvl;
          state = Core.resetLevel(level);
          startGhost(sim.frames, 'Shared run on a shared board. ' + run.actions.length + ' actions.');
        }
      }
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

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
    else if (key === 'Escape' && ghost) { event.preventDefault(); stopGhost(); render(); }
  });

  // Touch parity: a deliberate swipe on the board walks one step.
  let touchStart = null;
  dom.board.addEventListener('touchstart', (event) => {
    const t = event.touches && event.touches[0];
    if (t) { touchStart = { x: t.clientX, y: t.clientY }; }
  });
  dom.board.addEventListener('touchend', (event) => {
    if (!touchStart) { return; }
    const t = event.changedTouches && event.changedTouches[0];
    touchStart = null;
    if (!t) { return; }
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) { return; }
    if (Math.abs(dx) > Math.abs(dy)) { act(dx > 0 ? 'right' : 'left'); }
    else { act(dy > 0 ? 'down' : 'up'); }
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

  dom.btnCopyReplay.addEventListener('click', copyReplayLink);
  dom.btnVerify.addEventListener('click', verifyRun);
  dom.btnWatch.addEventListener('click', () => {
    const sim = Replay.simulate(freshBoard(), runActions());
    startGhost(sim.frames, 'Replaying the recorded run. ' + sim.frames.length + ' frames.');
  });
  dom.ghostPlay.addEventListener('click', () => ghostSetPlaying(!ghost.playing));
  dom.ghostBack.addEventListener('click', () => { ghostSetPlaying(false); ghostTo(ghost.i - 1); });
  dom.ghostFwd.addEventListener('click', () => { ghostSetPlaying(false); ghostTo(ghost.i + 1); });
  dom.ghostExit.addEventListener('click', () => { stopGhost(); render(); announce('Back to the live board.'); });
  dom.ghostSpeed.addEventListener('change', () => {
    if (!ghost) { return; }
    const v = Number(dom.ghostSpeed.value);
    ghost.speed = isFinite(v) && v > 0 ? v : 1;
    if (ghost.playing) { ghostSetPlaying(true); }
  });
  dom.ghostScrub.addEventListener('input', () => {
    ghostSetPlaying(false);
    ghostTo(Number(dom.ghostScrub.value));
  });

  dom.btnExportJson.addEventListener('click', exportJson);
  dom.btnExportCsv.addEventListener('click', exportCsv);
  dom.btnCopyFp.addEventListener('click', () => {
    refreshFingerprint();
    copyText(lastAudit.fingerprint, 'Fingerprint copied.');
  });

  dom.btnBenchGen.addEventListener('click', benchGenerate);
  dom.btnBenchPlay.addEventListener('click', () => {
    if (bench.rows) { startCustom(bench.rows, bench.shifts, 'Bench board'); }
  });
  dom.btnBenchShare.addEventListener('click', benchShare);
  dom.benchPreset.addEventListener('change', () => {
    const i = Number(dom.benchPreset.value);
    const p = Designer.PRESETS[i];
    if (!p) { return; }
    dom.benchSeed.value = p.params.seed;
    dom.benchW.value = String(p.params.width);
    dom.benchH.value = String(p.params.height);
    dom.benchShifts.value = String(p.params.shifts);
    dom.benchWalls.value = String(Math.round(p.params.walls * 100));
    dom.benchHazards.value = String(Math.round(p.params.hazards * 100));
    dom.benchShards.value = String(p.params.shards);
    dom.benchBits.value = String(p.params.bits);
    dom.benchDoors.value = String(p.params.doors);
    benchGenerate();
  });

  dom.btnDesignValidate.addEventListener('click', designValidate);
  dom.btnDesignPlay.addEventListener('click', () => {
    const shifts = Math.max(0, Number(dom.designShifts.value) || 0);
    startCustom(design.rows, shifts, 'Designed board');
  });
  dom.btnDesignShare.addEventListener('click', designShare);
  dom.btnDesignLoad.addEventListener('click', () => {
    syncDesignFromText();
    dom.designStatus.textContent = 'Loaded from text. Validate to check.';
  });
  dom.btnDesignResize.addEventListener('click', designResize);
  dom.designRows.addEventListener('input', () => {
    design.rows = designFromTextarea();
    design.valid = false;
    dom.btnDesignPlay.disabled = true;
    dom.btnDesignShare.disabled = true;
  });

  dom.btnSelfTest.addEventListener('click', runSelfTests);

  if (window.addEventListener) {
    window.addEventListener('hashchange', () => openHash());
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  (function boot() {
    // Preset dropdown
    const frag = document.createDocumentFragment();
    Designer.PRESETS.forEach((p, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = p.name;
      frag.appendChild(o);
    });
    dom.benchPreset.appendChild(frag);

    buildPalette();
    loadDesign(STARTER_ROWS, 3, 'Paint a board, then validate it.');
    if (!openHash()) { startLevel(0); }
  })();
})();
