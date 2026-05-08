# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Claude is the **orchestration and implementation engine**. Codex drives ideation and adversarial verification. GitHub Copilot owns documentation and commits.

## Session-Start Protocol (mandatory before first code change)

Before writing any code in a new session, complete the checklist in `AGENTS.md → Session-Start Checklist`. The short form:

1. Read `~/vault/hot.md` — last-session compounding context
2. Read `~/vault/index.md` — vault catalog (only if `hot.md` is sparse)
3. `git pull --ff-only` — confirm on HEAD
4. `pnpm install --frozen-lockfile` — confirm lockfile match
5. `pnpm run test` — confirm no pre-existing failures
6. Rebuild graphify: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` 
7. Start CodeContextGraph watch: `mcp__CodeGraphContext__watch_directory` on repo root
8. Read `graphify-out/wiki/index.md` for community map
9. Rewrite `local-codex/CodeContext.md` from three MCP queries (`local-codex/` symlinks resolve to `~/vault/sources/codex-snapshots/`)

**This is not optional.** A stale vault context or missing dependencies produces wrong structural answers that compound across milestones.

---

## Multi-Agent Delegation

| Task | Agent | Model / Effort | Mechanism |
|------|-------|---------------|-----------|
| Ideation, plan authoring | **Codex** | gpt-5.4 / high | `/codex:review` via plugin |
| Adversarial plan / code verification | **Codex** | gpt-5.4 / high | `/codex:adversarial-review` via plugin |
| Orchestration — split plans, assign milestones | **Claude Opus** | claude-opus-4-7 / high | Direct |
| Implementation — write and refactor code | **Claude Sonnet** | claude-sonnet-4-6 / high | Direct |
| Author base-level tests (with TODO permutation stubs) | **Claude Sonnet** | claude-sonnet-4-6 / medium | Direct |
| Expand test permutations from TODO stubs | **Ollama** (local model) | local / — | `/ollama-test-permutations` skill |
| Summarize artifacts, classify schemas, extract structured data | **Ollama** (local model) | local / — | `local_summarize`, `local_classify`, `local_extract` via MCP |
| **Content-gen benchmark** — permutation + stress testing of LLM tool-call surface | **Remote Ollama** (GPU node) | qwen3-coder:30b-a3b-q4_K_M / — | `run-content-gen` via `tools/remote-ollama-control/` |
| Author commit messages, open PRs, update architecture / design / README docs | **GitHub Copilot** | — | Native `gh` CLI + Copilot agent |

All agents have live MCP access to CodeContextGraph. Name the query used when handing off or justifying a target area.

### Codex

Use `/codex:*` for ideation, plan authoring (`local-codex/Plan.md` → `~/vault/plans/active/Plan.md`), and adversarial review. Every adversarial review must answer: (1) **Correctness** — does the diff satisfy the milestone spec? (2) **Simplicity** — is it 3× more complex than the simplest solution? If yes, provide a specific rewrite. Codex does not write production code or tests.

### Claude

**Before any milestone code:** state assumptions explicitly, surface ambiguity (stop and ask rather than guess), present tradeoffs if a simpler path exists.

**Implementation order:** (1) failing tests + TODO permutation stubs → (2) production code → (3) hand TODO stubs to Ollama.

**Test-first:** every test file ends with `## TODO: Test Permutations` stubs — the handoff trigger for Ollama.

### Ollama

Reads `## TODO: Test Permutations` stubs and expands them in place via `/ollama-test-permutations`. Read `tests/README.md` first. Do not use for architecture decisions, enforcement reviews, or persona FSM design.

### GitHub Copilot

Authors commit messages, opens PRs, and updates `docs/architecture-charter.md`, `docs/architecture/diagram.mmd`, `docs/README.md`, `packages/adapters-cli/README.md`, and any README changed by the work. Does not write production code or tests.

---

## Code Navigation — CodeContextGraph vs graphify

