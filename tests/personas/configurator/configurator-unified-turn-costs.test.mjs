import { expect, test } from 'vitest';
import { createConfiguratorPersona } from '../../../packages/runtime/src/personas/configurator/controller.js';
const c = createConfiguratorPersona({ clock: () => '2026-09-10T00:00:00.000Z' });

// #232: core prices a cast as base × s(s+1)/2; the base is the authored tier-1 price.
test('assembles a base price for every pair, including equipment acquired later', () => {
  const costs = c.resolveActorTurnCosts({ movementStamina: { delver: 2, resource: 0 } });
  expect(costs.castMana).toBeUndefined();
  expect(Object.keys(costs.castManaBase)).toHaveLength(40);
  expect(costs.castManaBase['fire:push']).toBe(3);
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
    .toEqual([3, 9, 45, 63, 108]);
  expect(c.resolveAffinityManaCost({ kind: 'fire', expression: 'emit', stacks: 8 })).toBe(10);
});
// ## TODO: Test Permutations
// - Verify startup passes this exact configuration through runtime replay artifacts.
