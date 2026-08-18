# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

Claude is the **orchestration, implementation, and documentation engine**. Codex drives ideation, adversarial verification, and mechanical implementation from complete milestone specs.

**The persona model is enforced** (charter → "Persona Model — ENFORCED"): all domain logic lives in one of the seven personas; everything else is glue; external code imports persona controllers only. The Allocator alone owns pricing.

> **Model names, not versions.** This file names model *tiers* (Opus, Sonnet, Haiku, GPT-5) rather than dated IDs, which churn. Use the latest release in each tier; pick the exact ID with `/model` or the API.

---

## Reporting to the Maintainer — SUMMARIZE

The maintainer reads chat for **two things only**: *is this going the right way*, and *is there a decision for me*. Internal mechanics are not wanted in chat — they belong in the durable record.

**Hard cap: at most 5 bullets, each ≤50 words.** No preamble, no restating the request, no closing summary. Omit any heading with nothing to say — 5 is a ceiling, not a target, and 2 is a good answer. If it will not fit, the overflow belongs in the commit message or the plan, not in a longer reply.

- **Verdict** — one line: what landed, and whether it **converged or diverged** from the plan.
- **Gates** — one line, only when code changed: suite · typecheck · guards · allowlist. Numbers, not commentary.
- **Decide** — only when genuinely blocked or a default would be wrong. Question + recommendation + *what happens if unanswered*.
- **Watch** — only when confidence in the current direction changed: a premise failed, a milestone turned out blocked, scope grew.

**Never in chat:** file-by-file mechanics · what a guard or test does · how a refactor was threaded · perturbation narratives · restating the commit message · tables of internals · reasoning already captured elsewhere.

**The detail is relocated, not deleted — this is what licenses the brevity:** *why/what changed* → commit message · *next, blocked, decided* → `~/vault/plans/active/Plan.md` · *architecture rationale* → `~/vault/decisions/`. **Never trade rigor for brevity: do the same work, report less of it.** A shorter report must not mean a shallower check.

**Surface immediately, do not batch:** a failed premise, a milestone discovered to be blocked, scope that grew, or anything that changes what the maintainer would ask for next. Those are direction signals, not progress updates — mid-task is the right time.

**Depth on request:** "why" / "show me" / "expand" → full reasoning, no summarizing. Assume the short form otherwise.

**Long or autonomous runs:** report at milestone boundaries, not per step.

## Session-Start Protocol (mandatory before first code change)

Run the full checklist in `AGENTS.md → Session-Start Checklist`. Short form — **not optional**; a stale vault or missing deps produce wrong structural answers that compound:

1. Read `~/vault/hot.md` (last-session context); `~/vault/index.md` only if `hot.md` is sparse
2. `git pull --ff-only` — confirm on HEAD
3. `pnpm install --frozen-lockfile` — confirm lockfile match
4. `pnpm run test` — confirm no pre-existing failures
5. `bash scripts/setup/agent-context.sh` — refresh branch-local Graphify + `local-codex/CodeContext.md`
6. `python3 scripts/setup/patch-serena-ignored-dirs.py --check` — Serena's `build/` blind spot; re-apply after any `uv tool upgrade serena-agent`
7. Confirm the Serena MCP is connected (any `mcp__serena__*` tool responds). Serena answers structural queries live from the language server — there is no index to build, watch, or sanity-check
8. Read `local-codex/CodeContext.md`, then the Graphify report it names

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
| ~~Content-gen benchmark~~ — **not delegable work; it left the development loop 2026-08-13.** Runs nightly as a standalone offline tool. | — | — |
| Descriptive docs — package / persona READMEs, `docs/README.md`, `docs/readme-index.md`, CLI README | **Claude Sonnet** (medium) | Direct |
| Normative docs — `docs/architecture-charter.md`, `docs/vision-contract.md`, `docs/architecture/diagram.mmd` | **Claude Opus** (high) | Direct |
| Commit messages, PRs | **Claude Sonnet** (medium) | Direct + `gh` CLI |

