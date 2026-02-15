import { test } from "node:test";
import assert from "node:assert/strict";
import { wireDesignGuidance } from "../../packages/ui-web/src/design-guidance.js";
import { AFFINITY_KINDS } from "../../packages/runtime/src/contracts/domain-constants.js";

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

function selectorToDatasetKey(key) {
  return String(key).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function matchesSelector(node, selector) {
  if (!node || typeof selector !== "string") return false;
  const match = selector.trim().match(
    /^([a-zA-Z][a-zA-Z0-9_-]*)?(?:\.([a-zA-Z0-9_-]+))?(?:\[data-([a-zA-Z0-9_-]+)="([^"]+)"\])?$/,
  );
  if (!match) return false;
  const [, tag, className, dataAttr, dataValue] = match;
  if (tag && String(node.tagName || "").toLowerCase() !== tag.toLowerCase()) {
    return false;
  }
  if (className) {
    const classes = String(node.className || "").split(/\s+/).filter(Boolean);
    if (!classes.includes(className)) {
      return false;
    }
  }
  if (dataAttr) {
    const datasetKey = selectorToDatasetKey(dataAttr);
    if (String(node.dataset?.[datasetKey] || "") !== dataValue) {
      return false;
    }
  }
  return true;
}

function querySelectorAll(root, selector) {
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
  walk(root);
  return matches;
}

function makeNode(tagName = "div") {
  const handlers = {};
  let textContentValue = "";
  return {
    tagName: String(tagName).toUpperCase(),
    className: "",
    dataset: {},
    children: [],
    value: "",
    type: "",
    min: "",
    max: "",
    step: "",
    checked: false,
    disabled: false,
    appendChild(child) {
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
    addEventListener(event, fn) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(fn);
    },
    trigger(event) {
      const listeners = handlers[event] || [];
      listeners.forEach((listener) => listener({ target: this }));
    },
    querySelectorAll(selector) {
      return querySelectorAll(this, selector);
    },
    querySelector(selector) {
      const matches = this.querySelectorAll(selector);
      return matches.length > 0 ? matches[0] : null;
    },
    get textContent() {
      return textContentValue;
    },
    set textContent(value) {
      textContentValue = String(value);
      this.children = [];
    },
  };
}

function findAffinityCountInput(container, affinity) {
  return container.querySelector(`input.affinity-count[data-affinity="${affinity}"]`);
}

function collectSelectedAffinityCounts(container) {
  return AFFINITY_KINDS.reduce((acc, affinity) => {
    const input = findAffinityCountInput(container, affinity);
    const count = Number(input?.value || 0);
    if (Number.isFinite(count) && count > 0) {
      acc[affinity] = count;
    }
    return acc;
  }, {});
}

test("defender affinity defaults follow level affinity counts and preserve manual overrides", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => makeNode(tagName),
  };

  try {
    const levelAffinitiesContainer = makeNode("div");
    const defenderAffinitiesContainer = makeNode("div");
    const attackerAffinitiesContainer = makeNode("div");
    wireDesignGuidance({
      elements: {
        guidanceInput: makeInput(""),
        modelInput: makeInput("phi4"),
        baseUrlInput: makeInput("http://localhost:11434"),
        generateButton: makeButton(),
        statusEl: { textContent: "", style: {} },
        briefOutput: { textContent: "" },
        actorSetInput: makeInput("[]"),
        actorSetPreview: { textContent: "" },
        applyActorSetButton: makeButton(),
        levelAffinitiesContainer,
        attackerAffinitiesContainer,
        defenderAffinitiesContainer,
      },
    });

    const levelFire = findAffinityCountInput(levelAffinitiesContainer, "fire");
    const levelWater = findAffinityCountInput(levelAffinitiesContainer, "water");
    const defenderFire = findAffinityCountInput(defenderAffinitiesContainer, "fire");
    const defenderWater = findAffinityCountInput(defenderAffinitiesContainer, "water");

    assert.ok(levelFire);
    assert.ok(levelWater);
    assert.ok(defenderFire);
    assert.ok(defenderWater);
    assert.equal(defenderFire.value, "0");
    assert.equal(defenderWater.value, "0");

    levelFire.value = "2";
    levelWater.value = "1";
    levelAffinitiesContainer.trigger("input");
    assert.equal(defenderFire.value, "2");
    assert.equal(defenderWater.value, "1");

    defenderFire.value = "1";
    defenderAffinitiesContainer.trigger("input");
    levelFire.value = "3";
    levelWater.value = "2";
    levelAffinitiesContainer.trigger("input");
    assert.equal(defenderFire.value, "1");
    assert.equal(defenderWater.value, "2");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("generate level picks random affinities when level selection is empty and mirrors to defenders", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => makeNode(tagName),
  };

  try {
    const levelAffinitiesContainer = makeNode("div");
    const defenderAffinitiesContainer = makeNode("div");
    const attackerAffinitiesContainer = makeNode("div");
    const guidance = wireDesignGuidance({
      elements: {
        guidanceInput: makeInput(""),
        modelInput: makeInput("phi4"),
        baseUrlInput: makeInput("http://localhost:11434"),
        modeSelect: makeInput("fixture"),
        generateButton: makeButton(),
        fixtureButton: makeButton(),
        statusEl: { textContent: "", style: {} },
        briefOutput: { textContent: "" },
        levelDesignOutput: { textContent: "" },
        actorSetInput: makeInput("[]"),
        actorSetPreview: { textContent: "" },
        applyActorSetButton: makeButton(),
        levelAffinitiesContainer,
        attackerAffinitiesContainer,
        defenderAffinitiesContainer,
      },
      llmConfig: {
        randomFn: () => 0,
        fixtureResponse: {
          responses: [
            {
              response: JSON.stringify({
                phase: "layout_only",
                remainingBudgetTokens: 500,
                layout: { floorTiles: 20, hallwayTiles: 10 },
                missing: [],
              }),
            },
          ],
        },
      },
    });

    await guidance.generateLevelBrief({ useFixture: true });

    const selectedLevel = collectSelectedAffinityCounts(levelAffinitiesContainer);
    const selectedDefenders = collectSelectedAffinityCounts(defenderAffinitiesContainer);
    assert.ok(Object.keys(selectedLevel).length >= 1);
    assert.ok(Object.keys(selectedLevel).length <= AFFINITY_KINDS.length);
    assert.deepEqual(selectedDefenders, selectedLevel);
  } finally {
    globalThis.document = originalDocument;
  }
});
