# Medallion-era visual assets — archived 2026-09-02

A frozen, browsable record of the sprite imagery used before the minimal sprite language
(`interface-refinement.md`). **Nothing here is live.** Nothing imports it, no test reads it, and no
build step touches it. It exists so the previous art is not lost to `git log` archaeology.

Retired at `ba292f3` on `feat/minimal-sprite-language-hud`.

## What the medallion encoded

One 32×32 tile carried **eight independent dimensions**:

| Dimension | Cardinality | Encoding |
|---|---|---|
| Role | 2 (delver, warden) | Central silhouette |
| Affinity | 10 | Inner glyph + hue |
| Expression | 4 | Corner triangles |
| Motivation | 12 | Secondary glyph |
| Durability | continuous | Top edge bar |
| Health | continuous | Right edge bar |
| Stamina | continuous | Bottom edge bar |
| Mana | continuous | Left edge bar |

## Why it was retired

Not for lack of craft — the 64px renders are good. It is an information-density limit.
`DEFAULT_TILE_SIZE` is 32, but the gameplay camera clamps to `MIN_CAMERA_ZOOM = 0.25`, so an actor
can occupy **8×8 physical pixels**. Eight dimensions do not fit in 64 pixels, and no art can make
them. `contact-sheet.png` shows it: legible at 64px, muddy at 32px, noise at 16px.

The replacement keeps two channels on the sprite (role → silhouette, affinity → fill) and moves
expression, motivation and all four vitals to a camera-fixed HUD.

## Contents

| Path | What |
|---|---|
| `visual-assets/` | Complete copy of `packages/runtime/src/render/visual-assets/` — actors, tiles, overlays, misc, cards, actor-medallion components. 424 PNGs at `hud` (16px), base (32px) and `large` (64px). |
| `source-assets/` | Copy of `packages/runtime/src/render/source-assets/` — the hand-authored component sheets the generator consumed. |
| `actor-medallion-composer.frozen.js` | The generator, runnable. |
| `actor-medallion-composer.frozen.ts` | Its TypeScript source, as a record. |
| `render-contact-sheet.mjs` | Regenerates `contact-sheet.png` from the frozen composer. |
| `contact-sheet.png` | 6 subjects × 64/32/16px. The evidence for retirement. |
| `preview-evidence/` | Renders rescued from `local-codex/`, which is **gitignored** — these existed only on one machine. Includes the original medallion contact sheet, the component contact sheet, the seeker/keeper silhouette explorations, and the algorithmic-vs-reference affinity glyph study. |

## Regenerating

```bash
node docs/design/archive/2026-09-medallion-era/render-contact-sheet.mjs
```

`actor-medallion-composer.frozen.js` is **self-contained**. The original imported
`{ AFFINITY_COLOR_HEX, hexToRgba }` from `../affinity-palette.js`, which chains into `contracts/`;
that import is inlined with the **medallion-era palette values** so the file keeps working after the
live palette is re-derived. Do not "fix" those colours to match the current palette — they are the
record of what the medallion actually looked like.

## Notes for whoever reads this next

- **The PNGs were never read at runtime.** `packages/runtime/src/render/generated/{affinity,game}-sprite-assets.js`
  carry every image base64-inlined; the `relativePath` fields beside them are metadata that nothing
  opens. The PNG trees are source material for an out-of-repo generator
  (`ak-sprite-art-director/scripts/generate-game-resource-sprites.py`). So this archive is a copy,
  not a move — the live trees stay where they are until the code that describes them is replaced,
  and copying could not have broken anything.
- **`local-codex/` is gitignored.** Anything under it exists on one machine only. `preview-evidence/`
  is the rescued subset; if you generate new design evidence, put it under `docs/design/`.
