# IPFS Package Lifecycle

This document defines the canonical IPFS packaging model for generated `agent-kernel` artifacts.

## Package model

Every publish creates one immutable root package CID with two logical areas:

- `core/`: files required to start or regenerate a game definition
- `sessions/`: checkpointed runtime state required to resume an in-progress session

Canonical layout:

```text
<root CID>/
  ipfs-package.json
  core/
    bundle.json
    manifest.json
    spec.json
    intent.json
    plan.json
    sim-config.json
    initial-state.json
    resource-bundle.json
    affinity-rules.json
    telemetry.json
    budget.json
    price-list.json
    budget-receipt.json
    budget-allocation.json
    solver-request.json
    solver-result.json
    affinity-summary.json
    captured-input-*.json
  sessions/
    index.json
    <sessionId>/
      session-manifest.json
      checkpoints/
        <checkpointId>/
          checkpoint-state.json
          action-log.json
          run-summary.json
          runtime-decision-captures.json
          resolved-sim-config.json
          resolved-initial-state.json
          tick-frames.json
          effects-log.json
          replay-summary.json
          replay-tick-frames.json
          inspect-summary.json
          captured-input-*.json
```

`ipfs-publish` supports three scopes:

- `core`: publish only the `core/` tree plus `ipfs-package.json`
- `session`: publish `core/` plus one `sessions/<sessionId>/...` checkpoint tree
- `package`: explicit full-package publish; when both core and session artifacts are provided, the command can infer this scope

## File classification

### Core game files

Core files are the files needed to start or reconstruct the authored game definition.

Required when present:

- `bundle.json`
- `manifest.json`
- `spec.json`
- `intent.json`
- `plan.json`
- `sim-config.json`
- `initial-state.json`
- `resource-bundle.json`
- `affinity-rules.json` when an authored balance file is part of the game definition
- `telemetry.json`
- build-time `captured-input-*.json` files

Optional core provenance:

- `budget.json`
- `price-list.json`
- `budget-receipt.json`
- `budget-allocation.json`
- `solver-request.json`
- `solver-result.json`
- `affinity-summary.json`

### Session-required files

Session-required files are the minimum set needed to resume a saved run checkpoint.

- `checkpoint-state.json`
- `action-log.json`
- `run-summary.json`
- `runtime-decision-captures.json` when runtime reasoning occurred
- `resolved-sim-config.json` when runtime overrides changed the effective simulation
- `resolved-initial-state.json` when runtime overrides changed the effective initial state

### Session-optional files

These are audit/debug/replay-support files and are not required for resume:

- `tick-frames.json`
- `effects-log.json`
- `replay-summary.json`
- `replay-tick-frames.json`
- `inspect-summary.json`
- runtime-only `captured-input-*.json`

## Canonical artifacts

The package flow introduces three stable artifact contracts:

- `agent-kernel/IpfsPackageArtifact`
  - stored as `ipfs-package.json`
  - records core file classification and latest session pointers
- `agent-kernel/IpfsSessionManifestArtifact`
  - stored as `sessions/<sessionId>/session-manifest.json`
  - records required and optional checkpoint files
- `agent-kernel/RuntimeCheckpointArtifact`
  - stored as `checkpoint-state.json`
  - records resumable session metadata using `snapshot_plus_replay`

Notes:

- the stored `ipfs-package.json` does not self-embed its final root CID because the CID is only known after publication
- the publish command result is the authoritative resolved `cid`

## CLI flows

### Publish core package from canonical outputs

Build outputs already emit the expected core artifacts:

```bash
node packages/adapters-cli/src/cli/ak.mjs build \
  --spec tests/fixtures/artifacts/build-spec-v1-basic.json \
  --out-dir artifacts/runs/run_ipfs_core/build

node packages/adapters-cli/src/cli/ak.mjs ipfs-publish \
  --scope core \
  --core-dir artifacts/runs/run_ipfs_core/build \
  --fixture-cid bafyfixturecore \
  --out-dir artifacts/runs/run_ipfs_core/ipfs-publish
```

### Publish session checkpoint package

`run` now emits `checkpoint-state.json` as part of the canonical runtime output set:

```bash
node packages/adapters-cli/src/cli/ak.mjs run \
  --sim-config artifacts/runs/run_ipfs_core/build/sim-config.json \
  --initial-state artifacts/runs/run_ipfs_core/build/initial-state.json \
  --ticks 3 \
  --run-id run_ipfs_session \
  --out-dir artifacts/runs/run_ipfs_session/run

node packages/adapters-cli/src/cli/ak.mjs ipfs-publish \
  --scope session \
  --core-dir artifacts/runs/run_ipfs_core/build \
  --session-dir artifacts/runs/run_ipfs_session/run \
  --session-id run_ipfs_session \
  --checkpoint-id tick-3 \
  --fixture-cid bafyfixturesession \
  --out-dir artifacts/runs/run_ipfs_session/ipfs-publish
```

