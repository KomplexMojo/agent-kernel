import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createDesignCard,
  wireDesignGuidance,
} from "../../packages/ui-web/src/design-guidance.js";
import { extractDesignStateFromBuildSpec } from "../../packages/ui-web/src/build-spec-ui.js";
// M2 target module — does not exist yet. The DOM builder is the compatibility oracle.
import { createCardBuilderController } from "../../packages/ui-web/src/card-builder-controller.js";

function makeNode(tagName = "div", ownerDocument = null) {
  const handlers = {};
  let textContentValue = "";
  let classNameValue = "";
  return {
    tagName: String(tagName).toUpperCase(),
    ownerDocument,
    id: "",
    dataset: {},
    children: [],
    parentNode: null,
    value: "",
    disabled: false,
    hidden: false,
    style: {},
    type: "",
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    get className() {
      return classNameValue;
    },
    set className(value) {
      classNameValue = String(value || "");
    },
    get textContent() {
      if (this.children.length === 0) return textContentValue;
      return `${textContentValue}${this.children.map((child) => child.textContent || "").join("")}`;
    },
    set textContent(value) {
      textContentValue = String(value ?? "");
      this.children = [];
    },
    appendChild(child) {
      if (child && typeof child === "object") child.parentNode = this;
      this.children.push(child);
      return child;
    },
    append(...parts) {
      parts.forEach((part) => {
        if (part && typeof part === "object") this.appendChild(part);
      });
    },
    replaceChildren(...parts) {
      this.children = [];
      this.append(...parts);
    },
    addEventListener(event, fn) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(fn);
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
  };
}

function createDomGuidance() {
  const doc = { createElement: (tag) => makeNode(tag, doc) };
  const make = (tag = "div") => makeNode(tag, doc);
  const elements = {
    statusEl: make("div"),
    leftRailType: make("div"),
    leftRailAffinities: make("div"),
    leftRailExpressions: make("div"),
    leftRailMotivations: make("div"),
    cardGrid: make("div"),
    roomGroup: make("div"),
    attackerGroup: make("div"),
    defenderGroup: make("div"),
    hazardGroup: make("div"),
    resourceGroup: make("div"),
    roomGroupBudget: make("div"),
    attackerGroupBudget: make("div"),
    defenderGroupBudget: make("div"),
    resourceGroupBudget: make("div"),
    levelBudgetInput: make("input"),
    budgetSplitRoomInput: make("input"),
    budgetSplitAttackerInput: make("input"),
    budgetSplitDefenderInput: make("input"),
    budgetSplitHazardInput: make("input"),
    budgetSplitResourceInput: make("input"),
    budgetSplitRoomTokens: make("div"),
    budgetSplitAttackerTokens: make("div"),
    budgetSplitDefenderTokens: make("div"),
    budgetOverviewEl: make("div"),
  };
  // Mirror the default budget config the headless controller uses (DEFAULT_BUDGET_SPLIT)
  // so both paths evaluate the same allocation caps. Empty input values would otherwise
  // collapse the DOM builder's splits to 0% and reject every setCards call.
  elements.levelBudgetInput.value = "2500";
  elements.budgetSplitRoomInput.value = "44";
  elements.budgetSplitAttackerInput.value = "20";
  elements.budgetSplitDefenderInput.value = "16";
  elements.budgetSplitHazardInput.value = "12";
  elements.budgetSplitResourceInput.value = "8";
  return { guidance: wireDesignGuidance({ elements }), statusEl: elements.statusEl };
}

function sampleCards() {
  return [
    createDesignCard({ id: "room_p", type: "room", roomSize: "medium", affinity: "fire", count: 2 }),
    createDesignCard({ id: "atk_p", type: "delver", affinity: "fire", motivations: ["attacking"], count: 1 }),
    createDesignCard({ id: "def_p", type: "warden", affinity: "earth", motivations: ["defending"], count: 1 }),
  ];
}

test("DOM builder and headless controller produce matching shelved card receipts", () => {
  const { guidance } = createDomGuidance();
  const controller = createCardBuilderController();
  const cards = sampleCards();
  guidance.setCards(cards.map((card) => createDesignCard(card)));
  controller.setCards(cards.map((card) => createDesignCard(card)));

  const domReceipts = guidance.getCards().map((card) => card.tokenReceipt);
  const controllerReceipts = controller.getCards().map((card) => card.tokenReceipt);
  assert.deepEqual(
    controllerReceipts.map((r) => r.tokenTotals),
    domReceipts.map((r) => r.tokenTotals),
  );
});

