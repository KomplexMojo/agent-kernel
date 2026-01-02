Goal: Make Configurator the entry point for building levels and actor loadouts, producing deterministic sim config + initial state artifacts with validated equipment presets.

## 1) Configurator Responsibilities and Inputs
1. [complete] Define Configurator inputs for level generation (size, theme, irregular shape, spawn/exit constraints).
   - Requirement: Define the configurator input shape for level generation, covering grid size, optional seed/theme, irregular shape profile, and spawn/exit constraints in a single deterministic schema.
   - Behavior details: size drives bounds; theme is a token only (no IO); shape profile maps to walkable masks (rectangular, sparse islands, clustered islands); spawn/exit constraints include min distance and edge vs interior bias; connectivity requirements are explicit.
   - Data shape proposal (configurator): `levelGen { width, height, seed?, theme?, shape { profile, density?, clusterSize? }, spawn { edgeBias?, minDistance? }, exit { edgeBias?, minDistance? }, connectivity { requirePath? } }`.
   - Defaults: provide deterministic defaults for optional fields (e.g., profile=rectangular, edgeBias=false, minDistance=0) and define reject vs clamp rules for invalid sizes/constraints.
   - Notes: keep schema located with other configurator inputs; ensure it maps cleanly into sim-config + initial-state artifacts without adding IO or new dependencies.
2. [complete] Define actor equipment presets (weapons, affinities, capabilities) and loadout schema for motivated actors.
   - Requirement: Define equipment presets and loadout schema for motivated actors with **affinity expressions only** (no martial weapons); affinities are mana-governed and expressed as push (external attacks), pull (internal buffs), or emit (area effects), with stacking to enhance capability strength.
   - Behavior details: an affinity preset declares its expression (push/pull/emit), mana cost, and stack rules; actors equip affinities with an expression; stacked push enhances attack potency (e.g., x2 fire push), stacked pull enhances buff potency, stacked emit increases area potency; no swords/bows/weapons appear in schema or defaults.
   - Data shape proposal (configurator): `loadouts { actorId, affinities: [ { expression: "push"|"pull"|"emit", kind: "fire"|"water"|..., stacks: number, presetId } ] }` plus `affinityPresets { id, kind, expression, manaCost, effects { attack?, buff?, area? }, stack { max, scaling } }`.
   - Defaults: explicit defaults for empty affinity expressions, stacks=1, and manaCost if omitted; reject invalid affinity kinds or expression mismatches; disallow non-affinity equipment.
   - Tests: fixture-backed loadout/preset validation with cases for missing presets, invalid affinity kinds, and stacked affinities; add negative fixtures under `tests/fixtures/artifacts/invalid` for non-affinity equipment or invalid expression types.
   - Determinism: stable ordering of affinity entries, deterministic stacking/scaling rules, and fixed mana cost evaluation; avoid hash iteration when applying loadouts.
   - Notes: align affinity kinds/expressions with a single enum list; ensure presets/loadouts map cleanly into artifacts used by runtime and core-as without introducing IO.
3. [complete] Specify deterministic defaults and validation rules for missing or malformed inputs.
   - Requirement: Define a consistent defaulting/validation policy for configurator inputs (levelGen + affinity presets/loadouts) with explicit error codes and deterministic clamping rules.
   - Behavior details: reject missing required fields (width/height, preset ids, actor ids); apply explicit defaults for optional fields (seed/theme/edgeBias/minDistance, manaCost, stacks) without implicit inference; clamp numeric ranges where allowed (e.g., minDistance, density) and surface warnings deterministically.
   - Data shape proposal (validation result): `{ ok, errors: [{ field, code }...], warnings: [{ field, code, from, to }...], value }` where `value` is normalized only when `ok=true`.
   - Defaults: document allowed defaults in one place (levelGen profile=rectangular, edgeBias=false, minDistance=0, requirePath=true, manaCost=0, stacks=1); no defaults for required identifiers or kinds.
   - Tests: add fixture-backed tests asserting error codes for missing required fields, invalid kinds/slots, and out-of-range numbers; include a clamping test to ensure warnings are stable.
   - Determinism: preserve input ordering for error reporting; avoid hash iteration; ensure validation returns stable error ordering and does not depend on runtime time/seed.
   - Notes: keep validators in runtime (not core-as); ensure validation helpers are reused by CLI/UI adapters and persona inputs to avoid drift.

