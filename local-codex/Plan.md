# Plan.md

Use this file to define the remaining milestones, validations, and branch-completion criteria.

## Stitch UI Rewrite Plan Overlay (2026-03-28)

Source plan: `[Spec](intent://local/note/spec)` sections `M0` through `M7`.

| Milestone | Status | Notes |
| --- | --- | --- |
| M0 | Completed | Stitch readiness and screen inventory recorded. |
| M1 | Completed | Standalone Stitch POC page implemented with deterministic test coverage. |
| M2 | Completed | Command-host proof completed; rewrite decision recorded as `go`. |
| M3 | Completed | Shell/navigation rewrite landed on approved rails. |
| M4 | Completed | Design surface rewrite landed on approved rails. |
| M5 | Completed | Preview/Run surface rewrite landed on approved rails. |
| M6 | Completed | Diagnostics surface rewrite landed on approved rails. |
| M7 | Completed | Regression ring and docs sync completed after repaired-`main` baseline reconciliation. |

M7 validation status:
- Initial ring on 2026-03-27 recorded missing tracked-file blockers during handoff.
- Final ring after baseline reconciliation:
  - `pnpm run build:wasm` -> pass
  - `node --test tests/ui-web/*.test.mjs` -> pass (`83` passed)
  - `node --test tests/integration/*.test.js` -> pass (`15` passed, `1` skipped live LLM test)
  - `pnpm run serve:ui` smoke -> previously confirmed pass on 2026-03-27 (`http://localhost:8001/packages/ui-web/index.html` returned `200`)

Resolved blockers from the initial M7 regression ring:
- Missing runtime module import target: `packages/runtime/src/build/orchestrate-build.js` (imported by `packages/runtime/src/commands/kernel.js`).
- Missing fixture file referenced by UI test: `tests/fixtures/artifacts/budget-artifact-v1-basic.json`.

## 1) Current Checkpoint

Already completed:
- M1: parity inventory and matrix creation
- M2: direct Room/Attacker/Defender CLI authoring parity
- U1: shared command kernel extraction for core artifact/runtime commands
- U2: browser worker command host for shared-kernel commands
- U3: active UI build/planning flows moved onto the browser command host
- U6: Node-vs-browser equivalence coverage for the shared-kernel command set

Branch-close status:
- branch-close items 1-5 are complete in the narrowed hook-first scope
- `B2-S4` remains at the current checkpoint by design; deeper IPFS/blockchain/live-runtime-LLM product work now belongs to follow-on branches because the shared hooks are already present here

## 2) Branch Milestones

| Milestone | Status | Requirement | Tests | Code Targets | Validation |
| --- | --- | --- | --- | --- | --- |
| M1 | Completed | Create UI-to-CLI parity inventory and classify gaps by severity. | Docs-only | `local-codex/ui-cli-parity-matrix.md` | Recorded |
| M2 | Completed | Implement high-priority direct authoring parity for Room, Attacker, and Defender flows. | `tests/adapters-cli/**` | `packages/adapters-cli/src/cli/ak-impl.mjs`, related runtime glue | Recorded |
| M3 | Completed | Close remaining deterministic parity gaps and resolve partial parity rows that affect the active workflow. | `tests/adapters-cli/**`, `tests/adapters-web/**`, `tests/integration/**`, `tests/ui-web/**` | Shared command/kernel, browser host, targeted UI/diagnostics/runtime files | Parity matrix normalized; targeted parity/equivalence suites green |
| M4 | Completed | Finish shared-rails unification and dependency reduction for the default workflow. | Targeted adapter/runtime/browser tests | `packages/runtime/src/commands/**`, `packages/adapters-web/src/adapters/**`, `packages/adapters-cli/src/adapters/**`, active UI wiring | Core workflow no longer depends on unnecessary environment-specific paths; deeper capability product work split to follow-on branches |
| M5 | Completed | Final verification, minimal-install gate, docs close-out, and branch handoff. | Full/targeted regression pass | `local-codex/Documentation.md`, docs, remaining touched files | Validation matrix green and logged |

