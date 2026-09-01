import { createAllocatorStateMachine, AllocatorStates } from "./state-machine.js";
/**
 * CR.7 / WP-5 — the design-spend surface, published so glue stops importing `spend-proposal.js`.
 *
 * `build/orchestrate-build.js`, `commands/kernel.js` and `commands/card-authoring.js` imported it
 * directly and were three allowlist rows. Pricing is the Allocator's authority ("Economy —
 * Allocator Authority"), so the answer is to publish the functions rather than let glue reach in.
 *
 * Stateless, like the pricing surface above: each prices what it is handed against the price list
 * it is handed. Gating them behind `registerBudget` would refuse the authoring and build paths
 * that have always called them and move no decision.
 */
export {
  evaluateConfiguratorSpend,
  calculateActorConfigurationUnitCost,
  buildDesignSpendLedger,
} from "./spend-proposal.js";
import { TickPhases } from "../_shared/tick-state-machine.mts";
import { buildAction, buildRequestActionsFromEffects, buildSolverRequestEffect } from "../_shared/persona-helpers.mts";
import { attachAllocatorServices } from "./allocator-services.js";
import { admitProposals } from "./proposal-admissibility.js";

export const allocatorSubscribePhases = Object.freeze([TickPhases.OBSERVE, TickPhases.DECIDE]);

