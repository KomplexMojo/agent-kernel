# Agent Kernel MCP Benchmark Suite

100 `ak_create` scenarios used to compare how different LLMs / reasoning levels drive the
agent-kernel skill + MCP tools, and to detect drift between the documented baselines and the
current CLI / MCP implementation.

This directory holds the **tracked harness**. The bulky generated output (scenario notes,
`Reference Artifacts/**`, `Validation/**`) is git-ignored and reproduced on demand.

## Files

| File | Role |
|---|---|
| `generate-baselines.mjs` | Loads the canonical Git catalog, verifies all 100 declared outcomes through `ak.mjs create`, and renders notes, `Index.md`, and `Reference Artifacts/**`. |
| `validate-benchmark.mjs` | Loads all 100 scenarios directly from the canonical catalog, re-runs each through **both** the CLI and a live `ak_create` MCP server, and verifies expected-outcome plus artifact parity. |
| `out/` | Generated output (git-ignored). |

## Quick start

```bash
# Regenerate all 100 baselines into tools/benchmark/out/
node tools/benchmark/generate-baselines.mjs

# Validate CLI + MCP + parity for every scenario (writes out/Validation/validation-summary.md)
node tools/benchmark/validate-benchmark.mjs
```

Both commands run from the repo root and discover the repo via `process.cwd()`. Validation does not
require generated notes or reference directories: it reads Git data directly, gives successful
scenarios isolated CLI/MCP output directories, requires all expected artifacts to have canonical
JSON parity,
and treats a non-zero result as passing only when both surfaces return the catalog's declared
`budget_denied` class.

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `AK_BENCHMARK_OUTPUT_DIR` | `tools/benchmark/out` | Where notes + artifacts are written / read. |
| `AGENT_KERNEL_ROOT` | `process.cwd()` | Repo root (CLI + MCP server paths). |
| `AK_BENCHMARK_UPDATE_CATALOG` | _unset_ | Set to `1` to refresh compact reference metrics after all declared outcomes pass. |
| `AK_BENCHMARK_VAULT_PREFIX` | `…/agent-kernel-vault` | Path prefix the generator refuses to write to by default. |
| `AK_BENCHMARK_ALLOW_VAULT_WRITE` | _unset_ | Set to `1` to allow writing under the vault prefix (only outside a write-restricted sandbox). |

## Publishing the browsable copy to the Obsidian vault

The Obsidian vault holds a human-browsable copy under
`Sample Calls to agent-kernel MCP and Results/`. Codex's rescue sandbox **cannot** write to the
vault, so regenerate into the vault only from an unsandboxed host:

```bash
AK_BENCHMARK_OUTPUT_DIR="/Users/darren/Documents/Obsidian/agent-kernel-vault/Sample Calls to agent-kernel MCP and Results" \
AK_BENCHMARK_ALLOW_VAULT_WRITE=1 \
node tools/benchmark/generate-baselines.mjs
```

## Catalog authoring

The canonical payloads under `tools/remote-ollama-control/benchmarks/content-gen/` already conform
to the current `ak_create` surface. The generator does not silently normalize them: an invalid
payload or mismatched expected outcome stops generation. After an intentional source or catalog
change, regenerate into a temporary directory with `AK_BENCHMARK_UPDATE_CATALOG=1`, review the
reference diff and new scenario-set hash, then run validation.

## Known deficiencies surfaced by this suite

See [`REMEDIATION_PLAN.md`](./REMEDIATION_PLAN.md).
