'use strict';
/* Telemetry tracker and CSV export. */
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../src/core.js');
const Tel = require('../src/telemetry.js');

const T = Core.T;

function bench(placements, shifts) {
  const grid = Core.makeGrid(9, 5, T.EMPTY);
  for (let x = 0; x < 9; x++) { grid[x] = T.WALL; grid[4 * 9 + x] = T.WALL; }
  for (let y = 0; y < 5; y++) { grid[y * 9] = T.WALL; grid[y * 9 + 8] = T.WALL; }
  for (const [x, y, t] of placements) { grid[y * 9 + x] = t; }
  return { width: 9, height: 5, grid: grid, shifts: shifts === undefined ? 2 : shifts };
}

function drive(level, actions) {
  const tr = Tel.makeTracker();
  let s = Core.initialState(level);
  tr.start(s);
  for (const a of actions) {
    const next = Core.applyAction(level, s, a);
    tr.note(a, s, next);
    s = next;
  }
  return { tr: tr, final: s };
}

test('start marks the spawn tile visited', () => {
  const { tr } = drive(bench([[1, 1, T.START]]), []);
  assert.equal(tr.summary().visitedCount, 1);
});

test('moves increment turns, moves and combo', () => {
  const { tr } = drive(bench([[1, 1, T.START]]), ['right', 'right', 'right']);
  const s = tr.summary();
  assert.equal(s.turns, 3);
  assert.equal(s.moves, 3);
  assert.equal(s.bumps, 0);
  assert.equal(s.maxCombo, 3);
  assert.equal(s.moveSuccess, 1);
});

test('wall bumps count and break the combo', () => {
  const lvl = bench([[1, 1, T.START]]);
  const { tr } = drive(lvl, ['right', 'right', 'up', 'right']);
  const s = tr.summary();
  assert.equal(s.moves, 3);
  assert.equal(s.bumps, 1);
  assert.equal(s.maxCombo, 2);
  assert.equal(s.bumpRate, 1 / 4);
  assert.equal(s.moveSuccess, 0.75);
});

test('unknown actions are free no-ops', () => {
  const { tr } = drive(bench([[1, 1, T.START]]), ['right', 'bogus', 'nope', 'right']);
  const s = tr.summary();
  assert.equal(s.turns, 2);
  assert.equal(s.freeNoOps, 2);
});

test('wait counts and resets the combo', () => {
  const { tr } = drive(bench([[1, 1, T.START]]), ['right', 'wait', 'right']);
  const s = tr.summary();
  assert.equal(s.waits, 1);
  assert.equal(s.maxCombo, 1);
});

test('used shift increments and keeps combo alive', () => {
  const { tr } = drive(bench([[1, 1, T.START]], 2), ['right', 'shift', 'right']);
  const s = tr.summary();
  assert.equal(s.shiftsUsed, 1);
  assert.equal(s.shiftsDenied, 0);
  assert.equal(s.maxCombo, 2);
});

test('denied shift counts and breaks combo', () => {
  const { tr } = drive(bench([[1, 1, T.START]], 0), ['right', 'shift', 'right']);
  const s = tr.summary();
  assert.equal(s.shiftsUsed, 0);
  assert.equal(s.shiftsDenied, 1);
  assert.equal(s.maxCombo, 1);
});

test('phase split tracks which world each turn ran in', () => {
  const { tr } = drive(bench([[1, 1, T.START]], 1), ['right', 'shift', 'right', 'shift']);
  const s = tr.summary();
  // turns are attributed to the world they STARTED in:
  // right(ALPHA), shift(ALPHA), right(BETA), shift(BETA)
  assert.equal(s.phaseAlpha, 2);
  assert.equal(s.phaseBeta, 2);
  assert.equal(s.alphaShare, 0.5);
  assert.equal(s.betaShare, 0.5);
});

test('shards and bits are counted as collected', () => {
  const lvl = bench([[1, 1, T.START], [2, 1, T.SHARD], [3, 1, T.BIT]], 0);
  const { tr } = drive(lvl, ['right', 'right']);
  const s = tr.summary();
  assert.equal(s.shardsGot, 1);
  assert.equal(s.bitsGot, 1);
});

test('hazard death is counted and ticked', () => {
  const lvl = bench([[1, 1, T.START], [3, 1, T.HAZARD]]);
  const { tr, final } = drive(lvl, ['right', 'right']);
  const s = tr.summary();
  assert.equal(s.deaths, 1);
  assert.equal(s.firstDeathTick, 2);
  assert.equal(final.status, 'dead');
});

test('win is detected with its tick', () => {
  const lvl = bench([[1, 1, T.START], [3, 1, T.GOAL]]);
  const { tr } = drive(lvl, ['right', 'right']);
  const s = tr.summary();
  assert.equal(s.won, true);
  assert.equal(s.wonTick, 2);
});

