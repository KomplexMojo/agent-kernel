# Solver-Z3 Adapter (Stub)

Deterministic, fixture-friendly solver adapter used by the CLI `solve` command. No real IO or process spawn.

## Behavior
- `createSolverAdapter({ fixturePath })` returns an adapter with `solve(request)`.
- If `fixturePath` is provided, the adapter returns the parsed JSON fixture as the SolverResult.
- Otherwise returns a stub SolverResult: `{ status: "fulfilled", request, result: { note: "stubbed_solver_result" } }`.
- Meta/timestamps are left to the caller (e.g., CLI) to populate; adapter performs no clock calls.

## Determinism
- No network or external process is used.
- Fixture-driven mode enables fully offline, repeatable results for tests and demos.
