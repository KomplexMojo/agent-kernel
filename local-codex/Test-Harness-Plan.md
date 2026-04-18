# Test Harness Cleanup And Restructuring Plan

## Summary
This work restructures the repository test system around three fixed rules:

1. Vitest is the main test runner for Node, CLI, runtime, contract, WASM, and non-browser integration tests.
2. Playwright is the browser-native runner for served UI and browser automation tests.
3. A custom MCP sits in front of both so Claude Code and Codex operate on structured test recipes and runner intents instead of inventing tests from raw prose.

The plan preserves the current logic of all existing tests. Refactoring should be pushed into repository scripts wherever possible so the migration is cheap in tokens, repeatable, and auditable. The agent-facing workflow should become recipe-first: discover an existing test pattern, scaffold through the MCP, run the narrowest relevant suite, and return structured failures.

## Implementation Status
- `W1` through `W8` are now implemented in the current branch.
- `pnpm run test` is routed through `scripts/testing/run-vitest.mjs`.
- `pnpm run test:playwright` is the canonical browser-native runner.
- The test harness MCP ships inside the existing CLI MCP server via `packages/adapters-cli/src/mcp/tools/testing.mjs`.
- The shared agent skills are present in `.claude/skills/structured-test-authoring/SKILL.md` and `.codex/skills/structured-test-authoring/SKILL.md`.
- The repo-local low-complexity delegation playbook is `tests/README.md`.
- All currently cataloged recipe families are scaffoldable through the MCP, including `ui_cli_equivalence` and `perf_harness_smoke`.
- `test:legacy` is retained temporarily as a bounded compatibility/parity path, not as the default workflow.

## Goals
- Preserve the behavioral intent and assertions of the existing test suite.
- Fix test discovery gaps and normalize runner boundaries.
- Reduce ad hoc test authoring by codifying repo-specific test recipes.
- Move repetitive migration work into scripts rather than manual editing.
- Give both Claude Code and Codex one shared MCP and one shared skill vocabulary.
- Keep backend and domain tests for invariants while shifting browser-native coverage to Playwright.

## Non-Goals
- Rewriting the whole suite by hand.
- Replacing domain or contract tests with UI-only tests.
- Introducing a third long-term primary runner.
- Changing test semantics just to fit a new framework style.

## Current Baseline Findings
- The default test script in `package.json` is `node scripts/testing/run-vitest.mjs`.
- Browser-native coverage runs through `pnpm run test:playwright`.
- The repository inventory and classification are tracked in `local-codex/test-inventory.json` and `local-codex/test-classification.md`.
- The suite is now classified by runner owner and recipe family, with recipe-adoption checks enforcing scaffold coverage.
- Existing tests already cluster into a small number of recurring structures:
  - CLI artifact emission and error-path tests
  - runtime and contract validation tests
  - WASM/core determinism tests
  - UI/CLI equivalence tests
  - served UI and browser-interaction tests
- The implemented migration followed the intended shape: formalize recurring patterns and route them through the correct runner rather than rewriting assertions.

## Target Architecture

### Runner split
- `vitest`
  - `tests/adapters-cli/**`
  - `tests/adapters-test/**`
  - `tests/adapters-web/**` unless they require a real browser
  - `tests/contracts/**`
  - `tests/core-as/**`
  - `tests/financial-model/**`
  - `tests/fixtures/**`
  - `tests/personas/**`
  - `tests/runtime/**`
  - most `tests/integration/**` that are Node/process/artifact equivalence tests
- `playwright`
  - `tests/ui-web/**`
  - served-page integration flows
  - browser-host parity flows that need a real browser tab, DOM interaction, or networked page lifecycle
  - any current `playwright-cli` smoke or UI runtime interaction tests

### Agent-facing architecture
- `test-harness-mcp`
  - Chooses the runner.
  - Knows the repo-specific test recipes.
  - Scaffolds tests from structured input.
  - Runs narrow scopes.
  - Returns structured failures.
