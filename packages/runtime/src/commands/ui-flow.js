import { buildBuildSpecFromSummary } from "../personas/director/buildspec-assembler.js";
import { enforceBudget } from "../personas/director/budget-enforcer.js";
import { mapSummaryToPool } from "../personas/director/pool-mapper.js";
import { deriveAllowedOptionsFromCatalog } from "../personas/orchestrator/prompt-contract.js";

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeArrayField(container, key) {
  if (!container || typeof container !== "object") return { changed: false };
  const value = container[key];
  if (value === undefined) return { changed: false };
  if (Array.isArray(value)) return { changed: false };
  if (value && typeof value === "object") {
    container[key] = [value];
    return { changed: true };
  }
  return { changed: false };
}

function normalizeAgentHints(hints) {
  if (!hints || typeof hints !== "object" || Array.isArray(hints)) return { changed: false };
  let changed = false;
  if (normalizeArrayField(hints, "rooms").changed) changed = true;
  if (normalizeArrayField(hints, "actors").changed) changed = true;
  if (normalizeArrayField(hints, "actorGroups").changed) changed = true;
  return { changed };
}

function normalizeArtifactRef(ref, schema) {
  if (ref === undefined || ref === null) return { value: ref, changed: false };
  if (typeof ref === "string" || typeof ref === "number") {
    return { value: { id: String(ref), schema, schemaVersion: 1 }, changed: true };
  }
  if (ref && typeof ref === "object" && !Array.isArray(ref)) {
    let changed = false;
    if (!ref.schema) {
      ref.schema = schema;
      changed = true;
    }
    if (!Number.isInteger(ref.schemaVersion)) {
      ref.schemaVersion = 1;
      changed = true;
    }
    return { value: ref, changed };
  }
  return { value: ref, changed: false };
}

export function normalizeBuildSpecForUi(specInput) {
  if (!specInput || typeof specInput !== "object") {
    return { spec: specInput, changed: false };
  }

  const spec = cloneJson(specInput);
  let changed = false;

  if (spec.intent?.hints) {
    if (normalizeAgentHints(spec.intent.hints).changed) changed = true;
  }
  if (spec.configurator?.inputs) {
    if (normalizeAgentHints(spec.configurator.inputs).changed) changed = true;
  }

  if (spec.budget && typeof spec.budget === "object" && !Array.isArray(spec.budget)) {
    const budgetRef = normalizeArtifactRef(spec.budget.budgetRef, "agent-kernel/BudgetArtifact");
    if (budgetRef.changed) {
      spec.budget.budgetRef = budgetRef.value;
      changed = true;
    }
    const priceListRef = normalizeArtifactRef(spec.budget.priceListRef, "agent-kernel/PriceList");
    if (priceListRef.changed) {
      spec.budget.priceListRef = priceListRef.value;
      changed = true;
    }
  }

  return { spec, changed };
}

export function buildSpecFromSummaryFlow({
  summary,
  catalog,
  selections,
  runId,
  source = "ui",
  createdAt,
} = {}) {
  if (!summary || typeof summary !== "object") {
    return { ok: false, reason: "missing_summary", errors: ["Summary is required."] };
  }

  const built = buildBuildSpecFromSummary({
    summary,
    catalog,
    selections,
    runId,
    source,
    createdAt,
  });

  if (!built.ok || !built.spec) {
    return {
      ok: false,
      reason: "invalid_spec",
      errors: built.errors || [],
    };
  }

  return {
    ok: true,
    runId: built.spec.meta?.runId || runId || "",
    spec: built.spec,
    specText: JSON.stringify(built.spec, null, 2),
  };
}

export function runPoolFlow({
  summary,
  catalog,
  runId = "pool_ui_run",
  source = "pool-ui",
  createdAt,
} = {}) {
  if (!summary || typeof summary !== "object") {
    return { ok: false, reason: "missing_summary", errors: ["No summary loaded or provided."] };
  }
  if (!catalog || typeof catalog !== "object") {
    return { ok: false, reason: "missing_catalog", errors: ["No catalog loaded or provided."] };
  }

  const mapped = mapSummaryToPool({ summary, catalog });
  if (!mapped.ok) {
    return {
      ok: false,
      reason: "mapping_failed",
      errors: mapped.errors || [],
      allowed: deriveAllowedOptionsFromCatalog(catalog),
    };
  }

  const enforced = enforceBudget({
    selections: mapped.selections,
    budgetTokens: summary.budgetTokens,
  });
  const built = buildSpecFromSummaryFlow({
    summary,
    catalog,
    selections: enforced.selections,
    runId,
    source,
    createdAt,
  });

  if (!built.ok) {
    return {
      ok: false,
      reason: built.reason || "invalid_spec",
      errors: built.errors || [],
      allowed: deriveAllowedOptionsFromCatalog(catalog),
      selections: enforced.selections,
      receipts: enforced.actions,
      spec: built.spec || null,
      specText: built.specText || "",
    };
  }

  return {
    ok: true,
    allowed: deriveAllowedOptionsFromCatalog(catalog),
    selections: enforced.selections,
    receipts: enforced.actions,
    spec: built.spec,
    specText: built.specText,
    runId: built.runId,
  };
}
