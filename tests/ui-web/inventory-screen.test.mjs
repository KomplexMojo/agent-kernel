import assert from "node:assert/strict";

import { createInventoryScreen } from "../../packages/ui-web/src/inventory-screen.js";

/** Minimal DOM stand-in: enough for an element that holds innerHTML and hidden. */
function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    id: "",
    className: "",
    innerHTML: "",
    hidden: false,
    children: [],
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(child) { this.children.push(child); return child; },
    remove() { this.removed = true; },
  };
}

function withFakeDom(run) {
  const original = globalThis.document;
  const body = makeElement("body");
  const doc = { body, createElement: (tag) => makeElement(tag) };
  globalThis.document = doc;
  try {
    return run(doc, body);
  } finally {
    globalThis.document = original;
  }
}

const CARDS = [
  { id: "R-1", type: "room", tokens: 120 },
  { id: "R-2", type: "room", tokens: 120 },
  { id: "D-1", type: "delver", tokens: 110 },
];
const LEDGER = {
  byType: {
    room: { allocatedTokens: 725, usedTokens: 240 },
    delver: { allocatedTokens: 625, usedTokens: 110 },
  },
};

function makeScreen(overrides = {}) {
  return createInventoryScreen({
    getCards: () => CARDS,
    getAllocationLedger: () => LEDGER,
    getResourceBundle: () => null,
    ...overrides,
  });
}

test("starts closed and creates nothing until shown", () =>
  withFakeDom((doc, body) => {
    const screen = makeScreen();
    assert.equal(screen.isOpen(), false);
    assert.equal(body.children.length, 0, "a closed screen should not build DOM");
  }));

test("show renders a section per group with counts and token figures", () =>
  withFakeDom((doc, body) => {
    const screen = makeScreen();
    screen.show();
    assert.equal(screen.isOpen(), true);
    const root = body.children[0];
    assert.ok(root, "screen root should be appended");
    assert.equal(root.hidden, false);
    for (const label of ["Rooms", "Delvers", "Wardens", "Hazards", "Resources"]) {
      assert.ok(root.innerHTML.includes(label), `missing ${label} section`);
    }
    assert.ok(root.innerHTML.includes("485t"), "room remaining (725-240) should render");
    assert.ok(root.innerHTML.includes("cards"), "header totals missing");
  }));

test("each item carries its own HUD, laid out across the row", () =>
  withFakeDom((doc, body) => {
    // The point of the screen: one row reads as one entity, without needing to
    // find and click it on the board.
    const screen = makeScreen({
      getCards: () => [{
        id: "A-1", type: "delver", tokens: 55, count: 2,
        affinities: [{ kind: "light", expression: "push" }],
        motivations: ["exploring"],
        vitals: { health: { current: 8, max: 10, regen: 1 }, mana: { current: 3, max: 10 } },
      }],
    });
    screen.show();
    const html = body.children[0].innerHTML;
    assert.ok(html.includes("A-1"), "item id missing");
    assert.ok(html.includes("×2"), "instance count missing");
    assert.ok(html.includes("light") && html.includes("push"), "affinity/expression missing");
    assert.ok(html.includes("exploring"), "motivation missing");
    assert.ok(html.includes("8/10") && html.includes("3/10"), "vital values missing");
    assert.ok(html.includes("ak-inv-vitals"), "vitals should sit in one horizontal group");
    assert.ok(html.includes("↻1"), "regen missing");
  }));

test("group icons come from the shared resolver, not a local glyph table", () =>
  withFakeDom((doc, body) => {
    // So the summary rows and the board sprites cannot drift apart.
    const screen = makeScreen();
    screen.show();
    assert.match(body.children[0].innerHTML, /<svg /, "expected generated icons");
  }));

test("toggle opens and closes, and hide is idempotent", () =>
  withFakeDom(() => {
    const screen = makeScreen();
    screen.toggle();
    assert.equal(screen.isOpen(), true);
    screen.toggle();
    assert.equal(screen.isOpen(), false);
    screen.hide();
    assert.equal(screen.isOpen(), false);
  }));

test("overspend is shown, not hidden", () =>
  withFakeDom((doc, body) => {
    // A clamped remaining value turns a budget error into a display that looks fine.
    const screen = makeScreen({
      getCards: () => [{ id: "R-1", type: "room", tokens: 900 }],
      getAllocationLedger: () => ({ byType: { room: { allocatedTokens: 100, usedTokens: 900 } } }),
    });
    screen.show();
    const html = body.children[0].innerHTML;
    assert.ok(html.includes("-800t"), "negative remaining should render");
    assert.ok(html.includes("is-over"), "overspend should be marked for styling");
  }));

test("a throwing data source does not take the screen down", () =>
  withFakeDom((doc, body) => {
    const screen = makeScreen({ getCards: () => { throw new Error("boom"); } });
    assert.doesNotThrow(() => screen.show());
    assert.equal(screen.isOpen(), true);
    assert.ok(body.children[0].innerHTML.includes("Inventory"));
  }));

test("refresh is a no-op while closed", () =>
  withFakeDom((doc, body) => {
    const screen = makeScreen();
    screen.refresh();
    assert.equal(body.children.length, 0, "refresh must not build DOM for a closed screen");
    screen.show();
    assert.doesNotThrow(() => screen.refresh());
  }));

// ## TODO: Test Permutations
// Named permutations awaiting /local-test-gen. Empty bodies on purpose -- see
// tests/README.md: un-skipping one creates a vacuously passing empty test.
test.skip("cards of an unknown type render an Unplaced row", () => {});
test.skip("an empty inventory renders every group at zero", () => {});
test.skip("dispose removes the root and resets state", () => {});
test.skip("show twice does not append a second root", () => {});
