'use strict';
/* Audit: canonical JSON, fingerprint build/verify, export shape. */
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../src/core.js');
const Replay = require('../src/replay.js');
const Audit = require('../src/audit.js');
const Sha = require('../src/sha256.js');
const { LEVELS } = require('../js/levels.js');

function lvl(i) {
  const src = LEVELS[i];
  return Core.levelFromRows(src.rows, { name: src.name, shifts: src.shifts, seed: 'level-' + src.id });
}

function playAll(l, actions) {
  let s = Core.initialState(l);
  for (const a of actions) { s = Core.applyAction(l, s, a); }
  return s;
}

/* ------------------------- canonicalize ------------------------- */

test('canonicalize sorts object keys', () => {
  assert.equal(Audit.canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(Audit.canonicalize({ z: { y: 1, x: 2 }, a: 0 }), '{"a":0,"z":{"x":2,"y":1}}');
});

test('canonicalize handles scalars and arrays', () => {
  assert.equal(Audit.canonicalize('hi'), '"hi"');
  assert.equal(Audit.canonicalize(42), '42');
  assert.equal(Audit.canonicalize(true), 'true');
  assert.equal(Audit.canonicalize(null), 'null');
  assert.equal(Audit.canonicalize([1, 'a', null]), '[1,"a",null]');
  assert.equal(Audit.canonicalize([]), '[]');
  assert.equal(Audit.canonicalize({}), '{}');
});

test('canonicalize drops undefined and functions', () => {
  assert.equal(Audit.canonicalize({ a: undefined, b: 1, c: function () {} }), '{"b":1}');
});

test('canonicalize of undefined root is null literal', () => {
  assert.equal(Audit.canonicalize(undefined), 'null');
});

test('canonicalize escapes strings like JSON', () => {
  assert.equal(Audit.canonicalize('a"b'), '"a\\"b"');
  assert.equal(Audit.canonicalize('line\n'), '"line\\n"');
});

test('canonicalize is order independent', () => {
  const a = Audit.canonicalize({ x: 1, y: [2, 3], z: { p: 1 } });
  const b = Audit.canonicalize({ z: { p: 1 }, y: [2, 3], x: 1 });
  assert.equal(a, b);
});

/* ------------------------- buildAudit ------------------------- */

function runAudit(opts) {
  const l = lvl(0);
  const actions = opts && opts.actions || ['right', 'right'];
  const final = playAll(l, actions);
  return Audit.buildAudit(Object.assign({
    level: l, levelIndex: 0, levelName: 'Two Doors',
    actions: actions, final: final, now: '2026-11-22T00:00:00Z'
  }, opts));
}

test('audit carries the run identity', () => {
  const a = runAudit();
  assert.equal(a.audit, 'phase-breaker-run');
  assert.equal(a.version, Audit.AUDIT_VERSION);
  assert.equal(a.level.index, 0);
  assert.equal(a.level.name, 'Two Doors');
  assert.equal(a.run.actionCount, 2);
  assert.match(a.run.code, /^r1\./);
});

test('audit fingerprint is 64 hex chars and verifies', () => {
  const a = runAudit();
  assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(Audit.verifyAudit(a), true);
});

test('tampering with any field breaks verification', () => {
  const a = runAudit();
  const mods = [
    { level: Object.assign({}, a.level, { width: 999 }) },
    { run: Object.assign({}, a.run, { actionCount: 3 }) },
    { generatedAt: 'other' },
    { version: 99 }
  ];
  for (const m of mods) {
    const copy = JSON.parse(JSON.stringify(a));
    Object.assign(copy, m);
    assert.equal(Audit.verifyAudit(copy), false, JSON.stringify(Object.keys(m)));
  }
});

test('verifyAudit rejects junk input', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { fingerprint: 5 }, { fingerprint: 'zz' }]) {
    assert.equal(Audit.verifyAudit(bad), false, String(bad));
  }
});

test('audit survives a JSON round trip', () => {
  const a = runAudit();
  const back = JSON.parse(Audit.auditJSON(a));
  assert.equal(Audit.verifyAudit(back), true);
});

test('same run gives same fingerprint', () => {
  const a1 = runAudit();
  const a2 = runAudit();
  assert.equal(a1.fingerprint, a2.fingerprint);
});

test('different actions give different fingerprints', () => {
  const a = runAudit({ actions: ['right', 'right'] });
  const b = runAudit({ actions: ['right', 'left'] });
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('timestamp participates in the fingerprint', () => {
  const a = runAudit();
  const b = runAudit({ now: '2027-01-01T00:00:00Z' });
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('audit embeds stateDigest and replayHash', () => {
  const a = runAudit();
  assert.match(a.run.stateDigest, /^[0-9A-F]{8}$/);
  assert.match(a.run.replayHash, /^[0-9A-F]{8}$/);
});

test('audit run code decodes back to the same actions', () => {
  const actions = ['right', 'shift', 'left'];
  const a = runAudit({ actions });
  const back = Replay.decodeRun(a.run.code);
  assert.deepEqual(back.actions, actions);
});

test('audit snapshot freezes final state fields', () => {
  const a = runAudit();
  for (const k of ['x', 'y', 'phase', 'shardsLeft', 'shifts', 'steps', 'deaths', 'status', 'tick']) {
    assert.ok(k in a.run.final, k);
  }
});

test('audit works for custom boards with index -1', () => {
  const l = Core.levelFromRows(['#####', '#S.G#', '#####'], { shifts: 0, seed: 'custom-1' });
  const final = playAll(l, ['right', 'right']);
  const a = Audit.buildAudit({
    level: l, levelIndex: -1, levelName: 'Custom',
    actions: ['right', 'right'], final: final
  });
  assert.equal(a.level.index, -1);
  assert.equal(Audit.verifyAudit(a), true);
});

test('telemetry block rides along when supplied', () => {
  const a = runAudit({ telemetry: { moves: 2, maxCombo: 2 } });
  assert.equal(a.telemetry.moves, 2);
  assert.equal(Audit.verifyAudit(a), true);
});

test('auditJSON is pretty printed with trailing newline', () => {
  const a = runAudit();
  const j = Audit.auditJSON(a);
  assert.ok(j.endsWith('\n'));
  assert.ok(j.includes('\n  "audit"'));
});

test('fingerprint ignores only the fingerprint field', () => {
  const a = runAudit();
  const again = Audit.fingerprint(a);
  assert.equal(again, a.fingerprint);
  a.fingerprint = 'changed';
  assert.equal(Audit.fingerprint(a), again);
});

test('audit final state matches engine truth', () => {
  const actions = ['right', 'right'];
  const l = lvl(0);
  const final = playAll(l, actions);
  const a = Audit.buildAudit({
    level: l, levelIndex: 0, actions: actions, final: final
  });
  assert.equal(a.run.final.x, final.x);
  assert.equal(a.run.final.status, final.status);
});

test('unknown actions persist as raw strings in audit', () => {
  const a = runAudit({ actions: ['right', 'teleport'] });
  assert.equal(a.run.actions[1], 'teleport');
});

test('canonical audit hash equals sha256 of canonicalize', () => {
  const a = runAudit();
  const copy = Object.assign({}, a);
  delete copy.fingerprint;
  assert.equal(Sha.sha256hex(Audit.canonicalize(copy)), a.fingerprint);
});
