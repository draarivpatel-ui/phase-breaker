/*
 * PhaseBreaker deterministic run recorder and replay codec.
 *
 * A recorded run is just the level index plus the list of canonical actions
 * the player took. The core is fully deterministic, so replaying those
 * actions on a fresh level reproduces every frame. This module packs that
 * list into a compact URL-safe string (3 bits per action), verifies a
 * replay frame for frame, and produces the digests the audit exporter and
 * the in-page verifier show.
 *
 * Run string format:
 *   r1.<levelIndex36>.<actionCount36>.<base64url bits>.<checksum8>
 * The checksum is the FNV-1a hex of everything before it, so any corrupted
 * share link is rejected before a single action is decoded.
 */
'use strict';

var Core = (typeof module !== 'undefined' && module.exports)
  ? require('./core.js')
  : window.PBCore;

/* -------------------------------------------------------------------------- */
/* Action codes                                                               */
/* -------------------------------------------------------------------------- */

// Canonical kinds in a stable order. The first four mirror Core.DIRS.
var ACTIONS = ['up', 'right', 'down', 'left', 'shift', 'wait'];
var CODE_OF = { up: 0, right: 1, down: 2, left: 3, shift: 4, wait: 5 };

// Resolve any accepted spelling to a canonical kind, or null when the core
// would treat it as a free no-op. Mirrors applyAction's resolution exactly:
// full names and single letters are case-insensitive; 'shift' and 'wait'
// match whole words only (a bare 's' or 'w' is a direction attempt, and 'w'
// resolves to nothing since no direction starts with it... except 'wait'
// which the core checks before directions, so single letters for shift and
// wait are NOT recognised there. Keep the same behaviour here).
function canon(action) {
  var kind = typeof action === 'string' ? action : (action && action.a);
  if (typeof kind !== 'string') { return null; }
  kind = kind.toLowerCase();
  if (kind === 'shift' || kind === 'wait') { return kind; }
  for (var i = 0; i < ACTIONS.length - 2; i++) {
    if (ACTIONS[i] === kind || ACTIONS[i].charAt(0) === kind) { return ACTIONS[i]; }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Base64url (no padding, URL and hash safe)                                  */
/* -------------------------------------------------------------------------- */

var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
var B64_REV = (function () {
  var t = {};
  for (var i = 0; i < B64.length; i++) { t[B64.charAt(i)] = i; }
  return t;
})();

function b64encode(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i];
    var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64.charAt(a >> 2) +
      B64.charAt(((a & 3) << 4) | (b >> 4));
    if (i + 1 < bytes.length) {
      out += B64.charAt(((b & 15) << 2) | (c >> 6));
    }
    if (i + 2 < bytes.length) {
      out += B64.charAt(c & 63);
    }
  }
  return out;
}

function b64decode(str) {
  var s = String(str);
  var out = [];
  var acc = 0;
  var bits = 0;
  for (var i = 0; i < s.length; i++) {
    var v = B64_REV[s.charAt(i)];
    if (v === undefined) { return null; }
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 0xff);
    }
  }
  // Leftover bits must all be zero padding, otherwise the string was cut.
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) { return null; }
  return Uint8Array.from(out);
}

/* -------------------------------------------------------------------------- */
/* Bit packing: 3 bits per action                                             */
/* -------------------------------------------------------------------------- */

function packActions(actions) {
  var n = actions.length;
  var bytes = new Uint8Array(Math.ceil(n * 3 / 8));
  var bitPos = 0;
  for (var i = 0; i < n; i++) {
    var code = CODE_OF[canon(actions[i])];
    if (code === undefined) { return null; }
    var bytePos = bitPos >> 3;
    var off = bitPos & 7;          // starting bit index inside the byte, MSB first
    if (off <= 5) {
      bytes[bytePos] |= code << (5 - off);
    } else if (off === 6) {
      // 2 bits here, 1 bit at the top of the next byte
      bytes[bytePos] |= code >>> 1;
      bytes[bytePos + 1] |= (code & 1) << 7;
    } else {
      // off === 7: 1 bit here, 2 bits at the top of the next byte
      bytes[bytePos] |= code >>> 2;
      bytes[bytePos + 1] |= (code & 3) << 6;
    }
    bitPos += 3;
  }
  return bytes;
}

