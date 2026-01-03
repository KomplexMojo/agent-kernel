const BUDGET_LEDGER_ARTIFACT_SCHEMA = "agent-kernel/BudgetLedgerArtifact";
const BUDGET_RECEIPT_ARTIFACT_SCHEMA = "agent-kernel/BudgetReceiptArtifact";
const BUDGET_ARTIFACT_SCHEMA = "agent-kernel/BudgetArtifact";

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function normalizeQuantity(value) {
  if (!isFiniteNumber(value)) return 1;
  return value <= 0 ? 1 : value;
}

function buildRef(artifact, fallbackSchema) {
  const meta = artifact?.meta;
  if (meta?.id && artifact?.schema && artifact?.schemaVersion) {
    return { id: meta.id, schema: artifact.schema, schemaVersion: artifact.schemaVersion };
  }
  return { id: meta?.id || "unknown", schema: fallbackSchema, schemaVersion: 1 };
}

function resolveUnitCost(lineItems, { id, kind }) {
  const match = lineItems.find((item) => item?.id === id && item?.kind === kind && item?.status !== "denied");
  return isFiniteNumber(match?.unitCost) ? match.unitCost : 0;
}

export function updateBudgetLedger({ receipt, spendEvents, meta, receiptRef } = {}) {
  const lineItems = Array.isArray(receipt?.lineItems) ? receipt.lineItems : [];
  const events = Array.isArray(spendEvents) ? spendEvents : [];
  const normalizedEvents = events.map((event) => {
    const id = typeof event?.id === "string" ? event.id : "unknown";
    const kind = typeof event?.kind === "string" ? event.kind : "unknown";
    const quantity = normalizeQuantity(event?.quantity);
    const unitCost = resolveUnitCost(lineItems, { id, kind });
    const totalCost = unitCost * quantity;
    return { id, kind, quantity, unitCost, totalCost };
  });

  const baseRemaining = isFiniteNumber(receipt?.remaining) ? receipt.remaining : 0;
  const spent = normalizedEvents.reduce((sum, item) => sum + item.totalCost, 0);
  const remaining = baseRemaining - spent;

  return {
    ledger: {
      schema: BUDGET_LEDGER_ARTIFACT_SCHEMA,
      schemaVersion: 1,
      meta: meta || receipt?.meta || { id: "budget_ledger" },
      budgetRef: receipt?.budgetRef || buildRef(receipt, BUDGET_ARTIFACT_SCHEMA),
      receiptRef: receiptRef || buildRef(receipt, BUDGET_RECEIPT_ARTIFACT_SCHEMA),
      remaining,
      spendEvents: normalizedEvents,
    },
  };
}
