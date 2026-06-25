# Human Interfaces Quickstart (CLI + Web UI)

Offline-first steps to exercise the CLI demos and web UI using fixtures.

## 1) Install and Test

```bash
pnpm install
pnpm run test
```

## 2) Run CLI Demos

```bash
node packages/adapters-cli/src/cli/ak.mjs solve --scenario "two actors conflict" --solver-fixture tests/fixtures/artifacts/solver-result-v1-basic.json
node packages/adapters-cli/src/cli/ak.mjs llm --model fixture --prompt "hello" --fixture tests/fixtures/adapters/llm-generate.json
```

Bundle fixture demos:

```bash
pnpm run demo:cli
```

## 3) Serve the Web UI

```bash
pnpm run serve:ui
```

Open `http://localhost:8001/packages/ui-web/index_c.html`.

The UI uses Design, Preview, Run, and Diagnostics. Preview and Run use the synchronous TypeScript core path and do not require a separate binary build.
