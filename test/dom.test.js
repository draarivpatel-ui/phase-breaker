'use strict';
/*
 * DOM/app integration through the mini-DOM harness: real index.html parsed,
 * real app.js executed in a VM context. Exercises rendering, input, telemetry,
 * replay, exports, designer and self-test UI paths.
 */
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, key, cells, playerPos } = require('./helpers/minidom.js');

function fresh(opts) {
  const r = loadApp(opts);
  assert.deepEqual(r.errors, [], 'no page errors on boot');
  return r;
}

function fire(el, type) {
  el.dispatchEvent({ type: type, target: el, preventDefault() { this.defaultPrevented = true; } });
}

/* ------------------------- boot ------------------------- */

test('app boots with zero errors', () => {
  fresh();
});

test('board renders a cell per tile', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  assert.equal(board.children.length, 13 * 3);
  assert.equal(board.style.getPropertyValue('--w'), '13');
});

test('level name and stats render on boot', () => {
  const { document } = fresh();
  assert.match(document.getElementById('level-name').textContent, /Two Doors/);
  assert.equal(document.getElementById('stat-steps').textContent, '0');
  assert.equal(document.getElementById('stat-deaths').textContent, '0');
});

test('phase tag shows ALPHA on boot', () => {
  const { document } = fresh();
  assert.equal(document.getElementById('phase-tag').textContent, 'ALPHA');
});

test('player cell is painted', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  assert.equal(board.querySelectorAll('.cell.player').length, 1);
});

test('levels row renders one button per shipped level', () => {
  const { document } = fresh();
  const btns = document.getElementById('levels-row').querySelectorAll('button.level-pick');
  assert.equal(btns.length, 3);
  assert.ok(btns[0].className.includes('is-here'));
});

/* ------------------------- input ------------------------- */

test('arrow keys move and update stats', () => {
  const { document } = fresh();
  key(document.getElementById('board'), 'ArrowRight');
  assert.equal(document.getElementById('stat-steps').textContent, '1');
  assert.deepEqual(playerPos(document), { x: 2, y: 1, i: 15 });
});

test('space key shifts the phase and drops a charge', () => {
  const { document } = fresh();
  key(document.getElementById('board'), ' ');
  assert.equal(document.getElementById('phase-tag').textContent, 'BETA');
  assert.equal(document.getElementById('stat-shifts').textContent, '2');
});

test('x key also shifts', () => {
  const { document } = fresh();
  key(document.getElementById('board'), 'x');
  assert.equal(document.getElementById('phase-tag').textContent, 'BETA');
});

test('w key spends a wait turn', () => {
  const { document } = fresh();
  key(document.getElementById('board'), 'w');
  assert.equal(document.getElementById('stat-steps').textContent, '1');
  assert.deepEqual(playerPos(document), { x: 1, y: 1, i: 14 });
});

test('wall bump keeps position and costs a turn', () => {
  const { document } = fresh();
  key(document.getElementById('board'), 'ArrowUp');
  assert.deepEqual(playerPos(document), { x: 1, y: 1, i: 14 });
  assert.equal(document.getElementById('stat-steps').textContent, '1');
});

test('r key restarts the run', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  key(board, 'ArrowRight');
  key(board, 'r');
  assert.equal(document.getElementById('stat-steps').textContent, '0');
});

test('touch pad buttons drive movement', () => {
  const { document } = fresh();
  document.querySelector('#pad button[data-move="right"]').click();
  assert.deepEqual(playerPos(document), { x: 2, y: 1, i: 15 });
});

test('wait button spends a turn', () => {
  const { document } = fresh();
  document.getElementById('btn-wait').click();
  assert.equal(document.getElementById('stat-steps').textContent, '1');
});

test('shift button shifts phase', () => {
  const { document } = fresh();
  document.getElementById('btn-shift').click();
  assert.equal(document.getElementById('phase-tag').textContent, 'BETA');
});

test('restart button restores the board', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  key(board, 'ArrowRight');
  document.getElementById('btn-restart').click();
  assert.equal(document.getElementById('stat-steps').textContent, '0');
});

/* ------------------------- telemetry strip ------------------------- */

test('telemetry strip updates on moves', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  key(board, 'ArrowRight');
  key(board, 'ArrowRight');
  assert.equal(document.getElementById('tele-moves').textContent, '2');
  assert.equal(document.getElementById('tele-turns').textContent, '2');
});

test('combo counter tracks consecutive moves', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  key(board, 'ArrowRight');
  key(board, 'ArrowRight');
  key(board, 'ArrowRight');
  assert.equal(document.getElementById('tele-combo').textContent, '3');
});

test('bump counter increments on walls', () => {
  const { document } = fresh();
  key(document.getElementById('board'), 'ArrowUp');
  assert.equal(document.getElementById('tele-bumps').textContent, '1');
});

test('visited count tracks unique tiles', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  key(board, 'ArrowRight');
  key(board, 'ArrowRight');
  assert.equal(document.getElementById('tele-visited').textContent, '3');
});

