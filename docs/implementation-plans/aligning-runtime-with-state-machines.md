# Aligning Runtime with Persona State Machines

Goal: unify the runtime execution loop with persona state machines so there is a single, deterministic model for running the application.

Problem summary (current disconnect):
- The runtime runner (`packages/runtime/src/runner/runtime.js`) uses its own phase list (`observe`, `collect`, `apply`, `emit`) and does not invoke persona controllers/state machines.
- The tick FSM (`packages/runtime/src/personas/_shared/tick-state-machine.mts`) defines `init → observe → decide → apply → emit → summarize`, and persona controllers subscribe to these phases, but this flow is only used in tests via the tick orchestrator.
- Result: personas are advanced manually in tests, while the runtime loop bypasses them, so there are two competing models for “running” a tick.

Constraints:
- Preserve deterministic ordering and replayability.
- Keep IO at adapters/ports boundaries.
- Prefer additive, reviewable changes with clear deprecation path.

## 0) Inventory + mapping
1. [done] Document the current loops and identify a canonical phase model.
   - Work:
     - Capture the runtime runner phase order and responsibilities.
     - Capture tick FSM phase order and persona subscriptions.
     - Produce a mapping table (legacy phase → tick phase) and note gaps (e.g., `collect` vs `decide`, missing `summarize`).
   - Deliverable: short table in this doc used by the next steps.

### Runtime runner (legacy) responsibilities
- Init: `createRuntime.init()` resets core, applies sim config/initial state, applies budgets, flushes effects, and records a TickFrame with `phaseDetail: "init"`.
- Step: `observe` and `collect` phases are recorded but do not invoke personas or core.
- Apply: calls `core.applyAction(1, 1)` (or `core.step()` fallback) and records a frame.
- Emit: flushes core effects via ports/adapters and records the frame.

### Tick FSM + persona subscriptions
- Tick phases: `init → observe → decide → apply → emit → summarize → next_tick`.
- Persona subscriptions:
  - configurator: `init`, `observe`
  - director: `decide`
  - allocator: `observe`, `decide`
  - actor: `observe`, `decide`
  - moderator: `init`, `observe`, `decide`, `apply`, `emit`, `summarize`
  - orchestrator: `observe`, `decide`, `emit`
  - annotator: `emit`, `summarize`

## 1) Choose a canonical runtime loop contract
1. [done] Adopt the tick FSM as the source-of-truth for phases.
   - Work:
     - Define a runtime phase contract (payloads, actions, effects, telemetry) keyed by `TickPhases`.
     - Specify how `init` and `summarize` map to core setup and finalization.
     - Define a “tick context” structure used by both runtime and personas.

### Runtime phase contract (draft)
Tick context fields:
- `runId`, `tick` (FSM tick), `simConfig`, `initialState`
- `baseTiles`, `observation` (from core, if available)
- `lastEffects`, `lastFulfilled` (from previous emit)
- `observationLog` (per-tick effects/fulfillments for annotator summaries)
- `actorIdMap` / `primaryActorId` (string → numeric mapping for move actions)

Phase payload defaults:
- `init`: configurator `provide_config` with `config`/`configRef` when `simConfig` is present.
- `observe`: actor `observe` with `observation`, `baseTiles`, `simConfig`, `lastEffects`.
- `decide`: actor sequence `decide → propose → cooldown` with same payload (actions emitted on `propose`).
- `apply`: runtime applies accepted actions to core; moderator may receive ordered `actions`.
- `emit`: core effects flushed and dispatched; annotator `observe` receives per-tick observation record.
- `summarize`: annotator `summarize` receives `observationLog` for deterministic summaries.

## 2) Build a unified runtime driver
1. [done] Introduce a tick-driven runtime loop that uses `createTickOrchestrator`.
   - Work:
     - Add a new runtime module (or extend `createRuntime`) that:
       - Registers persona controllers.
       - Advances phases via the tick FSM (`init`, `observe`, `decide`, `apply`, `emit`, `summarize`).
       - Feeds observations and inputs into personas via `payload` per phase.
       - Applies persona actions to core during `apply`.
       - Flushes core effects during `emit` and routes them via ports/adapters.
     - Ensure the tick orchestrator history becomes the runtime’s tick frame record.
   - Note: Legacy runner path removed after FSM migration (see step 8).

## 3) Unify action/effect plumbing
1. [done] Define a single path from persona actions → core actions → effects.
   - Work:
     - Normalize action shapes (e.g., move proposals) into a core action adapter.
     - Align effect dispatch with the tick `emit` phase and the existing ports model.
     - Ensure deterministic ordering of actions/effects across personas.

