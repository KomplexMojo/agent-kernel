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
  setResourceBundle as setDesignResourceBundle,
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
    "#design-card-group-delver": make("div"),
    "#design-card-group-warden": make("div"),
    "#design-card-group-hazard": make("div"),
    "#design-card-group-resource": make("div"),
    "#design-card-group-budget-room": make("div"),
    "#design-card-group-budget-delver": make("div"),
    "#design-card-group-budget-warden": make("div"),
    "#design-card-group-budget-resource": make("div"),
    "#design-level-budget": make("input"),
    "#design-budget-split-room": make("input"),
    "#design-budget-split-delver": make("input"),
    "#design-budget-split-warden": make("input"),
    "#design-budget-split-hazard": make("input"),
    "#design-budget-split-resource": make("input"),
    "#design-budget-split-room-tokens": make("div"),
    "#design-budget-split-delver-tokens": make("div"),
    "#design-budget-split-warden-tokens": make("div"),
    "#design-budget-overview": make("div"),
    "#design-ai-prompt": make("textarea"),
    "#design-ai-generate": make("button"),
    "#design-brief-output": make("pre"),
    "#design-spend-ledger-output": make("pre"),
    "#design-card-set-json": make("textarea"),
    "#design-auto-generate": make("button"),
    "#design-load-minted": make("button"),
  };
  elements["#design-level-budget"].value = "2500";
  elements["#design-budget-split-room"].value = "50";
  elements["#design-budget-split-delver"].value = "25";
  elements["#design-budget-split-warden"].value = "25";
  elements["#design-budget-split-hazard"].value = "12";
  elements["#design-budget-split-resource"].value = "8";

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

function createDesignIconBundle() {
  return {
    mappings: {
      icons: {
        types: {
          room: "icon.type.room",
          delver: "icon.type.delver",
          warden: "icon.type.warden",
        },
        items: {
          hazard: "icon.item.hazard",
          resource: "icon.item.resource",
        },
        affinities: {
          fire: "icon.affinity.fire",
          water: "icon.affinity.water",
        },
        expressions: {
          emit: "icon.expression.emit",
        },
        motivations: {
          attacking: "icon.motivation.attacking",
        },
        vitals: {
          health: "icon.vital.health",
        },
      },
    },
    assets: [
      { id: "icon.type.room", dataUri: "data:image/png;base64,ROOM_ICON" },
      { id: "icon.type.delver", dataUri: "data:image/png;base64,DELVER_ICON" },
      { id: "icon.type.warden", dataUri: "data:image/png;base64,WARDEN_ICON" },
      { id: "icon.item.hazard", dataUri: "data:image/png;base64,HAZARD_ICON" },
      { id: "icon.item.resource", dataUri: "data:image/png;base64,RESOURCE_ICON" },
      { id: "icon.affinity.fire", dataUri: "data:image/png;base64,FIRE_ICON" },
      { id: "icon.affinity.water", dataUri: "data:image/png;base64,WATER_ICON" },
      { id: "icon.expression.emit", dataUri: "data:image/png;base64,EMIT_ICON" },
      { id: "icon.motivation.attacking", dataUri: "data:image/png;base64,ATTACKING_ICON" },
      { id: "icon.vital.health", dataUri: "data:image/png;base64,HEALTH_ICON" },
    ],
  };
}

