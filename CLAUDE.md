# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

Claude is the **orchestration, implementation, and documentation engine**. Codex drives ideation, adversarial verification, and mechanical implementation from complete milestone specs.

**The persona model is enforced** (charter → "Persona Model — ENFORCED"): all domain logic lives in one of the seven personas; everything else is glue; external code imports persona controllers only. The Allocator alone owns pricing.

**Which file owns what — neither file restates the other.** This one owns: reporting, session start, code navigation, commands, architecture summary, the enforcement checklist, escalation. `AGENTS.md` owns: the agent roster and tiers, the handoff workflow, **the branching and PR policy**, per-agent scope, test and benchmark strategy, file placement, naming, the pre-handoff checklist. Change a rule in its owning file only; a rule copied into both will drift and one copy will be wrong.

> **Model names, not versions.** Both files name model *tiers* (Opus, Sonnet, Haiku, GPT-5), never dated IDs — those churn and go stale while still looking authoritative. Use the latest release in each tier; pick the exact ID with `/model` or the API.

---

## Reporting to the Maintainer — SUMMARIZE

The maintainer reads chat for **two things only**: *is this going the right way*, and *is there a decision for me*. Internal mechanics belong in the durable record, not in chat.

**Hard cap: at most 5 bullets, each ≤50 words.** No preamble, no restating the request, no closing summary. Omit any heading with nothing to say — 5 is a ceiling, not a target, and 2 is a good answer. If it will not fit, the overflow belongs in the commit message or the plan, not in a longer reply.

- **Verdict** — one line: what landed, and whether it **converged or diverged** from the plan.
- **Gates** — one line, only when code changed: suite · typecheck · guards · allowlist. Numbers, not commentary.
- **Decide** — only when genuinely blocked or a default would be wrong. Question + recommendation + *what happens if unanswered*.
- **Watch** — only when confidence in the current direction changed: a premise failed, a milestone turned out blocked, scope grew.

**Never in chat:** file-by-file mechanics · what a guard or test does · how a refactor was threaded · perturbation narratives · restating the commit message · tables of internals · reasoning already captured elsewhere.

**The detail is relocated, not deleted — that is what licenses the brevity:** *why/what changed* → commit message · *next, blocked, decided* → `~/vault/plans/active/Plan.md` · *architecture rationale* → `~/vault/decisions/`. **Never trade rigor for brevity: do the same work, report less of it.**

**Surface immediately, do not batch:** a failed premise, a milestone discovered to be blocked, scope that grew, or anything that changes what the maintainer would ask for next. Those are direction signals, not progress updates.

**Depth on request:** "why" / "show me" / "expand" → full reasoning, no summarizing. Assume the short form otherwise. **Long or autonomous runs:** report at milestone boundaries, not per step.

---

## Session-Start Protocol (mandatory before the first code change)

Not optional — a stale vault or an unpatched tool produces wrong structural answers that compound. Steps 5–8 cost seconds.

**Steps 2–6 are one idempotent command** — run it once per session, not per message:

```bash
bash scripts/setup/session-refresh.sh
```

It fetches and `git pull --ff-only` only when the branch tracks a remote *and* the tree is clean (never touches uncommitted work, never switches branches), runs `pnpm install --frozen-lockfile`, re-applies the Serena ignored-dirs patch, points `core.hooksPath` at `.githooks` so direct commits to `main` are refused, refreshes `local-codex/CodeContext.md`, and runs `pnpm run test`. Then report its `source` / `tools` / `tests` summary; a non-zero exit means deps or tests need attention **before** anything else. Skip parts only when asked: `--no-pull`, `--no-tools`, `--no-tests`. Same script on cloud agents, where `.cursor/install.sh` has already provisioned the VM at boot.

