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
 * - `inward` (pull, draw): `drain`, steal the primary vital into the source, for every kind
 *   (#354, Darren: "steal like restorers"). The source gains only what the primary vital
 *   gave up; it is capped at the source's max, and spill is not credited. A restoring kind (no
 *   spill) takes at most what the source lacks of the vital, a top-up rather than a weapon (#537).
 * - `spill`: where damage goes once the primary vital is empty, or null: outward damage
 *   and a harmful kind's steal alike (#354). `defeat`
 *   is the target's own defeat vital (health for delvers and wardens, durability for
 *   hazards, resources and barriers); a target without the primary vital takes it all
 *   there (#353).
 * - `formulas`: the named formula for each stack-driven quantity (AFFINITY_FORMULAS).
 * - `illuminates`, `reveals`, `conceals` (#416, Darren 2026-10-18): what the kind's emitted
 *   field does to what others see. `illuminates` lights a cell for sight (you see what is
 *   there, even under dark); `reveals` shows the properties of an actor on the cell, up to
 *   the field's net intensity; `conceals` darkens the cell and hides what stands in it. Light
 *   has all but conceals, fire only illuminates, dark only conceals. Sight and reveal read
 *   these columns, so a kind opts in by its row, never by code.
 * - `trait` (#419, Darren 2026-10-18): the kind's physical identity beyond the vital it hits,
 *   or null. Displacement (a landed push moves its target away from the caster, a pull toward
 *   it, one cell per intensity) is not a trait: every kind does it (#482, rules/actor-cast.ts). `soak` (water, #420): a push that lands, or an
 *   emit field the receiver takes something from, soaks it for `intensity` turns, each move
 *   costing SOAK_MOVE_STAMINA more (rules/actor-cast.ts, rules/actor-fields.ts). `spread`
 *   (fire, #421): where a push lands its field creeps on, a cell and one intensity a turn, by
 *   the run's seed (rules/actor-spread.ts). `raise` (earth; raising barriers itself is open to
 *   every kind, #442) is what the `raiseScale` column carries out. `breach` (corrode, #535, Darren
 *   2026-10-28): its harm (damage and steal, fields and casts alike) is multiplied by
 *   AFFINITY_RECEIVER_RULES.breachAmplification against a receiver whose defeat vital is
 *   durability: barriers, hazards and resources (rules/actor-receiver.ts). Code reads the column,
 *   never a kind name.
 * - `displaceSteps` (#536, Darren 2026-10-28): a landed push or pull of this kind moves its
 *   target this many cells per point of intensity (rules/actor-cast.ts displaceTarget). 1 for
 *   every kind, 2 for wind: every kind knocks back (#482), wind twice as far.
 * - `raiseScale` (#534, Darren 2026-10-28): a barrier this kind raises gets its investment and
 *   durability times this (rules/actor-cast.ts raisedBarrierStats). 1 for every kind, 2 for earth.
 */
export type AffinityOutwardOperation = 'damage' | 'restore';
export type AffinityInwardOperation = 'drain';
export type AffinityTrait = 'soak' | 'spread' | 'raise' | 'breach';
export type AffinityFormulaId = keyof typeof AFFINITY_FORMULAS;

export interface AffinityTableRow {
  readonly kind: AffinityKind;
  readonly primaryVital: ActorVitalKind;
  readonly outward: AffinityOutwardOperation;
  readonly inward: AffinityInwardOperation;
  readonly spill: 'defeat' | null;
  readonly illuminates: boolean;
  readonly reveals: boolean;
  readonly conceals: boolean;
  readonly trait: AffinityTrait | null;
  readonly raiseScale: number;
  readonly displaceSteps: number;
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

type RowColumns = { illuminates?: boolean; reveals?: boolean; conceals?: boolean; trait?: AffinityTrait | null; raiseScale?: number; displaceSteps?: number };
const row = (kind: AffinityKind, primaryVital: ActorVitalKind, outward: AffinityOutwardOperation,
  inward: AffinityInwardOperation, spill: 'defeat' | null,
  { illuminates = false, reveals = false, conceals = false, trait = null, raiseScale = 1, displaceSteps = 1 }: RowColumns = {}): AffinityTableRow =>
  Object.freeze({ kind, primaryVital, outward, inward, spill, illuminates, reveals, conceals, trait, raiseScale,
    displaceSteps, formulas: FORMULAS });

/** In affinity-codebook order. */
export const AFFINITY_TABLE: readonly AffinityTableRow[] = Object.freeze([
  row('fire', 'durability', 'damage', 'drain', 'defeat', { illuminates: true, trait: 'spread' }),
  row('water', 'stamina', 'damage', 'drain', 'defeat', { trait: 'soak' }),
  row('earth', 'durability', 'damage', 'drain', 'defeat', { trait: 'raise', raiseScale: 2 }),
  row('wind', 'stamina', 'damage', 'drain', 'defeat', { displaceSteps: 2 }),
  row('growth', 'health', 'restore', 'drain', null),
  row('decay', 'health', 'damage', 'drain', 'defeat'),
  row('corrode', 'durability', 'damage', 'drain', 'defeat', { trait: 'breach' }),
  row('fortify', 'durability', 'restore', 'drain', null),
  row('light', 'mana', 'restore', 'drain', null, { illuminates: true, reveals: true }),
  row('dark', 'mana', 'damage', 'drain', 'defeat', { conceals: true }),
]);

/**
 * The receiver rules every effect meets, from a field or a cast alike (#348):
 * - a same-kind `draw` on the receiver absorbs an incoming outward effect into its mana;
 * - a same-kind slot the expression interaction table marks immune takes nothing;
 * - any opposite slot multiplies `amplifies` operations by `oppositeAmplification`;
 * - a `breach` kind multiplies them by `breachAmplification` against a receiver whose defeat
 *   vital is `breachesDefeatVital` (#535).
 */
export const AFFINITY_RECEIVER_RULES = Object.freeze({
  absorbedBy: 'draw' as AffinityExpression,
  absorbs: Object.freeze(['push', 'emit'] as AffinityExpression[]),
  sameKindImmunity: 'expression interaction table (AffinityEffect.None)',
  oppositeAmplification: 2,
  amplifies: Object.freeze(['damage', 'drain'] as const),
  // #535: a `breach` kind's harm against a structure (a receiver whose defeat vital is this).
  breachAmplification: 2,
  breachesDefeatVital: 'durability' as ActorVitalKind,
});

const BY_KIND = new Map(AFFINITY_TABLE.map(entry => [entry.kind, entry]));

/** The kinds whose row sets a sight column (#416), in table order. */
export function affinityKindsWith(column: 'illuminates' | 'reveals' | 'conceals'): AffinityKind[] {
  return AFFINITY_TABLE.filter(entry => entry[column]).map(entry => entry.kind);
}

/** The table row for `kind`; undefined for an unknown kind. */
export function affinityTableRow(kind: AffinityKind): AffinityTableRow | undefined {
  return BY_KIND.get(kind);
}

export function isOutwardAffinityExpression(expression: AffinityExpression): boolean {
  return expression === 'push' || expression === 'emit';
}
