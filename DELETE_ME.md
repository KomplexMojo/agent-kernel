# Deferred File Deletion Plan

> ## STATUS 2026-08-01
> **✅ GROUP B EXECUTED — 33 files deleted, suite green (344 files / 2666 passed | 251 skipped, exit 0).**
> Every candidate was independently re-verified for inbound references before deletion rather than
> trusted from this list; the whole set proved internally closed (each file's only referrers were other
> files in the same set, or the coordination points below).
>
> **Two things this manifest missed, both handled:**
> 1. `packages/ui-web/src/llm-trace-panel.js` also had a `persona-boundary-allowlist.json` entry — the
>    manifest named only `pool-flow.js`. **Allowlist 64 → 62**, which is progress on WP-5's zero target.
> 2. `tests/ui-web/budget-input-validation.test.mjs` was **explicitly excluded** in `vitest.config.mjs`,
>    so it had never run — deleting it removed no coverage. The stale exclusion entry was removed too.
>
> `tests/BUDGET_VALIDATION_TESTS.md` (listed under Group A) was deleted with Group B instead: it exists
> only to document `budget-input-validation.js`, so leaving it would have stranded a doc pointing at a
> deleted module.
>
> **⛔ GROUP C `.mts` SHIMS ARE NOT ELIGIBLE — this manifest contradicts a recorded decision.**
> `Plan.md:3434` "**RECORDED DECISION — `.mts` files are KEPT as shims (2026-07-27, do not re-litigate)**",
> restated in `CLAUDE.md` ("The shims are KEPT by maintainer decision; deleting them is not planned
> work"). Independently, **144 live importers** still reference `controller.mts` / `state-machine.mts`.
> Reopening this needs an explicit maintainer reversal of that decision, not a checklist tick.
>
> **⏸️ GROUP A NOT EXECUTED — it is a subsystem removal, not a deletion sweep.** Beyond deleting 23
> files it requires: removing a dependency and refreshing `pnpm-lock.yaml`; rewriting Playwright modes
> out of five test-harness modules (`test-matrix.mjs`, `shared.mjs`, `classify-tests.mjs`,
> `recipe-catalog.mjs`, `mcp/tools/testing.mjs`); re-enabling `tests/scripts/serve-ui.test.js` under
> Vitest; and updating five docs. Those are the modules the tiered-test-optimizer and the MCP testing
> tools depend on, so it deserves its own reviewable change. Confirmed harmless: the three `ui-web`
> Playwright mentions are comments only, with no functional dependency.
>
> **⏸️ GROUP C visual sheets / `build-spec/map.js` not executed** — both need the migration or generator
> change described below first.

This manifest records deletion candidates identified during the repository-wide
file-purpose review. Deletions are intentionally deferred so they can be
coordinated with the Claude Code refactoring work.

Do not delete files solely because they appear here without observing the group
status and prerequisites. Preserve unrelated working-tree changes. After each
approved group, update references and run `pnpm run test`.

## A. Approved: remove the Playwright subsystem

The maintainer has approved removal of the tracked Playwright content and tests.
Phaser remains the sole UI implementation. Retain the fixture-backed Vitest tests
under `tests/ui-web/`.

### Configuration and test tooling

- [ ] `playwright.config.mjs`
- [ ] `scripts/testing/run-playwright.mjs`
- [ ] `scripts/testing/codemod-playwright-cli-to-playwright-test.mjs`
- [ ] `scripts/testing/find-browser-dependent-tests.mjs`

### Browser specifications and helper

- [ ] `tests/playwright/card-builder-first-push-itemization.spec.mjs`
- [ ] `tests/playwright/element-matrix-ui.spec.mjs`
- [ ] `tests/playwright/gameplay-character-overlay.spec.mjs`
- [ ] `tests/playwright/gameplay-flow.spec.mjs`
- [ ] `tests/playwright/gameplay-fullscreen-controls.spec.mjs`
- [ ] `tests/playwright/gameplay-selection-playback-state.spec.mjs`
- [ ] `tests/playwright/gameplay-tick-navigation.spec.mjs`
- [ ] `tests/playwright/helpers/serve-ui.mjs`
- [ ] `tests/playwright/mcp-random-simulation-playback.spec.mjs`
- [ ] `tests/playwright/phaser-boot-churn.spec.mjs`
- [ ] `tests/playwright/phaser-card-builder-ui.spec.mjs`
- [ ] `tests/playwright/phaser-frame-rendering.spec.mjs`
- [ ] `tests/playwright/phaser-frame.spec.mjs`
- [ ] `tests/playwright/runtime-actions-served.spec.mjs`
- [ ] `tests/playwright/sandbox-scenario.spec.mjs`
- [ ] `tests/playwright/screen-navigation-keys.spec.mjs`
- [ ] `tests/playwright/serve-ui-redirect-health.spec.mjs`
- [ ] `tests/playwright/serve-ui-script.spec.mjs`

### Stale Playwright-related report

- [x] `tests/BUDGET_VALIDATION_TESTS.md`

### Required coordinated edits for Group A

- Remove `@playwright/test` and the Playwright-related scripts from
  `package.json`, then refresh `pnpm-lock.yaml`.
- Remove the Playwright exclusion from `vitest.config.mjs`; enable
  `tests/scripts/serve-ui.test.js` under Vitest to retain server-health coverage.
- Remove Playwright modes, classification, scaffolds, and recommendations from
  `scripts/testing/test-matrix.mjs`, `scripts/testing/shared.mjs`,
  `scripts/testing/classify-tests.mjs`, `scripts/testing/recipe-catalog.mjs`, and
  `packages/adapters-cli/src/mcp/tools/testing.mjs`.
- Update `tests/integration/mcp/mcp-tools.test.js` so UI changes recommend Vitest.
- Update current documentation in `AGENTS.md`, `CLAUDE.md`, `docs/README.md`,
  `tests/README.md`, and `tests/COVERAGE_MATRIX.md`.
- Historical `.playwright-cli/` ignore/archive references may remain if they are
  still needed to suppress old local artifacts.

## B. Recommended: high-confidence dead or redundant files

These were found to have no active caller, to be superseded, or to duplicate an
inherited/canonical file. Confirm this group with the maintainer before deletion.

### Retired and unused adapters

- [x] `packages/adapters-cli/src/adapters/solver-wasm.js`
- [x] `packages/adapters-web/src/adapters/solver-wasm.js`
- [x] `packages/adapters-web/src/adapters/dom-log.js`

Remove their existence-only entries from `tests/adapters-cli/smoke.test.js` and
`tests/adapters-web/smoke.test.js`.

### Unwired legacy UI modules

- [x] `packages/ui-web/src/adapter-panel.js`
- [x] `packages/ui-web/src/llm-trace-panel.js`
- [x] `packages/ui-web/src/ollama-panel.js`
- [x] `packages/ui-web/stitch-test.html`
- [x] `packages/ui-web/src/views/stitch-poc-view.js`
- [x] `tests/ui-web/stitch-poc-view.test.mjs`
- [x] `packages/ui-web/src/affinity-legend.js`
- [x] `tests/ui-web/affinity-legend.test.mjs`
- [x] `packages/ui-web/src/pool-flow.js`
- [x] `tests/ui-web/pool-flow.test.mjs`
- [x] `tests/fixtures/pool/summary-basic.json`
- [x] `packages/ui-web/src/budget-input-validation.js`
- [x] `tests/ui-web/budget-input-validation.test.mjs`
- [x] `packages/ui-web/src/views/phaser-sandbox-view.js`
- [x] `tests/ui-web/phaser-sandbox-view.test.mjs`

When removing `pool-flow.js`, also remove its entry from
`tests/architecture/persona-boundary-allowlist.json`. The active Phaser Gameplay
view and sandbox bridge supersede `phaser-sandbox-view.js`.

### Unused core and persona scaffolding

- [x] `packages/core-ts/src/types/capability.ts`
- [x] `packages/runtime/src/personas/actor/state/idle.ts`
- [x] `packages/runtime/src/personas/allocator/state/idle.ts`
- [x] `packages/runtime/src/personas/annotator/state/idle.ts`
- [x] `packages/runtime/src/personas/configurator/state/idle.ts`
- [x] `packages/runtime/src/personas/director/state/idle.ts`
- [x] `packages/runtime/src/personas/moderator/state/idle.ts`
- [x] `packages/runtime/src/personas/orchestrator/state/idle.ts`

The `idle.ts` files are label-only exports with no consumers; actual behavior is
implemented by each persona's canonical `state-machine.js`.

### Redundant nested module markers

- [x] `packages/runtime/src/personas/allocator/package.json`
- [x] `packages/runtime/src/personas/configurator/package.json`
- [x] `packages/runtime/src/ports/package.json`

Each contains only `{ "type": "module" }`, inherited from
`packages/runtime/package.json`.

### Superseded documentation and one-time cleanup tooling

- [x] `README.INDEX.MD`
- [x] `docs/legacy-file-review.md`
- [x] `scripts/archive-legacy-files.sh`

Git history preserves the completed cleanup. `docs/readme-index.md` is the
canonical index.

## C. Conditional: migrate or regenerate before deletion

Do not delete these files as a blind batch.

### Generated visual review sheets

- [ ] `packages/runtime/src/render/visual-assets/actor-medallions/review/expression-triangles-sheet.png`
- [ ] `packages/runtime/src/render/visual-assets/actor-medallions/review/limited-permutation-contact-sheet-16.png`
- [ ] `packages/runtime/src/render/visual-assets/actor-medallions/review/limited-permutation-contact-sheet-32.png`
- [ ] `packages/runtime/src/render/visual-assets/actor-medallions/review/limited-permutation-contact-sheet.png`
- [ ] `packages/runtime/src/render/visual-assets/actor-medallions/review/representative-actor-affinity-sheet.png`

These are regeneratable QA sheets rather than runtime assets. Update the visual
asset generator/manifest so a regeneration does not reintroduce tracked review
outputs.

### Compatibility re-export wrappers

First migrate every remaining importer to the canonical `.js` implementation.

- [ ] `packages/runtime/src/adaptive-workflow/state-machine.mts`
- [ ] `packages/runtime/src/personas/actor/controller.mts`
- [ ] `packages/runtime/src/personas/actor/state-machine.mts`
- [ ] `packages/runtime/src/personas/allocator/controller.mts`
- [ ] `packages/runtime/src/personas/allocator/state-machine.mts`
- [ ] `packages/runtime/src/personas/annotator/controller.mts`
- [ ] `packages/runtime/src/personas/annotator/state-machine.mts`
- [ ] `packages/runtime/src/personas/configurator/controller.mts`
- [ ] `packages/runtime/src/personas/configurator/state-machine.mts`
- [ ] `packages/runtime/src/personas/director/controller.mts`
- [ ] `packages/runtime/src/personas/director/state-machine.mts`
- [ ] `packages/runtime/src/personas/moderator/controller.mts`
- [ ] `packages/runtime/src/personas/moderator/state-machine.mts`
- [ ] `packages/runtime/src/personas/moderator/affinity-target-effects.mts`
- [ ] `packages/runtime/src/personas/orchestrator/controller.mts`
- [ ] `packages/runtime/src/personas/orchestrator/state-machine.mts`

Update affected tests and persona documentation in the same change.

### Redundant adapter re-export

- [ ] `packages/adapters-cli/src/build-spec/map.js`

First move `tests/adapters-cli/build-spec-map.test.js` to import the canonical
mapper from `packages/runtime/src/build/map-build-spec.js`.

## Validation and completion

For each deletion group:

1. Search for literal paths, imports, package entrypoints, HTML references, and
   documentation links.
2. Make the coordinated reference and dependency updates described above.
3. Run the narrow affected tests.
4. Run `pnpm run test` and require a clean pass.
5. Record any intentionally retained file and the reason beside its checklist
   entry.

Once the approved cleanup is complete and reviewed, remove this manifest in the
same cleanup change or retain it with completed checkboxes as the maintainer
prefers.