test('phase split bar updates', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  key(board, ' ');
  key(board, 'ArrowRight');
  const beta = document.getElementById('tele-beta');
  assert.notEqual(beta.style.getPropertyValue('width'), '0%');
});

/* ------------------------- announcements and banner ------------------------- */

test('live region announces events', () => {
  const { document } = fresh();
  key(document.getElementById('board'), 'ArrowRight');
  assert.ok(document.getElementById('live').textContent.length > 0);
});

test('reaching the goal shows the end banner', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  for (let i = 0; i < 4; i++) { key(board, 'ArrowRight'); }
  key(board, ' ');
  for (let i = 0; i < 4; i++) { key(board, 'ArrowRight'); }
  key(board, ' ');
  for (let i = 0; i < 4; i++) { key(board, 'ArrowRight'); }
  assert.equal(document.getElementById('banner').hidden, false);
  assert.match(document.getElementById('banner-text').textContent, /exit takes you/);
});

/* ------------------------- replay ------------------------- */

test('watch button opens ghost controls and mode tag', () => {
  const { document } = fresh();
  key(document.getElementById('board'), 'ArrowRight');
  document.getElementById('btn-watch').click();
  assert.equal(document.getElementById('ghost-controls').hidden, false);
  assert.equal(document.getElementById('mode-tag').hidden, false);
});

test('ghost frame label shows progress', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  key(board, 'ArrowRight');
  key(board, 'ArrowRight');
  document.getElementById('btn-watch').click();
  assert.match(document.getElementById('ghost-frame').textContent, /Frame 1 of 2/);
});

test('ghost scrub jumps to a frame', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  key(board, 'ArrowRight');
  key(board, 'ArrowRight');
  document.getElementById('btn-watch').click();
  const scrub = document.getElementById('ghost-scrub');
  scrub.value = '1';
  fire(scrub, 'input');
  assert.match(document.getElementById('ghost-frame').textContent, /Frame 2 of 2/);
});

test('ghost exit restores play mode', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  key(board, 'ArrowRight');
  document.getElementById('btn-watch').click();
  document.getElementById('ghost-exit').click();
  assert.equal(document.getElementById('mode-tag').hidden, true);
  assert.equal(board.querySelectorAll('.cell.ghostp').length, 0);
});

test('Escape exits ghost mode too', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  key(board, 'ArrowRight');
  document.getElementById('btn-watch').click();
  key(document.getElementById('board'), 'Escape');
  assert.equal(document.getElementById('mode-tag').hidden, true);
});

