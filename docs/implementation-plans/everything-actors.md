# Everything Actors Plan

Goal: Make the Actor the core gameplay primitive across core-as, bindings, runtime personas, ports/adapters, CLI, and UI. Actors must cover stationary tile-actors (floor tiles with durability only), unpassable wall/barrier actors, and motivated protagonists/antagonists. Actor vitals default to health/mana/stamina/durability with current/max/regen, and all action/render outputs remain deterministic and replayable.

## 1) Core-as Actor Model
1. [complete] Define canonical Actor state with kind (stationary/barrier/motivated), position, and vitals (health/mana/stamina/durability current/max/regen).
   - Requirement: Introduce a single Actor state shape in core-as that covers tile actors and motivated actors with kind, position, and vitals (health/mana/stamina/durability each with current/max/regen).
   - Behavior details: kind drives passability and intent; position is grid coords; vitals defaults are explicit and deterministic; absence of a vital is invalid.
   - Data shape proposal (core-as): Actor { id, kind, position {x,y}, vitals { health {current,max,regen}, mana {current,max,regen}, stamina {current,max,regen}, durability {current,max,regen} } }
   - kind enum: stationary, barrier, motivated.
   - Tests: Add a fixture-backed test that loads an actor config and asserts the canonical shape, defaults applied, and stable serialization; add a negative fixture missing a vital or regen value and assert deterministic error.
   - Code touchpoints: packages/core-as/assembly/ for Actor type and validation; contracts or schema definitions in runtime/bindings only if they mirror core-as (no IO in core-as).
   - Determinism: Stable field ordering in snapshots; consistent defaults for missing optional fields if any are allowed (prefer explicit fields only to avoid implicit defaults).
   - Notes: Ensure no IO in core-as; no dependency direction violations; keep diff small and focused on the actor model shape and validation helpers.
2. [complete] Represent tile actors (floor, wall, barrier) as Actors in state and map occupancy, with passability derived from actor kind.
   - Requirement: Model each tile as an Actor in core-as state (stationary floor, barrier, wall) and drive walkability from the actor kind, not from tile enums; support irregular walkable surfaces within a fixed max grid.
   - Behavior details: occupancy map resolves the tile actor at a position; motivated actors can overlay but do not replace the tile actor; passable = stationary, blocked = barrier/wall; non-walkable cells in the grid are represented by barrier/wall tile actors even if the grid rectangle is larger than the playable area.
   - Data shape proposal (core-as): maintain a tile-actor list plus a fixed-size occupancy index map (cell -> tile actor id/index); keep motivated actors in a separate list or overlay map.
   - Tests: Add fixtures with explicit wall/barrier tile actors; assert movement is blocked by barrier/wall actor kinds and allowed on stationary tiles; render base tiles derived from tile actors.
   - Determinism: Stable ordering for tile actor creation and a fixed map stride for occupancy; avoid any hash-based maps.
   - Notes: Keep map metadata (spawn/exit) consistent with tile actors; no IO; keep diff small by layering tile-actor occupancy on top of existing grid until fully migrated; treat irregular shapes as stationary walkable islands inside a full grid of barrier/wall tile actors.
3. [complete] Add deterministic validation for actor placement (spawn, bounds, collisions) and emit stable events on invalid config.
   - Requirement: Validate actor placement at load time for spawn alignment, within-bounds positions, and collisions (motivated vs tile actors and motivated vs motivated), emitting stable error events on invalid inputs.
   - Behavior details: spawn actor must start on a stationary tile actor; actors may not overlap; positions outside bounds are rejected deterministically; invalid configs must not mutate world state beyond a reset.
   - Data shape proposal (core-as): add a placement validation routine that checks each actor against tile-actor occupancy and a fixed-size occupancy map for motivated actors; return a ValidationError code that maps to a stable effect/event.
   - Events: introduce `config_invalid` or reuse `action_rejected` with explicit placement error codes; keep ordering deterministic (first failing actor by stable sort, then first failing rule).
   - Tests: Add fixtures with out-of-bounds actor positions, spawn-on-barrier, and actor overlap; assert validation emits deterministic errors and no partial state changes occur.
   - Determinism: Use stable actor ordering (id sort or insertion order) and fixed grid strides; avoid hash iteration; ensure validation scans are row-major and consistent.
   - Notes: Keep validation policy-free; do not perform IO; keep changes minimal until multi-actor support lands.

