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

Open `http://localhost:8001/packages/ui-web/index.html`.

The UI uses Design, Preview, Run, and Diagnostics. Preview and Run use the synchronous TypeScript core path and do not require a separate binary build.

## 4) Reading the Gameplay Board

Board entities carry **two** visual channels, and only two:

| Channel | What it shows |
|---|---|
| silhouette | role — `delver` up-triangle, `warden` hexagon, `hazard` down-triangle, `resource` diamond |
| fill colour | the entity's single equipped affinity |

Everything else — the four vitals, the affinity expression, the motivation —
appears in the **HUD** at the bottom-left of the board, for one entity at a time:

- **Click** an entity to select it. The HUD shows it and stays.
- **Hover** any entity to preview it in the same HUD; moving off returns the HUD
  to whatever is selected.
- The HUD is fixed to the camera, so panning and zooming the board never move or
  shrink it. Vital bars update as the simulation ticks.
- Only the vitals a role actually has are shown — a hazard has `mana` and
  `durability`, so it shows two bars, not four.

Zoom is clamped so a tile never renders below 12px, the size at which the four
silhouettes stop being distinguishable. On very large levels this means the whole
level may not fit on screen at once; pan to see the rest.

