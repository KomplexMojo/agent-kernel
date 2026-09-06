---
name: structured-test-authoring
description: Use when authoring, scaffolding, or locating a test in agent-kernel — reach for the ak_test_* MCP tools and an existing recipe before hand-writing a file. Do not use for diagnosing a failing suite (tiered-test-optimizer), expanding `## TODO: Test Permutations` stubs (local-test-gen), or deciding what behavior a persona should have (persona-*).
---

# Structured Test Authoring

Use the agent-kernel MCP test tools before writing or running tests manually.

## Rules
- Prefer `ak_test_list_suites` and `ak_test_discover_patterns` before authoring a new test.
- Prefer `ak_test_scaffold_case` over freehand test creation when the recipe fits.
- Prefer `ak_test_run` on the narrowest relevant mode first.
- Use Vitest-backed suites for contracts, runtime logic, CLI flows, WASM, and non-browser integrations.
- Use fixture-backed Vitest suites under `tests/ui-web/` for browser-facing and served-page behavior; there is no browser-native runner.
- Do not replace domain or contract tests with UI-only tests.
- Preserve existing assertion meaning when migrating tests.

## Recipes

`scripts/testing/recipe-catalog.mjs` is the authority — read it rather than a list here, which
goes stale silently. This section named two recipes when eleven existed, which is worse than
naming none: it reads as "these are your options".

`ak_test_scaffold_case` only supports the subset in `SCAFFOLDABLE_RECIPES`
(`packages/adapters-cli/src/mcp/tools/testing.mjs`); the rest are detection-only, so a recipe
being in the catalog does not mean it can be scaffolded.

## Typical Flow
1. `ak_test_list_suites`
2. `ak_test_discover_patterns`
3. `ak_test_scaffold_case` if a supported recipe fits
4. `ak_test_run`

## Fallback
- If no recipe fits, inspect nearby tests, match the nearest existing structure, and keep the new test narrow.
