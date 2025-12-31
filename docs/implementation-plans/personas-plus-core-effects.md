# Personas + Core Effects Plan

Goal: flesh out core-as effects/actions beyond the counter, and give personas meaningful behaviors that consume/produce artifacts and adapter calls (fixture-first, deterministic).

## Baseline
- Core currently exposes counter/budget/effect plumbing but minimal effect kinds.
- Personas have FSMs and tests but limited real actions/effects.
- Adapters are fixture-first with optional live mode; UI/CLI demos exist.

## Plan
1) Core effects and actions
   - Expand effect kinds: need_external_fact (with sourceRef, idempotent requestId, target adapter hint), log and telemetry (severity, tags, personaRef), solver_request (intent/plan payload), and fulfill/defer variants to close loops.
   - Add corresponding core-as action handlers that emit these effects; enforce per-tick budget/time and deterministic ordering; guard against invalid transitions.
   - Make applyAction/step deterministic: derive effect ids from state + action input (no clock/random), stable sort effects, update schema definitions in `packages/runtime/src/contracts/artifacts.ts` and any assembly bindings.
   - Expand core-as tests to cover each effect shape, budget interactions (spend vs. exhaust), and error cases for malformed actions.

2) Persona behaviors
   - Director/Configurator: load intent/plan fixtures, lift problem definitions into solver_request effects (intentRef/planRef, targetAdapter hint, requestId), and pass enriched plan/config into runtime fixtures; keep emitted requests deterministic and fixture-backed.
   - Allocator/Actor: enforce budget receipts (caps/limits) when selecting actions; emit request_external_fact or request_solver actions based on fixture prompts; when runtime surfaces need_external_fact with sourceRef, emit fulfill_request actions, otherwise emit defer_request; ensure actions stay within budget categories.
   - Actor: derive action proposals from observations+fixtures, include emit_log/emit_telemetry actions for tracing, and honor deferred/fulfilled loops to close requests deterministically.
   - Annotator: ingest effect log/tick frames, emit telemetry records and summaries (severity/tags/personaRef), and persist run summaries in fixtures; no IO.
   - Persona tests: add fixture-driven tests for each persona covering solver_request emission, budget enforcement, need_external_fact fulfill/defer paths, and telemetry artifacts; assert deterministic ordering and requestId reuse.

3) Runtime wiring
   - Extend `createRuntime` to build rich effect records (ids, requestId, targetAdapter) from core getEffectKind/value; route via `dispatchEffect` using effect shape (not raw kind/value) and propagate fulfilled/deferred outcomes.
   - Handle need_external_fact: if sourceRef present, fulfill deterministically; else mark deferred with reason and keep requestId stable; mirror same policy in CLI runner.
   - Update TickFrame recording to include emittedEffects/fulfilledEffects with ids/requestIds/fulfillment status; stable sort by effect.id/index for determinism; capture personaRef/tags/severity where provided.
   - Ensure serialization and adapters respect new effect kinds (log, telemetry, solver_request, effect_fulfilled/deferred); add runtime tests covering routing and deferred paths.

4) Adapters touchpoints (fixture-first)
   - Add adapter fixtures for new effect kinds (solver_request, need_external_fact fulfill/defer, telemetry/logs) under `tests/fixtures/adapters/**` with validation tests that replay `dispatchEffect` and runtime runner paths; keep live mode opt-in.
   - Update adapter ports (logger, telemetry, solver, external fact/cache) to consume effect shape (id, requestId, targetAdapter, severity/tags/personaRef) and return deterministic outcomes for fixtures; defer when missing capabilities.
   - Ensure dependency direction (adapters/ui → runtime → bindings-ts → core-as) and import guard (core-as has no external imports) remain intact; add/keep import guard tests.
   - If adapters persist artifacts (e.g., fulfilled fact cache), gate writes behind fixtures and assert outputs in tests; no core-as IO.

5) Documentation and demos
   - Update `docs/human-interfaces.md` with a note on new persona-visible effects (solver_request, need_external_fact fulfill/defer, log/telemetry) and how CLI/UI demos surface them under fixtures (adapter playground, tick frames, effect logs).
   - Refresh `packages/adapters-cli/README.md` or reference handouts to reflect new CLI behavior (effect ids/requestIds, adapter hints) if schemas changed; keep examples fixture-backed.

## Exit criteria
- Core-as emits new effect kinds/actions deterministically with tests.
- Personas produce/consume these effects meaningfully under fixtures; tests cover behaviors.
- Runtime records and routes new effects; adapters have fixture coverage for any new surfaces.
- CLI/UI demos can show the new behaviors/effects (fixture-backed); docs updated (human-interfaces, adapters-cli README, reference handout, architecture charter/diagram).
