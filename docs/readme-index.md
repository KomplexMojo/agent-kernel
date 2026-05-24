# README Index - Where Code Belongs

Use this index to determine which package or directory owns a piece of functionality before placing code.

| README Path | What belongs here |
|---|---|
| `README.md` | Project overview, Ports & Adapters structure, quick-start commands. |
| `docs/README.md` | Architecture law, design intent, vision constraints, and implementation plans. |
| `packages/core-ts/` | Deterministic simulation logic: state, actors, rules, render buffers, affinity, motivation. No IO. |
| `packages/adapters-cli/README.md` | Node-based CLI commands and CLI-specific adapter wiring. |
| `packages/adapters-test/README.md` | Deterministic fixture-backed test doubles for external IO. |
| `packages/runtime/src/personas/` | Persona FSMs and controller responsibilities. |
| `tests/fixtures/adapters/README.md` | Deterministic payloads for IPFS, blockchain, LLM, and effects routing. |
| `tests/fixtures/artifacts/README.md` | Schema-valid JSON artifact fixtures. |
