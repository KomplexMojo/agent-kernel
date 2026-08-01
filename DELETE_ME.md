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
> **✅ GROUP C `.mts` SHIMS DONE 2026-08-01 — decision formally reversed on maintainer request.**
> The 2026-07-27 "KEEP as shims" decision required an explicit maintainer request to reopen; that was
> given. All 16 shims deleted, suite unchanged at **345 / 2667 / 251**, exit 0.
>
> **The earlier "144 live importers" figure in this file was WRONG** — it conflated the 16 one-line shims
> with the five **real** `_shared/*.mts` modules, which contain actual code (`tick-orchestrator.mts` 450
> lines, `runtime-decision.mts` 419, `persona-helpers.mts` 131, `tick-state-machine.mts` 99,
> `tick-inspect.mts` 44). `tick-state-machine.mts` alone was 34 of that count. True shim usage was
> **31 files / 72 sites, exactly ONE of them production**; one shim already had zero importers.
> **The five `_shared` modules are untouched.**
>
> Importers were repointed to **`persona.js`** — the charter's controller barrel — rather than
> `controller.js`, so the cleanup also serves the rule 1 boundary instead of just moving a string.
> `controller.mts` dropped from the boundary guard's `PUBLIC_BASENAMES`.
>
> ⚠️ **This was import hygiene, NOT a TypeScript migration.** `f528b6df` records that no `.mts` ever
> contained TypeScript-only syntax, so the shims carried zero type information. The repo remains ~199 JS
> files to ~33 real TS modules with **no `tsc`/typecheck script at all**.
>
> **✅ GROUP A EXECUTED 2026-08-01 — suite 345 files / 2667 passed | 251 skipped, exit 0.**
> 22 files deleted; `@playwright/test` and three scripts removed from `package.json` with the lockfile
> refreshed (0 playwright refs left); Playwright modes rewritten out of all five harness modules;
> `tests/scripts/serve-ui.test.js` **re-enabled under Vitest and passing**, so server-health coverage
> survived the removal (+1 file / +1 test, which is the entire suite delta).
>
> **Two judgement calls worth review:**
> 1. `browser_bundle_load_flow` is now `scaffoldable: false`. Its generator emitted Playwright source,
>    and the recipe needs a real browser (navigation, file input, rendered state), so there is nothing
>    headless to generate. `serve_ui_redirect_health` **was** rewritten to emit Vitest — modelled on the
>    now-live `tests/scripts/serve-ui.test.js` — and its output is syntax-checked.
> 2. **A coverage layer was genuinely lost, and is recorded rather than quietly dropped:**
>    `tests/COVERAGE_MATRIX.md` L2 (UI element render) has no replacement. L1 and L3 still assert the
>    data round-trip, but nothing asserts the rendered frame.
>
> `.gitignore`'s `/playwright/` and `.playwright-cli/` entries are retained, as this manifest permits,
> to keep suppressing stale local artifacts.
>
> **✅ GROUP C (non-`.mts` items) EXECUTED 2026-08-01 — suite unchanged at 345 / 2667 / 251, exit 0.**
> - **`build-spec/map.js`** was a one-line re-export whose only caller was its own test.
>   `tests/adapters-cli/build-spec-map.test.js` now imports the canonical
>   `packages/runtime/src/build/map-build-spec.js` directly (verified green before the delete), and the
>   emptied `build-spec/` directory went with it.
> - **The 5 review sheets** are untracked and deleted. The generator still produces them — they are QA
>   aids and losing the ability to regenerate would be the wrong fix — so the requirement that
>   "regeneration does not reintroduce tracked review outputs" is met by gitignoring the output path.
>   ⚠️ **The ignore rule is FULLY QUALIFIED on purpose**
>   (`/packages/runtime/src/render/visual-assets/actor-medallions/review/`). A bare `review/` would match
>   any directory of that name at any depth — precisely the mistake that hid real source five times in
>   this repo. Verified: `docs/review/`, `packages/ui-web/review/` and both `build/` directories are
>   unaffected.
>   The manifest's `reviewSheets` array is deliberately **left in place**: the generator writes that
>   array itself, so stripping it from the tracked copy would simply return as diff noise on the next
>   regeneration. Nothing consumes it — it is a record of what a run produces.

This manifest records deletion candidates identified during the repository-wide
file-purpose review. Deletions are intentionally deferred so they can be
coordinated with the Claude Code refactoring work.

