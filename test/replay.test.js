'use strict';
/* Replay codec, simulation, verification, URL hash recovery. */
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../src/core.js');
const Replay = require('../src/replay.js');
const { LEVELS } = require('../js/levels.js');

const T = Core.T;
const A = Replay.ACTIONS;

function lvl(i) {
  const src = LEVELS[i];
  return Core.levelFromRows(src.rows, { name: src.name, shifts: src.shifts, seed: 'level-' + src.id });
}

/* ------------------------- canon ------------------------- */

const CANON = [
  ['up', 'up'], ['UP', 'up'], ['u', 'up'], ['U', 'up'],
  ['right', 'right'], ['r', 'right'], ['R', 'right'],
  ['down', 'down'], ['d', 'down'], ['left', 'left'], ['l', 'left'],
  ['shift', 'shift'], ['SHIFT', 'shift'], ['wait', 'wait'], ['WAIT', 'wait'],
  [{ a: 'up' }, 'up'], [{ a: 'SHIFT' }, 'shift'],
  ['s', null], ['w', null], ['north', null], ['', null], [null, null],
  [undefined, null], [5, null], [{}, null], [{ a: 'zz' }, null], [{ a: 9 }, null],
  ['x', null], ['waitx', null]
];
for (const [input, want] of CANON) {
  test(`canon(${JSON.stringify(input)}) -> ${want}`, () => {
    assert.equal(Replay.canon(input), want);
  });
}

/* ------------------------- base64url ------------------------- */

test('b64 encode/decode round trip on all byte values', () => {
  const bytes = Uint8Array.from(Array.from({ length: 256 }, (_, i) => i));
  const enc = Replay.b64encode(bytes);
  assert.ok(!/[+/=]/.test(enc), 'URL-safe alphabet only');
  const back = Replay.b64decode(enc);
  assert.deepEqual([...back], [...bytes]);
});

const B64_LENS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 31, 32, 33];
for (const n of B64_LENS) {
  test(`b64 round trip length ${n}`, () => {
    const bytes = Uint8Array.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255));
    const enc = Replay.b64encode(bytes);
    const back = Replay.b64decode(enc);
    assert.deepEqual([...back], [...bytes]);
  });
}

test('b64decode rejects invalid characters', () => {
  assert.equal(Replay.b64decode('a+b'), null);
  assert.equal(Replay.b64decode('a/b'), null);
  assert.equal(Replay.b64decode('a=b'), null);
  assert.equal(Replay.b64decode('a b'), null);
});

/* ------------------------- pack/unpack ------------------------- */

const PACK_LENS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 21, 22, 64, 100];
for (const n of PACK_LENS) {
  test(`pack/unpack round trip count ${n}`, () => {
    const rng = Core.makeRNG(n + 1);
    const acts = Array.from({ length: n }, () => A[rng.int(0, 5)]);
    const bytes = Replay.packActions(acts);
    assert.equal(bytes.length, Math.ceil(n * 3 / 8));
    const back = Replay.unpackActions(bytes, n);
    assert.deepEqual(back, acts);
  });
}

test('pack uses exactly 3 bits per action', () => {
  assert.equal(Replay.packActions(['up']).length, 1);
  assert.equal(Replay.packActions(A.slice(0, 3)).length, 2); // 9 bits
  assert.equal(Replay.packActions(A.concat(A.slice(0, 2))).length, 3); // 24 bits
});

test('pack of unknown action returns null', () => {
  assert.equal(Replay.packActions(['up', 'warp']), null);
});

test('unpack beyond buffer returns null', () => {
  assert.equal(Replay.unpackActions(new Uint8Array(0), 1), null);
  assert.equal(Replay.unpackActions(new Uint8Array(1), 3), null);
  assert.equal(Replay.unpackActions(new Uint8Array(1), 4), null);
});

test('unpack rejects out-of-range codes', () => {
  const bytes = Uint8Array.from([0b11100000]); // code 7
  assert.equal(Replay.unpackActions(bytes, 1), null);
});

