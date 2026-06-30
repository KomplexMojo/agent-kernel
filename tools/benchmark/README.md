# Agent Kernel MCP Benchmark Suite

54 `ak_create` scenarios used to compare how different LLMs / reasoning levels drive the
agent-kernel skill + MCP tools, and to detect drift between the documented baselines and the
current CLI / MCP implementation.

This directory holds the **tracked harness**. The bulky generated output (scenario notes,
`Reference Artifacts/**`, `Validation/**`) is git-ignored and reproduced on demand.

## Files

| File | Role |
|---|---|
| `generate-baselines.mjs` | Drives `ak.mjs create` for all 54 scenarios; renders notes, `Index.md`, and `Reference Artifacts/**`. |
| `validate-benchmark.mjs` | Re-runs every scenario through **both** the CLI and a live `ak_create` MCP server, checks the full artifact set, and verifies CLI↔MCP byte-stable parity. Continues on failure; exits non-zero if any check fails. |
| `out/` | Generated output (git-ignored). |

## Quick start

```bash
# Regenerate all 54 baselines into tools/benchmark/out/
pnpm benchmark:mcp:generate

# Validate CLI + MCP + parity for every scenario (writes out/Validation/validation-summary.md)
pnpm benchmark:mcp:validate
```

Both commands run from the repo root and discover the repo via `process.cwd()`.

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `AK_BENCHMARK_OUTPUT_DIR` | `tools/benchmark/out` | Where notes + artifacts are written / read. |
| `AGENT_KERNEL_ROOT` | `process.cwd()` | Repo root (CLI + MCP server paths). |
| `AK_BENCHMARK_VAULT_PREFIX` | `…/agent-kernel-vault` | Path prefix the generator refuses to write to by default. |
| `AK_BENCHMARK_ALLOW_VAULT_WRITE` | _unset_ | Set to `1` to allow writing under the vault prefix (only outside a write-restricted sandbox). |

## Publishing the browsable copy to the Obsidian vault

The Obsidian vault holds a human-browsable copy under
`Sample Calls to agent-kernel MCP and Results/`. Codex's rescue sandbox **cannot** write to the
vault, so regenerate into the vault only from an unsandboxed host:

```bash
AK_BENCHMARK_OUTPUT_DIR="/Users/darren/Documents/Obsidian/agent-kernel-vault/Sample Calls to agent-kernel MCP and Results" \
AK_BENCHMARK_ALLOW_VAULT_WRITE=1 \
pnpm benchmark:mcp:generate
```

## Notes on current-code normalization

The generator normalizes a few authored specs to stay valid under the current `create` surface and
records each normalization in the affected scenario note:

- Room `affinities=` fields are no longer accepted → converted to hazards (or dropped when explicit
  trap/hazard objects already carry the affinity pressure).
- `size=small` rooms containing traps/hazards are upgraded to `medium`.
- `blocking=true` traps are emitted as `blocking=false` (see `REMEDIATION_PLAN.md` deficiency #4).

When the deficiencies in `REMEDIATION_PLAN.md` are fixed, remove the corresponding normalization so
the benchmark again exercises the original authored intent.

## Known deficiencies surfaced by this suite

See [`REMEDIATION_PLAN.md`](./REMEDIATION_PLAN.md).
