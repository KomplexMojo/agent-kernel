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
 * into a plan (charter — "Persona Model — ENFORCED", Director row).
 *
 * ⚠️ THIS IS THE FALLBACK, NOT THE PREFERRED PATH (CR.3). It reconstructs an
 * intent from the FINISHED spec and drafts a plan from it, so the resulting
 * "IntentEnvelope → PlanArtifact → BuildSpec" chain never drove the spec — it is
 * derived from the completed product. Callers that ran a real Director round pass
 * it in via `directorRound` and this function is not used; see mapBuildSpecToArtifacts.
 *
 * It survives because several orchestrateBuild callers have only a spec and never
 * ran a Director at all (the sandbox bridge, kernel build paths, fixture-driven
 * tests). For those there is no earlier round to prefer, so this is the ONLY
 * Director — not a second one, and therefore not CR.3's defect. Threading those
 * call sites is WP-5 work (DECISION D-c).
 *
 * The plan id keeps the glue scheme (`${specId}_plan`) rather than the Director's
 * native `plan_${runId}_N`. That id is the only part of the plan that reaches
 * default output — sim-config.json embeds planRef = toRef(plan) — so pinning it
 * keeps the goldens byte-identical while producedBy still announces the Director
 * as producer (maintainer decision 2026-07-22, P2.1c). The same pin is applied to
 * a threaded plan, for the same reason.
 */
function buildPlan(spec, intent) {
  const director = createDirectorPersona({ clock: () => spec.meta.createdAt });
  const plan = director.beginBuild(intent, { runId: spec.meta.runId }).planArtifact;
  plan.meta.id = `${spec.meta.id}_plan`;
  return plan;
}

/**
 * Adopt a plan produced by a real Director round: pin its id to the glue scheme
 * so `planRef` in sim-config.json stays byte-identical, without mutating the
 * caller's artifact.
 */
function adoptRoundPlan(spec, plan) {
  return { ...plan, meta: { ...plan.meta, id: `${spec.meta.id}_plan` } };
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

/**
 * @param {object} spec
 * @param {object} [options]
 * @param {string} [options.producedBy]
 * @param {{intent: object, plan: object}} [options.directorRound]
 *   The output of a real Director round — the intent that opened it and the plan
 *   it drafted. When supplied, both are adopted instead of being reconstructed
 *   from the finished spec (CR.3). Passed as a PAIR deliberately: adopting the
 *   plan alone would leave `plan.intentRef` pointing at an intent this function
 *   had rebuilt, which is the same fiction one level down.
 */
export function mapBuildSpecToArtifacts(spec, { producedBy, directorRound } = {}) {
  const validation = validateBuildSpec(spec);
  if (!validation.ok) {
    const details = validation.errors.join("\n");
    throw new Error(`BuildSpec validation failed:\n${details}`);
  }

  const finalProducer = producedBy || "cli-build";
  const round = directorRound?.intent && directorRound?.plan ? directorRound : null;
  const intent = round ? round.intent : buildIntent(spec, finalProducer);
  const plan = round ? adoptRoundPlan(spec, round.plan) : buildPlan(spec, intent);
  const budget = mapBudget(spec);

  return {
    intent,
    plan,
    budget,
    configuratorInputs: spec.configurator?.inputs || null,
  };
}
