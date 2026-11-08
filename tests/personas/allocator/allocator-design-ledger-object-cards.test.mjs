import { createRequire } from "node:module";
import { expect, test } from "vitest";
import { buildDesignSpendLedger, calculateObjectCardUnitCost } from "../../../packages/runtime/src/personas/allocator/spend-proposal.js";
import { createConfiguratorPersona } from "../../../packages/runtime/src/personas/configurator/persona.js";

// #312 — the design ledger that gates card moves prices hazard and resource cards as the
// objects the receipt charges (calculateObjectCardUnitCost). It used to price them as actors.
const require = createRequire(import.meta.url);
const { configuratorNormalizeMotivations } = require("../../helpers/configurator-capabilities.js");
const { directorResolveSummary } = require("../../helpers/director-capabilities.js");

const HAZARD = {
  id: "hazard_a", type: "hazard", source: "hazard", affinity: "water", expressions: ["emit"],
  affinities: [{ kind: "water", expression: "emit", stacks: 1 }], motivations: [], count: 2, tokenHint: 5,
  mana: { kind: "regen", current: 2, max: 7, regen: 3 }, durability: { kind: "one-time", amount: 4 },
};
const RESOURCE = {
  id: "resource_a", type: "resource", source: "resource", count: 3, affinity: "", affinities: [], expressions: ["push"], motivations: [], permanent: true, tokenHint: 9,
  resourceVitals: { health: { delta: 5, regen: 1 } },
};

async function ledgerFor(cards) {
  return buildDesignSpendLedger({
    summary: { budgetTokens: 5000, cardSet: cards },
    normalizeMotivations: await configuratorNormalizeMotivations(),
    resolveSummary: await directorResolveSummary(),
    deriveRoomLayout: createConfiguratorPersona({ clock: () => "2026-10-17T00:00:00.000Z" }).deriveRoomLayout,
  });
}

test("the price line is the object's receipt price; a hazard's tokenHint rides on top, a resource's does not", async () => {
  const ledger = await ledgerFor([HAZARD, RESOURCE]);
  const price = (card) => ledger.lineItems.find((line) => line.id === card.id && line.category === "actorConfiguration");
  expect(price(HAZARD)).toMatchObject({ count: 2, unitCostTokens: calculateObjectCardUnitCost({ card: HAZARD }).cost });
  expect(price(RESOURCE)).toMatchObject({ count: 3, unitCostTokens: calculateObjectCardUnitCost({ card: RESOURCE }).cost });
  expect(price(RESOURCE).detail.lineItems.map((item) => item.id)).toContain("resource_permanent");
  expect(ledger.lineItems.find((line) => line.id === HAZARD.id && line.category === "actorBase")).toMatchObject({ spendTokens: 10 });
  expect(ledger.lineItems.some((line) => line.id === RESOURCE.id && line.category === "actorBase")).toBe(false);
});

// ## TODO: Test Permutations
// - a hazard card with several affinity stacks prices every stack, as the receipt does.
// - a level-scoped resource card prices without the resource_permanent line.
// - a mixed card set (room, warden, hazard, resource) keeps room and actor lines unchanged.
