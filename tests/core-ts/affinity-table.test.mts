import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AFFINITY_FORMULAS, AFFINITY_RECEIVER_RULES, AFFINITY_TABLE, affinityTableRow,
} from '../../packages/core-ts/src/state/affinity-table.ts';
import { getActorAffinityEffect, resolveActorAffinity } from '../../packages/core-ts/src/rules/actor-affinity.ts';
import { OPPOSITE_EXPOSURE_AMPLIFICATION } from '../../packages/core-ts/src/state/affinity-spatial.ts';
import { AFFINITY_KIND_BY_CODE } from '../../packages/core-ts/src/affinity-readers.ts';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import type { ActorRecord, ActorVitalKind, AffinityExpression } from '../../packages/core-ts/src/state/actor-types.ts';
import { AFFINITY_TABLE_DOC_PATH, renderAffinityTableDoc } from '../../scripts/affinity/generate-affinity-table-doc.mjs';

// #352 — one affinity table held as data in core (Darren, #336). It encodes today's
// behaviour exactly; the rules read it, the doc is generated from it.

test('the table has one row per kind, in codebook order, and is frozen', () => {
  expect(AFFINITY_TABLE.map(row => row.kind)).toEqual(Object.values(AFFINITY_KIND_BY_CODE));
  expect(Object.isFrozen(AFFINITY_TABLE)).toBe(true);
  AFFINITY_TABLE.forEach(row => {
    expect(Object.isFrozen(row)).toBe(true);
    expect(affinityTableRow(row.kind)).toBe(row);
    Object.values(row.formulas).forEach(id => expect(Object.hasOwn(AFFINITY_FORMULAS, id)).toBe(true));
  });
});

test('the table holds each kind\'s routing', () => {
  // [kind, primary vital, outward, inward, spill]. #353: harmful kinds hit their own vital
  // first (water now stamina), then every one spills into the target's defeat vital.
  expect(AFFINITY_TABLE.map(row => [row.kind, row.primaryVital, row.outward, row.inward, row.spill])).toEqual([
    ['fire', 'durability', 'damage', 'neutralize', 'defeat'],
    ['water', 'stamina', 'damage', 'neutralize', 'defeat'],
    ['earth', 'durability', 'damage', 'neutralize', 'defeat'],
    ['wind', 'stamina', 'damage', 'neutralize', 'defeat'],
    ['growth', 'health', 'restore', 'drain', null],
    ['decay', 'health', 'damage', 'neutralize', 'defeat'],
    ['corrode', 'durability', 'damage', 'neutralize', 'defeat'],
    ['fortify', 'durability', 'restore', 'drain', null],
    ['light', 'mana', 'restore', 'drain', null],
    ['dark', 'mana', 'damage', 'neutralize', 'defeat'],
  ]);
  expect(AFFINITY_RECEIVER_RULES.oppositeAmplification).toBe(2);
  expect(OPPOSITE_EXPOSURE_AMPLIFICATION).toBe(AFFINITY_RECEIVER_RULES.oppositeAmplification);
});

const EXPRESSIONS: AffinityExpression[] = ['push', 'emit', 'pull', 'draw'];

test('every rule effect is read from the table', () => {
  for (const row of AFFINITY_TABLE) {
    for (const expression of EXPRESSIONS) {
      const effect = getActorAffinityEffect(row.kind, expression);
      if (expression === 'push' || expression === 'emit') {
        expect(effect).toEqual(row.spill && row.outward === 'damage'
          ? { operation: row.outward, vital: row.primaryVital, overflow: row.spill }
          : { operation: row.outward, vital: row.primaryVital });
      } else {
        expect(effect).toEqual(row.inward === 'drain' ? { operation: 'drain', vital: row.primaryVital } : { operation: 'neutralize' });
      }
    }
  }
});