## 2) Core-as Actor Rules
1. [completed] Implement movement rules respecting barrier actors and wall actors as unpassable.
   - Requirement: Movement validation must consult tile actor kind, treating barrier and wall tile actors as unpassable while allowing stationary tiles.
   - Behavior details: moving into a barrier/wall tile actor emits a deterministic blocked error; movement into stationary tiles proceeds; motivated actors cannot move into occupied motivated-actor cells.
   - Data shape proposal (core-as): use the tile-actor occupancy/kind map for passability; use a motivated occupancy map for collision checks when multi-actor is enabled.
   - Events: reuse `actor_blocked`/`action_rejected` errors for blocked movement; keep error codes stable (e.g., `BlockedByWall` or `ActorBlocked`).
   - Tests: add a barrier grid fixture where a move east into a barrier is rejected; verify allowed movement along stationary tiles remains unchanged.
   - Determinism: evaluate movement with fixed ordering; never branch on hash iteration; emit exactly one stable error for a blocked move.
2. [complete] Add durability interactions for collisions or interactions with barrier actors (durability loss events).
   - Requirement: When a motivated actor attempts to move into a barrier/wall tile actor, emit a durability loss event for the barrier actor (and optionally for the moving actor if needed), using deterministic deltas.
   - Behavior details: durability decreases by a fixed amount per collision; clamp at zero; repeated collisions produce repeated events but do not change other state.
   - Data shape proposal (core-as): add durability tracking for tile actors (likely a per-tile durability array aligned to the tile-actor list) and a deterministic event payload encoding (actorId + delta).
   - Events: introduce `durability_changed` (or reuse `actor_blocked` with a companion durability effect); ensure stable ordering when multiple events are emitted.
   - Tests: add a barrier collision fixture and assert durability drops per collision; assert durability does not go negative and events are stable.
   - Determinism: fixed damage values, row-major traversal for multi-actor collisions, and stable event ordering by actor index.
3. [complete] Emit actor-specific events (actor_moved, actor_blocked, durability_changed) and stable snapshots.
   - Requirement: Emit actor-specific effects for movement success, movement blocked, and durability changes with stable payload encoding and ordering.
   - Behavior details: `actor_moved` should include actor id and new position; `actor_blocked` should include actor id and attempted target; `durability_changed` should include affected actor id and delta; snapshots should be stable across runs.
   - Data shape proposal (core-as): add effect payload encoders (id + coords/delta packed into 32-bit ints or multiple effects) and a snapshot API that returns stable state needed for replay.
   - Events: prefer new effect kinds for `actor_blocked` and `durability_changed` rather than overloading `action_rejected`; keep errors separate from outcomes.
   - Tests: extend movement tests to assert effect kinds and decoded payloads; add a snapshot test that reads actor position, tile actor kinds, and durability state deterministically.
   - Determinism: emit effects in a stable order (action outcome first, then side effects) and keep payload packing consistent (document bit layout).

## 3) Bindings + Observation Shapes
1. [completed] Expose actor list observation (positions + vitals) and per-tile actor classification to bindings-ts.
   - Requirement: Bindings must expose a stable actor list (id, kind, position, vitals) plus per-tile actor kind/occupancy so UIs and personas can render/decide deterministically.
   - Behavior details: observation should include motivated actors and tile actors separately; per-tile classification should reflect tile-actor kinds (stationary/barrier) and any motivated occupancy overlay.
   - Data shape proposal (bindings): `readObservation` returns `{ tick, actors: [...], tiles: { width, height, kinds } }`, where `actors` includes vitals and `kinds` is a 2D array of tile actor kinds.
   - Tests: extend bindings tests to assert observation lists actor vitals and tile classifications for the MVP grid and barrier grid.
   - Determinism: consistent actor ordering (id sort or stable insertion) and row-major tile ordering; no reliance on JS object iteration.
   - Notes: keep bindings thin; do not synthesize state beyond what core exposes; prefer core getters for vitals and tile actor lists.
