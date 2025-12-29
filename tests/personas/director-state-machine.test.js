const test = require("node:test");
const assert = require("node:assert/strict");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const modulePath = moduleUrl("packages/runtime/src/personas/director/state-machine.js");
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/director-state-basic.json"), "utf8"));

const script = `
import assert from "node:assert/strict";
import { createDirectorStateMachine, DirectorStates } from ${JSON.stringify(modulePath)};

const machine = createDirectorStateMachine({ initialState: ${JSON.stringify(fixture.state)}, clock: () => "fixed-time" });

// bootstrap into intake with intent
let result = machine.advance("bootstrap", { intentRef: "intent:1" });
assert.equal(result.state, DirectorStates.INTAKE);
assert.equal(result.context.intentRef, "intent:1");

// ingest intent -> draft_plan
result = machine.advance("ingest_intent", { intentRef: "intent:1" });
assert.equal(result.state, DirectorStates.DRAFT_PLAN);

// complete draft -> refine with plan
result = machine.advance("draft_complete", { planRef: "plan:1" });
assert.equal(result.state, DirectorStates.REFINE);

// refinement complete -> ready
result = machine.advance("refinement_complete", { planRef: "plan:1" });
assert.equal(result.state, DirectorStates.READY);
assert.equal(result.context.planRef, "plan:1");
assert.equal(result.context.lastEvent, "refinement_complete");

// invalidate and refresh
result = machine.advance("invalidate_plan", {});
assert.equal(result.state, DirectorStates.STALE);
result = machine.advance("refresh", { intentRef: "intent:2" });
assert.equal(result.state, DirectorStates.INTAKE);
assert.equal(result.context.intentRef, "intent:2");
`;

const guardScript = `
import assert from "node:assert/strict";
import { createDirectorStateMachine } from ${JSON.stringify(modulePath)};

const machine = createDirectorStateMachine({ clock: () => "fixed" });
let threw = false;
try {
  machine.advance("bootstrap", {});
} catch (err) {
  threw = true;
  assert.match(err.message, /Guard/);
}
assert.equal(threw, true);

let badEvent = false;
try {
  machine.advance("missing_event", {});
} catch (err) {
  badEvent = true;
  assert.match(err.message, /No transition/);
}
assert.equal(badEvent, true);
`;

test("director state machine advances through happy path", () => {
  runEsm(script);
});

test("director state machine enforces guards and missing transitions", () => {
  runEsm(guardScript);
});
