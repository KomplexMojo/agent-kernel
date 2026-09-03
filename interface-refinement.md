# Plan — Interface Refinement: Minimal Sprite Language + Selected-Actor HUD

**Branch:** `feat/minimal-sprite-language-hud`
**Opened:** 2026-09-02
**Status:** ✅ COMPLETE — M0–M5 delivered 2026-09-02, plus a post-review visual pass

### Post-review corrections (2026-09-02, after viewing the real UI on `index_c.html`)

Reviewing the actual interface — not the synthetic probes — surfaced three things:

1. **I had been verifying the wrong page.** `index.html` (2414 lines) mixes legacy and current
   surfaces; the canonical entry is **`index_c.html`** ("Agent Kernel — Current", 189 lines), served
   by `pnpm run serve:ui`. Earlier M3/M4 app checks used the mixed page, which is why its playback
   controls appeared inert. Re-verified on `index_c.html`.
2. **Regression I introduced in M3:** the wall border was mapped to `tiles.wall`, a *fill*, dropping
   contrast against the floor from **ΔE 69.7 to 9.7** — room outlines nearly invisible. Fixed with a
   dedicated `GAME_COLOR_PALETTE.tileBorders` group, and guarded (perturbation-verified).
3. **Tiles still drew medallion-era PNGs** over the canonical colour. Now flat fills.
4. **UI chip icons** were medallion-era PNGs with opaque baked-in backgrounds, forced to
   `width: 100% !important` inside a 28px chip — the art's own square background covered the chip's
   ring and matched its fill, so the chip read as a solid block with no containment. Icons are now
   generated from the sprite language as inline SVG: a disc washed 20% toward the element colour,
   with the glyph inset to 58% and carrying the board's own `outlineForFill` outline. Variations
   were rendered and compared first — `docs/design/icon-chip-variations.png` — and that comparison
   killed three of the five candidates, because a dark glyph on a dark chip fails for `dark` and
   `fortify` unless the outline rule is applied.
5. **Expressions and motivations** were then the only icons left without the chip, so they were
   brought in too — but not identically, because they are not the same problem.
   `docs/design/icon-alt-preview.html` compares five treatments (kept as the decision record).
   **Expressions** ship as generated geometry: they are directional, so push/pull chevrons and
   emit/draw rays are near-literal rather than invented. **Motivations** ship as monochrome marks in
   the same chip, because a generated family scheme *provably cannot cover twelve* — four family
   shapes × a filled/hollow split is eight slots, and separating the rest by dot count repeats the
   hazard/resource mistake. Both use a neutral ink: their palettes collide (expressions worst pair
   ΔE 10.0, motivations ΔE 7.2), so colour cannot carry identity there and is demoted to the wash.

---

## ⏭️ START HERE

**Done:** M0 (archive) · M1 (sprite composer) · M2 (palette + guards + single-origin colour) ·
M3 (board wired, camera floor raised) · M4 (HUD) · M5 (verification + docs).
**Decided:** single equipped affinity · role-shape option **(a)**.
**All milestones delivered.** Two items are recorded below for a follow-up decision, neither
blocking: large-level overview (see M5) and the v1-bundle art path (see M3).

`docs/design/entity-sprite-sheet.png` now shows the landed palette on the canonical floor tile.
M5 cannot be judged until M4 ships the HUD that receives what M1 removes from the sprite.

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

### M0 — Archive the existing sprite imagery ✅ DONE 2026-09-02

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

**Delivered** at `docs/design/archive/2026-09-medallion-era/` — *not* the
`packages/runtime/src/render/visual-assets-archive/` this plan first proposed. A museum does not
belong inside a source package that guards and the TS program scan; it belongs with the other design
evidence.

- 424 PNGs (`visual-assets/`, `source-assets/`) — **copied, not moved**, see the finding below.
- `actor-medallion-composer.frozen.{js,ts}` — the `.js` made **self-contained** by inlining the
  era's palette, so it still runs after M2 changes the live one. Verified: it imports and renders.
- `render-contact-sheet.mjs` + `contact-sheet.png` — 6 subjects × 64/32/16px, regenerable.
- `preview-evidence/` — six renders rescued from gitignored `local-codex/`, which existed on one
  machine only.
- `README.md` — what the medallion encoded, why it was retired, how to regenerate.