2. [completed] Provide stable render buffers that include actor glyph overlays for both tile actors and motivated actors.
   - Requirement: Render buffers must overlay motivated actors on top of tile actors while keeping base tiles derived from tile actors (floor/wall/barrier/spawn/exit).
   - Behavior details: base buffer is tile actors only; overlay buffer replaces the base glyph at motivated actor positions with the actor glyph; barrier tiles use a distinct glyph (e.g., "B").
   - Data shape proposal (bindings): `renderFrameBuffer` returns `{ tick, buffer, baseTiles, legend, actorPositions }` with `buffer` containing overlays and `baseTiles` containing tile-only glyphs.
   - Tests: extend render buffer fixtures to include barrier tiles and ensure overlays are stable across ticks; verify actor glyphs are deterministic.
   - Determinism: fixed render order (tile first, then motivated overlays), no random palettes, and stable legend mappings.
   - Notes: keep ASCII roguelike style and reuse existing legend in sim-config fixtures.
3. [completed] Add bindings tests covering observation shapes and render buffers.
   - Requirement: Bindings tests must validate the observation contract (actors/vitals + tile kinds) and render buffer outputs (baseTiles/legend/overlay) for MVP and barrier scenarios.
   - Behavior details: observation includes a stable `actors` array with full vitals and `tiles.kinds` in row-major order; render buffers include `baseTiles` and `buffer` with motivated overlay glyphs; legend includes barrier glyph.
   - Data shape proposal (tests): assert `readObservation` returns `{ tick, actors, tiles }` with `actors[0].vitals.*` and `tiles.kinds[y][x]` numeric kinds; assert `renderFrameBuffer` returns `{ tick, baseTiles, legend, buffer, actorPositions }`.
   - Fixtures: reuse `frame-buffer-log-v1-mvp.json` for base tiles + legend; add/extend `tile-actor-grid-v1-mvp-barrier.json` for barrier base tiles and spawn coordinates.
   - Tests: extend `tests/bindings/movement.test.js` to check `baseTiles`, `legend`, and a barrier overlay frame; add assertions that barrier tiles render as "B" in `baseTiles`.
   - Determinism: ensure tests do not rely on object key order; compare arrays and explicit fields; avoid timing assumptions.
   - Notes: keep tests isolated to bindings; if core changes require WASM rebuild, note `pnpm run build:wasm` in the pre-merge checklist.

## 4) Runtime Personas and Tick Loop
1. [completed] Extend Actor persona to output movement proposals based on observation (default: move toward exit).
   - Requirement: Runtime personas must generate deterministic movement proposals from observations, with a default persona that moves the motivated actor toward the exit.
   - Behavior details: read `readObservation` for actor position and grid kinds, locate the exit from the base tiles/legend or sim config, compute a shortest path on stationary tiles only, and propose a single-step move per tick; if no path exists, emit no proposal.
   - Data shape proposal (runtime): persona returns `{ actorId, kind: "move", params: { direction, from, to } }` with tick set by the runtime action packer; proposals do not mutate core state directly.
   - Algorithms: use a deterministic BFS with row-major neighbor order (north, east, south, west); treat barrier/wall kinds as blocked; ignore motivated occupancy until multi-actor support lands.
   - Tests: add a runtime persona test that uses the MVP fixture to confirm the default persona proposes east, east, south; add a barrier fixture test that yields no proposal or detours deterministically if a path exists.
   - Determinism: fixed neighbor ordering and stable tie-breaking; avoid randomness; ensure identical proposals across runs for the same observation.
   - Notes: keep persona pure (no IO); keep the diff small; align action encoding with existing `packMoveAction` usage.
