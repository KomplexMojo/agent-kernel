# agent-kernel MCP Server

## Overview

`packages/adapters-cli/src/mcp/server.mjs` exposes the `agent-kernel-cli` Model Context Protocol server over stdio.

- Server name: `agent-kernel-cli`
- Server version: `1.0.0`
- Transport: stdio
- Tool count: `49`
- Tool source: `packages/adapters-cli/src/mcp/tools/*.mjs`

The server is a thin adapter over the CLI command surface in `packages/adapters-cli/src/cli/ak-impl.mjs`. Each MCP tool maps to one CLI command, translates JSON input into CLI flags, executes the command, and returns structured JSON back to the client.

## Mental Model

The MCP server is the structured-tool version of `ak.mjs`. It does not create a separate runtime path:

```text
MCP client -> agent-kernel-cli MCP server -> adapters-cli command -> runtime -> core-ts
```

Use MCP when a harness can call tools directly and needs JSON-shaped inputs and outputs. Use the CLI when you are manually debugging, scripting outside an MCP client, or want to inspect raw stdout/stderr behavior.

Use the MCP server when your harness can call tools directly and you want:

- structured JSON inputs instead of shell-escaped flags
- stable tool names grouped by workflow
- machine-readable outputs for chaining and planning
- stdio transport inside Claude Code, Codex, or another MCP-aware harness

Use the CLI directly when you want:

- ad hoc shell usage
- manual debugging with stdout/stderr
- shell pipelines or scripting outside an MCP client
- to inspect raw command behavior without MCP wrapping

## Workflow Map

| Workflow | MCP tools | Typical result |
| --- | --- | --- |
| Author content | `ak_create`, `ak_configure`, `ak_room_plan`, `ak_delver_plan`, `ak_warden_plan`, `ak_hazard_plan`, `ak_resource_plan` | BuildSpec, bundle, manifest, runtime inputs |
| Build and execute | `ak_build`, `ak_configurator`, `ak_run`, `ak_replay`, `ak_budget`, `ak_scenario` | Run artifacts, TickFrames, budget receipts |
| Inspect outputs | `ak_show`, `ak_diff`, `ak_runs_list`, `ak_inspect`, `ak_narrate`, `ak_schemas` | Summaries, schema catalog, narrative output |
| LLM planning | `ak_llm`, `ak_ollama`, `ak_llm_plan` | Captured LLM responses and generated artifacts |
| External adapters | `ak_ipfs`, `ak_ipfs_publish`, `ak_ipfs_load`, `ak_blockchain`, `ak_blockchain_mint`, `ak_blockchain_load` | Adapter response artifacts |
| Sandbox / interactive | `ak_sandbox_create`, `ak_sandbox_place`, `ak_sandbox_move`, `ak_push_to_ui`, `ak_show_state`, `ak_tick_forward`, `ak_tick_backward` | Sandbox session, action sequence, tick/ASCII/image state |
| Test authoring | `ak_test_list_suites`, `ak_test_discover_patterns`, `ak_test_plan_from_change`, `ak_test_run`, `ak_test_scaffold_case`, `ak_test_insert_case`, `ak_test_explain_failure`, `ak_test_lint_structure` | Inventory summaries, scaffolded test files, run results |
| Workflow | `ak_workflow_run`, `ak_workflow_status`, `ak_workflow_replay`, `ak_workflow_cancel`, `ak_workflow_validate` | Durable AdaptiveWorkflowAgent run state |

The most common agent loop is: `ak_create` or `ak_llm_plan` -> `ak_run` -> `ak_show`/`ak_inspect` -> `ak_narrate` or `ak_diff`.

## Quick Start

### Start the server

From the repo root:

```bash
node packages/adapters-cli/src/mcp/server.mjs
```

Alternative package-bin entrypoint:

```bash
pnpm --dir packages/adapters-cli exec ak-mcp
```

### Verify with `tools/list`

The server speaks JSON-RPC over stdio. This minimal verification script performs `initialize` and `tools/list` and prints the tool count.

```bash
node <<'EOF'
const { spawn } = require('node:child_process');

const server = spawn(process.execPath, ['packages/adapters-cli/src/mcp/server.mjs'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
});

server.stdout.setEncoding('utf8');
let buffer = '';
let nextId = 1;

function send(message) {
  server.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.id === id) {
          server.stdout.off('data', onData);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        }
      }
    };
    server.stdout.on('data', onData);
    send({ jsonrpc: '2.0', id, method, params });
  });
}

(async () => {
  const init = await request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'agent-kernel-readme-check', version: '1.0.0' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  const listed = await request('tools/list', {});
  console.log(JSON.stringify({
    server: init.serverInfo,
    toolCount: listed.tools.length,
    firstTools: listed.tools.slice(0, 5).map((tool) => tool.name),
  }, null, 2));
  server.stdin.end();
})();
EOF
```

Expected output shape:

```json
{
  "server": {
    "name": "agent-kernel-cli",
    "version": "1.0.0"
  },
  "toolCount": 49,
  "firstTools": [
    "ak_create",
    "ak_configure",
    "ak_room_plan",
    "ak_delver_plan",
    "ak_warden_plan"
  ]
}
```

### Harness configuration

#### Claude Code

Current Claude Code docs use `claude mcp add` for registration:

```bash
claude mcp add --transport stdio agent-kernel-cli -- \
  node /Users/darren/Documents/GitHub/agent-kernel/packages/adapters-cli/src/mcp/server.mjs
```

List configured servers:

```bash
claude mcp list
```

If your Claude harness accepts a JSON `mcpServers` block, use:

```json
{
  "mcpServers": {
    "agent-kernel-cli": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/darren/Documents/GitHub/agent-kernel/packages/adapters-cli/src/mcp/server.mjs"
      ],
      "env": {}
    }
  }
}
```

For prompt-level steering in `CLAUDE.md`, add:

```md
Use the `agent-kernel-cli` MCP server for agent-kernel authoring, simulation, inspection, LLM planning, and external adapter operations. Prefer the `ak_*` MCP tools over shelling out to the CLI when the MCP server is available.
```

#### Codex

Current Codex docs store actual MCP registration in `~/.codex/config.toml` or project-scoped `.codex/config.toml`:

```toml
[mcp_servers.agent-kernel-cli]
command = "node"
args = ["/Users/darren/Documents/GitHub/agent-kernel/packages/adapters-cli/src/mcp/server.mjs"]

[mcp_servers.agent-kernel-cli.env]
```

CLI equivalent:

```bash
codex mcp add agent-kernel-cli -- \
  node /Users/darren/Documents/GitHub/agent-kernel/packages/adapters-cli/src/mcp/server.mjs
```

Verify:

```bash
codex mcp list
```

In `AGENTS.md`, add an instruction block so Codex actually uses the configured server:

```md
## MCP

Use the `agent-kernel-cli` MCP server when working in this repository. Prefer the `ak_*` tools over shell commands for authoring, simulation, inspection, LLM planning, IPFS, and blockchain operations.
```

