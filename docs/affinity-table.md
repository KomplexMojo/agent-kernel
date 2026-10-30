# Affinity table

<!-- Generated from packages/core-ts/src/state/affinity-table.ts by
     node scripts/affinity/generate-affinity-table-doc.mjs. Do not edit by hand. -->

Every affinity kind's effect on a receiver, as core holds it (#352). Outward is push and emit;
inward is pull and draw. Spill is where damage and a harmful steal go once the primary vital is empty (#354):
the receiver's defeat vital (health for delvers and wardens, durability for hazards, resources
and barriers). A receiver without the primary vital takes the whole hit there (#353). A kind with no spill
(a restoring kind) takes at most what the source lacks of the vital: a top-up, not a weapon (#537).

| Kind | Primary vital | Outward (emit / push) | Inward (draw / pull) | Spill |
|---|---|---|---|---|
| fire | durability | damage | steal into the source | defeat vital |
| water | stamina | damage | steal into the source | defeat vital |
| earth | durability | damage | steal into the source | defeat vital |
| wind | stamina | damage | steal into the source | defeat vital |
| growth | health | restore | steal into the source | none |
| decay | health | damage | steal into the source | defeat vital |
| corrode | durability | damage | steal into the source | defeat vital |
| fortify | durability | restore | steal into the source | none |
| light | mana | restore | steal into the source | none |
| dark | mana | damage | steal into the source | defeat vital |

## Sight

What a kind's emitted field does to what others see (#416). Illuminates: lights the cell, so what is
there is seen even under dark. Reveals: shows the properties of an actor on the cell, any value above
the field's net intensity reading as that intensity with a `+`. Conceals: darkens the cell and hides
what stands in it; it cancels illumination and revealing by intensity.

| Kind | Illuminates | Reveals | Conceals |
|---|---|---|---|
| fire | yes | no | no |
| water | no | no | no |
| earth | no | no | no |
| wind | no | no | no |
| growth | no | no | no |
| decay | no | no | no |
| corrode | no | no | no |
| fortify | no | no | no |
| light | yes | yes | no |
| dark | no | no | yes |

## Traits

A kind's physical identity beyond the vital it hits (#419), or none. Displacement is not a trait
(#482): every kind's landed push moves what it hits away from the caster and every pull toward it, one
cell per point of intensity times its kind's displace steps (wind 2, the rest 1, #536), only into free
cells; a wall, the board's edge or an actor stops it, with no extra harm. A push never carries its
target beyond the caster's own range (Darren, 2026-10-30), so the same push can hit it again. Soak (#420): a push that lands,
or an emit field the receiver takes something from, soaks it for the hit's intensity in turns (a field
keeps it soaked while it stands there); each move costs one more stamina while soaked. Spread (#421):
where a push lands, its field creeps each turn to a seeded random neighbour that is not a wall, one
intensity weaker, until 0; an opposite field at least as strong there puts it out, and it harms whoever
it reaches for no further mana. Raising barriers is open to every kind (#442, #460); a barrier gets
10 × intensity² mana and durability times its kind's raise scale, so raise (earth) builds sturdier ones (#534).
Breach (#535): the kind's damage and steal, from fields and casts alike, are multiplied against structures
(receivers whose defeat vital is durability: barriers, hazards, resources), as the receiver rules below say.

| Kind | Trait | Raise scale | Displace steps |
|---|---|---|---|
| fire | spread | ×1 | ×1 |
| water | soak | ×1 | ×1 |
| earth | raise | ×2 | ×1 |
| wind | none | ×1 | ×2 |
| growth | none | ×1 | ×1 |
| decay | none | ×1 | ×1 |
| corrode | breach | ×1 | ×1 |
| fortify | none | ×1 | ×1 |
| light | none | ×1 | ×1 |
| dark | none | ×1 | ×1 |

## Receiver rules

The same for fields and casts:

- A same-kind `draw` on the receiver absorbs an incoming push or emit into its mana.
- A same-kind slot is immune where the expression interaction table (AffinityEffect.None) says so.
- Any opposite slot multiplies damage and drain by 2.
- A breach kind multiplies damage and drain by 2 against a receiver whose defeat vital is durability.

## Formulas

Every row names one formula per stack-driven quantity. Token prices are the Allocator's.

| Id | Quantity | Formula | Computed in |
|---|---|---|---|
| `expression_base_times_intensity_squared` | effect magnitude | expression base (push/pull 2, emit/draw 1) × intensity² | rules/actor-affinity.ts actorAffinityMagnitude |
| `range_tiles` | field reach and cast range | range tiles (Chebyshev) | rules/actor-cast.ts actorCastRange; rules/actor-fields.ts |
| `cast_base_times_triangular_range` | cast mana (push, pull) | cast base × intensity² × range × (range + 1) / 2 | rules/actor-cast.ts actorCastManaPrice |
| `one_plus_two_per_extra_stack` | raised barrier line width (#566) | 1 + 2 × (stacks − 1) barriers, centred on the aimed tile | rules/actor-cast.ts raisedBarrierWidth |
| `upkeep_table_at_range_plus_intensity` | upkeep (emit, draw), mana a turn | upkeep table at range + intensity² (the Configurator table is 2 + n) | rules/actor-upkeep.ts chargeActorAffinityUpkeep |
