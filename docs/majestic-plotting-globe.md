# Affinity Spatial System: Formulaic Interaction Grid + Aura Rendering

## Context

Actors project spatial affinity effects through their expressions (push, pull, emit, draw). Today, affinities are point-effects with no spatial projection. This change introduces:

1. A **formulaic interaction system** where every spatial behavior is described by parameterized equations with tunable weights — consistent with the existing codebase pattern of quadratic formulas (e.g., `computeStackCost: 10 + 8(n-1)^2`, regen costs `c*R^2`).
2. **Pixel-level tile masks** computed from formulas taking affinity color, expression type, and stacks as inputs.
3. **Dynamic recalculation** so auras update whenever actors move or state changes.

The formulas and weights are the hidden game engine — players see the visual effects but not the math.

---

## 1. Core Formulas

All formulas use a weights object `W` with tunable coefficients. Changing a weight adjusts the behavior without changing code.

### 1.1 Radius Formula

How far an expression reaches, in Chebyshev distance `max(|dx|, |dy|)`:

```
radius(stacks, W) = floor(W.baseRadius + W.radiusGrowth * stacks^W.radiusExponent)
```

| Expression | W.baseRadius | W.radiusGrowth | W.radiusExponent | s=1 | s=2 | s=3 | s=4 | s=5 |
|---|---|---|---|---|---|---|---|---|
| push | 0.5 | 0.5 | 1.0 | 1 | 1 | 2 | 2 | 3 |
| pull | 0.5 | 0.5 | 1.0 | 1 | 1 | 2 | 2 | 3 |
| emit | 1.0 | 1.0 | 1.0 | 2 | 3 | 4 | 5 | 6 |
| draw | 1.0 | 0.0 | 1.0 | 1 | 1 | 1 | 1 | 1 |

### 1.2 Intensity Falloff Formula

How strong the effect is at distance `d` from the source:

```
intensity(d, stacks, W) = W.peakIntensity * stacks^W.stackExponent * max(0, 1 - ((d - W.buffer) / radius)^W.falloffCurve)
```

For `d <= W.buffer`: intensity = 0 (buffer zone)
For `d > radius`: intensity = 0 (out of range)

| Expression | W.peakIntensity | W.stackExponent | W.buffer | W.falloffCurve |
|---|---|---|---|---|
| push | 1.0 | 0.5 | 0 | 2.0 (quadratic drop) |
| pull | 1.0 | 0.5 | 0 | 2.0 (quadratic drop) |
| emit | 1.0 | 0.3 | 1 | 1.0 (linear drop) |
| draw | 1.0 | 0.0 | 0 | 0.0 (flat, full at d=1) |

The `W.falloffCurve` parameter controls the shape:
- `0.0` = flat (no falloff, full intensity everywhere in range)
- `1.0` = linear falloff
- `2.0` = quadratic falloff (steep near edge, strong near source)
- `0.5` = square-root falloff (gentle near source, steep at edge)

### 1.3 Potency Formula

The mechanical strength (damage, mana gain, etc.) at a given distance:

```
potency(stacks, W) = W.basePotency + W.potencyGrowth * stacks^W.potencyExponent
```

| Expression | W.basePotency | W.potencyGrowth | W.potencyExponent |
|---|---|---|---|
| push | 0 | 1.0 | 2.0 (quadratic: 1, 4, 9, 16, 25) |
| pull | 0 | 1.0 | 1.0 (linear: 1, 2, 3, 4, 5) |
| emit | 0 | 1.0 | 1.0 (linear: 1, 2, 3, 4, 5) |
| draw | 0 | 1.0 | 1.0 (linear: 1, 2, 3, 4, 5) |

Effective potency at a tile = `potency(stacks, W) * intensity(d, stacks, W)`

### 1.4 Stack Resolution Formula (Opposite Affinities)

When opposite affinities overlap, stacks cancel 1:1 (consistent with existing `resolveNetPressure()` in `affinity-pressure.js`). The residual determines the winner and effect magnitude:

```
canceled = min(sourceStacks, targetStacks)
netSource = sourceStacks - canceled
netTarget = targetStacks - canceled
```

- `netSource > 0`: source wins. Residual effect uses `netSource` as effective stacks.
- `netTarget > 0`: target wins. Residual effect uses `netTarget` as effective stacks.
- Both zero: mutual cancellation — no mechanical effect, "neutralized" visual.

The winner's residual effect is computed by feeding `netStacks` back into the standard formulas:

```
residualPotency = potency(netStacks, W)
residualIntensity = intensity(d, netStacks, expression, W)
residualRadius = computeRadius(expression, netStacks)
```

