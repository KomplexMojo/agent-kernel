---
name: local-test-gen
description: Generate and evaluate test permutations using an Ollama model reachable locally or through a remote SSH tunnel. Scans for ## TODO: Test Permutations sections, generates concrete test cases, runs the narrow suite, and iterates until generated tests are syntactically valid, runner-correct, passing, and useful. No MCP tools required — uses filesystem + Ollama API + shell only.
compatibility: Requires Node.js 18+, pnpm for Vitest projects, and an Ollama-compatible endpoint reachable via OLLAMA_HOST or localhost:11434 with at least one model loaded
trigger: /local-test-gen
---

## Purpose

Expand `## TODO: Test Permutations` stubs in test files into concrete, runnable test cases using whatever model is currently loaded in Ollama. The model is auto-detected at startup via `/api/ps` (warm/running models) with a fallback to `/api/tags` (first installed model). Override with `--model <name>` when needed.

This skill is also the preferred harness for **model evaluation** when comparing local or remote Ollama models for test generation quality. A successful model run means the generated tests are kept only after the target file passes its narrow test command.

**Use this skill when:**
- A test file ends with a `## TODO: Test Permutations` section containing plain-language stub descriptions
- You want to expand permutations locally without spending cloud tokens
- You want to compare local or remote Ollama models for test-generation quality
- You are on a machine with Ollama running `qwen3-coder:30b`, `qwen3-coder:30b-a3b-q4_K_M`, or another candidate model

**Do NOT use this skill for:**
- Architecture decisions
- Changing production code
- Integration tests that require live external services
- Tests requiring deep FSM or adapter reasoning

---

## Prerequisites

1. Ollama is running: `ollama serve`
2. At least one model is loaded in Ollama (the script picks the currently warm one automatically)
3. You are in the repo root (where `tests/` exists and `pnpm` is available)
4. For remote hardware through SSH, run through `remote-ollama-mac run-local` or set `OLLAMA_HOST` to the active tunnel endpoint
5. For this repo, prefer the remote dual profile for 30B-class models

---

## How to Run

```bash
node ~/.claude/skills/local-test-gen/scripts/main.mjs
```

Optional flags:
- `--file tests/path/to/file.test.js` — process one specific file only
- `--dry-run` — print what would be generated without writing or running anything
- `--model qwen3-coder:7b` — override the model (default: qwen3-coder:30b-a3b-q4_K_M)
- `--ollama-host http://127.0.0.1:21436` — override `OLLAMA_HOST`
- `--ollama-timeout-ms 1800000` — override the request timeout
- `--runner auto|vitest|node` — choose the narrow test runner (`auto` prefers Vitest when the repo has Vitest config)
- `--max-iterations 5` — override retry count
- `--num-ctx 65536` — pass Ollama `num_ctx` for long-context remote profiles
- `--num-predict 8192` — pass Ollama `num_predict` for larger generated/refined outputs
- `--temperature 0.2` — pass Ollama temperature
- `--reasoning-mode direct|plan-code` — use one direct code call or a plan pass followed by a code pass (`plan-code` is the default in eval mode)
- `--source-context auto|off` — include local implementation files imported by the target test, or disable source context
- `--source-char-budget 16000` — cap imported implementation source context
- `--eval-run` — write a structured JSON model-evaluation report
- `--eval-output test-gen-eval.json` — choose the JSON evaluation report path
- `--keep-failing-logic` — keep syntactically valid failing tests for application-bug triage; omit this for model evaluation

Remote dual-GPU example from the repo root:

```bash
./tools/remote-ollama-control/bin/remote-ollama-mac run-local \
  --profile dual \
  --model qwen3-coder:30b-a3b-q4_K_M \
  --route external \
  --external-host 207.6.34.73 \
  -- node ~/.claude/skills/local-test-gen/scripts/main.mjs --model qwen3-coder:30b-a3b-q4_K_M
```

Model-evaluation example against one target file:

```bash
./tools/remote-ollama-control/bin/remote-ollama-mac run-local \
  --profile dual \
  --model qwen3-coder:30b \
  --route external \
  --external-host 207.6.34.73 \
  -- node ~/.claude/skills/local-test-gen/scripts/main.mjs \
    --model qwen3-coder:30b \
    --file tests/ui-web/tile-affinity-visuals.test.mjs \
    --runner auto \
    --max-iterations 5 \
    --num-ctx 65536 \
    --num-predict 8192 \
    --reasoning-mode plan-code \
    --source-context auto \
    --source-char-budget 16000 \
    --eval-run \
    --eval-output tools/remote-ollama-control/results/qwen3-coder-30b-test-gen-eval.json
```

