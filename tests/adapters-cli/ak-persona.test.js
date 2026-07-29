/**
 * HANDOFF-2 — `ak-persona`: run one persona standalone, artifact in, artifact out.
 *
 * The entry point the G1 CLI-differential family is built on. Its mechanism is:
 * capture the inputs the PRODUCTION path handed a persona, run the persona
 * standalone on those same inputs, and assert the artifacts match. A mismatch
 * means glue computed a different answer than the owning persona would have —
 * criterion A1/A2. That is stronger than module mocking, which proves only that a
 * persona was CALLED, and "called but ignored" is the shape of every finding in
 * CR.1-CR.9.
 *
 * These tests cover the contract, not the personas: every persona is invocable,
 * the envelope is enforced, and the two rules that exist to stop silent
 * degradation hold — the clock is never defaulted (PX.3), and a non-null `state`
 * is refused rather than ignored while `restore()` does not exist (PX.4).
 */
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync } = require("node:fs");
const { join, resolve } = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak-persona.mjs");
const FIXTURES = resolve(ROOT, "tests/fixtures/persona-cli");
const MODULE = "../../packages/adapters-cli/src/cli/ak-persona.mjs";

const PERSONAS = [
  "orchestrator",
  "director",
  "configurator",
  "actor",
  "allocator",
  "annotator",
  "moderator",
];

// The state each persona should reach from its initial state via its fixture's
// event. Pinned so a transition change cannot quietly turn these into no-ops.
const EXPECTED_STATE = {
  orchestrator: "planning",
  director: "intake",
  configurator: "pending_config",
  actor: "observing",
  allocator: "budgeting",
  annotator: "recording",
  moderator: "ticking",
};

function runCli(args, { input } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    input,
  });
}

function readFixture(persona) {
  return JSON.parse(readFileSync(join(FIXTURES, `${persona}-basic.json`), "utf8"));
}

function tmpOut(name) {
  return join(mkdtempSync(join(os.tmpdir(), `ak-persona-${name}-`)), "out.json");
}

function assertValidResult(result, persona) {
  assert.equal(result.schema, "agent-kernel/PersonaResult");
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.persona, persona);
  for (const key of ["id", "runId", "createdAt", "producedBy"]) {
    assert.ok(result.meta[key], `meta.${key} is present`);
  }
  assert.equal(result.meta.producedBy, persona);
  assert.ok(result.state && typeof result.state === "object");
  assert.equal(typeof result.subscribed, "boolean");
  assert.ok(Array.isArray(result.actions));
  assert.ok(Array.isArray(result.effects));
  assert.ok(Array.isArray(result.artifacts), "artifacts is uniform across personas");
  assert.ok("telemetry" in result);
  // The whole point is an artifact: it must survive a JSON round-trip.
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
}

// ---------------------------------------------------------------------------
// Stop condition: all seven personas invocable with state: null
// ---------------------------------------------------------------------------

for (const persona of PERSONAS) {
  test(`ak-persona ${persona}: --in/--out produces a schema-valid PersonaResult`, () => {
    const out = tmpOut(persona);
    const run = runCli([persona, "--in", join(FIXTURES, `${persona}-basic.json`), "--out", out]);
    assert.equal(run.status, 0, [run.stdout, run.stderr].join("\n"));

    const result = JSON.parse(readFileSync(out, "utf8"));
    assertValidResult(result, persona);
    assert.equal(result.subscribed, true, "the fixture names a phase this persona subscribes to");
    assert.equal(
      result.state.state,
      EXPECTED_STATE[persona],
      `${persona} advanced to its expected state (a real round ran, not a no-op)`,
    );
  });
}

test("the result's clock comes from the envelope, never from the wall clock", () => {
  const out = tmpOut("clock");
  const run = runCli(["configurator", "--in", join(FIXTURES, "configurator-basic.json"), "--out", out]);
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(readFileSync(out, "utf8"));
  const fixture = readFixture("configurator");
  assert.equal(result.meta.createdAt, fixture.clock);
  assert.equal(result.state.context.updatedAt, fixture.clock, "the persona's own context used it too");
});

test("stdin/stdout work when --in/--out are absent", () => {
  const fixture = readFixture("annotator");
  const run = runCli(["annotator"], { input: JSON.stringify(fixture) });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assertValidResult(result, "annotator");
  assert.equal(result.state.state, "recording");
});

test("--help prints usage and exits 0 without reading input", () => {
  const run = runCli(["--help"]);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /ak-persona <persona> --in <spec\.json> --out <result\.json>/);
  assert.match(run.stdout, /clock" is required/);
});

// ---------------------------------------------------------------------------
// Envelope enforcement — invalid input exits non-zero with structured errors
// ---------------------------------------------------------------------------

function expectRejection(mutate, matcher, { persona = "configurator" } = {}) {
  const fixture = readFixture(persona);
  mutate(fixture);
  const run = runCli([persona], { input: JSON.stringify(fixture) });
  assert.notEqual(run.status, 0, "a malformed envelope must exit non-zero");
  const payload = JSON.parse(run.stderr);
  const joined = [payload.message, ...(payload.errors || [])].join("\n");
  assert.match(joined, matcher);
  return payload;
}

