import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createActorInspector,
  deriveTemplateInstanceId,
  formatActorCapabilities,
  formatActorConstraints,
  formatActorLiveState,
  formatActorProfile,
} from "../../packages/ui-web/src/actor-inspector.js";

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
  return false;
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
      contains(name) {
        return classNameValue.split(/\s+/).filter(Boolean).includes(name);
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

function makeInspectorElements() {
  const doc = createDocumentStub();
  const containerEl = makeNode("aside", doc);
  const statusEl = makeNode("small", doc);
  const roomListEl = makeNode("div", doc);
  const attackerListEl = makeNode("div", doc);
  const defenderListEl = makeNode("div", doc);
  const detailEl = makeNode("div", doc);
  return {
    containerEl,
    statusEl,
    roomListEl,
    attackerListEl,
    defenderListEl,
    detailEl,
  };
}

const baseVitals = {
  health: { current: 10, max: 10, regen: 2 },
  mana: { current: 10, max: 10, regen: 2 },
  stamina: { current: 10, max: 10, regen: 2 },
  durability: { current: 10, max: 10, regen: 2 },
};

const spec = {
  configurator: {
    inputs: {
      cardSet: [
        {
          id: "R-Y7E71X",
          type: "room",
          source: "room",
          count: 2,
          affinity: "dark",
          affinities: [{ kind: "dark", expression: "emit", stacks: 2 }],
        },
        {
          id: "A-2RB89Z",
          type: "attacker",
          source: "actor",
          count: 1,
          affinity: "fire",
          motivations: ["attacking"],
          affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
          vitals: baseVitals,
        },
        {
          id: "D-5JH2QW",
          type: "defender",
          source: "actor",
          count: 2,
          affinity: "water",
          motivations: ["defending"],
          affinities: [{ kind: "water", expression: "emit", stacks: 3 }],
          vitals: baseVitals,
        },
      ],
      actors: [
        { id: "A-2RB89Z-1", motivations: ["attacking"] },
        { id: "D-5JH2QW-1", motivations: ["defending"] },
        { id: "D-5JH2QW-2", motivations: ["defending"] },
      ],
    },
  },
};

const simConfig = {
  layout: {
    data: {
      rooms: [
        {
          id: "R1",
          templateId: "R-Y7E71X",
          templateInstanceId: "R-Y7E71X-1",
          x: 1,
          y: 1,
          width: 6,
          height: 5,
          affinity: "dark",
          affinities: [{ kind: "dark", expression: "emit", stacks: 2 }],
        },
        {
          id: "R2",
          templateId: "R-Y7E71X",
          templateInstanceId: "R-Y7E71X-2",
          x: 12,
          y: 2,
          width: 5,
          height: 4,
          affinity: "dark",
          affinities: [{ kind: "dark", expression: "emit", stacks: 2 }],
        },
      ],
    },
  },
};

const initialState = {
  actors: [
    { id: "A-2RB89Z-1", kind: 2, position: { x: 2, y: 2 }, vitals: baseVitals },
    { id: "D-5JH2QW-1", kind: 2, position: { x: 14, y: 4 }, vitals: baseVitals },
    { id: "D-5JH2QW-2", kind: 2, position: { x: 15, y: 4 }, vitals: baseVitals },
  ],
};

test("deriveTemplateInstanceId appends ordinal suffix", () => {
  assert.equal(deriveTemplateInstanceId("R-Y7E71X", 1), "R-Y7E71X-1");
  assert.equal(deriveTemplateInstanceId("A-2RB89Z", 4), "A-2RB89Z-4");
});

test("formatters keep backward-compatible textual output", () => {
  const actor = {
    id: "A-2RB89Z-1",
    position: { x: 2, y: 2 },
    vitals: baseVitals,
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    capabilities: { movementCost: 1, actionCostMana: 2, actionCostStamina: 3 },
    constraints: ["no-water"],
  };

  assert.match(formatActorProfile(actor), /A-2RB89Z-1/);
  assert.match(formatActorCapabilities(actor), /movementCost: 1/);
  assert.match(formatActorConstraints(actor), /no-water/);
  assert.match(formatActorLiveState(actor, { tick: 7, running: true }), /tick: 7/);
});

test("inspector renders grouped template instances and maps runtime actor IDs", () => {
  const elements = makeInspectorElements();
  const selections = [];

  const inspector = createActorInspector({
    ...elements,
    onSelectEntity: (payload) => selections.push(payload),
  });

  inspector.setScenario({ spec, simConfig, initialState });
  inspector.setActors(initialState.actors, { tick: 9 });

  assert.equal(elements.containerEl.hidden, false);
  assert.equal(elements.roomListEl.querySelectorAll(".simulation-inspector-instance").length, 2);
  assert.equal(elements.attackerListEl.querySelectorAll(".simulation-inspector-instance").length, 1);
  assert.equal(elements.defenderListEl.querySelectorAll(".simulation-inspector-instance").length, 2);
  assert.match(elements.roomListEl.textContent, /R-Y7E71X-1/);
  assert.match(elements.roomListEl.textContent, /R-Y7E71X-2/);
  assert.equal(inspector.getSelectedId(), "R-Y7E71X-1");
  assert.deepEqual(inspector.getSelectedEntity()?.roomBounds, { x: 1, y: 1, width: 6, height: 5 });

  inspector.selectEntityById("R-Y7E71X-2");
  assert.equal(selections.length, 1);
  assert.equal(selections[0].type, "room");
  assert.deepEqual(selections[0].roomBounds, { x: 12, y: 2, width: 5, height: 4 });

  inspector.selectActorById("D-5JH2QW-2");
  assert.equal(inspector.getSelectedId(), "D-5JH2QW-2");

  inspector.selectEntityById("D-5JH2QW-1");
  assert.equal(selections.length, 2);
  assert.equal(selections[1].actorId, "D-5JH2QW-1");
  assert.equal(selections[1].type, "defender");
  assert.equal(selections[1].roomBounds, null);

  inspector.selectEntityById("D-5JH2QW-1", { toggleIfSelected: true });
  assert.equal(inspector.getSelectedId(), null);
  assert.equal(selections.length, 3);
  assert.equal(selections[2], null);
});

test("inspector detail shows affinities, vitals, and card value", () => {
  const elements = makeInspectorElements();
  const inspector = createActorInspector({
    ...elements,
  });

  inspector.setScenario({ spec, simConfig, initialState });
  inspector.setActors([
    {
      id: "D-5JH2QW-1",
      kind: 2,
      position: { x: 14, y: 4 },
      vitals: {
        health: { current: 7, max: 10, regen: 2 },
        mana: { current: 8, max: 10, regen: 2 },
        stamina: { current: 9, max: 10, regen: 2 },
        durability: { current: 6, max: 10, regen: 2 },
      },
    },
  ], { tick: 11 });
  inspector.selectEntityById("D-5JH2QW-1", { notify: false });

  assert.match(elements.detailEl.textContent, /D-5JH2QW-1/);
  assert.match(elements.detailEl.textContent, /\+3/);
  assert.match(elements.detailEl.textContent, /7\/10\/\+2/);
  assert.match(elements.detailEl.textContent, /🪙/);
});

test("inspector remains visible and toggle/close keep it shown", () => {
  const elements = makeInspectorElements();
  const inspector = createActorInspector({
    ...elements,
  });

  assert.equal(elements.containerEl.hidden, false);

  inspector.setScenario({ spec, simConfig, initialState });
  assert.equal(elements.containerEl.hidden, false);

  inspector.close();
  assert.equal(elements.containerEl.hidden, false);

  inspector.open();
  assert.equal(elements.containerEl.hidden, false);

  inspector.toggle();
  assert.equal(elements.containerEl.hidden, false);
});