1. Read `~/vault/plans/active/Plan.md` — the START HERE block is the last-session handoff; `~/vault/index.md` only if it is sparse
2. `git pull --ff-only` — confirm on HEAD *(script)*
3. `pnpm install --frozen-lockfile` — confirm lockfile match *(script)*
4. `pnpm run test` — confirm no pre-existing failures *(script)*
5. `bash scripts/setup/agent-context.sh` — refresh the `local-codex/CodeContext.md` snapshot *(script)*
6. `python3 scripts/setup/patch-serena-ignored-dirs.py --check` — exits 1 if Serena's hardcoded `build`/`dist` blind spot is back; re-apply after any `uv tool upgrade serena-agent` *(script)*
7. Confirm the Serena MCP responds (any `mcp__serena__*` tool). Answers are live from the language server — nothing to index, watch, or canary-check
8. Read `local-codex/CodeContext.md`

---

## Delegating work

The full roster (models, effort levels, tools, scope limits) is in `AGENTS.md → Agent roster`. The routes Claude invokes directly:

| Need | Route |
|---|---|
| Scoping a change / writing a milestone — *before* code | `/agentic-change-planning` (routes to the owning skill) |
| Implementing persona domain logic | `/persona-<orchestrator\|director\|configurator\|allocator\|actor\|moderator\|annotator>` |
| Layering, effects, artifact schemas, adapter IO | `/architecture-<dependency-direction\|effects-routing\|artifacts-contracts\|adapter-io>` |
| Ideation, plan authoring | `/codex:review` |
| Adversarial verification of a plan or diff | `/codex:adversarial-review`, or the `codex-reviewer` subagent |
| Mechanical implementation from a complete milestone spec | `/codex:rescue` |
| Full suite run + triage + fix | `/tiered-test-optimizer` (`fast-pass` → `fix-pass` subagents) |
| Expand `## TODO: Test Permutations` stubs | `/local-test-gen` (Ollama, local or remote GPU) |
| Author or scaffold a test to an existing recipe | `/structured-test-authoring` + the `ak_test_*` MCP tools |
| Summarize / classify / extract structured data | `local_*` MCP tools (Ollama) |

**Routing to a scoped skill is mandatory, not a suggestion.** Before planning or editing agent-kernel domain/architecture code, load the owning skill and stay inside it — do not default to a full-app sweep. `/agentic-change-planning` holds the routing table; the plan it produces must name the exact owner id, copy that skill's allowed edit surfaces, and cite its narrow validation command. Each owner skill then supplies *Allowed edit surfaces · Forbidden · Workflow · Validation · Escalate*, and its Validation block — the persona's own tests plus its specific `tests/architecture/*-authority.test.js` guards — is the gate to run before commit, in place of the full suite. Ambiguous ownership, or a change spanning two owners without a thin artifact handoff, is an **escalation**, not a wider plan.

The skills live in `.claude/skills/`; their roster and mirroring rules are `AGENTS.md → Repo-owned skills`. Cursor gets this same requirement from `.cursor/rules/agentic-skill-routing.mdc` (`alwaysApply: true`) — this paragraph is what keeps the two harnesses at parity, so it is not optional here just because nothing enforces it mechanically.

**Before any milestone code:** state assumptions, surface ambiguity (stop and ask rather than guess), present the tradeoff if a simpler path exists. Implementation order is (1) failing tests + `## TODO: Test Permutations` stubs → (2) production code → (3) hand the stubs to Ollama.

**The `agent-kernel-cli` MCP server** (`pnpm run mcp:serve`, tools `ak_*`) is the preferred surface for authoring, simulation, inspection, LLM planning, and adapter operations — use it instead of shelling out to `ak.mjs` when it is connected.

**Ollama is strategic, not legacy.** It is the no-cost path for decomposable subtasks; the remote dual-GPU box runs heavy batch work. Subagents cannot run on Ollama models, so that tier stays skill/MCP-mediated by design.

---

## Code Navigation — Serena (structural) · grep (literal)

| Question | Use |
|---|---|
| Where is symbol X defined? | Serena `find_symbol` |
| Who calls / imports X? (port → adapter, blast radius) | Serena `find_referencing_symbols` |
| What's in this file? | Serena `get_symbols_overview` |
| What implements this interface / where is it declared? | Serena `find_implementations` / `find_declaration` |
| Literal text: prose, fixture strings, exact commands or messages | `grep`/`rg` — no justification needed |
| High-level orientation / how concepts cluster | The persona READMEs and `docs/architecture-charter.md` — there is no code-graph tool here |