**⚠️ Finding that made M0 safe: the PNGs are never read at runtime.** Every image is already
base64-inlined into `packages/runtime/src/render/generated/{affinity,game}-sprite-assets.js`; the
`relativePath` fields are metadata that nothing opens (`relativePathForGameAssetId` only *builds a
string* that `resource-bundle.js` stores on the artifact). The trees are source material for an
out-of-repo generator. So the archive is a **copy** — the live trees stay put, `relativePath`
metadata stays accurate, and there was no way for M0 to break the bundle. The originals get deleted
when the code describing them is replaced, not before.

---

### M1 — Sprite semantics module (`runtime`), tests first ✅ DONE 2026-09-02

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

**Delivered:** `packages/runtime/src/render/entity-sprite-composer.js` +
`tests/runtime/entity-sprite-composer.test.mts` (11 tests, 10 permutation stubs) +
`scripts/design/render-sprite-sheet.mjs` → `docs/design/entity-sprite-sheet.png`.

**Deviation — `.js` only, no `.ts` twin.** The plan said "+ `.ts`". There is **no build step**:
everything imports the `.js`, and `actor-medallion-composer.ts` is the only implementation `.ts` in
`render/` — nothing imports it, and the typecheck gate does not cover it, so it is two hand-maintained
copies with nothing keeping them in sync. Every other module in `render/` is `.js`. JSDoc types
instead.

**⚠️ Both original guards were too weak, and perturbation caught it.** Each is now measured:

| Guard | First form | Why it failed | Now |
|---|---|---|---|
| Refusal | compared two *pre-normalized* `state` inputs | `composeEntitySprite` re-normalizes `state`, so extra channels were stripped before any pixel was written — it passed **vacuously**. A real vitals leak through the `entity` path went undetected. | Exercises **both** entry points; `entity` is the one the renderer uses |
| Shape distinctness | asserted masks were *not identical* | `hazard` and `resource` differed by 16 px of 144 at 12px — visually one blob, but "not identical", so it passed | Asserts **Jaccard overlap ≤ 0.60** at 32/16/12px |

**The shape guard then failed, so the shapes changed — not the threshold.** The first pair was a
four-point star (hazard) and a diamond (resource): same family, both centred and pointy, **0.79
overlap**. Inverting the hazard to a downward triangle and tightening the resource diamond gives
**0.53 worst-case**, and moves the binding pair to delver/warden, which is inherently the most
distinct. Final language: `delver ▲` · `warden ⬢` · `hazard ▼` · `resource ◆`.

**Perturbation evidence** — all four guards were proven to bite by breaking the implementation:
leak vitals via `entity` → refusal + state-keys fail · collapse hazard into resource → both shape
guards fail · outline recoloured to match a dark fill → outline guard fails · make the silhouette
affinity-dependent → invariance guard fails. Baseline restored and green after each.

`## TODO: Test Permutations` carries 10 named stubs for `/local-test-gen`.

---

### M2 — Affinity palette re-derivation ✅ DONE 2026-09-02

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

Two semantic re-assignments were required. **Both approved by the maintainer 2026-09-02:**
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

#### ⚠️ Finding — the ASCII/preview surface and the Phaser board use different tile palettes

Raised by the maintainer 2026-09-02: the ASCII representation should share the palette and read as
the same game. It does not today, and the gap is wider than colour choice.

There are **three** surfaces with three treatments:

| Surface | Floor | Wall | Affinity colour source |
|---|---|---|---|
| Phaser gameplay board | `#3a3a3a` (`FLOOR_BG`) | `#cccccc` border | `AFFINITY_COLOR_HEX` ✅ |
| Level-preview image | `#d8f6c4` **pale green** | `#0a0f0d` | `AFFINITY_COLOR_HEX` ✅ |
| ASCII text | `.` | `#` | letters (`f w e n l d c t i k`), no colour |

- **Good news:** affinity colour on both *pixel* surfaces already resolves through
  `AFFINITY_COLOR_HEX` ([guidance-level-builder.js:12](packages/runtime/src/personas/configurator/guidance-level-builder.js:12),
  [resource-bundle.js:2](packages/runtime/src/render/resource-bundle.js:2)), so M2's re-derivation
  propagates to both automatically. No extra wiring.
- **Bad news:** tile colours do not. `DEFAULT_LEVEL_RENDER_PALETTE` in `guidance-level-builder.js` is
  a **separate hardcoded map**, and its floor is near-white pale green while the board's is dark
  grey. Same game, **opposite value polarity**.
- **This breaks the M2 guarantee.** The palette was validated against `#3a3a3a` only. On a
  `#d8f6c4` floor, `light` `#fdfed3` is effectively invisible. The background gate must run against
  *every* surface background, not one.
- Also note the old `fortify` `#9ca3af` was byte-identical to that map's `barrier` colour — an
  existing collision the re-derivation happens to fix.

