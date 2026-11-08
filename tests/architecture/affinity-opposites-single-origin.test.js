// #502: the opposed-pair table exists in runtime (AFFINITY_OPPOSITES) and in core-ts
// (OPPOSITE_TABLE). Core is authoritative; this fails if the runtime copy drifts.
const assert = require("node:assert/strict");

test("runtime AFFINITY_OPPOSITES equals core-ts's opposite table", async () => {
  const { AFFINITY_OPPOSITES } = await import("../../packages/runtime/src/contracts/domain-constants.js");
  const { AFFINITY_KIND_BY_CODE } = await import("../../packages/core-ts/src/index.ts");
  const { getOppositeAffinityKind } = await import("../../packages/core-ts/src/state/affinity.ts");
  const fromCore = {};
  for (const [code, name] of Object.entries(AFFINITY_KIND_BY_CODE)) {
    fromCore[name] = AFFINITY_KIND_BY_CODE[getOppositeAffinityKind(Number(code))];
  }
  assert.deepEqual({ ...AFFINITY_OPPOSITES }, fromCore);
});
