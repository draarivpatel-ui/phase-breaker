/*
 * PhaseBreaker self-test battery.
 * One list of invariant checks that runs identically under `node --test`
 * and inside the page's Run Self-Tests panel. Every check returns
 * {id, name, pass, detail}; nothing here touches the DOM or the network.
 */
'use strict';

var Core = (typeof module !== 'undefined' && module.exports)
  ? require('./core.js')
  : window.PBCore;
var Replay = (typeof module !== 'undefined' && module.exports)
  ? require('./replay.js')
  : window.PBReplay;
var Sha = (typeof module !== 'undefined' && module.exports)
  ? require('./sha256.js')
  : window.PBSha256;
var Designer = (typeof module !== 'undefined' && module.exports)
  ? require('./designer.js')
  : window.PBDesigner;
var Audit = (typeof module !== 'undefined' && module.exports)
  ? require('./audit.js')
  : window.PBAudit;

var T = Core.T, PHASE = Core.PHASE;

function bench(w, h, placements, shifts) {
  var grid = Core.makeGrid(w, h, T.EMPTY);
  for (var x = 0; x < w; x++) { grid[x] = T.WALL; grid[(h - 1) * w + x] = T.WALL; }
  for (var y = 0; y < h; y++) { grid[y * w] = T.WALL; grid[y * w + w - 1] = T.WALL; }
  for (var i = 0; i < placements.length; i++) {
    grid[placements[i][1] * w + placements[i][0]] = placements[i][2];
  }
  return { width: w, height: h, grid: grid, seed: 'selftest', shifts: shifts };
}

/*
 * deps: {levels} optionally the shipped LEVELS array so the battery can
 * prove every shipped board solvable. Returns {results, passed, failed}.
 */
