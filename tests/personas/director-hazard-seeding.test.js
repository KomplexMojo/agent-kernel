const assert = require("node:assert/strict");



test("director emits hazard_proposal effects from explicit room hazard hints on ingest_intent", async () => {
const { createDirectorPersona } = await import("../../packages/runtime/src/personas/director/controller.js");

const CLOCK = "2025-01-01T00:00:00.000Z";
const clock = () => CLOCK;

// Bootstrap the persona to INTAKE state
const persona = createDirectorPersona({ clock });
persona.advance({ phase: "decide", event: "bootstrap", payload: {
  intentEnvelope: {
    schema: "agent-kernel/IntentEnvelope",
    schemaVersion: 1,
    meta: { id: "intent_fire_test", runId: "run_fire_test", createdAt: CLOCK, producedBy: "orchestrator" },
    source: "test",
    intent: { goal: "Fire dungeon", tags: ["fire"] }
  }
}, tick: 0 });

// Ingest an intent that has an explicit room hazard affinity hint.
const intentEnvelope = {
  schema: "agent-kernel/IntentEnvelope",
  schemaVersion: 1,
  meta: { id: "intent_fire_test", runId: "run_fire_test", createdAt: CLOCK, producedBy: "orchestrator" },
  source: "test",
  intent: {
    goal: "Fire dungeon with one fire room",
    tags: ["fire"],
    hints: {
      budgetTokens: 1000,
      rooms: [
        { motivation: "combat", affinity: "fire", count: 1 },
        { motivation: "rest", count: 2 },        // no affinity — should be skipped
      ]
    }
  }
};

const result = persona.advance({
  phase: "decide",
  event: "ingest_intent",
  payload: { intentEnvelope },
  tick: 1,
});

assert.equal(result.state, "draft_plan", "state should be draft_plan after ingest_intent");

// Should have exactly one hazard_proposal effect from the explicit fire hazard hint.
const hazardEffects = result.effects.filter((e) => e.kind === "hazard_proposal");
assert.equal(hazardEffects.length, 1, "should emit one hazard_proposal for the fire room");

const proposal = hazardEffects[0];
assert.equal(proposal.affinity, "fire", "proposal affinity should be fire");
assert.equal(proposal.roomIndex, 0, "proposal roomIndex should be 0");
assert.equal(proposal.personaRef, "director", "proposal personaRef should be director");

// budgetCeiling = 44% of 1000 = 440 (rooms pool, no reserve)
assert.equal(proposal.budgetCeiling, 440, "budgetCeiling should be 440 (44% of 1000)");

// planRef should be present since a plan was built from intent
assert.ok(proposal.planRef, "proposal should carry a planRef");
assert.equal(proposal.planRef.schema, "agent-kernel/PlanArtifact");

// Room without a hazard affinity hint should NOT produce a hazard proposal.
assert.equal(hazardEffects.filter((e) => e.roomIndex === 1).length, 0, "rest room without a hazard affinity hint should not produce a proposal");
});


test("director emits no hazard_proposal effects when intent has no affinity-tagged rooms", async () => {
const { createDirectorPersona } = await import("../../packages/runtime/src/personas/director/controller.js");

const CLOCK = "2025-01-01T00:00:00.000Z";
const clock = () => CLOCK;

const persona = createDirectorPersona({ clock });
persona.advance({ phase: "decide", event: "bootstrap", payload: {
  intentEnvelope: {
    schema: "agent-kernel/IntentEnvelope",
    schemaVersion: 1,
    meta: { id: "intent_no_rooms", runId: "run_no_rooms", createdAt: CLOCK, producedBy: "orchestrator" },
    source: "test",
    intent: { goal: "Generic dungeon" }
  }
}, tick: 0 });

const result = persona.advance({
  phase: "decide",
  event: "ingest_intent",
  payload: {
    intentEnvelope: {
      schema: "agent-kernel/IntentEnvelope",
      schemaVersion: 1,
      meta: { id: "intent_no_rooms", runId: "run_no_rooms", createdAt: CLOCK, producedBy: "orchestrator" },
      source: "test",
      intent: { goal: "Generic dungeon", hints: { budgetTokens: 500 } }
    }
  },
  tick: 1,
});

const hazardEffects = result.effects.filter((e) => e.kind === "hazard_proposal");
assert.equal(hazardEffects.length, 0, "no hazard proposals when no rooms have hazard affinity hints");
});


test("hazard room labels derive from contained hazards rather than room affinity", async () => {
const { summarizeMixedRoomAssemblies } = await import("../../packages/runtime/src/build/mixed-room-summary.js");

const [room] = summarizeMixedRoomAssemblies([
  {
    id: "R-director-label",
    affinity: "water",
    mixedRoomComposition: {
      hazards: [{ id: "H-fire", affinity: "fire" }],
    },
  },
]);

assert.equal(room.affinityRoomLabel, "fire affinity room");
assert.deepEqual(room.hazardAffinityKinds, ["fire"]);
assert.equal(room.roomAffinity, undefined);
});