| Question | Use | Never use |
|---|---|---|
| Where is function X defined? | CodeContextGraph `find_code` | graphify |
| What does module Y import? | CodeContextGraph `analyze_code_relationships` | graphify |
| Which files are riskiest to touch? | CodeContextGraph `find_most_complex_functions` | graphify |
| Find unused code | CodeContextGraph `find_dead_code` | graphify |
| Repo-wide file / function counts | CodeContextGraph `get_repository_stats` | graphify |
| How do concepts cluster? | graphify wiki (`graphify-out/wiki/index.md`) | CodeContextGraph |
| High-level architecture orientation | graphify wiki | CodeContextGraph |

**Read `graphify-out/wiki/index.md` before any CodeContextGraph queries** — one file read vs. multiple MCP round-trips. Once oriented, use CodeContextGraph for all structural lookups.

**Graph before grep:** query CodeContextGraph before any `grep`/`rg`/`find`/`Glob`. Text search is only permitted for literal content (README prose, fixture strings, exact command examples) — not for code discovery. Before using text search, name the MCP query already tried and why it was insufficient.

**Failure policy:** if CodeContextGraph is unavailable or returns insufficient results, stop and report: which query was attempted, what was missing, and what decision is blocked. Do not silently fall back to filesystem search.

**Re-run `/graphify` only for:** post-milestone docs passes, onboarding a new agent, or after a major structural refactor. CodeContextGraph handles incremental updates automatically on every file save.

### CodeContext snapshot for Codex handoffs

Before each Codex handoff, write `local-codex/CodeContext.md` (symlink → `~/vault/sources/codex-snapshots/CodeContext.md`) covering: repo stats, package dependency summary, entry points for the milestone's target files, and top-10 complexity hotspots (`get_repository_stats`, `analyze_code_relationships`, `find_most_complex_functions`). Cite the queries used before opening any implementation file. After a large structural refactor, run `mcp__CodeGraphContext__add_package_to_graph` to force a full re-scan.

---

## Commands

```bash
pnpm install                                                     # Install dependencies
pnpm run build:wasm                                              # Compile AssemblyScript → WASM
pnpm run test                                                    # Run Vitest suite
pnpm run test:vitest -- tests/<path>/<name>.test.js             # Single Vitest file
pnpm run test:playwright -- tests/playwright/<name>.spec.mjs   # Playwright spec
pnpm run test:wasm-check                                         # Confirm WASM binary present
pnpm run serve:ui                                                # UI dev server :8001
pnpm run demo:cli                                                # CLI demo
```

### Benchmark commands

```bash
# Content-gen benchmark — permutation + stress testing of the LLM tool-call surface.
# Runs all 50 scenarios against the remote GPU node via the dual profile (qwen3-coder:30b).
# Tests = correctness; benchmarks = does the model produce valid tool calls under load?

node tools/remote-ollama-control/scripts/remote-ollama-mac.js run-content-gen \
  --profiles dual --runs 3 --route external          # stable 3-run baseline (≈10 min)

node tools/remote-ollama-control/scripts/remote-ollama-mac.js run-content-gen \
  --profiles dual --runs 1 --route external          # quick single-run smoke check

node tools/remote-ollama-control/scripts/remote-ollama-mac.js run-content-gen \
  --profiles dual --scenario-ids 27,29,30 --runs 3   # narrow re-run on specific scenarios

node tools/remote-ollama-control/scripts/remote-ollama-mac.js run-content-gen \
  --profiles dual --dry-run                          # verify scenario loading without hitting the GPU
```

Results land in `tools/remote-ollama-control/results/<timestamp>-content-gen/summary.md`.
Pass threshold: **≥ 99 % exec ok** and **avg score ≥ 75** across all scenarios.

Tests requiring the WASM binary skip gracefully when `build/core-as.wasm` is absent — run `pnpm run build:wasm` first.

---

## Architecture Overview

WASM-first simulation kernel using **Ports & Adapters** with deterministic persona state machines. `pnpm` monorepo (`packages/*`).

### Dependency Direction (non-negotiable)

```
adapters-* / ui-web
      ↓
   runtime          ← personas live here
      ↓
 bindings-ts        ← WASM boundary only
      ↓
  core-as           ← AssemblyScript WASM, pure logic, no IO
```

### Package Roles

