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
// ⚠️ TWO DIFFERENT FUNCTIONS, ONE NAME. `deriveLevelGen({ roomCount })` below is the trivial
// room-count → square-side derivation; `deriveLevelGenFromSummary(summary, roomGeometry)` is
// the rich one published on the controller AS `deriveLevelGen`. They are not
// interchangeable, and nothing guards the name. Aliased on import so a reader of the call
// sites can tell which is which (CR.4 M5b.2f).
import {
  buildBuildSpecFromSummary,
  deriveLevelGenFromSummary,
  deriveLevelGen as deriveLevelGenFromRoomCount,
} from "./buildspec-assembler.js";
import {
  buildCardSetFromSummary,
  extractSummaryFromCardSet,
  normalizeCardEntry,
} from "./summary-selections.js";
import { mapSummaryToPool } from "./pool-mapper.js";
import { enforceBudget as enforceBudgetOnSelections } from "./budget-enforcer.js";
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

export function attachDirectorServices({
  fsm,
  advanceWithPlan,
  clock,
  createAllocator,
  createConfigurator,
} = {}) {
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

  /**
   * D8.1 — the level geometry a summary implies, WITHOUT assembling a BuildSpec.
   *
   * The Configurator used to obtain this by importing `buildspec-assembler.js` and building
   * a throwaway spec just to read `configurator.inputs.levelGen` back out — the one leg of
   * the Director↔Configurator cycle pointing this way. Deriving level geometry from a design
   * summary is intent translation, so it is published here and the Configurator asks.
   *
   * Deliberately NOT state-gated, unlike `mapPool` and the pricing relays. Those produce or
   * price build artifacts; this reads a summary the caller already holds, stamps nothing and
   * issues no artifact. It is used to draw a PREVIEW, where no build round exists or should
   * — the same reasoning that leaves `configurator.deriveRoomLayout` ungated.
   */
  function deriveLevelGen(summary) {
    return deriveLevelGenFromSummary(summary, roomGeometry());
  }

  /**
   * D8.3 — the Configurator's room geometry, fetched on the Director's behalf.
   *
   * `extractSummaryFromCardSet` refuses without it whenever the summary carries room
   * cards, so this is the seam that keeps the Director able to answer at all. Returns
   * `undefined` rather than throwing when no Configurator was injected: the refusal
   * belongs to the function that actually needs the geometry, which can tell whether the
   * card set has room cards. Refusing here would refuse for actor-only summaries too.
   */
  function roomGeometry() {
    if (typeof createConfigurator !== "function") return undefined;
    const configurator = createConfigurator();
    return {
      deriveRoomLayout: configurator.deriveRoomLayout,
      buildRoomDesign: configurator.buildRoomDesign,
    };
  }

  /**
   * The Configurator counterpart of `requireAllocator`. `roomGeometry()` above returns
   * `undefined` when none was injected, deliberately, because the refusal belongs to the
   * function that needs the geometry. Feasibility is different: it cannot be answered at all
   * without the Configurator, so it refuses here and says why.
   */
  function requireConfigurator(operation) {
    if (typeof createConfigurator !== "function") {
      throw new DirectorStateError(
        `Director cannot ${operation}: no Configurator was injected. Feasibility is the `
        + "Configurator's law; the Director must not approximate it.",
      );
    }
  }

  /**
   * CR.4 M5b.2b — the build plane's pricing questions, asked on the caller's behalf.
   *
   * `llm-budget-loop.js` used to answer these itself by importing three Allocator
   * internals (budget-allocation, layout-spend, selection-spend), which put pricing policy
   * inside the Orchestrator — what "Economy — Allocator Authority" exists to forbid. Under
   * Option 1 (maintainer, 2026-08-07) the loop's sole counterpart is the Director, so the
   * Director asks the Allocator through its PUBLIC barrel and hands the answer back.
   *
   * These are NOT laundering the crossing the way routing Configurator answers through
   * here would: the Director→Allocator edge already goes through `allocator/persona.js`
   * and is not an allowlist row, so the loop's three rows die rather than move.
   *
   * Gated on PLANNED_STATES for the same reason `mapPool` is, and it is the same defect:
   * pricing a build that no round has begun is an artifact produced with no round. The
   * gate is the substance here, not paperwork — re-pointing the import alone would satisfy
   * the boundary rule and leave the authority defect exactly where it was.
   */
  function requireAllocator(operation) {
    if (typeof createAllocator !== "function") {
      throw new DirectorStateError(
        `Director cannot ${operation}: no Allocator was injected. Pricing is the `
        + "Allocator's to answer; the Director must not compute it.",
      );
    }
  }

  function resolveTileCosts(args = {}) {
    requireState(PLANNED_STATES, "resolve layout tile costs");
    requireAllocator("resolve layout tile costs");
    return createAllocator({ priceList: args.priceList }).resolveTileCosts(args);
  }

  function allocateBudget(args = {}) {
    requireState(PLANNED_STATES, "allocate a budget");
    requireAllocator("allocate a budget");
    return createAllocator({ priceList: args.priceList }).allocateBudget(args);
  }

  // CR.4 M5b.2c — the auto-fit search, relayed like the three above. This one is not a
  // lookup but a REVISION: it hands back a different layout from the one it was given, so
  // the Director must be in a planned state for the same reason `mapPool` must — the
  // revised layout is a build artifact, and a build artifact needs a round.
  function fitLayoutToBudget(args = {}) {
    requireState(PLANNED_STATES, "fit a layout to a budget");
    requireAllocator("fit a layout to a budget");
    return createAllocator({ priceList: args.priceList }).fitLayoutToBudget(args);
  }

  // CR.4 M5b.2d — pricing a layout the LLM proposed, against what is left of the budget.
  // Unlike `fitLayoutToBudget` this one revises nothing: it answers "what does this layout
  // cost and does it fit". The loop used to answer it by importing `allocator/layout-spend.js`
  // directly, which is the last surviving piece of pricing policy inside the Orchestrator.
  /**
   * CR.4 M5b.2f — layout feasibility, asked of the Configurator on the loop's behalf.
   *
   * The Director's own contribution is the levelGen: when the caller has no layout, the
   * geometry a room count implies is intent translation, which is why it is derived HERE and
   * the Configurator is handed the result. The Configurator owning that derivation would be
   * the reverse edge D8.1 removed; the loop owning it was the allowlist row this clears.
   *
   * Gated on PLANNED_STATES like the pricing relays and for the same reason: this judges a
   * build's layout against its actors, and judging a build no round has begun is the
   * "artifact produced with no round" defect. `deriveLevelGen` above stays ungated because it
   * previews; this decides.
   *
   * ⚠️ `roomCount` is accepted and no production caller supplies one — both loop call sites
   * pass a layout. The no-layout path is a real capability (an integer roomCount derives
   * valid geometry), but until ITEM C it answered a MISSING roomCount by deriving from
   * `undefined`: `deriveLevelGen` computes `Math.max(5, roomCount * 2 + 5)`, so the levelGen
   * came out `{ width: NaN, height: NaN }` and the refusal blamed `levelGen.width` and
   * `levelGen.height` — fields the caller never supplied, describing this function's own
   * derivation rather than the input that was absent.
   *
   * ITEM C (2026-08-12) refuses that case explicitly instead. The guard is keyed on
   * `Number.isInteger` rather than truthiness because `roomCount: 0` derives a valid
   * minimum-side level and is not the broken input; only a non-integer produces NaN.
   *
   * ⚠️ The refusal lives HERE and not in `configurator/feasibility.js` on purpose. Deriving
   * geometry from an intent is the Director's translation, so validating that the intent is
   * derivable is the Director's job too — and the Configurator's `assessLayoutFeasibility` is
   * under characterization by 185 captured cases, 56 of which take the absent-layout branch
   * with `roomCount: null` and record the NaN verdict. Moving the guard down there would drift
   * that fixture, which is the one piece of evidence the M5b.2f relocation did not shift.
   */
  function assessFeasibility({ layout, roomCount, actorCount } = {}) {
    requireState(PLANNED_STATES, "assess layout feasibility");
    requireConfigurator("assess layout feasibility");
    if (!layout && !Number.isInteger(roomCount)) {
      return {
        ok: false,
        errors: [{ field: "roomCount", code: "missing_layout_or_room_count" }],
      };
    }
    const levelGen = layout ? undefined : deriveLevelGenFromRoomCount({ roomCount });
    return createConfigurator().assessFeasibility({ layout, levelGen, actorCount });
  }

  function evaluateLayoutSpend(args = {}) {
    requireState(PLANNED_STATES, "evaluate layout spend");
    requireAllocator("evaluate layout spend");
    return createAllocator({ priceList: args.priceList }).evaluateLayoutSpend(args);
  }

  // `normalizeMotivations` is Configurator law, threaded from the composition root through
  // the loop (CR.9 M3). It is forwarded to the Allocator rather than restated here.
  function evaluateSelectionSpend(args = {}) {
    requireState(PLANNED_STATES, "evaluate selection spend");
    requireAllocator("evaluate selection spend");
    return createAllocator({
      priceList: args.priceList,
      normalizeMotivations: args.normalizeMotivations,
    }).evaluateSelectionSpend(args);
  }

  /**
   * CR.4 M5b.2e — summary → cardSet, the Director's own translation.
   *
   * The Orchestrator's budget loop stamped `summary.cardSet` itself by importing
   * `summary-selections.js`. Unlike the pricing relays above, nothing is being asked of
   * another persona here: turning an LLM summary into normalized cards (affinity defaults,
   * per-kind card shapes) is Director translation law, the same law `mapPool` applies.
   *
   * GATED, and for the same reason `mapPool` is rather than for symmetry: the cardSet is
   * returned on the loop's summary and reaches a persisted BuildSpec, so producing one with
   * no build round open is the "artifact produced with no round" defect. Contrast
   * `deriveLevelGen` two functions up, which is ungated because it is a preview a caller
   * already holds the inputs for and it issues nothing.
   */
  function buildCardSet(summary) {
    requireState(PLANNED_STATES, "build a card set");
    return buildCardSetFromSummary(summary);
  }

  /**
   * CR.7 / WP-5 (2026-08-12) — the card-set TRANSLATION surface, for authoring and preview.
   *
   * `commands/card-authoring.js` imported `extractSummaryFromCardSet`, `normalizeCardEntry`
   * and `buildCardSetFromSummary` from `summary-selections.js` directly, and was the last of
   * the eight orphaned allowlist rows. The charter names `card-authoring` as glue, and glue
   * may hold no domain logic, so the translation is published rather than reached past.
   *
   * ⚠️ **D8.3 DEFERRED THIS PUBLICATION AND THEN LANDED WITHOUT IT.**
   * `tests/helpers/director-capabilities.js` says `extractSummaryFromCardSet` is "not published
   * on the controller yet, and deliberately so… when D8.3 publishes it, change both together."
   * D8.3 shipped at `7bdd1c8b` and the publication never happened, leaving a helper and a
   * production file both reaching for an internal on a promise nothing was tracking. This is
   * that deferred change, and the helper moves to the controller in the same diff.
   *
   * ⚠️ **UNGATED, AND `cardSetFromSummary` IS AN UNGATED SIBLING OF THE GATED `buildCardSet`
   * ABOVE. THAT IS THE ONE THING TO UNDERSTAND HERE.** They call the same function. The
   * distinction is the CALLER's situation, not the computation:
   *
   *   - `buildCardSet` — a cardSet that will be stamped into a PERSISTED BuildSpec, produced
   *     during a build round. Gated on PLANNED_STATES (M5b.2e), and that gate was a LABEL until
   *     a perturbation forced it to be real. **The Orchestrator must keep using this one**; it
   *     receives it injected from `beginDirectorBuildCapabilities`, bound to an open round.
   *   - these three — reading, normalizing and re-rendering a card set the caller ALREADY
   *     HOLDS, on an authoring surface that stamps nothing and issues no artifact.
   *
   * Gating these would refuse the card-authoring and preview paths, where no build round
   * exists or should — an outage rather than a boundary, which is the D8.3 trap. It is the same
   * split `deriveLevelGen` (ungated preview) already makes against `assembleBuildSpec` (gated).
   * `director-card-translation.test.js` pins both halves: these answer with no round, and
   * `cardSetFromSummary` returns exactly what the gated `buildCardSet` returns, so the sibling
   * is one origin and not a second implementation.
   *
   * `resolveSummary` fetches the Configurator's room geometry ITSELF via `roomGeometry()`,
   * rather than taking it as an argument. D8.3's rule is that the Director asks the Configurator
   * for geometry; making every caller assemble that pair first is how `card-authoring.js` came
   * to hold a copy of it.
   */
  function resolveSummary(summaryInput) {
    return extractSummaryFromCardSet(summaryInput, roomGeometry());
  }

  function normalizeCard(entry, options) {
    return normalizeCardEntry(entry, options);
  }

  function cardSetFromSummary(summary) {
    return buildCardSetFromSummary(summary);
  }

  /**
   * CR.7 / WP-5 — trimming selections to fit a budget, published for `commands/ui-flow.js`.
   *
   * ui-flow imported `director/budget-enforcer.js` directly and was an allowlist row. It calls
   * this immediately after `director.mapPool` on an already-open round, so the gate below is
   * exercised by the one production caller rather than being a label.
   *
   * GATED, unlike the card-set translation above, and the difference is what it does: this
   * DECIDES which selections survive a budget, and its output flows into the BuildSpec. That is
   * the same reasoning that gates `mapPool` and the pricing relays.
   */
  function enforceBudget(args = {}) {
    requireState(PLANNED_STATES, "enforce a budget");
    return enforceBudgetOnSelections(args);
  }

  function assembleBuildSpec(args = {}) {
    requireState(PLANNED_STATES, "assemble a build spec");
    // PX.3 (M6): the assembler stamps BuildSpec.meta.createdAt and now requires a clock.
    // The persona already has one injected at construction, so it supplies it — and only
    // where the caller did not, since `key: undefined` must not clobber it (the CR.9 M5
    // `withPersonaDefaults` lesson, same defect, different file).
    const withClock = args.clock === undefined ? { ...args, clock } : args;
    const spec = buildBuildSpecFromSummary(
      withClock.roomGeometry === undefined
        ? { ...withClock, roomGeometry: roomGeometry() }
        : withClock,
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
    deriveLevelGen,
    buildCardSet,
    resolveSummary,
    normalizeCard,
    cardSetFromSummary,
    enforceBudget,
    assembleBuildSpec,
    // CR.4 M5b.2b — Allocator answers, given on the budget loop's behalf.
    resolveTileCosts,
    allocateBudget,
    evaluateSelectionSpend,
    fitLayoutToBudget,
    evaluateLayoutSpend,
    assessFeasibility,
    serviceContext,
  };
}
