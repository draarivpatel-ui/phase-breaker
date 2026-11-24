/*
 * PhaseBreaker level designer and scenario generator.
 * Pure logic, no DOM. Holds the solvability verifier (a BFS over the full
 * game state: position, phase, charge count, and which shards and bits have
 * been taken), the design blob codec for share links, and a deterministic
 * parameter-driven generator that only ships boards the verifier proves
 * solvable.
 *
 * Design blob format:
 *   d1.<w36>x<h36>.<shifts36>.<base64url tiles>.<checksum8>
 */
'use strict';

var Core = (typeof module !== 'undefined' && module.exports)
  ? require('./core.js')
  : window.PBCore;
var Replay = (typeof module !== 'undefined' && module.exports)
  ? require('./replay.js')
  : window.PBReplay;

var T = Core.T;
var PHASE = Core.PHASE;

var CHAR_TO_TILE = {
  '#': T.WALL, '.': T.EMPTY, 'A': T.PHASE_A, 'B': T.PHASE_B, 'S': T.START,
  'G': T.GOAL, '*': T.SHARD, 'T': T.GATE, '!': T.HAZARD, '+': T.BIT
};
var TILE_TO_CHAR = (function () {
  var out = {};
  var keys = Object.keys(CHAR_TO_TILE);
  for (var i = 0; i < keys.length; i++) { out[CHAR_TO_TILE[keys[i]]] = keys[i]; }
  return out;
})();

// Bounds that keep the verifier's key space small enough to always answer.
var MAX_W = 24;
var MAX_H = 16;
var MAX_SHARDS = 8;
var MAX_BITS = 8;
var DEFAULT_STATE_CAP = 800000;

/* -------------------------------------------------------------------------- */
/* Row helpers                                                                */
/* -------------------------------------------------------------------------- */

function rowsFromGrid(grid, w, h) {
  var rows = [];
  for (var y = 0; y < h; y++) {
    var s = '';
    for (var x = 0; x < w; x++) {
      var t = grid[y * w + x];
      s += TILE_TO_CHAR[t] || '#';
    }
    rows.push(s);
  }
  return rows;
}

// Paint one cell, returning a new rows array (inputs never mutate).
function paintCell(rows, x, y, char) {
  if (CHAR_TO_TILE[char] === undefined) { return rows; }
  var out = rows.slice(0);
  if (y < 0 || y >= out.length || x < 0 || x >= out[y].length) { return rows; }
  out[y] = out[y].slice(0, x) + char + out[y].slice(x + 1);
  return out;
}

// Crop or pad to new dimensions. fill defaults to floor.
function resizeRows(rows, w, h, fill) {
  var pad = typeof fill === 'string' && CHAR_TO_TILE[fill] !== undefined ? fill : '.';
  var out = [];
  for (var y = 0; y < h; y++) {
    var row = y < rows.length ? rows[y] : '';
    if (row.length > w) { row = row.slice(0, w); }
    while (row.length < w) { row += pad; }
    out.push(row);
  }
  return out;
}

function countTile(rows, char) {
  var n = 0;
  for (var y = 0; y < rows.length; y++) {
    for (var x = 0; x < rows[y].length; x++) {
      if (rows[y][x] === char) { n++; }
    }
  }
  return n;
}

/* -------------------------------------------------------------------------- */
/* Solvability verifier (BFS over the full mechanic)                          */
/* -------------------------------------------------------------------------- */

/*
 * Build the search model: pristine grid plus ordinal maps for shards and
 * bits so pickups flip mask bits instead of mutating the board. Returns
 * null when collectible counts would blow the key space.
 */
function modelFor(level) {
  var grid = level.baseGrid || level.grid;
  if (!grid) { return null; }
  var m = {
    width: level.width, height: level.height, grid: grid,
    shardIdx: new Int16Array(level.width * level.height).fill(-1),
    bitIdx: new Int16Array(level.width * level.height).fill(-1),
    nShards: 0, nBits: 0
  };
  var n = Math.min(grid.length, m.width * m.height);
  for (var i = 0; i < n; i++) {
    if (grid[i] === T.SHARD) { m.shardIdx[i] = m.nShards++; }
    else if (grid[i] === T.BIT) { m.bitIdx[i] = m.nBits++; }
  }
  if (m.nShards > MAX_SHARDS || m.nBits > MAX_BITS) { return null; }
  m.fullShardMask = (1 << m.nShards) - 1;
  m.chargeCap = (Number.isFinite(level.shifts) ? level.shifts : 0) + m.nBits;
  return m;
}

