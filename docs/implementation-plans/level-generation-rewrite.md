# Level Generation Rewrite

## Problem
Level generation can appear to hang for larger token allocations. The current flow mixes budget-loop orchestration, LLM retries/repairs, layout synthesis, and UI preview rendering on the main thread. This makes runtime behavior hard to reason about and hard to bound.

## Goals
- Make level generation deterministic and bounded for large budgets.
- Separate orchestration timing from rendering timing.
- Remove indefinite wait states in UI prompt runs.
- Provide user-facing progress and completion guarantees.
- Keep behavior testable from real UI button-click paths.

## Non-Goals
- No visual redesign of the Design tab.
- No changes to core game rules beyond generation/runtime safety.
- No mandatory model/provider change.

## Constraints
- Dependency direction remains: `adapters/ui -> runtime -> bindings-ts -> core-as`.
- `core-as` remains no-IO.
- Public behavior updates require docs/tests in same change set.

## Rewrite Strategy
1. Define explicit generation phases and budgets
- Phase A: prompt + contract validation.
- Phase B: budget loop + repair (bounded retries and bounded wall clock).
- Phase C: layout synthesis artifact creation.
- Phase D: preview rendering (isolated from generation success).

2. Separate execution from presentation
- Generation returns a compact `LevelGenerationResult` artifact.
- Preview rendering consumes artifact asynchronously and can degrade gracefully.
- Rendering failure must not block generation completion.

3. Introduce hard runtime guards
- Per-request timeout (already introduced for web adapter).
- Per-phase deadline and max repair attempts.
- Per-run cancellation support from UI.
- Structured error codes for timeout/repair/contract/render failures.

4. Make large-layout handling explicit
- Count-based feasibility checks for large tile totals.
- Threshold-based fallback paths (no full-grid synthesis when unnecessary).
- Optional sampling-based validation for huge layouts.

5. Isolate heavy rendering work
- Move preview tile generation and canvas painting off critical completion path.
- Use progressive preview (metadata first, visual second).
- Add upper-bound rendering budget and skip policy.

## Proposed Deliverables
- Runtime:
  - Refactored `runLlmBudgetLoop` phase interface with deadlines/cancellation.
  - Stable error taxonomy and trace events.
- UI:
  - Prompt-run controller with active/in-flight/cancel states.
  - Non-blocking preview renderer with fallback text mode.
  - Timing readout split into: `generation_ms` vs `preview_ms`.
- Tests:
  - UI click-path timing tests (normal + repair + timeout + cancel).
  - Large-token regression tests (10K, 100K, 2M, 20M equivalents as configured).
  - Deterministic adapter tests for hung/slow/invalid responses.

## Acceptance Criteria
- 10K token run must resolve to success or explicit failure within configured timeout.
- 2M token run must complete generation without indefinite UI blocking.
- Busy-state buttons prevent duplicate submissions during in-flight runs.
- Benchmark output clearly states what is included/excluded in timing.
- All new behavior covered by tests under `tests/ui-web` and `tests/personas`.

## Migration Plan
1. Create new generation controller module for UI prompt runs.
2. Add cancellable/deadline-aware adapter wrapper and propagate signals.
3. Split generation artifact and preview pipeline.
4. Add/adjust tests to lock the new contract.
5. Roll out behind default-on behavior after test pass.

## Risks
- Existing tests may assume synchronous preview side effects.
- Different LLM backends may vary in abort/timeout behavior.
- Large layout edge cases may require profile-specific safeguards.

## Open Questions
- Should timeout defaults differ per phase (layout vs defender)?
- Should preview rendering move to worker immediately or staged later?
- Should benchmark include optional render-time mode for end-user expectation?