## 4) Align runtime outputs + telemetry
1. [done] Standardize tick frames on the tick FSM phases.
   - Work:
     - Replace or map legacy runtime frames to `TickPhases`.
     - Include persona views, actions, effects, and telemetry in the runtime frame log.
     - Ensure summary data is captured in the `summarize` phase.

## 5) Transition + compatibility plan
1. [done] Maintain compatibility while switching to the unified loop.
   - Work:
     - Add a runtime option like `mode: "fsm" | "legacy"` (default to legacy initially; removed after migration).
     - Migrate tests to run against the new FSM loop.
     - Announce deprecation of the legacy runner path once parity is achieved.

## 6) Tests
1. [done] Add coverage for the new unified runtime loop.
   - Tests:
     - Runtime loop advances through all tick phases deterministically.
     - Persona controllers receive phase payloads and emit actions/effects.
     - Core actions are applied only during `apply` and effects flushed during `emit`.
     - `summarize` records a deterministic frame/telemetry entry.

## 7) Documentation + architecture sync
1. [done] Update docs to describe the unified runtime model.
   - Work:
     - Update `docs/README.md` and `docs/architecture/diagram.mmd` to reflect the tick FSM as the canonical runtime loop.
     - Document the new runtime driver and migration path.

## Mapping (Draft)
| Legacy Phase | Runtime Responsibility | Tick Phase | Notes |
| --- | --- | --- | --- |
| `init` | Core reset + config + budgets + flush effects | `init` | Legacy records `phaseDetail: "init"` but no persona usage. |
| `observe` | Records frame only | `observe` | FSM phase should collect observations and inputs. |
| `collect` | Records frame only | `decide` | FSM uses `decide` for proposals/actions. |
| `apply` | Calls `core.applyAction(1, 1)` / `core.step()` | `apply` | FSM `apply` should apply ordered persona actions. |
| `emit` | Flushes effects via ports | `emit` | Align effect dispatch with this phase. |
| _missing_ | N/A | `summarize` | New summary/telemetry frame. |

## New TODOs
- Decide which personas beyond Actor/Annotator should be actively driven in FSM mode (allocator/director/orchestrator/moderator) and define their event schedules.
- Document/standardize the public runtime inputs contract for `personaEvents`/`personaPayloads` (and update any README examples if exposed).

## 8) Full migration + legacy removal
1. [done] Complete the cutover to the FSM runtime behavior.
   - Work:
     - Default `createRuntime` to the FSM runtime behavior once parity is verified.
     - Migrate remaining tests/fixtures to the FSM loop (remove legacy assumptions).
     - Remove the legacy runner path and update docs/README examples accordingly.

## New TODOs (Addendum)
- Silence or eliminate Node deprecation warnings from ts-node/esm when running the CLI (e.g., compiled JS wrappers or a warning-free loader path).

## 9) Follow-ups for open TODOs
1. [done] Drive all personas via the FSM schedule.
   - Work:
     - Treat every persona (orchestrator/director/configurator/allocator/actor/moderator/annotator) as actively driven in FSM mode.
     - Define explicit per-phase event schedules for each persona and wire them into runtime defaults.
     - Ensure persona payloads include the inputs each persona needs at its subscribed phases.
     - Add/adjust tests to lock the full-persona schedule (phase -> events -> expected state/actions/effects).

2. [done] Standardize the public runtime inputs contract.
   - Work:
     - Document `personaEvents` / `personaPayloads` in a single reference (and update README examples if public).
     - Add validation/typing guidance for payload shapes.

3. [done] Remove ts-node/esm deprecation warnings in CLI.
   - Work:
     - Replace ts-node loader usage with compiled JS wrappers or a warning-free loader path.
     - Ensure CLI works from non-repo CWD without relying on ts-node resolution.

4. [done] Director emits a plan artifact that drives Orchestrator.
   - Work:
     - Define how Director produces PlanArtifact (or ref) from intent inputs.
     - Pass Director outputs into Orchestrator inputs so `plan → start_run` is data-driven.
     - Add tests to validate plan emission and Orchestrator transitions using the real artifact.

5. [done] Allocator consumes real spend signals from runtime.
   - Work:
     - Define spend signals (effects/actions/budget usage) emitted each tick.
     - Feed signals into Allocator payloads to drive monitor/rebalance transitions.
     - Add fixtures + tests that validate allocator decisions based on real signals.

6. [done] Moderator consumes explicit control events.
   - Work:
     - Define runtime control inputs (pause/resume/stop) and how they map to Moderator events.
     - Ensure the runtime surfaces these controls deterministically in the tick schedule.
     - Add tests for moderator transitions under control events.