test("DOM builder and headless controller produce matching budgets and summaries", () => {
  const { guidance } = createDomGuidance();
  const controller = createCardBuilderController();
  const cards = sampleCards();
  guidance.setCards(cards.map((card) => createDesignCard(card)));
  controller.setCards(cards.map((card) => createDesignCard(card)));

  assert.equal(
    controller.getSummary().roomDesign.roomCount,
    guidance.getSummary().roomDesign.roomCount,
  );
  assert.equal(
    controller.getSummary().budgetTokens,
    guidance.getSummary().budgetTokens,
  );
  assert.deepEqual(
    controller.getSpendLedger().allocations,
    guidance.getSpendLedger().allocations,
  );
});

test("DOM builder and headless controller produce the same invalid-drop status message", () => {
  const { guidance, statusEl } = createDomGuidance();
  const controller = createCardBuilderController();

  const domBlank = guidance.getActiveCard();
  guidance.applyPropertyDrop(domBlank.id, { group: "affinities", value: "fire" });

  const ctrlBlank = controller.getActiveCard();
  controller.applyPropertyDrop(ctrlBlank.id, { group: "affinities", value: "fire" });

  assert.equal(controller.getStatus().message, statusEl.textContent);
});

test("DOM builder and headless controller publish the same spec text from an equivalent card set", async () => {
  const { guidance } = createDomGuidance();
  const controller = createCardBuilderController();
  const cards = sampleCards();
  guidance.setCards(cards.map((card) => createDesignCard(card)));
  controller.setCards(cards.map((card) => createDesignCard(card)));

  // The DOM builder exposes serializeCards; the controller must serialize the same card set.
  // setCards reassigns fresh card ids on both paths, so compare with ids stripped.
  const stripIds = (text) =>
    JSON.parse(text)
      .map(({ id, ...rest }) => rest)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assert.deepEqual(stripIds(controller.serializeCards()), stripIds(guidance.serializeCards()));
});

// ## TODO: Test Permutations
test("DOM builder and headless controller match for a single-room card set", () => {
  const { guidance } = createDomGuidance();
  const controller = createCardBuilderController();
  const cards = [
    createDesignCard({ id: "room_only", type: "room", roomSize: "small", affinity: "fire", count: 1 }),
  ];

  assert.equal(guidance.setCards(cards.map((card) => createDesignCard(card))), true);
  assert.equal(controller.setCards(cards.map((card) => createDesignCard(card))), true);

  assert.equal(controller.getCards().length, guidance.getCards().length);
  assert.equal(controller.getSummary().roomDesign.roomCount, guidance.getSummary().roomDesign.roomCount);
  assert.deepEqual(controller.getSpendLedger().allocations, guidance.getSpendLedger().allocations);
});

test("DOM builder and headless controller match for hazard and resource budget-ceiling cards", () => {
  const { guidance } = createDomGuidance();
  const controller = createCardBuilderController();
  const cards = [
    createDesignCard({ id: "hazard_budget", type: "hazard", affinity: "decay", expressions: ["emit"], count: 1, tokenHint: 50 }),
    createDesignCard({ id: "resource_budget", type: "resource", affinity: "life", budgetCeiling: 100, count: 1 }),
  ];

  assert.equal(guidance.setCards(cards.map((card) => createDesignCard(card))), true);
  assert.equal(controller.setCards(cards.map((card) => createDesignCard(card))), true);

  assert.deepEqual(
    controller.getCards().map((card) => card.tokenReceipt.tokenTotals),
    guidance.getCards().map((card) => card.tokenReceipt.tokenTotals),
  );
  assert.deepEqual(controller.getSpendLedger().allocations, guidance.getSpendLedger().allocations);
});

