# README Index — Where Code Belongs

Use this index to determine which package or directory owns a piece of functionality before generating or placing code.

| README Path | What belongs here |
|---|---|
| `README.md` | Project overview: WASM-first simulation kernel, Ports & Adapters structure, quick-start commands. |
| `docs/README.md` | Architecture law, design intent, vision constraints, and implementation plans — normative reference only. |
| `packages/core-as/assembly/README.md` | Deterministic simulation logic only: world state, actors, legal actions, rules, render frames. No IO, no imports outside itself. |
| `packages/core-as/assembly/ports/README.md` | Effect and port shapes that core-as emits as data — the WASM-to-runtime boundary contract. |
| `packages/adapters-cli/README.md` | Node-based CLI commands (build, solve, run, replay, inspect) and CLI-specific adapter wiring. |
| `packages/adapters-cli/src/adapters/blockchain/README.md` | JSON-RPC blockchain client for CLI workflows (getBalance, mintCard). Never in core-as. |
| `packages/adapters-cli/src/adapters/ipfs/README.md` | HTTP-gateway IPFS fetch for CLI workflows. Never in core-as. |
| `packages/adapters-cli/src/adapters/llm/README.md` | Ollama HTTP client for CLI Orchestrator/Director workflows. Never in core-as. |
| `packages/adapters-cli/src/adapters/solver-z3/README.md` | Deterministic fixture-backed solver adapter for CLI solve command. |
| `packages/adapters-web/src/adapters/blockchain/README.md` | JSON-RPC blockchain client for browser Orchestrator/Allocator workflows. |
| `packages/adapters-web/src/adapters/ipfs/README.md` | Browser fetch-based IPFS gateway adapter for runtime personas. |
| `packages/adapters-web/src/adapters/llm/README.md` | Ollama HTTP client for browser Orchestrator/Director workflows. |
| `packages/adapters-test/README.md` | Deterministic fixture-backed test doubles for all external IO (IPFS, blockchain, LLM). |
| `packages/adapters-test/src/adapters/blockchain/README.md` | Test adapter returning fixed blockchain balances/responses without network. |
| `packages/adapters-test/src/adapters/ipfs/README.md` | Test adapter returning registered fixture text/JSON for CIDs. |
| `packages/adapters-test/src/adapters/llm/README.md` | Test adapter returning deterministic LLM responses for model/prompt pairs. |
| `packages/runtime/src/personas/actor/README.md` | Actor persona: stateful decision-makers with stackable motivations (mobility, posture, cognition). |
| `packages/runtime/src/personas/allocator/README.md` | Allocator persona: budget policy, cost model evaluation, budget receipt issuance. |
| `packages/runtime/src/personas/annotator/README.md` | Annotator persona: passive telemetry collection and structured summary emission. |
| `packages/runtime/src/personas/configurator/README.md` | Configurator persona: plan → executable SimConfig translation, validation, optional solver checks. |
| `packages/runtime/src/personas/director/README.md` | Director persona: goal → structured plan, LLM-backed content generation, artifact authoring. |
| `packages/runtime/src/personas/moderator/README.md` | Moderator persona: simulation clock, phase ordering, action sequencing, effect routing. |
| `packages/runtime/src/personas/orchestrator/README.md` | Orchestrator persona: external-service coordination, boundary guardian, intent brokering. |
| `tests/fixtures/adapters/README.md` | Deterministic payloads for IPFS, blockchain, LLM, and effects routing — no network calls. |
| `tests/fixtures/artifacts/README.md` | Schema-valid JSON artifact fixtures for loading/serialization validation across all artifact types. |
