# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

Claude is the **orchestration, implementation, and documentation engine**. Codex drives ideation, adversarial verification, and mechanical implementation from complete milestone specs.

**The persona model is enforced** (charter → "Persona Model — ENFORCED"): all domain logic lives in one of the seven personas; everything else is glue; external code imports persona controllers only. The Allocator alone owns pricing.

> **Model names, not versions.** This file names model *tiers* (Opus, Sonnet, Haiku, GPT-5) rather than dated IDs, which churn. Use the latest release in each tier; pick the exact ID with `/model` or the API.

## Session-Start Protocol (mandatory before first code change)

Run the full checklist in `AGENTS.md → Session-Start Checklist`. Short form — **not optional**; a stale vault or missing deps produce wrong structural answers that compound:

1. Read `~/vault/hot.md` (last-session context); `~/vault/index.md` only if `hot.md` is sparse
2. `git pull --ff-only` — confirm on HEAD
3. `pnpm install --frozen-lockfile` — confirm lockfile match
4. `pnpm run test` — confirm no pre-existing failures
5. `bash scripts/setup/agent-context.sh` — refresh branch-local Graphify + `local-codex/CodeContext.md`
6. Confirm the Serena MCP is connected (any `mcp__serena__*` tool responds). Serena answers structural queries live from the language server — there is no index to build, watch, or sanity-check
7. Read `local-codex/CodeContext.md`, then the Graphify report it names

---

## Multi-Agent Delegation

| Task | Agent / Tier | Mechanism |
|------|-------|-----------|
| Ideation, plan authoring | **Codex** (GPT-5, high) | `/codex:review` |
| Adversarial plan / code verification | **Codex** (GPT-5, high) | `/codex:adversarial-review` |
| Mechanical implementation from a complete milestone spec | **Codex** (GPT-5, high) | `/codex:rescue` |
| Orchestration — split plans, assign milestones | **Claude Opus** (high) | Direct |
| Implementation — write / refactor code | **Claude Sonnet** (high) | Direct |
| Author base tests (with TODO permutation stubs) | **Claude Sonnet** (medium) | Direct |
| Test-suite failure detection (structured JSON, no log dumps) | **Claude Haiku** (`fast-pass` subagent) | `/tiered-test-optimizer` |
| Test-failure diagnosis + fix | **Claude Opus** (`fix-pass` subagent) | `/tiered-test-optimizer` |
| Adversarial-review relay (review-only, no Edit/Write) | **Claude Sonnet** (`codex-reviewer` subagent) | wraps `/codex:adversarial-review` |
| Expand test permutations from TODO stubs | **Ollama** (local) | `/local-test-gen` |
| Summarize / classify / extract structured data | **Ollama** (local) | `local_*` via MCP |
| Content-gen benchmark — permutation + stress of the tool-call surface | **Remote Ollama** (dual GPU) | `run-content-gen` |
| Descriptive docs — package / persona READMEs, `docs/README.md`, `docs/readme-index.md`, CLI README | **Claude Sonnet** (medium) | Direct |
| Normative docs — `docs/architecture-charter.md`, `docs/vision-contract.md`, `docs/architecture/diagram.mmd` | **Claude Opus** (high) | Direct |
| Commit messages, PRs | **Claude Sonnet** (medium) | Direct + `gh` CLI |

Structural code questions go through the **Serena MCP** (live language-server answers). The **Ollama tier is strategic, not legacy**: local Ollama (via `local_*` MCP tools and `/local-test-gen`) is the no-cost path for decomposable subtasks; the remote dual-GPU box runs the content-gen benchmark and heavy batch work. Subagents cannot run on Ollama models, so the low-cost tier stays skill/MCP-mediated by design.