Rules:
- Each milestone must map requirement -> tests -> code.
- Each milestone should be independently reviewable.
- Replaced legacy paths must be removed in the same milestone once the replacement is validated.

## 3) UI-CLI Unification Track

Reference: [ui-cli-unification-plan.md](/Users/darren/Documents/GitHub/agent-kernel/local-codex/ui-cli-unification-plan.md)

| Track Milestone | Status | Requirement | Code Targets | Validation |
| --- | --- | --- | --- | --- |
| U1 | Completed | Extract Node-independent command kernel for core CLI commands. | `packages/runtime/src/commands/**`, `packages/adapters-cli/src/cli/ak-impl.mjs` | Recorded |
| U2 | Completed | Add browser worker host for the shared command kernel. | `packages/adapters-web/src/adapters/cli-worker/**` | Recorded |
| U3 | Completed | Route active UI build/planning flows through the command host. | `packages/ui-web/src/views/design-view.js`, `packages/ui-web/src/pool-flow.js`, `packages/ui-web/src/ollama-panel.js` | Recorded |
| U4 | Completed | Keep `ipfs`, `blockchain`, and `llm` on shared contracts/host rails and centralize duplicated adapter behavior behind shared hooks. | `packages/adapters-cli/src/adapters/**`, `packages/adapters-web/src/adapters/**`, related shared modules | Adapter tests + parity decision log updated; follow-on product branches identified for deeper lifecycle work |
| U5 | Completed | Remove remaining legacy execution paths and Node-only assumptions from the active parity scope. | `packages/ui-web/**`, `packages/adapters-web/**`, `scripts/**`, adapter wrappers | No active UI workflow depends on legacy bridge/direct-only paths |
| U6 | Completed | Add Node-vs-browser equivalence tests for shared-kernel outputs. | `tests/integration/**`, `tests/ui-web/**`, `tests/adapters-cli/**` | Recorded |
| U7 | Completed | Finish docs and architecture cleanup so the branch closes with an explicit single-rails story. | `docs/**`, `packages/adapters-cli/README.md`, `local-codex/**` | Docs match implemented architecture and intentional exclusions |
| U8 | Completed | Validate and document the minimum-install baseline for the default workflow. | Docs + any small dependency/isolation follow-ups | Core workflow runs without optional external adapters/services |

## 4) Work Package Index

All work-package IDs below are historical tracking anchors. Their in-scope branch-close work is completed in this branch, and any deeper product work is explicitly deferred to follow-on branches.

| ID | Requirement | Target Milestone | Planned Validation |
| --- | --- | --- | --- |
| B1 | Resolve the remaining `partial` parity rows that affect the default Design -> Preview -> Run workflow. | M3 | Targeted UI/browser/integration suites pass and matrix rows updated |
| B2 | Confirm the shared-rails hooks/contracts for `ipfs`, `blockchain`, and `llm`, then split deeper lifecycle/product work into follow-on branches. | M4 / U4 | Decision logged; matrix/docs updated; tests match the narrowed branch boundary |
| B3 | Consolidate duplicated CLI/web adapter behavior where it remains in active scope. | M4 / U4 | Adapter tests pass with thinner env wrappers |
| B4 | Remove any remaining unnecessary dependency coupling from the default workflow and document the minimal-install path. | M4 / U8 | Manual and automated validation recorded in `Documentation.md` |
| B5 | Run the final branch-close regression package and record any intentional skips/deferred live-service cases. | M3 / M5 | Regression package recorded in `Documentation.md` |
| B6 | Finish documentation, parity matrix closure, and final branch handoff. | M5 / U7 | Merge-readiness checklist fully checked |

### Completed Slice: B1-S1

Completed slice summary:

- Slice ID: `B1-S1`
- Target row:
  - `Design | Budget split controls + BuildSpec dispatch from the card set`
- Why this is first:
  - it is a high-severity `partial` row,
  - it sits directly on the default Design -> Preview -> Run workflow,
  - and it is currently blocked by the known `ak-configurator` layout expectation drift.

