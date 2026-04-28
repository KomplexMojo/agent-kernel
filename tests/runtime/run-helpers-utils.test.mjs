import assert from "node:assert/strict";
import {
  normalizeArgList,
  createDeterministicClock,
  resolveClockSeed,
} from "../../packages/runtime/src/commands/run-helpers.js";

// ── normalizeArgList ──────────────────────────────────────────────────────────

test("normalizeArgList: returns empty array for undefined", () => {
  assert.deepEqual(normalizeArgList(undefined), []);
});

test("normalizeArgList: returns empty array for null", () => {
  assert.deepEqual(normalizeArgList(null), []);
});

test("normalizeArgList: wraps a single string in an array", () => {
  assert.deepEqual(normalizeArgList("foo"), ["foo"]);
});

test("normalizeArgList: passes an existing array through unchanged", () => {
  assert.deepEqual(normalizeArgList(["a", "b"]), ["a", "b"]);
});

test("normalizeArgList: passes an empty array through unchanged", () => {
  assert.deepEqual(normalizeArgList([]), []);
});

// ── createDeterministicClock ──────────────────────────────────────────────────

test("createDeterministicClock: advances on each call", () => {
  const clock = createDeterministicClock(0);
  const t1 = clock();
  const t2 = clock();
  assert.notEqual(t1, t2);
  assert.ok(new Date(t2) > new Date(t1));
});

test("createDeterministicClock: accepts an ISO date string seed", () => {
  const clock = createDeterministicClock("2024-01-01T00:00:00.000Z");
  const t = clock();
  assert.ok(t.startsWith("2024-01-01"));
});

test("createDeterministicClock: accepts a numeric timestamp seed", () => {
  const epoch = Date.parse("2024-06-15T00:00:00.000Z");
  const clock = createDeterministicClock(epoch);
  const t = clock();
  assert.ok(t.startsWith("2024-06-15"));
});

// ── resolveClockSeed ──────────────────────────────────────────────────────────

test("resolveClockSeed: returns simConfig createdAt when present", () => {
  const result = resolveClockSeed({ meta: { createdAt: "2024-01-01T00:00:00.000Z" } }, {});
  assert.equal(result, "2024-01-01T00:00:00.000Z");
});

test("resolveClockSeed: falls back to initialState createdAt", () => {
  const result = resolveClockSeed({}, { meta: { createdAt: "2024-02-01T00:00:00.000Z" } });
  assert.equal(result, "2024-02-01T00:00:00.000Z");
});

test("resolveClockSeed: returns null when neither has createdAt", () => {
  assert.equal(resolveClockSeed({}, {}), null);
});


// ── normalizeArgList ──────────────────────────────────────────────────────────

test("normalizeArgList: wraps a single number in an array", () => {
  assert.deepEqual(normalizeArgList(42), [42]);
});

test("normalizeArgList: wraps a plain object in an array", () => {
  assert.deepEqual(normalizeArgList({ a: 1 }), [{ a: 1 }]);
});

test("normalizeArgList: passes an array of numbers through unchanged", () => {
  assert.deepEqual(normalizeArgList([1, 2, 3]), [1, 2, 3]);
});

// ── createDeterministicClock ──────────────────────────────────────────────────

test("createDeterministicClock: with an invalid string seed produces a clock starting near epoch 0", () => {
  const clock = createDeterministicClock("invalid-date");
  const t = clock();
  assert.ok(new Date(t).getTime() < 1000);
});

test("createDeterministicClock: with a negative numeric seed still returns valid ISO strings", () => {
  const clock = createDeterministicClock(-1);
  const t = clock();
  assert.match(t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("createDeterministicClock: each successive call increments by exactly 1 ms", () => {
  const clock = createDeterministicClock(0);
  const t1 = clock();
  const t2 = clock();
  assert.ok(new Date(t2).getTime() === new Date(t1).getTime() + 1);
});

// ── resolveClockSeed ──────────────────────────────────────────────────────────

test("resolveClockSeed: simConfig createdAt takes priority over initialState createdAt when both present", () => {
  const result = resolveClockSeed(
    { meta: { createdAt: "2024-03-01T00:00:00.000Z" } },
    { meta: { createdAt: "2024-04-01T00:00:00.000Z" } }
  );
  assert.equal(result, "2024-03-01T00:00:00.000Z");
});

test("resolveClockSeed: returns null when both args are undefined/null", () => {
  assert.equal(resolveClockSeed(undefined, null), null);
});