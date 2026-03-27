# Prompt.md

Use this file as the source-of-truth prompt for the UI/CLI parity and unification branch.

## Stitch UI Rewrite Execution Overlay (2026-03-27)

This repo is also executing the approved Stitch rewrite plan from `[Spec](intent://local/note/spec)` (milestones `M0 -> M7`) under existing architecture constraints.

Execution focus for this overlay:
- Keep all Stitch-derived presentation changes in `packages/ui-web/`.
- Preserve command/artifact rails and ports/adapters boundaries.
- Execute one bounded milestone at a time and log requirement -> tests -> code -> validation.

Milestone target set (from spec):
- `M0`: Stitch readiness and screen inventory.
- `M1`: standalone Stitch POC page.
- `M2`: command-host proof and `go` decision.
- `M3`: shell/navigation rewrite.
- `M4`: Design surface rewrite.
- `M5`: Preview/Run surface rewrite.
- `M6`: Diagnostics surface rewrite.
- `M7`: regression ring, docs sync, and handoff.

M7 acceptance gate for handoff:
- `pnpm run build:wasm`
- `node --test tests/ui-web/*.test.mjs`
- `node --test tests/integration/*.test.js`
- `pnpm run serve:ui` smoke check on `/packages/ui-web/index.html`
- `docs/human-interfaces.md` and `docs/README.md` aligned with the rewritten UI workflow
- `local-codex/Prompt.md`, `local-codex/Plan.md`, `local-codex/Implement.md`, and `local-codex/Documentation.md` updated with current execution status

## 1) Problem Statement

`agent-kernel` has working capability in both the UI and the CLI, but the system is still exposed to three forms of drift:

1. Feature drift:
   - a user-facing workflow may exist in the UI without a deterministic CLI equivalent,
   - or a CLI workflow may exist without a clean UI wrapper.
2. Execution-path drift:
   - UI flows can still depend on browser-only orchestration or adapter-specific code paths,
   - while CLI flows use separate command logic and environment assumptions.
3. Dependency drift:
   - Node-only or adapter-specific dependencies can remain entangled with core author/build/run flows,
   - making low-install local use and browser execution harder than they should be.

The branch is not complete until the UI and CLI operate on the same rails for the core workflow, the active browser flow uses the shared command path, the `ipfs` / `blockchain` / `llm` capability layers have explicit shared contracts and hook points in the main code, and unnecessary environment dependencies are removed or isolated from the default experience.

## 2) Goal

Deliver verified parity and unification where:

- the UI is a user-friendly wrapper over the same command/runtime behavior used by the CLI,
- core author/build/preview/run workflows are deterministic and artifact-driven across both environments,
- the primary workflow runs with low or minimal install requirements,
- unnecessary legacy paths and duplicated policy logic are removed.

Plainly: the interface and the CLI should produce and consume the same artifacts, run on the same command rails, and avoid unnecessary dependencies that block lightweight local or browser use.

## 3) Scope

In scope:
- Maintain and finish the UI-to-CLI parity matrix for all meaningful user-facing features in `packages/ui-web`.
- Keep Room/Attacker/Defender authoring parity complete and validated.
- Finish the shared command-rail transition for the active UI workflow.
- Keep `ipfs`, `blockchain`, and `llm` on shared rails at the contract/hook level:
  - `ipfs` hook points store and retrieve canonical game artifacts,
  - `blockchain` hook points mint and load canonical card configurations,
  - `llm` hook points support both design-time authoring and structured runtime decisioning.
- Treat runtime reasoning providers as in-scope shared-rails capability layers:
  - Z3/solver-backed reasoning for deterministic tactical decisions,
  - LLM-backed reasoning for structured, local-first advisory or live decision workflows.
- Eliminate duplicate policy/normalization logic that causes UI/CLI divergence.
- Reduce unnecessary dependency coupling in the core workflow:
  - remove replaced legacy execution paths,
  - keep optional live services out of the baseline author/build/preview/run path,
  - keep the default workflow runnable without extra external services.
- Add or update tests and fixtures that prove parity and equivalence.
- Update docs so the branch can be closed with an explicit statement of what is unified, what is intentionally UI-only, and how the live-service capabilities (`ipfs`, `blockchain`, `llm`) sit on the shared rails.
- Defer deeper productization of `ipfs`, `blockchain`, and live runtime `llm` workflows to follow-on branches once the shared hooks are proven present.

Out of scope:
- New gameplay mechanics unrelated to existing UI or CLI capabilities.
- Visual redesign beyond changes needed to support the parity workflow.
- Preserving deprecated bridge-first or UI-only business logic once the replacement path is validated.
- Carrying compatibility shims indefinitely after the shared path is in place.
- Completing full IPFS lifecycle, blockchain product flows, or live runtime-LLM productization beyond the shared contracts/hooks needed by this branch.

## 4) Constraints

- Follow repo guardrails from `AGENTS.md`.
- Keep dependency direction: `adapters/ui -> runtime -> bindings-ts -> core-as`.
- Do not add IO to `core-as`.
- UI behavior should delegate to shared command/runtime logic rather than re-implementing domain rules in UI-only code.
- Keep diffs small and reviewable.
- Connect requirements -> tests -> code in the same change set when feasible.
- Update docs when behavior or architecture changes.
- Do not keep legacy execution paths in changed scope after replacement validation.
- Default author/build/run flows must not require optional external services or unnecessary install steps beyond the repo baseline.
- `ipfs`, `blockchain`, and `llm` are optional live-service dependencies for the baseline local workflow and separate follow-on product branches once their hooks are present here.
- LLM integration should target local-first execution, with Ollama as the primary live adapter for low-power/self-hosted environments.
- Solver-backed runtime reasoning should be the primary deterministic execution-time reasoning path when the decision can be expressed as constraints/objectives.