- `structured-test-authoring` skill
  - Used by Claude Code and Codex.
  - Tells the agent to prefer MCP recipes over raw hand-authored tests.
  - Tells the agent when to use Vitest-backed vs Playwright-backed recipes.

## Guiding Test Practices
- Preserve the existing assertion meaning before improving style.
- Prefer deterministic fixture-driven tests for contracts, CLI artifacts, and runtime logic.
- Keep browser tests focused on user-visible behavior and served-page integration.
- Keep domain invariants and serialization rules outside browser-only coverage.
- Favor narrow helpers and recipes over large custom test abstractions.
- Prefer generated or scripted migration edits over hand refactors.
- Keep test file ownership clear by suite and recipe type.
- Avoid introducing framework-specific mocking unless the current test semantics require it.

## Workstreams

### W1 - Inventory And Classification
- Size band: S
- Outcome:
  - full inventory of all test files
  - classification by runner target, recipe type, and migration risk
  - gap report for files currently missed by the default script
- Deliverables:
  - `local-codex/test-inventory.json`
  - `local-codex/test-classification.md`
  - generated list of `node:test` patterns in use
- Scripts:
  - `scripts/testing/inventory-tests.mjs`
  - `scripts/testing/classify-tests.mjs`
- Success criteria:
  1. Every existing test file is classified as `vitest`, `playwright`, or `hold`.
  2. Every file is tagged with a recipe family.
  3. The default-script mismatch for `*.test.mjs` and any other uncovered patterns is explicitly recorded.

### W2 - Runner Foundations
- Size band: S
- Outcome:
  - Vitest and Playwright coexist cleanly.
  - package scripts expose stable suite entry points.
  - current discovery gaps are closed.
- Target files:
  - `package.json`
  - `vitest.config.*`
  - `playwright.config.*`
  - `scripts/testing/*.mjs`
- Scripts:
  - `scripts/testing/run-vitest.mjs`
  - `scripts/testing/run-playwright.mjs`
  - `scripts/testing/test-matrix.mjs`
- Success criteria:
  1. There is one canonical Vitest entry point for Node-side suites.
  2. There is one canonical Playwright entry point for browser-native suites.
  3. There is one top-level dispatch script that can run `all`, `vitest`, `playwright`, or named suite subsets.
  4. The runner split is encoded in config, not improvised in agent prompts.

### W3 - Scripted Migration Of Existing Tests
- Size band: M
- Outcome:
  - existing `node:test` files are migrated mechanically where possible
  - logic and assertions remain unchanged
  - manual edits are reserved for edge cases only
- Strategy:
  - codemod first, hand-edit second
  - preserve file names where possible
  - preserve helper usage unless helpers themselves need runner shims
- Scripts:
  - `scripts/testing/codemod-node-test-to-vitest.mjs`
  - `scripts/testing/codemod-test-imports.mjs`
  - `scripts/testing/codemod-assert-helpers.mjs`
  - `scripts/testing/report-codemod-exceptions.mjs`
- Expected transforms:
  - `const test = require("node:test")` -> Vitest-compatible imports
  - `describe/it/test` normalization
  - preserve `node:assert/strict` or replace selectively only when needed
  - retain process spawning, tempdir, fixture, and artifact assertions
- Success criteria:
  1. The majority of Node-side tests migrate through codemods.
  2. A machine-generated exception list identifies files needing manual follow-up.
  3. No test is semantically rewritten just to match runner idioms.

### W4 - Playwright Browser Suite Consolidation
- Size band: M
- Outcome:
  - browser-native tests are moved to first-class Playwright coverage
  - current served-UI and `playwright-cli` style flows are normalized
- Target areas:
  - `tests/ui-web/**`
  - browser-dependent integration tests
  - served UI script tests
- Scripts:
  - `scripts/testing/find-browser-dependent-tests.mjs`
  - `scripts/testing/codemod-playwright-cli-to-playwright-test.mjs`
