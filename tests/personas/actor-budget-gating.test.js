const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const personaModule = moduleUrl("packages/runtime/src/personas/actor/controller.mts");
const tickModule = moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.mts");
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/persona-behavior-v1-actor-budget-gating.json"), "utf8"));

const script = `
import assert from "node:assert/strict";
import { createActorPersona } from ${JSON.stringify(personaModule)};
import { TickPhases } from ${JSON.stringify(tickModule)};

const fixture = ${JSON.stringify(fixture)};

fixture.cases.forEach((entry) => {
  const persona = createActorPersona({ clock: () => "fixed" });
  persona.advance({
    phase: TickPhases.OBSERVE,
    event: "observe",
    payload: { actorId: entry.actorId, observation: entry.observation },
    tick: 0,
  });
  persona.advance({
    phase: TickPhases.DECIDE,
    event: "decide",
    payload: { actorId: entry.actorId },
    tick: 0,
  });
  const payload = { actorId: entry.actorId, proposals: entry.proposals };
  if (entry.budgetReceipt) payload.budgetReceipt = entry.budgetReceipt;
  if (entry.budgetAllocation) payload.budgetAllocation = entry.budgetAllocation;
  const result = persona.advance({
    phase: TickPhases.DECIDE,
    event: "propose",
    payload,
    tick: 1,
  });
  assert.deepEqual(result.actions.map((action) => action.kind), entry.expectedKinds);
  const labels = result.actions.map((action) => action.params && action.params.label).filter(Boolean);
  assert.deepEqual(labels, entry.expectedLabels);
});
`;

test("actor persona gates motivation and affinity proposals by budget", () => {
  runEsm(script);
});