- **Codex** — ideation, plan authoring (`local-codex/Plan.md` → `~/vault/plans/active/Plan.md`), adversarial review, and **mechanical implementation** (since 2026-07-18): call-site threading behind an already-designed controller API, guard/lint sweeps, bulk test migration, characterization tests to an explicit spec. Requires a complete milestone spec (target files, exact API, validation commands, stop condition); Claude verifies output against the validation commands. Codex does NOT design persona APIs, change artifact schemas, or decide pricing policy. Every adversarial review answers: (1) **Correctness** — does the diff satisfy the milestone spec? (2) **Simplicity** — is it 3× more complex than the simplest solution? If so, give a specific rewrite.
- **Claude** — before any milestone code: state assumptions, surface ambiguity (stop and ask rather than guess), present tradeoffs if a simpler path exists. Implementation order: (1) failing tests + `## TODO: Test Permutations` stubs → (2) production code → (3) hand stubs to Ollama.
- **Ollama** — expands `## TODO: Test Permutations` stubs in place via `/local-test-gen` (auto-detects the warm model; `--model` to override; remote GPU via `remote-ollama-mac run-local`). Read `tests/README.md` first. Not for architecture, enforcement review, or persona FSM design.
- **Subagents** (`.claude/agents/`) — `fast-pass` (Haiku, detection-only, structured Vitest JSON), `fix-pass` (Opus, diagnosis + minimal fixes, queries Serena on architectural categories, escalates boundary changes), `codex-reviewer` (Sonnet, review-only wrapper around the Codex adversarial flow). Roster details in `AGENTS.md`.
- **Documentation (Claude, since 2026-07-27 — replaces GitHub Copilot).** Docs are written by the agent that made the change, in the **same diff** as the code: it already holds the context, and a stale doc is a live hazard, not a cosmetic debt (7 persona READMEs asserted `.mts` was the canonical source long after `.js` became it — anyone following them would have edited a re-export shim and their change would silently never run). Two tiers by stakes:
  - **Descriptive docs → Sonnet (medium).** Package/persona READMEs, `docs/README.md`, `docs/readme-index.md`, `packages/adapters-cli/README.md`. The content follows from a diff that already exists; the work is accuracy and concision, not design — the same tier as authoring base tests. Whoever changes behavior updates these in the same diff.
  - **Normative docs → Opus (high).** `docs/architecture-charter.md`, `docs/vision-contract.md`, `docs/architecture/diagram.mmd`. These are architectural **law**: every future agent obeys them, they encode decisions rather than describe code, and an error propagates silently across every later milestone. Same tier as orchestration. Charter/vision edits still require maintainer sign-off (see Refactoring and Escalation).
  - **Commit messages and PRs → Sonnet (medium).** Commit or push only when the maintainer asks.

---

## Code Navigation — Serena (structural) vs graphify (conceptual) vs grep (literal)

Serena replaced CodeGraphContext on 2026-07-28. It wraps the live language server — answers are computed on demand from current file state, so the *index* staleness class (dead watches, a rebuild that silently drops a directory, sanity canaries) no longer exists.

⚠️ **Scope blindness does still exist, and it bit on day one.** Serena runs with `ignore_all_files_in_gitignore: true` (`.serena/project.yml`), so anything `.gitignore` excludes is invisible to it — and it does not honor re-inclusion negations the way git does. `.gitignore`'s bare `build/` rule (retired WASM output) therefore hid all of `packages/runtime/src/build/` and `tests/runtime/build/`, so `find_symbol("orchestrateBuild")` returned 18 test-local import consts and **never the definition**. Same blind spot PT.1 found in CodeGraphContext's `IGNORE_DIRS`, different tool. Fixed by deleting the rule. Two things to carry forward: `find_referencing_symbols` errors loudly on an ignored path but **`find_symbol` does not** — it just returns the wrong rows; and Serena reads the ignore scope **at project activation**, so a `.gitignore` change needs an MCP server restart before it takes effect.

| Question | Use |
|---|---|
| Where is symbol X defined? | Serena `find_symbol` |
| Who calls / imports X? (port → adapter, blast radius) | Serena `find_referencing_symbols` |
| What's in this file? | Serena `get_symbols_overview` |
| What implements this interface / where is it declared? | Serena `find_implementations` / `find_declaration` |
| How do concepts cluster? / High-level orientation | graphify wiki (`graphify-out/wiki/index.md`) |
| Literal text: prose, fixture strings, exact commands/messages | `grep`/`rg` — no justification needed |

- **Scope:** Serena is for relational/structural queries only. grep is legitimate for literal content and needs no prior MCP query — the old "name the query you tried first" rule is retired.
- **Failure policy:** if Serena is unavailable, say so and fall back to reading files — don't guess structure from filenames.
- **Re-run `/graphify` only for:** post-milestone docs passes, onboarding a new agent, or a major structural refactor.

**Codex handoffs:** run `bash scripts/setup/agent-context.sh` to write `local-codex/CodeContext.md` and mirror Graphify. Codex reads the snapshot, then verifies structural claims against its own tooling; Claude cites Serena queries when justifying a target area.

---

## Commands

```bash
pnpm install                                          # Install dependencies
pnpm run test                                         # Vitest suite
pnpm run test -- --reporter=json --outputFile=<f>     # Structured results (what fast-pass uses)
pnpm run test:vitest -- tests/<path>/<name>.test.js   # Single Vitest file
pnpm run test:playwright -- tests/playwright/<name>.spec.mjs
pnpm run serve:ui                                     # UI dev server :8001
pnpm run demo:cli                                     # CLI demo
```

