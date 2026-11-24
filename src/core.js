/*
 * PhaseBreaker core primitives.
 * Pure deterministic functions. No browser globals, no external packages.
 * Everything that affects gameplay or generation lives here so the exact same
 * logic powers the browser build and the Node test suite.
 *
 * Level shape: { width, height, grid, baseGrid, shifts, seed, fingerprint }.
 * grid and baseGrid are array-likes (Uint8Array preferred) of width*height
 * tile codes; baseGrid is the pristine board resetLevel restores, snapshotted
 * lazily by initialState on first use and always set by levelFromRows.
 *
 * Action cost model: every recognised action ('up'/'down'/'left'/'right',
 * single letters, 'shift', 'wait') spends one turn: tick+1 and steps+1.
 * Bumping a wall is a turn spent with no movement. Unrecognised actions
 * (null, numbers, unknown strings, objects without .a) are free no-ops and
 * never tick. 'shift' requires and spends one charge from state.shifts;
 * with zero charges the shift is denied but the turn is still spent. A
 * player may legally stand on a tile that is solid in the current phase
 * after shifting inside it; walking out is always allowed, but running out
 * of charges while sealed in is a dead run, so restart exists.
 *
 * Replay contract: applyAction mutates level.grid when SHARD/BIT tiles are
 * consumed. Call resetLevel(level) before replaying a run on a used level
 * object, or the consumed tiles stay gone and the run diverges.
 */
'use strict';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

// Tile codes. Kept small so a level serialises into a compact share code.
var T = {
  EMPTY: 0,   // walkable in every phase
  WALL: 1,    // solid in every phase
  PHASE_A: 2, // solid only while the world is in ALPHA
  PHASE_B: 3, // solid only while the world is in BETA
  START: 4,   // always walkable
  GOAL: 5,    // always walkable, reaching it clears the level
  SHARD: 6,   // always walkable, optional collectible
  GATE: 7,    // walkable only when every shard on the level is collected
  HAZARD: 8,  // always walkable but lethal on contact
  BIT: 9      // always walkable, grants one extra phase shift charge
};

var PHASE = { ALPHA: 0, BETA: 1 };

// Direction table shared by movement and the solvability verifier.
var DIRS = [
  { dx: 0, dy: -1, name: 'up' },
  { dx: 1, dy: 0, name: 'right' },
  { dx: 0, dy: 1, name: 'down' },
  { dx: -1, dy: 0, name: 'left' }
];

// Default board dimensions. Odd numbers keep BSP splitting symmetric.
var DEFAULT_W = 25;
var DEFAULT_H = 19;

/* -------------------------------------------------------------------------- */
/* Deterministic RNG                                                          */
/* -------------------------------------------------------------------------- */

// Mulberry32. Small, fast, fully reproducible for a given 32 bit seed.
function makeRNG(seed) {
  var s = (typeof seed === 'number' ? seed : hashSeed(String(seed))) >>> 0;
  function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next: next,
    // Inclusive integer range.
    int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
    pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
    chance: function (p) { return next() < p; },
    shuffle: function (arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(next() * (i + 1));
        var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    }
  };
}

/* -------------------------------------------------------------------------- */
/* FNV-1a 32 bit hash                                                         */
/* -------------------------------------------------------------------------- */

