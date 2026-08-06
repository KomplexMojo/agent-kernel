/**
 * Director service surface — the synchronous API behind the controller.
 *
 * The Director owns intent translation: IntentEnvelope → PlanArtifact →
 * BuildSpec, plus catalog pool mapping (charter: "Persona Model — ENFORCED",
 * Director row). The sibling modules it fronts (buildspec-assembler,
 * pool-mapper) are persona internals: nothing outside personas/director/ may
 * import them directly once P2.1b threads the call sites.
 *
 * Two planes, one persona (charter rule 3): the tick plane drives the FSM via
 * advance() in the DECIDE phase; the BUILD plane uses this surface. Both move
 * the same state machine, so a build round is visible in view() exactly like
 * a tick round.
 *
 * State gating mirrors the Allocator's registerBudget → validateSpend
 * progression:
 *   beginBuild(intent)  uninitialized → intake → draft_plan  (emits the plan)
 *   mapPool(...)        requires a plan
 *   assembleBuildSpec() requires a plan; completes the round → ready
 *
 * Shared by controller.js and controller.mts so the two entry points cannot
 * drift.
 */
import { buildBuildSpecFromSummary } from "./buildspec-assembler.js";
import { mapSummaryToPool } from "./pool-mapper.js";
import { DirectorStates } from "./state-machine.js";

export class DirectorStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "DirectorStateError";
    this.code = "director_state";
  }
}

/** States in which a plan exists and translation may proceed. */
const PLANNED_STATES = Object.freeze([
  DirectorStates.DRAFT_PLAN,
  DirectorStates.REFINE,
  DirectorStates.READY,
]);

export function attachDirectorServices({ fsm, advanceWithPlan, clock } = {}) {
  let planArtifact = null;
  let buildSpecCount = 0;

  const currentState = () => fsm.view().state;

  function requireState(allowed, operation) {
    const state = currentState();
    if (!allowed.includes(state)) {
      const hint = state === DirectorStates.UNINITIALIZED
        ? " Call beginBuild(intentEnvelope) first."
        : "";
      throw new DirectorStateError(
        `Director cannot ${operation} in state "${state}" (requires ${allowed.join("|")}).${hint}`,
      );
    }
  }

  /**
   * Opens a build round from an IntentEnvelope: bootstrap → ingest_intent.
   * Returns the PlanArtifact the Director derived from the intent.
   */
  function beginBuild(intentEnvelope, { runId } = {}) {
    requireState([DirectorStates.UNINITIALIZED], "begin a build");
    if (!intentEnvelope || typeof intentEnvelope !== "object") {
      throw new DirectorStateError("beginBuild requires an IntentEnvelope object.");
    }
    const payload = { intentEnvelope, runId };
    advanceWithPlan("bootstrap", payload);
    const drafted = advanceWithPlan("ingest_intent", payload);
    planArtifact = drafted.planArtifact ?? null;
    return { state: currentState(), planArtifact };
  }

  /** The plan produced by the current build round, if any. */
  function currentPlan() {
    return planArtifact;
  }

  function mapPool(args = {}) {
    requireState(PLANNED_STATES, "map a catalog pool");
    return mapSummaryToPool(args);
  }

  function assembleBuildSpec(args = {}) {
    requireState(PLANNED_STATES, "assemble a build spec");
    // PX.3 (M6): the assembler stamps BuildSpec.meta.createdAt and now requires a clock.
    // The persona already has one injected at construction, so it supplies it — and only
    // where the caller did not, since `key: undefined` must not clobber it (the CR.9 M5
    // `withPersonaDefaults` lesson, same defect, different file).
    const spec = buildBuildSpecFromSummary(
      args.clock === undefined ? { ...args, clock } : args,
    );
    buildSpecCount += 1;
    // Completing the translation closes the round: draft → refine → ready.
    if (currentState() === DirectorStates.DRAFT_PLAN) {
      advanceWithPlan("draft_complete", { planArtifact });
      advanceWithPlan("refinement_complete", { planArtifact });
    }
    return spec;
  }

  /** Serializable service-side context merged into the persona view. */
  function serviceContext() {
    return {
      planId: planArtifact?.meta?.id ?? null,
      buildSpecCount,
    };
  }

  return {
    beginBuild,
    currentPlan,
    mapPool,
    assembleBuildSpec,
    serviceContext,
  };
}
