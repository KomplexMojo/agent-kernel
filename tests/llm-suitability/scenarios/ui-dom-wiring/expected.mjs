import assert from "node:assert/strict";
import { test } from "vitest";

import { wireCardListView } from "./source.js";

function makeNode(tagName = "div", ownerDocument = null) {
  const handlers = {};
  let text = "";
  const node = {
    tagName: tagName.toUpperCase(),
    ownerDocument,
    children: [],
    dataset: {},
    className: "",
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(event, handler) {
      handlers[event] = handler;
    },
    trigger(event) {
      return handlers[event]?.({ target: this, currentTarget: this });
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const matches = [];
      const walk = (current) => {
        if (selector.startsWith("#") && current.id === selector.slice(1)) matches.push(current);
        if (selector.startsWith(".") && String(current.className).split(/\s+/).includes(selector.slice(1))) matches.push(current);
        current.children.forEach(walk);
      };
      walk(this);
      return matches;
    },
  };
  Object.defineProperty(node, "textContent", {
    get() {
      return text || node.children.map((child) => child.textContent).join("");
    },
    set(value) {
      text = String(value);
      if (text === "") node.children = [];
    },
  });
  return node;
}

function makeRoot() {
  const doc = { createElement: (tagName) => makeNode(tagName, doc) };
  const root = makeNode("div", doc);
  const list = makeNode("div", doc);
  list.id = "card-list";
  const status = makeNode("div", doc);
  status.id = "card-status";
  root.appendChild(list);
  root.appendChild(status);
  return { root, list, status };
}

test("wireCardListView renders cards and click updates selection", () => {
  const selected = [];
  const { root, list, status } = makeRoot();
  const view = wireCardListView({
    root,
    cards: [
      { id: "room_1", type: "room" },
      { id: "actor_1", type: "delver" },
    ],
    onSelect: (card) => selected.push(card.id),
  });

  assert.equal(view.ok, true);
  assert.equal(status.textContent, "cards:2");
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].dataset.cardId, "room_1");

  list.children[1].trigger("click");
  assert.equal(status.textContent, "selected:actor_1");
  assert.deepEqual(selected, ["actor_1"]);
});

test("wireCardListView reports missing required elements", () => {
  const doc = { createElement: (tagName) => makeNode(tagName, doc) };
  const root = makeNode("div", doc);
  const view = wireCardListView({ root, cards: [] });
  assert.equal(view.ok, false);
  assert.equal(view.reason, "missing_elements");
});
