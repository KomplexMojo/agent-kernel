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
    context: "Layout tiles: floor 40, walkable total 50",
    affinities: ALLOWED_AFFINITIES,
    affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
    motivations: ALLOWED_MOTIVATIONS,
  });
  ALLOWED_AFFINITIES.forEach((affinity) => assert.ok(prompt.includes(affinity)));
  ALLOWED_AFFINITY_EXPRESSIONS.forEach((expression) => assert.ok(prompt.includes(expression)));
  ALLOWED_MOTIVATIONS.forEach((motivation) => assert.ok(prompt.includes(motivation)));
  assert.ok(prompt.includes("dungeon defender strategist"));
  assert.ok(!prompt.includes("Total budget tokens: 800"));
  assert.ok(prompt.includes("Defender phase budget tokens: 320"));
  assert.ok(prompt.includes("Allowed defender profiles (motivation, affinity): (attacking, fire)"));
  assert.ok(prompt.includes("Phase: actors_only"));
  assert.ok(prompt.includes("Return defenders only; omit rooms and layout."));
  assert.ok(prompt.includes("tokenHint is per defender unit"));
  assert.ok(prompt.includes("Defender viability guardrails"));
  assert.ok(prompt.includes("Attackers start at level entry"));
  assert.ok(prompt.includes("Place stationary defenders at chokepoints"));
  assert.ok(prompt.includes("mana regen"));
  assert.ok(!prompt.includes("Model context window token limit: 16384"));
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
    context: "Layout tiles: floor 20, walkable total 25",
    layoutCosts: { floorTiles: 3, hallwayTiles: 4 },
  });
  assert.ok(prompt.includes("Phase: layout_only"));
  assert.ok(prompt.includes("Constraint: budget tokens available for room design: 120"));
  assert.ok(prompt.includes("Layout tiles: floor 20, walkable total 25"));
  assert.ok(prompt.includes("Assumption: floor tiles cost 3 tokens each."));
  assert.ok(prompt.includes("room design"));
  assert.ok(prompt.includes("rooms connected by hallways"));
  assert.ok(prompt.includes("level entry to level exit journey"));
  assert.ok(prompt.includes("separated enough to require exploration"));
  assert.ok(!prompt.includes("\"diagonal_grid\""));
  assert.ok(!prompt.includes("\"concentric_circles\""));
  assert.ok(!prompt.includes("patternInfillPercent"));
  assert.ok(!prompt.includes("patternLineWidth"));
  assert.ok(!prompt.includes("roomDesign.corridorWidth"));
  assert.ok(prompt.includes("response concise"));
  assert.ok(!prompt.includes("Budget tokens: 500"));
  assert.ok(!prompt.includes("Model context window token limit: 16384"));
  assert.ok(!prompt.includes("Layout phase latency target:"));
  assert.ok(prompt.includes("Keep the response concise"));
  assert.ok(prompt.includes("Return exactly one JSON object, starting with { and ending with }, with no surrounding text."));
  assert.ok(prompt.includes("Response format:"));
  assert.ok(prompt.includes("Example valid response:"));
});

