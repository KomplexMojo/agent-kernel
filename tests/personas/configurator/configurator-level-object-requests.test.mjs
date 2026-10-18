import { test, expect } from "vitest";
import { createConfiguratorPersona } from "../../../packages/runtime/src/personas/configurator/controller.js";
import { mapHazards, mapResources } from "../../../packages/runtime/src/personas/configurator/input-preparation.js";

// #300 — `ak solve --question place-objects` re-poses a built level's placement problem. The
// Configurator turns the level's placed hazard and resource actors back into placement
// requests; placing them must reproduce the same actors, so the question is about this level.
const clock = () => "2026-10-17T00:00:00.000Z";
const configurator = () => createConfiguratorPersona({ clock });

function builtActors(c) {
  const hazards = mapHazards([
    { id: "h_emit", position: { x: 1, y: 1 }, affinity: { kind: "water", expression: "emit", stacks: 2 } },
    { id: "h_push", position: { x: 2, y: 1 }, affinity: { kind: "earth", expression: "push", stacks: 1 }, blocking: true },
  ]);
  const resources = mapResources([
    { id: "r_health", position: { x: 3, y: 1 }, permanenceMode: "consumable", vitals: [{ key: "health", delta: 4 }] },
    { id: "r_slot", position: { x: 1, y: 2 }, slotGrant: 1 },
  ]);
  const delver = { id: "d_1", position: { x: 0, y: 0 } };
  const strip = ({ category: _category, ...actor }) => actor;
  return {
    actors: [delver, ...hazards.map(strip), ...resources.map(strip)],
    presentation: {
      d_1: { category: "delver" },
      ...Object.fromEntries(hazards.map(({ id }) => [id, { category: "hazard" }])),
      ...Object.fromEntries(resources.map(({ id }) => [id, { category: "resource" }])),
    },
  };
}

test("a built level's objects become unpositioned requests that map back to the same actors", () => {
  const c = configurator();
  const level = builtActors(c);
  const requests = c.levelObjectRequests(level);

  expect(requests.hazards.map(({ id }) => id)).toEqual(["h_emit", "h_push"]);
  expect(requests.resources.map(({ id }) => id)).toEqual(["r_health", "r_slot"]);
  expect(requests.actors.map(({ id }) => id)).toEqual(["d_1"]);
  [...requests.hazards, ...requests.resources].forEach((request) => expect(request).not.toHaveProperty("position"));
  expect(requests.hazards[1].blocking).toBe(true);

  const byId = new Map(level.actors.map((actor) => [actor.id, actor]));
  const at = (request) => ({ ...request, position: byId.get(request.id).position });
  const strip = ({ category: _category, ...actor }) => actor;
  mapHazards(requests.hazards.map(at)).forEach((actor) => expect(strip(actor)).toEqual(byId.get(actor.id)));
  mapResources(requests.resources.map(at)).forEach((actor) => expect(strip(actor)).toEqual(byId.get(actor.id)));
});

test("re-placing a built level's objects through the Configurator keeps every object and the fixed actors", () => {
  const c = configurator();
  const level = builtActors(c);
  const layout = {
    width: 4,
    height: 3,
    terrain: Array(12).fill("floor"),
    spawnApproach: { x: 0, y: 0 },
    exitApproach: { x: 3, y: 2 },
    rooms: [],
  };
  const placement = c.completeObjectPlacement({ layout, ...c.levelObjectRequests(level) });
  expect(placement.ok).toBe(true);
  expect(placement.actors.map(({ id }) => id).sort()).toEqual(["h_emit", "h_push", "r_health", "r_slot"]);
  const cells = placement.actors.map(({ position }) => `${position.x},${position.y}`);
  expect(new Set(cells).size).toBe(4);
  expect(cells).not.toContain("0,0");
  expect(cells).not.toContain("3,2");
});

// ## TODO: Test Permutations
// - a hazard actor with a non-default alignment or equipment fields round-trips unchanged.
// - an actor whose presentation entry is missing but carries `category` is still classified.
// - a level with no hazards or resources yields empty request lists and only fixed actors.
