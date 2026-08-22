# AGENTS.md

This file defines how the solo developer and the agent team work together on this repo.
Keep it short, strict, and easy to follow.

## Session-Start Checklist (run before any coding in a new session)

Every agent that writes code must complete this checklist at the start of each session, before touching any source file. Do not skip steps or reorder them.

| Step | Command / Action | Confirms |
|------|-----------------|---------|
| 1. Prior context | Read `~/vault/hot.md`; read `~/vault/index.md` only if `hot.md` is sparse | Last-session context loaded |
| 2. Latest source | `git pull --ff-only` | Working from HEAD, no stale files |
| 3. Dependencies | `pnpm install --frozen-lockfile` | All packages match lockfile |
| 4. Tests baseline | `pnpm run test` | No pre-existing failures before changes begin |
| 5. Agent context refresh | `bash scripts/setup/agent-context.sh` | Branch-local Graphify + CodeContext snapshot refreshed and mirrored |
| 6. Serena scope check | `python3 scripts/setup/patch-serena-ignored-dirs.py --check` | Serena's hardcoded `build`/`dist` blind spot remains patched |
| 7. Serena reachable | Any `mcp__serena__*` tool responds | Structural queries available (live LSP — nothing to index, watch, or canary-check) |
| 8. Orient from graphify | Read `local-codex/CodeContext.md`, then the mirrored Graphify report it names | High-level semantic map loaded before structural queries |

Steps 5–8 are cheap (seconds). Never skip them to save time. Re-run
`python3 scripts/setup/patch-serena-ignored-dirs.py` after every `uv tool upgrade serena-agent`; an upgrade
silently restores the blind spot.

> Historical note: the corresponding structural-tool steps used to be "start the CodeContextGraph watch"
> and "run graph-sanity-check.sh". CodeGraphContext was retired 2026-07-28 after its persistent index went
> stale-but-confident twice (PT.1's `IGNORE_DIRS` build-plane blindness, then a skipped re-index that dropped
> all of `tests/`). Serena's language-server answers are computed live from the working tree, so that failure
> class — and the canary apparatus that guarded it — is gone.

---

## Agent roster and responsibilities

| Agent | Model / Effort | Responsibility |
|-------|---------------|----------------|
| **Codex** | GPT-5 tier / high | Ideation, plan authoring, adversarial verification, **implementation of well-specified mechanical milestones** |
| **Claude Opus** | Opus tier / high | Orchestration — split plans into milestones, assign to agents |
| **Claude Sonnet** | Sonnet tier / high | Implementation — all production code and architecture refactors |
| **Claude Sonnet** | Sonnet tier / medium | Base test authoring — writes test files with TODO permutation stubs |
| **Ollama** (local model) | local / — | Test permutation expansion from TODO stubs (`/local-test-gen`), artifact summarization, schema classification (`local_*` MCP) |
| ~~**Remote Ollama** (GPU node)~~ | — | ~~Content-gen benchmark~~ — **removed from the roster 2026-08-13.** Benchmarking is a standalone nightly tool outside the development process; no agent runs it and no work is delegated to it. |
| **fast-pass** (subagent) | Haiku (pinned in `.claude/agents/fast-pass.md`) | Test-suite failure detection via Vitest JSON reporter; returns structured failure list; tools: Bash, Read only |
| **fix-pass** (subagent) | Opus (pinned in `.claude/agents/fix-pass.md`) | Failure diagnosis + minimal fixes; queries Serena on architectural categories; escalates boundary changes; full tools |
| **codex-reviewer** (subagent) | Sonnet | Review-only wrapper around the Codex adversarial flow; tools: Read, Glob, Grep, Bash — **no Edit/Write** |
| **Claude Sonnet** | Sonnet tier / medium | Descriptive docs — package / persona READMEs, `docs/README.md`, `docs/readme-index.md`, CLI README — plus commit messages and PR authoring |
| **Claude Opus** | Opus tier / high | Normative docs — `docs/architecture-charter.md`, `docs/vision-contract.md`, `docs/architecture/diagram.mmd` (architectural law; maintainer sign-off still required) |

