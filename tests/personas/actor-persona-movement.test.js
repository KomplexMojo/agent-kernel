const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const personaModule = moduleUrl("packages/runtime/src/personas/actor/controller.mts");
const tickModule = moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.mts");
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/persona-behavior-v1-actor-movement.json"), "utf8"));

const script = `
import assert from "node:assert/strict";
import { createActorPersona } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

const fixture = ${JSON.stringify(fixture)};

function applyDirection(position, direction) {
  if (direction === "north") return { x: position.x, y: position.y - 1 };
  if (direction === "northeast") return { x: position.x + 1, y: position.y - 1 };
  if (direction === "east") return { x: position.x + 1, y: position.y };
  if (direction === "southeast") return { x: position.x + 1, y: position.y + 1 };
  if (direction === "south") return { x: position.x, y: position.y + 1 };
  if (direction === "southwest") return { x: position.x - 1, y: position.y + 1 };
  if (direction === "west") return { x: position.x - 1, y: position.y };
  if (direction === "northwest") return { x: position.x - 1, y: position.y - 1 };
  return { ...position };
}

fixture.cases.forEach((entry) => {
  const persona = createActorPersona({ clock: () => "fixed" });
  let position = { ...entry.start };
  entry.expectedDirections.forEach((direction, index) => {
    const observation = {
      tick: index,
      actors: [{ id: entry.actorId, kind: 2, position: { ...position } }],
      tiles: { kinds: entry.kinds },
    };
    persona.advance({
      phase: TickPhases.OBSERVE,
      event: "observe",
      payload: { actorId: entry.actorId, observation, baseTiles: entry.baseTiles },
      tick: index,
    });
    persona.advance({
      phase: TickPhases.DECIDE,
      event: "decide",
      payload: { actorId: entry.actorId },
      tick: index,
    });
    const result = persona.advance({
      phase: TickPhases.DECIDE,
      event: "propose",
      payload: { actorId: entry.actorId },
      tick: index,
    });
    assert.equal(result.actions.length, 1);
    const action = result.actions[0];
    assert.equal(action.kind, "move");
    assert.equal(action.actorId, entry.actorId);
    assert.equal(action.params.direction, direction);
    assert.deepEqual(action.params.from, position);
    assert.deepEqual(action.params.to, applyDirection(position, direction));
    position = action.params.to;
    persona.advance({
      phase: TickPhases.DECIDE,
      event: "cooldown",
      payload: { actorId: entry.actorId },
      tick: index,
    });
  });
});
`;

test("actor persona proposes deterministic movement toward exit", () => {
  runEsm(script);
});

const exploringScript = `
import assert from "node:assert/strict";
import { createActorPersona } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

// 5×3 board: actor at (1,1), exit "E" at (4,1), floor in between.
const baseTiles = ["#####", "#...E", "#####"];
const actorId = "actor_delver";

const persona = createActorPersona({ clock: () => "fixed" });

persona.advance({
  phase: TickPhases.OBSERVE,
  event: "observe",
  payload: {
    actorId,
    observation: {
      tick: 0,
      actors: [{ id: actorId, kind: 2, position: { x: 1, y: 1 }, motivation: { mobility: "exploring" } }],
    },
    baseTiles,
  },
  tick: 0,
});

persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: { actorId }, tick: 0 });

const result = persona.advance({
  phase: TickPhases.DECIDE,
  event: "propose",
  payload: { actorId },
  tick: 0,
});

assert.ok(Array.isArray(result.actions));
assert.equal(result.actions.length, 1, "exploring motivation must produce exactly one action");
assert.equal(result.actions[0].kind, "move", "exploring motivation must advance toward exit");
assert.equal(result.actions[0].actorId, actorId);
`;

test("actor persona with exploring motivation proposes move toward exit", () => {
  runEsm(exploringScript);
});

// FAILING: buildMoveProposal ignores motivation.mobility (gap #5).
// M4 will check actor.motivation.mobility and return [] for stationary actors.
const stationaryScript = `
import assert from "node:assert/strict";
import { createActorPersona } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

const baseTiles = ["#####", "#...E", "#####"];
const actorId = "actor_warden";

const persona = createActorPersona({ clock: () => "fixed" });

persona.advance({
  phase: TickPhases.OBSERVE,
  event: "observe",
  payload: {
    actorId,
    observation: {
      tick: 0,
      actors: [{ id: actorId, kind: 2, position: { x: 1, y: 1 }, motivation: { mobility: "stationary" } }],
    },
    baseTiles,
  },
  tick: 0,
});

persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: { actorId }, tick: 0 });

const result = persona.advance({
  phase: TickPhases.DECIDE,
  event: "propose",
  payload: { actorId },
  tick: 0,
});

// A stationary warden must hold position — it must not propose movement.
assert.ok(Array.isArray(result.actions));
assert.equal(result.actions.length, 1, "stationary motivation must produce exactly one action");
assert.equal(result.actions[0].kind, "wait", "stationary motivation must produce wait, not move");
`;

test("actor persona with stationary motivation proposes wait not move", () => {
  runEsm(stationaryScript);
});

/*
## TODO: Test Permutations
- Permutation: patrolling mobility with a patrol route — actor proposes move along route, not BFS to exit.
- Permutation: attacking mobility with a visible opponent — actor proposes move toward opponent, not exit.
- Permutation: defending mobility with a hold-point target — actor proposes wait at hold-point.
- Permutation: user_controlled motivation — no autonomous proposal emitted; actions require explicit payload.
- Permutation: stationary warden with no exit on map — still proposes wait (regression guard).
- Permutation: motivation field absent on actor — defaults to exploring behavior (BFS to exit).
- Permutation: motivation.mobility = "exploring" with no reachable exit — proposes wait as fallback.
*/
