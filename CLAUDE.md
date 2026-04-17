# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Claude is the **orchestration and implementation engine**. Codex drives ideation and adversarial verification. GitHub Copilot owns documentation and commits.

## Multi-Agent Delegation

| Task | Agent | Model / Effort | Mechanism |
|------|-------|---------------|-----------|
| Ideation, plan authoring | **Codex** | gpt-5.4 / high | `/codex:review` via plugin |
| Adversarial plan / code verification | **Codex** | gpt-5.4 / high | `/codex:adversarial-review` via plugin |
| Orchestration — split plans, assign milestones to agents | **Claude Opus** | claude-opus-4-7 / high | Direct — Claude's primary orchestration role |
| Implementation — write and refactor code | **Claude Sonnet** | claude-sonnet-4-6 / high | Direct — Claude's primary coding role |
| Author base-level tests (with TODO permutation stubs) | **Claude Sonnet** | claude-sonnet-4-6 / medium | Direct |
| Expand test permutations from TODO stubs | **Ollama** (local model) | local / — | `/ollama-test-permutations` skill, launched via Claude Code harness |
| Summarize artifacts, classify schemas, extract structured data | **Ollama** (local model) | local / — | `local_summarize`, `local_classify`, `local_extract` via MCP |
| Author commit messages, open PRs, update architecture / design / README docs | **GitHub Copilot** | — | Native `gh` CLI + Copilot agent |

**Code navigation (all agents):** Claude, Ollama, and Codex all have live MCP access to CodeContextGraph. Query the graph before opening files or running text searches.

### Codex — ideation, planning, adversarial verification

Use the Codex plugin (`/codex:*`) for:
- **Ideation**: exploring solution approaches before a plan is written.
- **Plan authoring**: producing `local-codex/Plan.md` from a prompt or spec.
- **Adversarial review**: stress-testing a design decision or a completed diff from a different model family to reduce sycophancy bias.

Every adversarial review must explicitly answer two questions:
1. **Correctness** — does the diff do what the milestone spec requires?
2. **Simplicity** — is this implementation 3× more complex than the simplest solution that meets the spec? If yes, flag it with a specific rewrite suggestion.

Codex does **not** write production code or tests in this workflow — that is Claude's responsibility.

### Claude — orchestration and implementation

**Orchestration (Opus / high):** When a plan arrives, Claude Opus splits it into bounded milestones, assigns each milestone to the correct agent, and tracks handoff state. Orchestration decisions include: milestone sizing, dependency ordering, and which agent handles each task.

**Coding (Sonnet / high):** Claude Sonnet implements all production code — new features, bug fixes, and architecture-conformance refactors. Claude refactors any code that violates the Ports & Adapters pattern without waiting for permission.

Before writing any code for a milestone, Claude must:
1. **State assumptions explicitly** — list what it is assuming about scope, interfaces, and expected behaviour.
2. **Surface ambiguity** — if anything is unclear, stop and ask rather than guessing. Name what is confusing.
3. **Present tradeoffs** — if a simpler approach exists, say so before implementing the complex one.

**Test-first authoring (Sonnet / medium → high):** Claude writes failing tests *before* production code. Tests are the success criteria; code is written to make them pass. Every test file must end with a `## TODO: Test Permutations` section with plain-language stubs for edge cases. These stubs are the handoff signal to Ollama.

The implementation order for every milestone is:
1. State assumptions (pause if unclear)
2. Write failing tests + TODO permutation stubs
3. Write production code to make tests pass
4. Hand TODO stubs to Ollama for expansion

### Ollama — test permutation expansion

Ollama (local model, launched via Claude Code harness) reads the `## TODO: Test Permutations` stubs and generates the concrete test cases in place. Trigger via the `/ollama-test-permutations` skill. Do **not** use Ollama for architecture decisions, enforcement reviews, or persona FSM design.

---

## Code Navigation — CodeContextGraph vs graphify

Two graph tools exist in this repo. They answer different questions. Using the wrong one wastes tokens.

### Decision table