| Package | Language | Role |
|---|---|---|
| `core-as` | AssemblyScript | Deterministic simulation: state transitions, validation, effect emission as data |
| `bindings-ts` | TypeScript | Thin WASM wrapper — loads `build/core-as.wasm`, re-exports its surface |
| `runtime` | TypeScript (ESM) | Persona FSMs, tick orchestration, artifact contracts, effect routing |
| `adapters-web` | TypeScript | Browser IO (fetch, IndexedDB) |
| `adapters-cli` | TypeScript | CLI commands (`packages/adapters-cli/src/cli/ak.mjs`) |
| `adapters-test` | TypeScript | Fixture-based deterministic test doubles |
| `ui-web` | HTML/JS | Browser UI; receives a copy of the WASM binary at build time |

### Test Layout

```
tests/
  integration/   # end-to-end (UI↔CLI equivalence, LLM)
  contracts/     # artifact schema validation
  runtime/       # persona replay, orchestration, budget
  fixtures/      # shared test data; invalid/ holds negative cases
```

---

## Design Pattern: Ports & Adapters with Persona State Machines

All code must conform. Dependency direction is the same as above — violations are **blocking**, do not approve.

### core-as (WASM)

- Contains **only** deterministic logic: state transitions, validation, render frame generation, effects as data.
- No IO, no environment access, no clock. Must import nothing outside itself.
- If code introduces IO or an external import into `core-as`, move it to the correct layer before the change lands.

### Runtime Personas

Each persona is a **deterministic state machine**:

```typescript
// controller.mts
constructor(adapters, config)
advance(event, payload): { nextState, effects }

// state-machine.mts
view(): PersonaState
advance(event, payload): { state, context, effects }
```

Clock injected, never read directly. Context serializable (no class instances, no functions). Effects are data — routed via `ports/effects.js`, never executed inline.

| Persona | Tick Phases | Responsibility |
|---|---|---|
| Orchestrator | observe, decide, emit | External interaction and workflow coordination |
| Director | decide | Intent translation: BuildSpec → PlanArtifact → SimConfig |
| Configurator | init, observe | Configuration assembly, validation, and locking |
| Actor | observe, decide | Action proposal generation |
| Allocator | observe, decide | Budget and resource allocation policy |
| Annotator | emit, summarize | Telemetry capture and normalization |
| Moderator | all | Tick control, ordering strategy, effect fulfillment |

New personas require `controller.mts`, `state-machine.mts`, `contracts.ts`, and at least one state handler.

### Adapters

All external IO (LLM, IPFS, blockchain, solver, logging) lives in `adapters-web`, `adapters-cli`, or `adapters-test` only. Adapters receive effects from `runtime/src/ports/effects.js`; they do not pull state. Test adapters must be fixture-based and produce fully deterministic output.

### Artifacts

All boundary-crossing data must use a versioned schema from `packages/runtime/src/contracts/artifacts.ts`:

```typescript
{ schema: "agent-kernel/ArtifactName", schemaVersion: 1, meta: ArtifactMeta }
```

Evolve `schemaVersion` on breaking changes; never remove or rename fields in-place.

---

## Claude's Enforcement Checklist

Run on every diff. Fix failures — don't just flag them.

### Architecture
- [ ] Dependency flows only: adapters/ui → runtime → bindings-ts → core-as
- [ ] `core-as` has no IO and no imports outside itself
- [ ] All external IO is behind an adapter in `adapters-web`, `adapters-cli`, or `adapters-test`
- [ ] No adapter code in `runtime` or `core-as`

### Personas
- [ ] Pure FSM: `view()` + `advance(event, payload)`
- [ ] Clock injected, not read directly
- [ ] Context serializable (no class instances, no functions in state)
- [ ] Effects returned as data, not executed inline
- [ ] New persona folders include `controller.mts`, `state-machine.mts`, `contracts.ts`

### Artifacts
- [ ] All boundary-crossing data uses a schema from `artifacts.ts`
- [ ] `schema`, `schemaVersion`, `meta` present
- [ ] No new field names conflict with existing contracts

### Tests
- [ ] Failing tests written *before* production code
- [ ] New behavior has a test under `tests/`
- [ ] Deterministic behavior uses fixture-based tests
- [ ] Negative cases under `tests/fixtures/artifacts/invalid/`
- [ ] No test reaches live external services
- [ ] Base test file ends with `## TODO: Test Permutations` before Ollama handoff

