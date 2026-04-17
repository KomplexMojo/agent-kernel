README Files Summary

1) packages/adapters-cli/src/adapters/blockchain/README.md
Folder: packages/adapters-cli/src/adapters/blockchain
Description:
This README documents the CLI blockchain adapter: a minimal JSON-RPC client used by CLI tooling to query chain state, balances, and to mint/load cards. It explains usage, configuration (rpcUrl and fetchFn), and helper functions such as getBalance, getChainId, mintCard, and loadMintedCard.

It emphasizes that this adapter is intended for Orchestrator/Allocator tooling and is never used inside core-as, highlighting boundaries between IO adapters and the deterministic core.

2) packages/adapters-cli/src/adapters/solver-z3/README.md
Folder: packages/adapters-cli/src/adapters/solver-z3
Description:
This README describes a stub solver adapter (Z3-style) for the CLI `solve` command. It explains fixture-driven and stub behavior: returning parsed fixtures when provided or a simple stub SolverResult otherwise, with no external process spawning.

The document stresses determinism: no network or external process usage, enabling offline, repeatable solver results for tests and demos.

3) packages/adapters-cli/src/adapters/ipfs/README.md
Folder: packages/adapters-cli/src/adapters/ipfs
Description:
This file covers the CLI IPFS adapter, which fetches artifacts via an HTTP gateway for Node workflows. It explains building gateway URLs, fetching text/JSON, and configuration options like gatewayUrl and fetchFn.

Usage examples show creating the adapter and fetching JSON by CID; the README reiterates that the adapter is for CLI/orchestration and not to be used inside core-as.

4) packages/adapters-cli/src/adapters/llm/README.md
Folder: packages/adapters-cli/src/adapters/llm
Description:
This README documents the CLI LLM adapter (Ollama/OpenAI-style) used by Orchestrator/Director tooling. It explains calling an Ollama-style /api/generate endpoint, returning raw JSON, and configuration (baseUrl, fetchFn).

It includes usage examples and clarifies that the adapter performs IO for higher-level personas and is not part of core-as, maintaining architectural separation.

5) packages/adapters-cli/src/mcp/README.md
Folder: packages/adapters-cli/src/mcp
Description:
This README describes the MCP integration pieces inside the CLI package (mcp-related adapters and utilities). It outlines purpose and basic usage for the MCP components used by CLI automation and tooling.

It places the MCP pieces in the context of CLI-driven automation and notes how they fit into the larger adapter/runner landscape of the repo.

6) packages/adapters-cli/README.md
Folder: packages/adapters-cli
Description:
The package README explains the purpose of CLI adapters: Node-based drivers for automation, build, and AI workflows. It provides usage patterns and examples for using adapters in CLI scripts and tools.

It clarifies that the package hosts Node-specific adapter implementations (IPFS, blockchain, LLM, solver) and reiterates boundaries: adapters perform IO while core-as remains pure and deterministic.

7) packages/adapters-web/src/adapters/blockchain/README.md
Folder: packages/adapters-web/src/adapters/blockchain
Description:
This README documents the web blockchain adapter: a minimal JSON-RPC client for browsers that exposes helpers like getBalance and getChainId. It explains configuration (rpcUrl, fetchFn) and usage examples for Orchestrator/Allocator workflows.

The doc reiterates that this adapter provides browser-side access to blockchain data and is not to be used inside the deterministic core-as module.

8) packages/adapters-web/src/adapters/ipfs/README.md
Folder: packages/adapters-web/src/adapters/ipfs
Description:
This file covers the web IPFS adapter used by browser workflows. It explains building gateway URLs for CIDs, fetching JSON/text via fetch, configuration (gatewayUrl, fetchFn), and provides usage examples.

It emphasizes that this adapter serves runtime personas like the Orchestrator and must not be used by core-as, preserving the ports & adapters contract.

9) packages/adapters-web/src/adapters/llm/README.md
Folder: packages/adapters-web/src/adapters/llm
Description:
This README documents the web LLM adapter (Ollama-style) used in browser-based orchestration, showing how to call /api/generate and return raw JSON responses. It includes config and usage examples.

It clarifies the adapter’s role: perform IO for Director/Orchestrator personas while keeping core-as IO-free and deterministic.

10) README.md (root)
Folder: /
Description:
The repository root README provides a high-level overview of agent-kernel: a WASM-first simulation kernel built on the Ports & Adapters pattern. It explains principles (determinism, persona-driven runtime), quick-start commands, repository layout, and relationships among core-as, bindings-ts, runtime, adapters, and UI.

The document includes toolchain and test instructions, persona summaries, adapter descriptions, and guidelines for running tests and the UI. It serves as the top-level entry for contributors and users.

11) packages/adapters-test/README.md
Folder: packages/adapters-test
Description:
This README describes deterministic test adapters that return fixture-backed responses for IPFS, blockchain, and LLM APIs. It explains purpose, differences from the tests/ folder, usage patterns, and adapter configuration (fixtures, balances, responses).

It shows how tests can register fixtures and use the adapters to avoid network calls, ensuring deterministic, replayable test runs.

12) docs/README.md
Folder: docs
Description:
The documentation index README explains the core design documents: vision contract, architecture charter, persona FSM rules, and implementation plans. It outlines the runtime execution model, actor-centric model, budgeting flows, and the builder workflow/schema catalog.

It also includes quickstarts, implementation plans, and direction for shared commands and LLM/runtime pipelines — serving as the canonical documentation entry point.

13) packages/core-as/assembly/ports/README.md
Folder: packages/core-as/assembly/ports
Description:
This short README defines the effect/port shapes used by core-as to request IO as data. It explains that ports are expressed as data and interpreted by runtime/adapters, keeping AssemblyScript isolated from direct JS calls.

