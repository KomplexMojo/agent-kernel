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
