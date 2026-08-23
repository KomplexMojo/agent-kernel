# AGENTS.md

How the solo developer and the agent team work together on this repo. Short, strict, easy to follow.

**Scope split with `CLAUDE.md` — neither file restates the other.** This one owns the roster, the workflow, per-agent scope, review reality, test and benchmark strategy, file placement, naming, and the pre-handoff checklist. `CLAUDE.md` owns reporting, the session-start protocol, code navigation, commands, the architecture summary, and the enforcement checklist. Change a rule in its owning file only.

**Before any coding in a new session**, complete `CLAUDE.md → Session-Start Protocol` in order. It is mandatory for every agent that writes code, not just Claude.

---

## Agent roster

| Agent | Model / Effort | Responsibility |
|-------|---------------|----------------|
| **Codex** | GPT-5 tier / high | Ideation, plan authoring, adversarial verification, **implementation of well-specified mechanical milestones** |
| **Claude Opus** | Opus tier / high | Orchestration — split plans into milestones, assign to agents |
| **Claude Opus** | Opus tier / high | Normative docs — `docs/architecture-charter.md`, `docs/vision-contract.md`, `docs/architecture/diagram.mmd` (architectural law; maintainer sign-off required) |
| **Claude Sonnet** | Sonnet tier / high | Implementation — all production code and architecture refactors |
| **Claude Sonnet** | Sonnet tier / medium | Base test authoring (with TODO permutation stubs); descriptive docs — package and persona READMEs, `docs/README.md`, `docs/readme-index.md`, CLI README; commit messages and PRs |
| **Ollama** (local or remote GPU) | local / — | Test permutation expansion from TODO stubs (`/local-test-gen`); summarization, classification, extraction (`local_*` MCP) |
| **fast-pass** (subagent) | Haiku tier, pinned in `.claude/agents/fast-pass.md` | Vitest run via JSON reporter → structured failure list `{test, file, category, message}`. Detection only. Tools: Bash, Read |
| **fix-pass** (subagent) | Opus tier, pinned in `.claude/agents/fix-pass.md` | Diagnosis + minimal fixes, one category at a time, most-architectural first; Serena lookups; escalates boundary changes. Full tools |
| **codex-reviewer** (subagent) | Sonnet tier | Review-only wrapper around the Codex adversarial flow; verifies claims, relays the verdict. Tools: Read, Glob, Grep, Bash — **no Edit/Write** |

> **Model names, not versions** — see the note in `CLAUDE.md`. **The effort level (high / medium) is the load-bearing part of each row** and must be preserved when a tier is updated.

**Repo-owned skills** (`.claude/skills/`): `local-test-gen` (Ollama permutation expansion), `structured-test-authoring` (use the `ak_test_*` MCP tools before hand-writing a test), `tiered-test-optimizer` (the fast-pass → fix-pass recipe). Escalations from `fix-pass` reach the maintainer verbatim; the orchestrator never approves a boundary change itself.

**MCP surfaces:** `agent-kernel-cli` (`ak_*` — authoring, simulation, inspection, LLM planning, IPFS, blockchain, and the `ak_test_*` test harness; `pnpm run mcp:serve`) and `serena` (structural code queries). Prefer `ak_*` tools over shelling out to `ak.mjs`. Registration for both harnesses is documented in `packages/adapters-cli/src/mcp/README.md`.

---

## Workflow

```
Codex (ideation/plan)
    ↓
Claude Opus (orchestrate: milestone split + agent assignment)
    ↓  ← runs agent-context.sh to regenerate local-codex/CodeContext.md before each Codex handoff
Claude Sonnet/high (implement)  ← queries Serena MCP for structural lookups
    ↓
Claude Sonnet/medium (write base tests + TODO permutation stubs)
    ↓
Ollama (expand permutations in place via /local-test-gen)
    ↓
Claude (docs in the SAME diff as the code — Sonnet/medium descriptive, Opus/high normative; then commit + PR)
```

**Docs are not a trailing step.** The agent that changes behavior updates the affected docs in the same diff: it already holds the context, and a doc that contradicts the code is a live hazard, not cosmetic debt — 7 persona READMEs named `.mts` as the canonical source long after `.js` became it, so anyone following them would have edited a re-export shim and their change would silently never run.

