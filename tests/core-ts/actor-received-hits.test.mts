// #718: what struck an actor last turn, scoped to what that actor felt and saw.
import { expect, test } from 'vitest';
import { readActorReceivedHits } from '../../packages/core-ts/src/rules/actor-observation.ts';

const took = (actorId: string, delta = -3) => [{ actorId, vital: 'health', delta }];

const TURN = {
  tick: 7,
  casts: [
    // A water push from a visible warden that struck the hero.
    { sourceId: 'guard', kind: 'water', expression: 'push', path: [], targetId: 'hero', changes: [...took('guard', -2), ...took('hero')] },
    // A fire push from a caster the hero cannot see.
    { sourceId: 'sniper', kind: 'fire', expression: 'push', path: [], targetId: 'hero', changes: took('hero') },
    // A cast that struck someone else: not the hero's to know.
    { sourceId: 'guard', kind: 'decay', expression: 'push', path: [], targetId: 'ally', changes: took('ally') },
    // A heal that landed on the hero is not a hit.
    { sourceId: 'ally', kind: 'growth', expression: 'push', path: [], targetId: 'hero', changes: took('hero', 4) },
    // The hero's own cast is not something that struck it.
    { sourceId: 'hero', kind: 'fire', expression: 'push', path: [], targetId: 'guard', changes: [...took('hero', -4), ...took('guard')] },
  ],
  fieldContacts: [
    { sourceId: 'guard', targetId: 'hero', kind: 'water', expression: 'emit', changes: took('hero', -1) },
    { sourceId: 'guard', targetId: 'hero', kind: 'water', expression: 'emit', changes: took('hero', -1) },
    { sourceId: 'guard', targetId: 'ally', kind: 'water', expression: 'emit', changes: took('ally', -1) },
  ],
};

test('an actor learns the kind and form of each hit on it, and names only a source it can see', () => {
  const scoped = { actors: [{ id: 'hero' }, { id: 'guard' }, { id: 'ally' }] };
  expect(readActorReceivedHits(TURN, 'hero', scoped)).toEqual([
    { tick: 7, event: 'cast', kind: 'water', expression: 'push', sourceId: 'guard' },
    { tick: 7, event: 'cast', kind: 'fire', expression: 'push' },
    { tick: 7, event: 'field', kind: 'water', expression: 'emit', sourceId: 'guard' },
  ]);
});

test('another actor\'s hits, a heal, and the actor\'s own casts are not hits on it', () => {
  expect(readActorReceivedHits(TURN, 'ally', { actors: [] })).toEqual([
    { tick: 7, event: 'cast', kind: 'decay', expression: 'push' },
    { tick: 7, event: 'field', kind: 'water', expression: 'emit' },
  ]);
  expect(readActorReceivedHits(TURN, 'nobody', { actors: [] })).toEqual([]);
  expect(readActorReceivedHits(null, 'hero', { actors: [] })).toEqual([]);
});
