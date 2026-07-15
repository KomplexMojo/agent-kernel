# AdaptiveWorkflowAgent

A durable, deterministic control plane that coordinates an objective from intake
through planning, configuration, validation, execution, verification, repair,
escalation, and completion. It reuses the existing Orchestrator LLM seams and
command kernel, but is **not** a persona: the Orchestrator persona remains the
tick/persona boundary guardian, while `AdaptiveWorkflowAgent` coordinates work
from the application layer.

> Dependency direction is unchanged: `adapters-* / ui-web → runtime → core-ts`.
> All model, hardware, persistence, CLI, and MCP IO lives behind injected ports
> fulfilled by adapters. The runtime layer imports no adapter, MCP, or Node IO.

## Architecture

| Concern | Location | Notes |
|---|---|---|
| Contracts + state machine | `packages/runtime/src/adaptive-workflow/{contracts.ts,state-machine.js}` | Versioned artifacts; pure FSM. |
| Runner + ports | `runner.js`, `ports.js` | `runAdaptiveWorkflow(...)`; clock/model/validator/persistence/execution injected. |
| Validators + failures | `validators.js`, `failures.js` | Deterministic registry; 8-category taxonomy. |
| Profiles + strategy policy | `profiles.js`, `strategy-policy.js`, `context-budget.js` | Declared capability, runtime profile, benchmark evidence, budgeting. |
| Repair | `repair-controller.js`, `patch-contract.js` | Deterministic action choice; immutable-path patching. |
| Durability + replay | `durable-log.js`, `replay.js` | Content-addressed responses; recorded-response replay. |
| Metrics + benchmark evidence | `metrics.js`, `benchmark-evidence.js` | Run summary + offline evidence ingestion/promotion. |
| Model adapters | `packages/adapters-cli/src/adapters/model/*` | OpenAI, Anthropic, Ollama behind one neutral port. |
| Workflow adapters | `packages/adapters-cli/src/adapters/adaptive-workflow/*` | Filesystem store, runtime-profile probe, controlled execution, benchmark loader. |
| CLI / MCP surfaces | `src/cli/ak-impl.mjs`, `src/mcp/adaptive-workflow-tools.mjs` | `ak workflow …`; `ak_workflow_*` tools + resources. |

## State-machine flow

Phases: `intake → plan → configure → validate → execute → verify → complete`,
with `repair` / `escalate` loops and terminal `failed` / `cancelled`.

- A model proposes plans/configurations/repairs; it can never mark itself valid
  or complete. `validate` (domain) and `verify` gates both require deterministic
  validators to pass before `complete`.
- Failed domain validation routes `validate → repair`; verification failure
  routes `verify → repair`; execution failure routes `execute → repair`.
- Cancellation is checked before each model attempt, before side effects, and
  after idempotency reservation. Terminal phases reject further transitions.
- Every transition emits a contract-valid execution event with a deterministic
  `runId:event:N` id.

## Model-profile configuration

`DeclaredModelCapabilityV1` (`profiles.js`) records provider/model, context and
output ceilings, and `supports.{textGeneration,structuredOutput,streaming}`.
Declared provider capability, runtime-probed capability, and offline benchmark
evidence are kept **distinct**. Providers are implemented in
`adapters-cli/src/adapters/model/` against the neutral `ModelAdapterPort`
(`model-adapter.js`); fixture-backed tests never make live calls.

## Runtime-profile configuration

`RuntimeProfileSnapshotV1` captures a versioned snapshot per run: `source`
(`declared` | `probed` | `fixture`), `profileVersion`, and capabilities
(`maxContextTokens`, `maxConcurrency`, `supportsReplay`, `supportsCancellation`).
The CLI supplies it from a validated file or the adapter-owned hardware probe
(`adapters/adaptive-workflow/runtime-profile.js`). Hardware influences resource
policy and context size but never correctness or validation criteria.

## Strategy-selection rules

`selectStrategy(...)` in `strategy-policy.js` is deterministic and versioned:

- Effective context = the smallest positive provider/model/runtime/policy limit.
- A strategy is eligible only if capability requirements and `minContextTokens`
  are met (and any explicit benchmark rule is satisfied).
