# Basic MVP with Actor Movement

## Goal
Ship a minimal, replayable slice where one actor moves on a small map, with a visible playing surface, basic controls, and recorded artifacts (no live chain writes; fixture adapters allowed).

## Success Criteria
- Core-as supports an actor with position + vitals, applies move actions deterministically, and renders a buffer with the actor visible.
- Runtime/personas produce movement proposals (from user commands or a simple motivation) and drive ticks end-to-end.
- UI shows the frame buffer, actor properties, and step/play controls; Run Builder configures the run (seed/map, one actor, adapter fixtures).
- Artifacts captured for replay (initial config, actions, frames); node --test suite passes with golden fixtures.

## Steps
1) **Scope + fixtures**:
   - Map/tiles: Deterministic 9x9 grid with internal walls and corridors: `#########`, `#S..#...#`, `#...#.#.#`, `#.#...#.#`, `#.###.#.#`, `#...#...#`, `#.#.#.###`, `#...#..E#`, `#########`. Spawn at (1,1), exit at (7,7); legend maps `#`→wall, `.`→floor, `S`→spawn, `E`→exit with render palette including actor `@`.
   - Actor schema: One ambulatory actor (`actor_mvp`) with position `{x: 1, y: 1}` on spawn, traits/vitals stub `{hp: 10, maxHp: 10, speed: 1}`, optional name/archetype allowed; must start on a spawn tile.
   - Default config: `sim-config-artifact-v1-mvp-grid.json` (seed 1337, round_robin ordering, grid layout/palette/bounds) paired with `initial-state-artifact-v1-mvp-actor.json` (tick 0 actor at spawn).
   - Actions fixture: `action-sequence-v1-mvp-to-exit.json` with ordered move actions (east, east, south, south, east, east, south, south, south, south, east, east) on ticks 1–12 walking the actor from spawn to the exit tile at (7,7).
   - Frames fixture: `frame-buffer-log-v1-mvp.json` capturing frames 0–12 as ASCII buffers with actor overlays plus base tiles/legend shared with the config.
   - File placement: Stored under `tests/fixtures/artifacts/` per `<schema>-v1-<label>.json` naming; references use the shared run id `run_mvp_move`.
   - Tests linkage: `tests/fixtures/basic-mvp-actor-movement.test.js` asserts map/actor defaults, action path to exit, and frame buffers via `node --test "tests/**/*.test.js"`.
   - Docs notes: Map palette/positions and actor defaults captured above for traceability into UI/runtime wiring.

2) **Core-as movement**:
   - State: Represent actor with `{id, x, y, hp, maxHp}` on a grid map; initialize from `InitialState` and enforce spawn-on-valid-tile.
   - Move handling: Interpret `Action.kind === "move"` with `params.direction|from|to`; validate adjacency, tick match, and actor id; reject illegal moves with an event.
   - Bounds/collision: Block walls and map edges per layout legend; allow floor/spawn/exit tiles only; emit `actor_moved` and optional `limit_reached` if exit reached or bounds hit.
   - Rendering: Build deterministic ASCII frame buffer (base tiles + actor overlay `@`) matching `frame-buffer-log-v1-mvp.json`; include frame meta (tick, map size).
   - Tests: Core unit tests for legal/illegal moves, collision with walls, and render snapshots vs goldens; ensure deterministic seed usage; add a golden frame snapshot for the MVP map/actor.

3) **Bindings exposure**:
   - API surface: Expose typed helpers in bindings-ts to load the MVP scenario, pack/unpack move actions, read actor pose/vitals, and render frame buffers (width/height/base tiles and overlay cells as chars).
   - Observation shape: Provide a minimal observation object `{tick, actor: {id, x, y, hp, maxHp}, map: {width, height}}` suitable for personas; keep schema-stable and serializable.
   - Frame metadata: Return frame buffers as arrays of strings plus actor positions keyed by id to mirror `frame-buffer-log-v1-mvp.json`.
   - Stability tests: Add bindings tests that call into WASM and assert the observation/frame shapes are stable and match fixtures; include packing/decoding of move actions to ensure deterministic encoding.