## 2) Level Generation (Grid + Irregular Shapes)
1. [complete] Implement deterministic level generation for grid layouts with irregular walkable islands.
   - Requirement: Implement a deterministic grid generator that can output rectangular maps and irregular walkable islands based on `levelGen.shape` profile inputs, producing a stable tile mask for walls/floors.
   - Behavior details: rectangular fills all inner tiles as walkable; sparse islands scatters walkable cells by density with deterministic clustering; clustered islands grows a few seeded blobs; non-walkable cells become wall/barrier tiles; spawn/exit are placed only on walkable tiles.
   - Data shape proposal (layout data): `{ width, height, tiles, legend, spawn, exit, bounds }` where `tiles` is a row-major array of strings and `legend` maps glyphs to tiles (wall/floor/spawn/exit/barrier).
   - Defaults: when no shape profile is given, default to rectangular; if density/clusterSize missing, fall back to deterministic defaults; if profile is unknown, fail validation upstream.
   - Tests: add fixture-backed tests for each profile (rectangular, sparse islands, clustered islands) to assert deterministic `tiles`, `spawn`, and `exit` for a fixed seed.
   - Determinism: seed all randomness from `levelGen.seed`; use fixed neighbor ordering and stable row-major iteration; avoid non-deterministic data structures.
   - Notes: keep generator pure and in runtime (no core-as IO); align tile glyphs with existing render legend (`#`, `.`, `S`, `E`, `B`).
2. [complete] Emit tile actor kinds (stationary/barrier) with spawn/exit placement rules.
   - Requirement: Emit tile actor kinds for each grid cell (stationary walkable vs barrier/non-walkable) and enforce spawn/exit placement rules derived from level constraints.
   - Behavior details: walkable mask cells map to stationary tiles; non-walkable cells map to barrier tiles; **trap tiles** are a variation on tile actors (stationary/barrier subtype) with mana + durability only (no health/stamina), invested with an affinity (e.g., fire) that can externalize (fireball) or internalize (burn aura) and may have motivations beyond mobility; spawn/exit must land on stationary tiles and respect edge bias + min distance; if no valid exit exists, fall back deterministically to the farthest reachable stationary tile.
   - Data shape proposal (tile kinds): `tiles.kinds` as a 2D row-major numeric array (0=stationary, 1=barrier, 2=trap) aligned with `tiles` strings; `spawn`/`exit` coordinates remain in layout data for compatibility; trap tiles carry affinity + vitals metadata in a sidecar list keyed by position or tile id.
   - Defaults: barrier for all non-walkable cells; if spawn/exit constraints cannot be satisfied, relax minDistance deterministically before relaxing edgeBias.
   - Tests: add fixtures with irregular masks to assert `tiles.kinds` matches `tiles` and spawn/exit always sit on stationary tiles; include a constrained case to exercise fallback ordering.
   - Determinism: row-major iteration for mask → kinds; stable fallback ordering for spawn/exit; no random selection during fallback.
   - Notes: keep tile kinds in runtime/bindings only (core-as already models tile actors); reuse existing tile actor kind enums and render legend; trap tiles are affinity-only and never introduce martial weapons.
3. [complete] Add fixture-backed tests for level generation determinism and spawn/exit validity.
   - Requirement: Add fixture-backed tests that verify deterministic layout generation, tile kinds alignment, and spawn/exit placement validity across multiple shape profiles.
   - Behavior details: each fixture defines `input` + `expected` layout; tests assert exact `tiles`, `kinds`, and `spawn/exit`; constrained cases must demonstrate deterministic fallback ordering.
   - Data shape proposal (fixtures): `LevelGenFixture` with `{ schema, schemaVersion, input, expected }`, where `expected` mirrors layout output (tiles, kinds, legend, spawn, exit, bounds, traps?).
   - Defaults: fixtures should cover default profiles and omit optional inputs to ensure defaults remain stable.
   - Tests: add a single test that iterates all `level-gen-fixture-*` files and asserts normalization + generation output matches the expected snapshot.
   - Determinism: run generation twice per fixture and assert identical results; avoid reliance on system time or random calls outside the seeded RNG.
   - Notes: keep fixtures in `tests/fixtures/` (not `artifacts/`) and ensure they round-trip cleanly.