> **Model names, not versions.** This table names model *tiers* (Opus, Sonnet, Haiku, GPT-5), never dated
> IDs — those churn, and a pinned ID goes stale silently while still looking authoritative. Use the latest
> release in each tier; pick the exact ID with `/model` or the API. **The effort level (high / medium) is
> the load-bearing part of each row** and must be preserved when a tier is updated. `CLAUDE.md` states the
> same policy; the two files must agree.
>
> ~~The one deliberate exception is the Remote Ollama row: `qwen3-coder:30b-a3b-q4_K_M` is pinned on purpose
> because the content-gen benchmark baseline is only comparable against that exact model.~~
> **Retired 2026-08-13 with the row itself.** Model pinning for benchmark comparability is now the
> nightly tool's concern, not this table's — no agent tier depends on it.

Claude's full enforcement rules are in `CLAUDE.md`. Read it to understand what will be changed and why.

---

## Workflow

```
Codex (ideation/plan)
    ↓
Claude Opus (orchestrate: milestone split + agent assignment)
    ↓  ← generates local-codex/CodeContext.md snapshot before each Codex handoff
Claude Sonnet/high (implement)  ← queries Serena MCP for structural lookups
    ↓
Claude Sonnet/medium (write base tests + TODO permutation stubs)
    ↓
Ollama (expand permutations in place via /local-test-gen)   ← unit/integration correctness
    ↓
Claude (docs in the SAME diff as the code — Sonnet/medium descriptive, Opus/high normative; then commit + PR)
```

**The benchmark is not a step in this pipeline** and was removed from it on 2026-08-13. It runs
nightly, offline, as a standalone tool; nothing in the flow above waits on it.

**Docs are not a trailing step.** The agent that changes behavior updates the affected docs in the same
diff, because it already holds the context and a doc that contradicts the code is a live hazard rather
than cosmetic debt — 7 persona READMEs named `.mts` as the canonical source long after `.js` became it,
so anyone following them would have edited a re-export shim and their change would silently never run.

**Tests vs. benchmarks:**
- **Tests** (`pnpm run test`) — deterministic correctness: does the code behave as specified? Vitest, fixture-backed, no external services.
- **Benchmarks** — LLM tool-call surface under load: does the model produce valid tool calls across the scenario permutations? **Run by a standalone nightly tool, offline, outside the development process (2026-08-13).** Not a substitute for tests, not a gate on any diff, and never run from a session. See "Benchmark strategy" below.

## Serena — shared structural code understanding

Serena (MCP, language-server-backed) answers structural questions — definitions, callers, references, file symbol maps — **live from the working tree**. There is no persistent index, so there is no rebuild to schedule and no watch to keep alive.

**Serena has a patched third-party scope defect.** Its TypeScript adapter hardcodes `node_modules`, `dist`,
and `build` as ignored directory names before project configuration or `.gitignore` is consulted. The repo's
`scripts/setup/patch-serena-ignored-dirs.py` removes `dist` and `build` from that list while keeping
`node_modules`; Serena then applies the project's own `.gitignore`. A restart does **not** fix the hardcoded
list — run the patch after every Serena upgrade and verify it with `--check` at session start. `.gitignore`
still affects Serena after that layer, so audit it when a tracked defining file is unexpectedly invisible.

**An empty or thin result is not proof of absence.** Pass `relative_path` to `find_symbol` when the defining
file is known, and confirm that file is visible with `get_symbols_overview` before concluding "no callers"
or "dead code". Definitions are syntactic while references are language-server semantic results; if a
definition resolves but references do not, verify the file is included in the TypeScript program before
trusting the result.

**Scope:** Serena is for relational/structural queries (`find_symbol`, `find_referencing_symbols`, `find_declaration`, `find_implementations`, `get_symbols_overview`). `grep`/`rg` are legitimate for literal text — prose, fixture strings, exact error messages — and for pattern search, which Serena does not offer; no prior-query justification is required.

**Failure policy:** if Serena is unavailable, say so explicitly and fall back to reading files; do not guess structure from filenames.

**Documentation agents:** verify a claim against Serena (or the file itself) before writing it down. `local-codex/CodeContext.md`, the snapshot generated by `scripts/setup/agent-context.sh`, remains the cold-start context for Codex handoffs.

