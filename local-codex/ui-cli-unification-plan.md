# UI-CLI Unification Plan

Purpose: make the UI a user-friendly wrapper over the same command/runtime behavior used by the CLI, support browser execution for the default workflow, and remove or isolate unnecessary dependencies that prevent low-install use.

## 1) Current Checkpoint

Completed:
- shared runtime command kernel for core artifact/runtime commands
- browser worker command host for shared-kernel commands
- active UI build/planning flow moved onto the shared command host
- Node-vs-browser equivalence coverage for the shared-kernel command set
- solver-first runtime reasoning now reuses the existing `solver_request` / `SolverRequest` / `SolverResult` rail, and explicit manual local-Ollama fulfillment runs on that same rail with capture recording

Still open:
- none inside the current branch-close scope
- remaining adapter duplication outside the default workflow and deeper IPFS/blockchain/live-runtime-LLM productization continue in follow-on branches

## 2) Review Findings (Ordered by Severity)

1. **P1: close the branch at the same-rails boundary, not at full product completion**
   - Impact: parity and unification are complete for the active workflow once hooks and artifact parity are in place; deeper capability branches should not keep this branch open.

2. **P1: branch scope has to stop at shared hooks, not full productization**
   - Decision:
     - `ipfs`, `blockchain`, and `llm` stay in this branch only at the shared-contract/hook layer,
     - deeper lifecycle/product flows move to dedicated follow-on branches,
     - branch close depends on proving the hooks are present and the default workflow is not blocked by their optional live backends.
   - Impact: remaining work is mainly documentation/matrix normalization, not forcing full product completion into this branch.

3. **P1: minimal-install baseline for the default workflow must stay explicit**
   - Status: documented and validated on 2026-03-21; keep the baseline note visible through branch close.
   - Impact: the branch goal includes lightweight local/browser use, so the docs and acceptance criteria must continue to state the minimum environment clearly.

4. **P2: duplicated adapter behavior remains across `adapters-cli` and `adapters-web`**
   - Impact: drift risk remains even when the visible UI flow is already on the shared command host.

5. **P2: record the broad regression sweep in the handoff docs**
   - Impact: the branch-close claim depends on recorded proof, even when the codebase is already green.

## 3) Target Architecture

- Single command core:
  - command handlers live in shared runtime modules with no direct Node globals.
- Environment shells:
  - Node shell: CLI wrapper over shared handlers.
  - Browser shell: worker-backed command host over the same handlers.
- UI integration:
  - UI submits command requests and artifact JSON to the browser host.
  - UI renders outputs and interaction state; it does not own parallel domain logic.
- Adapter posture:
  - shared behavior lives once,
  - environment wrappers stay thin,
  - `ipfs`, `blockchain`, and `llm` use the same command rails as the rest of the product at the hook/contract layer,
  - live services remain optional for the baseline author/build/run workflow.
- Capability posture:
  - `ipfs` stores canonical artifacts through shared hooks; deeper storage/regeneration product flows can continue in a dedicated branch.
  - `blockchain` mints canonical card configurations through shared hooks; deeper marketplace/loadout product flows can continue in a dedicated branch.
  - `llm` is local-first, with Ollama as the primary live target, and runtime decisions use structured payloads carried through the existing capture artifacts; richer live-runtime product flows can continue in a dedicated branch.
  - `solver` is the primary deterministic runtime reasoning provider and should be used first when a gameplay decision can be expressed as constraints/objectives, reusing the existing `solver_request` / `SolverRequest` / `SolverResult` path rather than inventing a parallel transport.
- Dependency posture:
  - the default workflow should run with repo dependencies plus the normal build baseline,
  - optional external services are never implicit requirements for Design -> Preview -> Run.
  - the baseline path is browser-hosted and fixture-first; live IPFS, blockchain, and Ollama services are optional capabilities, not installation requirements.
- Legacy posture:
  - no preserved bridge-first or duplicate execution path after replacement validation.

## 4) Remaining Milestones

### U4: Unify remaining adapter implementations
- Move duplicated IPFS/blockchain/LLM logic behind shared modules and shared command contracts.
- Keep environment wrappers thin while preserving local-first live adapters and fixture-backed deterministic tests.
- Promote solver-backed runtime reasoning from standalone `solve` utility to a first-class shared-rails gameplay reasoning provider.
- Split any deeper IPFS/blockchain/runtime-LLM product lifecycle work into dedicated follow-on branches once the shared hooks are confirmed.

### U5: Remove remaining legacy execution-path coupling
- Remove any remaining direct or environment-specific execution assumptions from active parity scope.
- Keep the default UI workflow on the shared browser command host only.

### U7: Finish documentation and architecture closure
- Update architecture docs so they describe:
  - the single command rail,
  - the browser-hosted default flow,
  - the local-first live-service boundary,
  - the shared-rails treatment of IPFS, blockchain mint/load, and LLM decisioning.

### U8: Validate the minimal-install default workflow
- Define the minimum environment for the default author/build/preview/run path.
- Record what is optional vs required.
- Trim or isolate unnecessary dependency coupling discovered during this pass.
- Status: documented and validated; keep the baseline note in branch-close docs until handoff.

## 5) Validation Gates

1. `node --test tests/adapters-cli/*.test.js`
2. `node --test tests/adapters-web/*.test.js`
3. `node --test tests/integration/*.test.js`
4. `node --test tests/ui-web/*.test.mjs`
5. `node --test "tests/**/*.test.js"`
6. `pnpm run build:wasm`

## 6) Acceptance Criteria

1. Core UI and CLI author/build/run flows use the same command/runtime behavior.
2. The active browser workflow does not depend on a Node subprocess bridge or duplicate UI-only domain logic.
3. `ipfs`, `blockchain`, and `llm` flows expose shared rails/hooks in the main code even when their deeper product branches and live backends remain optional for the baseline workflow.
4. Solver-backed runtime reasoning is available as a deterministic execution-time provider, with LLM reasoning layered on top only through structured, capture-aware contracts.
5. Duplicate adapter behavior in active scope is removed or intentionally bounded.
6. The minimum-install path for the default workflow is documented and validated, alongside the local-first live-service story.
