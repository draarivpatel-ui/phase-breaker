'use strict';
/*
 * Edge and boundary coverage for the core: walls, phases, gates, sealed
 * tiles, malformed inputs, and the bookkeeping contract on every action.
 */
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../src/core.js');

const T = Core.T;
const PHASE = Core.PHASE;

function makeLevel(w, h, placements, shifts) {
  const grid = Core.makeGrid(w, h, T.EMPTY);
  for (let x = 0; x < w; x++) { grid[x] = T.WALL; grid[(h - 1) * w + x] = T.WALL; }
  for (let y = 0; y < h; y++) { grid[y * w] = T.WALL; grid[y * w + w - 1] = T.WALL; }
  for (const [x, y, t] of placements || []) grid[y * w + x] = t;
  return { width: w, height: h, grid: grid, seed: 'edge', shifts: shifts === undefined ? 3 : shifts };
}

function play(lvl, s, actions) {
  for (const a of actions) s = Core.applyAction(lvl, s, a);
  return s;
}

/* ------------------------- bounds and tile access ------------------------- */

test('tileAt: every corner outside the board reads as WALL', () => {
  const lvl = makeLevel(5, 5, []);
  for (const [x, y] of [[-1, -1], [5, -1], [-1, 5], [5, 5], [0, -1], [-1, 0], [5, 0], [0, 5]]) {
    assert.equal(Core.tileAt(lvl, x, y), T.WALL, `(${x},${y})`);
  }
});

test('inBounds: edges inside, one past outside', () => {
  const lvl = makeLevel(5, 5, []);
  assert.equal(Core.inBounds(lvl, 0, 0), true);
  assert.equal(Core.inBounds(lvl, 4, 4), true);
  assert.equal(Core.inBounds(lvl, -1, 0), false);
  assert.equal(Core.inBounds(lvl, 0, -1), false);
  assert.equal(Core.inBounds(lvl, 5, 4), false);
  assert.equal(Core.inBounds(lvl, 4, 5), false);
});

test('findTiles: finds every copy and ignores phantom cells', () => {
  const lvl = makeLevel(6, 6, [[1, 1, T.SHARD], [2, 2, T.SHARD], [4, 4, T.SHARD]]);
  assert.equal(Core.findTiles(lvl, T.SHARD).length, 3);
  assert.equal(Core.findTiles(lvl, T.GOAL).length, 0);
});

test('setTile: rejects negative, float, oversized and string codes', () => {
  const lvl = makeLevel(4, 4, []);
  for (const bad of [-1, 1.5, 10, 255, 'x', NaN, undefined, null]) {
    Core.setTile(lvl, 1, 1, bad);
    assert.equal(Core.tileAt(lvl, 1, 1), T.EMPTY, String(bad));
  }
  Core.setTile(lvl, 1, 1, T.BIT);
  assert.equal(Core.tileAt(lvl, 1, 1), T.BIT);
});

test('setTile: cannot write outside the grid', () => {
  const lvl = makeLevel(4, 4, []);
  Core.setTile(lvl, -1, 0, T.GOAL);
  Core.setTile(lvl, 0, -1, T.GOAL);
  Core.setTile(lvl, 4, 0, T.GOAL);
  Core.setTile(lvl, 0, 4, T.GOAL);
  assert.equal(Core.findTiles(lvl, T.GOAL).length, 0);
});

/* ------------------------- solidity truth table ------------------------- */

test('isSolid: EMPTY and START and GOAL never block', () => {
  for (const p of [PHASE.ALPHA, PHASE.BETA]) {
    for (const s of [0, 1, 5]) {
      assert.equal(Core.isSolid(T.EMPTY, p, s), false);
      assert.equal(Core.isSolid(T.START, p, s), false);
      assert.equal(Core.isSolid(T.GOAL, p, s), false);
    }
  }
});

test('isSolid: phase doors only block in their own world', () => {
  assert.equal(Core.isSolid(T.PHASE_A, PHASE.ALPHA, 0), true);
  assert.equal(Core.isSolid(T.PHASE_A, PHASE.BETA, 0), false);
  assert.equal(Core.isSolid(T.PHASE_B, PHASE.BETA, 0), true);
  assert.equal(Core.isSolid(T.PHASE_B, PHASE.ALPHA, 0), false);
});

test('isSolid: SHARD, BIT, HAZARD are always walkable', () => {
  for (const t of [T.SHARD, T.BIT, T.HAZARD]) {
    assert.equal(Core.isSolid(t, PHASE.ALPHA, 0), false);
    assert.equal(Core.isSolid(t, PHASE.BETA, 3), false);
  }
});

