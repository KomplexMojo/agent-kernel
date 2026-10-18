import type { AffinityKind, AffinityExpression, ActorVitalKind } from './actor-types.ts';

/**
 * #352 — the one affinity table (Darren, #336). Every kind's effect on a receiver is a row
 * here, held as data; the rules read it rather than carrying their own copies. It encodes
 * today's behaviour exactly: routing changes (#353) and harmful steal (#354) change rows,
 * not code paths. `docs/affinity-table.md` is generated from it
 * (`node scripts/affinity/generate-affinity-table-doc.mjs`) and a drift test holds the two
 * together.
 *
 * - `primaryVital`: the vital the kind acts on.
 * - `outward` (push, emit): `damage` the primary vital, or `restore` it up to max.
 * - `inward` (pull, draw): `drain` (steal the primary vital into the source) or
 *   `neutralize` (no vital change; a cast suppresses the target's same-kind push or emit).
 * - `spill`: where outward damage goes once the primary vital is empty, or null. `defeat`
 *   is the target's own defeat vital (health for delvers and wardens, durability for
 *   hazards, resources and barriers); a target without the primary vital takes it all
 *   there (#353).
 * - `formulas`: the named formula for each stack-driven quantity (AFFINITY_FORMULAS).
 */
export type AffinityOutwardOperation = 'damage' | 'restore';
export type AffinityInwardOperation = 'drain' | 'neutralize';
export type AffinityFormulaId = keyof typeof AFFINITY_FORMULAS;

export interface AffinityTableRow {
  readonly kind: AffinityKind;
  readonly primaryVital: ActorVitalKind;
  readonly outward: AffinityOutwardOperation;
  readonly inward: AffinityInwardOperation;
  readonly spill: 'defeat' | null;
  readonly formulas: Readonly<Record<'magnitude' | 'reach' | 'castMana' | 'upkeep', AffinityFormulaId>>;
}

/** One formula per stack-driven quantity; the function named in `source` computes it. */
export const AFFINITY_FORMULAS = Object.freeze({
  expression_base_times_intensity_squared: Object.freeze({
    quantity: 'effect magnitude',
    formula: 'expression base (push/pull 2, emit/draw 1) × intensity²',
    source: 'rules/actor-affinity.ts actorAffinityMagnitude',
  }),
  range_tiles: Object.freeze({
    quantity: 'field reach and cast range',
    formula: 'range tiles (Chebyshev)',
    source: 'rules/actor-cast.ts actorCastRange; rules/actor-fields.ts',
  }),
  cast_base_times_triangular_range: Object.freeze({
    quantity: 'cast mana (push, pull)',
    formula: 'cast base × range × (range + 1) / 2',
    source: 'rules/actor-cast.ts actorCastManaPrice',
  }),
  upkeep_table_at_range_plus_intensity: Object.freeze({
    quantity: 'upkeep (emit, draw), mana a turn',
    formula: 'upkeep table at range + intensity (the Configurator table is 2 + n)',
    source: 'rules/actor-upkeep.ts chargeActorAffinityUpkeep',
  }),
});

const FORMULAS = Object.freeze({
  magnitude: 'expression_base_times_intensity_squared',
  reach: 'range_tiles',
  castMana: 'cast_base_times_triangular_range',
  upkeep: 'upkeep_table_at_range_plus_intensity',
} as const);

const row = (kind: AffinityKind, primaryVital: ActorVitalKind, outward: AffinityOutwardOperation,
  inward: AffinityInwardOperation, spill: 'defeat' | null): AffinityTableRow =>
  Object.freeze({ kind, primaryVital, outward, inward, spill, formulas: FORMULAS });

/** In affinity-codebook order. */
export const AFFINITY_TABLE: readonly AffinityTableRow[] = Object.freeze([
  row('fire', 'durability', 'damage', 'neutralize', 'defeat'),
  row('water', 'stamina', 'damage', 'neutralize', 'defeat'),
  row('earth', 'durability', 'damage', 'neutralize', 'defeat'),
  row('wind', 'stamina', 'damage', 'neutralize', 'defeat'),
  row('growth', 'health', 'restore', 'drain', null),
  row('decay', 'health', 'damage', 'neutralize', 'defeat'),
  row('corrode', 'durability', 'damage', 'neutralize', 'defeat'),
  row('fortify', 'durability', 'restore', 'drain', null),
  row('light', 'mana', 'restore', 'drain', null),
  row('dark', 'mana', 'damage', 'neutralize', 'defeat'),
]);

/**
 * The receiver rules every effect meets, from a field or a cast alike (#348):
 * - a same-kind `draw` on the receiver absorbs an incoming outward effect into its mana;
 * - a same-kind slot the expression interaction table marks immune takes nothing;
 * - any opposite slot multiplies `amplifies` operations by `oppositeAmplification`.
 */
export const AFFINITY_RECEIVER_RULES = Object.freeze({
  absorbedBy: 'draw' as AffinityExpression,
  absorbs: Object.freeze(['push', 'emit'] as AffinityExpression[]),
  sameKindImmunity: 'expression interaction table (AffinityEffect.None)',
  oppositeAmplification: 2,
  amplifies: Object.freeze(['damage', 'drain'] as const),
});

const BY_KIND = new Map(AFFINITY_TABLE.map(entry => [entry.kind, entry]));

/** The table row for `kind`; undefined for an unknown kind. */
export function affinityTableRow(kind: AffinityKind): AffinityTableRow | undefined {
  return BY_KIND.get(kind);
}

export function isOutwardAffinityExpression(expression: AffinityExpression): boolean {
  return expression === 'push' || expression === 'emit';
}
