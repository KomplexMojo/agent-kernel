# AGENTS.md

This file defines how the solo developer, Codex, and Claude work together on this repo.
Keep it short, strict, and easy to follow.

## Collaboration model

This repo uses a two-agent workflow:

- **Codex (you)** — generates feature code, tests, and implementation based on prompts and plans.
- **Claude** — actively enforces the architecture. Claude will refactor any code that violates the
  Ports & Adapters pattern or the persona FSM contract, preserving your intent but correcting structure.

Claude's full enforcement rules are in `CLAUDE.md`. Read it to understand what will be changed and why.

The goal is that Codex produces conformant code from the start and Claude's changes are minimal.
Treat a Claude refactor as a correction, not a rejection — the logic is kept, the structure is fixed.

## Working agreement

- Always connect requirements -> tests -> code in the same change set when feasible.
- Prefer small, reviewable diffs over large refactors.
- If a change alters architecture boundaries, update the charter + diagram in the same PR.
- Produce code that conforms to the architecture checklist in `CLAUDE.md` before handoff.

## Architecture guardrails

- Allowed dependency direction: adapters/ui -> runtime -> bindings-ts -> core-as.
- `core-as` performs no IO and imports nothing outside itself.
- External IO is only via adapters (ports boundary).

## File placement rules

- Runtime code: `packages/runtime/src/`
- Core logic: `packages/core-as/assembly/`
- Web adapters: `packages/adapters-web/src/adapters/`
- CLI adapters and commands: `packages/adapters-cli/src/`
- Test adapters: `packages/adapters-test/src/`
- Tests: `tests/**`
- Shared fixtures: `tests/fixtures/**`

## Naming conventions

- Artifacts and schemas follow `packages/runtime/src/contracts/artifacts.ts`.
- Fixture files: `<schema>-v1-<label>.json` (e.g., `intent-envelope-v1-basic.json`).
- CLI flags mirror `packages/adapters-cli/src/cli/ak.mjs` and README examples.

## Test strategy

- Default runner: `node --test "tests/**/*.test.js"`.
- Use fixture-based tests for deterministic behavior.
- Add negative fixtures under `tests/fixtures/artifacts/invalid` when adding validation.

## Documentation updates

- If public behavior or flags change, update `packages/adapters-cli/README.md`.
- Keep `docs/README.md` and `docs/architecture/diagram.mmd` in sync with architecture changes.

## Codex large-change artifacts

- For large deliverables, use `local-codex/Prompt.md`, `local-codex/Plan.md`, `local-codex/Implement.md`, and `local-codex/Documentation.md` as the execution source of truth.
- Read all four files before making code changes.
- Execute milestones as requirements -> tests -> code -> validation.
- Update `local-codex/Documentation.md` (status, decisions, validation log) before handoff.

## Pre-handoff checklist (Codex)

Before passing a diff to Claude for enforcement review, verify:

- Requirements -> tests -> code traceable in the diff.
- Dependency direction: adapters/ui -> runtime -> bindings-ts -> core-as. No inversions.
- No `core-as` IO or forbidden imports.
- Personas are pure FSMs: `view()` + `advance(event, payload)`, clock injected, context serializable.
- All boundary-crossing data uses a versioned artifact schema from `contracts/artifacts.ts`.
- New files placed in the correct package (see file placement rules above).
- README/diagram updated if behavior/architecture changed.
- Tests pass locally or documented reason for skipping.