function solidFor(model, tile, phase, shardMask) {
  if (tile === T.WALL) { return true; }
  if (tile === T.PHASE_A && phase === PHASE.ALPHA) { return true; }
  if (tile === T.PHASE_B && phase === PHASE.BETA) { return true; }
  if (tile === T.GATE && shardMask !== model.fullShardMask) { return true; }
  return false;
}

function startState(model, level) {
  var start = null;
  var n = Math.min(model.grid.length, model.width * model.height);
  for (var i = 0; i < n; i++) {
    if (model.grid[i] === T.START) { start = i; break; }
  }
  if (start === null) {
    var probe = { width: model.width, height: model.height, grid: model.grid };
    var fw = Core.firstWalkable(probe, model.nShards);
    start = fw ? fw.y * model.width + fw.x : (model.width + 1 < n ? model.width + 1 : 0);
  }
  return {
    pos: start, phase: PHASE.ALPHA,
    charges: Number.isFinite(level.shifts) ? level.shifts : 0,
    shardMask: 0, bitMask: 0
  };
}

function packKey(st) {
  // Fits safely inside 2^53 for the bounded boards: pos<384 (9b), phase (1b),
  // charges<=16 (5b), shardMask (8b), bitMask (8b) -> <=31 bits.
  return (((((st.pos * 2 + st.phase) * 17 + st.charges) * 256 + st.shardMask) * 256) + st.bitMask);
}

/*
 * Breadth-first reachability to any GOAL tile. Bumps and denied shifts are
 * self-loops and are never enqueued. Returns
 *   {solvable:true, actions:[...], states:N}
 *   {solvable:false, states:N}
 *   {solvable:null, reason:'state-cap'|'too-many-collectibles'}
 * opts: {maxStates, wantPath=false}
 */
function solve(level, opts) {
  var options = opts || {};
  var cap = options.maxStates || DEFAULT_STATE_CAP;
  var model = modelFor(level);
  if (!model) { return { solvable: null, reason: 'too-many-collectibles', states: 0 }; }

  var start = startState(model, level);
  var queue = [start];
  var startKey = packKey(start);
  var visited = new Set([startKey]);
  var parent = options.wantPath ? new Map() : null;
  var head = 0;

  var W = model.width, H = model.height, G = model.grid;
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  var NAMES = ['up', 'right', 'down', 'left'];

  while (head < queue.length) {
    var st = queue[head++];
    var x = st.pos % W, y = (st.pos / W) | 0;

    for (var a = 0; a < 5; a++) {
      var npos = st.pos, nphase = st.phase, ncharges = st.charges;
      var nshard = st.shardMask, nbit = st.bitMask;
      var kind;
      if (a < 4) {
        kind = NAMES[a];
        var nx = x + DX[a], ny = y + DY[a];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { continue; }
        npos = ny * W + nx;
        if (npos >= G.length) { continue; }
        var tile = G[npos];
        if (tile === T.SHARD && (st.shardMask >> model.shardIdx[npos]) & 1) { tile = T.EMPTY; }
        if (tile === T.BIT && (st.bitMask >> model.bitIdx[npos]) & 1) { tile = T.EMPTY; }
        if (solidFor(model, tile, nphase, nshard)) { continue; }
        if (tile === T.SHARD) { nshard |= (1 << model.shardIdx[npos]); }
        if (tile === T.BIT) { nbit |= (1 << model.bitIdx[npos]); ncharges++; }
        if (tile === T.HAZARD) { continue; }  // dead end, literally
        if (tile === T.GOAL) {
          var goalSt = { pos: npos, phase: nphase, charges: ncharges,
            shardMask: nshard, bitMask: nbit };
          var gk = packKey(goalSt);
          var actions = null;
          if (options.wantPath) {
            parent.set(gk, { prev: packKey(st), action: kind });
            actions = unwind(parent, packKey(start), gk);
          }
          return { solvable: true, actions: actions, states: visited.size };
        }
      } else {
        kind = 'shift';
        if (ncharges <= 0) { continue; }
        ncharges--;
        nphase = nphase === PHASE.ALPHA ? PHASE.BETA : PHASE.ALPHA;
      }
      var nst = { pos: npos, phase: nphase, charges: ncharges,
        shardMask: nshard, bitMask: nbit };
      var key = packKey(nst);
      if (visited.has(key)) { continue; }
      if (visited.size >= cap) {
        return { solvable: null, reason: 'state-cap', states: visited.size };
      }
      visited.add(key);
      if (parent) { parent.set(key, { prev: packKey(st), action: kind }); }
      queue.push(nst);
    }
  }
  return { solvable: false, states: visited.size };
}