#### Ollama via Claude/Codex harness

Ollama is not a separate MCP harness here. It inherits whichever harness is hosting the agent:

- Claude Code + Ollama-backed planning: use the Claude Code config above
- Codex + Ollama-backed planning: use the Codex config above

The MCP server stays the same. Only LLM-backed tools such as `ak_llm`, `ak_ollama`, `ak_llm_plan`, and `ak_scenario` depend on the local Ollama endpoint.

## Tool Index

| Tool name | Group | Description | Key input parameters |
| --- | --- | --- | --- |
| ak_create | Authoring | Create authored build artifacts from freeform and structured object specs. | text, room[], floorTile[], hazard[], delver[], warden[], goal, dungeonAffinity, budgetTokens, budget, priceList, dryRun |
| ak_configure | Authoring | Configure authored build artifacts from freeform and structured object specs. | text, room[], floorTile[], hazard[], delver[], warden[], goal, dungeonAffinity, budgetTokens, budget, priceList |
| ak_room_plan | Authoring | Build a room-only authoring plan. | room[], goal, dungeonAffinity, budgetTokens, budget, priceList |
| ak_delver_plan | Authoring | Build a delver-only authoring plan. | delver[], goal, dungeonAffinity, budgetTokens, budget, priceList |
| ak_warden_plan | Authoring | Build a warden-only authoring plan. | warden[], goal, dungeonAffinity, budgetTokens, budget, priceList |
| ak_hazard_plan | Authoring | Build a hazard-only authoring plan. | hazard[], goal, dungeonAffinity, budgetTokens, budget, priceList |
| ak_resource_plan | Authoring | Build a resource-only authoring plan. | resource[], goal, dungeonAffinity, budgetTokens, budget, priceList |
| ak_build | Simulation | Build artifacts from a build spec. | spec |
| ak_solve | Simulation | Solve a scenario into runnable artifacts. | scenario, plan, intent, options |
| ak_run | Simulation | Run a simulation from artifacts or from an existing run. | simConfig, initialState, fromRun, executionPolicy, ticks, seed, actor[], vital[], vitalDefault[], tileWall[], tileBarrier[], tileFloor[], actions, affinityPresets, affinityLoadouts, affinitySummary, progress, dryRun |
| ak_configurator | Simulation | Assemble simulation config and initial state inputs. | levelGen, actors, plan, budgetReceipt, budget, priceList, receiptOut, affinityPresets, affinityLoadouts |
| ak_budget | Simulation | Compute a budget receipt from budget and price list artifacts. | budget, priceList, receipt, receiptOut |
| ak_replay | Simulation | Replay a run deterministically from recorded tick frames. | simConfig, initialState, tickFrames, executionPolicy, ticks, seed |
| ak_scenario | Simulation | Run llm-plan plus run plus inspect as a single scenario pipeline. | text, fromRun, catalog, model, goal, budgetTokens, baseUrl, fixture, budgetLoop, budgetPool[], budgetReserve, ticks, seed, dryRun |
| ak_schemas | Inspection | List the schema catalog used by the runtime. | outDir |
| ak_inspect | Inspection | Inspect recorded tick frames and summarize effects. | tickFrames, effectsLog |
| ak_narrate | Inspection | Generate a narrative artifact from frames and initial state. | tickFrames, initialState |
| ak_show | Inspection | Show the indexed artifacts for an existing run. | runId |
| ak_diff | Inspection | Diff two existing runs. | runA, runB |
| ak_runs_list | Inspection | List indexed runs from the artifacts directory. | none |
| ak_llm | LLM Planning | Run a single LLM prompt against the configured adapter. | model, prompt, baseUrl, fixture, out, outDir |
| ak_ollama | LLM Planning | Alias for ak_llm using the Ollama-backed CLI command. | model, prompt, baseUrl, fixture, out, outDir |
| ak_llm_plan | LLM Planning | Generate runnable artifacts from a scenario or freeform text via the LLM planner. | scenario, text, prompt, catalog, model, goal, budgetTokens, baseUrl, fixture, budgetLoop, budgetPool[], budgetReserve |
| ak_ipfs | External Adapters | Fetch IPFS content through the CLI adapter. | cid, path, gateway, json, fixture, out, outDir |
| ak_ipfs_publish | External Adapters | Publish artifact maps through the IPFS adapter. | artifactMap, path, gateway, fixtureCid, out, outDir |
| ak_ipfs_load | External Adapters | Load artifact files from IPFS through the CLI adapter. | cid, path, file[], gateway, fixtureMap, out, outDir |
| ak_blockchain | External Adapters | Inspect blockchain adapter state. | rpcUrl, address, fixtureChainId, fixtureBalance, out, outDir |
| ak_blockchain_mint | External Adapters | Mint a card through the blockchain adapter. | rpcUrl, card, owner, contract, tokenId, fixtureChainId, fixtureMint, out, outDir |
| ak_blockchain_load | External Adapters | Load a minted card through the blockchain adapter. | rpcUrl, tokenId, owner, contract, fixtureChainId, fixtureLoad, out, outDir |
| ak_sandbox_create | Sandbox / Interactive | Create a standalone Phaser sandbox session with budget enforcement. | budgetReceipt, budget, width, height, entityCategories |
| ak_sandbox_place | Sandbox / Interactive | Place and configure an entity in an existing sandbox session. | session, entityType, spec |
| ak_sandbox_move | Sandbox / Interactive | Compose a single-tile move for an actor in a sandbox session. | session, actorId, direction, actionsOut |
| ak_push_to_ui | Sandbox / Interactive | Deliver a compiled GameplayBundle to the connected browser UI over the sandbox bridge. | outDir, bundlePath, bundle, targetTab, requireClient, openBrowser, correlationId |
| ak_show_state | Sandbox / Interactive | Show current dungeon state for a run at the session cursor tick. | runId, visualization |
| ak_tick_forward | Sandbox / Interactive | Advance the interactive session cursor forward by one tick. | runId, visualization |
| ak_tick_backward | Sandbox / Interactive | Rewind the interactive session cursor back by one tick. | runId, visualization |
| ak_test_list_suites | Test Authoring | List discovered test suites and current runner ownership. | none |
| ak_test_discover_patterns | Test Authoring | Discover repo test recipes and matching files, optionally filtered. | runner, suite, recipe |
| ak_test_plan_from_change | Test Authoring | Recommend runner scopes from changed paths. | paths[] |
| ak_test_run | Test Authoring | Run the test harness inventory, Vitest, legacy, or combined matrix scripts. | mode, args[] |
| ak_test_scaffold_case | Test Authoring | Scaffold a new test file from a limited structured recipe set. | recipe, targetFile, title, (recipe-specific fields) |
| ak_test_insert_case | Test Authoring | Append a scaffolded case to an existing test file. | recipe, targetFile, title, (recipe-specific fields) |
| ak_test_explain_failure | Test Authoring | Classify a test failure from runner output into migration-focused categories. | text |
| ak_test_lint_structure | Test Authoring | Report structural migration gaps: uncategorized recipes and codemod exceptions. | none |
| ak_workflow_run | Workflow | Run AdaptiveWorkflowAgent through the controlled CLI adapter. | input or objective, policy, runtimeProfile, model, maxModelAttempts |
| ak_workflow_status | Workflow | Read durable workflow status. | outDir or runId |
| ak_workflow_replay | Workflow | Replay a workflow run from recorded model content without live IO. | outDir or runId |
| ak_workflow_cancel | Workflow | Request cancellation through durable workflow state. | outDir or runId, reason |
| ak_workflow_validate | Workflow | Validate workflow input without model or execution calls. | input or objective, policy, runtimeProfile, model, maxModelAttempts |

