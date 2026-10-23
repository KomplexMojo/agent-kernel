# Affinity table

<!-- Generated from packages/core-ts/src/state/affinity-table.ts by
     node scripts/affinity/generate-affinity-table-doc.mjs. Do not edit by hand. -->

Every affinity kind's effect on a receiver, as core holds it (#352). Outward is push and emit;
inward is pull and draw. Spill is where damage and a harmful steal go once the primary vital is empty (#354):
the receiver's defeat vital (health for delvers and wardens, durability for hazards, resources
and barriers). A receiver without the primary vital takes the whole hit there (#353).

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

A kind's physical identity beyond the vital it hits (#419), or none. Displace: a push moves what it
hits one cell away from the caster and a pull one cell toward it (two cells at intensity 3 or more),
only into a free cell; a wall, the board's edge or an actor stops it. Soak (#420): a push that lands,
or an emit field the receiver takes something from, soaks it for the hit's intensity in turns (a field
keeps it soaked while it stands there); each move costs one more stamina while soaked. Spread (#421) is
recorded but has no rule yet; raise is recorded, and raising barriers is open to every kind (#442).

| Kind | Trait |
|---|---|
| fire | spread |
| water | soak |
| earth | raise |
| wind | displace |
| growth | none |
| decay | none |
| corrode | none |
| fortify | none |
| light | none |
| dark | none |

## Receiver rules

The same for fields and casts:

- A same-kind `draw` on the receiver absorbs an incoming push or emit into its mana.
- A same-kind slot is immune where the expression interaction table (AffinityEffect.None) says so.
- Any opposite slot multiplies damage and drain by 2.

## Formulas

Every row names one formula per stack-driven quantity. Token prices are the Allocator's.

| Id | Quantity | Formula | Computed in |
|---|---|---|---|
| `expression_base_times_intensity_squared` | effect magnitude | expression base (push/pull 2, emit/draw 1) × intensity² | rules/actor-affinity.ts actorAffinityMagnitude |
| `range_tiles` | field reach and cast range | range tiles (Chebyshev) | rules/actor-cast.ts actorCastRange; rules/actor-fields.ts |
| `cast_base_times_triangular_range` | cast mana (push, pull) | cast base × range × (range + 1) / 2 | rules/actor-cast.ts actorCastManaPrice |
| `upkeep_table_at_range_plus_intensity` | upkeep (emit, draw), mana a turn | upkeep table at range + intensity (the Configurator table is 2 + n) | rules/actor-upkeep.ts chargeActorAffinityUpkeep |
