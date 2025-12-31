const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const effectsModule = moduleUrl("packages/runtime/src/ports/effects.js");
const fixturePath = resolve(__dirname, "../fixtures/adapters/effects-routing.json");

const script = `
import assert from "node:assert/strict";
import { dispatchEffect } from ${JSON.stringify(effectsModule)};
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixture = JSON.parse(readFileSync(resolve(${JSON.stringify(fixturePath)}), "utf8"));
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
`;

test("dispatchEffect consumes adapter fixtures for log/telemetry/solver_request", () => {
  runEsm(script);
});