## Tool Groups

### Common output fields

Many tools accept these shared output controls:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| outDir | string | no | Output directory override |
| out | string | no | Output file override for commands that support a single-file output |
| runId | string | no | Run id override |
| createdAt | string (date-time) | no | Created-at timestamp override |

### Authoring

Purpose: turn freeform or structured dungeon/card requests into the canonical persisted handoff: `spec.json`, the budget triplet when present, `sim-config.json`, `initial-state.json`, `resource-bundle.json`, `bundle.json`, `manifest.json`, and `telemetry.json`. Use `emitIntermediates=true` to also persist non-canonical sidecars such as `request.json`, `intent.json`, `plan.json`, and captured inputs.

#### `ak_create`

Creates authored build artifacts. Supports dry-run validation.

Schema:

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| text | string | no | Freeform authoring text |
| room | string[] | no | Room authoring specs |
| floorTile | string[] | no | Floor tile specs |
| hazard | string[] | no | Hazard specs |
| resource | string[] | no | Resource specs |
| delver | string[] | no | Delver specs |
| warden | string[] | no | Warden specs |
| goal | string | no | Goal text override |
| dungeonAffinity | string | no | Dungeon affinity override |
| budgetTokens | integer | no | Minimum 1 |
| dungeonBudgetTokens | integer | no | Separate hard cap for dungeon-side authored objects, minimum 1 |
| delverBudgetTokens | integer | no | Separate hard cap for delver-side authored objects, minimum 1 |
| budget | string | no | Budget artifact path |
| priceList | string | no | Price list artifact path |
| emitIntermediates | boolean | no | Persist non-canonical sidecar artifacts |
| outDir | string | no | Output directory override |
| runId | string | no | Run id override |
| createdAt | string | no | ISO-8601 timestamp |
| dryRun | boolean | no | Validate only |

Example call:

```json
{
  "text": "Create one fire delver within a total budget of 200 tokens.",
  "delver": [
    "count=1;affinity=fire;motivation=attacking;goals=max_mana,mana_regen"
  ],
  "budgetTokens": 200,
  "dryRun": true,
  "runId": "run_mcp_create_dry_run",
  "createdAt": "2026-04-10T00:00:00.000Z",
  "outDir": "/tmp/agent-kernel/create"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "create",
  "runId": "run_mcp_create_dry_run",
  "dryRun": true,
  "valid": true,
  "outDir": "/tmp/agent-kernel/create"
}
```

#### `ak_configure`

Same surface as `ak_create`, but runs the `configure` CLI command and does not expose `dryRun`.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| text | string | no |
| room | string[] | no |
| floorTile | string[] | no |
| hazard | string[] | no |
| resource | string[] | no |
| delver | string[] | no |
| warden | string[] | no |
| goal | string | no |
| dungeonAffinity | string | no |
| budgetTokens | integer | no |
| dungeonBudgetTokens | integer | no |
| delverBudgetTokens | integer | no |
| budget | string | no |
| priceList | string | no |
| outDir | string | no |
| runId | string | no |
| createdAt | string | no |

Example call:

```json
{
  "room": ["size=small;count=2;affinities=dark:emit:2"],
  "hazard": ["x=2;y=3;affinity=fire;stacks=1"],
  "runId": "run_configure_rooms",
  "outDir": "/tmp/agent-kernel/configure"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "configure",
  "runId": "run_configure_rooms",
  "outDir": "/tmp/agent-kernel/configure",
  "artifactPaths": {
    "spec": "/tmp/agent-kernel/configure/spec.json",
    "plan": "/tmp/agent-kernel/configure/plan.json",
    "simConfig": "/tmp/agent-kernel/configure/sim-config.json",
    "initialState": "/tmp/agent-kernel/configure/initial-state.json"
  }
}
```

#### `ak_room_plan`

Room-only authoring flow.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| room | string[] | yes |
| goal | string | no |
| dungeonAffinity | string | no |
| budgetTokens | integer | no |
| budget | string | no |
| priceList | string | no |
| outDir | string | no |
| runId | string | no |
| createdAt | string | no |

Example call:

```json
{
  "room": [
    "size=small;count=2;affinities=dark:emit:2,fire:push:1"
  ],
  "budgetTokens": 120,
  "runId": "run_room_plan",
  "outDir": "/tmp/agent-kernel/room-plan"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "room-plan",
  "runId": "run_room_plan",
  "outDir": "/tmp/agent-kernel/room-plan",
  "artifactPaths": {
    "spec": "/tmp/agent-kernel/room-plan/spec.json",
    "plan": "/tmp/agent-kernel/room-plan/plan.json",
    "manifest": "/tmp/agent-kernel/room-plan/manifest.json"
  }
}
```

#### `ak_delver_plan`

Delver-only authoring flow.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| delver | string[] | yes |
| goal | string | no |
| dungeonAffinity | string | no |
| budgetTokens | integer | no |
| budget | string | no |
| priceList | string | no |
| outDir | string | no |
| runId | string | no |
| createdAt | string | no |

Example call:

```json
{
  "delver": [
    "count=2;affinity=fire;motivation=attacking;goals=max_mana:high,mana_regen:high"
  ],
  "runId": "run_delver_plan",
  "outDir": "/tmp/agent-kernel/delver-plan"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "delver-plan",
  "runId": "run_delver_plan",
  "outDir": "/tmp/agent-kernel/delver-plan",
  "artifactPaths": {
    "spec": "/tmp/agent-kernel/delver-plan/spec.json",
    "plan": "/tmp/agent-kernel/delver-plan/plan.json",
    "manifest": "/tmp/agent-kernel/delver-plan/manifest.json"
  }
}
```

#### `ak_warden_plan`

Warden-only authoring flow.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| warden | string[] | yes |
| goal | string | no |
| dungeonAffinity | string | no |
| budgetTokens | integer | no |
| budget | string | no |
| priceList | string | no |
| outDir | string | no |
| runId | string | no |
| createdAt | string | no |

Example call:

