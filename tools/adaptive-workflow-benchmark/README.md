# AdaptiveWorkflowAgent Benchmark Driver

Runs a small, agent-specific scenario set through the **AdaptiveWorkflowAgent**
(`runAdaptiveWorkflow`) against a live Ollama-compatible model endpoint, and
writes a `summary.md` / `summary.json`. This is distinct from the content-gen
benchmark under `tools/remote-ollama-control`, which drives the `ak_create` tool
surface, not the agent.

## What it measures

Per scenario × run: outcome, furthest phase reached, a partial-credit **score**
(complete = 100; earlier terminal phases score less), real model **latency**
(the driver injects a wall clock — the shipped CLI uses a constant clock and
measures 0ms), the selected strategy, and failure category/code. Aggregated into
exec-ok rate, tool-call-ok rate, and average score.

The validator is **stricter than the CLI's**: each scenario's required keys must
be non-empty arrays. The flagship LLM-session sanitizer fabricates the required
keys as empty defaults, so a presence-only check would mark garbage as complete.

## Run it against the remote box

The remote Ollama binds to loopback, so tunnel first (see the LLM host notes):

```bash
ssh -f -N -L 21436:127.0.0.1:11436 -p 2222 darren@66.183.217.141

AK_ALLOW_NETWORK=1 node tools/adaptive-workflow-benchmark/run-agent-benchmark.mjs \
  --base-url http://localhost:21436 \
  --model qwen3-coder:30b-a3b-q4_K_M \
  --runs 3 --route external \
  --out-dir tools/adaptive-workflow-benchmark/results/$(date +%Y%m%dT%H%M%S)

pkill -f "21436:127.0.0.1:11436"   # close the tunnel
```

Flags: `--base-url` (required for ollama), `--model`, `--runs`, `--route`,
`--out-dir`, `--scenario-ids single-room,two-rooms`, `--set smoke|hard|all`
(default `smoke`), `--provider ollama|openai|anthropic` (default `ollama`), and
`--endpoint <url>`. Keep result directories **out of git**.

### Providers

The same scenarios can run against any provider (`model-providers.mjs`):

- **`ollama`** (default) — uses the Ollama-compatible adapter at `--base-url`.
- **`openai` / `anthropic`** — build the provider-neutral M2 adapter and bridge it
  to the LLM seam. The API key is read from `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
  (never passed on the command line or logged); the adapter fails before any
  request if the key is absent. `--endpoint` overrides the default provider URL.

```bash
OPENAI_API_KEY=sk-... node tools/adaptive-workflow-benchmark/run-agent-benchmark.mjs \
  --provider openai --model gpt-5 --set hard --runs 3 --out-dir <dir>
```

### Scenario sets

- **`smoke`** (`AGENT_BENCHMARK_SCENARIOS`) — easy JSON-authoring scenarios that
  validate only non-empty required arrays. Any capable model passes; used to
  prove the pipeline and measure latency.
- **`hard`** (`AGENT_BENCHMARK_HARD_SCENARIOS`) — discriminating scenarios whose
  validators check structure the flagship sanitizer will **not** fabricate:
  exact room/actor counts (`exactly-three-rooms`, `two-delvers`, `mixed-roster`)
  plus one scenario that routes to the **local-sectional/budget** strategy
  (`local-sectional-layout`, validated on `layout.floorTiles`). Generic output
  fails these, so the score separates weak models from strong ones. Note: the
  local-sectional path is ~10× slower than flagship (multiple budget-loop calls).

## Feeds the M10 evidence loader

`summary.md`'s "Aggregate by Profile" table is byte-compatible with
`loadBenchmarkEvidenceFromSummary(...)`, so a run can be ingested as benchmark
evidence and (explicitly) promoted into a strategy policy via
`promoteBenchmarkPolicy(...)`. Map the `agent` profile to a strategy id, e.g.
`{ strategyIdByProfile: { agent: "flagship_full_context_v1" } }`.

## Files

- `scenarios.mjs` — the small scenario set (edit/extend here).
- `agent-benchmark.mjs` — `runAgentBenchmark(...)` + `renderSummary(...)` (importable, fixture-testable).
- `run-agent-benchmark.mjs` — live CLI entrypoint.
- Tests: `tests/tools/adaptive-workflow-benchmark.test.js` (fixture-only, no live calls).
