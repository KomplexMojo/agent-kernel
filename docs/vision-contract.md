# Vision Contract
Non-negotiables:
- Runs in the browser.
- External services are accessed only via adapters (API boundary).
- Core simulation is deterministic and replayable.
- The persona model is the unit of comprehension: every domain behavior belongs to exactly one
  persona, so a solo developer can describe what each part does and why. Code that cannot be
  described this way is misplaced.

Basic Adapters are in place for:
- Blockchain anchoring, IPFS, Chainlink integrations (adapters later).
- Multi-persona orchestration layers.

## Per-Actor Perception

- Perception is deterministic core policy. With no surviving light or dark, an actor sees a
  Chebyshev radius of 3 and always retains a minimum radius of 1.
- Core resolves light/dark opposition before visibility reads it. Two or more surviving dark stacks
  collapse sight to radius 1. Surviving light extends the baseline by one tile per stack. Target light
  has no separate reveal rule; it matters only by cancelling target dark in the core affinity field.
- Observation tile-actor kind `1` is opaque, covering both walls and barriers. Sight uses a
  deterministic supercover ray; touching either opaque side of an exact diagonal corner blocks the
  ray. An opaque endpoint remains visible, while cells behind it do not.
- A target under at least two surviving dark stacks is perceived only within radius 1. Actors and
  hazards use the same radius, occlusion, and target-concealment rule. Visibility does not invent a
  resource observation.
- Missing or malformed tile geometry preserves radius-only visibility. If the observer cannot be
  located, the observation remains unchanged rather than silently blinding the actor. The observer
  itself is always retained.

## Affinity Interaction Compatibility

- The pairwise affinity interaction contract is ordered by `(sourceExpression, targetExpression,
  relationship)`. `relationship` is `same` for equal kinds, `opposite` for a declared opposite pair,
  and `neutral` otherwise. It is distinct from spatial affinity-field cancellation.
- Every neutral interaction is a no-op: source and target effects are `none`, no stacks cancel, and
  the visual is `layered`. Every opposite interaction cancels `min(sourceStacks, targetStacks)`;
  same and neutral interactions never cancel stacks. Only this cancellation has a core-defined
  magnitude and may be applied at runtime; effect codes remain descriptive until separately promoted.
- Effects are directional: source and target effects are separate ordered rules, not a mirrored
  calculation. For same relationships, the source rule is: Push has none; Pull gains mana except
  against Push; Emit has none; Draw damages Push, loses mana against Pull, gains mana against Emit,
  and otherwise has none. The target rule is: Push has none; Pull loses mana from
  Pull and gains mana from Emit or Draw; Emit has none; Draw takes damage from Push, loses mana from
  Pull, and gains mana from Emit. For opposite relationships, the source rule is: Push yields
  conditional damage against Push, damage against Pull, potency reduction against Emit, and none
  against Draw; Pull deals damage; Emit causes potency reduction except against Draw; Draw causes
  amplified damage against Push, mana loss against Pull, and damage against Emit or Draw. The target
  rule is: Push receives conditional damage from Push, potency reduction from Emit, and none
  otherwise; Pull receives damage; Emit receives potency reduction except from
  Draw; Draw receives amplified damage from Push, mana loss from Pull, and damage from Emit or Draw.
- Visual names are stable semantic outputs rather than raw codes. Same interactions are
  `clash_neutral` (Push/Push), `redirect` (Push/Pull), `emit_field` (Push/Emit), `strike`
  (Push/Draw), `siphon` (Pull/Pull), `absorb` (Pull/Emit and Emit/Draw), `tug` (Pull/Draw),
  `reinforcement` (Emit/Emit), and `resonance` (Draw/Draw). Opposite interactions are
  `clash_opposed` (Push/Push), `conflict` (Push→Pull), `backlash` (Pull→Push), `disruption`
  (Push/Emit and Emit/Push), `vulnerability` (Push/Draw and Draw/Push), `mutual_drain`
  (Pull/Pull), `toxic_exposure` (Pull/Emit and Emit/Pull), `rend` (Pull/Draw and Draw/Pull),
  `conflict_zone` (Emit/Emit), `susceptible` (Emit/Draw and Draw/Emit), and `corrosion`
  (Draw/Draw).
