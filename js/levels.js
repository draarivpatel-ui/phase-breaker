'use strict';
/*
 * PhaseBreaker level data. Rows are authored strings: '#' wall, '.' floor,
 * 'A' alpha gate (solid in ALPHA), 'B' beta gate (solid in BETA), 'S' start,
 * 'G' goal, '*' shard, 'T' gate, '!' hazard, '+' bit. Every level is small
 * enough to check by eye and each ships with its solution in the test suite.
 */
(function (root) {
  const LEVELS = [
    {
      id: 1,
      name: 'Two Doors',
      intro: 'Two phase doors guard the exit. Shift to slip through each one.',
      shifts: 3,
      rows: [
        '#############',
        '#S.+.A...B.G#',
        '#############'
      ]
    },
    {
      id: 2,
      name: 'Key and Gate',
      intro: 'The exit door wants both shards before it opens.',
      shifts: 2,
      rows: [
        '###############',
        '#S..*....T..G.#',
        '#.#####.#####.#',
        '#.#...#.#...#.#',
        '#.#...#.#...#.#',
        '#.#...#.#...#.#',
        '#.#####.#####.#',
        '#.+...*.....#.#',
        '###############'
      ]
    },
    {
      id: 3,
      name: 'Cross Currents',
      intro: 'One shard sits behind an alpha door and the gate wants them all.',
      shifts: 2,
      rows: [
        '#################',
        '#S.*...A.*..#TG##',
        '#.###########.###',
        '#.+..*....B...###',
        '#################'
      ]
    }
  ];

  root.PHASE_BREAKER_LEVELS = LEVELS;
  if (typeof module === 'object' && module.exports) module.exports = { LEVELS: LEVELS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
