# Plan — Interface Refinement: Minimal Sprite Language + Selected-Actor HUD

**Branch:** `feat/minimal-sprite-language-hud`
**Opened:** 2026-09-02
**Status:** PLANNED — no code written yet

---

## ⏭️ START HERE

Nothing is implemented. Work begins at **M0**. Milestones are strictly ordered: M1 depends on M0's
archive existing, M3 depends on M2's palette, and M5 cannot be judged until M4 ships the HUD that
receives the information M1 removes from the sprite.

---

## Problem

The gameplay surface renders actors through `actor-medallion-composer.js`, which encodes **eight
independent dimensions** into a single 32×32 tile:

| Dimension | Cardinality | Encoding today |
|---|---|---|
| Role | 2 (delver, warden) | Central silhouette |
| Affinity | 10 | Inner glyph + hue |
| Expression | 4 | Corner triangles |
| Motivation | 12 | Secondary glyph |
| Durability | continuous | Top edge bar |
| Health | continuous | Right edge bar |
| Stamina | continuous | Bottom edge bar |
| Mana | continuous | Left edge bar |

The generated contact sheet (`local-codex/actor-medallion-preview/generated/actor-medallions-contact-sheet.png`)
shows the failure directly: legible at 64px, muddy at 32px, indistinguishable noise at 16px.

**32px is not the worst case — it is the best case.** `DEFAULT_TILE_SIZE` is 32, but
`fitCameraToWorld()` clamps zoom to `MIN_CAMERA_ZOOM = 0.25`
([gameplay-phaser-renderer.js:4](packages/ui-web/src/views/gameplay-phaser-renderer.js:4)), so on a
large dungeon an actor occupies as little as **8×8 physical pixels**. Eight dimensions cannot survive
64 pixels. No amount of art skill fixes an information-density problem; only removing channels does.

---

## Decisions (maintainer, 2026-09-02)

1. **Sprite information budget: role + affinity only.** Silhouette carries role; flat fill carries
   affinity. Expression, motivation, and all four vitals leave the sprite entirely.
2. **HUD surface: Phaser camera-fixed overlay** (`scrollFactor(0)` container inside the canvas), not
   the DOM `#actor-inspector` side panel. The HUD is part of the game and follows fullscreen.
3. **Art pipeline: rewrite the algorithmic composer.** Keep deterministic in-code pixel composition
   in `packages/runtime/src/render/`; replace the visual language it encodes, not the technique.

---

## ⚠️ Concern raised before implementation — the palette cannot carry affinity alone

"Affinity = hue" only works if the ten hues are separable at small scale. **In the current palette
they are not.** CIE76 ΔE over `GAME_AFFINITY_COLOR_HEX`, and against the floor background
`FLOOR_BG = 0x3a3a3a`:

| Pair | ΔE | Verdict |
|---|---|---|
| `corrode` #c8c030 / `light` #f5d14d | **14.6** | Indistinguishable at any small size |
| `earth` #7a5c33 / `decay` #a05828 | **22.3** | Confusable — two muddy browns |
| `wind` #60d8c0 / `life` #49b96b | 32.5 | Marginal |

| Colour vs floor | ΔE | Verdict |
|---|---|---|
| `dark` #0b0d12 | **21.0** | Near-invisible against the board |
| `earth` #7a5c33 | **33.5** | Weak |
| `fortify` #9ca3af | 43.0 | Acceptable |

Reliable discrimination of small colour patches needs roughly **ΔE ≥ 30** between any two, and
**ΔE ≥ 45** against the background. Three pairs and two background cases fail.

**This does not block the decision — it adds M2.** Hue remains the affinity channel; the palette is
re-derived to meet a measured, test-enforced separation floor. Where hue alone cannot span ten
values, `dark` and `light` gain a **value (lightness) polarity** against the mid-grey floor rather
than a competing glyph. The alternative — adding a per-affinity glyph back onto the sprite —
reintroduces exactly the density problem this plan exists to remove, and is rejected.

---

## Target visual language

### Sprite (32px canonical, must survive downscale to 8px)

```
role      → silhouette shape, filled, high-contrast outline
            delver   ▲  upward triangle
            warden   ⬢  hexagon
            hazard   ✳  spiked burst
            resource ◆  diamond

affinity  → flat fill colour (M2 palette), single hue, no gradient
outline   → 1–2px, constant, board-background-contrasting
selection → outline swaps to SELECTION_TINT + one pulsing ring
```

Two channels. Both survive nearest-neighbour downscale to 8×8, which is the actual constraint.

### HUD (camera-fixed, bottom-left of canvas)

```
┌────────────────────────────────────┐
│ ▲ delver-04          fire · push   │
│ HP ███████░░░  34/50   ↻2          │
│ MP ████░░░░░░  12/30   ↻1          │
│ ST █████████░  27/30               │
│ DU ██████░░░░  18/30   exploring   │
└────────────────────────────────────┘
```