```json
{
  "warden": [
    "count=1;affinity=dark;motivation=defending"
  ],
  "runId": "run_warden_plan",
  "outDir": "/tmp/agent-kernel/warden-plan"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "warden-plan",
  "runId": "run_warden_plan",
  "outDir": "/tmp/agent-kernel/warden-plan",
  "artifactPaths": {
    "spec": "/tmp/agent-kernel/warden-plan/spec.json",
    "plan": "/tmp/agent-kernel/warden-plan/plan.json",
    "manifest": "/tmp/agent-kernel/warden-plan/manifest.json"
  }
}
```

#### `ak_hazard_plan`

Hazard-only authoring flow.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| hazard | string[] | yes |
| goal | string | no |
| dungeonAffinity | string | no |
| budgetTokens | integer | no |
| budget | string | no |
| priceList | string | no |
| outDir | string | no |
| runId | string | no |
| createdAt | string | no |

Example call:

```json
{
  "hazard": [
    "x=2;y=3;affinity=fire;stacks=1"
  ],
  "runId": "run_hazard_plan",
  "outDir": "/tmp/agent-kernel/hazard-plan"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "hazard-plan",
  "runId": "run_hazard_plan",
  "outDir": "/tmp/agent-kernel/hazard-plan",
  "artifactPaths": {
    "spec": "/tmp/agent-kernel/hazard-plan/spec.json",
    "plan": "/tmp/agent-kernel/hazard-plan/plan.json",
    "manifest": "/tmp/agent-kernel/hazard-plan/manifest.json"
  }
}
```

#### `ak_resource_plan`

Resource-only authoring flow.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| resource | string[] | yes |
| goal | string | no |
| dungeonAffinity | string | no |
| budgetTokens | integer | no |
| budget | string | no |
| priceList | string | no |
| outDir | string | no |
| runId | string | no |
| createdAt | string | no |

Example call:

```json
{
  "resource": [
    "id=res_mana;tier=1;stat=mana;delta=5;dropRate=0.5"
  ],
  "runId": "run_resource_plan",
  "outDir": "/tmp/agent-kernel/resource-plan"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "resource-plan",
  "runId": "run_resource_plan",
  "outDir": "/tmp/agent-kernel/resource-plan",
  "artifactPaths": {
    "spec": "/tmp/agent-kernel/resource-plan/spec.json",
    "plan": "/tmp/agent-kernel/resource-plan/plan.json",
    "manifest": "/tmp/agent-kernel/resource-plan/manifest.json"
  }
}
```

### Simulation

Purpose: turn plans and artifacts into runnable configurations, execute deterministic runs, compute budgets, and chain planning plus execution.

#### `ak_build`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| spec | string | yes |
| outDir | string | no |
| emitIntermediates | boolean | no |

Example call:

```json
{
  "spec": "tests/fixtures/artifacts/build-spec-v1-basic.json",
  "outDir": "/tmp/agent-kernel/build"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "build",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/build",
  "artifactPaths": {
    "spec": "/tmp/agent-kernel/build/spec.json",
    "bundle": "/tmp/agent-kernel/build/bundle.json",
    "manifest": "/tmp/agent-kernel/build/manifest.json",
    "telemetry": "/tmp/agent-kernel/build/telemetry.json"
  }
}
```

#### `ak_solve`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| scenario | string | yes |
| plan | string | no |
| intent | string | no |
| options | string | no |
| outDir | string | no |
| runId | string | no |

Example call:

```json
{
  "scenario": "Build a dark dungeon with one fire delver.",
  "outDir": "/tmp/agent-kernel/solve",
  "runId": "run_solve_basic"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "solve",
  "runId": "run_solve_basic",
  "outDir": "/tmp/agent-kernel/solve",
  "artifactPaths": {
    "plan": "/tmp/agent-kernel/solve/plan.json",
    "simConfig": "/tmp/agent-kernel/solve/sim-config.json",
    "initialState": "/tmp/agent-kernel/solve/initial-state.json"
  }
}
```

#### `ak_run`

Schema:

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| simConfig | string | no | Use with initialState |
| initialState | string | no | Use with simConfig |
| fromRun | string | no | Alternate source for resolved artifacts |
| executionPolicy | string | no | Execution policy artifact path |
| ticks | integer | no | Minimum 1 |
| seed | integer | no | Minimum 0 |
| actor | string[] | no | Actor override specs |
| vital | string[] | no | Vital override specs |
| vitalDefault | string[] | no | Default vital specs |
| tileWall | string[] | no | Wall tile coordinates |
| tileBarrier | string[] | no | Barrier tile coordinates |
| tileFloor | string[] | no | Floor tile overrides |
| actions | string | no | ActionSequence path |
| affinityPresets | string | no | AffinityPresetArtifact path |
| affinityLoadouts | string | no | ActorLoadoutArtifact path |
| affinitySummary | string | no | Output path for affinity summary |
| progress | boolean | no | Emit tick progress events |
| dryRun | boolean | no | Validate without execution |
| outDir | string | no | Output directory override |
| runId | string | no | Run id override |

Example call:

```json
{
  "simConfig": "tests/fixtures/artifacts/sim-config-artifact-v1-configurator-hazard.json",
  "initialState": "tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json",
  "ticks": 4,
  "seed": 0,
  "progress": true,
  "outDir": "/tmp/agent-kernel/run",
  "runId": "run_mcp_readme"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "run",
  "runId": "run_mcp_readme",
  "outDir": "/tmp/agent-kernel/run",
  "ticks": 4,
  "artifactPaths": {
    "tick_frames": "/tmp/agent-kernel/run/tick-frames.json",
    "effects_log": "/tmp/agent-kernel/run/effects-log.json",
    "runtime_decision_captures": "/tmp/agent-kernel/run/runtime-decision-captures.json",
    "run_summary": "/tmp/agent-kernel/run/run-summary.json",
    "action_log": "/tmp/agent-kernel/run/action-log.json"
  }
}
```

#### `ak_configurator`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| levelGen | string | yes |
| actors | string | yes |
| plan | string | no |
| budgetReceipt | string | no |
| budget | string | no |
| priceList | string | no |
| receiptOut | string | no |
| affinityPresets | string | no |
| affinityLoadouts | string | no |
| outDir | string | no |
| runId | string | no |

Example call:

```json
{
  "levelGen": "tests/fixtures/configurator/level-gen-v1-basic.json",
  "actors": "tests/fixtures/configurator/actors-v1-basic.json",
  "outDir": "/tmp/agent-kernel/configurator",
  "runId": "run_configurator_basic"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "configurator",
  "runId": "run_configurator_basic",
  "outDir": "/tmp/agent-kernel/configurator",
  "artifactPaths": {
    "simConfig": "/tmp/agent-kernel/configurator/sim-config.json",
    "initialState": "/tmp/agent-kernel/configurator/initial-state.json"
  }
}
```

#### `ak_budget`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| budget | string | yes |
| priceList | string | no |
| receipt | string | no |
| receiptOut | string | no |
| outDir | string | no |
| out | string | no |

Example call:

