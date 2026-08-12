# README Index - Where Code Belongs

Use this index to determine which package or directory owns a piece of functionality before placing code.

**It lists every README in the repo.** It used to list eight of twenty-four, which made it useless for
the one question it exists to answer: an unlisted directory reads as "no owner documented" rather than
"someone forgot the row". Add a row in the same diff as a new README.

## Top level

| README Path | What belongs here |
|---|---|
| `README.md` | Project overview, Ports & Adapters structure, quick-start commands. |
| `docs/README.md` | Architecture law, design intent, vision constraints, and the reading order for the rest of `docs/`. |
| `tests/README.md` | How the Vitest suite is organized and the contract for delegated test work (`## TODO: Test Permutations` stubs). |
| `scripts/setup/README.md` | `setup-km.sh` and the vault-backed knowledge system it provisions. |

## Core and runtime

| README Path | What belongs here |
|---|---|
| `packages/core-ts/` | Deterministic simulation logic: state, actors, rules, render buffers, affinity, motivation. No IO. |
| `packages/runtime/src/personas/` | Persona FSMs and controller responsibilities (per-persona READMEs below). |
| `packages/runtime/src/render/source-assets/actor-medallions/README.md` | Checked-in source contact sheets for the actor-medallion sprite pipeline. |

## Personas

Each persona README carries an **A1–A5 ownership status** block stating which of its chartered
behaviors have a passing G1 test and which do not. Those blocks mirror
`tests/architecture/persona-authority-registry.js` and are guarded by
`tests/architecture/persona-readme-authority.test.js`, so they cannot drift into a second origin.

| README Path | What belongs here |
|---|---|
| `packages/runtime/src/personas/orchestrator/README.md` | External interaction seam: request intake, adapter selection, LLM rounds, deferred side effects. |
| `packages/runtime/src/personas/director/README.md` | Intent translation: IntentEnvelope → PlanArtifact → BuildSpec, prompt plans, card-set translation. |
| `packages/runtime/src/personas/configurator/README.md` | Configuration assembly, validation and locking; level/actor/card generation and feasibility. |
| `packages/runtime/src/personas/allocator/README.md` | The economy: price lists, base costs, every pricing formula, spend validation, receipts. |
| `packages/runtime/src/personas/actor/README.md` | Action proposal from observations and motivations; no budget policy of its own. |
| `packages/runtime/src/personas/moderator/README.md` | Tick control: ordering strategy, effect fulfilment, affinity resolution, pausing. |
| `packages/runtime/src/personas/annotator/README.md` | Tick-plane telemetry and the end-of-run RunSummary. Build-scope telemetry is glue by charter. |

## Adapters

| README Path | What belongs here |
|---|---|
| `packages/adapters-cli/README.md` | Node CLI commands and CLI-specific adapter wiring. |
| `packages/adapters-cli/src/mcp/README.md` | The `agent-kernel-cli` MCP server exposed over stdio. |
| `packages/adapters-cli/src/adapters/llm/README.md` | CLI LLM adapter against an Ollama/OpenAI-compatible HTTP endpoint. |
| `packages/adapters-cli/src/adapters/ipfs/README.md` | CLI IPFS fetches via an HTTP gateway. |
| `packages/adapters-cli/src/adapters/blockchain/README.md` | CLI blockchain reads over JSON-RPC. |
| `packages/adapters-cli/src/adapters/solver-z3/README.md` | Fixture-friendly solver stub behind the CLI `solve` command; no process spawn. |
| `packages/adapters-web/src/adapters/llm/README.md` | Browser LLM adapter (same endpoint contract as the CLI one). |
| `packages/adapters-web/src/adapters/ipfs/README.md` | Browser IPFS fetches via an HTTP gateway. |
| `packages/adapters-web/src/adapters/blockchain/README.md` | Browser blockchain reads over JSON-RPC. |
| `packages/adapters-test/README.md` | Deterministic fixture-backed test doubles for external IO. |
| `packages/adapters-test/src/adapters/llm/README.md` | Deterministic LLM fixtures — no model dependency. |
| `packages/adapters-test/src/adapters/ipfs/README.md` | Deterministic IPFS fixtures — no network. |
| `packages/adapters-test/src/adapters/blockchain/README.md` | Deterministic blockchain fixtures — no network. |

## Fixtures, benchmarks and tooling

| README Path | What belongs here |
|---|---|
| `tests/fixtures/adapters/README.md` | Deterministic payloads for IPFS, blockchain, LLM, and effects routing. |
| `tests/fixtures/artifacts/README.md` | Schema-valid JSON artifact fixtures (`invalid/` holds the negative cases). |
| `tests/llm-suitability/README.md` | Scenarios that measure whether a local model can write useful Vitests for this repo. |
| `tools/remote-ollama-control/README.md` | SSH control of the remote GPU host and the `run-content-gen` benchmark. |
| `tools/benchmark/README.md` | The `ak_create` scenario suite used to compare models and detect baseline drift. |
| `tools/adaptive-workflow-benchmark/README.md` | Scenario driver for `runAdaptiveWorkflow` against a live model endpoint. |