Do not delete files solely because they appear here without observing the group
status and prerequisites. Preserve unrelated working-tree changes. After each
approved group, update references and run `pnpm run test`.

## A. ✅ DONE 2026-08-01 — Playwright subsystem removed

The maintainer has approved removal of the tracked Playwright content and tests.
Phaser remains the sole UI implementation. Retain the fixture-backed Vitest tests
under `tests/ui-web/`.

### Configuration and test tooling

- [x] `playwright.config.mjs`
- [x] `scripts/testing/run-playwright.mjs`
- [x] `scripts/testing/codemod-playwright-cli-to-playwright-test.mjs`
- [x] `scripts/testing/find-browser-dependent-tests.mjs`

### Browser specifications and helper

- [x] `tests/playwright/card-builder-first-push-itemization.spec.mjs`
- [x] `tests/playwright/element-matrix-ui.spec.mjs`
- [x] `tests/playwright/gameplay-character-overlay.spec.mjs`
- [x] `tests/playwright/gameplay-flow.spec.mjs`
- [x] `tests/playwright/gameplay-fullscreen-controls.spec.mjs`
- [x] `tests/playwright/gameplay-selection-playback-state.spec.mjs`
- [x] `tests/playwright/gameplay-tick-navigation.spec.mjs`
- [x] `tests/playwright/helpers/serve-ui.mjs`
- [x] `tests/playwright/mcp-random-simulation-playback.spec.mjs`
- [x] `tests/playwright/phaser-boot-churn.spec.mjs`
- [x] `tests/playwright/phaser-card-builder-ui.spec.mjs`
- [x] `tests/playwright/phaser-frame-rendering.spec.mjs`
- [x] `tests/playwright/phaser-frame.spec.mjs`
- [x] `tests/playwright/runtime-actions-served.spec.mjs`
- [x] `tests/playwright/sandbox-scenario.spec.mjs`
- [x] `tests/playwright/screen-navigation-keys.spec.mjs`
- [x] `tests/playwright/serve-ui-redirect-health.spec.mjs`
- [x] `tests/playwright/serve-ui-script.spec.mjs`

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

- [x] `packages/runtime/src/render/visual-assets/actor-medallions/review/expression-triangles-sheet.png`
- [x] `packages/runtime/src/render/visual-assets/actor-medallions/review/limited-permutation-contact-sheet-16.png`
- [x] `packages/runtime/src/render/visual-assets/actor-medallions/review/limited-permutation-contact-sheet-32.png`
- [x] `packages/runtime/src/render/visual-assets/actor-medallions/review/limited-permutation-contact-sheet.png`
- [x] `packages/runtime/src/render/visual-assets/actor-medallions/review/representative-actor-affinity-sheet.png`

These are regeneratable QA sheets rather than runtime assets. Update the visual
asset generator/manifest so a regeneration does not reintroduce tracked review
outputs.

### Compatibility re-export wrappers

First migrate every remaining importer to the canonical `.js` implementation.

- [x] `packages/runtime/src/adaptive-workflow/state-machine.mts`
- [x] `packages/runtime/src/personas/actor/controller.mts`
- [x] `packages/runtime/src/personas/actor/state-machine.mts`
- [x] `packages/runtime/src/personas/allocator/controller.mts`
- [x] `packages/runtime/src/personas/allocator/state-machine.mts`
- [x] `packages/runtime/src/personas/annotator/controller.mts`
- [x] `packages/runtime/src/personas/annotator/state-machine.mts`
- [x] `packages/runtime/src/personas/configurator/controller.mts`
- [x] `packages/runtime/src/personas/configurator/state-machine.mts`
- [x] `packages/runtime/src/personas/director/controller.mts`
- [x] `packages/runtime/src/personas/director/state-machine.mts`
- [x] `packages/runtime/src/personas/moderator/controller.mts`
- [x] `packages/runtime/src/personas/moderator/state-machine.mts`
- [x] `packages/runtime/src/personas/moderator/affinity-target-effects.mts`
- [x] `packages/runtime/src/personas/orchestrator/controller.mts`
- [x] `packages/runtime/src/personas/orchestrator/state-machine.mts`

Update affected tests and persona documentation in the same change.

### Redundant adapter re-export

- [x] `packages/adapters-cli/src/build-spec/map.js`

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
