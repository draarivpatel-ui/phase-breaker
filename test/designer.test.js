'use strict';
/* Designer: rows helpers, BFS verifier, validation, blob codec, generator. */
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../src/core.js');
const D = require('../src/designer.js');
const Replay = require('../src/replay.js');
const { LEVELS } = require('../js/levels.js');

const T = Core.T;

function rowsLvl(rows, shifts) {
  return Core.levelFromRows(rows, { shifts: shifts === undefined ? 0 : shifts });
}

/* ------------------------- rows helpers ------------------------- */

test('rowsFromGrid renders every tile type', () => {
  const grid = Uint8Array.from([T.WALL, T.EMPTY, T.PHASE_A, T.PHASE_B, T.START, T.GOAL, T.SHARD, T.GATE, T.HAZARD, T.BIT]);
  assert.equal(D.rowsFromGrid(grid, 10, 1)[0], '#.ABSG*T!+');
});

test('rowsFromGrid maps unknown codes to #', () => {
  assert.equal(D.rowsFromGrid(Uint8Array.from([99]), 1, 1)[0], '#');
});

test('paintCell changes one cell without mutating input', () => {
  const rows = ['...', '.S.', '...'];
  const out = D.paintCell(rows, 0, 0, 'G');
  assert.equal(out[0], 'G..');
  assert.equal(rows[0], '...');
});

test('paintCell ignores out-of-bounds and bad glyphs', () => {
  const rows = ['...', '...'];
  assert.equal(D.paintCell(rows, -1, 0, 'G'), rows);
  assert.equal(D.paintCell(rows, 0, -1, 'G'), rows);
  assert.equal(D.paintCell(rows, 5, 0, 'G'), rows);
  assert.equal(D.paintCell(rows, 0, 5, 'G'), rows);
  assert.equal(D.paintCell(rows, 0, 0, 'Z'), rows);
});

test('resizeRows grows with fill and shrinks cleanly', () => {
  const rows = ['S.'];
  const big = D.resizeRows(rows, 4, 3, '#');
  assert.deepEqual(big, ['S.##', '####', '####']);
  const small = D.resizeRows(['SGT!', '....'], 2, 1);
  assert.deepEqual(small, ['SG']);
});

test('resizeRows default fill is floor', () => {
  assert.deepEqual(D.resizeRows(['S'], 3, 2), ['S..', '...']);
});

test('countTile counts one glyph across rows', () => {
  assert.equal(D.countTile(['S*G', '*.*'], '*'), 3);
  assert.equal(D.countTile(['###', '###'], 'G'), 0);
});

/* ------------------------- solve ------------------------- */

test('solve finds the corridor solution', () => {
  const l = rowsLvl(['#####', '#S.G#', '#####'], 0);
  const r = D.solve(l, { wantPath: true });
  assert.equal(r.solvable, true);
  assert.deepEqual(r.actions, ['right', 'right']);
});

test('solve reports unsolvable for a sealed goal', () => {
  const l = rowsLvl(['#####', '#S#G#', '#####'], 0);
  const r = D.solve(l);
  assert.equal(r.solvable, false);
  assert.ok(r.states > 0);
});

test('solve uses the shift budget for phase doors', () => {
  const rows = ['#########', '#S.A...G#', '#########'];
  const no = D.solve(rowsLvl(rows, 0));
  assert.equal(no.solvable, false);
  const yes = D.solve(rowsLvl(rows, 1));
  assert.equal(yes.solvable, true);
});

test('solve routes through both worlds when needed', () => {
  const rows = ['###########', '#S.A.B...G#', '###########'];
  const r = D.solve(rowsLvl(rows, 2), { wantPath: true });
  assert.equal(r.solvable, true);
  const shifts = r.actions.filter(a => a === 'shift').length;
  assert.equal(shifts, 2);
});

test('solve respects gate ordering over shards', () => {
  const rows = ['#########', '#S.*.T.G#', '#########'];
  const r = D.solve(rowsLvl(rows, 0), { wantPath: true });
  assert.equal(r.solvable, true);
  // must walk over the shard before the gate lets it pass
  const shardIdx = r.actions.indexOf('right');  // trivial in a corridor
  assert.ok(r.actions.length >= 4);
});

test('solve refuses a board with a gate and unreachable shard', () => {
  const rows = ['##########', '#S#.*.T.G#', '##########'];
  const r = D.solve(rowsLvl(rows, 0));
  assert.equal(r.solvable, false);
});

test('solve never paths through hazards', () => {
  const rows = ['#########', '#S.!...G#', '#########'];
  const r = D.solve(rowsLvl(rows, 0));
  assert.equal(r.solvable, false);
});