- **Serena answers live from the language server.** There is no index to rebuild, watch, or sanity-check.
- ⚠️ **Re-run `python3 scripts/setup/patch-serena-ignored-dirs.py` after every `uv tool upgrade serena-agent`.** `build`/`dist` are hardcoded as ignored directories in Serena's TypeScript adapter, *before* config or `.gitignore` is consulted — no config key reaches them, and an upgrade silently restores the blind spot. This was the repo's fifth ignore-list trap: when adopting any tool, check not just *what* its ignore list holds but *whether config can reach it at all*.
- ⚠️ **`tsconfig.json` must keep `allowJs: true` and `include: packages/*/src/**/*`.** Without them the `.js`/`.mjs` majority of the repo is outside the TypeScript program and `find_referencing_symbols` returns `{}` for it while definitions still resolve — a silent, one-sided failure. `tsconfig.json` is consumed only by editors and language servers; the typecheck gate uses `tsconfig.typecheck.json`.
- ⚠️ **An empty result is not proof of absence.** Pass `relative_path` to `find_symbol` — without it, it degrades silently and returns wrong rows instead of erroring. `find_referencing_symbols` errors loudly.
- **Failure policy:** if Serena is unavailable, say so and read the files — never guess structure from filenames.

### Codex handoffs

`bash scripts/setup/agent-context.sh` writes `local-codex/CodeContext.md` — branch, commit, and the Serena query cheatsheet — and mirrors it into the per-worktree vault cache. Codex reads the snapshot, then verifies structural claims with its own tooling; Claude cites Serena queries when justifying a target area.

> **There is no code-graph tool in this repo.** Graphify was removed 2026-09-06: nothing consumed it, `graphify-out/wiki/` was never generated, and its report's own "community structure" was 673 unnamed communities of which 367 listed zero nodes. Structural questions go to Serena; conceptual orientation to the charter and the persona READMEs. Do not reintroduce a graph without a named consumer.

---

## Commands

```bash
pnpm install                                          # Install dependencies
pnpm run test                                         # Vitest suite
pnpm run test -- --reporter=json --outputFile=<f>     # Structured results (what fast-pass uses)
pnpm run test:vitest -- tests/<path>/<name>.test.js   # Single Vitest file
pnpm run test:coverage:core-ts                        # core-ts coverage report
pnpm run typecheck                                    # Typecheck gate (core-ts + its tests, strict)
pnpm run typecheck:report                             # Cost of widening the gate, per package
pnpm run typecheck:report -- --check-js               # ...including .js: the all-TypeScript size
pnpm run mcp:serve                                    # agent-kernel-cli MCP server (ak_* tools)
pnpm run serve:ui                                     # UI dev server :8001
pnpm run demo:cli                                     # CLI demo
```

**There is no CI test job.** `.github/workflows/` holds only the `@claude` responder and an advisory PR review. The gates above are local and are the only ones that run — see `AGENTS.md → Review`.

**Benchmarks never substitute for tests.** If a benchmark run surfaced it and a deterministic test could have, the fix is the test — a recorded failing `toolArgs` replays with no LLM. **Full-scale remote runs stay outside development** (maintainer, 2026-08-13): never start one from a session, never gate a diff on one. **Local `--local` subset runs are in the loop** (maintainer, 2026-08-25) for debugging code deltas, never as a gate, and `scripts/benchmark-preflight.sh` first. Canonical content-gen scenario count: 100 (source: `loadScenarioCatalog()`). Read results rather than producing them — fetch `benchmark-results` and use `benchmark-result-reader.js` (`latest_attempt` for current health, `latest_success` for the last qualifying baseline; identity mismatch is an error). Full rule in `AGENTS.md → Benchmark strategy`.

---

## Architecture

Pure-TypeScript simulation kernel using **Ports & Adapters** with deterministic persona state machines. `pnpm` monorepo (`packages/*`). No WASM build step — the core runs directly under Node.

**Dependency direction (non-negotiable):** `adapters-* / ui-web` → `runtime` (personas) → `core-ts` (pure logic, no IO). Violations are **blocking** — do not approve.

