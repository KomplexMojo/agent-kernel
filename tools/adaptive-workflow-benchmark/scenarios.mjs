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

function hasUniqueIds(values, count) {
  return Array.isArray(values) && values.length === count
    && values.every((value) => typeof value?.id === "string" && value.id.length > 0)
    && new Set(values.map((value) => value.id)).size === count;
}

function actorKinds(values) {
  return Array.isArray(values) ? values.map((actor) => actor?.kind).sort() : [];
}

// Discriminating scenarios: the validators check the parsed model response,
// before the workflow sanitizer removes source-only semantics such as ids and
// actor kinds. One scenario also routes through the local-sectional/budget
// strategy. A weak model that returns generic output fails these even when the
// sanitizer could turn it into a structurally valid workflow candidate.
export const AGENT_BENCHMARK_HARD_SCENARIOS = Object.freeze([
  Object.freeze({
    id: "exactly-three-rooms",
    title: "Exactly three rooms",
    objective: 'Return ONLY compact JSON with EXACTLY three rooms and no actors: {"rooms":[{"id":"room-1"},{"id":"room-2"},{"id":"room-3"}],"actors":[]}. No prose, no code fences.',
    validate: (_value, { modelResponse } = {}) => (hasUniqueIds(modelResponse?.rooms, 3)
      && Array.isArray(modelResponse?.actors) && modelResponse.actors.length === 0
      ? { ok: true } : fail("/", "expected_three_unique_rooms_no_actors")),
  }),
  Object.freeze({
    id: "two-delvers",
    title: "Exactly two delvers",
    objective: 'Return ONLY compact JSON with one room and EXACTLY two actors whose kind is delver: {"rooms":[{"id":"room-1"}],"actors":[{"id":"delver-1","kind":"delver"},{"id":"delver-2","kind":"delver"}]}. No prose, no code fences.',
    validate: (_value, { modelResponse } = {}) => (hasUniqueIds(modelResponse?.rooms, 1)
      && hasUniqueIds(modelResponse?.actors, 2)
      && actorKinds(modelResponse.actors).every((kind) => kind === "delver")
      ? { ok: true } : fail("/actors", "expected_two_unique_delvers")),
  }),
  Object.freeze({
    id: "mixed-roster",
    title: "Two rooms, one delver, and two wardens",
    objective: 'Return ONLY compact JSON with EXACTLY two rooms, one delver, and two wardens: {"rooms":[{"id":"room-1"},{"id":"room-2"}],"actors":[{"id":"delver-1","kind":"delver"},{"id":"warden-1","kind":"warden"},{"id":"warden-2","kind":"warden"}]}. No prose, no code fences.',
    validate: (_value, { modelResponse } = {}) => {
      const ok = hasUniqueIds(modelResponse?.rooms, 2) && hasUniqueIds(modelResponse?.actors, 3)
        && actorKinds(modelResponse.actors).join(",") === "delver,warden,warden";
      return ok ? { ok: true } : fail("/", "expected_two_rooms_delver_two_wardens");
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
    validate: (_value, { modelResponse } = {}) => (modelResponse?.phase === "layout_only"
      && modelResponse?.layout?.floorTiles === 4 && modelResponse.layout.hallwayTiles === 2
      && hasUniqueIds(modelResponse?.rooms, 1)
      && Array.isArray(modelResponse?.missing) && modelResponse.missing.length === 0
      ? { ok: true } : fail("/", "expected_exact_sectional_layout")),
  }),
]);