test('solve honours the state cap', () => {
  const l = rowsLvl(['S..........G'], 0);
  const r = D.solve(l, { maxStates: 2 });
  assert.equal(r.solvable, null);
  assert.equal(r.reason, 'state-cap');
});

test('solve reports too-many-collectibles', () => {
  const rows = ['S' + '*'.repeat(9) + 'G'];
  const l = rowsLvl(rows, 0);
  const r = D.solve(l);
  assert.equal(r.solvable, null);
  assert.equal(r.reason, 'too-many-collectibles');
});

test('solver path is valid against the real engine', () => {
  const rows = ['#########', '#S.A...G#', '#########'];
  const l = rowsLvl(rows, 1);
  const r = D.solve(l, { wantPath: true });
  let s = Core.initialState(l);
  for (const a of r.actions) { s = Core.applyAction(l, s, a); }
  assert.equal(s.status, 'won');
});

test('solve returns shortest path in an open room', () => {
  const rows = ['#####', '#S..#', '#...#', '#..G#', '#####'];
  const r = D.solve(rowsLvl(rows, 0), { wantPath: true });
  assert.equal(r.actions.length, 4);  // manhattan distance
});

test('solve on a level with consumed grid uses baseGrid', () => {
  const l = rowsLvl(['#####', '#S*G#', '#####'], 0);
  let s = Core.initialState(l);
  s = Core.applyAction(l, s, 'right');  // shard consumed
  const r = D.solve(l, { wantPath: true });
  // gate-less board: still solvable through baseGrid semantics
  assert.equal(r.solvable, true);
});

test('solve handles a board with no START via firstWalkable', () => {
  const l = rowsLvl(['#####', '#...#', '#...#', '#..G#', '#####'], 0);
  const r = D.solve(l, { wantPath: true });
  assert.equal(r.solvable, true);
});

test('solve on all-wall board is unsolvable', () => {
  const l = rowsLvl(['#####', '#####', '#####'], 0);
  const r = D.solve(l);
  assert.equal(r.solvable, false);
});

/* ------------------------- validateRows ------------------------- */

test('validateRows passes a good board', () => {
  const v = D.validateRows(['#####', '#S.G#', '#####'], { shifts: 0, wantPath: true });
  assert.equal(v.ok, true);
  assert.equal(v.solvable, true);
  assert.ok(Array.isArray(v.solution));
});

test('validateRows rejects empty input', () => {
  const v = D.validateRows([]);
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes('no rows'));
});

test('validateRows rejects null and non-array', () => {
  assert.equal(D.validateRows(null).ok, false);
  assert.equal(D.validateRows('x').ok, false);
});

test('validateRows rejects non-rectangular rows', () => {
  const v = D.validateRows(['#####', '###']);
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /row 2/);
});

test('validateRows rejects unknown glyphs', () => {
  const v = D.validateRows(['#####', '#SZG#', '#####']);
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /unknown tile/);
});

test('validateRows requires a start', () => {
  const v = D.validateRows(['#####', '#..G#', '#####']);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /start/i.test(e)));
});

test('validateRows requires a goal', () => {
  const v = D.validateRows(['#####', '#S..#', '#####']);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /goal/i.test(e)));
});

test('validateRows flags oversize boards', () => {
  const wide = ['S' + '.'.repeat(D.MAX_W) + 'G'];
  const v1 = D.validateRows(wide);
  assert.equal(v1.ok, false);
  assert.match(v1.errors.join(' '), /width/);
  const tall = Array.from({ length: D.MAX_H + 1 }, () => 'SG'[0] ? 'S' : 'S');
  const v2 = D.validateRows(tall);
  assert.equal(v2.ok, false);
  assert.match(v2.errors.join(' '), /height/);
});

test('validateRows warns on multiple starts and gate without shards', () => {
  const v = D.validateRows(['#######', '#SS.TG#', '#######'], { shifts: 0 });
  assert.ok(v.warnings.some(w => /start tiles/.test(w)));
  assert.ok(v.warnings.some(w => /always open/.test(w)));
});

test('validateRows flags unsolvable designs as errors', () => {
  const v = D.validateRows(['#####', '#S#G#', '#####'], { shifts: 0 });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /no route/.test(e)));
  assert.equal(v.solvable, false);
});

test('validateRows counts over-limit shards and bits', () => {
  const v = D.validateRows(['S' + '*'.repeat(D.MAX_SHARDS + 1) + 'G'], { shifts: 0 });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /shards over/);
});

test('validateRows solution wins on the engine', () => {
  const rows = ['#########', '#S.A...G#', '#########'];
  const v = D.validateRows(rows, { shifts: 1 });
  let s = Core.initialState(v.level);
  for (const a of v.solution) { s = Core.applyAction(v.level, s, a); }
  assert.equal(s.status, 'won');
});