```json
{
  "budget": "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
  "priceList": "tests/fixtures/artifacts/price-list-artifact-v1-basic.json",
  "outDir": "/tmp/agent-kernel/budget"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "budget",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/budget",
  "artifactPaths": {
    "receipt": "/tmp/agent-kernel/budget/budget-receipt.json"
  }
}
```

#### `ak_replay`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| simConfig | string | yes |
| initialState | string | yes |
| tickFrames | string | yes |
| executionPolicy | string | no |
| ticks | integer | no |
| seed | integer | no |
| outDir | string | no |

Example call:

```json
{
  "simConfig": "artifacts/runs/run_123/run/sim-config.json",
  "initialState": "artifacts/runs/run_123/run/initial-state.json",
  "tickFrames": "artifacts/runs/run_123/run/tick-frames.json",
  "outDir": "/tmp/agent-kernel/replay"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "replay",
  "runId": "run_123",
  "outDir": "/tmp/agent-kernel/replay",
  "artifactPaths": {
    "run_summary": "/tmp/agent-kernel/replay/run-summary.json"
  }
}
```

#### `ak_scenario`

Schema:

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| text | string | no | Text-driven scenario path |
| fromRun | string | no | Reuse prior artifacts |
| catalog | string | no | Needed for text-driven planning |
| model | string | no | LLM model override |
| goal | string | no | Goal override |
| budgetTokens | integer | no | Hard token cap |
| baseUrl | string | no | LLM base URL |
| fixture | string | no | Fixture response path |
| budgetLoop | boolean | no | Enable budget loop |
| budgetPool | string[] | no | id=weight entries |
| budgetReserve | integer | no | Minimum 0 |
| ticks | integer | no | Minimum 1 |
| seed | integer | no | Minimum 0 |
| dryRun | boolean | no | Validate only |
| outDir | string | no | Output directory override |
| runId | string | no | Run id override |
| createdAt | string | no | ISO-8601 timestamp |

Example call:

```json
{
  "text": "A dark dungeon with one fire delver and one hazard.",
  "catalog": "tests/fixtures/e2e/e2e-catalog-v1-basic.json",
  "fixture": "tests/fixtures/adapters/llm-generate-summary.json",
  "model": "fixture",
  "ticks": 4,
  "outDir": "/tmp/agent-kernel/scenario",
  "runId": "run_scenario_fixture"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "scenario",
  "runId": "run_scenario_fixture",
  "outDir": "/tmp/agent-kernel/scenario",
  "artifactPaths": {
    "llm_plan_spec": "/tmp/agent-kernel/scenario/llm-plan/spec.json",
    "llm_plan_simConfig": "/tmp/agent-kernel/scenario/llm-plan/sim-config.json",
    "tick_frames": "/tmp/agent-kernel/scenario/run/tick-frames.json",
    "run_summary": "/tmp/agent-kernel/scenario/run/run-summary.json",
    "inspect_summary": "/tmp/agent-kernel/scenario/inspect/inspect-summary.json"
  }
}
```

### Inspection

Purpose: inspect generated schemas and prior runs, summarize outputs, produce narratives, and compare or index historical runs.

#### `ak_schemas`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| outDir | string | no |

Example call:

```json
{
  "outDir": "/tmp/agent-kernel/schemas"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "schemas",
  "stdout": "schemas: wrote /tmp/agent-kernel/schemas"
}
```

#### `ak_inspect`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| tickFrames | string | yes |
| effectsLog | string | no |
| outDir | string | no |

Example call:

```json
{
  "tickFrames": "artifacts/runs/run_123/run/tick-frames.json",
  "effectsLog": "artifacts/runs/run_123/run/effects-log.json",
  "outDir": "/tmp/agent-kernel/inspect"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "inspect",
  "runId": "run_123",
  "outDir": "/tmp/agent-kernel/inspect",
  "artifactPaths": {
    "inspect_summary": "/tmp/agent-kernel/inspect/inspect-summary.json"
  }
}
```

#### `ak_narrate`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| tickFrames | string | yes |
| initialState | string | yes |
| outDir | string | no |

Example call:

```json
{
  "tickFrames": "artifacts/runs/run_123/run/tick-frames.json",
  "initialState": "artifacts/runs/run_123/llm-plan/initial-state.json",
  "outDir": "/tmp/agent-kernel/narrate"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "narrate",
  "runId": "run_123",
  "outDir": "/tmp/agent-kernel/narrate",
  "artifactPaths": {
    "narrative": "/tmp/agent-kernel/narrate/narrative.json"
  }
}
```

#### `ak_show`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| runId | string | yes |

Example call:

```json
{
  "runId": "run_123"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "show",
  "runId": "run_123",
  "commands": [
    {
      "command": "llm-plan",
      "outDir": "artifacts/runs/run_123/llm-plan"
    },
    {
      "command": "run",
      "outDir": "artifacts/runs/run_123/run"
    }
  ],
  "artifactPaths": [
    "artifacts/runs/run_123/llm-plan/spec.json",
    "artifacts/runs/run_123/run/tick-frames.json"
  ]
}
```

#### `ak_diff`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| runA | string | yes |
| runB | string | yes |

Example call:

```json
{
  "runA": "run_alpha",
  "runB": "run_beta"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "diff",
  "runA": "run_alpha",
  "runB": "run_beta",
  "compareA": {
    "command": "run"
  },
  "compareB": {
    "command": "run"
  },
  "summary": {
    "frameCountDelta": 2
  }
}
```

#### `ak_runs_list`

Schema:

No input parameters.

Example call:

```json
{}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "runs",
  "runs": [
    {
      "runId": "run_alpha",
      "commands": ["llm-plan", "run", "inspect"]
    },
    {
      "runId": "run_beta",
      "commands": ["create", "run"]
    }
  ]
}
```

### LLM Planning

Purpose: call the configured LLM adapter directly or drive the planner that turns text or scenarios into runnable artifacts.

Default values in this group:

- `model`: `phi4`
- `baseUrl`: `http://localhost:11434`

#### `ak_llm`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| prompt | string | yes |
| model | string | no |
| baseUrl | string | no |
| fixture | string | no |
| out | string | no |
| outDir | string | no |

Example call:

```json
{
  "prompt": "Summarize this dungeon concept as JSON.",
  "model": "phi4",
  "baseUrl": "http://localhost:11434",
  "outDir": "/tmp/agent-kernel/llm"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "llm",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/llm",
  "artifactPaths": {
    "response": "/tmp/agent-kernel/llm/llm.json"
  }
}
```

#### `ak_ollama`

Alias for the Ollama-backed CLI command. Input schema matches `ak_llm`.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| prompt | string | yes |
| model | string | no |
| baseUrl | string | no |
| fixture | string | no |
| out | string | no |
| outDir | string | no |

Example call:

```json
{
  "prompt": "Return JSON only.",
  "model": "phi4",
  "outDir": "/tmp/agent-kernel/ollama"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "ollama",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/ollama",
  "artifactPaths": {
    "response": "/tmp/agent-kernel/ollama/llm.json"
  }
}
```

