# Human Interfaces MVP Plan

Goal: ship runnable, human-facing MVPs for both CLI and web UI that exercise the existing adapters (IPFS, blockchain, LLM, solver) using fixtures or stubbed behavior. Success means a user can run the CLI demos and open the browser UI to trigger adapter calls without needing live network dependencies.

## Baseline findings
- CLI: `packages/adapters-cli/src/cli/ak.mjs` already exposes solve/run/replay/inspect plus ipfs/blockchain/llm demo commands with fixture flags. Docs live in `packages/adapters-cli/README.md`. `build/core-as.wasm` is required for run/replay and is copied to `packages/ui-web/assets/core-as.wasm` by `pnpm run build:wasm`. We need to keep `--help` output, README examples, and fixture paths aligned and add a preflight check for the two WASM copies to fail fast.
- Web UI: `packages/ui-web/index.html` + `src/main.js` load WASM and show a counter + effect log via `createRuntime` and `createDomLogAdapter`. No adapter playground is exposed yet; there is no visible IPFS/blockchain/LLM/solver surface. The new UI must add an adapter panel without breaking the counter/effect log flow.
- Web adapters: `packages/adapters-web/src/adapters/*` include fetch-based ipfs/blockchain/llm and stubbed solver/wrapper modules. They accept injected `fetchFn` for fixture mode; adapter fixtures live in `tests/fixtures/adapters`. UI and tests should inject fixture-backed fetch to stay offline-first and respect dependency direction (ui-web -> runtime -> bindings-ts -> core-as).
- Tests: adapter smoke/golden tests exist under `tests/adapters-cli` and `tests/adapters-web`, but there is no UI smoke test or end-to-end quickstart that mirrors the human walkthrough. We need DOM/helper coverage for the new playground plus a documented offline quickstart that exercises both CLI and UI paths.

## Plan
1) Preconditions and quickstart alignment
   - Document a single quickstart that builds WASM, runs CLI demos, and serves the web UI (docs entry under `docs/README.md` or a short `docs/human-interfaces.md` referenced from there). Include exact commands: `pnpm run build:wasm`, CLI demo invocations (fixture-first), and `pnpm run serve:ui` (or `pnpm run dev:ui` if available). Keep `packages/adapters-cli/README.md` examples in sync with `ak.mjs --help` and the quickstart.
   - Add a small validation script or Node test to assert `build/core-as.wasm` and `packages/ui-web/assets/core-as.wasm` exist (skipping when missing) so both surfaces fail fast in CI. Wire it into CI/test workflow (e.g., `pnpm test:wasm-check` or part of the demo script) and make the quickstart mention the check.

2) CLI MVP walkthrough (fixtures-first)
   - Add “demo” invocations for each adapter to `packages/adapters-cli/README.md` that default to fixture mode and write artifacts under `artifacts/<command>/`. Show exact commands for `ipfs`, `blockchain`, `llm`, and `solve` using `tests/fixtures/adapters/*` and `tests/fixtures/artifacts/solver-result-*.json`, and note the artifact filenames they emit.
   - Create a helper script (e.g., `scripts/demo-cli.sh`) or npm script that runs the four primary demos (`solve`, `run`, `replay`, `inspect`) plus one adapter demo (`ipfs`, `blockchain`, `llm`) with fixtures to produce a ready-made artifact bundle. Script should mkdir the bundle dir, call `ak.mjs` with fixture flags, and report where artifacts were written.
   - Tests: extend `tests/adapters-cli/ak-golden.test.js` (or add `demo-smoke.test.js`) to execute the demo script/commands with fixtures and assert artifact presence + schema fields. Keep tests offline by stubbing fetch via existing fixture files (no network), and ensure run/replay use the locally built `build/core-as.wasm`.

3) Web UI adapter playground (mocked by default)
   - Add a new panel in `packages/ui-web/index.html`/`src/main.js` that surfaces IPFS/blockchain/LLM/solver interactions. Default to fixture mode using `tests/fixtures/adapters` payloads; provide a toggle to switch to live URLs when desired. Keep the existing counter/effect log intact.
   - Extract pure adapter-calling helpers (no DOM) under `packages/ui-web/src/` so they can be tested in Node with injected fetch stubs; keep UI wiring thin and deterministic. Respect dependency direction (ui-web -> runtime -> bindings-ts -> core-as; UI calls adapters, not core-as directly).
   - Show responses in the UI (JSON preview/log), and include minimal error states (missing fixture, network failure) without blocking the existing counter demo. Allow resetting/clearing the panel without touching the runtime.
   - Tests: add `tests/ui-web/adapter-playground.test.js` (Node + jsdom or happy-dom) to cover helper functions and DOM wiring; reuse fixture payloads. Keep runner `node --test` and skip gracefully if WASM is missing for any runtime-dependent UI pieces.

4) Cross-cutting polish and docs
   - Add a short “manual smoke” checklist in `docs/README.md` or `docs/reference-handout.md` linking to the CLI demo script (`pnpm run demo:cli`) and the served UI URL (`pnpm run serve:ui` -> `http://localhost:8001/packages/ui-web/index.html`). Include expected artifacts/outputs for verification.
   - Ensure artifacts/fixtures naming follows `packages/runtime/src/contracts/artifacts.ts` and `tests/fixtures/**` conventions. If any new adapter schema surfaces are exposed, add matching fixtures (valid + invalid) under `tests/fixtures/artifacts` and describe them in `tests/fixtures/README.md`.
   - If UI/CLI behavior or flags change, update `packages/adapters-cli/README.md` and `docs/architecture/diagram.mmd` only if new flows alter boundaries; otherwise keep architecture unchanged. Keep `docs/human-interfaces.md` and README examples aligned with `ak.mjs --help`.

## Exit criteria
- `pnpm run build:wasm` followed by the demo script (`pnpm run demo:cli`) produces artifact bundles for solve/run/replay/inspect and fixture-backed adapter calls without network access (artifacts under `artifacts/demo-bundle` by default).
- `pnpm run serve:ui` loads a page where a user can step/reset the runtime counter and trigger adapter calls (fixture-backed by default) with visible results/errors, and can clear/reset the adapter panel without affecting the counter/effect log.
- Automated tests cover the demo CLI flows and adapter playground helpers; UI smoke tests skip gracefully when WASM is missing and run with fixtures otherwise.