**Benchmarks are not a step in this pipeline** and were removed from it on 2026-08-13.

### Codex — ideation, planning, adversarial verification, mechanical implementation

- Produces `local-codex/Plan.md` from a prompt or spec; runs adversarial review on completed diffs.
- Every adversarial review answers two questions: (1) **Correctness** — does the diff satisfy the milestone spec? (2) **Simplicity** — is it 3× more complex than the simplest solution, and if so what is the specific rewrite?
- **Implements well-specified mechanical milestones** (decided 2026-07-18): call-site threading behind an already-designed controller API, lint/guard sweeps, bulk test migration to the persona naming scheme, characterization tests written to an explicit spec. The spec must name target files, the exact API to call, validation commands, and a stop condition; Claude verifies the output against those commands before it counts as done.
- Does **not** design persona controller APIs, change artifact schemas, or make pricing-policy decisions — those stay with Claude, escalating to the maintainer per `CLAUDE.md`.
- Uses Serena for structural navigation and `rg` for literal text; if Serena is unavailable it says so and reads the files rather than guessing from filenames.

### Claude Opus — orchestration

- Reads the plan, sizes milestones, assigns each to the right agent, and identifies dependency order before any coding starts.
- Size bands: `XS` ≤ 30 min / ≤ 100 LOC / ≤ 2 files · `S` ≤ 1 hr / ≤ 250 LOC / ≤ 5 files · `M` ≤ 2 hr / ≤ 500 LOC / ≤ 8 files. Anything larger, crossing multiple packages, or changing architecture is split first.
- At most one `M` or two `S` milestones per Codex task, then stop and produce a handoff summary.
- Each milestone names: target files, tests, validation commands, and an explicit stop condition.

### Claude Sonnet/high — implementation

- Implements production code from the milestone spec; refactors clear violations of the enforcement checklist without asking. Preserves intent, corrects structure.

### Claude Sonnet/medium — base tests

- Writes the base test file for each coding milestone, ending with a `## TODO: Test Permutations` section — plain-language stubs for edge cases and boundary conditions. That section is the handoff signal to Ollama.
  ```
  ## TODO: Test Permutations
  // - advance() with empty payload should return idle state
  // - advance() with null correlationId should throw validation error
  // - context with circular reference should fail serialization guard
  ```
- Read `tests/README.md` (the repo-local playbook) before delegating expansion work.

### Ollama — permutation expansion

- Triggered by `/local-test-gen`; auto-detects the warm model, `--model` overrides, remote GPU via `remote-ollama-mac run-local --profile dual`.
- Must read `tests/README.md` first. Uses the `ak_test_*` MCP tools to discover patterns, scaffold or insert cases, and run narrow scopes.
- May run bounded CLI argument/option permutations around one command family at a time, then build tests from the distinct failure classes it finds.
- Does not make architecture decisions and does not modify production code.

### Documentation and commits — Claude

Documentation moved from GitHub Copilot to Claude on 2026-07-27. Two tiers by stakes: **descriptive** (Sonnet/medium — the content follows from a diff that already exists; the work is accuracy and concision) and **normative** (Opus/high — architectural law that every later agent obeys, where an error propagates silently; maintainer sign-off required). Which files fall in which tier is in `CLAUDE.md → Enforcement Checklist → Documentation`. Commit or push only when the maintainer asks.

---

## Review — solo project, self-merge is the normal path

**No human second reviewer exists, and none is coming.** Do not write, plan, or report as though a PR is waiting on one.

- **`main` is not review-gated.** The `Protect Main` ruleset carries `deletion` and `non_fast_forward` only — no `pull_request` rule, no required approving reviews — plus a repository-role bypass. Re-verified 2026-08-21 via `gh api repos/KomplexMojo/agent-kernel/rulesets`.
- **There is no CI test job.** `.github/workflows/` holds the `@claude` responder and `claude-code-review.yml`, an automated advisory review that comments on every PR. Advisory: it blocks nothing, and it does not run the suite. **The local gates are the only gates that run.**
- A PR is still worth opening — it is the reviewable unit and where the reasoning is indexed — but it is a **record, not a gate**. Never block on, or ask the maintainer to arrange, a review.

