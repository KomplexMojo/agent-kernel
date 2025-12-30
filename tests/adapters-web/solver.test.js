const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const solverModule = moduleUrl("packages/adapters-web/src/adapters/solver/index.js");

const script = `
import assert from "node:assert/strict";
import { createWebSolverAdapter } from ${JSON.stringify(solverModule)};

const adapter = createWebSolverAdapter({ fixture: { status: "fulfilled", meta: { id: "web" } } });
const result = await adapter.solve({ meta: { id: "req" } });
assert.equal(result.status, "fulfilled");
assert.equal(result.meta.id, "web");

const stub = createWebSolverAdapter();
const stubResult = await stub.solve({ meta: { id: "req2" } });
assert.equal(stubResult.status, "fulfilled");
assert.equal(stubResult.result.note, "stubbed_solver_result");
`;

test("web solver adapter supports fixture and stub paths", () => {
  runEsm(script);
});
