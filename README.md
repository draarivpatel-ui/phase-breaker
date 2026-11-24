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
- Full keyboard and touch parity: an on-screen pad, shift, wait and restart
  buttons cover every input on mobile.

## Replay and shareable runs

- Every action is recorded, packed at three bits per action, and encoded as
  a compact base64url run code with a built-in checksum: `r1.<level>.<n>.
  <payload>.<check>`.
- Copy Replay Link writes a `#r=` URL hash. Opening the link replays the
  exact run as a ghost: scrub it, step it, or let it play back frame for
  frame, verified bit for bit by the same deterministic engine.
- Verify Replay re-simulates the recorded actions and confirms the final
  state digest matches, flagging any divergence frame.

## Live telemetry

- A telemetry strip tracks turns, moves, wall bumps, unique tiles visited,
  the best move chain, and a phase split bar showing how many turns were
  spent in each world.
- All counters update live on every input and feed the export pipeline.

## Scenario bench and level designer

- The scenario bench generates boards from editable parameters: seed,
  dimensions, shift budget, wall and hazard density, shard, bit and door
  counts, plus one-click presets. Every generation is deterministic for a
  given seed and only ships boards the built-in BFS verifier proves
  solvable.
- The level designer is a paint grid over every tile type with live
  row-text sync, resize, and a Validate button that searches the full game
  state space before declaring a board winnable.
- Custom boards share through `#d=` design links and can be played
  instantly.

## Verified exports and self-tests

- Export JSON emits a canonical audit file: level identity, full action
  list, replay code, telemetry, and a SHA-256 fingerprint over the
  canonical JSON so any tampering is detectable.
- Export CSV emits the per-turn telemetry table.
- A `src/sha256.js` pure JavaScript SHA-256 (streaming and one-shot, NIST
  vector verified) powers the fingerprints.
- The in-page Run Self-Tests panel executes 24 invariant checks live in the
  browser: RNG streams, SHA-256 vectors, physics rules, replay codec,
  determinism, tamper rejection, the solver, the audit round trip, and
  per-level solvability.
- The favicon is a data URI, so there are no 404s and no external requests
  anywhere.

## Architecture

- `src/core.js` is the whole game. It holds the tile model (`EMPTY`, `WALL`,
  `PHASE_A`, `PHASE_B`, `START`, `GOAL`, `SHARD`, `GATE`, `HAZARD`, `BIT`),
  the phase table, the action cost model, `levelFromRows`, `initialState`,
  `applyAction` and `resetLevel`. It is pure JavaScript with no browser
  globals, exported UMD style as `module.exports` in Node and
  `window.PBCore` in the browser.
- `src/replay.js` is the action codec, run packer, URL hash router,
  recorder, re-simulator and divergence verifier.
- `src/telemetry.js` is the counter and analytics layer plus the CSV
  exporter.
- `src/designer.js` is the BFS solvability verifier (position, phase,
  charges and collectible masks), the design blob codec, validation, and
  the deterministic generator.
- `src/audit.js` builds the canonical audit object and its SHA-256
  fingerprint; `src/sha256.js` is the hash itself.
- `src/selftest.js` is the shared self-test battery that runs identically
  in Node and in the page.
- `js/levels.js` is the authored level data: row strings using `# . A B S G
  * T ! +` plus a shift budget and intro line per level.
- `js/app.js` is the browser shell. It renders the grid, owns keyboard and
  touch input, records runs, drives ghost playback, runs the bench and
  designer, performs verified exports, hosts the self-test panel, tracks
  per-level best step counts in `localStorage`, and announces every state
  change in an `aria-live` region.

## Determinism and share codes

- `makeRNG` is a mulberry32 generator: same 32 bit seed, same stream.
- `fnv1a` / `hashSeed` turn any seed word into a stable 32 bit number.
- `encodeSeedCode` / `decodeSeedCode` emit `PB-<seed>-<level>` codes that
  round trip and reject malformed input.
- `replayHash` hashes the seed, the level fingerprint and every action so a
  run can be verified; `levelFingerprint` covers board shape as well as
  bytes so different dimensions can never collide.
- Replay codes and design blobs carry eight character checksums, so a
  corrupted share link is rejected before it ever touches the engine.

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

Verified: 416 tests, 416 passing, 0 failures. The suite covers
deterministic RNG golden streams, hashing stability, the solidity truth
table across phases and shard counts, movement, wall bumps and the full
action cost model, edge and boundary states, replay packing, checksums and
frame-identical verification, URL hash recovery, SHA-256 NIST vectors and
streaming equivalence, telemetry and CSV output, designer validation, blob
round trips and deterministic generation, audit canonicalization and
fingerprint tamper detection, the self-test battery, and browser shell
integration through a mini-DOM harness that runs the real `index.html` and
`js/app.js` in Node.

The app was also audited in real headless Chromium at 1440x900 and 390x844:
77 checks exercising gameplay, touch input, presets, replay and share
links, verified exports and the in-page self-tests, with zero console
errors, zero page errors, zero external network requests and zero
horizontal overflow.

## License

MIT. See `LICENSE`.