test('copy replay link puts a URL in the clipboard', () => {
  const { document, window } = fresh();
  key(document.getElementById('board'), 'ArrowRight');
  document.getElementById('btn-copy-replay').click();
  assert.match(window.navigator.clipboard._text, /#r=r1\./);
});

test('shared run link boots straight into ghost mode', () => {
  const Replay = require('../src/replay.js');
  const hash = Replay.buildRunHash(0, ['right', 'right', 'right']);
  const r = fresh({ hash });
  assert.match(r.document.getElementById('ghost-frame').textContent, /Frame 1 of 3/);
  assert.equal(r.document.getElementById('mode-tag').hidden, false);
});

test('replay status line reports the shared run', () => {
  const Replay = require('../src/replay.js');
  const hash = Replay.buildRunHash(0, ['right', 'right']);
  const r = fresh({ hash });
  assert.match(r.document.getElementById('replay-status').textContent, /Shared replay/);
});

test('verify button confirms an honest replay', () => {
  const { document } = fresh();
  key(document.getElementById('board'), 'ArrowRight');
  document.getElementById('btn-verify').click();
  assert.match(document.getElementById('verify-badge').textContent, /Verified identical/);
});

test('copy fingerprint puts the hash in the clipboard', () => {
  const { document, window } = fresh();
  key(document.getElementById('board'), 'ArrowRight');
  document.getElementById('btn-copy-fp').click();
  assert.match(window.navigator.clipboard._text, /^[0-9a-f]{64}|Verified|/);
});

/* ------------------------- exports ------------------------- */

test('JSON export downloads an audit file', () => {
  const { document } = fresh();
  key(document.getElementById('board'), 'ArrowRight');
  document.getElementById('btn-export-json').click();
  const names = document.downloads.map(d => d.name);
  assert.ok(names.includes('phase-breaker-audit.json'));
});

function downloadText(dl) {
  return decodeURIComponent(dl.href.split(',')[1]);
}

test('exported audit verifies its fingerprint', () => {
  const { document } = fresh();
  key(document.getElementById('board'), 'ArrowRight');
  document.getElementById('btn-export-json').click();
  const Audit = require('../src/audit.js');
  const dl = document.downloads.find(d => d.name === 'phase-breaker-audit.json');
  assert.equal(Audit.verifyAudit(JSON.parse(downloadText(dl))), true);
});

test('CSV export downloads a telemetry file', () => {
  const { document } = fresh();
  key(document.getElementById('board'), 'ArrowRight');
  document.getElementById('btn-export-csv').click();
  const dl = document.downloads.find(d => d.name.endsWith('.csv'));
  assert.ok(dl);
  assert.match(downloadText(dl), /^tick,action,x,y/);
});

/* ------------------------- scenario bench ------------------------- */

test('bench generate produces a solvable board', () => {
  const { document } = fresh();
  document.getElementById('btn-bench-gen').click();
  assert.match(document.getElementById('bench-status').textContent, /Solvable board/);
});

function previewSig(document) {
  return Array.prototype.map.call(
    document.getElementById('bench-preview').children,
    c => c.className).join('|');
}

test('bench seed input changes the generated board', () => {
  const { document } = fresh();
  document.getElementById('bench-seed').value = 'seed-a';
  document.getElementById('btn-bench-gen').click();
  const sigA = previewSig(document);
  document.getElementById('bench-seed').value = 'seed-b';
  document.getElementById('btn-bench-gen').click();
  assert.notEqual(previewSig(document), sigA);
});

test('same bench seed regenerates the same board', () => {
  const { document } = fresh();
  document.getElementById('bench-seed').value = 'stable';
  document.getElementById('btn-bench-gen').click();
  const a = previewSig(document);
  document.getElementById('btn-bench-gen').click();
  assert.equal(previewSig(document), a);
});

test('bench generate enables play and share', () => {
  const { document } = fresh();
  document.getElementById('btn-bench-gen').click();
  assert.equal(document.getElementById('btn-bench-play').disabled, false);
  assert.equal(document.getElementById('btn-bench-share').disabled, false);
});

test('bench preset select fills params and generates', () => {
  const { document } = fresh();
  const sel = document.getElementById('bench-preset');
  sel.value = '0';
  fire(sel, 'change');
  assert.equal(document.getElementById('bench-seed').value, 'spark');
  assert.match(document.getElementById('bench-status').textContent, /Solvable|Fallback/);
});

test('play this board button launches the custom level', () => {
  const { document } = fresh();
  document.getElementById('btn-bench-gen').click();
  document.getElementById('btn-bench-play').click();
  assert.match(document.getElementById('level-name').textContent, /Bench board|Custom/);
});

/* ------------------------- designer ------------------------- */

test('designer validates the starter board', () => {
  const { document } = fresh();
  document.getElementById('btn-design-validate').click();
  assert.match(document.getElementById('design-status').textContent, /Solvable/);
});

test('designer reports errors for a broken board', () => {
  const { document } = fresh();
  document.getElementById('design-rows').value = '#####\n#S#G#\n#####';
  fire(document.getElementById('design-rows'), 'input');
  document.getElementById('btn-design-validate').click();
  assert.match(document.getElementById('design-status').textContent, /no route|error|check/i);
});

test('designer palette renders tile tools', () => {
  const { document } = fresh();
  assert.ok(document.getElementById('palette').children.length >= 5);
});

test('designer board renders a paintable grid', () => {
  const { document } = fresh();
  assert.ok(document.getElementById('design-board').children.length > 0);
});

test('validate enables play and share', () => {
  const { document } = fresh();
  document.getElementById('btn-design-validate').click();
  assert.equal(document.getElementById('btn-design-play').disabled, false);
});

test('design share link copies a #d= URL', () => {
  const { document, window } = fresh();
  document.getElementById('btn-design-validate').click();
  document.getElementById('btn-design-share').click();
  assert.match(window.navigator.clipboard._text, /#d=d1\./);
});

test('shared design link loads rows into the designer', () => {
  const D = require('../src/designer.js');
  const blob = D.serializeDesign(['#####', '#S.G#', '#####'], { shifts: 1 });
  const r = fresh({ hash: '#d=' + blob });
  assert.match(r.document.getElementById('design-status').textContent, /Shared board/);
});

test('designer play button starts the custom board', () => {
  const { document } = fresh();
  document.getElementById('btn-design-validate').click();
  document.getElementById('btn-design-play').click();
  assert.match(document.getElementById('level-name').textContent, /Designed board|Custom/);
});

/* ------------------------- self-test UI ------------------------- */

test('self-test button renders results in the page', () => {
  const { document } = fresh();
  document.getElementById('btn-selftest').click();
  assert.match(document.getElementById('selftest-summary').textContent, /checks passed/);
});

test('all page self-tests pass', () => {
  const { document } = fresh();
  document.getElementById('btn-selftest').click();
  const list = document.getElementById('selftest-list');
  assert.equal(list.querySelectorAll('li.fail').length, 0);
  assert.ok(list.querySelectorAll('li.pass').length >= 20);
});

/* ------------------------- level switching ------------------------- */

test('level picker switches levels', () => {
  const { document } = fresh();
  const btns = document.getElementById('levels-row').querySelectorAll('button.level-pick');
  btns[1].click();
  assert.match(document.getElementById('level-name').textContent, /Key and Gate/);
});

test('new level starts at tick 0 with fresh stats', () => {
  const { document } = fresh();
  const board = document.getElementById('board');
  key(board, 'ArrowRight');
  const btns = document.getElementById('levels-row').querySelectorAll('button.level-pick');
  btns[2].click();
  assert.equal(document.getElementById('stat-steps').textContent, '0');
  assert.match(document.getElementById('level-name').textContent, /Cross Currents/);
});