Structural code questions go through the **Serena MCP** (live language-server answers). The **Ollama tier is strategic, not legacy**: local Ollama (via `local_*` MCP tools and `/local-test-gen`) is the no-cost path for decomposable subtasks; the remote dual-GPU box runs heavy batch work. Subagents cannot run on Ollama models, so the low-cost tier stays skill/MCP-mediated by design. **The content-gen benchmark is no longer part of this tiering** — it is a standalone nightly tool outside the development loop.

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

✅ **SERENA'S `build/` BLIND SPOT IS FIXED (2026-08-01) — but the fix lives outside the repo and an upgrade silently undoes it.**

`build` is **hardcoded** in Serena's TypeScript adapter — `solidlsp/language_servers/typescript_language_server.py:199-204` blocks `["node_modules", "dist", "build"]`, and `solidlsp/ls.py:1197-1204` tests **every directory component** of a requested path against that list, returning "ignored" **before** `.gitignore`, `ignored_paths`, or any config is read. There is no config key that reaches it (`ignored_paths` is a different layer; `ls_specific_settings` goes to the language server).

**The fix:** `scripts/setup/patch-serena-ignored-dirs.py` removes `dist` and `build` from that hardcoded list (keeping `node_modules`, whose cost is real). Safe because the list is redundant with `.gitignore` for genuine build output and Serena still applies `.gitignore` afterwards — so the decision defers to the project's own declaration.

- ⚠️ **RE-RUN IT AFTER EVERY `uv tool upgrade serena-agent`** — an upgrade replaces the file and restores the blind spot with no error. `--check` exits 1 when the patch is missing and is step 6 of the session-start checklist.
- **Never "owe a restart" for this class of problem** — a 26-second-old process failed identically. The verdict came from code, not config.
- The earlier `.gitignore` `build/` rule was a *real, separate* bug and was correctly fixed by deleting it; it simply was not the whole story.
- Carry forward: **`find_symbol` errors loudly only when you pass `relative_path`** — otherwise it degrades silently and returns wrong rows (18 test-local consts and never the definition). `find_referencing_symbols` errors loudly.

This is the **fifth** occurrence of the repo's `build`-directory trap (CGC `IGNORE_DIRS` · `.gitignore` hiding tests from CI · dead `.cgcignore` · Serena-via-`.gitignore` · Serena-hardcoded) and the first not fixable by configuration. When adopting any new tool, check not just *what* its ignore list contains but *whether that list is reachable from config at all*.

✅ **THE BIGGER PROBLEM WAS `tsconfig.json`, AND IT IS FIXED (2026-07-31).** Separately from the `build` blind spot, `find_referencing_symbols` used to return `{}` for **every `.js`/`.mjs` symbol in the repo** — 211 of 268 production files, i.e. essentially all canonical source. Cause: `tsconfig.json` had **no `allowJs`** (defaults `false`), so `.js` files were never in the TypeScript program, and `include` covered only `personas/`, `core-ts/`, `contracts/`, `tests/`, `docs/` — leaving `runner/`, `build/`, `commands/`, `ports/`, `adaptive-workflow/`, `render/` and every adapter package outside it. Definitions still resolved (document symbols are syntactic, per-file); **references did not** (semantic, program-wide). That asymmetry is the whole tell.

Fixed by adding `"allowJs": true`, `"checkJs": false` and broadening `include` to `packages/*/src/**/*`. Suite unchanged (348 files / 2691 passed). There is no `tsc`/typecheck script, so `tsconfig.json` is consumed only by editors and language servers — this is a tooling-only change.

⚠️ **THE "`export *` BARRELS ARE NOT TRACED" NOTE IS RETRACTED.** That was a *symptom* of the same `allowJs` gap, not a separate limitation. With `allowJs` on, `find_referencing_symbols("createModeratorPersona", ".../moderator/controller.js")` correctly returns the callers that import through `personas/moderator/persona.js`. Do **not** work around a barrel; the tool handles it.

