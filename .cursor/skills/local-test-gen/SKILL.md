---
name: local-test-gen
description: >-
  Expand ## TODO: Test Permutations stubs with an Ollama model (local or remote GPU).
  Use when a test file ends with plain-language permutation stubs and the user wants
  local/no-cloud expansion, or to evaluate Ollama models for test-gen quality.
disable-model-invocation: true
---

# Local Test Gen (Cursor)

Expand `## TODO: Test Permutations` stubs into concrete Vitest cases via Ollama.
**Canonical implementation** lives under `.claude/skills/local-test-gen/` (script + full flag
docs). This Cursor skill is the slash entry point (`/local-test-gen`); do not fork the script.

**Do NOT use for** architecture decisions, production-code changes, live-service integration
tests, or deep FSM/adapter reasoning.

## Preconditions

1. Ollama reachable (`ollama serve`, or a tunnel via `/farm-remote` / `remote-ollama-mac`).
2. Run from repo root (where `tests/` and `pnpm` exist).
3. `tests/README.md` is current — the script injects it as domain contract.

## How to Run

```bash
node .claude/skills/local-test-gen/scripts/main.mjs
```

Useful flags (full list in `.claude/skills/local-test-gen/SKILL.md`):

- `--file <path>` — one file · `--dry-run` — plan only
- `--model <name>` — override auto-detect · `--ollama-host <url>`
- `--runner auto|vitest|node` · `--max-iterations 5`
- `--reasoning-mode direct|plan-code` · `--eval-run` / `--eval-output <path>`

### Remote dual-GPU (preferred for 30B-class models)

Use `/farm-remote` or:

```bash
cd tools/remote-ollama-control
./bin/remote-ollama-mac run-local --route auto --profile dual --model <ollama-model> \
  -- node ../../.claude/skills/local-test-gen/scripts/main.mjs --model <ollama-model>
```

## What success looks like

Stubs become runnable cases; the narrow file suite passes; failing generation is rolled back
unless `--keep-failing-logic` (triage only — omit for model eval).