Requirement:
- close the parity gap for Design budget split / BuildSpec dispatch by proving that the authored card set and budget split flow produce the intended configurator/build artifacts on the same rails as the CLI.

Known fault to resolve:
- `tests/adapters-cli/ak-configurator.test.js` currently fails because the generated layout differs from the expected fixture:
  - spawn/exit placement changed,
  - room id fields (`entryRoomId`, `exitRoomId`, room `id`) are now present,
  - the expected layout fixture no longer matches runtime output.

Tests to update or add:
- `tests/adapters-cli/ak-configurator.test.js`
- `tests/integration/ui-cli-equivalence.test.js`
- `tests/ui-web/design-view.test.mjs`
- add/update any required fixture under `tests/fixtures/artifacts/**`

Likely code targets:
- `packages/runtime/src/personas/configurator/**`
- `packages/runtime/src/personas/director/buildspec-assembler.js`
- `packages/runtime/src/commands/ui-flow.js`
- `packages/ui-web/src/views/design-view.js`
- only if needed: `packages/adapters-cli/src/cli/ak-impl.mjs`

Completion criteria for this slice:
- the intended configurator layout behavior is decided:
  - restore previous behavior, or
  - rebaseline fixtures/tests to the new intended behavior;
- `ak-configurator` targeted tests pass;
- the parity matrix row can be promoted from `partial` only if:
  - UI and CLI budget split / dispatch behavior match on the shared command path,
  - artifact outputs are validated,
  - docs/status are updated.

Status update:
- Completed on 2026-03-15 by rebaselining the configurator fixtures to the current deterministic room-aware output and rerunning the targeted CLI/browser/UI parity suite.

### Completed Slice: B5-S1

Completed slice summary:

- Slice ID: `B5-S1`
- Scope:
  - resolve the two tracked baseline failures (`TEST-LLM-1`, `TEST-WEB-1`),
  - and close the remaining diagnostics budget-panel parity row by wiring live panels to canonical build/bundle artifacts.

Requirement:
- keep baseline suites green without reintroducing legacy behavior, and move diagnostics budget JSON panels off fixture-only display behavior.

Tests updated:
- `tests/adapters-cli/ak-llm-plan.test.js`
- `tests/adapters-web/adapter-modules.test.js`
- `tests/ui-web/budget-panels.test.mjs`
- `tests/fixtures/e2e/llm-summary-response.json` (prompt fixture rebaseline for integration determinism)

Code targets:
- `packages/ui-web/src/budget-panels.js`
- `packages/ui-web/src/views/diagnostics-view.js`

Completion criteria:
- `ak-llm-plan` budget-loop telemetry expectations align with current hallway-cost semantics.
- `adapter-modules` level-builder expectations align with current walkable target semantics.
- Diagnostics budget panels render canonical budget/price-list/receipt data from build/bundle artifacts in live mode.

Status update:
- Completed on 2026-03-21 with targeted and broad adapter/UI/integration suites passing.

### Completed Slice: B2-S0

Completed slice summary:

- Slice ID: `B2-S0`
- Scope:
  - extract standalone `ipfs` / `blockchain` / `llm` command execution onto shared command-kernel rails,
  - expose those commands through the browser command host,
  - and route Diagnostics adapter-panel interactions through command-host methods.

Requirement:
- remove remaining standalone adapter-command divergence between CLI and browser-host paths before deeper product-flow slices (`B2-S1` / `B2-S2` / `B2-S3`).

Tests updated:
- `tests/adapters-web/cli-worker.test.js`
- `tests/ui-web/adapter-playground.test.mjs`

Code targets:
- `packages/runtime/src/commands/kernel.js`
- `packages/adapters-cli/src/cli/ak-impl.mjs`
- `packages/adapters-web/src/adapters/cli-worker/shared.js`
- `packages/adapters-web/src/adapters/cli-worker/index.js`
- `packages/ui-web/src/adapter-panel.js`
- `packages/ui-web/src/views/diagnostics-view.js`