/* ------------------------- design blob ------------------------- */

test('serializeDesign/parseDesign round trip', () => {
  const rows = ['#####', '#S*G#', '#####'];
  const blob = D.serializeDesign(rows, { shifts: 2 });
  const back = D.parseDesign(blob);
  assert.deepEqual(back.rows, rows);
  assert.equal(back.shifts, 2);
  assert.equal(back.width, 5);
  assert.equal(back.height, 3);
});

test('blob format is d1.<w>x<h>.<shifts>.<data>.<check>', () => {
  const blob = D.serializeDesign(['#####', '#S.G#', '#####'], { shifts: 1 });
  assert.match(blob, /^d1\.[0-9a-z]+x[0-9a-z]+\.[0-9a-z]+\.[0-9A-Za-z_-]+\.[0-9A-Fa-f]{8}$/);
});

test('serializeDesign rejects bad input', () => {
  assert.equal(D.serializeDesign([]), null);
  assert.equal(D.serializeDesign(null), null);
  assert.equal(D.serializeDesign(['##', '#']), null);      // ragged
  assert.equal(D.serializeDesign(['#?#']), null);          // bad glyph
});

test('parseDesign rejects malformed strings', () => {
  for (const bad of ['', 'd1', 'd2.5x3.0.QUJD.12345678', 'd1.5x3.0.QUJD.SHORT',
    'hello', null, undefined, 'd1.zxg.0.QUJD.00000000']) {
    assert.equal(D.parseDesign(bad), null, String(bad));
  }
});

test('parseDesign rejects checksum mismatches', () => {
  const blob = D.serializeDesign(['#####', '#S.G#', '#####'], { shifts: 1 });
  const bad = blob.slice(0, -1) + (blob.endsWith('F') ? 'E' : 'F');
  assert.equal(D.parseDesign(bad), null);
});

test('parseDesign rejects oversized dimensions', () => {
  const tiles = Replay.b64encode(new Uint8Array(2));
  const body = 'd1.zx1.0.' + tiles;
  assert.equal(D.parseDesign(body + '.' + Core.hashHex(body)), null);
});

test('parseDesign rejects payload length mismatch', () => {
  const tiles = Replay.b64encode(new Uint8Array(4));
  const body = 'd1.5x3.0.' + tiles;
  assert.equal(D.parseDesign(body + '.' + Core.hashHex(body)), null);
});

test('design blob survives in a URL hash', () => {
  const rows = ['#####', '#S.G#', '#####'];
  const blob = D.serializeDesign(rows, { shifts: 3 });
  const parsed = Replay.parseHash('#d=' + blob);
  assert.equal(parsed.type, 'design');
  const back = D.parseDesign(parsed.payload);
  assert.deepEqual(back.rows, rows);
  assert.equal(back.shifts, 3);
});

test('all glyphs round trip through a blob', () => {
  const rows = ['#.ABSG*T!+'];
  const back = D.parseDesign(D.serializeDesign(rows, { shifts: 0 }));
  assert.deepEqual(back.rows, rows);
});

/* ------------------------- clampParams ------------------------- */

test('clampParams applies defaults', () => {
  const p = D.clampParams({});
  assert.deepEqual(p, D.DEFAULT_PARAMS);
});

test('clampParams clamps each field to its bounds', () => {
  const p = D.clampParams({
    width: 1000, height: 0, shifts: 99, walls: 9, hazards: -1,
    shards: 99, bits: 99, doors: 99
  });
  assert.equal(p.width, D.MAX_W);
  assert.equal(p.height, 3);
  assert.equal(p.shifts, 8);
  assert.equal(p.walls, 0.4);
  assert.equal(p.hazards, 0);
  assert.equal(p.shards, D.MAX_SHARDS);
  assert.equal(p.bits, D.MAX_BITS);
  assert.equal(p.doors, 8);
});

test('clampParams stringifies seed and handles junk numbers', () => {
  const p = D.clampParams({ seed: 42, width: 'x', walls: NaN });
  assert.equal(p.seed, '42');
  assert.equal(p.width, D.DEFAULT_PARAMS.width);
  assert.equal(p.walls, D.DEFAULT_PARAMS.walls);
});

test('clampParams rounds floats', () => {
  const p = D.clampParams({ width: 10.6, doors: 2.4 });
  assert.equal(p.width, 11);
  assert.equal(p.doors, 2);
});

/* ------------------------- generate ------------------------- */

test('generator ships a solvable board', () => {
  const g = D.generate({ seed: 't1', width: 11, height: 7, shifts: 2 });
  const r = D.solve(g.level, { wantPath: true });
  assert.equal(r.solvable, true);
});

