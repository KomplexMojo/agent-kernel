# Tests README

> **Scope:** this file covers the unit and integration test suite only (`pnpm run test`, Vitest). Tests verify code correctness against deterministic fixtures. For LLM tool-call permutation and stress testing, see the benchmark harness at `tools/remote-ollama-control/` and the `run-content-gen` command documented in `CLAUDE.md → Benchmark commands`.

This file is the entry point for **low-complexity test work** delegated to a local model, typically Ollama launched through the Claude Code harness.

## Mental Model

The test suite protects deterministic behavior. Tests should prove that artifact contracts, adapters, runtime personas, UI surfaces, and `core-ts` rules behave as specified against stable fixtures.

Benchmarks are separate. They measure LLM tool-call quality and stress behavior; they do not replace correctness tests.

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

## Where Tests Live

- `tests/core-ts/`: pure deterministic core behavior.
- `tests/runtime/` and `tests/personas/`: runtime contracts, command kernel behavior, persona transitions.
- `tests/adapters-cli/`, `tests/adapters-web/`, `tests/adapters-test/`: adapter-level behavior.
- `tests/integration/`: cross-package and MCP/CLI/UI flows.
- `tests/ui-web/`: browser/UI behavior, fixture-backed and headless.
- `tests/fixtures/`: shared deterministic input and expected-output artifacts.

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
- Use `pnpm run test` for the default Node-side suite.

## Recipe-First Mapping

Prefer these recipe families before free-form authoring:

- `artifact_schema_roundtrip`
- `cli_success_artifacts`
- `manifest_bundle_consistency`
- `adapter_port_contract`
- `budget_policy_invariant`
- `runtime_module_contract`
- `runtime_persona_transition`
- `serve_ui_redirect_health`

Every cataloged recipe family has scaffold support except `browser_bundle_load_flow`,
which needs a real browser and lost its generator with the Playwright subsystem.

For the rarest family, keep the scaffold narrow and pattern-matched:

- `ui_cli_equivalence`

## Why Tests Are Skipped

`pnpm run test` reports skips from several sources. They are **not one backlog**, and the
distinction matters before you "fix" any of them. Re-audited 2026-08-14: the bounded
`augmented-tests` pass replaced 39 empty skip call sites with 18 concrete matrix/edge tests
or existing equivalent coverage. The 14 plausible body-carrying candidates were executed;
all still failed for identifiable product gaps, so none was a stale disabled regression.

The post-audit source inventory is 178 explicit `.skip` call sites: 139 empty permutation
placeholders and 39 body-carrying/control call sites. Vitest reports 184 skipped tests because
the disabled Cmd+Arrow suite contains eight cases while the zero-backlog generated authority
loop contributes no runtime cases.

| Kind | Looks like | What to do |
|---|---|---|
| **Unwritten permutation stubs** (the large majority) | `test.skip("name", () => {});` — **empty body** | Nothing manual. These are named permutations awaiting `/local-test-gen`; the file also carries a `## TODO: Test Permutations` marker. Un-skipping one creates a **vacuously passing empty test**. |
| **Aspirational tests** | `test.skip(...)` with a **real body**, tagged `// STAYS SKIPPED — …` | Leave until the behavior exists. These describe features the code does not implement (patrolling routes, `user_controlled` motivation, `resource_captured`/`hazard_triggered` frame events, a defeated-actor gate). They were added **already skipped** in `d1a2b6e2`, so none of them is a disabled regression. |
| **G1 authority backlog** | generated `test.skip` in `tests/architecture/persona-authority.test.js` | Leave. One skip per *unowned* persona behavior, each naming the finding that blocks it (DECISION D-k). The count IS the backlog metric — it drops when a finding closes, not when someone enables a test. |
| **Opt-in external integration** | a running test calls `t.skip(...)` unless its explicit environment flag is set | Leave out of the deterministic default suite. `e2e-llm-live-runtime.test.js` requires `AK_LLM_LIVE=1` and a configured live provider. |

**If you skip a test, say why on the line above it.** Every skip added from 2026-08-01
carries a `// STAYS SKIPPED — <reason> (checked <date>)` comment. Before that they were
bare, and reconstructing the reasons required running all 54 body-carrying skips to see
which failed — 40 did, 14 were passing coverage that had simply been switched off and
were enabled. An unexplained skip costs someone that whole exercise.

## Permutation Expansion Rules

When generating permutations, stay **bounded and explainable**.

## Core Game Domain Contract

Generated tests must start from these canonical game concepts. Do not invent
new names just because a local helper currently tolerates them.

- Affinity kinds are only: `fire`, `water`, `earth`, `wind`, `life`,
  `decay`, `corrode`, `fortify`, `light`, `dark`.
- Affinity expressions are only: `push`, `pull`, `emit`, `draw`.
- Affinity stacks are positive integer strength counts attached to an
  affinity kind/expression pair. Effect strength, including Emit field
  strength, comes from stacks. Do not add separate strength fields such as
  `emitStrength`.
- Motivation kinds are grouped by family:
  - mobility: `random`, `stationary`, `exploring`, `patrolling`
  - posture: `attacking`, `defending`, `stealthy`, `friendly`
  - cognition: `reflexive`, `goal_oriented`, `strategy_focused`
  - control: `user_controlled`
- Motivations in the same exclusive family conflict. Cross-family motivations
  compose.
- Tests may use only fields present in versioned artifact contracts or existing
  deterministic fixtures. If current implementation accepts an invented field
  or value, write the test against the contract and surface implementation drift.

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
- Vitest is the only runner; there is no second runner to migrate a test to.
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

- prefer an existing fixture-backed suite under `tests/ui-web/`
- use the serve-ui helper flow when the page must be live
- assert visible behavior, not internal implementation details
