/*
 * PhaseBreaker run telemetry.
 * A pure counter/analytics layer. The shell calls tracker.note() once per
 * dispatched action with the before and after states; everything else is
 * derived. No DOM, no timers, no randomness, so the same run always yields
 * the same numbers in Node and in the browser.
 *
 * Metrics tracked: recognised turns, moves, wall bumps, shifts used and
 * denied, waits, shards and bits collected, deaths, phase split (turns
 * spent in each world), unique tiles visited, and the combo chain
 * (consecutive turns that changed the position; a bump, a denied shift or
 * a wait breaks the chain).
 */
'use strict';

var Core = (typeof module !== 'undefined' && module.exports)
  ? require('./core.js')
  : window.PBCore;

var MOVE_KINDS = { up: 1, right: 1, down: 1, left: 1 };

function kindOf(action) {
  var k = typeof action === 'string' ? action : (action && action.a);
  return typeof k === 'string' ? k.toLowerCase() : null;
}

function makeTracker() {
  var st = {
    turns: 0,          // recognised actions (tick advanced)
    freeNoOps: 0,      // dispatched but unrecognised (tick did not move)
    moves: 0,          // position actually changed
    bumps: 0,          // direction action into a solid tile
    shiftsUsed: 0,
    shiftsDenied: 0,
    waits: 0,
    shardsGot: 0,
    bitsGot: 0,
    deaths: 0,
    won: false,
    phaseTurns: [0, 0],           // turns spent while ALPHA / BETA
    visited: {},                  // 'x,y' -> visit count
    visitedCount: 0,
    combo: 0,
    maxCombo: 0,
    firstDeathTick: -1,
    wonTick: -1,
    rows: []                      // one per recognised action
  };

  function markVisited(x, y) {
    var k = x + ',' + y;
    if (st.visited[k] === undefined) {
      st.visited[k] = 1;
      st.visitedCount++;
    } else {
      st.visited[k]++;
    }
  }

  return {
    // Call once with the starting state so the spawn tile counts as visited.
    start: function (state) {
      markVisited(state.x, state.y);
    },
    note: function (action, before, after) {
      var kind = kindOf(action);
      if (!before || !after) { return; }
      var ticked = after.tick > before.tick;
      if (!ticked) {
        st.freeNoOps++;
        return;
      }
      st.turns++;
      st.phaseTurns[before.phase === Core.PHASE.BETA ? 1 : 0]++;

      var moved = after.x !== before.x || after.y !== before.y;
      var broke = false;
      if (kind && MOVE_KINDS[kind]) {
        if (moved) {
          st.moves++;
          markVisited(after.x, after.y);
          st.combo++;
        } else {
          st.bumps++;
          broke = true;
        }
      } else if (kind === 'shift') {
        if (after.phase !== before.phase) {
          st.shiftsUsed++;
          // a shift keeps a combo alive but does not extend it
        } else {
          st.shiftsDenied++;
          broke = true;
        }
      } else if (kind === 'wait') {
        st.waits++;
        broke = true;
      }
      if (broke) { st.combo = 0; }
      if (st.combo > st.maxCombo) { st.maxCombo = st.combo; }

      if (after.shardsLeft < before.shardsLeft) { st.shardsGot++; }
      if (kind && MOVE_KINDS[kind] && after.shifts > before.shifts) { st.bitsGot++; }
      if (after.deaths > before.deaths) {
        st.deaths++;
        if (st.firstDeathTick < 0) { st.firstDeathTick = after.tick; }
      }
      if (before.status === 'playing' && after.status === 'won') {
        st.won = true;
        if (st.wonTick < 0) { st.wonTick = after.tick; }
      }
      st.rows.push({
        tick: after.tick,
        action: kind,
        x: after.x, y: after.y,
        phase: after.phase === Core.PHASE.BETA ? 'BETA' : 'ALPHA',
        shifts: after.shifts,
        shardsLeft: after.shardsLeft,
        status: after.status
      });
    },
    rows: function () { return st.rows.slice(0); },
    reset: function () {
      st.turns = 0; st.freeNoOps = 0; st.moves = 0; st.bumps = 0;
      st.shiftsUsed = 0; st.shiftsDenied = 0; st.waits = 0;
      st.shardsGot = 0; st.bitsGot = 0; st.deaths = 0;
      st.won = false; st.phaseTurns = [0, 0];
      st.visited = {}; st.visitedCount = 0;
      st.combo = 0; st.maxCombo = 0;
      st.firstDeathTick = -1; st.wonTick = -1;
      st.rows = [];
    },
    summary: function () {
      var total = st.phaseTurns[0] + st.phaseTurns[1];
      return {
        turns: st.turns,
        freeNoOps: st.freeNoOps,
        moves: st.moves,
        bumps: st.bumps,
        bumpRate: st.turns ? st.bumps / st.turns : 0,
        shiftsUsed: st.shiftsUsed,
        shiftsDenied: st.shiftsDenied,
        waits: st.waits,
        shardsGot: st.shardsGot,
        bitsGot: st.bitsGot,
        deaths: st.deaths,
        won: st.won,
        wonTick: st.wonTick,
        firstDeathTick: st.firstDeathTick,
        visitedCount: st.visitedCount,
        phaseAlpha: st.phaseTurns[0],
        phaseBeta: st.phaseTurns[1],
        alphaShare: total ? st.phaseTurns[0] / total : 0,
        betaShare: total ? st.phaseTurns[1] / total : 0,
        maxCombo: st.maxCombo,
        moveSuccess: (st.moves + st.bumps) ? st.moves / (st.moves + st.bumps) : 0
      };
    }
  };
}

/* -------------------------------------------------------------------------- */
/* CSV export                                                                 */
/* -------------------------------------------------------------------------- */

var CSV_COLS = ['tick', 'action', 'x', 'y', 'phase', 'shifts', 'shardsLeft', 'status'];

function csvCell(v) {
  var s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(rows) {
  var lines = [CSV_COLS.join(',')];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var cells = [];
    for (var j = 0; j < CSV_COLS.length; j++) {
      cells.push(csvCell(r[CSV_COLS[j]]));
    }
    lines.push(cells.join(','));
  }
  return lines.join('\n') + '\n';
}

var PBTelemetry = {
  makeTracker: makeTracker,
  toCSV: toCSV,
  csvCell: csvCell,
  CSV_COLS: CSV_COLS
};

if (typeof module !== 'undefined' && module.exports) { module.exports = PBTelemetry; }
if (typeof globalThis !== 'undefined' && globalThis.window) { globalThis.window.PBTelemetry = PBTelemetry; }
