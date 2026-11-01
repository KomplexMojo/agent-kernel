// #653: "what can I do now" for a play seat, as a runtime API. `listLegalPlayCommands(view)` is a
// pure read of the seat's view (so fog hides what it hides) and returns { id, label, command }[],
// ordered by id. It is a candidate list: core still decides, and a listed command may be refused.
import { createRequire } from "node:module";
import { expect, test } from "vitest";
import { createPlaySession } from "../../packages/runtime/src/runner/play-session.js";
import { listLegalPlayCommands } from "../../packages/runtime/src/runner/play-legal-commands.js";

const require = createRequire(import.meta.url);
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const level = () => buildUnifiedLevel({
  id: "legal", tiles: ["######", "#....#", "#....E", "######"],
  actors: [
    { category: "delver", id: "hero", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals: viableVitals({ mana: 200 }),
      affinities: [{ kind: "water", expression: "push", stacks: 3, intensity: 1 }] },
    { category: "warden", id: "guard", position: { x: 3, y: 1 }, motivations: ["stationary"], vitals: viableVitals(), affinities: [] },
  ],
});

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

test("it lists wait, open steps and casts, ordered by id, from a view it never changes", async () => {
  const session = await createPlaySession({ ...level(), fog: false });
  await session.act({ kind: "equip_affinity", params: { affinityKey: "water:push" } });
  const view = deepFreeze(structuredClone(session.view()));
  const actions = listLegalPlayCommands(view);
  const ids = actions.map((action) => action.id);
  expect(ids).toEqual([...ids].sort());
  expect(ids).toEqual(expect.arrayContaining(["wait", "move:east", "cast:water:push@guard"]));
  expect(ids).not.toContain("move:north"); // a wall
  for (const action of actions) {
    expect(typeof action.label).toBe("string");
    expect(action.command.kind).toMatch(/^(wait|move|cast_affinity|take)$/);
  }
  expect(listLegalPlayCommands(view)).toEqual(actions); // same view, same list
});

test("fog is respected: a target the seat cannot see is not listed", async () => {
  const lit = await createPlaySession({ ...level(), fog: false });
  await lit.act({ kind: "equip_affinity", params: { affinityKey: "water:push" } });
  const fogged = await createPlaySession({ ...level(), fog: true });
  await fogged.act({ kind: "equip_affinity", params: { affinityKey: "water:push" } });
  const seeing = (session) => listLegalPlayCommands(session.view()).map((action) => action.id);
  expect(seeing(lit)).toContain("cast:water:push@guard");
  const inSight = (fogged.view().actors || []).some((actor) => actor.id === "guard");
  expect(seeing(fogged).includes("cast:water:push@guard")).toBe(inSight);
});

// A hand-built view: the list reads the view and nothing else.
const board = (over = {}) => ({
  rows: ["#####", "#...#", "#####"],
  legend: { wall: "#", barrier: "B", fog: "?" },
  player: { position: { x: 1, y: 1 }, vitals: [{ key: "stamina", current: 3 }, { key: "mana", current: 5 }],
    moveStamina: { step: 1, diagonal: 2, sprint: 3 }, castableAffinities: {} },
  actors: [], hazards: [], loot: [], status: {},
  ...over,
});

test("a step the seat cannot pay stamina for is not listed; a sprint needs its own price", () => {
  const ids = (view) => listLegalPlayCommands(view).map((action) => action.id);
  expect(ids(board())).toEqual(["move:east", "sprint:east", "wait"]);
  const tired = board({ player: { ...board().player, vitals: [{ key: "stamina", current: 2 }] } });
  expect(ids(tired)).toEqual(["move:east", "wait"]);
  const spent = board({ player: { ...board().player, vitals: [{ key: "stamina", current: 0 }] } });
  expect(ids(spent)).toEqual(["wait"]);
});

test("loot in reach is listed as a take, with the target and holding in the command", () => {
  const view = board({ loot: [{ targetId: "guard-1", holdingId: "h1" }] });
  const take = listLegalPlayCommands(view).find((action) => action.id === "take:guard-1:h1");
  expect(take.command).toEqual({ kind: "take", params: { targetId: "guard-1", holdingId: "h1" } });
});

test("a seat that has exited or been defeated, or no seat at all, has nothing to do", () => {
  expect(listLegalPlayCommands(board({ status: { exited: true } }))).toEqual([]);
  expect(listLegalPlayCommands(board({ status: { defeated: true } }))).toEqual([]);
  expect(listLegalPlayCommands({ rows: [], legend: {} })).toEqual([]);
  expect(listLegalPlayCommands(undefined)).toEqual([]);
});

// ## TODO: Test Permutations
// - a hazard in reach is a cast target (the list reads view.hazards as well as view.actors)
// - a cast at exactly its range is listed, one tile further is not
// - diagonal steps blocked by the corner rule are still listed (core refuses them: a candidate list)