## 3) Actor Loadouts and Equipment Presets
1. [complete] Define equipment preset artifacts (base stats, vitals modifiers, abilities).
   - Requirement: Define affinity-only equipment preset artifacts (no martial weapons) with a precise affinity system: kinds = fire, water, earth, wind, life (health buffs), decay (health reduction), corrode (durability reduction), dark (visibility reduction/stealth); expressions = push (external bolt), pull (internal buff), emit (area effect).
   - Behavior details: presets declare affinity kind + expression (push/pull/emit), mana cost, and effect payloads; abilities are affinity-driven (e.g., life bolt, decay emission) and never reference swords/bows; vitals modifiers may affect mana/durability and affinity-specific health/durability changes (life/decay/corrode) only through explicit fields.
   - Data shape proposal (artifacts): extend `AffinityPresetArtifact` with `expression` and optional `vitalsModifiers` + `abilities` fields (e.g., `{ expression: "push"|"pull"|"emit", abilities: [{ id, kind: "attack"|"buff"|"area", affinityKind, potency, manaCost? }], vitalsModifiers: { mana?, durability?, health? } }`).
   - Defaults: if omitted, vitals modifiers default to no-op; abilities default to empty list; manaCost defaults to 0; preset must still include affinity kind + expression.
   - Tests: fixture-backed presets covering each affinity kind + expression combination; negative fixtures for invalid affinity kinds/expressions or non-affinity equipment fields.
   - Determinism: fixed ordering for ability lists; stable effect stacking/scaling based on affinity stacks; avoid implicit modifiers.
   - Notes: keep schema within runtime artifacts; ensure compatibility with loadout validation and trap affinities (shared affinity kinds/expressions).
2. [complete] Validate actor loadouts against presets (unknown preset, missing slots, invalid values).
   - Requirement: Validate actor loadouts against affinity presets with explicit errors for unknown preset ids, mismatched affinity kind/expression, missing required expressions per actor, and invalid stack values.
   - Behavior details: each loadout affinity must reference a known preset; affinity kind + expression must match the preset; stacks must be >=1 and <= preset.stack.max; loadouts must not include non-affinity equipment fields; if required expressions are specified per actor (e.g., must have one push + one pull), enforce deterministically.
   - Data shape proposal (validation result): `{ ok, errors: [{ actorId, field, code }...], warnings: [...] }` with stable error ordering by actorId then affinity index.
   - Defaults: if no required-expression policy is supplied, allow any mix of push/pull/emit; omit optional stacks defaults to 1 prior to validation.
   - Tests: fixture-backed loadouts that include unknown presets, mismatched kinds/expressions, stacks exceed max, missing actor id, and (optionally) missing required expression slot; add negative fixtures under `tests/fixtures/artifacts/invalid`.
   - Determinism: keep error ordering stable; avoid hash iteration; validate in list order and sort by actorId if needed.
   - Notes: keep validation in runtime (not core-as); reuse the same validators used by CLI/UI inputs to avoid drift.
