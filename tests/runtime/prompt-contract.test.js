const test = require("node:test");
const assert = require("node:assert/strict");

test("buildLlmActorConfigPromptTemplate includes allowed lists and defender phase shape", async () => {
  const { ALLOWED_AFFINITIES, ALLOWED_AFFINITY_EXPRESSIONS, ALLOWED_MOTIVATIONS } = await import(
    "../../packages/runtime/src/personas/orchestrator/prompt-contract.js"
  );
  const { buildLlmActorConfigPromptTemplate } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  const prompt = buildLlmActorConfigPromptTemplate({
    goal: "Test goal",
    budgetTokens: 800,
    remainingBudgetTokens: 320,
    allowedPairsText: "(attacking, fire)",
    context: "Layout tiles: wall 20, floor 40, hallway 10",
    affinities: ALLOWED_AFFINITIES,
    affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
    motivations: ALLOWED_MOTIVATIONS,
  });
  ALLOWED_AFFINITIES.forEach((affinity) => assert.ok(prompt.includes(affinity)));
  ALLOWED_AFFINITY_EXPRESSIONS.forEach((expression) => assert.ok(prompt.includes(expression)));
  ALLOWED_MOTIVATIONS.forEach((motivation) => assert.ok(prompt.includes(motivation)));
  assert.ok(prompt.includes("dungeon defender strategist"));
  assert.ok(prompt.includes("Total budget tokens: 800"));
  assert.ok(prompt.includes("Defender phase budget tokens: 320"));
  assert.ok(prompt.includes("Allowed defender profiles (motivation, affinity): (attacking, fire)"));
  assert.ok(prompt.includes("Phase: actors_only"));
  assert.ok(prompt.includes("Return defenders only; omit rooms and layout."));
  assert.ok(prompt.includes("Defender viability guardrails"));
  assert.ok(prompt.includes("mana regen"));
  assert.ok(prompt.includes("Model context window token limit: 16384"));
});

test("buildLlmLevelPromptTemplate injects layout phase metadata", async () => {
  const { buildLlmLevelPromptTemplate } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  const prompt = buildLlmLevelPromptTemplate({
    goal: "Phase goal",
    notes: "Phase notes",
    budgetTokens: 500,
    remainingBudgetTokens: 120,
    context: "Layout tiles: wall 10, floor 20, hallway 5",
    layoutCosts: { wallTiles: 2, floorTiles: 3, hallwayTiles: 4 },
  });
  assert.ok(prompt.includes("Phase: layout_only"));
  assert.ok(prompt.includes("Remaining budget tokens: 120"));
  assert.ok(prompt.includes("Layout tiles: wall 10, floor 20, hallway 5"));
  assert.ok(prompt.includes("Tile costs: wall 2, floor 3, hallway 4 tokens each."));
  assert.ok(prompt.includes("room design"));
  assert.ok(prompt.includes("roomDesign.profile"));
  assert.ok(prompt.includes("response concise"));
  assert.ok(prompt.includes("Model context window token limit: 16384"));
  assert.ok(prompt.includes("Layout phase latency target: 10000 ms."));
  assert.ok(prompt.includes("Keep the response concise"));
});

test("buildLlmPhasePromptTemplate routes to layout and defender templates", async () => {
  const { buildLlmPhasePromptTemplate } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  const layoutPrompt = buildLlmPhasePromptTemplate({
    goal: "Layout goal",
    budgetTokens: 500,
    phase: "layout_only",
    remainingBudgetTokens: 200,
  });
  const actorsPrompt = buildLlmPhasePromptTemplate({
    goal: "Actor goal",
    budgetTokens: 500,
    phase: "actors_only",
    remainingBudgetTokens: 200,
  });
  assert.ok(layoutPrompt.includes("Phase: layout_only"));
  assert.ok(layoutPrompt.includes("Return layout tile counts and a room layout summary"));
  assert.ok(actorsPrompt.includes("Phase: actors_only"));
  assert.ok(actorsPrompt.includes("Return defenders only; omit rooms and layout."));
});

test("buildLlmActorConfigPromptTemplate scopes defender affinities when provided", async () => {
  const { buildLlmActorConfigPromptTemplate } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  const prompt = buildLlmActorConfigPromptTemplate({
    goal: "Defender goal",
    budgetTokens: 800,
    remainingBudgetTokens: 320,
    affinities: ["fire", "wind"],
  });
  assert.ok(prompt.includes("Affinities: fire, wind"));
  assert.ok(!prompt.includes("Affinities: fire, wind, water"));
});