- The exhaustive 48-cell v1 oracle is compatibility law. Any change to an effect, visual name, or
  cancellation outcome is a separate product decision; refactors must preserve every cell exactly.

## Actor Runtime Decisions

- **Field-aware v2 policy:** the Actor emits `actor-decision-objective-v2`, retaining the v1 primary
  order and inserting `fieldSafety` then `fieldBenefit` before cast reserve. It uses only canonical,
  post-cancellation affinity-field
  cells that the Actor can perceive by radius and line of sight; concealed source identities never
  cross that boundary. A move is evaluated at its destination and every other action at the Actor's
  current cell. Harm is penalized first; beneficial effects count only up to the affected vital's
  missing capacity. These are tie-breakers only: they cannot override intent, target finish, or
  profile alignment. No field prediction, affordability, price, effect application, or Z3 variable
  is introduced. Consumers will compare both v1 and v2 tuples opaquely and defer unknown contracts.
- The Actor owns candidate feature meaning and emits `actor-decision-objective-v2` inside the existing
  `runtime-decision-v1` envelope. Its rank is maximized lexicographically in this exact order:
  `intentClass`, `targetFinish`, `profileAlignment`, `fieldSafety`, `fieldBenefit`, `castReserve`,
  `inputOrder`. Consumers retain opaque compatibility for valid v1 envelopes.
- `intentClass` preserves Actor proposal authority and the legacy action-class order. Target health,
  profile alignment, perceived field effects, and live cast reserve are ordered secondary evidence;
  candidate input order is the deterministic final tie-break. Cognition/reasoning diagnostics do not
  fabricate multi-step planning, and `AggroRangeBoost` does not reveal unseen targets.
- This per-actor choice has no joint constraint, so Z3 adds no value. Platform adapters validate and
  stably sort Actor-authored tuples without interpreting roles, affinities, motivations, or hazards.
  Every live Actor problem includes an objective: unknown motivation profiles receive an Actor-authored
  compatibility tuple that preserves the former deterministic action order. A missing objective defers
  with `actor_decision_objective_missing`; a malformed objective defers with
  `actor_decision_objective_invalid`. The runtime then uses its deterministic Actor fallback. Adapters
  never reconstruct policy or emit invented ranked diagnostics for old envelopes.

## Allocator Budget Fit

- The solver-backed budget-fit contract is an Allocator-owned search over requested `floorTiles` and
  `hallwayTiles`; prices are Allocator-authored inputs. Retained counts are integers within
  `0..requested`, at least one floor tile is required, and total spend may not exceed the cap. That
  contract never manufactures a requested tile.
- The exact objective is lexicographic: maximize total retained tiles; minimize proportional distortion
  from the requested floor/hallway mix; then maximize counts in canonical `LAYOUT_TILE_FIELDS` order.
  Spend is a hard constraint, not a minimization objective.
- Invalid budget, layout, count, or price input is an error and never reaches a solver. A valid problem
  is unsatisfiable only when one floor tile costs more than the cap, reported as
  `allocator_minimum_floor_unaffordable` with no partial layout. Already-affordable layouts remain
  unchanged.
- For an over-budget valid layout, the Allocator emits a `solver_request` effect containing its opaque
  problem; command-layer host glue dispatches the effect through the solver port and returns the result
  for Allocator validation. No adapter object crosses into the persona. The CLI/web hybrid adapter uses
  genuine Z3 for this domain. Actor action selection stays on its independent pure tuple path and never
  initializes Z3. Adapter or capability absence, `deferred`, or `error` uses the characterized greedy
  fitter as the exact deterministic fallback; a proved `unsat` is final. The 660-case fixture is
  fallback evidence and must not be re-recorded to disguise a changed destination.
