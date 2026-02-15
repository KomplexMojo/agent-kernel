import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDefaultStrategicGuidancePrompt,
  buildDesignBrief,
  wireDesignGuidance,
} from "../../packages/ui-web/src/design-guidance.js";
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

function makeButton(textContent = "") {
  const handlers = {};
  const attributes = {};
  return {
    textContent,
    disabled: false,
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete attributes[name];
    },
    getAttribute(name) {
      return attributes[name];
    },
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    click() {
      if (this.disabled) return;
      handlers.click?.();
    },
  };
}

function makeStatusElement() {
  const history = [];
  let textContent = "";
  return {
    style: {},
    history,
    get textContent() {
      return textContent;
    },
    set textContent(value) {
      textContent = String(value ?? "");
      history.push(textContent);
    },
  };
}

function makeRenderableLevelOutput() {
  const children = [];
  const doc = {
    createElement(tag) {
      if (tag === "canvas") {
        return {
          className: "",
          width: 0,
          height: 0,
          setAttribute() {},
          getContext(type) {
            if (type !== "2d") return null;
            return {
              imageSmoothingEnabled: false,
              fillStyle: "",
              fillRect() {},
            };
          },
        };
      }
      return {
        className: "",
        textContent: "",
        append(...items) {
          this.items = items;
        },
      };
    },
  };
  return {
    ownerDocument: doc,
    textContent: "",
    get childrenCount() {
      return children.length;
    },
    replaceChildren(...items) {
      children.splice(0, children.length, ...items);
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

async function waitFor(check, { timeoutMs = 10000, intervalMs = 20, label = "condition" } = {}) {
  const startedAt = Date.now();
  while (true) {
    if (check()) return;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function makeAmbulatoryVitals() {
  return {
    health: { current: 8, max: 8, regen: 0 },
    mana: { current: 4, max: 4, regen: 1 },
    stamina: { current: 4, max: 4, regen: 1 },
    durability: { current: 2, max: 2, regen: 0 },
  };
}

test("design view includes guidance and actor set elements", () => {
  const html = readHtml();
  const diagnosticsPanelIndex = html.indexOf('data-tab-panel="diagnostics"');
  const benchmarkButtonIndex = html.indexOf('id="design-run-level-benchmark"');
  assert.ok(diagnosticsPanelIndex >= 0, "expected diagnostics panel to exist");
  assert.ok(benchmarkButtonIndex > diagnosticsPanelIndex, "expected benchmark controls under diagnostics");
  assert.match(html, /Design Workflow/);
  assert.doesNotMatch(html, /Strategic Guidance/);
  assert.match(html, /id="design-guidance-input"/);
  assert.match(html, /id="design-guidance-generate"/);
  assert.match(html, /id="design-level-prompt-template"/);
  assert.match(html, /id="design-attacker-prompt-template"/);
  assert.match(html, /id="design-defender-prompt-template"/);
  assert.match(html, /id="design-run-level-prompt"/);
  assert.match(html, /id="design-run-attacker-prompt"/);
  assert.match(html, /id="design-run-defender-prompt"/);
  assert.match(html, /id="design-level-token-indicator"/);
  assert.match(html, /id="design-attacker-token-indicator"/);
  assert.match(html, /id="design-defender-token-indicator"/);
  assert.match(html, /id="design-simulation-token-indicator"/);
  assert.match(html, /id="design-brief-output"/);
  assert.match(html, /id="design-level-output"/);
  assert.match(html, /id="design-attacker-output"/);
  assert.match(html, /id="prompt-token-budget"/);
  assert.match(html, /id="prompt-max-token-budget"/);
  assert.match(html, /id="prompt-think-time"/);
  assert.match(html, /id="prompt-llm-tokens"/);
  assert.match(html, /id="prompt-layout-profile"/);
  assert.match(html, /id="prompt-layout-allocation-percent"/);
  assert.match(html, /id="prompt-defender-allocation-percent"/);
  assert.match(html, /id="prompt-attacker-allocation-percent"/);
  assert.match(html, /id="prompt-budget-allocation-summary"/);
  assert.match(html, /id="design-run-level-benchmark"/);
  assert.match(html, /id="benchmark-max-token-budget"[^>]*value="2000000"/);
  assert.match(html, /id="benchmark-sample-runs"/);
  assert.match(html, /id="design-level-benchmark-output"/);
  assert.match(html, /Level Configuration/);
  assert.match(html, /Attacker Configuration/);
  assert.match(html, /Defender Configuration/);
  assert.match(html, /Level Affinities \(count\)/);
  assert.match(html, /Defender Affinities \(count\)/);
  assert.match(html, /Attacker Affinities \(count\)/);
  assert.doesNotMatch(html, /id="prompt-level-budget"/);
  assert.match(html, /id="prompt-level-affinities"/);
  assert.doesNotMatch(html, /id="prompt-attacker-budget"/);
  assert.match(html, /id="prompt-attacker-setup-mode"/);
  assert.match(html, /id="prompt-attacker-affinities"/);
  assert.match(html, /id="prompt-defender-affinities"/);
  assert.match(html, /id="attacker-vitals-health-max"/);
  assert.match(html, /id="attacker-vitals-mana-max"/);
  assert.match(html, /id="attacker-vitals-health-regen"/);
  assert.match(html, /id="attacker-vitals-mana-regen"/);
  assert.match(html, /id="design-spend-ledger-output"/);
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
          layout: { floorTiles: 28, hallwayTiles: 6 },
          missing: [],
        }),
      },
      {
        response: JSON.stringify({
          phase: "actors_only",
          remainingBudgetTokens: 100,
          actors: [{ motivation: "attacking", affinity: "fire", count: 2, vitals: makeAmbulatoryVitals() }],
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
  assert.match(briefOutput.textContent, /Layout Tiles: floor 28, hallway 6/);
  assert.match(briefOutput.textContent, /Level Spend: spent .*total remaining .*actor pool/);
  assert.match(briefOutput.textContent, /Actor Spend: spent/);
  assert.match(briefOutput.textContent, /Actors Total: 2/);
  assert.match(briefOutput.textContent, /Actor Profiles: 1/);
  assert.match(briefOutput.textContent, /Guidance: Fire temple raid/);
  assert.match(levelDesignOutput.textContent, /Level preview ready:/);
  assert.match(actorSetInput.value, /actor_attacking_1/);
  assert.match(actorSetInput.value, /"vitals"/);
  assert.match(actorSetInput.value, /"kind": "fire"/);
  assert.match(actorSetInput.value, /"expression": "push"/);
  assert.match(actorSetInput.value, /"stacks": 1/);
  assert.match(actorSetPreview.textContent, /actor_attacking_1/);
  assert.match(actorSetPreview.textContent, /affinities fire:pushx1/);
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

test("design guidance auto-fits oversized walkable targets without failing generation", async () => {
  const guidanceInput = makeInput("Oversized run with a 20000 token budget.");
  const briefOutput = { textContent: "" };
  const levelDesignOutput = { textContent: "" };
  const actorSetInput = makeInput("");
  const actorSetPreview = { textContent: "" };
  const statusEl = { textContent: "", style: {} };

  const fixtureResponse = {
    responses: [
      {
        response: JSON.stringify({
          phase: "layout_only",
          remainingBudgetTokens: 5000,
          layout: { floorTiles: 6001, hallwayTiles: 0 },
          missing: [],
        }),
      },
      {
        response: JSON.stringify({
          phase: "actors_only",
          remainingBudgetTokens: 2000,
          actors: [{ motivation: "defending", affinity: "fire", count: 1, vitals: makeAmbulatoryVitals() }],
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
      generateButton: makeButton(),
      fixtureButton: makeButton(),
      statusEl,
      briefOutput,
      levelDesignOutput,
      actorSetInput,
      actorSetPreview,
      applyActorSetButton: makeButton(),
    },
    llmConfig: { fixtureResponse, catalog: catalogFixture },
  });

  await guidance.generateBrief({ useFixture: true });

  const summary = guidance.getSummary();
  const walkableTiles = (summary?.layout?.floorTiles || 0) + (summary?.layout?.hallwayTiles || 0);
  assert.match(statusEl.textContent, /Design brief ready/);
  assert.ok(walkableTiles > 0);
  assert.equal(walkableTiles, 6001);
  assert.match(levelDesignOutput.textContent, /Level preview ready:/);
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
      layout: { floorTiles: 20, hallwayTiles: 10 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 200,
      actors: [{ motivation: "defending", affinity: "water", count: 5, vitals: makeAmbulatoryVitals() }],
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
  assert.match(briefOutput.textContent, /Layout Tiles: floor 20, hallway 10/);
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
              layout: { floorTiles: 900, hallwayTiles: 900 },
              missing: [],
            }),
          },
          {
            response: JSON.stringify({
              phase: "actors_only",
              remainingBudgetTokens: 50,
              actors: [{ motivation: "patrolling", affinity: "wind", count: 1, vitals: makeAmbulatoryVitals() }],
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
      layout: { floorTiles: 26, hallwayTiles: 10 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 220,
      actors: [{ motivation: "defending", affinity: "water", count: 3, vitals: makeAmbulatoryVitals() }],
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

test("design guidance auto-populates default level, attacker, and defender prompt templates", () => {
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
  assert.match(guidanceInput.value, /=== Attacker Prompt Template ===/);
  assert.match(guidanceInput.value, /=== Defender Prompt Template ===/);
  assert.doesNotMatch(guidanceInput.value, /contextWindowTokens:/);
  assert.match(guidanceInput.value, /Model context window token limit: 16384/);
  assert.match(guidanceInput.value, /Goal: Design a fire affinity dungeon layout\./);
  assert.match(guidanceInput.value, /Goal: Configure attacker setup for a fire themed dungeon\./);
  assert.match(guidanceInput.value, /Goal: Create dungeon defenders for a fire themed dungeon\./);
  assert.match(guidanceInput.value, /Affinities: fire/);
  assert.match(guidanceInput.value, /Affinity expressions: push, pull, emit/);
  assert.match(guidanceInput.value, /Motivations: random, stationary, exploring, attacking, defending, patrolling, reflexive, goal_oriented, strategy_focused/);
  assert.match(guidanceInput.value, /Phase: layout_only/);
  assert.match(guidanceInput.value, /Phase: actors_only/);
  assert.match(guidanceInput.value, /Allowed setup modes: auto/);
  assert.match(guidanceInput.value, /Include roomDesign\.profile as one of:/);
  assert.match(guidanceInput.value, /Attacker phase budget tokens: 1000/);
  assert.match(guidanceInput.value, /Tile costs: floor 1, hallway 1 tokens each\./);
  assert.match(guidanceInput.value, /Budget tokens: 1000/);
  assert.match(guidanceInput.value, /Remaining budget tokens: 1000/);
  assert.match(guidanceInput.value, /Total budget tokens: 1000/);
  assert.match(guidanceInput.value, /Defender phase budget tokens: 1000/);
  assert.doesNotMatch(guidanceInput.value, /Max available budget tokens:/);
  assert.doesNotMatch(guidanceInput.value, /Budget pools:/);
  assert.doesNotMatch(guidanceInput.value, /Level budget tokens:/);
  assert.equal(guidanceInput.value, buildDefaultStrategicGuidancePrompt());
});

test("design guidance formats multi-affinity goals in the prompt template", () => {
  const prompt = buildDefaultStrategicGuidancePrompt({
    budgetTokens: 10000,
    promptParams: { levelAffinities: ["water"], defenderAffinities: ["fire", "wind"] },
  });

  assert.match(prompt, /Goal: Design a water affinity dungeon layout\./);
  assert.match(prompt, /Goal: Create dungeon defenders for a fire and wind themed dungeon\./);
  assert.match(prompt, /Affinities: fire, wind/);
});

test("design brief affinity line reflects selected multi-affinity level setup", () => {
  const brief = buildDesignBrief(
    {
      dungeonAffinity: "fire",
      budgetTokens: 1000,
      layout: { floorTiles: 10, hallwayTiles: 5 },
      actors: [],
      missing: [],
    },
    "Design a fire and corrode affinity dungeon layout.",
    { promptParams: { levelAffinities: ["fire", "corrode"] } },
  );

  assert.match(brief, /Dungeon Affinity: fire and corrode/);
});

test("design guidance prompt template includes attacker setup and regen context", () => {
  const prompt = buildDefaultStrategicGuidancePrompt({
    budgetTokens: 1200,
    promptParams: {
      defenderAffinities: ["fire"],
      attackerSetupMode: "user",
      attackerAffinities: { fire: ["push", "emit"] },
      attackerVitalsMax: { health: 10, mana: 6 },
      attackerVitalsRegen: { health: 1, mana: 2 },
      attackerAffinityStackRegen: 1,
    },
  });

  assert.match(prompt, /Default setup mode: user/);
  assert.match(prompt, /Requested attacker affinities: fire\(push, emit\)/);
  assert.match(prompt, /Requested attacker vitals max: health 10, mana 6/);
  assert.match(prompt, /Requested attacker vitals regen: health 1, mana 2/);
  assert.match(prompt, /Allowed setup modes: user/);
  assert.match(prompt, /Allowed affinities: fire/);
  assert.match(prompt, /Allowed affinity expressions: push, emit/);
  assert.match(prompt, /Required attacker affinities: fire\(push, emit\)/);
  assert.match(prompt, /include every required attacker affinity entry in attackerConfig\.affinities/i);
  assert.doesNotMatch(prompt, /Attacker setup mode:/);
  assert.match(prompt, /attackerConfig\.affinities must include at least one affinity with at least one expression/i);
  assert.match(prompt, /attackerConfig\.vitalsMax\.mana must be an integer greater than 0/i);
  assert.match(prompt, /attackerConfig\.vitalsRegen\.mana must be an integer greater than 0/i);
});

test("design guidance attacker prompt includes all selected attacker affinities", () => {
  const prompt = buildDefaultStrategicGuidancePrompt({
    budgetTokens: 100000,
    promptParams: {
      levelAffinities: ["fire"],
      attackerSetupMode: "user",
      attackerAffinities: {
        fire: ["push"],
        water: ["push"],
      },
      attackerVitalsMax: { health: 100, mana: 100, stamina: 100, durability: 100 },
      attackerVitalsRegen: { health: 10, mana: 10, stamina: 10, durability: 0 },
      poolBudgets: { layout: 55000, defenders: 30000, attacker: 15000 },
    },
  });

  assert.match(prompt, /Goal: Configure attacker setup for a fire and water themed dungeon\./);
  assert.match(prompt, /Allowed affinities: fire, water/);
  assert.match(prompt, /Allowed affinity expressions: push/);
  assert.match(prompt, /Required attacker affinities: fire\(push\), water\(push\)/);
});

test("design guidance layout profile selection flows into prompt and summary", async () => {
  const guidanceInput = makeInput("");
  const statusEl = { textContent: "", style: {} };
  const briefOutput = { textContent: "" };
  const actorSetInput = makeInput("");
  const actorSetPreview = { textContent: "" };

  const guidance = wireDesignGuidance({
    elements: {
      guidanceInput,
      modeSelect: makeInput("fixture"),
      modelInput: makeInput("fixture"),
      baseUrlInput: makeInput("http://localhost:11434"),
      generateButton: makeButton(),
      fixtureButton: makeButton(),
      statusEl,
      briefOutput,
      actorSetInput,
      actorSetPreview,
      applyActorSetButton: makeButton(),
      tokenBudgetInput: makeInput("1200"),
      maxTokenBudgetInput: makeInput("1200"),
      layoutProfileInput: makeInput("clustered_islands"),
      layoutAllocationPercentInput: makeInput("55"),
      defenderAllocationPercentInput: makeInput("25"),
      attackerAllocationPercentInput: makeInput("20"),
    },
    llmConfig: {
      catalog: catalogFixture,
      fixtureResponse: {
        responses: [
          {
            response: JSON.stringify({
              phase: "layout_only",
              remainingBudgetTokens: 660,
              layout: { floorTiles: 80, hallwayTiles: 20 },
              missing: [],
            }),
          },
          {
            response: JSON.stringify({
              phase: "actors_only",
              remainingBudgetTokens: 200,
              actors: [{ motivation: "defending", affinity: "fire", count: 1, vitals: makeAmbulatoryVitals() }],
              missing: [],
              stop: "done",
            }),
          },
        ],
      },
    },
  });

  assert.match(guidanceInput.value, /Layout profile preference: clustered_islands/);
  assert.match(guidanceInput.value, /Use roomDesign\.profile: clustered_islands/);
  assert.doesNotMatch(guidanceInput.value, /Include roomDesign\.profile as one of: .*rooms/);
  assert.doesNotMatch(guidanceInput.value, /For sparse_islands, include roomDesign\.density/);

  await guidance.generateBrief({ useFixture: true });

  const summary = guidance.getSummary();
  assert.equal(summary?.roomDesign?.profile, "clustered_islands");
});

test("design guidance applies explicit max budget with direct allocation percentages", async () => {
  const guidanceInput = makeInput("");
  const statusEl = { textContent: "", style: {} };
  const briefOutput = { textContent: "" };
  const actorSetInput = makeInput("");
  const actorSetPreview = { textContent: "" };
  const budgetAllocationSummary = { textContent: "" };

  const guidance = wireDesignGuidance({
    elements: {
      guidanceInput,
      modeSelect: makeInput("fixture"),
      modelInput: makeInput("fixture"),
      baseUrlInput: makeInput("http://localhost:11434"),
      generateButton: makeButton(),
      fixtureButton: makeButton(),
      statusEl,
      briefOutput,
      actorSetInput,
      actorSetPreview,
      applyActorSetButton: makeButton(),
      tokenBudgetInput: makeInput("5000"),
      maxTokenBudgetInput: makeInput("1000"),
      layoutAllocationPercentInput: makeInput("5"),
      defenderAllocationPercentInput: makeInput("70"),
      attackerAllocationPercentInput: makeInput("25"),
      budgetAllocationSummary,
    },
    llmConfig: {
      catalog: catalogFixture,
      fixtureResponse: {
        responses: [
          {
            response: JSON.stringify({
              phase: "layout_only",
              remainingBudgetTokens: 0,
              layout: { floorTiles: 300, hallwayTiles: 151 },
              missing: [],
            }),
          },
          {
            response: JSON.stringify({
              phase: "actors_only",
              remainingBudgetTokens: 120,
              actors: [{ motivation: "defending", affinity: "fire", count: 1, vitals: makeAmbulatoryVitals() }],
              missing: [],
              stop: "done",
            }),
          },
        ],
      },
    },
  });

  assert.match(guidanceInput.value, /Budget tokens: 1000/);
  assert.match(guidanceInput.value, /Remaining budget tokens: 50/);
  assert.match(guidanceInput.value, /Defender phase budget tokens: 700/);
  assert.match(budgetAllocationSummary.textContent, /Layout 50/);
  assert.match(budgetAllocationSummary.textContent, /Defenders 700/);
  assert.match(budgetAllocationSummary.textContent, /Attacker 250/);

  await guidance.generateBrief({ useFixture: true });

  const summary = guidance.getSummary();
  const budgeting = guidance.getBudgeting();
  assert.equal(summary?.budgetTokens, 1000);
  assert.equal(budgeting?.levelBudgetTokens, 50);
  assert.equal(budgeting?.playerBudgetTokens, 250);
});

test("design guidance supports scaled budget controls from 10k to 1,000,000,000 tokens", async () => {
  const budgets = [10000, 100000, 1000000, 1000000000];

  budgets.forEach((budget) => {
    const guidanceInput = makeInput("");
    const budgetAllocationSummary = { textContent: "" };

    wireDesignGuidance({
      elements: {
        guidanceInput,
        modeSelect: makeInput("fixture"),
        modelInput: makeInput("fixture"),
        baseUrlInput: makeInput("http://localhost:11434"),
        generateButton: makeButton(),
        fixtureButton: makeButton(),
        statusEl: { textContent: "", style: {} },
        briefOutput: { textContent: "" },
        actorSetInput: makeInput(""),
        actorSetPreview: { textContent: "" },
        applyActorSetButton: makeButton(),
        tokenBudgetInput: makeInput(String(budget)),
        maxTokenBudgetInput: makeInput(String(budget)),
        layoutAllocationPercentInput: makeInput("55"),
        defenderAllocationPercentInput: makeInput("25"),
        attackerAllocationPercentInput: makeInput("20"),
        budgetAllocationSummary,
      },
      llmConfig: { catalog: catalogFixture },
    });

    assert.match(guidanceInput.value, new RegExp(`Budget tokens: ${budget}`));
    assert.match(budgetAllocationSummary.textContent, new RegExp(`budget ${budget}`));
  });

  const guidanceInput = makeInput("");
  const statusEl = { textContent: "", style: {} };
  const briefOutput = { textContent: "" };
  const actorSetInput = makeInput("");
  const actorSetPreview = { textContent: "" };
  const maxBudget = 1000000000;
  const guidance = wireDesignGuidance({
    elements: {
      guidanceInput,
      modeSelect: makeInput("fixture"),
      modelInput: makeInput("fixture"),
      baseUrlInput: makeInput("http://localhost:11434"),
      generateButton: makeButton(),
      fixtureButton: makeButton(),
      statusEl,
      briefOutput,
      actorSetInput,
      actorSetPreview,
      applyActorSetButton: makeButton(),
      tokenBudgetInput: makeInput(String(maxBudget)),
      maxTokenBudgetInput: makeInput(""),
      layoutAllocationPercentInput: makeInput("55"),
      defenderAllocationPercentInput: makeInput("25"),
      attackerAllocationPercentInput: makeInput("20"),
      budgetAllocationSummary: { textContent: "" },
    },
    llmConfig: {
      catalog: catalogFixture,
      fixtureResponse: {
        responses: [
          {
            response: JSON.stringify({
              phase: "layout_only",
              remainingBudgetTokens: 550000000,
              layout: { floorTiles: 20, hallwayTiles: 10 },
              missing: [],
            }),
          },
          {
            response: JSON.stringify({
              phase: "actors_only",
              remainingBudgetTokens: 249500000,
              actors: [{ motivation: "defending", affinity: "fire", count: 2, vitals: makeAmbulatoryVitals() }],
              missing: [],
              stop: "done",
            }),
          },
        ],
      },
    },
  });

  await guidance.generateBrief({ useFixture: true });
  assert.match(statusEl.textContent, /Design brief ready/);
  assert.equal(guidance.getSummary()?.budgetTokens, maxBudget);
});

test("design guidance benchmarks level generation and reports expected timing", async () => {
  const guidanceInput = makeInput("");
  const statusEl = { textContent: "", style: {} };
  const benchmarkOutput = { textContent: "" };

  const guidance = wireDesignGuidance({
    elements: {
      guidanceInput,
      modeSelect: makeInput("fixture"),
      modelInput: makeInput("fixture"),
      baseUrlInput: makeInput("http://localhost:11434"),
      generateButton: makeButton(),
      fixtureButton: makeButton(),
      statusEl,
      briefOutput: { textContent: "" },
      actorSetInput: makeInput(""),
      actorSetPreview: { textContent: "" },
      applyActorSetButton: makeButton(),
      tokenBudgetInput: makeInput("20000"),
      maxTokenBudgetInput: makeInput(""),
      layoutAllocationPercentInput: makeInput("55"),
      defenderAllocationPercentInput: makeInput("25"),
      attackerAllocationPercentInput: makeInput("20"),
      budgetAllocationSummary: { textContent: "" },
      levelBenchmarkButton: makeButton(),
      levelBenchmarkOutput: benchmarkOutput,
      benchmarkMaxTokenBudgetInput: makeInput("40000"),
      benchmarkSampleRunsInput: makeInput("1"),
    },
    llmConfig: { catalog: catalogFixture },
  });

  const result = await guidance.benchmarkLevelGeneration();

  assert.equal(result.ok, true);
  assert.match(statusEl.textContent, /Level benchmark complete/);
  assert.match(benchmarkOutput.textContent, /Level Generation Benchmark/);
  assert.match(benchmarkOutput.textContent, /Current level size: total 20,?000 \| walkable 11,?000/);
  assert.match(benchmarkOutput.textContent, /Expected generation time at current size:/);
  assert.match(benchmarkOutput.textContent, /Largest successful benchmarked size:/);
});

test("design guidance benchmark runs only the target level size when max budget matches target", async () => {
  const guidanceInput = makeInput("");
  const statusEl = { textContent: "", style: {} };
  const benchmarkOutput = { textContent: "" };

  const guidance = wireDesignGuidance({
    elements: {
      guidanceInput,
      modeSelect: makeInput("fixture"),
      modelInput: makeInput("fixture"),
      baseUrlInput: makeInput("http://localhost:11434"),
      generateButton: makeButton(),
      fixtureButton: makeButton(),
      statusEl,
      briefOutput: { textContent: "" },
      actorSetInput: makeInput(""),
      actorSetPreview: { textContent: "" },
      applyActorSetButton: makeButton(),
      tokenBudgetInput: makeInput("20000"),
      maxTokenBudgetInput: makeInput(""),
      layoutAllocationPercentInput: makeInput("55"),
      defenderAllocationPercentInput: makeInput("25"),
      attackerAllocationPercentInput: makeInput("20"),
      budgetAllocationSummary: { textContent: "" },
      levelBenchmarkButton: makeButton(),
      levelBenchmarkOutput: benchmarkOutput,
      benchmarkMaxTokenBudgetInput: makeInput("20000"),
      benchmarkSampleRunsInput: makeInput("1"),
    },
    llmConfig: { catalog: catalogFixture },
  });

  const result = await guidance.benchmarkLevelGeneration();

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].totalBudgetTokens, 20000);
  assert.match(benchmarkOutput.textContent, /20,?000 \| 11,?000 \|/);
  assert.doesNotMatch(benchmarkOutput.textContent, /10,?000 \| 5,?500 \|/);
  assert.match(statusEl.textContent, /Level benchmark complete/);
});

test("design defender clamp stays within budget at one million token scale", async () => {
  const elements = {
    "#design-guidance-input": makeInput(""),
    "#design-level-prompt-template": makeInput(""),
    "#design-attacker-prompt-template": makeInput(""),
    "#design-defender-prompt-template": makeInput(""),
    "#design-guidance-status": { textContent: "", style: {} },
    "#design-brief-output": { textContent: "" },
    "#design-spend-ledger-output": { textContent: "" },
    "#design-level-output": { textContent: "" },
    "#design-attacker-output": { textContent: "" },
    "#design-level-token-indicator": { textContent: "" },
    "#design-attacker-token-indicator": { textContent: "" },
    "#design-defender-token-indicator": { textContent: "" },
    "#design-simulation-token-indicator": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
    "#prompt-token-budget": makeInput("1000000"),
    "#prompt-max-token-budget": makeInput("1000000"),
    "#prompt-layout-allocation-percent": makeInput("55"),
    "#prompt-defender-allocation-percent": makeInput("25"),
    "#prompt-attacker-allocation-percent": makeInput("20"),
  };

  const root = makeRoot(elements);
  const responses = [
    {
      phase: "layout_only",
      remainingBudgetTokens: 550000,
      layout: { floorTiles: 20, hallwayTiles: 10 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 0,
      actors: [
        {
          motivation: "defending",
          affinity: "fire",
          count: 250000,
          tokenHint: 20,
          vitals: makeAmbulatoryVitals(),
        },
      ],
      missing: [],
      stop: "done",
    },
  ];
  let responseIndex = 0;

  const view = wireDesignView({
    root,
    llmConfig: {
      catalog: catalogFixture,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ response: JSON.stringify(responses[Math.min(responseIndex++, responses.length - 1)]) }),
      }),
    },
  });

  const levelResult = await view.generateLevelBrief();
  assert.equal(levelResult.ok, true);
  const defenderResult = await view.generateDefenderBrief();
  assert.equal(defenderResult.ok, true);
  assert.match(elements["#design-guidance-status"].textContent, /clamped to/);

  const indicatorMatch = elements["#design-defender-token-indicator"].textContent.match(
    /^Used (\d+) \/ (\d+) \(\d+(\.\d+)?%\)$/,
  );
  assert.ok(indicatorMatch);
  const usedTokens = Number(indicatorMatch[1]);
  const budgetTokens = Number(indicatorMatch[2]);
  assert.ok(budgetTokens > 0);
  assert.ok(budgetTokens <= 1000000);
  assert.ok(usedTokens <= budgetTokens);

  const actorSet = JSON.parse(elements["#design-actor-set-json"].value || "[]");
  assert.ok(Array.isArray(actorSet));
  assert.ok(actorSet.length > 0);
  assert.ok(Number(actorSet[0]?.count) < 250000);
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
      setupMode: "hybrid",
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
      setupMode: "hybrid",
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

test("design view supports phased level -> attacker -> defender generation flow", async () => {
  const elements = {
    "#design-guidance-input": makeInput(""),
    "#design-level-prompt-template": makeInput(""),
    "#design-attacker-prompt-template": makeInput(""),
    "#design-defender-prompt-template": makeInput(""),
    "#design-guidance-status": { textContent: "", style: {} },
    "#design-brief-output": { textContent: "" },
    "#design-spend-ledger-output": { textContent: "" },
    "#design-level-output": { textContent: "" },
    "#design-attacker-output": { textContent: "" },
    "#design-level-token-indicator": { textContent: "" },
    "#design-attacker-token-indicator": { textContent: "" },
    "#design-defender-token-indicator": { textContent: "" },
    "#design-simulation-token-indicator": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
    "#prompt-token-budget": makeInput("900"),
    "#prompt-max-token-budget": makeInput("900"),
    "#prompt-layout-allocation-percent": makeInput("55"),
    "#prompt-defender-allocation-percent": makeInput("25"),
    "#prompt-attacker-allocation-percent": makeInput("20"),
  };

  const root = makeRoot(elements);
  const responses = [
    {
      phase: "layout_only",
      remainingBudgetTokens: 495,
      layout: { floorTiles: 60, hallwayTiles: 20 },
      roomDesign: {
        profile: "rooms",
        rooms: [{ id: "R1", size: "medium", width: 10, height: 8 }],
        connections: [],
        hallways: "Single connector",
      },
      missing: [],
    },
    {
      dungeonAffinity: "fire",
      attackerConfig: {
        setupMode: "user",
        vitalsMax: { health: 12, mana: 6 },
        vitalsRegen: { mana: 1 },
      },
      rooms: [],
      actors: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 180,
      actors: [{ motivation: "defending", affinity: "fire", count: 1, vitals: makeAmbulatoryVitals() }],
      missing: [],
      stop: "done",
    },
  ];
  let responseIndex = 0;

  const view = wireDesignView({
    root,
    llmConfig: {
      catalog: catalogFixture,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ response: JSON.stringify(responses[Math.min(responseIndex++, responses.length - 1)]) }),
      }),
    },
  });

  const levelResult = await view.generateLevelBrief();
  assert.equal(levelResult.ok, true);
  assert.match(elements["#design-level-output"].textContent, /Level preview ready:/);
  assert.match(elements["#design-level-token-indicator"].textContent, /^Used \d+ \/ \d+ \(\d+(\.\d+)?%\)$/);

  const attackerResult = await view.generateAttackerBrief();
  assert.equal(attackerResult.ok, true);
  assert.match(elements["#design-attacker-output"].textContent, /mode user/);
  assert.match(elements["#design-attacker-token-indicator"].textContent, /^Used \d+ \/ \d+ \(\d+(\.\d+)?%\)$/);

  const defenderResult = await view.generateDefenderBrief();
  assert.equal(defenderResult.ok, true);
  assert.match(elements["#design-actor-set-json"].value, /actor_defending_1/);
  assert.match(elements["#design-brief-output"].textContent, /Actors Total: 1/);
  assert.match(elements["#design-defender-token-indicator"].textContent, /^Used \d+ \/ \d+ \(\d+(\.\d+)?%\)$/);
  assert.match(elements["#design-simulation-token-indicator"].textContent, /^Used \d+ \/ \d+ \(\d+(\.\d+)?%\)$/);
});

test("design view level timing tracks real button-click path at 2M tokens", async () => {
  const statusEl = makeStatusElement();
  const levelOutput = makeRenderableLevelOutput();
  const runLevelButton = makeButton();
  const elements = {
    "#design-guidance-input": makeInput(""),
    "#design-level-prompt-template": makeInput(""),
    "#design-attacker-prompt-template": makeInput(""),
    "#design-defender-prompt-template": makeInput(""),
    "#design-run-level-prompt": runLevelButton,
    "#design-guidance-generate": makeButton(),
    "#design-guidance-status": statusEl,
    "#design-brief-output": { textContent: "" },
    "#design-spend-ledger-output": { textContent: "" },
    "#design-level-output": levelOutput,
    "#design-attacker-output": { textContent: "" },
    "#design-level-token-indicator": { textContent: "" },
    "#design-attacker-token-indicator": { textContent: "" },
    "#design-defender-token-indicator": { textContent: "" },
    "#design-simulation-token-indicator": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
    "#prompt-token-budget": makeInput("2000000"),
    "#prompt-max-token-budget": makeInput("2000000"),
    "#prompt-layout-allocation-percent": makeInput("55"),
    "#prompt-defender-allocation-percent": makeInput("25"),
    "#prompt-attacker-allocation-percent": makeInput("20"),
  };
  const root = makeRoot(elements);
  let requestCount = 0;
  const walkableTiles = 1100000;

  wireDesignView({
    root,
    llmConfig: {
      catalog: catalogFixture,
      fetchFn: async () => {
        requestCount += 1;
        return {
          ok: true,
          json: async () => ({
            response: JSON.stringify({
              phase: "layout_only",
              remainingBudgetTokens: walkableTiles,
              layout: { floorTiles: walkableTiles, hallwayTiles: 0 },
              missing: [],
              stop: "done",
            }),
            done: true,
          }),
        };
      },
    },
  });

  const startedAt = Date.now();
  runLevelButton.click();
  await waitFor(
    () => typeof statusEl.textContent === "string" && statusEl.textContent.includes("Level layout ready."),
    { timeoutMs: 30000, label: "level generation from Run Level Creation Prompt" },
  );
  const elapsedMs = Date.now() - startedAt;

  assert.ok(requestCount >= 1);
  assert.ok(elapsedMs < 30000, `expected button-click level generation to finish under 30s, got ${elapsedMs}ms`);
  assert.ok(statusEl.history.some((entry) => entry.includes("Generating level layout...")));
  assert.ok(levelOutput.childrenCount > 0);
});

test("design view level timing test includes repair cycle in button-click path", async () => {
  const statusEl = makeStatusElement();
  const levelOutput = makeRenderableLevelOutput();
  const runLevelButton = makeButton();
  const elements = {
    "#design-guidance-input": makeInput(""),
    "#design-level-prompt-template": makeInput(""),
    "#design-attacker-prompt-template": makeInput(""),
    "#design-defender-prompt-template": makeInput(""),
    "#design-run-level-prompt": runLevelButton,
    "#design-guidance-generate": makeButton(),
    "#design-guidance-status": statusEl,
    "#design-brief-output": { textContent: "" },
    "#design-spend-ledger-output": { textContent: "" },
    "#design-level-output": levelOutput,
    "#design-attacker-output": { textContent: "" },
    "#design-level-token-indicator": { textContent: "" },
    "#design-attacker-token-indicator": { textContent: "" },
    "#design-defender-token-indicator": { textContent: "" },
    "#design-simulation-token-indicator": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
    "#prompt-token-budget": makeInput("2000000"),
    "#prompt-max-token-budget": makeInput("2000000"),
    "#prompt-layout-allocation-percent": makeInput("55"),
    "#prompt-defender-allocation-percent": makeInput("25"),
    "#prompt-attacker-allocation-percent": makeInput("20"),
  };
  const root = makeRoot(elements);
  const walkableTiles = 1100000;
  const responses = [
    {
      phase: "layout_only",
      remainingBudgetTokens: walkableTiles,
      missing: [],
      stop: "done",
    },
    {
      phase: "layout_only",
      remainingBudgetTokens: walkableTiles,
      layout: { floorTiles: walkableTiles, hallwayTiles: 0 },
      missing: [],
      stop: "done",
    },
  ];
  let responseIndex = 0;

  wireDesignView({
    root,
    llmConfig: {
      catalog: catalogFixture,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          response: JSON.stringify(responses[Math.min(responseIndex++, responses.length - 1)]),
          done: true,
        }),
      }),
    },
  });

  const startedAt = Date.now();
  runLevelButton.click();
  await waitFor(
    () => typeof statusEl.textContent === "string" && statusEl.textContent.includes("Level layout ready."),
    { timeoutMs: 30000, label: "level repair completion from Run Level Creation Prompt" },
  );
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 30000, `expected repaired button-click level generation to finish under 30s, got ${elapsedMs}ms`);
  assert.ok(responseIndex >= 2, "expected at least one repair retry");
  assert.ok(statusEl.history.some((entry) => entry.includes("Repairing level layout...")));
  assert.ok(levelOutput.childrenCount > 0);
});

test("design view marks prompt buttons busy and blocks duplicate level runs while in flight", async () => {
  const statusEl = makeStatusElement();
  let releaseFetch;
  let fetchCalls = 0;
  const pendingResponse = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  const runLevelButton = makeButton("Run Level Creation Prompt");
  const runAttackerButton = makeButton("Run Attacker Prompt");
  const runDefenderButton = makeButton("Run Defender Prompt");
  const elements = {
    "#design-guidance-input": makeInput(""),
    "#design-level-prompt-template": makeInput(""),
    "#design-attacker-prompt-template": makeInput(""),
    "#design-defender-prompt-template": makeInput(""),
    "#design-run-level-prompt": runLevelButton,
    "#design-run-attacker-prompt": runAttackerButton,
    "#design-run-defender-prompt": runDefenderButton,
    "#design-guidance-generate": makeButton(),
    "#design-guidance-status": statusEl,
    "#design-brief-output": { textContent: "" },
    "#design-spend-ledger-output": { textContent: "" },
    "#design-level-output": makeRenderableLevelOutput(),
    "#design-attacker-output": { textContent: "" },
    "#design-level-token-indicator": { textContent: "" },
    "#design-attacker-token-indicator": { textContent: "" },
    "#design-defender-token-indicator": { textContent: "" },
    "#design-simulation-token-indicator": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
    "#prompt-token-budget": makeInput("2000000"),
    "#prompt-max-token-budget": makeInput("2000000"),
    "#prompt-layout-allocation-percent": makeInput("55"),
    "#prompt-defender-allocation-percent": makeInput("25"),
    "#prompt-attacker-allocation-percent": makeInput("20"),
  };
  const root = makeRoot(elements);
  const walkableTiles = 1100000;

  wireDesignView({
    root,
    llmConfig: {
      catalog: catalogFixture,
      fetchFn: async () => {
        fetchCalls += 1;
        await pendingResponse;
        return {
          ok: true,
          json: async () => ({
            response: JSON.stringify({
              phase: "layout_only",
              remainingBudgetTokens: walkableTiles,
              layout: { floorTiles: walkableTiles, hallwayTiles: 0 },
              missing: [],
              stop: "done",
            }),
            done: true,
          }),
        };
      },
    },
  });

  runLevelButton.click();
  await waitFor(
    () => runLevelButton.disabled === true && runAttackerButton.disabled === true && runDefenderButton.disabled === true,
    { timeoutMs: 3000, label: "prompt buttons busy state" },
  );
  assert.equal(runLevelButton.textContent, "Running Level Prompt...");
  await waitFor(
    () => fetchCalls >= 1,
    { timeoutMs: 3000, label: "initial level prompt fetch call" },
  );
  assert.equal(fetchCalls, 1);

  runLevelButton.click();
  assert.equal(fetchCalls, 1);

  releaseFetch();
  await waitFor(
    () => typeof statusEl.textContent === "string" && statusEl.textContent.includes("Level layout ready."),
    { timeoutMs: 30000, label: "level completion after busy state" },
  );
  assert.equal(runLevelButton.disabled, false);
  assert.equal(runAttackerButton.disabled, false);
  assert.equal(runDefenderButton.disabled, false);
  assert.equal(runLevelButton.textContent, "Run Level Creation Prompt");
});

test("design view level prompt returns with timeout error when LLM request hangs", async () => {
  const statusEl = makeStatusElement();
  const runLevelButton = makeButton("Run Level Creation Prompt");
  const runAttackerButton = makeButton("Run Attacker Prompt");
  const runDefenderButton = makeButton("Run Defender Prompt");
  const elements = {
    "#design-guidance-input": makeInput(""),
    "#design-level-prompt-template": makeInput(""),
    "#design-attacker-prompt-template": makeInput(""),
    "#design-defender-prompt-template": makeInput(""),
    "#design-run-level-prompt": runLevelButton,
    "#design-run-attacker-prompt": runAttackerButton,
    "#design-run-defender-prompt": runDefenderButton,
    "#design-guidance-generate": makeButton(),
    "#design-guidance-status": statusEl,
    "#design-brief-output": { textContent: "" },
    "#design-spend-ledger-output": { textContent: "" },
    "#design-level-output": makeRenderableLevelOutput(),
    "#design-attacker-output": { textContent: "" },
    "#design-level-token-indicator": { textContent: "" },
    "#design-attacker-token-indicator": { textContent: "" },
    "#design-defender-token-indicator": { textContent: "" },
    "#design-simulation-token-indicator": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
    "#prompt-token-budget": makeInput("10000"),
    "#prompt-max-token-budget": makeInput("10000"),
    "#prompt-layout-allocation-percent": makeInput("55"),
    "#prompt-defender-allocation-percent": makeInput("25"),
    "#prompt-attacker-allocation-percent": makeInput("20"),
  };
  const root = makeRoot(elements);
  let fetchCalls = 0;

  wireDesignView({
    root,
    llmConfig: {
      catalog: catalogFixture,
      requestTimeoutMs: 40,
      fetchFn: async () => {
        fetchCalls += 1;
        return new Promise(() => {});
      },
    },
  });

  runLevelButton.click();
  await waitFor(
    () => runLevelButton.disabled === true && runAttackerButton.disabled === true && runDefenderButton.disabled === true,
    { timeoutMs: 3000, label: "busy state before timeout" },
  );
  await waitFor(
    () => typeof statusEl.textContent === "string" && statusEl.textContent.includes("timed out"),
    { timeoutMs: 5000, label: "timeout status" },
  );

  assert.ok(fetchCalls >= 1);
  assert.equal(runLevelButton.disabled, false);
  assert.equal(runAttackerButton.disabled, false);
  assert.equal(runDefenderButton.disabled, false);
  assert.equal(runLevelButton.textContent, "Run Level Creation Prompt");
});

test("design attacker auto setup mirrors regen values from max vitals", async () => {
  const elements = {
    "#design-guidance-input": makeInput(""),
    "#design-level-prompt-template": makeInput(""),
    "#design-attacker-prompt-template": makeInput(""),
    "#design-defender-prompt-template": makeInput(""),
    "#design-guidance-status": { textContent: "", style: {} },
    "#design-brief-output": { textContent: "" },
    "#design-spend-ledger-output": { textContent: "" },
    "#design-level-output": { textContent: "" },
    "#design-attacker-output": { textContent: "" },
    "#design-level-token-indicator": { textContent: "" },
    "#design-attacker-token-indicator": { textContent: "" },
    "#design-defender-token-indicator": { textContent: "" },
    "#design-simulation-token-indicator": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
    "#prompt-token-budget": makeInput("1000"),
    "#prompt-max-token-budget": makeInput("1000"),
    "#prompt-layout-allocation-percent": makeInput("55"),
    "#prompt-defender-allocation-percent": makeInput("25"),
    "#prompt-attacker-allocation-percent": makeInput("20"),
  };

  const root = makeRoot(elements);
  const responses = [
    {
      dungeonAffinity: "fire",
      attackerConfig: {
        setupMode: "auto",
        vitalsMax: { health: 200, mana: 100, stamina: 150, durability: 50 },
        vitalsRegen: { health: 0, mana: 0, stamina: 0, durability: 0 },
      },
      rooms: [],
      actors: [],
    },
  ];
  let responseIndex = 0;

  const view = wireDesignView({
    root,
    llmConfig: {
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ response: JSON.stringify(responses[Math.min(responseIndex++, responses.length - 1)]) }),
      }),
    },
  });

  const attackerResult = await view.generateAttackerBrief();
  assert.equal(attackerResult.ok, true);
  const config = attackerResult.summary?.attackerConfig || {};
  assert.equal(config.setupMode, "auto");
  assert.deepEqual(config.vitalsRegen, config.vitalsMax);
  const indicatorMatch = elements["#design-attacker-token-indicator"].textContent.match(
    /^Used (\d+) \/ (\d+) \(\d+(\.\d+)?%\)$/,
  );
  assert.ok(indicatorMatch);
  const usedTokens = Number(indicatorMatch[1]);
  const budgetTokens = Number(indicatorMatch[2]);
  assert.equal(budgetTokens, 200);
  assert.ok(usedTokens <= budgetTokens);
});

