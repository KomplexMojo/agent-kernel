# Unified Actor Rewrite — approved 2026-09-07
Implement the approved requirements in this document and the ordered milestones in Plan.md. Clean break from committed 9a9168f8c63b07b1e9e789daa598a6edaa061cbd; no version bumps, compatibility engine, or conventional attacks. The original checkout and benchmark worktrees are out of scope.

Five editable presets (delver, warden, hazard, resource, barrier) normalize to one mechanical actor model. Alignment is independent of presentation. One actor mana pool; inventory keyed by affinity/expression with stacks; one active pair; equip and take each consume the tick's action. Compose motivation candidates using existing Actor ranking.

Fire/earth erode durability with health overflow. Water/decay bypass durability to health. Corrode affects durability only. Wind affects stamina. Life restores health or drains/transfers actual health. Fortify restores durability or drains/transfers actual durability. Light restores/drains mana; dark drains mana. Harmful-affinity pull/draw neutralizes active effects, never heals old damage. Matching draw credits actual absorbed exposure to actor mana, bounded per source.

Defeat is terminal at the declared health/durability vital. Defeated actors cannot act, emit, regenerate, or block. Adjacent/same-cell take claims one named holding. Each owned affinity/expression pair exposes one claim once on defeat: receiver gains exactly one stack regardless of source stacks. No automatic pickup/equip. Explicit vital grants remain separate from the source's living vital pools.

Pricing is property-based in Allocator; one spawn charge, no category premium, no double charge for equipment-derived loot. Preserve distinct CLI/MCP/UI presets and grouped presentation. Full finish requires one reachable engine, updated docs, deterministic replay, full suite/typecheck/architecture gates, and perturbations. No remote benchmark run.


## Complete locked mechanics

### Actor records and defaults
Core has one actor registry with stable string IDs, position, alignment, lifecycle,
optional health/durability/mana/stamina (current/max/regen), explicit defeatVital,
capabilities, motivation list, affinity entries, one active pair, and holdings.
Presentation category lives outside mechanical core state. Do not dispatch on
category in core. Capabilities cover move, cast, equip, take, exit, movement
blocking, and sight blocking.

| Editable preset | Alignment | Defeat vital | Movement | Movement blocking |
| --- | --- | --- | --- | --- |
| Delver | external | health | enabled | enabled |
| Warden | dungeon | health | enabled | enabled |
| Hazard | dungeon | durability | disabled | disabled |
| Resource | dungeon | durability | disabled | disabled |
| Barrier | dungeon | durability | disabled | enabled |

Defaults are editable, never category-enforced restrictions. Floors, ordinary
walls, spawn and exit remain terrain. Destructible barriers are actors. Multiple
nonblocking actors can share a cell, including one with a blocking actor.
Same alignment means allied regardless of preset; opposite alignment remains
hostile even within the same preset.

### Authoritative affinity matrix

| Affinity | Push / emit | Pull / draw |
| --- | --- | --- |
| Fire | Damage durability; overflow into health | Neutralize matching active effects |
| Water | Damage health directly | Neutralize matching active effects |
| Earth | Damage durability; overflow into health | Neutralize matching active effects |
| Wind | Reduce stamina | Neutralize matching active effects |
| Life | Restore health | Drain health; transfer actual removal to caster |
| Decay | Damage health directly | Neutralize matching active effects |
| Corrode | Damage durability only; no health overflow | Neutralize matching active effects |
| Fortify | Restore durability | Drain durability; transfer actual removal to caster |
| Light | Restore mana; retain illumination | Drain mana; transfer actual removal to caster |
| Dark | Reduce mana; retain concealment | Neutralize matching active effects |

Push/pull are focused; emit/draw are area expressions. Do not generate this table
through blanket polarity reversal. Keep existing spatial range, occlusion,
intensity, stack scaling, opposition, and numerical magnitude helpers unless
explicitly replaced here. One core matrix must drive focused and field outcomes.
Missing vitals receive no effect. Missing durability does not protect health.
Fire/earth consume durability first, then remaining damage affects health when
present. Water, life drain, and decay bypass durability. Neutralization never
restores old damage. Matching draw credits actual absorbed exposure to the one
actor mana pool, clamped to maximum, never to health/durability. Each field source
has a finite exposure budget so multiple receivers cannot claim the same amount.
Transfers credit only actual removal, clamped to receiver maximum; self-drain is
invalid. No new balance multipliers are part of the initial rewrite.

