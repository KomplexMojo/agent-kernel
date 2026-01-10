function addAction(actions, id, action, delta, reason) {
  actions.push({ id, action, delta, reason });
}

export function enforceBudget({ selections, budgetTokens }) {
  const cap = Number.isInteger(budgetTokens) && budgetTokens > 0 ? budgetTokens : 0;
  let totalRequested = 0;
  let totalApplied = 0;
  const actions = [];

  const processed = selections.map((sel) => {
    const unitCost = sel.applied?.cost || 0;
    const requestedCount = sel.requested?.count || 0;
    const requestedCost = unitCost * requestedCount;
    totalRequested += requestedCost;

    return {
      ...sel,
      requestedCost,
      unitCost,
      remainingCount: requestedCount,
    };
  });

  if (cap === 0) {
    // No cap provided, approve all applied
    processed.forEach((sel) => {
      totalApplied += sel.unitCost * sel.remainingCount;
    });
    return {
      totalRequested,
      totalApplied,
      totalApproved: totalApplied,
      actions,
      selections: processed,
    };
  }

  // Deterministic policy: sort by cost descending, then id
  processed.sort((a, b) => {
    if (a.unitCost !== b.unitCost) return b.unitCost - a.unitCost;
    const idA = a.applied?.id || "";
    const idB = b.applied?.id || "";
    return idA.localeCompare(idB);
  });

  processed.forEach((sel) => {
    const maxAffordableCount = Math.max(0, Math.floor((cap - totalApplied) / sel.unitCost));
    const approvedCount = Math.min(sel.remainingCount, maxAffordableCount);
    if (approvedCount < sel.remainingCount) {
      addAction(actions, sel.applied?.id || "unknown", "downTierOrDrop", sel.remainingCount - approvedCount, "over_budget");
      sel.remainingCount = approvedCount;
    }
    totalApplied += sel.unitCost * sel.remainingCount;
  });

  // Strip helper fields
  const finalized = processed.map((sel) => ({
    ...sel,
    approvedCount: sel.remainingCount,
  }));

  return {
    totalRequested,
    totalApplied,
    totalApproved: totalApplied,
    actions,
    selections: finalized,
  };
}