test('isSolid: GATE blocks while any shard is outstanding', () => {
  assert.equal(Core.isSolid(T.GATE, PHASE.ALPHA, 0), false);
  assert.equal(Core.isSolid(T.GATE, PHASE.ALPHA, 1), true);
  assert.equal(Core.isSolid(T.GATE, PHASE.BETA, 7), true);
});

test('canWalk: bounds and solidity compose', () => {
  const lvl = makeLevel(5, 5, [[2, 2, T.PHASE_A], [3, 3, T.GATE]]);
  assert.equal(Core.canWalk(lvl, 2, 2, PHASE.ALPHA, 0), false);
  assert.equal(Core.canWalk(lvl, 2, 2, PHASE.BETA, 0), true);
  assert.equal(Core.canWalk(lvl, 3, 3, PHASE.ALPHA, 1), false);
  assert.equal(Core.canWalk(lvl, 3, 3, PHASE.ALPHA, 0), true);
  assert.equal(Core.canWalk(lvl, -1, 0, PHASE.ALPHA, 0), false);
});

/* ------------------------- movement bookkeeping ------------------------- */

test('every direction moves exactly one tile', () => {
  const lvl = makeLevel(9, 9, [[4, 4, T.START]]);
  let s = Core.initialState(lvl);
  const legs = [['up', 4, 3], ['right', 5, 3], ['down', 5, 4], ['left', 4, 4]];
  for (const [a, x, y] of legs) {
    s = Core.applyAction(lvl, s, a);
    assert.deepEqual([s.x, s.y], [x, y], a);
  }
});

test('bump into every border wall keeps position and spends the turn', () => {
  const lvl = makeLevel(5, 5, [[1, 1, T.START]]);
  let s = Core.initialState(lvl);
  const bumps = [['left', 1, 1], ['up', 1, 1]];
  for (const [a, x, y] of bumps) {
    const after = Core.applyAction(lvl, s, a);
    assert.deepEqual([after.x, after.y], [x, y]);
    assert.equal(after.tick, s.tick + 1);
    s = after;
  }
});

test('bump into the far walls too', () => {
  const lvl = makeLevel(5, 5, [[3, 3, T.START]]);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'right');  // bump wall at x=4
  assert.deepEqual([s.x, s.y], [3, 3]);
  s = Core.applyAction(lvl, s, 'down');   // bump wall at y=4
  assert.deepEqual([s.x, s.y], [3, 3]);
  assert.equal(s.steps, 2);
});

test('single letters u r d l move identically to full names', () => {
  const lvl = makeLevel(9, 9, [[4, 4, T.START]]);
  const full = play(lvl, Core.initialState(lvl), ['up', 'right', 'down', 'left']);
  Core.resetLevel(lvl);
  const short = play(lvl, Core.initialState(lvl), ['u', 'r', 'd', 'l']);
  assert.equal(short.x, full.x);
  assert.equal(short.y, full.y);
  assert.equal(short.tick, full.tick);
});

test('mixed case spellings resolve the same', () => {
  const lvl = makeLevel(9, 9, [[4, 4, T.START]]);
  const a = play(lvl, Core.initialState(lvl), ['UP', 'Right', 'DOWN']);
  Core.resetLevel(lvl);
  const b = play(lvl, Core.initialState(lvl), ['up', 'right', 'down']);
  assert.equal(a.x, b.x);
  assert.equal(a.y, b.y);
});

test('object actions resolve through .a', () => {
  const lvl = makeLevel(9, 9, [[4, 4, T.START]]);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, { a: 'up', t: 1 });
  assert.deepEqual([s.x, s.y], [4, 3]);
  s = Core.applyAction(lvl, s, { a: 'SHIFT' });
  assert.equal(s.phase, PHASE.BETA);
});

test('object actions with bad .a are free', () => {
  const lvl = makeLevel(9, 9, [[4, 4, T.START]]);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, { a: 42 });
  assert.equal(s.tick, 0);
  s = Core.applyAction(lvl, s, { a: null });
  assert.equal(s.tick, 0);
  s = Core.applyAction(lvl, s, { a: 'zz' });
  assert.equal(s.tick, 0);
});

test('whitespace and symbols are never actions', () => {
  const lvl = makeLevel(5, 5, [[2, 2, T.START]]);
  let s = Core.initialState(lvl);
  for (const bad of [' ', '\n', '\t', ' up', 'up ', '!!', '@', 'upup', 'waitx', 'shifty']) {
    const after = Core.applyAction(lvl, s, bad);
    assert.equal(after.tick, s.tick, JSON.stringify(bad));
  }
});