3. [complete] Apply equipment effects to actor vitals and capabilities deterministically.
   - Requirement: Apply affinity preset effects (vitals modifiers + abilities) to actor loadouts deterministically, producing resolved vitals/capabilities for motivated actors and trap tiles.
   - Behavior details: combine base vitals with preset `vitalsModifiers` scaled by stack counts; abilities are aggregated by affinity kind + expression and retain deterministic ordering; mana costs are summed per expression for budgeting; trap affinities apply only mana/durability modifiers and capability effects (no health/stamina unless explicitly defined by life/decay/corrode).
   - Data shape proposal (resolved output): `{ actorId, vitals: { health, mana, stamina, durability }, abilities: [{ id, kind, affinityKind, expression, potency, manaCost }], affinityStacks: { [kind+expression]: stacks } }`.
   - Defaults: missing modifiers default to zero deltas; abilities default to empty; missing vitals on actors use existing defaults from core-as fixtures before applying modifiers.
   - Tests: fixture-backed resolution tests that apply a known loadout to base vitals and assert exact modified vitals + ability list order; include a trap case with mana/durability only.
   - Determinism: stable ordering by actorId then loadout order then ability id; fixed scaling rules for stacks (linear or multiplier as defined in presets); no randomness.
   - Notes: keep resolution in runtime (not core-as) and reuse the same affinity kind/expression enums; avoid introducing weapon concepts.

## 4) Artifacts and Bindings
1. [complete] Produce sim-config and initial-state artifacts from Configurator outputs.
   - Requirement: Produce `SimConfigArtifact` and `InitialStateArtifact` from configurator outputs (level layout, traps, affinity presets/loadouts, resolved vitals/abilities) with stable schema versions and references.
   - Behavior details: `SimConfigArtifact.layout.data` carries `tiles`, `kinds`, `legend`, `spawn`, `exit`, `bounds`, and `traps` metadata; `InitialStateArtifact` seeds actor positions/vitals and attaches resolved affinity stacks + abilities in `traits` or a dedicated metadata field; artifacts reference plan/budget ids when provided.
   - Data shape proposal (artifacts): `simConfig.layout.data` includes `{ width, height, tiles, kinds, legend, render, spawn, exit, bounds, traps? }`; `initialState.actors[]` includes `{ id, kind, position, vitals, traits: { affinities, abilities } }`.
   - Defaults: if configurator outputs omit abilities or modifiers, artifacts include empty lists/zero deltas; traps default to none; seed defaults as per levelGen normalization.
   - Tests: add fixture-backed artifacts for a generated layout + loadout application and assert deterministic serialization; include a trap layout case with affinity metadata.
   - Determinism: preserve row-major ordering for tiles/kinds; stable actor ordering by id; avoid timestamps in bodies (meta only).
   - Notes: keep artifacts in runtime contracts (`packages/runtime/src/contracts/artifacts.ts`) and avoid introducing IO in core-as.
2. [complete] Extend bindings observation to include equipment/loadout metadata for UIs and personas.
   - Requirement: Extend bindings observation to expose resolved affinity loadouts, abilities, and affinity stacks for each motivated actor and trap tile.
   - Behavior details: observation includes per-actor equipment metadata (affinity kinds + expressions + stacks) and resolved abilities; trap tiles expose affinity + vitals metadata in a separate `traps` array or tile overlay metadata; existing observation fields remain unchanged.
   - Data shape proposal (bindings): `observation.actors[]` gains `affinities` + `abilities` arrays; `observation.traps[]` includes `{ position, affinity, vitals, abilities }`; keep `tiles.kinds` aligned with trap kind values.
   - Defaults: if no loadout metadata is present, return empty arrays; omit `traps` when none exist.
   - Tests: extend bindings observation tests to assert affinities/abilities are present for a fixture with loadouts and trap tiles; add a negative/empty case to assert stable empty arrays.
   - Determinism: stable ordering by actor id and trap position; no randomization or hash iteration in observation assembly.
   - Notes: keep bindings thin (data-only), mirroring runtime artifacts; do not embed any IO or policy in bindings.