| Package | Role |
|---|---|
| `core-ts` | Deterministic simulation: state transitions, validation, effect emission as data. No IO, no clock, no imports outside itself. |
| `runtime` | Persona FSMs, tick orchestration, artifact contracts, effect routing (ESM). |
| `adapters-web` | Browser IO (fetch, IndexedDB). |
| `adapters-cli` | CLI commands (`packages/adapters-cli/src/cli/ak.mjs`) and the MCP server. |
| `adapters-test` | Fixture-based deterministic test doubles. |
| `ui-web` | Browser UI; imports the synchronous TypeScript core via runtime adapters. |

Tests live under `tests/` — `personas/` (persona behavior), `runtime/`, `core-ts/`, `contracts/` (artifact schemas), `architecture/` (the boundary guards), `integration/` (UI↔CLI equivalence, LLM), `adapters-*`, `ui-web/`, `fixtures/` (shared data; `invalid/` holds negative cases).

## Design Pattern: Ports & Adapters with Persona State Machines

**core-ts** — only deterministic logic (state transitions, validation, render-frame generation, effects as data). No IO, no env access, no clock, no external imports. Any IO or import introduced here moves to the correct layer before the change lands.

**Runtime personas** — each is a deterministic state machine. Clock injected (never read directly). Context serializable (no class instances, no functions). Effects returned as data and routed via `ports/effects.js`, never executed inline.

