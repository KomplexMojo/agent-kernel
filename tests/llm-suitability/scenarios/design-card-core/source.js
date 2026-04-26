export function createDesignCard({
  id,
  type = "",
  affinity,
  roomSize = "medium",
  count = 1,
  expressions,
  motivations,
  affinities,
  vitals,
  tier,
  stat,
  delta,
  dropRate,
  budgetCeiling,
  preserveEmptyAffinities = false,
} = {}) {
  // Excerpt from packages/ui-web/src/design-guidance.js.
  // The real function normalizes card type, count, affinity, motivations,
  // affinities, vitals, resource fields, and room fields.
  // Rooms intentionally clear motivations, vitals, affinities, and expressions.
  // Actor cards keep vitals and normalized motivation/affinity entries.
}

export function dropPropertyOnCard(card, property) {
  // Excerpt from packages/ui-web/src/design-guidance.js.
  // Supports groups: type, affinities, expressions, motivations.
  // Returns { ok, reason, card }.
  // Motivation drops can fail with reason "motivation_conflict".
  // Unsupported groups return ok:false.
}

export function buildSummaryFromCardSet({
  cards = [],
  budgetTokens = 2500,
  budgetSplit = {},
  dungeonAffinity = "fire",
} = {}) {
  // Excerpt from packages/ui-web/src/design-guidance.js.
  // Returns normalized cards plus a summary with rooms, actors, resources,
  // roomDesign/layout information, and spendLedger categories/totals.
}