test("unified card schema normalizes type-specific fields and serializes deterministically", () => {
  const cards = normalizeDesignCardSet([
    {
      id: "c2",
      type: "delver",
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
      type: "warden",
      count: 1,
      affinity: "earth",
      motivations: ["defending"],
      affinities: [{ kind: "earth", expression: "emit", stacks: 1 }],
    },
    {
      id: "c4",
      type: "resource",
      tier: "permanent",
      stat: "vitalMax",
      delta: 10,
      dropRate: 5,
      budgetCeiling: 40,
    },
  ]);

  const room = cardById(cards, "c1");
  const delver = cardById(cards, "c2");
  const warden = cardById(cards, "c3");
  const resource = cardById(cards, "c4");

  assert.equal(room.type, "room");
  assert.equal(room.roomSize, "large");
  assert.deepEqual(room.motivations, []);
  assert.equal(room.vitals, undefined);

  assert.equal(delver.type, "delver");
  assert.ok(delver.vitals.health.max > 0);
  assert.ok(delver.motivations.includes("attacking"));

  assert.equal(warden.type, "warden");
  assert.ok(warden.vitals.durability.max >= 1);

  assert.equal(resource.type, "resource");
  assert.equal(resource.tier, "permanent");
  assert.equal(resource.stat, "vitalMax");
  assert.equal(resource.delta, 10);
  assert.equal(resource.dropRate, 5);
  assert.equal(resource.budgetCeiling, 40);

  const serializedA = serializeDesignCardSet(cards);
  const serializedB = serializeDesignCardSet(cards.slice().reverse());
  assert.equal(serializedA, serializedB);
});

test("resource cards group separately", () => {
  const grouped = groupCardsByType([
    createDesignCard({ id: "gem_1", type: "resource", tier: "level", stat: "affinityStack", delta: 2, dropRate: 15, budgetCeiling: 60 }),
    createDesignCard({ id: "room_1", type: "room", roomSize: "small", affinity: "fire" }),
  ]);

  assert.equal(grouped.resource.length, 1);
  assert.equal(grouped.resource[0].type, "resource");
  assert.equal(grouped.resource[0].tier, "level");
  assert.equal(grouped.resource[0].stat, "affinityStack");
  assert.equal(grouped.resource[0].dropRate, 15);
  assert.equal(grouped.resource[0].budgetCeiling, 60);
});

test("new actor cards default vitals to max 10 and regen 2", () => {
  const delver = createDesignCard({ type: "delver", affinity: "fire", motivations: ["attacking"] });
  const warden = createDesignCard({ type: "warden", affinity: "earth", motivations: ["defending"] });
  ["health", "mana", "stamina", "durability"].forEach((key) => {
    assert.equal(delver.vitals[key].current, 10);
    assert.equal(delver.vitals[key].max, 10);
    assert.equal(delver.vitals[key].regen, 2);
    assert.equal(warden.vitals[key].current, 10);
    assert.equal(warden.vitals[key].max, 10);
    assert.equal(warden.vitals[key].regen, 2);
  });
});

