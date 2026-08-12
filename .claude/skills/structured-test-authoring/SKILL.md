# Structured Test Authoring

Use the agent-kernel MCP test tools before writing or running tests manually.

## Rules
- Prefer `ak_test_list_suites` and `ak_test_discover_patterns` before authoring a new test.
- Prefer `ak_test_scaffold_case` over freehand test creation when the recipe fits.
- Prefer `ak_test_run` on the narrowest relevant mode first.
- Use Vitest-backed suites for contracts, runtime logic, CLI flows, WASM, and non-browser integrations.
- Use Playwright-backed suites for browser-native and served-page behavior.
- Do not replace domain or contract tests with UI-only tests.
- Preserve existing assertion meaning when migrating tests.

## Initial Recipes
- `cli_success_artifacts`
- `serve_ui_redirect_health`

## Typical Flow
1. `ak_test_list_suites`
2. `ak_test_discover_patterns`
3. `ak_test_scaffold_case` if a supported recipe fits
4. `ak_test_run`

## Fallback
- If no recipe fits, inspect nearby tests, match the nearest existing structure, and keep the new test narrow.
