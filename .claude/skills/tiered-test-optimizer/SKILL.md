---
name: tiered-test-optimizer
description: Run the Vitest suite with a cheap detection pass, then resolve failures with a high-reasoning fix pass. Use when the user wants the full suite run and failures triaged/fixed automatically ("run the tests and fix what's broken", "tiered test run"). Structured JSON reporting only — no log scraping.
---

# Tiered Test Optimizer

Two dedicated subagents in `.claude/agents/` do the work; this skill is the orchestration recipe. Never run `pnpm run test | tee` + grep — the JSON reporter feeds the agents directly.

## Flow

1. **Detect** — spawn `fast-pass` (Haiku): runs `pnpm run test -- --reporter=json`, returns `{total, passed, failed, failures:[{test, file, category, message}]}`. If `failed: 0`, report the counts and stop.
2. **Fix** — spawn `fix-pass` (Opus) with the failure list verbatim. It works category-by-category, queries Serena for callers/implementers on Dependency Inversion and Effect Routing failures, applies minimal fixes, and re-runs narrowly.
3. **Verify** — spawn `fast-pass` again for a clean structured before/after.
4. **Report** — before/after counts, per-failure outcome (fixed / escalated / blocked), files touched.

Relay escalations from fix-pass to the maintainer verbatim and wait; do not approve boundary changes yourself.

## Categories (7, fixed)

Dependency Inversion · Effect Routing · Persona FSM Violation · Schema Mismatch · Serialization · Determinism · Fixture Corruption. Keyword rules live in `fast-pass.md`.

## Ground truth

- Layers: `core-ts` ← `runtime` ← `adapters-cli`/`adapters-web`/`adapters-test`/`ui-web` (see CLAUDE.md → Architecture).
- Personas (7): Orchestrator, Director, Configurator, Actor, Allocator, Annotator, Moderator.
- Runner: Vitest only (`scripts/testing/run-vitest.mjs`) — and now the repo's only runner at all.
- Narrow re-run: `pnpm run test:vitest -- tests/<path>/<name>.test.js`.

## Escalation triggers (maintainer confirmation required)

Architecture-boundary changes · new persona state handlers · adapter interface or public CLI flag changes · any edit to `docs/architecture-charter.md` / `docs/vision-contract.md`.
