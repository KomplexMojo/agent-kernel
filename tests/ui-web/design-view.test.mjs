import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustCardCount,
  buildCardsFromSummary,
  buildSummaryFromCardSet,
  createDesignCard,
  dropPropertyOnCard,
  groupCardsByType,
  normalizeDesignCardSet,
  serializeDesignCardSet,
  wireDesignGuidance,
} from "../../packages/ui-web/src/design-guidance.js";
import { wireDesignView } from "../../packages/ui-web/src/views/design-view.js";
import { buildSpecFromSummaryFlow as buildSpecFromSummaryViaCommandHost } from "../../packages/runtime/src/commands/ui-flow.js";

function selectorToDatasetKey(key) {
  return String(key).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function matchesSelector(node, selector) {
  if (!node || typeof selector !== "string") return false;
  if (selector.startsWith("#")) {
    return node.id === selector.slice(1);
  }
  if (selector.startsWith(".")) {
    const classes = String(node.className || "").split(/\s+/).filter(Boolean);
    return classes.includes(selector.slice(1));
  }
  const dataMatch = selector.match(/^\[data-([a-zA-Z0-9_-]+)="([^"]+)"\]$/);
  if (dataMatch) {
    const key = selectorToDatasetKey(dataMatch[1]);
    return String(node.dataset?.[key] || "") === dataMatch[2];
  }
  return String(node.tagName || "").toLowerCase() === selector.toLowerCase();
}

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
      add(...names) {
        const set = new Set(classNameValue.split(/\s+/).filter(Boolean));
        names.forEach((name) => set.add(name));
        classNameValue = Array.from(set).join(" ");
      },
      remove(...names) {
        const set = new Set(classNameValue.split(/\s+/).filter(Boolean));
        names.forEach((name) => set.delete(name));
        classNameValue = Array.from(set).join(" ");
      },
      toggle(name, force) {
        const set = new Set(classNameValue.split(/\s+/).filter(Boolean));
        const shouldAdd = force === undefined ? !set.has(name) : Boolean(force);
        if (shouldAdd) set.add(name);
        else set.delete(name);
        classNameValue = Array.from(set).join(" ");
        return shouldAdd;
      },
      contains(name) {
        const set = new Set(classNameValue.split(/\s+/).filter(Boolean));
        return set.has(name);
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
      if (child && typeof child === "object") {
        child.parentNode = this;
      }
      this.children.push(child);
      return child;
    },
    append(...parts) {
      parts.forEach((part) => {
        if (part && typeof part === "object") {
          this.appendChild(part);
        }
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
    trigger(event, payload = {}) {
      const listeners = handlers[event] || [];
      listeners.forEach((listener) => listener({ target: this, currentTarget: this, ...payload }));
    },
    querySelectorAll(selector) {
      const matches = [];
      const walk = (node) => {
        if (!node || !Array.isArray(node.children)) return;
        node.children.forEach((child) => {
          if (matchesSelector(child, selector)) {
            matches.push(child);
          }
          walk(child);
        });
      };
      walk(this);
      return matches;
    },
    querySelector(selector) {
      const matches = this.querySelectorAll(selector);
      return matches[0] || null;
    },
  };
}

function createDocumentStub() {
  const doc = {
    createElement(tagName) {
      return makeNode(tagName, doc);
    },
  };
  return doc;
}

function createRootElements() {
  const doc = createDocumentStub();
  const make = (tag = "div") => makeNode(tag, doc);
  const elements = {
    "#design-guidance-status": make("div"),
    "#design-property-group-type": make("div"),
    "#design-property-group-affinities": make("div"),
    "#design-property-group-expressions": make("div"),
    "#design-property-group-motivations": make("div"),
    "#design-card-grid": make("div"),
    "#design-card-group-room": make("div"),
    "#design-card-group-attacker": make("div"),
    "#design-card-group-defender": make("div"),
    "#design-card-group-budget-room": make("div"),
    "#design-card-group-budget-attacker": make("div"),
    "#design-card-group-budget-defender": make("div"),
    "#design-level-budget": make("input"),
    "#design-budget-split-room": make("input"),
    "#design-budget-split-attacker": make("input"),
    "#design-budget-split-defender": make("input"),
    "#design-budget-split-room-tokens": make("div"),
    "#design-budget-split-attacker-tokens": make("div"),
    "#design-budget-split-defender-tokens": make("div"),
    "#design-budget-overview": make("div"),
    "#design-ai-prompt": make("textarea"),
    "#design-ai-generate": make("button"),
    "#design-brief-output": make("pre"),
    "#design-spend-ledger-output": make("pre"),
    "#design-card-set-json": make("textarea"),
    "#design-auto-generate": make("button"),
    "#design-load-minted": make("button"),
  };
  elements["#design-level-budget"].value = "1000";
  elements["#design-budget-split-room"].value = "55";
  elements["#design-budget-split-attacker"].value = "20";
  elements["#design-budget-split-defender"].value = "25";

  const root = {
    querySelector(selector) {
      return elements[selector] || null;
    },
  };

  return { root, elements, doc };
}

function cardById(cards, id) {
  return cards.find((card) => card.id === id);
}

function parseConfigurationSpendChip(text = "") {
  const match = String(text).trim().match(/^(-?\d+)\/(-?\d+)$/);
  if (!match) return null;
  return {
    spent: Number(match[1]) || 0,
    allocated: Number(match[2]) || 0,
  };
}

test("unified card schema normalizes type-specific fields and serializes deterministically", () => {
  const cards = normalizeDesignCardSet([
    {
      id: "c2",
      type: "attacker",
      count: 2,
      affinity: "fire",
      motivations: ["attacking"],
      affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
      vitals: { health: { max: 8, regen: 1 } },
    },
    {
      id: "c1",
      type: "room",
      count: 1,
      affinity: "water",
      roomSize: "large",
      motivations: ["defending"],
    },
    {
      id: "c3",
      type: "defender",
      count: 1,
      affinity: "earth",
      motivations: ["defending"],
      affinities: [{ kind: "earth", expression: "emit", stacks: 1 }],
    },
  ]);

  const room = cardById(cards, "c1");
  const attacker = cardById(cards, "c2");
  const defender = cardById(cards, "c3");

  assert.equal(room.type, "room");
  assert.equal(room.roomSize, "large");
  assert.deepEqual(room.motivations, []);
  assert.equal(room.vitals, undefined);

  assert.equal(attacker.type, "attacker");
  assert.ok(attacker.vitals.health.max > 0);
  assert.ok(attacker.motivations.includes("attacking"));

  assert.equal(defender.type, "defender");
  assert.ok(defender.vitals.durability.max >= 1);

  const serializedA = serializeDesignCardSet(cards);
  const serializedB = serializeDesignCardSet(cards.slice().reverse());
  assert.equal(serializedA, serializedB);
});

test("new actor cards default vitals to max 10 and regen 2", () => {
  const attacker = createDesignCard({ type: "attacker", affinity: "fire", motivations: ["attacking"] });
  const defender = createDesignCard({ type: "defender", affinity: "earth", motivations: ["defending"] });
  ["health", "mana", "stamina", "durability"].forEach((key) => {
    assert.equal(attacker.vitals[key].current, 10);
    assert.equal(attacker.vitals[key].max, 10);
    assert.equal(attacker.vitals[key].regen, 2);
    assert.equal(defender.vitals[key].current, 10);
    assert.equal(defender.vitals[key].max, 10);
    assert.equal(defender.vitals[key].regen, 2);
  });
});

test("new attacker/defender cards default to light/dark emit affinity", () => {
  const attacker = createDesignCard({ type: "attacker" });
  const defender = createDesignCard({ type: "defender" });

  assert.equal(attacker.affinity, "light");
  assert.deepEqual(attacker.affinities, [{ kind: "light", expression: "emit", stacks: 1 }]);

  assert.equal(defender.affinity, "dark");
  assert.deepEqual(defender.affinities, [{ kind: "dark", expression: "emit", stacks: 1 }]);
});

test("room cards map to level inputs and room design shape", () => {
  const { summary } = buildSummaryFromCardSet({
    budgetTokens: 2000,
    cards: [
      createDesignCard({ id: "room_small", type: "room", roomSize: "small", affinity: "fire", count: 2 }),
      createDesignCard({ id: "room_large", type: "room", roomSize: "large", affinity: "earth", count: 1 }),
    ],
  });

  assert.ok(summary.layout.floorTiles > 0);
  assert.ok(summary.layout.connectorFloorTiles > 0);
  assert.ok(summary.layout.billableFloorTiles > 0);
  assert.equal(summary.roomDesign.roomCount, 3);
  assert.ok(summary.roomDesign.roomMinSize <= summary.roomDesign.roomMaxSize);
  assert.ok(summary.roomDesign.rooms.some((room) => room.size === "small"));
  assert.ok(summary.roomDesign.rooms.some((room) => room.size === "large"));
});

test("shared level budget propagates as room cards are added", () => {
  const base = buildSummaryFromCardSet({
    budgetTokens: 500,
    cards: [createDesignCard({ id: "r1", type: "room", roomSize: "small", count: 1 })],
  });
  const expanded = buildSummaryFromCardSet({
    budgetTokens: 500,
    cards: [createDesignCard({ id: "r1", type: "room", roomSize: "small", count: 3 })],
  });

  assert.ok(expanded.spendLedger.categories.levelConfig.spentTokens > base.spendLedger.categories.levelConfig.spentTokens);
  assert.ok(expanded.spendLedger.remainingTokens < base.spendLedger.remainingTokens);
});

test("card values update across room, attacker, and defender cards", () => {
  const room = createDesignCard({ id: "room", type: "room", roomSize: "medium", affinity: "fire", count: 1 });
  const attacker = createDesignCard({
    id: "atk",
    type: "attacker",
    affinity: "fire",
    count: 1,
    motivations: ["attacking"],
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
  });
  const defender = createDesignCard({
    id: "def",
    type: "defender",
    affinity: "earth",
    count: 1,
    motivations: ["defending"],
    affinities: [{ kind: "earth", expression: "emit", stacks: 1 }],
  });

  const initial = buildSummaryFromCardSet({ cards: [room, attacker, defender], budgetTokens: 4000 });
  const attackerInitialValue = cardById(initial.cards, "atk").cardValue.totalTokens;

  const withAffinity = dropPropertyOnCard(attacker, { group: "affinities", value: "water" }).card;
  const updated = buildSummaryFromCardSet({ cards: [room, withAffinity, defender], budgetTokens: 4000 });
  const attackerUpdatedValue = cardById(updated.cards, "atk").cardValue.totalTokens;

  assert.ok(cardById(initial.cards, "room").cardValue.totalTokens > 0);
  assert.ok(cardById(initial.cards, "def").cardValue.totalTokens > 0);
  assert.ok(attackerUpdatedValue > attackerInitialValue);
});

test("room affinity stack updates increase room card configuration value", () => {
  const room = createDesignCard({
    id: "room_aff",
    type: "room",
    affinity: "earth",
    roomSize: "medium",
    count: 1,
    affinities: [{ kind: "earth", expression: "push", stacks: 1 }],
  });
  const withHigherStacks = createDesignCard({
    ...room,
    affinities: [{ kind: "earth", expression: "push", stacks: 3 }],
  });

  const base = buildSummaryFromCardSet({ cards: [room], budgetTokens: 4000 });
  const updated = buildSummaryFromCardSet({ cards: [withHigherStacks], budgetTokens: 4000 });
  const baseValue = cardById(base.cards, "room_aff").cardValue.totalTokens;
  const updatedValue = cardById(updated.cards, "room_aff").cardValue.totalTokens;

  assert.ok(updatedValue > baseValue);
});

test("wireDesignGuidance uses single active card editor with vitals and stash/pull flow", () => {
  const { elements } = createRootElements();
  const guidance = wireDesignGuidance({
    elements: {
      statusEl: elements["#design-guidance-status"],
      leftRailType: elements["#design-property-group-type"],
      leftRailAffinities: elements["#design-property-group-affinities"],
      leftRailExpressions: elements["#design-property-group-expressions"],
      leftRailMotivations: elements["#design-property-group-motivations"],
      cardGrid: elements["#design-card-grid"],
      roomGroup: elements["#design-card-group-room"],
      attackerGroup: elements["#design-card-group-attacker"],
      defenderGroup: elements["#design-card-group-defender"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-attacker"],
      defenderGroupBudget: elements["#design-card-group-budget-defender"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-attacker"],
      budgetSplitDefenderInput: elements["#design-budget-split-defender"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-attacker-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-defender-tokens"],
      budgetOverviewEl: elements["#design-budget-overview"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  const firstTypeChip = elements["#design-property-group-type"].children[0];
  assert.ok(firstTypeChip.textContent.includes("Room"));
  assert.equal(elements["#design-budget-split-room-tokens"].textContent, "");
  assert.equal(elements["#design-budget-split-attacker-tokens"].textContent, "");
  assert.equal(elements["#design-budget-split-defender-tokens"].textContent, "");
  assert.equal(elements["#design-budget-overview"].textContent, "");
  const affinityGroups = elements["#design-property-group-affinities"].querySelectorAll(".design-property-chip-pair");
  assert.ok(affinityGroups.length >= 5);
  const fireWaterGroup = affinityGroups.find((group) => {
    const values = group.querySelectorAll("button").map((chip) => chip.dataset?.propertyValue);
    return values.includes("fire") && values.includes("water");
  });
  assert.ok(fireWaterGroup);
  const motivationExclusiveGroups = elements["#design-property-group-motivations"].querySelectorAll('[data-exclusive="true"]');
  assert.ok(motivationExclusiveGroups.length >= 3);
  const postureGroup = elements["#design-property-group-motivations"].querySelector('[data-property-group-id="posture"]');
  assert.ok(postureGroup);
  const postureNote = postureGroup.querySelector(".design-property-chip-group-note");
  assert.ok(postureNote);
  assert.equal(postureNote.textContent, "Choose 1");

  const blank = guidance.getActiveCard();
  assert.ok(blank);
  assert.equal(blank.type, "");
  assert.match(blank.id, /^C-[A-Z0-9]{6}$/);

  guidance.applyPropertyDrop(blank.id, { group: "type", value: "attacker" });
  const attacker = guidance.getActiveCard();
  assert.equal(attacker.type, "attacker");
  assert.match(attacker.id, /^A-[A-Z0-9]{6}$/);
  assert.equal(attacker.affinity, "light");
  assert.ok(attacker.affinities.some((entry) => entry.kind === "light" && entry.expression === "emit" && entry.stacks === 1));
  const initialConfigurationValue = attacker.cardValue.totalTokens;
  let renderedCard = elements["#design-card-grid"].children.find(
    (child) => child.dataset?.cardId === attacker.id,
  );
  const initialSpendChip = renderedCard.querySelector(".is-configuration-spend");
  assert.ok(initialSpendChip);
  const initialSpendValues = parseConfigurationSpendChip(initialSpendChip.textContent);
  assert.ok(initialSpendValues);
  assert.equal(initialSpendValues.spent, initialConfigurationValue);
  assert.ok(initialSpendValues.allocated > 0);
  const motivationSection = renderedCard.querySelector(".design-card-motivations");
  assert.ok(motivationSection);
  const motivationGroups = elements["#design-property-group-motivations"].querySelectorAll(".design-property-chip-pair");
  assert.ok(motivationGroups.length >= 3);
  const leftRailAttacking = elements["#design-property-group-motivations"].querySelector('[data-property-value="attacking"]');
  const leftRailDefending = elements["#design-property-group-motivations"].querySelector('[data-property-value="defending"]');
  assert.ok(leftRailAttacking);
  assert.ok(leftRailDefending);
  assert.equal(leftRailDefending.disabled, true);
  assert.equal(renderedCard.querySelector('[data-motivation-add="defending"]'), null);
  assert.equal(renderedCard.querySelectorAll(".design-card-motivation-label").length, 0);
  const removeAttacking = renderedCard.querySelector('[data-motivation-remove="attacking"]');
  assert.ok(removeAttacking);
  removeAttacking.trigger("click");
  let updated = guidance.getActiveCard();
  assert.ok(!updated.motivations.includes("attacking"));
  renderedCard = elements["#design-card-grid"].children.find(
    (child) => child.dataset?.cardId === attacker.id,
  );
  const leftRailDefendingAfterRemove = elements["#design-property-group-motivations"].querySelector('[data-property-value="defending"]');
  assert.ok(leftRailDefendingAfterRemove);
  assert.equal(leftRailDefendingAfterRemove.disabled, false);
  const addDefending = guidance.applyPropertyDrop(attacker.id, { group: "motivations", value: "defending" });
  assert.deepEqual(addDefending, { ok: true });
  updated = guidance.getActiveCard();
  assert.ok(updated.motivations.includes("defending"));
  renderedCard = elements["#design-card-grid"].children.find(
    (child) => child.dataset?.cardId === attacker.id,
  );
  assert.equal(renderedCard.querySelectorAll(".design-card-header .is-affinity").length, 0);
  assert.equal(renderedCard.querySelectorAll(".design-card-header .is-expression").length, 0);
  assert.equal(renderedCard.querySelectorAll(".design-card-header .is-motivation").length, 0);
  assert.equal(renderedCard.querySelectorAll(".design-card-traits .is-affinity").length, 0);
  assert.equal(renderedCard.querySelectorAll(".design-card-traits .is-expression").length, 0);
  assert.equal(renderedCard.querySelectorAll(".design-card-traits .is-motivation").length, 0);

  const headerCountControls = renderedCard.querySelector(".design-card-header-count-controls");
  assert.ok(headerCountControls);
  const headerCountPlus = headerCountControls.querySelector(".design-card-count-plus");
  const headerCountMinus = headerCountControls.querySelector(".design-card-count-minus");
  assert.ok(headerCountPlus);
  assert.ok(headerCountMinus);
  headerCountPlus.trigger("click");
  updated = guidance.getActiveCard();
  assert.equal(updated.count, attacker.count + 1);
  headerCountMinus.trigger("click");
  updated = guidance.getActiveCard();
  assert.equal(updated.count, attacker.count);

  const healthBefore = updated.vitals.health.max;
  guidance.adjustVital(attacker.id, "health", "max", 1);
  updated = guidance.getActiveCard();
  assert.equal(updated.vitals.health.max, healthBefore + 1);

  renderedCard = elements["#design-card-grid"].children.find(
    (child) => child.dataset?.cardId === attacker.id,
  );
  const firstVitalRow = renderedCard.querySelector(".design-card-vital-row");
  assert.ok(firstVitalRow);
  const plusButtons = firstVitalRow.querySelectorAll(".design-card-vital-plus");
  const minusButtons = firstVitalRow.querySelectorAll(".design-card-vital-minus");
  assert.equal(plusButtons.length, 2);
  assert.equal(minusButtons.length, 2);
  const maxBeforeControl = updated.vitals.health.max;
  const regenBeforeControl = updated.vitals.health.regen;
  plusButtons[0].trigger("click");
  updated = guidance.getActiveCard();
  assert.equal(updated.vitals.health.max, maxBeforeControl + 10);
  minusButtons[0].trigger("click");
  updated = guidance.getActiveCard();
  assert.equal(updated.vitals.health.max, maxBeforeControl);
  plusButtons[1].trigger("click");
  updated = guidance.getActiveCard();
  assert.equal(updated.vitals.health.regen, regenBeforeControl + 2);
  minusButtons[1].trigger("click");
  updated = guidance.getActiveCard();
  assert.equal(updated.vitals.health.regen, regenBeforeControl);

  guidance.flipCard(attacker.id);
  updated = guidance.getActiveCard();
  assert.equal(updated.flipped, true);

  guidance.applyPropertyDrop(attacker.id, { group: "affinities", value: "water" });
  guidance.applyPropertyDrop(attacker.id, { group: "expressions", value: "emit" });
  guidance.adjustAffinityStack(attacker.id, "water", 2, "emit");
  updated = guidance.getActiveCard();
  renderedCard = elements["#design-card-grid"].children.find(
    (child) => child.dataset?.cardId === attacker.id,
  );
  const updatedConfigurationValue = updated.cardValue.totalTokens;
  assert.ok(updatedConfigurationValue > initialConfigurationValue);
  const updatedSpendChip = renderedCard.querySelector(".is-configuration-spend");
  assert.ok(updatedSpendChip);
  const updatedSpendValues = parseConfigurationSpendChip(updatedSpendChip.textContent);
  assert.ok(updatedSpendValues);
  assert.equal(updatedSpendValues.spent, updatedConfigurationValue);
  assert.ok(updatedSpendValues.spent > initialSpendValues.spent);
  assert.ok(updated.tokenReceipt.affinities.some((entry) => entry.startsWith("water:emitx3")));
  assert.ok(Array.isArray(updated.tokenReceipt.lineItems));
  assert.ok(updated.tokenReceipt.lineItems.length > 0);
  assert.equal(
    updated.tokenReceipt.lineItems.reduce((sum, entry) => sum + (entry.totalTokens || 0), 0),
    updated.tokenReceipt.tokenTotals.total,
  );

  assert.ok(renderedCard.classList.contains("flipped"));
  const backFlipButton = renderedCard.querySelector(".design-card-flip-back");
  assert.ok(backFlipButton);
  backFlipButton.trigger("click");
  updated = guidance.getActiveCard();
  assert.equal(updated.flipped, false);

  assert.equal(guidance.setBudgetSplit("attacker", 100), true);
  guidance.stashActiveCard("attacker");
  assert.equal(guidance.getCards().length, 1);
  assert.equal(guidance.getCards()[0].id, attacker.id);
  assert.notEqual(guidance.getActiveCard().id, attacker.id, "active card is replaced with a fresh editor card id");
  assert.equal(guidance.getActiveCard().type, "");
  const shelvedRow = elements["#design-card-group-attacker"].children.find((child) => child.dataset?.cardId === attacker.id);
  assert.ok(shelvedRow);
  assert.equal(shelvedRow.querySelectorAll(".is-expression").length, 0);
  assert.ok(shelvedRow.querySelectorAll(".is-affinity").length >= 1);
  assert.ok(shelvedRow.querySelectorAll(".is-motivation").length >= 1);
  assert.match(elements["#design-card-group-budget-attacker"].textContent, /^1000 - \[\d+\] = -?\d+$/);
  assert.equal(elements["#design-card-group-budget-room"].textContent, "550 - [0] = 550");

  guidance.pullCardToEditor(attacker.id);
  assert.equal(guidance.getCards().length, 0);
  assert.equal(guidance.getActiveCard().id, attacker.id);
  assert.equal(guidance.getActiveCard().type, "attacker");

  elements["#design-budget-split-room"].value = "60";
  elements["#design-budget-split-room"].trigger("input");
  assert.equal(elements["#design-budget-split-room-tokens"].textContent, "");
});

test("wireDesignGuidance shows default help text until a drop error occurs", () => {
  const { elements } = createRootElements();
  const guidance = wireDesignGuidance({
    elements: {
      statusEl: elements["#design-guidance-status"],
      leftRailType: elements["#design-property-group-type"],
      leftRailAffinities: elements["#design-property-group-affinities"],
      leftRailExpressions: elements["#design-property-group-expressions"],
      leftRailMotivations: elements["#design-property-group-motivations"],
      cardGrid: elements["#design-card-grid"],
      roomGroup: elements["#design-card-group-room"],
      attackerGroup: elements["#design-card-group-attacker"],
      defenderGroup: elements["#design-card-group-defender"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-attacker"],
      defenderGroupBudget: elements["#design-card-group-budget-defender"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-attacker"],
      budgetSplitDefenderInput: elements["#design-budget-split-defender"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-attacker-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-defender-tokens"],
      budgetOverviewEl: elements["#design-budget-overview"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  assert.equal(elements["#design-guidance-status"].hidden, false);
  assert.equal(elements["#design-guidance-status"].dataset.level, "info");
  assert.equal(
    elements["#design-guidance-status"].textContent,
    "Configure one card in the center, then pull it right into grouped Room/Attacker/Defender shelves.",
  );

  const blank = guidance.getActiveCard();
  const result = guidance.applyPropertyDrop(blank.id, { group: "affinities", value: "fire" });

  assert.equal(result.ok, true);
  assert.equal(elements["#design-guidance-status"].hidden, false);
  assert.equal(elements["#design-guidance-status"].dataset.level, "error");
  assert.match(elements["#design-guidance-status"].textContent, /Drop blocked: missing_type\./);
});

test("wireDesignGuidance auto-generates cards to fill the remaining per-type allocation", () => {
  const { elements } = createRootElements();
  const guidance = wireDesignGuidance({
    elements: {
      statusEl: elements["#design-guidance-status"],
      leftRailType: elements["#design-property-group-type"],
      leftRailAffinities: elements["#design-property-group-affinities"],
      leftRailExpressions: elements["#design-property-group-expressions"],
      leftRailMotivations: elements["#design-property-group-motivations"],
      cardGrid: elements["#design-card-grid"],
      roomGroup: elements["#design-card-group-room"],
      attackerGroup: elements["#design-card-group-attacker"],
      defenderGroup: elements["#design-card-group-defender"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-attacker"],
      defenderGroupBudget: elements["#design-card-group-budget-defender"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-attacker"],
      budgetSplitDefenderInput: elements["#design-budget-split-defender"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-attacker-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-defender-tokens"],
      budgetOverviewEl: elements["#design-budget-overview"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  const result = guidance.autoGenerateCards();

  assert.equal(result?.ok, true);
  const cards = guidance.getCards();
  assert.ok(cards.some((card) => card.type === "room"));
  assert.ok(cards.some((card) => card.type === "attacker"));
  assert.ok(cards.some((card) => card.type === "defender"));
  const spendLedger = guidance.getSpendLedger();
  assert.ok(spendLedger);
  assert.ok(spendLedger.allocations.room.usedTokens <= spendLedger.allocations.room.allocatedTokens);
  assert.ok(spendLedger.allocations.attacker.usedTokens <= spendLedger.allocations.attacker.allocatedTokens);
  assert.ok(spendLedger.allocations.defender.usedTokens <= spendLedger.allocations.defender.allocatedTokens);
  assert.ok(spendLedger.allocations.room.remainingTokens < 28);
  assert.ok(spendLedger.allocations.attacker.remainingTokens < 64);
  assert.ok(spendLedger.allocations.defender.remainingTokens < 64);
  assert.equal(elements["#design-guidance-status"].dataset.level, "info");
  assert.match(elements["#design-guidance-status"].textContent, /Auto-generated/i);
});

test("wireDesignGuidance auto-generate tops up remaining allocation without replacing existing cards", () => {
  const { elements } = createRootElements();
  const guidance = wireDesignGuidance({
    elements: {
      statusEl: elements["#design-guidance-status"],
      leftRailType: elements["#design-property-group-type"],
      leftRailAffinities: elements["#design-property-group-affinities"],
      leftRailExpressions: elements["#design-property-group-expressions"],
      leftRailMotivations: elements["#design-property-group-motivations"],
      cardGrid: elements["#design-card-grid"],
      roomGroup: elements["#design-card-group-room"],
      attackerGroup: elements["#design-card-group-attacker"],
      defenderGroup: elements["#design-card-group-defender"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-attacker"],
      defenderGroupBudget: elements["#design-card-group-budget-defender"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-attacker"],
      budgetSplitDefenderInput: elements["#design-budget-split-defender"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-attacker-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-defender-tokens"],
      budgetOverviewEl: elements["#design-budget-overview"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  const existing = createDesignCard({
    id: "existing_attacker",
    type: "attacker",
    affinity: "fire",
    motivations: ["attacking"],
    count: 1,
  });
  assert.equal(guidance.setCards([existing]), true);
  const preservedId = guidance.getCards()[0]?.id;

  const result = guidance.autoGenerateCards();

  assert.equal(result?.ok, true);
  const cards = guidance.getCards();
  assert.ok(cards.some((card) => card.id === preservedId));
  assert.ok(cards.length > 1);
  const spendLedger = guidance.getSpendLedger();
  assert.ok(spendLedger.allocations.attacker.remainingTokens < 64);
});

test("wireDesignGuidance assigns unique prefixed card identifiers", () => {
  const { elements } = createRootElements();
  const guidance = wireDesignGuidance({
    elements: {
      statusEl: elements["#design-guidance-status"],
      leftRailType: elements["#design-property-group-type"],
      leftRailAffinities: elements["#design-property-group-affinities"],
      leftRailExpressions: elements["#design-property-group-expressions"],
      leftRailMotivations: elements["#design-property-group-motivations"],
      cardGrid: elements["#design-card-grid"],
      roomGroup: elements["#design-card-group-room"],
      attackerGroup: elements["#design-card-group-attacker"],
      defenderGroup: elements["#design-card-group-defender"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-attacker"],
      defenderGroupBudget: elements["#design-card-group-budget-defender"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-attacker"],
      budgetSplitDefenderInput: elements["#design-budget-split-defender"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-attacker-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-defender-tokens"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  guidance.addCard({ type: "room", affinity: "fire", roomSize: "small" });
  guidance.stashActiveCard("room");
  guidance.addCard({ type: "attacker", affinity: "fire", motivations: ["attacking"] });
  guidance.stashActiveCard("attacker");
  guidance.addCard({ type: "defender", affinity: "earth", motivations: ["defending"] });
  guidance.stashActiveCard("defender");

  const cards = guidance.getCards();
  assert.equal(cards.length, 3);
  assert.match(cards.find((card) => card.type === "room").id, /^R-[A-Z0-9]{6}$/);
  assert.match(cards.find((card) => card.type === "attacker").id, /^A-[A-Z0-9]{6}$/);
  assert.match(cards.find((card) => card.type === "defender").id, /^D-[A-Z0-9]{6}$/);
  const ids = cards.map((card) => card.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("wireDesignGuidance card identifiers retry UUID collisions without numeric fallback", () => {
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const scriptedUuids = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  ];
  let uuidCalls = 0;

  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    writable: true,
    value: {
      randomUUID() {
        const fallbackHex = uuidCalls.toString(16).padStart(32, "0").slice(-32);
        const value = scriptedUuids[uuidCalls]
          || `${fallbackHex.slice(0, 8)}-${fallbackHex.slice(8, 12)}-4${fallbackHex.slice(13, 16)}-8${fallbackHex.slice(17, 20)}-${fallbackHex.slice(20)}`;
        uuidCalls += 1;
        return value;
      },
    },
  });

  try {
    const { elements } = createRootElements();
    const guidance = wireDesignGuidance({
      elements: {
        statusEl: elements["#design-guidance-status"],
        leftRailType: elements["#design-property-group-type"],
        leftRailAffinities: elements["#design-property-group-affinities"],
        leftRailExpressions: elements["#design-property-group-expressions"],
        leftRailMotivations: elements["#design-property-group-motivations"],
        cardGrid: elements["#design-card-grid"],
        roomGroup: elements["#design-card-group-room"],
        attackerGroup: elements["#design-card-group-attacker"],
        defenderGroup: elements["#design-card-group-defender"],
        roomGroupBudget: elements["#design-card-group-budget-room"],
        attackerGroupBudget: elements["#design-card-group-budget-attacker"],
        defenderGroupBudget: elements["#design-card-group-budget-defender"],
        levelBudgetInput: elements["#design-level-budget"],
        budgetSplitRoomInput: elements["#design-budget-split-room"],
        budgetSplitAttackerInput: elements["#design-budget-split-attacker"],
        budgetSplitDefenderInput: elements["#design-budget-split-defender"],
        budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
        budgetSplitAttackerTokens: elements["#design-budget-split-attacker-tokens"],
        budgetSplitDefenderTokens: elements["#design-budget-split-defender-tokens"],
        aiPromptInput: elements["#design-ai-prompt"],
        aiGenerateButton: elements["#design-ai-generate"],
        briefOutput: elements["#design-brief-output"],
        spendLedgerOutput: elements["#design-spend-ledger-output"],
        cardSetOutput: elements["#design-card-set-json"],
      },
    });

    guidance.addCard({ type: "room", affinity: "fire", roomSize: "small" });
    assert.equal(guidance.stashActiveCard("room"), true);
    guidance.addCard({ type: "room", affinity: "water", roomSize: "medium" });
    assert.equal(guidance.stashActiveCard("room"), true);

    const roomCards = guidance.getCards().filter((card) => card.type === "room");
    assert.equal(roomCards.length, 2);
    assert.match(roomCards[0].id, /^R-[A-Z0-9]{6}$/);
    assert.match(roomCards[1].id, /^R-[A-Z0-9]{6}$/);
    assert.notEqual(roomCards[0].id, roomCards[1].id);
    assert.ok(uuidCalls >= 6, "UUID generator should be invoked extra times when collisions occur");
  } finally {
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
    } else {
      delete globalThis.crypto;
    }
  }
});

test("wireDesignGuidance enforces per-group allocation caps", () => {
  const { elements } = createRootElements();
  const guidance = wireDesignGuidance({
    elements: {
      statusEl: elements["#design-guidance-status"],
      leftRailType: elements["#design-property-group-type"],
      leftRailAffinities: elements["#design-property-group-affinities"],
      leftRailExpressions: elements["#design-property-group-expressions"],
      leftRailMotivations: elements["#design-property-group-motivations"],
      cardGrid: elements["#design-card-grid"],
      roomGroup: elements["#design-card-group-room"],
      attackerGroup: elements["#design-card-group-attacker"],
      defenderGroup: elements["#design-card-group-defender"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-attacker"],
      defenderGroupBudget: elements["#design-card-group-budget-defender"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-attacker"],
      budgetSplitDefenderInput: elements["#design-budget-split-defender"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-attacker-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-defender-tokens"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  guidance.addCard({
    id: "atk_big",
    type: "attacker",
    affinity: "fire",
    motivations: ["attacking"],
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    tokenHint: 5000,
  });
  const stashed = guidance.stashActiveCard("attacker");
  assert.equal(stashed, false);
  assert.equal(guidance.getCards().length, 0);
  assert.match(elements["#design-guidance-status"].textContent, /allocation exceeded/i);

  guidance.addCard({
    id: "atk_small",
    type: "attacker",
    affinity: "fire",
    motivations: ["attacking"],
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    tokenHint: 10,
  });
  assert.equal(guidance.stashActiveCard("attacker"), true);
  assert.equal(guidance.getCards().length, 1);
  assert.equal(guidance.setBudgetSplit("attacker", 0), false);
  assert.equal(elements["#design-budget-split-attacker"].value, "20");
  assert.match(elements["#design-guidance-status"].textContent, /allocation exceeded/i);
});

test("wireDesignGuidance shows configuration spend helper for room, attacker, and defender", () => {
  const { elements } = createRootElements();
  const guidance = wireDesignGuidance({
    elements: {
      statusEl: elements["#design-guidance-status"],
      leftRailType: elements["#design-property-group-type"],
      leftRailAffinities: elements["#design-property-group-affinities"],
      leftRailExpressions: elements["#design-property-group-expressions"],
      leftRailMotivations: elements["#design-property-group-motivations"],
      cardGrid: elements["#design-card-grid"],
      roomGroup: elements["#design-card-group-room"],
      attackerGroup: elements["#design-card-group-attacker"],
      defenderGroup: elements["#design-card-group-defender"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-attacker"],
      defenderGroupBudget: elements["#design-card-group-budget-defender"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-attacker"],
      budgetSplitDefenderInput: elements["#design-budget-split-defender"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-attacker-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-defender-tokens"],
      budgetOverviewEl: elements["#design-budget-overview"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  const assertSpendChipForActive = () => {
    const active = guidance.getActiveCard();
    const rendered = elements["#design-card-grid"].children.find((child) => child.dataset?.cardId === active.id);
    assert.ok(rendered);
    const spendChip = rendered.querySelector(".is-configuration-spend");
    assert.ok(spendChip);
    const spend = parseConfigurationSpendChip(spendChip.textContent);
    assert.ok(spend);
    const allocatedByType = Number(guidance.getSpendLedger()?.allocations?.[active.type]?.allocatedTokens || 0);
    assert.equal(spend.spent, active.cardValue.totalTokens);
    assert.equal(spend.allocated, allocatedByType);
  };

  guidance.addCard({ type: "room", roomSize: "small", affinity: "dark" });
  assertSpendChipForActive();

  guidance.addCard({ type: "attacker", affinity: "fire", motivations: ["attacking"] });
  assertSpendChipForActive();

  guidance.addCard({ type: "defender", affinity: "earth", motivations: ["defending"] });
  assertSpendChipForActive();
});

test("wireDesignGuidance configuration spend helper uses total room allocation for denominator", () => {
  const { elements } = createRootElements();
  const guidance = wireDesignGuidance({
    elements: {
      statusEl: elements["#design-guidance-status"],
      leftRailType: elements["#design-property-group-type"],
      leftRailAffinities: elements["#design-property-group-affinities"],
      leftRailExpressions: elements["#design-property-group-expressions"],
      leftRailMotivations: elements["#design-property-group-motivations"],
      cardGrid: elements["#design-card-grid"],
      roomGroup: elements["#design-card-group-room"],
      attackerGroup: elements["#design-card-group-attacker"],
      defenderGroup: elements["#design-card-group-defender"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-attacker"],
      defenderGroupBudget: elements["#design-card-group-budget-defender"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-attacker"],
      budgetSplitDefenderInput: elements["#design-budget-split-defender"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-attacker-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-defender-tokens"],
      budgetOverviewEl: elements["#design-budget-overview"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  guidance.addCard({ type: "room", roomSize: "small", affinity: "dark" });
  const firstRoom = guidance.getActiveCard();
  assert.equal(guidance.stashActiveCard("room"), true);

  const spendAfterFirstRoom = guidance.getSpendLedger();
  const roomAllocation = Number(spendAfterFirstRoom?.allocations?.room?.allocatedTokens || 0);
  const usedByOtherRooms = Number(spendAfterFirstRoom?.allocations?.room?.usedTokens || 0);
  assert.ok(usedByOtherRooms >= firstRoom.cardValue.totalTokens);

  guidance.addCard({ type: "room", roomSize: "large", affinity: "water" });
  const secondRoom = guidance.getActiveCard();
  const rendered = elements["#design-card-grid"].children.find((child) => child.dataset?.cardId === secondRoom.id);
  assert.ok(rendered);
  const spendChip = rendered.querySelector(".is-configuration-spend");
  assert.ok(spendChip);
  const spend = parseConfigurationSpendChip(spendChip.textContent);
  assert.ok(spend);
  assert.equal(spend.spent, secondRoom.cardValue.totalTokens);
  assert.equal(spend.allocated, roomAllocation);
});

test("wireDesignGuidance applies card count multiplier to vitality token updates", () => {
  const { elements } = createRootElements();
  const guidance = wireDesignGuidance({
    elements: {
      statusEl: elements["#design-guidance-status"],
      leftRailType: elements["#design-property-group-type"],
      leftRailAffinities: elements["#design-property-group-affinities"],
      leftRailExpressions: elements["#design-property-group-expressions"],
      leftRailMotivations: elements["#design-property-group-motivations"],
      cardGrid: elements["#design-card-grid"],
      roomGroup: elements["#design-card-group-room"],
      attackerGroup: elements["#design-card-group-attacker"],
      defenderGroup: elements["#design-card-group-defender"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-attacker"],
      defenderGroupBudget: elements["#design-card-group-budget-defender"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-attacker"],
      budgetSplitDefenderInput: elements["#design-budget-split-defender"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-attacker-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-defender-tokens"],
      budgetOverviewEl: elements["#design-budget-overview"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  guidance.addCard({ type: "defender", affinity: "earth", motivations: ["defending"], count: 2 });
  const defender = guidance.getActiveCard();
  const renderedBefore = elements["#design-card-grid"].children.find((child) => child.dataset?.cardId === defender.id);
  assert.ok(renderedBefore);
  const spendChipBefore = renderedBefore.querySelector(".is-configuration-spend");
  assert.ok(spendChipBefore);
  const spendBefore = parseConfigurationSpendChip(spendChipBefore.textContent);
  assert.ok(spendBefore);
  assert.equal(spendBefore.spent, defender.cardValue.totalTokens);

  guidance.adjustVital(defender.id, "health", "max", 10);
  const updated = guidance.getActiveCard();
  const renderedAfter = elements["#design-card-grid"].children.find((child) => child.dataset?.cardId === updated.id);
  assert.ok(renderedAfter);
  const spendChipAfter = renderedAfter.querySelector(".is-configuration-spend");
  assert.ok(spendChipAfter);
  const spendAfter = parseConfigurationSpendChip(spendChipAfter.textContent);
  assert.ok(spendAfter);

  assert.equal(updated.count, 2);
  assert.equal(spendAfter.spent - spendBefore.spent, 20);
  assert.equal(spendBefore.allocated, spendAfter.allocated);
});

test("wireDesignGuidance minus at x1 resets active typed card to blank editor", () => {
  const { elements } = createRootElements();
  const guidance = wireDesignGuidance({
    elements: {
      statusEl: elements["#design-guidance-status"],
      leftRailType: elements["#design-property-group-type"],
      leftRailAffinities: elements["#design-property-group-affinities"],
      leftRailExpressions: elements["#design-property-group-expressions"],
      leftRailMotivations: elements["#design-property-group-motivations"],
      cardGrid: elements["#design-card-grid"],
      roomGroup: elements["#design-card-group-room"],
      attackerGroup: elements["#design-card-group-attacker"],
      defenderGroup: elements["#design-card-group-defender"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-attacker"],
      defenderGroupBudget: elements["#design-card-group-budget-defender"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-attacker"],
      budgetSplitDefenderInput: elements["#design-budget-split-defender"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-attacker-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-defender-tokens"],
      budgetOverviewEl: elements["#design-budget-overview"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  const blank = guidance.getActiveCard();
  guidance.applyPropertyDrop(blank.id, { group: "type", value: "attacker" });
  const configured = guidance.getActiveCard();
  assert.equal(configured.type, "attacker");
  assert.equal(configured.count, 1);

  const renderedCard = elements["#design-card-grid"].children.find(
    (child) => child.dataset?.cardId === configured.id,
  );
  assert.ok(renderedCard);
  const minus = renderedCard.querySelector(".design-card-count-minus");
  assert.ok(minus);
  minus.trigger("click");

  const reset = guidance.getActiveCard();
  assert.equal(reset.type, "");
  assert.equal(reset.count, 1);
  assert.match(reset.id, /^C-[A-Z0-9]{6}$/);
  assert.notEqual(reset.id, configured.id);
  assert.equal(guidance.getCards().length, 0);
  assert.match(elements["#design-guidance-status"].textContent, /reset to blank editor/i);
});

test("wireDesignView publishes preview spec from the current card model", async () => {
  const { root, elements } = createRootElements();
  const publishedSpecs = [];
  let buildSpecCalls = 0;
  const commandHost = {
    async buildSpecFromSummary(payload) {
      buildSpecCalls += 1;
      return buildSpecFromSummaryViaCommandHost(payload);
    },
  };

  const view = wireDesignView({
    root,
    commandHost,
    onSendBuildSpec: ({ spec }) => publishedSpecs.push(spec),
    onRunBuild: async () => {
      runBuildCount += 1;
      return { ok: true };
    },
    onLoadBundle: async () => {
      loadCount += 1;
      return true;
    },
    onOpenSimulation: () => {
      openSimulationCount += 1;
    },
    onOpenPreview: () => {
      openPreviewCount += 1;
    },
  });

  view.setCards([
    createDesignCard({ id: "room_build", type: "room", roomSize: "medium", affinity: "fire", count: 3 }),
    createDesignCard({ id: "atk_build", type: "attacker", affinity: "fire", motivations: ["attacking"], count: 1 }),
    createDesignCard({ id: "def_build", type: "defender", affinity: "earth", motivations: ["defending"], count: 1 }),
  ]);

  const published = await view.publishPreviewSpec({ force: true });

  assert.equal(published?.ok, true);
  assert.ok(publishedSpecs.length >= 1);
  assert.ok(buildSpecCalls >= 1);
  const latestSpec = publishedSpecs[publishedSpecs.length - 1];
  assert.ok(Array.isArray(latestSpec.plan?.hints?.cardSet));
  assert.ok(latestSpec.configurator?.inputs?.levelGen);
  assert.equal(latestSpec.configurator.inputs.levelGen.shape.roomCount, 3);
});

test("wireDesignView publishes preview spec through the command host even with a minimal budget", async () => {
  const { root, elements } = createRootElements();
  elements["#design-level-budget"].value = "1";

  let buildSpecCalls = 0;
  const commandHost = {
    async buildSpecFromSummary(payload) {
      buildSpecCalls += 1;
      return buildSpecFromSummaryViaCommandHost(payload);
    },
  };

  const view = wireDesignView({
    root,
    commandHost,
  });

  view.setCards([
    createDesignCard({ id: "room_over_budget", type: "room", roomSize: "large", affinity: "fire", count: 1, tokenHint: 5000 }),
    createDesignCard({ id: "atk_over_budget", type: "attacker", affinity: "fire", motivations: ["attacking"], count: 1, tokenHint: 5000 }),
  ]);

  const published = await view.publishPreviewSpec({ force: true });

  assert.ok(buildSpecCalls >= 1);
  assert.equal(published?.ok, true);
});

test("wireDesignView publishes single-element card sets for preview", async () => {
  const scenarios = [
    {
      label: "single room",
      cards: [createDesignCard({ id: "room_only", type: "room", roomSize: "small", affinity: "dark", count: 1 })],
      expectedType: "room",
    },
    {
      label: "single attacker",
      cards: [
        createDesignCard({
          id: "attacker_only",
          type: "attacker",
          affinity: "fire",
          motivations: ["attacking"],
          count: 1,
        }),
      ],
      expectedType: "attacker",
    },
  ];

  for (const scenario of scenarios) {
    const { root } = createRootElements();
    let publishedSpecs = [];

    const commandHost = {
      async buildSpecFromSummary(payload) {
        return buildSpecFromSummaryViaCommandHost(payload);
      },
    };

    const view = wireDesignView({
      root,
      commandHost,
      onSendBuildSpec: ({ spec }) => {
        publishedSpecs.push(spec);
      },
    });

    view.setCards(scenario.cards);
    const published = await view.publishPreviewSpec({ force: true });

    assert.equal(published?.ok, true, `${scenario.label} should publish successfully`);
    assert.ok(publishedSpecs.length >= 1, `${scenario.label} should publish a spec`);

    const latestSpec = publishedSpecs[publishedSpecs.length - 1];
    const cardSet = latestSpec?.plan?.hints?.cardSet || [];
    assert.equal(cardSet.length, 1, `${scenario.label} should publish exactly one design card`);
    assert.equal(cardSet[0]?.type, scenario.expectedType, `${scenario.label} should preserve the card type`);
    assert.ok(latestSpec?.configurator?.inputs?.levelGen, `${scenario.label} should still include level generation`);
  }
});

test("wireDesignView can publish a preview spec from the blank editor state", async () => {
  const { root } = createRootElements();

  const commandHost = {
    async buildSpecFromSummary(payload) {
      return buildSpecFromSummaryViaCommandHost(payload);
    },
  };

  const view = wireDesignView({
    root,
    commandHost,
  });

  const published = await view.publishPreviewSpec({ force: true });

  assert.equal(published?.ok, true);
  assert.ok(published?.spec);
  assert.equal(typeof published?.specText, "string");
});

test("wireDesignView mints active card via blockchain rails and can load it back by token id", async () => {
  const { root, elements } = createRootElements();
  elements["#design-budget-split-room"].value = "0";
  elements["#design-budget-split-attacker"].value = "100";
  elements["#design-budget-split-defender"].value = "0";
  const mintedByToken = new Map();
  let mintCalls = 0;
  let loadCalls = 0;

  const commandHost = {
    async buildSpecFromSummary(payload) {
      return buildSpecFromSummaryViaCommandHost(payload);
    },
    async blockchainMint(payload) {
      mintCalls += 1;
      const tokenId = payload.tokenId || "token_test_1";
      mintedByToken.set(tokenId, payload.cardJson);
      return {
        output: {
          chainId: "0x1",
          tokenId,
          card: payload.cardJson,
        },
      };
    },
    async blockchainLoad(payload) {
      loadCalls += 1;
      const fallbackCard = {
        id: "A-LOADED1",
        type: "attacker",
        count: 1,
        affinity: "fire",
        affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
        motivations: ["attacking"],
      };
      return {
        output: {
          chainId: "0x1",
          tokenId: payload.tokenId,
          card: mintedByToken.get(payload.tokenId) || fallbackCard,
        },
      };
    },
  };

  const view = wireDesignView({
    root,
    commandHost,
  });

  const active = view.getActiveCard();
  view.applyPropertyDrop(active.id, { group: "type", value: "attacker" });
  const configured = view.getActiveCard();
  view.applyPropertyDrop(configured.id, { group: "affinities", value: "fire" });

  const minted = await view.mintActiveCard("attacker");
  assert.equal(minted?.ok, true);
  assert.equal(mintCalls, 1);
  assert.equal(view.getCards().length, 1);

  const tokenId = minted.tokenId || "token_test_1";
  const loaded = await view.loadMintedCard(tokenId);
  assert.equal(loaded?.ok, true, JSON.stringify(loaded));
  assert.equal(loadCalls, 1);
  assert.equal(view.getActiveCard().type, "attacker");
});

test("AI summary round-trip populates editable card model", async () => {
  const { root } = createRootElements();
  const aiSummary = {
    dungeonAffinity: "water",
    rooms: [{ affinity: "water", size: "small", count: 2 }],
    actors: [{ motivation: "defending", affinity: "earth", count: 1 }],
    attackerConfigs: [{
      setupMode: "hybrid",
      vitalsMax: { health: 8, mana: 6, stamina: 5, durability: 3 },
      vitalsRegen: { health: 1, mana: 1, stamina: 1, durability: 0 },
      affinities: { water: ["emit"] },
      affinityStacks: { water: 2 },
    }],
  };

  const view = wireDesignView({
    root,
    llmConfig: { aiSummary },
  });

  const aiResult = await view.generateAiConfiguration({ prompt: "Generate a water setup." });
  assert.equal(aiResult.ok, true);

  const cards = view.getCards();
  assert.ok(cards.some((card) => card.type === "room"));
  assert.ok(cards.some((card) => card.type === "attacker"));
  assert.ok(cards.some((card) => card.type === "defender"));

  const defender = cards.find((card) => card.type === "defender");
  view.pullCardToEditor(defender.id);
  const active = view.getActiveCard();
  assert.equal(active.id, defender.id);
  view.applyPropertyDrop(active.id, { group: "affinities", value: "fire" });
  view.stashActiveCard("defender");

  const updated = view.getCards().find((card) => card.id === defender.id);
  assert.ok(updated.affinities.some((entry) => entry.kind === "fire"));
});

test("groupCardsByType and count updates preserve card payload while regrouping", () => {
  const cards = [
    createDesignCard({ id: "r", type: "room", count: 1, roomSize: "small" }),
    createDesignCard({ id: "a", type: "attacker", count: 1, motivations: ["attacking"] }),
    createDesignCard({ id: "d", type: "defender", count: 2, motivations: ["defending"] }),
  ];

  const adjusted = [cards[0], adjustCardCount(cards[1], 2), adjustCardCount(cards[2], -1)];
  const grouped = groupCardsByType(adjusted);

  assert.equal(grouped.room.length, 1);
  assert.equal(grouped.attacker[0].count, 3);
  assert.equal(grouped.defender[0].count, 1);
  assert.ok(grouped.attacker[0].vitals.health.max > 0);
});