// Three Configurator capabilities are injected here, the way CR.6 injects this
// persona's `admitProposals` into the Actor. All three are optional at CONSTRUCTION
// because most Allocator surfaces need none of them; the surfaces that do refuse
// loudly when one is absent, rather than answering a Configurator question themselves:
//
//   deriveRoomLayout      CR.9 M2  room geometry        AllocatorRoomGeometryError
//   authorCandidates      CR.9 M3  card assembly + validity
//                                                       AllocatorCandidateAuthoringError
//   normalizeMotivations  CR.9 M3  motivation vocabulary
//                                                       AllocatorMotivationVocabularyError
//
// A default in any of them would be a second, silently-diverging author of a
// chartered Configurator decision — the CR.1 defect class, and invisible because the
// resulting price stays a well-formed number.
export function createAllocatorPersona({
  initialState = AllocatorStates.IDLE,
  clock,
  priceList,
  priceListMeta,
  from,
  deriveRoomLayout,
  authorCandidates,
  normalizeMotivations,
} = {}) {
  const fsm = createAllocatorStateMachine({ initialState, clock, from });
  const services = attachAllocatorServices({
    fsm,
    priceList,
    priceListMeta,
    clock,
    deriveRoomLayout,
    authorCandidates,
    normalizeMotivations,
  });

  function view() {
    const snapshot = fsm.view();
    return { ...snapshot, context: { ...snapshot.context, ...services.serviceContext() } };
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!allocatorSubscribePhases.includes(phase) || !event) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    const result = fsm.advance(event, payload);
    const effects = [];
    const actions = [];
    const budgetLimit = typeof payload?.budget?.effects === "number" ? payload.budget.effects : Number.MAX_SAFE_INTEGER;

    const fromEffects = buildRequestActionsFromEffects(payload.effects, {
      tick,
      personaRef: "allocator",
      actorId: "allocator",
      budgetRemaining: budgetLimit,
    });
    actions.push(...fromEffects.actions);
    let remaining = fromEffects.remaining;

    if (Array.isArray(payload.externalFactPrompts)) {
      for (const prompt of payload.externalFactPrompts) {
        if (remaining <= 0) {
          break;
        }
        const requestId = prompt.requestId || prompt.id || `fact_${actions.length}`;
        actions.push(
          buildAction({
            tick,
            kind: "request_external_fact",
            actorId: "allocator",
            personaRef: "allocator",
            params: { requestId, query: prompt.query, targetAdapter: prompt.targetAdapter || "fixtures" },
          }),
        );
        remaining -= 1;
      }
    }

    if (Array.isArray(payload.solverPrompts)) {
      for (const prompt of payload.solverPrompts) {
        if (remaining <= 0) {
          break;
        }
        const requestId = prompt.requestId || prompt.id || `solver_${actions.length}`;
        actions.push(
          buildAction({
            tick,
            kind: "request_solver",
            actorId: "allocator",
            personaRef: "allocator",
            params: { requestId, problem: prompt.problem, targetAdapter: prompt.targetAdapter || "solver" },
          }),
        );
        remaining -= 1;
      }
    }

    // P5.5 — REBALANCING now GATES the chartered reconciliation instead of naming it.
    //
    // The edge `monitoring → rebalance → rebalancing` has existed since PX.5 and moved
    // nothing but a label: every other branch of this function is payload-driven and
    // runs identically in all five states, so a run could report `rebalancing` while
    // doing precisely what it did in `monitoring`. Charter (Enforcement → Personas):
    // "persona states must gate real behavior — label-only states are defects."
    //
    // ⚠️ The ledger is REQUIRED, not defaulted. `services.reconcile` throws when it is
    // absent, and that refusal is the point: the runner only sends `rebalance` when it
    // has a ledger to hand over, so reaching this branch without one is a wiring defect
    // that must be loud. Defaulting to an empty ledger would report every run as within
    // budget — the well-formed wrong answer this persona keeps refusing to give.
    if (event === "rebalance") {
      const reconciliation = services.reconcile({ ledger: payload.ledger });
      result.context = { ...result.context, reconciliation };
    }

    const solverEffect = buildSolverRequestEffect({
      solverRequest: payload.solver || payload.solverRequest,
      personaRef: "allocator",
      targetAdapter: payload.targetAdapter,
    });
    if (solverEffect) {
      effects.push(solverEffect);
      result.context = { ...result.context, lastSolverRequest: solverEffect.request };
    }
    result.context = { ...result.context, budgetRemaining: remaining };

    return {
      ...result,
      tick,
      actions,
      effects,
      telemetry: null,
    };
  }

  return {
    subscribePhases: allocatorSubscribePhases,
    advance,
    view,
    pricing: services.pricing,
    // RB3.1/RB3.2 — read-only build economy policy; none mutates the ledger.
    resolvePriceList: services.resolvePriceList,
    resolveActorExpansionAvailability: services.resolveActorExpansionAvailability,
    priceMixedRoomDesignSpend: services.priceMixedRoomDesignSpend,
    registerBudget: services.registerBudget,
    validateSpend: services.validateSpend,
    evaluateLayoutSpend: services.evaluateLayoutSpend,
    evaluateRoomCardLayoutSpend: services.evaluateRoomCardLayoutSpend,
    scenarioSpendReport: services.scenarioSpendReport,
    assessFeasibility: services.assessFeasibility,
    maximizeFulfillment: services.maximizeFulfillment,
    // CR.4 M5b.2b — the three pricing decisions the Orchestrator's budget loop used to
    // make by importing this persona's internals. Published here so the Director can ask
    // on the loop's behalf (Option 1: the Director is the loop's sole counterpart).
    resolveTileCosts: services.resolveTileCosts,
    allocateBudget: services.allocateBudget,
    evaluateSelectionSpend: services.evaluateSelectionSpend,
    // Z7.1 build-plane round trip: the persona returns a solver effect as data and
    // consumes the host-dispatched result. It never receives an adapter object.
    prepareLayoutBudgetFit: services.prepareLayoutBudgetFit,
    completeLayoutBudgetFit: services.completeLayoutBudgetFit,
    // CR.4 M5b.2c — the auto-fit search. Its reduction policy spends by price, which is why
    // it is the Allocator's and not the loop's.
    fitLayoutToBudget: services.fitLayoutToBudget,
    // CR.6 — budget admissibility of Actor proposals. Stateless, like the pricing
    // surface: it judges the proposals it is handed against the budget it is
    // handed. Published here so the runner can apply it without importing
    // persona internals.
    admitProposals,
  };
}