test("new delver/warden cards default to light/dark emit affinity", () => {
  const delver = createDesignCard({ type: "delver" });
  const warden = createDesignCard({ type: "warden" });

  assert.equal(delver.affinity, "light");
  assert.deepEqual(delver.affinities, [{ kind: "light", expression: "emit", stacks: 1 }]);

  assert.equal(warden.affinity, "dark");
  assert.deepEqual(warden.affinities, [{ kind: "dark", expression: "emit", stacks: 1 }]);
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

test("card values update across room, delver, and warden cards", () => {
  const room = createDesignCard({ id: "room", type: "room", roomSize: "medium", affinity: "fire", count: 1 });
  const delver = createDesignCard({
    id: "atk",
    type: "delver",
    affinity: "fire",
    count: 1,
    motivations: ["attacking"],
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
  });
  const warden = createDesignCard({
    id: "def",
    type: "warden",
    affinity: "earth",
    count: 1,
    motivations: ["defending"],
    affinities: [{ kind: "earth", expression: "emit", stacks: 1 }],
  });

  const initial = buildSummaryFromCardSet({ cards: [room, delver, warden], budgetTokens: 4000 });
  const attackerInitialValue = cardById(initial.cards, "atk").cardValue.totalTokens;

  const withAffinity = dropPropertyOnCard(delver, { group: "affinities", value: "water" }).card;
  const updated = buildSummaryFromCardSet({ cards: [room, withAffinity, warden], budgetTokens: 4000 });
  const attackerUpdatedValue = cardById(updated.cards, "atk").cardValue.totalTokens;

  assert.ok(cardById(initial.cards, "room").cardValue.totalTokens > 0);
  assert.ok(cardById(initial.cards, "def").cardValue.totalTokens > 0);
  assert.ok(attackerUpdatedValue > attackerInitialValue);
});

test("room affinity fields have no effect on room card cost — rooms are generic containers", () => {
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

  assert.equal(updatedValue, baseValue, "adding affinity stacks to a room must not change its cost");
});

test("wireDesignView refreshes design rail and card icons from the resource bundle", () => {
  const { root, elements } = createRootElements();
  const view = wireDesignView({
    root,
    commandHost: {
      async buildSpecFromSummary() {
        return { ok: false, errors: ["not needed"] };
      },
    },
  });

  try {
    view.setResourceBundle(createDesignIconBundle());

    // Rooms are rendered as action chips (data-action-value), not property chips.
    // Delver/warden/hazard/resource are the property chips with icon slots.
    const delverChipIcon = elements["#design-property-group-type"]
      .querySelector('[data-property-value="delver"]')
      ?.querySelector(".design-property-chip-icon");
    assert.ok(delverChipIcon, "delver type chip icon must exist");
    assert.match(delverChipIcon.innerHTML, /DELVER_ICON/);

    const fireChipIcon = elements["#design-property-group-affinities"]
      .querySelector('[data-property-value="fire"]')
      ?.querySelector(".design-property-chip-icon");
    assert.ok(fireChipIcon);
    assert.match(fireChipIcon.innerHTML, /FIRE_ICON/);

    const blank = view.getActiveCard();
    view.applyPropertyDrop(blank.id, { group: "type", value: "delver" });
    const renderedCard = elements["#design-card-grid"].children.find((child) => child.dataset?.cardId === view.getActiveCard().id);
    const typeIcon = renderedCard?.querySelector(".is-type");
    assert.ok(typeIcon);
    assert.match(typeIcon.innerHTML, /DELVER_ICON/);
  } finally {
    view.setResourceBundle(null);
    setDesignResourceBundle(null);
  }
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
      attackerGroup: elements["#design-card-group-delver"],
      defenderGroup: elements["#design-card-group-warden"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-delver"],
      defenderGroupBudget: elements["#design-card-group-budget-warden"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-delver"],
      budgetSplitDefenderInput: elements["#design-budget-split-warden"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-delver-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-warden-tokens"],
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
  assert.equal(elements["#design-budget-split-delver-tokens"].textContent, "");
  assert.equal(elements["#design-budget-split-warden-tokens"].textContent, "");
  assert.equal(elements["#design-budget-overview"].textContent, "");
  const affinityGroups = elements["#design-property-group-affinities"].querySelectorAll(".design-property-chip-pair");
  assert.ok(affinityGroups.length >= 5);
  const fireWaterGroup = affinityGroups.find((group) => {
    const values = group.querySelectorAll("button").map((chip) => chip.dataset?.propertyValue);
    return values.includes("fire") && values.includes("water");
  });
  assert.ok(fireWaterGroup);
  const motivationExclusiveGroups = elements["#design-property-group-motivations"].querySelectorAll('[data-exclusive="true"]');
  assert.ok(motivationExclusiveGroups.length >= 5);
  const postureGroup = elements["#design-property-group-motivations"].querySelector('[data-property-group-id="posture_attacking_defending"]');
  assert.ok(postureGroup);
  const postureNote = postureGroup.querySelector(".design-property-chip-group-note");
  assert.ok(postureNote);
  assert.equal(postureNote.textContent, "Choose 1");

  const blank = guidance.getActiveCard();
  assert.ok(blank);
  assert.equal(blank.type, "");
  assert.match(blank.id, /^C-[A-Z0-9]{6}$/);

  guidance.applyPropertyDrop(blank.id, { group: "type", value: "delver" });
  const delver = guidance.getActiveCard();
  assert.equal(delver.type, "delver");
  assert.match(delver.id, /^A-[A-Z0-9]{6}$/);
  assert.equal(delver.affinity, "light");
  assert.ok(delver.affinities.some((entry) => entry.kind === "light" && entry.expression === "emit" && entry.stacks === 1));
  const initialConfigurationValue = delver.cardValue.totalTokens;
  let renderedCard = elements["#design-card-grid"].children.find(
    (child) => child.dataset?.cardId === delver.id,
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
    (child) => child.dataset?.cardId === delver.id,
  );
  const leftRailDefendingAfterRemove = elements["#design-property-group-motivations"].querySelector('[data-property-value="defending"]');
  assert.ok(leftRailDefendingAfterRemove);
  assert.equal(leftRailDefendingAfterRemove.disabled, false);
  const addDefending = guidance.applyPropertyDrop(delver.id, { group: "motivations", value: "defending" });
  assert.deepEqual(addDefending, { ok: true });
  updated = guidance.getActiveCard();
  assert.ok(updated.motivations.includes("defending"));
  renderedCard = elements["#design-card-grid"].children.find(
    (child) => child.dataset?.cardId === delver.id,
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
  assert.equal(updated.count, delver.count + 1);
  headerCountMinus.trigger("click");
  updated = guidance.getActiveCard();
  assert.equal(updated.count, delver.count);

  const healthBefore = updated.vitals.health.max;
  guidance.adjustVital(delver.id, "health", "max", 1);
  updated = guidance.getActiveCard();
  assert.equal(updated.vitals.health.max, healthBefore + 1);

  renderedCard = elements["#design-card-grid"].children.find(
    (child) => child.dataset?.cardId === delver.id,
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

  guidance.flipCard(delver.id);
  updated = guidance.getActiveCard();
  assert.equal(updated.flipped, true);

  guidance.applyPropertyDrop(delver.id, { group: "affinities", value: "water" });
  guidance.applyPropertyDrop(delver.id, { group: "expressions", value: "emit" });
  guidance.adjustAffinityStack(delver.id, "water", 2, "emit");
  updated = guidance.getActiveCard();
  renderedCard = elements["#design-card-grid"].children.find(
    (child) => child.dataset?.cardId === delver.id,
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

  assert.equal(guidance.setBudgetSplit("delver", 100), true);
  guidance.stashActiveCard("delver");
  assert.equal(guidance.getCards().length, 1);
  assert.equal(guidance.getCards()[0].id, delver.id);
  assert.notEqual(guidance.getActiveCard().id, delver.id, "active card is replaced with a fresh editor card id");
  assert.equal(guidance.getActiveCard().type, "");
  const shelvedRow = elements["#design-card-group-delver"].children.find((child) => child.dataset?.cardId === delver.id);
  assert.ok(shelvedRow);
  assert.equal(shelvedRow.querySelectorAll(".is-expression").length, 0);
  assert.ok(shelvedRow.querySelectorAll(".is-affinity").length >= 1);
  assert.ok(shelvedRow.querySelectorAll(".is-motivation").length >= 1);
  assert.match(elements["#design-card-group-budget-delver"].textContent, /^\d+ - \[\d+\] = -?\d+$/);
  assert.match(elements["#design-card-group-budget-room"].textContent, /^\d+ - \[0\] = \d+$/);

  guidance.pullCardToEditor(delver.id);
  assert.equal(guidance.getCards().length, 0);
  assert.equal(guidance.getActiveCard().id, delver.id);
  assert.equal(guidance.getActiveCard().type, "delver");

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
      attackerGroup: elements["#design-card-group-delver"],
      defenderGroup: elements["#design-card-group-warden"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-delver"],
      defenderGroupBudget: elements["#design-card-group-budget-warden"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-delver"],
      budgetSplitDefenderInput: elements["#design-budget-split-warden"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-delver-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-warden-tokens"],
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
    "Configure a card, then shelve it.",
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
      attackerGroup: elements["#design-card-group-delver"],
      defenderGroup: elements["#design-card-group-warden"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-delver"],
      defenderGroupBudget: elements["#design-card-group-budget-warden"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-delver"],
      budgetSplitDefenderInput: elements["#design-budget-split-warden"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-delver-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-warden-tokens"],
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
  assert.ok(cards.some((card) => card.type === "delver"));
  assert.ok(cards.some((card) => card.type === "warden"));
  const spendLedger = guidance.getSpendLedger();
  assert.ok(spendLedger);
  assert.ok(spendLedger.allocations.room.usedTokens <= spendLedger.allocations.room.allocatedTokens);
  assert.ok(spendLedger.allocations.delver.usedTokens <= spendLedger.allocations.delver.allocatedTokens);
  assert.ok(spendLedger.allocations.warden.usedTokens <= spendLedger.allocations.warden.allocatedTokens);
  assert.ok(spendLedger.allocations.room.remainingTokens < 28);
  assert.ok(spendLedger.allocations.delver.usedTokens > 0);
  assert.ok(spendLedger.allocations.warden.usedTokens > 0);
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
      attackerGroup: elements["#design-card-group-delver"],
      defenderGroup: elements["#design-card-group-warden"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-delver"],
      defenderGroupBudget: elements["#design-card-group-budget-warden"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-delver"],
      budgetSplitDefenderInput: elements["#design-budget-split-warden"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-delver-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-warden-tokens"],
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
    type: "delver",
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
  assert.ok(spendLedger.allocations.delver.usedTokens > 0);
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
      attackerGroup: elements["#design-card-group-delver"],
      defenderGroup: elements["#design-card-group-warden"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-delver"],
      defenderGroupBudget: elements["#design-card-group-budget-warden"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-delver"],
      budgetSplitDefenderInput: elements["#design-budget-split-warden"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-delver-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-warden-tokens"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  guidance.addCard({ type: "room", affinity: "fire", roomSize: "small" });
  guidance.stashActiveCard("room");
  guidance.addCard({ type: "delver", affinity: "fire", motivations: ["attacking"] });
  guidance.stashActiveCard("delver");
  guidance.addCard({ type: "warden", affinity: "earth", motivations: ["defending"] });
  guidance.stashActiveCard("warden");

  const cards = guidance.getCards();
  assert.equal(cards.length, 3);
  assert.match(cards.find((card) => card.type === "room").id, /^R-[A-Z0-9]{6}$/);
  assert.match(cards.find((card) => card.type === "delver").id, /^A-[A-Z0-9]{6}$/);
  assert.match(cards.find((card) => card.type === "warden").id, /^D-[A-Z0-9]{6}$/);
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
        attackerGroup: elements["#design-card-group-delver"],
        defenderGroup: elements["#design-card-group-warden"],
        roomGroupBudget: elements["#design-card-group-budget-room"],
        attackerGroupBudget: elements["#design-card-group-budget-delver"],
        defenderGroupBudget: elements["#design-card-group-budget-warden"],
        levelBudgetInput: elements["#design-level-budget"],
        budgetSplitRoomInput: elements["#design-budget-split-room"],
        budgetSplitAttackerInput: elements["#design-budget-split-delver"],
        budgetSplitDefenderInput: elements["#design-budget-split-warden"],
        budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
        budgetSplitAttackerTokens: elements["#design-budget-split-delver-tokens"],
        budgetSplitDefenderTokens: elements["#design-budget-split-warden-tokens"],
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
      attackerGroup: elements["#design-card-group-delver"],
      defenderGroup: elements["#design-card-group-warden"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-delver"],
      defenderGroupBudget: elements["#design-card-group-budget-warden"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-delver"],
      budgetSplitDefenderInput: elements["#design-budget-split-warden"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-delver-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-warden-tokens"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  guidance.addCard({
    id: "atk_big",
    type: "delver",
    affinity: "fire",
    motivations: ["attacking"],
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    tokenHint: 5000,
  });
  const stashed = guidance.stashActiveCard("delver");
  assert.equal(stashed, false);
  assert.equal(guidance.getCards().length, 0);
  assert.match(elements["#design-guidance-status"].textContent, /allocation exceeded/i);

  guidance.addCard({
    id: "atk_small",
    type: "delver",
    affinity: "fire",
    motivations: ["attacking"],
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    tokenHint: 10,
  });
  assert.equal(guidance.stashActiveCard("delver"), true);
  assert.equal(guidance.getCards().length, 1);
  assert.equal(guidance.setBudgetSplit("delver", 0), false);
  assert.equal(elements["#design-budget-split-delver"].value, "25");
  assert.match(elements["#design-guidance-status"].textContent, /allocation exceeded/i);
});

test("wireDesignGuidance shows configuration spend helper for room, delver, and warden", () => {
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
      attackerGroup: elements["#design-card-group-delver"],
      defenderGroup: elements["#design-card-group-warden"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-delver"],
      defenderGroupBudget: elements["#design-card-group-budget-warden"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-delver"],
      budgetSplitDefenderInput: elements["#design-budget-split-warden"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-delver-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-warden-tokens"],
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

  guidance.addCard({ type: "delver", affinity: "fire", motivations: ["attacking"] });
  assertSpendChipForActive();

  guidance.addCard({ type: "warden", affinity: "earth", motivations: ["defending"] });
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
      attackerGroup: elements["#design-card-group-delver"],
      defenderGroup: elements["#design-card-group-warden"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-delver"],
      defenderGroupBudget: elements["#design-card-group-budget-warden"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-delver"],
      budgetSplitDefenderInput: elements["#design-budget-split-warden"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-delver-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-warden-tokens"],
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
      attackerGroup: elements["#design-card-group-delver"],
      defenderGroup: elements["#design-card-group-warden"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-delver"],
      defenderGroupBudget: elements["#design-card-group-budget-warden"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-delver"],
      budgetSplitDefenderInput: elements["#design-budget-split-warden"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-delver-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-warden-tokens"],
      budgetOverviewEl: elements["#design-budget-overview"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  guidance.addCard({ type: "warden", affinity: "earth", motivations: ["defending"], count: 2 });
  const warden = guidance.getActiveCard();
  const renderedBefore = elements["#design-card-grid"].children.find((child) => child.dataset?.cardId === warden.id);
  assert.ok(renderedBefore);
  const spendChipBefore = renderedBefore.querySelector(".is-configuration-spend");
  assert.ok(spendChipBefore);
  const spendBefore = parseConfigurationSpendChip(spendChipBefore.textContent);
  assert.ok(spendBefore);
  assert.equal(spendBefore.spent, warden.cardValue.totalTokens);

  guidance.adjustVital(warden.id, "health", "max", 10);
  const updated = guidance.getActiveCard();
  const renderedAfter = elements["#design-card-grid"].children.find((child) => child.dataset?.cardId === updated.id);
  assert.ok(renderedAfter);
  const spendChipAfter = renderedAfter.querySelector(".is-configuration-spend");
  assert.ok(spendChipAfter);
  const spendAfter = parseConfigurationSpendChip(spendChipAfter.textContent);
  assert.ok(spendAfter);

  assert.equal(updated.count, 2);
  assert.equal(spendAfter.spent - spendBefore.spent, 40);
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
      attackerGroup: elements["#design-card-group-delver"],
      defenderGroup: elements["#design-card-group-warden"],
      roomGroupBudget: elements["#design-card-group-budget-room"],
      attackerGroupBudget: elements["#design-card-group-budget-delver"],
      defenderGroupBudget: elements["#design-card-group-budget-warden"],
      levelBudgetInput: elements["#design-level-budget"],
      budgetSplitRoomInput: elements["#design-budget-split-room"],
      budgetSplitAttackerInput: elements["#design-budget-split-delver"],
      budgetSplitDefenderInput: elements["#design-budget-split-warden"],
      budgetSplitRoomTokens: elements["#design-budget-split-room-tokens"],
      budgetSplitAttackerTokens: elements["#design-budget-split-delver-tokens"],
      budgetSplitDefenderTokens: elements["#design-budget-split-warden-tokens"],
      budgetOverviewEl: elements["#design-budget-overview"],
      aiPromptInput: elements["#design-ai-prompt"],
      aiGenerateButton: elements["#design-ai-generate"],
      briefOutput: elements["#design-brief-output"],
      spendLedgerOutput: elements["#design-spend-ledger-output"],
      cardSetOutput: elements["#design-card-set-json"],
    },
  });

  const blank = guidance.getActiveCard();
  guidance.applyPropertyDrop(blank.id, { group: "type", value: "delver" });
  const configured = guidance.getActiveCard();
  assert.equal(configured.type, "delver");
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
    createDesignCard({ id: "atk_build", type: "delver", affinity: "fire", motivations: ["attacking"], count: 1 }),
    createDesignCard({ id: "def_build", type: "warden", affinity: "earth", motivations: ["defending"], count: 1 }),
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

test("wireDesignView auto-generate button fills all dungeon card groups without launching gameplay", () => {
  const { root, elements } = createRootElements();
  const view = wireDesignView({
    root,
    commandHost: {
      async buildSpecFromSummary(payload) {
        return buildSpecFromSummaryViaCommandHost(payload);
      },
    },
  });

  elements["#design-auto-generate"].trigger("click");

  const cards = view.getCards();
  assert.ok(cards.some((card) => card.type === "room"));
  assert.ok(cards.some((card) => card.type === "delver"));
  assert.ok(cards.some((card) => card.type === "warden"));
  assert.ok(cards.some((card) => card.type === "hazard"));
  assert.ok(cards.some((card) => card.type === "resource"));
  assert.match(elements["#design-guidance-status"].textContent, /Auto-generated .* using the remaining allocation\./i);
});

test("wireDesignView resetToScratch clears authored cards and resets the editor", () => {
  const { root, elements } = createRootElements();
  const view = wireDesignView({ root });

  view.setCards([
    createDesignCard({ id: "room_existing", type: "room", roomSize: "medium", affinity: "fire", count: 2 }),
    createDesignCard({ id: "atk_existing", type: "delver", affinity: "fire", motivations: ["attacking"], count: 1 }),
  ]);

  const result = view.resetToScratch();

  assert.equal(result.ok, true);
  assert.deepEqual(view.getCards(), []);
  const active = view.getActiveCard();
  assert.equal(active.type, "");
  assert.equal(active.count, 1);
  assert.match(active.id, /^C-[A-Z0-9]{6}$/);
  assert.match(elements["#design-guidance-status"].textContent, /Design reset\. Start a new run\./);
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
    createDesignCard({ id: "atk_over_budget", type: "delver", affinity: "fire", motivations: ["attacking"], count: 1, tokenHint: 5000 }),
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
      label: "single delver",
      cards: [
        createDesignCard({
          id: "attacker_only",
          type: "delver",
          affinity: "fire",
          motivations: ["attacking"],
          count: 1,
        }),
      ],
      expectedType: "delver",
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

test("wireDesignView hydrates editor cards from an agent-authored build spec", async () => {
  const { root } = createRootElements();
  const view = wireDesignView({
    root,
    commandHost: {
      async buildSpecFromSummary(payload) {
        return buildSpecFromSummaryViaCommandHost(payload);
      },
    },
  });

  const result = view.loadBuildSpec({
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: {
      id: "build_spec_agent_ui",
      runId: "run_agent_ui",
      createdAt: "2026-04-08T00:00:00.000Z",
      source: "cli-agent",
    },
    intent: {
      goal: "Load authored cards",
      hints: {
        budgetTokens: 5000,
      },
    },
    plan: {
      hints: {
        cardSet: [
          { id: "warden_alpha", type: "warden", count: 1, affinity: "earth", motivations: ["defending"] },
        ],
      },
    },
    configurator: {
      inputs: {
        cardSet: [
          { id: "room_alpha", type: "room", count: 1, affinity: "fire", roomSize: "medium" },
        ],
      },
    },
    authoring: {
      objectKinds: "room",
      request: {
        schema: "agent-kernel/AgentCommandRequestArtifact",
        schemaVersion: 1,
        meta: {
          id: "agent_command_agent_ui",
          runId: "run_agent_ui",
          createdAt: "2026-04-08T00:00:00.000Z",
          producedBy: "test",
        },
        command: {
          action: "author",
          text: "author a room and warden",
          source: "ui-test",
          taxonomyVersion: 1,
        },
        objects: {
          kind: "room",
          prompt: "one room",
          count: 1,
        },
        compilation: {
          rules: {
            kind: "room",
            compileTo: {
              target: "build_spec_plan",
              path: "plan.hints.cardSet",
            },
          },
        },
      },
    },
  }, { source: "agent bundle" });

  assert.equal(result.ok, true);
  assert.equal(result.normalized, true);
  const cards = view.getCards();
  assert.equal(cards.length, 2);
  assert.equal(cards.some((card) => card.type === "room"), true);
  assert.equal(cards.some((card) => card.type === "warden"), true);
});

test("wireDesignView mints active card via blockchain rails and can load it back by token id", async () => {
  const { root, elements } = createRootElements();
  elements["#design-budget-split-room"].value = "0";
  elements["#design-budget-split-delver"].value = "100";
  elements["#design-budget-split-warden"].value = "0";
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
        type: "delver",
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
  view.applyPropertyDrop(active.id, { group: "type", value: "delver" });
  const configured = view.getActiveCard();
  view.applyPropertyDrop(configured.id, { group: "affinities", value: "fire" });

  const minted = await view.mintActiveCard("delver");
  assert.equal(minted?.ok, true);
  assert.equal(mintCalls, 1);
  assert.equal(view.getCards().length, 1);

  const tokenId = minted.tokenId || "token_test_1";
  const loaded = await view.loadMintedCard(tokenId);
  assert.equal(loaded?.ok, true, JSON.stringify(loaded));
  assert.equal(loadCalls, 1);
  assert.equal(view.getActiveCard().type, "delver");
});

test("AI summary round-trip populates editable card model", async () => {
  const { root } = createRootElements();
  const aiSummary = {
    dungeonAffinity: "water",
    rooms: [{ affinity: "water", size: "small", count: 2 }],
    actors: [{ motivation: "defending", affinity: "earth", count: 1 }],
    delverConfigs: [{
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
  assert.ok(cards.some((card) => card.type === "delver"));
  assert.ok(cards.some((card) => card.type === "warden"));

  const warden = cards.find((card) => card.type === "warden");
  view.pullCardToEditor(warden.id);
  const active = view.getActiveCard();
  assert.equal(active.id, warden.id);
  view.applyPropertyDrop(active.id, { group: "affinities", value: "fire" });
  view.stashActiveCard("warden");

  const updated = view.getCards().find((card) => card.id === warden.id);
  assert.ok(updated.affinities.some((entry) => entry.kind === "fire"));
});

test("groupCardsByType and count updates preserve card payload while regrouping", () => {
  const cards = [
    createDesignCard({ id: "r", type: "room", count: 1, roomSize: "small" }),
    createDesignCard({ id: "a", type: "delver", count: 1, motivations: ["attacking"] }),
    createDesignCard({ id: "d", type: "warden", count: 2, motivations: ["defending"] }),
  ];

  const adjusted = [cards[0], adjustCardCount(cards[1], 2), adjustCardCount(cards[2], -1)];
  const grouped = groupCardsByType(adjusted);

  assert.equal(grouped.room.length, 1);
  assert.equal(grouped.delver[0].count, 3);
  assert.equal(grouped.warden[0].count, 1);
  assert.ok(grouped.delver[0].vitals.health.max > 0);
});
