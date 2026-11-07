// #758: what an actor's own casts did last turn, as the caster saw it land (#497: an
// interaction shows its outcome). A cast that took nothing from the struck actor's health or
// durability did nothing toward defeating it; the Actor stops choosing that slot at that target.
import { expect, test } from 'vitest';
import { readActorDealtCasts } from '../../packages/core-ts/src/rules/actor-observation.ts';

const change = (actorId: string, vital: string, delta: number) => ({ actorId, vital, delta });

const TURN = {
  tick: 9,
  casts: [
    // A light pull that drained the warden's mana only (the caster paid mana too).
    { sourceId: 'hero', kind: 'light', expression: 'pull', path: [], targetId: 'guard',
      changes: [change('hero', 'mana', -6), change('guard', 'mana', -4)] },
    // A decay pull the warden resisted: nothing changed on it.
    { sourceId: 'hero', kind: 'decay', expression: 'pull', path: [], targetId: 'guard', changes: [change('hero', 'mana', -24)] },
    // An earth push that cracked armour: progress toward a defeat.
    { sourceId: 'hero', kind: 'earth', expression: 'push', path: [], targetId: 'guard',
      changes: [change('hero', 'mana', -24), change('guard', 'durability', -5)] },
    // Someone else's cast is not the hero's to learn from here.
    { sourceId: 'guard', kind: 'water', expression: 'push', path: [], targetId: 'hero', changes: [change('hero', 'health', -3)] },
    // A cast that struck nobody (a wall) has no target to learn about.
    { sourceId: 'hero', kind: 'fire', expression: 'push', path: [], changes: [change('hero', 'mana', -8)] },
  ],
};

test("an actor learns, per cast it made, whether the actor it struck lost health or durability", () => {
  expect(readActorDealtCasts(TURN, 'hero')).toEqual([
    { tick: 9, targetId: 'guard', kind: 'light', expression: 'pull', harmed: false },
    { tick: 9, targetId: 'guard', kind: 'decay', expression: 'pull', harmed: false },
    { tick: 9, targetId: 'guard', kind: 'earth', expression: 'push', harmed: true },
  ]);
});

test("no turn, or no casts of its own, is nothing learned", () => {
  expect(readActorDealtCasts(null, 'hero')).toEqual([]);
  expect(readActorDealtCasts(TURN, 'ally')).toEqual([]);
  expect(readActorDealtCasts(TURN, 'guard')).toEqual([{ tick: 9, targetId: 'hero', kind: 'water', expression: 'push', harmed: true }]);
});

// ## TODO: Test Permutations
// - a cast whose only change on the target is a heal (positive delta) is not harm
// - a cast at oneself (targetId === sourceId) is not learned as a hit on a target
// - a cast with a stamina-only change (a water pin) is not harm toward a defeat
