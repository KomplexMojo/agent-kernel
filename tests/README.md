# Tests README

This file is the entry point for **low-complexity test work** delegated to a local model, typically Ollama launched through the Claude Code harness.

The goal is not to invent tests from raw prose. The goal is to:

1. discover an existing test pattern
2. generate bounded permutations around that pattern
3. use the MCP to scaffold or extend tests
4. run the smallest useful scope
5. hand back concrete failures or a patch

## Who Should Use This

- Ollama or another local/cheap model running through the Claude harness
- Claude Code when delegating low-risk test expansion work
- Codex when it needs a repo-local test authoring reference

## Default Rule

**Use the MCP first.**

Do not start by writing free-form tests.
Do not start by grepping for examples.
Do not brute-force the entire repo.

Start from the existing structured tools:

- `ak_test_list_suites`
- `ak_test_discover_patterns`
- `ak_test_plan_from_change`
- `ak_test_scaffold_case`
- `ak_test_insert_case`
- `ak_test_run`
- `ak_test_explain_failure`
- `ak_test_lint_structure`

## What The Local Model Is Good At

Use the local model for:

- expanding `## TODO: Test Permutations` stubs
- generating bounded CLI option permutations
- generating negative/edge-case variants around an existing validated pattern
- filling out repetitive test matrices once the recipe is known
- summarizing failure clusters from a narrow test run

Do not use the local model for:

- architecture decisions
- deciding package boundaries
- changing production code structure
- inventing new test frameworks or harnesses
- broad unbounded fuzzing across all CLI flags

## Canonical Flow

1. Read `AGENTS.md`, `CLAUDE.md`, and this file.
2. Run `ak_test_discover_patterns` for the target area.
3. If a scaffoldable recipe exists, use `ak_test_scaffold_case` or `ak_test_insert_case`.
4. If the work is a permutation expansion, extend an existing file rather than creating a brand new style.
5. Run `ak_test_run` on the narrowest relevant scope.
6. If failures occur, use `ak_test_explain_failure`.
7. Return:
   - the file changed
   - the permutation cases added
   - the command run
   - the failure summary or pass result

## Runner Rules

- Use `Vitest` for Node-side tests.
- Use `Playwright` for browser-native tests.
- Use `pnpm run test` for the default Node-side suite.
- Use `pnpm run test:playwright -- <spec>` for browser-native specs.

## Recipe-First Mapping

Prefer these recipe families before free-form authoring:

- `artifact_schema_roundtrip`
- `cli_success_artifacts`
- `manifest_bundle_consistency`
- `adapter_port_contract`
- `budget_policy_invariant`
- `runtime_module_contract`
- `runtime_persona_transition`
- `wasm_effect_contract`
- `browser_bundle_load_flow`
- `serve_ui_redirect_health`

All current cataloged recipe families now have scaffold support.

For the rarest families, keep the scaffolds narrow and pattern-matched:

- `ui_cli_equivalence`
- `perf_harness_smoke`

## Permutation Expansion Rules

When generating permutations, stay **bounded and explainable**.

Good:

- missing required CLI arg
- invalid enum value
- empty payload
- one valid value vs one invalid value
- minimum / maximum / zero / duplicate inputs
- one fixture per schema version edge

Bad:

- every possible combination of every CLI flag
- random values with no reduction strategy
- huge matrices that are slow, flaky, or hard to review

## CLI Permutation Guidance

For CLI permutation work:

1. start from an existing `tests/adapters-cli/*.test.js` pattern
2. keep the matrix small and intentional
3. prefer one command family at a time
4. capture expected exit status and expected stderr/stdout assertions
5. stop when new cases stop exercising distinct behavior

Recommended bounded matrix dimensions:

- required vs omitted arg
- valid vs invalid enum
- single vs duplicate option
- dry-run vs write-output
- fixture path exists vs fixture path missing

## MCP-Backed Local Model Workflow

The local model should use the MCP to build tests, not just suggest them.

Preferred workflow:

1. `ak_test_discover_patterns`
2. `ak_test_scaffold_case` or `ak_test_insert_case`
3. `ak_test_run`
4. `ak_test_explain_failure`

If no scaffold exists:

1. choose the closest existing file
2. add only permutation cases that match that file's style
3. avoid introducing a new helper or abstraction

## Output Contract For Delegated Test Work

When the local model finishes, it should report:

- `target file`
- `recipe family`
- `permutations added`
- `runner used`
- `command run`
- `result`
- `follow-up needed` if any

## Safety Rails

- Never modify production code during low-complexity test delegation.
- Never reclassify runner ownership on your own.
- Never migrate a test between Vitest and Playwright unless explicitly asked.
- Never replace a broad suite run for a narrow delegated task.
- Never silently delete an existing assertion.

## Minimal Examples

### Example: expand TODO stubs

- read the target test file
- convert each `## TODO: Test Permutations` bullet into one concrete test
- preserve the file's assertion style
- run only that file

### Example: bounded CLI permutation pass

- start from an existing CLI success/failure test
- add 3 to 6 cases around one command
- verify exit codes and message text
- stop after distinct failure classes are covered

### Example: browser-native case

- prefer an existing Playwright spec under `tests/playwright/`
- use the serve-ui helper flow when the page must be live
- assert visible behavior, not internal implementation details