test("normalizeSummary accepts valid summary and rejects invalid fields", async () => {
  const { normalizeSummary } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const valid = normalizeSummary({
    dungeonAffinity: "fire",
    budgetTokens: 800,
    rooms: [
      {
        motivation: "stationary",
        affinity: "fire",
        count: 2,
        tokenHint: 200,
        affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
      },
    ],
    actors: [
      {
        motivation: "attacking",
        affinity: "earth",
        count: 1,
        affinities: [
          { kind: "earth", expression: "push", stacks: 1 },
          { kind: "earth", expression: "pull", stacks: 1 },
        ],
      },
    ],
    missing: [],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.value.rooms.length, 1);
  assert.equal(valid.value.actors.length, 1);

  const invalid = normalizeSummary({
    dungeonAffinity: "invalid",
    rooms: [{ motivation: "bad", affinity: "fire", count: 0, affinities: [{ kind: "fire", expression: "bad" }] }],
    actors: [{ motivation: "attacking", affinity: "bad", count: -1, tokenHint: -5, stacks: -1 }],
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.find((e) => e.field === "dungeonAffinity"));
  assert.ok(invalid.errors.find((e) => e.field === "rooms[0].motivation"));
  assert.ok(invalid.errors.find((e) => e.field === "actors[0].affinity"));
  assert.ok(invalid.errors.find((e) => e.field === "actors[0].tokenHint"));
  assert.ok(invalid.errors.find((e) => e.field === "actors[0].stacks"));
  assert.ok(invalid.errors.find((e) => e.field === "rooms[0].affinities[0].expression"));
});

test("normalizeSummary preserves actor vitals when provided", async () => {
  const { normalizeSummary } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const result = normalizeSummary({
    dungeonAffinity: "fire",
    actors: [
      {
        motivation: "defending",
        affinity: "fire",
        count: 1,
        affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
        vitals: {
          health: { current: 8, max: 10, regen: 0 },
          mana: { current: 4, max: 6, regen: 1 },
          stamina: { current: 2, max: 2, regen: 0 },
          durability: { current: 2, max: 2, regen: 0 },
        },
      },
    ],
    rooms: [],
  });
  assert.equal(result.ok, true);
  const actor = result.value.actors[0];
  assert.equal(actor.vitals.health.current, 8);
  assert.equal(actor.vitals.mana.regen, 1);
});

test("normalizeSummary preserves room design details when provided", async () => {
  const { normalizeSummary } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const result = normalizeSummary({
    dungeonAffinity: "fire",
    rooms: [],
    actors: [],
    roomDesign: {
      profile: "sparse_islands",
      density: 0.35,
      rooms: [
        { id: "R1", size: "large", width: 10, height: 10 },
        { id: "R2", size: "small", width: 5, height: 5 },
      ],
      connections: [
        { from: "R1", to: "R2", type: "hallway" },
      ],
      hallways: "Simple spine with two short branches.",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.roomDesign.rooms.length, 2);
  assert.equal(result.value.roomDesign.rooms[0].id, "R1");
  assert.equal(result.value.roomDesign.rooms[0].size, "large");
  assert.equal(result.value.roomDesign.connections.length, 1);
  assert.equal(result.value.roomDesign.connections[0].from, "R1");
  assert.equal(result.value.roomDesign.hallways, "Simple spine with two short branches.");
  assert.equal(result.value.roomDesign.profile, "sparse_islands");
  assert.equal(result.value.roomDesign.density, 0.35);
});

test("capturePromptResponse parses JSON and surfaces errors", async () => {
  const { capturePromptResponse } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const captureOk = capturePromptResponse({
    prompt: "prompt text",
    responseText: JSON.stringify({ dungeonAffinity: "fire", actors: [], rooms: [] }),
  });
  assert.equal(captureOk.errors.length, 0);
  assert.equal(captureOk.summary.dungeonAffinity, "fire");

  const captureBad = capturePromptResponse({ prompt: "prompt text", responseText: "not-json" });
  assert.ok(captureBad.errors.length > 0);
});

test("normalizeSummaryWithOptions accepts phase metadata and stop reasons", async () => {
  const { normalizeSummaryWithOptions } = await import(
    "../../packages/runtime/src/personas/orchestrator/prompt-contract.js"
  );
  const ok = normalizeSummaryWithOptions(
    {
      phase: "layout_only",
      remainingBudgetTokens: 120,
      stop: "done",
      layout: { wallTiles: 1, floorTiles: 1, hallwayTiles: 0 },
    },
    { phase: "layout_only" }
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.value.phase, "layout_only");
  assert.equal(ok.value.remainingBudgetTokens, 120);
  assert.equal(ok.value.stop, "done");

  const invalid = normalizeSummaryWithOptions({ phase: "invalid", layout: {} }, { phase: "layout_only" });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.find((err) => err.field === "phase"));

  const mismatch = normalizeSummaryWithOptions({ phase: "actors_only", actors: [] }, { phase: "layout_only" });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.find((err) => err.code === "phase_mismatch"));
});

test("deriveAllowedOptionsFromCatalog unions catalog entries", async () => {
  const { deriveAllowedOptionsFromCatalog, ALLOWED_AFFINITIES, ALLOWED_MOTIVATIONS } = await import(
    "../../packages/runtime/src/personas/orchestrator/prompt-contract.js"
  );
  const options = deriveAllowedOptionsFromCatalog({
    entries: [
      { id: "actor_new", affinity: "fire", motivation: "attacking" },
      { id: "actor_extra", affinity: "earth", motivation: "defending" },
    ],
  });
  ALLOWED_AFFINITIES.forEach((a) => assert.ok(options.affinities.includes(a)));
  ALLOWED_MOTIVATIONS.forEach((m) => assert.ok(options.motivations.includes(m)));
  assert.ok(options.poolIds.includes("actor_new"));
});
