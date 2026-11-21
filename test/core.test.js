'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../src/core.js');

const T = Core.T;
const PHASE = Core.PHASE;

/* Build a tiny open level: walls on the border, interior EMPTY unless set. */
function makeLevel(w, h, placements) {
  const grid = Core.makeGrid(w, h, T.EMPTY);
  for (let x = 0; x < w; x++) { grid[x] = T.WALL; grid[(h - 1) * w + x] = T.WALL; }
  for (let y = 0; y < h; y++) { grid[y * w] = T.WALL; grid[y * w + w - 1] = T.WALL; }
  for (const [x, y, t] of placements || []) grid[y * w + x] = t;
  return { width: w, height: h, grid: grid, seed: 'test', shifts: 3 };
}

test('RNG is deterministic per seed and ints land in range', () => {
  const a = Core.makeRNG(42);
  const b = Core.makeRNG(42);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
  const r = Core.makeRNG('word-seed');
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const v = r.int(1, 6);
    assert.ok(v >= 1 && v <= 6 && Number.isInteger(v));
    seen.add(v);
  }
  assert.ok(seen.size === 6, 'a d6 faces every side');
  assert.notEqual(Core.makeRNG('one').next(), Core.makeRNG('two').next());
});

test('fnv1a and hashHex are stable and handle unicode input', () => {
  assert.equal(Core.fnv1a('phase'), Core.fnv1a('phase'));
  assert.notEqual(Core.fnv1a('phase'), Core.fnv1a('phases'));
  assert.equal(typeof Core.fnv1a('pumpkin pie'), 'number');
  assert.doesNotThrow(() => Core.fnv1a('emoji \u{1F383}'));
  assert.match(Core.hashHex('x'), /^[0-9A-F]{8}$/);
});

test('tile helpers respect bounds', () => {
  const lvl = makeLevel(5, 5, [[2, 2, T.START]]);
  assert.equal(Core.tileAt(lvl, 2, 2), T.START);
  assert.equal(Core.tileAt(lvl, -1, 0), T.WALL);
  assert.equal(Core.tileAt(lvl, 99, 99), T.WALL);
  assert.equal(Core.inBounds(lvl, 4, 4), true);
  assert.equal(Core.inBounds(lvl, 5, 5), false);
  const spots = Core.findTiles(lvl, T.START);
  assert.equal(spots.length, 1);
  Core.setTile(lvl, 1, 1, T.HAZARD);
  assert.equal(Core.tileAt(lvl, 1, 1), T.HAZARD);
  Core.setTile(lvl, -5, -5, T.GOAL);
  assert.equal(Core.findTiles(lvl, T.GOAL).length, 0);
  Core.setTile(lvl, 3, 3, 999);
  assert.notEqual(Core.tileAt(lvl, 3, 3), 999, 'invalid tile codes never land');
});

test('isSolid truth table across phases and shards', () => {
  assert.equal(Core.isSolid(T.WALL, PHASE.ALPHA, 0), true);
  assert.equal(Core.isSolid(T.EMPTY, PHASE.ALPHA, 0), false);
  assert.equal(Core.isSolid(T.PHASE_A, PHASE.ALPHA, 0), true);
  assert.equal(Core.isSolid(T.PHASE_A, PHASE.BETA, 0), false);
  assert.equal(Core.isSolid(T.PHASE_B, PHASE.BETA, 0), true);
  assert.equal(Core.isSolid(T.PHASE_B, PHASE.ALPHA, 0), false);
  assert.equal(Core.isSolid(T.GATE, PHASE.ALPHA, 2), true);
  assert.equal(Core.isSolid(T.GATE, PHASE.ALPHA, 0), false);
  assert.equal(Core.isSolid(T.HAZARD, PHASE.BETA, 0), false);
});

test('movement walks, bumps walls at a step, and never leaves the board', () => {
  const lvl = makeLevel(5, 5, [[1, 1, T.START]]);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'right');
  assert.deepEqual([s.x, s.y], [2, 1]);
  assert.equal(s.steps, 1);
  s = Core.applyAction(lvl, s, 'up');       // into the border wall
  assert.deepEqual([s.x, s.y], [2, 1]);
  assert.equal(s.steps, 2, 'a wall bump still costs a step');
  s = Core.applyAction(lvl, s, 'l');        // single letter moves too
  assert.deepEqual([s.x, s.y], [1, 1]);
});

test('shift flips the phase, spends a charge, and denies at zero', () => {
  const lvl = makeLevel(5, 5, [[1, 1, T.START]]);
  lvl.shifts = 1;
  let s = Core.initialState(lvl);
  assert.equal(s.shifts, 1);
  s = Core.applyAction(lvl, s, 'shift');
  assert.equal(s.phase, PHASE.BETA);
  assert.equal(s.shifts, 0);
  const denied = Core.applyAction(lvl, s, 'shift');
  assert.equal(denied.phase, PHASE.BETA, 'a charge-free shift is denied');
  assert.equal(denied.shifts, 0);
  assert.equal(denied.steps, s.steps + 1, 'a denied shift still spends the turn');
  assert.equal(denied.tick, s.tick + 1);
});

