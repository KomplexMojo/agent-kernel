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

## Actor Runtime Decisions

- The Actor owns candidate feature meaning and emits `actor-decision-objective-v1` inside the existing
  `runtime-decision-v1` envelope. Its rank is maximized lexicographically in this exact order:
  `intentClass`, `targetFinish`, `profileAlignment`, `hazardSafety`, `castReserve`, `inputOrder`.
- `intentClass` preserves Actor proposal authority and the legacy action-class order. Target health,
  profile alignment, observed hazard exposure, and live cast reserve are ordered secondary evidence;
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
