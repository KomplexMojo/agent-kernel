import { expect, test } from 'vitest';
import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';
import { AFFINITY_TABLE } from '../../../packages/core-ts/src/state/affinity-table.ts';
const c = createConfiguratorPersona({ clock: () => '2026-09-10T00:00:00.000Z' });

// #232: core prices a cast as base × s(s+1)/2; the base is the authored tier-1 price.
test('assembles a base price for every pair, including equipment acquired later', () => {
  const costs = c.resolveActorTurnCosts({ movementStamina: { delver: 2, resource: 0 } });
  expect(costs.castMana).toBeUndefined();
  expect(Object.keys(costs.castManaBase)).toHaveLength(40);
  expect(costs.castManaBase['fire:push']).toBe(2);
  for (const base of Object.values(costs.castManaBase)) {
    expect(Number.isSafeInteger(base) && base >= 0).toBe(true);
  }
  expect(costs.movementStamina).toEqual({ delver: 2, resource: 0 });
});
test('preserves authored costs and detaches results from rules and movement inputs', () => {
  const rules = structuredClone(c.resolveAffinityRules());
  const tiers = rules.affinities.find(a => a.kind === 'fire').expressions.find(e => e.verb === 'push').stackTiers;
  tiers.forEach((tier, index) => { tier.manaCost = 11 * (index + 1); });
  const movementStamina = { '__actor__': 7 };
  const before = structuredClone(rules);
  const costs = c.resolveActorTurnCosts({ rules, movementStamina });
  expect(costs.castManaBase['fire:push']).toBe(11);
  costs.castManaBase['fire:push'] = 99;
  costs.movementStamina.__actor__ = 99;
  expect(rules).toEqual(before);
  expect(movementStamina.__actor__).toBe(7);
});
test('rejects explicitly malformed rules rather than substituting default prices', () => {
  for (const rules of [null, {}, [], { affinities: [] }]) {
    expect(() => c.resolveActorTurnCosts({ rules, movementStamina: {} })).toThrow();
  }
});
test('requires explicit finite movement costs and supports arbitrary stable IDs', () => {
  for (const movementStamina of [undefined, null, [], new Map(), new Date(0), { a: -1 }, { a: NaN }, { a: 0.5 }, { '': 1 }]) {
    expect(() => c.resolveActorTurnCosts({ movementStamina })).toThrow();
  }
  const input = JSON.parse('{"__proto__":3,"constructor":4}');
  expect(c.resolveActorTurnCosts({ movementStamina: input }).movementStamina).toEqual(input);
});
// Every push and pull costs mana (maintainer, 2026-10-11); growth:pull was the one free cast.
test('no default push or pull is free', () => {
  const { castManaBase } = c.resolveActorTurnCosts({ movementStamina: {} });
  for (const [key, base] of Object.entries(castManaBase)) {
    if (/:(push|pull)$/.test(key)) expect(base, key).toBeGreaterThan(0);
  }
});
test('the cast price escalates past five stacks', () => {
  expect([1, 2, 5, 6, 8].map(stacks => c.resolveAffinityManaCost({ kind: 'fire', expression: 'push', stacks })))
    .toEqual([2, 6, 30, 42, 72]);
  expect(c.resolveAffinityManaCost({ kind: 'fire', expression: 'emit', stacks: 8 })).toBe(10);
});
// ## TODO: Test Permutations
// - Verify startup passes this exact configuration through runtime replay artifacts.
// #477: one price for every kind; no affinity is cheaper to play than another. #833: the one
// exception is a property of the kind's row, not a name: a harmful kind whose primary vital is
// health goes past armour, so its push and pull cost 3 a tier where the others cost 2.
const pastArmour = new Set(AFFINITY_TABLE.filter(row => row.outward === 'damage' && row.primaryVital === 'health').map(row => row.kind));
test('every kind has identical cast and emit prices per expression, but for a cast that goes past armour', () => {
  const { castManaBase } = c.resolveActorTurnCosts({ movementStamina: {} });
  const kinds = [...new Set(Object.keys(castManaBase).map(key => key.split(':')[0]))];
  expect(kinds).toHaveLength(10);
  expect([...pastArmour]).toEqual(['decay']);
  const plain = kinds.filter(kind => !pastArmour.has(kind));
  for (const expression of ['push', 'pull', 'emit', 'draw']) {
    const prices = new Set(plain.map(kind => castManaBase[`${kind}:${expression}`]));
    expect([...prices], expression).toHaveLength(1);
  }
  const tiers = kind => [1, 2, 3, 4, 5].map(stacks => ['push', 'pull', 'emit', 'draw']
    .map(expression => c.resolveAffinityManaCost({ kind, expression, stacks })));
  for (const kind of plain) expect(tiers(kind), kind).toEqual(tiers(plain[0]));
  for (const kind of pastArmour) {
    for (const cast of ['push', 'pull']) {
      expect(castManaBase[`${kind}:${cast}`], `${kind}:${cast}`).toBe(3);
      expect(castManaBase[`${plain[0]}:${cast}`]).toBe(2);
      // Range 1 at intensity 2: 3 × 2² = 12 where the others pay 8.
      expect(c.resolveAffinityManaCost({ kind, expression: cast, stacks: 1, intensity: 2 })).toBe(12);
    }
    for (const lasting of ['emit', 'draw']) {
      expect(castManaBase[`${kind}:${lasting}`]).toBe(castManaBase[`${plain[0]}:${lasting}`]);
    }
  }
});
// ## TODO: Test Permutations
// - authored rules that reprice the past-armour kind's casts are preserved as authored
