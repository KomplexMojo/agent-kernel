/**
 * SF.3 — the Actor authorizes spatial-field tuple meaning; the platform merely
 * selects from that opaque output.
 */
"use strict";

const assert = require("node:assert/strict");

const BASE_TILES = ["#####", "#...#", "#...#", "#...#", "##E##"];

async function actorDecision({ self, proposals, affinityFields }) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const observation = {
    actors: [self],
    tiles: { baseTiles: BASE_TILES, kinds: BASE_TILES.map((line) => Array.from(line, (tile) => tile === "#" ? 1 : 0)) },
    exit: { x: 2, y: 4 },
    affinityFields,
  };
  const payload = {
    actorId: self.id,
    observation,
    baseTiles: BASE_TILES,
    initialState: { actors: [{ id: self.id, role: self.role, kind: "motivated", runtimeDecisioning: true }] },
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
    proposals,
  };
  const persona = createActorPersona({ clock: () => "fixed" });
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });
  return result.effects.find((effect) => effect?.kind === "solver_request").request.problem.data;
}

test("CLI selects the safer Actor-authored v2 move without interpreting field data", async () => {
  const self = {
    id: "delver_1",
    kind: 2,
    role: "delver",
    position: { x: 2, y: 2 },
    motivation: { kind: "random" },
    vitals: { health: { current: 5, max: 10, regen: 0 } },
  };
  const data = await actorDecision({
    self,
    proposals: [
      { kind: "move", params: { direction: "east", from: self.position, to: { x: 3, y: 2 } } },
      { kind: "move", params: { direction: "south", from: self.position, to: { x: 2, y: 3 } } },
    ],
    affinityFields: [{
      position: { x: 3, y: 2 }, kind: 1, expression: 3, stacks: 2, intensity: 2, contributionCount: 1,
      vitalEffects: [{ vital: 0, effect: -4 }],
    }],
  });
  const { createRealZ3SolverAdapter } = await import(
    "../../../packages/adapters-cli/src/adapters/z3/index.js"
  );

  const result = await createRealZ3SolverAdapter().solve({ problem: { data } });

  assert.equal(data.objectives.actorDecision.contract, "actor-decision-objective-v5");
  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "move_south");
});

test("CLI cannot let field benefit outrank the Actor's primary intent", async () => {
  const self = {
    id: "delver_1",
    kind: 2,
    role: "delver",
    position: { x: 2, y: 2 },
    motivation: { kind: "stationary" },
    vitals: { health: { current: 0, max: 10, regen: 0 } },
  };
  const data = await actorDecision({
    self,
    proposals: [],
    affinityFields: [{
      position: { x: 3, y: 2 }, kind: 5, expression: 3, stacks: 10, intensity: 10, contributionCount: 1,
      vitalEffects: [{ vital: 0, effect: 10 }],
    }],
  });
  const { createRealZ3SolverAdapter } = await import(
    "../../../packages/adapters-cli/src/adapters/z3/index.js"
  );

  const result = await createRealZ3SolverAdapter().solve({ problem: { data } });

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "wait_here");
});

// ## TODO: Test Permutations
// - web and CLI select the same Actor-authored v2 winner for every signed field rank
// - absent or unseen field records leave otherwise-identical candidate order unchanged
// - a current-cell field affects attacks, casts, and waits but not an unrelated move destination