// Every kind × expression × target type, played through resolveActorAffinity, lands where
// the row says. Vitals are set so nothing is defeated, every pool has room either way, and a
// 5-point hit empties every primary vital on a delver or warden, so each spill is played.
type Pools = Partial<Record<ActorVitalKind, number>>;
const TARGETS: Record<string, { defeatVital: ActorVitalKind; alignment: string; pools: Pools }> = {
  delver: { defeatVital: 'health', alignment: 'external', pools: { health: 10, durability: 3, mana: 3, stamina: 3 } },
  warden: { defeatVital: 'health', alignment: 'dungeon', pools: { health: 10, durability: 3, mana: 3, stamina: 3 } },
  hazard: { defeatVital: 'durability', alignment: 'dungeon', pools: { durability: 9, mana: 6 } },
  resource: { defeatVital: 'durability', alignment: 'dungeon', pools: { durability: 9 } },
};
const MAX = 20;
const AMOUNT = 5;

function record(id: string, defeatVital: ActorVitalKind, alignment: string, pools: Pools): ActorRecord {
  const vitals = Object.fromEntries(Object.entries(pools).map(([vital, current]) => [vital, { current, max: MAX, regen: 0 }]));
  return { id, alignment, lifecycle: 'alive', position: { x: 0, y: 0 }, defeatVital, vitals,
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true, blocksMovement: false, blocksSight: false },
    motivations: [], affinities: [], activeAffinityKey: null, holdings: [] } as unknown as ActorRecord;
}

function expected(row: typeof AFFINITY_TABLE[number], expression: AffinityExpression, pools: Pools, defeatVital: ActorVitalKind) {
  const target = { ...pools };
  const source: Pools = { ...TARGETS.delver.pools };
  const take = (vital: ActorVitalKind, amount: number) => {
    if (target[vital] === undefined) return 0;
    const removed = Math.min(amount, target[vital]!); target[vital]! -= removed; return removed;
  };
  if (expression === 'push' || expression === 'emit') {
    if (row.outward === 'restore') {
      if (target[row.primaryVital] !== undefined) target[row.primaryVital] = Math.min(MAX, target[row.primaryVital]! + AMOUNT);
    } else {
      const removed = take(row.primaryVital, AMOUNT);
      if (row.spill === 'defeat' && defeatVital !== row.primaryVital && AMOUNT > removed) take(defeatVital, AMOUNT - removed);
    }
  } else if (row.inward === 'drain') {
    const removed = take(row.primaryVital, AMOUNT);
    source[row.primaryVital] = Math.min(MAX, source[row.primaryVital]! + removed);
  }
  return { target, source };
}

for (const row of AFFINITY_TABLE) {
  for (const expression of EXPRESSIONS) {
    for (const [type, spec] of Object.entries(TARGETS)) {
      test(`${row.kind} ${expression} on a ${type} follows its row`, () => {
        const state = createActorRegistry({ dimensions: { width: 1, height: 1 }, terrain: ['floor'], actors: [
          record('source', 'health', 'external', TARGETS.delver.pools),
          record('target', spec.defeatVital, spec.alignment, spec.pools),
        ] });
        resolveActorAffinity(state, 'source', 'target', row.kind, expression, AMOUNT);
        const read = (id: string) => Object.fromEntries(Object.entries(state.getActor(id)!.vitals).map(([vital, pool]) => [vital, pool!.current]));
        const want = expected(row, expression, spec.pools, spec.defeatVital);
        expect(read('target')).toEqual(want.target);
        expect(read('source')).toEqual(want.source);
      });
    }
  }
}

test('docs/affinity-table.md is generated from the table', () => {
  expect(readFileSync(AFFINITY_TABLE_DOC_PATH, 'utf8'),
    'docs/affinity-table.md drifted: run node scripts/affinity/generate-affinity-table-doc.mjs').toBe(renderAffinityTableDoc());
});

// ## TODO: Test Permutations
// - the receiver rules over every kind × receiver slot (absorb, immunity, opposite) read the table
// - a defeat-vital target at its last point (lifecycle changes) for every damaging row
