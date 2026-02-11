import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDefaultStrategicGuidancePrompt, wireDesignGuidance } from "../../packages/ui-web/src/design-guidance.js";
import { mergeSummaryWithActorSet, wireDesignView } from "../../packages/ui-web/src/views/design-view.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const htmlPath = path.resolve(root, "packages", "ui-web", "index.html");
const catalogFixturePath = path.resolve(root, "tests", "fixtures", "pool", "catalog-basic.json");
const catalogFixture = JSON.parse(fs.readFileSync(catalogFixturePath, "utf8"));

function readHtml() {
  return fs.readFileSync(htmlPath, "utf8");
}

function makeInput(value = "") {
  const handlers = {};
  return {
    value,
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    trigger(event) {
      handlers[event]?.();
    },
  };
}

function makeButton() {
  const handlers = {};
  return {
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    click() {
      handlers.click?.();
    },
  };
}

function makeRoot(elements) {
  return {
    querySelector(selector) {
      return elements[selector] || null;
    },
  };
}

test("design view includes guidance and actor set elements", () => {
  const html = readHtml();
  assert.match(html, /Prompt Template/);
  assert.doesNotMatch(html, /Strategic Guidance/);
  assert.match(html, /id="design-guidance-input"/);
  assert.match(html, /id="design-guidance-generate"/);
  assert.match(html, /id="design-brief-output"/);
  assert.match(html, /id="design-level-output"/);
  assert.match(html, /id="prompt-token-budget"/);
  assert.match(html, /id="prompt-think-time"/);
  assert.match(html, /id="prompt-llm-tokens"/);
  assert.match(html, /id="prompt-level-budget"/);
  assert.match(html, /id="prompt-level-affinities"/);
  assert.match(html, /id="prompt-attacker-budget"/);
  assert.match(html, /id="prompt-attacker-affinities"/);
  assert.match(html, /id="prompt-defender-affinities"/);
  assert.match(html, /id="attacker-vitals-health-max"/);
  assert.match(html, /id="attacker-vitals-mana-max"/);
  assert.match(html, /id="design-actor-set-json"/);
  assert.match(html, /id="design-actor-set-preview"/);
  assert.match(html, /id="design-build-and-load"/);
  assert.match(html, /id="design-build-status"/);
  assert.doesNotMatch(html, /id="design-guidance-model"/);
  assert.doesNotMatch(html, /id="design-guidance-base-url"/);
  assert.doesNotMatch(html, /id="adapter-llm-url"/);
  assert.doesNotMatch(html, /id="design-guidance-mode"/);
  assert.doesNotMatch(html, /id="design-guidance-fixture"/);
  assert.doesNotMatch(html, /id="llm-step-summary"/);
  assert.doesNotMatch(html, /id="pool-run"/);
  assert.doesNotMatch(html, /id="seed-input"/);
  assert.doesNotMatch(html, /id="vital-health-current"/);
  assert.doesNotMatch(html, /id="map-select"/);
  assert.doesNotMatch(html, /id="actor-name"/);
  assert.doesNotMatch(html, /id="actor-id"/);
  assert.doesNotMatch(html, /id="fixture-select"/);
  assert.doesNotMatch(html, /id="pool-load-fixture"/);
});

