const assert = require("node:assert/strict");

async function loadStore() { return import("../../packages/adapters-test/src/adapters/adaptive-workflow/store.js"); }

test("content references are stable and stored values are clone-isolated", async () => {
  const { createAdaptiveWorkflowTestStore } = await loadStore();
  const store = createAdaptiveWorkflowTestStore();
  const value = { z: 1, nested: { b: 2, a: 1 } };
  const first = await store.putContent(value);
  const second = await store.putContent({ nested: { a: 1, b: 2 }, z: 1 });
  assert.deepEqual(first, second);
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  value.nested.a = 99;
  const loaded = await store.getContent(first);
  loaded.nested.a = 42;
  assert.equal((await store.getContent(first)).nested.a, 1);
  assert.notEqual((await store.putContent("text")).digest, first.digest);
  await assert.rejects(() => store.putContent({ missing: undefined }), /JSON-serializable/i);
  await assert.rejects(() => store.putContent({ invalid: Number.NaN }), /finite JSON numbers/i);
});

test("durable states are clone-isolated and corrupt content fails digest verification", async () => {
  const { createAdaptiveWorkflowTestStore } = await loadStore();
  const store = createAdaptiveWorkflowTestStore();
  const state = { runId: "run", nested: { value: 1 } };
  await store.save("run", state);
  state.nested.value = 2;
  const loaded = await store.load("run");
  loaded.nested.value = 3;
  assert.equal((await store.load("run")).nested.value, 1);
  const ref = await store.putContent({ response: "ok" });
  await assert.rejects(() => store.getContent({ ...ref, bytes: ref.bytes + 1 }), /byte length mismatch/i);
  store.tamperContent(ref, { response: "changed" });
  await assert.rejects(() => store.getContent(ref), /digest mismatch/i);
});

// ## TODO: Test Permutations
// - partial log write must leave the prior durable state readable
// - canonical hashing should reject unsupported non-JSON values
