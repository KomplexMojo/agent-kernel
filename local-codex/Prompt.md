# Prompt

## Problem
There is no clear, verified architectural foundation establishing that all game elements — room tiles, delvers, wardens, hazards, and resources — share a common actor base class with a unified configuration surface. The card builder likely has divergent screens or config models per type. This task verifies and enforces that all game elements derive from a single actor base, that each type's allowed configuration concepts are correctly constrained, and that the card builder presents one unified surface that enforces per-type rules.

## Scope
- Verify that room tiles, delvers, wardens, hazards, and resources all derive from a common actor base class.
- Verify that the actor base provides affinities, affinity expressions, motivations, and vitals as shared configuration concepts.
- Verify that room tiles (inanimate objects) expose only the subset of actor configuration that is appropriate: affinities, motivations, durability — but NOT affinity expressions, health, mana, stamina, or movement.
- Verify that room tiles carry token costs when they are configured and assembled into a room.
- Verify that delvers and wardens are fully configurable: all affinities, expressions, vitals (health, mana, stamina, mana regen), and motivations.
- Verify that hazards have a restricted configuration: exactly 1 affinity (must match the room's affinity), motivation fixed to stationary, vitals restricted to mana and mana regeneration only — no health, stamina, or durability.
- Verify that resources share the full configuration surface of delvers and wardens.
- Verify that resources are consumable: a delver or warden can capture a resource and apply its attributes to themselves.
- Verify that resources have a permanence concept with three modes: level-only, pure consumable (current stat only), and permanent (modifies the delver/warden's base configuration).
- Verify that the CLI is the base enforcement layer: all actor configuration rules are validated at the CLI level.
- Verify that the card builder UI is a unified "JSON builder" that mirrors CLI-available configuration per actor type, displays configuration and budget constraints visually, and notifies the user inline when an invalid configuration is attempted.

## Constraints
- All game elements must derive from the same actor base class.
- Room tiles are inanimate: no movement, no health, no mana, no stamina.
- Room tiles may have durability.
- Token costs are a runtime computation — room tile configuration contributes to the room's computed token cost at runtime, not as a stored field.
- Hazards: exactly 1 affinity, and it must match the containing room's affinity.
- Hazards: motivation is always stationary (cannot move).
- Hazards: vitals are mana and mana regeneration only — no health, no stamina, no durability.
- Resources: same configuration surface as delvers and wardens.
- Resources: are consumable (not permanent by default).
- Resources: permanence modes are (1) level-only, (2) pure consumable (current stat delta, not max), (3) permanent (base config modification).
- NFT/blockchain implementation of permanence is out of scope — do not design for it now.
- The card builder must not use separate screens per actor type.
- CLI validation is the source of truth; the UI card builder reflects and visually communicates those same constraints.

## Acceptance Criteria
1. Codebase audit confirms all five entity types (room tile, delver, warden, hazard, resource) share a common actor base.
2. Room tile configuration is confirmed to include affinities, motivations, durability — and to exclude affinity expressions, health, mana, stamina.
3. Room tile token cost is confirmed to be a runtime computation aggregated from the tile's configuration; no stored cost field exists on the artifact.
4. Delver and warden configuration is confirmed to be fully open: all affinities, affinity expressions, all vitals, all motivations.
5. Hazard configuration is confirmed to enforce: 1 affinity (room-matched), stationary motivation, mana + mana regen vitals only.
6. Resource configuration is confirmed to match delver/warden surface plus consumable behavior and three permanence modes.
7. CLI is confirmed as the base enforcement layer: invalid configurations are rejected at the CLI level.
8. Card builder UI is confirmed to be a unified "JSON builder" reflecting CLI-available configuration per actor type, with visual indicators for configuration constraints and budget constraints, and inline notification when an invalid configuration is attempted.

## Out of Scope
- NFT or blockchain implementation of resource permanence.
- Any net-new feature work beyond verifying and conforming the existing structure to these constraints.

## Open Questions
- None remaining. All three pre-planning questions resolved:
  1. Token cost = runtime computation, not a stored field.
  2. Affinity expressions are NOT available for room tiles; they are available for delvers, wardens, hazards, and resources.
  3. CLI is the enforcement layer; the card builder UI is a unified visual JSON builder that mirrors CLI constraints, shows budget and configuration limits visually, and notifies on invalid input.
