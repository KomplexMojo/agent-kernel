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

The generated contact sheet shows the failure directly: legible at 64px, muddy at 32px,
indistinguishable noise at 16px. (It lives under `local-codex/`, which is **gitignored** — M0 must
copy it to a tracked path, or this plan cites evidence no other clone can see.)

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

**The ΔE ≥ 45 background bar turned out to be unreachable, and was retired — see M2.**

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

### M2 — Affinity palette re-derivation — **DERIVED 2026-09-02, awaiting sign-off**

Derivation ran ahead of M0 at the maintainer's request. Tooling and output are committed:

- `scripts/design/derive-affinity-palette.mjs` — seeded simulated annealing in OKLCH.
- `scripts/design/render-palette-sheet.mjs` — the review sheet.
- `docs/design/affinity-palette-2026-09.json` — **the frozen palette**.
- `docs/design/affinity-palette-sheet.png` — the visual record.

The derivation is **seeded** (`PALETTE_SEED=20260902`) and verified byte-reproducible across runs.
An unseeded optimizer re-rolls a different palette every run, which is not a constant.

#### The palette

| Affinity | Current | Derived | Opposite | Opposed on |
|---|---|---|---|---|
| `fire` | `#f05a28` | **`#fe4b2c`** | `water` | hue |
| `water` | `#2b7fff` | **`#5e82f1`** | `fire` | hue |
| `earth` | `#7a5c33` | **`#794301`** | `wind` | hue |
| `wind` | `#60d8c0` | **`#06f6f5`** | `earth` | hue |
| `life` | `#49b96b` | **`#3ba251`** | `decay` | hue |
| `decay` | `#a05828` | **`#c64a9a`** | `life` | hue |
| `corrode` | `#c8c030` | **`#d3e602`** | `fortify` | chroma — saturated vs neutral |
| `fortify` | `#9ca3af` | **`#708591`** | `corrode` | chroma — saturated vs neutral |
| `light` | `#f5d14d` | **`#fdfed3`** | `dark` | lightness — near-white vs charcoal |
| `dark` | `#0b0d12` | **`#28174a`** | `light` | lightness — near-white vs charcoal |

**The palette is structured, not merely optimized.** `AFFINITY_OPPOSITES` is a domain fact, so the
five opposite pairs are made visually opposite — on three different axes, because ten hues do not fit
one wheel without collisions. Three pairs oppose on hue; `corrode`/`fortify` oppose on *chroma*
(acid vs. inert steel); `light`/`dark` oppose on *lightness*. Every opposite pair now measures
**ΔE ≥ 103**, so the game's counterplay relation is the most visible relation on the board.

Two semantic re-assignments were required and need explicit sign-off:
- **`decay` moves from brown to magenta** (`#a05828` → `#c64a9a`). It was one of two browns; rot as
  magenta is a common convention and makes it the visual complement of `life`, which it opposes.
- **`dark` moves from near-black to deep violet** (`#0b0d12` → `#28174a`). Near-black was
  near-invisible on the floor (ΔE 21.0).

#### Measured result

| Metric | Current | Derived |
|---|---|---|
| Min pairwise ΔE76 (45 pairs) | **14.6** | **53.0** |
| Min pairwise ΔE2000 | 9.4 | **29.4** |
| Worst opposite pair | 36.5 | **103.1** |
| Min ΔE76 vs floor `#3a3a3a` | **21.0** | **31.6** |

#### ⚠️ Finding — the ΔE ≥ 45 floor-contrast bar is unreachable, and the outline replaces it

Forcing the background bar to 45 was tested (`FLOOR_MIN=45`). The optimizer reaches only **38.3**,
because `dark` must stay dark and `fortify` must stay neutral, and *it makes the palette worse*:
min pairwise ΔE76 drops 53.0 → 50.1 and perceptual ΔE2000 collapses (`water`/`fortify` 19.9,
`life`/`corrode` 20.9). Buying background contrast costs foreground separability.

**Resolution:** figure-ground moves to the outline, which the sprite spec already has. A constant
light 1–2px outline separates any fill from the floor, so the fill only needs to be separable from
*other fills*. Revised gates:

- Min pairwise ΔE76 across all 45 pairs **≥ 45** (achieved 53.0).
- Min ΔE76 of every affinity vs floor `#3a3a3a` **≥ 30** (achieved 31.6).
- Min ΔE76 of the outline colour vs every fill **≥ 40** — new, and load-bearing.
- Every `AFFINITY_OPPOSITES` pair **≥ 90** (achieved 103.1).