test("the clock is REQUIRED and is never defaulted (PX.3)", () => {
  expectRejection((f) => { delete f.clock; }, /clock: expected ISO-8601 UTC timestamp/);
  expectRejection((f) => { f.clock = "not-a-date"; }, /clock: expected ISO-8601 UTC timestamp/);
  // A syntactically plausible but impossible date must not pass either.
  expectRejection((f) => { f.clock = "2026-13-45T99:99:99Z"; }, /clock: expected ISO-8601 UTC/);
});

test("a non-null state is REFUSED, not silently ignored (PX.4)", () => {
  const payload = expectRejection(
    (f) => { f.state = { state: "pending_config", context: {} }; },
    /only null is supported/,
  );
  assert.match(payload.errors.join("\n"), /PX\.4/, "the refusal cites the finding it comes from");
});

test("a missing state key is refused — absent is not the same as explicitly null", () => {
  expectRejection((f) => { delete f.state; }, /state: expected null \(required key\)/);
});

test("schema, schemaVersion and meta are enforced", () => {
  expectRejection((f) => { f.schema = "agent-kernel/Nope"; }, /schema: expected agent-kernel\/PersonaInvocation/);
  expectRejection((f) => { f.schemaVersion = 2; }, /schemaVersion: expected 1/);
  expectRejection((f) => { delete f.meta; }, /meta: expected object/);
  expectRejection((f) => { f.meta.runId = ""; }, /meta\.runId: expected non-empty string/);
});

test("the invocation block is enforced", () => {
  expectRejection((f) => { f.invocation.phase = "nonsense"; }, /invocation\.phase: expected one of/);
  expectRejection((f) => { f.invocation.event = ""; }, /invocation\.event: expected non-empty string/);
  expectRejection((f) => { f.invocation.tick = -1; }, /invocation\.tick: expected non-negative integer/);
  expectRejection((f) => { f.invocation.payload = []; }, /invocation\.payload: expected object/);
});

test("every problem is reported at once, not just the first", () => {
  const fixture = readFixture("configurator");
  delete fixture.clock;
  fixture.schemaVersion = 99;
  fixture.invocation.tick = -5;
  const run = runCli(["configurator"], { input: JSON.stringify(fixture) });
  assert.notEqual(run.status, 0);
  const { errors } = JSON.parse(run.stderr);
  assert.ok(errors.length >= 3, `expected at least 3 errors, got ${errors.length}`);
});

test("persona-specific construction inputs are rejected on the wrong persona", () => {
  // seed is the Actor's; priceList is the Allocator's. Accepting them elsewhere
  // would let a caller believe an input was honoured when it was dropped.
  expectRejection((f) => { f.seed = 42; }, /only the actor persona accepts a seed/);
  expectRejection((f) => { f.priceList = { items: [] }; }, /only the allocator persona accepts a price list/);
});

test("the positional persona must agree with the envelope", () => {
  const fixture = readFixture("configurator");
  const run = runCli(["allocator"], { input: JSON.stringify(fixture) });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /does not match envelope persona/);
});

test("unknown personas, unknown flags and malformed JSON are rejected", () => {
  const notAPersona = runCli(["accountant"], { input: "{}" });
  assert.notEqual(notAPersona.status, 0);
  assert.match(notAPersona.stderr, /is not a persona/);

  const badFlag = runCli(["configurator", "--wat", "x"], { input: "{}" });
  assert.notEqual(badFlag.status, 0);
  assert.match(badFlag.stderr, /unknown flag/);

  const badJson = runCli(["configurator"], { input: "{not json" });
  assert.notEqual(badJson.status, 0);
  assert.match(badJson.stderr, /invalid_json/);
});

// ---------------------------------------------------------------------------
// `subscribed` distinguishes "did not run" from "ran and changed nothing"
// ---------------------------------------------------------------------------

test("an unsubscribed phase reports subscribed:false and leaves the state alone", () => {
  // The Director subscribes to `decide` only, so `summarize` cannot reach its FSM.
  const fixture = readFixture("director");
  fixture.invocation.phase = "summarize";
  const run = runCli(["director"], { input: JSON.stringify(fixture) });
  assert.equal(run.status, 0, run.stderr);

  const result = JSON.parse(run.stdout);
  assertValidResult(result, "director");
  assert.equal(result.subscribed, false);
  assert.equal(result.state.state, "uninitialized", "no round ran, so the state did not move");
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.effects, []);
});

// ---------------------------------------------------------------------------
// Importable surface — the differential tests use it in-process
// ---------------------------------------------------------------------------

test("runPersonaInvocation is importable and throws structured errors", async () => {
  const { runPersonaInvocation, validatePersonaInvocation, PERSONA_NAMES } = await import(MODULE);
  assert.deepEqual([...PERSONA_NAMES].sort(), [...PERSONAS].sort());

  const result = await runPersonaInvocation(readFixture("allocator"));
  assertValidResult(result, "allocator");
  assert.equal(result.state.state, "budgeting");

  const bad = readFixture("allocator");
  delete bad.clock;
  assert.equal(validatePersonaInvocation(bad).ok, false);
  await assert.rejects(
    () => runPersonaInvocation(bad),
    (error) => error.code === "invalid_persona_invocation" && Array.isArray(error.errors),
  );
});

test("the same envelope run twice produces an identical result (deterministic)", async () => {
  const { runPersonaInvocation } = await import(MODULE);
  for (const persona of PERSONAS) {
    const first = await runPersonaInvocation(readFixture(persona));
    const second = await runPersonaInvocation(readFixture(persona));
    assert.deepEqual(second, first, `${persona} is reproducible from the same envelope`);
  }
});

// ## TODO: Test Permutations