| Question | Use |
|---|---|
| Where is symbol X defined? | Serena `find_symbol` |
| Who calls / imports X? (port → adapter, blast radius) | Serena `find_referencing_symbols` |
| What's in this file? | Serena `get_symbols_overview` |
| What implements this interface / where is it declared? | Serena `find_implementations` / `find_declaration` |
| How do concepts cluster? / High-level orientation | `graphify-out/GRAPH_REPORT.md` (**not** a wiki — see below) |
| Literal text: prose, fixture strings, exact commands/messages | `grep`/`rg` — no justification needed |

- **Scope:** Serena is for relational/structural queries only. grep is legitimate for literal content and needs no prior MCP query — the old "name the query you tried first" rule is retired.
- **Failure policy:** if Serena is unavailable, say so and fall back to reading files — don't guess structure from filenames.
- **Re-run `/graphify` only for:** post-milestone docs passes, onboarding a new agent, or a major structural refactor.

### graphify — keeping the graph and the picture current

The knowledge graph lives in `graphify-out/`. These rules moved here from
`/Users/darren/CLAUDE.md` on 2026-08-17: they are **project** instructions, and sitting in a
home-directory file meant they were machine-local — invisible to a fresh clone, to CI, and to anyone
but this machine. Only genuinely machine-level facts (which Python has graphify) stay there.

**Rebuild after changing code, and redraw the picture with it:**

```bash
graphify update . && python3 scripts/setup/regenerate-graph-viz.py
```

- `graphify update .` re-extracts every code file and rewrites `graph.json` + `GRAPH_REPORT.md`.
  No LLM, no network.
- ⚠️ **A rebuild does NOT redraw `graph.html`.** `to_html` is called only from the full `/graphify`
  skill flow, and `graph.html` is gitignored — so it drifts with nothing to surface the gap. It was
  **three months stale** when this was written. That is why the regeneration is chained above.
- `scripts/setup/regenerate-graph-viz.py` re-execs under the interpreter recorded in
  `graphify-out/.graphify_python`, so it works whichever `python3` is on PATH. It reads graphify's
  own `MAX_NODES_FOR_VIZ` rather than restating it, and **skips with exit 0** above that ceiling —
  a graph too large to draw is not a failed rebuild. Headroom is worth watching: ~3400 of 5000, and
  it grew ~113 nodes in a single session.
- ⚠️ **`graphify-out/wiki/` does not exist and never has.** `to_wiki` is a graphify export that has
  simply never been run here. The navigation table above pointed at `graphify-out/wiki/index.md` for
  months — permanently inert, and phrased as a live instruction. Navigate `GRAPH_REPORT.md` and
  `graph.json` instead. If you ever do generate the wiki, say so here and restore the preference.
- ⚠️ **`graphify-out/manifest.json` is tracked but a rebuild does not refresh it** — it is the
  watch-mode change-detection cache, not a record of the graph. After a rebuild the graph contains
  files the manifest does not list. Expected, not drift.
- `GRAPH_REPORT.md` looks permanently modified because **the report is inside the corpus**, so each
  rebuild counts the previous report and the word count shifts. A no-op rebuild still dirties it.
- The visualization is an interactive vis-network view (search, click-to-inspect, community filter).
  Open `graphify-out/graph.html` directly; no server needed. Community names will be generic
  `Community N` — naming needs the LLM pass of a full `/graphify` run, which the no-LLM rebuild skips.

**Codex handoffs:** run `bash scripts/setup/agent-context.sh` to write `local-codex/CodeContext.md` and mirror Graphify. Codex reads the snapshot, then verifies structural claims against its own tooling; Claude cites Serena queries when justifying a target area.

---

## Commands

```bash
pnpm install                                          # Install dependencies
pnpm run test                                         # Vitest suite
pnpm run test -- --reporter=json --outputFile=<f>     # Structured results (what fast-pass uses)
pnpm run test:vitest -- tests/<path>/<name>.test.js   # Single Vitest file
pnpm run typecheck                                    # Typecheck gate (core-ts + its tests, strict)
pnpm run typecheck:report                             # Cost of widening the gate, per package
pnpm run typecheck:report -- --check-js               # ...including .js: the all-TypeScript size
pnpm run serve:ui                                     # UI dev server :8001
pnpm run demo:cli                                     # CLI demo
```

