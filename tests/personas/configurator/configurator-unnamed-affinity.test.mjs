import { test, expect } from "vitest";
import { createConfiguratorPersona } from "../../../packages/runtime/src/personas/configurator/persona.js";
import { orchestrateBuild } from "../../../packages/runtime/src/build/orchestrate-build.js";
import { initializeCoreFromArtifacts } from "../../../packages/runtime/src/runner/core-setup.mjs";
import { AFFINITY_KINDS } from "../../../packages/runtime/src/contracts/domain-constants.js";

// #263 — no affinity is a default. A hazard authored with none gets one picked from the run
// seed (Darren's option B): every kind equally likely, the same seed builds the same level.
const configurator = createConfiguratorPersona({ clock: () => "2026-10-18T00:00:00.000Z" });

test("an unnamed hazard affinity is named from the seed, the same way every time", () => {
  const hazards = [{ id: "h1", expression: "emit", proximityRadius: 1 }];
  const first = configurator.nameUnnamedHazardAffinities(hazards, { seed: 7 });
  const again = configurator.nameUnnamedHazardAffinities(hazards, { seed: 7 });
  expect(AFFINITY_KINDS).toContain(first[0].affinity);
  expect(again).toEqual(first);
  expect(hazards[0].affinity).toBeUndefined();
});

test("a named hazard affinity is left as authored", () => {
  const hazards = [
    { id: "a", affinity: "water", expression: "emit" },
    { id: "b", affinity: { kind: "earth", expression: "push", stacks: 1 } },
  ];
  const named = configurator.nameUnnamedHazardAffinities(hazards, { seed: 3 });
  expect(named[0]).toBe(hazards[0]);
  expect(named[1]).toBe(hazards[1]);
});

test("every kind is picked, and none is favoured", () => {
  const counts = Object.fromEntries(AFFINITY_KINDS.map((kind) => [kind, 0]));
  const hazards = Array.from({ length: 1000 }, (_, index) => ({ id: `h${index}`, expression: "emit" }));
  for (const seed of [0, 1, 42]) {
    configurator.nameUnnamedHazardAffinities(hazards, { seed }).forEach((entry) => { counts[entry.affinity] += 1; });
  }
  const total = 3000;
  for (const kind of AFFINITY_KINDS) {
    expect(counts[kind]).toBeGreaterThan(total / AFFINITY_KINDS.length * 0.75);
    expect(counts[kind]).toBeLessThan(total / AFFINITY_KINDS.length * 1.25);
  }
});

test("an object affinity with no kind gets the kind and keeps its other fields", () => {
  const [named] = configurator.nameUnnamedHazardAffinities(
    [{ id: "h", affinity: { expression: "push", stacks: 2 } }],
    { seed: 5 },
  );
  expect(named.affinity).toMatchObject({ expression: "push", stacks: 2 });
  expect(AFFINITY_KINDS).toContain(named.affinity.kind);
});

async function buildWithUnnamedHazard(seed) {
  return orchestrateBuild({ spec: {
    schema: "agent-kernel/BuildSpec", schemaVersion: 1,
    meta: { id: "unnamed", runId: "unnamed", createdAt: "2026-10-18T00:00:00Z", source: "test" },
    intent: { goal: "a hazard authored with no affinity" }, plan: {}, configurator: { inputs: {
      levelGen: { width: 9, height: 9, seed,
        shape: { roomCount: 1, roomMinSize: 3, roomMaxSize: 3 },
        hazards: [{ id: "trap", affinity: { expression: "emit", stacks: 1 } }] },
      actors: [], movementStamina: {}, resources: [],
    } },
  } });
}

test("a build gives an unnamed hazard the seed's kind, and the same seed builds the same hazard", async () => {
  const first = initializeCoreFromArtifacts(JSON.parse(JSON.stringify(await buildWithUnnamedHazard(11))));
  const again = initializeCoreFromArtifacts(JSON.parse(JSON.stringify(await buildWithUnnamedHazard(11))));
  const kind = configurator.nameUnnamedHazardAffinities([{ expression: "emit" }], { seed: 11 })[0].affinity;
  expect(first.registry.getActor("trap").affinities).toEqual([{ kind, expression: "emit", stacks: 1 }]);
  expect(again.registry.getActor("trap").affinities).toEqual(first.registry.getActor("trap").affinities);
});

// ## TODO: Test Permutations
// - a positioned (x/y) hazard with no affinity is named the same way.
// - an unnamed hazard reached through a card set (`affinity: null` on the card) builds with a kind.