```typescript
// controller.js
constructor(adapters, config)
advance(event, payload): { nextState, effects }
// state-machine.js
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

New personas require `controller.js`, `state-machine.js`, `persona.js`, `contracts.ts`, a `README.md`, and at least one state handler.

**Adapters** — all external IO (LLM, IPFS, blockchain, solver, logging) lives only in `adapters-web/-cli/-test`. Adapters receive effects from `runtime/src/ports/effects.js`; they do not pull state. Test adapters are fixture-based and fully deterministic.

**Artifacts** — all boundary-crossing data uses a versioned schema from `packages/runtime/src/contracts/artifacts.ts`: `{ schema: "agent-kernel/ArtifactName", schemaVersion: 1, meta: ArtifactMeta }`. Evolve `schemaVersion` on breaking changes; never remove or rename fields in place.

---

## Enforcement Checklist

Run on every diff. **Fix failures — don't just flag them.** The guards in `tests/architecture/` enforce most of this mechanically; the checklist is what you check before they do.

**Architecture** — dependency flows only adapters/ui → runtime → core-ts · `core-ts` has no IO and no outside imports · all external IO behind an adapter · no adapter code in `runtime`/`core-ts`.

**Personas** — pure FSM (`view()` + `advance`) · clock injected · context serializable · effects returned as data · new persona folders complete (see above) · no imports of persona internals from outside the persona directory (controllers only) · no domain logic in glue (kernel, card-authoring, orchestrate-build, adapters) · persona states must gate real behavior — label-only states are defects · all pricing goes through the Allocator (base costs in `base-costs.json`, formulas in Allocator code, no silent fallbacks).

**Artifacts** — boundary data uses an `artifacts.ts` schema · `schema`/`schemaVersion`/`meta` present · no field-name conflicts with existing contracts.

**Types** — `pnpm run typecheck` stays at zero (gate: `tsconfig.typecheck.json`, enforced by `tests/architecture/typecheck-gate.test.js`). The gate covers **core-ts and its tests only** — the code genuinely clean under `strict`. Do not widen it casually: the five `_shared/*.mts` modules carry **180 errors** that leak into every scope importing them, so widening is a fix-first project, not a config change. ⚠️ `checkJs` is **off**, so an all-`.js` package reports 0 because there is nothing to check — read the file count the report prints alongside.

**Tests** — failing tests written *before* production code · new behavior covered under `tests/` · anything a benchmark surfaced that a deterministic test could catch is landed as that test, not left to the next run · deterministic behavior uses fixtures · negative cases under `tests/fixtures/artifacts/invalid/` · no test hits live external services · base test file ends with `## TODO: Test Permutations` before Ollama handoff · persona behavior tests live in `tests/personas/<persona>/` named `<persona>-<behavior>.test.*` · label-only persona tests are legacy: replace with a behavior test, then remove — never before.

**Branching** — the change is on a feature branch, never on `main`; it lands through a PR; the branch is deleted locally and on origin when the PR merges. No exception for a one-line fix. `.githooks/` refuses direct commits and pushes mechanically. Full rule and the cleanup command: `AGENTS.md → Branching`.

**Code quality** — every changed line traces to the current milestone spec (no drive-by cleanup) · not over-engineered · assumptions stated before implementation · **clean-up found but not required by the task gets logged as a `gh issue`** — not fixed inline, and not left as a code comment or a plan-doc aside.

**Documentation, same diff** — architecture boundaries changed → `docs/architecture-charter.md` + `docs/architecture/diagram.mmd` (Opus/high, maintainer sign-off) · CLI flags or behavior changed → `packages/adapters-cli/README.md` (Sonnet/medium) · a module's canonical file moved or a persona surface changed → that persona's or package's `README.md` (Sonnet/medium). A doc that now contradicts the code is a **blocking** defect: fix it in the diff that made it wrong. `tests/architecture/persona-readme-authority.test.js` enforces part of this.

**Not a checklist item:** benchmarks. If a change touches the `ak_create` tool schema, CLI arg mapping, or entity normalization, note that in the commit message so a result can be attributed — that is the whole development obligation. Read compact source-pinned evidence from `benchmark-results`; raw results stay out of Git.

---

## Refactoring and Escalation

**Refactor without asking** when the fix is clear: preserve intent, move code to the right layer, extract missing ports, change only what conformance requires, update tests in the same pass.

**Escalate** when the correct layer is genuinely ambiguous, the fix needs `docs/architecture-charter.md` or `docs/architecture/diagram.mmd` changes, or the refactor crosses more than one package boundary with unclear intent. On escalation: state the violation and the charter rule, propose the minimal fix with tradeoffs, wait for confirmation. Do not silently pass ambiguous code.

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
| `tests/architecture/` | Executable form of the enforcement checklist |
| `tests/README.md` | Test-authoring playbook (read before delegating test work) |
| `docs/readme-index.md` | Index of all READMEs with one-line summaries |

---

## Vault-Backed Knowledge Management

Non-load-bearing knowledge (plans, design rationale, dictation, scratch notes) lives in the Obsidian vault; code-binding contracts stay in the repo. Test: "would removing this break a build, test, or agent workflow?" — if no, it belongs in the vault.

- **Paths:** Mac `~/Documents/Obsidian/agent-kernel-vault/` · Linux `~/agent-kernel-vault/` · cite via the `~/vault` symlink. Setup: `bash scripts/setup/setup-km.sh`.
- `local-codex/{Plan,Prompt,Implement,Documentation,Dictation,CodeContext}.md` are symlinks into `~/vault/plans/active/...` and `~/vault/sources/codex-snapshots/...`.
- Design decisions → `~/vault/decisions/` via `/save`. Cite vault code links as `[[ccg://<pkg>/<path>]]`.
- ⚠️ **The vault is machine-local and has no backup of any kind.** Syncthing was removed 2026-08-21 and nothing replaced it: `~/vault` on the Mac and on Ubuntu are now independent directories, so **anything a second machine needs must be in git**. Copy a vault file out before a long edit and verify the result with `file` after writing — replication zeroed `Plan.md` to NUL bytes once, and there is no longer a second copy to recover from. A real backup is a bare repo outside the vault; not yet built.
- ⚠️ **Do not put `.git` in the vault and do not reintroduce the retired session hooks.** The vault's own git repo was destroyed by file-by-file replication (refs and objects arrive interleaved, so `refs/heads/master` was zeroed and 23,167 objects orphaned). The `hot.md` cache and the three `km-*` hooks were removed 2026-08-18 because each was real machinery with no observable output; retired copies are in `~/vault/.retired/`.
- ⚠️ **Outstanding on the Ubuntu box:** all three `km-*` hooks are still registered there and keep recreating `hot.md`/`log.md` in the shared vault. Fix: delete `~/.claude/hooks/km-*.sh` and `jq 'del(.hooks.SessionStart) | del(.hooks.PostToolUse) | del(.hooks.Stop)'` over its `settings.json`.
