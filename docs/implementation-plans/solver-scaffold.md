# Solver Scaffold Plan

Goal: integrate a solver (e.g., Z3) as a deterministic adapter behind a solver port, used by personas (Director/Configurator/Allocator) without touching core-as.

## Steps
1) Contracts and ports
   - Add/extend `packages/runtime/src/ports/solver.js`:
     - Export `SolverPort` with a `solve(adapter, request)` function signature.
     - Reference request/response shapes from `packages/runtime/src/contracts/artifacts.ts` (SolverRequest/SolverResult).
     - Normalize status: fulfilled | deferred | error; include error.reason when failures occur.
   - Adapter interface:
     - `async solve(request): SolverResult` (deterministic; no side effects beyond return value).
     - Accept fixture-based responses for tests; allow optional `deferred`/`unavailable` marker.
   - Error/deferred handling:
     - If adapter throws/rejects, wrap as `{ status: "error", reason }`.
     - If adapter returns `deferred`, propagate as `{ status: "deferred", reason }`.
   - Keep the port pure and data-only; no direct IO or global state.

2) Adapter scaffold
   - CLI adapter: `packages/adapters-cli/src/adapters/solver-z3/index.js`
     - Expose `createSolverAdapter({ fixtures })` with `solve(request)` returning a fixture match or deterministic stub result.
     - No external IO; allow injecting fixture path for tests.
   - Test adapter: `packages/adapters-test/src/adapters/solver/index.js`
     - Deterministic lookup from `tests/fixtures/artifacts/solver-result-*.json` keyed by request.meta.id or label.
     - If missing, return `{ status: "deferred", reason: "missing_fixture" }`.
   - Web stub (if needed): `packages/adapters-web/src/adapters/solver/index.js` mirroring CLI behavior with fixture injection.
   - All adapters must be pure/stubbed (no network/process spawn); they only return data.

3) Persona integration points
   - Director: add a phase hook (decide) to emit SolverRequest artifacts to the solver port; store SolverResult in persona context (data-only). Provide fixture-friendly payloads for tests.
   - Configurator: optional validation hook that calls solver port with layout/constraints; bounded (no external IO), returns deferred if solver unavailable.
   - Allocator: optional feasibility hook using solver for budget/plans; bounded and deterministic.
   - Runtime wiring: add helper in tick orchestrator or persona harness to invoke solver port via an injected adapter map (e.g., `adapters.solver`), never from core-as.
   - Ensure persona outputs remain data-only; solver IO stays in adapters/ports.

4) CLI support
   - Extend `packages/adapters-cli/src/cli/ak.mjs`:
     - Add `solve` subcommand that loads a solver adapter (fixture-friendly) and writes `artifacts/solve/solver-request.json` + `solver-result.json`.
     - Flags: `--solver-fixture <path>` to force fixture result; `--out-dir` to override artifacts path; `--run-id`/`--correlation-id`.
     - Build SolverRequest meta with deterministic IDs/timestamps (inject clock).
   - Add solver adapter wiring:
     - Map `--solver-fixture` to `createSolverAdapter({ fixturePath })`.
     - Default to stubbed adapter when no fixture provided (no network/process spawn).
   - Update `packages/adapters-cli/README.md` with usage and fixture examples.
   
5) Tests and fixtures
   - Add solver fixtures under `tests/fixtures/artifacts/solver-request-*.json` and `solver-result-*.json` (valid/invalid).
   - Add adapter tests:
     - CLI: `tests/adapters-cli/solver.test.js` covering `solve --solver-fixture` and stub paths.
     - Adapter modules: extend `tests/adapters-cli/adapter-modules.test.js` to assert solver-z3 adapter exports `solve`.
     - Test adapters: `tests/adapters-test/solver.test.js` ensuring fixture lookup and deferred behavior.
   - Persona integration tests:
     - Use test solver adapter to feed deterministic SolverResult into Director/Configurator/Allocator.
     - Assert emitted `solver_request` effect shape and context updates; assert deferred when fixture missing.

   
6) Docs
   - Update `docs/reference-handout.md` to note solver as an adapter and list the solver port path.
   - Update `docs/architecture/persona-state-machines.md` if solver affects persona transitions (e.g., Director refinement depends on solver result); note solver_request effects.
   - Add a short README under `packages/adapters-cli/src/adapters/solver-z3/` describing stubbed behavior, fixture flag, and determinism (no IO).

7) Runtime wiring
   - Add a helper in tick orchestrator/persona harness to consume `solver_request` effects via injected adapters (e.g., adapters.solver + solver port), returning SolverResult data into persona context.
   - Ensure this stays pure/data-only; solver IO remains in adapters/ports.
   - Flow:
     1) Persona emits `effects: [{ kind: "solver_request", request }]`.
     2) Orchestrator helper collects these, calls `solverPort.solve(adapters.solver, request)`.
     3) Attach SolverResult back to persona context (data-only) and include in fulfilled effects list.
   - Determinism:
     - Inject clock into solverPort for meta; no Date.now/Math.random here.
     - If no solver adapter present, return deferred `{ status: "deferred", reason: "missing_solver" }`.
   - Keep runtime-core boundary intact: no direct core-as calls; all solver IO stays in adapters/ports.

8) Additional persona integration tests
   - Add solver_request effect tests for Configurator and Allocator (and optionally Annotator/Orchestrator) using the test solver adapter; assert deferred when fixture missing.
   - Include both paths:
     - With fixture: solverRequest emitted, adapter returns SolverResult, persona context updated (lastSolverRequest), solverResults recorded.
     - Without fixture: solverRequest emitted, status=deferred reason=missing_fixture/missing_solver.
   - Use test solver adapter + fixture lookup under `tests/fixtures/artifacts`.

9) Adapter fixtures/tests (optional hardening)
   - Add deferred/error solver fixtures.
   - Add web solver adapter test to mirror CLI/test behavior.
   - Ensure CLI/test adapters handle deferred/error fixtures consistently (status/ reason).