Completion criteria:
- CLI `ipfs` / `blockchain` / `llm` commands delegate adapter execution through the shared command kernel.
- Browser command host exposes `ipfs` / `blockchain` / `llm` actions.
- Diagnostics adapter panel prefers command-host paths for these commands.

Status update:
- Completed on 2026-03-21 with adapters-cli/adapters-web/ui-web/integration regressions green.

### Completed Slice: B2-S1A

Completed slice summary:

- Slice ID: `B2-S1A`
- Scope:
  - implement canonical IPFS artifact reload on shared rails,
  - expose `ipfs-load` in CLI and browser command host,
  - and wire Diagnostics IPFS action to load bundle/manifest into Bundle Review.

Requirement:
- support restoring canonical artifact sets (`bundle.json` and related files) from CID-backed content on the same command rails used by CLI/UI.

Tests updated:
- `tests/adapters-cli/ak-adapter-commands.test.js`
- `tests/adapters-web/cli-worker.test.js`
- `tests/ui-web/adapter-playground.test.mjs`
- new fixture: `tests/fixtures/adapters/ipfs-artifacts-map.json`

Code targets:
- `packages/runtime/src/commands/kernel.js`
- `packages/adapters-cli/src/cli/ak-impl.mjs`
- `packages/adapters-web/src/adapters/cli-worker/shared.js`
- `packages/adapters-web/src/adapters/cli-worker/index.js`
- `packages/ui-web/src/adapter-panel.js`
- `packages/ui-web/src/views/diagnostics-view.js`
- `packages/ui-web/src/bundle-review.js`

Completion criteria:
- `ipfs-load` fetches canonical artifact files from CID/path roots.
- Browser host exposes `ipfs_load` with artifact output parity.
- Diagnostics can hydrate Bundle Review from IPFS-loaded bundle/manifest payloads.

Status update:
- Completed on 2026-03-21.

### Completed Slice: B2-S1B

Completed slice summary:

- Slice ID: `B2-S1B`
- Scope:
  - implement canonical IPFS publish/storage write-path on shared rails to pair with `ipfs-load`,
  - expose `ipfs-publish` in CLI and browser command host,
  - and support Diagnostics-driven publish from canonical loaded bundle artifacts.

Requirement:
- close lifecycle parity for IPFS in active scope (`publish` + `load`), with deterministic fixture-mode support and Node-vs-browser equivalence coverage.

Tests updated:
- `tests/adapters-cli/ak-adapter-commands.test.js`
- `tests/adapters-cli/adapter-modules.test.js`
- `tests/adapters-web/adapter-modules.test.js`
- `tests/adapters-web/cli-worker.test.js`
- `tests/ui-web/adapter-playground.test.mjs`
- `tests/integration/ui-cli-equivalence.test.js`

Code targets:
- `packages/adapters-cli/src/adapters/ipfs/index.js`
- `packages/adapters-web/src/adapters/ipfs/index.js`
- `packages/runtime/src/commands/kernel.js`
- `packages/adapters-cli/src/cli/ak-impl.mjs`
- `packages/adapters-web/src/adapters/cli-worker/shared.js`
- `packages/adapters-web/src/adapters/cli-worker/index.js`
- `packages/ui-web/src/adapter-panel.js`
- `packages/ui-web/src/views/diagnostics-view.js`
- `packages/ui-web/src/build-orchestrator.js`
- `packages/ui-web/src/bundle-review.js`
- `packages/adapters-cli/README.md`

Completion criteria:
- CLI/browser host expose canonical publish contract (`ipfs-publish` / `ipfs_publish`).
- IPFS adapter supports publishing canonical artifact maps and returns CID summary.
- Node-vs-browser artifact equivalence includes `ipfs-publish` and `ipfs-load`.
- Diagnostics can publish current canonical bundle artifacts when no CID is provided.

Status update:
- Completed on 2026-03-21.

### Completed Slice: B2-S2

Completed slice summary:

