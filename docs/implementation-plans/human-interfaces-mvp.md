# Human Interfaces MVP Plan

Goal: ship runnable, human-facing MVPs for both CLI and web UI that exercise the existing adapters (IPFS, blockchain, LLM, solver) using fixtures or stubbed behavior. Success means a user can run the CLI demos and open the browser UI to trigger adapter calls without needing live network dependencies.

## Baseline findings
- CLI: `packages/adapters-cli/src/cli/ak.mjs` already exposes solve/run/replay/inspect plus ipfs/blockchain/llm demo commands with fixture flags. Docs live in `packages/adapters-cli/README.md`. `build/core-as.wasm` is required for run/replay and is copied to `packages/ui-web/assets/core-as.wasm` by `pnpm run build:wasm`.
- Web UI: `packages/ui-web/index.html` + `src/main.js` load WASM and show a counter + effect log via `createRuntime` and `createDomLogAdapter`. No adapter playground is exposed yet; there is no visible IPFS/blockchain/LLM/solver surface.
- Web adapters: `packages/adapters-web/src/adapters/*` include fetch-based ipfs/blockchain/llm and stubbed solver/wrapper modules. They accept injected `fetchFn` for fixture mode; adapter fixtures live in `tests/fixtures/adapters`.
- Tests: adapter smoke/golden tests exist under `tests/adapters-cli` and `tests/adapters-web`, but there is no UI smoke test or end-to-end quickstart that mirrors the human walkthrough.

## Plan
1) Preconditions and quickstart alignment
   - Document a single quickstart that builds WASM, runs CLI demos, and serves the web UI (docs entry under `docs/README.md` or a short `docs/human-interfaces.md` referenced from there). Keep `packages/adapters-cli/README.md` examples in sync with `ak.mjs --help`.
   - Add a small validation script or Node test to assert `build/core-as.wasm` and `packages/ui-web/assets/core-as.wasm` exist (skipping when missing) so both surfaces fail fast in CI.

2) CLI MVP walkthrough (fixtures-first)
   - Add “demo” invocations for each adapter to `packages/adapters-cli/README.md` that default to fixture mode and write artifacts under `artifacts/<command>/`. Ensure solver demo references `tests/fixtures/artifacts/solver-result-*.json`.
   - Create a helper script (e.g., `scripts/demo-cli.sh`) or npm script that runs the four primary demos (`solve`, `run`, `replay`, `inspect`) plus one adapter demo (`ipfs`, `blockchain`, `llm`) with fixtures to produce a ready-made artifact bundle.
   - Tests: extend `tests/adapters-cli/ak-golden.test.js` (or add `demo-smoke.test.js`) to execute the demo script/commands with fixtures and assert artifact presence + schema fields. Keep tests offline by stubbing fetch via existing fixture files.

3) Web UI adapter playground (mocked by default)
   - Add a new panel in `packages/ui-web/index.html`/`src/main.js` that surfaces IPFS/blockchain/LLM/solver interactions. Default to fixture mode using `tests/fixtures/adapters` payloads; provide a toggle to switch to live URLs when desired.
   - Extract pure adapter-calling helpers (no DOM) under `packages/ui-web/src/` so they can be tested in Node with injected fetch stubs; keep UI wiring thin and deterministic. Respect dependency direction (ui-web -> runtime -> bindings-ts -> core-as; UI calls adapters, not core-as directly).
   - Show responses in the UI (JSON preview/log), and include minimal error states (missing fixture, network failure) without blocking the existing counter demo.
   - Tests: add `tests/ui-web/adapter-playground.test.js` (Node + jsdom or happy-dom) to cover helper functions and DOM wiring; reuse fixture payloads. Keep runner `node --test`.

4) Cross-cutting polish and docs
   - Add a short “manual smoke” checklist in `docs/README.md` or `docs/reference-handout.md` linking to the CLI demo script and the served UI URL (`pnpm run serve:ui` -> `http://localhost:8001/packages/ui-web/index.html`).
   - Ensure artifacts/fixtures naming follows `packages/runtime/src/contracts/artifacts.ts` and `tests/fixtures/**` conventions. If any new adapter schema surfaces are exposed, add matching fixtures (valid + invalid) under `tests/fixtures/artifacts`.
   - If UI/CLI behavior or flags change, update `packages/adapters-cli/README.md` and `docs/architecture/diagram.mmd` only if new flows alter boundaries; otherwise keep architecture unchanged.

## Exit criteria
- `pnpm run build:wasm` followed by the demo script produces artifact bundles for solve/run/replay/inspect and fixture-backed adapter calls without network access.
- `pnpm run serve:ui` loads a page where a user can step/reset the runtime counter and trigger adapter calls (fixture-backed by default) with visible results/errors.
- Automated tests cover the demo CLI flows and adapter playground helpers; UI smoke tests skip gracefully when WASM is missing.