**What replaces a reviewer, and is therefore not optional:**

| Instead of a reviewer | The obligation |
|---|---|
| a second pair of eyes on correctness | the **gates**: `pnpm run test`, `pnpm run typecheck` at zero, the `tests/architecture/` guards, the persona-boundary allowlist |
| someone asking "does this test actually work?" | a **perturbation check** per milestone — the specific change that must turn the test red, run and reported |
| a reviewer noticing a judgement call | judgement calls stated **in the commit message**, not left implicit |
| a reviewer catching a stale claim | any factual claim about repo or GitHub state is **checked before it is written**, never carried forward from an earlier note |

⇒ *Losing the reviewer raises the bar on the evidence; it does not lower it.* The commit message is where a future reader — an agent, not a human — reconstructs why.

---

## Working agreement

- Connect requirements → tests → code in the same change set whenever feasible.
- Prefer small, reviewable diffs over large refactors.
- Architecture boundary changes update the charter + diagram in the SAME diff (Opus/high, maintainer sign-off).
- Conform to the enforcement checklist in `CLAUDE.md` before handoff.
- Guardrails, restated because they are absolute: dependency direction is adapters/ui → runtime → core-ts · `core-ts` performs no IO and imports nothing outside itself · external IO only through adapters at the ports boundary.

## File placement

| What | Where |
|---|---|
| Runtime code (personas, ports, runner, contracts) | `packages/runtime/src/` |
| Core deterministic logic | `packages/core-ts/src/` |
| Web adapters | `packages/adapters-web/src/adapters/` |
| CLI adapters, commands, MCP server | `packages/adapters-cli/src/` |
| Test adapters (fixture doubles) | `packages/adapters-test/src/` |
| UI code | `packages/ui-web/src/` (`views/` plus panel and controller modules) |
| Tests | `tests/**` — persona behavior in `tests/personas/<persona>/`, boundary guards in `tests/architecture/` |
| Shared fixtures | `tests/fixtures/**` (negative cases in `tests/fixtures/artifacts/invalid/`) |

## Naming conventions

- Artifacts and schemas follow `packages/runtime/src/contracts/artifacts.ts`.
- Fixture files: `<schema>-v1-<label>.json` (e.g. `intent-envelope-v1-basic.json`).
- Persona behavior tests: `tests/personas/<persona>/<persona>-<behavior>.test.*`.
- CLI flags mirror `packages/adapters-cli/src/cli/ak.mjs` and its README examples.

## UI development

- UI code follows ports & adapters and lives in `packages/ui-web/`; UI tests are fixture-based Vitest suites under `tests/ui-web/`. There is no browser-native runner.
- Start here: `docs/human-interfaces.md` (offline CLI + UI quickstart) and `RUNME.MD` (Ollama prompt → runtime playback). Serve with `pnpm run serve:ui` (:8001).
- ⚠️ The Google Stitch MCP integration is **gone** — its POC files were deleted, the `Design.md` this file used to cite has never existed since, and the root `.env.example` (which held nothing but `STITCH_API_KEY`) was removed 2026-08-21. Nothing in the repo reads a Stitch key any more.

## Test strategy

- Default runner: `pnpm run test` → Vitest. Fixture-based for anything deterministic; no test touches a live external service.
- Add negative fixtures under `tests/fixtures/artifacts/invalid/` when adding validation.
- Base tests are Sonnet/medium's output; permutations are Ollama's.
- **Persona alignment (enforced by `tests/architecture/persona-test-layout.test.js`):** persona behavior tests live in `tests/personas/<persona>/`, not `tests/runtime/`. A test that asserts only a state label is legacy — remove it only after a behavior test replaces it, never before; until then it is the safety net.

## Benchmark strategy

🔴 **Benchmarking is outside the development process** (maintainer, 2026-08-13). It runs as a standalone tool, against code changes, offline — the benchmarks have grown too complex to run inside the development loop.

Tests verify correctness; benchmarks verify that the LLM tool-call surface holds up under permutation load and budget stress. **Only the first is an agent's job.**

Canonical content-gen scenario count: 100 (source: `loadScenarioCatalog()`).