test('a missing shifts field starts at zero and never goes NaN', () => {
  const lvl = makeLevel(5, 5, [[1, 1, T.START]]);
  delete lvl.shifts;
  let s = Core.initialState(lvl);
  assert.equal(s.shifts, 0);
  s = Core.applyAction(lvl, s, 'shift');
  assert.equal(s.shifts, 0);
  assert.equal(s.phase, PHASE.ALPHA, 'shift is denied with no charges');
  assert.ok(Number.isFinite(s.shifts));
});

test('unrecognised and null actions are free no-ops, never crashes', () => {
  const lvl = makeLevel(5, 5, [[1, 1, T.START]]);
  let s = Core.initialState(lvl);
  for (const bad of ['north', '', null, 5, {}, undefined, 'x', { a: 'bogus' }, { kind: 'up' }]) {
    const after = Core.applyAction(lvl, s, bad);
    assert.equal(after.steps, s.steps, JSON.stringify(bad) + ' must not cost a step');
    assert.equal(after.tick, s.tick, JSON.stringify(bad) + ' must not tick');
  }
  const w = Core.applyAction(lvl, s, 'wait');
  assert.equal(w.tick, s.tick + 1, 'wait is a real action and ticks');
  assert.equal(w.steps, s.steps + 1, 'wait spends the turn');
});

test('shards open the gate and the gate blocks before then', () => {
  const lvl = makeLevel(7, 5, [[1, 1, T.START], [2, 1, T.SHARD], [4, 1, T.GATE], [5, 1, T.GOAL]]);
  let s = Core.initialState(lvl);
  assert.equal(s.shardsLeft, 1);
  s = Core.applyAction(lvl, s, 'right');   // pick up the shard
  assert.equal(s.shardsLeft, 0);
  assert.equal(Core.tileAt(lvl, 2, 1), T.EMPTY, 'the shard is consumed');
  s = Core.applyAction(lvl, s, 'right');   // through the now open gate
  s = Core.applyAction(lvl, s, 'right');   // onto the gate tile
  s = Core.applyAction(lvl, s, 'right');   // the goal
  assert.equal(s.status, 'won');
});

test('the gate stays solid while shards remain', () => {
  const lvl = makeLevel(7, 5, [[1, 1, T.START], [3, 3, T.SHARD], [2, 1, T.GATE], [4, 1, T.GOAL]]);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'right');   // bumps the locked gate
  assert.deepEqual([s.x, s.y], [1, 1]);
  assert.equal(s.status, 'playing');
});

test('hazards kill, the board keeps score, and terminal states freeze', () => {
  const lvl = makeLevel(5, 5, [[1, 1, T.START], [2, 1, T.HAZARD]]);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'right');
  assert.equal(s.status, 'dead');
  assert.equal(s.deaths, 1);
  const frozen = Core.applyAction(lvl, s, 'left');
  assert.equal(frozen.steps, s.steps, 'dead players do not move');
});

test('bits add a shift charge and are consumed', () => {
  const lvl = makeLevel(5, 5, [[1, 1, T.START], [2, 1, T.BIT]]);
  lvl.shifts = 0;
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'right');
  assert.equal(s.shifts, 1);
  assert.equal(Core.tileAt(lvl, 2, 1), T.EMPTY);
});

test('resetLevel restores consumed tiles even without a pre-made baseGrid', () => {
  const lvl = makeLevel(5, 5, [[1, 1, T.START], [2, 1, T.SHARD]]);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'right');
  assert.equal(Core.tileAt(lvl, 2, 1), T.EMPTY);
  const s2 = Core.resetLevel(lvl);
  assert.equal(Core.tileAt(lvl, 2, 1), T.SHARD, 'the shard comes back');
  assert.equal(s2.shardsLeft, 1);
  assert.equal(s2.status, 'playing');
});

test('seed codes round trip and reject garbage', () => {
  for (const seed of [0, 1, 12345, 2147483647, 4294967295]) {
    const code = Core.encodeSeedCode(seed, 2);
    const back = Core.decodeSeedCode(code);
    assert.equal(back.seed, seed >>> 0, code);
    assert.equal(back.levelIndex, 2);
  }
  assert.equal(Core.decodeSeedCode('PB-' + (4294967296).toString(36).toUpperCase() + '-1'), null,
    'seeds past 32 bits cannot round trip, so they must not decode');
  assert.equal(Core.decodeSeedCode('PB-0-0'), null);
  assert.equal(Core.decodeSeedCode('not-a-code'), null);
  assert.equal(Core.decodeSeedCode(''), null);
  assert.equal(Core.decodeSeedCode(null), null);
});

