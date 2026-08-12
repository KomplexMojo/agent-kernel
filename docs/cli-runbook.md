# CLI Runbook

The CLI is a Node adapter over the shared runtime command kernel. It uses fixture-backed adapters by default and the synchronous `core-ts` package for simulation.

## Setup

```bash
pnpm install
pnpm run test
```

## Common Commands

```bash
node packages/adapters-cli/src/cli/ak.mjs schemas
node packages/adapters-cli/src/cli/ak.mjs solve --scenario "two actors conflict" --solver-fixture tests/fixtures/artifacts/solver-result-v1-basic.json
node packages/adapters-cli/src/cli/ak.mjs build --spec tests/fixtures/artifacts/build-spec-v1-basic.json
node packages/adapters-cli/src/cli/ak.mjs run --sim-config tests/fixtures/artifacts/sim-config-artifact-v1-configurator-hazard.json --initial-state tests/fixtures/artifacts/initial-state-artifact-v1-configurator-affinity.json --ticks 1
node packages/adapters-cli/src/cli/ak.mjs inspect --tick-frames artifacts/runs/<runId>/run/tick-frames.json
```

## Fixture Adapters

Use fixture flags to keep runs deterministic:

```bash
node packages/adapters-cli/src/cli/ak.mjs ipfs --cid bafy... --json --fixture tests/fixtures/adapters/ipfs-price-list.json
node packages/adapters-cli/src/cli/ak.mjs blockchain --rpc-url http://local --address 0xabc --fixture-chain-id tests/fixtures/adapters/blockchain-chain-id.json --fixture-balance tests/fixtures/adapters/blockchain-balance.json
node packages/adapters-cli/src/cli/ak.mjs llm --model fixture --prompt "hello" --fixture tests/fixtures/adapters/llm-generate.json
```

## Validation

```bash
pnpm run test
pnpm run test:coverage:core-ts
pnpm run benchmark:core-ts-affinity
```
