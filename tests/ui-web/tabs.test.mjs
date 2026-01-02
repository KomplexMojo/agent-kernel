import { test } from "node:test";
import assert from "node:assert/strict";
import { wireTabs } from "../../packages/ui-web/src/tabs.js";

function makeButton(tab) {
  const handlers = {};
  return {
    dataset: { tab },
    attrs: {},
    disabled: false,
    classList: {
      state: {},
      toggle(name, value) {
        this.state[name] = value;
      },
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    click() {
      handlers.click?.();
    },
  };
}

function makePanel(tabPanel) {
  return {
    dataset: { tabPanel },
    hidden: false,
  };
}

test("tabs toggle panels and aria-selected state", () => {
  const inspectButton = makeButton("inspect");
  const affinityButton = makeButton("affinities");
  const inspectPanel = makePanel("inspect");
  const affinityPanel = makePanel("affinities");

  wireTabs({
    buttons: [inspectButton, affinityButton],
    panels: [inspectPanel, affinityPanel],
    defaultTab: "inspect",
  });

  assert.equal(inspectPanel.hidden, false);
  assert.equal(affinityPanel.hidden, true);
  assert.equal(inspectButton.attrs["aria-selected"], "true");
  assert.equal(affinityButton.attrs["aria-selected"], "false");

  affinityButton.click();
  assert.equal(inspectPanel.hidden, true);
  assert.equal(affinityPanel.hidden, false);
  assert.equal(affinityButton.attrs["aria-selected"], "true");
});
