const assert = require("node:assert/strict");



test("web solver adapter supports fixture and stub paths", async () => {
const { createWebSolverAdapter } = await import("../../packages/adapters-web/src/adapters/solver/index.js");

const adapter = createWebSolverAdapter({ fixture: { status: "fulfilled", meta: { id: "web" } } });
const result = await adapter.solve({ meta: { id: "req" } });
assert.equal(result.status, "fulfilled");
assert.equal(result.meta.id, "web");

const stub = createWebSolverAdapter();
const stubResult = await stub.solve({ meta: { id: "req2" } });
assert.equal(stubResult.status, "fulfilled");
assert.equal(stubResult.result.note, "stubbed_solver_result");
});