- **Never run a benchmark from a session**, and never schedule work around one.
- **Nothing is benchmark-gated** — no milestone, decision, PR, or merge waits on a result.
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

**Where the benchmarks live (verified 2026-08-21):**

🔒 **Hands off until Codex finishes (maintainer, 2026-08-21).** Do not modify the benchmark branches,
the working clones, or the program docs below while the Codex effort is in flight — that includes
committing its loose working-tree changes, moving files into git, or tidying. Report state; change nothing.

- **The catalog and harness are under source control**, in this repo on `codex/benchmark-catalog` (working clone `~/Documents/GitHub/agent-kernel-benchmark`). 28 tracked files under `tools/remote-ollama-control/benchmarks/` — the canonical content-gen catalog is **100 scenarios** (25 simple · 25 affinity · 25 complex · 25 constrained) plus the execution and abstract-plan catalogs and their schemas. Results publish to the `benchmark-results` branch.
- **That branch has not merged**: 9 ahead of `main`, 20 behind. `main` still carries the older harness under `tools/`, so agent-kernel `main` is not where benchmark state is read.
- `codex/benchmark-e3` exists **only locally** (`~/Documents/GitHub/agent-kernel-benchmark-e3`), with no commits of its own — its E3 work is entirely uncommitted working-tree change.
- **The program roadmap and execution record are NOT under source control:** `local-codex/Plan-Benchmark.md` and `local-codex/Documentation-Benchmark.md` — `local-codex/` is gitignored, and unlike `Plan.md` these two are real files, not vault symlinks. They exist on one machine with no backup.
- Run output (`tools/remote-ollama-control/results/`, 7.6 GB) is gitignored by design and stays that way.
- **Nothing benchmark-related is in the Obsidian vault.** The cross-device-consistency rationale that once justified syncing them no longer applies.

## Large-change artifacts

- For large deliverables, `local-codex/Prompt.md`, `Plan.md`, `Implement.md`, and `Documentation.md` are the execution source of truth. Read all four before making code changes.
- Execute milestones as requirements → tests → code → validation, and update `local-codex/Documentation.md` (status, decisions, validation log) before handoff.

## Pre-handoff checklist (before commit)

- `local-codex/CodeContext.md` regenerated via `agent-context.sh` before this task started.
- Requirements → tests → code traceable in the diff.
- Dependency direction intact; no `core-ts` IO or forbidden imports.
- Personas are pure FSMs: `view()` + `advance(event, payload)`, clock injected, context serializable.
- Persona boundary respected: no imports of persona internals from outside the persona directory; no domain logic in glue code.
- All boundary-crossing data uses a versioned schema from `contracts/artifacts.ts`.
- New files in the correct package (see file placement).
- Base test file present, ending in `## TODO: Test Permutations` stubs (or Ollama has already expanded them).
- `pnpm run test` and `pnpm run typecheck` pass, or a documented reason for skipping. Perturbation check run and reported.
- Docs updated IN THIS DIFF if behavior or boundaries changed — a doc that now contradicts the code is a blocking defect.
- If `ak_create` schema, CLI arg mapping, or entity normalization changed: noted in the commit message. **Do not run a benchmark.**

---

## Vault-Backed Knowledge Management

This repo is paired with an Obsidian vault holding non-load-bearing knowledge. `local-codex/` is **symlinks** into it: reads and writes of `Plan.md`, `Prompt.md`, `Implement.md`, `Documentation.md`, `Dictation.md`, and `CodeContext.md` transparently target `~/vault/plans/active/...` and `~/vault/sources/codex-snapshots/...`.

For Codex specifically: active plan `local-codex/Plan.md`, active prompt `local-codex/Prompt.md`, orientation snapshot `local-codex/CodeContext.md`, cheatsheets `~/vault/concepts/CODEX-CHEATSHEET.md` and `~/vault/concepts/MODEL-SELECTION-CHEATSHEET.md`. Session decisions are saved by Claude's `/save` to `~/vault/decisions/`; Codex reads decisions but does not author them.

Setup: `bash scripts/setup/setup-km.sh` on each machine. **Vault storage hazards and the retired session hooks are in `CLAUDE.md → Vault-Backed Knowledge Management` — read them before writing anything into the vault.**