test("buildLlmLevelPromptTemplate encodes room-first response shape", async () => {
  const { buildLlmLevelPromptTemplate } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  const prompt = buildLlmLevelPromptTemplate({
    goal: "Rooms layout goal",
    budgetTokens: 500,
    remainingBudgetTokens: 120,
  });
  assert.ok(prompt.includes("remainingBudgetTokens, layout, roomDesign, missing, stop"));
  assert.ok(prompt.includes("roomDesign.totalRooms and roomDesign.totalFloorTilesUsed must be integers > 0"));
  assert.ok(prompt.includes("roomDesign.rooms must be a non-empty array"));
  assert.ok(prompt.includes("startX"));
  assert.ok(prompt.includes("endY"));
  assert.ok(prompt.includes("\"remainingBudgetTokens\":4200"));
  assert.ok(prompt.includes("\"layout\":{\"floorTiles\":1300}"));
  assert.ok(prompt.includes("\"totalRooms\":4"));
  assert.ok(prompt.includes("\"totalFloorTilesUsed\":1300"));
  assert.ok(!prompt.includes("\"phase\": \"layout_only\""));
  assert.ok(!prompt.includes("\"connections\""));
  assert.ok(!prompt.includes("\"hallwayTiles\": <int>"));
  assert.ok(!prompt.includes("roomDesign.profile"));
  assert.ok(!prompt.includes("sparse_islands"));
  assert.ok(!prompt.includes("clustered_islands"));
  assert.ok(!prompt.includes("<int>"));
  assert.ok(!prompt.includes("<affinity?>"));
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
        setupMode: "hybrid",
        affinities: [
          { kind: "earth", expression: "push", stacks: 1 },
          { kind: "earth", expression: "pull", stacks: 1 },
        ],
        vitals: {
          health: { current: 8, max: 8, regen: 0 },
          mana: { current: 4, max: 4, regen: 1 },
          stamina: { current: 4, max: 4, regen: 1 },
          durability: { current: 2, max: 2, regen: 0 },
        },
      },
    ],
    attackerConfig: {
      setupMode: "user",
      vitalsMax: { health: 8, mana: 5 },
      vitalsRegen: { mana: 2 },
    },
    missing: [],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.value.rooms.length, 1);
  assert.equal(valid.value.actors.length, 1);
  assert.equal(valid.value.attackerConfig.setupMode, "user");
  assert.equal(valid.value.actors[0].setupMode, "hybrid");

  const invalid = normalizeSummary({
    dungeonAffinity: "invalid",
    rooms: [{ motivation: "bad", affinity: "fire", count: 0, affinities: [{ kind: "fire", expression: "bad" }] }],
    actors: [{ motivation: "attacking", affinity: "bad", count: -1, tokenHint: -5, stacks: -1, setupMode: "manual" }],
    attackerConfig: { setupMode: "invalid" },
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.find((e) => e.field === "dungeonAffinity"));
  assert.ok(invalid.errors.find((e) => e.field === "rooms[0].motivation"));
  assert.ok(invalid.errors.find((e) => e.field === "actors[0].affinity"));
  assert.ok(invalid.errors.find((e) => e.field === "actors[0].tokenHint"));
  assert.ok(invalid.errors.find((e) => e.field === "actors[0].stacks"));
  assert.ok(invalid.errors.find((e) => e.field === "actors[0].setupMode"));
  assert.ok(invalid.errors.find((e) => e.field === "attackerConfig.setupMode"));
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
          stamina: { current: 2, max: 2, regen: 1 },
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

test("normalizeSummary requires stamina regen for non-stationary actors", async () => {
  const { normalizeSummaryWithOptions } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const invalid = normalizeSummaryWithOptions({
    dungeonAffinity: "fire",
    phase: "actors_only",
    actors: [
      {
        motivation: "attacking",
        affinity: "fire",
        count: 1,
        vitals: {
          health: { current: 8, max: 8, regen: 0 },
          mana: { current: 2, max: 2, regen: 1 },
          stamina: { current: 2, max: 2, regen: 0 },
          durability: { current: 1, max: 1, regen: 0 },
        },
      },
    ],
    rooms: [],
  }, { phase: "actors_only" });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.find((error) => error.field === "actors[0].vitals.stamina.regen"));

  const stationary = normalizeSummaryWithOptions({
    dungeonAffinity: "fire",
    phase: "actors_only",
    actors: [
      {
        motivation: "stationary",
        affinity: "fire",
        count: 1,
        vitals: {
          health: { current: 8, max: 8, regen: 0 },
          mana: { current: 0, max: 0, regen: 0 },
          stamina: { current: 0, max: 0, regen: 0 },
          durability: { current: 2, max: 2, regen: 0 },
        },
      },
    ],
    rooms: [],
  }, { phase: "actors_only" });
  assert.equal(stationary.ok, true);
});

