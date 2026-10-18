import { expect, test } from 'vitest';
import { createActorRegistry } from '../../packages/core-ts/src/state/actor-registry.ts';
import { actorFieldExposureAmount, projectActorFieldsAt, resolveActorFields } from '../../packages/core-ts/src/rules/actor-fields.ts';
import type { ActorRecord, ActorAffinityEntry } from '../../packages/core-ts/src/state/actor-types.ts';

// #283: field intensity falls off with distance and is scaled by cancellation, so the
// raw exposure is fractional. Vitals are whole numbers; every exposure rounds in core.
const KINDS = ['fire', 'water', 'earth', 'wind', 'growth', 'decay', 'corrode', 'fortify', 'light', 'dark'] as const;
function actor(id: string, x: number, affinities: ActorAffinityEntry[] = []): ActorRecord {
  const vital = { current: 30, max: 60, regen: 0 };
  return { id, alignment: 'dungeon', lifecycle: 'alive', position: { x, y: 0 }, defeatVital: 'health',
    vitals: { health: { ...vital }, mana: { ...vital }, stamina: { ...vital }, durability: { ...vital } },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false }, motivations: [], affinities,
    activeAffinityKey: affinities[0] ? `${affinities[0].kind}:${affinities[0].expression}` : null, holdings: [] };
}
function registry(actors: ActorRecord[]) {
  return createActorRegistry({ dimensions: { width: 8, height: 1 }, terrain: Array(8).fill('floor'), actors });
}

test('field exposure amounts are whole numbers for every affinity, stack count and distance', () => {
  for (const kind of KINDS) for (const expression of ['emit', 'draw'] as const) for (const stacks of [1, 2, 3, 5]) {
    for (let x = 1; x < 7; x++) {
      const source = actor('source', 0, [{ kind, expression, stacks }]);
      const receiver = actor('receiver', x, kind === 'fire' ? [] : [{ kind: 'fire', expression: 'emit', stacks: 1 }]);
      receiver.activeAffinityKey = null;
      const cells = projectActorFieldsAt([source, receiver], receiver.position);
      for (const cell of cells) expect(Number.isInteger(actorFieldExposureAmount(receiver, cell, cells))).toBe(true);
    }
  }
});

test('a field pass leaves every vital whole when opposed emits cancel (light/dark and every pair)', () => {
  const pairs = [['fire', 'water'], ['earth', 'wind'], ['growth', 'decay'], ['corrode', 'fortify'], ['light', 'dark']] as const;
  for (const [a, b] of pairs) for (const [winner, loser] of [[a, b], [b, a]]) {
    const actors = [actor('strong', 0, [{ kind: winner, expression: 'emit', stacks: 5 }]),
      actor('weak', 2, [{ kind: loser, expression: 'emit', stacks: 2 }]),
      actor('near', 1), actor('far', 3), actor('farther', 4)];
    const reg = registry(actors);
    for (let turn = 0; turn < 3; turn++) resolveActorFields(reg);
    for (const each of reg.snapshot().actors) for (const [name, vital] of Object.entries(each.vitals)) {
      expect(Number.isInteger(vital!.current), `${winner} vs ${loser}: ${each.id} ${name} = ${vital!.current}`).toBe(true);
    }
  }
});
