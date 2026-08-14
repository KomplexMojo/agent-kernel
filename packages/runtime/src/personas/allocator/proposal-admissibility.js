// Allocator-owned proposal admissibility (CR.6).
//
// Whether a proposal is affordable is a budget question, and the charter gives the
// Allocator sole authority over the economy. Until CR.6 this logic lived in
// `personas/actor/controller.js` and ran inline inside the Actor's advance(), so
// the Actor decided its own budget admissibility — the same mis-assignment as CR.9
// in the opposite direction (there, the Allocator doing the Configurator's job).
//
// The give-away was the vocabulary: the ids resolved below (`motivation_reflexive`,
// `affinity_expression_externalize`, `affinity_stack`) are priced in this persona's
// own `base-costs.json`. The Actor was reading the Allocator's price-list keys.
//
// Moved verbatim; this is a relocation, not a redesign. Pure — proposals and budget
// artifacts in, admitted proposals out. No IO, no clock.

const AFFINITY_EXPRESSION_IDS = Object.freeze({
  push: "affinity_expression_externalize",
  pull: "affinity_expression_internalize",
  emit: "affinity_expression_localized",
  draw: "affinity_expression_sustain",
});

const MOTIVATION_IDS = Object.freeze({
  reflexive: "motivation_reflexive",
  goal_oriented: "motivation_goal_oriented",
  strategy_focused: "motivation_strategy_focused",
});

function normalizeMotivationTier(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]/g, "_");
  if (normalized === "random") return "reflexive";
  if (normalized === "logical") return "goal_oriented";
  if (normalized === "strategic") return "strategy_focused";
  if (normalized === "goal_oriented") return "goal_oriented";
  if (normalized === "strategy_focused") return "strategy_focused";
  if (normalized === "reflexive") return "reflexive";
  return null;
}

function resolveMotivationId(proposal) {
  if (!proposal || typeof proposal !== "object") return null;
  if (proposal.costKind === "motivation" && typeof proposal.costId === "string") {
    return proposal.costId;
  }
  if (proposal.budget?.kind === "motivation" && typeof proposal.budget?.id === "string") {
    return proposal.budget.id;
  }
  if (typeof proposal.kind === "string" && proposal.kind.startsWith("motivation_")) {
    return proposal.kind;
  }
  if (proposal.kind !== "motivation") {
    return null;
  }
  const tier = normalizeMotivationTier(proposal.tier || proposal.motivation || proposal.level || proposal.kind);
  return tier ? MOTIVATION_IDS[tier] : null;
}

function resolveAffinityExpressionId(proposal) {
  if (!proposal || typeof proposal !== "object") return null;
  if (proposal.costKind === "affinity" && typeof proposal.costId === "string") {
    return proposal.costId;
  }
  if (proposal.budget?.kind === "affinity" && typeof proposal.budget?.id === "string") {
    return proposal.budget.id;
  }
  if (typeof proposal.kind === "string" && proposal.kind.startsWith("affinity_expression_")) {
    return proposal.kind;
  }
  if (proposal.kind !== "affinity") {
    return null;
  }
  const expression = proposal.expression || proposal.affinityExpression || proposal.affinity?.expression;
  if (!expression) return null;
  return AFFINITY_EXPRESSION_IDS[String(expression).trim().toLowerCase()] || null;
}

function hasBudgetAllowance({ budgetAllocation, budgetReceipt, kind, id }) {
  if (!budgetAllocation && !budgetReceipt) return true;
  if (budgetAllocation) {
    const pools = Array.isArray(budgetAllocation.pools) ? budgetAllocation.pools : [];
    const pool = pools.find((entry) => entry?.id === "affinity_motivation");
    if (pool && Number.isInteger(pool.tokens) && pool.tokens <= 0) {
      return false;
    }
  }
  if (!budgetReceipt) return true;
  const lineItems = Array.isArray(budgetReceipt.lineItems) ? budgetReceipt.lineItems : [];
  const matches = lineItems.filter((item) => item?.kind === kind && item?.id === id);
  if (matches.length === 0) {
    return false;
  }
  return matches.some((item) => item.status !== "denied" && Number.isInteger(item.quantity) && item.quantity > 0);
}

/**
 * Admit the proposals a budget allows.
 *
 * With neither a receipt nor an allocation there is nothing to judge against, so
 * every proposal is admitted — the pre-CR.6 behavior, preserved deliberately: this
 * is the case the tick plane is in today, which is why moving the policy here
 * changes no run output.
 *
 * @param {Array<object>} proposals candidate proposals, as emitted by the Actor
 * @param {{ budgetReceipt?: object, budgetAllocation?: object }} budget
 * @returns {Array<object>} the admitted subset, order preserved
 */
export function admitProposals(proposals, { budgetReceipt, budgetAllocation } = {}) {
  if (!Array.isArray(proposals)) return [];
  if (!budgetReceipt && !budgetAllocation) return proposals;
  return proposals.filter((proposal) => {
    const motivationId = resolveMotivationId(proposal);
    if (motivationId) {
      return hasBudgetAllowance({ budgetAllocation, budgetReceipt, kind: "motivation", id: motivationId });
    }
    const affinityExpressionId = resolveAffinityExpressionId(proposal);
    if (affinityExpressionId) {
      const expressionAllowed = hasBudgetAllowance({
        budgetAllocation,
        budgetReceipt,
        kind: "affinity",
        id: affinityExpressionId,
      });
      if (!expressionAllowed) return false;
      return hasBudgetAllowance({ budgetAllocation, budgetReceipt, kind: "affinity", id: "affinity_stack" });
    }
    return true;
  });
}
