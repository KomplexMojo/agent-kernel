# Human Interfaces Quickstart (CLI + terminal client)

Offline-first steps to exercise the CLI demos and the terminal client using fixtures.

## 1) Install and Test

```bash
pnpm install
pnpm run test
```

## 2) Run CLI Demos

```bash
node packages/adapters-cli/src/cli/agon.mjs solve --scenario "two actors conflict" --solver-fixture tests/fixtures/artifacts/solver-result-v1-basic.json
node packages/adapters-cli/src/cli/agon.mjs llm --model fixture --prompt "hello" --fixture tests/fixtures/adapters/llm-generate.json
```

Bundle fixture demos:

```bash
pnpm run demo:cli
```

## 3) Graphical clients

The browser UI (Design, Preview, Run, Diagnostics) was archived in the private Primordial repository
(#744), with the phone app and the graphical clients. In this repository, play and watch runs with the
reference terminal client (`pnpm run play:ascii`, `agon play`).

## Runtime Cost Display Contract (T3.0)

T3.1a/T3.1b established and persist the Allocator-issued `RuntimeBudgetReceiptArtifact` v1 in run
output. CLI inspection exposes that artifact (the archived web actor inspector did too). An inspector presents
the selected actor's supplied total, the unattributed subtotal, and the run total in a separate
runtime-accounting section labelled `runtimeBudgetUnits`; it is distinct from authored card value and
provider prompt/completion telemetry. Presentation code must not recalculate prices or totals.

These units describe accepted runtime work (`wait`, `attack`, `cast_affinity`, solver requests, and
other actions). They are separate from authoring/build tokens and provider prompt/completion-token
telemetry. Accepted moves and all rejected actions appear as zero-unit rows; zero means exempt or
rejected, not missing data. Neither CLI nor UI runtime-cost display is inferred from the existing
category budget ledger.