test('single letters s and w are not shift or wait in the core', () => {
  const lvl = makeLevel(5, 5, [[2, 2, T.START]]);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 's');
  assert.equal(s.tick, 0, 's is not a shift');
  s = Core.applyAction(lvl, s, 'w');
  assert.equal(s.tick, 0, 'w is not a wait');
});

/* ------------------------- phase and charges ------------------------- */

test('shift alternates deterministically until charges run dry', () => {
  const lvl = makeLevel(5, 5, [[2, 2, T.START]], 2);
  let s = Core.initialState(lvl);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    s = Core.applyAction(lvl, s, 'shift');
    seen.push(s.phase);
  }
  assert.deepEqual(seen, [PHASE.BETA, PHASE.ALPHA, PHASE.ALPHA, PHASE.ALPHA],
    'two charges, two flips, then denied');
  assert.equal(s.shifts, 0);
  assert.equal(s.tick, 4);
});

test('walking through a phase door of the other world is free movement', () => {
  const lvl = makeLevel(7, 5, [[1, 1, T.START], [2, 1, T.PHASE_A]], 0);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'right');  // blocked: ALPHA world, A door
  assert.deepEqual([s.x, s.y], [1, 1]);
  lvl.shifts = 1;
  s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'shift');  // now BETA
  s = Core.applyAction(lvl, s, 'right');  // through the alpha door
  assert.deepEqual([s.x, s.y], [2, 1]);
});

test('standing inside a now-solid tile is legal and escapable', () => {
  // Stand on a B tile in BETA (walkable), shift back to ALPHA where it is
  // also walkable; stand on A tile in ALPHA: walkable; shift to BETA makes
  // it solid underfoot but stepping out still works.
  const lvl = makeLevel(7, 5, [[2, 1, T.START], [3, 1, T.PHASE_B]], 1);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'right');   // onto B door tile (walkable in ALPHA)
  assert.deepEqual([s.x, s.y], [3, 1]);
  s = Core.applyAction(lvl, s, 'shift');   // BETA: B tile is now solid underfoot
  assert.equal(s.phase, PHASE.BETA);
  s = Core.applyAction(lvl, s, 'right');   // stepping off a solid tile is legal
  assert.deepEqual([s.x, s.y], [4, 1]);
});

test('bits stack charges without cap', () => {
  const lvl = makeLevel(9, 5, [[1, 1, T.START], [2, 1, T.BIT], [3, 1, T.BIT]], 0);
  let s = Core.initialState(lvl);
  s = play(lvl, s, ['right', 'right']);
  assert.equal(s.shifts, 2);
  s = Core.applyAction(lvl, s, 'shift');
  s = Core.applyAction(lvl, s, 'shift');
  assert.equal(s.phase, PHASE.ALPHA);
});

/* ------------------------- collectibles ------------------------- */

test('multiple shards count down independently', () => {
  const lvl = makeLevel(9, 5, [[1, 1, T.START], [2, 1, T.SHARD], [3, 1, T.SHARD], [4, 1, T.SHARD]], 0);
  let s = Core.initialState(lvl);
  assert.equal(s.shardsLeft, 3);
  s = play(lvl, s, ['right', 'right', 'right']);
  assert.equal(s.shardsLeft, 0);
  assert.equal(s.status, 'playing');
});

test('shards cannot go below zero', () => {
  const lvl = makeLevel(7, 5, [[1, 1, T.START], [2, 1, T.SHARD]], 0);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'right');
  assert.equal(s.shardsLeft, 0);
  s = Core.applyAction(lvl, s, 'left');
  s = Core.applyAction(lvl, s, 'right');  // tile now EMPTY
  assert.equal(s.shardsLeft, 0);
});

test('a shard behind a gate with itself counted still counts down', () => {
  const lvl = makeLevel(7, 5, [[1, 1, T.START], [2, 1, T.SHARD], [4, 1, T.GATE]], 0);
  let s = Core.initialState(lvl);
  s = play(lvl, s, ['right', 'right']);
  assert.equal(Core.tileAt(lvl, 2, 1), T.EMPTY);
  s = Core.applyAction(lvl, s, 'right');   // gate now open, steps onto it
  assert.deepEqual([s.x, s.y], [4, 1]);
});

test('a hazard ends the run even with shards left', () => {
  const lvl = makeLevel(7, 5, [[1, 1, T.START], [3, 1, T.HAZARD], [5, 3, T.SHARD]], 0);
  let s = Core.initialState(lvl);
  s = play(lvl, s, ['right', 'right']);
  assert.equal(s.status, 'dead');
  assert.equal(s.shardsLeft, 1);
});