It clarifies usage: core-as emits effects defined here and runtime/adapters fulfill them externally, preserving determinism.

14) packages/core-as/assembly/README.md
Folder: packages/core-as/assembly
Description:
The core-as assembly README is a long, detailed document describing the deterministic WebAssembly simulation core: responsibilities, scope, invariants, and what belongs/doesn't belong in the core. It covers world state, actions, rules, determinism, replay, ports/effects, and architectural relationships.

It emphasizes strict boundaries (no IO, no external imports), build instructions, and the intent to keep core-as small, auditable, and mathematically tractable.

15) packages/adapters-test/src/adapters/blockchain/README.md
Folder: packages/adapters-test/src/adapters/blockchain
Description:
This README documents the blockchain test adapter: deterministic fixtures for balances and RPC responses. It shows usage, configuration, and how to set fixed balances or RPC replies in tests to keep budget checks and policies deterministic.

It highlights the adapter’s role in test isolation and reproducibility without network access.

16) packages/runtime/src/personas/orchestrator/README.md
Folder: packages/runtime/src/personas/orchestrator
Description:
The Orchestrator persona README defines its role as the integration boundary between the simulation and external systems. It covers responsibilities like intake normalization, service selection, IO execution (performed by the Orchestrator but captured for replay), and deferred side-effect coordination.

It stresses that the Orchestrator does not mutate simulation state during execution and is a boundary guardian preserving determinism while enabling external integrations.

17) packages/adapters-test/src/adapters/ipfs/README.md
Folder: packages/adapters-test/src/adapters/ipfs
Description:
This README explains the IPFS test adapter that returns fixture text/JSON for given CIDs and optional paths, and allows runtime registration of fixtures. It provides usage examples and configuration details for tests.

It highlights how to use the adapter to maintain deterministic, replayable tests without network calls.

18) packages/runtime/src/personas/actor/README.md
Folder: packages/runtime/src/personas/actor
Description:
The Actor persona README describes actors as decision-making entities that propose actions based on observations. It details actor types (static, dynamic, player-controlled), motivations, decision loops, and interfaces with the simulation runner.

It clarifies that the Actor decides intent only and submits proposed actions as data; legality and outcomes are resolved by core-as, ensuring determinism and replay.

19) packages/runtime/src/personas/allocator/README.md
Folder: packages/runtime/src/personas/allocator
Description:
This README describes the Allocator persona responsible for budgeting and resource policy. It explains cost models, request evaluation, budget receipts, and deterministic decisioning with examples and scenarios illustrating token costs and reconciliations.

It emphasizes separation of concerns: Allocator decides affordability and issues receipts, while core-as enforces costs and state changes.

20) tests/fixtures/adapters/README.md
Folder: tests/fixtures/adapters
Description:
This fixtures README lists deterministic payload files used by adapter tests to stub network responses (IPFS, blockchain, LLM) and describes their purpose: avoid network calls and enable deterministic tests. It enumerates the main fixture files and their intended uses.

It instructs test authors to use these fixtures when testing CLI or web adapters to ensure reproducible behavior.

21) packages/adapters-test/src/adapters/llm/README.md
Folder: packages/adapters-test/src/adapters/llm
Description:
This README documents the LLM test adapter (Ollama-style) returning fixed responses for model/prompt pairs and allowing runtime registration of responses. It covers usage patterns for deterministic strategy generation in tests.

It clarifies configuration options and the adapter's role in keeping LLM-driven flows replayable.

22) packages/runtime/src/personas/annotator/README.md
Folder: packages/runtime/src/personas/annotator
Description:
The Annotator persona README explains telemetry collection, aggregation, and emission responsibilities. It details what signals are captured (events, actions, budget violations, tick frames) and how summaries are produced for UI and observability stacks.

It stresses that Annotator records facts without impacting simulation behavior and that telemetry formats are deterministic and versioned for replay.

23) packages/runtime/src/personas/configurator/README.md
Folder: packages/runtime/src/personas/configurator
Description:
This README covers the Configurator persona, which translates plans into concrete simulation configurations, performs validation, and emits configuration artifacts. It explains assembly, consistency checks, optional solver-backed validation, and relationship to downstream Allocator and core-as.

It emphasizes that the Configurator prepares execution-ready artifacts but does not perform runtime enforcement or mutate simulation state.

24) packages/runtime/src/personas/director/README.md
Folder: packages/runtime/src/personas/director
Description:
The Director persona README describes planning and intent translation: turning goals into structured plans and prompt plans (for LLM usage). It clarifies responsibilities, prompt plan authoring, scope boundaries, and the Director’s non-IO role (Orchestrator performs IO).

It positions the Director as a planner that hands artifacts to Configurator and other personas, not as an executor or configurator itself.

25) packages/runtime/src/personas/moderator/README.md
Folder: packages/runtime/src/personas/moderator
Description:
This README defines the Moderator persona as the execution and sequencing authority: the timekeeper that advances ticks, orders action proposals, submits ordered actions to core-as, and routes events/effects. It explains tick phases, deterministic ordering, and effect handling (defer IO-bound effects).

It reiterates that Moderator controls ‘when’ and ‘in what order’ actions apply while core-as determines legality and outcomes.

26) tests/fixtures/artifacts/README.md
Folder: tests/fixtures/artifacts
Description:
This fixtures README catalogs artifact JSON fixtures used by tests: sim-configs, initial states, action sequences, tick frames, budget artifacts, and many canonical examples. It documents rules for fixture stability and lists important fixture filenames and their purposes.

It is a guide for test authors to select and use stable artifact fixtures for deterministic tests and replay scenarios.
