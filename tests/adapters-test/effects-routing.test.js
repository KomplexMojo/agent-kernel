const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const fixturePath = resolve(__dirname, "../fixtures/adapters/effects-routing.json");


test("dispatchEffect consumes adapter fixtures for log/telemetry/solver_request", async () => {
const { dispatchEffect } = await import("../../packages/runtime/src/ports/effects.js");
const { readFileSync } = await import("node:fs");
const { resolve } = await import("node:path");

const fixture = JSON.parse(readFileSync(resolve(fixturePath), "utf8"));
const effects = fixture.effects;

const logs = [];
const telemetry = [];
const solverCalls = [];
const adapters = {
  logger: {
    log: (...args) => logs.push({ severity: "info", args }),
    warn: (...args) => logs.push({ severity: "warn", args }),
    error: (...args) => logs.push({ severity: "error", args }),
  },
  telemetry: { emit: (record) => telemetry.push(record) },
  solver: { solve: (request) => { solverCalls.push(request); return { status: "fulfilled", request }; } },
};

effects.filter((e) => e.kind !== "need_external_fact").forEach((effect) => {
  const outcome = dispatchEffect(adapters, effect);
  assert.equal(outcome.status, "fulfilled");
});

assert.ok(logs.find((entry) => entry.severity === "info"));
assert.equal(telemetry.length, 1);
assert.equal(telemetry[0].id, effects.find((e) => e.kind === "telemetry").id);
assert.equal(solverCalls.length, 1);
assert.equal(solverCalls[0].requestId, "solver-1");
assert.equal(solverCalls[0].targetAdapter, "solver");
});