test('win and death both freeze the state machine', () => {
  const winLvl = makeLevel(5, 5, [[1, 1, T.START], [2, 1, T.GOAL]], 0);
  let w = Core.initialState(winLvl);
  w = Core.applyAction(winLvl, w, 'right');
  assert.equal(w.status, 'won');
  for (const a of ['left', 'shift', 'wait', 'up']) {
    const after = Core.applyAction(winLvl, w, a);
    assert.equal(after.tick, w.tick, a + ' after win');
  }
  const deadLvl = makeLevel(5, 5, [[1, 1, T.START], [2, 1, T.HAZARD]], 0);
  let d = Core.initialState(deadLvl);
  d = Core.applyAction(deadLvl, d, 'right');
  assert.equal(d.status, 'dead');
  for (const a of ['left', 'shift', 'wait', 'up']) {
    const after = Core.applyAction(deadLvl, d, a);
    assert.equal(after.tick, d.tick, a + ' after death');
  }
});

/* ------------------------- initialState and resetLevel ------------------------- */

test('initialState: defaults are ALPHA, zero steps, zero deaths, playing', () => {
  const lvl = makeLevel(5, 5, [[2, 2, T.START]], 1);
  const s = Core.initialState(lvl);
  assert.equal(s.phase, PHASE.ALPHA);
  assert.equal(s.steps, 0);
  assert.equal(s.deaths, 0);
  assert.equal(s.status, 'playing');
  assert.equal(s.tick, 0);
  assert.equal(s.shifts, 1);
});

test('initialState: snapshots baseGrid lazily', () => {
  const lvl = makeLevel(5, 5, [[2, 2, T.START], [3, 2, T.SHARD]]);
  assert.equal(lvl.baseGrid, undefined);
  Core.initialState(lvl);
  assert.ok(lvl.baseGrid instanceof Uint8Array);
  assert.equal(lvl.baseGrid[3 + 2 * 5], T.SHARD);
});

test('initialState: prefers the START tile over walkable fallback', () => {
  const lvl = makeLevel(6, 6, [[1, 1, T.EMPTY], [4, 4, T.START]]);
  const s = Core.initialState(lvl);
  assert.deepEqual([s.x, s.y], [4, 4]);
});

test('initialState: all-wall board falls back to 1,1', () => {
  const lvl = { width: 4, height: 4, grid: Core.makeGrid(4, 4, T.WALL), shifts: 0 };
  const s = Core.initialState(lvl);
  assert.deepEqual([s.x, s.y], [1, 1]);
});

test('resetLevel: throws with no baseGrid at all', () => {
  const lvl = { width: 3, height: 3 };
  assert.throws(() => Core.resetLevel(lvl), /baseGrid/);
});

test('resetLevel: length mismatch throws', () => {
  const lvl = makeLevel(4, 4, []);
  lvl.baseGrid = new Uint8Array(5);
  assert.throws(() => Core.resetLevel(lvl), /does not match/);
});

test('resetLevel: restores every mutated cell and hands fresh state', () => {
  const lvl = makeLevel(9, 5, [[1, 1, T.START], [2, 1, T.SHARD], [3, 1, T.BIT], [4, 1, T.HAZARD]], 1);
  let s = Core.initialState(lvl);
  s = play(lvl, s, ['right', 'right', 'right']);
  assert.equal(s.status, 'dead');
  const s2 = Core.resetLevel(lvl);
  assert.equal(Core.tileAt(lvl, 2, 1), T.SHARD);
  assert.equal(Core.tileAt(lvl, 3, 1), T.BIT);
  assert.equal(s2.status, 'playing');
  assert.equal(s2.deaths, 0);
  assert.equal(s2.shardsLeft, 1);
});

/* ------------------------- firstWalkable ------------------------- */

test('firstWalkable: skips walls, hazards and closed gates', () => {
  const lvl = {
    width: 5, height: 3, shifts: 0,
    grid: new Uint8Array([
      T.WALL, T.WALL, T.WALL, T.WALL, T.WALL,
      T.HAZARD, T.WALL, T.GATE, T.EMPTY, T.WALL,
      T.WALL, T.WALL, T.WALL, T.WALL, T.WALL
    ])
  };
  const fw = Core.firstWalkable(lvl, 2);
  assert.deepEqual(fw, { x: 3, y: 1 });
});

test('firstWalkable: returns null on a fully sealed board', () => {
  const lvl = { width: 3, height: 3, grid: Core.makeGrid(3, 3, T.WALL) };
  assert.equal(Core.firstWalkable(lvl, 0), null);
});