3. [complete] Add fixture artifacts for presets, loadouts, and generated layouts.
   - Requirement: Add fixture artifacts that reflect the new affinity preset/loadout schemas and layout outputs so runtime validation and bindings can round-trip deterministic data.
   - Behavior details: artifacts should cover presets, loadouts, sim-config layout, and initial-state actor metadata; include at least one trap tile and a loadout with stacked affinities to exercise expression handling.
   - Data shape proposal (fixtures): `AffinityPresetsArtifact`, `ActorLoadoutsArtifact`, `SimConfigArtifact`, and `InitialStateArtifact` fixtures with `{ schema, schemaVersion, kind, data }` where `data` mirrors runtime contracts (tiles/kinds/legend/spawn/exit/traps, actors/traits/abilities).
   - Defaults: omit optional fields when empty; keep `meta` minimal (no timestamps); use deterministic ordering for arrays (actors by id, tiles row-major).
   - Tests: add artifact parsing/validation tests that load each fixture and assert normalization; add negative artifacts under `tests/fixtures/artifacts/invalid` for missing schemaVersion or mismatched kinds.
   - Determinism: fixtures must be stable across runs; avoid randomized values and ensure consistent ordering for `traits.abilities` and affinity stacks.
   - Notes: follow naming convention `<schema>-v1-<label>.json`; keep artifacts in `tests/fixtures/artifacts/` and align with `packages/runtime/src/contracts/artifacts.ts`.

## 5) Runtime + UI Integration
1. [complete] Update runtime to consume configurator-generated artifacts for startup.
   - Requirement: Allow runtime startup to accept configurator-generated `SimConfigArtifact` + `InitialStateArtifact` with affinity traits, trap metadata, and layout kinds so the run initializes deterministically from these artifacts.
   - Behavior details: runtime bootstrap reads `simConfig.layout.data` (tiles, kinds, spawn/exit, bounds, traps) and seeds core-as with matching tile actors; `initialState.actors[].traits` carries affinity stacks + abilities and must be preserved in observation/bindings; trap tile actors initialize with mana/durability vitals and affinity metadata only.
   - Data shape proposal (startup payload): `{ simConfig, initialState, executionPolicy? }` where `simConfig.layout.data.traps` mirrors trap metadata and `initialState.actors[].traits` includes `{ affinities, abilities }`.
   - Defaults: if traps/traits are omitted, startup behaves as current MVP (no traps, no affinity metadata); missing `kinds` falls back to deriving from `tiles` when possible.
   - Tests: add runtime integration tests that load the configurator sim-config + initial-state fixtures and assert core-as grid/kinds, spawn/exit placement, and observation carries affinity traits; include a trap fixture to assert tile actor kind 2 is present.
   - Determinism: initialization order is stable (actors sorted by id, tiles row-major); no randomization beyond the provided seed; avoid time-based defaults.
   - Notes: keep IO in adapters; runtime should treat artifacts as pure data and avoid adding weapon concepts or non-affinity equipment.
2. [complete] Render equipment/loadout info in UI actor panels.
   - Requirement: Surface affinity loadouts (kinds, expressions, stacks) and resolved abilities in the UI actor panels without introducing weapon-centric terminology.
   - Behavior details: actor panel shows a compact list of affinities (e.g., `fire:push x2`, `life:pull x1`) and a separate list of abilities (attack/buff/area) with potency + mana cost; trap tiles display affinity/vitals metadata when selected; visibility-related affinities (dark) call out their effect in copy (e.g., "reduces visibility").
   - Data shape proposal (UI props): consume `observation.actors[].affinities` + `observation.actors[].abilities` and optional `observation.traps[]` from bindings; keep rendering purely presentational.
   - Defaults: if no affinities/abilities exist, render a muted "No affinities equipped" state; hide traps panel when none exist.
   - Tests: UI snapshot/DOM tests for a fixture with affinities + abilities; include empty-state coverage to avoid regressions.
   - Determinism: preserve ordering from observation (already sorted by actor id/position); avoid sorting in the UI to keep stable display across runs.
   - Notes: align labels with affinity kinds/expressions enum; avoid any sword/bow language and do not introduce new IO in the UI.