2. [completed] Ensure runtime packs action artifacts for motivated actors and ignores stationary/barrier actors.
   - Requirement: Runtime must only emit Action artifacts for motivated actors; stationary/barrier actors are excluded from proposal/action packing.
   - Behavior details: proposals from personas include `actorId`; runtime checks actor kind against the observation (or actor registry) and drops any actions for non-motivated kinds; motivated actors with missing observation are skipped deterministically.
   - Data shape proposal (runtime): action packing uses existing `buildAction` with actor id and move params; add a filter helper `isMotivatedActor(actorId, observation)` that inspects observation actors/kinds.
   - Tests: add runtime test where observation includes stationary/barrier actors and assert only motivated proposals become actions; include a mixed list with stable ordering.
   - Determinism: preserve proposal order for motivated actors; stable filtering without hash iteration; document skip reasons in trace if needed.
   - Notes: keep behavior policy-free; avoid IO; align with `ActorKind` enum values from core-as.
3. [completed] Add runtime tests that map actor proposals to core actions and validate deterministic replay.
   - Requirement: Runtime must map actor persona proposals into core action artifacts and produce deterministic frames on replay for identical inputs.
   - Behavior details: proposals become `Action` artifacts (move with from/to/direction) packed via runtime helpers, applied to core, and replayed with identical frame buffers; stationary/barrier proposals are ignored.
   - Data shape proposal (tests): use an MVP observation + proposals fixture to build actions; compare actions against `action-sequence-v1-mvp-to-exit.json` and compare rendered frames against `frame-buffer-log-v1-mvp.json`.
   - Tests: add a runtime test that feeds deterministic proposals into the actor persona, maps to core actions, applies them to core-as, and asserts replayed frames match the fixture; include a negative case with non-motivated proposals filtered out.
   - Determinism: action packing uses stable actor ids and tick ordering; replay compares exact frame buffers and action sequence; no randomness.
   - Notes: keep tests in `tests/runtime/` and reuse bindings helpers (`packMoveAction`, `renderFrameBuffer`) for encoding/verification.

## 5) Ports, Adapters, and CLI
1. [completed] Extend CLI flags to configure actor sets (tile actors + motivated actors) and vitals defaults.
   - Requirement: CLI must accept flags to describe tile actors (walls/barriers/floor overrides) and motivated actors (id, position, vitals) with deterministic defaults.
   - Behavior details: flags map directly to sim-config/initial-state artifacts; missing vitals fill from explicit defaults; tile actor flags allow irregular shapes via barrier/wall lists; motivated actors are validated against bounds.
   - Data shape proposal (CLI): add `--actor` (id,x,y,kind), `--vital` (actorId,vital,current,max,regen), and `--tile-barrier`/`--tile-wall` lists; keep defaults aligned to `sim-config-artifact` + `initial-state` schemas.
   - Tests: add CLI fixture-based tests that parse flags into deterministic artifacts; include negative cases for missing vitals or out-of-bounds placements.
   - Determinism: flag parsing order is stable; repeated flags append deterministically; serialization keeps stable field ordering.
   - Notes: update `packages/adapters-cli/README.md` examples and mirror existing flag patterns in `packages/adapters-cli/src/cli/ak.mjs`.
2. [completed] Ensure adapters produce deterministic artifacts for actor configs and action logs.
   - Requirement: Adapter outputs for actor configs and action logs must be stable across runs for identical inputs (no timestamp drift in payloads beyond meta, no random ordering).
   - Behavior details: adapter writes actor config artifacts with sorted actor lists and stable vitals ordering; action logs preserve proposal order and include actor ids/kinds; any derived fields are deterministic.
   - Data shape proposal (adapters): emit `resolved-sim-config.json`, `resolved-initial-state.json`, and `action-log.json` with stable meta ids (or normalized in tests) and explicit schema versions.
   - Tests: add fixture-based tests that run CLI with actor flags and compare normalized outputs across two runs; extend replay/golden tests to verify action log stability for the same input actions.
   - Determinism: avoid `Date.now()` in artifact bodies; if meta includes timestamps, normalize in tests; keep list ordering stable and avoid object-key iteration for serialization.
   - Notes: keep adapters thin; avoid core-as dependencies; reuse existing fixture helpers for normalization.