4) **Runtime loop**:
   - Tick phases: Moderator drives ticks; on each tick, collect user commands (if provided) else default Actor persona emits a “move toward exit” proposal using the bindings observation shape.
   - Action formation: Pack proposals into runtime Action artifacts (kind `move`, params `{direction, from, to}`) and into core bit-packed move values using bindings helpers; include tick/actor ids deterministically.
   - Determinism: Seed runtime with config seed, stable ordering (round_robin), and no time-based randomness; ensure action artifacts/logs are deterministic and align with fixtures.
   - Artifacts: Produce action log artifacts for the run (ordered by tick), plus frame outputs from replay; write under `artifacts/...` using existing CLI out-dir wiring.
   - Tests: Add runtime tests that given the MVP fixtures (sim config + initial state) and default motivation, the generated actions match `action-sequence-v1-mvp-to-exit.json` and frames match `frame-buffer-log-v1-mvp.json`.

5) **UI (playing surface)**:
   - Viewport: Render the 9x9 frame buffer as monospace grid (respect palette chars), with a subtle card and fixed-size tiles; support desktop + mobile widths.
   - Actor panel: Show actor name/id, position, hp/maxHp, and tick; keep it compact and aligned to the viewport.
   - Controls: `[step-][play/pause][step+]` plus tick indicator; play = auto-advance using runtime actions; step buttons call runtime tick once; disable buttons at exit/end.
   - Data wiring: Consume runtime frame buffers/observations (from bindings helpers) to update grid + panel; drive actions via the runtime harness `runMvpMovement` or user commands.
   - Tests: Add DOM/snapshot test for the rendered grid + controls (initial state), and a play/step interaction test to ensure frames advance and controls disable at the exit frame.

6) **Run Builder slice**:
   - Inputs: Seed (numeric, default 1337), map preset (MVP 9x9), actor name/id, vitals defaults for health/mana/stamina/durability (each with current/max/regen), optional adapter fixture set; no wallet/mint fields.
   - Validation: Inline badges for invalid seed/empty name; disable start/run until required fields valid; show selected fixture mode (fixture/live).
   - Preview: Show a summary card of the chosen config (seed, map, actor, fixtures) and link to the underlying fixtures used.
   - Actions: “Start run” builds the config/state and drives the movement harness; “Reset” restores defaults; keep outputs deterministic.
   - Tests: DOM/snapshot for initial form + validation states; flow test that submits defaults and confirms generated actions/frames align with the MVP fixtures.

7) **Artifacts/replay**:
   - Capture: Persist sim config, initial state, ordered action log, and tick frames (buffers) for the MVP run; reuse `run_mvp_move` ids and schema v1 files under `artifacts/...`.
   - Replay path: CLI/runtime should accept recorded actions + config to regenerate frames; ensure core emits identical frames when fed the same action sequence.
   - Validation: Integration test that loads the recorded artifacts and asserts frames match `frame-buffer-log-v1-mvp.json`; include negative/altered action sequence to confirm mismatch detection.
   - Outputs: Write replay summary (match boolean), effects log, and any inspector snapshot in `artifacts/.../replay`; keep metadata normalized for diffs.

8) **Cleanup + docs**:
   - Docs: Update README and docs/implementation plans to reflect MVP movement UI, run builder inputs (vitals defaults), and replay artifacts location.
   - Tests: Run `node --test "tests/**/*.test.js"` and document any skipped cases; ensure golden fixtures are referenced in test descriptions.
   - Known gaps: Log any missing features (multi-actor, collisions beyond walls, dynamic maps) and next steps in the plan file.
   - Hygiene: Normalize metadata (ids/timestamps) in artifacts for stable diffs; ensure no stray TODOs or console logs in UI/runtime.