3. [complete] Add runtime/UI tests for preset application and loadout rendering.
   - Requirement: Add integration tests that connect affinity preset application (runtime) to UI rendering to ensure resolved abilities/affinities are surfaced correctly.
   - Behavior details: runtime test validates that applying presets/loadouts yields expected `affinityStacks` and abilities; UI test validates that the actor panel renders those fields without reordering or dropping entries.
   - Data shape proposal (test inputs): use `tests/fixtures/personas/affinity-resolution-v1-basic.json` for runtime resolution and `tests/fixtures/artifacts/*configurator*.json` for UI observation rendering.
   - Defaults: include an empty-state test where affinities/abilities are absent to assert fallback copy is stable.
   - Tests: add a runtime test that calls `resolveAffinityEffects` and compares to fixture `expected`; add a UI test that runs formatter/renderers against a mocked `readObservation` payload.
   - Determinism: assert stable ordering of abilities/affinity stacks; no random seeds in tests.
   - Notes: keep tests fast (no wasm required unless necessary) and avoid introducing IO in UI tests.

## 6) Cleanup + Docs
1. [complete] Update docs/README.md and CLI README with configurator flags and preset usage.
   - Requirement: Document the new configurator artifacts, affinity kinds/expressions, and CLI usage for loading presets/loadouts, including trap metadata handling.
   - Behavior details: README should explain affinity-only equipment (no martial weapons), list affinity kinds (fire, water, earth, wind, life, decay, corrode, dark), and describe push/pull/emit expressions; CLI examples should show how to run with sim-config + initial-state artifacts that contain affinity traits.
   - Data shape proposal (docs snippets): include example JSON for `AffinityPresetArtifact`, `ActorLoadoutsArtifact`, `SimConfigArtifact.layout.data` with `traps`, and `InitialStateArtifact.actors[].traits` with `affinities`/`abilities`.
   - Defaults: call out defaults (manaCost=0, stacks=1, shape profile=rectangular, edgeBias=false) and required fields (preset id, kind, expression, actor id).
   - Tests: note any new fixtures or tests added for affinity rendering and configurator startup; no code changes required.
   - Determinism: include a short note about deterministic ordering and seeded layout generation.
   - Notes: keep docs aligned with `packages/runtime/src/contracts/artifacts.ts` and avoid introducing weapon terminology.
2. [complete] Run `node --test "tests/**/*.test.js"` and record any skips/gaps.
   - Requirement: Execute the full test suite and capture any skips/failures with reasons.
   - Behavior details: record missing WASM skips, fixture dependencies, or environment constraints; do not mask failures.
   - Data shape proposal (log): include a short list of skipped tests (file + reason) and any failing test names.
   - Defaults: none.
   - Tests: run `node --test "tests/**/*.test.js"` exactly once unless failures require re-run.
   - Determinism: note any flaky tests or timing sensitivity.
   - Notes: if WASM build is required, mention whether `pnpm run build:wasm` was needed.
   - Run log: `node --test "tests/**/*.test.js"` → 153 pass, 3 fail, 0 skipped.
   - Failures:
     - `tests/adapters-cli/ak.test.js` "cli run writes tick frames and logs": `Failed to apply sim config layout: missing_dimensions`.
     - `tests/adapters-cli/ak.test.js` "cli replay writes replay summary": `Failed to apply sim config layout: missing_dimensions`.
     - `tests/adapters-cli/ak.test.js` "cli inspect writes summary": `Failed to apply sim config layout: missing_dimensions`.
   - Fix: updated `tests/adapters-cli/ak.test.js` fixtures to include minimal grid dimensions/spawn.
   - Re-run log: `node --test "tests/**/*.test.js"` → 156 pass, 0 fail, 0 skipped.
   - Skips: none.
   - WASM build: previously ran `pnpm run build:wasm` before these runs; not rerun here.
3. [pending] Log next steps (multi-actor loadouts, loot tables, progression).
   - Requirement: Capture a concise list of follow-on work items that build on configurator (multi-actor loadouts, loot, progression).
   - Behavior details: list 3-6 next steps with one sentence each, focusing on data flow and validation impacts.
   - Data shape proposal (log): short bullets in the implementation plan or a dedicated “Next steps” block.
   - Defaults: none.
   - Tests: none.
   - Determinism: note any ordering or schema impacts for future work.
   - Notes: keep scope limited; no new implementation in this step.
