const assert = require("node:assert/strict");

const CATALOG = { schema: "agent-kernel/PoolCatalog", schemaVersion: 1, entries: [] };
const POOL_WEIGHTS = [
  { id: "delver", weight: 0 },
  { id: "rooms", weight: 1 },
  { id: "wardens", weight: 0 },
  { id: "resources", weight: 0 },
];

function clock() {
  let i = 0;
  return () => `2026-07-14T00:00:${String(++i).padStart(2, "0")}.000Z`;
}

const ROOM_DESIGN_RESPONSE = {
  response: JSON.stringify({
    remainingBudgetTokens: 360,
    layout: { floorTiles: 120 },
    roomDesign: {
      totalRooms: 3, entryRoomId: "R1", exitRoomId: "R3",
      rooms: [
        { id: "R1", startX: 2, startY: 3, endX: 18, endY: 16 },
        { id: "R2", startX: 22, startY: 5, endX: 32, endY: 13 },
        { id: "R3", startX: 34, startY: 24, endX: 50, endY: 38 },
      ],
    },
    missing: [], stop: "done",
  }),
};

const PLAIN_LAYOUT_RESPONSE = {
  response: JSON.stringify({ remainingBudgetTokens: 360, layout: { floorTiles: 120 }, missing: [], stop: "done" }),
};

async function loadSeam() {
  return import("../../packages/runtime/src/adaptive-workflow/llm-seams.js");
}

function seamArgs(response) {
  return { adapter: { generate: async () => response }, model: "fixture", goal: "layout", runId: "sect", clock: clock(), catalog: CATALOG, budgetTokens: 400, poolWeights: POOL_WEIGHTS };
}

test("local-sectional seam surfaces model roomDesign rooms as summary.rooms when the catalog yields none", async () => {
  const { runSectionalBudgetLlmSeam } = await loadSeam();
  const result = await runSectionalBudgetLlmSeam(seamArgs(ROOM_DESIGN_RESPONSE));
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.summary.rooms), "summary.rooms must be an array after reconciliation");
  assert.equal(result.summary.rooms.length, 3);
  assert.deepEqual(result.summary.rooms.map((room) => room.id), ["R1", "R2", "R3"]);
  // The original design is preserved, not replaced.
  assert.equal(result.summary.roomDesign.rooms.length, 3);
});

test("seam does not fabricate rooms when the model returns no roomDesign", async () => {
  const { runSectionalBudgetLlmSeam } = await loadSeam();
  const result = await runSectionalBudgetLlmSeam(seamArgs(PLAIN_LAYOUT_RESPONSE));
  assert.equal(result.ok, true);
  const rooms = result.summary.rooms;
  assert.ok(rooms === undefined || (Array.isArray(rooms) && rooms.length === 0), "no rooms should be invented for a plain layout response");
});

// ## TODO: Test Permutations
// - reconciliation is a no-op when the catalog already produced room selections
// - malformed roomDesign.rooms entries are skipped, not surfaced
// - empty roomDesign.rooms array leaves summary.rooms absent
