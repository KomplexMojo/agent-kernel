import { test } from "node:test";
import assert from "node:assert/strict";
import { wireRuntimeView } from "../../packages/ui-web/src/views/runtime-view.js";

function makeElement() {
  let text = "";
  let html = "";
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, event = {}) {
      const handler = listeners.get(type);
      if (typeof handler === "function") {
        handler(event);
      }
    },
    get textContent() {
      return text;
    },
    set textContent(value) {
      text = String(value);
    },
    get innerHTML() {
      return html;
    },
    set innerHTML(value) {
      html = String(value);
    },
  };
}

function makeRoot() {
  const selectors = {
    "#runtime-viewport": makeElement(),
    "#runtime-status": makeElement(),
    "#runtime-attacker-card": makeElement(),
    "#runtime-visible-defenders": makeElement(),
    "#runtime-offscreen-defenders": makeElement(),
    "#runtime-move-up": makeElement(),
    "#runtime-move-down": makeElement(),
    "#runtime-move-left": makeElement(),
    "#runtime-move-right": makeElement(),
    "#runtime-cast": makeElement(),
  };
  return {
    selectors,
    querySelector(selector) {
      return selectors[selector] || null;
    },
  };
}

function makeTiles(size) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    rows.push(".".repeat(size));
  }
  return rows;
}

test("runtime view renders a 50x50 viewport and attacker defender card sections", () => {
  const root = makeRoot();
  const runtimeView = wireRuntimeView({ root });

  runtimeView.updateFromSimulation({
    observation: {
      actors: [
        { id: "attacker_alpha", kind: 2, position: { x: 10, y: 10 }, vitals: { health: { current: 8, max: 10 } } },
        { id: "defender_near", kind: 1, position: { x: 15, y: 10 }, vitals: { health: { current: 5, max: 5 } } },
        { id: "defender_far", kind: 1, position: { x: 59, y: 59 }, vitals: { health: { current: 9, max: 9 } } },
      ],
    },
    frame: {
      baseTiles: makeTiles(60),
      tick: 12,
    },
    actorIdLabel: "attacker_alpha",
  });

  const viewportText = root.selectors["#runtime-viewport"].textContent;
  const viewportLines = viewportText.split("\n");
  assert.equal(viewportLines.length, 50);
  assert.equal(viewportLines[0].length, 50);
  assert.match(root.selectors["#runtime-status"].textContent, /viewer attacker_alpha/);
  assert.match(root.selectors["#runtime-attacker-card"].innerHTML, /attacker_alpha/);
  assert.match(root.selectors["#runtime-visible-defenders"].innerHTML, /defender_near/);
  assert.doesNotMatch(root.selectors["#runtime-visible-defenders"].innerHTML, /defender_far/);
  assert.match(root.selectors["#runtime-offscreen-defenders"].innerHTML, /defender_far/);
});

test("runtime view switches viewport when selecting any actor card", () => {
  const root = makeRoot();
  const selected = [];
  const runtimeView = wireRuntimeView({
    root,
    onSelectActor: (actorId) => selected.push(actorId),
  });

  runtimeView.updateFromSimulation({
    observation: {
      actors: [
        { id: "attacker_alpha", kind: 2, position: { x: 5, y: 5 }, vitals: { health: { current: 10, max: 10 } } },
        { id: "defender_far", kind: 1, position: { x: 55, y: 55 }, vitals: { health: { current: 9, max: 9 } } },
      ],
    },
    frame: {
      baseTiles: makeTiles(80),
      tick: 1,
    },
    actorIdLabel: "attacker_alpha",
  });

  root.selectors["#runtime-offscreen-defenders"].dispatch("click", {
    target: {
      closest(selector) {
        if (selector === "[data-runtime-actor-id]") {
          return { dataset: { runtimeActorId: "defender_far" } };
        }
        return null;
      },
    },
  });

  assert.equal(runtimeView.getSelectedActorId(), "defender_far");
  assert.match(root.selectors["#runtime-status"].textContent, /viewer defender_far/);
  assert.deepEqual(selected, ["defender_far"]);
});

test("runtime controls emit movement actions for the selected actor", () => {
  const root = makeRoot();
  const actions = [];
  const runtimeView = wireRuntimeView({
    root,
    onAction: (payload) => actions.push(payload),
  });

  runtimeView.updateFromSimulation({
    observation: {
      actors: [
        { id: "attacker_alpha", kind: 2, position: { x: 5, y: 5 }, vitals: { health: { current: 10, max: 10 } } },
      ],
    },
    frame: {
      baseTiles: makeTiles(60),
      tick: 2,
    },
    actorIdLabel: "attacker_alpha",
  });

  root.selectors["#runtime-move-up"].dispatch("click");
  root.selectors["#runtime-cast"].dispatch("click");

  assert.deepEqual(actions, [
    { action: "up", actorId: "attacker_alpha" },
    { action: "cast", actorId: "attacker_alpha" },
  ]);
});