function fnv1a(str) {
  var h = 0x811c9dc5;
  var s = String(str);
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    // Feed the high byte too so non ASCII characters still change the result.
    var hi = s.charCodeAt(i) >>> 8;
    if (hi) {
      h ^= hi & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

// Turn an arbitrary human readable seed word into a stable 32 bit number.
function hashSeed(word) { return fnv1a('phase-breaker:' + String(word)); }

function hashHex(str) {
  var h = fnv1a(str);
  return ('00000000' + h.toString(16)).slice(-8).toUpperCase();
}

/* -------------------------------------------------------------------------- */
/* Replay hashing                                                             */
/* -------------------------------------------------------------------------- */

// A replay is a list of actions ('up' strings or {t, a} entries). The hash
// covers the seed, the level fingerprint and every action, so a run can be
// verified against a shared code. Entries are JSON encoded so different
// replays can never collide on raw ':' and ',' characters.
function replayHash(level, replay) {
  var parts = [String(level.seed), '|', String(level.fingerprint), '|'];
  for (var i = 0; i < replay.length; i++) {
    var a = replay[i];
    var kind = typeof a === 'string' ? a : (a && a.a);
    var tick = a && a.t != null ? a.t : null;
    parts.push(JSON.stringify([tick, kind == null ? null : String(kind)]));
  }
  return hashHex(parts.join(''));
}

// The board shape is part of the fingerprint so a 3x2 and a 2x3 grid holding
// the same flattened tiles do not collide.
function levelFingerprint(grid, width, height) {
  var chars = [String(width), 'x', String(height), ':'];
  var n = Math.min(grid.length, width * height);
  for (var i = 0; i < n; i++) {
    chars.push(String.fromCharCode(65 + grid[i]));
  }
  return hashHex(chars.join(''));
}

/* -------------------------------------------------------------------------- */
/* Grid helpers                                                               */
/* -------------------------------------------------------------------------- */

function makeGrid(width, height, fill) {
  var g = new Uint8Array(width * height);
  if (fill) { for (var i = 0; i < g.length; i++) { g[i] = fill; } }
  return g;
}

function inBounds(level, x, y) {
  return x >= 0 && y >= 0 && x < level.width && y < level.height;
}

// A short or plain grid can still leave cells outside its backing store.
// Anything unreadable is a wall so phantom walkable cells cannot exist.
function tileAt(level, x, y) {
  if (!inBounds(level, x, y)) { return T.WALL; }
  var idx = y * level.width + x;
  if (!level.grid || idx >= level.grid.length) { return T.WALL; }
  return level.grid[idx];
}

// Only known tile codes may be written; a Uint8Array would otherwise wrap
// out-of-range values into arbitrary tiles.
function setTile(level, x, y, t) {
  if (!inBounds(level, x, y) || !level.grid) { return; }
  var idx = y * level.width + x;
  if (idx >= level.grid.length) { return; }
  if (t !== (t | 0) || t < T.EMPTY || t > T.BIT) { return; }
  level.grid[idx] = t;
}

function findTiles(level, code) {
  var out = [];
  var n = Math.min(level.grid ? level.grid.length : 0, level.width * level.height);
  for (var i = 0; i < n; i++) {
    if (level.grid[i] === code) {
      out.push({ x: i % level.width, y: Math.floor(i / level.width) });
    }
  }
  return out;
}

// The emergency spawn when a level forgets its START tile: the first tile in
// row-major order that is walkable and not lethal at spawn-time.
function firstWalkable(level, shardsLeft) {
  var n = Math.min(level.grid ? level.grid.length : 0, level.width * level.height);
  for (var i = 0; i < n; i++) {
    var x = i % level.width;
    var y = Math.floor(i / level.width);
    var t = level.grid[i];
    if (!isSolid(t, PHASE.ALPHA, shardsLeft) && !isLethal(t)) {
      return { x: x, y: y };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Movement rules                                                             */
/* -------------------------------------------------------------------------- */

// A tile blocks the player depending on the active phase and shard progress.
function isSolid(tile, phase, shardsLeft) {
  if (tile === T.WALL) { return true; }
  if (tile === T.PHASE_A && phase === PHASE.ALPHA) { return true; }
  if (tile === T.PHASE_B && phase === PHASE.BETA) { return true; }
  if (tile === T.GATE && shardsLeft > 0) { return true; }
  return false;
}

function canWalk(level, x, y, phase, shardsLeft) {
  if (!inBounds(level, x, y)) { return false; }
  return !isSolid(tileAt(level, x, y), phase, shardsLeft);
}

function isLethal(tile) { return tile === T.HAZARD; }

/* -------------------------------------------------------------------------- */
/* State transitions                                                          */
/* -------------------------------------------------------------------------- */

function initialState(level) {
  if (!level.baseGrid && level.grid) {
    level.baseGrid = level.grid.slice(0);
  }
  var shardCount = findTiles(level, T.SHARD).length;
  var start = findTiles(level, T.START)[0] || firstWalkable(level, shardCount) || { x: 1, y: 1 };
  return {
    x: start.x,
    y: start.y,
    phase: PHASE.ALPHA,
    shardsLeft: shardCount,
    shifts: Number.isFinite(level.shifts) ? level.shifts : 0,
    steps: 0,
    deaths: 0,
    status: 'playing',   // playing | won | dead
    tick: 0
  };
}

function applyAction(level, state, action) {
  if (state.status !== 'playing') { return state; }

  // Resolve the action kind. Strings may be full names or single letters and
  // matching is case-insensitive; objects carry the kind on .a. Anything that
  // does not resolve to a real action is a free no-op (no tick, no step).
  var kind = typeof action === 'string' ? action : (action && action.a);
  if (typeof kind === 'string') { kind = kind.toLowerCase(); }
  var dir = null;
  if (kind === 'shift' || kind === 'wait') {
    // recognised non-movement actions
  } else if (typeof kind === 'string' && kind.length > 0) {
    for (var i = 0; i < DIRS.length; i++) {
      if (DIRS[i].name === kind || DIRS[i].name.charAt(0) === kind) { dir = DIRS[i]; break; }
    }
    if (!dir) { return state; }
  } else {
    return state;
  }

  // Every recognised action spends one turn.
  var s = {
    x: state.x, y: state.y, phase: state.phase,
    shardsLeft: state.shardsLeft, shifts: state.shifts,
    steps: state.steps + 1, deaths: state.deaths,
    status: state.status, tick: state.tick + 1
  };

  if (kind === 'shift') {
    // Shifting costs one charge; denied at zero but the turn is still spent.
    if (s.shifts > 0) {
      s.shifts -= 1;
      s.phase = s.phase === PHASE.ALPHA ? PHASE.BETA : PHASE.ALPHA;
    }
  } else if (kind === 'wait') {
    // Deliberate pass of one turn, useful for timing and replay alignment.
  } else {
    var nx = s.x + dir.dx;
    var ny = s.y + dir.dy;
    if (!canWalk(level, nx, ny, s.phase, s.shardsLeft)) {
      return s; // bumping a wall spends the turn but keeps the position
    }
    var landed = tileAt(level, nx, ny);
    if (landed === T.SHARD) {
      s.shardsLeft = Math.max(0, s.shardsLeft - 1);
      setTile(level, nx, ny, T.EMPTY);
    } else if (landed === T.BIT) {
      s.shifts += 1;
      setTile(level, nx, ny, T.EMPTY);
    }
    s.x = nx; s.y = ny;

    if (isLethal(landed)) {
      s.status = 'dead';
      s.deaths += 1;
    } else if (landed === T.GOAL) {
      s.status = 'won';
    }
  }
  return s;
}

function resetLevel(level) {
  if (!level.baseGrid) {
    throw new Error('level has no baseGrid to reset to');
  }
  if (level.baseGrid.length !== level.grid.length) {
    throw new Error('baseGrid length ' + level.baseGrid.length +
      ' does not match grid length ' + level.grid.length);
  }
  // Element copy works on typed arrays and plain arrays alike.
  for (var i = 0; i < level.grid.length; i++) {
    level.grid[i] = level.baseGrid[i];
  }
  return initialState(level);
}

/* -------------------------------------------------------------------------- */
/* Seed codes                                                                 */
/* -------------------------------------------------------------------------- */

// A share code is a base36 seed plus a compact difficulty tag.
function encodeSeedCode(seed, levelIndex) {
  if (!Number.isInteger(levelIndex) || levelIndex < 0) { return null; }
  var s = (typeof seed === 'number' ? seed >>> 0 : hashSeed(seed));
  return 'PB-' + s.toString(36).toUpperCase() + '-' + (levelIndex + 1).toString(36).toUpperCase();
}

function decodeSeedCode(code) {
  var m = /^PB-([0-9A-Z]+)-([0-9A-Z]+)$/i.exec(String(code).trim());
  if (!m) { return null; }
  var seed = parseInt(m[1], 36);
  var idx = parseInt(m[2], 36) - 1;
  if (!isFinite(seed) || !isFinite(idx) || idx < 0) { return null; }
  // Seeds live in 32 bits; a larger code can never have come from encodeSeedCode.
  if (seed > 0xFFFFFFFF) { return null; }
  return { seed: seed >>> 0, levelIndex: idx };
}

/* -------------------------------------------------------------------------- */
/* Authored level builder                                                     */
/* -------------------------------------------------------------------------- */

// Row characters accepted by levelFromRows: '#' wall, '.' floor, 'A' alpha
// door, 'B' beta door, 'S' start, 'G' goal, '*' shard, 'T' gate, '!' hazard,
// '+' bit.
var ROW_TILES = {
  '#': T.WALL, '.': T.EMPTY, 'A': T.PHASE_A, 'B': T.PHASE_B, 'S': T.START,
  'G': T.GOAL, '*': T.SHARD, 'T': T.GATE, '!': T.HAZARD, '+': T.BIT
};

/*
 * Turn authored row strings into a ready level object with baseGrid and
 * fingerprint populated. Throws on malformed rows so bad level data fails
 * loudly in tests rather than misbehaving in the browser.
 */
function levelFromRows(rows, opts) {
  var options = opts || {};
  if (options.shifts !== undefined && (!Number.isInteger(options.shifts) || options.shifts < 0)) {
    throw new Error('shifts must be a non-negative integer');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('level needs at least one row');
  }
  var height = rows.length;
  var width = typeof rows[0] === 'string' ? rows[0].length : 0;
  if (width === 0) { throw new Error('level rows must be non-empty strings'); }
  var grid = new Uint8Array(width * height);
  for (var y = 0; y < height; y++) {
    var row = rows[y];
    if (typeof row !== 'string' || row.length !== width) {
      throw new Error('row ' + y + ' needs exactly ' + width + ' cells');
    }
    for (var x = 0; x < width; x++) {
      var t = ROW_TILES[row[x]];
      if (t === undefined) {
        throw new Error('row ' + y + ' column ' + x + ' has an unknown character');
      }
      grid[y * width + x] = t;
    }
  }
  var level = {
    width: width,
    height: height,
    grid: grid,
    baseGrid: grid.slice(0),
    shifts: Number.isFinite(options.shifts) ? options.shifts : 0,
    seed: options.seed != null ? options.seed : 'level',
    name: typeof options.name === 'string' ? options.name : 'Untitled'
  };
  level.fingerprint = levelFingerprint(level.grid, level.width, level.height);
  return level;
}

/* -------------------------------------------------------------------------- */
/* Exports (UMD style: CommonJS, ES module friendly, browser global)          */
/* -------------------------------------------------------------------------- */

var Core = {
  T: T, PHASE: PHASE, DIRS: DIRS,
  DEFAULT_W: DEFAULT_W, DEFAULT_H: DEFAULT_H,
  makeRNG: makeRNG, fnv1a: fnv1a, hashSeed: hashSeed, hashHex: hashHex,
  replayHash: replayHash, levelFingerprint: levelFingerprint,
  makeGrid: makeGrid, inBounds: inBounds, tileAt: tileAt, setTile: setTile,
  findTiles: findTiles, firstWalkable: firstWalkable, isSolid: isSolid,
  canWalk: canWalk, isLethal: isLethal,
  initialState: initialState, applyAction: applyAction, resetLevel: resetLevel,
  encodeSeedCode: encodeSeedCode, decodeSeedCode: decodeSeedCode,
  levelFromRows: levelFromRows
};

if (typeof module !== 'undefined' && module.exports) { module.exports = Core; }
if (typeof globalThis !== 'undefined' && globalThis.window) { globalThis.window.PBCore = Core; }