**Added to M2 scope:**
- Promote the tile colours to a single shared surface palette in `runtime` that the Phaser renderer,
  the level-preview image, and any ANSI-coloured ASCII all read. Neither `FLOOR_BG` in `ui-web` nor
  `DEFAULT_LEVEL_RENDER_PALETTE` in a persona is the right home for a cross-surface constant.
- Extend the separation guard: every affinity must clear the background floor against **each**
  background in that palette, not just `#3a3a3a`. Expect this to constrain `light` and `dark`
  hardest, and to require re-running the derivation with both backgrounds as constraints.
- ASCII *text* stays letter-glyphs — a terminal has no fill. Alignment there means the shared
  palette drives ANSI colour where ANSI is used, and the letters stay the affinity initials.

#### What landed

- Approved values written into `AFFINITY_COLORS`
  ([game-elements.js](packages/runtime/src/contracts/game-elements.js)).
- `tests/runtime/affinity-palette-separation.test.js` — six executable gates:
  pairwise ≥ 45 (achieved 53.0) · every affinity vs **every** tile ≥ 30 (achieved 30.7) · opposites
  ≥ 90 (achieved 103.1) · outline-vs-fill ≥ 40 (achieved 42.9) · text labels ≥ WCAG AA 4.5:1 ·
  the tile palette is complete. All six confirmed failing against the old palette first.
- **Single origin for colour.** `GAME_COLOR_PALETTE.tiles` was already the declared canonical tile
  set and was read by *nothing but tests*; the Phaser board and the level-preview image now both
  read it, and `ui-web/tile-affinity-visuals.js` derives its Phaser tints from
  `GAME_AFFINITY_COLOR_HEX` instead of holding a copy.

#### ⚠️ Finding — the ui-web palette copy had already drifted into a live bug

`tile-affinity-visuals.js` held a second palette labelled "Canonical 10-kind palette". It was not:
three values had drifted to **entirely different colours** — `wind` `0x8fd3ff` pale blue vs
`#60d8c0` teal, `decay` `0x6f7b46` olive vs `#a05828` amber-rust, `corrode` `0x7fbf42` green vs
`#c8c030` acid yellow. Board tile tints therefore disagreed with every other surface. Two tests had
copied the drifted values as goldens, so the bug was pinned in place and *fixing* it would have
failed the suite. Those assertions now check propagation from the single origin instead of
re-stating literals.

#### ⚠️ Finding — `dark` was invisible on two tiles

The old `dark` `#0b0d12` measured **ΔE 2.1** against the `inaccessible` tile and 4.9 against `fog`.
Not "hard to see" — the same colour. Caught by the new tile gate, fixed by the palette.

#### ⚠️ Finding — the sprite outline was invisible on light fills (M1 defect)

M1 shipped one constant near-white outline. Against the near-white `light` fill that is **ΔE 23.4**,
so a `light` sprite was a white blob with no edge. M1's own outline test missed it by only checking
the `dark` fill. A single mid-tone clearing both extremes exists (the search returned a pale pink),
but imposing one hue on every sprite is a large aesthetic cost. The outline is now picked from fill
lightness — still a pure function of the affinity already shown, so the two-channel budget holds —
giving worst case ΔE 42.9. **Division of labour:** the fill separates the sprite from the board, the
outline separates the edge from the fill.

#### ⚠️ Finding — text colours cannot mirror fills

A fill is judged against dark board tiles; a label is judged against the dark UI panel by WCAG
contrast, and they disagree. Mirroring fills into `AFFINITY_TEXT_COLORS` left `earth` at **2.18:1**
and `dark` at **1.09:1**. Three overrides added (`earth`, `decay`, `dark`), each lightened along its
own hue; the rest pass unchanged. Now guarded.

#### Resolved: the ASCII/preview divergence

The level-preview image floor was `#d8f6c4` pale green against the board's dark grey — the same
level at opposite value polarity, and the approved palette measured `light` at ΔE 12.3 against it,
i.e. invisible. Both surfaces now read `GAME_COLOR_PALETTE.tiles`, so the preview is dark like the
board and the palette's contrast guarantee holds on both. ASCII *text* keeps letter-glyphs — a
terminal has no fill — and the shared palette drives colour wherever colour is used.

---

### M3 — Wire the new sprite into the Phaser gameplay renderer ✅ DONE 2026-09-02

