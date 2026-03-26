const { test } = require("node:test");
const assert = require("node:assert/strict");

test("resource icons provide a canonical shared UI catalog", async () => {
  const {
    getAffinityIcon,
    getCardTypeIcon,
    getExpressionIcon,
    getMotivationIcon,
    getReasoningClassIcon,
    getVitalIcon,
  } = await import("../../packages/runtime/src/render/resource-icons.js");

  assert.equal(getCardTypeIcon("room"), "🏛️");
  assert.equal(getCardTypeIcon("delver"), "🗝️");
  assert.equal(getCardTypeIcon("warden"), "🏰");
  assert.equal(getCardTypeIcon("unknown"), "◻️");

  assert.equal(getAffinityIcon("fire"), "🔥");
  assert.equal(getExpressionIcon("draw"), "🌀");
  assert.equal(getMotivationIcon("attacking"), "⚔️");
  assert.equal(getVitalIcon("health"), "❤️");

  assert.equal(getReasoningClassIcon("strategic"), "♟️");
  assert.equal(getReasoningClassIcon("tactical"), "🎯");
  assert.equal(getReasoningClassIcon("unknown"), "⚡");
});