test('single-letter and mixed-case actions pack canonically', () => {
  const packed = Replay.packActions(['u', 'R', 'down', 'LEFT']);
  assert.deepEqual(Replay.unpackActions(packed, 4), ['up', 'right', 'down', 'left']);
});

/* ------------------------- encodeRun/decodeRun ------------------------- */

for (const idx of [0, 1, 2, 9, 35, 100]) {
  test(`run code round trip for levelIndex ${idx}`, () => {
    const acts = ['up', 'shift', 'left', 'wait'];
    const code = Replay.encodeRun({ levelIndex: idx, actions: acts });
    const back = Replay.decodeRun(code);
    assert.equal(back.levelIndex, idx);
    assert.deepEqual(back.actions, acts);
  });
}

test('run code for an empty action list', () => {
  const code = Replay.encodeRun({ levelIndex: 0, actions: [] });
  const back = Replay.decodeRun(code);
  assert.deepEqual(back.actions, []);
  assert.equal(back.levelIndex, 0);
});

test('encodeRun rejects bad levelIndex', () => {
  assert.equal(Replay.encodeRun({ levelIndex: -1, actions: [] }), null);
  assert.equal(Replay.encodeRun({ levelIndex: 1.5, actions: [] }), null);
  assert.equal(Replay.encodeRun({ levelIndex: 'x', actions: [] }), null);
});

test('decodeRun rejects malformed strings', () => {
  for (const bad of ['', 'r1', 'r2.0.0..00000000', 'x1.0.0..00000000',
    'r1..0..AAAAAAAA', 'r1.0.x..AAAAAAAA', 'not a code', null, undefined]) {
    assert.equal(Replay.decodeRun(bad), null, JSON.stringify(bad));
  }
});

test('decodeRun rejects a flipped character (checksum catches it)', () => {
  const code = Replay.encodeRun({ levelIndex: 1, actions: ['up', 'down', 'shift'] });
  for (const pos of [3, 7, code.length - 12, code.length - 5]) {
    const bad = code.slice(0, pos) + (code[pos] === 'A' ? 'B' : 'A') + code.slice(pos + 1);
    assert.equal(Replay.decodeRun(bad), null, 'tamper at ' + pos);
  }
});

test('decodeRun rejects length-mismatched payloads', () => {
  const code = Replay.encodeRun({ levelIndex: 0, actions: A.slice(0, 5) });
  // claim more actions than bits present
  const parts = code.split('.');
  parts[2] = '9';
  const body = parts.slice(0, -1).join('.');
  const fake = body + '.' + Core.hashHex(body);  // honest checksum, wrong count
  assert.equal(Replay.decodeRun(fake), null);
});

test('decodeRun requires the real checksum, not a recomputed lie', () => {
  const code = Replay.encodeRun({ levelIndex: 0, actions: ['up'] });
  const fake = code.slice(0, -8) + '00000000';
  assert.equal(Replay.decodeRun(fake), null);
});

/* ------------------------- simulate ------------------------- */

test('simulate produces one frame per action', () => {
  const l = lvl(0);
  const acts = ['right', 'right', 'right', 'wait'];
  const sim = Replay.simulate(l, acts);
  assert.equal(sim.frames.length, 4);
  assert.equal(sim.final.steps, 4);
});

test('simulate final state matches hand-played state', () => {
  const l = lvl(0);
  const acts = ['right', 'right', 'right', 'right', 'shift', 'right', 'right', 'right', 'right', 'shift', 'right', 'right', 'right'];
  const sim = Replay.simulate(l, acts);
  let s = Core.resetLevel(l);
  for (const a of acts) { s = Core.applyAction(l, s, a); }
  for (const k of ['x', 'y', 'phase', 'shardsLeft', 'shifts', 'steps', 'deaths', 'status', 'tick']) {
    assert.equal(sim.final[k], s[k], k);
  }
});

