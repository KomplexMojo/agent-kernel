import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AFFINITY_KINDS,
  AFFINITY_EXPRESSIONS,
  wireAffinityLegend,
} from "../../packages/ui-web/src/affinity-legend.js";

function makeButton() {
  const handlers = {};
  return {
    attrs: {},
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    click() {
      handlers.click?.();
    },
  };
}

function makePanel() {
  return { hidden: true };
}

function makeList() {
  return {
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  };
}

test("affinity legend toggles and renders ordered lists", () => {
  const button = makeButton();
  const panel = makePanel();
  const kindsEl = makeList();
  const expressionsEl = makeList();

  wireAffinityLegend({
    button,
    panel,
    kindsEl,
    expressionsEl,
  });

  assert.equal(panel.hidden, true);
  assert.equal(button.attrs["aria-expanded"], "false");
  assert.deepEqual(kindsEl.children.map((child) => child.textContent), AFFINITY_KINDS);
  assert.deepEqual(expressionsEl.children.map((child) => child.textContent), AFFINITY_EXPRESSIONS);

  button.click();
  assert.equal(panel.hidden, false);
  assert.equal(button.attrs["aria-expanded"], "true");
});
