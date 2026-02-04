const test = require("node:test");
const assert = require("node:assert/strict");

test("buildMenuPrompt includes allowed lists and shape", async () => {
  const { buildMenuPrompt, ALLOWED_AFFINITIES, ALLOWED_AFFINITY_EXPRESSIONS, ALLOWED_MOTIVATIONS } = await import(
    "../../packages/runtime/src/personas/orchestrator/prompt-contract.js"
  );
  const prompt = buildMenuPrompt({ goal: "Test goal", budgetTokens: 800 });
  ALLOWED_AFFINITIES.forEach((affinity) => assert.ok(prompt.includes(affinity)));
  ALLOWED_AFFINITY_EXPRESSIONS.forEach((expression) => assert.ok(prompt.includes(expression)));
  ALLOWED_MOTIVATIONS.forEach((motivation) => assert.ok(prompt.includes(motivation)));
  assert.ok(prompt.includes("dungeon master"));
  assert.ok(prompt.includes("Budget tokens: 800"));
});

test("buildPhasePrompt injects phase metadata", async () => {
  const { buildPhasePrompt } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const prompt = buildPhasePrompt({
    goal: "Phase goal",
    notes: "Phase notes",
    budgetTokens: 500,
    phase: "layout_only",
    remainingBudgetTokens: 120,
    allowedPairsText: "(stationary, fire)",
    context: "Layout tiles: wall 10, floor 20, hallway 5",
    layoutCosts: { wallTiles: 2, floorTiles: 3, hallwayTiles: 4 },
  });
  assert.ok(prompt.includes("Phase: layout_only"));
  assert.ok(prompt.includes("Remaining budget tokens: 120"));
  assert.ok(prompt.includes("Layout tiles: wall 10, floor 20, hallway 5"));
  assert.ok(prompt.includes("Tile costs: wall 2, floor 3, hallway 4 tokens each."));
});

test("normalizeSummary accepts valid summary and rejects invalid fields", async () => {
  const { normalizeSummary } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const valid = normalizeSummary({
    dungeonTheme: "fire",
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
    dungeonTheme: "invalid",
    rooms: [{ motivation: "bad", affinity: "fire", count: 0, affinities: [{ kind: "fire", expression: "bad" }] }],
    actors: [{ motivation: "attacking", affinity: "bad", count: -1, tokenHint: -5, stacks: -1 }],
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.find((e) => e.field === "dungeonTheme"));
  assert.ok(invalid.errors.find((e) => e.field === "rooms[0].motivation"));
  assert.ok(invalid.errors.find((e) => e.field === "actors[0].affinity"));
  assert.ok(invalid.errors.find((e) => e.field === "actors[0].tokenHint"));
  assert.ok(invalid.errors.find((e) => e.field === "actors[0].stacks"));
  assert.ok(invalid.errors.find((e) => e.field === "rooms[0].affinities[0].expression"));
});

test("capturePromptResponse parses JSON and surfaces errors", async () => {
  const { capturePromptResponse } = await import("../../packages/runtime/src/personas/orchestrator/prompt-contract.js");
  const captureOk = capturePromptResponse({
    prompt: "prompt text",
    responseText: JSON.stringify({ dungeonTheme: "fire", actors: [], rooms: [] }),
  });
  assert.equal(captureOk.errors.length, 0);
  assert.equal(captureOk.summary.dungeonTheme, "fire");

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
