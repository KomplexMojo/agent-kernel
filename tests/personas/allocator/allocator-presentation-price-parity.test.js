"use strict";

const assert = require("node:assert/strict");

test("presentation category does not change normalized actor charges", async () => {
  const { buildSpendProposal } = await import(
    "../../../packages/runtime/src/personas/allocator/spend-proposal.js"
  );
  const categories = ["delver", "warden", "hazard", "resource", "barrier"];
  const charged = categories.map((category) => {
    const id = `same_${category}`;
    const proposal = buildSpendProposal({ actors: [{
      id, category, alignment: "dungeon",
      vitals: {
        health: { current: 7, max: 10, regen: 1 },
        durability: { current: 3, max: 5, regen: 0 },
      },
      affinities: [{ kind: "fire", expression: "emit", stacks: 2 }],
      normalizedMotivations: [{ kind: "defending", intensity: 1 }],
      holdings: [],
    }] });
    return proposal.items.map(({ category: _category, subjectRef, ...item }) => ({
      ...item, subjectRef: { ...subjectRef, id: "same" },
    }));
  });
  charged.slice(1).forEach((items) => assert.deepEqual(items, charged[0]));
});

// ## TODO: Test Permutations
// - explicit vital holdings add the same charges under every presentation category
