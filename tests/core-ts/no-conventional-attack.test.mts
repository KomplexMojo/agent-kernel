import { expect, test } from 'vitest';
import { createCore } from '../../packages/core-ts/src/index.ts';

test('core exposes no conventional attack entry point', () => {
  expect(createCore()).not.toHaveProperty('applyAttack');
});

// ## TODO: Test Permutations
// Action vocabulary rejection is covered by actor-turn.test.mts.