## 5) Inputs

Primary docs and code:
- `AGENTS.md`
- `local-codex/Prompt.md`
- `local-codex/Plan.md`
- `local-codex/Implement.md`
- `local-codex/Documentation.md`
- `local-codex/ui-cli-parity-matrix.md`
- `local-codex/ui-cli-unification-plan.md`
- `local-codex/runtime-reasoning-contract.md`
- `packages/ui-web/index.html`
- `packages/ui-web/src/main.js`
- `packages/ui-web/src/views/design-view.js`
- `packages/ui-web/src/views/preview-view.js`
- `packages/ui-web/src/views/simulation-view.js`
- `packages/ui-web/src/views/diagnostics-view.js`
- `packages/adapters-cli/src/cli/ak-impl.mjs`
- `packages/adapters-cli/README.md`

Relevant tests and fixtures:
- `tests/adapters-cli/**`
- `tests/adapters-web/**`
- `tests/integration/**`
- `tests/ui-web/**`
- `tests/runtime/**`
- `tests/fixtures/**`

## 6) Deliverables

Required outputs:
1. `local-codex/ui-cli-parity-matrix.md` reflects the real end-state:
   - `implemented`,
   - `partial` with explicit remaining work,
   - or `ui-only` with rationale.
2. Shared command-rail and CLI/browser-host changes required for parity completion.
3. Tests and fixtures proving deterministic equivalence for the active workflow.
4. Documentation updates covering:
   - CLI usage,
   - architecture/unification boundaries,
   - optional vs core dependency expectations.
5. `local-codex/Documentation.md` records:
   - checkpoint status,
   - decisions,
   - validations,
   - remaining branch-close tasks.

## 7) Acceptance Criteria

Functional:
- Every relevant UI feature is mapped in the parity matrix to:
  - a CLI command + flags + artifact outputs, or
  - an explicit `UI-only` rationale approved in the decision log.
- Core Design -> Preview -> Run behavior is artifact-driven and aligned with CLI command behavior.
- Core author/build/run commands execute on shared rails in both Node and browser-hosted environments.
- The active UI workflow does not depend on a Node subprocess bridge or parallel UI-only domain logic.
- Room/Attacker/Defender authoring parity remains complete and validated.
- `ipfs`, `blockchain`, and `llm` flows expose shared-rails contracts/hooks in the main code, even if deeper product completion is deferred to follow-on branches.
- Runtime reasoning through solver or LLM is treated as shared-rails capability, not an ad hoc gameplay exception.

Dependency / install:
- Core local workflows do not require optional adapter services (`ipfs`, `blockchain`, hosted LLM services) to author, build, preview, or run a level.
- Live `ipfs`, `blockchain`, and `llm` backends remain optional for the baseline local workflow, and the main branch only requires the shared command rails/hook points needed to branch their deeper lifecycle work cleanly.
- LLM live execution targets local Ollama by default rather than a cloud-only dependency.
- Deterministic execution-time reasoning should prefer the solver path; live LLM reasoning must use structured contracts and respect replay/capture constraints.
- The branch documents the minimum environment needed for the default workflow.

Quality:
- No regressions in touched areas.
- Tests for new or changed behavior exist and pass, or remaining baseline failures are resolved before branch completion.
- Architecture constraints are preserved.
- `local-codex/Documentation.md` includes an accurate status, decision log, and validation log.
- Replaced legacy paths are removed rather than retained as dormant fallbacks.

## 8) Codex Execution Prompt

Copy this block into a Codex session when ready:

```text
Continue the UI/CLI parity and unification branch defined in local-codex.
Read Prompt.md, Plan.md, Implement.md, Documentation.md, ui-cli-parity-matrix.md, and ui-cli-unification-plan.md first.
Work only on the remaining branch-completion items.
For each slice:
1) restate the requirement,
2) add or update tests,
3) implement code,
4) run validations,
5) update Documentation.md and the parity matrix.
Keep the UI and CLI on the same command rails.
Do not preserve replaced legacy paths.
Do not leave optional dependency coupling in the default author/build/run workflow.
Follow AGENTS.md.
```

## 9) Open Questions

- Actor runtime reasoning now constructs the shared `runtime-decision-v1` request envelope on the existing `solver_request` rail. If branch close requires additional gameplay sources (for example boss-specific reasoning), they should reuse that same transport instead of introducing a new runtime decision path.
- Live Ollama runtime decisions are not allowed implicitly. Default execution remains deferred/pre-captured only; explicit non-deterministic manual-play mode is the only live local-Ollama path currently implemented.
- Automatic solver-to-LLM fallback is intentionally deferred for this branch close; execution stays solver-first deterministic plus captured/manual live LLM paths only.
- Minimum-install baseline for branch close:
  - browser-hosted Design -> Preview -> Run,
  - repo dependencies only,
  - `pnpm run build:wasm` only for `Run`/`Replay`,
  - optional live IPFS, blockchain, and Ollama services are not required for the default workflow.