**Decided (maintainer, 2026-09-02): option (a)** — raise `MIN_CAMERA_ZOOM` from `0.25` so a tile
never renders below **12px**, the floor M1's shape guard defends. With `DEFAULT_TILE_SIZE = 32` that
is `12/32 = 0.375`; use `0.4` for headroom. This costs maximum zoom-out range on very large dungeons
and must be sanity-checked against the largest scenario in M5.

**Delivered:**
- `packages/ui-web/src/views/entity-sprite-textures.js` replaces `actor-medallion-textures.js`
  (deleted). Texture key is `ak-sprite:{size}:{role}:{affinity}`.
- Hazards and resources now go through the composer. They previously drew bundle PNGs via
  `resolveHazardAssetId`, so the board would have mixed the new language for actors with retired
  art for everything else.
- `MIN_CAMERA_ZOOM` `0.25` → `0.4`, guarded by a test that renders a 400×400 board and asserts a
  tile never falls below 12px.
- Four new renderer tests: texture sharing, vitals-don't-invalidate, hazard/resource sprites,
  camera floor.

**Cache-key win, worth stating.** The medallion keyed on actor id **and a fingerprint of all four
vitals**, so there was one live texture per actor and it was recomposed on every point of damage.
The key now depends only on `{role, affinity, size}`: every fire delver shares one texture and
nothing rebuilds when vitals change. A 40-entity board needs at most 40 textures under the old
scheme and 4 under this one. Both properties are now tested.

**⚠️ Finding — M1's affinity inference was incomplete, and the hazard test caught it.**
`inferAffinity` read `entity.affinity` only as a *string*, but hazards carry a singular `affinity`
**object** (`{ kind }`) and `affinityStacks[]`. Every hazard and resource therefore composed as the
default `fire`. Fixed to read all six live shapes, with a test enumerating them.

**Verified in the running app, not just in tests.** `pnpm run serve:ui`, then the real
`createGameplayPhaserRenderer` driven with a synthetic 22×9 board of all 4 roles × 10 affinities.
Confirms what unit tests cannot: the new cross-package import chain
(`ui-web` → `runtime/contracts/game-elements`) resolves in a browser with **no build step**, and a
`hazard`/`decay` sprite's centre pixel is exactly `#c64a9a`. No console errors.

**Not changed, deliberately:** the v1-bundle path still renders static PNG actor assets. Composed
sprites remain gated on `schemaVersion >= 2`, carried over from the medallion. Changing what a v1
bundle draws is a contract change, not a rendering change — but it does mean **a v1 bundle still
shows retired art**. Flag for a follow-up decision.

**Also still on old art (out of scope):** the card-builder palette icons and the DOM inspector
chips resolve through `icon-resolver.js` and the bundle's `misc/` PNGs, untouched by this plan.

---

### M4 — Selected-actor HUD (Phaser, camera-fixed) ✅ DONE 2026-09-02

**Delivered:**
- `packages/runtime/src/render/actor-hud-model.js` + `tests/runtime/actor-hud-model.test.js` —
  ordering, labels, colours, fraction derivation and which vitals a role has are *semantics*, so
  they live in runtime; `ui-web` draws what it is handed.
- The camera-fixed HUD in the Phaser renderer, replacing `showQuickView()`.
- 11 renderer HUD tests replacing the 14 quick-view tests, plus rewritten hover tests.

**⚠️ Deviation — hover and selection share one panel.** The plan said the HUD is for the *selected*
actor and that `showQuickView` should simply be deleted. But `showQuickView` was wired to **hover**,
not selection, so deleting it would have removed the hover affordance entirely. Instead hover
previews into the same HUD and hover-end falls back to the selection. One panel, both affordances,
and still no two panels showing vitals — which was the actual rule.

**⚠️ Finding — `setScrollFactor(0)` does not make an object camera-fixed.** It stops an object
*scrolling* with the board but Phaser still *scales* it about the camera centre, so at the fit-zoom
of 3 the first HUD was drawn 3× and pushed off-screen. **The unit test asserted `scrollFactor === 0`
and passed** — a guard aimed at the wrong property, the same failure mode as M1's outline test.
Only running the app caught it. The HUD now renders on its own camera pinned at zoom 1, with each
camera ignoring the other's objects; the test now asserts the HUD camera exists, stays at zoom 1
*after the board zooms*, and ignores the board container.

**⚠️ Finding — vital sets differ by role.** `HAZARD_VITAL_KEYS` is `mana`+`durability`;
`RESOURCE_VITAL_KEYS` is `health`+`mana`+`stamina`. Drawing four bars for everything would invent
two of them on a hazard. The model filters by role and keeps any unexpected vital rather than
dropping it silently.