test("design attacker generation enforces affinity and mana guardrails", async () => {
  const elements = {
    "#design-guidance-input": makeInput(""),
    "#design-level-prompt-template": makeInput(""),
    "#design-attacker-prompt-template": makeInput(""),
    "#design-defender-prompt-template": makeInput(""),
    "#design-guidance-status": { textContent: "", style: {} },
    "#design-brief-output": { textContent: "" },
    "#design-spend-ledger-output": { textContent: "" },
    "#design-level-output": { textContent: "" },
    "#design-attacker-output": { textContent: "" },
    "#design-level-token-indicator": { textContent: "" },
    "#design-attacker-token-indicator": { textContent: "" },
    "#design-defender-token-indicator": { textContent: "" },
    "#design-simulation-token-indicator": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
    "#prompt-token-budget": makeInput("1000"),
    "#prompt-max-token-budget": makeInput("1000"),
    "#prompt-layout-allocation-percent": makeInput("55"),
    "#prompt-defender-allocation-percent": makeInput("25"),
    "#prompt-attacker-allocation-percent": makeInput("20"),
  };

  const root = makeRoot(elements);
  const responses = [
    {
      dungeonAffinity: "fire",
      attackerConfig: {
        setupMode: "user",
        vitalsMax: { health: 8, mana: 0 },
        vitalsRegen: { health: 1, mana: 0 },
        affinities: {},
      },
      rooms: [],
      actors: [],
    },
  ];
  let responseIndex = 0;

  const view = wireDesignView({
    root,
    llmConfig: {
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ response: JSON.stringify(responses[Math.min(responseIndex++, responses.length - 1)]) }),
      }),
    },
  });

  const attackerResult = await view.generateAttackerBrief();
  assert.equal(attackerResult.ok, true);
  const config = attackerResult.summary?.attackerConfig || {};
  assert.ok(config.affinities && Object.keys(config.affinities).length > 0);
  assert.ok(Number(config.vitalsMax?.mana) > 0);
  assert.ok(Number(config.vitalsRegen?.mana) > 0);
});