function unpackActions(bytes, count) {
  if (!bytes || bytes.length * 8 < count * 3) { return null; }
  var out = [];
  var bitPos = 0;
  for (var i = 0; i < count; i++) {
    var bytePos = bitPos >> 3;
    if (bytePos >= bytes.length) { return null; }
    var off = bitPos & 7;
    var code;
    if (off <= 5) {
      code = (bytes[bytePos] >>> (5 - off)) & 7;
    } else if (off === 6) {
      code = ((bytes[bytePos] & 3) << 1) |
        (bytePos + 1 < bytes.length ? (bytes[bytePos + 1] >>> 7) & 1 : 0);
    } else {
      code = ((bytes[bytePos] & 1) << 2) |
        (bytePos + 1 < bytes.length ? (bytes[bytePos + 1] >>> 6) & 3 : 0);
    }
    if (code >= ACTIONS.length) { return null; }
    out.push(ACTIONS[code]);
    bitPos += 3;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Run strings                                                                */
/* -------------------------------------------------------------------------- */

function encodeRun(opts) {
  var levelIndex = opts.levelIndex;
  var actions = opts.actions || [];
  if (!Number.isInteger(levelIndex) || levelIndex < 0) { return null; }
  var packed = packActions(actions);
  if (!packed) { return null; }
  var body = 'r1.' + levelIndex.toString(36) + '.' +
    actions.length.toString(36) + '.' + b64encode(packed);
  return body + '.' + Core.hashHex(body);
}

var RUN_RE = /^r1\.([0-9a-z]+)\.([0-9a-z]+)\.([0-9A-Za-z_-]*)\.([0-9A-Fa-f]{8})$/;

function decodeRun(str) {
  var m = RUN_RE.exec(String(str || '').trim());
  if (!m) { return null; }
  var body = str.trim().slice(0, str.trim().lastIndexOf('.'));
  if (Core.hashHex(body).toUpperCase() !== m[4].toUpperCase()) { return null; }
  var levelIndex = parseInt(m[1], 36);
  var count = parseInt(m[2], 36);
  if (!isFinite(levelIndex) || !isFinite(count) || count < 0) { return null; }
  var bytes = b64decode(m[3]);
  if (bytes === null) { return null; }
  if (bytes.length !== Math.ceil(count * 3 / 8)) { return null; }
  var actions = unpackActions(bytes, count);
  if (actions === null) { return null; }
  return { levelIndex: levelIndex, actions: actions, version: 1 };
}

/* -------------------------------------------------------------------------- */
/* Simulation and verification                                                */
/* -------------------------------------------------------------------------- */

// Snapshot one state into a plain frozen copy. applyAction already returns
// fresh objects, so a shallow clone keeps each frame independent.
function snap(s) {
  return {
    x: s.x, y: s.y, phase: s.phase, shardsLeft: s.shardsLeft,
    shifts: s.shifts, steps: s.steps, deaths: s.deaths,
    status: s.status, tick: s.tick
  };
}

// Every field that defines a run's outcome feeds the digest. Two runs with
// the same digest are frame-identical in everything a judge can observe.
function stateDigest(state) {
  var s = snap(state);
  return Core.hashHex([s.x, s.y, s.phase, s.shardsLeft, s.shifts,
    s.steps, s.deaths, s.status, s.tick].join(','));
}

/*
 * Replay actions on a level and capture one frame per action. Restores the
 * pristine board first when the level was already played, which is exactly
 * the resetLevel contract from core.js. Returns {frames, final, digest,
 * replayHash}; frames[i].action is the canonical action that produced it.
 */
function simulate(level, actions) {
  var st = level.baseGrid ? Core.resetLevel(level) : Core.initialState(level);
  var frames = [];
  for (var i = 0; i < actions.length; i++) {
    var kind = canon(actions[i]) || actions[i];
    st = Core.applyAction(level, st, kind);
    var f = snap(st);
    f.action = typeof kind === 'string' ? kind : null;
    frames.push(f);
  }
  return {
    frames: frames,
    final: st,
    digest: stateDigest(st),
    replayHash: Core.replayHash(level, actions)
  };
}

// Combined certificate for a run: covers the level identity, the inputs and
// the final observable state in one hex tag.
function runDigest(level, actions, finalState) {
  var parts = [Core.replayHash(level, actions), stateDigest(finalState)];
  return Core.hashHex(parts.join('|'));
}

/*
 * Re-simulate a run and compare against an expected digest or an expected
 * frame list. expected: {digest} | {frames} | digest string. Returns
 * {ok, digest, divergence} where divergence is the first frame index whose
 * observable state differs, or -1.
 */
function verify(level, actions, expected) {
  var sim = simulate(level, actions);
  var out = { ok: false, digest: sim.digest, replayHash: sim.replayHash,
    final: sim.final, frames: sim.frames, divergence: -1 };
  if (!expected) {
    out.ok = true; // nothing to compare against; a fresh replay always stands
    return out;
  }
  var wantDigest = typeof expected === 'string' ? expected : expected.digest;
  if (wantDigest && wantDigest !== sim.digest) {
    out.divergence = 0;
    return out;
  }
  var wantFrames = expected && expected.frames;
  if (wantFrames) {
    for (var i = 0; i < wantFrames.length && i < sim.frames.length; i++) {
      if (stateDigest(sim.frames[i]) !== stateDigest(wantFrames[i])) {
        out.divergence = i;
        return out;
      }
    }
    if (wantFrames.length !== sim.frames.length) {
      out.divergence = Math.min(wantFrames.length, sim.frames.length);
      return out;
    }
  }
  out.ok = true;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Recorder                                                                   */
/* -------------------------------------------------------------------------- */

// The shell feeds every dispatched canonical action; recording stops being
// meaningful once the run ends, so callers pass `playing` false at that point.
function makeRecorder() {
  var list = [];
  return {
    note: function (kind, playing) {
      if (playing === false) { return; }
      var c = canon(kind);
      if (c) { list.push(c); }
    },
    actions: function () { return list.slice(0); },
    size: function () { return list.length; },
    reset: function () { list.length = 0; }
  };
}

/* -------------------------------------------------------------------------- */
/* URL hash share links                                                       */
/* -------------------------------------------------------------------------- */

function buildRunHash(levelIndex, actions) {
  var code = encodeRun({ levelIndex: levelIndex, actions: actions });
  return code ? '#r=' + code : null;
}

/*
 * Parse a location hash into a share payload.
 *   #r=<run string>   -> {type:'run', levelIndex, actions}
 *   #d=<design blob>  -> {type:'design', payload} (designer decodes the blob)
 * Anything else -> null.
 */
function parseHash(hash) {
  var h = String(hash || '');
  if (h.charAt(0) === '#') { h = h.slice(1); }
  if (h.indexOf('r=') === 0) {
    var run = decodeRun(h.slice(2));
    return run ? { type: 'run', levelIndex: run.levelIndex, actions: run.actions } : null;
  }
  if (h.indexOf('d=') === 0) {
    return { type: 'design', payload: h.slice(2) };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

var PBReplay = {
  ACTIONS: ACTIONS, CODE_OF: CODE_OF, canon: canon,
  b64encode: b64encode, b64decode: b64decode,
  packActions: packActions, unpackActions: unpackActions,
  encodeRun: encodeRun, decodeRun: decodeRun,
  snap: snap, stateDigest: stateDigest, runDigest: runDigest,
  simulate: simulate, verify: verify,
  makeRecorder: makeRecorder,
  buildRunHash: buildRunHash, parseHash: parseHash
};

if (typeof module !== 'undefined' && module.exports) { module.exports = PBReplay; }
if (typeof globalThis !== 'undefined' && globalThis.window) { globalThis.window.PBReplay = PBReplay; }