### Equipment and motivations
Allowed simulation actions: move, cast_affinity, equip_affinity, take, wait.
Remove conventional attack, flat damage, applyAttack, and melee fallbacks.
Telemetry and external requests use effect protocols, not simulation actions.

Inventory keys are affinity/expression pairs. fire:emit:1 and fire:draw:2 are
distinct entries. Only one pair is active; its stacks determine strength. An equip
action consumes the tick's action, replaces the pair when resolved, and cannot
also move/cast/take. Switching does not reset mana. Only the active pair casts,
emits, absorbs or supplies affinity-dependent protection. Passive fields resolve
once after ordered actions using the then-active equipment; equip adds no pulse.
New pairs must be owned before equipping; no free access to other expressions.

Preserve all authored motivations. Union eligible candidates, deduplicate them,
and rank using the existing Actor-owned deterministic tuple. Equipment candidates
use the same observable field/target evaluation as ordinary candidates. Switch
only for a strictly better evaluated outcome; ties retain current equipment.
Do not introduce an adapter scoring policy or separate strategy engine. The
fire-room scenario must demonstrate fire/draw absorption into mana and water/emit
opposition to fire, when those respective alternatives are owned.

### Defeat, claims and grants
Defeat is immediate and terminal when the selected defeat vital reaches zero.
Health defeat can occur with durability remaining; zero durability alone does
not defeat a health-governed actor. Stop decisions, fields, regeneration and
blocking. Keep a nonblocking remnant while claimable holdings remain.

Take requires a living eligible receiver, defeated source, same-cell or
Chebyshev-adjacent range, and a named holding. It consumes one action and atomically
claims that holding. Movement never auto-collects. Every owned affinity/expression
pair yields one claim on defeat: create receiver entry at 1 or add exactly 1 to
its existing stack count. Source stack count never multiplies reward. Each pair
can be claimed once across ALL looters; distinct pairs remain separate rewards.
Newly acquired pairs are not auto-equipped. Do not expose remaining living vital
pools as loot; explicitly authored vital-grant holdings retain their grant modes.

### Pricing and boundaries
Allocator alone prices normalized properties. Reuse the existing actor-spawn
charge for every actor and existing components for vitals, regen, owned pairs,
stacks, motivations and explicit holdings. Remove category-specific spawn charges
and free-floating premiums. Do not charge separately for defeat rewards derived
from owned equipment. Identical mechanical properties cost the same regardless
of category. Keep grouped summaries and budget allocations as presentation or
planning concerns. Equip/take use the existing default-action runtime rate;
remove the conventional attack rate.

Clean break: replace affected contracts/fixtures in place, no schema bumps,
historical readers, converters or parallel engine. Preserve existing envelope
conventions. Do not add an ECS framework, personas, unrelated cleanup, or remote
benchmark execution. Keep adapters/UI -> runtime -> core; core has no IO.

### Completion criteria
All 14 approved behavioral oracles are recorded in Plan.md's acceptance section:
category-independent mechanics/pricing; alignment relations; three durability
routing examples; actual life transfer/defeat; terminal defeat; equip action
exclusivity; finite absorption; once-only conquest; editable presets; deterministic
motivation/equipment decisions; CLI/MCP/UI equivalence; and snapshot/frame replay.
Add negative fixtures for invalid active keys, duplicate pairs, invalid defeat
vitals, unaffordable casts, living-source take, and out-of-range claims. Each
milestone needs a meaningful red-to-green test and restored perturbation.
Finish only with one reachable engine, no conventional attack path or separate
entity stores, updated affected docs, full tests, typecheck and architecture
guards. Note schema/CLI/normalization changes in commits for attribution, but do
not run a remote benchmark matrix. Current declarations and registry are only
milestones 1–2, not proof of completed gameplay migration.
