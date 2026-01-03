const test = require("node:test");
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
  if (direction === "east") return { x: position.x + 1, y: position.y };
  if (direction === "south") return { x: position.x, y: position.y + 1 };
  if (direction === "west") return { x: position.x - 1, y: position.y };
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