#### ⚠️ Finding — only three of four role shapes survive below 16px

Visible in the sheet's role panel: at 12px `warden` (hexagon) and `resource` (diamond) are both
round blobs; at 8px `warden`, `resource` and `hazard` are indistinguishable dots. Only the `delver`
triangle holds. The plan's "must survive downscale to 8px" is **not achievable for four shapes**.

Options, for the maintainer:
- (a) Raise `MIN_CAMERA_ZOOM` from 0.25 to ~0.4 so a tile never renders below 12px. Cheapest; costs
  maximum zoom-out range on very large dungeons.
- (b) Accept that at extreme zoom-out only affinity colour and actor-vs-thing read, which is
  arguably correct for a strategic overview.
- (c) Reduce to three silhouettes by merging `hazard` and `resource` into one "object" shape,
  distinguished by colour alone.

#### Remaining M2 work (not yet done)

- Write the derived values into `GAME_ELEMENT_VISUALS.affinities` in
  [game-elements.js](packages/runtime/src/contracts/game-elements.js).
- Land `tests/runtime/affinity-palette-separation.test.js` asserting the four gates above against
  the palette constant, so a future colour edit fails the suite.
- The palette also feeds ASCII styling, tile affinity visuals, and resource-bundle sprite generation
  ([affinity-palette.js:9-11](packages/runtime/src/render/affinity-palette.js:9)). Query callers with
  Serena `find_referencing_symbols` and update affected goldens in the same diff.
- Check `GAME_AFFINITY_TEXT_COLOR_HEX` separately — `light` `#fdfed3` and `corrode` `#d3e602` are
  fills, not text colours, and will fail contrast on a light background.

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

## ⚠️ Open design question — single vs. multiple equipped affinity

Raised by the maintainer 2026-09-02, mid-derivation. It is **not** a rendering detail: the whole
sprite language assumes exactly one affinity is active per entity at render time.

**What the contracts say today:**
- The loadout is already plural — `affinities: Array<{ name, stacks, expression }>`
  ([artifacts.ts:481](packages/runtime/src/contracts/artifacts.ts:481)). An actor *carries* several.
- `equippedAffinity` — the singular, active one — appears **only in `ui-web` and its tests**
  (`gameplay-phaser-renderer.js`, `gameplay-view.js`, and two test files). **There is no runtime
  contract for it.** The UI has already invented a single-equipped concept the runtime does not
  model. Whichever way this decision goes, that gap is a defect to close.

**Visual consequence.** "Affinity = one fill colour" needs exactly one active affinity. Multiple
simultaneous equips force either a multi-colour fill (stripes, split discs, gradients — all of which
fail at 12px, which is the density problem this plan exists to remove) or picking a dominant one to
display, in which case the board actively lies about state.

**Recommendation: single equipped affinity, swappable, with the swap costing something.**
1. It preserves the two-channel sprite. Multi-equip reopens M1.
2. `AFFINITY_OPPOSITES` implies counterplay. Counterplay only works if an opponent can identify your
   active element at a glance — which is exactly what M2's ΔE ≥ 103 opposite-pair separation buys.
   Multi-equip destroys the read and the counterplay with it.
3. Multi-equip is a strictly-better loadout with no decision content. Single-equip-plus-swap is a
   real choice: commit to an element, or spend to change it.
4. **The swap must cost** — a tick, stamina, or mana. A free swap is functionally multi-equip with
   extra steps, and the sprite would flicker between colours with no player-legible cause.

**Not Claude's call:** the swap *price* belongs to the Allocator, which owns pricing per the charter.
This plan should not set it.

**If multi-equip is chosen instead**, M1 changes before it starts: `EntitySpriteState` becomes
`{ role, primary, secondary }`, the sprite needs a second colour channel, and the 12px legibility
finding above must be re-tested against split fills before M3.

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
   (gitignored; copy to `docs/design/` if it is to be cited) holds four earlier hand-explored pairs
   — arrow/shield, torch/gate, reach/lock, compass/ward. If one is preferred, say so before M1.
3. **Role shapes below 16px** — see the M2 finding: only 3 of 4 silhouettes survive to 8px. Pick
   option (a), (b) or (c) there.
4. **Single vs. multiple equipped affinity** — see the section above. This blocks M1, not just M3:
   multi-equip changes the sprite state type before any code is written.
