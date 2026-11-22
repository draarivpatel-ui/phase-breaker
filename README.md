# Phase Breaker

A two-world grid puzzle that runs entirely in the browser. Walk the board,
spend shift charges to flip between the ALPHA and BETA worlds, slip through
phase doors, gather every shard, and reach the exit. No dependencies, no
build step, no network calls: every rule lives in a pure deterministic core
that the browser shell and the Node test suite share.

**Live demo:** [https://aariv.me/phase-breaker/](https://aariv.me/phase-breaker/)

## How it plays

- Arrow keys walk. Bumping a wall still spends the turn.
- `Space` or `X` shifts between ALPHA and BETA, costing one shift charge.
- `W` waits a turn, `R` restarts the level.
- Alpha doors are solid in ALPHA, beta doors are solid in BETA; the door of
  the other world renders as a ghost.
- Shards open the gate only when every shard on the level is collected.
- Hazard tiles are walkable but lethal. `+` bit tiles grant one extra shift.
- Three authored levels ship in `js/levels.js` (Two Doors, Key and Gate,
  Cross Currents), each with a verified solution in the test suite.

## Architecture

- `src/core.js` is the whole game. It holds the tile model (`EMPTY`, `WALL`,
  `PHASE_A`, `PHASE_B`, `START`, `GOAL`, `SHARD`, `GATE`, `HAZARD`, `BIT`),
  the phase table, the action cost model, `levelFromRows`, `initialState`,
  `applyAction` and `resetLevel`. It is pure JavaScript with no browser
  globals, exported UMD style as `module.exports` in Node and
  `window.PBCore` in the browser.
- `js/levels.js` is the authored level data: row strings using `# . A B S G
  * T ! +` plus a shift budget and intro line per level.
- `js/app.js` is a thin browser shell. It renders the grid, owns keyboard
  and touch input, tracks per-level best step counts in `localStorage`, and
  announces every state change in an `aria-live` region.

## Determinism and share codes

- `makeRNG` is a mulberry32 generator: same 32 bit seed, same stream.
- `fnv1a` / `hashSeed` turn any seed word into a stable 32 bit number.
- `encodeSeedCode` / `decodeSeedCode` emit `PB-<seed>-<level>` codes that
  round trip and reject malformed input.
- `replayHash` hashes the seed, the level fingerprint and every action so a
  run can be verified; `levelFingerprint` covers board shape as well as
  bytes so different dimensions can never collide.

## Local development

Open `index.html` in any modern browser, or serve the folder over HTTP:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Run the test suite (Node's built-in runner, no packages to install):

```sh
node --test test/
```

Verified: 29 tests, 29 passing. The suite covers deterministic RNG, hashing
stability, the solidity truth table across phases and shard counts, movement
and wall bumps, shift charges, gates, hazards, bits, `resetLevel`
restoration, seed-code round trips, replay hashing, malformed level
rejection, and a full solution replay for each shipped level.

## License

MIT. See `LICENSE`.
