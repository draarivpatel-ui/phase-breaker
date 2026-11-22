'use strict';
/* The shared self-test battery: structure, coverage and per-check results. */
const test = require('node:test');
const assert = require('node:assert');
const SelfTest = require('../src/selftest.js');
const { LEVELS } = require('../js/levels.js');

const DEPS = { levels: LEVELS };

test('runAll returns results, passed and failed counts', () => {
  const r = SelfTest.runAll(DEPS);
  assert.ok(Array.isArray(r.results));
  assert.equal(typeof r.passed, 'number');
  assert.equal(typeof r.failed, 'number');
  assert.equal(r.passed + r.failed, r.results.length);
});

test('every check reports id, name and pass flag', () => {
  const r = SelfTest.runAll(DEPS);
  for (const res of r.results) {
    assert.equal(typeof res.id, 'string');
    assert.equal(typeof res.name, 'string');
    assert.equal(typeof res.pass, 'boolean');
    assert.equal(typeof res.detail, 'string');
  }
});

test('check ids are unique', () => {
  const r = SelfTest.runAll(DEPS);
  const ids = r.results.map(x => x.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the battery is fully green in the repo build', () => {
  const r = SelfTest.runAll(DEPS);
  const failed = r.results.filter(x => !x.pass);
  assert.deepEqual(failed.map(x => x.id), [], 'self-test battery must pass clean');
});

test('battery covers the invariant families', () => {
  const r = SelfTest.runAll(DEPS);
  const ids = r.results.map(x => x.id).join(' ');
  for (const prefix of ['rng', 'sha256', 'phys', 'replay', 'design', 'solver', 'audit', 'generator']) {
    assert.ok(ids.includes(prefix), 'covers ' + prefix);
  }
});

test('each shipped level gets its own solvability check', () => {
  const r = SelfTest.runAll(DEPS);
  for (const src of LEVELS) {
    const hit = r.results.find(x => x.id === 'level-' + src.id + '-solvable');
    assert.ok(hit, src.id);
    assert.equal(hit.pass, true);
  }
});

test('runAll tolerates missing LEVELS dep', () => {
  const r = SelfTest.runAll({});
  assert.ok(r.results.length >= 20, 'core checks still run');
  assert.equal(r.results.filter(x => /^level-\d/.test(x.id)).length, 0);
});

test('runAll twice gives identical results', () => {
  const a = SelfTest.runAll(DEPS);
  const b = SelfTest.runAll(DEPS);
  assert.deepEqual(a.results.map(x => x.pass), b.results.map(x => x.pass));
});

test('details carry evidence strings', () => {
  const r = SelfTest.runAll(DEPS);
  for (const res of r.results) {
    assert.ok(res.detail.length > 0, res.id + ' should describe evidence');
  }
});
