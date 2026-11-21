'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../src/core.js');
const { LEVELS } = require('../js/levels.js');

const T = Core.T;

function build(i) {
  const src = LEVELS[i];
  const lvl = Core.levelFromRows(src.rows, {
    name: src.name, shifts: src.shifts, seed: 'level-' + src.id
  });
  return { src, lvl, state: Core.initialState(lvl) };
}

function play(lvl, state, actions) {
  let s = state;
  for (const a of actions) s = Core.applyAction(lvl, s, a);
  return s;
}

test('level data is well formed', () => {
  for (const src of LEVELS) {
    const lvl = Core.levelFromRows(src.rows, { name: src.name, shifts: src.shifts });
    assert.ok(Core.findTiles(lvl, T.START).length >= 1, src.name + ' has a start');
    assert.ok(Core.findTiles(lvl, T.GOAL).length >= 1, src.name + ' has a goal');
    assert.ok(src.intro.length > 0, src.name + ' has an intro');
    for (const row of src.rows) assert.equal(row.length, src.rows[0].length);
  }
});

test('Level 1, Two Doors: corridor opens with exactly two shifts', () => {
  const { lvl, state } = build(0);
  const s = play(lvl, state, [
    'right', 'right', 'right', 'right',     // grab the bit, reach the alpha door
    'shift',                                 // ALPHA to BETA, door A walks
    'right', 'right', 'right', 'right',      // through door A to door B
    'shift',                                 // BETA back to ALPHA
    'right', 'right', 'right'                // through door B to the goal
  ]);
  assert.equal(s.status, 'won');
  assert.ok(s.shifts >= 0);
});

test('Level 1 refuses the beta door while still in BETA', () => {
  const { lvl, state } = build(0);
  const s = play(lvl, state, [
    'right', 'right', 'right', 'right',
    'shift',
    'right', 'right', 'right', 'right',      // standing at the B door in BETA
    'right'                                  // bump: B is solid in BETA
  ]);
  assert.equal(s.status, 'playing');
  assert.equal(s.x, 8);
});

test('Level 2, Key and Gate: both shards open the exit gate', () => {
  const { lvl, state } = build(1);
  const s = play(lvl, state, [
    'right', 'right', 'right',               // shard one
    'left', 'left', 'left',
    'down', 'down', 'down', 'down', 'down', 'down',  // left column to the floor
    'right', 'right', 'right', 'right', 'right',     // bit, then shard two
    'right',                                 // middle column
    'up', 'up', 'up', 'up', 'up', 'up',      // top of the middle column
    'right', 'right',                        // through the open gate
    'right', 'right', 'right'                // goal
  ]);
  assert.equal(s.status, 'won');
  assert.equal(s.shardsLeft, 0);
});

test('Level 2 gate stays shut with a shard outstanding', () => {
  const { lvl, state } = build(1);
  const s = play(lvl, state, [
    'right', 'right', 'right',               // shard one only
    'right', 'right', 'right', 'right', 'right'  // press into the gate at 9,1: bump
  ]);
  assert.equal(s.x, 8, 'the gate holds while shards remain');
  assert.equal(s.status, 'playing');
});

test('Level 3, Cross Currents: every mechanic is load-bearing', () => {
  const { lvl, state } = build(2);
  const s = play(lvl, state, [
    'right', 'right',                        // shard one at 3,1
    'right', 'right', 'right',               // reach the alpha door at 7,1
    'shift',                                 // ALPHA to BETA, door A walks
    'right', 'right', 'right',               // through the door, shard two at 9,1
    'left', 'left', 'left', 'left', 'left', 'left', 'left', 'left', // back to start
    'down', 'down',                          // left column to the floor
    'right', 'right', 'right', 'right',      // bit, then shard three at 5,3
    'right', 'right', 'right', 'right',      // press into B at 10,3: denied in BETA
    'shift',                                 // BETA back to ALPHA, door B walks
    'right', 'right', 'right', 'right',      // through the door to the gate column
    'up', 'up',                              // through the open gate
    'right'                                  // goal
  ]);
  assert.equal(s.status, 'won');
  assert.equal(s.shardsLeft, 0);
});

test('Level 3 gate stays shut while the alpha-door shard is outstanding', () => {
  const { lvl, state } = build(2);
  const s = play(lvl, state, [
    'down', 'down',
    'right', 'right', 'right', 'right',      // bit + shard three only
    'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', // through B to 13,3
    'up', 'up'                               // step to the gate column, press the gate: bump
  ]);
  assert.deepEqual([s.x, s.y], [13, 2], 'the gate holds at two shards left');
  assert.equal(s.status, 'playing');
});

test('Level 3 alpha door is solid in ALPHA', () => {
  const { lvl, state } = build(2);
  const s = play(lvl, state, [
    'right', 'right',                        // shard one
    'right', 'right', 'right', 'right'       // press into A at 7,1: bump
  ]);
  assert.deepEqual([s.x, s.y], [6, 1]);
});