#### `ak_llm_plan`

Schema:

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| scenario | string | no | Scenario fixture path |
| text | string | no | Freeform input |
| prompt | string | no | Prompt override |
| catalog | string | no | Needed for text/prompt-only flows |
| model | string | no | Defaults to phi4 |
| goal | string | no | Goal override |
| budgetTokens | integer | no | Minimum 1 |
| baseUrl | string | no | Defaults to local Ollama |
| fixture | string | no | Fixture response path |
| budgetLoop | boolean | no | Enable layout/actor budget loop |
| budgetPool | string[] | no | id=weight entries |
| budgetReserve | integer | no | Minimum 0 |
| emitIntermediates | boolean | no | Persist non-canonical sidecar artifacts |
| outDir | string | no | Output directory override |
| runId | string | no | Run id override |
| createdAt | string | no | ISO-8601 timestamp |

Example call:

```json
{
  "scenario": "tests/fixtures/e2e/e2e-scenario-v1-basic.json",
  "model": "fixture",
  "fixture": "tests/fixtures/adapters/llm-generate-summary.json",
  "runId": "run_mcp_llm_plan_fixture",
  "createdAt": "2025-01-01T00:00:00Z",
  "outDir": "/tmp/agent-kernel/llm-plan"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "llm-plan",
  "runId": "run_mcp_llm_plan_fixture",
  "outDir": "/tmp/agent-kernel/llm-plan",
  "artifactPaths": {
    "spec": "/tmp/agent-kernel/llm-plan/spec.json",
    "simConfig": "/tmp/agent-kernel/llm-plan/sim-config.json",
    "initialState": "/tmp/agent-kernel/llm-plan/initial-state.json",
    "manifest": "/tmp/agent-kernel/llm-plan/manifest.json"
  }
}
```

### External Adapters

Purpose: expose IPFS and blockchain adapters behind the same MCP surface used by the CLI. These are adapter-layer tools only.

#### `ak_ipfs`

Default gateway: `https://ipfs.io/ipfs`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| cid | string | yes |
| path | string | no |
| gateway | string | no |
| json | boolean | no |
| fixture | string | no |
| out | string | no |
| outDir | string | no |

Example call:

```json
{
  "cid": "bafyexamplecid",
  "path": "manifest.json",
  "json": true,
  "outDir": "/tmp/agent-kernel/ipfs"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "ipfs",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/ipfs",
  "artifactPaths": {
    "response": "/tmp/agent-kernel/ipfs/ipfs.json"
  }
}
```

#### `ak_ipfs_publish`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| artifactMap | string | yes |
| path | string | no |
| gateway | string | no |
| fixtureCid | string | no |
| out | string | no |
| outDir | string | no |

Example call:

```json
{
  "artifactMap": "tests/fixtures/adapters/ipfs-artifact-map-v1-basic.json",
  "fixtureCid": "bafyfixturecid",
  "outDir": "/tmp/agent-kernel/ipfs-publish"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "ipfs-publish",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/ipfs-publish",
  "artifactPaths": {
    "response": "/tmp/agent-kernel/ipfs-publish/ipfs-publish.json"
  }
}
```

#### `ak_ipfs_load`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| cid | string | yes |
| path | string | no |
| file | string[] | no |
| gateway | string | no |
| fixtureMap | string | no |
| out | string | no |
| outDir | string | no |

Example call:

```json
{
  "cid": "bafyexamplecid",
  "file": ["spec.json", "manifest.json"],
  "fixtureMap": "tests/fixtures/adapters/ipfs-load-map-v1-basic.json",
  "outDir": "/tmp/agent-kernel/ipfs-load"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "ipfs-load",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/ipfs-load",
  "stdout": "ipfs-load: wrote /tmp/agent-kernel/ipfs-load"
}
```

#### `ak_blockchain`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| rpcUrl | string | yes |
| address | string | no |
| fixtureChainId | string | no |
| fixtureBalance | string | no |
| out | string | no |
| outDir | string | no |

Example call:

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "address": "0x1234",
  "fixtureChainId": "tests/fixtures/adapters/chain-id.json",
  "fixtureBalance": "tests/fixtures/adapters/balance.json",
  "outDir": "/tmp/agent-kernel/blockchain"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "blockchain",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/blockchain",
  "artifactPaths": {
    "response": "/tmp/agent-kernel/blockchain/blockchain.json"
  }
}
```

#### `ak_blockchain_mint`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| rpcUrl | string | yes |
| card | string | yes |
| owner | string | no |
| contract | string | no |
| tokenId | string | no |
| fixtureChainId | string | no |
| fixtureMint | string | no |
| out | string | no |
| outDir | string | no |

Example call:

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "card": "tests/fixtures/cards/card-v1-basic.json",
  "tokenId": "card-1",
  "fixtureChainId": "tests/fixtures/adapters/chain-id.json",
  "fixtureMint": "tests/fixtures/adapters/mint.json",
  "outDir": "/tmp/agent-kernel/blockchain-mint"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "blockchain-mint",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/blockchain-mint",
  "artifactPaths": {
    "response": "/tmp/agent-kernel/blockchain-mint/blockchain-mint.json"
  }
}
```

#### `ak_blockchain_load`

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| rpcUrl | string | yes |
| tokenId | string | yes |
| owner | string | no |
| contract | string | no |
| fixtureChainId | string | no |
| fixtureLoad | string | no |
| out | string | no |
| outDir | string | no |

