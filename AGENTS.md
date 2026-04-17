# AGENTS.md

This file defines how the solo developer and the agent team work together on this repo.
Keep it short, strict, and easy to follow.

## Agent roster and responsibilities

| Agent | Model / Effort | Responsibility |
|-------|---------------|----------------|
| **Codex** | gpt-5.4 / high | Ideation, plan authoring, adversarial verification |
| **Claude Opus** | claude-opus-4-7 / high | Orchestration — split plans into milestones, assign to agents |
| **Claude Sonnet** | claude-sonnet-4-6 / high | Implementation — all production code and architecture refactors |
| **Claude Sonnet** | claude-sonnet-4-6 / medium | Base test authoring — writes test files with TODO permutation stubs |
| **Ollama** (local model) | local / — | Test permutation expansion from TODO stubs, artifact summarization, schema classification |
| **GitHub Copilot** | — | Commit messages, PR authoring, architecture / design / README updates |

Claude's full enforcement rules are in `CLAUDE.md`. Read it to understand what will be changed and why.

---

## Workflow

```
Codex (ideation/plan)
    ↓
Claude Opus (orchestrate: milestone split + agent assignment)
    ↓  ← generates local-codex/CodeContext.md snapshot before each Codex handoff
Claude Sonnet/high (implement)  ← queries CodeContextGraph via MCP; no grep/find
    ↓
Claude Sonnet/medium (write base tests + TODO permutation stubs)
    ↓
Ollama (expand permutations in place via /ollama-test-permutations)
    ↓
GitHub Copilot (commit, PR, update docs)
```

## CodeContextGraph — shared code understanding

CodeContextGraph (MCP) is the single source of truth for code structure and dependencies.
The watch is active on `/Users/darren/Documents/GitHub/agent-kernel` — the graph updates automatically on every file save.

**All agents with MCP access (Claude, Ollama, Codex):** query the graph directly. Do not use `grep`, `rg`, or `find` for structural questions. Codex has `codegraphcontext` registered in its own MCP config (`codex mcp list`) and can query the graph during tasks.

**Copilot (no MCP access):** consumes `local-codex/CodeContext.md`, the snapshot Claude generates before each handoff.

### Snapshot generation (Claude's responsibility, before each Codex handoff)

Generate a fresh `local-codex/CodeContext.md` before every Codex task. This is a startup orientation document — Codex reads it first, then queries the live graph for detail. Do not reuse a snapshot from a prior milestone; the graph may have changed.

```
mcp__CodeGraphContext__get_repository_stats        → file/function/module counts
mcp__CodeGraphContext__analyze_code_relationships  → package-level import graph
mcp__CodeGraphContext__find_most_complex_functions → top 10 complexity hotspots
```

---

## Codex — ideation, planning, adversarial verification

- Produces `local-codex/Plan.md` from a prompt or spec.
- Runs adversarial review on completed diffs to stress-test design decisions.
- Does **not** write production code or tests.

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
- Example stub format:
  ```
  ## TODO: Test Permutations
  // - advance() with empty payload should return idle state
  // - advance() with null correlationId should throw validation error
  // - context with circular reference should fail serialization guard
  ```

## Ollama — test permutation expansion

- Triggered by `/ollama-test-permutations` skill, launched via Claude Code harness.
- Reads `## TODO: Test Permutations` stubs and generates concrete test cases in place.
- Does not make architecture decisions or modify production code.

## GitHub Copilot — documentation and commits only

- Authors all commit messages.
- Opens and describes all pull requests.
- Updates system documentation after each merged milestone: `docs/architecture-charter.md`, `docs/architecture/diagram.mmd`, `docs/README.md`, `packages/adapters-cli/README.md`, and any other README or design doc affected by the work.
- Does **not** write production code or tests.

---

## Working agreement

- Always connect requirements → tests → code in the same change set when feasible.
- Prefer small, reviewable diffs over large refactors.
- If a change alters architecture boundaries, Copilot updates the charter + diagram in the same PR.
- Produce code that conforms to the architecture checklist in `CLAUDE.md` before handoff.

## Architecture guardrails

- Allowed dependency direction: adapters/ui → runtime → bindings-ts → core-as.
- `core-as` performs no IO and imports nothing outside itself.
- External IO is only via adapters (ports boundary).

## File placement rules

- Runtime code: `packages/runtime/src/`
- Core logic: `packages/core-as/assembly/`
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

- Default runner: `node --test "tests/**/*.test.js"`.
- Use fixture-based tests for deterministic behavior.
- Add negative fixtures under `tests/fixtures/artifacts/invalid` when adding validation.
- Base tests are Claude Sonnet/medium's output. Permutations are Ollama's output.

## Large-change artifacts

- For large deliverables, use `local-codex/Prompt.md`, `local-codex/Plan.md`, `local-codex/Implement.md`, and `local-codex/Documentation.md` as the execution source of truth.
- Read all four files before making code changes.
- Execute milestones as requirements → tests → code → validation.
- Update `local-codex/Documentation.md` (status, decisions, validation log) before handoff.

## Pre-handoff checklist (before Copilot commits)

- `local-codex/CodeContext.md` regenerated from CodeContextGraph before this Codex task started.
- Requirements → tests → code traceable in the diff.
- Dependency direction: adapters/ui → runtime → bindings-ts → core-as. No inversions.
- No `core-as` IO or forbidden imports.
- Personas are pure FSMs: `view()` + `advance(event, payload)`, clock injected, context serializable.
- All boundary-crossing data uses a versioned artifact schema from `contracts/artifacts.ts`.
- New files placed in the correct package (see file placement rules above).
- Base test file present and includes `## TODO: Test Permutations` stubs (or Ollama has already expanded them).
- Tests pass locally or documented reason for skipping.
- Architecture / design / README docs queued for Copilot update if behavior or boundaries changed.