### Snapshot generation (before each Codex handoff)

Run `bash scripts/setup/agent-context.sh` before every Codex task. This writes a fresh `local-codex/CodeContext.md` and mirrors branch-local Graphify output under `~/vault/codex-context/agent-kernel/worktrees/<id>/`. Codex reads the snapshot first, then verifies structural detail with Serena against the live tree. Do not reuse a snapshot from a prior milestone.

## Subagent roster (`.claude/agents/`)

| Subagent | Model | Scope | Tools |
|---|---|---|---|
| `fast-pass` | Haiku 4.5 (pinned) | Run Vitest via JSON reporter; return structured failure list `{test, file, category, message}`; never edits | Bash, Read |
| `fix-pass` | Opus 5 (pinned) | Diagnose + fix categorized failures; Serena lookups on Dependency Inversion / Effect Routing; escalates boundary changes to the maintainer | full |
| `codex-reviewer` | Sonnet | Run Codex adversarial review via the plugin runtime; verify claims; relay verdict; review-only | Read, Glob, Grep, Bash (no Edit/Write) |

Orchestration recipe: `.claude/skills/tiered-test-optimizer/SKILL.md`. Escalations from `fix-pass` go to the maintainer verbatim; the orchestrator never approves boundary changes itself.

---

## Codex — ideation, planning, adversarial verification, mechanical implementation

- Produces `local-codex/Plan.md` from a prompt or spec.
- Runs adversarial review on completed diffs to stress-test design decisions.
- Uses Serena for structural code navigation: definitions, callers, references, implementations, and symbol
  maps. Uses `rg` only for literal text and pattern searches. If Serena is unavailable, says so explicitly
  and reads the relevant files directly rather than guessing structure from filenames.
- **Implements well-specified mechanical milestones** (decided 2026-07-18 for the Persona
  Enforcement Program): call-site threading behind an already-designed controller API, lint/guard
  sweeps, bulk test migration to the persona naming scheme, and characterization tests written to
  an explicit spec. The milestone spec must name target files, the exact API to call, validation
  commands, and a stop condition; Claude verifies Codex output against the validation commands
  before it counts as done.
- Does **not** design persona controller APIs, change artifact schemas, or make pricing-policy
  decisions — those stay with Claude, with escalation to the maintainer per `CLAUDE.md`.

## Claude Opus — orchestration

- Reads the plan, sizes milestones (XS / S / M), and assigns each to the correct agent.
- Identifies dependency order between milestones.
- Does not begin coding until the plan is decomposed.
- Milestone size bands:
  - `XS`: ≤ 30 min, ≤ 100 LOC, ≤ 2 files.
  - `S`: ≤ 1 hr, ≤ 250 LOC, ≤ 5 files.
  - `M`: ≤ 2 hr, ≤ 500 LOC, ≤ 8 files.
  - Anything larger than `M`, crossing multiple packages, or changing architecture must be split before implementation.
- Execute at most one `M` or two `S` milestones per Codex task; stop and produce a handoff summary after.
- Each milestone must name: target files, tests, validation commands, and an explicit stop condition.

## Claude Sonnet/high — implementation

- Implements all production code from the milestone spec.
- Refactors any code that violates the architecture checklist in `CLAUDE.md` — no permission needed for clear violations.
- Preserves intent; corrects structure.

## Claude Sonnet/medium — base test authoring

- Writes the base test file for each coding milestone.
- Every base test file **must** end with a `## TODO: Test Permutations` section listing edge cases and boundary conditions as plain-language stubs. This section is the handoff signal to Ollama.
- For delegated low-complexity permutation work, point the harness at `tests/README.md` first. That file is the repo-local playbook for MCP-backed test expansion by Ollama/local models.
- Example stub format:
  ```
  ## TODO: Test Permutations
  // - advance() with empty payload should return idle state
  // - advance() with null correlationId should throw validation error
  // - context with circular reference should fail serialization guard
  ```

## Ollama — test permutation expansion

