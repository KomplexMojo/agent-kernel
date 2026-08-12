import { validateBuildSpec } from "../contracts/build-spec.js";

const SCHEMAS = Object.freeze({
  intent: "agent-kernel/IntentEnvelope",
  plan: "agent-kernel/PlanArtifact",
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

function buildPlan(spec, producedBy, intent) {
  const plan = {
    schema: SCHEMAS.plan,
    schemaVersion: 1,
    meta: buildMeta(spec, producedBy, "plan"),
    intentRef: {
      id: intent.meta.id,
      schema: intent.schema,
      schemaVersion: intent.schemaVersion,
    },
    plan: {
      objectives: [
        {
          id: "objective_1",
          description: spec.intent.goal,
          priority: 1,
        },
      ],
    },
  };

  if (spec.plan?.hints) {
    plan.directives = spec.plan.hints;
  }

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
  const plan = buildPlan(spec, finalProducer, intent);
  const budget = mapBudget(spec);

  return {
    intent,
    plan,
    budget,
    configuratorInputs: spec.configurator?.inputs || null,
  };
}