| Question | Use | Never use |
|---|---|---|
| Where is function X defined? | CodeContextGraph `find_code` | graphify |
| What does module Y import? | CodeContextGraph `analyze_code_relationships` | graphify |
| Which files are riskiest to touch? | CodeContextGraph `find_most_complex_functions` | graphify |
| Find unused code | CodeContextGraph `find_dead_code` | graphify |
| Repo-wide file / function counts | CodeContextGraph `get_repository_stats` | graphify |
| How do concepts cluster in this codebase? | graphify wiki (`graphify-out/wiki/index.md`) | CodeContextGraph |
| High-level architecture orientation (session start) | graphify wiki | CodeContextGraph |
| What is this repo actually *about*? | graphify wiki | CodeContextGraph |

### Session-start rule

**At the start of every session, read `graphify-out/wiki/index.md` before issuing any CodeContextGraph queries.** The wiki is a pre-built semantic map; reading it costs one file read. Querying CodeContextGraph for the same orientation costs multiple MCP round-trips. Once oriented, switch to CodeContextGraph for all structural lookups.

### Do not re-run `/graphify` during an active coding session

CodeContextGraph handles incremental updates automatically on every file save. Re-running `/graphify` mid-session is expensive and redundant. Reserve `/graphify` for:
- Post-milestone documentation passes
- Onboarding a new agent to a large unfamiliar body of content
- After a major structural refactor when the semantic map is stale

### Mandatory rule: graph before grep

**Claude and Ollama must query CodeContextGraph before using any filesystem search** (`grep`, `rg`, `find`, `Glob`). Text search is a fallback for content not captured in the graph, not the default.

| Need | Use instead of grep/find |
|------|--------------------------|
| Find where a function is defined | `mcp__CodeGraphContext__find_code` |
| Understand what a module imports / is imported by | `mcp__CodeGraphContext__analyze_code_relationships` |
| Find the most complex / risky files | `mcp__CodeGraphContext__find_most_complex_functions` |
| Count files, functions, modules | `mcp__CodeGraphContext__get_repository_stats` |
| Arbitrary structural query | `mcp__CodeGraphContext__execute_cypher_query` |
| Find unused code | `mcp__CodeGraphContext__find_dead_code` |

### CodeContext snapshot for Codex handoffs

Codex has direct MCP access to CodeContextGraph via its own MCP config (`codex mcp list` confirms `codegraphcontext` is enabled). Codex can and should query the graph directly during tasks using the same tools Claude uses.

However, Claude should still generate `local-codex/CodeContext.md` before each Codex handoff as a **startup orientation document** — it saves Codex from spending its first turns querying for the overall picture, and gives it a pre-computed starting point. The snapshot must cover:

1. Repository stats (files, functions, modules)
2. Package dependency summary — which packages import which
3. Entry points relevant to the milestone's target files
4. Any dead code or high-complexity hotspots in the affected area

Generate the snapshot with:
```
mcp__CodeGraphContext__get_repository_stats        → overall counts
mcp__CodeGraphContext__analyze_code_relationships  → per-package dependencies
mcp__CodeGraphContext__find_most_complex_functions → top 10 complexity hotspots
```

Write the result to `local-codex/CodeContext.md`. Codex reads this file at startup for orientation, then queries the live graph for detail as needed during the task.

### Keeping the graph current

The watch handles incremental updates automatically. After any large structural refactor (new package, deleted module, renamed file), run:
```
mcp__CodeGraphContext__add_package_to_graph  → re-index a whole package
```
to force a full re-scan of the affected area.

### GitHub Copilot — documentation and commits only

Copilot's sole responsibilities are:
- Authoring commit messages.
- Opening and describing pull requests.
- Updating system documentation: `docs/architecture-charter.md`, `docs/architecture/diagram.mmd`, `docs/README.md`, `packages/adapters-cli/README.md`, and any other README or design doc that changes as a result of the work.

Copilot does **not** write production code or tests.

---

## Commands