**Content-gen benchmark** — permutation + stress testing of the LLM tool-call surface (separate from correctness tests). Runs 50 scenarios against the remote GPU node via the dual profile.

```bash
node tools/remote-ollama-control/scripts/remote-ollama-mac.js run-content-gen --profiles dual --runs 3 --route external   # 3-run baseline (≈10 min)
#                                                                            --runs 1 --route external   # quick smoke
#                                                                            --scenario-ids 27,29,30 --runs 3   # narrow re-run
#                                                                            --dry-run                   # verify loading, no GPU
```

Results: `tools/remote-ollama-control/results/<timestamp>-content-gen/summary.md`. Pass bar: **≥ 99 % exec ok** and **avg score ≥ 75**. Do not commit result directories.

---

## Architecture

Pure-TypeScript simulation kernel using **Ports & Adapters** with deterministic persona state machines. `pnpm` monorepo (`packages/*`). There is no WASM build step — the core runs directly under Node.

**Dependency direction (non-negotiable):** `adapters-* / ui-web` → `runtime` (personas) → `core-ts` (pure logic, no IO). Violations are **blocking** — do not approve.

| Package | Role |
|---|---|
| `core-ts` | Deterministic simulation: state transitions, validation, effect emission as data. No IO, no clock, no imports outside itself. |
| `runtime` | Persona FSMs, tick orchestration, artifact contracts, effect routing (ESM). |
| `adapters-web` | Browser IO (fetch, IndexedDB). |
| `adapters-cli` | CLI commands (`packages/adapters-cli/src/cli/ak.mjs`). |
| `adapters-test` | Fixture-based deterministic test doubles. |
| `ui-web` | Browser UI; imports the synchronous TypeScript core via runtime adapters. |

```
tests/
  integration/   # end-to-end (UI↔CLI equivalence, LLM)
  contracts/     # artifact schema validation
  runtime/       # persona replay, orchestration, budget
  fixtures/      # shared test data; invalid/ holds negative cases
```

---

## Design Pattern: Ports & Adapters with Persona State Machines

**core-ts** — only deterministic logic (state transitions, validation, render-frame generation, effects as data). No IO, no env access, no clock, no external imports. Any IO/import introduced here must move to the correct layer before the change lands.

**Runtime personas** — each is a deterministic state machine. Clock injected (never read directly). Context serializable (no class instances, no functions). Effects returned as data and routed via `ports/effects.js`, never executed inline.

```typescript
// controller.mts
constructor(adapters, config)
advance(event, payload): { nextState, effects }
// state-machine.mts
view(): PersonaState
advance(event, payload): { state, context, effects }
```

| Persona | Tick Phases | Responsibility |
|---|---|---|
| Orchestrator | observe, decide, emit | External interaction and workflow coordination |
| Director | decide | Intent translation: BuildSpec → PlanArtifact → SimConfig |
| Configurator | init, observe | Configuration assembly, validation, locking |
| Actor | observe, decide | Action proposal generation |
| Allocator | observe, decide | Budget and resource allocation policy |
| Annotator | emit, summarize | Telemetry capture and normalization |
| Moderator | all | Tick control, ordering strategy, effect fulfillment |

New personas require `controller.mts`, `state-machine.mts`, `contracts.ts`, and at least one state handler.

**Adapters** — all external IO (LLM, IPFS, blockchain, solver, logging) lives only in `adapters-web/-cli/-test`. Adapters receive effects from `runtime/src/ports/effects.js`; they do not pull state. Test adapters are fixture-based and fully deterministic.

**Artifacts** — all boundary-crossing data uses a versioned schema from `packages/runtime/src/contracts/artifacts.ts`: `{ schema: "agent-kernel/ArtifactName", schemaVersion: 1, meta: ArtifactMeta }`. Evolve `schemaVersion` on breaking changes; never remove or rename fields in-place.

---

## Enforcement Checklist

Run on every diff. **Fix failures — don't just flag them.**

**Architecture** — dependency flows only adapters/ui → runtime → core-ts · `core-ts` has no IO and no outside imports · all external IO behind an adapter · no adapter code in `runtime`/`core-ts`.

