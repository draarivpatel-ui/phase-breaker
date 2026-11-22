/*
 * PhaseBreaker run audit export.
 * Builds a canonical, self-verifying audit object for a finished (or in
 * progress) run: the level identity, the full action list, the resulting
 * state, telemetry counters, and the replay code needed to reproduce it.
 * The fingerprint is the SHA-256 of the canonical JSON, so any byte-level
 * tampering shows up as a different fingerprint.
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

var AUDIT_VERSION = 2;

/* -------------------------------------------------------------------------- */
/* Canonical JSON: sorted object keys, no whitespace ambiguity                */
/* -------------------------------------------------------------------------- */

function canonicalize(v) {
  if (v === null || typeof v === 'number' || typeof v === 'boolean' ||
      typeof v === 'string') {
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    var parts = [];
    for (var i = 0; i < v.length; i++) { parts.push(canonicalize(v[i])); }
    return '[' + parts.join(',') + ']';
  }
  if (typeof v === 'object') {
    var keys = Object.keys(v).sort();
    var kv = [];
    for (var j = 0; j < keys.length; j++) {
      var val = v[keys[j]];
      if (val === undefined || typeof val === 'function') { continue; }
      kv.push(JSON.stringify(keys[j]) + ':' + canonicalize(val));
    }
    return '{' + kv.join(',') + '}';
  }
  return 'null';
}

/* -------------------------------------------------------------------------- */
/* Audit object                                                               */
/* -------------------------------------------------------------------------- */

/*
 * buildAudit({level, levelIndex, levelName, actions, final, telemetry, now})
 *   level      the level object the run was played on
 *   levelIndex index into the shipped levels, or -1 for custom boards
 *   levelName  display name
 *   actions    canonical action list (strings)
 *   final      the state after the last action
 *   telemetry  optional summary object from PBTelemetry
 *   now        optional ISO timestamp injected by the caller
 */
function buildAudit(opts) {
  var level = opts.level;
  var actions = (opts.actions || []).map(function (a) {
    return Replay.canon(a) || String(a);
  });
  var final = Replay.snap(opts.final);
  var audit = {
    audit: 'phase-breaker-run',
    version: AUDIT_VERSION,
    level: {
      index: Number.isInteger(opts.levelIndex) ? opts.levelIndex : -1,
      name: String(opts.levelName != null ? opts.levelName : (level && level.name) || ''),
      seed: String(level && level.seed != null ? level.seed : ''),
      width: level ? level.width : 0,
      height: level ? level.height : 0,
      fingerprint: String(level && level.fingerprint != null ? level.fingerprint : ''),
      shareCode: level ? Core.encodeSeedCode(level.seed, Math.max(0, opts.levelIndex | 0)) : null
    },
    run: {
      actions: actions,
      actionCount: actions.length,
      code: Replay.encodeRun({
        levelIndex: Number.isInteger(opts.levelIndex) ? opts.levelIndex : 0,
        actions: actions
      }),
      replayHash: level ? Core.replayHash(level, actions) : null,
      stateDigest: Replay.stateDigest(final),
      final: final
    },
    telemetry: opts.telemetry || null,
    generatedAt: typeof opts.now === 'string' ? opts.now : null
  };
  audit.fingerprint = fingerprint(audit);
  return audit;
}

// SHA-256 over the canonical JSON of everything except the fingerprint
// field itself. Recompute on any decoded audit to verify integrity.
function fingerprint(audit) {
  var copy = {};
  var keys = Object.keys(audit);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] !== 'fingerprint') { copy[keys[i]] = audit[keys[i]]; }
  }
  return Sha.sha256hex(canonicalize(copy));
}

// Check a parsed audit object: recompute the fingerprint and compare.
function verifyAudit(audit) {
  if (!audit || typeof audit !== 'object' || typeof audit.fingerprint !== 'string') {
    return false;
  }
  return fingerprint(audit) === audit.fingerprint;
}

// Pretty JSON for humans, canonical for hashing. The file stores the pretty
// form; verification always canonicalizes before hashing.
function auditJSON(audit) {
  return JSON.stringify(audit, null, 2) + '\n';
}

var PBAudit = {
  AUDIT_VERSION: AUDIT_VERSION,
  canonicalize: canonicalize,
  buildAudit: buildAudit,
  fingerprint: fingerprint,
  verifyAudit: verifyAudit,
  auditJSON: auditJSON
};

if (typeof module !== 'undefined' && module.exports) { module.exports = PBAudit; }
if (typeof globalThis !== 'undefined' && globalThis.window) { globalThis.window.PBAudit = PBAudit; }