test("design guidance generates brief and actor set", async () => {
  const guidanceInput = makeInput("Fire temple raid with two defenders and a 600 token budget.");
  const briefOutput = { textContent: "" };
  const levelDesignOutput = { textContent: "" };
  const actorSetInput = makeInput("");
  const actorSetPreview = { textContent: "" };
  const statusEl = { textContent: "", style: {} };
  const generateButton = makeButton();
  const captures = [];

  const fixtureResponse = {
    responses: [
      {
        response: JSON.stringify({
          phase: "layout_only",
          remainingBudgetTokens: 240,
          layout: { wallTiles: 12, floorTiles: 28, hallwayTiles: 6 },
          missing: [],
        }),
      },
      {
        response: JSON.stringify({
          phase: "actors_only",
          remainingBudgetTokens: 100,
          actors: [{ motivation: "attacking", affinity: "fire", count: 2 }],
          missing: [],
          stop: "done",
        }),
      },
    ],
  };

  const guidance = wireDesignGuidance({
    elements: {
      guidanceInput,
      modeSelect: makeInput("fixture"),
      modelInput: makeInput("fixture"),
      baseUrlInput: makeInput("http://localhost:11434"),
      generateButton,
      fixtureButton: makeButton(),
      statusEl,
      briefOutput,
      levelDesignOutput,
      actorSetInput,
      actorSetPreview,
      applyActorSetButton: makeButton(),
    },
    llmConfig: { fixtureResponse, catalog: catalogFixture },
    onLlmCapture: ({ captures: newCaptures }) => {
      captures.push(...newCaptures);
    },
  });

  await guidance.generateBrief({ useFixture: true });

  assert.match(briefOutput.textContent, /Dungeon Affinity: fire/);
  assert.match(briefOutput.textContent, /Budget: 600 tokens/);
  assert.match(briefOutput.textContent, /Layout Tiles: wall 12, floor 28, hallway 6/);
  assert.match(briefOutput.textContent, /Level Spend: spent .*total remaining .*actor pool/);
  assert.match(briefOutput.textContent, /Actor Spend: spent/);
  assert.match(briefOutput.textContent, /Actors Total: 2/);
  assert.match(briefOutput.textContent, /Actor Profiles: 1/);
  assert.match(briefOutput.textContent, /Guidance: Fire temple raid/);
  assert.match(levelDesignOutput.textContent, /Room Design: none\./);
  assert.match(actorSetInput.value, /actor_attacking_1/);
  assert.match(actorSetInput.value, /"vitals"/);
  assert.match(actorSetInput.value, /"kind": "fire"/);
  assert.match(actorSetInput.value, /"expression": "push"/);
  assert.match(actorSetPreview.textContent, /actor_attacking_1/);
  assert.equal(captures.length, 2);
  assert.equal(captures[0].schema, "agent-kernel/CapturedInputArtifact");
  assert.equal(captures[1].schema, "agent-kernel/CapturedInputArtifact");
  assert.equal(captures[0].source.adapter, "llm");
  assert.equal(captures[1].source.adapter, "llm");
  assert.equal(captures[0].payload.phase, "layout_only");
  assert.equal(captures[1].payload.phase, "actors_only");
  assert.match(captures[0].payload.prompt, /Phase: layout_only/);
  assert.match(captures[1].payload.prompt, /Phase: actors_only/);
});

test("design guidance normalizes theme text to dungeon affinity", async () => {
  const guidanceInput = makeInput("A water based dungeon with a 1000 token budget.");
  const briefOutput = { textContent: "" };
  const actorSetInput = makeInput("");
  const actorSetPreview = { textContent: "" };
  const statusEl = { textContent: "", style: {} };

  const responses = [
    {
      phase: "layout_only",
      remainingBudgetTokens: 400,
      layout: { wallTiles: 10, floorTiles: 20, hallwayTiles: 10 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 200,
      actors: [{ motivation: "defending", affinity: "water", count: 5 }],
      missing: [],
      stop: "done",
    },
  ];
  let callIndex = 0;
  const guidance = wireDesignGuidance({
    elements: {
      guidanceInput,
      modelInput: makeInput("phi4"),
      baseUrlInput: makeInput("http://localhost:11434"),
      generateButton: makeButton(),
      statusEl,
      briefOutput,
      actorSetInput,
      actorSetPreview,
      applyActorSetButton: makeButton(),
    },
    llmConfig: {
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          response: JSON.stringify(responses[Math.min(callIndex++, responses.length - 1)]),
        }),
      }),
    },
  });

  await guidance.generateBrief();

  assert.match(briefOutput.textContent, /Dungeon Affinity: water/);
  assert.match(briefOutput.textContent, /Actors Total: 5/);
  assert.match(briefOutput.textContent, /Layout Tiles: wall 10, floor 20, hallway 10/);
  assert.match(actorSetInput.value, /"affinity": "water"/);
  assert.match(actorSetInput.value, /"kind": "water"/);
  assert.match(actorSetInput.value, /"vitals"/);
  assert.equal(guidance.getSummary()?.dungeonAffinity, "water");
});