```bash
# Install dependencies
pnpm install

# Compile AssemblyScript → WASM (required before tests that use WASM)
pnpm run build:wasm

# Run all tests (Node built-in test runner, no Jest/Vitest)
pnpm run test

# Run a single test file
node --test tests/<path>/<name>.test.js

# Check WASM binary is present
pnpm run test:wasm-check

# Start UI dev server (http://localhost:8001/packages/ui-web/index.html)
pnpm run serve:ui

# Run CLI demo
pnpm run demo:cli
```

**WASM note:** Tests that require the WASM binary skip gracefully when `build/core-as.wasm` is absent. Run `pnpm run build:wasm` first to enable them.

---

## Architecture Overview

This is a WASM-first simulation kernel using **Ports & Adapters** with deterministic persona state machines. It is a `pnpm` monorepo (`packages/*`).

### Package Dependency Direction (non-negotiable)

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

## Claude's Role

Claude is the **active orchestrator and implementation engine** on this project.

**As orchestrator (Opus / high):** Claude reads the plan, sizes milestones, and assigns work to the correct agent. It does not start coding until the plan is decomposed and each milestone is bounded.

**As implementer (Sonnet / high):** Claude writes all production code. When code violates the architecture or design pattern, Claude refactors it — restructuring as needed to bring it into conformance while preserving the original intent. Claude does not wait for a human to approve a fix; it makes the fix directly.

Specifically, Claude:

- Reads and understands what the code is trying to do.
- Identifies any violations of the Ports & Adapters pattern or the persona FSM contract.
- Rewrites the offending code to conform — moving, splitting, or restructuring files and functions as required.
- Preserves the semantic meaning of the code throughout. Logic is kept; structure is corrected.
- Does not add features, extra abstractions, or unrelated improvements beyond what conformance requires.

**As test author (Sonnet / medium):** After each coding milestone Claude writes the base test file and appends a `## TODO: Test Permutations` section with plain-language stubs for edge cases. This section is the handoff trigger for Ollama.

---

## Design Pattern: Ports & Adapters with Persona State Machines

All code must conform to this pattern. Claude enforces it on every diff.

### Dependency Direction (non-negotiable)

```
adapters-* / ui-web
      ↓
   runtime          ← personas live here
      ↓
 bindings-ts        ← WASM boundary only
      ↓
  core-as           ← WASM, pure logic, no IO
```

Violations of this direction are **blocking** — do not approve.

### core-as (WASM)

- Contains **only** deterministic simulation logic: state transitions, validation, render frame generation, and effect emission as data.
- Must import nothing outside itself. No IO, no environment access, no clock.
- Effects are emitted as deterministic data (kind + requestId + fulfillment hints). They are not IO.
- If generated code introduces IO or an external import into `core-as`, Claude moves or rewrites it into the correct layer before the change lands.

### Runtime Personas

Each persona is a **deterministic state machine** with this contract:

```typescript
// controller.mts
constructor(adapters, config)
advance(event, payload): { nextState, effects }

// state-machine.mts
view(): PersonaState
advance(event, payload): { state, context, effects }
```

- Clock must be injected, not read directly.
- Context must be serializable.
- Effects are data — routing happens via `ports/effects.js`, not inside the persona.
- A persona must not reach outside its defined port interface.

**Defined personas and their phases:**

| Persona | Tick Phases | Responsibility |
|---|---|---|
| Orchestrator | observe, decide, emit | External interaction and workflow coordination |
| Director | decide | Intent translation: BuildSpec → PlanArtifact → SimConfig |
| Configurator | init, observe | Configuration assembly, validation, and locking |
| Actor | observe, decide | Action proposal generation |
| Allocator | observe, decide | Budget and resource allocation policy |
| Annotator | emit, summarize | Telemetry capture and normalization |
| Moderator | all | Tick control, ordering strategy, effect fulfillment |

New personas require a `controller.mts`, `state-machine.mts`, `contracts.ts`, and at minimum one state handler.

### Adapters

- All external IO (LLM, IPFS, blockchain, solver, logging) lives in adapter packages only.
- Adapters receive effects dispatched from `runtime/src/ports/effects.js`; they do not pull state.
- Adapter packages: `adapters-web`, `adapters-cli`, `adapters-test`.
- Test adapters must be fixture-based and produce fully deterministic output.

### Artifacts

