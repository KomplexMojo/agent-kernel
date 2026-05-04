---
name: local-test-gen
description: Generate test permutations using the currently loaded local Ollama model (auto-detected via /api/ps). Scans for ## TODO: Test Permutations sections, generates concrete test cases, runs them, and reports failures vs. application code issues. No MCP tools required — uses filesystem + Ollama API + shell only.
compatibility: Requires Node.js 18+, an Ollama-compatible endpoint reachable via OLLAMA_HOST or localhost:11434 with at least one model loaded
trigger: /local-test-gen
---

## Purpose

Expand `## TODO: Test Permutations` stubs in test files into concrete, runnable test cases using whatever model is currently loaded in Ollama. The model is auto-detected at startup via `/api/ps` (warm/running models) with a fallback to `/api/tags` (first installed model). Override with `--model <name>` when needed. Designed to run without any MCP or custom tool dependencies.

**Use this skill when:**
- A test file ends with a `## TODO: Test Permutations` section containing plain-language stub descriptions
- You want to expand permutations locally without spending cloud tokens
- You are on a machine with Ollama running `qwen3-coder:30b-a3b-q4_K_M`

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

Remote dual-GPU example from the repo root:

```bash
./tools/remote-ollama-control/bin/remote-ollama-mac run-local \
  --profile dual \
  --model qwen3-coder:30b-a3b-q4_K_M \
  --route external \
  -- node ~/.claude/skills/local-test-gen/scripts/main.mjs --model qwen3-coder:30b-a3b-q4_K_M
```

---

## What the Script Does

1. **Scan** — finds all `*.test.js` and `*.test.mjs` files under `tests/` that contain a `## TODO: Test Permutations` section
2. **Plan** — extracts the stub bullet points from each file's TODO section
3. **Generate** — sends each file's full content + stubs to `qwen3-coder:30b-a3b-q4_K_M`, asking it to produce concrete test cases for every stub
4. **Insert** — writes the generated tests into the file, replacing the TODO section
5. **Run** — executes each modified file with the correct runner:
   - `.test.js` → `node --test <file>` (legacy Node test runner)
   - `.test.mjs` → `pnpm exec vitest run <file>` (Vitest)
6. **Classify** — if a test fails, determines whether it is a **syntax error** (bad generated code) or a **logic/application failure** (real bug to fix)
7. **Report** — writes a `test-gen-report.md` to the repo root with per-file results

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
- Original files are restored on rollback if all iterations fail

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Connection refused localhost:11434` | Run `ollama serve` |
| `Cannot detect Ollama model` | Load a model first (`ollama run <name>`), or pass `--model <name>` |
| Generated code has syntax errors | The model will auto-iterate up to 5 times; if still failing, make stubs more explicit |
| Test fails with "module not found" | The model added an import — the script will retry with an instruction to avoid new imports |
| pnpm not found | Run `npm install -g pnpm` or use `npx pnpm` |

---

## When Claude Invokes This Skill

Claude runs the script, monitors output, reads `test-gen-report.md` when done, and reports:
- How many stubs were expanded
- Which tests passed, failed with syntax errors, and failed with application-code issues
- The specific failing test names and error snippets for application-code failures

Claude does NOT fix production code during this skill run. It only reports what needs fixing.