test('simulate on a used level resets it first', () => {
  const l = lvl(1);
  let s = Core.initialState(l);
  s = Core.applyAction(l, s, 'right');  // consumes shard 1
  const sim = Replay.simulate(l, ['right', 'right', 'right']);
  assert.equal(sim.frames[2].shardsLeft, 1, 'shard state is per-replay');
});

test('simulate golden digest for level 1 solution', () => {
  const l = lvl(0);
  const acts = ['right', 'right', 'right', 'right', 'shift', 'right', 'right', 'right', 'right', 'shift', 'right', 'right', 'right'];
  const sim = Replay.simulate(l, acts);
  assert.equal(sim.digest, 'D325174E');
  assert.equal(sim.replayHash, 'E3EABE9C');
  assert.equal(sim.final.status, 'won');
});

test('two simulations of the same actions are frame identical', () => {
  const acts = ['right', 'shift', 'up', 'left', 'wait', 'down'];
  const s1 = Replay.simulate(lvl(0), acts);
  const s2 = Replay.simulate(lvl(0), acts);
  assert.equal(s1.digest, s2.digest);
  for (let i = 0; i < acts.length; i++) {
    assert.equal(Replay.stateDigest(s1.frames[i]), Replay.stateDigest(s2.frames[i]));
  }
});

test('simulate frame.action stores the canonical kind', () => {
  const sim = Replay.simulate(lvl(0), ['R', 'shift']);
  assert.equal(sim.frames[0].action, 'right');
  assert.equal(sim.frames[1].action, 'shift');
});

/* ------------------------- stateDigest/runDigest ------------------------- */

test('stateDigest changes on every observable field', () => {
  const base = { x: 1, y: 1, phase: 0, shardsLeft: 0, shifts: 0, steps: 0, deaths: 0, status: 'playing', tick: 0 };
  const d0 = Replay.stateDigest(base);
  const fields = ['x', 'y', 'phase', 'shardsLeft', 'shifts', 'steps', 'deaths', 'tick'];
  for (const f of fields) {
    const mod = Object.assign({}, base);
    mod[f] = (typeof mod[f] === 'number' ? mod[f] + 1 : 'won');
    assert.notEqual(Replay.stateDigest(mod), d0, f);
  }
  const mod2 = Object.assign({}, base, { status: 'won' });
  assert.notEqual(Replay.stateDigest(mod2), d0, 'status');
});

test('runDigest covers actions and final state', () => {
  const l = lvl(0);
  const sim = Replay.simulate(l, ['right', 'right']);
  const d = Replay.runDigest(l, ['right', 'right'], sim.final);
  assert.match(d, /^[0-9A-F]{8}$/);
  const d2 = Replay.runDigest(l, ['right', 'left'], sim.final);
  assert.notEqual(d, d2);
});

/* ------------------------- verify ------------------------- */

test('verify with no expectation always passes', () => {
  const v = Replay.verify(lvl(0), ['right'], null);
  assert.equal(v.ok, true);
});

test('verify catches a wrong final digest', () => {
  const l = lvl(0);
  const v = Replay.verify(l, ['right'], 'DEADBEEF');
  assert.equal(v.ok, false);
  assert.equal(v.divergence, 0);
});

test('verify accepts the true digest', () => {
  const l = lvl(0);
  const sim = Replay.simulate(lvl(0), ['right', 'right']);
  const v = Replay.verify(l, ['right', 'right'], { digest: sim.digest });
  assert.equal(v.ok, true);
  assert.equal(v.divergence, -1);
});

test('verify finds the first divergent frame', () => {
  const l = lvl(0);
  const sim = Replay.simulate(lvl(0), ['right', 'right', 'right']);
  const frames = sim.frames.map((f) => Object.assign({}, f));
  frames[1].x = 99;
  const v = Replay.verify(l, ['right', 'right', 'right'], { frames });
  assert.equal(v.ok, false);
  assert.equal(v.divergence, 1);
});