**Example: fire+5+emit vs water+2+emit**
- canceled = min(5, 2) = 2
- netFire = 5 - 2 = **3**, netWater = 0
- Fire wins. Overlap tiles show fire at effective stacks 3 → radius `1 + 3 = 4`, potency 3
- The 2 water stacks are fully consumed; the water actor's field shrinks proportionally

**Example: fire+3+push vs water+3+pull (opposite, equal stacks)**
- canceled = min(3, 3) = 3
- netFire = 0, netWater = 0
- Mutual cancellation — no damage to either, "neutralized" visual on overlap tiles

### 1.5 Stack Resolution Formula (Same Affinities)

Same-kind overlap stacks reinforce rather than cancel:

```
mergedStacks = min(sourceStacks + targetStacks, W.maxMergedStacks)
```

`W.maxMergedStacks = 8` — combined stacks cap to prevent runaway effects.

The merged effect uses `mergedStacks` for visual intensity but each source retains its own potency for mechanical effects (damage, mana).

### 1.6 Effective Potency at a Tile

The final mechanical effect at any tile where projections overlap:

```
effectivePotency(sourceStacks, targetStacks, affinityRel, W) =
  if affinityRel == "opposite":
    netStacks = sourceStacks - min(sourceStacks, targetStacks)
    return potency(netStacks, W)
  if affinityRel == "same":
    return potency(sourceStacks, W)  // own potency, not merged
  if affinityRel == "unrelated":
    return potency(sourceStacks, W)  // independent, no interaction
```

### 1.7 Mana Cost Formula

Per-tick mana drain for persistent fields (emit, draw):

```
manaCost(stacks, W) = ceil(W.baseMana + W.manaGrowth * stacks^W.manaExponent)
```

| Expression | W.baseMana | W.manaGrowth | W.manaExponent |
|---|---|---|---|
| emit | 1 | 0.5 | 2.0 (quadratic: 1, 3, 6, 9, 14) |
| draw | 0 | 0.25 | 2.0 (quadratic: 0, 1, 3, 4, 7) |
| push | 0 | 0 | 0 (instantaneous, no per-tick cost) |
| pull | 0 | 0 | 0 (instantaneous, no per-tick cost) |

---

## 2. Pixel Mask Formulas

Each affected tile gets a pixel-level color mask computed from three inputs: **affinity color (RGB)**, **expression type**, and **stack intensity**. The mask is a function over normalized pixel coordinates `(u, v)` where `u, v in [0, 1]` within the tile.

### 2.1 Master Pixel Formula

For each pixel `(u, v)` in an affected tile:

```
maskAlpha(u, v) = clamp(0, 1,
  intensity_at_tile * stackAlphaMultiplier(stacks) * expressionMask(u, v, W)
)

outputR = baseR * (1 - maskAlpha) + affinityR * maskAlpha
outputG = baseG * (1 - maskAlpha) + affinityG * maskAlpha
outputB = baseB * (1 - maskAlpha) + affinityB * maskAlpha
```

Where `intensity_at_tile` comes from formula 1.2, and `affinityR/G/B` from `AFFINITY_COLOR_HEX`.

### 2.2 Stack Alpha Multiplier

```
stackAlphaMultiplier(stacks) = W.alphaBase + W.alphaGrowth * (stacks - 1)^W.alphaExponent
```

| W.alphaBase | W.alphaGrowth | W.alphaExponent | s=1 | s=2 | s=3 | s=4 | s=5 |
|---|---|---|---|---|---|---|---|
| 0.20 | 0.05 | 1.5 | 0.20 | 0.25 | 0.34 | 0.45 | 0.58 |

### 2.3 Expression Mask Functions

Each expression type defines a spatial pattern within the tile using `(u, v)` coordinates (0,0 = top-left, 1,1 = bottom-right). These are composable filter functions.

**emit — radial gradient (soft ambient field)**
```
emitMask(u, v, W) =
  let r = sqrt((u - 0.5)^2 + (v - 0.5)^2) / 0.707
  W.emitCenter + (1 - W.emitCenter) * (1 - r^W.emitSoftness)
```
- `W.emitCenter = 0.8` — intensity at tile center
- `W.emitSoftness = 0.5` — how soft the edges are (lower = softer)
- Produces: warm, even glow across the tile, slightly brighter center

**push — directional burst (sharp leading edge)**
```
pushMask(u, v, W) =
  let edge = 1 - abs(u - 0.5) * W.pushSpread
  let falloff = v^W.pushSharpness  // assumes push direction = "south" (normalized later)
  max(0, edge * falloff)
```
- `W.pushSpread = 1.5` — how wide the cone is (higher = narrower)
- `W.pushSharpness = 2.0` — how sharp the leading edge is
- The mask is rotated to match the push direction relative to the source actor