Everything M1 strips from the sprite reappears here at readable size, for the **selected** actor
only. Nothing is lost from the game; it is relocated from a 64-pixel budget to a ~200×90 one.

---

## Milestones

### M0 — Archive the existing sprite imagery

The maintainer requires that no current sprite imagery is lost. Git history is not sufficient —
the archive must be explicit and browsable.

- Create `packages/runtime/src/render/visual-assets-archive/2026-09-medallion-era/` and move (via
  `git mv`, preserving history) the complete current asset trees:
  `visual-assets/{actors,tiles,overlays,misc,cards}` and
  `source-assets/actor-medallions/`.
- Preserve `actor-medallion-composer.{js,ts}` verbatim as
  `visual-assets-archive/2026-09-medallion-era/actor-medallion-composer.js.frozen` — it is the
  generator for every composed medallion and is the only way to reproduce them.
- Write `visual-assets-archive/2026-09-medallion-era/README.md` recording: what the medallion
  encoded (the eight-dimension table above), why it was retired (the density measurement), the
  commit it was retired at, and how to regenerate a contact sheet from the frozen composer.
- Regenerate and commit a final contact sheet at 64/32/16px as the visual record.

**Gate:** the archive README exists and names every moved directory; `pnpm run test` unchanged.
**Note:** M0 moves assets that the resource bundle still maps. Either keep the live paths in place
and *copy* into the archive, or land the mapping updates in the same commit — do not leave the
bundle pointing at moved files.

---

### M1 — Sprite semantics module (`runtime`), tests first

New module `packages/runtime/src/render/entity-sprite-composer.js` (+ `.ts`), replacing
`actor-medallion-composer` as the actor path. Per the charter, sprite *semantics* stay in `runtime`;
`ui-web` renders and emits intents only.

Public surface:

```js
export const ENTITY_SPRITE_CANONICAL_SIZE = 32;
export function normalizeEntitySpriteState(entity, override): EntitySpriteState  // { role, affinity }
export function composeEntitySprite({ state, size }): Uint8ClampedArray
export const ENTITY_SPRITE_ROLES  // delver | warden | hazard | resource
```

`EntitySpriteState` carries **only** `{ role, affinity }`. Vitals, expression, and motivation are
deliberately absent from the type — a state object that cannot express them cannot leak them back
onto the sprite. This is a refusal test, not a comment.

Write failing tests first in `tests/runtime/entity-sprite-composer.test.mts`:
- Every (role × affinity) pair composes without throwing.
- The composed buffer is a pure function of `{ role, affinity, size }` — identical inputs give a
  byte-identical buffer (determinism).
- Two sprites differing only in `role` differ in **silhouette occupancy**, not merely in colour.
- Two sprites differing only in `affinity` have identical alpha masks (shape is affinity-invariant).
- **Refusal:** passing `vitals`/`expression`/`motivation` into `normalizeEntitySpriteState` does not
  change the composed output.

Then implement, then hand `## TODO: Test Permutations` to `/local-test-gen`.

---

### M2 — Affinity palette re-derivation, with a measured gate

This is the milestone the concern above buys.

- Re-derive `GAME_AFFINITY_COLOR_HEX` in
  [game-elements.js](packages/runtime/src/contracts/game-elements.js) for perceptual separation.
  Suggested approach: fix the ten hues at even intervals in a perceptually-uniform space (OKLCH or
  CIELAB), then push `dark` and `light` apart on the **lightness** axis specifically so they read
  against a mid-grey floor.
- Land the measurement itself as an executable guard,
  `tests/runtime/affinity-palette-separation.test.js`:
  - Minimum pairwise ΔE across all 45 affinity pairs **≥ 30**.
  - Minimum ΔE of every affinity against `FLOOR_BG #3a3a3a` **≥ 45**.
  - The guard asserts against the palette constant, so any future colour edit that regresses
    separability fails the suite rather than silently degrading the board.
- Verify no non-sprite consumer depends on specific hex values: the palette also feeds ASCII
  styling, tile affinity visuals, and resource-bundle sprite generation
  ([affinity-palette.js:9-11](packages/runtime/src/render/affinity-palette.js:9)). Query callers with
  Serena `find_referencing_symbols` before editing, and update the affected goldens in the same diff.

**Gate:** the separation guard passes; the affinity contact sheet is visually re-checked at 16px.
**Risk:** this changes colours the maintainer may have opinions about. Surface the re-derived palette
for sign-off before landing M3 on top of it.

---

### M3 — Wire the new sprite into the Phaser gameplay renderer

In [gameplay-phaser-renderer.js](packages/ui-web/src/views/gameplay-phaser-renderer.js):

- Replace `addActorMedallionImage` / `ensureActorMedallionTexture` with the entity-sprite equivalent
  (`packages/ui-web/src/views/entity-sprite-textures.js`, replacing `actor-medallion-textures.js`).