**Single origin again:** the renderer's `VITAL_COLORS` table (hex + label per vital) was a duplicate
of `GAME_COLOR_PALETTE.vitals` that still happened to agree. Folded back before it could drift the
way the affinity copy did.

**Verified in the running app:** a delver HUD showing four proportional bars, `fire · push`,
regen blocks and an `exploring` footer, and a hazard HUD showing exactly two bars with `decay` and
no footer — while the board camera sat at zoom 3. No console errors.

---

### M5 — Legibility verification and documentation ✅ DONE 2026-09-02

**Legibility harness:** `scripts/design/render-sprite-sheet.mjs` →
`docs/design/entity-sprite-sheet.png`, every role × affinity at 32/16/12 **and 8px**. The 8px column
is not a supported size — it is there to show what the camera floor prevents, and it shows it
plainly: at 8px `warden`, `hazard` and `resource` are the same dot and only `delver` survives.

**Verified in the running app** at a 900×600 viewport, board driven to the camera floor:
all four silhouettes remain separable at 12.8px, affinity colours remain distinct, and the HUD is
completely unaffected by board zoom — which is the separate-camera decision from M4 demonstrated
rather than asserted. No console errors.

#### ⚠️ Finding — what the camera floor actually costs

Measured, not estimated. At 900×600 with 32px tiles:

| Level side | Zoom to fit whole level | Camera allows | Whole level visible? |
|---|---|---|---|
| 22 (fixture max) | 0.852 | 0.852 | ✅ |
| 38 (≈20 small / 10 medium rooms) | 0.493 | 0.493 | ✅ |
| **46** | **0.408** | **0.408** | ✅ **threshold** |
| 53 (≈20 medium rooms) | 0.354 | 0.400 | ❌ |
| 74 (≈40 medium rooms) | 0.253 | 0.400 | ❌ |
| 100 (≈40 large rooms) | 0.188 | 0.400 | ❌ |

**Levels up to 46 tiles a side still frame whole; past that the floor binds and the player must
pan.** Every committed fixture is well inside that (max 22), so nothing in the repo regresses. But
`deriveLevelSideForWalkableTiles` will produce 51 for ten large rooms and 53 for twenty medium ones,
so real authored content *can* cross it.

This is a genuine loss of overview, not a false alarm, and the honest framing is that the floor does
not destroy information — below 12px the silhouettes were already indistinguishable — but it does
remove the ability to see a big level at once.

**Recommended follow-up (not this plan):** an explicit overview mode that, below 12px, drops the
silhouette and renders colour-only markers. That restores whole-level framing without pretending
shapes are readable. The alternative — lowering `MIN_CAMERA_ZOOM` again — just returns to showing
mush, which is what this plan set out to fix.

**Documentation landed in this diff:**
- `docs/architecture-charter.md` — single origin for colour; sprite semantics in `runtime`; the
  two-channel rule; the 12px floor; HUD model ownership; the HUD's own camera.
- `packages/runtime/src/render/README.md` — **new**; the render layer's ownership and gates.
- `docs/human-interfaces.md` — a "Reading the Gameplay Board" section covering the two channels,
  click vs hover, and the zoom clamp.
- `docs/readme-index.md` — registers the new render README and the M0 archive README.

---

## Decided — single equipped affinity (maintainer, 2026-09-02)

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

**DECIDED: single equipped affinity.** The sprite stays two-channel and M1 is unblocked on this
axis. Rationale as argued:
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

**Consequent work, not yet scheduled:** `equippedAffinity` has no runtime contract — it exists only
in `ui-web`. Single-equip is now a domain rule, so it needs to be modelled in `runtime` (which
affinity is active, and what a swap costs) rather than inferred by the renderer. The swap *price*
belongs to the Allocator per the charter; this plan does not set it. Flag as a follow-up milestone
once the visual work lands.

---

## Out of scope

- Card-builder visuals (`card-builder-phaser-renderer.js`) — different surface, different scale
  constraints, one medallion reference. Follow-up if the language proves out.
- The DOM `#actor-inspector` panel. It keeps the deep detail (affinity stacks, capabilities,
  constraints); the HUD is glance-level. They do not merge under this plan.
- ~~Tile, wall, and floor rendering.~~ **Brought into scope 2026-09-02** after reviewing the real
  UI: the bundle's medallion-era floor PNG was a busy checker drawn *on top of* the canonical floor
  colour, so the palette was never visible and the old art was the loudest thing on the board. Tiles
  are now flat fills from `GAME_COLOR_PALETTE.tiles`.
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