function unwind(parent, startKey, goalKey) {
  var actions = [];
  var k = goalKey;
  while (k !== startKey) {
    var p = parent.get(k);
    if (!p) { break; }
    actions.unshift(p.action);
    k = p.prev;
  }
  return actions;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/*
 * Structural plus solvability check for authored rows. Returns
 * {ok, errors[], warnings[], solvable, solution} where solution is the
 * action list when wantPath was set and a route exists.
 */
function validateRows(rows, opts) {
  var options = opts || {};
  var errors = [], warnings = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, errors: ['no rows'], warnings: warnings, solvable: null };
  }
  var w = typeof rows[0] === 'string' ? rows[0].length : 0;
  if (w === 0) { errors.push('first row is empty'); }
  for (var y = 0; y < rows.length; y++) {
    if (typeof rows[y] !== 'string' || rows[y].length !== w) {
      errors.push('row ' + (y + 1) + ' is not ' + w + ' cells');
      break;
    }
    for (var x = 0; x < w; x++) {
      if (CHAR_TO_TILE[rows[y][x]] === undefined) {
        errors.push('unknown tile "' + rows[y][x] + '" at row ' + (y + 1) + ' col ' + (x + 1));
        break;
      }
    }
    if (errors.length) { break; }
  }
  if (w > MAX_W) { errors.push('width ' + w + ' over the ' + MAX_W + ' limit'); }
  if (rows.length > MAX_H) { errors.push('height ' + rows.length + ' over the ' + MAX_H + ' limit'); }
  var starts = countTile(rows, 'S'), goals = countTile(rows, 'G');
  var shards = countTile(rows, '*'), bits = countTile(rows, '+');
  if (starts === 0) { errors.push('no start tile S'); }
  if (goals === 0) { errors.push('no goal tile G'); }
  if (starts > 1) { warnings.push(starts + ' start tiles, the first one is used'); }
  if (shards > MAX_SHARDS) { errors.push(shards + ' shards over the ' + MAX_SHARDS + ' limit'); }
  if (bits > MAX_BITS) { errors.push(bits + ' bits over the ' + MAX_BITS + ' limit'); }
  var gates = countTile(rows, 'T');
  if (gates > 0 && shards === 0) {
    warnings.push('a gate with no shards is always open');
  }

  var out = { ok: errors.length === 0, errors: errors, warnings: warnings,
    solvable: null, solution: null };
  if (errors.length) { return out; }

  var level;
  try {
    level = Core.levelFromRows(rows, {
      shifts: Number.isFinite(options.shifts) ? options.shifts : 0,
      seed: options.seed || 'design', name: options.name || 'Custom'
    });
  } catch (err) {
    out.errors.push(err.message);
    out.ok = false;
    return out;
  }
  var res = solve(level, { maxStates: options.maxStates, wantPath: true });
  out.solvable = res.solvable;
  out.solution = res.actions || null;
  out.level = level;
  if (res.solvable === false) {
    out.errors.push('no route reaches the goal with this shift budget');
    out.ok = false;
  } else if (res.solvable === null) {
    out.warnings.push('board too large to verify (' + res.reason + ')');
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Design blob codec                                                          */
/* -------------------------------------------------------------------------- */

function serializeDesign(rows, opts) {
  var options = opts || {};
  if (!Array.isArray(rows) || rows.length === 0) { return null; }
  var h = rows.length, w = rows[0].length;
  var tiles = new Uint8Array(w * h);
  for (var y = 0; y < h; y++) {
    if (rows[y].length !== w) { return null; }
    for (var x = 0; x < w; x++) {
      var t = CHAR_TO_TILE[rows[y][x]];
      if (t === undefined) { return null; }
      tiles[y * w + x] = t;
    }
  }
  var shifts = options.shifts === undefined ? 0 : options.shifts;
  if (!Number.isInteger(shifts) || shifts < 0 || shifts > 99) { return null; }
  var body = 'd1.' + w.toString(36) + 'x' + h.toString(36) + '.' +
    shifts.toString(36) + '.' + Replay.b64encode(tiles);
  return body + '.' + Core.hashHex(body);
}

var DESIGN_RE = /^d1\.([0-9a-z]+)x([0-9a-z]+)\.([0-9a-z]+)\.([0-9A-Za-z_-]+)\.([0-9A-Fa-f]{8})$/;

function parseDesign(str) {
  var s = String(str || '').trim();
  var m = DESIGN_RE.exec(s);
  if (!m) { return null; }
  var body = s.slice(0, s.lastIndexOf('.'));
  if (Core.hashHex(body).toUpperCase() !== m[5].toUpperCase()) { return null; }
  var w = parseInt(m[1], 36), h = parseInt(m[2], 36), shifts = parseInt(m[3], 36);
  if (!isFinite(w) || !isFinite(h) || !isFinite(shifts)) { return null; }
  if (w < 1 || h < 1 || w > MAX_W || h > MAX_H || shifts < 0 || shifts > 99) { return null; }
  var tiles = Replay.b64decode(m[4]);
  if (tiles === null || tiles.length !== w * h) { return null; }
  var rows = rowsFromGrid(tiles, w, h);
  return { rows: rows, shifts: shifts, width: w, height: h };
}

/* -------------------------------------------------------------------------- */
/* Deterministic scenario generator                                           */
/* -------------------------------------------------------------------------- */

var DEFAULT_PARAMS = {
  seed: 'spark', width: 13, height: 9, shifts: 3,
  walls: 0.22, hazards: 0.05, shards: 2, bits: 1, doors: 2
};

function clampParams(p) {
  var d = DEFAULT_PARAMS;
  p = p || {};
  function num(v, lo, hi, dflt) {
    v = Number(v);
    if (!isFinite(v)) { return dflt; }
    return Math.max(lo, Math.min(hi, Math.round(v * 1000) / 1000));
  }
  return {
    seed: p.seed != null ? String(p.seed) : d.seed,
    width: Math.round(num(p.width, 5, MAX_W, d.width)),
    height: Math.round(num(p.height, 3, MAX_H, d.height)),
    shifts: Math.round(num(p.shifts, 0, 8, d.shifts)),
    walls: num(p.walls, 0, 0.4, d.walls),
    hazards: num(p.hazards, 0, 0.25, d.hazards),
    shards: Math.round(num(p.shards, 0, MAX_SHARDS, d.shards)),
    bits: Math.round(num(p.bits, 0, MAX_BITS, d.bits)),
    doors: Math.round(num(p.doors, 0, 8, d.doors))
  };
}

function placeRandom(rng, grid, w, h, tile, avoid) {
  var spots = [];
  for (var i = w + 1; i < w * (h - 1) - 1; i++) {
    if (grid[i] === T.EMPTY && (!avoid || avoid.indexOf(i) < 0)) { spots.push(i); }
  }
  if (!spots.length) { return -1; }
  var pick = spots[rng.int(0, spots.length - 1)];
  grid[pick] = tile;
  return pick;
}

/*
 * Generate a level from parameters. Deterministic: identical params produce
 * an identical board every time because the attempt counter is part of the
 * seed stream. Only boards the verifier proves solvable are returned; the
 * fallback is a clean corridor that always works.
 */
function generate(params, opts) {
  var p = clampParams(params);
  var options = opts || {};
  var maxAttempts = options.maxAttempts || 120;
  var pKey = Core.fnv1a(JSON.stringify(p));

  for (var a = 0; a < maxAttempts; a++) {
    var rng = Core.makeRNG((Core.hashSeed('gen:' + p.seed) ^ pKey ^ (a * 0x9e3779b9)) >>> 0);
    var w = p.width, h = p.height;
    var grid = new Uint8Array(w * h);
    for (var x = 0; x < w; x++) { grid[x] = T.WALL; grid[(h - 1) * w + x] = T.WALL; }
    for (var y = 0; y < h; y++) { grid[y * w] = T.WALL; grid[y * w + w - 1] = T.WALL; }
    for (var i = 0; i < grid.length; i++) {
      if (grid[i] === T.EMPTY && rng.chance(p.walls)) { grid[i] = T.WALL; }
    }
    var start = placeRandom(rng, grid, w, h, T.START);
    if (start < 0) { continue; }
    // Goal lands far from start so the board plays like a level, not a room.
    var sx = start % w, sy = (start / w) | 0;
    var minDist = Math.floor((w + h) / 3);
    var goal = -1;
    for (var tries = 0; tries < 40 && goal < 0; tries++) {
      var cand = [];
      for (var j = w + 1; j < w * (h - 1) - 1; j++) {
        if (grid[j] !== T.EMPTY) { continue; }
        var dx = Math.abs((j % w) - sx), dy = Math.abs(((j / w) | 0) - sy);
        if (dx + dy >= minDist) { cand.push(j); }
      }
      if (!cand.length) { minDist = Math.max(2, minDist - 1); continue; }
      goal = cand[rng.int(0, cand.length - 1)];
    }
    if (goal < 0) { continue; }
    grid[goal] = T.GOAL;

    var ok = true;
    for (var d = 0; d < p.doors && ok; d++) {
      ok = placeRandom(rng, grid, w, h, d % 2 === 0 ? T.PHASE_A : T.PHASE_B) >= 0;
    }
    for (var s = 0; s < p.shards && ok; s++) {
      ok = placeRandom(rng, grid, w, h, T.SHARD) >= 0;
    }
    for (var b = 0; b < p.bits && ok; b++) {
      ok = placeRandom(rng, grid, w, h, T.BIT) >= 0;
    }
    if (!ok) { continue; }
    var interior = (w - 2) * (h - 2);
    var nHaz = Math.floor(interior * p.hazards);
    for (var z = 0; z < nHaz; z++) {
      if (placeRandom(rng, grid, w, h, T.HAZARD) < 0) { break; }
    }

    var level = {
      width: w, height: h, grid: grid, baseGrid: grid.slice(0),
      shifts: p.shifts, seed: 'gen-' + p.seed + '-' + a, name: 'Custom'
    };
    level.fingerprint = Core.levelFingerprint(grid, w, h);
    var res = solve(level, { maxStates: options.maxStates });
    if (res.solvable === true) {
      return { level: level, rows: rowsFromGrid(grid, w, h), params: p,
        attempts: a + 1, solutionStates: res.states, fallback: false };
    }
  }

  // Deterministic fallback: an empty corridor, always solvable.
  var fw = p.width, fh = p.height;
  var fgrid = new Uint8Array(fw * fh);
  for (var fx = 0; fx < fw; fx++) { fgrid[fx] = T.WALL; fgrid[(fh - 1) * fw + fx] = T.WALL; }
  for (var fy = 0; fy < fh; fy++) { fgrid[fy * fw] = T.WALL; fgrid[fy * fw + fw - 1] = T.WALL; }
  fgrid[fw + 1] = T.START;
  fgrid[(fh - 2) * fw + fw - 2] = T.GOAL;
  var flevel = {
    width: fw, height: fh, grid: fgrid, baseGrid: fgrid.slice(0),
    shifts: p.shifts, seed: 'gen-' + p.seed + '-fallback', name: 'Custom'
  };
  flevel.fingerprint = Core.levelFingerprint(fgrid, fw, fh);
  return { level: flevel, rows: rowsFromGrid(fgrid, fw, fh), params: p,
    attempts: maxAttempts, solutionStates: 0, fallback: true };
}

var PRESETS = [
  { name: 'Spark Run', params: { seed: 'spark', width: 11, height: 7, shifts: 3, walls: 0.15, hazards: 0.02, shards: 1, bits: 1, doors: 2 } },
  { name: 'Crossfire', params: { seed: 'crossfire', width: 15, height: 11, shifts: 4, walls: 0.24, hazards: 0.06, shards: 3, bits: 1, doors: 4 } },
  { name: 'Long Hall', params: { seed: 'longhall', width: 19, height: 9, shifts: 5, walls: 0.18, hazards: 0.08, shards: 2, bits: 2, doors: 5 } }
];

var PBDesigner = {
  CHAR_TO_TILE: CHAR_TO_TILE, TILE_TO_CHAR: TILE_TO_CHAR,
  MAX_W: MAX_W, MAX_H: MAX_H, MAX_SHARDS: MAX_SHARDS, MAX_BITS: MAX_BITS,
  rowsFromGrid: rowsFromGrid, paintCell: paintCell, resizeRows: resizeRows,
  countTile: countTile, solve: solve, validateRows: validateRows,
  serializeDesign: serializeDesign, parseDesign: parseDesign,
  clampParams: clampParams, generate: generate,
  DEFAULT_PARAMS: DEFAULT_PARAMS, PRESETS: PRESETS
};

if (typeof module !== 'undefined' && module.exports) { module.exports = PBDesigner; }
if (typeof globalThis !== 'undefined' && globalThis.window) { globalThis.window.PBDesigner = PBDesigner; }
