# Graphify Follow-On Recommendations

Source: `graphify-out/GRAPH_REPORT.md` generated on `2026-04-13` for `packages/`.

Purpose: turn the graph analysis into concrete, delegable code changes. Each item below is sized and framed so it can be handed to a smaller coding model such as `qwen3.5:9b` without requiring repo-wide rediscovery.

## How to use this file

- Treat each recommendation as a separate bounded slice.
- Do not combine multiple `M` slices in one agent run.
- Keep the repo rule: requirements -> tests -> code -> validation.
- Prefer the listed tests first; only widen the regression ring after the slice is green.

---

## R1. Bridge `MoveAction` back into the documented architecture

**Why this change**

The graph showed `MoveAction` isolated inside a 17-node island around `packages/core-as/assembly/rules/move.ts`, with no graph path to the architectural docs, `bindings-ts`, or the runtime command rail. That makes the most important action in the system hard to navigate and easy to misunderstand.

**Size**

`S`

**Primary goal**

Make the `MoveAction` path explicit from `core-as` -> `bindings-ts` -> runtime/CLI docs, and add one code-level bridge test that proves the path is real rather than only documented.

**Likely files**

- `packages/core-as/assembly/rules/move.ts`
- `packages/core-as/assembly/README.md`
- `packages/bindings-ts/src/mvp-movement.js`
- `packages/adapters-cli/README.md`
- `tests/runtime/**` or `tests/adapters-cli/**` for one round-trip or smoke assertion

**Implementation brief**

1. Add a short architecture note in `move.ts` describing where `MoveAction` is produced, packed/unpacked, and consumed.
2. Add a focused subsection to `packages/core-as/assembly/README.md` that names the concrete action rail for movement.
3. If missing, expose or tidy a small helper in `packages/bindings-ts/src/mvp-movement.js` so the bridge is not only comment-based.
4. Add one deterministic test that exercises the move-action encode/decode or pack/unpack path and names the modules involved.

**Tests to add/update**

- A targeted binding/runtime test proving `MoveAction` round-trips across the boundary without ambiguity.

**Validation**

- `node --test tests/runtime/*.test.js`
- or the smallest targeted test file you add

**Stop condition**

There is a single obvious place for a reader to trace `MoveAction` from the core rule to the boundary wrapper, and a green test proves the bridge.

---

## R2. Split `world.ts` into smaller engine modules

**Why this change**

`World Engine` was the largest low-cohesion community in the graph. That usually means too many responsibilities are packed into one file, which slows review and raises regression risk.

**Size**

`M`

**Primary goal**

Break `packages/core-as/assembly/state/world.ts` into focused modules without changing behavior.

**Likely files**

- `packages/core-as/assembly/state/world.ts`
- new sibling modules under `packages/core-as/assembly/state/` or `packages/core-as/assembly/rules/`
- tests touching tick advancement, placements, regen, trap arming, or capability defaults

**Suggested split**

1. Tick progression and frame advancement.
2. Actor placement and indexing helpers.
3. Regen/default capability application.
4. Trap/barrier durability helpers.

**Implementation brief**

1. Identify clusters of functions already grouped by call proximity.
2. Move pure helpers first, then move internal mutators.
3. Keep exported names stable unless a rename is clearly beneficial.
4. Do not widen scope into gameplay changes.

**Tests to add/update**

- Existing tests around `advanceTick()`, placement, regen, and trap behavior.
- Add one regression test if moving code reveals an untested path.

**Validation**

- `pnpm run build:wasm`
- `node --test tests/runtime/*.test.js`

**Stop condition**

`world.ts` is materially smaller, each new file has one dominant purpose, and the WASM/runtime tests remain green.

---

## R3. Normalize the action-resolution pipeline around explicit stages

**Why this change**

`Action Resolution` appeared as several separate low-cohesion communities. The graph suggests action dispatch, budget charging, request encoding, and move handling are coupled but not organized as a clear pipeline.

**Size**

`M`

**Primary goal**

Refactor the action path into explicit stages that are easy to reason about and test independently.

**Likely files**

- `packages/core-as/assembly/index.ts`
- `packages/core-as/assembly/rules/move.ts`
- any neighboring action/budget helpers in `core-as`
- tests covering `applyAction()`, `handleMoveAction()`, and request/budget side effects

**Implementation brief**

1. Identify the current action stages: decode/dispatch, legality, budget/effects, state mutation.
2. Extract helpers so each stage has one clear entry point.
3. Keep all logic in `core-as`; do not push rules upward into runtime.
4. Add naming that makes the happy path visible in stack traces and grep.

**Tests to add/update**

- Action application tests for move and non-move branches.
- Budget/effect tests if they currently rely on implicit ordering.

**Validation**

- `pnpm run build:wasm`
- targeted core/runtime tests

**Stop condition**

An engineer can trace action flow top-down without bouncing between unrelated helpers.

