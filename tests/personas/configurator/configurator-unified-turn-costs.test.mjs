import { expect, test } from 'vitest';
import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';
const c = createConfiguratorPersona({ clock: () => '2026-09-10T00:00:00.000Z' });

test('assembles every pair and tier, including equipment acquired later', () => {
  const costs = c.resolveActorTurnCosts({ movementStamina: { delver: 2, resource: 0 } });
  expect(Object.keys(costs.castMana)).toHaveLength(40);
  expect(costs.castMana['fire:push']).toEqual([3, 6, 9, 12, 15]);
  for (const prices of Object.values(costs.castMana)) {
    expect(prices).toHaveLength(5);
    expect(prices.every(price => Number.isSafeInteger(price) && price >= 0)).toBe(true);
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
  expect(costs.castMana['fire:push']).toEqual([11, 22, 33, 44, 55]);
  costs.castMana['fire:push'][0] = 99;
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
// ## TODO: Test Permutations
// - Verify startup passes this exact configuration through runtime replay artifacts.