test("design guidance auto-fits over-budget layout responses", async () => {
  const guidanceInput = makeInput("Water dungeon with 1000 token budget.");
  const briefOutput = { textContent: "" };
  const actorSetInput = makeInput("");
  const actorSetPreview = { textContent: "" };
  const statusEl = { textContent: "", style: {} };

  const guidance = wireDesignGuidance({
    elements: {
      guidanceInput,
      modelInput: makeInput("phi4"),
      baseUrlInput: makeInput("http://localhost:11434"),
      generateButton: makeButton(),
      statusEl,
      briefOutput,
      actorSetInput,
      actorSetPreview,
      applyActorSetButton: makeButton(),
    },
    llmConfig: {
      catalog: catalogFixture,
      fixtureResponse: {
        responses: [
          {
            response: JSON.stringify({
              phase: "layout_only",
              remainingBudgetTokens: 10,
              layout: { wallTiles: 900, floorTiles: 900, hallwayTiles: 900 },
              missing: [],
            }),
          },
          {
            response: JSON.stringify({
              phase: "actors_only",
              remainingBudgetTokens: 50,
              actors: [{ motivation: "patrolling", affinity: "wind", count: 1 }],
              missing: [],
              stop: "done",
            }),
          },
        ],
      },
    },
  });

  await guidance.generateBrief({ useFixture: true });

  assert.doesNotMatch(statusEl.textContent, /Generation failed/);
  assert.match(statusEl.textContent, /layout \+ defender configuration/);
  assert.match(briefOutput.textContent, /Level Spend: spent .*total remaining .*actor pool/);
  assert.match(briefOutput.textContent, /Actor Spend: spent/);
  assert.match(briefOutput.textContent, /Actors Total: 1/);
  assert.match(actorSetInput.value, /actor_patrolling_1/);
});