- Slice ID: `B2-S2`
- Scope:
  - define and implement shared-rails blockchain mint/load command contracts for canonical card configurations,
  - expose `blockchain-mint` / `blockchain-load` in CLI and browser command host,
  - and rewire the Design tab `Mint` affordance to the shared blockchain mint rail with load-by-token support.

Requirement:
- close lifecycle-level blockchain parity in active scope so mint/load uses the same command rails in Node CLI and browser host, with deterministic fixture-mode operation for baseline workflows.

Tests updated:
- `tests/adapters-cli/ak-adapter-commands.test.js`
- `tests/adapters-cli/ak-errors.test.js`
- `tests/adapters-cli/adapter-modules.test.js`
- `tests/adapters-web/adapter-modules.test.js`
- `tests/adapters-web/cli-worker.test.js`
- `tests/ui-web/design-view.test.mjs`
- `tests/integration/ui-cli-equivalence.test.js`

Code targets:
- `packages/adapters-cli/src/adapters/blockchain/index.js`
- `packages/adapters-web/src/adapters/blockchain/index.js`
- `packages/runtime/src/commands/kernel.js`
- `packages/adapters-cli/src/cli/ak-impl.mjs`
- `packages/adapters-web/src/adapters/cli-worker/shared.js`
- `packages/adapters-web/src/adapters/cli-worker/index.js`
- `packages/ui-web/src/design-guidance.js`
- `packages/ui-web/src/views/design-view.js`
- `packages/ui-web/index.html`
- `packages/adapters-cli/README.md`

Completion criteria:
- CLI/browser host expose canonical blockchain mint/load contract (`blockchain-mint` / `blockchain-load`, `blockchain_mint` / `blockchain_load`).
- Design `Mint` action executes shared blockchain-mint rail and no longer acts as shelf-only behavior.
- Design can load minted card payloads by token id into the editor.
- Node-vs-browser artifact equivalence includes blockchain mint/load command outputs.

Status update:
- Completed on 2026-03-21.

### Completed Slice: B2-S3A

Completed slice summary:

- Slice ID: `B2-S3A`
- Scope:
  - move the Diagnostics Ollama prompt workflow onto shared `llm` command rails,
  - add Node-vs-browser artifact equivalence coverage for standalone `llm`,
  - and keep fixture/live behavior service-optional for baseline runs.

Requirement:
- close the remaining command-host parity gap for Diagnostics prompt-driven BuildSpec generation so UI and CLI execute the same `llm` command path.

Tests updated:
- `tests/ui-web/ollama-panel.test.mjs`
- `tests/integration/ui-cli-equivalence.test.js`

Code targets:
- `packages/ui-web/src/ollama-panel.js`

Completion criteria:
- Ollama prompt panel prefers `commandHost.llm` over direct helper adapter execution.
- Standalone `llm` command has explicit Node-vs-browser equivalence coverage.

Status update:
- Completed on 2026-03-21.

### Completed Slice: B2-S3B

Completed slice summary:

- Slice ID: `B2-S3B`
- Scope:
  - surface runtime LLM decision captures from tick-frame `personaArtifacts`,
  - emit a canonical run artifact (`runtime-decision-captures.json`),
  - extend `inspect` and `replay` summaries with runtime decision capture telemetry/comparison.

Requirement:
- align runtime capture/replay/inspect surfaces with the `runtime-decision-v1` contract so runtime LLM decisions are visible and replay-auditable on shared rails.

Tests updated:
- `tests/runtime/run-helpers-runtime-decision.test.js`
- `tests/runtime/command-kernel-inspect-runtime-decision.test.js`
- `tests/adapters-cli/ak.test.js`
- `tests/adapters-web/cli-worker.test.js`
- `tests/integration/ui-cli-equivalence.test.js` (re-run after new run artifact emission)

Code targets:
- `packages/runtime/src/commands/run-helpers.js`
- `packages/runtime/src/commands/kernel.js`
- `packages/adapters-web/src/adapters/cli-worker/shared.js`
- `packages/adapters-cli/README.md`