---

## R4. Split `level-layout.js` into generation, connectivity, and spawn/exit phases

**Why this change**

`Pattern Layout` was another large low-cohesion community. The graph hotspots in `level-layout.js` mix room placement, overlays, connectivity, spawn/exit picking, and validation.

**Size**

`M`

**Primary goal**

Refactor `packages/runtime/src/personas/configurator/level-layout.js` into deterministic phases with smaller files.

**Likely files**

- `packages/runtime/src/personas/configurator/level-layout.js`
- new helper modules under `packages/runtime/src/personas/configurator/`
- tests for layout generation and configurator artifacts

**Suggested split**

1. Base room/grid generation.
2. Connectivity and path/backbone enforcement.
3. Spawn/exit/trap placement.
4. Overlay/pattern application.

**Implementation brief**

1. Preserve the existing artifact output exactly unless a fixture clearly needs rebaseline.
2. Pull pure geometry helpers out first.
3. Keep deterministic RNG/planning inputs unchanged.
4. Avoid changing CLI flags or authored-spec behavior in this slice.

**Tests to add/update**

- `tests/runtime/configurator-startup.test.js`
- any configurator/layout fixture tests

**Validation**

- targeted configurator/runtime tests
- add one artifact snapshot comparison if missing

**Stop condition**

Each layout phase can be opened and understood in isolation, with no artifact drift.

---

## R5. Extract shared card-authoring operations from `design-guidance.js`

**Why this change**

`createDesignCard()` was one of the top god nodes, and the graph clustered many design-card mutations into one dense UI file. That usually means UI state operations are over-centralized.

**Size**

`S`

**Primary goal**

Move pure card-set creation/mutation helpers into a focused shared module so the UI view code becomes thinner and easier to test.

**Likely files**

- `packages/ui-web/src/design-guidance.js`
- new helper such as `packages/ui-web/src/design-card-ops.js`
- `packages/ui-web/src/build-spec-ui.js`
- UI tests around design hydration and card editing

**Implementation brief**

1. Extract pure operations first: create, clone, normalize, drop property, affinity/expression mutation.
2. Leave DOM wiring and event handling in `design-guidance.js`.
3. Export a minimal, well-named helper surface.
4. Reuse the new helpers from `build-spec-ui.js` where appropriate.

**Tests to add/update**

- targeted UI unit tests for card operations
- existing design-view/build-spec tests

**Validation**

- `node --test tests/ui-web/design-view.test.mjs`
- any targeted UI helper test file you add

**Stop condition**

Pure card operations are testable without DOM setup, and `design-guidance.js` is smaller and more event-focused.

---

## R6. Unify affinity math and normalization across runtime and UI

**Why this change**

The graph found multiple separate `Affinity Systems` communities across runtime and UI. That pattern usually signals duplicated concepts with slightly different helper stacks.

**Size**

`M`

**Primary goal**

Create one shared affinity-normalization/calculation surface per layer and remove duplicate logic where UI and runtime are trying to solve the same problem differently.

**Likely files**

- `packages/ui-web/src/design-guidance.js`
- `packages/runtime/src/personas/configurator/**`
- any price/spend/affinity helper modules already in runtime
- tests that compare authored affinity output or spend calculations

**Implementation brief**

1. Inventory repeated concepts: stack ordering, expression normalization, affinity entry normalization, cost or potency calculation.
2. Decide which logic is domain logic versus UI-only presentation logic.
3. Move domain logic to the runtime/shared rail; keep display formatting in UI.
4. Rebaseline only if current fixtures prove the old behavior was accidental.

**Tests to add/update**

- runtime tests for normalized affinity output
- UI tests that assert the UI delegates to shared normalization rather than reimplementing it

**Validation**

- targeted runtime tests
- targeted UI tests

**Stop condition**

Affinity semantics have one canonical implementation per concern, and equivalent inputs produce equivalent normalized outputs across rails.

---

## R7. Create shared contract tests for CLI/Web/Test adapters

**Why this change**

The graph’s most interesting inferred connections were the semantic parallels between CLI, Web, and Test adapters for LLM, IPFS, and blockchain. That is useful, but it should be enforced in code rather than left as a graph observation.

**Size**

`S`

**Primary goal**

Add shared contract tests so equivalent adapter surfaces stay aligned across environments.

**Likely files**

- `packages/adapters-cli/src/adapters/{llm,ipfs,blockchain}/index.js`
- `packages/adapters-web/src/adapters/{llm,ipfs,blockchain}/index.js`
- `packages/adapters-test/src/adapters/{llm,ipfs,blockchain}/index.js`
- `tests/adapters-cli/**`
- `tests/adapters-web/**`

**Implementation brief**

1. Define one expected surface per adapter family: constructor options, method names, response shape, fixture behavior.
2. Build a reusable test helper that can be pointed at CLI/Web/Test implementations.
3. Keep environment-specific transport details out of the shared assertions.
4. Update README examples only if the actual public surface changes.

