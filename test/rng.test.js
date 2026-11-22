'use strict';
/*
 * Determinism contract for the RNG: golden streams for fixed seeds so any
 * drift in mulberry32 is caught, plus range and distribution coverage.
 */
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../src/core.js');

const GOLDEN = [
  [0, 0.26642920868471265, 0.00032974570058286190, 0.22327202744781971],
  [1, 0.62707394058816135, 0.0027357211802154779, 0.52744703995995224],
  [42, 0.60110375192016363, 0.44829055899754167, 0.85246579349040985],
  [1337, 0.18441183259710670, 0.18998925131745636, 0.81047199224121869],
  [4294967295, 0.89642261411063373, 0.18947825673967600, 0.71565267816185951]
];

for (const [seed, a, b, c] of GOLDEN) {
  test(`golden stream for seed ${seed}`, () => {
    const r = Core.makeRNG(seed);
    assert.equal(r.next(), a);
    assert.equal(r.next(), b);
    assert.equal(r.next(), c);
  });
}

test('hashSeed golden values pin the seed mapping', () => {
  assert.equal(Core.hashSeed('spark'), 4150380386);
  assert.equal(Core.hashSeed('test'), 213109693);
});

test('fnv1a golden value for the project name', () => {
  assert.equal(Core.fnv1a('phase-breaker'), 130460661);
});

test('same string seed always builds the same stream', () => {
  for (const word of ['alpha', 'beta', 'sparkathon', 'level-99']) {
    const a = Core.makeRNG(word);
    const b = Core.makeRNG(word);
    for (let i = 0; i < 20; i++) { assert.equal(a.next(), b.next(), word); }
  }
});

test('numeric seeds equal their uint32 normalization', () => {
  const a = Core.makeRNG(4294967296 + 5);   // wraps to 5
  const b = Core.makeRNG(5);
  assert.equal(a.next(), b.next());
});

test('streams diverge for adjacent seeds', () => {
  const vals = new Set();
  for (let s = 0; s < 20; s++) { vals.add(Core.makeRNG(s).next()); }
  assert.equal(vals.size, 20, 'twenty seeds, twenty distinct first values');
});

const RANGES = [[1, 6], [0, 1], [3, 9], [-5, -1], [10, 100], [0, 0], [-3, 3]];
for (const [lo, hi] of RANGES) {
  test(`int stays inside [${lo},${hi}]`, () => {
    const r = Core.makeRNG(lo * 31 + hi);
    for (let i = 0; i < 200; i++) {
      const v = r.int(lo, hi);
      assert.ok(v >= lo && v <= hi && Number.isInteger(v), `${v} in [${lo},${hi}]`);
    }
  });
}

test('int covers both extremes of a small range', () => {
  const r = Core.makeRNG(7);
  const seen = new Set();
  for (let i = 0; i < 300; i++) { seen.add(r.int(0, 2)); }
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});

test('pick returns only members and hits every one', () => {
  const r = Core.makeRNG(13);
  const pool = ['a', 'b', 'c', 'd'];
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const v = r.pick(pool);
    assert.ok(pool.includes(v));
    seen.add(v);
  }
  assert.equal(seen.size, 4);
});

test('chance near 0.5 lands both ways across draws', () => {
  const r = Core.makeRNG(21);
  let t = 0;
  for (let i = 0; i < 200; i++) { if (r.chance(0.5)) { t++; } }
  assert.ok(t > 60 && t < 140, `p=0.5 split should be roughly even, got ${t}`);
});

test('shuffle preserves the multiset on a big array', () => {
  const arr = Array.from({ length: 52 }, (_, i) => i);
  const out = Core.makeRNG(99).shuffle(arr.slice(0));
  assert.equal(out.length, 52);
  assert.deepEqual(out.slice(0).sort((a, b) => a - b), arr);
});

test('shuffle is deterministic and usually nontrivial', () => {
  const arr = Array.from({ length: 10 }, (_, i) => i);
  const a = Core.makeRNG(4).shuffle(arr.slice(0));
  const b = Core.makeRNG(4).shuffle(arr.slice(0));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, arr, 'a shuffled deck should differ from sorted');
});

test('next stays in [0,1) over a long stream', () => {
  const r = Core.makeRNG(2026);
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, v);
  }
});

test('negative seeds normalize through uint32', () => {
  const a = Core.makeRNG(-1);
  const b = Core.makeRNG(4294967295);
  assert.equal(a.next(), b.next());
});
