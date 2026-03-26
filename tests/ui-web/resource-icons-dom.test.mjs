import { test } from "node:test";
import assert from "node:assert/strict";
import { wireCardTypeIcons } from "../../packages/ui-web/src/resource-icons-dom.js";

function makeNode(type = "") {
  return {
    dataset: {
      cardTypeIcon: type,
    },
    textContent: "",
  };
}

test("wireCardTypeIcons hydrates shared card type icons from the canonical catalog", () => {
  const room = makeNode("room");
  const delver = makeNode("delver");
  const warden = makeNode("warden");
  const unknown = makeNode("unknown");

  wireCardTypeIcons({
    root: {
      querySelectorAll(selector) {
        return selector === "[data-card-type-icon]" ? [room, delver, warden, unknown] : [];
      },
    },
  });

  assert.equal(room.textContent, "🏛️");
  assert.equal(delver.textContent, "🗝️");
  assert.equal(warden.textContent, "🏰");
  assert.equal(unknown.textContent, "◻️");
});