---

## What the Script Does

1. **Scan** — finds all `*.test.js` and `*.test.mjs` files under `tests/` that contain a `## TODO: Test Permutations` section
2. **Plan** — extracts the stub bullet points from each file's TODO section
3. **Baseline** — runs the target file before generation and skips files with pre-existing failures
4. **Source context** — includes local implementation files imported by the target test, capped by `--source-char-budget`
5. **Reasoning pass** — in `plan-code` mode, asks the model for a concise per-stub contract plan before generating code
6. **Generate** — sends each file's existing tests, source context, stubs, and optional plan to the selected model, asking it to produce concrete test cases for every stub
7. **Static check** — rejects generated code with markdown fences, imports, leftover TODOs, too few test blocks, or unbalanced block comments
8. **Insert** — writes the generated tests into the file, replacing the TODO section, including block-comment TODO wrappers
9. **Run** — executes each modified file with the selected runner:
   - `auto` → Vitest when the repo has Vitest config or the file is `.mjs`; Node test runner otherwise
   - `vitest` → `pnpm exec vitest run <file>`
   - `node` → `node --test <file>`
10. **Refine** — sends the previous failure output and generated code back to the model and retries until the narrow test passes or iterations are exhausted
11. **Rollback** — by default, restores the original file if generated tests never pass
12. **Report** — writes a `test-gen-report.md` to the repo root with per-file results
13. **Evaluate** — when `--eval-run` is set, writes a JSON report with pass rate, iterations, failure classes, generated test count, prompt/source metrics, model profile settings, rollback/kept status, and human-review markers

For model evaluation, do **not** pass `--keep-failing-logic`; passing generated tests are the comparable success condition. Use `--keep-failing-logic` only when the explicit goal is to preserve failing tests as suspected product bug repros.

---

## TODO Section Format

The script looks for a line matching:
```
// ## TODO: Test Permutations
```
or
```
## TODO: Test Permutations
```

It also handles TODO sections wrapped in a block comment:

```js
/*
## TODO: Test Permutations
- edge case
*/
```

Everything after that line (until end of file) is treated as stub descriptions. Example:

```js
// ## TODO: Test Permutations
// - scenarioSpendReport.categories.hazards.actual = NaN (should fail)
// - receipt with shared_system.actual = 0 (valid — zero spend is legitimate)
// - receipt where floor_tiles.usagePercent > 100 (valid — over-budget per category is allowed)
```

---

## Output

- Console: live progress per file
- `test-gen-report.md` in repo root: summary table with pass/fail/error-type per stub
- `test-gen-eval.json` or `--eval-output <path>` when `--eval-run` is set: structured model-evaluation data
- Original files are restored on rollback if all iterations fail

Evaluation JSON includes:
- `model`, `ollamaHost`, `modelProfile` (`numCtx`, `numPredict`, `temperature`, `reasoningMode`, source-context settings)
- summary pass rate, total/average iterations, prompt size, failure classes, and human-review count
- per-file stubs, runner, baseline status, source files included, kept/rolled-back status, generated test blocks
- per-attempt plan/code prompt size, generated character count, test-block count, static validation failures, error class, and snippet

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Connection refused localhost:11434` | Run `ollama serve` |
| `Cannot detect Ollama model` | Load a model first (`ollama run <name>`), or pass `--model <name>` |
| Generated code has syntax errors | The model will auto-iterate up to 5 times; if still failing, make stubs more explicit |
| `.test.js` fails with `test is not defined` | Use `--runner vitest`, or leave `--runner auto` in a Vitest repo |
| Test fails with "module not found" | The model added an import — the script will retry with an instruction to avoid new imports |
| Generated tests fail but look syntactically valid | The script rolls back by default; inspect `test-gen.log`, then rerun the same model/target or try a stronger model |
| pnpm not found | Run `npm install -g pnpm` or use `npx pnpm` |

---

## When Claude Invokes This Skill

Claude runs the script, monitors output, reads `test-gen-report.md` when done, and reports:
- How many stubs were expanded
- Which tests passed, failed with syntax errors, and failed with application-code issues
- The specific failing test names and error snippets for application-code failures

Claude does NOT fix production code during this skill run. It may correct generated-test expectations only when the existing implementation and earlier tests clearly establish the contract. For model evaluation, record whether any human correction was required.