function runAll(deps) {
  var d = deps || {};
  var checks = [];
  function check(id, name, fn) {
    var res = { id: id, name: name, pass: false, detail: '' };
    try {
      var out = fn();
      res.pass = out === true || (out && out.pass === true);
      res.detail = (out && out.detail) || '';
    } catch (err) {
      res.pass = false;
      res.detail = 'threw: ' + (err && err.message);
    }
    checks.push(res);
  }

  check('rng-same-seed', 'Same seed, same stream', function () {
    var a = Core.makeRNG(7), b = Core.makeRNG(7);
    for (var i = 0; i < 25; i++) {
      if (a.next() !== b.next()) { return { pass: false, detail: 'diverged at ' + i }; }
    }
    return { pass: true, detail: '25 values identical' };
  });

  check('rng-distinct', 'Different seeds diverge', function () {
    return { pass: Core.makeRNG('alpha').next() !== Core.makeRNG('beta').next(),
      detail: 'first values differ' };
  });

  check('hash-stable', 'FNV-1a hash is stable', function () {
    return { pass: Core.fnv1a('phase-breaker') === Core.fnv1a('phase-breaker') &&
      Core.hashHex('x').length === 8, detail: 'repeatable 8 hex chars' };
  });

  check('sha256-empty', 'SHA-256 empty vector', function () {
    return { pass: Sha.sha256hex('') ===
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      detail: 'matches FIPS 180-4' };
  });

  check('sha256-abc', 'SHA-256 abc vector', function () {
    return { pass: Sha.sha256hex('abc') ===
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      detail: 'matches FIPS 180-4' };
  });

  check('sha256-stream', 'SHA-256 chunked equals one-shot', function () {
    var s = new Sha.Sha256();
    var msg = 'phase breaker audit payload 0123456789';
    for (var i = 0; i < msg.length; i++) { s.update(msg.charAt(i)); }
    return { pass: s.hex() === Sha.sha256hex(msg), detail: 'byte-at-a-time matches' };
  });

  check('seed-code', 'Seed code round trip', function () {
    var c = Core.encodeSeedCode(305419896, 2);
    var back = Core.decodeSeedCode(c);
    return { pass: back && back.seed === 305419896 && back.levelIndex === 2,
      detail: c };
  });

  check('phys-bump', 'Wall bump still spends the turn', function () {
    var lvl = bench(5, 5, [[1, 1, T.START]], 0);
    var s = Core.initialState(lvl);
    var s2 = Core.applyAction(lvl, s, 'left');
    return { pass: s2.x === 1 && s2.tick === 1 && s2.steps === 1,
      detail: 'tick spent, position held' };
  });

  check('phys-denied-shift', 'Denied shift still spends the turn', function () {
    var lvl = bench(5, 5, [[1, 1, T.START]], 0);
    var s = Core.initialState(lvl);
    var s2 = Core.applyAction(lvl, s, 'shift');
    return { pass: s2.phase === PHASE.ALPHA && s2.tick === 1 && s2.shifts === 0,
      detail: 'no charge, turn spent' };
  });

  check('phys-free-noop', 'Unknown actions are free', function () {
    var lvl = bench(5, 5, [[1, 1, T.START]], 0);
    var s = Core.initialState(lvl);
    var s2 = Core.applyAction(lvl, s, 'teleport');
    return { pass: s2.tick === 0 && s2.steps === 0, detail: 'no tick, no step' };
  });

  check('phys-gate', 'Gate holds until every shard is home', function () {
    var lvl = bench(7, 5, [[1, 1, T.START], [5, 3, T.SHARD], [2, 1, T.GATE]], 0);
    var s = Core.initialState(lvl);
    var s2 = Core.applyAction(lvl, s, 'right');
    return { pass: s2.x === 1 && s2.status === 'playing',
      detail: 'gate blocked at one shard left' };
  });

  check('phys-hazard', 'Hazards end the run', function () {
    var lvl = bench(5, 5, [[1, 1, T.START], [2, 1, T.HAZARD]], 0);
    var s = Core.initialState(lvl);
    var s2 = Core.applyAction(lvl, s, 'right');
    return { pass: s2.status === 'dead' && s2.deaths === 1,
      detail: 'dead on contact' };
  });

  check('phys-bit', 'Bit tiles grant a shift charge', function () {
    var lvl = bench(5, 5, [[1, 1, T.START], [2, 1, T.BIT]], 0);
    var s = Core.initialState(lvl);
    var s2 = Core.applyAction(lvl, s, 'right');
    return { pass: s2.shifts === 1, detail: 'one charge banked' };
  });

  check('replay-codec', 'Replay code round trips', function () {
    var acts = ['up', 'shift', 'left', 'wait', 'right', 'down', 'shift'];
    var code = Replay.encodeRun({ levelIndex: 1, actions: acts });
    var back = Replay.decodeRun(code);
    var same = back && back.actions.length === acts.length &&
      back.actions.every(function (a, i) { return a === acts[i]; });
    return { pass: same && back.levelIndex === 1, detail: code };
  });

  check('replay-determinism', 'Replay is frame identical', function () {
    var rows = ['#######', '#S.*.G#', '#######'];
    var mk = function () {
      return Core.levelFromRows(rows, { shifts: 0, seed: 'st' });
    };
    var acts = ['right', 'right', 'up', 'right', 'right'];
    var simA = Replay.simulate(mk(), acts);
    var simB = Replay.simulate(mk(), acts);
    return { pass: simA.digest === simB.digest &&
      simA.final.status === 'won', detail: 'digest ' + simA.digest };
  });

  check('replay-tamper', 'Corrupt share codes are rejected', function () {
    var code = Replay.encodeRun({ levelIndex: 0, actions: ['up', 'left'] });
    var bad = code.slice(0, code.length - 9) + 'z' + code.slice(code.length - 8);
    return { pass: Replay.decodeRun(bad) === null, detail: 'checksum caught it' };
  });

  check('design-codec', 'Design blob round trips', function () {
    var rows = ['#####', '#S*G#', '#####'];
    var blob = Designer.serializeDesign(rows, { shifts: 2 });
    var back = Designer.parseDesign(blob);
    return { pass: back && back.rows.join('|') === rows.join('|') &&
      back.shifts === 2, detail: 'rows identical' };
  });

  check('solver-found', 'Verifier routes a corridor', function () {
    var lvl = Core.levelFromRows(['#####', '#S.G#', '#####'], { shifts: 0 });
    var res = Designer.solve(lvl, { wantPath: true });
    return { pass: res.solvable === true && res.actions.join(',') === 'right,right',
      detail: res.actions ? res.actions.join(' ') : 'none' };
  });

  check('solver-refuses', 'Verifier refuses a sealed goal', function () {
    var lvl = Core.levelFromRows(['#####', '#S#G#', '#####'], { shifts: 0 });
    return { pass: Designer.solve(lvl).solvable === false,
      detail: 'no route found' };
  });

  check('audit-verify', 'Audit fingerprint verifies and detects tamper', function () {
    var lvl = Core.levelFromRows(['#####', '#S.G#', '#####'], { shifts: 0, seed: 'st' });
    var st = Core.initialState(lvl);
    st = Core.applyAction(lvl, st, 'right');
    var a = Audit.buildAudit({ level: lvl, levelIndex: 0, actions: ['right'], final: st });
    var okMine = Audit.verifyAudit(a);
    var parsed = JSON.parse(Audit.auditJSON(a));
    var okParsed = Audit.verifyAudit(parsed);
    parsed.run.final.steps = 999;
    var caught = !Audit.verifyAudit(parsed);
    return { pass: okMine && okParsed && caught,
      detail: 'fingerprint ' + a.fingerprint.slice(0, 12) + '...' };
  });

  check('generator', 'Generator ships only solvable boards', function () {
    var g = Designer.generate({ seed: 'selftest', width: 9, height: 7, shifts: 3, shards: 1, bits: 1, doors: 2 });
    var v = Designer.validateRows(g.rows, { shifts: 3 });
    return { pass: v.ok && v.solvable === true,
      detail: g.attempts + ' attempt(s)' };
  });

  if (d.levels && d.levels.length) {
    for (var li = 0; li < d.levels.length; li++) {
      (function (src) {
        check('level-' + src.id + '-solvable',
          'Level ' + src.id + ' (' + src.name + ') is solvable', function () {
            var lvl = Core.levelFromRows(src.rows, {
              name: src.name, shifts: src.shifts, seed: 'level-' + src.id });
            var res = Designer.solve(lvl);
            return { pass: res.solvable === true,
              detail: res.states + ' states searched' };
          });
      })(d.levels[li]);
    }
  }

  var passed = 0;
  for (var i = 0; i < checks.length; i++) { if (checks[i].pass) { passed++; } }
  return { results: checks, passed: passed, failed: checks.length - passed };
}

var PBSelfTest = { runAll: runAll };

if (typeof module !== 'undefined' && module.exports) { module.exports = PBSelfTest; }
if (typeof globalThis !== 'undefined' && globalThis.window) { globalThis.window.PBSelfTest = PBSelfTest; }