**pull — inverted radial (vortex toward center)**
```
pullMask(u, v, W) =
  let r = sqrt((u - 0.5)^2 + (v - 0.5)^2) / 0.707
  W.pullEdge * r^W.pullCurve + W.pullCenter * (1 - r)
```
- `W.pullEdge = 0.6` — intensity at tile edges
- `W.pullCenter = 1.0` — intensity at tile center
- `W.pullCurve = 0.5` — edge gradient curvature
- Produces: bright center, moderate edges — "pulling inward"

**draw — pulsing ring (absorption indicator)**
```
drawMask(u, v, W) =
  let r = sqrt((u - 0.5)^2 + (v - 0.5)^2) / 0.707
  let ring = exp(-((r - W.drawRingRadius)^2) / (2 * W.drawRingWidth^2))
  W.drawFill + (1 - W.drawFill) * ring
```
- `W.drawRingRadius = 0.6` — where the ring sits (0 = center, 1 = edge)
- `W.drawRingWidth = 0.15` — ring thickness (Gaussian sigma)
- `W.drawFill = 0.3` — base fill inside the ring
- Produces: ring-shaped glow near tile edge with soft interior fill

### 2.4 Interaction Mask Modifiers

When two expressions overlap on a tile, the mask is modified:

**conflict (opposite affinities)**
```
conflictMask(u, v, sourceColor, targetColor, W) =
  let noise = fract(sin(u * 127.1 + v * 311.7) * 43758.5453)  // deterministic hash
  let blend = smoothstep(W.conflictEdge, 1 - W.conflictEdge, noise)
  color = lerp(sourceColor, targetColor, blend)
  alpha *= W.conflictAlphaBoost
```
- `W.conflictEdge = 0.3` — how sharp the blend boundary is
- `W.conflictAlphaBoost = 1.4` — conflicts are visually louder
- Produces: mottled mix of both colors, dithered

**reinforcement (same affinity stack)**
```
reinforceMask(u, v, combinedStacks, W) =
  alpha *= stackAlphaMultiplier(combinedStacks)
  saturation += W.reinforceSatBoost * (combinedStacks - 1)
```
- `W.reinforceSatBoost = 5` — extra saturation % per combined stack

**layered (unrelated affinities)**
```
layeredMask(u, v, dominantColor, secondaryColor, W) =
  let stripe = floor((u + v) * W.layerFrequency) % 2
  color = stripe == 0 ? dominantColor : secondaryColor
  alpha *= W.layerAlphaDim
```
- `W.layerFrequency = 4.0` — stripe density
- `W.layerAlphaDim = 0.85` — slight dimming for visual complexity

### 2.5 Rendering Path

All rendering goes through the CLI pixel pipeline (`resource-bundle.js` → `renderBoardWithResourceBundle`). The UI displays images generated by the CLI — there is no separate CSS rendering path. The game can run headless via CLI without a browser.

The pixel mask formulas (§2.1-2.4) are applied directly in the pixel buffer via `applyAuraMask()`, which writes RGBA values into the `Uint8ClampedArray` using the existing `alphaBlend()` and `blitSprite()` patterns in `resource-bundle.js`.

---

## 3. Interaction Matrix (48 cells)

Three affinity relationships: **same**, **opposite**, **unrelated**. Each cell references the formulas above.

### Push encounters...

**push + push**
| Rel. | Source Effect | Target Effect | Formula | Tile Visual |
|---|---|---|---|---|
| same | none | none | same-kind: potencies cancel `net = 0` | clash-neutral: conflictMask same color |
| opposite | loser: targetVital -= residualPotency | winner: none | §1.4: `net = sStacks - min(s,t)`, damage = `potency(net, W)` | clash-opposed: conflictMask both colors, winner's color dominant |
| unrelated | none | none | independent, no interaction | layeredMask, both pass through |

**push + pull**
| Rel. | Source Effect | Target Effect | Formula | Tile Visual |
|---|---|---|---|---|
| same | none | none | push absorbed by same-kind pull: `net = 0` | redirect: pullMask with pushMask blended |
| opposite | source targetVital -= `potency(netPull, W)` | puller targetVital -= `potency(netPush, W)` | §1.4: each side takes residual from the other after cancellation | conflict: conflictMask |
| unrelated | none | none | independent | layeredMask |

**push + emit**
| Rel. | Source Effect | Target Effect | Formula | Tile Visual |
|---|---|---|---|---|
| same | none | none | push passes through same-kind field | pushMask over emitMask |
| opposite | push.effectiveStacks -= canceled | emit.effectiveStacks -= canceled | §1.4: `canceled = min(pushStacks, emitStacks)`, residual to winner; e.g. fire+5+push vs water+2+emit → net fire+3 | disruption: winner's color dominates, loser dims |
| unrelated | none | none | independent | layeredMask |