test("design defender generation clamps spend to available budget", async () => {
  const elements = {
    "#design-guidance-input": makeInput(""),
    "#design-level-prompt-template": makeInput(""),
    "#design-attacker-prompt-template": makeInput(""),
    "#design-defender-prompt-template": makeInput(""),
    "#design-guidance-status": { textContent: "", style: {} },
    "#design-brief-output": { textContent: "" },
    "#design-spend-ledger-output": { textContent: "" },
    "#design-level-output": { textContent: "" },
    "#design-attacker-output": { textContent: "" },
    "#design-level-token-indicator": { textContent: "" },
    "#design-attacker-token-indicator": { textContent: "" },
    "#design-defender-token-indicator": { textContent: "" },
    "#design-simulation-token-indicator": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
    "#prompt-token-budget": makeInput("1000"),
    "#prompt-max-token-budget": makeInput("1000"),
    "#prompt-layout-allocation-percent": makeInput("55"),
    "#prompt-defender-allocation-percent": makeInput("25"),
    "#prompt-attacker-allocation-percent": makeInput("20"),
  };

  const root = makeRoot(elements);
  const responses = [
    {
      phase: "layout_only",
      remainingBudgetTokens: 550,
      layout: { floorTiles: 350, hallwayTiles: 200 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 0,
      actors: [
        {
          motivation: "defending",
          affinity: "fire",
          count: 10,
          tokenHint: 80,
          vitals: makeAmbulatoryVitals(),
        },
      ],
      missing: [],
      stop: "done",
    },
  ];
  let responseIndex = 0;

  const view = wireDesignView({
    root,
    llmConfig: {
      catalog: catalogFixture,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ response: JSON.stringify(responses[Math.min(responseIndex++, responses.length - 1)]) }),
      }),
    },
  });

  const levelResult = await view.generateLevelBrief();
  assert.equal(levelResult.ok, true);
  const defenderResult = await view.generateDefenderBrief();
  assert.equal(defenderResult.ok, true);
  assert.match(elements["#design-guidance-status"].textContent, /clamped to/);
  const indicatorMatch = elements["#design-defender-token-indicator"].textContent.match(
    /^Used (\d+) \/ (\d+) \(\d+(\.\d+)?%\)$/,
  );
  assert.ok(indicatorMatch);
  const usedTokens = Number(indicatorMatch[1]);
  const budgetTokens = Number(indicatorMatch[2]);
  assert.ok(usedTokens <= budgetTokens);
});

