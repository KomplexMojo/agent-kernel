---
name: farm-remote
description: Farm inference / benchmark work from Cursor on the Mac to the remote Ollama GPU box (or the Mac's own Ollama) via tools/remote-ollama-control. Use when the user asks to run a benchmark, a content-gen / abstract-plan run, a hardware sweep, or a repo skill on remote GPU hardware.
disable-model-invocation: true
---

# Farm work to the remote Ollama box (Cursor on the Mac)

The control machine (this Mac) keeps prompts, tunnels, and result files; inference
runs on the remote Ubuntu GPU box (or, with `--local`, the Mac's own Ollama). The
farming is done entirely by the repo CLI `tools/remote-ollama-control/bin/remote-ollama-mac`,
which is harness-neutral — it reads the operator's untracked `config/llm-host.env`
(and/or `LLM_*` environment variables) plus `~/.ssh/config`, and opens an SSH tunnel
to the box. Nothing Cursor-specific is required beyond running these commands.

Full mechanism and every flag: `tools/remote-ollama-control/README.md`.
Benchmark discipline is normative in `AGENTS.md → Benchmark strategy` — follow it.

## Preconditions (verify first, in order)

1. **SSH key is loaded.** An empty agent fails as `Permission denied` and reads
   exactly like a dead box: `ssh-add -l` (load with
   `ssh-add --apple-use-keychain ~/.ssh/<key>` if empty).
2. **Addressing is present.** Either `config/llm-host.env` exists (copied from
   `config/llm-host.env.example`) or the `LLM_*` vars are exported. When
   `LLM_SSH_HOST_ALIAS` is set, routing is handled by `~/.ssh/config` and you can
   skip `--route`.
3. **Run the repo's own gate — do not skip it.** It catches the silent failures
   (empty model store, stale identity pins, missing config):

   ```bash
   bash scripts/benchmark-preflight.sh            # local checks
   bash scripts/benchmark-preflight.sh --remote   # also probe the box + pin freshness
   ```

   Stop and fix any `FAIL` before running. Warnings do not block.

## Farming commands

Run from the tool directory so results land under `results/`:

```bash
cd tools/remote-ollama-control
```

`--route auto` (the default) probes the internal LAN path first, then external —
move between home and away and the same command keeps working. Pin with
`--route internal` / `--route external` to see the underlying error.

- **Run a repo skill / any command on remote GPU hardware** (the everyday use —
  spend tokens on the box, keep control on the Mac):

  ```bash
  ./bin/remote-ollama-mac run-local --route auto --profile dual --model qwen3-coder:30b \
    -- node ../../.claude/skills/local-test-gen/scripts/main.mjs --model qwen3-coder:30b
  ```

- **Content-gen benchmark — a SUBSET (probe, in the loop):**

  ```bash
  ./bin/remote-ollama-mac run-content-gen --route auto --scenario-ids 1,2,3,4,5 --profiles dual
  ```

- **Abstract-plan benchmark (subset):**

  ```bash
  ./bin/remote-ollama-mac run-abstract-plan --route auto --profile dual --scenario-ids 1
  ```

- **Hardware sweep for the installed model catalog:**

  ```bash
  ./bin/remote-ollama-mac benchmark-hardware --route auto --models qwen2.5-coder:14b --contexts 8192,16384
  ```

- **Plan-only (no network) to see what a run would do:** add `--dry-run` (or
  `dry-run <cmd>`), e.g. `./bin/remote-ollama-mac dry-run run-content-gen`.

- **Offline / on the Mac's own Ollama** (no box, no tunnel): add `--local`
  (resolves `LLM_LOCAL_OLLAMA_HOST`, default `http://127.0.0.1:11434`). `--local`
  rejects `--profile/--route/--tunnel/--direct/--external-host/--local-port`.

## Guardrails (from AGENTS.md — do not violate)

- **Never start the full qualification matrix from a session.** One pass is 700
  calls; three are 2,100, and a full matrix runs for **days**. Subsets, single
  benchmarks, hardware probes, and `run-local` are fine in the loop; the days-long
  matrix belongs to the box's unattended `agent-kernel-benchmark` systemd timer,
  not to an interactive Cursor run.
- **Benchmarks are a discovery instrument, never a gate.** A number never blocks
  or approves a merge, and anything a benchmark surfaces that a deterministic test
  could catch is landed as that test in `pnpm run test`, not left to the next run.
- **Do not quote a historical number as a baseline** without its source commit and
  identity hashes.

## Results

Local output: `tools/remote-ollama-control/results/<timestamp>-<kind>/` —
`runs.jsonl`, `result.json`, `summary.md`, and `raw/<runId>/…`.

Published qualification evidence lives on the `benchmark-results` branch; read it
with the result reader (`latest_attempt` = newest scheduled run's health,
`latest_success` = last qualifying baseline) — see
`tools/remote-ollama-control/README.md → Reading published benchmark evidence`.
Do not commit raw prompts/generations; only compact JSON is published, and only by
the unattended agent.