**Personas** — pure FSM (`view()` + `advance`) · clock injected · context serializable · effects returned as data · new persona folders include `controller.mts`, `state-machine.mts`, `contracts.ts` · no imports of persona internals from outside the persona directory (controllers only) · no domain logic in glue (kernel, card-authoring, orchestrate-build, adapters) · persona states must gate real behavior — label-only states are defects · all pricing goes through the Allocator (base costs in `base-costs.json`, formulas in Allocator code, no silent fallbacks).

**Artifacts** — boundary data uses an `artifacts.ts` schema · `schema`/`schemaVersion`/`meta` present · no field-name conflicts with existing contracts.

**Tests** — failing tests written *before* production code · new behavior covered under `tests/` · deterministic behavior uses fixtures · negative cases under `tests/fixtures/artifacts/invalid/` · no test hits live external services · base test file ends with `## TODO: Test Permutations` before Ollama handoff · persona behavior tests live in `tests/personas/<persona>/` named `<persona>-<behavior>.test.*` · label-only persona tests are legacy: replace with behavior tests, then remove (never remove first).

**Benchmarks** — if `ak_create` tool schema, CLI arg mapping, or entity normalization changed, run `run-content-gen --runs 3 --route external` before merging · pass bar ≥ 99 % exec ok, avg score ≥ 75 (document any regression in the PR) · results stay out of git.

**Code quality** — every changed line traces to the current milestone spec (no drive-by cleanup) · not over-engineered · assumptions stated before implementation.

**File placement** — runtime `packages/runtime/src/` · core `packages/core-ts/src/` · web adapters `packages/adapters-web/src/adapters/` · CLI `packages/adapters-cli/src/` · tests `tests/**` (fixtures `tests/fixtures/**`).

**Documentation (Claude, same diff)** — architecture boundaries changed → `docs/architecture-charter.md` + `docs/architecture/diagram.mmd` (Opus, high) · CLI flags/behavior changed → `packages/adapters-cli/README.md` (Sonnet, medium) · a module's canonical file/entry point moved or a persona surface changed → that persona's / package's `README.md` (Sonnet, medium). A README that now contradicts the code is a **blocking** defect, not a follow-up: fix it in the diff that made it wrong.

---

## Refactoring and Escalation

**Refactor without asking** when the fix is clear: preserve intent, move code to the right layer, extract missing ports, change only what conformance requires, update tests in the same pass.

**Escalate** when the correct layer is genuinely ambiguous, the fix needs `docs/architecture-charter.md` or `docs/architecture/diagram.mmd` changes, or the refactor crosses more than one package boundary with unclear intent. On escalation: state the violation and charter rule, propose the minimal fix with tradeoffs, wait for confirmation. Do not silently pass ambiguous code.

---

## Key Files

| File | Purpose |
|---|---|
| `docs/architecture-charter.md` | Architectural law — the primary reference |
| `docs/vision-contract.md` | Non-negotiable product constraints |
| `docs/architecture/diagram.mmd` | Dependency-layer and persona-FSM diagrams |
| `AGENTS.md` | Working agreement between all agents and the developer |
| `packages/runtime/src/contracts/artifacts.ts` | All versioned artifact schemas |
| `packages/runtime/src/ports/effects.js` | Effect dispatch — the adapter boundary |
| `packages/runtime/src/runner/runtime-fsm.mjs` | Six-phase tick orchestration |
| `packages/core-ts/src/index.ts` | Core export surface |
| `docs/readme-index.md` | Index of all READMEs with one-line summaries |

---

## Vault-Backed Knowledge Management

Non-load-bearing knowledge (plans, design rationale, dictation, scratch notes) lives in the Obsidian vault; code-binding contracts stay in the repo. Rule: "would removing this break a build, test, or agent workflow?" — if no, it belongs in the vault. Code, tests, fixtures, build outputs, package READMEs, the architecture charter, vision contract, and CLI runbook stay in the repo.

- **Paths:** Mac `~/Documents/Obsidian/agent-kernel-vault/` · Linux `~/agent-kernel-vault/` · cite via the `~/vault` symlink.
- `local-codex/{Plan,Prompt,Implement,Documentation,Dictation,CodeContext}.md` are symlinks into `~/vault/plans/active/...` and `~/vault/sources/codex-snapshots/...`.
- Design decisions → `~/vault/decisions/` via `/save`. Cite vault code links as `[[ccg://<pkg>/<path>]]` or `[[graphify://community/<name>]]` (`wiki-lint` validates on demand).
- Setup `bash scripts/setup/setup-km.sh` · sync via Syncthing (Mac ↔ Ubuntu) · per-machine `hot.mac.md`/`hot.linux.md` merged into `hot.md` by the SessionStart hook.