- Ordering: `score_desc → precedence_asc → fallback_order → strategy_id`.
- If no strategy is eligible, selection **fails deterministically** rather than
  picking an ineligible fallback.
- Built-ins: `flagship_full_context_v1` (flagship route) and
  `local_sectional_repair_v1` (budget-loop sectional route).

## Adding a new model provider

1. Add `adapters-cli/src/adapters/model/<provider>.js` implementing
   `ModelAdapterPort` (`generate(ModelRequestV1) → ModelResponseV1`); keep
   credentials, endpoints, and HTTP entirely in the adapter.
2. Export it from `adapters/model/index.js`.
3. Add fixture-backed request/response normalization tests under
   `tests/adapters-cli/model-adapters.test.js`. No live calls.

## Adding a new validation rule

1. Add a validator `{ id, version, paths?, validate(value, context) }` to the
   registry passed as the `validator` port. Return `{ ok, issues }`; a validator
   that returns `ok:false` without issues gets a synthesized issue so invalid
   output can never pass silently.
2. `paths` scope which changed paths re-run the validator after a repair.
3. Cover it under `tests/runtime/adaptive-workflow-validators.test.js`.

## Adding a new orchestration strategy

1. Pass a `strategies`/`fallbackOrder` override to `createStrategyPolicyV1(...)`
   with `id`, `precedence`, `score`, `minContextTokens`, `requires`,
   `resourcePolicy`, and optional `benchmark { required, minAverageScore }`.
2. If the route needs new seam behavior, extend `runSelectedSeam` in `runner.js`.
3. Cover eligibility, tie-breaking, and fallback in
   `tests/runtime/adaptive-workflow-strategy-policy.test.js`.

## Running orchestration benchmarks & promoting evidence

Benchmark data is **offline evidence only**; it never silently rewrites routing.

1. Produce a content-gen `summary.md` (see the root `CLAUDE.md` benchmark
   commands). Results stay uncommitted.
2. Load it: `loadBenchmarkEvidenceFromSummary(path, { strategyIdByProfile, asOf })`
   (`adapters/adaptive-workflow/benchmark-evidence-loader.js`) derives
   `BenchmarkEvidenceV1` per profile and classifies each entry
   (`accepted` / `ignored` with reasons: `stale`, `insufficient_sample_size`,
   `unstable`, `low_confidence`, `future_timestamp`, `invalid_*`).
3. Promote explicitly with `promoteBenchmarkPolicy({ policy, promotions, asOf })`
   (`benchmark-evidence.js`), which returns a **new** versioned policy
   (`provenance.source: "benchmark-promotion"`); the source policy is never
   mutated. Loaded evidence alone changes nothing until promoted.

## Diagnosing a failed run

- **Metrics** — `summarizeAdaptiveWorkflowMetrics(...)` (`metrics.js`) is attached
  to every runner result as `.metrics`: outcome, model/provider, selected
  strategy, phase transitions, prompt/response hashes, validation pass/fail
  counts, repair actions, side-effect counts, latency, token usage, and a
  redaction count. Prompt/response text is recorded only as fingerprints;
  credential-shaped values are never copied out.
- **Failure taxonomy** (`failures.js`): `model_transport`, `model_contract`,
  `validation`, `execution`, `infrastructure`, `persistence`, `cancellation`,
  `budget_exhaustion`. `result.failure.{category,code,phase}` pinpoints the stage.
- **Common codes**: `retry_exhausted` / `oscillation_detected` (validation stall),
  `timeout` (model_transport), `idempotency_conflict` / `durable_candidate_missing`
  (persistence), `patch_target_mismatch` (repair).
- **Replay** — re-run deterministically from recorded responses with
  `ak workflow replay --out-dir <run>`; it performs no live model/execution call
  and writes only `replay-*` sidecars.

## Surfaces

- **CLI**: `ak workflow <run|status|replay|cancel|validate>` — see
  [`packages/adapters-cli/README.md`](../packages/adapters-cli/README.md).
- **MCP tools**: `ak_workflow_run|status|replay|cancel|validate`.
- **MCP resources**: `agent-kernel://adaptive-workflow/{policy,runtime-profile,validators,run-history}`.
