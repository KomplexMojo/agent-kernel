# Implement.md

Runbook for execution, verification, and branch-close handoff.

## 1) Preflight

1. Confirm working directory is repo root.
2. Read:
   - `AGENTS.md`
   - `local-codex/Prompt.md`
   - `local-codex/Plan.md`
   - `local-codex/Implement.md`
   - `local-codex/Documentation.md`
   - `local-codex/ui-cli-parity-matrix.md`
   - `local-codex/ui-cli-unification-plan.md`
   - `local-codex/runtime-reasoning-contract.md` when executing `B2-S4`
3. Confirm current checkpoint status in `Documentation.md` before changing code.
4. Define the exact milestone or work package being executed.
5. Define any legacy-deletion targets and dependency-isolation targets for that slice before writing code.

## 2) Milestone Loop

For each milestone or work package in `Plan.md`:

1. Requirement lock:
   - restate the requirement in one sentence,
   - confirm exact files likely to change,
   - state whether the slice affects parity, shared rails, dependency reduction, or docs only.

2. Tests first:
   - add or update tests to encode the required behavior,
   - prefer deterministic fixtures and artifact assertions,
   - run targeted tests and capture the result.
   - for `B2-S4`, extend the existing solver/capture pipeline before adding any new artifact schema; treat new top-level runtime decision schemas as disallowed unless the current transport proves insufficient.

3. Implementation:
   - apply the smallest workable diff,
   - respect architecture boundaries,
   - remove superseded legacy paths in-scope,
   - avoid adding new environment-specific behavior to the default workflow.

4. Validation:
   - run milestone-level targeted tests,
   - run any required integration command for the touched area,
   - if the slice changes dependency assumptions, verify the default workflow still runs without optional services.

5. Documentation:
   - update `Documentation.md` status, change log, and open issues,
   - update `ui-cli-parity-matrix.md` for affected rows,
   - update docs/README/diagram when the architecture or public behavior changed.

## 3) Practical Day-to-Day Use

1. Keep these open side-by-side in VS Code:
   - `local-codex/Prompt.md`
   - `local-codex/Plan.md`
   - `local-codex/Documentation.md`
   - `local-codex/ui-cli-parity-matrix.md`
   - `local-codex/ui-cli-unification-plan.md`
   - `local-codex/runtime-reasoning-contract.md` for runtime reasoning work
2. Work one work-package at a time, not multiple open parity gaps in one pass.
3. After each slice:
   - copy validation command results into `Documentation.md`,
   - update milestone and blocker status,
   - log decisions and boundary changes.
4. At end of day or before switching features:
   - update `Documentation.md` with the exact checkpoint reached,
   - record the next recommended slice and any still-open branch-close decisions,
   - update public docs (`docs/README.md`, architecture diagram, README files) if the implemented behavior changed what tomorrow's work should assume.
5. Do not mark a row `implemented` until code, tests, and docs all match.
6. Do not mark the branch complete while:
   - `partial` rows still lack a decided end-state,
   - legacy execution paths remain in active scope,
   - known baseline failures are unresolved,
   - minimal-install expectations are undocumented.

## 4) Verification Checklist

- [ ] Requirements mapped to tests and code for each slice.
- [ ] New behavior covered by deterministic fixtures where possible.
- [ ] No forbidden imports / IO in `core-as`.
- [ ] CLI flags and public behavior documented in `packages/adapters-cli/README.md` when applicable.
- [ ] Architecture docs updated when boundaries change.
- [ ] `local-codex/ui-cli-parity-matrix.md` updated for each changed feature row.
- [ ] Replaced legacy paths deleted in the same slice.
- [ ] Active UI workflow uses shared command/runtime logic instead of duplicate UI-only policy logic.
- [ ] Default workflow does not depend on optional external services or unnecessary environment-specific adapters.
- [ ] Remaining open issues are accurately logged in `Documentation.md`.
- [ ] End-of-day checkpoint is written clearly enough that the next session can start from `Documentation.md` without re-discovery work.

## 5) Suggested Command Set

Adjust per change scope.

```bash
pnpm run build:wasm
node --test tests/runtime/*.test.js
node --test tests/adapters-cli/*.test.js
node --test tests/adapters-web/*.test.js
node --test tests/integration/*.test.js
node --test tests/ui-web/*.test.mjs
node --test "tests/**/*.test.js"
```

## 6) Branch-Close Handoff Format

At completion, provide:

1. What changed, by file and behavior.
2. What was validated, with commands and outcomes.
3. Remaining optional-only integrations, if any, and why they are outside the default workflow.
4. Minimum-install expectations for the default workflow.
5. Final parity matrix summary:
   - implemented rows,
   - intentional UI-only rows,
   - optional adapter scope decisions.

## 7) Tomorrow-Start Template

Before starting the next session:

1. Read `Documentation.md` first.
2. Confirm:
   - the current branch checkpoint,
   - the next recommended slice,
   - unresolved branch-close decisions.
3. Re-open only the docs relevant to that slice:
   - `runtime-reasoning-contract.md` for `B2-S4`,
   - `ui-cli-unification-plan.md` for shared-rails adapter work,
   - `ui-cli-parity-matrix.md` for parity row changes.
4. Do not resume from memory; resume from the documented checkpoint.