### Load core package

```bash
node packages/adapters-cli/src/cli/ak.mjs ipfs-load \
  --cid bafyfixturecore \
  --fixture-map tests/fixtures/adapters/ipfs-package-map.json \
  --out-dir artifacts/ipfs_load_core
```

### Load and resume session package

```bash
node packages/adapters-cli/src/cli/ak.mjs ipfs-load \
  --cid bafyfixturesession \
  --load-mode resume \
  --fixture-map tests/fixtures/adapters/ipfs-package-map.json \
  --out-dir artifacts/ipfs_load_resume
```

`resume` mode restores both:

- the core files needed to reconstruct the game
- the checkpoint files needed to restore the session

### Local live Kubo smoke test

For a real local publish/load test, this repo expects one base URL that supports both:

- `GET /ipfs/<cid>/...`
- `POST /api/v0/add`

Stock Kubo splits those between the gateway (`:8080`) and API (`:5001`), so use the
repo-local proxy. `pnpm run serve:ui` now ensures both Kubo and the proxy before
serving the UI, so that command is the default local startup path.

```bash
pnpm run serve:ui
```

If you want the static UI server without IPFS startup, use:

```bash
pnpm run serve:ui:static
```

The proxy listens on `http://127.0.0.1:8088` and forwards:

- `/ipfs/*` and `/ipns/*` to the Kubo gateway on `127.0.0.1:8080`
- `/api/v0/*` to the Kubo RPC API on `127.0.0.1:5001`

Use `http://127.0.0.1:8088/ipfs` as the CLI/UI gateway URL.

Core round trip:

```bash
node packages/adapters-cli/src/cli/ak.mjs build \
  --spec tests/fixtures/artifacts/build-spec-v1-basic.json \
  --out-dir artifacts/runs/run_ipfs_live_core/build

node packages/adapters-cli/src/cli/ak.mjs ipfs-publish \
  --scope core \
  --core-dir artifacts/runs/run_ipfs_live_core/build \
  --gateway http://127.0.0.1:8088/ipfs \
  --out-dir artifacts/runs/run_ipfs_live_core/ipfs-publish

node packages/adapters-cli/src/cli/ak.mjs ipfs-load \
  --cid <core-cid> \
  --gateway http://127.0.0.1:8088/ipfs \
  --out-dir artifacts/runs/run_ipfs_live_core/ipfs-load
```

Session resume round trip:

```bash
mkdir -p artifacts/runs/run_ipfs_live_session/core-input
cp tests/fixtures/artifacts/sim-config-artifact-v1-basic.json \
  artifacts/runs/run_ipfs_live_session/core-input/sim-config.json
cp tests/fixtures/artifacts/initial-state-artifact-v1-basic.json \
  artifacts/runs/run_ipfs_live_session/core-input/initial-state.json

node packages/adapters-cli/src/cli/ak.mjs run \
  --sim-config artifacts/runs/run_ipfs_live_session/core-input/sim-config.json \
  --initial-state artifacts/runs/run_ipfs_live_session/core-input/initial-state.json \
  --ticks 1 \
  --run-id run_ipfs_live_session \
  --out-dir artifacts/runs/run_ipfs_live_session/run

node packages/adapters-cli/src/cli/ak.mjs ipfs-publish \
  --scope session \
  --core-dir artifacts/runs/run_ipfs_live_session/core-input \
  --session-dir artifacts/runs/run_ipfs_live_session/run \
  --session-id run_ipfs_live_session \
  --checkpoint-id tick-1 \
  --gateway http://127.0.0.1:8088/ipfs \
  --out-dir artifacts/runs/run_ipfs_live_session/ipfs-publish

node packages/adapters-cli/src/cli/ak.mjs ipfs-load \
  --cid <session-cid> \
  --load-mode resume \
  --gateway http://127.0.0.1:8088/ipfs \
  --out-dir artifacts/runs/run_ipfs_live_session/ipfs-load
```

The publish adapter now adds `wrap-with-directory=true` so the returned root CID resolves
the canonical `ipfs-package.json` package root instead of a flattened file list.

## UI behavior

- Diagnostics remains the package inspection surface for IPFS-backed bundle/session loads and canonical bundle publish actions.
- Preview and Run consume the loaded core package on the same artifact rails used by CLI.
- Run can save a named checkpoint to IPFS and restore a checkpoint package by CID through the shared browser command host.
- Session restore uses `checkpoint-state.json` plus `action-log.json` on the deterministic playback rail.

## Determinism rules

- package publication is checkpoint-based, not continuous
- session resume is `snapshot_plus_replay`
- replay log remains the verification rail
- optional live IPFS service access is not part of the minimum-install baseline; fixture mode remains valid for testing