test("design guidance defaults to live mode when no mode toggle exists", async () => {
  const guidanceInput = makeInput("Water dungeon, 1000 token budget.");
  const briefOutput = { textContent: "" };
  const actorSetInput = makeInput("");
  const actorSetPreview = { textContent: "" };
  const statusEl = { textContent: "", style: {} };

  let capturedUrl = "";
  const capturedBodies = [];
  const responses = [
    {
      phase: "layout_only",
      remainingBudgetTokens: 400,
      layout: { wallTiles: 14, floorTiles: 26, hallwayTiles: 10 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 220,
      actors: [{ motivation: "defending", affinity: "water", count: 3 }],
      missing: [],
      stop: "done",
    },
  ];
  let responseIndex = 0;
  const fetchFn = async (url, options) => {
    capturedUrl = url;
    capturedBodies.push(options?.body || "");
    return {
      ok: true,
      json: async () => ({
        response: JSON.stringify(responses[Math.min(responseIndex++, responses.length - 1)]),
      }),
    };
  };

  const guidance = wireDesignGuidance({
    elements: {
      guidanceInput,
      modelInput: makeInput("phi4"),
      baseUrlInput: makeInput("http://localhost:11434"),
      generateButton: makeButton(),
      statusEl,
      briefOutput,
      actorSetInput,
      actorSetPreview,
      applyActorSetButton: makeButton(),
    },
    llmConfig: { fetchFn },
  });

  await guidance.generateBrief();

  assert.match(capturedUrl, /\/api\/generate$/);
  assert.ok(capturedBodies.length >= 2);
  assert.ok(capturedBodies.some((body) => /"model":"phi4"/.test(body)));
  assert.ok(capturedBodies.some((body) => /Model context window token limit: 16384/.test(body)));
  assert.ok(capturedBodies.some((body) => /Phase: layout_only/.test(body)));
  assert.ok(capturedBodies.some((body) => /Phase: actors_only/.test(body)));
  assert.ok(capturedBodies.some((body) => /"format":"json"/.test(body)));
  assert.ok(capturedBodies.some((body) => /"num_predict":160/.test(body)));
  assert.ok(capturedBodies.some((body) => /"num_predict":320/.test(body)));
  assert.ok(capturedBodies.some((body) => /"num_ctx":16384/.test(body)));
  assert.match(briefOutput.textContent, /Dungeon Affinity: water/);
  assert.match(statusEl.textContent, /layout \+ defender configuration/);
});

test("design guidance auto-populates default level and defender prompt templates", () => {
  const guidanceInput = makeInput("");
  const guidance = wireDesignGuidance({
    elements: {
      guidanceInput,
      modelInput: makeInput("phi4"),
      baseUrlInput: makeInput("http://localhost:11434"),
      generateButton: makeButton(),
      statusEl: { textContent: "", style: {} },
      briefOutput: { textContent: "" },
      actorSetInput: makeInput(""),
      actorSetPreview: { textContent: "" },
      applyActorSetButton: makeButton(),
    },
  });

  assert.ok(guidance);
  assert.doesNotMatch(guidanceInput.value, /Intent and constraints:/);
  assert.doesNotMatch(guidanceInput.value, /=== Strategic Prompt Template ===/);
  assert.match(guidanceInput.value, /=== Level Prompt Template ===/);
  assert.match(guidanceInput.value, /=== Defender Prompt Template ===/);
  assert.doesNotMatch(guidanceInput.value, /contextWindowTokens:/);
  assert.match(guidanceInput.value, /Model context window token limit: 16384/);
  assert.match(guidanceInput.value, /Goal: A fire affinity dungeon with 1000 token budget\./);
  assert.match(guidanceInput.value, /Goal: Create dungeon defenders for a fire themed dungeon\./);
  assert.match(guidanceInput.value, /Affinities: fire/);
  assert.match(guidanceInput.value, /Affinity expressions: push, pull, emit/);
  assert.match(guidanceInput.value, /Motivations: random, stationary, exploring, attacking, defending, patrolling, reflexive, goal_oriented, strategy_focused/);
  assert.match(guidanceInput.value, /Phase: layout_only/);
  assert.match(guidanceInput.value, /Phase: actors_only/);
  assert.match(guidanceInput.value, /Tile costs: wall 1, floor 1, hallway 1 tokens each\./);
  assert.match(guidanceInput.value, /Budget tokens: 1000/);
  assert.match(guidanceInput.value, /Remaining budget tokens: 1000/);
  assert.match(guidanceInput.value, /Total budget tokens: 1000/);
  assert.match(guidanceInput.value, /Defender phase budget tokens: 1000/);
  assert.equal(guidanceInput.value, buildDefaultStrategicGuidancePrompt());
});

test("design guidance formats multi-affinity goals in the prompt template", () => {
  const prompt = buildDefaultStrategicGuidancePrompt({
    budgetTokens: 10000,
    promptParams: { levelAffinities: ["water"], defenderAffinities: ["fire", "wind"] },
  });

  assert.match(prompt, /Goal: A water affinity dungeon with 10000 token budget\./);
  assert.match(prompt, /Goal: Create dungeon defenders for a fire and wind themed dungeon\./);
  assert.match(prompt, /Affinities: fire, wind/);
});

test("mergeSummaryWithActorSet maps editable entries into rooms and actors", () => {
  const summary = {
    dungeonAffinity: "water",
    budgetTokens: 1000,
    actors: [],
    rooms: [],
  };
  const actorSet = [
    {
      source: "actor",
      role: "attacking",
      affinity: "water",
      count: 2,
      tokenHint: 250,
      affinities: [{ kind: "water", expression: "emit", stacks: 2 }],
      vitals: {
        health: { current: 3, max: 4, regen: 0 },
        mana: { current: 1, max: 1, regen: 0 },
        stamina: { current: 2, max: 2, regen: 1 },
        durability: { current: 1, max: 1, regen: 0 },
      },
    },
    { source: "room", role: "stationary", affinity: "water", count: 1 },
  ];

  const merged = mergeSummaryWithActorSet(summary, actorSet);

  assert.equal(merged.dungeonAffinity, "water");
  assert.equal(merged.budgetTokens, 1000);
  assert.deepEqual(merged.actors, [
    {
      motivation: "attacking",
      affinity: "water",
      count: 2,
      tokenHint: 250,
      affinities: [{ kind: "water", expression: "emit", stacks: 2 }],
      vitals: {
        health: { current: 3, max: 4, regen: 0 },
        mana: { current: 1, max: 1, regen: 0 },
        stamina: { current: 2, max: 2, regen: 1 },
        durability: { current: 1, max: 1, regen: 0 },
      },
    },
  ]);
  assert.deepEqual(merged.rooms, [
    { motivation: "stationary", affinity: "water", count: 1, affinities: [{ kind: "water", expression: "push", stacks: 1 }] },
  ]);
});

test("design view builds and loads simulation from current brief", async () => {
  const elements = {
    "#design-guidance-input": makeInput("Fire breach with one guard room and a 600 token budget."),
    "#design-guidance-generate": makeButton(),
    "#design-guidance-status": { textContent: "", style: {} },
    "#design-brief-output": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
  };

  const root = makeRoot(elements);
  const calls = [];
  const llmResponses = [
    {
      phase: "layout_only",
      remainingBudgetTokens: 260,
      layout: { wallTiles: 16, floorTiles: 24, hallwayTiles: 8 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 120,
      actors: [{ motivation: "attacking", affinity: "fire", count: 2 }],
      missing: [],
      stop: "done",
    },
  ];
  let llmIndex = 0;

  const view = wireDesignView({
    root,
    llmConfig: {
      catalog: catalogFixture,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ response: JSON.stringify(llmResponses[Math.min(llmIndex++, llmResponses.length - 1)]) }),
      }),
    },
    onSendBuildSpec: ({ specText }) => {
      calls.push("send");
      assert.match(specText, /"schema": "agent-kernel\/BuildSpec"/);
    },
    onRunBuild: async () => {
      calls.push("build");
      return { ok: true };
    },
    onLoadBundle: async () => {
      calls.push("bundle");
      return true;
    },
    onRunBundle: async () => {
      calls.push("run");
      return true;
    },
    onOpenSimulation: () => {
      calls.push("open");
    },
  });

  await view.generateBrief();
  await view.buildAndLoad();

  assert.deepEqual(calls, ["send", "build", "bundle", "run", "open"]);
  assert.match(elements["#design-build-status"].textContent, /Build complete/);
});