**push + draw**
| Rel. | Source Effect | Target Effect | Formula | Tile Visual |
|---|---|---|---|---|
| same | none | draw targetVital -= `potency(pushStacks, W) * intensity` | no cancellation (same kind, different expr) | strike: pushMask, high alpha burst |
| opposite | none | draw targetVital -= `potency(pushStacks, W) * W.oppositeVulnerability` | §1.4 cancellation applies first, then vulnerability; e.g. fire+3+push vs water+1+draw → net fire+2, damage = `potency(2) * 1.5` | vulnerability: pushMask * W.conflictAlphaBoost |
| unrelated | none | none | independent | pushMask passes through |

`W.oppositeVulnerability = 1.5` — draw takes 50% extra from opposite push after cancellation

### Pull encounters...

**pull + push** — mirror of push+pull

**pull + pull**
| Rel. | Source Effect | Target Effect | Formula | Tile Visual |
|---|---|---|---|---|
| same | source mana += steal | target mana -= steal | `steal = min(potency(sStacks), potency(tStacks)) * W.stealEfficiency`; higher stacks steals more but cap is the weaker | siphon: pullMask stream |
| opposite | source targetVital -= `potency(netTarget, W)` | target targetVital -= `potency(netSource, W)` | §1.4: `canceled = min(s,t)`, each takes damage from opponent's residual; e.g. decay+4+pull vs life+2+pull → decay net 2, life net 0; decay takes 0 damage, life takes `potency(2)` | mutual-drain: conflictMask spirals, winner's color dominant |
| unrelated | none | none | independent | layeredMask |

`W.stealEfficiency = 0.8` — pull steal is 80% efficient

**pull + emit**
| Rel. | Source Effect | Target Effect | Formula | Tile Visual |
|---|---|---|---|---|
| same | puller mana += absorption | field unaffected | `absorption = floor(emit.intensity * potency(pullStacks) * W.absorbRate)` | absorb: pullMask particles |
| opposite | puller targetVital -= exposure | field intensity reduced | §1.4: `canceled = min(pullStacks, emitStacks)`, puller takes `potency(netEmit) * W.toxicExposureRate`, field keeps `netEmit` stacks; e.g. decay+2+pull in life+5+emit → puller takes `potency(3)` damage, field reduced to net life+3 | toxic-exposure: conflictMask pulse |
| unrelated | none | none | independent | layeredMask |

`W.absorbRate = 0.6`, `W.toxicExposureRate = 1.0`

**pull + draw**
| Rel. | Source Effect | Target Effect | Formula | Tile Visual |
|---|---|---|---|---|
| same | puller mana += steal | draw mana -= steal | `steal = min(potency(sStacks), potency(tStacks)) * W.stealEfficiency` | tug: pullMask bidirectional |
| opposite | puller targetVital -= `potency(netDraw, W)` | draw mana -= `potency(netPull, W)` | §1.4: cancellation first, then residual damage/drain | rend: conflictMask sparks |
| unrelated | none | none | independent | layeredMask |

### Emit encounters...

**emit + push** — mirror of push+emit
**emit + pull** — mirror of pull+emit

**emit + emit**
| Rel. | Source Effect | Target Effect | Formula | Tile Visual |
|---|---|---|---|---|
| same | none | none | §1.5: `mergedStacks = min(sStacks + tStacks, W.maxMergedStacks)`; visual uses merged, mechanics unchanged | reinforceMask at combined stacks |
| opposite | source field reduced | target field reduced | §1.4: `canceled = min(sStacks, tStacks)`, winner keeps `netStacks`; e.g. fire+5+emit vs water+2+emit → net fire+3 in overlap zone, water field gone there | conflict-zone: winner's color at netStacks intensity; if net=0, grey neutralized |
| unrelated | none | none | both coexist independently | layeredMask dual-color |

**emit + draw**
| Rel. | Source Effect | Target Effect | Formula | Tile Visual |
|---|---|---|---|---|
| same | field unaffected | draw mana += absorption | `absorption = floor(intensity(emitStacks) * potency(drawStacks) * W.absorbRate)` | absorb: drawMask glow |
| opposite | field unaffected at source | draw targetVital -= exposure | §1.4: `canceled = min(emitStacks, drawStacks)`, draw takes `potency(netEmit) * W.toxicExposureRate`; e.g. fire+4+emit vs water+1+draw → draw takes `potency(3) * 1.0` damage | susceptible: conflictMask pulse |
| unrelated | none | none | no interaction | no visual change |