- Triggered by `/local-test-gen` (repo-owned skill, `.claude/skills/local-test-gen/`), launched via Claude Code harness. Auto-detects the warm Ollama model; remote GPU runs go through `remote-ollama-mac run-local --profile dual`.
- Reads `## TODO: Test Permutations` stubs and generates concrete test cases in place.
- Must read `tests/README.md` before expanding permutations or building bounded CLI-option matrices.
- Should use the test-harness MCP to discover patterns, scaffold or insert cases, and run narrow scopes.
- May run bounded CLI argument/option permutations around one command family at a time, then build tests from the distinct failure classes it finds.
- Does not make architecture decisions or modify production code.

## Documentation and commits — Claude

Documentation moved from GitHub Copilot to Claude on 2026-07-27. Docs ship in the **same diff** as the
code that changes them, not as a trailing pass after merge.

- **Descriptive docs — Sonnet / medium.** Package and persona READMEs, `docs/README.md`,
  `docs/readme-index.md`, `packages/adapters-cli/README.md`. The content follows from a diff that already
  exists; the work is accuracy and concision, not design.
- **Normative docs — Opus / high.** `docs/architecture-charter.md`, `docs/vision-contract.md`,
  `docs/architecture/diagram.mmd`. These are architectural law: they encode decisions rather than describe
  code, every later agent obeys them, and an error propagates silently. Maintainer sign-off required.
- **Commit messages and PRs — Sonnet / medium.** Commit or push only when the maintainer asks.
- A doc that contradicts the code is a **blocking** defect, not a follow-up — fix it in the diff that made
  it wrong.

---

## Working agreement

- Always connect requirements → tests → code in the same change set when feasible.
- Prefer small, reviewable diffs over large refactors.
- If a change alters architecture boundaries, the charter + diagram are updated in the SAME diff (Claude Opus/high, maintainer sign-off).
- Produce code that conforms to the architecture checklist in `CLAUDE.md` before handoff.

## Architecture guardrails

- Allowed dependency direction: adapters/ui → runtime → core-ts.
- `core-ts` performs no IO and imports nothing outside itself.
- External IO is only via adapters (ports boundary).

## File placement rules

- Runtime code: `packages/runtime/src/`
- Core logic: `packages/core-ts/src/`
- Web adapters: `packages/adapters-web/src/adapters/`
- UI code: `packages/ui-web/src/` (views, panels, templates)
- CLI adapters and commands: `packages/adapters-cli/src/`
- Test adapters: `packages/adapters-test/src/`
- Tests: `tests/**`
- Shared fixtures: `tests/fixtures/**`

## UI development

- For UI design and development, reference `Design.md` for design principles and Stitch MCP integration.
- Use Google Stitch MCP server for AI-assisted UI design via `@_davideast/stitch-mcp`.
- Configure Stitch API key in `.env` (see `.env.example` for template).
- All UI code must follow the ports & adapters pattern and reside in `packages/ui-web/`.
- UI tests belong in `tests/ui-web/` and should be fixture-based.

## Naming conventions

- Artifacts and schemas follow `packages/runtime/src/contracts/artifacts.ts`.
- Fixture files: `<schema>-v1-<label>.json` (e.g., `intent-envelope-v1-basic.json`).
- CLI flags mirror `packages/adapters-cli/src/cli/ak.mjs` and README examples.

## Test strategy