test('replay and level fingerprints are deterministic', () => {
  const lvl = makeLevel(5, 5, [[1, 1, T.START]]);
  lvl.fingerprint = Core.levelFingerprint(lvl.grid, lvl.width, lvl.height);
  const replay = [{ t: 1, a: 'right' }, { t: 2, a: 'wait' }];
  assert.equal(Core.replayHash(lvl, replay), Core.replayHash(lvl, replay));
  const strung = Core.replayHash(lvl, ['right', 'wait']);
  assert.equal(typeof strung, 'string');
  assert.match(strung, /^[0-9A-F]{8}$/);
});

test('replayHash never collapses distinct replays onto one hash', () => {
  const lvl = makeLevel(5, 5, [[1, 1, T.START]]);
  lvl.fingerprint = Core.levelFingerprint(lvl.grid, lvl.width, lvl.height);
  const a = Core.replayHash(lvl, [{ a: 'up' }, { a: 'left' }]);
  const b = Core.replayHash(lvl, [{ a: 'down' }, { a: 'wait' }]);
  assert.notEqual(a, b, 'different action kinds must hash differently');
  const c = Core.replayHash(lvl, ['up', 'left']);
  const d = Core.replayHash(lvl, ['right', 'down']);
  assert.notEqual(c, d, 'string actions keep their content in the hash');
  const e = Core.replayHash(lvl, [{ t: '0', a: 'x,y:z' }]);
  const f = Core.replayHash(lvl, [{ t: '0', a: 'x' }, { t: 'y', a: 'z' }]);
  assert.notEqual(e, f, 'encoding is injective across entry boundaries');
  const g = Core.replayHash(lvl, [null, undefined]);
  assert.equal(typeof g, 'string', 'garbage entries still hash, not crash');
});

test('levelFingerprint covers the board shape, not only its bytes', () => {
  const g = Core.makeGrid(6, 6, T.EMPTY);
  assert.notEqual(
    Core.levelFingerprint(g, 3, 2),
    Core.levelFingerprint(g, 2, 3),
    'same bytes, different shapes must differ'
  );
  assert.equal(
    Core.levelFingerprint(g, 3, 2),
    Core.levelFingerprint(g, 3, 2)
  );
});

test('grid shorter than width*height can never spawn phantom floors', () => {
  const lvl = { width: 3, height: 3, grid: new Uint8Array([1, 4, 1, 1, 0]), shifts: 1 };
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'down');   // index 4 exists, EMPTY
  s = Core.applyAction(lvl, s, 'right');  // index 5 does not: must be a wall
  assert.deepEqual([s.x, s.y], [1, 1], 'out-of-store cells are solid');
  assert.equal(Core.tileAt(lvl, 2, 1), T.WALL);
  lvl.grid = [];
  assert.equal(Core.tileAt(lvl, 1, 1), T.WALL, 'a missing grid is all wall');
});

test('levelFromRows builds playable levels and rejects bad data', () => {
  const lvl = Core.levelFromRows([
    '#####',
    '#S.G#',
    '#####'
  ], { name: 'Hall', shifts: 0 });
  assert.equal(lvl.width, 5);
  assert.equal(lvl.height, 3);
  assert.equal(lvl.baseGrid.length, 15);
  assert.equal(typeof lvl.fingerprint, 'string');
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'right');
  s = Core.applyAction(lvl, s, 'right');
  assert.equal(s.status, 'won');
  assert.throws(() => Core.levelFromRows(['##', '#']), /exactly 2 cells/);
  assert.throws(() => Core.levelFromRows(['#?#']), /unknown character/);
  assert.throws(() => Core.levelFromRows([]), /at least one row/);
  assert.throws(() => Core.levelFromRows(['']), /non-empty/);
});

test('a level with no START spawns on the first walkable tile', () => {
  const lvl = makeLevel(4, 4, [[1, 1, T.WALL], [1, 2, T.EMPTY], [2, 1, T.HAZARD]]);
  delete lvl.shifts;
  const s = Core.initialState(lvl);
  assert.equal(lvl.grid[1 * 4 + 1], T.WALL);
  assert.deepEqual([s.x, s.y], [1, 2], 'wall and hazard tiles are skipped');
});

test('movement matching is case-insensitive', () => {
  const lvl = makeLevel(5, 5, [[2, 2, T.START]]);
  let s = Core.initialState(lvl);
  s = Core.applyAction(lvl, s, 'UP');
  assert.deepEqual([s.x, s.y], [2, 1]);
  s = Core.applyAction(lvl, s, 'Right');
  assert.deepEqual([s.x, s.y], [3, 1]);
});