### Draw encounters...

**draw + push** — mirror of push+draw
**draw + pull** — mirror of pull+draw
**draw + emit** — mirror of emit+draw

**draw + draw**
| Rel. | Source Effect | Target Effect | Formula | Tile Visual |
|---|---|---|---|---|
| same | none | none | no interaction (both absorbing, no conflict) | resonance: drawMask gentle pulse |
| opposite | source targetVital -= `potency(netTarget, W)` | target targetVital -= `potency(netSource, W)` | §1.4: `canceled = min(sStacks, tStacks)`, each takes residual; e.g. life+3+draw vs decay+1+draw → life net 2 (takes 0), decay net 0 (takes `potency(2)`) | corrosion: conflictMask crackle, winner's color |
| unrelated | none | none | no interaction | no visual change |

---

## 4. Master Weights Object

Single tunable configuration — changing any value adjusts the game without code changes:

```js
const SPATIAL_WEIGHTS = {
  // --- Radius (formula 1.1) ---
  push:  { baseRadius: 0.5,  radiusGrowth: 0.5,  radiusExponent: 1.0  },
  pull:  { baseRadius: 0.5,  radiusGrowth: 0.5,  radiusExponent: 1.0  },
  emit:  { baseRadius: 1.0,  radiusGrowth: 1.0,  radiusExponent: 1.0  },
  draw:  { baseRadius: 1.0,  radiusGrowth: 0.0,  radiusExponent: 1.0  },

  // --- Intensity falloff (formula 1.2) ---
  push:  { peakIntensity: 1.0, stackExponent: 0.5, buffer: 0, falloffCurve: 2.0 },
  pull:  { peakIntensity: 1.0, stackExponent: 0.5, buffer: 0, falloffCurve: 2.0 },
  emit:  { peakIntensity: 1.0, stackExponent: 0.3, buffer: 1, falloffCurve: 1.0 },
  draw:  { peakIntensity: 1.0, stackExponent: 0.0, buffer: 0, falloffCurve: 0.0 },

  // --- Potency (formula 1.3) ---
  push:  { basePotency: 0, potencyGrowth: 1.0, potencyExponent: 2.0 },
  pull:  { basePotency: 0, potencyGrowth: 1.0, potencyExponent: 1.0 },
  emit:  { basePotency: 0, potencyGrowth: 1.0, potencyExponent: 1.0 },
  draw:  { basePotency: 0, potencyGrowth: 1.0, potencyExponent: 1.0 },

  // --- Mana cost (formula 1.5) ---
  push:  { baseMana: 0, manaGrowth: 0,    manaExponent: 0   },
  pull:  { baseMana: 0, manaGrowth: 0,    manaExponent: 0   },
  emit:  { baseMana: 1, manaGrowth: 0.5,  manaExponent: 2.0 },
  draw:  { baseMana: 0, manaGrowth: 0.25, manaExponent: 2.0 },

  // --- Pixel mask (formula 2.x) ---
  alphaBase: 0.20,  alphaGrowth: 0.05,  alphaExponent: 1.5,

  emitCenter: 0.8,   emitSoftness: 0.5,
  pushSpread: 1.5,   pushSharpness: 2.0,
  pullEdge: 0.6,     pullCenter: 1.0,   pullCurve: 0.5,
  drawRingRadius: 0.6, drawRingWidth: 0.15, drawFill: 0.3,

  // --- Interaction modifiers ---
  maxMergedStacks: 8,           // cap for same-kind reinforcement (§1.5)
  oppositeVulnerability: 1.5,   // draw takes 1.5x from opposite push (after §1.4 cancellation)
  stealEfficiency: 0.8,         // pull-pull same-kind steal rate
  absorbRate: 0.6,              // pull/draw from same-kind emit
  toxicExposureRate: 1.0,       // pull/draw from opposite emit

  // --- Conflict visuals (pixel masks) ---
  conflictEdge: 0.3,            // noise blend sharpness
  conflictAlphaBoost: 1.4,      // conflicts are visually louder
  reinforceSatBoost: 0.05,      // extra alpha per combined stack
  layerFrequency: 4.0,          // stripe density for unrelated overlap
  layerAlphaDim: 0.85,          // slight dim for layered
}
```

---

## 5. Economic Model: Sunk Cost Awareness

Every action in the game has upfront "sunk costs" that were paid at actor build time. The spatial system must be aware of these costs so a future wave can incorporate spend-vs-return analysis into gameplay.

### 5.1 The Four Sunk Costs

For any affinity action (e.g., `fire+2+push`), four costs were already paid via `calculateActorCost()` in `cost-model.js`:

