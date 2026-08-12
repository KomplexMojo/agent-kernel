// Small agent-specific benchmark scenario set. Each scenario drives the
// AdaptiveWorkflowAgent flagship path with a JSON-authoring objective. Keep this
// set small and fast so it can iterate against a live 30B-class local model.
export const AGENT_BENCHMARK_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "single-room",
    title: "Single dark room",
    requiredKeys: ["rooms"],
    objective: 'Return ONLY compact JSON for a tiny dungeon with one room: {"rooms":[{"id":"room-1"}],"actors":[]}. No prose, no markdown, no code fences.',
  }),
  Object.freeze({
    id: "room-and-delver",
    title: "Room with one delver",
    requiredKeys: ["rooms", "actors"],
    objective: 'Return ONLY compact JSON with one room and one delver: {"rooms":[{"id":"room-1"}],"actors":[{"id":"delver-1"}]}. No prose, no markdown, no code fences.',
  }),
  Object.freeze({
    id: "two-rooms",
    title: "Two connected rooms",
    requiredKeys: ["rooms"],
    objective: 'Return ONLY compact JSON with exactly two rooms: {"rooms":[{"id":"room-1"},{"id":"room-2"}],"actors":[]}. No prose, no markdown, no code fences.',
  }),
  Object.freeze({
    id: "hazard-room",
    title: "Room with a fire hazard",
    requiredKeys: ["rooms"],
    objective: 'Return ONLY compact JSON: {"rooms":[{"id":"room-1","hazards":[{"affinity":"fire"}]}],"actors":[]}. No prose, no markdown, no code fences.',
  }),
]);

const POOL_CATALOG = Object.freeze({ schema: "agent-kernel/PoolCatalog", schemaVersion: 1, entries: [] });

function fail(path, code) {
  return { ok: false, issues: [{ path, code, message: code }] };
}

// Discriminating scenarios: the validators check real structure the flagship
// sanitizer will NOT fabricate (exact counts, nested fields), plus one scenario
// that routes to the local-sectional/budget strategy. A weak model that returns
// generic output will fail these even though it "passes" the smoke set.
export const AGENT_BENCHMARK_HARD_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "exactly-three-rooms",
    title: "Exactly three rooms",
    objective: 'Return ONLY compact JSON with EXACTLY three rooms and no actors: {"rooms":[{"id":"room-1"},{"id":"room-2"},{"id":"room-3"}],"actors":[]}. No prose, no code fences.',
    validate: (value) => (Array.isArray(value?.rooms) && value.rooms.length === 3 ? { ok: true } : fail("/rooms", "expected_exactly_three_rooms")),
  }),
  Object.freeze({
    id: "two-delvers",
    title: "Exactly two delvers",
    objective: 'Return ONLY compact JSON with one room and EXACTLY two delvers: {"rooms":[{"id":"room-1"}],"actors":[{"id":"delver-1"},{"id":"delver-2"}]}. No prose, no code fences.',
    validate: (value) => (Array.isArray(value?.actors) && value.actors.length === 2 ? { ok: true } : fail("/actors", "expected_exactly_two_actors")),
  }),
  Object.freeze({
    id: "mixed-roster",
    title: "Two rooms and three actors",
    objective: 'Return ONLY compact JSON with EXACTLY two rooms and EXACTLY three actors: {"rooms":[{"id":"room-1"},{"id":"room-2"}],"actors":[{"id":"a-1"},{"id":"a-2"},{"id":"a-3"}]}. No prose, no code fences.',
    validate: (value) => {
      const ok = Array.isArray(value?.rooms) && value.rooms.length === 2 && Array.isArray(value?.actors) && value.actors.length === 3;
      return ok ? { ok: true } : fail("/", "expected_two_rooms_three_actors");
    },
  }),
  Object.freeze({
    id: "local-sectional-layout",
    title: "Local-sectional layout under budget",
    // structuredOutput:false routes to local_sectional_repair_v1 (budget loop). The
    // budget-loop summary exposes `layout` (not `rooms`), so validate floor tiles.
    capability: { structuredOutput: false, contextWindowTokens: 24000 },
    budgetTokens: 400,
    catalog: POOL_CATALOG,
    objective: 'Return ONLY compact JSON describing a room layout section: {"phase":"layout_only","layout":{"floorTiles":4,"hallwayTiles":2},"rooms":[{"id":"room-1"}],"missing":[]}. No prose, no code fences.',
    validate: (value) => (value?.layout && Number.isInteger(value.layout.floorTiles) && value.layout.floorTiles > 0 ? { ok: true } : fail("/layout/floorTiles", "missing_sectional_layout")),
  }),
]);
