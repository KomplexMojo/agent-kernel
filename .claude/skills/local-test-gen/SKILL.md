---
name: local-test-gen
description: Generate and evaluate test permutations using an Ollama model reachable locally or via remote SSH tunnel. Scans for ## TODO: Test Permutations sections, generates concrete test cases, runs the narrow suite, and iterates until the tests are syntactically valid, runner-correct, passing, and useful. No MCP tools — filesystem + Ollama API + shell only.
compatibility: Node.js 18+, pnpm (for Vitest projects), and an Ollama-compatible endpoint at OLLAMA_HOST or localhost:11434 with at least one model loaded.
trigger: /local-test-gen
---

## Purpose

Expand `## TODO: Test Permutations` stubs in test files into concrete, runnable tests using whatever model is loaded in Ollama. The model is **auto-detected** at startup — `/api/ps` (warm models) with a fallback to `/api/tags` (first installed) — so you rarely name one; override with `--model <name>` only when needed. This is also the preferred harness for **model evaluation**: generated tests are kept only after the target file passes its narrow test command.

**Use when** a test file ends with a `## TODO: Test Permutations` section of plain-language stubs and you want to expand them locally (no cloud tokens), or to compare Ollama models for test-gen quality.

**Do NOT use for** architecture decisions, production-code changes, integration tests needing live services, or tests requiring deep FSM/adapter reasoning.

## Prerequisites

1. Ollama running (`ollama serve`) with at least one model loaded — the script picks the warm one.
2. Run from repo root (where `tests/` exists and `pnpm` is available).
3. For remote hardware, go through `remote-ollama-mac run-local` or set `OLLAMA_HOST` to the tunnel endpoint; prefer the **dual** profile for 30B-class models.
4. The script injects `tests/README.md` as the game-domain contract — keep it current.

## How to Run

```bash
node ~/.claude/skills/local-test-gen/scripts/main.mjs
```

Flags:
- `--file <path>` — process one file only · `--dry-run` — show planned work, write nothing
- `--model <name>` — override auto-detection · `--ollama-host <url>` · `--ollama-timeout-ms <n>`
- `--runner auto|vitest|node` — `auto` prefers Vitest when the repo has Vitest config
- `--max-iterations 5` — retry count · `--temperature 0.2`
- `--num-ctx <n>` / `--num-predict <n>` — Ollama context / output budget for long remote profiles
- `--reasoning-mode direct|plan-code` — one code pass, or a plan pass then a code pass (`plan-code` is the eval-mode default)
- `--source-context auto|off` / `--source-char-budget 16000` — include (and cap) implementation files imported by the target test
- `--eval-run` / `--eval-output <path>` — write a structured JSON model-evaluation report
- `--keep-failing-logic` — keep syntactically valid failing tests for application-bug triage; **omit for model evaluation**

Remote dual-GPU run, and model-evaluation against one file:

```bash
./tools/remote-ollama-control/bin/remote-ollama-mac run-local \
  --profile dual --model <ollama-model> --route external --external-host <wan-host-or-ip> \
  -- node ~/.claude/skills/local-test-gen/scripts/main.mjs --model <ollama-model>

./tools/remote-ollama-control/bin/remote-ollama-mac run-local \
  --profile dual --model <ollama-model> --route external --external-host <wan-host-or-ip> \
  -- node ~/.claude/skills/local-test-gen/scripts/main.mjs \
     --model <ollama-model> --file tests/ui-web/tile-affinity-visuals.test.mjs \
     --runner auto --max-iterations 5 --num-ctx 65536 --num-predict 8192 \
     --reasoning-mode plan-code --source-context auto --source-char-budget 16000 \
     --eval-run --eval-output tools/remote-ollama-control/results/test-gen-eval.json
```

## What the Script Does

1. **Scan** `tests/**/*.test.{js,mjs}` for files with a `## TODO: Test Permutations` section, and extract the stub bullets.
2. **Baseline** — run the target before generation; skip files with pre-existing failures.
3. **Context** — inject `tests/README.md` (affinity kinds, expressions, stacks, motivations) plus, optionally, the implementation files the test imports (capped by `--source-char-budget`).
4. **Generate** — in `plan-code` mode, request a per-stub contract plan first, then send existing tests + context + stubs and ask for concrete cases per stub.
5. **Static check** — reject output with markdown fences, imports, leftover TODOs, too few test blocks, unbalanced block comments, invented affinity concepts, invalid expressions/motivations, or forbidden scalar fields (e.g. `emitStrength`).
6. **Insert & run** — replace the TODO section, then run the file: `auto` → Vitest when the repo has Vitest config or the file is `.mjs`, else `node --test`.
7. **Refine** — feed failure output back to the model and retry until the narrow test passes or `--max-iterations` is hit.
8. **Rollback** — restore the original file if generated tests never pass (unless `--keep-failing-logic`).
9. **Report** — write `test-gen-report.md` (per-file results); with `--eval-run`, also a JSON report (pass rate, iterations, failure classes, test count, prompt/source metrics, model profile, rollback/kept status, review markers).

For model evaluation, passing tests are the comparable success condition — do not pass `--keep-failing-logic`.

## TODO Section Format

The script matches `## TODO: Test Permutations` (with or without a `//` prefix, including inside a block comment). Everything after that line to EOF is treated as stub descriptions:

```js
// ## TODO: Test Permutations
// - scenarioSpendReport.categories.hazards.actual = NaN (should fail)
// - receipt with shared_system.actual = 0 (valid — zero spend is legitimate)
// - receipt where floor_tiles.usagePercent > 100 (valid — over-budget per category is allowed)
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `Connection refused localhost:11434` | `ollama serve` |
| `Cannot detect Ollama model` | Load one (`ollama run <name>`) or pass `--model <name>` |
| Generated code has syntax errors | Auto-iterates up to 5×; if still failing, make stubs more explicit |
| `.test.js` fails with `test is not defined` | Use `--runner vitest` (or `auto` in a Vitest repo) |
| Test fails with "module not found" | Model added an import — the script retries instructing it not to |
| Tests fail but look valid | Rolls back by default; inspect `test-gen.log`, rerun or try a stronger model |
| pnpm not found | `npm install -g pnpm` or `npx pnpm` |

## When Claude Invokes This Skill

Run the script, monitor output, read `test-gen-report.md`, and report: how many stubs were expanded; which passed, failed with syntax errors, or failed on application-code issues (with failing test names + error snippets for the latter). Claude does **not** fix production code during this run; it may correct generated-test expectations only when the existing implementation and earlier tests clearly establish the contract. For model evaluation, record whether any human correction was required.