test("DOM builder and headless controller match after count adjustment on a shelved card", () => {
  const { guidance } = createDomGuidance();
  const controller = createCardBuilderController();
  const cards = sampleCards();
  guidance.setCards(cards.map((card) => createDesignCard(card)));
  controller.setCards(cards.map((card) => createDesignCard(card)));

  const domCardId = guidance.getCards().find((card) => card.type === "room").id;
  const controllerCardId = controller.getCards().find((card) => card.type === "room").id;
  assert.equal(guidance.adjustCardCount(domCardId, 1), true);
  assert.equal(controller.adjustCardCount(controllerCardId, 1), true);

  assert.equal(
    controller.getCards().find((card) => card.type === "room").count,
    guidance.getCards().find((card) => card.type === "room").count,
  );
  assert.deepEqual(
    controller.getCards().find((card) => card.type === "room").tokenReceipt.tokenTotals,
    guidance.getCards().find((card) => card.type === "room").tokenReceipt.tokenTotals,
  );
});

test("DOM builder and headless controller both reject an over-budget card set", () => {
  const { guidance, statusEl } = createDomGuidance();
  const controller = createCardBuilderController();
  const cards = [
    createDesignCard({ id: "atk_dom_over_budget", type: "delver", affinity: "fire", tokenHint: 5000, count: 1 }),
  ];

  assert.equal(guidance.setCards(cards.map((card) => createDesignCard(card))), false);
  assert.equal(controller.setCards(cards.map((card) => createDesignCard(card))), false);
  assert.equal(controller.getStatus().message, statusEl.textContent);
  assert.match(controller.getStatus().message, /allocation exceeded|budget/i);
});

test("DOM builder and headless controller match after build spec hydration", async () => {
  const { guidance } = createDomGuidance();
  const controller = createCardBuilderController();
  const spec = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "build_spec_dom",
      runId: "run_dom",
      createdAt: "2026-04-08T00:00:00.000Z",
      source: "cli-agent",
    },
    intent: { goal: "Hydrate both builders", hints: { budgetTokens: 5000 } },
    plan: {
      hints: {
        cardSet: [{ id: "warden_dom", type: "warden", count: 1, affinity: "earth", motivations: ["defending"] }],
      },
    },
    configurator: {
      inputs: {
        cardSet: [{ id: "room_dom", type: "room", count: 1, affinity: "fire", roomSize: "medium" }],
      },
    },
  };
  const state = extractDesignStateFromBuildSpec(spec);

  assert.equal((await controller.loadBuildSpec(spec)).ok, true);
  assert.equal(guidance.loadState({
    budgetTokens: state.budgetTokens,
    budgetSplitPercent: state.budgetSplitPercent || undefined,
    cards: state.cards,
  }), true);

  assert.deepEqual(
    controller.getCards().map((card) => card.type).sort(),
    guidance.getCards().map((card) => card.type).sort(),
  );
  const stripIds = (text) => JSON.parse(text).map(({ id, ...rest }) => rest);
  assert.deepEqual(stripIds(controller.serializeCards()), stripIds(guidance.serializeCards()));
});

test("DOM builder and headless controller match affinity-stack adjustments on a multi-affinity delver", () => {
  const { guidance } = createDomGuidance();
  const controller = createCardBuilderController();
  const cards = [
    createDesignCard({
      id: "atk_multi",
      type: "delver",
      affinity: "fire",
      affinities: [
        { kind: "fire", expression: "emit", stacks: 1 },
        { kind: "water", expression: "emit", stacks: 1 },
      ],
      motivations: ["attacking"],
    }),
  ];
  guidance.setCards(cards.map((card) => createDesignCard(card)));
  controller.setCards(cards.map((card) => createDesignCard(card)));

  const domCard = guidance.getCards()[0];
  const controllerCard = controller.getCards()[0];
  assert.equal(guidance.adjustAffinityStack(domCard.id, "water", 2, "emit"), true);
  assert.equal(controller.adjustAffinityStack(controllerCard.id, "water", 2, "emit"), true);

  assert.deepEqual(
    controller.getCards()[0].affinities,
    guidance.getCards()[0].affinities,
  );
  assert.deepEqual(
    controller.getCards()[0].tokenReceipt.tokenTotals,
    guidance.getCards()[0].tokenReceipt.tokenTotals,
  );
});

test("DOM builder and headless controller match the blank-editor state summary", () => {
  const { guidance } = createDomGuidance();
  const controller = createCardBuilderController();

  assert.deepEqual(controller.getCards(), guidance.getCards());
  assert.equal(controller.getActiveCard().type, guidance.getActiveCard().type);
  assert.deepEqual(controller.getSummary(), guidance.getSummary());
});