test("normalizeSummary defaults attacker config mode when omitted", async () => {
  const { normalizeSummary } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const result = normalizeSummary({
    dungeonAffinity: "fire",
    actors: [],
    rooms: [],
    attackerConfig: {
      vitalsRegen: { mana: 1 },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.attackerConfig.setupMode, "auto");
  assert.equal(result.value.attackerConfig.vitalsRegen.mana, 1);
});

test("normalizeSummary accepts attackerConfigs and derives attackerCount", async () => {
  const { normalizeSummary } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const result = normalizeSummary({
    dungeonAffinity: "fire",
    actors: [],
    rooms: [],
    attackerConfigs: [
      { setupMode: "user", vitalsRegen: { mana: 1 } },
      { setupMode: "hybrid", vitalsRegen: { mana: 2 } },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.attackerCount, 2);
  assert.equal(result.value.attackerConfigs.length, 2);
  assert.equal(result.value.attackerConfig.setupMode, "user");
});

test("normalizeSummary preserves attacker affinity configuration", async () => {
  const { normalizeSummary } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const result = normalizeSummary({
    dungeonAffinity: "fire",
    actors: [],
    rooms: [],
    attackerConfig: {
      setupMode: "user",
      vitalsMax: { mana: 100 },
      vitalsRegen: { mana: 10 },
      affinities: {
        corrode: ["push", "pull", "emit"],
      },
      affinityStacks: {
        corrode: 5,
      },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.attackerConfig.affinities, { corrode: ["push", "pull", "emit"] });
  assert.deepEqual(result.value.attackerConfig.affinityStacks, { corrode: 5 });
});

test("normalizeSummary validates attacker affinity configuration", async () => {
  const { normalizeSummary } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const invalid = normalizeSummary({
    dungeonAffinity: "fire",
    actors: [],
    rooms: [],
    attackerConfig: {
      setupMode: "user",
      affinities: {
        lava: ["push"],
      },
      affinityStacks: {
        fire: 0,
      },
    },
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.find((entry) => entry.field === "attackerConfig.affinities.lava" && entry.code === "invalid_affinity"));
  assert.ok(invalid.errors.find((entry) => entry.field === "attackerConfig.affinityStacks.fire" && entry.code === "invalid_positive_int"));
});

test("normalizeSummary validates attackerCount against attackerConfigs length", async () => {
  const { normalizeSummary } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const invalid = normalizeSummary({
    dungeonAffinity: "fire",
    actors: [],
    rooms: [],
    attackerCount: 3,
    attackerConfigs: [
      { setupMode: "user", vitalsRegen: { mana: 1 } },
      { setupMode: "hybrid", vitalsRegen: { mana: 2 } },
    ],
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.find((entry) => entry.field === "attackerConfigs" && entry.code === "attacker_count_mismatch"));
});

test("normalizeSummary preserves room design details when provided", async () => {
  const { normalizeSummary } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const result = normalizeSummary({
    dungeonAffinity: "fire",
    rooms: [],
    actors: [],
    roomDesign: {
      totalRooms: 6,
      totalFloorTilesUsed: 180,
      entryRoomId: "R1",
      exitRoomId: "R2",
      corridorWidth: 2,
      roomCount: 6,
      roomMinSize: 3,
      roomMaxSize: 10,
      pattern: "grid",
      patternSpacing: 6,
      patternLineWidth: 1,
      patternInfillPercent: 60,
      patternGapEvery: 4,
      patternInset: 1,
      rooms: [
        { id: "R1", size: "large", startX: 2, startY: 3, endX: 11, endY: 12 },
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
  assert.equal(result.value.roomDesign.rooms[0].startX, 2);
  assert.equal(result.value.roomDesign.rooms[0].endY, 12);
  assert.equal(result.value.roomDesign.rooms[0].width, 10);
  assert.equal(result.value.roomDesign.rooms[0].height, 10);
  assert.equal(result.value.roomDesign.connections.length, 1);
  assert.equal(result.value.roomDesign.connections[0].from, "R1");
  assert.equal(result.value.roomDesign.hallways, "Simple spine with two short branches.");
  assert.equal(result.value.roomDesign.totalRooms, 6);
  assert.equal(result.value.roomDesign.totalFloorTilesUsed, 180);
  assert.equal(result.value.roomDesign.entryRoomId, "R1");
  assert.equal(result.value.roomDesign.exitRoomId, "R2");
  assert.equal(result.value.roomDesign.corridorWidth, 2);
  assert.equal(result.value.roomDesign.roomCount, 6);
  assert.equal(result.value.roomDesign.roomMinSize, 3);
  assert.equal(result.value.roomDesign.roomMaxSize, 10);
  assert.equal(result.value.roomDesign.pattern, "grid");
  assert.equal(result.value.roomDesign.patternSpacing, 6);
  assert.equal(result.value.roomDesign.patternLineWidth, 1);
  assert.equal(result.value.roomDesign.patternInfillPercent, 60);
  assert.equal(result.value.roomDesign.patternGapEvery, 4);
  assert.equal(result.value.roomDesign.patternInset, 1);
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
      layout: { floorTiles: 1, hallwayTiles: 0 },
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

test("buildLlmRepairPromptTemplate omits allowed lists when not provided", async () => {
  const { buildLlmRepairPromptTemplate } = await import(
    "../../packages/runtime/src/contracts/domain-constants.js"
  );
  const prompt = buildLlmRepairPromptTemplate({
    basePrompt: "Base prompt",
    errors: [{ field: "layout.floorTiles", code: "invalid_tile_count" }],
    responseText: "{\"phase\":\"layout_only\"}",
    phaseRequirement: "Provide layout tile counts with non-negative integers (floorTiles).",
    extraLines: ["Use integers only for floorTiles; omit optional fields."],
  });
  assert.ok(!prompt.includes("Allowed affinities:"));
  assert.ok(!prompt.includes("Allowed expressions:"));
  assert.ok(!prompt.includes("Allowed motivations:"));
});
