# AGENTS.md

This file defines how the solo developer and Codex work together on this repo.
Keep it short, strict, and easy to follow.

## Working agreement

- Always connect requirements -> tests -> code in the same change set when feasible.
- Prefer small, reviewable diffs over large refactors.
- If a change alters architecture boundaries, update the charter + diagram in the same PR.

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

## Pre-merge checklist (solo)

- Requirements -> tests -> code traceable in the diff.
- No `core-as` IO or forbidden imports.
- README/diagram updated if behavior/architecture changed.
- Tests pass locally or documented reason for skipping.