- Default runner: `pnpm run test` → Vitest for Node-side suites.
- Use fixture-based tests for deterministic behavior.
- Add negative fixtures under `tests/fixtures/artifacts/invalid` when adding validation.
- Base tests are Claude Sonnet/medium's output. Permutations are Ollama's output.
- **Persona alignment (enforced, per the charter's Persona Model):** persona behavior tests live
  in `tests/personas/<persona>/` named `<persona>-<behavior>.test.*`. New tests for persona-owned
  logic go there, not in `tests/runtime/`. A test that asserts only a state label is legacy;
  legacy tests are removed per migration phase, only after a behavior test replaces them —
  never before (they are the safety net until then).

## Benchmark strategy

🔴 **BENCHMARKING IS OUTSIDE THE DEVELOPMENT PROCESS (maintainer, 2026-08-13).** It runs as a
**standalone tool, nightly, against code changes, offline.** The benchmarks have grown complex
enough that they cannot be run as part of development.

Benchmarking is distinct from testing. Tests verify correctness; benchmarks verify that the LLM tool-call surface holds up under permutation load and budget stress. **Only the first of those is an agent's job.**

Canonical content-gen scenario count: 100 (source: `loadScenarioCatalog()`)

- **Never run a benchmark from a session**, and never schedule work around one.
- **Nothing is "benchmark-gated"** — no milestone, decision, PR or merge waits on a result.
- **Read before running.** Fetch `benchmark-results`, then use `benchmark-result-reader.js` with
  `latest_attempt` for current health or `latest_success` for the last qualifying baseline. The
  reader rejects stale scenario or matrix identities.
- **Pass bars and baselines belong to the standalone tool.** Do not treat them as merge conditions,
  and do not quote a historical number as a baseline without its source commit and hashes.
- Compact structured evidence is committed only to `benchmark-results`; raw prompts, generations,
  artifacts, and telemetry remain local. Result-branch commits cannot trigger source benchmarks.
- Results are **offline evidence** (charter: they "cannot rewrite routing policy without an explicit,
  versioned promotion"). A regression is a signal to read and investigate, not routing policy.
- **The one obligation:** if a change touches the `ak_create` tool schema, `buildArgv`, entity normalization, or CLI arg mapping, say so in the commit message so a nightly result can be attributed to it.

## Large-change artifacts

- For large deliverables, use `local-codex/Prompt.md`, `local-codex/Plan.md`, `local-codex/Implement.md`, and `local-codex/Documentation.md` as the execution source of truth.
- Read all four files before making code changes.
- Execute milestones as requirements → tests → code → validation.
- Update `local-codex/Documentation.md` (status, decisions, validation log) before handoff.

## Pre-handoff checklist (before commit)

- `local-codex/CodeContext.md` regenerated via `agent-context.sh` before this Codex task started.
- Requirements → tests → code traceable in the diff.
- Dependency direction: adapters/ui → runtime → core-ts. No inversions.
- No `core-ts` IO or forbidden imports.
- Personas are pure FSMs: `view()` + `advance(event, payload)`, clock injected, context serializable.
- Persona boundary respected: no imports of persona internals from outside the persona's directory (controllers/persona.js only); no domain logic in glue code (kernel, card-authoring, orchestrate-build, adapters).
- All boundary-crossing data uses a versioned artifact schema from `contracts/artifacts.ts`.
- New files placed in the correct package (see file placement rules above).
- Base test file present and includes `## TODO: Test Permutations` stubs (or Ollama has already expanded them).
- Tests pass locally or documented reason for skipping.
- **If `ak_create` schema, CLI arg mapping, or entity normalization changed:** say so in the commit message so the nightly benchmark result can be attributed to the change. **Do not run a benchmark** — it is a standalone nightly tool outside the development process, and no merge waits on it.
- Architecture / design / README docs updated IN THIS DIFF if behavior or boundaries changed (not queued for later) — a doc that now contradicts the code is a blocking defect.

---

## Vault-Backed Knowledge Management

This repo is paired with an Obsidian vault that holds non-load-bearing knowledge. The
`local-codex/` directory in this repo is **symlinks** into the vault — all reads and writes
to `local-codex/Plan.md`, `Prompt.md`, `Implement.md`, `Documentation.md`, `Dictation.md`,
and `CodeContext.md` transparently target `~/vault/plans/active/...` and
`~/vault/sources/codex-snapshots/...`.

For Codex specifically:
- Active plan: `local-codex/Plan.md` (= `~/vault/plans/active/Plan.md`)
- Active prompt: `local-codex/Prompt.md` (= `~/vault/plans/active/Prompt.md`)
- Orientation snapshot: `local-codex/CodeContext.md`
- Cheatsheets: `~/vault/concepts/CODEX-CHEATSHEET.md`,
  `~/vault/concepts/MODEL-SELECTION-CHEATSHEET.md`

Decisions made during a session are saved via Claude's `/save` to `~/vault/decisions/`.
Codex reads decisions but does not author them directly.

Setup: `bash scripts/setup/setup-km.sh` on each machine. Migration runs once on the Mac
(primary) and is propagated to the Ubuntu box via `git pull`.