```
totalSunkCost(kind, stacks, expression) =
  affinityBaseCost                           // 30 tokens (design §6)
  + cumulativeStackCost(stacks)              // Σ(10 + 8·(n-1)²) per stack (design §6.2)
  + expressionCost(expression)               // 35 for push/pull, 25 for emit/draw (design §6.4)
  + manaInfrastructureCost                   // 2·M_max + 5·R_mana² (design §7, §8)
```

**Existing formulas from `cost-model.js`:**
- `computeStackCost(n) = 10 + 8·(n-1)^2` — quadratic per-stack
- `computeCumulativeStackCost(s) = Σ computeStackCost(1..s)` — total investment
- `computeExternalManaUse(s) = 5 + 4·(s-1)^2` — per-use mana for push/pull
- `computeInternalManaUpkeep(s) = 2 + s` — per-tick mana for emit/draw
- `computeDrawNet(s, e) = 3·min(s,e) - (2+s)` — net mana from draw

### 5.2 Sunk Cost Breakdown by Example

**fire+2+push actor:**
| Cost Component | Formula | Tokens |
|---|---|---|
| Affinity base | 30 | 30 |
| Stack 1 | 10 + 8·(0)^2 | 10 |
| Stack 2 | 10 + 8·(1)^2 | 18 |
| Push expression | flat | 35 |
| Mana pool (min viable: max=5) | 2·5 | 10 |
| Mana regen (min viable: R=1) | 5·1^2 | 5 |
| **Total sunk** | | **108** |

**Runtime cost per use:** `computeExternalManaUse(2) = 5 + 4·(1)^2 = 9 mana`

### 5.3 How This Connects to the Spatial System

Each interaction in the matrix (Section 3) has an implicit economic dimension:

- **Push hits draw (opposite, W.oppositeVulnerability=1.5)**: The push actor spent 108 tokens at build time. The draw actor spent ~83 tokens (25 for draw expression vs 35 for push). The push deals 1.5x damage — the 30% extra investment in push expression yields a 50% damage bonus against the cheaper draw.

- **Pull steals from emit (same kind)**: The pull actor's mana gain (`absorption = emit.intensity * potency * W.absorbRate`) partially offsets their ongoing `computeExternalManaUse` cost per activation. Higher stacks = higher mana cost to steal but more stolen.

- **Emit field persistence**: Costs `computeInternalManaUpkeep(s) = 2 + s` mana per tick. A fire+3+emit actor burns 5 mana/tick to project a radius-4 field. Their mana regen must exceed this or the field collapses (trigger T06).

### 5.4 Data Annotation for Future Waves

The `SPATIAL_WEIGHTS` object (Section 4) and `INTERACTION_MATRIX` (Section 3) will be annotated with cost references but **not implemented** in Waves 1-6. This is prep for a future "Economic Wave":

```js
// Each interaction cell will carry (future):
{
  sourceEffect: "...",
  targetEffect: "...",
  visualState: "...",
  // Future economic fields:
  costRef: {
    sourceSunkCostFn: "totalSunkCost",    // function to compute build cost
    sourcePerUseCostFn: "computeExternalManaUse",  // per-activation cost
    efficiencyRatio: null,                // computed at runtime: damage / (sunkCost + perUseCost)
  }
}
```

The key variables that determine ROI at runtime:
- **When** the actor triggers the action (timing relative to opponent state)
- **How often** (frequency vs mana sustainability)
- **Interaction outcome** (how much of the potency lands vs is countered)
- **Counterplay cost** (how much the defender spent to mitigate)

### 5.5 Non-Goals for Waves 1-6

The following are deferred to a future Economic Wave:
- Computing actual ROI or efficiency ratios at runtime
- Displaying cost information to players (the economic model stays hidden)
- Adjusting weights based on cost balance
- "Value of a tile" calculations based on who controls it

Waves 1-6 ensure the formulas, weights, and interaction matrix are structured so that economic analysis can be layered on without restructuring.

---

## 6. Recalculation Triggers


| ID | Event | Scope |
|---|---|---|
| T01 | Actor moves | partial: old + new tile neighborhoods |
| T02 | Actor gains/loses stacks | partial: actor neighborhood to max radius |
| T03 | Push/pull fired | partial: source + affected radius (then clears) |
| T04 | Actor death/removal | partial: last projection area |
| T05 | Emit field created/destroyed | partial: emitter + emit radius |
| T06 | Emit mana exhaustion | partial: field collapses |
| T07 | Draw activated/deactivated | partial: draw actor + cardinal neighbors |
| T08 | Trap armed/disarmed | partial: trap + projection radius |
| T09 | Barrier raised/destroyed | partial: barrier + adjacent tiles |
| T10 | Ambient pressure change | full recalc |
| T11 | Tick boundary | full: all persistent fields re-evaluated |

