# `runtime/src/render` — visual semantics

Everything in this directory decides **what a thing looks like and why**. Nothing
here does IO, touches a canvas, or knows about Phaser. `ui-web` draws what these
modules return; it does not decide meaning (charter → *Phaser UI Layer*).

The split matters because it has failed before: colour tables kept drifting into
`ui-web` copies, and one of them — the affinity palette in
`views/tile-affinity-visuals.js` — had silently diverged on three of ten values,
so board tints disagreed with every other surface until M2 (2026-09-02).

## The board sprite

`entity-sprite-composer.js` composes an entity's board sprite as RGBA pixels.

**It carries exactly two channels, and that is the design:**

| Channel | Encoding | Roles / values |
|---|---|---|
| role | silhouette shape | `delver ▲` · `warden ⬢` · `hazard ▼` · `resource ◆` |
| affinity | flat fill colour | the ten kinds in `GAME_AFFINITY_COLOR_HEX` |

It replaced `actor-medallion-composer.js`, which encoded **eight** dimensions
(role, affinity, expression, motivation and four vitals) in one 32×32 tile. With
the camera zoomed out that is ~64 physical pixels, and eight channels do not fit
in 64 pixels: the medallion was legible at 64px, muddy at 32px and noise at 16px.
The retired art, the frozen generator and the measurement are in
[`docs/design/archive/2026-09-medallion-era/`](../../../../docs/design/archive/2026-09-medallion-era/README.md).

**Do not widen `EntitySpriteState`.** It has fields for `role` and `affinity` and
nothing else, and `tests/runtime/entity-sprite-composer.test.mts` asserts that
passing vitals, expression or motivation changes not one byte — through *both*
entry points, because the `state` path re-normalizes and would otherwise pass
vacuously. Anything you are tempted to add belongs in the HUD.

**Outline.** Chosen from the fill's lightness, not fixed. A single near-white
outline measured ΔE 23.4 against the near-white `light` fill, making a `light`
sprite an edgeless white blob. Division of labour: the **fill** separates the
sprite from the board, the **outline** separates the silhouette's edge from its
own fill.

**Size floor.** Silhouettes are guaranteed distinct down to **12px** and no
further — below that `warden`, `hazard` and `resource` collapse to the same blob.
`MIN_CAMERA_ZOOM` in the gameplay renderer defends that floor.
`scripts/design/render-sprite-sheet.mjs` renders the evidence, including an 8px
column showing what the floor prevents.

## The HUD

`actor-hud-model.js` builds the view-model for the selected-entity HUD: the
vitals, expression and motivation the sprite deliberately no longer carries.

Ordering, two-letter labels, colours, fraction derivation and **which vitals a
role even has** are semantics and live here. Vital key sets differ by role —
a hazard reports only `mana` and `durability`, so drawing four bars would invent
two of them.

Output is plain serializable data: no functions, no class instances.

## UI icons

`icon-model.js` decides what a UI chip icon means. It reuses the board's rules —
role silhouettes and affinity fills — so the left rail and the board speak one
language, and `ui-web/src/icon-resolver.js` draws the result as inline SVG.

Three kinds come back, and the split is deliberate:

| kind | Categories | Why |
|---|---|---|
| `shape` | types, items, affinities, vitals, expressions | Generated geometry. Roles reuse the board silhouettes; expressions are directional (push/pull/emit/draw) so their geometry is near-literal. |
| `glyph` | motivations | A monochrome mark in the same chip. Abstract, and a generated family scheme provably cannot cover twelve: four family shapes × a filled/hollow split is eight slots. |
| `text` | ui | Outside the chip system entirely. |

**Colour does not mean the same thing in every category, and the model says so.**
For roles and affinities colour *is* identity, so the glyph is drawn in it with the
board outline. For expressions and motivations it is not — those palettes collide
(expressions worst pair ΔE 10.0, motivations ΔE 7.2) — so the glyph uses
`ICON_NEUTRAL_INK` and the colour is demoted to the disc wash. Drawing them in
their own near-identical colours would imply a distinction that is not there.

Two mechanics that are easy to break:

- The SVG carries **explicit 64×64 dimensions**, not `width="100%"`. The same
  markup is rasterised into a Phaser texture for the card rail, where a
  percentage has no containing block and the image ends up with no intrinsic
  size. CSS (`.icon-generated`) scales it to fill its chip in the DOM.
- The disc uses `fill` + `fill-opacity`, not `color-mix` on `currentColor`, for
  the same reason: there is no inherited colour in a rasterised context.

## Colour

Board tiles are **flat fills** from `GAME_COLOR_PALETTE.tiles` — the renderer draws
no tile PNGs. `tiles` holds fills (backgrounds a sprite stands on, and the exact set
the affinity-contrast gate iterates); `tileBorders` holds strokes, judged against the
floor rather than against affinities.

There is **one** origin for colour: `GAME_COLOR_PALETTE` and
`GAME_AFFINITY_COLOR_HEX` in `../contracts/game-elements.js`. `affinity-palette.js`
re-exports the affinity half and adds stack-intensity rules.

`tests/runtime/affinity-palette-separation.test.js` enforces the properties that
make the palette usable, measured rather than frozen, so a better palette still
passes:

| Gate | Floor | Achieved |
|---|---|---|
| pairwise ΔE across all 45 pairs | 45 | 53.0 |
| every affinity vs **every** tile colour | 30 | 30.7 |
| wall border vs floor | 45 | 69.7 |
| `AFFINITY_OPPOSITES` pairs | 90 | 103.1 |
| outline vs fill | 40 | 42.9 |
| affinity labels vs the UI panel | WCAG AA 4.5:1 | 4.55:1 |

Opposition is carried on three axes, because ten hues do not fit one wheel:
**hue** (fire/water, earth/wind, life/decay), **chroma** (corrode acid vs fortify
inert steel), **lightness** (light near-white vs dark charcoal).

Text colours are **not** the fills. A fill answers to the dark board tiles; a
label answers to the dark UI panel by contrast ratio. Mirroring the fills left
`earth` at 2.18:1 and `dark` at 1.09:1, so three have overrides.

To change a colour, re-run `scripts/design/derive-affinity-palette.mjs` (seeded
and reproducible), check `docs/design/affinity-palette-sheet.png`, and let the
guard confirm it. Do not hand-edit a value.

## Other modules

| Module | Owns |
|---|---|
| `resource-bundle.js` | Assembling the versioned `ResourceBundleArtifact`, including inlined asset data URIs. |
| `affinity-palette.js` | Affinity colour re-export and stack-intensity tiers. |
| `affinity-aura.js` | Legacy JS aura output, retained for compatibility only — new surfaces must use `core-ts` field records. |
| `affinity-tile-mask.js`, `affinity-spatial-formulas.js` | Tile-level affinity geometry. |
| `visualization-snapshot.js` | ASCII/state snapshot assembly. |
| `actor-medallion-composer.js` | **Retired for the board.** Still used by `resource-bundle.js` to emit medallion component assets. Do not use it for new surfaces. |

## Assets

`visual-assets/` and `source-assets/` are **source material for an out-of-repo
generator**, not runtime inputs. Every image the runtime serves is already
base64-inlined into `generated/{affinity,game}-sprite-assets.js`; the
`relativePath` fields beside them are metadata nothing opens.
