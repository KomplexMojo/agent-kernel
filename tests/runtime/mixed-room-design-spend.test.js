/**
 * RB3.0 — presentation contract for Allocator-owned mixed-room design-token spend.
 */
"use strict";

const assert = require("node:assert/strict");

const COMPLETE_SPEND = Object.freeze({
  status: "available",
  unit: "design_tokens",
  producedBy: "allocator",
  components: Object.freeze({
    defaultTiles: 24,
    localizedTiles: 0,
    roomWideOverlay: 0,
    localizedHazards: 64,
  }),
  total: 88,
});

function roomWithComposition(composition = {}) {
  return {
    id: "R-design-spend",
    width: 6,
    height: 4,
    mixedRoomComposition: {
      templateId: "R-FIRE",
      templateInstanceId: "R-FIRE-1",
      localizedHazards: [
        { id: "fire_emit", affinity: { kind: "fire", expression: "emit", stacks: 1 } },
      ],
      ...composition,
    },
  };
}

test("summary and CLI display a complete Allocator-authored design-token breakdown unchanged", async () => {
  const {
    formatMixedRoomAssembliesCliLines,
    summarizeMixedRoomAssemblies,
  } = await import("../../packages/runtime/src/build/mixed-room-summary.js");
  const [summary] = summarizeMixedRoomAssemblies([
    roomWithComposition({ designTokenSpend: COMPLETE_SPEND }),
  ]);

  assert.deepEqual(summary.designTokenSpend, COMPLETE_SPEND);
  assert.equal(Object.hasOwn(summary, "tokenSpend"), false);
  assert.equal(formatMixedRoomAssembliesCliLines([summary]).some((line) => (
    line.includes("designTokenSpend=defaultTiles:24,localizedTiles:0,roomWideOverlay:0,localizedHazards:64,total:88")
    && line.includes("designTokenUnit=design_tokens")
    && line.includes("designTokenSource=allocator")
  )), true);
});

test("presentation marks absent or incomplete Allocator spend unavailable without reconstructing it", async () => {
  const {
    formatMixedRoomAssembliesCliLines,
    summarizeMixedRoomAssemblies,
  } = await import("../../packages/runtime/src/build/mixed-room-summary.js");
  const [absent] = summarizeMixedRoomAssemblies([roomWithComposition({
    defaultTileTokenCost: 9,
    localizedTiles: [{ x: 1, y: 1, tokenCost: 7 }],
    tokenSpend: { defaultTiles: 216, localizedTiles: 7, localizedHazards: 99 },
  })]);
  const [missingTotal] = summarizeMixedRoomAssemblies([roomWithComposition({
    designTokenSpend: {
      status: "available",
      unit: "design_tokens",
      producedBy: "allocator",
      components: COMPLETE_SPEND.components,
    },
  })]);

  assert.deepEqual(absent.designTokenSpend, {
    status: "unavailable",
    unit: "design_tokens",
    reason: "allocator_summary_required",
  });
  assert.deepEqual(missingTotal.designTokenSpend, {
    status: "unavailable",
    unit: "design_tokens",
    reason: "allocator_summary_invalid",
  });
  const lines = formatMixedRoomAssembliesCliLines([absent, missingTotal]);
  assert.equal(lines.filter((line) => line.includes("designTokenSpend=unavailable")).length, 2);
  assert.equal(lines.some((line) => line.includes("tokenSpend=")), false);
  assert.equal(JSON.stringify([absent, missingTotal]).includes("216"), false);
});

test("presentation rejects a supplied total that does not reconcile with its components", async () => {
  const { summarizeMixedRoomAssemblies } = await import(
    "../../packages/runtime/src/build/mixed-room-summary.js"
  );
  const [summary] = summarizeMixedRoomAssemblies([roomWithComposition({
    designTokenSpend: { ...COMPLETE_SPEND, total: 87 },
  })]);

  assert.deepEqual(summary.designTokenSpend, {
    status: "unavailable",
    unit: "design_tokens",
    reason: "allocator_summary_invalid",
  });
});

test("presentation does not reconstruct missing Configurator composition classifications", async () => {
  const { summarizeMixedRoomAssemblies } = await import(
    "../../packages/runtime/src/build/mixed-room-summary.js"
  );
  const [summary] = summarizeMixedRoomAssemblies([roomWithComposition({
    roomWideOverlay: { kind: "fire", expression: "emit", stacks: 1 },
    localizedHazards: [
      { id: "fire_emit", affinity: { kind: "fire", expression: "emit", stacks: 1 } },
    ],
  })]);

  assert.equal(summary.compositionProfile, "unavailable");
  assert.equal(summary.dominantInvestment, "unavailable");
});

// ## TODO: Test Permutations
// - reject negative or fractional component values
// - preserve an unavailable Allocator reason without changing its unit
