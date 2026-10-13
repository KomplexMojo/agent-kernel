/**
 * #242 — a placed resource's vital grant is charged on the `ak create` path.
 *
 * `ak create` hands the Allocator resources as placed actors whose grant is a
 * `vital` holding. Only the actor's own body was priced, so +5 permanent health
 * and +2 regen were free. The holding now prices exactly as the resource-spec
 * path does: the delta at its permanence tier, the regen per tick.
 */
const assert = require("node:assert/strict");

const SPEND = "../../../packages/runtime/src/personas/allocator/spend-proposal.js";

const holding = (over = {}) => ({ id: "res_1", kind: "vital", permanenceMode: "permanent", claimedBy: null,
  vitals: [{ key: "health", delta: 5, regen: 2 }], ...over });
const placed = (holdings) => ({ id: "res_1", category: "resource",
  vitals: { durability: { current: 1, max: 1, regen: 0 } }, affinities: [], holdings, normalizedMotivations: [] });
const lines = (proposal) => (proposal.items || []).filter((item) => item.subjectRef?.id === "res_1")
  .map(({ id, quantity }) => ({ id, quantity }));

test("a placed vital holding is charged like the same resource spec", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const fromActor = lines(buildSpendProposal({ actors: [placed([holding()])] }));
  const fromSpec = lines(buildSpendProposal({ resources: [{ id: "res_1", permanenceMode: "permanent",
    vitals: [{ key: "health", delta: 5, regen: 2 }] }] }));
  for (const line of fromSpec) assert.ok(fromActor.some((item) => item.id === line.id && item.quantity === line.quantity),
    `${line.id} x${line.quantity} is missing from the placed resource's lines`);
});

test("each permanence mode charges at its own tier", async () => {
  const { buildSpendProposal } = await import(SPEND);
  for (const [mode, id] of [["consumable", "resource_base"], ["level", "resource_level"], ["permanent", "resource_permanent"]]) {
    const items = lines(buildSpendProposal({ actors: [placed([holding({ permanenceMode: mode })])] }));
    assert.deepEqual(items.find((item) => item.id === id), { id, quantity: 5 }, mode);
  }
});

test("a body with no grant is charged for the body only", async () => {
  const { buildSpendProposal } = await import(SPEND);
  const items = lines(buildSpendProposal({ actors: [placed([])] }));
  assert.ok(!items.some((item) => item.id.startsWith("resource_")), JSON.stringify(items));
});

// ## TODO: Test Permutations
// - a holding with several vitals charges each delta and each regen
// - a claimed holding (claimedBy set) at build time
// - zero delta with nonzero regen
