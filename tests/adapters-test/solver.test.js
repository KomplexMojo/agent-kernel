const test = require("node:test");
const assert = require("node:assert/strict");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const solverModule = moduleUrl("packages/adapters-test/src/adapters/solver/index.js");

const script = `
import assert from "node:assert/strict";
import { createTestSolverAdapter } from ${JSON.stringify(solverModule)};

const adapter = createTestSolverAdapter();

const found = await adapter.solve({ meta: { id: "v1-basic" } });
assert.equal(found.status, "unknown");

const deferred = await adapter.solve({ meta: { id: "v1-deferred" } });
assert.equal(deferred.status, "deferred");
assert.equal(deferred.reason, "offline");

const errorCase = await adapter.solve({ meta: { id: "v1-error" } });
assert.equal(errorCase.status, "error");
assert.equal(errorCase.reason, "solver_failed");

const missing = await adapter.solve({ meta: { id: "not-there" } });
assert.equal(missing.status, "deferred");
assert.equal(missing.reason, "missing_fixture");
`;

test("test solver adapter looks up fixtures and defers missing", () => {
  runEsm(script);
});