- Success criteria:
  1. Browser tests no longer depend on ad hoc shell usage where a Playwright test can own the flow.
  2. Served-page tests share common Playwright fixtures for server startup and teardown.
  3. Browser assertions remain behavior-first and do not absorb backend/domain logic.

### W5 - Shared Test Helpers And Recipe Templates
- Size band: S
- Outcome:
  - recurring patterns are formalized as helpers and templates
  - future test authoring becomes consistent and cheaper
- Target files:
  - `tests/helpers/**`
  - `tests/recipes/**` or `tools/test-recipes/**`
  - generator templates under `scripts/testing/templates/**`
- Initial recipe families:
  - `cli_success_artifacts`
  - `cli_failure_message`
  - `manifest_bundle_consistency`
  - `artifact_schema_roundtrip`
  - `wasm_effect_contract`
  - `runtime_persona_transition`
  - `ui_cli_equivalence`
  - `serve_ui_redirect_health`
  - `browser_bundle_load_flow`
- Success criteria:
  1. At least the top 8 to 10 recurring test shapes are encoded as templates.
  2. Helpers reduce duplication without hiding test intent.
  3. Templates are stable enough for MCP-driven scaffolding.

### W6 - Custom Test Harness MCP
- Size band: M
- Outcome:
  - agents stop treating tests as raw text generation tasks
  - test creation and execution become structured tool calls
- Proposed package:
  - `packages/adapters-cli/src/mcp/test-harness-server.mjs` or a sibling MCP package
- Initial MCP tools:
  - `test_list_suites`
  - `test_discover_patterns`
  - `test_plan_from_change`
  - `test_scaffold_case`
  - `test_insert_case`
  - `test_run`
  - `test_explain_failure`
  - `test_lint_structure`
- Tool behavior:
  - choose Vitest vs Playwright by recipe and target
  - render tests from templates
  - insert into the right file or scaffold a new file
  - return normalized failure JSON rather than only raw stdout
- Success criteria:
  1. Claude Code and Codex can ask for a test by recipe rather than hand-writing it.
  2. The MCP can run narrow scopes deterministically.
  3. Failure output is structured enough for agents to reason over without log scraping.

### W7 - Shared Skill For Claude Code And Codex
- Size band: S
- Outcome:
  - one skill file teaches both harnesses how to use the MCP
  - agent behavior becomes consistent across tools
- Deliverables:
  - new skill in `$CODEX_HOME/skills` and mirrored repo-local reference doc if desired
  - Claude-facing instructions for the same MCP workflow
- Skill contract:
  - prefer `test_discover_patterns` before authoring a new test
  - prefer `test_scaffold_case` over freehand test generation
  - prefer `test_run` on the smallest relevant scope
  - use Playwright only for browser-native behavior
  - keep domain and contract tests in Vitest
  - do not rewrite existing assertions unless preserving semantics requires it
- Success criteria:
  1. The same recipe vocabulary works for Claude Code and Codex.
  2. The skill explicitly discourages raw-text test invention when a recipe exists.
  3. The skill documents escalation paths when no recipe fits.

### W8 - Validation, Parity, And Cleanup
- Size band: S
- Outcome:
  - old and new harnesses are compared during transition
  - migration closes only when parity is proven
- Scripts:
  - `scripts/testing/compare-old-vs-new-results.mjs`
  - `scripts/testing/check-runner-coverage.mjs`
  - `scripts/testing/check-test-recipe-adoption.mjs`
- Success criteria:
  1. Old vs new runner results are compared suite-by-suite during migration.
  2. Every existing test has a runner owner and a recipe family by the time the old path is retired.
  3. Redundant wrapper scripts and dead helpers are removed only after parity is proven.

## Milestone Order
- `W1 -> W2`
- `W2 -> W3`
- `W2 -> W4`
- `W3 -> W5`
- `W4 -> W5`
- `W5 -> W6`
- `W6 -> W7`
- `W3 -> W8`
- `W4 -> W8`
- `W6 -> W8`
- `W7 -> W8`

## Suggested Execution Milestones

