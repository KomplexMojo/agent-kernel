import { validateBuildSpec } from "../contracts/build-spec.js";
import { createDirectorPersona } from "../personas/director/persona.js";

const SCHEMAS = Object.freeze({
  intent: "agent-kernel/IntentEnvelope",
});

function buildMeta(spec, producedBy, suffix) {
  return {
    id: `${spec.meta.id}_${suffix}`,
    runId: spec.meta.runId,
    createdAt: spec.meta.createdAt,
    producedBy,
    correlationId: spec.meta.correlationId,
    note: spec.meta.note,
  };
}

function buildIntent(spec, producedBy) {
  return {
    schema: SCHEMAS.intent,
    schemaVersion: 1,
    meta: buildMeta(spec, producedBy, "intent"),
    source: spec.meta.source,
    intent: {
      goal: spec.intent.goal,
      tags: spec.intent.tags || undefined,
      hints: spec.intent.hints || undefined,
    },
  };
}

/**
 * The PlanArtifact is persona-owned: the Director translates an IntentEnvelope
 * into a plan (charter — "Persona Model — ENFORCED", Director row). This glue
 * only unpacks boundary data (the IntentEnvelope) and hands it to the Director,
 * which stamps its own provenance (meta.producedBy "director") and derives
 * directives/theme from the intent. The plan is a build-plane product, so we
 * spin up a single-round persona per spec; the round's plan is all we need.
 *
 * The plan id, however, keeps the glue scheme (`${specId}_plan`) rather than
 * the Director's native `plan_${runId}_N`. That id is the only part of the plan
 * that reaches default output — sim-config.json embeds planRef = toRef(plan) —
 * so pinning it keeps the goldens byte-identical while producedBy still
 * announces the Director as producer (maintainer decision 2026-07-22). The
 * plan's other Director-derived fields live only in the emit-intermediates
 * plan.json, which has no goldens and no downstream consumer beyond toRef.
 */
function buildPlan(spec, intent) {
  const director = createDirectorPersona({ clock: () => spec.meta.createdAt });
  const plan = director.beginBuild(intent, { runId: spec.meta.runId }).planArtifact;
  plan.meta.id = `${spec.meta.id}_plan`;
  return plan;
}

function mapBudget(spec) {
  const budget = spec.budget;
  if (!budget) {
    return null;
  }

  return {
    budgetRef: budget.budgetRef,
    priceListRef: budget.priceListRef,
    receiptRef: budget.receiptRef,
    budget: budget.budget,
    priceList: budget.priceList,
    receipt: budget.receipt,
  };
}

export function mapBuildSpecToArtifacts(spec, { producedBy } = {}) {
  const validation = validateBuildSpec(spec);
  if (!validation.ok) {
    const details = validation.errors.join("\n");
    throw new Error(`BuildSpec validation failed:\n${details}`);
  }

  const finalProducer = producedBy || "cli-build";
  const intent = buildIntent(spec, finalProducer);
  const plan = buildPlan(spec, intent);
  const budget = mapBudget(spec);

  return {
    intent,
    plan,
    budget,
    configuratorInputs: spec.configurator?.inputs || null,
  };
}