/* ------------------------- seed codes ------------------------- */

test('encodeSeedCode: levelIndex zero is the first level', () => {
  const code = Core.encodeSeedCode(12345, 0);
  const back = Core.decodeSeedCode(code);
  assert.equal(back.levelIndex, 0);
});

test('encodeSeedCode: rejects bad levelIndex', () => {
  assert.equal(Core.encodeSeedCode(1, -1), null);
  assert.equal(Core.encodeSeedCode(1, 1.5), null);
  assert.equal(Core.encodeSeedCode(1, 'x'), null);
});

test('decodeSeedCode: case-insensitive prefix and body', () => {
  const a = Core.decodeSeedCode('pb-' + (77).toString(36) + '-2');
  assert.equal(a.seed, 77);
  assert.equal(a.levelIndex, 1);
});

test('decodeSeedCode: string seeds hash identically on both sides', () => {
  const code = Core.encodeSeedCode('spark-seed', 0);
  const back = Core.decodeSeedCode(code);
  assert.equal(back.seed, Core.hashSeed('spark-seed'));
});

/* ------------------------- RNG extra ------------------------- */

test('rng.int: degenerate range returns the bound', () => {
  const r = Core.makeRNG(5);
  for (let i = 0; i < 10; i++) { assert.equal(r.int(7, 7), 7); }
});

test('rng.pick: only ever returns members', () => {
  const r = Core.makeRNG(9);
  const pool = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) { assert.ok(pool.includes(r.pick(pool))); }
});

test('rng.chance: p=0 never fires, p=1 always fires', () => {
  const r = Core.makeRNG(3);
  for (let i = 0; i < 50; i++) {
    assert.equal(r.chance(0), false);
    assert.equal(r.chance(1), true);
  }
});

test('rng.shuffle: keeps the multiset and is seeded', () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = Core.makeRNG(11).shuffle(arr.slice(0));
  const b = Core.makeRNG(11).shuffle(arr.slice(0));
  assert.deepEqual(a, b);
  assert.deepEqual(a.slice(0).sort(), arr);
});

test('makeRNG: string seeds go through hashSeed', () => {
  const r1 = Core.makeRNG('hello');
  const r2 = Core.makeRNG(Core.hashSeed('hello'));
  assert.equal(r1.next(), r2.next());
});

/* ------------------------- fingerprints ------------------------- */

test('levelFingerprint: stable and shape sensitive', () => {
  const g = Core.makeGrid(12, 1, T.EMPTY);
  const a = Core.levelFingerprint(g, 12, 1);
  const b = Core.levelFingerprint(g, 12, 1);
  assert.equal(a, b);
  const g2 = Core.makeGrid(12, 1, T.EMPTY);
  g2[0] = T.WALL;
  assert.notEqual(Core.levelFingerprint(g2, 12, 1), a);
});

test('replayHash: tick metadata feeds the hash', () => {
  const lvl = makeLevel(5, 5, [[1, 1, T.START]]);
  lvl.fingerprint = Core.levelFingerprint(lvl.grid, 5, 5);
  const a = Core.replayHash(lvl, [{ t: 1, a: 'up' }]);
  const b = Core.replayHash(lvl, [{ t: 2, a: 'up' }]);
  assert.notEqual(a, b, 'same action at different tick hashes differently');
});

test('levelFromRows: name and seed options stick', () => {
  const lvl = Core.levelFromRows(['###', '#S#', '###'], { name: 'N', seed: 'seed-x', shifts: 2 });
  assert.equal(lvl.name, 'N');
  assert.equal(lvl.seed, 'seed-x');
  assert.equal(lvl.shifts, 2);
});

test('levelFromRows: every glyph maps', () => {
  const lvl = Core.levelFromRows(['#.ABSG*T!+'], { shifts: 0 });
  const want = [T.WALL, T.EMPTY, T.PHASE_A, T.PHASE_B, T.START, T.GOAL, T.SHARD, T.GATE, T.HAZARD, T.BIT];
  for (let i = 0; i < want.length; i++) {
    assert.equal(lvl.grid[i], want[i], 'col ' + i);
  }
});

test('levelFromRows: second row short throws', () => {
  assert.throws(() => Core.levelFromRows(['#####', '###']), /exactly 5 cells/);
});

test('levelFromRows: null and non-array blow up cleanly', () => {
  assert.throws(() => Core.levelFromRows(null));
  assert.throws(() => Core.levelFromRows('#####'));
  assert.throws(() => Core.levelFromRows([5, 5, 5]));
});