test("design view publishes build spec preview when brief is generated", async () => {
  const elements = {
    "#design-guidance-input": makeInput("Water breach with two patrols and a 700 token budget."),
    "#design-guidance-generate": makeButton(),
    "#design-guidance-status": { textContent: "", style: {} },
    "#design-brief-output": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
  };

  const root = makeRoot(elements);
  const sentSpecs = [];
  const llmResponses = [
    {
      phase: "layout_only",
      remainingBudgetTokens: 300,
      layout: { wallTiles: 10, floorTiles: 20, hallwayTiles: 10 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 140,
      actors: [{ motivation: "patrolling", affinity: "wind", count: 2 }],
      missing: [],
      stop: "done",
    },
  ];
  let llmIndex = 0;

  const view = wireDesignView({
    root,
    llmConfig: {
      catalog: catalogFixture,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ response: JSON.stringify(llmResponses[Math.min(llmIndex++, llmResponses.length - 1)]) }),
      }),
    },
    onSendBuildSpec: ({ specText, source, resetBuildOutput }) => {
      sentSpecs.push({ specText, source, resetBuildOutput });
    },
  });

  await view.generateBrief();

  assert.equal(sentSpecs.length, 1);
  assert.match(sentSpecs[0].specText, /"schema": "agent-kernel\/BuildSpec"/);
  assert.equal(sentSpecs[0].source, "design-preview");
  assert.equal(sentSpecs[0].resetBuildOutput, true);
});
