const assert = require("node:assert/strict");

test("director emits artifact_proposal effects for affinity rooms proportional to dungeonBreakdown.artifacts", async () => {
  const { createDirectorPersona } = await import(
    "../../packages/runtime/src/personas/director/controller.js"
  );

  const CLOCK = "2025-01-01T00:00:00.000Z";
  const clock = () => CLOCK;

  const persona = createDirectorPersona({ clock });
  persona.advance({ phase: "decide", event: "bootstrap", payload: {
    intentEnvelope: {
      schema: "agent-kernel/IntentEnvelope",
      schemaVersion: 1,
      meta: { id: "intent_art_test", runId: "run_art_test", createdAt: CLOCK, producedBy: "orchestrator" },
      source: "test",
      intent: { goal: "Fire dungeon" }
    }
  }, tick: 0 });

  const intentEnvelope = {
    schema: "agent-kernel/IntentEnvelope",
    schemaVersion: 1,
    meta: { id: "intent_art_test", runId: "run_art_test", createdAt: CLOCK, producedBy: "orchestrator" },
    source: "test",
    intent: {
      goal: "Two-room fire dungeon",
      tags: ["fire"],
      hints: {
        budgetTokens: 1000,
        dungeonBreakdown: { artifacts: 100 },
        rooms: [
          { motivation: "combat", affinity: "fire", count: 1 },
          { motivation: "combat", affinity: "shadow", count: 1 },
          { motivation: "rest", count: 2 },
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

  const artifactEffects = result.effects.filter((e) => e.kind === "artifact_proposal");

  assert.equal(artifactEffects.length, 2, "should emit one artifact_proposal per affinity room");

  const fireProposal = artifactEffects.find((e) => e.roomIndex === 0);
  const shadowProposal = artifactEffects.find((e) => e.roomIndex === 1);

  assert.ok(fireProposal, "should have proposal for room 0 (fire)");
  assert.ok(shadowProposal, "should have proposal for room 1 (shadow)");

  assert.equal(fireProposal.affinity, "fire");
  assert.equal(shadowProposal.affinity, "shadow");

  assert.equal(fireProposal.budgetCeiling, 50, "fire room budgetCeiling should be 50");
  assert.equal(shadowProposal.budgetCeiling, 50, "shadow room budgetCeiling should be 50");

  assert.ok(Array.isArray(fireProposal.vitals) && fireProposal.vitals.length > 0, "vitals should be non-empty array");
  assert.equal(fireProposal.vitals[0].key, "health");
  assert.equal(fireProposal.vitals[0].delta, 50);
  assert.equal(typeof fireProposal.permanent, "boolean");

  assert.equal(fireProposal.personaRef, "director");

  assert.ok(fireProposal.planRef, "artifact proposal should carry planRef");
  assert.equal(fireProposal.planRef.schema, "agent-kernel/PlanArtifact");

  assert.equal(artifactEffects.filter((e) => e.roomIndex === 2).length, 0,
    "rest room with no affinity should not produce an artifact_proposal");

  const totalSpend = artifactEffects.reduce((sum, e) => sum + e.budgetCeiling, 0);
  assert.ok(totalSpend <= 100, `total artifact spend ${totalSpend} should not exceed 100`);
});

test("director emits artifact_proposal with zero budget when dungeonBreakdown.artifacts is absent", async () => {
  const { createDirectorPersona } = await import(
    "../../packages/runtime/src/personas/director/controller.js"
  );

  const CLOCK = "2025-01-01T00:00:00.000Z";
  const clock = () => CLOCK;

  const persona = createDirectorPersona({ clock });
  persona.advance({ phase: "decide", event: "bootstrap", payload: {
    intentEnvelope: {
      schema: "agent-kernel/IntentEnvelope",
      schemaVersion: 1,
      meta: { id: "intent_no_budget", runId: "run_no_budget", createdAt: CLOCK, producedBy: "orchestrator" },
      source: "test",
      intent: { goal: "Fire dungeon" }
    }
  }, tick: 0 });

  const result = persona.advance({
    phase: "decide",
    event: "ingest_intent",
    payload: {
      intentEnvelope: {
        schema: "agent-kernel/IntentEnvelope",
        schemaVersion: 1,
        meta: { id: "intent_no_budget", runId: "run_no_budget", createdAt: CLOCK, producedBy: "orchestrator" },
        source: "test",
        intent: {
          goal: "Fire dungeon no artifact budget",
          hints: {
            budgetTokens: 1000,
            rooms: [{ motivation: "combat", affinity: "fire", count: 1 }]
          }
        }
      }
    },
    tick: 1,
  });

  const artifactEffects = result.effects.filter((e) => e.kind === "artifact_proposal");
  assert.equal(artifactEffects.length, 1, "should emit proposal even without dungeonBreakdown");
  assert.equal(artifactEffects[0].budgetCeiling, 0, "budgetCeiling should be 0 when no artifact budget provided");
  assert.ok(Array.isArray(artifactEffects[0].vitals) && artifactEffects[0].vitals.length > 0, "vitals must be present");
  assert.equal(typeof artifactEffects[0].permanent, "boolean");
});

test("director uses room-level artifactVitals and artifactPermanent overrides in artifact_proposal", async () => {
  const { createDirectorPersona } = await import(
    "../../packages/runtime/src/personas/director/controller.js"
  );

  const CLOCK = "2025-01-01T00:00:00.000Z";
  const clock = () => CLOCK;

  const persona = createDirectorPersona({ clock });
  persona.advance({ phase: "decide", event: "bootstrap", payload: {
    intentEnvelope: {
      schema: "agent-kernel/IntentEnvelope",
      schemaVersion: 1,
      meta: { id: "intent_custom", runId: "run_custom", createdAt: CLOCK, producedBy: "orchestrator" },
      source: "test",
      intent: { goal: "Custom dungeon" }
    }
  }, tick: 0 });

  const result = persona.advance({
    phase: "decide",
    event: "ingest_intent",
    payload: {
      intentEnvelope: {
        schema: "agent-kernel/IntentEnvelope",
        schemaVersion: 1,
        meta: { id: "intent_custom", runId: "run_custom", createdAt: CLOCK, producedBy: "orchestrator" },
        source: "test",
        intent: {
          goal: "Custom drops",
          hints: {
            dungeonBreakdown: { artifacts: 60 },
            rooms: [
              { motivation: "boss", affinity: "fire", artifactVitals: [{ key: "mana", delta: 20 }], artifactPermanent: true }
            ]
          }
        }
      }
    },
    tick: 1,
  });

  const props = result.effects.filter((e) => e.kind === "artifact_proposal");
  assert.equal(props.length, 1);
  assert.deepEqual(props[0].vitals, [{ key: "mana", delta: 20 }], "room-level artifactVitals override should be used");
  assert.equal(props[0].permanent, true, "room-level artifactPermanent override should be used");
  assert.equal(props[0].budgetCeiling, 60);
});