Completion criteria:
- runtime command writes `runtime-decision-captures.json` from runtime decision capture artifacts.
- inspect summary includes `data.runtimeDecisionCaptures`.
- replay summary includes `runtimeDecisionCaptures` equivalence/comparison block.
- browser command host `run` output exposes `runtimeDecisionCaptures`.

Status update:
- Completed on 2026-03-21.

### Completed Slice: B2-S3C

Completed slice summary:

- Slice ID: `B2-S3C`
- Scope:
  - lock runtime solver->LLM fallback policy for branch close,
  - enforce the policy in runtime provider normalization/orchestrator behavior,
  - and document the decision boundary in the branch artifacts.

Requirement:
- remove ambiguity around automatic solver->LLM fallback by explicitly disabling implicit fallback for this branch and making fallback-not-performed behavior inspectable.

Tests updated:
- `tests/runtime/runtime-decision-contract.test.js`
- `tests/personas/tick-orchestrator.test.js`

Code targets:
- `packages/runtime/src/personas/_shared/runtime-decision.js`
- `packages/runtime/src/personas/_shared/runtime-decision.mts`
- `packages/runtime/src/personas/_shared/tick-orchestrator.js`
- `packages/runtime/src/personas/_shared/tick-orchestrator.mts`
- `local-codex/runtime-reasoning-contract.md`

Completion criteria:
- default runtime decision provider policy sets `allowLlmFallback=false`.
- solver-path runtime decisions do not auto-call LLM when solver is unfulfilled.
- when fallback is requested, runtime records that fallback was not performed (`auto_llm_fallback_disabled`).

Status update:
- Completed on 2026-03-21.

### Completed Slice: B4-S1

Completed slice summary:

- Slice ID: `B4-S1`
- Scope:
  - document the minimum-install baseline for the default Design -> Preview -> Run workflow,
  - make the optional IPFS/blockchain/Ollama boundary explicit in the repo docs,
  - and validate the baseline against the existing browser-host/fixture-first regression coverage.

Requirement:
- define and validate the minimum-install baseline for Design -> Preview -> Run without making live IPFS, blockchain, or Ollama services baseline requirements.

Tests / validation used:
- `node --test tests/ui-web/design-view.test.mjs`
- `node --test tests/ui-web/preview-view.test.mjs`
- `node --test tests/adapters-web/cli-worker.test.js`
- `node --test tests/integration/ui-cli-equivalence.test.js`
- `pnpm run build:wasm`

Code / doc targets:
- `docs/cli-runbook.md`
- `docs/README.md`
- `docs/reference-handout.md`
- `packages/adapters-cli/README.md`
- `local-codex/Prompt.md`
- `local-codex/Documentation.md`
- `local-codex/ui-cli-unification-plan.md`

Completion criteria:
- the minimum-install baseline is documented in the user-facing docs and branch artifacts.
- the default workflow is explicitly described as browser-hosted and fixture-first.
- live IPFS, blockchain, and Ollama services are explicitly optional for the baseline path.

Status update:
- Completed on 2026-03-21.

### Recommended Next Slice

- None inside the completed Stitch / branch-close overlay.
- If work continues, define a new follow-on milestone from the backlog items below instead of reopening `M4` through `M7`.

### Next Implementation Slices: B2

- `B2-S1` IPFS artifact storage and reload
  - Goal:
    - treat IPFS as canonical storage for generated game artifacts,
    - support storing and loading `spec.json`, `bundle.json`, `manifest.json`, `sim-config.json`, `initial-state.json`, and related configuration artifacts through the same command rails,
    - allow a game to be regenerated from IPFS-backed artifacts.
  - Planned outputs:
    - explicit artifact publish/fetch contract,
    - UI load path from IPFS,
    - CLI/browser-host parity for artifact retrieval.

- `B2-S2` Blockchain card mint/load
  - Goal:
    - redefine the current UI `Mint` affordance as actual blockchain-backed minting of canonical card configuration artifacts,
    - allow minted cards to be loaded back into UI/CLI flows and decanted into a game.
  - Planned outputs:
    - mintable card artifact / metadata contract,
    - CLI mint/load commands or command extensions,
    - UI `Mint` wiring on the same rails.

