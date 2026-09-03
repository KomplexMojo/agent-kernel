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

The level screen is the whole viewport — the inventory rail no longer shares it.
Loading a run frames the **whole level**, scaled to fill the screen, which is the
same view the **Fit** control returns to. A level that is not the viewport's
aspect ratio fills the constraining axis and leaves margin on the other.

The selected entity's HUD sits in the **top-right**, clear of the level. (It previously framed only the room containing the spawn,
which made a multi-room level look like a single room until you zoomed out.)

Zoom is clamped so a tile never renders below 12px, the size at which the four
silhouettes stop being distinguishable. On very large levels — past roughly 46
tiles a side — this means the whole level may not fit on screen at once; pan to
see the rest.

Press **Ctrl+3** for the **inventory screen**: a full-width screen
listing every card grouped by type, with per-group spend and remaining budget.
Each row carries that entity's HUD laid out across it — affinity · expression,
its vitals as side-by-side bars, motivation and token cost — so an entity can be
read without finding and selecting it on the board. Escape or the same key closes it.

Screens are on **Ctrl+<digit>**: Ctrl+1 Design, Ctrl+2 Gameplay, Ctrl+3 Inventory.
Ctrl+digit is used because it is free on macOS, where the browser's own tab
switching is Cmd+digit. The inventory was previously on ⌘} — which is literally
Cmd+Shift+], a chord macOS browsers reserve for "next tab" — so the keypress
never reached the page and the screen could not be opened at all. On Windows and
Linux, Chrome binds Ctrl+1..8 to tab switching, so these chords would need
revisiting there.


## 5) The Design Screen's Shelve Control

Once a card has a type, a **Shelve as \<type\>** button sits in the **top-right
corner of the editor panel**, right-aligned to the panel's edge. Clicking it
moves the card out of the editor and into that group in the inventory rail.

It is pinned there deliberately. It used to be an unlabelled 22px square at the
end of the editor's content flow, so its position moved with the card — a delver
carrying two motivation rows put it 32px below where a warden with one row did —
and its label only appeared on hover. A control that lands somewhere different
per card, with nothing on it to read, cannot be aimed at from memory. The button
grows leftwards as the type name lengthens so its right edge never moves.