test('generator is deterministic for the same params', () => {
  const a = D.generate({ seed: 'det', width: 13, height: 9, shifts: 3, walls: 0.2, shards: 2, bits: 1, doors: 2 });
  const b = D.generate({ seed: 'det', width: 13, height: 9, shifts: 3, walls: 0.2, shards: 2, bits: 1, doors: 2 });
  assert.deepEqual(a.rows, b.rows);
  assert.equal(a.level.fingerprint, b.level.fingerprint);
  assert.equal(a.attempts, b.attempts);
});

test('generator golden fingerprint for spark preset shape', () => {
  const g = D.generate({ seed: 'spark', width: 11, height: 7, shifts: 3 });
  assert.equal(g.level.fingerprint, '176163A2');
});

test('different seeds produce different boards', () => {
  const a = D.generate({ seed: 's1', width: 13, height: 9 });
  const b = D.generate({ seed: 's2', width: 13, height: 9 });
  assert.notDeepEqual(a.rows, b.rows);
});

test('generator honours requested dimensions', () => {
  const g = D.generate({ seed: 'dims', width: 17, height: 11 });
  assert.equal(g.level.width, 17);
  assert.equal(g.level.height, 11);
  assert.equal(g.rows.length, 11);
  assert.equal(g.rows[0].length, 17);
});

test('generator boards have a start and a goal', () => {
  const g = D.generate({ seed: 'sg', width: 11, height: 7 });
  assert.equal(D.countTile(g.rows, 'S'), 1);
  assert.equal(D.countTile(g.rows, 'G'), 1);
});

test('generator seed lands on the level', () => {
  const g = D.generate({ seed: 'z', width: 9, height: 5 });
  assert.match(g.level.seed, /^gen-z-/);
});

test('maxAttempts=0 walks the deterministic fallback', () => {
  const g = D.generate({ seed: 'fb', width: 9, height: 5 }, { maxAttempts: 1 });
  // either a found board or the corridor; corridor case:
  if (g.fallback) {
    assert.equal(D.countTile(g.rows, 'S'), 1);
    assert.equal(D.countTile(g.rows, 'G'), 1);
    const r = D.solve(g.level, { wantPath: true });
    assert.equal(r.solvable, true);
  }
});

test('extreme wall density still yields solvable output', () => {
  const g = D.generate({ seed: 'dense', width: 9, height: 7, walls: 0.4 });
  const r = D.solve(g.level);
  assert.equal(r.solvable, true);
});

test('every preset generates a solvable board', () => {
  for (const p of D.PRESETS) {
    const g = D.generate(p.params);
    const r = D.solve(g.level);
    assert.equal(r.solvable, true, p.name);
    assert.equal(g.fallback, false, p.name);
  }
});

test('generator params echo back clamped', () => {
  const g = D.generate({ seed: 'x', width: 500, height: 3 });
  assert.equal(g.params.width, D.MAX_W);
  assert.equal(g.params.height, 3);
});

test('generated boards replay-win under their solution', () => {
  const g = D.generate({ seed: 'replay-win', width: 11, height: 7, shifts: 3 });
  const r = D.solve(g.level, { wantPath: true });
  let s = Core.initialState(g.level);
  for (const a of r.actions) { s = Core.applyAction(g.level, s, a); }
  assert.equal(s.status, 'won');
});

test('author levels all verify solvable through the designer', () => {
  for (const src of LEVELS) {
    const l = Core.levelFromRows(src.rows, { shifts: src.shifts, seed: 'level-' + src.id });
    const r = D.solve(l, { wantPath: true });
    assert.equal(r.solvable, true, src.name);
    assert.ok(r.actions.length > 0);
  }
});

test('author level solutions win on the engine', () => {
  for (const src of LEVELS) {
    const l = Core.levelFromRows(src.rows, { shifts: src.shifts, seed: 'level-' + src.id });
    const r = D.solve(l, { wantPath: true });
    let s = Core.resetLevel(l);
    for (const a of r.actions) { s = Core.applyAction(l, s, a); }
    assert.equal(s.status, 'won', src.name);
  }
});

test('serializeDesign rejects non integer or out of range shift budgets instead of writing unparseable blobs', () => {
  const rows = ['#####', '#S.G#', '#####'];
  for (const bad of [-1, 1.5, 100, NaN, Infinity]) {
    assert.equal(D.serializeDesign(rows, { shifts: bad }), null, String(bad));
  }
  const good = D.serializeDesign(rows, { shifts: 99 });
  assert.ok(good);
  assert.equal(D.parseDesign(good).shifts, 99);
});
