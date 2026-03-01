import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveArtifactAffinityEffects } from "../../packages/ui-web/src/views/simulation-view.js";

test("resolveArtifactAffinityEffects remaps affinity summary actor ids to runtime labels", () => {
  const initialState = {
    actors: [
      { id: "defender_alpha" },
      { id: "defender_beta" },
    ],
  };
  const affinityEffects = {
    actors: [
      {
        actorId: "defender_alpha",
        affinityStacks: { "fire:push": 2 },
        abilities: [{ id: "burst", kind: "attack", affinityKind: "fire", expression: "push", potency: 2, manaCost: 1 }],
      },
      {
        actorId: "defender_beta",
        affinityStacks: { "wind:emit": 1 },
      },
    ],
    traps: [{ position: { x: 2, y: 3 } }],
  };

  const resolved = resolveArtifactAffinityEffects({
    initialState,
    affinityEffects,
    primaryActorId: "defender_alpha",
  });

  assert.ok(resolved);
  assert.equal(Array.isArray(resolved.actors), true);
  assert.equal(Array.isArray(resolved.traps), true);
  assert.equal(resolved.traps.length, 1);

  const byId = new Map(resolved.actors.map((entry) => [entry.actorId, entry]));
  assert.ok(byId.has("defender_alpha"));
  assert.ok(byId.has("actor_2"));
  assert.equal(byId.get("defender_alpha").affinityStacks["fire:push"], 2);
  assert.equal(byId.get("actor_2").affinityStacks["wind:emit"], 1);
});

test("resolveArtifactAffinityEffects can preserve runtime actor ids", () => {
  const initialState = {
    actors: [
      { id: "A-2RB89Z-1" },
      { id: "D-5JH2QW-1" },
    ],
  };
  const affinityEffects = {
    actors: [
      { actorId: "A-2RB89Z-1", affinityStacks: { "light:emit": 1 } },
      { actorId: "D-5JH2QW-1", affinityStacks: { "dark:emit": 2 } },
    ],
    traps: [],
  };

  const resolved = resolveArtifactAffinityEffects({
    initialState,
    affinityEffects,
    primaryActorId: "A-2RB89Z-1",
    preserveActorIds: true,
  });

  assert.ok(resolved);
  const byId = new Map(resolved.actors.map((entry) => [entry.actorId, entry]));
  assert.ok(byId.has("A-2RB89Z-1"));
  assert.ok(byId.has("D-5JH2QW-1"));
  assert.equal(byId.get("D-5JH2QW-1").affinityStacks["dark:emit"], 2);
});

test("resolveArtifactAffinityEffects preserves target-aware affinity metadata", () => {
  const initialState = {
    actors: [{ id: "attacker_alpha" }],
  };
  const affinityEffects = {
    actors: [
      {
        actorId: "attacker_alpha",
        affinityStacks: { "earth:pull": 3 },
        affinityTargets: { "earth:pull:floor": 3 },
        resolvedEffects: [{ id: "earth:pull:floor:raise_barrier", operation: "raise_barrier" }],
      },
    ],
    traps: [],
  };

  const resolved = resolveArtifactAffinityEffects({
    initialState,
    affinityEffects,
    primaryActorId: "attacker_alpha",
  });

  assert.ok(resolved);
  assert.equal(resolved.actors.length, 1);
  assert.equal(resolved.actors[0].affinityTargets["earth:pull:floor"], 3);
  assert.equal(resolved.actors[0].resolvedEffects[0].id, "earth:pull:floor:raise_barrier");
});

test("resolveArtifactAffinityEffects derives fallback stacks from initial-state traits", () => {
  const initialState = {
    actors: [
      {
        id: "defender_alpha",
        traits: {
          affinities: {
            fire: 2,
            "wind:emit": 1,
          },
        },
      },
      {
        id: "defender_beta",
        traits: {
          affinities: {
            water: 1,
          },
        },
      },
    ],
  };

  const resolved = resolveArtifactAffinityEffects({
    initialState,
    affinityEffects: null,
    primaryActorId: "defender_alpha",
  });

  assert.ok(resolved);
  const byId = new Map(resolved.actors.map((entry) => [entry.actorId, entry]));
  assert.equal(byId.get("defender_alpha").affinityStacks["fire:push"], 2);
  assert.equal(byId.get("defender_alpha").affinityStacks["wind:emit"], 1);
  assert.equal(byId.get("actor_2").affinityStacks["water:push"], 1);
});
