const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

async function loadValidator() {
  return import("../../packages/runtime/src/contracts/sandbox-session.mjs");
}

// -------------------------
// Valid fixture — default 10x10 single room
// -------------------------

test("sandbox session validation accepts default 10x10 single-room fixture", async () => {
  const { validateSandboxSession, SANDBOX_SESSION_SCHEMA } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const result = validateSandboxSession(artifact);
  assert.equal(artifact.schema, SANDBOX_SESSION_SCHEMA);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("sandbox session has default room dimensions 10x10", async () => {
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const room = Array.isArray(artifact.rooms) ? artifact.rooms[0] : null;
  assert.ok(room, "rooms[0] should exist");
  assert.equal(room.width, 10);
  assert.equal(room.height, 10);
});

test("sandbox session default fixture has exactly one room", async () => {
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  assert.ok(Array.isArray(artifact.rooms));
  assert.equal(artifact.rooms.length, 1);
});

test("sandbox session default fixture references required artifact types", async () => {
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const refs = artifact.artifacts;
  assert.ok(refs, "artifacts index should exist");
  assert.ok(refs.simConfigRef || refs["sim-config"], "should have sim config ref");
  assert.ok(refs.initialStateRef || refs["initial-state"], "should have initial state ref");
  assert.ok(refs.resourceBundleRef || refs["resource-bundle"], "should have resource bundle ref");
  assert.ok(refs.budgetReceiptRef || refs["budget-receipt"], "should have budget receipt ref");
});

// -------------------------
// Schema and envelope validation
// -------------------------

test("sandbox session validation rejects wrong schema", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const result = validateSandboxSession({ ...artifact, schema: "agent-kernel/Wrong" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /schema/);
});

test("sandbox session validation rejects wrong schemaVersion", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const result = validateSandboxSession({ ...artifact, schemaVersion: 2 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /schemaVersion/);
});

test("sandbox session validation rejects missing meta", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const { meta: _meta, ...rest } = artifact;
  const result = validateSandboxSession(rest);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /meta/);
});

test("sandbox session validation rejects missing meta.id", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const result = validateSandboxSession({ ...artifact, meta: { ...artifact.meta, id: "" } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /meta\.id/);
});

// -------------------------
// Room validation
// -------------------------

test("sandbox session validation rejects missing rooms array", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const { rooms: _rooms, ...rest } = artifact;
  const result = validateSandboxSession(rest);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /rooms/);
});

test("sandbox session validation rejects empty rooms array", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const result = validateSandboxSession({ ...artifact, rooms: [] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /rooms/);
});

test("sandbox session validation rejects room with non-positive width", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const rooms = [{ ...artifact.rooms[0], width: 0 }];
  const result = validateSandboxSession({ ...artifact, rooms });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /rooms\[0\]\.width/);
});

test("sandbox session validation rejects room with non-positive height", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const rooms = [{ ...artifact.rooms[0], height: -1 }];
  const result = validateSandboxSession({ ...artifact, rooms });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /rooms\[0\]\.height/);
});

test("sandbox session validation accepts custom room dimensions", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const rooms = [{ ...artifact.rooms[0], id: "room_custom", width: 15, height: 8 }];
  const result = validateSandboxSession({ ...artifact, rooms });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("sandbox session validation accepts additional explicit rooms", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const rooms = [
    artifact.rooms[0],
    { id: "room_extra", width: 6, height: 6 },
  ];
  const result = validateSandboxSession({ ...artifact, rooms });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

// -------------------------
// Artifacts index validation
// -------------------------

test("sandbox session validation rejects missing artifacts index", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const { artifacts: _artifacts, ...rest } = artifact;
  const result = validateSandboxSession(rest);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /artifacts/);
});

test("sandbox session validation rejects missing budget receipt ref", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("invalid/sandbox-session-artifact-v1-invalid-budget-ref.json");
  const result = validateSandboxSession(artifact);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /budget/i);
});

// -------------------------
// Schema catalog discovery
// -------------------------

test("SANDBOX_SESSION_SCHEMA constant is discoverable in schema catalog", async () => {
  const { SANDBOX_SESSION_SCHEMA } = await loadValidator();
  const { createSchemaCatalog } = await import("../../packages/runtime/src/contracts/schema-catalog.js");
  const catalog = createSchemaCatalog();
  const found = catalog.schemas.some((s) => s.schema === SANDBOX_SESSION_SCHEMA);
  assert.ok(found, `expected ${SANDBOX_SESSION_SCHEMA} in schema catalog`);
});

// -------------------------
// Entity categories
// -------------------------

test("sandbox session accepts entityCategories listing launch types", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const result = validateSandboxSession({
    ...artifact,
    entityCategories: ["delver", "warden", "hazard", "resource", "trap"],
  });
  assert.equal(result.ok, true);
});

test("sandbox session validation rejects unknown entity category", async () => {
  const { validateSandboxSession } = await loadValidator();
  const artifact = readFixture("sandbox-session-artifact-v1-default-room.json");
  const result = validateSandboxSession({
    ...artifact,
    entityCategories: ["delver", "unknown_type"],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /entityCategories/);
});

/* ## TODO: Test Permutations
 * - room with fractional width/height should be rejected
 * - room with non-integer width/height should be rejected
 * - artifacts index with null simConfigRef should be rejected
 * - artifacts index with null initialStateRef should be rejected
 * - artifacts index with null resourceBundleRef should be rejected
 * - multiple invalid rooms in a single call accumulates errors for each
 * - entityCategories as non-array should be rejected
 * - meta.runId as empty string should be rejected
 * - meta.createdAt as empty string should be rejected
 * - meta.producedBy as empty string should be rejected
 * - schemaVersion as string "1" (not number) should be rejected
 */