**Processing order:** T04 > T01 > T09 > T08 > T02 > T05 > T06 > T07 > T03 > T10 > T11

**Optimization:** Maintain `dirtyTileSet` — each trigger marks affected tiles; only dirty tiles recompute.

---

## 7. Implementation Waves

Each wave is scoped for a Sonnet-level agent: 2-4 files, clear inputs/outputs, independently testable.

### Wave 1: Weights + Core Formulas
**Goal:** The weights object and pure formula functions. No rendering, no integration.

**Files:**
- `packages/runtime/src/contracts/affinity-spatial-rules.js` — NEW
  - `SPATIAL_WEIGHTS` frozen object (section 4)
  - `INTERACTION_MATRIX` — 48-cell lookup: `matrix[sourceExpr][targetExpr][affinityRel]` → `{ sourceEffect, targetEffect, visualState }`
  - Each cell references formula IDs and weight keys
- `packages/runtime/src/render/affinity-spatial-formulas.js` — NEW
  - `computeRadius(expression, stacks, weights)`
  - `computeIntensity(d, stacks, expression, weights)`
  - `computePotency(stacks, expression, weights)`
  - `computeManaCost(stacks, expression, weights)`
  - `computeInteractionStrength(sourceStacks, targetStacks, weights)`
  - `computeStackAlphaMultiplier(stacks, weights)`
  - All pure functions, no side effects

**Tests:** `tests/runtime/affinity-spatial-formulas.test.js` — NEW
- Verify radius at each stack level for each expression
- Verify intensity falloff curve shape
- Verify potency scaling (push quadratic, others linear)
- Verify buffer enforcement (emit d=1 → 0)
- Verify edge cases (stacks=0, negative distance, etc.)

**Depends on:** nothing (standalone)

---

### Wave 2: Interaction Matrix + Tile Resolution
**Goal:** Given actor positions and affinities, compute what each tile "sees" and resolve overlaps.

**Files:**
- `packages/runtime/src/render/affinity-aura.js` — NEW
  - `projectExpression(sourcePos, expression, kind, stacks, tiles, weights)` → `[{x, y, intensity, potency}]`
  - `computeAuraMap(actors, baseTiles, { affinityOpposites, weights })` → `Map<"x,y", projections[]>`
  - `resolveInteractionAtTile(projections[], matrix, weights)` → `{ layers, visualState, sourceEffects, targetEffects }`
  - `serializeAuraMap(resolvedMap)` → `[{ position, layers, visualState, conflict }]`
  - Wall tiles excluded from projection

**Tests:** `tests/runtime/affinity-aura.test.js` — NEW
- Single actor emit: buffer at d=1, visible at d=2+
- Single actor push: visible at d=1, steep falloff
- Two actors same-kind emit overlap → reinforcement
- Two actors opposite emit overlap → conflict-zone
- Pull actor in emit field (same kind) → absorb
- Pull actor in emit field (opposite) → toxic-exposure
- Draw actor in emit field (same kind) → absorb
- Draw actor in emit field (opposite) → susceptible
- Wall tile exclusion

**Fixture:** `tests/fixtures/personas/affinity-spatial-grid-v1-basic.json` — NEW

**Depends on:** Wave 1 (formulas)

---

### Wave 3: Pixel Mask Engine
**Goal:** Per-tile pixel mask computation from expression type, color, and stacks. Used by CLI renderer.

**Files:**
- `packages/runtime/src/render/affinity-tile-mask.js` — NEW
  - `emitMask(u, v, weights)` → alpha
  - `pushMask(u, v, weights)` → alpha
  - `pullMask(u, v, weights)` → alpha
  - `drawMask(u, v, weights)` → alpha
  - `conflictMask(u, v, sourceColor, targetColor, weights)` → `{r, g, b, a}`
  - `reinforceMask(u, v, combinedStacks, weights)` → alpha modifier
  - `layeredMask(u, v, dominantColor, secondaryColor, weights)` → `{r, g, b, a}`
  - `applyAuraMask(pixels, width, tileX, tileY, tileSize, affinityRgba, maskFn, maskAlpha)` — writes to pixel buffer
- `packages/runtime/src/render/affinity-palette.js` — MODIFY
  - Add 5th stack intensity tier
  - Add `resolveAuraRgba(resolvedAuraCell, baseAlpha)` helper

**Tests:** `tests/runtime/affinity-tile-mask.test.js` — NEW
- Each mask function produces values in [0, 1]
- Emit mask: center > edge
- Push mask: directional concentration
- Pull mask: edge > center gradient
- Draw mask: ring shape at expected radius
- Conflict mask: deterministic dithered blend
- Alpha multiplier at each stack level