Example call:

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "tokenId": "card-1",
  "fixtureChainId": "tests/fixtures/adapters/chain-id.json",
  "fixtureLoad": "tests/fixtures/adapters/load.json",
  "outDir": "/tmp/agent-kernel/blockchain-load"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "blockchain-load",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/blockchain-load",
  "artifactPaths": {
    "response": "/tmp/agent-kernel/blockchain-load/blockchain-load.json"
  }
}
```

### Sandbox / Interactive

Purpose: drive the interactive Phaser sandbox (session creation, entity placement, actor movement, pushing a compiled bundle to a connected browser UI) and step/inspect a run's tick cursor for a live harness session.

#### `ak_sandbox_create`

Creates a standalone sandbox session with budget enforcement. Requires `budgetReceipt` or `budget`. Returns `ok: false` with `budgetInsufficient: true` if the budget is denied or zero-token.

Schema:

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| budgetReceipt | string | no | BudgetReceiptArtifact path (preferred when a receipt already exists) |
| budget | string | no | BudgetArtifact path (alternative to budgetReceipt) |
| width | integer | no | Default room width in tiles (default 10) |
| height | integer | no | Default room height in tiles (default 10) |
| entityCategories | string[] | no | Allowed: delver, warden, hazard, resource |
| outDir | string | no | Output directory override |
| runId | string | no | Run id override |
| createdAt | string | no | ISO-8601 timestamp |

Example call:

```json
{
  "budget": "tests/fixtures/artifacts/budget-artifact-v1-basic.json",
  "width": 10,
  "height": 10,
  "outDir": "/tmp/agent-kernel/sandbox"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "sandbox-create",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/sandbox",
  "artifactPaths": {
    "session": "/tmp/agent-kernel/sandbox/sandbox-session.json"
  }
}
```

#### `ak_sandbox_place`

Places and configures an entity in an existing sandbox session. Returns `ok: false` with `outOfBounds: true` when the position exceeds room dimensions.

Schema:

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| session | string | yes | Path to the sandbox-session.json file created by `ak_sandbox_create` |
| entityType | string | yes | One of delver, warden, hazard, resource |
| spec | string | yes | Semicolon-delimited key=value spec; required fields id, x, y, plus entity-specific fields |

Example call:

```json
{
  "session": "/tmp/agent-kernel/sandbox/sandbox-session.json",
  "entityType": "delver",
  "spec": "id=delver_1;x=1;y=1;affinity=water;motivation=exploring"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "sandbox-place",
  "session": "/tmp/agent-kernel/sandbox/sandbox-session.json",
  "entityType": "delver",
  "entityId": "delver_1"
}
```

#### `ak_sandbox_move`

Composes a single-tile move for an actor and appends it to the ActionSequence at `actionsOut` (created if absent). Returns `ok: false` with `blockedByWall: true`, `actorNotFound: true`, or `outOfBounds: true` for the corresponding failure.

Schema:

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| session | string | yes | Path to the sandbox-session.json file |
| actorId | string | yes | Must match an actor id in the session's InitialState |
| direction | string | yes | One of north, northeast, east, southeast, south, southwest, west, northwest |
| actionsOut | string | yes | ActionSequence JSON output path |

Example call:

```json
{
  "session": "/tmp/agent-kernel/sandbox/sandbox-session.json",
  "actorId": "delver_1",
  "direction": "east",
  "actionsOut": "/tmp/agent-kernel/sandbox/actions.json"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "sandbox-move",
  "actorId": "delver_1",
  "direction": "east",
  "actionsOut": "/tmp/agent-kernel/sandbox/actions.json"
}
```

#### `ak_push_to_ui`

Delivers a compiled `agent-kernel/GameplayBundle` (produced by `ak_create` + `ak_run`) to the connected browser UI over the sandbox WebSocket bridge. Accepts an explicit `bundlePath`, an `outDir` containing `bundle.json`, or an inline `bundle` object. Returns `ok: false` with `bundleNotFound: true`, `SANDBOX_UI_NOT_CONNECTED`, or `SANDBOX_BRIDGE_START_FAILED` for the corresponding failure.

> The bridge is a raw WebSocket port opened directly by the MCP server process and requires the browser loading the UI to reach that same port on the same machine. If the MCP server runs in a different network namespace than the calling harness's own browser/preview surface, prefer `ak_show_state` / `ak_tick_forward` / `ak_tick_backward` with a `visualization` mode instead — those return state over the MCP response itself, with no second network hop.

Schema:

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| outDir | string | no | Run or create outDir containing bundle.json |
| bundlePath | string | no | Explicit path to a GameplayBundle JSON file |
| bundle | object | no | Inline GameplayBundle object; takes precedence over bundlePath/outDir |
| targetTab | string | no | design or gameplay; defaults to gameplay |
| requireClient | boolean | no | Fail immediately if no browser UI is connected; default true |
| openBrowser | boolean | no | Serve the UI and open it in the default browser, pre-staging the bundle; implies requireClient: false |
| correlationId | string | no | Caller-supplied correlation ID echoed back in the result |

Example call:

```json
{
  "outDir": "/tmp/agent-kernel/run",
  "targetTab": "gameplay"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "push-to-ui",
  "targetTab": "gameplay",
  "delivered": true
}
```

#### `ak_show_state`, `ak_tick_forward`, `ak_tick_backward`

Step and inspect a run's interactive tick cursor. `ak_tick_forward`/`ak_tick_backward` return `ok: false` with an error message when already at `maxTick`/tick 0. All three accept an optional `visualization` mode: `ascii` returns layered ASCII detail with actor details; `image` returns a PNG data URI.

Schema:

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| runId | string | yes | Run ID to inspect or advance/rewind the session cursor for |
| visualization | string | no | ascii or image |

Example call:

```json
{
  "runId": "run_123",
  "visualization": "ascii"
}
```

Expected output shape (`ak_show_state`):

```json
{
  "ok": true,
  "command": "tick",
  "action": "state",
  "runId": "run_123",
  "tick": 2,
  "maxTick": 4,
  "ascii": "...",
  "tickFrame": {}
}
```

### Test Authoring

Purpose: inventory, discover, scaffold, run, and lint the repo's structured test recipes (see `AGENTS.md` and `tests/README.md`). Reach for these instead of hand-writing test files — the `structured-test-authoring` skill covers the workflow.

#### `ak_test_list_suites`

Lists discovered test suites and current runner ownership from the inventory report. No input parameters.

Expected output shape:

```json
{
  "ok": true,
  "inventoryPath": "local-codex/test-inventory.json",
  "classificationPath": "local-codex/test-classification.json",
  "summary": {},
  "recipes": [],
  "scaffoldableRecipes": ["cli_success_artifacts", "cli_failure_message"]
}
```

#### `ak_test_discover_patterns`

Discovers repo test recipes and matching files, optionally filtered.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| runner | string | no |
| suite | string | no |
| recipe | string | no |

Expected output shape:

```json
{
  "ok": true,
  "count": 12,
  "files": [],
  "recipes": []
}
```

#### `ak_test_plan_from_change`

Recommends runner scopes from changed repository-relative paths.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| paths | string[] | yes |

Example call:

```json
{
  "paths": ["packages/runtime/src/personas/allocator/state-machine.js"]
}
```

Expected output shape:

```json
{
  "ok": true,
  "runners": ["vitest"],
  "suites": ["runtime"]
}
```

#### `ak_test_run`

Runs the test harness inventory, Vitest, legacy, or combined matrix scripts.

Schema:

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| mode | string | yes | One of inventory, classify, coverage, recipe-adoption, parity, vitest, legacy, all |
| args | string[] | no | Additional args passed to the selected runner script |

Expected output shape:

```json
{
  "ok": true,
  "mode": "vitest",
  "status": 0,
  "stdout": "...",
  "stderr": ""
}
```

#### `ak_test_scaffold_case` / `ak_test_insert_case`

Scaffold a new test file, or append a scaffolded case to an existing one, from a limited structured recipe set. `recipe`, `targetFile`, and `title` are always required; every other field is recipe-specific (e.g. `commandArgs`/`expectedArtifacts` for `cli_success_artifacts`, `modulePath`/`exportName`/`inputJson` for `budget_policy_invariant`) — see `packages/adapters-cli/src/mcp/tools/testing.mjs` for the full per-recipe field list, or call `ak_test_list_suites` for the current `scaffoldableRecipes`.

Example call:

```json
{
  "recipe": "cli_success_artifacts",
  "targetFile": "tests/adapters-cli/example-new-case.test.js",
  "title": "ak_create writes the canonical artifact set",
  "commandArgs": ["create", "--text", "Create one fire delver.", "--dry-run"],
  "expectedArtifacts": ["spec.json"]
}
```

Expected output shape:

```json
{
  "ok": true,
  "targetFile": "tests/adapters-cli/example-new-case.test.js",
  "recipe": "cli_success_artifacts"
}
```

#### `ak_test_explain_failure`

Classifies a test failure from runner output into a small set of migration-focused categories.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| text | string | yes |

Expected output shape:

```json
{
  "ok": true,
  "explanation": {
    "kind": "unknown",
    "summary": "Failure did not match a built-in classifier."
  }
}
```

#### `ak_test_lint_structure`

Reports structural migration gaps: uncategorized recipes and codemod exceptions. No input parameters.

Expected output shape:

```json
{
  "ok": true,
  "uncategorizedCount": 0,
  "uncategorized": [],
  "codemodExceptionCount": 0,
  "codemodExceptions": [],
  "recipeAdoption": {},
  "scaffoldableRecipes": []
}
```

### Workflow

Purpose: run and manage `AdaptiveWorkflowAgent` through the controlled CLI adapter, and read/replay/cancel its durable run state. Every `ak_workflow_*` tool maps to the `workflow <action>` CLI command; `status`/`replay`/`cancel` require either `outDir` or `runId` (a remembered workflow run id resolves to its outDir automatically).

#### `ak_workflow_run`

Runs `AdaptiveWorkflowAgent`. Requires exactly one of `input` or `objective`.

Schema:

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| input | string | one of input/objective | AdaptiveWorkflowCliRunInput fixture path |
| objective | string | one of input/objective | Workflow objective |
| policy | string | no | Strategy policy path |
| runtimeProfile | string | no | Runtime profile path |
| model | string | no | Model override |
| maxModelAttempts | integer | no | Bounded model attempts, minimum 1 |
| outDir | string | no | Durable run directory; MCP temp storage used when omitted |
| runId | string | no | Run id |
| createdAt | string | no | ISO-8601 timestamp |

Example call:

```json
{
  "objective": "Plan a small fire dungeon.",
  "outDir": "/tmp/agent-kernel/workflow"
}
```

Expected output shape:

```json
{
  "ok": true,
  "command": "workflow",
  "action": "run",
  "runId": "run_xxx",
  "outDir": "/tmp/agent-kernel/workflow"
}
```

#### `ak_workflow_status` / `ak_workflow_replay`

Read durable workflow status, or replay a run from recorded model content without live IO. Requires `outDir` or `runId`.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| outDir | string | one of outDir/runId |
| runId | string | one of outDir/runId |

Expected output shape:

```json
{
  "ok": true,
  "command": "workflow",
  "action": "status",
  "outDir": "/tmp/agent-kernel/workflow",
  "status": "completed"
}
```

#### `ak_workflow_cancel`

Requests cancellation through durable workflow state. Requires `outDir` or `runId`.

Schema:

| Parameter | Type | Required |
| --- | --- | --- |
| outDir | string | one of outDir/runId |
| runId | string | one of outDir/runId |
| reason | string | no |

Expected output shape:

```json
{
  "ok": true,
  "command": "workflow",
  "action": "cancel",
  "outDir": "/tmp/agent-kernel/workflow",
  "cancelled": true
}
```

#### `ak_workflow_validate`

Validates workflow input without making model or execution calls. Same schema as `ak_workflow_run`.

Expected output shape:

```json
{
  "ok": true,
  "command": "workflow",
  "action": "validate",
  "valid": true
}
```

## Artifact Output

Artifact-producing tools generally return this canonical shape:

```json
{
  "ok": true,
  "command": "create",
  "runId": "run_abc123",
  "outDir": "/absolute/path/to/artifacts/runs/run_abc123/create",
  "artifactPaths": {
    "spec": "/absolute/path/to/spec.json",
    "manifest": "/absolute/path/to/manifest.json"
  }
}
```

Field meanings:

| Field | Type | Meaning |
| --- | --- | --- |
| ok | boolean | Command succeeded |
| command | string | Underlying CLI command name |
| runId | string | Run id associated with the artifact set |
| outDir | string | Output directory written by the command |
| artifactPaths | object | Named paths for produced artifacts |

Important nuances:

- The MCP wrapper always returns structured JSON in `structuredContent`.
- If the CLI emits a JSON object, the MCP server forwards it directly.
- If the CLI emits plain text only, the server wraps it as `{ ok, command, stdout }`.
- Query-style tools such as `ak_show`, `ak_diff`, and `ak_runs_list` return command-specific summary objects rather than a uniform `artifactPaths` map.
- When stderr exists and the JSON payload does not already include `stderr`, the MCP server adds it.

## Configuration

### Defaults

| Setting | Default | Source |
| --- | --- | --- |
| LLM model | phi4 | packages/runtime/src/contracts/domain-constants.js |
| LLM base URL | http://localhost:11434 | packages/runtime/src/contracts/domain-constants.js |
| IPFS gateway | https://ipfs.io/ipfs | packages/adapters-cli/src/mcp/tools/shared.mjs |
| Default output root | artifacts/runs/<runId>/<command> | CLI default |

### Environment overrides

Supported environment variables come from the CLI/runtime layer that the MCP server delegates to:

| Variable | Effect |
| --- | --- |
| AK_LLM_MODEL | Default model for LLM commands when model is omitted |
| AK_LLM_BASE_URL | Default base URL for LLM commands when baseUrl is omitted |
| AK_LLM_FORMAT | Format override passed into the LLM command layer |
| AK_LLM_LIVE | Enables live LLM planning flows that otherwise require fixtures |
| AK_LLM_STRICT | Enables stricter LLM validation in CLI/runtime flows |
| AK_LLM_BUDGET_LOOP | Default-enable budget loop behavior in planner flows |
| AK_ALLOW_NETWORK | Allows live network-backed adapter calls instead of fixture-only mode |
| AK_SCHEMA_CATALOG_TIME | Overrides schema catalog generation time for deterministic output |

Notes:

- The MCP server itself does not add its own config layer. It inherits CLI/runtime env behavior.
- IPFS gateway does not have an env override in the MCP layer. Override it per call using the `gateway` input field.
- Blockchain RPC does not have a repo-wide default. You must pass `rpcUrl`.

## Integration with `~/.agents` Skills

Harness-specific snippets live in `~/.agents/skills/agent-kernel/`, especially `mcp.md` for MCP registration and tool-selection guidance.

## Architecture Note

This MCP server lives in the adapters layer. It exposes the CLI command surface over stdio and delegates into the existing command/runtime entrypoints; it does not introduce a new runtime path and it does not talk directly to `core-ts`. In the Ports & Adapters stack, it is an adapter-facing transport wrapper around CLI operations, with runtime remaining behind the existing command boundary.