3. [completed] Add CLI tests for actor-specific scenarios and artifact output stability.
   - Requirement: CLI tests must cover actor-specific scenarios (motivated + tile actors, barriers) and ensure emitted artifacts are stable across runs.
   - Behavior details: run CLI with actor flags and tile overrides, verify `resolved-*` artifacts, `action-log.json`, and tick frames are deterministic; include barrier placement and vitals defaults.
   - Data shape proposal (tests): compare outputs from two runs (normalize meta ids/timestamps) for equality; verify actor ordering and vitals completeness; validate barrier tiles in resolved sim config.
   - Tests: add tests under `tests/adapters-cli/` for actor-specific flags (already started), plus a golden comparison test using fixtures; add negative tests for invalid actor kinds or missing vitals.
   - Determinism: normalize `meta` fields and compare structural equality; use fixed inputs and seeds; avoid relying on filesystem ordering.
   - Notes: keep tests bounded to CLI adapter behavior; reuse helper functions from existing CLI tests.

## 6) UI (Actor-centric)
1. [completed] Display actor list (tile actors + motivated actors) with vitals and positions.
   - Requirement: UI must render a deterministic actor list including motivated actors and tile actors, showing id, kind, position, and vitals (health/mana/stamina/durability).
   - Behavior details: motivated actors appear in a primary list; tile actors may be grouped or toggled to avoid noise; vitals display current/max/regen consistently; ordering is stable (id sort).
   - Data shape proposal (UI): consume `readObservation` actors array and tile actor list (if exposed) and render a unified list; each entry includes `{ id, kind, position, vitals }`.
   - Tests: add UI tests that inject a stub core with multiple actors and verify the rendered list contains vitals and positions for each actor; add a regression test for ordering.
   - Determinism: do not rely on DOM insertion order from object iteration; sort lists explicitly; keep vitals fields in a fixed order.
   - Notes: maintain ASCII UI style; keep list readable on mobile by collapsing vitals into a compact grid if needed.
2. [completed] Render the grid with actor-based tiles and overlays; maintain the ASCII roguelike style.
   - Requirement: UI must render the base grid from tile actors and overlay motivated actors, preserving ASCII glyphs (walls, floors, barriers, spawn, exit, actor).
   - Behavior details: base tiles reflect `renderBaseCellChar`; overlay layer uses `renderCellChar` or explicit actor overlay from observation; barrier tiles display "B" consistently.
   - Data shape proposal (UI): use `renderFrameBuffer` (`buffer` + `baseTiles`) and `legend` to render; avoid deriving glyphs from raw tiles in UI.
   - Tests: extend UI tests to assert barrier glyphs appear in the base layer and actor overlays match buffer output; verify base/overlay separation in the UI text.
   - Determinism: avoid random palettes; ensure render order is base then overlay; stable formatting (fixed-width, monospace).
   - Notes: keep the existing frame display; optional toggle to show base vs overlay buffers for debugging.
3. [completed] Add UI tests for actor display and interaction controls.
   - Requirement: UI tests must validate actor list rendering (motivated + tile actors), vitals formatting, and playback controls (step, play/pause, reset).
   - Behavior details: actor list includes id/kind/position/vitals; tile actor list toggles render content; controls update tick, status, and disabled states deterministically.
   - Data shape proposal (tests): use stubbed DOM elements with `textContent`/`disabled`; run `setupPlayback` and assert list strings include vitals in fixed order; verify base/overlay buffers update on step.
   - Tests: extend `tests/ui-web/mvp-playing-surface.test.mjs` to assert actor list content and base tiles; add a dedicated UI test for play/pause toggling and reset state.
   - Determinism: fixed seeds; avoid timers by invoking control functions directly; assert exact strings where stable.
   - Notes: keep tests in `tests/ui-web/` and reuse existing WASM stubs.