**Tests to add/update**

- shared adapter contract tests for LLM/IPFS/blockchain

**Validation**

- `node --test tests/adapters-cli/*.test.js`
- `node --test tests/adapters-web/*.test.js`

**Stop condition**

Adapter parity is enforced by tests, not just inferred by documentation.

---

## R8. Consolidate persona state-machine scaffolding

**Why this change**

The graph produced many tiny singleton communities around persona contracts, idle states, and controllers. That often means repeated scaffolding with weak discoverability and drift risk.

**Size**

`S`

**Primary goal**

Factor out the repeated persona FSM scaffolding into shared helpers or a shared fixture-driven test harness, without erasing persona-specific behavior.

**Likely files**

- `packages/runtime/src/personas/*/state-machine.js`
- `packages/runtime/src/personas/*/controller.ts`
- shared persona helper area under `packages/runtime/src/personas/_shared/`
- `tests/personas/**`

**Implementation brief**

1. Identify duplicated patterns: allowed-events maps, idle transitions, controller boilerplate, schedule fixtures.
2. Extract only the repeated mechanics, not persona policy.
3. Prefer shared tests/harnesses if code extraction would be too invasive for one slice.
4. Keep the persona contract from `CLAUDE.md` intact.

**Tests to add/update**

- persona schedule/state-machine tests
- one shared helper test if a new utility is introduced

**Validation**

- `node --test tests/personas/*.test.js`

**Stop condition**

Common FSM mechanics are defined once, and persona drift is reduced without changing behavior.

---

## R9. Tighten the runtime-decision inspection package

**Why this change**

The graph grouped `runtime-decision`, `tick-state-machine`, `tick-inspect`, and pending effects as related but still somewhat fragmented. This area is important enough that inspection and execution helpers should read like one cohesive subsystem.

**Size**

`S`

**Primary goal**

Make runtime decisioning easier to inspect and reason about by consolidating summary, state-machine, and pending-effect helpers.

**Likely files**

- `packages/runtime/src/personas/_shared/runtime-decision.js`
- `packages/runtime/src/personas/_shared/runtime-decision.mts`
- `packages/runtime/src/personas/_shared/tick-state-machine.js`
- `packages/runtime/src/personas/_shared/tick-inspect.js`
- related tests already present in `tests/runtime/**` and `tests/personas/**`

**Implementation brief**

1. Identify type guards, summary helpers, and state transitions that belong together.
2. Reduce duplicate naming and ambiguous helper boundaries.
3. Ensure inspect output uses the same core terminology as execution-time helpers.
4. Do not introduce a new artifact family.

**Tests to add/update**

- `tests/runtime/runtime-decision-contract.test.js`
- `tests/runtime/command-kernel-inspect-runtime-decision.test.js`
- `tests/runtime/run-helpers-runtime-decision.test.js`

**Validation**

- targeted runtime decision test ring

**Stop condition**

Runtime decision capture, state, and inspection feel like one subsystem with one vocabulary.

---

## R10. Add an architecture-lint test for docs-to-code anchors

**Why this change**

The graph only connected some critical concepts because README files named them explicitly. `MoveAction` stayed isolated partly because those anchors are missing. This should be automated.

**Size**

`S`

**Primary goal**

Add a lightweight doc/code alignment test that checks a small set of required architecture anchors are present in the right README files and point to real code modules.

**Likely files**

- `packages/core-as/assembly/README.md`
- `packages/runtime/src/personas/*/README.md`
- `packages/adapters-cli/README.md`
- new test under `tests/**`, likely docs or contracts-oriented

**Suggested anchors**

- `MoveAction`
- `runtime-decision-v1`
- `Solver-Z3 Adapter`
- `core-as`
- `Versioned Runtime Artifacts`
- `bindings-ts`

**Implementation brief**

1. Create a small test with an allowlist of required anchor strings and expected files.
2. Fail clearly when an anchor disappears or when a code path named in docs no longer exists.
3. Keep the scope small; this is not a full docs linter.

**Tests to add/update**

- new architecture-doc alignment test

**Validation**

- targeted test file

**Stop condition**

Critical architecture bridges cannot silently disappear from the docs.

---

## Recommended execution order

1. `R1` because it addresses the sharpest graph gap.
2. `R7` and `R10` because they lock in the architecture/documentation surface cheaply.
3. `R5` and `R9` as bounded cleanup slices.
4. `R2`, `R3`, `R4`, `R6`, and `R8` as larger structural follow-ons.

## Good delegations for small models

- Best `XS/S` tasks for a small model:
  - `R1`
  - `R5`
  - `R7`
  - `R9`
  - `R10`
- Better kept for a stronger model or split into sub-slices first:
  - `R2`
  - `R3`
  - `R4`
  - `R6`
  - `R8`
