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
    hidden: false,
    parentNode: null,
    value: "",
    type: "",
    min: "",
    max: "",
    step: "",
    checked: false,
    disabled: false,
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
    closest(selector) {
      let current = this;
      while (current) {
        if (matchesSelector(current, selector)) return current;
        current = current.parentNode || null;
      }
      return null;
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

test("attacker affinity controls remain independent from workflow affinity selections", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => makeNode(tagName),
  };

  try {
    const workflowAffinitiesContainer = makeNode("div");
    const attackerSelectedAffinitiesContainer = makeNode("div");
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
        workflowAffinitiesContainer,
        attackerSelectedAffinitiesContainer,
      },
    });

    const workflowFire = findAffinityCountInput(workflowAffinitiesContainer, "fire");
    const workflowWater = findAffinityCountInput(workflowAffinitiesContainer, "water");
    const attackerFire = findAffinityCountInput(attackerSelectedAffinitiesContainer, "fire");
    const attackerWater = findAffinityCountInput(attackerSelectedAffinitiesContainer, "water");
    const attackerEarth = findAffinityCountInput(attackerSelectedAffinitiesContainer, "earth");

    assert.ok(workflowFire);
    assert.ok(workflowWater);
    assert.ok(attackerFire);
    assert.ok(attackerWater);
    assert.ok(attackerEarth);

    assert.equal(attackerFire.closest(".affinity-row")?.hidden, false);
    assert.equal(attackerWater.closest(".affinity-row")?.hidden, false);
    assert.equal(attackerEarth.closest(".affinity-row")?.hidden, false);

    attackerFire.value = "2";
    attackerSelectedAffinitiesContainer.trigger("input");

    workflowFire.value = "2";
    workflowWater.value = "1";
    workflowAffinitiesContainer.trigger("input");
    assert.equal(attackerFire.value, "2");
    assert.equal(attackerWater.value, "0");
    assert.equal(attackerFire.closest(".affinity-row")?.hidden, false);
    assert.equal(attackerWater.closest(".affinity-row")?.hidden, false);
    assert.equal(attackerEarth.closest(".affinity-row")?.hidden, false);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("attacker user setup mode unlocks full affinity editing", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => makeNode(tagName),
  };

  try {
    const workflowAffinitiesContainer = makeNode("div");
    const attackerSelectedAffinitiesContainer = makeNode("div");
    const attackerSetupModeInput = makeInput("auto");
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
        workflowAffinitiesContainer,
        attackerSelectedAffinitiesContainer,
        attackerSetupModeInput,
      },
    });

    const workflowFire = findAffinityCountInput(workflowAffinitiesContainer, "fire");
    const attackerWater = findAffinityCountInput(attackerSelectedAffinitiesContainer, "water");
    const attackerWaterExpression = attackerSelectedAffinitiesContainer.querySelector(
      'input.affinity-expression[data-affinity="water"]',
    );

    assert.ok(workflowFire);
    assert.ok(attackerWater);
    assert.ok(attackerWaterExpression);

    workflowFire.value = "1";
    workflowAffinitiesContainer.trigger("input");
    assert.equal(attackerWater.closest(".affinity-row")?.hidden, false);
    assert.equal(attackerWater.disabled, true);

    attackerSetupModeInput.value = "user";
    attackerSetupModeInput.trigger("change");
    assert.equal(attackerWater.closest(".affinity-row")?.hidden, false);
    assert.equal(attackerWater.disabled, false);

    attackerWater.value = "2";
    attackerSelectedAffinitiesContainer.trigger("input");
    assert.equal(attackerWaterExpression.disabled, false);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("level generation requires workflow affinity selection before running", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => makeNode(tagName),
  };

  try {
    const workflowAffinitiesContainer = makeNode("div");
    const attackerSelectedAffinitiesContainer = makeNode("div");
    const statusEl = { textContent: "", style: {} };
    const guidance = wireDesignGuidance({
      elements: {
        guidanceInput: makeInput(""),
        modelInput: makeInput("phi4"),
        baseUrlInput: makeInput("http://localhost:11434"),
        modeSelect: makeInput("fixture"),
        generateButton: makeButton(),
        fixtureButton: makeButton(),
        statusEl,
        briefOutput: { textContent: "" },
        levelDesignOutput: { textContent: "" },
        actorSetInput: makeInput("[]"),
        actorSetPreview: { textContent: "" },
        applyActorSetButton: makeButton(),
        workflowAffinitiesContainer,
        attackerSelectedAffinitiesContainer,
      },
      llmConfig: {
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

    const blocked = await guidance.generateLevelBrief({ useFixture: true });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "missing_affinity_prerequisite");
    assert.match(statusEl.textContent, /requires at least one workflow affinity/i);

    const workflowFire = findAffinityCountInput(workflowAffinitiesContainer, "fire");
    workflowFire.value = "1";
    workflowAffinitiesContainer.trigger("input");
    const ok = await guidance.generateLevelBrief({ useFixture: true });
    assert.equal(ok.ok, true);
  } finally {
    globalThis.document = originalDocument;
  }
});