## 7) Fixtures and Tests
1. [completed] Add fixtures for tile actors, barrier actors, and motivated actors with vitals defaults.
   - Requirement: Provide fixtures that explicitly cover tile actors (floor/wall), barrier actors, and motivated actors with full vitals defaults.
   - Behavior details: fixtures must be deterministic, include schema + schemaVersion, and place actors within bounds; vitals include current/max/regen for all four keys.
   - Data shape proposal (fixtures): add `tile-actor-grid` fixtures for base tiles + kinds; add `actor-state` fixtures for motivated actors with vitals defaults; add a barrier variant with durability initialized.
   - Tests: extend fixture validation tests to load new fixtures and assert required fields; reuse existing core-as tests for placement and snapshot determinism.
   - Determinism: fixed meta timestamps; stable ordering for actor lists and tile rows.
   - Notes: store fixtures under `tests/fixtures/` with clear labels and versioned names.
2. [completed] Add negative fixtures for invalid actor placement and missing vitals.
   - Requirement: Add invalid fixtures that exercise placement validation (out-of-bounds, spawn-on-barrier, overlap) and vitals completeness (missing vital or missing regen).
   - Behavior details: placement fixtures must target deterministic validation errors; vitals fixtures should omit one vital or one regen field to trigger stable MissingVital/InvalidVital errors.
   - Data shape proposal (fixtures): store invalid placement inputs under `tests/fixtures/actor-placement-v1-*.json` and vitals errors under `tests/fixtures/artifacts/invalid/actor-state-v1-*.json` with schema/schemaVersion and minimal payloads.
   - Tests: extend fixture validation tests to load each invalid fixture and assert the missing fields; extend core-as placement tests to consume placement fixtures and assert error codes.
   - Determinism: keep actor ordering stable in fixtures; avoid random ids; use fixed positions to target specific error codes.
   - Notes: keep negative fixtures minimal and focused; re-use existing schema names and versioning conventions.
3. [completed] Add golden render frames that include tile actors and motivated actors.
   - Requirement: Add golden frame fixtures that capture base tiles (tile actors) and overlays (motivated actors) for MVP and barrier scenarios.
   - Behavior details: frames must include `baseTiles`, `legend`, `buffer`, and `actorPositions` with motivated overlays; barrier tiles render as "B" in base tiles and are not overwritten unless occupied.
   - Data shape proposal (fixtures): store under `tests/fixtures/artifacts/` as `frame-buffer-log-v1-mvp-barrier.json` (or similar) with schema/version and stable meta; keep ordering identical to action sequence ticks.
   - Tests: extend bindings/render tests to load the new fixture and assert `renderFrameBuffer` matches baseTiles + overlay buffer for the barrier case; reuse existing frame buffer log checks for MVP.
   - Determinism: fixed legend, stable actor ids, row-major buffers; normalize or fix meta timestamps to avoid drift.
   - Notes: reuse existing action sequence fixtures where possible; keep fixture payloads minimal and aligned to `FrameBufferLog` schema.

## 8) Cleanup + Docs
1. [completed] Update README/docs to describe the actor-centric model and vitals defaults.
   - Notes: Added an actor-centric overview to `README.md` and `docs/README.md` with explicit vitals defaults.
2. [completed] Run `node --test "tests/**/*.test.js"` and record any skips/gaps.
   - Run: `node --test "tests/**/*.test.js"`
   - Result: 134 tests passed, 0 skipped, 0 failed.
3. [completed] Log next steps (multi-actor AI, richer interactions, procedural maps).
   - Next steps: multi-actor AI personas (coordination + collision policy), richer interactions (combat/durability effects, abilities), procedural/irregular map generation.