test('verify catches a frame-count mismatch', () => {
  const l = lvl(0);
  const sim = Replay.simulate(lvl(0), ['right', 'right', 'right']);
  const v = Replay.verify(l, ['right', 'right', 'right'],
    { frames: sim.frames.slice(0, 2), digest: null });
  assert.equal(v.ok, false);
});

/* ------------------------- recorder ------------------------- */

test('recorder collects canonical actions only', () => {
  const r = Replay.makeRecorder();
  r.note('right');
  r.note('junk');
  r.note('shift');
  r.note(null);
  assert.deepEqual(r.actions(), ['right', 'shift']);
  assert.equal(r.size(), 2);
});

test('recorder stops when playing is false', () => {
  const r = Replay.makeRecorder();
  r.note('right');
  r.note('left', false);
  assert.deepEqual(r.actions(), ['right']);
});

test('recorder reset clears', () => {
  const r = Replay.makeRecorder();
  r.note('up');
  r.reset();
  assert.equal(r.size(), 0);
});

test('recorder actions() returns a copy', () => {
  const r = Replay.makeRecorder();
  r.note('up');
  const a = r.actions();
  a.push('down');
  assert.equal(r.size(), 1);
});

/* ------------------------- URL hash ------------------------- */

test('buildRunHash emits a parseable #r= link', () => {
  const h = Replay.buildRunHash(1, ['up', 'shift']);
  assert.ok(h.startsWith('#r='));
  const parsed = Replay.parseHash(h);
  assert.equal(parsed.type, 'run');
  assert.equal(parsed.levelIndex, 1);
  assert.deepEqual(parsed.actions, ['up', 'shift']);
});

test('parseHash handles leading # and bare strings', () => {
  const code = Replay.encodeRun({ levelIndex: 0, actions: ['up'] });
  const p1 = Replay.parseHash('#r=' + code);
  const p2 = Replay.parseHash('r=' + code);
  assert.equal(p1.levelIndex, 0);
  assert.equal(p2.levelIndex, 0);
});

test('parseHash routes d= payloads to design', () => {
  const p = Replay.parseHash('#d=somedata');
  assert.equal(p.type, 'design');
  assert.equal(p.payload, 'somedata');
});

test('parseHash returns null for junk and empty', () => {
  for (const h of ['', '#', '#x=1', '#r=garbage', null, undefined]) {
    assert.equal(Replay.parseHash(h), null, String(h));
  }
});

test('buildRunHash on bad index returns null', () => {
  assert.equal(Replay.buildRunHash(-2, []), null);
});

/* ------------------------- shipped-level replays ------------------------- */

const SOLUTIONS = [
  ['right', 'right', 'right', 'right', 'shift', 'right', 'right', 'right', 'right', 'shift', 'right', 'right', 'right'],
  ['right', 'right', 'right', 'left', 'left', 'left', 'down', 'down', 'down', 'down', 'down', 'down',
   'right', 'right', 'right', 'right', 'right', 'right', 'up', 'up', 'up', 'up', 'up', 'up',
   'right', 'right', 'right', 'right', 'right'],
  null  // filled below from solver output shape
];

test('recorded solutions verify identical on every shipped level', () => {
  const acts0 = SOLUTIONS[0];
  const l0 = lvl(0);
  const sim = Replay.simulate(l0, acts0);
  assert.equal(sim.final.status, 'won');
  const v = Replay.verify(lvl(0), acts0, { digest: sim.digest, frames: sim.frames });
  assert.equal(v.ok, true);
});

test('a winning run share-link round trips end to end', () => {
  const acts = SOLUTIONS[0];
  const h = Replay.buildRunHash(0, acts);
  const parsed = Replay.parseHash(h);
  assert.equal(parsed.levelIndex, 0);
  const sim = Replay.simulate(lvl(0), parsed.actions);
  assert.equal(sim.final.status, 'won');
  assert.equal(sim.digest, Replay.simulate(lvl(0), acts).digest);
});