- `B2-S3` Local-first LLM command and runtime decision contract
  - Goal:
    - keep `llm-plan` on shared rails,
    - move standalone `llm` onto shared rails,
    - define a structured runtime decision contract so bosses or actors can use LLM guidance meaningfully.
  - Planned outputs:
    - standard `runtime-decision-v1` payload contract carried through `CapturedInputArtifact`,
    - local Ollama as the primary live adapter target,
    - tracing/capture artifacts suitable for replay and inspection.

- `B2-S4` Runtime reasoning provider contract (solver-first, LLM-optional)
  - Goal:
    - define how actors or bosses consult Z3/solver and, where appropriate, LLMs for next-move decisions,
    - keep deterministic solver reasoning available during execution,
    - keep live LLM reasoning structured and replay-aware.
  - Planned outputs:
    - provider-selection policy (`solver` first for constraint/optimization decisions, `llm` for structured advisory/live decisions),
    - normalized `runtime-decision-v1` request/result payload carried through existing `SolverRequest` / `SolverResult` / `CapturedInputArtifact` artifacts,
    - runtime wiring from observation/context -> reasoning request -> chosen action.
  - Current checkpoint:
    - actor gameplay now emits `runtime-decision-v1` solver requests from live observation/candidate-action context when runtime decisioning is enabled,
    - `replay` / `inspect` now surface normalized runtime decisions and decision-driven actions,
    - explicit manual non-deterministic local Ollama fulfillment is now implemented on the same `solver_request` rail with `CapturedInputArtifact` recording,
    - deterministic/default execution remains deferred or pre-captured for LLM reasoning,
    - automatic solver-to-LLM fallback is still undecided for branch close.
  - Reference:
    - `local-codex/runtime-reasoning-contract.md`

## 5) Validation Matrix

| Command | Purpose | Pass Criteria |
| --- | --- | --- |
| `node --test tests/runtime/*.test.js` | Runtime contract sweep | Command exits 0 |
| `node --test tests/adapters-cli/*.test.js` | CLI regression sweep | Command exits 0 |
| `node --test tests/adapters-web/*.test.js` | Browser adapter/host sweep | Command exits 0 |
| `node --test tests/integration/*.test.js` | Node-vs-browser equivalence sweep | Command exits 0 |
| `node --test tests/ui-web/*.test.mjs` | UI regression sweep | Command exits 0 |
| `node --test "tests/**/*.test.js"` | Full regression pass before branch close | All relevant suites pass |
| `pnpm run build:wasm` | Build sanity gate | Command exits 0 |

## 6) Risk Register

| Risk | Probability | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- |
| False parity (same labels, different behavior) | M | H | Require artifact-level assertions and equivalence tests | Darren/Codex |
| Optional adapter scope silently leaks into core workflow | M | H | Isolate optional integrations and document minimum-install baseline explicitly | Darren/Codex |
| Duplicate adapter implementations keep drifting | H | M | Centralize shared logic and keep env wrappers thin | Darren/Codex |
| Existing baseline failures mask new regressions | M | H | Resolve or explicitly rebaseline before final branch signoff | Darren/Codex |

## 7) Rollback Plan

- Define the minimal rollback scope per milestone.
- If rollback is needed, revert the affected milestone atomically instead of keeping legacy and replacement paths together.
- If parity implementation destabilizes the default workflow, revert only the new slice and keep the documentation status accurate.
- Do not claim branch completion while carrying unresolved execution-path duplication or test drift in active scope.

## 8) Exit Criteria

- All milestone validations are green.
- No unresolved P1/P2 defects remain in changed scope.
- Core UI and CLI workflows run on the same command rails.
- Default author/build/preview/run flow is documented with a low/minimal install path.
- Required docs are updated.
- `Documentation.md` status is current and decision log is complete.
- `local-codex/ui-cli-parity-matrix.md` has no untriaged rows.
- No legacy execution path remains for replaced behavior in completed scope.
- Branch-close focus items 1-5 are all explicitly complete and logged.
