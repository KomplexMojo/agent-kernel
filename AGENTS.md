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

## Codex large-change artifacts

- For large deliverables, use `local-codex/Prompt.md`, `local-codex/Plan.md`, `local-codex/Implement.md`, and `local-codex/Documentation.md` as the execution source of truth.
- Read all four files before making code changes.
- Execute milestones as requirements -> tests -> code -> validation.
- Update `local-codex/Documentation.md` (status, decisions, validation log) before handoff.

## Milestone execution defaults

- Do not implement an entire large plan in one Codex task. Rewrite it into milestones first.
- Keep the source plan in repo files and reference file paths instead of pasting the full plan repeatedly.
- Milestone size bands:
- `XS`: <= 30 minutes, <= 100 LOC, <= 2 files.
- `S`: <= 1 hour, <= 250 LOC, <= 5 files.
- `M`: <= 2 hours, <= 500 LOC, <= 8 files.
- Anything larger than `M`, crossing multiple packages, or changing architecture must be split before implementation.
- Execute at most one `M` milestone or two `S` milestones per Codex task, then stop and produce a short handoff.
- If scope grows during implementation, stop, re-split the remaining work, and continue only with the next bounded milestone.
- Each milestone should name target files, tests, validation commands, and an explicit stop condition.
- Model guidance:
- Planning, decomposition, risky refactors, and root-cause debugging: use the strongest coding model available with `high` reasoning.
- Bounded `XS` or `S` implementation and routine test fixes: use a smaller or mini coding model with `medium` reasoning.
- Default implementation work: use `medium` reasoning; reserve `xhigh` for ambiguous architecture or debugging tasks only.

## Pre-merge checklist (solo)

- Requirements -> tests -> code traceable in the diff.
- No `core-as` IO or forbidden imports.
- README/diagram updated if behavior/architecture changed.
- Tests pass locally or documented reason for skipping.