All data crossing a boundary must use a versioned artifact schema from `packages/runtime/src/contracts/artifacts.ts`:

```typescript
{
  schema: "agent-kernel/ArtifactName",
  schemaVersion: 1,
  meta: ArtifactMeta   // id, runId, createdAt, producedBy, correlationId
}
```

- Evolve `schemaVersion` on breaking changes; never remove or rename fields in-place.

---

## Claude's Enforcement Checklist

Run this on every diff. For each failed item, Claude fixes the code — not just flags it.

### Architecture

- [ ] Dependency direction flows only: adapters/ui → runtime → bindings-ts → core-as
- [ ] `core-as` has no IO and no imports outside itself
- [ ] All external IO is behind an adapter in `adapters-web`, `adapters-cli`, or `adapters-test`
- [ ] No adapter code has leaked into `runtime` or `core-as`

### Personas

- [ ] Each persona is a pure FSM: `view()` + `advance(event, payload)`
- [ ] Clock is injected, not read directly
- [ ] Context is serializable (no class instances, no functions in state)
- [ ] Effects are returned as data, not executed inline
- [ ] New persona folders include `controller.mts`, `state-machine.mts`, `contracts.ts`

### Artifacts

- [ ] All boundary-crossing data uses a schema from `artifacts.ts`
- [ ] `schema`, `schemaVersion`, and `meta` fields are present
- [ ] No new field names conflict with existing artifact contracts

### Tests

- [ ] Failing tests written *before* production code for this milestone
- [ ] New behavior has a corresponding test under `tests/`
- [ ] Deterministic behavior uses fixture-based tests
- [ ] Negative cases have fixtures under `tests/fixtures/artifacts/invalid/`
- [ ] No test reaches live external services (use `adapters-test` fixtures)
- [ ] Base test file ends with a `## TODO: Test Permutations` section before Ollama handoff

### Code Quality

- [ ] Every changed line traces to the current milestone spec — no adjacent cleanup, reformatting, or drive-by refactoring
- [ ] Implementation is no more complex than the milestone requires; a senior engineer would not flag it as over-engineered
- [ ] Assumptions stated explicitly before implementation began; nothing was silently assumed

### File Placement

- [ ] Runtime code is in `packages/runtime/src/`
- [ ] Core logic is in `packages/core-as/assembly/`
- [ ] Web adapters are in `packages/adapters-web/src/adapters/`
- [ ] CLI adapters and commands are in `packages/adapters-cli/src/`
- [ ] Tests are in `tests/**`
- [ ] Fixtures are in `tests/fixtures/**`

### Documentation

- [ ] If architecture boundaries changed: `docs/architecture-charter.md` and `docs/architecture/diagram.mmd` are updated — by Copilot in the same PR
- [ ] If public CLI flags or behavior changed: `packages/adapters-cli/README.md` is updated — by Copilot in the same PR

---

## When Claude Refactors Code

Claude refactors any code that fails the enforcement checklist. The guiding principles are:

- **Preserve intent**: the refactored code must do what the original code intended.
- **Correct structure**: move code to the right layer, split files as required, extract ports where missing.
- **Minimum footprint**: change only what conformance requires. Do not clean up unrelated code, add comments to unchanged lines, or introduce new abstractions beyond what the architecture demands.
- **Tests follow**: if a structural change affects test coverage, update or add tests in the same pass.

Claude does not ask for permission before refactoring a clear violation. If the correct fix is ambiguous, see Escalation below.

---

## Escalation

Claude escalates (rather than refactoring unilaterally) when:

- The correct layer for a piece of logic is genuinely ambiguous given the charter.
- Fixing the violation would require updating `docs/architecture-charter.md` or `docs/architecture/diagram.mmd`.
- The refactor would touch more than one package boundary and the intended behaviour is unclear.

In those cases Claude:

1. States the specific violation and the relevant charter rule.
2. Proposes the minimal corrective change and explains the trade-off.
3. Waits for human confirmation before making the change.

Claude does not silently pass ambiguous code.

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
| `docs/readme-index.md` | Index of all README files with one-line summaries of what code belongs in each package/directory |
