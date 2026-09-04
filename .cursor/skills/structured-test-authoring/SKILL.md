---
name: structured-test-authoring
description: >-
  Author or scaffold agent-kernel tests via the agent-kernel-cli MCP (`ak_test_*`)
  before hand-writing cases. Use when adding tests, expanding coverage, migrating
  a test to an existing recipe, or when the user asks for structured test authoring.
---

# Structured Test Authoring (Cursor)

Use the **agent-kernel-cli** MCP test tools before writing or running tests manually.
Canonical source of the same recipe: `.claude/skills/structured-test-authoring/SKILL.md`.

## Preconditions

1. **agent-kernel-cli MCP is connected** in this session (Customize → MCPs). Namespace is typically
   `project-0-agent-kernel-agent-kernel-cli`. If tools are missing, copy `.cursor/mcp.example.json`
   into `.cursor/mcp.json`, restart Cursor, and enable the server.
2. Prefer MCP `CallMcpTool` / dynamic tool calls over shelling out to `ak.mjs` for these flows.

## Rules

- Prefer `ak_test_list_suites` and `ak_test_discover_patterns` before authoring a new test.
- Prefer `ak_test_scaffold_case` over freehand test creation when the recipe fits.
- Prefer `ak_test_run` on the narrowest relevant mode first.
- Use Vitest-backed suites for contracts, runtime logic, CLI flows, and non-browser integrations.
- Use fixture-backed Vitest suites under `tests/ui-web/` for browser-facing and served-page
  behavior; there is no browser-native runner.
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

If no recipe fits, inspect nearby tests, match the nearest existing structure, and keep the new
test narrow. Read `tests/README.md` before inventing a new pattern.