### Benchmarks
Tests verify correctness of the runtime and CLI. Benchmarks verify that the LLM tool-call surface holds up under permutation and stress — they are a separate concern and a separate harness.

- [ ] If `ak_create` tool schema, CLI arg mapping, or entity normalization changed: run `run-content-gen --runs 3 --route external` before merging
- [ ] Pass bar: **≥ 99 % exec ok**, **avg score ≥ 75**; document any regression in the PR
- [ ] Benchmark results are saved in `tools/remote-ollama-control/results/` — do not commit result directories

### Code Quality
- [ ] Every changed line traces to the current milestone spec — no drive-by cleanup or refactoring
- [ ] Not over-engineered; a senior engineer would not flag it
- [ ] Assumptions stated before implementation began

### File Placement
- [ ] Runtime: `packages/runtime/src/`
- [ ] Core: `packages/core-as/assembly/`
- [ ] Web adapters: `packages/adapters-web/src/adapters/`
- [ ] CLI: `packages/adapters-cli/src/`
- [ ] Tests: `tests/**` — fixtures: `tests/fixtures/**`

### Documentation
- [ ] Architecture boundaries changed → update `docs/architecture-charter.md` + `docs/architecture/diagram.mmd` (Copilot, same PR)
- [ ] CLI flags/behavior changed → update `packages/adapters-cli/README.md` (Copilot, same PR)

---

## Refactoring and Escalation

**Refactor without asking** when the fix is clear: preserve intent, move code to the right layer, extract ports where missing, change only what conformance requires, update tests in the same pass.

**Escalate instead** when:
- The correct layer is genuinely ambiguous given the charter.
- The fix requires updating `docs/architecture-charter.md` or `docs/architecture/diagram.mmd`.
- The refactor touches more than one package boundary with unclear intent.

On escalation: state the violation and charter rule, propose the minimal fix with tradeoffs, wait for confirmation. Do not silently pass ambiguous code.

---

## Key Files for Reference

| File | Purpose |
|---|---|
| `docs/architecture-charter.md` | Architectural law — the primary reference |
| `docs/vision-contract.md` | Non-negotiable product constraints |
| `docs/architecture/diagram.mmd` | Mermaid diagrams for dependency layers and persona FSMs |
| `AGENTS.md` | Working agreement between all agents and the developer |
| `packages/runtime/src/contracts/artifacts.ts` | All versioned artifact schemas |
| `packages/runtime/src/ports/effects.js` | Effect dispatch — the adapter boundary |
| `packages/runtime/src/runner/runtime-fsm.mjs` | Six-phase tick orchestration |
| `packages/core-as/assembly/index.ts` | WASM export surface |
| `docs/readme-index.md` | Index of all README files with one-line summaries |

---

## Vault-Backed Knowledge Management

Non-load-bearing knowledge — plans, design rationale, dictation, scratch notes — lives in the Obsidian vault. Code-binding contracts stay in the repo. See Session-Start Protocol for the canonical orientation order.

### Vault paths
- **Mac:** `~/Documents/Obsidian/agent-kernel-vault/`
- **Linux:** `~/agent-kernel-vault/`
- **Both:** `~/vault` (symlink) — use this in any path you cite

### Repo-vault interaction
- `local-codex/Plan.md`, `Prompt.md`, `Implement.md`, `Documentation.md`, `Dictation.md`, `CodeContext.md` are **symlinks** into the vault — resolve to `~/vault/plans/active/...` and `~/vault/sources/codex-snapshots/...`.
- Design decisions → `~/vault/decisions/` via `/save`.
- Cite vault code links as `[[ccg://<pkg>/<path>]]` or `[[graphify://community/<name>]]`; `wiki-lint` validates on demand.

### What does NOT belong in the vault
Code, tests, fixtures, build outputs, package READMEs, the architecture charter, vision contract, CLI runbook. Rule: "would removing this break a build, test, or agent workflow?"

### Setup / sync
- Initial setup: `bash scripts/setup/setup-km.sh`
- Sync: Syncthing peer-to-peer (Mac ↔ Ubuntu, manual pairing once)
- Per-machine `hot.mac.md` / `hot.linux.md`; merged into `hot.md` by SessionStart hook