### M1 - Inventory And Runner Baseline
- Workstreams: `W1`, `W2`
- Stop condition:
  - all test files classified
  - Vitest and Playwright configs exist
  - package scripts expose the new runner split

### M2 - Scripted Node-Side Migration
- Workstreams: `W3`
- Stop condition:
  - codemods migrate the bulk of Node-side tests
  - exception list for manual follow-up is generated
  - semantic parity spot-checks pass

### M3 - Browser Suite Consolidation
- Workstreams: `W4`
- Stop condition:
  - browser-native tests run under Playwright
  - served UI and browser flows use common fixtures
  - ad hoc Playwright shell usage is reduced to bounded exceptions

### M4 - Recipe Layer
- Workstreams: `W5`
- Stop condition:
  - top test shapes exist as helpers/templates
  - future authoring can use structured recipes instead of freeform prose

### M5 - MCP And Skill Delivery
- Workstreams: `W6`, `W7`
- Stop condition:
  - MCP runs and scaffolds tests
  - Claude Code and Codex can both use the same skill guidance

### M6 - Parity Closure And Retirement
- Workstreams: `W8`
- Stop condition:
  - parity report recorded
  - old default path retired or explicitly retained only for bounded compatibility reasons

## Script-First Refactor Inventory
- `scripts/testing/inventory-tests.mjs`
- `scripts/testing/classify-tests.mjs`
- `scripts/testing/run-vitest.mjs`
- `scripts/testing/run-playwright.mjs`
- `scripts/testing/test-matrix.mjs`
- `scripts/testing/codemod-node-test-to-vitest.mjs`
- `scripts/testing/codemod-test-imports.mjs`
- `scripts/testing/codemod-assert-helpers.mjs`
- `scripts/testing/report-codemod-exceptions.mjs`
- `scripts/testing/find-browser-dependent-tests.mjs`
- `scripts/testing/codemod-playwright-cli-to-playwright-test.mjs`
- `scripts/testing/compare-old-vs-new-results.mjs`
- `scripts/testing/check-runner-coverage.mjs`
- `scripts/testing/check-test-recipe-adoption.mjs`

## Validation Gates
- Inventory:
  - classification output covers every file under `tests/**`
- Runner baseline:
  - Vitest suite entry runs
  - Playwright suite entry runs
  - mixed `*.test.js` and `*.test.mjs` coverage is explicit
- Migration:
  - old Node test results vs Vitest results are compared on representative suites
  - browser-native tests pass under Playwright
- MCP:
  - scaffold one test per major recipe family
  - run targeted scopes
  - return normalized failure payloads
- Skill:
  - prove a Claude Code flow and a Codex flow can both author or update a test via MCP

## Acceptance Criteria
1. Vitest is the primary runner for Node-side tests.
2. Playwright is the canonical runner for browser-native tests.
3. Existing test logic is preserved during migration.
4. The majority of repetitive test refactoring is executed by repo scripts, not manual edits.
5. A custom MCP can discover patterns, scaffold tests, run targeted suites, and explain failures.
6. A shared skill exists for Claude Code and Codex and steers both away from raw-text test invention.
7. Backend and domain tests remain for invariants, contracts, and deterministic logic; Playwright does not replace them.

## Risks
- Some `node:test` semantics may not codemod cleanly into Vitest in one pass.
- Browser-dependent tests may be mixed with Node-only tests and need manual classification.
- A few served-UI tests may rely on sandboxed port behavior and need environment-aware fixtures.
- If helpers become too abstract, the suite could become harder to debug even if easier to generate.

## Open Items
- No blocking plan items remain open for the current test-harness rollout.
- Resolved: the MCP lives inside the existing CLI MCP server.
- Resolved: recipe scaffolds currently live in the MCP tool implementation plus `scripts/testing/recipe-catalog.mjs`; an external template directory is not required for the current catalog.
- Resolved: legacy compatibility remains available temporarily through `pnpm run test:legacy` while parity checks stay in place.