test('dead-state actions are counted as free no-ops', () => {
  const lvl = bench([[1, 1, T.START], [2, 1, T.HAZARD]]);
  const { tr } = drive(lvl, ['right', 'up', 'down']);
  const s = tr.summary();
  assert.equal(s.turns, 1);
  assert.equal(s.freeNoOps, 2);
});

test('revisiting a tile does not inflate visitedCount', () => {
  const lvl = bench([[2, 2, T.START]]);
  const { tr } = drive(lvl, ['up', 'down', 'up', 'down']);
  assert.equal(tr.summary().visitedCount, 2);  // spawn + one other
});

test('rows carry one entry per recognised action', () => {
  const { tr } = drive(bench([[1, 1, T.START]], 1), ['right', 'junk', 'shift', 'wait']);
  const rows = tr.rows();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.action), ['right', 'shift', 'wait']);
});

test('row fields reflect the after-state', () => {
  const { tr } = drive(bench([[1, 1, T.START]], 1), ['shift', 'right']);
  const rows = tr.rows();
  assert.equal(rows[0].phase, 'BETA');
  assert.equal(rows[0].tick, 1);
  assert.equal(rows[1].x, 2);
  assert.equal(rows[1].status, 'playing');
});

test('note with missing states is ignored', () => {
  const tr = Tel.makeTracker();
  tr.note('right', null, { tick: 1 });
  tr.note('right', { tick: 0 }, null);
  assert.equal(tr.summary().turns, 0);
  assert.equal(tr.summary().freeNoOps, 0);
});

test('object actions resolve kind via .a', () => {
  const lvl = bench([[1, 1, T.START]]);
  const tr = Tel.makeTracker();
  let s = Core.initialState(lvl);
  tr.start(s);
  const next = Core.applyAction(lvl, s, 'right');
  tr.note({ a: 'right' }, s, next);
  assert.equal(tr.rows()[0].action, 'right');
});

test('reset clears every counter', () => {
  const lvl = bench([[1, 1, T.START]]);
  const tr = Tel.makeTracker();
  let s = Core.initialState(lvl);
  tr.start(s);
  for (const a of ['right', 'up', 'shift', 'wait']) {
    const n = Core.applyAction(lvl, s, a);
    tr.note(a, s, n);
    s = n;
  }
  tr.reset();
  const sum = tr.summary();
  assert.equal(sum.turns, 0);
  assert.equal(sum.visitedCount, 0);
  assert.equal(tr.rows().length, 0);
});

test('summary bumpRate and moveSuccess are 0 with no turns', () => {
  const s = Tel.makeTracker().summary();
  assert.equal(s.bumpRate, 0);
  assert.equal(s.moveSuccess, 0);
  assert.equal(s.alphaShare, 0);
});

/* ------------------------- CSV ------------------------- */

test('CSV header is the fixed column list', () => {
  const csv = Tel.toCSV([]);
  assert.equal(csv, 'tick,action,x,y,phase,shifts,shardsLeft,status\n');
});

test('CSV emits one line per row', () => {
  const rows = [
    { tick: 1, action: 'right', x: 2, y: 1, phase: 'ALPHA', shifts: 1, shardsLeft: 0, status: 'playing' },
    { tick: 2, action: 'shift', x: 2, y: 1, phase: 'BETA', shifts: 0, shardsLeft: 0, status: 'playing' }
  ];
  const csv = Tel.toCSV(rows);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[1], '1,right,2,1,ALPHA,1,0,playing');
});

test('csvCell quotes commas, quotes and newlines', () => {
  assert.equal(Tel.csvCell('a,b'), '"a,b"');
  assert.equal(Tel.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(Tel.csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(Tel.csvCell('plain'), 'plain');
  assert.equal(Tel.csvCell(42), '42');
  assert.equal(Tel.csvCell(null), '');
  assert.equal(Tel.csvCell(undefined), '');
});

test('CSV of a real run round trips through the tracker', () => {
  const lvl = bench([[1, 1, T.START], [5, 1, T.GOAL]], 1);
  const { tr } = drive(lvl, ['right', 'shift', 'right', 'right', 'right']);
  const csv = Tel.toCSV(tr.rows());
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 6);
  assert.match(lines[5], /won$/);
});

test('CSV ends with a trailing newline', () => {
  assert.ok(Tel.toCSV([]).endsWith('\n'));
});

test('csvCell neutralizes spreadsheet formulas and whitespace padded formulas', () => {
  assert.equal(Tel.csvCell('=SUM(1)'), "'=SUM(1)");
  assert.equal(Tel.csvCell('+cmd'), "'+cmd");
  assert.equal(Tel.csvCell('@x'), "'@x");
  assert.equal(Tel.csvCell(' =SUM(1)'), "' =SUM(1)");
  assert.equal(Tel.csvCell('-x'), "'-x");
  assert.equal(Tel.csvCell('-12.5'), '-12.5', 'plain negative numbers stay numeric');
});