test("design defender prompt uses actor-phase response token options", async () => {
  const elements = {
    "#design-guidance-input": makeInput(""),
    "#design-level-prompt-template": makeInput(""),
    "#design-attacker-prompt-template": makeInput(""),
    "#design-defender-prompt-template": makeInput(""),
    "#design-guidance-status": { textContent: "", style: {} },
    "#design-brief-output": { textContent: "" },
    "#design-spend-ledger-output": { textContent: "" },
    "#design-level-output": { textContent: "" },
    "#design-attacker-output": { textContent: "" },
    "#design-level-token-indicator": { textContent: "" },
    "#design-attacker-token-indicator": { textContent: "" },
    "#design-defender-token-indicator": { textContent: "" },
    "#design-simulation-token-indicator": { textContent: "" },
    "#design-actor-set-json": makeInput(""),
    "#design-actor-set-apply": makeButton(),
    "#design-actor-set-preview": { textContent: "" },
    "#design-build-and-load": makeButton(),
    "#design-build-status": { textContent: "", style: {} },
    "#prompt-token-budget": makeInput("1000"),
    "#prompt-max-token-budget": makeInput("1000"),
    "#prompt-layout-allocation-percent": makeInput("55"),
    "#prompt-defender-allocation-percent": makeInput("25"),
    "#prompt-attacker-allocation-percent": makeInput("20"),
  };

  const root = makeRoot(elements);
  const responses = [
    {
      phase: "layout_only",
      remainingBudgetTokens: 550,
      layout: { floorTiles: 350, hallwayTiles: 200 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 200,
      actors: [{ motivation: "defending", affinity: "water", count: 1, vitals: makeAmbulatoryVitals() }],
      missing: [],
      stop: "done",
    },
  ];
  const capturedBodies = [];
  let responseIndex = 0;

  const view = wireDesignView({
    root,
    llmConfig: {
      catalog: catalogFixture,
      fetchFn: async (_url, options) => {
        capturedBodies.push(String(options?.body || ""));
        return {
          ok: true,
          json: async () => ({ response: JSON.stringify(responses[Math.min(responseIndex++, responses.length - 1)]) }),
        };
      },
    },
  });

  const levelResult = await view.generateLevelBrief();
  assert.equal(levelResult.ok, true);
  const defenderResult = await view.generateDefenderBrief();
  assert.equal(defenderResult.ok, true);
  assert.ok(capturedBodies.some((body) => /"num_predict":320/.test(body)));
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
      layout: { floorTiles: 24, hallwayTiles: 8 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 120,
      actors: [{ motivation: "attacking", affinity: "fire", count: 2, vitals: makeAmbulatoryVitals() }],
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
      layout: { floorTiles: 20, hallwayTiles: 10 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 140,
      actors: [{ motivation: "patrolling", affinity: "wind", count: 2, vitals: makeAmbulatoryVitals() }],
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

test("design view clamps over-budget defender actor set before build", async () => {
  const elements = {
    "#design-guidance-input": makeInput("Fire defense with 50 token budget."),
    "#design-guidance-generate": makeButton(),
    "#design-guidance-status": { textContent: "", style: {} },
    "#design-brief-output": { textContent: "" },
    "#design-spend-ledger-output": { textContent: "" },
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
      remainingBudgetTokens: 70,
      layout: { floorTiles: 10, hallwayTiles: 10 },
      missing: [],
    },
    {
      phase: "actors_only",
      remainingBudgetTokens: 50,
      actors: [{ motivation: "attacking", affinity: "fire", count: 1, tokenHint: 10, vitals: makeAmbulatoryVitals() }],
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
  });

  await view.generateBrief();
  elements["#design-actor-set-json"].value = JSON.stringify([
    {
      source: "actor",
      id: "actor_over_budget",
      role: "attacking",
      affinity: "fire",
      count: 5,
      tokenHint: 50,
      affinities: [{ kind: "fire", expression: "push", stacks: 3 }],
      vitals: {
        health: { current: 10, max: 10, regen: 1 },
        mana: { current: 6, max: 6, regen: 2 },
        stamina: { current: 5, max: 5, regen: 1 },
        durability: { current: 3, max: 3, regen: 0 },
      },
    },
  ], null, 2);

  await view.buildAndLoad();

  const clampedActorSet = JSON.parse(elements["#design-actor-set-json"].value || "[]");
  assert.ok(Array.isArray(clampedActorSet));
  assert.ok(clampedActorSet.every((entry) => !Number.isInteger(entry?.count) || entry.count < 5));
  assert.deepEqual(calls, ["build", "bundle", "run"]);
  assert.match(elements["#design-build-status"].textContent, /Build complete\. Simulation loaded\./);
});