- Extend the same path to **hazards and resources**, which today go through `addBundleImage` and a
  separate `resolveHazardAssetId`. One composer, one visual language, four roles — otherwise actors
  get the new language and everything else keeps the old one.
- Texture cache keys must key on `{role, affinity, size}` only. The medallion's key included vitals
  ([actor-medallion-textures.js:47](packages/ui-web/src/views/actor-medallion-textures.js:47)), which
  forced a texture rebuild on every vital change; removing vitals from the sprite removes that churn.
  Expect a measurable reduction in texture count on long runs — worth noting in the commit message.
- Update `tests/ui-web/gameplay-phaser-renderer.test.mjs` (13 medallion references) and
  `tests/runtime/resource-bundle.test.js` (12).

---

### M4 — Selected-actor HUD (Phaser, camera-fixed)

Split by layer, per the charter's `ui-web` renders-only rule:

**runtime** — new `packages/runtime/src/render/actor-hud-model.js`: given an observation actor,
return a normalized, serializable HUD view-model (`{ id, role, affinity, expression, motivation,
vitals: [{ key, label, current, max, fraction, regen, colorHex }] }`). Ordering, labels, colours, and
formatting are *semantics* and belong here — the same reason vital colours already live in the
composer rather than the renderer. Tested in `tests/runtime/actor-hud-model.test.js`.

**ui-web** — a `scrollFactor(0)` container at depth above the board, built from that model.
- Shows on selection, hides on `clearHighlight()`. Selection already flows
  `Phaser click → gameplay-view.selectEntity → actorInspector.selectEntityAtPosition`
  ([gameplay-view.js:324](packages/ui-web/src/views/gameplay-view.js:324)) — the HUD taps the same
  signal; no new event plumbing.
- Redraws on tick advance so vitals track the simulation.
- **Replaces `showQuickView()`** ([gameplay-phaser-renderer.js:687](packages/ui-web/src/views/gameplay-phaser-renderer.js:687)),
  the world-space floating panel that currently does this job at 9px font anchored to the actor. Do
  not ship both — a fixed HUD and a floating quick-view showing the same vitals is the same
  duplication this plan is removing, one layer up.

Tests: `tests/ui-web/gameplay-hud.test.mjs` — HUD appears on select, populates from the model,
clears on deselect, and updates across a tick.

---

### M5 — Legibility verification and documentation

- **Legibility harness:** a script rendering every (role × affinity) sprite at 32/16/8px into a
  contact sheet, committed as the reviewable artifact. This is the acceptance evidence for the whole
  plan, and the thing the current contact sheet fails.
- **Verify in the running app**, not only in tests: `pnpm run serve:ui`, load a scenario, screenshot
  the board at fit-zoom and at `MIN_CAMERA_ZOOM`, and confirm roles and affinities are separable and
  the HUD reads.
- **Docs in the same diff** (the charter treats a contradicting doc as blocking):
  - `docs/architecture-charter.md` — the render-layer section, if the composer's ownership boundary
    moves.
  - `packages/ui-web/README.md` / the runtime render README — the new sprite language and HUD.
  - `docs/human-interfaces.md` — HUD behaviour in the UI walkthrough.
  - `docs/readme-index.md` — any new README.
  - The archive README from M0.

---

## Out of scope

- Card-builder visuals (`card-builder-phaser-renderer.js`) — different surface, different scale
  constraints, one medallion reference. Follow-up if the language proves out.
- The DOM `#actor-inspector` panel. It keeps the deep detail (affinity stacks, capabilities,
  constraints); the HUD is glance-level. They do not merge under this plan.
- Tile, wall, and floor rendering. The board reads acceptably; actors are the failure.
- Benchmarks. No scoring surface is touched.

---

## Enforcement checklist for this plan

- **Dependency direction:** sprite composition and the HUD view-model in `runtime`; only Phaser
  mechanics in `ui-web`. No new IO in `core-ts`.
- **Determinism:** the composer is a pure function; assert byte-identical output for identical input.
- **Tests before code** at every milestone; `## TODO: Test Permutations` before Ollama handoff.
- **Guards, not comments:** the palette separation floor (M2) and the sprite refusal test (M1) are
  executable. A visual rule that is only written down will regress.
- **Gates:** `pnpm run test` · `pnpm run typecheck` · architecture guards.

## Open items for the maintainer

1. **M2 palette sign-off** — the re-derived colours change the board's look everywhere affinity is
   shown, including ASCII and tile visuals. Review before M3 builds on them.
2. **Warden/delver silhouette** — plan assumes ▲/⬢. `local-codex/seeker-keeper-icon-concepts.png`
   holds four earlier hand-explored pairs (arrow/shield, torch/gate, reach/lock, compass/ward). If
   one of those is preferred, say so before M1 implementation.