**Depends on:** Wave 1 (weights)

---

### Wave 4: CLI Rendering Integration
**Goal:** Plug the aura map and pixel masks into the existing CLI image pipeline.

**Files:**
- `packages/runtime/src/render/resource-bundle.js` — MODIFY
  - Parameterize `applyAffinityTint` to accept alpha (currently hardcoded 0.4)
  - In `renderBoardWithResourceBundle`, after trap tinting loop:
    - Build aura index from `observation.auras`
    - For each floor tile with aura and no existing trap tint:
      - Look up `visualState` → select mask function
      - Call `applyAuraMask` with expression-appropriate mask
    - Traps take visual priority over auras

**Tests:** Add cases to existing `tests/runtime/resource-bundle.test.js` (if it exists) or `tests/runtime/affinity-aura-render.test.js` — NEW
- Floor tile with aura gets tinted pixels
- Trap tile is not overridden by aura
- Conflict tile gets blended colors

**Depends on:** Wave 2 (aura map), Wave 3 (pixel masks)

---

### Wave 5: Tick Lifecycle Integration
**Goal:** Compute auras after each state change and attach to observation.

**Files:**
- `packages/runtime/src/runner/runtime-fsm.mjs` — MODIFY
  - After `readObservation()`, call `computeAuraMap` and `serializeAuraMap`
  - Attach as `observation.auras`
  - Import from `affinity-aura.js` and `affinity-spatial-rules.js`
- `packages/runtime/src/contracts/domain-constants.js` — MODIFY
  - Export `EXPRESSION_SPATIAL_DEFAULTS` (buffer, baseRadius per expression)

**Tests:** Integration test verifying observation contains `auras` field after tick
- `tests/runtime/affinity-aura-lifecycle.test.js` — NEW

**Depends on:** Wave 2 (aura computation)

---

### Wave 6: UI Display Integration
**Goal:** Ensure the UI correctly displays CLI-rendered images that now contain aura visuals. No separate CSS rendering — the UI receives pre-rendered pixel images from the CLI pipeline.

**Files:**
- `packages/ui-web/src/views/simulation-view.js` — MODIFY (if needed)
  - Ensure `observation.auras` data is passed through to any tooltip/info panels
  - Aura data available for hover-over inspection (which actor is projecting, what interaction)
- `packages/ui-web/src/resource-bundle-view.js` — VERIFY
  - Confirm `renderBundleBoardToCanvas` correctly displays pixel buffers that now include aura tinting from Wave 4

**Tests:** Manual verification via `pnpm run serve:ui` and `pnpm run demo:cli`

**Depends on:** Wave 4 (CLI rendering), Wave 5 (observation data)

---

## 8. Files Summary

| File | Wave | Status |
|---|---|---|
| `runtime/src/contracts/affinity-spatial-rules.js` | 1 | NEW — weights + interaction matrix |
| `runtime/src/render/affinity-spatial-formulas.js` | 1 | NEW — pure formula functions |
| `runtime/src/render/affinity-aura.js` | 2 | NEW — projection + tile resolution |
| `runtime/src/render/affinity-tile-mask.js` | 3 | NEW — pixel mask functions |
| `runtime/src/render/affinity-palette.js` | 3 | MODIFY — 5th tier, aura helpers |
| `runtime/src/render/resource-bundle.js` | 4 | MODIFY — aura rendering pass |
| `runtime/src/runner/runtime-fsm.mjs` | 5 | MODIFY — tick lifecycle |
| `runtime/src/contracts/domain-constants.js` | 5 | MODIFY — spatial defaults |
| `ui-web/src/views/simulation-view.js` | 6 | VERIFY/MODIFY — pass aura data to UI panels |
| `tests/runtime/affinity-spatial-formulas.test.js` | 1 | NEW |
| `tests/runtime/affinity-aura.test.js` | 2 | NEW |
| `tests/runtime/affinity-tile-mask.test.js` | 3 | NEW |
| `tests/fixtures/personas/affinity-spatial-grid-v1-basic.json` | 2 | NEW |

## 9. Verification

1. `pnpm run test` — all existing tests pass after each wave
2. Wave 1: `node --test tests/runtime/affinity-spatial-formulas.test.js`
3. Wave 2: `node --test tests/runtime/affinity-aura.test.js`
4. Wave 3: `node --test tests/runtime/affinity-tile-mask.test.js`
5. Wave 4: `pnpm run demo:cli` — visual check: auras around emit actors
6. Wave 5: Observation object contains `auras` array
7. Wave 6: `pnpm run serve:ui` — CLI-rendered images display correctly with aura tinting in browser