**Content-gen benchmark — NOT part of development (maintainer, 2026-08-13).** It runs as a **standalone tool, nightly, against code changes, offline**. The benchmarks have grown complex enough that they cannot be run inside the development loop.

- **Do not run `run-content-gen` from a session**, and do not schedule work around one.
- **Nothing is "benchmark-gated".** No milestone, decision, PR or merge waits on a benchmark result.
- Pass bars and baselines belong to the nightly tool, not to a diff.
- Benchmark measurements are **offline evidence** (charter: they "cannot rewrite routing policy without an explicit, versioned promotion"). A nightly regression is a signal to read, not a deliverable to produce.
- **The one obligation:** if a change touches the `ak_create` tool schema, CLI arg mapping, or entity normalization, say so in the commit message so a nightly result can be attributed to it.

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

New personas require `controller.js`, `state-machine.js`, `contracts.ts`, and at least one state handler.

**Adapters** — all external IO (LLM, IPFS, blockchain, solver, logging) lives only in `adapters-web/-cli/-test`. Adapters receive effects from `runtime/src/ports/effects.js`; they do not pull state. Test adapters are fixture-based and fully deterministic.

**Artifacts** — all boundary-crossing data uses a versioned schema from `packages/runtime/src/contracts/artifacts.ts`: `{ schema: "agent-kernel/ArtifactName", schemaVersion: 1, meta: ArtifactMeta }`. Evolve `schemaVersion` on breaking changes; never remove or rename fields in-place.

---

## Enforcement Checklist

Run on every diff. **Fix failures — don't just flag them.**

**Architecture** — dependency flows only adapters/ui → runtime → core-ts · `core-ts` has no IO and no outside imports · all external IO behind an adapter · no adapter code in `runtime`/`core-ts`.

**Personas** — pure FSM (`view()` + `advance`) · clock injected · context serializable · effects returned as data · new persona folders include `controller.js`, `state-machine.js`, `persona.js`, `contracts.ts` · no imports of persona internals from outside the persona directory (controllers only) · no domain logic in glue (kernel, card-authoring, orchestrate-build, adapters) · persona states must gate real behavior — label-only states are defects · all pricing goes through the Allocator (base costs in `base-costs.json`, formulas in Allocator code, no silent fallbacks).

**Artifacts** — boundary data uses an `artifacts.ts` schema · `schema`/`schemaVersion`/`meta` present · no field-name conflicts with existing contracts.

**Types** — `pnpm run typecheck` stays at zero (gate: `tsconfig.typecheck.json`, enforced by `tests/architecture/typecheck-gate.test.js`). The gate covers **core-ts and its tests only** — the code genuinely clean under `strict`. Do not widen it casually: the five real `_shared/*.mts` modules carry **180 errors** and leak into every scope importing them, so widening is a fix-first project, not a config change. `pnpm run typecheck:report` prices each scope. ⚠️ Note `checkJs` is **off**: a package that is all `.js` reports 0 because there is nothing to check, which is not the same as clean — read the file count the report prints alongside.

**Tests** — failing tests written *before* production code · new behavior covered under `tests/` · deterministic behavior uses fixtures · negative cases under `tests/fixtures/artifacts/invalid/` · no test hits live external services · base test file ends with `## TODO: Test Permutations` before Ollama handoff · persona behavior tests live in `tests/personas/<persona>/` named `<persona>-<behavior>.test.*` · label-only persona tests are legacy: replace with behavior tests, then remove (never remove first).

**Benchmarks** — **not a checklist item.** Benchmarking left the development process on 2026-08-13: it is a standalone nightly tool, offline. Never run it from a session and never gate a diff on it. If a change touches the `ak_create` tool schema, CLI arg mapping, or entity normalization, note that in the commit message so the nightly result can be attributed — that is the whole obligation. Results stay out of git.

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
